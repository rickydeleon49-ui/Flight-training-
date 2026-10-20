//! FIX-2 failing-first boundary and cancellation regressions, synthetic clocks only.
use super::testing::fake_budget;
use super::*;
use serde_json::json;

#[test]
fn upload_stall_61s() {
    let (b, time) = fake_budget(Duration::from_secs(900));
    b.at(Stage::Uploading);
    time.advance(Duration::from_secs(61));
    assert_eq!(
        b.request_timeout(),
        None,
        "stopped upload expires before absolute cap"
    );
}
#[test]
fn processing_120s_not_reset_by_polls() {
    let (b, time) = fake_budget(Duration::from_secs(900));
    b.at(Stage::WaitingForFile);
    for _ in 0..12 {
        time.advance(Duration::from_secs(10));
        b.at(Stage::CheckingFile);
        b.at(Stage::WaitingForFile);
    }
    assert_eq!(
        b.request_timeout(),
        None,
        "polls cannot replenish processing time"
    );
}
#[test]
fn progress_cannot_extend_900s() {
    let (b, time) = fake_budget(ACTIVE_BUDGET);
    assert_eq!(b.total(), Duration::from_secs(900));
    assert!(b.enable_stages(Arc::new(|_| true)));
    for _ in 0..30 {
        b.reset_stage(Stage::Uploading); // positive progress keeps the stage alive only
        time.advance(Duration::from_secs(30));
        b.rate_sample(Duration::from_secs(30), 65_536, 50_000_000);
    }
    assert!(b.remaining().is_zero());
}
#[test]
fn header_grace_not_transfer_stall() {
    let (b, time) = fake_budget(Duration::from_secs(900));
    b.at(Stage::Generating);
    time.advance(Duration::from_secs(360));
    assert_eq!(b.request_timeout(), Some(Duration::from_secs(120)));
    time.advance(Duration::from_secs(121));
    assert_eq!(b.request_timeout(), None);
}
#[test]
fn restart_clock_rollback() {
    let (b, time) = fake_budget(Duration::from_secs(900));
    let saved = json!({"policy":"stage-v1", "ceilingMillis":900000,"allowedMillis":900000,"remainingMillis":720000,"deadlineUtc":1000000,"uploadBytes":0,"sampleMillis":0,"sampleBytes":0,"activeStage":"generating","stages":{"generating":{"elapsedMillis":360000,"remainingMillis":120000}}});
    b.restore_timing_value(&saved, 100_000);
    assert_eq!(
        b.remaining().as_secs(),
        720,
        "rollback cannot restore more than persisted"
    );
    b.at(Stage::Generating);
    assert_eq!(b.request_timeout().unwrap().as_secs(), 120);
    time.advance(Duration::from_secs(1));
    b.restore_timing_value(&saved, 0);
    assert_eq!(b.remaining().as_secs(), 719);
    assert_eq!(
        b.timing_value()["stages"]["generating"]["elapsedMillis"],
        361000
    );
    assert_eq!(b.request_timeout().unwrap().as_secs(), 119);
}
#[test]
fn cancel_at_each_stage() {
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
        let (b, _) = fake_budget(Duration::from_secs(900));
        b.at(stage);
        b.attach_admission(Arc::new(|| false));
        assert!(
            tauri::async_runtime::block_on(b.run(async { 7 })).is_err(),
            "{} must stop before completion",
            stage.key()
        );
    }
}
#[test]
fn cancellation_versus_final_checkpoint_race() {
    use crate::gemini_cancel::{CancelToken, Cancellable, Cancelled};
    let token = Arc::new(CancelToken::default());
    let cancel = token.clone();
    // Simulate cancellation arriving while the final work poll is returning.
    let result = tauri::async_runtime::block_on(Cancellable::new(
        async move {
            cancel.cancel();
            7
        },
        token,
    ));
    assert_eq!(
        result,
        Err(Cancelled),
        "cancel must win before a final checkpoint escapes"
    );
}

#[test]
fn validation_and_control_boundaries_clip_to_absolute_remaining() {
    let (b, time) = fake_budget(Duration::from_secs(900));
    b.at(Stage::CheckingFile);
    assert_eq!(b.control_timeout(), Some(Duration::from_secs(60)));
    time.advance(Duration::from_secs(890));
    b.reset_stage(Stage::Validating);
    assert_eq!(b.request_timeout(), Some(Duration::from_secs(10)));
    time.advance(Duration::from_secs(10));
    assert!(b.validation_checkpoint().is_err());
    let (b, time) = fake_budget(Duration::from_secs(900));
    b.at(Stage::Validating);
    time.advance(Duration::from_secs(31));
    assert!(b.validation_checkpoint().is_err());
}

#[test]
fn stage_checkpoint_records_elapsed_and_inactivity_without_replenishing_absolute() {
    let (b, time) = fake_budget(ACTIVE_BUDGET);
    assert!(b.enable_stages(Arc::new(|_| true)));
    b.at(Stage::Uploading);
    time.advance(Duration::from_secs(40));
    b.reset_stage(Stage::Uploading); // positive bytes only reset inactivity
    time.advance(Duration::from_secs(20));
    assert!(b.checkpoint());
    let timing = b.timing_value();
    assert_eq!(timing["policy"], "stage-v1");
    assert_eq!(timing["remainingMillis"], 840000);
    assert_eq!(timing["activeStage"], "uploading");
    assert_eq!(timing["stages"]["uploading"]["elapsedMillis"], 60000);
    assert_eq!(timing["stages"]["uploading"]["remainingMillis"], 40000);
    assert!(timing.to_string().find("Instant").is_none());
}

#[test]
fn a_failed_timing_checkpoint_cannot_dispatch_or_upgrade_legacy_drafts() {
    let (b, _) = fake_budget(ACTIVE_BUDGET);
    assert!(!b.enable_stages(Arc::new(|_| false)));
    assert!(!b.checkpoint());
    let (legacy, _) = fake_budget(ACTIVE_BUDGET);
    legacy.restore_draft(&json!({"admissions": 0}));
    assert_eq!(legacy.total().as_secs(), 300);
    assert!(legacy.enable_stages(Arc::new(|_| true)));
    assert!(!legacy.stage_policy());
    assert_eq!(legacy.total().as_secs(), 300);
}
