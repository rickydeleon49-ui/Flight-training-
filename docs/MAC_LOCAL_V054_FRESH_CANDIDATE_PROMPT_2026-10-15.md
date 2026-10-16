# Fresh local v0.5.4 candidate — model-neutral continuation

## Outcome

Produce one fresh private Apple Silicon v0.5.4 test candidate from the accepted current main, including PR #169's historical flight-time warnings and safe medical-date reconciliation and PR #167's verification-tool fixes. The owner has already selected v0.5.4 and authorized the local unsigned/ad-hoc lane. Do not ask for version/signing choices again. Desktop launch and hfdtest remain explicitly deferred.

Read current main's top ROADMAP.md, STATUS.md and docs/PROJECT_HANDOFF.md, then docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md. Read docs/MAC_LOCAL_V054_QA_ACCEPTANCE_2026-10-15.md, docs/MAC_LOCAL_V054_BUILD_AND_BUG_TEST_2026-10-15.md and its package identity/packaging receipts before building. The prior installer from fee7869 predates PR169; preserve it and its exact hashes without relabelling it.

## Start and source freeze

Reuse /Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training- if it is available, clean and unowned. Fetch and inspect, without pulling/resetting/stashing a dirty checkout. Confirm PR167 and PR169 are merged and current main contains their accepted source. Check for a competing candidate build before starting. Stop and report a prerequisite mismatch instead of duplicating active work.

Freeze and record the full accepted source SHA before any build. Verify all five version files agree on 0.5.4; no dependency identity, application logic, migration/checksum, bundle ID or backup-contract change is part of this assignment. Start a new codex/ branch for reports only if needed. Never modify production code to get a passing candidate; report an actual defect with reproduction evidence and preserve failed outputs for independent review.

## Build and package once

- Use scoped Node22 and Cargo paths, SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk, and a modest Cargo worker limit as recorded in the accepted report. Verify installed paths/versions first. Do not change global Xcode settings or profile permissions.
- Build one aarch64-apple-darwin release app through the existing Tauri command. Record exact argv, runtime/environment, exit status and raw stdout/stderr. Do not mix source/checkpoint identities.
- The previous automatic DMG stage stalled once; its cause is unknown. If repeated, preserve it and stop only verified task-owned processes. Do not blindly repeat the native compilation or terminate system daemons. Use the already recorded bounded packaging-only local lane only after reviewing its exact commands and applying a timeout/cleanup plan. If that lane cannot be executed safely, report a blocked packaging result; do not improvise a public signing-workflow change.
- The allowed signature is local ad-hoc only, without credentials. If the no-sign app needs resource sealing, work on a separate staging copy and record both raw/final executable identities. No Developer ID, notarization or Gatekeeper claim.
- Keep app/ZIP/DMG outside Git in a new candidate directory that includes the source SHA and date. Never overwrite the earlier candidate or frozen v0.5.3. Label the artifact LOCAL_ADHOC or its actual unsigned status, private test only.

## Verification within the authorized lane

Verify package version, bundle identifier, arm64 architecture, executable and installer hashes, ad-hoc signature/resource verification, and contents of a read-only/nobrowse mounted image. Use a finally/trap cleanup and prove the task image detached even on failure. Do not install or launch the app.

Reuse already valid checks on the identical accepted source. Where new execution is needed, run one sequential relevant gate rather than overlapping matrices. Confirm the real ARM64 output passes node --test scripts/mac-schema14-profile-snapshot.test.mjs (26 current helper tests), version/lock checks and the documented source-component replay if needed. Preserve the distinction between a helper replay on pinned baseline16f9cf3 and current-application verification.

Browser QA may serve the built frontend on loopback with fresh disposable contexts and synthetic data only. Read the repository run skill before using its browser workflow. Preserve screenshots/console/HTTP results. Reuse the earlier functional harness only by copying it outside source with fresh output paths and ports; do not overwrite accepted evidence. Check the changed medical flow in both authority directions, no writes before a choice, pending/retry behavior where testable, and the established notes/schedule/finances/Skills flows. Existing automated historical-flight tests cover impossible entries; do not weaken production form validation to seed them.

No native app/profile launch, installation, hfdtest, everyday account/data, provider calls, permission/security-policy changes, public release/tag, Apple signing or notarization. Browser/native source checks cannot close installed acceptance.

## Delivery and stop

Hand back a Markdown report and reviewer handoff with the exact frozen source identity, artifact locations, full hashes, actual signature status, commands/exits/counts, relevant synthetic screenshots, and cleanup facts. Preserve original failures and distinguish corrected final outcomes. List unexecuted physical/Gatekeeper/VoiceOver/upgrade/restore gates as UNVERIFIED/deferred; old schema12→13 installed results do not certify this schema14 candidate.

Update current ROADMAP/STATUS/handoff while retaining history. Finalize separate current evidence inventories last; do not rewrite historical build or implementation manifests as if they described new executions. Leave reports/evidence uncommitted and unpushed for senior review. Do not upload binary artifacts, publish or merge. Stop after providing the exact local candidate path and reviewer entry point.
