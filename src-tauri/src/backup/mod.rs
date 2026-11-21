//! Protecting her training record across updates.
//!
//! Structured data and the profile photo live in SQLite; uploaded study files
//! live beside it in private application storage. Automatic upgrade copies
//! protect the database from migration mistakes. User-requested portable
//! archives protect the database and every uploaded document together.
//!
//! The backup happens in Tauri's setup, before the frontend opens the
//! database and therefore before any migration runs.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{backup::Backup, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::logging::log;
use crate::storage::app_root;

mod verify_schema;
pub(crate) use verify_schema::*;

/// Where copies are kept, inside application data.
/// How long a raw `rusqlite` connection waits for a lock before giving up.
/// Matches the five seconds the app's own connection pool already gets by
/// default from its driver — long enough to ride out an ordinary autosave
/// or transaction, short enough that a genuinely stuck lock still surfaces.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// How many extra attempts a database snapshot gets after a transient lock,
/// beyond the first — bounded, so a lock that never clears still fails
/// rather than retrying forever.
const SNAPSHOT_LOCK_RETRIES: u32 = 3;

const BACKUP_DIR: &str = "backups";
/// Records which version last ran, so an upgrade can be detected.
const VERSION_FILE: &str = "last-run-version.txt";
const DOCUMENTS_DIR: &str = "documents";
const ARCHIVE_MANIFEST: &str = "manifest.json";
const ARCHIVE_INTEGRITY: &str = "integrity.json";
const ARCHIVE_FORMAT: &str = "her-flight-deck-complete-backup";
const ARCHIVE_VERSION: u32 = 3;
const V2_ARCHIVE_VERSION: u32 = 2;
const LEGACY_ARCHIVE_VERSION: u32 = 1;
const RESTORE_STAGING_DIR: &str = ".restore-staging";
pub(crate) const RESTORE_PENDING_DIR: &str = ".restore-pending";
pub(crate) const RESTORE_JOURNAL_FILE: &str = "restore-journal.json";
/// Written into the staged folder to say what kind of restore was asked for.
///
/// An archive can never contain this name — `allowed_archive_path` only lets
/// the manifest, the database, its write-ahead log and `documents/` through —
/// so a backup file cannot decide how it gets installed.
const RESTORE_PLAN: &str = "restore.json";
const MAX_RESTORE_FILES: usize = 10_000;
const MAX_RESTORE_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_PATH_BYTES: usize = 1_024;
const MAX_ARCHIVE_COMPONENT_BYTES: usize = 255;
// SQLite files can contain large runs of empty pages, so leave ample room for
// legitimate databases while still refusing classic tiny-payload ZIP bombs.
const MAX_COMPRESSION_RATIO: u64 = 1_000;
const COMPRESSION_RATIO_FLOOR: u64 = 1024 * 1024;
/// How many automatic copies to keep before the oldest is removed.
const KEEP_BACKUPS: usize = 10;

/// The database, plus the write-ahead log files that belong with it.
pub(crate) const DB_FILES: [&str; 3] = [
    "her-flight-deck.db",
    "her-flight-deck.db-wal",
    "her-flight-deck.db-shm",
];

/// Every SQLite file begins with these sixteen bytes.
///
/// Checking them costs nothing and catches a truncated, empty or wrong file
/// *before* her current data is moved out of the way for a restore.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    /// Seconds since the Unix epoch, for the interface to format.
    pub created_at: u64,
    /// Whether this copy holds a database this app could actually put back.
    pub restorable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBackupManifest {
    format: String,
    format_version: u32,
    app_version: String,
    created_at: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    missing_at_export: Vec<String>,
    /// Files whose FAA reference copy or picture-card details no longer
    /// matched at export (the file was replaced in 0.6.1/0.6.2). They are
    /// backed up as they are; only these skip the saved-details byte check.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    detached_at_export: Vec<String>,
    /// Newest database migration the writing app had applied. Optional;
    /// absent in archives written before this field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schema_version: Option<i64>,
    /// Which device wrote the archive (optional, absent in older archives).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    /// Operating system that wrote the archive (optional, absent in older archives).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityEntry {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBackupIntegrity {
    algorithm: String,
    files: Vec<IntegrityEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteBackupInfo {
    /// The version of the app that wrote the backup.
    pub app_version: String,
    /// The version running now, so the interface can warn about going backwards.
    pub current_app_version: String,
    pub created_at: u64,
    pub files: usize,
    pub bytes: u64,
    /// Size of the backup archive on disk, separate from its unpacked contents.
    pub file_bytes: u64,
    pub path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_documents: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unreferenced_documents: Vec<String>,
    /// Picture cards whose picture is gone or no longer matches.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub unavailable_pictures: usize,
    /// FAA reference copies whose PDF is gone or no longer matches.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub unavailable_references: usize,
    /// Database version the writing app had (absent in older backups).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// The database version this app understands.
    pub current_schema_version: i64,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

#[derive(Debug)]
pub(crate) enum BackupExportError {
    /// A configuration, validation, or permanent user error that should not be retried.
    Permanent(String),
    /// A concurrency or consistency error (document changed during export, etc.) that can be retried.
    Transient(String),
}

impl BackupExportError {
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::Permanent(msg) | Self::Transient(msg) => msg,
        }
    }
}

impl std::fmt::Display for BackupExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

/// What a staged restore should replace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum RestoreKind {
    /// A portable archive: the database and the uploaded documents together.
    Complete,
    /// A local safety copy: the database only. Uploaded documents stay put.
    Database,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestorePlan {
    #[serde(default)]
    operation_id: String,
    kind: RestoreKind,
    /// Where it came from, for the log line if installing goes wrong.
    source: String,
}

fn backup_dir(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(BACKUP_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the backup directory: {e}"))?;
    Ok(dir)
}

/// A filesystem-safe stamp, e.g. "2026-09-05-174233".
fn timestamp() -> String {
    let secs = unix_timestamp();

    // Civil date from a Unix timestamp, without pulling in a date crate.
    let days = (secs / 86_400) as i64;
    let time = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}-{:02}{:02}{:02}",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Howard Hinnant's days-from-civil, inverted. Public-domain algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A backup folder that is not already taken.
///
/// Names carry the time only to the second, so two copies made inside the same
/// second would otherwise land on one folder and the first would be lost.
fn unique_backup_path(dir: &Path, suffix: &str) -> PathBuf {
    let stamp = timestamp();
    let first = dir.join(format!("{stamp}-{suffix}"));
    if !first.exists() {
        return first;
    }
    for attempt in 2..1_000 {
        let candidate = dir.join(format!("{stamp}-{attempt}-{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stamp}-{}-{suffix}", unix_timestamp()))
}

/// Copy the database and its sidecar files into a new backup folder.
///
/// `suffix` says why the copy exists — "manual", "before-0.3.0" — and the time
/// is put in front of it, so the folders sort oldest first.
///
/// Returns None when there is no database yet, which is the normal case on a
/// very first run.
fn copy_database(root: &Path, suffix: &str) -> Result<Option<PathBuf>, String> {
    let main = root.join(DB_FILES[0]);
    if !main.is_file() {
        return Ok(None);
    }

    let destination = unique_backup_path(&backup_dir(root)?, suffix);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("Could not create the backup folder: {e}"))?;

    for name in DB_FILES {
        let from = root.join(name);
        if from.is_file() {
            std::fs::copy(&from, destination.join(name))
                .map_err(|e| format!("Could not copy {name}: {e}"))?;
        }
    }

    Ok(Some(destination))
}

/// Does this look like a real SQLite database file?
fn is_sqlite_header(header: &[u8]) -> bool {
    header.len() >= SQLITE_MAGIC.len() && &header[..SQLITE_MAGIC.len()] == SQLITE_MAGIC
}

/// Read the first bytes of a file and confirm SQLite wrote it.
fn verify_sqlite_file(path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|e| format!("Could not open the database in that backup: {e}"))?;
    let mut header = [0u8; SQLITE_MAGIC.len()];
    file.read_exact(&mut header)
        .map_err(|_| "The database in that backup is damaged or incomplete.".to_string())?;
    if !is_sqlite_header(&header) {
        return Err("That file is not a Flight Deck database.".to_string());
    }
    Ok(())
}

/// True when a backup folder holds a database this app could put back.
fn folder_is_restorable(folder: &Path) -> bool {
    verify_sqlite_file(&folder.join(DB_FILES[0])).is_ok()
}

/// Turn a chosen backup name back into a folder inside `backups/`.
///
/// The name arrives from the interface, so it is treated as untrusted: a bare
/// folder name and nothing that could climb out of the backup directory.
fn safe_backup_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err("That is not a safety copy this app made.".to_string());
    }
    Ok(trimmed)
}

fn zip_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

fn archive_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600)
}

fn add_file_to_archive<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    source: &Path,
    archive_name: &str,
) -> Result<IntegrityEntry, String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|e| format!("Could not read {}: {e}", source.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "Backup source is not a regular file: {}",
            source.display()
        ));
    }

    archive
        .start_file(archive_name, archive_options())
        .map_err(|e| zip_error("Could not add a file to the backup", e))?;
    let mut input =
        File::open(source).map_err(|e| format!("Could not open {}: {e}", source.display()))?;
    let mut hasher = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|e| format!("Could not read {}: {e}", source.display()))?;
        if read == 0 {
            break;
        }
        archive
            .write_all(&buffer[..read])
            .map_err(|e| format!("Could not copy {} into the backup: {e}", source.display()))?;
        hasher.update(&buffer[..read]);
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| "The backup is too large.".to_string())?;
    }
    if copied != metadata.len() {
        return Err(format!(
            "{} changed while the backup was being saved. Try again.",
            source.display()
        ));
    }
    Ok(IntegrityEntry {
        path: archive_name.to_string(),
        bytes: copied,
        sha256: hex::encode(hasher.finalize()),
    })
}

/// The newest migration a database records, from either migration table.
fn newest_migration_version(connection: &Connection) -> Result<i64, String> {
    let migration_table = ["_sqlx_migrations", "schema_migrations"]
        .into_iter()
        .find(|table| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                == 1
        })
        .ok_or_else(|| "That backup does not contain Flight Deck migration history.".to_string())?;
    connection
        .query_row(
            &format!("SELECT COALESCE(MAX(version), 0) FROM {migration_table}"),
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Could not inspect the database version: {e}"))
}

/// The device id kept in `app_metadata`, if the table and row exist.
fn read_device_id(connection: &Connection) -> Option<String> {
    connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'device_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
}

/// Schema version and device id of a database file, for the backup manifest.
/// Never fails the export: anything unreadable becomes `None`.
fn snapshot_schema_and_device(database: &Path) -> (Option<i64>, Option<String>) {
    match Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(connection) => {
            let schema = match newest_migration_version(&connection) {
                Ok(version) => Some(version),
                Err(e) => {
                    log::warn!("Backup manifest: could not read the schema version: {e}");
                    None
                }
            };
            (schema, read_device_id(&connection))
        }
        Err(e) => {
            log::warn!("Backup manifest: could not open the snapshot: {e}");
            (None, None)
        }
    }
}

/// Whether a failure looks like transient SQLite lock contention rather than
/// a real problem with the database.
pub(crate) fn is_transient_lock_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("database is locked") || lower.contains("sqlite_busy")
}

/// Take a database snapshot, retrying a bounded number of times if the
/// reason it failed was another connection briefly holding a lock.
///
/// Each attempt is independent and cleans up its own partial file on
/// failure (see `database_snapshot`), so retrying is just trying again —
/// nothing from a failed attempt is reused or left behind.
fn database_snapshot_with_retry(root: &Path) -> Result<PathBuf, String> {
    let mut last_error = String::new();
    for attempt in 0..=SNAPSHOT_LOCK_RETRIES {
        match database_snapshot(root) {
            Ok(snapshot) => return Ok(snapshot),
            Err(error) if attempt < SNAPSHOT_LOCK_RETRIES && is_transient_lock_error(&error) => {
                last_error = error;
                std::thread::sleep(Duration::from_millis(200 * u64::from(attempt + 1)));
            }
            Err(error) if is_transient_lock_error(&error) => {
                return Err(
                    "The database was busy, so the backup could not be started after several \
                     tries. Close any other window and try again."
                        .to_string(),
                );
            }
            Err(error) => return Err(error),
        }
    }
    // Unreachable in practice — the loop always returns on its last
    // iteration — but a bound that could fall through silently defeats the
    // point of having one.
    Err(last_error)
}

fn database_snapshot(root: &Path) -> Result<PathBuf, String> {
    let source_path = root.join(DB_FILES[0]);
    // Restores picture links a phone-made version lost (exact matches only), so
    // the check below does not refuse a library this build can mend.
    // Only when the check itself refuses (not when the file is merely busy).
    if let Err(first) = verify_application_database(&source_path) {
        if is_transient_lock_error(&first)
            || !crate::sync::receipts::repair_picture_links_at(root).is_ok_and(|n| n > 0)
        {
            return Err(first);
        }
    }
    verify_application_database(&source_path)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let snapshot = root.join(format!(
        ".backup-snapshot-{}-{}.db",
        std::process::id(),
        nonce
    ));

    let result = (|| {
        let source = Connection::open_with_flags(&source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Could not open the database for backup: {e}"))?;
        let _ = source.busy_timeout(BUSY_TIMEOUT);
        let mut destination = Connection::open(&snapshot)
            .map_err(|e| format!("Could not create the database snapshot: {e}"))?;
        let _ = destination.busy_timeout(BUSY_TIMEOUT);
        {
            let backup = Backup::new(&source, &mut destination)
                .map_err(|e| format!("Could not start the database snapshot: {e}"))?;
            backup
                .run_to_completion(100, Duration::from_millis(10), None)
                .map_err(|e| format!("Could not finish the database snapshot: {e}"))?;
        }
        drop(destination);
        drop(source);
        verify_application_database(&snapshot)?;
        Ok(snapshot.clone())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&snapshot);
    }
    result
}

fn add_documents_to_archive<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    directory: &Path,
    relative: &Path,
    files: &mut usize,
    bytes: &mut u64,
    integrity: &mut Vec<IntegrityEntry>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(directory)
        .map_err(|e| format!("Could not read {}: {e}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read a document entry: {e}"))?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path())
            .map_err(|e| format!("Could not inspect {}: {e}", entry.path().display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "A linked file cannot be included in a backup: {}",
                entry.path().display()
            ));
        }

        let next_relative = relative.join(entry.file_name());
        if metadata.is_dir() {
            add_documents_to_archive(
                archive,
                &entry.path(),
                &next_relative,
                files,
                bytes,
                integrity,
            )?;
        } else if metadata.is_file() {
            let name = Path::new(DOCUMENTS_DIR)
                .join(&next_relative)
                .to_string_lossy()
                .replace('\\', "/");
            let saved = add_file_to_archive(archive, &entry.path(), &name)?;
            *bytes = bytes
                .checked_add(saved.bytes)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            *files += 1;
            integrity.push(saved);
            if *files > MAX_RESTORE_FILES || *bytes > MAX_RESTORE_BYTES {
                return Err("The documents are too large to put in one safe backup.".to_string());
            }
        }
    }
    Ok(())
}

fn allowed_archive_path(path: &Path, is_dir: bool) -> bool {
    // The write-ahead log travels with the database: if a checkpoint could not
    // finish, her most recent entries are in it and nowhere else.
    if path == Path::new(ARCHIVE_MANIFEST)
        || path == Path::new(ARCHIVE_INTEGRITY)
        || path == Path::new(DB_FILES[0])
        || path == Path::new(DB_FILES[1])
    {
        return !is_dir;
    }
    if path.starts_with(DOCUMENTS_DIR) {
        return is_dir || path.components().count() > 1;
    }
    false
}

pub(crate) fn validate_archive_path(raw_name: &str, path: &Path) -> Result<(), String> {
    // zip 9 enclosed_name strips a leading root; reject it before accepting
    // the normalized path, preserving zip 2's absolute-path refusal.
    if raw_name.starts_with('/')
        || raw_name.len() > MAX_ARCHIVE_PATH_BYTES
        || raw_name.contains('\\')
        || raw_name.contains(':')
        || path.components().any(|component| {
            component.as_os_str().to_string_lossy().len() > MAX_ARCHIVE_COMPONENT_BYTES
        })
    {
        return Err("The backup contains an unsafe or excessively long file path.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_compression_ratio(
    uncompressed: u64,
    compressed: u64,
    max_ratio: u64,
) -> Result<(), String> {
    if uncompressed <= COMPRESSION_RATIO_FLOOR {
        return Ok(());
    }
    if compressed == 0 || uncompressed.checked_div(compressed).unwrap_or(u64::MAX) > max_ratio {
        return Err("The backup contains an unsafe compression ratio.".to_string());
    }
    Ok(())
}

/// Copy a restored file's bytes from the archive to disk, hashing exactly the
/// bytes written. Returns the byte count and SHA-256 of what was written.
///
/// Hashing while writing replaces reopening each new file to hash it
/// afterwards. That reopen is what made staging slow on Windows (about 19 ms
/// per just-written file, most of a large restore). The check is the same: the bytes
/// that went to the file must match the archive's integrity record before the
/// restore is staged, and the file is still flushed with `sync_all` first.
pub(crate) fn copy_and_hash(
    reader: &mut impl Read,
    output: &mut File,
) -> Result<(u64, String), String> {
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Could not restore a file: {e}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|e| format!("Could not restore a file: {e}"))?;
        hasher.update(&buffer[..read]);
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| "The restored file is too large.".to_string())?;
    }
    Ok((bytes, hex::encode(hasher.finalize())))
}

fn sha256_file_from_reader(reader: &mut impl Read) -> Result<(u64, String, Vec<u8>), String> {
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    let mut prefix = Vec::with_capacity(SQLITE_MAGIC.len());
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Could not verify a file in that backup: {e}"))?;
        if read == 0 {
            break;
        }
        if prefix.len() < SQLITE_MAGIC.len() {
            let wanted = (SQLITE_MAGIC.len() - prefix.len()).min(read);
            prefix.extend_from_slice(&buffer[..wanted]);
        }
        hasher.update(&buffer[..read]);
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| "The backup is too large.".to_string())?;
    }
    Ok((bytes, hex::encode(hasher.finalize()), prefix))
}

fn safe_relative_document_path(relative_path: &str) -> Result<&str, String> {
    if relative_path.is_empty()
        || Path::new(relative_path).is_absolute()
        || relative_path.contains('\\')
        || relative_path.contains(':')
        || relative_path.contains('\0')
    {
        return Err("Invalid document path in database.".to_string());
    }
    let climbs_out = Path::new(relative_path)
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)));
    if climbs_out {
        return Err("Document path escapes storage.".to_string());
    }
    Ok(relative_path)
}

pub(crate) fn query_referenced_documents(database_path: &Path) -> Result<HashSet<String>, String> {
    if !database_path.is_file() {
        return Ok(HashSet::new());
    }
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not inspect database: {e}"))?;

    let has_table: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='study_materials'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|e| format!("Could not inspect database: {e}"))?;

    if !has_table {
        return Err("The database is missing the study_materials table.".to_string());
    }

    let mut stmt = connection
        .prepare("PRAGMA table_info(study_materials)")
        .map_err(|e| format!("Could not inspect table schema: {e}"))?;
    let has_file_path = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Could not inspect table schema: {e}"))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| format!("Could not inspect table schema: {e}"))?
        .into_iter()
        .any(|col| col == "file_path");

    if !has_file_path {
        return Err(
            "The database study_materials table is missing the file_path column.".to_string(),
        );
    }

    let mut stmt = connection
        .prepare(
            "SELECT DISTINCT file_path FROM study_materials WHERE file_path IS NOT NULL AND TRIM(file_path) != ''",
        )
        .map_err(|e| format!("Could not query document references: {e}"))?;

    let mut referenced = HashSet::new();
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Could not read document paths: {e}"))?;

    for row in rows {
        let raw = row.map_err(|e| format!("Could not read document path: {e}"))?;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = trimmed.replace('\\', "/");
        safe_relative_document_path(&normalized)?;
        referenced.insert(normalized);
    }

    Ok(referenced)
}

pub(crate) fn scan_active_documents(documents_dir: &Path) -> Result<HashSet<String>, String> {
    let mut files = HashSet::new();
    if !documents_dir.exists() {
        return Ok(files);
    }
    scan_active_documents_recursive(documents_dir, Path::new(""), &mut files)?;
    Ok(files)
}

fn scan_active_documents_recursive(
    current_dir: &Path,
    relative_prefix: &Path,
    collected: &mut HashSet<String>,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(current_dir) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(format!("Could not read documents folder: {err}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read document entry: {e}"))?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "A linked file cannot be included in documents: {}",
                path.display()
            ));
        }
        let rel_path = relative_prefix.join(&file_name);
        if metadata.is_dir() {
            scan_active_documents_recursive(&path, &rel_path, collected)?;
        } else if metadata.is_file() {
            let normalized = rel_path.to_string_lossy().replace('\\', "/");
            collected.insert(normalized);
        }
    }
    Ok(())
}

pub(crate) fn scan_staged_deletion_paths(trash_dir: &Path) -> Result<HashSet<String>, String> {
    let mut staged = HashSet::new();
    let entries = match std::fs::read_dir(trash_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(staged),
        Err(e) => return Err(format!("Could not read trash directory: {e}")),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read trash directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("meta") {
            let meta_json = std::fs::read_to_string(&path)
                .map_err(|e| format!("Could not read staged deletion metadata in trash: {e}"))?;
            let meta: crate::documents::StagedDeletion = serde_json::from_str(&meta_json)
                .map_err(|e| format!("Could not parse staged deletion metadata in trash: {e}"))?;
            crate::documents::validate_staged_id(&meta.staged_id)
                .map_err(|e| format!("Invalid staged deletion id in trash: {e}"))?;
            let normalized = meta.original_relative_path.replace('\\', "/");
            let safe_rel = crate::documents::safe_relative_path(&normalized).map_err(|e| {
                format!("Invalid original relative path in staged deletion metadata: {e}")
            })?;
            staged.insert(safe_rel.to_string());
        }
    }

    Ok(staged)
}

/// Documents to be archived whose FAA reference copy or picture-card details
/// no longer match their bytes on disk. A 0.6.1/0.6.2 file swap left these;
/// declaring them keeps every later backup possible while a restore still
/// refuses any other mismatch as damage.
fn detached_documents(
    root: &Path,
    database: &Path,
    to_archive: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let conn = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not inspect database: {e}"))?;
    let has = |table: &str| -> Result<bool, String> {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |r| r.get(0),
        )
        .map_err(|e| format!("Could not inspect database: {e}"))
    };
    let open = |path: &str| -> Result<File, String> {
        let full = root
            .join(DOCUMENTS_DIR)
            .join(safe_relative_document_path(path)?);
        File::open(full).map_err(|e| format!("Could not inspect document {path}: {e}"))
    };
    let mut detached = std::collections::BTreeSet::new();
    if has("faa_reference_copies")? {
        let mut stmt = conn
            .prepare("SELECT m.file_path, f.content_sha256 FROM faa_reference_copies f JOIN study_materials m ON m.id=f.material_id WHERE m.file_path IS NOT NULL")
            .map_err(|e| format!("Could not inspect FAA reference PDFs: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Could not inspect FAA reference PDFs: {e}"))?;
        for row in rows {
            let (path, expected) =
                row.map_err(|e| format!("Could not inspect FAA reference PDFs: {e}"))?;
            if to_archive.contains(&path)
                && sha256_file_from_reader(&mut open(&path)?)?.1 != expected
            {
                detached.insert(path);
            }
        }
    }
    if has("visual_card_regions")? {
        let mut stmt = conn
            .prepare("SELECT r.id, m.file_path FROM visual_card_regions r JOIN study_materials m ON m.id=r.image_material_id WHERE m.file_path IS NOT NULL")
            .map_err(|e| format!("Could not inspect picture cards: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Could not inspect picture cards: {e}"))?;
        for row in rows {
            let (id, path) = row.map_err(|e| format!("Could not inspect picture cards: {e}"))?;
            if !to_archive.contains(&path) || detached.contains(&path) {
                continue;
            }
            let region = crate::visual_cards::read_region(&conn, &id)?;
            let mut bytes = Vec::new();
            open(&path)?
                .take((crate::visual_cards::MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Could not inspect document {path}: {e}"))?;
            if crate::visual_cards::verify_bytes(&region, &bytes).is_err() {
                detached.insert(path);
            }
        }
    }
    Ok(detached.into_iter().collect())
}

struct TempFileGuard<'a>(&'a Path);
impl<'a> Drop for TempFileGuard<'a> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.0);
    }
}

fn verify_archive_database_and_documents<R: Read + Seek>(
    root: &Path,
    archive: &mut ZipArchive<R>,
    manifest: &CompleteBackupManifest,
    archive_documents: &HashSet<String>,
) -> Result<(Vec<String>, Vec<String>, usize, usize), String> {
    let mut db_entry = archive
        .by_name(DB_FILES[0])
        .map_err(|_| "That backup does not contain a Flight Deck database.".to_string())?;

    static INSPECT_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = INSPECT_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let unique = format!(
        "hfd-inspect-{}-{}-{count}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    let staging_dir = root.join(".verify-staging");
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Could not prepare verification folder: {e}"))?;
    let temp_db_path = staging_dir.join(unique);
    let _guard = TempFileGuard(&temp_db_path);

    let mut temp_file = File::create(&temp_db_path)
        .map_err(|e| format!("Could not inspect backup database: {e}"))?;
    std::io::copy(&mut db_entry, &mut temp_file)
        .map_err(|e| format!("Could not inspect backup database: {e}"))?;
    drop(temp_file);
    drop(db_entry);

    verify_application_database(&temp_db_path)?;
    let conn = Connection::open(&temp_db_path).map_err(|_| "Could not inspect picture cards.")?;
    let detached: HashSet<&str> = manifest
        .detached_at_export
        .iter()
        .map(|s| s.as_str())
        .collect();
    // Picture regions whose picture is gone (image deleted, file removed or
    // missing) or was declared changed at export. Their card text survives.
    let mut unavailable_regions: HashSet<String> = HashSet::new();
    let mut unavailable_pictures = 0usize;
    // FAA reference copies whose PDF was removed or declared changed.
    let mut unavailable_references = 0usize;
    if crate::visual_cards::exists(&conn) {
        let mut stmt=conn.prepare("SELECT r.id,m.file_path FROM visual_card_regions r LEFT JOIN study_materials m ON m.id=r.image_material_id").map_err(|_|"Could not inspect picture cards.")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(|_| "Could not inspect picture cards.")?;
        for pair in rows {
            let (id, path) = pair.map_err(|_| "Damaged picture lookup.")?;
            let Some(path) = path else {
                unavailable_regions.insert(id);
                continue;
            };
            if !archive_documents.contains(&path) {
                unavailable_regions.insert(id);
                continue;
            } // completeness and missingAtExport checked below
            let r = crate::visual_cards::read_region(&conn, &id)?;
            let entry = archive
                .by_name(&format!("documents/{path}"))
                .map_err(|_| "Missing picture bytes.")?;
            let mut bytes = Vec::new();
            entry
                .take((crate::visual_cards::MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read picture bytes.")?;
            if let Err(error) = crate::visual_cards::verify_bytes(&r, &bytes) {
                // Only a picture declared changed when the backup was made may
                // differ; anything else is a damaged archive.
                if !detached.contains(path.as_str()) {
                    return Err(error);
                }
                unavailable_regions.insert(id);
            }
        }
        unavailable_pictures = crate::visual_cards::cards_on_regions(&conn, &unavailable_regions)?;
    }

    // Schema verification above checks the stored identity's shape. Here the
    // archive supplies the actual PDF bytes, which a database-only check cannot.
    if newest_migration_version(&conn)? >= 27 {
        let mut stmt = conn.prepare(
            "SELECT m.file_path, f.content_sha256 FROM faa_reference_copies f JOIN study_materials m ON m.id=f.material_id",
        ).map_err(|_| "Could not inspect FAA reference PDFs.")?;
        let copies = stmt
            .query_map([], |r| {
                Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|_| "Could not inspect FAA reference PDFs.")?;
        for copy in copies {
            let (path, expected) = copy.map_err(|_| "Damaged FAA reference PDF details.")?;
            // A copy whose file was removed has no bytes to check.
            let Some(path) = path else {
                unavailable_references += 1;
                continue;
            };
            safe_relative_document_path(&path)?;
            // Preserve complete backups' explicit missing-at-export handling.
            if !archive_documents.contains(&path) {
                continue;
            }
            let mut entry = archive
                .by_name(&format!("documents/{path}"))
                .map_err(|_| "Missing FAA reference PDF bytes.")?;
            let (_, actual, _) = sha256_file_from_reader(&mut entry)?;
            if actual != expected {
                if !detached.contains(path.as_str()) {
                    return Err(
                        "The FAA reference PDF does not match its saved copy details.".into(),
                    );
                }
                unavailable_references += 1;
            }
        }
    }

    let referenced_documents = query_referenced_documents(&temp_db_path)?;
    let referenced_set: HashSet<&str> = referenced_documents.iter().map(|s| s.as_str()).collect();
    let missing_declared: HashSet<&str> = manifest
        .missing_at_export
        .iter()
        .map(|s| s.as_str())
        .collect();

    let mut missing_documents = manifest.missing_at_export.clone();

    for referenced in &referenced_documents {
        if !archive_documents.contains(referenced) {
            if manifest.format_version >= ARCHIVE_VERSION {
                // In format version 3 (newly created complete backups), strict two-way completeness
                // is enforced: every referenced document missing from storage must have been
                // identified and declared in manifest.missing_at_export. An unexpected omission
                // fails archive verification.
                if !missing_declared.contains(referenced.as_str()) {
                    return Err(format!(
                        "The backup database references a document that is missing from the archive: {referenced}"
                    ));
                }
            } else {
                // In format version 2 (older backups created before missing_at_export was tracked),
                // pre-existing missing files are tolerated so she can restore her library.
                // We collect any referenced document missing from the archive so restore
                // previews and warnings disclose it.
                if !missing_declared.contains(referenced.as_str()) {
                    missing_documents.push(referenced.clone());
                }
            }
        }
    }

    let mut unreferenced_documents = Vec::new();
    if manifest.format_version >= ARCHIVE_VERSION {
        let mut unreferenced: Vec<_> = archive_documents
            .iter()
            .filter(|doc| !referenced_set.contains(doc.as_str()))
            .collect();
        unreferenced.sort();
        if let Some(first_unreferenced) = unreferenced.first() {
            return Err(format!(
                "The backup archive contains an unreferenced document: {first_unreferenced}"
            ));
        }
    } else {
        for archived in archive_documents {
            if !referenced_set.contains(archived.as_str()) {
                unreferenced_documents.push(archived.clone());
            }
        }
    }

    missing_documents.sort();
    missing_documents.dedup();
    unreferenced_documents.sort();
    unreferenced_documents.dedup();

    Ok((
        missing_documents,
        unreferenced_documents,
        unavailable_pictures,
        unavailable_references,
    ))
}

/// Reads the small manifest entry of an open archive.
fn read_manifest_from(archive: &mut ZipArchive<File>) -> Result<CompleteBackupManifest, String> {
    let mut entry = archive
        .by_name(ARCHIVE_MANIFEST)
        .map_err(|_| "That backup does not contain a manifest.".to_string())?;
    if entry.size() > 64 * 1024 {
        return Err("That backup manifest is unexpectedly large.".to_string());
    }
    let mut json = String::new();
    entry
        .read_to_string(&mut json)
        .map_err(|e| format!("Could not read the backup manifest: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("The backup manifest is invalid: {e}"))
}

/// The Mac (device id) a full copy was made by; only the manifest is read.
fn archive_device_id(source: &Path) -> Result<Option<String>, String> {
    let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| zip_error("That is not a readable Flight Deck backup", e))?;
    Ok(read_manifest_from(&mut archive)?.device_id)
}

pub(crate) fn inspect_archive(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| zip_error("That is not a readable Flight Deck backup", e))?;

    let manifest = read_manifest_from(&mut archive)?;

    crate::phone_work::refuse_phone_copy(manifest.platform.as_deref(), cfg!(target_os = "ios"))?;
    if manifest.format != ARCHIVE_FORMAT
        || !matches!(
            manifest.format_version,
            LEGACY_ARCHIVE_VERSION | V2_ARCHIVE_VERSION | ARCHIVE_VERSION
        )
    {
        return Err("That backup format is not supported by this version of the app.".to_string());
    }
    if let Some(n) = manifest.schema_version {
        let supported = crate::CURRENT_SCHEMA_VERSION;
        if n > supported {
            return Err(format!(
                "That backup was made by a newer version of Flight Deck (database version {n}; this app understands {supported}). Update the app on this device first."
            ));
        }
    }

    let mut expected_integrity = if manifest.format_version >= V2_ARCHIVE_VERSION {
        let mut entry = archive
            .by_name(ARCHIVE_INTEGRITY)
            .map_err(|_| "That backup does not contain integrity information.".to_string())?;
        if entry.size() > 2 * 1024 * 1024 {
            return Err("That backup's integrity information is unexpectedly large.".to_string());
        }
        let mut json = String::new();
        entry
            .read_to_string(&mut json)
            .map_err(|e| format!("Could not read backup integrity information: {e}"))?;
        let integrity: CompleteBackupIntegrity = serde_json::from_str(&json)
            .map_err(|e| format!("The backup integrity information is invalid: {e}"))?;
        if integrity.algorithm != "sha256" {
            return Err("That backup uses an unsupported integrity algorithm.".to_string());
        }
        let mut files = HashMap::new();
        for item in integrity.files {
            if item.sha256.len() != 64
                || !item.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                || files.insert(item.path.clone(), item).is_some()
            {
                return Err("That backup contains invalid integrity information.".to_string());
            }
        }
        Some(files)
    } else {
        None
    };

    let mut names = HashSet::new();
    let mut archive_documents = HashSet::new();
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut has_database = false;

    if archive.len() > MAX_RESTORE_FILES + 2 {
        return Err("That backup contains too many files.".to_string());
    }

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| zip_error("Could not inspect the backup", e))?;
        let raw_name = entry
            .name()
            .map_err(|e| zip_error("Could not read a backup file name", e))?
            .into_owned();
        let path = entry
            .enclosed_name()
            .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
        validate_archive_path(&raw_name, &path)?;
        validate_compression_ratio(entry.size(), entry.compressed_size(), MAX_COMPRESSION_RATIO)?;
        if !allowed_archive_path(&path, entry.is_dir()) {
            return Err(format!(
                "The backup contains an unexpected file: {raw_name}"
            ));
        }
        if !names.insert(path.clone()) {
            return Err(format!("The backup contains a duplicate file: {raw_name}"));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Linked files are not allowed in a backup.".to_string());
        }

        if manifest.format_version == LEGACY_ARCHIVE_VERSION && path == Path::new(ARCHIVE_INTEGRITY)
        {
            return Err(format!(
                "The backup contains an unexpected file: {raw_name}"
            ));
        }
        if path == Path::new(DB_FILES[0]) {
            has_database = true;
        }
        if path == Path::new(DB_FILES[0]) && manifest.format_version == LEGACY_ARCHIVE_VERSION {
            // Read the first bytes now. A truncated or wrong file is far
            // better discovered here than after her data has been moved aside.
            let mut header = [0u8; SQLITE_MAGIC.len()];
            if entry.read_exact(&mut header).is_err() || !is_sqlite_header(&header) {
                return Err(
                    "The database in that backup is damaged, or that file is not a Flight Deck backup."
                        .to_string(),
                );
            }
        }
        if path != Path::new(ARCHIVE_MANIFEST)
            && path != Path::new(ARCHIVE_INTEGRITY)
            && !entry.is_dir()
        {
            if path.starts_with(DOCUMENTS_DIR) {
                if let Ok(rel) = path.strip_prefix(DOCUMENTS_DIR) {
                    let normalized = rel.to_string_lossy().replace('\\', "/");
                    archive_documents.insert(normalized);
                }
            }
            files += 1;
            bytes = bytes
                .checked_add(entry.size())
                .ok_or_else(|| "The backup is too large.".to_string())?;
            if bytes > MAX_RESTORE_BYTES {
                return Err("That backup is larger than this app can safely restore.".to_string());
            }

            if let Some(expected) = expected_integrity.as_mut() {
                let normalized = path.to_string_lossy().replace('\\', "/");
                let expected = expected
                    .remove(&normalized)
                    .ok_or_else(|| format!("The backup has no integrity record for {raw_name}"))?;
                let (actual_bytes, actual_sha256, prefix) = sha256_file_from_reader(&mut entry)?;
                if actual_bytes != expected.bytes
                    || entry.size() != expected.bytes
                    || !actual_sha256.eq_ignore_ascii_case(&expected.sha256)
                {
                    return Err(format!(
                        "The backup failed its integrity check for {raw_name}"
                    ));
                }
                if path == Path::new(DB_FILES[0]) && !is_sqlite_header(&prefix) {
                    return Err(
                        "The database in that backup is damaged, or that file is not a Flight Deck backup."
                            .to_string(),
                    );
                }
            }
        }
    }

    if expected_integrity
        .as_ref()
        .is_some_and(|expected| !expected.is_empty())
    {
        return Err(
            "The backup integrity list contains files that are not in the archive.".to_string(),
        );
    }

    if !has_database {
        return Err("That backup does not contain a Flight Deck database.".to_string());
    }

    let (missing_documents, unreferenced_documents, unavailable_pictures, unavailable_references) =
        if manifest.format_version >= V2_ARCHIVE_VERSION {
            verify_archive_database_and_documents(
                root,
                &mut archive,
                &manifest,
                &archive_documents,
            )?
        } else {
            (Vec::new(), Vec::new(), 0, 0)
        };

    Ok(CompleteBackupInfo {
        schema_version: manifest.schema_version,
        device_id: manifest.device_id,
        platform: manifest.platform,
        current_schema_version: crate::CURRENT_SCHEMA_VERSION,
        app_version: manifest.app_version,
        current_app_version: current_app_version.to_string(),
        created_at: manifest.created_at,
        files,
        bytes,
        file_bytes: std::fs::metadata(source)
            .map_err(|e| format!("Could not read that backup’s size: {e}"))?
            .len(),
        path: source.to_string_lossy().to_string(),
        missing_documents,
        unreferenced_documents,
        unavailable_pictures,
        unavailable_references,
    })
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) enum RestorePhase {
    Protecting,
    Protected,
    Activating,
    Committed,
    RollingBack,
    RolledBack,
    UnresolvedRecovery,
}

#[cfg(windows)]
pub(crate) fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
}

#[cfg(not(windows))]
pub(crate) fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn inspect_storage_root(dir: &Path, name: &str) -> Result<Option<std::fs::Metadata>, String> {
    match std::fs::symlink_metadata(dir) {
        Ok(meta) => {
            if is_symlink_or_reparse(&meta) {
                return Err(format!("{name} is an unsafe symlink or reparse point"));
            }
            if !meta.is_dir() {
                return Err(format!("{name} is not a directory"));
            }
            Ok(Some(meta))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not inspect {name}: {e}")),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArtifactIdentity {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FaultOccurrence {
    Always,
    OnOccurrence(usize),
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FaultConfig {
    pub fault: InjectedFault,
    pub occurrence: FaultOccurrence,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InjectedFault {
    JournalTempCreate,
    JournalWrite,
    JournalSync,
    JournalRename,
    JournalDelete,
    JournalRead,
    PlanRead,
    InventoryReadDir,
    ProtectDbRename(usize),
    ProtectDocsRename,
    InstallDbRename(usize),
    InstallDocsRename,
    ReturnDbRename(usize),
    ReturnDocsRename,
    ReturnDocsMetadata,
    RootReadDir,
    BackupsReadDir,
    PendingEntryRead,
}

#[cfg(test)]
std::thread_local! {
    static ACTIVE_FAULT: std::cell::RefCell<Option<FaultConfig>> = const { std::cell::RefCell::new(None) };
    static FAULT_HITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static FAULT_FIRED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static OBSERVED_FAULT_CALLS: std::cell::RefCell<Vec<InjectedFault>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) struct ScopedFault {
    prev_config: Option<FaultConfig>,
}

#[cfg(test)]
impl ScopedFault {
    pub fn set(fault: InjectedFault) -> Self {
        Self::set_config(FaultConfig {
            fault,
            occurrence: FaultOccurrence::Always,
        })
    }

    pub fn set_occurrence(fault: InjectedFault, occurrence: usize) -> Self {
        Self::set_config(FaultConfig {
            fault,
            occurrence: FaultOccurrence::OnOccurrence(occurrence),
        })
    }

    pub fn set_config(config: FaultConfig) -> Self {
        FAULT_HITS.with(|h| h.set(0));
        FAULT_FIRED.with(|f| f.set(0));
        OBSERVED_FAULT_CALLS.with(|c| c.borrow_mut().clear());
        let prev = ACTIVE_FAULT.with(|f| f.replace(Some(config)));
        ScopedFault { prev_config: prev }
    }

    pub fn hits() -> usize {
        FAULT_HITS.with(|h| h.get())
    }

    pub fn fired_count() -> usize {
        FAULT_FIRED.with(|f| f.get())
    }

    #[allow(dead_code)]
    pub fn observed_calls() -> Vec<InjectedFault> {
        OBSERVED_FAULT_CALLS.with(|c| c.borrow().clone())
    }
}

#[cfg(test)]
impl Drop for ScopedFault {
    fn drop(&mut self) {
        ACTIVE_FAULT.with(|f| *f.borrow_mut() = self.prev_config);
    }
}

#[cfg(test)]
fn check_injected_fault(fault: InjectedFault) -> Result<(), std::io::Error> {
    OBSERVED_FAULT_CALLS.with(|c| c.borrow_mut().push(fault));
    let mut should_trigger = false;
    ACTIVE_FAULT.with(|cfg_cell| {
        if let Some(cfg) = *cfg_cell.borrow() {
            if cfg.fault == fault {
                let current_hit = FAULT_HITS.with(|h| {
                    let v = h.get() + 1;
                    h.set(v);
                    v
                });
                match cfg.occurrence {
                    FaultOccurrence::Always => should_trigger = true,
                    FaultOccurrence::OnOccurrence(target) => {
                        if current_hit == target {
                            should_trigger = true;
                        }
                    }
                }
            }
        }
    });

    if should_trigger {
        FAULT_FIRED.with(|f| f.set(f.get() + 1));
        Err(std::io::Error::other(format!(
            "Injected test fault: {fault:?}"
        )))
    } else {
        Ok(())
    }
}

fn inventory_directory_artifacts(dir: &Path) -> Result<Vec<ArtifactIdentity>, String> {
    let mut artifacts = Vec::new();
    let meta = match std::fs::symlink_metadata(dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(artifacts),
        Err(e) => {
            return Err(format!(
                "Could not inspect directory {}: {e}",
                dir.display()
            ))
        }
    };
    if is_symlink_or_reparse(&meta) {
        return Err(format!(
            "Directory path is an unsafe symlink or reparse point: {}",
            dir.display()
        ));
    }
    if !meta.is_dir() {
        return Err(format!(
            "Directory path is not a directory: {}",
            dir.display()
        ));
    }

    fn collect_recursive(
        base: &Path,
        current: &Path,
        artifacts: &mut Vec<ArtifactIdentity>,
    ) -> Result<(), String> {
        #[cfg(test)]
        check_injected_fault(InjectedFault::InventoryReadDir)
            .map_err(|e| format!("Could not read directory {}: {e}", current.display()))?;

        let entries = std::fs::read_dir(current)
            .map_err(|e| format!("Could not read directory {}: {e}", current.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Could not read entry: {e}"))?;
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path)
                .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
            if is_symlink_or_reparse(&meta) {
                return Err(format!(
                    "Linked path or reparse point detected at {}",
                    path.display()
                ));
            }
            if meta.is_dir() {
                collect_recursive(base, &path, artifacts)?;
            } else if meta.file_type().is_file() {
                let rel = path
                    .strip_prefix(base)
                    .map_err(|e| format!("Path prefix error: {e}"))?
                    .to_string_lossy()
                    .replace('\\', "/");
                let bytes = std::fs::read(&path)
                    .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                let sha256 = hex::encode(Sha256::digest(&bytes));
                artifacts.push(ArtifactIdentity {
                    name: rel,
                    sha256,
                    size: bytes.len() as u64,
                });
            } else {
                return Err(format!(
                    "Unexpected non-regular file type at {}",
                    path.display()
                ));
            }
        }
        Ok(())
    }
    collect_recursive(dir, dir, &mut artifacts)?;
    Ok(artifacts)
}

fn validate_artifact_identity(art: &ArtifactIdentity) -> Result<(), String> {
    if art.sha256.len() != 64 || !art.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "Invalid SHA-256 digest '{}' for artifact '{}'",
            art.sha256, art.name
        ));
    }
    Ok(())
}

fn validate_relative_document_path(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains('\0')
        || trimmed.contains(':')
    {
        return Err(format!(
            "Unsafe or invalid relative document path in inventory: '{name}'"
        ));
    }
    let p = Path::new(trimmed);
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(_) => {}
            _ => {
                return Err(format!(
                    "Invalid path component in document inventory: '{name}'"
                ))
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) enum OriginalDocumentsPresence {
    Absent,
    PresentEmpty,
    PresentWithContent,
    LegacyUnknown,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct RestoreJournal {
    #[serde(default)]
    pub operation_id: String,
    pub phase: RestorePhase,
    pub rollback_rel_path: String,
    pub replace_documents: bool,
    #[serde(default)]
    pub original_documents_presence: Option<OriginalDocumentsPresence>,
    #[serde(default)]
    pub protected_db_files: Vec<String>,
    #[serde(default)]
    pub protected_documents: bool,
    #[serde(default)]
    pub installed_db_files: Vec<String>,
    #[serde(default)]
    pub installed_documents: bool,
    #[serde(default)]
    pub original_db_artifacts: Vec<ArtifactIdentity>,
    #[serde(default)]
    pub staged_db_artifacts: Vec<ArtifactIdentity>,
    #[serde(default)]
    pub original_document_artifacts: Vec<ArtifactIdentity>,
    #[serde(default)]
    pub staged_document_artifacts: Vec<ArtifactIdentity>,
    pub failure_reason: Option<String>,
}

impl RestoreJournal {
    pub fn new(rollback_rel_path: String, replace_documents: bool) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        Self {
            operation_id: format!("restore-{}-{}", std::process::id(), nonce),
            phase: RestorePhase::Protecting,
            rollback_rel_path,
            replace_documents,
            original_documents_presence: None,
            protected_db_files: Vec::new(),
            protected_documents: false,
            installed_db_files: Vec::new(),
            installed_documents: false,
            original_db_artifacts: Vec::new(),
            staged_db_artifacts: Vec::new(),
            original_document_artifacts: Vec::new(),
            staged_document_artifacts: Vec::new(),
            failure_reason: None,
        }
    }

    pub fn validate(&self, root: &Path) -> Result<PathBuf, String> {
        let trimmed = self.rollback_rel_path.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('/')
            || trimmed.starts_with('\\')
            || trimmed.contains("..")
            || trimmed.contains('\0')
            || trimmed.contains(':')
        {
            return Err(format!("Invalid rollback path in journal: '{trimmed}'"));
        }

        let path_obj = Path::new(trimmed);
        let components: Vec<_> = path_obj.components().collect();
        if components.len() != 2 {
            return Err(format!(
                "Rollback path in journal must be a direct child under backups/: '{trimmed}'"
            ));
        }
        match components[0] {
            std::path::Component::Normal(first) if first == "backups" => {}
            _ => return Err("Rollback path in journal must reside within backups/".to_string()),
        }

        let child_name = match components[1] {
            std::path::Component::Normal(child) => child.to_string_lossy(),
            _ => return Err("Rollback path contains invalid child component".to_string()),
        };
        if child_name.is_empty()
            || child_name == "backups"
            || child_name == "."
            || child_name == ".."
        {
            return Err(
                "Rollback path cannot be the backups directory itself or an alias".to_string(),
            );
        }

        // Validate ancestors and target against symlinks and reparse points
        let backups_dir = root.join("backups");
        match std::fs::symlink_metadata(&backups_dir) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    return Err(
                        "Backups root directory is an unsafe symlink/reparse point".to_string()
                    );
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not inspect backups directory: {e}")),
        }

        let full_rollback = root.join(trimmed);
        match std::fs::symlink_metadata(&full_rollback) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    return Err(
                        "Rollback path in journal is an unsafe symlink/reparse point".to_string(),
                    );
                }
                if !meta.is_dir() {
                    return Err("Rollback path in journal is not a directory".to_string());
                }

                // Strictly validate all entries and subdirectories inside full_rollback
                let entries = std::fs::read_dir(&full_rollback)
                    .map_err(|e| format!("Could not read rollback directory: {e}"))?;
                for entry in entries {
                    let entry = entry.map_err(|e| format!("Could not read rollback entry: {e}"))?;
                    let entry_meta = std::fs::symlink_metadata(entry.path())
                        .map_err(|e| format!("Could not inspect rollback artifact: {e}"))?;
                    if is_symlink_or_reparse(&entry_meta) {
                        return Err(format!(
                            "Rollback artifact is an unsafe symlink or reparse point: {}",
                            entry.path().display()
                        ));
                    }
                    if entry_meta.is_dir() {
                        let sub_entries = std::fs::read_dir(entry.path()).map_err(|e| {
                            format!("Could not read directory {}: {e}", entry.path().display())
                        })?;
                        for sub in sub_entries {
                            let sub = sub.map_err(|e| format!("Could not read sub entry: {e}"))?;
                            let sub_meta = std::fs::symlink_metadata(sub.path())
                                .map_err(|e| format!("Could not inspect artifact: {e}"))?;
                            if is_symlink_or_reparse(&sub_meta) {
                                return Err(format!(
                                    "Rollback nested artifact is an unsafe symlink or reparse point: {}",
                                    sub.path().display()
                                ));
                            }
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not inspect rollback directory: {e}")),
        }

        let mut seen_protected = HashSet::new();
        for name in &self.protected_db_files {
            if !DB_FILES.contains(&name.as_str()) {
                return Err(format!(
                    "Unrecognized protected DB file in journal: '{name}'"
                ));
            }
            if !seen_protected.insert(name) {
                return Err(format!("Duplicate protected DB file in journal: '{name}'"));
            }
        }
        let mut seen_installed = HashSet::new();
        for name in &self.installed_db_files {
            if !DB_FILES.contains(&name.as_str()) {
                return Err(format!(
                    "Unrecognized installed DB file in journal: '{name}'"
                ));
            }
            if !seen_installed.insert(name) {
                return Err(format!("Duplicate installed DB file in journal: '{name}'"));
            }
        }

        let mut seen_orig_db = HashSet::new();
        for art in &self.original_db_artifacts {
            if !DB_FILES.contains(&art.name.as_str()) {
                return Err(format!(
                    "Unrecognized original DB file in journal inventory: '{}'",
                    art.name
                ));
            }
            if !seen_orig_db.insert(&art.name) {
                return Err(format!(
                    "Duplicate original DB artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        let mut seen_staged_db = HashSet::new();
        for art in &self.staged_db_artifacts {
            if !DB_FILES.contains(&art.name.as_str()) {
                return Err(format!(
                    "Unrecognized staged DB file in journal inventory: '{}'",
                    art.name
                ));
            }
            if !seen_staged_db.insert(&art.name) {
                return Err(format!(
                    "Duplicate staged DB artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        let mut seen_orig_doc = HashSet::new();
        for art in &self.original_document_artifacts {
            validate_relative_document_path(&art.name)?;
            if !seen_orig_doc.insert(&art.name) {
                return Err(format!(
                    "Duplicate original document artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        let mut seen_staged_doc = HashSet::new();
        for art in &self.staged_document_artifacts {
            validate_relative_document_path(&art.name)?;
            if !seen_staged_doc.insert(&art.name) {
                return Err(format!(
                    "Duplicate staged document artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        Ok(full_rollback)
    }
}

fn write_journal(root: &Path, journal: &RestoreJournal) -> Result<(), String> {
    let target = root.join(RESTORE_JOURNAL_FILE);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = root.join(format!(
        "{RESTORE_JOURNAL_FILE}.tmp-{}-{}",
        std::process::id(),
        nonce
    ));
    let json = serde_json::to_string_pretty(journal)
        .map_err(|e| format!("Could not serialize restore journal: {e}"))?;

    #[cfg(test)]
    check_injected_fault(InjectedFault::JournalTempCreate)
        .map_err(|e| format!("Could not create restore journal temporary file: {e}"))?;

    struct TmpJournalGuard<'a>(&'a Path);
    impl<'a> Drop for TmpJournalGuard<'a> {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0);
        }
    }

    {
        let mut file = File::create(&tmp)
            .map_err(|e| format!("Could not create restore journal temporary file: {e}"))?;
        let guard = TmpJournalGuard(&tmp);

        #[cfg(test)]
        check_injected_fault(InjectedFault::JournalWrite)
            .map_err(|e| format!("Could not write restore journal: {e}"))?;

        file.write_all(json.as_bytes())
            .map_err(|e| format!("Could not write restore journal: {e}"))?;

        #[cfg(test)]
        check_injected_fault(InjectedFault::JournalSync)
            .map_err(|e| format!("Could not sync restore journal: {e}"))?;

        file.sync_all()
            .map_err(|e| format!("Could not sync restore journal: {e}"))?;

        #[cfg(test)]
        check_injected_fault(InjectedFault::JournalRename)
            .map_err(|e| format!("Could not commit restore journal: {e}"))?;

        std::fs::rename(&tmp, &target)
            .map_err(|e| format!("Could not commit restore journal: {e}"))?;

        std::mem::forget(guard);
    }

    #[cfg(unix)]
    {
        // Explicitly documented best-effort directory sync:
        // Canonical replacement (atomic rename) has already succeeded on disk. On Unix
        // systems supporting directory fsync, this ensures directory entry durability.
        // On systems or sandboxes where directory file descriptors cannot be opened or synced,
        // we do not fail the already-committed canonical journal replacement.
        if let Ok(dir) = File::open(root) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Is a restore unfinished, so that new study packs must wait? Decided from
/// the journal phase like `fresh_staging`: a finished (Committed or
/// RolledBack) journal left behind does not block; anything unreadable or
/// unfinished does, as does a pending folder with no finished journal.
pub(crate) fn restore_blocks_study_pack_import(root: &Path) -> bool {
    match read_journal(root) {
        Ok(Some(journal)) => !matches!(
            journal.phase,
            RestorePhase::Committed | RestorePhase::RolledBack
        ),
        Ok(None) => std::fs::symlink_metadata(root.join(RESTORE_PENDING_DIR)).is_ok(),
        Err(_) => true,
    }
}

fn read_journal(root: &Path) -> Result<Option<RestoreJournal>, String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::JournalRead)
        .map_err(|e| format!("Could not read restore journal: {e}"))?;

    let target = root.join(RESTORE_JOURNAL_FILE);
    let meta = match std::fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not inspect restore journal: {e}")),
    };
    if is_symlink_or_reparse(&meta) {
        return Err("Restore journal is an unsafe symlink/reparse point".to_string());
    }
    if meta.is_dir() {
        return Err("Restore journal path is an unexpected directory".to_string());
    }
    if !meta.file_type().is_file() {
        return Err("Restore journal path is not a regular file".to_string());
    }
    let data = std::fs::read_to_string(&target)
        .map_err(|e| format!("Could not read restore journal: {e}"))?;
    let journal: RestoreJournal = serde_json::from_str(&data)
        .map_err(|e| format!("Restore journal is corrupted or invalid: {e}"))?;
    let _ = journal.validate(root)?;
    Ok(Some(journal))
}

fn remove_journal(root: &Path) -> Result<(), String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::JournalDelete)
        .map_err(|e| format!("Could not remove restore journal: {e}"))?;

    let target = root.join(RESTORE_JOURNAL_FILE);
    match std::fs::symlink_metadata(&target) {
        Ok(meta) => if meta.is_dir() || is_symlink_or_reparse(&meta) {
            std::fs::remove_dir(&target).or_else(|_| std::fs::remove_file(&target))
        } else {
            std::fs::remove_file(&target)
        }
        .map_err(|e| format!("Could not remove restore journal: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "Could not inspect restore journal for removal: {e}"
        )),
    }
}

fn find_unresolved_recovery_evidence(
    root: &Path,
) -> Result<Option<(String, Option<PathBuf>)>, String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::RootReadDir)
        .map_err(|e| format!("Could not inspect root directory: {e}"))?;

    let mut has_tmp_journal = false;
    let root_entries =
        std::fs::read_dir(root).map_err(|e| format!("Could not read root directory: {e}"))?;
    for entry in root_entries {
        let entry = entry.map_err(|e| format!("Could not read entry in root directory: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&format!("{RESTORE_JOURNAL_FILE}.tmp")) {
            has_tmp_journal = true;
            break;
        }
    }

    #[cfg(test)]
    check_injected_fault(InjectedFault::BackupsReadDir)
        .map_err(|e| format!("Could not inspect backups directory: {e}"))?;

    let backups = root.join(BACKUP_DIR);
    let backups_meta = match std::fs::symlink_metadata(&backups) {
        Ok(m) => Some(m),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Could not inspect backups directory: {e}")),
    };
    if let Some(meta) = backups_meta {
        if is_symlink_or_reparse(&meta) {
            return Err("Backups directory is an unsafe symlink or reparse point".into());
        }
        if meta.is_dir() {
            let entries = std::fs::read_dir(&backups)
                .map_err(|e| format!("Could not read backups directory: {e}"))?;
            for entry in entries {
                let entry = entry.map_err(|e| format!("Could not read backup entry: {e}"))?;
                let path = entry.path();
                let entry_meta = std::fs::symlink_metadata(&path).map_err(|e| {
                    format!("Could not inspect backup entry {}: {e}", path.display())
                })?;
                if is_symlink_or_reparse(&entry_meta) {
                    return Err(format!(
                        "Recovery folder is an unsafe symlink or reparse point: {}",
                        path.display()
                    ));
                }
                if entry_meta.is_dir() {
                    if path.join(".recovery-pending").exists() {
                        return Ok(Some((
                            "An unresolved recovery marker was found in backups".to_string(),
                            Some(path),
                        )));
                    }
                    let folder_name = entry.file_name().to_string_lossy().to_string();
                    if folder_name.contains("before-restore")
                        && path.join(DB_FILES[0]).is_file()
                        && !root.join(DB_FILES[0]).is_file()
                    {
                        return Ok(Some((
                            "Active database is missing but an unrecovered safety copy exists in backups"
                                .to_string(),
                            Some(path),
                        )));
                    }
                }
            }
        }
    }

    if has_tmp_journal {
        return Ok(Some((
            "An interrupted restore journal update was detected".to_string(),
            None,
        )));
    }

    Ok(None)
}

fn is_protected_recovery_folder(root: &Path, folder: &Path) -> bool {
    if let Ok(Some(journal)) = read_journal(root) {
        if let Ok(journal_rollback) = journal.validate(root) {
            if folder == journal_rollback {
                return true;
            }
        }
    }
    if folder.join(".recovery-pending").exists() {
        return true;
    }
    if let Some(name) = folder.file_name().and_then(|n| n.to_str()) {
        if name.contains("before-restore") {
            for db_file in DB_FILES {
                if folder.join(db_file).exists() {
                    return true;
                }
            }
            if folder.join(DOCUMENTS_DIR).exists() {
                return true;
            }
        }
    }
    false
}

/// Remove the oldest automatic backups, keeping the most recent ones.
fn prune(root: &Path) -> Result<(), String> {
    let dir = backup_dir(root)?;
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read the backup directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter(|path| !is_protected_recovery_folder(root, path))
        .collect();

    // Names are timestamp-prefixed, so sorting by name sorts by age.
    entries.sort();
    if entries.len() <= KEEP_BACKUPS {
        return Ok(());
    }

    for old in &entries[..entries.len() - KEEP_BACKUPS] {
        let _ = std::fs::remove_dir_all(old);
    }
    Ok(())
}

/// Back up the database if this is the first run of a new version.
///
/// Called from setup, before the frontend opens the database, so the copy is
/// of the data exactly as the previous version left it — before any migration
/// has had a chance to touch it.
pub fn backup_if_upgraded(app: &AppHandle) -> Result<(), String> {
    backup_if_upgraded_in(&app_root(app)?, &app.package_info().version.to_string())
}

/// The version-change check itself, against a plain directory so it can be tested.
pub(crate) fn backup_if_upgraded_in(root: &Path, current: &str) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;

    let marker = root.join(VERSION_FILE);
    let previous = std::fs::read_to_string(&marker).unwrap_or_default();
    let previous = previous.trim();

    if previous == current {
        return Ok(());
    }

    // Take a copy whenever a database written by some other version is about
    // to be opened — including when the marker file is missing, which is
    // exactly the case where we know least about what wrote it. `copy_database`
    // does nothing on a genuine first run, when there is no database yet.
    if let Err(error) = copy_database(root, &format!("before-{current}")) {
        crate::safety_notices::record_upgrade_failure(root);
        return Err(error);
    }
    crate::safety_notices::clear_upgrade_failure(root);
    prune(root)?;

    std::fs::write(&marker, current)
        .map_err(|e| format!("Could not record the application version: {e}"))?;
    Ok(())
}

/* ------------------------------ commands ------------------------------- */

/// Make a copy right now, on request.
#[tauri::command]
pub async fn create_backup(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || create_consistent_local_backup(&app_root(&app)?))
        .await
        .map_err(|error| format!("Could not finish saving the safety copy: {error}"))?
}

/// Manual safety copies run while the app is open. Use SQLite's online backup
/// API so a concurrent WAL write cannot leave an inconsistent raw file pair.
fn create_consistent_local_backup(root: &Path) -> Result<String, String> {
    let snapshot = database_snapshot_with_retry(root)?;
    let destination = unique_backup_path(&backup_dir(root)?, "manual");
    if let Err(error) = std::fs::create_dir(&destination) {
        let _ = std::fs::remove_file(&snapshot);
        return Err(format!("Could not create the backup folder: {error}"));
    }
    let final_path = destination.join(DB_FILES[0]);
    if let Err(error) = std::fs::rename(&snapshot, &final_path) {
        let _ = std::fs::remove_file(&snapshot);
        let _ = std::fs::remove_dir(&destination);
        return Err(format!("Could not save the database backup: {error}"));
    }
    crate::safety_notices::clear_upgrade_failure(root);
    Ok(destination.to_string_lossy().to_string())
}

/// Export one portable file containing the database and every imported document.
#[tauri::command]
pub async fn create_complete_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<CompleteBackupInfo, String> {
    crate::picked_paths::require_picked(&app, &destination_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Normal,
            |_| {
                create_consistent_complete_backup_with_retry(
                    &root,
                    Path::new(&destination_path),
                    &app.package_info().version.to_string(),
                )
            },
        )
    })
    .await
    .map_err(|error| format!("Could not finish saving the backup: {error}"))?
}

const COMPLETE_BACKUP_RETRIES: u32 = 3;

pub fn create_consistent_complete_backup_with_retry(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let mut last_error = String::new();
    for attempt in 0..=COMPLETE_BACKUP_RETRIES {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(200));
        }

        let pre_snapshot_documents = match scan_active_documents(&root.join(DOCUMENTS_DIR)) {
            Ok(docs) => docs,
            Err(e) => {
                last_error = e;
                continue;
            }
        };

        let snapshot = match database_snapshot_with_retry(root) {
            Ok(s) => s,
            Err(e) => {
                last_error = e;
                continue;
            }
        };

        let result = write_complete_backup_from_database(
            root,
            destination_path,
            app_version,
            &snapshot,
            false,
            true,
            Some(&pre_snapshot_documents),
        );

        let _ = std::fs::remove_file(snapshot);

        match result {
            Ok(info) => return Ok(info),
            Err(BackupExportError::Permanent(err)) => return Err(err),
            Err(BackupExportError::Transient(err)) => {
                last_error = err;
            }
        }
    }

    Err(format!(
        "Could not create a consistent backup: {last_error}"
    ))
}

/// Write the archive itself, against plain directories so it can be tested.
///
/// Skips the finished-archive verification `create_complete_backup` uses in
/// production: several tests deliberately build a damaged or hostile archive
/// through this exact path to prove the *import* side refuses it, and that
/// stops being possible if writing one already refuses to produce it.
#[cfg(test)]
pub(crate) fn write_complete_backup(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    write_complete_backup_from_database(
        root,
        destination_path,
        app_version,
        &root.join(DB_FILES[0]),
        true,
        false,
        None,
    )
    .map_err(|e| e.to_string())
}

fn write_complete_backup_from_database(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
    database: &Path,
    include_wal: bool,
    verify_before_finish: bool,
    pre_snapshot_documents: Option<&HashSet<String>>,
) -> Result<CompleteBackupInfo, BackupExportError> {
    write_complete_backup_from_database_with_hook(
        root,
        destination_path,
        app_version,
        database,
        include_wal,
        verify_before_finish,
        pre_snapshot_documents,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn write_complete_backup_from_database_with_hook(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
    database: &Path,
    include_wal: bool,
    verify_before_finish: bool,
    pre_snapshot_documents: Option<&HashSet<String>>,
    mut on_before_collect_doc: Option<&mut dyn FnMut(&str)>,
) -> Result<CompleteBackupInfo, BackupExportError> {
    if !database.is_file() {
        return Err(BackupExportError::Permanent(
            "There is no database to back up yet.".to_string(),
        ));
    }

    let requested_destination = destination_path.to_path_buf();
    let file_name = requested_destination.file_name().ok_or_else(|| {
        BackupExportError::Permanent("Choose a valid backup file name.".to_string())
    })?;
    let parent = requested_destination.parent().ok_or_else(|| {
        BackupExportError::Permanent("Choose a valid backup location.".to_string())
    })?;
    std::fs::create_dir_all(parent).map_err(|e| {
        BackupExportError::Permanent(format!("Could not create the backup location: {e}"))
    })?;
    let parent = parent.canonicalize().map_err(|e| {
        BackupExportError::Permanent(format!("Could not verify the backup location: {e}"))
    })?;
    let private_root = root.canonicalize().map_err(|e| {
        BackupExportError::Permanent(format!("Could not verify the application data folder: {e}"))
    })?;
    if parent.starts_with(&private_root) {
        return Err(BackupExportError::Permanent(
            "Choose a backup location outside the application's data folder.".to_string(),
        ));
    }
    let destination = parent.join(file_name);

    let temporary = PathBuf::from(format!("{}.part", destination.to_string_lossy()));
    if temporary.exists() {
        std::fs::remove_file(&temporary).map_err(|e| {
            BackupExportError::Permanent(format!("Could not replace an unfinished backup: {e}"))
        })?;
    }

    let result = (|| {
        let initial_disk_documents = scan_active_documents(&root.join(DOCUMENTS_DIR))
            .map_err(BackupExportError::Transient)?;

        let (docs_to_archive, missing_at_export, orphans_at_export, detached_at_export) =
            if verify_before_finish {
                let referenced =
                    query_referenced_documents(database).map_err(BackupExportError::Transient)?;

                let staged_deletions = scan_staged_deletion_paths(
                    &root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR),
                )
                .map_err(BackupExportError::Transient)?;

                let mut missing: Vec<String> = Vec::new();
                for doc in &referenced {
                    if !initial_disk_documents.contains(doc) {
                        if pre_snapshot_documents.is_some_and(|pre| pre.contains(doc)) {
                            return Err(BackupExportError::Transient(format!(
                                "Referenced document disappeared after database snapshot: {doc}"
                            )));
                        }
                        if staged_deletions.contains(doc) {
                            return Err(BackupExportError::Transient(format!(
                                "A document deletion was in progress: {doc}"
                            )));
                        }
                        missing.push(doc.clone());
                    }
                }
                missing.sort();

                let mut orphans: Vec<String> = initial_disk_documents
                    .iter()
                    .filter(|doc| !referenced.contains(*doc))
                    .cloned()
                    .collect();
                orphans.sort();

                let to_archive: HashSet<String> = referenced
                    .into_iter()
                    .filter(|doc| initial_disk_documents.contains(doc))
                    .collect();

                let detached = detached_documents(root, database, &to_archive)
                    .map_err(BackupExportError::Transient)?;

                (Some(to_archive), missing, orphans, detached)
            } else {
                (None, Vec::new(), Vec::new(), Vec::new())
            };

        let output = File::create(&temporary).map_err(|e| {
            BackupExportError::Permanent(format!("Could not create the backup file: {e}"))
        })?;
        let mut archive = ZipWriter::new(output);
        let (schema_version, device_id) = snapshot_schema_and_device(database);
        let manifest = CompleteBackupManifest {
            schema_version,
            device_id,
            platform: Some(std::env::consts::OS.to_string()),
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: app_version.to_string(),
            created_at: unix_timestamp(),
            missing_at_export: missing_at_export.clone(),
            detached_at_export,
        };

        archive
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .map_err(|e| {
                BackupExportError::Permanent(zip_error("Could not write the backup manifest", e))
            })?;
        archive
            .write_all(
                serde_json::to_string_pretty(&manifest)
                    .map_err(|e| {
                        BackupExportError::Permanent(format!(
                            "Could not prepare the backup manifest: {e}"
                        ))
                    })?
                    .as_bytes(),
            )
            .map_err(|e| {
                BackupExportError::Permanent(format!("Could not write the backup manifest: {e}"))
            })?;

        let mut integrity = Vec::new();
        let saved_database = add_file_to_archive(&mut archive, database, DB_FILES[0])
            .map_err(BackupExportError::Transient)?;
        let mut files = 1usize;
        let mut bytes = saved_database.bytes;
        integrity.push(saved_database);
        if bytes > MAX_RESTORE_BYTES {
            return Err(BackupExportError::Permanent(
                "The database is too large to put in one safe backup.".to_string(),
            ));
        }

        // The production path archives an online SQLite snapshot and therefore
        // never needs a WAL. Tests retain this option to prove that legacy v1
        // archives carrying a real WAL still restore correctly.
        let wal = root.join(DB_FILES[1]);
        if include_wal && std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0 {
            let saved_wal = add_file_to_archive(&mut archive, &wal, DB_FILES[1])
                .map_err(BackupExportError::Transient)?;
            bytes = bytes.checked_add(saved_wal.bytes).ok_or_else(|| {
                BackupExportError::Permanent("The backup is too large.".to_string())
            })?;
            files += 1;
            integrity.push(saved_wal);
        }

        if let Some(to_archive) = docs_to_archive {
            let mut pre_meta = HashMap::new();
            for doc in &to_archive {
                let doc_path = root
                    .join(DOCUMENTS_DIR)
                    .join(safe_relative_document_path(doc).map_err(BackupExportError::Permanent)?);
                let meta = std::fs::metadata(&doc_path).map_err(|e| {
                    BackupExportError::Transient(format!("Could not inspect document {doc}: {e}"))
                })?;
                let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                pre_meta.insert(doc.clone(), (meta.len(), mtime));
            }

            let mut sorted_docs: Vec<_> = to_archive.into_iter().collect();
            sorted_docs.sort();

            for doc in sorted_docs {
                if let Some(hook) = on_before_collect_doc.as_mut() {
                    hook(&doc);
                }

                let doc_path = root
                    .join(DOCUMENTS_DIR)
                    .join(safe_relative_document_path(&doc).map_err(BackupExportError::Permanent)?);
                let name = format!("{DOCUMENTS_DIR}/{doc}");
                let saved = add_file_to_archive(&mut archive, &doc_path, &name)
                    .map_err(BackupExportError::Transient)?;

                let meta_after = std::fs::metadata(&doc_path).map_err(|e| {
                    BackupExportError::Transient(format!(
                        "Could not inspect document {doc} after read: {e}"
                    ))
                })?;
                let (pre_len, pre_mtime) = pre_meta[&doc];
                let post_mtime = meta_after
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                if meta_after.len() != pre_len || post_mtime != pre_mtime {
                    return Err(BackupExportError::Transient(format!(
                        "Document changed during export: {doc}"
                    )));
                }

                bytes = bytes.checked_add(saved.bytes).ok_or_else(|| {
                    BackupExportError::Permanent("The backup is too large.".to_string())
                })?;
                files += 1;
                integrity.push(saved);
                if files > MAX_RESTORE_FILES || bytes > MAX_RESTORE_BYTES {
                    return Err(BackupExportError::Permanent(
                        "The documents are too large to put in one safe backup.".to_string(),
                    ));
                }
            }

            let post_disk = scan_active_documents(&root.join(DOCUMENTS_DIR))
                .map_err(BackupExportError::Transient)?;
            if post_disk != initial_disk_documents {
                return Err(BackupExportError::Transient(
                    "Documents changed on disk during export.".to_string(),
                ));
            }
        } else {
            add_documents_to_archive(
                &mut archive,
                &root.join(DOCUMENTS_DIR),
                Path::new(""),
                &mut files,
                &mut bytes,
                &mut integrity,
            )
            .map_err(BackupExportError::Transient)?;
        }

        integrity.sort_by(|left, right| left.path.cmp(&right.path));
        archive
            .start_file(ARCHIVE_INTEGRITY, archive_options())
            .map_err(|e| {
                BackupExportError::Permanent(zip_error("Could not write backup integrity data", e))
            })?;
        archive
            .write_all(
                serde_json::to_string_pretty(&CompleteBackupIntegrity {
                    algorithm: "sha256".to_string(),
                    files: integrity,
                })
                .map_err(|e| {
                    BackupExportError::Permanent(format!(
                        "Could not prepare backup integrity data: {e}"
                    ))
                })?
                .as_bytes(),
            )
            .map_err(|e| {
                BackupExportError::Permanent(format!("Could not write backup integrity data: {e}"))
            })?;

        let output = archive.finish().map_err(|e| {
            BackupExportError::Permanent(zip_error("Could not finish the backup", e))
        })?;
        output.sync_all().map_err(|e| {
            BackupExportError::Permanent(format!("Could not finish writing the backup: {e}"))
        })?;

        // Read the file back and run it through the same validation a
        // restore would — readable ZIP, manifest, integrity inventory,
        // structural limits — before it is ever renamed into place or
        // reported as saved. Writing bytes successfully is not the same
        // guarantee as the result actually being a usable backup.
        let (mut unavailable_pictures, mut unavailable_references) = (0, 0);
        if verify_before_finish {
            let inspected = inspect_archive(root, &temporary, app_version).map_err(|e| {
                BackupExportError::Permanent(format!(
                    "The backup was written but did not pass its own integrity check: {e}"
                ))
            })?;
            unavailable_pictures = inspected.unavailable_pictures;
            unavailable_references = inspected.unavailable_references;
        }

        if destination.exists() {
            if destination.is_dir() {
                return Err(BackupExportError::Permanent(
                    "The selected backup location is a folder.".to_string(),
                ));
            }
            let replaced = PathBuf::from(format!("{}.replaced", destination.to_string_lossy()));
            if replaced.exists() {
                std::fs::remove_file(&replaced).map_err(|e| {
                    BackupExportError::Permanent(format!(
                        "Could not clear an unfinished replacement: {e}"
                    ))
                })?;
            }
            std::fs::rename(&destination, &replaced).map_err(|e| {
                BackupExportError::Permanent(format!("Could not protect the existing backup: {e}"))
            })?;
            if let Err(error) = std::fs::rename(&temporary, &destination) {
                let _ = std::fs::rename(&replaced, &destination);
                return Err(BackupExportError::Permanent(format!(
                    "Could not save the completed backup: {error}"
                )));
            }
            let _ = std::fs::remove_file(replaced);
        } else {
            std::fs::rename(&temporary, &destination).map_err(|e| {
                BackupExportError::Permanent(format!("Could not save the completed backup: {e}"))
            })?;
        }

        Ok(CompleteBackupInfo {
            schema_version: manifest.schema_version,
            device_id: manifest.device_id.clone(),
            platform: manifest.platform.clone(),
            current_schema_version: crate::CURRENT_SCHEMA_VERSION,
            current_app_version: manifest.app_version.clone(),
            app_version: manifest.app_version,
            created_at: manifest.created_at,
            files,
            bytes,
            file_bytes: std::fs::metadata(&destination)
                .map_err(|e| {
                    BackupExportError::Permanent(format!(
                        "Could not read the saved backup’s size: {e}"
                    ))
                })?
                .len(),
            path: destination.to_string_lossy().to_string(),
            missing_documents: missing_at_export,
            unreferenced_documents: orphans_at_export,
            unavailable_pictures,
            unavailable_references,
        })
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn inspect_complete_backup(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::picked_paths::require_picked_or_inside(&app, &root, &source_path)?;
        inspect_archive(
            &root,
            Path::new(&source_path),
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|error| format!("Could not finish reading that backup: {error}"))?
}

/// The version running right now, for the interface to reason about backups.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Clear anything left over and hand back an empty staging directory.
fn fresh_staging(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let staging = root.join(RESTORE_STAGING_DIR);
    let pending = root.join(RESTORE_PENDING_DIR);
    let journal_target = root.join(RESTORE_JOURNAL_FILE);

    // Check existing journal state BEFORE touching staging or pending directories!
    let has_journal = match std::fs::symlink_metadata(&journal_target) {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(format!("Could not inspect restore journal: {e}")),
    };

    if !has_journal {
        // No journal does not mean nothing is wrong: an interrupted journal write or an
        // unrecovered safety copy leaves other evidence. Clearing the pending folder then
        // could destroy the only copy of what a half-finished restore was moving.
        match find_unresolved_recovery_evidence(root) {
            Ok(Some((reason, _))) => {
                return Err(format!(
                    "Cannot stage a restore while an unresolved recovery or restore is active: {reason}"
                ));
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!("Could not check for an unfinished restore: {e}"));
            }
        }
    }

    if has_journal {
        match read_journal(root) {
            Ok(Some(journal)) => {
                if matches!(
                    journal.phase,
                    RestorePhase::Protecting
                        | RestorePhase::Protected
                        | RestorePhase::Activating
                        | RestorePhase::RollingBack
                        | RestorePhase::UnresolvedRecovery
                ) {
                    return Err(
                        "Cannot stage a restore while an unresolved recovery or restore is active"
                            .to_string(),
                    );
                }
                // Terminal state (Committed or RolledBack): must fallibly remove old journal before accepting new staging
                remove_journal(root).map_err(|e| {
                    format!("Cannot stage a new restore because the previous restore journal could not be cleared: {e}")
                })?;
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!(
                    "Cannot stage a restore while an invalid or unreadable restore journal is present: {e}"
                ));
            }
        }
    }

    match inspect_storage_root(&staging, "Restore staging directory") {
        Ok(Some(_)) => {
            std::fs::remove_dir_all(&staging)
                .map_err(|e| format!("Could not clear an unfinished restore: {e}"))?;
        }
        Ok(None) => {}
        Err(e) => return Err(format!("Restore staging directory refused: {e}")),
    }
    match inspect_storage_root(&pending, "Restore pending directory") {
        Ok(Some(_)) => {
            std::fs::remove_dir_all(&pending)
                .map_err(|e| format!("Could not replace an unfinished restore: {e}"))?;
        }
        Ok(None) => {}
        Err(e) => return Err(format!("Restore pending directory refused: {e}")),
    }

    std::fs::create_dir_all(&staging).map_err(|e| format!("Could not prepare the restore: {e}"))?;
    Ok((staging, pending))
}

/// Record what the staged folder is meant to replace, next to the staged files.
fn write_restore_plan(staging: &Path, kind: RestoreKind, source: &str) -> Result<(), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let plan = RestorePlan {
        operation_id: format!("restore-{}-{}", std::process::id(), nonce),
        kind,
        source: source.to_string(),
    };
    std::fs::write(
        staging.join(RESTORE_PLAN),
        serde_json::to_string_pretty(&plan)
            .map_err(|e| format!("Could not prepare the restore: {e}"))?,
    )
    .map_err(|e| format!("Could not prepare the restore: {e}"))
}

/// Read back that record for application kind. An unreadable or absent plan means a complete
/// archive, which is what every earlier version staged.
#[cfg(test)]
fn read_restore_plan(pending: &Path) -> RestorePlan {
    std::fs::read_to_string(pending.join(RESTORE_PLAN))
        .ok()
        .and_then(|json| serde_json::from_str::<RestorePlan>(&json).ok())
        .unwrap_or(RestorePlan {
            operation_id: String::new(),
            kind: RestoreKind::Complete,
            source: String::new(),
        })
}

/// Fallible, no-follow inspection for verifying operation ownership before deletion.
/// Unreadable or corrupted plans strictly do not grant deletion permission.
fn read_restore_plan_for_ownership(pending: &Path) -> Result<Option<RestorePlan>, String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::PlanRead)
        .map_err(|e| format!("Could not inspect restore plan: {e}"))?;

    let target = pending.join(RESTORE_PLAN);
    let meta = match std::fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not inspect restore plan: {e}")),
    };
    if is_symlink_or_reparse(&meta) {
        return Err("Restore plan is an unsafe symlink or reparse point".into());
    }
    if !meta.file_type().is_file() {
        return Err("Restore plan is not a regular file".into());
    }
    let data = std::fs::read_to_string(&target)
        .map_err(|e| format!("Could not read restore plan: {e}"))?;
    let plan: RestorePlan = serde_json::from_str(&data)
        .map_err(|e| format!("Restore plan is invalid or corrupted: {e}"))?;
    Ok(Some(plan))
}

fn verify_pending_contents_against_staged_manifest(
    pending: &Path,
    journal: &RestoreJournal,
) -> Result<bool, String> {
    if journal.staged_db_artifacts.is_empty() && journal.staged_document_artifacts.is_empty() {
        return Ok(false);
    }
    let entries = match std::fs::read_dir(pending) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(true),
        Err(e) => return Err(format!("Could not read pending directory entries: {e}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect pending entry: {e}"))?;
        let meta = entry
            .metadata()
            .map_err(|e| format!("Could not read metadata for pending entry: {e}"))?;
        if is_symlink_or_reparse(&meta) {
            return Err("Pending directory contains unsafe symlink or reparse point".into());
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if meta.is_file() {
            let found = journal.staged_db_artifacts.iter().find(|a| a.name == name);
            if let Some(art) = found {
                let bytes = std::fs::read(entry.path())
                    .map_err(|e| format!("Could not read pending file {name}: {e}"))?;
                let hash = hex::encode(Sha256::digest(&bytes));
                if hash != art.sha256 || bytes.len() as u64 != art.size {
                    return Ok(false);
                }
            } else {
                return Ok(false);
            }
        } else if meta.is_dir() {
            if name == DOCUMENTS_DIR {
                let docs = inventory_directory_artifacts(&entry.path())?;
                for doc in docs {
                    if !journal
                        .staged_document_artifacts
                        .iter()
                        .any(|a| a.name == doc.name && a.sha256 == doc.sha256 && a.size == doc.size)
                    {
                        return Ok(false);
                    }
                }
            } else {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
    }
    Ok(true)
}

const INCOMING_DIR: &str = ".incoming";

pub(crate) fn picked_backup_path(source: &str) -> Result<PathBuf, String> {
    let Some(source) = source.strip_prefix("file://") else {
        return Ok(PathBuf::from(source));
    };
    let mut decoded = Vec::new();
    let mut bytes = source.as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let hi = bytes.next().and_then(|b| (b as char).to_digit(16));
            let lo = bytes.next().and_then(|b| (b as char).to_digit(16));
            match (hi, lo) {
                (Some(hi), Some(lo)) => decoded.push((hi * 16 + lo) as u8),
                _ => return Err("That backup path could not be read.".into()),
            }
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded)
        .map(PathBuf::from)
        .map_err(|_| "That backup path could not be read.".into())
}

pub(crate) fn copy_incoming_backup(root: &Path, source: &str) -> Result<PathBuf, String> {
    let source = picked_backup_path(source)?;
    let metadata = std::fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() || is_symlink_or_reparse(&metadata) {
        return Err("Choose a regular backup file.".into());
    }
    if metadata.len() > MAX_RESTORE_BYTES {
        return Err("That backup is too large to restore.".into());
    }
    let dir = root.join(INCOMING_DIR);
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.is_dir() || is_symlink_or_reparse(&meta) => {
            return Err("The incoming backup folder is unavailable.".into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
        }
        Err(e) => return Err(e.to_string()),
    }
    let temporary = dir.join("latest.hfdbackup.tmp");
    let destination = dir.join("latest.hfdbackup");
    match std::fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let input = File::open(source).map_err(|e| e.to_string())?;
        if std::io::copy(&mut input.take(MAX_RESTORE_BYTES + 1), &mut output)
            .map_err(|e| e.to_string())?
            > MAX_RESTORE_BYTES
        {
            return Err("That backup is too large to restore.".into());
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        #[cfg(windows)]
        if destination.exists() {
            std::fs::remove_file(&destination).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        Ok(destination)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub(crate) fn required_restore_bytes(bytes: u64) -> u64 {
    bytes.saturating_mul(3)
}

#[cfg(unix)]
pub(crate) fn free_space_bytes(path: &Path) -> Result<Option<u64>, String> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: path is NUL-terminated and stats points to writable storage.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return Err(format!(
            "Could not check free space: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: statvfs returned success and initialized stats.
    let stats = unsafe { stats.assume_init() };
    // libc field widths differ between Unix targets.
    #[allow(clippy::unnecessary_cast)]
    let available = (stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64);
    Ok(Some(available))
}

#[cfg(not(unix))]
pub(crate) fn free_space_bytes(_path: &Path) -> Result<Option<u64>, String> {
    Ok(None)
}

fn restore_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn import_picked_backup_in(
    root: &Path,
    source: &str,
    version: &str,
    available: fn(&Path) -> Result<Option<u64>, String>,
) -> Result<CompleteBackupInfo, String> {
    let copy = copy_incoming_backup(root, source)?;
    let result = (|| {
        let need =
            required_restore_bytes(std::fs::metadata(&copy).map_err(|e| e.to_string())?.len());
        if let Some(have) = available(root)? {
            if have < need {
                return Err(format!("This phone needs about {} free to restore this backup, but only {} is free. Free up some space and try again.", restore_size(need), restore_size(have)));
            }
        }
        inspect_archive(root, &copy, version)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(copy);
    }
    result
}

#[tauri::command]
pub async fn import_picked_backup(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    let root = app_root(&app)?;
    crate::picked_paths::require_picked(&app, &source_path)?;
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        import_picked_backup_in(&root, &source_path, &version, free_space_bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn discard_incoming_backup(app: AppHandle) -> Result<(), String> {
    let dir = app_root(&app)?.join(INCOMING_DIR);
    if inspect_storage_root(&dir, "Incoming backup folder")?.is_some() {
        for name in ["latest.hfdbackup", "latest.hfdbackup.tmp"] {
            match std::fs::remove_file(dir.join(name)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn exit_for_restore(app: AppHandle) -> Result<(), String> {
    // iOS cannot exit tao's event loop; the user closes the app after staging.
    #[cfg(not(target_os = "ios"))]
    app.exit(0);
    #[cfg(target_os = "ios")]
    let _ = app;
    Ok(())
}

fn reset_sync_identity_best_effort(root: &Path) {
    // Non-critical: the restore already succeeded; a failure only keeps the old id.
    if let Err(e) = reset_sync_identity(root) {
        log::warn!("Restore: could not reset the sync identity: {e}");
    }
}

/// Everything now on the phone came from the Mac, so note that moment. A failure
/// here must never make a restore that succeeded report failure.
fn record_phone_baseline_best_effort(root: &Path) {
    let now = crate::phone_work::now_utc();
    if let Err(e) = now.and_then(|now| crate::phone_work::record_baseline_in(root, &now)) {
        log::warn!("Restore: could not record the phone baseline: {e}");
    }
}

pub(crate) fn reset_sync_identity(root: &Path) -> Result<(), String> {
    let mut connection =
        Connection::open_with_flags(root.join(DB_FILES[0]), OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| e.to_string())?;
    // One transaction: a failed save can never leave the restored phone with
    // the Mac's id, and the copy's source is stored before the id is dropped.
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    // The restored copy's own id is the Mac it came from: later changes files
    // are accepted only from that Mac.
    match tx.query_row(
        "SELECT CAST(value AS TEXT) FROM app_metadata WHERE key = 'device_id'",
        [],
        |r| r.get::<_, Option<String>>(0),
    ) {
        Ok(Some(id)) if crate::sync::changeset::valid_device_id(&id) => {
            tx.execute(
                "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_copy_from_device', ?1)",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => {
            tx.execute(
                "DELETE FROM app_metadata WHERE key = 'sync_copy_from_device'",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Err(e) if e.to_string().contains("no such table: app_metadata") => return Ok(()),
        Err(e) => return Err(e.to_string()),
    }
    tx.execute("DELETE FROM app_metadata WHERE key = 'device_id'", [])
        .map_err(|e| e.to_string())?;
    // Whatever the change log holds now came with the restored copy, not from
    // this device: later exports start after it.
    let floor: i64 =
        match tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM local_changes", [], |r| {
            r.get(0)
        }) {
            Ok(n) => n,
            Err(e) if e.to_string().contains("no such table: local_changes") => 0,
            Err(e) => return Err(e.to_string()),
        };
    tx.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_floor_seq', ?1)",
        [floor.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM app_metadata WHERE key = 'exported_through_seq'",
        [],
    )
    .map_err(|e| e.to_string())?;
    // The restore sets a new copy source and baseline: the restart keys are stale.
    tx.execute(
        "DELETE FROM app_metadata WHERE key IN ('sync_stream_restarted', 'sync_copy_superseded')",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn remove_pending_directory_safely(pending: &Path) -> Result<(), std::io::Error> {
    // Fallible no-follow inspection of the pending directory itself.
    let root_meta = match std::fs::symlink_metadata(pending) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if is_symlink_or_reparse(&root_meta) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Pending directory is an unsafe symlink or reparse point",
        ));
    }
    if !root_meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Pending path is not a directory",
        ));
    }

    // Safe deletion ordering: delete non-plan payload files and subdirectories first.
    // Retain RESTORE_PLAN on disk until all payload files are removed.
    // If an error or OS listing/entry denial occurs, RESTORE_PLAN survives
    // to provide durable proof of ownership for future cleanup attempts.
    let entries = std::fs::read_dir(pending)?;
    for entry in entries {
        #[cfg(test)]
        check_injected_fault(InjectedFault::PendingEntryRead)?;

        let entry = entry?;
        let file_name = entry.file_name();
        if file_name == RESTORE_PLAN {
            continue;
        }
        let path = entry.path();
        let entry_meta = std::fs::symlink_metadata(&path)?;
        if is_symlink_or_reparse(&entry_meta) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "Pending payload entry {:?} is an unsafe symlink or reparse point",
                    file_name
                ),
            ));
        }
        if entry_meta.is_dir() {
            std::fs::remove_dir_all(&path)?;
        } else {
            std::fs::remove_file(&path)?;
        }
    }

    // Remove RESTORE_PLAN only after every non-plan payload file has been successfully deleted.
    let plan_path = pending.join(RESTORE_PLAN);
    match std::fs::symlink_metadata(&plan_path) {
        Ok(plan_meta) => {
            if is_symlink_or_reparse(&plan_meta) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "Restore plan is an unsafe symlink or reparse point",
                ));
            }
            std::fs::remove_file(&plan_path)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }

    std::fs::remove_dir(pending)
}

fn verify_pending_cleanup_permission(
    pending: &Path,
    journal: &RestoreJournal,
) -> Result<bool, String> {
    if inspect_storage_root(pending, "Pending directory")?.is_none() {
        return Ok(true);
    }

    match read_restore_plan_for_ownership(pending)? {
        Some(plan) => {
            if !journal.operation_id.is_empty() && !plan.operation_id.is_empty() {
                if journal.operation_id == plan.operation_id {
                    Ok(true)
                } else {
                    Ok(false)
                }
            } else if journal.operation_id.is_empty() && plan.operation_id.is_empty() {
                // Genuine legacy state: neither modern journal nor plan has an operation ID.
                Ok(true)
            } else {
                // One has an ID, the other is empty or unverified.
                Ok(false)
            }
        }
        None => {
            if journal.operation_id.is_empty() {
                // Genuine legacy state: legacy journal without operation ID.
                // An absent plan means complete/legacy restore.
                Ok(true)
            } else {
                // Modern terminal journal with nonempty operation_id:
                // Check if remaining files in pending are proven leftovers of this operation
                // by verifying against the recorded staged content manifest.
                if verify_pending_contents_against_staged_manifest(pending, journal)? {
                    Ok(true)
                } else {
                    // Modern terminal journal cannot establish deletion ownership over a pending
                    // directory lacking an ownership plan and containing unknown or mismatched files.
                    Ok(false)
                }
            }
        }
    }
}

/// Validate and extract into a private staging directory. Current data is untouched.
#[tauri::command]
pub async fn stage_complete_restore(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::picked_paths::require_picked_or_inside(&app, &root, &source_path)?;
        // An interrupted study pack is quarantined first, so a restore can
        // never stage next to a half-installed one (design section 1).
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Restore,
            |_| {
                stage_complete_restore_guarded_in(
                    &root,
                    Path::new(&source_path),
                    &app.package_info().version.to_string(),
                    cfg!(target_os = "ios"),
                )
            },
        )
    })
    .await
    .map_err(|error| format!("Could not finish restoring that backup: {error}"))?
}

/// Refuse on a phone that holds unsaved phone-made work, before anything is extracted.
pub(crate) fn stage_complete_restore_guarded_in(
    root: &Path,
    source: &Path,
    current_app_version: &str,
    phone: bool,
) -> Result<CompleteBackupInfo, String> {
    if phone {
        // A full copy from a Mac other than the copy's own restarts the
        // phone's stream first, so the check below counts its work. A copy
        // whose manifest can't be read is refused by the staging step.
        if let Ok(incoming) = archive_device_id(source) {
            // No library yet means no work to lose; one that can't be
            // opened is refused (fail closed).
            if root.join(DB_FILES[0]).is_file() {
                let restart = crate::sync::progress::open_app_db(root).and_then(|conn| {
                    crate::sync::send::restart_if_other_mac(root, &conn, incoming.as_deref())
                });
                if restart.is_err() {
                    // Fail closed: never stage after a failed restart.
                    return Err(crate::phone_work::UNSAVED_REFUSAL.to_string());
                }
            }
        }
    }
    crate::phone_work::refuse_unsaved(root, phone)?;
    stage_complete_restore_in(root, source, current_app_version)
}

/// Unpack and check an archive into staging, against a plain directory.
pub(crate) fn stage_complete_restore_in(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let info = inspect_archive(root, source, current_app_version)?;
    let (staging, pending) = fresh_staging(root)?;

    let result = (|| {
        let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|e| zip_error("Could not read that backup", e))?;
        let mut expected_integrity = if archive.by_name(ARCHIVE_INTEGRITY).is_ok() {
            let mut entry = archive
                .by_name(ARCHIVE_INTEGRITY)
                .map_err(|e| zip_error("Could not read backup integrity information", e))?;
            let mut json = String::new();
            entry
                .read_to_string(&mut json)
                .map_err(|e| format!("Could not read backup integrity information: {e}"))?;
            let integrity: CompleteBackupIntegrity = serde_json::from_str(&json)
                .map_err(|e| format!("The backup integrity information is invalid: {e}"))?;
            Some(
                integrity
                    .files
                    .into_iter()
                    .map(|item| (item.path.clone(), item))
                    .collect::<HashMap<_, _>>(),
            )
        } else {
            None
        };
        let mut extracted_files = 0usize;
        let mut extracted_bytes = 0u64;
        let mut extracted_names = HashSet::new();

        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|e| zip_error("Could not read a file from the backup", e))?;
            let raw_name = entry
                .name()
                .map_err(|e| zip_error("Could not read a backup file name", e))?
                .into_owned();
            let path = entry
                .enclosed_name()
                .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
            validate_archive_path(&raw_name, &path)?;
            validate_compression_ratio(
                entry.size(),
                entry.compressed_size(),
                MAX_COMPRESSION_RATIO,
            )?;
            if !allowed_archive_path(&path, entry.is_dir()) {
                return Err(format!(
                    "The backup contains an unexpected file: {raw_name}"
                ));
            }
            if !extracted_names.insert(path.clone()) {
                return Err(format!("The backup contains a duplicate file: {raw_name}"));
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Linked files are not allowed in a backup.".to_string());
            }
            if path == Path::new(ARCHIVE_MANIFEST) || path == Path::new(ARCHIVE_INTEGRITY) {
                continue;
            }
            let destination = staging.join(&path);
            if entry.is_dir() {
                std::fs::create_dir_all(&destination)
                    .map_err(|e| format!("Could not create a restored folder: {e}"))?;
                continue;
            }
            extracted_files += 1;
            if extracted_files > MAX_RESTORE_FILES {
                return Err("That backup contains too many files.".to_string());
            }
            let expected_size = entry.size();
            extracted_bytes = extracted_bytes
                .checked_add(expected_size)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            if extracted_bytes > MAX_RESTORE_BYTES {
                return Err("That backup is larger than this app can safely restore.".to_string());
            }
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create a restored folder: {e}"))?;
            }
            let mut output = File::create(&destination)
                .map_err(|e| format!("Could not create a restored file: {e}"))?;
            let (restored_bytes, restored_sha256) = copy_and_hash(
                &mut entry.take(expected_size.saturating_add(1)),
                &mut output,
            )?;
            if restored_bytes != expected_size {
                return Err("A file in that backup has an invalid size.".to_string());
            }
            output
                .sync_all()
                .map_err(|e| format!("Could not finish a restored file: {e}"))?;

            if let Some(expected) = expected_integrity.as_mut() {
                let normalized = path.to_string_lossy().replace('\\', "/");
                let expected = expected
                    .remove(&normalized)
                    .ok_or_else(|| format!("The backup has no integrity record for {raw_name}"))?;
                if restored_bytes != expected.bytes
                    || !restored_sha256.eq_ignore_ascii_case(&expected.sha256)
                {
                    return Err(format!(
                        "The backup failed its integrity check for {raw_name}"
                    ));
                }
            }
        }

        if expected_integrity
            .as_ref()
            .is_some_and(|expected| !expected.is_empty())
        {
            return Err(
                "The backup integrity list contains files that are not in the archive.".to_string(),
            );
        }

        if !staging.join(DB_FILES[0]).is_file() {
            return Err("That backup does not contain a usable database.".to_string());
        }
        // Check the extracted file itself, not just what the archive claimed.
        verify_application_database(&staging.join(DB_FILES[0]))?;
        write_restore_plan(&staging, RestoreKind::Complete, &source.to_string_lossy())?;
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result.map(|()| info)
}

/// Stage a complete restore of an empty app so the next startup starts fresh.
#[tauri::command]
pub async fn stage_start_fresh(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Restore,
            |_| stage_start_fresh_in(&root),
        )
    })
    .await
    .map_err(|error| format!("Could not finish preparing to start fresh: {error}"))?
}

/// Stage an empty SQLite database with a Complete restore plan, against a plain directory.
pub(crate) fn stage_start_fresh_in(root: &Path) -> Result<(), String> {
    let (staging, pending) = fresh_staging(root)?;

    let result = (|| {
        let db_path = staging.join(DB_FILES[0]);
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Could not create empty database: {e}"))?;
        conn.execute_batch("VACUUM;")
            .map_err(|e| format!("Could not initialize empty database: {e}"))?;
        drop(conn);
        verify_sqlite_file(&db_path)?;
        write_restore_plan(&staging, RestoreKind::Complete, "start-fresh")?;
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok::<(), String>(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

/// Remove everything stored inside `backups/` after a committed start-fresh install.
///
/// Safety copies are kept inside application data, so their removal stays strictly
/// inside `backups/` without following symlinks.
fn delete_backups_contents(root: &Path) -> Result<(), String> {
    let backups_dir = root.join(BACKUP_DIR);
    match inspect_storage_root(&backups_dir, "Backups directory")? {
        Some(_) => {}
        None => return Ok(()),
    }

    let entries = std::fs::read_dir(&backups_dir)
        .map_err(|e| format!("Could not read backups directory for start-fresh cleanup: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect backup entry: {e}"))?;
        let path = entry.path();
        if !path.starts_with(&backups_dir) {
            return Err("Backup path climbs outside backups directory".into());
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|e| {
            format!(
                "Could not read metadata for backup entry {:?}: {e}",
                entry.file_name()
            )
        })?;
        if is_symlink_or_reparse(&meta) {
            return Err(format!(
                "Backup entry {:?} is an unsafe symlink or reparse point",
                entry.file_name()
            ));
        }
        if meta.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Could not remove backup folder {:?}: {e}",
                    entry.file_name()
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!("Could not remove backup file {:?}: {e}", entry.file_name())
            })?;
        }
    }
    Ok(())
}

/// Remove everything stored inside `.incoming/` after a committed start-fresh install.
fn delete_incoming_contents(root: &Path) -> Result<(), String> {
    let incoming_dir = root.join(INCOMING_DIR);
    match inspect_storage_root(&incoming_dir, "Incoming directory")? {
        Some(_) => {}
        None => return Ok(()),
    }

    let entries = std::fs::read_dir(&incoming_dir)
        .map_err(|e| format!("Could not read incoming directory for start-fresh cleanup: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect incoming entry: {e}"))?;
        let path = entry.path();
        if !path.starts_with(&incoming_dir) {
            return Err("Incoming path climbs outside incoming directory".into());
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|e| {
            format!(
                "Could not read metadata for incoming entry {:?}: {e}",
                entry.file_name()
            )
        })?;
        if is_symlink_or_reparse(&meta) {
            return Err(format!(
                "Incoming entry {:?} is an unsafe symlink or reparse point",
                entry.file_name()
            ));
        }
        if meta.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Could not remove incoming folder {:?}: {e}",
                    entry.file_name()
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!(
                    "Could not remove incoming file {:?}: {e}",
                    entry.file_name()
                )
            })?;
        }
    }
    Ok(())
}

/// Remove the phone outbox folder and all its contents after a committed start-fresh install.
fn delete_phone_outbox(root: &Path) -> Result<(), String> {
    let outbox_dir = root.join(crate::sync::send::OUTBOX_DIR);
    match inspect_storage_root(&outbox_dir, "Phone outbox directory")? {
        Some(_) => {}
        None => return Ok(()),
    }

    let entries = std::fs::read_dir(&outbox_dir)
        .map_err(|e| format!("Could not read outbox directory for start-fresh cleanup: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect outbox entry: {e}"))?;
        let path = entry.path();
        if !path.starts_with(&outbox_dir) {
            return Err("Outbox path climbs outside outbox directory".into());
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|e| {
            format!(
                "Could not read metadata for outbox entry {:?}: {e}",
                entry.file_name()
            )
        })?;
        if is_symlink_or_reparse(&meta) {
            return Err(format!(
                "Outbox entry {:?} is an unsafe symlink or reparse point",
                entry.file_name()
            ));
        }
        if meta.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Could not remove outbox folder {:?}: {e}",
                    entry.file_name()
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!("Could not remove outbox file {:?}: {e}", entry.file_name())
            })?;
        }
    }
    std::fs::remove_dir(&outbox_dir)
        .map_err(|e| format!("Could not remove phone outbox directory: {e}"))?;
    Ok(())
}

/// Remove the phone baseline file (`phone-work.json`) after a committed start-fresh install.
fn delete_phone_work_file(root: &Path) -> Result<(), String> {
    let path = root.join(crate::phone_work::PHONE_WORK_FILE);
    if !path.starts_with(root) {
        return Err("Phone work file path climbs outside root".into());
    }
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Could not inspect phone work file: {e}")),
    };
    if is_symlink_or_reparse(&meta) {
        return Err("Phone work file is an unsafe symlink or reparse point".into());
    }
    if meta.is_dir() {
        return Err("Phone work file path is unexpectedly a directory".into());
    }
    std::fs::remove_file(&path).map_err(|e| format!("Could not remove phone work file: {e}"))
}

/// Remove leftover state from a previous library after a committed start-fresh install:
/// safety copies in `backups/`, `.incoming/` contents, the phone `outbox/` folder,
/// and `phone-work.json`.
///
/// Refuses symlinks/reparse points, stays within application root, and logs warnings
/// without failing the restore.
fn delete_start_fresh_leftovers(root: &Path) {
    if let Err(e) = delete_backups_contents(root) {
        log::warn!("Could not clean up backups after start fresh: {e}");
    }
    if let Err(e) = delete_incoming_contents(root) {
        log::warn!("Could not clean up incoming directory after start fresh: {e}");
    }
    if let Err(e) = delete_phone_outbox(root) {
        log::warn!("Could not clean up phone outbox after start fresh: {e}");
    }
    if let Err(e) = delete_phone_work_file(root) {
        log::warn!("Could not clean up phone work file after start fresh: {e}");
    }
}

/// Stage one of the automatic safety copies for installation on next launch.
///
/// These copies hold the database only, so uploaded documents are deliberately
/// left exactly where they are: the copy is the database as it stood before an
/// update, and her files never went anywhere.
#[tauri::command]
pub async fn stage_local_restore(app: AppHandle, name: String) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Restore,
            |_| stage_local_restore_in(&root, &name),
        )
    })
    .await
    .map_err(|error| format!("Could not finish restoring that safety copy: {error}"))?
}

/// Stage a named safety copy, against a plain directory.
fn stage_local_restore_in(root: &Path, name: &str) -> Result<BackupInfo, String> {
    let name = safe_backup_name(name)?;
    let folder = backup_dir(root)?.join(name);
    // A safety copy is a real folder this app made; a link planted in its
    // place could point anywhere on disk.
    if std::fs::symlink_metadata(&folder).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("That is not a safety copy this app made.".to_string());
    }
    if !folder.is_dir() {
        return Err("That safety copy is no longer there.".to_string());
    }
    let database = folder.join(DB_FILES[0]);
    verify_sqlite_file(&database)?;
    crate::sqlite_guard::check_wal_pair(&database)?;

    let (staging, pending) = fresh_staging(root)?;

    let result = (|| {
        std::fs::copy(&database, staging.join(DB_FILES[0]))
            .map_err(|e| format!("Could not prepare that safety copy: {e}"))?;
        // Its write-ahead log belongs with it; anything it still holds is hers.
        let wal = folder.join(DB_FILES[1]);
        if wal.is_file() {
            std::fs::copy(&wal, staging.join(DB_FILES[1]))
                .map_err(|e| format!("Could not prepare that safety copy: {e}"))?;
        }
        verify_sqlite_file(&staging.join(DB_FILES[0]))?;
        write_restore_plan(&staging, RestoreKind::Database, name)?;
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok::<(), String>(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result?;

    Ok(describe_backup_folder(&folder))
}

/// Restart so the staged database can be installed before SQLite opens again.
#[tauri::command]
pub fn restart_for_restore(app: AppHandle) -> Result<(), String> {
    // Tauri's own restart starts the new copy while this one still holds the
    // single-instance lock, so the new copy hands over to us and quits, and we
    // then exit: the app never reopens. Instead a helper waits for this process
    // to be gone, then opens the app again.
    #[cfg(target_os = "macos")]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundle) = mac_bundle_of(&exe) {
            let script = mac_relaunch_script(std::process::id(), &bundle);
            if std::process::Command::new("/bin/sh")
                .arg("-c")
                .arg(script)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .is_ok()
            {
                app.exit(0);
                return Ok(());
            }
        }
    }
    app.request_restart();
    Ok(())
}

/// The `.app` folder that holds this executable, or None when it isn't run from one.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn mac_bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let bundle = contents.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// Wait until `pid` has exited, then open the app bundle again.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn mac_relaunch_script(pid: u32, bundle: &Path) -> String {
    let quoted = bundle.to_string_lossy().replace('\'', "'\\''");
    format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 0.2; done; sleep 0.3; /usr/bin/open -n '{quoted}'"
    )
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StartupRestoreDecision {
    /// No restore was pending. Normal startup continues.
    ProceedNormally,
    /// A restore was committed (either just now or prior cleanup finished). Normal startup continues.
    RestoreCompleted,
    /// A staged restore was rejected before any active data was moved. Active data is verified unchanged.
    #[allow(dead_code)]
    StagingRefusedUnchanged { reason: String },
    /// A restore failed during install, but active data was verified fully recovered. Normal startup continues.
    RolledBackRecovered { reason: String },
    /// Active data is in an unresolved/ambiguous state or rollback is obstructed.
    /// Normal startup MUST be blocked to prevent creating an empty database or mutating data.
    BlockedUnresolved {
        reason: String,
        recovery_folder: Option<PathBuf>,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RestoreApplicationResult {
    NoPending,
    Installed,
    RefusedUnchanged(String),
    Recovered(String),
    Unresolved {
        reason: String,
        recovery_folder: PathBuf,
    },
}

fn execute_rollback(root: &Path, journal: &mut RestoreJournal) -> Result<(), String> {
    let rollback = root.join(&journal.rollback_rel_path);
    if rollback.exists() {
        let rollback_meta = std::fs::symlink_metadata(&rollback)
            .map_err(|e| format!("Could not inspect recovery directory: {e}"))?;
        if is_symlink_or_reparse(&rollback_meta) {
            return Err("Recovery directory is an unsafe symlink or reparse point".into());
        }
        if !rollback_meta.is_dir() {
            return Err("Recovery directory is not a directory".into());
        }
    } else if !journal.protected_db_files.is_empty() || journal.protected_documents {
        return Err(format!(
            "Recovery directory {} is missing but journal records protected files",
            rollback.display()
        ));
    }

    if matches!(
        journal.phase,
        RestorePhase::Protecting | RestorePhase::Protected | RestorePhase::Activating
    ) {
        journal.phase = RestorePhase::RollingBack;
        write_journal(root, journal)?;
    }

    let mut errors = Vec::new();

    // Step 1: Uninstall staged files from active root
    let mut uninstalled_db_files = Vec::new();
    for name in &journal.installed_db_files.clone() {
        let active_path = root.join(name);
        match std::fs::symlink_metadata(&active_path) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(format!(
                        "Active DB path {name} is an unsafe symlink or reparse point"
                    ));
                    continue;
                }
                if !meta.is_file() {
                    errors.push(format!("Active DB path {name} is not a regular file"));
                    continue;
                }
                match std::fs::read(&active_path) {
                    Ok(bytes) => {
                        let hash = hex::encode(Sha256::digest(&bytes));
                        let is_staged = journal
                            .staged_db_artifacts
                            .iter()
                            .any(|s| s.name == *name && s.sha256 == hash);
                        let is_orig = journal
                            .original_db_artifacts
                            .iter()
                            .any(|o| o.name == *name && o.sha256 == hash);
                        if is_staged {
                            if rollback.join(name).exists() || !is_orig {
                                if let Err(e) = std::fs::remove_file(&active_path) {
                                    errors.push(format!("Could not remove installed {name}: {e}"));
                                } else {
                                    uninstalled_db_files.push(name.clone());
                                }
                            }
                        } else if is_orig && !rollback.join(name).exists() {
                            // Already returned original DB file; leave it in place
                        } else {
                            errors.push(format!(
                                "Active destination {name} contains an unidentified file that cannot be deleted or overwritten"
                            ));
                        }
                    }
                    Err(e) => {
                        errors.push(format!(
                            "Could not read active DB file {name} for classification: {e}"
                        ));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                uninstalled_db_files.push(name.clone());
            }
            Err(e) => {
                errors.push(format!("Could not inspect active DB file {name}: {e}"));
            }
        }
    }
    journal
        .installed_db_files
        .retain(|n| !uninstalled_db_files.contains(n));

    // Safe SHM cache cleanup: Active .db-shm is ephemeral and must be cleared
    let shm_path = root.join(DB_FILES[2]);
    if let Ok(meta) = std::fs::symlink_metadata(&shm_path) {
        if is_symlink_or_reparse(&meta) {
            errors.push(
                "Active shared memory cache (.db-shm) is an unsafe symlink or reparse point".into(),
            );
        } else if let Err(e) = std::fs::remove_file(&shm_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                errors.push(format!(
                    "Could not clear active shared memory cache (.db-shm): {e}"
                ));
            }
        }
    }

    // Clean up staged documents if installed or present
    if journal.installed_documents {
        let docs = root.join(DOCUMENTS_DIR);
        match std::fs::symlink_metadata(&docs) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(
                        "Active documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else if !meta.is_dir() {
                    errors.push("Active documents path is not a directory".into());
                } else {
                    match inventory_directory_artifacts(&docs) {
                        Ok(active_doc_artifacts) => {
                            let rollback_docs_exist = rollback.join(DOCUMENTS_DIR).exists();
                            if rollback_docs_exist {
                                // Original documents are safely in rollback
                                let mut all_staged = true;
                                for art in &active_doc_artifacts {
                                    let is_staged = journal
                                        .staged_document_artifacts
                                        .iter()
                                        .any(|s| s.name == art.name && s.sha256 == art.sha256);
                                    if !is_staged {
                                        all_staged = false;
                                        break;
                                    }
                                }
                                if all_staged {
                                    if let Err(e) = std::fs::remove_dir_all(&docs) {
                                        errors.push(format!(
                                            "Could not remove installed documents: {e}"
                                        ));
                                    } else {
                                        journal.installed_documents = false;
                                    }
                                } else {
                                    errors.push("Active destination documents contains an unidentified document that cannot be deleted or overwritten".into());
                                }
                            } else if journal.original_document_artifacts.is_empty()
                                && !journal.protected_documents
                            {
                                // Original profile had NO documents
                                let mut all_staged = true;
                                for art in &active_doc_artifacts {
                                    let is_staged = journal
                                        .staged_document_artifacts
                                        .iter()
                                        .any(|s| s.name == art.name && s.sha256 == art.sha256);
                                    if !is_staged {
                                        all_staged = false;
                                        break;
                                    }
                                }
                                if all_staged {
                                    if let Err(e) = std::fs::remove_dir_all(&docs) {
                                        errors.push(format!(
                                            "Could not remove installed documents: {e}"
                                        ));
                                    } else {
                                        journal.installed_documents = false;
                                    }
                                } else {
                                    errors.push("Active destination documents contains an unidentified document that cannot be deleted or overwritten".into());
                                }
                            } else {
                                // Rollback documents do NOT exist, but original DID have documents.
                                // Check if active documents are ALREADY the returned originals!
                                let mut matches_originals = active_doc_artifacts.len()
                                    == journal.original_document_artifacts.len();
                                if matches_originals {
                                    for orig in &journal.original_document_artifacts {
                                        if !active_doc_artifacts.iter().any(|a| {
                                            a.name == orig.name
                                                && a.sha256 == orig.sha256
                                                && a.size == orig.size
                                        }) {
                                            matches_originals = false;
                                            break;
                                        }
                                    }
                                }
                                if matches_originals {
                                    // Already returned and verified original documents!
                                    journal.installed_documents = false;
                                    journal.protected_documents = false;
                                } else {
                                    errors.push("Active documents directory does not match expected original documents and rollback copy is missing".into());
                                }
                            }
                        }
                        Err(e) => {
                            errors.push(format!("Could not inspect active documents: {e}"));
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                journal.installed_documents = false;
            }
            Err(e) => {
                errors.push(format!("Could not inspect active documents directory: {e}"));
            }
        }
    }
    write_journal(root, journal)?;

    if !errors.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        return Err(errors.join("; "));
    }

    // Step 2: Pre-flight check before returning protected files
    for name in DB_FILES {
        let src = rollback.join(name);
        let dest = root.join(name);
        if src.exists() && dest.exists() {
            errors.push(format!(
                "Cannot return protected {name}: destination in active directory is obstructed"
            ));
        }
    }
    let src_docs = rollback.join(DOCUMENTS_DIR);
    let dest_docs = root.join(DOCUMENTS_DIR);
    if src_docs.exists() && dest_docs.exists() {
        errors.push(format!(
            "Cannot return protected documents: destination {DOCUMENTS_DIR} in active directory is obstructed"
        ));
    }

    if !errors.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        return Err(errors.join("; "));
    }

    // Step 3: Return protected files from rollback to root
    let originally_had_db = journal
        .protected_db_files
        .contains(&DB_FILES[0].to_string())
        || journal
            .original_db_artifacts
            .iter()
            .any(|a| a.name == DB_FILES[0])
        || rollback.join(DB_FILES[0]).exists();
    let originally_had_docs = journal.protected_documents
        || !journal.original_document_artifacts.is_empty()
        || rollback.join(DOCUMENTS_DIR).exists();

    let mut returned_db_files = Vec::new();
    #[allow(clippy::unused_enumerate_index)]
    for (_idx, name) in DB_FILES.iter().enumerate() {
        #[cfg(test)]
        let idx = _idx;
        let src = rollback.join(name);
        let dest = root.join(name);
        if !src.exists() {
            if dest.exists() {
                returned_db_files.push(name.to_string());
            } else if *name == DB_FILES[2] {
                // SHM is ephemeral SQLite cache: if not in rollback and not in active directory,
                // it will be regenerated by SQLite once durable DB and WAL are restored.
                returned_db_files.push(name.to_string());
            }
            continue;
        }

        if dest.exists() {
            errors.push(format!(
                "Cannot return protected {name}: destination in active directory is obstructed"
            ));
            continue;
        }

        #[cfg(test)]
        if let Err(e) = check_injected_fault(InjectedFault::ReturnDbRename(idx)) {
            errors.push(format!("Could not return protected {name}: {e}"));
            continue;
        }

        match std::fs::rename(&src, &dest) {
            Ok(()) => {
                returned_db_files.push(name.to_string());
            }
            Err(e) => {
                errors.push(format!(
                    "Could not return protected {name} to active directory: {e}"
                ));
            }
        }
    }
    journal
        .protected_db_files
        .retain(|name| !returned_db_files.contains(name));

    if src_docs.exists() {
        if dest_docs.exists() {
            errors.push(format!(
                "Cannot return protected documents: destination {DOCUMENTS_DIR} in active directory is obstructed"
            ));
        } else {
            #[cfg(test)]
            let inspection = check_injected_fault(InjectedFault::ReturnDocsMetadata)
                .and_then(|()| std::fs::symlink_metadata(&src_docs));
            #[cfg(not(test))]
            let inspection = std::fs::symlink_metadata(&src_docs);
            let src_meta = match inspection {
                Ok(m) => Some(m),
                Err(e) => {
                    errors.push(format!(
                        "Could not inspect recovery documents directory: {e}"
                    ));
                    None
                }
            };
            if let Some(src_meta) = src_meta {
                if is_symlink_or_reparse(&src_meta) {
                    errors.push(
                        "Recovery documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else {
                    #[cfg(test)]
                    let fault_res = check_injected_fault(InjectedFault::ReturnDocsRename);
                    #[cfg(not(test))]
                    let fault_res = Ok::<(), std::io::Error>(());

                    if let Err(e) = fault_res {
                        errors.push(format!("Could not return protected documents: {e}"));
                    } else {
                        match std::fs::rename(&src_docs, &dest_docs) {
                            Ok(()) => {
                                journal.protected_documents = false;
                            }
                            Err(e) => {
                                errors.push(format!(
                                    "Could not return protected documents to active directory: {e}"
                                ));
                            }
                        }
                    }
                }
            }
        }
    } else {
        // Recovery documents directory does not exist in rollback folder.
        // Reconcile whether original documents are already present and verified in active storage!
        if dest_docs.exists() {
            match std::fs::symlink_metadata(&dest_docs) {
                Ok(meta) => {
                    if is_symlink_or_reparse(&meta) {
                        errors.push(
                            "Active documents directory is an unsafe symlink or reparse point"
                                .into(),
                        );
                    } else if !meta.is_dir() {
                        errors.push("Active documents path is not a directory".into());
                    } else {
                        match inventory_directory_artifacts(&dest_docs) {
                            Ok(active_artifacts) => {
                                let matches_all_originals = active_artifacts.len()
                                    == journal.original_document_artifacts.len()
                                    && journal.original_document_artifacts.iter().all(|orig| {
                                        active_artifacts.iter().any(|act| {
                                            act.name == orig.name
                                                && act.sha256 == orig.sha256
                                                && act.size == orig.size
                                        })
                                    });
                                if matches_all_originals {
                                    // Original documents never left active storage and match recorded identity 100%!
                                    journal.protected_documents = false;
                                } else {
                                    errors.push(
                                        "Active documents do not match recorded original document identities".into(),
                                    );
                                }
                            }
                            Err(e) => {
                                errors.push(format!(
                                    "Could not inventory active documents to reconcile original state: {e}"
                                ));
                            }
                        }
                    }
                }
                Err(e) => {
                    errors.push(format!("Could not inspect active documents: {e}"));
                }
            }
        } else if journal.original_document_artifacts.is_empty()
            && matches!(
                journal.original_documents_presence,
                None | Some(OriginalDocumentsPresence::Absent)
            )
            && !originally_had_docs
        {
            journal.protected_documents = false;
        } else if journal.original_document_artifacts.is_empty()
            && matches!(
                journal.original_documents_presence,
                Some(OriginalDocumentsPresence::PresentEmpty)
            )
        {
            if let Err(e) = std::fs::create_dir_all(&dest_docs) {
                errors.push(format!("Could not recreate empty documents directory: {e}"));
            } else {
                journal.protected_documents = false;
            }
        } else {
            errors.push(
                "Original documents are missing from both recovery and active directories".into(),
            );
        }
    }
    write_journal(root, journal)?;

    if !errors.is_empty() || !journal.protected_db_files.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        if errors.is_empty() {
            return Err(format!(
                "Recovery could not return protected files: {}",
                journal.protected_db_files.join(", ")
            ));
        }
        return Err(errors.join("; "));
    }

    // Step 4: Assess results and verify recovery completeness
    // Verify DB artifacts:
    for orig in &journal.original_db_artifacts {
        if orig.name == DB_FILES[2] {
            // SHM is ephemeral SQLite cache. If it does not exist, SQLite will regenerate it from WAL.
            // If it exists, verify it is a regular file (rejecting symlinks/reparse points).
            let p = root.join(&orig.name);
            match std::fs::symlink_metadata(&p) {
                Ok(meta) => {
                    if is_symlink_or_reparse(&meta) {
                        errors.push("Recovered file her-flight-deck.db-shm is an unsafe symlink or reparse point".into());
                    } else if !meta.is_file() {
                        errors.push(
                            "Recovered file her-flight-deck.db-shm is not a regular file".into(),
                        );
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Ephemeral cache absent: safe; regenerated by SQLite on next open
                }
                Err(e) => {
                    errors.push(format!(
                        "Could not inspect recovered file her-flight-deck.db-shm: {e}"
                    ));
                }
            }
            continue;
        }
        let p = root.join(&orig.name);
        match std::fs::symlink_metadata(&p) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(format!(
                        "Recovered file {} is an unsafe symlink or reparse point",
                        orig.name
                    ));
                } else if !meta.is_file() {
                    errors.push(format!(
                        "Recovered file {} is not a regular file",
                        orig.name
                    ));
                } else {
                    match std::fs::read(&p) {
                        Ok(bytes) => {
                            let hash = hex::encode(Sha256::digest(&bytes));
                            if hash != orig.sha256 || bytes.len() as u64 != orig.size {
                                errors.push(format!(
                                    "Recovered file {} has modified content (hash {hash} != expected {})",
                                    orig.name, orig.sha256
                                ));
                            }
                        }
                        Err(e) => {
                            errors
                                .push(format!("Could not read recovered file {}: {e}", orig.name));
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                errors.push(format!(
                    "Original file {} is missing from active directory after recovery",
                    orig.name
                ));
            }
            Err(e) => {
                errors.push(format!(
                    "Could not inspect recovered file {}: {e}",
                    orig.name
                ));
            }
        }
    }

    if originally_had_db && !root.join(DB_FILES[0]).is_file() {
        errors.push(
            "Rollback completed moves, but primary database is missing from active directory"
                .into(),
        );
    }

    // Verify document artifacts:
    let active_docs = root.join(DOCUMENTS_DIR);
    if originally_had_docs {
        // Original profile HAD documents. Verify they are all present and unmodified!
        match std::fs::symlink_metadata(&active_docs) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(
                        "Active documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else if !meta.is_dir() {
                    errors.push("Active documents path is not a directory".into());
                } else {
                    match inventory_directory_artifacts(&active_docs) {
                        Ok(active_items) => {
                            for orig in &journal.original_document_artifacts {
                                match active_items.iter().find(|a| a.name == orig.name) {
                                    Some(active) => {
                                        if active.sha256 != orig.sha256 || active.size != orig.size
                                        {
                                            errors.push(format!(
                                            "Original document {} has modified content after recovery (hash {} != expected {})",
                                            orig.name, active.sha256, orig.sha256
                                        ));
                                        }
                                    }
                                    None => {
                                        errors.push(format!(
                                        "Original document {} is missing from active directory after recovery",
                                        orig.name
                                    ));
                                    }
                                }
                            }
                            for active in &active_items {
                                if !journal
                                    .original_document_artifacts
                                    .iter()
                                    .any(|o| o.name == active.name)
                                {
                                    errors.push(format!(
                                    "Active documents directory contains unexpected file {} after recovery",
                                    active.name
                                ));
                                }
                            }
                        }
                        Err(e) => {
                            errors.push(format!("Could not inventory recovered documents: {e}"));
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                errors.push(
                    "Original documents directory is missing from active directory after recovery"
                        .into(),
                );
            }
            Err(e) => {
                errors.push(format!("Could not inspect active documents: {e}"));
            }
        }
    } else if journal.installed_documents {
        // Original profile had NO documents, but staged documents were installed.
        // Recovery must verify that documents are absent or empty!
        match std::fs::symlink_metadata(&active_docs) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(
                        "Active documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else if meta.is_dir() {
                    match inventory_directory_artifacts(&active_docs) {
                        Ok(items) => {
                            if !items.is_empty() {
                                errors.push("Active documents directory contains unexpected files after recovery".into());
                            }
                        }
                        Err(e) => {
                            errors.push(format!("Could not inspect active documents: {e}"));
                        }
                    }
                } else {
                    errors.push("Active documents path is not a directory".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Correct: original had no documents, active directory is absent
            }
            Err(e) => {
                errors.push(format!("Could not inspect active documents: {e}"));
            }
        }
    } else if let Ok(meta) = std::fs::symlink_metadata(&active_docs) {
        if is_symlink_or_reparse(&meta) {
            errors.push("Active documents directory is an unsafe symlink or reparse point".into());
        }
    }

    if originally_had_docs && journal.protected_documents {
        errors.push("Protected documents were not fully verified and recovered".into());
    }

    if !errors.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        return Err(errors.join("; "));
    }

    // Step 5: Verify no leftovers in rollback
    if rollback.exists() {
        let entries = std::fs::read_dir(&rollback)
            .map_err(|e| format!("Could not inspect recovery directory for leftovers: {e}"))?;
        let mut leftover = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| format!("Could not read recovery entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name != ".recovery-pending" {
                leftover.push(name);
            }
        }
        if !leftover.is_empty() {
            journal.phase = RestorePhase::UnresolvedRecovery;
            let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
            let _ = write_journal(root, journal);
            return Err(format!(
                "Rollback left unaccounted files in recovery directory: {}",
                leftover.join(", ")
            ));
        }
    }

    // Step 6: Safe to clean up rollback folder and record RolledBack
    let _ = std::fs::remove_file(rollback.join(".recovery-pending"));
    if rollback.exists() {
        std::fs::remove_dir_all(&rollback)
            .map_err(|e| format!("Could not clean up recovery folder: {e}"))?;
    }

    journal.phase = RestorePhase::RolledBack;
    write_journal(root, journal)?;

    Ok(())
}

fn apply_pending_restore_in_internal<F>(
    root: &Path,
    before_install: F,
) -> Result<RestoreApplicationResult, String>
where
    F: FnOnce() -> Result<(), String>,
{
    if root.join(RESTORE_JOURNAL_FILE).exists() {
        let resume_decision = handle_startup_restore_in(root)?;
        match resume_decision {
            StartupRestoreDecision::ProceedNormally => {}
            StartupRestoreDecision::RestoreCompleted => {
                crate::practice_sessions::bump_readiness_generation_at(root);
                return Ok(RestoreApplicationResult::Installed);
            }
            StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
                return Ok(RestoreApplicationResult::RefusedUnchanged(reason));
            }
            StartupRestoreDecision::RolledBackRecovered { reason } => {
                return Ok(RestoreApplicationResult::Recovered(format!(
                    "Restore failed and the previous data was recovered: {reason}"
                )));
            }
            StartupRestoreDecision::BlockedUnresolved {
                reason,
                recovery_folder,
            } => {
                let folder = recovery_folder.unwrap_or_else(|| root.join(BACKUP_DIR));
                return Ok(RestoreApplicationResult::Unresolved {
                    reason,
                    recovery_folder: folder,
                });
            }
        }
    }

    inspect_storage_root(root, "Application root directory")?
        .ok_or_else(|| "Application root directory does not exist".to_string())?;

    let pending = root.join(RESTORE_PENDING_DIR);
    if inspect_storage_root(&pending, "Pending restore directory")?.is_none() {
        return Ok(RestoreApplicationResult::NoPending);
    }
    if !pending.join(DB_FILES[0]).is_file() {
        let _ = std::fs::remove_dir_all(&pending);
        return Ok(RestoreApplicationResult::RefusedUnchanged(
            "A staged restore was incomplete; current data was left unchanged.".to_string(),
        ));
    }
    if let Err(error) = verify_sqlite_file(&pending.join(DB_FILES[0]))
        .and_then(|()| crate::sqlite_guard::check_wal_pair(&pending.join(DB_FILES[0])))
    {
        let _ = std::fs::remove_dir_all(&pending);
        return Ok(RestoreApplicationResult::RefusedUnchanged(format!(
            "The staged restore was not usable, so nothing was changed: {error}"
        )));
    }

    let (plan, replace_documents) = match read_restore_plan_for_ownership(&pending)? {
        Some(plan) => {
            let replace_docs = plan.kind == RestoreKind::Complete;
            (plan, replace_docs)
        }
        None => (
            RestorePlan {
                operation_id: String::new(),
                kind: RestoreKind::Complete,
                source: "legacy".to_string(),
            },
            true,
        ),
    };
    let is_start_fresh = plan.source == "start-fresh";

    let rollback = unique_backup_path(&backup_dir(root)?, "before-restore");
    std::fs::create_dir_all(&rollback)
        .map_err(|e| format!("Could not prepare a recovery copy before restoring: {e}"))?;

    let rollback_rel = rollback
        .strip_prefix(root)
        .map_err(|e| format!("Could not compute relative rollback path: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");

    let current_documents = root.join(DOCUMENTS_DIR);
    let mut journal = RestoreJournal::new(rollback_rel, replace_documents);
    journal.operation_id = plan.operation_id;

    // Pre-record intent: record durable DB files and hashes that exist in root BEFORE moving them!
    const DURABLE_DB_FILES: [&str; 2] = [DB_FILES[0], DB_FILES[1]];
    for name in DURABLE_DB_FILES {
        let p = root.join(name);
        if p.is_file() {
            journal.protected_db_files.push(name.to_string());
            let bytes = std::fs::read(&p).map_err(|e| {
                format!("Could not read current DB file {name} before protection: {e}")
            })?;
            journal.original_db_artifacts.push(ArtifactIdentity {
                name: name.to_string(),
                sha256: hex::encode(Sha256::digest(&bytes)),
                size: bytes.len() as u64,
            });
        }
    }
    if current_documents.exists() {
        let arts = inventory_directory_artifacts(&current_documents)
            .map_err(|e| format!("Could not inventory current documents before protection: {e}"))?;
        if arts.is_empty() {
            journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        } else {
            journal.original_documents_presence =
                Some(OriginalDocumentsPresence::PresentWithContent);
        }
        journal.original_document_artifacts = arts;
        if replace_documents {
            journal.protected_documents = true;
        }
    } else {
        journal.original_documents_presence = Some(OriginalDocumentsPresence::Absent);
    }
    if replace_documents && pending.join(DOCUMENTS_DIR).exists() {
        let arts = inventory_directory_artifacts(&pending.join(DOCUMENTS_DIR)).map_err(|e| {
            format!("Could not inventory staged documents before installation: {e}")
        })?;
        journal.staged_document_artifacts = arts;
    }

    // Pre-record staged artifacts from pending directory before installing them
    for name in DB_FILES {
        let p = pending.join(name);
        if p.is_file() {
            let bytes = std::fs::read(&p)
                .map_err(|e| format!("Could not read staged DB file {name}: {e}"))?;
            journal.staged_db_artifacts.push(ArtifactIdentity {
                name: name.to_string(),
                sha256: hex::encode(Sha256::digest(&bytes)),
                size: bytes.len() as u64,
            });
        }
    }
    write_journal(root, &journal)?;

    let protect_result = (|| {
        #[allow(clippy::unused_enumerate_index)]
        for (_idx, name) in journal.protected_db_files.clone().iter().enumerate() {
            #[cfg(test)]
            let idx = _idx;
            let current = root.join(name);
            if current.exists() {
                #[cfg(test)]
                check_injected_fault(InjectedFault::ProtectDbRename(idx))
                    .map_err(|e| format!("Could not protect the current {name}: {e}"))?;

                std::fs::rename(&current, rollback.join(name))
                    .map_err(|e| format!("Could not protect the current {name}: {e}"))?;
            }
        }
        if journal.protected_documents && current_documents.exists() {
            #[cfg(test)]
            check_injected_fault(InjectedFault::ProtectDocsRename)
                .map_err(|e| format!("Could not protect the current documents: {e}"))?;

            std::fs::rename(&current_documents, rollback.join(DOCUMENTS_DIR))
                .map_err(|e| format!("Could not protect the current documents: {e}"))?;
        }
        journal.phase = RestorePhase::Protected;
        write_journal(root, &journal)?;
        Ok::<(), String>(())
    })();

    if let Err(error) = protect_result {
        journal.failure_reason = Some(error.clone());
        let rollback_res = execute_rollback(root, &mut journal);
        match rollback_res {
            Ok(()) => {
                let mut cleanup_succeeded = true;
                match inspect_storage_root(&pending, "Pending restore directory") {
                    Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                        Ok(true) => {
                            if let Err(e) = remove_pending_directory_safely(&pending) {
                                log::warn!(
                                    "Could not remove the staged restore folder: {:?}",
                                    e.kind()
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(_) => {
                        log::warn!("Could not inspect the pending restore folder.");
                        cleanup_succeeded = false;
                    }
                }
                if cleanup_succeeded {
                    let _ = remove_journal(root);
                }
                return Ok(RestoreApplicationResult::RefusedUnchanged(format!(
                    "Restore was stopped before changing current data: {error}"
                )));
            }
            Err(rollback_err) => {
                let full_rollback = root.join(&journal.rollback_rel_path);
                return Ok(RestoreApplicationResult::Unresolved {
                    reason: format!(
                        "Restore failed ({error}) and recovery rollback could not return original data: {rollback_err}. Original data is safely preserved at {}.",
                        full_rollback.display()
                    ),
                    recovery_folder: full_rollback,
                });
            }
        }
    }

    journal.phase = RestorePhase::Activating;
    write_journal(root, &journal)?;

    let install_result = (|| {
        before_install()?;

        journal.installed_db_files.push(DB_FILES[0].to_string());
        write_journal(root, &journal)?;

        #[cfg(test)]
        check_injected_fault(InjectedFault::InstallDbRename(0))
            .map_err(|e| format!("Could not install the restored database: {e}"))?;

        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0]))
            .map_err(|e| format!("Could not install the restored database: {e}"))?;

        let restored_wal = pending.join(DB_FILES[1]);
        if restored_wal.is_file() {
            journal.installed_db_files.push(DB_FILES[1].to_string());
            write_journal(root, &journal)?;

            #[cfg(test)]
            check_injected_fault(InjectedFault::InstallDbRename(1))
                .map_err(|e| format!("Could not install the restored database log: {e}"))?;

            std::fs::rename(&restored_wal, root.join(DB_FILES[1]))
                .map_err(|e| format!("Could not install the restored database log: {e}"))?;
        }

        if replace_documents {
            journal.installed_documents = true;
            write_journal(root, &journal)?;
            let restored_documents = pending.join(DOCUMENTS_DIR);

            #[cfg(test)]
            check_injected_fault(InjectedFault::InstallDocsRename)
                .map_err(|e| format!("Could not install the restored documents: {e}"))?;

            if restored_documents.exists() {
                std::fs::rename(&restored_documents, &current_documents)
                    .map_err(|e| format!("Could not install the restored documents: {e}"))?;
            } else {
                std::fs::create_dir_all(&current_documents)
                    .map_err(|e| format!("Could not create the restored documents folder: {e}"))?;
            }
        }
        Ok::<(), String>(())
    })();

    if let Err(error) = install_result {
        journal.failure_reason = Some(error.clone());
        let rollback_res = execute_rollback(root, &mut journal);
        match rollback_res {
            Ok(()) => {
                let mut cleanup_succeeded = true;
                match inspect_storage_root(&pending, "Pending restore directory") {
                    Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                        Ok(true) => {
                            if let Err(e) = remove_pending_directory_safely(&pending) {
                                log::warn!(
                                    "Could not remove the staged restore folder: {:?}",
                                    e.kind()
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(_) => {
                        log::warn!("Could not inspect the pending restore folder.");
                        cleanup_succeeded = false;
                    }
                }
                if cleanup_succeeded {
                    let _ = remove_journal(root);
                }
                return Ok(RestoreApplicationResult::Recovered(format!(
                    "Restore failed and the previous data was recovered: {error}"
                )));
            }
            Err(rollback_err) => {
                let full_rollback = root.join(&journal.rollback_rel_path);
                return Ok(RestoreApplicationResult::Unresolved {
                    reason: format!(
                        "Restore failed ({error}) and recovery rollback could not return original data: {rollback_err}. Original data is safely preserved at {}.",
                        full_rollback.display()
                    ),
                    recovery_folder: full_rollback,
                });
            }
        }
    }

    journal.phase = RestorePhase::Committed;
    write_journal(root, &journal)?;

    if is_start_fresh {
        delete_start_fresh_leftovers(root);
    }

    let mut cleanup_succeeded = true;
    match inspect_storage_root(&pending, "Pending restore directory") {
        Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
            Ok(true) => {
                if let Err(e) = remove_pending_directory_safely(&pending) {
                    log::warn!("Could not remove the staged restore folder: {:?}", e.kind());
                    cleanup_succeeded = false;
                }
            }
            Ok(false) => {
                log::warn!("The pending restore folder does not match the restore journal.");
                cleanup_succeeded = false;
            }
            Err(_) => {
                log::warn!("Could not verify who owns the pending restore folder.");
                cleanup_succeeded = false;
            }
        },
        Ok(None) => {}
        Err(_) => {
            log::warn!("The pending restore folder is unsafe; it was left in place.");
            cleanup_succeeded = false;
        }
    }
    if !is_start_fresh {
        let _ = prune(root);
        record_phone_baseline_best_effort(root);
    }

    // GEN-REL-02: nothing Gemini produced for the replaced library may be saved
    // into the restored one. This is part of the committed restore: until it
    // succeeds the restore journal is kept, so the next launch tries again.
    let jobs_cleared = forget_gemini_jobs(root);
    if cleanup_succeeded && jobs_cleared {
        let _ = remove_journal(root);
    }

    crate::practice_sessions::bump_readiness_generation_at(root);
    Ok(RestoreApplicationResult::Installed)
}

/// Forget every Gemini job recorded against the library a restore replaced
/// (GEN-REL-02). False if an old job could still be read back.
fn forget_gemini_jobs(root: &Path) -> bool {
    match crate::gemini_jobs::clear_after_restore(root) {
        Ok(()) => true,
        Err(_) => {
            log::warn!(
                "Could not forget Gemini jobs after restoring; will try again at the next launch."
            );
            false
        }
    }
}

/// Install a restore that was fully validated and staged during the previous run.
///
/// This runs during setup, before the SQL connection opens. Existing data is
/// moved into a recoverable internal backup first and put back if installation
/// fails at any point.
#[allow(dead_code)]
pub fn apply_pending_restore(app: &AppHandle) -> Result<(), String> {
    let root = app_root(app)?;
    apply_pending_restore_in(&root)
}

/// Install whatever was staged, against a plain directory.
#[allow(dead_code)]
pub(crate) fn apply_pending_restore_in(root: &Path) -> Result<(), String> {
    apply_pending_restore_in_with(root, || Ok(()))
}

#[allow(dead_code)]
fn apply_pending_restore_in_with<F>(root: &Path, before_install: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match apply_pending_restore_in_internal(root, before_install) {
        Ok(RestoreApplicationResult::NoPending) => Ok(()),
        Ok(RestoreApplicationResult::Installed) => Ok(()),
        Ok(RestoreApplicationResult::RefusedUnchanged(msg)) => Err(msg),
        Ok(RestoreApplicationResult::Recovered(msg)) => Err(msg),
        Ok(RestoreApplicationResult::Unresolved { reason, .. }) => Err(reason),
        Err(e) => Err(e),
    }
}

/// Inspect disk and journal state at startup to determine whether startup is safe to continue.
pub(crate) fn handle_startup_restore_in(root: &Path) -> Result<StartupRestoreDecision, String> {
    let journal = match read_journal(root) {
        Ok(Some(j)) => Some(j),
        Ok(None) => None,
        Err(e) => {
            return Ok(StartupRestoreDecision::BlockedUnresolved {
                reason: format!("Restore journal validation failed: {e}"),
                recovery_folder: None,
            });
        }
    };

    if journal.is_none() {
        match find_unresolved_recovery_evidence(root) {
            Ok(Some((reason, recovery_folder))) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason,
                    recovery_folder,
                });
            }
            Ok(None) => {}
            Err(e) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: format!("Failed to inspect recovery evidence: {e}"),
                    recovery_folder: None,
                });
            }
        }
        match apply_pending_restore_in_internal(root, || Ok(())) {
            Ok(RestoreApplicationResult::NoPending) => {
                return Ok(StartupRestoreDecision::ProceedNormally)
            }
            Ok(RestoreApplicationResult::Installed) => {
                reset_sync_identity_best_effort(root);
                return Ok(StartupRestoreDecision::RestoreCompleted);
            }
            Ok(RestoreApplicationResult::RefusedUnchanged(reason)) => {
                return Ok(StartupRestoreDecision::StagingRefusedUnchanged { reason });
            }
            Ok(RestoreApplicationResult::Recovered(reason)) => {
                return Ok(StartupRestoreDecision::RolledBackRecovered { reason });
            }
            Ok(RestoreApplicationResult::Unresolved {
                reason,
                recovery_folder,
            }) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason,
                    recovery_folder: Some(recovery_folder),
                });
            }
            Err(e) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: e,
                    recovery_folder: None,
                });
            }
        }
    }

    let mut journal = journal.unwrap();

    let _rollback_dir = match journal.validate(root) {
        Ok(p) => p,
        Err(e) => {
            return Ok(StartupRestoreDecision::BlockedUnresolved {
                reason: format!("Restore journal validation failed: {e}"),
                recovery_folder: None,
            });
        }
    };

    match journal.phase {
        RestorePhase::Committed => {
            let pending = root.join(RESTORE_PENDING_DIR);
            let is_start_fresh = read_restore_plan_for_ownership(&pending)
                .ok()
                .flatten()
                .is_some_and(|p| p.source == "start-fresh");
            let mut cleanup_succeeded = true;
            match inspect_storage_root(&pending, "Pending restore directory") {
                Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                    Ok(true) => {
                        if let Err(e) = remove_pending_directory_safely(&pending) {
                            log::warn!(
                                "Could not remove the staged restore folder: {:?}",
                                e.kind()
                            );
                            cleanup_succeeded = false;
                        }
                    }
                    Ok(false) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "Committed restore journal ({}) cannot remove pending directory belonging to a different or unverified operation",
                                journal.operation_id
                            ),
                            recovery_folder: None,
                        });
                    }
                    Err(e) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "Cannot verify ownership of pending restore directory: {e}"
                            ),
                            recovery_folder: None,
                        });
                    }
                },
                Ok(None) => {}
                Err(e) => {
                    return Ok(StartupRestoreDecision::BlockedUnresolved {
                        reason: format!("Cannot inspect pending restore directory: {e}"),
                        recovery_folder: None,
                    });
                }
            }
            if cleanup_succeeded {
                if is_start_fresh {
                    delete_start_fresh_leftovers(root);
                } else {
                    record_phone_baseline_best_effort(root);
                    let _ = prune(root);
                }
                reset_sync_identity_best_effort(root);
                // A restore interrupted after it committed: finish forgetting
                // the replaced library's Gemini jobs before the journal goes.
                if forget_gemini_jobs(root) {
                    let _ = remove_journal(root);
                }
                Ok(StartupRestoreDecision::RestoreCompleted)
            } else {
                Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: "Pending cleanup failed; restore journal retained".into(),
                    recovery_folder: None,
                })
            }
        }
        RestorePhase::RolledBack => {
            let pending = root.join(RESTORE_PENDING_DIR);
            let mut cleanup_succeeded = true;
            match inspect_storage_root(&pending, "Pending restore directory") {
                Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                    Ok(true) => {
                        if let Err(e) = remove_pending_directory_safely(&pending) {
                            log::warn!(
                                "Could not remove the staged restore folder: {:?}",
                                e.kind()
                            );
                            cleanup_succeeded = false;
                        }
                    }
                    Ok(false) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "RolledBack restore journal ({}) cannot remove pending directory belonging to a different or unverified operation",
                                journal.operation_id
                            ),
                            recovery_folder: None,
                        });
                    }
                    Err(e) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "Cannot verify ownership of pending restore directory: {e}"
                            ),
                            recovery_folder: None,
                        });
                    }
                },
                Ok(None) => {}
                Err(e) => {
                    return Ok(StartupRestoreDecision::BlockedUnresolved {
                        reason: format!("Cannot inspect pending restore directory: {e}"),
                        recovery_folder: None,
                    });
                }
            }
            if cleanup_succeeded {
                let _ = remove_journal(root);
                Ok(StartupRestoreDecision::RolledBackRecovered {
                    reason: journal.failure_reason.unwrap_or_else(|| {
                        "interrupted restore was rolled back to original data".to_string()
                    }),
                })
            } else {
                Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: "Pending cleanup failed after rollback; restore journal retained"
                        .into(),
                    recovery_folder: None,
                })
            }
        }
        RestorePhase::UnresolvedRecovery
        | RestorePhase::RollingBack
        | RestorePhase::Protecting
        | RestorePhase::Protected
        | RestorePhase::Activating => match execute_rollback(root, &mut journal) {
            Ok(()) => {
                let pending = root.join(RESTORE_PENDING_DIR);
                let mut cleanup_succeeded = true;
                match inspect_storage_root(&pending, "Pending restore directory") {
                    Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                        Ok(true) => {
                            if let Err(e) = remove_pending_directory_safely(&pending) {
                                log::warn!(
                                    "Could not remove the staged restore folder: {:?}",
                                    e.kind()
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        Ok(false) => {
                            return Ok(StartupRestoreDecision::BlockedUnresolved {
                                reason: format!(
                                    "Rolled back restore journal ({}) cannot remove pending directory belonging to a different or unverified operation",
                                    journal.operation_id
                                ),
                                recovery_folder: None,
                            });
                        }
                        Err(e) => {
                            return Ok(StartupRestoreDecision::BlockedUnresolved {
                                reason: format!(
                                    "Cannot verify ownership of pending restore directory: {e}"
                                ),
                                recovery_folder: None,
                            });
                        }
                    },
                    Ok(None) => {}
                    Err(e) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!("Cannot inspect pending restore directory: {e}"),
                            recovery_folder: None,
                        });
                    }
                }
                if cleanup_succeeded {
                    let _ = remove_journal(root);
                    Ok(StartupRestoreDecision::RolledBackRecovered {
                        reason: journal.failure_reason.unwrap_or_else(|| {
                            "interrupted restore was rolled back to original data".to_string()
                        }),
                    })
                } else {
                    Ok(StartupRestoreDecision::BlockedUnresolved {
                        reason: "Pending cleanup failed after rollback; restore journal retained"
                            .into(),
                        recovery_folder: None,
                    })
                }
            }
            Err(rollback_err) => {
                journal.phase = RestorePhase::UnresolvedRecovery;
                let _ = write_journal(root, &journal);
                let orig_err = journal
                    .failure_reason
                    .as_deref()
                    .unwrap_or("prior restore failed");
                let full_rollback = root.join(&journal.rollback_rel_path);
                Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: format!(
                        "Restore failed ({orig_err}) and recovery rollback could not return original data: {rollback_err}. Original data is safely preserved at {}.",
                        full_rollback.display()
                    ),
                    recovery_folder: Some(full_rollback),
                })
            }
        },
    }
}

/// The startup restore under the library lock. Nothing else holds it this
/// early, and a lock that cannot be taken must never stop the app from
/// opening: it carries on without the lock, exactly as before the lock existed.
pub(crate) fn handle_startup_restore_locked(root: &Path) -> Result<StartupRestoreDecision, String> {
    let _guard = match crate::library_lock::try_acquire(root, crate::library_lock::Holder::Library)
    {
        Ok(guard) => Some(guard),
        Err(_) => {
            log::warn!("Could not lock the study library at startup; continuing without the lock.");
            None
        }
    };
    handle_startup_restore_in(root)
}

/// Installs or resolves any pending restore before SQLite opens. Returns
/// whether this startup finished a restore, so the caller can bring the
/// restarted window forward: the restart execs the binary directly rather than
/// through LaunchServices, and macOS would otherwise leave it behind whatever
/// was in front.
pub fn handle_startup_restore(app: &AppHandle) -> Result<bool, String> {
    let root = app_root(app)?;
    let decision = handle_startup_restore_locked(&root)?;
    crate::safety_notices::record_restore_outcome(&root, &decision);
    startup_restore_outcome(decision)
}

fn startup_restore_outcome(decision: StartupRestoreDecision) -> Result<bool, String> {
    match decision {
        StartupRestoreDecision::ProceedNormally => Ok(false),
        StartupRestoreDecision::RestoreCompleted => Ok(true),
        StartupRestoreDecision::StagingRefusedUnchanged { .. } => {
            log::warn!("A pending restore was refused; current data unchanged.");
            Ok(false)
        }
        StartupRestoreDecision::RolledBackRecovered { .. } => {
            log::error!("A pending restore failed; the previous data was recovered.");
            Ok(false)
        }
        StartupRestoreDecision::BlockedUnresolved {
            reason,
            recovery_folder,
        } => {
            let loc = recovery_folder
                .map(|p| format!(" (recovery copy preserved at: {})", p.display()))
                .unwrap_or_default();
            Err(format!(
                "Startup blocked to prevent data loss: {reason}{loc}. Resolve data obstruction or restore from backup before relaunching."
            ))
        }
    }
}

/// One safety copy, as the interface sees it.
fn describe_backup_folder(path: &Path) -> BackupInfo {
    BackupInfo {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        bytes: directory_size(path),
        created_at: std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        restorable: folder_is_restorable(path),
        path: path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    list_backups_in(&app_root(&app)?)
}

pub(crate) fn list_backups_in(root: &Path) -> Result<Vec<BackupInfo>, String> {
    let dir = backup_dir(root)?;
    let mut backups: Vec<BackupInfo> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read the backup directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .map(|entry| describe_backup_folder(&entry.path()))
        .collect();

    // Newest first.
    backups.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(backups)
}

fn directory_size(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|entry| {
                    entry
                        .metadata()
                        .map(|metadata| {
                            if metadata.is_dir() {
                                directory_size(&entry.path())
                            } else {
                                metadata.len()
                            }
                        })
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

/// The folder holding her database, documents and backups.
#[tauri::command]
pub fn data_directory(app: AppHandle) -> Result<String, String> {
    Ok(app_root(&app)?.to_string_lossy().to_string())
}

/// Open her data folder in Finder or File Explorer.
///
/// The folder is resolved here from `app_root`, never taken from the webview,
/// so this needs no path scope and opens exactly the folder `data_directory`
/// shows.
///
/// On macOS that folder is named after the bundle identifier,
/// `com.herflightdeck.app`, and anything ending in `.app` is treated as an
/// application: `/usr/bin/open` on it fails with "The application cannot be
/// opened because its executable is missing", which is exactly what an
/// installed Mac reported. Revealing an item *inside* the folder makes Finder
/// open the folder itself with that item selected, and needs no extra
/// permission, so that is what macOS does here. For a truly empty folder,
/// revealing the folder itself in its parent displays the folder in Finder
/// without Launch Services executing it as an application.
#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let root = app_root(&app)?;
    open_data_folder_in(&root)
}

/// System opener operations used to show the data folder.
trait FolderOpener {
    fn reveal_item_in_dir(&self, path: &Path) -> Result<(), String>;
    fn open_path(&self, path: &Path) -> Result<(), String>;
}

struct SystemFolderOpener;

impl FolderOpener for SystemFolderOpener {
    fn reveal_item_in_dir(&self, path: &Path) -> Result<(), String> {
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
    }

    fn open_path(&self, path: &Path) -> Result<(), String> {
        tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
    }
}

fn open_data_folder_in(root: &Path) -> Result<(), String> {
    open_data_folder_with(root, cfg!(target_os = "macos"), &SystemFolderOpener)
}

fn open_data_folder_with<O: FolderOpener>(
    root: &Path,
    is_macos: bool,
    opener: &O,
) -> Result<(), String> {
    let opened = if is_macos {
        match item_to_reveal_in(root) {
            Ok(item) => opener.reveal_item_in_dir(&item),
            Err(e) => Err(e.to_string()),
        }
    } else {
        opener.open_path(root)
    };
    opened.map_err(|e| format!("Could not open {}: {e}", root.display()))
}

/// What to select so Finder shows the inside of `root`:
/// - the database when it is there,
/// - otherwise the first item in the folder in name order,
/// - otherwise `root` itself when the directory is truly empty,
/// - or an I/O error if the directory cannot be inspected.
fn item_to_reveal_in(root: &Path) -> std::io::Result<PathBuf> {
    let database = root.join(DB_FILES[0]);
    if database.is_file() {
        return Ok(database);
    }
    let entries = std::fs::read_dir(root)?;
    let mut items: Vec<PathBuf> = Vec::new();
    for entry in entries {
        items.push(entry?.path());
    }
    items.sort();
    if let Some(first) = items.into_iter().next() {
        Ok(first)
    } else {
        Ok(root.to_path_buf())
    }
}

const IPHONE_FOLDER: &str = "Her Flight Deck";
const IPHONE_BACKUPS_KEPT: usize = 3;

/// The iCloud Drive folder her iPhone reads from, created on first use.
/// `None` when iCloud Drive is off, missing or not writable here.
pub(crate) fn iphone_backup_dir(home: &Path) -> Option<PathBuf> {
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    if !icloud.is_dir() {
        return None;
    }
    let dir = icloud.join(IPHONE_FOLDER);
    std::fs::create_dir_all(&dir).ok()?;
    dir.is_dir().then_some(dir)
}

fn iphone_stamp_is_valid(stamp: &str) -> bool {
    // "YYYY-MM-DD HHmm"
    let b = stamp.as_bytes();
    b.len() == 15
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b' ',
            _ => c.is_ascii_digit(),
        })
}

/// `Her Flight Deck <YYYY-MM-DD HHmm>.hfdbackup`, from a UTC clock reading.
pub(crate) fn iphone_backup_file_name(now: std::time::SystemTime) -> String {
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{IPHONE_FOLDER} {year:04}-{month:02}-{day:02} {:02}{:02}.hfdbackup",
        rem / 3_600,
        (rem % 3_600) / 60
    )
}

fn is_iphone_backup_name(name: &str) -> bool {
    name.strip_prefix(IPHONE_FOLDER)
        .and_then(|rest| rest.strip_prefix(' '))
        .and_then(|rest| rest.strip_suffix(".hfdbackup"))
        .is_some_and(iphone_stamp_is_valid)
}

/// Keep the newest `keep` files that match the dated name; touch nothing else.
pub(crate) fn prune_iphone_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Could not look in the iPhone folder: {e}"))?;
    let mut matching: Vec<(std::time::SystemTime, String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_iphone_backup_name(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        matching.push((modified, name, entry.path()));
    }
    matching.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, _, path) in matching.into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("Could not remove an older iPhone copy: {e}");
        }
    }
    Ok(())
}

/// Save a complete backup where her iPhone can open it from Files.
/// `Ok(None)` means iCloud Drive is not available and the caller should ask
/// where to save instead. `local_stamp` is her local "YYYY-MM-DD HHmm".
#[tauri::command]
pub async fn create_iphone_backup(
    app: AppHandle,
    local_stamp: Option<String>,
) -> Result<Option<CompleteBackupInfo>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return Ok(None);
        };
        let Some(dir) = iphone_backup_dir(&home) else {
            return Ok(None);
        };
        let name = match local_stamp.as_deref().filter(|s| iphone_stamp_is_valid(s)) {
            Some(stamp) => format!("{IPHONE_FOLDER} {stamp}.hfdbackup"),
            None => iphone_backup_file_name(std::time::SystemTime::now()),
        };
        let root = app_root(&app)?;
        // Read before the copy starts: a change made during it may be in
        // neither the copy nor a file otherwise (overlap is harmless).
        let mark = crate::sync::send::change_stream_mark(&root).ok();
        let info = create_consistent_complete_backup_with_retry(
            &root,
            &dir.join(name),
            &app.package_info().version.to_string(),
        )?;
        if let Err(e) = prune_iphone_backups(&dir, IPHONE_BACKUPS_KEPT) {
            log::warn!("{e}");
        }
        // The Mac's changes now start after this copy. Never fails the copy.
        if let Some(mark) = mark {
            if let Err(e) = crate::sync::send::restart_change_stream(&root, mark) {
                log::warn!("Could not restart the change stream after the copy: {e}");
            }
        }
        Ok(Some(info))
    })
    .await
    .map_err(|error| format!("Could not finish saving the backup: {error}"))?
}

fn reveal_iphone_backup_with<O: FolderOpener>(
    dir: &Path,
    path: &str,
    opener: &O,
) -> Result<(), String> {
    let refuse = || "That file is not in your iPhone folder.".to_string();
    let dir = dir.canonicalize().map_err(|_| refuse())?;
    let target = Path::new(path).canonicalize().map_err(|_| refuse())?;
    if !target.starts_with(&dir) {
        return Err(refuse());
    }
    opener.reveal_item_in_dir(&target)
}

/// Show one saved iPhone copy in Finder (for AirDrop). Refuses other paths.
#[tauri::command]
pub fn reveal_iphone_backup(_app: AppHandle, path: String) -> Result<(), String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "That file is not in your iPhone folder.".to_string())?;
    let dir = iphone_backup_dir(&home)
        .ok_or_else(|| "That file is not in your iPhone folder.".to_string())?;
    reveal_iphone_backup_with(&dir, &path, &SystemFolderOpener)
}

#[cfg(test)]
mod tests;
