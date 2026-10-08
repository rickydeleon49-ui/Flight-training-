# C2 scope corrections independent re-review — 7 October 2026

**C2-R2/R3's reviewed version-state/provenance cases are fixed. C2 planning still needs bounded completion for R1/R4/R5 and new R6 before scope acceptance or owner defaults.** C1 remains accepted. This is disposable planning, not a production defect or authorization to implement C2. [Active model-neutral completion assignment](M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md).

## Identity and verification

Dirty implementation branch `codex/m2-card-review-c2-scope`, original HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`, remains untouched. All fourteen original evidence files are byte-identical. Nineteen correction-evidence hashes verify; a reviewer-rooted manifest freezes all **25 corrected delivery paths**, including the four changed proposal/tracking documents and the correction manifest/checksum files omitted from the implementer's hash list. The handoff's statement that all eighteen original paths still match applies only to the pre-edit check: the four edited docs intentionally differ now; preserved proposal/prompt copies retain their original bytes.

Independent Node 22.23.3: corrected proof **15 pass**, prior frozen diagnostic **9 pass**, both exit 0. New frozen diagnostic (directly importing production identity/scheduler and inspecting shipped migrations): **1 pass / 11 assertion failures**, exit 1; ordinary ASCII identity control passes. [Exact scripts, receipts, exits and hashes](evidence/m2-card-review-c2-rereview-2026-10-07/README.md). No application/native/installed matrix reruns. The earlier scope review and this review concern proof models and conditional requirements only.

## What is closed

Preserve raw-current-version lookup irrespective of active flags, retained A schedule recovery after materialized B, exact-version touch counts, and raw-identity history comparisons for valid content. Preserve consumable candidate progression and reaching actionable items beyond an ineligible prefix. Preserve the complete tied-event oracle and real pre/post deletion IDs. All nine prior cases pass independently. Exactly 10,000 events are now generated at the large scale, hashing is actually performed in the new sample, and desktop/UI latency is correctly marked unmeasured. These corrections are useful and must not be rewritten away.

## Remaining findings

### C2-R6 — duplicated pure contracts drift from accepted C1 (P1, new)

`proof/contractModel.mjs:4–9,25–60`: limits changed from front/back/page **1,000/2,000/1,000** to **2,000/4,000/2,000**; code-point checks became UTF-16 length checks; lone surrogates are admitted; control-character restrictions were invented; empty JSON text becomes `none` instead of `malformed`. The `simple-v1` ladder changed from **[1,3,7,16,35,75,150,180]** to **[1,3,7,14,30,60,120,240]** under the same version label. Step 3 now gives fourteen days rather than the approved sixteen. The planner was explicitly told to preserve these settled contracts.

Fix by directly reusing production pure modules through Node's TypeScript stripping/existing test tooling, or verify an exact twin against production/golden vectors. Do not edit production to match the proof. Cover each limit, Unicode/code-point/lone-surrogate behavior, empty versus malformed sets, all ladder steps and ratings. New diagnostic contains five parser comparisons and the step-3 scheduling comparison; all six fail on this submission. This matters because discovery and benchmark classification currently describe cards and schedules the actual app handles differently.

### C2-R1 — rank, cap and ownership contract remains incomplete (P1, continued)

`contractModel.mjs:495–541`: found materials are returned in candidate metadata order without any urgency sorting, despite C2-D3 requiring Again/day/new bucket ranking **within batches**. One batch containing new `a-new` and due Again `z-again` returns **a-new first**. The public `candidateBatchBudget`/`limit` arguments are unchecked: requesting 1,000 scans all **260** fixture candidates despite the declared cap of 250. Candidate cursor serializes only priority/update/id, with no filter/clock/epoch binding. Single-page summaries are still named library totals; `isComplete` on a terminal page describes only stream exhaustion, not cumulative counts from earlier pages, while the UI prompt requests total banners.

Define candidate progression versus result ranking precisely and implement that actual recommendation. If early stop conflicts with within-batch ranking, evaluate the bounded batch then sort and carry leftover rows/snapshot state without loss, or explicitly revise the owner recommendation to discovery order; do not claim urgency sorting that isn't done. Validate hard caps. Specify cursor query/clock/content ownership, generation invalidation and page-scoped versus cumulative totals, including incomplete discovery and caught-up behavior. The two new rank/cap diagnostics fail; existing progress cases pass.

### C2-R4 — baseline schema and actual read cost still do not match the no-migration recommendation (P1, continued)

`contractModel.mjs:157` adds `idx_materials_priority_updated` to the purported schema-12 baseline. It is absent from **every shipped migration**. The new schema diagnostic executes all actual migrations and confirms that mismatch. A no-migration benchmark cannot silently invent an index. Initialize baseline proof from actual migrations, including old-schema upgrade cases; measure a proposed additional index only as a separately labeled unapproved variant.

Due discovery still performs content/version/state queries per material (`430–464`); history loops one raw query per distinct page material (`605–614`). “Batch-load” is a label, not the implemented behavior. Independent instrumentation on the submitted 5,000-material/10,000-event fixture records **124 SQL calls / 439 returned SQL rows** for fifty due results; history's twenty results require **21 SQL calls / 41 rows**. JSON serialization byte estimates are 161,014 and 61,550 respectively; these are audit estimates, not actual IPC captures. See executable `query-audit.mjs` and raw `query-audit.json`.

Benchmark breakdown is still a separate first-fifty sample, not instrumentation of all actual statements/rows. New proposed-budget JSON still says history p50 target **5 ms** and status `evaluated_below`, while the document declares a revised **15-ms** budget; submitted page-one p50 is 9.63 ms. Resolve the budget revision explicitly. Remove unsupported alternative ~2–4-ms estimates and “instantaneous restore” claims unless justified; retain qualitative comparisons. Add actual executed-call/row/UTF-8-byte/hash counters and bounded batched query examples for node/browser/native boundaries. Re-run only relevant disposable performance cases on the correct schema; label passes, failures and unmeasured runtime costs consistently.

### C2-R5 — controller cannot exercise asynchronous ownership; restore and final history contract remain missing (P1, continued)

`DeferredReadController.loadNextPage` (`733–759`) calls the synchronous query with **no await**, so its stale-generation branch cannot model a held read. The test's supposed stale proof checks only `generation !== 0`; it never resolves/rejects an obsolete request. `setFilter` keeps the old rows, so rows from another filter remain and are appended to. Two same-turn `loadNextPage` calls after a short complete page append the same items twice: no synchronous operation lock or terminal-page guard. Reset restarts the cursor while retaining other rows; material deletion doesn't bump generation; there is no genuine held-response ownership proof.

Provide one small injectable asynchronous page-reader/controller, synchronous busy ownership, request-generation checks across resolve/reject/finally, reset/filter/route/content/clock/zone/disposal invalidation and authoritative fresh reads. Prove real deferred requests and current failure retry retaining its requested cursor. Verify same-turn calls allocate only one read; old finally cannot release a newer lock; exhausted pages cannot be loaded again. Keep page and full-view dedup/cumulative-count semantics explicit.

No executable close/reopen/restore or schema-11 upgrade proof exists, despite the handoff claiming reopen/restore confirmed. The conditional prompt still asks for history intervals/frozen inspection but its type returns neither interval state nor a concrete frozen-version destination; malformed/unavailable/valid-empty content labels remain a single boolean. Finish these contracts rather than treating the fifteen-case port as sufficient. These are continuations of the already-issued assignment, not new roadmap scope.

## Decision

Do not request C2-D1–D9 approval or start C2 production yet. Complete one focused package preserving closed behaviors. [Completion prompt](M2_CARD_REVIEW_C2_SCOPE_COMPLETION_PROMPT_2026-10-07.md) specifies final artifacts and exact old/new diagnostic commands. No production source, dependency, migration, account/provider, installed/signing/mobile/release work is authorized.
