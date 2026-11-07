//! Study packs (PACK-01): a single `.hfdpack` file that carries study
//! material from one library to another. Stage 1 is the file format, its
//! validators, the revision and export. Stage 2 is the transactional import:
//! additive only, crash-safe, with recovery from a receipt row.

pub mod commit;
pub mod export;
pub mod fault;
pub mod format;
pub mod guard;
pub mod inspect;
pub mod install;
pub mod journal;
pub mod plan;
pub mod reconcile;
pub mod result;
pub mod revision;
pub mod titles;
pub mod validate;

#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod tests;

use tauri::AppHandle;

/// Save the chosen study items (and the pictures their picture cards use) as
/// a study pack at a path the user picked in the save dialog.
#[tauri::command]
pub async fn export_study_pack(
    app: AppHandle,
    destination_path: String,
    material_ids: Vec<String>,
) -> Result<export::ExportSummary, String> {
    crate::picked_paths::require_picked(&app, &destination_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::storage::app_root(&app)?;
        export::export_study_pack_in(
            &root,
            &material_ids,
            std::path::Path::new(&destination_path),
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|error| format!("Could not finish saving the study pack: {error}"))?
}

/// Preview a study pack (read-only). The path comes from the open dialog only.
#[tauri::command]
pub async fn inspect_study_pack(
    app: AppHandle,
    source_path: String,
) -> Result<inspect::Preview, String> {
    crate::picked_paths::require_picked(&app, &source_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::storage::app_root(&app)?;
        inspect::inspect_study_pack_in(&root, std::path::Path::new(&source_path))
    })
    .await
    .map_err(|error| format!("Could not look at the study pack: {error}"))?
}

/// Add a study pack. `op_id` is a fresh lowercase UUIDv4 made by the screen,
/// so asking again after an unknown answer is recognised.
#[tauri::command]
pub async fn add_study_pack(
    app: AppHandle,
    op_id: String,
    source_path: String,
) -> Result<result::PackResult, String> {
    crate::picked_paths::require_picked(&app, &source_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::storage::app_root(&app)?;
        install::add_study_pack_in(
            &root,
            crate::library_lock::owned(&app),
            std::path::Path::new(&source_path),
            &op_id,
        )
    })
    .await
    .map_err(|error| format!("Could not finish adding the study pack: {error}"))?
}

/// Finish or undo any study pack that did not finish. Runs after the database
/// opens and migrates, and at the start of every pack command.
#[tauri::command]
pub async fn reconcile_study_pack_imports(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::storage::app_root(&app)?;
        if !crate::library_lock::owned(&app) {
            return Ok(());
        }
        let guard =
            crate::library_lock::try_acquire(&root, crate::library_lock::Holder::Pack)?;
        reconcile::reconcile_locked(&guard, &root, reconcile::Mode::Normal).map(|_| ())
    })
    .await
    .map_err(|error| format!("Could not check the study packs: {error}"))?
}

fn open_for_results(app: &AppHandle, write: bool) -> Result<rusqlite::Connection, String> {
    let root = crate::storage::app_root(app)?;
    let path = root.join("her-flight-deck.db");
    let conn = if write {
        rusqlite::Connection::open(path)
    } else {
        rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
    }
    .map_err(|e| format!("Could not open your library: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("Could not open your library: {e}"))?;
    Ok(conn)
}

/// What an earlier `add_study_pack(op_id)` did, read from its receipt.
#[tauri::command]
pub async fn study_pack_result(
    app: AppHandle,
    op_id: String,
) -> Result<Option<result::PackResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        result::read_result(&open_for_results(&app, false)?, &op_id)
    })
    .await
    .map_err(|error| format!("Could not read the study pack record: {error}"))?
}

/// Receipts she has not been told about yet.
#[tauri::command]
pub async fn pending_study_pack_results(app: AppHandle) -> Result<Vec<result::PackResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        result::pending_results(&open_for_results(&app, false)?)
    })
    .await
    .map_err(|error| format!("Could not read the study pack records: {error}"))?
}

/// Record that she has been told. Insert-only; telling twice is harmless.
#[tauri::command]
pub async fn ack_study_pack_result(app: AppHandle, op_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_for_results(&app, true)?;
        let now = crate::practice_sessions::db_now_iso(&conn)
            .map_err(|e| format!("Could not record the study pack: {e}"))?;
        result::ack(&conn, &op_id, &now)
    })
    .await
    .map_err(|error| format!("Could not record the study pack: {error}"))?
}
