# Her Flight Deck — current project status

_Updated 26 September 2026 · Latest release: `v0.5.1` · Version `0.5.2` permanently retired · **Windows release on hold, see below**_

## M1 D3–D4 — Daily Flight Plan and saved daily decisions (26 September 2026)

Flight Deck now opens with a **Daily Flight Plan** card. She can:
- choose a 10-, 20- or 30-minute (or untimed) plan;
- read why each suggestion is there;
- press **Start**, **Skip today** or **Move to tomorrow** on each item.

Unfinished work stays under "Remaining unfinished work".

How it behaves:
- **Stable sessions.** The day's session keeps its saved order. New or higher-priority work waits until **Refresh**, a budget change or the next local day. A completed, deleted, skipped or deferred item's slot is the only one refilled.
- **Skip and defer are planner-only** and never change a due date. Both expire at local midnight, which the card notices while open and after sleep or backgrounding.
- **Saving.** Decisions are stored in the existing `app_metadata` table (no migration). Each change is computed from the stored plan inside the serialized write queue, so quick clicks can't overwrite each other, and a failed save leaves the previous plan untouched.
- **Start safety.** Start never lands on a deleted record, and it focuses a Flight Deck action's own control.

Status: Independent review passed, including all 62 focused tests; awaiting the pull-request CI and merge gate. D1–D2 merged through PR #32 at `e938f84`. Installed-app behaviour has not been verified on Windows or a Mac. See [the D3–D4 behaviour and evidence note](docs/M1_D3_D4_DAILY_PLAN_2026-09-26.md).

## M1 D1–D2 — Daily Flight Plan recommendations and debrief characterization (25 September 2026)

Debrief persistence across normal user edits, SQLite disk reloads, and parent deletion has been characterized against real SQLite persistence in `src/logic/debriefCharacterization.test.ts` (D1). When a debrief journal entry is deleted, SQLite's foreign key `ON DELETE SET NULL` clears `question.journal_id`, whereas `next_actions.related_id` survives as a dangling reference without foreign key cascade. Debrief-created questions omit `eventId` (`null`), so `lessonPreparation` excludes them from upcoming lesson prep lines until explicitly linked (identified for future D6 work). Debrief actions lack direct associations with Study Library materials (future D6).

The pure recommendation selector has been implemented in `src/logic/recommendations.ts` with tests in `src/logic/recommendations.test.ts` (D2). It enforces strict deterministic priority tiers: 1. User-pinned work -> 2. Due actions (overdue oldest first, then due today) -> 3. Next-lesson prep -> 4. Study -> 5. Open actions. Tie-breaking is deterministic down to title and unique ID. When a time budget (10, 20, 30 min) is requested, tasks with unknown durations are kept visibly unknown without fabricated durations or zero-minute representation and remain reachable in priority order without falsely claiming the entire session fits the budget. When any suggested item has an unknown duration, timed items disclose known allocations explicitly as estimates without claiming guaranteed session fits or remaining time. Deleted/archived debrief parents fall back safely to unlinked action/question explanations to prevent dangling links. The selector is 100% pure (zero database writes, zero silent action acceptance, zero skill proficiency mutations, zero clock dependency).

Status: Merged through PR #32 at `e938f84`. D3–D4 are described above. See [the D1–D2 implementation and validation note](docs/M1_D1_D2_RECOMMENDATIONS_2026-09-25.md).

## M1 D0 — Study Library file check (25 September 2026)

Merged through PR #31 at `193d3e1`. Settings now has a **Check library** action that compares Study Library file references with files in app-owned storage. It lists missing files for re-attachment and unlinked files for import as new materials or an explicit move to private trash. Re-attachment retains the existing material and its notes, guide, flashcards, and practice history. Native repair commands recheck the file and database state inside bounded SQLite transactions and refuse to move referenced files to trash. The scan fails visibly on unreadable database or trash metadata rather than presenting an incomplete report as healthy. The scan and repair commands run off the UI thread, and the Settings list renders 50 results at a time.

The private-trash Undo action lasts until app restart. Startup cleanup purges unreferenced staged files by existing design; this is a reversible short undo, not a permanent recycle bin. The UI says so. A complete backup excludes unlinked files, so any needed file should be imported or re-attached before relying on a new backup. See [the implementation and validation note](docs/M1_D0_LIBRARY_CHECK_2026-09-25.md). Installed-app behavior on Apple Silicon remains unverified, and the release hold is unchanged.

## Release status

Version `0.5.2` was prepared on 14 September 2026 and withdrawn the same day following an unresolved Windows Defender detection (`Trojan:Win32/Wacatac.B!ml`). Per repository release policy (`scripts/release-policy.json`) and automated validation checks, version `0.5.2` is **permanently retired and must never be reused, re-tagged, or published**. The latest distributable release remains `v0.5.1`. The next release must be `0.5.3` or later, and no future release should be prepared until the Windows hold is resolved (by authoritative Microsoft clearance of the exact installer or trusted code signing) and physical installed-application validation on Windows and Apple Silicon hardware is satisfied. Paid code signing is the long-term path, but is not mandatory if Microsoft clears the exact binary.

## Release-safety hardening update (24 September 2026)

Following release-safety corrections for data protection, deletion recovery, and workflow efficiency:

- **Complete backup consistency across SQLite and managed documents:**
  - Format-v3 backup export handles pre-existing database and document inconsistencies cleanly: referenced documents missing from disk are allowed and recorded in `manifest.missing_at_export` (reported in `missing_documents`); unreferenced orphan files on disk are excluded from the archive (preventing backup drift) and reported in `unreferenced_documents`. In the UI, Settings displays a plain-language summary naming any omitted missing files (by material title or file name) and advising she can re-attach them in the Study Library, notes any unreferenced files excluded, and both Settings and DataRecovery restore preview dialogs call out any files that were already missing when the backup was made.
  - If recording the backup reminder in app settings fails after an archive is finalized and verified, Settings retains and displays the full missing-document and unreferenced-file warnings alongside the reminder update notice.
  - Preserves restore compatibility with existing format-v2 archives: older v2 exports that included unreferenced documents or omitted files already missing from storage continue to inspect and restore with those differences disclosed. SHA-256 integrity for archived files, path safety, and size limits remain enforced; strict two-way document completeness applies to format v3.
  - Differentiates pre-existing missing files from mid-export deletions by scanning documents before and after taking the database snapshot: a referenced file is treated as pre-existing missing only if absent from both scans; a referenced file present before the snapshot and gone after, or currently staged in `documents/.trash`, triggers a transient retry. Mid-export document mutations or unexpected file appearances are likewise refused with bounded retry (`COMPLETE_BACKUP_RETRIES = 3`, 200 ms interval) executing safely off the UI thread via `spawn_blocking`.
  - Atomic `.part` file finalization protects existing valid backups, ensuring the original is restored untouched if an export fails.
  - Deterministic Rust regression tests verify in-flight disappearing documents (pre-collection and mid-collection), staged deletions in progress, corrupt staged metadata, in-flight appearing files, in-flight mutation, bounded retry exhaustion, format-v3 completeness enforcement, old-style v2 restore, missing-document export/restore, and orphan exclusion.
- **Recoverable Study Library deletion:**
  - Two-phase staged deletion: managed files are moved to private trash (`documents/.trash`) before SQLite database records are deleted.
  - Traversal defense: `validate_staged_id` rejects path separators, `..`, colons, and NUL bytes on commit/rollback; metadata `original_relative_path` is validated against directory traversal before restoration.
  - Safe against destination path collisions: explicit rollback (`rollback_delete_document_in`) and startup recovery (`cleanup_staged_deletions_in`) use an atomic no-replace operation (`renamex_np` with `RENAME_EXCL` on macOS; `renameat2` with `RENAME_NOREPLACE` on Linux; `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` on Windows) to eliminate TOCTOU overwrite windows. If the destination path already exists, neither replaces the existing file, both the destination and staged copy in `.trash` (including `.meta`) are preserved intact and recoverable, and the conflict is reported.
  - Schema safety on startup: `cleanup_staged_deletions` refuses to purge staged files if the database is readable but the expected `study_materials` table or `file_path` column is missing or invalid, keeping staged copies safe until a valid schema is present.
  - Frontend lifecycle extracted to `removeMaterialWithFile`: staging failure leaves the database record untouched with an actionable retry message; database deletion failure rolls back the staged file; successful database deletion commits/purges trash; materials without files or with already-missing files proceed safely. Undo cancels the pending delete, and only the commit path calls `removeMaterialWithFile`.
  - Deleting a material whose file is locked (e.g. open in a PDF viewer on Windows) fails safely by design: staging fails, the record and file are kept, and she is prompted to close the file and try again.
  - Startup recovery hook `cleanup_staged_deletions` reconciles `.trash` with the active database, restoring documents if the database record still exists (crash before DB update) or purging staged files if the record is gone (crash after DB update). If restore rename fails or the database is missing, unreadable, or corrupted, it logs and safely leaves staged files untouched.
  - Preserves 7-second undo behavior without premature file deletion.
  - Added unit tests in `documents.rs` and frontend lifecycle tests in `documents.test.ts` verifying all failure and recovery branches.
- **GitHub Actions release gate & concurrency:**
  - Release workflow (`.github/workflows/release.yml`) configures `cancel-in-progress: false` grouped by workflow and version/ref so in-progress release builds and packaging jobs are never cancelled by subsequent runs.
  - Added a full Rust validation gate on Linux CI before packaging: installs required Linux desktop development libraries (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`, `libxdo-dev`) and runs `cargo test` as an authoritative pre-packaging gate.
  - Streamlined `checks.yml` with a lightweight verification path for documentation-only pull requests while strictly preserving the single required check status (`Tests, types, and the data-safety guards`). The docs filter is strictly scoped to actual documentation paths (`LICENSE(\.txt)?$`, `docs/`, etc.) so arbitrary text changes (config or test fixtures) cannot skip required CI checks.
  - Eliminated redundant frontend and Rust test suite executions on macOS and Windows packaging runners in `build-desktop.yml` and `release.yml`, refocusing runner minutes on platform packaging and metadata verification (including Windows NSIS installer verification).
- **Dependency findings confirmation:**
  - Confirmed `glib 0.18.5` is absent on Windows/macOS and present solely in the Linux GTK development/CI graph.
  - Confirmed `rsa 0.9.10` (RUSTSEC-2023-0071) is absent from the resolved dependency graph for all release targets (`cargo tree --target all -i rsa` produces no paths). `.cargo/audit.toml` ignores this finding so `cargo audit` runs cleanly.
  - Confirmed `ttf-parser 0.25.1` is transitive exclusively through `lopdf`.
  - Confirmed `keyring` is restricted solely to legacy secret migration in `gemini.rs`. No speculative replacements.
- **Validation evidence:** On Windows x64: `npm test` passed 405 tests across 45 test files (2 benchmarks skipped); `npm run build` completed with 0 errors; `cargo test` passed 128 tests (2 benchmarks ignored); `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed cleanly with 0 warnings.
- **Mac-only uncertainty:** The desktop app is **not declared ready for Mac** without an installed Apple Silicon smoke test. In particular, native file dialogs, Finder reveal, local backup creation and restore, and PDF/Study Library viewer interactions require hands-on physical verification on Apple Silicon hardware.

## Pre-release audit update (24 September 2026)

A full pre-release readiness audit was completed following the Study Library file-lifecycle fixes (PR #27) and Gemini workflow hardening (PR #28). See [the comprehensive audit report](docs/PRE_RELEASE_AUDIT_2026-09-24.md) for full architectural reviews, security boundaries, and validation evidence.

- **Dependency audit status:**
  - `rustls 0.23.43` was upgraded to `0.23.45` via `cargo update -p rustls`. `cargo audit` confirms RUSTSEC-2026-0285 (TLS 1.3 handshake acceptance across encryption level boundaries) no longer appears in the advisory scan. The full test and build matrix provides evidence that no regressions were introduced.
  - Current `cargo audit` is not fully clean: it exits with one vulnerability finding for `rsa 0.9.10` (RUSTSEC-2023-0071, Marvin timing sidechannel), for which no patched stable release exists upstream.
  - Shipped-build exposure to `rsa` is absent: both `cargo tree -i rsa` and `cargo tree --target all -i rsa` print no path. The package remains in `Cargo.lock` through optional SQLx/MySQL dependency metadata, but is not present in the resolved dependency graph for the project's current SQLite-only feature set (`tauri-plugin-sql = { features = ["sqlite"] }`).
  - Informational maintenance warnings in `cargo audit` (not exploitable security vulnerabilities): `ttf-parser 0.25.1` is unmaintained and present through `lopdf` (tracked for future `lopdf` updates); `glib 0.18.5` has an unsoundness advisory in the Linux GTK dependency graph (tracked for Linux development/CI, though Linux is not a release artifact); and `proc-macro-error 1.0.4` and the `unic-* 0.9.0` crates are unmaintained transitive/build dependencies (tracked through upstream Tauri updates).
- **Workflow & Lifecycle verification:** Confirmed app-owned storage (`DOCUMENTS_DIR`), capability-scoped Open/Reveal (`opener:allow-open-path`), automatic/manual splitting limits and SQLite single-connection transactions (`save_split_materials`), v2 backup SHA-256 integrity inventory, and full component-wide Gemini lock mutual exclusion with stale result rejection.
- **Accessibility & UX:** Verified practice-test WAI-ARIA roving tabIndex radio group keyboard navigation, focus management, scoring, and retake behavior.
- **Validation evidence:** On Windows x64: `npm ci` passed (0 vulnerabilities); `npm test` passed 388 tests across 45 test files (2 benchmarks skipped); `npm run build` completed in 2.09s with 0 errors; `cargo fmt --check` passed cleanly; `cargo clippy --all-targets -- -D warnings` passed with 0 warnings; `cargo test` passed 100 tests (2 benchmarks ignored); Windows NSIS installer packaged successfully (`src-tauri/target/release/bundle/nsis/Her Flight Deck_0.5.2_x64-setup.exe`).
- **Release posture:** The Windows hold remains in effect due to the unresolved detection until authoritative Microsoft clearance of the exact binary or trusted code signing is achieved; Mac builds require physical Apple Silicon hardware smoke testing before distribution. No release or tag was created.

## Release safety & accessibility update (23 September 2026)

Following a comprehensive release safety audit:
- **Retired version rejection:** Version `0.5.2` is registered as permanently retired in `scripts/release-policy.json`. A dependency-free validator `scripts/check-release-version.mjs` enforces this policy across `.github/workflows/release.yml` and `scripts/release.sh`. Seven automated regression tests in `src/logic/releaseSafety.test.ts` verify that `0.5.2` is rejected, malformed versions are rejected, valid non-retired versions (such as `0.5.3`) are accepted, and both entry points call the validator.
- **Security bypass instructions removed:** `README.md` and `STATUS.md` no longer instruct users to bypass macOS quarantine via `xattr -dr`, click past SmartScreen, or lower browser Safe Browsing settings. The policy mandates that flagged installers remain private drafts for vendor submission and analysis.
- **Documentation corrections:** `docs/RELEASE_PREP_0.5.2.md` and `docs/releases/v0.5.2.md` are marked as withdrawn historical records with actionable release/tag commands disabled. `docs/PROJECT_AUDIT_2026-09-14.md` accurately documents the Gemini credential lifecycle (webview input and React state, transmission via Tauri IPC, storage in restricted OS app data, and never returned to the webview).
- **Pilot Toolkit accessibility repair:** Implemented the full WAI-ARIA tabs specification in `src/pages/PilotToolkit/PilotToolkit.tsx`: stable tab/panel IDs, `role="tabpanel"`, `aria-controls`, `aria-labelledby`, roving `tabIndex`, ArrowLeft/ArrowRight navigation with wrap-around, Home/End keys, and focus synchronization. Six unit tests in `src/pages/PilotToolkit/PilotToolkit.test.ts` verify all ARIA relationships and keyboard behaviors.
- **Validation evidence:** On Windows x64, `npm ci` passed with 0 vulnerabilities; `npm test` passed 350 tests across 42 test files (2 manual benchmarks skipped); `npm run build` passed with 0 errors; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` passed 88 Rust tests (2 intentionally ignored benchmarks).

## Windows release on hold: Defender flags the installer as Wacatac.B!ml

`v0.5.2`'s Windows installer (`Her Flight Deck_0.5.2_x64-setup.exe`,
`sha256:12f6cd530b0301e67bce952bd20fff27b1fa4fb8760cfe4579721e940e7f8a8b`) was
flagged by Windows Defender as `Trojan:Win32/Wacatac.B!ml` on download,
including a direct download from the GitHub Release — reported by hand,
without the file being run. The release and its tag were withdrawn the same
day; nothing currently published carries this build.

The installer was flagged with detection `Trojan:Win32/Wacatac.B!ml`. Under the
repository release policy, an unresolved security detection is treated as a release
blocker rather than assumed clean. The Windows installer remains unpublished until one of these closes it:

- Microsoft's file-submission review authoritatively clears the specific binary
  (https://www.microsoft.com/wdsi/filesubmission, "Software developer"
  dispute) — the usual path, typically resolved in a few days, or
- the Windows installer is code-signed, which removes the dominant trigger
  for this class of detection outright.

Paid code signing is the long-term path, but is not mandatory if Microsoft
clears the exact binary. Physical installed-application validation on both
Windows and Apple Silicon hardware remains mandatory before distribution.

Per the engineering rules, `v0.5.2`'s tag cannot be reused once it existed —
a Windows-fit release after this is cleared ships as `0.5.3` or later, built
fresh, checksummed again, and re-verified before publishing. The macOS
`.dmg` was not flagged and is not affected by this hold.

## Performance polish update

The 13 September pass bounds Study Library rendering to 100 cards at a time while still searching, filtering, and sorting the whole library. A synthetic 5,000-material server-render benchmark on Windows fell from 437 ms to 8 ms median; this does not measure a painted desktop window. The PDF splitter now batches page-reference removal; a synthetic 3,000-page window plus five candidates fell from 26.74 s to 0.085 s, with byte-equivalent output tests for simple, nested, and image-bearing PDFs. Import and backup disk work now run outside Tauri's UI thread. See [the detailed measurement and validation note](docs/PERFORMANCE_POLISH_2026-09-13.md). The installed Mac app still requires hands-on testing, and no release was published.

## App polish update

The current polish pass reduces the first-screen JavaScript bundle by loading other sections when opened, keeps Settings and Search visible in compact windows, prevents long-running PDF work from being dismissed mid-operation, and cleans up file imports abandoned before a material is saved. The manual page-range form now rejects fractional input, and a backup that was finalized successfully no longer reports itself as failed solely because the separate reminder write failed. See [the polish note](docs/APP_POLISH_2026-09-12.md) for checks and remaining device verification. No release tag was changed.

## macOS audit update

See [the 12 September audit](docs/MAC_AUDIT_2026-09-12.md) for test evidence and the required Mac installation checklist. The audit found that schema 9 (practice tests) made complete backups reject the app's own database, and that automatic split records used a transaction across pooled SQL connections. Both are fixed. Manual split records now use the same atomic write, and manual safety copies use SQLite's online snapshot. An Apple Silicon runner built and inspected the DMG, and Windows produced an installer. The Mac app is **not yet declared ready**: hands-on installation/open/Finder/backup/restore checks remain necessary.

## Current position

Her Flight Deck is a private Tauri 2 desktop application with Windows and Apple Silicon installers. Release `v0.5.1` is published. It organizes flight training plans, lessons, study material, notes, questions, flight records, finances, reminders, and career preparation in one local application. The Apple Silicon package builds, but its installed behavior has not been verified on a Mac.

Uploaded files and generated PDF parts are copied into app-owned storage. Large PDFs can be split automatically into labeled parts within Gemini's 50 MiB and 1,000-page limits, with an independent study guide for every part. Automatic splitting now windows each part before its size candidates are tried, instead of re-cloning and re-writing the whole remaining book per candidate — a synthetic 3,000-page benchmark measured roughly 4.4x less wall time for the same output (`cargo test ... -- --ignored --nocapture` on `windowing_is_substantially_faster_than_reprocessing_the_whole_book_per_candidate`), and the app now shows which part/page range is being read or written while it runs. The Study Library **Open** capability is scoped to app-owned documents, but opening a PDF from the packaged app in Preview still needs a real Mac smoke test.

Gemini can also generate an optional multiple-choice practice test from the selected study document, saved locally beside its study guide and flashcards, with malformed or out-of-range answers filtered out before they ever reach the quiz screen.

Complete `.hfdbackup` exports contain the SQLite library and managed documents. Format version 3 adds two-way reference completeness and declared missing documents on top of format version 2's SHA-256 inventory, online SQLite snapshot, staged database integrity/schema checks, and strict hostile-archive limits. Versions 1 and 2 remain supported for restore.

## Desktop release

- Latest release: `v0.5.1`
- Release commit: `2dbf6df3f66b18e087b5842fc554f8e733255a0e`
- Windows installer: published
- Apple silicon macOS DMG: published
- Installers: unsigned
- Automatic updater: not implemented

### Release safety hold

The attempted `v0.5.2` Windows installer was withdrawn after Microsoft
Defender detected it as `Trojan:Win32/Wacatac.B!ml`. It was not executed.
Microsoft Security Intelligence submission `9656710a-e9d3-4c15-83dc-9b9f3451be8b`
is pending analysis. In accordance with `scripts/release-policy.json`, version
`0.5.2` is permanently retired and will never be published or reused; the next
distributable release will be `0.5.3` or later once the Windows hold is resolved
(via authoritative Microsoft clearance of the exact installer or trusted code signing)
and physical installed-app validation on Windows and Apple Silicon hardware is completed.
Paid code signing is the long-term path, but is not mandatory if Microsoft clears
the exact binary.
Workflow runs create private release drafts with checksums; review the exact
draft assets using [the release review process](docs/RELEASE_REVIEW_PROCESS.md)
before publishing.

Installing a newer version over an existing installation preserves app data and creates an automatic database safety copy before migrations run. A complete backup should still be saved separately before an update or computer transfer.

## iOS project

The iOS effort is active and documented in `docs/ios/`, `docs/backup-format.md`, and `docs/BACKUP_MERGE_DESIGN.md`. Milestones 1 and 2 cover architecture, compatibility, platform boundaries, and desktop backup hardening. An iOS-readiness preparation pass established isolated `CredentialStore` trait and desktop adapter scaffolding in `platform.rs`, while active credential operations remain on desktop `secrets` and Keychain implementation is deferred until real Mac/Xcode/device validation. There is no runnable iOS app yet.

Milestone 3 requires a Mac with Xcode to initialize and validate Tauri's Apple project, implement Files/AirDrop import, Keychain, Quick Look, sharing, and the iOS restore lifecycle. Milestone 4 covers iPhone/iPad layout, device memory testing, CI, signing, TestFlight, and App Store preparation.

## Engineering rules

- Do not change `com.herflightdeck.app` without a deliberate data migration.
- Never edit a shipped migration; add the next numbered migration, register it in Rust and TypeScript, and record its checksum.
- Increase all application-version sources before publishing a new release.
- Never move an existing release tag or rebuild a published version number.
- Never embed, log, back up, or return the Gemini key to the webview.
- Keep monetary values as integer cents.
- Keep Gemini submission explicit and limited to the selected study file.
- Keep aviation safety guidance visible around generated material.
- Do not expose backup Merge until its conflict and rollback behavior is fully implemented and tested.
- Do not claim iOS, TestFlight, or App Store readiness without real Apple build and device evidence.

## Remaining hands-on checks

- Install the current desktop build over populated prior-version data.
- Import, reopen, split, back up, and restore non-sensitive test documents using native Windows and macOS dialogs.
- Verify the Study Library **Open** button and **Show in Finder or File Explorer** on a real macOS build — the capability-scope fix is covered by a test that reads `capabilities/default.json` itself, but has not run inside an actual signed or unsigned `.app`.
- Connect a real Gemini key and generate one study aid and one practice test from a public test PDF.
- Confirm unsigned first-launch instructions on both desktop platforms.
- Complete the Apple-only checklist before distributing an iOS build.
- Time automatic splitting against a real large or image-heavy handbook, not only the synthetic benchmark used during development — the windowing fix is measured, but only against a page-count-only synthetic PDF (see "Known limitation" below).

## SQLite lock reliability

Earlier work addressed SQLite contention and opener scopes. The 12 September
audit found two further data-safety gaps; see the audit note for reproduction.

- The live database was left in SQLite's default rollback-journal mode, so
  any write held a lock that blocked *every* reader too, not only other
  writers. It now runs in WAL mode (set once at startup, a property of the
  database file itself, so it applies pool-wide and to every future launch).
- The Rust side's own `rusqlite` connections — used to verify a database and
  to take a backup's online snapshot — opened with no busy timeout at all,
  unlike the app's main connection pool, which already gets one from its own
  driver by default. A lock briefly held by an ordinary write failed these
  instantly instead of just waiting the moment out. They now get an explicit
  five-second timeout, and `create_complete_backup`'s snapshot step retries
  up to three more times, with a short backoff, if it is still a lock
  (never for any other kind of failure, and never unboundedly — a
  regression test holds a lock that never clears and confirms the export
  still gives up, with a plain message, within forty seconds).

Saving a split's parts now uses a single native SQLite transaction instead of
pooled SQL statements, with bounded retries if another write holds a lock.
Manual splits use that same transaction and take an online safety snapshot.
A backup export now also reads its own
finished `.hfdbackup` back and runs it through the same validation a restore
would — readable archive, manifest, integrity inventory — before renaming it
into place or reporting success; a failure there leaves any backup already
at that destination untouched.

Settings' **Open folder** button was refused by the same capability-scope
gap the Study Library **Open** button was fixed for earlier in this pass, for
the whole data directory rather than a file inside it — `opener:allow-open-path`
is now scoped to `$APPCONFIG` as well as `$APPCONFIG/documents/**`, and the
button now shows a real error if the OS still refuses the request instead of
failing silently.

## Manual chapter extraction

Alongside automatic splitting, **Take out a chapter** takes one exact page
range by hand — first page, last page, an optional title. The existing
`split_pdf` command already refused a range past 1,000 pages; it now also
measures the actual result and refuses one over 50 MiB (illustrated pages
can land over the byte limit well before the page limit does), naming the
size and suggesting a smaller range, and removes the oversized file rather
than leaving it stored. A safety copy of the database is taken before
anything else changes — no file is written and no record is touched until
one exists — and if saving the new material's record fails after the file
is written, the file is removed the same way automatic splitting's own
rollback already works. The extracted chapter is an ordinary Study Library
item: its own study guide, its own practice test, its page range recorded
in its notes, the source handbook untouched.

## Known limitation: browser reputation and unsigned binaries

Neither installer is currently code-signed, so fresh unsigned binaries lack
reputation history and can trigger browser Safe Browsing or Windows
SmartScreen warnings. Under the release review policy, flagged or blocked
installers must never be bypassed by instructing users to force-keep files or
lower security protection settings. Draft installers remain private during
review. The Windows hold may be resolved by authoritative Microsoft clearance of
the exact installer or by trusted code signing (the long-term path, though not
mandatory if Microsoft clears the exact binary). Physical installed-app validation
on Windows and Apple Silicon hardware remains mandatory before distribution.
Published SHA-256 checksums confirm transfer integrity, but do not substitute for
platform clearance.

## Still requiring a Mac

The installed-app checklist and the transient Gemini-key webview issue are
recorded in `docs/MAC_AUDIT_2026-09-12.md`. No Mac readiness claim is made.

## Known limitation: automatic splitting's remaining bottleneck

Automatic splitting in `pdf.rs` uses `delete_pages_batch`, which batches page-tree count decrements and removes unwanted page references in a single traversal, eliminating `lopdf::delete_pages`'s quadratic per-page object-graph sweep. Windowing further bounds the working document to ≤1,000 pages per part with in-memory candidate evaluation rather than writing size trials to disk. The remaining cost for very large books is `lopdf`'s clone-and-prune approach (cloning the document tree and deleting excluded objects) rather than constructing each part by copying forward only the objects reachable from its kept pages — a larger, separately risky architecture not attempted in this pass.
