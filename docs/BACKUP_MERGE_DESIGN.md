# Backup Merge Design

This document outlines the architecture, conflict-resolution rules, and implementation phases for the future Backup Merge capability.

## 1. Goal

Allow a user to combine data from an iOS backup and a Desktop backup without overwriting either. Unlike a "Restore" which fully replaces the existing database, a "Merge" integrates imported records into the active database, resolving conflicts gracefully.

## 2. Record Identities and Duplicate Detection

*   **Identities:** Every domain entity in Her Flight Deck (Study Materials, Journal Entries, Goals, Actions) already uses a UUID v4 primary key. These IDs are universally unique across devices.
*   **Duplicate Detection (Same ID):** If a record from the incoming backup has the exact same ID as a record in the local database, it is treated as a collision representing the *same semantic entity* edited in two places.
*   **Duplicate Detection (Content Hashing - Optional):** For study materials (PDFs), duplicate detection must also compare the file's SHA-256 hash to prevent storing redundant identical PDFs under different IDs.

## 3. Conflict-Resolution Rules

When a collision (same ID) occurs during merge:

1.  **Last-Write-Wins (Timestamp):** By default, the system compares the `updated_at` timestamp. The record with the most recent `updated_at` timestamp wins.
2.  **Immutability Rule:** For historical data (e.g., completed Journal Entries, closed Goals), changes are rare. If a local completed entry exists, it typically rejects an incoming uncompleted entry unless the incoming entry is strictly newer.
3.  **Additive-Only Collections:** For associative entities (e.g., tags on a study material), the sets are unioned. No tag is deleted during a merge simply because one device lacked it, unless a specific `deleted_at` tombstone exists.
4.  **Tombstones (Deletions):** A deleted record must leave a tombstone (e.g., a `deleted_at` flag) rather than being hard-deleted, so that the Merge engine knows not to resurrect it from the other device.

## 4. Document/File Ownership and Collision Handling

*   **File Path Collisions:** The current application uses a sanitized `stored_name` derived from the `material_id`. If two different files somehow end up with the same relative path but different IDs, the incoming file will be renamed using the existing `reserve_destination` retry loop (e.g., `1-filename.pdf`).
*   **Orphan Prevention:** If an incoming record is rejected (because the local record is newer), its associated PDF must still be extracted if it doesn't exist locally, or cleanly skipped/deleted from the staging area.

## 5. Transactional Staging, Rollback, and Cleanup

The Merge process must follow the same strict safety guarantees as a complete Restore:

1.  **Stage:** Extract the incoming `.hfdbackup` into a temporary sandbox directory.
2.  **Verify:** Validate the format (v2), SHA-256 manifest, and schema version.
3.  **Snapshot:** Take an Online Backup snapshot of the *current* local database into a rollback folder.
4.  **Transaction:** Open a SQLite transaction on the local database and `ATTACH` the sandboxed database. Execute `INSERT OR REPLACE` (or explicit conflict logic) for all tables.
5.  **Files:** Copy new documents from the sandbox to the live `documents/` folder.
6.  **Commit/Rollback:** If any step fails, roll back the transaction, delete newly copied documents, and (if necessary) restore the snapshot.

## 6. Backup v2 Integrity and v1 Restore Compatibility

*   **v1 Archives:** Because v1 archives lack a SHA-256 manifest, they should be rejected for Merge operations to guarantee integrity. Merge will require format version 2 or higher.
*   **Schema versions:** The incoming backup's schema version must be exactly equal to or less than the local application's schema version. If it is less, the incoming database must be migrated *in the sandbox* before the Merge executes.

## 7. Required Migrations, Test Fixtures, and Failure Cases

*   **Migrations:** Introduce a `deleted_at` or tombstone table for entities to ensure hard-deleted records on Device A aren't resurrected during a merge with Device B.
*   **Test Fixtures:**
    *   *Fixture A:* Database with Record 1 (v1).
    *   *Fixture B:* Backup with Record 1 (v2 - newer `updated_at`).
    *   *Fixture C:* Hostile backup with massive files.
*   **Failure Cases:**
    *   Out of disk space during document copy.
    *   Transient `SQLITE_BUSY` locks during the cross-database `ATTACH`.
    *   Corrupt incoming database schema.

## 8. Phased Implementation Plan

*   **Phase 1: Tombstone Migration.** Add soft-delete/tombstone support to the database schema.
*   **Phase 2: Rust Merge Engine (Headless).** Implement the cross-database `ATTACH` and conflict logic in Rust. Write unit tests for all conflict matrices.
*   **Phase 3: File Sandbox & Rollback.** Implement the file extraction and rollback safety net around the merge engine.
*   **Phase 4: UI & Exposure.** Only after Phases 1-3 pass CI and code review, add the "Merge Backup" button to the frontend UI with a clear preview of what will change.
