# Backup Merge Design Specification

> **Status: Architectural Design Specification Only**
>
> This document specifies the safety constraints, schema inventory, conflict-resolution rules, and transactional rollback architecture for a future Backup Merge capability.
> **Merge is not implemented in the current codebase.** No merge commands are exposed in the Rust backend, no migrations are added, and no merge UI exists.

---

## 1. Executive Summary & Core Principles

Her Flight Deck currently provides a defensive, verified **Full Restore** capability: a pilot can restore a portable `.hfdbackup` archive, replacing the active database and document library wholesale after taking an automatic safety snapshot.

A **Backup Merge** capability serves a distinct purpose: allowing a pilot training across multiple devices (e.g., studying materials on an iPad or iPhone while recording flight lessons and debriefs on a desktop Mac or Windows PC) to combine data from an export into her active local installation without discarding data accumulated on either side.

Unlike a full restore, merging into an active database carries severe risks of silent data clobbering, foreign-key cascade destruction, orphaned records, and partial filesystem desynchronization. This document establishes the strict architectural and data-integrity requirements for safe merging.

### Core Invariants

1. **Zero Silent Data Loss:** Local training history must never be silently overwritten, truncated, or removed by an incoming merge.
2. **Referential Integrity:** Merge operations must never violate SQLite foreign keys or leave dangling orphaned records or files.
3. **Dual-Layer Atomicity:** SQLite transactions cannot roll back filesystem writes; the merge architecture must coordinate database and file changes under a crash-resilient journal.
4. **No Blanket Last-Write-Wins:** Generic Last-Write-Wins (LWW) is prohibited because several domain tables lack timestamps, and device clocks cannot guarantee causal ordering.
5. **Pre-Boot Crash Recovery:** Any interrupted merge must be fully recovered or rolled back before opening database pools or serving UI.

---

## 2. Prohibition of `INSERT OR REPLACE`

```
  ⚠️ CRITICAL ARCHITECTURAL HAZARD: INSERT OR REPLACE
  In SQLite, `INSERT OR REPLACE` (or `INSERT ... ON CONFLICT REPLACE`)
  is syntactic sugar for a `DELETE` of the conflicting row followed by an
  `INSERT` of the incoming row.
```

When foreign keys are active (`PRAGMA foreign_keys = ON;`), deleting an existing row immediately executes that foreign key's configured delete rule on all referencing child tables:

- An `INSERT OR REPLACE INTO study_materials` deletes the existing study material row before inserting the incoming version:
  - Triggers `ON DELETE CASCADE` on `material_tags`, deleting every tag association!
  - Triggers `ON DELETE CASCADE` on `event_materials`, detaching the material from every flight lesson!
  - Triggers `ON DELETE CASCADE` on `journal_materials`, wiping lesson debrief attachments!
  - Triggers `ON DELETE CASCADE` on `ai_study_sets` and `practice_tests`, permanently destroying local AI study aids!
  - Triggers `ON DELETE SET NULL` on `questions`, orphaning study questions!
- An `INSERT OR REPLACE INTO schedule_events` deletes the existing event row before replacement:
  - Triggers `ON DELETE CASCADE` on `event_prep_items`, wiping checklist items!
  - Triggers `ON DELETE SET NULL` on `transactions`, disconnecting recorded lesson costs!
  - Triggers `ON DELETE SET NULL` on `journal_entries`, severing flight logs from their schedule events!
- An `INSERT OR REPLACE INTO goals` deletes the existing goal row before replacement:
  - Triggers `ON DELETE CASCADE` on `goal_checklist_items`, deleting all checklists!
  - Triggers `ON DELETE SET NULL` on `schedule_events`, `study_materials`, `journal_entries`, and `transactions`!

### Mandatory Rule
**Merge logic must never execute `INSERT OR REPLACE`.**

All merge operations must strictly distinguish between **inserting novel rows** (using standard `INSERT INTO`) and **updating existing rows** (using targeted `UPDATE ... WHERE id = ...` or `INSERT INTO ... ON CONFLICT(id) DO UPDATE SET ...` updating specific columns while leaving the underlying row identity and child foreign-key associations intact).

---

## 3. Comprehensive Table-by-Table Schema Inventory

Across all migrations (0001 through 0009), the Her Flight Deck database comprises 21 tables. Each table exhibits distinct primary key structures, foreign key behaviors, and timestamp availability.

| Table Name | Primary Key | Foreign Keys & Actions | Table Category | `updated_at` Available? | Merge Strategy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `settings` | `id` (`CHECK (id = 'profile')`) | `current_milestone_id` (soft ref to `milestones(id)`) | Singleton (1 row) | **Yes** (`created_at`, `updated_at`) | Field-by-field diff of schema columns (`pilot_name`, `certificate_goal`, `current_focus`, `current_milestone_id`); prompt on conflict |
| `milestones` | `id` (UUID) | None | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff and preview conflicting matching IDs |
| `goals` | `id` (UUID) | `milestone_id REFERENCES milestones(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`, `completed_at`) | Insert novel; completed status takes precedence or prompts |
| `goal_checklist_items` | `id` (UUID) | `goal_id REFERENCES goals(id) ON DELETE CASCADE` | Child Entity | **NO** (`created_at` only) | Insert novel; conflicting `done` state or `title` must appear in Conflict Preview |
| `schedule_events` | `id` (UUID) | `goal_id REFERENCES goals(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff dates/times; preview conflicting IDs |
| `event_prep_items` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE CASCADE` | Child Entity | **NO** (`created_at` only) | Insert novel; conflicting `done` state or `title` must appear in Conflict Preview |
| `study_materials` | `id` (UUID) | `goal_id REFERENCES goals(id) ON DELETE SET NULL`, `event_id REFERENCES schedule_events(id) ON DELETE SET NULL` | Domain Entity + File | **Yes** (`created_at`, `updated_at`, `last_reviewed_at`) | Match by SHA-256 hash or UUID; stage PDF; update metadata without deleting row |
| `tags` | `id` (UUID), `name UNIQUE` | None | Dimension / Tag | **NO** (`created_at` only) | Natural key unification by `name`; remap incoming IDs across join references |
| `material_tags` | `(material_id, tag_id)` | `material_id REFERENCES study_materials(id) ON DELETE CASCADE`, `tag_id REFERENCES tags(id) ON DELETE CASCADE` | Join Table | **NO** (no timestamps) | Additive set union (`INSERT OR IGNORE`); unlinking requires join tombstones |
| `event_materials` | `(event_id, material_id)` | `event_id REFERENCES schedule_events(id) ON DELETE CASCADE`, `material_id REFERENCES study_materials(id) ON DELETE CASCADE` | Join Table | **NO** (no timestamps) | Additive set union (`INSERT OR IGNORE`); unlinking requires join tombstones |
| `next_actions` | `id` (UUID) | Polymorphic soft ref (`related_type`, `related_id`) | Domain Entity | **Yes** (`created_at`, `updated_at`, `completed_at`) | Insert novel; completed status takes precedence or prompts |
| `journal_entries` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE SET NULL`, `goal_id REFERENCES goals(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`) | Insert novel; diff flight log times; prompt on conflicts |
| `journal_materials` | `(journal_id, material_id)` | `journal_id REFERENCES journal_entries(id) ON DELETE CASCADE`, `material_id REFERENCES study_materials(id) ON DELETE CASCADE` | Join Table | **NO** (no timestamps) | Additive set union (`INSERT OR IGNORE`); unlinking requires join tombstones |
| `questions` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE SET NULL`, `material_id REFERENCES study_materials(id) ON DELETE SET NULL`, `journal_id REFERENCES journal_entries(id) ON DELETE SET NULL` | Domain Entity | **Yes** (`created_at`, `updated_at`, `answered_at`) | Insert novel; answered questions preserve answers; prompt on divergent answers |
| `transactions` | `id` (UUID) | `event_id REFERENCES schedule_events(id) ON DELETE SET NULL`, `goal_id REFERENCES goals(id) ON DELETE SET NULL`. Unique index on `(event_id)` where `source = 'lesson_cost'` | Domain Entity (Finance) | **Yes** (`created_at`, `updated_at`) | Insert novel; enforce partial index for lesson costs via preview |
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
   - If a pilot updates `current_focus` on desktop and `current_milestone_id` on iPad, a row-level LWW would discard one of those edits completely.

---

## 5. Explicit Handling by Entity Category

### 5.1 Singleton Tables (`settings`, `pilot_toolkit`)
- **`settings` (`id = 'profile'`):**
  - Uses the actual columns defined in `src-tauri/migrations/0001_initial_schema.sql`:
    - `pilot_name` (TEXT)
    - `certificate_goal` (TEXT)
    - `current_focus` (TEXT)
    - `current_milestone_id` (TEXT)
    - `created_at` (TEXT)
    - `updated_at` (TEXT)
  - Compare each individual field between local and incoming rows.
  - If a local field is empty (`""` or `NULL`) while the incoming field is populated, safely populate it.
  - If both sides have different non-empty values (e.g., conflicting `pilot_name`, `certificate_goal`, `current_focus`, or `current_milestone_id`), the difference **must be presented to the user in Conflict Preview**. The user selects which value to keep. Never silently overwrite.
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
- Default merge strategy is an **additive set union**:
  ```sql
  INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?);
  ```
- Unlinking an association requires an explicit join-table tombstone (see §5.8).

### 5.5 Checklists and Prep Items (`goal_checklist_items`, `event_prep_items`)
- Child items have `id`, parent ID, `title`, `done` (0 or 1), and `position`, with only `created_at` (no `updated_at`).
- **No Automatic "Done Wins" Rule:**
  - Automatic completion monotonicity is prohibited because unchecking an item is a valid, intentional user action (e.g., resetting a pre-flight or study checklist). Without `updated_at`, the engine cannot determine whether checking or unchecking occurred later.
  - Novel item IDs are inserted under the parent entity.
  - For colliding item IDs with conflicting `done` states (e.g. 0 on one device and 1 on the other), or divergent `title` or `position`, the item **must appear in Conflict Preview for an explicit user decision**.

### 5.6 Study Materials & Physical Documents (`study_materials` + `documents/`)
- Study materials consist of a database row and a physical file stored in `<app_root>/documents/`.
- **Content Hash Deduplication (SHA-256):**
  - Before copying an incoming document file, compute its SHA-256 hash and compare against existing local documents.
  - If a local document matches the hash, reuse the local file path instead of duplicating disk storage.
- **Filename Collision Avoidance:**
  - If an incoming file has a distinct hash but conflicts on its relative file path, allocate a new safe destination using the existing `reserve_destination` pattern (e.g., `<material_id>-<name>.pdf`).
- **Referential Timing:**
  - Staged files must be verified on disk before database records are committed. Database records must never reference nonexistent file paths.

### 5.7 UUID Domain Entities (`milestones`, `goals`, `schedule_events`, `journal_entries`, `questions`, `transactions`, `notes`, `fund_goals`)
- **Novel UUIDs:** Distinct IDs that exist in the incoming archive but not locally are inserted, ensuring parent FKs (`milestone_id`, `goal_id`, `event_id`) are inserted before children.
- **Identical Content:** Rows with identical IDs and byte-identical contents are skipped as no-ops.
- **Colliding UUIDs with Conflicting Content:**
  - When timestamps differ, the system records the diff.
  - Differences in high-consequence fields (e.g. flight hours in `journal_entries`, financial amounts in `transactions`, target dates in `goals`) **must be presented in Conflict Preview**.
  - For `notes`, provide the user an option to "Keep Both" by duplicating the incoming note under a newly generated UUID v4.

---

## 5.8 Per-Entity Deletion and Tombstone Architecture

Currently, Her Flight Deck performs hard deletes (`DELETE FROM ...`), leaving no residual record in SQLite. Without tombstones:
- If Device A deletes Goal #1, and Device B has not connected since, merging Device B back into Device A will interpret Goal #1 as a "novel" record from B and resurrect it on A.

Because not every entity possesses `updated_at`, a blanket timestamp-comparison rule cannot be used for deletions. A robust tombstone engine requires a dedicated, per-entity strategy.

### 1. Dedicated Tombstones Schema
```sql
CREATE TABLE tombstones (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  deleted_at  TEXT NOT NULL,
  parent_id   TEXT,
  extra_key   TEXT,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX idx_tombstones_parent ON tombstones(parent_id);
```

### 2. Per-Entity Deletion & Versioning Rules

1. **Timestamped Domain Entities (`milestones`, `goals`, `schedule_events`, `study_materials`, `next_actions`, `journal_entries`, `questions`, `transactions`, `fund_goals`, `notes`, `ai_study_sets`, `practice_tests`):**
   - Possess `updated_at`.
   - Tombstone records `(entity_type, entity_id, deleted_at)`.
   - **Resolution:**
     - If `deleted_at > incoming.updated_at`: The deletion wins. The incoming record is discarded from the merge set.
     - If `incoming.updated_at > deleted_at`: The record was edited on another device *after* it was deleted locally. This is an ambiguous conflict and **must appear in Conflict Preview** (user chooses: "Confirm Deletion" or "Resurrect & Update").
2. **Checklist & Prep Items (`goal_checklist_items`, `event_prep_items`):**
   - Possess only `created_at` (no `updated_at`).
   - Tombstone records `(entity_type, entity_id, deleted_at, parent_id)`.
   - **Resolution:**
     - If the parent entity was deleted, the item is deleted by parent rule.
     - If the parent entity remains active, the presence of an item tombstone represents an explicit deletion. The incoming item is dropped unless the user chooses to re-add it in Conflict Preview.
3. **Tags (`tags`):**
   - Possesses `id`, `name UNIQUE`, and `created_at` only.
   - Tombstone records `(entity_type = 'tag', entity_id, extra_key = tag_name, deleted_at)`.
   - **Resolution:** If a tag was intentionally deleted on one device, the tombstone prevents incoming join records or tags from re-creating it without user confirmation in Conflict Preview.
4. **Join Tables (`material_tags`, `event_materials`, `journal_materials`):**
   - Possess composite PKs and zero timestamps.
   - Tombstone records unlinking: `(entity_type = 'material_tags', entity_id = material_id, extra_key = tag_id, deleted_at)`.
   - **Resolution:** If an unlinking tombstone exists, the association is removed and incoming union insertion is suppressed.
5. **Singleton Records (`settings`, `pilot_toolkit`):**
   - Singletons are never deleted (the database always maintains exactly one row).
   - Deletion tombstones do not apply; mutations resolve exclusively via field comparison and Conflict Preview.

### 3. Mandatory Coverage of Cascaded Deletions
In SQLite, executing `DELETE FROM goals WHERE id = ?` or `DELETE FROM study_materials WHERE id = ?` triggers `ON DELETE CASCADE` on child tables.
- **Rule:** The deletion engine (via SQLite triggers or repository deletion wrappers) **must generate tombstones for all child rows removed via cascade**.
- If a study material is deleted, tombstones must be emitted for the parent `study_material`, its `ai_study_sets`, `practice_tests`, and its `material_tags`, `event_materials`, and `journal_materials` associations.
- Without cascaded tombstones, merging another device would resurrect orphaned child records or detached associations.

---

## 6. Conflict Preview & User Decision Workflow

Because automated heuristics cannot infer pilot intent, the merge engine must separate read-only analysis from execution.

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

### Ambiguous Conflicts Requiring User Decision
1. **Conflicting Settings Fields:** Divergent `pilot_name`, `certificate_goal`, `current_focus`, or `current_milestone_id`.
2. **Conflicting Checklist & Prep Items:** Discrepant `done` completion states (0 vs 1) or differing titles for the same item ID.
3. **Conflicting Journal Flight Logs:** Discrepant dual received, PIC, cross-country, or solo flight hours for the same lesson ID.
4. **Lesson Cost Collisions:** Two different cost transactions claiming the singleton `idx_transactions_one_lesson_cost` index for the same event ID.
5. **Conflicting Note Content:** Divergent title or body text for the same note UUID.
6. **Post-Deletion Edits:** Any record whose `updated_at` post-dates a deletion tombstone.

---

## 7. Durable Dual-Layer Rollback & Recovery Journal

### The Atomicity Problem
SQLite transactions (`BEGIN TRANSACTION ... COMMIT`) provide ACID guarantees for database pages. However, **SQLite cannot roll back filesystem copy, move, or delete operations.** If 500 MB of PDF documents are copied into `<app_root>/documents/` and the SQLite transaction then fails on a constraint violation, or if the process crashes mid-copy, the application is left in a corrupted, half-merged state.

To guarantee atomicity across both storage layers, the merge engine employs an on-disk crash-resilient journal with staged promotion and pre-boot recovery.

### 1. File Manifest Schema in Recovery Journal
The recovery journal (`<app_root>/merge_journal.json`) records the exact status and cryptographic hash for every file involved:
```json
{
  "merge_id": "b1a4...",
  "journal_state": "files_staged",
  "snapshot_path": "<app_root>/rollback/pre_merge_db.sqlite",
  "files": [
    {
      "source_path": "<staging>/documents/flight_guide.pdf",
      "temporary_path": "<app_root>/documents/flight_guide.pdf.incoming_b1a4",
      "final_path": "<app_root>/documents/flight_guide.pdf",
      "expected_sha256": "8f4a2...",
      "file_size": 1048576,
      "promotion_state": "staged"
    }
  ]
}
```

### 2. State Transition Protocol with Disk Flushing
Every state transition must be persisted and synchronously flushed to disk (`std::fs::File::sync_all()` on Unix, `FlushFileBuffers` on Windows) **before** the next operation begins:

```
State 0: "staged"
         - Incoming archive unpacked into sandboxed staging directory.
         - Format v2 and SHA-256 archive manifest validated.
         - Live SQLite Online Backup written to `rollback/pre_merge_db.sqlite`.
         - Journal initialized with all file paths and expected hashes. Flush to disk.

State 1: "files_staged"
         - Copy files into `<app_root>/documents/` with temporary names (`.incoming_<uuid>`).
         - Verify on disk: each temporary file must exist, match `file_size`, and match `expected_sha256`.
         - Update journal state to `"files_staged"`. Flush to disk.

State 2: "db_committed"
         - Re-verify all staged `.incoming` files immediately before commit.
         - In live SQLite: BEGIN IMMEDIATE TRANSACTION.
         - Execute inserts, updates, and tombstones.
         - Execute `PRAGMA foreign_key_check;`.
         - COMMIT TRANSACTION.
         - Update journal state to `"db_committed"`. Flush to disk.

State 3: "files_promoted"
         - Atomically rename `.incoming_<uuid>` files to `final_path`.
         - Verify each file at `final_path` matches `expected_sha256`.
         - Update journal state to `"files_promoted"`. Flush to disk.

State 4: "cleaned_up"
         - Remove staging directory and rollback snapshot.
         - Delete `merge_journal.json`. Flush directory.
```

### 3. Pre-Boot Crash Recovery Hook
**Recovery must run during the early application boot sequence, before opening the live database connection pool and before serving the webview UI.**

Upon launch, the application checks for `<app_root>/merge_journal.json`:
- **If journal state is `"staged"` or `"files_staged"` (Crash before DB Commit):**
  - Database commit never occurred.
  - Delete all `.incoming_<uuid>` files listed in the journal.
  - Remove sandbox directory.
  - Delete `merge_journal.json`.
  - Live state is completely clean and untouched.
- **If journal state is `"db_committed"` (Crash during File Promotion):**
  - Verify every staged or partially promoted file.
  - **If any required staged file is missing, unreadable, or damaged, or if promotion cannot finish:**
    - **Restore Database Snapshot:** Overwrite the live database file with `pre_merge_db.sqlite`.
    - Delete all `.incoming_<uuid>` and partially promoted files.
    - Remove sandbox and delete journal.
    - **Never leave committed database records pointing to absent or damaged files.**
  - **If all files are intact:** Complete the atomic rename of remaining files to `final_path`, verify checksums, remove snapshot, and delete journal.

---

## 8. Backup Format Version Compatibility & Manifest Integrity

### Format Version 2 Required for Merge
- **The Merge engine strictly requires Format Version 2 or higher.**
- Format v2 archives include a complete SHA-256 manifest (`manifest.json`), schema version tracking, and atomic SQLite Online Backup snapshots.

### Scope of the SHA-256 Manifest
```
  ⚠️ INTEGRITY NOTICE: SHA-256 MANIFEST vs. SIGNATURES
  The SHA-256 manifest in Format v2 detects accidental corruption,
  truncated downloads, storage bit-rot, and mismatched archive contents.
  It is NOT a cryptographic signature or proof of author identity.
  It does not prove who created the backup.
```

The manifest guarantees internal consistency of the archive bytes, ensuring that damaged or tampered archives are rejected before extraction.

### Format Version 1 Compatibility Preserved for Full Restore Only
- Existing Format Version 1 archives lack `manifest.json`.
- **Full Restore (`stage_complete_restore`) retains 100% backward compatibility with Format v1.**
- Format v1 archives are strictly **restore-only**; they will be rejected by the Merge engine to protect live database integrity.

---

## 9. Phased Implementation Roadmap

When the project is ready to implement Backup Merge, it must proceed through these strictly gated phases:

- **Phase 1: Tombstone Schema Migration**
  - Create and register migration `0010_deletion_tombstones.sql`.
  - Hook soft-deletion/tombstone recording into existing delete operations, including cascaded child removals.
  - Validate with automated migration safety tests.
- **Phase 2: Headless Merge Engine in Rust**
  - Implement read-only analysis and diff generation in Rust.
  - Implement explicit SQL merge queries (zero `INSERT OR REPLACE`).
  - Write exhaustive unit tests for every table in the schema inventory.
- **Phase 3: File Sandbox & Crash-Recovery Journal**
  - Implement filesystem staging, `.incoming` suffix promotion, and `merge_journal.json` with disk flushes.
  - Implement early pre-boot recovery hook.
  - Add test fixtures simulating power failure/abrupt exit during copy, commit, and promotion.
- **Phase 4: Conflict Preview UI**
  - Build React conflict preview dialog with side-by-side field diffs and user selection options.
  - Connect UI to the verified Rust merge commands.
