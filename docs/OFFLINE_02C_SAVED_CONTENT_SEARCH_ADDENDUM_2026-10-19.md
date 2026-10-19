# OFFLINE-02c: searching saved study content — design addendum — 19 October 2026

**Status: proposal for review, revision 2.** Codex round 1 was RED with six findings; §9 maps each to its answer. Nothing here is implemented.

This adds the saved-content part of OFFLINE-02 to the accepted [search design](OFFLINE_02_SEARCH_DESIGN_2026-10-19.md) (revision 6). Everything that design fixes still applies unless changed here:
- query parsing and literal operators (§3);
- folding and canonical text (§3.1);
- limits (§3.2);
- the search thread, admission, deadline and interruption (§6.2);
- response bounds and snippet rendering (§6.3);
- ranking (§6.4);
- the dormancy gate.

**Owner decision, 19 October 2026:** 02c ships **off**, behind the same switch as document search. The two are enabled together after the extraction memory cap is accepted.

## 1. What is searched

| Category | Source (her database, read only) | Indexed | Never indexed |
| --- | --- | --- | --- |
| Guide sections | `ai_study_sets.sections_json`: each section's `heading` and `body`; `summary` as its own passage | Yes | `source_notes`, provider and model |
| Cards | `ai_study_sets.flashcards_json`, the material's **current** saved cards: `front` and `back` | Yes | `card_versions` and `card_items`, which are review snapshots |
| Practice questions | `practice_test_items.question_text` of each material's **active** `practice_test_versions` row | **Stem only** | `options_json`, `correct_index`, `explanation`; inactive versions |
| Notes | `notes`: title and body | Yes | — |
| Instructor questions | `questions`: text and answer | Yes | — |

**Why cards come from the study set, not card versions.** Migration 0012 creates a `card_versions` snapshot only on the first review action. Untouched cards have none, and a regenerated set can coexist with an older active snapshot until the next action. The saved set is therefore the only complete, current source. Indexing it creates no review history.

**Why practice questions come from versions.** Practice versions **are** current:
- saving or replacing a practice test deactivates the old version and inserts a new active one (`practiceSessionTransaction.ts`, around lines 907–932 and 1010);
- imports insert an active version (`study_packet.rs`, `structuredImportTransaction.ts`);
- legacy rows are converted at startup before storage is marked ready.

**Legacy practice tests.** `practice_tests.questions_json` predates practice versions. It is **not** indexed: it holds answers in the same JSON as the stems, and every current practice test has a version. A material whose practice test exists only in that legacy form gets no practice-question hits. Coverage doesn't count it, since it isn't a document.

**Imported content is data.** Imported study packets land in the same tables and are indexed like everything else. Their text, including HTML, Markdown or instruction-like text, is only ever rendered as text (§6.3 of the design).

## 2. Where the index lives, and how it stays current

**One connection.** The search thread's existing cache connection **attaches** her database read-only:

```sql
ATTACH 'file:<path>/her-flight-deck.db?mode=ro' AS app
```

The connection is opened with `SQLITE_OPEN_URI`. Saved content is indexed in temporary tables on that same connection: `temp.record`, and FTS5 `temp.record_fts`, kept in step by the same trigger pattern as §5 of the design. It is never written to `content-cache.db`, her database, a migration or a backup.

**Why one connection matters:**
- every statement, including rebuild reads, runs on the connection whose `InterruptHandle` the watchdog already holds. So the supersede, deadline, repeated-interrupt and startup-race rules (§6.2) cover the rebuild without new machinery;
- one read transaction spans both databases, so a search sees a consistent snapshot of each.

**The freshness sequence**, exactly, for each search:
1. Outside any transaction, read `PRAGMA app.data_version`. If it equals the recorded token **and** the temp index is marked complete, skip to step 6.
2. `BEGIN`, then read one row from `app.sqlite_master`. This establishes the read snapshot of her database.
3. Inside that transaction, read `PRAGMA app.data_version` again, as `v`. The value is fixed for the life of the read transaction, so `v` identifies this snapshot.
4. Mark the temp index incomplete and clear it, then rebuild it from the snapshot under the bounds in §2.1.
5. `COMMIT`. Only now record the token `v` and mark the index complete.

   If anything fails or is interrupted, `ROLLBACK`: the index stays marked incomplete and the token is cleared, so the next search rebuilds. A commit made by the app during the rebuild changes `data_version`, so the next search sees a value different from `v` and rebuilds again.
6. Run the search.

   The index is used only while marked complete. A reconnection (a new connection, or the cache being replaced) starts with no token and no index.

**Test:** a test-only pause in step 4 lets another connection commit an edit. Then:
- the paused search answers from its own snapshot;
- the **next** search rebuilds and finds the edit.

### 2.1 Rebuild bounds

These are checked before and during the rebuild, so memory and time stay bounded outside SQLite as well as inside.

**Preflight**, inside the snapshot, a cheap `length()` sum per source:
- if the total text across all saved sources exceeds **32 MiB**, the rebuild is skipped;
- the response then reports `savedContent: "too_large"`, and only documents are searched. The UI says: "Your saved study content is too large to search offline in one go."

**Per field.** A single JSON field (`sections_json` or `flashcards_json`) over **4 MiB**, or a single note or question field over **1 MiB**, is skipped and counted in coverage as **too large to search**. Its length is checked with `length()` **before** the value is read.

**Per item.** At most **200,000** indexed records in total. Past that, the rebuild stops, with the same `too_large` result. A partial index is never used.

**Streaming.** Rows are read one at a time. Each JSON value is parsed only after its size check. `Control::check()` runs per row and per parsed item, so a deadline or supersede stops the rebuild between items as well as inside SQLite.

## 3. Query and results

**One query, both kinds.** A single search runs the same parsed query against document passages (02a) and saved content. Each record passage gets its own `bm25` rank, computed in its own table.

**Separate groups, never merged.** Ranks from two FTS tables aren't comparable, so the two kinds are returned as **separate sections**:
- **Documents:** the 02a groups, unchanged.
- **Saved study content:** grouped by material for guides, cards and practice questions, with **Your notes** and **Instructor questions** as their own groups.

Within saved content, groups follow the §6.4 rule: best passage, then title, then id.

**Filters:**
- Guides, cards and practice questions follow the material filters, through the same `materialIds`.
- Notes and unlinked instructor questions aren't materials. They are searched when `contentTypes` includes `notes` or `questions`.
- An instructor question linked to a material is searched only when that material is in `materialIds`.

**Bounds.** The response bounds in §6.3 apply to the whole response: one 65,536-byte limit, with snippet and label clipping as before. The page size applies **per section**: 20 groups with 3 passages each. Saved content has its own `nextOffset`.

**Snippets** come from `snippet()` on the temp table, with the same markers and the same canonical text rule: NFKC, controls removed, markers stripped (§3.1).

**Content types.** `contentTypes` accepts `documentPages`, `guides`, `cards`, `practice`, `notes` and `questions`. Unknown values are refused.

## 4. Destinations

A record hit opens **that record**. Each page gains a small, tested deep link that accepts only a known id. An unknown or stale id falls back to the plain page with the note "That item isn't here any more."

| Hit | Opens |
| --- | --- |
| Guide summary | `/study/:materialId?guide=summary&rev=<token>`: the material page at its guide |
| Guide section | `/study/:materialId?guide=<index>&rev=<token>`: the material page scrolled to that section |
| Card | `/study/:materialId?card=<index>&rev=<token>`: the material page's saved cards, with that card shown |
| Practice question | `/study/:materialId?question=<itemId>`: the question is shown **without its answer**. During an active attempt, the attempt's normal hidden-answer rules apply |
| Note | `/notes?note=<id>`: that note scrolled into view and highlighted |
| Instructor question | `/questions?question=<id>`: that question scrolled into view and highlighted |

**Revision tokens for guides and cards.** A section or card index alone could still be valid after she regenerates the set, and would then silently point at different text. So guide and card hits carry `rev`: the study set's `updated_at` at the snapshot.
- **The page opens the item only if** the set's current `updated_at` equals `rev` **and** the index exists. Otherwise it shows the material page with: "This study guide has changed since you searched. Search again to find it."
- **Notes, questions and practice items** have stable ids, so they need only an existence check.

**Re-checking before navigating.** The UI also confirms the id, or the set and its `rev`, against the app's loaded data before it navigates. No file hashing is involved.

## 5. Coverage

**What coverage reports.** The response adds counts per searched category:
- guides;
- card versions;
- practice versions;
- notes;
- instructor questions.

**What the UI says.** The UI states which categories were searched, so "no match" means no match in the listed categories.

Document coverage (§4.3) is unchanged.

## 6. Measurement (pre-registered)

All of this is frozen and hashed **before** any timing, using the 02a harness and a release build on the same hardware.

**What is frozen:**
- the generator script;
- the generated corpus, as a SQLite file plus its SHA-256;
- the queries and their expected hit identities;
- the schedule.

**Corpus,** produced by the committed generator with seed `20261019`.

*Vocabulary.* Words come from the PHAK's canonical vocabulary, at its Zipf frequencies, which are recorded with the generator.

*Records,* with lengths uniform within each range:
- 200 materials, each with a saved study set:
  - a summary of 40–120 words;
  - 40 sections, each with a heading of 3–8 words and a body of 200–1,200 words;
  - 500 cards, each side 5–60 words;
- an active practice version of 50 stems, each 10–40 words, with 4 options of 2–12 words and an explanation of 20–80 words. These options and explanations must never hit;
- one inactive practice version per material, which must never hit;
- one `card_versions` snapshot per material, holding **different** words, which must never hit;
- 1,000 notes, each with a title of 2–10 words and a body of 20–800 words;
- 500 instructor questions, each with a text of 8–60 words and an answer of 0–120 words.

*Size check.* The generator records the total canonical bytes. The corpus must be under the 32 MiB preflight, so that the measured rebuild is a real one.

**Queries:** the same six query types as 02a, with each query's expected hit identities, by category and id, from the reference scan.

**The rebuild-inclusive protocol.** Before **every** rebuild-inclusive sample, warm-ups included, the harness commits a one-row edit through a separate connection. The edit replaces one word of a fixed note's body with `editmarker<n>`, where `n` is the sample number.

A sample counts only if both of these hold:
- the harness-only diagnostic reports that this search **rebuilt**;
- the result contains `editmarker<n>`.

A sample that didn't rebuild is reported as an error, not as a time.

**Schedule:**
- 3 fresh processes;
- per query type: 3 rebuild-inclusive warm-ups and 15 timed rebuild-inclusive samples, then 3 cached warm-ups and 15 timed cached samples;
- the order is fixed and recorded.

| Target (release build, Apple M5) | Value |
| --- | --- |
| Cold rebuild, the whole corpus | ≤ 1 s |
| Cached search, p50 and p95, every query type | ≤ 20 ms and ≤ 50 ms |
| Rebuild-inclusive search, p95 | ≤ 1.2 s |
| Whole-process peak RSS, search harness | ≤ 256 MiB |
| Largest response | ≤ 65,536 bytes (hard) |

Misses are reported as misses, with their numbers, as in 02a. If the rebuild targets are missed, the fallback is incremental refresh by table fingerprint, as a separate reviewed change.

## 7. Regression cases

Each asserts exact hits **and** exclusions:
- Current content only:
  - cards come from the saved set, including untouched and regenerated sets;
  - card snapshots and inactive practice versions are never hits.
- Hidden answers:
  - practice options, correct answers and explanations are never hits, even for a query that matches only them;
  - legacy `practice_tests` JSON is never a hit.
- Freshness:
  - an edit, insert or delete in her database is reflected in the next search;
  - a commit made **during** a rebuild is picked up by the following search;
  - a superseded, timed-out or failed rebuild never serves a partial index and leaves no token.
- Interruption: the startup-race tests at points A and B, and the next-request test, are repeated for a rebuild statement.
- Bounds:
  - the 32 MiB preflight, the per-field caps and the 200,000-record cap each give their honest result;
  - deadline checks run during parsing.
- Filters:
  - material filters apply to guides, cards and practice;
  - notes and questions follow `contentTypes`;
  - a linked question follows its material.
- Deep links:
  - each page's deep link opens the record;
  - a guide or card link with a stale `rev` shows the "has changed" fallback, never different text;
  - an unknown id falls back to the plain page with the note;
  - a practice question opened during an active attempt keeps its answer hidden.
- Rendering and bounds:
  - HTML or instruction-like text in a note or card renders literally;
  - response bytes stay ≤ 65,536 with both sections full.
- The feature stays off: no request is made and nothing renders in a dormant build.

## 8. Not in this slice

- Homework records (HW-01), when they ship.
- Topic aliases and prefix search, which are still owner questions (§9 of the design).
- Search inside images (02-OCR).

## 9. Codex round 1 corrections

| # | Finding | Answer |
| --- | --- | --- |
| 1 | Rebuild resource bounds absent | The 32 MiB total preflight; per-field caps (4 MiB JSON, 1 MiB note or question) checked by `length()` before reading; a 200,000-record cap; streaming row reads with `Control::check()` per row and per parsed item; honest `too_large` results, and never a partial index (§2.1) |
| 2 | The interrupt handle didn't cover a second connection | A single connection: her database is ATTACHed read-only to the search connection, so the existing handle and every §6.2 rule cover rebuild statements. The startup-race and next-request tests are repeated for rebuild statements (§2, §7) |
| 3 | Snapshot and version publication underspecified | The exact sequence: the version is read inside the snapshot's read transaction; the index and its token are published only after `COMMIT`; failure or reconnection clears both. There is a commit-during-rebuild test (§2) |
| 4 | Active card snapshots aren't the current cards | Cards are indexed from `ai_study_sets.flashcards_json`. Card snapshots are excluded, and tests cover untouched and regenerated sets. Practice versions are confirmed current from code (§1) |
| 5 | Guide destinations lacked stable identity | Guide and card hits carry `rev`, the set's `updated_at`, and are opened only if it still matches. The summary has its own destination, and a stale link gets a "has changed" fallback (§4) |
| 6 | Measurement workload not frozen | Length ranges, a PHAK Zipf vocabulary, a hashed generated corpus, expected identities and a fixed schedule. A committed edit precedes every rebuild-inclusive sample, and each is verified to have rebuilt (§6) |
