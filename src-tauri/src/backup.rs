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

use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::storage::app_root;

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
const RESTORE_PENDING_DIR: &str = ".restore-pending";
const RESTORE_JOURNAL_FILE: &str = "restore-journal.json";
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
const DB_FILES: [&str; 3] = [
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
    pub path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_documents: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unreferenced_documents: Vec<String>,
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
        return Err("That file is not a Her Flight Deck database.".to_string());
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

fn verify_application_database(path: &Path) -> Result<(), String> {
    verify_sqlite_file(path)?;
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open the database in that backup: {e}"))?;
    // `rusqlite` opens with no busy timeout of its own — unlike the app's
    // main connection pool, which gets one from its own driver by default —
    // so without this, a lock briefly held by an ordinary write elsewhere
    // (an autosave, a split saving its parts) fails this check immediately
    // instead of just waiting the moment out. Checking a live database, not
    // only a staged one, is exactly the case this matters for.
    let _ = connection.busy_timeout(BUSY_TIMEOUT);
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("Could not check the database in that backup: {e}"))?;
    if quick_check != "ok" {
        return Err("The database in that backup is damaged or incomplete.".to_string());
    }

    for table in ["settings", "study_materials"] {
        let present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .map_err(|e| format!("Could not inspect the database schema: {e}"))?;
        if present != 1 {
            return Err(format!(
                "That backup does not contain a Her Flight Deck database (missing {table})."
            ));
        }
    }

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
        .ok_or_else(|| {
            "That backup does not contain Her Flight Deck migration history.".to_string()
        })?;
    let newest_migration: i64 = connection
        .query_row(
            &format!("SELECT COALESCE(MAX(version), 0) FROM {migration_table}"),
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Could not inspect the database version: {e}"))?;
    if newest_migration > crate::CURRENT_SCHEMA_VERSION {
        return Err(
            "That backup was created by a newer database format. Update the app first.".to_string(),
        );
    }
    Ok(())
}

/// Whether a failure looks like transient SQLite lock contention rather than
/// a real problem with the database.
fn is_transient_lock_error(message: &str) -> bool {
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

fn validate_archive_path(raw_name: &str, path: &Path) -> Result<(), String> {
    if raw_name.len() > MAX_ARCHIVE_PATH_BYTES
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

fn validate_compression_ratio(uncompressed: u64, compressed: u64) -> Result<(), String> {
    if uncompressed <= COMPRESSION_RATIO_FLOOR {
        return Ok(());
    }
    if compressed == 0
        || uncompressed.checked_div(compressed).unwrap_or(u64::MAX) > MAX_COMPRESSION_RATIO
    {
        return Err("The backup contains an unsafe compression ratio.".to_string());
    }
    Ok(())
}

/// Copy a restored file's bytes from the archive to disk, hashing exactly the
/// bytes written. Returns the byte count and SHA-256 of what was written.
///
/// Hashing while writing replaces reopening each new file to hash it
/// afterwards. That reopen is what made staging slow on Windows (about 19 ms
/// per just-written file, most of a large restore; see
/// docs/PERFORMANCE_POLISH_2026-09-27.md). The check is the same: the bytes
/// that went to the file must match the archive's integrity record before the
/// restore is staged, and the file is still flushed with `sync_all` first.
fn copy_and_hash(reader: &mut impl Read, output: &mut File) -> Result<(u64, String), String> {
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
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut db_entry = archive
        .by_name(DB_FILES[0])
        .map_err(|_| "That backup does not contain a Her Flight Deck database.".to_string())?;

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

    verify_application_database(&temp_db_path)?;

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

    Ok((missing_documents, unreferenced_documents))
}

pub(crate) fn inspect_archive(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| zip_error("That is not a readable Her Flight Deck backup", e))?;

    let manifest: CompleteBackupManifest = {
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
        serde_json::from_str(&json).map_err(|e| format!("The backup manifest is invalid: {e}"))?
    };

    if manifest.format != ARCHIVE_FORMAT
        || !matches!(
            manifest.format_version,
            LEGACY_ARCHIVE_VERSION | V2_ARCHIVE_VERSION | ARCHIVE_VERSION
        )
    {
        return Err("That backup format is not supported by this version of the app.".to_string());
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
        let raw_name = entry.name().to_string();
        let path = entry
            .enclosed_name()
            .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
        validate_archive_path(&raw_name, &path)?;
        validate_compression_ratio(entry.size(), entry.compressed_size())?;
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
                    "The database in that backup is damaged, or that file is not a Her Flight Deck backup."
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
                        "The database in that backup is damaged, or that file is not a Her Flight Deck backup."
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
        return Err("That backup does not contain a Her Flight Deck database.".to_string());
    }

    let (missing_documents, unreferenced_documents) = if manifest.format_version
        >= V2_ARCHIVE_VERSION
    {
        verify_archive_database_and_documents(root, &mut archive, &manifest, &archive_documents)?
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(CompleteBackupInfo {
        app_version: manifest.app_version,
        current_app_version: current_app_version.to_string(),
        created_at: manifest.created_at,
        files,
        bytes,
        path: source.to_string_lossy().to_string(),
        missing_documents,
        unreferenced_documents,
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
fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
}

#[cfg(not(windows))]
fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
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
fn backup_if_upgraded_in(root: &Path, current: &str) -> Result<(), String> {
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
    copy_database(root, &format!("before-{current}"))?;
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
    Ok(destination.to_string_lossy().to_string())
}

/// Export one portable file containing the database and every imported document.
#[tauri::command]
pub async fn create_complete_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<CompleteBackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        create_consistent_complete_backup_with_retry(
            &root,
            Path::new(&destination_path),
            &app.package_info().version.to_string(),
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
fn write_complete_backup(
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

        let (docs_to_archive, missing_at_export, orphans_at_export) = if verify_before_finish {
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

            (Some(to_archive), missing, orphans)
        } else {
            (None, Vec::new(), Vec::new())
        };

        let output = File::create(&temporary).map_err(|e| {
            BackupExportError::Permanent(format!("Could not create the backup file: {e}"))
        })?;
        let mut archive = ZipWriter::new(output);
        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: app_version.to_string(),
            created_at: unix_timestamp(),
            missing_at_export: missing_at_export.clone(),
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
        if verify_before_finish {
            inspect_archive(root, &temporary, app_version).map_err(|e| {
                BackupExportError::Permanent(format!(
                    "The backup was written but did not pass its own integrity check: {e}"
                ))
            })?;
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
            current_app_version: manifest.app_version.clone(),
            app_version: manifest.app_version,
            created_at: manifest.created_at,
            files,
            bytes,
            path: destination.to_string_lossy().to_string(),
            missing_documents: missing_at_export,
            unreferenced_documents: orphans_at_export,
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
        stage_complete_restore_in(
            &app_root(&app)?,
            Path::new(&source_path),
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|error| format!("Could not finish restoring that backup: {error}"))?
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
            let raw_name = entry.name().to_string();
            let path = entry
                .enclosed_name()
                .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
            validate_archive_path(&raw_name, &path)?;
            validate_compression_ratio(entry.size(), entry.compressed_size())?;
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

/// Stage one of the automatic safety copies for installation on next launch.
///
/// These copies hold the database only, so uploaded documents are deliberately
/// left exactly where they are: the copy is the database as it stood before an
/// update, and her files never went anywhere.
#[tauri::command]
pub async fn stage_local_restore(app: AppHandle, name: String) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || stage_local_restore_in(&app_root(&app)?, &name))
        .await
        .map_err(|error| format!("Could not finish restoring that safety copy: {error}"))?
}

/// Stage a named safety copy, against a plain directory.
fn stage_local_restore_in(root: &Path, name: &str) -> Result<BackupInfo, String> {
    let name = safe_backup_name(name)?;
    let folder = backup_dir(root)?.join(name);
    if !folder.is_dir() {
        return Err("That safety copy is no longer there.".to_string());
    }
    let database = folder.join(DB_FILES[0]);
    verify_sqlite_file(&database)?;

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
    app.request_restart();
    Ok(())
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
            let src_meta = match std::fs::symlink_metadata(&src_docs) {
                Ok(m) => m,
                Err(e) => {
                    errors.push(format!(
                        "Could not inspect recovery documents directory: {e}"
                    ));
                    std::fs::metadata(&rollback).unwrap()
                }
            };
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
    if let Err(error) = verify_sqlite_file(&pending.join(DB_FILES[0])) {
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
                                eprintln!(
                                    "Warning: Could not remove staged restore directory: {e}"
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("Warning: Cannot inspect pending restore directory: {e}");
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
                                eprintln!(
                                    "Warning: Could not remove staged restore directory: {e}"
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("Warning: Cannot inspect pending restore directory: {e}");
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

    let mut cleanup_succeeded = true;
    match inspect_storage_root(&pending, "Pending restore directory") {
        Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
            Ok(true) => {
                if let Err(e) = remove_pending_directory_safely(&pending) {
                    eprintln!("Warning: Could not remove staged restore directory: {e}");
                    cleanup_succeeded = false;
                }
            }
            Ok(false) => {
                eprintln!("Warning: Pending restore directory ownership does not match journal");
                cleanup_succeeded = false;
            }
            Err(e) => {
                eprintln!("Warning: Cannot verify ownership of pending restore directory: {e}");
                cleanup_succeeded = false;
            }
        },
        Ok(None) => {}
        Err(e) => {
            eprintln!("Warning: Pending restore directory is unsafe: {e}");
            cleanup_succeeded = false;
        }
    }
    let _ = prune(root);

    if cleanup_succeeded {
        let _ = remove_journal(root);
    }

    Ok(RestoreApplicationResult::Installed)
}

/// Install a restore that was fully validated and staged during the previous run.
///
/// This runs during setup, before the SQL connection opens. Existing data is
/// moved into a recoverable internal backup first and put back if installation
/// fails at any point.
#[allow(dead_code)]
pub fn apply_pending_restore(app: &AppHandle) -> Result<(), String> {
    apply_pending_restore_in(&app_root(app)?)
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
                return Ok(StartupRestoreDecision::RestoreCompleted)
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
            let mut cleanup_succeeded = true;
            match inspect_storage_root(&pending, "Pending restore directory") {
                Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                    Ok(true) => {
                        if let Err(e) = remove_pending_directory_safely(&pending) {
                            eprintln!("Warning: Could not remove staged restore directory: {e}");
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
                let _ = prune(root);
                let _ = remove_journal(root);
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
                            eprintln!("Warning: Could not remove staged restore directory: {e}");
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
                                eprintln!(
                                    "Warning: Could not remove staged restore directory: {e}"
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

pub fn handle_startup_restore(app: &AppHandle) -> Result<(), String> {
    let root = app_root(app)?;
    match handle_startup_restore_in(&root)? {
        StartupRestoreDecision::ProceedNormally | StartupRestoreDecision::RestoreCompleted => {
            Ok(())
        }
        StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
            eprintln!("Pending restore refused: {reason}; current data unchanged.");
            Ok(())
        }
        StartupRestoreDecision::RolledBackRecovered { reason } => {
            eprintln!("Pending restore failed: {reason}; previous data was recovered.");
            Ok(())
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

fn list_backups_in(root: &Path) -> Result<Vec<BackupInfo>, String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn sha256_digest(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    /// A private directory to play the part of her application data folder.
    fn scratch(label: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "hfd-{label}-{}-{}-{unique}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A minimal real application database with recognizable test contents.
    fn write_database(path: &Path, contents: &str) {
        for candidate in [
            path.to_path_buf(),
            PathBuf::from(format!("{}-wal", path.to_string_lossy())),
            PathBuf::from(format!("{}-shm", path.to_string_lossy())),
        ] {
            let _ = std::fs::remove_file(candidate);
        }
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings (id TEXT PRIMARY KEY);
                 CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT);
                 CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
                 CREATE TABLE audit_payload (value TEXT NOT NULL);
                 INSERT INTO _sqlx_migrations(version) VALUES (9);",
            )
            .unwrap();
        connection
            .execute("INSERT INTO audit_payload(value) VALUES (?1)", [contents])
            .unwrap();
    }

    #[test]
    fn current_database_version_matches_the_registered_migrations() {
        let latest = crate::migrations().last().unwrap().version;
        assert_eq!(latest, crate::CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn current_practice_test_schema_can_be_backed_up_but_future_schema_cannot() {
        let root = scratch("practice-schema-backup");
        let database = root.join(DB_FILES[0]);
        write_database(&database, "version nine");
        let snapshot = database_snapshot_with_retry(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "version nine");
        std::fs::remove_file(snapshot).unwrap();

        Connection::open(&database)
            .unwrap()
            .execute(
                "UPDATE _sqlx_migrations SET version = ?1",
                [crate::CURRENT_SCHEMA_VERSION + 1],
            )
            .unwrap();
        assert!(verify_application_database(&database)
            .unwrap_err()
            .contains("newer"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manual_safety_copy_is_a_consistent_online_snapshot() {
        let root = scratch("manual-online-snapshot");
        write_database(&root.join(DB_FILES[0]), "before");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute("UPDATE audit_payload SET value = 'after'", [])
            .unwrap();

        let backup = create_consistent_local_backup(&root).unwrap();
        let saved = PathBuf::from(backup).join(DB_FILES[0]);
        assert_eq!(database_contents(&saved), "after");
        verify_application_database(&saved).unwrap();
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn database_contents(path: &Path) -> String {
        Connection::open(path)
            .unwrap()
            .query_row("SELECT value FROM audit_payload LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn write_document(root: &Path, relative: &str, contents: &str) {
        let path = root.join(DOCUMENTS_DIR).join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        let db_path = root.join(DB_FILES[0]);
        if db_path.is_file() {
            if let Ok(conn) = Connection::open(&db_path) {
                let normalized = relative.replace('\\', "/");
                let _ = conn.execute(
                    "INSERT INTO study_materials (id, file_path) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
                    params![normalized, normalized],
                );
            }
        }
    }

    fn document_contents(root: &Path, relative: &str) -> Option<String> {
        std::fs::read_to_string(root.join(DOCUMENTS_DIR).join(relative)).ok()
    }

    fn rewrite_entry(archive_path: &Path, target: &str, replacement: &[u8]) {
        let input = File::open(archive_path).unwrap();
        let mut input = ZipArchive::new(input).unwrap();
        let rewritten = archive_path.with_extension("rewritten");
        let output = File::create(&rewritten).unwrap();
        let mut output = ZipWriter::new(output);
        for index in 0..input.len() {
            let mut entry = input.by_index(index).unwrap();
            let name = entry.name().to_string();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            output.start_file(&name, archive_options()).unwrap();
            output
                .write_all(if name == target { replacement } else { &bytes })
                .unwrap();
        }
        output.finish().unwrap();
        std::fs::rename(rewritten, archive_path).unwrap();
    }

    fn write_legacy_backup(root: &Path, archive_path: &Path, app_version: &str) {
        let output = File::create(archive_path).unwrap();
        let mut archive = ZipWriter::new(output);
        archive
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .unwrap();
        archive
            .write_all(
                serde_json::to_string(&CompleteBackupManifest {
                    format: ARCHIVE_FORMAT.to_string(),
                    format_version: LEGACY_ARCHIVE_VERSION,
                    app_version: app_version.to_string(),
                    created_at: 0,
                    missing_at_export: Vec::new(),
                })
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        add_file_to_archive(&mut archive, &root.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn an_archive_may_only_contain_her_database_and_documents() {
        assert!(allowed_archive_path(Path::new(ARCHIVE_MANIFEST), false));
        assert!(allowed_archive_path(Path::new(DB_FILES[0]), false));
        assert!(allowed_archive_path(Path::new(DB_FILES[1]), false));
        assert!(allowed_archive_path(
            &Path::new(DOCUMENTS_DIR).join("chart.pdf"),
            false
        ));
        assert!(allowed_archive_path(Path::new(DOCUMENTS_DIR), true));

        // A backup file must never be able to say how it gets installed.
        assert!(!allowed_archive_path(Path::new(RESTORE_PLAN), false));
        // Nor drop anything else beside her data.
        assert!(!allowed_archive_path(
            Path::new("last-run-version.txt"),
            false
        ));
        // Nor hand her a Gemini key chosen by whoever wrote the archive.
        assert!(!allowed_archive_path(
            Path::new(crate::secrets::KEY_FILE),
            false
        ));
        assert!(!allowed_archive_path(Path::new("documents"), false));
        assert!(!allowed_archive_path(Path::new(DB_FILES[0]), true));
    }

    #[test]
    fn a_database_is_recognized_by_its_header() {
        assert!(is_sqlite_header(SQLITE_MAGIC));
        assert!(is_sqlite_header(b"SQLite format 3\0and then some pages"));
        assert!(!is_sqlite_header(b"SQLite format 3"));
        assert!(!is_sqlite_header(b""));
        assert!(!is_sqlite_header(b"PK\x03\x04 a zip file, not a database"));
    }

    #[test]
    fn a_chosen_safety_copy_cannot_climb_out_of_the_backup_folder() {
        assert_eq!(
            safe_backup_name("2026-09-05-174233-manual").unwrap(),
            "2026-09-05-174233-manual"
        );
        assert_eq!(
            safe_backup_name(" 2026-09-05-174233-manual ").unwrap(),
            "2026-09-05-174233-manual"
        );

        for bad in ["", "  ", ".", "..", "../documents", "a/b", "a\\b", "a\0b"] {
            assert!(safe_backup_name(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn a_restore_plan_survives_being_written_and_read_back() {
        let json = serde_json::to_string(&RestorePlan {
            operation_id: "test-op".to_string(),
            kind: RestoreKind::Database,
            source: "2026-09-05-174233-before-0.3.0".to_string(),
        })
        .unwrap();
        let read: RestorePlan = serde_json::from_str(&json).unwrap();
        assert_eq!(read.kind, RestoreKind::Database);
        assert_eq!(read.operation_id, "test-op");
    }

    #[test]
    fn a_missing_or_damaged_plan_is_treated_as_a_complete_archive() {
        // Every version before restore plans existed staged complete archives,
        // and a half-written plan must not silently keep the wrong documents.
        let dir = std::env::temp_dir().join(format!("hfd-plan-{}", unix_timestamp()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Complete);

        std::fs::write(dir.join(RESTORE_PLAN), "{ not json").unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Complete);

        write_restore_plan(&dir, RestoreKind::Database, "a safety copy").unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Database);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_a_folder_holding_a_real_database_offers_to_be_restored() {
        let dir = std::env::temp_dir().join(format!("hfd-copy-{}", unix_timestamp()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!folder_is_restorable(&dir));

        std::fs::write(dir.join(DB_FILES[0]), b"not a database at all").unwrap();
        assert!(!folder_is_restorable(&dir));

        let mut database = SQLITE_MAGIC.to_vec();
        database.extend_from_slice(&[0u8; 128]);
        std::fs::write(dir.join(DB_FILES[0]), database).unwrap();
        assert!(folder_is_restorable(&dir));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_timestamp_reads_as_a_sortable_date() {
        // Copies are pruned oldest-first by name, so the shape matters.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_702), (2026, 9, 6));
    }

    /* --------------------- backup and restore, end to end ---------------- */

    #[test]
    fn a_complete_backup_puts_back_the_database_and_every_document() {
        let root = scratch("complete");
        let elsewhere = scratch("elsewhere");
        write_database(&root.join(DB_FILES[0]), "her real training record");
        write_document(&root, "airplane-flying-handbook.pdf", "chapter nine");
        write_document(&root, "lessons/debrief.png", "crosswind notes");

        let archive = elsewhere.join("her-flight-deck.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.app_version, "0.2.0");
        // The database and both documents.
        assert_eq!(saved.files, 3);
        assert!(archive.is_file());

        // Something goes wrong afterwards: the record is replaced and a file lost.
        write_database(&root.join(DB_FILES[0]), "damaged after an update");
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("lessons/debrief.png")).unwrap();

        let staged = stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        assert_eq!(staged.files, 3);
        // Staging alone must not have touched anything of hers.
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "damaged after an update"
        );

        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "her real training record"
        );
        assert_eq!(
            document_contents(&root, "airplane-flying-handbook.pdf").as_deref(),
            Some("chapter nine")
        );
        assert_eq!(
            document_contents(&root, "lessons/debrief.png").as_deref(),
            Some("crosswind notes")
        );

        // And what was there before the restore is still recoverable.
        let rollbacks: Vec<BackupInfo> = list_backups_in(&root)
            .unwrap()
            .into_iter()
            .filter(|backup| backup.name.ends_with("-before-restore"))
            .collect();
        assert_eq!(rollbacks.len(), 1);
        assert!(rollbacks[0].restorable);

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_safety_copy_puts_the_database_back_and_leaves_her_uploads_alone() {
        let root = scratch("safety-copy");
        write_database(&root.join(DB_FILES[0]), "before the update");
        write_document(&root, "handbook.pdf", "still hers");

        // First launch of a new version: a copy is taken before anything opens.
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        let copies = list_backups_in(&root).unwrap();
        assert_eq!(copies.len(), 1);
        let copy = copies[0].name.clone();
        assert!(copy.ends_with("-before-0.3.0"));

        // The update goes badly, and she uploads something else in the meantime.
        write_database(&root.join(DB_FILES[0]), "lost her lessons");
        write_document(&root, "new-checklist.pdf", "added since");

        stage_local_restore_in(&root, &copy).unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "before the update"
        );
        // Her uploads were never in that copy and must not be swept away by it.
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("still hers")
        );
        assert_eq!(
            document_contents(&root, "new-checklist.pdf").as_deref(),
            Some("added since")
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_write_ahead_log_travels_with_the_database() {
        // If a checkpoint could not finish, her newest entries live only in the
        // log. A backup that left it behind would quietly lose them.
        let root = scratch("wal");
        let elsewhere = scratch("wal-out");
        write_database(&root.join(DB_FILES[0]), "checkpointed pages");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute(
                "UPDATE audit_payload SET value = 'pages written since the last checkpoint'",
                [],
            )
            .unwrap();
        assert!(root.join(DB_FILES[1]).is_file());

        let archive = elsewhere.join("with-log.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.files, 2);
        drop(connection);

        let _ = std::fs::remove_file(root.join(DB_FILES[1]));
        write_database(&root.join(DB_FILES[0]), "something else entirely");

        stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "pages written since the last checkpoint"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_damaged_backup_is_refused_before_anything_of_hers_moves() {
        let root = scratch("damaged");
        let elsewhere = scratch("damaged-out");
        // An archive written around a file that is not a database at all.
        std::fs::write(root.join(DB_FILES[0]), b"this is not a database").unwrap();
        let archive = elsewhere.join("damaged.hfdbackup");
        write_complete_backup(&root, &archive, "0.2.0").unwrap();

        write_database(&root.join(DB_FILES[0]), "her real record");
        write_document(&root, "handbook.pdf", "hers");

        assert!(inspect_archive(&root, &archive, "0.2.0").is_err());
        assert!(stage_complete_restore_in(&root, &archive, "0.2.0").is_err());

        // Refused means refused: her current data is exactly as it was.
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "her real record"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("hers")
        );
        assert!(!root.join(RESTORE_PENDING_DIR).exists());
        assert!(!root.join(RESTORE_STAGING_DIR).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn an_archive_carrying_anything_unexpected_is_refused() {
        let elsewhere = scratch("hostile");
        let archive = elsewhere.join("hostile.hfdbackup");

        let file = File::create(&archive).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .unwrap();
        writer
            .write_all(
                serde_json::to_string(&CompleteBackupManifest {
                    format: ARCHIVE_FORMAT.to_string(),
                    format_version: LEGACY_ARCHIVE_VERSION,
                    app_version: "0.2.0".to_string(),
                    created_at: 0,
                    missing_at_export: Vec::new(),
                })
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        writer.start_file(DB_FILES[0], archive_options()).unwrap();
        writer.write_all(SQLITE_MAGIC).unwrap();
        // A restore plan would decide whether her documents get replaced.
        writer.start_file(RESTORE_PLAN, archive_options()).unwrap();
        writer
            .write_all(b"{\"kind\":\"database\",\"source\":\"\"}")
            .unwrap();
        writer.finish().unwrap();

        let refusal = inspect_archive(&elsewhere, &archive, "0.2.0").unwrap_err();
        assert!(refusal.contains("unexpected file"), "{refusal}");

        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_copy_is_taken_whenever_another_version_wrote_the_database() {
        let root = scratch("upgrade");

        // A genuine first run: nothing to copy, but the version is recorded.
        backup_if_upgraded_in(&root, "0.2.0").unwrap();
        assert!(list_backups_in(&root).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(root.join(VERSION_FILE)).unwrap(),
            "0.2.0"
        );

        // Reopening the same version does not pile up copies.
        write_database(&root.join(DB_FILES[0]), "her record");
        backup_if_upgraded_in(&root, "0.2.0").unwrap();
        assert!(list_backups_in(&root).unwrap().is_empty());

        // A new version does.
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert_eq!(list_backups_in(&root).unwrap().len(), 1);

        // And so does a database whose version we have no record of, which is
        // the case where we know least about what wrote it.
        std::fs::remove_file(root.join(VERSION_FILE)).unwrap();
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert_eq!(list_backups_in(&root).unwrap().len(), 2);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_backup_cannot_be_saved_inside_the_folder_it_is_protecting() {
        // A backup that lives inside the data folder is lost with it.
        let root = scratch("inside");
        write_database(&root.join(DB_FILES[0]), "her record");

        let refusal =
            write_complete_backup(&root, &root.join("copy.hfdbackup"), "0.2.0").unwrap_err();
        assert!(refusal.contains("outside"), "{refusal}");

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn restored_files_are_hashed_from_exactly_the_bytes_written() {
        let root = scratch("copy-and-hash");
        let content: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let destination = root.join("restored.pdf");
        let mut output = File::create(&destination).unwrap();
        let (bytes, sha) = copy_and_hash(&mut content.as_slice(), &mut output).unwrap();
        output.sync_all().unwrap();
        drop(output);

        assert_eq!(bytes, content.len() as u64);
        assert_eq!(std::fs::read(&destination).unwrap(), content);
        assert_eq!(sha, hex::encode(Sha256::digest(&content)));

        let mut changed = content.clone();
        changed[100_000] ^= 1;
        let mut other = File::create(root.join("changed.pdf")).unwrap();
        let (_, changed_sha) = copy_and_hash(&mut changed.as_slice(), &mut other).unwrap();
        assert_ne!(changed_sha, sha);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_same_size_content_change_fails_the_integrity_check() {
        let root = scratch("checksum");
        let elsewhere = scratch("checksum-out");
        write_database(&root.join(DB_FILES[0]), "training record");
        write_document(&root, "handbook.pdf", "original bytes");
        let archive = elsewhere.join("checked.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        rewrite_entry(&archive, "documents/handbook.pdf", b"tampered bytes");
        let error = inspect_archive(&root, &archive, "0.5.1").unwrap_err();
        assert!(error.contains("integrity check"), "{error}");
        assert!(stage_complete_restore_in(&root, &archive, "0.5.1").is_err());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_format_version_one_backup_still_restores() {
        let root = scratch("legacy-v1");
        let elsewhere = scratch("legacy-v1-out");
        write_database(&root.join(DB_FILES[0]), "from version one");
        let archive = elsewhere.join("legacy.hfdbackup");
        write_legacy_backup(&root, &archive, "0.5.1");
        write_database(&root.join(DB_FILES[0]), "current");

        stage_complete_restore_in(&root, &archive, "0.5.1").unwrap();
        apply_pending_restore_in(&root).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "from version one"
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_valid_sqlite_file_with_the_wrong_schema_is_refused() {
        let root = scratch("wrong-schema");
        let elsewhere = scratch("wrong-schema-out");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .execute("CREATE TABLE somebody_elses_data (value TEXT)", [])
            .unwrap();
        drop(connection);
        let archive = elsewhere.join("wrong-schema.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        let error = stage_complete_restore_in(&root, &archive, "0.5.1").unwrap_err();
        assert!(error.contains("missing settings"), "{error}");
        assert!(!root.join(RESTORE_PENDING_DIR).exists());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn an_online_snapshot_includes_committed_wal_changes() {
        let root = scratch("online-snapshot");
        write_database(&root.join(DB_FILES[0]), "before");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute("UPDATE audit_payload SET value = 'after'", [])
            .unwrap();

        let snapshot = database_snapshot(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "after");
        verify_application_database(&snapshot).unwrap();

        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_transient_lock_during_snapshot_clears_and_the_backup_still_completes() {
        let root = scratch("snapshot-transient-lock");
        write_database(&root.join(DB_FILES[0]), "before the lock");

        let locker = Connection::open(root.join(DB_FILES[0])).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();
        // Held briefly on another thread — long enough that the snapshot's
        // own read has to wait for it, short enough that the busy timeout
        // (and, if that were not enough, the bounded retry around the whole
        // snapshot) comfortably outlasts it. This is the same shape of
        // collision as an ordinary autosave or a split saving its parts
        // landing at the same moment as a backup.
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            locker.execute("COMMIT", []).unwrap();
        });

        let snapshot = database_snapshot_with_retry(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "before the lock");

        handle.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_lock_that_never_clears_fails_the_snapshot_boundedly_with_a_plain_message() {
        let root = scratch("snapshot-permanent-lock");
        write_database(&root.join(DB_FILES[0]), "locked forever");

        let locker = Connection::open(root.join(DB_FILES[0])).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();

        let started = std::time::Instant::now();
        let error = database_snapshot_with_retry(&root).unwrap_err();
        let elapsed = started.elapsed();

        assert!(error.contains("busy"), "{error}");
        // Bounded by (SNAPSHOT_LOCK_RETRIES + 1) attempts, each capped at
        // BUSY_TIMEOUT — not an unlimited or open-ended wait, however long a
        // real lock happens to be held.
        assert!(
            elapsed < Duration::from_secs(40),
            "gave up after {elapsed:?}, longer than the configured bound allows"
        );

        locker.execute("ROLLBACK", []).unwrap();
        drop(locker);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_valid_backup_still_passes_its_own_finished_archive_check() {
        let root = scratch("verified-finish");
        let elsewhere = scratch("verified-finish-out");
        write_database(&root.join(DB_FILES[0]), "her real record");
        let archive = elsewhere.join("verified.hfdbackup");

        let info = write_complete_backup_from_database(
            &root,
            &archive,
            "0.2.0",
            &root.join(DB_FILES[0]),
            false,
            true,
            None,
        )
        .unwrap();
        assert!(archive.is_file());
        assert_eq!(info.app_version, "0.2.0");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_failed_rewrite_leaves_an_existing_backup_exactly_as_it_was() {
        let root = scratch("preserve-existing");
        let elsewhere = scratch("preserve-existing-out");
        write_database(&root.join(DB_FILES[0]), "the real record");
        let archive = elsewhere.join("her-flight-deck.hfdbackup");

        // A first, successful backup already exists at the destination.
        write_complete_backup(&root, &archive, "0.2.0").unwrap();
        let original_bytes = std::fs::read(&archive).unwrap();

        // A second attempt whose database is damaged must fail its
        // pre-rename integrity check — and never touch the file already
        // sitting at the destination.
        std::fs::write(root.join(DB_FILES[0]), b"not a database").unwrap();
        let result = write_complete_backup_from_database(
            &root,
            &archive,
            "0.2.0",
            &root.join(DB_FILES[0]),
            false,
            true,
            None,
        );
        assert!(result.is_err());

        assert_eq!(std::fs::read(&archive).unwrap(), original_bytes);
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());
        assert!(!PathBuf::from(format!("{}.replaced", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn archive_names_reject_windows_streams_and_excessive_lengths() {
        assert!(validate_archive_path(
            "documents/handbook.pdf",
            Path::new("documents/handbook.pdf")
        )
        .is_ok());
        assert!(validate_archive_path(
            "documents/handbook.pdf:hidden",
            Path::new("documents/handbook.pdf:hidden")
        )
        .is_err());
        let long = format!(
            "documents/{}.pdf",
            "x".repeat(MAX_ARCHIVE_COMPONENT_BYTES + 1)
        );
        assert!(validate_archive_path(&long, Path::new(&long)).is_err());
    }

    #[test]
    fn extreme_compression_ratios_are_refused() {
        assert!(validate_compression_ratio(1024, 1).is_ok());
        assert!(validate_compression_ratio(2 * 1024 * 1024, 1024).is_err());
        assert!(validate_compression_ratio(2 * 1024 * 1024, 0).is_err());
    }

    #[test]
    fn an_install_failure_after_protection_restores_current_data() {
        let root = scratch("install-rollback");
        let elsewhere = scratch("install-rollback-out");
        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("rollback.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        write_database(&root.join(DB_FILES[0]), "current data");
        write_document(&root, "handbook.pdf", "current document");
        stage_complete_restore_in(&root, &archive, "0.5.1").unwrap();

        let error = apply_pending_restore_in_with(&root, || {
            Err("injected failure before install".to_string())
        })
        .unwrap_err();
        assert!(error.contains("previous data was recovered"), "{error}");
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "current data");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("current document")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_referenced_file_disappearing_after_the_database_snapshot_is_refused() {
        let root = scratch("disappearing-doc");
        let elsewhere = scratch("disappearing-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("disappearing.hfdbackup");

        let pre_docs = scan_active_documents(&root.join(DOCUMENTS_DIR)).unwrap();
        let snapshot = database_snapshot_with_retry(&root).unwrap();

        // The referenced document is deleted after the snapshot and before collection
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap();

        let result = write_complete_backup_from_database(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            Some(&pre_docs),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when referenced file disappeared after snapshot"
        );
        match result.unwrap_err() {
            BackupExportError::Transient(err) => {
                assert!(
                    err.contains("disappeared") || err.contains("handbook.pdf"),
                    "Expected transient disappearance error, got: {err}"
                );
            }
            BackupExportError::Permanent(err) => {
                panic!("Expected Transient error, got Permanent: {err}");
            }
        }
        assert!(!archive.exists());
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_referenced_file_disappearing_during_collection_is_refused() {
        let root = scratch("disappearing-mid-doc");
        let elsewhere = scratch("disappearing-mid-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("disappearing-mid.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                let _ = std::fs::remove_file(root_for_hook.join(DOCUMENTS_DIR).join(doc_name));
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when referenced file disappeared during collection"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("disappeared")
                || err.contains("missing")
                || err.contains("Could not read")
                || err.contains("changed"),
            "Expected disappearance/change error, got: {err}"
        );
        assert!(!archive.exists());
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_new_import_or_split_appearing_after_the_snapshot_is_refused() {
        let root = scratch("extra-doc");
        let elsewhere = scratch("extra-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("extra.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        // A new import or split part appears on disk while export is in flight
        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                std::fs::write(
                    root_for_hook.join(DOCUMENTS_DIR).join("part-2.pdf"),
                    "split part 2",
                )
                .unwrap();
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when extra unreferenced document appeared during export"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("changed on disk") || err.contains("changed"),
            "Expected in-flight change error, got: {err}"
        );
        assert!(!archive.exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_document_changing_during_collection_is_detected_and_refused() {
        let root = scratch("changing-doc");
        let elsewhere = scratch("changing-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "initial content");
        let archive = elsewhere.join("changing.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                let doc_path = root_for_hook.join(DOCUMENTS_DIR).join(doc_name);
                std::fs::write(doc_path, "modified content during read").unwrap();
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when document changed during collection"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("changed during export") || err.contains("changed on disk"),
            "Expected change error, got: {err}"
        );
        assert!(!archive.exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_failed_retry_leaves_an_existing_valid_backup_untouched() {
        let root = scratch("failed-retry-preserve");
        let elsewhere = scratch("failed-retry-preserve-out");
        write_database(&root.join(DB_FILES[0]), "stable db");
        write_document(&root, "handbook.pdf", "stable document");
        let archive = elsewhere.join("valid-backup.hfdbackup");

        // 1. Create a valid initial backup
        create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert!(archive.is_file());
        let original_bytes = std::fs::read(&archive).unwrap();

        // 2. Now simulate a persistent failure: remove the database
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();

        // 3. Running complete backup should exhaust bounded retries and fail
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(
            result.is_err(),
            "Backup must fail when database snapshot persistently fails"
        );

        // 4. Verify existing backup at destination is completely untouched and intact
        assert_eq!(std::fs::read(&archive).unwrap(), original_bytes);
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());
        assert!(!PathBuf::from(format!("{}.replaced", archive.to_string_lossy())).exists());

        // And it still passes inspection
        inspect_archive(&root, &archive, "0.5.2").unwrap();

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_stable_database_and_document_set_exports_and_restores_successfully() {
        let root = scratch("stable-export-restore");
        let elsewhere = scratch("stable-export-restore-out");
        let restore_target = scratch("stable-export-restore-target");
        write_database(&root.join(DB_FILES[0]), "production training record");
        write_document(&root, "handbook.pdf", "chapter 1");
        write_document(&root, "lessons/brief.png", "briefing notes");
        let archive = elsewhere.join("stable.hfdbackup");

        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.files, 3); // db + 2 documents
        assert!(archive.is_file());

        // Proves format-v2 database and document completeness verification passes
        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(inspected.files, 3);

        // Proves restore extracts cleanly
        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 3);
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DB_FILES[0])
            .is_file());
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DOCUMENTS_DIR)
            .join("lessons/brief.png")
            .is_file());

        apply_pending_restore_in(&restore_target).unwrap();
        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("lessons/brief.png")
            .is_file());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn format_v3_inspection_proves_database_and_document_completeness() {
        let root = scratch("completeness-test");
        let elsewhere = scratch("completeness-test-out");
        write_database(&root.join(DB_FILES[0]), "db record");
        write_document(&root, "handbook.pdf", "chapter 1");
        let archive = elsewhere.join("incomplete.hfdbackup");

        // Craft an archive where the document is missing from the archive but in DB
        let db_with_ref = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);
        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();
        let saved_db = add_file_to_archive(&mut zip, &db_with_ref, DB_FILES[0]).unwrap();
        let integrity = vec![saved_db];
        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // Database references handbook.pdf, but archive contains NO documents.
        // Format-v3 inspection MUST refuse this archive!
        let error = inspect_archive(&root, &archive, "0.5.2").unwrap_err();
        assert!(
            error.contains("missing from the archive"),
            "Expected missing document completeness error, got: {error}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn export_with_missing_referenced_file_succeeds_and_restores_cleanly() {
        let root = scratch("missing-doc-export");
        let elsewhere = scratch("missing-doc-export-out");
        let restore_target = scratch("missing-doc-export-target");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook bytes");

        // Reference a missing file in the database without creating it in documents/
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, file_path) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params!["missing-notes.pdf", "missing-notes.pdf"],
        )
        .unwrap();
        drop(conn);

        let archive = elsewhere.join("missing.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(
            info.missing_documents,
            vec!["missing-notes.pdf".to_string()]
        );
        assert_eq!(info.files, 2); // db + handbook.pdf

        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(
            inspected.missing_documents,
            vec!["missing-notes.pdf".to_string()]
        );
        assert_eq!(inspected.files, 2);

        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 2);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("missing-notes.pdf")
            .exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn export_with_unreferenced_orphan_file_succeeds_and_excludes_orphan() {
        let root = scratch("orphan-doc-export");
        let elsewhere = scratch("orphan-doc-export-out");
        let restore_target = scratch("orphan-doc-export-target");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook bytes");

        // Create an unreferenced file directly on disk without referencing it in DB
        std::fs::write(
            root.join(DOCUMENTS_DIR).join("orphan.pdf"),
            "unreferenced bytes",
        )
        .unwrap();

        let archive = elsewhere.join("orphan.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.unreferenced_documents, vec!["orphan.pdf".to_string()]);
        assert_eq!(info.files, 2); // db + handbook.pdf (orphan excluded)

        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(inspected.files, 2);

        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 2);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("orphan.pdf")
            .exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn export_refuses_referenced_document_with_deletion_in_progress_and_retries_transiently() {
        let root = scratch("deletion-in-progress-export");
        let elsewhere = scratch("deletion-in-progress-export-out");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "in progress deletion test");

        // Insert reference into database but do not create file in documents/
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'staged-doc.pdf')",
                [],
            )
            .unwrap();
        }

        // Stage the document in documents/.trash
        let trash = root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("del-1.data"), "staged file content").unwrap();
        let meta = crate::documents::StagedDeletion {
            staged_id: "del-1".to_string(),
            original_relative_path: "staged-doc.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(
            trash.join("del-1.meta"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        let archive = elsewhere.join("in-progress.hfdbackup");

        // 1. Single attempt: a referenced file that exists only as a staged .data+.meta in .trash
        // causes the attempt to return Transient
        let single_attempt = write_complete_backup_from_database(
            &root, &archive, "0.5.2", &db_path, false, true, None,
        );
        match single_attempt {
            Err(BackupExportError::Transient(msg)) => {
                assert!(
                    msg.contains("deletion was in progress"),
                    "Expected transient message explaining deletion in progress, got: {msg}"
                );
            }
            other => panic!("Expected Transient error, got: {other:?}"),
        }

        // 2. Full export with retry: when the staged deletion persists across all retries,
        // the final error explains that a deletion was in progress.
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(result.is_err(), "Export must fail across retries");
        let err = result.unwrap_err();
        assert!(
            err.contains("deletion was in progress"),
            "Final error must explain deletion was in progress, got: {err}"
        );
        assert!(!archive.exists(), "Archive must not exist on failure");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn export_refuses_referenced_document_when_trash_metadata_is_corrupt_and_retries_transiently() {
        let root = scratch("corrupt-trash-meta-export");
        let elsewhere = scratch("corrupt-trash-meta-export-out");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "corrupt trash metadata test");

        // Reference a document in the database that is not in documents/
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'staged-doc.pdf')",
                [],
            )
            .unwrap();
        }

        // Stage file in trash but with corrupt/malformed metadata
        let trash = root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("del-1.data"), "staged document bytes").unwrap();
        std::fs::write(trash.join("del-1.meta"), "{ malformed json: not valid }").unwrap();

        let archive = elsewhere.join("corrupt-meta.hfdbackup");

        // 1. Single attempt: fails with Transient error when trash cannot be inspected reliably
        let single_attempt = write_complete_backup_from_database(
            &root, &archive, "0.5.2", &db_path, false, true, None,
        );
        match single_attempt {
            Err(BackupExportError::Transient(msg)) => {
                assert!(
                    msg.contains("staged deletion metadata"),
                    "Expected transient error indicating metadata problem, got: {msg}"
                );
            }
            other => panic!("Expected Transient error, got: {other:?}"),
        }

        // 2. Full export with retry: fails safely and boundedly, with no archive finalized
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(result.is_err(), "Export must fail across retries");
        let err = result.unwrap_err();
        assert!(
            err.contains("staged deletion metadata"),
            "Final error must explain metadata inspection failure, got: {err}"
        );
        assert!(!archive.exists(), "Archive must not exist on failure");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn format_v2_with_unreferenced_document_inspects_and_restores_cleanly() {
        let root = scratch("v2-unreferenced-restore");
        let elsewhere = scratch("v2-unreferenced-restore-out");
        let restore_target = scratch("v2-unreferenced-restore-target");
        write_database(&root.join(DB_FILES[0]), "valid v2 db");
        write_document(&root, "handbook.pdf", "handbook contents");

        // Create an unreferenced file on disk
        let orphan_path = root.join(DOCUMENTS_DIR).join("unreferenced.pdf");
        std::fs::write(&orphan_path, "old style unreferenced document in v2").unwrap();

        let archive = elsewhere.join("old-v2.hfdbackup");

        // Construct a valid v2 archive containing both handbook.pdf and unreferenced.pdf
        let db_path = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: V2_ARCHIVE_VERSION,
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        let saved_orphan =
            add_file_to_archive(&mut zip, &orphan_path, "documents/unreferenced.pdf").unwrap();
        integrity.push(saved_orphan);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // 1. Proves inspection succeeds for valid old-style v2 archive with an unreferenced document
        let info = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.files, 3); // db + handbook.pdf + unreferenced.pdf
        assert_eq!(
            info.unreferenced_documents,
            vec!["unreferenced.pdf".to_string()]
        );

        // 2. Proves restore succeeds
        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 3);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("unreferenced.pdf")
            .is_file());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn format_v3_with_unreferenced_document_fails_inspection() {
        let root = scratch("v3-unreferenced-inspection");
        let elsewhere = scratch("v3-unreferenced-inspection-out");
        write_database(&root.join(DB_FILES[0]), "valid v3 db");
        write_document(&root, "handbook.pdf", "handbook contents");

        let orphan_path = root.join(DOCUMENTS_DIR).join("unreferenced.pdf");
        std::fs::write(&orphan_path, "unreferenced document in v3").unwrap();

        let archive = elsewhere.join("v3-with-unreferenced.hfdbackup");
        let db_path = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION, // v3
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        let saved_orphan =
            add_file_to_archive(&mut zip, &orphan_path, "documents/unreferenced.pdf").unwrap();
        integrity.push(saved_orphan);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        let err = inspect_archive(&root, &archive, "0.5.2").unwrap_err();
        assert!(
            err.contains("contains an unreferenced document: unreferenced.pdf"),
            "Expected unreferenced document error, got: {err}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn old_style_format_v2_with_missing_referenced_document_inspects_and_restores_with_warning() {
        let root = scratch("old-v2-missing-doc-root");
        let elsewhere = scratch("old-v2-missing-doc-out");
        let restore_target = scratch("old-v2-missing-doc-target");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "old v2 with missing doc");

        let connection = Connection::open(&db_path).unwrap();
        connection
            .execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('mat-1', 'present.pdf')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('mat-2', 'missing.pdf')",
                [],
            )
            .unwrap();
        drop(connection);

        let present_content = "content of present file";
        write_document(&root, "present.pdf", present_content);

        // 1. Construct an old-style format-v2 archive:
        // - formatVersion: 2
        // - NO missing_at_export field in manifest.json
        // - Valid integrity.json containing records for the files present in the archive
        // - Database references missing.pdf which is NOT in the archive
        let old_v2_archive = elsewhere.join("old-v2-missing.hfdbackup");
        let output = File::create(&old_v2_archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let old_manifest_json = r#"{
  "format": "her-flight-deck-complete-backup",
  "formatVersion": 2,
  "appVersion": "0.5.1",
  "createdAt": 1700000000
}"#;
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(old_manifest_json.as_bytes()).unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("present.pdf"),
            "documents/present.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // 2. Prove inspection succeeds and discloses the missing reference in restore info
        let info = inspect_archive(&root, &old_v2_archive, "0.5.2")
            .expect("old-style v2 archive must inspect successfully");
        assert_eq!(info.files, 2); // her-flight-deck.db + documents/present.pdf
        assert_eq!(info.missing_documents, vec!["missing.pdf".to_string()]);

        // 3. Prove restore succeeds and present files retain their exact bytes
        let staged = stage_complete_restore_in(&restore_target, &old_v2_archive, "0.5.2")
            .expect("old-style v2 archive must stage successfully");
        assert_eq!(staged.files, 2);
        assert_eq!(staged.missing_documents, vec!["missing.pdf".to_string()]);

        apply_pending_restore_in(&restore_target)
            .expect("old-style v2 archive must apply successfully");
        assert!(restore_target.join(DB_FILES[0]).is_file());
        let restored_present = restore_target.join(DOCUMENTS_DIR).join("present.pdf");
        assert!(restored_present.is_file());
        let read_back = std::fs::read_to_string(&restored_present).unwrap();
        assert_eq!(read_back, present_content);
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("missing.pdf")
            .exists());

        // 4. Prove a newly created archive (v3) that unexpectedly omits a referenced file fails validation
        let new_v3_archive = elsewhere.join("new-v3-unexpected-omission.hfdbackup");
        let output = File::create(&new_v3_archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let new_manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION, // 3
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(), // unexpectedly undeclared omission!
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&new_manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity_v3 = Vec::new();
        let saved_db_v3 = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity_v3.push(saved_db_v3);
        let saved_doc_v3 = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("present.pdf"),
            "documents/present.pdf",
        )
        .unwrap();
        integrity_v3.push(saved_doc_v3);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity_v3,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        let err = inspect_archive(&root, &new_v3_archive, "0.5.2").expect_err(
            "new archive omitting referenced file without declaration must fail validation",
        );
        assert!(
            err.contains("missing from the archive"),
            "Expected completeness error, got: {err}"
        );
        assert!(
            err.contains("missing.pdf"),
            "Expected mention of missing.pdf, got: {err}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn audit_failed_rollback_must_retain_original_database() {
        let root = scratch("audit-failed-rollback");
        let elsewhere = scratch("audit-failed-rollback-out");
        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("rollback.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current data");
        write_document(&root, "handbook.pdf", "current document");

        let current_db_bytes = std::fs::read(root.join(DB_FILES[0])).unwrap();
        let current_db_hash = sha256_digest(&current_db_bytes);
        let current_doc_bytes =
            std::fs::read(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap();
        let current_doc_hash = sha256_digest(&current_doc_bytes);

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        let error = apply_pending_restore_in_with(&root, || {
            std::fs::create_dir(root.join(DB_FILES[0])).unwrap();
            Err("injected install failure and rollback destination obstruction".to_string())
        })
        .unwrap_err();

        // 1. Error message must NOT claim previous data was recovered
        assert!(
            !error.contains("previous data was recovered"),
            "Error falsely claimed recovery succeeded when destination was obstructed: {error}"
        );

        // 2. The original database and documents must be retained in an identifiable recovery location
        let mut original_db_retained = false;
        let mut original_doc_retained = false;
        if let Ok(entries) = std::fs::read_dir(root.join(BACKUP_DIR)) {
            for entry in entries.filter_map(Result::ok) {
                let db_path = entry.path().join(DB_FILES[0]);
                if db_path.is_file() {
                    let bytes = std::fs::read(&db_path).unwrap();
                    if sha256_digest(&bytes) == current_db_hash {
                        original_db_retained = true;
                    }
                }
                let doc_path = entry.path().join(DOCUMENTS_DIR).join("handbook.pdf");
                if doc_path.is_file() {
                    let bytes = std::fs::read(&doc_path).unwrap();
                    if sha256_digest(&bytes) == current_doc_hash {
                        original_doc_retained = true;
                    }
                }
            }
        }

        assert!(
            original_db_retained,
            "Failed rollback must keep the original database in an identifiable recovery location with matching hash"
        );
        assert!(
            original_doc_retained,
            "Failed rollback must keep the original documents in an identifiable recovery location with matching hash"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn audit_document_return_obstruction_retains_document_and_db_wal() {
        let root = scratch("doc-obstruction-test");
        let elsewhere = scratch("doc-obstruction-out");

        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("backup.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        write_document(&root, "handbook.pdf", "current active document");
        let orig_doc_hash =
            sha256_digest(&std::fs::read(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap());

        let source = scratch("doc-obstruction-source");
        write_database(&source.join(DB_FILES[0]), "current active data");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute("UPDATE audit_payload SET value = 'active wal data'", [])
            .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        for name in DB_FILES {
            if source.join(name).is_file() {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
        }
        let orig_db_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let orig_wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());
        drop(conn);
        std::fs::remove_dir_all(&source).unwrap();
        assert!(root.join(DB_FILES[1]).is_file());

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        // Obstruct document return during rollback by creating an unexpected file at documents/
        let error = apply_pending_restore_in_with(&root, || {
            // Create a conflicting file at root/documents path so rollback cannot return documents
            std::fs::write(root.join(DOCUMENTS_DIR), b"blocking document return").unwrap();
            Err("injected install failure with doc return obstruction".to_string())
        })
        .unwrap_err();

        assert!(!error.contains("previous data was recovered"), "{error}");
        assert!(
            error.contains("recovery rollback could not return original data"),
            "{error}"
        );

        // Original database, WAL, and documents must be retained in the rollback directory
        let mut found_db = false;
        let mut found_wal = false;
        let mut found_doc = false;
        let backups = list_backups_in(&root).unwrap();
        assert!(!backups.is_empty());
        for b in backups {
            let p = PathBuf::from(b.path);
            let db_file = p.join(DB_FILES[0]);
            if db_file.is_file() && sha256_digest(&std::fs::read(&db_file).unwrap()) == orig_db_hash
            {
                found_db = true;
            }
            let wal_file = p.join(DB_FILES[1]);
            if wal_file.is_file()
                && sha256_digest(&std::fs::read(&wal_file).unwrap()) == orig_wal_hash
            {
                found_wal = true;
            }
            let doc_file = p.join(DOCUMENTS_DIR).join("handbook.pdf");
            if doc_file.is_file()
                && sha256_digest(&std::fs::read(&doc_file).unwrap()) == orig_doc_hash
            {
                found_doc = true;
            }
        }
        assert!(
            found_db,
            "Protected DB must be preserved with exact original hash"
        );
        assert!(
            found_wal,
            "Protected WAL must be preserved with exact original hash"
        );
        assert!(
            found_doc,
            "Protected documents must be preserved with exact original hash"
        );

        // Startup decision on this obstructed state must be BlockedUnresolved
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::BlockedUnresolved {
                reason,
                recovery_folder,
            } => {
                assert!(recovery_folder.is_some());
                assert!(reason.contains("recovery rollback could not return original data"));
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_failure_after_partial_protection_and_partial_install() {
        let root = scratch("partial-prot-inst");
        let elsewhere = scratch("partial-prot-inst-out");

        // Subtest A: Failure during protection returns whatever moved
        write_database(&root.join(DB_FILES[0]), "active original db");
        write_document(&root, "handbook.pdf", "active original doc");

        let rollback = root.join("backups").join("before-restore-test");
        std::fs::create_dir_all(&rollback).unwrap();
        // Move db to rollback as if protection partially completed
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-test".to_string(), true);
        journal.protected_db_files.push(DB_FILES[0].to_string());
        journal
            .original_db_artifacts
            .push(round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0]));
        journal.protected_documents = false; // documents were not moved yet
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentWithContent);
        journal.original_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        journal.phase = RestorePhase::Protecting;
        write_journal(&root, &journal).unwrap();

        // Rollback should put the database back into root
        execute_rollback(&root, &mut journal).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "active original db"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("active original doc")
        );

        // Subtest B: Failure after DB is installed from pending
        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "handbook.pdf", "backup doc");
        let archive = elsewhere.join("backup.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        write_database(&root.join(DB_FILES[0]), "active db v2");
        write_document(&root, "handbook.pdf", "active doc v2");
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        // Simulate protection done
        let rollback2 = root.join("backups").join("before-restore-test2");
        std::fs::create_dir_all(&rollback2).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback2.join(DB_FILES[0])).unwrap();
        std::fs::rename(root.join(DOCUMENTS_DIR), rollback2.join(DOCUMENTS_DIR)).unwrap();

        // Simulate DB installed from pending
        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();

        let mut journal2 = RestoreJournal::new("backups/before-restore-test2".to_string(), true);
        journal2.protected_db_files.push(DB_FILES[0].to_string());
        journal2.original_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(rollback2.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(rollback2.join(DB_FILES[0]))
                .unwrap()
                .len(),
        });
        journal2.protected_documents = true;
        journal2.original_documents_presence = Some(OriginalDocumentsPresence::PresentWithContent);
        journal2.original_document_artifacts =
            inventory_directory_artifacts(&rollback2.join(DOCUMENTS_DIR)).unwrap();
        journal2.installed_db_files.push(DB_FILES[0].to_string());
        journal2.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        });
        journal2.phase = RestorePhase::Activating;
        write_journal(&root, &journal2).unwrap();

        // Rollback should uninstall installed db and return original db and documents
        execute_rollback(&root, &mut journal2).unwrap();
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db v2");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("active doc v2")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_db_wal_shm_documents_never_silently_mixed() {
        let root = scratch("no-silent-mix");
        let elsewhere = scratch("no-silent-mix-out");

        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "handbook.pdf", "backup doc");
        let archive = elsewhere.join("archive.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        // Active dataset with distinct DB, WAL, SHM, and documents
        write_database(&root.join(DB_FILES[0]), "original active db");
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original active db in wal'",
            [],
        )
        .unwrap();
        drop(conn);
        write_document(&root, "handbook.pdf", "original active doc");

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        let err =
            apply_pending_restore_in_with(&root, || Err("injected install error".to_string()))
                .unwrap_err();

        assert!(err.contains("previous data was recovered"), "{err}");

        // Check active files are 100% original dataset
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original active db in wal"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("original active doc")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_successful_complete_and_database_only_restores_keep_contracts() {
        let root = scratch("contracts-test");
        let elsewhere = scratch("contracts-out");

        // 1. Complete restore replaces DB and documents
        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "doc.pdf", "backup doc");
        let complete_archive = elsewhere.join("complete.hfdbackup");
        write_complete_backup(&root, &complete_archive, "0.5.3").unwrap();

        write_database(&root.join(DB_FILES[0]), "active db");
        write_document(&root, "doc.pdf", "active doc");
        stage_complete_restore_in(&root, &complete_archive, "0.5.3").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(database_contents(&root.join(DB_FILES[0])), "backup db");
        assert_eq!(
            document_contents(&root, "doc.pdf").as_deref(),
            Some("backup doc")
        );

        // 2. Safety copy (database-only restore) replaces database but preserves existing documents
        write_database(&root.join(DB_FILES[0]), "safety db");
        let safety_folder = root.join("backups").join("manual-safety-test");
        std::fs::create_dir_all(&safety_folder).unwrap();
        std::fs::copy(root.join(DB_FILES[0]), safety_folder.join(DB_FILES[0])).unwrap();

        write_database(&root.join(DB_FILES[0]), "active db 2");
        write_document(&root, "user-upload.pdf", "preserve my document");

        stage_local_restore_in(&root, "manual-safety-test").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(database_contents(&root.join(DB_FILES[0])), "safety db");
        assert_eq!(
            document_contents(&root, "user-upload.pdf").as_deref(),
            Some("preserve my document")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_pruning_cannot_discard_unresolved_recovery_folder() {
        let root = scratch("pruning-retention");
        let bdir = root.join("backups");
        std::fs::create_dir_all(&bdir).unwrap();

        // Create 15 regular backup folders
        for i in 1..=15 {
            let folder = bdir.join(format!("2026-09-01-{i:02}0000-auto"));
            std::fs::create_dir_all(&folder).unwrap();
            write_database(&folder.join(DB_FILES[0]), &format!("auto db {i}"));
        }

        // Create an unresolved recovery rollback folder with an older timestamp
        let recovery_folder = bdir.join("2026-08-01-000000-before-restore");
        std::fs::create_dir_all(&recovery_folder).unwrap();
        write_database(&recovery_folder.join(DB_FILES[0]), "precious original db");
        write_document(&recovery_folder, "notes.pdf", "precious notes");
        std::fs::write(recovery_folder.join(".recovery-pending"), b"pending").unwrap();

        // Also record a journal referencing it
        let journal = RestoreJournal {
            operation_id: "op-prune-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/2026-08-01-000000-before-restore".to_string(),
            replace_documents: true,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: true,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("test obstruction".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Run prune
        prune(&root).unwrap();

        // The precious recovery folder MUST NOT be pruned!
        assert!(
            recovery_folder.exists(),
            "Pruning must never delete unresolved recovery folder"
        );
        assert_eq!(
            database_contents(&recovery_folder.join(DB_FILES[0])),
            "precious original db"
        );
        assert_eq!(
            document_contents(&recovery_folder, "notes.pdf").as_deref(),
            Some("precious notes")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_interrupted_states_resume_safely_on_startup() {
        let root = scratch("interrupted-states");

        // Case 1: Interrupted at Protected state
        write_database(&root.join(DB_FILES[0]), "active db");
        let rollback1 = root.join("backups").join("before-restore-case1");
        std::fs::create_dir_all(&rollback1).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback1.join(DB_FILES[0])).unwrap();

        let journal1 = RestoreJournal {
            operation_id: "op-interrupted-case1".to_string(),
            phase: RestorePhase::Protected,
            rollback_rel_path: "backups/before-restore-case1".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: sha256_digest(&std::fs::read(rollback1.join(DB_FILES[0])).unwrap()),
                size: std::fs::metadata(rollback1.join(DB_FILES[0]))
                    .unwrap()
                    .len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal1).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        // Case 2: Interrupted at Activating state after DB installed
        let rollback2 = root.join("backups").join("before-restore-case2");
        std::fs::create_dir_all(&rollback2).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback2.join(DB_FILES[0])).unwrap();
        write_database(&root.join(DB_FILES[0]), "partially installed db");

        let orig_ident2 = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(rollback2.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(rollback2.join(DB_FILES[0]))
                .unwrap()
                .len(),
        };
        let staged_ident2 = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        };
        let journal2 = RestoreJournal {
            operation_id: "op-interrupted-case2".to_string(),
            phase: RestorePhase::Activating,
            rollback_rel_path: "backups/before-restore-case2".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![DB_FILES[0].to_string()],
            installed_documents: false,
            original_db_artifacts: vec![orig_ident2],
            staged_db_artifacts: vec![staged_ident2],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal2).unwrap();

        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db");

        // Case 3: Interrupted at Committed state with pending cleanup lingering
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join("leftover.tmp"), b"leftover").unwrap();
        let plan3 = RestorePlan {
            operation_id: "op-interrupted-case3".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan3).unwrap(),
        )
        .unwrap();

        let journal3 = RestoreJournal {
            operation_id: "op-interrupted-case3".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-case3".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal3).unwrap();

        let decision3 = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision3, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_repeated_startup_on_unresolved_recovery_is_idempotent() {
        let root = scratch("repeated-startup");
        write_database(&root.join(DB_FILES[0]), "original active db");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let rollback = root.join("backups").join("before-restore-repeat");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        // Obstruct root destination
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap();

        let journal = RestoreJournal {
            operation_id: "op-repeat-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-repeat".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: orig_hash.clone(),
                size: std::fs::metadata(rollback.join(DB_FILES[0])).unwrap().len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstructed".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Call 3 times
        for _ in 0..3 {
            let decision = handle_startup_restore_in(&root).unwrap();
            match decision {
                StartupRestoreDecision::BlockedUnresolved {
                    recovery_folder, ..
                } => {
                    assert_eq!(recovery_folder.as_ref(), Some(&rollback));
                }
                other => panic!("Expected BlockedUnresolved, got {other:?}"),
            }
            // Verify original file in rollback remains untouched
            let current_hash = sha256_digest(&std::fs::read(rollback.join(DB_FILES[0])).unwrap());
            assert_eq!(current_hash, orig_hash);
        }

        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_recovery_completes_after_obstruction_removed() {
        let root = scratch("obstruction-cleared");
        write_database(&root.join(DB_FILES[0]), "my active db before crash");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let rollback = root.join("backups").join("before-restore-clear");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        // Inject obstruction
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap();

        let journal = RestoreJournal {
            operation_id: "op-clear-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-clear".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: orig_hash.clone(),
                size: std::fs::metadata(rollback.join(DB_FILES[0])).unwrap().len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstructed".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Launch fails while obstruction present
        let decision1 = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision1,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        // User or remediation removes the obstruction
        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();

        // Next launch recovers automatically and safely
        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }

        assert!(root.join(DB_FILES[0]).is_file());
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "my active db before crash"
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_malformed_journal_handled_conservatively() {
        let root = scratch("malformed-journal");

        // 1. Path traversal attempt
        let journal_traversal = r#"{
            "phase": "UnresolvedRecovery",
            "rollback_rel_path": "../../evil",
            "replace_documents": false,
            "protected_db_files": ["her-flight-deck.db"],
            "protected_documents": false,
            "installed_db_files": [],
            "installed_documents": false,
            "failure_reason": null
        }"#;
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), journal_traversal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::BlockedUnresolved { reason, .. } => {
                assert!(
                    reason.contains("validation failed")
                        || reason.contains("Invalid rollback path"),
                    "{reason}"
                );
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        // 2. Corrupted JSON
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"{ corrupted json").unwrap();
        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::BlockedUnresolved { reason, .. } => {
                assert!(reason.contains("corrupted or invalid"), "{reason}");
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_startup_blocks_on_unresolved_and_allows_safe_states() {
        let root = scratch("startup-decision-matrix");

        // Safe case A: Staging refused before touching data
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join(DB_FILES[0]), b"not a sqlite db").unwrap();
        write_database(&root.join(DB_FILES[0]), "existing safe db");

        let decision_refused = handle_startup_restore_in(&root).unwrap();
        match decision_refused {
            StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
                assert!(reason.contains("not usable"), "{reason}");
            }
            other => panic!("Expected StagingRefusedUnchanged, got {other:?}"),
        }
        // Active data is unchanged
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "existing safe db"
        );

        // Unsafe case: Unresolved recovery blocks startup
        let rollback = root.join("backups").join("before-restore-matrix");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "precious db");
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap(); // obstruction

        let journal = RestoreJournal {
            operation_id: "op-matrix-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-matrix".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstruction".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        let decision_unresolved = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision_unresolved,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_committed_activation_with_cleanup_failure_does_not_replay() {
        let root = scratch("cleanup-no-replay");
        write_database(&root.join(DB_FILES[0]), "restored committed db");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "should not be installed again");
        let plan = RestorePlan {
            operation_id: "op-committed-cleanup".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let journal = RestoreJournal {
            operation_id: "op-committed-cleanup".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-committed".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        // Active DB is STILL the committed restored db, NOT re-installed or rolled back
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "restored committed db"
        );
        assert!(!pending.exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn reviewer_recovered_restore_cleanup_failure_must_not_replay() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("review-recovered-cleanup");
        let elsewhere = scratch("review-recovered-cleanup-out");
        write_database(&root.join(DB_FILES[0]), "selected backup dataset");
        write_document(&root, "handbook.pdf", "selected backup document");
        let archive = elsewhere.join("selected.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current original dataset");
        write_document(&root, "handbook.pdf", "current original document");
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        let mut held = None;
        let first_error = apply_pending_restore_in_with(&root, || {
            held = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(pending.join(DB_FILES[0]))
                    .unwrap(),
            );
            Err("injected activation failure with pending database locked against deletion".into())
        })
        .unwrap_err();
        let first_value = database_contents(&root.join(DB_FILES[0]));
        let first_document = document_contents(&root, "handbook.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).is_file();
        let pending_retained = pending.join(DB_FILES[0]).is_file();
        drop(held);
        let next = handle_startup_restore_in(&root).unwrap();
        let next_value = database_contents(&root.join(DB_FILES[0]));
        let next_document = document_contents(&root, "handbook.pdf");
        println!(
            "RECOVERED_REPLAY: first_error={first_error}; first_row={first_value}; first_document={first_document:?}; journal_retained={journal_retained}; pending_retained={pending_retained}; next={next:?}; next_row={next_value}; next_document={next_document:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert_eq!(
            next_value, "current original dataset",
            "A successfully rolled-back restore must remain cancelled after failed staging cleanup"
        );
        assert_eq!(next_document.as_deref(), Some("current original document"));
    }

    #[test]
    fn reviewer_unrecorded_wal_move_preserves_committed_rows() {
        let source = scratch("review-wal-source");
        let root = scratch("review-wal-move");
        write_database(&source.join(DB_FILES[0]), "checkpointed original row");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'committed row only in WAL'",
            [],
        )
        .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        for name in DB_FILES {
            if source.join(name).is_file() {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
        }
        let wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());
        drop(conn);
        let rollback = root.join("backups/before-restore-unrecorded-wal");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();
        let mut journal =
            RestoreJournal::new("backups/before-restore-unrecorded-wal".into(), false);
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        // Actual protection order: WAL rename succeeds, process exits before its journal update.
        std::fs::rename(root.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let wal_retained = [root.join(DB_FILES[1]), rollback.join(DB_FILES[1])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == wal_hash);
        let value = database_contents(&root.join(DB_FILES[0]));
        println!(
            "WAL_MOVE: decision={decision:?}; original_wal_retained={wal_retained}; row={value}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
        assert_eq!(
            value, "committed row only in WAL",
            "Rollback must preserve committed WAL data"
        );
    }

    #[test]
    fn reviewer_stale_rollback_journal_cannot_delete_returned_original() {
        let root = scratch("review-stale-rollback");
        write_database(
            &root.join(DB_FILES[0]),
            "original returned after failed journal update",
        );
        let original_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let rollback = root.join("backups/before-restore-stale-rollback");
        std::fs::create_dir_all(&rollback).unwrap();
        write_document(&rollback, "original.pdf", "original protected document");
        // Rollback's durable update failed, but its ignored error allowed the original DB
        // to return. A subsequent crash leaves the prior installed-files list on disk.
        let mut journal = RestoreJournal::new("backups/before-restore-stale-rollback".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        journal.installed_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let original_retained = [root.join(DB_FILES[0]), rollback.join(DB_FILES[0])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == original_hash);
        println!(
            "STALE_ROLLBACK: decision={decision:?}; original_database_retained={original_retained}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            original_retained,
            "A stale installed-files list must not delete the returned original database"
        );
    }

    #[cfg(windows)]
    #[test]
    fn reviewer_committed_cleanup_failure_must_not_replay() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("review-committed-cleanup");
        write_database(&root.join(DB_FILES[0]), "committed current dataset");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "obsolete pending dataset");
        let mut journal =
            RestoreJournal::new("backups/before-restore-committed-test".into(), false);
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();
        let plan = RestorePlan {
            operation_id: journal.operation_id.clone(),
            kind: RestoreKind::Complete,
            source: "synthetic".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();
        // A genuine Windows filesystem failure: allow reads but deny deletion.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(pending.join(DB_FILES[0]))
            .unwrap();
        let first = handle_startup_restore_in(&root).unwrap();
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).is_file();
        let pending_retained = pending.join(DB_FILES[0]).is_file();
        drop(held);
        let second = handle_startup_restore_in(&root).unwrap();
        let value = database_contents(&root.join(DB_FILES[0]));
        println!(
            "CLEANUP_REPLAY: first={first:?}; committed_journal_retained={journal_retained}; pending_retained={pending_retained}; second={second:?}; row={value}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            value, "committed current dataset",
            "Cleanup failure must retain the commit decision across launches"
        );
    }

    #[test]
    fn reviewer_missing_journal_with_recovery_marker_blocks_startup() {
        let root = scratch("review-missing-journal");
        let rollback = root.join("backups/before-restore-journal-gap");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original stranded dataset");
        std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery").unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-journal-gap".into(), false);
        journal.phase = RestorePhase::UnresolvedRecovery;
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let replacement = serde_json::to_string_pretty(&journal).unwrap();
        std::fs::write(
            root.join(format!("{RESTORE_JOURNAL_FILE}.tmp-123")),
            replacement,
        )
        .unwrap();
        // Windows journal replacement deletes the old journal before renaming its temp file.
        std::fs::remove_file(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        println!(
            "MISSING_JOURNAL: decision={decision:?}; active_db_exists={}; recovery_db_exists={}",
            root.join(DB_FILES[0]).is_file(),
            rollback.join(DB_FILES[0]).is_file()
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A missing journal must not allow fresh-database startup over a known recovery set"
        );
    }

    #[test]
    fn reviewer_backups_parent_is_not_a_valid_recovery_folder() {
        let root = scratch("review-journal-parent");
        write_database(&root.join(DB_FILES[0]), "active unrelated dataset");
        let historical = root.join("backups/older-valid-safety-copy");
        std::fs::create_dir_all(&historical).unwrap();
        write_database(
            &historical.join(DB_FILES[0]),
            "valid historical safety copy",
        );
        let original_hash = sha256_digest(&std::fs::read(historical.join(DB_FILES[0])).unwrap());
        let journal = RestoreJournal::new("backups".into(), false);
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let retained = historical.join(DB_FILES[0]).is_file()
            && sha256_digest(&std::fs::read(historical.join(DB_FILES[0])).unwrap())
                == original_hash;
        println!("JOURNAL_PARENT: decision={decision:?}; historical_backup_retained={retained}");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            retained && matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Malformed journal must not delete the whole backups directory"
        );
    }

    #[test]
    fn reviewer_non_regular_journal_is_not_equivalent_to_absent() {
        let root = scratch("review-journal-directory");
        let rollback = root.join("backups/before-restore-nonregular-journal");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original stranded database");
        std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery").unwrap();
        std::fs::create_dir(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        println!(
            "NONREGULAR_JOURNAL: decision={decision:?}; active_db_exists={}",
            root.join(DB_FILES[0]).is_file()
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "An invalid journal path cannot be treated as no recovery"
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_legacy_restore_wal_is_not_mixed_with_returned_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round2-wal-active");
        let elsewhere = scratch("round2-wal-selected");
        write_database(&elsewhere.join(DB_FILES[0]), "selected checkpointed row");
        write_document(&elsewhere, "handbook.pdf", "selected document");
        let conn = Connection::open(elsewhere.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'selected WAL-only row'",
            [],
        )
        .unwrap();
        let archive_path = elsewhere.join("legacy-with-wal.hfdbackup");
        let mut zip = ZipWriter::new(File::create(&archive_path).unwrap());
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupManifest {
                format: ARCHIVE_FORMAT.into(),
                format_version: LEGACY_ARCHIVE_VERSION,
                app_version: "0.3.0".into(),
                created_at: 0,
                missing_at_export: vec![],
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[1]), DB_FILES[1]).unwrap();
        add_file_to_archive(
            &mut zip,
            &elsewhere.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        zip.finish().unwrap();
        drop(conn);
        write_database(&root.join(DB_FILES[0]), "current original row");
        // Original DB is checkpointed, with WAL mode retained but no WAL file.
        let original_conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        original_conn
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        drop(original_conn);
        assert!(!root.join(DB_FILES[1]).exists());
        write_document(&root, "handbook.pdf", "current original document");
        stage_complete_restore_in(&root, &archive_path, "0.5.3").unwrap();
        assert!(root.join(RESTORE_PENDING_DIR).join(DB_FILES[1]).is_file());
        let mut held_documents = None;
        let first = apply_pending_restore_in_with(&root, || {
            // Lock the staged directory itself so the actual document rename fails,
            // after the selected DB and WAL have already installed.
            held_documents = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .custom_flags(0x02000000)
                    .open(root.join(RESTORE_PENDING_DIR).join(DOCUMENTS_DIR))
                    .unwrap(),
            );
            Ok(())
        })
        .unwrap_err();
        drop(held_documents);
        let second = handle_startup_restore_in(&root).unwrap();
        let wal_left = root.join(DB_FILES[1]).is_file();
        let value = database_contents(&root.join(DB_FILES[0]));
        let doc = document_contents(&root, "handbook.pdf");
        println!("ROUND2_MIXED_WAL: first_error={first}; decision={second:?}; restored_wal_left_with_original_db={wal_left}; row={value}; doc={doc:?}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert_eq!(
            value, "current original row",
            "A staged legacy WAL must never replay into the returned original database"
        );
        assert_eq!(doc.as_deref(), Some("current original document"));
    }

    #[cfg(windows)]
    #[test]
    fn round2_failed_terminal_journal_removal_cannot_discard_new_restore() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round2-new-stage");
        let elsewhere = scratch("round2-new-stage-out");
        let second_source = scratch("round2-new-stage-second-source");
        write_database(&root.join(DB_FILES[0]), "first selected row");
        let first_archive = elsewhere.join("first.hfdbackup");
        write_complete_backup(&root, &first_archive, "0.5.3").unwrap();
        write_database(
            &second_source.join(DB_FILES[0]),
            "second explicitly requested row",
        );
        let second_archive = elsewhere.join("second.hfdbackup");
        write_complete_backup(&second_source, &second_archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current original row");
        stage_complete_restore_in(&root, &first_archive, "0.5.3").unwrap();
        let mut staged_db_lock = None;
        let _ = apply_pending_restore_in_with(&root, || {
            staged_db_lock = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(root.join(RESTORE_PENDING_DIR).join(DB_FILES[0]))
                    .unwrap(),
            );
            Err("injected first install failure".into())
        })
        .unwrap_err();
        drop(staged_db_lock);
        let old_id = read_journal(&root).unwrap().unwrap().operation_id;
        let held_journal = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(root.join(RESTORE_JOURNAL_FILE))
            .unwrap();
        let stage_result = stage_complete_restore_in(&root, &second_archive, "0.5.3");
        let new_id = if root.join(RESTORE_PENDING_DIR).join(RESTORE_PLAN).exists() {
            read_restore_plan(&root.join(RESTORE_PENDING_DIR)).operation_id
        } else {
            String::new()
        };
        let accepted = stage_result.is_ok();
        drop(held_journal);
        let decision = handle_startup_restore_in(&root).unwrap();
        let value = database_contents(&root.join(DB_FILES[0]));
        let pending_left = root.join(RESTORE_PENDING_DIR).exists();
        println!("ROUND2_NEW_STAGE: accepted={accepted}; old_id={old_id}; new_id={new_id}; decision={decision:?}; pending_left={pending_left}; row={value}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&second_source).unwrap();
        assert!(
            !accepted || value == "second explicitly requested row" || pending_left,
            "An old terminal operation must not silently delete an accepted new restore"
        );
    }

    #[test]
    fn round2_unidentified_regular_destination_is_not_deleted() {
        let root = scratch("round2-unidentified-db");
        write_database(&root.join(DB_FILES[0]), "unrelated replacement dataset");
        let unknown_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let rollback = root.join("backups/before-restore-unidentified");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "protected original dataset");
        let mut journal = RestoreJournal::new("backups/before-restore-unidentified".into(), false);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.installed_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let preserved = [root.join(DB_FILES[0]), rollback.join(DB_FILES[0])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == unknown_hash);
        println!(
            "ROUND2_UNKNOWN_DB: decision={decision:?}; unrelated_database_preserved={preserved}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(preserved, "A filename and presence of a rollback file cannot establish that the active file is disposable staged data");
    }

    #[cfg(windows)]
    fn round2_make_junction(link: &Path, target: &Path) {
        let quote = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let script = format!("$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null", quote(link), quote(target));
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "Could not create disposable junction: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_dangling_journal_is_not_treated_as_absent() {
        let root = scratch("round2-dangling-journal");
        let elsewhere = scratch("round2-dangling-journal-out");
        let target = elsewhere.join("empty-target");
        std::fs::create_dir(&target).unwrap();
        round2_make_junction(&root.join(RESTORE_JOURNAL_FILE), &target);
        std::fs::remove_dir(&target).unwrap();
        assert!(std::fs::symlink_metadata(root.join(RESTORE_JOURNAL_FILE)).is_ok());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        let decision = handle_startup_restore_in(&root).unwrap();
        println!("ROUND2_DANGLING_JOURNAL: decision={decision:?}");
        std::fs::remove_dir(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A dangling reparse point at the journal path is not absent state"
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_linked_recovery_documents_do_not_enter_active_storage() {
        let root = scratch("round2-linked-documents");
        let elsewhere = scratch("round2-linked-documents-out");
        write_document(&elsewhere, "external.txt", "external document sentinel");
        let rollback = root.join("backups/before-restore-linked-docs");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "protected original dataset");
        round2_make_junction(
            &rollback.join(DOCUMENTS_DIR),
            &elsewhere.join(DOCUMENTS_DIR),
        );
        let mut journal = RestoreJournal::new("backups/before-restore-linked-docs".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let active_link = root.join(DOCUMENTS_DIR).exists();
        let external_read = document_contents(&root, "external.txt");
        println!("ROUND2_LINKED_DOCS: decision={decision:?}; active_docs_exist={active_link}; external_read_from_active={external_read:?}");
        assert_eq!(
            document_contents(&elsewhere, "external.txt").as_deref(),
            Some("external document sentinel")
        );
        if root.join(DOCUMENTS_DIR).exists() {
            std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        }
        if rollback.join(DOCUMENTS_DIR).exists() {
            std::fs::remove_dir(rollback.join(DOCUMENTS_DIR)).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A linked original artifact must be rejected before it is moved into active storage"
        );
        assert!(!active_link);
    }

    #[cfg(windows)]
    #[test]
    fn round2_linked_recovery_database_directory_does_not_enter_active_storage() {
        let root = scratch("round2-linked-db");
        let elsewhere = scratch("round2-linked-db-out");
        let target = elsewhere.join("target_dir");
        std::fs::create_dir_all(&target).unwrap();
        let rollback = root.join("backups/before-restore-linked-db");
        std::fs::create_dir_all(&rollback).unwrap();
        round2_make_junction(&rollback.join(DB_FILES[0]), &target);
        let mut journal = RestoreJournal::new("backups/before-restore-linked-db".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let active_exists = root.join(DB_FILES[0]).exists();
        if rollback.join(DB_FILES[0]).exists() {
            let _ = std::fs::remove_dir(rollback.join(DB_FILES[0]));
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Linked database path must be rejected"
        );
        assert!(!active_exists);
    }

    #[test]
    fn unidentified_document_and_sidecar_are_not_deleted() {
        let root = scratch("unidentified-doc-sidecar");
        write_database(&root.join(DB_FILES[0]), "active database");
        write_document(&root, "unrelated.pdf", "unrelated active document");
        let unknown_doc_hash =
            sha256_digest(&std::fs::read(root.join(DOCUMENTS_DIR).join("unrelated.pdf")).unwrap());
        std::fs::write(root.join(DB_FILES[1]), b"unrelated active WAL raw bytes").unwrap();
        let unknown_wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());

        let rollback = root.join("backups/before-restore-doc-sidecar");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original protected db");
        write_document(&rollback, "original.pdf", "original document");

        let mut journal = RestoreJournal::new("backups/before-restore-doc-sidecar".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        journal.installed_db_files.push(DB_FILES[0].into());
        journal.installed_db_files.push(DB_FILES[1].into());
        journal.installed_documents = true;
        // Notice: staged_db_artifacts does NOT contain the hash of root's DB_FILES[1]
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        // The unrelated WAL must not be deleted because it is unidentified!
        assert!(
            root.join(DB_FILES[1]).is_file()
                && sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap())
                    == unknown_wal_hash,
            "Unidentified WAL must be preserved"
        );
        // The unrelated document must also be preserved!
        assert!(
            root.join(DOCUMENTS_DIR).join("unrelated.pdf").is_file()
                && sha256_digest(
                    &std::fs::read(root.join(DOCUMENTS_DIR).join("unrelated.pdf")).unwrap()
                ) == unknown_doc_hash,
            "Unidentified document must be preserved"
        );
        // And startup must block on unresolved state rather than claiming full clean recovery
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unidentified sidecar must halt recovery with BlockedUnresolved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn matrix_interrupted_original_return_preserves_already_returned_files() {
        let source = scratch("matrix-source");
        let root = scratch("matrix-interrupted-return");
        write_database(&source.join(DB_FILES[0]), "checkpointed db");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original persistent database'",
            [],
        )
        .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        // Put DB_FILES[0] in root (as if it has already returned)
        std::fs::copy(source.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        // Put DB_FILES[1] in rollback (still pending return)
        let rollback = root.join("backups/before-restore-matrix-return");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::copy(source.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();
        let orig_wal_hash = sha256_digest(&std::fs::read(rollback.join(DB_FILES[1])).unwrap());
        drop(conn);

        let orig_ident_db = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: orig_hash.clone(),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        };
        let orig_ident_wal = ArtifactIdentity {
            name: DB_FILES[1].to_string(),
            sha256: orig_wal_hash.clone(),
            size: std::fs::metadata(rollback.join(DB_FILES[1])).unwrap().len(),
        };

        let mut journal = RestoreJournal::new("backups/before-restore-matrix-return".into(), false);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].to_string(), DB_FILES[1].to_string()];
        journal.original_db_artifacts = vec![orig_ident_db, orig_ident_wal];
        write_journal(&root, &journal).unwrap();

        // Rerunning rollback on startup must detect that DB_FILES[0] matches the original identity,
        // preserve it, move DB_FILES[1] from rollback, and complete recovery safely!
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert!(root.join(DB_FILES[1]).is_file());
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap()),
            orig_wal_hash
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original persistent database"
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn matrix_missing_original_artifact_blocks_recovery_even_if_same_named_file_exists() {
        let root = scratch("matrix-missing-original");
        let rollback = root.join("backups/before-restore-missing-original");
        std::fs::create_dir_all(&rollback).unwrap();
        // The rollback folder has a file with the right name, but DIFFERENT content than expected!
        write_database(&rollback.join(DB_FILES[0]), "corrupted or altered db");

        let orig_ident = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            size: 100,
        };

        let mut journal =
            RestoreJournal::new("backups/before-restore-missing-original".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].to_string()];
        journal.original_db_artifacts = vec![orig_ident];
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Hash mismatch on original artifact must block recovery"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn matrix_journal_unreadable_or_corrupt_phase_blocks_conservatively() {
        let root = scratch("matrix-corrupt-journal");
        let rollback = root.join("backups/before-restore-corrupt");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "precious database");

        std::fs::write(
            root.join(RESTORE_JOURNAL_FILE),
            br#"{"phase": "NonExistentPhase"}"#,
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unknown phase in journal must block startup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn round3_identity(path: &Path, name: &str) -> ArtifactIdentity {
        let bytes = std::fs::read(path).unwrap();
        ArtifactIdentity {
            name: name.into(),
            sha256: sha256_digest(&bytes),
            size: bytes.len() as u64,
        }
    }

    #[test]
    fn round3_changed_original_document_cannot_be_reported_recovered() {
        let root = scratch("round3-changed-original-doc");
        let rollback = root.join("backups/before-restore-round3-changed");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "original.pdf", "original document bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-changed".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("original.pdf"),
            b"altered document bytes!",
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let recovered_bytes = document_contents(&root, "original.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Must reject changed original document identity: {decision:?}, active={recovered_bytes:?}, journal_retained={journal_retained}");
    }

    #[test]
    fn round3_missing_original_document_cannot_be_reported_recovered() {
        let root = scratch("round3-missing-original-doc");
        let rollback = root.join("backups/before-restore-round3-missing");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "original.pdf", "original document bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-missing".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();
        std::fs::remove_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let original_missing = !root.join(DOCUMENTS_DIR).join("original.pdf").exists();
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Must reject missing original documents: {decision:?}, missing={original_missing}, journal_retained={journal_retained}");
    }

    #[test]
    fn round3_original_document_absence_must_not_leave_selected_documents() {
        let root = scratch("round3-original-doc-absence");
        let rollback = root.join("backups/before-restore-round3-absence");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original row without documents");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-absence".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::write(
            root.join(DOCUMENTS_DIR).join("selected.pdf"),
            b"selected backup document",
        )
        .unwrap();
        journal.staged_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        journal.installed_documents = true;
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let selected_left = root.join(DOCUMENTS_DIR).join("selected.pdf").exists();
        let original_row = database_contents(&root.join(DB_FILES[0]));
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }) || !selected_left,
            "Cannot accept a mixture of returned original DB and selected documents: {decision:?}, selected_left={selected_left}, row={original_row}");
    }

    #[cfg(windows)]
    #[test]
    fn round3_active_document_junction_cannot_be_accepted_as_returned_original() {
        let root = scratch("round3-active-doc-junction");
        let external = scratch("round3-external-docs");
        let rollback = root.join("backups/before-restore-round3-junction");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "returned original row");
        write_document(&external, "original.pdf", "external sentinel");
        let mut journal =
            RestoreJournal::new("backups/before-restore-round3-junction".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&external.join(DOCUMENTS_DIR)).unwrap();
        round2_make_junction(&root.join(DOCUMENTS_DIR), &external.join(DOCUMENTS_DIR));
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let linked_active =
            is_symlink_or_reparse(&std::fs::symlink_metadata(root.join(DOCUMENTS_DIR)).unwrap());
        let external_bytes = document_contents(&external, "original.pdf");
        std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Active document junction must halt startup: {decision:?}, linked_active={linked_active}, external={external_bytes:?}");
    }

    #[test]
    fn round3_unknown_pending_owner_must_not_be_deleted_by_terminal_cleanup() {
        let root = scratch("round3-unknown-pending-owner");
        write_database(&root.join(DB_FILES[0]), "installed row");
        let rollback = root.join("backups/before-restore-round3-terminal");
        std::fs::create_dir_all(&rollback).unwrap();
        let mut journal =
            RestoreJournal::new("backups/before-restore-round3-terminal".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "known-terminal-owner".into();
        write_journal(&root, &journal).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "unidentified pending row");
        std::fs::write(pending.join(RESTORE_PLAN), b"{ corrupted ownership record").unwrap();
        let identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        let decision = handle_startup_restore_in(&root).unwrap();
        let pending_preserved = pending.join(DB_FILES[0]).is_file()
            && round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == identity;
        std::fs::remove_dir_all(&root).unwrap();
        assert!(pending_preserved,
            "Unknown ownership must not authorize deletion: {decision:?}, pending_preserved={pending_preserved}");
    }

    // =========================================================================
    // Task 1: Enforce original document identity and completeness
    // =========================================================================

    #[test]
    fn task1_missing_single_document_in_populated_dir_blocks() {
        let root = scratch("task1-missing-single-doc");
        let rollback = root.join("backups/before-restore-t1-single");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "doc1.pdf", "doc 1 bytes");
        write_document(&rollback, "doc2.pdf", "doc 2 bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-t1-single".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Simulate single missing document in rollback
        std::fs::remove_file(rollback.join(DOCUMENTS_DIR).join("doc2.pdf")).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Missing single document in populated directory must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_changed_same_size_document_bytes_blocks() {
        let root = scratch("task1-changed-same-size");
        let rollback = root.join("backups/before-restore-t1-samesize");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "doc.pdf", "AAAA");
        let mut journal = RestoreJournal::new("backups/before-restore-t1-samesize".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Alter bytes with SAME size
        std::fs::write(rollback.join(DOCUMENTS_DIR).join("doc.pdf"), b"BBBB").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Changed same-size document bytes must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_nested_document_paths_verified() {
        let root = scratch("task1-nested-doc-paths");
        let rollback = root.join("backups/before-restore-t1-nested");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        let sub = rollback.join(DOCUMENTS_DIR).join("curriculum/phase1");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("lesson.pdf"), b"lesson bytes in nested path").unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t1-nested".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Nested document paths must be recovered and verified: {decision:?}"
        );
        let active_nested = root
            .join(DOCUMENTS_DIR)
            .join("curriculum/phase1/lesson.pdf");
        assert!(active_nested.is_file());
        assert_eq!(
            std::fs::read(active_nested).unwrap(),
            b"lesson bytes in nested path"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_missing_entire_document_directory_blocks() {
        let root = scratch("task1-missing-entire-docs-dir");
        let rollback = root.join("backups/before-restore-t1-nodir");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "test.pdf", "test content");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-nodir".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Remove entire documents directory in rollback
        std::fs::remove_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Missing entire original documents directory must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_interrupted_return_after_directory_rename_resumes_cleanly() {
        let root = scratch("task1-interrupted-after-rename");
        let rollback = root.join("backups/before-restore-t1-interrupted");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original row in active root");
        write_document(&root, "manual.pdf", "original manual content");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-interrupted".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Rollback already has docs moved to root. Next startup must recognize all original files are back and succeed!
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Interrupted return with all originals in place must complete recovery cleanly: {decision:?}");
        assert!(root.join(DOCUMENTS_DIR).join("manual.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_repeated_startup_after_clearing_obstruction_succeeds() {
        let root = scratch("task1-repeated-startup-obstruction");
        let rollback = root.join("backups/before-restore-t1-obstruct");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original precious row");
        write_document(&rollback, "guide.pdf", "original guide bytes");

        // Obstruct active root
        write_database(&root.join(DB_FILES[0]), "obstruction row");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-obstruct".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // First launch: blocked due to obstruction
        let decision1 = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision1,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        // Clear obstruction
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();

        // Second launch: succeeds cleanly!
        let decision2 = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(
                decision2,
                StartupRestoreDecision::RolledBackRecovered { .. }
            ),
            "Second launch after clearing obstruction must succeed: {decision2:?}"
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original precious row"
        );
        assert!(root.join(DOCUMENTS_DIR).join("guide.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 2: Handle original document absence without mixing datasets
    // =========================================================================

    #[test]
    fn task2_original_document_absence_uninstalls_selected_documents() {
        let root = scratch("task2-absence-uninstalls-selected");
        let rollback = root.join("backups/before-restore-t2-absence");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db without docs");

        // Staged document installed in root
        write_document(
            &root,
            "staged_selected.pdf",
            "staged selected document bytes",
        );
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-absence".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = false; // Original had NO documents
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover to original absence: {decision:?}"
        );
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Documents directory must be removed to restore absence"
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original db without docs"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_original_empty_document_dir_restored() {
        let root = scratch("task2-empty-dir-restored");
        let rollback = root.join("backups/before-restore-t2-empty");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db with empty docs");

        write_document(
            &root,
            "staged_selected.pdf",
            "staged selected document bytes",
        );
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-empty".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true; // Original HAD an empty documents directory
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover to original empty directory: {decision:?}"
        );
        assert!(
            root.join(DOCUMENTS_DIR).is_dir(),
            "Documents directory must exist"
        );
        assert!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR))
                .unwrap()
                .is_empty(),
            "Documents directory must be empty"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_original_populated_document_dir_restored() {
        let root = scratch("task2-populated-dir-restored");
        let rollback = root.join("backups/before-restore-t2-populated");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");
        write_document(&rollback, "orig1.pdf", "orig 1");
        write_document(&rollback, "orig2.pdf", "orig 2");

        write_document(&root, "staged1.pdf", "staged 1");
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-populated".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover populated original documents: {decision:?}"
        );
        assert!(root.join(DOCUMENTS_DIR).join("orig1.pdf").is_file());
        assert!(root.join(DOCUMENTS_DIR).join("orig2.pdf").is_file());
        assert!(!root.join(DOCUMENTS_DIR).join("staged1.pdf").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_unrelated_active_document_preserved_and_blocks() {
        let root = scratch("task2-unrelated-doc-preserved");
        let rollback = root.join("backups/before-restore-t2-unrelated");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");

        write_document(&root, "staged1.pdf", "staged 1");
        write_document(&root, "unrelated_user_doc.pdf", "do not delete me!");
        let staged_ident = vec![round3_identity(
            &root.join(DOCUMENTS_DIR).join("staged1.pdf"),
            "staged1.pdf",
        )];

        let mut journal = RestoreJournal::new("backups/before-restore-t2-unrelated".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unrelated active document must block recovery: {decision:?}"
        );
        assert!(
            root.join(DOCUMENTS_DIR)
                .join("unrelated_user_doc.pdf")
                .is_file(),
            "Unrelated document must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_overlapping_document_content_survives() {
        let root = scratch("task2-overlapping-doc");
        let rollback = root.join("backups/before-restore-t2-overlap");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(
            &root,
            "shared.pdf",
            "identical content in both original and staged",
        );

        let ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-t2-overlap".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = ident.clone();
        journal.staged_document_artifacts = ident;
        journal.installed_documents = true;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Overlapping document must not be deleted: {decision:?}"
        );
        assert!(root.join(DOCUMENTS_DIR).join("shared.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 3: Fallible and no-follow inspection across the entire dataset
    // =========================================================================

    #[cfg(windows)]
    #[test]
    fn task3_linked_inventory_root_rejected() {
        let root = scratch("task3-linked-root");
        let external = scratch("task3-external-target");
        write_document(&external, "test.pdf", "external content");
        round2_make_junction(&root.join(DOCUMENTS_DIR), &external.join(DOCUMENTS_DIR));

        let res = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR));
        assert!(
            res.is_err(),
            "inventory_directory_artifacts must reject a junction as root"
        );
        std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task3_linked_nested_child_rejected() {
        let root = scratch("task3-linked-child");
        let external = scratch("task3-external-child-target");
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&docs).unwrap();
        write_document(&external, "nested.pdf", "external nested content");
        round2_make_junction(&docs.join("nested_junction"), &external.join(DOCUMENTS_DIR));

        let res = inventory_directory_artifacts(&docs);
        assert!(
            res.is_err(),
            "inventory_directory_artifacts must reject a nested junction"
        );
        std::fs::remove_dir(docs.join("nested_junction")).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task3_active_db_link_rejected() {
        let root = scratch("task3-linked-db");
        let external = scratch("task3-external-db");
        write_database(&external.join(DB_FILES[0]), "external db");

        let rollback = root.join("backups/before-restore-t3-db");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original precious db");

        let mut journal = RestoreJournal::new("backups/before-restore-t3-db".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        write_journal(&root, &journal).unwrap();

        // Make root.join(DB_FILES[0]) a junction pointing to directory external
        round2_make_junction(&root.join(DB_FILES[0]), &external);

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Active DB link must block recovery: {decision:?}"
        );
        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[test]
    fn task3_journal_invalid_inventory_names_rejected() {
        let root = scratch("task3-invalid-journal-names");
        let mut journal = RestoreJournal::new("backups/before-restore-t3-invalid".into(), true);
        journal.phase = RestorePhase::Protected;
        // Inject traversal in document inventory
        journal.original_document_artifacts.push(ArtifactIdentity {
            name: "../traversal.pdf".into(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
            size: 10,
        });

        let validation_res = journal.validate(&root);
        assert!(
            validation_res.is_err(),
            "Traversal in document inventory must be rejected by validate"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 4: Strict pending deletion ownership
    // =========================================================================

    #[test]
    fn task4_terminal_cleanup_matching_id_committed() {
        let root = scratch("task4-matching-committed");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-matching-123".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-matching-123".into(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(
            !pending.exists(),
            "Pending directory with matching ID must be cleaned up"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted after cleanup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_matching_id_rolled_back() {
        let root = scratch("task4-matching-rolledback");
        write_database(&root.join(DB_FILES[0]), "recovered active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match-rb".into(), false);
        journal.phase = RestorePhase::RolledBack;
        journal.operation_id = "op-match-rb-456".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-match-rb-456".into(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::RolledBackRecovered { .. }
        ));
        assert!(
            !pending.exists(),
            "Pending directory with matching ID must be cleaned up"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted after cleanup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_mismatched_id_refuses_deletion() {
        let root = scratch("task4-mismatched-id");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-mismatch".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-journal-789".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db from other op");
        let plan = RestorePlan {
            operation_id: "op-OTHER-different".into(),
            kind: RestoreKind::Complete,
            source: "backup2.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Mismatched operation ID must block and refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_corrupted_plan_refuses_deletion() {
        let root = scratch("task4-corrupt-plan-refuses");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-corrupt".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-modern-with-id".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db with corrupted plan");
        std::fs::write(pending.join(RESTORE_PLAN), b"{ corrupted json").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Corrupted plan with modern journal must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_empty_id_refuses_deletion() {
        let root = scratch("task4-empty-id-refuses");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-empty-id".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-modern-with-id".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db with empty id");
        let plan = RestorePlan {
            operation_id: String::new(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Empty plan ID with modern journal must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_genuine_legacy_state() {
        let root = scratch("task4-legacy-cleanup");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-legacy".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = String::new(); // Legacy journal without operation_id
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "legacy staged db");
        // No plan in legacy pending either

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(
            !pending.exists(),
            "Legacy pending without plan must be cleaned up by legacy journal"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 5: Deterministic Fault Injection Matrix
    // =========================================================================

    #[test]
    fn task5_matrix_journal_temp_create_fault() {
        let root = scratch("task5-fault-temp-create");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalTempCreate);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Temp create fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_write_fault() {
        let root = scratch("task5-fault-write");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalWrite);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Write fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_sync_fault() {
        let root = scratch("task5-fault-sync");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalSync);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Sync fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_rename_fault() {
        let root = scratch("task5-fault-rename");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalRename);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Rename fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_delete_fault() {
        let root = scratch("task5-fault-delete");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        write_journal(&root, &journal).unwrap();
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());

        let _guard = ScopedFault::set(InjectedFault::JournalDelete);
        let res = remove_journal(&root);
        assert!(res.is_err(), "Delete fault must fail remove_journal");
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must remain on delete failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_unreadable_journal_file_blocks_startup() {
        let root = scratch("task5-unreadable-journal");
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"not valid json").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unreadable journal file must block startup: {decision:?}"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Unreadable journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_protect_move_fault_conserves_original_data() {
        let root = scratch("task5-fault-protect-move");
        write_database(&root.join(DB_FILES[0]), "original uncorrupted database");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged new database");

        let _guard = ScopedFault::set(InjectedFault::ProtectDbRename(0));
        let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
        assert!(
            matches!(res, RestoreApplicationResult::RefusedUnchanged(_)),
            "Failure during protect move must result in RefusedUnchanged: {res:?}"
        );
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must remain intact after protect failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_install_move_fault_triggers_clean_rollback() {
        let root = scratch("task5-fault-install-move");
        write_database(
            &root.join(DB_FILES[0]),
            "original database before install failure",
        );
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged new database");

        let _guard = ScopedFault::set(InjectedFault::InstallDbRename(0));
        let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
        assert!(
            matches!(res, RestoreApplicationResult::Recovered(_)),
            "Failure during install move must trigger successful recovery rollback: {res:?}"
        );
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must be restored after install failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_return_move_fault_conserves_all_files() {
        let root = scratch("task5-fault-return-move");
        let rollback = root.join("backups/before-restore-return-fault");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original database in rollback");

        let mut journal = RestoreJournal::new("backups/before-restore-return-fault".into(), false);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        write_journal(&root, &journal).unwrap();

        let _guard = ScopedFault::set(InjectedFault::ReturnDbRename(0));
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Failure during return move must block startup: {decision:?}"
        );
        assert!(
            rollback.join(DB_FILES[0]).is_file(),
            "Original file must be preserved in rollback"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Round 4: Ported Regressions & Verified Fixes
    // =========================================================================

    #[test]
    fn round4_modern_terminal_missing_plan_preserves_unknown_pending() {
        let mut results = Vec::new();
        for phase in [RestorePhase::Committed, RestorePhase::RolledBack] {
            let root = scratch(&format!("round4-missing-plan-{phase:?}"));
            write_database(&root.join(DB_FILES[0]), "active original row");
            let mut journal =
                RestoreJournal::new("backups/before-restore-round4-missing-plan".into(), false);
            journal.phase = phase.clone();
            journal.operation_id = "known-modern-terminal-owner".into();
            write_journal(&root, &journal).unwrap();
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "unknown pending row");
            let original_pending = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
            assert!(!pending.join(RESTORE_PLAN).exists());
            let decision = handle_startup_restore_in(&root).unwrap();
            let preserved = pending.join(DB_FILES[0]).is_file()
                && round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == original_pending;
            results.push(format!(
                "phase={phase:?}, decision={decision:?}, pending_preserved={preserved}"
            ));
            std::fs::remove_dir_all(&root).unwrap();
        }
        assert!(
            results
                .iter()
                .all(|r| r.ends_with("pending_preserved=true")),
            "Missing plan does not establish modern deletion ownership: {results:?}"
        );
    }

    #[test]
    fn round4_empty_original_manifest_rejects_unidentified_document() {
        let root = scratch("round4-empty-original-manifest");
        let rollback = root.join("backups/before-restore-round4-empty");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(
            &rollback.join(DB_FILES[0]),
            "original row with empty document directory",
        );
        let mut journal = RestoreJournal::new("backups/before-restore-round4-empty".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        assert!(journal.original_document_artifacts.is_empty());
        write_journal(&root, &journal).unwrap();
        // The formerly empty original directory now has content not in its recorded inventory.
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("unidentified.pdf"),
            b"unidentified document sentinel",
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let accepted_unknown = document_contents(&root, "unidentified.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A known-empty manifest must not disable complete-set verification: {decision:?}, active={accepted_unknown:?}, journal_retained={journal_retained}");
    }

    #[test]
    fn round4_document_protection_failure_recovers_on_next_launch() {
        let root = scratch("round4-protect-doc-failure");
        write_database(&root.join(DB_FILES[0]), "original protected row");
        write_document(&root, "original.pdf", "original protected document");
        let db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let doc_identity = round3_identity(
            &root.join(DOCUMENTS_DIR).join("original.pdf"),
            "original.pdf",
        );
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected backup row");
        write_document(&pending, "selected.pdf", "selected backup document");
        write_restore_plan(
            &pending,
            RestoreKind::Complete,
            "synthetic selected archive",
        )
        .unwrap();
        let first = {
            let _guard = ScopedFault::set(InjectedFault::ProtectDocsRename);
            apply_pending_restore_in_internal(&root, || Ok(())).unwrap()
        };
        let fault_observed =
            format!("{first:?}").contains("Injected test fault: ProtectDocsRename");
        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        let originals_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == db_identity
            && root.join(DOCUMENTS_DIR).join("original.pdf").is_file()
            && round3_identity(
                &root.join(DOCUMENTS_DIR).join("original.pdf"),
                "original.pdf",
            ) == doc_identity;
        let resolved = matches!(
            second,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        ) && matches!(
            third,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            fault_observed,
            "Fixture must exercise the document protection fault: {first:?}"
        );
        assert!(resolved && originals_preserved,
            "A cleared document protection failure must recover the conserved original dataset: first={first:?}, second={second:?}, third={third:?}, preserved={originals_preserved}");
    }

    #[cfg(windows)]
    #[test]
    fn round4_linked_pending_root_must_not_move_external_data() {
        let root = scratch("round4-linked-pending-root");
        let external = scratch("round4-external-pending-target");
        write_database(&root.join(DB_FILES[0]), "original active row");
        write_document(&root, "original.pdf", "original active document");
        let active_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        write_database(&external.join(DB_FILES[0]), "external sentinel row");
        write_document(&external, "external.pdf", "external document sentinel");
        write_restore_plan(
            &external,
            RestoreKind::Complete,
            "synthetic external ownership plan",
        )
        .unwrap();
        let external_db_identity = round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]);
        let pending = root.join(RESTORE_PENDING_DIR);
        round2_make_junction(&pending, &external);
        let decision = handle_startup_restore_in(&root).unwrap();
        let external_db_preserved = external.join(DB_FILES[0]).is_file()
            && round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]) == external_db_identity;
        let external_docs_preserved = document_contents(&external, "external.pdf")
            == Some("external document sentinel".into());
        let active_db_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db_identity;
        let active_row = if root.join(DB_FILES[0]).is_file() {
            Some(database_contents(&root.join(DB_FILES[0])))
        } else {
            None
        };
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_dir(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. })
            && external_db_preserved && external_docs_preserved && active_db_preserved,
            "Linked staging must be refused before following/moving external files: {decision:?}, external_db_preserved={external_db_preserved}, external_docs_preserved={external_docs_preserved}, active_db_preserved={active_db_preserved}, active_row={active_row:?}");
    }

    #[cfg(unix)]
    #[test]
    fn round4_linked_pending_root_must_not_move_external_data_unix() {
        let root = scratch("round4-linked-pending-root-unix");
        let external = scratch("round4-external-pending-target-unix");
        write_database(&root.join(DB_FILES[0]), "original active row");
        write_document(&root, "original.pdf", "original active document");
        let active_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        write_database(&external.join(DB_FILES[0]), "external sentinel row");
        write_document(&external, "external.pdf", "external document sentinel");
        write_restore_plan(
            &external,
            RestoreKind::Complete,
            "synthetic external ownership plan",
        )
        .unwrap();
        let external_db_identity = round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]);
        let pending = root.join(RESTORE_PENDING_DIR);
        std::os::unix::fs::symlink(&external, &pending).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let external_db_preserved = external.join(DB_FILES[0]).is_file()
            && round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]) == external_db_identity;
        let external_docs_preserved = document_contents(&external, "external.pdf")
            == Some("external document sentinel".into());
        let active_db_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db_identity;
        let active_row = if root.join(DB_FILES[0]).is_file() {
            Some(database_contents(&root.join(DB_FILES[0])))
        } else {
            None
        };
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_file(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. })
                && external_db_preserved
                && external_docs_preserved
                && active_db_preserved
                && active_row.as_deref() == Some("original active row"),
            "Linked staging must be refused before following/moving external files: {decision:?}, active_row={active_row:?}"
        );
    }

    // =========================================================================
    // Task 1: Staging/Pending Root Authorization
    // =========================================================================

    #[cfg(windows)]
    #[test]
    fn task1_linked_pending_root_without_documents() {
        let root = scratch("task1-linked-pending-no-docs");
        let external = scratch("task1-ext-no-docs");
        write_database(&root.join(DB_FILES[0]), "active row");
        write_database(&external.join(DB_FILES[0]), "ext row");
        write_restore_plan(&external, RestoreKind::Database, "db only").unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        round2_make_junction(&pending, &external);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(external.join(DB_FILES[0]).is_file());
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_dir(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task1_linked_staging_root_refuses_staging() {
        let root = scratch("task1-linked-staging");
        let external = scratch("task1-ext-staging");
        let staging = root.join(RESTORE_STAGING_DIR);
        round2_make_junction(&staging, &external);
        let res = fresh_staging(&root);
        assert!(
            res.is_err(),
            "fresh_staging must refuse linked staging directory"
        );
        assert!(format!("{res:?}").contains("unsafe symlink or reparse point"));
        if std::fs::symlink_metadata(&staging).is_ok() {
            std::fs::remove_dir(&staging).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[test]
    fn task1_invalid_directory_type_pending_refuses_activation() {
        let root = scratch("task1-file-as-pending");
        write_database(&root.join(DB_FILES[0]), "active row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::write(&pending, b"not a directory").unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_ordinary_valid_pending_activation_succeeds() {
        let root = scratch("task1-valid-pending");
        write_database(&root.join(DB_FILES[0]), "old active row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "new restored row");
        write_restore_plan(&pending, RestoreKind::Database, "test archive").unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "new restored row"
        );
        assert!(!pending.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 2: Reconcile Unmoved Original Documents
    // =========================================================================

    #[test]
    fn task2_protection_failure_with_empty_documents_recovers() {
        let root = scratch("task2-protect-empty-docs");
        write_database(&root.join(DB_FILES[0]), "active db row");
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let db_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected row");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let first = {
            let _guard = ScopedFault::set(InjectedFault::ProtectDocsRename);
            apply_pending_restore_in_internal(&root, || Ok(())).unwrap()
        };
        assert!(format!("{first:?}").contains("Injected test fault: ProtectDocsRename"));
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            second,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        ));
        assert_eq!(round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]), db_id);
        assert!(root.join(DOCUMENTS_DIR).is_dir());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_protection_failure_with_active_documents_modified_blocks() {
        let root = scratch("task2-protect-mod-docs");
        let rollback = root.join("backups/before-restore-t2-tamper");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db in rollback");
        write_document(&root, "orig.pdf", "tampered content");

        let mut journal = RestoreJournal::new("backups/before-restore-t2-tamper".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = vec![ArtifactIdentity {
            name: "orig.pdf".into(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
            size: 16,
        }];
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Modified active original document must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 3: Known-Empty Manifest Enforces Empty Set
    // =========================================================================

    #[test]
    fn task3_empty_manifest_with_nested_unexpected_file_blocks() {
        let root = scratch("task3-empty-nested-blocks");
        let rollback = root.join("backups/before-restore-t3-nested");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");
        let mut journal = RestoreJournal::new("backups/before-restore-t3-nested".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = vec![];
        write_journal(&root, &journal).unwrap();

        // Introduce nested unexpected file
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR).join("subdir")).unwrap();
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("subdir/nested.pdf"),
            b"unexpected nested",
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 4: Missing Plan Refuses Modern Terminal Cleanup
    // =========================================================================

    #[test]
    fn task4_modern_terminal_matching_plan_cleans_up() {
        let root = scratch("task4-matching-cleans-up");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-matched-999".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-matched-999".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 5: Fault-Injection Matrix Coverage
    // =========================================================================

    #[test]
    fn task5_occurrence_second_journal_write_failure_recovers_with_expected_cleanup() {
        #[cfg(windows)]
        use std::os::windows::fs::OpenOptionsExt;
        // A Windows deny-delete handle retains pending cleanup. Without that handle,
        // successful rollback clears the journal on every supported platform.
        #[cfg(windows)]
        let cleanup_retained_cases = [false, true];
        #[cfg(not(windows))]
        let cleanup_retained_cases = [false];

        for cleanup_retained in cleanup_retained_cases {
            let root = scratch("task5-occurrence-journal");
            write_database(&root.join(DB_FILES[0]), "original active db");
            let orig_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "restored db");
            write_restore_plan(&pending, RestoreKind::Database, "test").unwrap();
            let staged_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
            let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();

            #[cfg(windows)]
            let lock = cleanup_retained.then(|| {
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(pending.join(DB_FILES[0]))
                    .unwrap()
            });

            // Fail on the 2nd journal write (Protected phase write)
            let _guard = ScopedFault::set_occurrence(InjectedFault::JournalWrite, 2);
            let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
            assert!(
                matches!(res, RestoreApplicationResult::RefusedUnchanged(ref reason)
            if reason.contains("JournalWrite")),
                "Unexpected restore result: {res:?}"
            );
            assert_eq!(
                ScopedFault::fired_count(),
                1,
                "Second write fault must fire once"
            );
            assert_eq!(
                round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
                orig_identity,
                "Original database must be restored before pending cleanup"
            );

            if cleanup_retained {
                let journal_on_disk = read_journal(&root)
                    .unwrap()
                    .expect("Blocked cleanup must retain a valid rollback journal");
                assert_eq!(journal_on_disk.phase, RestorePhase::RolledBack);
                assert_eq!(
                    round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]),
                    staged_identity
                );
                assert_eq!(
                    std::fs::read(pending.join(RESTORE_PLAN)).unwrap(),
                    plan_bytes
                );
            } else {
                assert!(
                    read_journal(&root).unwrap().is_none(),
                    "Completed cleanup must clear the journal"
                );
                assert!(
                    !pending.exists(),
                    "Completed cleanup must remove owned pending data"
                );
            }
            assert!(find_abandoned_temporary_journal_sibling(&root)
                .unwrap()
                .is_none());

            drop(_guard);
            #[cfg(windows)]
            drop(lock);

            // Repeat startup safely resolves/conserves original dataset
            let decision = handle_startup_restore_in(&root).unwrap();
            if cleanup_retained {
                assert!(matches!(
                    decision,
                    StartupRestoreDecision::RolledBackRecovered { .. }
                ));
            } else {
                assert_eq!(decision, StartupRestoreDecision::ProceedNormally);
            }
            assert_eq!(
                round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
                orig_identity
            );
            assert!(read_journal(&root).unwrap().is_none());
            assert!(!pending.exists());
            assert!(find_abandoned_temporary_journal_sibling(&root)
                .unwrap()
                .is_none());
            std::fs::remove_dir_all(&root).unwrap();
        }
    }

    #[test]
    fn task5_root_readdir_fault_observed_and_blocks_safely() {
        let root = scratch("task5-root-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let _guard = ScopedFault::set(InjectedFault::RootReadDir);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_id
        );
        drop(_guard);

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_backups_readdir_fault_observed_and_blocks_safely() {
        let root = scratch("task5-backups-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let _guard = ScopedFault::set(InjectedFault::BackupsReadDir);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_id
        );
        drop(_guard);

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_journal_read_fault_observed_and_blocks_safely() {
        let root = scratch("task5-journal-read-fault");
        write_database(&root.join(DB_FILES[0]), "active db");
        let journal = RestoreJournal::new("backups/before-restore-test".into(), false);
        write_journal(&root, &journal).unwrap();

        let _guard = ScopedFault::set(InjectedFault::JournalRead);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_plan_read_fault_observed_and_refuses_deletion() {
        let root = scratch("task5-plan-read-fault");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-test".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-read-test".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "pending db");
        let plan = RestorePlan {
            operation_id: "op-read-test".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let _guard = ScopedFault::set(InjectedFault::PlanRead);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(pending.join(DB_FILES[0]).is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_inventory_readdir_fault_observed_and_blocks() {
        let root = scratch("task5-inventory-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        write_document(&root, "orig.pdf", "doc");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "restored db");
        write_document(&pending, "new.pdf", "new doc");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let _guard = ScopedFault::set(InjectedFault::InventoryReadDir);
        let res = apply_pending_restore_in_internal(&root, || Ok(()));
        assert!(ScopedFault::hits() >= 1);
        assert!(
            res.is_err()
                || matches!(
                    res,
                    Ok(RestoreApplicationResult::Unresolved { .. })
                        | Ok(RestoreApplicationResult::RefusedUnchanged(_))
                )
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task5_real_unreadable_journal_file_blocks_startup() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("task5-real-unreadable-journal");
        write_database(&root.join(DB_FILES[0]), "active db");
        let journal_path = root.join(RESTORE_JOURNAL_FILE);
        std::fs::write(&journal_path, b"valid journal text").unwrap();

        // Lock file with exclusive access (share_mode = 0 denies read/write/delete by others)
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&journal_path)
            .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "OS denied read on journal file must block startup: {decision:?}"
        );

        drop(lock);
        std::fs::remove_dir_all(&root).unwrap();
    }
    // =========================================================================
    // ROUND 5 REGRESSIONS & FINITE CRITICAL FAILURE EVIDENCE
    // =========================================================================

    #[test]
    fn round5_journal_write_or_sync_failures_can_recover_on_restart() {
        let mut outcomes = Vec::new();
        for fault in [InjectedFault::JournalWrite, InjectedFault::JournalSync] {
            for occurrence in [1, 2] {
                let root = scratch("round5-initial-journal");
                write_database(&root.join(DB_FILES[0]), "original row");
                write_document(&root, "original.pdf", "original document");
                let original_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
                let original_docs =
                    inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
                let pending = root.join(RESTORE_PENDING_DIR);
                std::fs::create_dir_all(&pending).unwrap();
                write_database(&pending.join(DB_FILES[0]), "selected row");
                write_document(&pending, "selected.pdf", "selected document");
                write_restore_plan(&pending, RestoreKind::Complete, "synthetic test").unwrap();
                let guard = ScopedFault::set_occurrence(fault, occurrence);
                let first = apply_pending_restore_in_internal(&root, || Ok(()));
                let hits = ScopedFault::hits();
                let fired = ScopedFault::fired_count();
                drop(guard);
                let original_preserved = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])
                    == original_db
                    && inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap()
                        == original_docs;
                let second = handle_startup_restore_in(&root).unwrap();
                let third = handle_startup_restore_in(&root).unwrap();
                let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                    && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
                println!("fault={fault:?}, occurrence={occurrence}, matching_calls={hits}, fired={fired}, first={first:?}, second={second:?}, third={third:?}, originals_preserved={original_preserved}");
                outcomes.push((
                    hits >= occurrence && fired >= 1 && original_preserved,
                    recovered,
                ));
                std::fs::remove_dir_all(&root).unwrap();
            }
        }
        assert!(
            outcomes.iter().all(|(safe, _)| *safe),
            "Fault must be reached and originals conserved"
        );
        assert!(outcomes.iter().all(|(_, recovered)| *recovered), "A cleared journal fault must not leave an untouched or successfully rolled-back profile permanently blocked: {outcomes:?}");
    }

    #[test]
    fn round5_legacy_pending_activation_does_not_leave_unverifiable_owner() {
        let mut outcomes = Vec::new();
        for old_plan in [false, true] {
            let root = scratch("round5-legacy-pending");
            write_database(&root.join(DB_FILES[0]), "original row");
            write_document(&root, "handbook.pdf", "original document");
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "selected legacy row");
            write_document(&pending, "handbook.pdf", "selected legacy document");
            if old_plan {
                std::fs::write(
                    pending.join(RESTORE_PLAN),
                    br#"{"kind":"complete","source":"legacy synthetic backup"}"#,
                )
                .unwrap();
            }
            let first = handle_startup_restore_in(&root).unwrap();
            let installed = database_contents(&root.join(DB_FILES[0]));
            let second = handle_startup_restore_in(&root).unwrap();
            let third = handle_startup_restore_in(&root).unwrap();
            let healthy = first == StartupRestoreDecision::RestoreCompleted
                && installed == "selected legacy row"
                && !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
            println!("old_plan={old_plan}, first={first:?}, second={second:?}, third={third:?}, installed={installed}");
            outcomes.push(healthy);
            std::fs::remove_dir_all(&root).unwrap();
        }
        assert!(outcomes.iter().all(|ok| *ok), "Supported legacy pending restore must remain launchable after actual activation, without weakening modern unknown-owner refusal");
    }

    #[cfg(windows)]
    #[test]
    fn round5_pending_cleanup_with_windows_lock_recovers_when_plan_survives() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round5-partial-cleanup");
        write_database(&root.join(DB_FILES[0]), "committed selected row");
        write_document(&root, "handbook.pdf", "committed selected document");
        let active_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let active_docs = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        // The ownership record is created first. The later payload holds a real deny-delete handle.
        write_restore_plan(&pending, RestoreKind::Complete, "synthetic cleanup").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned leftover row");
        let mut journal = RestoreJournal::new("backups/before-restore-round5-cleanup".into(), true);
        journal.operation_id = plan.operation_id;
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(pending.join(DB_FILES[0]))
            .unwrap();
        let first = handle_startup_restore_in(&root).unwrap();
        let plan_after_first = pending.join(RESTORE_PLAN).exists();
        let payload_after_first = pending.join(DB_FILES[0]).is_file();
        drop(lock);
        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        let active_preserved = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db
            && inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap() == active_docs;
        let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
            && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
        println!("first={first:?}, plan_after_first={plan_after_first}, payload_after_first={payload_after_first}, second={second:?}, third={third:?}, active_preserved={active_preserved}");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            payload_after_first && active_preserved,
            "Real cleanup failure must preserve committed data and locked payload"
        );
        assert!(
            recovered,
            "Cleanup must recover once the real OS lock clears"
        );
    }

    #[test]
    fn round5_protection_failure_with_real_original_wal_and_shm_recovers() {
        let mut outcomes = Vec::new();
        for fault_index in [0, 1] {
            let source = scratch("round5-wal-source");
            write_database(&source.join(DB_FILES[0]), "original checkpointed row");
            let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
            conn.pragma_update(None, "journal_mode", "WAL").unwrap();
            conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
            conn.execute(
                "UPDATE audit_payload SET value = 'original committed WAL-only row'",
                [],
            )
            .unwrap();
            let root = scratch("round5-wal-active");
            // Capture a crashed-profile equivalent while the real committed WAL and SHM still exist.
            for name in DB_FILES {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
            drop(conn);
            let orig_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
            let orig_wal = round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]);
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "selected row");
            write_restore_plan(&pending, RestoreKind::Database, "synthetic test").unwrap();
            let guard = ScopedFault::set_occurrence(InjectedFault::ProtectDbRename(fault_index), 1);
            let first = handle_startup_restore_in(&root).unwrap();
            let hits = ScopedFault::hits();
            let fired = ScopedFault::fired_count();
            drop(guard);
            let second = handle_startup_restore_in(&root).unwrap();
            let third = handle_startup_restore_in(&root).unwrap();
            let conserved = root.join(DB_FILES[0]).is_file()
                && root.join(DB_FILES[1]).is_file()
                && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == orig_db
                && round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]) == orig_wal;
            // Read only after all startup invocations, so SQLite cannot change the evidence between them.
            let row = database_contents(&root.join(DB_FILES[0]));
            let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
            println!("index={fault_index}, hits={hits}, fired={fired}, first={first:?}, second={second:?}, third={third:?}, db_wal_conserved={conserved}, row={row}");
            outcomes.push((
                hits > 0 && fired >= 1 && conserved && row == "original committed WAL-only row",
                recovered,
            ));
            std::fs::remove_dir_all(&root).unwrap();
            std::fs::remove_dir_all(&source).unwrap();
        }
        assert!(
            outcomes.iter().all(|(safe, _)| *safe),
            "Original DB and committed WAL-only row must survive protection failure"
        );
        assert!(outcomes.iter().all(|(_, recovered)| *recovered), "Ephemeral SHM cache cleanup must not permanently prevent return of original committed DB/WAL: {outcomes:?}");
    }

    #[test]
    fn task4_legacy_database_restore_without_operation_id_preserves_documents() {
        let root = scratch("task4-legacy-db-plan");
        write_database(&root.join(DB_FILES[0]), "original database content");
        write_document(&root, "handbook.pdf", "original document untouched");
        let orig_doc = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db content");
        std::fs::write(
            pending.join(RESTORE_PLAN),
            br#"{"kind":"database","source":"legacy db backup"}"#,
        )
        .unwrap();

        let first = handle_startup_restore_in(&root).unwrap();
        assert_eq!(first, StartupRestoreDecision::RestoreCompleted);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "selected db content"
        );
        assert_eq!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap(),
            orig_doc,
            "Original documents must remain untouched during database-only restore"
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_pending_cleanup_interrupted_after_plan_removed_recovers_if_staged_payload_matches() {
        let root = scratch("task4-interrupted-cleanup-matching");
        write_database(&root.join(DB_FILES[0]), "active db row");
        write_document(&root, "manual.pdf", "active doc content");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged leftover row");

        let db_bytes = std::fs::read(pending.join(DB_FILES[0])).unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-cleanup-test".into(), true);
        journal.operation_id = "modern-op-987".into();
        journal.phase = RestorePhase::Committed;
        journal.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: hex::encode(Sha256::digest(&db_bytes)),
            size: db_bytes.len() as u64,
        });
        write_journal(&root, &journal).unwrap();
        // Notice: pending has NO RESTORE_PLAN (simulating interruption where plan was removed first)

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted, "Matching staged manifest must prove ownership and complete cleanup even if plan is missing");
        assert!(!pending.exists(), "Pending directory must be cleaned up");

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_pending_cleanup_interrupted_with_unknown_payload_refuses_deletion() {
        let root = scratch("task4-interrupted-cleanup-unknown");
        write_database(&root.join(DB_FILES[0]), "active db row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "unknown foreign row");

        let mut journal = RestoreJournal::new("backups/before-restore-unknown-test".into(), true);
        journal.operation_id = "modern-op-987".into();
        journal.phase = RestorePhase::Committed;
        // Staged manifest records a DIFFERENT hash
        journal.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            size: 1234,
        });
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unknown leftover payload must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).exists(),
            "Unknown payload must be conserved byte-for-byte"
        );
        assert_eq!(
            database_contents(&pending.join(DB_FILES[0])),
            "unknown foreign row"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_wal_selected_install_failure_uninstalls_wal_and_recovers_original() {
        let source = scratch("task4-wal-install-src");
        write_database(&source.join(DB_FILES[0]), "original base");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original committed row in WAL'",
            [],
        )
        .unwrap();
        let root = scratch("task4-wal-install-root");
        for name in DB_FILES {
            std::fs::copy(source.join(name), root.join(name)).unwrap();
        }
        drop(conn);

        let staged_src = scratch("task4-wal-install-staged-src");
        write_database(&staged_src.join(DB_FILES[0]), "staged new base");
        let staged_conn = Connection::open(staged_src.join(DB_FILES[0])).unwrap();
        staged_conn
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        staged_conn
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        staged_conn
            .execute(
                "UPDATE audit_payload SET value = 'staged new row in WAL'",
                [],
            )
            .unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::copy(staged_src.join(DB_FILES[0]), pending.join(DB_FILES[0])).unwrap();
        std::fs::copy(staged_src.join(DB_FILES[1]), pending.join(DB_FILES[1])).unwrap();
        drop(staged_conn);
        std::fs::remove_dir_all(&staged_src).unwrap();
        let staged_wal = std::fs::read(pending.join(DB_FILES[1])).unwrap();
        assert!(
            staged_wal.len() >= 32
                && (staged_wal[0..4] == [0x37, 0x7f, 0x06, 0x82]
                    || staged_wal[0..4] == [0x37, 0x7f, 0x06, 0x83]),
            "Selected WAL fixture must be genuine SQLite WAL format"
        );
        write_restore_plan(&pending, RestoreKind::Database, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::InstallDbRename(1));
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "InstallDbRename(1) fault must fire");
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. })
                || matches!(first, StartupRestoreDecision::RolledBackRecovered { .. })
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert!(!matches!(
            second,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(!matches!(
            third,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        let row = database_contents(&root.join(DB_FILES[0]));
        assert_eq!(
            row, "original committed row in WAL",
            "Original committed row must survive selected WAL install failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn task4_document_selected_install_failure_recovers_original_documents() {
        let root = scratch("task4-doc-install-root");
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(&root, "doc1.pdf", "original content 1");
        write_document(&root, "doc2.pdf", "original content 2");
        let orig_docs = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db");
        write_document(&pending, "selected_doc.pdf", "selected content");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::InstallDocsRename);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "InstallDocsRename fault must fire");
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. })
                || matches!(first, StartupRestoreDecision::RolledBackRecovered { .. })
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert!(!matches!(
            second,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(!matches!(
            third,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        assert_eq!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap(),
            orig_docs,
            "Original documents must be fully recovered"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_journal_delete_failure_retries_safely_without_replay() {
        let root = scratch("task4-journal-del-fail");
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(&root, "original.pdf", "original doc");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db");
        write_document(&pending, "selected.pdf", "selected doc");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::JournalDelete);
        let _first = apply_pending_restore_in_internal(&root, || Ok(()));
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "JournalDelete fault must fire");
        // Because journal delete failed, the journal file survives in terminal phase
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "selected db");

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(
            second,
            StartupRestoreDecision::RestoreCompleted,
            "Second launch must complete journal cleanup without replaying restore"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must now be removed"
        );

        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "selected db");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task4_valid_canonical_journal_under_real_windows_lock_blocks_and_recovers() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("task4-valid-journal-lock");
        write_database(&root.join(DB_FILES[0]), "active db row");
        let rollback = root.join("backups/before-restore-lock-test");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "rollback db row");

        let active_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let mut journal = RestoreJournal::new("backups/before-restore-lock-test".into(), false);
        journal.operation_id = "op-valid-lock-test".into();
        journal.phase = RestorePhase::RolledBack;
        journal.original_db_artifacts.push(active_identity);
        write_journal(&root, &journal).unwrap();
        let journal_path = root.join(RESTORE_JOURNAL_FILE);
        assert!(
            journal_path.is_file(),
            "Canonical journal must exist on disk"
        );

        // Lock with share_mode = 0 (denies all read/write/delete by other processes)
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&journal_path)
            .unwrap();

        let first = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Startup must block under real OS file lock denying read"
        );

        // Release the lock
        drop(lock);

        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Startup must return RolledBackRecovered after lock is released: {second:?}"
        );

        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db row");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn round6_cleanup_enumeration_error_must_preserve_ownership_plan() {
        fn set_list_denied(path: &Path, deny: bool) {
            let quoted = path.to_string_lossy().replace('\'', "''");
            let action = if deny {
                "AddAccessRule"
            } else {
                "RemoveAccessRuleSpecific"
            };
            let script = format!("$ErrorActionPreference='Stop'; $p='{quoted}'; $acl=[System.IO.Directory]::GetAccessControl($p); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::ListDirectory,[System.Security.AccessControl.InheritanceFlags]::None,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Deny); $acl.{action}($rule); [System.IO.Directory]::SetAccessControl($p,$acl)");
            let out = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "Could not configure isolated directory-list permission: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        struct ListPermissionGuard(PathBuf);
        impl Drop for ListPermissionGuard {
            fn drop(&mut self) {
                set_list_denied(&self.0, false);
            }
        }
        let root = scratch("round6-cleanup-enumeration");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned payload row");
        write_restore_plan(&pending, RestoreKind::Complete, "isolated permission test").unwrap();
        let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();
        let payload_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-round6-cleanup".into(), true);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = plan.operation_id;
        journal.staged_db_artifacts.push(payload_identity.clone());
        set_list_denied(&pending, true);
        let permission_guard = ListPermissionGuard(pending.clone());
        let read_error = std::fs::read_dir(&pending).err().map(|e| e.kind());
        let ownership = verify_pending_cleanup_permission(&pending, &journal);
        let cleanup = remove_pending_directory_safely(&pending);
        let plan_preserved = std::fs::read(pending.join(RESTORE_PLAN)).ok().as_deref()
            == Some(plan_bytes.as_slice());
        let payload_preserved =
            round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == payload_identity;
        drop(permission_guard);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            read_error,
            Some(std::io::ErrorKind::PermissionDenied),
            "Must reach an actual OS directory enumeration error"
        );
        assert!(
            matches!(ownership, Ok(true)),
            "Plan reading remains permitted; directory listing is denied separately"
        );
        assert!(
            cleanup.is_err() && payload_preserved,
            "Failed cleanup must preserve its payload"
        );
        assert!(plan_preserved, "Failure to enumerate payload must not unlink the ownership plan before payload deletion is complete");
    }

    #[test]
    fn round6_cleanup_entry_read_fault_preserves_plan_and_recovers_on_restart() {
        let root = scratch("round6-entry-fault");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned payload");
        write_restore_plan(&pending, RestoreKind::Complete, "entry-fault-test").unwrap();
        let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();

        let guard = ScopedFault::set(InjectedFault::PendingEntryRead);
        let cleanup_res = remove_pending_directory_safely(&pending);
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(fired >= 1, "PendingEntryRead fault must fire");
        assert!(
            cleanup_res.is_err(),
            "Cleanup must fail when entry read fails"
        );
        let plan_after = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();
        assert_eq!(
            plan_after, plan_bytes,
            "Plan must survive failed entry reading"
        );
        assert!(
            pending.join(DB_FILES[0]).exists(),
            "Payload must survive failed entry reading"
        );

        // Now clear fault and retry cleanup directly
        let cleanup_retry = remove_pending_directory_safely(&pending);
        assert!(
            cleanup_retry.is_ok(),
            "Cleanup must succeed after fault clears"
        );
        assert!(
            !pending.exists(),
            "Pending directory must be completely removed"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn round6_cleanup_obstruction_during_startup_preserves_plan_and_clears_on_restart() {
        let root = scratch("round6-startup-obstruction");
        write_database(&root.join(DB_FILES[0]), "original committed db");
        let orig_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "restored db");
        let staged_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        write_restore_plan(&pending, RestoreKind::Database, "startup-obstruction").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        // Prepare committed restore journal
        let mut journal = RestoreJournal::new("backups/test-backup".into(), false);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Committed;
        journal.staged_db_artifacts.push(staged_identity);
        write_journal(&root, &journal).unwrap();

        // Inject PendingEntryRead fault during startup cleanup
        let guard = ScopedFault::set(InjectedFault::PendingEntryRead);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "PendingEntryRead fault must fire during startup"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Startup must block unresolved when pending cleanup fails: {first:?}"
        );
        assert!(
            pending.join(RESTORE_PLAN).exists(),
            "Plan must be preserved on disk"
        );

        // Second startup after fault clears: cleanup succeeds
        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists(), "Pending directory must be deleted");
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted"
        );

        // Third startup: proceed normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original committed db"
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_identity
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_prior_canonical_journal_preserved_on_write_sync_rename_failures() {
        let root = scratch("task4-prior-canonical-bytes");
        let mut initial_journal = RestoreJournal::new("backups/before-restore-test".into(), true);
        initial_journal.phase = RestorePhase::Protecting;
        write_journal(&root, &initial_journal).unwrap();

        let canonical_path = root.join(RESTORE_JOURNAL_FILE);
        let initial_bytes = std::fs::read(&canonical_path).unwrap();
        let initial_hash = hex::encode(Sha256::digest(&initial_bytes));

        let mut updated_journal = initial_journal.clone();
        updated_journal.phase = RestorePhase::Protected;

        let faults = [
            InjectedFault::JournalTempCreate,
            InjectedFault::JournalWrite,
            InjectedFault::JournalSync,
            InjectedFault::JournalRename,
        ];

        for fault in faults {
            let guard = ScopedFault::set(fault);
            let res = write_journal(&root, &updated_journal);
            let fired = ScopedFault::fired_count();
            drop(guard);

            assert!(fired >= 1, "Fault {fault:?} must fire: fired={fired}");
            assert!(res.is_err(), "Write must return Err on {fault:?}");

            // Prior canonical bytes and hash are completely unchanged!
            let current_bytes = std::fs::read(&canonical_path).unwrap();
            let current_hash = hex::encode(Sha256::digest(&current_bytes));
            assert_eq!(
                current_bytes, initial_bytes,
                "Canonical bytes must be unchanged on {fault:?}"
            );
            assert_eq!(
                current_hash, initial_hash,
                "Canonical hash must be unchanged on {fault:?}"
            );

            // No temporary siblings remain
            let abandoned = find_abandoned_temporary_journal_sibling(&root).unwrap();
            assert!(
                abandoned.is_none(),
                "No temporary sibling must remain after {fault:?}: found {abandoned:?}"
            );

            // Once fault is cleared, write succeeds
            write_journal(&root, &updated_journal).unwrap();
            let read_back = read_journal(&root).unwrap().unwrap();
            assert_eq!(read_back.phase, RestorePhase::Protected);

            // Reset back to initial for next fault iteration
            write_journal(&root, &initial_journal).unwrap();
        }

        std::fs::remove_dir_all(&root).unwrap();
    }

    fn find_abandoned_temporary_journal_sibling(
        dir: &Path,
    ) -> Result<Option<String>, std::io::Error> {
        let prefix = format!("{RESTORE_JOURNAL_FILE}.tmp-");
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) || name.starts_with(".tmp-") {
                return Ok(Some(name));
            }
        }
        Ok(None)
    }

    #[test]
    fn task4_temporary_sibling_detector_rejects_actual_prefix_leftover_negative_control() {
        let root = scratch("task4-temp-detector-negative-control");
        assert_eq!(
            find_abandoned_temporary_journal_sibling(&root).unwrap(),
            None,
            "Clean directory must have no temporary siblings"
        );

        let seeded_name = format!("{RESTORE_JOURNAL_FILE}.tmp-negative-control-leftover");
        let seeded_path = root.join(&seeded_name);
        std::fs::write(&seeded_path, b"deliberate unremoved temporary sibling").unwrap();
        assert!(
            seeded_path.is_file(),
            "Seeded temporary file must exist on disk"
        );

        let detected = find_abandoned_temporary_journal_sibling(&root).unwrap();
        assert_eq!(
            detected.as_deref(),
            Some(seeded_name.as_str()),
            "Detector must catch the real-prefix temporary journal sibling"
        );

        std::fs::remove_file(&seeded_path).unwrap();
        assert_eq!(
            find_abandoned_temporary_journal_sibling(&root).unwrap(),
            None,
            "Detector must clear after removing the seeded temporary file"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_wal_original_return_failure_preserves_committed_wal_and_recovers() {
        let source = scratch("c1-wal-return-source");
        write_database(&source.join(DB_FILES[0]), "base content");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'committed row in WAL only'",
            [],
        )
        .unwrap();

        let root = scratch("c1-wal-return-root");
        for name in [DB_FILES[0], DB_FILES[1]] {
            std::fs::copy(source.join(name), root.join(name)).unwrap();
        }
        drop(conn);
        std::fs::remove_dir_all(&source).unwrap();

        let wal_bytes = std::fs::read(root.join(DB_FILES[1])).unwrap();
        assert!(
            wal_bytes.len() >= 32
                && (wal_bytes[0..4] == [0x37, 0x7f, 0x06, 0x82]
                    || wal_bytes[0..4] == [0x37, 0x7f, 0x06, 0x83]),
            "Original WAL must be genuine SQLite WAL format"
        );
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let orig_wal_identity = round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]);

        let rollback = root.join("backups/before-restore-c1-wal");
        std::fs::create_dir_all(&rollback).unwrap();
        // Move original DB and WAL into rollback
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();
        std::fs::rename(root.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();

        // Staged pending restore with distinct DB
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged restore content");
        write_restore_plan(&pending, RestoreKind::Database, "c1-wal-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-c1-wal".into(), false);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].to_string(), DB_FILES[1].to_string()];
        journal.original_db_artifacts = vec![orig_db_identity.clone(), orig_wal_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDbRename(1) during rollback: DB[0] returns, DB[1] (WAL) fails to return
        let guard = ScopedFault::set(InjectedFault::ReturnDbRename(1));
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDbRename(1) fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when WAL return fails: {first:?}"
        );
        // Original DB returned to root, original WAL safely retained in rollback directory
        assert!(
            root.join(DB_FILES[0]).exists(),
            "DB[0] must have returned to root"
        );
        assert!(
            rollback.join(DB_FILES[1]).exists(),
            "WAL must be safely retained in rollback"
        );
        assert_eq!(
            round3_identity(&rollback.join(DB_FILES[1]), DB_FILES[1]),
            orig_wal_identity
        );

        // Second startup: fault is cleared, rollback resumes and returns remaining WAL
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back original data: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_db_identity
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]),
            orig_wal_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        // Verify SQLite can open and query the committed WAL-only row!
        let row = database_contents(&root.join(DB_FILES[0]));
        assert_eq!(
            row, "committed row in WAL only",
            "Committed WAL-only row must survive and be readable"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_documents_original_return_failure_preserves_documents_and_recovers() {
        let root = scratch("c1-docs-return-root");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let rollback = root.join("backups/before-restore-c1-docs");
        let rollback_docs = rollback.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&rollback_docs).unwrap();

        // Two distinct original synthetic document payloads
        let doc1_path = rollback_docs.join("manual.pdf");
        let doc2_path = rollback_docs.join("checklist.txt");
        std::fs::write(&doc1_path, b"%PDF-1.4 original document bytes").unwrap();
        std::fs::write(&doc2_path, b"Preflight checklist: original items").unwrap();
        let doc1_identity = round3_identity(&doc1_path, "manual.pdf");
        let doc2_identity = round3_identity(&doc2_path, "checklist.txt");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        write_restore_plan(&pending, RestoreKind::Complete, "c1-docs-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-c1-docs".into(), true);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![orig_db_identity];
        journal.original_document_artifacts = vec![doc1_identity.clone(), doc2_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDocsRename fault during rollback
        let guard = ScopedFault::set(InjectedFault::ReturnDocsRename);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDocsRename fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when document return fails: {first:?}"
        );
        // Documents preserved in rollback folder
        assert_eq!(round3_identity(&doc1_path, "manual.pdf"), doc1_identity);
        assert_eq!(round3_identity(&doc2_path, "checklist.txt"), doc2_identity);
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Active documents dir must not be partially created on failure"
        );

        // Second startup: fault cleared, rollback returns documents
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back documents: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DOCUMENTS_DIR).join("manual.pdf"), "manual.pdf"),
            doc1_identity
        );
        assert_eq!(
            round3_identity(
                &root.join(DOCUMENTS_DIR).join("checklist.txt"),
                "checklist.txt"
            ),
            doc2_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        std::fs::remove_dir_all(&root).unwrap();
    }
}
