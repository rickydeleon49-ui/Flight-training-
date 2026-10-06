# M2 Practice Session PR2 — finish corrections implementation report

**Date:** 5 October 2026
**Clone:** `/Users/rickymac/code/Flight-training-pr70-integration`
**Branch:** `codex/m2-practice-session-ui`
**Base:** `61031d4c7143fdf181bba2cc18616c5345521c3e`
**Assignment:** `docs/M2_PRACTICE_SESSION_PR2_FINISH_CORRECTIONS_PROMPT_2026-10-05.md`
**Review closed:** `docs/M2_PRACTICE_SESSION_PR2_REREVIEW_2026-10-05.md` (M2UI-R5–R10)
**State:** all application changes **uncommitted and unpushed**, ready for independent review.

---

## 1. Result

| Group | Required behavior | Status |
| --- | --- | :---: |
| M2UI-R5 | Complete reads before editing; settled unavailable state; deliberate start acknowledgement | Implemented |
| M2UI-R6 | One unresolved write identity locks every conflicting action; coherent draft vs saved feedback | Implemented |
| M2UI-R7 | Pending/error/retry reachable from the result view; retake reconciled before unlocking | Implemented |
| M2UI-R8 | One central null/closed/replaced adoption path | Implemented |
| M2UI-R9 | Route generations, synchronous destructive lock, bounded pending dialog | Implemented |
| M2UI-R10 | Invalid full-gate claim repaired; honest exit capture; corrected closure map; missing proofs added | Implemented |

Verification actually observed in this checkout:

- Reviewer's frozen diagnostic run **verbatim** before changes: `84 passed, 8 failed`, exit 1 — matching the review receipt.
- Same frozen diagnostic re-run **verbatim against the final source** after every change in this submission: **`92 passed, 0 failed`**, exit 0, zero runtime/unhandled errors (`diagnostics/frozen-rereview-verbatim.txt`); the temporary copy was deleted again afterwards.
- Same set plus the two new permanent suites (`PracticeSessionPR2Finish.test.ts`, 23 cases; `practiceEraseDurability.test.ts`, 1 case): **`116 passed, 0 failed`**, exit 0 (`diagnostics/finish-suite-with-frozen.txt`).
- Final sequential source gate: **9/9 steps exit 0**, and one extra full-suite repeat for stability (§7).

---

## 2. Starting state, verification and preservation

- The **26 submitted hashes** in `docs/evidence/m2-practice-session-pr2-rereview-2026-10-05/source-hashes.json` (read from `origin/main`) were re-hashed against this clone before any edit: **26/26 matched, 0 missing**. The checkout therefore was exactly the reviewed state, with no unexpected competing changes to report.
- Read-only inputs used: the finish prompt, the rereview, `submitted-new-source/` snapshot, `results.json` and `frontend.txt` — all through `git show origin/main:<path>`, never applied over the working tree.
- No `pull`, `reset`, `rebase`, branch switch or snapshot apply was performed. The separate dirty primary clone (`/Users/rickymac/code/Flight-training-`) was not opened for writing, and no archived review worktree was used.
- Passing work was preserved rather than restarted: the ten accepted diagnostics, the accepted PR1 persistence layer, migrations 1–11 and their checksum registry (gate 09 proves byte-identity), the backend erasure primitive and replay control, and the keyed `MaterialDetail` guard.
- `docs/evidence/m2-practice-session-pr2-corrections-2026-10-05/` and `docs/evidence/m2-practice-session-pr2-ui-2026-10-05/` are preserved unchanged, including the failed full-test receipt that R10 requires to stay visible.

---

## 3. Implementation: one authoritative controller per feature

### 3.1 `src/pages/StudyLibrary/PracticeTestPanel.tsx` — reducer-owned phases

Panel state is now a single `useReducer` state whose `phase` is the only authority over what is editable:

`loading → load_failed | unavailable | ready ⇄ write_in_flight → write_unknown | refresh_in_flight → refresh_failed | completed`

- **Generation as the publish gate.** Every action carries the request generation; the reducer drops anything that does not match the current generation, and `load_started` (which owns a new generation) may never clear a held `intent`. An obsolete read therefore cannot unlock, reset or overwrite a newer phase.
- **Synchronous locks, not inferred booleans.** `busyRef` is set before the first `await` of an operation and `intentRef` holds the single unresolved `SessionIntent`. React state cannot be read inside the same render, so two events in one render are gated by these refs. Every ordinary action (answer, don't-know, Continue, Skip, pills, Change answer, Complete, Abandon, Retake) returns early while `busyRef` is set or `intentRef.current !== null`.
- **One intent, exact identity.** `payload: null as unknown as PracticeSessionAction` is gone. Each intent carries one typed payload allocated once; `Retry` resends that identical object and cannot allocate a new one. A start that is refused keeps its own `start_or_resume` identity, and the answer held against it is applied afterwards with its own pre-allocated `record_response` identity — so a successful start retry neither loses the intended answer nor invents a different one.
- **Single adoption transition.** `adoptAttempt(attempt | null, generation)` is used by the initial snapshot, the post-write refresh, the retry-refresh, the retake reconciliation and the conflict reconcile. A valid `null` clears `attempt`, derived responses, `draft`, `changingAnswer` and `index`, and enters a settled `ready` with no current attempt. A replaced attempt refreshes its own frozen version/items before editing (`getVersion` + `getItems`).
- **Shared notices.** Pending/unknown/write-error/refresh-error presentation is computed once and rendered above **both** the question view and the result view, so a completed result can never hide an unresolved retake.
- **No legacy editable fallback.** `questions` come only from frozen repository items. An absent active version settles to a non-editable "No saved practice test is available…" state; a failed read settles to `load_failed` with a working `Retry`.

### 3.2 `src/pages/StudyLibrary/PracticeHistory.tsx` — route generations and a real destructive lock

- `useRouteGeneration(key)` bumps a monotonic generation on every displayed-identity change **and** on unmount. Because the token is a counter, not a key comparison, an A→B→A round trip cannot revive an obsolete request.
- All three pages (groups list, group detail, attempt review) stamp work with a generation and check it after **every** await, including the `finally` that ends loading. An obsolete success or failure cannot set rows, title, error, pending state or navigate.
- Erasure state: `eraseRef = { historyKey, action, busy }` — the pending `EraseHistoryAction` payload lives in a ref and is acquired synchronously before the first `await`, so two `.click()` calls inside one render issue exactly one request and one identity. The lock is scoped to the displayed `historyKey`: another group's erasure is a different intent and is never reinterpreted as this one, and an unresolved erasure replays its original `operationId`.
- `AttemptReviewPage` now depends on **both** `historyKey` and `attemptId`; a same-attempt/different-group navigation performs a fresh membership read and yields the group-mismatch refusal rather than a generic not-found.

### 3.3 `src/components/ui/Dialog.tsx` — the smallest reusable pending capability

`ConfirmDialog` gained optional `pending` / `pendingLabel`. While pending, the dialog passes `dismissible={false}` (so Escape, the backdrop and the close icon cannot request a close) and disables both footer buttons, with a `role="status"` line explaining that it stays open until the outcome is known. Defaults are unchanged, so the 18 existing `ConfirmDialog` call sites and both the native `<dialog>` and the WebKit fallback paths behave exactly as before.

---

## 4. Finding-by-finding closure (exact existing case names)

All promoted permanent cases are in **`src/pages/StudyLibrary/PracticeSessionPR2Finish.test.ts`** (23 cases — the eight promoted behaviors plus fifteen extensions — on real disposable Node SQLite with deferred promises). The ten accepted positives remain in `src/pages/StudyLibrary/PracticeSessionPR2Corrections.test.ts`.

### M2UI-R5 — complete reads before editing
Implementation: `loadSnapshot` awaits `getActiveVersion` **and** `getCurrentAttempt` together, then adopts one coherent snapshot for the current generation; loading is tracked for initial, `Retry` and conflict reconcile alike; all edit/navigation/destructive controls are inert while loading; an absent active version settles non-editable.

- `[R5] initial current-attempt read keeps all answer controls blocked` (promoted)
- `[R5] a retry load stays blocked while its read is held`
- `[R5] a rejected retry load stays non-editable with read recovery visible`
- `[R5] an obsolete initial read cannot overwrite the newer material phase`
- `[R5] no active version settles non-editable instead of falling back to legacy props`

### M2UI-R6 — unresolved write identity locks every conflicting action
Implementation: `write_unknown` keeps the intent and the lock after `inFlight` ends; only `Retry` may act, resending the identical payload; preparation reads and the whole continuation chain are caught, so no unhandled rejection or null-payload spinner can occur; conflict classification uses the typed `PracticeSessionError.code` (`OPERATION_CONFLICT`, `INVALID_STATE`, `NOT_FOUND`, `INVALID_ARGUMENT`) rather than message substrings, and a typed refusal settles the intent, re-reads state and asks for a new deliberate action. Draft selection is stored separately from the persisted response; revealed feedback requires `draft === null`, so an unsaved choice is never shown with the previous response's correctness.

- `[R6] failed changed answer does not mix draft selection with saved correctness` (promoted)
- `[R6] uncertain completion blocks fresh completion identity` (promoted)
- `[R6] Retry replays the exact payload once and accepts no fresh mutation` — clicks a radio and Continue while unresolved (no new call), then compares the two captured payloads for deep equality and asserts one receipt row and one response row.
- `[R6] Retry refresh performs reads only and never resends the acknowledged write` — records every action sent; `Retry refresh` leaves the write list at exactly `["start_or_resume", "record_response"]`.
- `[R6] a refused start keeps its identity and still applies the held answer on Retry` — asserts no attempt row, no revealed feedback, the draft visibly selected, no second `start_or_resume`, and that the retry resends the same `operationId` and then persists the held answer.

### M2UI-R7 — recovery visible on completed results
Implementation: notices render in the result view too; the immutable `completedResult` survives an unresolved retake; `Retake this test` is inert unless the phase is `completed`; on acknowledgement the actual current attempt is re-read before editing unlocks (a receipt snapshot is not trusted), and `expectedAttemptId: null` is preserved for a completed attempt.

- `[R7] failed retake from result exposes same-ID retry in result view` (promoted)
- `[R7] a committed retake with a lost acknowledgement replays and reconciles`
- `[R7] the completion callback and displayed score follow the acknowledged result` — a refused completion calls `onComplete` zero times, shows no score and leaves the stored attempt `in_progress`; after the same-identity retry, the single callback and the rendered totals/disclaimer are compared against the persisted `practice_attempts` row (`id`, `completed_at`, `score_percent`, `correct_count`, `total_questions`), so nothing is invented. — real DB commit then refused acknowledgement; asserts the completed score and its totals remain on screen, the fresh retake is disabled, the replay payload is identical, the attempt count stays 2 (no duplicate work), and editing reopens with nothing checked from the closed attempt.

### M2UI-R8 — central null/closed/replaced reconciliation
Implementation: one `adoptAttempt` path replaces the three `if (attempt)` branches; `null` is adopted into both state and ref and clears derived state; Abandon/See-score can no longer refer to a closed or erased attempt; conflicts and refresh failures keep read recovery visible.

- `[R8] acknowledged response followed by null refresh clears the old attempt` (promoted)
- `[R8] a null current attempt through Retry refresh clears the obsolete attempt`
- `[R8] a settled conflict refresh with no current attempt clears the stale one` — external real abandonment makes the next response conflict with `INVALID_STATE`; the reconcile read returns null and the stale attempt disappears.
- `[R8] Abandon never keeps pointing at the attempt it closed`

### M2UI-R9 — generations and the destructive-action lock
Implementation: synchronous per-key erasure lock; payload and confirmation bound to the displayed `historyKey` and generation; obsolete acknowledgements cannot navigate, clear or error the current route; committed storage work is never presented as cancelled by leaving the view; dialog controls bounded while pending; review revalidation on either route part.

- `[R9] rapid confirmation uses a synchronous lock and one erase identity` (promoted)
- `[R9] an erase acknowledgement from group A cannot navigate away from group B` (promoted)
- `[R9] changing only history key revalidates attempt membership` (promoted)
- `[R9] returning to a group cannot revive an obsolete erasure acknowledgement` — A→B→A round trip with a held erasure; the acknowledgement is dropped, A is neither navigated nor errored, and the committed erasure is still real in storage.
- `[R9] leaving the view does not cancel committed erasure work or update a dead page` — unmount during a held erasure; the rows still disappear and no callback touches a dead page.
- `[R9] a new route key never reinterprets the pending erasure confirmation` — while A's erasure is pending, B's own confirmation issues B's key: `["bind-A", "bind-B"]`.

Preserved positives (unchanged behavior, still green): the ten `PracticeSessionPR2Corrections.test.ts` cases, the eleven `PracticeSessionPR2.test.ts` flows, the eight `PracticeTestPanel.test.ts` interaction/keyboard/focus cases, `MaterialDetailOffline.test.ts`, the `practiceSessionContract.test.ts` persistence contract, `practiceStartupValidation.test.ts` including `matches every native accept/refuse outcome` (43 shared cases), and `Dialog.fallback.test.ts` modal-fallback behavior.

---

## 4b. Defects this submission found while validating its own work

Two problems were caught by running the gates rather than by reading the code, and both were fixed rather than explained away:

1. **A load-dependent focus race.** Revealing saved feedback disables the choice that was just focused in the same commit, and a browser blurs a disabled element. With the focus hand-off in a passive effect, focus could sit on `<body>` for a frame; under full-suite CPU contention `PracticeTestPanel.test.ts > moves focus to Continue on Space, and to See score after final question answer selection` failed intermittently while passing in isolation. Both focus transitions are now `useLayoutEffect` (the pattern already used by `src/state/useDraftRecovery.ts`), so the action button or the first choice of the new question takes focus inside the commit. Verified by five isolated repeats and two consecutive full-suite runs.
2. **A conflict announced before it was reconciled.** The typed-refusal path first printed "The session was refreshed" and only then performed the read — exactly the R8 wording defect being corrected. The reconcile now carries the message and publishes it only after the authoritative read succeeds; if that read fails, the visible state stays in read recovery instead of claiming a refresh. `PracticeSessionPR2Finish.test.ts > [R8] a settled conflict refresh with no current attempt clears the stale one` covers the success path.

## 5. Documented choices

1. **Draft handling on a failed replacement — retained (the diagnostic's preference).** A refused change keeps the new selection visibly as a draft with no confirmed feedback for it, and the saved response underneath remains the durable truth. No assertion was adapted.
2. **Pending-dismissal policy for a destructive dialog — non-dismissible while pending.** Cancel, the close icon, Escape and the backdrop are all inert; the confirm button shows `Erasing…`. Route navigation still ends the *view* of the pending action (the reset for a new key closes it) because the confirmation was bound to the previous key's generation. The route proof therefore still uses router navigation to demonstrate callback isolation, exactly as the assignment allows.
3. **Deliberate start/resume — acknowledgement ordering, not a blocking button.** The first answer click is the deliberate start action: `start_or_resume` is sent and must settle before any `record_response` is issued, the intermediate phase is labelled (`Starting your practice attempt…`), and the held answer is neither revealed nor lost. A separate mandatory "Start" control was not introduced because the ten accepted diagnostics treat an answer click as that deliberate action; adding one would have removed the accepted behavior instead of correcting it.
4. **Volatile erasure identity is per-view and per-key.** It survives an unknown outcome for the same displayed key (same-ID retry), and is not persisted across a reload/restart. After a route change or reload, a new confirmation legitimately allocates a new identity; nothing in the UI claims that pending IDs survived.
5. **Leaving the view is not cancellation.** Committed storage work continues and completes; only the acknowledgement is dropped. The UI never claims it cancelled a destructive operation.
6. **The panel prop-change case remains a component-boundary probe.** Production `MaterialDetail` is keyed by material ID; the direct rerender assertion is not presented as evidence of an ordinary production cross-material corruption path.

---

## 6. M2UI-R10 — repairing the invalid gate claim

**What was wrong.** The previous submission reported `npm test` as "exit 0 / fully green" while its own attached log records `Errors 2 errors` — two unhandled `DatabaseDisabledError` rejections attributed to `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts`, caused by `rollbackIfOpen` hitting `database is not open` after that test's disposable DB was closed. The commands were piped through `tee` without a demonstrated `pipefail`, so printed counts were not process-exit proof. The report also attributed three permanent cases to `PracticeSessionPR2Corrections.test.ts` that the file does not contain (a completed-review membership case, a noncommitted-erase retry case and a double-click erase case) and mapped several native `req_*` tests to the wrong frontend file.

**What was done.**

1. The failed receipt is preserved untouched at `docs/evidence/m2-practice-session-pr2-corrections-2026-10-05/gate/02-npm-test.txt`. This report does not restate it as green.
2. Exit codes are now captured from the process itself, before any pipe can mask them: every step runs `"$@" > log 2>&1` and writes `$?` to a sibling `.exit` file, with `set -u -o pipefail` in the runner. Both the log and the raw exit are in `gate/`.
3. Full frontend gate, final run: **exit 0**, `Test Files 87 passed | 3 skipped (90)`, `Tests 2,544 passed | 4 skipped (2,548)`, **zero unhandled errors** (the log contains no `Unhandled`/`Errors` section). Green requires exit 0 **and** zero failed tests **and** zero unhandled errors.
4. **Nonreproduction, reported honestly.** The database-lifetime rejection did not recur: not in the pre-gate full run (`validation-r10/full-run-preregist.txt`, exit 0, 2,543 passed, zero unhandled), not in three isolated runs of the implicated file (`validation-r10/import-repeat-1..3.txt`, each exit 0, zero unhandled), and not in the final gate run. The identified candidate mechanism is real but unproven as the cause: `ImportStudyPacketDialog.test.ts` closes its disposable DB synchronously in `afterEach`, so any transaction still in flight at that moment would roll back into a closed handle. Nothing was suppressed, no unhandled rejection was filtered, no arbitrary delay was added, and no production transaction/recovery semantics were weakened to manufacture a green result — the assignment requires no speculative fix for a defect that did not reproduce.
5. **The two previously requested proofs that had no matching permanent case were added:**
   - Native erasure mid-write rollback — `src-tauri/src/practice_session_tests.rs::req_erase_history_mid_write_failure_rolls_back_every_change`: a `BEFORE INSERT` trigger on `practice_session_operations` refuses the erasure's own final receipt write, i.e. **after** receipts were tombstoned and attempts/responses/inactive versions were deleted. The test asserts the refusal is a `StorageError`, that all six counts return exactly to their pre-erase values `(2,1,2,2,5,0)`, that no `erase_history` receipt exists, and that a fresh deliberate erasure afterward prunes to `(1,1,0,0,6,5)` while the active version survives.
   - Browser disabled-recovery for erasure — `src/data/practiceEraseDurability.test.ts > browser history erasure durability (M2 PR2 R10) > an erasure whose recovery fails disables the adapter and keeps every saved row`: on real sql.js/WASM with an in-memory store, an export failure plus a foreign-key check that can never pass drives the connection owner to disable itself. The erasure rejects twice with `DatabaseDisabledError`, reads refuse too, the stored bytes are provably unchanged, and a reopened adapter returns the attempt intact (`in_progress`, `answeredCount: 1`) so a new erasure then succeeds for real.
   - Reused existing proofs, cited by their real names: `req_erase_history_atomic_pruning_and_tombstones`, `req_erase_history_validation_checks`, `req_erase_history_unrelated_isolation_and_safe_new_practice`, `req_erase_history_restart_refusal_and_backup_validation`, `shared_validation_contract_native_outcomes`, and on the frontend `practiceSessionContract.test.ts` → `PR2: atomic history erasure prunes attempts, responses, inactive versions, and tombstones receipts`, `PR2: atomic history erasure on sqlJsDb with storage failure rolls back cleanly`, `PR2: sqlJsDb unrelated-history isolation and restart refusal of late old replay`.

---

## 7. Sequential local source gate (one run, after all source changes)

Toolchain, scoped per command: `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`, `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Observed: Node v22.23.3, npm 10.9.9, rustc 1.99.0 (b940084d7), cargo 1.99.0 (5f94df478), Vitest 4.1.11, host macOS 27.0.1 on arm64 with the explicit 26.5 SDK selected by `SDKROOT` (the unselected default `xcrun --show-sdk-version` still reports 27.0, which is why `SDKROOT` is scoped per command).

| # | Command | Exit | Observed |
| --- | --- | :---: | --- |
| 1 | `npm run typecheck` | 0 | `tsc --noEmit`, 0 errors |
| 2 | `npm test` | 0 | 2,545 passed, 4 skipped (90 files: 87 pass / 3 skip), **0 unhandled errors**, 28.45 s |
| 3 | `npm run build` | 0 | `tsc --noEmit && vite build`, built in 886 ms |
| 4 | `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets` | 0 | 391 passed, 0 failed, 6 ignored, 21.97 s |
| 5 | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | 0 | clean, 0 warnings |
| 6 | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 | clean |
| 7 | `npm run test:cargo-lock` | 0 | lock/v0.5.3 synchronization verified |
| 8 | `git diff --check` + per-new-file hygiene (trailing whitespace, final newline) | 0 | tracked check exit 0; all five new `src/` files clean |
| 9 | migrations/registry integrity vs base | 0 | `src-tauri/migrations`, `src/data/migrations.ts`, `src/data/migrationSafety.test.ts` unchanged; migrations 0001–0011 listed |

All durations above are transcribed from the attached final-run logs in `gate/`, so a reviewer can re-measure them against the same receipts.

Step 2 is the run that satisfies "exit 0 AND zero failed tests AND zero unhandled errors"; steps 1 and 3 confirm no type or bundling regression from the new test files. A second full-suite run (`validation-r10/full-run-repeat.*`) reproduced the same 2,545 / 4 / exit 0 / zero-unhandled result. Earlier steps were not re-run after later edits except where a source change justified it — the final run above is the one performed after every application and test change in this submission.

Simulated UI/storage tests are implementer evidence, not Codex-independent review, and are not installed-app, VoiceOver or release verification.

---

## 8. Files changed by this correction (29 source paths)

Newly added here: `src/pages/StudyLibrary/PracticeSessionPR2Finish.test.ts`, `src/data/practiceEraseDurability.test.ts`.
Modified here: `src/pages/StudyLibrary/PracticeTestPanel.tsx`, `src/pages/StudyLibrary/PracticeHistory.tsx`, `src/components/ui/Dialog.tsx`, `src-tauri/src/practice_session_tests.rs`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`.
Unchanged by this correction (carried from the accepted-in-progress earlier submission): `src/App.tsx`, `src/data/db.ts`, `src/data/practiceSessionTransaction.ts`, `src/data/practiceStateValidation.ts`, `src/data/practiceSessionContract.test.ts`, `src/data/repositories/practiceSessionRepository.ts`, `src/data/sqlJsDb.ts`, `src/data/tauriDb.ts`, `src/data/testing/nodeSqliteDb.ts`, `src/domain/types.ts`, `src/pages/StudyLibrary/MaterialDetail.tsx`, `src/pages/StudyLibrary/MaterialDetailOffline.test.ts`, `src/pages/StudyLibrary/PracticeTestPanel.test.ts`, `src/pages/StudyLibrary/StudyLibrary.tsx`, `src/pages/StudyLibrary/studyLibrary.css`, `src/pages/StudyLibrary/PracticeSessionPR2.test.ts`, `src/pages/StudyLibrary/PracticeSessionPR2Corrections.test.ts`, `src-tauri/src/backup.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/practice_sessions.rs`, `src-tauri/fixtures/practice-validation/cases.json`.

Byte-level hashes of all 29 paths relative to this repository root are in `source-hashes.json`; evidence-file hashes are in `SHA256SUMS`, computed relative to this evidence directory (two distinct roots, deliberately separate).

---

## 9. Remaining items and limits of this evidence

- **No blocker was hit.** Everything in R5–R10 was completed locally; nothing required a new owner decision, provider, account, network call or dependency.
- **Not exercised:** installed application, VoiceOver/real assistive-tech verification, real pilot profile data, backup/restore round-trips against user data, packaging, signing, notarization, release or any roadmap feature beyond PR2. The review's own note stands: these tests are disposable synthetic checks.
- **Left for the independent reviewer:** whether the acknowledgement-ordering interpretation of "deliberate start/resume" (§5.3) is acceptable, since it preserves the ten accepted diagnostics rather than adding a separate Start control; and confirmation that the nonreproducing unhandled-rejection risk in the import test file needs no test-lifetime change.
- **Git:** no staging, commit, push, PR or merge was performed. Codex remains the final reviewer and Git coordinator; the accepted source PR is coordinated after review.
