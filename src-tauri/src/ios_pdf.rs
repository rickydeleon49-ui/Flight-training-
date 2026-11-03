//! Round-one native proof; product routing and bookmark identity stay separate.
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(try_from = "u32")]
pub struct PhysicalPage(u32);

impl TryFrom<u32> for PhysicalPage {
    type Error = &'static str;
    fn try_from(page: u32) -> Result<Self, Self::Error> {
        if page == 0 {
            Err("Choose a physical page starting at 1.")
        } else {
            Ok(Self(page))
        }
    }
}

#[tauri::command]
pub async fn open_ios_pdf(
    app: tauri::AppHandle,
    material_id: String,
    physical_page: Option<PhysicalPage>,
) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, material_id, physical_page.map(|p| p.0));
        Err("Only on iPhone/iPad".into())
    }
    #[cfg(target_os = "ios")]
    {
        use tauri::Manager;
        let root =
            crate::storage::app_root(&app).map_err(|_| "Your study files could not be opened.")?;
        let (title, snapshot) = tauri::async_runtime::spawn_blocking(move || {
            let connection = crate::lineage::open_library(&root)
                .map_err(|_| "Your library could not be opened.")?;
            prepare(
                &connection,
                &root.join(crate::documents::DOCUMENTS_DIR),
                &material_id,
            )
        })
        .await
        .map_err(|_| "That PDF could not be opened.")??;
        let path = snapshot
            .path
            .to_str()
            .ok_or("That PDF could not be opened.")?;
        // Snapshot remains owned here until the native controller finishes or fails.
        app.state::<tauri_plugin_hfd_pdf::PdfViewer<tauri::Wry>>()
            .open(tauri_plugin_hfd_pdf::OpenPdf {
                path,
                title: &title,
                physical_page: physical_page.map_or(1, |p| p.0),
            })
            .await
    }
}

#[cfg(any(target_os = "ios", all(test, unix)))]
struct Snapshot {
    path: std::path::PathBuf,
}

#[cfg(any(target_os = "ios", all(test, unix)))]
impl Drop for Snapshot {
    fn drop(&mut self) {
        // Remove only this invocation's private directory, never a source document.
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

#[cfg(any(target_os = "ios", all(test, unix)))]
fn prepare(
    connection: &rusqlite::Connection,
    documents: &std::path::Path,
    material_id: &str,
) -> Result<(String, Snapshot), String> {
    use rusqlite::OptionalExtension;
    use std::io::Write;
    use std::os::unix::fs::DirBuilderExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let material: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT title, file_path FROM study_materials WHERE id = ?1",
            [material_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Your study material could not be read.")?;
    let (title, relative) = material.ok_or("That study material is missing.")?;
    let relative = relative
        .filter(|p| !p.is_empty())
        .ok_or("That study material has no PDF.")?;
    let bytes = crate::documents::read_document_bytes(documents, &relative)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "That PDF could not be prepared.")?
        .as_nanos();
    let dir = snapshot_root()?.join(format!(
        "hfd-pdf-{}-{nonce}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&dir)
        .map_err(|_| "That PDF could not be prepared.")?;
    let snapshot = Snapshot {
        path: dir.join("document.pdf"),
    };
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&snapshot.path)
        .map_err(|_| "That PDF could not be prepared.")?;
    file.write_all(&bytes)
        .map_err(|_| "That PDF could not be prepared.")?;
    Ok((title, snapshot))
}

// iOS has one application process. On its first open, remove only this viewer's
// sandbox-local temporary area left by a terminated previous process.
#[cfg(any(target_os = "ios", all(test, unix)))]
fn snapshot_root() -> Result<&'static std::path::PathBuf, String> {
    static ROOT: std::sync::OnceLock<Result<std::path::PathBuf, String>> =
        std::sync::OnceLock::new();
    ROOT.get_or_init(|| {
        #[cfg(not(test))]
        let name = "hfd-pdf-viewer".to_string();
        #[cfg(test)]
        let name = format!("hfd-pdf-viewer-tests-{}", std::process::id());
        let root = std::env::temp_dir().join(name);
        recover_snapshot_root(&root)?;
        Ok(root)
    })
    .as_ref()
    .map_err(Clone::clone)
}

#[cfg(any(target_os = "ios", all(test, unix)))]
fn recover_snapshot_root(root: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    match std::fs::remove_dir_all(root) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("The temporary PDF viewer files could not be cleared.".into()),
    }
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(root)
        .map_err(|_| "That PDF could not be prepared.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_page_accepts_only_positive_u32_integers() {
        for invalid in ["0", "-1", "1.5", "4294967296", "\"2\"", "null"] {
            assert!(
                serde_json::from_str::<PhysicalPage>(invalid).is_err(),
                "{invalid}"
            );
        }
        for valid in ["1", "3", "4294967295"] {
            assert_eq!(
                serde_json::from_str::<PhysicalPage>(valid)
                    .unwrap()
                    .0
                    .to_string(),
                valid
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn material_lookup_shared_guards_and_snapshot_lifetime() {
        let root = std::env::temp_dir().join(format!(
            "hfd-native-proof-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let recovery = root.join("viewer-temp");
        std::fs::create_dir(&recovery).unwrap();
        std::fs::write(recovery.join("abandoned.pdf"), b"synthetic leftover").unwrap();
        std::fs::write(root.join("keep.pdf"), b"synthetic unrelated").unwrap();
        std::os::unix::fs::symlink(root.join("keep.pdf"), recovery.join("linked.pdf")).unwrap();
        recover_snapshot_root(&recovery).unwrap();
        assert!(!recovery.join("abandoned.pdf").exists());
        assert!(root.join("keep.pdf").exists());
        let documents = root.join("documents");
        std::fs::create_dir(&documents).unwrap();
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE study_materials (id TEXT, title TEXT, file_path TEXT);
            INSERT INTO study_materials VALUES ('m', 'Synthetic', 'source.pdf'), ('empty', '', NULL);").unwrap();
        assert!(prepare(&db, &documents, "missing")
            .err()
            .unwrap()
            .contains("missing"));
        assert!(prepare(&db, &documents, "' OR 1=1 --").is_err());
        assert!(prepare(&db, &documents, "empty")
            .err()
            .unwrap()
            .contains("no PDF"));
        assert!(prepare(&db, &documents, "m").is_err());
        std::fs::create_dir(documents.join("source.pdf")).unwrap();
        assert!(prepare(&db, &documents, "m")
            .err()
            .unwrap()
            .contains("regular file"));
        std::fs::remove_dir(documents.join("source.pdf")).unwrap();
        std::fs::write(root.join("outside.pdf"), b"outside").unwrap();
        for path in ["../outside.pdf", "/outside.pdf", "C:\\outside.pdf"] {
            db.execute(
                "UPDATE study_materials SET file_path=?1 WHERE id='m'",
                [path],
            )
            .unwrap();
            let error = prepare(&db, &documents, "m").err().unwrap();
            assert!(!error.contains(root.to_str().unwrap()));
            assert!(error.contains("Invalid document path"));
        }
        std::os::unix::fs::symlink(root.join("outside.pdf"), documents.join("source.pdf")).unwrap();
        db.execute(
            "UPDATE study_materials SET file_path='source.pdf' WHERE id='m'",
            [],
        )
        .unwrap();
        assert!(prepare(&db, &documents, "m").is_err());
        std::fs::remove_file(documents.join("source.pdf")).unwrap();
        let file = std::fs::File::create(documents.join("source.pdf")).unwrap();
        file.set_len(100 * 1024 * 1024 + 1).unwrap();
        assert!(prepare(&db, &documents, "m")
            .err()
            .unwrap()
            .contains("100 MB"));
        drop(file);
        std::fs::write(documents.join("source.pdf"), b"checked synthetic bytes").unwrap();
        let (title, snapshot) = prepare(&db, &documents, "m").unwrap();
        assert_eq!(title, "Synthetic");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(snapshot.path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        std::fs::write(documents.join("source.pdf"), b"replacement").unwrap();
        assert_eq!(
            std::fs::read(&snapshot.path).unwrap(),
            b"checked synthetic bytes"
        );
        let snapshot_dir = snapshot.path.parent().unwrap().to_owned();
        drop(snapshot);
        assert!(!snapshot_dir.exists());
        assert_eq!(
            std::fs::read(documents.join("source.pdf")).unwrap(),
            b"replacement"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
