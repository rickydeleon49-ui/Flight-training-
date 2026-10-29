fn faa_test_operation() -> crate::documents::MaterialSaveOperation {
    serde_json::from_value(serde_json::json!({
        "mode": "create", "id": "faa", "fields": {
            "title": "Private Pilot Airplane ACS", "notes": "", "filePath": "synthetic.pdf"
        },
        "faaReference": { "referenceId": "private-acs", "edition": "", "contentSha256": "a".repeat(64), "totalPages": 1 }
    })).unwrap()
}

fn faa_test_pdf() -> Vec<u8> {
    use lopdf::{dictionary, Document, Object};
    let mut pdf = Document::with_version("1.5");
    let pages = pdf.new_object_id();
    let page = pdf.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(),0.into(),100.into(),100.into()] });
    pdf.objects.insert(pages, Object::Dictionary(dictionary! { "Type" => "Pages", "Count" => 1, "Kids" => vec![Object::Reference(page)] }));
    let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    pdf.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    pdf.save_to(&mut bytes).unwrap();
    bytes
}

#[test]
fn faa_complete_backup_round_trip_and_old_backup_empty_upgrade() {
    for old in [false, true] {
        let root = scratch("faa-source");
        let target = scratch("faa-target");
        let backups = scratch("faa-archive");
        pdf_kit_test_database(&root.join(DB_FILES[0]), if old { 26 } else { 27 });
        std::fs::create_dir_all(root.join("documents")).unwrap();
        let bytes = faa_test_pdf();
        std::fs::write(root.join("documents/synthetic.pdf"), &bytes).unwrap();
        let mut op = faa_test_operation();
        if old { op.faa_reference = None; }
        else { op.faa_reference.as_mut().unwrap().content_sha256 = sha256_digest(&bytes); }
        crate::documents::save_material_operation_at(&root, &op).unwrap();
        let archive = backups.join("faa.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
        if old {
            for migration in crate::migrations().into_iter().filter(|m| m.version > 26) {
                conn.execute_batch(migration.sql).unwrap();
                conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [migration.version]).unwrap();
            }
        }
        verify_application_connection(&conn).unwrap();
        assert_eq!(m3_count(&conn, "SELECT COUNT(*) FROM faa_reference_copies", &[]).unwrap(), if old { 0 } else { 1 });
        assert_eq!(conn.query_row("SELECT notes FROM study_materials WHERE id='faa'", [], |r| r.get::<_,String>(0)).unwrap(), "");
        assert_eq!(std::fs::read(target.join("documents/synthetic.pdf")).unwrap(), bytes);
        if !old {
            let row: (String, String, String, i64) = conn.query_row("SELECT reference_id,edition,content_sha256,total_pages FROM faa_reference_copies", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
            assert_eq!(row, ("private-acs".into(), "".into(), sha256_digest(&bytes), 1));
            conn.pragma_update(None,"foreign_keys","ON").unwrap();
            conn.execute("DELETE FROM study_materials WHERE id='faa'",[]).unwrap();
            assert_eq!(m3_count(&conn,"SELECT COUNT(*) FROM faa_reference_copies",&[]).unwrap(),0);
        }
        drop(conn);
        for path in [root,target,backups] { std::fs::remove_dir_all(path).unwrap(); }
    }
}

#[test]
fn faa_save_rolls_back_both_rows_on_invalid_details() {
    let root = scratch("faa-atomic");
    pdf_kit_test_database(&root.join(DB_FILES[0]),27);
    std::fs::create_dir_all(root.join("documents")).unwrap();
    std::fs::write(root.join("documents/synthetic.pdf"),faa_test_pdf()).unwrap();
    let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
    for field in ["hash", "edition", "reference", "pages"] {
        let mut op = faa_test_operation();
        let copy = op.faa_reference.as_mut().unwrap();
        match field {
            "hash" => copy.content_sha256 = "g".repeat(64),
            "edition" => copy.edition = "x".repeat(201),
            "reference" => copy.reference_id = "other".into(),
            _ => copy.total_pages = 0,
        }
        assert!(crate::documents::save_material_operation_at(&root,&op).is_err());
        assert_eq!(m3_count(&conn,"SELECT COUNT(*) FROM study_materials",&[]).unwrap(),0);
        assert_eq!(m3_count(&conn,"SELECT COUNT(*) FROM faa_reference_copies",&[]).unwrap(),0);
    }
    crate::documents::save_material_operation_at(&root,&faa_test_operation()).unwrap();
    assert_eq!(m3_count(&conn,"SELECT COUNT(*) FROM faa_reference_copies",&[]).unwrap(),1);
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn faa_verifier_refuses_missing_table_drift_corruption_and_newer_schema() {
    for edit in ["missing", "hash-check", "default", "foreign-key", "hash-row", "newer"] {
        let root = scratch("faa-corrupt");
        let backups = scratch("faa-corrupt-archive");
        pdf_kit_test_database(&root.join(DB_FILES[0]),27);
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        match edit {
            "missing" => conn.execute_batch("DROP TABLE faa_reference_copies").unwrap(),
            "hash-check" | "default" | "foreign-key" => {
                conn.execute_batch("DROP TABLE faa_reference_copies").unwrap();
                let sql = include_str!("../migrations/0027_faa_reference_copies.sql");
                let changed = match edit {
                    "hash-check" => sql.replace("content_sha256 NOT GLOB '*[^0-9a-f]*'","1"),
                    "default" => sql.replace("DEFAULT ''","DEFAULT 'changed'"),
                    _ => sql.replace("ON DELETE CASCADE","ON DELETE NO ACTION"),
                };
                conn.execute_batch(&changed).unwrap();
            },
            "hash-row" => conn.execute_batch(&format!("PRAGMA ignore_check_constraints=ON; INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('faa','Synthetic','x','x'); INSERT INTO faa_reference_copies VALUES ('faa','phak','','{}',1,'x'); PRAGMA ignore_check_constraints=OFF", "g".repeat(64))).unwrap(),
            _ => { conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)",[crate::CURRENT_SCHEMA_VERSION+1]).unwrap(); },
        }
        assert!(verify_application_connection(&conn).is_err(),"accepted {edit}");
        assert!(create_consistent_complete_backup_with_retry(&root,&backups.join("bad.hfdbackup"),"0.6.0").is_err(),"backed up {edit}");
        drop(conn);
        for path in [root,backups] { std::fs::remove_dir_all(path).unwrap(); }
    }
}

#[test]
fn faa_restore_rejects_pdf_tampering_even_with_rebound_archive_integrity() {
    let root = scratch("faa-hash-source");
    let target = scratch("faa-hash-target");
    let backups = scratch("faa-hash-archive");
    pdf_kit_test_database(&root.join(DB_FILES[0]), 27);
    std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
    let bytes = faa_test_pdf();
    std::fs::write(root.join(DOCUMENTS_DIR).join("synthetic.pdf"), &bytes).unwrap();
    let mut op = faa_test_operation();
    op.faa_reference.as_mut().unwrap().content_sha256 = sha256_digest(&bytes);
    crate::documents::save_material_operation_at(&root, &op).unwrap();
    let archive = backups.join("faa.hfdbackup");
    create_consistent_complete_backup_with_retry(&root, &archive, "0.6.2").unwrap();
    // Matching bytes pass the actual restore verifier.
    stage_complete_restore_in(&target, &archive, "0.6.2").unwrap();
    apply_pending_restore_in(&target).unwrap();
    let mut tampered = bytes.clone();
    tampered.extend_from_slice(b"\n% changed synthetic PDF bytes\n");
    rewrite_entry(&archive, "documents/synthetic.pdf", &tampered);
    let mut integrity: CompleteBackupIntegrity = {
        let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        serde_json::from_reader(zip.by_name(ARCHIVE_INTEGRITY).unwrap()).unwrap()
    };
    let entry = integrity.files.iter_mut().find(|e| e.path == "documents/synthetic.pdf").unwrap();
    entry.bytes = tampered.len() as u64;
    entry.sha256 = sha256_digest(&tampered);
    rewrite_entry(&archive, ARCHIVE_INTEGRITY, &serde_json::to_vec(&integrity).unwrap());
    let error = stage_complete_restore_in(&target, &archive, "0.6.2").unwrap_err();
    assert!(error.contains("FAA reference PDF"), "{error}");
    assert_eq!(std::fs::read(target.join(DOCUMENTS_DIR).join("synthetic.pdf")).unwrap(), bytes);
    for path in [root, target, backups] { std::fs::remove_dir_all(path).unwrap(); }
}

fn faa_saved_copy(root: &Path) -> Vec<u8> {
    pdf_kit_test_database(&root.join(DB_FILES[0]), 27);
    std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
    let bytes = faa_test_pdf();
    std::fs::write(root.join(DOCUMENTS_DIR).join("synthetic.pdf"), &bytes).unwrap();
    let mut op = faa_test_operation();
    op.faa_reference.as_mut().unwrap().content_sha256 = sha256_digest(&bytes);
    crate::documents::save_material_operation_at(root, &op).unwrap();
    bytes
}

#[test]
fn faa_material_file_cannot_be_replaced_or_removed_but_metadata_edits_stay() {
    let root = scratch("faa-lock");
    faa_saved_copy(&root);
    let mut other = faa_test_pdf();
    other.extend_from_slice(b"\n% another synthetic PDF\n");
    std::fs::write(root.join(DOCUMENTS_DIR).join("other.pdf"), &other).unwrap();
    for file in [serde_json::Value::Null, serde_json::json!("other.pdf")] {
        let op: crate::documents::MaterialSaveOperation = serde_json::from_value(serde_json::json!({"mode":"update","id":"faa","fields":{"filePath":file,"originalFileName":null,"fileSize":null}})).unwrap();
        assert_eq!(crate::documents::save_material_operation_at(&root, &op).unwrap_err(), crate::documents::FAA_FILE_LOCKED);
    }
    let op: crate::documents::MaterialSaveOperation = serde_json::from_value(serde_json::json!({"mode":"update","id":"faa","fields":{"title":"My ACS","notes":"Area I","filePath":"synthetic.pdf"}})).unwrap();
    crate::documents::save_material_operation_at(&root, &op).unwrap();
    let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
    let row: (String, Option<String>) = conn.query_row("SELECT title,file_path FROM study_materials WHERE id='faa'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(row, ("My ACS".into(), Some("synthetic.pdf".into())));
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn faa_copy_already_swapped_or_removed_still_backs_up_and_restores() {
    for state in ["removed", "replaced"] {
        let root = scratch("faa-broken");
        let target = scratch("faa-broken-target");
        let backups = scratch("faa-broken-archive");
        faa_saved_copy(&root);
        let mut other = faa_test_pdf();
        other.extend_from_slice(b"\n% another synthetic PDF\n");
        // The state a 0.6.1/0.6.2 "Remove" or "Choose file" left behind.
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("synthetic.pdf")).unwrap();
        if state == "removed" {
            conn.execute("UPDATE study_materials SET file_path=NULL, original_file_name=NULL, file_size=NULL WHERE id='faa'", []).unwrap();
        } else {
            std::fs::write(root.join(DOCUMENTS_DIR).join("other.pdf"), &other).unwrap();
            conn.execute("UPDATE study_materials SET file_path='other.pdf' WHERE id='faa'", []).unwrap();
        }
        let archive = backups.join("broken.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.6.3").unwrap();
        assert_eq!(info.unavailable_references, 1, "{state}");
        assert_eq!(inspect_archive(&target, &archive, "0.6.3").unwrap().unavailable_references, 1, "{state}");
        let manifest: CompleteBackupManifest = {
            let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
            serde_json::from_reader(zip.by_name(ARCHIVE_MANIFEST).unwrap()).unwrap()
        };
        assert_eq!(manifest.detached_at_export, if state == "replaced" { vec!["other.pdf".to_string()] } else { vec![] });
        stage_complete_restore_in(&target, &archive, "0.6.3").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let restored = Connection::open(target.join(DB_FILES[0])).unwrap();
        verify_application_connection(&restored).unwrap();
        assert_eq!(m3_count(&restored, "SELECT COUNT(*) FROM faa_reference_copies", &[]).unwrap(), 1);
        if state == "replaced" {
            assert_eq!(std::fs::read(target.join(DOCUMENTS_DIR).join("other.pdf")).unwrap(), other);
            // Only the declared file may differ: dropping the declaration makes
            // the same archive a refused, damaged one.
            let mut undeclared = manifest;
            undeclared.detached_at_export.clear();
            rewrite_entry(&archive, ARCHIVE_MANIFEST, &serde_json::to_vec(&undeclared).unwrap());
            let fresh = scratch("faa-broken-fresh");
            let error = stage_complete_restore_in(&fresh, &archive, "0.6.3").unwrap_err();
            assert!(error.contains("FAA reference PDF"), "{error}");
            let _ = std::fs::remove_dir_all(fresh);
        }
        drop(conn);
        drop(restored);
        for path in [root, target, backups] { let _ = std::fs::remove_dir_all(path); }
    }
}

#[test]
fn faa_reattach_accepts_only_the_recorded_pdf() {
    let root = scratch("faa-reattach");
    let bytes = faa_saved_copy(&root);
    std::fs::remove_file(root.join(DOCUMENTS_DIR).join("synthetic.pdf")).unwrap();
    let mut other = bytes.clone();
    other.extend_from_slice(b"\n% another synthetic PDF\n");
    std::fs::write(root.join(DOCUMENTS_DIR).join("other.pdf"), &other).unwrap();
    assert_eq!(crate::documents::reattach_unlinked_file_in(&root, "faa", "other.pdf").unwrap_err(), crate::documents::FAA_FILE_LOCKED);
    std::fs::write(root.join(DOCUMENTS_DIR).join("moved.pdf"), &bytes).unwrap();
    crate::documents::reattach_unlinked_file_in(&root, "faa", "moved.pdf").unwrap();
    let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
    assert_eq!(conn.query_row("SELECT file_path FROM study_materials WHERE id='faa'", [], |r| r.get::<_, String>(0)).unwrap(), "moved.pdf");
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
