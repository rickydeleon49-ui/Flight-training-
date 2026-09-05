//! Private document storage.
//!
//! Study materials are copied into the application's own data directory
//! rather than being referenced where the user happens to keep them. That
//! keeps personal training material inside app data (never the repository),
//! and means the library does not break when the original file moves.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::storage::app_root;

/// Subdirectory of app data that holds imported study materials.
const DOCUMENTS_DIR: &str = "documents";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDocument {
    /// Path relative to the documents directory, stored in SQLite.
    pub relative_path: String,
    /// The file name the user recognises, shown in the UI.
    pub original_file_name: String,
    pub file_size: u64,
}

/// Absolute path of the private documents directory, created if needed.
fn documents_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join(DOCUMENTS_DIR);

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the documents directory: {e}"))?;

    Ok(dir)
}

/// Reject anything that would escape the documents directory.
fn safe_relative_path(relative_path: &str) -> Result<&str, String> {
    let looks_absolute = Path::new(relative_path).is_absolute();
    if relative_path.is_empty()
        || looks_absolute
        || relative_path.contains("..")
        || relative_path.contains('\\')
    {
        return Err("Invalid document path.".to_string());
    }
    Ok(relative_path)
}

/// Keep only characters that are safe on every platform we target.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | ' ' => c,
            _ => '-',
        })
        .collect();

    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "document".to_string()
    } else {
        trimmed
    }
}

/// Copy a file the user picked into private application storage.
///
/// `material_id` namespaces the stored file so two documents with the same
/// name cannot collide.
#[tauri::command]
pub fn import_document(
    app: AppHandle,
    source_path: String,
    material_id: String,
) -> Result<ImportedDocument, String> {
    let source = PathBuf::from(&source_path);

    let metadata = std::fs::metadata(&source)
        .map_err(|e| format!("Could not read that file: {e}"))?;
    if !metadata.is_file() {
        return Err("Only files can be added to the library.".to_string());
    }

    let original_file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document")
        .to_string();

    let safe_id = sanitize_file_name(&material_id);
    let stored_name = format!("{safe_id}-{}", sanitize_file_name(&original_file_name));

    let root = documents_root(&app)?;
    let destination = root.join(&stored_name);

    std::fs::copy(&source, &destination)
        .map_err(|e| format!("Could not copy that file into the library: {e}"))?;

    Ok(ImportedDocument {
        relative_path: stored_name,
        original_file_name,
        file_size: metadata.len(),
    })
}

/// Absolute path for a stored document, for opening it in the system viewer.
#[tauri::command]
pub fn document_path(app: AppHandle, relative_path: String) -> Result<String, String> {
    let safe = safe_relative_path(&relative_path)?;
    let path = documents_root(&app)?.join(safe);
    Ok(path.to_string_lossy().to_string())
}

/// Whether a stored document is still present on disk.
///
/// The library shows a clear "file missing" state rather than failing when a
/// document has been removed outside the application.
#[tauri::command]
pub fn document_exists(app: AppHandle, relative_path: String) -> Result<bool, String> {
    let safe = safe_relative_path(&relative_path)?;
    Ok(documents_root(&app)?.join(safe).is_file())
}

/// Remove a stored document. Missing files are treated as already deleted.
#[tauri::command]
pub fn delete_document(app: AppHandle, relative_path: String) -> Result<(), String> {
    let safe = safe_relative_path(&relative_path)?;
    let path = documents_root(&app)?.join(safe);

    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove that document: {e}")),
    }
}
