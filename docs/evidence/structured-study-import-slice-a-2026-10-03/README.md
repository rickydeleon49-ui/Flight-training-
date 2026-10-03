# Structured study-import Slice A evidence: 3 October 2026

This directory contains verification evidence, mutation logs, diagnostic comparison files, and historical review snapshots supporting the [Slice A implementation report](../../STRUCTURED_STUDY_IMPORT_SLICE_A_IMPLEMENTATION_2026-10-03.md).

## Current Evidence and Receipts

- [full-verification-receipt.txt](full-verification-receipt.txt): Complete local matrix receipt recording exact commands, exits and test counts for frontend tests, production build/typecheck, Rust formatting, Clippy with warnings denied, full locked Rust tests, Cargo lockfile synchronization and whitespace audits. Corrected for SA2 to accurately record the measured host OS as macOS 27.0.1 (distinguished from SDK 26.5) and attribute CLI failure propagation evidence.
- [mutation-results.json](mutation-results.json): Structured JSON results of the corrected mutation run, covering the unmodified scratch control run (231 tests, exit 0) and all 22 architectural and privacy mutants (19 caught, 3 neutralized).
- [mutation-summary.txt](mutation-summary.txt): Human-readable console log from the repaired mutation runner execution, showing control run pass, aggregate failure propagation self-test pass, and all 22 mutant classifications.
- [self-test-failure-propagation.txt](self-test-failure-propagation.txt): API-level script log verifying that inverting M10's expectation in `runMutations()` causes the aggregate result to evaluate to false. (Note: Independent process Exit 1 on CLI execution was verified by Codex in [Codex’s CLI results, log and measured exit receipt](../structured-study-import-slice-a-review-2026-10-03/README.md)).
- [final-hashes.txt](final-hashes.txt): Current SHA-256 checksums of all modified tracked files and untracked implementation files. Excludes its own hash.

## Preserved Historical Snapshots (SA1/SA2 History)

- [reviewed-final-hashes-2026-10-03.txt](reviewed-final-hashes-2026-10-03.txt): Verbatim copy of Gemini's 92-entry receipt reviewed by Codex; SHA-256 `ebfc2c7343a43951b396daf0f65280891c7d4ca841a30ba578828829d4642a68`.
- [reviewed-implementation-snapshot-2026-10-03.md.txt](reviewed-implementation-snapshot-2026-10-03.md.txt): Verbatim snapshot of the initial authored Slice A implementation report before SA2 errata corrections.
- [reviewed-verification-receipt-snapshot-2026-10-03.txt](reviewed-verification-receipt-snapshot-2026-10-03.txt): Verbatim snapshot of the initial full verification receipt prior to host OS labeling correction.
- [claude-mutation-results-interrupted.json](claude-mutation-results-interrupted.json): Verbatim copy of Claude's original interrupted mutation run results from origin/main, preserved for diagnostic comparison. Demonstrates the two unrelated notice test failures in every row caused by omitting `package-lock.json` and `public/THIRD_PARTY_NOTICES.txt` from scratch copies.
- [claude-run-slice-a-mutations-interrupted.mjs.txt](claude-run-slice-a-mutations-interrupted.mjs.txt): Verbatim copy of Claude's original scratch runner script from origin/main, showing lines 49–51 where the lockfile and notice were omitted.

Codex publication corrections: the CLI evidence reference above names the existing published result/log/receipt; no file named `codex-cli-mismatch-exit-1.txt` exists. The historical report is stored as inert `.md.txt` without changing any bytes, because its original relative links belong to its former directory. The [SA2 submitted receipt](../structured-study-import-slice-a-acceptance-2026-10-03/reviewed-sa2-final-hashes.txt) is preserved separately; final-hashes.txt will identify the integrated publication.
