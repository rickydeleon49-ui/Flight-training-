# M2 Practice Sessions PR 1: Boundary Validation Corrections Report, 4 October 2026

Executed in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-foundation`, base commit `01cd109c221d14caa6c0cf82180aebdc75111e59`.
Executed under the active assignment: [`docs/M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_CORRECTIONS_PROMPT_2026-10-04.md`](../../M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_CORRECTIONS_PROMPT_2026-10-04.md) addressing Codex re-review findings in [`docs/M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_REVIEW_2026-10-04.md`](../../M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_REVIEW_2026-10-04.md).
Governed by canonical scope Appendices B–E in [`docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md`](../../M2_PRACTICE_SESSION_SCOPE_2026-10-04.md) and owner approval in [`docs/M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md`](../../M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md).

All work remains uncommitted and unpushed for independent review by Codex.

---

## 1. Executive Summary of Corrections

This boundary correction pass resolves the Codex R3 boundary review findings across three core dimensions: registered-schema semantics (Section A), state and receipt invariant validation (Section B), and actual initialization & native/browser readiness wiring (Section C).

1. **Section A: Registered-Schema Semantics (`src-tauri/src/backup.rs`):**
   - **Dynamic In-Memory Reference Schema:** Dynamically executes `crate::migrations()` against an in-memory SQLite connection (`get_reference_schema_connection`) to inspect the authoritatively registered metadata.
   - **Table & Column Structure:** Verifies every table exists, and compares every column's name, type, `notnull`, and `pk` against the reference metadata via `PRAGMA table_info`.
   - **Compound Uniqueness Constraints:** Explicitly inspects `PRAGMA index_list` and `PRAGMA index_info` on reference vs active connections to enforce compound unique constraints on `practice_test_items(version_id, ordinal)` and `practice_responses(attempt_id, item_id)`.
   - **Unique Partial Indexes & Key Columns:** Verifies partial unique indexes `uq_active_practice_version` and `uq_single_in_progress_attempt`. Inspects key columns via `PRAGMA index_info` ensuring the indexed key column is exactly `["source_material_id"]` with correct `WHERE` predicates (`is_active = 1` and `status = 'in_progress' AND source_material_id IS NOT NULL`), rejecting same-name counterfeit indexes on other columns (such as `id`).
   - **Secondary Index Key Columns:** Verifies all secondary indexes (`idx_practice_versions_history`, `idx_practice_items_version`, `idx_practice_attempts_material`, `idx_practice_attempts_version`, `idx_practice_responses_attempt`, `idx_practice_ops_history`, `idx_practice_ops_attempt`) key column order matches reference index info (e.g. `(version_id, ordinal)` on items).
   - **Trigger Definitions & Semantics:** Inspects triggers against reference schema triggers using normalized SQL comparison (`normalize_sql`) and enforces presence of version enforcement and material deletion cleanup logic (`trg_enforce_response_item_version_insert`, `trg_enforce_response_item_version_update`, `trg_cleanup_material_delete`), refusing no-op counterfeit triggers.

2. **Section B: State & Receipt Invariant Validation (`src-tauri/src/backup.rs`):**
   - **Item Count & Ordinal Integrity:** Validates that each version contains between 1 and 200 items, and that ordinals are strictly contiguous and zero-based (`0..count`).
   - **In-Progress Attempt Progress Reconciliation:** Validates that an in-progress attempt's `total_questions` exactly matches the frozen version's item count and `answered_count` matches stored response rows, refusing artificial progress inflation (e.g. 99 total / 88 answered on a 1-item test).
   - **Exact 1-Decimal Grid Scoring:** Completely removed the former ±0.05 score tolerance; derives completed attempt score percent on an exact 1-decimal grid (`((stored_cor as f64 * 1000.0) / total as f64).round() / 10.0`) and requires an exact match (`recomputed_score != stored_score` refuses).
   - **Action-Specific Receipt Fields & Version Binding:** Validates receipt fields: strictly enforces UUIDv4 format on `operation_id` (via regex checking version 4 and RFC 4122 variant bits), 64-hex SHA-256 string for `request_hash`, ISO-8601 timestamps, and for `start_or_resume` and `retake_attempt` actions requires `result.versionId` to match the attempt's frozen `version_id`.

3. **Section C: Production Initialization & Native Readiness Wiring (`src-tauri/src/practice_sessions.rs`):**
   - **Readiness Scoped to Canonical Root & Generation:** Tracks readiness in-memory via `READY_ROOTS: Mutex<Option<HashMap<PathBuf, u64>>>` with per-root generations (`ROOT_GENERATIONS: Mutex<Option<HashMap<PathBuf, u64>>>`). No stale boolean is persisted across failures or restarts.
   - **Initialization Wired into Conversion:** `run_legacy_conversion_at(root)` executes migration/reconciliation on an owned connection/transaction, commits, drops the transaction, and executes `crate::backup::verify_application_database(&db_path)`. If validation fails, `unmark_root_ready(root)` is called and the failure is returned; only upon successful semantic validation is `mark_root_ready(root)` recorded.
   - **Direct Native Commands Refuse Uninitialized State:** `save_practice_session_at`, `save_practice_test_at`, and `remove_practice_test_at` check `if !is_root_ready(root) { return Err(PracticeSessionErrorCode::InvalidState.error()); }`. Native writers cannot bypass unperformed or failed initialization.
   - **Restore Invalidates Readiness:** When a pending restore is installed in `apply_pending_restore_in_internal`, `bump_readiness_generation_at(root)` invalidates the restored root's readiness, forcing re-initialization before native operations can proceed.
   - **Browser Readiness Equivalency:** In browser environments (`sqlJsDb.ts`, `singleConnectionDrivers.ts`), initialization invariants are enforced through single-connection transaction boundaries and localStorage durable recovery prior to exposing session capabilities.

---

## 2. Closure Checklist

| Criterion | Implementation Status | Production Entry Point | Test Proving Criterion |
| --- | --- | --- | --- |
| **A1. In-Memory Reference DB** | Completed | `get_reference_schema_connection` in `backup.rs` | `valid_schema_11_control_is_accepted` |
| **A2. Column Types, Not-Null, PK** | Completed | `verify_schema_11_semantics` in `backup.rs` | `missing_version_column_refused` |
| **A3. Compound Uniqueness** | Completed | `verify_schema_11_semantics` in `backup.rs` | `valid_schema_11_control_is_accepted` |
| **A4. Partial Index Keys & Predicates** | Completed | `verify_schema_11_semantics` in `backup.rs` | `codex_m2_final_review::unique_index_wrong_key_refused`, `counterfeit_unique_index_refused` |
| **A5. Secondary Index Key Columns** | Completed | `verify_schema_11_semantics` in `backup.rs` | `valid_schema_11_control_is_accepted` |
| **A6. Trigger Definitions & Semantics** | Completed | `verify_schema_11_semantics` in `backup.rs` | `codex_m2_final_review::no_op_ownership_trigger_refused` |
| **B1. 1..=200 Items & Contiguous Ordinals** | Completed | `verify_schema_11_semantics` in `backup.rs` | `req_13_legacy_startup_upgrade_and_200_questions` |
| **B2. In-Progress Attempt Tally Check** | Completed | `verify_schema_11_semantics` in `backup.rs` | `codex_m2_final_review::in_progress_false_totals_refused` |
| **B3. Exact 1-Decimal Scoring (No ±0.05)** | Completed | `verify_schema_11_semantics` in `backup.rs` | `null_completed_score_refused`, `frozen_key_score_is_derived` |
| **B4. UUIDv4, Hash, ISO Timestamps** | Completed | `verify_schema_11_semantics` in `backup.rs` | `malformed_receipt_json_is_refused`, `receipt_empty_object_refused` |
| **B5. Receipt Version Binding** | Completed | `verify_schema_11_semantics` in `backup.rs` | `codex_m2_final_review::receipt_wrong_frozen_version_refused` |
| **C1. Wiring Semantic Validation in Conversion** | Completed | `run_legacy_conversion_at` in `practice_sessions.rs` | `codex_m2_final_review::startup_conversion_and_native_write_refuse_invalid_state` |
| **C2. Root & Generation Readiness Scoping** | Completed | `READY_ROOTS`, `ROOT_GENERATIONS` in `practice_sessions.rs` | `codex_m2_final_review::startup_conversion_and_native_write_refuse_invalid_state` |
| **C3. Direct Native Writers Require Readiness** | Completed | `save_practice_session_at`, `save_practice_test_at`, `remove_practice_test_at` | `direct_native_writer_refuses_when_legacy_conversion_pending` |
| **C4. Restore Invalidates Readiness** | Completed | `bump_readiness_generation_at` in `backup.rs:4776, 5105` | `valid_schema_11_archive_round_trip`, `interrupted_restore_preserves_prior_state_and_safe_retry` |
| **C5. Browser Initialization Invariants** | Completed | `createTauriDatabase`, `createSqlJsDatabase` in `tauriDb.ts`, `sqlJsDb.ts` | Vitest suites (`singleConnectionDrivers.test.ts`, `practiceSessionContract.test.ts`) |

---

## 3. Evidence of Corrections: Fail-Before vs. Pass-After

### Initial Six R3 Regressions
- **Fail-Before Log:** `corrections/01-r3-fail-before.txt`
  - Demonstrates initial 6 failures (`receipt_empty_object_refused`, `out_of_range_stored_response_refused`, `cross_material_attempt_refused`, `counterfeit_unique_index_refused`, `missing_version_column_refused`, `null_completed_score_refused`).
- **Pass-After Log:** `corrections/02-r3-pass-after.txt`
  - Demonstrates all 145 backup tests passing with the initial R3 fixes in place.

### Five Boundary Review Regressions from `remaining.rs`
- **Fail-Before Log:** `corrections/03-r3-boundary-fail-before.txt`
  - Command: `cargo test --manifest-path src-tauri/Cargo.toml backup::tests::codex_m2_final_review`
  - Result: All 5 review tests failed against pre-correction boundary state:
    - `unique_index_wrong_key_refused ... FAILED`
    - `no_op_ownership_trigger_refused ... FAILED`
    - `receipt_wrong_frozen_version_refused ... FAILED`
    - `in_progress_false_totals_refused ... FAILED`
    - `startup_conversion_and_native_write_refuse_invalid_state ... FAILED`
- **Pass-After Log:** `corrections/04-r3-boundary-pass-after.txt`
  - Command: `cargo test --manifest-path src-tauri/Cargo.toml backup::tests::codex_m2_final_review`
  - Result: All 5 review tests passed cleanly with 0 failures:
    - `test backup::tests::codex_m2_final_review::unique_index_wrong_key_refused ... ok`
    - `test backup::tests::codex_m2_final_review::no_op_ownership_trigger_refused ... ok`
    - `test backup::tests::codex_m2_final_review::receipt_wrong_frozen_version_refused ... ok`
    - `test backup::tests::codex_m2_final_review::in_progress_false_totals_refused ... ok`
    - `test backup::tests::codex_m2_final_review::startup_conversion_and_native_write_refuse_invalid_state ... ok`

---

## 4. Sequential Verification Gate Results (All 8 Gates Passed)

All 8 gates executed sequentially on Mac (macOS Darwin aarch64, Node v22.23.3, rustc 1.99.0, SDK 26.5):

| Gate | Command | Output Log | Exit Code | Verified Counts / Result |
| --- | --- | --- | --- | --- |
| **Gate 1: Typecheck** | `npm run typecheck` | `gate/01-typecheck.txt` | `0` | Zero TypeScript errors |
| **Gate 2: Frontend Tests** | `npm test` | `gate/02-npm-test.txt` | `0` | **82 test files passed** (3 bench skipped, 85 total); **2,488 tests passed** (4 skipped, 2,492 total) |
| **Gate 3: Production Build** | `npm run build` | `gate/03-build.txt` | `0` | Production build clean in 809ms, 297 modules transformed |
| **Gate 4: Locked Rust Tests** | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked` | `gate/04-cargo-test.txt` | `0` | **380 passed**, 0 failed, 6 ignored in 22.02s |
| **Gate 5: Clippy** | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` | `gate/05-clippy.txt` | `0` | Zero warnings (`-D warnings` enforced) |
| **Gate 6: Rustfmt Check** | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | `gate/06-fmt.txt` | `0` | All files match rustfmt formatting rules |
| **Gate 7: Cargo Lock Sync** | `git diff --exit-code src-tauri/Cargo.lock` | `gate/07-cargo-lock.txt` | `0` | Zero diff on `Cargo.lock` |
| **Gate 8: Git Status** | `git status --porcelain` | `gate/08-git-diff.txt` | `0` | Clean git status captured |

---

## 5. Status & Concrete Remaining Limitations

- **Checkout Status:** Uncommitted and unpushed in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-foundation`.
- **Review Readiness:** All R3 boundary corrections implemented, verified, and ready for independent re-review by Codex.
- **Concrete Remaining Limitations:**
  - PR 2 UI work (practice session questions view, progress indicators, retake dialogs, response buttons) is intentionally not implemented in this persistence foundation PR.
  - Desktop UI and live application runtime behavior remain unverified until PR 2 interface integration.
  - Installed DMG, code signing, and release packaging are out of scope for PR 1 and remain deferred.
