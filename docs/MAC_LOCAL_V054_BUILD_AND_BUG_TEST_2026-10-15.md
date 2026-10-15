# Local v0.5.4 Mac build and bug testing — 15 October 2026

**Local app built and browser checks complete. Two tooling follow-ups remain; no application bug reproduced in the exercised browser flows.** This is a provisional local test artifact, not public-release acceptance. The owner explicitly kept desktop launch and hfdtest deferred and requested automated/browser testing.

## Source and scope

- Accepted functional source: `f2a7090190c74fdc3779785ae3684049d16b2a0e` (PR #166).
- Clean build commit: `fee78699dde736b016747c6a2ec3513a9677a556`, branch `codex/local-v054-build-check`. Exactly five version files changed, six version occurrences, using `scripts/bump-version.mjs`. All dependency identities, migrations, bundle ID and application logic are unchanged. Version configuration is prepared on this branch for review; primary/main was not changed.
- Local Mac: Apple Silicon arm64, macOS 27.0.1 (26A434), Xcode 27.0. Node 22.23.3 / npm 10.9.9; scoped SDKROOT `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`, four Cargo workers. Mach-O records minimum macOS 12.0 and SDK 26.5.
- Authorization: current request allowed a local build and automated/browser tests. The owner explicitly selected **keep desktop launch deferred**. No app launch/install, hfdtest, everyday app-data/profile access, provider call, permission/security-policy change, notarization or public release occurred. The browser uses fresh temporary contexts with synthetic records only.

## Local artifacts

Directory: `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-fee7869/`.

| Artifact | Identity |
| --- | --- |
| `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.dmg` | 5,088,193 bytes; SHA256 `739727b3cb6483edb511c52f9091aed7e1c3192f2bc9cac7dcfc07aa80c604d4` |
| `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.app.zip` | 4,829,464 bytes; SHA256 `348a1b7a1329f1d904a233a3712ecba714283a5f328bdf1682a2720ffd42b82b` |
| Final app executable | SHA256 `33743263ab6c1bb3ef7db0b882808c8da0656c216530b8c27b985f49da4d6e02` |
| Raw build executable before local resource sealing | SHA256 `0eb41b81786257083f9a72e3839a8677422df07f773f4ba7928c550e6777ec5c` |

The staged app is **locally ad-hoc signed**, with no Developer ID, secure timestamp or notarization. `codesign --verify --deep --strict` passed on both the staged app and the read-only mounted image’s app. The mounted image recorded version 0.5.4 and bundle ID `com.herflightdeck.app`; its executable hash matched. Detach exited 0; no task image mounts or preview servers remained. Nothing was copied to `/Applications` or a profile. No Gatekeeper bypass was used or suggested. Artifacts stay local and are not committed/uploaded to GitHub.

### Build and packaging distinction

`npm run tauri -- build --target aarch64-apple-darwin --bundles app,dmg --no-sign --ci` compiled the release executable in 96 seconds and produced the app bundle. Its **automatic DMG phase stalled** in `hdiutil create` and the overall command exited 1 after the task-owned image processes were stopped (447 seconds total). That failure is retained, not called a successful CLI run.

The generated `--no-sign` app had only the linker's ad-hoc signature; strict bundle verification reported `code has no resources but signature indicates they must be present`. The approved local ad-hoc lane was completed on a **separate staged copy**, using `codesign --force --sign - --timestamp=none --identifier com.herflightdeck.app`. This seals local resources without a private key/Developer ID and explains the executable-hash change above. The raw build remains intact.

Empty APFS and HFS+ controls both succeeded in about 3 seconds. A separate bounded 64MB HFS+ image of the staged ad-hoc app, compressed as UDZO, succeeded in 5 seconds. This packaging-only fallback reused the compiled app, verified its contents read-only and cleaned up. The initial stall’s cause is **unconfirmed**; this is not evidence of a general HFS+ or macOS defect. The initial invalid control command, corrected controls, process cleanup, commands/exits and all original failures are preserved in the evidence. No compiler rerun or source workaround was used to obtain the image.

## Verification results

| Check | Actual result |
| --- | --- |
| Release safety + migration suites before build | 143 passed, 1 deliberately skipped |
| Built frontend route scan | 12/12 routes rendered, no browser errors |
| Browser functional scenarios | 13/13 passed; 0 browser exceptions, HTTP errors or external requests |
| Full frontend suite (`npm test -- --maxWorkers=2`) | 3,202 passed, 6 skipped; exit 0 |
| Native macOS Rust suite | 465 passed, 6 ignored; exit 0 |
| Rust fmt, Clippy `-D warnings`, Cargo lock, whitespace | exit 0 |
| Schema14 helper suite after ARM64 build | **22 passed, 1 failed, 0 skipped; exit 1 — QA-01** |
| Current-version helper replay procedure | **exit 1 before worktree creation — QA-02** |
| Staged/mounted ad-hoc app verification and image cleanup | pass; detach 0 |

Frontend type checking and bundling passed as Tauri’s before-build command; no redundant frontend rebuild was run. Full frontend tests used two workers to avoid unrelated machine-load timing failures. No test was skipped, timeout extended or expectation weakened to get a green result. Native/browser source results do not certify the installed app.

Browser scenarios exercised: profile save/reload with optional school/instructor left blank; note create/edit/pin/reload; delete cancellation and undo; question/answer save/reload; fund contribution; zero-expense rejection and valid balance calculation; lesson estimate persistence; quick debrief without inventing flight time; independent Skills status/confidence persistence; custom-skill create/rename/retire/restore; 1024×700 overflow checks; fresh-context storage isolation; error/network monitoring. Source skill: `.claude/skills/run/SKILL.md`. The preview served the actual compiled `dist/` frontend, not an alternate mocked UI. Native-only file/provider features were not exercised through the browser.

Two earlier browser-harness runs were retained (8/13, then 12/13). Their failures were traced to wrong DOM assumptions, ambiguous Close buttons, a legitimate Training reminders dialog, and reloading before acknowledged state was visible. The final harness uses observed editor/row selectors, closes the normal reminder through its footer, and waits for save acknowledgements. No production app code changed. These harness failures are not reported as application defects.

## Confirmed findings and precise follow-up

### QA-01 — verification helper rejects real target-specific Cargo output (P2 tooling)

**Source:** `scripts/mac-schema14-verification-proof.mjs:100,214–239`; failing permanent test `scripts/mac-schema14-profile-snapshot.test.mjs:139`.

**Trigger:** run the legitimate native build with `--target aarch64-apple-darwin`, then `node --test scripts/mac-schema14-profile-snapshot.test.mjs`.

**Observed:** `recognizes only the two exact build-output paths, and this checkout's real ones when present` fails with `src-tauri/target: unexpected top-level entries: aarch64-apple-darwin`. The real directory contains `CACHEDIR.TAG` and `release/`. The recognizer currently permits only host-level debug/release/tmp and known metadata. This is a build-tool classification defect, not a detected change to protected source or an application runtime failure. Linux CI without that target folder does not reproduce it.

**Required fix:** narrowly recognize the canonical Apple Silicon target directory and its genuine Cargo shape. Add permanent disposable positive/negative cases before changing the recognizer: valid target output accepted; symlinked/hard-linked metadata, missing/invalid tag, unexpected source beside the target profiles, unknown target names and tracked files anywhere under build output refused. Preserve index/worktree tracked-file checks, migration/fixture hashes, literal ignore rules and existing source-walker sensitivity. Do not broadly ignore target directories, delete/move actual build output to hide this failure, remove the assertion, or change HEAD/pins/allowlist. No app rebuild is needed for this helper-only fix.

### QA-02 — replay recipe refuses a version-only lockfile change (P2 tooling usability)

**Source:** canonical `docs/evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md:124`.

**Trigger:** run its exact reproduction with `HFD_SCHEMA14_SOURCE_COMMIT=fee78699dde736b016747c6a2ec3513a9677a556`.

**Observed:** the raw `package-lock.json` byte-equality assertion against baseline16f9cf3 fails. Removing only top-level `version` and `packages[""].version` in memory yields identical lock content. No dependency identity changed. The previously recorded replay of exact accepted helper commit `f2a7090…` still works; this is not a loss of that acceptance.

**Required disposition:** keep the immutable baseline and schema pins. Either explicitly restrict/pin the recipe to its accepted helper-source identity and clearly document that later versioned commits are not supported, or add a narrowly reviewed normalization that allows only the two synchronized application-version fields while retaining the baseline lock on disk. If allowing metadata-only drift, require a positive version-only case and negative direct/transitive dependency, integrity/resolution, and inconsistent-root-version cases that refuse before copying. Never remove the HEAD/index/source protections, ignore arbitrary lock changes, or imply this component replay certifies the whole new app source. Keep the original failure receipt.

### Packaging observation — automatic DMG phase stalled

The normal Tauri image phase stalled once; bounded empty controls and the packaging-only 64MB image succeeded. Root cause is not established. Preserve the failure and investigate reproducibility before promoting a permanent pipeline change. Do not call the overall original build command green, assume a known OS bug, modify the public signing workflow, or rebuild the executable merely to repeat packaging. The local handoff image has its own exact identity and verification receipt above.

## Reviewer handoff and next step

[One focused model-neutral follow-up](MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md). Review the five version changes and evidence; resolve QA-01 and disposition QA-02 before claiming the verification lane is all green. The local version branch and provisional artifact are not a public release. No merge or release tag is authorized by this report alone; use the normal independent review and exact-head CI workflow if integrating.

The older schema14 manifests/receipts remain snapshots of their accepted commits, not perpetual hashes of mutable STATUS/handoff files. This evidence pack inventories the new submission separately. Physical launch, standard-account behavior, native pickers/PDF workflow, installed upgrade/restore, Gatekeeper, VoiceOver and public signing acceptance remain **UNVERIFIED/deferred**. The owner asked to keep desktop launch deferred. The primary checkout, frozen v0.5.3 installer and all existing account/profile permissions remain untouched.
