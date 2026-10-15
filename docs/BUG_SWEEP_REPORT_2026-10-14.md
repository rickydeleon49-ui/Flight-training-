# Bug sweep — implementation report (14 October 2026)

**Integration note:** the implementation snapshot below is historical. The [independent consolidation review](CLAUDE_WORK_CONSOLIDATION_REVIEW_2026-10-14.md) records the later corrections, final test counts and acceptance boundary. Original hashes/counts below describe the submitted version.

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** Claude (`claude-opus-5-5`). Uncommitted in the isolated worktree `/Users/rickymac/code/Flight-training-bug-sweep`, branch `claude/bug-sweep-2026-10-14`, base `42077ccd00b70ad406e30d236a34e0ab556745d5` (main after #160). Nothing is committed, pushed or merged. No schema, migration, backup-format, Rust or dependency change.

## Defects fixed

| # | Where she sees it | Defect on `main` | Fix |
|---|---|---|---|
| 1 | Settings → backup status | The age counted 24-hour periods, not calendar days. A backup saved at 11 pm and checked at 8 am said "saved today". | `backupHealth` (`src/logic/dataSafety.ts`) compares local calendar days. |
| 2 | Save complete backup dialog | The suggested file name used the UTC date. An evening backup in the Americas was named for tomorrow, for example `her-flight-deck-2026-10-15` on the evening of 14 October PDT. | `chooseCompleteBackupDestination` (`src/services/backups.ts`) uses `todayIso()`. |
| 3 | Study Library → history → "Card as you reviewed it" | The dialog said "Rated Good on 05/10/2026, 08:00:00", a day-first numeric date that a US reader takes as May 10. The list behind it said "5 Oct 2026, 08:00". | The dialog uses the list's format (`StudyLibraryHistory.tsx`). |
| 4 | Flight Journal form | Any part of a flight could be longer than its total: dual received 2.0 on a 1.5 hr flight, or dual plus solo above the total. The values were saved and inflated every log total. | New `flightTimeProblem` (`src/logic/flightLog.ts`) explains the problem and blocks the save. It applies to new entries and to edits that change a time. Earlier entries are not blocked, so a Quick debrief, which hides the time fields, never stops on them (`flightTimesChanged`). |
| 5 | Pilot Toolkit → reminders | The preview used the raw "days ahead" value while saving clamped it to 0–90: typing 500 previewed 500 days, then saved 90. Unreadable stored values became `NaN`, which produces invalid dates, and hourly or extra costs became `$NaN`. | `reminderLeadDays` and `nonNegativeOr` (`src/logic/toolkit.ts`) are shared by the preview, the save and `normalizeToolkitState`. |
| 6 | Startup reminder popup and Toolkit reminders | A medical expiry in Settings plus a Toolkit medical record with the same date appeared twice. | That medical is listed once. When the dates differ, both are kept so neither is hidden (see SWEEP-1014-MEDICAL). |
| 7 | Schedule → add or edit event | Costs accepted negative and zero amounts ("-150"). That led to a "Record -$150 as an expense" button, which saved a negative lesson cost. The Finances form already refuses amounts at or below zero. | `EventFormDialog` applies the same rule: more than zero, or blank. `recordLessonCost` (`financeRepository.ts`) refuses a non-positive or fractional amount before writing. For costs saved earlier, `EventDetail` asks her to edit the cost and shows no record button. |
| 8 | Schedule → lesson detail → Cost | A cancelled lesson in the past offered to record its *estimate* as an expense, though Finances already leaves cancelled lessons out of upcoming costs. | A cancelled lesson is recorded only from an actual cost she enters, such as a cancellation fee. The card says so. |
| 9 | Toolkit record expirations, Finances ledger, Flight Deck key dates, reminder popup, Questions, Flight Path | `formatShortDate` never showed a year. A record expiring 20 Oct 2028 read "Expires Oct 20", and last December's expenses had no year. | The year is added when it isn't the current one ("Oct 20, 2028"), matching `formatLongDate`. `describeRelativeDate` passes its `today` through. |

## Verification (Node 22, the CI version)

| Check | Result |
|---|---|
| New or extended tests against unchanged `main` | Every new regression test failed for the expected reason:<br>• #1 "today" instead of "yesterday";<br>• #2 `…2026-10-15…` under PDT;<br>• #3 `05/10/2026, 08:00:00`;<br>• #4 no alert;<br>• #5 `expected NaN to be 7`;<br>• #6 the medical listed twice;<br>• #7 the form saved and the repository wrote −$150, 0 and 12.5 cents;<br>• #8 a cancelled lesson offered its estimate, and a negative cost offered a record button;<br>• #9 `expected 'Oct 20' to be 'Oct 20, 2028'`. |
| Disposable mutants (file restored) | The edited-times guard was removed: the Quick-debrief test fails. Same-date dedupe was removed: the medical test fails. |
| Focused suites | These pass:<br>• `dataSafety`, `backups`, `flightLog`;<br>• `quickDebrief` (23), `StudyLibraryReviews`;<br>• `toolkit`, `toolkitDefaults`;<br>• `financeRepository`;<br>• new: `EventFormDialog.test.ts` and `EventDetailCost.test.ts`;<br>• `dates`. |
| `npm test`, `npm run typecheck`, `npm run build`, `git diff --check` (final) | exit 0. 3,141 passed, 6 skipped; main had 3,119, and 22 tests were added. |

## Limitations and follow-ups (added to `ROADMAP.md`)

- **SWEEP-1014-TIMES:** entries saved before this check may already be impossible, and nothing points them out yet.
- **SWEEP-1014-MEDICAL:** the medical date can live in two places that disagree. One source has to be chosen, or the conflict shown.
- **SWEEP-1014-TZ-CI:** under CI's UTC the backup file-date test passes on old code too. It should run under a set non-UTC zone as part of MAINT-143-TZ.
- **M5-COST-REFUNDS:** refunds aren't modelled (carried from the M5 cost slice).
- **Overlap:** `src/logic/toolkit.ts` and `src/pages/PilotToolkit/PilotToolkit.tsx` are also edited by the uncommitted M5 cost slice (`claude/m5-training-cost-analytics`), in different functions: the forecast and the cost tool. Expect a trivial merge.
- **Checked, not a defect:** the schema-13 snapshot helper's self-check fails now that `main` ships migration 14. ROADMAP says to preserve that "historical schema13 ceiling alarm", so it was left alone.
- `node_modules` in this worktree is an untracked symlink to the M5 worktree's install. Do not commit it.
- jsdom and browser-mode logic only. The installed app was not run, and no release gate is affected.
