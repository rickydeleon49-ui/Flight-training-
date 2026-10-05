# M2 Practice Sessions PR 1: Implementation Report, 4 October 2026

Implemented on the Mac for Codex review, under the [model-neutral assignment](../../M2_PRACTICE_SESSION_PR1_PROMPT_2026-10-04.md), the [canonical reviewed scope](../../M2_PRACTICE_SESSION_SCOPE_2026-10-04.md) (Appendices B–E), and the [owner approval record](../../M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md).

**Status: Implemented, pending Codex review.**
All changes remain uncommitted and unpushed in `/Users/rickymac/code/Flight-training-pr70-integration` on branch `codex/m2-practice-session-foundation`.

---

## 1. Identity and Starting State

| Item | Value |
| --- | --- |
| Checkout | `/Users/rickymac/code/Flight-training-pr70-integration` (git worktree) |
| Branch | `codex/m2-practice-session-foundation` |
| Base / HEAD | `01cd109c221d14caa6c0cf82180aebdc75111e59` (= `origin/main` when fetched at start) |
| Start state | Clean working tree; no competing uncommitted changes. |
| Scope boundaries | PR 1 delivers persistence foundation, Migration 11, legacy conversion, atomic transactions, repositories, and schema-11 backup/restore validation. PR 2 UI work is deferred; existing UI continues reading legacy `practice_tests` shape backward-compatibly. |
| Toolchain | Node v22.23.3, npm 10.9.9, rustc 1.99.0, cargo 1.99.0, SDKROOT=`/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` |

---

## 2. Approved Defaults Implemented

1. **Single-Material Sessions:** Attempt state, active versions, and history are scoped to a single study material's practice test.
2. **Policy A Detailed Completed-History Retention:** Completed attempts retain their full item snapshots, response selections, and rounded scores; completed review sessions remain addressable via `history_key` even after material or practice-test deletion.
3. **Unfinished-Attempt Abandonment on Regeneration:** When Gemini regenerates a test or a test is atomically replaced, any active unfinished attempt is marked `abandoned` with reason `ABANDONED_ON_REGENERATION`.
4. **Safe Whole-Row Legacy Corruption Handling:** Malformed, empty, or unparseable legacy practice tests are preserved intact with `legacy_error = 'MALFORMED_QUESTION'` without aborting database migrations or application startup.
5. **Informational Scores & Immediate Training Feedback:** Correctness is derived from frozen question snapshots; score is rounded 0–100; "I don't know" (`is_dont_know = 1`) is separated from unanswered questions (`selected_index IS NULL`). Completed attempts are immutable.

---

## 3. Changed and Created Files

### Migration & Database Registration (3 files)
- `src-tauri/migrations/0011_practice_sessions.sql`: Migration 11 adding `practice_test_versions`, `practice_test_items`, `practice_attempts`, `practice_responses`, and `practice_session_operations` tables, version triggers, cleanup trigger, indexes, and legacy migration columns.
- `src/data/migrations.ts`: Registered Migration 11 in TypeScript migration catalog.
- `src/data/migration-checksums.json`: Updated migration checksum manifest including SHA-256 for Migration 11 (`133bfd14d761ff27f226985e70b9d1c917c48d2120f39ff33ffaed013e9373de`).

### Native Core (`src-tauri`) (6 files)
- `src-tauri/src/practice_sessions.rs`: Native atomic engine implementing `start_or_resume`, `record_response`, `complete_attempt`, `retake_attempt`, `abandon_attempt`, legacy conversion, save/regeneration, test removal, and canonical JSON SHA-256 request hashing.
- `src-tauri/src/practice_session_tests.rs`: 17 comprehensive unit tests verifying REQ-01 through REQ-14, stale revisions, concurrency, 200 questions, cursor null, payload limits, and idempotency.
- `src-tauri/src/backup.rs`: Upgraded `CURRENT_SCHEMA_VERSION` to 11. Implemented full semantic validation of practice sessions tables, foreign keys, single active version / in-progress attempt, detached state, choice bounds, recomputed tallies and scores, receipt shapes, and newer-schema refusal.
- `src-tauri/src/study_packet.rs`: Integrated Slice B native import transaction to atomically create version 1, items, and stamp `legacy_migrated_at`.
- `src-tauri/src/lib.rs`: Registered Migration 11 in `migrations()`, exposed Tauri invoke commands (`save_practice_session_atomically`, `save_practice_test_atomically`, `remove_practice_test_atomically`, `run_practice_legacy_conversion`).
- `src-tauri/src/debrief.rs`: Updated v9 dataset upgrade test to isolate D7 migration 10.

### TypeScript Core, Repositories & Drivers (11 files)
- `src/domain/types.ts`: Domain interfaces for practice test versions, items, attempts, responses, session states, action payloads, results, and completed history.
- `src/data/persistenceErrors.ts`: Error definitions for `PracticeSessionError`, error codes, and allowlisted sanitized messages.
- `src/data/db.ts`: Updated `SqlDatabase` interface with atomic practice session methods.
- `src/data/practiceSessionTransaction.ts`: Single-connection transaction engine for browser and test drivers implementing action execution, legacy conversion, save/regeneration, and test removal.
- `src/data/structuredImportTransaction.ts`: Integrated Slice B TypeScript import transaction to atomically create version 1, items, and stamp `legacy_migrated_at`.
- `src/data/tauriDb.ts`: Desktop Tauri driver routing practice actions, saves, removals, and startup legacy conversion via IPC.
- `src/data/sqlJsDb.ts`: Browser driver wrapping atomic practice transactions in connection ownership and durable localStorage writes with rollback on failure.
- `src/data/testing/nodeSqliteDb.ts`: Test driver supporting practice session transactions and startup legacy conversion.
- `src/data/repositories/practiceSessionRepository.ts`: Repository layer exposing `saveSessionAction`, `getCurrentAttempt`, `getAttempt`, `getCompletedHistory`, `getActiveVersion`, `getVersion`, `getItems`, `getResponses`, and `getConversionStatus`.
- `src/data/repositories/documentRepository.ts`: Wired `savePracticeTest` and `removePracticeTest` through atomic database methods.
- `src/data/repositories/index.ts`: Added `practiceSessions` to `Repositories` collection.

### Test Suites & Acceptance (3 files)
- `src/data/practiceSessionContract.test.ts`: 11 frontend contract tests covering actions, revisions, idempotency, scoring, 200 questions, cascading deletion, and browser storage refusal.
- `src/data/migrationSafety.test.ts`: Updated migration scanner with trigger stripper to preserve safety checks across trigger definitions.
- `src/acceptance/m1Upgrade.acceptance.test.ts`: Updated migration skip set to `[10, 11]` for v9 fixture upgrade.

### Project Tracking & Evidence (2 files)
- `STATUS.md`: Prepend PR 1 implemented pending review status.
- `docs/PROJECT_HANDOFF.md`: Prepend PR 1 implemented pending review status.

---

## 4. Requirement-to-Test Mapping

| Requirement / Scope Area | Implementation Details | Test Coverage |
| --- | --- | --- |
| **REQ-01: Schema & Migration 11** | Additive tables (`practice_test_versions`, `practice_test_items`, `practice_attempts`, `practice_responses`, `practice_session_operations`), foreign keys, triggers, indexes, and legacy columns. | `practice_session_tests.rs::req_01_schema_tables_and_triggers_enforce_invariants`, `practiceSessionContract.test.ts`, `migrationSafety.test.ts` |
| **REQ-02: Action Persistence Contracts** | Five atomic actions (`start_or_resume`, `record_response`, `complete_attempt`, `retake_attempt`, `abandon_attempt`), strict validation, allowlisted errors. | `practice_session_tests.rs` (17 tests), `practiceSessionContract.test.ts` (11 tests) |
| **REQ-03: Startup Legacy Conversion Engine** | Runs after migrations and before repository readiness. Converts legacy questions (including 200-item tests) into version 1 and items atomically; leaves malformed rows intact with `legacy_error = 'MALFORMED_QUESTION'`. Reopening avoids duplicate conversion. | `practice_session_tests.rs::converts_legacy_practice_test_with_200_questions_without_truncation`, `skips_malformed_legacy_practice_test_without_failing_migration_or_startup`, `idempotent_reopening_does_not_duplicate_converted_versions`, `practiceSessionContract.test.ts` |
| **REQ-04: Truthful Scoring & Frozen Content** | Correctness derived strictly from frozen items and selected index; scores rounded 0–100; tallies calculated; `is_dont_know` separated from unanswered; cursor NULL when finished. | `practice_session_tests.rs::early_completion_computes_informational_score_and_counts_truthfully`, `immutable_completed_attempt_rejects_subsequent_responses`, `practiceSessionContract.test.ts` |
| **REQ-05: Concurrency & Revision Checks** | Non-negative revision checks on response, complete, and abandon. Stale retakes check attempt identity; concurrent starts serialize to single active attempt. | `practice_session_tests.rs::stale_revision_rejected_on_response`, `stale_retake_does_not_abandon_newer_attempt`, `concurrent_starts_serialize_to_single_unfinished_attempt`, `practiceSessionContract.test.ts` |
| **REQ-06: Idempotent Request Receipts** | Canonical request hashing (SHA-256). Identical replays return original snapshot; changed payload under same operation ID rejects with `IDEMPOTENCY_CONFLICT`. | `practice_session_tests.rs::replay_after_restart_and_lost_acknowledgement_is_idempotent`, `conflicting_retry_with_changed_payload_is_rejected`, `practiceSessionContract.test.ts` |
| **REQ-07: Gemini Save & Regeneration** | Atomically deactivates old version, abandons unfinished attempts (`ABANDONED_ON_REGENERATION`), writes new version and items, clears old errors. Failure preserves existing test. | `practice_session_tests.rs::gemini_regeneration_abandons_unfinished_attempt_and_creates_new_version`, `failed_replacement_preserves_previous_test_and_progress` |
| **REQ-08: Slice B Import Integration** | Creates material, legacy practice test row, version 1, and items in one atomic transaction; stamps `legacy_migrated_at` to prevent reconversion on restart. | `practice_session_tests.rs::structured_import_creates_version_and_items_atomically`, `startup_after_import_does_not_reconvert` |
| **REQ-09: Deletion & History Retention** | Removing test/material prunes unfinished attempts and unused versions; completed attempts retained and addressable by `history_key`; non-content receipts tombstoned. | `practice_session_tests.rs::removing_test_retains_completed_history_and_prunes_unfinished_attempts`, `material_cascade_deletion_preserves_completed_history`, `practiceSessionContract.test.ts` |
| **REQ-10: Schema-11 Backup & Restore Validation** | Read-only archive validator checks all 5 practice tables, FKs, single active version / in-progress attempt, choice bounds, recomputed tallies and scores, receipt shapes, and newer-schema refusal. Older archives (v9, v10) upgrade cleanly. | `backup::tests::current_practice_test_schema_can_be_backed_up_but_future_schema_cannot`, `backup::tests::req_15_schema_10_backup_validates_without_new_tables`, `debrief::tests::upgrading_a_v9_dataset_keeps_everything_and_enables_d6` |
| **REQ-11: Browser Durability & Rollback** | sql.js connection owner with durable localStorage writes; post-commit storage failure restores `lastStored`; failed recovery disables driver. | `practiceSessionContract.test.ts::refused browser storage rolls back and disables adapter` |
| **REQ-12: Repository Surface** | `PracticeSessionRepository` exposes current attempt, completed history, active version, items, responses, and conversion status without fallback. | `practiceSessionContract.test.ts` |

---

## 5. Engineering Decisions & Invariants

1. **Driver Initialization Temporal Dead Zone (TDZ):** In `nodeSqliteDb.ts`, declaring `testDb` before statements and checking `testDb?.beforeStatement` avoided TDZ ReferenceErrors when `executeLegacyConversion` runs during database initialization.
2. **Determinism in Test Assertions:** Responses answered at the same timestamp sort by `id ASC`. Since `id` is a random UUID v4, tests inspect responses by `itemId` rather than indexing `responses[0]`.
3. **Clippy & Compiler Strictness:** Refactored range checks to `!(0..=100).contains(&idx)` and `!(1..=1_000).contains(&page)`, and simplified option checks to `selected_index.is_some_and(...)` under Rust 1.99.0 `-D warnings`.
4. **Toolchain Environment:** Node v22.23.3, npm 10.9.9, rustc 1.99.0, cargo 1.99.0, SDKROOT MacOSX26.5.sdk.

---

## 6. Verification Results

All required verification checks passed sequentially with exit code 0:

| Gate Check | Command | Exit Code | Observed Output / Result |
| --- | --- | :---: | --- |
| 1. TypeScript Check | `npm run typecheck` | **0** | Clean, 0 type errors |
| 2. Full Frontend Tests | `npm test -- --run` | **0** | **82 test files passed**, 3 skipped; **2,477 tests passed**, 4 skipped (0 failed) |
| 3. Production Build | `npm run build` | **0** | Vite client built in 1.11s, 0 errors |
| 4. Native Tests (Locked) | `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets` | **0** | **355 passed**, 0 failed, 6 ignored |
| 5. Clippy (Deny Warnings) | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | **0** | Clean, 0 warnings |
| 6. Format Check | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | **0** | Clean formatting |
| 7. Cargo-Lock Sync Check | `npm run test:cargo-lock` | **0** | Verified at v0.5.3 in Cargo.toml and Cargo.lock |
| 8. Git Diff Check | `git diff --check` | **0** | Clean, no whitespace or conflict markers |

All raw gate logs are preserved in `docs/evidence/m2-practice-session-foundation-2026-10-04/gate/`.

---

## 7. Remaining Limitations

1. **PR 1 Foundation Only:** UI changes for resuming practice tests, viewing completed session history, and triggering explicit history erasure are deferred to PR 2. The existing UI continues to read `practice_tests` without disruption.
2. **Release & Packaging:** Physical installed verification (MAC-23 / TB-INST-01–04), Apple Developer signing, notarization, and release execution remain open prerequisites outside the PR 1 scope.
