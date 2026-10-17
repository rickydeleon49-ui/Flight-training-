# P54-05 lesson brief and calendar export: proposed scope

**PROPOSED SCOPE FOR CODEX REVIEW AND OWNER DECISIONS. Nothing here is implemented or approved.** Claude drafted this as the next item in the approved queue (P54-01 → 03 → 04 → 02 → **05**). P54-02 phase 2 is waiting on independent review and owner decisions, so P54-05 is the next unblocked item; queue order is unchanged. It follows the researched option in [POST_V054_IMPROVEMENT_OPTIONS](POST_V054_IMPROVEMENT_OPTIONS_2026-10-15.md), section "P54-05". Its acceptance list says both parts **can be approved independently**.

Base: main 99444ac. No code, dependency, migration or application change is part of this document.

## What already exists (and is reused, not duplicated)

| Existing piece | Where | Used for |
| --- | --- | --- |
| `ScheduleEvent`: `title`, `eventType`, `date` (local `YYYY-MM-DD`), `startTime`/`endTime` (local `HH:MM` or null), `location`, `instructor`, `notes`, `goalId`, `status` (`scheduled`/`completed`/`cancelled`/`rescheduled`), `materialIds`, `updatedAt` | `src/domain/types.ts:943` | Brief header; calendar event |
| Prep checklist (`PrepItem` by `eventId`) and "Ask:" questions (`Question.eventId`) | `lessonPreparation()` in `src/logic/preparation.ts` | The brief's "Get ready" section, with the same done/outstanding semantics as EventDetail |
| Attached materials (`event.materialIds`) | EventDetail | The brief's "Read before" section |
| Journal `questionsForNextTime`, debrief `instructorFeedback` | `JournalEntry` | Candidate "Follow-ups from last time" (chosen, never automatic) |
| Dates stay wall-clock calendar strings by design ("a lesson on Saturday is on Saturday") | `src/lib/dates.ts` | Calendar time model (see OD-3) |
| P54-04 export: `save_study_export` native command (`ExportKind`, atomic `write_export`, size caps, path-free errors), the `studyHandout.ts` escaped/CSP printable HTML, and `services/studyExport.ts` | PR193, **not yet on main** | Saving the brief and the `.ics` file; no second file-writing path |

**Prerequisite:** PR193 (P54-04) must be accepted and on main first. Both parts reuse its save command and printable-HTML conventions, adding new `ExportKind` variants. They do not copy its unmerged source.

## Part A: lesson brief

**Experience.** On a lesson's EventDetail, a "Lesson brief" action opens a preview of one readable page. It can then be printed or saved as a printable HTML file, the same output style as the P54-04 handout. It contains:

1. **Header:** title, type, date, time, location and instructor, as stored. The status is shown if it is not `scheduled`.
2. **Get ready:** the checklist and "Ask:" lines from `lessonPreparation()`, with done or outstanding marked exactly as in EventDetail. There is no percentage, consistent with the existing readiness rule.
3. **Read before:** the attached materials' titles, types and topics. If P54-01 is integrated, source-page labels are shown as text only; the brief never opens files.
4. **Follow-ups (optional, chosen):** the user ticks individual items from the most recent earlier journal entry's `questionsForNextTime`, plus open questions linked to the lesson's goal. Nothing is included unless ticked.

**Privacy and content rules.**
- Lesson `notes`, journal reflections (`wentWell`/`wasDifficult`), finances, medical items, Pilot Toolkit data and other lessons are **never** included.
- Material notes and file paths are excluded; only titles are shown.
- The selection UI shows exactly what will be printed.
- No AI or provider call. No new stored data: selections live only in the open dialog (OD-2).

**Output and safety.**
- Plain text in escaped HTML with the P54-04 CSP: no scripts, links, remote assets or images.
- Printable with `@media print`.
- Saved through the shared native save path with a new `brief` `ExportKind` and its own size cap. Desktop only, like P54-04.
- Browser mode shows the preview and prints with the browser's own print; no file save.

## Part B: calendar file (.ics)

**Experience.** On EventDetail there is an "Add to calendar…" action that saves one `.ics` file. The user then opens or imports that file in their calendar app. The copy says plainly that this is a one-time file, **not** a sync: later edits or cancellations need a new file, and some calendar apps will add a duplicate rather than update the existing event. There is no calendar account access and no background permission.

**Implementation:** a small in-house RFC 5545 writer in `src/logic/`, with no new dependency. The researched `ics` package is below the owner's 1,000-star criterion. The writer needs:
- **Structure:** `VCALENDAR` (`VERSION:2.0`, `PRODID`, `METHOD:PUBLISH`, `CALSCALE:GREGORIAN`) containing one `VEVENT`.
- **Required fields:** `UID`, `DTSTAMP` (UTC, export time), `DTSTART`, `SUMMARY`.
- **Optional fields:** `DTEND`, `LOCATION`, `DESCRIPTION`, `STATUS`, `SEQUENCE`.
- **Text handling:** RFC TEXT escaping (`\`, `;`, `,`, newline). Lines are folded at 75 **octets** without splitting a UTF-8 sequence, joined with CRLF.

**Event identity (stable):** `UID:<event.id>@herflightdeck.invalid`. The same lesson always produces the same UID, so an app that honours UID and SEQUENCE updates rather than duplicates. `SEQUENCE` derivation is OD-5.

**Time cases (all tested):**

| Stored | Exported |
| --- | --- |
| date + start + end | Timed event, start to end |
| date + start, no end | Timed event with the default duration from OD-4 |
| date only | All-day: `DTSTART;VALUE=DATE` and `DTEND;VALUE=DATE` set to the next day |
| end < start | Already refused by `EventFormDialog`. The writer refuses it too and never produces an inverted event |
| Lesson on a DST-change day, or a non-existent or repeated local time | Behavior depends on OD-3; tested explicitly for spring-forward and fall-back dates |

**Status:**
- `scheduled` exports as `STATUS:CONFIRMED`.
- `cancelled` exports as `STATUS:CANCELLED`, with copy explaining that import may not remove the event from every app.
- `completed` lessons get no "Add to calendar" action.
- `rescheduled` is OD-6.

**DESCRIPTION (minimal by default).** It contains:
- the event type;
- the instructor, if set;
- one line: "Prepared with Her Flight Deck — open the lesson in the app for your checklist";
- **optionally** the prep checklist titles, if the user ticks it (OD-7).

Never included: lesson notes, journal text, finances or anything from other records. `LOCATION` comes from the event's location text.

## Owner decisions needed

- **OD-1. Approve both parts or only one.** Recommended: both, Part A first, then Part B.
- **OD-2. Brief selections.** Recommended: dialog-only, which needs no migration. Alternative: remember per lesson, which needs a schema change and backup/restore coverage.
- **OD-3. Calendar time model.**
  - **Recommended: floating local time.** `DTSTART:20261024T100000` with no `Z` or `TZID`. It matches how the app stores lessons (wall-clock, zone-less), needs no zone database and no DST conversion, and the event appears at 10:00 wherever the calendar is. Risk: if the calendar app is set to a different zone than the lesson's, it shows wall-clock 10:00 in that zone.
  - **Alternative: `TZID` set to the machine's current zone,** with a generated `VTIMEZONE`. That is more exact across travel, but it needs zone-rule generation and DST transition tests.
  - **Not recommended: UTC conversion.** It fixes the instant at export time and silently shifts if the stored wall-clock time was meant for a different zone.
- **OD-4. Default length when there is no end time.** Recommended: 1 hour, labelled in the dialog. Alternative: zero length (start only), which some apps display poorly.
- **OD-5. SEQUENCE.** Recommended: whole minutes between 2020-01-01T00:00Z and `updatedAt`. That is monotonic with every edit, needs no stored counter, and fits the 32-bit `INTEGER` until well after 2100. Alternative: a stored counter, which needs a migration.
- **OD-6. What `rescheduled` means.** Today it is only a status the user sets; nothing links the old and new lessons. Recommended for this slice: treat it like `cancelled` for export (cancel the old UID) and tell the user to add the new lesson's own file. Linking old and new lessons is out of scope.
- **OD-7. Prep checklist in the calendar description.** Recommended: off by default, with a tick to include it.
- **OD-8. Multi-lesson export** (for example "next 4 weeks of lessons" in one file). Recommended: **not** in this slice; revisit after single-lesson export is in use.

## Out of scope

- Two-way sync, CalDAV, Google or iCloud accounts, calendar permissions, reminders and alarms (`VALARM`).
- Recurring lessons and attendees/organizer.
- Importing `.ics` files.
- Emailing.
- Any AI-generated brief text, and weather (that is P54-07).
- Changes to how lessons store dates and times.
- No new dependency, provider call or credential.

## Acceptance tests (proposed)

**Brief (A).**
- Every section renders from fixtures.
- An empty checklist, no materials and no follow-ups each say so plainly.
- Done/outstanding marks match `lessonPreparation()` exactly.
- Unticked follow-ups and all excluded fields (lesson notes, journal reflections, finances, material notes and paths) are absent from the HTML. This is asserted by searching the HTML for unique sentinel strings.
- Hostile text (HTML, script, very long and Unicode strings) is escaped, the CSP is present, and there are no links or remote URLs.
- The size cap is refused cleanly.
- Saving reuses `save_study_export`: cancel, failure and retry follow the P54-04 save-lock behaviour.

**Calendar (B).** Golden files cover:
- timed, start-only and all-day lessons;
- `cancelled` and `rescheduled`;
- Unicode, emoji, commas, semicolons, backslashes and newlines in title and location;
- 75-octet folding at multi-byte boundaries, with CRLF throughout;
- a stable UID for the same lesson across exports;
- SEQUENCE increasing after an edit;
- DST spring-forward and fall-back dates under the chosen OD-3 model;
- end < start refused;
- no lesson notes in any field.

A parser round-trip check runs in tests only. No runtime dependency is added for it; a test-only check against a small hand-written RFC parser is acceptable.

**Native.** The new `ExportKind` variants keep the existing path, chooser, size and error contracts, and the `.ics` and `.html` extensions are enforced.

**Manual, recorded separately as unverified until done.** Import into macOS Calendar: does a re-import with the same UID update the event or duplicate it? What happens to a cancelled re-import? Print to PDF from the installed app. These need the owner's normal installed-app authorization; source tests do not claim them.

## Proposed delivery

1. **After PR193 is on main:** Part A in one PR (logic, dialog, new `ExportKind`, tests), then stop for independent review.
2. **Part B in a second PR,** with the OD-3/4/5/6 decisions recorded first. Then stop for review.

Each part touches no schema (given OD-2's recommendation) and no dependencies. It needs the full frontend, Rust, Clippy, fmt, lock and helper checks.
