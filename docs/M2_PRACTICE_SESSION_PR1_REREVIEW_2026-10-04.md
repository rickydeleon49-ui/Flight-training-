# M2 PR 1 corrections re-review — 4 October 2026

**Decision: original R1/R2/R4 correction behaviors verified; R3 remains partially open. PR 1 source is not accepted or merged.** Continue the same approved task through [one focused validation assignment](M2_PRACTICE_SESSION_PR1_VALIDATION_CORRECTIONS_PROMPT_2026-10-04.md). Do not reopen settled M2 defaults, repeat scope approval or start PR 2.

## Identity, preservation and verification

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-foundation`, HEAD/base `01cd109c221d14caa6c0cf82180aebdc75111e59`. The implementer copied the already-published PR #97 documents into the index; those additions are historical documentation, not new application work. Current main at review publication is `bea8a521f4795ac28b3f784e28062a63ec19719c`. Source remains uncommitted/unpushed.

The correction SHA256SUMS is relative to its evidence directory and all 14 entries match. It covers evidence, not source; Codex separately captured and verified the current changed-source hashes and [source snapshot](evidence/m2-practice-session-pr1-rereview-2026-10-04/submitted-changes.json). All submitted source bytes were restored after temporary diagnostics. The [evidence index](evidence/m2-practice-session-pr1-rereview-2026-10-04/README.md) contains exact diagnostic source, logs and source identity.

Codex independently ran:

- Frontend: the seven original diagnostics plus corrected contract tests — **26 pass**, exit 0.
- Native: original six diagnostics, 21 practice-session tests and six additional archive rejection assertions — **27 pass / six fail**, exit 101. All six failures are remaining R3 behaviors. The original valid-schema control passes.
- Existing source whitespace check passes. No full source matrix was independently repeated after confirmed blockers. The implementer's logs report 2,485 frontend passes/four skips and 365 Rust passes/six ignores, plus green types/build/Clippy/fmt/lock checks; these remain reported evidence.

An initial parallel diagnostic attempt had one temporary directory-name collision in the positive fixture. The sequential rerun eliminated it and is the authoritative result; it was not an application failure. No owner profile, app launch, provider call, installed test, packaging or release was used.

## Corrections verified and retained

- **R1 core startup/conversion correction:** conversion failures propagate instead of exposing the adapter; the browser conversion now uses owned durable storage; the matching-marker repair and conflicting-marker refusal diagnostics pass. Native session/test save/remove commands have a pending-conversion guard, exercised by the new direct-writer test. Canonical question hashing replaces native raw-JSON hashing. Keep these fixes; remaining validation/readiness integration must preserve them.
- **R2:** native/browser completion derives scoring from frozen keys and selections. Same-choice receipts use the original persisted answer time. Both original native and frontend diagnostics pass.
- **R4:** unsupported save/removal adapters refuse before a legacy write. Both original zero-write diagnostics pass.
- **R3 original proofs:** missing index, malformed JSON text and foreign-key violation now refuse; unchanged valid schema accepts. This closes those specific failures, not the full Appendix E archive contract.
- The actual two-thread concurrent-start command test passes. The replacement test currently exercises invalid input before mutation; it does not inject a mid-transaction fault, despite the report's stronger description.

## R3 remains open — schema-11 validation still accepts invalid application state (P1)

**Locations:** `src-tauri/src/backup.rs:435` (`verify_schema_11_semantics`); index name-only check near `493`; item-only bounds check near `622`; response check near `665`; completed score near `777`; receipt parsing near `825`.

**Trigger:** Each proof starts from actual migrations and native writers in a disposable database, changes one invariant, then calls the real read-only application verifier. Each of these was accepted when the approved contract requires refusal:

| Permanent-test candidate | Single damaged invariant | Observed impact |
| --- | --- | --- |
| `receipt_empty_object_refused` | A live operation result is `{}`. | JSON parses, but the saved-result shape/association is unusable for replay. |
| `out_of_range_stored_response_refused` | A response selects index 99 for two options. | Invalid answers survive restore; checking only nonnegative selection is insufficient. |
| `cross_material_attempt_refused` | Attempt source points to another existing material while its version belongs to the original. | FK checks pass, but session ownership is inconsistent. |
| `counterfeit_unique_index_refused` | Replace the required unique index with a same-named nonunique index. | Object-name checks do not prove the uniqueness invariant. |
| `missing_version_column_refused` | Drop `practice_test_versions.model`. | Archive accepts a schema required repositories cannot read. |
| `null_completed_score_refused` | Completed zero-percent attempt has NULL score. | NULL is coerced to 0.0 and accepted instead of requiring a valid completion snapshot. |

This is the remainder of the previously assigned R3 structure/ownership/choice/receipt contract, not six new feature requests. Finish the coherent validator against [scope Appendix E](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md#appendix-e-reviewer-set-engineering-decisions-and-source-acceptance-criteria): required columns and structural semantics, bounded item/response content, complete ownership/state/timing, derived totals/score, typed receipts and association. Preserve old-schema compatibility, historical replay snapshots and tombstones. Keep the existing staging/recovery protocol and prove post-migration/conversion validation before session readiness.

A related inspected boundary, not a separate new finding: `src/data/tauriDb.ts:84` checks only that a result has a string attemptId; it accepts `{attemptId:'x'}` as a saved session. Apply the same action-specific result validation to live/replayed native outcomes. The correction report also claims test-save result validation although that void invocation merely awaits the native call; document its actual unit-return contract rather than inventing a result object.

## Evidence/report corrections and stopping point

Keep the passing fixes and original receipts. The report says ten concurrent OS threads; the test actually uses two, which is sufficient. It says full semantic validation and mid-write replacement rollback, neither established by the submitted source/tests. Correct those claims. Canonical question wire keys are camelCase (`correctIndex`, `sourcePage`), not the report's snake_case description. The frontend gate log reports 82 passed files/three skipped, not 129 files.

The next implementer should finish R3 and the already-assigned recovery/failure proofs, add these six meaningful permanent regressions, verify focused checks, then run one sequential required full source gate. Leave changes uncommitted for independent re-review. Codex should next review the changed validator/recovery boundaries and their consequences, preserving closed corrections. PR 2 UI and installed/signing/release work remain deferred.
