# Finish M2 PR2 corrections — model-neutral implementation prompt

You are the owner-selected implementing model. Complete the already-approved M2 practice-session PR2 in the Mac clone. The latest correction review confirms the ten original diagnostics pass but identifies eight additional failures and an invalid full-gate claim. Fix them as one coherent bounded implementation, preserve passing work, run the necessary gates, and return a concrete handoff. Codex remains final reviewer and Git coordinator. No planning-only reply, new owner check-in or new scope approval is needed.

## Start exactly here

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, base `61031d4c7143fdf181bba2cc18616c5345521c3e`. All app changes are local/uncommitted/unpushed. Do not pull/reset/rebase the dirty checkout, apply a frozen snapshot over it, edit the separate dirty primary clone, or use an archived review worktree.

Fetch/read this prompt and `docs/M2_PRACTICE_SESSION_PR2_REREVIEW_2026-10-05.md` using GitHub or `git show origin/main:<path>`; the clone's checked-out docs may be older. Read the previous corrections assignment and original PR2 assignment for approved requirements, without restarting the PR1 architecture audit. Verify the **26 current submitted hashes** in `docs/evidence/m2-practice-session-pr2-rereview-2026-10-05/source-hashes.json` against this clone. Read this JSON from main: its paths are relative to the implementation repo root. Preserve any unexpected competing changes and report them before overwriting the affected files.

Evidence on main includes the executable `codex-pr2-rereview.test.ts`, final frontend receipt (84pass/8fail,zero runtime errors), isolated import receipt (21pass), original submitted logs, snapshot and source hashes. Tests are disposable synthetic checks, not installed/VoiceOver certification.

## Implementation plan: a small authoritative controller

The current patch handles success but still infers authority from independent booleans. Consolidate panel state transitions in a reducer/controller/hook rather than another set of isolated truthy checks. Keep it local to this feature; do not introduce a dependency or change the database contract. Suggested phases: loading, load_failed, ready/no_current_attempt, in_progress, write_in_flight, write_unknown, acknowledged_refreshing, refresh_failed, completed. Explicit typed unions may combine phases where equivalent. The required behavior matters more than these names.

State must contain the current material/request generation, authoritative frozen version/items, the nullable current attempt, an optional immutable completed result, index/focus, separate draft selection, and exactly one pending typed mutation intent. Keep request generation and mutation lock synchronous where events require it; UI state alone cannot prevent two clicks in one render. Remove `payload: null as unknown as PracticeSessionAction`.

### 1. R5: complete reads before editing

In `PracticeTestPanel.loadRepositoryState`, do not install activeItems and exit Loading before getCurrentAttempt has resolved. Collect both results, validate the current request generation/material, then adopt one coherent snapshot. Track loading for Retry and conflict refresh as well as initial mount. An obsolete read cannot clear a newer pending mutation. While reads are pending, hide or disable all edit/navigation/destructive controls.

When active version is absent or quarantined, finish with useful non-editable unavailable messaging instead of indefinite Loading or a legacy editable fallback. Production practice must use persisted frozen content. Preserve offline access. Restore the approved deliberate start/resume transition: the real attempt/version must be acknowledged before answer editing. If retaining an answer-before-start draft internally, it cannot become saved feedback or be silently lost when a start retry succeeds.

Promote the R5 held-read diagnostic. It accepts Loading-only UI or disabled questions. Also test Retry load held/rejected and a stale initial read attempting to overwrite a newer phase.

### 2. R6: unresolved write identity locks every conflicting action

Change `isControlsDisabled` and handlers so a pending unresolved intent remains locked when inFlight becomes false after failure. Ordinary Complete/See score/Continue/Skip/pills/Change answer/answer/don't-know/Abandon/Retake cannot allocate a new mutation or replace the pending payload. Only deliberate Retry sends the exact same action type, operationId, revision, attempt/version/item identity and selection. Acquire a synchronous lock before enqueuing work; release it only according to a settled phase, not automatically in a finally after uncertain failure.

Keep draft selection separate from persisted response. On a failed replacement, retain a visibly unsaved draft with no confirmed feedback for it, or deliberately revert both selection and feedback to the last acknowledged response. Never combine draft1 with saved correctness0. The supplied diagnostic prefers retaining the draft; if you choose explicit revert, adapt that selection assertion while retaining the coherence and DB assertions, and explain the choice.

Catch failures in preparatory getActiveVersion/getCurrentAttempt calls and the queued promise chain. They must expose a recoverable load/write phase without an unhandled rejection or a permanent null-payload spinner. Retry start must preserve its exact identity and resume the intended user interaction deliberately; response retry must not silently create a different start. Classify known conflicts from typed/sanitized errors, not substring-based authority.

Promote both R6 diagnostics. Extend one representative failed/unknown mutation case to actually click Retry and compare the complete payloads; assert only one receipt/state effect and no fresh ordinary mutation. Test acknowledged-write/read-failure separately: Retry refresh must perform only reads, not resend the write.

### 3. R7: keep retake recovery visible on completed results

Render common pending/error/retry notices before choosing the result/question presentation, or include them in both. After a failed retake, preserve the old immutable completed score, show its recoverable error, disable a fresh retake, and allow exact-ID retry. A result view must never make pending recovery unreachable. Retake success/replay must reconcile the actual current attempt before enabling editing, because receipt snapshots can be historical. Preserve `expectedAttemptId:null` for a completed attempt as accepted by the contract.

Promote the R7 refusal diagnostic and add committed-retake/lost-acknowledgement retry with a real DB outcome. Confirm callbacks/scoring are driven only by acknowledged completion; do not invent a new score or timestamp.

### 4. R8: centralize null/closed/replaced reconciliation

Replace the three `if (attempt)` / `if (freshAttempt)` update paths in initial load, post-save refresh and Retry refresh with one adoption function. A valid null result MUST clear persistedAttempt and persistedAttemptRef, obsolete responses/progress/draft/edit/index state, and stale actions. It is a real authoritative result, not a failed read. Do not leave Abandon/See score referring to an abandoned or erased attempt. A replaced attempt/version must refresh its frozen items before editing.

On conflict, remain blocked until the current read succeeds. Only then announce that state was refreshed; a failed read must retain visible read recovery. Minimal receipts are not full state, and old replay snapshots do not authorize editing without reconciliation. Promote the R8 real persisted abandonment/null-read diagnostic and cover null through Retry refresh too. Preserve working refresh-retry unlocking after a valid current state.

### 5. R9: route generations and a real destructive-action lock

In `HistoryGroupDetailPage.handleEraseHistory`, retain the working same-ID pending erasure payload in a ref/controller and acquire its lock synchronously before the first await. Two `.click()` calls within one render must issue one request. Bind payload and confirmation to the displayed historyKey; never use a new route key to reinterpret an existing confirmation. Keep same-ID replay on unknown outcome even if the first call committed and new progress appeared.

Capture route/request generation and mounted state at action start. After every await, obsolete success/failure must not update the current page, clear its pending state, show another group's error or navigate away from it. A key-only comparison fails A→B→A; use a generation token/cancellation as appropriate. Database work already committed is not rolled back by leaving the view; the UI must not claim cancellation of that work.

Bound destructive dialog controls while pending. The current ConfirmDialog has no pending/disabled API and allows Cancel/Escape/backdrop plus a second confirmation. Add only the small reusable capability needed, preserving existing callers and native/fallback modal behavior. Choose an explicit pending-dismissal policy; whichever policy you implement, old callbacks cannot affect another route. Keep error/retry reachable without creating a new destructive intent after an unknown outcome. If later routes/reloads discard volatile IDs, describe that limitation truthfully and don't pretend IDs persist through restart.

In `AttemptReviewPage`, include BOTH historyKey and attemptId in the load effect dependencies and request identity. Revalidate completed status and version.historyKey before showing review; same attempt/different historyKey must produce group-mismatch refusal, not a generic not-found caused by clearing without reloading. Apply matching cancellation to list/group/review loads; reset obsolete destructive state consistently.

Promote all three R9 cases: same-render double confirm; held A erase followed by B navigation; same attemptId under different historyKey. For pending dismissal policy, adapt only the navigation mechanism in the route test if Cancel legitimately becomes disabled; use router navigation to prove callback isolation anyway. Add A→B→A or unmount coverage at the controller boundary. Preserve the ten original passing diagnostics and keyed MaterialDetail protection. Do not claim the supplemental direct panel rerender proves ordinary production cross-material corruption.

### 6. R10: repair evidence and obtain a genuinely clean gate

The prior submitted npm log contains 2,521 passing assertions plus **two unhandled DatabaseDisabledError rejections** associated with ImportStudyPacketDialog.test.ts, caused by rollback after its disposable DB was closed. The report's exit0/green claim is invalid. A separate 21-test import run passed; the full-run error cause remains unproven. Preserve the original log and correct this in the new report. Do not suppress errors, ignore unhandled rejections, or weaken production DB recovery to manufacture green results.

After focused UI fixes pass, run the ordinary full frontend suite. If the database-lifetime error recurs, locate the unfinished async transaction/background consumer and make test teardown await actual completion before db.close, or fix an actual unhandled application promise if established. Use deterministic synchronization rather than arbitrary delays. Target the implicated tests during investigation; repeat the full suite once after the justified fix. Report nonreproduction honestly if the ordinary full run is clean.

Record real command exit codes: use `set -o pipefail` when piping to tee, or capture the process return code directly and write it to a separate receipt. Full test gate requires exit0, zero failed tests and zero unhandled errors. Printed pass counts alone do not establish success.

Correct closure mappings: the previous report named membership/noncommitted-erase/double-click cases that were absent from its ten-test promoted file. New report must use exact existing file/case names and observed results. Reuse the existing native/backend proof where exact requirements match. Finish previously requested narrow native erasure mid-write rollback and browser disabled-recovery proof if no matching permanent case already exists; cite real cases, not similar PR1 assertions. No PR1 re-audit or speculative matrix.

## Validation and handoff

Promote the eight failing behaviors from the frozen review diagnostic into permanent tests and preserve all original positives. You may adapt helpers/selectors for deliberate Start/Resume, truthful loading and the documented draft/dismissal choices; do not delete the actual invariants. Use real disposable Node/sql.js/native persistence for storage outcomes and deferred promises for event races. Use existing test infrastructure; no provider/network/real-profile work.

When focused checks pass, run one sequential local source gate with scoped Node22/Rust stable/SDK26.5 as documented: typecheck, npm test, build, locked Rust all-target tests, locked Clippy denying warnings, fmt, actual test:cargo-lock, and diff/format checks including intended new files. Verify migrations1–11/checksums remain unchanged. Repeat gates only when new changes or failures justify it; do not push partial work to CI to discover routine local failures.

Create a new dated evidence directory/report; preserve both prior submissions and review receipts. Include actual commands/exits, pass/skip/ignore/unhandled counts, exact finding-to-test map, source manifest rooted at the repo and a separate evidence manifest. Update STATUS/handoff only as corrected pending independent review. Summarize files changed, completed R5–R10 behavior, any remaining blocker, and source hashes. Leave all app changes uncommitted/unpushed. Stop before new roadmap features, Git integration, real-account/app-launch testing, signing, packaging or release. Codex will review once and coordinate the accepted source PR.
