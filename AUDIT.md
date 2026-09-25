# Release and data-safety audit — 9 September 2026

Her Flight Deck `v0.5.1` is published for Windows and Apple silicon Macs. The desktop release passed its exact-head checks and hosted installer builds. The next project phase is the dedicated iOS application described under `docs/ios/`.

## Current audit fixes

- Portable backups use `formatVersion: 3` with SHA-256 integrity records for every archived file. Export accommodates pre-existing missing files (recorded in `missing_at_export` relative to `documents/` and reported in the UI) and excludes unreferenced orphan files (reported in the UI). Referenced documents are treated as pre-existing missing only if absent from both pre-snapshot and post-snapshot disk scans; any referenced file present before the snapshot and gone after triggers a transient retry, as does a referenced file currently staged in `documents/.trash` (a Study Library deletion in progress). Mid-export file mutations or new appearances are likewise detected and retried. After a backup, Settings presents a plain-language summary naming any omitted missing files by material title or filename with advice to re-attach them in the Study Library, and notes any unreferenced files left out; restore previews in Settings and DataRecovery state how many files were already missing when the backup was made. If recording the backup reminder in app settings fails after the archive is finalized, Settings retains all missing-document and unreferenced-file warnings. Archive inspection and restore preserve backward compatibility with older format-v2 archives that contained unreferenced files, while newly created format-v3 archives strictly enforce two-way document completeness, SHA-256 integrity, path safety, and size limits.
- Complete exports use SQLite's online backup API with bounded retries off the UI thread to ensure consistent snapshots even during concurrent document imports, splits, or deletions.
- Document deletion is recoverable: managed files are moved to private trash (`documents/.trash`) before database records are deleted. Staged deletion IDs and metadata paths are validated against traversal. Rollback (`rollback_delete_document_in`) and startup recovery (`cleanup_staged_deletions_in`) use an atomic no-replace operation (`renamex_np` with `RENAME_EXCL` on macOS; `renameat2` with `RENAME_NOREPLACE` on Linux; `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` on Windows) to prevent TOCTOU file replacement races. If the destination path already exists, neither overwrites an existing file, both the destination and staged copy in `.trash` (including `.meta`) are preserved intact and recoverable, and the conflict is reported. Startup recovery refuses to purge staged files if the database is missing the expected `study_materials` table or `file_path` column, leaving staged copies safe until a valid schema is present. Locked files abort without touching the database (preserving both file and record by design), database errors roll back staged files, and startup recovery reconciles interrupted deletions only when the database is readable, refusing to purge `.trash` if the database is missing or corrupt.
- Release workflow (`.github/workflows/release.yml`) runs `cargo test` on Linux CI before packaging and enforces non-cancelling concurrency (`cancel-in-progress: false`). The docs-only CI filter in `checks.yml` is strictly narrowed to actual documentation paths (`LICENSE(\.txt)?$`, `docs/`, etc.) so arbitrary text changes cannot skip required checks.
- Restore opens the staged database read-only, runs `PRAGMA quick_check`, checks core Her Flight Deck tables, and rejects future schema versions before moving current data.
- Archive validation rejects extreme compression ratios, overlong paths and path components, Windows alternate-data-stream names, traversal, duplicates, symlinks, unexpected entries, excessive entry counts, and excessive expanded size.
- Vitest was upgraded past GHSA-82fw-gwwq-j7x9.
- The platform-info unit test is desktop-gated so a future iOS test run does not fail merely because it correctly reports iOS.

## Existing protections retained

- Imports and PDF parts live in app-owned storage and receive collision-safe names.
- Automatic PDF splitting keeps each part within 50 MiB and 1,000 pages, labels its range, creates a separate Study Library item, and cleans up partial work.
- Restore stages data before activation and preserves the current library in a rollback folder before installing the replacement.
- Database migrations are additive, checksummed, and shared by desktop and the browser test database.
- Gemini key lifecycle: The key is entered exclusively via a masked password input in Settings, held transiently in React component memory, sent across Tauri IPC once via `configure_gemini`, and omitted from status responses (which return only `has_api_key: bool`). It is never stored in SQLite, log files, or portable backup archives, and is persisted in user-restricted application data via `secrets.rs` (with OS-level access control on desktop; Keychain on iOS).
- GitHub workflows use scoped permissions and commit-pinned actions. Workflow concurrency cancellation is configured so checks and build-desktop cancel superseded runs, while release runs are never cancelled (`cancel-in-progress: false`).

## Validation results

- `npm ci` completed from the committed lockfile, all 405 frontend tests passed (2 benchmarks skipped), and the production TypeScript/Vite build succeeded with 0 errors.
- `npm audit` reports zero vulnerabilities after upgrading Vitest to 4.1.11.
- All 128 Rust tests passed (2 benchmarks ignored). `cargo fmt --check` and strict Clippy (`-D warnings`) are clean.
- A complete Windows x64 NSIS installer build succeeded with the audited dependency set.
- `cargo audit` configures an ignore in `.cargo/audit.toml` for RUSTSEC-2023-0071 (`rsa` 0.9.10, Marvin timing sidechannel) because that crate belongs to SQLx's optional MySQL driver, is present only in the resolved lockfile, and is absent from `cargo tree` for every build target (this app enables SQLite only). With this targeted ignore in place, `cargo audit` passes cleanly. The remaining cargo-audit notices are unmaintained or unsoundness warnings in upstream PDF/Tauri platform dependencies.
- Pull-request and post-merge Checks results are recorded by GitHub Actions. Both exact-head runs must be green to close this audit.

## Remaining platform work

No iOS build has been compiled or run. The current iOS files are architecture, configuration, and platform-boundary scaffolding. A Mac with Xcode is required for `tauri ios init`, simulator/device builds, Files and AirDrop import, Quick Look, share sheet, Keychain, restore-on-cold-launch, mobile layout, memory profiling, signing, and TestFlight.

Desktop installers remain unsigned, macOS packaging remains Apple-silicon-only, and native file-picker/viewer plus live Gemini behavior still require release smoke testing. Do not claim Mac readiness without an installed Apple Silicon smoke test.
