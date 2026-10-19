# OFFLINE-02a measurement freeze

This directory's generator and frozen manifest are committed before running any search benchmark. Seed, all source/frame hashes, queries, filters, expected-hit hashes, sizes, timings, sample counts, nearest-rank percentiles and targets are fixed by the accepted rev6 design. Generated corpus text and exhaustive expected-hit files live outside Git in the task-recovery directory; public FAA URLs are in the manifest. Regeneration uses `generate.py --frames FRAME_DIRECTORY --out CORPUS_DIRECTORY --manifest OUTPUT`.

The inherited local extraction worker hashes differently from the older OFFLINE-01c receipt. Its actual hash and every new frame-stream hash are recorded in this freeze. The same hash-verified FAA inputs reproduce 497 readable PHAK pages. Only explicit worker mode was executed; no normal app launch or owner profile was used.

The command implementation uses one extra candidate solely as a look-ahead sentinel to distinguish exactly 2,000 matches from more than 2,000. It expands and groups only the first 2,000 in the approved order. The audit asserts the retained cap equals the exhaustive order's first 2,000. This bounded deviation is declared before timing.

The scratch-only release example `offline_search_measure` uses the production service admission, resolution, coverage, search and serialization path. Synthetic scaled files contain canonical page JSON with a `.pdf` fixture name; extraction is supplied by the frozen generator, never misrepresented as PDF extraction. Real corpus pages come from the worker. A separate PHAK worker supplies the concurrent extraction workload. Memory-pressure testing and minimum-spec acceptance remain excluded.

Every prescribed case will be reported, including misses or missing measurements. No target will be relaxed after observing a result. The release remains dormant.
