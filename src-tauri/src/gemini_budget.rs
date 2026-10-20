//! Stage-aware deadlines within one immutable 900-second invocation budget.
//! Legacy journal policies retain their frozen total allowance.

const PROCESSING_SECONDS: u64 = 120;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The active budget for one generation, upload included.
pub(crate) const ACTIVE_BUDGET: Duration = Duration::from_secs(900);
/// How long to wait for a connection to Google before calling it unreachable.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Generation requests per generation, the backup model included.
pub(crate) const MAX_GENERATION_ATTEMPTS: u32 = 3;
/// Existing reservation/checkpoint refusal wording, shared by the timing guard.
pub(crate) const CHECKPOINT_FAILED: &str = "The job reached its request allowance, or its request reservation could not be kept. The earlier draft is kept; nothing was published.";

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
    limit: Arc<Mutex<Limit>>,
    now: Now,
    sleep: Sleep,
    attempts: Mutex<u32>,
    allocator: Mutex<Option<AttemptAllocator>>,
    trace: Mutex<Trace>,
    /// Told each time the stage changes, with the attempts made so far
    /// (GEN-REL-04's progress). Called outside every lock.
    observer: Mutex<Option<Observer>>,
    /// Whether this job may still send a request (GEN-REL-04): the journal's
    /// answer, asked immediately before every request, pause and cleanup, so
    /// a cancel recorded before the next submission prevents it, however far
    /// one poll of the work runs.
    admission: Mutex<Option<Admission>>,
    probe: Mutex<Option<Admission>>,
    stages: Mutex<StageClock>,
}

/// Versioned metadata lives only in this job's journal draft. UTC is millis.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Timing {
    policy: String,
    ceiling_millis: u64,
    allowed_millis: u64,
    remaining_millis: u64,
    deadline_utc: u64,
    upload_bytes: u64,
    sample_millis: u64,
    sample_bytes: u64,
    #[serde(default)]
    active_stage: String,
    #[serde(default)]
    stages: std::collections::BTreeMap<String, StageTiming>,
}
type TimingWriter = Arc<dyn Fn(&serde_json::Value) -> bool + Send + Sync>;
struct Limit {
    allowed: Duration,
    deadline: Option<Instant>,
    timing: Option<Timing>,
    writer: Option<TimingWriter>,
    frozen: bool,
    stage_policy: bool,
}
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StageTiming {
    elapsed_millis: u64,
    remaining_millis: u64,
}
struct StageClock {
    active: Stage,
    segment: Instant,
    deadline: Option<Instant>,
    processing: Option<Instant>,
    elapsed: std::collections::BTreeMap<String, u64>,
    scale: f64,
}
impl StageClock {
    fn duration(&self, seconds: u64) -> Duration {
        Duration::from_secs_f64(seconds as f64 * self.scale)
    }
    fn boundary(&self, stage: Stage) -> Option<Duration> {
        Some(self.duration(match stage {
            Stage::Uploading | Stage::CheckingFile | Stage::Reading => 60,
            Stage::WaitingForFile => PROCESSING_SECONDS,
            Stage::Generating => 480,
            Stage::Validating => 30,
            _ => return None,
        }))
    }
    fn remaining(&self, now: Instant, absolute: Duration) -> Duration {
        let mut left = self.deadline.map_or(absolute, |end| {
            end.saturating_duration_since(now).min(absolute)
        });
        if matches!(
            self.active,
            Stage::WaitingForFile | Stage::CheckingFile | Stage::Pausing
        ) {
            if let Some(end) = self.processing {
                left = left.min(end.saturating_duration_since(now));
            }
        }
        left
    }
}
fn wall_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn left(limit: &Limit, started: Instant, current: Instant) -> Duration {
    let remaining = limit
        .allowed
        .saturating_sub(current.saturating_duration_since(started));
    limit.deadline.map_or(remaining, |end| {
        remaining.min(end.saturating_duration_since(current))
    })
}

pub(crate) type Admission = Arc<dyn Fn() -> bool + Send + Sync>;

pub(crate) type AttemptAllocator = Arc<dyn Fn() -> Option<u32> + Send + Sync>;

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
            limit: Arc::new(Mutex::new(Limit {
                allowed: total.min(ACTIVE_BUDGET),
                deadline: None,
                timing: None,
                writer: None,
                frozen: false,
                stage_policy: true,
            })),
            now: now.clone(),
            sleep,
            attempts: Mutex::new(0),
            allocator: Mutex::new(None),
            trace: Mutex::new(Trace {
                stage: Stage::Preparing,
                last_status: None,
                category: None,
            }),
            observer: Mutex::new(None),
            admission: Mutex::new(None),
            probe: Mutex::new(None),
            stages: Mutex::new(StageClock {
                active: Stage::Preparing,
                segment: now(),
                deadline: None,
                processing: None,
                elapsed: Default::default(),
                scale: 1.0,
            }),
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

    /// Sampling checks cancellation without spending a dispatch reservation.
    pub(crate) fn attach_probe(&self, probe: Admission) {
        *self.probe.lock().unwrap_or_else(|e| e.into_inner()) = Some(probe);
    }
    pub(crate) fn can_continue(&self) -> bool {
        let probe = self.probe.lock().unwrap_or_else(|e| e.into_inner()).clone();
        probe.map_or_else(|| self.admit(), |probe| probe())
    }

    pub(crate) fn producer_probe(&self) -> Admission {
        self.probe
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .or_else(|| {
                self.admission
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
            })
            .unwrap_or_else(|| Arc::new(|| true))
    }
    pub(crate) fn validation_checkpoint(&self) -> Result<(), String> {
        if !self.can_continue() {
            return Err(crate::gemini_cancel::CANCELLED.into());
        }
        if self.request_timeout().is_none() {
            return Err(crate::gemini_files::out_of_time(
                self,
                "checking Gemini's answer",
            ));
        }
        if !self.checkpoint() {
            return Err(CHECKPOINT_FAILED.into());
        }
        Ok(())
    }
    pub(crate) fn total(&self) -> Duration {
        self.limit.lock().unwrap_or_else(|e| e.into_inner()).allowed
    }

    pub(crate) fn elapsed(&self) -> Duration {
        (self.now)().saturating_duration_since(self.started)
    }

    pub(crate) fn shorten(&self, remaining: Duration) {
        let mut limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
        let end = (self.now)() + remaining;
        limit.deadline = Some(limit.deadline.map_or(end, |prior| prior.min(end)));
    }

    pub(crate) fn remaining(&self) -> Duration {
        left(
            &self.limit.lock().unwrap_or_else(|e| e.into_inner()),
            self.started,
            (self.now)(),
        )
    }

    /// One absolute clock shared by every request reservation and checkpoint.
    pub(crate) fn remaining_clock(&self) -> impl Fn() -> Duration + Send + Sync + 'static {
        let (now, started, limit) = (self.now.clone(), self.started, self.limit.clone());
        move || {
            left(
                &limit.lock().unwrap_or_else(|e| e.into_inner()),
                started,
                now(),
            )
        }
    }

    fn remaining_unlocked(&self, limit: &Limit) -> Duration {
        left(limit, self.started, (self.now)())
    }
    pub(crate) fn stage_policy(&self) -> bool {
        self.limit
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stage_policy
    }
    pub(crate) fn enable_stages(&self, writer: TimingWriter) -> bool {
        {
            let mut limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
            if limit.frozen {
                limit.writer = Some(writer);
                drop(limit);
                return self.checkpoint();
            }
            limit.stage_policy = true;
            let allowed = limit.allowed.as_millis() as u64;
            limit.timing = Some(Timing {
                policy: "stage-v1".into(),
                ceiling_millis: allowed.min(900_000),
                allowed_millis: allowed.min(900_000),
                remaining_millis: self.total_remaining(&limit),
                deadline_utc: wall_millis().saturating_add(self.total_remaining(&limit)),
                upload_bytes: 0,
                sample_millis: 0,
                sample_bytes: 0,
                active_stage: self.stage().key().into(),
                stages: Default::default(),
            });
            limit.writer = Some(writer);
        }
        self.checkpoint()
    }
    /// Persist before dispatch/checkpoints. A failed write stops work, never grants time.
    pub(crate) fn persist_timing(&self) -> bool {
        let writer = self
            .limit
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .writer
            .clone();
        writer.map_or(true, |writer| writer(&self.timing_value()))
    }
    pub(crate) fn checkpoint(&self) -> bool {
        if !self.can_continue() || self.remaining().is_zero() {
            return false;
        }
        self.persist_timing() && self.can_continue() && !self.remaining().is_zero()
    }
    #[cfg(test)]
    pub(crate) fn scale_stages(&self, scale: f64) {
        self.stages.lock().unwrap().scale = scale;
    }
    /// Start a fresh admitted attempt or reset only a positive-byte inactivity timer.
    pub(crate) fn reset_stage(&self, stage: Stage) {
        self.at(stage);
        let mut clock = self.stages.lock().unwrap_or_else(|e| e.into_inner());
        clock.deadline = clock
            .boundary(stage)
            .map(|duration| (self.now)() + duration);
    }
    pub(crate) fn control_timeout(&self) -> Option<Duration> {
        let remaining = self.request_timeout()?;
        let control = self
            .stages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .duration(60);
        Some(if self.stage_policy() {
            remaining.min(control)
        } else {
            remaining
        })
    }
    pub(crate) async fn guard_stage<F: Future>(&self, work: F) -> Result<F::Output, ()> {
        self.run(async {
            let mut work = std::pin::pin!(work);
            let mut timer = Box::pin(tokio::time::sleep(Duration::ZERO));
            std::future::poll_fn(|cx| {
                if !self.can_continue() || self.request_timeout().is_none() {
                    return std::task::Poll::Ready(Err(()));
                }
                if let std::task::Poll::Ready(value) = work.as_mut().poll(cx) {
                    return std::task::Poll::Ready(
                        if self.can_continue() && self.request_timeout().is_some() {
                            Ok(value)
                        } else {
                            Err(())
                        },
                    );
                }
                if timer.as_mut().poll(cx).is_ready() {
                    timer.as_mut().reset(
                        tokio::time::Instant::now()
                            + self
                                .request_timeout()
                                .unwrap_or_default()
                                .min(Duration::from_millis(10)),
                    );
                    let _ = timer.as_mut().poll(cx);
                }
                std::task::Poll::Pending
            })
            .await
        })
        .await?
    }

    #[cfg(test)]
    pub(crate) fn enable_rate(&self, writer: TimingWriter) {
        let mut limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
        if limit.frozen || limit.timing.is_some() {
            return;
        }
        limit.stage_policy = false;
        let allowed = limit.allowed.as_millis() as u64;
        let timing = Timing {
            policy: "measured-rate-v1".into(),
            ceiling_millis: (allowed * 2).min(600_000),
            allowed_millis: allowed,
            remaining_millis: self.total_remaining(&limit),
            deadline_utc: wall_millis()
                .saturating_add(allowed.saturating_sub(self.elapsed().as_millis() as u64)),
            upload_bytes: 0,
            sample_millis: 0,
            sample_bytes: 0,
            active_stage: String::new(),
            stages: Default::default(),
        };
        if writer(&serde_json::to_value(&timing).expect("timing serializes")) {
            limit.timing = Some(timing);
            limit.writer = Some(writer);
        }
    }
    fn total_remaining(&self, limit: &Limit) -> u64 {
        left(limit, self.started, (self.now)()).as_millis() as u64
    }
    pub(crate) fn timing_value(&self) -> serde_json::Value {
        let limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
        match limit.timing.clone() {
            Some(mut timing) => {
                timing.remaining_millis = self.total_remaining(&limit);
                if limit.stage_policy {
                    let now = (self.now)();
                    let stages = self.stages.lock().unwrap_or_else(|e| e.into_inner());
                    timing.active_stage = stages.active.key().into();
                    for stage in [
                        Stage::Preparing,
                        Stage::Uploading,
                        Stage::WaitingForFile,
                        Stage::CheckingFile,
                        Stage::Generating,
                        Stage::Reading,
                        Stage::Validating,
                        Stage::Pausing,
                    ] {
                        let elapsed = stages.elapsed.get(stage.key()).copied().unwrap_or(0)
                            + if stages.active == stage {
                                now.saturating_duration_since(stages.segment).as_millis() as u64
                            } else {
                                0
                            };
                        let remaining = if stage == stages.active {
                            stages.remaining(now, self.remaining_unlocked(&limit))
                        } else if stage == Stage::WaitingForFile {
                            stages
                                .processing
                                .map_or(stages.duration(PROCESSING_SECONDS), |end| {
                                    end.saturating_duration_since(now)
                                })
                        } else {
                            stages
                                .boundary(stage)
                                .unwrap_or(self.remaining_unlocked(&limit))
                        };
                        timing.stages.insert(
                            stage.key().into(),
                            StageTiming {
                                elapsed_millis: elapsed,
                                remaining_millis: remaining
                                    .min(self.remaining_unlocked(&limit))
                                    .as_millis()
                                    as u64,
                            },
                        );
                    }
                }
                serde_json::to_value(timing).expect("timing serializes")
            }
            None => serde_json::Value::Null,
        }
    }
    pub(crate) fn restore_timing_value(&self, value: &serde_json::Value, wall_now: u64) {
        let mut limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
        limit.frozen = true; // Also freeze legacy/unknown drafts; never upgrade.
        limit.stage_policy = false;
        if let Ok(mut timing) = serde_json::from_value::<Timing>(value.clone()) {
            let cap = if timing.policy == "stage-v1" {
                900_000
            } else {
                600_000
            };
            limit.stage_policy = timing.policy == "stage-v1";
            let remaining = timing
                .remaining_millis
                .min(timing.deadline_utc.saturating_sub(wall_now))
                .min(timing.allowed_millis)
                .min(timing.ceiling_millis)
                .min(cap);
            timing.remaining_millis = remaining;
            limit.allowed = Duration::from_millis(timing.allowed_millis.min(cap));
            let end = (self.now)() + Duration::from_millis(remaining);
            limit.deadline = Some(limit.deadline.map_or(end, |prior| prior.min(end)));
            if limit.stage_policy {
                let now = (self.now)();
                let mut stages = self.stages.lock().unwrap_or_else(|e| e.into_inner());
                let active_key = stages.active.key().to_string();
                let elapsed = now.saturating_duration_since(stages.segment).as_millis() as u64;
                *stages.elapsed.entry(active_key).or_default() += elapsed;
                stages.segment = now;
                for (stage, saved) in &timing.stages {
                    let prior = stages.elapsed.entry(stage.clone()).or_default();
                    *prior = (*prior).max(saved.elapsed_millis);
                }
                if let Some(saved) = timing.stages.get("waiting-for-file") {
                    if saved.elapsed_millis > 0
                        || timing.active_stage == "waiting-for-file"
                        || timing.active_stage == "checking-file"
                    {
                        let end = now
                            + Duration::from_millis(saved.remaining_millis)
                                .min(stages.duration(PROCESSING_SECONDS));
                        stages.processing = Some(stages.processing.map_or(end, |old| old.min(end)));
                    }
                }
                // Reopening never resets the interrupted stage's remaining time.
                let active = [
                    Stage::Preparing,
                    Stage::Uploading,
                    Stage::WaitingForFile,
                    Stage::CheckingFile,
                    Stage::Generating,
                    Stage::Reading,
                    Stage::Validating,
                    Stage::Pausing,
                ]
                .into_iter()
                .find(|s| s.key() == timing.active_stage);
                if let Some(active) = active {
                    if let Some(saved) = timing.stages.get(active.key()) {
                        let end = now
                            + Duration::from_millis(saved.remaining_millis)
                                .min(Duration::from_millis(remaining));
                        stages.deadline = Some(stages.deadline.map_or(end, |old| old.min(end)));
                        stages.active = active;
                        stages.segment = now;
                    }
                }
            }
            limit.timing = Some(timing);
        } else {
            limit.allowed = limit.allowed.min(Duration::from_secs(300));
        }
    }
    pub(crate) fn restore_draft(&self, value: &serde_json::Value) {
        self.restore_timing_value(&value["timing"], wall_millis());
    }
    /// Legacy FIX-1 instrumentation. Restored drafts are frozen; stage-v1 never extends.
    pub(crate) fn rate_sample(&self, elapsed: Duration, bytes: u64, upload_total: u64) -> bool {
        if !self.can_continue() || self.remaining().is_zero() {
            return false;
        }
        {
            let mut limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
            if limit.frozen || limit.stage_policy {
                return true;
            }
            let Some(mut timing) = limit.timing.clone() else {
                return true;
            };
            let ms = elapsed.as_millis() as u64;
            if ms > 0 && ms.saturating_sub(timing.sample_millis) < 1000 {
                return true;
            }
            let window = ms.saturating_sub(timing.sample_millis);
            let delta = bytes.saturating_sub(timing.sample_bytes);
            let trusted =
                ms >= 1000 && bytes >= 65536 && bytes <= upload_total && delta > 0 && window > 0;
            let desired = if trusted {
                let rate = 0.8
                    * (bytes as f64 / elapsed.as_secs_f64())
                        .min(delta as f64 / (window as f64 / 1000.0));
                (self.elapsed().as_secs_f64() + (upload_total - bytes) as f64 / rate + 210.0).ceil()
                    * 1000.0
            } else {
                timing.ceiling_millis as f64
            };
            let allowed = (desired as u64).clamp(timing.allowed_millis, timing.ceiling_millis);
            timing.allowed_millis = allowed;
            timing.remaining_millis = allowed.saturating_sub(self.elapsed().as_millis() as u64);
            // Derive from the original monotonic start, including after a wall-clock change.
            timing.deadline_utc = timing
                .deadline_utc
                .saturating_add(allowed.saturating_sub(limit.allowed.as_millis() as u64));
            timing.upload_bytes = upload_total;
            timing.sample_millis = ms;
            timing.sample_bytes = bytes;
            if let Some(writer) = &limit.writer {
                if writer(&serde_json::to_value(&timing).expect("timing serializes")) {
                    limit.allowed = Duration::from_millis(allowed);
                    limit.timing = Some(timing);
                }
            }
        }
        self.can_continue()
    }

    /// Upload requests may span a rate sample. The live guard enforces the
    /// selected allowance; reqwest's immutable timeout is only the absolute cap.
    pub(crate) fn upload_timeout(&self) -> Option<Duration> {
        let limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
        let remaining = if limit.writer.is_some() && !limit.frozen {
            Duration::from_millis(limit.timing.as_ref()?.ceiling_millis)
                .saturating_sub(self.elapsed())
        } else {
            left(&limit, self.started, (self.now)())
        };
        (!remaining.is_zero()).then_some(remaining)
    }
    pub(crate) async fn during_upload<F: Future>(
        &self,
        work: F,
        started: Duration,
        bytes: &AtomicU64,
        total: u64,
    ) -> Result<F::Output, ()> {
        if self.stage_policy() {
            self.reset_stage(Stage::Uploading);
            let mut work = std::pin::pin!(work);
            let mut last = 0;
            return self
                .guard_stage(std::future::poll_fn(|cx| {
                    let result = work.as_mut().poll(cx);
                    let sent = bytes.load(Ordering::Relaxed);
                    if sent > last {
                        last = sent;
                        self.reset_stage(Stage::Uploading); // final byte starts the 60 s finalize wait
                        let mut limit = self.limit.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(timing) = &mut limit.timing {
                            timing.upload_bytes = total;
                            timing.sample_bytes = sent;
                            timing.sample_millis =
                                self.elapsed().saturating_sub(started).as_millis() as u64;
                        }
                    }
                    result
                }))
                .await;
        }
        let mut work = std::pin::pin!(work);
        let mut timer = Box::pin(tokio::time::sleep(Duration::from_secs(1)));
        let mut sampled = false;
        self.run(std::future::poll_fn(|cx| {
            if timer.as_mut().poll(cx).is_ready() {
                let sent = bytes.load(Ordering::Relaxed);
                // All bytes polled before the first tick means socket buffering,
                // not a measured transfer window. Use the unknown-rate fallback.
                let elapsed = if !sampled && sent == total {
                    Duration::ZERO
                } else {
                    self.elapsed().saturating_sub(started)
                };
                if !self.rate_sample(elapsed, sent, total) {
                    return std::task::Poll::Ready(Err(()));
                }
                sampled = true;
                timer
                    .as_mut()
                    .reset(tokio::time::Instant::now() + Duration::from_secs(1));
                let _ = timer.as_mut().poll(cx);
            }
            match work.as_mut().poll(cx) {
                std::task::Poll::Ready(result) => {
                    if !sampled
                        && !self.rate_sample(Duration::ZERO, bytes.load(Ordering::Relaxed), total)
                    {
                        return std::task::Poll::Ready(Err(()));
                    }
                    std::task::Poll::Ready(Ok(result))
                }
                std::task::Poll::Pending => std::task::Poll::Pending,
            }
        }))
        .await?
    }

    /// The timeout for the next request: what remains, or `None` if nothing does.
    pub(crate) fn request_timeout(&self) -> Option<Duration> {
        let mut remaining = self.remaining();
        if self.stage_policy() {
            remaining = self
                .stages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remaining((self.now)(), remaining);
        }
        (!remaining.is_zero()).then_some(remaining)
    }

    /// Bound all awaits, including joining another preparation and cleanup.
    pub(crate) async fn run<F: Future>(&self, work: F) -> Result<F::Output, ()> {
        let mut work = std::pin::pin!(work);
        let mut timer = Box::pin(tokio::time::sleep(Duration::ZERO));
        std::future::poll_fn(|cx| {
            if !self.can_continue() || self.remaining().is_zero() {
                return std::task::Poll::Ready(Err(()));
            }
            if let std::task::Poll::Ready(answer) = work.as_mut().poll(cx) {
                return std::task::Poll::Ready(
                    if !self.can_continue() || self.remaining().is_zero() {
                        Err(())
                    } else {
                        Ok(answer)
                    },
                );
            }
            if timer.as_mut().poll(cx).is_ready() {
                timer.as_mut().reset(
                    tokio::time::Instant::now() + self.remaining().min(Duration::from_millis(50)),
                );
                let _ = timer.as_mut().poll(cx);
            }
            std::task::Poll::Pending
        })
        .await
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
        if self.stage() != Stage::WaitingForFile {
            self.at(Stage::Pausing);
        }
        self.guard_stage((self.sleep)(pause)).await.is_ok()
    }

    pub(crate) fn restore_attempts(&self, count: u32) {
        *self.attempts.lock().unwrap_or_else(|e| e.into_inner()) = count;
    }

    pub(crate) fn allocate_with(&self, allocator: AttemptAllocator) {
        *self.allocator.lock().unwrap_or_else(|e| e.into_inner()) = Some(allocator);
    }

    /// Count a generation request about to be made; `None` if none may be.
    pub(crate) fn start_attempt(&self) -> Option<u32> {
        let allocator = self
            .allocator
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(allocator) = allocator {
            let local = allocator()?;
            *self.attempts.lock().unwrap_or_else(|e| e.into_inner()) += 1;
            return Some(local);
        }
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
        {
            let now = (self.now)();
            let mut clock = self.stages.lock().unwrap_or_else(|e| e.into_inner());
            if clock.active != stage {
                let previous = clock.active.key().to_string();
                let elapsed = now.saturating_duration_since(clock.segment).as_millis() as u64;
                *clock.elapsed.entry(previous).or_default() += elapsed;
                clock.active = stage;
                clock.segment = now;
                clock.deadline = clock.boundary(stage).map(|duration| now + duration);
                if stage == Stage::WaitingForFile && clock.processing.is_none() {
                    clock.processing = Some(now + clock.duration(PROCESSING_SECONDS));
                }
            }
        }
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

#[cfg(test)]
#[path = "gemini_rate_tests.rs"]
mod rate_tests;

#[cfg(test)]
#[path = "gemini_stage_tests.rs"]
mod stage_tests;
