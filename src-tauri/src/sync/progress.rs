//! Bring the work a student did on her iPhone into the Mac: a W-1 phone
//! backup is read, its changes are applied under the usual rules, and the
//! PDFs the backup carries are put in the library. Every error reaches the
//! student as a fixed plain sentence; no path or internal wording escapes.

use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use zip::ZipArchive;

use crate::phone_work::{UnsavedPhoneWork, KINDS};
use crate::sync::apply::{apply_change_file, ApplyError};
use crate::sync::blobs::{self, BlobError, MaterialBlob, PlaceOutcome};
use crate::sync::changeset::{self, Change, Op};
use crate::sync::ingest::{self, IngestError};
use crate::sync::tables::{self, MergeRule};

const DB_FILE: &str = "her-flight-deck.db";
const ARCHIVE_DOCUMENTS: &str = "documents";
const BUSY: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgressOutcome {
    Added,
    AlreadyIn,
    NothingNew,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneProgress {
    pub outcome: ProgressOutcome,
    pub counts: UnsavedPhoneWork,
    pub pdfs_added: u32,
    pub pdfs_waiting: u32,
    /// When the phone saved the file, unix seconds.
    pub phone_saved_at: Option<u64>,
    pub from_future: bool,
}

const OVERLAP: &str = "Part of that file overlaps work already on this Mac, so nothing was changed. Keep the file \u{2014} a later update will take it.";
const UNREADABLE_FILE: &str =
    "That file couldn't be read as phone work. Nothing on this Mac was changed.";
const NOT_SAVED: &str = "That file couldn't be brought in. Nothing on this Mac was changed.";
const NEEDS_EARLIER: &str = "That file needs earlier work from your iPhone that isn't on this Mac yet. Nothing on this Mac was changed.";
const NEWER_APP: &str =
    "That file was made by a newer version of the app. Update the app on this Mac first.";
const STOPPED_PARTWAY: &str = "Some of that file was brought in, then it stopped. What's here is safe. Keep the file \u{2014} a later update may take the rest.";
const NO_LIBRARY: &str = "This Mac's study library couldn't be opened. Nothing was changed.";

fn ingest_message(error: &IngestError) -> String {
    match error {
        IngestError::Export(_) => UNREADABLE_FILE.to_string(),
        other => other.to_string(),
    }
}

fn apply_message(error: &ApplyError) -> &'static str {
    match error {
        ApplyError::Db(rusqlite::Error::SqliteFailure(e, _))
            if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
        {
            OVERLAP
        }
        ApplyError::MissingParent(_) => NEEDS_EARLIER,
        ApplyError::UnknownTable | ApplyError::UnknownColumn(_) | ApplyError::BadRow => {
            UNREADABLE_FILE
        }
        ApplyError::Replay(_) | ApplyError::Db(_) => NOT_SAVED,
    }
}

/// Removes its folder when dropped.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp_dir() -> Result<TempDir, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let dir = std::env::temp_dir().join(format!("hfd-progress-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|_| NOT_SAVED.to_string())?;
    Ok(TempDir(dir))
}

pub(crate) fn open_app_db(root: &Path) -> Result<Connection, String> {
    let path = root.join(DB_FILE);
    if !path.is_file() {
        return Err(NO_LIBRARY.to_string());
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|_| NO_LIBRARY.to_string())?;
    conn.busy_timeout(BUSY)
        .map_err(|_| NO_LIBRARY.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| NO_LIBRARY.to_string())?;
    Ok(conn)
}

fn zero_counts() -> UnsavedPhoneWork {
    UnsavedPhoneWork {
        reviews: 0,
        tests: 0,
        bookmarks: 0,
        reading_positions: 0,
        materials: 0,
        guides: 0,
        generated_tests: 0,
        since: None,
    }
}

/// Whether applying `change` would change this row: it is not here yet, or it
/// is a newer edit of a row that edits in place. Read before the apply.
fn would_change_row(conn: &Connection, change: &Change) -> bool {
    if change.op == Op::Delete {
        return false;
    }
    let Some(table) = tables::table(&change.table) else {
        return false;
    };
    let exists = conn
        .query_row(
            &format!(
                "SELECT 1 FROM {} WHERE {} = ?1",
                table.name, table.primary_key
            ),
            [&change.row_id],
            |_| Ok(()),
        )
        .optional()
        .unwrap_or(None)
        .is_some();
    if !exists {
        return true;
    }
    if !matches!(table.rule, MergeRule::Lww | MergeRule::LwwTombstone) {
        return false;
    }
    let local: Option<String> = conn
        .query_row(
            "SELECT changed_at FROM sync_row_meta WHERE table_name = ?1 AND row_id = ?2",
            [&change.table, &change.row_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    let Some(local) = local else {
        return true;
    };
    match (
        crate::card_reviews::parse_iso_ms(&change.changed_at),
        crate::card_reviews::parse_iso_ms(&local),
    ) {
        (Some(incoming), Some(here)) => incoming > here,
        _ => true,
    }
}

/// What the file would add, by the kinds the phone-work card counts.
fn count_changes(conn: &Connection, changes: &[Change]) -> UnsavedPhoneWork {
    let mut slots = [0i64; KINDS.len()];
    for change in changes {
        let Some(slot) = KINDS.iter().position(|(table, _)| *table == change.table) else {
            continue;
        };
        if would_change_row(conn, change) {
            slots[slot] += 1;
        }
    }
    UnsavedPhoneWork {
        reviews: slots[0],
        tests: slots[1],
        bookmarks: slots[2],
        reading_positions: slots[3],
        materials: slots[4],
        guides: slots[5],
        generated_tests: slots[6],
        since: None,
    }
}

/// Where a PDF sits inside the file being read.
#[derive(Clone, Copy)]
enum PdfSource {
    /// A full copy: `documents/<path>`.
    Backup,
    /// A progress file: `blobs/<content hash>`.
    Progress,
}

impl PdfSource {
    fn entry_name(self, file: &blobs::MaterialFile) -> Option<String> {
        match self {
            Self::Backup => Some(format!("{ARCHIVE_DOCUMENTS}/{}", file.relative_path)),
            Self::Progress => blobs::is_blob_name(&file.content_sha256)
                .then(|| format!("blobs/{}", file.content_sha256)),
        }
    }
}

/// Copies one PDF from the archive into the staging folder by its content
/// hash. `false` when the archive does not hold it or it does not match.
fn stage_pdf(zip: &mut ZipArchive<File>, staging: &Path, entry_name: &str, sha: &str) -> bool {
    let Ok(entry) = zip.by_name(entry_name) else {
        return false;
    };
    blobs::put_blob(
        staging,
        std::io::Read::take(entry, blobs::MAX_BLOB_BYTES + 1),
        Some(sha),
    )
    .is_ok()
}

/// Puts one material's PDF in the library. `Some(true)` placed now,
/// `Some(false)` is not here yet, `None` nothing to do (no file, or already
/// there).
fn place_pdf(
    conn: &Connection,
    root: &Path,
    staging: &Path,
    zip: Option<&mut ZipArchive<File>>,
    source: PdfSource,
    material_id: &str,
) -> Option<bool> {
    // Already in the library, or the material has no file.
    match blobs::place_material_blob(conn, root, staging, material_id) {
        Ok(None | Some(PlaceOutcome::AlreadyPresent)) => return None,
        Ok(Some(PlaceOutcome::Placed { .. })) => return Some(true),
        Ok(Some(PlaceOutcome::NotYetAvailable)) => {}
        Err(_) => return Some(false),
    }
    let Ok(Some(MaterialBlob::Ready(file))) = blobs::material_blob(conn, material_id) else {
        return Some(false);
    };
    let Some(zip) = zip else {
        return Some(false);
    };
    let Some(entry_name) = source.entry_name(&file) else {
        return Some(false);
    };
    if !stage_pdf(zip, staging, &entry_name, &file.content_sha256) {
        return Some(false);
    }
    match blobs::place_material_blob(conn, root, staging, material_id) {
        Ok(Some(PlaceOutcome::Placed { .. })) => Some(true),
        Ok(None | Some(PlaceOutcome::AlreadyPresent)) => None,
        Ok(Some(PlaceOutcome::NotYetAvailable)) | Err(BlobError::Missing) | Err(_) => Some(false),
    }
}

/// Puts the PDFs of these materials in the library: (placed, still waiting).
fn place_pdfs(
    conn: &Connection,
    root: &Path,
    staging: &Path,
    zip: &mut ZipArchive<File>,
    source: PdfSource,
    ids: &[&str],
) -> (u32, u32) {
    let (mut added, mut waiting) = (0u32, 0u32);
    for id in ids {
        match place_pdf(conn, root, staging, Some(&mut *zip), source, id) {
            Some(true) => added += 1,
            Some(false) => waiting += 1,
            None => {}
        }
    }
    (added, waiting)
}

fn add_counts(total: &mut UnsavedPhoneWork, more: &UnsavedPhoneWork) {
    total.reviews += more.reviews;
    total.tests += more.tests;
    total.bookmarks += more.bookmarks;
    total.reading_positions += more.reading_positions;
    total.materials += more.materials;
    total.guides += more.guides;
    total.generated_tests += more.generated_tests;
}

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PROGRESS_FILES: usize = 1_000;
const MAX_ZIP_ENTRIES: usize = 50_000;

/// The phone's progress file manifest, or `None` when this is anything else
/// (not a zip, no manifest, too large, bad JSON, another kind): those go the
/// old way, unchanged.
fn read_manifest(zip: &mut ZipArchive<File>) -> Option<serde_json::Value> {
    let entry = zip.by_name("manifest.json").ok()?;
    if entry.size() > MAX_MANIFEST_BYTES {
        return None;
    }
    let mut json = String::new();
    entry
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_string(&mut json)
        .ok()?;
    if json.len() as u64 > MAX_MANIFEST_BYTES {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&json).ok()?;
    (value.get("kind").and_then(|k| k.as_str()) == Some("phoneProgress")).then_some(value)
}

/// What the manifest of a progress file promises, checked.
struct ProgressPlan {
    device_id: String,
    saved_at: Option<u64>,
    files: Vec<String>,
}

fn plan_progress(
    manifest: &serde_json::Value,
    entries: usize,
    local_device_id: Option<&str>,
) -> Result<ProgressPlan, String> {
    if entries > MAX_ZIP_ENTRIES {
        return Err(UNREADABLE_FILE.into());
    }
    let format = manifest
        .get("formatVersion")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| UNREADABLE_FILE.to_string())?;
    if format > 1 {
        return Err(NEWER_APP.into());
    }
    if manifest.get("platform").and_then(|v| v.as_str()) != Some("ios") {
        return Err(IngestError::NotAPhoneBackup.to_string());
    }
    let device_id = manifest
        .get("deviceId")
        .and_then(|v| v.as_str())
        .filter(|id| changeset::valid_device_id(id))
        .ok_or_else(|| IngestError::NoDeviceId.to_string())?
        .to_string();
    if local_device_id == Some(device_id.as_str()) {
        return Err(IngestError::SameDevice.to_string());
    }
    if manifest
        .get("schemaVersion")
        .and_then(|v| v.as_i64())
        .is_some_and(|n| n > crate::CURRENT_SCHEMA_VERSION)
    {
        return Err(NEWER_APP.into());
    }
    let names = manifest
        .get("files")
        .and_then(|v| v.as_array())
        .filter(|a| a.len() <= MAX_PROGRESS_FILES)
        .ok_or_else(|| UNREADABLE_FILE.to_string())?;
    let mut files = Vec::with_capacity(names.len());
    let mut seen = HashSet::new();
    let mut last_from = i64::MIN;
    for name in names {
        let name = name.as_str().ok_or_else(|| UNREADABLE_FILE.to_string())?;
        let (from, _, _) =
            changeset::parse_name(name).ok_or_else(|| UNREADABLE_FILE.to_string())?;
        if from < last_from || !seen.insert(name) {
            return Err(UNREADABLE_FILE.into());
        }
        last_from = from;
        files.push(name.to_string());
    }
    Ok(ProgressPlan {
        device_id,
        saved_at: manifest.get("createdAt").and_then(|v| v.as_u64()),
        files,
    })
}

/// Reads and decodes one change file of a progress file. The entry path is
/// built here from the validated id and name, never taken from the zip.
fn read_change_file(
    zip: &mut ZipArchive<File>,
    plan: &ProgressPlan,
    name: &str,
    now: &str,
) -> Result<changeset::DecodedChangeFile, &'static str> {
    let path = format!("{}/{name}", changeset::folder(&plan.device_id));
    let entry = zip.by_name(&path).map_err(|_| UNREADABLE_FILE)?;
    let mut bytes = Vec::new();
    entry
        .take(changeset::MAX_DECODED_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNREADABLE_FILE)?;
    if bytes.len() as u64 > changeset::MAX_DECODED_BYTES {
        return Err(UNREADABLE_FILE);
    }
    let decoded = changeset::decode(&bytes, name, crate::CURRENT_SCHEMA_VERSION, now).map_err(
        |e| match e {
            changeset::ChangeFileError::SchemaTooNew | changeset::ChangeFileError::FormatTooNew => {
                NEWER_APP
            }
            _ => UNREADABLE_FILE,
        },
    )?;
    if decoded.set.device_id != plan.device_id {
        return Err(UNREADABLE_FILE);
    }
    Ok(decoded)
}

fn material_ids(decoded: &changeset::DecodedChangeFile) -> Vec<String> {
    decoded
        .set
        .changes
        .iter()
        .filter(|c| c.table == "study_materials" && c.op != Op::Delete)
        .map(|c| c.row_id.clone())
        .collect()
}

/// Brings in the phone's progress file. Two passes over the open zip: the
/// first checks every change file and keeps only the names of the materials;
/// the second reads, counts and applies one file at a time.
fn import_progress_file(
    root: &Path,
    zip: &mut ZipArchive<File>,
    manifest: &serde_json::Value,
    local_device_id: Option<&str>,
    now: &str,
) -> Result<PhoneProgress, String> {
    let plan = plan_progress(manifest, zip.len(), local_device_id)?;
    let mut materials: Vec<Vec<String>> = Vec::with_capacity(plan.files.len());
    for name in &plan.files {
        let decoded = read_change_file(zip, &plan, name, now).map_err(str::to_string)?;
        materials.push(material_ids(&decoded));
    }
    let nothing = |from_future| PhoneProgress {
        outcome: ProgressOutcome::NothingNew,
        counts: zero_counts(),
        pdfs_added: 0,
        pdfs_waiting: 0,
        phone_saved_at: plan.saved_at,
        from_future,
    };
    if plan.files.is_empty() {
        return Ok(nothing(false));
    }

    let mut conn = open_app_db(root)?;
    let staging = temp_dir()?;
    let mut counts = zero_counts();
    let (mut any_applied, mut any_written, mut from_future) = (false, false, false);
    let mut stopped: Option<(usize, &'static str)> = None;
    for (i, name) in plan.files.iter().enumerate() {
        let decoded = match read_change_file(zip, &plan, name, now) {
            Ok(d) => d,
            Err(text) => {
                stopped = Some((i, text));
                break;
            }
        };
        let these = count_changes(&conn, &decoded.set.changes);
        match apply_change_file(&mut conn, name, &decoded, now) {
            Ok(outcome) => {
                from_future |= decoded.created_in_future;
                if outcome.applied {
                    any_applied = true;
                    if outcome.written > 0 {
                        any_written = true;
                        add_counts(&mut counts, &these);
                    }
                }
            }
            Err(e) => {
                stopped = Some((i, apply_message(&e)));
                break;
            }
        }
    }

    // PDFs also for files that were already in, so one that failed last time
    // can arrive now; and, after a stop, for the files before it. Never fatal.
    let upto = stopped.map_or(materials.len(), |(i, _)| i);
    let mut seen = HashSet::new();
    let ids: Vec<&str> = materials[..upto]
        .iter()
        .flatten()
        .map(String::as_str)
        .filter(|id| seen.insert(*id))
        .collect();
    let (pdfs_added, pdfs_waiting) =
        place_pdfs(&conn, root, &staging.0, zip, PdfSource::Progress, &ids);

    if let Some((_, text)) = stopped {
        return Err(if any_applied || pdfs_added > 0 {
            STOPPED_PARTWAY.to_string()
        } else {
            text.to_string()
        });
    }
    let (outcome, counts) = if any_written {
        (ProgressOutcome::Added, counts)
    } else if any_applied {
        (ProgressOutcome::NothingNew, zero_counts())
    } else {
        (ProgressOutcome::AlreadyIn, zero_counts())
    };
    Ok(PhoneProgress {
        outcome,
        counts,
        pdfs_added,
        pdfs_waiting,
        phone_saved_at: plan.saved_at,
        from_future,
    })
}

/// Reads a phone progress file or full copy and brings its new work into the app at `root`.
pub(crate) fn import_phone_progress_in(
    root: &Path,
    archive: &Path,
    local_device_id: Option<&str>,
    app_version: &str,
    now: &str,
) -> Result<PhoneProgress, String> {
    if let Some(mut zip) = File::open(archive)
        .ok()
        .and_then(|f| ZipArchive::new(f).ok())
    {
        if let Some(manifest) = read_manifest(&mut zip) {
            return import_progress_file(root, &mut zip, &manifest, local_device_id, now);
        }
    }
    let ingested = ingest::ingest_archive(archive, local_device_id, app_version, now)
        .map_err(|e| ingest_message(&e))?;
    let phone_saved_at = ingested.saved_at;
    let Some(exported) = ingested.changes else {
        return Ok(PhoneProgress {
            outcome: ProgressOutcome::NothingNew,
            counts: zero_counts(),
            pdfs_added: 0,
            pdfs_waiting: 0,
            phone_saved_at,
            from_future: false,
        });
    };
    let file = exported.file;
    let decoded = changeset::decode(
        &file.bytes,
        &file.file_name,
        crate::CURRENT_SCHEMA_VERSION,
        now,
    )
    .map_err(|_| UNREADABLE_FILE.to_string())?;

    let mut conn = open_app_db(root)?;
    let counts = count_changes(&conn, &decoded.set.changes);
    let outcome = apply_change_file(&mut conn, &file.file_name, &decoded, now)
        .map_err(|e| apply_message(&e).to_string())?;

    // PDFs: also for a file that was already brought in, so one that failed
    // last time can arrive now. Never fatal.
    let staging = temp_dir()?;
    let mut zip = File::open(archive)
        .ok()
        .and_then(|f| ZipArchive::new(f).ok());
    let (mut pdfs_added, mut pdfs_waiting) = (0u32, 0u32);
    for change in &decoded.set.changes {
        if change.table != "study_materials" || change.op == Op::Delete {
            continue;
        }
        match place_pdf(
            &conn,
            root,
            &staging.0,
            zip.as_mut(),
            PdfSource::Backup,
            &change.row_id,
        ) {
            Some(true) => pdfs_added += 1,
            Some(false) => pdfs_waiting += 1,
            None => {}
        }
    }

    let (kind, counts) = if !outcome.applied {
        (ProgressOutcome::AlreadyIn, zero_counts())
    } else if outcome.written == 0 {
        (ProgressOutcome::NothingNew, zero_counts())
    } else {
        (ProgressOutcome::Added, counts)
    };
    Ok(PhoneProgress {
        outcome: kind,
        counts,
        pdfs_added,
        pdfs_waiting,
        phone_saved_at,
        from_future: decoded.created_in_future,
    })
}

#[tauri::command]
pub async fn import_phone_progress(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<PhoneProgress, String> {
    if cfg!(target_os = "ios") {
        return Err("Only the Mac brings in phone work.".into());
    }
    let root = crate::storage::app_root(&app)?;
    crate::picked_paths::require_picked_or_inside(&app, &root, &source_path)?;
    let version = app.package_info().version.to_string();
    let now = crate::phone_work::now_utc()?;
    tauri::async_runtime::spawn_blocking(move || {
        let local_id = open_app_db(&root).ok().and_then(|c| {
            c.query_row(
                "SELECT value FROM app_metadata WHERE key = 'device_id'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
        });
        import_phone_progress_in(
            &root,
            Path::new(&source_path),
            local_id.as_deref(),
            &version,
            &now,
        )
    })
    .await
    .map_err(|_| NOT_SAVED.to_string())?
}
