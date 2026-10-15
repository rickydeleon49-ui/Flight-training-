# Owner decision: local unsigned v0.5.4 candidate — 14 October 2026

The owner selected the local unsigned/ad-hoc Mac test-build route after clarification that Apple credentials are needed for Developer ID signing/notarization, not for local development and testing. The owner will tell the team when to pursue signed distribution.

## Approved now

- Continue the existing release-related corrections, independent review and integration, keeping one implementation owner and the designated Git coordinator.
- Prepare version **0.5.4** through supported tooling and freeze its exact accepted source.
- Build a fresh **local Apple Silicon unsigned/ad-hoc test candidate** after source/version acceptance. This is build authorization; do not ask the owner for the same signing-lane or version decision again.
- Keep the artifact local/private, capture its exact source/version/installer/executable hashes and actual signature status, and provide concise human test instructions.

## Deferred and preserved

- Apple Developer membership, Developer ID credentials, notarization and the signed-distribution workflow are deferred until the owner requests that route. The absence of those credentials does not block the approved local candidate.
- No public publication, release draft, Git tag or remote packaging dispatch is included. Preserve the old v0.5.3 draft and historical installer identities.
- This choice does not itself launch an app, install into an account, change permissions, access an everyday profile, or resume the deferred hfdtest run. The owner receives the candidate and test steps first. Existing physical verification and recovery gaps stay unverified, not waived or passed.
- No security-control bypass, provider calls, M4 production adoption, new dependencies, bundle-identifier change or Windows distribution change is included.

## Current dependencies

At this decision main is `cb0ece14239e4bacbd845642329ba47e98fe1d13`, with schema14 and application version 0.5.3. PRs #154/#155/#157 are merged and independently reviewed in [#158](https://github.com/rickydeleon49-ui/Flight-training-/pull/158). The saved schema14 verification/metadata package still needs completion and review; timezone-test PR #152 remains open. The high source-map-js alert is fixed; the medium glib alert remains a separate disposition item. Do not represent these dependencies as finished because the build route is approved.

The [continuation assignment](MAC_LOCAL_UNSIGNED_V054_CONTINUATION_PROMPT_2026-10-14.md) supplies the implementation and review checkpoints. This dated decision supersedes earlier requirements for signing credentials **only for this local private candidate**; signed/public release requirements remain available for the later route.
