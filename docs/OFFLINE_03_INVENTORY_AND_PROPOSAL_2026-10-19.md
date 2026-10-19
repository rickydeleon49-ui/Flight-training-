# OFFLINE-03: study material she makes herself — inventory and proposal — 19 October 2026

**Status: owner-approved scope, revision 4; implementation pending.** The independent revision-3 review was GREEN after rounds 1 and 2 were RED. Its original result is preserved in [the completion evidence](evidence/offline-03-handoff-completion-2026-10-19/proposal-revision3-independent-review.txt). Revision 4 records the owner’s five approvals and clarifies the retirement limit; that clarification is pending independent review. No OFFLINE-03 application feature or migration has been implemented.

The roadmap's [OFFLINE-03](OFFLINE_STUDY_HOMEWORK_EXPORT_ROADMAP_2026-10-18.md) asks for two things:
- **Manual content.** She can write a guide, create or edit cards and practice questions, and attach notes linked to a place in a document, all without Gemini.
- **Honest labelling.** That content is labelled **user-created** or **instructor correction**. Her edits survive regeneration. History, versions, backup and restore keep working.

The roadmap's entry rule applies: this proposal comes first, with one concrete plan, especially for a schema change.

## 1. What exists today (from the code)

**Guides and cards: `ai_study_sets`** (migration 0007)
- **Shape:** one row per material: `summary`, `sections_json` (`heading`, `body`) and `flashcards_json` (`front`, `back`, `sourcePage`).
- **Origin:** a set-level `provider`, either `gemini` or `import`. It has **no CHECK** constraint.
- **Saving:** `saveAiStudySet` replaces the whole row and stamps `provider = 'gemini'`. There is no per-item identity and no per-item origin.
- **Editing:** the UI has no way to edit a guide or card.

**Card review history** (0012)
- **Snapshots:** the first review action freezes the current cards into `card_versions` and `card_items`.
- **The constraint:** `card_versions.provider` has `CHECK (provider IN ('gemini', 'import'))`, and `cardReviewTransaction.ts` refuses any other value. SQLite can't change a CHECK without rebuilding the table, which the "migrations only ever add" rule excludes.
- **Consequence:** **a set labelled anything new could never be reviewed** unless this is handled.

**Practice questions** (0009, 0011)
- **Versions:** `practice_test_versions` and `practice_test_items` hold immutable versions; replacing a test deactivates the old version and inserts a new one. Attempts point at their own version, so history is preserved. Legacy `practice_tests` JSON is converted at startup.
- **Origin:** `provider` has **no CHECK**. Items have no per-question origin.

**Page-linked notes: `material_bookmarks`** (0015)
- **What they hold:** a page, a printed page label, a title, notes of up to 20,000 characters, and `originating_content_sha256`.
- **Staleness:** status is `verified`, `unverified` or `drifted`; a replaced file makes its bookmarks drift instead of pointing at unrelated text.
- **Coverage:** this already provides **source-linked notes at page level**, including the stale rule the roadmap asks for.

**How origin is shown today**
- **On the material page:** `studyContentProvenance.ts` and `StudyContentProvenance.tsx` label content as Gemini-generated or imported.
- **In exports:** `studyExport.ts` labels origins (`origin(provider, model)`).
- **What happens to anything else:** any other provider value falls through to the AI-generated wording. That is exactly the "current AI-generated default" the roadmap says manual content must not pass through.

**Backup and restore** copy the whole database. A new migration needs the usual registration (`src/data/migrations.ts`, the checksum registry) and the schema-validation updates that 0011–0015 needed.

## 2. Proposal

### 2.1 Stable item identity, including the summary

**Item ids.** Every section and card gets a stable `itemId` stored inside its existing JSON; practice items retain immutable version/item identities. The summary uses the material-scoped identity `summary` and its separate origin column, because its text is not JSON. Identities cover:
- the summary;
- each guide section;
- each card;
- each practice question.

**Legacy items get ids the first time they are needed.** Older items have no `itemId`. The first time a set is edited, corrected or regenerated, every item is given one in a single transaction:
- the summary gets `summary`;
- sections and cards get a new UUID each.

Nothing changes for a set until then.

**Who wrote it.** Each item can carry an optional `origin`:
- **`user`:** she wrote or edited it.
- **`instructor`:** she recorded her instructor's correction.

An item without an `origin` keeps the set's origin (Gemini or import). Existing data stays valid unchanged.

**The summary is an item like the others.** It has the same origin, preservation and export rules as sections and cards, so editing a Gemini summary marks it as hers. `summary` is a plain text column, so its origin has its own column (§2.2).

**A correction says what it replaces.** It carries `replaces: <itemId>` of the original.
- The original is no longer shown in the active set; it lives on in history (§2.2).
- So a corrected answer never appears beside the wrong one it corrects.

### 2.2 Every overwrite keeps the previous text first: migration 0016

**Why a version store.** Guides have no history today, and cards are snapshotted only when reviewed. So before any edit, deletion, correction or replacement overwrites an item or a set, the previous state is written to a new append-only table, **in the same transaction**:

```sql
CREATE TABLE study_set_history (
  id            TEXT PRIMARY KEY,
  material_id   TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('study_set', 'practice')),
  reason        TEXT NOT NULL CHECK (reason IN ('edit', 'delete', 'correct', 'regenerate', 'import')),
  previous_json TEXT NOT NULL,            -- the whole previous set or test, as stored
  provider      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_study_set_history ON study_set_history(material_id, created_at);
```

**What a history row gives her:**
- every original text and every intermediate version is recoverable, whether or not anything was ever reviewed;
- a "Previous versions" view can restore one deliberately;
- it is part of the database, so backup and restore carry it.

**Bounds:**
- one row per save;
- each row bounded by the existing set size limits;
- `ON DELETE CASCADE` with the material, like its other study data.

**Deletions and corrected originals are recorded,** not just applied.

**New columns.** Migration 0016 adds two columns to `ai_study_sets`; `ADD COLUMN` is add-only, and existing rows get the defaults:

```sql
ALTER TABLE ai_study_sets ADD COLUMN summary_origin TEXT
  CHECK (summary_origin IS NULL OR summary_origin IN ('user', 'instructor'));
ALTER TABLE ai_study_sets ADD COLUMN retired_json TEXT NOT NULL DEFAULT '[]';
```

**What `retired_json` holds.** It is a bounded list of at most 2,000 entries, one for every item she deleted and every original a correction replaced:
`{ "itemId", "kind": "summary" | "section" | "card", "reason": "deleted" | "corrected", "textKey", "terms" }`.
- **`textKey`:** the SHA-256 of the item's normalized text, meaning NFKC, lowercased, with whitespace collapsed.
- **`terms`:** its sorted distinct word set, capped at 64 words, so a near-copy can be found later (§2.4).
- **Not the text itself:** that is already preserved in `study_set_history`.

**At the 2,000-entry limit:** never evict an earlier record or silently disable reconciliation. Before beginning a save transaction, compute the full resulting retirement list, deduplicating the same `(kind, itemId, reason, textKey)` record. A result of exactly 2,000 is valid. If a save would need entry 2,001, refuse that entire save with "This study set has reached its deletion and correction history limit. Your changes haven't been saved." Retain the draft for copying or revision. The active set, history and retirement list all remain unchanged. Actions that do not grow the retirement list may still save. Increasing the limit or providing a reset/archive operation is a separate reviewed change; no automatic truncation. Tests must cover 1,999 → 2,000, a repeated record at 2,000, refusal of 2,001, and failure/cancel without any partial history write.

**Study sets get an extended save contract,** like practice questions (§2.5):
- **Two repository paths:**
  - `saveStudySetEdit` keeps `provider`, writes per-item `origin`/`replaces`, `summary_origin` and `retired_json`, and writes the history row first, all in one transaction;
  - the Gemini save path keeps working.
- **The mapper:** `mapAiStudySet` returns `manual`, `summary_origin` and `retired_json` faithfully, no longer coercing unknown providers to `gemini`.
- **Validation:** the schema validators and restore validate the new columns: their CHECK, JSON shape and bounds.

### 2.3 Card review snapshots and their fingerprints

**The constraint, again.** The legacy CHECK on `card_versions.provider` allows only `gemini` and `import`. Migration 0016 adds side tables:

```sql
CREATE TABLE card_version_origins (
  version_id TEXT PRIMARY KEY REFERENCES card_versions(id) ON DELETE CASCADE,
  origin     TEXT NOT NULL CHECK (origin IN ('manual', 'mixed'))
);
CREATE TABLE card_item_origins (
  item_id TEXT PRIMARY KEY REFERENCES card_items(id) ON DELETE CASCADE,
  origin  TEXT NOT NULL CHECK (origin IN ('user', 'instructor'))
);
```

**Fingerprints stay compatible.** Today's canonical card JSON is the sorted keys `front`, `back` and `sourcePage`. In the new version:
- **Items with an `origin`:** the canonical JSON also includes `origin`.
- **Items without one:** `origin` is omitted. **Every existing snapshot's hash, version id and history is therefore unchanged.**

**Three implementations, one rule.** The same rule is implemented in all three places:
- **The app:** `cardIdentity.ts`.
- **The native side:** `card_reviews.rs` (`canonical_cards_json`).
- **Backup and restore validation:** `backup.rs`. It joins `card_item_origins` when it recomputes a snapshot's hash.

**Shared tests,** using vectors computed outside all three:
- legacy hashes are unchanged;
- origin-bearing hashes are equal in all three implementations;
- restore rejects a snapshot whose side-table origins don't match its hash.

**Snapshot identity:** unchanged.
- A snapshot of a set with any manual item writes its true origin to the side tables.
- `card_versions.provider` gets the set's base provider, or, for a set made entirely by her, `'import'`, only because the legacy CHECK requires one of two values.

**Every reader of `card_versions.provider` is listed and fixed in 03a.** That covers the app, native code and backup. Display and export read origin only from the side tables, and a test asserts that no screen or export reads the legacy column.

### 2.4 Regeneration: matching new items against what she retired

**Why identity alone isn't enough.** New Gemini or imported items have no identity link to old ones. So whenever a set has retired entries, regeneration **reconciles** each new candidate against them **before** anything is saved.

**The rules are deterministic,** with no AI:

1. **Exact match:** a candidate whose `textKey` equals a retired entry's is **held back automatically**. The preview shows it under "Left out: matches something you deleted or corrected", and she can still choose to bring it back.
2. **Near match:** a candidate whose word set overlaps a retired entry's by Jaccard ≥ 0.6 is **unresolved**. The preview shows it beside what it resembles, and she must choose for each:
   - **Leave it out**;
   - **Keep it**.
3. **Everything else** is new, with nothing to compare it against, and listed as new.

**Save stays disabled while anything is unresolved.** The preview says plainly: "Items worded differently from something you deleted or corrected can't always be recognised. Check the new items."

**Choosing.** **Keep my items** (default) or **Replace everything**; either way, after reconciliation. Both write the previous set to `study_set_history` first. **Cancel** writes nothing.

**Corrections carry over as her items,** marked "corrects an earlier version". Because a repeat of the original wrong text is caught by rule 1 or 2, the wrong answer can't quietly return beside her correction.

**Tests:**
- a regenerated set repeating a deleted card word for word, which is held back;
- a reworded repeat of a corrected answer, which is unresolved and blocks save until she chooses;
- an unrelated new item, which is new;
- "bring it back" overriding a hold-back;
- cancel, failure and restart.

### 2.5 Practice questions: an extended save contract

The save path hard-codes `'gemini'` in both implementations: `practiceSessionTransaction.ts` on the app side and `practice_sessions.rs` natively. Both question validators rebuild questions without `origin`, and the document mapper turns unknown providers into `'gemini'`. 03b changes all of them together:
- **The IPC request:** carries `provider` (`gemini`, `import` or `manual`) and a per-question `origin`.
- **The validators:** both accept them, and still reject everything else.
- **The transactions:** persist the version's provider and, **in the same transaction**, one `practice_item_origins` row per item with an origin. That table is in migration 0016, with `item_id` → `practice_test_items.id`.
- **The mapper and the historical readers** (history, attempts, export) return origin truthfully.
- **The content hash of a version** follows the same rule as cards: `origin` is included only when present, so legacy hashes are unchanged.

Editing creates a new version. Attempts keep pointing at their own version.

### 2.6 Exports: instructor corrections stay private by default

**The rule.** Instructor corrections are **excluded from handouts and packets unless she ticks "Include my instructor's corrections"**, which defaults to off. Her own items follow the existing selection.

**The order of steps.** The choice is applied before serialization, and the handout labels each included item's origin.

**Packets (v1) can't carry `origin`.** The validator rejects unknown fields, and the roadmap rules out incompatible v1 changes. The export dialog says so: "Study packets don't record who wrote each item. When imported, everything shows as imported." Owner question 5 is about a future v2.

### 2.7 Notes linked to a page or passage

**Page level reuses bookmarks unchanged.** They are already linked to a file's content and drift when it's replaced. Search results gain "Add a note on this page".

**Passage quotes are slice 03c, later.** Migration 0016 adds a nullable `material_bookmarks.quote` (ADD COLUMN, ≤ 500 characters). Its validity is bound to `originating_content_sha256`. Quotes need extraction, which is still off.

### 2.8 Common guarantees

**Every save path:**
- uses the existing atomic save patterns;
- disables the button while busy, against duplicate submits;
- keeps her input after a failed save and offers retry;
- on cancel, writes nothing;
- after a restart, keeps nothing half-saved;
- keeps history rows on deletion, until the material itself is deleted.

**Migration 0016 ships once with 03a, all tables included.** The same change updates:
- the checksum registry and the schema validators (TS and native);
- the backup/restore validation and its tests.

**No new dependency:** plain text fields, with no rich-text editor and no offline language model.

## 3. Slices

| Slice | Delivers |
| --- | --- |
| **03a** | Item ids and origins; editing the summary, sections and cards; corrections with `replaces`; deletion records; `study_set_history` with "Previous versions"; the regeneration preview; origin-aware card snapshots in all three hash implementations; private-by-default export of corrections; migration 0016 |
| **03b** | Writing and editing practice questions through the extended IPC, validators, transactions and readers; `practice_item_origins` |
| **03c** | Later: passage quotes on bookmarks, once extraction is enabled |

**Release.** The owner approved shipping 03a and 03b enabled after acceptance; extraction and search remain dormant. See §4.

## 4. Owner decisions — approved 19 October 2026

The owner explicitly answered **"Use all five recommendations"** in this session. This approves the following implementation defaults; it does not accept code, authorize a merge or publish a release.

1. **Approved: additive migration 0016.** Add the proposed history/origin side tables, both `ai_study_sets` columns (`summary_origin`, `retired_json`), and the nullable bookmark quote column reserved for 03c. Do not rebuild `card_versions`.
2. **Approved: regeneration defaults to "Keep my items"** when regenerating a set that has her items.
3. **Approved: 03a and 03b are intended to ship enabled after implementation, independent acceptance and normal release verification.** They need no PDF extraction. This does not enable extraction/search or authorize publishing a release.
4. **Approved: defer 03c passage quotes** until extraction’s release gates are accepted. The reserved nullable column alone does not enable the feature.
5. **Approved: retain packet v1** and disclose its loss of per-item author labels before export. A new v2 format is deferred.

## 5. Verification plan (per slice)

**Exhaustive tests:**
- origin labels, including the rule that no manual or edited content ever gets AI wording, in the UI, the handout and the packet;
- the regeneration guard: keep, replace and cancel;
- atomic failure, duplicate submit and restart;
- review and practice history unchanged across edits;
- backup and restore of the new tables and fields;
- migration checksum and validator tests.

**Process:**
- Codex reviews each slice locally.
- One CI run per PR.
- Installed acceptance of the editing UI happens at release time, in the recorded synthetic lane.

## 6. Codex round 1 corrections

| # | Finding | Answer |
| --- | --- | --- |
| 1 | The summary escaped provenance and preservation | The summary is an item with id `summary`, under the same origin, preservation, regeneration and export rules (§2.1) |
| 2 | A digest doesn't preserve original text | Append-only `study_set_history`: the previous set or test is written in the same transaction before any overwrite, independent of review, carried by backup, and restorable (§2.2) |
| 3 | The practice save path drops provenance | Provider and per-question origin through the IPC, both validators, both transactions, the mapper and the historical readers, with `practice_item_origins` written atomically (§2.5) |
| 4 | "Keep my items" resurrected corrected content and ignored deletions, and skipped the preview | Stable item ids; corrections carry `replaces`; deletion records; a mandatory plain-list preview of the result before saving; history written before either choice (§2.1, §2.4) |
| 5 | No backward-compatible hash contract | `origin` is in the canonical JSON only when present, so legacy hashes are unchanged; one rule in `cardIdentity.ts`, `card_reviews.rs` and `backup.rs`, with shared vectors; restore checks side-table consistency; snapshot ids untouched (§2.3, §2.5) |
| 6 | Instructor corrections exported without a deliberate choice | "Include my instructor's corrections" defaults to off, is applied before serialization, and is labelled in handouts (§2.6) |

## 7. Codex round 2 corrections

| # | Finding | Answer |
| --- | --- | --- |
| 1 | No storage for the summary's origin or for deletion records; the study-set mapper and save contract drop provenance | Migration 0016 adds `ai_study_sets.summary_origin` and `retired_json` (add-only, with defaults); `saveStudySetEdit` with history first; a faithful mapper; validation in the schema validators and restore (§2.2) |
| 2 | Regeneration can't truly keep deleted or corrected content out | Deterministic reconciliation: exact `textKey` matches are held back, Jaccard ≥ 0.6 near-matches are unresolved and block save until she chooses, and the preview states the limit; tests for word-for-word and reworded returns (§2.4) |
