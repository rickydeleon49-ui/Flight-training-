# MAINT-143-TZ verification — 12 October 2026

**Status: corrected, pending independent review.** Test-only change. It is uncommitted and unpushed. MAINT-143-KEYS, schema14 integration, M4 (R28–R32) and installed/signing/release gates are unchanged and out of scope.

## Base and ownership

- Base: `3d27ef3a8ef5131895455bd2346b4f7e0ce20239` (PR #148 on top of #149–#151). Branch: `agents/task-20261012-210510-179657`, an isolated worktree. The only untracked entry was `node_modules` (prepared infrastructure).
- This isolated repository has no `origin` remote (`git fetch origin` → "'origin' does not appear to be a git repository"; `git remote -v` is empty), and local `main` is the older `8a260c0`. The base is the commit the orchestrator provided.
- Fresh upstream `main` was then checked read-only via the GitHub API: `gh api repos/rickydeleon49-ui/Flight-training-/commits/main` returned `3d27ef3a8ef5131895455bd2346b4f7e0ce20239` (committed 2026-10-13T04:02:08Z, "docs: review Gemini's M4 round-2 corrections and assign round 3 (#148)"), exit 0. That matches this worktree's `HEAD`, so the base is current `main`.
- `gh pr list --state open` (with and without `--search "MAINT-143"`) returned `[]`, exit 0: no open PR claims the task.
- Ownership: ROADMAP.md and `docs/MERGED_PR_DATE_METADATA_FIXES_PROMPT_2026-10-12.md` list MAINT-143-TZ as "queued / pending implementation" with no owner. No other doc claims it. The schema14 preparation prompt covers only the metadata-key item.
- Environment: Node v26.10.0, macOS. Every vitest invocation used `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache <paths>`.

## Original defect, measured before editing

| Command | Result | Exit |
| --- | --- | --- |
| `TZ=Pacific/Kiritimati … src/lib/dates.test.ts` | 3 failed / 4 passed (7) — expected `2026-10-03`, got `2026-10-04`; `Saturday, October 3` vs `Sunday, October 4` | 1 |
| `TZ=Pacific/Kiritimati … src/pages/StudyLibrary/PracticeHistoryDates.test.ts` | 1 failed / 2 passed (3) — `Completed Sunday, October 4` vs `/^Completed Saturday, October 3/` | 1 |

These counts match the audit's Node 22.23.3 counts; they were re-measured here on Node 26.10.0.

There was also a hygiene defect in the existing Notes hook. With `TZ` unset, the original `src/logic/notes.test.ts` left `process.env.TZ === "undefined"` (a string) after its `afterAll`. A temporary probe asserting "absent" failed with `expected 'set:undefined' to be 'absent'`, exit 1.

## Changes (3 test files; no production, config or global-setup change)

- `src/lib/dates.test.ts`: an `inTimeZone(zone)` hook sets TZ per describe block. Its `afterAll` restores the original value, or deletes `TZ` when it was originally absent. Literal outcomes:
  - **UTC:** the existing format cases give `2026-10-03`.
  - **Pacific/Kiritimati:** `…T12:00:00.000Z`, SQLite `2026-10-03 12:00:00` and `…T10:00:00Z` give `2026-10-04`; `…T09:59:59Z` gives `2026-10-03`.
  - **America/Los_Angeles:** `…T04:30:00.000Z`, SQLite `2026-10-03 04:30:00` and `…T06:59:59Z` give `2026-10-02`; `…T07:00:00Z` gives `2026-10-03`.
  - **All three zones:** bare days pass through unchanged and the 11 malformed inputs are refused (UTC, Kiritimati, Los Angeles).
  - **`formatLongDate`:** `Saturday, October 3` in UTC and `Sunday, October 4` in Kiritimati.
  - The old `todayIso(new Date(late))` self-referential assertion is gone.
- `src/pages/StudyLibrary/PracticeHistoryDates.test.ts`: the same `inTimeZone` hook. `Date` is faked at `2026-10-11T12:00:00Z` (only `Date`; timers stay real) and restored in `afterAll`, so no year suffix depends on the real clock. Literal expectations are checked on the group list, record attempts and attempt review, using real repositories over disposable node:sqlite:
  - **UTC:** ISO and SQLite timestamps show `Completed Saturday, October 3`; malformed shows `Completed`.
  - **Kiritimati:** ISO `…T12:00Z` and SQLite `2026-10-03 10:00:00` show `Completed Sunday, October 4`.
  - **Los Angeles:** ISO and SQLite `04:30` show `Completed Friday, October 2`; malformed shows `Completed`.

  The matcher is anchored (`^<text>(?: •|$)`), so a different day, an added year or a dated "Completed" line fails the malformed case. Every view still asserts there is no `undefined`/`NaN`.
- `src/logic/notes.test.ts`: the `afterAll` deletes `TZ` when it was originally absent, instead of assigning `undefined`.

## Verification after the change

The five required suites are the three changed files plus `src/logic/localDay.test.ts` and `src/state/useLocalToday.test.ts`. (An earlier run of this report substituted `PracticeSessionPR2Finish.test.ts` for `localDay.test.ts`; that matrix has been superseded by the one below.)

Command, with `<Z>` set to each zone:
`TZ=<Z> node node_modules/vitest/vitest.mjs run src/lib/dates.test.ts src/pages/StudyLibrary/PracticeHistoryDates.test.ts src/logic/notes.test.ts src/logic/localDay.test.ts src/state/useLocalToday.test.ts --configLoader runner --no-cache`

| Zone | Node 26.10.0 | Node 22.23.3 (`/opt/homebrew/opt/node@22/bin/node`) | Exit |
| --- | --- | --- | --- |
| `TZ=UTC` | 5 files, 43/43 passed | 5 files, 43/43 passed | 0 / 0 |
| `TZ=America/Los_Angeles` | 5 files, 43/43 passed | 5 files, 43/43 passed | 0 / 0 |
| `TZ=Pacific/Kiritimati` | 5 files, 43/43 passed | 5 files, 43/43 passed | 0 / 0 |

| Command | Exit |
| --- | --- |
| `npm run typecheck` | 0 |
| `git diff --check` | 0 |

Restoration check (disposable; the probes were appended temporarily and the files restored byte-for-byte). A file-level `afterAll` asserted the final TZ state in all three changed suites. Results: `env -u TZ` (expect absent) gave 33 passed, exit 0; `TZ=Europe/Berlin` (expect `set:Europe/Berlin`) gave 33 passed, exit 0.

## Regression sensitivity

`localDayOf` in `src/lib/dates.ts` was temporarily reverted so that it returned the UTC calendar day (`parsed.toISOString().slice(0, 10)` in place of `todayIso(parsed)`). The three changed suites then failed **10 / 33, exit 1, identically under UTC, Los Angeles and Kiritimati**:

- 3 date helper cases: Kiritimati following day, Los Angeles previous day, Kiritimati `formatLongDate`.
- 4 rendered history cases: Kiritimati ISO/SQLite and Los Angeles ISO/SQLite.
- 3 Notes cases.

The source was then restored (`git diff --quiet src/lib/dates.ts` confirmed it), and the affected suites were rerun and passed (table above).

## Pre-existing failures outside scope (not changed)

- `src/pages/StudyLibrary/PracticeSessionPR2.test.ts` (10/10 failed, exit 1) and `src/pages/StudyLibrary/StudyLibraryReviews.test.ts` (16/16 failed, exit 1) also fail on an untouched export of the base in the default zone. The first fails with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()`, consistent with Node 26's global `localStorage` shadowing jsdom's. These failures are unrelated to time zones and are not in the allowed paths.
- `src/state/useLocalToday.test.ts` has the same `process.env.TZ = originalTz` restore pattern that the Notes hook had. It is outside the allowed paths and is left for a follow-up.
