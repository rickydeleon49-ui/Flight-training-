# Her Flight Deck — current project status

_Updated 14 September 2026 · desktop release candidate `0.5.2` · **Windows release on hold, see below**_

## Release preparation

Version `0.5.2` was published on 14 September and then withdrawn the same day — see "Windows release on hold" below. The latest release fit to distribute remains `v0.5.1`. The version bump preserves `com.herflightdeck.app` so updates continue to use the same app-owned data folder and trigger the pre-migration safety copy. See [the release preparation note](docs/RELEASE_PREP_0.5.2.md) for validation and the one-step tag process. The installed Mac smoke test is still required before tagging; a successful Apple Silicon CI package build alone is not that test. Windows additionally now needs the Defender clearance below before its installer can be republished.

## Windows release on hold: Defender flags the installer as Wacatac.B!ml

`v0.5.2`'s Windows installer (`Her Flight Deck_0.5.2_x64-setup.exe`,
`sha256:12f6cd530b0301e67bce952bd20fff27b1fa4fb8760cfe4579721e940e7f8a8b`) was
flagged by Windows Defender as `Trojan:Win32/Wacatac.B!ml` on download,
including a direct download from the GitHub Release — reported by hand,
without the file being run. The release and its tag were withdrawn the same
day; nothing currently published carries this build.

The `!ml` suffix means this is Defender's machine-learning heuristic, not a
signature match, and it is a well-documented false-positive pattern for
unsigned Rust/Tauri NSIS installers specifically — several other Tauri
projects have hit the identical detection for the identical reason: a
fresh, unsigned, low-reputation binary. Nothing in the repository's build
config supports an alternate explanation — no custom installer script, a
stock `tauri-plugin-*` + NSIS bundle, unchanged since earlier releases that
were never flagged. That pattern is not the same as confirmed-clean, so the
Windows installer stays unpublished until one of these closes it:

- Microsoft's file-submission review clears the specific binary
  (https://www.microsoft.com/wdsi/filesubmission, "Software developer"
  dispute) — the usual path, typically resolved in a few days, or
- the Windows installer is code-signed, which removes the dominant trigger
  for this class of detection outright.

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

Complete `.hfdbackup` exports contain the SQLite library and managed documents. Format version 2 adds a SHA-256 inventory, an online SQLite snapshot, staged database integrity/schema checks, and stricter hostile-archive limits. Version 1 backups remain supported for restore.

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
contains a locally rebuilt `0.5.2` installer and is pending analysis. Do not
recreate or publish `v0.5.2` while that review is pending. Future workflow
runs create release drafts with checksums; review the exact draft assets using
[the release review process](docs/RELEASE_REVIEW_PROCESS.md) before publishing.

Installing a newer version over an existing installation preserves app data and creates an automatic database safety copy before migrations run. A complete backup should still be saved separately before an update or computer transfer.

## iOS project

The iOS effort is active and documented in `docs/ios/`, `docs/backup-format.md`, and `docs/BACKUP_MERGE_DESIGN.md`. Milestones 1 and 2 cover architecture, compatibility, platform boundaries, and desktop backup hardening. An iOS-readiness preparation pass has wired the `CredentialStore` trait into the Rust backend so the Keychain implementation can be dropped in. There is no runnable iOS app yet.

Milestone 3 requires a Mac with Xcode to initialize and validate Tauri's Apple project, implement Files/AirDrop import, Keychain (`KeychainCredentialStore`), Quick Look, sharing, and the iOS restore lifecycle. Milestone 4 covers iPhone/iPad layout, device memory testing, CI, signing, TestFlight, and App Store preparation.

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

## Known limitation: browser "virus detected" on download

Neither installer is code-signed, so beyond Windows SmartScreen's "Windows
protected your PC" prompt at first launch (already covered in the release
notes and `README.md`), Chrome and Edge can flag the download itself —
before it is ever run — as a "Virus detected" or "dangerous file" block.
That is Safe Browsing's file-reputation check, not a scan result: a fresh,
unsigned `.exe`, or the `.zip` GitHub wraps a workflow-run artifact in, has
no download history yet, so it is scored as suspicious regardless of its
contents. `README.md` now documents it separately from the SmartScreen
prompt, with the same underlying fix in both cases — prefer the Releases
page over a raw workflow artifact, check the published SHA-256 checksum,
and use the browser's **Keep** option (or Standard protection) if the
download is blocked outright. This is a Google/Microsoft reputation system
reacting to low download counts, not something fixable from the codebase
without a paid code signing certificate.

## Still requiring a Mac

The installed-app checklist and the transient Gemini-key webview issue are
recorded in `docs/MAC_AUDIT_2026-09-12.md`. No Mac readiness claim is made.

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
