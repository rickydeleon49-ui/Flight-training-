//! "Send my progress to the Mac", phone side. Everything the phone did since
//! the last Mac copy goes into one file in the phone's Documents folder
//! (Files -> Your Flight Deck), in the write-once layout the shared folder
//! will use later: `changes/<device>/<from>-<to>-<sha12>.json.gz` and
//! `blobs/<sha256>`. The change files are kept in a persistent outbox under
//! the app folder; the file in Documents is rebuilt from the whole outbox, so
//! it is always complete. Every error reaches the student as a fixed plain
//! sentence; no path, row or internal wording escapes.

use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::phone_work::UnsavedPhoneWork;
use crate::sync::blobs::{self, BlobError, MaterialBlob};
use crate::sync::bootstrap::bootstrap_in;
use crate::sync::changeset::{self, Op};
use crate::sync::export;

pub(crate) const PROGRESS_FILE: &str = "My phone progress.hfdprogress";
pub(crate) const OUTBOX_DIR: &str = "outbox";
const STAGING_PREFIX: &str = ".progress-staging-";
const WRITING_PREFIX: &str = ".My phone progress-";
const WRITING_SUFFIX: &str = ".writing";
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

const FAILED: &str = "Your progress couldn't be sent. Nothing on this phone was changed.";
const NO_LIBRARY: &str =
    "This phone's study library couldn't be opened. Close and open the app, then try again.";
const NOT_READY: &str =
    "This phone isn't ready to send yet. Close and open the app, then try again.";
const BUSY: &str = "Already sending. Try again in a moment.";
const NOT_NOTED: &str =
    "Your progress file was written, but this phone couldn't note it as sent. Try again.";
const KEPT_NOT_REPLACED: &str =
    "Your earlier progress file couldn't be kept, so nothing was replaced. Try again.";

static SENDING: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentPhoneProgress {
    pub file_name: String,
    pub sent_at: String,
    pub nothing_new: bool,
    pub counts: UnsavedPhoneWork,
    /// Materials whose PDF is in the file.
    pub pdfs_included: u32,
    /// Materials whose PDF could not be included this time.
    pub pdfs_left: u32,
    pub file_bytes: u64,
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

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("{}-{nanos}", std::process::id())
}

fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Removes a file or folder when dropped unless disarmed.
struct Cleanup {
    path: PathBuf,
    dir: bool,
    armed: bool,
}

impl Cleanup {
    fn file(path: PathBuf) -> Self {
        Self {
            path,
            dir: false,
            armed: true,
        }
    }
    fn folder(path: PathBuf) -> Self {
        Self {
            path,
            dir: true,
            armed: true,
        }
    }
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        if self.armed {
            if self.dir {
                let _ = std::fs::remove_dir_all(&self.path);
            } else {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }
}

fn older_than_a_day(path: &Path, now: SystemTime) -> bool {
    std::fs::symlink_metadata(path)
        .and_then(|m| m.modified())
        .is_ok_and(|t| now.duration_since(t).is_ok_and(|age| age >= STALE_AFTER))
}

/// Leftovers of a send that was cut short and is over a day old: staging
/// folders in the app folder and half-written progress files in Documents.
/// Nothing else is ever touched.
pub(crate) fn remove_stale_temps(root: &Path, documents_dir: &Path, now: SystemTime) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let path = entry.path();
            if name.to_string_lossy().starts_with(STAGING_PREFIX)
                && std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir())
                && older_than_a_day(&path, now)
            {
                let _ = std::fs::remove_dir_all(&path);
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(documents_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if name.starts_with(WRITING_PREFIX)
                && name.ends_with(WRITING_SUFFIX)
                && std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file())
                && older_than_a_day(&path, now)
            {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

fn device_id_of(conn: &Connection) -> Result<String, String> {
    let id: Option<String> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'device_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| FAILED.to_string())?;
    match id {
        Some(id) if changeset::valid_device_id(&id) => Ok(id),
        _ => Err(NOT_READY.to_string()),
    }
}

fn max_logged_seq(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM local_changes", [], |r| {
        r.get(0)
    })
    .map_err(|_| FAILED.to_string())
}

/// A folder in the outbox that is not this device's means a restore gave the
/// phone a new identity: the old outbox is gone, the new one starts empty.
/// (Whatever it held is in the progress file in Documents, which is kept.)
fn clear_outbox_if_another_device(root: &Path, device_id: &str) -> Result<(), String> {
    let changes = root.join(OUTBOX_DIR).join("changes");
    let entries = match std::fs::read_dir(&changes) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(FAILED.to_string()),
    };
    let mut foreign = false;
    for entry in entries {
        let entry = entry.map_err(|_| FAILED.to_string())?;
        if entry.file_name().to_string_lossy() != device_id {
            foreign = true;
        }
    }
    if foreign {
        std::fs::remove_dir_all(root.join(OUTBOX_DIR)).map_err(|_| FAILED.to_string())?;
    }
    Ok(())
}

/// This device's outbox files as (from_seq, to_seq, name), by from_seq.
fn list_outbox(dir: &Path) -> Result<Vec<(i64, i64, String)>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(FAILED.to_string()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| FAILED.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some((from, to, _)) = changeset::parse_name(&name) {
            if entry.file_type().is_ok_and(|t| t.is_file()) {
                out.push((from, to, name));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Files written but never acknowledged by the watermark: their rows are
/// still in the change log and are exported again now.
fn remove_unacknowledged(dir: &Path, outbox: &mut Vec<(i64, i64, String)>, since: i64) {
    outbox.retain(|(_, to, name)| {
        if *to > since {
            let _ = std::fs::remove_file(dir.join(name));
            false
        } else {
            true
        }
    });
}

fn write_outbox_file(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|_| FAILED.to_string())?;
    let path = dir.join(name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| FAILED.to_string())?;
    let mut guard = Cleanup::file(path);
    file.write_all(bytes).map_err(|_| FAILED.to_string())?;
    file.sync_all().map_err(|_| FAILED.to_string())?;
    drop(file);
    guard.disarm();
    sync_dir(dir);
    Ok(())
}

fn add_kind(counts: &mut UnsavedPhoneWork, table: &str) {
    match table {
        "card_review_events" => counts.reviews += 1,
        "practice_attempts" => counts.tests += 1,
        "material_bookmarks" => counts.bookmarks += 1,
        "material_reading_state" => counts.reading_positions += 1,
        "study_materials" => counts.materials += 1,
        "ai_study_sets" => counts.guides += 1,
        "practice_tests" => counts.generated_tests += 1,
        _ => {}
    }
}

/// What the existing progress file says about itself: (deviceId, toSeq).
fn existing_identity(path: &Path) -> Option<(String, i64)> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = ZipArchive::new(file).ok()?;
    let mut entry = zip.by_name("manifest.json").ok()?;
    let mut text = String::new();
    (&mut entry).take(1 << 20).read_to_string(&mut text).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    Some((
        value.get("deviceId")?.as_str()?.to_string(),
        value.get("toSeq")?.as_i64()?,
    ))
}

/// Rename the existing file to `My phone progress (before <day>).hfdprogress`;
/// nothing else is touched.
fn keep_earlier_file(documents_dir: &Path, destination: &Path, now: &str) -> Result<(), String> {
    let label = crate::phone_work::day_label(now).map_err(|_| KEPT_NOT_REPLACED.to_string())?;
    for n in 1..=99u32 {
        let name = if n == 1 {
            format!("My phone progress (before {label}).hfdprogress")
        } else {
            format!("My phone progress (before {label}) {n}.hfdprogress")
        };
        let target = documents_dir.join(name);
        if target.symlink_metadata().is_ok() {
            continue;
        }
        return std::fs::rename(destination, &target).map_err(|_| KEPT_NOT_REPLACED.to_string());
    }
    Err(KEPT_NOT_REPLACED.to_string())
}

struct BuiltZip {
    pdfs_included: u32,
    pdfs_left: u32,
}

fn failed<E>(_: E) -> String {
    FAILED.to_string()
}

#[allow(clippy::too_many_arguments)]
fn write_zip(
    conn: &Connection,
    root: &Path,
    staging: &Path,
    out: std::fs::File,
    outbox_dir: &Path,
    outbox: &[(i64, i64, String)],
    device_id: &str,
    app_version: &str,
    floor: i64,
) -> Result<BuiltZip, String> {
    let mut zip = ZipWriter::new(out);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let from_seq = outbox.iter().map(|f| f.0).min().unwrap_or(0);
    let to_seq = outbox.iter().map(|f| f.1).max().unwrap_or(0);
    let created = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let manifest = json!({
        "kind": "phoneProgress",
        "formatVersion": 1,
        "platform": "ios",
        "deviceId": device_id,
        "appVersion": app_version,
        "schemaVersion": crate::CURRENT_SCHEMA_VERSION,
        "createdAt": created,
        "fromSeq": from_seq,
        "toSeq": to_seq,
        "files": outbox.iter().map(|f| f.2.as_str()).collect::<Vec<_>>(),
    });
    zip.start_file("manifest.json", deflated).map_err(failed)?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(failed)?;
    let folder = changeset::folder(device_id);
    for (_, _, name) in outbox {
        let bytes = std::fs::read(outbox_dir.join(name)).map_err(failed)?;
        zip.start_file(format!("{folder}/{name}"), stored)
            .map_err(failed)?;
        zip.write_all(&bytes).map_err(failed)?;
    }
    // The PDFs of every material logged since the floor, one entry per
    // content hash; the counts are materials, not entries.
    let ids: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT row_id FROM local_changes
                 WHERE table_name = 'study_materials' AND seq > ?1 ORDER BY row_id",
            )
            .map_err(failed)?;
        let rows = stmt.query_map([floor], |r| r.get(0)).map_err(failed)?;
        rows.collect::<Result<_, _>>().map_err(failed)?
    };
    let mut added: BTreeSet<String> = BTreeSet::new();
    let (mut included, mut left) = (0u32, 0u32);
    for id in ids {
        match blobs::material_blob(conn, &id) {
            Ok(Some(MaterialBlob::Ready(file))) if added.contains(&file.content_sha256) => {
                included += 1;
                continue;
            }
            Ok(None) | Ok(Some(MaterialBlob::NoFile)) => continue,
            Ok(Some(MaterialBlob::Unverified { .. })) | Err(_) => {
                left += 1;
                continue;
            }
            Ok(Some(MaterialBlob::Ready(_))) => {}
        }
        match blobs::publish_material_blob(conn, root, staging, &id) {
            Ok(Some(outcome)) => {
                let sha = match outcome {
                    blobs::PutOutcome::Written { sha256, .. }
                    | blobs::PutOutcome::AlreadyPresent { sha256, .. } => sha256,
                };
                let staged = staging.join(blobs::BLOBS_DIR).join(&sha);
                zip.start_file(format!("blobs/{sha}"), stored)
                    .map_err(failed)?;
                let mut source = std::fs::File::open(&staged).map_err(failed)?;
                std::io::copy(&mut source, &mut zip).map_err(failed)?;
                drop(source);
                let _ = std::fs::remove_file(&staged);
                added.insert(sha);
                included += 1;
            }
            Ok(None) => {}
            Err(BlobError::Db(_)) => return Err(FAILED.to_string()),
            Err(_) => left += 1,
        }
    }
    let file = zip.finish().map_err(failed)?;
    file.sync_all().map_err(failed)?;
    Ok(BuiltZip {
        pdfs_included: included,
        pdfs_left: left,
    })
}

/// Takes the one-send-at-a-time lock, then sends. `now` must be taken before
/// this is called.
pub(crate) fn send_phone_progress_in(
    root: &Path,
    documents_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SentPhoneProgress, String> {
    let _only_one = SENDING.try_lock().map_err(|e| match e {
        std::sync::TryLockError::Poisoned(_) => FAILED.to_string(),
        std::sync::TryLockError::WouldBlock => BUSY.to_string(),
    })?;
    send_locked(root, documents_dir, app_version, now)
}

/// Test seam: holds the one-send-at-a-time lock.
#[cfg(test)]
pub(crate) fn hold_for_test() -> std::sync::MutexGuard<'static, ()> {
    SENDING.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn send_locked(
    root: &Path,
    documents_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SentPhoneProgress, String> {
    remove_stale_temps(root, documents_dir, SystemTime::now());
    let mut conn = crate::sync::progress::open_app_db(root).map_err(|_| NO_LIBRARY.to_string())?;
    let device_id = device_id_of(&conn)?;
    // The ledger must hold the work from before it existed, whether or not the
    // startup preparation ever finished; otherwise the baseline would move
    // past rows no file carries.
    bootstrap_in(root, &mut conn, true, now).map_err(|_| FAILED.to_string())?;
    let floor = export::sync_floor_seq(&conn).map_err(|_| FAILED.to_string())?;
    let exported = export::exported_through_seq(&conn).map_err(|_| FAILED.to_string())?;
    // A watermark ahead of the log means the identity reset after a restore
    // did not finish: sending from here could skip work.
    if exported > max_logged_seq(&conn)? {
        return Err(FAILED.to_string());
    }
    clear_outbox_if_another_device(root, device_id.as_str())?;
    let since = exported.max(floor);
    let outbox_dir = root.join(OUTBOX_DIR).join(changeset::folder(&device_id));
    let mut outbox = list_outbox(&outbox_dir)?;
    remove_unacknowledged(&outbox_dir, &mut outbox, since);
    outbox.retain(|(_, to, _)| *to > floor);

    let mut counts = zero_counts();
    let new_export = export::export_changes_in(&mut conn, &device_id, since, app_version, now)
        .map_err(|_| FAILED.to_string())?;
    let exported_something = new_export.is_some();
    if let Some(exp) = new_export {
        let decoded = changeset::decode(
            &exp.file.bytes,
            &exp.file.file_name,
            crate::CURRENT_SCHEMA_VERSION,
            now,
        )
        .map_err(|_| FAILED.to_string())?;
        for change in &decoded.set.changes {
            if change.op != Op::Delete {
                add_kind(&mut counts, &change.table);
            }
        }
        write_outbox_file(&outbox_dir, &exp.file.file_name, &exp.file.bytes)?;
        // Only now, with the file durable, does the watermark move.
        export::set_exported_through_seq(&conn, exp.to_seq).map_err(|_| FAILED.to_string())?;
        outbox.push((exp.from_seq, exp.to_seq, exp.file.file_name));
        outbox.sort();
    }

    let destination = documents_dir.join(PROGRESS_FILE);
    let outbox_to = outbox.iter().map(|f| f.1).max();
    let existing = destination.symlink_metadata().ok().map(|m| m.len());
    let Some(outbox_to) = outbox_to else {
        return Ok(SentPhoneProgress {
            file_name: PROGRESS_FILE.to_string(),
            sent_at: now.to_string(),
            nothing_new: true,
            counts,
            pdfs_included: 0,
            pdfs_left: 0,
            file_bytes: existing.unwrap_or(0),
        });
    };
    if !exported_something
        && existing_identity(&destination)
            .is_some_and(|(dev, to)| dev == device_id && to == outbox_to)
    {
        return Ok(SentPhoneProgress {
            file_name: PROGRESS_FILE.to_string(),
            sent_at: now.to_string(),
            nothing_new: true,
            counts,
            pdfs_included: 0,
            pdfs_left: 0,
            file_bytes: existing.unwrap_or(0),
        });
    }

    std::fs::create_dir_all(documents_dir).map_err(|_| FAILED.to_string())?;
    let writing = documents_dir.join(format!(
        "{WRITING_PREFIX}{}{WRITING_SUFFIX}",
        unique_suffix()
    ));
    let out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&writing)
        .map_err(|_| FAILED.to_string())?;
    let mut writing_guard = Cleanup::file(writing.clone());
    let staging = root.join(format!("{STAGING_PREFIX}{}", unique_suffix()));
    let staging_guard = Cleanup::folder(staging.clone());
    let built = write_zip(
        &conn,
        root,
        &staging,
        out,
        &outbox_dir,
        &outbox,
        &device_id,
        app_version,
        floor,
    )?;
    drop(staging_guard);

    // The earlier file is replaced only when it is this phone's own; anything
    // else (a Mac copy restored since, or an unreadable file) is kept first.
    if existing.is_some() {
        let own = existing_identity(&destination).is_some_and(|(dev, _)| dev == device_id);
        if !own {
            keep_earlier_file(documents_dir, &destination, now)?;
        }
    }
    std::fs::rename(&writing, &destination).map_err(|_| FAILED.to_string())?;
    writing_guard.disarm();
    sync_dir(documents_dir);
    let file_bytes = std::fs::metadata(&destination).map_or(0, |m| m.len());
    // A PDF left out means the Mac copy would be incomplete: the work stays
    // counted as not saved, and the next send tries that PDF again.
    if built.pdfs_left == 0 {
        crate::phone_work::record_sent_through_in(root, now).map_err(|_| NOT_NOTED.to_string())?;
    }
    Ok(SentPhoneProgress {
        file_name: PROGRESS_FILE.to_string(),
        sent_at: now.to_string(),
        nothing_new: false,
        counts,
        pdfs_included: built.pdfs_included,
        pdfs_left: built.pdfs_left,
        file_bytes,
    })
}

#[tauri::command]
pub async fn send_phone_progress(app: tauri::AppHandle) -> Result<SentPhoneProgress, String> {
    use tauri::Manager;
    if !cfg!(target_os = "ios") {
        return Err("Only the phone sends its progress this way.".into());
    }
    let root = crate::storage::app_root(&app).map_err(|_| FAILED.to_string())?;
    let documents = app
        .path()
        .document_dir()
        .map_err(|_| "This phone's Files folder couldn't be opened.".to_string())?;
    let version = app.package_info().version.to_string();
    let now = crate::phone_work::now_utc().map_err(|_| FAILED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        send_phone_progress_in(&root, &documents, &version, &now)
    })
    .await
    .map_err(|_| FAILED.to_string())?
}

/// Seeds the change log once from work done before it existed. A no-op on the Mac.
pub(crate) fn prepare_phone_progress_in(root: &Path, now: &str) -> Result<(), String> {
    let mut conn = crate::sync::progress::open_app_db(root).map_err(|_| NO_LIBRARY.to_string())?;
    bootstrap_in(root, &mut conn, true, now)
        .map(|_| ())
        .map_err(|_| "This phone couldn't get its progress ready.".to_string())
}

#[tauri::command]
pub async fn prepare_phone_progress(app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "ios") {
        return Ok(());
    }
    let root = crate::storage::app_root(&app)?;
    let now = crate::phone_work::now_utc()?;
    tauri::async_runtime::spawn_blocking(move || prepare_phone_progress_in(&root, &now))
        .await
        .map_err(|_| "This phone couldn't get its progress ready.".to_string())?
}
