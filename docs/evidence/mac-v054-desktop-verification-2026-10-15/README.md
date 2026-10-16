# Native v0.5.4 verification evidence — 15 October 2026

Actual installed ARM64 candidate e928601; owner-approved UID501 administrator-account lane, synthetic data only. This is not hfdtest/standard-account evidence. See the report two folders above: MAC_V054_DESKTOP_VERIFICATION_2026-10-15.md.

Snapshots were read-only, after the app stopped. They include complete table rows, schema definitions (tables/indexes/triggers), migration ledger/checksums and managed-document hashes. `verify-evidence.py` compares these frozen files offline and never opens a profile or launches an app. `snapshot.py` is the exact ad-hoc capture script used in this authorized lane; it does not replace or modify the UID502 production helper. Its filenames and operation paths are specific to this run. The production helper and its isolation checks remain intact.

`restore13-comparison.json` is the initial comparison against the independently upgraded profile; it transparently excluded migration execution metadata that is generated anew. The final verifier instead checks the original schema13 ledger rows exactly and validates the new migration14 checksum separately. This avoids treating expected new execution metadata as retained application data.

Raw native UI observations are labeled `*-ax.txt`. Some observations are accessibility diffs, not full snapshots; UI actions and process checks are described in the report. No native binaries, profile directories, backup archives, provider secrets or process samples are committed. Private recoverable profiles/backups and the two process samples remain under `/Users/rickymac/.codex/task-recovery/v054-desktop-verification-20261015/`. Old install paths in receipts are historical; the old test installation has since been archived, as profile-return.json records.

`guarded-save-operation-note.txt` preserves a non-failing exploratory save: custom skill creation does not promise a safety backup. The measured failure baseline follows that exploratory action and tests a chapter save that does require a backup. The new skill's unfortunate test name is not itself a bug claim.

The two no-window observations are preserved as unresolved findings. Data restore passed; automatic window recovery did not earn a PASS. Do not relabel this entire pack or the full Mac release gate as green.
