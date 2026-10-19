# OFFLINE-02a budget amendment proposal — owner decision pending

**Historical proposal.** The owner subsequently approved only the 750 ms/3× amendments; see [the decision](OFFLINE_02A_BUDGET_OWNER_DECISION_2026-10-19.md). The proposed 3-second 30k limit below was not adopted. The original frozen targets and failed receipts remain unchanged. No acceptance or merge follows from this proposal.

## Recommendation

Retain the complete SQLite FTS5 index and its canonical external content. Approve the bounded budgets below and provide an explicit background-initialization state before the first search. Keep every correctness, validation, byte, memory, warm-query and no-provider requirement intact. This avoids a new index representation solely to satisfy a target that excludes the cost of storing the required full canonical text plus an inverted index.

| Criterion | Original | Proposed | Observed before self-review fixes |
| --- | --- | --- | --- |
| Added index / canonical text bytes | ≤1.0× | ≤3.0×, on every frozen corpus | 1.693×–2.663× |
| 10k full reopen/validation + first query | ≤300 ms | ≤750 ms, worst of 3 fresh processes | 570.97 ms |
| 30k full cold validation | ≤1 s, otherwise background | ≤3 s; always background before search, with explicit initialization status | 2,042.01 ms |

All other targets stay unchanged: 10k warm p50/p95 ≤20/50 ms; 30k p95 ≤150 ms; command-entry search deadline 2 s; concurrent 10k p95 ≤100 ms; response ≤65,536 bytes; search-process peak RSS ≤256 MiB; PHAK index ≤1 s; 10k rebuild ≤5 s. The 2 s search deadline is not extended: initialization must be distinguishable from a running search and cannot publish partly validated results.

Full canonical text alone requires its byte payload, before any inverted-index pages, row metadata or page padding. The current approved schema stores it in `search_passage`; its FTS tables add a second structure. The measured PHAK overhead is 2,990,080 bytes for a 56,133,125-byte original PDF (about 5.3% of that PDF's size). The denominator remains canonical text, not the PDF size; this comparison explains practical impact only.

The alternative is to keep the original budgets and design a materially different representation, such as compressed external content or a contentless index with a new snippet path. That needs a separate design review, potentially a production SQLite function feature, cache disposal/schema handling and a new set of corruption/snippet/consistency proofs. Do not implement it as an unreviewed patch.

## Required approval and verification

The owner must explicitly choose the amended budgets before they become acceptance criteria. Record the owner's words and date in a separate decision note; never alter the original manifest or call its failed targets passed. Re-run the unchanged frozen workloads on the final corrected source, report both original and amended verdicts, and obtain independent source review before normal PR/CI integration. Release enablement and minimum-spec/installed acceptance remain separate.
