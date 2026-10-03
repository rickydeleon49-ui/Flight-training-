# Mac Study Library baseline evidence — 2 October 2026

Sanitized evidence for [the baseline report](../../MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md). Synthetic data only; no local paths, credentials or user data. Raw logs remain local under `.smoke/mac-study-baseline/` (not uploaded).

| File | Contents | SHA-256 |
| --- | --- | --- |
| `results-r1r3.min.json` | **Corrected official run after Codex R1–R3.** Every measured step is verified before its sample is kept. Results are per step, with compute measured for the same view. Adds expanded displays to 1,000 cards. Minified copy of local `results-r1r3.json` (SHA-256 `dc4c7f828eb9e76be1cdde2a3a1a6d04381a30e4e56d32998ae2759c40f49e18`). | `d41c541e9eba1bdbbddb319c6f6367d70a5931523525228f80ffe422d6994791` |
| `local-gate-summary-r1r3.txt` | Sequential final local gate on the corrected source: 602 frontend passed / 4 skipped, 246 Rust passed / 6 ignored, all commands exit 0. | `9789b43937997236bf89eb7bb66b8d82d367ba62203e2e8c0816017028909ea6` |
| `results.min.json` | **First official run, superseded** (intermediate steps unverified; final-query compute only; kept as dated history). Contents: environment/source identity, per-tier fixture hash and coverage, every domain's raw samples, median/min/max/n, query counts, verified-result notes, Node memory samples. Minified copy of local `results.json` (SHA-256 `c43497c6770971b3319bd1aaddd5e6ebd4dda46dbdc1f782083d58c1a4171784`). | `11f8027bac395924d13441d9883ec9c50cad522f2f631a1edd493278b66c0327` |
| `original-harness-reference.min.json` | Unchanged previous harness at `a4339fc`, run once before editing. It shows defect H3: medium/large sort minimum 0.34/0.31 ms. It is a different workload and not a before/after comparison. Minified copy of local `original-harness.json` (`6b85693ca8bc203f5449bfd416f57a5b42c32ae91c591cfdc453d442f9622c09`). | `de697a51c10c6f19551020b57b93f6eb530563b3d60e73dec95bfaea546d2edd` |
| `local-gate-summary.txt` | First-task sequential gate (reviewed source): exit code, duration and counts per command, with toolchain and SDK identity. | `320c012563b1de3076891a5e9fa763c45bb50ad7885935ae5e61bcf08c27a1ce` |

Tested source: base `a4339fc720d8eac0f038402687e30233de141436` plus the uncommitted `src/perf` diff. The first-run files match the reviewed hashes; the `-r1r3` files match the corrected hashes listed in the report. Timing domain: Node 22 + jsdom with `node:sqlite`. It is not WKWebView paint, Tauri IPC, packaged startup or packaged-app memory. File status was mocked.
