# M2 practice sessions PR 1 — model-neutral consolidated corrections, 4 October 2026

You are the owner-selected implementation agent. Complete the existing PR 1 data foundation against [the independent review](M2_PRACTICE_SESSION_PR1_REVIEW_2026-10-04.md); fix M2P1-R1–R4 in one coherent pass. Codex remains the independent reviewer/Git coordinator unless the owner explicitly assigns that role elsewhere. Be precise and maintain pace: preserve good work, use focused failure proofs, finish the authorized correction and stop for review.

## Authorization, checkout and preservation

M2 defaults/PR 1 are already approved in [the owner record](M2_PRACTICE_SESSION_OWNER_APPROVAL_2026-10-04.md). The real-user check-in waiver persists. Do not request these approvals again. Read the [original implementation assignment](M2_PRACTICE_SESSION_PR1_PROMPT_2026-10-04.md), [canonical scope Appendices B–E](M2_PRACTICE_SESSION_SCOPE_2026-10-04.md) and this correction report. Appendix E governs contradictions. Release/signing prerequisites do not block this source task.

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-foundation`. Submitted HEAD/base was `01cd109c221d14caa6c0cf82180aebdc75111e59`; source is uncommitted. Fetch once, inspect branch/status, verify all 26 submitted hashes from `docs/evidence/m2-practice-session-foundation-2026-10-04/SHA256SUMS`, and preserve the changes. The new review is a docs-only GitHub update, not an application merge. With a dirty source branch, read its documents via `git show origin/main:docs/<filename>` or retrieve them from GitHub; do not pull/reset/overwrite the implementation to obtain the review. Unexpected changes require identifying ownership before touching them; routine safe engineering choices within this assignment need no extra approval. Do not use the separate dirty `/Users/rickymac/code/Flight-training-` clone.

[The evidence pack](evidence/m2-practice-session-pr1-review-2026-10-04/README.md) includes portable diagnostic source/logs and an exact JSON snapshot of reviewed changes. Do not apply the snapshot over the working checkout. If switching machines/models, verify the actual source exists before claiming the task executable. Use one implementer at a time.

## 1. R1: make startup and relevant native writes safe

Conversion is a required initialization step, not best-effort logging. Keep invalid legacy content as a whole-row sanitized quarantine, but distinguish that expected content result from failed I/O/transaction/durable storage. An I/O failure must not expose usable practice session/test writes. Propagate a sanitized error/readiness refusal, preserve source data and allow safe retry on a later successful initialization.

Desktop: await native conversion after SQL migrations; enforce the readiness contract in relevant native session/test/import paths so a direct command cannot bypass it. Choose a bounded owned design consistent with existing connections, FK enforcement and five-second lock wait. Do not claim every unrelated command is globally disabled. Browser: run conversion through existing connection ownership and localStorage persistence/recovery before adapter exposure. On export/store failure recover prior durable bytes, re-enable FK semantics, or disable writes if recovery fails. Do not add IndexedDB/OPFS.

Remove the blanket existing-version exclusion. For unset markers, compare the entire bounded normalized legacy content against the relevant persisted version. Matching content must repair the marker atomically without another version; conflicting/ambiguous state must refuse rather than use stale questions or silently overwrite either side. Preserve 1–200 questions and whole-test validation/sourcePage rules. IDs and markers persist inside the atomic conversion; interruption must retry without duplicates.

Use one specified normalized content hash representation for native/browser conversion, Gemini regeneration and structured import. Do not hash raw JSON formatting on one platform and canonical objects on another. Test equivalent content with changed key order/whitespace and conflicting content, including imported NULL source pages. Keep accepted packet validation and source identity rules intact.

Permanent proofs: conversion transaction failure blocks readiness; direct native writer bypass refuses; durable browser conversion failure/recovery; successful retry and restart; unset marker matching repair; unset marker conflict without mutation; shared hash parity; existing 200-question/quarantine guards.

## 2. R2: derive truthful completion and unchanged response receipts

Both completion engines must compute counts from frozen item keys and persisted selected choices/dont-know state. Validate ownership/options/selection semantics and do not treat stored `is_correct` as scoring authority. Do not silently bless malformed data. Keep answered/unanswered/dont-know distinct and derive the one-decimal percent from nonzero frozen item count. Match totals and immutable final snapshots in native/browser behavior.

For a same-choice new operation, use the original persisted answered timestamp and revision in its result. Record the new operation receipt in the same transaction, without modifying the answer timestamp or revision. Preserve identical historical replay even after later valid changes/closure and refresh reads separately.

Promote both native and frontend score/no-op diagnostics into permanent tests. Keep controls for ordinary correct/incorrect/dont-know, early completion, all-answered NULL cursor, closed attempts, stale revision and lost-ack replay. Use an injected clock or other deterministic seam where appropriate rather than permanent timing-sensitive assertions.

## 3. R3: complete schema-aware validation and recovery

Extend the read-only application archive verifier to implement the already-approved Appendix E contract. The positive schema-11 control must remain accepted. Missing required indices/triggers/columns, orphan sources/owners and malformed receipt JSON must refuse. Add the actual foreign-key check plus semantic ownership validation; merely checking table presence or SQLite quick_check is insufficient.

Validate all bounded items and their options/key/source page; attempt/version/material/history associations; response choice bounds, dont-know/correctness and version ownership; allowed statuses, timestamps, revisions, active/in-progress uniqueness and detached inactive history. Recompute completed totals/rounded percent from frozen content and selected choices; compare every persisted count and require an appropriate completion score/time.

Parse and validate receipt operation identity, allowed action, hash, time, result shape and history/attempt associations. Preserve legitimate historical receipt snapshots that differ from current mutable state. Erased tombstones may reference removed attempts but contain no response/result content. An identical tombstone replay refuses; changed input under the same operation ID conflicts according to the reviewed precedence. Validate success/replay shapes at IPC/repository boundaries before reporting saved state. Reject malformed browser payloads with the fixed INVALID_ARGUMENT error, including null/undefined, rather than leaking runtime exceptions.

Keep schemas <=10 accepted under existing checks without requiring schema-11 tables; schema >11 refuses. Restore startup must apply missing migrations, convert/reconcile, then validate before session writes are ready. Preserve pre-upgrade copies and existing staged restore/recovery/rollback conventions; conversion failure must not delete recovery evidence or mutate a read-only archive. Demonstrate a valid current archive round trip, an older archive upgrade, corrupt structures/receipts/owners/choices/tallies and interrupted conversion/restore using disposable fixtures. Tests should cover the meaningful invariant categories, not mechanically mirror each SQL statement.

## 4. R4: eliminate unsupported atomic writer fallbacks

In documentRepository.savePracticeTest/removePracticeTest, require the corresponding atomic method before any write. Refuse unsupported adapters using existing sanitized conventions. Leave the legacy read shape usable by PR 1 UI. Zero-write regression tests must prove neither legacy content nor versions/attempts/receipts change when atomic support is absent.

Retain atomic regeneration semantics: validate before mutation; abandon unfinished work with revision change; deactivate prior version; insert replacement/version/items/legacy marker together; roll back all changes on a mid-write failure. Retain create-new structured import and accepted idempotent import retries. Test real concurrent native starts, not just a duplicate-index insertion; test failed replacement and import/reopen when existing tests do not prove them.

## Verification, evidence and stopping point

First promote the exact review failures into readable permanent regressions and record their fail-before result against the submitted source. The supplied diagnostics have seven frontend failures, five native failures and one native positive control. Their temporary runner restores source files after execution; adapt test placement/helpers safely. Preserve the original implementation report/gates. Fix source, run focused tests and the relevant existing backup, practice-session, structured-import, migration and browser durability guards. Do not repeat settled unrelated audits.

After focused checks pass, run one sequential required source gate using current scripts and the accepted Mac toolchain setup. Prior execution used Node 22.23.3/npm 10.9.9 and rustup stable Rust 1.99.0 with SDKROOT `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`; inspect available paths rather than installing new dependencies unnecessarily. Required gate: typecheck; full frontend tests; production build; locked Rust all-target tests; locked Clippy with warnings denied; fmt check; Cargo-lock check; diff/migration consistency. No overlapping full matrices or speculative CI pushes. Rerun only failures or checks justified by subsequent changes. Never alter shipped migrations 1–10; Migration 11 is still unmerged and may be corrected consistently with both registries/checksums if required.

Use only disposable databases/browser stores. No app launch, real profile, account setup, provider requests, installed smoke test, installer, signing/notarization/release or PR 2 UI/erase feature. Source acceptance does not certify installed behavior. No new dependencies/services or scope expansion.

Create a new correction evidence directory/report with R1–R4 issue-to-fix-to-test mapping, actual test names, exact commands/exit codes/counts, native/browser differences, original fail-before plus final pass-after logs, and a final non-self-referential hash receipt. Correct the original report's nonexistent test-name references and overstatements while preserving its initial execution evidence as historical. Do not call unique-index checks concurrent command tests or claim backup/restore cases not actually exercised. Update STATUS and PROJECT_HANDOFF as corrected pending independent re-review.

Leave implementation and corrections uncommitted/unpushed. Return checkout/branch/base, changed files, findings addressed, any remaining concrete issue and precise evidence paths. Stop for independent review before PR 2. Do not self-accept, merge, publish or start a new roadmap task.
