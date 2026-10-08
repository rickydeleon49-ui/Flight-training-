# M2 Card Reviews C2 — Contract-finish review (7 October 2026)

**Reader corrections verified; six integration/contract failures remain.** Preserve the 67 passing frozen cases and finish [one narrow model-neutral assignment](M2_CARD_REVIEW_C2_STATE_PUBLICATION_PROMPT_2026-10-07.md). C2 scope remains unaccepted and C2-D1–D9 proposed. C1 acceptance and prior owner decisions persist.

Reviewed dirty `codex/m2-card-review-c2-scope` at `9028675475616ce338253ae7e4e46ba6b840b72c`, in an isolated worktree based on main `fb894685c8264da74e0a586442180ca7e52ccb2b`. All **45 source hashes** and **41 submitted evidence checksums** verify. The implementation clone and all seven submitted evidence packs remain byte-identical. [Frozen snapshot and receipts](evidence/m2-card-review-c2-contract-review-2026-10-07/README.md).

## Verified progress

- Six original reviewer files pass unchanged: **67/67**, exit 0.
- Submitted proof **46/46**, exit 0; mutation baseline/four assertion-killed mutants/survival control work.
- Reader oversized-content outcomes now return explicit issues and preserve later-material progress. History checks the absolute cap before raw transfer. Valid mixed-size parsing examples respect the conservative admission check.
- Missing/duplicate key fields and bad history timestamps/ID lengths from the previous review are rejected. Supported/unsupported scheduler ownership and date/count validation cases now pass. These findings are closed for their demonstrated behaviors; do not rewrite those fixes.
- Benchmark component twins are now labelled approximate; full-reader timings and actual max-text/escaping distinctions remain useful. Relative sibling links are corrected.
- Independent executed SQL audit: due first/continuation/filter **175 / 150 / 177** calls; history **22 / 22 / 22**. The pasted report's three-statement due claim is incorrect. Stage counts must distinguish metadata/state batching from per-set raw reads.
- New frozen diagnostic: **one supported-schedule control pass / six assertion failures**, exit 1. No unchanged full app/native/Xcode gates were run.

## C2-R4 continued — failed parses do not spend the promised work reservation

Source: submitted `proof/contractModel.mjs`, pending loop around lines 523–567 and discovery around 748–799. The guard checks `cumulativeCards + 500`, but `cumulativeCards` is only increased after successful card parsing/derivation. No reservation is spent when parsing fails.

Three stored JSON arrays, each containing 500 objects with an invalid back field, are all fetched/parsed under a **500-card work budget**. Independent measurement: **three raw reads**, while `evaluatedCards` is **zero** and the scan terminates. Byte bounds still apply; the claimed card-work reservation does not. Charge before every attempted raw parse, retain the charge for failed parses, and preserve continuation once work allowance is consumed. Valid sets can reconcile a conservative reservation to their known parsed count. Keep counters for attempted work separate from successfully derived/emitted cards. New case 1 reproduces this unfinished malformed-work requirement.

## C2-R4/R9 continued — warnings disappear at the controller boundary

`DeferredReadController.loadNextPage` adopts only `materials/rows`, cursor and basic flags. It never stores returned `issues` or summary metadata. A reader result containing an oversized-content issue, zero materials and null cursor becomes terminal empty controller results with **`controller.issues === undefined`**. The newly fixed reader warning therefore cannot reach the UI through the proposed controller.

Publish typed generation-owned issue/summary state with results; retain earlier-page issues through traversal and clear/reconcile them on authoritative invalidation. Distinguish candidate-stream completion from safe caught-up state. Preserve synchronous operation ownership and stale-result guards. New case 2 demonstrates the lost publication.

The warning's `inspectionTarget` is currently **`/materials/a`**. Production routing in `src/App.tsx:65` registers **`/study/:materialId`**, while `:77` catches unknown routes. Use the existing Study route (or a typed existing read-only inspection target), not an unregistered path. New case 3 checks the actual route. Opening that destination is not permission for automatic content mutation or provider calls.

## History enrichment needs a separate bounded publication contract

`getLibraryRecentReviews` first pages events by cursor, then `enrichMaterialIds` only sorts material IDs found in that page. It neither selects targets independently nor returns a separate enrichment patch.

**Unreachable deferred prior page:** with tied event IDs `c,b,a`, limit 2 and two max-ASCII sets under 2 MiB, first page is `c,b`, with b deferred. Request the next event page with `enrichMaterialIds: ['b']`: only a is queried; b is absent. Targeted enrichment cannot resolve the already loaded prior page. New case 5 reproduces this.

**Regression on targeted retry:** first two-set page returns b current / a pending. Re-request targeting a. The method returns a current / **b pending**. It includes whole event rows for an untargeted unread set; whole-row adoption would downgrade previously resolved b. Alternating retries can move the pending label between rows. New case 6 requires target-only enrichment patches or an equivalent non-regressing result.

Finish a bounded enrichment path independent of event-page membership, scoped to the originating query/generation and requested IDs. Return explicit patches alongside unchanged paged-event behavior; apply them to already loaded events without moving the event cursor, appending duplicate events or replacing untargeted provenance with unknown state. Support terminal event pages: the controller currently prevents another `loadNextPage` when `isComplete`, so enrichment needs its own callable read action and ownership/retry semantics. Distinguish transient budget deferral from permanent oversized-content blocking so users are not offered an endless retry for a payload still over the absolute cap.

These are unfinished parts of the existing pending-resolution/controller assignment, not a new roadmap feature.

## C2-R8 mechanical completion — priority rank must belong to the key domain

Due cursor `lp` is checked only for integer type. The candidate SQL maps priorities to **0 or 1**. An owned token with `lp: 2` is accepted before SQL and can skip all remaining candidates. Reject ranks outside `{0,1}` with `INVALID_CURSOR` before SQL. New case 4 reproduces it. Complete the already requested canonical input/context/filter validation while preserving passing token/page-size behavior.

## Delivery requirements

Align the scope/conditional prompt with executed work accounting, issue publication, real inspection routes, target-only enrichment and its controller action. Correct the SQL-count and suite-description claims against raw receipts. Preserve all verified fixes and evidence. The [active next prompt](M2_CARD_REVIEW_C2_STATE_PUBLICATION_PROMPT_2026-10-07.md) supplies concrete implementation guidance and the **74-case** final frozen gate. No production, migration, installed, signing or release work is activated.
