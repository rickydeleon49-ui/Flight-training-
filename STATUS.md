# Her Flight Deck — current project status

_Updated 9 September 2026 · desktop version `0.5.1` · default branch `main`_

## Current position

Her Flight Deck is a working private Tauri 2 desktop application for Windows and Apple silicon Macs. Release `v0.5.1` is published. It organizes flight training plans, lessons, study material, notes, questions, flight records, finances, reminders, and career preparation in one local application.

Uploaded files and generated PDF parts are copied into app-owned storage. Large PDFs can be split automatically into labeled parts within Gemini's 50 MiB and 1,000-page limits, with an independent study guide for every part. Automatic splitting now windows each part before its size candidates are tried, instead of re-cloning and re-writing the whole remaining book per candidate — a synthetic 3,000-page benchmark measured roughly 4.4x less wall time for the same output (`cargo test ... -- --ignored --nocapture` on `windowing_is_substantially_faster_than_reprocessing_the_whole_book_per_candidate`), and the app now shows which part/page range is being read or written while it runs. The Study Library **Open** button now works on macOS: `tauri-plugin-opener`'s `open_path`/`reveal_item_in_dir` silently require a capability-level path scope regardless of platform, and `capabilities/default.json` granted the bare permission with none, so every open request was refused — it is now scoped to `$APPCONFIG/documents/**`, matching the one directory documents are ever opened from.

Gemini can also generate an optional multiple-choice practice test from the selected study document, saved locally beside its study guide and flashcards, with malformed or out-of-range answers filtered out before they ever reach the quiz screen.

Complete `.hfdbackup` exports contain the SQLite library and managed documents. Format version 2 adds a SHA-256 inventory, an online SQLite snapshot, staged database integrity/schema checks, and stricter hostile-archive limits. Version 1 backups remain supported for restore.

## Desktop release

- Latest release: `v0.5.1`
- Release commit: `2dbf6df3f66b18e087b5842fc554f8e733255a0e`
- Windows installer: published
- Apple silicon macOS DMG: published
- Installers: unsigned
- Automatic updater: not implemented

Installing a newer version over an existing installation preserves app data and creates an automatic database safety copy before migrations run. A complete backup should still be saved separately before an update or computer transfer.

## iOS project

The iOS effort is active and documented in `docs/ios/` and `docs/backup-format.md`. Milestones 1 and 2 cover architecture, compatibility, platform boundaries, and desktop backup hardening. There is no runnable iOS app yet.

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

Three related failures — automatic-split saves, backup exports, and the
Settings **Open folder** button — traced back to two gaps:

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
  still gives up, with a plain message, well under thirty seconds).

Saving a split's parts (`documentRepository.createMany`) has the same
bounded retry on the frontend side, for the same reason: it can land at the
same moment as an unrelated autosave. A backup export now also reads its own
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

## Queued for the next session (not started)

- Add a manual PDF split option beside automatic splitting, with its own
  page-range/size validation, a pre-change safety backup, and atomic
  rollback if creating the file or saving its record fails.

## Known limitation: automatic splitting's remaining bottleneck

The windowing fix removes the *binary-search-candidate* multiplier from the
expensive step (every part now clones and prunes a bounded ≤1,000-page
window once, rather than the whole remaining book on every size trial), and
moves candidate rendering into memory instead of rewriting the destination
file on disk for every trial. What it does **not** fix: `lopdf`'s own
`delete_pages` walks the entire live object graph once per page it removes
(a fresh reachability sweep per deletion, by design — see `pdf.rs`'s
`window_document` doc comment), so windowing a very long book still costs
work proportional to *(pages removed) × (pages still live)* for that one
per-part windowing step. A synthetic 3,000-page, content-free benchmark
still measured this step as the dominant remaining cost. A complete fix
would replace lopdf's delete-and-prune approach with building each window
by copying forward only the objects reachable from its kept pages, rather
than cloning everything and deleting most of it — a larger, separately
risky rewrite not attempted in this pass.
