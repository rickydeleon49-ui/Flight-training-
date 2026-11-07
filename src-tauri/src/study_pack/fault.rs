//! Test hooks at every crash point of an import (design 6 B, "PackFault").
//!
//! Production builds compile `hit` to nothing. A test can install a hook that
//! fails (or simulates a crash at) a named point, observe the order points
//! are reached in, or run code at a point (for example a second writer). A
//! child test process can also be told by environment variable to abort at a
//! point, so recovery is exercised after real process death.

/// The error text that means "the process died here": the import returns it
/// without running any cleanup, exactly like a crash would.
pub const CRASH: &str = "__pack_crash__";

#[cfg(not(test))]
#[inline]
pub fn hit(_point: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
pub use test_support::*;

#[cfg(test)]
mod test_support {
    use std::cell::RefCell;

    type Hook = Box<dyn FnMut(&str) -> Result<(), String>>;

    std::thread_local! {
        static HOOK: RefCell<Option<Hook>> = const { RefCell::new(None) };
        static TRACE: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    }

    pub const ABORT_ENV: &str = "HFD_PACK_ABORT_AT";

    pub fn hit(point: &str) -> Result<(), String> {
        TRACE.with(|t| t.borrow_mut().push(point.to_string()));
        if std::env::var(ABORT_ENV).is_ok_and(|at| at == point) {
            std::process::abort();
        }
        HOOK.with(|h| match h.borrow_mut().as_mut() {
            Some(hook) => hook(point),
            None => Ok(()),
        })
    }

    pub fn set_hook(hook: impl FnMut(&str) -> Result<(), String> + 'static) {
        HOOK.with(|h| *h.borrow_mut() = Some(Box::new(hook)));
    }

    pub fn clear() {
        HOOK.with(|h| *h.borrow_mut() = None);
        TRACE.with(|t| t.borrow_mut().clear());
    }

    pub fn trace() -> Vec<String> {
        TRACE.with(|t| t.borrow().clone())
    }

    /// Fail with an ordinary error at exactly this point.
    pub fn fail_at(point: &'static str) {
        set_hook(move |p| {
            if p == point {
                Err(format!("injected failure at {point}"))
            } else {
                Ok(())
            }
        });
    }

    /// Simulate the process dying at exactly this point.
    pub fn crash_at(point: &'static str) {
        set_hook(move |p| {
            if p == point {
                Err(super::CRASH.to_string())
            } else {
                Ok(())
            }
        });
    }
}
