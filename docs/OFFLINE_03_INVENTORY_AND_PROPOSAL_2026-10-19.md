# OFFLINE-03: study material she makes herself — inventory and proposal — 19 October 2026

**Status: proposal for review and owner decisions. Nothing here is implemented.**

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

### 2.1 Origin is recorded per item, inside the existing JSON

**The fields.** Each section, card and practice question can carry an optional `origin`, and each section and card an optional `editedFrom`:
- **`origin`:** `"user"` (she wrote or edited it) or `"instructor"` (she recorded her instructor's correction).
  - Items without it keep the set's origin (Gemini or import), so existing data is unchanged and valid.
- **`editedFrom`:** a digest of the item's previous text, kept so an edit is visibly a deliberate change of something that existed.

**Set-level origin:** `provider = 'manual'` for a set she created from nothing. That is allowed, because `ai_study_sets` has no CHECK.

**Labels:**
- items show "You wrote this" or "Instructor correction";
- a mixed set's label lists what it contains, for example "Gemini-generated, with 3 items you corrected";
- exports carry the same wording.

**Never an AI default.** No item or set that she wrote may be described with the AI-generated wording. Tests enforce this for the material page, the handout and the packet.

**Study packets (v1) can't carry `origin`.** The validator rejects unknown fields ("This field is not part of format version 1"), and the roadmap rules out incompatible v1 changes.
- **On export:** a packet writes items without `origin`.
- **The export dialog says so plainly:** "Study packets don't record who wrote each item. When imported, everything shows as imported."
- **The printable handout does carry the labels.**
- **Owner question 5:** whether recording origin in packets needs a v2 format later.

### 2.2 Reviewing manual or edited cards: migration 0016, add-only

The `card_versions` CHECK can't accept a new provider, so a snapshot of a set with any manual content needs another way to record its origin.

**Recommended: a side table.** It is add-only, and existing tables are untouched:

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

**How a snapshot is stored:**
- **Content:** the snapshot's content hash, and so its identity, covers each item's `origin`.
- **The `provider` column:** for a snapshot containing manual content, it holds the set's *base* provider. For a set created from nothing, there isn't one, and `'import'` would be a lie.

**How that column is used:**
- **Display:** the app's display reads origin only from `card_version_origins` and `card_item_origins`, never from `card_versions.provider`.
- **The rule in code:** snapshot provider is a compatibility field. A test asserts that no screen or export reads it.
- **For a manual-only set:** the column holds `'import'` only to satisfy the legacy CHECK, and the side table's `'manual'` is the truth.

**Owner question 1** below asks to approve this, or to choose the alternative: rebuild `card_versions` without the CHECK. That isn't add-only and risks review history, so it is not recommended.

**Practice questions** need no change to an existing table. Migration 0016 adds `practice_item_origins` (`item_id` → `practice_test_items.id`, origin `user` or `instructor`), and practice versions use `provider = 'manual'` when created from nothing.

### 2.3 Edits never silently disappear

**Which items count as hers:** every item with an `origin` is hers.

**Regeneration of a set that contains her items** (a new Gemini set, or a new import) shows a confirmation before anything is saved:
- **The prompt:** "This set has 3 items you wrote or corrected."
- **The choices:**
  - **Keep my items** (default): her items are kept and listed after the new ones, marked as hers;
  - **Replace everything:** her items go, and the old version stays in review and practice history as it does today;
  - **Cancel.**
- **A change preview showing differences** (HUB-03's jsdiff candidate) is **not** proposed here. It would need the owner's dependency approval. Listing the kept items is enough for now.

**Edits** go through the existing atomic save paths:
- `saveAiStudySet` gains a variant that keeps `provider` and writes per-item `origin`;
- practice edits create a new version through `savePracticeTestAtomically`'s replacement path, so attempts on the old version keep their questions.

Each path has duplicate-submit guards (busy flags, as elsewhere), cancel, failed-save retention and restart recovery, tested like the existing study-aid save flows.

### 2.4 Notes linked to a passage

**Page level is covered.** Bookmarks already link a note to a page of a specific file and mark it drifted on replacement. 03 reuses them unchanged, with an "Add a note on this page" entry point from offline search results (02b).

**Passage level is optional, slice 03c.** It needs the extracted page text (OFFLINE-01), which only exists once extraction is enabled:
- **Storage:** a nullable `quote` column on `material_bookmarks`, added by `ALTER TABLE … ADD COLUMN` in 0016, which is add-only. It holds up to 500 characters of the matched passage, so a note shows what it was about.
- **Staleness:** a quote is valid only for its `originating_content_sha256`, which inherits the existing drift rule.
- **No highlighting in a PDF reader:** the app has no embedded reader, and adding one is out of scope.

### 2.5 No new dependencies

Plain text fields are enough, matching how guides render today with `GuideBody`. There is no rich-text editor and no offline language model.

## 3. Slices

| Slice | Delivers | Migration |
| --- | --- | --- |
| **03a** | Write a guide from nothing; add, edit and delete sections and cards; per-item origin and labels (UI, handout, packet); the regeneration guard; card review for manual and mixed sets | 0016: `card_version_origins`, `card_item_origins` |
| **03b** | Write, edit and delete practice questions, with new versions and history preserved | 0016 (same migration): `practice_item_origins` |
| **03c** | Optional: quoted-passage notes from offline search results | 0016: `material_bookmarks.quote` (ADD COLUMN) |

**One migration covers all three slices,** so her database moves once. It ships with 03a, and its tables stay unused until 03b and 03c. Migration checksums, the schema validators and backup-restore tests are updated in 03a.

**These features don't depend on the extraction gate** except 03c's quotes. They could ship enabled, because they involve no PDF parsing. **Owner question 3** asks about that.

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
