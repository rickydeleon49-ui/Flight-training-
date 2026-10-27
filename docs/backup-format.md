# Her Flight Deck portable backup format

_Status: format version 3, implemented in `src-tauri/src/backup.rs`. Versions 1 and 2 remain supported for restore._

## Container and extension

A portable backup is a ZIP-compatible file with the `.hfdbackup` extension. Mac, Windows, and the future iOS app use the same format. Archive paths always use `/` separators and are relative to the archive root.

## Format version 3

```text
manifest.json
integrity.json
her-flight-deck.db
documents/
  <managed relative paths>
```

`manifest.json` contains:

```json
{
  "format": "her-flight-deck-complete-backup",
  "formatVersion": 3,
  "appVersion": "0.5.3",
  "createdAt": 1799999999,
  "missingAtExport": [
    "previously-missing-material.pdf"
  ]
}
```

Entries in `missingAtExport` are relative to `documents/` (matching the `file_path` values stored in `study_materials`). When no referenced documents were missing when the backup was made, `missingAtExport` is omitted. Writers enforce two-way reference completeness: all documents referenced in `study_materials` must either exist in `documents/` or have been absent both before and after the SQLite snapshot and declared in `missingAtExport`. Newly created archives omitting a referenced document without declaring it in `missingAtExport`, or containing an unreferenced document, fail verification.

`integrity.json` contains a sorted inventory of every data file:

```json
{
  "algorithm": "sha256",
  "files": [
    {
      "path": "her-flight-deck.db",
      "bytes": 123456,
      "sha256": "<64 lowercase hexadecimal characters>"
    },
    {
      "path": "documents/material-id-handbook.pdf",
      "bytes": 456789,
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

The inventory includes the database and every document. It excludes `manifest.json` and `integrity.json` themselves. Restore rejects missing records, extra records, duplicate records, invalid digests, size disagreement, and digest disagreement.

The database is produced with SQLite's online backup API. This creates a consistent immutable snapshot even if the live WAL database receives committed writes while export is running. Versions 2 and 3 do not need to carry a WAL or SHM file.

`documents/` contains original uploads and generated PDF parts. Their database records retain titles, labels, page ranges, tags, study guides, flashcards, and relationships.

## Version 2 compatibility

Format version 2 archives contain `manifest.json`, `integrity.json`, `her-flight-deck.db`, and `documents/`. They were created before `missingAtExport` tracking was introduced. Format version 2 archives receive full SHA-256 cryptographic verification of every present file, path limits, archive size limits, and SQLite schema verification. To preserve backward compatibility for users whose library records referenced a document already missing from disk when the v2 archive was created, restore does not reject missing referenced documents; instead, it discloses any missing references in restore info and UI warnings while restoring all present files cleanly.

## Version 1 compatibility

Version 1 archives contain `manifest.json`, `her-flight-deck.db`, an optional `her-flight-deck.db-wal`, and `documents/`. They do not contain `integrity.json`. Restore continues to accept them so backups made by released desktop versions remain usable. Version 1 receives structural, size, path, SQLite integrity, and schema validation, but cannot provide version 2 or 3's cryptographic content verification.

Writers always produce the latest format. Readers must branch explicitly on `formatVersion`; unknown versions are rejected.

## Restore validation

Before current data moves, restore performs all of these checks:

1. The file is a readable ZIP archive.
2. `manifest.json` is at most 64 KiB, has the exact format identifier, and names version 1, 2, or 3.
3. Versions 2 and 3 have valid SHA-256 integrity data of at most 2 MiB.
4. The archive contains no more than 10,000 entries or 10 GiB of expanded data.
5. Entries over 1 MiB cannot exceed a 200:1 expanded-to-compressed ratio.
6. Paths cannot be absolute, traverse with `..`, contain backslashes or colons, exceed 1,024 UTF-8 bytes, or contain a component over 255 UTF-8 bytes.
7. Only the manifest, integrity file, database, legacy WAL, and `documents/` tree are allowed.
8. Duplicate paths and symbolic links are rejected.
9. Each extracted byte count must match its declared size.
10. Versions 2 and 3 hashes must match the complete integrity inventory.
11. The staged database must have a SQLite header, pass `PRAGMA quick_check`, contain `settings` and `study_materials`, carry either desktop `_sqlx_migrations` or fallback `schema_migrations` history, and not declare a schema version newer than this build supports.

12. A schema-16 database (OFFLINE-03a) also keeps its study-set history and card origins consistent:
   - `study_set_history`, `card_version_origins`, `card_item_origins`, `practice_item_origins` and the two new `ai_study_sets` columns match migration 0016 exactly;
   - every row points at an existing material, card or question;
   - each `retired_json` list is well-formed and has at most 2,000 entries;
   - each history row holds a whole previous set;
   - a card's side-table origin is part of its snapshot hash. A tampered or missing origin therefore fails the hash check, and a snapshot's own origin must match its cards.

   Backups from schema 15 and earlier are checked against their own version's contract, so they still restore.

Schema 20 adds five homework tables to the same SQLite snapshot: `homework_assignments`
(titles, instructions, optional school/instructor/lesson/due date, state and revision),
`homework_activities` (ordered tasks, bodies including reflections/questions, retained source
identities and completion state), `homework_runs` (frozen card queues, rating associations and
completion/invalidation times; test runs remain reserved),
`homework_operations` (canonical requests, hashes and replay results), and `homework_history`
(append-only snapshots including completion evidence and prior cycles). Codec 1 accepts bound
card runs; partial rating associations live in history snapshots, and a finished run also keeps
their frozen aggregate in `evidence_json`. Action links remain reserved until planner integration.
Validators cross-check live card events and attributed receipts when present, retaining accepted
historical associations after source/event deletion. No new archive format is needed. Missing
or deleted sources retain captured identity, wording and evidence.

Startup and staged restore compare schema-20 columns, constraints, foreign keys, indexes and
history triggers with migration 0020, then independently recompute aggregate completion,
cycle/revision continuity and receipt/history consistency. A tampered database is refused even
if its archive integrity hashes were recomputed. Supported older libraries upgrade additively
with empty homework tables. An app whose supported schema ceiling is below 20 refuses a
schema-20 backup with “Update the app first” before replacing current data.

Schema 23 adds a separate `answer` to homework activities. Existing `body` text stays
as the prompt and existing rows receive an empty answer. Only reflections and questions
may hold an answer. New completions use evidence version 2, which captures both prompt
and answer; immutable version-1 evidence and receipts retain their original validation.
Backups from before schema 23 restore against their own schema contract and receive
the empty answer when startup applies migration 0023.

Browser mode keeps its existing atomic byte-restoring persistence boundary: a failed final
storage write restores all live rows, history and receipts to the last durable bytes. Separate
browser tabs remain uncoordinated; there is no homework-only or global Web Lock in this slice.

Validation and extraction happen in `.restore-staging`. A successful stage is atomically renamed to `.restore-pending`. Current data remains untouched until activation.

## Replace activation

**Current repair status (1 October 2026): A1 shared source/regression repair accepted.** [Final independent acceptance](RESTORE_RETENTION_ACCEPTANCE_2026-10-01.md) confirms ownership-preserving cleanup, original WAL/document return-failure recovery, prior canonical bytes and corrected real-prefix temporary-sibling detection. All 18 final focused cases pass independently; the inspected full Rust log contains 144 passing backup tests. Archive representations v1/v2/v3 remain unchanged. Merge requires required exact-head CI; installed Mac/Windows and Unix power-loss durability remain unverified, directory sync is explicitly best-effort, and release approval remains held.

Desktop applies a pending restore during application startup before the SQL plugin initializes or opens the database. The operation is coordinated by a strictly scoped durable journal (`restore-journal.json`) using the transition protocol below:

### Transition table and disk states

The table describes the proposed protocol and its required safety contract. Current code does not satisfy all its document-conservation, no-follow or cleanup-ownership requirements; use the fourth review for actual limitations. It is not release-readiness evidence.

| Phase | Durable intent recorded before move | Potential interrupted disk state | Distinguishing next-invocation state | Permitted deletion boundary |
| --- | --- | --- | --- | --- |
| `Protecting` | Journal records `protected_db_files`, `original_db_artifacts`, and `original_document_artifacts` before files move to `backups/<dir>` | Part of DB/WAL/SHM or documents in root, part in rollback | Rollback contains some files; active root contains others; journal in `Protecting` | No deletion permitted; rollback checks both root and rollback for any `DB_FILES` and documents |
| `Protected` | All original DB/WAL/SHM and documents successfully moved to `backups/<dir>` | All original files in rollback directory; active root clear of originals | All originals in rollback; journal in `Protected` | No deletion permitted; rollback returns all files from rollback directory |
| `Activating` | Recorded before moving staged files from `.restore-pending` into root; records each installed item and sets `staged_db_artifacts` and `staged_document_artifacts` | Some staged files in active root; original files in rollback | Staged files in active root; journal records `installed_db_files`; originals remain in rollback | Staged files only uninstalled if matching staged artifact identity verified; active `.db-shm` unlinked before returning originals to allow clean SQLite SHM regeneration; originals then returned |
| `Committed` | Recorded after all staged files are installed into root | All new data in root; staging `.restore-pending` still present | Journal in `Committed`; staging directory may remain | Safe to clean up `.restore-pending`. Journal only deleted after verified staging cleanup |
| `RollingBack` | Recorded before moving files back during rollback | Some files returned to root, others still in rollback | Journal in `RollingBack`; rollback directory contains remaining originals | No deletion permitted; resume finishes returning originals |
| `RolledBack` | Recorded after all original files verified returned to active root and rollback dir empty | All original data in root; staging `.restore-pending` still present | Journal in `RolledBack`; original data active | Safe to clean up `.restore-pending`. Journal only deleted after verified staging cleanup |
| `UnresolvedRecovery` | Recorded when rollback encountered a destination obstruction, missing file, or unidentified active artifact | Original data safely preserved in rollback with `.recovery-pending` marker | Rollback contains `.recovery-pending` marker; journal in `UnresolvedRecovery` | Deletion strictly forbidden; routine pruning blocked; startup halts with `BlockedUnresolved` |

### Platform replacement and durability semantics

1. **Atomic journal replacement:** Journal writes create a temporary sibling file (`restore-journal.json.tmp`), flush bytes to disk with `sync_all()`, and replace the canonical journal atomically via `std::fs::rename(&tmp, &canonical)` without unlinking the canonical file first. This preserves the previous valid journal on disk if writing or syncing fails.
2. **Directory durability limits:** `sync_all` guarantees file data and metadata flush on the opened file handle. Directory entry persistence on POSIX and NTFS depends on underlying filesystem journalling; claims of universal power-loss durability from file `sync_all` alone are explicitly disclaimed.
3. **Path constraint & identity:** Recovery folder names are constrained to `backups/<child>` where `<child>` is an immediate non-empty subdirectory (neither `.` nor `..` nor `"backups"`). Journal inventory names/hashes and active/recovery document roots receive fallible no-follow inspection (`is_symlink_or_reparse`). Pending and staging storage roots are inspected before any file access, move, SQLite check, or cleanup via `inspect_storage_root`. Modern terminal journals require matching plan ownership before pending directory deletion; missing plans refuse deletion fail-closed.
4. **Persistent terminal decisions & fallible cleanup:** `Committed` and `RolledBack` states persist across cleanup failures. `fresh_staging` fallibly removes terminal journals before creating a new staging directory; if terminal journal removal fails, new staging is refused. Pending operations are not deleted by mismatched prior journals.
5. **Fail-closed startup gate:** Startup inspects `restore-journal.json` using fallible no-follow inspection (`symlink_metadata`). Dangling links, non-regular files, directory journals, or parse errors halt immediately as `BlockedUnresolved`. If the journal is missing but recovery markers (`.recovery-pending`, `.tmp` journals, or `before-restore` safety copies without an active DB) exist, startup immediately blocks with `BlockedUnresolved` to protect stranded data from overwrite.
6. **Artifact classification & SHM handling:** Rollback compares active DB/WAL against recorded original/staged hashes; legacy WAL separation is enforced. Active `.db-shm` cleanup occurs before returning originals. Document manifests enforce complete set verification unconditionally: known-empty manifests reject any unexpected file via `OriginalDocumentsPresence::PresentEmpty`. Unmoved original documents in active storage are reconciled against recorded cryptographic identities, clearing protection intent and permitting clean recovery on subsequent launches.

iOS cannot request a process restart. Its implementation must apply a pending restore during a later cold launch before opening SQLite.

## Excluded data

Portable backups never include:

- Gemini API keys or credential-store data
- absolute machine paths
- automatic local backup folders
- restore staging state
- logs, caches, temporary files, or signing material

The desktop Gemini key remains a user-profile file because unsigned desktop builds do not have stable keychain identity. The iOS app must store its key in Keychain and must not export it.

## Merge mode

Merge is not implemented. The UI must continue to offer replacement restore only until ID remapping, conflict rules, transactional database writes, content-hash deduplication, copied-file cleanup, and injected-failure rollback are implemented and tested together.

## Mobile storage requirement

The fixed archive ceilings are hostile-input bounds, not a promise that a device has enough storage. The iOS importer must check available capacity for the source package, staging tree, rollback copy, and installed result before extraction, and must remove temporary data after cancellation or failure.

### 7.5 Recovery Lifecycle Hardening (shared A1 source/regression repair accepted)

1. **Scoped Temporary Journal Cleanup (G1) & Byte-Identical Prior Canonical Preservation (H3/C3):**
   `write_journal` creates a PID-and-nonce sibling temporary file with a scoped cleanup guard (`TmpJournalGuard`). Pre-replacement errors (creation, write, sync, or rename) unlink the temporary file and preserve the prior canonical journal byte-for-byte on disk without modification or abandoned siblings (`task4_prior_canonical_journal_preserved_on_write_sync_rename_failures`). Sibling detection checks both `format!("{RESTORE_JOURNAL_FILE}.tmp-")` and `".tmp-"`, verified by negative-control test `task4_temporary_sibling_detector_rejects_actual_prefix_leftover_negative_control`. The functional round-five write/sync restart tests pass. On Unix, parent directory sync remains best-effort after canonical replacement; no native crash-durability acceptance is implied.

2. **Legacy Pending Restoration Normalization (G2):**
   Already-staged legacy pending storage with an absent plan or a valid older plan lacking `operationId` records `journal.operation_id` as empty (`""`). Cleanup authorization recognizes that explicit legacy state without granting wildcard deletion permissions to modern journals. Newly importing an older archive is different: current staging writes a modern operation-owned plan regardless of whether the archive is v1, v2 or v3.

3. **Ephemeral SHM Cache vs. Durable DB/WAL Data (G3):**
   SQLite shared memory (`.db-shm`) is treated as ephemeral cache and is excluded from mandatory durable verification. Durable files (`her-flight-deck.db` and `her-flight-deck.db-wal`) must strictly match recorded SHA-256 digests and byte counts. SQLite automatically regenerates `.db-shm` from WAL upon first database connection. If recovery cannot return protected files, an actionable error naming the unreturned files is returned.

4. **Safe Deletion Ordering, Fallible Inspection & Return Fault Coverage (G4 / H1 / H3):**
   `remove_pending_directory_safely` implements strict payload-before-plan deletion: directory enumeration (`read_dir`) and individual entry inspection errors are propagated immediately before `RESTORE_PLAN` is touched. No-follow metadata inspection (`symlink_metadata` and `is_symlink_or_reparse`) guards against unsafe links or treating inspection failures as absence. `round6_cleanup_enumeration_error_must_preserve_ownership_plan` verifies plan and payload preservation under native Windows directory-listing denial. Dedicated tests verify genuine SQLite WAL return failure (`ReturnDbRename(1)`), document return failure (`ReturnDocsRename`), and genuine WAL install-move failure without mixing or loss.
