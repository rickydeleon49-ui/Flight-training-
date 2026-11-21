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

mod restore;
pub(crate) use restore::*;
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
