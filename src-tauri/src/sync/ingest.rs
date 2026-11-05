//! A W-1 phone backup turned into a change file: the S-2b export run on the
//! archive's own ledger. Reads the archive; writes only a temp copy of its
//! database, removed on every return path.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use zip::ZipArchive;

use crate::sync::export::{self, ExportedChanges};

const MANIFEST: &str = "manifest.json";
const DB_FILE: &str = "her-flight-deck.db";
const DB_WAL: &str = "her-flight-deck.db-wal";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// Largest database (or write-ahead log) we copy out of a phone backup.
const MAX_DB_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum IngestError {
    NotAPhoneBackup,
    ArchiveTooOld,
    SchemaTooNew,
    NoDeviceId,
    /// The archive came from this very device.
    SameDevice,
    /// Plain words only, never a path.
    Archive(&'static str),
    Export(export::ExportError),
}

impl std::fmt::Display for IngestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAPhoneBackup => f.write_str("That backup was not made on the phone."),
            Self::ArchiveTooOld => f.write_str(
                "This phone backup is from an older version of the app. Update the app on your phone, then make a new backup.",
            ),
            Self::SchemaTooNew => f.write_str(
                "This phone backup was made by a newer version of the app. Update the app on this computer first.",
            ),
            Self::NoDeviceId => f.write_str(
                "This phone backup does not say which phone made it. Open the app on your phone, then make a new backup.",
            ),
            Self::SameDevice => f.write_str("That file was made on this Mac."),
            Self::Archive(text) => f.write_str(text),
            Self::Export(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for IngestError {}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    platform: Option<String>,
    #[serde(default)]
    schema_version: Option<i64>,
    /// Unix seconds when the phone made the archive.
    #[serde(default)]
    created_at: Option<u64>,
    #[serde(default)]
    app_version: Option<String>,
}

/// Removes the temp dir when dropped, so every return path cleans up.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp_dir() -> Result<TempDir, IngestError> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let dir = std::env::temp_dir().join(format!("hfd-sync-ingest-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir)
        .map_err(|_| IngestError::Archive("A working folder could not be made."))?;
    Ok(TempDir(dir))
}

/// Copies one named entry (we name it, so no path from the archive is used),
/// refusing anything over the cap. `Ok(false)` when the entry is absent.
fn extract(archive: &mut ZipArchive<File>, name: &str, to: &Path) -> Result<bool, IngestError> {
    let Ok(entry) = archive.by_name(name) else {
        return Ok(false);
    };
    let too_large = IngestError::Archive("That backup's database is unexpectedly large.");
    if entry.size() > MAX_DB_BYTES {
        return Err(too_large);
    }
    let mut out = File::create(to)
        .map_err(|_| IngestError::Archive("The backup database could not be copied."))?;
    let copied = std::io::copy(&mut entry.take(MAX_DB_BYTES + 1), &mut out)
        .map_err(|_| IngestError::Archive("The backup database could not be copied."))?;
    if copied > MAX_DB_BYTES {
        return Err(too_large);
    }
    Ok(true)
}

/// What reading a phone archive gave.
pub(crate) struct Ingested {
    /// `None` when the phone has nothing after its sync floor.
    pub changes: Option<ExportedChanges>,
    /// The archive's own creation time, unix seconds.
    pub saved_at: Option<u64>,
}

/// Fixed-width ISO time for a unix-seconds manifest time, so the same archive
/// always gives the same bytes and file name.
fn iso_from_seconds(seconds: u64) -> Option<String> {
    let ms = i64::try_from(seconds).ok()?.checked_mul(1000)?;
    Some(crate::card_reviews::format_iso_ms(ms))
}

/// The phone's changes in a W-1 archive, as one change file after the
/// archive's own sync floor (the archive is a whole-ledger snapshot; re-applying
/// rows already here writes nothing). `None` when the phone's ledger is empty.
/// `local_device_id` is this device's id: an archive made here is refused.
/// `app_version` and `created_at` are fallbacks for a manifest that lacks them.
#[allow(dead_code)] // S-4 reads backups the same way
pub(crate) fn export_changes_from_archive(
    archive: &Path,
    local_device_id: Option<&str>,
    app_version: &str,
    created_at: &str,
) -> Result<Option<ExportedChanges>, IngestError> {
    ingest_archive(archive, local_device_id, app_version, created_at).map(|i| i.changes)
}

pub(crate) fn ingest_archive(
    archive: &Path,
    local_device_id: Option<&str>,
    app_version: &str,
    created_at: &str,
) -> Result<Ingested, IngestError> {
    let unreadable = IngestError::Archive("That is not a readable Flight Deck backup.");
    let file = File::open(archive).map_err(|_| unreadable)?;
    let mut zip = ZipArchive::new(file)
        .map_err(|_| IngestError::Archive("That is not a readable Flight Deck backup."))?;
    let manifest: Manifest = {
        let entry = zip
            .by_name(MANIFEST)
            .map_err(|_| IngestError::Archive("That backup does not contain a manifest."))?;
        if entry.size() > MAX_MANIFEST_BYTES {
            return Err(IngestError::Archive(
                "That backup manifest is unexpectedly large.",
            ));
        }
        let mut json = String::new();
        entry
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_string(&mut json)
            .map_err(|_| IngestError::Archive("The backup manifest is not valid."))?;
        if json.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(IngestError::Archive(
                "That backup manifest is unexpectedly large.",
            ));
        }
        serde_json::from_str(&json)
            .map_err(|_| IngestError::Archive("The backup manifest is not valid."))?
    };
    // The Mac must never take its own (or another Mac's) archive as phone work.
    if manifest.platform.as_deref() != Some("ios") {
        return Err(IngestError::NotAPhoneBackup);
    }
    if manifest
        .schema_version
        .is_some_and(|n| n > crate::CURRENT_SCHEMA_VERSION)
    {
        return Err(IngestError::SchemaTooNew);
    }

    let dir = temp_dir()?;
    let db_path = dir.0.join(DB_FILE);
    if !extract(&mut zip, DB_FILE, &db_path)? {
        return Err(IngestError::Archive(
            "That backup does not contain a database.",
        ));
    }
    extract(&mut zip, DB_WAL, &dir.0.join(DB_WAL))?;

    let bad_db = || IngestError::Archive("The backup database could not be read.");
    // A normal open: the export needs BEGIN IMMEDIATE.
    let mut copy = Connection::open(&db_path).map_err(|_| bad_db())?;
    let has_ledger: bool = copy
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_changes'",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(|_| bad_db())?
        .is_some();
    if !has_ledger {
        return Err(IngestError::ArchiveTooOld);
    }
    let device_id: Option<String> = copy
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'device_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| bad_db())?;
    let device_id = match device_id {
        Some(id) if !id.is_empty() => id,
        _ => return Err(IngestError::NoDeviceId),
    };
    if local_device_id == Some(device_id.as_str()) {
        return Err(IngestError::SameDevice);
    }
    // Parsed like `exported_through_seq`: text, junk means 0.
    let since_seq = export::sync_floor_seq(&copy).map_err(|_| bad_db())?;
    let stamp = manifest
        .created_at
        .and_then(iso_from_seconds)
        .unwrap_or_else(|| created_at.to_string());
    let version = manifest
        .app_version
        .as_deref()
        .filter(|v| !v.is_empty() && v.len() <= 64)
        .unwrap_or(app_version);
    let changes = export::export_changes_in(&mut copy, &device_id, since_seq, version, &stamp)
        .map_err(IngestError::Export);
    drop(copy);
    drop(dir);
    Ok(Ingested {
        changes: changes?,
        saved_at: manifest.created_at,
    })
}
