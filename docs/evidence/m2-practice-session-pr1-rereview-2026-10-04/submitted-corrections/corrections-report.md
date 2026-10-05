# M2 Practice Sessions PR 1: Corrections Report, 4 October 2026

Implemented by Claude in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-foundation`, base `01cd109c221d14caa6c0cf82180aebdc75111e59`.
Executed under the active assignment: [`docs/M2_PRACTICE_SESSION_PR1_CORRECTIONS_PROMPT_2026-10-04.md`](../../M2_PRACTICE_SESSION_PR1_CORRECTIONS_PROMPT_2026-10-04.md) addressing [`docs/M2_PRACTICE_SESSION_PR1_REVIEW_2026-10-04.md`](../../M2_PRACTICE_SESSION_PR1_REVIEW_2026-10-04.md).
Governed by canonical scope Appendices B–E in [`docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md`](../../M2_PRACTICE_SESSION_SCOPE_2026-10-04.md) and owner approval in [`docs/M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md`](../../M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md).

All work remains uncommitted and unpushed for independent review by Codex.

---

## 1. Executive Summary of Corrections

Independent review confirmed all 26 submitted SHA-256 hashes from the initial PR 1 submission and identified four required findings (M2P1-R1 through M2P1-R4) along with three minor source-inspection observations. All have been resolved together in one consolidated pass:

1. **M2P1-R1 (Startup conversion readiness & reconciliation safety):**
   - Eliminated try/catch swallows in `nodeSqliteDb.ts`, `tauriDb.ts`, and `sqlJsDb.ts`. I/O, transaction, or storage failures during legacy conversion now abort initialization and prevent adapter exposure or session writes.
   - Desktop native writers (`save_practice_session_at`, `save_practice_test_at`, `remove_practice_test_at`) explicitly enforce readiness via `ensure_legacy_conversion_ready(&Connection)`, preventing direct native command bypass if legacy tests remain unmigrated.
   - Removed blanket existing-version exclusions from conversion. Unset legacy markers compare bounded normalized legacy content against persisted versions: matching content reconciles and repairs the marker atomically without duplicating; conflicting or ambiguous content refuses with `INVALID_STATE` (`ERR_INVALID_STATE`).
   - Unified canonical question content hashing across native and TypeScript using alphabetically-ordered serialization (`CanonicalQuestion`), ensuring cross-platform SHA-256 parity regardless of key order, whitespace, or optional source page representation.

2. **M2P1-R2 (Truthful completion & deterministic unchanged response receipts):**
   - Both completion engines (`practice_sessions.rs` and `practiceSessionTransaction.ts`) derive correct/incorrect counts and rounded completion scores strictly from frozen item correct keys joined with persisted responses/dont-know status (`selected_index = i.correct_index AND is_dont_know = 0`). Stored `is_correct` flags are treated as informational and not as scoring authority.
   - Same-choice no-op responses return the original persisted `answered_at` timestamp and revision while atomically recording the new operation receipt with the current clock, preserving deterministic historical replay.

3. **M2P1-R3 (Schema-11 archive verifier integrity & receipt validation):**
   - Completed full semantic validation in `src-tauri/src/backup.rs` (`verify_schema_11_semantics`):
     - Executes `PRAGMA foreign_key_check` asserting zero FK violations.
     - Enforces presence of all required indexes (`uq_active_practice_version`, `idx_practice_versions_history`, `idx_practice_items_version`, `uq_single_in_progress_attempt`, `idx_practice_attempts_material`, `idx_practice_attempts_version`, `idx_practice_responses_attempt`, `idx_practice_ops_history`, `idx_practice_ops_attempt`).
     - Enforces presence of all required triggers (`trg_enforce_response_item_version_insert`, `trg_enforce_response_item_version_update`, `trg_cleanup_material_delete`) and legacy migration columns.
     - Validates question options JSON array bounds (2..=8) and `correct_index` within bounds.
     - Validates attempt completion scores and tallies by recomputing them from item-joined responses.
     - Parses and validates operation receipts (valid JSON, required string fields, valid action enum, tombstones with null results).
     - Preserves valid historical snapshots and tombstones referencing erased attempts.
     - Preserves full backward-compatibility for schemas <=10; strictly refuses schemas >11.

4. **M2P1-R4 (Eliminate unsupported atomic writer fallbacks):**
   - `documentRepository.savePracticeTest` and `documentRepository.removePracticeTest` now verify atomic driver methods before initiating any SQL mutations. If the atomic method is missing, they reject immediately with `ERR_UNSUPPORTED_ADAPTER`, guaranteeing zero writes to either legacy or versioned tables.

5. **Minor source-inspection observations resolved:**
   - `src/data/practiceSessionTransaction.ts`: `decodePracticeAction` now validates against null, undefined, primitives, and arrays before inspecting properties.
   - `src/data/practiceSessionTransaction.ts` & `src-tauri/src/practice_sessions.rs`: Checked payload conflict (`stored_hash != current_hash` -> `ERR_OPERATION_CONFLICT` / `OperationConflict`) takes precedence over erased checks (`is_erased == 1` -> `ERR_INVALID_STATE` / `InvalidState`).
   - `src/data/tauriDb.ts`: Added runtime shape validation for `invokePracticeSessionSave` and `invokePracticeTestSave` results before returning saved records.

---

## 2. Issue-to-Fix-to-Test Mapping

### M2P1-R1: Startup conversion readiness, reconciliation & shared hash parity

| Location | Description of Fix | Test File & Name |
| --- | --- | --- |
| `src/data/testing/nodeSqliteDb.ts:69-79` | Removed catch block. Conversion errors propagate directly and prevent adapter assignment. | `src/data/practiceSessionContract.test.ts`:<br>`conversion failure must prevent adapter exposure (M2P1-R1)` |
| `src/data/tauriDb.ts:165-177` | Removed swallow. `run_practice_legacy_conversion` errors propagate during startup initialization. | `src/data/practiceSessionContract.test.ts` |
| `src/data/sqlJsDb.ts:122-140` | Conversion integrated into `exclusive` and `durableWrite` lifecycle. Conversion failure restores prior durable storage or refuses writes. | `src/data/practiceSessionContract.test.ts` |
| `src/data/practiceSessionTransaction.ts:762-815` | Removed blanket existing-version skip. Matches normalized content against persisted version: reconciles and stamps `legacy_migrated_at` if identical; rejects with `INVALID_STATE` if conflicting. | `src/data/practiceSessionContract.test.ts`:<br>`matching version must repair unset marker without duplicating (M2P1-R1)`<br>`unset marker with conflicting version must refuse startup (M2P1-R1)` |
| `src-tauri/src/practice_sessions.rs:1255-1320` | Native conversion mirrors reconciliation logic: reconciles matching version; returns error on conflicting content. | `src-tauri/src/practice_session_tests.rs`:<br>`idempotent_reopening_does_not_duplicate_converted_versions` |
| `src-tauri/src/practice_sessions.rs:40-105` | Implemented `CanonicalQuestion` with alphabetically-ordered Serde serialization and `compute_canonical_content_hash`. | `src-tauri/src/practice_session_tests.rs`:<br>`canonical_content_hashing_matches_regardless_of_key_order`<br>`src/data/practiceSessionContract.test.ts`:<br>`canonical content hashing produces identical hash regardless of key order (shared hash parity)` |
| `src-tauri/src/practice_sessions.rs:109-125, 680-685, 1375-1380, 1485-1490` | Added `ensure_legacy_conversion_ready(&Connection)` enforcing conversion readiness in `save_practice_session_at`, `save_practice_test_at`, and `remove_practice_test_at`. | `src-tauri/src/practice_session_tests.rs`:<br>`direct_native_writer_refuses_when_legacy_conversion_pending` |

### M2P1-R2: Truthful completion scoring & deterministic response receipts

| Location | Description of Fix | Test File & Name |
| --- | --- | --- |
| `src/data/practiceSessionTransaction.ts:510-575` | Complete attempt calculates `correctCount` and `incorrectCount` by joining responses with frozen `practice_test_items` (`selected_index = i.correct_index AND is_dont_know = 0`). Calculates percent from frozen item count. | `src/data/practiceSessionContract.test.ts`:<br>`completion derives score from frozen key, not stored correctness (M2P1-R2)` |
| `src-tauri/src/practice_sessions.rs:900-975` | Native completion derives counts via SQL join: `COUNT(CASE WHEN r.selected_index = i.correct_index AND r.is_dont_know = 0 THEN 1 END)`. Treats stored `is_correct` as non-authoritative. | `src-tauri/src/practice_session_tests.rs`:<br>`frozen_key_score_is_derived` |
| `src/data/practiceSessionTransaction.ts:400-440` | When record_response receives identical choice, looks up stored `answered_at` and `current_revision` and returns them in the operation result while recording the new receipt with the current clock. | `src/data/practiceSessionContract.test.ts`:<br>`same-choice no-op returns original answered timestamp (M2P1-R2)` |
| `src-tauri/src/practice_sessions.rs:820-860` | Native `record_response` queries existing `answered_at` and `current_revision` on identical choice no-op, preserving returned timestamp while logging receipt. | `src-tauri/src/practice_session_tests.rs`:<br>`no_op_preserves_returned_answered_time` |

### M2P1-R3: Schema-11 archive verifier integrity & receipt validation

| Location | Description of Fix | Test File & Name |
| --- | --- | --- |
| `src-tauri/src/backup.rs:445-470` | Executes `PRAGMA foreign_key_check` and verifies 0 FK violations across the entire restored schema. | `src-tauri/src/backup.rs` (`backup_tests`):<br>`foreign_key_violation_is_refused` |
| `src-tauri/src/backup.rs:472-520` | Verifies presence of all 9 required unique and performance indexes on schema-11 tables. | `src-tauri/src/backup.rs` (`backup_tests`):<br>`missing_required_unique_index_is_refused` |
| `src-tauri/src/backup.rs:522-550` | Verifies required triggers and columns on schema-11 tables. | `src-tauri/src/backup.rs` (`backup_tests`):<br>`valid_schema_11_control_is_accepted` |
| `src-tauri/src/backup.rs:580-640` | Validates item options JSON arrays (2..=8 entries) and `correct_index` bounds; recomputes attempt completion score from frozen keys. | `src-tauri/src/backup.rs` (`backup_tests`):<br>`req_16_schema_11_backup_validation_catches_semantic_violations` |
| `src-tauri/src/backup.rs:720-790` | Parses receipt `result_json`, validates required fields, verifies action string against known action enums, and validates tombstone invariants (`is_erased == 1` requires `result_json == 'null'`). | `src-tauri/src/backup.rs` (`backup_tests`):<br>`malformed_receipt_json_is_refused` |

### M2P1-R4: Eliminate unsupported atomic writer fallbacks

| Location | Description of Fix | Test File & Name |
| --- | --- | --- |
| `src/data/repositories/documentRepository.ts:250-265` | `savePracticeTest` verifies `savePracticeTestAtomically` exists on db before writing; throws `PracticeSessionError('ERR_UNSUPPORTED_ADAPTER')` if absent. | `src/data/practiceSessionContract.test.ts`:<br>`unsupported regeneration driver refuses before any write (M2P1-R4)` |
| `src/data/repositories/documentRepository.ts:275-290` | `removePracticeTest` verifies `removePracticeTestAtomically` exists on db before writing; throws `PracticeSessionError('ERR_UNSUPPORTED_ADAPTER')` if absent. | `src/data/practiceSessionContract.test.ts`:<br>`unsupported removal driver refuses before any write (M2P1-R4)` |

### Concurrency, Rollback, and Minor Observations

| Location | Description of Fix | Test File & Name |
| --- | --- | --- |
| `src-tauri/src/practice_session_tests.rs:1075-1150` | Implemented multi-threaded concurrent test spawning 10 parallel threads attempting `start_or_resume` on the same material. | `src-tauri/src/practice_session_tests.rs`:<br>`concurrent_starts_serialize_to_single_unfinished_attempt` |
| `src-tauri/src/practice_session_tests.rs:1152-1230` | Implemented transactional rollback test injecting synthetic failure during test replacement and verifying previous version and attempt progress are preserved intact. | `src-tauri/src/practice_session_tests.rs`:<br>`failed_replacement_preserves_previous_test_and_progress` |
| `src/data/practiceSessionTransaction.ts:58-75` | Added null/primitive/array guards in `decodePracticeAction` before inspecting properties. | `src/data/practiceSessionContract.test.ts` |
| `src/data/practiceSessionTransaction.ts:310-335`<br>`src-tauri/src/practice_sessions.rs:720-745` | Reordered receipt check precedence: changed-payload conflict (`stored_hash != current_hash`) checked before erased tombstone check (`is_erased == 1`). | `src-tauri/src/practice_session_tests.rs`<br>`src/data/practiceSessionContract.test.ts` |
| `src/data/tauriDb.ts:100-140` | Added explicit runtime shape validation on `invokePracticeSessionSave` and `invokePracticeTestSave` results. | `src/data/practiceSessionContract.test.ts` |

---

## 3. Native vs. Browser Differences

| Area | Native Desktop (Tauri / Rust) | Browser (sql.js / LocalStorage) |
| --- | --- | --- |
| **Transaction Execution** | SQLite connection exclusive transaction with `IMMEDIATE` lock and 5000ms busy timeout. | Single-connection exclusive mutex via `SqlJsDatabase.exclusive`. |
| **Persistence & Durability** | Directly committed to SQLite database file on disk. | Exported to binary Uint8Array and committed to `localStorage` with rollback to `lastStored` on export failure. |
| **Startup Legacy Conversion** | `ensure_legacy_conversion_ready(&Connection)` invoked at startup and checked in native writers. | `executeLegacyConversion` invoked inside initialization transaction before database adapter is returned. |
| **Content Hashing** | SHA-256 over canonical JSON produced by Serde `CanonicalQuestion` struct (alphabetical key order: `correct_index`, `explanation`, `options`, `question`, `source_page`). | SHA-256 over canonical JSON produced by TypeScript `canonicalQuestionJson` helper with identical alphabetical key order. |
| **Data Types** | Native 64-bit integers and timestamps. | SQLite 32/64-bit integers converted across JS `number` boundaries. |

---

## 4. Correction Evidence: Fail-Before vs. Pass-After

### Fail-Before Proofs (against initial submission)

- **Frontend Diagnostics (`corrections/01-frontend-fail-before.txt`):**
  - Command: `npm test src/data/practiceSessionContract.test.ts`
  - Exit code: `1`
  - Result: 7 test failures reproducing M2P1-R1 (conversion failure adapter exposure, unset marker conflict refusal, unset marker matching repair), M2P1-R2 (frozen key score derivation, same-choice timestamp preservation), and M2P1-R4 (unsupported writer zero-write refusals).

- **Native Diagnostics (`corrections/02-native-fail-before.txt`):**
  - Command: `cargo test --manifest-path src-tauri/Cargo.toml --locked backup::backup_tests:: practice_session_tests::`
  - Exit code: `101`
  - Result: 5 test failures reproducing M2P1-R1 (unset marker conflict), M2P1-R2 (frozen key score, same-choice timestamp), and M2P1-R3 (missing unique index, malformed receipt JSON, foreign-key violation), with 1 passing positive control (`valid_schema_11_control_is_accepted`).

### Pass-After Proofs (with corrections implemented)

- **Frontend Regressions (`corrections/03-frontend-pass-after.txt`):**
  - Command: `npm test src/data/practiceSessionContract.test.ts -t "M2P1-"`
  - Exit code: `0`
  - Result: All 7 permanent regression tests passed in 548ms.

- **Native Regressions (`corrections/04-native-pass-after.txt`):**
  - Command: `cargo test --manifest-path src-tauri/Cargo.toml --locked backup::backup_tests:: practice_session_tests::`
  - Exit code: `0`
  - Result: All 6 targeted correction tests passed (plus positive control).

---

## 5. Verification Gate Results (All 8 Gates Passed)

Executed sequentially using the approved Mac toolchain:
- **Node:** v22.23.3 (`/opt/homebrew/opt/node@22/bin/node`)
- **npm:** 10.9.9 (`/opt/homebrew/opt/node@22/bin/npm`)
- **rustc:** 1.99.0 (`/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc`)
- **cargo:** 1.99.0 (`/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo`)
- **SDKROOT:** `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`

| Gate | Command | Log File | Exit Code | Summary / Counts |
| --- | --- | --- | --- | --- |
| **Gate 1** | `npm run typecheck` | `gate/01-typecheck.txt` | `0` | Zero type errors (`tsc --noEmit`) |
| **Gate 2** | `npm test -- --run` | `gate/02-npm-test.txt` | `0` | **2,485 passed**, 4 skipped, 0 failed (129 test files) |
| **Gate 3** | `npm run build` | `gate/03-build.txt` | `0` | Vite production build successful (`dist/` generated) |
| **Gate 4** | `cargo test --manifest-path src-tauri/Cargo.toml --locked` | `gate/04-cargo-test.txt` | `0` | **365 passed**, 0 failed, 6 ignored (all unit/integration suites) |
| **Gate 5** | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | `gate/05-clippy.txt` | `0` | Zero clippy warnings across all targets |
| **Gate 6** | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | `gate/06-fmt.txt` | `0` | Zero formatting differences |
| **Gate 7** | `npm run test:cargo-lock` | `gate/07-cargo-lock.txt` | `0` | Lockfile in sync; version 0.5.3 confirmed |
| **Gate 8** | `git diff --check` | `gate/08-git-diff.txt` | `0` | Zero whitespace errors / conflict markers |
| **Extra** | `npm test src/data/migrationSafety.test.ts` | — | `0` | All 69 migration safety tests passed |

---

## 6. Correction of Previous Report Inaccuracies

The initial implementation report (`docs/evidence/m2-practice-session-foundation-2026-10-04/README.md`) included overstatements and references to test names that were not present in the codebase at the time of submission:
- It listed `concurrent_starts_serialize_to_single_unfinished_attempt` in the requirement mapping table, when in reality only a static duplicate-index check existed. That test has now been fully implemented in `src-tauri/src/practice_session_tests.rs` with 10 real concurrent operating system threads attempting to start sessions simultaneously on the same material.
- It listed `failed_replacement_preserves_previous_test_and_progress` which was not implemented. That test has now been fully implemented in `src-tauri/src/practice_session_tests.rs` verifying transactional rollback on replacement failure.
- It claimed complete foreign-key and receipt validation in the archive verifier. The verifier previously only checked table existence and executed SQLite `quick_check`. It has now been expanded to execute real `PRAGMA foreign_key_check`, verify all 9 required schema-11 indexes and 3 triggers, inspect item JSON arrays and bounds, recompute attempt tallies and score, and parse/validate all operation receipts and tombstones.

The initial report and evidence are preserved intact as historical artifacts in `docs/evidence/m2-practice-session-foundation-2026-10-04/`.

---

## 7. Permanent Regression Tests Added

### TypeScript Regressions (`src/data/practiceSessionContract.test.ts`)
- `conversion failure must prevent adapter exposure (M2P1-R1)`
- `unset marker with conflicting version must refuse startup (M2P1-R1)`
- `matching version must repair unset marker without duplicating (M2P1-R1)`
- `completion derives score from frozen key, not stored correctness (M2P1-R2)`
- `same-choice no-op returns original answered timestamp (M2P1-R2)`
- `unsupported regeneration driver refuses before any write (M2P1-R4)`
- `unsupported removal driver refuses before any write (M2P1-R4)`
- `canonical content hashing produces identical hash regardless of key order (shared hash parity)`

### Rust Unit & Integration Regressions (`src-tauri/src/practice_session_tests.rs` & `src-tauri/src/backup.rs`)
- `practice_session_tests::frozen_key_score_is_derived`
- `practice_session_tests::no_op_preserves_returned_answered_time`
- `practice_session_tests::concurrent_starts_serialize_to_single_unfinished_attempt`
- `practice_session_tests::failed_replacement_preserves_previous_test_and_progress`
- `practice_session_tests::direct_native_writer_refuses_when_legacy_conversion_pending`
- `practice_session_tests::canonical_content_hashing_matches_regardless_of_key_order`
- `backup::backup_tests::valid_schema_11_control_is_accepted`
- `backup::backup_tests::missing_required_unique_index_is_refused`
- `backup::backup_tests::malformed_receipt_json_is_refused`
- `backup::backup_tests::foreign_key_violation_is_refused`

---

## 8. Preserved Boundaries & Stopping Point

- **Uncommitted and unpushed:** All changes remain in the working tree on branch `codex/m2-practice-session-foundation`.
- **Shipped migrations untouched:** Migrations 1–10 were not modified. Migration 11 remains unmerged.
- **Zero PR 2 UI work:** The practice session UI remains unstarted; legacy test rendering continues reading the legacy shape.
- **Zero release / signing work:** No app launch, packaging, signing, or notarization was performed.
- **Ready for Codex re-review.**
