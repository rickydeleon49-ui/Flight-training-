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

/// Resolve a stored study document without exposing the absolute path to the webview.
pub(crate) fn stored_document_path(
    app: &AppHandle,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let safe = safe_relative_path(relative_path)?;
    Ok(documents_root(app)?.join(safe))
}

/// Reject anything that would escape the documents directory.
///
/// Only a `..` *component* climbs out. Rejecting the two characters wherever
/// they appeared also refused ordinary names — "Chapter 3 .. Airspace.pdf" was
/// imported happily and then could never be opened, checked, or deleted again.
fn safe_relative_path(relative_path: &str) -> Result<&str, String> {
    if relative_path.is_empty()
        || Path::new(relative_path).is_absolute()
        || relative_path.contains('\\')
        || relative_path.contains('\0')
    {
        return Err("Invalid document path.".to_string());
    }
    let climbs_out = Path::new(relative_path)
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)));
    if climbs_out {
        return Err("Invalid document path.".to_string());
    }
    Ok(relative_path)
}

/// Keep only characters that are safe on every platform we target.
///
/// Runs of dots collapse to one. A stored name is never meant to be a `..`
/// component, and one dot reads the same to her as three.
fn sanitize_file_name(name: &str) -> String {
    let mut cleaned = String::with_capacity(name.len());
    for character in name.chars() {
        let kept = match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | ' ' => character,
            _ => '-',
        };
        if kept == '.' && cleaned.ends_with('.') {
            continue;
        }
        cleaned.push(kept);
    }

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

    let metadata =
        std::fs::metadata(&source).map_err(|e| format!("Could not read that file: {e}"))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The name she picked survives, minus anything a filesystem would object to.
    #[test]
    fn a_sanitized_name_keeps_the_words_she_recognises() {
        assert_eq!(
            sanitize_file_name("PHAK Chapter 3.pdf"),
            "PHAK Chapter 3.pdf"
        );
        assert_eq!(
            sanitize_file_name("Weather/Notes?.pdf"),
            "Weather-Notes-.pdf"
        );
    }

    /// Two dots in a row used to survive into the stored name and then make the
    /// file unreachable for the rest of its life.
    #[test]
    fn runs_of_dots_collapse_so_a_stored_name_never_holds_two() {
        assert_eq!(
            sanitize_file_name("Chapter 3 .. Airspace.pdf"),
            "Chapter 3 . Airspace.pdf"
        );
        assert_eq!(sanitize_file_name("notes..pdf"), "notes.pdf");
        assert_eq!(
            sanitize_file_name("final.v2...draft.pdf"),
            "final.v2.draft.pdf"
        );
    }

    #[test]
    fn a_name_with_nothing_usable_left_still_gets_one() {
        assert_eq!(sanitize_file_name("..."), "document");
        assert_eq!(sanitize_file_name("   "), "document");
    }

    /// The whole point: whatever import stores can be opened again afterwards.
    #[test]
    fn every_imported_name_can_be_resolved_again() {
        for original in [
            "Chapter 3 .. Airspace.pdf",
            "notes..pdf",
            "PHAK — ch.3.pdf",
            "..",
            "...",
            "medical.pdf",
        ] {
            let stored = format!(
                "{}-{}",
                sanitize_file_name("mat_abc123"),
                sanitize_file_name(original)
            );
            assert!(
                safe_relative_path(&stored).is_ok(),
                "{original:?} stored as {stored:?}, which could not be resolved"
            );
        }
    }

    /// An ordinary name that merely contains dots is not an escape attempt.
    #[test]
    fn dots_inside_a_name_are_not_treated_as_climbing_out() {
        assert!(safe_relative_path("mat_1-Chapter 3 .. Airspace.pdf").is_ok());
        assert!(safe_relative_path("mat_1-notes..pdf").is_ok());
    }

    #[test]
    fn climbing_out_of_the_documents_folder_is_refused() {
        for attempt in ["../secrets", "a/../../b", "..", "/etc/passwd", "", "a\\b"] {
            assert!(
                safe_relative_path(attempt).is_err(),
                "{attempt:?} should have been refused"
            );
        }
    }

    #[test]
    fn a_nested_stored_path_is_still_allowed() {
        assert!(safe_relative_path("nested/document.pdf").is_ok());
    }
}
