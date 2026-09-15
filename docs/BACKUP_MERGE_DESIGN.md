# Backup Merge Design Specification

> **Status: Architectural Design Specification Only**
>
> This document specifies the safety constraints, schema inventory, conflict-resolution rules, and transactional rollback architecture for a future Backup Merge capability.
> **Merge is not implemented in the current codebase.** No merge commands are exposed in the Rust backend, no migrations are added, and no merge UI exists.

---

## 1. Executive Summary & Core Principles

Her Flight Deck currently provides a robust, defensive **Full Restore** capability: a user can restore a portable `.hfdbackup` archive, replacing the local database and documents with safety snapshots taken beforehand.

A **Backup Merge** capability serves a different purpose: allowing a pilot training across multiple devices (e.g., studying on an iPad or iPhone while logging flights and debriefs on a desktop Mac or Windows PC) to integrate changes from an export into her active local installation without discarding data accumulated on either side.

Unlike a full restore, merging into a live database presents acute risks of silent data corruption, foreign-key cascade destruction, and partial filesystem desynchronization. This document establishes the strict architectural requirements for safe merging.

### Core Invariants

1. **Zero Data Loss:** Local training history must never be silently overwritten, truncated, or removed by an incoming merge.
2. **Referential Integrity:** Merge operations must never violate SQLite foreign keys or leave dangling orphaned records or files.
3. **Dual-Layer Atomicity:** SQLite transactions cannot roll back filesystem writes; the merge architecture must coordinate database and file changes under a crash-resilient journal.
4. **No Blanket Assumptions:** Generic Last-Write-Wins (LWW) is prohibited because several domain tables lack timestamps, and device clocks cannot guarantee causal ordering.

---

## 2. Prohibition of `INSERT OR REPLACE`

```
  ⚠️ CRITICAL ARCHITECTURAL HAZARD: INSERT OR REPLACE
  In SQLite, `INSERT OR REPLACE` (or `INSERT ... ON CONFLICT REPLACE`)
  is syntactic sugar for a `DELETE` of the conflicting row followed by an
  `INSERT` of the incoming row.
```

When foreign keys are active (`PRAGMA foreign_keys = ON;`), deleting an existing row immediately executes that foreign key's configured delete rule on all referencing child tables:

- An `INSERT OR REPLACE INTO study_materials` deletes the existing study material row before inserting the incoming version.
  - Triggers `ON DELETE CASCADE` on `material_tags`, deleting every tag association!
  - Triggers `ON DELETE CASCADE` on `event_materials`, detaching the material from every flight lesson!
  - Triggers `ON DELETE CASCADE` on `journal_materials`, wiping lesson debrief attachments!
  - Triggers `ON DELETE CASCADE` on `ai_study_sets` and `practice_tests`, permanently destroying local AI study aids!
  - Triggers `ON DELETE SET NULL` on `questions`, orphaning study questions!
- An `INSERT OR REPLACE INTO schedule_events` deletes the existing event row before replacement:
  - Triggers `ON DELETE CASCADE` on `event_prep_items`!
  - Triggers `ON DELETE SET NULL` on `transactions`, disconnecting recorded lesson costs!
  - Triggers `ON DELETE SET NULL` on `journal_entries`, severing flight logs from their schedule events!

### Mandatory Rule
**Merge logic must never execute `INSERT OR REPLACE`.**

All merge operations must distinguish between **inserting novel rows** (using standard `INSERT INTO`) and **updating existing rows** (using targeted `UPDATE ... WHERE id = ...` or `INSERT INTO ... ON CONFLICT(id) DO UPDATE SET ...` updating specific columns while leaving the underlying row identity and child foreign-key associations intact).

---

## 3. Comprehensive Table-by-Table Schema Inventory

Across all migrations (0001 through 0009), the Her Flight Deck database comprises 21 tables. Each table exhibits distinct primary key structures, foreign key behaviors, and timestamp availability.

| Table Name | Primary Key | Foreign Keys & Actions | Table Category | `updated_at` Available? | Merge Strategy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `settings` | `id` (`CHECK (id = 'profile')`) | `current_milestone_id` (soft ref to `milestones(id)`) | Singleton (1 row) | **Yes** (`created_at`, `updated_at`) | Field-by-field merge; prompt on diverging user settings |
| `milestones` | `id` (UUID) | None | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff and preview conflicting matching IDs |
| `goals` | `id` (UUID) | `milestone_id REFERENCES milestones(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`, `completed_at`) | Insert novel; completed status takes precedence or prompts |
| `goal_checklist_items` | `id` (UUID) | `goal_id REFERENCES goals(id) ON DELETE CASCADE` | Child Entity | **NO** (`created_at` only) | Union completion (`done = 1` wins); preserve items |
| `schedule_events` | `id` (UUID) | `goal_id REFERENCES goals(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff dates/times; preview conflicting IDs |
| `event_prep_items` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE CASCADE` | Child Entity | **NO** (`created_at` only) | Union completion (`done = 1` wins); preserve items |
| `study_materials` | `id` (UUID) | `goal_id REFERENCES goals(id) ON DELETE SET NULL`, `event_id REFERENCES schedule_events(id) ON DELETE SET NULL` | Domain Entity + File | **Yes** (`created_at`, `updated_at`, `last_reviewed_at`) | Match by SHA-256 hash or UUID; stage PDF; update metadata |
| `tags` | `id` (UUID), `name UNIQUE` | None | Dimension / Tag | **NO** (`created_at` only) | Natural key unification by `name`; remap incoming IDs |
| `material_tags` | `(material_id, tag_id)` | `material_id REFERENCES study_materials(id) ON DELETE CASCADE`, `tag_id REFERENCES tags(id) ON DELETE CASCADE` | Join Table | **NO** (no timestamps) | Pure additive set union (`INSERT OR IGNORE`) |
| `event_materials` | `(event_id, material_id)` | `event_id REFERENCES schedule_events(id) ON DELETE CASCADE`, `material_id REFERENCES study_materials(id) ON DELETE CASCADE` | Join Table | **NO** (no timestamps) | Pure additive set union (`INSERT OR IGNORE`) |
| `next_actions` | `id` (UUID) | Polymorphic soft ref (`related_type`, `related_id`) | Domain Entity | **Yes** (`created_at`, `updated_at`, `completed_at`) | Insert novel; completed status takes precedence or prompts |
| `journal_entries` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE SET NULL`, `goal_id REFERENCES goals(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff flight log times; prompt on conflicts |
| `journal_materials` | `(journal_id, material_id)` | `journal_id REFERENCES journal_entries(id) ON DELETE CASCADE`, `material_id REFERENCES study_materials(id) ON DELETE CASCADE` | Join Table | **NO** (no timestamps) | Pure additive set union (`INSERT OR IGNORE`) |
| `questions` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE SET NULL`, `material_id REFERENCES study_materials(id) ON DELETE SET NULL`, `journal_id REFERENCES journal_entries(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`, `answered_at`) | Insert novel; answered questions preserve answers |
| `transactions` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE SET NULL`, `goal_id REFERENCES goals(id) ON DELETE SET NULL`. Unique index on `(event_id)` where `source = 'lesson_cost'` | Domain Entity (Finance) | **Yes** (`created_at`, `updated_at`) | Insert novel; enforce partial index for lesson costs |
| `fund_goals` | `id` (UUID) | None | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff target amounts; prompt on conflicts |
| `app_metadata` | `key` (TEXT) | None | Key-Value Metadata | **NO** (no timestamps) | Idempotent insertion; boolean flags use affirmative OR |
| `pilot_toolkit` | `id` (`CHECK (id = 'toolkit')`) | None | Singleton (1 row) | **Yes** (`updated_at` only) | Structured sub-key JSON comparison; prompt on collision |
| `ai_study_sets` | `source_material_id` (REFERENCES `study_materials(id) ON DELETE CASCADE`) | `source_material_id` | 1-to-1 Extension | **Yes** (`generated_at`, `updated_at`) | Retain newer or prompt; never replace before parent |
| `notes` | `id` (UUID) | None | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff title/body; prompt or fork on conflict |
| `practice_tests` | `source_material_id` (REFERENCES `study_materials(id) ON DELETE CASCADE`) | `source_material_id` | 1-to-1 Extension | **Yes** (`generated_at`, `updated_at`) | Retain newer or prompt; never replace before parent |

---

## 4. Why Generic Last-Write-Wins (LWW) is Prohibited

A naive merge strategy relies on Last-Write-Wins based on an `updated_at` column. In Her Flight Deck, this approach fails on multiple technical grounds:

1. **Missing Timestamps on 7 Tables:**
   - `goal_checklist_items`, `event_prep_items`, and `tags` only possess `created_at`.
   - `material_tags`, `event_materials`, and `journal_materials` carry no timestamps whatsoever.
   - `app_metadata` possesses only `key` and `value`.
   A generic LWW algorithm cannot operate on tables lacking modification timestamps.
2. **Clock Skew Across Disconnected Offline Devices:**
   - Her Flight Deck is designed for offline cockpit and flight school environments.
   - Mobile and desktop hardware clocks drift or may be set incorrectly by the user. If an iPad's clock is 2 hours behind desktop, applying LWW would cause stale desktop data to clobber fresh iPad edits or vice versa.
3. **Row-Level Overwrites Destroy Multi-Device Field Edits:**
   - If a pilot updates her `flight_school` on desktop and her `medical_expiry` on iPad, a row-level LWW would discard one of those edits completely.

---

## 5. Explicit Handling by Entity Category

### 5.1 Singleton Tables (`settings`, `pilot_toolkit`)
- **`settings` (`id = 'profile'`):**
  - Compare individual fields between local and incoming rows.
  - If a local field is empty (`""` or `NULL`) while the incoming field is populated, safely populate it.
  - If both sides have different non-empty values (e.g., different `pilot_name`, `medical_expiry`, `accent_color`, or profile photo), the difference **must be presented to the user in Conflict Preview**. The user selects which field value to keep.
- **`pilot_toolkit` (`id = 'toolkit'`):**
  - Contains `state_json` representing calculation history (Weight & Balance, Crosswind, V-Speeds).
  - Parse and diff the JSON payloads by calculator module. Non-colliding calculator states are merged; colliding calculations are presented in preview.

### 5.2 Key-Value Metadata (`app_metadata`)
- Novel keys are inserted directly.
- Colliding keys with idempotent semantics (such as `starter_pack_installed = 'true'`) resolve using affirmative logic (`'true'` wins). Other conflicting keys are surfaced.

### 5.3 Tags & Dimension Records (`tags`)
- Tags are identified by their unique natural key: `name`.
- If an incoming tag has a different UUID `id` but identical `name` to an existing local tag:
  - Do **not** insert a duplicate tag (which would violate `UNIQUE(name)`).
  - Remap the incoming tag's UUID to the local tag's UUID for all referencing records in the incoming staging set before evaluating join tables.

### 5.4 Join Tables (`material_tags`, `event_materials`, `journal_materials`)
- All join tables represent many-to-many set memberships without independent timestamps.
- Merge strategy is a **pure additive set union**:
  ```sql
  INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?);
  ```
- No existing join relationship is ever deleted during a merge unless an explicit deletion tombstone exists.

### 5.5 Checklists and Prep Items (`goal_checklist_items`, `event_prep_items`)
- Child items have `id`, parent ID, `title`, `done` (0 or 1), and `position`, with only `created_at`.
- Novel item IDs are inserted under the parent entity.
- For colliding item IDs:
  - If either side has marked `done = 1`, the item resolves to `done = 1` (completion monotonicity).
  - If titles differ, surface in Conflict Preview.

### 5.6 Study Materials & Physical Documents (`study_materials` + `documents/`)
- Study materials consist of a database row and a physical file stored in `<app_root>/documents/`.
- **Content Hash Deduplication (SHA-256):**
  - Before copying an incoming document file, compute its SHA-256 hash and compare against existing local documents.
  - If a local document matches the hash, reuse the local file path instead of duplicating disk storage.
- **Filename Collision Avoidance:**
  - If an incoming file has a distinct hash but conflicts on its relative file path, allocate a new safe destination using the existing `reserve_destination` pattern (e.g., `<material_id>-<name>.pdf`).
- **Referential Timing:**
  - Files must be staged and verified before database records are committed. Database records must never reference nonexistent file paths.

### 5.7 UUID Domain Entities (`milestones`, `goals`, `schedule_events`, `journal_entries`, `questions`, `transactions`, `notes`, `fund_goals`)
- **Novel UUIDs:** Distinct IDs that exist in the incoming archive but not locally are inserted, ensuring parent FKs (`milestone_id`, `goal_id`, `event_id`) are inserted before children.
- **Identical Content:** Rows with identical IDs and byte-identical contents are skipped as no-ops.
- **Colliding UUIDs with Conflicting Content:**
  - When timestamps differ, the system records the diff.
  - Differences in high-consequence fields (e.g. flight hours in `journal_entries`, financial amounts in `transactions`, target dates in `goals`) **must be presented in Conflict Preview**.
  - For `notes`, provide the user an option to "Keep Both" by duplicating the incoming note under a newly generated UUID v4.

### 5.8 Future Deletion Tombstones
Currently, Her Flight Deck performs hard deletes (`DELETE FROM ...`), leaving no residual record in SQLite. Without tombstones:
- If Device A deletes Goal #1, and Device B has not connected since, merging Device B back into Device A will interpret Goal #1 as a "novel" record from B and resurrect it on A.
- To make merge fully deterministic, a future schema migration will introduce a dedicated `tombstones` table:
  ```sql
  CREATE TABLE tombstones (
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    deleted_at  TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  );
  ```
- **Tombstone Merge Rule:**
  - When merging, if an incoming record's ID matches a local tombstone with `deleted_at > incoming.updated_at`, the record remains deleted and is discarded from the merge set.
  - If `incoming.updated_at > deleted_at`, the record was modified on another device *after* the deletion, representing an ambiguous conflict presented in Conflict Preview.

---

## 6. Conflict Preview & User Decision Workflow

Because automated heuristics cannot know pilot intent, the merge engine must be split into an **Analysis Phase** and an **Execution Phase**.

```
[Incoming Backup] + [Active Database]
           │
           ▼
    ┌──────────────┐
    │ Analysis     │ (Headless, read-only inspection)
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Merge Diff   │ ──► [Unambiguous New Records] ──► Automatically Staged
    │ Summary      │ ──► [Identical Records]       ──► Skipped
    └──────┬───────┘ ──► [Ambiguous Conflicts]    ──► User Decision Required
           │
           ▼
    ┌──────────────┐
    │ UI Conflict  │ (Displays side-by-side field diffs)
    │ Preview      │ (User selects: "Keep Local", "Use Incoming", or "Keep Both")
    └──────┬───────┘
           │
           ▼ (User Confirms)
    ┌──────────────┐
    │ Execution    │ (Transactional filesystem + SQLite execution)
    └──────────────┘
```

### Ambiguous Conflicts Requiring User Selection
1. **Conflicting Profile Details:** Divergent pilot names, medical expirations, or profile photos.
2. **Conflicting Journal Flight Logs:** Discrepant dual received, PIC, or solo flight hours for the same lesson ID.
3. **Lesson Cost Collisions:** Two different cost transactions claiming the singleton `idx_transactions_one_lesson_cost` index for the same event ID.
4. **Conflicting Note Content:** Divergent body text for the same note UUID.

---

## 7. Durable Dual-Layer Rollback & Recovery Journal

### The Atomicity Problem
SQLite transactions (`BEGIN TRANSACTION ... COMMIT`) provide ACID guarantees for database pages. However, **SQLite cannot roll back filesystem copy or delete operations.** If 500 MB of PDF documents are copied into `<app_root>/documents/` and the SQLite transaction then fails on a constraint violation, or if the process crashes mid-copy, the application is left in a damaged, inconsistent state.

### Multi-Stage Protocol with Recovery Journal

```
Stage 1: Sandbox Extraction & Manifest Validation
         Extract `.hfdbackup` into `<app_root>/staging/merge_<uuid>/`.
         Verify v2 format, schema compatibility, and SHA-256 manifest.

Stage 2: Live Database Snapshot
         Take an atomic SQLite Online Backup of the live database into
         `<app_root>/rollback/pre_merge_db.sqlite`.

Stage 3: Persist Recovery Journal
         Write `<app_root>/merge_journal.json` to disk with state `"staged"`.
         Record all file paths to be copied and the snapshot path.

Stage 4: Staged File Deployment
         Copy incoming files into `<app_root>/documents/` with temporary names
         (`<filename>.incoming_<uuid>`).
         Update journal state to `"files_staged"`.

Stage 5: Database Merge Transaction
         BEGIN IMMEDIATE TRANSACTION in SQLite.
         Execute explicit inserts and non-deleting updates.
         Execute `PRAGMA foreign_key_check;`.
         COMMIT TRANSACTION.
         Update journal state to `"db_committed"`.

Stage 6: Atomic File Promotion
         Atomically rename `.incoming_<uuid>` files to their final names.

Stage 7: Cleanup
         Remove temporary sandbox and rollback snapshot.
         Delete `merge_journal.json`.
```

### Crash Recovery & Cleanup Rules
- **Failure Prior to Step 5 Commit:**
  - Roll back the SQLite transaction (or restore from `pre_merge_db.sqlite` if transaction failed mid-flight).
  - Delete all `.incoming_<uuid>` files listed in `merge_journal.json`.
  - Remove staging sandbox.
  - Delete `merge_journal.json`.
  - **Result:** Live application state is 100% untouched.
- **Application Startup Recovery Hook:**
  - Upon every startup, the application checks for `<app_root>/merge_journal.json`.
  - If found with state `"staged"` or `"files_staged"`: an interrupted merge crashed before commit. The app restores `pre_merge_db.sqlite` over the active database, deletes any lingering `.incoming` files, clears staging, and deletes the journal.
  - If found with state `"db_committed"`: the database committed, but file promotion or cleanup was interrupted. The app finishes promoting the `.incoming` files and deletes the journal.

---

## 8. Backup Format Version Compatibility

### Format Version 2 Required for Merge
- **Format v2** backups include a cryptographic SHA-256 manifest (`manifest.json`), schema version metadata, and atomic SQLite Online Backup snapshots.
- **The Merge engine must strictly require Format Version 2 or higher.** An archive lacking a valid SHA-256 manifest cannot guarantee file integrity and must be rejected for merge operations.

### Format Version 1 Compatibility Preserved for Full Restore Only
- Existing Format Version 1 archives (`.hfdbackup` files produced by earlier application versions) lack `manifest.json`.
- **Full Restore (`stage_complete_restore`) retains 100% backward compatibility with Format v1.**
- Format v1 archives will **not** be supported for Merge; users wishing to merge an older v1 archive must first restore it in an isolated test profile or export a fresh v2 backup.

---

## 9. Phased Implementation Roadmap

When the project is ready to implement Backup Merge, it must proceed through these strictly gated phases:

- **Phase 1: Tombstone Schema Migration**
  - Create and register migration `0010_deletion_tombstones.sql`.
  - Hook soft-deletion/tombstone recording into existing delete operations.
  - Validate with automated migration safety tests.
- **Phase 2: Headless Merge Engine in Rust**
  - Implement read-only analysis and diff generation in Rust.
  - Implement explicit SQL merge queries (zero `INSERT OR REPLACE`).
  - Write exhaustive unit tests for every table in the schema inventory.
- **Phase 3: File Sandbox & Crash-Recovery Journal**
  - Implement filesystem staging, `.incoming` suffix promotion, and `merge_journal.json`.
  - Add test fixtures simulating power failure/abrupt exit during copy, commit, and promotion.
- **Phase 4: Conflict Preview UI**
  - Build React conflict preview dialog with side-by-side field diffs and user selection options.
  - Connect UI to the verified Rust merge commands.
