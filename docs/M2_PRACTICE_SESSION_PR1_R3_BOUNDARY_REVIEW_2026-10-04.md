# M2 PR 1 R3 boundary review — 4 October 2026

**Decision: the demonstrated validation corrections pass, but R3 is not fully closed. PR 1 source remains unaccepted/unmerged.** Preserve the closed R1/R2/R4 fixes, the six corrected R3 cases and the new recovery/rollback tests. Continue through [one concrete R3 boundary assignment](M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_CORRECTIONS_PROMPT_2026-10-04.md); no new scope approval or PR 2 work.

## Reviewed state and independent verification

Implementation: `/Users/rickymac/code/Flight-training-pr70-integration`, `codex/m2-practice-session-foundation`, HEAD/base `01cd109c221d14caa6c0cf82180aebdc75111e59`; dirty, uncommitted/unpushed. Documentation-only main is `bf3da137680ad10c8880dd603b8278fed815703a`. The submitted twelve-entry evidence manifest matches when checked from its own directory. Codex separately froze and verified all 23 changed-source hashes before/after temporary diagnostics; no submitted source was changed permanently.

[Evidence pack](evidence/m2-practice-session-pr1-r3-boundary-review-2026-10-04/README.md): exact source snapshot, source hashes, independent diagnostic source/runner/logs and byte-preserved submitted report/gates.

Codex independently ran the current backup/recovery suite, practice-session suite and five additional boundary assertions sequentially: **166 pass / five fail**, exit101. All 145 existing backup/recovery and 21 practice-session tests pass, including the six earlier rejection proofs, current/old-schema round trips, interrupted restore/conversion, concurrent starts and actual mid-item-write replacement rollback. Frontend: **29 pass**, exit0, covering the seven original diagnostics and corrected contract/wire tests. All original thirteen diagnostics now pass. Temporary diagnostic files were removed and Rust source restored byte-for-byte. Source whitespace check is clean.

The submitted full gate reports 2,488 frontend passes/four skips, 375 Rust passes/six ignores, plus green types/build/Clippy/fmt/lock/diff. These logs were inspected/preserved; Codex did not repeat a full matrix after confirming blockers. No app launch, real profile, provider, installed test, packaging or release occurred.

## R3-A: structural/application validation still accepts invalid state (P1)

**Locations:** `src-tauri/src/backup.rs:568` unique-index validation; `1287` trigger validation; `1168` receipt start-result validation; `971` in-progress attempt validation.

Four new assertions call the real read-only verifier on actual migrated/native-writer fixtures. It accepts:

| Proof | Mutation | Meaningful consequence |
| --- | --- | --- |
| `unique_index_wrong_key_refused` | Same required name, UNIQUE on attempt `id`, with the expected in-progress predicate. | The material uniqueness guard has disappeared, despite unique=1 and a matching SQL substring. |
| `no_op_ownership_trigger_refused` | Same ownership-trigger name, body replaced by `SELECT 1`. | Response/version ownership enforcement is gone; presence does not prove semantics. |
| `receipt_wrong_frozen_version_refused` | Start receipt result versionId changed to `missing-version`, leaving its attempt/history valid. | A typed-looking receipt has a false frozen-version association; replay reads the stored result. |
| `in_progress_false_totals_refused` | One-question unfinished attempt changed to 99 total/88 answered. | Restored progress is false; only completed attempts currently have their counts checked. |

These are remaining parts of the already-approved schema, ownership, receipt and state contract, not new features. The report says trigger definitions and column types are validated; source checks trigger existence and column names only. The unique-index check does not inspect key columns. Receipt checks validate selected fields without full frozen-owner association. Finish the coherent invariant check rather than repeating another name-only patch.

## R3-B: startup/native readiness never invokes semantic validation (P1)

**Locations:** `src/data/tauriDb.ts:256`; `src-tauri/src/practice_sessions.rs:1224` (`ensure_legacy_conversion_ready`) and `1245` (`run_legacy_conversion_at`); validator is private to backup paths.

**Observed proof:** `startup_conversion_and_native_write_refuse_invalid_state` creates a valid attempt/response, then stores index99 against two options. The updated archive verifier correctly refuses that database. Nevertheless the actual native conversion returns success and a fresh start/resume operation also succeeds on it. Thus the very same invalid state can pass initialization's current conversion-only path and relevant native writes. This proves native primitive behavior; no actual app launch or installed startup was performed.

Production startup awaits only `run_practice_legacy_conversion`; that function converts/commits without invoking the semantic verifier. Native readiness checks only for pending legacy rows. The new old-schema round-trip test manually calls verification after migration/conversion, so it proves those primitives can be combined safely, not that production initialization does combine them. The assignment explicitly requires semantic validation before exposing sessions after migration/restore.

**Correction:** Wire an owned initialization boundary that migrates/loads, converts/reconciles, validates, and only then exposes session capability. Make relevant native direct commands obey the same current-root readiness boundary. Preserve failed-startup recovery files/data and safe retry. Browser must enforce equivalent applicable invariants through its owned durable path. A test-only verifier call does not satisfy this gate.

## Preserve progress and finish efficiently

R1/R2/R4 corrections remain verified. All earlier R3 failures now refuse correctly. The mid-write replacement test now genuinely injects an item insertion failure; keep it and the successful restore/recovery tests. No additional planning round or concurrency expansion is needed.

The next assignment gives a concrete closure checklist: compare actual schema semantics with the registered migration reference; validate progress/receipt relationships and bounded result types; invoke validation through real readiness paths and prove refusal/retry. Related inspected limits belong in that work: column metadata is not checked, item ordinals are only checked for nonnegative values, receipt IDs/hashes/times are only checked for nonempty strings, and score still uses a 0.05 tolerance despite the report's exact-score claim. Do not mark these criteria complete without implementing and testing their meaningful invariant categories.

Correct the report's stronger claims, preserve all original receipts, add these five fail-before/pass-after cases and return a single correction handoff. Run focused checks before one required full gate. Leave source uncommitted/unpushed; independent review remains the acceptance boundary before PR 2. Signing/release/installed decisions remain separate.
