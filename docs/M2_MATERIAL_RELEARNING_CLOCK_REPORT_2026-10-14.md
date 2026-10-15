# M2 Material relearning clock — 14 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** One bounded M2 increment by Claude (`claude-opus-5-5`). The work is uncommitted and unpushed in an isolated worktree.

An open material now notices when a saved Again card becomes due. Its summary updates and **Review cards** becomes available without navigation, input or new data. Scheduling rules, persistence, migrations, dependencies, native code, identity and version are unchanged.

## Source identity (recorded before editing)

| Item | Value |
| --- | --- |
| Isolated worktree | `outputs/flight-deck-team/runs/20261014-221139-402612/worktree` |
| Branch | `agents/task-20261014-221139-402612` |
| HEAD / base | `42077ccd00b70ad406e30d236a34e0ab556745d5` (PR160 on `main`) |
| Status before editing | clean except the untracked prepared `node_modules` symlink to the run's `runtime/node_modules` |
| `src/pages/StudyLibrary/useCardReview.ts` before | `b0c88822e23cf9c1130f024d3f814bd7f75aac31cdf738c2c948e477fcfc2731` |
| `src/pages/StudyLibrary/useCardReview.ts` after | `a6aeab0164c9b468d6caddbb0e6a54cb99c035743b09d073c268eaf23339a861` |
| `src/pages/StudyLibrary/useCardReviewClock.ts` (new) | `f4eb77177ea3f10dc2855592a3b20b9ab0e6ff149b1897db063162994c65419a` |
| `src/pages/StudyLibrary/useCardReviewClock.test.ts` (new) | `d2ab648002b944f58142a1756307d7a012e8b4bde18156c25135493b7e0878b2` |
| `src/pages/StudyLibrary/CardReviewClockRecovery.test.ts` (new) | `62c199bb9d55d00df7fd6f699d1c4a14fd94f8d574bb173cef862dea5e1468c4` |
| `CardReviewPanel.tsx` / `CardReviewPanel.test.ts` (untouched) | `a236bdd6…af78b` / `b23b872e…81604` |

**Scope.** Only the five allowed paths were written. The keyboard package `f163efd3f8f1`, parity `d8ff795089fc`, schema14 preparation, MAINT-143-KEYS, timezone PR152, REL-03 and M4 were neither imported nor touched. Shared handoff history (`docs/PROJECT_HANDOFF.md`, `STATUS.md`) is outside the allowed paths, so no handoff entry was added; the controller can link this report. The primary checkout and other run directories were not modified.

## The gap

`CardReviewPanel` computes its summary on each render: `summarizeCards(snapshot, review.clock.now(), …)`. Nothing in `useCardReview` caused a render as time passed. Suppose she rated a card Again and kept the material open. The card's due instant would arrive, but the panel kept showing "All caught up. Next review: in 9 minutes." and **Review cards** stayed disabled until some unrelated render.

## Change

### `useCardReviewClock.ts` (new)

- `nextAgainDueAt(snapshot, nowIso)` returns the earliest Again `dueAt` that is strictly after now. It considers only current-version items whose state is not suspended, not flagged, has `step < 0` and a non-null `dueAt`. This matches the Again branch of `summarizeCards`. Earlier-version states are never consulted because only `snapshot.current.items` are iterated.
- `useCardReviewClock(snapshot, clock, owner)` runs one effect, keyed on `[snapshot, clock, owner]`, that owns:
  - **One timer**, aimed at `nextAgainDueAt`. The delay is `max(wait, 0)`, capped at `MAX_CLOCK_DELAY` (2,147,000,000 ms). When it fires, the hook bumps a counter (one render) and re-arms for the *next* future deadline. Once the deadline is past, it is no longer "future", so it is not re-selected and there is no immediate loop.
  - **An early-fire guard.** Suppose a timer fires while its own deadline is still in the future: the clock moved back, or the cap was hit. The re-arm then waits at least `EARLY_RETRY_DELAY` (1 s). Even a stopped clock renders at most once a second.
  - **Resume.** `window` `focus` and `document` `visibilitychange` (ignored while hidden) bump the counter and re-arm from the current clock and latest snapshot. This covers timers delayed by sleep and clock movement in either direction. `clearTimeout` runs before every arm, so repeated events never accumulate timers.
  - **Cleanup.** Clears the timer, removes both listeners and sets `active = false`. This runs on unmount, on snapshot/material/content change and in the StrictMode double-invoke.
- Callbacks only call `setTick`. They have no access to the repository, session, pending operations or locks.

### `useCardReview.ts` (+5 lines)

```diff
+import { useCardReviewClock } from "./useCardReviewClock";
 …
   const readState: CardReadState = read.materialId === materialId ? read : { phase: "loading" };
+  // Display only: render again when a shown Again card becomes due, or when
+  // she returns to the window, so the summary follows the clock.
+  useCardReviewClock(readState.phase === "ready" ? readState.snapshot : null, clock, JSON.stringify([materialId ?? null, options.contentKey ?? null]));
```

The snapshot passed in is the one being shown, which is the authoritative read state for this material. It is `null` while loading, after a failed read or when a different material owns the read state. The injected `clock` is the same one the panel uses for its summary. The controller's return shape is unchanged. `startSession` keeps its fresh `getCardReviewSnapshot` plus `getDueQueue` path. The panel's `autoStart` effect does not depend on the tick, so a clock render cannot start a session.

## Requirement-to-test mapping

H = `useCardReviewClock.test.ts` (16 tests: fake `Date`/timers, injected drifting clock, synthetic snapshots, plus `useCardReview` over an in-memory repository). R = `CardReviewClockRecovery.test.ts` (8 tests: real `CardReviewPanel`, real card review repository and atomic writer on disposable node:sqlite, fake `Date`/`setTimeout`/`clearTimeout`, fixed Chicago zone, `fetch` stubbed to reject and asserted unused after every test).

| Requirement | Tests |
| --- | --- |
| Future-only Again work shows no due cards and disables Review cards; reaching the instant updates the summary and enables it, with no input or data publication | R "reaching the saved Again instant…" (**decisive**); R StrictMode |
| Just before vs at the instant | H "renders exactly at the Again instant, not a millisecond before"; R decisive (due − 1 ms disabled, due enabled) |
| Deliberate start uses the fresh snapshot and queue and selects the now-due card | R decisive ("Card 1 of 1", card 1's front, new reads after the click); H "deliberate start after the instant…" (calls `snapshot, recent` → `+ snapshot, queue`; queue entry is card a, `again`) |
| One owned timer, safe delay bounds, no polling | H instant test (`getTimerCount` 1 → 0, then no renders over a day); H "caps very long waits…"; H "a stopped clock never fires faster than once a second" |
| Successive deadlines, no immediate loop | H "after each deadline schedules only the next future deadline"; H "a timer that fires before its instant…"; R "successive Again instants…" |
| Paused, flagged, earlier-version, day-ladder, new and past states create no wakeup | H `nextAgainDueAt` test; H "paused, flagged, day-ladder, new, past and earlier-version cards create no wakeup" (zero timers); R "paused and flagged Again cards stay out…" (heading and disabled state unchanged, no reads) |
| Delayed visible resume; hidden does nothing | H "delayed visible resume…"; R "a delayed timer is reconciled on return to a visible window" |
| Forward and backward clock movement, re-arm after movement | H "focus after the clock moved back…"; R "focus follows the clock forward and back, and the timer is re-armed…" |
| Repeated focus/visibility do not accumulate timers | H "repeated focus and visibility events keep exactly one timer"; R forward/back test (four extra focus events, then one exact firing) |
| Unmount, material/content change and StrictMode cleanup | H "a new snapshot replaces the timer; a null snapshot or another owner clears it"; H "unmount removes the timer and both listeners"; H "StrictMode leaves one timer and one focus listener"; H "switching material clears the old material's wakeup"; R "switching material and unmounting leave no wakeup behind" |
| Clock renders preserve session, position, reveal, recent history, notice, reset state, pending operation ID and unknown-write recovery, with no reads or writes | H "re-render the controller at the instant and read, write, start or advance nothing" (identity of `session`, `pending`, `recent`, `read`, `notice`, `resetPending`; repository call log unchanged; Try again resends the same `operationId`); R "an open session, revealed answer and unconfirmed rating survive the instant…" (Card 2 of 3, answer shown, unconfirmed alert, one recent row, no new reads or writes, stored rows equal, Try again resends the same operation and advances to Card 3 of 3) |
| Stored states/events unchanged; no provider or network | R: `card_review_state`, `card_review_events` and `card_review_operations` deep-equal before and after clock moves; `fetch` spy asserted unused in `afterEach` |
| Existing deliberate start and retry behavior | `CardReviewPanel.test.ts` (29, unchanged file) plus the H/R start and Try again cases above |

## Verification

**Runtime:** Node **v22.23.3** (`/opt/homebrew/opt/node@22/bin`, put first on `PATH`). The shell default is Node 26.10.0 and was not used. npm 10.9.9 and Vitest 4.1.11 come from the existing locked `node_modules`. `npm ci` was not needed, and no dependency or lock file changed.

### Final bytes (hashes above)

| Command | Exit | Result |
| --- | --- | --- |
| `npx vitest run src/pages/StudyLibrary/useCardReviewClock.test.ts src/pages/StudyLibrary/CardReviewClockRecovery.test.ts src/pages/StudyLibrary/CardReviewPanel.test.ts src/pages/StudyLibrary/ReviewDueClockRecovery.test.ts src/pages/StudyLibrary/useLibraryReviewsClock.test.ts src/pages/StudyLibrary/StudyLibraryReviews.test.ts --configLoader runner --no-cache` | 0 | 6 files, 95 tests passed (16 + 8 + 29 + 5 + 21 + 16), 5.34 s |
| `npm run typecheck` | 0 | clean |
| `npm run build` | 0 | built (917 ms bundle) |
| `git diff --check` | 0 | clean; the three new source/test files were also grepped for trailing whitespace (none) |

The assignment's "six listed test files" were not enumerated in the material available to this run. The set above is my choice: the two new suites, the existing panel suite, and the three Review due / library clock suites nearest this change (PR160 and its neighbors).

### Against unchanged base production code

This check used a disposable `git archive HEAD` copy in `/tmp/cardclockdiag.y0yn`, with `node_modules` symlinked and the three new files copied in. `useCardReview.ts` in the copy hashed `b0c88822…` (= HEAD). The copy was deleted afterwards, and the worktree bytes were never altered.

| Suite | Exit | Result |
| --- | --- | --- |
| R | 1 | **6 failed / 2 passed.** Decisive test fails at line 169, `expected 'All caught up. Next review: in 9 minu…' to be '1 card due'`. The delayed-resume, forward/back, successive, pending-session and StrictMode tests fail the same way. The excluded-state and material-switch tests pass on base: they are preservation guards. |
| H | 1 | 2 failed / 14 passed. The two `useCardReview` integration tests fail (no clock render; no timer). The 14 direct tests of the new module pass because that module exists only in the new code. |

### Disposable mutants (same copy, final `useCardReview.ts`)

| Mutant of `useCardReviewClock.ts` | H | R |
| --- | --- | --- |
| None (final) | 16 passed | 8 passed |
| `addEventListener` lines removed | 5 failed | 2 failed |
| Early-fire 1 s floor removed | 2 failed | 8 passed |
| Suspended/flagged filter removed | 2 failed | 8 passed |
| `active` guards removed | 16 passed | 8 passed |

The `active` guard is not observable. Cleanup already clears the timer and removes both listeners, so no callback can run after cleanup. The guard is kept as defense in depth.

### Test-drafting failures (test mistakes, not product findings)

- **H run 1:** 1 of 16 failed. The early-fire test set drift to exactly −1 s, which made the second firing land precisely on the instant (correctly due). The fix was a drift of −1,001 ms.
- **R run 1:** 2 of 8 failed:
  - One test expected a countdown label at due − 1 ms. Countdowns are not required; the label correctly stays "in 9 minutes".
  - The unknown-write test wrapped the already-spied writer, which caused recursion.
- **R runs 2–4:**
  - "Card 2 of 3" needed a prefix match because of " · new".
  - The expected summary is "2 new cards · …" because card 2's rating was unconfirmed.
  - The test's own stored-row reads had been counted as panel reads.

### Reused, not re-run

Native/Rust, migrations and checksums, lockfile, `cargo` checks and the full `npm test` matrix were not re-run. Nothing native, schema, dependency or lock-related changed, so those areas rely on the receipts recorded for `main` at `42077cc` (PR160). This report makes no new claim for them. No cloud CI was polled.

## Limitations and deferred gates

- **Again only.** The wakeup covers sub-day Again instants for the open material. Day-ladder cards that cross local midnight while the material stays open get no dedicated timer. They do update on the next render, including any focus or return to a visible window, because the hook bumps the counter on resume. Library-wide continuous sub-day discovery in Review due remains separate, as stated in the PR160 report.
- **No countdown.** The "in N minutes" label refreshes only on clock renders (due instants, focus, visibility) and ordinary renders. It does not tick every minute.
- **Clock moved forward while focused and visible.** If the clock moves forward with no focus or visibility event, the change is picked up when the existing timer fires at its original delay. No polling was added, by design.
- **Event delivery.** Focus and `visibilitychange` delivery was proven in jsdom only. Behavior in the installed macOS/Windows webviews across sleep and wake is **unverified**; no installed app was run.
- **Not done here:** no real profile, app data, installed-app test, provider or network call, commit, push, merge, signing, version change, release or monitoring. G1–G3 and installed/release gates stay deferred. M4 stays separately owned and gated.
