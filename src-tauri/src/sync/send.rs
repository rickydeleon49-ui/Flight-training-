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
pub(crate) const MAC_FILE: &str = "Changes from my Mac.hfdprogress";
const MAC_STAGING_PREFIX: &str = ".changes-staging-";
const MAC_WRITING_PREFIX: &str = ".Changes from my Mac-";
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

const MAC_FAILED: &str = "Your changes couldn't be sent. Nothing on this Mac was changed.";
const MAC_NO_LIBRARY: &str =
    "This Mac's study library couldn't be opened. Close and open the app, then try again.";
const MAC_NOT_READY: &str =
    "This Mac isn't ready to send yet. Close and open the app, then try again.";
const MAC_KEPT_NOT_REPLACED: &str =
    "Your earlier changes file couldn't be kept, so nothing was replaced. Try again.";
const MAC_COPY_FIRST: &str =
    "Send a full copy to your iPhone first; after that only changes are sent.";

static SENDING: Mutex<()> = Mutex::new(());

/// Which device is sending: the phone (its progress) or the Mac (its changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    Phone,
    Mac,
}

impl Side {
    pub(crate) fn file_name(self) -> &'static str {
        match self {
            Self::Phone => PROGRESS_FILE,
            Self::Mac => MAC_FILE,
        }
    }
    pub(crate) fn kind(self) -> &'static str {
        match self {
            Self::Phone => "phoneProgress",
            Self::Mac => "macChanges",
        }
    }
    pub(crate) fn platform(self) -> &'static str {
        match self {
            Self::Phone => "ios",
            Self::Mac => "macos",
        }
    }
    fn staging_prefix(self) -> &'static str {
        match self {
            Self::Phone => STAGING_PREFIX,
            Self::Mac => MAC_STAGING_PREFIX,
        }
    }
    fn writing_prefix(self) -> &'static str {
        match self {
            Self::Phone => WRITING_PREFIX,
            Self::Mac => MAC_WRITING_PREFIX,
        }
    }
    fn keep_prefix(self) -> &'static str {
        match self {
            Self::Phone => "My phone progress",
            Self::Mac => "Changes from my Mac",
        }
    }
    /// The Mac's wording for the fixed sentences the shared steps produce.
    fn words(self, text: String) -> String {
        if self == Self::Phone {
            return text;
        }
        match text.as_str() {
            FAILED => MAC_FAILED,
            NO_LIBRARY => MAC_NO_LIBRARY,
            NOT_READY => MAC_NOT_READY,
            KEPT_NOT_REPLACED => MAC_KEPT_NOT_REPLACED,
            _ => return text,
        }
        .to_string()
    }
}

/// What a Mac file holds, in the words the student sees.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacCounts {
    pub materials: u32,
    pub removed: u32,
    pub card_sets: u32,
    pub practice_tests: u32,
    pub study_guides: u32,
}

impl MacCounts {
    pub(crate) fn add(&mut self, table: &str, op: Op) {
        match (table, op) {
            ("study_materials", Op::Delete) => self.removed += 1,
            (_, Op::Delete) => {}
            ("study_materials", _) => self.materials += 1,
            ("card_versions", _) => self.card_sets += 1,
            ("practice_test_versions", _) => self.practice_tests += 1,
            ("ai_study_sets", _) => self.study_guides += 1,
            _ => {}
        }
    }
}

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
#[cfg(test)]
pub(crate) fn remove_stale_temps(root: &Path, documents_dir: &Path, now: SystemTime) {
    remove_stale_temps_for(Side::Phone, root, documents_dir, now);
}

pub(crate) fn remove_stale_temps_for(
    side: Side,
    root: &Path,
    documents_dir: &Path,
    now: SystemTime,
) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let path = entry.path();
            if name.to_string_lossy().starts_with(side.staging_prefix())
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
            if name.starts_with(side.writing_prefix())
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

/// Whether a full copy has restarted this Mac's change stream (or a send has
/// moved it) since the last restore.
fn has_exported_mark(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM app_metadata WHERE key = 'exported_through_seq'",
        [],
        |_| Ok(()),
    )
    .optional()
    .map(|r| r.is_some())
    .map_err(|_| FAILED.to_string())
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

/// Rename the existing file to `<name> (before <day>).hfdprogress`;
/// nothing else is touched.
fn keep_earlier_file(
    side: Side,
    documents_dir: &Path,
    destination: &Path,
    now: &str,
) -> Result<(), String> {
    let label = crate::phone_work::day_label(now).map_err(|_| KEPT_NOT_REPLACED.to_string())?;
    let keep = side.keep_prefix();
    for n in 1..=99u32 {
        let name = if n == 1 {
            format!("{keep} (before {label}).hfdprogress")
        } else {
            format!("{keep} (before {label}) {n}.hfdprogress")
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
    side: Side,
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
    // The phone looks back to its floor; the Mac only to what its files hold
    // (the PDFs before that are already on the phone, in the full copy).
    let pdf_since = match side {
        Side::Phone => floor,
        Side::Mac => from_seq.saturating_sub(1).max(floor),
    };
    let to_seq = outbox.iter().map(|f| f.1).max().unwrap_or(0);
    let created = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let manifest = json!({
        "kind": side.kind(),
        "formatVersion": 1,
        "platform": side.platform(),
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
        let rows = stmt.query_map([pdf_since], |r| r.get(0)).map_err(failed)?;
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
    let sent = send_side(Side::Phone, root, documents_dir, app_version, now)?;
    Ok(SentPhoneProgress {
        file_name: PROGRESS_FILE.to_string(),
        sent_at: now.to_string(),
        nothing_new: sent.nothing_new,
        counts: sent.counts,
        pdfs_included: sent.pdfs_included,
        pdfs_left: sent.pdfs_left,
        file_bytes: sent.file_bytes,
    })
}

/// What one send did, for either side.
pub(crate) struct SideSent {
    pub nothing_new: bool,
    /// The phone's counts (phone side only).
    pub counts: UnsavedPhoneWork,
    /// The Mac's counts (Mac side only).
    pub mac: MacCounts,
    pub pdfs_included: u32,
    pub pdfs_left: u32,
    pub file_bytes: u64,
}

/// Sends for `side` into `out_dir` (the phone's Documents folder, or the
/// Mac's iCloud Drive folder). The caller holds the one-send lock.
pub(crate) fn send_side(
    side: Side,
    root: &Path,
    out_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SideSent, String> {
    send_side_inner(side, root, out_dir, app_version, now).map_err(|e| side.words(e))
}

fn send_side_inner(
    side: Side,
    root: &Path,
    documents_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SideSent, String> {
    remove_stale_temps_for(side, root, documents_dir, SystemTime::now());
    let mut conn = crate::sync::progress::open_app_db(root).map_err(|_| NO_LIBRARY.to_string())?;
    let device_id = device_id_of(&conn)?;
    // The ledger must hold the work from before it existed, whether or not the
    // startup preparation ever finished; otherwise the baseline would move
    // past rows no file carries.
    bootstrap_in(root, &mut conn, side == Side::Phone, now).map_err(|_| FAILED.to_string())?;
    if side == Side::Mac && !has_exported_mark(&conn)? {
        return Err(MAC_COPY_FIRST.to_string());
    }
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
    let mut mac = MacCounts::default();
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
            match side {
                Side::Phone => {
                    if change.op != Op::Delete {
                        add_kind(&mut counts, &change.table);
                    }
                }
                Side::Mac => mac.add(&change.table, change.op),
            }
        }
        write_outbox_file(&outbox_dir, &exp.file.file_name, &exp.file.bytes)?;
        // Only now, with the file durable, does the watermark move.
        export::set_exported_through_seq(&conn, exp.to_seq).map_err(|_| FAILED.to_string())?;
        outbox.push((exp.from_seq, exp.to_seq, exp.file.file_name));
        outbox.sort();
    }

    let destination = documents_dir.join(side.file_name());
    let outbox_to = outbox.iter().map(|f| f.1).max();
    let existing = destination.symlink_metadata().ok().map(|m| m.len());
    let Some(outbox_to) = outbox_to else {
        return Ok(SideSent {
            nothing_new: true,
            counts,
            mac,
            pdfs_included: 0,
            pdfs_left: 0,
            file_bytes: existing.unwrap_or(0),
        });
    };
    if !exported_something
        && existing_identity(&destination)
            .is_some_and(|(dev, to)| dev == device_id && to == outbox_to)
    {
        return Ok(SideSent {
            nothing_new: true,
            counts,
            mac,
            pdfs_included: 0,
            pdfs_left: 0,
            file_bytes: existing.unwrap_or(0),
        });
    }

    std::fs::create_dir_all(documents_dir).map_err(|_| FAILED.to_string())?;
    let writing = documents_dir.join(format!(
        "{}{}{WRITING_SUFFIX}",
        side.writing_prefix(),
        unique_suffix()
    ));
    let out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&writing)
        .map_err(|_| FAILED.to_string())?;
    let mut writing_guard = Cleanup::file(writing.clone());
    let staging = root.join(format!("{}{}", side.staging_prefix(), unique_suffix()));
    let staging_guard = Cleanup::folder(staging.clone());
    let built = write_zip(
        side,
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
            keep_earlier_file(side, documents_dir, &destination, now)?;
        }
    }
    std::fs::rename(&writing, &destination).map_err(|_| FAILED.to_string())?;
    writing_guard.disarm();
    sync_dir(documents_dir);
    let file_bytes = std::fs::metadata(&destination).map_or(0, |m| m.len());
    // A PDF left out means the Mac copy would be incomplete: the work stays
    // counted as not saved, and the next send tries that PDF again.
    if side == Side::Phone && built.pdfs_left == 0 {
        crate::phone_work::record_sent_through_in(root, now).map_err(|_| NOT_NOTED.to_string())?;
    }
    Ok(SideSent {
        nothing_new: false,
        counts,
        mac,
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

/// What "Send changes to my iPhone" reports.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentChanges {
    pub file_name: String,
    pub sent_at: String,
    pub nothing_new: bool,
    pub counts: MacCounts,
    pub pdfs_included: u32,
    pub pdfs_left: u32,
    pub file_bytes: u64,
    pub path: String,
}

/// Takes the one-send-at-a-time lock, then sends the Mac's changes into `out_dir`.
pub(crate) fn send_mac_changes_in(
    root: &Path,
    out_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SentChanges, String> {
    let _only_one = SENDING.try_lock().map_err(|e| match e {
        std::sync::TryLockError::Poisoned(_) => MAC_FAILED.to_string(),
        std::sync::TryLockError::WouldBlock => BUSY.to_string(),
    })?;
    send_mac_changes_locked(root, out_dir, app_version, now)
}

/// The Mac send itself; the caller holds the one-send lock.
pub(crate) fn send_mac_changes_locked(
    root: &Path,
    out_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SentChanges, String> {
    let sent = send_side(Side::Mac, root, out_dir, app_version, now)?;
    Ok(SentChanges {
        file_name: MAC_FILE.to_string(),
        sent_at: now.to_string(),
        nothing_new: sent.nothing_new,
        counts: sent.mac,
        pdfs_included: sent.pdfs_included,
        pdfs_left: sent.pdfs_left,
        file_bytes: sent.file_bytes,
        path: out_dir.join(MAC_FILE).to_string_lossy().into_owned(),
    })
}

/// The newest change number now. Read this BEFORE a full copy starts: an
/// overlap with the copy is harmless, a gap is not.
pub(crate) fn change_stream_mark(root: &Path) -> Result<i64, String> {
    let conn = crate::sync::progress::open_app_db(root).map_err(|_| MAC_NO_LIBRARY.to_string())?;
    max_logged_seq(&conn).map_err(|e| Side::Mac.words(e))
}

/// After a full copy is durable: the Mac's next changes file starts after
/// `mark`, and the files it kept for the earlier stream are removed. The
/// files go first, so an interruption only ever re-sends more.
pub(crate) fn restart_change_stream(root: &Path, mark: i64) -> Result<(), String> {
    let _only_one = SENDING.lock().unwrap_or_else(|e| e.into_inner());
    let conn = crate::sync::progress::open_app_db(root).map_err(|_| MAC_NO_LIBRARY.to_string())?;
    let device_id = device_id_of(&conn).map_err(|e| Side::Mac.words(e))?;
    let dir = root.join(OUTBOX_DIR).join(changeset::folder(&device_id));
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(MAC_FAILED.to_string()),
    }
    export::set_exported_through_seq(&conn, mark).map_err(|_| MAC_FAILED.to_string())
}

fn mac_out_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    crate::backup::iphone_backup_dir(&home)
}

fn mac_context(app: &tauri::AppHandle) -> Result<(PathBuf, String, String), String> {
    let root = crate::storage::app_root(app).map_err(|_| MAC_FAILED.to_string())?;
    let version = app.package_info().version.to_string();
    let now = crate::phone_work::now_utc().map_err(|_| MAC_FAILED.to_string())?;
    Ok((root, version, now))
}

/// Writes "Changes from my Mac" into the iCloud Drive folder. `Ok(None)` when
/// that folder is not available: the page then asks where to save.
#[tauri::command]
pub async fn send_mac_changes(app: tauri::AppHandle) -> Result<Option<SentChanges>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let (root, version, now) = mac_context(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(dir) = mac_out_dir() else {
            return Ok(None);
        };
        send_mac_changes_in(&root, &dir, &version, &now).map(Some)
    })
    .await
    .map_err(|_| MAC_FAILED.to_string())?
}

/// The same, into the folder of a place she chose in a save dialog.
#[tauri::command]
pub async fn send_mac_changes_to(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<SentChanges, String> {
    if !cfg!(target_os = "macos") {
        return Err("Only the Mac sends its changes this way.".into());
    }
    crate::picked_paths::require_picked(&app, &destination_path)?;
    let dir = Path::new(&destination_path)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| MAC_FAILED.to_string())?;
    let (root, version, now) = mac_context(&app)?;
    tauri::async_runtime::spawn_blocking(move || send_mac_changes_in(&root, &dir, &version, &now))
        .await
        .map_err(|_| MAC_FAILED.to_string())?
}

/// Call before a full copy that is saved elsewhere (AirDrop); pass the value to
/// `restart_change_stream_after_copy` once the copy is saved.
#[tauri::command]
pub async fn change_stream_mark_before_copy(app: tauri::AppHandle) -> Result<Option<i64>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let root = crate::storage::app_root(&app).map_err(|_| MAC_FAILED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || change_stream_mark(&root).map(Some))
        .await
        .map_err(|_| MAC_FAILED.to_string())?
}

/// After the save-elsewhere full copy succeeded: the Mac's changes now start
/// after `mark_before_copy` (read before the copy began).
#[tauri::command]
pub async fn restart_change_stream_after_copy(
    app: tauri::AppHandle,
    mark_before_copy: Option<i64>,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let Some(mark) = mark_before_copy.filter(|m| *m >= 0) else {
        return Err(MAC_FAILED.to_string());
    };
    let root = crate::storage::app_root(&app).map_err(|_| MAC_FAILED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || restart_change_stream(&root, mark))
        .await
        .map_err(|_| MAC_FAILED.to_string())?
}
