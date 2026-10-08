# C2 independent source acceptance evidence — 8 October 2026

C2SRC-R1/R2 accepted for integration. Source PR CI/merge is required; no installed/release claim.

- `submitted-source-hashes.json`: exact submitted 32-path structured manifest; implementation clone unchanged.
- `submitted/`: original submitted STATUS/handoff bytes before integration publication updates.
- `receipts/focused.*`: 112 passes / 1 skip, including three frozen diagnostics and nine new permanent tests.
- `receipts/typecheck.*`, `build.*`: independent integration checks, exit 0.
- `receipts/r2-semantic-control.*`: old copied-row behavior with new badge retained fails at actual assertion line 191; one fail/two skipped, exit 1. Source restored exactly.
- `integration-source-hashes.json`: final integrated application/document path hashes, distinct from submitted manifest.

Original reviewer diagnostics remain frozen in the earlier source-review pack. Correction evidence was copied verbatim and verifies 30 entries; original implementation evidence verifies 57. Submitted full sequential gate (2,808 frontend / 420 Rust) is reused explicitly; it is not presented as an independent rerun.

Temporary test/dependency link removed before commit. Verify SHA256SUMS from this directory. The source acceptance document explains the R2 evidence correction and additional bounded reads.
