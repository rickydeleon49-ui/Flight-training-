# P54-02 local search: exploratory capability and extraction proof

**Phase1 evidence only. Production search, engine selection and P54-02 acceptance remain pending.** Source3266f193 (accepted P54-03), no application changes. The approved queue allows this measurement before adopting an engine. MiniSearch was evaluated only in disposable scratch, never installed in the application.

## Concrete findings

1. **Native FTS5 works; current browser FTS5 does not.** The actual locked native SQLite3.46.0 build creates an FTS5 table. Cargo's dependency tree shows rusqlite and the Tauri SQL plugin share libsqlite3-sys0.30.1. Actual sql.js WASM SQLite3.49.1 returns `no such module: fts5`. A shared FTS5 migration would therefore break browser mode; any native cache pilot must remain separate from authoritative/shared schema. This is runtime library evidence, not an installed-app or minimum-OS claim.
2. **The existing PDF library can preserve simple physical-page identity, but the extraction bound is not proven.** A generated Helvetica/image-only/oversized-text fixture with reordered object ids maps source text to physical pages1/3 and returns no extractable text for page2. A3,034-byte compressed PDF produces1,000,023 bytes on page3. lopdf0.42.0's `extract_text` returns the complete allocated page string before the caller checks its length; a post-extraction64KiB output budget is insufficient to prove memory/cancellation safety. Do not start production extraction on that assumption. One malformed control is refused; this does not prove arbitrary-PDF safety or complex-font/Unicode quality.
3. **Default query semantics differ.** The two engines return identical result-id sets for crosswind, density altitude, metar and café in every repeat. Searching unaccented cafe matches accented café with native FTS5's default tokenizer, but MiniSearch's default returns0. Accent folding, prefix/fuzzy behavior and user query syntax need a deliberate contract, not accidental engine defaults.
4. **Both can update/delete/reload derived data in isolation.** Controls prove record edits replace old terms and hashes, deletion removes them, and reloading/reopening retains the restored record. This does not prove the app's actual replacement/restore transaction lifecycle or cancellation.

## Exploratory measurements

AppleM5,32GiB, macOS27.0.1, Node22.23.3, existing Cargo debug build with SDK26.5. Identical generated100/1,000/10,000-material corpora:4 synthetic page records,1 guide and1 note per material (600/6,000/60,000 records, at most38,425,877 JSON bytes).3 fresh process repeats/engine/size,15 samples/query;36 result-set equality checks. These are repeated-word synthetic records, not a real handbook PDF corpus.

| Materials / records | Engine | Cold index median ms | Warm crosswind median ms | Whole-run peak RSS MiB |
| --- | --- | ---: | ---: | ---: |
| 100 / 600 | Native FTS5 | 3.84 | 0.115 | 6.8 |
| 100 / 600 | MiniSearch7.2.0 / Node | 11.60 | 0.051 | 56.9 |
| 1,000 / 6,000 | Native FTS5 | 33.20 | 1.446 | 17.5 |
| 1,000 / 6,000 | MiniSearch7.2.0 / Node | 74.98 | 0.452 | 135.4 |
| 10,000 / 60,000 | Native FTS5 | 383.43 | 15.813 | 90.9 |
| 10,000 / 60,000 | MiniSearch7.2.0 / Node | 846.29 | 3.106 | 791.2 |

Cold index time starts after JSON load and excludes PDF extraction. Native includes the scratch DB transaction/commit; MiniSearch construction excludes later JSON serialization. Warm queries return/rank all matches, with different language/return-object overhead; no IPC or painted UI timing. Prefix measurements use different result shapes and must not be compared. Do not interpret the table as a production winner or a promised speedup.

Peak RSS is the whole process workload, including corpus and query arrays; MiniSearch also serializes and loads a second full index. At10,000 materials its median additional post-index JS heap is72.87MiB, distinct from the791.2MiB whole-run peak. Native database is47,050,752 bytes; MiniSearch serialized index is54,316,042 bytes. These are not authoritative backup artifacts. No performance thresholds were pre-registered for this exploratory phase; phase2 must define targets before an acceptance comparison.

## Candidate provenance; no adoption

[MiniSearch](https://github.com/lucaong/minisearch) snapshot:6,173 stars, MIT, latest registry7.2.0, repository pushed2025-09-16. The exact registry archive passed its SHA512 integrity before extraction/execution; no lifecycle script ran. Extracted ESM78,014 bytes /18,187 gzip bytes is not an application bundle delta. Production manifests, locks and bundle are unchanged. Its existing fuzzy/prefix API is a candidate capability, not approved product behavior. [SQLite FTS5 documentation](https://sqlite.org/fts5.html) describes the other candidate; actual availability is established by these runtime probes rather than documentation alone.

## Decision and remaining scope

**No engine selected.** First prove bounded extraction/cancellation and realistic document fidelity. Then measure a native cache adapter and optional browser strategy with fixed targets, chosen query semantics and real native interaction. FTS5 is a viable native candidate; the current browser build needs a fallback. MiniSearch is a candidate if shared in-memory search is justified, with serialization/reload peak memory included in its budget.

[Complete source, inputs and raw receipts](evidence/p54-02-search-evaluation-2026-10-16/README.md). Corpora, archive/vendor code, databases and native binary are not committed; the four owned probe sources and corpus hashes reproduce them. Temporary source was removed. No app/profile/key/provider/installer/signing/release operation occurred.

Next assignment: `docs/P54_02_EXTRACTION_WORKER_PROOF_PROMPT_2026-10-16.md`. M4 corrections#194 and export corrections#195 require independent review; their source is not accepted by this report.
