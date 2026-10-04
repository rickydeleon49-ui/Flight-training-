# Final Mac release-preparation acceptance evidence — 4 October 2026

[Acceptance](../../MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md).

`reviewed-submission-hashes.json` freezes all 19 submitted deliverables plus the original manifest and two local log identities before integration. Those bytes all matched at review time. `independent-validation.txt` records the independent Node 22.23.3 run: exit 0, 41 passing assertions (32 executable cases and 9 structure/ordering checks), exactly matching the submitted receipt.

`cleanup-regression-observations.json` records the original three independent synthetic probes rerun against the corrected proposal. State-file removal failure now reports cleanup exit 1 and removes AuthKey.p8 under both shell modes; environment-write failure stops setup and allows cleanup exit 0. Calls and files are synthetic and disposable. The earlier published diagnostic source in the cleanup review documents the harness; no real security/signing/app operations occurred.

`publication-artifact-hashes.json` records final published preparation and acceptance artifacts after the coordinator's status/editorial updates. Executable proposal YAML, patch, runner and measured receipts retain their reviewed bytes. Submitted tracker hashes refer to the preserved implementation checkout; current main tracker notices incorporate the acceptance while retaining prior history. Ignored build-output.log and external /tmp raw logs are not uploaded. The existing DMG identity is preserved; signing/installed/release prerequisites remain open.

Whitespace checks pass for all staged non-patch files and the applied YAML target. Five unified-diff blank context prefixes are retained as valid patch syntax (lines 6, 33, 319, 323 and 331); generic trailing-space diagnostics on those prefixes are not source defects.
