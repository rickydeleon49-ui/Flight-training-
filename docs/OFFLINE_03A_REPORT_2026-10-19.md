# OFFLINE-03a: study material she makes and edits herself — implementation report — 19 October 2026

**Status: implemented locally, pending independent (Codex) review and exact-head CI.** Not self-accepted, not merged, not released.

**Branch:** `claude/offline-03a-core-fixes`.
- **Base:** PR #236's head, `750c90c` (the Codex authoring core, itself based on accepted main `fc3ef34`).
- **Contract:** [proposal revision 5](OFFLINE_03_INVENTORY_AND_PROPOSAL_2026-10-19.md), owner-approved on 19 October 2026.
- **Branch history:** this branch carries #236's authoring core with Claude's round-1 review corrections, followed by the persistence and interface work below. It supersedes #236.

## What she can now do

**Write her own study guide.**
- On any material without a set, including one with no file, she can choose **Write your own study guide**. Nothing is sent anywhere.
- The set is stored with provider `manual`. It is labelled "Your study guide", "Written by you" and "Created <date>", and never as Gemini output.

**Edit any study guide.** **Edit study guide** lists the summary, every section and every card, with **Edit**, **Instructor's correction** and **Delete**, plus **Add a section** and **Add a card**.
- **Edit:** marks the item "Written by you" and keeps its identity and source page.
- **Instructor's correction:** replaces the original with a new item that records `replaces`. The original leaves the active set, so the wrong answer never sits beside the correction.
- **Corrections stay corrections:** editing an instructor correction later keeps it labelled as one.
- **Unchanged saves:** an edit that changes nothing saves nothing.
- **Untouched items:** generated and imported items keep their base provenance.

**Every change is kept first.**
- Each save writes the whole previous set, column for column, to `study_set_history` before anything changes, in the same transaction.
- **Previous versions** lists every earlier version, and **Restore** brings one back. Restoring first keeps the current set.
- What she retired since that version stays retired: the two retirement lists are joined.

**Regenerating keeps her items.** When a set holds her items, corrections, deletions or rewrites, a finished Gemini answer is not saved as it is. It waits behind **Review the new study guide and cards**:
- new items repeating something she deleted or corrected are left out, and **Bring it back** is available for each;
- near-repeats (Jaccard ≥ 0.6) block **Save** until she chooses **Leave it out** or **Keep it**;
- the dialog states that heavier rewording can escape matching;
- **Keep my items** is the default, and **Replace everything** is available; she can also keep her own summary.
- **Cancel** writes nothing.

As a safety net, the plain save refuses to replace such a set even if a screen never offered the review.

**Exports keep her instructor's corrections private.**
- Handouts and packets leave instructor corrections out unless she ticks **Include my instructor's corrections** (off by default). The filter is applied before anything is serialized.
- Handouts label items "(written by hand)" or "(instructor correction)".
- Packets stay strict v1: no ids, origins or `replaces` travel, and the export dialog says "Study packets don't record who wrote each item. When imported, everything shows as imported."
- The packet's provenance note never calls her set AI-generated, and says when some items were handwritten.

## Storage: migration 0016 (add-only)

**Contents** (`src-tauri/migrations/0016_manual_study.sql`, registered in `lib.rs`, `migrations.ts` and `migration-checksums.json`; migrations 0001–0015 are byte-identical):
- `study_set_history`;
- `card_version_origins`, `card_item_origins` and `practice_item_origins`;
- `ai_study_sets.summary_origin` and `retired_json`;
- the nullable `material_bookmarks.quote`, reserved for 03c and not written.

**One deviation from the approved SQL text:** the history `reason` CHECK also allows `'restore'`, so restoring an earlier version is recorded as what it was. The CHECK is on a new table, so this stays add-only.

**Item identity.** Sections and cards carry `itemId`, optional `origin` (`user` | `instructor`) and `replaces` inside their existing JSON. The summary's identity is the material-scoped `summary`, with its origin in `summary_origin`. Legacy items get ids the first time their set is edited, all in that one save.

## One atomic save, both engines

The two implementations:
- desktop: `save_study_set_atomically` (`src-tauri/src/study_sets.rs`);
- browser and tests: `executeStudySetSave` (`src/data/studySetTransaction.ts`).

They accept and refuse the same operations with the same codes and fixed messages:
- `INVALID_ARGUMENT`;
- `STALE_CONTENT`;
- `RETIREMENT_LIMIT`;
- `NOT_FOUND`;
- `STORAGE_ERROR`;
- and, on the app side only, `IPC_TRANSPORT_ERROR`.

**The operation's contents:**
- the set she opened, **every stored column**;
- the next set;
- a reason: `create`, `edit`, `correct`, `delete`, `regenerate`, `restore` or `remove`;
- a lowercase UUID v4.

**What one transaction does, in order:**
1. Refuses a missing material.
2. Recognises a retry: the history row's id is the operation id, or for a create, the stored set already equals the next set. It then answers `already_saved`.
3. Refuses any difference from the set she opened as `STALE_CONTENT`. Timestamps alone are never the check.
4. Writes the whole previous row to history.
5. Writes the next set, or removes it.

**Validation, applied identically on both sides:**
- exact keys and nonblank text;
- trimmed code-point bounds, the same measure as card review and import;
- unique ids, with `summary` never used for a section or card;
- `replaces` only beside an origin;
- the retirement list: at most 2,000 distinct entries, with no eviction, and the structure the authoring core produces.

**Failure and retry:**
- An injected failure rolls back history and content together.
- The interface keeps her text after a failed save.
- Buttons lock synchronously.
- After an uncertain failure, a retry resends the same operation, so it can't apply twice.

**Gemini and removal go through it too.**
- `saveAiStudySet` (first generation and plain regeneration) and `removeAiStudySet` now use this save. A regeneration or removal therefore keeps the previous set in history, and a regeneration carries her retirement list over.
- Structured imports always create a new material and never replace a set, so they need no preview.

## Review cards: origin in the fingerprint, legacy hashes unchanged

**The rule.** The canonical card JSON includes `origin` only when a card has one. It is implemented identically in three places:
- `cardIdentity.ts`;
- `card_reviews.rs`;
- both backup and restore validators.

Every legacy snapshot keeps its hash, version id and history.

**Independent checks.** Golden values computed independently with Python `hashlib` are in `src/testing/cardOriginVectors.json`. Both the TypeScript and Rust tests read them, and they cover both a legacy set and an origin-bearing set.

**Snapshot writes:**
- A snapshot writes each card's origin to `card_item_origins`.
- It writes the snapshot's own origin to `card_version_origins`: `manual` when she wrote every card, `mixed` when some.
- `card_versions.provider` stays within its legacy CHECK. A set she wrote records `import` there as a placeholder.
- A source test asserts that no app or native query reads that column.

**Restore.** Changing or deleting a side-table origin fails the snapshot's hash check, and a wrong snapshot origin is refused.

## Backup and restore

**Schema 16 is checked natively and in the browser twin.** A database at schema 16 is checked by:
- `verify_schema_16_manual_study_semantics` (native);
- `validateManualStudyState` (browser).

**What they check:**
- tables, columns, foreign keys, CHECKs, keys and the index match migration 0016;
- no orphan rows;
- each `retired_json` is well-formed;
- each history row holds a whole set.

**Older backups.** The schema-15 navigation check now compares against the reference schema of the database's own version. A schema-15 backup therefore still restores, even though 0016 adds a column to `material_bookmarks`. A test covers this. `docs/backup-format.md` describes the new checks.

**The schema-14 helper.** It stays frozen. Its test now pins the same four later-schema alarms, naming migrations 15 and 16. Among them, it records that 0016 adds columns to `ai_study_sets` and `material_bookmarks`. The helper itself is unchanged.

## Behaviour changes worth checking in review

1. **Strict validation of Gemini saves.** A Gemini study set is now saved through the strict validator:
   - title ≤ 500 code points;
   - section and card bounds;
   - nonblank card sides.

   Previously an over-limit or blank card was stored, and card review then showed the set as damaged. Now that answer refuses to save and stays available to save again or discard.
2. **Out-of-range Gemini pages.** A Gemini page reference outside 1–1,000 is stored as no page, rather than refusing the whole guide. Such a page could not be opened or reviewed before either.
3. **Retirement on ordinary rewrites.** Ordinary rewrites enter the retirement list, as recorded in revision 5. Every saved wording change uses a slot until the reset/archive follow-up.

## Verification (local, Node 22, SDK 26.5)

- **Focused frontend:** each area was run first: the authoring core (57), editing logic (12), transactions and repository on node:sqlite and sql.js (37), the material-page interface (7), exports and handouts (26) and the provider-reader audit (1).
- **Native:** 844 passed, 11 ignored. Clippy with `-D warnings` exits 0, and `cargo fmt --check` exits 0.
- **Schema-14 helper:** 26/26.
- **Full frontend gate:** typecheck exit 0; **3,906 passed, 6 skipped**, with zero unhandled errors; build exit 0; cargo-lock and `git diff --check` exit 0. Receipts, including the earlier failed attempt, are in `docs/evidence/offline-03a-2026-10-19/`.

## Not done here, and still open

- **03b practice questions.** `practice_item_origins` exists but nothing writes it yet. 03b comes after this is reviewed and merged.
- **03c passage quotes:** deferred. The `quote` column is reserved and unused.
- **Origin labels in library-wide review lists.** Card origin appears in the material's review snapshot (`CardReviewSnapshotItem.origin`) and on the material page. The library-wide "Review due" and "Recent reviews" readers are unchanged, so their shared fixtures still hold. They show no author labels, and none of them claims Gemini authorship.
- **Preview speed.** A regeneration preview against a full 2,000-entry list took about 1.3 s in Node on this Mac. It runs on the interface thread when she opens the review. It has not been measured on minimum-spec hardware.
- **Installed acceptance** of the editing screens, in the synthetic release lane, is still needed.
- **Unchanged follow-ups:** FLAKE-CR-01, the 02c cached p50 miss, extraction and search release gates, and minimum-spec and pressure testing.
- **Not run:** no provider, real profile or key, installer or release work. Extraction and search stay dormant.
