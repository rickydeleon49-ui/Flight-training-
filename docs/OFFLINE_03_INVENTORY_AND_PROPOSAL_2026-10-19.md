# OFFLINE-03: study material she makes herself — inventory and proposal — 19 October 2026

**Status: proposal for review and owner decisions, revision 2.** Codex round 1 was RED with six findings; §6 maps each to its answer. Nothing here is implemented.

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

**Item ids.** Every item gets a stable `itemId`, stored inside the existing JSON:
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

**The summary is an item like the others.** It has the same origin, preservation and export rules as sections and cards, so editing a Gemini summary marks it as hers.

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

**Deletions are recorded,** not just applied. The active set's JSON keeps a `deleted` list of `itemId`s, so a later regeneration can't bring a deleted item back silently (§2.4).

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

### 2.4 Regeneration: a preview, then her choice

When Gemini regenerates or an import replaces a set that contains her items or deletion records, nothing is saved until she has seen a **preview of the result**.

**The preview:**
- **Lists:**
  - new items;
  - her items that will be kept;
  - originals that her corrections replace, which stay hidden;
  - items she deleted, which stay deleted.
- **Has no diff library:** it is a plain list of what will be in the set. HUB-03's preview requirement is met without adopting jsdiff.
- **Offers three choices:**
  - **Keep my items** (default): her items, corrections and deletions carry over;
  - **Replace everything:** the new set replaces it all;
  - **Cancel.**

**Either save writes the previous set to `study_set_history` first.** So "Replace everything" is recoverable.

**How a correction carries over.** Its `replaces` target is an item of the *old* set, so it can't be matched to new Gemini text. It carries over as her item, marked "corrects an earlier version", and the preview shows it under her items. It never sits beside the original it replaced, because that original isn't in the new set.

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

**Release.** 03a and 03b need no PDF extraction, so they could ship enabled (owner question 3).

## 4. Owner questions

1. **Migration 0016 as proposed** (side tables plus one added column), rather than rebuilding `card_versions`. Recommended: approve.
2. **Regeneration default:** "Keep my items" as the default choice when regenerating a set that has her items. Recommended: yes.
3. **Release:**
   - **Option A:** 03a and 03b ship **enabled** in the next release, since they need no PDF extraction.
   - **Option B:** they stay dormant with offline search.

   Recommended: A. They work entirely from her saved data, like today's study aids.
4. **03c now or later:** passage quotes depend on extraction, which is still disabled. Recommended: later, after the memory cap is accepted.
5. **Packets and origin:** v1 can't record who wrote an item, so for now the export dialog discloses it. Recommended: leave a v2 packet format for when it's actually needed, for example when sharing with an instructor.

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
