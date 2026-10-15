# Study Library scenario test isolation — 14 October 2026

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** Test-only M2 maintenance increment by Claude. Uncommitted and unpushed in an isolated worktree.

This change isolates scenarios for diagnosis and organizes the tests. It does **not** claim to cure timeouts under arbitrary machine load. Production source, the shared harness, the fixture, runner settings and budgets are unchanged.

## Source identity (recorded before editing)

| Item | Value |
| --- | --- |
| Isolated worktree | `outputs/flight-deck-team/runs/20261014-205928-767206/worktree` |
| Branch | `agents/task-20261014-205928-767206` |
| HEAD / base | `cb0ece14239e4bacbd845642329ba47e98fe1d13` |
| Status before editing | clean except untracked prepared `node_modules` |
| `src/perf/studyLibraryScenarios.test.ts` before | `7d77d92cb1e107167bcda8d3c6d4e108846bb736019e5f21c621b790f7090acb` (matches assignment) |
| `src/perf/studyLibraryHarness.ts` (protected) | `2af0e3afb8da4d0da001b3dbfaf62e2d7b2412276085f5471e6b61f5a3626598`, unchanged |
| `src/perf/studyLibraryFixture.ts` (protected) | `93b834e5a27dc72489c1990e9cfcab362225470d73a7dfcf8ae398e270ae17d8`, unchanged |
| `src/perf/studyLibraryScenarios.test.ts` after | `ad3e0174823a86e86d859f8dffab698bf15642aa9acc871ae33cdc9f70acb8e5` |

No accepted but unmerged patch was imported. The primary checkout and all existing run directories were only read.

## Historical baseline evidence (inspected, not reproduced)

Both receipts are in `runs/20261014-004448-779238`. Each one ran the **full** suite (`npm test` → `vitest run --configLoader runner --no-cache --maxWorkers 2`), not the focused file. Both ran in `runs/20261013-224533-397661/worktree`, which is at base `cb0ece1` with the separately owned keyboard-guard package left uncommitted (`CardReviewPanel.*`, a report and the handoff). That worktree's three `src/perf` files currently match the hashes above. Its `src/perf` paths are not dirty, and the failing source locations (lines 100 and 126) match this file. The `.process.json` receipts record pid, finish time and exit code only. They do not record the Node version.

- `check-4-1.log`: exit 1, 2219.47 s, 5 failed / 3061 passed / 6 skipped. The expanded-display test timed out at 60000 ms (`studyLibraryScenarios.test.ts:126:3`, log lines 1819–1822). It ran for 217624 ms of a file total of 232690 ms. The ordinary all-scenario test passed in 12145 ms. Separate 5000 ms timeouts hit sql.js/editor-safety tests, and a forks worker failed to start (`Timeout waiting for worker to respond`).
- `check-11-1.log`: exit 1, 3095.09 s, 6 failed / 3070 passed / 6 skipped. The ordinary test timed out at 30000 ms (line 100, after 994619 ms of wall time), and so did the expanded test at 60000 ms (line 126, 86147 ms). Four other files hit 5000 ms timeouts, and a worker failed to start for `m1Workflow.acceptance.test.ts`. That points to a broadly stalled machine or worker pool, not a defect in one scenario.

These runs show that one combined test can hide which scenario stalled. They do not show that any single scenario is slow on an idle machine.

## Unchanged focused baseline (run once, before editing)

`PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run src/perf/studyLibraryScenarios.test.ts --configLoader runner --no-cache` on Node v22.23.3 / npm 10.9.9 gave **exit 0, 1 file, 11 passed, Duration 42.68 s** (44 s wall).

**The historical timeout did not reproduce.** No load was manufactured. The default reporter does not print per-test durations, so this baseline has no per-test timing. The default `node` on PATH is v26.10.0, which was not used.

## What changed (`src/perf/studyLibraryScenarios.test.ts` only)

- **One named test per scenario.** Each of the 16 ordinary scenarios, `<name>: lists exactly the answer key's ids and order on the real page`, mounts a fresh real Study Library over `fixtureLibrary(240)`. The two expanded scenarios are `showMoreExpandTo1000: …` and `queryWhileExpanded: …`. Each mounts `fixtureLibrary(1_000)` and runs alone. Every run uses the existing `runLibraryScenarios` `only: [name]` selector. Tests stay sequential, in declaration order. No fixture work happens in shared hooks.
- **Independent state.** Each test gets a new disposable Node SQLite database, React tree and Router. The existing `afterEach` does the cleanup (unmount, close database, clear context, clear `sessionStorage`). `mountLibrary` now *asserts* a clean start (no database, no context, empty `document.body`, empty `sessionStorage`) before mounting.
- **Retained checks.** The harness still checks controls, exact shown ids/order and counts after reset, after setup and after every measured step. Each scenario test also asserts:
  - the result map is exactly `[name]` and the result was not skipped
  - the step count equals the scenario's measured steps
  - `wallMs.n` and `computeMs.n` are 1 for every step. This was previously asserted only for `narrowingQueryTyped`; it now holds for every scenario.
- **Retained spot checks.**
  - `matchingQueryPasted` gives 24.
  - `noMatchQuery` gives 0.
  - `filtersAndSortTogether` gives more than 1.
  - `showMoreProgressive` shows 200.
  - `narrowingQueryTyped`: every typed prefix of "airspace class b" is its own step, ending at 6.
  - The expansion counts are `[200,300,400,500,600,700,800,900,1000]`.
  - `queryWhileExpanded` ends at `{ resultCount: 100, shownCount: 100 }`.
- **Coverage accounting.** New tests cover:
  - `assigns every scenario to exactly one named test`: an explicit `ORDINARY` + `EXPANDED` assignment against `SCENARIOS`. It reports a scenario with no test, duplicate scenario names, a scenario assigned twice, an unknown name, and spot checks keyed to unassigned names.
  - `coverage accounting reports omitted, duplicated and unfinished scenarios`: permanent pure negative controls of the accounting functions.
  - `skips both expanded-state scenarios at the 240-material tier`: keeps the evidence that both are ineligible at 240, with the exact `needs at least 1000 materials` result.
  - `finished every scenario exactly once, in assigned order`: each scenario test records its name only after all its checks pass. This test reports any scenario that was omitted, skipped at test level, failed, or finished twice.
- **Unchanged.** The three negative controls (wrong answer key, wrong intermediate id, wrong intermediate count), the three fixture tests and the three seeding/rollback/reopen/transaction-refusal tests are textually unchanged.
- **Budgets.** Ordinary tests keep 30000 ms each, and expanded tests keep 60000 ms each. There are no retries, skips, runner, setting or fixture-size changes.

Resulting coverage: **18/18 `SCENARIOS` entries**, each with exactly one named execution (16 at 240 materials, 2 at 1,000). The file goes from 11 to 31 tests.

## Disposable negative-control diagnostics

These ran on Node v22.23.3 in a throwaway copy, `/tmp/sl-iso/diag`: an rsync of this worktree without `.git`/`node_modules`/`target`, with a `node_modules` symlink. A script applied one mutation at a time to that copy's test file. Each command was `npx vitest run src/perf/studyLibraryScenarios.test.ts --configLoader runner --no-cache --reporter=verbose`. The copy was restored after the series and then deleted. **This worktree's file was never mutated.**

| Mutation | Exit | Result |
| --- | --- | --- |
| Omit `tagQuery` from `ORDINARY` | 1 | 3 failed / 27 passed (30). Assignment: `not assigned to a test: tagQuery`. Completion: `did not finish: tagQuery`. The pure control also fails because it is built on the live list. |
| List `noMatchQuery` twice | 1 | 3 failed / 29 passed (32). `assigned to more than one test: noMatchQuery`; `finished more than once: noMatchQuery` |
| `it.skipIf(name === "tagQuery")` | 1 | 1 failed / 29 passed / 1 skipped (31). Completion: `did not finish: tagQuery` |
| Corrupt first card id at intermediate step `airspace c` inside the ordinary `narrowingQueryTyped` test | 1 | 2 failed. `narrowingQueryTyped step 9 (query "airspace c"): shown ids/order differ … (page wrong-intermediate-id, expected m-10…)`, then completion `did not finish: narrowingQueryTyped` |
| Corrupt result count to 999 at `airspace c` in the same test | 1 | 2 failed. `step 9 (query "airspace c"): page reports 999 results, answer key expects 24.`, then completion failure |
| Make the retained intermediate-id control's injection unreachable | 1 | 1 failed. That control reports `promise resolved … instead of rejecting`, so it is not vacuous |

## Final verification (Node v22.23.3, npm 10.9.9, sequential)

| Command | Exit | Result |
| --- | --- | --- |
| `npx vitest run src/perf/studyLibraryScenarios.test.ts --configLoader runner --no-cache` (development run, `--reporter=verbose`) | 0 | 31 passed, Duration 46.85 s. Per test: ordinary 0.62–2.63 s; `showMoreExpandTo1000` 14.11 s; `queryWhileExpanded` 10.41 s; ineligibility check 0.68 s |
| Same command, default reporter, final source `ad3e0174…` | 0 | 1 file, 31 passed, Duration 34.31 s (35 s wall) |
| `npm run typecheck` | 0 | `tsc --noEmit`, 6 s |
| `git diff --check`, plus a trailing-whitespace scan of this untracked report | 0 / none | Run after the documentation edits |
| `shasum -a 256 src/perf/*.ts` | 0 | Harness `2af0e3af…`, fixture `93b834e5…` unchanged; test `ad3e0174…` |
| `git status` / `git diff --stat` | 0 | Only the three scoped paths, plus untracked prepared `node_modules`. Handoff: 15 lines added, 0 removed. HEAD is still `cb0ece1` |

No full frontend/native matrix was run. The change is test-only in one file, so evidence for unchanged areas is reused, not re-collected.

## Limitations and honest scope

- **Aggregate time limit.** Per-test budgets are unchanged, but splitting the work means the ordinary scenarios together may now use up to 16 × 30 s, where the old combined test allowed 30 s in total. A uniformly slow page is therefore less likely to trip a timeout. Each test still has its own unchanged limit. The verbose timings above are the reference for spotting regressions.
- **Load timeouts not cured.** Isolation makes a stall name its scenario and stops one stall from consuming every other scenario's budget. It does not make the suite immune to a stalled machine or worker pool like the one in `check-11-1.log`.
- **More setup work.** Each scenario now seeds and mounts its own library. The file now mounts 20 times at 240 materials and twice at 1,000, where it used to mount 4 times at 240 and once at 1,000 (both counts include the three negative controls). That adds setup work, but the suite still measured faster than the baseline here (34–47 s vs 42.68 s). This is a single idle-machine sample, not a performance claim.
- **Accounting depends on the full file running.** When a run filters by name (`-t`), the final accounting test may run on a partial set and fail. That is the conservative direction.
- **Unverified.** The historical failures were not reproduced, and no installed, WebView or release behavior is claimed.

## Roadmap reconciliation (unchanged by this task)

- M3 production is integrated. Dated "pending" snapshots in older entries are historical.
- PR #154, #155 and #157 are merged (`017c1c6`, `c9a15ab`, `cb0ece1`).
- M4 remains separately owned and gated. None of its work was touched.
- The schema14 parity package (job `d8ff795089fc`, `runs/20261014-120527-634447`) is independently accepted but unmerged. It was not imported.
- These packages are preserved and untouched: keyboard `f163efd3f8f1`, schema14, MAINT-143-KEYS, timezone PR152 and REL-03.

## Files

- `src/perf/studyLibraryScenarios.test.ts` (modified)
- `docs/STUDY_LIBRARY_SCENARIO_ISOLATION_REPORT_2026-10-14.md` (new)
- `docs/PROJECT_HANDOFF.md` (one entry added at the top; history preserved)

No commit, push, merge, dependency, native, schema, migration, production or installed-app change.
