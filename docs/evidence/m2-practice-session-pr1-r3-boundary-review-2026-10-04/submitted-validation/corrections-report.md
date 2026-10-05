# M2 Practice Sessions PR 1: Validation Corrections Report, 4 October 2026

Executed in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-foundation`, base commit `01cd109c221d14caa6c0cf82180aebdc75111e59`.
Executed under the active assignment: [`docs/M2_PRACTICE_SESSION_PR1_VALIDATION_CORRECTIONS_PROMPT_2026-10-04.md`](../../M2_PRACTICE_SESSION_PR1_VALIDATION_CORRECTIONS_PROMPT_2026-10-04.md) addressing Codex re-review findings.
Governed by canonical scope Appendices B–E in [`docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md`](../../M2_PRACTICE_SESSION_SCOPE_2026-10-04.md) and owner approval in [`docs/M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md`](../../M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md).

All work remains uncommitted and unpushed for independent review by Codex.

---

## 1. Executive Summary of Corrections

This validation correction pass resolves all remaining findings from the re-review, specifically completing finding M2P1-R3 as a comprehensive, bounded invariant validator, establishing demonstrated failure-before and recovery proofs, correcting all report metrics, and executing the full 8-gate verification suite.

1. **R3 Invariant Validator Completed (`src-tauri/src/backup.rs`):**
   - **Required Schema & Column Introspection:** Validates presence and types of every required column across all five practice tables (`practice_test_versions`, `practice_test_items`, `practice_attempts`, `practice_responses`, `practice_session_operations`) as well as legacy tracking columns in `practice_tests` (`legacy_migrated_at`, `legacy_error`) via `PRAGMA table_info`. Missing required columns (e.g., `model`) are rejected even if the affected table is empty.
   - **Index Introspection & Anti-Counterfeit Verification:** Rather than checking index names alone, queries `PRAGMA index_list` and verifies `[unique] == 1` and inspects `sqlite_master` SQL predicates (`is_active = 1`, `status = 'in_progress'`), actively refusing same-name non-unique counterfeit replacements.
   - **Trigger & Cleanup Semantics:** Verifies presence and definitions of required consistency and cleanup triggers (`trg_enforce_response_item_version_insert`, `trg_enforce_response_item_version_update`, `trg_cleanup_material_delete`).
   - **Cross-Material & Ownership Consistency:** Enforces that attempt `source_material_id` matches the version's `source_material_id` (`a.source_material_id = v.source_material_id`), that response `version_id` matches the attempt version, and that operation receipt `history_key` matches version `history_key`. Foreign-key success alone does not permit cross-material linkage.
   - **Content Bounds & Ordinal Integrity:** Validates question text length (1..=10,000), explanation length (<=5,000), source page bounds (1..=1,000), options JSON array length (2..=8 strings, each 1..=1,000 chars), and `correct_index` bounds. Validates that stored response `selected_index` does not exceed the referenced item's option array count.
   - **Derived Completion Scores & Mandatory Scores:** Completed attempts strictly require non-NULL `completed_at` and non-NULL `score_percent` (refusing NULL completed score). Tallies (`correct_count`, `incorrect_count`, `dont_know_count`, `unanswered_count`) and score percent are recomputed from frozen item answer keys and validated for exact match.
   - **Action-Specific Operation Receipts:** Parses receipt `result_json`, refusing empty objects (`{}`) or arbitrary strings. Requires valid action enums, verifies attempt/history association, and validates action-specific required fields (`attemptId`, `versionId`, `status`, `answeredAt`, `completedAt`, tallies, score). Enforces tombstone rules (`is_erased == 1` requires `result_json == 'null'`).
   - **Backward Compatibility:** Preserves existing validation rules for schemas <=10 and strictly refuses schemas >11.

2. **Six Demonstrated Native Rejections Promoted to Permanent Regressions:**
   - `receipt_empty_object_refused`
   - `out_of_range_stored_response_refused`
   - `cross_material_attempt_refused`
   - `counterfeit_unique_index_refused`
   - `missing_version_column_refused`
   - `null_completed_score_refused`
   - Fail-before logs captured in `corrections/01-r3-fail-before.txt` showing all 6 failing. Pass-after logs captured in `corrections/02-r3-pass-after.txt` showing all 145 backup tests passing.

3. **Recovery & Restore Tests Added (`src-tauri/src/backup.rs`):**
   - `valid_schema_11_archive_round_trip`: Full archive creation, extraction, staging, installation, and semantic database verification on schema 11 database.
   - `legacy_schema_10_archive_upgrade_round_trip`: Full round-trip backup of schema 10 database, restore, migration 11 execution, legacy conversion, and successful validation as schema 11.
   - `interrupted_conversion_preserves_state_and_safe_retry`: Demonstrates transaction rollback during interrupted legacy conversion (via synthetic trigger failure), verifies prior state is preserved intact with zero partial version writes, and proves safe retry converts cleanly.
   - `interrupted_restore_preserves_prior_state_and_safe_retry`: Demonstrates install failure with recovery rollback restoring original database bytes, followed by safe retry successfully installing the restore.

4. **Exercised Mid-Write Transactional Replacement Rollback (`src-tauri/src/practice_session_tests.rs`):**
   - Extended `failed_replacement_preserves_previous_test_and_progress` to test both upfront malformed JSON rejection AND synthetic mid-write failure via trigger abort during item insertion of valid replacement questions. Proves prior version remains active, attempt progress/revision is preserved, and legacy `practice_tests` row is intact.

5. **Runtime Wire Shape Validation & Unit-Return Contract (`src/data/tauriDb.ts` & `src/data/practiceSessionContract.test.ts`):**
   - `validatePracticeActionResult` in `tauriDb.ts` validates live and replayed action results, rejecting incomplete wire shapes (such as string `attemptId` alone) with `IPC_TRANSPORT_ERROR`.
   - Unit-return contract verified for `invokePracticeTestSave` and `invokeRemovePracticeTest`.

6. **Report Metric Corrections:**
   - Concurrent test: uses two actual concurrent OS threads (`t1`, `t2` in `concurrent_starts_serialize_to_single_unfinished_attempt`), not ten.
   - Canonical question keys: serialized in alphabetical order using camelCase keys (`correctIndex`, `explanation`, `options`, `question`, `sourcePage`).
   - Frontend test counts: accurately reported as 82 passed test files (3 skipped bench files, 85 total files) and 2488 passed tests (4 skipped tests, 2492 total tests).

---

## 2. Issue-to-Fix-to-Test Mapping

| Sub-item | Issue & Specification | Implementation Location | Test Location & Name |
| --- | --- | --- | --- |
| **R3.1: Empty Receipt Object Refusal** | Receipt `result_json` must not accept empty `{}` or arbitrary non-action JSON; must validate action-specific structure. | `src-tauri/src/backup.rs:1095-1185` | `src-tauri/src/backup.rs`:<br>`receipt_empty_object_refused` |
| **R3.2: Stored Response Upper Bounds** | Selected index must be validated against referenced item's option count, refusing `selected_index=99` for a 2-option question. | `src-tauri/src/backup.rs:855-875` | `src-tauri/src/backup.rs`:<br>`out_of_range_stored_response_refused` |
| **R3.3: Cross-Material Attempt Refusal** | Attempt `source_material_id` must match version `source_material_id`; operation `history_key` must match version `history_key`. Foreign-key constraint alone does not prove cross-material consistency. | `src-tauri/src/backup.rs:705-725` | `src-tauri/src/backup.rs`:<br>`cross_material_attempt_refused` |
| **R3.4: Counterfeit Unique Index Refusal** | Index verification must inspect SQLite `[unique]` status via `pragma_index_list` and predicate in `sqlite_master`, refusing same-name non-unique indexes. | `src-tauri/src/backup.rs:565-620` | `src-tauri/src/backup.rs`:<br>`counterfeit_unique_index_refused` |
| **R3.5: Missing Required Version Column** | Column verification must check all required columns on all 5 practice tables and legacy tracking columns, refusing missing columns (e.g. `model`) even when table is empty. | `src-tauri/src/backup.rs:510-560` | `src-tauri/src/backup.rs`:<br>`missing_version_column_refused` |
| **R3.6: Completed Attempt Score Required** | Completed attempt cannot have NULL `score_percent`; recomputed score and tallies must match derived values. | `src-tauri/src/backup.rs:945-1010` | `src-tauri/src/backup.rs`:<br>`null_completed_score_refused` |
| **R3.7: Schema 11 Archive Round Trip** | Verify consistent backup creation, extraction, staging, and restore installation of schema 11 database. | `src-tauri/src/backup.rs:11166-11225` | `src-tauri/src/backup.rs`:<br>`valid_schema_11_archive_round_trip` |
| **R3.8: Legacy Schema 10 Upgrade Round Trip** | Verify schema 10 backup passes validation, restores cleanly, upgrades to schema 11, converts legacy tests, and validates as schema 11. | `src-tauri/src/backup.rs:11227-11295` | `src-tauri/src/backup.rs`:<br>`legacy_schema_10_archive_upgrade_round_trip` |
| **R3.9: Interrupted Conversion Safe Retry** | Interrupted conversion must roll back cleanly without partial writes, preserving prior state, and safely succeed on retry. | `src-tauri/src/backup.rs:11297-11380` | `src-tauri/src/backup.rs`:<br>`interrupted_conversion_preserves_state_and_safe_retry` |
| **R3.10: Interrupted Restore Safe Retry** | Installation fault triggers recovery rollback preserving original database bytes, and subsequent retry installs cleanly. | `src-tauri/src/backup.rs:11382-11448` | `src-tauri/src/backup.rs`:<br>`interrupted_restore_preserves_prior_state_and_safe_retry` |
| **Replacement Rollback** | Mid-write failure during question replacement rolls back transaction, preserving active version, attempt progress, and legacy test row. | `src-tauri/src/practice_session_tests.rs:1195-1316` | `src-tauri/src/practice_session_tests.rs`:<br>`failed_replacement_preserves_previous_test_and_progress` |
| **Wire Shape Validation** | `validatePracticeActionResult` checks action-specific return shapes; unit return contract for save/remove test. | `src/data/tauriDb.ts:87-164` | `src/data/practiceSessionContract.test.ts`:<br>`string attemptId alone is insufficient...`<br>`validates action-specific wire shapes...`<br>`invokePracticeTestSave and invokeRemovePracticeTest adhere to unit-return contract` |

---

## 3. Evidence of Corrections: Fail-Before vs. Pass-After

### Fail-Before Proof
- **Log Location:** `corrections/01-r3-fail-before.txt`
- **Command:** `cargo test --manifest-path src-tauri/Cargo.toml --locked backup::tests::`
- **Result:** Exact 6 expected failures on submitted state before R3 implementation:
  - `receipt_empty_object_refused ... FAILED`
  - `out_of_range_stored_response_refused ... FAILED`
  - `cross_material_attempt_refused ... FAILED`
  - `counterfeit_unique_index_refused ... FAILED`
  - `missing_version_column_refused ... FAILED`
  - `null_completed_score_refused ... FAILED`

### Pass-After Proof
- **Log Location:** `corrections/02-r3-pass-after.txt`
- **Command:** `cargo test --manifest-path src-tauri/Cargo.toml --locked backup::tests:: -- --test-threads=1`
- **Result:** All 145 tests in `backup::tests::` passed (0 failed) in 30.62s, confirming all 6 regressions plus all recovery/restore tests pass alongside existing test coverage.

---

## 4. Sequential Verification Gate Results (All 8 Gates Passed)

All 8 gates executed sequentially on Mac (macOS Darwin aarch64, Node v22.23.3, rustc 1.99.0, SDK 26.5):

| Gate | Command | Output Log | Exit Code | Verified Counts / Result |
| --- | --- | --- | --- | --- |
| **Gate 1: Typecheck** | `npm run typecheck` | `gate/01-typecheck.txt` | `0` | Zero TypeScript errors |
| **Gate 2: Frontend Tests** | `npm test -- --run` | `gate/02-npm-test.txt` | `0` | **82 test files passed** (3 bench skipped, 85 total); **2,488 tests passed** (4 skipped, 2,492 total) |
| **Gate 3: Production Build** | `npm run build` | `gate/03-build.txt` | `0` | Production build clean in 808ms, 297 modules transformed |
| **Gate 4: Locked Rust Tests** | `cargo test --manifest-path src-tauri/Cargo.toml --locked` | `gate/04-cargo-test.txt` | `0` | **375 passed**, 0 failed, 6 ignored in 22.03s |
| **Gate 5: Clippy** | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | `gate/05-clippy.txt` | `0` | Zero warnings (`-D warnings` enforced) |
| **Gate 6: Formatting** | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | `gate/06-fmt.txt` | `0` | All files match rustfmt formatting rules |
| **Gate 7: Cargo Lock Sync** | `npm run test:cargo-lock` | `gate/07-cargo-lock.txt` | `0` | Toolchain and lockfile synchronized at v0.5.3 |
| **Gate 8: Diff Consistency** | `git diff --check` | `gate/08-git-diff.txt` | `0` | Zero whitespace or conflict artifacts |

---

## 5. Status & Concrete Remaining Limitations

- **Checkout Status:** Uncommitted and unpushed in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-foundation`.
- **Review Readiness:** Slices M2P1-R1 through M2P1-R4 corrected, tested with permanent regressions, and ready for independent re-review by Codex.
- **Concrete Remaining Limitations:**
  - PR 2 UI work (practice session questions view, progress indicators, retake dialogs, response buttons) is intentionally not implemented in this persistence foundation PR.
  - Desktop UI and live application runtime behavior remain unverified until PR 2 interface integration.
  - Installed DMG, code signing, and release packaging are out of scope for PR 1 and remain deferred.
