# SWEEP-R1 correction — opposite medical choices (15 October 2026)

**CORRECTED, PENDING INDEPENDENT RE-REVIEW.** Claude (`claude-opus-5-5`).

- **Where:** uncommitted in `/Users/rickymac/code/Flight-training-sweep-followups`, branch `claude/sweep-followups-2026-10-15`.
- **Base:** `f2a7090190c74fdc3779785ae3684049d16b2a0e`, still `origin/main` at the start of this correction.
- **Assignment:** issue #168 and [`SWEEP_FOLLOWUPS_REVIEW_2026-10-15.md`](SWEEP_FOLLOWUPS_REVIEW_2026-10-15.md).
- **State:** nothing is committed, pushed or merged, and no product PR was opened.
- **Scope:**
  - no schema, migration, backup, dependency, version, bundle ID or provider change;
  - SWEEP-1014-TIMES is unchanged.

## Starting identity

- **Submitted files:** all 13 entries in `docs/evidence/sweep-followups-review-2026-10-15/submitted-hashes.json` matched before any edit (13 entries, 0 mismatches).
- **Reviewer evidence:** all 9 lines in the reviewer's `SHA256SUMS` verified OK.
- **Issue #168:** its correction prompt is identical to the one in the local review file. The issue additionally attaches the frozen hashes, the diagnostic and its receipt.
- **Reviewer files:** the report and evidence are unchanged by this correction.

## Reproduced before fixing

- **Setup:** the frozen diagnostic was copied to `src/pages/PilotToolkit/SweepReviewerDiagnostic.test.ts`, after confirming the destination did not exist.
- **Command:** `npx vitest run src/pages/PilotToolkit/SweepReviewerDiagnostic.test.ts -t 'independent reviewer diagnostics'`
- **Result:** exit 1. Both cases failed exactly as the review recorded (2 failed, 5 skipped):
  - **record first:** Settings `2031-10-31`, record `2031-11-30`;
  - **Settings first:** Settings `2031-10-31`, record `2031-11-30`.
- **Cleanup:** the copy was removed afterwards.
- **Raw output:** [`diagnostic-before.txt`](evidence/sweep-followups-correction-2026-10-15/diagnostic-before.txt).

## Cause

`MedicalDateConflictCard` accepted both choices while the first was saving. Each queued its own write using the dates shown at render. Because `AppDataProvider` serializes mutations, the second write ran after the first and undid it on the other side, which swapped the two dates.

## Correction

1. **One choice at a time** (`PilotToolkit.tsx`).
   - **Guard:** `PilotToolkit` owns a synchronous `PendingChoice` guard, a ref plus state, and passes it to the Certificates tab. `acquire()` runs before any write is queued, so a second click in the same render is refused.
   - **While pending:** both buttons are disabled, the note is `aria-busy`, and a `role="status"` line reads "Saving your choice…".
   - **Tab switches:** the guard lives on the page rather than the card, so it survives a tab switch and remount.
   - **Hooks:** all hooks run before the card's early return.
2. **Validated against current data** (`reconcileMedicalDates` in `src/logic/toolkit.ts`, called inside the card's single `mutate`).
   - **Fresh read:** the write re-reads Settings and the Toolkit and checks that the conflict she saw still exists. That means the same Settings date, the same latest record and the same record date.
   - **Stale choice:** if anything differs, nothing is written. The app's normal post-mutation refresh shows the dates as they now stand, with a status line explaining that nothing was changed. Differences include:
     - an earlier choice;
     - an edit elsewhere;
     - a removed or replaced record.
   - **Accepted choice:**
     - choosing the record's date updates only `profile.medicalExpiry`;
     - choosing the Settings date updates only that record's `expiresOn`;
     - every other field and earlier record is kept as is.
3. **Failure and retry.**
   - **Failed write:** `mutate` reports the failure through the existing `lastError` and returns `null`. The guard is released in `finally`, both saved dates stay as they were, and she can choose again. No success is announced.
   - **Refresh failures:** an acknowledged write whose refresh fails keeps the existing `mutate` behaviour and is never resubmitted.

There is no automatic reconciliation on load, and both dates stay visible until a choice is accepted.

## Regression coverage

All tests are in `src/pages/PilotToolkit/medicalDateConflict.test.ts` (real SQLite, through the actual `AppDataProvider` queue, with no sleeps or fake timers) and in `src/logic/toolkit.test.ts`.

| Test | Proves |
|---|---|
| The 5 original medical tests | Unchanged and still pass: no write before a choice, both directions, history record kept, Settings note, nothing shown when the dates agree |
| 2 promoted reviewer cases (record first / Settings first) | Both dates equal the first choice. The assertions are copied from the frozen diagnostic unweakened. |
| Locked while saving | While the write queue is held:<br>• two opposite clicks in one render, plus a click after render;<br>• both buttons disabled, `aria-busy` and the status line;<br>• nothing written before release.<br>After release:<br>• both dates equal the first choice;<br>• the earlier record is equal field for field;<br>• exactly one Toolkit write and no Settings write;<br>• exactly one choice reached `reconcileMedicalDates`. |
| Failed save, then retry | The injected Settings write failure is reported through `lastError`. Nothing changes, the buttons unlock and the counter shows one attempt. A deliberate retry reconciles, and the counter shows two. |
| Record changed while queued | Her queued Settings choice writes nothing, and the record's new date survives. The status line appears, and the card re-presents the current dates with enabled buttons. |
| Settings changed / record removed while queued | Neither stale choice overwrites anything. |
| Tab switch while saving | After remount both buttons are still disabled, a click on the opposite choice is ignored, the first choice wins, and only one choice reached the write step. |
| `reconcileMedicalDates` (logic) | Both write plans touch only their counterpart. Stale is returned after an earlier choice in either direction, after Settings or record date changes, and after the record is removed or replaced. |

**Mutation checks.** Each one was made in place and the file restored byte-identical afterwards (`cmp`). The results were read from the console and not archived.

| Break | Caught by |
|---|---|
| M1: guard never blocks | "locks both choices while the first is saving" |
| M2: fresh-state validation removed | logic stale test, record-changed test, Settings-changed/removed test |
| M3: guard not released when the save fails | the failed-save-then-retry test |
| M4: guard held by the card instead of the page | the tab-switch test |

**Finding during review of my own tests.** A first version of the held-write test asserted only that no stale notice appeared. That was vacuous, because the card disappears once the dates agree, and M1 passed it. The counter of choices reaching `reconcileMedicalDates` fixed that. Similarly, a "release only on success" mutant was equivalent because `mutate` never throws, so the realistic `null`-outcome mutant (M3) was used instead.

## Verification (Node v22.23.3)

Raw outputs are in [`evidence/sweep-followups-correction-2026-10-15/`](evidence/sweep-followups-correction-2026-10-15/), and the exact argv, exit codes and counts are in `receipt.json`.

| Command | Exit | Result |
|---|---|---|
| Frozen diagnostic before the fix (`-t 'independent reviewer diagnostics'`) | 1 | 2 failed, 5 skipped |
| Frozen diagnostic after the fix (all cases) | 0 | 7 passed |
| Focused: `medicalDateConflict`, `toolkit`, `flightLog`, `flightTimeChecks` | 0 | 4 files, 42 tests passed |
| `npm test` | 0 | 141 files passed / 4 skipped; 3,221 passed / 6 skipped (the submission had 3,212) |
| `npm run typecheck` | 0 | passed |
| `npm run build` | 0 | passed |
| `git diff --check` (tracked changes; new files checked with `git add -N`, then reset) | 0 | passed |

No native rebuild or Rust run was needed, because no Rust changed. There was no app launch, install, hfdtest or real profile access.

## Changed-source manifest

`evidence/sweep-followups-correction-2026-10-15/changed-source-manifest.json` lists the SHA-256 of every submitted path after correction. That covers the original 13 paths, 6 of which this correction changed (`ROADMAP.md`, `toolkit.ts`, `toolkit.test.ts`, `PilotToolkit.tsx`, `medicalDateConflict.test.ts` and the original report), plus this report. `SHA256SUMS` in the same folder covers the evidence files and the manifest.

## Remaining limitations

- **Only the latest medical record is compared with Settings** (disclosed in the original report). This is not certified as identifying the legally current certificate.
- **Stale-choice notice:** if a stale choice finds the dates already agree, the card simply disappears, with no separate message, because there is nothing left to choose.
- **jsdom and real-SQLite rendering only.** No browser-mode screenshot was taken and the installed app was not run.
