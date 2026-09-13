//! Private document storage.
//!
//! Study materials are copied into the application's own data directory
//! rather than being referenced where the user happens to keep them. That
//! keeps personal training material inside app data (never the repository),
//! and means the library does not break when the original file moves.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::time::Duration;
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
pub async fn import_document(
    app: AppHandle,
    source_path: String,
    material_id: String,
) -> Result<ImportedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_document_from_path(&app, &source_path, &material_id)
    })
    .await
    .map_err(|error| format!("Could not finish importing that file: {error}"))?
}

fn import_document_from_path(
    app: &AppHandle,
    source_path: &str,
    material_id: &str,
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

    let (destination, stored_name) = stored_destination(app, material_id, &original_file_name)?;

    let copied = match std::fs::copy(&source, &destination) {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = std::fs::remove_file(&destination);
            return Err(format!(
                "Could not copy that file into the library: {error}"
            ));
        }
    };

    Ok(ImportedDocument {
        relative_path: stored_name,
        original_file_name,
        file_size: copied,
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

/// A split's metadata is committed on one SQLite connection. Tauri's SQL
/// plugin pools connections, so separate webview BEGIN/INSERT/COMMIT calls
/// cannot provide a transaction and can strand half a split in the library.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitMaterial {
    id: String,
    title: String,
    material_type: String,
    topic: String,
    review_status: String,
    priority: String,
    goal_id: Option<String>,
    event_id: Option<String>,
    notes: String,
    file_path: Option<String>,
    original_file_name: Option<String>,
    file_size: Option<i64>,
    created_at: String,
    updated_at: String,
    last_reviewed_at: Option<String>,
    tags: Vec<String>,
}

#[tauri::command]
pub async fn save_split_materials(
    app: AppHandle,
    materials: Vec<SplitMaterial>,
) -> Result<(), String> {
    let root = app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_split_materials_at(&root, &materials))
        .await
        .map_err(|error| format!("Could not finish saving PDF parts: {error}"))?
}

fn save_split_materials_at(root: &Path, materials: &[SplitMaterial]) -> Result<(), String> {
    if materials.is_empty() {
        return Ok(());
    }
    for material in materials {
        let path = material
            .file_path
            .as_deref()
            .ok_or_else(|| "A split part must have a stored PDF file.".to_string())?;
        let safe = safe_relative_path(path)?;
        let metadata = std::fs::metadata(root.join(DOCUMENTS_DIR).join(safe))
            .map_err(|_| format!("The PDF part is missing: {path}"))?;
        let bytes = metadata.len();
        if !metadata.is_file()
            || bytes == 0
            || bytes > crate::pdf::MAX_PDF_BYTES
            || material.file_size != Some(bytes as i64)
        {
            return Err(format!("The PDF part has an invalid size: {path}"));
        }
    }
    let database = root.join("her-flight-deck.db");
    if !database.is_file() {
        return Err("The library database is missing.".to_string());
    }
    let mut connection = Connection::open(database)
        .map_err(|error| format!("Could not open the library database: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Could not configure the library database: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not protect library references: {error}"))?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start saving PDF parts: {error}"))?;
    for material in materials {
        transaction.execute(
            "INSERT INTO study_materials (id, title, material_type, topic, review_status, priority,
               goal_id, event_id, notes, file_path, original_file_name, file_size,
               created_at, updated_at, last_reviewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                material.id, material.title, material.material_type, material.topic,
                material.review_status, material.priority, material.goal_id, material.event_id,
                material.notes, material.file_path, material.original_file_name, material.file_size,
                material.created_at, material.updated_at, material.last_reviewed_at,
            ],
        ).map_err(|error| format!("Could not save a PDF part: {error}"))?;
        for (index, raw) in material.tags.iter().enumerate() {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            transaction
                .execute(
                    "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                    params![
                        format!("{}-split-tag-{index}", material.id),
                        name,
                        material.created_at
                    ],
                )
                .map_err(|error| format!("Could not save a PDF tag: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO material_tags (material_id, tag_id)
                 SELECT ?1, id FROM tags WHERE name = ?2",
                    params![material.id, name],
                )
                .map_err(|error| format!("Could not attach a PDF tag: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not commit PDF parts: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split_test_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hfd-split-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let connection = Connection::open(root.join("her-flight-deck.db")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE study_materials (
               id TEXT PRIMARY KEY, title TEXT, material_type TEXT, topic TEXT,
               review_status TEXT, priority TEXT, goal_id TEXT, event_id TEXT,
               notes TEXT, file_path TEXT, original_file_name TEXT, file_size INTEGER,
               created_at TEXT, updated_at TEXT, last_reviewed_at TEXT);
             CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT UNIQUE, created_at TEXT);
             CREATE TABLE material_tags (
               material_id TEXT REFERENCES study_materials(id),
               tag_id TEXT REFERENCES tags(id), PRIMARY KEY (material_id, tag_id));",
            )
            .unwrap();
        root
    }

    fn split_material(id: &str) -> SplitMaterial {
        SplitMaterial {
            id: id.to_string(),
            title: id.to_string(),
            material_type: "study_guide".to_string(),
            topic: "general".to_string(),
            review_status: "needs_review".to_string(),
            priority: "later".to_string(),
            goal_id: None,
            event_id: None,
            notes: String::new(),
            file_path: Some(format!("{id}.pdf")),
            original_file_name: Some(format!("{id}.pdf")),
            file_size: Some(3),
            created_at: "2026-09-12T00:00:00Z".to_string(),
            updated_at: "2026-09-12T00:00:00Z".to_string(),
            last_reviewed_at: None,
            tags: vec!["handbook".to_string()],
        }
    }

    #[test]
    fn split_parts_and_tags_commit_together_on_one_connection() {
        let root = split_test_root();
        for id in ["one", "two"] {
            std::fs::write(root.join(DOCUMENTS_DIR).join(format!("{id}.pdf")), "pdf").unwrap();
        }
        save_split_materials_at(&root, &[split_material("one"), split_material("two")]).unwrap();
        let db = Connection::open(root.join("her-flight-deck.db")).unwrap();
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM study_materials", [], |row| row.get(0))
            .unwrap();
        let tags: i64 = db
            .query_row("SELECT COUNT(*) FROM material_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!((count, tags), (2, 2));
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failed_split_record_rolls_back_every_part_and_tag() {
        let root = split_test_root();
        std::fs::write(root.join(DOCUMENTS_DIR).join("one.pdf"), "pdf").unwrap();
        assert!(
            save_split_materials_at(&root, &[split_material("one"), split_material("one")])
                .is_err()
        );
        let db = Connection::open(root.join("her-flight-deck.db")).unwrap();
        for table in ["study_materials", "tags", "material_tags"] {
            let count: i64 = db
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} retained part of a failed split");
        }
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn split_records_refuse_missing_or_mismatched_files_before_writing() {
        let root = split_test_root();
        let material = split_material("one");
        assert!(save_split_materials_at(&root, &[split_material("one")]).is_err());
        std::fs::write(root.join(DOCUMENTS_DIR).join("one.pdf"), "larger").unwrap();
        assert!(save_split_materials_at(&root, &[material]).is_err());
        let db = Connection::open(root.join("her-flight-deck.db")).unwrap();
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM study_materials", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

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
