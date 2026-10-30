//! GEN-REL-03 policy proofs against synthetic loopback HTTP only.
use super::*;
use crate::fake_gemini::{FakeGemini, Gate};
use crate::gemini_budget::testing::{fake_budget, FakeTime};
use std::sync::{Arc, Mutex};

const KEY: &str = "synthetic-recovery-key-not-a-real-credential";
struct Rig {
    fake: FakeGemini,
    http: Client,
    cache: PreparedSources,
    budget: Budget,
    time: Arc<FakeTime>,
    said: Mutex<Vec<String>>,
}
fn rig(seconds: u64) -> Rig {
    let (budget, time) = fake_budget(Duration::from_secs(seconds));
    Rig {
        fake: FakeGemini::start(),
        http: generation_client().unwrap(),
        cache: PreparedSources::new(gemini_files::Policy::default(), Arc::new(|| 1_700_000_000)),
        budget,
        time,
        said: Mutex::new(vec![]),
    }
}
impl Rig {
    fn run_with(
        &self,
        budget: &Budget,
        mime: &'static str,
        choice: ModelChoice,
    ) -> Result<GeneratedStudyAid, String> {
        let source = LoadedSource::new(
            b"synthetic source only".to_vec(),
            mime,
            "documents/private-sentinel.txt",
        );
        let say = |m| self.said.lock().unwrap().push(m);
        let ctx = GenContext {
            provider: crate::provider::AnyProvider::default(),
            http: &self.http,
            base: &self.fake.base,
            api_key: KEY,
            choice,
            cache: &self.cache,
            epoch: self.cache.epoch(),
            budget,
            say: &say,
        };
        tauri::async_runtime::block_on(study_aid_with(&ctx, &source))
    }
    fn run(&self) -> Result<GeneratedStudyAid, String> {
        self.run_with(&self.budget, "text/plain", ModelChoice::Standard)
    }
    fn count(&self) -> usize {
        self.fake.count(|r| r.is_generate())
    }
}

#[test]
fn transient_status_matrix_is_bounded_and_recovers_on_the_backup() {
    for status in [408, 429, 500, 502, 503, 504] {
        let r = rig(300);
        r.fake
            .behave(|b| b.generate_statuses = vec![(status, "{}".into()), (status, "{}".into())]);
        let answer = r.run().unwrap();
        assert_eq!(r.count(), 3, "status {status}");
        assert_eq!(answer.model, ModelChoice::Standard.fallback());
        assert_eq!(r.budget.attempts(), 3);
    }
}

#[test]
fn permanent_status_matrix_does_not_retry_or_switch_models() {
    for status in [400, 401, 402, 403, 404, 413] {
        let r = rig(300);
        r.fake.behave(|b| {
            b.generate_statuses = vec![(
                status,
                "{\"error\":{\"message\":\"private document and key sentinel\"}}".into(),
            )]
        });
        let error = r.run().unwrap_err();
        assert_eq!(r.count(), 1, "status {status}");
        assert!(!error.contains("private document and key sentinel"));
        assert!(r.time.pauses.lock().unwrap().is_empty());
    }
}

#[test]
fn three_attempts_include_fallback_and_exhaustion_is_finite() {
    let r = rig(300);
    r.fake
        .behave(|b| b.generate_statuses = vec![(503, "{}".into()); 8]);
    let error = r.run().unwrap_err();
    assert_eq!(r.count(), 3);
    assert!(
        error.contains("3 times") && error.contains("backup"),
        "{error}"
    );
}

#[test]
fn retry_after_is_paid_before_every_retry_including_fallback() {
    let r = rig(300);
    r.fake.behave(|b| {
        b.generate_statuses = vec![(503, "{}".into()); 2];
        b.generate_retry_after = Some("3".into());
    });
    r.run().unwrap();
    assert_eq!(
        *r.time.pauses.lock().unwrap(),
        vec![Duration::from_secs(3); 2]
    );
    assert_eq!(r.count(), 3);
}

#[test]
fn capable_choice_sends_gemini_3_8_flash() {
    let r = rig(300);
    let answer = r
        .run_with(&r.budget, "text/plain", ModelChoice::MostCapable)
        .unwrap();
    let requests: Vec<_> = r
        .fake
        .log()
        .into_iter()
        .filter(|q| q.is_generate())
        .collect();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].path,
        "/v1beta/models/gemini-3.8-flash:generateContent"
    );
    assert_eq!(answer.model, "gemini-3.8-flash");
}

#[test]
fn capable_access_refusal_falls_back_to_standard() {
    let r = rig(300);
    r.fake
        .behave(|b| b.generate_statuses = vec![(403, "{}".into())]);
    let answer = r
        .run_with(&r.budget, "text/plain", ModelChoice::MostCapable)
        .unwrap();
    let paths: Vec<_> = r
        .fake
        .log()
        .into_iter()
        .filter(|q| q.is_generate())
        .map(|q| q.path)
        .collect();
    assert_eq!(
        paths,
        vec![
            "/v1beta/models/gemini-3.8-flash:generateContent",
            "/v1beta/models/gemini-3.5-flash:generateContent",
        ]
    );
    assert_eq!(answer.model, "gemini-3.5-flash");
    assert_eq!(r.budget.attempts(), 2);
    assert!(r.time.pauses.lock().unwrap().is_empty());
    assert!(r
        .said
        .lock()
        .unwrap()
        .iter()
        .any(|m| m.contains("Gemini 3.8 Flash") && m.contains("trying the standard")));
}

#[test]
fn capable_invalid_key_or_repeated_access_refusal_stops() {
    for statuses in [
        vec![(403, r#"{"error":{"reason":"API_KEY_INVALID"}}"#.into())],
        vec![(403, "{}".into()); 4],
    ] {
        let expected = if statuses.len() == 1 { 1 } else { 2 };
        let r = rig(300);
        r.fake.behave(|b| b.generate_statuses = statuses);
        let error = r
            .run_with(&r.budget, "text/plain", ModelChoice::MostCapable)
            .unwrap_err();
        assert_eq!(r.count(), expected);
        assert!(r.time.pauses.lock().unwrap().is_empty());
        assert!(error.contains("key") || error.contains("access"), "{error}");
    }
}

#[test]
fn capable_model_fallback_also_honors_retry_after() {
    let r = rig(300);
    r.fake.behave(|b| {
        b.generate_statuses = vec![(429, "{}".into())];
        b.generate_retry_after = Some("7".into());
    });
    let answer = r
        .run_with(&r.budget, "text/plain", ModelChoice::MostCapable)
        .unwrap();
    assert_eq!(answer.model, ModelChoice::MostCapable.fallback());
    assert_eq!(r.count(), 2);
    assert_eq!(*r.time.pauses.lock().unwrap(), vec![Duration::from_secs(7)]);
}

#[test]
fn retry_after_outside_remaining_budget_stops_without_another_call() {
    for wait in ["300", "86401", "18446744073709551615"] {
        let r = rig(300);
        r.fake.behave(|b| {
            b.generate_statuses = vec![(429, "{}".into())];
            b.generate_retry_after = Some(wait.into());
        });
        let error = r.run().unwrap_err();
        assert_eq!(r.count(), 1);
        assert!(error.contains("asked Her Flight Deck to wait"), "{error}");
        assert!(r.time.pauses.lock().unwrap().is_empty());
    }
}

#[test]
fn daily_quota_including_mixed_per_minute_violations_is_not_retried() {
    for violations in [
        json!([{"quotaId":"RequestsPerDay"}]),
        json!([{"quotaId":"RequestsPerMinute"},{"quotaId":"RequestsPerDay"}]),
        json!([{"quotaId":"RequestsPerMinute","quotaValue":"0"}]),
    ] {
        let r = rig(300);
        let raw = json!({"error":{"details":[{"violations":violations}]}}).to_string();
        r.fake.behave(|b| b.generate_statuses = vec![(429, raw)]);
        let error = r.run().unwrap_err();
        assert!(
            error.contains("quota") && error.contains("Automatic retries have stopped"),
            "{error}"
        );
        assert_eq!(r.count(), 1);
    }
}

#[test]
fn dropped_submission_can_recover_but_discloses_uncertain_cost() {
    let r = rig(300);
    r.fake.behave(|b| b.drop_generations = 1);
    r.run().unwrap();
    assert_eq!(r.count(), 2);
    assert!(r
        .said
        .lock()
        .unwrap()
        .iter()
        .any(|m| m.contains("additional charges")));
}

#[test]
fn repeatedly_dropped_submissions_stop_without_claiming_exactly_once() {
    let r = rig(300);
    r.fake.behave(|b| b.drop_generations = 9);
    let error = r.run().unwrap_err();
    assert_eq!(r.count(), 3);
    assert!(
        error.contains("may or may not") && error.contains("additional provider charges"),
        "{error}"
    );
}

#[test]
fn truncated_response_transport_is_retried_with_the_same_shared_cap() {
    let r = rig(300);
    r.fake.behave(|b| b.partial_generations = 1);
    r.run().unwrap();
    assert_eq!(r.count(), 2);
}

#[test]
fn slow_headers_spend_one_budget_and_are_not_retried() {
    let r = rig(300);
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.generate_gate = Some(gate.clone()));
    let budget = Budget::new(Duration::from_millis(120));
    let outcome = r.run_with(&budget, "text/plain", ModelChoice::Standard);
    gate.open();
    let error = outcome.unwrap_err();
    assert_eq!(r.count(), 1);
    assert_eq!(
        error,
        "Gemini is taking longer to answer. You can try again."
    );
}

#[test]
fn slow_body_is_distinct_from_failure_to_connect_and_never_resets_the_budget() {
    let r = rig(300);
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.generate_body_gate = Some(gate.clone()));
    let budget = Budget::new(Duration::from_millis(120));
    let outcome = r.run_with(&budget, "text/plain", ModelChoice::Standard);
    gate.open();
    let error = outcome.unwrap_err();
    assert_eq!(r.count(), 1);
    assert_eq!(error, "The rest of the answer stopped arriving.");
    assert!(!error.contains("Check the internet"));
}

#[test]
fn upload_stall_is_bounded_without_issuing_any_generation_or_duplicate_upload() {
    let r = rig(300);
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let budget = Budget::new(Duration::from_millis(120));
    let outcome = r.run_with(&budget, "application/pdf", ModelChoice::Standard);
    gate.open();
    assert!(outcome.is_err());
    assert_eq!(r.count(), 0);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
}

#[test]
fn readiness_wait_uses_the_generation_budget_not_a_new_allowance() {
    let r = rig(1);
    r.fake.behave(|b| b.initial_state = "PROCESSING");
    let error = r
        .run_with(&r.budget, "application/pdf", ModelChoice::Standard)
        .unwrap_err();
    assert!(
        error.contains("preparing") || error.contains("time"),
        "{error}"
    );
    assert_eq!(r.count(), 0);
}

#[test]
fn spent_budget_makes_no_request_and_allocates_no_attempt() {
    let r = rig(300);
    r.time.advance(Duration::from_secs(300));
    assert!(r.run().is_err());
    assert_eq!(r.count(), 0);
    assert_eq!(r.budget.attempts(), 0);
}

#[test]
fn source_repreparation_does_not_reset_generation_attempts() {
    let r = rig(300);
    r.fake.behave(|b| {
        b.generate_statuses = vec![(400, "{}".into()), (503, "{}".into()), (503, "{}".into())];
        b.lookup_script = vec![Some(404)];
    });
    let error = r
        .run_with(&r.budget, "application/pdf", ModelChoice::Standard)
        .unwrap_err();
    assert!(error.contains("busy"), "{error}");
    assert_eq!(r.count(), 3);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 2);
}

#[test]
fn blocked_and_truncated_output_is_refused_without_a_provider_retry() {
    for envelope in [
        json!({"promptFeedback":{"blockReason":"SAFETY"}}),
        json!({"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[{"text":"{}"}]}}]}),
        json!({"candidates":[{"finishReason":"SAFETY","content":{"parts":[{"text":"{}"}]}}]}),
        json!({"candidates":[{"finishReason":"OTHER","content":{"parts":[{"text":"{}"}]}}]}),
    ] {
        let r = rig(300);
        r.fake
            .behave(|b| b.generate_answer = Some(envelope.to_string()));
        let error = r.run().unwrap_err();
        assert!(
            error.contains("blocked") || error.contains("incomplete") || error.contains("stopped"),
            "{error}"
        );
        assert_eq!(r.count(), 1);
    }
}

#[test]
fn invalid_model_404_is_not_silently_changed_to_a_different_model() {
    let r = rig(300);
    r.fake
        .behave(|b| b.generate_statuses = vec![(404, "{}".into())]);
    let error = r
        .run_with(&r.budget, "text/plain", ModelChoice::MostCapable)
        .unwrap_err();
    assert!(error.contains("model"), "{error}");
    assert_eq!(r.count(), 1);
}

#[test]
fn diagnostic_details_cannot_include_request_secrets_source_text_or_paths() {
    let r = rig(300);
    r.fake.behave(|b| {
        b.generate_statuses = vec![(
            403,
            format!("sensitive {KEY} documents/private-sentinel.txt"),
        )]
    });
    let error = r.run().unwrap_err();
    let final_message = format!("{error}\n{}", r.budget.details(None));
    assert!(final_message.contains("generation attempts: 1"));
    assert!(final_message.contains("last status: 403"));
    for secret in [
        KEY,
        "documents/private-sentinel.txt",
        "synthetic source only",
        "sensitive",
    ] {
        assert!(!final_message.contains(secret), "{final_message}");
    }
}

#[test]
fn connection_refusal_retries_are_bounded_without_reaching_a_provider() {
    let r = rig(300);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let source = LoadedSource::new(b"synthetic".to_vec(), "text/plain", "documents/a.txt");
    let say = |_| {};
    let ctx = GenContext {
        provider: crate::provider::AnyProvider::default(),
        http: &r.http,
        base: &base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: r.cache.epoch(),
        budget: &r.budget,
        say: &say,
    };
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source)).unwrap_err();
    assert!(error.contains("Could not reach Google"), "{error}");
    assert_eq!(r.budget.attempts(), 3);
    assert_eq!(r.count(), 0);
}

#[test]
fn journal_failure_keeps_sanitized_diagnostics_and_restart_does_not_repeat_work() {
    let r = rig(300);
    r.fake
        .behave(|b| b.generate_statuses = vec![(403, "private provider sentinel".into())]);
    let source = LoadedSource::new(b"synthetic".to_vec(), "text/plain", "documents/a.txt");
    let dir = std::env::temp_dir().join(format!(
        "hfd-recovery-{}-{}",
        std::process::id(),
        r.fake.base.rsplit(':').next().unwrap()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let say = |_| {};
    let ctx = GenContext {
        provider: crate::provider::AnyProvider::default(),
        http: &r.http,
        base: &r.fake.base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: r.cache.epoch(),
        budget: &r.budget,
        say: &say,
    };
    let result = tauri::async_runtime::block_on(as_job(
        &dir,
        JobKind::StudyAid,
        "mat-a",
        None,
        &source,
        async {
            study_aid_with(&ctx, &source)
                .await
                .map_err(|m| format!("{m}\n{}", r.budget.details(None)))
        },
        &|_| {},
    ));
    assert!(result.is_err());
    let journal = gemini_jobs::Journal::open(&dir);
    let records = journal.list();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].stage, JobStage::Failed);
    let message = records[0].error.as_ref().unwrap();
    assert!(message.contains("generation attempts: 1") && message.contains("last status: 403"));
    assert!(!message.contains("private provider sentinel") && !message.contains(KEY));
    assert_eq!(
        r.count(),
        1,
        "opening the journal does not resume or reset an automatic run"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_coalesced_waiter_has_its_own_deadline_without_cancelling_the_owner() {
    let r = Arc::new(rig(300));
    let gate = Arc::new(Gate::default());
    r.fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let owner = r.clone();
    let work = std::thread::spawn(move || {
        owner.run_with(
            &Budget::new(Duration::from_secs(10)),
            "application/pdf",
            ModelChoice::Standard,
        )
    });
    crate::test_wait::wait_for("coalesced owner upload gate", || gate.waiting() == 1);
    let budget = Budget::new(Duration::from_millis(120));
    let outcome = r.run_with(&budget, "application/pdf", ModelChoice::Standard);
    gate.open();
    assert!(outcome.is_err());
    assert_eq!(r.cache.stats().coalesced, 1);
    work.join().unwrap().unwrap();
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(r.count(), 1, "only the surviving owner generates");
}
