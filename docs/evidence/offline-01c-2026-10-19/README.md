# OFFLINE-01c evidence

Raw receipts for the [OFFLINE-01c report](../../OFFLINE_01C_REPORT_2026-10-19.md). Everything was run on an Apple M5 (32 GiB) under macOS 27. No app launch, profile, key or provider was involved.

- `corpus.txt`: the public-domain FAA corpus (file, bytes, SHA-256, faa.gov URL). The PDFs themselves are kept outside Git.
- `corpus.py`: runs the release worker on each corpus file and records outcomes, text size, counted peak, peak RSS, time and short text samples.
- `receipts/corpus-results.*`: the final results, for the binary in `release-worker.sha256`.
- `receipts/corpus-results-before-budget.*`: the 01a binary, where the PHAK breaches at page 449.
- `receipts/corpus-results-budget-cap384.*`: with the page budget and the old 384 MiB cap.
- `receipts/phak-pages-*.txt`, `phak-load.txt`, `afh-load.txt`: per-page content size and operation counts, and load-time memory.
- `receipts/synthetic-measurements.*`: the 01a synthetic cases, re-run on the final binary.
- `receipts/fmt.*`, `clippy.*`, `cargo-test.*`, `cargo-lock.*`, `release-build.*`, `helper.*`: the gate.
- `SHA256SUMS`: every file here except itself.
