//! Comprehensive tests for practice sessions persistence contracts (M2 PR 1).

use super::*;
use std::path::PathBuf;

/// An owned temporary directory for test databases, cleaned up on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-practice-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Initialize a test database with all 11 migrations.
fn setup_test_db(root: &Path) -> Connection {
    let db_path = root.join("her-flight-deck.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.busy_timeout(Duration::from_secs(5)).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
    )
    .unwrap();
    let migrations = crate::migrations();
    for m in migrations {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO _sqlx_migrations (version) VALUES (?1)",
            params![m.version],
        )
        .unwrap();
    }
    mark_root_ready(root);
    conn
}

fn seed_material_and_v1(conn: &Connection, mat_id: &str, title: &str) -> (String, Vec<String>) {
    let now = db_now_iso(conn).unwrap();
    conn.execute(
        "INSERT INTO study_materials (
            id, title, material_type, topic, review_status, priority,
            created_at, updated_at
         ) VALUES (?1, ?2, 'study_guide', 'general', 'needs_review', 'later', ?3, ?3)",
        params![mat_id, title, now],
    )
    .unwrap();

    let ver_id = format!("ver-{mat_id}");
    conn.execute(
        "INSERT INTO practice_test_versions (
            id, source_material_id, history_key, source_material_title,
            version_number, provider, model, title, content_hash, created_at, is_active
         ) VALUES (?1, ?2, ?2, ?3, 1, 'gemini', 'gemini-1.5-pro', ?3, 'hash1', ?4, 1)",
        params![ver_id, mat_id, title, now],
    )
    .unwrap();

    let mut item_ids = Vec::new();
    for i in 0..5 {
        let item_id = format!("item-{mat_id}-{i}");
        conn.execute(
            "INSERT INTO practice_test_items (
                id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page
             ) VALUES (?1, ?2, ?3, ?4, '[\"A\",\"B\",\"C\",\"D\"]', 1, 'Explanation', NULL)",
            params![item_id, ver_id, i as i64, format!("Question {i}")],
        )
        .unwrap();
        item_ids.push(item_id);
    }

    conn.execute(
        "INSERT INTO practice_tests (
            source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at
         ) VALUES (?1, ?2, '[{\"question\":\"Seeded\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\"}]', 'gemini', 'gemini-1.5-pro', ?3, ?3, ?3)",
        params![mat_id, title, now],
    )
    .unwrap();

    (ver_id, item_ids)
}

#[test]
fn req_01_interrupted_resume() {
    let dir = TempDir::new("resume");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-resume", "Resume Test");
    drop(conn);

    let op1 = "11111111-1111-4111-8111-111111111111";
    let start_req = serde_json::json!({
        "action": "start_or_resume",
        "operationId": op1,
        "materialId": "mat-resume",
        "versionId": ver_id
    });
    let start_res = save_practice_session_at(dir.path(), &start_req).unwrap();
    let attempt_id = start_res["attemptId"].as_str().unwrap().to_string();
    assert_eq!(start_res["revision"], 0);
    assert_eq!(start_res["nextUnansweredOrdinal"], 0);
    assert_eq!(start_res["answeredCount"], 0);

    // Answer 2 questions
    let op2 = "22222222-2222-4222-8222-222222222222";
    let resp1 = serde_json::json!({
        "action": "record_response",
        "operationId": op2,
        "attemptId": attempt_id,
        "itemId": item_ids[0],
        "expectedRevision": 0,
        "selectedIndex": 1,
        "isDontKnow": false
    });
    let r1 = save_practice_session_at(dir.path(), &resp1).unwrap();
    assert_eq!(r1["revision"], 1);
    assert_eq!(r1["isCorrect"], true);

    let op3 = "33333333-3333-4333-8333-333333333333";
    let resp2 = serde_json::json!({
        "action": "record_response",
        "operationId": op3,
        "attemptId": attempt_id,
        "itemId": item_ids[1],
        "expectedRevision": 1,
        "selectedIndex": null,
        "isDontKnow": true
    });
    let r2 = save_practice_session_at(dir.path(), &resp2).unwrap();
    assert_eq!(r2["revision"], 2);
    assert_eq!(r2["isCorrect"], false);

    // Resume with a new operationId
    let op4 = "44444444-4444-4444-8444-444444444444";
    let resume_req = serde_json::json!({
        "action": "start_or_resume",
        "operationId": op4,
        "materialId": "mat-resume",
        "versionId": ver_id
    });
    let resume_res = save_practice_session_at(dir.path(), &resume_req).unwrap();
    assert_eq!(resume_res["attemptId"], attempt_id);
    assert_eq!(resume_res["answeredCount"], 2);
    assert_eq!(resume_res["revision"], 2);
    assert_eq!(resume_res["nextUnansweredOrdinal"], 2);
    assert_eq!(resume_res["responses"].as_array().unwrap().len(), 2);
}

#[test]
fn req_02_idempotent_replay() {
    let dir = TempDir::new("idempotent");
    let conn = setup_test_db(dir.path());
    let (ver_id, _) = seed_material_and_v1(&conn, "mat-idem", "Idempotent Test");
    drop(conn);

    let op = "12345678-1234-4234-8234-123456789012";
    let retake_req = serde_json::json!({
        "action": "retake_attempt",
        "operationId": op,
        "expectedAttemptId": null,
        "materialId": "mat-idem",
        "versionId": ver_id
    });

    let res1 = save_practice_session_at(dir.path(), &retake_req).unwrap();
    let att_id_1 = res1["attemptId"].as_str().unwrap().to_string();

    // Replay identical request
    let res2 = save_practice_session_at(dir.path(), &retake_req).unwrap();
    let att_id_2 = res2["attemptId"].as_str().unwrap().to_string();

    assert_eq!(att_id_1, att_id_2);
    assert_eq!(res1, res2);

    // Verify only one attempt was created
    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let count: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM practice_attempts WHERE source_material_id = 'mat-idem'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn req_03_operation_conflict() {
    let dir = TempDir::new("conflict");
    let conn = setup_test_db(dir.path());
    let (ver_id, _) = seed_material_and_v1(&conn, "mat-conf-1", "Conflict Test 1");
    let (ver_id_2, _) = seed_material_and_v1(&conn, "mat-conf-2", "Conflict Test 2");
    drop(conn);

    let op = "abcdef12-abcd-4bcd-8bcd-abcdef123456";
    let req1 = serde_json::json!({
        "action": "start_or_resume",
        "operationId": op,
        "materialId": "mat-conf-1",
        "versionId": ver_id
    });
    save_practice_session_at(dir.path(), &req1).unwrap();

    // Re-use same operationId with different materialId
    let req2 = serde_json::json!({
        "action": "start_or_resume",
        "operationId": op,
        "materialId": "mat-conf-2",
        "versionId": ver_id_2
    });
    let err = save_practice_session_at(dir.path(), &req2).unwrap_err();
    assert_eq!(err.code, PracticeSessionErrorCode::OperationConflict);
}

#[test]
fn req_04_single_in_progress_attempt() {
    let dir = TempDir::new("single_in_progress");
    let conn = setup_test_db(dir.path());
    let (ver_id, _) = seed_material_and_v1(&conn, "mat-single", "Single Test");

    conn.execute(
        "INSERT INTO practice_attempts (
            id, version_id, source_material_id, source_material_title,
            started_at, status, revision, total_questions
         ) VALUES ('att-1', ?1, 'mat-single', 'Single Test', '2026-10-04T12:00:00Z', 'in_progress', 0, 5)",
        [&ver_id],
    )
    .unwrap();

    // Attempt second in_progress attempt for same material directly in SQL
    let res = conn.execute(
        "INSERT INTO practice_attempts (
            id, version_id, source_material_id, source_material_title,
            started_at, status, revision, total_questions
         ) VALUES ('att-2', ?1, 'mat-single', 'Single Test', '2026-10-04T12:00:00Z', 'in_progress', 0, 5)",
        [&ver_id],
    );
    assert!(
        res.is_err(),
        "Unique index uq_single_in_progress_attempt must reject second in-progress attempt"
    );
}

#[test]
fn req_05_and_06_cross_version_item_triggers() {
    let dir = TempDir::new("cross_version");
    let conn = setup_test_db(dir.path());
    let (ver1, items1) = seed_material_and_v1(&conn, "mat-cv-1", "Test 1");
    let (_ver2, items2) = seed_material_and_v1(&conn, "mat-cv-2", "Test 2");

    conn.execute(
        "INSERT INTO practice_attempts (
            id, version_id, source_material_id, source_material_title,
            started_at, status, revision, total_questions
         ) VALUES ('att-cv', ?1, 'mat-cv-1', 'Test 1', '2026-10-04T12:00:00Z', 'in_progress', 0, 5)",
        [&ver1],
    )
    .unwrap();

    // REQ-05: Insert response pointing to item from another version
    let res_insert = conn.execute(
        "INSERT INTO practice_responses (
            id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
         ) VALUES ('resp-bad', 'att-cv', ?1, 1, 0, 1, '2026-10-04T12:01:00Z')",
        [&items2[0]],
    );
    assert!(
        res_insert.is_err(),
        "trg_enforce_response_item_version_insert must abort insert"
    );

    // Insert valid response
    conn.execute(
        "INSERT INTO practice_responses (
            id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
         ) VALUES ('resp-ok', 'att-cv', ?1, 1, 0, 1, '2026-10-04T12:01:00Z')",
        [&items1[0]],
    )
    .unwrap();

    // REQ-06: Update response pointing to item from another version
    let res_update = conn.execute(
        "UPDATE practice_responses SET item_id = ?1 WHERE id = 'resp-ok'",
        [&items2[0]],
    );
    assert!(
        res_update.is_err(),
        "trg_enforce_response_item_version_update must abort update"
    );
}

#[test]
fn req_07_and_08_contradictory_choice_flags() {
    let dir = TempDir::new("choice_flags");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-flags", "Flags Test");

    conn.execute(
        "INSERT INTO practice_attempts (
            id, version_id, source_material_id, source_material_title,
            started_at, status, revision, total_questions
         ) VALUES ('att-fl', ?1, 'mat-flags', 'Flags Test', '2026-10-04T12:00:00Z', 'in_progress', 0, 5)",
        [&ver_id],
    )
    .unwrap();

    // REQ-07: is_dont_know = 1 and selected_index = 2
    let res_7 = conn.execute(
        "INSERT INTO practice_responses (
            id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
         ) VALUES ('resp-7', 'att-fl', ?1, 2, 1, 0, '2026-10-04T12:01:00Z')",
        [&item_ids[0]],
    );
    assert!(
        res_7.is_err(),
        "CHECK constraint must reject is_dont_know = 1 with non-null selected_index"
    );

    // REQ-08: is_dont_know = 0 and selected_index = NULL
    let res_8 = conn.execute(
        "INSERT INTO practice_responses (
            id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
         ) VALUES ('resp-8', 'att-fl', ?1, NULL, 0, 0, '2026-10-04T12:01:00Z')",
        [&item_ids[0]],
    );
    assert!(
        res_8.is_err(),
        "CHECK constraint must reject is_dont_know = 0 with null selected_index"
    );
}

#[test]
fn req_09_completed_attempt_mutation_refused() {
    let dir = TempDir::new("completed_mut");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-comp", "Completed Test");
    drop(conn);

    let op1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let start_res = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": op1,
            "materialId": "mat-comp",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let attempt_id = start_res["attemptId"].as_str().unwrap().to_string();

    // Complete the attempt
    let op2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "complete_attempt",
            "operationId": op2,
            "attemptId": attempt_id,
            "expectedRevision": 0
        }),
    )
    .unwrap();

    // Now try to record a response on the completed attempt
    let op3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let err = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": op3,
            "attemptId": attempt_id,
            "itemId": item_ids[0],
            "expectedRevision": 1,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap_err();

    assert_eq!(err.code, PracticeSessionErrorCode::InvalidState);
}

#[test]
fn req_10_exactly_once_completion() {
    let dir = TempDir::new("completion_once");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-comp-once", "Comp Once Test");
    drop(conn);

    let op1 = "11111111-2222-4333-8444-555555555555";
    let start_res = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": op1,
            "materialId": "mat-comp-once",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let attempt_id = start_res["attemptId"].as_str().unwrap().to_string();

    // Answer 1 question correctly
    let op2 = "22222222-3333-4444-8555-666666666666";
    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": op2,
            "attemptId": attempt_id,
            "itemId": item_ids[0],
            "expectedRevision": 0,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap();

    // Complete attempt
    let op3 = "33333333-4444-4555-8666-777777777777";
    let comp_req = serde_json::json!({
        "action": "complete_attempt",
        "operationId": op3,
        "attemptId": attempt_id,
        "expectedRevision": 1
    });

    let res1 = save_practice_session_at(dir.path(), &comp_req).unwrap();
    assert_eq!(res1["status"], "completed");
    assert_eq!(res1["answeredCount"], 1);
    assert_eq!(res1["correctCount"], 1);
    assert_eq!(res1["unansweredCount"], 4);
    assert_eq!(res1["scorePercent"], 20.0);

    // Replay complete_attempt with same operationId
    let res2 = save_practice_session_at(dir.path(), &comp_req).unwrap();
    assert_eq!(res1, res2);
}

#[test]
fn req_11_version_isolation_on_regeneration() {
    let dir = TempDir::new("regen");
    let conn = setup_test_db(dir.path());
    let (ver1, item_ids1) = seed_material_and_v1(&conn, "mat-regen", "Regen Test");
    drop(conn);

    // Start and complete attempt 1 on v1
    let start1 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "10000000-0000-4000-8000-000000000001",
            "materialId": "mat-regen",
            "versionId": ver1
        }),
    )
    .unwrap();
    let att1 = start1["attemptId"].as_str().unwrap().to_string();

    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": "10000000-0000-4000-8000-000000000002",
            "attemptId": att1,
            "itemId": item_ids1[0],
            "expectedRevision": 0,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap();

    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "complete_attempt",
            "operationId": "10000000-0000-4000-8000-000000000003",
            "attemptId": att1,
            "expectedRevision": 1
        }),
    )
    .unwrap();

    // Regenerate practice test: creates version 2 with 3 new questions
    let new_questions = serde_json::json!([
        { "question": "New Q1", "options": ["X", "Y"], "correctIndex": 0, "explanation": "E1", "sourcePage": null },
        { "question": "New Q2", "options": ["X", "Y"], "correctIndex": 1, "explanation": "E2", "sourcePage": null },
        { "question": "New Q3", "options": ["X", "Y"], "correctIndex": 0, "explanation": "E3", "sourcePage": null }
    ]);
    save_practice_test_at(
        dir.path(),
        "mat-regen",
        "Regen Test New",
        &new_questions.to_string(),
        "gemini-1.5-flash",
    )
    .unwrap();

    // Query active version
    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let (ver2, ver2_num): (String, i64) = conn2
        .query_row(
            "SELECT id, version_number FROM practice_test_versions WHERE source_material_id = 'mat-regen' AND is_active = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ver2_num, 2);
    assert_ne!(ver1, ver2);

    // Verify v1 is inactive
    let v1_active: i64 = conn2
        .query_row(
            "SELECT is_active FROM practice_test_versions WHERE id = ?1",
            [&ver1],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(v1_active, 0);

    // Start attempt on v2
    let start2 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "10000000-0000-4000-8000-000000000004",
            "materialId": "mat-regen",
            "versionId": ver2
        }),
    )
    .unwrap();
    let att2 = start2["attemptId"].as_str().unwrap().to_string();
    assert_ne!(att1, att2);
    assert_eq!(start2["totalQuestions"], 3);

    // Attempt 1 remains intact and bound to v1
    let att1_ver: String = conn2
        .query_row(
            "SELECT version_id FROM practice_attempts WHERE id = ?1",
            [&att1],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(att1_ver, ver1);
}

#[test]
fn req_12_policy_a_deletion_lifecycle() {
    let dir = TempDir::new("policy_a");
    let conn = setup_test_db(dir.path());
    let (ver1, item_ids1) = seed_material_and_v1(&conn, "mat-del", "Deletion Test");
    drop(conn);

    // Complete attempt on v1
    let start1 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "20000000-0000-4000-8000-000000000001",
            "materialId": "mat-del",
            "versionId": ver1
        }),
    )
    .unwrap();
    let att1 = start1["attemptId"].as_str().unwrap().to_string();

    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": "20000000-0000-4000-8000-000000000002",
            "attemptId": att1,
            "itemId": item_ids1[0],
            "expectedRevision": 0,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap();

    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "complete_attempt",
            "operationId": "20000000-0000-4000-8000-000000000003",
            "attemptId": att1,
            "expectedRevision": 1
        }),
    )
    .unwrap();

    // Regenerate to create v2 with draft attempt
    let new_questions = serde_json::json!([
        { "question": "Q1", "options": ["A", "B"], "correctIndex": 0, "explanation": "", "sourcePage": null }
    ]);
    save_practice_test_at(
        dir.path(),
        "mat-del",
        "Deletion Test v2",
        &new_questions.to_string(),
        "gemini",
    )
    .unwrap();

    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let ver2: String = conn2
        .query_row("SELECT id FROM practice_test_versions WHERE source_material_id = 'mat-del' AND is_active = 1", [], |r| r.get(0))
        .unwrap();

    let start2 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "20000000-0000-4000-8000-000000000004",
            "materialId": "mat-del",
            "versionId": ver2
        }),
    )
    .unwrap();
    let att2 = start2["attemptId"].as_str().unwrap().to_string();

    // Now delete study_materials row
    conn2
        .execute("DELETE FROM study_materials WHERE id = 'mat-del'", [])
        .unwrap();

    // Trigger trg_cleanup_material_delete checks:
    // 1. Unfinished attempt 2 deleted
    let att2_exists: bool = conn2
        .query_row(
            "SELECT 1 FROM practice_attempts WHERE id = ?1",
            [&att2],
            |_| Ok(()),
        )
        .optional()
        .unwrap()
        .is_some();
    assert!(
        !att2_exists,
        "Draft attempt 2 must be pruned on material deletion"
    );

    // 2. Receipt for att2 tombstones
    let is_erased: i64 = conn2
        .query_row(
            "SELECT is_erased FROM practice_session_operations WHERE attempt_id = ?1",
            [&att2],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        is_erased, 1,
        "Receipt for pruned draft attempt must be tombstones with is_erased = 1"
    );

    // 3. Version 2 pruned (since 0 completed attempts)
    let ver2_exists: bool = conn2
        .query_row(
            "SELECT 1 FROM practice_test_versions WHERE id = ?1",
            [&ver2],
            |_| Ok(()),
        )
        .optional()
        .unwrap()
        .is_some();
    assert!(
        !ver2_exists,
        "Version 2 without completed attempts must be pruned"
    );

    // 4. Version 1 retained with is_active = 0
    let (v1_exists, v1_active, v1_history): (bool, i64, String) = conn2
        .query_row(
            "SELECT 1, is_active, history_key FROM practice_test_versions WHERE id = ?1",
            [&ver1],
            |r| Ok((true, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert!(v1_exists);
    assert_eq!(v1_active, 0);
    assert_eq!(v1_history, "mat-del");

    // 5. Completed attempt 1 retained with responses
    let att1_status: String = conn2
        .query_row(
            "SELECT status FROM practice_attempts WHERE id = ?1",
            [&att1],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(att1_status, "completed");

    let resp_count: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1",
            [&att1],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(resp_count, 1);
}

#[test]
fn req_13_legacy_startup_upgrade_and_200_questions() {
    let dir = TempDir::new("legacy_upgrade");
    let conn = setup_test_db(dir.path());

    // Create study material
    conn.execute(
        "INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, created_at, updated_at)
         VALUES ('mat-legacy', 'Legacy 200 Test', 'study_guide', 'general', 'needs_review', 'later', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z')",
        [],
    ).unwrap();

    // Create 200 questions
    let mut questions = Vec::new();
    for i in 0..200 {
        questions.push(serde_json::json!({
            "question": format!("Question {i} text"),
            "options": ["Option A", "Option B", "Option C"],
            "correctIndex": (i % 3) as i64,
            "explanation": format!("Explanation for {i}"),
            "sourcePage": null
        }));
    }
    let q_json = serde_json::to_string(&questions).unwrap();

    conn.execute(
        "INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error)
         VALUES ('mat-legacy', 'Legacy 200 Test', ?1, 'gemini', 'gemini-1.5', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z', NULL, NULL)",
        [&q_json],
    ).unwrap();
    drop(conn);

    // Run legacy conversion
    let converted = run_legacy_conversion_at(dir.path()).unwrap();
    assert_eq!(converted, 1);

    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let (migrated_at, legacy_error): (Option<String>, Option<String>) = conn2
        .query_row(
            "SELECT legacy_migrated_at, legacy_error FROM practice_tests WHERE source_material_id = 'mat-legacy'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(migrated_at.is_some());
    assert!(legacy_error.is_none());

    // Verify 200 items in practice_test_items
    let item_count: i64 = conn2
        .query_row("SELECT COUNT(*) FROM practice_test_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        item_count, 200,
        "All 200 questions must be converted without silent truncation"
    );

    // Second run must be a no-op
    let converted_again = run_legacy_conversion_at(dir.path()).unwrap();
    assert_eq!(converted_again, 0);
}

#[test]
fn req_14_malformed_legacy_handling() {
    let dir = TempDir::new("malformed_legacy");
    let conn = setup_test_db(dir.path());

    conn.execute(
        "INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, created_at, updated_at)
         VALUES ('mat-bad', 'Bad Test', 'study_guide', 'general', 'needs_review', 'later', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error)
         VALUES ('mat-bad', 'Bad Test', 'not-valid-json', 'gemini', '', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z', NULL, NULL)",
        [],
    ).unwrap();
    drop(conn);

    let converted = run_legacy_conversion_at(dir.path()).unwrap();
    assert_eq!(converted, 0);

    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let legacy_error: String = conn2
        .query_row(
            "SELECT legacy_error FROM practice_tests WHERE source_material_id = 'mat-bad'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(legacy_error, "MALFORMED_QUESTION");

    let version_count: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM practice_test_versions WHERE source_material_id = 'mat-bad'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(version_count, 0);
}

#[test]
fn stale_revision_mismatch_refused() {
    let dir = TempDir::new("stale_revision");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-stale", "Stale Test");
    drop(conn);

    let start = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "30000000-0000-4000-8000-000000000001",
            "materialId": "mat-stale",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att_id = start["attemptId"].as_str().unwrap();

    // First response advances revision from 0 to 1
    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": "30000000-0000-4000-8000-000000000002",
            "attemptId": att_id,
            "itemId": item_ids[0],
            "expectedRevision": 0,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap();

    // Stale second response sent with expectedRevision = 0 must fail with INVALID_STATE
    let err = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": "30000000-0000-4000-8000-000000000003",
            "attemptId": att_id,
            "itemId": item_ids[1],
            "expectedRevision": 0,
            "selectedIndex": 2,
            "isDontKnow": false
        }),
    )
    .unwrap_err();

    assert_eq!(err.code, PracticeSessionErrorCode::InvalidState);
}

#[test]
fn stale_retakes_cannot_replace_each_other() {
    let dir = TempDir::new("stale_retakes");
    let conn = setup_test_db(dir.path());
    let (ver_id, _) = seed_material_and_v1(&conn, "mat-stale-retake", "Stale Retake Test");
    drop(conn);

    // Initial attempt 1
    let start1 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "40000000-0000-4000-8000-000000000001",
            "materialId": "mat-stale-retake",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att1_id = start1["attemptId"].as_str().unwrap().to_string();

    // Retake A expects att1_id -> succeeds, creates attempt 2
    let retake_a = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "retake_attempt",
            "operationId": "40000000-0000-4000-8000-000000000002",
            "expectedAttemptId": att1_id,
            "materialId": "mat-stale-retake",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att2_id = retake_a["attemptId"].as_str().unwrap().to_string();
    assert_ne!(att1_id, att2_id);

    // Retake B also expected att1_id (stale expectation) -> must be refused with INVALID_STATE!
    let err_b = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "retake_attempt",
            "operationId": "40000000-0000-4000-8000-000000000003",
            "expectedAttemptId": att1_id,
            "materialId": "mat-stale-retake",
            "versionId": ver_id
        }),
    )
    .unwrap_err();
    assert_eq!(err_b.code, PracticeSessionErrorCode::InvalidState);

    // Verify attempt 2 is still in_progress
    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let att2_status: String = conn2
        .query_row(
            "SELECT status FROM practice_attempts WHERE id = ?1",
            [&att2_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(att2_status, "in_progress");
}

#[test]
fn remove_practice_test_prunes_unfinished_and_keeps_completed() {
    let dir = TempDir::new("remove_test");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-rem", "Remove Practice Test");
    drop(conn);

    // Complete attempt 1
    let s1 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "50000000-0000-4000-8000-000000000001",
            "materialId": "mat-rem",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att1 = s1["attemptId"].as_str().unwrap().to_string();

    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "complete_attempt",
            "operationId": "50000000-0000-4000-8000-000000000002",
            "attemptId": att1,
            "expectedRevision": 0
        }),
    )
    .unwrap();

    // Start attempt 2 (in_progress)
    let s2 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "retake_attempt",
            "operationId": "50000000-0000-4000-8000-000000000003",
            "expectedAttemptId": null,
            "materialId": "mat-rem",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att2 = s2["attemptId"].as_str().unwrap().to_string();

    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": "50000000-0000-4000-8000-000000000004",
            "attemptId": att2,
            "itemId": item_ids[0],
            "expectedRevision": 0,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap();

    // Now call remove_practice_test_at
    remove_practice_test_at(dir.path(), "mat-rem").unwrap();

    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    // Attempt 2 (in_progress) pruned
    let a2_exists: bool = conn2
        .query_row(
            "SELECT 1 FROM practice_attempts WHERE id = ?1",
            [&att2],
            |_| Ok(()),
        )
        .optional()
        .unwrap()
        .is_some();
    assert!(
        !a2_exists,
        "Unfinished attempt 2 must be pruned on test removal"
    );

    // Attempt 1 (completed) retained
    let a1_status: String = conn2
        .query_row(
            "SELECT status FROM practice_attempts WHERE id = ?1",
            [&att1],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(a1_status, "completed");

    // Version is deactivated
    let v_active: i64 = conn2
        .query_row(
            "SELECT is_active FROM practice_test_versions WHERE id = ?1",
            [&ver_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(v_active, 0);

    // Practice test row deleted
    let pt_count: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM practice_tests WHERE source_material_id = 'mat-rem'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pt_count, 0);

    // Material itself still exists!
    let mat_exists: bool = conn2
        .query_row(
            "SELECT 1 FROM study_materials WHERE id = 'mat-rem'",
            [],
            |_| Ok(()),
        )
        .optional()
        .unwrap()
        .is_some();
    assert!(
        mat_exists,
        "Study material must NOT be deleted when removing practice test"
    );
}

#[test]
fn all_answered_cursor_is_null_and_early_completion() {
    let dir = TempDir::new("cursor_null");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-cursor", "Cursor Test");
    drop(conn);

    let start = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "60000000-0000-4000-8000-000000000001",
            "materialId": "mat-cursor",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att_id = start["attemptId"].as_str().unwrap().to_string();

    // Answer all 5 items
    for (i, item_id) in item_ids.iter().enumerate() {
        let op = format!("60000000-0000-4000-8000-0000000000{:02x}", i + 2);
        save_practice_session_at(
            dir.path(),
            &serde_json::json!({
                "action": "record_response",
                "operationId": op,
                "attemptId": att_id,
                "itemId": item_id,
                "expectedRevision": i as i64,
                "selectedIndex": 1,
                "isDontKnow": false
            }),
        )
        .unwrap();
    }

    // Resume: nextUnansweredOrdinal must be NULL when all are answered
    let resume = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "60000000-0000-4000-8000-000000000099",
            "materialId": "mat-cursor",
            "versionId": ver_id
        }),
    )
    .unwrap();
    assert_eq!(resume["answeredCount"], 5);
    assert!(resume["nextUnansweredOrdinal"].is_null());
}

#[test]
fn strict_payload_rejects_unknown_keys_and_oversized() {
    let dir = TempDir::new("strict_payload");
    let conn = setup_test_db(dir.path());
    let (ver_id, _) = seed_material_and_v1(&conn, "mat-strict", "Strict Test");
    drop(conn);

    // Unknown key at root
    let err1 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "70000000-0000-4000-8000-000000000001",
            "materialId": "mat-strict",
            "versionId": ver_id,
            "unknownKey": "sneaky"
        }),
    )
    .unwrap_err();
    assert_eq!(err1.code, PracticeSessionErrorCode::InvalidArgument);

    // Oversized request (> 64 KiB)
    let large_pad = "a".repeat(65 * 1024);
    let err2 = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "70000000-0000-4000-8000-000000000002",
            "materialId": large_pad,
            "versionId": ver_id
        }),
    )
    .unwrap_err();
    assert_eq!(err2.code, PracticeSessionErrorCode::InvalidArgument);
}

#[test]
fn concurrent_starts_serialize_to_single_unfinished_attempt() {
    let dir = TempDir::new("concurrent_starts");
    let conn = setup_test_db(dir.path());
    let (ver_id, _) = seed_material_and_v1(&conn, "mat-concurrent", "Concurrent Test");
    drop(conn);

    let path1 = dir.path().to_path_buf();
    let ver1 = ver_id.clone();
    let t1 = std::thread::spawn(move || {
        save_practice_session_at(
            &path1,
            &serde_json::json!({
                "action": "start_or_resume",
                "operationId": "80000000-0000-4000-8000-000000000001",
                "materialId": "mat-concurrent",
                "versionId": ver1
            }),
        )
    });

    let path2 = dir.path().to_path_buf();
    let ver2 = ver_id.clone();
    let t2 = std::thread::spawn(move || {
        save_practice_session_at(
            &path2,
            &serde_json::json!({
                "action": "start_or_resume",
                "operationId": "80000000-0000-4000-8000-000000000002",
                "materialId": "mat-concurrent",
                "versionId": ver2
            }),
        )
    });

    let res1 = t1.join().unwrap().unwrap();
    let res2 = t2.join().unwrap().unwrap();

    // Both succeed and refer to the exact same attempt
    assert_eq!(res1["attemptId"], res2["attemptId"]);

    // Exactly one in_progress attempt exists in database
    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let count: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM practice_attempts WHERE source_material_id = 'mat-concurrent' AND status = 'in_progress'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn failed_replacement_preserves_previous_test_and_progress() {
    let dir = TempDir::new("failed_replacement");
    let conn = setup_test_db(dir.path());
    let (ver_id, item_ids) = seed_material_and_v1(&conn, "mat-replace", "Replace Test");
    drop(conn);

    let start = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "90000000-0000-4000-8000-000000000001",
            "materialId": "mat-replace",
            "versionId": ver_id
        }),
    )
    .unwrap();
    let att_id = start["attemptId"].as_str().unwrap().to_string();

    // Record one response
    save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "record_response",
            "operationId": "90000000-0000-4000-8000-000000000002",
            "attemptId": att_id,
            "itemId": item_ids[0],
            "expectedRevision": 0,
            "selectedIndex": 1,
            "isDontKnow": false
        }),
    )
    .unwrap();

    // 1. Attempt replacing with invalid questions JSON (malformed)
    let invalid_json = "not valid json";
    let replace_res = save_practice_test_at(
        dir.path(),
        "mat-replace",
        "Replaced Title",
        invalid_json,
        "gemini-1.5-pro",
    );
    assert!(
        replace_res.is_err(),
        "malformed input must be rejected upfront"
    );

    // 2. Synthetic mid-write failure: install trigger that fires on ordinal 1 insertion
    let conn_mid = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn_mid
        .execute_batch(
            "CREATE TRIGGER inject_mid_replacement_failure
             BEFORE INSERT ON practice_test_items
             WHEN NEW.ordinal = 1
             BEGIN
                 SELECT RAISE(FAIL, 'synthetic mid-replacement item insert failure');
             END;",
        )
        .unwrap();
    drop(conn_mid);

    let valid_replacement_json = r#"[
        {"question": "New Question 1", "options": ["X", "Y"], "correctIndex": 0, "explanation": "E1", "sourcePage": null},
        {"question": "New Question 2", "options": ["W", "Z"], "correctIndex": 1, "explanation": "E2", "sourcePage": null}
    ]"#;

    let mid_write_res = save_practice_test_at(
        dir.path(),
        "mat-replace",
        "Mid-Write Replacement Title",
        valid_replacement_json,
        "gemini-1.5-pro",
    );
    assert!(
        mid_write_res.is_err(),
        "mid-write failure must be rejected and rolled back"
    );

    let conn2 = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn2
        .execute_batch("DROP TRIGGER inject_mid_replacement_failure")
        .unwrap();

    // Previous version is STILL active and only 1 version exists
    let ver_count: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM practice_test_versions WHERE source_material_id = 'mat-replace'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ver_count, 1);

    let active_ver: String = conn2
        .query_row(
            "SELECT id FROM practice_test_versions WHERE source_material_id = 'mat-replace' AND is_active = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(active_ver, ver_id);

    // In-progress attempt is still in_progress with its response and revision intact
    let (status, rev, ans_count): (String, i64, i64) = conn2
        .query_row(
            "SELECT status, revision, answered_count FROM practice_attempts WHERE id = ?1",
            [&att_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(status, "in_progress");
    assert_eq!(rev, 1);
    assert_eq!(ans_count, 1);

    // Legacy practice_tests row is intact
    let legacy_title: String = conn2
        .query_row(
            "SELECT title FROM practice_tests WHERE source_material_id = 'mat-replace'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(legacy_title, "Replace Test");
}

#[test]
fn direct_native_writer_refuses_when_legacy_conversion_pending() {
    let dir = TempDir::new("readiness_refusal");
    let conn = setup_test_db(dir.path());
    let now = db_now_iso(&conn).unwrap();
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-unmig', 'Unmigrated', ?1, ?1)",
        params![now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error)
         VALUES ('mat-unmig', 'Unmigrated', '[{\"question\":\"Q?\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\"}]', 'gemini', 'gemini-1.5-pro', ?1, ?1, NULL, NULL)",
        params![now],
    )
    .unwrap();
    drop(conn);

    // Direct native session save must refuse with InvalidState
    let err = save_practice_session_at(
        dir.path(),
        &serde_json::json!({
            "action": "start_or_resume",
            "operationId": "a0000000-0000-4000-8000-000000000001",
            "materialId": "mat-unmig",
            "versionId": "dummy"
        }),
    )
    .unwrap_err();
    assert_eq!(err.code, PracticeSessionErrorCode::InvalidState);

    // Direct native test save must refuse with InvalidState
    let err2 = save_practice_test_at(
        dir.path(),
        "mat-unmig",
        "New Title",
        "[{\"question\":\"Q?\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\"}]",
        "gemini-1.5-pro",
    )
    .unwrap_err();
    assert_eq!(err2.code, PracticeSessionErrorCode::InvalidState);

    // Direct native test remove must refuse with InvalidState
    let err3 = remove_practice_test_at(dir.path(), "mat-unmig").unwrap_err();
    assert_eq!(err3.code, PracticeSessionErrorCode::InvalidState);
}

#[test]
fn canonical_content_hashing_matches_regardless_of_key_order() {
    let q1 = ParsedLegacyQuestion {
        question: "Synthetic question".to_string(),
        options: vec!["A".to_string(), "B".to_string()],
        correct_index: 0,
        explanation: "".to_string(),
        source_page: None,
    };
    let hash = compute_canonical_content_hash_from_parsed(&[q1]);
    let expected_json = r#"[{"correctIndex":0,"explanation":"","options":["A","B"],"question":"Synthetic question","sourcePage":null}]"#;
    let mut hasher = Sha256::new();
    hasher.update(expected_json.as_bytes());
    let expected_hash = hex::encode(hasher.finalize());
    assert_eq!(hash, expected_hash);
}

/* ------------------------------------------------------------------ */
/* R3 readiness corrections (initialization re-review, 4 October)     */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
struct ValidationContract {
    baseline: Vec<String>,
    cases: Vec<ValidationCase>,
}

#[derive(Deserialize)]
struct ValidationCase {
    name: String,
    sql: Vec<String>,
    expect: String,
}

fn validation_contract() -> ValidationContract {
    serde_json::from_str(include_str!("../fixtures/practice-validation/cases.json")).unwrap()
}

/// Build the registered schema, apply the shared baseline and a case, then
/// reopen so any schema edit is what the validator reads.
fn contract_database(dir: &TempDir, contract: &ValidationContract, case: &[String]) -> PathBuf {
    let path = dir.path().join("her-flight-deck.db");
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
    }
    for statement in contract.baseline.iter().chain(case) {
        conn.execute_batch(statement)
            .unwrap_or_else(|e| panic!("fixture statement failed: {statement}: {e}"));
    }
    path
}

#[test]
fn shared_validation_contract_native_outcomes() {
    let contract = validation_contract();
    let mut mismatches = Vec::new();
    for case in &contract.cases {
        let dir = TempDir::new("validation_contract");
        let path = contract_database(&dir, &contract, &case.sql);
        let conn = Connection::open(&path).unwrap();
        let result = crate::backup::verify_schema_11_semantics(&conn);
        let outcome = if result.is_ok() { "accept" } else { "refuse" };
        if outcome != case.expect {
            mismatches.push(format!(
                "{}: expected {}, got {result:?}",
                case.name, case.expect
            ));
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
    assert!(contract.cases.len() >= 30);
}

/// Seed a ready root with one saved test and one recorded response.
fn seeded_session_root(label: &str) -> (TempDir, Connection) {
    let dir = TempDir::new(label);
    let conn = setup_test_db(dir.path());
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at)
         VALUES ('mat', 'Synthetic', '2026-10-04', '2026-10-04')",
        [],
    )
    .unwrap();
    save_practice_test_at(
        dir.path(),
        "mat",
        "Synthetic",
        r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,
        "synthetic",
    )
    .unwrap();
    let version: String = conn
        .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
        .unwrap();
    let item: String = conn
        .query_row("SELECT id FROM practice_test_items", [], |r| r.get(0))
        .unwrap();
    let started = save_practice_session_at(
        dir.path(),
        &serde_json::json!({"action":"start_or_resume","operationId":"20000000-0000-4000-8000-000000000001","materialId":"mat","versionId":version}),
    )
    .unwrap();
    save_practice_session_at(
        dir.path(),
        &serde_json::json!({"action":"record_response","operationId":"20000000-0000-4000-8000-000000000002","attemptId":started["attemptId"],"itemId":item,"expectedRevision":0,"selectedIndex":1,"isDontKnow":false}),
    )
    .unwrap();
    (dir, conn)
}

/// Every persisted row that initialization may touch, in a comparable form.
fn persisted_state(conn: &Connection) -> Vec<String> {
    let mut rows = Vec::new();
    for sql in [
        "SELECT id || '|' || COALESCE(source_material_id, '') || '|' || is_active || '|' || content_hash FROM practice_test_versions ORDER BY id",
        "SELECT id || '|' || version_id || '|' || ordinal FROM practice_test_items ORDER BY id",
        "SELECT id || '|' || status || '|' || revision || '|' || answered_count FROM practice_attempts ORDER BY id",
        "SELECT id || '|' || COALESCE(selected_index, 'dk') || '|' || is_correct FROM practice_responses ORDER BY id",
        "SELECT operation_id || '|' || result_json FROM practice_session_operations ORDER BY operation_id",
        "SELECT source_material_id || '|' || questions_json || '|' || COALESCE(legacy_migrated_at, '-') || '|' || COALESCE(legacy_error, '-') FROM practice_tests ORDER BY source_material_id",
    ] {
        let mut stmt = conn.prepare(sql).unwrap();
        rows.extend(
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap),
        );
    }
    rows
}

#[test]
fn missing_source_fk_definition_refused() {
    let (dir, conn) = seeded_session_root("missing_fk");
    let db_path = dir.path().join("her-flight-deck.db");
    // Positive control: the intact schema passes and the FK action is live.
    assert!(crate::backup::verify_application_database(&db_path).is_ok());

    // Disposable corruption seam only: never a migration or app-file repair.
    conn.execute_batch(
        "PRAGMA writable_schema=ON;
         UPDATE sqlite_master SET sql=replace(sql,' REFERENCES study_materials(id) ON DELETE SET NULL','') WHERE name='practice_test_versions';
         PRAGMA writable_schema=OFF;",
    )
    .unwrap();
    drop(conn);
    let check = Connection::open(&db_path).unwrap();
    let definitions: i64 = check
        .query_row(
            "SELECT count(*) FROM pragma_foreign_key_list('practice_test_versions')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(definitions, 0, "the corruption seam did not remove the FK");
    // foreign_key_check has nothing to check without the definition.
    let violations: i64 = check
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0);
    drop(check);
    let error = crate::backup::verify_application_database(&db_path).unwrap_err();
    assert!(error.contains("foreign keys"), "{error}");
    // Initialization refuses the same file and stays not ready.
    assert!(run_legacy_conversion_at(dir.path()).is_err());
    assert!(!is_root_ready(dir.path()));
}

#[test]
fn intact_source_fk_keeps_material_deletion_history_behavior() {
    let (dir, conn) = seeded_session_root("fk_delete_behavior");
    conn.execute(
        "UPDATE practice_attempts SET status='completed', completed_at='2026-10-04T12:00:00.000Z',
         answered_count=1, correct_count=0, incorrect_count=1, score_percent=0.0",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM study_materials WHERE id='mat'", [])
        .unwrap();
    // ON DELETE SET NULL detaches the version; Policy A keeps completed history.
    let (source, active): (Option<String>, i64) = conn
        .query_row(
            "SELECT source_material_id, is_active FROM practice_test_versions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((source, active), (None, 0));
    let attempts: i64 = conn
        .query_row("SELECT count(*) FROM practice_attempts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(attempts, 1);
    drop(conn);
    assert!(
        crate::backup::verify_application_database(&dir.path().join("her-flight-deck.db")).is_ok()
    );
}

#[test]
fn failed_semantic_validation_rolls_back_legacy_conversion() {
    let (dir, conn) = seeded_session_root("rollback_conversion");
    // An already-invalid existing response plus a valid unconverted legacy test.
    conn.execute_batch(
        "UPDATE practice_responses SET selected_index=99;
         INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('legacy','Legacy synthetic','2026-10-04','2026-10-04');
         INSERT INTO practice_tests(source_material_id,title,questions_json,provider,model,generated_at,updated_at)
           VALUES('legacy','Legacy synthetic','[{\"question\":\"Synthetic\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\",\"sourcePage\":null}]','gemini','synthetic','2026-10-04','2026-10-04');",
    )
    .unwrap();
    let prior = persisted_state(&conn);
    assert!(is_root_ready(dir.path()));

    let error = run_legacy_conversion_at(dir.path()).unwrap_err();
    assert!(error.starts_with("Semantic validation failed"), "{error}");
    assert_eq!(
        persisted_state(&conn),
        prior,
        "failed initialization changed state"
    );
    let legacy_versions: i64 = conn
        .query_row(
            "SELECT count(*) FROM practice_test_versions WHERE source_material_id='legacy'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        legacy_versions, 0,
        "failed initialization committed a newly converted version"
    );
    assert!(!is_root_ready(dir.path()));
    let refused = save_practice_session_at(
        dir.path(),
        &serde_json::json!({"action":"start_or_resume","operationId":"20000000-0000-4000-8000-000000000009","materialId":"legacy","versionId":"none"}),
    )
    .unwrap_err();
    assert_eq!(refused.code, PracticeSessionErrorCode::InvalidState);

    // Repair the isolated invalid fixture; a retry converts exactly once.
    conn.execute("UPDATE practice_responses SET selected_index=1", [])
        .unwrap();
    assert_eq!(run_legacy_conversion_at(dir.path()).unwrap(), 1);
    assert!(is_root_ready(dir.path()));
    let converted: (String, i64) = conn
        .query_row(
            "SELECT v.id, (SELECT count(*) FROM practice_test_items WHERE version_id=v.id)
             FROM practice_test_versions v WHERE source_material_id='legacy'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(converted.1, 1);
    let marker: Option<String> = conn
        .query_row(
            "SELECT legacy_migrated_at FROM practice_tests WHERE source_material_id='legacy'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(marker.is_some());

    // Another initialization converts nothing and keeps every identity.
    let settled = persisted_state(&conn);
    assert_eq!(run_legacy_conversion_at(dir.path()).unwrap(), 0);
    assert_eq!(persisted_state(&conn), settled);
    let still: String = conn
        .query_row(
            "SELECT id FROM practice_test_versions WHERE source_material_id='legacy'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(still, converted.0);
}

#[test]
fn early_conversion_error_revokes_stale_readiness() {
    let (dir, conn) = seeded_session_root("early_error");
    // A legacy row that conflicts with the existing active version.
    conn.execute(
        "UPDATE practice_tests SET legacy_migrated_at=NULL, legacy_error=NULL,
         questions_json='[{\"question\":\"Different\",\"options\":[\"A\",\"B\"],\"correctIndex\":1,\"explanation\":\"\",\"sourcePage\":null}]'
         WHERE source_material_id='mat'",
        [],
    )
    .unwrap();
    let prior = persisted_state(&conn);
    assert!(is_root_ready(dir.path()));
    let error = run_legacy_conversion_at(dir.path()).unwrap_err();
    assert!(
        error.starts_with("Conflicting legacy practice test"),
        "{error}"
    );
    assert!(
        !is_root_ready(dir.path()),
        "stale readiness survived an early conversion error"
    );
    assert_eq!(persisted_state(&conn), prior);
}

#[test]
fn restore_during_initialization_does_not_publish_stale_readiness() {
    let (dir, conn) = seeded_session_root("generation_guard");
    drop(conn);
    BEFORE_READY_PUBLISH.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(bump_readiness_generation_at));
    });
    let result = run_legacy_conversion_at(dir.path());
    BEFORE_READY_PUBLISH.with(|hook| *hook.borrow_mut() = None);
    assert!(result.unwrap_err().contains("restored"));
    assert!(!is_root_ready(dir.path()));
    // A fresh initialization for the current generation publishes readiness.
    assert_eq!(run_legacy_conversion_at(dir.path()).unwrap(), 0);
    assert!(is_root_ready(dir.path()));
}
