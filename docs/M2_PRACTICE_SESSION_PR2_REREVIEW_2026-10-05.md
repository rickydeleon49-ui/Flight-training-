# M2 PR2 correction review — 5 October 2026

**Result: corrections required; application source remains uncommitted and unaccepted.** All ten original review diagnostics now pass. Eight additional behavioral assertions fail across five remaining UI groups (M2UI-R5–R9); M2UI-R10 corrects an invalid full-gate claim. This is one bounded continuation of already-approved PR2, not a new scope or owner approval gate. Preserve the useful fixes and accepted PR1.

## Reviewed identity and verification

Checkout `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, base `61031d4c7143fdf181bba2cc18616c5345521c3e`. All **26 submitted hashes match** before/after diagnostics. Relative to the earlier 23-file reviewed set, only panel/history and STATUS/handoff changed; three additional test files appear in the new manifest. The two additional existing test files were modified, not newly created. Backend/PR1 source in the earlier manifest remains byte-identical. Both dirty clones were preserved.

Independent focused run: **84 passed, 8 failed, zero runtime errors**, exit1. This includes the original ten diagnostics verbatim, their ten permanent copies, and 64 existing UI/offline/contract/startup checks. Separate implicated import test file: **21 passed**, exit0, zero runtime errors. Submitted full frontend log: **2,521 passed,4 skipped, TWO unhandled errors**. Those errors invalidate the claim that the full gate is green. No independent full matrix/native rerun was warranted while UI blockers remain; previous four native erasure passes and unchanged backend source remain useful evidence.

See [frozen diagnostic, logs, source snapshot and submitted receipts](evidence/m2-practice-session-pr2-rereview-2026-10-05/README.md). All tests used disposable synthetic storage; none establishes installed/VoiceOver/release verification.

## What improved

Confirmed behaviors: held response saves no longer reveal feedback early; failed completion no longer falsely declares completion; Continue locks during an in-flight answer; successful read retry clears the refresh error; initial read rejection prevents editing; current frozen questions replace stale props; the original A→B load races are blocked; same-ID erase replay preserves later progress. Preserve all ten passing diagnostics, including the same-ID backend control. The panel prop-change diagnostic remains a supplementary component boundary: production MaterialDetail is already keyed by materialId.

## Remaining findings with exact fixes

Line numbers below refer to the submitted snapshot, not current main.

### M2UI-R5 — P2: loading ends after only half the authoritative read

`PracticeTestPanel.tsx:138–169,641–657`: `loadRepositoryState` installs activeItems before awaiting getCurrentAttempt, but render considers activeItems alone sufficient to leave Loading. With getCurrentAttempt held, answer controls are enabled before resume state is known. A late initial read can also clear pendingAction at line169 while an action is underway.

**Required fix:** track the whole read as a phase; publish the coherent version/items/attempt snapshot only after both reads succeed for the current generation. Keep controls blocked during initial load, Retry load and conflict refresh. Do not let an obsolete load clear a newer mutation. Keep deliberate start/resume from the approved assignment; if no valid active version exists, show a settled unavailable/quarantined state rather than indefinite Loading or an editable legacy fallback.

Proof: `[R5] initial current-attempt read keeps all answer controls blocked` holds getCurrentAttempt after the active version resolves. Actual enabled=true; expected=false. Loading-only presentation is acceptable.

### M2UI-R6 — P1: unresolved writes unlock new mutations and mix draft with confirmed feedback

`PracticeTestPanel.tsx:186–210,296–314,340–355,653–657,867–885`: ordinary failure sets pendingAction.inFlight=false but controls only lock on inFlight. The original pending payload remains, yet the UI permits fresh completion/abandon/navigation actions to replace it. Changing a previously confirmed answer also retains the new selectedDraft while `revealed` becomes true again from the old saved response, so an unsaved incorrect choice can appear selected alongside “Correct” from the previous response.

**Required fix:** distinguish unresolved intent from active network/storage call. One non-null unresolved write locks conflicting actions even between retry attempts; only Retry for that exact typed payload is permitted until resolution. Use a synchronous action lock, not only React state. Render draft and confirmed feedback coherently: pending/failed replacement must not present old correctness as confirmation of the draft. Clear/commit a draft only after the corresponding response is acknowledged and the authoritative read agrees. Remove the null-as-action placeholder; catch preparation reads and the save-chain rejection so failures produce a recoverable visible phase.

Proofs: `[R6] failed changed answer does not mix draft selection with saved correctness` stores choice0, fails change to1, observes draft1 selected + feedback visible while DB still0. `[R6] uncertain completion blocks fresh completion identity` fails completion and clicks the ordinary completion button again: actual enabled=true/calls2; expected disabled/calls1. Explicit Retry must then resend the original operationId and full payload. Both are continuations of earlier R1/R2 requirements, not an accepted new product behavior.

### M2UI-R7 — P2: result view hides failed retake recovery

`PracticeTestPanel.tsx:finished branch beginning593,625 and error rendering691–723`: after confirmed completion, a failed retake leaves completedResult intact, so the early result return hides its error and Retry. Retake re-enables because inFlight=false and another click creates a fresh ID.

**Required fix:** share pending/error/retry presentation between question and result phases. Preserve the old immutable completed result while retake is unresolved; block a new retake and expose exact same-ID Retry. On acknowledgement reconcile the actual current attempt before unlocking. Cover refusal and commit-then-lost-acknowledgement, not just successful retake.

Proof: `[R7] failed retake from result exposes same-ID retry in result view`; actual alert=false/retry=false, expected bothtrue. Existing successful retake test remains green.

### M2UI-R8 — P1: null refresh leaves an obsolete attempt editable

`PracticeTestPanel.tsx:153–167,282–289,324–331`: all three authoritative readers update persistedAttempt only when the result is truthy. A valid null result is ignored and old attempt/ref/feedback survive even though that attempt was closed or erased.

**Required fix:** adopt null explicitly in both state and ref, reset responses/draft/edit/progress/navigation derived from that attempt, and enter a settled no-current-attempt phase. Refresh the active version as needed and distinguish closed/replaced/current state; never unlock a stale receipt snapshot. Centralize this reconciliation rather than patching one reader. Mark refresh complete only after adoption; conflict text must not claim success before the read succeeds.

Proof: `[R8] acknowledged response followed by null refresh clears the old attempt` uses real persistence: response commits, another action abandons that attempt, post-save getCurrentAttempt returnsnull. Actual stale feedback=true and Abandon=true; expected bothfalse. Add the same proof for read-only Retry and conflict refresh.

### M2UI-R9 — P1: destructive callback and submission locks remain unsafe

`PracticeHistory.tsx:215–232`: erasing is React state, not a synchronous lock, and post-await erase callbacks have no route/generation/unmount guard. `ConfirmDialog` footer has no pending prop and its Cancel remains usable. `AttemptReviewPage` resets on historyKey at384–391 but load effect at440–442 depends only on attemptId/repositories.

**Required fix:** retain the working same-ID erase payload in a synchronously acquired ref/controller; two clicks before render must call eraseHistory once. Bind confirmation and pending action to the displayed historyKey and route generation. Old-route acknowledgement/error must not clear the new route's pending state or navigate it. Explicitly bound confirm/cancel/Escape/backdrop behavior while a destructive action is pending; extend the dialog API only as needed and preserve existing fallback behavior. Reload/revalidate attempt review when either historyKey or attemptId changes. Use generation/cancellation rather than key equality alone so returning A→B→A cannot revive an obsolete A request. Preserve operation identity through uncertain retries; changing routes does not make a committed action cancellable.

Three failing proofs:

- `[R9] rapid confirmation uses a synchronous lock and one erase identity`: two DOM clicks within one act/render issue **two** erase requests, expectedone.
- `[R9] an erase acknowledgement from group A cannot navigate away from group B`: hold A erase, Cancel/navigate toB, resolveA; B is replaced by history index. B's data is not claimed erased by this test; stale A acknowledgement wrongly navigates it.
- `[R9] changing only history key revalidates attempt membership`: navigate a completed A attempt from `/history/A/id` to `/history/B/id`; reset clears the view but no new membership read runs. It shows generic Attempt not found, expected group-mismatch refusal.

The original lost-erase-acknowledgement/same-ID test passes. Keep it; this review does not reopen the backend replay primitive.

### M2UI-R10 — P1 validation: submitted full gate and test mapping are inaccurate

`docs/evidence/m2-practice-session-pr2-corrections-2026-10-05/gate/02-npm-test.txt:221–270` explicitly records two unhandled DatabaseDisabledError rejections originating while ImportStudyPacketDialog.test.ts ran, caused by “database is not open” during transaction rollback. The report nevertheless declares npm test exit0/fully green. Attachment commands pipe through tee without demonstrated pipefail, so printed assertion counts/pipeline success are not reliable process-exit proof. The isolated import file passes21/21 independently; the source of the full-run race is not established.

**Required fix:** preserve this failed receipt; investigate any recurring full-run unhandled work/test teardown and get a clean full run after UI corrections. Await actual transactions/background work before closing disposable DBs where proven necessary; do not suppress Vitest errors or change production transaction semantics to hide a test lifetime bug. Record actual command exit before tee masks it. Full npm gate requires exit0 AND zero unhandled errors.

The report also attributes nonexistent permanent cases to PracticeSessionPR2Corrections.test.ts (completed-review membership, noncommitted erase retry and double-click erase). That file contains only the ten promoted original cases. Correct the map with real file/exact case names, or add and run the requested tests. Keep earlier receipts unchanged; record new evidence separately. Native rollback/browser disabled-recovery proofs requested in the earlier assignment were not added by this correction: reuse exact existing proof if applicable, otherwise finish those narrowly requested cases.

## Next action

Use the [specific model-neutral continuation](M2_PRACTICE_SESSION_PR2_FINISH_CORRECTIONS_PROMPT_2026-10-05.md). It consolidates the required work into one controller/history/gate correction. No new roadmap branch, provider, account, packaging or release task. Codex reviews the completed submission and coordinates Git integration only after local source readiness.
