# Implementation assignment: finish Mac signing cleanup failure handling — 4 October 2026

Any owner-selected implementation model may complete this task. Continue `/Users/rickymac/code/Flight-training-pr70-integration`, historical branch `claude/mac-release-preparation-2026-10-04`, HEAD `50568143a4c4aef04e54eba88bfb22f0974cafe4` plus existing work. Confirm branch/HEAD/status and the frozen handoff hashes before editing. Preserve the primary dirty checkout. Read the new review documents from origin/main without merging tracker updates into the dirty implementation checkout.

Read [the cleanup re-review](MAC_RELEASE_PREPARATION_CLEANUP_REVIEW_2026-10-04.md), [frozen inventory](evidence/mac-release-preparation-cleanup-review-2026-10-04/submitted-artifact-hashes.json), [observations](evidence/mac-release-preparation-cleanup-review-2026-10-04/cleanup-shell-observations.json) and [diagnostic source](evidence/mac-release-preparation-cleanup-review-2026-10-04/cleanup-shell-diagnostic.cjs). R1, R3 and R2b are accepted. R2a's multiline-state, spaces, initial-query failure and environment-independent cleanup fixes are accepted. Do not redesign those or start another roadmap task.

## Required implementation correction

The remaining defect is the unguarded state-file deletion in the proposed cleanup step. Under GitHub's explicit Bash shell options, its failure stops execution before credential-file removal. Under the submitted test helper's plain bash -c, the same failure can return success without recording CLEANUP_FAILED.

Make each independent cleanup action run despite failure in an earlier action. In particular, catch state-read/removal failure, attempt the remaining task-owned AuthKey.p8 and cert.p12 removals, and return nonzero with clear aggregate reporting when any action failed. Retain ordered search-list restoration, deterministic task-owned paths, and keychain deletion-failure reporting. Avoid eval, broader filesystem scans or removal of unrelated material. Keep the sensitive state handling and cleanup confined to the task-owned runner paths.

Use a narrow implementation in the inactive proposed YAML. Do not alter active .github/workflows/release.yml. If using guarded commands/conditional blocks rather than disabling fail-fast globally, ensure the state-reading block can report its failure without aborting subsequent independent actions. Do not suppress failure just to make the final result green.

## Regression and execution fidelity

Update the validator helper to execute the extracted proposed scripts using GitHub's actual explicit Bash settings: bash --noprofile --norc -eo pipefail with a task-owned script file. Match this for the cleanup regression and other extracted scripts where applicable, rather than relying on default bash -c behavior. Continue to stub all security/signing commands and use disposable task-owned files.

Add a regression where setup succeeds, state-file removal fails, credential files exist, and cleanup must still attempt/remove the remaining credentials, record the error and exit nonzero. Assert exact files and behavior, not just an exit code. Cover state-reading failure and independent credential removal failures sufficiently to prove the cleanup aggregation; reuse existing fixture helpers and keep the work bounded. Preserve the previously meaningful prerequisite, verification, keychain-state and job-guard cases.

The independent probe already accepts genuine setup environment-write failure: when GITHUB_ENV is a task-owned directory, setup fails before keychain creation and cleanup succeeds. You may make that a permanent regression if useful, but do not describe an empty TEMP_KEYCHAIN variable alone as execution of an actual export failure.

Correct the count: the current runner prints 37 PASS assertions (2 patch checks + 7 structure/ordering + 7 prerequisite + 6 keychain + 15 verification), including 28 executable behavior cases, while its footer/report claim 35. Derive counts from executed assertions/cases or use consistent accurate labels. Update report, results and receipt totals after adding regressions. Preserve historical evidence provenance.

## Verify and hand off

Regenerate the patch from the unchanged active base. Run git apply --check, apply only in scratch and compare bytes with the exact proposed YAML executed by tests. Parse the proposal and check applied-target whitespace. Preserve unified-diff syntax; do not strip context markers to satisfy a generic whitespace check.

Run the expanded focused validator after the final correction, repeating only for a real failure/new edit. Do not rebuild the DMG or repeat the full frontend/Rust suite. Capture direct exits, assertion/case counts and the new failure-path receipts. Update README/report/results/tracker notes with pending independent review and a precise issue-to-fix mapping. Freeze full final hashes/sizes for changed deliverables and maintain the original DMG/log identities.

Owner boundaries remain: no testing-account work, app launch/installation, owner app data, Apple enrollment/payment, credential provisioning, real keychain operations, provider calls, signing workflow activation, packaging CI, version bumps, tags or release publication. Keep the old private v0.5.3 draft frozen. Lane approval and installed/signing gates stay unresolved.

Leave implementation changes uncommitted and unpushed. Return the corrected-file inventory, exact test results, regression mapping and remaining prerequisites, then stop for independent review. The review/Git coordinator will handle acceptance and integration. Use model-neutral prompt names in all new coordination documents.
