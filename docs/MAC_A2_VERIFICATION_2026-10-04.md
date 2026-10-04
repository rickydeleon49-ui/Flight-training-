# Mac A2 Accepted Source Verification — 4 October 2026

**Coordinator acceptance, 4 October:** Codex accepted MVER-R1–R3 in [the final review](MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md). The source/native evidence below remains a dated implementer receipt. The owner subsequently directed: “review and no testing account ill wait for the release.” Test-account work is deferred; earlier provisioning statements are historical. The owner also reports no Apple Developer Program membership. Installed testing, signing and release approval remain unverified; no new waiver of those gates is inferred.

**Verdict: A2 accepted source and native APFS behavior VERIFIED on Mac (MVER-R1–R3 accepted by Codex for source integration).** All 181 prepared diagnostics passed with all 57 conditional seams firing. All 8 maintained focused test files (1,470 tests) passed. Native save and document tests passed on host APFS and executed fully on a disposable case-sensitive APFS volume. In response to Codex review finding MVER-R1, a focused native regression for Mac case-alias protection was added to `src-tauri/src/documents_save_tests.rs` and verified on both host case-insensitive APFS and disposable case-sensitive APFS. The 10-step full local gate matrix passed with exit 0. Packaged/installed testing remains **UNVERIFIED** pending owner provisioning of a dedicated standard test account and Developer ID signing credentials. The M2 real-user check-in is waived by the owner; separate Slice B scoped approval and D1–D9 decisions remain open.

---

## 1. Provenance and Working Identity

| Item | Observed Value | Notes |
|---|---|---|
| **Repository** | `rickydeleon49-ui/Flight-training-` | https://github.com/rickydeleon49-ui/Flight-training- |
| **Working Checkout** | `/Users/rickymac/code/Flight-training-pr70-integration` | Clean agreed checkout starting state (currently uncommitted with MVER test addition and verification evidence) |
| **Verification Branch** | `claude/mac-a2-verification-2026-10-04` | Created from synchronized `main` |
| **Commit HEAD** | `1efc052391ed96bdf1af17294f9ddc71960fc906` | Merge PR #79 (Check-in waiver and Mac prompt) |
| **Tree SHA** | `1b5bcd9d289f06ebb34c7cfd9992a2c8849ec9c0` | `git rev-parse HEAD^{tree}` |
| **A2 Merge Ancestor** | `558725158cd93d49f8f9114693f61b08a00ffe2f` | PR #78 merge; verified ancestor via `git merge-base --is-ancestor` |
| **Earlier Primary Checkout** | `/Users/rickymac/code/Flight-training-` | Inspected; preserved untouched with uncommitted work on `claude/cool-carson-9wjrub` |
| **Hardware** | MacBook Air (`Mac17,3`, `Z1L6000RRLL/A`), Apple M5 | 10 cores (4 Super, 6 Efficiency), 32 GB RAM, arm64 |
| **Operating System** | macOS 27.0.1 (Build `26A434`) | `sw_vers` verified |
| **Host Filesystem** | APFS (Case-Insensitive) | Mounted at `/System/Volumes/Data` (UUID: `CE657701-9C7C-4D4A-BDA3-236F24C22E09`) |
| **Scoped Toolchain** | Node `v22.23.3`, npm `10.9.9`, Rustc `1.99.0`, Cargo `1.99.0` | Node: `/opt/homebrew/opt/node@22/bin`; Rust: `/opt/homebrew/opt/rustup/bin` |
| **macOS SDK** | `MacOSX26.5.sdk` (`26.5`) | `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` via scoped `SDKROOT` |
| **Engines** | node:sqlite SQLite `3.53.4`, sql.js `1.14.2`, Vitest `4.1.11` | Real project migrations applied in all test runners |

---

## 2. Accepted Source Identity & Manifest Verification (MVER-R2 Reconciliation)

All 24 accepted source files listed in `docs/evidence/a2-integration-acceptance-2026-10-04/source-manifest.json` were verified against the repository:

- **Pre-Edit Starting Baseline:** Verified against clean starting HEAD `1efc052391ed96bdf1af17294f9ddc71960fc906`:
  - **Git Blob Matching:** **24 of 24 files matched Git blob hashes identically** (`blob mismatches: 0`).
  - **Working-Byte Comparison Breakdown:**
    - **9 files matched directly:** Identical working disk bytes and SHA-256 between Mac checkout and Windows acceptance manifest.
    - **14 files matched via full-CRLF reconstruction:** Converting Mac checkout LF endings to CRLF reproduces the exact byte lengths and SHA-256 hashes from the Windows acceptance manifest.
    - **1 file had unresolved raw-byte reconstruction:** `src/perf/studyLibraryScenarios.test.ts`. Working disk bytes are 13,773 (SHA-256 `7d77d92cb1e107167bcda8d3c6d4e108846bb736019e5f21c621b790f7090acb`); full CRLF reconstruction is 14,073 bytes (SHA-256 `b365b4f6d9cbbbe28a53637dd42071c1299d8534fc6dae3515f259d49facbcf6`); the Windows manifest recorded 14,028 working bytes (SHA-256 `663c385cf4ea5fff9877c0a309d5d1706e26fedaedf9aebd94c3f4e070c58740`). The underlying Git blob `7140950205dec1b2c55a6de0a1aaeaea05c6b5ea` matches identically across both checkouts.
- **Submitted Working Tree State:**
  - **23 of 24 accepted source blobs remain byte-identical** to the accepted manifest. The sole expected difference is the 83-line test-only addition to `src-tauri/src/documents_save_tests.rs` implementing `a_mac_case_alias_cannot_delete_or_trash_a_referenced_file`. All production code remains unmodified.
- **Required Symbols and Registrations Confirmed:**
  - `saveMaterialAtomically` and `MaterialSaveOperation` confirmed in `src/data/db.ts`
  - `connectionOwner.ts` and `materialTransaction.ts` confirmed in `src/data/`
  - `documents_save_tests.rs` confirmed in `src-tauri/src/`
  - Both native command registrations confirmed in `src-tauri/src/lib.rs`: `study_packet::pick_study_packet` and `documents::save_material_operation`.

---

## 3. Prepared Diagnostic Package Execution

The prepared diagnostic suite and observation helper from `docs/evidence/mac-a2-preparation-2026-10-03` were copied into `src/data/` after verifying destination absence.

- **Command:** `npx --no-install vitest run src/data/a2ReviewDiagnostics.mac.test.ts --reporter=verbose`
- **Result:** **181 passed, 0 failed, 0 skipped** in 2.95s (implementer-reported exit 0).
- **Conditional Seams (57 mandatory seams):**
  - **All 57 conditional seams fired and passed:**
    - `[QT-11b]`: 52 of 52 seam assertions passed (`barrier.fired() === 1`, `engineReportsTransaction === true`)
    - `[QT-02b]`: 2 of 2 seam assertions passed
    - `[BD-05]`: 1 of 1 seam assertion passed
    - `[BD-06]`: 1 of 1 seam assertion passed
    - `[BD-11]`: 1 of 1 seam assertion passed
  - Zero conditional seam gaps detected.
- **Cleanup:** Temporary diagnostic copies were deleted immediately; `git status --porcelain src/data/` confirmed a clean working tree.
- **Tracked Receipt:** [`docs/evidence/mac-a2-verification-2026-10-04/a2-diagnostics.txt`](evidence/mac-a2-verification-2026-10-04/a2-diagnostics.txt) (publishable copy with terminal EOF extra blank line trimmed; original `a2-diagnostics.log` preserved byte-for-byte).

---

## 4. Maintained Focused Verification (8 Files)

The 8 maintained test files exercising A2 contracts, drivers, repositories, forms, integration, and scenario workflows were executed:

- **Command:**
  ```bash
  npx --no-install vitest run \
    src/data/materialSaveContract.test.ts \
    src/data/repositories/documentRepository.test.ts \
    src/data/singleConnectionDrivers.test.ts \
    src/pages/FlightJournal/debriefLinks.test.ts \
    src/pages/FlightJournal/quickDebrief.test.ts \
    src/pages/StudyLibrary/MaterialFormDialog.test.ts \
    src/pages/StudyLibrary/materialSaveIntegration.test.ts \
    src/perf/studyLibraryScenarios.test.ts \
    --reporter=verbose
  ```
- **Result:** **8 passed files, 1,470 passed tests, 0 failed, 0 skipped** in 16.77s (implementer-reported exit 0).
- **Invariants Verified:**
  1. **Atomic Saves:** Desktop create/update operates as a single native immediate transaction on one connection, with foreign keys enabled and bounded busy wait.
  2. **Omitted-Field Preservation:** Partial updates strictly preserve unmentioned columns (`topic`, `notes`, `file_path`, `created_at`, etc.).
  3. **Exact Rollback:** Injected collisions or link failures completely roll back rows, tags, and links; compares prior rows; proves zero orphan tags or debris.
  4. **Durable Reopen:** Reopening closed file-backed and memory-backed databases demonstrates committed records and debrief links survive intact.
  5. **Attachment Conservation:** Referenced physical files are protected; unreferenced intermediate files are cleaned up; cancellation of a replacement keeps the original file.
  6. **Cancellation:** Cancelling after a failed replacement save discards only the uncommitted new file and preserves the original.
  7. **Post-Commit Refresh Handling:** When database commit succeeds but subsequent UI refresh throws, the save is reported as successful and the newly referenced attachment is preserved.
  8. **Failure Recovery:** Re-submitting operations after clearing failure conditions succeeds without duplicates.
- **Tracked Receipt:** [`docs/evidence/mac-a2-verification-2026-10-04/focused.txt`](evidence/mac-a2-verification-2026-10-04/focused.txt) (publishable copy with terminal EOF extra blank line trimmed; original `focused.log` preserved byte-for-byte).

---

## 5. Native Save and Document Tests on Actual APFS (MVER-R1)

Native tests in `src-tauri/src/documents_save_tests.rs` were executed against actual APFS storage.

### 5.1 Mac Case-Alias Protection Regression (MVER-R1)

In response to Codex review item MVER-R1, a dedicated Mac native regression `a_mac_case_alias_cannot_delete_or_trash_a_referenced_file` was added to `src-tauri/src/documents_save_tests.rs`:
- **Filesystem Capability Validation:** Asserts that differently capitalized names (`CASEGUIDE.PDF` and `caseguide.pdf`) exist for `CaseGuide.pdf`, resolve to identical canonical paths (`canonicalize()`), and share the same filesystem device and inode (`MetadataExt::dev()` and `MetadataExt::ino()`). On volumes where case-insensitivity does not hold, reports an explicit capability skip (`SKIPPED Mac case alias: this volume does not treat differently capitalized paths as the same file`) and returns cleanly.
- **Operations Exercised:** Attaches `CaseGuide.pdf` via `save_material_operation_at`. Attempts `delete_document_in` with `CASEGUIDE.PDF` (fails), `trash_unlinked_file_in` with `caseguide.pdf` (fails), `delete_document_in` with `caseguide.pdf` (fails), and `trash_unlinked_file_in` with `CASEGUIDE.PDF` (fails).
- **Invariants Confirmed:** Confirms original file exists on disk, byte hash is unchanged, database reference rows survive intact after reopening, and the `.trash` directory contains zero debris.
- **Windows Regression Preserved:** The existing Windows regression `a_windows_case_alias_cannot_delete_or_trash_a_referenced_file` remains untouched.

### 5.2 Host Volume (Case-Insensitive APFS)
- **Focused Case-Alias Regression:**
  - Command: `cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests::a_mac_case_alias_cannot_delete_or_trash_a_referenced_file`
  - Result: **1 passed, 0 failed, 0 ignored**; compilation 1.07s, test harness duration 0.04s (`finished in 0.04s`; combined 1.11s is a derived estimate); directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Tracked Receipt: [`docs/evidence/mac-a2-verification-2026-10-04/host-apfs-case-alias-test.txt`](evidence/mac-a2-verification-2026-10-04/host-apfs-case-alias-test.txt).
- **Updated Full Native Save Suite:**
  - Command: `cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests:: -- --nocapture`
  - Result: **21 harness passes** (20 exercised cases + 1 case-sensitive early return `distinct_case_files_on_a_case_sensitive_volume_are_not_conflated`), 0 failed, 0 ignored in 5.44s; directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Contention: Transient lock waited out and committed after `465.168375ms`; permanent lock timed out boundedly after `5.183800791s`.
  - Tracked Receipt: [`docs/evidence/mac-a2-verification-2026-10-04/host-apfs-save-tests-updated.txt`](evidence/mac-a2-verification-2026-10-04/host-apfs-save-tests-updated.txt).
- **Historical Baseline Run:**
  - Result: **20 harness passes** (19 exercised cases + 1 case-sensitive early return `distinct_case_files`), duration 5.45s, transient lock wait `469.290916ms`, permanent lock timeout `5203.948333ms` (5.203948333s measured; implementer-reported exit 0).
  - Tracked Receipt: [`docs/evidence/mac-a2-verification-2026-10-04/host-apfs-save-tests.txt`](evidence/mac-a2-verification-2026-10-04/host-apfs-save-tests.txt) (publishable copy with terminal EOF extra blank line trimmed; original `host-apfs-save-tests.log` preserved byte-for-byte).

### 5.3 Disposable Case-Sensitive APFS Volume
- **Procedure:** A disposable 64 MB UDIF disk image was created with `-fs "Case-sensitive APFS"`, mounted nobrowse in session scratch space. `diskutil info` verified `File System Personality: Case-sensitive APFS`.
- **Focused Case-Alias Regression:**
  - Command: `TMPDIR="$MOUNT" cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests::a_mac_case_alias_cannot_delete_or_trash_a_referenced_file`
  - Result: **1 passed** with explicit capability skip: `SKIPPED Mac case alias: this volume does not treat differently capitalized paths as the same file`; compilation 0.17s, test harness duration 0.05s (`finished in 0.05s`; combined 0.22s is a derived estimate); directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Tracked Receipt: [`docs/evidence/mac-a2-verification-2026-10-04/case-sensitive-apfs-case-alias-test.txt`](evidence/mac-a2-verification-2026-10-04/case-sensitive-apfs-case-alias-test.txt).
- **Updated Full Native Save Suite:**
  - Command: `TMPDIR="$MOUNT" cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests:: -- --nocapture`
  - Result: **21 harness passes** (20 exercised cases including full execution of `distinct_case_files` + 1 capability skip on Mac case alias) in 5.75s; directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Contention: Transient lock waited out and committed after `488.378708ms`; permanent lock timed out boundedly after `5.18682175s`.
  - Tracked Receipt: [`docs/evidence/mac-a2-verification-2026-10-04/case-sensitive-apfs-save-tests-updated.txt`](evidence/mac-a2-verification-2026-10-04/case-sensitive-apfs-save-tests-updated.txt).
- **Historical Baseline Run:**
  - Result: **20 harness passes** (20 exercised cases; `distinct_case_files` fully executed), duration 5.82s, transient lock `475.261958ms`, permanent lock `5225.525417ms` (5.225525417s measured; implementer-reported exit 0).
  - Tracked Receipt: [`docs/evidence/mac-a2-verification-2026-10-04/case-sensitive-apfs-save-tests.txt`](evidence/mac-a2-verification-2026-10-04/case-sensitive-apfs-save-tests.txt) (publishable copy with terminal EOF extra blank line trimmed; original `case-sensitive-apfs-save-tests.log` preserved byte-for-byte).
- **Cleanup:** Image was safely detached via `hdiutil detach` and removed.

---

## 6. Complete Local Matrix Execution

The full local validation matrix was executed sequentially without overlapping commands:

| # | Command | Result | Duration | Exit Capture | Tracked Receipt |
|---|---|---|---|---|---|
| **1** | `npm ci` | 166 packages audited, 0 vulnerabilities | 1.31s | implementer-reported (0) | [`gate-01-npm-ci.txt`](evidence/mac-a2-verification-2026-10-04/gate-01-npm-ci.txt) |
| **2** | `npm test` | 77 passed, 3 skipped files; **2,348 passed, 4 skipped tests** | 33.59s | implementer-reported (0) | [`gate-02-npm-test.txt`](evidence/mac-a2-verification-2026-10-04/gate-02-npm-test.txt)* |
| **3** | `npm run build` | `tsc --noEmit` clean; Vite production bundle built in 1.01s (main: 385.63 kB / 119.84 kB gzip) | 6.00s | implementer-reported (0) | [`gate-03-npm-run-build.txt`](evidence/mac-a2-verification-2026-10-04/gate-03-npm-run-build.txt) |
| **4** | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Clean formatting | 0.25s | implementer-reported (0) / re-verified (0) | [`gate-04-cargo-fmt.txt`](evidence/mac-a2-verification-2026-10-04/gate-04-cargo-fmt.txt) |
| **5** | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Clean compilation, 0 warnings across all targets | 36.52s | implementer-reported (0) / re-verified (0) | [`gate-05-cargo-clippy.txt`](evidence/mac-a2-verification-2026-10-04/gate-05-cargo-clippy.txt) |
| **6** | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | **286 passed, 0 failed, 6 ignored** (16 Windows-specific `#[cfg(windows)]` tests excluded on macOS; matches 302 - 16 = 286) | 22.07s | implementer-reported (0) | [`gate-06-cargo-test.txt`](evidence/mac-a2-verification-2026-10-04/gate-06-cargo-test.txt)* |
| **7** | `npm run test:cargo-lock` | Lockfile synchronized with `Cargo.toml` at `0.5.3` | 3.00s | implementer-reported (0) | [`gate-07-test-cargo-lock.txt`](evidence/mac-a2-verification-2026-10-04/gate-07-test-cargo-lock.txt) |
| **8** | `node scripts/check-release-version.mjs 0.5.3` | Version `0.5.3` valid under release policy | 0.05s | implementer-reported (0) | [`gate-08-check-release-version.txt`](evidence/mac-a2-verification-2026-10-04/gate-08-check-release-version.txt) |
| **9** | `node --test .claude/tests/setup-helpers.test.mjs` | **29 passed, 0 failed** via native macOS `/bin/sh` | 19.93s | implementer-reported (0) | [`gate-09-setup-helpers.txt`](evidence/mac-a2-verification-2026-10-04/gate-09-setup-helpers.txt) |
| **10** | `git diff --check` | Clean whitespace | 0.10s | implementer-reported (0) / re-verified (0) | [`gate-10-git-diff-check.txt`](evidence/mac-a2-verification-2026-10-04/gate-10-git-diff-check.txt) |

*\* Terminal EOF extra blank line trimmed in publishable copy; original `.log` preserved byte-for-byte.*

All 10 gate logs are preserved as tracked `.txt` receipts in `docs/evidence/mac-a2-verification-2026-10-04/`.

---

## 7. Packaging, Signing, and Installed Readiness Status (MVER-R2 Reconciliation)

### 7.1 Historical Preflight Snapshots
- **Text Preflight Invocation (2026-10-04T20:35:10.280Z):** Executed on clean starting git working tree prior to untracked log generation. Timestamp is implementer-reported.
  - Result: `PASS 10 · FAIL 0 · UNVERIFIED 2 · USER_ACTION 3`
  - Tracked Receipt: [`mac-readiness-preflight.txt`](evidence/mac-a2-verification-2026-10-04/mac-readiness-preflight.txt)
- **JSON Preflight Invocation (2026-10-04T20:35:13.197Z):** Separately executed with `--json`. Output redirection into an untracked file within the checkout caused check `R-SOURCE` to report untracked=1 (implementer-reported explanation). Timestamp is implementer-reported.
  - Result: `PASS 9 · FAIL 0 · UNVERIFIED 3 · USER_ACTION 3` (`R-SOURCE` unverified)
  - Receipt: [`mac-readiness-preflight.json`](evidence/mac-a2-verification-2026-10-04/mac-readiness-preflight.json)

### 7.2 Updated Preflight Invocations Captured Outside Checkout (MVER-R2)
- Captured outside checkout to `/tmp` in two separate invocations, then copied into evidence without modifying repo state during execution.
- **Separate Text Invocation (`generated 2026-10-04T21:01:04.154Z`):**
  - Command: `node scripts/mac-readiness-preflight.mjs > /tmp/new-preflight.txt`
  - Result: **`PASS 9 · FAIL 0 · UNVERIFIED 3 · USER_ACTION 3`**; directly captured `EXIT=0`.
  - Tracked Receipt: [`preflight-outside-checkout.txt`](evidence/mac-a2-verification-2026-10-04/preflight-outside-checkout.txt).
- **Separate JSON Invocation (`generatedAt 2026-10-04T21:01:04.378Z`):**
  - Command: `node scripts/mac-readiness-preflight.mjs --json > /tmp/new-preflight.json`
  - Result: **`PASS 9 · FAIL 0 · UNVERIFIED 3 · USER_ACTION 3`**; directly captured `EXIT=0`.
  - Tracked Receipt: [`preflight-outside-checkout.json`](evidence/mac-a2-verification-2026-10-04/preflight-outside-checkout.json).
- **Observed Check Status:**
  - `R-SOURCE` (`UNVERIFIED`): Accurately reflects that the working tree contains uncommitted MVER-R1 test addition and evidence files; tested source is HEAD (`1efc052`) plus local changes.
  - `P-A2-SOURCE` (`UNVERIFIED`): Automated runbook placeholder. A2 source publication is independently verified through PR #78 on GitHub main.
  - `P-TEST-ACCOUNT` (`USER_ACTION`): Standard test account requirement remains an owner prerequisite.
  - `P-SIGNING` (`USER_ACTION`): Developer ID credentials remain an owner prerequisite.
  - `P-INSTALLED-SMOKE` (`UNVERIFIED`): Installed smoke phases 1–8 remain unverified.

---

## 8. Summary, Exclusions, and Boundaries

1. **A2 Source Status:** Verified on Apple Silicon Mac. The atomic study-material saves implementation merged in PR #78 functions correctly on macOS across all tested source, database, and native APFS boundaries.
2. **Explicit Capability and Cfg Exclusions:**
   - `#[cfg(windows)]`: 16 Windows-specific tests are excluded on macOS (e.g. `a_windows_case_alias_cannot_delete_or_trash_a_referenced_file`, Windows-only drive letter / UNC path tests).
   - `#[cfg(target_os = "macos")]`: The Mac case-alias regression requires a case-insensitive filesystem; it reports an explicit capability skip on case-sensitive APFS volumes.
   - `distinct_case_files`: Early-returns on case-insensitive filesystems; fully executes on case-sensitive APFS.
3. **Owner Waivers and Decisions:**
   - The M2 real-user check-in requirement is waived by the owner decision ([`docs/M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md`](M2_REAL_USER_CHECKIN_OWNER_WAIVER_2026-10-04.md)).
   - This waiver does not supply separate Slice B product decisions (D1–D9), nor does it authorize installed release publication.
4. **Review Handoff:**
   - All verification evidence, tracked `.txt` receipts, and documentation remain uncommitted and unpushed for independent Codex re-review.
   - The dirty primary checkout `/Users/rickymac/code/Flight-training-` remains preserved untouched on `claude/cool-carson-9wjrub`.
