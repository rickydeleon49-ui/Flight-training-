use super::testing::fake_budget;
use super::*;
use serde_json::json;

fn enable(b: &Budget) {
    b.enable_rate(Arc::new(|_| true));
}

#[test]
fn rate_allowance_covers_estimate_table() {
    for mb in [5_u64, 20, 50] {
        for mbps in [1_u64, 3, 10] {
            for thinking in [30_u64, 90, 180] {
                let (b, time) = fake_budget(ACTIVE_BUDGET);
                enable(&b);
                time.advance(Duration::from_secs(1));
                let bytes = mbps * 1_000_000 / 8;
                assert!(b.rate_sample(Duration::from_secs(1), bytes, mb * 1_000_000));
                let expected =
                    (1.0 + (mb * 1_000_000 - bytes) as f64 / (bytes as f64 * 0.8) + 210.0)
                        .ceil()
                        .clamp(300.0, 600.0) as u64;
                assert_eq!(b.total().as_secs(), expected);
                assert!(
                    b.total().as_secs_f64()
                        >= mb as f64 * 8.0 / mbps as f64 + thinking as f64 + 10.4
                );
            }
        }
    }
}
#[test]
fn rate_zero_missing_buffered_and_changing_samples() {
    for (ms, bytes) in [(1000, 0), (1000, 1024), (0, 50_000_000)] {
        let (b, _) = fake_budget(ACTIVE_BUDGET);
        enable(&b);
        assert!(b.rate_sample(Duration::from_millis(ms), bytes, 50_000_000));
        assert_eq!(b.total().as_secs(), 600);
    }
    let (b, time) = fake_budget(ACTIVE_BUDGET);
    enable(&b);
    time.advance(Duration::from_secs(1));
    b.rate_sample(Duration::from_secs(1), 1_000_000, 50_000_000);
    assert_eq!(b.total().as_secs(), 300);
    time.advance(Duration::from_secs(1));
    b.rate_sample(Duration::from_secs(2), 1_065_536, 50_000_000);
    assert_eq!(b.total().as_secs(), 600);
    let (b, _) = fake_budget(ACTIVE_BUDGET);
    b.enable_rate(Arc::new(|_| false));
    b.rate_sample(Duration::from_secs(1), 0, 50_000_000);
    assert_eq!(b.total().as_secs(), 300, "failed checkpoint cannot extend");
}
#[test]
fn allowance_never_exceeds_600_from_original_start() {
    let (b, time) = fake_budget(ACTIVE_BUDGET);
    enable(&b);
    time.advance(Duration::from_secs(299));
    b.rate_sample(Duration::from_secs(299), 65_536, 50_000_000);
    assert_eq!(b.total().as_secs(), 600);
    time.advance(Duration::from_secs(300));
    b.rate_sample(Duration::from_secs(599), 131_072, 50_000_000);
    assert_eq!(b.remaining().as_secs(), 1);
    time.advance(Duration::from_secs(1));
    assert!(b.request_timeout().is_none());
}
#[test]
fn outer_guard_observes_extension() {
    let b = Budget::new(Duration::from_millis(100));
    enable(&b);
    let remaining = b.remaining_clock();
    tauri::async_runtime::block_on(async {
        b.run(async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            b.rate_sample(Duration::ZERO, 0, 1_000_000);
            assert!(remaining() > Duration::from_millis(100));
            tokio::time::sleep(Duration::from_millis(100)).await;
        })
        .await
        .unwrap();
    });
}
#[test]
fn restart_keeps_persisted_remaining() {
    let (b, time) = fake_budget(ACTIVE_BUDGET);
    let saved = json!({"policy":"measured-rate-v1", "ceilingMillis":600000,"allowedMillis":500000,"remainingMillis":42000,"deadlineUtc":1_000_000,"uploadBytes":100000,"sampleMillis":1000,"sampleBytes":65536});
    b.restore_timing_value(&saved, 900_000); // rollback: wall remainder 100s, persisted only 42s
    assert_eq!(b.remaining().as_secs(), 42);
    enable(&b);
    b.rate_sample(Duration::ZERO, 0, 1_000_000);
    assert_eq!(b.remaining().as_secs(), 42, "restart cannot upgrade");
    time.advance(Duration::from_secs(1));
    b.restore_timing_value(&saved, 900_000);
    b.shorten(Duration::from_secs(100));
    assert_eq!(
        b.remaining().as_secs(),
        41,
        "a second restoration or a legacy top-level clock cannot replenish time"
    );
}
#[test]
fn card_batches_use_selected_policy() {
    let (b, time) = fake_budget(ACTIVE_BUDGET);
    enable(&b);
    time.advance(Duration::from_secs(1));
    b.rate_sample(Duration::from_secs(1), 65536, 50_000_000);
    let timing = b.timing_value();
    assert_eq!(timing["policy"], "measured-rate-v1");
    assert_eq!(timing["allowedMillis"], 600000);
    assert_eq!(b.remaining_clock()().as_secs(), 599);
}
#[test]
fn cancel_during_rate_sample_stops_dispatch() {
    let (b, _) = fake_budget(ACTIVE_BUDGET);
    let admitted = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let check = admitted.clone();
    b.attach_admission(Arc::new(move || {
        check.load(std::sync::atomic::Ordering::SeqCst)
    }));
    b.enable_rate(Arc::new(move |timing| {
        if timing["allowedMillis"] == 600_000 {
            admitted.store(false, std::sync::atomic::Ordering::SeqCst);
        }
        true
    }));
    assert!(!b.rate_sample(Duration::from_secs(1), 65536, 50_000_000));
    assert!(!b.admit());
}
