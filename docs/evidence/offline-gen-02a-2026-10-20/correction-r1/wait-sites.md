# Correction r1 wait-site audit

Author revalidation in `codex/offline-gen`, base `1097a4b2ab753df883f87c4277150e663191df88`; all work remains uncommitted.

`test_wait::wait_for` is compiled only through `#[cfg(test)] mod test_wait` in `lib.rs`. It uses a 30-second monotonic ceiling, polls every 5 ms (capped by the remaining ceiling), and names the awaited state and elapsed time on failure. No production behavior or durable-write code changed.

## Changed sites

The file-cache and search-API helper replacements apply to every caller listed below. Line numbers refer to the corrected tree.

### `src-tauri/src/gemini_batches.rs`

- Line 646, `removing_managed_source_while_response_is_held_keeps_draft_unpublished`: `wait_for("source-removal generation gate", || gate.waiting() > 0);`
- Line 804, `source_change_between_batches_and_resume_are_refused`: `wait_for("source-change generation request counter", || r.count() > 0);`
- Line 863, `cancellable_drop_restart_resume_preserves_ledger_and_unique_batches`: `wait_for("cancel/restart generation gate", || gate.waiting() > 0);`
- Line 873, `cancellable_drop_restart_resume_preserves_ledger_and_unique_batches`: `wait_for("abandoned generation answer queue to be consumed", || {`

### `src-tauri/src/gemini_files_tests.rs`

- Line 91, `concurrent_preparations_of_the_same_source_coalesce_into_one_upload`: `wait_for("the first upload to be held", || gate.waiting() == 1);`
- Line 94, `concurrent_preparations_of_the_same_source_coalesce_into_one_upload`: `wait_for("the others to join", || cache.stats().coalesced == 2);`
- Line 135, `distinct_sources_and_credentials_are_never_coalesced`: `wait_for("four separate uploads", || gate.waiting() == 4);`
- Line 152, `a_preparation_that_finishes_after_disconnect_is_never_published_and_its_upload_is_retired`: `wait_for("the upload to be held", || gate.waiting() == 1);`
- Line 155, `a_preparation_that_finishes_after_disconnect_is_never_published_and_its_upload_is_retired`: `wait_for("a waiter to join", || cache.stats().coalesced == 1);`
- Line 171, `a_preparation_that_finishes_after_disconnect_is_never_published_and_its_upload_is_retired`: `wait_for("its own upload to be deleted", || {`
- Line 197, `late_work_from_an_old_key_cannot_replace_the_new_keys_copy`: `wait_for("the old key's upload to be held", || gate.waiting() == 1);`
- Line 227, `late_work_from_an_old_key_cannot_replace_the_new_keys_copy`: `wait_for("the stale upload to be deleted", || {`
- Line 265, `an_abandoned_preparation_releases_its_waiters_and_the_key`: `wait_for("the upload to be held", || gate.waiting() == 1);`
- Line 267, `an_abandoned_preparation_releases_its_waiters_and_the_key`: `wait_for("a waiter to join", || cache.stats().coalesced == 1);`
- Line 401, `r1_a_cached_copy_confirmed_after_disconnect_is_refused_not_returned`: `wait_for("the reuse check to be held", || gate.waiting() == 1);`
- Line 593, `r3_concurrent_revalidations_of_a_lost_copy_upload_it_once`: `wait_for("both reuse checks to be held", || gate.waiting() == 2);`
- Line 669, `r6_cancelling_during_cleanup_before_the_upload_releases_the_flight_and_its_waiters`: `wait_for("A's deletion to be held", || gate.waiting() == 1);`
- Line 671, `r6_cancelling_during_cleanup_before_the_upload_releases_the_flight_and_its_waiters`: `wait_for("a waiter to join B", || cache.stats().coalesced == 1);`
- Line 704, `r7_cancelling_during_eviction_cleanup_leaves_no_ownership_behind`: `wait_for("the evicted copy's deletion to be held", || {`
- Line 708, `r7_cancelling_during_eviction_cleanup_leaves_no_ownership_behind`: `wait_for("the cancelled lease to be released", || {`
- Line 751, `r8_an_owner_whose_context_ends_during_cleanup_never_starts_its_upload`: `wait_for("A's deletion to be held", || gate.waiting() == 1);`
- Line 784, `r8_a_fresh_copy_whose_context_ends_during_eviction_cleanup_is_refused`: `wait_for("the evicted copy's deletion to be held", || {`
- Line 888, `r12_expiry_is_rechecked_after_a_slow_cached_confirmation`: `wait_for("cached lookup", || gate.waiting() == 1);`
- Line 936, `assert_one_delete_then_stop`: `wait_for(&format!("{label}: the first DELETE to be held"), || {`
- Line 1020, `assert_dropped_cleanup_keeps_unsent`: `wait_for("R12 first DELETE held", || gate.waiting() == 1);`

### `src-tauri/src/gemini_recovery_tests.rs`

- Line 426, `a_coalesced_waiter_has_its_own_deadline_without_cancelling_the_owner`: `crate::test_wait::wait_for("coalesced owner upload gate", || gate.waiting() == 1);`

### `src-tauri/src/extraction/search.rs`

- Line 1637, `point_b_a_later_tick_interrupts_the_running_statement`: `crate::test_wait::wait_for("watchdog repeated interrupt counter", || {`
- Line 1652, `point_b_a_later_tick_interrupts_the_running_statement`: `crate::test_wait::wait_for("watchdog deadline interrupt counter", || {`
- Line 1749, `newest_waiter_replaces_previous_without_running_its_resolver`: `crate::test_wait::wait_for("first resolver started gate", || started.try_recv().is_ok());`
- Line 1815, `a_replaced_disposable_cache_does_not_leave_an_old_connection_searchable`: `crate::test_wait::wait_for("replacement cache initialization ready", || {`
- Line 1851, `failed_background_initialization_can_be_retried_after_the_root_is_available`: `crate::test_wait::wait_for("missing-root initialization finished", || {`
- Line 1857, `failed_background_initialization_can_be_retried_after_the_root_is_available`: `crate::test_wait::wait_for("retried cache initialization ready", || {`

### `src-tauri/src/extraction/search/saved/tests.rs`

- Line 536, `a_tick_interrupts_a_rebuild_query_that_is_already_running`: `crate::test_wait::wait_for("running rebuild watchdog tick report", || {`
- Line 540, `a_tick_interrupts_a_rebuild_query_that_is_already_running`: `crate::test_wait::wait_for("SQLite reported SQLITE_INTERRUPT", || {`

### `src-tauri/src/extraction/service.rs`

- Line 736, `search_does_not_wait_for_the_hashing_and_extraction_slot`: `crate::test_wait::wait_for(`
- Line 818, `commands_report_initializing_without_admitting_a_search`: `crate::test_wait::wait_for("released search initialization gate", || {`

### `src-tauri/src/extraction/search_api/tests.rs`

- Line 8, `wait_ready`: `crate::test_wait::wait_for(`
- Line 73, `search`: `wait_ready(&self.svc);`
- Line 174, `fresh_session_after_restore_has_no_verified_files`: `wait_ready(&fresh);`
- Line 290, `validates_limits_and_never_queries_unready_storage`: `wait_ready(&f.svc);`

## Deliberately preserved waits

- `gemini_generation_tests.rs` and `gemini_cancel_flow_tests.rs`: 5,000 × 2 ms helper ceilings are already 10 seconds, outside the requested under-10-second cutoff.
- `extraction/search.rs`: the final interrupted-state observation remains tied to the explicit deadline + 100 ms assertion; changing it to 30 seconds would weaken a response-time requirement. The two watchdog readiness waits are changed; the deadline and interrupt assertions remain intact.
- `extraction/search_api/tests.rs`: the 5-second destination-check channel timeout proves that checking a result does not block on an occupied preparation slot; it remains a behavior assertion.
- Negative counter/journal observations after cancellation keep their observation sleeps; an immediate successful predicate could hide a late unwanted request. Stage-expiry, pacing, lock-duration, and timestamp sleeps also retain their intentional semantics.
- Unbounded readiness waits and the existing 30-second extraction crash-helper wait are outside the requested short-ceiling pattern. Synthetic loopback HTTP only; no provider or real profile used.
- `gemini_jobs.rs` matches its starting bytes: SHA256 `302883c6f649dd4a38c5c1d069c5fe81d67a9f95159d0cc49cdb771ac9920430`.

## Execution conditions

- Cargo env: `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`, `CARGO_TARGET_DIR=/Users/rickymac/code/Flight-training-offline-gen-00/src-tauri/target`, `CARGO_NET_OFFLINE=true`.
- `RUST_TEST_THREADS`: 'unset'; all three commands omit `--test-threads` and run consecutively.
- Sandbox denied process observation (`ps`), recorded as EXIT 127 in `sandbox-process-observation.log`; no permission escalation attempted. The receipt runner also cannot execute `ps` directly (PermissionError); wrapping the attempted observation in a shell preserves that failure receipt.
