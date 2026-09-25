# Pre-Release Audit: Her Flight Deck

**Date:** 24 September 2026
**Repository:** `rickydeleon49-ui/Flight-training-`
**Worktree:** `H:\Ai Repo worktrees\Flight-training-\release-readiness`
**Branch:** `audit/release-readiness`
**Baseline Commit:** `44e5d0d3a58ffc867c0ff876b342aa465b2ebad1`
**Status:** Verification complete; release on hold pending physical hardware validation and Windows clearance

---

## 1. Executive Summary & Findings Ordered by Severity

Her Flight Deck underwent a comprehensive pre-release readiness audit following the Study Library file-lifecycle fixes (PR #27) and Gemini workflow hardening (PR #28). The audit inspected code architecture, security boundaries, native capabilities, dependency health, accessibility, packaging workflows, and database migrations.

### Findings

1. **Medium Severity (Resolved): Dependency Vulnerability in `rustls` (RUSTSEC-2026-0285 / GHSA-2mjx-qc3c-rqvc)**
   - **Advisory:** TLS 1.3 handshake messages incorrectly accepted across encryption level boundaries (CVSS 5.3).
   - **Affected Package:** `rustls v0.23.43` (transitive dependency of `reqwest v0.12.28` via `hyper-rustls` and `tokio-rustls`).
   - **Resolution:** Upgraded `rustls` from `v0.23.43` to `v0.23.45` via `cargo update -p rustls`.
   - **Evidence Attribution:** `cargo audit` confirms RUSTSEC-2026-0285 no longer appears in the vulnerability report. The test and build matrix (388 passing TypeScript tests, 100 passing Rust tests, and full frontend/NSIS builds) provides evidence that no regressions were introduced.

2. **Low Severity / Non-Exploitable: Current `cargo audit` Finding for Transitive `rsa` (RUSTSEC-2023-0071 / CVE-2023-49092)**
   - **Advisory:** Marvin timing sidechannel vulnerability (CVSS 5.9).
   - **Audit Status:** The current `cargo audit` result is not fully clean: it exits with one vulnerability finding for `rsa 0.9.10`. Upstream has not published a patched stable release (`patched = []`).
   - **Exposure Assessment:** Shipped-build exposure to `rsa` is absent:
     - Running `cargo tree -i rsa` prints no dependency path.
     - Running `cargo tree --target all -i rsa` prints no dependency path.
     - The package remains recorded in `Cargo.lock` through optional SQLx/MySQL dependency metadata, but is not present in the resolved dependency graph for the project's current SQLite-only feature set (`tauri-plugin-sql = { features = ["sqlite"] }`).

3. **Informational: Maintenance & Informational Advisories in `cargo audit`**
   - *Note:* These informational warnings reflect upstream crate maintenance status rather than exploitable security vulnerabilities in Her Flight Deck:
     - `ttf-parser 0.25.1`: Marked unmaintained upstream (RUSTSEC-2026-0192). Present through `lopdf`; tracked for future `lopdf` dependency updates.
     - `glib 0.18.5`: Unsoundness advisory in `VariantStrIter` (RUSTSEC-2024-0429) in the Linux GTK dependency graph. Linux is not a distributed release artifact in the current release workflow, but this is tracked for Linux development and CI environments.
     - `proc-macro-error 1.0.4` and `unic-* 0.9.0`: Unmaintained transitive build and Unicode metadata crates (RUSTSEC-2024-0370, RUSTSEC-2025-0075/0080/0081/0098/0100). Tracked through upstream Tauri dependency updates.

4. **Informational / Release Blocker: Unresolved Windows Defender Detection Hold**
   - Version `0.5.2` is permanently retired following the observed unresolved detection (`Trojan:Win32/Wacatac.B!ml`) on its installer.
   - Under repository policy (`scripts/release-policy.json`), version `0.5.2` will never be reused, re-tagged, or published. An unresolved security detection is treated as a release blocker. The Windows installer remains unpublished until authoritative Microsoft clearance of the exact binary or trusted code signing is achieved, accompanied by mandatory physical hardware validation.

5. **Informational: Mac Runtime Verification Boundary**
   - Static macOS packaging configuration, minimum system targets (`12.0`), bundle identifiers (`com.herflightdeck.app`), and capability scopes are structurally verified.
   - Per safety guidelines, macOS runtime readiness cannot be claimed from Windows or CI; a physical installed-DMG smoke test on Apple Silicon hardware remains required before distributing Mac builds.

---

## 2. Verification of Specific Audit Requirements

### 1. Study Library Imports & Storage Ownership
- **App-Owned Storage:** Uploaded files are copied into the application-owned `documents/` directory inside `$APPCONFIG` (`documents::import_document`).
- **Isolation:** Stored files are namespaced with the material ID and given fresh reserved file names (`reserve_destination`). The database stores only relative paths (`documents/<stored_name>`), ensuring zero dependency on the original upload path or external file availability.

### 2. PDF Open and Reveal Scoping
- **Capability Scoping:** `capabilities/default.json` restricts `opener:allow-open-path` to `$APPCONFIG/documents/**` and `$APPCONFIG`, and `opener:allow-reveal-item-in-dir` strictly to `$APPCONFIG/documents/**`.
- **Path Sanitization:** `documents::stored_document_path` and `safe_relative_path` reject path traversal (`..`), null bytes, Windows drive letters, and alternate data streams (`:`).
- **Cross-Platform Behavior:** Opens with the system default viewer via `openPath`, and highlights in Finder / File Explorer via `revealItemInDir`.

### 3. Automatic PDF Splitting
- **Limits Enforced:** Hard-bounded to Google's maximum of 1,000 pages (`MAX_PAGES`) and 50 MiB (`MAX_PDF_BYTES`).
- **Integrity & Concurrency:** Each part is cleanly labeled (`Part N.pdf`), created as a distinct record, and committed in a single native SQLite transaction (`documents::save_split_materials`) on a dedicated connection with a 5-second `busy_timeout` and `foreign_keys = ON`.
- **Rollback Safety:** If any part or the database write fails, all generated PDF files are removed from disk, preserving the original file untouched.

### 4. Manual Chapter Extraction
- **Validation:** Enforces integer bounds, positive page numbers, `last >= first`, and `wanted <= MAX_PAGES`. The extracted output file size is checked (`enforce_pdf_size_limit`), removing the file if it exceeds 50 MiB.
- **Safety Copy:** Takes a full database safety backup via `createBackup()` before creating any files or database records.
- **Failure Recovery:** Automatically removes the extracted PDF if saving the material record fails.

### 5. Complete Backups (`.hfdbackup`)
- **Lock Contention:** Snapshot operations use a 5-second busy timeout and up to 3 bounded retries against transient SQLite locks. A permanently locked database fails boundedly with a plain error message within 40 seconds.
- **Atomic Finalization:** The archive is written to a temporary staging file, fully verified against archive format rules and database schema before being renamed into place.
- **Format Integrity:** Format v2 enforces a complete SHA-256 inventory (`integrity.json`). Legacy v1 backups remain fully supported for restoration.

### 6. Gemini Study Workflows & API Safety
- **Single Flight & Mutual Exclusion:** A component-wide lock (`activeGeminiOpRef` in `MaterialDetail.tsx`) prevents simultaneous generation of study aids and practice tests across materials and navigation.
- **Stale Result Rejection:** Strict request-ID, material-ID, file-path, and generation-token checks discard completed Gemini responses if navigation or file replacement occurs before resolution.
- **Model Identifiers:** Pinned to `gemini-3.5-flash` with automatic retry/fallback to `gemini-3.5-flash-lite` on transient capacity exhaustion (503).
- **Credential Protection:** The Google AI Studio API key is stored in restricted OS app data (`secrets.rs` with mode `0600` on Unix). It is never returned to the webview, never stored in SQLite, excluded from backups, and omitted from logs.
- **Refusal Messaging:** Context-aware messages distinguish 400 (verification check vs document format), 401 (invalid credentials), 403 (project/API access denied), 404 (retired model), 429 (rate/spending limits), and 500–504 (server capacity).

### 7. Practice Test Accessibility & Ergonomics
- **Screen Reader Support:** Configured with `role="radiogroup"`, `role="radio"`, `aria-checked`, and an `aria-live="polite"` region for answer explanations.
- **Keyboard Navigation:** Full WAI-ARIA roving `tabIndex` pattern with ArrowUp/Down/Left/Right wrapping, Home, End, and Enter/Space selection.
- **Focus Flow:** Selecting an answer automatically focuses the "Continue" / "See score" button; advancing to the next question automatically focuses the first answer option.
- **Scoring & Retake:** Accurately counts correct answers upon question advancement; retaking resets all question state, answer selections, and returns focus to option 1.

### 8. macOS Packaging & Platform Guidance
- **Targets:** `tauri.conf.json` specifies `bundle.macOS.minimumSystemVersion: "12.0"` and bundle identifier `com.herflightdeck.app`.
- **Platform Detection:** `isMacOS()` and `isWindowsOS()` in `src/lib/platform.ts` cleanly differentiate desktop macOS from iOS/iPadOS and Windows.
- **Wording:** UI guidance in `Settings.tsx` and `DataRecovery.tsx` appropriately refers to Finder and Application Support on macOS versus File Explorer and AppData on Windows.

### 9. Windows Installer & Security Posture
- **Packaging:** Built with NSIS in `currentUser` mode with `downloadBootstrapper` for WebView2.
- **Integrity Guidance:** README and STATUS explicitly forbid instructing users to bypass SmartScreen, disable Defender, or add antivirus exclusions. Unverified or flagged installers remain held.

### 10. Release Workflow Rigor
- **Version Alignment:** `.github/workflows/release.yml` checks that the requested tag/version matches `package.json`, `package-lock.json`, `tauri.conf.json`, and `Cargo.toml`.
- **Policy Enforcement:** Calls `scripts/check-release-version.mjs` to block permanently retired versions (such as `0.5.2`).
- **Artifacts:** Targets Apple Silicon (`macos-15` -> `*.dmg`) and Windows (`windows-latest` -> `*-setup.exe`), generating `SHA256SUMS.txt` for private drafts.

### 11. Dependency Security Audits
- `npm audit`: **0 vulnerabilities** found.
- `cargo audit`:
  - `rustls 0.23.43` was upgraded to `0.23.45` via `cargo update -p rustls`. `cargo audit` confirms RUSTSEC-2026-0285 is resolved and no longer appears in the scan. The test and build matrix provides regression evidence for the update.
  - The current `cargo audit` scan is not fully clean: it exits with one vulnerability finding for `rsa 0.9.10` (RUSTSEC-2023-0071), for which there is no patched stable release upstream.
  - Shipped-build exposure to `rsa` is absent: both `cargo tree -i rsa` and `cargo tree --target all -i rsa` print no path. The package remains in `Cargo.lock` through optional SQLx/MySQL dependency metadata, but is not present in the resolved dependency graph for the project's current SQLite-only feature set.
  - Informational maintenance warnings (not labeled as exploitable vulnerabilities):
    - `ttf-parser 0.25.1` is unmaintained and present through `lopdf`; tracked for future `lopdf` updates.
    - `glib 0.18.5` has an unsoundness advisory in the Linux GTK graph; tracked for Linux development/CI.
    - `proc-macro-error 1.0.4` and `unic-* 0.9.0` crates are unmaintained transitive/build dependencies; tracked through upstream Tauri updates.

### 12. Database Migrations & Schemas
- **Single Source of Truth:** 9 migrations in `src-tauri/migrations/` match `src/data/migrations.ts`.
- **Checksum Verification:** 57 automated tests in `migrationSafety.test.ts` verify migration SQL integrity and ensure shipped migrations are immutable.

---

## 3. Test Suite & Build Verification Results

| Check | Result | Details |
|---|---|---|
| `npm ci` | Passed | 164 packages installed, 0 vulnerabilities |
| `npm test` | Passed | **45 passed**, 2 skipped (47 test files); **388 passed**, 2 skipped (390 tests) |
| `npm run build` | Passed | Frontend production build completed in 2.09s with 0 errors |
| `cargo fmt --check` | Passed | Clean formatting across all Rust files |
| `cargo clippy --all-targets -- -D warnings` | Passed | Clean compilation with 0 warnings |
| `cargo test` | Passed | **100 passed**, 0 failed, 2 ignored (benchmarks) |
| Windows NSIS Build | Passed | `Her Flight Deck_0.5.2_x64-setup.exe` produced successfully |
| `git diff --check` | Passed | Clean diff with zero whitespace or conflict errors |

---

## 4. Remaining Mac-Only Hands-On Checklist

The following checks cannot be executed on Windows or CI and must be validated on physical Apple Silicon Mac hardware before distributing a macOS release:

1. **DMG Mount & App Install:**
   - Double-click the generated `.dmg`, drag `Her Flight Deck.app` to `/Applications`.
   - Verify Gatekeeper first-launch behavior for an unsigned application (Open via Control-click / System Settings > Privacy & Security).
2. **Document Viewer Integration:**
   - In Study Library, click **Open** on an imported PDF; confirm it opens in Apple Preview.
   - Click **Show in Finder**; confirm the file is revealed in Finder within `~/Library/Application Support/com.herflightdeck.app/documents/`.
3. **Data Directory Access:**
   - In Settings and Data Recovery, click **Open folder**; confirm Finder opens `~/Library/Application Support/com.herflightdeck.app/`.
4. **End-to-End Gemini Generation:**
   - Connect a valid Gemini API key in Settings.
   - Generate a study guide and a practice test from a PDF; verify progress updates and error reporting.
5. **Full Backup & Restore Round-Trip:**
   - Export a complete `.hfdbackup` archive to a folder outside the app.
   - Inspect and restore the backup, confirming the app restarts cleanly with all database records and documents intact.

---

## 5. Tag-Only Release Checklist (For Version 0.5.3+)

When preparing the next distributable version:

- [ ] **1. Bump Version:** Run `scripts/release.sh <new_version>` (e.g. `0.5.3`). Ensure `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` are synchronized.
- [ ] **2. Run Full Test Suite:**
  - `npm ci && npm test && npm run build`
  - `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
- [ ] **3. Verify Release Safety Validator:** `node scripts/check-release-version.mjs <new_version>`
- [ ] **4. Push Commit & Tag:**
  - `git push origin main`
  - `git push origin v<new_version>`
- [ ] **5. Monitor CI Workflow:** Verify `.github/workflows/release.yml` completes on both `macos-15` and `windows-latest`.
- [ ] **6. Inspect Private Draft:** Download draft installers and `SHA256SUMS.txt` from the GitHub Release draft.
- [ ] **7. Windows Clearance / Scanning:** Scan the NSIS `.exe` with updated Microsoft Defender signatures; confirm zero detections.
- [ ] **8. macOS Smoke Test:** Complete the Mac-only hands-on checklist on Apple Silicon hardware.
- [ ] **9. Publish Release:** Convert the GitHub Release draft to public.
