# GENREL-INST-R1: installed failure and managed-source correction

Implementation evidence, not independent acceptance. Source base: accepted main `18960602f0c396e53a62e31619759dcba9f5b8f9`. See the top-level report and reviewer assignment dated 18 October 2026.

- `installed-v056-failed/`: curated synthetic failure, native journal, imported row, screenshot/AX, candidate identities, original release-script/build receipts, successful schema14→15 comparison and sanitized profile-return verdict. No keys, real database or original-profile metadata inventory is included.
- `gate/realistic-import-path-red.*`: tests-only realistic path correction against the uncorrected production function; one existing 20/40/60 batching case fails with the exact installed error, exit 101. This is intentional RED evidence.
- `gate/batches-focused.*`: corrected production source, 16 batch tests pass, including the unchanged full batch suite plus three permanent regressions.
- `gate/toolchain-*`, `gate/frontend-default-failed.*`, `gate/node22-sanitized-child-failed.*`: failed Node startup/library and environment-sanitized subprocess receipts. The full failed run was 3698 pass / 1 fail / 6 skipped; do not call it green or a proven timing flake.
- `gate/node24-*`: preserved substitute-runtime failure (eight unchanged SQLite fixture edits refused), 3691 pass / 8 fail / 6 skipped. No fixture or database guard was relaxed.
- `gate/node-runtime-provenance.json`: official standalone Node22.23.3 tarball and official checksum listing match; task-private runtime only.
- `gate/completion-summary.json`: final sequential source-check commands, exits and timing on official standalone Node22.23.3, rustup1.99.0 and SDK26.5. The earlier `summary.json` reflects its failed environment run and is historical.

`source-hashes.json` freezes the final submitted input paths and distinguishes protected version/lock/migration identities. `SHA256SUMS` covers evidence files except itself. Verify those manifests before reusing receipts. Application-source changes are confined to the batch source guard/test fixtures and initial study-aid copy; policy retirement is separate from an actual version cut.

Installed v0.5.6 was local ad-hoc only, no Developer ID or notarization. Gatekeeper rejected (3); no bypass was attempted. Its actual live upload and generation never began. A connected key is not a generation pass. Physical administrator-account behavior is not standard-account, minimum-macOS or VoiceOver acceptance. Publication and the feature loop remain held.

Final result: ten final source checks exit 0; focused batch suite 16/16; frontend 3699 passed / 6 skipped; Rust 686 passed / 6 ignored; isolated preflight 34/34. No corrected installer has been built: the five application version files are still 0.5.5, and 0.5.7 is candidate policy metadata only. Independent source review and exact-head CI precede the new installed/live test.

Raw command logs are gzip-compressed without changing their decompressed bytes. `RAW_LOG_SHA256SUMS` freezes original raw log contents. The initial submitted whitespace check rejected whitespace inside captured tool output; its receipt is preserved. No whitespace checker or project-wide exception was added; compression keeps evidence verbatim.
