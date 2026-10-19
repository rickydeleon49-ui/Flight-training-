# OFFLINE-02c: searching saved study content — design addendum — 19 October 2026

**Status: proposal for review. Nothing here is implemented.**

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
| Guide sections | `ai_study_sets.sections_json`: each section's heading and body; `summary` as its own passage | Yes | `source_notes`, provider and model |
| Cards | `card_items` of each material's **active** `card_versions` row: front and back | Yes | Inactive (superseded) versions |
| Practice questions | `practice_test_items.question_text` of each material's **active** `practice_test_versions` row | **Stem only** | `options_json`, `correct_index`, `explanation`; inactive versions |
| Notes | `notes`: title and body | Yes | — |
| Instructor questions | `questions`: text and answer | Yes | — |

**Legacy practice tests.** `practice_tests.questions_json` predates practice versions. It is **not** indexed: it holds answers in the same JSON as the stems, and every current practice test has a version. A material whose practice test exists only in that legacy form gets no practice-question hits. Coverage doesn't count it, since it isn't a document.

**Imported content is data.** Imported study packets land in the same tables and are indexed like everything else. Their text, including HTML, Markdown or instruction-like text, is only ever rendered as text (§6.3 of the design).

## 2. Where the index lives, and how it stays current

**Placement.** Saved content is indexed in a **temporary FTS5 table on the search thread's own connection** (`temp.record_fts`, plus `temp.record`). It is never written to `content-cache.db`, her database, a migration or a backup.

**Why it can't go stale.**
- **A persistent read connection.** The search thread holds one read-only connection to her database (`her-flight-deck.db`), opened like `material_paths` does today.
- **Checked before every search.** It reads `PRAGMA data_version` from that connection. SQLite changes this value whenever **another connection** commits to the database, which covers every write the app makes.
- **Rebuilt when it changed.** When the value differs from the one recorded at the last build, or on the first search, the temp index is rebuilt inside one read transaction, which gives a consistent snapshot. Then the search runs.
- **Result:** a search never sees content older than the last commit made before it started.

**Rebuild cost** is bounded by the content limits that already exist:
- at most 500 cards per version;
- one active card version and one active practice version per material;
- notes and questions as she writes them.

It is measured (§6). If a rebuild doesn't finish by the search's 2-second deadline, the search answers `timeout` like any other. The next search tries again, and a partial index is never used.

**Deadline and interruption** cover the rebuild exactly as they cover the document query: each statement runs under the same `statement()` guard (§6.2), so the same supersede, watchdog and repeated-interrupt rules apply.

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
| Guide section | `/study/:materialId?section=<index>`: the material page scrolled to that guide section |
| Card | `/study/:materialId?card=<itemId>`: the material page's cards, with that card shown |
| Practice question | `/study/:materialId?question=<itemId>`: the question is shown **without its answer**. During an active attempt, the attempt's normal hidden-answer rules apply |
| Note | `/notes?note=<id>`: that note scrolled into view and highlighted |
| Instructor question | `/questions?question=<id>`: that question scrolled into view and highlighted |

**Re-checking before navigating.** Record ids come from the search snapshot, so the UI confirms the id still exists in the app's loaded data before it navigates. A deleted record shows the fallback note. No file hashing is involved.

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

All of this is frozen before measurement, using the 02a harness and a release build on the same hardware.

**Corpus,** generated with seed `20261019`:
- 200 materials, each with a 40-section guide, a 500-card active version and a 50-question active practice version;
- 1,000 notes and 500 instructor questions;
- every material also has one inactive card version and one inactive practice version, which must never hit.

**Queries:** the same six query types as 02a. Expected hits come from the same reference-scan method over the same canonical text, and must match exactly.

| Target (release build, Apple M5) | Value |
| --- | --- |
| Temp-index rebuild, the whole corpus above | ≤ 1 s |
| Search with no rebuild, p95, every query type | ≤ 50 ms |
| Search right after a one-row edit (rebuild included), p95 | ≤ 1.2 s |
| Whole-process peak RSS, search harness | ≤ 256 MiB |
| Largest response | ≤ 65,536 bytes (hard) |

Misses are reported as misses, as in 02a.

**If the rebuild target is missed,** the fallback is incremental refresh by table fingerprint. That fallback is a separate, reviewed change, not part of this slice.

## 7. Regression cases

Each asserts exact hits **and** exclusions:
- Active-only:
  - inactive card versions are never hits;
  - inactive practice versions are never hits.
- Hidden answers:
  - practice options, correct answers and explanations are never hits, even for a query that matches only them;
  - legacy `practice_tests` JSON is never a hit.
- Freshness:
  - an edit, insert or delete in her database is reflected in the next search, through `data_version`;
  - a superseded or timed-out rebuild never serves a partial index.
- Filters:
  - material filters apply to guides, cards and practice;
  - notes and questions follow `contentTypes`;
  - a linked question follows its material.
- Deep links:
  - each page's deep link opens the record;
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
