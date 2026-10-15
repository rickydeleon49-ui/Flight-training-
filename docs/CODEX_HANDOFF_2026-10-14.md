# Handoff to Codex — Claude's work on 14 October 2026

Claude (`claude-opus-5-5`) did all of this. Following `docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md`, **nothing is committed, pushed or merged**. Each change set sits uncommitted in its own worktree for Codex to review, commit, open as a PR and merge.

- **Base:** every worktree branches from `42077ccd00b70ad406e30d236a34e0ab556745d5`, which is `main` after #160 and was still `origin/main` at handoff.
- **Node:** checks were run with Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`), the CI version. Node 26 breaks unrelated tests.
- **Not run:** the installed app, signing and releases.

## The three deliverables

### 1. Bug sweep: 9 defects fixed (code)

- **Worktree:** `/Users/rickymac/code/Flight-training-bug-sweep`
- **Branch:** `claude/bug-sweep-2026-10-14`
- **Report:** [`docs/BUG_SWEEP_REPORT_2026-10-14.md`](BUG_SWEEP_REPORT_2026-10-14.md)

| # | Defect on `main` | Main files |
|---|---|---|
| 1 | Backup status said "saved today" for last night's backup: it counted 24-hour periods, not calendar days. | `src/logic/dataSafety.ts` |
| 2 | The suggested backup file name used the UTC date, so evenings in the US got tomorrow's date. | `src/services/backups.ts` |
| 3 | The card-history dialog showed "05/10/2026", which reads as May 10 in the US. | `src/pages/StudyLibrary/StudyLibraryHistory.tsx` |
| 4 | The journal accepted parts of a flight longer than its total: dual > total, solo > total, dual + solo > total. Only edits that change a time are checked, so older entries aren't blocked in Quick debrief. | `src/logic/flightLog.ts`, `src/pages/FlightJournal/JournalForm.tsx` |
| 5 | The reminder-window preview didn't match what was saved, and corrupt stored values became `NaN` (invalid dates, `$NaN`). | `src/logic/toolkit.ts`, `src/pages/PilotToolkit/PilotToolkit.tsx` |
| 6 | A medical recorded in both Settings and the Toolkit with the same date appeared twice in reminders. | `src/logic/toolkit.ts` |
| 7 | Schedule costs accepted negative and zero amounts, which led to "Record -$150 as an expense". The repository now refuses them too. | `src/pages/Schedule/EventFormDialog.tsx`, `src/data/repositories/financeRepository.ts`, `src/pages/Schedule/EventDetail.tsx` |
| 8 | A cancelled past lesson offered to record its *estimate* as an expense. | `src/pages/Schedule/EventDetail.tsx` |
| 9 | Short dates never showed a year: "Expires Oct 20" for 2028, and last year's ledger rows had no year. | `src/lib/dates.ts` |

**Checks:**
- `npm test`: 3,141 passed, 6 skipped (main had 3,119).
- `npm run typecheck`, `npm run build` and `git diff --check` all exit 0.
- Every new regression test was run against unchanged `main` and failed for the expected reason.
- Two guards were also mutation-checked: removing either one makes its test fail.

### 2. M5 training cost analytics, first slice (code)

- **Worktree:** `/Users/rickymac/code/Flight-training-pr142-fixes`
- **Branch:** `claude/m5-training-cost-analytics`
- **Report:** `docs/M5_TRAINING_COST_ANALYTICS_REPORT_2026-10-14.md`, in that worktree

**What changed:**
- **Lesson counting:** a lesson paid with several expenses (instruction plus rental) now counts once, and "Paid lessons" and "Average lesson" share that definition.
- **Forecast fix:** the Pilot Toolkit forecast no longer spreads one-off costs (headset, medical, books) across every remaining hour. Before, it showed $475/hr in the test case; it now shows $200/hr.
- **New "Per flight hour" figure:** it pairs each lesson's cost with the time logged for that lesson and says how many lessons it covers.
- **Possible double counts:** these are pointed out to her, never dropped.
- **New "Spending by month" table:** six months.

**Checks:** 3,133 passed; typecheck, build and diff-check are clean. Its new tests fail on `main`. 5/5 logic mutants were caught. Browser-mode screenshots look right at desktop and 390 px widths.

### 3. M5 requirements scope proposal (docs only)

- **Worktree:** `/Users/rickymac/code/Flight-training-m5-requirements-scope`
- **Branch:** `claude/m5-requirements-scope`
- **File:** `docs/M5_REQUIREMENTS_SCOPE_PROPOSAL_2026-10-14.md`
- **Status:** PROPOSED.

**Contents:**
- Part 61 private pilot (single-engine land) requirements, from eCFR text read on 14 October 2026.
- An inventory of 22 requirements, with the data each one needs and the gaps.
- Three outcomes only: "Shown in your records", "Not yet", "Not enough information". It never gives an eligibility verdict.
- Owner decisions RQ-D1 to RQ-D7.
- **Do not implement it** until the owner decides and a CFI or equivalent reviews the rule data.

## Merge-order notes

- **Bug sweep + M5 cost slice:** both edit `src/logic/toolkit.ts` (+ its test) and `src/pages/PilotToolkit/PilotToolkit.tsx`, in different functions:
  - the sweep touches `normalizeToolkitState`, `buildReminders` and `ReminderTool`;
  - the M5 slice touches `trainingCostForecast` and `CostTool`.

  Expect a trivial textual merge. Run the toolkit tests after whichever lands second.
- **Bug sweep + PR #152 (MAINT-143-TZ):** both edit `src/lib/dates.test.ts`. The sweep only appends a new `formatShortDate` describe block at the end, so keep both.
- **Bug sweep, #9 and the M5 slice:** the new year suffix in `formatShortDate` also reaches the M5 Finances ledger rows. Nothing in the M5 tests depends on the old format.
- `node_modules` in the bug-sweep worktree is an untracked symlink to the M5 worktree's install. **Do not commit it.**

## Added to `ROADMAP.md` (in the bug-sweep branch)

The new section "Bug sweep follow-ups — 14 October 2026" holds what could not be finished:

- **SWEEP-1014-TIMES:** older journal entries may already hold impossible times. The owner should decide how to point them out before M5 requirements tracking relies on the totals.
- **SWEEP-1014-MEDICAL:** the medical date can be stored in two places that disagree. When the dates differ, both are shown, with no warning that they conflict.
- **SWEEP-1014-TZ-CI:** under CI's UTC, the backup file-date test passes on old code too. Run date suites under a set non-UTC zone as part of MAINT-143-TZ.
- **M5-COST-REFUNDS:** refunds and credits can't be recorded, which is a data-model decision. Cost per hour also counts only journal entries linked to a lesson.

## Other actions

- **Discarded stale drafts:** Claude's uncommitted M4 R2 REV1 prompt and SUPERSEDED banner in `/Users/rickymac/code/Flight-training-m3-implementation`. That worktree is clean again.
- **Screenshot helper task:** Claude spawned the screenshot-helper HashRouter/`--dark` fix as a separate task. It is now open as PR #162, `claude/screenshot-hash-routes-dark`.
- **Checked, not a defect:** the schema-13 snapshot helper's self-check fails because `main` now ships migration 14. ROADMAP says to preserve that historical "schema13 ceiling alarm".
- **Left alone (owned elsewhere):**
  - #161 (M2 readiness);
  - #153 (v0.5.4 local route);
  - #152 (timezone tests);
  - #158 (review docs);
  - M4 round-4 corrections;
  - schema-14 preparation and MAINT-143-KEYS.
- **Still open:** two Dependabot alerts on `main` (1 high, 1 moderate), not investigated in this session.

## Waiting on the owner

- RQ-D1 to RQ-D7 (M5 requirements).
- Network and provider approval for WX-01 and FAA-01.
- How refunds are recorded.
- How to surface older impossible journal times.
- Which source the medical date comes from.
