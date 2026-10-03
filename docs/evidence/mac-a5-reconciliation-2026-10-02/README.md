# A5 evidence reconciliation — receipts, 2 October 2026

Sanitized receipts for [the reconciliation report](../../MAC_A5_EVIDENCE_RECONCILIATION_2026-10-02.md). Synthetic data only; no owner backups, secrets or local paths. Large PDFs, archives and raw logs remain local (`.smoke/mac-a5-reconciliation/`).

| File | Contents | SHA-256 |
| --- | --- | --- |
| `codex-review-2026-10-03.txt` | Independent Codex acceptance: all hashes match, source unchanged, final focused checks 51 passed / 1 deliberate skip. | `02dba4168a1835402c5e7c2cd87fbdd92e152485eb5aaa8d58fa2641f0010f62` |
| `release-safety-and-archive-check.txt` | Release-safety suite counts and the 9-case synthetic credential-inspector CLI matrix (exit codes, no disclosure). | `08981beee0d67ea6a42c94bb5f2d92fc99c131519817faa5ce6432482e5a7a04` |
| `fixture-measurements.txt` | Fixture regeneration with the recorded hashes; Fixture C image distinctness, deflate ratios, ordered page IDs and a constant-value control. | `bcaa5e82cd2f14309af0c02f84b630014d36407f5fdfed3652a07139e592d676` |
| `native-split-evidence.txt` | Native PDF tests, the opt-in 54 MB split with /usr/bin/time -l, and deterministic Mac split sizes alongside the historical Windows values. | `3429fa45d5eb19f3c2ecf683caf7afda9fcf49da00cb01504f166b2dd9f53e7d` |
| `independent-reader-pdfkit.txt` | Apple PDFKit reads of sources and split outputs, with the tampering negative control. | `6a00f58abe0853ca98d83057a522acdb376d3031ba8c370e5dc6c082a5918b1a` |
| `pdfkit-reader.swift` | The scratch PDFKit reader script used (run with `swift`; not part of the app or build). | `61675014f2ccb8e876dd0936d0c08b0ee38d7cf38060c96f3906f198b8e83d89` |

Host: macOS 27.0.1 (26A434), base `b5bf8e0`, no source changes. These are source-level and system-framework checks, not installed-app results.
