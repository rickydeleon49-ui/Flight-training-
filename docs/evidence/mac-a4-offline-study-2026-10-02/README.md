# A4 saved study content offline — evidence, 2 October 2026

Sanitized receipts for [the implementation report](../../MAC_A4_OFFLINE_STUDY_IMPLEMENTATION_2026-10-02.md). Synthetic data only; no local paths, credentials or user data. Raw logs remain local under `.smoke/mac-a4-offline/`.

| File | Contents | SHA-256 |
| --- | --- | --- |
| `regressions-and-negative-control.txt` | The 11 A4 regressions: failing run before the fix (9 failed / 1 passed), negative control against the original page (9 failed / 2 passed), and focused runs on the corrected source. | `f7da029d52f25614d15735d3a3684968cd30ede6b283ab07a235445a09c20295` |
| `local-gate-summary.txt` | Final sequential gate on base `1ae6986` plus the local diff: 666 frontend passed / 4 skipped, build, 246 Rust passed / 6 ignored, all commands exit 0. | `b572c35cc6323be3ce9d6aa91f4f65a48d53f178a7b72208a05828fbf3b68d64` |

These are jsdom and real-SQLite tests with `fetch` and Gemini calls spied, not installed offline WKWebView or VoiceOver results.
