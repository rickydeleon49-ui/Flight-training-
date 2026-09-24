# Project Audit: Her Flight Deck

**Date:** 14 September 2026
**Version Audited:** `v0.5.2` (Release Candidate - On Hold)
**Context:** Full architecture, security, and codebase review.

---

## 1. Executive Summary

Her Flight Deck is an offline-first desktop application designed as a personal flight training companion. It leverages Tauri 2 (Rust) for the backend and native capabilities, and React 19 + TypeScript + Vite for the frontend.

The codebase exhibits exceptional engineering discipline, prioritizing data safety, defensive programming, and privacy boundaries. The test suite is extensive and fully passing, and the application architecture cleanly separates UI, domain logic, and native OS operations.

**Current Release Blocker:**
The `v0.5.2` Windows installer (`Her Flight Deck_0.5.2_x64-setup.exe`, sha256: `12f6cd530b0301e67bce952bd20fff27b1fa4fb8760cfe4579721e940e7f8a8b`) is on a safety hold due to an unresolved detection (`Trojan:Win32/Wacatac.B!ml`) by Windows Defender on download. The detection is currently under developer dispute review with Microsoft Security Intelligence (submission `9656710a-e9d3-4c15-83dc-9b9f3451be8b`). While the `!ml` suffix indicates a machine-learning heuristic pattern frequently observed on unsigned Tauri/NSIS binaries, the build is held as an unresolved detection rather than a confirmed false positive, and remains unpublished until Microsoft review concludes or code signing is established.

---

## 2. Product Philosophy & Implementation

The application strictly adheres to its "Soft Cockpit" specification (`PRODUCT_SPEC.md`):
- **Domain Modeling:** Financial transactions are safely handled as integer cents to eliminate float drift. Dates and times are strictly typed ISO strings.
- **State Management:** The frontend cleanly manages data recovery via `AppDataContext.tsx` and provides a robust fallback (the `DataRecovery` component) if the SQLite database cannot be opened.
- **No Guilt Metrics:** The design intentionally avoids guilt-based streaks or badges, aligning with the empathetic product philosophy.

---

## 3. Architecture & Data Safety

The architecture relies on a strong separation of concerns, heavily utilizing Rust for data integrity and performance:

* **Dual-Engine Database & Single-Source Migrations:**
  The schema migrations (currently at version 9) exist as raw SQL files in `src-tauri/migrations/`. These identical files are consumed by both the Rust SQLite plugin in production and `sql.js` during browser-fallback/testing, making version drift structurally impossible.
* **Pre-Migration Rollback Safety:**
  Before applying any schema migrations on startup, a full copy of the database is automatically staged in a rollback folder.
* **Format Version 2 (`.hfdbackup`):**
  The portable backup system is highly defensive:
  - Generates a complete SHA-256 manifest (`manifest.json`).
  - Uses SQLite's Online Backup API for atomic, consistent snapshots, even under active write contention (WAL).
  - Validates all paths on extraction to prevent directory traversal (`..`), alternate data streams, and symlink attacks.
  - Rejects hostile zip bombs by checking compression ratios and bounding entry counts.
* **Lock Contention Handling:**
  `documentRepository.ts` implements exponential backoff retries for transient `SQLITE_BUSY` database locks, preventing crashes during concurrent background PDF processing.

---

## 4. AI & Gemini Integration Security

The integration of the Gemini API (`gemini.rs`) is sandboxed with strict data boundaries:

* **Credential Boundaries & Lifecycle:** The user's Google AI Studio key is entered into the Settings webview and temporarily exists in React/browser memory before being sent to Rust through Tauri IPC (`configure_gemini`). The key is stored in an OS-level app data file (`gemini-key`) with user-only permissions via `secrets.rs`. The backend never returns the key to the webview during status calls, it is never stored in SQLite, it is excluded from complete `.hfdbackup` archives, and it is not intentionally logged.
* **Defensive Networking:** Gemini API calls utilize a bounded exponential backoff with randomized jitter to gracefully handle `429` (Rate Limit) and `503` (Service Unavailable) responses.
* **Hard Limits:** Google's limits (50 MB or 1,000 pages for PDFs) are enforced locally before any network transmission occurs, saving bandwidth and preventing opaque API errors.
* **Pinned Models:** Uses `gemini-3.5-flash` with a designated fallback to `gemini-3.5-flash-lite`, deliberately avoiding unpinned `-latest` aliases that can unpredictably change application behavior.

---

## 5. Test Suite Health

The repository relies on a robust dual-layer test suite:
- **Frontend (Vitest):** 337 passing frontend tests across 40 suites (with 2 skipped benchmark suites, 0 failures).
- **Backend (Cargo Test):** 90 Rust tests (88 passed, 2 ignored benchmarks, 0 failures).
- **Static Analysis:** TypeScript compilation (`tsc --noEmit`) and strict Clippy lints pass with 0 errors.

---

## 6. Actionable Recommendations & Next Steps

1. **Resolve Windows Defender Hold:**
   - Await Microsoft Security Intelligence review of submission `9656710a-e9d3-4c15-83dc-9b9f3451be8b`.
   - **Long-term resolution:** Acquire an EV Code Signing Certificate or use Azure Trusted Signing for the Windows installer to establish reputation and bypass heuristic triggers.
   - Once resolved, tag and release as `v0.5.3` or later (per engineering rules, do not reuse `0.5.2`).
2. **Execute macOS Smoke Test:**
   - The Apple Silicon `.dmg` builds cleanly, but requires manual validation on physical hardware to confirm native document opening (Preview), Finder integration, and desktop keychain migration behavior.
3. **Phase Out Legacy Keyring:**
   - `Cargo.toml` retains a `keyring = "3"` dependency solely to migrate users upgrading from versions older than `0.3.0`. Target removal of this crate in `v0.6.0` to slim the binary.
4. **Advance iOS Milestone 3:**
   - Isolated `CredentialStore` trait scaffolding exists (`src-tauri/src/platform.rs`), with production code continuing to call `secrets` directly. Advancing Keychain and iOS capabilities requires a Mac running Xcode to execute `tauri ios init` and validate native Protected Store behaviors against physical devices.
