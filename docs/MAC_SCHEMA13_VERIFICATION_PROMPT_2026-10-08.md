# Mac schema13 installed verification — model-neutral assignment

Continue from the merged split-lineage integration. The implementation and scope are accepted; do not reopen the planning rounds or reimplement the feature. Read `docs/M2_SPLIT_LINEAGE_INTEGRATION_CLEANUP_2026-10-08.md`, `docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md`, latest STATUS/handoff and the existing Mac release continuation instructions before deciding what is currently authorized.

## Starting state

Use the primary `/Users/rickymac/code/Flight-training-` checkout on clean main synchronized with origin/main. Confirm the source commit and working-tree state. The former five dirty checkouts have local archive branches; these are recoverable historical snapshots, not alternate active implementations. Do not restore their older tracking files over main or start competing work.

This assignment prepares and, when owner-authorized isolation is available, executes only the three remaining physical Mac verification gates. Source-test results are already recorded; reuse them rather than running another broad review matrix.

## Check the actual prerequisites first

The owner previously deferred installed testing and reported no Apple Developer membership. Do not infer a new signing lane or test-account authorization from source integration. Confirm whether an isolated standard test account/device/profile is now approved and available. If unavailable, stop before launching the app and report exactly that prerequisite. Do not use the everyday account or redirect a production library by guessing environment variables.

If the current recorded release decisions permit only a local unsigned candidate, label the evidence accordingly; never describe it as Developer ID signed, notarized or publicly distributable. If signed execution remains required and credentials/lane/version are missing, report those specific missing decisions. Do not enroll, provision secrets, trigger a signed workflow or publish an installer without the corresponding owner authorization. Preserve the historical v0.5.3 candidate and exact-installer invariant.

## Physical checks, once the lane and isolation are authorized

Use a candidate built from the exact merged commit and record bundle version, CPU architecture and installer/app hashes. Keep all test files and databases synthetic and operation-owned.

1. Installed Apple Silicon smoke: import a synthetic multi-page PDF; exercise manual and automatic split through the real desktop IPC; save, reopen and confirm lineage/source links/same-edition related parts/copy-page guidance. Exercise a nested split and verify parent20–40 => original120–140 for a parent covering original101–300. Check cancelled and failed-save recovery and reopen after restart without duplicated parts. Preserve source and retained child files.
2. Upgrade populated data: prepare a schema12 fixture library with materials, practice responses/completed attempts and card state/events. Install/launch the candidate against this approved fixture profile. Verify migration13, unchanged retained histories and working split creation; record before/after counts and stable history-field hashes. This must exercise the installed app, not only a direct SQLite script.
3. Backup compatibility: create or use a synthetic older schema12 backup, restore it in the new app and verify materials/files/histories. Verify an approved older binary refuses a schema13 backup without modifying its existing fixture library. Keep candidate identity and backup provenance explicit; do not substitute a numeric simulation for the physical result.

Reuse the established safety and release gate documents for signing/stapling/Gatekeeper checks appropriate to the chosen lane. Do not silently mark skipped checks as pass. Include screenshots or observable results for the important desktop flows and exact commands/exits where applicable.

## Deliver

Write one bounded verification report/evidence pack, identify the exact candidate source and bytes, separate passed/failed/blocked checks, and update STATUS/handoff honestly. Leave any new code/report changes uncommitted/unpushed for senior review. If a real defect is found, give a precise reproduction and smallest proposed fix rather than starting a new roadmap feature. Stop after this verification assignment; public release publication remains separately authorized.
