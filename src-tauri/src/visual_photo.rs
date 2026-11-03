//! iPhone: save a photo or screenshot as a picture-card image material.
//! The webview converts the photo to PNG first; this side only accepts bytes
//! that pass the same PNG limits as every other picture card.
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPhoto {
    pub material_id: String,
    pub image_sha256: String,
    pub image_width: i64,
    pub image_height: i64,
}

fn err(_: impl std::fmt::Display) -> String {
    "Couldn't save this picture. Please try again.".into()
}

#[tauri::command]
pub async fn save_photo_picture(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<SavedPhoto, String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err(err("body"));
    };
    let png = png.clone();
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = Connection::open(root.join("her-flight-deck.db")).map_err(err)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(err)?;
        save_on(&mut conn, &root, &png)
    })
    .await
    .map_err(err)?
}

pub(crate) fn save_on(
    conn: &mut Connection,
    root: &Path,
    png: &[u8],
) -> Result<SavedPhoto, String> {
    let (w, h) = crate::visual_cards::inspect_png(png)
        .map_err(|_| "This picture is too large or couldn't be read. Try another photo.")?;
    let documents = root.join("documents").canonicalize().map_err(err)?;
    if !documents.starts_with(root.canonicalize().map_err(err)?) {
        return Err(err("path"));
    }
    let id = crate::practice_sessions::generate_uuid_v4(conn).map_err(err)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let title: String = tx
        .query_row(
            "SELECT 'Phone picture ' || strftime('%Y-%m-%d %H:%M','now','localtime')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let (destination, stored) =
        crate::documents::stored_destination_in(&documents, &id, "photo.png")?;
    let save = (|| {
        std::fs::write(&destination, png).map_err(err)?;
        tx.execute("INSERT INTO study_materials(id,title,file_path,original_file_name,file_size,created_at,updated_at) VALUES (?1,?2,?3,'photo.png',?4,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![id, title, stored, png.len() as i64]).map_err(err)?;
        tx.commit().map_err(err)
    })();
    if let Err(e) = save {
        let _ = std::fs::remove_file(destination);
        return Err(e);
    }
    Ok(SavedPhoto {
        material_id: id,
        image_sha256: format!("{:x}", Sha256::digest(png)),
        image_width: w,
        image_height: h,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = crate::visual_cards::tests::PNG;

    fn root() -> std::path::PathBuf {
        let conn = Connection::open_in_memory().unwrap();
        let id = crate::practice_sessions::generate_uuid_v4(&conn).unwrap();
        std::env::temp_dir().join(format!("hfd-photo-test-{id}"))
    }

    #[test]
    fn saves_a_checked_png_as_a_new_image_material() {
        let root = root();
        let mut conn = crate::visual_cards::tests::library(&root);
        let saved = save_on(&mut conn, &root, PNG).unwrap();
        let (w, h) = crate::visual_cards::inspect_png(PNG).unwrap();
        assert_eq!((saved.image_width, saved.image_height), (w, h));
        assert_eq!(saved.image_sha256, format!("{:x}", Sha256::digest(PNG)));
        let (title, path, size): (String, String, i64) = conn
            .query_row(
                "SELECT title,file_path,file_size FROM study_materials WHERE id=?1",
                [&saved.material_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert!(title.starts_with("Phone picture "));
        assert!(path.ends_with("photo.png"));
        assert_eq!(size, PNG.len() as i64);
        assert_eq!(
            std::fs::read(root.join("documents").join(&path)).unwrap(),
            PNG
        );
        // The saved material reads back through the normal picture-card path.
        let picture = crate::visual_cards::image_on(&conn, &root, &saved.material_id).unwrap();
        assert_eq!(picture.image_sha256, saved.image_sha256);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_non_png_bytes_without_writing_anything() {
        let root = root();
        let mut conn = crate::visual_cards::tests::library(&root);
        let before = std::fs::read_dir(root.join("documents")).unwrap().count();
        let jpeg = [0xFFu8, 0xD8, 0xFF, 0xE0, 0, 16, b'J', b'F', b'I', b'F'];
        assert!(save_on(&mut conn, &root, &jpeg).is_err());
        let mut truncated = PNG.to_vec();
        truncated.truncate(PNG.len() - 4);
        assert!(save_on(&mut conn, &root, &truncated).is_err());
        assert_eq!(
            std::fs::read_dir(root.join("documents")).unwrap().count(),
            before
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM study_materials", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let _ = std::fs::remove_dir_all(&root);
    }
}
