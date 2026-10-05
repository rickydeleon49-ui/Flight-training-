# M2 PR 1 — model-neutral R3 boundary completion assignment, 4 October 2026

You are the owner-selected implementer. Complete the remaining R3 boundaries in the existing Mac branch. This assignment supersedes the prior validation prompt for remaining work. Read [the boundary review](M2_PRACTICE_SESSION_PR1_R3_BOUNDARY_REVIEW_2026-10-04.md), [canonical scope Appendix E](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md#appendix-e-reviewer-set-engineering-decisions-and-source-acceptance-criteria) and [owner approval](M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md). Scope and check-in waiver remain approved. No new authorization is needed for this bounded source task. Codex independently reviews and coordinates Git unless the owner explicitly changes that role.

Keep the verified R1/R2/R4 corrections and all passing R3/recovery/rollback work. Codex independently ran 29 frontend passes and 166 existing native backup/recovery/practice passes. Five additional assertions demonstrate remaining R3 failures. Do not reopen settled behavior or start PR2. Finish the actual invariant categories and readiness integration, not another report-only rewrite or a patch limited to the literal five fixture values.

## Starting identity and preservation

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-foundation`, submitted HEAD/base `01cd109c221d14caa6c0cf82180aebdc75111e59`. Source is dirty/uncommitted. Fetch once, inspect status and check the [review source hashes](evidence/m2-practice-session-pr1-r3-boundary-review-2026-10-04/source-hashes.json). Do not pull/reset a dirty branch to obtain docs; use GitHub or `git show origin/main:docs/<filename>`. Preserve the copied historical review documents in the index, original reports/gates and unexpected competing work. Do not use the separate dirty primary clone.

[Evidence pack](evidence/m2-practice-session-pr1-r3-boundary-review-2026-10-04/README.md) contains exact diagnostic source/logs, current changed-source snapshot and restoration confirmation. Do not apply its snapshot over the working checkout. Use one implementer. Keep every fixture disposable and every required source dependency already accepted; no new service/package is necessary.

## A. Replace shallow structure checks with registered-schema semantics

The current code checks column names, UNIQUE flag plus a predicate substring, and trigger names. It still accepts a same-name UNIQUE index on the wrong column and a same-name no-op ownership trigger. Implement a consistent expected schema representation from the registered migrations and inspect actual SQLite metadata/definitions against it. A practical option is to build the reference schema in a separate in-memory database using registered migrations, then compare the relevant table/index/FK/trigger metadata. The archive remains read-only. An equivalent bounded design is acceptable if it proves the semantics.

Required checks for schema11:

- All five tables and legacy tracking columns, with expected column types, nullability, PK and essential FK/uniqueness/check semantics; do not validate just a name list. Include compound item ordinal and response identity uniqueness.
- Required index ownership, actual indexed key/order, uniqueness and partial predicate. `uq_single_in_progress_attempt` must protect material identity, not merely attempt id. Corresponding active-version uniqueness must protect the material. Presence and `unique=1` alone are insufficient.
- Required ownership/cleanup trigger definitions must enforce their actual contract. A trigger with `SELECT 1` under the expected name is invalid. Compare normalized meaningful definitions or implement an equally reliable semantic method; account for safe SQL formatting rather than arbitrary whitespace, and do not accept weaker predicates hidden behind a matching substring/comment.

Preserve schema<=10 compatibility and >11 refusal. Migration1–10 bytes stay unchanged. Migration11 is unmerged; keep any justified correction consistent with Rust/TS registration/checksum. Avoid redesigning the backup system. Describe the actual reference comparison, not a claimed behavior absent from code.

## B. Finish state/receipt validation coherently

For every frozen version validate 1–200 complete items and contiguous zero-based ordinals, whole bounded question/options/key/explanation/source-page semantics, version/material/history ownership, active/detached rules and required fields. Validate actual FK relations and state semantics; historical IDs remain under the approved identity rules, and do not invent stricter incompatible ID requirements for unrelated legacy data.

For in-progress attempts, frozen total_questions and actual answered_count must match items/responses. Use state-specific rules: closed immutable completion counts/rounded score must derive from frozen keys/selections; abandoned/unfinished summaries follow their existing wire/persistence contract rather than forcing a completed score onto them. Enforce nonnegative bounded revisions/counts, legal times/state, ownership and cursor semantics. Keep zero/NULL/unanswered/dont-know distinctions. Require valid completion score/time, finite bounded percent on the one-decimal grid, and compare the recomputed score without the current 0.05 acceptance tolerance. Keep matching keys and immutable snapshots.

Validate full action-specific receipt shapes and stable associations:

- UUIDv4 operation identity, approved hash encoding/action/time, attempt/history association and tombstone shape. A nonempty string is not sufficient validation for these fields.
- A start/retake result's versionId must identify the receipt attempt's frozen version, not an arbitrary nonempty string. Every result must have its complete bounded field types/required fields; responses/items must belong to that frozen version. Validate finite/integer/range semantics, not merely `typeof number`.
- Preserve valid historical snapshots differing from today's mutable revision/response/status. Do not reject an old start result because its attempt later completed; validate its snapshot shape and stable ownership, not equality to every current mutable field. Erased tombstones may reference removed attempts without retaining response/result content.
- Keep changed-input conflict precedence and identical committed replay. Apply the same action-specific shape/known identity checks to live/replayed desktop IPC outcomes. For response/complete/abandon, the requested attempt identity is known; for retake, the new attempt deliberately differs from expectedAttemptId. Maintain approved wire fields and unit-return test save/remove contracts.

Use the canonical contract to finish remaining bounded fields as a group. The review highlights representative missing boundaries; do not claim full coverage after only changing one test's literal input. Make permanent regressions readable and distinct from generated validator implementation details.

## C. Make validation part of actual initialization/readiness

Current createTauriDatabase awaits only conversion, while ensure_legacy_conversion_ready counts pending legacy rows. The private backup validator is never called by production post-migration conversion/session initialization. A corrupt response index99 is refused by the archive verifier yet conversion and a new native session action both succeed.

Implement an owned production boundary that runs after Database.load/migrations and performs conversion/reconciliation plus semantic validation before exposing sessions. Refactor conversion into an owned connection/transaction helper if needed; avoid recursively opening another immediate writer while holding a transaction. Expose only sanitized allowlisted failure to the adapter. Ensure direct relevant native commands cannot bypass failed/unperformed initialization; scope any ready state to the actual root and initialization/restore generation, rather than a persisted boolean that outlives failure. Preserve accepted five-second lock wait, FK setup, transaction rollback and same-operation replay semantics.

Browser initialization must enforce equivalent applicable invariants through the existing connection owner/localStorage durable recovery before exposure. Keep recovery to the last durable bytes and disable writes if recovery fails; no IndexedDB/OPFS migration. On conversion/validation failure preserve prior source data, pre-upgrade/restore recovery evidence and allow safe retry. Never mutate the archive in the read-only verifier or delete recovery artifacts because validation failed.

Test the actual production initialization path, not only a manual test sequence calling migration, conversion and verifier separately. Use disposable old/current database fixtures: valid initialization succeeds; validator-refused state blocks adapter/direct session capability; a simulated reopen/restart cannot retain stale ready state; correcting/retrying safely enables writes without duplicate conversion; interrupted conversion/restore preserves prior state/recovery files. Keep all current/older round-trip and rollback tests that already pass.

## Verify, report and stop

First promote the five exact review cases from `remaining.rs` into permanent regressions and record fail-before. Expected wrong-key-index, no-op-trigger, wrong-version-receipt and false-progress states must refuse. The startup/direct-native case should exercise the corrected real readiness boundary; adapt the test to the chosen initialization API without weakening its invariant. Keep the positive valid database control and all original thirteen diagnostics. Use unique temporary directory names/atomic counters and deterministic clock seams.

Run focused backup/recovery, practice-session and frontend contract/IPC/readiness checks first; then affected import/migration/browser durability guards. Once known failures are fixed, run one sequential required source gate with the accepted Mac toolchain and current scripts: typecheck; full frontend; production build; locked Rust all-target tests; locked Clippy with warnings denied; fmt; Cargo-lock; diff/migration consistency. No overlapping full matrices, speculative CI pushes, unrelated audit or redundant full reruns. Reuse unchanged evidence when valid; rerun checks only after changes/failures justify it.

Preserve all previous receipts. Create one new correction report with a closure checklist for schema semantics, full state/receipt types/associations and actual initialization/native/browser refusal/retry. Name the real production entry points and the test proving each; mark a criterion unfinished if the code has not been wired. Include exact source and evidence hashes with clearly labeled roots, meaningful fail-before/pass-after logs, commands/exit codes/counts and remaining limits. Correct the prior claims of trigger-definition, column-type and exact-score validation. Update STATUS/handoff only as corrected pending independent re-review.

No app launch, real profile, provider call, dedicated-account/installed test, installer/signing/notarization/release, PR2 UI/erase or new roadmap feature. Leave every implementation correction uncommitted/unpushed. Return checkout/branch/base, changed files, closure-to-test map and evidence paths; stop for independent review.
