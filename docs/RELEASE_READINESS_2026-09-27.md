# Release-readiness check and Mac-only candidate plan — 27 September 2026

This is a local preflight, release-audit, and Mac-only candidate plan for `main` at `8733d7d` on Windows x64. It is **not** approval to tag or distribute an installer. The latest published version recorded in `STATUS.md` is `v0.5.1`; source version `0.5.2` is permanently retired.

**Core release strategy revision:** The unresolved Windows Defender review blocks **Windows distribution only**. We do not wait months for a vendor response before preparing and validating an Apple Silicon Mac candidate. Windows remains on `v0.5.1` pending separate security clearance, while candidate `v0.5.3` proceeds as an explicitly **Mac-only candidate**.

> [!IMPORTANT]
> **Code-level checks passed vs. Candidate existence:**
> All automated TypeScript, Vite, Clippy, and Rust unit/integration checks have passed locally on Windows. However, **no macOS DMG candidate has been built or installed yet**. Local Windows builds cannot create DMG packages (`npm run tauri build -- --bundles dmg` is unsupported on Windows). An actual usable Mac candidate exists only after a successful Apple Silicon build (via GitHub Actions `macos-15` or an Apple Silicon Mac). Physical Mac installation, launch, and smoke tests remain completely **UNVERIFIED**.

---

## Local verification matrix

| Check | Result |
| --- | --- |
| `npm ci` | Passed; 164 packages installed, 0 reported vulnerabilities. (Used temporary cache when shared Windows cache returned `EPERM`.) |
| `npm test` | Passed: 59 files / 568 tests passed; 3 files / 3 tests skipped by design. (Historical run earlier in session was 554 tests; expanded to 568 with 25 release-safety and matrix regression tests). |
| `npm run build` | Passed (TypeScript and Vite). Generates web bundle in `dist/`; not a desktop installer. |
| `cargo fmt --check` | Passed. |
| `cargo clippy --all-targets -- -D warnings` | Passed clean with zero warnings. |
| `cargo test` | Passed: 158 Rust tests; 5 ignored manual benchmarks; no failures. (45 `documents`, 21 `pdf`, 15 `debrief`, 45 `backup`). |
| `git diff --check` | Passed; clean working tree formatting. |
| `node scripts/check-release-version.mjs 0.5.3` | Passed eligibility check. (Source files remain at `0.5.2` pending reviewed candidate preparation step). |

The local checkout reports `main` at `8733d7d`. A remote GitHub comparison was unavailable: GitHub CLI lacked local configuration, and Git over HTTPS lacked cached Windows credentials. Do not treat locally cached `origin/main` as proof that remote is unchanged.

---

## 1. Release-path audit, dynamic matrix, and fail-closed workflow

1. **Candidate version synchronization via `scripts/bump-version.mjs`:**
   - Source versions are currently `0.5.2` across the repository.
   - `scripts/bump-version.mjs` synchronizes all five version locations without committing or tagging:
     1. `package.json`
     2. `package-lock.json` (`version` and root package `packages[""].version`)
     3. `src-tauri/tauri.conf.json`
     4. `src-tauri/Cargo.toml`
     5. `src-tauri/Cargo.lock` (updating the `her-flight-deck` package entry via `cargo check --manifest-path src-tauri/Cargo.toml --quiet`)
   - Pre-bump validation rejects retired versions (e.g. `0.5.2`) and malformed versions before touching disk.
   - Post-bump verification confirms all 5 files strictly agree; `cargo check` lockfile updating executes without silent error suppression (`|| true` removed).
   - `scripts/release.sh` integrates `bump-version.mjs` and verifies `Cargo.lock` before commit/tagging.
2. **Dynamic matrix in `.github/workflows/release.yml`:**
   - *No invalid job-level `if`:* GitHub evaluates job conditions before matrix expansion. The invalid `if: matrix.name == 'macOS' || ...` was replaced by dynamic matrix evaluation in the existing `check` job's `resolve` step.
   - *Target evaluation:* `target` input accepts `macos-only` (default) or `all`. Unknown targets are rejected immediately.
   - *Windows hold enforcement:* The workflow rejects `target: all` unless policy explicitly authorizes Windows (`winStatus === "active"`). If Windows status is `held`, missing, undefined, or misspelled, selecting `all` exits with code 1 in `check` before any runner starts.
   - *Runner isolation:* For `macos-only`, `resolve` outputs a dynamic matrix containing only `macos-15` (`name: "macOS"`). The Windows runner is never instantiated.
3. **Fail-closed artifact verification in `publish` job:**
   - Fails closed if expected macOS DMG is missing from `installers/`.
   - Fails closed if an unexpected Windows `.exe` appears while Windows distribution is not active.
   - Formats Mac-only draft release notes, omitting Windows download rows and displaying an explicit notice that Windows is held on `v0.5.1`.
4. **Automated regression coverage:**
   - `src/logic/releaseSafety.test.ts` covers 25 tests: retired version rejection, CLI errors, valid candidate acceptance, module API, 5-file repository version consistency (without hardcoded versions), temporary copy `bumpVersions` test verifying both `package-lock.json` entries and `Cargo.lock`, dynamic matrix resolution (`macos-only`, active `all`, rejected held/missing `all`, malformed target), declared YAML parser AST syntax and structural workflow validation (using declared `yaml` npm package, replacing undeclared PyYAML), `create_draft` input schema default and resolution logic isolating draft/tag creation to the `publish` job, fail-closed artifact guards, stale lockfile read-only failure verification, input injection prevention in `run:` blocks, and `--locked` Cargo execution.

---

## 2. Exact-installer candidate preparation, tag sequence, and evidence specification

### The Exact-Installer Invariant
**The exact bytes published to users must be the exact bytes tested on physical hardware.**
Testing one CI run's artifact does not authorize distributing newly built bytes from a subsequent workflow run.

### Candidate preparation sequence
Source versions in the repository are currently `0.5.2` (permanently retired). Therefore, a release workflow targeting `0.5.3` will fail at the `check` job until the repository is synchronized:
1. Run `node scripts/bump-version.mjs 0.5.3`. Do **not** run `scripts/release.sh` for candidate preparation because `release.sh` commits and creates a git tag immediately.
2. Verify with git diff: `git diff package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`.
3. Commit the bump to the branch: `git commit -m "chore: bump version to 0.5.3 for Mac candidate"`.

### Build & verification sequences

#### Sequence A (Direct Draft & Verification — Primary & Recommended):
1. In GitHub Actions, navigate to **Release** workflow and choose **Run workflow**:
   - `version`: `0.5.3`
   - `target`: `macos-only` (default)
   - `create_draft`: `true`
2. The workflow executes `check` and `build` on `macos-15`, builds `her-flight-deck_0.5.3_aarch64.dmg`, verifies artifacts, writes `SHA256SUMS.txt`, creates tag `v0.5.3`, and attaches the DMG to a private GitHub Release draft.
3. The tester downloads the **exact draft DMG** directly from the private GitHub Release draft and verifies its SHA-256 against `SHA256SUMS.txt` using the macOS-native command:
   ```bash
   shasum -a 256 -c SHA256SUMS.txt
   ```
   (On Linux environments, use `sha256sum -c SHA256SUMS.txt`.)
4. The tester installs and executes the full smoke test suite (Section 4) on physical Apple Silicon Mac hardware.
5. Record release evidence: exact draft DMG filename, full 64-character SHA-256 hash, GitHub Actions workflow run URL and ID, git commit SHA, Mac hardware model, Apple Silicon chip, unified RAM, macOS version, tester name, and date.
6. Once physical testing is fully verified and approved by Codex review, the draft can be published.

#### Sequence B (Private CI Artifact Pre-test + Mandatory Re-test of Draft Bytes):
1. If a maintainer chooses to first run with the default `create_draft: false` as a dry-run CI build to test on a Mac before creating a tag:
   - Maintainers download `installer-macOS` from the workflow run summary to catch packaging or runtime defects early. In this default mode, the workflow produces private CI artifacts only; it does not create a git tag or a GitHub Release draft.
   - **Crucial Rule:** That initial smoke test is strictly a *pre-flight test* of the candidate branch, NOT approval of newly built bytes.
2. When ready to cut the release, run the workflow with `create_draft: true` to create the immutable tag and reviewable draft.
3. Because this subsequent workflow run recompiles the DMG (producing newly built bytes with a distinct checksum), **the tester MUST download the exact newly built draft DMG**, verify its new SHA-256 (via `shasum -a 256 -c SHA256SUMS.txt`), and perform the installed-Mac smoke test on those exact draft bytes before publication can be approved.

### Explicit reconciliation with no-retag rule
When `create_draft: true` runs, GitHub creates tag `v0.5.3` pointing to `$GITHUB_SHA` when drafting the release.
- **Strict no-retag rule:** Under no circumstances may tag `v0.5.3` be force-updated, repointed, or reused if the candidate fails device testing.
- **Candidate retirement procedure:** If the `0.5.3` candidate fails physical device smoke testing, signing verification, or security review:
  1. The `0.5.3` candidate is formally declared **retired**.
  2. The failure reason and candidate SHA are appended to `retiredVersions` in `scripts/release-policy.json`.
  3. The unreleased draft in GitHub Releases is discarded.
  4. The underlying issue is fixed in source code.
  5. The version is advanced to the next patch version via `node scripts/bump-version.mjs 0.5.4`.

---

## 3. Windows distribution hold and safe profile isolation

1. **Windows distribution hold:**
   - Windows distribution remains held on `v0.5.1`. Version `0.5.2` is permanently retired after the `Wacatac.B!ml` Defender detection.
   - No Windows installer will be attached or advertised for `v0.5.3`. Windows users continue using `v0.5.1` until an exact new Windows candidate passes Defender review and/or receives trusted signing.
2. **Local profile isolation on this Windows machine:**
   - Traced `storage::app_root` and `tauri-plugin-sql` to Tauri's `app.path().app_config_dir()`, which hardcodes Windows `FOLDERID_RoamingAppData` (`%APPDATA%\com.herflightdeck.app`). Tauri exposes no CLI flags or environment variables to redirect this path without modifying production Rust code.
   - Because the current Windows user (`ricky`) holds real flight training data, running test binaries or restores on this machine under this account risks live data. Installed Windows smoke tests remain explicitly **UNVERIFIED** on this machine.
   - When Windows testing resumes, follow the isolated procedure using a dedicated standard account (`HFDTestUser`) or VM.

---

## 4. Installed-app smoke test guide on Apple Silicon Mac

Execute these verification steps on an Apple Silicon Mac using an isolated OS user account and non-sensitive fixtures:

1. **Checksum verification and packaging inspection:**
   - Verify checksum against `SHA256SUMS.txt` using the macOS native command before mounting:
     ```bash
     shasum -a 256 -c SHA256SUMS.txt
     ```
   - Mount `her-flight-deck_0.5.3_aarch64.dmg`.
   - Verify bundle identifier: `com.herflightdeck.app`.
   - Verify architecture: `arm64` (Apple Silicon native).
   - Verify minimum macOS version in `Info.plist`: `12.0`.
2. **First launch & macOS security verification:**
   - Drag `Her Flight Deck.app` to `/Applications`.
   - Open the application from `/Applications`.
   - **Strict security guidance:**
     - Do **not** use or advise "Open Anyway" or Control-click Open.
     - Never suggest disabling Gatekeeper, lowering system security, or running terminal commands such as `xattr -d com.apple.quarantine`.
     - Record the exact macOS system dialog: exact title, message text, icon, and available buttons.
     - If macOS presents an untrusted developer prompt, code signing error, or reports the application as damaged/corrupt, **STOP** and record the telemetry. Investigate the root cause through proper Developer ID Application signing, Apple notary service (`notarytool`), bundle packaging structure, or archive integrity.
     - Keep MAC-01 and MAC-02 marked **UNVERIFIED** until an approved signing/distribution path is validated on device.
3. **Upgrade safety copy test:**
   - If testing upgrade over populated `v0.5.1` data, verify that before launch, `~/Library/Application Support/com.herflightdeck.app` holds prior data, and upon launch of `0.5.3`, `backup_if_upgraded` creates a timestamped safety backup in `backups/` and updates `last-run-version.txt`.
4. **Study Library import and Open:**
   - Import a non-sensitive test PDF (e.g. synthetic lopdf test PDF or public FAA handbook chapter).
   - Verify file is copied to `~/Library/Application Support/com.herflightdeck.app/documents/`.
   - Click **Open**: verify it launches the system default PDF viewer (Preview).
5. **Finder reveal:**
   - In Study Library, click **Reveal**: verify Finder opens with the stored PDF highlighted.
   - In Settings, click **Open folder**: verify Finder opens `~/Library/Application Support/com.herflightdeck.app/`.
6. **Automatic and manual splitting:**
   - Test manual split (e.g. pages 1–5): verify child part appears in library, original PDF remains untouched.
   - Test automatic split: verify child parts are generated within 50 MiB and 1,000 pages limits.
7. **Gemini study assistant:**
   - Enter test Gemini API key in Settings (transient password field). Verify key stored in restricted Application Support and excluded from backups and SQLite.
   - Generate study guide and flashcards from an imported PDF part. Verify UI displays generation without freezing.
8. **Complete backup to Downloads:**
   - In Settings, click **Save complete backup**. Save `.hfdbackup` archive to `~/Downloads/`.
   - Verify archive finalizes cleanly and contains `her-flight-deck.db` and `documents/` without secrets.
9. **Restore and recovery:**
   - In Settings, click **Restore backup** and select the `.hfdbackup` file.
   - Verify restore preview dialog displays correct file count and size.
   - Confirm restore: verify app restarts cleanly with restored records intact.

---

## 5. CI Portability and Dependency Isolation

Codex's third review identified a portability blocker on clean runners: `checks.yml` and `release.yml` run `npm test` before installing the Rust toolchain and Linux Tauri desktop libraries. Previous tests invoked `cargo check` and required undeclared PyYAML, which worked on the development machine but would fail on clean runners where Cargo and PyYAML are absent during `npm test`.

### Implemented Corrections:
1. **Declared npm dependency for YAML parsing:**
   - Added `yaml: "^2.9.1"` to `devDependencies` in `package.json` and synchronized `package-lock.json`.
   - Replaced Python/PyYAML CLI execution in `src/logic/releaseSafety.test.ts` with direct `YAML.parse(readFileSync(...))`. Parse errors throw immediately and fail the test without silent suppression.
   - Validates syntax and AST structure for both `.github/workflows/release.yml` and `.github/workflows/checks.yml`.

2. **Self-contained version-file editing test:**
   - `releaseSafety.test.ts` fixture test copies only the 5 version files (`package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`) to an isolated temporary directory in `os.tmpdir()`.
   - Invokes `bumpVersions("0.5.99", tempDir, { syncCargoLockDirectly: true })` without Cargo compilation or subshell execution.
   - Does **not** point at, touch, or pollute the real checkout's `src-tauri/target` cache.
   - Verifies exact synchronization across both root entries of `package-lock.json` and the `her-flight-deck` package entry in `Cargo.lock`.

3. **Failed lockfile update visibility & commit/tag prevention:**
   - Added explicit tests in `releaseSafety.test.ts` verifying that if Cargo lockfile updating fails (e.g. `cargoRunner` throws an error) or if `Cargo.lock` is not updated, `bumpVersions` throws visibly and halts before any git operations.
   - `scripts/release.sh` executes with `set -euo pipefail`. Any failure in `bumpVersions` or the subsequent 5-file verification check aborts immediately before `git add`, `git commit`, or `git tag`.

4. **Read-only post-Rust Cargo lockfile integration check:**
   - Created `scripts/test-cargo-lock-sync.mjs` and npm script `test:cargo-lock`.
   - Checks that `src-tauri/Cargo.lock` exists and that its `her-flight-deck` package version matches `src-tauri/Cargo.toml` **before** executing any Cargo command.
   - Validates Rust toolchain presence (`cargo --version`), and runs `cargo check --locked --manifest-path src-tauri/Cargo.toml --quiet`. `--locked` ensures Cargo cannot silently rewrite a stale lockfile.
   - Added disposable fixture test confirming a stale lockfile causes failure without modifying the fixture file on disk.
   - Added `npm run test:cargo-lock` as an explicit step in `.github/workflows/checks.yml` and `.github/workflows/release.yml` positioned **after** `cargo test` and Rust toolchain / native library installation.
   - Added `npm run test:cargo-lock` to `scripts/release.sh` in the local checks section.

5. **Direct interpolation elimination & injection defense:**
   - Eliminated direct interpolation of free-text `workflow_dispatch` inputs (such as `${{ inputs.version }}`) and event attributes inside `run:` shell bodies in `.github/workflows/release.yml` and `.github/workflows/checks.yml`.
   - Passed inputs safely through step-level `env:` definitions (`INPUT_VERSION`, `INPUT_TARGET`, `INPUT_CREATE_DRAFT`, `EVENT_NAME`, `REF_NAME`).
   - Validated input parameters (e.g. semantic version regex `^v?[0-9]+\.[0-9]+\.[0-9]+$`) strictly in shell prior to execution.
   - Added an automated structural AST test in `src/logic/releaseSafety.test.ts` scanning all workflow `run:` blocks to ensure no `${{ inputs... }}` or `${{ github.event... }}` expressions are interpolated into shell strings.

6. **CI workflow prerequisite ordering, check separation, & `--locked` enforcement:**
   - **Checks workflow (`.github/workflows/checks.yml`):**
     - *Phase 1 (Pure Node/npm):* `npm ci` → `npm test` (568 unit/integration tests) → `npm run build` (TypeScript check + Vite production bundle). Depends solely on declared npm dependencies.
     - *Phase 2 (Native libraries & Rust):* `apt-get install` Linux desktop libraries → `dtolnay/rust-toolchain` (components `rustfmt, clippy`) → `swatinem/rust-cache`.
     - *Phase 3 (Rust formatting, linting, tests, & lockfile sync):* `cargo fmt --manifest-path src-tauri/Cargo.toml --check` → `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` → `cargo test --locked --manifest-path src-tauri/Cargo.toml` (158 Rust tests) → `npm run test:cargo-lock` (real read-only Cargo toolchain & lockfile sync check). Applicable Cargo commands enforce `--locked` to prevent silent lockfile mutation.
   - **Release workflow (`.github/workflows/release.yml`):**
     - Deliberately does **not** duplicate `npm run build`, `cargo fmt`, or `cargo clippy` in the `check` job.
     - *`check` job (Linux runner):* `npm ci` → `steps.resolve` (verifies 5-file version agreement, checks tag/release absence, evaluates target and Windows hold, computes dynamic matrix, resolves `create_draft`) → `npm test` → Linux desktop libraries → `rust-toolchain` → `cargo test --locked` → `npm run test:cargo-lock`.
     - *`build` job (matrix on target OS, e.g. `macos-15`):* compiles frontend and native desktop binary via Tauri build (`npm run tauri build -- --bundles <bundle>`), generating installer artifacts (`.dmg`).
     - *`publish` job:* gated strictly on `needs.check.outputs.create_draft == 'true'`. Runs only when explicitly authorized, verifies artifacts fail-closed, creates immutable tag `v<version>`, writes `SHA256SUMS.txt`, and creates GitHub Release draft.

---

## 6. Codex review and release gate

- **Current release status:** HOLD pending candidate compilation and physical Apple Silicon Mac installation and smoke test.
- **Distinction of states:**
  - *Automated code-level checks (this Windows machine):* **PASSED**
    - `npm test`: 59 test files passed, 568 tests passed (including 25 release safety tests), 3 benchmarks skipped. (Distinguished from historical run earlier in session of 554 tests / 19 release tests, and intermediate 567 tests / 24 release tests).
    - `npm run build`: Clean in 1.48s (typecheck + vite bundle).
    - `cargo fmt --check`: Clean (0 formatting diffs).
    - `cargo clippy --locked --all-targets -- -D warnings`: Clean (0 warnings).
    - `cargo test --locked`: 158 tests passed, 5 benchmarks ignored.
    - `npm run test:cargo-lock`: Clean read-only check (her-flight-deck is at 0.5.2 in both Cargo.toml and Cargo.lock).
    - `git diff --check`: Clean (no whitespace issues or merge markers).
  - *Clean CI runner verification:*
    - Workflows ordered so that `npm test` requires only declared npm dependencies and zero Rust/system tools.
    - User input passed via `env:` with zero shell string interpolation.
    - Full toolchain integration verified with `--locked` after setup steps.
  - *Usable Mac candidate:* **DOES NOT EXIST YET** (no DMG has been built or signed; build requires GitHub Actions `macos-15` or Apple Silicon Mac).
  - *Installed Mac verification:* **UNVERIFIED** (no physical device testing has occurred).
- **Next action:** Submit uncommitted changes to Codex for independent review. Do not commit, push, tag, run release workflows, or publish.
