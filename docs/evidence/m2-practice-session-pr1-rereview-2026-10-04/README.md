# M2 PR 1 focused corrections re-review evidence

This docs-only pack publishes unaccepted source evidence, not an application merge.

- `submitted-changes.json`: exact local base/branch, current tracked source diff and new source texts. The older base remains accurate; PR97 added only documentation. Do not apply this over a dirty checkout.
- `source-hashes.json`: current changed-source hashes relative to the implementation checkout. Independently captured before diagnostics and all verified afterward. This is separate from the submitter's evidence-only manifest.
- `submitted-corrections/`: byte-preserved implementer evidence/report and fourteen-entry manifest. Its SHA256SUMS is rooted in that subdirectory. Source/coverage claims remain subject to the independent report.
- `codex-diagnostic.test.ts`, `codex_backup_diagnostic.rs`: original diagnostics, verified byte-identical to PR97. All thirteen now pass in the final focused run.
- `additional.rs`: six new native archive rejection proofs. Append temporarily to backup.rs to call the private verifier against actual disposable databases/native writers. All six fail on the corrected submission.
- `run.py`: exact sequential review runner. Reads only disposable fixtures; restores original Rust source and removes temporary frontend test in finally. Checkout/output paths are this Mac session's paths; adapt deliberately elsewhere. Native test threads are sequential to prevent temporary fixture name collisions, while the actual concurrency test still spawns its own threads.
- `focused-frontend.txt`: 26 passes, exit0. `focused-native.txt`: 27 passes/six R3 failures, exit101. No fixture/build failure in the final run.
- `initial-attempt-note.txt`: retained summary of first parallel fixture collision; the final sequential logs replaced that initial runner output. This is not a production failure.
- `results.json`: exits and exact restoration confirmation. `SHA256SUMS`: this pack's hashes excluding itself, rooted here.

Independent review did not repeat the full matrix after confirming blockers. Submitted gate totals: 2,485 frontend passes/four skips and365 Rust passes/six ignores. No app launch, owner profile, provider, installed/account, signing or release work occurred.
