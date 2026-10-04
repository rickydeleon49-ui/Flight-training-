# Claude assignment: prepare the next Mac release for independent review — 4 October 2026

Continue Her Flight Deck on this Mac. The owner wants a release they can install and has now directed: **“review and no testing account ill wait for the release.”** They report **no Apple Developer Program membership**. Do not ask them to create or log into a testing account, and do not start an installed test or development app in their everyday account. This direction changes the next task to release preparation; it does not supply installed-test results, signing credentials or permission to publish.

## Outcome

Prepare concrete, reviewable work toward a current-source Apple Silicon release: establish the actual release blockers, produce build-only package evidence where allowed, and prepare the smallest signing/release workflow change that can be reviewed without secrets. Leave implementations uncommitted and unpushed for Codex. Do not start Slice B, weather/FAA integrations, an AI-provider replacement or unrelated roadmap features.

## Starting state and references

1. Use the agreed checkout `/Users/rickymac/code/Flight-training-pr70-integration`. Confirm its branch, HEAD, origin/main and status before any edit. Codex's containing acceptance PR must be merged and required checks green before you start from its updated main. If the checkout still holds the old uncommitted evidence, do not overwrite it, stash blindly, reset or recreate the repository; report its actual state and let Codex finish reconciliation.
2. Preserve `/Users/rickymac/code/Flight-training-` and all unrelated branches, original ignored logs, fixtures and owner data. Create a fresh `claude/mac-release-preparation-2026-10-04` branch only from the clean synchronized agreed checkout. Reuse existing dependencies and caches where safe.
3. Read current `STATUS.md`, `ROADMAP.md`, this acceptance's `MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md`, `MAC_DEVELOPMENT_TOOLS_SETUP_2026-10-04.md`, `MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md`, `MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md`, `RELEASE_REVIEW_PROCESS.md`, `MAC_READINESS_PREFLIGHT.md`, release-policy JSON and the actual release/build/check workflows. Resolve historical statements using the latest owner decision and acceptance rather than treating old blockers as current source defects.
4. A2 production is accepted and MVER-R1–R3 are closed. The Mac case-alias test was independently exercised on host APFS; source evidence is distinct from an installed-candidate result. M2 real-user check-in remains waived; separate Slice B decisions remain outside this assignment.

## Phase 1: establish the exact candidate and constraints

Inspect GitHub releases and build runs read-only. Record full source SHA, current consistent package/Tauri/Cargo versions, platform policy, existing draft target and asset identities, and exact checksums if assets are inspected. Existing private draft **v0.5.3** is an older frozen artifact: do not replace its assets, reuse its approval, publish it, delete it, retire it or silently change its target. Version **0.5.2 is permanently retired** and Windows distribution remains held on v0.5.1.

Distinguish: source checks passed; package builds observed; signing metadata verified; notarization/stapling observed; normal installed launch observed; remaining minimum-macOS/accessibility/data-retention checks. Never mark one level complete because the preceding level passed. No testing account is available for this task and no installed result should be inferred.

Inspect the repository's signing implementation and owner prerequisites. Verify current Tauri/Apple requirements against official documentation only. Membership, Developer ID certificate provisioning and owner credential entry are owner actions; no enrollment or payment is part of this task. Check supported GitHub environment/approval features through non-secret metadata where possible; report unknown eligibility rather than inventing it. Do not inspect or print secret values, keychain contents or unrelated account details.

## Phase 2: build-only package evidence

A local build that does not launch or install the app can proceed as preparation. Use the scoped Node 22/Rust toolchain and SDK 26.5 precedent; record actual versions and commands. Consult the CLI before choosing build flags. Keep output in the task's build directory and capture real command exits directly outside the checkout; avoid recording a tee process's exit as the build's exit.

If bundling an inspection-only local DMG is permitted by current instructions, build from the exact reviewed source without a version bump, provider calls or signing changes. Label it **local build evidence, not the frozen release candidate and not approved for installation/distribution**. A matching 0.5.3 metadata value does not make it the existing draft's bytes. Otherwise produce the build-only executable/app output supported by the CLI and explain why a DMG was not prepared. Do not dispatch paid CI packaging jobs merely to duplicate an available local build.

Record artifact basename, byte size, full SHA-256, source commit, toolchain/SDK, arm64 architecture, bundle identifier, minimum macOS, actual signature state and command exits. Read-only mount inspection is allowed for a task-owned disk image; detach it afterward. Do not open the app or use an owner application-data directory. Use the existing read-only readiness preflight for actual supported checks, with output outside the checkout. Keep missing signature/notarization/installed results unverified or failed as the tool reports; do not weaken it to turn a build green.

## Phase 3: make the signing work reviewable

Use the accepted readiness design as a starting point, inspecting the real workflow before adapting it. Prepare a concrete minimal workflow patch for the confirmed eligible lane: Apple Silicon only, manual dispatch, main-only source, protected owner review where supported, temporary signing material, cleanup on every outcome, strict signature/identity/runtime/timestamp checks, notarization/stapling checks, stable filenames and exact-byte checksums. Preserve the Windows hold and private-draft/publication separation.

If the signing lane's owner decision or protected environment is not established, save the proposed patch as an explicitly non-active review artifact with a precise application plan. Do not pretend that unknown protections exist, add real credentials, or activate signing with guessed identifiers. Missing credentials must fail closed in the proposal. List secret **names** and where the owner would provision them, never their contents. Do not add signing secrets, enroll in Apple services, alter a keychain, invoke notarization, create/push a tag or publish a release.

If source changes are needed to make the proposal usable, keep them limited to release tooling and test consequential behavior: absent signing prerequisites, platform/main guards, cleanup, exit propagation and separation of private build from publication. No tests that merely duplicate text. Reuse existing safety tests; run focused checks first and the full required matrix once only if implemented changes warrant it. Documentation-only proposals need link/whitespace and relevant existing safety checks rather than repeated application suites.

## Final handoff

Deliver a short release-preparation report and evidence README with direct receipt links and all changed/new file sizes and hashes. Include exact checks/exits, source/artifact identity, resolved work and each remaining blocker with its owner. Mark the old draft and new local output separately. Give the owner one clear description of what must happen before a normal downloadable release can be tested, without asking for a testing account or claiming the release is ready.

Leave changes uncommitted/unpushed, with no app launch, owner-data writes, provider call, security bypass or release publication. Codex performs independent review, integration, required CI and merge; public release needs the exact-artifact gates and owner publication decision. Stop after this release-preparation handoff rather than starting another roadmap task.
