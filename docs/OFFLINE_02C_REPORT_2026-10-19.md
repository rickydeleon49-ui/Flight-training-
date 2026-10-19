# OFFLINE-02c: searching saved study content — 19 October 2026

**Status: implemented, measured and reviewed locally. Dormant: the same switch as document search, as the owner decided.**

The contract is the [addendum](OFFLINE_02C_SAVED_CONTENT_SEARCH_ADDENDUM_2026-10-19.md), revision 4. Codex reviewed it four times (rounds 1–3 RED, round 4 GREEN) before any code was written.

## What she gets (when enabled)

**What one search covers.** The same Study Library search covers both prepared documents and her saved study content:
- guide summaries and sections;
- the current saved flashcards, both sides;
- practice-question **stems** of the active practice test;
- her notes;
- her instructor questions.

**How results appear.** Saved content gets its own section, "In your saved study content":
- grouped by material, with "Your notes" and "Instructor questions" as their own groups;
- a line saying what was searched and what was too large to search;
- its own "Show more";
- the study-aid label: check against FAA guidance and her instructor.

**A result opens the actual item:**
- **Notes and instructor questions:** the item is shown, highlighted, even if her remembered search, filter or paging would hide it.
- **Guide sections, the summary and cards:** opened only while a SHA-256 of that item's own text still matches. Otherwise: "This study guide has changed since you searched." A timestamp can't do this check, because two saves can share one.
- **Practice questions:** shown by stem only, never with options or the answer.
- **Deleted items:** "That item isn't here any more."

**Never indexed:**
- practice options, correct answers and explanations;
- inactive practice versions and card review snapshots;
- the legacy practice JSON.

## How it works

**One connection.** Her database is attached read-only to the search thread's own connection. So the existing deadline, supersede and interrupt rules cover saved content too, and one read transaction gives a consistent snapshot.

**The index.** Saved content goes into a temporary FTS5 table, rebuilt inside the request's transaction when her database's `data_version` differs from the version the published index was built at. A rebuild is published only when that transaction commits. A rollback, timeout or storage error leaves nothing usable, so the next search rebuilds.

**Bounds** (§2.1):
- a preflight on byte totals, using `octet_length`, with a 32 MiB cap;
- per-field caps checked before a value is read;
- titles read only within 4 KiB, then clipped and stored once per material;
- a 200,000-record cap;
- deadline checks per row and per item.

A storage error marks saved content "unavailable" without failing document search.

**Tests:**
- current content only, and hidden answers;
- filters;
- freshness, including a commit that lands during a rebuild;
- every size cap;
- deadlines before the rebuild, after the re-check, and during a running query;
- shared digest vectors, identical natively and in the UI;
- each page's links, including a guide rewritten with the same timestamp.

Each review fix has a regression that fails on the previous code.

**A SQLite behavior found on the way.** At point B, the rebuild's first row returns before the next watchdog tick, so the per-row check stops it. A query that is already running is stopped by the tick, which a dedicated test holds open to prove.

## Measurement (release build, Apple M5)

The generator, the harness and then the manifest were committed before any timing (`docs/evidence/offline-02c-2026-10-19/`).

**Corpus:** 28,600 records and 16.3 MB of canonical text, drawn from the Pilot's Handbook vocabulary. The PHAK was re-extracted; its frames hash is recorded.

**Correctness, untimed:** in all three processes, all six queries returned exactly the reference-scan set, and the capped results were its exact prefix.

**Post-edit reference checks:** after each of the 324 committed slot edits, the edited note was re-checked against the independent reference scan, and its membership was unchanged every time.

**Sample admission:** a rebuild sample counted only if the search rebuilt exactly once, and a cached sample only if it didn't rebuild. No sample was rejected.

**Verdicts** come from run 3. They use the **worst single process** (nearest-rank over its 15 samples); the pooled value over all 45 samples is shown beside it.

| Target | Worst process (pooled) | Verdict |
| --- | --- | --- |
| Cold rebuild ≤ 1 s | 455 ms | Pass |
| Cached p50 ≤ 20 ms, every query | 28.2 ms (28.0) for "the", with 27,062 matches; ≤ 16.6 ms for every other query | **Missed** |
| Cached p95 ≤ 50 ms | 28.8 ms (28.5) | Pass |
| Rebuild-inclusive p95 ≤ 1.2 s | 815 ms (813) | Pass |
| Peak RSS ≤ 256 MiB | 70.3 MiB | Pass |
| Largest response ≤ 64 KiB | 18.4 KiB | Pass |

**About the miss.** It is reported as missed, not retuned. Only the worst-case query misses: its 27,062 matches are ranked and capped at 2,000 candidates.

**Earlier runs are preserved and superseded:**
- **Run 1** (`receipts/run1-identity-key-bug/`): its harness compared linked instructor questions under their material, while the frozen identities group all questions together. That made queries 0 and 5 look inexact even though their counts matched. Only that comparison was fixed.
- **Run 2** (`receipts/run2-before-admission-fix/`) satisfied every check, but Codex's final review found two gaps in the harness:
  - it logged a wrong rebuild count instead of excluding that sample;
  - it lacked the post-edit reference check on the committed note.

  Both are fixed for run 3. The earlier report's table also mislabelled pooled percentiles as process maxima; this table labels both.

No search code, target, query, corpus or schedule changed between runs. Timings agree across all three runs within 3.5%.

**Rebuild timing.** A rebuild after an edit (about 0.7–0.8 s) costs more than the cold build (about 0.45 s), because the old temporary index is cleared first. Dropping and recreating it instead could close that gap. It is noted as a follow-up, not changed here.

## Gate

- 827 native tests and 3,775 frontend tests pass.
- Typecheck, build, fmt, strict Clippy and cargo-lock pass.
- No dependency, lockfile, migration or release-flag change. `rusqlite`'s `functions` feature stays dev-only, and the release feature set is checked.

## Not verified

- **The painted UI.** Browser mode has no native side, so it waits for installed acceptance when the feature is enabled.
- **Minimum-spec Macs.**
- **The no-provider installed lane.**
