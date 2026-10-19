# OFFLINE-02a takeover and implementation report — 19 October 2026

**Disposition: native implementation and prescribed measurements completed; NOT ACCEPTED for integration.** Independent review and the cold-open/storage acceptance decisions remain. No merge, release, app launch, owner-profile access, provider call or scheduling migration was performed.

## Source and ownership

Claude reached its quota on `claude/offline-02a`, base `123b4fc` (accepted design rev6, PR #230), in `/Users/rickymac/code/Flight-training-offline-01`. Its four partial files were checkpointed byte-for-byte before edits; their exact hashes are in the evidence's `inherited-start.json`. The work continues on `codex/offline-02a-completion` in that same worktree. The unrelated dirty primary clone and its `.claude/settings.json` were preserved.

Codex reviewed the inherited code and became the implementer. **This report is not an independent acceptance of Codex's additions.** A separate reviewer must inspect the final source and receipts. No new implementation checkout was created.

The baseline reproduced **82 passed / 1 failed / 5 ignored** in the extraction unit subset. The failure expected title order for unequal BM25 scores. The approved contract orders relevance first: the shorter matching page is correctly first. Its expected order was corrected, with a direct rank inequality check; expected hits, excluded hashes/pages and the cutoff tie tests remain intact.

## What was finished

- Disposable cache schema 2: stable `search_passage` rowids, canonical NFKC text, FTS5 external content and transactional insert/delete triggers; immutable passages; publish/failure/replacement/prune consistency, corruption repair/disposal and killed-mid-publish recovery tests. Authoritative schema 15, migration SQL, checksum registry, lockfiles, bundle identity and release versions are unchanged.
- Literal word/phrase parser and all approved bounds; no prefix, fuzzy or alias behavior was inferred from screenshot text. NFKC is already settled in the accepted design.
- Bounded native search, duplicate-hash expansion after the ordered candidate cut, relevance/title/id/page ordering, safe snippets, result pagination, coverage and 64 KiB serialized response enforcement. One extra candidate is used only as a look-ahead sentinel; exactly 2,000 hits no longer falsely says more exist. This small deviation was declared before measurement.
- `search_offline_content` and `verify_offline_destination` registered at the native boundary. Only filtered, authoritative material rows with current-session verified hashes/stamps participate. Unsupported types, missing/unprepared/unverified files and unreadable/image/blank pages are excluded or counted explicitly. Managed paths are checked against the actual document directory, including symlinks.
- Fresh streamed destination hashing, a second authoritative path check and `ok`/`changed`/`missing` results. Same-size, same-mtime replacements and deleted rows are covered. This command opens nothing; the documented check-to-open race remains for the existing navigation controller to handle in 02b.
- Resolution, coverage, candidate reads and snippets share the dedicated search thread and one cache WAL snapshot. A concurrent publish can commit without mixing old candidates with new snippets. Old extractor-version passages are excluded explicitly. A replaced cache file invalidates the long-lived read connection.
- Synchronous admission before runtime waiting: one running request and one newest waiter, persistent request cancellation, command-entry deadlines, bounded response waiting, recurring SQLite interruption and retirement before the next request. No search waits for the hashing/extraction mutex. On the search path, full database/FTS validation runs once per file/process on the background search worker; state/schema markers remain checked on every cache open.

## Verification actually run

The complete sequential local gate passed all **9 steps**: frontend tests (**3,728 passed / 6 skipped**), typecheck, frontend build, schema-helper regressions (**26 passed**), native tests, strict Clippy, formatting, lockfile synchronization and whitespace checks. The full native receipt has **781 unit + 12 service + 15 worker tests passed; 11 ignored**. A final real-PDF composition test was added while that compilation was already in progress, so the final **service suite was rerun: 13/13 passed**. That gives **809 distinct native tests** across the valid receipts, without claiming the earlier full run contained the added case. The unchanged 781-unit/15-worker receipts are reused; lint/format include the final integration file.

The new composition case creates a real text PDF and an image PDF, runs the actual extraction child, publishes the index, searches through the native boundary, asserts the exact material/page and image exclusion, verifies the destination, proves the authoritative database bytes were unchanged, and rejects replacement bytes. It never launches the desktop UI.

An ordinary release build of the scratch harness, with the offline opt-in absent, must refuse both commands before creating a root. The feature proof records that `rusqlite/functions` exists only in the dev graph; the normal application graph and lockfile remain unchanged. See the completed gate receipts rather than inferring release enablement from the measurement opt-in.

Preserved failures: the inherited ordering failure; a development interruption-proof failure after response waiting was made bounded (the test now independently requires SQLite retirement within the original 100 ms allowance); an initial gate refused to run because this worktree had no `node_modules` (exit 127). Dependencies were restored with `npm ci`; no test suppression or lockfile change was used. Rustup's missing `libLLVM.dylib` produced strip warnings in optimized harness builds; builds exited 0. No release artifact was produced from them.

## Frozen measurements and remaining gates

The generator, seed, every corpus/query/filter/expected-set hash and targets were committed at **`1f927b5` before timing**. Real text came from the hash-verified FAA PHAK and AFH chapters. The local worker's actual executable hash differs from the older 01c receipt; this is disclosed, and the new worker/frame hashes are frozen. The PHAK again yielded exactly 497 readable pages.

All managed benchmark fixtures contain deterministic page JSON, including the real-text corpora; they are not represented as original PDF binaries. Original PDF provenance is recorded separately. The native composition test above independently covers actual PDF bytes through search and destination hashing.

**All 90 exhaustive reference hit sets and all 90 capped prefixes match.** Five corpora, three fresh processes each, every prescribed query/filter pair, 45 timed samples per cell: **4,050 timed commands, no errors/timeouts** in the final run. Seven Unicode fixtures and two exclusions pass on bundled SQLite 3.46.0. Every case, hardware detail, raw sample and missed target is retained in [the evidence](evidence/offline-02a-completion-2026-10-19/BUDGETS.md).

Key final observations on Apple M5 / 32 GiB / macOS 27.0.1, release Rust 1.99.0, SDK 26.5:

| Check | Result | Contract |
| --- | ---: | ---: |
| PHAK index | 24.41 ms | ≤1,000 ms |
| 10k index rebuild | 813.58 ms | ≤5,000 ms |
| Worst 10k warm p50 / p95 | 14.93 / 15.37 ms | ≤20 / ≤50 ms |
| Worst 30k warm p95 | 38.44 ms | ≤150 ms |
| Concurrent 10k warm p95 | 13.36 ms | ≤100 ms |
| 30k search-process peak RSS | 33.4 MiB | ≤256 MiB |
| Cold 30k validation | 2,042.01 ms | ≤1,000 ms, otherwise background |
| 10k reopen + first query | 570.97 ms | ≤300 ms — MISSED |
| Added index / canonical text | 1.693×–2.663× | ≤1.0× — MISSED |

Validation runs in the background before the search connection can execute SQL; the 30k threshold is still explicitly reported as missed. The first benchmark run repeated full quick checks and accidentally included a cold first query in the concurrent warm case (584 ms). That run is preserved. The corrected run uses the same frozen inputs and targets, once-per-process validation, and the specified warm-up before starting the real worker window. All 15 accepted concurrent samples ended before the observed end frame and publish start; none were discarded.

**Do not merge this as an accepted 02a or start 02b merely because functional tests are green.** The two remaining acceptance tasks are recorded at the top of ROADMAP: cold-open latency and storage. Retaining full canonical text in `search_passage` as well as an FTS index inherently adds more than a text-only payload; meeting 1.0× may require an approved representation change. Neither a looser denominator nor a silently relaxed target is acceptable.

Release gates remain unchanged: no workflow enables either offline flag; minimum-spec/pressure, installed search/no-provider, navigation/painted latency and final release acceptance are unverified. No UI, saved-record search, homework or export work was started.

## Reviewer entry point

Read [the reviewer handoff](OFFLINE_02A_REVIEWER_HANDOFF_2026-10-19.md), verify `source-hashes.json` and `SHA256SUMS`, then inspect the actual source. The full failed and corrected receipts are distinct. Working files and preserved private corpora can be reused for focused follow-up; no need to rerun unrelated frontend gates for a native-only correction.
