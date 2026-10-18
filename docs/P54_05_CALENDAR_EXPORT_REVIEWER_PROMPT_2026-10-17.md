# P54-05 Part B (Calendar Export) Reviewer Prompt

**FOR INDEPENDENT CODEX REVIEW — DO NOT MERGE.**

Gemini implemented P54-05 Part B (single-lesson calendar export), completing the approved roadmap item from accepted main `2fc27b90aacd33183a8e5c0f3047008df37383b4`.

---

## Artifacts to Review

1. **Implementation report:** [`docs/P54_05_CALENDAR_EXPORT_REPORT_2026-10-17.md`](P54_05_CALENDAR_EXPORT_REPORT_2026-10-17.md)
2. **Evidence directory:** [`docs/evidence/p54-05-calendar-export-2026-10-17/`](evidence/p54-05-calendar-export-2026-10-17/README.md)
   - Source hashes and byte counts in `source-hashes.json`
   - Gate receipts in `*.log` and `*.exit` (all exiting with code 0)
   - Checksums verified via `SHA256SUMS`
3. **Core source files:**
   - `src/logic/calendarExport.ts`: RFC 5545 calendar formatter, date arithmetic, line folding, escaping
   - `src/logic/calendarExport.test.ts`: Conformance and validation tests (20 tests)
   - `src/pages/Schedule/CalendarExportDialog.tsx`: UI dialog, session lifecycle, plain language explanations
   - `src/pages/Schedule/CalendarExportDialog.test.ts`: Dialog lifecycle, concurrency, session isolation (20 tests)
   - `src/pages/Schedule/EventDetail.tsx`: Action button integration
   - `src/logic/studyExport.ts` & `src/services/studyExport.ts`: Extension and export kind extension
   - `src-tauri/src/study_export.rs`: Native `ExportKind::Calendar`, size limit, `.ics` extension, Rust tests

---

## What to Inspect

### 1. RFC 5545 Conformance & Safety (`calendarExport.ts`)
- **Reviewer corrections honored (OD-5):** Verify `METHOD` and `SEQUENCE` are strictly omitted. Verify `ORGANIZER` and attendees are absent.
- **Time Representation:** Verify `DTSTART` and `DTEND` use floating local date-times without `Z` or `TZID`, while `DTSTAMP` is in UTC.
- **Pure Date Arithmetic:** Verify that adding 1 hour to start-only events does not use UTC or timezone shifts that could cause drift on DST boundary dates or cross-day rollovers (midnight, month end, leap day, year end).
- **Validation Refusals:** Verify that end-without-start, equal or inverted start/end times, and malformed dates/times (e.g. Feb 30, hour 25) cleanly throw errors rather than silently normalizing.
- **Line Folding:** Verify that lines fold at no more than 75 UTF-8 octets, continuation lines start with CRLF + space, and multibyte UTF-8 characters are never bisected.
- **Injection & Escaping:** Verify backslashes, semicolons, commas, and newlines are escaped according to RFC 5545, and disallowed control characters are stripped.

### 2. Privacy & Scope Enforcement
- Inspect the projection logic to ensure only title, location, type, instructor, and optional preparation checklist item titles are included.
- Verify sentinel tests in `calendarExport.test.ts` prove notes, journals, questions, materials, and finances are strictly excluded.

### 3. Dialog Concurrency & Session Lifecycle (`CalendarExportDialog.tsx`)
- Inspect the session ownership architecture (following the accepted BRIEF-R1/R2 pattern).
- Verify that a lesson change or dialog reopen creates a fresh session during the same render and prevents stale async completions from publishing.
- Verify the synchronous double-dispatch guard (`isPendingSave.current`).
- Verify that controls are disabled and the dialog is nondismissible while a save is pending.
- Verify browser mode displays the desktop-only explanation and dispatches no native command.

### 4. Native Bounded Saving (`study_export.rs`)
- Verify `ExportKind::Calendar` enforces `MAX_CALENDAR_BYTES = 64 * 1024` (64 KiB), uses filter `"Calendar file"`, extension `"ics"`, and title `"Save calendar file"`.
- Verify tests in `study_export.rs` check serde deserialization and the 64 KiB boundary.

---

## What Remains Unverified

- **Third-Party Calendar Applications:** Actual importing into Apple Calendar, Google Calendar, or Outlook has not been tested with installed software.
- **Native OS File Dialog:** The actual appearance and user interaction with the macOS native file save sheet is unverified in automated tests.
- **No Release Steps:** No application launch, production signing, installer generation, or version bump took place.

---

## Reproduction Commands

```bash
# 1. Focused suites (70 tests)
npx vitest run src/logic/calendarExport.test.ts src/logic/lessonBrief.test.ts src/pages/Schedule/EventDetailCost.test.ts src/pages/Schedule/LessonBriefDialog.test.ts src/pages/Schedule/CalendarExportDialog.test.ts

# 2. Native study export tests (15 tests)
cargo test --locked --manifest-path src-tauri/Cargo.toml study_export

# 3. Full gates
npx vitest run
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run typecheck
npm run build
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
node scripts/test-cargo-lock-sync.mjs
node scripts/mac-schema14-profile-snapshot.test.mjs
git diff --check
```
