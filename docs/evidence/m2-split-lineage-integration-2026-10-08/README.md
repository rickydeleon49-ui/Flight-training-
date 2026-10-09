# Accepted lineage integration verification

Source integration only. See the integration/cleanup report and source/scope acceptance. Original source manifests describe the reviewed snapshot; `integration-hashes.json` describes the integrated files. Exactly three original manifest paths change: STATUS, handoff and the test-only F-1 helper. All other 32 paths match. Prior evidence is immutable.

Independent checks: 110 focused frontend passes; build/typecheck; 444 Rust passes/ 6 ignored at default parallelism; Clippy with warnings denied; rustfmt; cargo lock synchronization. The affected documents tests are repeated 12 times at default parallelism. Raw output and separate exits are retained under receipts. Every exit must be 0. Full local frontend 2862 / 5 and sensitivity evidence are reused from the independently accepted source review; exact-head GitHub CI supplies its own full run.

Environment: Node 22 via `/opt/homebrew/opt/node@22/bin`; scoped rustup stable via `/opt/homebrew/opt/rustup/bin`; SDKROOT selected by `xcrun --sdk macosx --show-sdk-path`. Cargo cache reuses the isolated reviewer target under `.qwen/tmp/split-lineage-review-2026-10-08/copy/src-tauri/target`; source checks run in the integration checkout. Dependencies reuse a byte-identical-lockfile sibling via ignored node_modules symlink.

`local-snapshots.json` preserves prior branch/base, five snapshot commits and SHA-256 of all 980 changed paths. Those local archive branches and the standalone verified Git bundle preserve unreviewed and duplicated work without including it as production changes. Secondary worktrees remain clean; primary synchronization follows the green PR merge.

No installed app/profile, signing, notarization or release publication test is claimed. All existing Mac gates remain.
