# Physical Mac source evaluation — 2 October 2026

Observed source checks on the physical Mac. Installed-app evidence remains pending. Source evaluation is distinct from the frozen private v0.5.3 candidate.

## Identity

- Date / tester: 2 October 2026 / Codex on the physical Mac
- Mac model / Apple Silicon chip / RAM: MacBook Air (Mac17,3), Apple M5, 10 cores (4 performance / 6 efficiency), 32 GB
- macOS version and build: 26.6 (25G72)
- Terminal / Node / Rust architectures: arm64 / arm64 / aarch64-apple-darwin
- Developer tools / SDK: `/Library/Developer/CommandLineTools`; Apple clang 21.0.0 (clang-2100.1.1.101). Default SDK 27.0 fails linking; explicit SDK 26.5 passes the focused probe and Clippy.
- Node / npm / Rust versions: Node 22.23.3, npm 10.9.9, rustc 1.99.0 (b940084d7), cargo 1.99.0. Node 26 remains the global default; checks use a scoped PATH.
- Source branch / exact commit / clean or dirty: `main`, `5e388bf4169c7f968b1581292d6e1a24aa0493da`, initially clean. `git ls-remote origin refs/heads/main` independently matched. The tested source was clean; the later report/tracker changes are documentation only.
- Artifact lane: local source evaluation; no frozen candidate assets tested
- DMG filename / exact byte size / SHA-256: `Her Flight Deck_0.5.3_aarch64.dmg`; 4,525,420 bytes; `e50975dce2db564a3623209c8e73f124fbc0c0ebc6010e7df5cf7c435a05eb37`
- Bundle identifier / executable architecture / minimum OS: packaged app inspected read-only inside finished DMG: `com.herflightdeck.app`, Mach-O arm64, `LSMinimumSystemVersion=12.0`, version 0.5.3
- Signing / notarization assessment: ad hoc linker signature, no TeamIdentifier, no sealed resources; Gatekeeper assessment exits 1; stapler exits 65 (no stapled ticket). Installed first-launch dialog remains UNVERIFIED.
- Dedicated test user and profile isolation confirmed (no personal username needed): BLOCKED; user confirmed no dedicated test account yet. No app launch or app-profile modification performed.

## Automated checks

[Selected sanitized verification receipts](evidence/mac-source-evaluation-2026-10-02/VERIFICATION_RECEIPT.md) are now shared in GitHub for other agents. These are original observed log excerpts, not a new matrix run; protected full logs remain local.

| Command | Exit code / counts | Local log location (not uploaded) |
| --- | --- | --- |
| npm ci | 0; 165 packages installed; audit reports 0 vulnerabilities | `.smoke/mac-2026-10-02/npm-ci-network.log` |
| npm test | 0; 594 passed, 4 skipped; 59 files passed, 3 skipped; 6.59 s | `.smoke/mac-2026-10-02/npm-test.log` |
| npm run build | 0; TypeScript and Vite passed | `.smoke/mac-2026-10-02/npm-build.log` |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | 0 with rustup bin on PATH | `.smoke/mac-2026-10-02/cargo-fmt-path.log` |
| cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings | 0 with SDKROOT set to installed macOS 26.5 SDK; 23.53 s | `.smoke/mac-2026-10-02/cargo-clippy-sdk26.log` |
| cargo test --locked --manifest-path src-tauri/Cargo.toml | 0; 246 passed, 6 ignored; 22.02 s test execution; binary/doc tests passed | `.smoke/mac-2026-10-02/cargo-test.log` |
| npm run test:cargo-lock | 0 with combined Node/Rust PATH and SDK 26.5 | `.smoke/mac-2026-10-02/cargo-lock-path.log` |
| git diff --check | 0 | `.smoke/mac-2026-10-02/git-diff-check.log` |
| Apple Silicon DMG build | 0 with combined PATH and SDK 26.5; release compilation 1m 29s; Finder packaging step delayed completion | `.smoke/mac-2026-10-02/tauri-build.log` |

## Observed smoke tests

| Check | PASS / FAIL / BLOCKED / UNVERIFIED | Evidence / timing / fixture identity |
| --- | --- | --- |
| Normal install and first launch; Gatekeeper dialog | UNVERIFIED | |
| Window/dialog/keyboard behavior | UNVERIFIED | |
| PDF import; original relocated; owned copy survives | UNVERIFIED | |
| PDF Open in default viewer | UNVERIFIED | |
| Document Reveal and Settings Open folder | UNVERIFIED | |
| Material/tag create/edit/replace/retry/Cancel | UNVERIFIED | |
| Automatic 1,050-page split; ordered coverage and limits | UNVERIFIED | |
| Automatic image-heavy split; coverage and limits | UNVERIFIED | |
| Manual valid/invalid ranges; rollback/cleanup | UNVERIFIED | |
| Concurrent autosave/split/backup; retry bounds | UNVERIFIED | |
| Backup to Downloads; finalized file and integrity | UNVERIFIED | |
| Backup credential-entry inspection | UNVERIFIED | |
| Restore; conserved records and document hashes | UNVERIFIED | |
| Corrupted archive refusal / original recovery | UNVERIFIED | |
| Offline saved guide/flashcard/practice-test visibility | UNVERIFIED | |
| Optional live Gemini with synthetic selected PDF | UNVERIFIED | |
| Upgrade over identified synthetic prior dataset | UNVERIFIED | |
| Symlink and case-insensitive volume behavior | UNVERIFIED | |
| Case-sensitive volume behavior | UNVERIFIED | |
| Early macOS 12 behavior | UNVERIFIED | |

## Findings and follow-up

Confirmed findings and bounded recommendations are recorded below. A successful current-Mac source check does not certify an unavailable OS, installed-app behavior, or a different DMG.

## Invocation and setup evidence

All logs are local ignored evidence; raw logs contain local absolute paths and must be sanitized before sharing. No secrets, real PDFs or app databases were used. Homebrew installed Node 22 and rustup; rustup installed stable with rustfmt/clippy. No shell configuration edits were made.

Frontend commands use `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Native commands use `PATH=/opt/homebrew/opt/rustup/bin:$PATH` and, after the linker diagnosis, `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.

Initial `npm ci` inside the restricted environment was interrupted (130) without a completed log; network-enabled retry passed. Initial absolute-path Cargo formatting could not find its `fmt` subcommand (101); scoped PATH corrected it. Initial Clippy encountered sandbox DNS errors (101), followed by a network-enabled run that failed compilation (101) with the default SDK. Only that failed native step was retried after diagnosis.

### Confirmed developer-tool failure

The default SDK resolves to macOS 27.0. Rust build-script linking fails before application compilation with `tapi error: malformed file`, `unknown architecture`, and `arm64e.x1-macos, arm64e.x1-maccatalyst` in `libSystem.B.tbd`. The installed linker reports TAPI 21.0.0 and ld-1267. A minimal `fn main() {}` Rust probe compiles with explicit installed SDK 26.5. Strict application Clippy then passes with that same SDK.

Recommendation: use the compatible existing SDK explicitly for this source evaluation; align the Command Line Tools and default SDK before relying on default developer commands. No app-source workaround or OS update is needed for this observed failure. This does not establish macOS 12 runtime support. Failure evidence: `.smoke/mac-2026-10-02/cargo-clippy-network.log`.

## Synthetic fixtures

Generated with `node scripts/generate-pdf-fixtures.mjs /private/tmp/hfd-mac-fixtures-2026-10-02-5e388bf` (exit 0). All three byte sizes and hashes match the tracked checklist:

| Fixture | Bytes | SHA-256 |
| --- | --- | --- |
| Small checklist | 3,360 | `f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134` |
| Long manual | 330,934 | `0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1` |
| Illustrated charts | 54,032,644 | `b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d` |

Generator identities are verified; native viewer rendering and installed split behavior remain UNVERIFIED. Fixtures remain outside Git.

## Remaining gates

Dedicated standard test account is required by the handoff before installed-app smoke tests. macOS 12, case-sensitive-volume coverage, live Gemini and populated-data upgrade remain UNVERIFIED. Known A2 Windows-local fixes are absent from this tested main. A3–A6 and release holds remain unchanged. No application-source changes, tag/version changes, draft-asset replacement or release publication performed. The owner subsequently authorized publishing this documentation for independent agent review.

Native test counts are host-specific; Windows-only cases are not Mac evidence. Initial lock check omitted the Rust PATH and exited 1; combined PATH corrected it. The native suite includes restore, document, PDF and Unix symlink regressions.

Temporary filesystem probe on /private/tmp: case-insensitive lookup=True; symlink metadata detected=True. No disk formatting or app profile access. This probe is not installed-app evidence.

## Completed evaluation artifact and security finding

Local artifact path: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Her Flight Deck_0.5.3_aarch64.dmg`. `stat -f '%z'` and `shasum -a 256` establish the identity above. `hdiutil verify` exits 0 (internal checksum VALID). The exact image was mounted read-only with `hdiutil attach -readonly -nobrowse -noautoopen`, inspected without installation/launch, then detached successfully. Tauri removes the intermediate app bundle after successful DMG packaging.

`file`, `plutil -p`, and `codesign -dv --verbose=4` inspected the packaged app. `spctl --assess --type execute --verbose=4` exits 1 with `code has no resources but signature indicates they must be present`. `xcrun stapler validate` exits 65 with `does not have a ticket stapled to it`. Codesign reports `Signature=adhoc`, `Info.plist=not bound`, `TeamIdentifier=not set`, and `Sealed Resources=none`. Logs: `.smoke/mac-2026-10-02/spctl-dmg.log`, `.smoke/mac-2026-10-02/stapler-dmg.log`. This is an observed command-line assessment failure, not an observed installed launch refusal. Absence of a stapled ticket alone does not establish all possible server-side notarization state.

Recommendation: retain this local source evaluation identity; before a distributable candidate, use the established Developer ID signing/notarization process and verify the sealed bundle and exact DMG. Do not bypass Gatekeeper or alter this checksum to claim a pass. No signing credentials were requested or used.

The completed matrix and fixtures establish source/packaging evidence only. Automated passing counts: backup 127, documents 44, PDF 20 (5 ignored), secrets 10. Unix linked-pending-root rejection passed. A temporary filesystem probe found case-insensitive lookup and detectable symlink metadata. Case-sensitive volume and installed filesystem behavior remain UNVERIFIED.
