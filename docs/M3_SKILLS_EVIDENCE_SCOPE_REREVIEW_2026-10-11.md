# M3 scope corrections — independent re-review, 11 October 2026

**Decision: CORRECTIONS REQUIRED, limited to M3-R8–R10.** Substantial earlier corrections are verified; preserve them. No production M3 approval or owner-default approval is granted by publishing this report. [One remaining-corrections assignment](M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md).

## Identity and independent proof

Reviewed `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, HEAD `48fa47d9d035b2636b72fd6692930d85f4992bb9`, with correction submission based on the published review `db668ddfe7fb927c5e7a681c93e69e9c95e49646`. The subject and primary Mac preflight work were not edited.

- Corrections evidence: **64/64** checksums verify; current scope pack: **56/56** verify; **6/6** document hashes and **30/30** production anchors verify. Candidate 0014 remains unchanged and unregistered.
- Froze all **127 correction-submission paths** before checking, then reproduced on a disposable base archive with the submitted overlays and matching installed dependencies. [Frozen manifest and receipts](evidence/m3-skills-evidence-scope-rereview-2026-10-11/README.md).
- The published tracking files prepend this review; original submitted tracking bytes are preserved under `submitted-documents/`. The other 124 paths remain the reviewed submission. Original receipts and the earlier frozen diagnostic files remain unchanged.

| Independently run | Result | Exit |
| --- | --- | --- |
| Submitted corrected Vitest suite | 162 passed / 2 opt-in skipped | 0 |
| Corrected strict prototype typecheck | clean | 0 |
| Corrected native crate | 7 passed | 0 |
| Original frozen TS/UI diagnostics | 18 passed / 3 failed | 1 |
| Original frozen native diagnostics | 5 passed | 0 |
| Setup-corrected R2a on original frozen source | resurrection assertion fails | 1 |
| Setup-corrected R2a on corrected source | 1 passed / 18 filtered cases skipped | 0 |
| New TS/UI diagnostics, R8–R10 | **6 failed / 1 temporary-outage control passed** | 1 |
| New native diagnostics, R9 | **1 failed / 1 valid-populated control passed** | 101 |

Original diagnostics' three failures are **not** three unresolved original behaviors: R4 ×2 use the deliberately superseded unpaged API, and R2a contains the reviewer's invalid erase setup. The corrected 162-case suite includes paged earliest-revision reachability. Reversions, expanded fixture-generation checks and benchmarks were reviewed as implementer receipts, not independently rerun. No whole unchanged app matrix, physical installed tests, provider calls or builds were performed.

## Correction to the prior review's diagnostic

The reviewer incorrectly used `expectedRevision: 1` in R2a's erase request. That action requires `confirm: "erase"`. The strict submitted decoder rejected the request before the resurrection check. The implementer was right to flag this; the prior claim that that exact case proved resurrection is withdrawn.

Independently comparing the derived diagnostic confirms one executable argument change, plus an explanatory comment. With the valid argument it reproduces resurrection on the original source and passes on the corrected source. Both receipts are retained, as are the original invalid diagnostic and its historical output. The new history API is also an intentional, justified correction, not a reason to reinstate the old 100-revision lifetime visibility cap.

## Verified progress on R1–R7

Acknowledged-save identity, separate skill saving locks, failed-refresh recovery and stale-page lock release pass the focused suite and earlier diagnostics. Authoritative pending-write replay and erased-save handling pass; different **wording** is preserved. StrictMode setup/cleanup works. Paged history reaches the earliest revision. Exact receipt result shapes and forward receipt-to-history ownership checks pass across the validators. Catalog wording/name invariants and filter-bound stale-date cursors pass their expanded cases. Native writers/readers are still specified, not built; jsdom is still the UI proof boundary.

Three narrower defects remain in the corrected contracts:

## M3-R8 — Form compares only wording when deciding to discard a draft (P1)

**Source:** `docs/evidence/m3-skills-evidence-scope-2026-10-10/prototype/SkillEvidenceSpecimen.tsx:205–208`, `:225–226`, `:294–300`.

The controller fingerprints the entire draft, but `ObservationForm` captures and compares only the wording string. In three rendered diagnostics, hold a save, leave the words unchanged, then change respectively the observed date, attribution, or instructor name before acknowledgment. The original request lands with its original metadata; the UI clears the wording and resets the draft identity as though the current complete draft had saved. The changed date/attribution/name never reaches storage, and no follow-up lets her apply it to the saved record. Instructor attribution is especially significant: the screen may present the original instructor attribution while her later self-report choice was discarded as an edit.

**Fix:** capture the canonical fingerprint of the entire submitted ObservationDraft, and compare it to the full live draft before clearing or resetting. Track wording, date, attribution, instructor name and bound skill/debrief identity together. Use the same rule in create, replace-saved and save-as-new callbacks. Preserve all changed fields and the acknowledged record identity, then offer accurate explicit follow-up to edit that record or save a genuinely new observation. Guard old-form callbacks from resetting a newer draft. Avoid a delayed-ref publication race; callback ownership and live draft comparison must be reliable even when fields change immediately before completion. Do not disable legitimate editing while saving as a substitute for correct ownership. Permanent tests must assert both stored metadata and retained live form fields, with unchanged-draft and changed-wording controls.

## M3-R9 — Restore checks receipt → history but omits history → receipt (P1)

**Source:** `docs/evidence/m3-skills-evidence-scope-2026-10-10/prototype/skillEvidenceValidation.ts:235–275`; native twin `native/src/lib.rs:587` onward.

Create a valid observation through the real writer, validate successfully, then delete just its create receipt. The observation and revision still refer to the deleted operation. Both TS engines accept the database because validation iterates existing receipts only. The native diagnostic starts from the valid populated shared baseline, removes its create receipt and likewise remains accepted. Missing receipts are invisible to the loop. A restored database can therefore lose its idempotency/reconciliation record while keeping state claimed to be operation-owned; request replay and change-fence assumptions no longer describe the accepted state.

**Fix:** check both directions. Every user catalog revision, observation revision and assessment must have its matching live action/result/subject/history receipt, and an operation must own only its permitted change. Allow the catalog's legitimate initial seeded revisions with null operation ids; honor erased observations whose content histories were removed and whose receipts are tombstones. Reject missing receipts, wrongly reused operation ids and mismatched owner/action/subject/index consistently in TS and native. Keep valid earlier results after later revisions. Some existing fixtures label incomplete hand-written history as a valid control: add the matching receipt to those fixtures rather than weakening the invariant or suppressing the refusal. Maintain shared generator and expected outcomes on all three engines. This is a remaining part of the existing R5 ownership requirement, not a new retention default.

## M3-R10 — Confirmed erasure leaves already-loaded wording visible (P2)

**Source:** `docs/evidence/m3-skills-evidence-scope-2026-10-10/prototype/evidenceController.ts:505–518`; analogous selected-record cleanup in `openHistory`.

Load the newest revision with an older-page cursor, erase that observation through the real writer, then request older versions. The reader correctly returns ERASED. The controller shows “This observation was erased” but spreads the old history state, retaining its loaded wording and old cursor. The normal evidence list also retains the erased observation's wording. The specimen continues rendering those cached records after it has authoritative erasure knowledge.

**Fix:** when ERASED is confirmed, clear that observation's cached revision items, current revision and next cursor, stop/invalidate its requests, and evict it from the visible evidence list. Refresh/invalidate its summary through reads only; late replies must not restore the erased content. Apply this to opening and paging history and other confirmed-erased recovery paths. Keep a useful erased notice. Do not clear unrelated observations or treat a temporary read outage as erasure: the new positive control proves ordinary outages must preserve safe loaded pages/cursors for retry. Add a rendered UI erasure case and held-late-page case in addition to the controller regression. A full browser reload or closing the panel is not the recovery contract.

## Delivery boundary

Correct these three groups together, preserving verified R1–R7 work and its evidence. M3-D1–D9 remain **PROPOSED**, and the production assignment remains conditional/inactive. Publishing this correction submission and independent review is documentation/evidence integration, not accepted product behavior.

G1–G3 remain **DEFERRED / UNEXECUTED / UNVERIFIED**; post-receipt recovery remains **BLOCKED / source-covered**. The dirty implementation worktree and the primary clone's separate Mac preflight package remain untouched. Leave the next correction submission uncommitted/unpushed for senior re-review.
