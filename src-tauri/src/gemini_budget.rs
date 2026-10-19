//! One bounded budget per generation (GEN-REL-03).
//!
//! Before this, each request had its own 300-second timeout and up to five
//! requests could be made, so "Creating study aid…" could spin for well over
//! twenty minutes and still end with "Gemini did not answer in time". Now one
//! generation has one active budget that every step draws from: uploading the
//! PDF, waiting for Google to prepare it, every generation attempt, every pause
//! between attempts and the backup model. No step is given a fresh allowance.
//!
//! - At most `MAX_GENERATION_ATTEMPTS` generation requests, the backup model
//!   included.
//! - A pause (backoff, or Google's own `Retry-After`) is taken only if it fits
//!   in what remains; otherwise the generation stops and says why.
//! - Each request's timeout is what remains, so a request that times out has
//!   used the whole budget.
//! - Time is measured on a monotonic clock, so a change to the Mac's clock
//!   neither extends nor cuts the budget.
//!
//! The budget also keeps a short, sanitized trace for the failure message:
//! the stage reached, the attempts made, the time spent, the last HTTP status
//! and a category. It never holds a key, a document, a path or a provider
//! body.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The active budget for one generation, upload included.
pub(crate) const ACTIVE_BUDGET: Duration = Duration::from_secs(300);
/// How long to wait for a connection to Google before calling it unreachable.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Generation requests per generation, the backup model included.
pub(crate) const MAX_GENERATION_ATTEMPTS: u32 = 3;

pub(crate) type Now = Arc<dyn Fn() -> Instant + Send + Sync>;
pub(crate) type Sleep =
    Arc<dyn Fn(Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// Where a generation had got to, for the failure message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stage {
    Preparing,
    Uploading,
    WaitingForFile,
    /// Asking Google whether an uploaded copy is ready or still usable.
    CheckingFile,
    Generating,
    Reading,
    Validating,
    Pausing,
}

impl Stage {
    /// A stable name for the window, which words it for her.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Stage::Preparing => "preparing",
            Stage::Uploading => "uploading",
            Stage::WaitingForFile => "waiting-for-file",
            Stage::CheckingFile => "checking-file",
            Stage::Generating => "generating",
            Stage::Reading => "reading",
            Stage::Validating => "validating",
            Stage::Pausing => "pausing",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Stage::Preparing => "preparing the document",
            Stage::Uploading => "uploading the PDF",
            Stage::WaitingForFile => "waiting for Google to prepare the PDF",
            Stage::CheckingFile => "checking the uploaded PDF",
            Stage::Generating => "waiting for Gemini's answer",
            Stage::Reading => "receiving Gemini's answer",
            Stage::Validating => "checking Gemini's answer",
            Stage::Pausing => "pausing before trying again",
        }
    }
}

#[derive(Clone, Debug)]
struct Trace {
    stage: Stage,
    last_status: Option<u16>,
    category: Option<&'static str>,
}

pub(crate) struct Budget {
    started: Instant,
    total: Duration,
    now: Now,
    sleep: Sleep,
    attempts: Mutex<u32>,
    trace: Mutex<Trace>,
    /// Told each time the stage changes, with the attempts made so far
    /// (GEN-REL-04's progress). Called outside every lock.
    observer: Mutex<Option<Observer>>,
    /// Whether this job may still send a request (GEN-REL-04): the journal's
    /// answer, asked immediately before every request, pause and cleanup, so
    /// a cancel recorded before the next submission prevents it, however far
    /// one poll of the work runs.
    admission: Mutex<Option<Admission>>,
}

pub(crate) type Admission = Arc<dyn Fn() -> bool + Send + Sync>;

pub(crate) type Observer = Arc<dyn Fn(Stage, u32) + Send + Sync>;

impl Budget {
    /// The real budget: the system's monotonic clock and the runtime's timer.
    pub(crate) fn new(total: Duration) -> Budget {
        Budget::with(
            total,
            Arc::new(Instant::now),
            Arc::new(|d| Box::pin(tokio::time::sleep(d))),
        )
    }

    /// A budget on an injected clock and timer, for tests.
    pub(crate) fn with(total: Duration, now: Now, sleep: Sleep) -> Budget {
        Budget {
            started: now(),
            total,
            now,
            sleep,
            attempts: Mutex::new(0),
            trace: Mutex::new(Trace {
                stage: Stage::Preparing,
                last_status: None,
                category: None,
            }),
            observer: Mutex::new(None),
            admission: Mutex::new(None),
        }
    }

    /// Follow this budget's stage changes.
    pub(crate) fn observe(&self, observer: Observer) {
        *self.observer.lock().unwrap_or_else(|e| e.into_inner()) = Some(observer);
    }

    /// Ask `admission` before every later request, pause and cleanup.
    pub(crate) fn attach_admission(&self, admission: Admission) {
        *self.admission.lock().unwrap_or_else(|e| e.into_inner()) = Some(admission);
    }

    pub(crate) fn total(&self) -> Duration {
        self.total
    }

    pub(crate) fn elapsed(&self) -> Duration {
        (self.now)().saturating_duration_since(self.started)
    }

    pub(crate) fn remaining(&self) -> Duration {
        self.total.saturating_sub(self.elapsed())
    }

    /// The timeout for the next request: what remains, or `None` if nothing does.
    pub(crate) fn request_timeout(&self) -> Option<Duration> {
        let remaining = self.remaining();
        (!remaining.is_zero()).then_some(remaining)
    }

    /// Bound all awaits, including joining another preparation and cleanup.
    pub(crate) async fn run<F: Future>(&self, work: F) -> Result<F::Output, ()> {
        let remaining = self.request_timeout().ok_or(())?;
        let answer = tokio::time::timeout(remaining, work)
            .await
            .map_err(|_| ())?;
        if self.remaining().is_zero() {
            Err(())
        } else {
            Ok(answer)
        }
    }

    /// May the next request be sent? Asked immediately before each request.
    pub(crate) fn admit(&self) -> bool {
        let admission = self
            .admission
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        match admission {
            Some(admission) => admission(),
            None => true,
        }
    }

    /// Whether this generation has been cancelled (no longer admitted).
    pub(crate) fn cancelled(&self) -> bool {
        !self.admit()
    }

    /// Pause, but only if the pause and a little room for the next request
    /// fit in what remains. `false`: not taken, because it would not fit.
    pub(crate) async fn pause(&self, pause: Duration) -> bool {
        // A request needs at least a moment of its own after the pause.
        let needed = pause.saturating_add(Duration::from_millis(250));
        if self.cancelled() || needed >= self.remaining() {
            return false;
        }
        self.at(Stage::Pausing);
        (self.sleep)(pause).await;
        true
    }

    /// Count a generation request about to be made; `None` if none may be.
    pub(crate) fn start_attempt(&self) -> Option<u32> {
        let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        if *attempts >= MAX_GENERATION_ATTEMPTS {
            return None;
        }
        *attempts += 1;
        Some(*attempts)
    }

    pub(crate) fn attempts(&self) -> u32 {
        *self.attempts.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn at(&self, stage: Stage) {
        let changed = {
            let mut trace = self.trace.lock().unwrap_or_else(|e| e.into_inner());
            let changed = trace.stage != stage;
            trace.stage = stage;
            changed
        };
        if changed {
            let observer = self
                .observer
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if let Some(observer) = observer {
                observer(stage, self.attempts());
            }
        }
    }

    pub(crate) fn stage(&self) -> Stage {
        self.trace.lock().unwrap_or_else(|e| e.into_inner()).stage
    }

    pub(crate) fn saw_status(&self, status: u16) {
        self.trace
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .last_status = Some(status);
    }

    pub(crate) fn categorize(&self, category: &'static str) {
        self.trace
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .category = Some(category);
    }

    /// One sanitized line for the failure message: what was happening, not
    /// what was sent.
    pub(crate) fn details(&self, reference: Option<&str>) -> String {
        let trace = self.trace.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let seconds = self.elapsed().as_secs();
        let mut parts = vec![
            format!("stage: {}", trace.stage.label()),
            format!("generation attempts: {}", self.attempts()),
            format!("time: {}m {:02}s", seconds / 60, seconds % 60),
        ];
        if let Some(category) = trace.category {
            parts.insert(0, category.to_string());
        }
        if let Some(status) = trace.last_status {
            parts.push(format!("last status: {status}"));
        }
        if let Some(reference) = reference {
            parts.push(format!("reference: {reference}"));
        }
        format!("Details: {}.", parts.join("; "))
    }
}

/// A budget in words: "5 minutes", "90 seconds".
pub(crate) fn describe(total: Duration) -> String {
    let seconds = total.as_secs();
    if seconds >= 60 && seconds % 60 == 0 {
        let minutes = seconds / 60;
        format!("{minutes} minute{}", if minutes == 1 { "" } else { "s" })
    } else {
        format!("{seconds} second{}", if seconds == 1 { "" } else { "s" })
    }
}

/// Retry-After supports delta seconds and the standard HTTP-date form.
/// Dates use the wall clock only to compute a delay; the budget stays monotonic.
pub(crate) fn retry_after(value: Option<&str>) -> Option<Duration> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    retry_after_at(value, now)
}

fn retry_after_at(value: Option<&str>, now: u64) -> Option<Duration> {
    let value = value?.trim();
    if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) {
        return value.parse::<u64>().ok().map(Duration::from_secs);
    }
    let parts: Vec<_> = value.split_whitespace().collect();
    if parts.len() != 6
        || !["Mon,", "Tue,", "Wed,", "Thu,", "Fri,", "Sat,", "Sun,"].contains(&parts[0])
        || parts[5] != "GMT"
        || parts[1].len() != 2
        || parts[3].len() != 4
        || parts[4].len() != 8
    {
        return None;
    }
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .iter()
    .position(|m| *m == parts[2])?
        + 1;
    let year: u32 = parts[3].parse().ok()?;
    let day: u32 = parts[1].parse().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][month - 1];
    if day == 0 || day > max_day {
        return None;
    }
    let timestamp = crate::gemini_files::parse_rfc3339(&format!(
        "{}-{:02}-{}T{}Z",
        parts[3], month, parts[1], parts[4]
    ))?;
    Some(Duration::from_secs(
        u64::try_from(timestamp).ok()?.saturating_sub(now),
    ))
}

#[cfg(test)]
pub(crate) mod testing {
    //! A budget on a fake clock: pauses advance the clock instantly and are
    //! recorded, so the policy can be tested without waiting.
    use super::*;

    pub(crate) struct FakeTime {
        pub base: Instant,
        pub offset: Mutex<Duration>,
        pub pauses: Mutex<Vec<Duration>>,
    }

    impl FakeTime {
        pub(crate) fn advance(&self, by: Duration) {
            *self.offset.lock().unwrap() += by;
        }
    }

    pub(crate) fn fake_budget(total: Duration) -> (Budget, Arc<FakeTime>) {
        let time = Arc::new(FakeTime {
            base: Instant::now(),
            offset: Mutex::new(Duration::ZERO),
            pauses: Mutex::new(Vec::new()),
        });
        let now_time = time.clone();
        let sleep_time = time.clone();
        let budget = Budget::with(
            total,
            Arc::new(move || now_time.base + *now_time.offset.lock().unwrap()),
            Arc::new(move |d| {
                sleep_time.pauses.lock().unwrap().push(d);
                sleep_time.advance(d);
                Box::pin(async {})
            }),
        );
        (budget, time)
    }
}

#[cfg(test)]
mod tests {
    use super::testing::fake_budget;
    use super::*;

    #[test]
    fn remaining_time_never_resets_across_stages_or_attempts() {
        let (budget, time) = fake_budget(Duration::from_secs(300));
        time.advance(Duration::from_secs(200));
        budget.at(Stage::Generating);
        assert_eq!(budget.start_attempt(), Some(1));
        assert_eq!(budget.request_timeout(), Some(Duration::from_secs(100)));
        time.advance(Duration::from_secs(100));
        assert_eq!(budget.request_timeout(), None);
        assert!(!tauri::async_runtime::block_on(
            budget.pause(Duration::ZERO)
        ));
    }

    #[test]
    fn automatic_attempt_limit_is_shared_not_per_model() {
        let (budget, _) = fake_budget(Duration::from_secs(300));
        assert_eq!(budget.start_attempt(), Some(1));
        assert_eq!(budget.start_attempt(), Some(2));
        assert_eq!(budget.start_attempt(), Some(3));
        assert_eq!(budget.start_attempt(), None);
    }

    #[test]
    fn retry_after_accepts_seconds_and_http_dates_and_handles_invalid_input() {
        let now = 1_700_000_000;
        assert_eq!(retry_after_at(Some("7"), now), Some(Duration::from_secs(7)));
        assert_eq!(
            retry_after_at(Some("Tue, 14 Nov 2023 22:13:30 GMT"), now),
            Some(Duration::from_secs(10))
        );
        assert_eq!(
            retry_after_at(Some("Tue, 14 Nov 2023 22:13:00 GMT"), now),
            Some(Duration::ZERO)
        );
        for invalid in [
            "-1",
            "1.5",
            "NaN",
            "",
            "garbage",
            "Tue, 14 Nov 2023 88:00:00 GMT",
            "Tue, 31 Feb 2023 22:13:20 GMT",
        ] {
            assert_eq!(retry_after_at(Some(invalid), now), None);
        }
    }

    #[test]
    fn timeout_guard_covers_an_await_with_no_http_timeout() {
        let budget = Budget::new(Duration::from_millis(20));
        let answer = tauri::async_runtime::block_on(budget.run(std::future::pending::<()>()));
        assert!(answer.is_err());
    }

    #[test]
    fn delays_consume_the_same_budget_and_require_room_to_continue() {
        let (budget, time) = fake_budget(Duration::from_secs(3));
        assert!(tauri::async_runtime::block_on(
            budget.pause(Duration::from_secs(2))
        ));
        assert_eq!(budget.remaining(), Duration::from_secs(1));
        assert!(!tauri::async_runtime::block_on(
            budget.pause(Duration::from_secs(1))
        ));
        assert_eq!(*time.pauses.lock().unwrap(), vec![Duration::from_secs(2)]);
    }
}
