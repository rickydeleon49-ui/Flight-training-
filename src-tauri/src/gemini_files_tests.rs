//! GEN-REL-01 prepared-source cache: coalescing, context changes, bounds and
//! the provider contract, against the loopback stand-in with controlled
//! gates and a fake clock. Synthetic bytes only.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::fake_gemini::{FakeGemini, Gate};

const KEY: &str = "synthetic-key-AAAAAAAAAAAAAAAAAAAA";
const OTHER_KEY: &str = "synthetic-key-BBBBBBBBBBBBBBBBBBBB";

fn policy() -> Policy {
    Policy {
        poll_interval: Duration::from_millis(1),
        poll_cap: Duration::from_millis(2),
        max_polls: 3,
        delete_timeout: Duration::from_secs(2),
        ..Policy::default()
    }
}

fn cache() -> Arc<PreparedSources> {
    let now = Arc::new(AtomicI64::new(1_700_000_000));
    Arc::new(PreparedSources::new(
        policy(),
        Arc::new(move || now.load(Ordering::SeqCst)),
    ))
}

fn http() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Prepare on a runtime task so several can be in flight at once.
fn spawn_prepare(
    cache: &Arc<PreparedSources>,
    base: &str,
    key: &'static str,
    bytes: Vec<u8>,
    scope: &'static str,
) -> tauri::async_runtime::JoinHandle<Result<Prepared, String>> {
    let cache = cache.clone();
    let base = base.to_string();
    tauri::async_runtime::spawn(async move {
        let content = sha(&bytes);
        let source = Source {
            bytes: &bytes,
            content_sha256: &content,
            mime: "application/pdf",
            scope,
        };
        cache
            .prepare(
                &http(),
                &base,
                key,
                &source,
                cache.epoch(),
                None,
                &Budget::new(crate::gemini_budget::ACTIVE_BUDGET),
                &|_| {},
            )
            .await
            .map(|lease| lease.prepared().clone())
    })
}

fn wait_for(what: &str, f: impl Fn() -> bool) {
    for _ in 0..2_000 {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("timed out waiting for {what}");
}

fn join<T>(handle: tauri::async_runtime::JoinHandle<T>) -> T {
    tauri::async_runtime::block_on(handle).unwrap()
}

#[test]
fn concurrent_preparations_of_the_same_source_coalesce_into_one_upload() {
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let cache = cache();
    let bytes = b"%PDF-synthetic-coalesce".to_vec();
    let first = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    wait_for("the first upload to be held", || gate.waiting() == 1);
    let second = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    let third = spawn_prepare(&cache, &fake.base, KEY, bytes, "documents/a.pdf");
    wait_for("the others to join", || cache.stats().coalesced == 2);
    gate.open();
    let (a, b, c) = (
        join(first).unwrap(),
        join(second).unwrap(),
        join(third).unwrap(),
    );
    assert_eq!(a.name, b.name);
    assert_eq!(a.name, c.name);
    assert!(!a.reused && b.reused && c.reused);
    assert_eq!(fake.count(|r| r.is_upload_start()), 1);
    assert_eq!(fake.count(|r| r.is_upload_finalize()), 1);
    assert_eq!(cache.stats().uploads, 1);
    assert_eq!(cache.ready_len(), 1);
}

#[test]
fn distinct_sources_and_credentials_are_never_coalesced() {
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let cache = cache();
    let bytes = b"%PDF-synthetic-distinct".to_vec();
    let handles = vec![
        spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf"),
        spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/b.pdf"),
        spawn_prepare(
            &cache,
            &fake.base,
            OTHER_KEY,
            bytes.clone(),
            "documents/a.pdf",
        ),
        spawn_prepare(
            &cache,
            &fake.base,
            KEY,
            b"%PDF-synthetic-other-bytes".to_vec(),
            "documents/c.pdf",
        ),
    ];
    wait_for("four separate uploads", || gate.waiting() == 4);
    gate.open();
    let names: std::collections::HashSet<String> =
        handles.into_iter().map(|h| join(h).unwrap().name).collect();
    assert_eq!(names.len(), 4);
    assert_eq!(cache.stats().coalesced, 0);
}

#[test]
fn a_preparation_that_finishes_after_disconnect_is_never_published_and_its_upload_is_retired() {
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let cache = cache();
    let bytes = b"%PDF-synthetic-late".to_vec();
    let late = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    let joined = {
        wait_for("the upload to be held", || gate.waiting() == 1);
        spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf")
    };
    wait_for("a waiter to join", || cache.stats().coalesced == 1);
    // Disconnect (or a new key) ends the context while the upload is held.
    assert!(cache.invalidate_all().is_empty());
    gate.open();
    assert_eq!(join(late), Err(STALE_CONTEXT.to_string()));
    assert_eq!(
        join(joined),
        Err(STALE_CONTEXT.to_string()),
        "waiters never receive a retired copy"
    );
    assert_eq!(
        cache.ready_len(),
        0,
        "nothing published into the new context"
    );
    assert_eq!(cache.stats().stale_discarded, 1);
    wait_for("its own upload to be deleted", || {
        fake.count(|r| r.is_delete()) == 1
    });
    assert!(!fake.exists("files/synthetic-1"));
    // The new context prepares afresh.
    fake.behave(|b| b.finalize_gate = None);
    let fresh = join(spawn_prepare(
        &cache,
        &fake.base,
        KEY,
        bytes,
        "documents/a.pdf",
    ))
    .unwrap();
    assert_eq!(fresh.name, "files/synthetic-2");
    assert_eq!(cache.ready_len(), 1);
}

#[test]
fn late_work_from_an_old_key_cannot_replace_the_new_keys_copy() {
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let cache = cache();
    let bytes = b"%PDF-synthetic-key-change".to_vec();
    let old = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    wait_for("the old key's upload to be held", || gate.waiting() == 1);
    cache.invalidate_all();
    fake.behave(|b| b.finalize_gate = None);
    let new = join(spawn_prepare(
        &cache,
        &fake.base,
        OTHER_KEY,
        bytes,
        "documents/a.pdf",
    ))
    .unwrap();
    gate.open();
    assert_eq!(join(old), Err(STALE_CONTEXT.to_string()));
    assert_eq!(cache.ready_len(), 1);
    let source_key = cache.key_for(
        &fake.base,
        OTHER_KEY,
        &Source {
            bytes: b"",
            content_sha256: &sha(b"%PDF-synthetic-key-change"),
            mime: "application/pdf",
            scope: "documents/a.pdf",
        },
    );
    assert!(cache
        .lock()
        .ready
        .get(&source_key)
        .is_some_and(|r| r.prepared.name == new.name));
    // The old key's file is deleted with the old key only.
    wait_for("the stale upload to be deleted", || {
        fake.count(|r| r.is_delete()) == 1
    });
    let delete = fake.log().into_iter().find(|r| r.is_delete()).unwrap();
    assert_eq!(delete.header("x-goog-api-key"), Some(KEY));
}

#[test]
fn the_cache_holds_at_most_sixteen_and_retires_the_least_recently_used() {
    let fake = FakeGemini::start();
    let cache = cache();
    let scopes: Vec<&'static str> = (0..17)
        .map(|i| &*Box::leak(format!("documents/part-{i}.pdf").into_boxed_str()))
        .collect();
    for (i, scope) in scopes.iter().enumerate() {
        join(spawn_prepare(
            &cache,
            &fake.base,
            KEY,
            format!("%PDF-synthetic-{i}").into_bytes(),
            scope,
        ))
        .unwrap();
    }
    assert_eq!(cache.ready_len(), 16);
    assert_eq!(fake.count(|r| r.is_delete()), 1);
    assert!(!fake.exists("files/synthetic-1"), "the oldest is retired");
    assert!(fake.exists("files/synthetic-17"));
}

#[test]
fn an_abandoned_preparation_releases_its_waiters_and_the_key() {
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.finalize_gate = Some(gate.clone()));
    let cache = cache();
    let bytes = b"%PDF-synthetic-abandoned".to_vec();
    let first = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    wait_for("the upload to be held", || gate.waiting() == 1);
    let waiter = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    wait_for("a waiter to join", || cache.stats().coalesced == 1);
    first.abort();
    let outcome = join(waiter);
    assert!(
        outcome.unwrap_err().contains("interrupted"),
        "the waiter does not hang"
    );
    assert!(cache.lock().flights.is_empty(), "the key is free again");
    gate.open();
}

#[test]
fn credentials_are_kept_only_as_a_hash() {
    let credential = credential_of(KEY);
    assert_eq!(credential.len(), 64);
    assert!(!credential.contains("synthetic"));
    assert_ne!(credential, credential_of(OTHER_KEY));
}

#[test]
fn provider_file_resources_are_held_to_the_documented_contract() {
    let base = "https://generativelanguage.googleapis.com";
    let good = json!({"file": {
        "name": "files/abc-123", "uri": "https://generativelanguage.googleapis.com/v1beta/files/abc-123",
        "mimeType": "application/pdf", "state": "ACTIVE", "expirationTime": "2026-10-20T12:00:00.123456Z"
    }});
    let file = parse_file(&good, base, "application/pdf").unwrap();
    assert_eq!(file.state, FileState::Active);
    assert_eq!(file.expires_at, Some(1_792_497_600));

    let mut bad = good.clone();
    bad["file"]["uri"] = json!("https://evil.example/v1beta/files/abc-123");
    assert!(
        parse_file(&bad, base, "application/pdf").is_err(),
        "a foreign URI is never followed"
    );
    let mut bad = good.clone();
    bad["file"]["name"] = json!("files/../../x");
    assert!(parse_file(&bad, base, "application/pdf").is_err());
    let mut bad = good.clone();
    bad["file"]["mimeType"] = json!("text/plain");
    assert!(parse_file(&bad, base, "application/pdf").is_err());
    let mut bad = good.clone();
    bad["file"]["expirationTime"] = json!("tomorrow");
    assert!(parse_file(&bad, base, "application/pdf").is_err());
    let mut processing = good;
    processing["file"]["state"] = json!("PROCESSING");
    assert_eq!(
        parse_file(&processing, base, "application/pdf")
            .unwrap()
            .state,
        FileState::Processing
    );
}

#[test]
fn timestamps_are_read_exactly() {
    assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(parse_rfc3339("2023-11-14T22:13:20Z"), Some(1_700_000_000));
    assert_eq!(
        parse_rfc3339("2023-11-15T00:13:20+02:00"),
        Some(1_700_000_000)
    );
    assert_eq!(parse_rfc3339("2024-02-29T00:00:00.5Z"), Some(1_709_164_800));
    for bad in [
        "",
        "2023-13-01T00:00:00Z",
        "2023-11-14 22:13:20Z",
        "2023-11-14T22:13:20",
        "2023-11-14T22:13:20.Z",
    ] {
        assert_eq!(parse_rfc3339(bad), None, "{bad}");
    }
}

/* ------------------------------------------------------------------ */
/* Review round 1 regressions (GENREL01-R1 to R4)                      */
/* ------------------------------------------------------------------ */

/// Prepare on this thread and keep the lease.
fn prepare_now<'a>(
    cache: &'a PreparedSources,
    base: &str,
    bytes: &[u8],
    scope: &str,
) -> Result<Lease<'a>, String> {
    let content = sha(bytes);
    let source = Source {
        bytes,
        content_sha256: &content,
        mime: "application/pdf",
        scope,
    };
    tauri::async_runtime::block_on(cache.prepare(
        &http(),
        base,
        KEY,
        &source,
        cache.epoch(),
        None,
        &Budget::new(crate::gemini_budget::ACTIVE_BUDGET),
        &|_| {},
    ))
}

fn key_of(cache: &PreparedSources, base: &str, bytes: &[u8], scope: &str) -> PrepKey {
    cache.key_for(
        base,
        KEY,
        &Source {
            bytes,
            content_sha256: &sha(bytes),
            mime: "application/pdf",
            scope,
        },
    )
}

fn finish(cache: &PreparedSources, lease: Lease<'_>) {
    tauri::async_runtime::block_on(cache.finish(lease, &http(), KEY));
}

#[test]
fn r1_a_cached_copy_confirmed_after_disconnect_is_refused_not_returned() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r1-cached".to_vec();
    finish(
        &cache,
        prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap(),
    );
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.lookup_gate = Some(gate.clone()));
    let held = spawn_prepare(&cache, &fake.base, KEY, bytes, "documents/a.pdf");
    wait_for("the reuse check to be held", || gate.waiting() == 1);
    cache.invalidate_all();
    gate.open();
    assert_eq!(join(held), Err(STALE_CONTEXT.to_string()));
    assert_eq!(fake.count(|r| r.is_upload_finalize()), 1, "no new upload");
    assert_eq!(cache.stats().reuses, 0, "the old copy was not handed out");
}

#[test]
fn r1_a_shared_result_taken_up_after_disconnect_is_refused() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r1-shared".to_vec();
    let epoch = cache.epoch();
    let lease = prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap();
    let shared = lease.prepared().clone();
    drop(lease);
    cache.invalidate_all();
    let key = key_of(&cache, &fake.base, &bytes, "documents/a.pdf");
    assert!(matches!(
        cache.adopt(&key, epoch, shared),
        Err(m) if m == STALE_CONTEXT
    ));
}

#[test]
fn r1_an_operation_begun_before_disconnect_never_uploads_after_it() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r1-old-epoch".to_vec();
    let content = sha(&bytes);
    let old = cache.epoch();
    cache.invalidate_all();
    let source = Source {
        bytes: &bytes,
        content_sha256: &content,
        mime: "application/pdf",
        scope: "documents/a.pdf",
    };
    let outcome = tauri::async_runtime::block_on(cache.prepare(
        &http(),
        &fake.base,
        KEY,
        &source,
        old,
        None,
        &Budget::new(crate::gemini_budget::ACTIVE_BUDGET),
        &|_| {},
    ));
    assert!(matches!(outcome, Err(m) if m == STALE_CONTEXT));
    assert_eq!(fake.log().len(), 0, "nothing was sent at all");
    assert_eq!(cache.ready_len(), 0);
}

#[test]
fn r1_a_lease_from_an_ended_context_is_no_longer_current() {
    let fake = FakeGemini::start();
    let cache = cache();
    let lease = prepare_now(
        &cache,
        &fake.base,
        b"%PDF-synthetic-r1-lease",
        "documents/a.pdf",
    )
    .unwrap();
    assert!(lease.is_current());
    let retired = cache.invalidate_all();
    assert_eq!(
        retired.len(),
        1,
        "ending the context retires even a leased copy"
    );
    assert!(!lease.is_current());
}

#[test]
fn r2_replacing_content_defers_deleting_a_copy_still_in_use() {
    let fake = FakeGemini::start();
    let cache = cache();
    let lease_a = prepare_now(
        &cache,
        &fake.base,
        b"%PDF-synthetic-r2-AAAA",
        "documents/a.pdf",
    )
    .unwrap();
    let name_a = lease_a.prepared().name.clone();
    finish(
        &cache,
        prepare_now(
            &cache,
            &fake.base,
            b"%PDF-synthetic-r2-BBBB",
            "documents/a.pdf",
        )
        .unwrap(),
    );
    assert_eq!(
        cache.ready_len(),
        1,
        "the new content replaced the old entry"
    );
    assert!(fake.exists(&name_a), "a copy in use is not deleted");
    assert_eq!(fake.count(|r| r.is_delete()), 0);
    finish(&cache, lease_a);
    assert!(!fake.exists(&name_a), "deleted once its last user is done");
    assert_eq!(fake.count(|r| r.is_delete()), 1);
}

#[test]
fn r2_a_shared_copy_retired_before_it_is_taken_up_is_not_handed_out() {
    let fake = FakeGemini::start();
    let cache = cache();
    let a = b"%PDF-synthetic-r2-share-A".to_vec();
    let epoch = cache.epoch();
    let lease = prepare_now(&cache, &fake.base, &a, "documents/a.pdf").unwrap();
    let shared = lease.prepared().clone();
    finish(&cache, lease);
    // Changed bytes at the same selected source retire A before a waiter that
    // was handed A gets to take it up.
    finish(
        &cache,
        prepare_now(
            &cache,
            &fake.base,
            b"%PDF-synthetic-r2-share-B",
            "documents/a.pdf",
        )
        .unwrap(),
    );
    assert!(!fake.exists(&shared.name));
    let key = key_of(&cache, &fake.base, &a, "documents/a.pdf");
    assert!(matches!(cache.adopt(&key, epoch, shared), Ok(None)));
}

#[test]
fn r2_eviction_defers_deleting_a_copy_a_generation_still_uses() {
    let fake = FakeGemini::start();
    let cache = cache();
    let first = prepare_now(
        &cache,
        &fake.base,
        b"%PDF-synthetic-r2-evict-0",
        "documents/e0.pdf",
    )
    .unwrap();
    for i in 1..=16 {
        let scope = format!("documents/e{i}.pdf");
        let bytes = format!("%PDF-synthetic-r2-evict-{i}").into_bytes();
        finish(
            &cache,
            prepare_now(&cache, &fake.base, &bytes, &scope).unwrap(),
        );
    }
    assert_eq!(cache.ready_len(), 16);
    assert!(fake.exists("files/synthetic-1"), "evicted but still in use");
    assert_eq!(fake.count(|r| r.is_delete()), 0);
    finish(&cache, first);
    assert!(!fake.exists("files/synthetic-1"));
    assert_eq!(fake.count(|r| r.is_delete()), 1);
}

#[test]
fn r3_choosing_a_copy_and_owning_an_upload_are_one_step() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r3-claim".to_vec();
    let key = key_of(&cache, &fake.base, &bytes, "documents/a.pdf");
    let epoch = cache.epoch();
    let (first, _) = cache.claim(&key, epoch, None);
    assert!(matches!(first, Claim::Own(..)));
    let (second, _) = cache.claim(&key, epoch, None);
    assert!(
        matches!(second, Claim::Join(_)),
        "a second caller joins; it can never also own an upload"
    );
}

#[test]
fn r3_concurrent_revalidations_of_a_lost_copy_upload_it_once() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r3-lost".to_vec();
    finish(
        &cache,
        prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap(),
    );
    fake.vanish("files/synthetic-1");
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.lookup_gate = Some(gate.clone()));
    let one = spawn_prepare(&cache, &fake.base, KEY, bytes.clone(), "documents/a.pdf");
    let two = spawn_prepare(&cache, &fake.base, KEY, bytes, "documents/a.pdf");
    wait_for("both reuse checks to be held", || gate.waiting() == 2);
    gate.open();
    let (one, two) = (join(one).unwrap(), join(two).unwrap());
    assert_eq!(one.name, two.name);
    assert_eq!(one.name, "files/synthetic-2");
    assert_eq!(
        fake.count(|r| r.is_upload_finalize()),
        2,
        "the original and exactly one replacement"
    );
    assert_eq!(cache.ready_len(), 1);
}

#[test]
fn r4_a_failed_check_while_a_cached_copy_is_processing_is_reported_without_uploading() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r4".to_vec();
    finish(
        &cache,
        prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap(),
    );
    fake.set_state("files/synthetic-1", "PROCESSING");
    fake.behave(|b| b.lookup_script = vec![None, Some(500)]);
    let error = match prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf") {
        Ok(_) => panic!("a failed check must not be treated as ready"),
        Err(e) => e,
    };
    assert!(error.contains("busy"), "{error}");
    assert_eq!(
        fake.count(|r| r.is_upload_finalize()),
        1,
        "a lookup failure is never turned into an upload"
    );
    assert_eq!(fake.count(|r| r.is_lookup()), 2);
}

#[test]
fn r4_a_cached_copy_google_reports_failed_is_prepared_again_once() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r4-failed".to_vec();
    finish(
        &cache,
        prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap(),
    );
    // Google now reports the copy FAILED: explicitly unusable.
    fake.set_state("files/synthetic-1", "FAILED");
    let lease = prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap();
    assert_eq!(lease.prepared().name, "files/synthetic-2");
    assert_eq!(fake.count(|r| r.is_upload_finalize()), 2);
}

/* ------------------------------------------------------------------ */
/* Review round 2 regressions (GENREL01-R6 to R8)                      */
/* ------------------------------------------------------------------ */

#[test]
fn r6_cancelling_during_cleanup_before_the_upload_releases_the_flight_and_its_waiters() {
    let fake = FakeGemini::start();
    let cache = cache();
    finish(
        &cache,
        prepare_now(
            &cache,
            &fake.base,
            b"%PDF-synthetic-r6-AAAA",
            "documents/a.pdf",
        )
        .unwrap(),
    );
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.delete_gate = Some(gate.clone()));
    let b_bytes = b"%PDF-synthetic-r6-BBBB".to_vec();
    // Owns B's flight, then waits while A (replaced) is deleted.
    let owner = spawn_prepare(&cache, &fake.base, KEY, b_bytes.clone(), "documents/a.pdf");
    wait_for("A's deletion to be held", || gate.waiting() == 1);
    let waiter = spawn_prepare(&cache, &fake.base, KEY, b_bytes, "documents/a.pdf");
    wait_for("a waiter to join B", || cache.stats().coalesced == 1);
    owner.abort();
    let outcome = join(waiter);
    assert!(
        outcome.unwrap_err().contains("interrupted"),
        "the waiter is released, not stranded"
    );
    assert!(cache.lock().flights.is_empty(), "the key is free again");
    assert_eq!(fake.count(|r| r.is_upload_start()), 1, "B never started");
    gate.open();
}

#[test]
fn r7_cancelling_during_eviction_cleanup_leaves_no_ownership_behind() {
    let fake = FakeGemini::start();
    let cache = cache();
    for i in 0..16 {
        let scope = format!("documents/f{i}.pdf");
        let bytes = format!("%PDF-synthetic-r7-{i}").into_bytes();
        finish(
            &cache,
            prepare_now(&cache, &fake.base, &bytes, &scope).unwrap(),
        );
    }
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.delete_gate = Some(gate.clone()));
    let newest = spawn_prepare(
        &cache,
        &fake.base,
        KEY,
        b"%PDF-synthetic-r7-new".to_vec(),
        "documents/new.pdf",
    );
    wait_for("the evicted copy's deletion to be held", || {
        gate.waiting() == 1
    });
    newest.abort();
    wait_for("the cancelled lease to be released", || {
        cache.lock().in_use.is_empty()
    });
    gate.open();
    // The cancelled caller's copy can still be retired later.
    fake.behave(|b| b.delete_gate = None);
    finish(
        &cache,
        prepare_now(
            &cache,
            &fake.base,
            b"%PDF-synthetic-r7-changed",
            "documents/new.pdf",
        )
        .unwrap(),
    );
    assert!(!fake.exists("files/synthetic-17"), "replaced and deleted");
    assert!(cache.lock().deferred.is_empty());
}

#[test]
fn r8_an_owner_whose_context_ends_during_cleanup_never_starts_its_upload() {
    let fake = FakeGemini::start();
    let cache = cache();
    finish(
        &cache,
        prepare_now(
            &cache,
            &fake.base,
            b"%PDF-synthetic-r8-AAAA",
            "documents/a.pdf",
        )
        .unwrap(),
    );
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.delete_gate = Some(gate.clone()));
    let owner = spawn_prepare(
        &cache,
        &fake.base,
        KEY,
        b"%PDF-synthetic-r8-BBBB".to_vec(),
        "documents/a.pdf",
    );
    wait_for("A's deletion to be held", || gate.waiting() == 1);
    cache.invalidate_all();
    gate.open();
    assert_eq!(join(owner), Err(STALE_CONTEXT.to_string()));
    assert_eq!(
        fake.count(|r| r.is_upload_start()),
        1,
        "only A was uploaded"
    );
    assert!(cache.lock().flights.is_empty());
}

#[test]
fn r8_a_fresh_copy_whose_context_ends_during_eviction_cleanup_is_refused() {
    let fake = FakeGemini::start();
    let cache = cache();
    for i in 0..16 {
        let scope = format!("documents/g{i}.pdf");
        let bytes = format!("%PDF-synthetic-r8-{i}").into_bytes();
        finish(
            &cache,
            prepare_now(&cache, &fake.base, &bytes, &scope).unwrap(),
        );
    }
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.delete_gate = Some(gate.clone()));
    let newest = spawn_prepare(
        &cache,
        &fake.base,
        KEY,
        b"%PDF-synthetic-r8-new".to_vec(),
        "documents/new.pdf",
    );
    wait_for("the evicted copy's deletion to be held", || {
        gate.waiting() == 1
    });
    cache.invalidate_all();
    gate.open();
    assert_eq!(join(newest), Err(STALE_CONTEXT.to_string()));
}

/* ------------------------------------------------------------------ */
/* Review round 3 regressions (GENREL01-R10, R11)                      */
/* ------------------------------------------------------------------ */

#[test]
fn r10_a_permission_refusal_on_the_reuse_check_never_uploads_again() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r10-cached".to_vec();
    finish(
        &cache,
        prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap(),
    );
    fake.behave(|b| b.lookup_status = Some(403));
    let error = match prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf") {
        Ok(_) => panic!("a 403 is not a confirmation"),
        Err(e) => e,
    };
    assert!(error.contains("did not allow this key"), "{error}");
    assert_eq!(fake.count(|r| r.is_upload_start()), 1, "no second upload");
}

#[test]
fn r10_a_permission_refusal_while_processing_never_uploads_again() {
    let fake = FakeGemini::start();
    let cache = cache();
    let bytes = b"%PDF-synthetic-r10-processing".to_vec();
    finish(
        &cache,
        prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap(),
    );
    fake.set_state("files/synthetic-1", "PROCESSING");
    fake.behave(|b| b.lookup_script = vec![None, Some(403)]);
    let error = match prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf") {
        Ok(_) => panic!("a 403 is not a confirmation"),
        Err(e) => e,
    };
    assert!(error.contains("did not allow this key"), "{error}");
    assert_eq!(fake.count(|r| r.is_upload_start()), 1, "no second upload");
}

#[test]
fn r11_file_names_follow_the_documented_pattern() {
    assert!(valid_name("files/abc-123"));
    assert!(valid_name(&format!("files/{}", "a".repeat(40))));
    for bad in [
        "files/",
        "files/-abc",
        "files/abc-",
        "files/ABC",
        "files/a_b",
        "files/a/b",
        "other/abc",
    ] {
        assert!(!valid_name(bad), "{bad}");
    }
    assert!(!valid_name(&format!("files/{}", "a".repeat(41))));
}

#[test]
fn r12_shared_copy_crossing_expiry_margin_is_not_adopted() {
    let fake = FakeGemini::start();
    let now = Arc::new(AtomicI64::new(1_700_000_000));
    let clock = now.clone();
    let cache = PreparedSources::new(policy(), Arc::new(move || clock.load(Ordering::SeqCst)));
    fake.behave(|b| b.expiration_time = Some("2023-11-15T00:00:00Z".into()));
    let bytes = b"%PDF-synthetic-shared-expiry";
    let lease = prepare_now(&cache, &fake.base, bytes, "documents/a.pdf").unwrap();
    let shared = lease.prepared().clone();
    finish(&cache, lease);
    now.store(
        shared.expires_at - policy().reuse_margin_secs,
        Ordering::SeqCst,
    );
    let key = key_of(&cache, &fake.base, bytes, "documents/a.pdf");
    assert!(matches!(cache.adopt(&key, cache.epoch(), shared), Ok(None)));
    assert_eq!(cache.stats().reuses, 0);
}

#[test]
fn r12_expiry_is_rechecked_after_a_slow_cached_confirmation() {
    let fake = FakeGemini::start();
    let now = Arc::new(AtomicI64::new(1_700_000_000));
    let clock = now.clone();
    let cache = Arc::new(PreparedSources::new(
        policy(),
        Arc::new(move || clock.load(Ordering::SeqCst)),
    ));
    fake.behave(|b| b.expiration_time = Some("2023-11-15T00:00:00Z".into()));
    let bytes = b"%PDF-synthetic-confirm-expiry".to_vec();
    let lease = prepare_now(&cache, &fake.base, &bytes, "documents/a.pdf").unwrap();
    let old = lease.prepared().clone();
    finish(&cache, lease);
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.lookup_gate = Some(gate.clone()));
    let held = spawn_prepare(&cache, &fake.base, KEY, bytes, "documents/a.pdf");
    wait_for("cached lookup", || gate.waiting() == 1);
    now.store(
        old.expires_at - policy().reuse_margin_secs,
        Ordering::SeqCst,
    );
    // The confirmation returns the old expiration, but the subsequent fresh
    // upload receives a new lifetime.
    gate.open();
    let result = join(held).unwrap();
    assert_ne!(result.name, old.name);
    assert_eq!(cache.stats().reuses, 0);
    assert_eq!(fake.count(|q| q.is_upload_finalize()), 2);
}

/* ------------------------------------------------------------------ */
/* GENREL04-R11: every generation-owned DELETE is admitted on its own  */
/* ------------------------------------------------------------------ */

fn retired_pair(fake: &FakeGemini) -> Vec<Retired> {
    ["files/synthetic-91", "files/synthetic-92"]
        .into_iter()
        .map(|name| Retired {
            credential: credential_of(KEY),
            base: fake.base.clone(),
            name: name.to_string(),
        })
        .collect()
}

/// Run `cleanup` with two copies to delete. The first DELETE is held; while
/// it is held the generation is cancelled through admission alone (no token,
/// no wake). Only that first DELETE may ever reach Google.
fn assert_one_delete_then_stop(
    label: &str,
    cleanup: impl FnOnce(&PreparedSources, &Client, &Budget, Vec<Retired>) + Send,
) {
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.delete_gate = Some(gate.clone()));
    let cache = cache();
    let budget = crate::gemini_budget::Budget::new(Duration::from_secs(60));
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let admitted = cancelled.clone();
    budget.attach_admission(Arc::new(move || !admitted.load(Ordering::SeqCst)));
    let http = http();
    let retired = retired_pair(&fake);
    std::thread::scope(|scope| {
        let running = scope.spawn(|| cleanup(&cache, &http, &budget, retired));
        wait_for(&format!("{label}: the first DELETE to be held"), || {
            gate.waiting() == 1
        });
        cancelled.store(true, Ordering::SeqCst);
        gate.open();
        running.join().unwrap();
    });
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(
        fake.count(|r| r.is_delete()),
        1,
        "{label}: no DELETE after the cancel"
    );
    let waiting: Vec<String> = cache
        .lock()
        .orphaned
        .iter()
        .map(|r| r.name.clone())
        .collect();
    assert_eq!(
        waiting,
        vec!["files/synthetic-92".to_string()],
        "{label}: queued for later"
    );
}

#[test]
fn r11_retiring_admits_each_delete_and_stops_at_a_cancel() {
    assert_one_delete_then_stop("retire_admitted", |cache, http, budget, retired| {
        tauri::async_runtime::block_on(cache.retire_admitted(http, KEY, retired, budget));
    });
}

#[test]
fn r11_finishing_admits_each_delete_and_stops_at_a_cancel() {
    assert_one_delete_then_stop("finish_admitted", |cache, http, budget, retired| {
        let lease = Lease {
            cache,
            id: Retired {
                credential: credential_of(KEY),
                base: "unused".to_string(),
                name: "files/synthetic-held".to_string(),
            },
            epoch: cache.epoch(),
            prepared: Prepared {
                name: "files/synthetic-held".to_string(),
                uri: "unused".to_string(),
                mime: "application/pdf".to_string(),
                expires_at: i64::MAX,
                reused: false,
            },
        };
        cache.lock().orphaned.extend(retired);
        tauri::async_runtime::block_on(cache.finish_admitted(lease, http, KEY, budget));
    });
}

/// Unlike R11, cancellation drops the cleanup while DELETE is still pending.
fn assert_dropped_cleanup_keeps_unsent(finishing: bool) {
    use crate::gemini_cancel::{CancelToken, Cancellable, Cancelled};
    let fake = FakeGemini::start();
    let gate = Arc::new(Gate::default());
    fake.behave(|b| b.delete_gate = Some(gate.clone()));
    let cache = cache();
    let budget = Budget::new(Duration::from_secs(60));
    let token = Arc::new(CancelToken::default());
    let http = http();
    let retired = retired_pair(&fake);
    let lease = finishing
        .then(|| prepare_now(&cache, &fake.base, b"%PDF-r12", "documents/r12.pdf").unwrap());
    std::thread::scope(|scope| {
        let running = scope.spawn(|| {
            tauri::async_runtime::block_on(Cancellable::new(
                async {
                    if let Some(lease) = lease {
                        cache.lock().orphaned.extend(retired);
                        cache.finish_admitted(lease, &http, KEY, &budget).await;
                    } else {
                        cache.retire_admitted(&http, KEY, retired, &budget).await;
                    }
                },
                token.clone(),
            ))
        });
        wait_for("R12 first DELETE held", || gate.waiting() == 1);
        token.cancel();
        assert_eq!(running.join().unwrap(), Err(Cancelled));
        // Keep the first request held until after the cleanup future is gone.
        assert_eq!(fake.count(|r| r.is_delete()), 1);
        let queued: Vec<_> = cache
            .lock()
            .orphaned
            .iter()
            .map(|r| r.name.clone())
            .collect();
        gate.open();
        assert_eq!(
            queued,
            vec!["files/synthetic-92"],
            "the unsent copy survives the dropped future"
        );
    });
    fake.behave(|b| b.delete_gate = None);
    let pending = std::mem::take(&mut cache.lock().orphaned);
    tauri::async_runtime::block_on(cache.retire_admitted(&http, KEY, pending, &budget));
    assert_eq!(
        fake.count(|r| r.is_delete()),
        2,
        "a later cleanup sends the retained copy once"
    );
    assert!(cache.lock().orphaned.is_empty());
}

#[test]
fn r12_dropped_retire_returns_unsent_copies_to_orphaned() {
    assert_dropped_cleanup_keeps_unsent(false);
}

#[test]
fn r12_dropped_finish_returns_unsent_copies_to_orphaned() {
    assert_dropped_cleanup_keeps_unsent(true);
}

#[test]
fn r12_cancellable_drop_keeps_only_unsent_entries_without_transport() {
    use crate::gemini_cancel::{CancelToken, Cancellable, Cancelled};
    use std::future::Future;
    use std::task::{Context, Poll, Wake, Waker};

    struct Noop;
    impl Wake for Noop {
        fn wake(self: Arc<Self>) {}
    }
    let cache = cache();
    let copy = |name: &str| Retired {
        credential: credential_of(KEY),
        base: "http://127.0.0.1:1".to_string(),
        name: name.to_string(),
    };
    let token = Arc::new(CancelToken::default());
    let mut dispatched = None;
    let mut work = Box::pin(Cancellable::new(
        async {
            let mut pending = PendingRetirements {
                cache: &cache,
                unsent: [
                    copy("files/first"),
                    copy("files/second"),
                    copy("files/third"),
                ]
                .into(),
            };
            dispatched = pending.unsent.pop_front();
            std::future::pending::<()>().await;
        },
        token.clone(),
    ));
    let waker = Waker::from(Arc::new(Noop));
    let mut cx = Context::from_waker(&waker);
    assert!(work.as_mut().poll(&mut cx).is_pending());
    token.cancel();
    assert_eq!(work.as_mut().poll(&mut cx), Poll::Ready(Err(Cancelled)));
    drop(work);
    assert_eq!(dispatched.unwrap().name, "files/first");
    let queued: Vec<_> = cache
        .lock()
        .orphaned
        .iter()
        .map(|r| r.name.clone())
        .collect();
    assert_eq!(queued, ["files/second", "files/third"]);
}
