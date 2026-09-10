# Her Flight Deck — current project status

_Updated 9 September 2026 · desktop version `0.5.1` · default branch `main`_

## Current position

Her Flight Deck is a working private Tauri 2 desktop application for Windows and Apple silicon Macs. Release `v0.5.1` is published. It organizes flight training plans, lessons, study material, notes, questions, flight records, finances, reminders, and career preparation in one local application.

Uploaded files and generated PDF parts are copied into app-owned storage. Large PDFs can be split automatically into labeled parts within Gemini's 50 MiB and 1,000-page limits, with an independent study guide for every part.

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
- Connect a real Gemini key and generate one study aid from a public test PDF.
- Confirm unsigned first-launch instructions on both desktop platforms.
- Complete the Apple-only checklist before distributing an iOS build.
