//! Private document storage.
//!
//! Study materials are copied into the application's own data directory
//! rather than being referenced where the user happens to keep them. That
//! keeps personal training material inside app data (never the repository),
//! and means the library does not break when the original file moves.

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Deserializer, Serialize};
use std::time::Duration;
use tauri::AppHandle;

use crate::storage::app_root;

/// Subdirectory of app data that holds imported study materials.
pub(crate) const DOCUMENTS_DIR: &str = "documents";
/// Subdirectory inside documents for staged deletions.
pub(crate) const TRASH_DIR: &str = ".trash";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedDeletion {
    pub staged_id: String,
    pub original_relative_path: String,
    pub already_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingMaterialInfo {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub original_file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedFileInfo {
    pub relative_path: String,
    pub file_name: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryReport {
    pub missing_materials: Vec<MissingMaterialInfo>,
    pub unlinked_files: Vec<UnlinkedFileInfo>,
    pub total_materials: usize,
    pub total_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDocument {
    /// Path relative to the documents directory, stored in SQLite.
    pub relative_path: String,
    /// The file name the user recognises, shown in the UI.
    pub original_file_name: String,
    pub file_size: u64,
    pub pdf_identity: Option<crate::study_page_sources::Preview>,
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

/// Whether a (forward-slash) stored path is hidden, trashed, or spelled in a
/// way the filesystem resolves to something other than its literal text: an
/// empty component (`a//b.pdf`, a trailing slash), or a Windows trailing dot
/// or space. Such spellings are refused rather than normalized, so a cleanup
/// request can never name a file under an alias of that kind.
fn is_hidden_or_ambiguous(safe: &str) -> bool {
    safe.split('/').any(|part| {
        part.is_empty() || part.starts_with('.') || part.ends_with('.') || part.ends_with(' ')
    })
}

/// Whether any study material refers to the same physical file as
/// `canonical_target` (the canonicalized path of an existing file).
///
/// String equality is not identity: `CaseGuide.pdf` versus `CASEGUIDE.PDF` on
/// a case-insensitive volume, a path through a directory link, a stored
/// legacy spelling, or a Windows 8.3 short name can all open the same file.
/// Each stored path the app itself could open is canonicalized by the
/// filesystem and compared, so the volume decides case sensitivity: names
/// that are distinct files on a case-sensitive volume canonicalize
/// differently and are not conflated. A stored path the app would refuse to
/// open cannot protect anything and is skipped, as is a stored file that is
/// simply missing; any other failure to resolve a reference fails closed.
///
/// Call this inside the writer transaction that also performs the cleanup.
fn document_is_referenced(
    tx: &Connection,
    docs_dir: &Path,
    safe_rel: &str,
    canonical_target: &Path,
) -> Result<bool, String> {
    let exact: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM study_materials WHERE REPLACE(file_path, CHAR(92), '/') = ?1",
            params![safe_rel],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not check existing file links: {e}"))?;
    if exact.is_some() {
        return Ok(true);
    }
    let mut stmt = tx
        .prepare(
            "SELECT file_path FROM study_materials WHERE file_path IS NOT NULL AND file_path != ''",
        )
        .map_err(|e| format!("Could not check existing file links: {e}"))?;
    let stored = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Could not check existing file links: {e}"))?;
    for path in stored {
        let path = path.map_err(|e| format!("Could not check existing file links: {e}"))?;
        let normalized = path.replace('\\', "/");
        let Ok(stored_safe) = safe_relative_path(&normalized) else {
            continue;
        };
        match docs_dir.join(stored_safe).canonicalize() {
            Ok(canonical) if canonical == canonical_target => return Ok(true),
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) => {}
            Err(error) => {
                return Err(format!(
                    "Could not verify the stored document reference '{stored_safe}', so nothing was removed: {error}"
                ))
            }
        }
    }
    Ok(false)
}

fn active_managed_file(
    root: &Path,
    relative_path: &str,
) -> Result<(String, PathBuf, std::fs::Metadata), String> {
    let normalized = relative_path.replace('\\', "/");
    let safe = safe_relative_path(&normalized)?;
    if is_hidden_or_ambiguous(safe) {
        return Err("Hidden or ambiguous document paths cannot be repaired here.".to_string());
    }
    let docs_dir = root.join(DOCUMENTS_DIR);
    let target = docs_dir.join(safe);
    let canonical_docs = docs_dir
        .canonicalize()
        .map_err(|e| format!("Could not verify document storage: {e}"))?;
    let canonical_parent = target
        .parent()
        .ok_or_else(|| "Invalid document path.".to_string())?
        .canonicalize()
        .map_err(|e| format!("Could not verify document folder: {e}"))?;
    if !canonical_parent.starts_with(&canonical_docs) {
        return Err("Document path leaves app storage.".to_string());
    }
    let metadata = std::fs::symlink_metadata(&target)
        .map_err(|e| format!("Could not read file '{safe}': {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Only real app-owned files can be used here.".to_string());
    }
    Ok((safe.to_string(), target, metadata))
}

/// Move a file from `from` to `to` using an atomic no-replace operation.
///
/// On macOS, standard `std::fs::rename` unconditionally overwrites an existing
/// destination file. To prevent TOCTOU races where a file appears at `to`
/// between a check and rename, we use Darwin's kernel-level `renamex_np` with
/// `RENAME_EXCL` (with fallback to POSIX `hard_link` + `remove_file` if unsupported).
///
/// On Linux, we use `renameat2` with `RENAME_NOREPLACE` (with fallback to `hard_link`).
///
/// On Windows, `std::fs::rename` maps to `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`,
/// which atomically fails with `ERROR_ALREADY_EXISTS` (183) if `to` exists.
#[cfg(target_os = "macos")]
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    extern "C" {
        fn renamex_np(
            from: *const std::os::raw::c_char,
            to: *const std::os::raw::c_char,
            flags: std::os::raw::c_uint,
        ) -> std::os::raw::c_int;
    }

    const RENAME_EXCL: std::os::raw::c_uint = 0x00000004;

    let from_c = CString::new(from.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let to_c = CString::new(to.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;

    let res = unsafe { renamex_np(from_c.as_ptr(), to_c.as_ptr(), RENAME_EXCL) };
    if res == 0 {
        Ok(())
    } else {
        let err = std::io::Error::last_os_error();
        // If renamex_np is unsupported on the underlying filesystem (ENOTSUP = 45),
        // fallback to hard_link + remove_file.
        if err.raw_os_error() == Some(45) {
            std::fs::hard_link(from, to)?;
            std::fs::remove_file(from)?;
            Ok(())
        } else {
            Err(err)
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    extern "C" {
        fn renameat2(
            olddirfd: std::os::raw::c_int,
            oldpath: *const std::os::raw::c_char,
            newdirfd: std::os::raw::c_int,
            newpath: *const std::os::raw::c_char,
            flags: std::os::raw::c_uint,
        ) -> std::os::raw::c_int;
    }

    const AT_FDCWD: std::os::raw::c_int = -100;
    const RENAME_NOREPLACE: std::os::raw::c_uint = 1;

    let from_c = CString::new(from.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let to_c = CString::new(to.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;

    let res = unsafe {
        renameat2(
            AT_FDCWD,
            from_c.as_ptr(),
            AT_FDCWD,
            to_c.as_ptr(),
            RENAME_NOREPLACE,
        )
    };
    if res == 0 {
        Ok(())
    } else {
        let err = std::io::Error::last_os_error();
        // If renameat2 is unsupported on the kernel or filesystem (ENOSYS = 38, EINVAL = 22),
        // fallback to hard_link + remove_file.
        if err.raw_os_error() == Some(38) || err.raw_os_error() == Some(22) {
            std::fs::hard_link(from, to)?;
            std::fs::remove_file(from)?;
            Ok(())
        } else {
            Err(err)
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
    }

    let mut from_wide: Vec<u16> = from.as_os_str().encode_wide().collect();
    from_wide.push(0);
    let mut to_wide: Vec<u16> = to.as_os_str().encode_wide().collect();
    to_wide.push(0);

    // Call MoveFileExW with dwFlags = 0 (omitting MOVEFILE_REPLACE_EXISTING = 0x1).
    // Win32 MoveFileExW atomically fails with ERROR_ALREADY_EXISTS (183) or
    // ERROR_FILE_EXISTS (80) if `to` already exists, guaranteeing no-overwrite.
    let success = unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), 0) };
    if success != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::hard_link(from, to)?;
    std::fs::remove_file(from)
}

pub(crate) fn is_already_exists_error(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::AlreadyExists
        || err.raw_os_error() == Some(183) // Windows ERROR_ALREADY_EXISTS
        || err.raw_os_error() == Some(80)  // Windows ERROR_FILE_EXISTS
        || err.raw_os_error() == Some(17) // Unix EEXIST
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
    stored_destination_in(&documents_root(app)?, material_id, file_name)
}

/// `stored_destination` against an explicit documents directory.
pub(crate) fn stored_destination_in(
    documents_dir: &Path,
    material_id: &str,
    file_name: &str,
) -> Result<(PathBuf, String), String> {
    let safe_id = sanitize_file_name(material_id);
    let stored_name = format!("{safe_id}-{}", sanitize_file_name(file_name));
    reserve_destination(documents_dir, &stored_name)
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
    pdf_only: Option<bool>,
) -> Result<ImportedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_document_from_path(&app, &source_path, &material_id, pdf_only.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("Could not finish importing that file: {error}"))?
}

fn import_document_from_path(
    app: &AppHandle,
    source_path: &str,
    material_id: &str,
    pdf_only: bool,
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

    let pdf_identity = if pdf_only {
        match imported_pdf_identity(&destination) {
            Ok(identity) => Some(identity),
            Err(error) => {
                let _ = std::fs::remove_file(&destination);
                return Err(error);
            }
        }
    } else {
        None
    };

    Ok(ImportedDocument {
        relative_path: stored_name,
        original_file_name,
        file_size: copied,
        pdf_identity,
    })
}

fn imported_pdf_identity(path: &Path) -> Result<crate::study_page_sources::Preview, String> {
    let bytes =
        std::fs::read(path).map_err(|_| "That PDF could not be read. Try choosing it again.")?;
    let (content_sha256, total_pages) = crate::navigation::identity_of_bytes(&bytes)
        .map_err(|_| "Choose a readable PDF with at least one page.")?;
    Ok(crate::study_page_sources::Preview {
        content_sha256,
        total_pages,
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

    if let Ok(meta) = std::fs::symlink_metadata(&source) {
        if meta.file_type().is_symlink() {
            return Err("A symbolic link cannot be staged for deletion.".to_string());
        }
    }

    let trash = trash_root(root)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
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
    let mut meta_handle = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&meta_file)
        .map_err(|e| format!("Could not prepare staged deletion: {e}"))?;
    if let Err(error) = meta_handle.write_all(meta_json.as_bytes()) {
        drop(meta_handle);
        let _ = std::fs::remove_file(&meta_file);
        return Err(format!("Could not record staged deletion: {error}"));
    }
    drop(meta_handle);

    if let Err(e) = rename_no_replace(&source, &staged_file) {
        let _ = std::fs::remove_file(&meta_file);
        if is_already_exists_error(&e) || staged_file.exists() {
            return Err("Could not stage that document because a trash entry with the same name already exists. The original file is unchanged.".to_string());
        }
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
            if let Err(e) = rename_no_replace(&staged_file, &target) {
                if is_already_exists_error(&e) || target.exists() {
                    return Err(format!(
                        "Could not restore document during rollback: destination file already exists: {safe_rel}"
                    ));
                }
                return Err(format!("Could not restore document during rollback: {e}"));
            }
        }
        let _ = std::fs::remove_file(&meta_file);
    } else {
        return Err(format!(
            "Could not roll back deletion: metadata for staged ID '{staged_id}' was not found."
        ));
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

    for path in [&staged_file, &meta_file] {
        match std::fs::remove_file(path) {
            Ok(())=>{},
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(_)=>return Err("The material was removed, but its file could not be cleared from private trash. Restart the app to try cleanup again.".into()),
        }
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
                            match rename_no_replace(&data_path, &target) {
                                Ok(()) => true,
                                Err(err) => {
                                    if is_already_exists_error(&err) || target.exists() {
                                        eprintln!(
                                            "Conflict restoring staged document {safe_rel}: destination file already exists at {}",
                                            target.display()
                                        );
                                    } else {
                                        eprintln!(
                                            "Could not restore staged document {safe_rel} from {}: {err}",
                                            data_path.display()
                                        );
                                    }
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
                        commit_delete_document_in(root, &meta.staged_id)?;
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

/// Remove a stored document using recoverable staging, after verifying it is not referenced in the database.
pub fn delete_document_in(root: &Path, relative_path: &str) -> Result<(), String> {
    let normalized = relative_path.replace('\\', "/");
    let safe_rel = safe_relative_path(&normalized)?;
    if is_hidden_or_ambiguous(safe_rel) {
        return Err("Hidden or ambiguous document paths cannot be deleted here.".to_string());
    }

    let docs_dir = root.join(DOCUMENTS_DIR);
    let target = docs_dir.join(safe_rel);

    // If genuinely already missing on disk, return Ok(()) deliberately
    if !target.exists() {
        return Ok(());
    }

    let canonical_docs = docs_dir
        .canonicalize()
        .map_err(|e| format!("Could not verify document storage: {e}"))?;
    let canonical_parent = target
        .parent()
        .ok_or_else(|| "Invalid document path.".to_string())?
        .canonicalize()
        .map_err(|e| format!("Could not verify document folder: {e}"))?;
    if !canonical_parent.starts_with(&canonical_docs) {
        return Err("Document path leaves app storage.".to_string());
    }

    let metadata = std::fs::symlink_metadata(&target)
        .map_err(|e| format!("Could not read file '{safe_rel}': {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Only real app-owned files can be deleted here.".to_string());
    }
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("Could not verify file '{safe_rel}': {e}"))?;

    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err("Database file is missing.".to_string());
    }
    let mut connection = Connection::open(&db_path)
        .map_err(|e| format!("Could not inspect database before deleting file: {e}"))?;
    connection
        .busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Could not set database timeout: {e}"))?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Could not start safe file deletion: {e}"))?;
    if document_is_referenced(&tx, &docs_dir, safe_rel, &canonical_target)? {
        return Err(format!(
            "Cannot delete referenced file: {safe_rel} is attached to a study material."
        ));
    }

    let staged = stage_delete_document_in(root, safe_rel)?;
    if let Err(error) = tx.commit() {
        if !staged.staged_id.is_empty() {
            let _ = rollback_delete_document_in(root, &staged.staged_id);
        }
        return Err(format!("Could not finish safe file deletion: {error}"));
    }

    commit_delete_document_in(root, &staged.staged_id)
}

/// Remove a stored document using recoverable staging.
#[tauri::command]
pub async fn delete_document(app: AppHandle, relative_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        delete_document_in(&root, &relative_path)
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

const MAX_SCAN_DEPTH: usize = 16;
const MAX_SCAN_ENTRIES: usize = 50_000;

fn scan_stored_documents_recursive(
    current_dir: &Path,
    relative_prefix: &Path,
    depth: usize,
    visited: &mut usize,
    collected: &mut Vec<UnlinkedFileInfo>,
) -> Result<(), String> {
    if depth > MAX_SCAN_DEPTH {
        return Err("Document directory nesting is too deep.".to_string());
    }
    let entries = match std::fs::read_dir(current_dir) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(format!("Could not read documents folder: {err}")),
    };
    for entry in entries {
        *visited += 1;
        if *visited > MAX_SCAN_ENTRIES {
            return Err("Too many document entries to scan safely.".to_string());
        }
        let entry = entry.map_err(|e| format!("Could not read document entry: {e}"))?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "A linked file cannot be included in documents: {}",
                path.display()
            ));
        }
        let rel_path = relative_prefix.join(&file_name);
        if metadata.is_dir() {
            scan_stored_documents_recursive(&path, &rel_path, depth + 1, visited, collected)?;
        } else if metadata.is_file() {
            let normalized = rel_path.to_string_lossy().replace('\\', "/");
            safe_relative_path(&normalized)?;
            collected.push(UnlinkedFileInfo {
                relative_path: normalized,
                file_name: name_str.to_string(),
                file_size: metadata.len(),
            });
        }
    }
    Ok(())
}

pub fn scan_stored_documents(documents_dir: &Path) -> Result<Vec<UnlinkedFileInfo>, String> {
    let mut files = Vec::new();
    if !documents_dir.exists() {
        return Ok(files);
    }
    let mut visited = 0;
    scan_stored_documents_recursive(documents_dir, Path::new(""), 0, &mut visited, &mut files)?;
    Ok(files)
}

/// Compare database file references with app-owned storage.
pub fn check_library_in(root: &Path) -> Result<LibraryReport, String> {
    let db_path = root.join("her-flight-deck.db");
    let docs_dir = root.join(DOCUMENTS_DIR);

    let active_files = scan_stored_documents(&docs_dir)?;
    let total_files = active_files.len();
    let staged_deletions = crate::backup::scan_staged_deletion_paths(&docs_dir.join(TRASH_DIR))?;

    if !db_path.is_file() {
        return Err("Database file is missing.".to_string());
    }

    let connection = Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not open database to check library: {e}"))?;

    connection
        .busy_timeout(Duration::from_millis(2000))
        .map_err(|e| format!("Could not set database timeout: {e}"))?;

    let table_exists: bool = connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_materials'",
            [],
            |_| Ok(true),
        )
        .map_err(|e| format!("Could not check database schema: {e}"))?;

    if !table_exists {
        return Err(
            "Database schema is missing or invalid: study_materials table not found.".to_string(),
        );
    }

    let total_materials: usize = connection
        .query_row("SELECT COUNT(*) FROM study_materials", [], |row| row.get(0))
        .map_err(|e| format!("Could not count study materials: {e}"))?;

    let mut stmt = connection
        .prepare(
            "SELECT id, title, file_path, original_file_name
             FROM study_materials
             WHERE file_path IS NOT NULL AND TRIM(file_path) != ''",
        )
        .map_err(|e| format!("Could not query study materials: {e}"))?;

    let mut referenced_paths = HashSet::new();
    let mut missing_materials = Vec::new();

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Could not read study materials: {e}"))?;

    for row in rows {
        let (id, title, raw_path, orig_name) =
            row.map_err(|e| format!("Could not read material row: {e}"))?;
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = trimmed.replace('\\', "/");
        match safe_relative_path(&normalized) {
            Ok(safe) => {
                referenced_paths.insert(safe.to_string());
                let exists_on_disk = docs_dir.join(safe).is_file();
                let in_staged_trash = staged_deletions.contains(safe);

                if !exists_on_disk && !in_staged_trash {
                    missing_materials.push(MissingMaterialInfo {
                        id,
                        title,
                        file_path: safe.to_string(),
                        original_file_name: orig_name,
                    });
                }
            }
            Err(_) => {
                // A path that escapes storage, is absolute, or contains invalid characters
                // cannot point to a managed file in app storage. Report it as missing so
                // the user is alerted to the broken reference and can re-attach the file.
                missing_materials.push(MissingMaterialInfo {
                    id,
                    title,
                    file_path: normalized,
                    original_file_name: orig_name,
                });
            }
        }
    }

    let mut unlinked_files = Vec::new();
    for file in active_files {
        if !referenced_paths.contains(&file.relative_path)
            && docs_dir.join(&file.relative_path).is_file()
        {
            unlinked_files.push(file);
        }
    }

    missing_materials.sort_by_key(|a| a.title.to_lowercase());
    unlinked_files.sort_by_key(|a| a.file_name.to_lowercase());

    Ok(LibraryReport {
        missing_materials,
        unlinked_files,
        total_materials,
        total_files,
    })
}

/// Check the library: compare database file references with app-owned storage.
#[tauri::command]
pub async fn check_library(app: AppHandle) -> Result<LibraryReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        check_library_in(&root)
    })
    .await
    .map_err(|e| format!("Could not complete library check: {e}"))?
}

/// Re-attach an unlinked file to an existing study material without losing its other fields.
pub fn reattach_unlinked_file_in(
    root: &Path,
    material_id: &str,
    relative_path: &str,
) -> Result<(), String> {
    if material_id.trim().is_empty() {
        return Err("Material ID cannot be empty.".to_string());
    }

    let docs_dir = root.join(DOCUMENTS_DIR);
    let (safe_rel, target_file, metadata) = active_managed_file(root, relative_path)?;
    let file_size = metadata.len() as i64;
    let file_name = Path::new(&safe_rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&safe_rel)
        .to_string();

    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err("Database file is missing.".to_string());
    }

    let mut connection = Connection::open(&db_path)
        .map_err(|e| format!("Could not open database to reattach file: {e}"))?;
    connection
        .busy_timeout(Duration::from_millis(2000))
        .map_err(|e| format!("Could not set database timeout: {e}"))?;

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Could not start file re-attachment: {e}"))?;
    let current_path: Option<Option<String>> = tx
        .query_row(
            "SELECT file_path FROM study_materials WHERE id = ?1",
            params![material_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not check study material: {e}"))?;
    let Some(current_path) = current_path else {
        return Err(format!("Study material '{material_id}' no longer exists."));
    };
    if let Some(old_path) = current_path {
        let normalized_old = old_path.replace('\\', "/");
        if let Ok(old_safe) = safe_relative_path(&normalized_old) {
            if docs_dir.join(old_safe).is_file() {
                return Err(
                    "This material already has an available file. No file was replaced."
                        .to_string(),
                );
            }
        }
    }

    // Check if another material already references this file path
    let duplicate_exists: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM study_materials WHERE REPLACE(file_path, CHAR(92), '/') = ?1 AND id != ?2",
            params![safe_rel, material_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not check existing file links: {e}"))?;
    if duplicate_exists.is_some() {
        return Err(format!(
            "File '{safe_rel}' is already attached to another study material."
        ));
    }

    refuse_reattach_unless_same_file(&tx, material_id, &target_file)?;

    tx.execute(
        "UPDATE study_materials
             SET file_path = ?1, original_file_name = ?2, file_size = ?3,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?4",
        params![safe_rel, file_name, file_size, material_id],
    )
    .map_err(|e| format!("Could not update study material: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Could not finish file re-attachment: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn reattach_unlinked_file(
    app: AppHandle,
    material_id: String,
    relative_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        reattach_unlinked_file_in(&root, &material_id, &relative_path)
    })
    .await
    .map_err(|e| format!("Could not complete re-attaching file: {e}"))?
}

/// Import an unlinked file into the library as a new study material.
pub fn import_unlinked_file_in(root: &Path, relative_path: &str) -> Result<String, String> {
    let (safe_rel, _target_file, metadata) = active_managed_file(root, relative_path)?;
    let file_size = metadata.len() as i64;
    let file_name = Path::new(&safe_rel)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&safe_rel)
        .to_string();

    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err("Database file is missing.".to_string());
    }

    let mut connection = Connection::open(&db_path)
        .map_err(|e| format!("Could not open database to import file: {e}"))?;
    connection
        .busy_timeout(Duration::from_millis(2000))
        .map_err(|e| format!("Could not set database timeout: {e}"))?;

    // Check if file is already attached
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Could not start library import: {e}"))?;
    let duplicate_exists: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM study_materials WHERE REPLACE(file_path, CHAR(92), '/') = ?1",
            params![safe_rel],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not check existing file links: {e}"))?;
    if duplicate_exists.is_some() {
        return Err(format!(
            "File '{safe_rel}' is already attached to a study material."
        ));
    }

    let stem = Path::new(&safe_rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&file_name);
    let title = if stem.trim().is_empty() {
        "Untitled Material"
    } else {
        stem
    };

    let now_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sanitized_stem = sanitize_file_name(title);
    let id = format!("imported-{now_millis}-{sanitized_stem}");

    tx.execute(
        "INSERT INTO study_materials (
                id, title, material_type, topic, review_status, priority,
                notes, file_path, original_file_name, file_size,
                created_at, updated_at
             ) VALUES (
                ?1, ?2, 'study_guide', 'general', 'needs_review', 'later',
                '', ?3, ?4, ?5,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
        params![id, title, safe_rel, file_name, file_size],
    )
    .map_err(|e| format!("Could not create study material: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Could not finish library import: {e}"))?;

    Ok(id)
}

#[tauri::command]
pub async fn import_unlinked_file(app: AppHandle, relative_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        import_unlinked_file_in(&root, &relative_path)
    })
    .await
    .map_err(|e| format!("Could not complete importing unlinked file: {e}"))?
}

/// Move an unlinked file to recoverable private trash.
pub fn trash_unlinked_file_in(root: &Path, relative_path: &str) -> Result<StagedDeletion, String> {
    let (safe_rel, target_file, _metadata) = active_managed_file(root, relative_path)?;
    let canonical_target = target_file
        .canonicalize()
        .map_err(|e| format!("Could not verify file '{safe_rel}': {e}"))?;

    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err("Database file is missing.".to_string());
    }
    let mut connection = Connection::open(&db_path)
        .map_err(|e| format!("Could not inspect database before trashing file: {e}"))?;
    connection
        .busy_timeout(Duration::from_millis(2000))
        .map_err(|e| format!("Could not set database timeout: {e}"))?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Could not start safe file move: {e}"))?;
    if document_is_referenced(&tx, &root.join(DOCUMENTS_DIR), &safe_rel, &canonical_target)? {
        return Err(format!(
            "Cannot move referenced file to trash. It is attached to a study material: {safe_rel}"
        ));
    }

    let staged = stage_delete_document_in(root, &safe_rel)?;
    if let Err(error) = tx.commit() {
        if !staged.staged_id.is_empty() {
            rollback_delete_document_in(root, &staged.staged_id)?;
        }
        return Err(format!("Could not finish safe file move: {error}"));
    }
    Ok(staged)
}

#[tauri::command]
pub async fn trash_unlinked_file(
    app: AppHandle,
    relative_path: String,
) -> Result<StagedDeletion, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        trash_unlinked_file_in(&root, &relative_path)
    })
    .await
    .map_err(|e| format!("Could not move unlinked file to trash: {e}"))?
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

fn deserialize_nullable<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for raw in tags {
        let trimmed = raw.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        result.push(trimmed.to_string());
    }
    result
}

/// A fresh random tag id from SQLite itself, in the same 8-4-4-4-12 shape the
/// frontend's `crypto.randomUUID()` ids use.
fn new_tag_id(tx: &Connection) -> Result<String, String> {
    let hex: String = tx
        .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
        .map_err(|e| format!("Could not create a tag id: {e}"))?;
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

/// Link a material to each (already normalized) tag name.
///
/// A tag is resolved by its unique name. Only a name with no row yet gets a
/// new row, under a random id and a plain INSERT, so a collision fails the
/// save instead of being ignored. Ids derived from the material and the tag's
/// position used to collide with rows a previous edit left behind; the ignored
/// insert then linked nothing while the save still reported the tag. The links
/// are read back before returning, so the caller can only acknowledge tags
/// that are actually stored.
fn link_material_tags(
    tx: &Connection,
    material_id: &str,
    tags: &[String],
    created_at: &str,
) -> Result<(), String> {
    for tag in tags {
        let existing: Option<String> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", params![tag], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| format!("Could not look up tag: {e}"))?;
        let tag_id = match existing {
            Some(id) => id,
            None => {
                let id = new_tag_id(tx)?;
                let inserted = tx
                    .execute(
                        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                        params![&id, tag, created_at],
                    )
                    .map_err(|e| format!("Could not save tag: {e}"))?;
                if inserted != 1 {
                    return Err(format!("Could not save the tag \"{tag}\"."));
                }
                id
            }
        };
        let linked = tx
            .execute(
                "INSERT INTO material_tags (material_id, tag_id) VALUES (?1, ?2)",
                params![material_id, &tag_id],
            )
            .map_err(|e| format!("Could not attach tag: {e}"))?;
        if linked != 1 {
            return Err(format!("Could not attach the tag \"{tag}\"."));
        }
    }

    let mut stmt = tx
        .prepare(
            "SELECT t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id
             WHERE mt.material_id = ?1",
        )
        .map_err(|e| format!("Could not verify material tags: {e}"))?;
    let stored = stmt
        .query_map(params![material_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Could not verify material tags: {e}"))?
        .collect::<Result<HashSet<String>, _>>()
        .map_err(|e| format!("Could not verify material tags: {e}"))?;
    let wanted: HashSet<String> = tags.iter().cloned().collect();
    if stored != wanted {
        return Err("The saved tags did not match the requested tags.".to_string());
    }
    Ok(())
}

#[allow(clippy::option_option)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialSaveFields {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub material_type: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub review_status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub goal_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub event_id: Option<Option<String>>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub file_path: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub original_file_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub file_size: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub last_reviewed_at: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FaaReferenceCopy {
    pub reference_id: String,
    pub edition: String,
    pub content_sha256: String,
    pub total_pages: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialSaveOperation {
    #[serde(default)]
    pub faa_reference: Option<FaaReferenceCopy>,
    pub mode: String,
    pub id: String,
    pub fields: MaterialSaveFields,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredStudyMaterial {
    pub id: String,
    pub title: String,
    pub material_type: String,
    pub topic: String,
    pub review_status: String,
    pub priority: String,
    pub goal_id: Option<String>,
    pub event_id: Option<String>,
    pub notes: String,
    pub file_path: Option<String>,
    pub original_file_name: Option<String>,
    pub file_size: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_reviewed_at: Option<String>,
    pub tags: Vec<String>,
}

#[tauri::command]
pub async fn save_material_operation(
    app: AppHandle,
    operation: MaterialSaveOperation,
) -> Result<StoredStudyMaterial, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        save_material_operation_at(&root, &operation)
    })
    .await
    .map_err(|error| format!("Could not finish saving study material: {error}"))?
}

pub fn save_material_operation_at(
    root: &Path,
    op: &MaterialSaveOperation,
) -> Result<StoredStudyMaterial, String> {
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

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start saving study material: {error}"))?;

    let result = match op.mode.as_str() {
        "create" => handle_create_material(&tx, root, op)?,
        "update" => handle_update_material(&tx, root, op)?,
        unknown => return Err(format!("Unknown save mode: {unknown}")),
    };

    if let Some(copy) = &op.faa_reference {
        if op.mode != "create" {
            return Err("Add another reference as a separate copy.".into());
        }
        tx.execute(
            "INSERT INTO faa_reference_copies (material_id, reference_id, edition, content_sha256, total_pages, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![op.id, copy.reference_id, copy.edition, copy.content_sha256, copy.total_pages, result.created_at],
        ).map_err(|_| "That reference could not be saved. Your PDF and edition are here to retry.")?;
    }
    tx.commit()
        .map_err(|error| format!("Could not commit study material: {error}"))?;

    Ok(result)
}

/// A newly attached or replacement file must be a real app-owned file that
/// exists now. This runs inside the save's immediate (writer) transaction, the
/// same lock file cleanup holds while it checks references and moves a file:
/// if cleanup won the lock first, the file is already gone and the save is
/// refused instead of committing a reference to it. Only existence, spelling
/// and containment are checked; ordinary imports have no size or page limit.
fn verify_new_attachment(root: &Path, relative_path: &str) -> Result<(), String> {
    if relative_path.contains('\\') || is_hidden_or_ambiguous(relative_path) {
        return Err("The attached file has an invalid stored name.".to_string());
    }
    active_managed_file(root, relative_path)
        .map(|_| ())
        .map_err(|e| {
            format!("The attached file is no longer available, so nothing was saved. ({e})")
        })
}

fn handle_create_material(
    tx: &rusqlite::Transaction,
    root: &Path,
    op: &MaterialSaveOperation,
) -> Result<StoredStudyMaterial, String> {
    let exists: bool = tx
        .query_row(
            "SELECT 1 FROM study_materials WHERE id = ?1",
            params![&op.id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|e| format!("Could not check material collision: {e}"))?
        .is_some();
    if exists {
        return Err(format!(
            "A study material with id \"{}\" already exists.",
            op.id
        ));
    }

    let title = op.fields.title.as_deref().unwrap_or("").trim().to_string();
    if title.is_empty() {
        return Err("Title is required.".to_string());
    }

    let material_type = op
        .fields
        .material_type
        .as_deref()
        .unwrap_or("study_guide")
        .to_string();
    let topic = op.fields.topic.as_deref().unwrap_or("general").to_string();
    let review_status = op
        .fields
        .review_status
        .as_deref()
        .unwrap_or("needs_review")
        .to_string();
    let priority = op.fields.priority.as_deref().unwrap_or("later").to_string();
    let goal_id = op.fields.goal_id.as_ref().and_then(|o| o.clone());
    let event_id = op.fields.event_id.as_ref().and_then(|o| o.clone());
    let notes = op.fields.notes.as_deref().unwrap_or("").to_string();
    let file_path = op.fields.file_path.as_ref().and_then(|o| o.clone());
    let original_file_name = op
        .fields
        .original_file_name
        .as_ref()
        .and_then(|o| o.clone());
    let file_size = op.fields.file_size.as_ref().and_then(|o| *o);
    let last_reviewed_at = op.fields.last_reviewed_at.as_ref().and_then(|o| o.clone());
    if let Some(path) = &file_path {
        verify_new_attachment(root, path)?;
    }

    let now: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .map_err(|e| format!("Could not get current timestamp: {e}"))?;
    let created_at = op.created_at.clone().unwrap_or_else(|| now.clone());
    let updated_at = op.updated_at.clone().unwrap_or(now);

    tx.execute(
        "INSERT INTO study_materials (
           id, title, material_type, topic, review_status, priority,
           goal_id, event_id, notes, file_path, original_file_name, file_size,
           created_at, updated_at, last_reviewed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            &op.id,
            &title,
            &material_type,
            &topic,
            &review_status,
            &priority,
            &goal_id,
            &event_id,
            &notes,
            &file_path,
            &original_file_name,
            &file_size,
            &created_at,
            &updated_at,
            &last_reviewed_at,
        ],
    )
    .map_err(|e| format!("Could not save study material: {e}"))?;

    let tags = normalize_tags(op.tags.as_deref().unwrap_or(&[]));
    link_material_tags(tx, &op.id, &tags, &created_at)?;

    Ok(StoredStudyMaterial {
        id: op.id.clone(),
        title,
        material_type,
        topic,
        review_status,
        priority,
        goal_id,
        event_id,
        notes,
        file_path,
        original_file_name,
        file_size,
        created_at,
        updated_at,
        last_reviewed_at,
        tags,
    })
}

pub(crate) const FAA_FILE_LOCKED: &str = "This file is a saved FAA reference copy, so it can't be replaced or removed. Add the new file as its own material instead.";
pub(crate) const PICTURE_FILE_LOCKED: &str = "Picture cards use this picture, so it can't be replaced or removed. Add the new picture as its own material instead.";

/// An FAA reference copy and picture-card regions record the exact bytes of
/// their material's file. Swapping or removing that file would leave records
/// that no longer match, so the file stays fixed while they exist.
fn refuse_locked_file_change(conn: &Connection, material_id: &str) -> Result<(), String> {
    let used = |table: &str, column: &str| -> Result<bool, String> {
        let present: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| format!("Could not check how this file is used: {e}"))?;
        if !present {
            return Ok(false);
        }
        conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {column}=?1)"),
            [material_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Could not check how this file is used: {e}"))
    };
    if used("faa_reference_copies", "material_id")? {
        return Err(FAA_FILE_LOCKED.to_string());
    }
    if used("visual_card_regions", "image_material_id")? {
        return Err(PICTURE_FILE_LOCKED.to_string());
    }
    Ok(())
}

/// Re-attaching a moved file to a material behind an FAA copy or picture cards
/// is a repair only when the file is the very one they recorded.
fn refuse_reattach_unless_same_file(
    conn: &Connection,
    material_id: &str,
    file: &Path,
) -> Result<(), String> {
    let check = |e: String| format!("Could not check how this file is used: {e}");
    let has = |table: &str| -> Result<bool, String> {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |r| r.get(0),
        )
        .map_err(|e| check(e.to_string()))
    };
    let read = || -> Result<Vec<u8>, String> {
        std::fs::read(file).map_err(|e| format!("Could not read that file: {e}"))
    };
    if has("faa_reference_copies")? {
        let expected: Option<String> = conn
            .query_row(
                "SELECT content_sha256 FROM faa_reference_copies WHERE material_id=?1",
                [material_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| check(e.to_string()))?;
        if let Some(expected) = expected {
            use sha2::{Digest, Sha256};
            if format!("{:x}", Sha256::digest(read()?)) != expected {
                return Err(FAA_FILE_LOCKED.to_string());
            }
        }
    }
    if has("visual_card_regions")? {
        let mut stmt = conn
            .prepare("SELECT id FROM visual_card_regions WHERE image_material_id=?1")
            .map_err(|e| check(e.to_string()))?;
        let ids = stmt
            .query_map([material_id], |r| r.get::<_, String>(0))
            .map_err(|e| check(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| check(e.to_string()))?;
        if !ids.is_empty() {
            let bytes = read()?;
            for id in ids {
                let region = crate::visual_cards::read_region(conn, &id)?;
                if crate::visual_cards::verify_bytes(&region, &bytes).is_err() {
                    return Err(PICTURE_FILE_LOCKED.to_string());
                }
            }
        }
    }
    Ok(())
}

fn handle_update_material(
    tx: &rusqlite::Transaction,
    root: &Path,
    op: &MaterialSaveOperation,
) -> Result<StoredStudyMaterial, String> {
    let mut stmt = tx
        .prepare(
            "SELECT title, material_type, topic, review_status, priority, goal_id, event_id,
                    notes, file_path, original_file_name, file_size, created_at, updated_at,
                    last_reviewed_at
             FROM study_materials WHERE id = ?1",
        )
        .map_err(|e| format!("Could not prepare material select: {e}"))?;

    let existing = stmt
        .query_row(params![&op.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<i64>>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, Option<String>>(13)?,
            ))
        })
        .optional()
        .map_err(|e| format!("Could not query existing material: {e}"))?;

    let (
        cur_title,
        cur_material_type,
        cur_topic,
        cur_review_status,
        cur_priority,
        cur_goal_id,
        cur_event_id,
        cur_notes,
        cur_file_path,
        cur_original_file_name,
        cur_file_size,
        cur_created_at,
        _cur_updated_at,
        cur_last_reviewed_at,
    ) = match existing {
        Some(t) => t,
        None => return Err("That study material no longer exists.".to_string()),
    };

    drop(stmt);

    let title = match &op.fields.title {
        Some(t) => {
            let trimmed = t.trim();
            if trimmed.is_empty() {
                return Err("Title is required.".to_string());
            }
            trimmed.to_string()
        }
        None => cur_title,
    };

    let material_type = op.fields.material_type.clone().unwrap_or(cur_material_type);
    let topic = op.fields.topic.clone().unwrap_or(cur_topic);
    let review_status = op.fields.review_status.clone().unwrap_or(cur_review_status);
    let priority = op.fields.priority.clone().unwrap_or(cur_priority);

    let goal_id = match &op.fields.goal_id {
        Some(val) => val.clone(),
        None => cur_goal_id,
    };
    let event_id = match &op.fields.event_id {
        Some(val) => val.clone(),
        None => cur_event_id,
    };
    let notes = op.fields.notes.clone().unwrap_or(cur_notes);
    if let Some(next) = &op.fields.file_path {
        if next.as_deref() != cur_file_path.as_deref() {
            refuse_locked_file_change(tx, &op.id)?;
        }
    }
    // Only a different file is new. Re-sending the recorded path (a metadata
    // edit of a material whose file has gone missing) stays allowed.
    if let Some(Some(path)) = &op.fields.file_path {
        if cur_file_path.as_deref() != Some(path.as_str()) {
            verify_new_attachment(root, path)?;
        }
    }
    let file_path = match &op.fields.file_path {
        Some(val) => val.clone(),
        None => cur_file_path,
    };
    let original_file_name = match &op.fields.original_file_name {
        Some(val) => val.clone(),
        None => cur_original_file_name,
    };
    let file_size = match &op.fields.file_size {
        Some(val) => *val,
        None => cur_file_size,
    };
    let last_reviewed_at = match &op.fields.last_reviewed_at {
        Some(val) => val.clone(),
        None => cur_last_reviewed_at,
    };

    let now: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .map_err(|e| format!("Could not get current timestamp: {e}"))?;
    let updated_at = op.updated_at.clone().unwrap_or(now);
    let created_at = cur_created_at; // ALWAYS preserve created_at!

    tx.execute(
        "UPDATE study_materials SET
           title = ?1, material_type = ?2, topic = ?3, review_status = ?4, priority = ?5,
           goal_id = ?6, event_id = ?7, notes = ?8, file_path = ?9, original_file_name = ?10,
           file_size = ?11, updated_at = ?12, last_reviewed_at = ?13
         WHERE id = ?14",
        params![
            &title,
            &material_type,
            &topic,
            &review_status,
            &priority,
            &goal_id,
            &event_id,
            &notes,
            &file_path,
            &original_file_name,
            &file_size,
            &updated_at,
            &last_reviewed_at,
            &op.id,
        ],
    )
    .map_err(|e| format!("Could not update study material: {e}"))?;

    let final_tags = if let Some(new_tags) = &op.tags {
        tx.execute(
            "DELETE FROM material_tags WHERE material_id = ?1",
            params![&op.id],
        )
        .map_err(|e| format!("Could not clear material tags: {e}"))?;

        let tags = normalize_tags(new_tags);
        link_material_tags(tx, &op.id, &tags, &updated_at)?;
        tags
    } else {
        let mut tag_stmt = tx
            .prepare(
                "SELECT t.name
                 FROM material_tags mt
                 JOIN tags t ON t.id = mt.tag_id
                 WHERE mt.material_id = ?1
                 ORDER BY t.name",
            )
            .map_err(|e| format!("Could not query material tags: {e}"))?;
        let tags_iter = tag_stmt
            .query_map(params![&op.id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Could not map material tags: {e}"))?;
        let mut tags = Vec::new();
        for t in tags_iter {
            tags.push(t.map_err(|e| format!("Could not read tag: {e}"))?);
        }
        tags
    };

    Ok(StoredStudyMaterial {
        id: op.id.clone(),
        title,
        material_type,
        topic,
        review_status,
        priority,
        goal_id,
        event_id,
        notes,
        file_path,
        original_file_name,
        file_size,
        created_at,
        updated_at,
        last_reviewed_at,
        tags: final_tags,
    })
}

#[cfg(test)]
#[path = "documents_save_tests.rs"]
mod save_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn split_test_root() -> PathBuf {
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "hfd-split-{}-{}-{}",
            std::process::id(),
            sequence,
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

    /// Settings' and Data Recovery's "Open folder" button opens the whole data
    /// directory through the native `open_data_folder` command, which resolves
    /// the folder itself. The webview therefore needs no `opener:allow-open-path`
    /// scope for `$APPCONFIG` itself, and must not keep one: the only path it may
    /// still open is a document under `documents/`.
    #[test]
    fn the_data_folder_is_opened_natively_not_through_a_webview_path_scope() {
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
        assert_eq!(
            allowed_paths,
            vec!["$APPCONFIG/documents/**"],
            "the webview may open documents only; the data folder is opened by `open_data_folder`"
        );

        let lib = include_str!("lib.rs");
        assert!(
            lib.contains("backup::open_data_folder,"),
            "open_data_folder must be registered as a command"
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

    #[test]
    fn rollback_refuses_overwrite_and_preserves_staged_copy_when_destination_already_exists() {
        let root = scratch_doc_root("rollback-dest-exists");
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&docs).unwrap();

        let doc_path = docs.join("conflict.pdf");
        std::fs::write(&doc_path, b"original document content").unwrap();

        let staged = stage_delete_document_in(&root, "conflict.pdf").unwrap();
        assert!(!doc_path.exists());

        // A new file is placed at the destination path before rollback occurs
        std::fs::write(&doc_path, b"newly created document content").unwrap();

        // Rollback must refuse to overwrite the destination and report the conflict
        let result = rollback_delete_document_in(&root, &staged.staged_id);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("already exists"),
            "Error must report destination conflict, got: {err}"
        );

        // Target file must be untouched
        assert_eq!(
            std::fs::read(&doc_path).unwrap(),
            b"newly created document content"
        );

        // Staged copy in trash must still be preserved and recoverable
        let trash = docs.join(TRASH_DIR);
        assert!(trash.join(format!("{}.data", staged.staged_id)).is_file());
        assert!(trash.join(format!("{}.meta", staged.staged_id)).is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_leaves_staged_copy_untouched_when_destination_already_exists() {
        let root = scratch_doc_root("cleanup-dest-exists");
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&docs).unwrap();

        // Create database referencing conflict.pdf
        let db_path = root.join("her-flight-deck.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'conflict.pdf')",
                [],
            )
            .unwrap();
        }

        let doc_path = docs.join("conflict.pdf");
        std::fs::write(&doc_path, b"original document content").unwrap();

        let staged = stage_delete_document_in(&root, "conflict.pdf").unwrap();
        assert!(!doc_path.exists());

        // Place a new file at destination path
        std::fs::write(&doc_path, b"concurrent file at destination").unwrap();

        // Cleanup across launches must detect conflict, refuse to overwrite, and preserve staged copy
        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 0);

        // Destination must retain the concurrent file
        assert_eq!(
            std::fs::read(&doc_path).unwrap(),
            b"concurrent file at destination"
        );

        // Staged files in trash must remain intact
        let trash = docs.join(TRASH_DIR);
        assert!(trash.join(format!("{}.data", staged.staged_id)).is_file());
        assert!(trash.join(format!("{}.meta", staged.staged_id)).is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_leaves_trash_untouched_when_schema_is_missing_or_invalid() {
        let root = scratch_doc_root("cleanup-invalid-schema");
        let docs = root.join(DOCUMENTS_DIR);
        let trash = docs.join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();

        // Stage a deletion in trash
        let staged_data = trash.join("pending-1.data");
        let staged_meta = trash.join("pending-1.meta");
        std::fs::write(&staged_data, b"important study notes").unwrap();
        let meta = StagedDeletion {
            staged_id: "pending-1".to_string(),
            original_relative_path: "important.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(&staged_meta, serde_json::to_string(&meta).unwrap()).unwrap();

        // Case 1: Database exists, but study_materials table is missing completely
        let db_path = root.join("her-flight-deck.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute("CREATE TABLE other_table (id TEXT PRIMARY KEY)", [])
                .unwrap();
        }

        let cleaned = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned, 0);
        // Staged files MUST NOT be purged as orphans!
        assert!(
            staged_data.is_file(),
            "data must not be purged on missing table"
        );
        assert!(
            staged_meta.is_file(),
            "meta must not be purged on missing table"
        );

        // Case 2: Table exists, but file_path column is missing
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute("DROP TABLE other_table", []).unwrap();
            conn.execute(
                "CREATE TABLE study_materials (id TEXT PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        }

        let cleaned2 = cleanup_staged_deletions_in(&root).unwrap();
        assert_eq!(cleaned2, 0);
        // Staged files MUST still NOT be purged!
        assert!(
            staged_data.is_file(),
            "data must not be purged on missing column"
        );
        assert!(
            staged_meta.is_file(),
            "meta must not be purged on missing column"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rename_no_replace_refuses_to_overwrite_existing_destination() {
        // Platform-specific test limitation:
        // When executed on Windows or Linux, this test verifies the respective OS no-replace
        // implementation (MoveFileExW without MOVEFILE_REPLACE_EXISTING on Windows; renameat2
        // on Linux). Verification of Darwin's kernel-level `renamex_np(..., RENAME_EXCL)`
        // requires executing on a macOS environment.
        let root = scratch_doc_root("rename-no-replace-test");
        let source = root.join("source.txt");
        let dest = root.join("dest.txt");

        std::fs::write(
            &source,
            b"source content that must not overwrite destination",
        )
        .unwrap();
        std::fs::write(&dest, b"pre-existing destination content").unwrap();

        let result = rename_no_replace(&source, &dest);
        assert!(
            result.is_err(),
            "rename_no_replace must fail when destination exists"
        );
        let err = result.unwrap_err();
        assert!(
            is_already_exists_error(&err) || dest.exists(),
            "Error must indicate destination collision, got: {err:?}"
        );

        // Crucial safety invariant: destination content MUST NOT be overwritten
        assert_eq!(
            std::fs::read(&dest).unwrap(),
            b"pre-existing destination content",
            "Destination content must be preserved untouched"
        );

        // Source file MUST NOT be deleted or lost
        assert_eq!(
            std::fs::read(&source).unwrap(),
            b"source content that must not overwrite destination",
            "Source content must be preserved untouched"
        );

        // When destination does not exist, rename_no_replace succeeds
        let non_existing = root.join("new_file.txt");
        assert!(rename_no_replace(&source, &non_existing).is_ok());
        assert_eq!(
            std::fs::read(&non_existing).unwrap(),
            b"source content that must not overwrite destination"
        );
        assert!(!source.exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_refuses_when_metadata_missing_and_does_not_delete_data() {
        let root = split_test_root();
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();

        let staged_id = "test-staged-orphan";
        let data_file = trash.join(format!("{staged_id}.data"));
        std::fs::write(&data_file, b"valuable data").unwrap();

        let res = rollback_delete_document_in(&root, staged_id);
        assert!(res.is_err(), "rollback must fail if .meta file is missing");
        assert!(
            data_file.exists(),
            "rollback must never delete .data file if .meta is missing"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn check_library_reports_healthy_when_all_files_match() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::write(docs.join("doc1.pdf"), b"content 1").unwrap();
        std::fs::write(docs.join("doc2.pdf"), b"content 2").unwrap();

        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('1', 'Doc 1', 'doc1.pdf', 'doc1.pdf', 9)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('2', 'Doc 2', 'doc2.pdf', 'doc2.pdf', 9)",
            [],
        ).unwrap();

        let report = check_library_in(&root).expect("check_library_in should succeed");
        assert_eq!(report.total_materials, 2);
        assert_eq!(report.total_files, 2);
        assert!(report.missing_materials.is_empty());
        assert!(report.unlinked_files.is_empty());

        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn check_library_detects_missing_and_unlinked_files() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        // doc2 exists on disk but is NOT in DB -> unlinked
        std::fs::write(docs.join("doc2.pdf"), b"unlinked content").unwrap();

        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        // doc1 is in DB but does NOT exist on disk -> missing
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('1', 'Missing Doc', 'doc1.pdf', 'doc1.pdf', 100)",
            [],
        ).unwrap();

        let report = check_library_in(&root).expect("check_library_in should succeed");
        assert_eq!(report.total_materials, 1);
        assert_eq!(report.total_files, 1);
        assert_eq!(report.missing_materials.len(), 1);
        assert_eq!(report.missing_materials[0].id, "1");
        assert_eq!(report.missing_materials[0].title, "Missing Doc");
        assert_eq!(report.missing_materials[0].file_path, "doc1.pdf");

        assert_eq!(report.unlinked_files.len(), 1);
        assert_eq!(report.unlinked_files[0].relative_path, "doc2.pdf");
        assert_eq!(report.unlinked_files[0].file_name, "doc2.pdf");

        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn check_library_ignores_in_flight_staged_deletion() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        let trash = docs.join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();

        // Staged deletion in .trash for doc1.pdf
        let staged_id = "12345-doc1";
        std::fs::write(trash.join(format!("{staged_id}.data")), b"data").unwrap();
        let meta = StagedDeletion {
            staged_id: staged_id.to_string(),
            original_relative_path: "doc1.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(
            trash.join(format!("{staged_id}.meta")),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();

        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('1', 'In-Flight Doc', 'doc1.pdf', 'doc1.pdf', 100)",
            [],
        ).unwrap();

        let report = check_library_in(&root).expect("check_library_in should succeed");
        // Because doc1.pdf is currently staged for deletion in .trash, it is not reported as missing
        assert!(report.missing_materials.is_empty());
        assert!(report.unlinked_files.is_empty());

        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn check_library_reports_adversarial_and_invalid_paths_as_missing() {
        let root = split_test_root();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('1', 'Traversal', '../../etc/passwd', 'passwd', 100)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('2', 'Drive Name', 'C:/Windows/win.ini', 'win.ini', 100)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size) VALUES ('3', 'Stream', 'doc.pdf:hidden', 'doc.pdf', 100)",
            [],
        ).unwrap();

        let report = check_library_in(&root).expect("check_library_in should succeed");
        assert_eq!(report.total_materials, 3);
        assert_eq!(report.missing_materials.len(), 3);
        assert!(report
            .missing_materials
            .iter()
            .any(|m| m.id == "1" && m.file_path == "../../etc/passwd"));
        assert!(report
            .missing_materials
            .iter()
            .any(|m| m.id == "2" && m.file_path == "C:/Windows/win.ini"));
        assert!(report
            .missing_materials
            .iter()
            .any(|m| m.id == "3" && m.file_path == "doc.pdf:hidden"));
        assert!(report.unlinked_files.is_empty());

        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn check_library_does_not_report_deleted_file_as_unlinked() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        let ghost_file = docs.join("ghost.pdf");
        std::fs::write(&ghost_file, b"soon deleted").unwrap();

        let _conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        // Database has no records.

        // Delete ghost_file right before or during check to simulate concurrent deletion
        std::fs::remove_file(&ghost_file).unwrap();

        let report = check_library_in(&root).expect("check_library_in should succeed");
        assert!(
            report.unlinked_files.is_empty(),
            "Deleted file must not be reported as unlinked"
        );

        drop(_conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn library_check_fails_closed_when_database_or_trash_is_unreadable() {
        let root = split_test_root();
        std::fs::write(root.join(DOCUMENTS_DIR).join("unlinked.pdf"), b"keep me").unwrap();
        std::fs::remove_file(root.join("her-flight-deck.db")).unwrap();
        assert!(check_library_in(&root).is_err());
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.execute("CREATE TABLE study_materials (id TEXT)", [])
            .unwrap();
        assert!(check_library_in(&root).is_err());
        conn.execute("DROP TABLE study_materials", []).unwrap();
        conn.execute("CREATE TABLE study_materials (id TEXT, title TEXT, file_path TEXT, original_file_name TEXT)", []).unwrap();
        drop(conn);
        let trash = root.join(DOCUMENTS_DIR).join(TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("broken.meta"), b"not json").unwrap();
        assert!(check_library_in(&root).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn library_repair_actions_preserve_data_and_recheck_stale_state() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::write(docs.join("replacement.pdf"), b"replacement").unwrap();
        std::fs::write(docs.join("orphan.pdf"), b"orphan").unwrap();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.execute("INSERT INTO study_materials (id, title, notes, file_path) VALUES ('m1', 'Weather', 'important notes', 'missing.pdf')", []).unwrap();
        drop(conn);

        reattach_unlinked_file_in(&root, "m1", "replacement.pdf").unwrap();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        let preserved: (String, String, String) = conn
            .query_row(
                "SELECT title, notes, file_path FROM study_materials WHERE id = 'm1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            preserved,
            (
                "Weather".into(),
                "important notes".into(),
                "replacement.pdf".into()
            )
        );
        assert!(reattach_unlinked_file_in(&root, "m1", "orphan.pdf").is_err());
        assert!(trash_unlinked_file_in(&root, "replacement.pdf").is_err());

        let imported_id = import_unlinked_file_in(&root, "orphan.pdf").unwrap();
        assert!(import_unlinked_file_in(&root, "orphan.pdf").is_err());
        let defaults: (String, String, String) = conn
            .query_row(
                "SELECT material_type, review_status, priority FROM study_materials WHERE id = ?1",
                [&imported_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            defaults,
            ("study_guide".into(), "needs_review".into(), "later".into())
        );
        assert!(trash_unlinked_file_in(&root, "orphan.pdf").is_err());
        drop(conn);
        let report = check_library_in(&root).unwrap();
        assert!(report.missing_materials.is_empty());
        assert!(report.unlinked_files.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn trash_unlinked_file_can_be_undone_and_rejects_hidden_paths() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::write(docs.join("orphan.pdf"), b"recoverable").unwrap();
        let staged = trash_unlinked_file_in(&root, "orphan.pdf").unwrap();
        assert!(!docs.join("orphan.pdf").exists());
        assert!(docs
            .join(TRASH_DIR)
            .join(format!("{}.data", staged.staged_id))
            .exists());
        rollback_delete_document_in(&root, &staged.staged_id).unwrap();
        assert_eq!(
            std::fs::read(docs.join("orphan.pdf")).unwrap(),
            b"recoverable"
        );
        assert!(trash_unlinked_file_in(&root, ".trash/forged.data").is_err());
        assert!(import_unlinked_file_in(&root, "../outside.pdf").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn repair_actions_respect_legacy_windows_path_separators() {
        let root = split_test_root();
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(docs.join("folder")).unwrap();
        std::fs::write(docs.join("folder").join("legacy.pdf"), b"keep linked").unwrap();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path) VALUES ('linked', 'Existing', ?1)",
            ["folder\\legacy.pdf"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path) VALUES ('missing', 'Missing', 'gone.pdf')",
            [],
        )
        .unwrap();
        drop(conn);

        let report = check_library_in(&root).unwrap();
        assert_eq!(report.missing_materials.len(), 1);
        assert!(report.unlinked_files.is_empty());
        assert!(reattach_unlinked_file_in(&root, "missing", "folder/legacy.pdf").is_err());
        assert!(import_unlinked_file_in(&root, "folder/legacy.pdf").is_err());
        assert!(trash_unlinked_file_in(&root, "folder/legacy.pdf").is_err());
        assert_eq!(
            std::fs::read(docs.join("folder").join("legacy.pdf")).unwrap(),
            b"keep linked"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
