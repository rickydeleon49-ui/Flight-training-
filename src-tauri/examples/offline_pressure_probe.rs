//! Disposable measurement driver: production supervisor and worker, no app state.
use her_flight_deck_lib::extraction::{supervisor, worker::Limits};
use std::{
    path::Path,
    sync::{atomic::AtomicBool, Arc},
    time::{Duration, Instant},
};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 4, "probe WORKER SYNTHETIC_PDF SHA256");
    let started = Instant::now();
    let result = supervisor::run(supervisor::Job {
        worker: Path::new(&args[1]),
        file: Path::new(&args[2]),
        sha256: &args[3],
        limits: Limits::default(),
        deadline: Duration::from_secs(119),
        cancel: Arc::new(AtomicBool::new(false)),
        extra: None,
    });
    let (outcome, pages, peak, detail) = match result {
        Ok(extraction) => (
            "ok",
            extraction.pages.len(),
            extraction.peak_bytes,
            String::new(),
        ),
        Err(supervisor::Failure::MemoryLimit) => ("memory_limit", 0, 0, String::new()),
        Err(supervisor::Failure::Timeout) => ("deadline", 0, 0, String::new()),
        Err(other) => ("crash", 0, 0, other.code()),
    };
    // Never publish pages or open a cache/database: only counts leave this process.
    println!(
        "{}",
        serde_json::json!({"outcome": outcome, "pages": pages,
        "countedPeakBytes": peak, "seconds": started.elapsed().as_secs_f64(),
        "partialPublish": false, "detail": detail})
    );
}
