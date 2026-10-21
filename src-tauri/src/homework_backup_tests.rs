// Included inside backup::tests to exercise the actual private restore ladder.
use serde_json::{json, Value};
fn homework_contract() -> Value {
    serde_json::from_str(include_str!("../fixtures/homework-validation/cases.json")).unwrap()
}
fn homework_operation(name: &str) -> Value {
    homework_contract()["operations"][name].clone()
}
fn homework_seed(conn: &Connection) {
    for sql in homework_contract()["baseline"].as_array().unwrap() {
        conn.execute_batch(sql.as_str().unwrap()).unwrap();
    }
}
fn homework_dump(conn: &Connection) -> std::collections::BTreeMap<String, Vec<M3Row>> {
    crate::homework::rows(conn,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",&[]).unwrap().iter()
        .map(|r| { let name=r["name"].as_str().unwrap(); (name.to_string(),m3_rows(conn,&format!("SELECT * FROM \"{name}\" ORDER BY rowid"),&[]).unwrap()) }).collect()
}
#[test]
fn shared_homework_validation_contract_native_outcomes() {
    let contract = homework_contract();
    let mut mismatches = Vec::new();
    for case in contract["cases"].as_array().unwrap() {
        let root = scratch("hw-contract");
        let path = root.join(DB_FILES[0]);
        pdf_kit_test_database(&path, 20);
        {
            let conn = Connection::open(&path).unwrap();
            homework_seed(&conn);
            for sql in case["sql"].as_array().unwrap() {
                conn.execute_batch(sql.as_str().unwrap()).unwrap();
            }
        }
        let conn = Connection::open(&path).unwrap();
        let result = verify_schema_20_homework_semantics(&conn);
        assert_eq!(
            verify_application_database(&path).is_ok(),
            result.is_ok(),
            "startup: {}",
            case["name"]
        );
        if result.is_ok() != (case["expect"] == "accept") {
            mismatches.push(format!("{}: {result:?}", case["name"]));
        }
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}
fn homework_scenario(name: &str) {
    let root = scratch(name);
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    homework_seed(&conn);
    let create = homework_operation("create");
    if name == "rollback" {
        let before = homework_dump(&conn);
        conn.execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON homework_activities WHEN NEW.id='00000000-0000-4000-8000-000000000003' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").unwrap();
        assert!(crate::homework::execute_homework(&mut conn, &create).is_err());
        assert_eq!(homework_dump(&conn), before);
    } else {
        let initial = if name == "empty" {
            homework_operation("empty")
        } else {
            create.clone()
        };
        let result = crate::homework::execute_homework(&mut conn, &initial).unwrap();
        match name {
            "retry" => {
                crate::homework::execute_homework(&mut conn, &homework_operation("edit")).unwrap();
                let before = homework_dump(&conn);
                assert_eq!(
                    crate::homework::execute_homework(&mut conn, &create).unwrap(),
                    result
                );
                assert_eq!(homework_dump(&conn), before);
            }
            "conflict" => {
                let mut changed = create.clone();
                changed["next"]["assignment"]["title"] = json!("Changed");
                let before = homework_dump(&conn);
                let e = crate::homework::execute_homework(&mut conn, &changed).unwrap_err();
                assert_eq!(serde_json::to_value(e).unwrap()["code"], "CONFLICT");
                assert_eq!(homework_dump(&conn), before);
            }
            "deleted" => {
                crate::homework::execute_homework(&mut conn, &homework_operation("complete"))
                    .unwrap();
                let before = m3_rows(
                    &conn,
                    "SELECT * FROM homework_history ORDER BY revision",
                    &[],
                )
                .unwrap();
                conn.execute_batch("DELETE FROM study_materials").unwrap();
                assert_eq!(
                    m3_rows(
                        &conn,
                        "SELECT * FROM homework_history ORDER BY revision",
                        &[]
                    )
                    .unwrap(),
                    before
                );
                let r=crate::homework::rows(&conn,"SELECT material_id,source_material_id FROM homework_activities WHERE kind='read'",&[]).unwrap();
                assert!(r[0]["material_id"].is_null());
                assert!(!r[0]["source_material_id"].is_null());
                let mut archive = homework_operation("complete");
                archive["operationId"] = json!("00000000-0000-4000-8000-000000000095");
                archive["baseRevision"] = json!(2);
                archive["at"] = json!("2026-10-21T10:02:00.000Z");
                archive["changeKind"] = json!("archive");
                archive["next"]["assignment"]["revision"] = json!(3);
                archive["next"]["assignment"]["updated_at"] = archive["at"].clone();
                archive["next"]["assignment"]["archived"] = json!(1);
                for e in archive["next"]["activities"].as_array_mut().unwrap() {
                    e["record"]["material_id"] = Value::Null;
                }
                crate::homework::execute_homework(&mut conn, &archive).unwrap();
                assert_eq!(
                    m3_rows(
                        &conn,
                        "SELECT * FROM homework_history WHERE revision<=2 ORDER BY revision",
                        &[]
                    )
                    .unwrap(),
                    before
                );
            }
            "reorder" => {
                crate::homework::execute_homework(&mut conn, &homework_operation("complete"))
                    .unwrap();
                let mut reorder = homework_operation("complete");
                reorder["operationId"] = json!("00000000-0000-4000-8000-000000000094");
                reorder["baseRevision"] = json!(2);
                reorder["at"] = json!("2026-10-21T10:02:00.000Z");
                reorder["changeKind"] = json!("reorder");
                reorder["next"]["assignment"]["revision"] = json!(3);
                reorder["next"]["assignment"]["updated_at"] = reorder["at"].clone();
                let at = reorder["at"].clone();
                for (i, e) in reorder["next"]["activities"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .enumerate()
                {
                    e["record"]["position"] = json!(2 - i);
                    e["record"]["updated_at"] = at.clone();
                }
                let evidence: Vec<_> = homework_operation("complete")["next"]["activities"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| e["evidence"].clone())
                    .collect();
                crate::homework::execute_homework(&mut conn, &reorder).unwrap();
                let persisted = crate::homework::rows(
                    &conn,
                    "SELECT snapshot_json FROM homework_history WHERE revision=3",
                    &[],
                )
                .unwrap();
                let snapshot: Value =
                    serde_json::from_str(persisted[0]["snapshot_json"].as_str().unwrap()).unwrap();
                assert_eq!(
                    snapshot["activities"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|e| e["evidence"].clone())
                        .collect::<Vec<_>>(),
                    evidence
                );
                let r = crate::homework::rows(
                    &conn,
                    "SELECT id,cycle,revision FROM homework_activities ORDER BY position",
                    &[],
                )
                .unwrap();
                assert!(r[0]["id"].as_str().unwrap().ends_with("0004"));
                assert!(r.iter().all(|r| r["cycle"] == 1 && r["revision"] == 1));
            }
            "reopen" => {
                crate::homework::execute_homework(&mut conn, &homework_operation("complete"))
                    .unwrap();
                let before = m3_rows(
                    &conn,
                    "SELECT * FROM homework_history WHERE revision=2",
                    &[],
                )
                .unwrap();
                crate::homework::execute_homework(&mut conn, &homework_operation("reopen"))
                    .unwrap();
                assert_eq!(
                    m3_rows(
                        &conn,
                        "SELECT * FROM homework_history WHERE revision=2",
                        &[]
                    )
                    .unwrap(),
                    before
                );
                assert_eq!(
                    crate::homework::rows(
                        &conn,
                        "SELECT cycle FROM homework_activities ORDER BY id",
                        &[]
                    )
                    .unwrap()[0]["cycle"],
                    2
                );
            }
            "add_completed" => {
                crate::homework::execute_homework(&mut conn, &homework_operation("complete")).unwrap();
                let before = m3_rows(&conn, "SELECT * FROM homework_history ORDER BY revision", &[]).unwrap();
                let evidence = crate::homework::rows(&conn, "SELECT * FROM homework_activities ORDER BY id", &[]).unwrap();
                crate::homework::execute_homework(&mut conn, &homework_operation("add_to_completed")).unwrap();
                assert_eq!(crate::homework::rows(&conn, "SELECT state,completed_at FROM homework_assignments", &[]).unwrap(), json!([{"state":"in_progress","completed_at":null}]).as_array().unwrap().clone());
                assert_eq!(&crate::homework::rows(&conn, "SELECT * FROM homework_activities ORDER BY id", &[]).unwrap()[..3], evidence);
                assert_eq!(m3_rows(&conn, "SELECT * FROM homework_history WHERE revision<=2 ORDER BY revision", &[]).unwrap(), before);
            }
            "empty" => {
                let mut op = homework_operation("complete");
                op["next"]["activities"] = json!([]);
                let before = homework_dump(&conn);
                assert!(crate::homework::execute_homework(&mut conn, &op).is_err());
                assert_eq!(homework_dump(&conn), before);
            }
            "history" => {
                assert!(conn
                    .execute_batch("UPDATE homework_history SET snapshot_json='{}'")
                    .is_err());
                assert!(conn.execute_batch("DELETE FROM homework_history").is_err());
            }
            _ => panic!("unknown scenario"),
        }
    }
    verify_schema_20_homework_semantics(&conn).unwrap();
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn homework_rollback_midwrite_leaves_nothing() {
    homework_scenario("rollback");
}
#[test]
fn homework_retry_same_operation_returns_original() {
    homework_scenario("retry");
}
#[test]
fn homework_changed_payload_same_operation_refused() {
    homework_scenario("conflict");
}
#[test]
fn homework_source_deleted_keeps_assignment_and_history() {
    homework_scenario("deleted");
}
#[test]
fn homework_reorder_keeps_ids_and_evidence() {
    homework_scenario("reorder");
}
#[test]
fn homework_reopen_preserves_prior_cycle_completion() {
    homework_scenario("reopen");
}
#[test]
fn homework_empty_assignment_never_completes() {
    homework_scenario("empty");
}
#[test]
fn homework_history_append_only() {
    homework_scenario("history");
}
#[test]
fn homework_two_connections_one_winner_one_stale() {
    let root = scratch("hw-race");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    {
        let mut conn = Connection::open(&path).unwrap();
        homework_seed(&conn);
        crate::homework::execute_homework(&mut conn, &homework_operation("create")).unwrap();
    }
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let workers: Vec<_> = (0..2)
        .map(|i| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut conn = Connection::open(path).unwrap();
                conn.busy_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                conn.pragma_update(None, "foreign_keys", "ON").unwrap();
                let mut op = homework_operation("edit");
                if i == 1 {
                    op["operationId"] = json!("00000000-0000-4000-8000-000000000090");
                    op["next"]["assignment"]["title"] = json!("Other window");
                }
                barrier.wait();
                crate::homework::execute_homework(&mut conn, &op)
            })
        })
        .collect();
    barrier.wait();
    let outcomes: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    assert_eq!(outcomes.iter().filter(|o| o.is_ok()).count(), 1);
    let e = outcomes.into_iter().find_map(Result::err).unwrap();
    assert_eq!(serde_json::to_value(e).unwrap()["code"], "STALE");
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn schema_19_archive_upgrades_to_20() {
    let root = scratch("hw19");
    let target = scratch("hw19-target");
    let backup = scratch("hw19-backup");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 19);
    let before = {
        let conn = Connection::open(&path).unwrap();
        homework_seed(&conn);
        homework_dump(&conn)
    };
    let archive = backup.join("schema19.hfdbackup");
    create_consistent_complete_backup_with_retry(&root, &archive, "0.5.7").unwrap();
    stage_complete_restore_in(&target, &archive, "0.5.7").unwrap();
    apply_pending_restore_in(&target).unwrap();
    let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
    assert_eq!(homework_dump(&conn), before);
    for m in crate::migrations().into_iter().filter(|m| m.version > 19) {
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        conn.execute_batch(m.sql).unwrap();
        conn.execute("INSERT INTO _sqlx_migrations VALUES (?)", [m.version])
            .unwrap();
        conn.execute_batch("COMMIT").unwrap();
    }
    let after = homework_dump(&conn);
    for (table, rows) in before {
        if table != "_sqlx_migrations" {
            assert_eq!(after[&table], rows, "{table}");
        }
    }
    for table in [
        "homework_assignments",
        "homework_activities",
        "homework_runs",
        "homework_operations",
        "homework_history",
    ] {
        assert!(after[table].is_empty());
    }
    verify_application_connection(&conn).unwrap();
    drop(conn);
    verify_application_database(&target.join(DB_FILES[0])).unwrap();
    verify_application_database(&target.join(DB_FILES[0])).unwrap();
    for p in [root, target, backup] {
        std::fs::remove_dir_all(p).unwrap();
    }
}
#[test]
fn homework_interrupted_migration_rolls_back() {
    let root = scratch("hw-interrupted");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 19);
    let before = {
        let conn = Connection::open(&path).unwrap();
        homework_seed(&conn);
        homework_dump(&conn)
    };
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        conn.execute_batch(include_str!("../migrations/0020_homework.sql"))
            .unwrap();
        assert!(conn
            .execute_batch("INSERT INTO missing_table VALUES (1)")
            .is_err());
    }
    let conn = Connection::open(&path).unwrap();
    assert_eq!(homework_dump(&conn), before);
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn schema_20_homework_archive_round_trip() {
    let root = scratch("hw20");
    let target = scratch("hw20-target");
    let backup = scratch("hw20-backup");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    let before = {
        let mut conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        homework_seed(&conn);
        for key in ["create", "complete", "reopen"] {
            crate::homework::execute_homework(&mut conn, &homework_operation(key)).unwrap();
        }
        conn.execute_batch("DELETE FROM study_materials").unwrap();
        homework_dump(&conn)
    };
    let archive = backup.join("schema20.hfdbackup");
    create_consistent_complete_backup_with_retry(&root, &archive, "0.5.7").unwrap();
    stage_complete_restore_in(&target, &archive, "0.5.7").unwrap();
    apply_pending_restore_in(&target).unwrap();
    let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
    assert_eq!(homework_dump(&conn), before);
    verify_application_connection(&conn).unwrap();
    drop(conn);
    for p in [root, target, backup] {
        std::fs::remove_dir_all(p).unwrap();
    }
}
#[test]
fn tampered_schema_20_homework_archive_refused() {
    let root = scratch("hw20-tampered");
    let target = scratch("hw20-refused");
    let backup = scratch("hw20-backup");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    {
        let mut conn = Connection::open(&path).unwrap();
        homework_seed(&conn);
        crate::homework::execute_homework(&mut conn, &homework_operation("create")).unwrap();
    }
    let archive = backup.join("tampered.hfdbackup");
    create_consistent_complete_backup_with_retry(&root, &archive, "0.5.7").unwrap();
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("UPDATE homework_operations SET result_json='{}'")
            .unwrap();
    }
    let bytes = std::fs::read(&path).unwrap();
    rewrite_entry(&archive, DB_FILES[0], &bytes);
    let mut integrity: CompleteBackupIntegrity = {
        let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        serde_json::from_reader(zip.by_name(ARCHIVE_INTEGRITY).unwrap()).unwrap()
    };
    let r = integrity
        .files
        .iter_mut()
        .find(|e| e.path == DB_FILES[0])
        .unwrap();
    r.bytes = bytes.len() as u64;
    r.sha256 = sha256_digest(&bytes);
    rewrite_entry(
        &archive,
        ARCHIVE_INTEGRITY,
        &serde_json::to_vec(&integrity).unwrap(),
    );
    pdf_kit_test_database(&target.join(DB_FILES[0]), 19);
    let before = std::fs::read(target.join(DB_FILES[0])).unwrap();
    let error = stage_complete_restore_in(&target, &archive, "0.5.7").unwrap_err();
    assert!(!error.contains("integrity"), "{error}");
    assert_eq!(std::fs::read(target.join(DB_FILES[0])).unwrap(), before);
    assert!(!target.join(RESTORE_PENDING_DIR).exists());
    for p in [root, target, backup] {
        std::fs::remove_dir_all(p).unwrap();
    }
}
#[test]
fn older_app_rejects_schema_20_backup() {
    let root = scratch("hw20-old");
    let target = scratch("hw20-old-target");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    pdf_kit_test_database(&target.join(DB_FILES[0]), 19);
    let before = std::fs::read(target.join(DB_FILES[0])).unwrap();
    let source = std::fs::read(&path).unwrap();
    let backup = scratch("hw20-old-backup");
    let archive = backup.join("schema20.hfdbackup");
    create_consistent_complete_backup_with_retry(&root, &archive, "0.5.7").unwrap();
    // Extract the archive's actual payload, then run the pre-install verifier with the old ceiling.
    let payload = root.join("payload.db");
    {
        let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        let mut f = File::create(&payload).unwrap();
        std::io::copy(&mut zip.by_name(DB_FILES[0]).unwrap(), &mut f).unwrap();
    }
    let conn = Connection::open_with_flags(&payload, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let error = verify_application_connection_with_ceiling(&conn, 19).unwrap_err();
    assert!(error.contains("Update the app first"));
    drop(conn);
    assert_eq!(std::fs::read(&path).unwrap(), source);
    assert_eq!(std::fs::read(target.join(DB_FILES[0])).unwrap(), before);
    assert!(!target.join(RESTORE_PENDING_DIR).exists());
    for p in [root, target, backup] {
        std::fs::remove_dir_all(p).unwrap();
    }
}

#[test]
fn adding_activity_to_completed_assignment_reopens_it() {
    homework_scenario("add_completed");
}

#[test]
fn card_run_completes_only_with_all_frozen_items_rated_in_run() {
    let root = scratch("hw-cards");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    homework_seed(&conn);
    for sql in homework_contract()["card_seed"].as_array().unwrap() {
        conn.execute_batch(sql.as_str().unwrap()).unwrap();
    }
    crate::homework::execute_homework(&mut conn, &homework_operation("card_create")).unwrap();
    let start = homework_operation("card_start");
    crate::homework::execute_homework(&mut conn, &start).unwrap();
    let scope = &start["next"]["runs"][0]["scope"];
    for i in 0..2 {
        let request = json!({"action":"rate","operationId":format!("00000000-0000-4000-8000-{:012x}",220+i),"materialId":scope["material_id"],"versionContentHash":scope["source_revision"],"itemId":scope["item_ids"][i],"expectedGeneration":0,"expectedRevision":0,"rating":"again","homework":{"assignmentId":start["assignmentId"],"runId":start["next"]["runs"][0]["id"],"expectedRevision":2+i,"activityRevision":1,"cycle":1}});
        let action = crate::card_reviews::decode_card_action(&request).unwrap();
        let tx = conn.transaction().unwrap();
        crate::card_reviews::execute_card_review_transaction(&tx,&action,&request).unwrap();
        tx.commit().unwrap();
        let states=crate::homework::rows(&conn,"SELECT state FROM homework_activities",&[]).unwrap();
        assert_eq!(states[0]["state"],if i==0 {"in_progress"} else {"completed"});
        verify_schema_20_homework_semantics(&conn).unwrap();
    }
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

fn homework_card_action(start:&Value,index:usize,revision:i64)->Value {
    let scope=&start["next"]["runs"][0]["scope"];
    json!({"action":"rate","operationId":format!("00000000-0000-4000-8000-{:012x}",220+index),"materialId":scope["material_id"],"versionContentHash":scope["source_revision"],"itemId":scope["item_ids"][index],"expectedGeneration":0,"expectedRevision":0,"rating":"again","homework":{"assignmentId":start["assignmentId"],"runId":start["next"]["runs"][0]["id"],"expectedRevision":revision,"activityRevision":1,"cycle":1}})
}
fn homework_card_write(conn:&mut Connection,request:&Value)->Result<Value,crate::card_reviews::CardReviewErrorCode> {
    let action=crate::card_reviews::decode_card_action(request)?;
    let tx=conn.transaction().unwrap();
    let result=crate::card_reviews::execute_card_review_transaction(&tx,&action,request)?;
    tx.commit().unwrap();Ok(result)
}
fn homework_card_scenario(name:&str) {
    let root=scratch(name);let path=root.join(DB_FILES[0]);pdf_kit_test_database(&path,20);
    let mut conn=Connection::open(&path).unwrap();conn.pragma_update(None,"foreign_keys","ON").unwrap();homework_seed(&conn);
    for sql in homework_contract()["card_seed"].as_array().unwrap(){conn.execute_batch(sql.as_str().unwrap()).unwrap();}
    crate::homework::execute_homework(&mut conn,&homework_operation("card_create")).unwrap();
    let start=homework_operation("card_start");crate::homework::execute_homework(&mut conn,&start).unwrap();
    match name {
        "outside"=>{
            for i in 0..2 {let mut request=homework_card_action(&start,i,2);request.as_object_mut().unwrap().remove("homework");homework_card_write(&mut conn,&request).unwrap();}
            assert_eq!(crate::homework::rows(&conn,"SELECT state FROM homework_activities",&[]).unwrap()[0]["state"],"in_progress");
            assert_eq!(crate::homework::rows(&conn,"SELECT COUNT(*) AS n FROM homework_history",&[]).unwrap()[0]["n"],2);
        }
        "reset"|"drift"|"restart"=>{
            homework_card_write(&mut conn,&homework_card_action(&start,0,2)).unwrap();
            if name=="restart" {
                drop(conn);conn=Connection::open(&path).unwrap();conn.pragma_update(None,"foreign_keys","ON").unwrap();
                let rows=crate::homework::rows(&conn,"SELECT snapshot_json FROM homework_history ORDER BY revision DESC LIMIT 1",&[]).unwrap();
                let saved:Value=serde_json::from_str(rows[0]["snapshot_json"].as_str().unwrap()).unwrap();
                assert_eq!(saved["runs"][0]["scope"],start["next"]["runs"][0]["scope"]);assert_eq!(saved["runs"][0]["ratings"].as_array().unwrap().len(),1);
                homework_card_write(&mut conn,&homework_card_action(&start,1,3)).unwrap();
            }else{
                if name=="reset" {
                    homework_card_write(&mut conn,&json!({"action":"reset","operationId":"00000000-0000-4000-8000-0000000000ef","materialId":start["next"]["runs"][0]["scope"]["material_id"],"expectedGeneration":0})).unwrap();
                }else{
                    let rows=crate::homework::rows(&conn,"SELECT * FROM ai_study_sets",&[]).unwrap();let row=&rows[0];
                    let expected:serde_json::Map<String,Value>=crate::study_sets::SET_COLUMNS.iter().map(|k|(k.to_string(),row[k].clone())).collect();
                    let op=crate::study_sets::decode_operation(&json!({"operationId":"00000000-0000-4000-8000-0000000000ef","materialId":row["source_material_id"],"reason":"edit","expected":expected,"next":{"title":"Changed","summary":"","summaryOrigin":null,"sections":[],"flashcards":[{"front":"New","back":"Changed","sourcePage":null}],"sourceNotes":"","provider":"import","model":"","retired":[]}})).unwrap();
                    let at=crate::practice_sessions::db_now_iso(&conn).unwrap();crate::study_sets::save_on(&mut conn,&op,&at).unwrap();
                }
                let rows=crate::homework::rows(&conn,"SELECT invalidated_at FROM homework_runs",&[]).unwrap();assert!(!rows[0]["invalidated_at"].is_null());
                assert_eq!(crate::homework::rows(&conn,"SELECT cycle FROM homework_activities",&[]).unwrap()[0]["cycle"],2);
            }
        }
        "stale"=>{
            let mut reopen=start.clone();reopen["operationId"]=json!("00000000-0000-4000-8000-0000000000ee");reopen["baseRevision"]=json!(2);reopen["changeKind"]=json!("reopen");reopen["at"]=json!("2026-10-21T10:02:00.000Z");
            reopen["next"]["assignment"]["revision"]=json!(3);reopen["next"]["assignment"]["updated_at"]=reopen["at"].clone();reopen["next"]["assignment"]["state"]=json!("reopened");
            reopen["next"]["activities"][0]["record"]["cycle"]=json!(2);reopen["next"]["activities"][0]["record"]["state"]=json!("reopened");reopen["next"]["activities"][0]["record"]["updated_at"]=reopen["at"].clone();reopen["next"]["runs"][0]["invalidated_at"]=reopen["at"].clone();
            crate::homework::execute_homework(&mut conn,&reopen).unwrap();let before=homework_dump(&conn);
            assert!(homework_card_write(&mut conn,&homework_card_action(&start,0,2)).is_err());assert_eq!(homework_dump(&conn),before);
        }
        "rating_rollback"=>{
            conn.execute_batch("CREATE TRIGGER reject_evidence BEFORE INSERT ON homework_history WHEN NEW.change_kind='record_evidence' BEGIN SELECT RAISE(ABORT,'synthetic'); END").unwrap();
            let before=homework_dump(&conn);assert!(homework_card_write(&mut conn,&homework_card_action(&start,0,2)).is_err());assert_eq!(homework_dump(&conn),before);
        }
        _=>panic!("unknown card scenario")
    }
    verify_schema_20_homework_semantics(&conn).unwrap();drop(conn);verify_application_database(&path).unwrap();std::fs::remove_dir_all(root).unwrap();
}
#[test] fn ratings_elsewhere_never_complete_homework(){homework_card_scenario("outside");}
#[test] fn card_run_reset_or_drift_invalidates(){homework_card_scenario("reset");homework_card_scenario("drift");}
#[test] fn card_run_restart_resumes_frozen_queue(){homework_card_scenario("restart");}
#[test] fn stale_callback_after_reopen_refused(){homework_card_scenario("stale");}
#[test] fn homework_rating_and_evidence_roll_back_together(){homework_card_scenario("rating_rollback");}
#[test]
fn backup_round_trip_keeps_card_runs_and_evidence() {
    let root=scratch("hw-cards-backup");let target=scratch("hw-cards-target");let archive_root=scratch("hw-cards-archive");let path=root.join(DB_FILES[0]);pdf_kit_test_database(&path,20);
    let before={
        let conn=Connection::open(&path).unwrap();conn.pragma_update(None,"foreign_keys","ON").unwrap();homework_seed(&conn);
        let contract=homework_contract();let case=contract["cases"].as_array().unwrap().iter().find(|c|c["name"]=="detached card evidence keeps accepted event associations").unwrap();
        for sql in case["sql"].as_array().unwrap(){conn.execute_batch(sql.as_str().unwrap()).unwrap();}homework_dump(&conn)
    };
    let archive=archive_root.join("cards.hfdbackup");create_consistent_complete_backup_with_retry(&root,&archive,"0.5.7").unwrap();stage_complete_restore_in(&target,&archive,"0.5.7").unwrap();apply_pending_restore_in(&target).unwrap();
    let conn=Connection::open(target.join(DB_FILES[0])).unwrap();assert_eq!(homework_dump(&conn),before);verify_application_connection(&conn).unwrap();drop(conn);
    for p in [root,target,archive_root]{std::fs::remove_dir_all(p).unwrap();}
}
