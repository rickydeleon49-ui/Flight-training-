# M2 PR 1 R3 boundary review evidence

This is a docs-only evidence pack for unaccepted source, not an application merge.

- `submitted-changes.json`: exact branch/base, tracked source diff, new source texts and current hashes. Do not apply this over a dirty checkout.
- `source-hashes.json`: 23 changed-source hashes, relative to the implementation checkout. Independently captured and all verified after temporary tests/restoration.
- `submitted-validation/`: byte-preserved current implementation report/gates and twelve-entry evidence manifest. Its SHA256SUMS is rooted in that directory, and its relative Markdown references retain their original source-directory meaning. Report claims are evaluated by the independent review.
- `remaining.rs`: five native boundary assertions using actual migrated databases, native writers and the private archive verifier. Append temporarily to backup.rs; all five fail on this submission. Disposable fixture directory names include the process and timestamp; the runner uses sequential native tests.
- `codex-diagnostic.test.ts`: seven original frontend diagnostics. Combined with permanent contract tests, 29 pass.
- `run.py`: exact review runner; current Mac/output paths must be deliberately adapted elsewhere. It removes the temporary frontend test and restores original Rust bytes in finally. It selects all 145 backup/recovery tests, 21 practice-session tests and five new boundary cases.
- `focused-frontend.txt`: exit0, 29 passes. `focused-native.txt`: exit101, 166 passes/five R3 failures. Existing recovery, original six R3 rejection proofs, original native diagnostics and true mid-write rollback pass.
- `results.json`: actual exits and source-restoration confirmation. `SHA256SUMS`: this pack's relative hashes, excluding itself.

The full gate was not independently repeated after confirmed blockers. Submitted totals: 2,488 frontend passes/four skips and375 Rust passes/six ignores. No app launch, real profile, provider, installed/account test, signing, packaging or release work occurred.
