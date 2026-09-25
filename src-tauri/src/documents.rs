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
/// Subdirectory inside documents for staged deletions.
pub(crate) const TRASH_DIR: &str = ".trash";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedDeletion {
    pub staged_id: String,
    pub original_relative_path: String,
    pub already_missing: bool,
}

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
pub(crate) fn safe_relative_path(relative_path: &str) -> Result<&str, String> {
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

fn trash_root(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the trash directory: {e}"))?;
    Ok(dir)
}

/// Stage a document for deletion by moving it to the private trash directory.
/// If the file is locked by another process (e.g. open in a PDF viewer on Windows),
/// the original file and database remain completely untouched and an error is returned.
pub fn stage_delete_document_in(
    root: &Path,
    relative_path: &str,
) -> Result<StagedDeletion, String> {
    let safe = safe_relative_path(relative_path)?;
    let source = root.join(DOCUMENTS_DIR).join(safe);

    if !source.exists() {
        return Ok(StagedDeletion {
            staged_id: String::new(),
            original_relative_path: safe.to_string(),
            already_missing: true,
        });
    }

    let trash = trash_root(root)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sanitized_name = sanitize_file_name(safe);
    let staged_id = format!("{now}-{sanitized_name}");
    let staged_file = trash.join(format!("{staged_id}.data"));
    let meta_file = trash.join(format!("{staged_id}.meta"));

    let staged_info = StagedDeletion {
        staged_id: staged_id.clone(),
        original_relative_path: safe.to_string(),
        already_missing: false,
    };

    let meta_json = serde_json::to_string_pretty(&staged_info)
        .map_err(|e| format!("Could not record staged deletion: {e}"))?;
    std::fs::write(&meta_file, meta_json)
        .map_err(|e| format!("Could not prepare staged deletion: {e}"))?;

    if let Err(e) = std::fs::rename(&source, &staged_file) {
        let _ = std::fs::remove_file(&meta_file);
        return Err(format!(
            "Could not delete that document because it is currently open in another app. Please close the file and try again. ({e})"
        ));
    }

    Ok(staged_info)
}

/// Validate that a staged ID is a single safe filename component.
pub fn validate_staged_id(staged_id: &str) -> Result<&str, String> {
    if staged_id.is_empty() {
        return Err("Staged ID cannot be empty.".to_string());
    }
    if staged_id.contains('/')
        || staged_id.contains('\\')
        || staged_id.contains(':')
        || staged_id.contains('\0')
        || staged_id.contains("..")
    {
        return Err("Invalid characters in staged ID.".to_string());
    }
    let mut components = Path::new(staged_id).components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(comp)), None) => {
            if comp.to_str() == Some(staged_id) {
                Ok(staged_id)
            } else {
                Err("Invalid staged ID encoding.".to_string())
            }
        }
        _ => Err("Staged ID must be a single safe filename component.".to_string()),
    }
}

/// Roll back a staged deletion by moving the file back from private trash.
pub fn rollback_delete_document_in(root: &Path, staged_id: &str) -> Result<(), String> {
    if staged_id.is_empty() {
        return Ok(());
    }
    validate_staged_id(staged_id)?;
    let trash = trash_root(root)?;
    let staged_file = trash.join(format!("{staged_id}.data"));
    let meta_file = trash.join(format!("{staged_id}.meta"));

    if meta_file.is_file() {
        let meta_json = std::fs::read_to_string(&meta_file)
            .map_err(|e| format!("Could not read staged deletion metadata: {e}"))?;
        let meta: StagedDeletion = serde_json::from_str(&meta_json)
            .map_err(|e| format!("Could not parse staged deletion metadata: {e}"))?;
        let normalized = meta.original_relative_path.replace('\\', "/");
        let safe_rel = safe_relative_path(&normalized).map_err(|_| {
            "Invalid original document path in staged deletion metadata.".to_string()
        })?;
        if staged_file.is_file() {
            let target = root.join(DOCUMENTS_DIR).join(safe_rel);
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::rename(&staged_file, &target)
                .map_err(|e| format!("Could not restore document during rollback: {e}"))?;
        }
        let _ = std::fs::remove_file(&meta_file);
    } else if staged_file.is_file() {
        let _ = std::fs::remove_file(&staged_file);
    }

    Ok(())
}

/// Commit and purge a staged deletion from private trash.
pub fn commit_delete_document_in(root: &Path, staged_id: &str) -> Result<(), String> {
    if staged_id.is_empty() {
        return Ok(());
    }
    validate_staged_id(staged_id)?;
    let trash = trash_root(root)?;
    let staged_file = trash.join(format!("{staged_id}.data"));
    let meta_file = trash.join(format!("{staged_id}.meta"));

    if staged_file.exists() {
        let _ = std::fs::remove_file(&staged_file);
    }
    if meta_file.exists() {
        let _ = std::fs::remove_file(&meta_file);
    }
    Ok(())
}

/// Clean up staged deletions across launches.
/// If an in-flight deletion was interrupted:
/// - If the SQLite database still references the file, it is restored.
/// - If the SQLite database no longer references the file, it is permanently purged.
///
/// If querying the database fails or the database file is missing, staged
/// files are left untouched so recovery retries on the next launch.
pub fn cleanup_staged_deletions_in(root: &Path) -> Result<usize, String> {
    let trash_dir = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
    if !trash_dir.exists() {
        return Ok(0);
    }

    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        eprintln!("Database file is missing; skipping staged deletion cleanup.");
        return Ok(0);
    }

    let referenced_documents = match crate::backup::query_referenced_documents(&db_path) {
        Ok(docs) => docs,
        Err(err) => {
            eprintln!("Could not inspect database for staged deletion cleanup: {err}");
            return Ok(0);
        }
    };

    let entries = match std::fs::read_dir(&trash_dir) {
        Ok(e) => e,
        Err(_) => return Ok(0),
    };

    let mut recovered_or_cleaned = 0;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("meta") {
            if let Ok(meta_json) = std::fs::read_to_string(&path) {
                if let Ok(meta) = serde_json::from_str::<StagedDeletion>(&meta_json) {
                    if validate_staged_id(&meta.staged_id).is_err() {
                        continue;
                    }
                    let normalized = meta.original_relative_path.replace('\\', "/");
                    let safe_rel = match safe_relative_path(&normalized) {
                        Ok(p) => p,
                        Err(_) => {
                            // Skip invalid metas without touching files
                            continue;
                        }
                    };
                    let data_path = trash_dir.join(format!("{}.data", meta.staged_id));
                    if referenced_documents.contains(safe_rel) {
                        let target = root.join(DOCUMENTS_DIR).join(safe_rel);
                        if let Some(parent) = target.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let restored = if data_path.is_file() {
                            match std::fs::rename(&data_path, &target) {
                                Ok(()) => true,
                                Err(err) => {
                                    eprintln!(
                                        "Could not restore staged document {safe_rel} from {}: {err}",
                                        data_path.display()
                                    );
                                    false
                                }
                            }
                        } else {
                            // If .data is already absent and the target exists, it was already restored
                            target.is_file()
                        };

                        if restored {
                            let _ = std::fs::remove_file(&path);
                            recovered_or_cleaned += 1;
                        }
                    } else {
                        // Not referenced by the database: permanently purge
                        if data_path.is_file() {
                            let _ = std::fs::remove_file(&data_path);
                        }
                        let _ = std::fs::remove_file(&path);
                        recovered_or_cleaned += 1;
                    }
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(&trash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("data") {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();
                if validate_staged_id(stem).is_ok() {
                    let meta_path = trash_dir.join(format!("{stem}.meta"));
                    if !meta_path.exists() {
                        let _ = std::fs::remove_file(&path);
                        recovered_or_cleaned += 1;
                    }
                }
            }
        }
    }

    Ok(recovered_or_cleaned)
}

/// Stage a document for deletion by moving it to private trash first.
#[tauri::command]
pub async fn stage_delete_document(
    app: AppHandle,
    relative_path: String,
) -> Result<StagedDeletion, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        stage_delete_document_in(&root, &relative_path)
    })
    .await
    .map_err(|e| format!("Could not finish staging document deletion: {e}"))?
}

/// Rollback a staged deletion by moving the file back from trash.
#[tauri::command]
pub async fn rollback_delete_document(app: AppHandle, staged_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        rollback_delete_document_in(&root, &staged_id)
    })
    .await
    .map_err(|e| format!("Could not rollback document deletion: {e}"))?
}

/// Commit and purge a staged deletion from private trash.
#[tauri::command]
pub async fn commit_delete_document(app: AppHandle, staged_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        commit_delete_document_in(&root, &staged_id)
    })
    .await
    .map_err(|e| format!("Could not purge deleted document: {e}"))?
}

/// Remove a stored document using recoverable staging.
#[tauri::command]
pub async fn delete_document(app: AppHandle, relative_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        let staged = stage_delete_document_in(&root, &relative_path)?;
        commit_delete_document_in(&root, &staged.staged_id)
    })
    .await
    .map_err(|e| format!("Could not finish deleting that document: {e}"))?
}

/// Clean up staged deletions on startup.
pub fn cleanup_staged_deletions(app: &AppHandle) -> Result<(), String> {
    let root = app_root(app)?;
    cleanup_staged_deletions_in(&root)?;
    Ok(())
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

    /// Capabilities must never grant unbounded or broad filesystem access.
    /// Every path scope in `opener` permissions must stay strictly pinned to
    /// `$APPCONFIG` or `$APPCONFIG/documents/**`.
    #[test]
    fn capabilities_do_not_grant_broad_filesystem_access() {
        let raw = include_str!("../capabilities/default.json");
        let capabilities: serde_json::Value = serde_json::from_str(raw).unwrap();
        let permissions = capabilities["permissions"].as_array().unwrap();

        const APPROVED_PATH_SCOPES: &[&str] = &["$APPCONFIG", "$APPCONFIG/documents/**"];

        for entry in permissions {
            if let Some(id) = entry.get("identifier").and_then(|id| id.as_str()) {
                if id.starts_with("opener:") && entry.get("allow").is_some() {
                    let allowed_array = entry["allow"].as_array().unwrap();
                    for rule in allowed_array {
                        if let Some(path) = rule.get("path").and_then(|p| p.as_str()) {
                            assert!(
                                APPROVED_PATH_SCOPES.contains(&path),
                                "Unapproved path scope {path:?} detected in {id}"
                            );
                            assert!(
                                !path.contains(".."),
                                "Path traversal '..' detected in {path:?}"
                            );
                            assert!(
                                !path.contains('\\'),
                                "Alternate separator '\\' detected in {path:?}"
                            );
                            assert!(
                                !path.contains(':') && !path.starts_with('/'),
                                "Drive or absolute root path detected in {path:?}"
                            );
                            assert!(
                                !path.contains('*') || path.ends_with("/**"),
                                "Wildcard permitted only as trailing '/**' in {path:?}"
                            );
                        } else if let Some(url) = rule.get("url").and_then(|u| u.as_str()) {
                            assert!(
                                url.starts_with("https://"),
                                "Dangerous URL scope {url:?} detected in {id}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn save_split_materials_waits_for_transient_exclusive_lock_and_succeeds() {
        let root = split_test_root();
        for id in ["one", "two"] {
            std::fs::write(root.join(DOCUMENTS_DIR).join(format!("{id}.pdf")), "pdf").unwrap();
        }

        let locker = Connection::open(root.join("her-flight-deck.db")).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            locker.execute("COMMIT", []).unwrap();
        });

        let result =
            save_split_materials_at(&root, &[split_material("one"), split_material("two")]);
        assert!(
            result.is_ok(),
            "Failed despite transient lock clearing: {result:?}"
        );

        handle.join().unwrap();
        let db = Connection::open(root.join("her-flight-deck.db")).unwrap();
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM study_materials", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_split_materials_times_out_boundedly_on_permanent_lock() {
        let root = split_test_root();
        std::fs::write(root.join(DOCUMENTS_DIR).join("one.pdf"), "pdf").unwrap();

        let locker = Connection::open(root.join("her-flight-deck.db")).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();

        let started = std::time::Instant::now();
        let result = save_split_materials_at(&root, &[split_material("one")]);
        let elapsed = started.elapsed();

        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(
            error.contains("database is locked") || error.contains("busy"),
            "Expected lock error, got {error}"
        );
        // Bounded by busy_timeout (5 seconds), must not hang indefinitely
        assert!(
            elapsed >= Duration::from_secs(4) && elapsed < Duration::from_secs(15),
            "Expected bounded timeout around 5s, took {elapsed:?}"
        );

        locker.execute("ROLLBACK", []).unwrap();
        drop(locker);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn scratch_doc_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("hfd-doc-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(DOCUMENTS_DIR)).unwrap();
        dir
    }

    #[test]
    fn staging_moves_file_to_trash_and_creates_metadata() {
        let root = scratch_doc_root("stage-moves");
        let doc_path = root.join(DOCUMENTS_DIR).join("sample.pdf");
        std::fs::write(&doc_path, b"sample pdf content").unwrap();

        let staged = stage_delete_document_in(&root, "sample.pdf").unwrap();
        assert!(!staged.already_missing);
        assert!(!staged.staged_id.is_empty());
        assert_eq!(staged.original_relative_path, "sample.pdf");

        // Original file moved from active documents
        assert!(!doc_path.exists());

        // File and metadata exist in .trash
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        assert!(trash.join(format!("{}.data", staged.staged_id)).is_file());
        assert!(trash.join(format!("{}.meta", staged.staged_id)).is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staging_already_missing_file_succeeds_without_error() {
        let root = scratch_doc_root("missing-ok");
        let staged = stage_delete_document_in(&root, "ghost.pdf").unwrap();
        assert!(staged.already_missing);
        assert!(staged.staged_id.is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_moves_file_back_from_trash_to_documents() {
        let root = scratch_doc_root("rollback-restores");
        let doc_path = root.join(DOCUMENTS_DIR).join("restorable.pdf");
        std::fs::write(&doc_path, b"important notes").unwrap();

        let staged = stage_delete_document_in(&root, "restorable.pdf").unwrap();
        assert!(!doc_path.exists());

        rollback_delete_document_in(&root, &staged.staged_id).unwrap();

        // File is back in place with identical content
        assert_eq!(std::fs::read(&doc_path).unwrap(), b"important notes");

        // Staged files cleaned up from trash
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        assert!(!trash.join(format!("{}.data", staged.staged_id)).exists());
        assert!(!trash.join(format!("{}.meta", staged.staged_id)).exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn commit_purges_file_and_metadata_from_trash() {
        let root = scratch_doc_root("commit-purges");
        let doc_path = root.join(DOCUMENTS_DIR).join("doomed.pdf");
        std::fs::write(&doc_path, b"to be purged").unwrap();

        let staged = stage_delete_document_in(&root, "doomed.pdf").unwrap();
        commit_delete_document_in(&root, &staged.staged_id).unwrap();

        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        assert!(!trash.join(format!("{}.data", staged.staged_id)).exists());
        assert!(!trash.join(format!("{}.meta", staged.staged_id)).exists());
        assert!(!doc_path.exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_staged_deletions_recovers_if_db_record_still_exists() {
        let root = scratch_doc_root("cleanup-recover");
        let db_path = root.join("her-flight-deck.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, file_path) VALUES ('mat1', 'retained.pdf')",
            [],
        )
        .unwrap();
        drop(conn);

        let doc_path = root.join(DOCUMENTS_DIR).join("retained.pdf");
        std::fs::write(&doc_path, b"retained training material").unwrap();

        let _staged = stage_delete_document_in(&root, "retained.pdf").unwrap();
        assert!(!doc_path.exists());

        // Simulate crash before DB delete: run startup recovery while DB still has reference
        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 1);

        // Document must be restored to active storage!
        assert!(doc_path.is_file());
        assert_eq!(
            std::fs::read(&doc_path).unwrap(),
            b"retained training material"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_staged_deletions_purges_if_db_record_does_not_exist() {
        let root = scratch_doc_root("cleanup-purge");
        let db_path = root.join("her-flight-deck.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT)",
            [],
        )
        .unwrap();
        // No rows in study_materials
        drop(conn);

        let doc_path = root.join(DOCUMENTS_DIR).join("orphaned.pdf");
        std::fs::write(&doc_path, b"abandoned trash").unwrap();

        let staged = stage_delete_document_in(&root, "orphaned.pdf").unwrap();

        // Simulate crash after DB delete: run startup recovery
        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 1);

        // File is purged permanently, not restored
        assert!(!doc_path.exists());
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        assert!(!trash.join(format!("{}.data", staged.staged_id)).exists());
        assert!(!trash.join(format!("{}.meta", staged.staged_id)).exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staging_locked_file_fails_cleanly_and_leaves_file_and_trash_clean() {
        let root = scratch_doc_root("locked-file");
        let doc_path = root.join(DOCUMENTS_DIR).join("locked.pdf");
        std::fs::write(&doc_path, b"locked in viewer").unwrap();

        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // share_mode(0) denies sharing, exactly as Adobe Acrobat or Word locks open files on Windows
            let lock_handle = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(&doc_path);

            if let Ok(_lock) = lock_handle {
                let result = stage_delete_document_in(&root, "locked.pdf");
                assert!(
                    result.is_err(),
                    "Expected failure when file is locked on Windows"
                );
                let err = result.unwrap_err();
                assert!(
                    err.contains("open in another app") || err.contains("close the file"),
                    "Expected clear retry message, got: {err}"
                );

                // Original file still intact
                assert!(doc_path.is_file());

                // No metadata left in trash
                let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
                if trash.exists() {
                    let entries: Vec<_> = std::fs::read_dir(&trash)
                        .unwrap()
                        .filter_map(|e| e.ok())
                        .collect();
                    assert!(
                        entries.is_empty(),
                        "Trash should have cleaned up temporary meta"
                    );
                }
            }
        }

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_leaves_trash_untouched_when_database_is_corrupt() {
        let root = scratch_doc_root("corrupt-db");
        let db_path = root.join("her-flight-deck.db");
        std::fs::write(&db_path, b"not a sqlite database").unwrap();

        // Confirm query_referenced_documents returns Err rather than Ok(empty)
        assert!(crate::backup::query_referenced_documents(&db_path).is_err());

        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        let staged_data = trash.join("staged-1.data");
        let staged_meta = trash.join("staged-1.meta");
        std::fs::write(&staged_data, b"important doc").unwrap();
        let meta = StagedDeletion {
            staged_id: "staged-1".to_string(),
            original_relative_path: "important.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(&staged_meta, serde_json::to_string(&meta).unwrap()).unwrap();

        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 0);

        // Files in trash are untouched
        assert!(staged_data.is_file());
        assert!(staged_meta.is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_leaves_staged_files_intact_when_restore_rename_fails() {
        let root = scratch_doc_root("rename-fails");
        let db_path = root.join("her-flight-deck.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, file_path) VALUES ('mat1', 'problem.pdf')",
            [],
        )
        .unwrap();
        drop(conn);

        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        let staged_data = trash.join("staged-prob.data");
        let staged_meta = trash.join("staged-prob.meta");
        std::fs::write(&staged_data, b"important doc content").unwrap();
        let meta = StagedDeletion {
            staged_id: "staged-prob".to_string(),
            original_relative_path: "problem.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(&staged_meta, serde_json::to_string(&meta).unwrap()).unwrap();

        // Cause rename to fail by creating the restore target as a directory
        let target_dir = root.join(DOCUMENTS_DIR).join("problem.pdf");
        std::fs::create_dir_all(&target_dir).unwrap();

        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 0);

        // Both .data and .meta survive cleanup; second loop never purges .data
        assert!(staged_data.is_file());
        assert!(staged_meta.is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_preserves_files_when_metadata_is_corrupt() {
        let root = scratch_doc_root("rollback-corrupt-meta");
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();

        let staged_data = trash.join("corrupt-id.data");
        let staged_meta = trash.join("corrupt-id.meta");
        std::fs::write(&staged_data, b"surviving data content").unwrap();
        std::fs::write(&staged_meta, b"{ not valid json").unwrap();

        let result = rollback_delete_document_in(&root, "corrupt-id");
        assert!(result.is_err());

        // Both files survive unparseable metadata
        assert!(staged_data.is_file());
        assert!(staged_meta.is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_leaves_trash_untouched_when_database_is_missing() {
        let root = scratch_doc_root("missing-db");
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        let staged_data = trash.join("staged-1.data");
        let staged_meta = trash.join("staged-1.meta");
        std::fs::write(&staged_data, b"important doc").unwrap();
        let meta = StagedDeletion {
            staged_id: "staged-1".to_string(),
            original_relative_path: "important.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(&staged_meta, serde_json::to_string(&meta).unwrap()).unwrap();

        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 0);

        // Files in trash are untouched
        assert!(staged_data.is_file());
        assert!(staged_meta.is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn traversal_staged_ids_are_rejected_for_rollback_and_commit() {
        let root = scratch_doc_root("traversal-staged-id");

        assert!(rollback_delete_document_in(&root, "../escaped").is_err());
        assert!(rollback_delete_document_in(&root, "..\\escaped").is_err());
        assert!(rollback_delete_document_in(&root, "sub/dir").is_err());
        assert!(rollback_delete_document_in(&root, "foo:bar").is_err());
        assert!(rollback_delete_document_in(&root, "foo\0bar").is_err());
        assert!(rollback_delete_document_in(&root, "").is_ok()); // empty is harmless no-op

        assert!(commit_delete_document_in(&root, "../escaped").is_err());
        assert!(commit_delete_document_in(&root, "..\\escaped").is_err());
        assert!(commit_delete_document_in(&root, "sub/dir").is_err());
        assert!(commit_delete_document_in(&root, "foo:bar").is_err());
        assert!(commit_delete_document_in(&root, "foo\0bar").is_err());
        assert!(commit_delete_document_in(&root, "").is_ok()); // empty is harmless no-op

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn meta_with_traversal_original_path_is_not_restored_outside_documents() {
        let root = scratch_doc_root("meta-traversal");
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();

        let staged_data = trash.join("escape-id.data");
        let staged_meta = trash.join("escape-id.meta");
        std::fs::write(&staged_data, b"malicious content").unwrap();

        let meta = StagedDeletion {
            staged_id: "escape-id".to_string(),
            original_relative_path: "../../evil.txt".to_string(),
            already_missing: false,
        };
        std::fs::write(&staged_meta, serde_json::to_string(&meta).unwrap()).unwrap();

        // Rollback refuses to restore traversal and skips/errors
        let rollback_result = rollback_delete_document_in(&root, "escape-id");
        assert!(rollback_result.is_err());
        assert!(!root.join("evil.txt").exists());

        // Cleanup also refuses to restore traversal and skips it without touching
        let db_path = root.join("her-flight-deck.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT)",
            [],
        )
        .unwrap();
        drop(conn);

        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 0);
        assert!(!root.join("evil.txt").exists());
        assert!(staged_data.is_file());
        assert!(staged_meta.is_file());

        let _ = std::fs::remove_dir_all(root);
    }
}
