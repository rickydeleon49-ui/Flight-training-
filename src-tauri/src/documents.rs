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
        || relative_path.contains(':')
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

/// Where a new stored document goes, and the name it will be kept under.
///
/// `material_id` namespaces the stored file so two documents with the same
/// name cannot collide. Anything that writes into the library goes through
/// here, so the naming rules live in one place.
pub(crate) fn stored_destination(
    app: &AppHandle,
    material_id: &str,
    file_name: &str,
) -> Result<(PathBuf, String), String> {
    let safe_id = sanitize_file_name(material_id);
    let stored_name = format!("{safe_id}-{}", sanitize_file_name(file_name));
    reserve_destination(&documents_root(app)?, &stored_name)
}

/// Reserve a fresh name atomically. Replacing a same-named attachment used to
/// overwrite its bytes before the edit was saved (even when later cancelled).
fn reserve_destination(root: &Path, name: &str) -> Result<(PathBuf, String), String> {
    for attempt in 0..10_000 {
        let candidate = if attempt == 0 {
            name.to_string()
        } else {
            format!("{attempt}-{name}")
        };
        let path = root.join(&candidate);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok((path, candidate)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not reserve a document file: {error}")),
        }
    }
    Err("Too many documents have the same stored name.".to_string())
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

    let (destination, stored_name) = stored_destination(&app, &material_id, &original_file_name)?;

    if let Err(error) = std::fs::copy(&source, &destination) {
        let _ = std::fs::remove_file(&destination);
        return Err(format!(
            "Could not copy that file into the library: {error}"
        ));
    }

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

    #[test]
    fn windows_drive_and_alternate_stream_paths_are_refused_on_every_platform() {
        for path in ["C:secrets", "C:/secrets", "notes.pdf:hidden"] {
            assert!(safe_relative_path(path).is_err());
        }
    }

    #[test]
    fn replacing_an_attachment_never_overwrites_the_saved_file() {
        let root = std::env::temp_dir().join(format!("hfd-import-reserve-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let (first, _) = reserve_destination(&root, "material-handbook.pdf").unwrap();
        std::fs::write(&first, b"original saved attachment").unwrap();
        let (second, _) = reserve_destination(&root, "material-handbook.pdf").unwrap();
        std::fs::write(&second, b"replacement not yet saved").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), b"original saved attachment");
        let (third, _) = reserve_destination(&root, "material-handbook.pdf").unwrap();
        assert_ne!(second, third);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// `tauri-plugin-opener`'s `open_path` and `reveal_item_in_dir` deny
    /// every path unless the capability that grants them also carries a
    /// scope entry that matches it — an unscoped `"opener:allow-open-path"`
    /// string looks like it grants access, but the plugin's own scope check
    /// (`self.allowed.iter().any(...)` over an *empty* list) refuses every
    /// path, including her own documents. That produced exactly the bug this
    /// scope exists to fix: "Not allowed to open path
    /// .../documents/....pdf" on open, with the identical failure on reveal.
    /// This reads the real capability file so a future edit that drops the
    /// scope, or narrows it to the wrong directory, fails a test instead of
    /// only showing up when a document is actually opened.
    #[test]
    fn opening_or_revealing_a_document_is_scoped_to_the_documents_folder() {
        let raw = include_str!("../capabilities/default.json");
        let capabilities: serde_json::Value = serde_json::from_str(raw).unwrap();
        let permissions = capabilities["permissions"]
            .as_array()
            .expect("capabilities file must list permissions");

        for identifier in ["opener:allow-open-path", "opener:allow-reveal-item-in-dir"] {
            let entry = permissions
                .iter()
                .find(|permission| {
                    permission.get("identifier").and_then(|id| id.as_str()) == Some(identifier)
                })
                .unwrap_or_else(|| {
                    panic!(
                        "{identifier} must be granted with a path scope, not as a bare \
                         permission string — see the module comment on `documents_root`."
                    )
                });
            let allowed_path = entry["allow"][0]["path"]
                .as_str()
                .unwrap_or_else(|| panic!("{identifier} has no scoped path entry"));
            assert!(
                allowed_path.starts_with("$APPCONFIG/documents"),
                "{identifier} is scoped to {allowed_path}, not the documents folder \
                 (`storage::app_root` resolves to `$APPCONFIG`)"
            );
        }
    }

    /// Settings' "Open folder" button reveals the whole data directory
    /// (`data_directory` returns `app_root`, i.e. `$APPCONFIG` itself), not a
    /// path under `documents/` — it needs its own scope entry on the same
    /// permission, or it fails with the identical "Not allowed to open path"
    /// error the documents-folder scope above exists to prevent.
    #[test]
    fn opening_the_whole_data_directory_from_settings_is_also_scoped() {
        let raw = include_str!("../capabilities/default.json");
        let capabilities: serde_json::Value = serde_json::from_str(raw).unwrap();
        let permissions = capabilities["permissions"].as_array().unwrap();

        let entry = permissions
            .iter()
            .find(|permission| {
                permission.get("identifier").and_then(|id| id.as_str())
                    == Some("opener:allow-open-path")
            })
            .expect("opener:allow-open-path must be present");
        let allowed_paths: Vec<&str> = entry["allow"]
            .as_array()
            .expect("opener:allow-open-path must have a scope array")
            .iter()
            .filter_map(|allowed| allowed["path"].as_str())
            .collect();

        assert!(
            allowed_paths.contains(&"$APPCONFIG"),
            "opener:allow-open-path scope {allowed_paths:?} does not cover $APPCONFIG itself, \
             which is exactly what `data_directory` returns for Settings' \"Open folder\" button"
        );
    }
}
