# Release and data-safety audit — 9 September 2026

Her Flight Deck `v0.5.1` is published for Windows and Apple silicon Macs. The desktop release passed its exact-head checks and hosted installer builds. The next project phase is the dedicated iOS application described under `docs/ios/`.

## Current audit fixes

- Portable backups now use `formatVersion: 2` and include SHA-256, byte count, and path records for the database and every document. Restore verifies the complete inventory. Existing format-version-1 backups remain readable.
- Complete exports use SQLite's online backup API to create an immutable, consistent snapshot while the live app may still receive writes.
- Restore opens the staged database read-only, runs `PRAGMA quick_check`, checks core Her Flight Deck tables, and rejects future schema versions before moving current data.
- Archive validation rejects extreme compression ratios, overlong paths and path components, Windows alternate-data-stream names, traversal, duplicates, symlinks, unexpected entries, excessive entry counts, and excessive expanded size.
- Vitest was upgraded past GHSA-82fw-gwwq-j7x9.
- The platform-info unit test is desktop-gated so a future iOS test run does not fail merely because it correctly reports iOS.

## Existing protections retained

- Imports and PDF parts live in app-owned storage and receive collision-safe names.
- Automatic PDF splitting keeps each part within 50 MiB and 1,000 pages, labels its range, creates a separate Study Library item, and cleans up partial work.
- Restore stages data before activation and preserves the current library in a rollback folder before installing the replacement.
- Database migrations are additive, checksummed, and shared by desktop and the browser test database.
- The Gemini key never enters the webview or a portable backup. Desktop stores it in a user-only app-data file because unsigned desktop builds cannot retain stable keychain identity; iOS must use Keychain.
- GitHub workflows use scoped permissions and commit-pinned actions.

## Validation results

- `npm ci` completed from the committed lockfile, all 313 frontend tests passed, and the production TypeScript/Vite build succeeded.
- `npm audit` reports zero vulnerabilities after upgrading Vitest to 4.1.11.
- All 64 Rust tests passed. `cargo fmt --check` and strict Clippy (`-D warnings`) are clean.
- A complete Windows x64 NSIS installer build succeeded with the audited dependency set.
- `cargo audit` reports RUSTSEC-2023-0071 for `rsa` 0.9.10. That crate belongs to SQLx's optional MySQL driver, is present only in the resolved lockfile, and is absent from `cargo tree` for every build target; this app enables SQLite only. RustSec lists no fixed release. The remaining cargo-audit notices are unmaintained or unsoundness warnings in upstream PDF/Tauri platform dependencies.
- Pull-request and post-merge Checks results are recorded by GitHub Actions. Both exact-head runs must be green to close this audit.

## Remaining platform work

No iOS build has been compiled or run. The current iOS files are architecture, configuration, and platform-boundary scaffolding. A Mac with Xcode is required for `tauri ios init`, simulator/device builds, Files and AirDrop import, Quick Look, share sheet, Keychain, restore-on-cold-launch, mobile layout, memory profiling, signing, and TestFlight.

Desktop installers remain unsigned, macOS packaging remains Apple-silicon-only, and native file-picker/viewer plus live Gemini behavior still require release smoke testing.
