# P54-05 part B: single-lesson calendar export: implementation report

**IMPLEMENTED; PENDING INDEPENDENT REVIEW; NO SELF-MERGE.** Gemini implemented part B of the [approved scope](P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md) ([approval](P54_05_SCOPE_APPROVAL_2026-10-17.md)), completing the calendar export feature under the approved decisions (OD-1–OD-8).
- **Branch and base:** `gemini/p54-05-calendar-export`, from accepted main `2fc27b90aacd33183a8e5c0f3047008df37383b4` (containing PR193, PR204, PR205).
- **Scope:** Single-lesson `.ics` file generation and native saving. No calendar account sync, no background integration, no new runtime dependency, no schema migration, and no stored preferences.

---

## User experience

1. **"Add to calendar…" action in EventDetail:**
   - Displayed for eligible schedule events: `scheduled`, `cancelled`, and `rescheduled`.
   - Hidden for `completed` lessons (no export action needed for past completed events).
2. **Calendar Export Dialog:**
   - Plain-language explanation that this saves a single calendar file (`.ics`) rather than connecting to or synchronizing an external calendar account.
   - Clarifies that re-importing the file into a calendar application may create a duplicate entry rather than updating an existing one.
   - Explains that importing a cancelled file may not remove an existing calendar entry depending on the user's calendar software.
   - Explains that lesson times are floating local times: a calendar configured in a different timezone may interpret the clock time differently.
   - Explains that an event with a start time but no end time defaults to an approved 1-hour duration, including day rollover.
   - For `rescheduled` events, clarifies that the file marks this lesson cancelled and that the replacement lesson needs its own calendar file.
   - **Preparation checklist option:** starts **off** (unticked by default). It is dialog-only, bound to the active session, and resets whenever the dialog is closed or the lesson changes.
3. **Browser mode:**
   - Explains that direct file saving is unavailable in the browser.
   - Does not dispatch the native save command or pretend to succeed.

---

## Calendar format (RFC 5545)

Implemented in `src/logic/calendarExport.ts` without new runtime dependencies:
1. **Structure:**
   - Single `VCALENDAR` containing exactly one `VEVENT`.
   - `VERSION:2.0`
   - Stable `PRODID:-//Her Flight Deck//Calendar Export 1.0//EN`
   - `CALSCALE:GREGORIAN`
   - Stable `UID:<event.id>@herflightdeck.invalid` across exports of the same lesson.
   - UTC export-time `DTSTAMP` in `YYYYMMDDTHHMMSSZ` format.
2. **Reviewer corrections honored (OD-5):**
   - **Omitted `METHOD` and `SEQUENCE`:** As accepted in reviewer corrections, `METHOD` (such as `PUBLISH`) and artificial `SEQUENCE` counters are omitted from this organizer-free snapshot export.
   - **Omitted `ORGANIZER`, attendees, alarms, recurrence, and invitations.**
3. **Time and date arithmetic:**
   - **Floating local times:** `DTSTART` and `DTEND` are emitted without `Z` or `TZID` (e.g. `20261024T090000`). Only `DTSTAMP` is UTC.
   - **Date-only arithmetic:** Pure calendar math ensures no unintentional timezone shifting across UTC or process timezones, preserving clock times across daylight saving time (DST) transition dates.
   - **Start and end time combinations:**
     - Explicit start and end: formatted as floating date-times.
     - Start only: adds 1 hour, handling midnight rollover into the next day, month-end rollover, leap days (Feb 28/29), and year-end rollover (Dec 31 -> Jan 1).
     - Date only (all-day): formatted as `DTSTART;VALUE=DATE:YYYYMMDD` with exclusive next-day `DTEND;VALUE=DATE:YYYYMMDD`.
     - Invalid configurations: end without start, equal start and end, or inverted start/end times are rejected with clear error messages.
     - Malformed inputs: invalid date strings or clock values (e.g. `2026-02-30`, `25:00`) are rejected rather than silently normalized.
4. **Encoding and conformance:**
   - RFC 5545 TEXT escaping for `\`, `;`, `,`, and newlines (`\n`).
   - Strips disallowed ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F).
   - Prevents property and component injection by neutralizing newline delimiters in user-controlled fields.
   - Physical line folding at no more than 75 UTF-8 octets, accounting for continuation prefix space, without splitting multibyte UTF-8 characters.
   - CRLF (`\r\n`) line endings used throughout, ending with a final CRLF.

---

## Privacy and explicit projection

- **SUMMARY:** Lesson title.
- **LOCATION:** Stored location string.
- **STATUS:** `CONFIRMED` for scheduled lessons; `CANCELLED` for cancelled or rescheduled lessons.
- **DESCRIPTION:** Contains only:
  - Event type.
  - Instructor (when present).
  - Standard footer: `"Prepared with Her Flight Deck — open the lesson in the app for your checklist"`.
  - Preparation checklist item titles if and only if the preparation checklist checkbox was explicitly selected.
- **Excluded content (strictly verified by sentinel tests):**
  - No lesson notes.
  - No journal reflections or questions.
  - No Ask questions or answers.
  - No attached material paths, titles, or notes.
  - No financial, medical, or toolkit data.
  - No internal user settings, paths, or database keys (other than the public UID).

---

## Native saving reuse

Extended the existing `StudyExportKind` / Rust `ExportKind` and `save_study_export` path:
- **ExportKind::Calendar:**
  - File extension: `.ics`
  - Chooser filter label: `"Calendar file"`
  - Dialog title: `"Save calendar file"`
  - Suggested filename stem fallback: `"Lesson"`
  - Size bound: `MAX_CALENDAR_BYTES = 64 * 1024` (64 KiB), with compile-time assertion that it remains below the handout cap.
- **Safety:**
  - Content exceeding the 64 KiB limit is refused before the save dialog opens.
  - Reuses the existing atomic temporary-file-and-rename writer with path-free user errors.
  - Silent cancellation handling without false errors.

---

## Concurrency and lifecycle (BRIEF-R1/R2 pattern)

Applied the accepted session-ownership architecture from `LessonBriefDialog`:
- All dialog state is scoped to a unique session record tied to the specific open lesson.
- Re-opening or changing the lesson replaces the session in the same render, preventing choices or notices from leaking across lessons.
- Synchronous `isPendingSave` ref prevents double-clicks in the same render from dispatching duplicate save dialogs.
- Dialog controls are disabled and the dialog is nondismissible while a save operation is in flight.
- Asynchronous save completions, errors, and cleanup check the initiating session token; stale results from a previous lesson or session are dropped silently.

---

## Changed files

| File | Change |
| --- | --- |
| `src/logic/calendarExport.ts` | New: RFC 5545 calendar export writer, date/time arithmetic, TEXT escaping, octet folding |
| `src/logic/calendarExport.test.ts` | New: 20 unit tests covering conformance, edge cases, rollover, and injection prevention |
| `src/pages/Schedule/CalendarExportDialog.tsx` | New: Calendar export dialog component with session lifecycle and plain language |
| `src/pages/Schedule/CalendarExportDialog.test.ts` | New: 20 dialog lifecycle, concurrency, session isolation, and UI tests |
| `src/pages/Schedule/EventDetail.tsx` | Added "Add to calendar…" button and dialog integration |
| `src/logic/studyExport.ts` | Extended `exportFileName` to support `"ics"` extension |
| `src/services/studyExport.ts` | Extended `StudyExportKind` union to include `"calendar"` |
| `src-tauri/src/study_export.rs` | Extended `ExportKind::Calendar` (64 KiB limit, `.ics`, dialog title/filter) and native tests |

Source identities and SHA-256 checksums are recorded in [`source-hashes.json`](evidence/p54-05-calendar-export-2026-10-17/source-hashes.json).

---

## Requirement-to-test mapping

| Requirement | Test Location | Test Description |
| --- | --- | --- |
| Basic VCALENDAR/VEVENT structure, stable UID, UTC DTSTAMP | `calendarExport.test.ts` | `generates a valid calendar export with explicit start and end times` |
| Floating local date-times without Z/TZID | `calendarExport.test.ts` | `generates a valid calendar export with explicit start and end times` |
| Default 1-hour duration for start-only | `calendarExport.test.ts` | `adds one hour when only start time is provided` |
| Rollover across midnight, month-end, leap day, year-end | `calendarExport.test.ts` | `handles one-hour rollover across midnight, month end, leap day, and year end` |
| All-day event with exclusive next-day DTEND | `calendarExport.test.ts` | `handles date-only all-day event with exclusive next day end` |
| Validation refusal on missing start with end | `calendarExport.test.ts` | `refuses when end time is provided without start time` |
| Validation refusal on equal or inverted end time | `calendarExport.test.ts` | `refuses when end time is equal to or earlier than start time` |
| Validation refusal on invalid dates/times | `calendarExport.test.ts` | `refuses invalid date and malformed time values` |
| Floating local time across DST transitions | `calendarExport.test.ts` | `preserves floating local time on DST spring-forward and fall-back dates` |
| Cancellation and rescheduling status mapping | `calendarExport.test.ts` | `maps scheduled, cancelled, and rescheduled statuses correctly` |
| Omission of METHOD, SEQUENCE, ORGANIZER | `calendarExport.test.ts` | `strictly omits METHOD, SEQUENCE, and ORGANIZER` |
| TEXT escaping and newline normalization | `calendarExport.test.ts` | `escapes backslashes, commas, semicolons, and newlines in TEXT fields` |
| Property/component injection prevention | `calendarExport.test.ts` | `prevents property and component injection from user text` |
| 75-octet folding without breaking multibyte UTF-8 | `calendarExport.test.ts` | `folds long lines at 75 UTF-8 octets without splitting multibyte characters` |
| Exclusion of private fields (sentinel checks) | `calendarExport.test.ts` | `strictly excludes notes, journal, finances, materials, and questions` |
| Optional checklist inclusion | `calendarExport.test.ts` | `includes preparation checklist items only when explicitly selected` |
| Native Calendar kind, extension, 64 KiB size bound | `study_export.rs` | `a_calendar_export_is_its_own_bounded_ics_kind` |
| Button visibility in EventDetail (hidden for completed) | `CalendarExportDialog.test.ts` | `EventDetail displays Add to calendar for scheduled, cancelled, rescheduled; hidden for completed` |
| Checklist off by default | `CalendarExportDialog.test.ts` | `initializes with preparation checklist option unticked by default` |
| Browser mode explanation and no native dispatch | `CalendarExportDialog.test.ts` | `explains browser limitation and does not dispatch native save in browser mode` |
| Plain language explanations (import, sync, timezone) | `CalendarExportDialog.test.ts` | `explains calendar import, duplicate risk, and floating timezone clearly` |
| Exact filename, kind, and content dispatched | `CalendarExportDialog.test.ts` | `dispatches exact filename, kind, and content to saveStudyExport` |
| Duplicate-click protection | `CalendarExportDialog.test.ts` | `prevents duplicate dispatches on rapid double clicks in the same render` |
| Controls locked while pending | `CalendarExportDialog.test.ts` | `locks controls and dialog while save is pending` |
| Refusal and retry | `CalendarExportDialog.test.ts` | `handles save refusal and allows deliberate retry` |
| Session isolation across lesson change | `CalendarExportDialog.test.ts` | `resets session and choices when lesson changes while dialog is open` |
| Stale results from old sessions dropped | `CalendarExportDialog.test.ts` | `drops stale save completion if lesson changed while save was pending` |

---

## Verification gate results (Node 22.23.3, rustc 1.99.0; [receipts](evidence/p54-05-calendar-export-2026-10-17/README.md))

| Gate | Command | Result |
| --- | --- | --- |
| Focused suites | `npx vitest run src/logic/calendarExport.test.ts src/logic/lessonBrief.test.ts src/pages/Schedule/EventDetailCost.test.ts src/pages/Schedule/LessonBriefDialog.test.ts src/pages/Schedule/CalendarExportDialog.test.ts` | **70 passed**, exit 0 |
| Native study_export | `cargo test --locked --manifest-path src-tauri/Cargo.toml study_export` | **15 passed**, exit 0 |
| Full frontend | `npx vitest run` | **3,629 passed / 6 skipped** (167 test files), exit 0 |
| Full native | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | **533 passed / 6 ignored**, exit 0 |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | Clean, exit 0 |
| Production build | `npm run build` (`tsc --noEmit && vite build`) | Clean, exit 0 |
| Strict Clippy | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings` | 0 warnings, exit 0 |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Clean, exit 0 |
| Cargo lock sync | `node scripts/test-cargo-lock-sync.mjs` | Clean (0.5.5 in Cargo.toml and Cargo.lock), exit 0 |
| Schema-14 helper | `node scripts/mac-schema14-profile-snapshot.test.mjs` | **26 passed / 0 failed**, exit 0 |
| Diff hygiene | `git diff --check` | Clean, exit 0 |

---

## Deferred and unverified

- **Installed calendar application import:** Verifying how third-party calendar applications (Apple Calendar, Google Calendar, Outlook) display the generated `.ics` file is unverified in this automated test environment.
- **Native OS save dialog:** The actual macOS NSSavePanel UI display was not tested interactively.
- No application launch, production signing, installer creation, profile manipulation, or version bump took place.

---

**Next:** Independent Codex review of P54-05 Part B.
