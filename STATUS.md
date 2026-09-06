# Her Flight Deck — Current Project Status

_Last updated: 6 September 2026 · application version `0.4.0` · branch `main`_

## Current position

Her Flight Deck is a working private desktop application for Windows and macOS.
It is designed for a student pilot working toward an airline career and brings
her schedule, flight training, study materials, instructor feedback, finances,
records, reminders, and career planning into one application.

The current source is committed and pushed to GitHub:

- Repository: <https://github.com/rickydeleon49-ui/Flight-training->
- Branch: `main` (the repository default)
- Last feature commit: `0266d2c` — `fix: keep her Gemini key across updates`
- Application version: `0.4.0`
- Automated tests: **251 passing** across 26 files
- TypeScript production build: **passing**
- Rust desktop compilation: **passing**
- GitHub macOS DMG build and upload: **passing**
- GitHub Windows EXE build and upload: **passing**
- Linux desktop smoke test (`scripts/desktop-smoke.sh`): **passing**

**`0.4.0` is built but not published.** `v0.2.0` and `v0.3.0` are on the
Releases page with both installers attached, so the Release workflow is proven.
The version was bumped to `0.4.0` on `main` in `67579ee` and the Checks
workflow passed, but no `v0.4.0` tag was ever pushed — so the newest installers
she can download are still `0.3.0`, which predate the Gemini key fix in `#3`.
Publishing `0.4.0` is the next step and is described below.

There are no placeholder pages in the main application. The remaining work is
publishing, hands-on testing with a real Gemini key, and refinement based on
what the student and instructor find useful.

### Why the version is load-bearing

The application copies her database aside only when it notices the version has
changed since the last run. Four migrations (`0004`–`0007`) were added while
the version stayed at `0.1.0`, so anyone who installed an early `0.1.0` test
build and then installed a `0.1.0` release would have had four schema changes
applied with **no safety copy taken**. Releasing as `0.2.0` restored that
protection, and the same rule has applied to every release since: bump first,
and never rebuild an already-published number.

That rule is also why `scripts/release.sh 0.4.0` refuses to run today. The
repository is already at `0.4.0` and tags exist, so the script treats it as a
re-release. Publishing `0.4.0` has to go through **Actions → Release → Run
workflow**, which checks that the tag does not exist yet rather than that the
number changed. `scripts/release.sh` is the right tool for `0.5.0` onwards.

---

## Completed features

### 1. Flight Deck dashboard

- Personalized greeting, profile photo, current focus, and motivation note.
- A daily flight plan assembled from real application data.
- Most important next action.
- Next scheduled flight and its preparation checklist.
- Current training milestone and progress.
- Study focus and materials that need attention.
- Upcoming dates and overdue-item warnings.
- Encouragement based on recent progress.
- Links into the related lesson, goal, material, or action.

### 2. Flight Path

- Airline-oriented roadmap from initial training through certificates, hour
  building, ATP preparation, and airline applications.
- Built-in starter milestones and goals.
- Add, rename, reorder, update, and remove milestones.
- Goal status, notes, confidence rating, and checklist items.
- Evidence links from goals to lessons and study materials.
- Progress presentation that makes the next stage visible.

### 3. Airline pilot starter data

- A useful roadmap is preinstalled so the app is not empty on first launch.
- Includes training foundations, checkride preparation, certificate stages,
  airline-career planning, study references, lesson checklists, and prompts.
- Missing starter items can be restored from Settings without overwriting her
  personal information or uploads.

### 4. Study Library

- Upload real documents through the native Windows or macOS file chooser.
- Uploaded files are copied into the application's private data directory.
- Supported library files include PDF, images, text, Markdown, RTF, and DOCX.
- Titles, types, topics, priorities, review status, tags, goals, and lesson links.
- Search and filtering by status, topic, type, title, notes, and tags.
- Personal notes for every material.
- Questions and next actions attached to a material.
- Missing-file detection with an understandable warning.
- Open a stored file in the operating system's normal viewer.
- Deleting a material also deletes its private stored copy after confirmation,
  and its generated study set.

### 5. Gemini study assistant

- Optional Gemini connection in Settings.
- **Sign in with Google** opens Google AI Studio so the student can sign in and
  create a free Gemini API key.
- The key is entered once and stored in a file inside the application data
  folder, restricted to her account where the platform supports it; it is never
  saved in SQLite, included in backups, displayed again, returned to the
  interface, or committed to GitHub.
- It moved there out of the operating system's credential manager: a macOS
  keychain item is tied to the saving application's code signature, and this
  application is unsigned, so each update was a stranger to the keychain and
  she had to paste the key again. An existing key is migrated automatically on
  first run when the keychain still permits it.
- The application checks the key with Google before accepting it.
- Disconnecting Gemini removes the stored credential but keeps generated work.
- A selected document can generate a summary, an organized study guide,
  source-focused sections, 10–20 flashcards, page references where the source
  supports them, and cautions where the source is ambiguous or outdated.
- Generated guides and flashcards are saved locally in SQLite and remain
  available without an internet connection.
- Regenerating replaces that document's previous AI study set.
- Gemini receives only the document whose **Create study aid** button is used.
  It does not receive the profile, flight log, finances, notes, or other files.
- Nothing is sent without an explicit confirmation naming the file, and two
  categories are refused outright: a file attached to a certificate, medical or
  identification record, and anything filed as an administrative document. The
  Gemini card explains the refusal instead of offering the button.
- Gemini analysis currently accepts PDF, TXT, Markdown, PNG, JPG, and WebP.
  RTF and DOCX files can still be stored, but must be converted to PDF before
  AI analysis.
- Files are limited to Gemini's current 50 MB document limit.
- Free-tier quota errors receive a clear wait-and-retry message.
- Every AI result is visibly identified as a study aid that must be checked
  against the source, current FAA publications, aircraft documents, the flight
  school, and the instructor.

Important: Google states that free-tier inputs and outputs may be used to
improve its products. Medical documents, certificate copies, addresses,
personal logbook information, or other sensitive material should not be sent.
The application warns about this but does not currently block it — see
"Known limitations".

### 6. Schedule and lesson preparation

- Month calendar and upcoming-event views.
- Flight lessons, study sessions, ground school, instructor meetings, tests,
  medical dates, deadlines, and personal commitments.
- Add, edit, reschedule, complete, cancel, and remove events.
- Preparation checklists for each lesson.
- Study materials attached to lessons.
- Planned and actual lesson costs.
- Questions that should be asked before the next lesson.
- Training details from Settings prefill new lessons.

### 7. Flight Journal and instructor flight log

- Structured post-flight debriefs connected to scheduled lessons.
- Aircraft type and identifier, departure and arrival airports, instructor.
- Total, dual received, solo, PIC, cross-country, night, actual instrument, and
  simulated instrument time.
- Day and night landing counts.
- Mission, skills practiced, successes, difficulties, instructor feedback,
  next-session questions, and confidence rating.
- Historical list of completed entries.
- Dedicated instructor-feedback view across lessons.
- Summary calculations for logged flights and hours.
- Flight time is explicitly treated as a personal training record, not a
  replacement for the student's authoritative pilot logbook.

### 8. Questions

- Running list of questions for the instructor.
- Statuses for To Ask, Asked, Answered, and Revisit.
- Store answers and connect questions to lessons, journal entries, or study
  materials.
- Unanswered questions appear in preparation and dashboard views.

### 9. Finances and Flight Fund

- Contributions and training expenses in one ledger.
- Categories for lessons, rentals, instructors, exams, medicals, books,
  equipment, fees, travel, and other costs.
- Current fund balance calculated from transactions rather than manually typed.
- Savings target and progress.
- Upcoming planned lesson costs.
- Record a completed lesson's cost without creating duplicates.
- Spending summaries and training-cost observations.
- All money is stored as integer cents to avoid rounding errors.

### 10. Pilot Toolkit

- **Checkride readiness:** knowledge, flight, and administrative preparation
  with Not Started, Learning, Feels Ready, and Instructor Signed Off states.
- **Instructor report:** printable training summary with flight totals, current
  goals, recent instructor feedback, and discussion space.
- **Certificates and records:** private organizer for certificates, medicals,
  endorsements, knowledge tests, practical tests, identification, and other
  records, including issue/expiry dates and optional library attachments.
- **Cost forecast:** tracked spending, observed or estimated hourly cost,
  estimated hours remaining, additional costs, and projected total.
- **Safety check:** IMSAFE-style personal check-in plus weather, aircraft, and
  personal-minimum prompts. It records the student's own Go, Discuss, or No-Go
  note but never makes the decision for her.
- **Knowledge quizzes:** eight built-in conceptual review questions with
  explanations, scores, attempt history, and weak-topic suggestions. They cover
  fundamentals such as angle of attack, transponder codes, and priority order,
  and deliberately avoid specific regulatory numbers, which change and belong
  to current FAA sources.
- **Reminders:** configurable reminder window for actions, training events,
  medical dates, and saved credential expiry dates.
- **Career portfolio:** printable airline-career snapshot with total time, PIC,
  cross-country time, milestones, credentials, professional summary, target
  employer, and next career step.

### 11. Popup reminders

- Reminder popup can be enabled or disabled.
- The number of days to look ahead is configurable from 0 to 90.
- Includes due actions, scheduled training, medical dates, and credential
  expirations.
- An in-app reminder appears when the application opens.
- The application requests an operating-system notification when supported and
  permitted while the app is running.
- It does not currently run a background service after the app is closed.

### 12. Settings and personalization

- Student name, certificate goal, and current focus.
- Flight school, instructor, home airport, usual aircraft, and training start.
- Medical-expiration reminder.
- Personal "why I started flying" note.
- Locally resized profile photo.
- Berry, lavender, sky, and mint accent themes.
- Restore missing airline starter items.
- Gemini connection and privacy information.
- Data-location display, portable backup, and safe restore.

### 12b. Everyday conveniences

- **Quick Find** opens from anywhere with ⌘K on macOS or Ctrl+K on Windows,
  and from the Search button above the navigation. It searches materials,
  lessons, flight records, goals, milestones and questions at once, ranks a
  title that starts with what she typed above one that merely contains it,
  and also jumps to any section by name. Arrow keys move, Enter opens,
  Escape closes.
- **Undo after deleting.** Confirming a deletion hides the record and starts a
  seven-second window with an Undo bar; the removal happens for real only when
  the window closes. Materials, lessons, flight records, goals, milestones,
  questions, transactions, next actions and records-organizer entries all go
  through it. Quitting inside the window leaves the record in place, which
  errs toward keeping her data.
- **Nothing typed is lost.** A flight debrief is mirrored to local browser
  storage as it is written and comes back if she leaves the page, with a
  "Start fresh" button to throw it away. The draft is cleared once the entry
  is saved. Personal notes on a study material save themselves shortly after
  she stops typing, and show "Saving…" then "Saved".
- **Filters stay put.** The Study Library's search, topic, type, status and
  sort, and the Questions status filter, are kept for as long as the app is
  open, so opening a material and coming back does not reset them. Each launch
  starts clean. The library also gained a sort control: recently added,
  priority, or title.

### 13. Data protection

- SQLite stores structured application data locally.
- Uploaded files live beside the database in private application storage.
- Windows location: `%APPDATA%\com.herflightdeck.app\`
- macOS location: `~/Library/Application Support/com.herflightdeck.app/`
- The bundle identifier `com.herflightdeck.app` anchors this location and must
  not be changed in a normal update.
- Before a new application version opens the database, it creates a safety copy.
  A copy is also taken when the version marker is missing, so a database whose
  origin is unknown is never opened without one.
- Ten automatic database safety copies are retained, and folder names are made
  unique so two copies inside one second cannot overwrite each other.
- Any safety copy can be put back from Settings, or from the recovery screen.
  These copies hold the database only, so uploaded documents are left in place.
- A copy can also be taken on demand: **Save a copy on this computer**.
- Migrations are additive and protected by checksum tests.
- Tests reject migrations that drop, rename, truncate, or delete existing data.
- Every personal setting — name, school, instructor, home airport, aircraft,
  training start, medical date, why-note, photo and accent — lives in one row
  of the same database. Tests prove it survives closing and reopening the
  application, and prove a fully personalized profile written under an older
  schema still reads back intact after every later migration is applied.
- Settings can create a complete `.hfdbackup` containing the database, photo,
  flight log, generated study aids, and every uploaded document.
- The write-ahead log is checkpointed into the database before a complete
  backup is written, a blocked checkpoint stops the backup rather than saving
  an incomplete one, and the log is archived alongside the database if it still
  holds anything. A backup can therefore never be missing the current session.
- Restore inspects the archive before changing anything, checks the SQLite
  header before and after extraction, moves the current data into a recoverable
  copy, installs the selected backup, and restarts.
- A backup written by a newer application version is refused with an
  explanation instead of installed.
- Settings records when the last complete backup was saved and which version
  wrote it, and asks for a fresh one after an update or after fourteen days.
- If the database cannot be opened at all, a recovery screen replaces the error
  message: it shows the data folder and offers to put back a `.hfdbackup` file
  or any automatic copy. It needs no working database.

### 14. Desktop and release infrastructure

- Tauri 2 desktop application with React, TypeScript, Rust, and SQLite.
- Hash routing supports packaged desktop navigation.
- Bundled fonts and assets require no CDN.
- Production content-security policy is active.
- Windows builds an x64 NSIS `.exe` installer on a GitHub Windows runner.
- macOS builds an Apple Silicon `.dmg` installer on a GitHub macOS runner.
- A universal macOS build can be produced separately for Intel compatibility.
- Manual test-build workflow can build Windows, macOS, or both.
- Release workflow validates the version, creates a tag, builds both installers,
  calculates checksums, and publishes a GitHub Release. Run twice, for `v0.2.0`
  and `v0.3.0`; both succeeded.
- Rust and npm caches reduce later GitHub Actions build times.
- Neither installer is currently code-signed.

---

## Verified behavior

Verified on this machine:

- `npm test`: **26 test files and 251 tests pass**.
- `npm run typecheck`: passes with strict TypeScript settings.
- `cargo check`: Rust backend compiles, including the Gemini, TLS, and keyring
  code.
- `scripts/desktop-smoke.sh`: the real desktop window opens, the Rust migration
  runner builds all 20 tables, the native file chooser opens from the photo
  input, the photo reaches the real database downscaled, her data is still
  there after the application is closed and reopened, and a new version's first
  run copies the database aside into a working copy that holds her photo while
  leaving the live data untouched.
- `cargo test` (31 tests): backup and restore end to end against real files —
  a complete archive put back with every document, a safety copy put back
  without disturbing uploads, the write-ahead log travelling with the database,
  a damaged archive refused before anything moves, and an archive carrying an
  unexpected file refused outright.
- Database migrations apply to a new database and upgrade an existing populated
  database without losing its records.
- The Gemini API key appears in no migration, is absent from the backup code,
  and is never part of any value returned to the interface.
- Generating a study aid sends only the prompt and the one selected document.
- The complete end-to-end application workflow is covered through lesson
  preparation, study, debrief, follow-up action, and cost recording.
- Driven in a real browser against the running interface: Quick Find opens by
  keyboard and by button, filters as she types, navigates on Enter and closes
  on Escape; deleting shows the Undo bar, Undo keeps the record, and a
  deletion left alone is still gone after a reload; library filters and sort
  survive leaving the page; an unsaved debrief comes back; material notes save
  themselves without a button.

Verified on GitHub Actions:

- macOS build, DMG packaging, and artifact upload succeed.
- Windows build, NSIS packaging, and artifact upload succeed.
- The Release workflow, twice: `v0.2.0` and `v0.3.0` both published with the
  `.dmg` and the `.exe` attached.
- Checks (tests, types, production build, Rust backup and restore guards) on
  every pull request and every push to `main`.

Not verified anywhere yet:

- A real Gemini API request. No key is stored in any development environment.
- The native file chooser on macOS and Windows. It is verified only on Linux.
- Installing `0.4.0` over an existing `0.3.0` install.

GitHub test-build artifacts appear at the bottom of a completed Actions run as
`her-flight-deck-macOS` and `her-flight-deck-Windows`. GitHub packages each as
a ZIP; extract it to obtain the `.dmg` or `.exe`.

---

## What still needs hands-on testing

### Gemini connection

The Gemini code compiles and its database behavior is tested, but an actual API
request has not been made because no personal Gemini key is stored in the
development environment. The first real test should be:

1. Install the new build.
2. Open **Settings → Gemini study assistant**.
3. Select **Sign in with Google**.
4. Create a free key in Google AI Studio and copy it.
5. Paste the key into Settings and select **Connect Gemini**.
6. Add a short, non-sensitive PDF to the Study Library.
7. Open that material and select **Create study aid**.
8. Confirm the guide and flashcards match the source.
9. Close and reopen the app and confirm the generated material remains.
10. Try **Regenerate** and confirm it replaces the older generated set.

Use a short public FAA document or an invented test document for this first
check, not a certificate, medical record, or personal logbook.

### Normal desktop smoke check

- Confirm the existing data remains after installing over the prior version,
  and that a copy appears under `backups/` ending in `before-0.4.0`.
- Upload and open a document through the native file chooser.
- Add and edit a lesson.
- Save a flight-journal entry with flight time.
- Check the reminder popup.
- Create a complete `.hfdbackup` in a separate folder.
- Restart the application and confirm all new data remains.

---

## Known limitations

- Google Sign-In does not directly grant a third-party desktop application
  Gemini API access. The student must create and paste a free API key once.
- Gemini requires an internet connection only while connecting or generating.
- Free-tier Gemini content may be used by Google to improve its products.
- Sensitive documents are blocked from AI analysis by material type and by
  record attachment, which are the signals the application actually holds. A
  personal document filed as ordinary study material under a study type is not
  detected; the confirmation names the file so that mistake is visible before
  anything is sent, but it is not prevented.
- Gemini results are not authoritative flight instruction and may contain
  mistakes. Source and instructor verification are mandatory.
- AI-generated guides can be regenerated but do not yet have a dedicated
  section-by-section editor.
- Flashcards do not yet track spaced-repetition scores or scheduling.
- DOCX and RTF are library formats but not Gemini-analysis formats.
- Reminder notifications do not run when the application is fully closed.
- There is no automatic application updater. Install a newer version over the
  existing one; the student's data remains in place.
- Installers are unsigned, so Windows SmartScreen and macOS Gatekeeper show a
  first-run warning.
- The standard macOS workflow builds for Apple Silicon. An Intel or universal
  Mac build requires an additional target.
- Automatic pre-update database copies remain on the same computer and do not
  include documents. Use complete `.hfdbackup` files for protection against a
  lost or failed computer.
- Uninstalling on Windows offers to delete application data. Tauri 2 has no
  configuration option to remove that choice, so it is documented rather than
  prevented: leave the box unticked, and keep a complete backup elsewhere.
- Some newer interface files contain very long single lines, which makes review
  and future changes harder than they should be. Worth reformatting.

---

## How to build and distribute it now

### Test build

1. Open the repository's **Actions** page.
2. Choose **Build desktop app (test)**.
3. Choose **Run workflow**.
4. Select Windows, macOS, or both.
5. When the run completes, download the artifact at the bottom of the run.

Artifacts are temporary test downloads, not permanent releases.

### Publish version 0.4.0

1. Open **Actions → Release → Run workflow**.
2. Enter `0.4.0`.
3. Run the workflow.
4. Download or share the installers from the repository's **Releases** page.

The release workflow creates `v0.4.0`, packages both installers, and writes
human-readable installation and update instructions. It has done this twice
already; if it fails, the Actions log will say why.

Do not use `scripts/release.sh 0.4.0` for this one — see "Why the version is
load-bearing" above. From `0.5.0` onwards the script is the right route.

Because the repository is private, the recipient needs repository access to
download directly. Otherwise, download the installer and send the single file
to her yourself.

### First launch

- Windows: choose **More info → Run anyway** if SmartScreen appears.
- macOS: use **System Settings → Privacy & Security → Open Anyway** if
  Gatekeeper blocks the unsigned application.

---

## Important engineering rules for future work

- Do not change `com.herflightdeck.app` without a deliberate data migration.
- Never edit an already-shipped migration; add the next numbered migration.
- Register every migration in Rust and TypeScript and record its checksum.
- Never embed or commit a Gemini key.
- Never return the Gemini key to the React webview.
- Keep Gemini document submission explicit and limited to one selected file.
- Keep aviation safety disclaimers visible around generated material.
- Keep monetary values stored as integer cents.
- Keep errors crossing the Tauri boundary readable as strings.
- Keep macOS minimum version at 12.0 or higher while native `<dialog>` is used.
- **Increase the version before publishing a release**, or the pre-update
  safety copy of her database will not be taken.
- GitHub Actions expressions cannot use the `matrix` context in a job-level
  `if:`. A workflow that does is rejected as invalid and fails on every push.

---

## Recent milestone commits

| Commit | Completed work |
| --- | --- |
| `0266d2c` | Gemini key kept across updates, in a file beside her data |
| `75c50f4` | Recovery screen, safety-copy restore, WAL-safe complete backups |
| `27c51af` | Gemini study assistant, secure key storage, generated guides and flashcards |
| `15a0338` | Integrated pilot toolkit, reminders, readiness, records, safety, quizzes, forecast, and career portfolio |
| `014e1cf` | Complete portable backup and safe restore |
| `91d4c16` | Instructor flight log and training-time fields |
| `2877138` | Airline pilot starter pack |
| `20f4ea4` | Valid cross-platform desktop build workflow |
| `af0198c` | Pre-release review fixes |
| `4535334` | Downloadable Windows and macOS installers |
| `86af956` | Cross-platform builds and update-safe local data |

## Bottom line

The application is built, both platforms package successfully, and `0.3.0` is
published and installable. The immediate next steps are publishing `0.4.0` —
which carries the Gemini key fix she needs so she stops re-pasting her key
after every update — installing it over `0.3.0`, and connecting a real free
Gemini key to generate one study aid from a safe test PDF, then collecting
feedback from the student and her instructor.

One dated dependency to watch: the Gemini model is the hardcoded constant
`gemini-2.5-flash` in `src-tauri/src/gemini.rs`, and Google has announced a
shutdown date of 16 October 2026 for it. When that day comes, every installed
build asking for it stops working. Moving to a current Flash model is a
one-line change, but it needs a release to reach her, so it should not wait
until the day it breaks.
