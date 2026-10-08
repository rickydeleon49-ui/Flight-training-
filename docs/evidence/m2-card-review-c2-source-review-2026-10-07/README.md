# C2 independent source-review evidence

Decision: changes requested, C2SRC-R1/R2. The report and model-neutral correction prompt are in docs/.

- submitted-source-hashes.json: exact original structured manifest, 30 paths.
- submitted/source/: exact 30-file source snapshot, not accepted application source.
- submitted/: original submitted STATUS/handoff snapshots.
- diagnostics/C2SourceReviewDiagnostic.test.ts: final frozen 3-case diagnostic. Copy verbatim to src/pages/StudyLibrary/ and run with the existing Vitest setup, then remove the temporary source file.
- receipts/: existing focused checks, native check, typecheck, evidence verification and final diagnostics, each with raw exits where applicable. `diagnostic-harness-first.txt` is an initial harness mistake; `diagnostic-refresh-experiment.txt` is an intermediate refresh experiment, not the final R2 proof. `diagnostic.txt` is the final normal-user-flow reproduction (3 failures, exit 1).

Implementation checkout was verified unchanged after review. No installed Mac or release verification occurred. A symlink to matching existing dependencies was used only in the isolated reviewer tree, then removed. Native focused tests used the implementation checkout's cached target directory; source was not changed.

Verify SHA256SUMS from this directory. Recompute snapshot hashes using the manifest's files map and submitted/source/ prefix.
