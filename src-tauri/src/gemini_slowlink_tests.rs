//! OFFLINE-GEN-00: current behaviour, not proposed fixes. Synthetic PDF/key,
//! the real study_aid_with -> run_generation -> generate_with_retries_at path,
//! and loopback HTTP, following gemini_generation_tests' GenContext harness.
//!
//! Link/deadline scale is 1:100: 3 s here = 300 s in the app; a 3.6 s
//! upload/thinking delay = 360 s; 100 bytes/s here = 1 byte/s unscaled for
//! the same payload. These small payloads isolate timing, not real Mbps.
//! Real monotonic/Tokio timers exercise reqwest send AND chunk deadlines.
//! Elapsed assertions allow 1 s scheduler tolerance, never exact timings.
//! Production retry backoff is deliberately unchanged (1.5-1.875 real s).

use super::*;
use crate::fake_gemini::{Behaviour, FakeGemini};
use std::time::Instant;

const KEY: &str = "synthetic-slowlink-key-never-a-real-credential";
const TOTAL: Duration = Duration::from_secs(3);

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
    fn upload_for(&self, seconds: f64) {
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

    fn failure(&self, label: &str, stage: Stage, attempts: usize) {
        let budget = Budget::new(TOTAL);
        let start = Instant::now();
        let error = self.run(&budget).unwrap_err();
        let elapsed = start.elapsed();
        assert_eq!(budget.stage(), stage, "{error}");
        // Literal expected closing text: do not use lost_message to derive it.
        let expected = match stage {
            Stage::Generating => "Gemini did not answer within the 3 seconds Her Flight Deck allows for one study aid. Google may still have been working on it. Repeating the request may incur additional charges. Nothing was saved. Large documents take longest: choosing a chapter or fewer pages first usually helps. If short documents also stop like this, check the connection.",
            Stage::Reading => "Gemini started answering, but the rest did not arrive within the 3 seconds Her Flight Deck allows for one study aid. Nothing was saved. Google may have processed this request; repeating it may incur additional charges. Try a chapter or fewer pages to reduce the wait.",
            Stage::Uploading => {
                // The outer total guard and reqwest's same deadline race;
                // both are current valid diagnostics for this exact stage.
                let outer = "Her Flight Deck stopped before finishing this study aid: the 3 seconds it allows for one study aid had run out. Nothing was saved. Choosing a chapter or fewer pages first usually helps.";
                let transport = "Google did not finish uploading the PDF within the 3 seconds Her Flight Deck allows for one study aid, so no complete study aid was saved. On a slow connection, choosing a chapter or fewer pages first sends less; otherwise try again later.";
                assert!(error == outer || error == transport, "{error}");
                error.as_str()
            }
            _ => panic!("unexpected test stage"),
        };
        assert_eq!(error, expected);
        assert_eq!(self.fake.count(|r| r.is_generate()), attempts);
        assert_eq!(budget.attempts() as usize, attempts);
        assert!(
            elapsed >= TOTAL && elapsed < TOTAL + Duration::from_secs(1),
            "{elapsed:?}"
        );
        println!("MEASURE {label} stage={} attempts={attempts} elapsed_ms={} unscaled_s={:.2} error={error}", stage.key(), elapsed.as_millis(), elapsed.as_secs_f64() * 100.0);
    }
}

#[test]
fn s1_upload_alone_exhausts_the_budget_before_any_generation() {
    // 360 s upload, no thinking/download delay: fails at Uploading, 0 requests.
    let r = rig();
    r.upload_for(3.6);
    r.failure("S1-upload", Stage::Uploading, 0);
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
    // The fake logs a request only AFTER its entire body has been read.
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 0);
}

#[test]
fn s1_upload_uses_most_of_the_time_leaving_too_little_for_the_model() {
    // About 240 s upload + 120 s thinking: neither gets a fresh budget.
    let r = rig();
    r.upload_for(2.4);
    r.fake
        .behave(|b| b.generate_first_byte_delay = Some(Duration::from_millis(1200)));
    r.failure("S1-remaining", Stage::Generating, 1);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}

#[test]
fn s2_no_response_headers_before_deadline_is_generating() {
    // Fast upload + 360 s thinking exceeds 300 s.
    let r = rig();
    r.fake
        .behave(|b| b.generate_first_byte_delay = Some(Duration::from_millis(3600)));
    r.failure("S2", Stage::Generating, 1);
}

#[test]
fn s3_response_bytes_keep_arriving_but_the_absolute_deadline_still_wins() {
    // Immediate headers, 400 B / 100 B/s = 4 s (400 s unscaled).
    let r = rig();
    r.fake
        .behave(|b| b.generate_trickle_bytes_per_sec = Some(100));
    r.failure("S3", Stage::Reading, 1);
}

fn replay_after_drop(label: &str, stage: Stage, slow: impl FnOnce(&mut Behaviour)) {
    let r = rig();
    r.fake.behave(|b| {
        // An early truncated connection is retryable; a deadline is terminal.
        b.partial_generations = 1;
        slow(b);
    });
    r.failure(label, stage, 2);
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
fn s4_early_drop_replays_the_request_but_s2_timeout_never_retries() {
    // First early cut + unchanged backoff + 360 s thinking: only 2 fit;
    // S2 itself above fits only 1; no request is sent after that timeout.
    replay_after_drop("S4-headers", Stage::Generating, |b| {
        b.generate_first_byte_delay = Some(Duration::from_millis(3600));
    });
}

#[test]
fn s4_early_drop_replays_the_request_but_s3_timeout_never_retries() {
    // First early cut + unchanged backoff + 400 s body: 2 fit, neither succeeds.
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
        let r = rig();
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
        let budget = Budget::new(Duration::from_secs(6)); // 600 s unscaled.
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
