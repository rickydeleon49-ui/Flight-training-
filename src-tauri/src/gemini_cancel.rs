//! Cancelling a running generation (GEN-REL-04).
//!
//! Whether a generation is cancelled or completes is decided once, in the job
//! journal (`Journal::cancel` and the journal's own completion both act only on
//! a job that is still running, under its lock). Only after the journal has
//! recorded `cancelled` is the generation's work woken here and dropped, so
//! nothing more is sent and nothing it would have produced is returned or
//! saved. Cancelling cannot promise that Google had not already received, or
//! processed and charged for, a request that was sent before it.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

/// Said when a generation was cancelled. It claims nothing about Google's side.
pub(crate) const CANCELLED: &str = "Creating this was cancelled, and nothing was saved. If the request had already reached Google, Google may still have processed it.";

/// A running job's cancel token: it wakes the job's work so it is dropped at
/// once. Whether a request may still be sent is not decided here but by the
/// journal (`Journal::admits`), under the same lock as the cancel decision.
#[derive(Default)]
pub(crate) struct CancelToken {
    cancelled: AtomicBool,
    waker: Mutex<Option<Waker>>,
}

impl CancelToken {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(waker) = self.waker.lock().unwrap_or_else(|e| e.into_inner()).take() {
            waker.wake();
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// The marker a cancelled piece of work ends with.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Cancelled;

/// Runs `inner` until it finishes or the token is cancelled, whichever comes
/// first. On cancellation `inner` is dropped at once, so every request it had
/// in flight is abandoned and its own cleanup guards run.
pub(crate) struct Cancellable<F: Future> {
    inner: Option<Pin<Box<F>>>,
    token: Arc<CancelToken>,
}

impl<F: Future> Cancellable<F> {
    pub(crate) fn new(inner: F, token: Arc<CancelToken>) -> Self {
        Cancellable {
            inner: Some(Box::pin(inner)),
            token,
        }
    }
}

impl<F: Future> Future for Cancellable<F> {
    type Output = Result<F::Output, Cancelled>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.token.is_cancelled() {
            self.inner = None;
            return Poll::Ready(Err(Cancelled));
        }
        *self.token.waker.lock().unwrap_or_else(|e| e.into_inner()) = Some(cx.waker().clone());
        // Checked again after registering, so a cancel in between is not missed.
        if self.token.is_cancelled() {
            self.inner = None;
            return Poll::Ready(Err(Cancelled));
        }
        let Some(inner) = self.inner.as_mut() else {
            return Poll::Ready(Err(Cancelled));
        };
        match inner.as_mut().poll(cx) {
            Poll::Ready(output) => {
                self.inner = None;
                Poll::Ready(if self.token.is_cancelled() {
                    Err(Cancelled)
                } else {
                    Ok(output)
                })
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

/// The tokens of generations running now, by job id.
static RUNNING: Mutex<Option<HashMap<String, Arc<CancelToken>>>> = Mutex::new(None);

/// A token for a job that has just begun. Released by dropping the guard.
pub(crate) fn register(job_id: &str) -> Registration {
    let token = Arc::new(CancelToken::default());
    RUNNING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(job_id.to_string(), token.clone());
    Registration {
        job_id: job_id.to_string(),
        token,
    }
}

/// Wake a running job's work so it stops. The journal must already say
/// `cancelled`; this only makes the work notice.
pub(crate) fn wake(job_id: &str) {
    let token = RUNNING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|running| running.get(job_id).cloned());
    if let Some(token) = token {
        token.cancel();
    }
}

pub(crate) struct Registration {
    job_id: String,
    pub(crate) token: Arc<CancelToken>,
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(running) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            if running
                .get(&self.job_id)
                .is_some_and(|t| Arc::ptr_eq(t, &self.token))
            {
                running.remove(&self.job_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancelled_token_drops_the_work_and_reports_it() {
        let registration = register("job-cancel-unit-test-0000000");
        let token = registration.token.clone();
        let dropped = Arc::new(AtomicBool::new(false));
        struct Flag(Arc<AtomicBool>);
        impl Drop for Flag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let flag = Flag(dropped.clone());
        let work = Cancellable::new(
            async move {
                let _flag = flag;
                std::future::pending::<()>().await
            },
            token,
        );
        let waker = Waker::noop();
        let mut cx = Context::from_waker(waker);
        let mut work = Box::pin(work);
        assert!(work.as_mut().poll(&mut cx).is_pending());
        wake("job-cancel-unit-test-0000000");
        assert_eq!(work.as_mut().poll(&mut cx), Poll::Ready(Err(Cancelled)));
        assert!(dropped.load(Ordering::SeqCst), "the work was dropped");
    }

    #[test]
    fn work_that_finishes_first_is_returned() {
        let registration = register("job-cancel-unit-test-0000001");
        let work = Cancellable::new(async { 7 }, registration.token.clone());
        assert_eq!(tauri::async_runtime::block_on(work), Ok(7));
    }

    #[test]
    fn a_finished_registration_is_forgotten() {
        let registration = register("job-cancel-unit-test-0000002");
        drop(registration);
        // Waking an unknown job is harmless.
        wake("job-cancel-unit-test-0000002");
        assert!(RUNNING
            .lock()
            .unwrap()
            .as_ref()
            .map(|r| !r.contains_key("job-cancel-unit-test-0000002"))
            .unwrap_or(true));
    }
}
