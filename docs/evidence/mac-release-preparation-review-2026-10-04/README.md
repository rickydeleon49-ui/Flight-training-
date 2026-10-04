# Mac release preparation review evidence — 4 October 2026

[Independent review](../../MAC_RELEASE_PREPARATION_REVIEW_2026-10-04.md) and [Implementation correction assignment](../../MAC_RELEASE_PREPARATION_CORRECTIONS_PROMPT_2026-10-04.md).

`submitted-artifact-hashes.json` freezes all 16 supplied artifact hashes, independently matched, plus the submitted inventory's own hash (17 files). The submission remains unchanged in Claude's checkout. `observations.json` records actual HEAD, read-only patch validation (exit 128), a synthetic signing-metadata guard probe (exit 0 with wrong team and missing authority/timestamp), source/preflight snapshots, build-log EOF-only transformation and independent unsigned-DMG display (exit 1).

Five copied submitted artifacts substantiate the proposal and conflicting readiness observations. These copies preserve submitted bytes; they are diagnostic snapshots, not accepted signing code or newly run readiness checks. The existing local DMG independently matches 4,561,979 bytes and SHA-256 `1ac53e566e85043260dbe74ef9d3b90c91460e412e1d88f534947f91396d64c0`. Raw original build output remains local at `/tmp/hfd-local-build-2026-10-04.log`, 16,160 bytes, SHA-256 `898751ccd92b8e31f0784caa12e2e9d01929ffbf20e3b6de9520801f0cad558d`; its direct exit receipt is `0`. Both submitted log copies remove one terminal newline, so neither is the untouched raw capture.

No full suite or package rebuild was run by this review; no app launch, account work, keychain write, notarization, Gatekeeper assessment or release publication occurred. Existing active workflows and all implementer changes remain untouched. This PR publishes review documentation only.
