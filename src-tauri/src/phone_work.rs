//! Tells whether this phone holds study work that exists nowhere else yet.
//!
//! Every row the phone makes carries a timestamp, and every row that came
//! from the Mac is older than the moment the phone applied that restore. So
//! "unsaved phone work" is whatever is newer than a baseline kept in a small
//! file in the app root (outside the database, never archived).
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub(crate) const PHONE_WORK_FILE: &str = "phone-work.json";
const DB_FILE: &str = "her-flight-deck.db";

/// (table, timestamp column) for the kinds of phone-made work.
pub(crate) const KINDS: [(&str, &str); 7] = [
    ("card_review_events", "reviewed_at"),
    ("practice_attempts", "started_at"),
    ("material_bookmarks", "updated_at"),
    ("material_reading_state", "updated_at"),
    ("study_materials", "created_at"),
    ("ai_study_sets", "updated_at"),
    ("practice_tests", "updated_at"),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsavedPhoneWork {
    pub reviews: i64,
    pub tests: i64,
    pub bookmarks: i64,
    pub reading_positions: i64,
    pub materials: i64,
    pub guides: i64,
    pub generated_tests: i64,
    pub since: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaselineFile {
    baseline_at: String,
    /// When a Mac restore was last applied on this phone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    restored_at: Option<String>,
    /// The `now` of the last successful phone save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    copy_saved_at: Option<String>,
    /// The `now` of the last successful "Send my progress" on this phone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress_sent_at: Option<String>,
}

/// Missing, unreadable or malformed file means nothing is known.
fn read_file(root: &Path) -> Option<BaselineFile> {
    let text = std::fs::read_to_string(root.join(PHONE_WORK_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Missing, unreadable or malformed file means no baseline.
fn read_baseline(root: &Path) -> Option<String> {
    let file = read_file(root)?;
    if file.baseline_at.trim().is_empty() {
        None
    } else {
        Some(file.baseline_at)
    }
}

fn open_read_only(root: &Path) -> Result<Option<Connection>, String> {
    let database = root.join(DB_FILE);
    if !database.is_file() {
        return Ok(None);
    }
    let connection = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(Some(connection))
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .map_err(|e| e.to_string())
}

/// Newest timestamp in one table, as stored.
fn newest(connection: &Connection, table: &str, column: &str) -> Result<Option<String>, String> {
    if !table_exists(connection, table)? {
        return Ok(None);
    }
    connection
        .query_row(
            &format!(
                "SELECT {column} FROM {table} WHERE julianday({column}) IS NOT NULL \
                 ORDER BY julianday({column}) DESC LIMIT 1"
            ),
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
        .map_err(|e| e.to_string())
}

/// Record the baseline: `now`, or the newest timestamp in the kinds' tables if
/// that is later (so a Mac clock running ahead of the phone is harmless).
pub(crate) fn record_baseline_in(root: &Path, now: &str) -> Result<(), String> {
    let mut best = now.to_string();
    if let Some(connection) = open_read_only(root)? {
        for (table, column) in KINDS {
            if let Some(candidate) = newest(&connection, table, column)? {
                let later: i64 = connection
                    .query_row(
                        "SELECT julianday(?1) > julianday(?2)",
                        [&candidate, &best],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if later == 1 {
                    best = candidate;
                }
            }
        }
    }
    let earlier = read_file(root);
    let copy_saved_at = earlier.as_ref().and_then(|f| f.copy_saved_at.clone());
    let progress_sent_at = earlier.and_then(|f| f.progress_sent_at);
    write_baseline(
        root,
        &BaselineFile {
            baseline_at: best,
            restored_at: Some(now.to_string()),
            copy_saved_at,
            progress_sent_at,
        },
    )
}

/// Write the baseline file atomically (temp file, then rename).
fn write_baseline(root: &Path, file: &BaselineFile) -> Result<(), String> {
    let json = serde_json::to_string(file).map_err(|e| e.to_string())?;
    let writing = root.join(format!("{PHONE_WORK_FILE}.writing"));
    if let Err(e) = std::fs::write(&writing, json) {
        let _ = std::fs::remove_file(&writing);
        return Err(format!("Could not record the phone baseline: {e}"));
    }
    std::fs::rename(&writing, root.join(PHONE_WORK_FILE)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not record the phone baseline: {e}")
    })
}

/// After a phone save: the baseline becomes `now` (taken before the snapshot
/// started) unless the current baseline is already later. Never looks at the
/// rows, so work written during the snapshot stays counted as unsaved.
pub(crate) fn record_saved_through_in(root: &Path, now: &str) -> Result<(), String> {
    let mut best = now.to_string();
    if let Some(current) = read_baseline(root) {
        let connection = Connection::open_in_memory().map_err(|e| e.to_string())?;
        let later: i64 = connection
            .query_row(
                "SELECT julianday(?1) > julianday(?2)",
                [&current, &best],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if later == 1 {
            best = current;
        }
    }
    let earlier = read_file(root);
    let restored_at = earlier.as_ref().and_then(|f| f.restored_at.clone());
    let progress_sent_at = earlier.and_then(|f| f.progress_sent_at);
    write_baseline(
        root,
        &BaselineFile {
            baseline_at: best,
            restored_at,
            copy_saved_at: Some(now.to_string()),
            progress_sent_at,
        },
    )
}

/// After "Send my progress" wrote its file: the baseline becomes `now` (taken
/// before the export started) unless it is already later. `restored_at` and
/// `copy_saved_at` stay as they were, so the full-copy rules are unaffected.
pub(crate) fn record_sent_through_in(root: &Path, now: &str) -> Result<(), String> {
    let earlier = read_file(root);
    let mut best = now.to_string();
    if let Some(current) = earlier.as_ref().map(|f| f.baseline_at.as_str()) {
        let connection = Connection::open_in_memory().map_err(|e| e.to_string())?;
        // A current baseline that cannot be compared is never trusted over `now`.
        let later: Option<i64> = connection
            .query_row(
                "SELECT julianday(?1) > julianday(?2)",
                [current, &best],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if later == Some(1) {
            best = current.to_string();
        }
    }
    let (restored_at, copy_saved_at) = earlier
        .map(|f| (f.restored_at, f.copy_saved_at))
        .unwrap_or((None, None));
    write_baseline(
        root,
        &BaselineFile {
            baseline_at: best,
            restored_at,
            copy_saved_at,
            progress_sent_at: Some(now.to_string()),
        },
    )
}

fn count_newer(
    connection: &Connection,
    table: &str,
    column: &str,
    baseline: Option<&str>,
) -> Result<i64, String> {
    if !table_exists(connection, table)? {
        return Ok(0);
    }
    match baseline {
        Some(at) => connection.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE julianday({column}) > julianday(?1)"),
            [at],
            |row| row.get(0),
        ),
        None => connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        }),
    }
    .map_err(|e| e.to_string())
}

pub(crate) fn unsaved_phone_work_in(root: &Path) -> Result<UnsavedPhoneWork, String> {
    let baseline = read_baseline(root);
    let mut counts = [0i64; KINDS.len()];
    if let Some(connection) = open_read_only(root)? {
        for (slot, (table, column)) in counts.iter_mut().zip(KINDS) {
            *slot = count_newer(&connection, table, column, baseline.as_deref())?;
        }
    }
    Ok(UnsavedPhoneWork {
        reviews: counts[0],
        tests: counts[1],
        bookmarks: counts[2],
        reading_positions: counts[3],
        materials: counts[4],
        guides: counts[5],
        generated_tests: counts[6],
        since: baseline,
    })
}

fn part(count: i64, one: &str, many: &str) -> Option<String> {
    match count {
        0 => None,
        1 => Some(format!("1 {one}")),
        n => Some(format!("{n} {many}")),
    }
}

fn join_words(parts: &[String]) -> String {
    match parts {
        [] => String::new(),
        [only] => only.clone(),
        [a, b] => format!("{a} and {b}"),
        [head @ .., last] => format!("{}, and {last}", head.join(", ")),
    }
}

pub(crate) fn sentence(work: &UnsavedPhoneWork) -> Option<String> {
    let parts: Vec<String> = [
        part(work.reviews, "card review", "card reviews"),
        part(
            work.tests + work.generated_tests,
            "practice test",
            "practice tests",
        ),
        part(work.bookmarks, "bookmark", "bookmarks"),
        part(
            work.reading_positions,
            "reading position",
            "reading positions",
        ),
        part(work.guides, "study guide", "study guides"),
        part(work.materials, "study material", "study materials"),
    ]
    .into_iter()
    .flatten()
    .collect();
    if parts.is_empty() {
        return None;
    }
    let total =
        work.reviews + work.tests + work.bookmarks + work.reading_positions + work.materials;
    let verb = if total == 1 { "isn't" } else { "aren't" };
    Some(format!(
        "This phone has {} that {verb} saved anywhere else yet. Save my phone work first, then get your study material.",
        join_words(&parts)
    ))
}

/// `Ok` when this is not a phone or nothing is unsaved; otherwise the sentence.
pub(crate) fn refuse_unsaved(root: &Path, phone: bool) -> Result<(), String> {
    if !phone {
        return Ok(());
    }
    match sentence(&unsaved_phone_work_in(root)?) {
        None => Ok(()),
        Some(text) => Err(text),
    }
}

/// A genuinely empty first run has nothing to protect: record the baseline unless
/// one already exists (an upgraded phone with no baseline keeps everything counted).
pub(crate) fn record_baseline_if_missing_in(root: &Path, now: &str) -> Result<(), String> {
    if read_file(root).is_some() {
        return Ok(());
    }
    record_baseline_in(root, now)
}

#[tauri::command]
pub async fn record_fresh_phone_baseline(app: AppHandle) -> Result<(), String> {
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let now = now_utc()?;
        record_baseline_if_missing_in(&root, &now)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unsaved_phone_work(app: AppHandle) -> Result<UnsavedPhoneWork, String> {
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || unsaved_phone_work_in(&root))
        .await
        .map_err(|e| e.to_string())?
}

/// The current time as RFC3339 UTC, from SQLite so it compares through `julianday`.
pub(crate) fn now_utc() -> Result<String, String> {
    Connection::open_in_memory()
        .and_then(|c| {
            c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
                r.get::<_, String>(0)
            })
        })
        .map_err(|e| e.to_string())
}

pub(crate) const PHONE_WORK_ARCHIVE: &str = "My phone work.hfdbackup";

const REFUSE_PHONE_COPY: &str =
    "This is your iPhone's copy \u{2014} it can't replace what's on the Mac. Use \u{201c}Get progress from my iPhone\u{201d} in Settings instead.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPhoneWork {
    pub file_name: String,
    pub saved_at: String,
    pub file_bytes: u64,
    /// Set when an earlier copy was kept under a dated name.
    pub kept_file_name: Option<String>,
}

const KEPT_NOT_REPLACED: &str =
    "Your earlier phone copy couldn't be kept, so nothing was replaced. Try again.";

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// "4 Nov 2026" from an RFC3339 UTC timestamp.
pub(crate) fn day_label(at: &str) -> Result<String, String> {
    let connection = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let (y, m, d): (Option<String>, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT strftime('%Y', ?1), strftime('%m', ?1), strftime('%d', ?1)",
            [at],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let (y, m, d) = (y.ok_or("date")?, m.ok_or("date")?, d.ok_or("date")?);
    let month: usize = m.parse().map_err(|_| "date".to_string())?;
    let day: u32 = d.parse().map_err(|_| "date".to_string())?;
    let name = MONTHS.get(month.wrapping_sub(1)).ok_or("date")?;
    Ok(format!("{day} {name} {y}"))
}

/// True when the phone copy on disk predates the last Mac restore.
fn copy_predates_restore(file: &BaselineFile) -> Result<bool, String> {
    let Some(restored) = file.restored_at.as_deref() else {
        return Ok(false);
    };
    let Some(saved) = file.copy_saved_at.as_deref() else {
        return Ok(true);
    };
    let connection = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let older: Option<i64> = connection
        .query_row(
            "SELECT julianday(?1) < julianday(?2)",
            [saved, restored],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    // An unreadable saved time cannot prove the copy is current: keep it.
    Ok(older.unwrap_or(1) == 1)
}

/// Rename the existing copy to a dated name; nothing else is touched.
fn keep_earlier_copy(
    documents_dir: &Path,
    destination: &Path,
    restored_at: &str,
) -> Result<String, String> {
    let label = day_label(restored_at).map_err(|_| KEPT_NOT_REPLACED.to_string())?;
    for n in 1..=99u32 {
        let name = if n == 1 {
            format!("My phone work (before {label}).hfdbackup")
        } else {
            format!("My phone work (before {label}) {n}.hfdbackup")
        };
        let target = documents_dir.join(&name);
        if target.symlink_metadata().is_ok() {
            continue;
        }
        return std::fs::rename(destination, &target)
            .map(|_| name)
            .map_err(|_| KEPT_NOT_REPLACED.to_string());
    }
    Err(KEPT_NOT_REPLACED.to_string())
}

/// Copy everything on the phone into `documents_dir`, then (only then) note it
/// as saved. `now` must be taken before this is called.
pub(crate) fn save_phone_work_in(
    root: &Path,
    documents_dir: &Path,
    app_version: &str,
    now: &str,
) -> Result<SavedPhoneWork, String> {
    std::fs::create_dir_all(documents_dir)
        .map_err(|e| format!("Could not open this phone's Files folder: {e}"))?;
    let destination = documents_dir.join(PHONE_WORK_ARCHIVE);
    let mut kept_file_name = None;
    if destination.symlink_metadata().is_ok() {
        match read_file(root) {
            Some(file) => {
                if copy_predates_restore(&file).map_err(|_| KEPT_NOT_REPLACED.to_string())? {
                    if let Some(restored) = file.restored_at.as_deref() {
                        kept_file_name =
                            Some(keep_earlier_copy(documents_dir, &destination, restored)?);
                    }
                }
            }
            // Nothing known about the copy on disk: it may hold work found nowhere else, so keep it.
            None => {
                kept_file_name = Some(keep_earlier_copy(documents_dir, &destination, now)?);
            }
        }
    }
    let info = crate::backup::create_consistent_complete_backup_with_retry(
        root,
        &destination,
        app_version,
    )?;
    record_saved_through_in(root, now).map_err(|_| {
        "Your phone work was copied, but this phone couldn't note it as saved. Try again."
            .to_string()
    })?;
    Ok(SavedPhoneWork {
        file_name: PHONE_WORK_ARCHIVE.to_string(),
        saved_at: now.to_string(),
        file_bytes: info.file_bytes,
        kept_file_name,
    })
}

/// The Mac never takes the iPhone's copy as its own.
pub(crate) fn refuse_phone_copy(platform: Option<&str>, phone: bool) -> Result<(), String> {
    if !phone && platform == Some("ios") {
        Err(REFUSE_PHONE_COPY.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn save_phone_work(app: AppHandle) -> Result<SavedPhoneWork, String> {
    if !cfg!(target_os = "ios") {
        return Err("Only the phone saves its work this way.".into());
    }
    let root = crate::storage::app_root(&app)?;
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not find this phone's Files folder: {e}"))?;
    let version = app.package_info().version.to_string();
    let now = now_utc()?;
    tauri::async_runtime::spawn_blocking(move || {
        save_phone_work_in(&root, &documents, &version, &now)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "phone_work_tests.rs"]
mod tests;
