# Local v0.5.4 build and QA evidence

Current conclusion: app built; 13 browser flows and full frontend/native checks pass; helper lane is **22/23**, plus a documented version-only replay limitation. Start with [report](../../MAC_LOCAL_V054_BUILD_AND_BUG_TEST_2026-10-15.md).

- `build-receipt.json` / `native-build.log`: original CLI app compile PASS, automatic DMG stage stalled; overall exit 1 retained.
- `artifact-identity.json` / `packaging-commands.json`: separate local ad-hoc sealing, ZIP/manual DMG identities, read-only contents verification and detach exit 0.
- `test-gate.json`: complete actual command outputs/exits, including the retained helper failure. No all-green claim.
- `browser-results.json`: final 13/13; `browser-initial-results.json` and `browser-v2-results.json` plus logs retain earlier harness failures. `browser-smoke-archived.mjs` is the exact executed harness; **do not rerun it in place**, since it names an existing evidence output. Copy it and choose fresh output/ports before reproducing.
- PNGs show synthetic browser UI only, not a native app window.
- Disk-image controls/stop/cleanup receipts preserve packaging evidence. The first malformed control command is explicitly labelled invalid, followed by successful controls. No general OS/HFS defect is asserted.
- `versioned-proof-replay.json`: raw root-version lock comparison refuses before worktree creation; actual dependency contents unchanged.
- `source-manifest.json` / `SHA256SUMS`: current version-source/reports/trackers and every evidence file; finalized last. Older helper manifests describe their accepted snapshots, not this versioned tree.

Artifacts stay local under `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-fee7869/`; no installer/app/binary enters Git. No app launch, hfdtest, real data/profile, provider or public release. The owner explicitly deferred interactive desktop testing.
