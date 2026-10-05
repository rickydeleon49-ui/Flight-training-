# M2 PR 1 initialization re-review — 4 October 2026

**Decision: previous five boundary fixes verified; R3 remains open for browser initialization, schema FK definitions and failed-initialization rollback.** Preserve the native readiness/reference-schema/progress/receipt fixes and all prior accepted correction behaviors. Continue through [one focused model-neutral assignment](M2_PRACTICE_SESSION_PR1_READINESS_CORRECTIONS_PROMPT_2026-10-04.md). PR1 source is unaccepted/unmerged; PR2 remains deferred. Owner scope approval and check-in waiver persist.

## Exact state and verification

Implementation checkout `/Users/rickymac/code/Flight-training-pr70-integration`; branch `codex/m2-practice-session-foundation`; HEAD/base `01cd109c221d14caa6c0cf82180aebdc75111e59`. Local source remains uncommitted/unpushed. Main at review publication is `44efc6851e552982aeaa203af9c9a9d1d8eba9fc`, containing documentation only since the source base.

All **14** entries in the current submitted evidence receipt match from its own directory. The receipt hashes evidence, not source. Codex independently froze and verified all 23 changed-source hashes before/after temporary tests. [Evidence pack](evidence/m2-practice-session-pr1-readiness-review-2026-10-04/README.md) supplies the source snapshot/hashes, submitted gates, exact independent diagnostics and logs. Historical local report/gate files were reused by the implementer; earlier frozen GitHub review packs preserve their previous bytes.

Independent runs:

- Frontend: **29 pass / one failure**, exit1. Original diagnostics and current contract/wire tests pass; the failure is the additional actual sql.js reopen proof.
- Native: **171 pass / two failures**, exit101. All existing backup/recovery/practice tests and the previous five boundary tests pass. The two failures are new bounded FK-definition/initialization-rollback assertions.
- Required `npm run test:cargo-lock` and actual `git diff --check` pass. The first non-escalated lock check could not access the checkout's build lock; the properly authorized rerun succeeded. This was an environment limitation, not a source defect.

The implementer's full logs report 2,488 frontend passes/four skips and380 Rust passes/six ignores plus green types/build/Clippy/fmt. Codex inspected/preserved these but did not repeat the whole matrix after confirming blockers. The supplied Gate7 is only a Cargo.lock diff and Gate8 is a dirty status listing; these do not establish the required synchronization/whitespace checks. The full Rust log predates final lint cleanups (an obsolete dead-code warning remains in it); report evidence precisely and rerun affected native checks after the correction, not unchanged unrelated audits.

All temporary source files were removed/Rust source restored byte-for-byte. Only disposable SQLite databases and an in-memory fake localStorage were used. No app/profile/provider/installed/account/packaging/signing/release work.

## R3-browser — semantic validation is absent from actual sql.js initialization (P1)

**Locations:** `src/data/sqlJsDb.ts:217`; `src/data/practiceSessionTransaction.ts:729`. The report's browser-equivalence/closure row is not supported by source.

**Trigger and observed result:** Use the actual sql.js driver to create one valid question and unfinished attempt, persist `total_questions=99, answered_count=88` through its owned durable write, then reopen from saved bytes. `createSqlJsDatabase()` resolves with a usable session-capable adapter instead of rejecting invalid stored state. The native validator now rejects this same invariant.

**Impact:** Browser sessions can reopen false persisted progress even though PR1 explicitly requires equivalent applicable initialization invariants. Foreign-key enablement, serialization ownership and durable storage do not substitute for semantic validation.

**Fix:** Add actual TypeScript/sql.js schema/state/receipt validation after conversion/reconciliation and before adapter exposure, through the connection owner/durable recovery boundary. Share this with the Node test driver so Node tests exercise the browser contract. Use matching invariant fixtures/native-browser expectations. Refuse safely, preserve durable bytes on failure, disable writes if recovery fails, and demonstrate valid/corrupt/retry behavior with real sql.js tests. No storage architecture migration.

**Proof:** `browser reopen refuses semantically invalid persisted practice state` — one failing frontend assertion.

## R3-schema — reference comparison omits FK definitions (P1)

**Location:** `src-tauri/src/backup.rs:521`, registered-schema metadata comparison.

**Trigger and observed result:** In a disposable database, remove the `practice_test_versions.source_material_id -> study_materials.id ON DELETE SET NULL` FK from the table's schema definition while preserving current rows, columns, indices and triggers. Reopen and confirm `pragma_foreign_key_list('practice_test_versions')` contains zero rows. The application verifier still accepts the file. The diagnostic uses writable_schema solely to simulate a damaged fixture; it never touches an app database.

**Impact:** PRAGMA foreign_key_check cannot detect a relationship whose definition is missing. A restored schema can lose required referential/deletion behavior while appearing valid.

**Fix:** Compare actual FK parent/columns/actions and essential table constraints with the registered in-memory reference, along with the now-correct column/index/trigger checks. Read-only row checks are complementary. Keep supported <=10 compatibility and >11 refusal; preserve successful current-schema/reference tests and existing equivalent formatting behavior.

**Proof:** `missing_source_fk_definition_refused` — failing native rejection assertion.

## R3-initialization — semantic failure happens after conversion commits (P2)

**Location:** `src-tauri/src/practice_sessions.rs:1493` (`run_legacy_conversion_at`).

**Trigger and observed result:** Start with an existing response containing an invalid selection and a second, valid unconverted legacy test. Initialization converts the valid legacy row, commits it, then semantic verification rejects the existing invalid response. The operation returns an error, but the newly converted version and its marker remain committed (one new version instead of zero).

**Impact:** Failed initialization changes persistent conversion state instead of preserving the pre-initialization state required by the current assignment. The proof does not claim loss of original question content; it establishes unexpected committed state on failure.

**Fix:** Validate the pending converted state on the owned transaction/connection before commit, then commit and mark ready only on success. `verify_schema_11_semantics` is already exposed internally; avoid a second read-only file connection that cannot see the uncommitted changes. Revoke readiness at initialization entry/on every failure and preserve the current-root/restore-generation guard. Keep the safe retry, quarantine and no-duplicate conversion tests.

**Proof:** `failed_semantic_validation_rolls_back_legacy_conversion` — failing native rollback assertion.

## Keep closed work and finish the actual contract

The previous five boundary cases all pass. Native initialization now invokes validation before reporting ready, direct native session/test commands check root readiness, restore invalidates that root, unique keys/trigger definitions compare against a reference, and unfinished totals/receipt versions are checked. Keep those fixes; no new planning or prior-scope approval is needed.

The next task is one bounded implementation pass across these three related R3 paths. Fix the real browser omission, complete FK/table metadata and make native conversion-plus-validation atomic. Add permanent regressions, accurate readiness/failure proofs and source/evidence manifests in a new directory. Do not overwrite historical receipts again. Run focused checks, then one actual required sequential gate; distinguish dirty status from clean whitespace and unchanged lockfile from lockfile synchronization. Source acceptance remains pending independent review; PR2 and release tasks do not start here.
