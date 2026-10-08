# M2 Card Reviews C2 — State-publication independent re-review (7 October 2026)

**Previous six demonstrated failures fixed; three narrow enrichment/controller groups remain.** Preserve all 74 passing frozen cases and the 57-case proof. Complete [one model-neutral enrichment correction assignment](M2_CARD_REVIEW_C2_ENRICHMENT_CORRECTIONS_PROMPT_2026-10-07.md). C2 scope is not accepted; C2-D1–D9 remain proposed. Prior C1 acceptance and owner decisions persist.

Reviewed dirty `codex/m2-card-review-c2-scope` at `9028675475616ce338253ae7e4e46ba6b840b72c` in an isolated reviewer worktree based on main `c3f8c576a3f1ee6036aa099b7d27c9015f6d9e5e`. All **39 submitted source hashes** and **35 evidence checksums** verify. All eight submitted packs and the implementation clone are preserved. [Frozen snapshot, diagnostic and receipts](evidence/m2-card-review-c2-publication-rereview-2026-10-07/README.md).

## Verified progress

- Seven original frozen diagnostic files: **74/74**, exit 0, unchanged.
- Submitted proof: **57/57**, 14 suites, exit 0. Mutation baseline/four assertion-killed mutants and assertion-disabled survival control work.
- Due initial/pending loops now charge failed parse reservations; valid sets reconcile to actual card count. Oversize metadata does not consume the small-budget single-set exception.
- Controller retains due issues and summary, clears them on invalidation, and distinguishes warning-only exhaustion from caught-up results.
- Ordinary `/study/a` links and due priority domain `{0,1}` pass. Canonical due query clocks and supported filters are checked.
- Independent history target selection resolves prior-page material identity; target-only patches preserve untargeted fields in the demonstrated case. Resolved currentVersionId patches correctly distinguish older and current event versions while preserving cursor/order (new control passes).
- Independent executed audit: due first/continuation/`due_today` **175/150/177** calls; history first/continuation/topic-filter **22/22/22**, exit 0. The handoff/README's `new_only` label for the 177-call receipt is wrong; actual audit uses `due_today`.
- New frozen diagnostic: **one control pass / nine assertion failures**, exit 1. These are proof-contract failures, not evidence that production C2 exists or the installed application was tested. No unchanged full app/native/Xcode gate was run.

## C2-E1 — Enrichment is not yet a bounded, context-owned, independent read

Source: submitted `proof/contractModel.mjs` lines 926–1049 (event query and target normalization), 1049–1199 (target/page content reads), 1494–1500 (controller request).

1. **Filter bypass (case 1):** query `materialId: 'a', topic: 'one', enrichMaterialIds: ['b']`, where b belongs to topic two, still reads b and emits its current identity. The direct target header SQL only uses `m.id = ?`; material/topic ownership predicates are absent. Restrict target selection to the active query context before raw fetch. Out-of-context targets cannot resolve content or patch unrelated loaded rows.
2. **Unbounded target count (case 2):** 251 distinct IDs are accepted; the loop can do arbitrary per-ID work and return arbitrary patches. Reject more than 250 distinct targets before any SQL and validate malformed target/context inputs rather than silently filtering them. Controller default pending selection can span more than 250 loaded rows; batch it fairly without dropping the rest.
3. **Work budget ignored in history targets (case 3):** three 500-object malformed arrays under `maxBatchCardsBudget: 500` cause **three raw reads**. The due reservation fix was not reused in history. Apply one shared card-work/raw-byte ledger across targeted and normal page enrichment, including failed attempts. Preserve unread targets as pending and implement terminating retry progress. Metadata-only missing/oversize entries do not spend the one raw-admission exception.
4. **Enrichment-only still pages events (case 4):** controller passes `limit: 0`, but the history reader clamps it to one. A target-only request issues an event query and may fetch unrelated page content that the controller discards. Introduce an explicit owned enrichment-only read mode (or a dedicated bounded reader); do not encode it as an invalid page size. No event page query/raw content and no cursor change in that mode. Normal combined page-plus-target requests remain supported.

These are unfinished requirements of the previous bounded target-selection assignment, not new product defaults.

## C2-E2 — Publish a complete status/action patch, preserving unknown identity

Source: `_applyEnrichment` lines 1320–1345; issue/enrichment link templates at 528, 768, 1075–1081; result/typed contracts in the delivery documents.

- **Unknown becomes earlier=true (case 5):** pending patch with `currentVersionId: null` sets `isEarlierVersion` to true. Raw identity was never obtained; preserve null for budget-deferred/oversized unknown provenance. Use a status-aware publication path and compare event.versionId only when a current identity exists.
- **Resolved state retains old blocking reason (case 6):** a successfully resolved current patch without a reason leaves `blockedReason: 'budget_exceeded'` on the loaded row. A resolved status must clear obsolete reason/action fields rather than depend on every reader explicitly emitting a reason property.
- **Blocked action lost (case 7):** reader patch contains `inspectionTarget: '/study/a'`, but the controller never copies it. Publish the blocked reason and actual inspection action together. Keep permanently oversized content excluded from automatic pending Retry. Preserve the known older/current event control.
- **Route segment is not encoded (case 9):** a supported bounded string ID `a/b` produces `/study/a/b`, not `/study/a%2Fb`. The README claims encodeURIComponent is used; source templates interpolate directly. Use one encoded existing Study-route helper for due issues and history blocked actions. This corrects the earlier safe-encoding requirement, without adding a production route.

Delivery types are also incomplete: `LibraryReviewDueResult` omits top-level issues emitted by the reader; `LibraryRecentReviewEntry` omits currentVersionId/blockedReason/action; enrichment type requires fields absent in records and an array even when execution returns null. Make those contracts match executed results. Scope calls oversize unavailable while proof uses pending+oversize; explicitly align the blocked-versus-retryable rule. Do not claim a whole-library cumulative controller summary when implementation only stores the latest page summary.

## C2-E3 — Retry selects an old failed operation

Source: `loadNextPage` error/success handlers and `retryRead`, lines 1376–1445 and 1570–1581.

**Case 8:** enrichment A fails; page load B then fails; `retryRead()` sees retained `lastFailedEnrichTargets` from A and resends A instead of B's cursor. Separate mutable failure markers are not reconciled when operation kind changes.

Store one discriminated failed-read descriptor capturing kind, cursor/targets and owned query/options snapshot. Replace it only on a live owned failure, clear it on live success/authoritative invalidation, and have Retry dispatch exactly that descriptor. An obsolete callback cannot overwrite a newer descriptor or clear its lock. Cover both page→enrichment and enrichment→page transitions, success between failures, held stale completions and synchronous reader re-entry.

## Finish with accurate evidence

Preserve the eight submitted packs. Promote the nine new failures; close them with end-to-end reader/controller tests, not only patch-shape assertions. The final frozen gate becomes **84 cases** (74 prior + 10 new). Update all four live delivery documents, exact typed contracts and measured read accounting. Correct the scope's historical C1 PR reference: C1 source was merged in PR #111, not #70. Preserve benchmark limitations and unchanged production/schema. Leave corrections uncommitted for independent review; do not activate C2 or release work.
