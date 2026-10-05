# M2 practice-session PR 1 independent review — 4 October 2026

**Decision: corrections required; source is not accepted or merged.** Keep the approved M2 scope and current implementation branch. This review consolidates four confirmed findings into [one model-neutral correction assignment](M2_PRACTICE_SESSION_PR1_CORRECTIONS_PROMPT_2026-10-04.md). PR 2 remains deferred until PR 1 acceptance. Owner approval and the real-user check-in waiver remain effective; no further scope approval is requested.

## Reviewed identity and evidence

- Repository: `rickydeleon49-ui/Flight-training-`; implementation checkout `/Users/rickymac/code/Flight-training-pr70-integration`.
- Branch: `codex/m2-practice-session-foundation`; HEAD/base `01cd109c221d14caa6c0cf82180aebdc75111e59`, matching origin/main when reviewed. Implementation is uncommitted and unpushed.
- All 26 entries in the submitted SHA256SUMS verified before/after diagnostics. Migration 11 hash: `133bfd14d761ff27f226985e70b9d1c917c48d2120f39ff33ffaed013e9373de`.
- Authority: [approved assignment](M2_PRACTICE_SESSION_PR1_PROMPT_2026-10-04.md), [owner approval](M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md), canonical [scope Appendix E](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md#appendix-e-reviewer-set-engineering-decisions-and-source-acceptance-criteria).
- [Evidence pack](evidence/m2-practice-session-pr1-review-2026-10-04/README.md) contains the submitted change snapshot, original report/gates, exact diagnostics and execution logs. The JSON snapshot exposes reviewed source to other agents without committing the failing application changes.

The submission adds the intended schema/atomic operations, repositories and versioned writer integration. Its gate logs report 2,477 frontend passes/four skips and 355 Rust passes/six ignores, with types/build/Clippy/fmt/lock/diff passing. Codex inspected those logs and verified the receipt; those full suites were not independently rerun in this review. Codex instead ran focused production-path diagnostics: seven TypeScript assertions failed (exit 1); six native assertions ran, with five failures and one valid-schema control pass (exit 101). Failures are behavioral assertions, not compilation or fixture setup errors. All databases were disposable; no app/profile/provider/installed/release work occurred. Temporary diagnostic files were removed and the modified Rust file restored byte-for-byte.

## M2P1-R1 — startup conversion does not enforce readiness or reconcile partial state (P1)

**Locations:** `src/data/tauriDb.ts:165`, `src/data/sqlJsDb.ts:122`, `src/data/testing/nodeSqliteDb.ts:69`; `src/data/practiceSessionTransaction.ts:740`; `src-tauri/src/practice_sessions.rs:1203`.

**Trigger and observed result:** Inject a synthetic insert failure during conversion of a valid legacy test. The actual Node driver logs the failure and returns a usable adapter instead of refusing readiness. Desktop and browser initialization contain the same catch-and-continue behavior. Native session/test writers do not enforce the required conversion readiness. Separately, clear an existing version's legacy marker: both converters exclude every material that already has any version. Matching content never repairs the marker; conflicting legacy content is silently skipped instead of refused. Both reopen assertions failed.

**Impact:** SQL migration success can be mistaken for usable converted session state. Legacy UI and the new session engine can read different question sets after a partial/conflicting startup. The reviewed contract explicitly requires conversion/reconciliation before exposing sessions and refusing relevant writes after conversion I/O failure.

**Correction:** Make conversion failure sanitized and observable, block relevant session/test writes until successful retry, reconcile unmarked matching content without duplicating, and refuse conflicting state without changing data. Preserve whole-row malformed-content quarantine. Conversion must use the existing browser durable/owned path. Normalize content hashing consistently across native/browser conversion, replacement and import: native presently hashes raw JSON bytes (`practice_sessions.rs:1255`, `1386`) while TypeScript hashes validated canonical content. Add parity fixtures and direct native writer-readiness tests.

**Proofs:** frontend `conversion failure must prevent adapter exposure`, `unset marker with conflicting version must refuse startup`, `matching version must repair unset marker without duplicating`.

## M2P1-R2 — completion trusts stored correctness; no-op receipt changes answered time (P2)

**Locations:** `src/data/practiceSessionTransaction.ts:513`, `537`; `src-tauri/src/practice_sessions.rs:835`, `903`.

**Trigger and observed result:** Answer the single frozen question incorrectly, then damage its stored `is_correct` flag in a disposable fixture. Both real completion engines return a correct answer/100% score, although the frozen key says the selected answer is wrong. This test deliberately models stored-data corruption; it does not claim a normal answer action writes the wrong flag. R3 separately shows the archive verifier accepts malformed practice data. The contract requires recomputation from frozen items, not reliance on flags. Also submit an identical choice under a new operation ID after the clock advances: both engines leave the persisted timestamp unchanged but return the new clock time in the receipt.

**Impact:** Completion can freeze false history from inconsistent persisted data. A no-op reports an answer time different from the committed response and violates the approved deterministic response contract.

**Correction:** Derive correctness/counts/rounded score from frozen keys plus selected choices/dont-know state, with integrity validation. For an unchanged choice, return its actual stored answered time and revision while recording the new receipt atomically. Preserve late identical replay and immutable completed snapshots.

**Proofs:** frontend `completion derives score from frozen key, not stored correctness`, `same-choice no-op returns original answered timestamp`; native `frozen_key_score_is_derived`, `no_op_preserves_returned_answered_time`.

## M2P1-R3 — schema-11 archive verifier accepts unsafe structures and receipts (P1)

**Location:** `src-tauri/src/backup.rs:435` (`verify_schema_11_semantics`), particularly receipt checks at `697`.

**Trigger and observed result:** Start with a valid schema-11 database built by actual migrations and native writers. The read-only application verifier accepts each of these independently: missing `uq_single_in_progress_attempt`; a live operation receipt whose result is `not-json`; a version referencing a nonexistent material with FK enforcement disabled during fixture corruption. All three rejection assertions failed. The unchanged valid archive control passed.

**Impact:** A restore can install a database lacking required invariants or valid replay results and later expose sessions that fail or return invalid state. This violates the explicit structure/FK/receipt restore gate, independently of existing archive staging/file-integrity checks.

**Correction:** Finish the bounded schema-11 validator required by Appendix E: required columns/indices/ownership triggers; actual foreign-key and ownership checks; bounded question/options/key/response semantics; state/timestamps/uniqueness/detached rules; recomputed completion totals and exact one-decimal score; typed receipt identity/action/hash/result/association validation. Preserve valid historical snapshots that differ from current mutable state and tombstones referring to erased attempts. Do not equate SQL quick_check with relational/application integrity. Keep <=10 compatibility and >11 refusal. Verify post-migration/conversion startup and staged restore rollback before session readiness, without changing accepted recovery protocols or writing into an archive.

**Proofs:** native `missing_required_unique_index_is_refused`, `malformed_receipt_json_is_refused`, `foreign_key_violation_is_refused`; positive `valid_schema_11_control_is_accepted`.

## M2P1-R4 — unsupported writers silently mutate only the legacy table (P2)

**Locations:** `src/data/repositories/documentRepository.ts:256` and `279`.

**Trigger and observed result:** Supply a valid select/execute adapter without the new atomic writer methods. Both savePracticeTest and removePracticeTest resolve successfully and execute raw legacy-table SQL. Both zero-write refusal assertions failed.

**Impact:** Regeneration/removal can diverge the legacy test from active versions, unfinished work and receipts. All current application drivers implement the atomic methods, so the proof concerns an unsupported/legacy adapter; it is still an explicit approved refusal boundary and must not silently degrade.

**Correction:** Refuse before the first write when either required atomic method is absent. Keep old legacy read compatibility; do not preserve a legacy write fallback. Add zero-write tests for both methods.

## Evidence accuracy and bounded follow-up

The submitted report cites names absent from the actual test file, including `concurrent_starts_serialize_to_single_unfinished_attempt` and `failed_replacement_preserves_previous_test_and_progress`, and says full foreign-key/receipt validation is implemented. Replace these with actual test names and verified behavior. A unique-index test is not evidence of two concurrent native commands. Add meaningful tests for the already-assigned concurrent start, failed replacement, import/reopen and restore/recovery requirements where the existing evidence does not demonstrate them; avoid duplicate happy-path tests.

Minor source-inspection observations, not additional independent blockers: browser decoding accesses Object.keys/JSON length before rejecting null/undefined; erased receipt precedence precedes changed-payload conflict checking; desktop success values are type-cast without runtime shape validation. Resolve these in the related decoder/receipt work when covered by the approved contract, and report actual outcomes. No broad audit or new roadmap work is requested.

The source remains intact and unaccepted. One implementer should correct R1–R4, promote the diagnostics into permanent readable regressions, run focused checks and then one sequential full gate, and return an accurate new receipt. Independent re-review should concentrate on those changes and their consequences. No PR 2 UI, release build, signing, account testing, provider work or unrelated feature is authorized here.
