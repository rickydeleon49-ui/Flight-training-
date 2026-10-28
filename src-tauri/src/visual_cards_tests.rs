struct TempDir(std::path::PathBuf);
impl TempDir {
    fn new() -> Self {
        static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!(
            "hfd-visual-{}-{n}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        crate::practice_sessions::unmark_root_ready(&self.0);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
use super::*;
pub const NOW: &str = "2026-10-28T12:00:00.000Z";
pub const PNG: &[u8] = include_bytes!("../../src/testing/fixtures/visual/practice-panel.png");
pub fn library(root: &Path) -> Connection {
    std::fs::create_dir_all(root.join("documents")).unwrap();
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY)")
        .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
            .unwrap();
    }
    for id in ["owner", "image"] {
        conn.execute("INSERT INTO study_materials(id,title,created_at,updated_at,file_path) VALUES (?1,?1,?2,?2,?3)",params![id,NOW,if id=="image"{Some("panel.png")}else{None}]).unwrap();
    }
    std::fs::write(root.join("documents/panel.png"), PNG).unwrap();
    crate::practice_sessions::mark_root_ready(root);
    conn
}
pub fn region() -> Region {
    let (w, h) = inspect_png(PNG).unwrap();
    let mut r = Region {
        id: String::new(),
        owner_material_id: "owner".into(),
        image_material_id: Some("image".into()),
        image_sha256: format!("{:x}", Sha256::digest(PNG)),
        image_width: w,
        image_height: h,
        x: 20,
        y: 30,
        w: 40,
        h: 15,
        rotation: 0,
    };
    r.id = r.hash();
    r
}
pub fn operation(r: &Region) -> Value {
    json!({"operationId":"5e700000-0000-4000-8000-000000000001","materialId":"owner","reason":"create","expected":null,"visualRegions":[r],"next":{"title":"Synthetic picture","summary":"","summaryOrigin":null,"sections":[],"flashcards":[{"itemId":"cover-1","front":"Which label is in the middle?","back":"Bravo","sourcePage":null,"origin":"user","visualRegionId":r.id}],"sourceNotes":"","provider":"manual","model":"","retired":[]}})
}
pub fn expected(conn: &Connection) -> Value {
    let mut m = serde_json::Map::new();
    for col in crate::study_sets::SET_COLUMNS {
        let v: Option<String> = conn
            .query_row(
                &format!("SELECT {col} FROM ai_study_sets WHERE source_material_id='owner'"),
                [],
                |r| r.get(0),
            )
            .unwrap();
        m.insert(col.into(), json!(v));
    }
    Value::Object(m)
}
pub fn rate(root: &Path, conn: &Connection, n: u32) -> Value {
    let text: String = conn
        .query_row(
            "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id='owner'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let crate::card_reviews::SavedCards::Ok(cards) =
        crate::card_reviews::parse_saved_cards(Some(&text))
    else {
        panic!()
    };
    let v = crate::card_reviews::card_version("owner", &cards);
    let revision: i64 = conn
        .query_row(
            "SELECT revision FROM card_review_state WHERE item_id=?1",
            [&v.items[0].item_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
        .unwrap_or(0);
    let op = json!({"operationId":format!("5e700000-0000-4000-8000-{n:012x}"),"action":"rate","materialId":"owner","versionContentHash":v.content_hash,"itemId":v.items[0].item_id,"expectedGeneration":0,"expectedRevision":revision,"rating":"good"});
    crate::card_reviews::save_card_review_at(root, &op).unwrap();
    op
}
#[test]
fn visual_descriptor_hash_and_bounds_are_checked_before_storage() {
    let r = region();
    r.validate().unwrap();
    let mut bad = r.clone();
    bad.image_sha256 = "a".repeat(64);
    assert!(bad.validate().is_err());
    let mut bad = r;
    bad.x = bad.image_width;
    bad.id = bad.hash();
    assert!(bad.validate().is_err());
}
#[test]
fn visual_png_limits_and_swapped_original_are_refused() {
    for bytes in [
        include_bytes!("../../src/testing/fixtures/visual/bad-animated.png").as_slice(),
        include_bytes!("../../src/testing/fixtures/visual/bad-header-bomb.png").as_slice(),
        include_bytes!("../../src/testing/fixtures/visual/bad-truncated.png").as_slice(),
        include_bytes!("../../src/testing/fixtures/visual/bad-jpeg-renamed.png").as_slice(),
    ] {
        assert!(inspect_png(bytes).is_err());
    }
    let r = region();
    verify_bytes(&r, PNG).unwrap();
    let mut changed = PNG.to_vec();
    changed[40] ^= 1;
    assert!(verify_bytes(&r, &changed).is_err());
}
#[test]
fn visual_atomic_save_retry_freeze_edit_return_and_delete_keep_history() {
    let dir = TempDir::new();
    let conn = library(dir.path());
    let r = region();
    let op = operation(&r);
    crate::study_sets::save_study_set_at(dir.path(), &op).unwrap();
    assert_eq!(
        crate::study_sets::save_study_set_at(dir.path(), &op)
            .unwrap()
            .status,
        "already_saved"
    );
    let rating = rate(dir.path(), &conn, 20);
    assert_eq!(
        frozen_id(&conn, rating["itemId"].as_str().unwrap()).unwrap(),
        Some(r.id.clone())
    );
    let mut r2 = r.clone();
    r2.rotation = 90;
    r2.x += 1;
    r2.id = r2.hash();
    let mut edit = operation(&r2);
    edit["operationId"] = json!("5e700000-0000-4000-8000-000000000002");
    edit["reason"] = json!("edit");
    edit["expected"] = expected(&conn);
    crate::study_sets::save_study_set_at(dir.path(), &edit).unwrap();
    let new = rate(dir.path(), &conn, 21);
    assert_ne!(new["itemId"], rating["itemId"]);
    let mut back = operation(&r);
    back["operationId"] = json!("5e700000-0000-4000-8000-000000000003");
    back["reason"] = json!("restore");
    back["expected"] = expected(&conn);
    crate::study_sets::save_study_set_at(dir.path(), &back).unwrap();
    let old = rate(dir.path(), &conn, 22);
    assert_eq!(old["itemId"], rating["itemId"]);
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute("DELETE FROM study_materials WHERE id='image'", [])
        .unwrap();
    assert!(read_region(&conn, &r.id)
        .unwrap()
        .image_material_id
        .is_none());
    let mut refused = rating.clone();
    refused["operationId"] = json!("5e700000-0000-4000-8000-000000000023");
    refused["expectedRevision"] = json!(2);
    assert!(crate::card_reviews::save_card_review_at(dir.path(), &refused).is_err());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM card_review_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        3
    );
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute("DELETE FROM study_materials WHERE id='owner'", [])
        .unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM visual_card_regions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn visual_sidecar_failure_rolls_back_and_uncertain_replay_is_exact() {
    let dir = TempDir::new();
    let conn = library(dir.path());
    let op = operation(&region());
    conn.execute_batch("CREATE TRIGGER disk_full BEFORE INSERT ON ai_study_sets BEGIN SELECT RAISE(FAIL,'disk full'); END").unwrap();
    assert!(crate::study_sets::save_study_set_at(dir.path(), &op).is_err());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM visual_card_regions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    conn.execute_batch("DROP TRIGGER disk_full").unwrap();
    crate::study_sets::save_study_set_at(dir.path(), &op).unwrap();
    let mut changed = op.clone();
    changed["next"]["flashcards"][0]["back"] = json!("Different");
    assert!(crate::study_sets::save_study_set_at(dir.path(), &changed).is_err());
    let mut bytes = PNG.to_vec();
    bytes[40] ^= 1;
    std::fs::write(dir.path().join("documents/panel.png"), bytes).unwrap();
    // Confirmed replay succeeds even when the source has since changed.
    assert_eq!(
        crate::study_sets::save_study_set_at(dir.path(), &op)
            .unwrap()
            .status,
        "already_saved"
    );
    let mut edit = op;
    edit["operationId"] = json!("5e700000-0000-4000-8000-000000000004");
    edit["reason"] = json!("edit");
    edit["expected"] = expected(&conn);
    assert!(crate::study_sets::save_study_set_at(dir.path(), &edit).is_err());
}
#[test]
fn visual_backup_validator_checks_unreferenced_retained_sidecars() {
    let dir = TempDir::new();
    let conn = library(dir.path());
    let r = region();
    crate::study_sets::save_study_set_at(dir.path(), &operation(&r)).unwrap();
    conn.execute("UPDATE ai_study_sets SET flashcards_json='[]'", [])
        .unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute(
        "UPDATE visual_card_regions SET image_sha256=?1",
        ["b".repeat(64)],
    )
    .unwrap();
    assert!(crate::backup::verify_application_connection(&conn).is_err());
}
#[test]
fn visual_delete_undo_stage_db_failure_restart_and_purge_reporting() {
    let dir = TempDir::new();
    let conn = library(dir.path());
    let r = region();
    crate::study_sets::save_study_set_at(dir.path(), &operation(&r)).unwrap();
    // Cancel/ordinary Undo never invokes staging; the same exact image is usable.
    verify_image(&conn, dir.path(), &r).unwrap();
    std::fs::create_dir(dir.path().join("documents/.trash")).unwrap();
    let staged = crate::documents::stage_delete_document_in(dir.path(), "panel.png").unwrap();
    conn.execute_batch("CREATE TRIGGER refuse_delete BEFORE DELETE ON study_materials BEGIN SELECT RAISE(FAIL,'disk full'); END").unwrap();
    assert!(conn
        .execute("DELETE FROM study_materials WHERE id='image'", [])
        .is_err());
    crate::documents::rollback_delete_document_in(dir.path(), &staged.staged_id).unwrap();
    verify_image(&conn, dir.path(), &r).unwrap();
    crate::documents::stage_delete_document_in(dir.path(), "panel.png").unwrap();
    crate::documents::cleanup_staged_deletions_in(dir.path()).unwrap();
    verify_image(&conn, dir.path(), &r).unwrap();
    let staged = crate::documents::stage_delete_document_in(dir.path(), "panel.png").unwrap();
    conn.execute_batch("DROP TRIGGER refuse_delete").unwrap();
    conn.execute("DELETE FROM study_materials WHERE id='image'", [])
        .unwrap();
    let data = dir
        .path()
        .join(format!("documents/.trash/{}.data", staged.staged_id));
    let meta = dir
        .path()
        .join(format!("documents/.trash/{}.meta", staged.staged_id));
    std::fs::remove_file(&data).unwrap();
    std::fs::create_dir(&data).unwrap();
    assert!(crate::documents::commit_delete_document_in(dir.path(), &staged.staged_id).is_err());
    assert!(meta.is_file());
    std::fs::remove_dir(&data).unwrap();
    crate::documents::cleanup_staged_deletions_in(dir.path()).unwrap();
    assert!(!meta.exists());
    // A stage failure leaves both the descriptor and original file unchanged.
    let dir2 = TempDir::new();
    let conn2 = library(dir2.path());
    crate::study_sets::save_study_set_at(dir2.path(), &operation(&r)).unwrap();
    std::fs::write(dir2.path().join("documents/.trash"), b"blocked").unwrap();
    assert!(crate::documents::stage_delete_document_in(dir2.path(), "panel.png").is_err());
    verify_image(&conn2, dir2.path(), &r).unwrap();
}
#[test]
fn visual_descriptor_shared_golden_and_twenty_cover_limit() {
    let golden: Region = serde_json::from_str(include_str!(
        "../../src/testing/fixtures/visual/region-identity.json"
    ))
    .unwrap();
    assert_eq!(golden, region());
    golden.validate().unwrap();
    let legacy = json!({"front":"Q","back":"A","sourcePage":null});
    assert_eq!(crate::pdf_kit_sources::content("card", &legacy), legacy);
    let dir = TempDir::new();
    let conn = library(dir.path());
    let r = region();
    let mut op = operation(&r);
    op["next"]["flashcards"]=json!((0..21).map(|i|json!({"front":"Q","back":"A","sourcePage":null,"itemId":format!("cover-{i}"),"origin":"user","visualRegionId":r.id})).collect::<Vec<_>>());
    assert!(crate::study_sets::save_study_set_at(dir.path(), &op).is_err());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM visual_card_regions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    op["next"]["flashcards"].as_array_mut().unwrap().pop();
    crate::study_sets::save_study_set_at(dir.path(), &op).unwrap();
    conn.execute_batch("CREATE TRIGGER frozen_disk_full BEFORE INSERT ON card_item_visual_regions BEGIN SELECT RAISE(FAIL,'disk full'); END").unwrap();
    let text = op["next"]["flashcards"].to_string();
    let crate::card_reviews::SavedCards::Ok(cards) =
        crate::card_reviews::parse_saved_cards(Some(&text))
    else {
        panic!()
    };
    let v = crate::card_reviews::card_version("owner", &cards);
    let action = json!({"operationId":"5e700000-0000-4000-8000-000000000080","action":"rate","materialId":"owner","versionContentHash":v.content_hash,"itemId":v.items[0].item_id,"expectedGeneration":0,"expectedRevision":0,"rating":"good"});
    assert!(crate::card_reviews::save_card_review_at(dir.path(), &action).is_err());
    for table in [
        "card_versions",
        "card_items",
        "card_item_visual_regions",
        "card_review_events",
    ] {
        assert_eq!(
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    assert_eq!(
        std::fs::read(dir.path().join("documents/panel.png")).unwrap(),
        PNG
    );
}
#[test]
fn visual_detached_cards_can_be_retained_edited_retired_and_paused_without_rating_them() {
    let dir = TempDir::new();
    let conn = library(dir.path());
    let r = region();
    crate::study_sets::save_study_set_at(dir.path(), &operation(&r)).unwrap();
    conn.execute("DELETE FROM study_materials WHERE id='image'", [])
        .unwrap();
    let mut op = operation(&r);
    op.as_object_mut().unwrap().remove("visualRegions");
    op["reason"] = json!("edit");
    op["operationId"] = json!("5e700000-0000-4000-8000-000000000090");
    op["expected"] = expected(&conn);
    op["next"]["flashcards"].as_array_mut().unwrap().push(json!({"front":"Independent text question","back":"Independent answer","sourcePage":null,"itemId":"text-1","origin":"user"}));
    crate::study_sets::save_study_set_at(dir.path(), &op).unwrap();
    let text = op["next"]["flashcards"].to_string();
    let crate::card_reviews::SavedCards::Ok(cards) =
        crate::card_reviews::parse_saved_cards(Some(&text))
    else {
        panic!()
    };
    let v = crate::card_reviews::card_version("owner", &cards);
    let mut action = json!({"operationId":"5e700000-0000-4000-8000-000000000091","action":"rate","materialId":"owner","versionContentHash":v.content_hash,"itemId":v.items[1].item_id,"expectedGeneration":0,"expectedRevision":0,"rating":"good"});
    crate::card_reviews::save_card_review_at(dir.path(), &action).unwrap();
    action["operationId"] = json!("5e700000-0000-4000-8000-000000000092");
    action["itemId"] = json!(v.items[0].item_id);
    assert!(crate::card_reviews::save_card_review_at(dir.path(), &action).is_err());
    action.as_object_mut().unwrap().remove("rating");
    action["action"] = json!("suspend");
    crate::card_reviews::save_card_review_at(dir.path(), &action).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM card_review_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    op["operationId"] = json!("5e700000-0000-4000-8000-000000000093");
    op["expected"] = expected(&conn);
    op["reason"] = json!("delete");
    op["next"]["flashcards"].as_array_mut().unwrap().remove(0);
    crate::study_sets::save_study_set_at(dir.path(), &op).unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
    assert!(frozen_id(&conn, &v.items[0].item_id).unwrap().is_some());
}
