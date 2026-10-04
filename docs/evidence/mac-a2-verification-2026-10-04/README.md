# Mac A2 Accepted Source Verification Evidence — 4 October 2026

**Coordinator acceptance, 4 October:** Codex accepted MVER-R1–R3 in [the final review](../../MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md). The source/native evidence below remains a dated implementer receipt. The owner subsequently directed: “review and no testing account ill wait for the release.” Test-account work is deferred; earlier provisioning statements are historical. The owner also reports no Apple Developer Program membership. Installed testing, signing and release approval remain unverified; no new waiver of those gates is inferred.

**Status: Pending Codex Re-Review (MVER-R1–R3 final evidence cleanup completed)**

## 1. Provenance and Environment

- **Host Hardware:** MacBook Air (Model Identifier: `Mac17,3`, Model Number: `Z1L6000RRLL/A`)
  - Chip: Apple M5 (10 cores: 4 Super, 6 Efficiency)
  - Memory: 32 GB
  - Architecture: arm64
- **Operating System:** macOS 27.0.1 (Build `26A434`)
- **Host Filesystem:** APFS (Case-Insensitive) on `/System/Volumes/Data` (volume UUID: `CE657701-9C7C-4D4A-BDA3-236F24C22E09`)
- **Process-Scoped Toolchain:**
  - Node: `v22.23.3` (`/opt/homebrew/opt/node@22/bin/node`)
  - npm: `10.9.9` (`/opt/homebrew/opt/node@22/bin/npm`)
  - Rustc: `1.99.0 (b940084d7 2026-09-28)` (`/opt/homebrew/opt/rustup/bin/rustc`)
  - Cargo: `1.99.0 (5f94df478 2026-08-27)` (`/opt/homebrew/opt/rustup/bin/cargo`)
  - macOS SDK: `MacOSX26.5.sdk` (`/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`, verified `xcrun --show-sdk-version` -> `26.5`)
- **Database Engines:**
  - node:sqlite SQLite version: `3.53.4`
  - sql.js version: `1.14.2`
  - Vitest version: `4.1.11`
- **Git Context:**
  - Repository: `rickydeleon49-ui/Flight-training-`
  - Agreed Working Checkout: `/Users/rickymac/code/Flight-training-pr70-integration` (clean agreed checkout starting state; currently uncommitted with MVER test addition and verification evidence)
  - Starting HEAD: `1efc052391ed96bdf1af17294f9ddc71960fc906`
  - Tree SHA: `1b5bcd9d289f06ebb34c7cfd9992a2c8849ec9c0`
  - Verified Ancestor Commit: `558725158cd93d49f8f9114693f61b08a00ffe2f` (PR #78 merge)
  - Verification Branch: `claude/mac-a2-verification-2026-10-04`
  - Primary Dirty Checkout (`/Users/rickymac/code/Flight-training-`): Preserved untouched on `claude/cool-carson-9wjrub`.

---

## 2. Source Identity and Manifest Matching (MVER-R2 Reconciliation)

All 24 accepted source files from `docs/evidence/a2-integration-acceptance-2026-10-04/source-manifest.json` were verified against the repository:

- **Pre-Edit Starting Baseline:** Verified against clean starting HEAD `1efc052391ed96bdf1af17294f9ddc71960fc906`:
  - **Git Blob Matching:** **24 of 24 files matched Git blob hashes identically** (`blob mismatches: 0`).
  - **Working-Byte Comparison Breakdown:**
    - **9 files matched directly:** Identical working bytes and SHA-256 between Mac checkout and Windows acceptance manifest.
    - **14 files matched via full-CRLF reconstruction:** Converting Mac checkout LF endings to CRLF reproduces the exact byte lengths and SHA-256 hashes from the Windows acceptance manifest.
    - **1 file had unresolved raw-byte reconstruction:** `src/perf/studyLibraryScenarios.test.ts`. Working disk bytes are 13,773 (SHA-256 `7d77d92cb1e107167bcda8d3c6d4e108846bb736019e5f21c621b790f7090acb`); full CRLF reconstruction is 14,073 bytes (SHA-256 `b365b4f6d9cbbbe28a53637dd42071c1299d8534fc6dae3515f259d49facbcf6`); the Windows manifest recorded 14,028 working bytes (SHA-256 `663c385cf4ea5fff9877c0a309d5d1706e26fedaedf9aebd94c3f4e070c58740`). The underlying Git blob `7140950205dec1b2c55a6de0a1aaeaea05c6b5ea` matches identically across both checkouts.
- **Submitted Working Tree State:**
  - **23 of 24 accepted source blobs remain byte-identical** to the accepted manifest. The sole expected difference is the 83-line test-only addition to `src-tauri/src/documents_save_tests.rs` implementing `a_mac_case_alias_cannot_delete_or_trash_a_referenced_file`. All production files remain unmodified. Source and accepted manifest remain intact.
- **Required Symbols and Registrations Confirmed:**
  - `saveMaterialAtomically` and `MaterialSaveOperation` in `src/data/db.ts`
  - `connectionOwner.ts` and `materialTransaction.ts` in `src/data/`
  - `documents_save_tests.rs` in `src-tauri/src/`
  - Native command registrations in `src-tauri/src/lib.rs`: both `study_packet::pick_study_packet` and `documents::save_material_operation`.

---

## 3. Diagnostic Package (181 Cases, 57 Conditional Seams)

- Diagnostic files (`a2ReviewDiagnostics.mac.test.ts` and `a2DiagnosticObservations.ts`) copied into `src/data/` after checking destination absence.
- Run command: `npx --no-install vitest run src/data/a2ReviewDiagnostics.mac.test.ts --reporter=verbose`
- **Result:** 181 passed, 0 failed, 0 skipped in 2.95s (implementer-reported exit 0).
- **All 57 conditional seams fired:**
  - 52 `[QT-11b]` seam assertions passed (`barrier.fired() === 1`, `engineReportsTransaction === true`)
  - 2 `[QT-02b]` seam assertions passed
  - 1 `[BD-05]` seam assertion passed
  - 1 `[BD-06]` seam assertion passed
  - 1 `[BD-11]` seam assertion passed
- Temporary files removed immediately; `git status --porcelain src/data/` verified clean.
- Tracked Receipt: [`a2-diagnostics.txt`](a2-diagnostics.txt) (publishable copy with terminal EOF extra blank line trimmed; original `a2-diagnostics.log` preserved byte-for-byte).

---

## 4. Maintained Focused Suite (8 Files, 1,470 Tests)

- Run command: `npx --no-install vitest run src/data/materialSaveContract.test.ts src/data/repositories/documentRepository.test.ts src/data/singleConnectionDrivers.test.ts src/pages/FlightJournal/debriefLinks.test.ts src/pages/FlightJournal/quickDebrief.test.ts src/pages/StudyLibrary/MaterialFormDialog.test.ts src/pages/StudyLibrary/materialSaveIntegration.test.ts src/perf/studyLibraryScenarios.test.ts --reporter=verbose`
- **Result:** 8 files passed, 1,470 tests passed, 0 failed, 0 skipped in 16.77s (implementer-reported exit 0).
- **Invariants Verified:**
  - **Atomic saves:** Single-connection immediate transaction, foreign keys enforced, bounded busy wait.
  - **Omitted-field preservation:** Partial updates keep unmentioned fields, file references, timestamps intact.
  - **Exact rollback:** Collision or error rolls back all rows, tags, and links; compares prior rows; proves zero orphan tags.
  - **Durable reopen:** Database close and reload proves committed state is preserved.
  - **Attachment conservation:** Referenced files protected; unreferenced intermediate files cleaned up; replacement cancellation keeps original file.
  - **Post-commit refresh handling:** Save followed by refresh failure remains successful; attachment retained.
  - **Failure recovery:** Safe retries without duplicate records across both browser/sql.js and desktop/sqlite drivers.
- Tracked Receipt: [`focused.txt`](focused.txt) (publishable copy with terminal EOF extra blank line trimmed; original `focused.log` preserved byte-for-byte).

---

## 5. Native Save and Document Tests on Actual APFS (MVER-R1)

### 5.1 Mac Case-Alias Protection Regression (MVER-R1)

In response to Codex review item MVER-R1, a focused native regression `a_mac_case_alias_cannot_delete_or_trash_a_referenced_file` was added to `src-tauri/src/documents_save_tests.rs`:
- **Filesystem Capability Validation:** Asserts that differently capitalized names (`CASEGUIDE.PDF` and `caseguide.pdf`) exist for `CaseGuide.pdf`, resolve to identical canonical paths (`canonicalize()`), and share the same filesystem device and inode (`MetadataExt::dev()` and `MetadataExt::ino()`). On volumes where case-insensitivity does not hold, reports an explicit capability skip (`SKIPPED Mac case alias: this volume does not treat differently capitalized paths as the same file`) and returns cleanly.
- **Operations Exercised:** Attaches `CaseGuide.pdf` via `save_material_operation_at`. Attempts `delete_document_in` with `CASEGUIDE.PDF` (fails), `trash_unlinked_file_in` with `caseguide.pdf` (fails), `delete_document_in` with `caseguide.pdf` (fails), and `trash_unlinked_file_in` with `CASEGUIDE.PDF` (fails).
- **Invariants Confirmed:** Confirms original file exists on disk, byte hash is unchanged, database reference rows survive intact after reopening, and the `.trash` directory contains zero debris.
- **Regression Safety:** The existing Windows regression `a_windows_case_alias_cannot_delete_or_trash_a_referenced_file` is preserved intact.

### 5.2 Test Executions and Receipts

#### Host Volume (Case-Insensitive APFS)
- **Focused Case-Alias Regression:**
  - Command: `cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests::a_mac_case_alias_cannot_delete_or_trash_a_referenced_file`
  - Result: **1 passed, 0 failed, 0 ignored**; compilation 1.07s, test harness duration 0.04s (`finished in 0.04s`; combined 1.11s is a derived estimate); directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Tracked Receipt: [`host-apfs-case-alias-test.txt`](host-apfs-case-alias-test.txt).
- **Updated Full Native Save Suite:**
  - Command: `cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests:: -- --nocapture`
  - Result: **21 harness passes** (20 exercised cases + 1 early return `distinct_case_files_on_a_case_sensitive_volume_are_not_conflated`), 0 failed, 0 ignored in 5.44s; directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Contention: Transient lock waited out and committed after `465.168375ms`; permanent lock timed out boundedly after `5.183800791s`.
  - Tracked Receipt: [`host-apfs-save-tests-updated.txt`](host-apfs-save-tests-updated.txt).
- **Historical Baseline Run:**
  - Result: **20 harness passes** (19 exercised cases + 1 early return `distinct_case_files`), duration 5.45s, transient lock wait `469.290916ms`, permanent lock timeout `5203.948333ms` (5.203948333s measured; implementer-reported exit 0).
  - Tracked Receipt: [`host-apfs-save-tests.txt`](host-apfs-save-tests.txt) (publishable copy with terminal EOF extra blank line trimmed; original `host-apfs-save-tests.log` preserved byte-for-byte).

#### Disposable Case-Sensitive APFS Volume
- **Procedure:** Created temporary 64 MB UDIF image formatted as `Case-sensitive APFS` (volume name `HFDA2CS`), mounted nobrowse in scratch space. Verified `diskutil info`: `File System Personality: Case-sensitive APFS`.
- **Focused Case-Alias Regression:**
  - Command: `TMPDIR="$MOUNT" cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests::a_mac_case_alias_cannot_delete_or_trash_a_referenced_file`
  - Result: **1 passed** with explicit capability skip: `SKIPPED Mac case alias: this volume does not treat differently capitalized paths as the same file`; compilation 0.17s, test harness duration 0.05s (`finished in 0.05s`; combined 0.22s is a derived estimate); directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Tracked Receipt: [`case-sensitive-apfs-case-alias-test.txt`](case-sensitive-apfs-case-alias-test.txt).
- **Updated Full Native Save Suite:**
  - Command: `TMPDIR="$MOUNT" cargo test --locked --manifest-path src-tauri/Cargo.toml documents::save_tests:: -- --nocapture`
  - Result: **21 harness passes** (20 exercised cases including full execution of `distinct_case_files` + 1 capability skip on Mac case alias) in 5.75s; directly captured `EXIT=0`. Start timestamp is implementer-reported.
  - Contention: Transient lock waited out and committed after `488.378708ms`; permanent lock timed out boundedly after `5.18682175s`.
  - Tracked Receipt: [`case-sensitive-apfs-save-tests-updated.txt`](case-sensitive-apfs-save-tests-updated.txt).
- **Historical Baseline Run:**
  - Result: **20 harness passes** (20 exercised cases; `distinct_case_files` fully executed), duration 5.82s, transient lock `475.261958ms`, permanent lock `5225.525417ms` (5.225525417s measured; implementer-reported exit 0).
  - Tracked Receipt: [`case-sensitive-apfs-save-tests.txt`](case-sensitive-apfs-save-tests.txt) (publishable copy with terminal EOF extra blank line trimmed; original `case-sensitive-apfs-save-tests.log` preserved byte-for-byte).
- **Cleanup:** Image detached cleanly via `hdiutil detach` and deleted.

---

## 6. Complete Local Gate Matrix (10 Commands)

All 10 gate logs are preserved as tracked `.txt` receipts. Exit statuses for historical runs are implementer-reported (captured via pipeline); new formatting and whitespace checks were independently validated with exit 0.

| # | Command | Result | Timing | Exit Capture | Tracked Receipt |
|---|---|---|---|---|---|
| 1 | `npm ci` | 0 vulnerabilities | 1.31s | implementer-reported (0) | [`gate-01-npm-ci.txt`](gate-01-npm-ci.txt) |
| 2 | `npm test` | 77 passed, 3 skipped; 2,348 passed, 4 skipped | 33.59s | implementer-reported (0) | [`gate-02-npm-test.txt`](gate-02-npm-test.txt)* |
| 3 | `npm run build` | tsc --noEmit clean; Vite bundle built in 1.01s | 6.00s | implementer-reported (0) | [`gate-03-npm-run-build.txt`](gate-03-npm-run-build.txt) |
| 4 | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | clean formatting | 0.25s | implementer-reported (0) / re-verified (0) | [`gate-04-cargo-fmt.txt`](gate-04-cargo-fmt.txt) |
| 5 | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | clean compilation, 0 warnings | 36.52s | implementer-reported (0) / re-verified (0) | [`gate-05-cargo-clippy.txt`](gate-05-cargo-clippy.txt) |
| 6 | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 286 passed, 6 ignored (16 Windows cfg excluded) | 22.07s | implementer-reported (0) | [`gate-06-cargo-test.txt`](gate-06-cargo-test.txt)* |
| 7 | `npm run test:cargo-lock` | synchronized at 0.5.3 | 3.00s | implementer-reported (0) | [`gate-07-test-cargo-lock.txt`](gate-07-test-cargo-lock.txt) |
| 8 | `node scripts/check-release-version.mjs 0.5.3` | valid and eligible | 0.05s | implementer-reported (0) | [`gate-08-check-release-version.txt`](gate-08-check-release-version.txt) |
| 9 | `node --test .claude/tests/setup-helpers.test.mjs` | 29 passed, 0 failed | 19.93s | implementer-reported (0) | [`gate-09-setup-helpers.txt`](gate-09-setup-helpers.txt) |
| 10 | `git diff --check` | clean whitespace | 0.10s | implementer-reported (0) / re-verified (0) | [`gate-10-git-diff-check.txt`](gate-10-git-diff-check.txt) |

*\* Terminal EOF extra blank line trimmed in publishable copy; original `.log` preserved byte-for-byte.*

---

## 7. Mac Readiness Preflight and Installed Status (MVER-R2 Reconciliation)

### 7.1 Historical Snapshots
- **Text Preflight Invocation (2026-10-04T20:35:10.280Z):** Executed on a clean git working tree prior to untracked log generation. Timestamp is implementer-reported.
  - Result: `PASS 10 · FAIL 0 · UNVERIFIED 2 · USER_ACTION 3`
  - Tracked Receipt: [`mac-readiness-preflight.txt`](mac-readiness-preflight.txt).
- **JSON Preflight Invocation (2026-10-04T20:35:13.197Z):** Separately executed with `--json`. Output redirection into an untracked file within the checkout caused check `R-SOURCE` to report untracked=1 (implementer-reported explanation). Timestamp is implementer-reported.
  - Result: `PASS 9 · FAIL 0 · UNVERIFIED 3 · USER_ACTION 3` (`R-SOURCE` unverified)
  - Receipt: [`mac-readiness-preflight.json`](mac-readiness-preflight.json).

### 7.2 Updated Preflight Invocations Captured Outside Checkout (MVER-R2)
- Captured outside checkout to `/tmp` in two separate invocations, then copied into evidence without modifying repo state during execution.
- **Separate Text Invocation (`generated 2026-10-04T21:01:04.154Z`):**
  - Command: `node scripts/mac-readiness-preflight.mjs > /tmp/new-preflight.txt`
  - Result: **`PASS 9 · FAIL 0 · UNVERIFIED 3 · USER_ACTION 3`**; directly captured `EXIT=0`.
  - Tracked Receipt: [`preflight-outside-checkout.txt`](preflight-outside-checkout.txt).
- **Separate JSON Invocation (`generatedAt 2026-10-04T21:01:04.378Z`):**
  - Command: `node scripts/mac-readiness-preflight.mjs --json > /tmp/new-preflight.json`
  - Result: **`PASS 9 · FAIL 0 · UNVERIFIED 3 · USER_ACTION 3`**; directly captured `EXIT=0`.
  - Tracked Receipt: [`preflight-outside-checkout.json`](preflight-outside-checkout.json).
- **Observed Check Status:**
  - `R-SOURCE` (`UNVERIFIED`): Accurately reflects that the working tree contains uncommitted MVER-R1 test addition and evidence files; tested source is HEAD (`1efc052`) plus local changes.
  - `P-A2-SOURCE` (`UNVERIFIED`): Automated runbook placeholder. A2 source publication is independently verified through PR #78 on GitHub main.
  - `P-TEST-ACCOUNT` (`USER_ACTION`): Standard test account requirement remains an owner prerequisite.
  - `P-SIGNING` (`USER_ACTION`): Developer ID credentials remain an owner prerequisite.
  - `P-INSTALLED-SMOKE` (`UNVERIFIED`): Installed smoke phases 1–8 remain unverified.

---

## 8. Tracked Receipts Inventory and Hash Mapping (MVER-R3)

All 15 historical `.log` files are preserved locally and continue to be ignored under `.gitignore:120` (`*.log`). Tracked `.txt` copies are provided for publication. For six files, a single terminal EOF extra blank line was trimmed to resolve whitespace diagnostics; the remaining nine pairs are byte-identical.

### 8.1 Historical Log-to-Txt Byte and Hash Mapping

| Original Log File | Orig Bytes / Orig SHA-256 | Tracked Txt Receipt | Copy Bytes / Copy SHA-256 | Transformation |
|---|---|---|---|---|
| `a2-diagnostics.log` | 370,489<br>`0fdb74011b2da525dd844e47abc0982d9b087b8c42ffe5679be8fdab18d73d2c` | [`a2-diagnostics.txt`](a2-diagnostics.txt) | 370,488<br>`c49841d42a5c35cc36b33a4e4103f0d4e3ec7c45ad41ffc47d34f4b7e6077278` | EOF extra blank line trimmed |
| `case-sensitive-apfs-save-tests.log` | 2,512<br>`4de0a81586ac1f4f4876256600b6d9cc5a61d796a8a27b1b0e565844d636e875` | [`case-sensitive-apfs-save-tests.txt`](case-sensitive-apfs-save-tests.txt) | 2,511<br>`1173b6b3c5922b49aabbad436fb3a1f808b2a5fd022ef2e61a8afc353292e841` | EOF extra blank line trimmed |
| `focused.log` | 372,981<br>`34ad3cda7d6c2cb851c7b81512b5c6a00088dc4de2a0fb41b20cf0020d87b8fc` | [`focused.txt`](focused.txt) | 372,980<br>`8275eaa7c7e97e4a6b4a97d069f0a72a04c489290531416e44c090b4ed29a186` | EOF extra blank line trimmed |
| `gate-01-npm-ci.log` | 143<br>`6812d549168cf99ca997fdc006dadcdce322d6a11abe3851795f92d376035338` | [`gate-01-npm-ci.txt`](gate-01-npm-ci.txt) | 143<br>`6812d549168cf99ca997fdc006dadcdce322d6a11abe3851795f92d376035338` | Zero transformation (byte-identical) |
| `gate-02-npm-test.log` | 15,607<br>`400fba7356eb4be293c7656a7b8d8484eee1b50494f905c80e1a760ef5c2231f` | [`gate-02-npm-test.txt`](gate-02-npm-test.txt) | 15,606<br>`5a55b65eaf51158eb844ae8be1ee28a1b11b9bfb3d35374e4a668270483ce5bc` | EOF extra blank line trimmed |
| `gate-03-npm-run-build.log` | 4,186<br>`974cf7ba32ad9555d93f04d6cbd535c3563a5528076d006eff3e71e3041cf828` | [`gate-03-npm-run-build.txt`](gate-03-npm-run-build.txt) | 4,186<br>`974cf7ba32ad9555d93f04d6cbd535c3563a5528076d006eff3e71e3041cf828` | Zero transformation (byte-identical) |
| `gate-04-cargo-fmt.log` | 0<br>`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | [`gate-04-cargo-fmt.txt`](gate-04-cargo-fmt.txt) | 0<br>`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Zero transformation (byte-identical) |
| `gate-05-cargo-clippy.log` | 9,001<br>`3419cc8d2ed728435e416f5ee9d9431fec71fe32ab1fa2090b85c5f264c9c40a` | [`gate-05-cargo-clippy.txt`](gate-05-cargo-clippy.txt) | 9,001<br>`3419cc8d2ed728435e416f5ee9d9431fec71fe32ab1fa2090b85c5f264c9c40a` | Zero transformation (byte-identical) |
| `gate-06-cargo-test.log` | 25,523<br>`eaab0ac07cd4b2b54661cebabd70d2f1e1355c36a615f2a0704b231a2c78c751` | [`gate-06-cargo-test.txt`](gate-06-cargo-test.txt) | 25,522<br>`264ba8567d05094e3fdfc9cd7332b16915770558109eb97ce66c4c96e5b5ecef` | EOF extra blank line trimmed |
| `gate-07-test-cargo-lock.log` | 254<br>`0c396c93a4465f45b27143b1a480a5660f8169c18338a506df26b2ffbb3cd802` | [`gate-07-test-cargo-lock.txt`](gate-07-test-cargo-lock.txt) | 254<br>`0c396c93a4465f45b27143b1a480a5660f8169c18338a506df26b2ffbb3cd802` | Zero transformation (byte-identical) |
| `gate-08-check-release-version.log` | 49<br>`d9f095e7895c142842dbdd55b721cb226b82b3c795d7511e22852fa4f5b0cad1` | [`gate-08-check-release-version.txt`](gate-08-check-release-version.txt) | 49<br>`d9f095e7895c142842dbdd55b721cb226b82b3c795d7511e22852fa4f5b0cad1` | Zero transformation (byte-identical) |
| `gate-09-setup-helpers.log` | 6,250<br>`18f8065992b1d9effa71eb0e034001ffcf50bc8afbfa4ce3288bfc8ddbfea9e8` | [`gate-09-setup-helpers.txt`](gate-09-setup-helpers.txt) | 6,250<br>`18f8065992b1d9effa71eb0e034001ffcf50bc8afbfa4ce3288bfc8ddbfea9e8` | Zero transformation (byte-identical) |
| `gate-10-git-diff-check.log` | 0<br>`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | [`gate-10-git-diff-check.txt`](gate-10-git-diff-check.txt) | 0<br>`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Zero transformation (byte-identical) |
| `host-apfs-save-tests.log` | 2,577<br>`a4b46aa64e5dc60684ae540a9ca284729a7d4bea98b29b2007ac0b082bf35eb2` | [`host-apfs-save-tests.txt`](host-apfs-save-tests.txt) | 2,576<br>`c8a106c1bc9d05921776f0dd4c425572c90109a7ddb933af76eb251dec9a1c39` | EOF extra blank line trimmed |
| `mac-readiness-preflight.log` | 2,027<br>`d06f2b8788432a69d8f91e40961c67eb782da0d0791851e4cd6ec12c81d777a1` | [`mac-readiness-preflight.txt`](mac-readiness-preflight.txt) | 2,027<br>`d06f2b8788432a69d8f91e40961c67eb782da0d0791851e4cd6ec12c81d777a1` | Zero transformation (byte-identical) |

### 8.2 New MVER-R1 and MVER-R2 Receipts

| Receipt File | Byte Size | SHA-256 Hash | Purpose |
|---|---|---|---|
| [`host-apfs-case-alias-test.txt`](host-apfs-case-alias-test.txt) | 701 | `801e13e938acc135617e873f775d01d51f20abf945935d3559ad70a8161b4f3c` | MVER-R1 focused case-alias test on host APFS (1 passed, exit 0) |
| [`host-apfs-save-tests-updated.txt`](host-apfs-save-tests-updated.txt) | 2,677 | `bc82a8e34b3d6a16afdb0fd60bd5623c859096062b54b4f15f00a675a301a59e` | MVER-R1 full native save suite on host APFS (21 passes: 20 exercised + 1 skip, exit 0) |
| [`case-sensitive-apfs-case-alias-test.txt`](case-sensitive-apfs-case-alias-test.txt) | 697 | `a8b8dffacbdfacd877d42bac6eceb9d49b78be1d5a15bd3c93ae767d94d52895` | MVER-R1 focused case-alias test on CS APFS (1 passed with explicit capability skip, exit 0) |
| [`case-sensitive-apfs-save-tests-updated.txt`](case-sensitive-apfs-save-tests-updated.txt) | 2,709 | `db1e229442779d0ca519f22a07cbdc411a2171fbfaf57b28e07c68a27ce4fd6e` | MVER-R1 full native save suite on CS APFS (21 passes: 20 exercised + 1 capability skip, exit 0) |
| [`mac-readiness-preflight.json`](mac-readiness-preflight.json) | 6,644 | `c094f0f4c3f2afd51a57ae6fdc0889d029139654fbfd5e9677ff7a280b1b58c9` | Historical preflight JSON receipt (9 PASS, 3 UNVERIFIED, 3 USER_ACTION) |
| [`preflight-outside-checkout.txt`](preflight-outside-checkout.txt) | 2,084 | `6aa3a9dc9b58e0af4a5e766de90c5e8f989167420aa6aedfaa4d1134b4c4cad5` | MVER-R2 text preflight invocation captured outside checkout (9 PASS, 3 UNVERIFIED, 3 USER_ACTION, exit 0) |
| [`preflight-outside-checkout.json`](preflight-outside-checkout.json) | 6,644 | `33d7a9d0e00463d50379d70a467d21a003e7efee6af9d738206b4e16b75f540b` | MVER-R2 JSON preflight invocation captured outside checkout (9 PASS, 3 UNVERIFIED, 3 USER_ACTION, exit 0) |
| [`results.json`](results.json) | 9,684 | `701948fc7a459c00705a38dd8ed54fdf359c2f92db83b3f9f1b3c01f3791ad22` | Machine-readable results with tracked .txt references, captured exits, and MVER entries |
