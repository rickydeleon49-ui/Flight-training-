//! Bounded readiness waits shared by native tests only.

use std::time::{Duration, Instant};

pub(crate) fn wait_for(what: &str, mut ready: impl FnMut() -> bool) {
    let started = Instant::now();
    let ceiling = Duration::from_secs(30);
    while !ready() {
        let elapsed = started.elapsed();
        assert!(
            elapsed < ceiling,
            "timed out waiting for {what} after {elapsed:?}"
        );
        std::thread::sleep(Duration::from_millis(5).min(ceiling - elapsed));
    }
}
