//! Study packs (PACK-01): a single `.hfdpack` file that carries study
//! material from one library to another. Stage 1 covers the file format, its
//! validators, the revision and export. Nothing is imported here.

pub mod export;
pub mod format;
pub mod revision;
pub mod validate;

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
