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

/// Starts every message that says an add was definitely refused (nothing was
/// committed). The screen shows the sentence after it. A message without this
/// start (a lost connection, an unknown outcome) is never read as a refusal.
pub const REFUSED_MARK: &str = "refused: ";

/// Mark a definite refusal; pass an unknown outcome through without the mark.
pub(crate) fn mark_add_error(message: String) -> String {
    if message.starts_with(install::UNKNOWN_MARK) {
        message
    } else {
        format!("{REFUSED_MARK}{message}")
    }
}

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
    crate::picked_paths::require_picked(&app, &source_path).map_err(mark_add_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::storage::app_root(&app).map_err(mark_add_error)?;
        install::add_study_pack_in(
            &root,
            crate::library_lock::owned(&app),
            std::path::Path::new(&source_path),
            &op_id,
        )
        .map_err(mark_add_error)
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
        reconcile_study_pack_imports_in(&root, crate::library_lock::owned(&app)).map(|_| ())
    })
    .await
    .map_err(|error| format!("Could not check the study packs: {error}"))?
}

/// The one way into the library database from study pack code. Read-only
/// connections never write; every connection waits `busy_ms` for a lock.
pub(crate) fn open_library(
    root: &std::path::Path,
    read_only: bool,
    busy_ms: u64,
) -> rusqlite::Result<rusqlite::Connection> {
    let path = root.join(crate::backup::DB_FILES[0]);
    let conn = if read_only {
        rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?
    } else {
        rusqlite::Connection::open(path)?
    };
    conn.busy_timeout(std::time::Duration::from_millis(busy_ms))?;
    Ok(conn)
}

/// Storage this process does not own is never reconciled: another copy could
/// be in the middle of an import there.
pub fn reconcile_study_pack_imports_in(
    root: &std::path::Path,
    owned: bool,
) -> Result<reconcile::Report, String> {
    if !owned {
        return Ok(reconcile::Report::default());
    }
    let guard = crate::library_lock::try_acquire(root, crate::library_lock::Holder::Pack)?;
    reconcile::reconcile_locked(&guard, root, reconcile::Mode::Normal)
}

fn open_for_results(app: &AppHandle, write: bool) -> Result<rusqlite::Connection, String> {
    let root = crate::storage::app_root(app)?;
    open_library(&root, !write, 5000).map_err(|e| format!("Could not open your library: {e}"))
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

#[cfg(test)]
mod mark_tests {
    use super::*;

    #[test]
    fn only_a_known_refusal_is_marked() {
        assert_eq!(
            mark_add_error("Finish the restore first.".into()),
            "refused: Finish the restore first."
        );
        let unknown = format!("{}maybe", install::UNKNOWN_MARK);
        assert!(!mark_add_error(unknown).starts_with(REFUSED_MARK));
    }
}
