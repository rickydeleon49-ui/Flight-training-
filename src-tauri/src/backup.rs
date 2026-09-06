//! Protecting her training record across updates.
//!
//! Structured data and the profile photo live in SQLite; uploaded study files
//! live beside it in private application storage. Automatic upgrade copies
//! protect the database from migration mistakes. User-requested portable
//! archives protect the database and every uploaded document together.
//!
//! The backup happens in Tauri's setup, before the frontend opens the
//! database and therefore before any migration runs.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::storage::app_root;

/// Where copies are kept, inside application data.
const BACKUP_DIR: &str = "backups";
/// Records which version last ran, so an upgrade can be detected.
const VERSION_FILE: &str = "last-run-version.txt";
const DOCUMENTS_DIR: &str = "documents";
const ARCHIVE_MANIFEST: &str = "manifest.json";
const ARCHIVE_FORMAT: &str = "her-flight-deck-complete-backup";
const ARCHIVE_VERSION: u32 = 1;
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
) -> Result<u64, String> {
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
    std::io::copy(&mut input, archive)
        .map_err(|e| format!("Could not copy {} into the backup: {e}", source.display()))?;
    Ok(metadata.len())
}

fn add_documents_to_archive<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    directory: &Path,
    relative: &Path,
    files: &mut usize,
    bytes: &mut u64,
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
            add_documents_to_archive(archive, &entry.path(), &next_relative, files, bytes)?;
        } else if metadata.is_file() {
            let name = Path::new(DOCUMENTS_DIR)
                .join(&next_relative)
                .to_string_lossy()
                .replace('\\', "/");
            *bytes = bytes
                .checked_add(add_file_to_archive(archive, &entry.path(), &name)?)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            *files += 1;
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

    if manifest.format != ARCHIVE_FORMAT || manifest.format_version != ARCHIVE_VERSION {
        return Err("That backup format is not supported by this version of the app.".to_string());
    }

    let mut names = HashSet::new();
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut has_database = false;

    if archive.len() > MAX_RESTORE_FILES + 1 {
        return Err("That backup contains too many files.".to_string());
    }

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| zip_error("Could not inspect the backup", e))?;
        let raw_name = entry.name().to_string();
        if raw_name.contains('\\') {
            return Err("The backup contains an unsafe file path.".to_string());
        }
        let path = entry
            .enclosed_name()
            .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
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

        if path == Path::new(DB_FILES[0]) {
            // Read the first bytes now. A truncated or wrong file is far
            // better discovered here than after her data has been moved aside.
            let mut header = [0u8; SQLITE_MAGIC.len()];
            if entry.read_exact(&mut header).is_err() || !is_sqlite_header(&header) {
                return Err(
                    "The database in that backup is damaged, or that file is not a Her Flight Deck backup."
                        .to_string(),
                );
            }
            has_database = true;
        }
        if path != Path::new(ARCHIVE_MANIFEST) && !entry.is_dir() {
            files += 1;
            bytes = bytes
                .checked_add(entry.size())
                .ok_or_else(|| "The backup is too large.".to_string())?;
            if bytes > MAX_RESTORE_BYTES {
                return Err("That backup is larger than this app can safely restore.".to_string());
            }
        }
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
    match copy_database(&app_root(&app)?, "manual")? {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("There is no database to back up yet.".to_string()),
    }
}

/// Export one portable file containing the database and every imported document.
#[tauri::command]
pub fn create_complete_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<CompleteBackupInfo, String> {
    write_complete_backup(
        &app_root(&app)?,
        Path::new(&destination_path),
        &app.package_info().version.to_string(),
    )
}

/// Write the archive itself, against plain directories so it can be tested.
fn write_complete_backup(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let database = root.join(DB_FILES[0]);
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

        let mut files = 1usize;
        let mut bytes = add_file_to_archive(&mut archive, &database, DB_FILES[0])?;
        if bytes > MAX_RESTORE_BYTES {
            return Err("The database is too large to put in one safe backup.".to_string());
        }

        // The interface checkpoints the write-ahead log before calling this, so
        // it is normally empty. If a checkpoint could not finish — another
        // connection was mid-read — her newest entries live only in the log, so
        // it goes into the archive and SQLite folds it back in on restore.
        let wal = root.join(DB_FILES[1]);
        if std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0 {
            bytes = bytes
                .checked_add(add_file_to_archive(&mut archive, &wal, DB_FILES[1])?)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            files += 1;
        }

        add_documents_to_archive(
            &mut archive,
            &root.join(DOCUMENTS_DIR),
            Path::new(""),
            &mut files,
            &mut bytes,
        )?;

        let output = archive
            .finish()
            .map_err(|e| zip_error("Could not finish the backup", e))?;
        output
            .sync_all()
            .map_err(|e| format!("Could not finish writing the backup: {e}"))?;

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
        let mut extracted_files = 0usize;
        let mut extracted_bytes = 0u64;
        let mut extracted_names = HashSet::new();

        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|e| zip_error("Could not read a file from the backup", e))?;
            let raw_name = entry.name().to_string();
            if raw_name.contains('\\') {
                return Err("The backup contains an unsafe file path.".to_string());
            }
            let path = entry
                .enclosed_name()
                .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
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
            if path == Path::new(ARCHIVE_MANIFEST) {
                continue;
            }
            let destination = staging.join(path);
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
        }

        if !staging.join(DB_FILES[0]).is_file() {
            return Err("That backup does not contain a usable database.".to_string());
        }
        // Check the extracted file itself, not just what the archive claimed.
        verify_sqlite_file(&staging.join(DB_FILES[0]))?;
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

    /// A file with SQLite's header and recognizable contents after it.
    fn write_database(path: &Path, contents: &str) {
        let mut bytes = SQLITE_MAGIC.to_vec();
        bytes.extend_from_slice(contents.as_bytes());
        bytes.extend_from_slice(&[0u8; 64]);
        std::fs::write(path, bytes).unwrap();
    }

    fn database_contents(path: &Path) -> String {
        let bytes = std::fs::read(path).unwrap();
        String::from_utf8_lossy(&bytes[SQLITE_MAGIC.len()..])
            .trim_end_matches('\0')
            .to_string()
    }

    fn write_document(root: &Path, relative: &str, contents: &str) {
        let path = root.join(DOCUMENTS_DIR).join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn document_contents(root: &Path, relative: &str) -> Option<String> {
        std::fs::read_to_string(root.join(DOCUMENTS_DIR).join(relative)).ok()
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
        std::fs::write(
            root.join(DB_FILES[1]),
            b"pages written since the last checkpoint",
        )
        .unwrap();

        let archive = elsewhere.join("with-log.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.files, 2);

        std::fs::remove_file(root.join(DB_FILES[1])).unwrap();
        write_database(&root.join(DB_FILES[0]), "something else entirely");

        stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "checkpointed pages"
        );
        assert_eq!(
            std::fs::read(root.join(DB_FILES[1])).unwrap(),
            b"pages written since the last checkpoint"
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
                    format_version: ARCHIVE_VERSION,
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
}
