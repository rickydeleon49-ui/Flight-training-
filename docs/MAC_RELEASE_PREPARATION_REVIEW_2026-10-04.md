# Mac release preparation independent review — 4 October 2026

**Decision: request corrections before accepting the release-preparation handoff.** The local Mac DMG exists and its reported bytes/hash match. Production source and active workflows are unchanged; no new production defect was found. The signing proposal and source/evidence claims need the bounded corrections below. [Evidence](evidence/mac-release-preparation-review-2026-10-04/README.md), [next Claude prompt](CLAUDE_MAC_RELEASE_PREPARATION_CORRECTIONS_PROMPT_2026-10-04.md).

## Independently established

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, branch `claude/mac-release-preparation-2026-10-04`, actual HEAD **`50568143a4c4aef04e54eba88bfb22f0974cafe4`**. All **16 submitted sizes/hashes match**; a separate inventory freezes those and the manifest itself. Tracked changes are three coordination documents, with the report/evidence newly added. New-file whitespace scans produce no diagnostics.

The local artifact is **4,561,979 bytes**, SHA-256 **`1ac53e566e85043260dbe74ef9d3b90c91460e412e1d88f534947f91396d64c0`**. Its direct local build exit receipt is 0; the retained build output supports completed packaging. Independent DMG signature display returns exit 1, unsigned. The submitted app preflight reports ad-hoc signature and failed strict verification. This is usable build evidence, not an approved installer.

GitHub read-only metadata confirms private draft v0.5.3 still targets `41464607ff85d0a4cf0b837c19b400d8392dfec4`; the DMG asset remains 4,511,142 bytes with digest `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`. No repository environments exist. These observations do not establish eligibility for protected environment reviewers. Claude reports 51 release-safety passes/one skip and 34 preflight passes; those baseline tests do not apply or exercise this proposed patch, and this review does not repeat them.

## RELPREP-R1 — P2: proposal cannot be applied

`docs/evidence/mac-release-preparation-2026-10-04/proposed-macos-signing.patch:11` declares its second hunk as eight old / 60 new lines, but its body contains ten old / 87 new lines. Empty context prefixes were also removed while making the file whitespace-clean. `git apply --check` rejects it with **exit 128**, “corrupt patch” at line 99. The application plan currently asks Codex to apply a broken artifact.

Generate a real diff from an isolated copy of the exact base workflow and corrected proposed target; do not hand-maintain hunk counts or strip required context markers. Verify application against the unchanged base, then parse the resulting YAML and validate relevant job/step relationships. Check whitespace in the applied target rather than damaging patch syntax to satisfy a new-file whitespace scan. Keep the proposal non-active.

## RELPREP-R2 — P2: proposed verification does not enforce its claimed signing identity

At patch lines 86–88, the display pipeline matches **any** Authority, TeamIdentifier or Timestamp line, then prints it. It does not require all fields, an approved team, a secure timestamp or the expected bundle identifier. A synthetic `codesign` function with only `TeamIdentifier=WRONGTEAM` and a runtime flag passes both proposed display/runtime guards with **exit 0**, even with explicit pipefail. This probe tests those guards, not the whole signing/notarization system.

The proposal also lacks a separate DMG signature/integrity/identity check. It uploads the package before validation and inherits the existing tag trigger instead of enforcing the assigned manual-only signing lane. Main-head checks already exist and should be preserved; signing-specific manual/main guards must be explicit. A stapler result on a container does not replace its signature or its inner app's identity checks.

Require successful commands plus explicit expected app identifier, Developer ID authority, approved team, secure timestamp and runtime checks; separately verify the DMG container and mounted app. Put upload after all validation. Keep missing credentials fail-closed, enforce the chosen lane without assuming environment protection exists, and validate temporary-material cleanup with synthetic failures. Avoid claiming guaranteed cleanup while errors are silently swallowed. Use no real secrets or keychain operations in tests.

GitHub's unspecified macOS shell uses `bash -e`, while explicit `shell: bash` enables pipefail; command/pipeline exits need deliberate handling. [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell). Tauri documents Developer ID signing and alternative notarization credentials; an App Store Connect API key is a chosen lane, not the only possible method. [Tauri signing guidance](https://v2.tauri.app/distribute/sign/macos/).

## RELPREP-R3 — P2: report contains incorrect identity and unmeasured outcomes

`docs/MAC_RELEASE_PREPARATION_2026-10-04.md:9,35`, results source fields, README and inspection receipt name **`50568140db59ec0bcf77fe49b49f3e46c7fc7088`**. That is not this checkout's HEAD. The retained initial preflight itself records the correct full SHA `50568143a4c4aef04e54eba88bfb22f0974cafe4`. Replace all incorrect expansions using actual Git output; do not alter the source or rebuild the artifact.

At report line 26 the statement “Gatekeeper assessment ... fails” contradicts both artifact JSON receipts: **A-GATEKEEPER is UNVERIFIED; assessment was not run**. No notarization/stapler outcome was measured either. Report only the actual unsigned/ad-hoc/strict-verification failures and label unperformed assessments as unverified. `notarizationStapled: false` should not masquerade as a measured validation result.

The “initial” JSON is a clean pre-build invocation at **22:34:27.232Z**, **10/0/2/3**; the “initial” text is a later invocation at **22:38:52.176Z**, **8/0/4/3**, captured inside the dirty checkout after building. They are not one initial snapshot. Identify and preserve each separately. Label inspection text and manually supplied timestamps as reconstructed/implementer-reported where direct raw capture is absent.

The README calls `build-output.log` raw, but both submitted copies are **16,159 bytes** after an EOF trim. The untouched original is **16,160 bytes**, hash `898751ccd92b8e31f0784caa12e2e9d01929ffbf20e3b6de9520801f0cad558d`; record original/copy provenance. The `.log` is ignored, so its relative publication link will be missing under normal staging. Link the publishable text and retain original hashes without force-adding logs or changing ignore policy. Capture the already existing exit receipt as publishable evidence; no rebuild needed.

## Owner direction and application-plan corrections

Respect “review and no testing account ill wait for the release.” Do not assign account creation back to the owner in this handoff. Installed verification remains unresolved, and public release still needs an observed permitted route; do not invent an account result or a waiver. Keep the owner's absence of membership recorded without automatic enrollment/payment. Developer ID provisioning is an owner/team action, with ordinary certificate creation requiring Account Holder role. [Apple certificate guidance](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).

Remove “new 0.5.3 target” from the diagram: the frozen v0.5.3 cannot be retargeted. A future candidate needs a distinct version approved before bump/build execution. Do not retire/delete the frozen draft, choose a version, trigger a release or activate the proposal now. Keep protected CI vs local/manual signing as undecided where eligibility/owner preference is unknown.

## Next step

Claude corrects proposal and evidence in one pass, validates the proposal in an isolated scratch copy with synthetic negative controls, and leaves changes uncommitted/unpushed for independent re-review. No full test matrix, fresh package build, installed test, account change, provider call, signing credential operation, tag or release is needed. This review publication does not accept or integrate the submitted implementation documents as finished work.
