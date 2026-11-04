//! Tells whether this phone holds study work that exists nowhere else yet.
//!
//! Every row the phone makes carries a timestamp, and every row that came
//! from the Mac is older than the moment the phone applied that restore. So
//! "unsaved phone work" is whatever is newer than a baseline kept in a small
//! file in the app root (outside the database, never archived).
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub(crate) const PHONE_WORK_FILE: &str = "phone-work.json";
const DB_FILE: &str = "her-flight-deck.db";

/// (table, timestamp column) for the four kinds of phone-made work.
const KINDS: [(&str, &str); 4] = [
    ("card_review_events", "reviewed_at"),
    ("practice_attempts", "started_at"),
    ("material_bookmarks", "updated_at"),
    ("material_reading_state", "updated_at"),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsavedPhoneWork {
    pub reviews: i64,
    pub tests: i64,
    pub bookmarks: i64,
    pub reading_positions: i64,
    pub since: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaselineFile {
    baseline_at: String,
}

/// Missing, unreadable or malformed file means no baseline.
fn read_baseline(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join(PHONE_WORK_FILE)).ok()?;
    let file: BaselineFile = serde_json::from_str(&text).ok()?;
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

/// Record the baseline: `now`, or the newest timestamp in the four tables if
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
    let json =
        serde_json::to_string(&BaselineFile { baseline_at: best }).map_err(|e| e.to_string())?;
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
    let mut counts = [0i64; 4];
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
        part(work.tests, "practice test", "practice tests"),
        part(work.bookmarks, "bookmark", "bookmarks"),
        part(
            work.reading_positions,
            "reading position",
            "reading positions",
        ),
    ]
    .into_iter()
    .flatten()
    .collect();
    if parts.is_empty() {
        return None;
    }
    Some(format!(
        "This phone has {} that aren't saved anywhere else yet. Save my phone work first, then get your study material.",
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

#[tauri::command]
pub async fn unsaved_phone_work(app: AppHandle) -> Result<UnsavedPhoneWork, String> {
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || unsaved_phone_work_in(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "phone_work_tests.rs"]
mod tests;
