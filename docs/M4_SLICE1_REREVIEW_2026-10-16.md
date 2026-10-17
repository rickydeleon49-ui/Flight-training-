# M4 Slice1 independent re-review — R5–R10

**Disposition: changes required; do not merge PR#189.** Reviewed exact head **6d8c6080426d99e73399eb447412e09426b72bba** against current accepted main **c13889bd4614cf38a6d03482b7f58b46638d343f**. All66 submitted paths are frozen, all45 author source hashes match, and the implementation worktree remains clean/unchanged. Owner approval OD-1–OD-10 persists.

The implementation now contains the full feature and substantial R1–R4 corrections. The stale set_read request and loose native-success adapter have been corrected; old-schema tamper coverage is restored. Real-file checks improve R3, but its cached-count trust gap remains as R10 below. This is a source review, not installed acceptance.

## M4S1-R5 [P1] — saved bookmarks silently retarget replacement content

**Reproduced.** `DocumentPagesPanel.tsx:268` passes only a bookmark's page and label to `openAt`. The bookmark's originating hash is lost. `controller.request` inspects current content B and resolves the old A coordinate against B. Even if inspection marks the old bookmark drifted, the already-dispatched intent opens B and may commit its old page/label as active B state.

Frozen UI diagnostic: `[R5] opening a saved A bookmark must not silently target replacement B`. Actual opener received B. It uses the real MaterialDetail/provider/transaction twin, with the same file inspector/opener stand-ins as the existing UI suite and additional drift reconciliation.

**Fix:** distinguish an explicit current-file page request from opening an existing saved destination. Carry the bookmark's originating identity and full coordinate/label context into the intent; compare it after inspection and at relevant native boundaries. On mismatch, refresh drifted state and explain, with no open or reading-state commit for the stale coordinate. Preserve normal matching-bookmark behavior. Test same-page replacement, changed labels/bounds and held inspection; unknown/null origins remain unresolved. Do not disable all bookmark opening to obtain green.

## M4S1-R6 [P1] — an open bookmark draft silently rebinds after refresh

**Reproduced.** `DocumentPagesPanel.tsx:285–293` passes current identity to the dialog and closes over current identity in onSave. `AddBookmarkDialog` accepts contentSha256 but never captures/uses it. A background refresh to B rerenders the still-open A draft; Save submits B and creates a verified B bookmark instead of rejecting stale A intent. The existing held-bookmark test changes the database without refreshing React state, so it misses this variant.

Frozen diagnostic: `[R6] an open bookmark draft must retain its original content after a background refresh`. Actual stored row has B's hash and the A draft's title/page.

**Fix:** capture the material/hash/count context when the dialog opens and keep it stable for that draft. A later refresh must refuse the old draft, or explicitly close/invalidate it with a clear explanation. Never silently recapture B. Preserve useful typed input and existing R1 native checks; test real parent rerender, material/content changes and normal save.

## M4S1-R7 [P2] — stale reloads overwrite newer material state

**Reproduced.** `useDocumentNavigation.ts:81–88` publishes every read's state/error/loading completion with no request-generation or lifetime gate. Hold read A, complete a newer reload with B, then resolve A: the hook restores A. This is reproducible for the same material; keyed route remounts do not solve it.

Frozen hook diagnostic: `[R7] an older material reload cannot overwrite newer content state`.

**Fix:** monotonic generations and lifetime/material/repository ownership around every reload completion, including error and loading. Protect the checkPages/mutation follow-up reloads as well. Preserve latest-request-wins behavior through StrictMode replay, unmount and material/repository changes; stale success/error/finally must not publish or clear newer state. Add both stale-success and stale-error regressions.

## M4S1-R8 [P2] — retired source-link guidance still launches an old document

**Reproduced.** `useDocumentNavigation.ts:30–32` bundles inspect+open into one port, while `controller.ts:176–184` checks its epoch only after that whole port finishes. Hold guidance A's inspection; finish guidance B; release A. The old request returns null but still opens A after B. Suppressing the final status did not prevent the external side effect.

Frozen diagnostic: `[R8] a superseded guidance inspection must not launch its old document`, through the real `navigationControllerFor` wiring. Actual call order is m2,m1; expected only m2.

**Fix:** put an ownership check between the awaited inspection and native open dispatch on the real wiring. Check source-link unmount/route retirement too. Preserve guidance-only behavior: no reservation, saved position or read confirmation. Test supersession, abort/dispose, failed newer inspection and the actual hook/repository port composition. Do not claim a dispatched OS operation can be undone.

## M4S1-R9 [P2] — exact final-head CI failed

[CI38985040191](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38985040191), head6d8c608, failed npm test: **3,422 passed / 1 failed / 6 skipped**. Failing case: `src/pages/FlightPath/skills/skillScreens.test.ts`, `two quick clicks on Save record one observation`, unable to find the Add an observation dialog. Rust/build/later CI steps were not thereby verified by that run. The local focused file passes in this review; that alone neither proves an unrelated flake nor clears the merge gate.

**Fix:** preserve this failed receipt; investigate the actual dialog/readiness/lifetime sequence using deterministic holds and an appropriate main control if needed. Repair the demonstrated cause or establish a narrowly evidenced pre-existing failure. Keep double-click protection/assertions. No broad retry/timeout/suppression. Whatever the classification, final normal CI must pass on the exact final head; a prior local gate cannot substitute.

## M4S1-R10 [P1] — native bounds check trusts an inflated cached page count

**Reproduced natively.** `navigation.rs::check_current_file` returns Current as soon as the actual hash matches the cached hash, without deriving/verifying total_pages. A real50-page PDF with total_pages changed to500 is accepted by `verify_schema_15_navigation_semantics`, and the actual checked native commit accepts page450. Matching a hash does not validate a corrupt/restored cached count.

Frozen patch test: `reviewer_r10_an_inflated_cached_count_cannot_authorize_a_nonexistent_pdf_page`. Native exit101; committed=true triggered the assertion. This is an actual checked transaction, not just the browser twin.

**Fix:** validate the hash/count pair from authoritative PDF bytes at the native content-sensitive boundary, including the equal-hash/different-count case. Repair/reconcile inconsistent cache metadata coherently and refuse invalid requested pages; do not clamp them or mark impossible positions verified. Cover both inflated and deflated caches, valid unchanged cache, and bookmark/read-confirmation bounds. Do not make browser-only tests claim real PDF validation. No new parser dependency is needed; reuse existing trusted parsing.

## Verification and evidence

- Full unchanged-author Rust suite:512 passed /6 ignored, exit0.
- Nine affected/existing frontend suites, including the CI-failed skill-screen file:183 passed, exit0.
- Typecheck/web build, strict all-target Clippy, fmt and submitted hygiene:exit0.
- Frozen schema14 helper:26 passed; existing current helper checksum manifest:21/21 match.
- New TypeScript diagnostics:9 copied existing controls passed /4 new regressions failed, exit1.
- New native count diagnostic:1 failed, exit101.
- Exact-head CI:failure preserved above; no full frontend pass independently claimed by this review.

[Evidence and reproduction instructions](evidence/m4-slice1-r5-r10-review-2026-10-16/README.md). Author checkpoints/receipts are preserved; reviewer diagnostics were confined to an isolated source checkout and removed after freezing. No app/profile/provider/installer/signing/release operation occurred. Original migrations1–14 and checksum entries remain unchanged.

The next task is one coherent [R5–R10 correction assignment](M4_SLICE1_R5_R10_CORRECTIONS_PROMPT_2026-10-16.md), not a feature restart. Also correct the completion report's statement that a replacement restored between two reads is necessarily detected: an unobserved same-bytes ABA interval is not detectable by those hashes. Keep native cancellation linearization and external-reader limitations explicit.
