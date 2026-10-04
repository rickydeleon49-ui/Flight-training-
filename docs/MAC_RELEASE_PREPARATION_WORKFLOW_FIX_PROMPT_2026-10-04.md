# Implementation assignment: finish the two Mac signing-workflow corrections — 4 October 2026

Any implementation model selected by the owner may complete this task. Continue the agreed checkout `/Users/rickymac/code/Flight-training-pr70-integration`, historical branch `claude/mac-release-preparation-2026-10-04`, starting HEAD `50568143a4c4aef04e54eba88bfb22f0974cafe4` plus existing local work. Use one active implementer. Confirm current branch/HEAD/status and the frozen handoff inventory before editing; do not reset, stash blindly, merge coordinator tracker changes into the dirty checkout, or rename the working branch merely because its name contains a model.

Read [the independent re-review](MAC_RELEASE_PREPARATION_REREVIEW_2026-10-04.md), [frozen 20-file inventory](evidence/mac-release-preparation-rereview-2026-10-04/submitted-artifact-hashes.json) and [setup/job-guard observations](evidence/mac-release-preparation-rereview-2026-10-04/keychain-and-job-guard-observations.json) from origin/main or the containing review PR. RELPREP-R1 and R3 are accepted. All 24 submitted synthetic cases independently pass; do not redo those repairs or start a full application test matrix. The remaining work is RELPREP-R2a/R2b below.

## 1. Make keychain setup state and cleanup reliable

The proposed setup script currently puts multiline `security list-keychains` output into an ordinary GITHUB_ENV `NAME=value` line. With two entries, the second path is an invalid bare line. It also strips quotes then uses unquoted expansion, splitting paths with spaces, and swallows initial list-query failure. Cleanup assumes the TEMP_KEYCHAIN export succeeded; after invalid export it can silently leave the temporary keychain.

Fix this in the non-active proposal only. Capture the original ordered search list before changing it, fail before modifications if capture fails, and preserve individual path boundaries including spaces. Prefer a task-owned state file and a safe parser/argument array, or properly encoded multiline state with equivalent boundary preservation. Use the documented GITHUB_ENV format for simple outputs; avoid putting arbitrary multiline content into a plain assignment. Do not eval state or treat saved paths as shell code.

Cleanup must be able to locate the known task-owned temporary keychain and saved restoration state after partial setup or environment export failure. Never scan/delete unrelated keychains. Restore the original list accurately, attempt independent cleanup actions even if one fails, and report failures. Handle failed certificate decode/import, setup after temporary-keychain creation, original-state capture failure, build/verification failure, and state-export failure. Preserve the credential masking and file-permission behavior.

Extend the validator to execute the actual proposed setup script with synthetic security/openssl stubs; it currently extracts `setupScript` but never runs it. Model state transfer between steps rather than supplying idealized variables directly to cleanup. Include multiple original entries, a path containing spaces, initial list-query failure, partial setup failure, environment-write/parse failure, successful restoration and cleanup-failure reporting. Assert exact ordered restoration arguments and removal of task-owned materials, not just exit codes.

## 2. Gate the signing job before any secrets are supplied

The shell event/main check currently rejects disallowed events only after a step has received Apple credentials and the job has entered its signing environment. Add an actual workflow control boundary before secret-bearing work, preferably a job-level event/ref condition with only available pre-matrix contexts. The allowed lane is manual `workflow_dispatch` on `refs/heads/main`. A tag push or manual run on another branch must not start that signing job or evaluate a credential-bearing step in it.

Preserve existing exact-current-main/version checks, Windows hold, pinned actions, independent app/container verification, validation-before-upload and the private artifact/draft/publication boundary. Account for the fact that job `if` is evaluated before matrix expansion; avoid a guard that relies on a nonexistent matrix context at that point. If separating jobs is the smallest correct option, keep the Windows lane and its held policy clear. Do not weaken checks or introduce automatic signing/tag releases.

Validate the actual proposed YAML AST/control boundary for manual/main allowed, tag push denied, manual/non-main denied and platform behavior. Check each credential-bearing step is reachable only through the allowed guard. Keep the shell check as defense in depth if useful, but do not describe its late rejection as pre-secret isolation. No GitHub environment, credentials or real signing job should be created or activated.

## 3. Keep the corrected proposal and evidence consistent

Regenerate the patch from the unchanged stated base and corrected complete proposed YAML. Prove `git apply --check` succeeds, apply only to scratch, and compare the applied result byte-for-byte with the YAML the tests actually execute. Parse and validate the resulting workflow. Preserve valid patch context syntax; check applied target whitespace rather than stripping context markers.

Run the expanded focused validator once after corrections; rerun only for actual failures/new edits. Keep existing 24 meaningful cases and add regression coverage for the newly diagnosed behavior. Capture directly measured exits and test counts in publishable receipts. Do not rebuild the DMG, repeat the full frontend/Rust suite, assess/launch/install an app, or rerun preflights to alter historical snapshots.

Update report, results, README and tracker notices with an R2a/R2b issue-to-fix map and honest status pending independent re-review. Preserve R1/R3 acceptance and corrected identities/provenance. Compute full final sizes/hashes for all changed/new deliverables and preserve the ignored originals and DMG checksum. Distinguish proposed/synthetic results from actual installed or signing results.

The owner says “review and no testing account ill wait for the release” and reports no Apple Developer Program membership. Do not request test-account creation/login, use owner app data, enroll/pay, provision credentials, change real keychains, call providers, bump a version, trigger packaging/signing CI, push a tag or publish a release. Keep the old private v0.5.3 draft frozen. Do not begin another roadmap task.

Leave corrected implementation files uncommitted/unpushed on the existing branch. Return a precise handoff with addressed findings, commands/exits/counts, file hashes and remaining release prerequisites. The designated independent reviewer/Git coordinator will handle acceptance and publication. Future prompts should be model-neutral and supplied directly in chat or direct the selected model to the detailed GitHub assignment.
