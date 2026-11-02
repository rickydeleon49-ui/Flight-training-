//! Mac-only, bounded one-page capture. All subprocess paths stay native.
use serde::Serialize;
#[cfg(any(target_os = "macos", test))]
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub material_id: String,
    pub source: crate::study_page_sources::Source,
    pub image_sha256: String,
    pub image_width: i64,
    pub image_height: i64,
}

#[tauri::command]
pub async fn render_pdf_page(
    app: tauri::AppHandle,
    material_id: String,
    page_index: u32, // 1-based physical page, like material_bookmarks.page_index.
    max_px: u32,
) -> Result<Capture, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, material_id, page_index, max_px);
        Err("Only on the Mac".into())
    }
    #[cfg(target_os = "macos")]
    {
        let root = crate::storage::app_root(&app)?;
        tauri::async_runtime::spawn_blocking(move || {
            let mut conn = rusqlite::Connection::open(root.join("her-flight-deck.db"))
                .map_err(|_| "Couldn't save this picture.")?;
            conn.pragma_update(None, "foreign_keys", "ON")
                .map_err(err)?;
            capture_on(
                &mut conn,
                &root,
                &material_id,
                page_index,
                max_px,
                |dir, px| {
                    raster(
                        dir,
                        px,
                        Path::new("/usr/bin/qlmanage"),
                        Path::new("/usr/bin/sips"),
                        std::time::Duration::from_secs(30),
                    )
                },
            )
        })
        .await
        .map_err(|_| "Couldn't make this picture.")?
    }
}

#[cfg(any(target_os = "macos", test))]
use {
    rusqlite::{params, Connection, OptionalExtension},
    sha2::{Digest, Sha256},
    std::{
        io::Read,
        path::PathBuf,
        time::{Duration, Instant},
    },
};
#[cfg(any(target_os = "macos", test))]
fn err(_: impl std::fmt::Display) -> String {
    "Couldn't make or save this page picture.".into()
}
#[cfg(any(target_os = "macos", test))]
struct Scratch(PathBuf);
#[cfg(any(target_os = "macos", test))]
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[cfg(any(target_os = "macos", test))]
fn bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(err)?;
    if !file.metadata().map_err(err)?.is_file() {
        return Err(err("file"));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > limit {
        return Err("This file is too large to make a page picture.".into());
    }
    Ok(bytes)
}
#[cfg(any(target_os = "macos", test))]
fn run(binary: &Path, args: &[&std::ffi::OsStr], deadline: Instant) -> Result<bool, String> {
    use std::process::{Command, Stdio};
    if Instant::now() >= deadline {
        return Err("Making the picture timed out. Please try again.".into());
    }
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "The Mac picture tool is unavailable.".to_string())?;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.success()),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if result.is_err() {
                    err("wait")
                } else {
                    "Making the picture timed out. Please try again.".into()
                });
            }
        }
    }
}
#[cfg(any(target_os = "macos", test))]
fn raster(
    dir: &Path,
    px: u32,
    quicklook: &Path,
    sips: &Path,
    timeout: Duration,
) -> Result<PathBuf, String> {
    let deadline = Instant::now() + timeout.min(Duration::from_secs(30));
    let input = dir.join("page.pdf");
    let output = dir.join("page.pdf.png");
    let size = px.to_string();
    let quick = run(
        quicklook,
        &[
            "-t".as_ref(),
            "-s".as_ref(),
            size.as_ref(),
            "-o".as_ref(),
            dir.as_os_str(),
            input.as_os_str(),
        ],
        deadline,
    );
    // A timeout is final: fallback shares the same overall deadline.
    if Instant::now() >= deadline {
        return Err("Making the picture timed out. Please try again.".into());
    }
    if quick.unwrap_or(false) && output.is_file() {
        return Ok(output);
    }
    let fallback = dir.join("page.png");
    if run(
        sips,
        &[
            "-s".as_ref(),
            "format".as_ref(),
            "png".as_ref(),
            "-Z".as_ref(),
            size.as_ref(),
            input.as_os_str(),
            "--out".as_ref(),
            fallback.as_os_str(),
        ],
        deadline,
    )? && fallback.is_file()
    {
        return Ok(fallback);
    }
    Err("The Mac couldn't turn this page into a picture.".into())
}

#[cfg(any(target_os = "macos", test))]
fn capture_on(
    conn: &mut Connection,
    root: &Path,
    material: &str,
    page: u32,
    px: u32,
    render: impl FnOnce(&Path, u32) -> Result<PathBuf, String>,
) -> Result<Capture, String> {
    if page == 0 || !(1..=2048).contains(&px) {
        return Err("Choose a page from 1 and a picture size from 1 to 2048.".into());
    }
    // Read and render WITHOUT holding a write lock: the Mac tool can take up to
    // 30 s and the app's own saves must not hit "database is locked" meanwhile.
    // The write transaction below re-checks the PDF identity before saving.
    let identity = "SELECT m.title,m.file_path,i.content_sha256 FROM study_materials m JOIN material_content_identities i ON i.material_id=m.id WHERE m.id=?1";
    let (title, relative, expected): (String, String, String) = conn
        .query_row(identity, [material], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(|_| "Open this PDF and check its pages first.")?;
    let documents = root.join("documents").canonicalize().map_err(err)?;
    if !documents.starts_with(root.canonicalize().map_err(err)?) {
        return Err(err("path"));
    }
    let path = documents
        .join(crate::documents::safe_relative_path(&relative)?)
        .canonicalize()
        .map_err(err)?;
    if !path.starts_with(&documents) {
        return Err(err("path"));
    }
    let bytes = bounded(&path, crate::pdf::MAX_PDF_BYTES as usize)?;
    let check = |bytes: &[u8]| -> Result<(), String> {
        if format!("{:x}", Sha256::digest(bytes)) != expected {
            return Err("This PDF has changed. Open it and check the page again.".into());
        }
        Ok(())
    };
    check(&bytes)?;
    let doc = lopdf::Document::load_mem(&bytes).map_err(err)?;
    let id = crate::practice_sessions::generate_uuid_v4(conn).map_err(err)?;
    let temporary = std::env::temp_dir().join(format!("hfd-page-{id}"));
    std::fs::create_dir(&temporary).map_err(err)?;
    let scratch = Scratch(temporary);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&scratch.0, std::fs::Permissions::from_mode(0o700))
            .map_err(err)?;
    }
    crate::pdf::write_page_range_from_document(&doc, &scratch.0.join("page.pdf"), page, page)?;
    let png = bounded(&render(&scratch.0, px)?, crate::visual_cards::MAX_BYTES)?;
    let (w, h) = crate::visual_cards::inspect_png(&png)
        .map_err(|_| "This page picture exceeds the PNG limits or couldn't be read.")?;
    check(&bounded(&path, crate::pdf::MAX_PDF_BYTES as usize)?)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let current: Option<(String, String)> = tx
        .query_row(identity, [material], |r| Ok((r.get(1)?, r.get(2)?)))
        .optional()
        .map_err(err)?;
    if current != Some((relative.clone(), expected.clone())) {
        return Err("This PDF has changed. Open it and check the page again.".into());
    }
    // A note from an older edition must never silently acquire today's image.
    let stale: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM material_bookmarks WHERE material_id=?1 AND page_index=?2 AND originating_content_sha256 IS NOT NULL AND originating_content_sha256!=?3)", params![material,page,expected], |r| r.get(0)).map_err(err)?;
    if stale {
        return Err("This PDF has changed since the page note. Check the page again.".into());
    }
    let (label, bookmark): (Option<String>, Option<String>) = tx.query_row("SELECT page_label,id FROM material_bookmarks WHERE material_id=?1 AND page_index=?2 AND originating_content_sha256=?3 ORDER BY id LIMIT 1", params![material,page,expected], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?.unwrap_or((None,None));
    let source = crate::study_page_sources::Source {
        // Capture identity doubles as the source key, so slice 2 can recover
        // this snapshot from the visible image after a restart. Card bindings
        // are added only when a card is actually saved.
        id: id.clone(),
        material_id: Some(material.into()),
        material_title: title.clone(),
        content_sha256: Some(expected),
        physical_page: page as i64,
        printed_label: label.clone(),
    };
    let picture_title = format!(
        "{title} p. {} (picture)",
        label.unwrap_or_else(|| page.to_string())
    );
    let (destination, stored) =
        crate::documents::stored_destination_in(&documents, &id, "page.png")?;
    let save = (|| {
        std::fs::write(&destination, &png).map_err(err)?;
        tx.execute("INSERT INTO study_materials(id,title,file_path,original_file_name,file_size,created_at,updated_at) VALUES (?1,?2,?3,'page.png',?4,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![id,picture_title,stored,png.len() as i64]).map_err(err)?;
        tx.execute("INSERT INTO study_page_sources VALUES (?1,?2,?3,?4,?5,?6,?7,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![source.id,material,title,source.content_sha256,page,source.printed_label,bookmark]).map_err(err)?;
        tx.commit().map_err(err)
    })();
    if let Err(e) = save {
        let _ = std::fs::remove_file(destination);
        return Err(e);
    }
    Ok(Capture {
        material_id: id,
        source,
        image_sha256: format!("{:x}", Sha256::digest(&png)),
        image_width: w,
        image_height: h,
    })
}

#[cfg(test)]
#[path = "visual_pdf_tests.rs"]
mod tests;
