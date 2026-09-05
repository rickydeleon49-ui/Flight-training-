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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    /// Seconds since the Unix epoch, for the interface to format.
    pub created_at: u64,
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
    pub app_version: String,
    pub created_at: u64,
    pub files: usize,
    pub bytes: u64,
    pub path: String,
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join(BACKUP_DIR);
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

/// Copy the database and its sidecar files into a named backup folder.
///
/// Returns None when there is no database yet, which is the normal case on a
/// very first run.
fn copy_database(app: &AppHandle, label: &str) -> Result<Option<PathBuf>, String> {
    let data = app_root(app)?;
    let main = data.join(DB_FILES[0]);
    if !main.is_file() {
        return Ok(None);
    }

    let destination = backup_dir(app)?.join(label);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("Could not create the backup folder: {e}"))?;

    for name in DB_FILES {
        let from = data.join(name);
        if from.is_file() {
            std::fs::copy(&from, destination.join(name))
                .map_err(|e| format!("Could not copy {name}: {e}"))?;
        }
    }

    Ok(Some(destination))
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
    if path == Path::new(ARCHIVE_MANIFEST) || path == Path::new(DB_FILES[0]) {
        return !is_dir;
    }
    if path.starts_with(DOCUMENTS_DIR) {
        return is_dir || path.components().count() > 1;
    }
    false
}

fn inspect_archive(source: &Path) -> Result<CompleteBackupInfo, String> {
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
        let entry = archive
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
        created_at: manifest.created_at,
        files,
        bytes,
        path: source.to_string_lossy().to_string(),
    })
}

/// Remove the oldest automatic backups, keeping the most recent ones.
fn prune(app: &AppHandle) -> Result<(), String> {
    let dir = backup_dir(app)?;
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
    let data = app_root(app)?;
    std::fs::create_dir_all(&data)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;

    let marker = data.join(VERSION_FILE);
    let current = app.package_info().version.to_string();
    let previous = std::fs::read_to_string(&marker).unwrap_or_default();
    let previous = previous.trim();

    if previous == current {
        return Ok(());
    }

    if !previous.is_empty() {
        // Only worth a copy when there was a previous version to upgrade from.
        let label = format!("{}-before-{}", timestamp(), current);
        copy_database(app, &label)?;
        prune(app)?;
    }

    std::fs::write(&marker, &current)
        .map_err(|e| format!("Could not record the application version: {e}"))?;
    Ok(())
}

/* ------------------------------ commands ------------------------------- */

/// Make a copy right now, on request.
#[tauri::command]
pub fn create_backup(app: AppHandle) -> Result<String, String> {
    let label = format!("{}-manual", timestamp());
    match copy_database(&app, &label)? {
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
    let root = app_root(&app)?;
    let database = root.join(DB_FILES[0]);
    if !database.is_file() {
        return Err("There is no database to back up yet.".to_string());
    }

    let requested_destination = PathBuf::from(&destination_path);
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
            app_version: app.package_info().version.to_string(),
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
pub fn inspect_complete_backup(source_path: String) -> Result<CompleteBackupInfo, String> {
    inspect_archive(Path::new(&source_path))
}

/// Validate and extract into a private staging directory. Current data is untouched.
#[tauri::command]
pub fn stage_complete_restore(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    let source = PathBuf::from(&source_path);
    let info = inspect_archive(&source)?;
    let root = app_root(&app)?;
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

    let result = (|| {
        let file = File::open(&source).map_err(|e| format!("Could not open that backup: {e}"))?;
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
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result.map(|()| info)
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
    let root = app_root(app)?;
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

    let rollback = backup_dir(app)?.join(format!("{}-before-restore", timestamp()));
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
        if current_documents.exists() {
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

        let restored_documents = pending.join(DOCUMENTS_DIR);
        if restored_documents.exists() {
            std::fs::rename(&restored_documents, &current_documents)
                .map_err(|e| format!("Could not install the restored documents: {e}"))?;
        } else {
            std::fs::create_dir_all(&current_documents)
                .map_err(|e| format!("Could not create the restored documents folder: {e}"))?;
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
        if current_documents.exists() {
            let _ = std::fs::remove_dir_all(&current_documents);
        }
        let previous_documents = rollback.join(DOCUMENTS_DIR);
        if previous_documents.exists() {
            let _ = std::fs::rename(previous_documents, &current_documents);
        }
        let _ = std::fs::remove_dir_all(&pending);
        let _ = std::fs::remove_dir_all(&rollback);
        return Err(format!(
            "Restore failed and the previous data was recovered: {error}"
        ));
    }

    std::fs::remove_dir_all(&pending)
        .map_err(|e| format!("The restore succeeded, but staging could not be cleaned up: {e}"))?;
    prune(app)?;
    Ok(())
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let dir = backup_dir(&app)?;
    let mut backups: Vec<BackupInfo> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read the backup directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .map(|entry| {
            let path = entry.path();
            BackupInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                bytes: directory_size(&path),
                created_at: entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                path: path.to_string_lossy().to_string(),
            }
        })
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
