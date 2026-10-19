# OFFLINE-02a measured budgets

Final run: unchanged frozen corpora and targets; optimized validation once per file/process and the required warm-up before the concurrent window. Round 1 is preserved separately. All 90 exhaustive reference sets and all 90 capped prefixes match. Every cell has 45 timed samples.

| Corpus | Index ms | Worst warm p50 / p95 ms | Validation ms (max of 3) | Reopen + query ms (max) | Added index / canonical bytes | Peak search RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| phak | 24.41 | 0.91 / 1.00 | 19.51 | 21.00 | 2,990,080 / 1,766,334 (1.693×) | 14.7 |
| afh | 2.41 | 0.87 / 0.97 | 6.55 | 7.89 | 581,632 / 218,417 (2.663×) | 14.0 |
| scaled-1000 | 58.08 | 1.63 / 1.76 | 47.30 | 49.77 | 6,672,384 / 3,169,283 (2.105×) | 16.0 |
| scaled-10000 | 813.58 | 14.93 / 15.37 | 556.97 | 570.97 | 61,239,296 / 31,550,909 (1.941×) | 33.0 |
| scaled-30000 | 2329.44 | 37.66 / 38.44 | 2042.01 | 2074.31 | 217,554,944 / 94,858,640 (2.293×) | 33.4 |

Concurrent 10,000-page common query: p95 **13.36 ms**, 15 accepted samples, 0 discarded runs; all samples ended before both the observed worker end frame and the recorded publish start.

| Acceptance criterion | Result |
| --- | --- |
| PHAK index ≤1 s, 10k rebuild ≤5 s | PASS |
| 10k warm p50 ≤20 ms, p95 ≤50 ms, every filter/type | PASS |
| 30k warm p95 ≤150 ms, worst query ≤2 s | PASS; no timeout/error in any timed cell |
| Concurrent 10k p95 ≤100 ms | PASS after correcting cold-first-query harness error; original 584 ms receipt retained |
| Serialized response ≤65,536 bytes | PASS in all measured commands; adversarial bound also covered by unit tests |
| 30k search-process RSS ≤256 MiB | PASS (search process only; separate extraction worker excluded as specified) |
| Cold 30k open/validation ≤1 s | MISSED; validation runs on the dedicated background search thread before any search statement is admitted |
| 10k reopen + first query ≤300 ms | MISSED |
| Added index storage ≤1.0× canonical text | MISSED for every corpus |

**Disposition:** implementation and measurement complete; acceptance is NOT granted. The 10k cold-open and storage budgets need correction or an explicit approved design amendment before this slice can be accepted. No target was retuned. The 30k threshold invokes the design’s background-validation fallback, but its measured delay remains visible.

Timing excludes Tauri IPC/painting, the initial fixture setup, storage initialization and session file hashing. The cache-open measurement is explicit; reopen is that cold validation plus the first fully serialized bounded native search, with session hashes established before the search. Raw receipts show both timings separately.

Index time is eligible `search_passage` inserts plus commit using the production external-content schema/triggers; it excludes extraction. Storage subtracts a separately VACUUMed copy without the search tables, triggers and FTS index. Peak RSS is `/usr/bin/time -l` per fresh harness process, not the extraction worker and not a minimum-spec result.

The concurrent pipeline launches the real PHAK worker, records its first page/end frames, completes all samples in that window, then publishes those pages using `Cache::publish`. A separate unit test holds the real service hashing/extraction mutex while a search completes. This is not an installed-app or memory-pressure test.
