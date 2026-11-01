//! Read-only activity for the phone's replacement warning.
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySummary {
    pub latest_review_at: Option<String>,
    pub reviews_last_7_days: i64,
    pub attempts_last_7_days: i64,
}

pub(crate) fn activity_summary_in(root: &Path) -> Result<ActivitySummary, String> {
    let connection = Connection::open_with_flags(
        root.join("her-flight-deck.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    connection
        .query_row(
            "SELECT
          (SELECT reviewed_at FROM card_review_events
           ORDER BY julianday(reviewed_at) DESC LIMIT 1),
          (SELECT COUNT(*) FROM card_review_events
           WHERE julianday(reviewed_at) BETWEEN julianday('now', '-7 days') AND julianday('now')),
          (SELECT COUNT(*) FROM practice_attempts
           WHERE julianday(started_at) BETWEEN julianday('now', '-7 days') AND julianday('now'))",
            [],
            |row| {
                Ok(ActivitySummary {
                    latest_review_at: row.get(0)?,
                    reviews_last_7_days: row.get(1)?,
                    attempts_last_7_days: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn phone_activity_summary(app: AppHandle) -> Result<ActivitySummary, String> {
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || activity_summary_in(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "phone_activity_tests.rs"]
mod tests;
