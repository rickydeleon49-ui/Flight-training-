# Slice B independent review evidence — 4 October 2026

Reviewed local source: /Users/rickymac/code/Flight-training-pr70-integration, branch codex/structured-study-import-slice-b, HEAD/base 6b418ee3c92f0ba64952d35278aa7c9999f9c824. This directory publishes review evidence, not the unaccepted application source.

## Frozen handoff

- implementation-report.txt: byte-for-byte mirror of the implementer's local README.
- submitted-SHA256SUMS.txt: byte-for-byte mirror of the 48-entry implementation receipt.
- Receipt identity: e3652df6c83649ece09414428b0ea750efb35b5d6ff80ebb693359985d4cf16c.
- All 48 paths verified before and after review diagnostics. Paths refer to the implementation checkout; not all are published on main.

## Independent executions

Scoped Node 22.23.3 and rustup stable; native SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk.

| Output | Command and result |
| --- | --- |
| slice-b-review-focused-ts.txt | npm test -- src/services/studyPackets.test.ts src/data/structuredImport.test.ts src/data/repositories/importStudyPacket.test.ts src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts src/pages/StudyLibrary/MaterialDetailImport.test.ts; exit 0, 110 pass |
| slice-b-review-focused-rust.txt | cargo test --locked study_packet:: in src-tauri; exit 0, 60 pass |
| slice-b-review-preview-diagnostic.txt | npm test -- src/pages/StudyLibrary/ImportStudyPacketDialog.codex-review.test.ts; exit 1, two expected failures reproducing SB-R1 |
| slice-b-review-nfc-diagnostic.txt | cargo test --manifest-path src-tauri/Cargo.toml --locked codex_review_nfc; exit 101, two expected failures reproducing SB-R2 |
| slice-b-review-nfc-ts-control.txt | npm test -- src/data/structuredImport.codex-review.test.ts; exit 0, two pass for the same NFC inputs |

Diagnostic source is stored as .txt to avoid adding failing tests to the documentation PR:
- slice-b-preview-diagnostic.ts.txt: standalone UI test copied from the original helper setup, using the real library/provider and disposable node:sqlite.
- slice-b-native-diagnostic.rs.txt: append these two test functions to the existing study_packet_save_tests.rs for reproduction.
- slice-b-ts-nfc-diagnostic.ts.txt: standalone browser validator controls.

The temporary files were removed, and native test source was restored byte-for-byte. Only diagnostics/results were published; no application source was edited by Codex. An initial native diagnostic command omitted --manifest-path at repository root and failed before any tests; it was corrected and excluded from test counts.

Original full-gate and mutation successes are implementer evidence. Codex did not repeat the full matrix with blockers outstanding. No installed/account/release activity occurred. See the [review](../../STRUCTURED_STUDY_IMPORT_SLICE_B_REVIEW_2026-10-04.md) and [active assignment](../../STRUCTURED_STUDY_IMPORT_SLICE_B_CORRECTIONS_PROMPT_2026-10-04.md).

existing-production-nfc-library.txt records the read-only normal production dependency chain; direct use does not introduce a newly resolved production package.
