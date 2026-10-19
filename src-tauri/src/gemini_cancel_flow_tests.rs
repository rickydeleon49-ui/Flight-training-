//! GEN-REL-04: cancelling a running generation, job-scoped progress, and the
//! GENREL03-R1 file-check diagnostics. Synthetic loopback HTTP and synthetic
//! sources only; each test has its own journal folder.

use std::sync::{Arc, Mutex};

use super::*;
use crate::fake_gemini::{FakeGemini, Gate};

const KEY: &str = "synthetic-cancel-key-not-a-real-credential";

struct JobRoot(std::path::PathBuf);

impl JobRoot {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-cancel-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        JobRoot(dir)
    }
}

impl Drop for JobRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn wait_for(f: impl Fn() -> bool) {
    for _ in 0..5_000 {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("timed out");
}

struct Rig {
    fake: FakeGemini,
    http: Client,
    cache: PreparedSources,
    root: JobRoot,
    said: Mutex<Vec<String>>,
    job_id: Mutex<Option<String>>,
    events: Arc<Mutex<Vec<GeminiProgress>>>,
}

fn rig(label: &str) -> Rig {
    Rig {
        fake: FakeGemini::start(),
        http: generation_client().unwrap(),
        cache: PreparedSources::new(
            gemini_files::Policy {
                poll_interval: Duration::from_millis(1),
                poll_cap: Duration::from_millis(2),
                max_polls: 3,
                delete_timeout: Duration::from_secs(2),
                ..gemini_files::Policy::default()
            },
            Arc::new(|| 1_700_000_000),
        ),
        root: JobRoot::new(label),
        said: Mutex::new(Vec::new()),
        job_id: Mutex::new(None),
        events: Arc::new(Mutex::new(Vec::new())),
    }
}

impl Rig {
    /// Run a cancellable, reported study-aid job exactly as the command does.
    fn run(&self, source: &LoadedSource) -> Result<JobAnswer<GeneratedStudyAid>, String> {
        let budget = Budget::new(Duration::from_secs(60));
        let events = self.events.clone();
        let reporter = Reporter::new(
            "mat-cancel",
            JobKind::StudyAid,
            Box::new(move |p| events.lock().unwrap().push(p)),
        );
        reporter.follow(&budget);
        let say = |m: String| {
            self.said.lock().unwrap().push(m.clone());
            reporter.say(m);
        };
        let started = |id: &str| {
            *self.job_id.lock().unwrap() = Some(id.to_string());
            reporter.started(id);
        };
        let ctx = GenContext {
            http: &self.http,
            base: &self.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &self.cache,
            epoch: self.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        tauri::async_runtime::block_on(as_job_with(
            &self.root.0,
            JobKind::StudyAid,
            "mat-cancel",
            None,
            source,
            study_aid_with(&ctx, source),
            &|_| {},
            JobHooks {
                started: Some(&started),
                cancellable: true,
                request_id: None,
                budget: None,
            },
        ))
    }

    fn job_id(&self) -> String {
        self.job_id.lock().unwrap().clone().unwrap()
    }

    fn cancel(&self) -> CancelOutcome {
        cancel_job(&self.root.0, &self.job_id(), &|_| {}).unwrap()
    }

    fn stage(&self) -> Option<JobStage> {
        let id = self.job_id();
        gemini_jobs::with(&self.root.0, |j| j.list())
            .into_iter()
            .find(|j| j.id == id)
            .map(|j| j.stage)
    }

    fn generations(&self) -> usize {
        self.fake.count(|r| r.is_generate())
    }
}

fn text() -> LoadedSource {
    LoadedSource::new(
        b"synthetic text only".to_vec(),
        "text/plain",
        "documents/c.txt",
    )
}

fn pdf() -> LoadedSource {
    LoadedSource::new(
        b"%PDF-synthetic-cancel".to_vec(),
        "application/pdf",
        "documents/c.pdf",
    )
}

#[test]
fn cancelling_while_gemini_works_stops_the_job_and_sends_nothing_more() {
    let r = rig("generating");
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.generate_gate = Some(gate.clone()));
    let src = text();
    std::thread::scope(|scope| {
        let running = scope.spawn(|| r.run(&src));
        wait_for(|| gate.waiting() == 1);
        assert_eq!(
            r.cancel(),
            CancelOutcome {
                cancelled: true,
                stage: Some(JobStage::Cancelled),
                pending: false
            }
        );
        let error = running.join().unwrap().unwrap_err();
        assert_eq!(error, gemini_cancel::CANCELLED);
        assert!(
            error.contains("may still have processed it"),
            "no false promise"
        );
        gate.open();
    });
    assert_eq!(r.stage(), Some(JobStage::Cancelled), "recorded durably");
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(r.generations(), 1, "no request after the cancel");
    let record = gemini_jobs::with(&r.root.0, |j| j.list())
        .into_iter()
        .find(|j| j.id == r.job_id())
        .unwrap();
    assert!(record.result.is_none(), "nothing was kept to save");
}

#[test]
fn cancelling_during_the_upload_never_reaches_generation() {
    let r = rig("uploading");
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let src = pdf();
    std::thread::scope(|scope| {
        let running = scope.spawn(|| r.run(&src));
        wait_for(|| gate.waiting() == 1);
        assert!(r.cancel().cancelled);
        assert_eq!(
            running.join().unwrap().unwrap_err(),
            gemini_cancel::CANCELLED
        );
        gate.open();
    });
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(r.generations(), 0);
    assert_eq!(r.stage(), Some(JobStage::Cancelled));
}

#[test]
fn cancelling_during_a_retry_pause_makes_no_further_attempt() {
    let r = rig("pausing");
    r.fake
        .behave(|b| b.generate_statuses = vec![(503, "{}".into())]);
    let src = text();
    std::thread::scope(|scope| {
        let running = scope.spawn(|| r.run(&src));
        wait_for(|| r.said.lock().unwrap().iter().any(|m| m.contains("Waiting")));
        let started = std::time::Instant::now();
        assert!(r.cancel().cancelled);
        assert_eq!(
            running.join().unwrap().unwrap_err(),
            gemini_cancel::CANCELLED
        );
        assert!(
            started.elapsed() < Duration::from_millis(900),
            "the pause is cut short, not waited out"
        );
    });
    std::thread::sleep(Duration::from_millis(1_800));
    assert_eq!(r.generations(), 1, "the pause led to no further attempt");
}

#[test]
fn a_job_that_finished_first_keeps_its_answer_and_cancel_says_so() {
    let r = rig("finished-first");
    let answer = r.run(&text()).unwrap();
    assert!(answer.checkpointed);
    assert_eq!(
        r.cancel(),
        CancelOutcome {
            cancelled: false,
            stage: Some(JobStage::Ready),
            pending: false
        }
    );
    assert_eq!(r.stage(), Some(JobStage::Ready));
}

#[test]
fn a_cancel_recorded_first_wins_over_an_answer_that_has_just_arrived() {
    let r = rig("cancel-first");
    let src = text();
    let budget = Budget::new(Duration::from_secs(60));
    let job_id = Mutex::new(None::<String>);
    let started = |id: &str| *job_id.lock().unwrap() = Some(id.to_string());
    let root = &r.root.0;
    let work = async {
        // The answer is ready, but in the same moment she cancels: the journal
        // records the cancel before the job can record its answer.
        let id = job_id.lock().unwrap().clone().unwrap();
        gemini_jobs::with(root, |j| j.cancel(&id)).unwrap();
        let say = |_m: String| {};
        let ctx = GenContext {
            http: &r.http,
            base: &r.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &r.cache,
            epoch: r.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        study_aid_with(&ctx, &src).await
    };
    let outcome = tauri::async_runtime::block_on(as_job_with(
        root,
        JobKind::StudyAid,
        "mat-cancel",
        None,
        &src,
        work,
        &|_| {},
        JobHooks {
            started: Some(&started),
            cancellable: false,
            request_id: None,
            budget: None,
        },
    ));
    assert_eq!(outcome.unwrap_err(), gemini_cancel::CANCELLED);
    let id = job_id.lock().unwrap().clone().unwrap();
    let record = gemini_jobs::with(root, |j| j.list())
        .into_iter()
        .find(|j| j.id == id)
        .unwrap();
    assert_eq!(record.stage, JobStage::Cancelled);
    assert!(record.result.is_none(), "the late answer was not kept");
}

#[test]
fn progress_names_its_job_and_reports_the_stages_actually_reached() {
    let r = rig("progress");
    r.run(&pdf()).unwrap();
    let events = r.events.lock().unwrap().clone();
    let id = r.job_id();
    assert!(!events.is_empty());
    assert!(events
        .iter()
        .all(|e| e.material_id == "mat-cancel" && e.kind == JobKind::StudyAid));
    // From the moment the job began, every event carries its id.
    let first_with_id = events.iter().position(|e| e.job_id.is_some()).unwrap();
    assert_eq!(events[first_with_id].stage, Some("preparing"));
    assert!(events[first_with_id..]
        .iter()
        .all(|e| e.job_id.as_deref() == Some(id.as_str())));
    let stages: Vec<&str> = events.iter().filter_map(|e| e.stage).collect();
    for expected in ["uploading", "generating", "reading"] {
        assert!(stages.contains(&expected), "{expected} in {stages:?}");
    }
    let order = |s: &str| stages.iter().position(|x| *x == s).unwrap();
    assert!(order("uploading") < order("generating") && order("generating") < order("reading"));
    assert!(events
        .iter()
        .all(|e| e.max_attempts == MAX_GENERATION_ATTEMPTS));
    let value = serde_json::to_value(&events[first_with_id]).unwrap();
    assert!(value.get("percent").is_none(), "no invented percentage");
    assert_eq!(value["jobId"], id.as_str());
}

#[test]
fn progress_counts_the_attempt_in_progress() {
    let r = rig("attempts");
    r.fake
        .behave(|b| b.generate_statuses = vec![(503, "{}".into())]);
    r.run(&text()).unwrap();
    let attempts: Vec<u32> = r
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e.stage == Some("generating"))
        .map(|e| e.attempt)
        .collect();
    assert_eq!(attempts, vec![1, 2]);
}

#[test]
fn r1_a_refused_file_check_names_its_own_stage_and_status() {
    let fake = FakeGemini::start();
    fake.behave(|b| b.lookup_status = Some(403));
    let budget = Budget::new(Duration::from_secs(60));
    budget.at(gemini_budget::Stage::Generating);
    budget.saw_status(503);
    let http = generation_client().unwrap();
    let outcome = tauri::async_runtime::block_on(gemini_files::lookup(
        &http,
        &fake.base,
        KEY,
        "files/synthetic-1",
        "application/pdf",
        &budget,
    ));
    assert!(outcome.is_err());
    let details = budget.details(None);
    assert!(
        details.contains("stage: checking the uploaded PDF"),
        "{details}"
    );
    assert!(details.contains("last status: 403"), "{details}");
}

/* ------------------------------------------------------------------ */
/* Review round 1 regressions (GENREL04-R1, R3)                        */
/* ------------------------------------------------------------------ */

/// Run a job whose work only records whether it was ever polled.
fn run_probe(
    root: &std::path::Path,
    request_id: Option<&str>,
    started: &(dyn Fn(&str) + Sync),
) -> (Result<JobAnswer<GeneratedStudyAid>, String>, bool) {
    let polled = std::sync::atomic::AtomicBool::new(false);
    let src = text();
    let work = async {
        polled.store(true, std::sync::atomic::Ordering::SeqCst);
        Err::<GeneratedStudyAid, String>("the work ran".to_string())
    };
    let outcome = tauri::async_runtime::block_on(as_job_with(
        root,
        JobKind::StudyAid,
        "mat-cancel",
        None,
        &src,
        work,
        &|_| {},
        JobHooks {
            started: Some(started),
            cancellable: true,
            request_id,
            budget: None,
        },
    ));
    (outcome, polled.load(std::sync::atomic::Ordering::SeqCst))
}

#[test]
fn r1_a_cancel_the_moment_the_job_is_announced_stops_it_before_any_work() {
    let root = JobRoot::new("r1-announce");
    let path = root.0.clone();
    let started = |id: &str| {
        assert!(cancel_job(&path, id, &|_| {}).unwrap().cancelled);
    };
    let (outcome, polled) = run_probe(&root.0, None, &started);
    assert_eq!(outcome.unwrap_err(), gemini_cancel::CANCELLED);
    assert!(!polled, "the work was never polled");
}

#[test]
fn r3_a_cancel_by_request_before_the_job_begins_is_held_and_nothing_is_sent() {
    let root = JobRoot::new("r3-pending");
    let outcome = cancel_request(&root.0, "req-early", &|_| {}).unwrap();
    assert_eq!(
        outcome,
        CancelOutcome {
            cancelled: false,
            stage: None,
            pending: true
        }
    );
    let (result, polled) = run_probe(&root.0, Some("req-early"), &|_| {});
    assert_eq!(result.unwrap_err(), gemini_cancel::CANCELLED);
    assert!(!polled, "nothing ran, so nothing was sent");
    assert!(
        gemini_jobs::with(&root.0, |j| j.list()).is_empty(),
        "no job was even recorded"
    );
    // The held cancel is used up: the same request id may run later.
    let again = std::sync::atomic::AtomicBool::new(false);
    let (_, polled) = run_probe(&root.0, Some("req-early"), &|_| {
        again.store(true, std::sync::atomic::Ordering::SeqCst)
    });
    assert!(again.load(std::sync::atomic::Ordering::SeqCst) && polled);
}

#[test]
fn r3_a_cancel_by_request_reaches_a_running_job_without_knowing_its_id() {
    let r = rig("r3-running");
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.generate_gate = Some(gate.clone()));
    let src = text();
    let budget = Budget::new(Duration::from_secs(60));
    std::thread::scope(|scope| {
        let running = scope.spawn(|| {
            let say = |_m: String| {};
            let ctx = GenContext {
                http: &r.http,
                base: &r.fake.base,
                api_key: KEY,
                choice: ModelChoice::Standard,
                cache: &r.cache,
                epoch: r.cache.epoch(),
                budget: &budget,
                say: &say,
            };
            tauri::async_runtime::block_on(as_job_with(
                &r.root.0,
                JobKind::StudyAid,
                "mat-cancel",
                None,
                &src,
                study_aid_with(&ctx, &src),
                &|_| {},
                JobHooks {
                    started: None,
                    cancellable: true,
                    request_id: Some("req-running"),
                    budget: None,
                },
            ))
        });
        wait_for(|| gate.waiting() == 1);
        let outcome = cancel_request(&r.root.0, "req-running", &|_| {}).unwrap();
        assert!(outcome.cancelled && !outcome.pending);
        assert_eq!(
            running.join().unwrap().unwrap_err(),
            gemini_cancel::CANCELLED
        );
        gate.open();
    });
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(r.generations(), 1);
}

#[test]
fn r3_a_cancel_by_request_after_the_job_finished_reports_its_outcome() {
    let root = JobRoot::new("r3-finished");
    let src = text();
    let answer = tauri::async_runtime::block_on(as_job_with(
        &root.0,
        JobKind::StudyAid,
        "mat-cancel",
        None,
        &src,
        async {
            serde_json::from_value::<GeneratedStudyAid>(serde_json::json!({
                "title": "Done", "summary": "", "sections": [], "flashcards": [], "sourceNotes": "", "model": ""
            }))
            .map_err(|e| e.to_string())
        },
        &|_| {},
        JobHooks {
            started: None,
            cancellable: true,
            request_id: Some("req-done"),
            budget: None,
        },
    ));
    assert!(answer.is_ok());
    let outcome = cancel_request(&root.0, "req-done", &|_| {}).unwrap();
    assert_eq!(
        outcome,
        CancelOutcome {
            cancelled: false,
            stage: Some(JobStage::Ready),
            pending: false
        }
    );
}

/* ------------------------------------------------------------------ */
/* Review round 2 regressions (GENREL04-R5)                            */
/* ------------------------------------------------------------------ */

/// Cancel the budget's token from inside the work, the moment it reaches
/// `at`, with no outer `Cancellable` to drop it: only the boundary check can
/// stop the next request.
fn cancel_at_stage(label: &str, source: LoadedSource, at: gemini_budget::Stage) -> (Rig, String) {
    let r = rig(label);
    let budget = Budget::new(Duration::from_secs(60));
    let token = Arc::new(gemini_cancel::CancelToken::default());
    let admitted = token.clone();
    budget.attach_admission(Arc::new(move || !admitted.is_cancelled()));
    budget.observe(Arc::new(move |stage, _| {
        if stage == at {
            token.cancel();
        }
    }));
    let say = |_m: String| {};
    let ctx = GenContext {
        http: &r.http,
        base: &r.fake.base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: r.cache.epoch(),
        budget: &budget,
        say: &say,
    };
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source)).unwrap_err();
    std::thread::sleep(Duration::from_millis(50));
    (r, error)
}

#[test]
fn r5_a_cancel_recorded_as_gemini_is_about_to_be_asked_prevents_the_request() {
    let (r, error) = cancel_at_stage("r5-generate", text(), gemini_budget::Stage::Generating);
    assert!(error.starts_with(gemini_cancel::CANCELLED), "{error}");
    assert_eq!(r.generations(), 0, "the request was never sent");
}

#[test]
fn r5_a_cancel_recorded_as_the_upload_begins_prevents_the_upload() {
    let (r, error) = cancel_at_stage("r5-upload", pdf(), gemini_budget::Stage::Uploading);
    assert!(error.starts_with(gemini_cancel::CANCELLED), "{error}");
    assert_eq!(
        r.fake.count(|q| q.is_upload_start()),
        0,
        "nothing was uploaded"
    );
    assert_eq!(r.generations(), 0);
}

/* ------------------------------------------------------------------ */
/* Review round 4 regressions (GENREL04-R9, R10)                       */
/* ------------------------------------------------------------------ */

/// Run a command-like job whose budget observer, at `at`, records a cancel
/// with `cancel` (given the root and the job id).
fn run_with_cancel_at(
    label: &str,
    source: LoadedSource,
    at: gemini_budget::Stage,
    cancel: fn(&std::path::Path, &str),
) -> (Rig, String) {
    let r = rig(label);
    let budget = Budget::new(Duration::from_secs(60));
    let job: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let root = r.root.0.clone();
    let seen = job.clone();
    budget.observe(Arc::new(move |stage, _| {
        if stage == at {
            if let Some(id) = seen.lock().unwrap().clone() {
                cancel(&root, &id);
            }
        }
    }));
    let started = |id: &str| *job.lock().unwrap() = Some(id.to_string());
    let say = |_m: String| {};
    let ctx = GenContext {
        http: &r.http,
        base: &r.fake.base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: r.cache.epoch(),
        budget: &budget,
        say: &say,
    };
    let error = tauri::async_runtime::block_on(as_job_with(
        &r.root.0,
        JobKind::StudyAid,
        "mat-cancel",
        None,
        &source,
        study_aid_with(&ctx, &source),
        &|_| {},
        JobHooks {
            started: Some(&started),
            cancellable: true,
            request_id: None,
            budget: Some(&budget),
        },
    ))
    .unwrap_err();
    std::thread::sleep(Duration::from_millis(50));
    (r, error)
}

#[test]
fn r9_once_the_journal_records_a_cancel_no_request_is_admitted_even_before_the_work_is_woken() {
    // The journal decision alone, with no token woken: as when a cancel found
    // no token yet and decided anyway.
    let (r, error) = run_with_cancel_at(
        "r9-unwoken",
        text(),
        gemini_budget::Stage::Generating,
        |root, id| {
            assert!(gemini_jobs::with(root, |j| j.cancel(id)).unwrap().cancelled);
        },
    );
    assert_eq!(error, gemini_cancel::CANCELLED);
    assert_eq!(r.generations(), 0, "no request after the recorded cancel");
}

#[test]
fn r10_a_cancel_at_a_fresh_uploads_readiness_check_sends_no_check_delete_or_generation() {
    let r = rig("r10-readiness");
    r.fake.behave(|b| {
        b.initial_state = "PROCESSING";
        b.polls_until_active = Some(5);
    });
    let budget = Budget::new(Duration::from_secs(60));
    let job: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let root = r.root.0.clone();
    let seen = job.clone();
    budget.observe(Arc::new(move |stage, _| {
        if stage == gemini_budget::Stage::CheckingFile {
            if let Some(id) = seen.lock().unwrap().clone() {
                assert!(cancel_job(&root, &id, &|_| {}).unwrap().cancelled);
            }
        }
    }));
    let started = |id: &str| *job.lock().unwrap() = Some(id.to_string());
    let say = |_m: String| {};
    let source = pdf();
    let ctx = GenContext {
        http: &r.http,
        base: &r.fake.base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: r.cache.epoch(),
        budget: &budget,
        say: &say,
    };
    let error = tauri::async_runtime::block_on(as_job_with(
        &r.root.0,
        JobKind::StudyAid,
        "mat-cancel",
        None,
        &source,
        study_aid_with(&ctx, &source),
        &|_| {},
        JobHooks {
            started: Some(&started),
            // No outer wrapper to drop the work: only admission can stop the
            // cleanup request.
            cancellable: false,
            request_id: None,
            budget: Some(&budget),
        },
    ))
    .unwrap_err();
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(error, gemini_cancel::CANCELLED);
    assert_eq!(
        r.fake.count(|q| q.is_upload_finalize()),
        1,
        "the upload itself happened first"
    );
    assert_eq!(r.fake.count(|q| q.is_lookup()), 0, "no readiness check");
    assert_eq!(
        r.fake.count(|q| q.is_delete()),
        0,
        "no cleanup request after the cancel"
    );
    assert_eq!(r.generations(), 0);
}
