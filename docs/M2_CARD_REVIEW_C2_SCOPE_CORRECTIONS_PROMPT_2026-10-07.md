# C2 planning corrections — model-neutral assignment, 7 October 2026

Complete the reviewed C2 scope package, not production implementation. Any owner-selected model may perform this task. This supersedes the original planning assignment for remaining work; preserve C1 acceptance and C-D1–D8. C2-D1–D9 are proposed and unapproved. The owner check-in waiver persists.

## Start without overwriting competing work

1. Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-card-review-c2-scope`, original HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Expect the submitted dirty planning files. Fetch main but do not switch, pull over, reset, clean, stash or copy main's tracking files over that submission.
2. Read this prompt and `docs/M2_CARD_REVIEW_C2_SCOPE_REVIEW_2026-10-07.md` via `git show origin/main:<path>` if absent locally. Read the review's eighteen-path `docs/evidence/m2-card-review-c2-review-2026-10-07/submitted-source-hashes.json`, and verify every path before editing. Report unexpected changes and preserve them; do not automatically abandon already-authorized unaffected work.
3. Preserve the entire original `m2-card-review-c2-scope-2026-10-07/` evidence directory byte-for-byte. Put corrected proof modules, fixtures, measurements and receipts in `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`. Revise the two proposal/prompt documents to point to corrected evidence. Preserve the old proposal/prompt copies inside the new pack before editing. Do not alter the review's frozen diagnostics or receipts.
4. Use the project's Node 22 tooling when available (`/opt/homebrew/opt/node@22/bin` on this Mac). Record actual runtime/SQLite/host identity. Use current shipped migrations/C1 identity and time contracts; add no production dependency.

## Required outcomes — finish all five findings coherently

### R1: genuinely bounded, complete discovery and paging

Reproduce the three discovery diagnostics before fixing them. Design one coherent read contract rather than patching the 250 cutoff with an unlimited scan:
- Reach older actionable materials behind 250 ineligible candidates by explicit bounded continuation. Never say caught up while discovery is incomplete.
- Supply a consumable due cursor and deterministic tie keys. Distinguish candidate scan progress from actionable-result paging if needed; stable paging must have neither duplicates nor omitted items.
- Bound the due path as well as the new path. Batch content/state reads, avoiding one IPC call per material. Define concrete maximum requests, returned rows/bytes, parsed cards and hashes per request; prove bounds with instrumentation.
- Define exact versus partial summary fields, exhausted/incomplete states, filter/clock/zone ownership and refresh semantics. A global urgency rank must not claim completeness before all relevant candidates have been considered. Explain whether discovery progressively collects a bounded snapshot or uses another measured architecture, with truthful UI labels.
- Re-evaluate C2-D8/D9 with the corrected evidence. No migration is preferred only if it satisfies correctness and the actual budgets. A necessary cache/index remains a proposal under evidence, not authorization to add migration 13.

### R2: raw current version owns every count and retained schedule

Use raw saved card identity as authoritative, then query retained state for that exact version/current item IDs. Do not use `is_active` as a substitute for identity or count touched states across versions. A→materialized B→raw A must recover A's due/new/suspend/flag state before any further write; raw replacement with never-materialized B must exclude A. Prove retired A rows cannot reduce B new counts, including zero-due and mixed due/new cases. Keep reads read-only and preserve C1 session limits/replay/reset behavior.

### R3: accurate, inspectable history provenance

Batch distinct page material identities and compare event version IDs to current raw identity. Prove both raw B replacement and raw A reversion without changing active flags. Explicitly define unavailable/malformed/empty current-content labels. Include frozen version context and the minimum history payload required for interval progression, source references and inspectable historical content. Decide the navigation destination and preserve accepted practice routes; avoid accidentally presenting current cards as the frozen reviewed version.

### R4: measured architecture and performance evidence

Remove unsupported cache/backfill timing, storage and zero-ms restore numbers or measure them with runnable code/receipts. Qualitative tradeoffs are sufficient; do not manufacture precision. Preserve all original receipts and label corrected values separately.

Instrument actual executed queries, row/byte counts and the full discovery pipeline (JSON validation, canonicalization, content/version/item hashes, sorting/preparation). The original “hash” benchmark only parses fifty JSON strings; do not retain its label/value as full hash cost. Record material count, valid current cards, retained items, changed/unmaterialized versions, state/event counts separately. Use actual migration SQL or an explicitly checked equivalent subset. Generate EXPLAIN for exact executed queries.

Exercise 100, 2,500 and 5,000 materials with exactly 10,000 events at the largest case. Include mixed realistic data and adversarial all-due, ineligible-prefix and maximum 500-card sets. Record repetitions, median/tail timings and query/result bounds for one request and complete discovery separately. Assess every proposed budget against recorded measurements; fix failed budgets/design or propose justified changes. State desktop IPC/UI work as unmeasured unless measured. Do not infer a complete 50-ms interaction budget from synchronous in-memory SQLite alone.

### R5: complete lifecycle/restore contracts and meaningful assertions

Add disposable proofs for:
- Full tied-event traversal compared to an independent expected ordered ID list, plus filter-bound cursor rejection/reset and concurrent rating behavior.
- Held successful/error page continuations across route/filter/clock/zone changes, reset, deletion and content replacement; prior results cannot republish erased history or release a newer lock. Use a small explicit deferred-read controller model, not prose alone.
- Reset generation and authoritative re-read, same-render exclusion, failure retaining a valid cursor for deliberate read retry. No retry should replay a write.
- Disposable close/reopen or backup-copy restore, empty versus malformed raw data, and valid old schema upgraded through shipped migrations. Distinguish SQL/discovery proof from actual native archive/desktop verification still required later.
- Real pre/post deletion item/version/event IDs rather than a nonexistent hard-coded version ID.
- Exact Again/day/DST/time-zone behavior, eligibility before bounds and deterministic ordering. Preserve accepted C1 identity/time golden vectors or directly reuse the production pure logic through existing tooling; avoid drifting duplicate implementations.

Run meaningful wrong-version/time/cursor-or-owner mutants against the same semantic assertions in isolated copies. Capture failing receipts/exits and verify restored proof hashes. Do not suppress errors, skip cases, increase timeouts or change production behavior for this planning task.

## Frozen diagnostic execution

Read the reviewer diagnostic byte-for-byte from `origin/main:docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs` and place an identical copy in a scratch directory. It supports `C2_REVIEW_MODEL` as an absolute path/file URL to corrected `contractModel.mjs`, so original submitted proof evidence stays unchanged. Run the nine cases without editing assertions: the submitted baseline is **2 pass/7 fail, exit 1**; corrected model must give **9 pass/0 fail, exit 0**. Preserve both receipts and diagnostic SHA-256. The default import resolves relative to the original review evidence directory; use `C2_REVIEW_MODEL` for scratch runs. If the new public result contract changes, use a documented thin proof adapter preserving semantics, never an adapter that fabricates results to satisfy the tests.

## Reviewable delivery

Rewrite `docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md` around final recommendations with one C2-D1–D9 decision table, alternatives, tradeoffs and exact owner approval impact. Resolve the History route/sub-tab choice and new-only filter semantics; mixed due/new materials must have an explicitly defined behavior. Include typed bounded inputs/results/cursors, query ownership, invalidation states, current-version joins, existing native/browser read boundaries and exact-vs-partial counts.

Rewrite `docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md` as a complete conditional assignment for the final design: exact routes/files, complete types/contracts, UI loading/error/incomplete/empty behavior, session entry, historical inspection, meaningful browser/node/native/query/controller/restore tests and proportional gates. Keep activation dependent on independent scope acceptance plus recorded owner decisions. A schema change, new dependency, persistent backfill or retention change requires its own explicit decision; do not silently fold it into prior C1 approval.

Update STATUS and PROJECT_HANDOFF to “C2 planning corrections complete, pending independent re-review and owner defaults,” preserving all history and pointing to new evidence. Correct prior claims by a new entry, not by erasing receipts. New evidence must contain R1–R5 issue-to-fix/test mapping, executable proof, benchmark results, raw logs and explicit exit files, source manifest and checksums. Verify original evidence remains byte-identical and freeze every changed delivery path.

Run the corrected proof, frozen diagnostic, representative mutation checks, benchmarks and authored documentation hygiene. Do not repeat unchanged app/native matrices. No app launch, user account/profile, provider/network calls, production source/dependency/lockfile/migration, installed/signing/mobile/release work.

Leave everything uncommitted and unpushed on the existing planning branch for independent re-review. Complete the package before seeking owner default approval. Do not start production C2.
