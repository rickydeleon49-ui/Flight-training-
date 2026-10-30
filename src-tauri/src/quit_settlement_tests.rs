//! Quitting settles once and never waits longer than its limit (QUIT-01).

use std::time::{Duration, Instant};

use crate::quit_settlement::{wait, Settlement};

#[test]
fn only_the_first_quit_request_starts_a_settlement() {
    let settlement = Settlement::default();
    assert!(settlement.request().is_some());
    assert!(settlement.request().is_none());
    assert!(settlement.request().is_none());
}

#[test]
fn the_frontend_answer_ends_the_wait_at_once() {
    let settlement = Settlement::default();
    let rx = settlement.request().expect("first request");
    settlement.settle();
    let started = Instant::now();
    wait(rx, Duration::from_secs(30));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn an_answer_from_another_thread_wakes_the_wait() {
    let settlement = std::sync::Arc::new(Settlement::default());
    let rx = settlement.request().expect("first request");
    let answering = settlement.clone();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(20));
        answering.settle();
    });
    let started = Instant::now();
    wait(rx, Duration::from_secs(30));
    assert!(started.elapsed() < Duration::from_secs(5));
    thread.join().unwrap();
}

#[test]
fn no_answer_still_ends_the_wait_after_the_limit() {
    let settlement = Settlement::default();
    let rx = settlement.request().expect("first request");
    let started = Instant::now();
    wait(rx, Duration::from_millis(50));
    let elapsed = started.elapsed();
    assert!(elapsed >= Duration::from_millis(50));
    assert!(elapsed < Duration::from_secs(5));
}

#[test]
fn a_late_or_repeated_answer_is_harmless() {
    let settlement = Settlement::default();
    // Before any quit, and twice after one: nothing panics or blocks.
    settlement.settle();
    let rx = settlement.request().expect("first request");
    settlement.settle();
    settlement.settle();
    wait(rx, Duration::from_millis(10));
    settlement.settle();
    assert!(settlement.request().is_none());
}
