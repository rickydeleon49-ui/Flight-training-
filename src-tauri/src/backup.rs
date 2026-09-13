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
const ARCHIVE_VERSION: u32 = 2;
const LEGACY_ARCHIVE_VERSION: u32 = 1;
const RESTORE_STAGING_DIR: &str = ".restore-staging";
const RESTORE_PENDING_DIR: &str = ".restore-pending";
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

fn sha256_file(path: &Path) -> Result<(u64, String), String> {
    let mut file = File::open(path)
        .map_err(|e| format!("Could not verify restored file {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Could not verify restored file {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
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

fn inspect_archive(source: &Path, current_app_version: &str) -> Result<CompleteBackupInfo, String> {
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
            LEGACY_ARCHIVE_VERSION | ARCHIVE_VERSION
        )
    {
        return Err("That backup format is not supported by this version of the app.".to_string());
    }

    let mut expected_integrity = if manifest.format_version == ARCHIVE_VERSION {
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

    Ok(CompleteBackupInfo {
        app_version: manifest.app_version,
        current_app_version: current_app_version.to_string(),
        created_at: manifest.created_at,
        files,
        bytes,
        path: source.to_string_lossy().to_string(),
    })
}

/// Remove the oldest automatic backups, keeping the most recent ones.
fn prune(root: &Path) -> Result<(), String> {
    let dir = backup_dir(root)?;
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read the backup directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
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
pub fn create_backup(app: AppHandle) -> Result<String, String> {
    create_consistent_local_backup(&app_root(&app)?)
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
pub fn create_complete_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<CompleteBackupInfo, String> {
    let root = app_root(&app)?;
    let snapshot = database_snapshot_with_retry(&root)?;
    let result = write_complete_backup_from_database(
        &root,
        Path::new(&destination_path),
        &app.package_info().version.to_string(),
        &snapshot,
        false,
        true,
    );
    let _ = std::fs::remove_file(snapshot);
    result
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
    )
}

fn write_complete_backup_from_database(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
    database: &Path,
    include_wal: bool,
    verify_before_finish: bool,
) -> Result<CompleteBackupInfo, String> {
    if !database.is_file() {
        return Err("There is no database to back up yet.".to_string());
    }

    let requested_destination = destination_path.to_path_buf();
    let file_name = requested_destination
        .file_name()
        .ok_or_else(|| "Choose a valid backup file name.".to_string())?;
    let parent = requested_destination
        .parent()
        .ok_or_else(|| "Choose a valid backup location.".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create the backup location: {e}"))?;
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("Could not verify the backup location: {e}"))?;
    let private_root = root
        .canonicalize()
        .map_err(|e| format!("Could not verify the application data folder: {e}"))?;
    if parent.starts_with(&private_root) {
        return Err("Choose a backup location outside the application's data folder.".to_string());
    }
    let destination = parent.join(file_name);

    let temporary = PathBuf::from(format!("{}.part", destination.to_string_lossy()));
    if temporary.exists() {
        std::fs::remove_file(&temporary)
            .map_err(|e| format!("Could not replace an unfinished backup: {e}"))?;
    }

    let result = (|| {
        let output = File::create(&temporary)
            .map_err(|e| format!("Could not create the backup file: {e}"))?;
        let mut archive = ZipWriter::new(output);
        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: app_version.to_string(),
            created_at: unix_timestamp(),
        };

        archive
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .map_err(|e| zip_error("Could not write the backup manifest", e))?;
        archive
            .write_all(
                serde_json::to_string_pretty(&manifest)
                    .map_err(|e| format!("Could not prepare the backup manifest: {e}"))?
                    .as_bytes(),
            )
            .map_err(|e| format!("Could not write the backup manifest: {e}"))?;

        let mut integrity = Vec::new();
        let saved_database = add_file_to_archive(&mut archive, database, DB_FILES[0])?;
        let mut files = 1usize;
        let mut bytes = saved_database.bytes;
        integrity.push(saved_database);
        if bytes > MAX_RESTORE_BYTES {
            return Err("The database is too large to put in one safe backup.".to_string());
        }

        // The production path archives an online SQLite snapshot and therefore
        // never needs a WAL. Tests retain this option to prove that legacy v1
        // archives carrying a real WAL still restore correctly.
        let wal = root.join(DB_FILES[1]);
        if include_wal && std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0 {
            let saved_wal = add_file_to_archive(&mut archive, &wal, DB_FILES[1])?;
            bytes = bytes
                .checked_add(saved_wal.bytes)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            files += 1;
            integrity.push(saved_wal);
        }

        add_documents_to_archive(
            &mut archive,
            &root.join(DOCUMENTS_DIR),
            Path::new(""),
            &mut files,
            &mut bytes,
            &mut integrity,
        )?;

        integrity.sort_by(|left, right| left.path.cmp(&right.path));
        archive
            .start_file(ARCHIVE_INTEGRITY, archive_options())
            .map_err(|e| zip_error("Could not write backup integrity data", e))?;
        archive
            .write_all(
                serde_json::to_string_pretty(&CompleteBackupIntegrity {
                    algorithm: "sha256".to_string(),
                    files: integrity,
                })
                .map_err(|e| format!("Could not prepare backup integrity data: {e}"))?
                .as_bytes(),
            )
            .map_err(|e| format!("Could not write backup integrity data: {e}"))?;

        let output = archive
            .finish()
            .map_err(|e| zip_error("Could not finish the backup", e))?;
        output
            .sync_all()
            .map_err(|e| format!("Could not finish writing the backup: {e}"))?;

        // Read the file back and run it through the same validation a
        // restore would — readable ZIP, manifest, integrity inventory,
        // structural limits — before it is ever renamed into place or
        // reported as saved. Writing bytes successfully is not the same
        // guarantee as the result actually being a usable backup.
        if verify_before_finish {
            inspect_archive(&temporary, app_version).map_err(|e| {
                format!("The backup was written but did not pass its own integrity check: {e}")
            })?;
        }

        if destination.exists() {
            if destination.is_dir() {
                return Err("The selected backup location is a folder.".to_string());
            }
            let replaced = PathBuf::from(format!("{}.replaced", destination.to_string_lossy()));
            if replaced.exists() {
                std::fs::remove_file(&replaced)
                    .map_err(|e| format!("Could not clear an unfinished replacement: {e}"))?;
            }
            std::fs::rename(&destination, &replaced)
                .map_err(|e| format!("Could not protect the existing backup: {e}"))?;
            if let Err(error) = std::fs::rename(&temporary, &destination) {
                let _ = std::fs::rename(&replaced, &destination);
                return Err(format!("Could not save the completed backup: {error}"));
            }
            let _ = std::fs::remove_file(replaced);
        } else {
            std::fs::rename(&temporary, &destination)
                .map_err(|e| format!("Could not save the completed backup: {e}"))?;
        }

        Ok(CompleteBackupInfo {
            current_app_version: manifest.app_version.clone(),
            app_version: manifest.app_version,
            created_at: manifest.created_at,
            files,
            bytes,
            path: destination.to_string_lossy().to_string(),
        })
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub fn inspect_complete_backup(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    inspect_archive(
        Path::new(&source_path),
        &app.package_info().version.to_string(),
    )
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

    if staging.exists() {
        std::fs::remove_dir_all(&staging)
            .map_err(|e| format!("Could not clear an unfinished restore: {e}"))?;
    }
    if pending.exists() {
        std::fs::remove_dir_all(&pending)
            .map_err(|e| format!("Could not replace an unfinished restore: {e}"))?;
    }
    std::fs::create_dir_all(&staging).map_err(|e| format!("Could not prepare the restore: {e}"))?;
    Ok((staging, pending))
}

/// Record what the staged folder is meant to replace, next to the staged files.
fn write_restore_plan(staging: &Path, kind: RestoreKind, source: &str) -> Result<(), String> {
    let plan = RestorePlan {
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

/// Read back that record. An unreadable or absent plan means a complete
/// archive, which is what every earlier version staged.
fn read_restore_plan(pending: &Path) -> RestorePlan {
    std::fs::read_to_string(pending.join(RESTORE_PLAN))
        .ok()
        .and_then(|json| serde_json::from_str::<RestorePlan>(&json).ok())
        .unwrap_or(RestorePlan {
            kind: RestoreKind::Complete,
            source: String::new(),
        })
}

/// Validate and extract into a private staging directory. Current data is untouched.
#[tauri::command]
pub fn stage_complete_restore(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    stage_complete_restore_in(
        &app_root(&app)?,
        Path::new(&source_path),
        &app.package_info().version.to_string(),
    )
}

/// Unpack and check an archive into staging, against a plain directory.
fn stage_complete_restore_in(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let info = inspect_archive(source, current_app_version)?;
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
            let restored_bytes = std::io::copy(
                &mut entry.take(expected_size.saturating_add(1)),
                &mut output,
            )
            .map_err(|e| format!("Could not restore a file: {e}"))?;
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
                let (actual_bytes, actual_sha256) = sha256_file(&destination)?;
                if actual_bytes != expected.bytes
                    || !actual_sha256.eq_ignore_ascii_case(&expected.sha256)
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
pub fn stage_local_restore(app: AppHandle, name: String) -> Result<BackupInfo, String> {
    stage_local_restore_in(&app_root(&app)?, &name)
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

/// Install a restore that was fully validated and staged during the previous run.
///
/// This runs during setup, before the SQL connection opens. Existing data is
/// moved into a recoverable internal backup first and put back if installation
/// fails at any point.
pub fn apply_pending_restore(app: &AppHandle) -> Result<(), String> {
    apply_pending_restore_in(&app_root(app)?)
}

/// Install whatever was staged, against a plain directory.
fn apply_pending_restore_in(root: &Path) -> Result<(), String> {
    apply_pending_restore_in_with(root, || Ok(()))
}

fn apply_pending_restore_in_with<F>(root: &Path, before_install: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    let pending = root.join(RESTORE_PENDING_DIR);
    if !pending.is_dir() {
        return Ok(());
    }
    if !pending.join(DB_FILES[0]).is_file() {
        let _ = std::fs::remove_dir_all(&pending);
        return Err(
            "A staged restore was incomplete; current data was left unchanged.".to_string(),
        );
    }
    // Last chance to refuse before her current data is moved: staging checked
    // this too, but the file has been sitting on disk across a restart since.
    if let Err(error) = verify_sqlite_file(&pending.join(DB_FILES[0])) {
        let _ = std::fs::remove_dir_all(&pending);
        return Err(format!(
            "The staged restore was not usable, so nothing was changed: {error}"
        ));
    }

    let plan = read_restore_plan(&pending);
    // A safety copy holds the database alone. Replacing the documents folder
    // with an empty one would throw away every uploaded file she still has.
    let replace_documents = plan.kind == RestoreKind::Complete;

    let rollback = unique_backup_path(&backup_dir(root)?, "before-restore");
    std::fs::create_dir_all(&rollback)
        .map_err(|e| format!("Could not prepare a recovery copy before restoring: {e}"))?;

    let current_documents = root.join(DOCUMENTS_DIR);
    let protect_result = (|| {
        for name in DB_FILES {
            let current = root.join(name);
            if current.exists() {
                std::fs::rename(&current, rollback.join(name))
                    .map_err(|e| format!("Could not protect the current {name}: {e}"))?;
            }
        }
        if replace_documents && current_documents.exists() {
            std::fs::rename(&current_documents, rollback.join(DOCUMENTS_DIR))
                .map_err(|e| format!("Could not protect the current documents: {e}"))?;
        }
        Ok::<(), String>(())
    })();

    if let Err(error) = protect_result {
        for name in DB_FILES {
            let previous = rollback.join(name);
            if previous.exists() {
                let _ = std::fs::rename(previous, root.join(name));
            }
        }
        let previous_documents = rollback.join(DOCUMENTS_DIR);
        if previous_documents.exists() {
            let _ = std::fs::rename(previous_documents, &current_documents);
        }
        let _ = std::fs::remove_dir_all(&rollback);
        return Err(format!(
            "Restore was stopped before changing current data: {error}"
        ));
    }

    let install_result = (|| {
        before_install()?;
        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0]))
            .map_err(|e| format!("Could not install the restored database: {e}"))?;

        // A write-ahead log only travels with a backup when a checkpoint could
        // not finish. SQLite folds it back into the database on first open.
        let restored_wal = pending.join(DB_FILES[1]);
        if restored_wal.is_file() {
            std::fs::rename(&restored_wal, root.join(DB_FILES[1]))
                .map_err(|e| format!("Could not install the restored database log: {e}"))?;
        }

        if replace_documents {
            let restored_documents = pending.join(DOCUMENTS_DIR);
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
        for name in DB_FILES {
            let partial = root.join(name);
            if partial.exists() {
                let _ = std::fs::remove_file(partial);
            }
            let previous = rollback.join(name);
            if previous.exists() {
                let _ = std::fs::rename(previous, root.join(name));
            }
        }
        if replace_documents {
            if current_documents.exists() {
                let _ = std::fs::remove_dir_all(&current_documents);
            }
            let previous_documents = rollback.join(DOCUMENTS_DIR);
            if previous_documents.exists() {
                let _ = std::fs::rename(previous_documents, &current_documents);
            }
        }
        let _ = std::fs::remove_dir_all(&pending);
        let _ = std::fs::remove_dir_all(&rollback);
        return Err(format!(
            "Restore failed and the previous data was recovered: {error}"
        ));
    }

    std::fs::remove_dir_all(&pending)
        .map_err(|e| format!("The restore succeeded, but staging could not be cleaned up: {e}"))?;
    prune(root)?;
    Ok(())
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

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

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
                 CREATE TABLE study_materials (id TEXT PRIMARY KEY);
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
        std::fs::write(path, contents).unwrap();
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
            kind: RestoreKind::Database,
            source: "2026-09-05-174233-before-0.3.0".to_string(),
        })
        .unwrap();
        let read: RestorePlan = serde_json::from_str(&json).unwrap();
        assert_eq!(read.kind, RestoreKind::Database);
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

        assert!(inspect_archive(&archive, "0.2.0").is_err());
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

        let refusal = inspect_archive(&archive, "0.2.0").unwrap_err();
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
    fn a_same_size_content_change_fails_the_integrity_check() {
        let root = scratch("checksum");
        let elsewhere = scratch("checksum-out");
        write_database(&root.join(DB_FILES[0]), "training record");
        write_document(&root, "handbook.pdf", "original bytes");
        let archive = elsewhere.join("checked.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        rewrite_entry(&archive, "documents/handbook.pdf", b"tampered bytes");
        let error = inspect_archive(&archive, "0.5.1").unwrap_err();
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
}
