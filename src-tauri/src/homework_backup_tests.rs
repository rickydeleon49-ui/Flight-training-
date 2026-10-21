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
                conn.execute_batch(sql.as_str().unwrap())
                    .unwrap_or_else(|e| panic!("{}: {e}", case["name"]));
            }
        }
        let conn = Connection::open(&path).unwrap();
        let result = verify_schema_20_homework_semantics(&conn);
        let startup = verify_application_database(&path);
        assert_eq!(
            startup.is_ok(),
            result.is_ok(),
            "startup: {} ({:?})",
            case["name"],
            startup.err()
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

// ---------- HW-01d part 2: quiz runs, their evidence and the bound next action (native driver) ----------
const HW_QUIZ_HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HW_QUIZ_T0: &str = "2026-10-21T10:00:00.000Z";
const HW_QUIZ_T1: &str = "2026-10-21T10:01:00.000Z";
const HW_QUIZ_T2: &str = "2026-10-21T10:02:00.000Z";
fn hw_id(n: u64) -> String { format!("00000000-0000-4000-8000-{n:012x}") }

fn hw_quiz_seed(conn: &Connection) {
    conn.execute(
        "INSERT INTO practice_test_versions (id,source_material_id,source_material_title,history_key,version_number,content_hash,is_active,created_at) VALUES (?1,?2,'Synthetic source',?2,1,?3,0,?4)",
        params![hw_id(20), hw_id(5), HW_QUIZ_HASH, HW_QUIZ_T0],
    ).unwrap();
    for i in 0..2u64 {
        conn.execute(
            "INSERT INTO practice_test_items (id,version_id,ordinal,question_text,options_json,correct_index,explanation,source_page) VALUES (?1,?2,?3,'Question','[\"A\",\"B\"]',0,'',NULL)",
            params![hw_id(21 + i), hw_id(20), i as i64],
        ).unwrap();
    }
}

fn hw_quiz_entry(position: u64, title: &str) -> Value {
    json!({"record":{"id":hw_id(2 + position),"assignment_id":hw_id(1),"position":position,"kind":"test","title":title,"body":"",
        "material_id":hw_id(5),"source_material_id":hw_id(5),"source_revision":HW_QUIZ_HASH,"card_set_id":null,
        "test_version_id":hw_id(20),"source_test_version_id":hw_id(20),"page_start":null,"page_end":null,
        "state":"upcoming","cycle":1,"revision":1,"created_at":HW_QUIZ_T0,"updated_at":HW_QUIZ_T0,"completed_at":null,"removed_at":null},
        "source":{"title":"Synthetic source","total_pages":null},"evidence":null})
}

fn hw_quiz_run(run: u64, activity: u64, attempt: u64, started: &str) -> Value {
    json!({"id":hw_id(run),"activity_id":hw_id(activity),"cycle":1,"activity_revision":1,"kind":"test",
        "started_at":started,"finished_at":null,"invalidated_at":null,"evidence":null,
        "scope":{"version":1,"material_id":hw_id(5),"source_revision":HW_QUIZ_HASH,"test_version_id":hw_id(20),"attempt_id":hw_id(attempt)}})
}

fn hw_quiz_create(entries: &[Value], action: bool) -> Value {
    let mut create = homework_operation("create");
    create["next"]["activities"] = Value::Array(entries.to_vec());
    if action {
        create["next"]["assignment"]["action_id"] = json!(hw_id(50));
        create["next"]["assignment"]["due_date"] = json!("2026-10-25");
    }
    create
}

fn hw_quiz_start(create: &Value, runs: &[Value]) -> Value {
    let mut op = create.clone();
    op["operationId"] = json!(hw_id(101));
    op["baseRevision"] = json!(1);
    op["changeKind"] = json!("start");
    op["at"] = json!(HW_QUIZ_T1);
    op["next"]["assignment"]["revision"] = json!(2);
    op["next"]["assignment"]["state"] = json!("in_progress");
    op["next"]["assignment"]["updated_at"] = json!(HW_QUIZ_T1);
    op["next"]["runs"] = Value::Array(runs.to_vec());
    let started_activity = runs[0]["activity_id"].clone();
    for e in op["next"]["activities"].as_array_mut().unwrap() {
        if e["record"]["id"] == started_activity {
            e["record"]["state"] = json!("in_progress");
            e["record"]["updated_at"] = json!(HW_QUIZ_T1);
        }
    }
    op
}

fn hw_snapshot(conn: &Connection) -> Value {
    let rows = crate::homework::rows(
        conn,
        "SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1",
        &[&hw_id(1)],
    ).unwrap();
    serde_json::from_str(rows[0]["snapshot_json"].as_str().unwrap()).unwrap()
}

fn hw_operation(snapshot: &Value, change: &str, operation_id: &str, at: &str) -> Value {
    json!({"version":1,"operationId":operation_id,"assignmentId":snapshot["assignment"]["id"],
        "baseRevision":snapshot["assignment"]["revision"],"changeKind":change,"at":at,"next":snapshot.clone()})
}

fn hw_context(run: &str, revision: i64, cycle: i64, activity_revision: i64) -> Value {
    json!({"assignmentId":hw_id(1),"runId":run,"expectedRevision":revision,"activityRevision":activity_revision,"cycle":cycle})
}

fn hw_session(conn: &mut Connection, request: &Value) -> Result<Value, crate::practice_sessions::PracticeSessionErrorCode> {
    let action = crate::practice_sessions::decode_practice_action(request)?;
    let tx = conn.transaction().unwrap();
    let result = crate::practice_sessions::execute_action_transaction(&tx, &action, request)?;
    tx.commit().unwrap();
    Ok(result)
}

fn hw_answer(conn: &mut Connection, attempt: &str, revision: i64, base: u64) -> i64 {
    for i in 0..2u64 {
        hw_session(conn, &json!({"action":"record_response","operationId":hw_id(base + i),"attemptId":attempt,
            "itemId":hw_id(21 + i),"expectedRevision":revision + i as i64,"selectedIndex":0,"isDontKnow":false})).unwrap();
    }
    revision + 2
}

fn hw_complete(conn: &mut Connection, attempt: &str, revision: i64, homework: Option<&Value>) -> Result<Value, crate::practice_sessions::PracticeSessionErrorCode> {
    let mut request = json!({"action":"complete_attempt","operationId":hw_id(203),"attemptId":attempt,"expectedRevision":revision});
    if let Some(context) = homework { request["homework"] = context.clone(); }
    hw_session(conn, &request)
}

fn hw_quiz_database(label: &str) -> (std::path::PathBuf, Connection) {
    let root = scratch(label);
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    homework_seed(&conn);
    hw_quiz_seed(&conn);
    (root, conn)
}

#[test]
fn test_run_creates_new_attempt_atomically_never_adopts() {
    let (root, mut conn) = hw_quiz_database("hw-quiz-atomic");
    let path = root.join(DB_FILES[0]);
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity"), hw_quiz_entry(1, "Second quiz")], false);
    crate::homework::execute_homework(&mut conn, &create).unwrap();

    // The run and its attempt are one transaction: a failed attempt insert leaves no run behind.
    conn.execute_batch("CREATE TRIGGER fail_attempt BEFORE INSERT ON practice_attempts BEGIN SELECT RAISE(ABORT,'synthetic'); END").unwrap();
    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    let before = homework_dump(&conn);
    assert!(crate::homework::execute_homework(&mut conn, &start).is_err());
    assert_eq!(homework_dump(&conn), before);
    conn.execute_batch("DROP TRIGGER fail_attempt").unwrap();

    crate::homework::execute_homework(&mut conn, &start).unwrap();
    assert_eq!(
        crate::homework::rows(&conn, "SELECT kind,attempt_id,source_attempt_id,started_at,finished_at,evidence_json FROM homework_runs WHERE id=?", &[&hw_id(111)]).unwrap()[0],
        json!({"kind":"test","attempt_id":hw_id(30),"source_attempt_id":hw_id(30),"started_at":HW_QUIZ_T1,"finished_at":null,"evidence_json":null})
    );
    assert_eq!(
        json!(crate::homework::rows(&conn, "SELECT id,version_id,source_material_id,started_at,status,total_questions,revision FROM practice_attempts", &[]).unwrap()),
        json!([{"id":hw_id(30),"version_id":hw_id(20),"source_material_id":hw_id(5),"started_at":HW_QUIZ_T1,"status":"in_progress","total_questions":2,"revision":0}])
    );
    verify_schema_20_homework_semantics(&conn).unwrap();

    // Another quiz on the same source cannot start while that attempt is in progress, and it never adopts it.
    let mut second = start.clone();
    second["operationId"] = json!(hw_id(102));
    second["baseRevision"] = json!(2);
    second["next"]["assignment"]["revision"] = json!(3);
    second["next"]["activities"][1]["record"]["state"] = json!("in_progress");
    second["next"]["activities"][1]["record"]["updated_at"] = json!(HW_QUIZ_T1);
    let mut runs = second["next"]["runs"].as_array().unwrap().clone();
    runs.push(hw_quiz_run(112, 3, 31, HW_QUIZ_T1));
    second["next"]["runs"] = Value::Array(runs);
    let before = homework_dump(&conn);
    let refused = crate::homework::execute_homework(&mut conn, &second).unwrap_err();
    assert_eq!(serde_json::to_value(refused).unwrap()["code"], "CONFLICT");
    assert_eq!(homework_dump(&conn), before);
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM practice_attempts", &[]).unwrap()[0]["n"], json!(1));
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM homework_runs", &[]).unwrap()[0]["n"], json!(1));
    verify_schema_20_homework_semantics(&conn).unwrap();
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pre_existing_or_abandoned_attempt_never_counts() {
    let (root, mut conn) = hw_quiz_database("hw-quiz-not-evidence");
    let path = root.join(DB_FILES[0]);
    let activity = |conn: &Connection| crate::homework::rows(conn, "SELECT state,completed_at FROM homework_activities WHERE id=?", &[&hw_id(2)]).unwrap()[0].clone();
    let actions = |conn: &Connection| json!(crate::homework::rows(conn, "SELECT id,status,completed_at FROM next_actions ORDER BY id", &[]).unwrap());

    // An attempt that started before the activity existed is finished first.
    conn.execute(
        "INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,completed_at,status,revision,total_questions,answered_count,correct_count,incorrect_count,dont_know_count,score_percent) VALUES (?1,?2,?3,'Synthetic source','2026-10-21T09:00:00.000Z',NULL,'in_progress',0,2,0,0,0,0,NULL)",
        params![hw_id(29), hw_id(20), hw_id(5)],
    ).unwrap();
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);
    crate::homework::execute_homework(&mut conn, &create).unwrap();
    let revision = hw_answer(&mut conn, &hw_id(29), 0, 201);
    hw_complete(&mut conn, &hw_id(29), revision, None).unwrap();
    assert_eq!(activity(&conn), json!({"state":"upcoming","completed_at":null}));
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM homework_history", &[]).unwrap()[0]["n"], json!(1));
    assert_eq!(actions(&conn), json!([{"id":hw_id(50),"status":"open","completed_at":null}]));

    // Starting the run writes its own attempt instead of adopting that one.
    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM practice_attempts WHERE id=?", &[&hw_id(30)]).unwrap()[0]["n"], json!(1));

    // Abandoning the run's attempt never completes the activity.
    let revision = hw_answer(&mut conn, &hw_id(30), 0, 211);
    hw_session(&mut conn, &json!({"action":"abandon_attempt","operationId":hw_id(204),"attemptId":hw_id(30),"expectedRevision":revision})).unwrap();
    assert_eq!(activity(&conn), json!({"state":"in_progress","completed_at":null}));
    assert_eq!(crate::homework::rows(&conn, "SELECT finished_at,evidence_json FROM homework_runs WHERE id=?", &[&hw_id(111)]).unwrap()[0], json!({"finished_at":null,"evidence_json":null}));
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM homework_history", &[]).unwrap()[0]["n"], json!(2));
    assert_eq!(actions(&conn), json!([{"id":hw_id(50),"status":"open","completed_at":null}]));
    verify_schema_20_homework_semantics(&conn).unwrap();
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn one_action_per_assignment_projected_atomically() {
    let (root, mut conn) = hw_quiz_database("hw-quiz-action");
    let path = root.join(DB_FILES[0]);
    let actions = |conn: &Connection| json!(crate::homework::rows(conn, "SELECT id,title,category,status,due_date,completed_at FROM next_actions ORDER BY id", &[]).unwrap());
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);

    crate::homework::execute_homework(&mut conn, &create).unwrap();
    assert_eq!(actions(&conn), json!([{"id":hw_id(50),"title":"Quiz Activity","category":"prepare","status":"open","due_date":"2026-10-25","completed_at":null}]));

    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();
    assert_eq!(actions(&conn)[0]["status"], json!("open"));

    // Homework owns the projected fields: a generic completion by another writer is refused on verify.
    let before = homework_dump(&conn);
    conn.execute_batch(&format!("UPDATE next_actions SET status='completed', completed_at='{HW_QUIZ_T2}' WHERE id='{}'", hw_id(50))).unwrap();
    assert!(verify_schema_20_homework_semantics(&conn).is_err());
    conn.execute_batch(&format!("UPDATE next_actions SET status='open', completed_at=NULL WHERE id='{}'", hw_id(50))).unwrap();
    assert_eq!(homework_dump(&conn), before);

    // The attempt completing is what finishes the activity; the action keeps its id.
    let revision = hw_answer(&mut conn, &hw_id(30), 0, 201);
    hw_complete(&mut conn, &hw_id(30), revision, Some(&hw_context(&hw_id(111), 2, 1, 1))).unwrap();
    let done = actions(&conn);
    assert_eq!(done.as_array().unwrap().len(), 1);
    assert_eq!(done[0]["id"], json!(hw_id(50)));
    assert_eq!(done[0]["status"], json!("completed"));
    assert!(!done[0]["completed_at"].is_null());
    assert_eq!(crate::homework::rows(&conn, "SELECT state FROM homework_assignments", &[]).unwrap()[0]["state"], json!("completed"));

    // Archiving dismisses the same row rather than adding another.
    let at = crate::practice_sessions::db_now_iso(&conn).unwrap();
    let mut archive = hw_operation(&hw_snapshot(&conn), "archive", &hw_id(104), &at);
    archive["next"]["assignment"]["revision"] = json!(4);
    archive["next"]["assignment"]["archived"] = json!(1);
    archive["next"]["assignment"]["updated_at"] = json!(at);
    crate::homework::execute_homework(&mut conn, &archive).unwrap();
    let dismissed = actions(&conn);
    assert_eq!(dismissed.as_array().unwrap().len(), 1);
    assert_eq!(dismissed[0]["id"], json!(hw_id(50)));
    assert_eq!(dismissed[0]["status"], json!("dismissed"));
    verify_schema_20_homework_semantics(&conn).unwrap();
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_test_callback_after_reopen_refused() {
    let (root, mut conn) = hw_quiz_database("hw-quiz-stale");
    let path = root.join(DB_FILES[0]);
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);
    crate::homework::execute_homework(&mut conn, &create).unwrap();
    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();

    let mut reopen = hw_operation(&hw_snapshot(&conn), "reopen", &hw_id(105), HW_QUIZ_T2);
    reopen["next"]["assignment"]["revision"] = json!(3);
    reopen["next"]["assignment"]["state"] = json!("reopened");
    reopen["next"]["assignment"]["updated_at"] = json!(HW_QUIZ_T2);
    reopen["next"]["activities"][0]["record"]["cycle"] = json!(2);
    reopen["next"]["activities"][0]["record"]["state"] = json!("reopened");
    reopen["next"]["activities"][0]["record"]["updated_at"] = json!(HW_QUIZ_T2);
    reopen["next"]["runs"][0]["invalidated_at"] = json!(HW_QUIZ_T2);
    crate::homework::execute_homework(&mut conn, &reopen).unwrap();
    let before = homework_dump(&conn);

    // A callback naming the superseded revision is refused with nothing written.
    let refused = hw_complete(&mut conn, &hw_id(30), 0, Some(&hw_context(&hw_id(111), 2, 1, 1))).unwrap_err();
    assert_eq!(refused, crate::practice_sessions::PracticeSessionErrorCode::InvalidState);
    assert_eq!(homework_dump(&conn), before);
    // The current revision does not help either: the run itself is invalidated.
    let refused = hw_complete(&mut conn, &hw_id(30), 0, Some(&hw_context(&hw_id(111), 3, 1, 1))).unwrap_err();
    assert_eq!(refused, crate::practice_sessions::PracticeSessionErrorCode::InvalidState);
    assert_eq!(homework_dump(&conn), before);

    // A plain completion is allowed and still never counts.
    let revision = hw_answer(&mut conn, &hw_id(30), 0, 201);
    hw_complete(&mut conn, &hw_id(30), revision, None).unwrap();
    assert_eq!(crate::homework::rows(&conn, "SELECT state,cycle FROM homework_activities WHERE id=?", &[&hw_id(2)]).unwrap()[0], json!({"state":"reopened","cycle":2}));
    assert_eq!(crate::homework::rows(&conn, "SELECT finished_at,invalidated_at,evidence_json FROM homework_runs WHERE id=?", &[&hw_id(111)]).unwrap()[0], json!({"finished_at":null,"invalidated_at":HW_QUIZ_T2,"evidence_json":null}));
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM homework_history", &[]).unwrap()[0]["n"], json!(3));
    assert_eq!(crate::homework::rows(&conn, "SELECT status FROM next_actions WHERE id=?", &[&hw_id(50)]).unwrap()[0]["status"], json!("open"));
    verify_schema_20_homework_semantics(&conn).unwrap();
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn homework_test_completion_and_evidence_roll_back_together() {
    let (root, mut conn) = hw_quiz_database("hw-quiz-evidence-rollback");
    let path = root.join(DB_FILES[0]);
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);
    crate::homework::execute_homework(&mut conn, &create).unwrap();
    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();
    let revision = hw_answer(&mut conn, &hw_id(30), 0, 201);

    conn.execute_batch("CREATE TRIGGER reject_evidence BEFORE INSERT ON homework_history WHEN NEW.change_kind='record_evidence' BEGIN SELECT RAISE(ABORT,'synthetic'); END").unwrap();
    let before = homework_dump(&conn);
    let refused = hw_complete(&mut conn, &hw_id(30), revision, Some(&hw_context(&hw_id(111), 2, 1, 1))).unwrap_err();
    assert_eq!(refused, crate::practice_sessions::PracticeSessionErrorCode::StorageError);
    assert_eq!(homework_dump(&conn), before);
    conn.execute_batch("DROP TRIGGER reject_evidence").unwrap();

    hw_complete(&mut conn, &hw_id(30), revision, Some(&hw_context(&hw_id(111), 2, 1, 1))).unwrap();
    let rows = crate::homework::rows(&conn, "SELECT status,finished_at,evidence_json FROM practice_attempts JOIN homework_runs ON homework_runs.source_attempt_id=practice_attempts.id WHERE practice_attempts.id=?", &[&hw_id(30)]).unwrap();
    assert_eq!(rows[0]["status"], json!("completed"));
    assert!(!rows[0]["finished_at"].is_null());
    let evidence: Value = serde_json::from_str(rows[0]["evidence_json"].as_str().unwrap()).unwrap();
    assert_eq!(evidence["attempt_id"], json!(hw_id(30)));
    assert_eq!(evidence["total_questions"], json!(2));
    assert_eq!(json!(crate::homework::rows(&conn, "SELECT change_kind FROM homework_history ORDER BY revision", &[]).unwrap().iter().map(|r| r["change_kind"].clone()).collect::<Vec<_>>()), json!(["create", "start", "record_evidence"]));
    verify_schema_20_homework_semantics(&conn).unwrap();
    drop(conn);
    verify_application_database(&path).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn backup_round_trip_keeps_runs_evidence_and_action_links() {
    let root = scratch("hw-runs-backup");
    let target = scratch("hw-runs-target");
    let archive_root = scratch("hw-runs-archive");
    let path = root.join(DB_FILES[0]);
    pdf_kit_test_database(&path, 20);
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    homework_seed(&conn);
    for sql in homework_contract()["card_seed"].as_array().unwrap() {
        conn.execute_batch(sql.as_str().unwrap()).unwrap();
    }
    hw_quiz_seed(&conn);

    // One assignment holding both run kinds, with its next action bound.
    let create = hw_quiz_create(
        &[homework_operation("card_create")["next"]["activities"][0].clone(), hw_quiz_entry(1, "Quiz Activity")],
        true,
    );
    crate::homework::execute_homework(&mut conn, &create).unwrap();
    let card_start = hw_quiz_start(&create, &[homework_operation("card_start")["next"]["runs"][0].clone()]);
    crate::homework::execute_homework(&mut conn, &card_start).unwrap();
    homework_card_write(&mut conn, &homework_card_action(&card_start, 0, 2)).unwrap();
    homework_card_write(&mut conn, &homework_card_action(&card_start, 1, 3)).unwrap();

    let at = crate::practice_sessions::db_now_iso(&conn).unwrap();
    let quiz_run_id = hw_id(112);
    let mut quiz_start = hw_operation(&hw_snapshot(&conn), "start", &hw_id(106), &at);
    quiz_start["next"]["assignment"]["revision"] = json!(5);
    quiz_start["next"]["assignment"]["updated_at"] = json!(at);
    quiz_start["next"]["activities"][1]["record"]["state"] = json!("in_progress");
    quiz_start["next"]["activities"][1]["record"]["updated_at"] = json!(at);
    let runs = quiz_start["next"]["runs"].as_array_mut().unwrap();
    runs.push(hw_quiz_run(112, 3, 30, &at));
    runs.sort_by_key(|r| r["id"].as_str().unwrap_or_default().to_string());
    crate::homework::execute_homework(&mut conn, &quiz_start).unwrap();
    let revision = hw_answer(&mut conn, &hw_id(30), 0, 201);
    hw_complete(&mut conn, &hw_id(30), revision, Some(&hw_context(&quiz_run_id, 5, 1, 1))).unwrap();

    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM homework_runs WHERE evidence_json IS NOT NULL", &[]).unwrap()[0]["n"], json!(2));
    assert_eq!(crate::homework::rows(&conn, "SELECT state FROM homework_assignments", &[]).unwrap()[0]["state"], json!("completed"));
    assert_eq!(crate::homework::rows(&conn, "SELECT action_id FROM homework_assignments", &[]).unwrap()[0]["action_id"], json!(hw_id(50)));
    assert_eq!(crate::homework::rows(&conn, "SELECT status FROM next_actions WHERE id=?", &[&hw_id(50)]).unwrap()[0]["status"], json!("completed"));
    let finished = hw_snapshot(&conn);
    assert_eq!(finished["activities"].as_array().unwrap().iter().filter(|e| !e["evidence"].is_null()).count(), 2);
    verify_schema_20_homework_semantics(&conn).unwrap();
    let before = homework_dump(&conn);
    drop(conn);

    let archive = archive_root.join("runs.hfdbackup");
    create_consistent_complete_backup_with_retry(&root, &archive, "0.5.7").unwrap();
    stage_complete_restore_in(&target, &archive, "0.5.7").unwrap();
    apply_pending_restore_in(&target).unwrap();
    let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
    assert_eq!(homework_dump(&conn), before);
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM homework_runs WHERE evidence_json IS NOT NULL", &[]).unwrap()[0]["n"], json!(2));
    assert_eq!(crate::homework::rows(&conn, "SELECT COUNT(*) AS n FROM practice_attempts WHERE status='completed'", &[]).unwrap()[0]["n"], json!(1));
    assert_eq!(crate::homework::rows(&conn, "SELECT status FROM next_actions WHERE id=?", &[&hw_id(50)]).unwrap()[0]["status"], json!("completed"));
    verify_application_connection(&conn).unwrap();
    drop(conn);
    for p in [root, target, archive_root] {
        std::fs::remove_dir_all(p).unwrap();
    }
}


#[test]
fn homework_context_is_strict_and_bound_to_its_exact_attempt() {
    let (root, mut conn) = hw_quiz_database("hw-context-exact");
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);
    crate::homework::execute_homework(&mut conn, &create).unwrap();
    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();
    let context = hw_context(&hw_id(111), 2, 1, 1);
    let before = homework_dump(&conn);
    for malformed in [json!({}), json!({"extra":true}), { let mut c=context.clone(); c["cycle"]=json!(0); c }] {
        let error = hw_complete(&mut conn, &hw_id(30), 0, Some(&malformed)).unwrap_err();
        assert_eq!(error, crate::practice_sessions::PracticeSessionErrorCode::InvalidArgument);
    }
    let mut wrong_revision = context.clone(); wrong_revision["activityRevision"] = json!(2);
    assert_eq!(hw_complete(&mut conn, &hw_id(30), 0, Some(&wrong_revision)).unwrap_err(), crate::practice_sessions::PracticeSessionErrorCode::InvalidState);
    assert_eq!(homework_dump(&conn), before);
    conn.execute("INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,status,revision,total_questions,answered_count,correct_count,incorrect_count,dont_know_count) VALUES (?1,?2,NULL,'Synthetic source',?3,'in_progress',0,2,0,0,0,0)", params![hw_id(31), hw_id(20), HW_QUIZ_T1]).unwrap();
    let before = homework_dump(&conn);
    assert_eq!(hw_complete(&mut conn, &hw_id(31), 0, Some(&context)).unwrap_err(), crate::practice_sessions::PracticeSessionErrorCode::InvalidState);
    assert_eq!(homework_dump(&conn), before);
    drop(conn); std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn backwards_clock_between_create_and_start_still_completes() {
    let (root, mut conn) = hw_quiz_database("hw-backwards-clock");
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);
    crate::homework::execute_homework(&mut conn, &create).unwrap();

    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();

    // Clock skew: activity was created at 10:05, but attempt was started at 10:01
    let skew = "2026-10-21T10:05:00.000Z";
    conn.execute("UPDATE homework_activities SET created_at=? WHERE id=?", params![skew, hw_id(2)]).unwrap();
    conn.execute_batch("DROP TRIGGER homework_history_no_update").unwrap();
    let history: String = conn.query_row("SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1", params![hw_id(1)], |r| r.get(0)).unwrap();
    let mut snapshot: Value = serde_json::from_str(&history).unwrap();
    snapshot["activities"][0]["record"]["created_at"] = json!(skew);
    conn.execute("UPDATE homework_history SET snapshot_json=? WHERE assignment_id=? AND revision=2", params![serde_json::to_string(&snapshot).unwrap(), hw_id(1)]).unwrap();
    conn.execute_batch("CREATE TRIGGER homework_history_no_update BEFORE UPDATE ON homework_history BEGIN SELECT RAISE(ABORT,'Homework history is append-only'); END;").unwrap();

    let act_created: String = conn.query_row("SELECT created_at FROM homework_activities WHERE id=?", params![hw_id(2)], |r| r.get(0)).unwrap();
    let att_started: String = conn.query_row("SELECT started_at FROM practice_attempts WHERE id=?", params![hw_id(30)], |r| r.get(0)).unwrap();
    assert!(act_created > att_started, "clock moved backwards between create and start");

    let context = hw_context(&hw_id(111), 2, 1, 1);
    let revision = hw_answer(&mut conn, &hw_id(30), 0, 201);
    let outcome = hw_complete(&mut conn, &hw_id(30), revision, Some(&context)).unwrap();
    assert_eq!(outcome["status"], "completed");

    let history: String = conn.query_row("SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1", params![hw_id(1)], |r| r.get(0)).unwrap();
    let snapshot: Value = serde_json::from_str(&history).unwrap();
    let run = &snapshot["runs"][0];
    assert_eq!(run["evidence"]["attempt_id"], hw_id(30));
    assert!(!run["finished_at"].is_null());

    drop(conn); std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn zero_score_completes_and_detached_evidence_survives_later_edits() {
    let (root, mut conn) = hw_quiz_database("hw-detached-quiz");
    let path = root.join(DB_FILES[0]);
    let create = hw_quiz_create(&[hw_quiz_entry(0, "Quiz Activity")], true);
    crate::homework::execute_homework(&mut conn, &create).unwrap();
    let start = hw_quiz_start(&create, &[hw_quiz_run(111, 2, 30, HW_QUIZ_T1)]);
    crate::homework::execute_homework(&mut conn, &start).unwrap();
    hw_complete(&mut conn, &hw_id(30), 0, None).unwrap();
    let completed = hw_snapshot(&conn);
    assert_eq!(completed["assignment"]["state"], "completed");
    assert_eq!(completed["runs"][0]["evidence"]["score_percent"], json!(0.0));
    crate::practice_sessions::run_legacy_conversion_at(&root).unwrap();
    crate::practice_sessions::erase_practice_history_at(&root, &json!({"action":"erase_history","operationId":hw_id(212),"historyKey":hw_id(5)})).unwrap();
    verify_schema_20_homework_semantics(&conn).unwrap();
    let at = crate::practice_sessions::db_now_iso(&conn).unwrap();
    let mut archive = hw_operation(&hw_snapshot(&conn), "archive", &hw_id(213), &at);
    archive["next"]["assignment"]["revision"] = json!(4);
    archive["next"]["assignment"]["updated_at"] = json!(at);
    archive["next"]["assignment"]["archived"] = json!(1);
    // Resolve the availability pointer as the UI repository does after erasure prunes the version.
    archive["next"]["activities"][0]["record"] = crate::homework::rows(&conn, "SELECT * FROM homework_activities WHERE id=?", &[&hw_id(2)]).unwrap()[0].clone();
    crate::homework::execute_homework(&mut conn, &archive).unwrap();
    assert_eq!(crate::homework::rows(&conn,"SELECT attempt_id,source_attempt_id FROM homework_runs", &[]).unwrap()[0], json!({"attempt_id":null,"source_attempt_id":hw_id(30)}));
    drop(conn); verify_application_database(&path).unwrap(); std::fs::remove_dir_all(root).unwrap();
}
