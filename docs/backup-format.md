# Her Flight Deck portable backup format

_Status: format version 2, implemented in `src-tauri/src/backup.rs`. Version 1 remains supported for restore._

## Container and extension

A portable backup is a ZIP-compatible file with the `.hfdbackup` extension. Mac, Windows, and the future iOS app use the same format. Archive paths always use `/` separators and are relative to the archive root.

## Format version 2

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
  "formatVersion": 2,
  "appVersion": "0.5.1",
  "createdAt": 1799999999
}
```

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

The database is produced with SQLite's online backup API. This creates a consistent immutable snapshot even if the live WAL database receives committed writes while export is running. Version 2 does not need to carry a WAL or SHM file.

`documents/` contains original uploads and generated PDF parts. Their database records retain titles, labels, page ranges, tags, study guides, flashcards, and relationships.

## Version 1 compatibility

Version 1 archives contain `manifest.json`, `her-flight-deck.db`, an optional `her-flight-deck.db-wal`, and `documents/`. They do not contain `integrity.json`. Restore continues to accept them so backups made by released desktop versions remain usable. Version 1 receives structural, size, path, SQLite integrity, and schema validation, but cannot provide version 2's cryptographic content verification.

Writers always produce the latest format. Readers must branch explicitly on `formatVersion`; unknown versions are rejected.

## Restore validation

Before current data moves, restore performs all of these checks:

1. The file is a readable ZIP archive.
2. `manifest.json` is at most 64 KiB, has the exact format identifier, and names version 1 or 2.
3. Version 2 has valid SHA-256 integrity data of at most 2 MiB.
4. The archive contains no more than 10,000 entries or 10 GiB of expanded data.
5. Entries over 1 MiB cannot exceed a 200:1 expanded-to-compressed ratio.
6. Paths cannot be absolute, traverse with `..`, contain backslashes or colons, exceed 1,024 UTF-8 bytes, or contain a component over 255 UTF-8 bytes.
7. Only the manifest, integrity file, database, legacy WAL, and `documents/` tree are allowed.
8. Duplicate paths and symbolic links are rejected.
9. Each extracted byte count must match its declared size.
10. Version 2 hashes must match the complete integrity inventory.
11. The staged database must have a SQLite header, pass `PRAGMA quick_check`, contain `settings` and `study_materials`, carry either desktop `_sqlx_migrations` or fallback `schema_migrations` history, and not declare a schema version newer than this build supports.

Validation and extraction happen in `.restore-staging`. A successful stage is atomically renamed to `.restore-pending`. Current data remains untouched until activation.

## Replace activation

Desktop applies a pending restore before the SQL plugin opens the database on the next app launch. It first moves the current database and, for a complete restore, documents into a timestamped `backups/*-before-restore` folder. It then moves staged files into place. A failed protect or install step attempts to restore everything already moved.

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
