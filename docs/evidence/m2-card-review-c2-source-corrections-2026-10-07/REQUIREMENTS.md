# C2SRC-R1/R2 requirement-to-test map

Permanent tests:
- **UI**: `src/pages/StudyLibrary/StudyLibraryReviews.test.ts`. Real router, `AppDataProvider`, `MaterialDetail` and a disposable node:sqlite database, through the production save paths.
- **AppData**: `src/state/appDataRevision.test.ts` (new).
- **Frozen**: the reviewer's `C2SourceReviewDiagnostic.test.ts`, run verbatim (SHA-256 `53a91a43…646d5c`) and then removed.
- **Revert**: `run_reverts.py`. Each fix is reverted alone in an isolated scratch copy, then restored and SHA-checked.

| Requirement | Tests | Fails when the fix is reverted |
| --- | --- | --- |
| R1: a same-count, same-timestamp replacement through `AppData.mutate` / `saveAiStudySet` invalidates Review due | UI `a same-count, same-timestamp replacement reaches Review due, History and the binder` (asserts the stored timestamp and count are unchanged); frozen `[C2SRC-R1 due]` | V1 |
| R1: the same replacement makes History show the earlier version | UI same case (History tab); frozen `[C2SRC-R1 history]` | V1 |
| R1: binder badges loaded while the Library is open are dropped and re-read | UI `the binder drops its loaded badges when a replacement is published while it is open` | V1 |
| R1: a state-only review saved through the app is reflected, with the clock unchanged | UI `a review saved through the app (state only, cards unchanged) is reflected without a clock change` | V1 |
| R1: a restore-like replacement that keeps every saved timestamp and count is picked up on the app's refresh | UI `a restore-like replacement that keeps every saved timestamp is picked up on the app's refresh` | V1 |
| R1: a held read from before the publication cannot republish old counts or clear the newer read's ownership; no third read | UI `a held read from before the publication can neither show old counts nor take the newer read's place` | V1 |
| R1: the revision advances only with the winning snapshot, and an obsolete load cannot roll data or revision back | AppData `advances once per published snapshot, including a completed mutation`, `an obsolete refresh that finishes last neither publishes its data nor advances the revision` | V3 |
| R1: existing generation and operation ownership is unchanged and reused | `deferredReviewRead.test.ts` (10 cases, unchanged) | — |
| R2: a viewer opened during Check versions shows the finished result | UI `a viewer opened during Check versions shows the finished result and keeps the card exactly as reviewed` (resolves to "Earlier version"); frozen `[C2SRC-R2]` | V2 (frozen case fails at its reconciliation assertion, line 191) |
| R2: the question and answer stay exactly as reviewed, and current card text never replaces them | UI same case: `A question 0` / `A answer 0` remain, no `Rewritten` text | — |
| R2: the viewer closes when its row leaves the list; an obsolete check and the newer page cannot reopen it | UI `the viewer closes when its row leaves the list, and neither the obsolete check nor the new page reopens it` | V1 and V2 |
| R2: only visible, enabled controls are clicked; the viewer stays read-only | Both R2 cases click **Check versions** and **View card** before the modal opens. The existing `lists ratings … read-only historical card view` case asserts no writes. | — |
