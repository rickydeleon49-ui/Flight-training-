# OFFLINE-02: search a subject — design and pre-registration — 19 October 2026

**Status: proposal for review. Nothing here is implemented.**

The roadmap requires the query rules, limits, fallbacks and measurement targets to be written down before the search engine is built in ([roadmap](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md), OFFLINE-02 "Acceptance and engine decision"). This document does that.

## 1. Engine decision

**Owner decision, 19 October 2026: SQLite FTS5.** The [P54-02 evaluation](P54_02_SEARCH_EVALUATION_2026-10-16.md) showed:
- the app's locked native SQLite (3.46.0, through `libsqlite3-sys` 0.30.1, shared by `rusqlite` and the SQL plugin) creates FTS5 tables;
- the browser build's sql.js does not.

So, following that evaluation's recommendation and the roadmap's restriction:
- **The index is native-only and disposable.** It lives in the offline content cache (`content-cache.db`, OFFLINE-01a). It never goes into her authoritative database, a migration, or a backup.
- **Losing it loses nothing.** It can always be rebuilt from extracted page text and her records.
- **Browser mode keeps today's search.** The Study Library filter and QuickFind still search title, notes, tags, topic and type, and the page says that document text isn't searched there.
- **No new dependency.** FTS5 ships in the SQLite the app already bundles.

## 2. Slices

| Slice | Delivers | Ships dormant? |
| --- | --- | --- |
| **02a** | Native FTS5 index over prepared PDF pages, a bounded search command, and the measurements in §6 | Yes: it depends on extraction, which stays off in releases until the memory cap is accepted |
| **02b** | Search UI on the Study Library page: grouped results, snippets, coverage line, keyboard navigation, page destinations | Yes, same flag as 01b |
| **02c** | Saved study content in the same search: guide sections, card fronts and backs, practice-question **stems**, personal notes, instructor questions. Homework joins when HW-01 ships | The study-record part could ship on its own, since it doesn't need extraction. Decide at 02c |
| **02-OCR** | Scanned pages (separate, gated subtask in the roadmap) | — |

The rest of this document fixes the contract for all three slices, so 02a's index and command don't have to change later.

## 3. Query semantics

**What she types is never passed to FTS5 as query syntax.** The app parses it into a fixed shape and builds the `MATCH` expression itself.

**Parsing:**
- **Words:** text outside double quotes is split on whitespace. Every word must match, so the words are joined with AND.
- **Phrases:** text inside a pair of double quotes (`"density altitude"`) must appear as consecutive words. An unmatched quote is treated as ordinary text, not a syntax error.
- **Literal operators:** every word and phrase is emitted as an FTS5 string literal (`"…"`, with inner quotes doubled). So `AND`, `OR`, `NOT`, `NEAR`, `*`, `^`, `:`, `-`, `+` and parentheses are just text. Characters the tokenizer treats as separators simply separate words, so `V-speeds` means the words `v` and `speeds` next to each other.
- **No prefix or fuzzy matching in 02a/02b.** `cross` does not find `crosswind`. Prefix-as-you-type and typo tolerance are owner choices (§8). Adding them later doesn't change the index.
- **Empty query:** a query with no indexable word (only punctuation, for example) returns "Type a word to search", not every document.

**Folding** uses the tokenizer `unicode61 remove_diacritics 2`:
- **Case:** `METAR` = `metar`.
- **Accents:** `cafe` = `café`; `remove_diacritics 2` also folds the combining-mark cases that mode 1 misses.
- **Known limits** (asserted by tests, so they're visible, not hidden):
  - `ß` is not folded to `ss`;
  - ligature glyphs like `ﬁ` are not folded to `fi`;
  - CJK text with no spaces is indexed as one long token, so it matches only whole runs.
  The ligature limit matters for PDFs: OFFLINE-01c showed some FAA text arrives with ligatures. **Proposal:** apply Unicode NFKC to page text at index time, and to the query. That folds `ﬁ` and full-width forms without touching the stored text. **No new dependency:** `unicode-normalization` 0.1.25 is already a direct dependency of the app (`cargo tree -i unicode-normalization`).
- **Probe, 19 October 2026,** run on macOS's `sqlite3` 3.54 with the same tokenizer, before 02a asserts it on the bundled 3.46:
  - `cafe` matches `café`;
  - `strasse` doesn't match `Straße`;
  - `final` doesn't match `ﬁnal`;
  - `"V-speeds"` matches;
  - `"AND"` matches literally;
  - `日本語` doesn't match inside `日本語のテキスト`.

**Limits** (refused with a plain message, never truncated silently):

| Limit | Value |
| --- | --- |
| Query length | 200 characters |
| Words plus phrases | 8 |
| One word or phrase | 64 characters |
| Results per page | 20 groups (materials), at most 3 passages each |
| Deepest page of results | offset 200 groups; past that, "Narrow your search" |
| Snippet | at most 240 characters of plain text around the match |
| One response | at most 64 KiB serialized (asserted) |

**Ranking and order:**
- passages rank by FTS5 `bm25`;
- a material ranks by its best passage;
- ties break by material title, then material id, then page number, so the order is stable for the same index and query.

**Snippets:**
- built with FTS5 `snippet()`, using U+E000 and U+E001 as match markers;
- page text is stored with any U+E000/U+E001 removed, so a marker can only come from `snippet()`;
- the UI renders a snippet as **text nodes**, splitting on the markers to add `<mark>` elements. It never uses `innerHTML`.

## 4. What is searched, and coverage

**What counts as a destination** (02a): a PDF page is searchable only if all of these hold:
- the material's file was **verified this session**, so its SHA-256 is the one in the service's verified map;
- that hash's extraction is `complete` for the current `EXTRACTOR_VERSION`;
- the page's outcome is `text`.

Pages that are `text_unreadable`, `unknown`, `failed`, `image_only` or `blank` are not indexed. They show up in coverage instead.

**Stale hashes are never offered.** The index is keyed by content hash, not material. At query time the command searches only the hashes currently verified for her materials. So a replaced file's old text can still be in the cache, but it can't be a result. Several materials with the same bytes, such as a duplicate import, each get the hit.

**Coverage line.** Every search response carries category counts. This keeps "no match" separate from "some documents haven't been prepared":
- **searched:** how many documents, and how many pages (`searchable` or `partial`);
- **not prepared yet:** includes "not checked this session";
- **could not prepare;**
- **file missing;**
- **unsearchable pages** in partly searchable documents, split into images versus other.

Example: "No matches in 12 documents (3,041 pages). 4 documents aren't prepared for offline search yet."

**Revisions and splits.** Each material is its own source with its own title, so a split part and its original are separate results. The result shows the material title and the page number **in that file**. When a split part's page maps to an original page, the existing lineage gives "p. 3 (p. 103 of the original)", reusing `SplitLineageDetails`' mapping. Results never merge text across materials into one answer.

**Practice answers (02c):** only question **stems** are indexed. Options, correct answers and explanations are not, so a snippet can never reveal an answer during an attempt.

## 5. The index (02a)

**Schema.** These go in `content-cache.db` beside the OFFLINE-01a tables. Cache schema 1 becomes 2, and an older cache is rebuilt, which is fine because it is derived data:

```sql
CREATE VIRTUAL TABLE page_fts USING fts5(
  text,
  content='page_text', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

- **External content:** the FTS index refers to `page_text` rows, so the text isn't stored twice.
- **Kept in step with `page_text`:** rows are inserted in the same transaction that publishes an extraction, and removed when `prune` deletes a hash.
- **Recovery:**
  - a crash mid-publish leaves the cache's `state` not `complete`, so the cache is disposed and rebuilt (existing 01a behavior);
  - `INSERT INTO page_fts(page_fts) VALUES('integrity-check')` runs when the cache is opened after an unclean shutdown.
- **Indexed text:** only pages whose outcome is `text`. Rows for other outcomes are written to `page_text`, but not to the FTS table.

**The command:** `search_offline_content(query, offset)`.
- It is gated like `prepare_offline_content`.
- It returns `{ groups, coverage, nextOffset }`.
- It runs on the executor thread's read connection, not the main thread, and is bounded by the §3 limits.

## 6. Measurement plan and targets (pre-registered)

This reuses P54-02's structure. **What changes from P54-02:**
- the build is a **release** build, not debug;
- the corpus is page text, not synthetic material records;
- hardware is recorded: Apple M5, 32 GiB; the minimum-spec Mac is still pending, as for the 01c cap.

**Corpora:**
- **Real:** the hash-recorded FAA set from OFFLINE-01c: the PHAK, with 497 text pages and 1.77 MB of text, and the AFH chapters.
- **Scaled:** seeded synthetic page text drawn from the real PHAK's vocabulary, with page-length distribution matched to the PHAK. Sizes: **1,000, 10,000 and 30,000 pages**. 30,000 is about 60 handbook-sized documents, well beyond a student's library.
- **Fixtures:** the §7 regression list.

**Method:**
- 3 fresh processes per size, and 15 samples per query;
- queries: one common word, one rare word, a two-word phrase, an eight-term query, and a no-match;
- p95 is computed over all samples of a query type;
- whole-process peak RSS comes from `/usr/bin/time -l`.

| Target (release build, Apple M5) | Value |
| --- | --- |
| Index one prepared PHAK (497 pages) | ≤ 1 s |
| Cold rebuild of the whole index at 10,000 pages | ≤ 5 s |
| Warm query p95 at 10,000 pages, every query type | ≤ 50 ms |
| Warm query p95 at 30,000 pages, every query type | ≤ 150 ms |
| Reopen the cache and run the first query, 10,000 pages | ≤ 300 ms |
| Largest serialized response, any query | ≤ 64 KiB (also a hard limit) |
| Derived index storage, beyond `page_text` | ≤ 1.0 × indexed text bytes |
| Whole-process peak RSS, search harness at 30,000 pages | ≤ 256 MiB |

**These targets gate 02a only.** If one is missed, it is reported as missed, not retuned after the fact. Production budgets, painted latency in the app and minimum-spec Mac numbers belong to installed acceptance, and the owner sets them.

## 7. Regression corpus

Each case asserts **expected hits and expected exclusions**, by material id and page, not merely a nonempty result.

| Case | Source | Asserts |
| --- | --- | --- |
| Text PDF | Real PHAK | Known phrases on known pages, for example "density altitude" |
| Image-only and mixed PDFs | Generated | Image pages never hit; coverage counts them |
| Unreadable font pages | Real PHAK's 25 `text_unreadable` pages | Their garbage text is never a hit |
| Multi-column, rotated | Generated | Words from each column are found; rotation doesn't drop text |
| Ligatures, Unicode, symbols | Generated | `ﬁ` and NFKC folding (if adopted), accents, `ß` limit, `°`, `±` |
| Same topic in several sources | Generated | One group per material, stable order |
| Replaced file, same material | Generated | Old text gone, new text found |
| Duplicate bytes, two materials | Generated | Both materials hit |
| Superseded revision, split parts | Generated with lineage | Page numbers of the part, plus the original page |
| Corrupt file, huge compressed page | 01a/01c fixtures | Not indexed; coverage says why |
| Deleted material | Generated | Never a hit |
| Interrupted rebuild, killed mid-publish | Fault injection | Cache disposed and rebuilt; no partial index served |
| Restore from backup | Synthetic restore | Cache disposed; nothing verified; coverage says "not prepared" |
| Query syntax | Unit | Operators as text, unmatched quote, empty query, every limit |
| Snippet safety | Unit | `<script>` in page text renders as text; markers can't be forged |
| No provider | Installed lane, network denied, no key | Restart, search, open a destination; no provider request |

## 8. Owner questions (not blocking 02a)

1. **Prefix-as-you-type** (`cross` → `crosswind`) and **typo tolerance:** wanted? Prefix is cheap with FTS5 (`prefix='2 3'` index option). Typo tolerance is not, and would need a vocabulary table.
2. **NFKC folding:** this needs no new crate. Recommended, so ligatures in FAA text become searchable. It only affects the derived index and the query; her stored text is untouched.
3. **Topic suggestions:** the roadmap allows "related" suggestions that are clearly marked as not containing the query, with inspectable synonyms. Is a small fixed aviation alias list wanted (for example `VFR` ↔ `visual flight rules`), or literal matches only for now?

## 9. Out of scope here

- OCR (02-OCR);
- span-level filtering of unmapped-font text (the recorded OFFLINE-01c follow-up). Until it lands, those 25 PHAK pages stay unsearchable, and coverage says so;
- moving the app's existing in-process `lopdf` parsing into the worker;
- the release memory cap, which is still rejected pending dedicated-Mac pressure testing.
