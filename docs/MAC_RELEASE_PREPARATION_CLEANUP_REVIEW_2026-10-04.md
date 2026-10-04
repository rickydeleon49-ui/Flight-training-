# Mac release preparation cleanup re-review — 4 October 2026

**Decision: accept RELPREP-R2b and the principal R2a state-transfer fixes; one R2a cleanup failure path remains open.** R1 and R3 stay accepted. Keep the signing proposal inactive. [Evidence](evidence/mac-release-preparation-cleanup-review-2026-10-04/README.md) · [model-neutral correction assignment](MAC_RELEASE_PREPARATION_CLEANUP_FIX_PROMPT_2026-10-04.md).

## Accepted corrections

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, historical branch `claude/mac-release-preparation-2026-10-04`, HEAD `50568143a4c4aef04e54eba88bfb22f0974cafe4` plus submitted changes. All 19 deliverables and both original log entries match submitted sizes/hashes. The frozen inventory also records the manifest's identity. Only tracker documents are modified among tracked files; active workflow, application source and dependencies remain unchanged.

R2b is closed: the dedicated `build-macos` job has the pre-secret event/ref guard for manual workflow_dispatch on refs/heads/main, and only that job contains Apple signing credentials or enters macos-signing. The Windows job depends on the existing policy-enforcing check job and targets all only; the Windows hold remains unchanged. Existing source/version checks, signature verification before upload and private-draft boundaries remain present.

R2a's main defects are corrected: the original ordered list is saved in a deterministic state file rather than a multiline GITHUB_ENV record; array arguments preserve spaces; initial query failure aborts setup; cleanup locates the task-owned keychain without environment exports. The six new synthetic setup/cleanup cases pass. A separate independent environment-write-failure probe also stops setup and cleans all synthetic materials successfully.

The submitted validator independently exits 0 under Node 22.23.3. It prints **37 PASS assertions**: two patch/application checks, seven structure/ordering checks, seven prerequisite cases, six setup/cleanup cases and fifteen verification cases. Of these, 28 are executable shell behavior cases. Its hard-coded footer and report say 35; correct that bookkeeping without counting these as a full application suite. Patch check and scratch-applied bytes match the proposed YAML. The submitted releaseSafety result (51 passed, 1 skipped) was not independently rerun because source did not change.

## RELPREP-R2a-cleanup — P2: state-file removal can abort remaining credential cleanup

In submitted `proposed-release-workflow.yml:501`, `rm -f "$STATE_FILE"` is unguarded. GitHub runs explicit shell: bash with `--noprofile --norc -eo pipefail`. If that removal fails, the step exits immediately and never reaches the AuthKey.p8/cert.p12 removal at line 504 or the aggregate error message. This violates the requested independent cleanup attempts after one action fails.

Codex ran the actual proposed scripts with synthetic commands and task-owned files. Setup succeeded. Forcing only state-file removal to fail (exit 73) under the GitHub shell options produced cleanup exit 73 and left the synthetic AuthKey.p8. Keychain deletion and ordered-list restoration had already succeeded. All diagnostic files were removed afterward; no real keychain was used.

The submitted helper at `validate-signing-proposal.mjs:384` instead invokes cleanup using bash -c without errexit/pipefail. With the same injected failure, that execution returns **0** despite a state-file removal error, because CLEANUP_FAILED is never set for that command. This is both an implementation defect and a test-environment mismatch. The existing deletion-failure test catches a security delete-keychain failure, but does not test this state removal failure.

Guard/aggregate this cleanup action so remaining independent removals still execute and the final result is nonzero. Apply the same independent-attempt rule to state-read/removal errors and credential-file cleanup. Execute extracted scripts with the actual GitHub shell options. Add a regression proving state removal failure still attempts all credential removals and reports a nonzero result. Preserve the accepted job guard and state-transfer corrections.

GitHub documents its explicit Bash invocation and default fail-fast behavior in [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell). This is a synthetic reproduction of the proposal's behavior, not an observed hosted signing job.

## Boundary and next step

Use the focused correction assignment. Fix the cleanup aggregation, align the test shell, correct the assertion count and regenerate/check the inactive patch. Keep changes uncommitted for independent review. No full suite or package rebuild is required for these inactive evidence changes.

The local DMG still matches 4,561,979 bytes and SHA-256 `1ac53e566e85043260dbe74ef9d3b90c91460e412e1d88f534947f91396d64c0`. It has not become an approved signed installer. Signing membership/credentials, lane approval, installed verification and exact-artifact release approval remain unresolved. The owner directs no testing-account work and will wait for a release. No new version, enrollment, real signing or release publication occurred in this pass. Primary and implementation dirty checkouts are preserved.
