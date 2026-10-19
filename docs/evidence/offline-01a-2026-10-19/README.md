# OFFLINE-01a evidence

Raw receipts for the [OFFLINE-01a report](../../OFFLINE_01A_REPORT_2026-10-19.md). Everything was run on an Apple M5 under macOS 27, with synthetic files only. No app launch, profile, key or provider was involved.

- `measure.py`: the measurement harness. It generates adversarial PDFs into a new scratch folder and runs the release worker through `/usr/bin/time -l`.
- `receipts/measurements.json` and `.log`: the final results, for the binary in `receipts/release-worker.sha256`. `measurements-first-binary.*` are the same cases on the binary built before app mode stopped counting; the worker's behaviour is unchanged between them.
- `receipts/app-mode-overhead*.txt`, all release builds:
  - `-counting-always`: the first build, with the counter always on. This is the failed gate.
  - `-intermediate`: after app mode stopped counting, before final formatting.
  - `app-mode-overhead.txt`: the final run.
- `receipts/prepare-rehash-before-fix.*`: the test that caught the `prepare` defect, run against the code before the fix (exit 101).
- `receipts/clippy-first.*`: the first strict clippy run (one `redundant_closure`), kept as it failed.
- `receipts/clippy.*`, `fmt.*`, `cargo-test.*`, `release-build.*`, `helper.*`: the final gate.
- `SHA256SUMS`: every file here except itself. Verify from the repository root with `shasum -a 256 -c docs/evidence/offline-01a-2026-10-19/SHA256SUMS`.
