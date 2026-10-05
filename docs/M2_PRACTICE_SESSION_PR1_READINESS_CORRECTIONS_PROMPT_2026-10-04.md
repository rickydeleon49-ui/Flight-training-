# M2 PR 1 — model-neutral remaining initialization corrections, 4 October 2026

You are the owner-selected implementer. Finish the three concrete R3 issues in [this initialization re-review](M2_PRACTICE_SESSION_PR1_READINESS_REVIEW_2026-10-04.md). This assignment supersedes the earlier boundary prompt for remaining work. Preserve all passing R1/R2/R4 and previous R3 corrections. The approved [scope Appendix E](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md#appendix-e-reviewer-set-engineering-decisions-and-source-acceptance-criteria), [owner approval](M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md) and check-in waiver remain effective. No new approval is needed. Codex independently reviews and coordinates Git unless the owner changes roles.

Codex independently observed all 171 existing native backup/recovery/practice tests and all 29 original/focused frontend cases pass. Three new assertions fail: actual sql.js invalid-state reopen, a missing source FK definition, and conversion committed despite initialization validation failure. Fix these in one pass; avoid another planning/report-only rewrite. No PR2, new dependency/service or unrelated audit.

## Start and preserve

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-foundation`, submitted base `01cd109c221d14caa6c0cf82180aebdc75111e59`. Source is dirty/uncommitted. Fetch once, inspect status and verify [the 23 source hashes](evidence/m2-practice-session-pr1-readiness-review-2026-10-04/source-hashes.json). Read new documents via GitHub or `git show origin/main:docs/<filename>`; do not pull/reset a dirty branch to obtain docs. Preserve copied historical documents/index changes, source and unexpected competing work. Do not use the separate dirty primary clone.

[Evidence pack](evidence/m2-practice-session-pr1-readiness-review-2026-10-04/README.md) contains the exact current source snapshot, source hashes, diagnostic source, logs and restoration confirmation. Do not apply the snapshot over the working checkout. The submitter's manifest hashes evidence only; do not describe it as a source receipt. Create a new correction evidence directory; preserve previous local receipts instead of replacing the existing validation report/gates again. Earlier GitHub snapshots remain historical.

## 1. Implement real browser initialization validation

Current sql.js startup awaits executeLegacyConversion inside durableWrite, then exposes the adapter. No semantic validator is called. The report's C5 browser-equivalence row cannot be satisfied by connection ownership/FK ON/durability alone.

Implement a TypeScript practice-state/schema/receipt validator that runs on the owned initialized SQLite connection after migrations and legacy conversion/reconciliation, before adapter/session capability is exposed. Apply it to actual sql.js and the Node SQLite test driver. Keep native and browser semantics equivalent for the applicable schema11 invariants using shared table-driven fixtures and expected accept/refuse outcomes. No new dependency or IndexedDB/OPFS.

Cover the approved categories coherently: required schema columns/types/PK/FK/uniqueness/index/trigger behavior; 1–200 bounded ordered items; material/version/response/history ownership; valid active/detached/status/timing/revision rules; real unfinished total/answered counts; completed counts and exact one-decimal score from frozen keys/selections; typed receipt fields/identity/hash/history/frozen-owner relationships and tombstones. Reuse existing validation helpers and the registered migration reference rather than copying only the literal 99/88 rejection. Historical receipt snapshots may differ from current mutable state; erased receipts may reference removed attempts. Preserve whole-row malformed legacy quarantine and 200-question import behavior.

Make startup success depend on validation plus durable persistence. On failure recover the previous durable bytes, leave the adapter unavailable and preserve failure/retry semantics. Failed recovery must disable further writes. Conversion cannot be exported/stored as successful before its semantic validation. Run actual sql.js tests (WASM URL mocked to the installed test asset, localStorage backed by an in-memory map) for valid initialization, persisted corruption refusal, storage/refused recovery, restart/retry and no duplicate conversion. Never use the user's real browser store or profile.

Promote `browser-startup.test.ts` from the review into a permanent regression; it currently persists a one-item session with 99 total/88 answered and reopen wrongly resolves with a usable driver. Add a valid reopen control and appropriate category fixtures shared with native validation. Existing durability tests remain passing; do not claim equivalence based only on them.

## 2. Complete native/reference FK and table constraints

Current reference comparison checks columns, indices and triggers but omits foreign-key definitions. PRAGMA foreign_key_check verifies current rows only; with a missing FK there is nothing for it to check.

Compare actual vs registered-reference `PRAGMA foreign_key_list` for all relevant tables: parent table, child/parent columns, composite sequence where applicable and update/delete actions. Verify essential table/check constraints in a bounded representation as required by the schema contract, alongside the existing column/nullability/PK/index/trigger comparisons. Preserve safe equivalent formatting and valid shipped schema<=10 compatibility; refuse future schema. Read-only data validation remains necessary as well. Do not edit shipped migrations1–10.

Promote `missing_source_fk_definition_refused` from the review. It confirms a removed source-material FK is absent on reopen and that the current verifier accepts it. Its writable_schema operation is only a disposable corruption seam, never a production migration or app-file repair. Keep positive reference-schema validation and test equivalent valid structure, missing/wrong FK actions and material deletion/history behavior. This is completing the existing schema guarantee, not a new feature.

## 3. Make conversion plus validation one atomic initialization

run_legacy_conversion_at currently commits/drops its connection, then calls verify_application_database. A semantic error can therefore return failure after new versions/markers have committed.

Refactor into an owned conversion helper and validate the pending state on that same transaction before commit. The internal verify_schema_11_semantics(connection) already exists and can inspect the transaction via its connection interface; do not open a separate read-only file connection that only sees pre-transaction bytes. Preserve migration-history/ceiling checks at the appropriate real initialization boundary. Once conversion and validation succeed, commit and mark the canonical root/generation ready. At initialization entry and on every failure revoke readiness; do not allow stale readiness to remain after an early conversion error. Keep restore invalidation scoped to its actual root. If restore generation changes during initialization, do not publish the older validated generation as newly ready.

Relevant native direct commands must retain their current readiness checks and five-second lock/FK/CAS/replay semantics. Preserve original legacy JSON, prior version/progress/receipts, pre-upgrade copies and staged-restore recovery files on failed initialization. A safe retry must convert once without changing persisted identities twice. Keep current/older archive round trips and interrupted restore tests.

Promote `failed_semantic_validation_rolls_back_legacy_conversion`. The fixture contains an already-invalid existing response plus another valid unconverted legacy test. Initialization must fail with no new version/items/marker/receipt committed for the legacy row. Assert exact prior state and readiness refusal, then repair the isolated invalid fixture and prove a safe retry initializes successfully without duplicates. Test the actual initialization API rather than only calling the validator separately.

## Verification and deliverable

Record the three fail-before results against this frozen submission, then run permanent focused native/browser/Node readiness, reference-schema/FK, rollback and affected existing backup/practice/import/migration/durability tests. Keep all previous boundary tests and original thirteen diagnostics passing. Use unambiguous temporary directories and deterministic clocks. All fixtures are disposable.

After focused checks pass, run one sequential required source gate using current scripts/accepted Mac toolchain: npm run typecheck; npm test; npm run build; locked Rust all-target tests; locked Clippy with warnings denied; rustfmt check; **npm run test:cargo-lock**; **git diff --check** plus migration/checksum consistency. git diff Cargo.lock proves only that file is unchanged; git status --porcelain is a status snapshot, not a whitespace gate and is expected to show dirty implementation files. Preserve failed attempts/exit codes and rerun only checks justified by changed source/failures. Do not substitute or claim every gate passed without executing the actual gate. No overlapping full matrices or speculative CI pushes.

Write a new report/README/source manifest/evidence manifest with clearly labeled roots, real entry points, truthful native/browser closure-to-test mapping, exact commands/exits/counts, fail-before/pass-after and remaining limits. Keep original receipts intact. Correct C5 and the gate claims; distinguish reported evidence from independently observed results. Update STATUS/handoff as corrected pending independent re-review, not accepted.

No app launch, real profile, provider, installed/account test, packaging/signing/notarization/release, PR2 UI/erase or another roadmap task. Leave all source corrections uncommitted/unpushed. Return checkout/branch/base, changed files, each R3 issue's proof/fix/test and evidence paths; stop for independent review.
