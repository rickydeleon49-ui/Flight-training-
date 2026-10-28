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
