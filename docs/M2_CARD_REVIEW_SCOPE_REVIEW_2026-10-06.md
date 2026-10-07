# M2 card-review scope — independent review, 6 October 2026

**Decision: retain the scheduler/research work; correct two contract groups before scope acceptance and owner production approval.** The submitted proof passes all 27 cases independently, but five new targeted cases expose missing queue and reset behavior. These are defects in the proposed contracts and disposable model, not bugs demonstrated in the shipped application. No production card-review source or dependency is adopted.

The proposal is published for review as [scope](M2_CARD_REVIEW_SCOPE_2026-10-06.md) and [conditional C1 prompt](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md). The **only active next assignment** is [focused scope/proof corrections](M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md). C1 remains inactive until a corrected scope passes independent review and the owner approves its defaults.

## Verified work and identity

Submitted checkout: `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-card-review-scope`, base/main `df7a130f595abda787b4377850ab7095bde33824`. All **four proposal/status hashes** and all **16 evidence checksums** match. Production source, migrations, dependency/configuration files and lockfiles are unchanged. The owner's checkout and earlier stashes are left untouched.

Independent rerun: `node --test --test-reporter=spec proof.test.mjs`, **27 passed / 0 failed**, exit 0. Keep the deterministic simple-v1 arithmetic, injected-time scheduler proof, identity vectors and the explicitly simulated persistence claims. No whole-app matrix is necessary for this planning review.

The pinned `ts-fsrs` 5.4.2 research package matches the official npm tarball SHA-512, is MIT licensed and declares no dependencies. The upstream [release](https://github.com/open-spaced-repetition/ts-fsrs/releases/tag/v5.4.2) and [license](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/LICENSE) support the package identification and notice requirement. Independent package proof reproduces the behavior tests, including the configured interval ceiling overrun. Provenance signatures and installed WebKit behavior remain unverified, as disclosed. Staying with the roadmap's simple scheduler for now is a coherent proposal; this does not adopt FSRS or prove that FSRS requires personal optimization before it can be useful.

## CRS-R1 — due queue contradicts exact-time and current-content requirements

**Locations:** `M2_CARD_REVIEW_SCOPE_2026-10-06.md:153`; `M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md`, repository `getDueQueue(materialId, endOfLocalDayIso, limits)` contract. The pure `isDue` behavior is correct; the specified repository query is not equivalent.

1. Rate Again at 15:00Z, giving due_at 15:10Z. At 15:09Z the pure function correctly returns false. The documented query compares **every** due_at against the end of the local day, so it returns the Again card early. A caller passing only end-of-day has no current-instant argument to fix this faithfully.
2. Retain a due state for old version A and a due state for current version B under the same material. The documented query filters only source_material_id, suspension/flag and time; it returns **both versions**. Even adding is_active alone is insufficient before B's first mutation: the lazy-materialized active row can still belong to A while the saved raw cards already contain B.

**Required correction:** bind queue reads to the current content-derived version, including before materialization. Distinguish Again's exact-time bound from day-ladder's local-day bound, with injected now and a precisely defined exclusive next-local-midnight boundary. Filter before ordering/limiting, including new-card eligibility. Keep recent history intentionally able to display retained old versions. Correct schema/query/API/prompt consistently and prove the actual query boundary, not only isDue.

**Independent receipt:** two failing in-memory SQLite cases execute the query specified in the scope. No native/application query has yet been implemented; the minimal fixture demonstrates the planning error directly.

## CRS-R2 — reset lacks a durable barrier and repeated erasure is broken

**Locations:** `proof/contractModel.mjs:69–71,98–105`; scope reset/recovery contract at `M2_CARD_REVIEW_SCOPE_2026-10-06.md:160–193`.

1. Prepare a rating with expectedRevision 0 but do not apply it. Reset the material, then deliver that request. There is no receipt to tombstone, and the erased projection again defaults to revision 0, so the old request is accepted. Tombstones protect committed operations only.
2. Rate once at revision 0, prepare another request expecting revision 1, reset, then make one legitimate new rating. Revision 1 exists again, so the pre-reset request is now accepted as current. Restarting revision numbers creates an identity collision across reset lifetimes.
3. Rate and erase; erase again. The model dereferences `receipt.result.itemId` after the first erase set result to null. It throws `Cannot read properties of null (reading 'itemId')`.

**Required correction:** add a persistent non-content material reset generation (or an equally precise monotonic design). Every newly intended rate/suspend/resume/flag/unflag/reset request captures the expected generation. Reset advances it atomically with erasure/tombstoning and its own receipt; revision reuse within a new generation must never validate old requests. Preserve exact same-ID replay, conflicts, repeated resets and new legitimate work. Receipt metadata must identify its material/generation independently of nullable result content. UI-only cancellation is not a persistence barrier.

Also complete the reset action as a distinct contract branch: its submitted payload has no versionContentHash/itemId, yet the generic transaction steps require both. Specify reset's own validation, replay, epoch change, pruning and result fields. The per-material **Reset card reviews** button/confirmation is recommended in C-D4 but missing from the C1 UI checklist; wire it into the corrected prompt.

**Independent receipt:** three failing cases against the submitted pure model. They establish model/contract flaws, not native durability or an installed erasure breach. The corrected model must include the barrier; later production C1 must prove it with real browser/native transactions.

## Targeted engineering clarifications for the corrected handoff

Keep owner choices C-D1–C-D8 and avoid expanding the roadmap. Make their implementation precise:

- First suspend/flag must work before any rating. Reconcile "snapshot on first rating" with transaction materialization on all item actions; use an honest creation timestamp and nullable first-reviewed timestamp if needed. A never-rated paused card stays new and has no fake event.
- Distinguish confirmed current state from historical replay receipts. If an acknowledged write/replay is followed by failed refresh, show the confirmed acknowledgement but keep conflicting editing/advancement disabled until authoritative refresh succeeds. Retry refresh sends reads only.
- Bind due summaries/session membership and flag/suspend operations to the current derived version; retained old events belong only in history. Define the 10-new/20-total limits and deterministic ordering after exclusion, and prevent replay from counting a second session advancement.
- Extend future startup/archive validation to reset-generation and item/version/material ownership and typed replay results. Immutable events and the current projection must agree; merely well-formed JSON is insufficient.

These are engineering details needed to honor the existing proposal, not new product approvals or a request to implement migration 12 during preparation.

## Evidence and next action

[Review evidence](evidence/m2-card-review-scope-review-2026-10-06/README.md) contains raw 27-pass proof, five-failure diagnostics, portable frozen submitted-model reproduction, registry/license verification, untouched proposal/proof snapshots and separate checksum roots. Frozen diagnostic SQL intentionally reproduces the bad submitted query; it is a baseline, not an unchanged pass-after gate. Promote its behaviors against the corrected query/model.

Execute the [single focused correction assignment](M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md). No full app regression, production change, package adoption, account/profile test, provider call, signing or release is assigned. PR2 remains accepted; owner check-in waiver persists. After corrections pass review, present the final eight defaults together for one production-scope approval.
