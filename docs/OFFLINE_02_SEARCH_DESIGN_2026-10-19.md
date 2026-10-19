# OFFLINE-02: search a subject — design and pre-registration — 19 October 2026

**Status: proposal for review, revision 6.** Codex rounds 1–5 were RED; §10 lists how each finding was answered. Nothing here is implemented.

The roadmap requires the query rules, limits, fallbacks and measurement targets to be written down before the search engine is built in ([roadmap](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md), OFFLINE-02 "Acceptance and engine decision"). This document does that.

## 1. Engine decision

**Owner decision, 19 October 2026: SQLite FTS5.** The [P54-02 evaluation](P54_02_SEARCH_EVALUATION_2026-10-16.md) showed:
- the app's locked native SQLite (3.46.0, through `libsqlite3-sys` 0.30.1, shared by `rusqlite` and the SQL plugin) creates FTS5 tables;
- the browser build's sql.js does not.

So, following that evaluation's recommendation and the roadmap's restriction:
- **The index is native-only and disposable.** It lives in the offline content cache (`content-cache.db`, OFFLINE-01a). It never goes into her authoritative database, a migration, or a backup.
- **Losing it loses nothing.** It can be rebuilt from extracted text and her records.
- **Browser mode keeps today's search.** The Study Library filter and QuickFind still search title, notes, tags, topic and type, and the page says that document text isn't searched there.
- **No new dependency or feature flag.** FTS5 ships in the SQLite the app already bundles. Interrupting a query uses `rusqlite`'s default `InterruptHandle`, not the `hooks` feature.

## 2. Slices

| Slice | Delivers | Ships dormant? |
| --- | --- | --- |
| **02a** | The native index (§5), the bounded search command (§6), destination validation (§4) and the measurements in §7 | Yes: it depends on extraction, which stays off in releases until the memory cap is accepted |
| **02b** | The Study Library search UI: filters, grouped results, snippets, coverage line, keyboard navigation, destinations with fallback | Yes, same flag as 01b |
| **02c** | Saved study content in the same search: guide sections, card fronts and backs, practice-question **stems**, personal notes, instructor questions. Homework joins when HW-01 ships | The study-record part doesn't need extraction; decide at 02c whether it ships before the cap |
| **02-OCR** | Scanned pages (separate, gated subtask in the roadmap) | — |

This document fixes the contract for all three slices, so 02a's index and command don't change later.

## 3. Query semantics

**What she types is never passed to FTS5 as query syntax.** The app parses it into a fixed shape and builds the `MATCH` expression itself.

**Parsing**, in order:
1. **NFKC.** The query is NFKC-normalized (§3.1), exactly as indexed text is.
2. **Phrases and words.** A pair of double quotes encloses a **phrase**, which must appear as consecutive words. Everything else is split on whitespace into **words**. An unmatched quote is treated as ordinary text, not a syntax error.
3. **AND.** Every word and phrase must match.
4. **Literal operators.** Each word and phrase is emitted as an FTS5 string literal (`"…"`, with inner `"` doubled). So `AND`, `OR`, `NOT`, `NEAR`, `*`, `^`, `:`, `-`, `+` and parentheses are just text. Characters the tokenizer treats as separators split words, so `V-speeds` means `v` followed by `speeds`.
5. **Empty query.** A query with no indexable word, for example only punctuation, returns "Type a word to search", never every document.

**No prefix or fuzzy matching in 02a/02b.** `cross` does not find `crosswind`. Prefix-as-you-type and typo tolerance are owner choices (§9). Adding prefix later is an index option (`prefix=`) plus a rebuild; it doesn't change the stored text.

### 3.1 Folding and normalization (settled)

**Canonical text.** The index and the snippets both use one canonical form of each passage. It is computed natively when a passage is indexed:
1. **Unicode NFKC**, using `unicode-normalization` 0.1.25, which is already a direct dependency of the app (`cargo tree -i unicode-normalization`).
2. **Control characters** (C0 and C1, other than space) replaced by a space.
3. **Private-use code points U+E000 and U+E001** removed. They are the snippet markers (§6.3).

**Where it's stored.** The canonical text is stored in `search_passage.text` (§5), and that is the FTS external content. So the index, a rebuild, a delete and `snippet()` all see the same text. Her original extracted text stays unchanged in `page_text`, which is OFFLINE-01's table.

**Tokenizer:** `unicode61 remove_diacritics 2`. Case and accents fold (`METAR` = `metar`, `cafe` = `café`).

**Known limits.** Each is asserted by a test, so it is visible, not hidden:
- `ß` doesn't fold to `ss`;
- CJK text with no spaces is one token per run, so it matches only whole runs.

**NFKC fixes ligatures.** `ﬁnal` → `final`, and `①` → `1`. Full-width letters → ASCII.

**Probe, 19 October 2026,** run on macOS's `sqlite3` 3.54 with the same tokenizer, before 02a asserts the same cases on the bundled 3.46:
- `cafe` matches `café`;
- `strasse` doesn't match `Straße`;
- `final` doesn't match `ﬁnal` without NFKC;
- `"V-speeds"` matches;
- `"AND"` matches literally;
- `日本語` doesn't match inside `日本語のテキスト`.

**Tests where NFKC changes token boundaries:** `ﬁ`, `㎏` → `kg`, `½` → `1⁄2`, and full-width digits. Each asserts the hit **and** that the snippet shows the canonical text with correctly placed marks.

### 3.2 Query limits

These are refused with a plain message, never truncated silently. Lengths are counted in Unicode scalar values after NFKC.

| Limit | Value |
| --- | --- |
| Query length | 200 characters |
| Words plus phrases | 8 |
| One word or phrase | 64 characters |

## 4. What is searched, and destinations

### 4.1 Eligible passages (02a)

**Which pages:** a PDF page becomes a passage only if its extraction is `complete` for the current `EXTRACTOR_VERSION` and its outcome is `text`. Pages that are `text_unreadable`, `unknown`, `failed`, `image_only` or `blank` are not passages; they are counted in coverage.

**Which materials, at query time:**
1. **Resolve the materials.** The command takes the material ids the UI's filters selected (§6.1). It resolves them against the authoritative database, as `material_paths` does today, so a deleted material simply has no row.
2. **Check each file's current identity.** For each resolved file, call the service's `current(path)`. That returns a hash only if the file was hashed this session **and its stamp (size, modification time, inode) still matches**.
3. **Exclude the rest.** A material with no current hash is excluded and counted as "not checked" or "missing". An old map entry for a replaced file therefore never qualifies.
4. **Restrict the search.** The search covers only passages whose `content_sha256` is in that per-query set of current hashes. Several materials with the same bytes each get the hit.

### 4.2 Opening a hit

A result carries `{ materialId, contentSha256, pageIndex }`.

**Re-checking before opening.** The UI calls `verify_offline_destination(materialId, contentSha256)` first. It **re-hashes** the file, using the bounded hashing from 01a. That also closes the gap where a file is replaced in place with the same stamp. It answers in one of three ways:
- **ok:** the destination is opened;
- **changed:** "This document changed since you searched. Search again to see its current pages.";
- **missing:** the existing missing-file wording.

**Opening the page** reuses the existing navigation controller, the one behind `SourcePageBadge`, including its native **Open** fallback and guidance when the embedded reader can't show the Mac's file. Search adds no new open path.

**Remaining limit (documented):** a replacement after the destination check, but before the reader opens the file, is the same window every existing source-page link has. It isn't widened here.

**Tests:** the file is replaced (with a different stamp, and with the same stamp) between search and open, and the material is deleted between search and open.

### 4.3 Coverage

Every response carries category counts, computed over the **filtered** material set. This keeps "no match" separate from "some documents haven't been prepared":
- **searched:** how many documents and pages;
- **not prepared yet;**
- **not checked this session;**
- **could not prepare;**
- **file missing;**
- **unsearchable pages** in searched documents, split into images versus other.

Example: "No matches in 12 documents (3,041 pages). 4 documents aren't prepared for offline search yet."

### 4.4 Revisions, types and splits

Each material is its own source and revision. A result shows:
- the material **title** and **type** label;
- the original file name;
- when its current file was imported;
- the page number **in that file**.

When the material is a split part, the existing lineage adds the original page, for example "p. 3 (p. 103 of the original)", using the `SplitLineageDetails` mapping. Results never merge text across materials into one answer, and contradictory sources stay separate groups.

### 4.5 Saved study content (02c) and hidden answers

| Category | Indexed | Never indexed |
| --- | --- | --- |
| Guide sections | Section heading and body | — |
| Cards | Front and back | — |
| Practice questions | **Stem only** | Options, correct answer, explanation |
| Notes, instructor questions | Title and body | — |

So no snippet can reveal a practice answer during an attempt.

Card backs are the card's own content, not hidden answers under the practice-attempt contract. The roadmap includes them explicitly.

**02c tests:**
- for each category, expected hits and **exclusions**;
- with an active attempt, the attempt's options, answer and explanation text is unfindable.

**Imported text is data.** Page or record text that contains HTML, Markdown, or instruction-like text ("ignore previous instructions…") is indexed and shown only as plain text. Search involves no AI and executes nothing. Fixtures assert that the text renders literally.

## 5. The index (02a)

**Where:** `content-cache.db`. The cache schema goes from 1 to 2, and an older cache is disposed and recreated, which is allowed because it is derived data. The cache switches to `journal_mode=WAL`, so a search reads while preparation writes.

```sql
CREATE TABLE search_passage (
  id INTEGER PRIMARY KEY,               -- stable rowid: survives VACUUM
  content_sha256 TEXT NOT NULL,
  extractor_version INTEGER NOT NULL,
  page_index INTEGER NOT NULL,
  text TEXT NOT NULL,                   -- canonical text (§3.1)
  UNIQUE (content_sha256, extractor_version, page_index)
);
CREATE VIRTUAL TABLE passage_fts USING fts5(
  text, content='search_passage', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER search_passage_ai AFTER INSERT ON search_passage BEGIN
  INSERT INTO passage_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER search_passage_ad AFTER DELETE ON search_passage BEGIN
  INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER search_passage_au BEFORE UPDATE ON search_passage BEGIN
  SELECT RAISE(ABORT, 'search_passage rows are immutable');
END;
```

**Why this shape:**
- **Stable identity:** `id` is an `INTEGER PRIMARY KEY`, an alias for the rowid, which `VACUUM` never renumbers. The composite identity stays `UNIQUE`.
- **Only eligible text:** `search_passage` contains only eligible passages. So the FTS `'rebuild'` command, which re-reads the whole content table, can never index excluded pages. `page_text` is not the content table.
- **Deletes always see the indexed text:** the delete trigger passes the **old** row's canonical text to FTS. Rows are immutable, so that text is exactly what was indexed. This holds for every path that removes rows.

**Write paths.** Each is one transaction, in this order:

| Path | Inside one transaction |
| --- | --- |
| `publish` (also replacement) | `clear` deletes the hash's `search_passage` rows (the trigger removes their FTS entries), then its `page_text` and `extraction` rows. Then it inserts `extraction`, then `page_text`, then `search_passage` for `text` pages |
| `publish_failure` | The same `clear`, then the failed `extraction` row |
| `prune` | For each evicted hash, the same `clear` |

**Tests for each path:** after the transaction, the FTS integrity check passes. Searching the old text finds nothing, and searching the new text finds exactly the expected pages.

**Crashes:** every write is one SQLite transaction. A crash or kill rolls it back to the last committed state, so a reader never sees half a publish. The `state` row isn't involved; it marks only whether the schema was created completely. A test kills the process mid-publish and asserts the previous committed index is intact.

**Validation and repair:**
- **When the cache is first opened in a process,** the existing `trustworthy()` checks run: schema, `state`, and `PRAGMA quick_check`. Then `INSERT INTO passage_fts(passage_fts, rank) VALUES('integrity-check', 1)` runs, which also compares the index with its external content.
- **If only the FTS check fails,** `'rebuild'` runs in one transaction, followed by the check again.
- **If it still fails, or `quick_check` fails,** the whole cache is disposed and recreated. Documents then show "not prepared" and can be prepared again.
- **Cost:** the check's cost at 30,000 passages is measured (§7). If it exceeds 1 s, it moves off the first search's path to a background check before search is enabled.

## 6. The search command (02a)

### 6.1 Request

`search_offline_content` takes:
- `query`;
- `materialIds`: the UI's filtered set. Topic and tag, material, type and revision filters all reduce to this list. At most 5,000 ids;
- `contentTypes`: in 02a only `documentPages`; 02c adds the rest;
- `offset`.

It is gated like `prepare_offline_content`.

### 6.2 Isolation, admission and deadline

**Its own thread and connection.** Search runs on a dedicated search thread with its own **read-only** connection to the cache. It never runs on the extraction executor, so a search never waits behind hashing or extraction, and WAL lets it read during a publish.

**Admission:** one search runs at a time, and at most one waits. A newer request replaces the waiting one, which gets `superseded`, and interrupts the running one. Typing therefore never builds a queue.

**Deadline:** 2 s per search. It answers `timeout`: "That search took too long. Try more specific words." It is enforced in two layers, because SQLite interruption is **cooperative**: `sqlite3_interrupt` only stops a statement that is running, and it does nothing between statements.

**1. Request-scoped state.** Each request carries a `Deadline { id, until, cancelled: AtomicBool }`. The search thread checks it:
- before each phase: material resolution, stamp checks, the candidate query, grouping, snippets and serialization;
- once per candidate row stepped;
- once per snippet built.

When the deadline has passed or the request was superseded, the thread stops and answers `timeout` or `superseded`.

**2. SQL interruption.** This covers the time inside one statement, notably the candidate sort, which runs before the first row is returned.
- **What the search thread records:** while a statement runs, it records `active = Some(request id)` in a mutex. It clears that record, under the same mutex, as soon as the statement finishes or is reset.
- **What the watchdog does:** when a request's deadline fires, it sets that request's `cancelled` flag, which stays set. It then **keeps** interrupting: every 10 ms it takes the mutex and calls `InterruptHandle::interrupt()` if `active` still holds that request's id. It stops once `active` no longer holds that id.
- **Why it keeps interrupting:** an interrupt that lands after `active` is recorded but before SQLite's first step is a no-op. The next 10 ms tick catches the statement once it has started.
- **The search thread's side:** after recording `active` and before the first step, it checks `cancelled` again and doesn't start a cancelled statement. Together with the repeated interrupt, a statement started after the deadline is stopped within one tick plus SQLite's interrupt latency.
- **Why a late timer can't hit the next request:** clearing `active` and starting the next request's statements both happen after that mutex is released. So a late timer can't interrupt a different request.
- **Retiring a timer:** a request's timer is cancelled when the request ends. A test drives a timer that fires exactly at the end of a request and asserts the next request completes normally.
- **Startup-race tests.** Two test-only pause points sit in the startup sequence. Both tests use an expensive statement: a worst-case common word over a large fixture.
  - **Point A** is after `active` is recorded and **before** the `cancelled` re-check. The test pauses there, fires the deadline, and resumes. It asserts that the search answers `timeout` and that **no SQLite step ran**: the statement was never started.
  - **Point B** is **after** the re-check and before the first SQLite step. The test pauses there, fires the deadline, and **waits for the watchdog to acknowledge** its first interrupt, which is the no-op one. Then it lets SQLite start.
    - **The in-statement gate:** the test's candidate statement is the production statement plus `AND hfd_test_gate()`. That is a test-only SQL function, registered on the search connection only in test builds. On its first call, inside the running statement, the gate signals "running" and then **blocks** until the watchdog acknowledges a **later** interrupt (tick 2 or above), which is issued while the statement is provably active. Then the gate returns, and SQLite sees the pending interrupt at its next instruction.
    - **Asserts:** the statement fails with `SQLITE_INTERRUPT` (`ErrorCode::OperationInterrupted`); the search answers `timeout` within 2 s + 100 ms; the tick that interrupted was 2 or above.
    - **Why it's timing-independent:** both waits are handshakes, not sleeps.
    - **The SQL function** needs `rusqlite`'s `functions` feature. It is enabled **only** in `[dev-dependencies]`. That adds no crate and no `Cargo.lock` package: the feature is `functions = []` in `rusqlite` 0.32.1. The release build's feature set is unchanged, which a test asserts with `cargo tree -e features`.
  A one-shot watchdog fails the point-B test. Both tests then run the next request and assert a correct result.

**Bounded work, in two phases:**
1. **Candidates**, with the cutoff ordered by the full §6.4 key:
   ```sql
   SELECT f.rowid, f.rank, p.content_sha256, p.page_index
   FROM passage_fts AS f
   JOIN search_passage AS p ON p.id = f.rowid
   JOIN temp.current_sha AS c ON c.sha = p.content_sha256
   WHERE passage_fts MATCH ?
   ORDER BY f.rank, c.sort_title, c.sort_id, p.page_index
   LIMIT 2000
   ```
   - `temp.current_sha(sha PRIMARY KEY, sort_title, sort_id)` is built per query from the §4.1 hashes.
   - When several materials share a hash, the sort columns are the smallest `(title, id)` among them.
   - The `LIMIT` is applied **after** the complete ordering, so which passages survive the cut is decided by the same rule that orders them. A tie across the cutoff is resolved by title, then id, then page.
   - The 2,000 cap bounds the sorter. It counts **passages**: a passage whose hash belongs to several materials is expanded to each of them **after** the cut, so it never displaces other passages.
2. **Results:** group the candidates by material, then build snippets **only** for the passages on the requested page.

If more groups exist beyond the 2,000 candidates, `nextOffset` stops there and the UI says "Showing the best matches. Narrow your search to see more."

**Memory:** the search connection sets `PRAGMA cache_size = -16384` (16 MiB) and `temp_store = FILE`. A process-wide SQLite heap limit is **not** used, because it would also constrain her database's connection. The §7 RSS target, including a worst-case common-word query, is the check.

### 6.3 Response bounds, enforced

| Item | Rule |
| --- | --- |
| Groups per page | 20 materials, at most 3 passages each |
| Deepest offset | 200 groups |
| Snippet | `snippet(passage_fts, 0, U+E000, U+E001, '…', 24)`, then clipped natively to 240 Unicode scalar values. Clipping never splits a marker pair: a mark cut by the clip is closed, and a stray marker is removed |
| Title, file name, type label | Clipped to 120 scalar values |
| Whole response | Serialized to JSON natively. If it exceeds **65,536 UTF-8 bytes**, passages are removed from the last group, then whole last groups, until it fits; `nextOffset` points at the first dropped group and `trimmed: true` is set. The bytes actually returned are asserted in tests |

**Markers can't be forged:** canonical text contains no U+E000 or U+E001 (§3.1), so every marker comes from `snippet()`.

**Rendering:** the UI renders a snippet as **text nodes**, splitting on the markers to add `<mark>` elements. It never uses `innerHTML`.

**Fixtures:**
- control characters;
- a 10,000-character token;
- 4-byte UTF-8 text;
- a 1,000-character title;
- a page made only of marker characters;
- 60 maximal passages, to force trimming.

### 6.4 Ranking and order

- passages rank by `bm25`;
- a material ranks by its best passage;
- ties break by material title, then material id, then page index.

This same key orders the candidate cutoff (§6.2), so the order is stable, including at the cut, for the same index, query and filters.

**Tests:**
- 2,500 passages with identical scores across materials whose titles sort in the opposite order to their hashes. The test asserts which materials survive the cut and their order.
- A duplicate-hash material at the cut.

## 7. Measurement plan and targets (pre-registered, frozen)

**Frozen before any timing.** The following are committed and hashed before the first measurement:
- **the generator:** `docs/evidence/offline-02a-…/generate.py`, with seed `20261019`;
- **the corpora's SHA-256:** for the real FAA set, the hashes recorded in OFFLINE-01c;
- **the exact queries;**
- **the expected-hit files.**

Anything changed after that is reported as a change, with the reason.

**Expected hits:**
- **How they're produced:** an independent reference, a Python word-boundary scan over the same canonical text using the same folding rules (tested against FTS on fixtures first), gives the expected `(sha, page)` set for every query and corpus.
- **Two checks, both untimed.** A mismatch in either fails the run:
  1. **Exhaustive:** the candidate query **without** `LIMIT` must return exactly the reference set.
  2. **Capped:** the production query, with its `LIMIT 2000`, must return exactly the first 2,000 rows of the exhaustive result in the §6.4 order, or all of them if there are fewer.
- **Timed runs use only the production, capped command.**

**Corpora:**
- **Real:** the PHAK (497 text pages, 1.77 MB of text) and the AFH chapters, from OFFLINE-01c's hash-recorded set.
- **Scaled:** generated pages that draw words from the PHAK's canonical vocabulary, with frequencies and page lengths sampled from it. Sizes: **1,000, 10,000 and 30,000 pages**.
  - **Allocation:** every generated document has exactly 500 pages. So the sizes are 2, 20 and 60 distinct documents. Each document is one material, titled `Generated handbook NN` with zero-padded numbers.
  - **Duplicates:** document 01 is also imported a second time as a separate material, `Generated handbook 01 (copy)`, with the same bytes and hash. So each size has one duplicate-hash pair, which is 3, 21 and 61 materials.
  - **The real PHAK** is measured on its own (one material), and it is not mixed into the scaled corpora.

**Queries** (identical for every corpus):

| Type | Query |
| --- | --- |
| Common word | `aircraft` |
| Rare word | `isogonic`. If the reference scan finds it on no PHAK page, or on more than 3, it is replaced by the alphabetically first word on 1–3 PHAK pages, and the choice is recorded at freeze time |
| Phrase | `"density altitude"` |
| Eight terms | `wind shear final approach runway landing pilot airspeed` |
| No match | `zzqxv` |
| Worst case | the most frequent indexed word in the corpus, recorded when the corpus is frozen |

**Filters** (each query type is measured under all three):
- **All:** every material in the corpus.
- **One:** the material `Generated handbook 01`, or the PHAK.
- **Quarter:** every fourth material when sorted by id, starting with the first.

**Query order:** fixed for every process. For each filter in the order All, One, Quarter, and each query type in the table's order, run that pair's warm-up queries and then its timed queries before moving on. The schedule is written to the frozen manifest.

**Timing:**
- **Query time** runs from the command's entry to its serialized response bytes. It excludes IPC and painting, which belong to installed acceptance.
- **Index time** covers `search_passage` inserts plus commit.
- **Reopen** means a fresh process, then open plus validation, then the first query.

**Samples:**
- 3 fresh processes per corpus size;
- per query type and filter, 3 discarded warm-up queries, then 15 timed;
- each query type and filter therefore has 45 samples per size;
- p50 and p95 by the nearest-rank method.

**Storage:**
- `content-cache.db` size after `VACUUM`, minus the same database built without `search_passage` and `passage_fts`;
- reported against the canonical text bytes.

**Memory:** whole-process peak RSS from `/usr/bin/time -l`.

**The concurrent case:** 10,000 passages, filter All, the common-word query.
- **Start:** the harness starts a PHAK preparation, waits for the worker's first `page` frame, and only then begins sampling.
- **A sample counts only if** it both starts and ends before the worker's `end` frame **and** before the publish transaction begins.
- **Interrupted runs:** if preparation finishes first, that run's samples are discarded and the run is repeated, up to 5 times. The number of discarded runs is reported. If all 5 fail to fit 15 samples, the case is reported as not measured, never as passing.

**Frozen manifest.** Before implementation measurements, these are committed and hashed:
- the corpus manifest: every material's id, title, hash and page count;
- the filter sets;
- the query schedule;
- the concurrency protocol.

**Every prescribed case is reported**, including any that missed its target or couldn't be measured.

**Hardware:** a release build, Apple M5 with 32 GiB, macOS and toolchain versions recorded. The minimum-spec Mac is still pending, as for the 01c cap.

| Target (release build, Apple M5) | Value |
| --- | --- |
| Index one prepared PHAK (497 passages) | ≤ 1 s |
| Cold `'rebuild'` at 10,000 passages | ≤ 5 s |
| Open + validation (integrity check) at 30,000 passages | ≤ 1 s, otherwise background (§5) |
| Warm query p50, every type, 10,000 passages | ≤ 20 ms |
| Warm query p95, every type, 10,000 passages | ≤ 50 ms |
| Warm query p95, every type, 30,000 passages | ≤ 150 ms |
| Worst-case query p95 at 30,000 passages | ≤ 2 s (the deadline); otherwise the deadline answer is measured and reported |
| Warm query p95 at 10,000 during a PHAK preparation | ≤ 100 ms |
| Reopen and first query, 10,000 passages | ≤ 300 ms |
| Largest response | ≤ 65,536 bytes (a hard limit, §6.3) |
| Derived index storage | ≤ 1.0 × canonical text bytes |
| Whole-process peak RSS, search harness at 30,000 passages | ≤ 256 MiB |

**These targets gate 02a only.** A missed target is reported as missed, with its number, never retuned. Production budgets, painted latency in the app and minimum-spec numbers belong to installed acceptance, and the owner sets them.

## 8. Regression corpus

Each case asserts **expected hits and expected exclusions**, by material id and page, not merely a nonempty result.

| Case | Source | Asserts |
| --- | --- | --- |
| Text PDF | Real PHAK | Reference-scan hit sets for the §7 queries |
| Image-only and mixed PDFs | Generated | Image pages never hit; coverage counts them |
| Unreadable font pages | Real PHAK's 25 `text_unreadable` pages | Their garbage text is never a hit |
| Multi-column, rotated | Generated | Words from each column are found; rotation doesn't drop text |
| Ligatures, Unicode, symbols | Generated | The NFKC cases in §3.1, accents, `ß` and CJK limits, `°`, `±` |
| Same topic in several sources | Generated | One group per material, stable order |
| Replaced file, same material | Generated | Old text gone, new text found, both stamp cases (§4.2) |
| Duplicate bytes, two materials | Generated | Both materials hit |
| Superseded revision, split parts | Generated with lineage | Part page and original page shown |
| Corrupt file, huge compressed page | 01a/01c fixtures | Not indexed; coverage says why |
| Deleted material | Generated | Never a hit, including between search and open |
| Publish, replacement, failure, prune | Unit | FTS integrity passes; exact hits after each (§5) |
| Killed mid-publish | Fault injection | Previous committed index intact |
| Corrupt FTS index | Fault injection | Rebuilt, then searches correctly; a corrupt database is disposed |
| Restore from backup | Synthetic restore | Nothing verified; coverage says "not checked" |
| Query syntax | Unit | Operators as text, unmatched quote, empty query, every limit |
| Response bounds | Unit | The §6.3 fixtures; returned bytes ≤ 65,536 |
| Snippet safety | Unit and UI | HTML and instruction-like text render literally; markers can't be forged |
| Supersede and deadline | Unit | A newer search interrupts the older one; a slow search answers `timeout` |
| Hidden answers (02c) | Unit | Practice options, answers and explanations are never hits |
| No provider | Installed lane, network denied, no key | Restart, search, open a destination; no provider request |

## 9. Owner questions (not blocking 02a)

1. **Prefix-as-you-type** (`cross` → `crosswind`) and **typo tolerance:** wanted? Prefix is cheap (`prefix='2 3'` plus a rebuild). Typo tolerance is not, and would need a vocabulary table.
2. **Topic suggestions:** the roadmap allows "related" suggestions that are clearly marked as not containing the query, with inspectable synonyms. Is a small fixed aviation alias list wanted (for example `VFR` ↔ `visual flight rules`), or literal matches only for now?

**NFKC is no longer a question.** It is settled in §3.1 because it needs no new dependency and touches only derived text; the owner can still veto it.

## 10. Codex round 1 corrections

| # | Finding | Answer |
| --- | --- | --- |
| 1 | FTS row identity unstable (`page_text`'s implicit rowid) | `search_passage.id INTEGER PRIMARY KEY` is the external-content rowid; the composite key is `UNIQUE` (§5) |
| 2 | External-content consistency underspecified; `rebuild` would index excluded pages | The content table holds only eligible passages; triggers delete with the old indexed text on every path; per-path transaction order and tests (§5) |
| 3 | Crash recovery described wrongly | Transactional rollback stated accurately; validation runs at first open per process with `integrity-check` rank 1; rebuild, then disposal; kill-mid-publish test (§5) |
| 4 | Limits don't bound work; executor contention | A dedicated search thread and read-only WAL connection; one running plus one waiting, newest supersedes; 2 s interrupt deadline; 2,000-candidate cap; snippets only for shown passages; memory pragmas; worst-case and concurrent measurements (§6.2, §7) |
| 5 | Stale destinations | Authoritative material resolution plus `current()` stamp check per query; re-hash on open; same-stamp and between-search-and-open tests; the remaining window documented (§4.1, §4.2) |
| 6 | NFKC versus snippet text | One canonical text, stored as the external content, used by index, rebuild, delete and snippet; originals kept in `page_text`; boundary-changing tests (§3.1) |
| 7 | 240-character and 64 KiB bounds unenforced | Scalar-value clipping that is marker-safe; metadata clipping; serialized-byte accounting with a trim-and-paginate policy; fixtures (§6.3) |
| 8 | Measurement choices left open; p50 missing | Seed, generator, hashes, queries and reference expected hits frozen first; timing boundaries, warm-up, nearest-rank p50/p95, storage method; misses reported (§7) |
| 9 | Filters, type/revision display, Open fallback, hidden-answer and injection tests missing | `materialIds` from the UI's topic/tag/material/type/revision filters plus `contentTypes`; revision display; reuse of the existing navigation controller and Open fallback; 02c exclusion and active-attempt tests; literal-rendering fixtures (§4.4, §4.5, §6.1, §8) |

## 11. Codex round 2 corrections

| # | Finding | Answer |
| --- | --- | --- |
| 1 | The timer doesn't enforce the deadline: SQL interruption is cooperative, non-SQL phases continue, and a late timer could hit the next request | A request-scoped deadline is checked between phases, per candidate row and per snippet. The watchdog interrupts only while that request's statement is active, coordinated by a mutex. Timers are retired at request end, with a boundary test (§6.2) |
| 2 | The exact-set gate contradicts `LIMIT 2000` | An exhaustive untimed query must equal the reference set. The capped production query must equal the first 2,000 of the exhaustive order. Timing uses only the capped command (§7) |
| 3 | The cutoff precedes the tie-breaking | The cutoff is ordered by the full key: rank, title, id, page, with the duplicate-hash sort key defined. Expansion happens after the cut. There are tie-across-cutoff and duplicate-at-cutoff tests (§6.2, §6.4) |
| 4 | Workload choices still open | Fixed 500-page documents, one duplicate pair per size, three prescribed filters, a fixed query schedule, a concurrency protocol synchronized on worker frames with discard and retry rules. All are frozen in a manifest, and every case is reported (§7) |

## 12. Codex round 3 correction

| # | Finding | Answer |
| --- | --- | --- |
| 1 | A one-shot watchdog can fire between recording `active` and SQLite's first step, where the interrupt is a no-op | Cancellation is persistent. The watchdog re-interrupts every 10 ms while that request's statement is active, and the search thread re-checks `cancelled` before the first step. A deterministic startup-race test pauses at that point, fires the deadline, resumes an expensive statement, and asserts prompt `timeout` and a correct next request (§6.2) |

## 13. Codex round 4 correction

| # | Finding | Answer |
| --- | --- | --- |
| 1 | The startup-race test didn't deterministically exercise the race | Two tests. Point A, before the re-check: cancellation means no SQLite step runs. Point B, after the re-check: the test waits for the first, no-op interrupt to be acknowledged, then resumes, and requires a later tick to interrupt, which a one-shot watchdog fails. Both assert a correct next request (§6.2) |

## 14. Codex round 5 correction

| # | Finding | Answer |
| --- | --- | --- |
| 1 | Point B still depended on SQLite running long enough for a later tick | An in-statement handshake: a test-only SQL function blocks inside the running statement until a later watchdog interrupt is acknowledged, then releases. The test asserts `SQLITE_INTERRUPT`, a bounded `timeout`, a tick of 2 or above, and the next request's success. The `functions` feature is enabled for dev only and adds no crate (§6.2) |
