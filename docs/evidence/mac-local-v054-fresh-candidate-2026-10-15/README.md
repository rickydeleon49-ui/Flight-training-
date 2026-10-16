# Fresh local v0.5.4 candidate evidence — 15 October 2026

Evidence for [the report and reviewer handoff](../../MAC_LOCAL_V054_FRESH_CANDIDATE_REPORT_2026-10-15.md). Frozen source `e9286017d3ca8b1faa1c8f5568c708d43e0b3050`. Binary artifacts stay outside Git in `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-e928601/`, with their own `ARTIFACT_SHA256SUMS`.

| File | What it is |
|---|---|
| `source-freeze.json` | Source SHA and tree, versions, bundle ID, toolchain, competing-build check, reused accepted checks |
| `build-receipt.json`, `native-build.log` | The single native build: argv, environment, exit, duration; raw combined output |
| `packaging-receipt.json` | Every packaging and inspection command with exit, output and timing; artifact identities; cleanup facts |
| `preserved-artifacts.json` | The earlier `fee7869` candidate re-verified 37/37 and untouched |
| `helper-tests.txt`, `cargo-lock.txt` | 26/26 helper tests on the new ARM64 output; lock check |
| `replay-e928601.json` | RUNBOOK §7 helper-component replay on baseline `16f9cf3`, not current-app verification |
| `browser-functional-archived.mjs`, `browser-functional/` | Browser harness copy and its results, console log and screenshots (synthetic data, loopback only) |
| `evidence-inventory.json`, `SHA256SUMS` | This folder's inventory |

Raw tool logs are kept byte-for-byte and are excluded from any all-files whitespace claim. Nothing here certifies an installed app, Gatekeeper, signing or publication.
