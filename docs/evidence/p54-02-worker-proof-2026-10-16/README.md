# P54-02 phase 2 proof evidence

- `p54_worker_proof.rs`: the complete proof source. It is built only as a temporary Cargo example.
- `run-phase2.py`: reproduces the build, the suite and the measurements into new directories.
- `final/`: receipts from the reported run.
  - `suite.json`: 63/63 cases.
  - `measure-extract.json`: extraction and IPC measurements.
  - `index-*.json`: per-process search index measurements.
  - `summary.json`: the pre-registered targets, met or missed.
  - `*.exit`, `*.stderr.log`: exit codes and `/usr/bin/time -l` output.
  - `runtime.json`: host and source identity.
- `failed-first-suite/suite.json`: the first run, 62/63. The proof source was later corrected for four test-quality defects, described in the report. That earlier source was not preserved separately.

Corpora, binaries and databases are regenerable and deliberately absent; `final/index-corpora.json` records their hashes. Raw logs keep their original bytes. See `../../P54_02_PHASE2_WORKER_PROOF_REPORT_2026-10-16.md`.
