# M2 Card Reviews C2 — Completion review (7 October 2026)

**Disposition: corrections required before independent scope acceptance or C2-D1–D9 owner approval.** The production-contract, baseline-schema, batching and within-batch sorting corrections are verified. The submitted statement that every finding is resolved is not supported by the remaining query/controller contracts. This review publishes the submitted planning package as a frozen, unaccepted snapshot; it does not activate production C2.

## Frozen source and proportional verification

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. All **32 submitted delivery hashes** match. The two older evidence packs match their published versions byte-for-byte. Production pure imports are identical to main. No implementation-clone file was edited, staged or committed by the reviewer.

Independent review used a managed worktree based on `d64911acb1e96a4f3ed155c5c1a864f38c28f76e`. Receipts and runnable diagnostics are in [the review evidence directory](evidence/m2-card-review-c2-completion-review-2026-10-07/README.md).

| Independently executed check | Result |
|---|---|
| First frozen diagnostic, unchanged | 9 pass, exit 0 |
| Previous re-review diagnostic, unchanged | 12 pass, exit 0 |
| Submitted completion proof | 21 pass, exit 0 |
| New completion diagnostic | **2 controls pass / 14 assertion failures**, exit 1 |
| Actual executed SQL audit | Due: 3 calls, 50 results, 1,061 returned SQL rows, 679,200 estimated JSON UTF-8 bytes. History: 2 calls, 20 results, 41 returned SQL rows, 65,465 estimated bytes. Exit 0. |
| Mutation-runner survival control | Remove its three assertions in an isolated specimen: it still exits 0, writes `negative-controls.exit = 0`, and prints completion, with **zero expected-failure markers**. |

SQL byte counts are estimates of serialized SQL results, not measured desktop IPC. Existing timing receipts were inspected, not rerun or promoted to installed/WebKit results. No unchanged full application/native matrix was rerun.

## Verified corrections to preserve

- R6: production TypeScript parsing/scheduling/local-day exports are reused. The six prior parity cases now pass; accepted C1 limits and `simple-v1` intervals remain intact.
- R4 baseline/batching: actual migrations 0001–0012 initialize the disposable database. The invented index is absent from baseline and is labeled an unapproved evidence-only variant. The actual pipeline now batches raw cards and review state, independently reducing SQL calls to 3/2.
- R1 ranking/caps: the prior within-batch ordering and oversized-budget cases pass; undisplayed batch items are retained; page summaries are explicitly page-local. Prior forward-continuation fixes remain passing.
- R5 initial lifecycle proof: injected held promises, same-turn exclusion, filter-row clearing and stale-resolution ownership are real. File-backed discovery close/reopen and schema-11→12 upgrade tests pass. They do not establish all remaining lifecycle or historical inspection behavior.

## Required corrections

### C2-R7 — P1: declared filters are not implemented

In the submitted `proof/contractModel.mjs`, line 138 destructures `reviewStatus`, which filters material metadata at lines 215–218. It never reads the declared spaced-repetition `statusFilter` (`all`, `due_today`, `new_only`). With one new-only and one due material, both queries return both materials. These are different concepts: material review status cannot implement card due/new selection.

`getLibraryRecentReviews` at lines 443–490 ignores the declared `materialId` and `topic` options. With the newest event from material B, a limit-one request for material A or A's topic returns B.

**Fix:** align proof and typed inputs; apply due/new predicates after deriving current counts and before ranking/page splitting; apply history filters before LIMIT/keyset pagination. Include filter identity in cursor ownership. New diagnostic cases 1–4 fail. Keep mixed due+new materials in all/due, exclude them from new-only, and prove filtered multi-page traversal.

### C2-R8 — P1: cached cursor summaries escape current query/content ownership

Lines 151–194 serve `decoded.rem` directly, without checking filter, clock boundary, current raw content or whether the material still exists. A pending two-material cursor:

1. Returns an aerodynamics row after switching to navigation.
2. Returns material B after SQL deletion of B.
3. Returns B's old new-card summary after B becomes a valid empty set.
4. Returns a due summary after changing the clock/day boundary so it is no longer due.

**Fix:** validate a versioned, kind-specific cursor against normalized query and clock ownership; reject stale tokens explicitly or revalidate pending IDs in bounded current reads. Do not treat client-carried summaries as authoritative. Define mutation/content/restore invalidation, cursor size/input bounds and integer limit validation. Preserve all pending identities without loss and allow a page-size change within an otherwise compatible query. New cases 5–8 fail. More queries are acceptable when needed for correctness; revise and measure budgets honestly.

### C2-R9 — P1: controller drops history and can remain locked or stale

Four independently reproduced defects in lines 621–703:

- **Event identity:** lines 634–636 choose `materialId` before `id`. Two history events for one material collapse into one. Use explicit reader-kind identity: due rows by material ID, history rows by event ID.
- **Synchronous rejection:** the reader throws before the first await yields; finally clears the lock, then line 661 overwrites it with the rejected promise. Retry cannot invoke a new read. Install the owned operation before invoking the reader, including synchronous throw handling.
- **Reset reconciliation:** `onReset` retains other summaries, resets the cursor, then fresh first-page rows are suppressed by dedup. An old `newCount=1` survives an authoritative `newCount=2`. Clear the entire traversal or replace/reconcile the retained entries and order/counts using current authoritative results.
- **Idle invalidation:** `setFilter` invalidates a held read without clearing `isLoading`; old finally no longer owns state, so the new idle generation remains loading forever. Reset/delete/dispose must also leave coherent loading/error/lock state.

New cases 9–12 fail. The stronger held-A/held-B ownership control passes; preserve it. Existing `onReset`/delete tests only inspect immediately after the method and do not actually prove the automatic fresh read claimed in their names. Specify who initiates that read and test it through settlement. Provide cumulative-count and route/content/clock/zone invalidation contracts or explicitly narrow the proposed UI so no unsupported whole-library totals are promised.

### C2-R10 — P2: historical context and inspection contract remain incomplete

Lines 513–578 use the C1 `none` parser result to collapse valid `[]` and an absent saved-set row into `unavailable`. C1's parser need not change: C2 can distinguish those contexts from the saved row/raw value. The SQL selects prior and next state, generation and version creation time, but the returned payload discards most of them. The proof named “interval, step, and card sides” never asserts interval or state. The conditional prompt promises interval progression without declaring its interval representation or a frozen read-only inspection destination.

**Fix:** provide explicit current/earlier/valid-empty/unavailable/malformed provenance; carry validated nullable prior/next state and honest interval context, without invented intervals for missing legacy state; declare a typed frozen-version inspection target and read-only route/component contract. Cases 13–14 fail. Include persisted history in the existing file-backed roundtrip; do not claim native archive or installed verification.

### C2-R4 evidence continuation / C2-R11 — P2: unsupported claims and a non-enforcing mutation gate

`runMutants.mjs` lines 38/67/99 catch every exception as an expected failure and line 106 writes literal `0` regardless of whether any mutant failed. The independent assertion-removal control proves surviving mutants are not detected. This is an evidence defect, not a new production failure.

**Fix:** use isolated child runs of the same behavioral assertions against baseline/mutants; record actual exits, require intended assertion failures, fail on survival/tooling errors, and cover time and ownership as required by the earlier assignment. Make the mutation verifier itself fail on a survival control.

The scope comparison still gives unmeasured cache/backfill predictions (~2–4/~2 ms), says schema-11 restore needs no DDL, and calls upgrade/client risk zero. The passing schema-11 proof explicitly executes shipped migration 0012. Remove those claims; distinguish “no additional C2 migration” from the existing schema-12 upgrade. README still predicts unmeasured IPC overhead. Benchmark `pipeline_breakdown` sorts a fabricated `dummyList`, not the final rows; label it a surrogate or instrument the actual pipeline. The single 500-card stress set uses short text, and does not prove the explicit 250-candidate/max-card/text/Unicode budget requested earlier. There can be 125,000 cards in one candidate batch; specify memory/raw-byte/IPC/cursor bounds and meaningful continuation, including measured representative stress or honest unmeasured limits. Keep valid whole-call timings and the verified SQL batching; do not rerun unchanged matrices.

## Next assignment and stopping point

Execute [one model-neutral final correction assignment](M2_CARD_REVIEW_C2_FINAL_CORRECTIONS_PROMPT_2026-10-07.md) in the existing dirty planning branch. Preserve all submitted evidence and the closed behaviors above. Deliver the corrected executable contracts and supported scope/prompt uncommitted/unpushed. C2-D1–D9 remain proposed; C1 acceptance and the real-user waiver persist. The reviewer will accept and move to owner scope approval when this bounded assignment meets its criteria.
