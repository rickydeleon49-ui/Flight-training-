# Claude Mac continuation — prepare installed readiness and signing

Continue Her Flight Deck on this Mac in `/Users/rickymac/code/Flight-training-`. Implement a bounded read-only readiness tool and complete the isolated installed-test/signing runbook. The main user will use the Mac; this package should make the remaining owner actions concrete and the eventual installation checks reproducible.

Claude implements and validates this assignment. Codex independently reviews and handles commit/push/PR/CI/merge. Leave changes uncommitted and unpushed. Finish the useful package even if credentials or the test account remain unavailable.

## Start from the accepted publication

Begin after the A2 preparation acceptance publication merges with passing required checks. Record branch, HEAD, upstream and dirty files. Update a clean main by fast-forward only and create `codex/mac-installed-readiness-preparation`. Inspect any existing branch before reuse. Preserve other work; do not switch or reset a dirty checkout.

Read:

- `STATUS.md` and `docs/PROJECT_HANDOFF.md`.
- `docs/MAC_A2_VERIFICATION_PREPARATION_ACCEPTANCE_2026-10-03.md`.
- `docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md`, especially its owner handoff and source gate.
- `docs/MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md`.
- `docs/MAC_PARITY_CHECKLIST.md`, including the Exact-Installer Invariant.
- `docs/MAC_SMOKE_RESULTS_2026-10-02.md` and source-evaluation receipts.
- `docs/MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md`.
- `src-tauri/tauri.conf.json`, the Tauri capabilities, relevant startup/data-path code, `package.json`, and build/release workflows.
- The adopted development/review workflow and repository instructions.

A1/A3/A4/A6 and the accepted baseline are merged; A5 source-tooling evidence and A2 verification preparation are accepted. A2 production source is still with its Windows owner. Do not take over those corrections or infer installed readiness from prepared tests.

## 1. Audit the current readiness boundaries

Build a short matrix linking each prerequisite to an actual source/configuration reference and observed evidence.

Cover the bundle identifier, minimum OS, app version, executable architecture, current host/toolchain, explicit compatible SDK, build lanes, signer/notarization configuration and installed-test isolation.

Inspect what the repository currently configures; do not infer missing GitHub secrets merely because a workflow omits their references, or infer available credentials from documentation. Distinguish configured, observed, unavailable and unverified.

Recheck actual OS/toolchain identity. Earlier documents recorded 26.6 and later 27.0.1 without a proven upgrade history. Preserve those observations and record today's values.

Keep the frozen private v0.5.3 candidate separate from local source-evaluation builds. Record both known identities and explain which checks each can support. Do not replace, sign, rebuild or retag either artifact in this task.

## 2. Implement a small read-only preflight

Add `scripts/mac-readiness-preflight.mjs` and a usage reference. Prefer existing Node APIs and commands; add no package dependency.

Default behavior must be bounded and read-only:

- Inspect public repository configuration and version agreement.
- Report current source SHA and working-tree cleanliness without exposing arbitrary file contents.
- Identify OS, process/tool architectures, required command availability and the explicit SDK path.
- Record signing/notarization configuration separately from an actual artifact assessment.
- Report missing test-account confirmation and installed results as unmet/unverified.
- Produce concise human-readable output and an optional structured JSON receipt with a documented schema.

Use explicit opt-in arguments for artifact inspection. Do not search private folders or scan the owner's profile. Hash only the artifact path explicitly supplied. Support the relevant identity, byte-size, bundle metadata and read-only signing/assessment checks only where the necessary path/tool exists.

Do not automatically mount a DMG, install or launch an app, invoke a build, change a keychain, submit notarization, alter accounts, trigger GitHub Actions, or contact a provider. If inspecting an app inside a DMG needs a mount, leave the explicit read-only mount recipe in the runbook for a separately authorized execution.

Statuses must distinguish PASS, FAIL, UNVERIFIED and USER_ACTION. Missing tools or unsupported platforms must produce a truthful bounded result. Document exit codes: a successfully generated report is not proof the app is ready.

Do not accept a CLI flag alone as proof of an isolated test account or synthetic profile. Keep the actual isolation evidence requirement explicit. A preflight must never mark installed smoke checks passed without recorded execution.

Bound subprocess execution time and output. Parse an allowlist of fields; do not dump environment variables, certificates, account names, command stderr or secrets into the receipt. If a command is unavailable, permission-denied or times out, report that condition without requesting changes to the owner's system.

## 3. Validate behavior and privacy

Use meaningful synthetic controls for the new tool:

- Missing/malformed config or artifact path.
- Version or bundle-identity mismatch.
- Unsupported OS, missing command and timeout.
- Successful metadata observation with installed checks still UNVERIFIED.
- Missing account/signing prerequisites.
- Explicit artifact hash/size mismatch.
- Child-command output containing synthetic secret/private-path sentinels, proving public receipts exclude them.
- Confirmation that default execution does not install, launch, mount, build, alter accounts/keychains, or inspect an app profile.

Use task-owned fixtures and an injected test runner or existing test seam; avoid production mutable globals. Keep tests focused on observable outcomes rather than mirroring implementation branches.

Run the relevant focused checks and documentation/path/diff validation. This tooling-only task does not require repeating unchanged Rust/application matrices. If you discover a production change is necessary, report the precise finding and a scoped correction request; do not silently broaden this task.

Run the preflight on this Mac in its default read-only mode and save a sanitized receipt. Separate synthetic control results from actual host observations.

## 4. Write the signing decision package

Inspect the current primary documentation, recording access date and links:

- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).
- [Apple Developer ID](https://developer.apple.com/developer-id/).
- [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Prepare the recommended reviewed path for distributing outside the Mac App Store using Developer ID signing and notarization, and map its prerequisites onto the actual project configuration. Tauri and Apple describe those mechanisms in the linked documentation; verify the exact current settings rather than copying a generic workflow wholesale.

List the owner information needed, account/certificate responsibilities, local versus CI choices, intended secret names and secure provisioning location. Never ask the owner to paste passwords, certificate/private-key material or tokens into chat or Git.

Provide a concrete implementation plan/diff sketch for later approval, including verification and cleanup, but do not change signing/build/release workflows or provision credentials now. Do not propose removing quarantine or disabling Gatekeeper.

Explain that signing/stapling changes artifact bytes. A future signed candidate needs its own approved identity and exact-byte installed testing; it cannot silently replace or inherit approval from the frozen artifact.

## 5. Prepare the isolated installed-test runbook

Write `docs/MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md`.

Include a plain-language owner checklist for providing a dedicated standard synthetic test account. Do not create it. Explain how the later tester will confirm account isolation, empty synthetic app data and the intended app-support path without touching the owner's profile.

Organize the later smoke run into small phases with explicit prerequisites, expected results and evidence fields:

1. Artifact identity, normal installation/first launch, signing assessment, version, resizing, dialogs, keyboard and focus.
2. Synthetic PDF import, original relocation, app-owned survival, default-viewer Open, Finder Reveal and Settings folder agreement.
3. Metadata/tag create/edit/replace/clear, rejected save, retry and Cancel with old/new file conservation; mark A2-dependent checks pending matching source.
4. Automatic/manual splitting using accepted fixture identities, page order/coverage, actual limits, original hashes, cleanup, responsiveness and memory.
5. Concurrent save/split/backup, finalized archive integrity and credential exclusion.
6. Valid/damaged synthetic restore, restart recovery and separately identified upgrade artifacts.
7. Saved guides/cards/tests offline and without generation configured.
8. Current WKWebView/VoiceOver and separate early-macOS-12 coverage.

Reuse existing fixture specifications and checklist IDs. Do not generate another heavy PDF set or repeat A5 source measurements.

For each phase provide: tested source/artifact identity, action, expected state, captured evidence, safe stopping condition and cleanup. Make cleanup task-owned and reviewable; do not delete ambiguous app data.

Include a blank receipt template. Do not prefill outcomes as passed. Live Gemini remains optional and separately authorized; exclude it from the default run.

## 6. Finish the package

Save concise sanitized evidence under `docs/evidence/mac-installed-readiness-preparation-2026-10-03/`. Update current STATUS/handoff links with completed preparation and remaining owner actions. Change checklist outcomes only for checks actually observed.

Keep macOS 12/Windows support, versions, bundle identity, migrations, backups, release holds and frozen candidate unchanged. No open-source package adoption, M2 implementation, viewer/import feature or Windows-owner message belongs to this assignment.

Final handoff must include:

- Branch, base SHA and exact dirty-file list.
- Tool behavior and meaningful control results, commands, counts and exit codes.
- Actual host observations and their limits.
- File hashes and evidence paths.
- The signing proposal and exact owner actions still needed.
- Confirmation that nothing was committed, pushed, installed, launched, signed, notarized, tagged or released.

Stop for Codex review after delivering the tool and runbook. Missing account/credentials do not justify leaving the preparation incomplete or repeatedly checking unchanged prerequisites.
