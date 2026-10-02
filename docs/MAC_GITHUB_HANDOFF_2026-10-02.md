# Start Her Flight Deck work on the Mac

Prepared 2 October 2026. This handoff is entirely in GitHub. No `H:\` worktree, Windows attachment, private chat history, local log, installer, database or generated PDF needs to be copied from the Windows computer.

Repository: **https://github.com/rickydeleon49-ui/Flight-training-** (private; use an account with repository access).

## What you can start now

Clone the latest `main`, run the Mac-local automated checks, build a local evaluation DMG, and collect actual Apple Silicon/WKWebView/native integration evidence using synthetic data. The [Mac session prompt](MAC_SESSION_PROMPT.md) is ready to give the agent on that computer. Save results using the [template](templates/MAC_SMOKE_RESULTS_TEMPLATE.md).

At preparation time main was `533a8f50c2d0de74a75f5542022da3182f376ee9` (PR #42 merged). Treat that as historical context; **record the actual HEAD you test**, since further reviewed changes may land. A1 restore safety is merged. A2 atomic Study Library save changes remain uncommitted on Windows and have two remaining [review corrections](A2_SECOND_REVIEW_2026-10-02.md). Main does not include them. A3–A6 remain open in the [repository audit](FULL_REPOSITORY_AUDIT_2026-09-29.md).

Use a dedicated standard macOS test user with synthetic data. The desktop uses `~/Library/Application Support/com.herflightdeck.app`; changing an environment variable does not provide profile isolation. If that user already has real app data, preserve it and switch to a clean test user before restore/update tests. Do not delete or replace a real profile to make a test pass.

## Get the repository

After installing the developer prerequisites below, use Terminal in a directory you own:

```bash
git clone https://github.com/rickydeleon49-ui/Flight-training-.git
cd Flight-training-
git status --short --branch
git rev-parse HEAD
```

For the private repository, authenticate with GitHub's normal sign-in flow. If GitHub CLI is installed, these commands let you authenticate through the browser without pasting a token into chat:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```

Run authentication before cloning if Git requires it. GitHub Desktop or an already configured SSH/HTTPS credential helper is also fine. Never put a GitHub token in the clone URL, committed files or evidence.

If this is an existing clone, inspect its branch and working tree first. A clean checkout of `main` can use `git pull --ff-only origin main`; do not reset or pull over another agent's uncommitted work. Create any correction branch from updated `origin/main` and coordinate ownership before editing.

## Developer setup

This toolchain is for building and testing source. An eventual approved packaged app does not require its user to install Node or Rust.

- Native Apple Silicon Terminal/toolchain: record `uname -m`, Node architecture and Rust host. An x86_64/Rosetta environment is not evidence of an Apple Silicon build.
- Node **22**, matching the normal repository CI checks, and npm.
- Stable Rust installed through rustup, with rustfmt and clippy.
- Apple's Xcode Command Line Tools for this desktop-only task. Full Xcode is needed for future iOS work, which is outside this handoff. See [Tauri's official prerequisites](https://v2.tauri.app/start/prerequisites/#macos).

Check what is already installed before downloading anything:

```bash
uname -m
sw_vers
sysctl -n hw.memsize
node --version
node -p process.arch
npm --version
rustc -vV
cargo --version
xcode-select -p
```

If Apple's tools are absent, `xcode-select --install` opens Apple's installer. Install Node 22 from an official distribution or an existing version manager. Follow [rustup's installation instructions](https://rustup.rs/) if Rust is absent; then install missing components with:

```bash
rustup component add rustfmt clippy
```

Do not update the Mac's OS just to hide a compatibility failure. Test the OS actually present and record any unavailable minimum-version coverage. No separate Safari launch is required: the Tauri app runs in WKWebView. A modern Mac cannot establish early macOS 12 compatibility by itself.

## Run the local checks once

From the repository root, run each command separately and stop on a failure. Capture the exact command, exit code and log location in a local evidence directory. Do not commit node_modules, target, installers or raw app data.

```bash
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:cargo-lock
git diff --check
```

A failed command is a finding to diagnose with a focused test. Do not push speculative fixes or repeatedly run the complete matrix. No PostgreSQL service or container is required for this SQLite app.

## Generate the PDF fixtures locally

The generator is tracked in `scripts/generate-pdf-fixtures.mjs`; no binary attachment from Windows is needed. Use a new output directory so existing files are not overwritten:

```bash
HFD_FIXTURES=$(mktemp -d "${TMPDIR:-/tmp}/hfd-mac-fixtures.XXXXXX")
node scripts/generate-pdf-fixtures.mjs "$HFD_FIXTURES"
open "$HFD_FIXTURES"
```

It prints byte sizes and SHA-256 values. The [Mac parity checklist](MAC_PARITY_CHECKLIST.md#4-synthetic-non-sensitive-pdf-test-fixtures) gives expected identities and page counts for the 10-page checklist, 1,050-page manual and 60-page image-heavy PDF. Check actual bytes/hashes; keep these files out of Git. Visual rendering and page content must be checked on the Mac, not inferred from a generator succeeding.

## Build and identify a local source evaluation artifact

Only after the local checks pass:

```bash
npm run tauri build -- --target aarch64-apple-darwin --bundles dmg
```

The DMG is under `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/` for this explicit-target command. Record the exact file path, byte size and SHA-256 using `shasum -a 256` on that individual file. Inspect the app bundle's Info.plist and executable with `plutil` and `file`: bundle identifier must be `com.herflightdeck.app`, executable arm64, declared minimum macOS 12.0. Collect signing/notarization assessment; build success alone is not installed-app evidence.

This is a **local source evaluation build**, even while its source version says 0.5.3. It is a different artifact from the frozen private v0.5.3 draft. Do not replace draft assets, overwrite a recorded checksum, move a published tag or record this build as that exact candidate. The existing [frozen artifact instructions](MAC_PARITY_CHECKLIST.md#october-2-mac-test-kit-non-sensitive-synthetic-data) are a separate test lane.

Mount the identified evaluation DMG normally in Finder and install/launch in the isolated test user's context. If an existing `/Applications/Her Flight Deck.app` is present, preserve it and record its identity before any replacement; do not overwrite another user's working app. A signing or Gatekeeper refusal is a first-launch failure to record. Follow the [release review process](RELEASE_REVIEW_PROCESS.md); do not disable protections or clear quarantine to claim a pass. A development launch may help diagnose source behavior, but must be labeled separately from a successful installed-DMG launch.

## Installed-app smoke tests

Perform these in the test user, recording outcomes and timings individually:

1. First usable launch; version; window resizing, keyboard focus and dialogs.
2. Import the small PDF, then rename/move its source fixture and verify the app-owned copy still opens in the default viewer.
3. PDF Open, document Reveal and Settings Open folder. Verify Finder's actual directory against the displayed app-data path.
4. Create and edit a material, replace/reorder/clear tags, retry a failed save if safely reproducible, and Cancel a failed replacement. On current main, note the known A2 defects; do not assume the local Windows fixes are present.
5. Automatic split the long and image-heavy fixtures: all pages exactly once and in order, each part at most 50 MiB and 1,000 pages, useful labels, separate records and study actions. Hash the originals before and after; check progress and responsiveness.
6. Manual split valid and invalid ranges; check output contents, clear validation, rollback and cleanup. Keep destructive/fault injection inside test profiles.
7. Complete backup to Downloads during ordinary autosave/split activity; record any busy/lock message and elapsed bound. Confirm a finalized readable `.hfdbackup`, and inspect it with `node scripts/inspect-backup-credentials.mjs /exact/path/to/test.hfdbackup`.
8. Restore the synthetic backup in an isolated test profile; compare records and file hashes. Test a corrupted archive without risking real data; existing data must remain recoverable.
9. Saved guides, flashcards and practice tests offline. Gemini generation is optional if no key is configured; if explicitly enabled, use only the selected synthetic PDF, keep the key in native storage and never include it in logs/screenshots/archives.
10. Update/install over an existing **synthetic** dataset using separately identified test builds. Record what was actually tested; do not substitute an empty first launch for upgrade testing.

Also run the relevant automated restore and document tests on macOS. Record symlink and filesystem-case results. Use an existing authorized case-sensitive test volume if available; do not partition or format a disk for this handoff. Missing OS/volume coverage stays UNVERIFIED.

Use [MAC_PARITY_CHECKLIST.md](MAC_PARITY_CHECKLIST.md) for detailed MAC/PERF case IDs and [backup-format.md](backup-format.md) for archive semantics. Static/CI checks, browser mode and Tauri development mode cannot replace the installed smoke-test evidence.

## Share results through GitHub

Copy the [results template](templates/MAC_SMOKE_RESULTS_TEMPLATE.md) into a dated document under `docs/`, or attach a sanitized report to a review PR. Include the tested source SHA and DMG SHA-256, hardware/OS, exact commands, pass/fail/blocked results, evidence locations and reproducible findings. Do not include API keys, personal usernames in screenshots, real databases or real uploaded PDFs.

Corrections belong on scoped branches from current main, with focused local tests before a final full matrix. The Mac agent leaves changes uncommitted for independent review unless the user explicitly assigns Git coordination. Codex owns final reviewed commit/push/PR and required CI; never self-approve a repair. A documentation-only handoff uses the existing lightweight CI path, not a new Mac workflow run.

Release holds remain unchanged. No source evaluation or successful current-Mac smoke test can certify an unavailable macOS 12 installation or the separate iOS target.
