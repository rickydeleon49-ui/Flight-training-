# Conditional Mac release continuation — 4 October 2026

This assignment is model-neutral. Use it when the owner is ready to complete signing setup and authorize the next private release candidate. Release preparation has passed independent review; do not reopen completed findings, add another audit or rebuild solely to repeat accepted evidence.

Read [final acceptance](MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md), the [preparation report](MAC_RELEASE_PREPARATION_2026-10-04.md), [development workflow](PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md), [release review process](RELEASE_REVIEW_PROCESS.md) and current STATUS/PROJECT_HANDOFF. Separate accepted preparation from actual signing and installed results. R1–R3 are closed, 41 synthetic assertions pass, and the proposal remains inactive.

## Entry conditions

Before release execution, the owner must provide or authorize:

- Apple Developer Program access and a Developer ID Application certificate with notarization authentication, configured securely without pasting secrets into chat or evidence.
- A signing lane: the proposed macos-signing GitHub environment after checking eligibility/protections, or a separately reviewed local/manual lane. Do not assume environment protections or local-lane approval already exists.
- A distinct release version and current-main source identity, plus authorization for the private candidate build. The old v0.5.3 draft is frozen and must not be replaced, retargeted or reused.

If those decisions are absent, state the missing release prerequisites once and stop release execution. Do not create more preparation documents, rerun the full suite, request testing-account creation, launch the owner app or start another roadmap feature. The owner has said they will wait for the release and has deferred testing-account work.

## Once the owner supplies the prerequisites

Confirm the agreed Mac checkout, branch, head and working state. The previous implementation checkout may still contain preserved accepted documents on its historical branch. Reconcile it deliberately with updated origin/main, preserving all files and original logs. Do not blindly reset, stash or overwrite dirty work; use the accepted GitHub package as the authoritative coordination state.

Prepare one bounded implementation change for the chosen lane. For the GitHub lane, use the accepted inactive proposal as the basis for the active release workflow; preserve its manual/main job guard, Windows hold, exact-current-main/version checks, signature/notarization verification before upload, cleanup failure aggregation and private artifact/draft boundary. Recheck applicability against the current active workflow because the accepted patch was based on the recorded earlier source. Review any later workflow changes rather than applying it blindly.

Make version changes only to the owner's selected version, keep all version files and lockfiles consistent, and run the checks relevant to that active change. A real active-workflow/version change requires release-safety checks and the applicable local gate; accepted proposal tests alone do not certify active configuration. Capture meaningful failures locally before one reviewed push. Leave implementation uncommitted/unpushed for the designated independent reviewer unless the owner explicitly assigns Git coordination differently.

After independent acceptance and required exact-head CI, the designated coordinator integrates the active configuration. Trigger a single authorized private candidate run from current main using workflow_dispatch. Preserve exact source, run ID, normalized asset filenames and full SHA-256 checksums. Do not retag or publish. Protect all credentials and publish only sanitized receipts.

Actual Developer ID identity, integrity, hardened runtime, timestamps, notarization/stapling and packaged metadata must pass for both the DMG and inner app. Synthetic tests are not those results. Keep a failed candidate private and follow the established release policy rather than bypassing platform protections.

The exact candidate bytes intended for publication must pass the existing physical installed-device gate before a public release. Installed testing requires its own authorized, isolated plan; the earlier no-account direction does not authorize owner-profile access or automatic waiver. If that gate remains unavailable, hold the candidate and report the precise remaining step. Public release publication is a separate owner-authorized action.

Return one concise handoff showing completed actions, actual evidence, source/artifact identities and any remaining owner prerequisite. Keep precision and delivery pace aligned: reuse accepted work and proceed promptly when applicable gates pass.
