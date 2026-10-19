# OFFLINE-02c saved-content search: measurement evidence

This is the measurement for addendum revision 4, §6. See `../../OFFLINE_02C_REPORT_2026-10-19.md`.

**What was frozen before timing,** in order of commits:
1. `generate.py` and the harness, `src-tauri/examples/offline_saved_measure.rs`.
2. `frozen-manifest.json`. It records:
   - seed 20261019;
   - the PHAK frames hash `f5043d05…` (524 pages, 497 text);
   - the corpus hash;
   - 28,600 records and 16,334,696 canonical octets, under the 24 MiB limit;
   - the queries and expected counts;
   - the schedule and targets.

**Kept outside Git:** the corpus database and the PHAK frames, in `~/code/.offline-02c-measure`. Their hashes are in the manifest.

**Run 1** (`receipts/run1-identity-key-bug/`) is preserved unchanged. It flagged queries 0 and 5 as inexact although the counts matched: the harness compared linked questions under their material, while the frozen identities group all questions under "". The harness fix touched only that comparison. No search code, target, query, corpus or schedule changed.

**Run 2** gives the results:
- `receipts/process-{1,2,3}.{json,log,time}`, with `/usr/bin/time -l` for peak RSS;
- `results.json`: verdicts, and nearest-rank p50/p95 over 45 samples per query and mode.

**Hardware:** `receipts/system.txt`. This is a release build, with the harness binary's hash in `receipts/harness-2.sha256`.

**One target missed.** The cached p50 for the worst-case query, "the" (27,062 matches), is 28.3 ms against 20 ms. Its p95, 29.0 ms, is within 50 ms. Every other target passes.
