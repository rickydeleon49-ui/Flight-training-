# Mac release preparation — independent acceptance, 4 October 2026

**Accepted for integration: release-preparation evidence and the inactive signing-workflow proposal.** RELPREP-R1, R2a, R2b and R3 are closed, including the final cleanup failure finding. No remaining blocker was found in the reviewed correction. This acceptance does not activate signing, approve an installer or authorize release publication.

[Preparation report](MAC_RELEASE_PREPARATION_2026-10-04.md) · [accepted proposal](evidence/mac-release-preparation-2026-10-04/proposed-release-workflow.yml) · [independent receipts](evidence/mac-release-preparation-acceptance-2026-10-04/README.md) · [conditional release continuation prompt](MAC_RELEASE_CONTINUATION_PROMPT_2026-10-04.md).

## Review and verification

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, historical branch `claude/mac-release-preparation-2026-10-04`, starting HEAD `50568143a4c4aef04e54eba88bfb22f0974cafe4` plus the submitted changes. All 19 handoff deliverable hashes and both original log identities match. The submitted manifest's identity is frozen separately. The application source, dependency files and active workflows are unchanged; all subsequent main changes since that base are coordination documents/evidence.

The only proposal difference since the preceding review is bounded cleanup failure handling: guarded state reading/removal, independent credential-file removals and aggregate failure reporting. The validator now uses task-owned script files with GitHub's explicit Bash options, adds four meaningful failure-path cases and derives its counts from executed checks.

Codex independently ran the submitted validator with Node 22.23.3: **exit 0, 41 PASS assertions**, comprising **32 executable synthetic behavior cases and 9 structural/ordering checks**. Output matches the submitted receipt exactly. Patch applicability, scratch byte equality, YAML parsing, job guard/secret containment and validation-before-upload checks all pass. Prior accepted findings are preserved rather than re-audited without new evidence.

Codex also reran the original independent diagnostic against the corrected scripts. Injected state-file deletion failure now returns cleanup exit 1 under both local and GitHub Bash invocation, reports the aggregate error and removes the synthetic private key while leaving the deliberately undeletable state file. A genuine synthetic GITHUB_ENV write failure returns setup exit 1, then cleanup exit 0 with no task-owned materials left. All diagnostic directories were removed; no real keychain or signing tool was invoked. Permanent regressions additionally cover unreadable state and independent credential deletion failure.

The implementer's reported releaseSafety result is 51 passed and 1 skipped; it was not independently rerun because production code and active workflow did not change. No full frontend/Rust matrix, rebuild, mount, app launch, installed test or signing operation was performed for this final correction. Documentation links and staged non-patch whitespace checks pass. The unified diff produces five intentional blank-context-prefix diagnostics at patch lines 6, 33, 319, 323 and 331; those syntax bytes are preserved. The applied YAML target passes whitespace checking.

## Integration and provenance

Publish the preparation report, original receipts, corrected executable proposal, runner and manifest. Reviewer status updates supersede historical pending-review notices. Coordinator edits are confined to acceptance labels and minor prose corrections: the report now displays the actual publish-job condition, credentials are described as step-scoped, a local signing lane stays conditional on owner selection/review, and the JSON calls the temporary password masked. The executable YAML/patch/runner and existing measured receipts retain their reviewed bytes. The submission inventory describes pre-integration bytes; the publication inventory records the final artifact bytes. No correction is reassigned solely for those editorial changes.

The coordinator preserves current main tracker history and adds concise acceptance entries instead of overwriting it with old-base implementation copies. Primary and implementation dirty checkouts remain preserved. The isolated integration checkout is synchronized and clean after merge.

## Release boundary and next step

The local package remains evidence only: `Her Flight Deck_0.5.3_aarch64.dmg`, 4,561,979 bytes, SHA-256 `1ac53e566e85043260dbe74ef9d3b90c91460e412e1d88f534947f91396d64c0`. It has not been rebuilt or approved for installation. The old private v0.5.3 draft remains frozen on its historical source/artifact identity.

Remaining release prerequisites are owner-provided Apple signing membership/credentials, an approved signing lane, a version/source decision, actual signed/notarized packaging and exact-artifact installed verification before publication. The owner has deferred testing-account work and will wait for a release; no account work is assigned here. Do not start another preparation audit. Use the conditional continuation prompt when the owner supplies the next release decision. M2's owner waiver, A2 acceptance, Windows hold and other roadmap gates remain separate.
