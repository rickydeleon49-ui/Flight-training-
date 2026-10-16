# SWEEP-1014-TIMES and SWEEP-1014-MEDICAL — implementation report (15 October 2026)

**IMPLEMENTED; SWEEP-R1 CORRECTED, PENDING INDEPENDENT RE-REVIEW.** Claude (`claude-opus-5-5`).

> **Review history.** The independent review ([`SWEEP_FOLLOWUPS_REVIEW_2026-10-15.md`](SWEEP_FOLLOWUPS_REVIEW_2026-10-15.md), issue #168) requested changes for **SWEEP-R1**: two opposite medical choices clicked before the first was saved swapped the two dates. The correction is described in [`SWEEP_FOLLOWUPS_CORRECTION_R1_2026-10-15.md`](SWEEP_FOLLOWUPS_CORRECTION_R1_2026-10-15.md). The medical rows and verification counts below describe the original submission; the correction report holds the current ones.

- **Where:** uncommitted in the worktree `/Users/rickymac/code/Flight-training-sweep-followups`, branch `claude/sweep-followups-2026-10-15`.
- **Base:** `f2a7090` (`main` after #166).
- **State:** nothing is committed, pushed or merged.
- **Scope:** no schema, migration, backup, Rust or dependency change.

Both items follow the direction ROADMAP gives in "Claude work consolidation — 14 October 2026":

- **TIMES:** add a read-only explanation listing the affected entries, and never silently change or drop her historical times.
- **MEDICAL:** explain the conflict, and ask which record is authoritative before any reconciliation.

## SWEEP-1014-TIMES — older flights whose times don't add up

Entries saved before the form's check (bug sweep #4) can still hold parts longer than the total, for example 1.2 hr dual on a 1.0 hr flight.

| Where | Behaviour |
|---|---|
| `flightTimeChecks` (`src/logic/flightLog.ts`) | Lists saved entries that fail the existing `flightTimeProblem` check, newest first. It is pure and never changes an entry. |
| Flight log (`FlightJournal.tsx`) | A card titled "One flight's times don't add up" (or "N flights' …") lists each entry, its problem, a link to the entry and a "Correct times" link to the full editor. It says nothing has been changed and the times still count in the totals. The Part 61 hour reference adds that its totals include those flights. With no such entries, nothing is shown. |
| Entry detail (`JournalEntryDetail.tsx`) | The Flight log card names the problem and links to "Correct times". |

Correcting goes through the existing editor. Because she then changes a time, the form's check applies, so the saved result is consistent.

## SWEEP-1014-MEDICAL — Settings and the medical record disagree

| Where | Behaviour |
|---|---|
| `medicalDateConflict` (`src/logic/toolkit.ts`) | Compares the Settings medical expiry with her **latest-expiring** saved medical record. An earlier medical kept as history is not a conflict. |
| Pilot Toolkit → Certificates | A "Two different medical dates" card shows both dates and asks which matches her certificate: "Nothing changes until you choose".<br>• Choosing the record's date updates Settings.<br>• Choosing the Settings date updates only that latest record.<br>• Earlier records keep their own dates. |
| Settings → Profile | Under the medical date, a note names the record and its date and points to Certificates. |
| Reminders (`buildReminders`) | Both dates still appear, as before. Each conflicting item now adds "· your two medical dates differ". |

## Verification (Node 22, the CI version)

| Check | Result |
|---|---|
| `flightLog.test.ts` | 12 passed. New: listing, order and no mutation. |
| `toolkit.test.ts` | 13 passed. New: conflict detection, including the history record not counting, and reminder wording. |
| New `src/pages/FlightJournal/flightTimeChecks.test.ts` (jsdom) | 3 passed:<br>• the Flight log card, its links and wording;<br>• the totals keep the logged times (2.7 hr training received);<br>• no writes;<br>• hidden when every flight adds up;<br>• the entry detail note. |
| Same test against unchanged pages | 2 of 3 fail as expected (no note); the "nothing shown" case passes on both. |
| New `src/pages/PilotToolkit/medicalDateConflict.test.ts` (real SQLite) | 5 passed:<br>• nothing changes before she chooses;<br>• each choice writes only the other record, and the earlier record keeps its date;<br>• the Settings note appears;<br>• nothing is shown when the dates agree. |
| `npm test` | exit 0. 3,212 passed, 6 skipped (main had 3,202). |
| `npm run typecheck`, `npm run build`, `git diff --check` | exit 0. |

## Limitations

- No browser-mode screenshot. Browser mode can't easily be seeded with an impossible entry, because the form now refuses one. Verification is jsdom and real-SQLite rendering only, and the installed app was not run.
- Only the latest medical record is compared with Settings. If she has two current medical records with different dates, only the later one is reconciled.
- The Toolkit can't edit a record's other fields; that was not in scope.

## Proposed tracking entry

> **SWEEP-1014-TIMES / SWEEP-1014-MEDICAL — 15 October 2026.** Saved flights whose times don't add up are pointed out on the Flight log and the entry, with a way to correct them; times are never changed and still count in totals. When Settings and her latest medical record disagree, the Certificates tab asks which date matches her certificate, and only her choice updates the other record; Settings and reminders say the dates differ. No schema or dependency change. [Report](docs/SWEEP_FOLLOWUPS_REPORT_2026-10-15.md).
