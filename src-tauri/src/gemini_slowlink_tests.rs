//! GEN-FIX-2: the GEN-00 fixtures under stage-aware deadlines. Synthetic PDF/key,
//! the real study_aid_with -> run_generation -> generate_with_retries_at path,
//! and loopback HTTP, following gemini_generation_tests' GenContext harness.
//!
//! Link/deadline scale is 1:100: 3 s here = 300 s in the app; a 3.6 s
//! upload/thinking delay = 360 s; 100 bytes/s here = 1 byte/s unscaled for
//! the same payload. These small payloads isolate timing, not real Mbps.
//! Real monotonic/Tokio timers exercise reqwest send and body-transfer deadlines.
//! Elapsed assertions allow 1 s scheduler tolerance, never exact timings.
//! Production retry backoff is deliberately unchanged (1.5-1.875 real s).

use super::*;
use crate::fake_gemini::{Behaviour, FakeGemini};
use std::time::Instant;

const KEY: &str = "synthetic-slowlink-key-never-a-real-credential";
const TOTAL: Duration = Duration::from_secs(9);

fn stage_budget() -> Budget {
    let b = Budget::new(TOTAL);
    b.scale_stages(0.01);
    assert!(b.enable_stages(Arc::new(|_| true)));
    b
}

struct Rig {
    fake: FakeGemini,
    http: Client,
    cache: PreparedSources,
    source: LoadedSource,
}

fn rig() -> Rig {
    let fake = FakeGemini::start();
    // Fixed-size, valid envelope; the content is identical in all scenarios.
    let text = r#"{"title":"Synthetic airspace","summary":"Synthetic summary.","sections":[{"heading":"Class B","body":"Synthetic body."}],"flashcards":[],"sourceNotes":"Synthetic notes."}"#;
    let mut body = json!({"candidates":[{"content":{"parts":[{"text":text}]}}]}).to_string();
    assert!(body.len() < 400);
    body.extend(std::iter::repeat_n(' ', 400 - body.len()));
    fake.behave(|b| b.generate_answer = Some(body));
    Rig {
        fake,
        http: generation_client().unwrap(),
        cache: PreparedSources::new(gemini_files::Policy::default(), Arc::new(|| 1_700_000_000)),
        source: LoadedSource::new(
            generation_tests::pdf(2, "slowlink-synthetic"),
            "application/pdf",
            "documents/synthetic-slowlink.pdf",
        ),
    }
}

impl Rig {
    fn upload_for(&mut self, seconds: f64) {
        // Same synthetic two-page PDF, padded beyond socket buffers: FIX-2
        // measures producer progress, not the fake server's receipt of buffered bytes.
        self.source.bytes.resize(32 * 1024 * 1024, b' ');
        let rate = (self.source.bytes.len() as f64 / seconds) as u64;
        self.fake.behave(|b| b.upload_bytes_per_sec = Some(rate));
    }

    fn run(&self, budget: &Budget) -> Result<GeneratedStudyAid, String> {
        let ctx = GenContext {
            http: &self.http,
            base: &self.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &self.cache,
            epoch: self.cache.epoch(),
            budget,
            say: &|_| {},
        };
        tauri::async_runtime::block_on(study_aid_with(&ctx, &self.source))
    }

    fn success(&self, label: &str, attempts: usize) {
        let budget = stage_budget();
        let answer = self.run(&budget).unwrap();
        assert_eq!(answer.title, "Synthetic airspace", "{label}");
        assert_eq!(budget.stage(), Stage::Validating);
        assert_eq!(self.fake.count(|q| q.is_generate()), attempts);
        assert_eq!(self.fake.count(|q| q.is_upload_start()), 1);
        assert_eq!(self.fake.count(|q| q.is_upload_finalize()), 1);
        assert!(budget.elapsed() < budget.total());
    }

    fn failure(&self, label: &str, stage: Stage, attempts: usize) {
        let budget = stage_budget();
        let start = Instant::now();
        let error = self.run(&budget).unwrap_err();
        let elapsed = start.elapsed();
        assert_eq!(budget.stage(), stage, "{error}");
        // FIX-2: timeout text identifies the stalled stage, independently of the absolute cap.
        let expected = match stage {
            Stage::Generating => "Gemini is taking longer to answer. You can try again.",
            Stage::Reading => "The rest of the answer stopped arriving.",
            Stage::Uploading => "The upload stopped moving. Your saved work is still here.",
            _ => panic!("unexpected test stage"),
        };
        assert_eq!(error, expected);
        assert_eq!(self.fake.count(|r| r.is_generate()), attempts);
        assert_eq!(budget.attempts() as usize, attempts);
        // FIX-2: a stage stall can expire before the absolute cap.
        assert!(
            elapsed < budget.total() + Duration::from_secs(1),
            "{elapsed:?}"
        );
        println!("MEASURE {label} stage={} attempts={attempts} elapsed_ms={} unscaled_s={:.2} error={error}", stage.key(), elapsed.as_millis(), elapsed.as_secs_f64() * 100.0);
    }
}

#[test]
fn s1_upload_alone_succeeds_with_qualifying_allowance() {
    // FIX-2: moving upload bytes may consume 360 s without any 60 s stall.
    let mut r = rig();
    r.upload_for(3.6);
    r.success("S1-upload", 1);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
    // FIX-2: one moving upload completes within the immutable 900 s cap.
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}

#[test]
fn s1_upload_and_model_share_the_extended_allowance() {
    // FIX-2: 240 s upload + 120 s thinking share one immutable 900 s cap.
    let mut r = rig();
    r.upload_for(2.4);
    r.fake
        .behave(|b| b.generate_first_byte_delay = Some(Duration::from_millis(1200)));
    r.success("S1-remaining", 1);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}

#[test]
fn s2_headers_succeed_under_qualifying_allowance() {
    // FIX-2: 360 s thinking fits 480 s headers; no transfer-stall timer applies.
    let r = rig();
    r.fake
        .behave(|b| b.generate_first_byte_delay = Some(Duration::from_millis(3600)));
    r.success("S2", 1);
}

#[test]
fn s3_trickling_answer_succeeds_under_qualifying_allowance() {
    // FIX-2: a 400 s body succeeds because every inter-chunk gap is below 60 s.
    let r = rig();
    r.fake
        .behave(|b| b.generate_trickle_bytes_per_sec = Some(100));
    r.success("S3", 1);
}

fn replay_after_drop(label: &str, _stage: Stage, slow: impl FnOnce(&mut Behaviour)) {
    let r = rig();
    r.fake.behave(|b| {
        // An early truncated connection is retryable; a deadline is terminal.
        b.partial_generations = 1;
        slow(b);
    });
    // FIX-2: unchanged real 1.5–1.875 s backoff plus attempt two fit 9 s (900 s scaled).
    r.success(label, 2);
    let log = r.fake.log();
    let generations: Vec<_> = log.iter().filter(|q| q.is_generate()).collect();
    assert_eq!(
        generations[0].body, generations[1].body,
        "full request is replayed; no byte resume"
    );
    assert_eq!(
        r.fake.count(|q| q.is_upload_finalize()),
        1,
        "PDF is reused across retries"
    );
}

#[test]
fn s4_early_drop_replays_identical_request_and_headers_succeed() {
    // FIX-2: early drop + unscaled backoff + 360 s headers fit 900 s.
    replay_after_drop("S4-headers", Stage::Generating, |b| {
        b.generate_first_byte_delay = Some(Duration::from_millis(3600));
    });
}

#[test]
fn s4_early_drop_replays_identical_request_and_body_succeeds() {
    // FIX-2: early drop + unscaled backoff + 400 s moving body fit 900 s.
    replay_after_drop("S4-body", Stage::Reading, |b| {
        b.generate_trickle_bytes_per_sec = Some(100);
    });
}

#[test]
fn s5_identical_content_and_slow_numbers_succeed_with_a_larger_budget() {
    for (label, stage, seconds) in [
        ("S5-upload", Stage::Uploading, 3.6),
        ("S5-headers", Stage::Generating, 3.6),
        ("S5-body", Stage::Reading, 4.0),
    ] {
        let mut r = rig();
        match stage {
            Stage::Uploading => r.upload_for(seconds),
            Stage::Generating => r
                .fake
                .behave(|b| b.generate_first_byte_delay = Some(Duration::from_secs_f64(seconds))),
            Stage::Reading => r
                .fake
                .behave(|b| b.generate_trickle_bytes_per_sec = Some(100)),
            _ => unreachable!(),
        }
        let budget = stage_budget(); // FIX-2: S5 still succeeds with identical content under 900 s.
        let started = Instant::now();
        let answer = r.run(&budget).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(answer.title, "Synthetic airspace");
        assert_eq!(budget.stage(), Stage::Validating);
        assert_eq!(budget.attempts(), 1);
        assert_eq!(r.fake.count(|q| q.is_generate()), 1);
        assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
        assert!(
            elapsed >= Duration::from_secs_f64(seconds)
                && elapsed < Duration::from_secs_f64(seconds + 1.0),
            "{label}: {elapsed:?}"
        );
        println!(
            "MEASURE {label} stage=validating attempts=1 elapsed_ms={} unscaled_s={:.2} error=none",
            elapsed.as_millis(),
            elapsed.as_secs_f64() * 100.0
        );
    }
}

#[test]
fn s2_headers_481s_fail_in_generating_without_a_late_submission() {
    let r = rig();
    r.fake
        .behave(|b| b.generate_first_byte_delay = Some(Duration::from_millis(4810)));
    // FIX-2: 481 s exceeds the 480 s stage grace; existing timeout classification is terminal.
    r.failure("481s-headers", Stage::Generating, 1);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}

#[test]
fn one_upload_request_keeps_offset_length_bytes_and_one_finalization() {
    let mut r = rig();
    r.source.bytes.resize(600_000, b' ');
    let budget = Budget::new(Duration::from_secs(300));
    budget.enable_rate(Arc::new(|_| true));
    r.run(&budget).unwrap();
    let log = r.fake.log();
    let uploads: Vec<_> = log
        .iter()
        .filter(|q| q.header("x-goog-upload-offset").is_some())
        .collect();
    assert_eq!(uploads.len(), 1);
    let request = uploads[0];
    assert_eq!(request.header("x-goog-upload-offset"), Some("0"));
    assert_eq!(
        request.header("x-goog-upload-command"),
        Some("upload, finalize")
    );
    assert_eq!(
        request.header("content-length"),
        Some(r.source.bytes.len().to_string().as_str())
    );
    assert_eq!(request.body, r.source.bytes);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(r.fake.count(|q| q.is_generate()), 1);
}

#[test]
fn legacy_measured_rate_cached_pdf_keeps_initial_allowance_without_an_upload() {
    let r = rig();
    let first = Budget::new(Duration::from_secs(300));
    first.enable_rate(Arc::new(|_| true));
    r.run(&first).unwrap();
    assert_eq!(first.total().as_secs(), 600); // buffered upload: fallback
    let second = Budget::new(Duration::from_secs(300));
    second.enable_rate(Arc::new(|_| true));
    r.run(&second).unwrap();
    assert_eq!(second.total().as_secs(), 300);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(r.fake.count(|q| q.is_generate()), 2);
}

#[test]
fn legacy_cancellation_at_upload_sample_stops_the_body_and_prevents_generation() {
    let mut r = rig();
    r.source.bytes.resize(600_000, b' ');
    r.fake.behave(|b| b.upload_bytes_per_sec = Some(100_000));
    let budget = Budget::new(Duration::from_secs(300));
    let admitted = Arc::new(AtomicBool::new(true));
    let probe = admitted.clone();
    budget.attach_admission(Arc::new(move || probe.load(Ordering::SeqCst)));
    budget.enable_rate(Arc::new(move |timing| {
        if timing["allowedMillis"] == 600_000 {
            admitted.store(false, Ordering::SeqCst);
        }
        true
    }));
    assert!(r.run(&budget).unwrap_err().contains("cancelled"));
    assert_eq!(r.fake.count(|q| q.is_generate()), 0);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 0);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
}

#[test]
fn legacy_paced_server_backpressure_drives_polled_byte_rate() {
    let mut rates = Vec::new();
    for server_rate in [1024 * 1024_u64, 4 * 1024 * 1024] {
        let mut r = rig();
        // Exceed socket buffers so frame polling must follow the paced reader.
        r.source.bytes.resize(16 * 1024 * 1024, b' ');
        r.fake
            .behave(|b| b.upload_bytes_per_sec = Some(server_rate));
        let samples = Arc::new(Mutex::new(Vec::new()));
        let observed = samples.clone();
        let budget = Budget::new(Duration::from_secs(300));
        budget.enable_rate(Arc::new(move |timing| {
            observed.lock().unwrap().push(timing.clone());
            true
        }));
        r.run(&budget).unwrap();
        let samples = samples.lock().unwrap();
        let mut previous_ms = 0;
        let mut previous_bytes = 0;
        let mut minimum_rate = f64::INFINITY;
        let mut qualifying = 0;
        for sample in samples.iter().skip(1) {
            // FIX-2 persists before requests as well as samples; identical sample clocks are checkpoints.
            if sample["sampleMillis"].as_u64().unwrap() == previous_ms {
                continue;
            }
            let ms = sample["sampleMillis"].as_u64().unwrap();
            let bytes = sample["sampleBytes"].as_u64().unwrap();
            assert!(
                ms >= previous_ms + 1000,
                "one sample per second: {samples:?}"
            );
            assert_eq!(sample["uploadBytes"], r.source.bytes.len() as u64);
            assert!(bytes >= previous_bytes && bytes <= r.source.bytes.len() as u64);
            if bytes < r.source.bytes.len() as u64 && bytes >= 65536 && bytes > previous_bytes {
                let conservative = 0.8
                    * (bytes as f64 / (ms as f64 / 1000.0)).min(
                        (bytes - previous_bytes) as f64 / ((ms - previous_ms) as f64 / 1000.0),
                    );
                minimum_rate = minimum_rate.min(conservative);
                // This payload/rate fits the initial allowance; a real partial
                // sample must not take the unknown/buffered 600 s fallback.
                assert_eq!(sample["allowedMillis"], 300_000);
                qualifying += 1;
            }
            previous_ms = ms;
            previous_bytes = bytes;
        }
        assert!(
            qualifying > 0,
            "paced reader must expose partial samples: {samples:?}"
        );
        assert!(minimum_rate.is_finite() && minimum_rate > 0.0);
        println!("BACKPRESSURE server_bytes_per_sec={server_rate} samples={qualifying} conservative_min_bytes_per_sec={minimum_rate:.0}");
        rates.push(minimum_rate);
        let uploads: Vec<_> = r
            .fake
            .log()
            .into_iter()
            .filter(|q| q.header("x-goog-upload-offset").is_some())
            .collect();
        assert_eq!(uploads.len(), 1);
        assert_eq!(
            uploads[0].header("x-goog-upload-command"),
            Some("upload, finalize")
        );
        assert_eq!(uploads[0].header("x-goog-upload-offset"), Some("0"));
        assert_eq!(
            uploads[0].header("content-length"),
            Some(r.source.bytes.len().to_string().as_str())
        );
        assert_eq!(uploads[0].body, r.source.bytes);
        assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    }
    assert!(
        rates[1] > rates[0] * 1.5,
        "reader pacing must change the sampled rate: {rates:?}"
    );
}

#[test]
fn s3_a_61s_body_gap_fails_in_reading() {
    let r = rig();
    let gate = Arc::new(crate::fake_gemini::Gate::default());
    r.fake.behave(|b| b.generate_body_gate = Some(gate.clone()));
    std::thread::scope(|scope| {
        scope.spawn(|| {
            while gate.waiting() == 0 {
                std::thread::sleep(Duration::from_millis(1));
            }
            std::thread::sleep(Duration::from_millis(610));
            gate.open();
        });
        // FIX-2: 61 s with no response bytes expires Reading despite ample absolute time.
        r.failure("61s-gap", Stage::Reading, 1);
    });
}

#[test]
fn s4_absolute_expiry_prevents_any_retry() {
    let r = rig();
    r.fake.behave(|b| b.partial_generations = 3);
    let budget = stage_budget();
    // FIX-2: prior stages consumed 850 s, leaving less than unchanged real retry backoff.
    budget.shorten(Duration::from_millis(500));
    assert!(r.run(&budget).is_err());
    assert_eq!(r.fake.count(|q| q.is_generate()), 1);
    std::thread::sleep(Duration::from_millis(510));
    assert!(r.run(&budget).is_err());
    assert_eq!(
        r.fake.count(|q| q.is_generate()),
        1,
        "absolute expiry forbids dispatch"
    );
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}

#[test]
fn processing_polls_stop_at_120s_without_resetting() {
    let mut r = rig();
    r.cache = PreparedSources::new(
        gemini_files::Policy {
            poll_interval: Duration::from_millis(100),
            poll_cap: Duration::from_millis(100),
            max_polls: 100,
            ..Default::default()
        },
        Arc::new(|| 1_700_000_000),
    );
    r.fake.behave(|b| {
        b.initial_state = "PROCESSING";
        b.polls_until_active = None;
    });
    let b = stage_budget();
    let start = Instant::now();
    assert!(r.run(&b).unwrap_err().contains("still preparing"));
    assert!(start.elapsed() >= Duration::from_millis(1200));
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(r.fake.count(|q| q.is_lookup()) > 1);
    assert_eq!(r.fake.count(|q| q.is_generate()), 0);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
}

#[test]
fn finalize_wait_stops_after_60s_without_generation() {
    let r = rig();
    let gate = Arc::new(crate::fake_gemini::Gate::default());
    r.fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let b = stage_budget();
    let start = Instant::now();
    let outcome = r.run(&b);
    gate.open();
    assert_eq!(
        outcome.unwrap_err(),
        "The upload stopped moving. Your saved work is still here."
    );
    assert!(start.elapsed() >= Duration::from_millis(600));
    assert!(start.elapsed() < Duration::from_millis(1200));
    assert_eq!(r.fake.count(|q| q.is_generate()), 0);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}
