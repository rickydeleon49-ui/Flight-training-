# Backup/restore threat model and restoration strategy

_Companion to `docs/backup-format.md` and `docs/ios/ARCHITECTURE.md`. This
document covers the legacy version-1 reader and current version-2 writer,
plus desktop and future iOS Replace restore._

## Trust boundary

A `.hfdbackup` file crosses a trust boundary the moment it can travel
somewhere other than the app that made it: AirDrop, iCloud Drive, a synced
Files folder, an email attachment, a USB drive. Once it does, it must be
treated as **untrusted input** on the receiving end — indistinguishable, to
the importing app, from a deliberately crafted file with the right
extension. Every check in this document exists because "restoring a backup
you made yourself" and "restoring a file that merely claims to be a backup
you made" are the same code path and must be, since the app cannot tell
them apart.

## Threats and mitigations (format versions 1, 2, and 3)

| Threat | Mitigation | Where |
|---|---|---|
| **ZIP path traversal** — an entry named `../../../../etc/passwd` or similar, aimed at writing outside the intended extraction directory | `entry.enclosed_name()` (the `zip` crate's own traversal guard) rejects `..` components and absolute paths before any `PathBuf` is constructed; the result is then checked again against a fixed allow-list (`allowed_archive_path`) | `stage_complete_restore_in`, `inspect_archive` |
| **Windows path smuggling** — separators, drive/stream colons, or excessive names | Explicit rejection of backslashes, colons, paths over 1,024 bytes, and components over 255 bytes | Both functions above |
| **Symlink planting** — an entry that is itself a symlink, or that later resolves through one, to point installed data outside the app's storage | Any entry whose Unix mode bits mark it a symlink (`mode & 0o170000 == 0o120000`) is rejected outright | Both functions above |
| **Unexpected file smuggling** | Fixed allow-list: manifest, v2/v3 integrity data, database, legacy WAL, and paths under `documents/`; credentials are unreachable | `allowed_archive_path` |
| **Duplicate-path overwrite race** | Every accepted path is inserted into a `HashSet`; a second entry claiming the same path is rejected | Both functions above |
| **Entry-count decompression bomb** (many tiny entries, e.g. millions of empty files, to exhaust inodes/handles/time) | Hard ceiling of 10,000 entries, checked against `archive.len()` up front *and* incrementally while extracting | `inspect_archive`, `stage_complete_restore_in` |
| **Expanded-size or compression-ratio bomb** | 10 GiB total ceiling plus a 200:1 ratio ceiling for entries over 1 MiB, checked at inspect and stage | Both functions above |
| **Size-mismatch corruption** — an entry whose actual decompressed byte count does not match what the ZIP central directory declared | `restored_bytes != expected_size` is checked per file, rejecting the whole restore | `stage_complete_restore_in` |
| **Damaged or unrelated SQLite database** | Header and v2/v3 SHA-256 are checked, then the staged DB is opened read-only, `PRAGMA quick_check` must pass, core tables must exist, and future schema versions are rejected | inspect and stage |
| **Missing manifest, or a manifest for a format this app doesn't implement** | `format` string and `formatVersion` integer checked exactly; anything else is rejected before any other archive content is trusted | `inspect_archive` |
| **Oversized manifest** used to waste memory before the real checks run | 64 KiB ceiling on the manifest entry specifically, checked before `read_to_string` | `inspect_archive` |
| **Interrupted export leaving a corrupt file at the destination name** | Written to `<destination>.part` first; `rename`d over the real name only after `ZipWriter::finish()` **and** `File::sync_all()` both succeed; any failure removes the `.part` file | `write_complete_backup` |
| **Interrupted restore leaving the app with a partial database or missing documents** | Full stage-then-atomic-rename-then-apply-with-rollback sequence — see "Restoration strategy" below | `stage_complete_restore_in`, `apply_pending_restore_in` |
| **Format/schema mismatch** | Readers branch explicitly between versions 1, 2, and 3; unknown archive versions and future database schema versions are refused | inspect and stage |

## Legacy format-version-1/2 gaps and format-version-3 improvements

| Gap | Why it's not yet closed | Residual risk |
|---|---|---|
| **Legacy v1 has no per-file cryptographic checksum** | Versions 2 and 3 record and verify SHA-256 plus byte counts for every data file; v1 remains readable with structural and SQLite checks | Only imported legacy v1 archives retain this limitation. |
| **Device free-space exhaustion** | Fixed limits bound hostile input but do not predict available iPhone storage | iOS must check free space before staging and keep cleanup transactional. |
| **No content-hash deduplication across a merge** | Merge-mode restore does not exist (see below) | N/A until Merge is built |

## Restoration strategy

### Replace (implemented, desktop)

The strategy `apply_pending_restore_in` already implements — stage into a
directory that is not the live data, validate fully before anything about
current data changes, atomically commit the staged plan (`rename`), then
on the next safe opportunity (desktop: process restart before SQLite
opens) move current data into a recoverable rollback location **before**
installing the staged data, and if installation fails at any step, move
the rollback back into place and abandon the install — is the correct
strategy and should be reused, not redesigned, for iOS. See
`docs/backup-format.md` §"Restore semantics" for the full four-step
sequence and `docs/ios/ARCHITECTURE.md` §7 for the one desktop-specific
mechanism (`restart_for_restore` / `app.request_restart()`) that needs an
iOS-appropriate replacement (apply on next cold launch instead of an
app-initiated relaunch).

**Properties this strategy already gives, that any iOS implementation must
preserve exactly:**

1. Current data is never modified until a staged restore has been fully
   validated (SQLite header, file presence, size/count limits — all
   checked during staging, before anything about the live database or
   documents moves).
2. Current data is protected (moved to a rollback location, not deleted)
   before the staged data is installed, so an installation failure can
   always be undone.
3. A failure at *any* point — staging, protecting, or installing — leaves
   the app either fully on its previous data or fully on the restored
   data, never a mix. There is no state in which the database is from one
   restore attempt and the documents directory is from another, or in
   which the database exists but is only partially written.
4. Nothing about the previous data is discarded until the new data has
   been fully and successfully installed (rollback cleanup happens only
   after a successful install).

### Merge (not implemented — deliberately deferred)

Per the task brief's own fallback instruction, and consistent with how
this codebase treats every other feature (nothing ships without tests
matching its risk), Merge-mode restore is **not implemented** in this
milestone or planned for Milestone 2/3. No "Merge" option should appear in
any Settings UI until it exists and is tested to the same standard as
Replace above. If and when it is built, this document should be updated
with:

- **Conflict resolution rule for duplicate IDs**: last-write-wins by
  `updated_at`? Prompt the user per conflict? A deterministic rule must be
  chosen and documented before any code ships — an *undocumented* merge
  behavior is itself a data-loss risk, since the user cannot reason about
  what a merge will do to their existing library.
- **File deduplication**: requires the `formatVersion` 2 or 3 per-file SHA-256
  manifest described in `docs/backup-format.md` — two files with identical
  hashes are the same content and should not be duplicated on disk;
  differing hashes at the same original filename need a collision-safe
  rename scheme (e.g. suffix with a short hash fragment, never silently
  overwrite).
- **Transactional database changes with rollback**: SQLite transactions
  wrapping the merge's writes, with newly copied files deleted if the
  transaction rolls back — mirroring the same "never leave a record
  pointing at a file that isn't there, or a file nothing points at" rule
  the desktop split-PDF and document-import code already follows
  elsewhere in this codebase (see `src-tauri/src/pdf.rs`'s
  `split_pdf_automatically`, which removes all partial output on any
  failure, as the pattern to match).

## Testing gap: fault injection between the protect and install steps

Two of `apply_pending_restore_in`'s four documented properties (see
"Restoration strategy" above) have direct test coverage:
`a_damaged_backup_is_refused_before_anything_of_hers_moves` proves a bad
archive changes nothing, and `a_complete_backup_puts_back_the_database_and_
every_document` proves a good one installs correctly *and* leaves a
recoverable rollback copy. What is **not** directly tested is a fault
occurring **between** the protect step (current data moved to the rollback
folder) and the install step (staged data moved into place) — the exact
window the "move it back if installation fails" code exists for.

This was attempted during the Milestone 2 review: removing write
permission on the data directory before calling
`apply_pending_restore_in`, expecting the protect step's own rename calls
to fail. It does not work in a session running as `root` — root bypasses
Unix DAC permission checks, so the intended failure never occurs, and the
function completes successfully instead of exercising any rollback path.
Because this session cannot confirm the test would behave correctly on a
non-root CI runner either (no way to run it there from here), the test was
written, observed to fail for an environment-specific reason, and then
**reverted** rather than committed unverified. See
`docs/ios/CHECKLIST.md`'s Milestone 2 entry for the same note.

This remains a real, open gap in test coverage — not a claim that the
underlying code is wrong, only that this specific property is unverified
by an automated test. A future session with a non-root runner (real CI, or
a Mac) is better positioned to attempt it than this one was.

## Summary judgment for this milestone

Format version 3 closes the content-integrity, live-snapshot, database-schema,
compression-ratio, two-way document completeness, and hostile-name gaps found
by the clean audit. Versions 1 and 2 remain readable for existing users with
structural and integrity checks. Merge remains deliberately deferred.
The iOS app should reuse this core after its Files import and cold-launch
activation paths exist and have been tested on Apple hardware.
