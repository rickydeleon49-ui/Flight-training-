# P54-02 phase 2: extraction worker proof and search contract

**Proof package for independent review. Not production search, not an engine adoption, not P54-02 acceptance.** Claude implemented it as the assigned implementer. Codex reviews and merges it; nothing is self-accepted.

**Base:** main d080efa. Limits, cases and targets were pre-registered and pushed in a7813e7 ([pre-registration](P54_02_PHASE2_PREREGISTRATION_2026-10-16.md)) before any proof code ran. The proof is one disposable Cargo example built from the locked dependencies (lopdf 0.42.0, rusqlite 0.32 / bundled SQLite, serde_json, sha2, unicode-normalization) and removed after the build. No application source, migration, dependency, lockfile, profile or production command changed.

## Results at a glance

- **Correctness suite: 63/63 pass** (final run, exit 0). The first run was 62/63; that failed receipt is retained. Run two cleared it after four test-quality fixes, described below.
- **Pre-registered targets: 8 of 10 met; 2 missed.** The misses are reported unchanged.
- **Hard memory cap: not available on this macOS lane.** `/bin/sh` refuses `ulimit -v` (exit 97, recorded). The sampled RSS watchdog stops a decompression bomb, but it overshot the 512 MiB cap by **66 MiB** in run one and **270 MiB** in the final run. It is a bounded-time kill, **not a memory bound**.

## Deliverable A: terminable extraction worker

**Process boundary.** Each document is parsed in a separate child process: the same binary in `worker` mode. The supervisor can kill, reap and record that process. A late Promise or thread is never just discarded. Each case records the real pid and exit/signal. Killed workers show `signal:9` and `reaped: true`. Across the suite's 25 workers, none was left alive or unreaped.

**Limits** (as pre-registered) and where each applies:

| Limit | Enforced at | Observed |
| --- | --- | --- |
| Input 128 MiB | `take(limit+1)` before parse | A smaller test limit refuses before parsing |
| Identity | Caller hash → worker hash of the bytes read → caller re-hash at publication | Replacement before the read and after the read are both refused |
| Page 64 KiB / total 16 MiB | After `extract_text` returns | A 3,315-byte compressed PDF's 1 MB page is refused. **Post-allocation: a result bound, not a memory bound** |
| Frame 512 KiB / stream 32 MiB | Supervisor reader, before buffering more | A 2 MiB line and a flood are refused and killed |
| Deadline | Supervisor wall clock | Bomb at a 1 s deadline: killed and reaped at 1,006.7 ms. Stall at 800 ms: 806.5 ms |
| RSS watchdog 512 MiB | `ps` sample every 25 ms | Bomb killed at 584–606 ms, **overshoot 66–270 MiB** |
| `ulimit -v` | Shell before exec | **Unsupported** (exit 97); the worker never ran |
| 2 concurrent workers | Supervisor admission | The 3rd request queues, then is admitted |
| 8 retained results | LRU | The 9th evicts the least recently used |

**Covered behaviors.**
- **Physical page order:** preserved despite reordered object ids.
- **Image-only page:** reported as `no_extractable_text`; that does not prove the page is a scan.
- **WinAnsi accented text:** "café" extracts as Unicode.
- **Malformed input:** a non-PDF and a 40%-truncated PDF are both reported as `malformed`.
- **Supersession and cancellation:**
  - A newer request kills and reaps a held older worker.
  - An old success or error settled before supersession cannot publish and starts no indexing.
  - A cancelled request publishes nothing.
- **Protocol failures:** an oversized line, invalid UTF-8, malformed JSON, a non-zero exit, no result, a flood and a stall each settle as a bounded failure.
- **Error privacy:** all 15 distinct outcome codes are plain codes with no path, content or credential.
- **Scratch:** owned scratch is removed; a non-owned file is untouched.

**Not covered: complex-font, CID or Unicode PDF text.** No licensed fixture was added and no private PDF was read. WinAnsi Helvetica only proves that simple encoding path. OCR is out of scope.

## Deliverable B: search semantics and cache adapter proposal

**Recommendation for owner review: native FTS5 in a separate, disposable derived-cache database, with a metadata-only fallback in browser mode.** Shared in-memory MiniSearch stays the documented alternative, using phase 1 evidence. No dependency is proposed. The case for FTS5:
- It is already linked through the locked rusqlite/libsqlite3-sys.
- It handles accent and Unicode folding by configuration.
- It keeps the index out of the WebView heap.

The browser build's sql.js has no FTS5 (phase 1). Browser mode keeps today's metadata filter and shows content search as unavailable. That also matches today's limitation: browser mode has no file import, so there is no PDF content to search.

**Contract, as prototyped and tested by result id:**

1. **Existing search unchanged.** The library box keeps its case-insensitive substring match over title/notes/topic/type/tags. Content search adds a separate result group. While the index is pending or unavailable, only the existing behavior runs.
2. **Query compilation.**
   - Input is NFKC-normalized. More than 256 characters, or more than 8 words or phrases, is refused.
   - Each word, and each `"quoted phrase"`, becomes one quoted FTS5 string, and the pieces are joined with AND.
   - Operators, column filters, `*`, `^`, `NEAR`, parentheses and `OR` have no special meaning. Tested inputs such as `title:metar`, `NEAR(…)`, `crossw*` and `OR` match only as literal words and never error.
   - Punctuation splits tokens, so `VOR/DME` is the phrase "vor dme". A query with no letters or digits leaves only the metadata filter.
3. **No prefix or fuzzy matching by default.** `crossw` does not match `crosswind`. Prefix search (`"term"*`) is a possible explicit opt-in, and typo tolerance would need a different engine. Both are product decisions; adding either silently would change semantics.
4. **Folding.** `unicode61 remove_diacritics 2` gives:
   - **Folded:** cafe = café = CAFÉ; zurich, naive and resume match their accented forms; METAR = metar; αλφα = ΑΛΦΑ.
   - **Documented gaps, asserted:** ß is not folded to ss, and an unspaced CJK run is one token, so a partial CJK query finds nothing.
5. **Bounds.** At most 50 results, with a truncation flag. Excerpts come from `snippet()` with **no highlight markup**, are capped at 320 characters, and are verified bounded on a 45 KB record. Source text such as `<b>` is returned verbatim and must be rendered as text, never as HTML.
6. **Destinations.**
   - A page hit carries `(contentSha256, physicalPage)` only while that hash is the material's current hash. Otherwise it has no destination, so an obsolete hash is never offered.
   - Guide and note hits never carry page destinations.
   - Materials missing from the library are dropped.
   - The accepted navigation contract (PR189) is the consumer; it is unmerged at this base, so it is recorded as a prerequisite and none of its source is copied here.
7. **Index lifecycle.**
   - **Replacement:** per-material, atomic.
   - **Pending updates:** an update re-checks "still current for this material and hash" inside its transaction before commit. A cancelled update, or a file replaced after extraction but before publication, rolls back and leaves the index unchanged.
   - **Deletion and duplicates:** deletion removes a material's records, and duplicate titles stay distinct by material id.
8. **Disposal and recovery.** `cache_meta` holds the version, a source fingerprint and the build state.
   - **Reopen:** keeps a complete cache.
   - **Rebuild:** a deleted cache rebuilds to identical result ids.
   - **Synthetic restore:** a new fingerprint disposes the cache.
   - **Crash mid-rebuild:** a real child process aborted mid-rebuild leaves `incomplete_build`, which is disposed and rebuilt.
   - **Crash mid-update:** a child aborted mid-update rolls back.

   These are proof controls, not an installed backup/restore acceptance. The cache must never be included in authoritative backups.

## Deliverable C: measurements (debug build; after 63/63)

Apple M5, 32 GiB, macOS 27.0.1, rustc 1.99.0, **Cargo debug example**. The load average was 6.7 at the start, because other local work was running. Stages are separate. Each search size has 3 fresh processes and 15 samples per query.

| Pre-registered target | Measured | Met |
| --- | ---: | :---: |
| 300-page extraction wall, median ≤ 10 s | 174 ms | yes |
| 300-page worker peak RSS ≤ 256 MiB | 6.2 MiB | yes |
| Bomb deadline stop+reap ≤ 1,500 ms (1 s deadline) | 1,007 ms | yes |
| Stall deadline stop+reap ≤ 1,300 ms (800 ms deadline) | 807 ms | yes |
| Spawn → first frame, median ≤ 100 ms | 1.4 ms | yes |
| IPC NDJSON parse ≥ 50 MB/s | 118 MB/s | yes |
| Cold FTS5 index, 10,000 materials ≤ 3 s | 1,749 ms | yes |
| **Warm literal query, 10,000, worst p95 ≤ 50 ms** | **61.8 ms** (`crosswind`) | **no** |
| Reopen + first query, 10,000 ≤ 300 ms | 62.7 ms | yes |
| **Whole-process peak RSS, 10,000 index run ≤ 256 MiB** | **284.9 MiB** | **no** |

**Index scale.**

| Materials | Records | Database | Cold index (median) | Peak RSS |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 600 | 1.3 MB | 11 ms | 11 MiB |
| 1,000 | 6,000 | 13 MB | 117 ms | 37 MiB |
| 10,000 | 60,000 | 120 MB | 1,749 ms | 285 MiB |

**Warm p50 at 10,000:**

| Query | p50 |
| --- | ---: |
| crosswind | 61 ms |
| metar | 41 ms |
| cafe | 35 ms |
| zurich | 35 ms |
| density altitude | 22 ms |
| "density altitude" (phrase) | 2.9 ms |

**Misses, explained as unverified hypotheses.**
- **Query p95.** Cost tracks the number of matches. `crosswind` occurs in most generated records, and BM25 ordering scores every match before `LIMIT`. Rare phrases take 3 ms. The bundled SQLite in a Cargo debug build is likely compiled without optimisation. A release-profile measurement is needed before any conclusion.
- **Peak RSS.** It includes loading the whole 72 MB JSON corpus as `serde_json::Value` plus records. That is test-harness cost, but the pre-registered target counts the whole process, so it stays a miss. A streaming load and a per-stage memory split would be the follow-up.

Extraction numbers come from generated single-font text pages, not real handbooks. No IPC to a WebView and no native painted interaction were measured. Those remain **pending**, together with the owner's production budgets.

## Unresolved limits and next decisions

1. **Memory isolation.** macOS gives no enforceable per-process cap here, and the sampled watchdog overshot by up to 270 MiB. Options for review:
   - (a) Pre-scan streams and decompress with a bounded inflater before lopdf sees them. This needs a direct flate dependency, which is an owner decision.
   - (b) Run extraction in a helper whose own allocator enforces a cap.
   - (c) Accept a deadline plus watchdog with a documented overshoot, and lower the watchdog threshold to leave headroom.
2. **Real documents.** Measure with licensed public FAA handbook PDFs (exact provenance and hash), plus complex-font, CID and Unicode fixtures.
3. **Release-build measurements and native painted interaction.** These need launch authorization and are not done here.
4. **Owner decisions:** the folding gaps (ß, CJK), prefix opt-in, the browser behavior, and FTS5 versus MiniSearch adoption.

## Reproduce

```bash
# Node 22 is not needed; Rust toolchain and the existing locked Cargo deps are.
python3 docs/evidence/p54-02-worker-proof-2026-10-16/run-phase2.py \
  --repo /absolute/path/to/repo \
  --scratch /absolute/path/to/NEW-scratch --out /absolute/path/to/NEW-receipts
```

The runner refuses existing directories and refuses to overwrite an existing example. It builds `--locked`, removes the temporary example even when the build fails, and runs measurements only after the suite fully passes. It also confirms that tracked application files are unchanged.

## Evidence and test-quality corrections

[Evidence](evidence/p54-02-worker-proof-2026-10-16/SHA256SUMS): the proof source, the runner, the final receipts (`final/`) and the first failed suite run (`failed-first-suite/suite.json`). The first run passed 62/63 on a pre-fix version of the source, which was not preserved separately. Four test-quality fixes were made before the final run; no product behavior was loosened:
1. The AND case's expectation omitted a fixture record that legitimately contains both words. A query that separates AND from OR was added.
2. The ß case had both spellings in one record, so it could not detect folding. They are now in separate records.
3. The `ulimit` case misread the shell's refusal as an allocation failure. That is now classified as `memory_limit_unsupported`.
4. The privacy check only inspected a fixed list of codes. It now checks every produced outcome. Cancelled outcomes are now refused at publication rather than retained.

No app launch, profile/key access, provider call, migration, installer, signing or release occurred.
