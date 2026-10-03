# A3 WebKit compatibility evidence — 2 October 2026

Sanitized receipts for [the implementation report](../../MAC_A3_COMPATIBILITY_IMPLEMENTATION_2026-10-02.md). Synthetic data only; no local paths, credentials or user data. Raw logs remain local under `.smoke/mac-a3-compat/`.

| File | Contents | SHA-256 |
| --- | --- | --- |
| `codex-final-focused-r4.txt` | Independent final Codex run: 53 focused tests pass; all 15 source hashes match; source acceptance recorded separately. | `0363566e96009e8e3befc22bd7385f331420e20a760e8727ac941753822db1f6` |
| `local-gate-summary-r4.txt` | **Final gate after Codex A3-R4 correction**: 655 frontend passed / 4 skipped, build, 246 Rust passed / 6 ignored, all commands exit 0. | `711c91ae36c385bb0cc31c2d63401befdc69a32b0cb15602ab84e6c22b35a33b` |
| `nested-lifetime-r4.txt` | The 8 R4 nested-lifetime regressions: the supplied one fails on the reviewed sources; negative control 5 failed / 3 passed; 53 focused A3 tests, Codex's diagnostic and the server-rendering bench pass on the corrected source. | `1b7420998d8213d8d3b142b5e2495553997684ef3e9697e7cc6a1ecebd4cf006` |
| `local-gate-summary-r1r3.txt` | Gate after Codex A3-R1–R3 corrections: 647 frontend passed / 4 skipped, build, 246 Rust passed / 6 ignored, all commands exit 0. | `cbfa677d337221ceced37943d88b6dfc253d3f3bc2c3ef9df5d1712185785bd2` |
| `stack-regressions-r1r3.txt` | The 8 modal-stack regressions: 7 failed / 15 passed on the reviewed hook; 45 focused A3 tests pass on the corrected hook; Codex's diagnostic passes verbatim (3 of 3). | `d233dac96952ce37e4fa4c01af69c01e18a075d8203edb460301cbc4aba7eef9` |
| `local-gate-summary.txt` | First-version sequential gate (reviewed hashes) on base `8b61d87` plus the local diff: per-command exit codes and counts, toolchain and SDK, entry bundle size. Also records the earlier attempt's type-check failure in a new test file. | `5ec3c6fec496221d9d14c257a5f8aa5068d6939fd78d7700bf4666bdce086b2b` |
| `negative-control-summary.txt` | The 37 new tests run against the original production modules: 34 failed / 3 passed (native-path regressions), with distinct failure messages. | `d4325d33d18dd688d4610e8841035749cb994e4a78f61e0f4da4184e4cebc0c3` |

These are capability simulations in Node/jsdom, not installed WKWebView or VoiceOver results.
