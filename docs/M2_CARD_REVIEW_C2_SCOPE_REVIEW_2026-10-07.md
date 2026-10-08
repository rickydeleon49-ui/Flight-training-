# C2 scope independent review — 7 October 2026

**Corrections required before scope acceptance or owner approval.** C1 remains accepted through PR #111. This review concerns disposable C2 planning, not a shipped application defect. No production changes are authorized. [Active model-neutral correction assignment](M2_CARD_REVIEW_C2_SCOPE_CORRECTIONS_PROMPT_2026-10-07.md).

## Submission and independent verification

Reviewed dirty branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`, in `/Users/rickymac/code/Flight-training-pr70-integration`. Four submitted document hashes and thirteen evidence checksums match. A complete rooted manifest freezes all eighteen submitted paths; submitted STATUS/handoff snapshots are preserved separately because published tracking must carry the review outcome. The implementation clone is untouched.

Independent Node 22.23.3 rerun: submitted proof **15 passed / 0 failed**, exit 0. Reviewer diagnostic: **2 passed / 7 failed**, exit 1, all seven ordinary assertion failures, not toolchain errors. [Frozen executable, raw receipts/exits and hashes](evidence/m2-card-review-c2-review-2026-10-07/README.md). The diagnostic accepts `C2_REVIEW_MODEL` for an isolated corrected model and remains byte-identical on rerun. No unchanged application/native matrix or installed/profile/provider work was performed.

The single-material session approach, offline scope, separate card/practice semantics, and conditional approval gate are useful. Preserve them. C2-D1–D9 remain proposed; their discovery and bounds recommendations are not yet supported.

## Findings and concrete corrections

### C2-R1 — discovery is incomplete, its bound is bypassed and due pagination cannot advance (P1)

`proof/contractModel.mjs:387–558,615–618`: the new-card query always takes the same first 250 raw candidates **before** eligibility; no candidate continuation exists. With 250 recent fully reviewed/future-only materials and an older never-reviewed material, the query returns no actionable material or continuation. It can falsely imply caught up. The returned material-ID `nextCursor` is never accepted/used by the function or typed input, so a second due page repeats page one. Separately, the due query is unbounded and performs one raw-content read/hash per due material: **400 raw reads for a 50-row result** in the diagnostic, exceeding the advertised 250 candidate bound.

Define a real bounded discovery/page contract: deterministic scan cursor including tie keys and query/filter/clock/content ownership; forward progress past ineligible candidates; distinct incomplete scan versus exhausted actionable page; per-request row/query/byte/hash budgets for **both** due and new paths. Batch reads instead of native IPC per material. Exact global urgency ordering/counts require complete discovery or another justified design; partial results must not claim exact totals or caught up. Keep no-migration discovery only if the corrected proof meets those semantics. If a cache/index is necessary, propose it explicitly, retaining the approval gate.

Frozen diagnostics: `[C2-R1] discovery can reach actionable material beyond 250 ineligible candidates`; `[C2-R1] returned due cursor actually advances to a different material`; `[C2-R1] 400 due materials do not bypass the stated 250 discovery bound`.

### C2-R2 — schedules and new counts are not scoped to the raw current version (P1)

`contractModel.mjs:359–361,366,403–445,492–555`: `is_active` denotes the last mutated snapshot, not necessarily raw saved content. If A was reviewed, B was then materialized, and raw content returns to A **without another mutation**, A is inactive and B active; the model returns zero due work and treats A as all-new. The submitted “A→B→A” fixture contains only active A, so it never exercises this state. A second defect counts touched state across the whole material. With four retained A state rows and current B containing three cards/one due state, B reports **0 new instead of 2**.

Derive the current version ID from raw cards, locate retained state by that exact version/current item set regardless of active flag, and count due/new/suspended/flagged state solely there. A changed version is all-new only if no retained state exists for its derived identity. Keep reads read-only. Prove active A→materialized B→raw A with both versions and no active-flag repair, plus cross-version counts in both due and zero-due paths.

Frozen diagnostics: `[C2-R2] raw A reversion reuses inactive A schedule while B remains last-active`; `[C2-R2] retired A state cannot consume current B new-card count`.

### C2-R3 — history provenance labels use the same stale active flag (P2)

`contractModel.mjs:687`; conditional implementation prompt section 3B: `isEarlierVersion = !is_active` labels active A as current after raw unmaterialized B replacement, and inactive A as earlier after raw A reversion. The submitted history test manually clears `is_active`, hiding the mismatch.

For each bounded history page, batch-load distinct material content and compare each event's frozen version identity to the derived current identity. Define labels for valid-empty, malformed or unavailable current content without turning damaged content into a normal empty set. Do not mutate snapshots to repair a read. Keep event-version provenance separate from current material metadata; specify an inspectable frozen-version destination, not just a link that opens current cards.

Frozen diagnostics cover both raw B replacement and raw A reversion without writes. The ordinary current-state control and complete 35-tied-event pagination control pass.

### C2-R4 — architecture/performance recommendations exceed the measured evidence (P1)

Scope comparison rows 73–78 give cache/backfill p50/p95 (8.2/11.4 and 7.9/10.8 ms), storage footprints and zero-ms restore despite no executable comparison or receipts for those designs. Remove these values or actually measure the designs; distinguish estimates from measurements. `benchmark.mjs:199–207` labels a loop over only the first fifty JSON parses as hash verification: it invokes **no hash function**. SQL-only timing omits other executed queries; query counts, transferred bytes and current/unmaterialized card totals are absent. The recorded large fixture contains **9,874 events**, not 10,000. History first-page p50 is **9.301 ms**, above the proposed 5-ms budget; even page two is 5.811 ms. A measured 22.51-ms synchronous in-memory call does not establish the complete 50-ms desktop/UI interaction budget.

Instrument actual candidate executions after R1–R3: all SQL calls and fetched rows/bytes, all JSON validation/canonical/version/item hashing, sorting/preparation, exact current/retained/new fixture sizes, actual SQLite/runtime identity. Benchmark realistic mixed sets and worst cases (all due; many ineligible candidates; 500-card sets), with repetitions and appropriate small-sample tail labels. Apply exact migration SQL to disposable databases or verify a deliberate subset against it. EXPLAIN the exact executed queries, not simplified replacements. Use exactly 10,000 events at the largest required case. Record each budget as pass/fail/unmeasured; UI/Tauri costs remain unmeasured unless tested. Preserve original receipts/results and publish new correction evidence.

### C2-R5 — lifecycle/restore proof and conditional implementation contract are incomplete (P2)

The test header claims all required groups, but executable cases do not cover reset generations, held page results after reset/delete/replacement, restore/reopen, changed zone, or concurrent ratings and page ownership. The regular history test checks uniqueness only across at most twenty rows; it does not compare a complete expected list and cannot establish no omissions. Its deletion item query uses hard-coded nonexistent `ver-aero-01`, so it can pass before deletion. The conditional prompt lacks a due cursor input, complete history options, retained-version adoption, history interval payload and explicit invalidation/controller states; it also leaves `/study?tab=history` versus existing `/study/history` unresolved.

Add small disposable deferred-read/controller and restore proofs, complete history oracle comparisons and real pre/post deletion IDs. Decide history ownership and existing route compatibility; define all typed inputs/results, invalidation tokens, caps and retry behavior concretely. Rewrite the conditional prompt around corrected contracts; do not port the current fifteen tests as if sufficient. Carry actual browser/native read boundaries and archive compatibility into the required implementation checks, while retaining no implementation authorization until independent acceptance and owner decisions.

## Next step

Finish one bounded C2 planning correction package. Preserve the submitted planning evidence and the accepted C1 contracts; create no production source/dependency/migration changes. Re-run the frozen diagnostic against the corrected model, promote the missing cases, and deliver corrected scope/defaults plus a complete conditional implementation prompt for independent re-review. Owner approval follows a reviewable, supported recommendation; no repeat C1 approval is needed.
