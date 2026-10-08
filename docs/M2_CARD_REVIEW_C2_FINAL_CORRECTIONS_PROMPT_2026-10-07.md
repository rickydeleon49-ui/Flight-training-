# M2 Card Reviews C2 — Final planning corrections (7 October 2026)

You are the owner-selected implementation model. Complete one focused planning/proof package, then stop for independent review. Work precisely and keep pace: retain verified work, finish the concrete failures in this assignment, and avoid unrelated refactoring or duplicate preparation audits.

## Outcome and authority

The student will eventually have offline Study Library Review due and History views, with correct filters, bounded discovery, trustworthy history and current summaries after lifecycle changes. This assignment finishes their executable planning contracts and conditional implementation prompt. It **does not authorize production C2**. C1 and its approved defaults stay accepted. C2-D1–D9 stay proposed until independent scope acceptance and owner choice. The real-user check-in waiver persists. Do not add source features, dependencies, migrations, provider calls, installed/Xcode/signing/mobile/release work.

Read `docs/M2_CARD_REVIEW_C2_COMPLETION_REVIEW_2026-10-07.md` and its evidence. The prior 9/9 and 12/12 frozen cases, submitted 21/21 tests, production pure logic reuse, actual schema initialization, real 3/2 SQL batching and within-batch ranking are verified. Preserve them. The new diagnostic has **2 controls passing / 14 assertions failing**. The precise fixes below consolidate this round's required work.

## Start safely from the existing submission

Use `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty `codex/m2-card-review-c2-scope`, reviewed HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`.

1. Fetch origin; confirm branch/HEAD/status. Do not pull/reset/stash/switch/apply origin over dirty files. Read the new report/prompt with `git show origin/main:<path>`.
2. Verify the **32-path** reviewer manifest at `origin/main:docs/evidence/m2-card-review-c2-completion-review-2026-10-07/submitted-source-hashes.json`. Report any mismatches before touching affected work; preserve competing changes. A fetched documentation merge does not require rebasing this dirty planning branch.
3. Preserve the original, corrections and completion evidence directories byte-for-byte. Create `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/`; copy current proposal/prompt into its submitted snapshot before editing. Write new proof, tests, receipts and results only there. Rewrite the four live delivery docs (`STATUS.md`, `docs/PROJECT_HANDOFF.md`, scope, conditional prompt) with new entries/supportable final contracts; never erase historical failed receipts.
4. Directly reuse production `cardIdentity.ts`, `cardScheduler.ts`, `localDay.ts`. Keep C1 limits, sourcePage validation, Unicode handling, identity and `simple-v1`. Node 22 can import these pure TS modules. Baseline disposable databases execute shipped migrations 0001–0012, with no optional index. Any evidence-only variant stays explicitly unapproved.

## A. Implement the declared filters (R7)

Use one typed spaced-repetition `statusFilter` (`all`, `due_today`, `new_only`) distinct from material metadata `reviewStatus`:
- all: due or new cards;
- due_today: totalDueCount > 0, including mixed due/new;
- new_only: no due cards and newCount > 0.

Derive exact current content/counts, then filter before urgency sorting and page partitioning. Carry filter identity into continuation. History `materialId`/topic filters must execute in SQL before LIMIT and compose correctly with both halves of the keyset predicate. Do not filter only the returned page. Cover filtered traversal beyond ineligible prefixes, mixed materials and tied timestamps using full ordered-ID oracles. Keep the existing priority CASE expression that puts next_up first; correct documents that imply `(priority = 'next_up') ASC` has that meaning.

## B. Make continuation current and owned (R8)

The reviewed `rem` cursor directly serves serialized summaries. It leaks old topics and resurrects deleted/empty-content rows; clock changes retain obsolete due counts.

Choose and implement a bounded continuation contract:
- Versioned reader-kind token with normalized query identity, clock/local-day/zone ownership and compatible generation/invalidation rules. Reject mismatched/stale tokens with a specific cursor error, or restart/revalidate explicitly. The new frozen test accepts explicit cursor rejection or correct fresh results.
- Pending batch entries cannot be treated as current authoritative summaries. Carry bounded IDs/version references and revalidate live metadata/raw identity/state, or provide an executable invalidation mechanism that covers deletion/reset/content/restore/time changes. Direct API continuation must meet the frozen deletion/content cases as well as UI invalidation.
- Preserve every undisplayed pending identity and the last-scanned candidate key. No skipped work, full-library reread or offset paging. Keep within-batch urgency sorting and be honest that it is not global urgency order.
- Bound cursor encoding/decoded size and validate shape/reader kind/integer limits. Changing page size in an otherwise compatible query may consume the same pending stream; switching filters/clock must not reuse old summaries.
- Keep at most 250 evaluated candidates per call, hard integer bounds and meaningful progress on an empty incomplete page. If correctness adds bounded revalidation SQL, measure and document it rather than forcing the old three-call count. Label page-local counts and define cumulative loaded counts/completion/reset behavior explicitly.

Add permanent tests for filter switch, deleted pending row, valid-empty/changed pending content, changed clock, malformed/wrong-reader token, same-query smaller/larger page size, reset and retained A→B→A schedules. Keep the previous forward-progress diagnostics unchanged.

## C. Complete the asynchronous controller (R9)

Use an owned operation installed synchronously **before invoking the injectable reader**, with generation/operation/query identity checks on resolve/reject/finally. Cover readers that synchronously throw as well as returned promise rejection; a settled failed read must release its own lock so Retry invokes another read.

Dedup keys must be explicit by reader kind: due rows by material ID, history rows by event ID. Multiple events from one material are legitimate. Use full ordered history-ID equality, not only a length assertion.

On filter/route/reset/delete/content/clock/zone/restore/disposal invalidation, reconcile rows, counts, cursor, isLoading/error/failedCursor and the owned lock together. Existing reset retains surviving stale summaries, then dedup blocks refreshed versions of those rows. Prefer clearing a restarted traversal or explicitly replacing/reordering retained summaries. Choose one behavior and prove it. Specify whether a mutation notification starts its authoritative read itself or its caller does; test through read settlement rather than only the immediate state after notification. An acknowledged mutation is never replayed by read Retry.

Keep same-turn exclusion and terminal-page guard. Hold A; invalidate and hold B; settle/reject/finally A; ensure B remains owned. Add synchronous throw→retry, asynchronous rejection→retry at a non-null cursor, reset refreshed-summary replacement, repeated history events across pages, deletion, disposal and idle invalidation. The published held-B control already passes and must remain passing.

## D. Complete inspectable historical context (R10)

Distinguish current, earlier, valid-empty, unavailable and malformed saved content. Do not change C1's parser simply to split C2 presentation contexts; retain saved-row/raw-value provenance around the parser result.

Declare and implement complete nullable historical payloads: priorState, nextState, generation, scheduler identity, frozen item/version/source context and honest interval/due presentation. The new diagnostic uses known prior/next state objects; expose those fields or a documented semantic-preserving adapter. Never invent an interval for missing/corrupt legacy state. Provide a typed frozen-version inspection target and read-only destination/component contract, including removed/current/earlier content behavior and compatibility with existing practice history routes. Do not promise an inspection destination whose API does not exist.

Extend the existing passing file-backed roundtrip to persist/reopen historical entries and compare actual discovery/history. Preserve the schema-11→12 proof; accurately state that shipped 0012 performs DDL while C2 adds no further migration. Disposable proof does not establish production archive restore, installed behavior or WebKit compatibility.

## E. Finish reliable evidence and bounded-read accounting (R4 continuation/R11)

The submitted mutation runner catches any exception as success and writes literal zero even when mutants survive. Replace it with real isolated child test runs of the same behavioral assertions against baseline and representative wrong-version/time/cursor/owner mutants. Capture stdout/stderr and actual exits; require an intended assertion failure and fail on survival or tooling/import errors. Add a verifier survival control: disabling a mutant's intended failure must make the verifier fail. The reviewer control demonstrates the current runner reports success with all three assertions removed. Do not suppress errors or manufacture exit receipts.

Preserve valid whole-call measurements and audit the final executed pipeline, including continuation/revalidation. Count SQL calls/returned rows, estimated serialized UTF-8 bytes, candidate/card/hash work, cursor size, and actual ranking/controller preparation. The prior component timing uses fabricated `dummyList` ranking: instrument final rows or label/remove the surrogate timing. Node/SQLite runtime is separate from unmeasured desktop IPC/WebKit.

Finish the previously required explicit worst-case budgets: 250 candidates × up to 500 cards means 125,000 cards, so candidate count alone is not a byte/memory budget. Specify raw-byte/parse/retained-row/cursor/IPC bounds and incremental continuation when a bound is reached. Measure representative stress safely in disposable fixtures (mixed/all-due/ineligible-prefix and max-card/text/Unicode), record actual parameters and counts, and label any unexecuted upper-bound estimate clearly. Do not create a multi-gigabyte fixture merely to prove the arithmetic. Preserve fairness and never silently lose work. Revise a recommendation/budget if the data warrants it, with C2 defaults still proposed.

Remove unsupported cache/backfill millisecond predictions and IPC overhead estimates. Replace “zero upgrade risk” with the specific no-additional-migration property; correct “schema-11 restore requires no DDL.” Record proposed latency targets consistently with actual pass/fail/unmeasured status. Avoid falsely calling a short-text single-set benchmark the full maximum-bound proof.

## Acceptance, delivery and stopping point

Run focused proof/controller/history/restore tests, the reliable mutation verifier and its survival control, and relevant final query/accounting/stress checks. Run three reviewer diagnostics **unchanged** with `C2_REVIEW_MODEL=/absolute/path/to/new/proof/contractModel.mjs`:

1. `origin/main:docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`: 9/9.
2. `origin/main:docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`: 12/12.
3. `origin/main:docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`: 16/16, including two controls.

Read/copy frozen tests without replacing dirty delivery files; retain their repository-relative locations so imports resolve. Compare their origin SHA-256 before/after. Use `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <path>`. An adapter may preserve field names but cannot fabricate correct rows/counts/state. Keep existing production imports and no new application source/dependency/migration. Do not rerun unchanged full application/native gates.

Rewrite scope/default table and complete conditional implementation prompt around the final supported design: exact typed inputs/results/cursors, SQL/filtering, bounded pending continuation, controller transitions, counts/empty/incomplete/loading/error/retry, badge reads, history inspection and invalidation. Verify every declared field/function/route is supported or explicitly a future production implementation contract. Keep owner decisions proposed.

Deliver a concise R7–R11 and remaining R4 issue-to-test map, raw commands/exits/receipts, runnable modules, actual baseline failures and final passes, manifests for **every changed delivery path** including four live docs, and separately rooted evidence checksums without circular hashing. Verify all three previous evidence packs unchanged. Report exact branch/HEAD/status and any changed recommendation. Leave changes **uncommitted and unpushed** on the existing dirty branch for independent review. Do not ask for scope approval until this package is complete; do not start production C2.
