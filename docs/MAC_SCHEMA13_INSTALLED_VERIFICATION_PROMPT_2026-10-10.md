# Mac installed verification — model-neutral continuation prompt

You are continuing Her Flight Deck on this Mac. Preparation corrections MACV-R1–R11 are accepted for integration. Your assignment is to help execute and document the physical installed G1–G3 checks using the existing exact local candidates. Do not start another preparation audit or new roadmap implementation.

## Read and establish the starting state

Repository: `/Users/rickymac/code/Flight-training-`.

Fetch first, inspect branch/HEAD/status, and read these documents from current main:
- `docs/MAC_SCHEMA13_INTEGRATION_ACCEPTANCE_2026-10-10.md`
- `docs/evidence/mac-schema13-final-corrections-2026-10-10/RUNBOOK-G1-G3.md`
- `docs/evidence/mac-schema13-integration-review-2026-10-10/README.md`

Read missing documents with `git show origin/main:<path>` when the checkout is dirty. Preserve competing work; do not pull/reset/stash/clean over it. Do not rerun broad test matrices or recreate the preparation package. Verify the staged transfer manifest and agreement with the accepted final helper/operator/installer/env/runbook before executing them. A mismatch stops execution and must be reported with the exact differing path.

## Existing authorization and session boundary

The owner has already authorized `hfdtest`, UID502, standard/non-admin, with synthetic disposable operation-owned data, and the existing local ad hoc candidates. Do not re-request that approval. Verify the real execution session is that account. If the assistant is running in the everyday account, do not run protected operations there or pretend that an environment variable changes identity. Give the person the next concrete step to log into the hfdtest desktop and open Terminal. Assist step by step there; do not ask for a password, elevate an account, disable Gatekeeper globally or inspect everyday app data.

Input kit: `/Users/Shared/hfd-schema13-kit-2026-10-08/`. Canonical staged walkthrough: `README-START-HERE.md`.
Output workspace: `/Users/hfdtest/Downloads/hfd-schema13-workspace/`, created by the operator while genuinely running as502. Follow the walkthrough's exact `prepare`, explicit `new-run`, env and checked installation sequence. Preserve existing profiles, installations, workspaces or receipts; report existing-state refusals rather than deleting or overwriting them. Interrupted permission recovery must use the original run ID and exact active record.

Pinned candidates, never rebuild or re-sign:
- NEW schema13/application36a7b39: DMG SHA256 `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334`; executable `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28`.
- OLD schema12/application2a6a415: DMG SHA256 `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62`; executable `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a`.

They are local ad hoc builds, not Developer ID signed/notarized releases. The integration commit may be newer than these frozen application identities; never substitute another package.

## Execute the full chronological walkthrough

Follow the canonical runbook, including every launch, quit, stopped check and snapshot. Capture command exits and human observations as they happen.

1. Install OLD and NEW through the checked operator in hfdtest. Record installation receipts, hashes and per-app Gatekeeper behavior. Confirm fresh root before launching OLD; preserve any existing profile and stop if refused.
2. Create the genuine schema12 baseline through OLD's installed UI: import PDFs A/B/C and the offline packet, complete its two-question practice attempt and rate a card, export a real schema12 backup, record archive hash/manifest/payload count and bytes, then quit, snapshot and preserve the whole populated profile.
3. G2: launch NEW on that populated profile, allow loading/migration, quit before study mutations, and compare with `--purpose upgrade`. Require gateEligible PASS, exact migrations1–13, preserved retained rows/files and empty new schema13 tables.
4. G1: follow every direct/automatic/nested split, sibling and copy-page check. Record ranges, byte sizes and responsiveness. Preserve the runbook's A/B/P/C1/C2 coordinates and immediate-parent sibling grouping. Import C before its size-based split. Prove cancel-before-save unchanged with stopped snapshots. Perform the deliberate pre-receipt backup-permission failure, restore permissions using the current run record, prove unchanged rows/files, and retry successfully. Export the schema13 backup afterward.
5. G3: preserve/switch whole stopped profiles exactly as instructed. OLD must refuse the newer schema13 backup without changing the schema12 profile. NEW must restore the genuine schema12 backup, apply13 and pass `--purpose restore` against the populated baseline with no residual lineage/operation rows. Relaunch to inspect restored cards and attempts, then quit.

Never take protected snapshots/switch profiles with either app running. Do not claim a full gate from `--purpose history`. If a step fails, preserve evidence, recover only the permissions changed by this run using the exact record, and stop the dependent sequence. Report the trigger, expected/actual behavior, affected path and receipt; do not patch application source during this verification assignment.

## Deliver and stop

Create `docs/MAC_SCHEMA13_INSTALLED_RESULTS_<actual-date>.md` and a new evidence directory. Include exact candidate identities, real account/session facts, run ID, command/cwd/exits, comparisons, backup manifest/count/byte facts, screenshots and human observations, plus a checksum manifest. Preserve all earlier evidence. Keep application databases and large backups in the isolated workspace; do not commit them or credentials. Update STATUS/handoff by adding history, clearly distinguishing PASS, FAIL, UNEXECUTED and BLOCKED.

The post-receipt mid-save recovery subcase remains BLOCKED/source-covered because these packages lack a human fault seam. Do not report it as a physical pass. Public-release signing/notarization/version decisions remain separate. If execution cannot proceed because the human desktop session is unavailable, give the precise next human action and retain honest unexecuted status; do not substitute mocks.

Leave results uncommitted/unpushed for senior review. Stop after the report and evidence, or after a concrete execution blocker. No new feature, installer build, provider call or public release.
