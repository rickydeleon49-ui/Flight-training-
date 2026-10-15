# M5 training cost analytics, first slice — implementation report (14 October 2026)

**Integration note:** the implementation snapshot below is historical. The [independent consolidation review](CLAUDE_WORK_CONSOLIDATION_REVIEW_2026-10-14.md) records the later corrections, final test counts and acceptance boundary. Original hashes/counts below describe the submitted version.

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** Claude (`claude-opus-5-5`). Uncommitted in the isolated worktree `/Users/rickymac/code/Flight-training-pr142-fixes`, branch `claude/m5-training-cost-analytics`, base `42077ccd00b70ad406e30d236a34e0ab556745d5` (main after #160). Nothing is committed, pushed or merged.

## Why this slice

ROADMAP §10 (M5) asks for cost analytics that define the denominator for cost per hour, avoid mixing periods, and avoid counting both a lesson total and its itemized costs. M5 depends on M3, whose first production slice is integrated (#140). The requirements/readiness half of M5 needs knowledgeable regulatory review first. Cost analytics does not, and it touches no schema, backup or migration code. That keeps clear of the in-flight work: M4 corrections, the M2 readiness refresh (#161), schema-14 preparation and MAINT-143-KEYS, release preparation (#153) and the timezone tests (#152).

## Defects found and fixed

**1. The Finances "What training is costing" card:**

- **"Average lesson"** averaged each `flight_lesson` and `aircraft_rental` transaction separately. A lesson paid as instruction ($150) plus rental ($180) showed as two lessons averaging $165, instead of one lesson costing $330.
- **"Paid lessons"** counted only `flight_lesson` transactions, while the average also included rentals. The two figures used different definitions.

**2. The Pilot Toolkit private pilot cost forecast** (`trainingCostForecast` in `src/logic/toolkit.ts`). The "observed" hourly rate divided **all** tracked training spending (headset, medical, books, exam fees, ground school) by logged flight hours, then multiplied it across every remaining planning hour. With one $400 two-hour lesson, a $400 headset and a $150 medical exam, unchanged `main` reports **$475 per hour** instead of $200, and every remaining hour is projected at the inflated rate.

## Behaviour now (`trainingCostSummary` in `src/logic/finance.ts`)

- **A lesson is one paid lesson however it was paid:**
  - all `flight_lesson`, `aircraft_rental` and `instructor` expenses linked to the same schedule event add up to **one lesson**, if that event has at least one flight lesson or rental expense;
  - an unlinked flight lesson or rental expense is one lesson on its own;
  - instruction alone (linked or not), other categories and contributions are not lessons.
- **"Paid lessons" and "Average lesson"** now use that same definition.
- **New "Per flight hour":**
  - the cost of each lesson is paired with the total time from the journal entries linked to *that same lesson*;
  - lessons missing either side are left out, so hours from one period or lesson never dilute another's cost;
  - non-finite or non-positive times are ignored;
  - the card states the basis ("uses 1 of 2 lessons: those with logged flight time (1.5 hr)"), or, when no lesson has both, what is needed.
- **Possible double counts:**
  - a lesson that has the "record this lesson's cost" total (`source: "lesson_cost"`) *and* other lesson expenses is listed, with a link to the lesson, asking her to edit or delete one if they are the same money;
  - nothing is dropped or changed automatically, because only she knows whether a rental line is itemization or an extra charge;
  - the balance and the ledger are untouched.
- `averageLessonCost` and `countPaidLessons` are removed. Finances was their only caller.
- **New "Spending by month" card** (`monthlySpending`):
  - recorded expenses for the last six calendar months, newest first, as an accessible table;
  - empty months show $0 instead of being skipped;
  - the "On lessons" column uses the same lesson definition as above;
  - scheduled estimates stay under "Coming up", and expenses dated after the current month are left out;
  - the month window crosses year boundaries correctly;
  - it uses no bars or percentages, because `Meter` is reserved for progress toward a target she chose.
- **Forecast:**
  - the observed rate is now the same per-lesson cost per flight hour, and its hint names how many lessons it comes from;
  - one-off costs stay in "Tracked training spending" and in her own "Additional remaining costs", and are not extrapolated per hour;
  - until a lesson has both a recorded cost and linked logged time, her own hourly estimate is used. Previously the inflated all-spending rate was used.

## Files

| File | Change |
|---|---|
| `src/logic/finance.ts` | `trainingCostSummary` and its types replace the two per-transaction helpers |
| `src/logic/finance.test.ts` | the old lesson cases are rewritten against the new contract, plus 7 new cases (26 tests in the file) |
| `src/pages/Finances/Finances.tsx` | the card uses the summary; adds the per-flight-hour figure, its basis and the double-count note |
| `src/pages/Finances/Finances.test.ts` | new: 4 rendered tests (jsdom) |
| `src/pages/Finances/finances.css` | `.month-table` styles |
| `src/logic/toolkit.ts` | the forecast takes journal entries and uses the per-lesson flight-hour rate; adds `observedLessons` |
| `src/logic/toolkit.test.ts` | the forecast case is updated to the paired contract, plus two new cases (headset/medical not extrapolated; her own estimate used until there are paired lessons) |
| `src/pages/PilotToolkit/PilotToolkit.tsx` | passes journal entries; corrected hint wording |

## Verification (Node 22.23.3, the CI version)

| Check | Result |
|---|---|
| Focused: `finance.test.ts` (26), `Finances.test.ts` (4), `toolkit.test.ts` (7) | 37 passed |
| `npm test` (final) | exit 0: 134 files passed, 4 skipped; **3,133 passed**, 6 skipped |
| `npm run typecheck`, `npm run build`, `git diff --check` (final) | exit 0 |
| New forecast tests against unchanged `main` | **3/3 fail**; the headset case reports `47500` cents per hour instead of `20000` |
| New rendered test against unchanged `main` | **3/3 fail**: paid lessons shows "1" instead of "2"; no "Per flight hour"; no double-count note |
| Disposable logic mutants (file restored byte-identical) | 5/5 caught: grouping per transaction; rate using every logged hour; double counts not reported; linked instruction alone counted as a lesson; non-finite time accepted |
| Browser-mode screenshots, desktop and 390 px (after driving the UI to record three expenses) | card renders as expected with no horizontal overflow |

Cargo was not run: no Rust, migration or backup code changed.

## Limitations and follow-ups

- **Refunds** aren't modelled. The expense form refuses amounts of zero or less, and there's no refund type, so the roadmap's refund handling needs a separate data-model decision.
- Lessons are linked to flight time only through the schedule event (`eventId`). A journal entry recorded without a linked lesson can't contribute hours.
- Trends are a fixed six-month window, with no chart, no category breakdown per month and no cost-per-hour by month (per-month pairing would need lessons and journal time in the same month). User-editable projection rates beyond the existing Toolkit assumptions are not in this slice.
- The submitted rendered month test originally read the real clock. Independent integration review freezes Date for this suite to avoid a month-boundary race; pure monthlySpending tests retain an injected date.
- jsdom and browser mode only. Not checked in the installed WKWebView app, and no installed or release gate is affected.
- **Tooling, noticed in passing:** `.claude/skills/run/SKILL.md` lists routes such as `/finances`, but the app uses `HashRouter`. Those routes silently screenshot the home page; `/#/finances` works. Separately, `--dark` did not switch the app's theme in this run.

## Proposed tracking entry (for the integrator)

> **M5 training cost analytics, first slice — 14 October 2026.** Lessons paid with several expenses now count once; "Paid lessons" and "Average lesson" share one definition. The Pilot Toolkit forecast no longer spreads one-off costs (headset, medical, books) across every remaining flight hour. A six-month "Spending by month" table shows recorded spending and the lesson share. Cost per flight hour pairs each lesson's cost with the time logged for that lesson and states how many lessons it covers. A recorded lesson total that sits beside separate lesson expenses is flagged for her to check, not dropped. No schema, backup or dependency change. Refunds, period trends and projections remain open. [Report](M5_TRAINING_COST_ANALYTICS_REPORT_2026-10-14.md).
