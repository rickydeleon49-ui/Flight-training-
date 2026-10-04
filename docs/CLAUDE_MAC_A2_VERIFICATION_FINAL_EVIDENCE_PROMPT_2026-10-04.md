# Claude assignment: finish Mac A2 evidence for integration — 4 October 2026

Continue `/Users/rickymac/code/Flight-training-pr70-integration`, branch `claude/mac-a2-verification-2026-10-04`. This is **one documentation/publication correction pass**. Codex independently accepts the added Mac case-alias regression's behavior: the host native suite passed 21 harness cases, including that regression, with 20 exercised cases and one early return. Keep the Rust test and all production files unchanged. Do not add features or rerun full test matrices.

Read [the independent re-review](MAC_A2_VERIFICATION_REREVIEW_2026-10-04.md) and its [frozen 29-file inventory](evidence/mac-a2-verification-rereview-2026-10-04/submitted-artifact-hashes.json) from GitHub main/the containing review PR. Do not blindly merge review files into your dirty checkout. Verify the 29 hashes before editing; preserve the old primary checkout and all ignored original logs. Report unexpected changes before proceeding with dependent edits.

## 1. Correct identities and snapshot wording

Recompute the three complete source hash values, rather than expanding their prefixes. For `src/perf/studyLibraryScenarios.test.ts`, the verified identities are:

- Working, 13,773 bytes: `7d77d92cb1e107167bcda8d3c6d4e108846bb736019e5f21c621b790f7090acb`.
- Full CRLF reconstruction, 14,073 bytes: `b365b4f6d9cbbbe28a53637dd42071c1299d8534fc6dae3515f259d49facbcf6`.
- Accepted Windows working manifest, 14,028 bytes: `663c385cf4ea5fff9877c0a309d5d1706e26fedaedf9aebd94c3f4e070c58740`.

Replace incorrect values in the report and evidence README. Preserve source and accepted manifest. Explain that 24/24 matching blobs and 9 direct/14 CRLF/1 unresolved reconstruction describe the pre-edit baseline; the submitted result has 23 unchanged blobs and one intentional test-only addition. Label clean-checkout claims as starting-state observations.

## 2. Align existing receipts without new expensive runs

Correct historical host permanent contention to 5203.948333 ms, or explicitly label rounding. Update/omit MAC-11's stale 456 ms claim using the identified retained run. Report focused harness durations as host 0.04 seconds and case-sensitive 0.05 seconds; separate compilation times from test times. Any combined values are derived estimates, not measured wall-clock receipts. Label manually supplied start times as reported rather than independently captured.

Label the new outside-checkout text and JSON as two invocations (21:01:04.154Z / 21:01:04.378Z), with matching counts. You can render a presentation from the retained JSON; no new preflight is required. Attribute the historical redirection explanation as implementer-reported. Preserve original snapshots. Keep historical pipeline exit labels and directly captured native-test exits honest and distinct.

## 3. Finish publishable-copy whitespace/provenance

Six `.txt` receipts have extra terminal blank lines: a2-diagnostics, case-sensitive-apfs-save-tests, focused, gate-02-npm-test, gate-06-cargo-test, and host-apfs-save-tests. Remove only those extra EOF blank lines in the publishable copies. Preserve the original ignored `.log` files byte-for-byte.

Update the mapping to include original/copy byte sizes and SHA-256 values plus the EOF-only transformation. The remaining nine pairs stay byte-identical. Refresh receipt tables and any affected hash inventory, including the results JSON hash in the README. Do not weaken ignore rules or stage files.

Use read-only no-index whitespace checks for new files as well as the tracked diff check. Distinguish an ordinary no-index difference exit from actual whitespace diagnostics. No full frontend/Rust matrix, fresh APFS image, repeated regression run or production change is necessary for these document edits.

## Final handoff

Update report, README, results and tracker wording consistently, keeping overall acceptance pending Codex review. Supply complete final hashes/sizes for all changed/new deliverables; separately confirm all original ignored log hashes and the already reviewed Rust test hash remain unchanged. Report exact lightweight checks and their actual exits. Leave everything uncommitted/unpushed; Codex handles integration/PR/CI/merge.

The owner's M2 check-in waiver remains effective. The owner wants to test a Mac build next; do not begin Slice B or more roadmap features. Installed testing still requires the dedicated standard account and signing/artifact prerequisites. Do not launch a real profile, call providers, change signing, create an installer, bump a version or publish a release in this evidence task.
