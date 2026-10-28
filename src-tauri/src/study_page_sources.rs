//! Private bookmark-to-card provenance. Preview reads bytes without recording navigation.
use crate::study_sets::StudySetErrorCode as Code;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::path::Path;
type Check<T> = Result<T, Code>;
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub id: String,
    pub material_id: Option<String>,
    pub material_title: String,
    pub content_sha256: Option<String>,
    pub physical_page: i64,
    pub printed_label: Option<String>,
}
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preview {
    pub content_sha256: String,
    pub total_pages: i64,
}
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub source: Source,
    pub bookmark: Value,
    pub preview: Option<Preview>,
    pub item_id: String,
}
fn hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn storage(_: rusqlite::Error) -> Code {
    Code::StorageError
}
pub fn decode(v: &Value, material: &str, next: &Value) -> Check<Envelope> {
    let exact = |value: &Value, keys: &[&str]| {
        value
            .as_object()
            .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
    };
    if !exact(v, &["source", "bookmark", "preview", "itemId"])
        || !exact(
            &v["source"],
            &[
                "id",
                "materialId",
                "materialTitle",
                "contentSha256",
                "physicalPage",
                "printedLabel",
            ],
        )
        || !exact(
            &v["bookmark"],
            &[
                "id",
                "materialId",
                "physicalPage",
                "pageLabel",
                "originatingContentSha256",
                "title",
                "notes",
                "status",
                "createdAt",
                "updatedAt",
            ],
        )
        || (!v["preview"].is_null() && !exact(&v["preview"], &["contentSha256", "totalPages"]))
    {
        return Err(Code::InvalidArgument);
    }
    let e: Envelope = serde_json::from_value(v.clone()).map_err(|_| Code::InvalidArgument)?;
    let p = &e.source;
    let b = &e.bookmark;
    let card = next["flashcards"]
        .as_array()
        .and_then(|a| a.iter().find(|c| c["itemId"] == e.item_id));
    if !crate::study_sets::is_lower_uuid_v4(&p.id)
        || p.material_id.as_deref() != Some(material)
        || p.material_title.trim().is_empty()
        || p.material_title.chars().count() > 500
        || p.physical_page < 1
        || p.content_sha256.as_ref().is_some_and(|s| !hex(s))
        || p.printed_label
            .as_ref()
            .is_some_and(|s| s.chars().count() > 100)
        || b["materialId"] != material
        || !b["id"]
            .as_str()
            .is_some_and(crate::study_sets::is_lower_uuid_v4)
        || b["physicalPage"] != p.physical_page
        || b["pageLabel"] != json!(p.printed_label)
        || b["originatingContentSha256"] != json!(p.content_sha256)
        || !b["title"]
            .as_str()
            .is_some_and(|s| s.chars().count() <= 500)
        || !b["notes"]
            .as_str()
            .is_some_and(|s| s.chars().count() <= 20000)
        || !b["updatedAt"].is_string()
        || !b["createdAt"].is_string()
        || !b["status"]
            .as_str()
            .is_some_and(|s| ["verified", "unverified", "drifted"].contains(&s))
        || e.preview
            .as_ref()
            .is_some_and(|p| !hex(&p.content_sha256) || p.total_pages < 0)
        || card.is_none()
    {
        return Err(Code::InvalidArgument);
    }
    Ok(e)
}
pub fn fingerprint(c: &Value) -> String {
    crate::practice_sessions::compute_canonical_hash(&json!([
        c["front"],
        c["back"],
        c["sourcePage"],
        c.get("origin").unwrap_or(&Value::Null)
    ]))
}
/// Missing or unreadable PDF is an explicitly unverified preview, never a cached identity.
pub fn preview_on(conn: &Connection, root: &Path, material: &str) -> Check<Option<Preview>> {
    let path: Option<Option<String>> = conn
        .query_row(
            "SELECT file_path FROM study_materials WHERE id=?1",
            [material],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    let Some(path) = path else {
        return Err(Code::NotFound);
    };
    let Some(path) = path else { return Ok(None) };
    let Ok(safe) = crate::documents::safe_relative_path(&path) else {
        return Ok(None);
    };
    let bytes = match std::fs::read(root.join("documents").join(safe)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Code::StorageError),
    };
    // Keep byte identity even for a changed, unparseable PDF. Zero means its
    // page count is unknown; it can never verify a physical position.
    let (content_sha256, total_pages) = crate::navigation::identity_of_bytes(&bytes)
        .unwrap_or_else(|_| {
            use sha2::Digest;
            (format!("{:x}", sha2::Sha256::digest(&bytes)), 0)
        });
    Ok(Some(Preview {
        content_sha256,
        total_pages,
    }))
}
#[tauri::command]
pub async fn preview_study_page_source(
    app: tauri::AppHandle,
    material_id: String,
) -> Result<Option<Preview>, String> {
    use tauri::Manager;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Couldn't check this source.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(root.join("her-flight-deck.db"))
            .map_err(|_| "Couldn't check this source.")?;
        preview_on(&conn, &root, &material_id)
            .map_err(|_| "Couldn't check this source.".to_string())
    })
    .await
    .map_err(|_| "Couldn't check this source.".to_string())?
}
pub fn write(tx: &Transaction<'_>, e: &Envelope, next: &Value, now: &str) -> Check<()> {
    let p = &e.source;
    let b = &e.bookmark;
    let row:Option<Value>=tx.query_row("SELECT b.title,b.notes,b.updated_at,b.page_index,b.page_label,b.originating_content_sha256,m.title,b.created_at FROM material_bookmarks b JOIN study_materials m ON m.id=b.material_id WHERE b.id=?1 AND b.material_id=?2",params![b["id"].as_str(),p.material_id],|r|Ok(json!([r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?]))).optional().map_err(storage)?;
    if row
        != Some(json!([
            b["title"],
            b["notes"],
            b["updatedAt"],
            p.physical_page,
            p.printed_label,
            p.content_sha256,
            p.material_title,
            b["createdAt"]
        ]))
    {
        return Err(Code::SourceChanged);
    }
    let c = next["flashcards"]
        .as_array()
        .and_then(|a| a.iter().find(|c| c["itemId"] == e.item_id))
        .ok_or(Code::InvalidArgument)?;
    if c["sourcePage"] != p.physical_page {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO study_page_sources VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            p.id,
            p.material_id,
            p.material_title,
            p.content_sha256,
            p.physical_page,
            p.printed_label,
            b["id"].as_str(),
            now
        ],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO study_page_source_bindings VALUES (?1,?2,'authored_card',?3,?4)",
        params![p.id, p.material_id, e.item_id, fingerprint(c)],
    )
    .map_err(storage)?;
    Ok(())
}
pub fn carry(tx: &Transaction<'_>, owner: &str, before: &Value, after: &Value) -> Check<()> {
    if !has_tables(tx) {
        return Ok(());
    }
    if let (Some(before), Some(after)) = (before.as_array(), after.as_array()) {
        for c in after {
            let Some(id) = c["itemId"].as_str() else {
                continue;
            };
            let Some(old) = before.iter().find(|o| {
                o["itemId"].is_string() && (o["itemId"] == id || o["itemId"] == c["replaces"])
            }) else {
                continue;
            };
            if old["sourcePage"] != c["sourcePage"] {
                continue;
            }
            tx.execute("INSERT OR IGNORE INTO study_page_source_bindings SELECT source_id,owner_key,binding_kind,?1,?2 FROM study_page_source_bindings WHERE owner_key=?3 AND binding_kind='authored_card' AND item_key=?4 AND content_fingerprint=?5",params![id,fingerprint(c),owner,old["itemId"].as_str(),fingerprint(old)]).map_err(storage)?;
        }
    }
    Ok(())
}
fn has_tables(c: &Connection) -> bool {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='study_page_sources')",
        [],
        |r| r.get(0),
    )
    .unwrap_or(false)
}
pub fn freeze(
    tx: &Transaction<'_>,
    owner: &str,
    items: &[(String, usize)],
) -> Result<(), rusqlite::Error> {
    if !has_tables(tx) {
        return Ok(());
    }
    let raw: String = tx.query_row(
        "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?1",
        [owner],
        |r| r.get(0),
    )?;
    let cards: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    for (key, i) in items {
        let c = &cards[*i];
        if let Some(id) = c["itemId"].as_str() {
            tx.execute("INSERT OR IGNORE INTO study_page_source_bindings SELECT source_id,owner_key,'frozen_card',?1,content_fingerprint FROM study_page_source_bindings WHERE owner_key=?2 AND binding_kind='authored_card' AND item_key=?3 AND content_fingerprint=?4",params![key,owner,id,fingerprint(c)])?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};
    fn pdf_bytes(pages: u32, salt: &str) -> Vec<u8> {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let kids: Vec<Object> = (0..pages)
            .map(|_| {
                document
                    .add_object(dictionary! {
                        "Type" => "Page",
                        "Parent" => pages_id,
                        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    })
                    .into()
            })
            .collect();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Count" => i64::from(pages),
                "Kids" => kids,
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        document.trailer.set(
            "Info",
            Object::Dictionary(dictionary! { "Title" => Object::string_literal(salt) }),
        );
        let mut out = Vec::new();
        document.save_to(&mut out).unwrap();
        out
    }

    pub(crate) fn library(root: &Path) -> Connection {
        let c = Connection::open(root.join("her-flight-deck.db")).unwrap();
        c.execute_batch(
            "PRAGMA foreign_keys=ON; CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in crate::migrations() {
            c.execute_batch(m.sql).unwrap();
            c.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
                .unwrap();
        }
        c.execute("INSERT INTO study_materials (id,title,file_path,created_at,updated_at) VALUES ('m','Synthetic','source.pdf','x','x')",[]).unwrap();
        c.execute("INSERT INTO material_bookmarks (id,material_id,page_index,page_label,originating_content_sha256,title,notes,status,created_at,updated_at) VALUES ('5e700000-0000-4000-8000-000000000001','m',1,'iv',NULL,'Question','Answer','unverified','x','x')",[]).unwrap();
        c
    }
    pub(crate) fn operation(preview: Option<Preview>) -> Value {
        json!({"operationId":"5e700000-0000-4000-8000-000000000002","materialId":"m","reason":"create","expected":null,"next":{"title":"Cards","summary":"","summaryOrigin":null,"sections":[],"flashcards":[{"itemId":"one","front":"Question","back":"Answer","sourcePage":1,"origin":"user"}],"sourceNotes":"","provider":"manual","model":"","retired":[]},"pageSource":{"source":{"id":"5e700000-0000-4000-8000-000000000003","materialId":"m","materialTitle":"Synthetic","contentSha256":null,"physicalPage":1,"printedLabel":"iv"},"bookmark":{"id":"5e700000-0000-4000-8000-000000000001","materialId":"m","physicalPage":1,"pageLabel":"iv","originatingContentSha256":null,"title":"Question","notes":"Answer","status":"unverified","createdAt":"x","updatedAt":"x"},"preview":preview,"itemId":"one"}})
    }
    fn scratch() -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "hfd-page-source-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(p.join("documents")).unwrap();
        p
    }
    #[test]
    fn bookmark_source_preview_is_read_only_and_file_changes_refuse_save_without_writes() {
        let root = scratch();
        let c = library(&root);
        let bytes = pdf_bytes(2, "A");
        let original_sha = crate::navigation::identity_of_bytes(&bytes).unwrap().0;
        let file = root.join("documents/source.pdf");
        std::fs::write(&file, &bytes).unwrap();
        let p = preview_on(&c, &root, "m").unwrap();
        assert!(p.is_some());
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM material_content_identities",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        let op = operation(p);
        assert_eq!(std::fs::read(&file).unwrap(), bytes); // Cancel/preview never rewrites a PDF.
        assert_eq!(
            crate::navigation::identity_of_bytes(&std::fs::read(&file).unwrap())
                .unwrap()
                .0,
            original_sha
        );
        std::fs::write(&file, pdf_bytes(2, "B")).unwrap();
        let changed = std::fs::read(&file).unwrap();
        let changed_sha = crate::navigation::identity_of_bytes(&changed).unwrap().0;
        assert_eq!(
            crate::study_sets::save_study_set_at(&root, &op)
                .unwrap_err()
                .code,
            Code::SourceChanged
        );
        assert_eq!(std::fs::read(&file).unwrap(), changed);
        assert_eq!(
            crate::navigation::identity_of_bytes(&std::fs::read(&file).unwrap())
                .unwrap()
                .0,
            changed_sha
        );
        for t in [
            "ai_study_sets",
            "study_page_sources",
            "study_set_save_operations",
            "study_set_history",
        ] {
            assert_eq!(
                c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bookmark_source_missing_and_changed_drafts_save_atomically_retry_and_validate_backup() {
        for state in ["missing", "changed", "matching"] {
            let root = scratch();
            let c = library(&root);
            let file = root.join("documents/source.pdf");
            let original = pdf_bytes(2, "Original");
            let original_sha = crate::navigation::identity_of_bytes(&original).unwrap().0;
            c.execute(
                "UPDATE material_bookmarks SET originating_content_sha256=?1",
                [&original_sha],
            )
            .unwrap();
            if state != "missing" {
                let bytes = if state == "matching" {
                    original
                } else {
                    pdf_bytes(2, "Replacement")
                };
                std::fs::write(&file, bytes).unwrap();
            }
            let preview = preview_on(&c, &root, "m").unwrap();
            let mut op = operation(preview);
            op["pageSource"]["source"]["contentSha256"] = json!(original_sha);
            op["pageSource"]["bookmark"]["originatingContentSha256"] = json!(original_sha);
            let before = std::fs::read(&file).ok();
            assert_eq!(
                crate::study_sets::save_study_set_at(&root, &op)
                    .unwrap()
                    .status,
                "saved"
            );
            assert_eq!(
                crate::study_sets::save_study_set_at(&root, &op)
                    .unwrap()
                    .status,
                "already_saved"
            );
            assert_eq!(std::fs::read(&file).ok(), before);
            assert_eq!(
                std::fs::read(&file)
                    .ok()
                    .map(|b| crate::navigation::identity_of_bytes(&b).unwrap().0),
                before
                    .as_ref()
                    .map(|b| crate::navigation::identity_of_bytes(b).unwrap().0)
            );
            assert_eq!(
                c.query_row("SELECT content_sha256 FROM study_page_sources", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
                original_sha
            );
            crate::backup::verify_application_connection(&c).unwrap();
            let mut conflict = op.clone();
            conflict["pageSource"]["source"]["materialTitle"] = json!("Other");
            assert_eq!(
                crate::study_sets::save_study_set_at(&root, &conflict)
                    .unwrap_err()
                    .code,
                Code::Conflict
            );
            assert_eq!(
                c.query_row("SELECT count(*) FROM study_page_source_bindings", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn bookmark_source_failure_rolls_back_card_and_receipt_and_stale_note_refuses() {
        let root = scratch();
        let c = library(&root);
        let op = operation(None);
        c.execute_batch("CREATE TRIGGER refuse_source BEFORE INSERT ON study_page_sources BEGIN SELECT RAISE(ABORT,'synthetic full disk'); END;").unwrap();
        assert_eq!(
            crate::study_sets::save_study_set_at(&root, &op)
                .unwrap_err()
                .code,
            Code::StorageError
        );
        for t in [
            "ai_study_sets",
            "study_page_sources",
            "study_set_save_operations",
        ] {
            assert_eq!(
                c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        c.execute_batch("DROP TRIGGER refuse_source; UPDATE material_bookmarks SET notes='New' WHERE material_id='m';").unwrap();
        assert_eq!(
            crate::study_sets::save_study_set_at(&root, &op)
                .unwrap_err()
                .code,
            Code::SourceChanged
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bookmark_source_unparseable_pdf_keeps_byte_identity_and_detects_further_change() {
        let root = scratch();
        let conn = library(&root);
        let file = root.join("documents/source.pdf");
        std::fs::write(&file, b"synthetic damaged PDF A").unwrap();
        let preview = preview_on(&conn, &root, "m").unwrap().unwrap();
        assert_eq!(preview.total_pages, 0);
        let op = operation(Some(preview));
        std::fs::write(&file, b"synthetic damaged PDF B").unwrap();
        assert_eq!(
            crate::study_sets::save_study_set_at(&root, &op)
                .unwrap_err()
                .code,
            Code::SourceChanged
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM ai_study_sets", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        std::fs::write(&file, b"synthetic damaged PDF A").unwrap();
        assert_eq!(
            crate::study_sets::save_study_set_at(&root, &op)
                .unwrap()
                .status,
            "saved"
        );
        assert_eq!(std::fs::read(&file).unwrap(), b"synthetic damaged PDF A");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bookmark_source_snapshot_rejects_missing_and_unexpected_fields() {
        for key in [
            "pageLabel",
            "originatingContentSha256",
            "status",
            "createdAt",
        ] {
            let mut op = operation(None);
            op["pageSource"]["bookmark"]
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert_eq!(
                crate::study_sets::decode_operation(&op).unwrap_err(),
                Code::InvalidArgument
            );
        }
        let mut op = operation(None);
        op["pageSource"]["bookmark"]["externalPath"] = json!("synthetic unwanted field");
        assert_eq!(
            crate::study_sets::decode_operation(&op).unwrap_err(),
            Code::InvalidArgument
        );
    }
}
