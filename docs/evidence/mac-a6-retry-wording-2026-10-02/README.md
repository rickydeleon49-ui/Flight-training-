# A6 Gemini retry wording — evidence, 2 October 2026

Sanitized receipts for [the implementation report](../../MAC_A6_RETRY_WORDING_IMPLEMENTATION_2026-10-02.md). No local paths, keys or live requests. Raw logs remain local under `.smoke/mac-a6-retry/`.

| File | Contents | SHA-256 |
| --- | --- | --- |
| `regressions-and-negative-control.txt` | The four `a6_` Rust message-contract tests: 3 fail and the guard passes on the original production code (old texts quoted); 30 Gemini tests pass on the corrected source. | `7ac7cc2f020b4b7ecf612fca2e045420db8318da81e6148e46888fe021a09a0c` |
| `local-gate-summary.txt` | Final sequential gate on base `db15394` plus the local diff (macOS 27.0.1, SDK 26.5): 666 frontend passed / 4 skipped, build, 250 Rust passed / 6 ignored, all commands exit 0. | `9e9cfbf71b60e71e8fa827752bc0168d9c70df3ca20a66a5b514450e514c1f25` |

Unit-level message checks only; no installed app, network failure or live Gemini call.
