# Local v0.5.4 QA follow-up — model-neutral task

Read `docs/MAC_LOCAL_V054_BUILD_AND_BUG_TEST_2026-10-15.md` and its evidence first. The owner requested a local Mac build and automated/browser bug testing while explicitly keeping desktop/hfdtest launch deferred. This assignment is the tooling follow-up, not another feature milestone or a physical test request.

## Starting point

- Checkout: `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`.
- Branch: `codex/local-v054-build-check`; clean artifact source `fee78699dde736b016747c6a2ec3513a9677a556`, accepted functional parent `f2a7090…`.
- Version-only source changes synchronize 0.5.4 in five files; dependencies, migrations and app logic unchanged. New report/evidence/tracker files follow that build checkpoint and do not change the frozen binary's source identity.
- Native executable and local ad-hoc DMG/ZIP exist outside Git; source/application tests pass, but the helper lane is 22/23 after genuine ARM64 target output appears.

Fetch and inspect actual branch/dirty state before editing. Do not pull/reset/stash/overwrite the primary or another agent's work. Verify the submitted hashes. Preserve the native artifacts, every failed receipt, historical schema13 ceiling alarm, schema contract8a260c0, baseline16f9cf3 and its protected-tree digest, three exact restore-only exclusions, tracked-file/migration/fixture/link guards. No dependency adoption, provider call, app rebuild/launch/install, hfdtest/profile access, signing credentials, public release or security-policy changes are needed.

## QA-01: fix only recognized Cargo infrastructure

Reproduce the retained failure with `node --test scripts/mac-schema14-profile-snapshot.test.mjs` on the real build tree. It is the `aarch64-apple-darwin` folder under `src-tauri/target`, not an altered source file.

Add meaningful permanent tests in the existing helper test file before editing recognition. A disposable, correctly tagged `target/aarch64-apple-darwin/release` tree must be accepted. Unknown target names and unexpected files at the target-root level must remain refused. Cover a symlinked target/profile, missing/invalid/symlinked/hard-linked cache tag, and a tracked path inside any build output. Retain all original 11 walker sensitivity scenarios and tracked bytes/modes/deletions checks.

Recognize only the supported canonical target shape with the same strict ignore/tag/metadata protections. Do not add arbitrary directory globs, make the live test optional, move/delete build output to get green, edit proof pins/HEAD gate/allowlist, or weaken any source/data guard. The production application and native binary stay untouched.

## QA-02: disposition the strict version lock comparison

Reproduce the exact RUNBOOK failure on `fee78699…` and confirm only root application-version fields differ from baseline; archived failure is in `versioned-proof-replay.json`. Choose and explain a bounded policy: pin/document the accepted helper commit explicitly, or permit only two synchronized app-version metadata differences in an in-memory dependency-lock comparison, leaving baseline dependencies/files unchanged in the detached replay.

If permitting the latter, test that version-only drift works while direct/transitive package, integrity/resolution, and inconsistent root version changes refuse before worktree/copy work. Keep the exact protected baseline and immutable schema contract; this remains a helper-component replay, never a current-app certification. The final 12-stage proof must exercise the newly submitted QA-01 helper/runner bytes; do not replay only the old f2a7090 package and claim that validates the fix. Preserve the prior failure and rerun the literal documented procedure on a check-only commit.

## Verification and delivery

Use scoped Node22/Cargo/SDK26.5 settings. Run focused helper regressions (including real build-output classification and the full-self-check mutation); repeat the detached 12-stage proof and meaningful new sensitivity cases. No unchanged app-wide matrix or native rebuild is needed for scripts/docs-only fixes unless an actual shared-code change requires it. Preserve failures and exact argv/cwd/runtime/stdout/stderr/exits. Show temporary worktree/mount cleanup and source checkout preservation.

The automatic DMG stall is a separately recorded observation; do not invent its cause or start a packaging rewrite. Local manual image/signature/hash verification succeeded and is frozen. Record any reproducible pipeline finding separately.

Finish source/docs and receipts before final source/evidence manifests/checksums. Update current trackers without rewriting acceptance history. Leave one uncommitted, unpushed correction package and a reviewer Markdown handoff, then stop. The independent reviewer owns normal exact-head CI/integration. No physical tests or public release are implied by a green source suite.
