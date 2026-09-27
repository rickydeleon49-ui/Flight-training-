# M1 D3–D4 — Daily Flight Plan on Flight Deck, with saved daily decisions

Date: 26 September 2026
Repository: `H:\Ai Repo clones\Flight-training-`
Branch: `feature/m1-d3-d4-daily-plan`
Base: `e938f841b9129c01a1e8c49df5ed1de2b69c0118` (D1–D2 merged through PR #32)

**Status:** Independent review passed after corrections. All 62 focused tests were independently rerun successfully. Awaiting the pull-request CI and merge gate.

## 1. Scope

- **D3:** the Daily Flight Plan card on Flight Deck. It has a 10/20/30-minute or untimed budget, up to three suggestions, and Start, Why this, Skip today and Move to tomorrow on each item. Unfinished work stays reachable under "Remaining unfinished work".
- **D4:** the budget preference, today's decisions and the selected session are saved, and survive navigation and app restarts.
- **Not included:** D5–D7, AI features, backup hardening, dependency changes and schema migrations.

## 2. Behaviour specification

### Start

| Recommendation | Start does |
| --- | --- |
| Study material | Opens `/study/:materialId`. |
| Lesson prep | Opens `/schedule/:eventId` (the lesson checklist). |
| Question tied to a lesson | Opens `/schedule/:eventId`. Otherwise opens `/questions`. |
| Pinned note | Opens `/notes`. |
| Action linked to a debrief, material or lesson | Opens that record, **only if it still exists** (checked against the loaded sources). |
| Action linked to a goal | Opens `/flight-path`. |
| Standalone action, or a linked one whose record was deleted | Stays on Flight Deck and gives keyboard focus to the action's own control: the checkbox in *Today's plan* (`#action-<id>`) or the Reschedule/Complete buttons in *Needs attention* (`#attention-<id>`). If the dashboard doesn't list the action (for example, it's due later), Start opens the action's editor. |

Start never creates, completes or edits anything. Recommendations never change proficiency or create actions or questions.

### Session stability

- The first computation of the day chooses a session using the D2 selector and saves its ids and order.
- A saved session keeps its items in saved order. New work that arrives later, even higher-priority work, **does not displace or join a healthy session**. It appears under "Remaining unfinished work" until an explicit **Refresh**, a **budget change**, or the **next local day**.
- A selected item leaves the session only when its source stops being an open candidate (completed, deleted or answered) or when she skips or defers it. **Only that vacated slot is refilled**, from the remaining candidates in selector order, within the unallocated budget. The other items keep their relative order.
- A saved session's target capacity is established when initial recommendations are chosen (or after explicit refresh, budget change, or local-day rollover). When all selected sources disappear, the session preserves its intended capacity rather than resetting to a fresh session. If no replacement currently fits, the empty intermediate state preserves its intended capacity in `targetCapacity`. When fitting work becomes available later, at most vacated slots are refilled up to the intended capacity. A session never grows to absorb newly arrived work.
- A selected item whose estimate changes stays in place. The summary reports the new total honestly and marks it "over budget" when it no longer fits.
- An empty saved session before any initial selection is made isn't a locked selection. If nothing was initially available and work later arrives, it is suggested.

### Skip versus defer (planner-only)

- **Skip today** hides the item for the rest of the local day.
- **Move to tomorrow** also hides it for the rest of today and is recorded separately as a deferral.
- Both expire at the next local midnight, when the item becomes eligible again and is ranked normally.
- **Neither changes the source action's due date.** The card says "Due date stays the same" under Move to tomorrow. Changing a due date is still done with the existing Reschedule control.
- **Reset today's skips** clears every decision recorded today in **one** write. The item stays out of a healthy session until Refresh, following the stability rule.

### Local dates and midnight

- Dates are local calendar days (`todayIso`), never UTC.
- `useLocalToday` is the single date source for the card and the hook. It schedules one timeout for the next local midnight and re-reads the date when the window regains focus or becomes visible, which covers sleep and backgrounding. It doesn't poll, and it removes its timer and listeners on unmount.
- On a new day, the saved state rolls over: yesterday's skips and deferrals are dropped, and a fresh session is chosen and saved once.

### Persistence and failure recovery

- The state is stored as one JSON row in the existing `app_metadata` table (key `daily_plan_session`). **No migration.**
- Every change runs inside AppDataContext's serialized mutation queue:
  1. Read the stored plan.
  2. Roll it over to today.
  3. Apply the change (skip, defer, budget, reset or refresh).
  4. Reconcile the session.
  5. Write only if the result differs from what is stored (a signature that ignores `updatedAt`).

  Rapid or overlapping clicks therefore can't overwrite each other, and repeating a click doesn't write again.
- The session shown on first open, after midnight, or after a refilled slot is saved once per distinct session. It isn't saved on every render, so reloads and re-renders don't write.
- **A failed change** shows "That change couldn't be saved. Your previous plan is unchanged — try again." The stored plan is untouched.
- **A failed first-session save** shows that the plan is displayed but may change after leaving or restarting, with **Retry**. There's no automatic retry loop.
- **A successful write whose reload fails** still shows the saved result. The hook keeps what it last wrote and uses whichever of that and the loaded state is newer. The app-wide reload error is still reported.
- Busy state counts in-flight writes, so overlapping requests don't clear "Saving…" early. An error clears only when a later request succeeds.
- A write that finishes after the card unmounts still completes and is saved, without updating an unmounted component.

### Keyboard

- The budget control is a WAI-ARIA radiogroup with roving `tabIndex`, following the practice-test pattern.
- Arrow keys move focus **and** selection together, with wraparound. Home and End work.
- While a budget saves, the chosen option shows as selected. If the save fails, the saved budget shows as selected again and the error appears, with focus left on the option she tried.
- Every Start, Why this, Skip and Move control has a name that includes the item title.

## 3. Review findings and corrections

| Finding | Correction |
| --- | --- |
| 1. Locked session re-sorted by the selector | `computeDailyPlan` keeps saved items in order (`assembleLockedSession`) and refills only vacated slots. Skip and defer keep the id in `suggestedIds`, so a vacated slot is counted exactly once. The session is persisted by a bounded effect keyed on the plan signature. |
| 2. Lost updates, non-atomic reset | `useDailyPlan.runUpdate` computes from the stored plan inside the mutation. `applyResetToday` replaces the per-item reset loop. In-flight counting and sequence-ordered error clearing were added. |
| 3. Unsafe or unusable Start | `getStartTarget` checks that linked records exist. `focusRenderedAction` focuses the real control. Flight Deck's `startAction` falls back to the action editor. |
| 4. No rollover while mounted | `useLocalToday` shared by the card and the hook. |
| 5. Arrow keys didn't move focus | Roving focus with refs, wraparound, Home/End, and pending selection that reverts on failure. |
| 6. Session size lost when all sources disappear | `DailyPlanState.targetCapacity` preserves intended slot capacity even when all selected items vacate and no replacement immediately fits. `computeDailyPlan` refills only vacated slots (`assembleLockedSession`) rather than resetting to a fresh full selection. Verified across JSON serialization and parsing; separate integration tests cover database reopening. Explicit refresh, budget change, and local-day rollover clear capacity for fresh selection. Existing JSON without `targetCapacity` is backward-compatible via `suggestedIds.length`. |
| 7. Budget exclusion conflated with finished work | `DailyPlanCard` empty state distinguishes when unfinished work remains but exceeds the selected budget (`plan.remaining.length > 0`) from genuinely empty or postponed states. It explains that the selected budget has no fitting suggestions, keeps the remaining-work toggle and Start button discoverable, provides clear guidance to change the budget or view remaining work, and reserves "all completed" or postponed messaging for when those claims are true. |

## 4. Tests

| File | Tests | Covers |
| --- | --- | --- |
| `src/logic/dailyPlan.test.ts` | 29 | Serialization; Start routing, including deleted journal, material and event fallbacks and valid links; skip/defer; rollover; stability against a higher-priority arrival; refill after completion; grown estimate reported as over budget; no growth of a healthy session; atomic reset; signature; capacity preservation when 1-item session loses only item; capacity preservation when 2-item session loses both; empty intermediate state JSON round trip; fresh selection on refresh/budget/rollover |
| `src/components/dailyPlan/DailyPlanCard.test.ts` | 20 | Real provider plus real SQLite with instrumented plan writes: empty and sparse lists; A/B kept across a higher-priority C **and a database file reopen** until Refresh; completion then deletion refill; failed first save with no loop and Retry recovery; no writes on unchanged reloads and re-renders; two rapid skips with held writes; budget change plus deferral interleaved; reset of two decisions in one write; decision write failure; successful write followed by a failed reload; unmount during a pending write; due dates unchanged; radiogroup focus, wrap, Home/End and failure; rollover while mounted; budget exclusion vs finished work; honest empty state; postponed messaging with reset; valid unknown-duration suggestion |
| `src/components/dailyPlan/DailyPlanStart.test.ts` | 3 | On the real Flight Deck page: Start focuses the Today's-plan checkbox, a Needs-attention button, or opens the editor for an unlisted action |
| `src/state/useLocalToday.test.ts` | 5 | Runs in `America/Los_Angeles`: local-versus-UTC day, advancing at local midnight with a single timer, catching up on focus and visibility after sleep, cleanup, next-midnight arithmetic |
| `src/data/repositories/appRepository.test.ts` | 5 | Existing metadata tests, including daily plan round-trip |

**Mutation checks** (temporary, then reverted and byte-compared):
- Disabling the session lock (always reselecting) fails 4 stability tests.
- Computing changes from the render-time snapshot instead of the stored plan fails the rapid-skip, interleave and due-date race tests.
- Removing the once-per-session write guard didn't fail any test. The signature-keyed effect already prevents repeat writes, so the guard is kept only as defence in depth.

## 5. Verification

| Command | Result |
| --- | --- |
| `npx vitest run src/logic/dailyPlan.test.ts src/components/dailyPlan/ src/state/useLocalToday.test.ts src/data/repositories/appRepository.test.ts` | 5 files, 62 passed |
| `npm test` | 51 files passed, 2 skipped; 487 passed, 2 skipped |
| `npm run build` (runs `tsc --noEmit`) | Built with 0 errors |
| `git diff --check` plus a whitespace and conflict-marker scan of untracked files | Clean (see the handoff report) |
| Rust `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` | **Not re-run.** No `src-tauri`, Cargo or migration file changed from `e938f84`. Reused the required check "Tests, types, and the data-safety guards" on `e938f84`: success, 2026-09-26T02:42:06Z. |

## 6. Migration and backup implications

- No schema change. `daily_plan_session` is an ordinary `app_metadata` row, so it travels inside complete backups and restores with the database.
- Existing saved daily-plan JSON rows lacking `targetCapacity` remain fully compatible without schema migration: `parseDailyPlanState` safely loads them, and `computeDailyPlan` infers initial capacity from `suggestedIds.length`.
- An older build ignores the unknown key.
- Restoring an older backup without the row starts a fresh plan.
- A malformed row parses as "no plan" and is replaced on the next save.
- A restored plan from an earlier date rolls over on open.

## 7. Known limitations

- The card shows up to 3 suggestions (the D2 default), not 5.
- "Move to tomorrow" is planner-only: it doesn't pin the item to the top of tomorrow's plan. It becomes eligible and is ranked normally.
- Undoing a single skip or deferral isn't offered; Reset clears all of today's decisions.
- An item restored by Reset doesn't rejoin a healthy session until Refresh.
- Focus stays on a budget option whose save failed, while selection shows the saved value.
- Installed-app behaviour hasn't been checked on either platform. **No Mac verification was performed.**

## 8. Manual Windows and Mac checklist

1. Open Flight Deck with a few actions due today. Confirm up to three suggestions, the budget control, and Start, Why this, Skip today and Move to tomorrow.
2. Tab to the budget control and use the arrow keys, Home and End. Focus and selection move together, and the plan updates.
3. Skip one item and defer another. Navigate away and back, then quit and relaunch. The decisions and session are unchanged, and due dates in the action list are unchanged.
4. Add a new overdue action. It appears under Remaining, not in the session, until Refresh.
5. Complete a suggested action. Its slot is refilled, and the other items keep their order.
6. Start a standalone action (keyboard focus lands on its checkbox), an overdue one (focus on its buttons), and one due later (its editor opens).
7. Leave the app open across local midnight, or put the machine to sleep and wake it after midnight. Yesterday's skips and deferrals are gone and a new session appears.
8. Make a complete backup, restore it, and confirm the plan for today reappears.
