// ORAL-01d: her finished oral answers (schema 32). Included in backup.rs tests.

fn oral_answer_library(path: &Path) -> Connection {
    use crate::oral_scenarios::tests as oral;
    let mut conn = Connection::open(path).unwrap();
    oral::library_at(&conn);
    crate::oral_scenarios::execute(&mut conn, &oral::create(1, 10, 11, "Scenario Alpha")).unwrap();
    conn.execute(
        "INSERT INTO oral_answers (id,scenario_id,version_id,answer,covered_json,revealed_at,finished_at,created_at,updated_at)
         VALUES (?1,?2,?3,'Fictional answer ✈\nLine two','[0,2]','2026-11-02T10:00:00.000Z','2026-11-02T10:01:00.000Z','2026-11-02T10:01:00.000Z','2026-11-02T10:01:00.000Z')",
        [oral::uid(20), oral::uid(10), oral::uid(11)],
    )
    .unwrap();
    conn
}

#[test]
fn schema_32_oral_answers_require_the_table_shape() {
    let connection = get_reference_schema_connection().unwrap();
    verify_schema_32_oral_answers(&connection).unwrap();
    connection
        .execute_batch(
            "ALTER TABLE oral_answers RENAME TO original_answers;
             CREATE TABLE oral_answers (id TEXT PRIMARY KEY, scenario_id TEXT, version_id TEXT, answer TEXT, covered_json TEXT, revealed_at TEXT, finished_at TEXT, created_at TEXT, updated_at TEXT);
             DROP TABLE original_answers;",
        )
        .unwrap();
    assert!(verify_schema_32_oral_answers(&connection).is_err());
    let connection = get_reference_schema_connection().unwrap();
    connection.execute_batch("DROP TABLE oral_answers").unwrap();
    assert!(verify_schema_32_oral_answers(&connection).is_err());
}

#[test]
fn schema_32_oral_answers_refuse_damaged_rows() {
    use crate::oral_scenarios::tests as oral;
    for damage in [
        "UPDATE oral_answers SET covered_json='[2,0]'",
        "UPDATE oral_answers SET covered_json='[0,0]'",
        "UPDATE oral_answers SET covered_json='[3]'",
        "UPDATE oral_answers SET covered_json='[0, 2]'",
        "UPDATE oral_answers SET covered_json='{}'",
        "UPDATE oral_answers SET id='short-id-but-thirty-six-characters!!'",
        "UPDATE oral_answers SET finished_at=''",
        "UPDATE oral_answers SET created_at=''",
    ] {
        let dir = scratch("oral-answer-damage");
        let conn = oral_answer_library(&dir.join("db.sqlite"));
        verify_application_connection(&conn).unwrap();
        conn.execute_batch(damage).unwrap();
        assert!(verify_application_connection(&conn).is_err(), "{damage}");
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    // An answer must point at a version of its own scenario.
    let dir = scratch("oral-answer-owner");
    let mut conn = oral_answer_library(&dir.join("db.sqlite"));
    crate::oral_scenarios::execute(&mut conn, &oral::create(2, 30, 31, "Scenario Bravo")).unwrap();
    conn.execute("UPDATE oral_answers SET scenario_id=?1", [oral::uid(30)]).unwrap();
    assert!(verify_application_connection(&conn).is_err());
    // A finished answer must have been revealed (the table refuses it).
    assert!(conn.execute("UPDATE oral_answers SET revealed_at=NULL", []).is_err());
    drop(conn);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn oral_answers_complete_backup_round_trip_old_backup_and_cascade() {
    for old in [false, true] {
        let root = scratch("oral-answer-source");
        let target = scratch("oral-answer-target");
        let backups = scratch("oral-answer-archive");
        let path = root.join(DB_FILES[0]);
        if old {
            pdf_kit_test_database(&path, 31);
        } else {
            let conn = oral_answer_library(&path);
            verify_application_connection(&conn).unwrap();
        }
        let archive = backups.join("oral-answers.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
        if old {
            for m in crate::migrations().into_iter().filter(|m| m.version > 31) {
                conn.execute_batch(m.sql).unwrap();
                conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
                    .unwrap();
            }
        }
        verify_application_connection(&conn).unwrap();
        assert_eq!(
            m3_count(&conn, "SELECT COUNT(*) FROM oral_answers", &[]).unwrap(),
            if old { 0 } else { 1 }
        );
        if !old {
            let (answer, covered): (String, String) = conn
                .query_row("SELECT answer, covered_json FROM oral_answers", [], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap();
            assert_eq!(answer, "Fictional answer ✈\nLine two");
            assert_eq!(covered, "[0,2]");
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            conn.execute(
                "DELETE FROM study_materials WHERE id=?1",
                [crate::oral_scenarios::tests::MATERIAL],
            )
            .unwrap();
            assert_eq!(
                m3_count(&conn, "SELECT COUNT(*) FROM oral_answers", &[]).unwrap(),
                0
            );
        }
        drop(conn);
        for p in [root, target, backups] {
            std::fs::remove_dir_all(p).unwrap();
        }
    }
}
