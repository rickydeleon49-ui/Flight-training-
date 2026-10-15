# M2 Review due clock recovery — 14 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** One bounded M2 increment by Claude (`claude-opus-5-5`, medium). The work is uncommitted and unpushed in an isolated worktree.

Review due now follows the computer's current local day after sleep, a time-zone change or clock movement. Scheduling rules, persistence, migrations, dependencies, identity and version are unchanged.

## Source identity (recorded before editing)

| Item | Value |
| --- | --- |
| Isolated worktree | `outputs/flight-deck-team/runs/20261014-213744-674483/worktree` (Git worktree of the run's `isolated-repo` clone) |
| Branch | `agents/task-20261014-213744-674483` |
| HEAD / base | `e87874b4c78f06e97cb00200c0553f1c8900c11d` |
| Status before editing | clean except untracked prepared `node_modules` |
| `src/pages/StudyLibrary/useLibraryReviews.ts` before | `0c4dadf16381f4960cf73e5cb05366a74c60f14d1af3be9e199131d649ee2e59` |
| `src/pages/StudyLibrary/useLibraryReviews.ts` after | `a4656e4b7df64a26781a9317ae594e4dd0edd3fe7b59f63b034d4f3ac63f953b` |
| `src/pages/StudyLibrary/useLibraryReviewsClock.test.ts` (new) | `e495a712636984cd1e566ca206ec2f593e8fef1ee27e6b1a0f093f6f0e8dedc4` |
| `src/pages/StudyLibrary/ReviewDueClockRecovery.test.ts` (new) | `c545306e83300e4783a824bd2fa6d6f7338984f31fad21b667bb921527d49587` |

**Ownership.** The controller queue has exactly one job for this work: `6d5fca12ebf7`, "M2: Recover Review due after local-day and time-zone changes", status `running`. That is this assignment. No other queued, running or ready-for-review job lists `useLibraryReviews.ts` or covers due-stream clock recovery. The MAINT-143-TZ jobs (`68710f10a75f`, `924821d82380`) change date *tests* only.

**Preservation.** No accepted but unmerged patch was imported. The primary checkout, including its dirty `ROADMAP.md` and its unique schema14 continuation document, and every other run directory were only read.

## Historical status reconciliation

- **Integrated on `main`:** PR159 (Study Library scenario isolation, `e87874b`), PR157 (focused missed/skipped review), PR155 (content provenance), PR154 (source-map-js). The "IMPLEMENTED, PENDING INDEPENDENT REVIEW" labels on their dated handoff entries are snapshots and do not reopen them. M3 production is integrated.
- **Accepted but unmerged; preserved and excluded here:** keyboard guards `f163efd3f8f1`, schema-14 parity isolation `d8ff795089fc`, schema14 verification preparation, MAINT-143-KEYS, timezone PR152 and the REL-03 packages.
- **M4** remains separately owned, evidence-only and gated.

## The gap

`useLibraryDueStream` captured `nowUtc` and `nextLocalMidnightUtc` once, then relied on a single timer:

- It had no focus or visibility handling. After a zone change, a mounted Review due view kept the old zone's day boundary. A card could stay hidden after it became due, or stay listed after it stopped being due, until the timer fired or she pressed Check again.
- The timer always bumped a `day` counter, even when the boundary was unchanged, which caused a redundant read. If the boundary was unchanged, the re-arming effect did not re-run, so **no timer remained**.

## Change (`useLibraryReviews.ts` only)

One effect owns the local-day check. `reconcile()`:

1. Captures a fresh clock with the latest filters (`captureClock()`, which uses `currentTimeZone()` now).
2. Compares the captured `nextLocalMidnightUtc` with the active stream's boundary.
3. If the boundary differs, calls `stream.invalidate(fresh options)` and reads page one. Invalidation starts a new generation and clears rows, issues, cursor, summaries and the failed-read descriptor.
4. In every case, clears the previous timer and arms one new timer from the captured clock, at the boundary plus 1 s. The clamp is unchanged (at least 1 s, at most about 24.8 days).

`reconcile()` runs on mount, from the timer, on `window` `focus`, and on `document` `visibilitychange` unless the document is hidden. These are ordinary browser events, the same pattern as `useLocalToday`; there is no native listener, polling or dependency. The comparison runs against the stream's live snapshot, so a second paired event already sees the new boundary and does nothing.

The `day` counter was removed from the invalidation key. Filters, the data revision, Check again, Retry, StrictMode ownership and the History stream are unchanged. The binder's own due stream in `StudyLibrary.tsx` uses the same hook and inherits the recovery.

### Exact production diff

```diff
@@ -74,19 +74,40 @@ export function useLibraryDueStream(
   const [stream] = useState(() =>
     createDueStream((input) => repository.readReviewDue(input), { ...captureClock(), ...filters, limit }),
   );
-  const [day, setDay] = useState(0);
   const state = useStreamState(stream);
-  useOwnedStream(
-    stream,
-    JSON.stringify([filters.statusFilter, filters.topic, dataRevision, day]),
-    () => ({ ...captureClock(), ...filters, limit }),
-  );
-  // Crossing local midnight changes what is due: start over with a new clock.
+  const options = () => ({ ...captureClock(), ...filters, limit });
+  const latestOptions = useRef(options);
+  latestOptions.current = options;
+  useOwnedStream(stream, JSON.stringify([filters.statusFilter, filters.topic, dataRevision]), options);
+  // What is due ends at the next local midnight of the zone the computer is
+  // in now. A timer aims at that midnight, but timers stall during sleep and
+  // the zone can change, so focus and a return to a visible window check
+  // again. Only a different boundary starts over, with a new clock and the
+  // current filters; otherwise loaded pages and a failed read are kept.
   useEffect(() => {
-    const wait = Date.parse(state.options.nextLocalMidnightUtc) - Date.now();
-    const timer = setTimeout(() => setDay((d) => d + 1), Math.max(1_000, Math.min(wait + 1_000, 2_147_000_000)));
-    return () => clearTimeout(timer);
-  }, [state.options.nextLocalMidnightUtc]);
+    let timer: ReturnType<typeof setTimeout> | undefined;
+    const reconcile = () => {
+      const next = latestOptions.current();
+      if (next.nextLocalMidnightUtc !== stream.getSnapshot().options.nextLocalMidnightUtc) {
+        stream.invalidate(next);
+        void stream.loadNextPage();
+      }
+      clearTimeout(timer);
+      const wait = Date.parse(next.nextLocalMidnightUtc) - Date.parse(next.nowUtc);
+      timer = setTimeout(reconcile, Math.max(1_000, Math.min(wait + 1_000, 2_147_000_000)));
+    };
+    const onResume = () => {
+      if (document.visibilityState !== "hidden") reconcile();
+    };
+    reconcile();
+    window.addEventListener("focus", onResume);
+    document.addEventListener("visibilitychange", onResume);
+    return () => {
+      clearTimeout(timer);
+      window.removeEventListener("focus", onResume);
+      document.removeEventListener("visibilitychange", onResume);
+    };
+  }, [stream]);
```

## Tests

**`useLibraryReviewsClock.test.ts` (21 tests).** Uses `renderHook`, fake `setTimeout`/`clearTimeout`/`Date`, an injected zone and an in-memory reader whose reads the test resolves or rejects. There are no real waits. It covers:

- **Recovery:** focus recovery (page one, `cursor: null`, fresh clock, latest status and topic, new generation); visible-state recovery in the other direction.
- **Unchanged boundary:** focus and visibility keep the identical state object, including two loaded pages, the cursor and the failed read, with zero reads. Retry still repeats the failed read exactly.
- **Events:** hidden-only notifications start no read; paired focus and visibility events produce one read, whether dispatched in the same turn or one after the other.
- **Timer:** ordinary rollover at 23:59 → 00:00:01, re-armed for 24 h with no loop; a late timer after sleep; focus after sleep replacing the stale timer; backward day movement; a timer that fires on the same earlier day (no read, still armed); exact 23-hour (8 March 2026) and 25-hour (1 November 2026) Chicago days.
- **Obsolete reads:** an old success arriving before or after the recovery read; an old failure before or after, which does not release the newer lock; recovery from an old failed page-2 read; a filter change during recovery, and recovery after a filter change.
- **Existing behavior:** Check again.
- **Ownership:** unmount removes both listeners and the timer; StrictMode leaves exactly one focus listener and one timer, and one event produces one read.

**`ReviewDueClockRecovery.test.ts` (5 tests).** Uses the real `StudyLibrary`, router and `AppDataProvider` with disposable node:sqlite. Two saved cards are rated through the real repository:

- "Weather basics" is rated Good at 08:00Z on 6 October, so it is due at 08:00Z on 7 October. That is after Chicago's day ends (05:00Z) and before Kiritimati's (10:00Z).
- "Airspace" is rated Easy and is due in 3 days in every zone.

The fake clock affects `Date` only. Fetch is stubbed to reject, and Gemini must not be called. The tests cover:

- **Moving east, recovered on focus:** "All caught up!" disappears and the list shows Weather basics, "1 card due today". The summary reads "2 materials and 2 cards". The read uses the Kiritimati boundary, the chosen "Due today" filter and `cursor: null`. Stored state, events and material rows are byte-equal before and after.
- **Moving west, recovered on becoming visible:** hiding alone reads nothing. Returning to visible removes the list and shows "All caught up!", and stored rows are unchanged.
- **Same local day:** focus and visibility keep the same list element and make zero extra due reads.
- **Held read:** a read held from the old zone and released after recovery cannot bring back its list.
- **After leaving the tab:** focus and visibility in a new zone make no due-tab read.

## Verification

All checks ran on Node **v22.23.3** (`/opt/homebrew/opt/node@22/bin`); the default shell Node is 26.10.0 and was not used. Vitest is the locked 4.1.11. Every test file ran on its own with `npx vitest run <file> --configLoader runner --no-cache`. Budgets and runner configuration are unchanged.

### Baseline against unchanged production source (before implementation)

| Run | Test bytes | Hook suite | Rendered suite |
| --- | --- | --- | --- |
| 1 | first draft | exit 1, 15 failed / 6 passed | exit 1, 5 failed / 0 passed |
| 2 | Kiritimati constant and `afterEach` order fixed | exit 1, 15 failed / 6 passed | exit 1, 3 failed / 2 passed |
| 3 | delayed-timer expectation fixed | exit 1, 14 failed / 7 passed | not re-run |

**Failed attempts (test mistakes, not product findings):**

- **Run 1:** the expected Kiritimati day end was wrong; it is `2026-10-07T10:00Z`. The rendered `afterEach` also checked a Gemini spy after `restoreAllMocks`.
- **Run 2:** the delayed-timer test assumed `setSystemTime` would make the pending timer fire at the new time. In fact the timer fires 14 h 1 s later, so the expectation was rewritten with explicit instants.
- **First run with the correction:** the rendered suite failed 1 of 5 because the remembered "Due today" filter leaked through `sessionStorage`. Clearing `sessionStorage` in `beforeEach` fixed it.

**Real baseline symptoms:**

- Focus or visibility after a zone or clock change starts no read: one call where two were expected.
- The rendered list never appears after moving east, and "All caught up!" never appears after moving west.
- A timer firing on an unchanged day makes a redundant read: two calls where one was expected.
- No focus listener is registered.

The 7 hook tests and 2 rendered tests that pass on the baseline are preservation guards: unchanged-boundary behavior, rollover, the late timer, the 23- and 25-hour days, Check again, unmount, the same-day render, and leaving the tab.

### Disposable diagnostic (final test bytes)

The diagnostic used a temporary copy outside the worktree (`/tmp/clockdiag.Ivxs`, `node_modules` symlinked, deleted afterwards). The worktree bytes were never altered.

| Production variant | Hook suite | Rendered suite |
| --- | --- | --- |
| `useLibraryReviews.ts` = `HEAD` (`0c4dadf1…`), correction removed | exit 1, 14 failed / 7 passed | exit 1, 3 failed / 2 passed; key "moving east … All caught up disappears" fails |
| Final code without the two `addEventListener` lines | exit 1, 13 failed / 8 passed | exit 1, 3 failed / 2 passed |
| Final code that always invalidates (no boundary comparison) | exit 1, 18 failed / 3 passed | exit 1, 5 failed / 0 passed |

### Final bytes (hashes above), sequential

| Command | Exit | Result | Vitest duration |
| --- | --- | --- | --- |
| `npx vitest run src/pages/StudyLibrary/useLibraryReviewsClock.test.ts --configLoader runner --no-cache` | 0 | 21 passed | 437 ms |
| `npx vitest run src/pages/StudyLibrary/ReviewDueClockRecovery.test.ts --configLoader runner --no-cache` | 0 | 5 passed | 947 ms |
| `npx vitest run src/pages/StudyLibrary/StudyLibraryReviews.test.ts --configLoader runner --no-cache` | 0 | 16 passed | 1.69 s |
| `npx vitest run src/pages/StudyLibrary/deferredReviewRead.test.ts --configLoader runner --no-cache` | 0 | 10 passed | 965 ms |
| `npx vitest run src/logic/localDay.test.ts --configLoader runner --no-cache` | 0 | 5 passed | 104 ms |
| `npx vitest run src/pages/StudyLibrary/StudyLibrary.test.ts --configLoader runner --no-cache` (extra: binder caller) | 0 | 2 passed | 1.02 s |
| `npm run typecheck` | 0 | clean | 4 s wall |
| `npm run build` | 0 | built | 4 s wall |
| `git diff --check` | 0 | clean (the new untracked files were also checked: no trailing whitespace) | — |

`StudyLibraryReviews.test.ts` carries the existing Retry, StrictMode, filter, data-revision and History regressions.

**Reused, not re-run:** native/Rust, migration, lockfile and the full `npm test` matrix. Nothing native, schema, dependency or lock-related changed. Those areas rely on the checks recorded for `main` at `e87874b` (PR159). This report makes no new claim for them.

## Limitations and deferred gates

- **Out of scope:** recovery is for the local-day boundary only. Continuous sub-day relearning refresh (an Again card becoming due 10 minutes later while the view stays open, with no boundary change) is separate. So is material-level session behavior.
- **Event delivery:** focus and `visibilitychange` delivery was proven in jsdom only. Installed-app behavior in the macOS/Windows webviews across sleep, wake and zone change is **unverified**; no installed app was run.
- **Recovery triggers:** a zone change while the window keeps focus and stays visible is picked up at the next timer, focus or visibility event, or Check again. No polling was added, by design.
- **Not done here:** no real profile, installed-app test, provider or network call, commit, push, merge, signing, release or monitoring. G1–G3 and v0.5.4 installed/release gates stay deferred. M4 stays separately owned and gated.
