//! Protecting her training record across updates.
//!
//! Everything she puts into the application lives in one SQLite file in the
//! application data directory. Two things could put that at risk when a new
//! version is installed: a migration that goes wrong, and a mistake in a
//! future release. So before the first run of any new version, the database
//! is copied aside — untouched, exactly as the previous version left it.
//!
//! The backup happens in Tauri's setup, before the frontend opens the
//! database and therefore before any migration runs.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::storage::app_root;

/// Where copies are kept, inside application data.
const BACKUP_DIR: &str = "backups";
/// Records which version last ran, so an upgrade can be detected.
const VERSION_FILE: &str = "last-run-version.txt";
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

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join(BACKUP_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the backup directory: {e}"))?;
    Ok(dir)
}

/// A filesystem-safe stamp, e.g. "2026-09-05-174233".
fn timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

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
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}

/// The folder holding her database, documents and backups.
#[tauri::command]
pub fn data_directory(app: AppHandle) -> Result<String, String> {
    Ok(app_root(&app)?.to_string_lossy().to_string())
}
