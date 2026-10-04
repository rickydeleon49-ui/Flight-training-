# Mac release preparation correction re-review — 4 October 2026

**Decision: accept RELPREP-R1 and RELPREP-R3; RELPREP-R2 remains open for two bounded workflow fixes.** The patch now applies and the evidence corrections are substantially complete. The signing proposal stays non-active and is not ready for activation. No production defect was found. [Evidence](evidence/mac-release-preparation-rereview-2026-10-04/README.md), [model-neutral next assignment](MAC_RELEASE_PREPARATION_WORKFLOW_FIX_PROMPT_2026-10-04.md).

## Accepted and independently checked

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, branch `claude/mac-release-preparation-2026-10-04`, HEAD `50568143a4c4aef04e54eba88bfb22f0974cafe4` plus submitted changes. All **19 submitted deliverable hashes** and both original/copy log entries match. A frozen inventory additionally records the manifest's own identity. Production source, active workflows and dependencies are unchanged. The existing local DMG still matches its 4,561,979-byte identity and full checksum.

RELPREP-R1 is closed: `git apply --check` returns 0, and applying the patch only in a disposable scratch directory produces exactly the submitted proposed YAML. It parses successfully. The submitted validator extracts the actual proposed scripts; Codex independently ran it and all **24 synthetic behavior cases pass, exit 0**. This is useful coverage of prerequisite rejection, app/container metadata checks, validation-before-upload and two isolated cleanup cases. It is not an actual signed build or GitHub execution.

RELPREP-R3 is closed for the requested corrections: the full source SHA is correct; Gatekeeper is labeled unperformed; initial JSON and later text snapshots are distinguished; the raw/copy EOF transformation and direct build-exit receipt are recorded; ignored-log publication links are corrected; no owner account assignment or frozen-draft retargeting is retained. Existing independent A2 acceptance and the M2 waiver are unchanged. No rebuild or full test matrix was necessary.

## RELPREP-R2a — P2: keychain-state export fails with multiple entries

`docs/evidence/mac-release-preparation-2026-10-04/proposed-release-workflow.yml:316–317` captures a multiline keychain list, removes its quote characters, and writes it as a single `ORIG_KEYCHAINS=value` record. With two entries, the second path becomes a bare line in GITHUB_ENV. Running the actual setup script with a two-entry synthetic list returns exit 0 but produces this invalid environment file. GitHub's runner rejects that format, so the following `TEMP_KEYCHAIN` export cannot be relied on. Cleanup at lines 476–480 depends on that exported variable; the synthetic follow-up with it absent returns 0 and leaves the temporary keychain file.

Additionally, the initial list query is suffixed with `|| true`: when that query fails, setup continues, captures an empty original list and changes the search list without a valid restoration record. Unquoted expansion also splits keychain paths containing spaces. These are state-transfer and cleanup defects in the proposal, not observed changes to this Mac's real keychain.

Preserve the original ordered list safely, including path boundaries and spaces. Use a task-owned state file or valid multiline encoding, fail before modifications when initial state cannot be captured, and give cleanup a deterministic task-owned path when an environment-file export/setup step fails. Exercise setup followed by environment-state transfer and cleanup, including partial setup failures. The current runner declares `setupScript` at line 95 but never executes it; its two cleanup tests supply ready-made variables and therefore miss these cases.

GitHub documents special encoding for multiline environment values. Its runner marks malformed file commands failed. [Workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#multiline-strings), [runner file-command implementation](https://github.com/actions/runner/blob/main/src/Runner.Worker/FileCommandManager.cs).

## RELPREP-R2b — P2: manual/main restriction happens after credentials are supplied

The proposed build job at line 225 has **no job-level event/ref condition**. It enters the `macos-signing` environment, and the prerequisite step at lines 253–267 receives Apple secrets before its shell rejects a tag push. This blocks later import/build operations, but does not support the report's claim that tag pushes cannot enter the signing lane or access credentials. The existing current-main check can pass for a tag on current main; it is not a manual-event restriction.

Place the manual/main decision before any credential-bearing job or step can start, preferably on the signing job using event/ref contexts. Preserve platform policy and current-main identity checks. Test the actual workflow AST/control boundary for allowed manual/main, tag push, manual/non-main and non-Mac behavior. Testing only a prerequisite shell function with already supplied synthetic credentials proves a later rejection, not credential isolation. Keep protected-environment eligibility/lane choice explicitly undecided; do not create or activate an environment.

## Correction scope

Use the [focused assignment](MAC_RELEASE_PREPARATION_WORKFLOW_FIX_PROMPT_2026-10-04.md). Resolve these two workflow issues and extend the submitted validator to cover setup/state transfer and pre-secret job guards. Preserve the accepted report corrections and package identity. Update any claims/test counts honestly and demonstrate that the regenerated patch still produces the exact proposed YAML. Keep the proposal inactive and source/workflows untouched.

The owner still directs no testing-account work and will wait for a release. Installed, Developer ID/notarization and exact-artifact release approval remain unresolved; membership/credentials are not available. No account request, app launch, enrollment, real keychain operation, version bump, paid packaging run, tag or release publication is part of this pass. Review documentation may be published independently while the implementation remains uncommitted for correction.
