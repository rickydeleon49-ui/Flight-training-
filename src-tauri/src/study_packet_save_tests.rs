//! Slice B native save: temporary rusqlite databases built from the app's own
//! migrations. Test names carry the accepted acceptance-row IDs
//! (docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md §5).

use super::*;
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "hfd-import-save-test-{}-{}-{}",
            std::process::id(),
            id,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        TestDir(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A database built from the registered migrations, as the desktop app builds it.
fn setup_db(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for migration in crate::migrations() {
        conn.execute_batch(migration.sql).unwrap();
    }
    conn.execute_batch(&format!(
        "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
         INSERT INTO _sqlx_migrations (version) VALUES ({});",
        crate::CURRENT_SCHEMA_VERSION
    ))
    .unwrap();
    conn
}

const ID: &str = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PRIOR_SQL: &str =
    "INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
     VALUES ('prior-material', 'Synthetic prior material', 'reference', 'weather', 't', 't')";

/// A complete, valid operation: guide, cards, notes and a test.
fn operation(id: &str) -> Value {
    json!({
        "operationId": id,
        "materialId": id,
        "contentHash": HASH,
        "material": { "title": "Synthetic airspace packet" },
        "studySet": {
            "title": "Synthetic airspace packet",
            "provider": "import",
            "model": "",
            "summary": "Class B surrounds the busiest airports.",
            "sections": [{ "heading": "Class B", "body": "A clearance is required." }],
            "flashcards": [{ "front": "Class B entry?", "back": "Clearance", "sourcePage": null }],
            "sourceNotes": "Synthetic notes",
        },
        "practiceTest": {
            "title": "Synthetic airspace packet",
            "provider": "import",
            "model": "",
            "questions": [{
                "question": "What does Class B require?",
                "options": ["A clearance", "Nothing"],
                "correctIndex": 0,
                "explanation": "ATC must clear you in.",
                "sourcePage": null,
            }],
        },
    })
}

fn save(root: &Path, op: &Value) -> Result<NativeImportSaveResult, NativeImportSaveError> {
    save_structured_import_at(root, op)
}

fn code(result: Result<NativeImportSaveResult, NativeImportSaveError>) -> String {
    result.expect_err("the save must be refused").code
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn counts(conn: &Connection) -> [i64; 3] {
    [
        count(conn, "study_materials"),
        count(conn, "ai_study_sets"),
        count(conn, "practice_tests"),
    ]
}

/// Every stored column of the three tables, for before/after equality.
fn snapshot(conn: &Connection) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    for sql in [
        "SELECT * FROM study_materials ORDER BY id",
        "SELECT * FROM ai_study_sets ORDER BY source_material_id",
        "SELECT * FROM practice_tests ORDER BY source_material_id",
    ] {
        let mut stmt = conn.prepare(sql).unwrap();
        let columns = stmt.column_count();
        let rows = stmt
            .query_map([], |row| {
                (0..columns)
                    .map(|i| {
                        Ok(match row.get_ref(i)? {
                            rusqlite::types::ValueRef::Null => "NULL".to_string(),
                            rusqlite::types::ValueRef::Integer(n) => n.to_string(),
                            rusqlite::types::ValueRef::Real(f) => f.to_string(),
                            rusqlite::types::ValueRef::Text(t) => {
                                String::from_utf8_lossy(t).to_string()
                            }
                            rusqlite::types::ValueRef::Blob(_) => "BLOB".to_string(),
                        })
                    })
                    .collect::<rusqlite::Result<Vec<String>>>()
            })
            .unwrap();
        for row in rows {
            out.push(row.unwrap());
        }
        out.push(vec!["--".into()]);
    }
    out
}

/// Assert a refusal with `expected` code that wrote nothing.
fn refused_without_writes(op: &Value, expected: &str) {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    conn.execute(PRIOR_SQL, []).unwrap();
    let before = snapshot(&conn);
    let error = save(dir.path(), op).expect_err("must be refused");
    assert_eq!(error.code, expected);
    assert_eq!(
        error,
        ImportSaveCode::ALL
            .iter()
            .find(|c| c.code() == expected)
            .unwrap()
            .error()
    );
    assert_eq!(snapshot(&conn), before);
}

fn abort_trigger(conn: &Connection, table: &str) {
    conn.execute_batch(&format!(
        "CREATE TRIGGER synthetic_abort BEFORE INSERT ON {table}
         BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;"
    ))
    .unwrap();
}

// ------------------------------------------------------------- atomicity

#[test]
fn tb_atom_01_commits_material_guide_and_test_together() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let result = save(dir.path(), &operation(ID)).unwrap();
    assert_eq!(
        result,
        NativeImportSaveResult::Saved {
            material_id: ID.into()
        }
    );
    assert_eq!(counts(&conn), [1, 1, 1]);

    let material: (
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT title, material_type, topic, review_status, priority, notes, file_path
               FROM study_materials WHERE id = ?1",
            [ID],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        material,
        (
            "Synthetic airspace packet".into(),
            "study_guide".into(),
            "general".into(),
            "needs_review".into(),
            "later".into(),
            String::new(),
            None
        )
    );
    let set: (String, String, String, String, String, String) = conn
        .query_row(
            "SELECT title, provider, model, sections_json, flashcards_json, source_notes
               FROM ai_study_sets WHERE source_material_id = ?1",
            [ID],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(set.1, "import");
    assert_eq!(set.2, "");
    assert_eq!(
        set.3,
        r#"[{"heading":"Class B","body":"A clearance is required."}]"#
    );
    assert_eq!(
        set.4,
        r#"[{"front":"Class B entry?","back":"Clearance","sourcePage":null}]"#
    );
    assert_eq!(set.5, "Synthetic notes");
    let test: (String, String, String) = conn
        .query_row(
            "SELECT provider, model, questions_json FROM practice_tests WHERE source_material_id = ?1",
            [ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        test,
        (
            "import".into(),
            String::new(),
            r#"[{"question":"What does Class B require?","options":["A clearance","Nothing"],"correctIndex":0,"explanation":"ATC must clear you in.","sourcePage":null}]"#.into()
        )
    );
}

fn rollback_case(table: &str) {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    conn.execute(PRIOR_SQL, []).unwrap();
    abort_trigger(&conn, table);
    let before = snapshot(&conn);
    let error = save(dir.path(), &operation(ID)).unwrap_err();
    assert_eq!(error, ImportSaveCode::StorageFailure.error());
    assert!(
        !error.message.contains("synthetic"),
        "the database error is never echoed"
    );
    assert_eq!(snapshot(&conn), before);
    assert_eq!(counts(&conn), [1, 0, 0]);
}

#[test]
fn tb_roll_01_study_set_failure_rolls_back_the_material() {
    rollback_case("ai_study_sets");
}

#[test]
fn tb_roll_02_practice_test_failure_rolls_back_material_and_guide() {
    rollback_case("practice_tests");
}

#[test]
fn tb_roll_04_material_failure_creates_nothing() {
    rollback_case("study_materials");
}

#[test]
fn tb_lock_01_a_held_write_lock_waits_within_the_busy_timeout_then_fails_cleanly() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    conn.execute(PRIOR_SQL, []).unwrap();
    let before = snapshot(&conn);
    let holder = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    holder.execute_batch("BEGIN EXCLUSIVE").unwrap();

    let started = Instant::now();
    let result = save(dir.path(), &operation(ID));
    let waited = started.elapsed();
    assert_eq!(result.unwrap_err(), ImportSaveCode::StorageFailure.error());
    assert!(
        waited >= Duration::from_secs(4),
        "busy_timeout waited {waited:?}"
    );
    assert!(
        waited < Duration::from_secs(10),
        "bounded wait, took {waited:?}"
    );

    holder.execute_batch("ROLLBACK").unwrap();
    assert_eq!(snapshot(&conn), before);
    // The same operation succeeds once the lock is gone.
    assert!(matches!(
        save(dir.path(), &operation(ID)),
        Ok(NativeImportSaveResult::Saved { .. })
    ));
}

// ------------------------------------------------------------ idempotency

#[test]
fn tb_idem_01_an_identical_retry_is_already_saved_and_writes_nothing() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    save(dir.path(), &operation(ID)).unwrap();
    let after_first = snapshot(&conn);
    assert_eq!(
        save(dir.path(), &operation(ID)).unwrap(),
        NativeImportSaveResult::AlreadySaved {
            material_id: ID.into()
        }
    );
    assert_eq!(counts(&conn), [1, 1, 1]);
    assert_eq!(snapshot(&conn), after_first, "timestamps included");
}

/// Save `operation(id)`, apply `mutate` to the stored rows or the resubmitted
/// operation, and expect a conflict that changes nothing.
fn conflict_case(id: &str, alter_db: &str, alter_op: impl FnOnce(&mut Value)) {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    save(dir.path(), &operation(id)).unwrap();
    if !alter_db.is_empty() {
        conn.execute(alter_db, [id]).unwrap();
    }
    let before = snapshot(&conn);
    let mut op = operation(id);
    alter_op(&mut op);
    assert_eq!(code(save(dir.path(), &op)), "IDEMPOTENCY_CONFLICT");
    assert_eq!(snapshot(&conn), before);
}

#[test]
fn tb_conf_01_same_id_with_different_content_conflicts() {
    conflict_case("c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f", "", |op| {
        op["studySet"]["flashcards"][0]["back"] = json!("A different answer");
    });
}

#[test]
fn tb_conf_02_title_only_change_conflicts() {
    conflict_case("d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a", "", |op| {
        op["material"]["title"] = json!("Altered");
        op["studySet"]["title"] = json!("Altered");
        op["practiceTest"]["title"] = json!("Altered");
    });
}

#[test]
fn tb_conf_03_notes_only_change_conflicts() {
    conflict_case("e5f6a7b8-c9d0-4e1f-a23b-4c5d6e7f8a9b", "", |op| {
        op["studySet"]["sourceNotes"] = json!("Other notes");
    });
}

#[test]
fn tb_conf_04_adding_a_practice_test_conflicts() {
    let id = "f6a7b8c9-d0e1-4f2a-b34c-5d6e7f8a9b0c";
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut guide_only = operation(id);
    guide_only["practiceTest"] = Value::Null;
    save(dir.path(), &guide_only).unwrap();
    let before = snapshot(&conn);
    assert_eq!(
        code(save(dir.path(), &operation(id))),
        "IDEMPOTENCY_CONFLICT"
    );
    // And the reverse: dropping a stored aid is a presence change too.
    let mut no_guide = guide_only.clone();
    no_guide["studySet"] = Value::Null;
    no_guide["practiceTest"] = operation(id)["practiceTest"].clone();
    assert_eq!(code(save(dir.path(), &no_guide)), "IDEMPOTENCY_CONFLICT");
    assert_eq!(snapshot(&conn), before);
}

#[test]
fn tb_conf_05_a_pre_existing_unrelated_material_with_the_id_conflicts() {
    let id = "a7b8c9d0-e1f2-4a3b-8c5d-6e7f8a9b0c1d";
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    conn.execute(
        "INSERT INTO study_materials (id, title, material_type, topic, file_path, created_at, updated_at)
         VALUES (?1, 'Synthetic airspace packet', 'pdf', 'airspace', 'doc.pdf', 't', 't')",
        [id],
    )
    .unwrap();
    let before = snapshot(&conn);
    assert_eq!(
        code(save(dir.path(), &operation(id))),
        "IDEMPOTENCY_CONFLICT"
    );
    assert_eq!(snapshot(&conn), before);
}

#[test]
fn tb_conf_06_a_forged_hash_cannot_hide_changed_content() {
    // The resubmission keeps the original contentHash but alters a question.
    conflict_case("b8c9d0e1-f2a3-4b4c-9d6e-7f8a9b0c1d2e", "", |op| {
        assert_eq!(op["contentHash"], json!(HASH));
        op["practiceTest"]["questions"][0]["question"] = json!("A forged question?");
    });
}

// ---------------------------------------------------------------- content

#[test]
fn tb_cont_01_guide_only() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut op = operation(ID);
    op["practiceTest"] = Value::Null;
    save(dir.path(), &op).unwrap();
    assert_eq!(counts(&conn), [1, 1, 0]);
}

#[test]
fn tb_cont_02_test_only() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut op = operation(ID);
    op["studySet"] = Value::Null;
    save(dir.path(), &op).unwrap();
    assert_eq!(counts(&conn), [1, 0, 1]);
}

#[test]
fn tb_cont_03_source_notes_are_kept_normalized() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut op = operation(ID);
    op["studySet"]["sourceNotes"] = json!("\r\n  \r\nFirst line\r\nSecond line  \n\n");
    save(dir.path(), &op).unwrap();
    let notes: String = conn
        .query_row("SELECT source_notes FROM ai_study_sets", [], |r| r.get(0))
        .unwrap();
    assert_eq!(notes, "First line\nSecond line");
    // The normalized retry matches what was stored.
    assert!(matches!(
        save(dir.path(), &op),
        Ok(NativeImportSaveResult::AlreadySaved { .. })
    ));
}

fn summary_only(id: &str, notes: &str) -> Value {
    let mut op = operation(id);
    op["studySet"]["sections"] = json!([]);
    op["studySet"]["flashcards"] = json!([]);
    op["studySet"]["sourceNotes"] = json!(notes);
    op["practiceTest"] = Value::Null;
    op
}

#[test]
fn tb_cont_04_summary_only_guide() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    save(dir.path(), &summary_only(ID, "")).unwrap();
    assert_eq!(counts(&conn), [1, 1, 0]);
    let (summary, sections, cards): (String, String, String) = conn
        .query_row(
            "SELECT summary, sections_json, flashcards_json FROM ai_study_sets",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(summary, "Class B surrounds the busiest airports.");
    assert_eq!((sections.as_str(), cards.as_str()), ("[]", "[]"));
}

#[test]
fn tb_cont_05_summary_plus_notes() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    save(dir.path(), &summary_only(ID, "Synthetic summary notes")).unwrap();
    let notes: String = conn
        .query_row("SELECT source_notes FROM ai_study_sets", [], |r| r.get(0))
        .unwrap();
    assert_eq!(notes, "Synthetic summary notes");
}

// ---------------------------------------------------------- defensive guards

#[test]
fn tb_def_01_correct_index_outside_the_choices() {
    let mut op = operation(ID);
    op["practiceTest"]["questions"][0]["correctIndex"] = json!(5);
    refused_without_writes(&op, "INVALID_ARGUMENT");
}

#[test]
fn tb_def_02_a_flashcard_with_a_source_page() {
    let mut op = operation(ID);
    op["studySet"]["flashcards"][0]["sourcePage"] = json!(4);
    refused_without_writes(&op, "INVALID_SOURCE_PAGE");
    // A question claiming a page, or a page given as text, is refused too.
    let mut op = operation(ID);
    op["practiceTest"]["questions"][0]["sourcePage"] = json!("12");
    refused_without_writes(&op, "INVALID_SOURCE_PAGE");
    // A missing sourcePage key is malformed, not a page claim.
    let mut op = operation(ID);
    op["studySet"]["flashcards"][0]
        .as_object_mut()
        .unwrap()
        .remove("sourcePage");
    refused_without_writes(&op, "INVALID_ARGUMENT");
}

#[test]
fn tb_def_03_a_gemini_provider_or_a_model_name() {
    let mut op = operation(ID);
    op["studySet"]["provider"] = json!("gemini");
    refused_without_writes(&op, "UNSUPPORTED_PROVIDER");
    let mut op = operation(ID);
    op["practiceTest"]["model"] = json!("gemini-2.5-flash");
    refused_without_writes(&op, "UNSUPPORTED_PROVIDER");
}

#[test]
fn tb_def_04_an_empty_guide_and_no_test() {
    let mut op = summary_only(ID, "");
    op["studySet"]["summary"] = json!("   \n ");
    refused_without_writes(&op, "EMPTY_SUBSTANTIVE_CONTENT");
    // Notes alone do not make a study aid.
    op["studySet"]["sourceNotes"] = json!("Only notes");
    refused_without_writes(&op, "EMPTY_SUBSTANTIVE_CONTENT");
    // Neither aid at all.
    let mut neither = operation(ID);
    neither["studySet"] = Value::Null;
    neither["practiceTest"] = Value::Null;
    refused_without_writes(&neither, "EMPTY_SUBSTANTIVE_CONTENT");
}

#[test]
fn an_empty_study_set_beside_a_real_test_is_malformed() {
    let mut op = operation(ID);
    op["studySet"]["summary"] = json!("");
    op["studySet"]["sections"] = json!([]);
    op["studySet"]["flashcards"] = json!([]);
    refused_without_writes(&op, "INVALID_ARGUMENT");
    // A present test needs at least one question.
    let mut op = operation(ID);
    op["practiceTest"]["questions"] = json!([]);
    refused_without_writes(&op, "INVALID_ARGUMENT");
}

// ------------------------------------------------------ native IPC boundary

/// The serialized error is exactly one allowlisted code and message: nothing
/// from the payload, a key name or Serde can appear in it.
fn assert_sanitized(error: &NativeImportSaveError, forbidden: &[&str]) {
    let wire = serde_json::to_string(error).unwrap();
    for word in forbidden {
        assert!(!wire.contains(word), "{wire} must not echo {word}");
    }
    let known = ImportSaveCode::ALL.iter().any(|c| c.error() == *error);
    assert!(known, "{wire} is not an allowlisted error");
}

#[test]
fn tb_ipc_01_an_unknown_root_key_is_refused_without_echo() {
    let mut op = operation(ID);
    op["apiKey_secret"] = json!("sensitive-value");
    refused_without_writes(&op, "INVALID_ARGUMENT");
    let error = save(TestDir::new().path(), &op).unwrap_err();
    assert_sanitized(
        &error,
        &["apiKey_secret", "sensitive-value", "unknown field"],
    );
}

#[test]
fn tb_ipc_02_an_unknown_nested_key_is_refused_without_echo() {
    for path in [
        "/material",
        "/studySet",
        "/studySet/sections/0",
        "/studySet/flashcards/0",
        "/practiceTest",
        "/practiceTest/questions/0",
    ] {
        let mut op = operation(ID);
        op.pointer_mut(path)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("extraField".into(), json!("x"));
        refused_without_writes(&op, "INVALID_ARGUMENT");
        assert_sanitized(
            &save(TestDir::new().path(), &op).unwrap_err(),
            &["extraField"],
        );
    }
}

#[test]
fn tb_ipc_03_missing_fields_and_wrong_types() {
    let mut missing = operation(ID);
    missing["material"].as_object_mut().unwrap().remove("title");
    refused_without_writes(&missing, "INVALID_ARGUMENT");
    let mut number = operation(ID);
    number["material"]["title"] = json!(123);
    refused_without_writes(&number, "INVALID_ARGUMENT");
    let mut missing_aid_key = operation(ID);
    missing_aid_key
        .as_object_mut()
        .unwrap()
        .remove("practiceTest");
    refused_without_writes(&missing_aid_key, "INVALID_ARGUMENT");
    for not_an_object in [json!([]), json!("text"), json!(null), json!(7)] {
        refused_without_writes(&not_an_object, "INVALID_ARGUMENT");
    }
    let mut option_number = operation(ID);
    option_number["practiceTest"]["questions"][0]["options"][1] = json!(2);
    refused_without_writes(&option_number, "INVALID_ARGUMENT");
    let mut index_text = operation(ID);
    index_text["practiceTest"]["questions"][0]["correctIndex"] = json!("0");
    refused_without_writes(&index_text, "INVALID_ARGUMENT");
}

#[test]
fn tb_ipc_04_malformed_or_mismatched_operation_ids() {
    for (operation_id, material_id) in [
        ("not-a-uuid", "not-a-uuid"),
        // Version 1 UUID, not version 4.
        (
            "a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d",
            "a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d",
        ),
        // Wrong variant nibble.
        (
            "a1b2c3d4-e5f6-4a7b-7c9d-0e1f2a3b4c5d",
            "a1b2c3d4-e5f6-4a7b-7c9d-0e1f2a3b4c5d",
        ),
        (ID, "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"),
    ] {
        let mut op = operation(ID);
        op["operationId"] = json!(operation_id);
        op["materialId"] = json!(material_id);
        refused_without_writes(&op, "INVALID_OPERATION_ID");
    }
}

#[test]
fn tb_ipc_05_hash_format() {
    for hash in [
        HASH.to_uppercase(),
        HASH[..63].to_string(),
        format!("{HASH}0"),
        format!("{}g", &HASH[..63]),
    ] {
        let mut op = operation(ID);
        op["contentHash"] = json!(hash);
        refused_without_writes(&op, "INVALID_HASH_FORMAT");
    }
}

#[test]
fn tb_ipc_06_a_changed_stored_guide_title_conflicts() {
    conflict_case(
        ID,
        "UPDATE ai_study_sets SET title = 'Mutated guide title' WHERE source_material_id = ?1",
        |_| {},
    );
}

#[test]
fn tb_ipc_07_a_changed_stored_test_title_conflicts() {
    conflict_case(
        ID,
        "UPDATE practice_tests SET title = 'Mutated test title' WHERE source_material_id = ?1",
        |_| {},
    );
}

#[test]
fn tb_ipc_08_a_stored_question_with_a_source_page_conflicts() {
    conflict_case(
        ID,
        "UPDATE practice_tests SET questions_json = replace(questions_json, '\"sourcePage\":null', '\"sourcePage\":4')
          WHERE source_material_id = ?1",
        |_| {},
    );
}

#[test]
fn tb_ipc_09_changed_stored_source_notes_conflict() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut op = operation(ID);
    op["studySet"]["sourceNotes"] = json!("Original notes");
    save(dir.path(), &op).unwrap();
    let before = snapshot(&conn);
    op["studySet"]["sourceNotes"] = json!("Different notes");
    assert_eq!(code(save(dir.path(), &op)), "IDEMPOTENCY_CONFLICT");
    assert_eq!(snapshot(&conn), before);
}

#[test]
fn stored_provenance_or_material_type_changes_conflict() {
    conflict_case(
        ID,
        "UPDATE ai_study_sets SET provider = 'gemini' WHERE source_material_id = ?1",
        |_| {},
    );
    conflict_case(
        ID,
        "UPDATE practice_tests SET model = 'gemini-2.5-flash' WHERE source_material_id = ?1",
        |_| {},
    );
    conflict_case(
        ID,
        "UPDATE study_materials SET material_type = 'pdf' WHERE id = ?1",
        |_| {},
    );
}

#[test]
fn tb_ipc_10_negative_or_fractional_correct_index() {
    for index in [json!(-1), json!(1.5), json!(0.0)] {
        let mut op = operation(ID);
        op["practiceTest"]["questions"][0]["correctIndex"] = index;
        refused_without_writes(&op, "INVALID_ARGUMENT");
    }
}

#[test]
fn tb_ipc_11_out_of_range_correct_index() {
    for index in [2, 5] {
        let mut op = operation(ID);
        op["practiceTest"]["questions"][0]["correctIndex"] = json!(index);
        refused_without_writes(&op, "INVALID_ARGUMENT");
    }
}

#[test]
fn tb_ipc_12_aid_titles_must_match_the_material_title() {
    let mut op = operation(ID);
    op["studySet"]["title"] = json!("Another title");
    refused_without_writes(&op, "INVALID_ARGUMENT");
    let mut op = operation(ID);
    op["practiceTest"]["title"] = json!("Another title");
    refused_without_writes(&op, "INVALID_ARGUMENT");
}

#[test]
fn tb_ipc_13_whitespace_only_required_strings() {
    let mut op = operation(ID);
    op["material"]["title"] = json!("   ");
    op["studySet"]["title"] = json!("   ");
    op["practiceTest"]["title"] = json!("   ");
    refused_without_writes(&op, "INVALID_ARGUMENT");
    for pointer in [
        "/studySet/sections/0/heading",
        "/studySet/sections/0/body",
        "/studySet/flashcards/0/front",
        "/studySet/flashcards/0/back",
        "/practiceTest/questions/0/question",
        "/practiceTest/questions/0/explanation",
        "/practiceTest/questions/0/options/1",
    ] {
        let mut op = operation(ID);
        *op.pointer_mut(pointer).unwrap() = json!(" \t\r\n ");
        refused_without_writes(&op, "INVALID_ARGUMENT");
    }
}

fn with_title(op: &mut Value, title: &str) {
    op["material"]["title"] = json!(title);
    op["studySet"]["title"] = json!(title);
    op["practiceTest"]["title"] = json!(title);
}

#[test]
fn tb_ipc_14_exact_boundaries_pass_and_one_more_is_refused() {
    // Code points, not bytes or UTF-16 units: "✈" is 3 bytes, "𝄞" is 2 units.
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut at_limit = operation(ID);
    with_title(&mut at_limit, &"✈".repeat(200));
    at_limit["studySet"]["summary"] = json!("𝄞".repeat(20_000));
    at_limit["studySet"]["sourceNotes"] = json!("n".repeat(5_000));
    at_limit["practiceTest"]["questions"][0]["options"] =
        json!(["a".repeat(500), "b".repeat(500), "c", "d", "e", "f"]);
    save(dir.path(), &at_limit).unwrap();
    assert_eq!(counts(&conn), [1, 1, 1]);

    let mut long_title = operation(ID);
    with_title(&mut long_title, &"✈".repeat(201));
    refused_without_writes(&long_title, "CONTENT_LIMIT_EXCEEDED");
    let mut long_summary = operation(ID);
    long_summary["studySet"]["summary"] = json!("𝄞".repeat(20_001));
    refused_without_writes(&long_summary, "CONTENT_LIMIT_EXCEEDED");
    let mut long_notes = operation(ID);
    long_notes["studySet"]["sourceNotes"] = json!("n".repeat(5_001));
    refused_without_writes(&long_notes, "CONTENT_LIMIT_EXCEEDED");
    let mut seven_options = operation(ID);
    seven_options["practiceTest"]["questions"][0]["options"] =
        json!(["a", "b", "c", "d", "e", "f", "g"]);
    refused_without_writes(&seven_options, "CONTENT_LIMIT_EXCEEDED");
    let mut long_option = operation(ID);
    long_option["practiceTest"]["questions"][0]["options"][1] = json!("b".repeat(501));
    refused_without_writes(&long_option, "CONTENT_LIMIT_EXCEEDED");
    let mut one_option = operation(ID);
    one_option["practiceTest"]["questions"][0]["options"] = json!(["only"]);
    refused_without_writes(&one_option, "INVALID_ARGUMENT");

    let section = json!({ "heading": "h", "body": "b" });
    let card = json!({ "front": "f", "back": "b", "sourcePage": null });
    let mut many_sections = operation(ID);
    many_sections["studySet"]["sections"] = json!(vec![section; 101]);
    refused_without_writes(&many_sections, "CONTENT_LIMIT_EXCEEDED");
    let mut many_cards = operation(ID);
    many_cards["studySet"]["flashcards"] = json!(vec![card; 501]);
    refused_without_writes(&many_cards, "CONTENT_LIMIT_EXCEEDED");
    let question = operation(ID)["practiceTest"]["questions"][0].clone();
    let mut many_questions = operation(ID);
    many_questions["practiceTest"]["questions"] = json!(vec![question; 201]);
    refused_without_writes(&many_questions, "CONTENT_LIMIT_EXCEEDED");
}

#[test]
fn tb_ipc_15_duplicate_options_under_case_folding() {
    let mut op = operation(ID);
    op["practiceTest"]["questions"][0]["options"] = json!(["Class B", "class b"]);
    refused_without_writes(&op, "INVALID_ARGUMENT");
    // Whitespace that normalizes away makes a duplicate too.
    let mut op = operation(ID);
    op["practiceTest"]["questions"][0]["options"] = json!(["Class  B", " class b "]);
    refused_without_writes(&op, "INVALID_ARGUMENT");
}

// ----------------------------------------------------- backup and restore

#[test]
fn tb_back_01_complete_backup_and_restore_keep_import_provenance() {
    let root = TestDir::new();
    let elsewhere = TestDir::new();
    let restore_target = TestDir::new();
    let conn = setup_db(root.path());
    conn.execute(PRIOR_SQL, []).unwrap();
    conn.execute(
        "INSERT INTO ai_study_sets (source_material_id, title, provider, model, generated_at, updated_at)
         VALUES ('prior-material', 'Gemini guide', 'gemini', 'gemini-2.5-flash', 't', 't')",
        [],
    )
    .unwrap();
    save(root.path(), &operation(ID)).unwrap();
    let before = snapshot(&conn);
    drop(conn);

    let version = env!("CARGO_PKG_VERSION");
    let archive = elsewhere.path().join("import.hfdbackup");
    crate::backup::create_consistent_complete_backup_with_retry(root.path(), &archive, version)
        .unwrap();
    crate::backup::inspect_archive(root.path(), &archive, version).unwrap();
    crate::backup::stage_complete_restore_in(restore_target.path(), &archive, version).unwrap();
    crate::backup::apply_pending_restore_in(restore_target.path()).unwrap();

    let restored = Connection::open(restore_target.path().join("her-flight-deck.db")).unwrap();
    assert_eq!(snapshot(&restored), before);
    let providers: Vec<(String, String, String)> = restored
        .prepare(
            "SELECT source_material_id, provider, model FROM ai_study_sets
             UNION ALL SELECT source_material_id, provider, model FROM practice_tests
             ORDER BY 1, 2",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        providers,
        vec![
            (ID.into(), "import".into(), String::new()),
            (ID.into(), "import".into(), String::new()),
            (
                "prior-material".into(),
                "gemini".into(),
                "gemini-2.5-flash".into()
            ),
        ]
    );
}

// ------------------------------------------------- wire shapes and helpers

#[test]
fn results_and_errors_serialize_to_the_accepted_wire_shapes() {
    assert_eq!(
        serde_json::to_string(&NativeImportSaveResult::Saved {
            material_id: ID.into()
        })
        .unwrap(),
        format!(r#"{{"status":"saved","materialId":"{ID}"}}"#)
    );
    assert_eq!(
        serde_json::to_string(&NativeImportSaveResult::AlreadySaved {
            material_id: ID.into()
        })
        .unwrap(),
        format!(r#"{{"status":"already_saved","materialId":"{ID}"}}"#)
    );
    assert_eq!(
        serde_json::to_string(&ImportSaveCode::InvalidArgument.error()).unwrap(),
        r#"{"code":"INVALID_ARGUMENT","message":"The import operation payload is malformed or invalid."}"#
    );
    let codes: Vec<&str> = ImportSaveCode::ALL.iter().map(|c| c.code()).collect();
    assert_eq!(
        codes,
        [
            "INVALID_ARGUMENT",
            "INVALID_OPERATION_ID",
            "INVALID_HASH_FORMAT",
            "EMPTY_SUBSTANTIVE_CONTENT",
            "CONTENT_LIMIT_EXCEEDED",
            "INVALID_SOURCE_PAGE",
            "UNSUPPORTED_PROVIDER",
            "IDEMPOTENCY_CONFLICT",
            "STORAGE_FAILURE",
        ]
    );
}

#[test]
fn the_command_takes_untyped_json_and_is_registered() {
    // A typed argument would fail inside Tauri's decoding, whose messages echo
    // unknown key names, before the application boundary could run.
    let source = include_str!("study_packet.rs");
    let signature = source
        .split("pub async fn save_structured_study_material_atomically(")
        .nth(1)
        .and_then(|rest| rest.split(')').next())
        .expect("command present");
    assert!(signature.contains("operation: Value"), "{signature}");
    assert!(
        include_str!("lib.rs").contains("study_packet::save_structured_study_material_atomically")
    );
}

#[test]
fn a_missing_database_is_a_storage_failure_not_a_new_file() {
    let dir = TestDir::new();
    assert_eq!(
        save(dir.path(), &operation(ID)).unwrap_err(),
        ImportSaveCode::StorageFailure.error()
    );
    assert!(!dir.path().join("her-flight-deck.db").exists());
}

#[test]
fn normalization_matches_the_typescript_validator() {
    assert_eq!(
        normalize_line("  Class\r\nB\u{00A0}\u{FEFF} airspace\t"),
        "Class B airspace"
    );
    // U+0085 is not whitespace to JavaScript's \s, so it is kept.
    assert_eq!(normalize_line("a\u{0085}b"), "a\u{0085}b");
    assert_eq!(
        normalize_block(" \t\n\r\n  indented\r\nline \n\t"),
        "  indented\nline"
    );
    assert_eq!(normalize_block("\rkept"), "kept");
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut op = operation(ID);
    with_title(&mut op, "  Synthetic\r\n airspace   packet ");
    op["studySet"]["title"] = json!("Synthetic airspace packet");
    save(dir.path(), &op).unwrap();
    let title: String = conn
        .query_row("SELECT title FROM study_materials", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "Synthetic airspace packet");
}

// ------------------------------------------- shared frontend contract cases

/// Apply one case's patches (see fixtures/import-contract/cases.json).
fn patched(base: &Value, patches: &[Value]) -> Value {
    let mut op = base.clone();
    for patch in patches {
        let pointer = patch["pointer"].as_str().unwrap();
        let value = match (&patch["repeat"], &patch["value"]) {
            (Value::String(ch), _) => {
                Value::String(ch.repeat(patch["count"].as_u64().unwrap() as usize))
            }
            (_, value) => value.clone(),
        };
        if pointer.is_empty() {
            op = value;
            continue;
        }
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let target = op.pointer_mut(parent).unwrap();
        match target {
            Value::Object(map) if patch["delete"] == json!(true) => {
                map.remove(key);
            }
            Value::Object(map) => {
                map.insert(key.to_string(), value);
            }
            Value::Array(items) => items[key.parse::<usize>().unwrap()] = value,
            _ => panic!("cannot patch {pointer}"),
        }
    }
    op
}

#[test]
fn the_shared_contract_cases_give_the_same_outcome_as_the_browser_transaction() {
    // operation.json is what the real validator and buildImportOperation
    // produce for the accepted 02 fixture packet (asserted on the TypeScript side).
    let base: Value =
        serde_json::from_str(include_str!("../fixtures/import-contract/operation.json")).unwrap();
    let cases: Value =
        serde_json::from_str(include_str!("../fixtures/import-contract/cases.json")).unwrap();
    let cases = cases["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 49);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let op = patched(&base, case["patches"].as_array().unwrap());
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        let outcome = match save(dir.path(), &op) {
            Ok(NativeImportSaveResult::Saved { .. }) => "saved".to_string(),
            Ok(other) => panic!("{name}: unexpected {other:?}"),
            Err(error) => {
                assert_sanitized(&error, &["apiKey_secret", "extraField", "sensitive"]);
                assert_eq!(counts(&conn), [0, 0, 0], "{name}: a refusal wrote rows");
                error.code
            }
        };
        assert_eq!(outcome, case["expected"].as_str().unwrap(), "{name}");
    }
}

// ------------------------------------------------- SB-R2 NFC regressions

#[test]
fn sb_r2_nfc_equivalent_choices_are_rejected() {
    let mut op = operation(ID);
    op["practiceTest"]["questions"][0]["options"] = json!(["Café", "Cafe\u{301}"]);
    assert!(
        matches!(
            decode_import_operation(&op),
            Err(ImportSaveCode::InvalidArgument)
        ),
        "native must reject duplicate choices after NFC, like TypeScript"
    );
}

#[test]
fn sb_r2_nfc_title_limit_is_applied_after_composition() {
    let mut op = operation(ID);
    let title = "e\u{301}".repeat(200);
    with_title(&mut op, &title);
    assert!(
        decode_import_operation(&op).is_ok(),
        "200 NFC characters must fit the 200-code-point title limit"
    );
}

#[test]
fn sb_r2_canonically_equivalent_material_and_aid_titles_match() {
    let mut op = operation(ID);
    op["material"]["title"] = json!("Café");
    op["studySet"]["title"] = json!("Cafe\u{301}");
    op["practiceTest"]["title"] = json!("Cafe\u{301}");
    assert!(
        decode_import_operation(&op).is_ok(),
        "canonically equivalent material and aid titles must match"
    );
}

#[test]
fn sb_r2_stored_content_is_canonical_and_equivalent_retry_is_already_saved() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let mut op = operation(ID);
    let nfd_title = "Cafe\u{301} Airspace";
    with_title(&mut op, nfd_title);
    op["studySet"]["summary"] = json!("Summary with e\u{301}");
    let res = save(dir.path(), &op).unwrap();
    assert_eq!(
        res,
        NativeImportSaveResult::Saved {
            material_id: ID.into()
        }
    );

    let stored_title: String = conn
        .query_row(
            "SELECT title FROM study_materials WHERE id = ?1",
            [ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored_title, "Café Airspace",
        "stored title must be canonical NFC"
    );

    let stored_summary: String = conn
        .query_row(
            "SELECT summary FROM ai_study_sets WHERE source_material_id = ?1",
            [ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored_summary, "Summary with é",
        "stored summary must be canonical NFC"
    );

    let initial_snapshot = snapshot(&conn);

    let mut retry_op = operation(ID);
    with_title(&mut retry_op, "Café Airspace");
    retry_op["studySet"]["summary"] = json!("Summary with é");
    let retry_res = save(dir.path(), &retry_op).unwrap();
    assert_eq!(
        retry_res,
        NativeImportSaveResult::AlreadySaved {
            material_id: ID.into()
        }
    );

    assert_eq!(
        snapshot(&conn),
        initial_snapshot,
        "retry must not modify rows or timestamps"
    );
}

#[test]
fn sb_r2_combining_sequences_that_do_not_compose_are_retained() {
    let mut op = operation(ID);
    let uncomposed = "q\u{307}uestion";
    with_title(&mut op, uncomposed);
    let decoded = decode_import_operation(&op)
        .expect("combining sequence that does not compose must be accepted");
    assert_eq!(
        decoded.title, uncomposed,
        "non-composing sequence must be preserved"
    );
}

/// OFFLINE-03b r7 §4: the native create-new packet path writes practice rows
/// outside the authoring API, so its output has to land inside the schema-17
/// contract anyway — plan §8 "Import parity". The TypeScript half of this
/// behaviour is `IP-17-01` in `src/data/repositories/importStudyPacket.test.ts`.
#[test]
fn imported_packet_satisfies_the_schema_17_authoring_contract() {
    use crate::practice_authoring::{
        practice_content_hash, practice_retirement_record, read_current_snapshot,
        retirement_record_value, save_practice_authoring_at, snapshot_value, AuthoringQuestion,
    };

    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    // The wire form of one snapshot question, as `decode_question` accepts it:
    // five content fields plus the identity, with `origin`/`replaces` only when
    // the row actually carries them.
    let question_json = |item: &AuthoringQuestion| {
        let mut value = json!({
            "question": item.question,
            "options": item.options,
            "correctIndex": item.correct_index,
            "explanation": item.explanation,
            "sourcePage": item.source_page,
            "identity": item.identity,
        });
        let map = value.as_object_mut().unwrap();
        if let Some(origin) = &item.origin {
            map.insert("origin".to_string(), json!(origin));
        }
        if let Some(replaces) = &item.replaces {
            map.insert("replaces".to_string(), json!(replaces));
        }
        value
    };
    assert_eq!(
        save(dir.path(), &operation(ID)).unwrap(),
        NativeImportSaveResult::Saved {
            material_id: ID.into()
        }
    );

    // The ledger defaults to empty and the mirror keeps the imported provenance.
    let (retired_json, provider, model): (String, String, String) = conn
        .query_row(
            "SELECT retired_json, provider, model FROM practice_tests WHERE source_material_id = ?1",
            [ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(retired_json, "[]");
    assert_eq!(provider, "import");
    assert_eq!(model, "");

    // Imported items carry no authoring ids — so each one's immutable row id is
    // its deterministic identity.
    let imported: Vec<(String, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT i.id, i.logical_id, i.replaces_id FROM practice_test_items i
                   JOIN practice_test_versions v ON v.id = i.version_id
                  WHERE v.source_material_id = ?1 AND v.is_active = 1 ORDER BY i.ordinal",
            )
            .unwrap();
        stmt.query_map([ID], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert_eq!(imported.len(), 1);
    for (_, logical, replaces) in &imported {
        assert!(logical.is_none(), "an imported item gains no identity");
        assert!(
            replaces.is_none(),
            "an imported item records no replacement"
        );
    }

    let stored_hash: String = conn
        .query_row(
            "SELECT content_hash FROM practice_test_versions WHERE source_material_id = ?1 AND is_active = 1",
            [ID],
            |r| r.get(0),
        )
        .unwrap();

    // The schema-17 validator accepts exactly what the importer wrote.
    crate::backup::verify_schema_17_practice_authoring_semantics(&conn)
        .expect("an imported packet must satisfy the schema-17 authoring contract");

    let current = read_current_snapshot(&conn, ID)
        .unwrap()
        .expect("the imported test reads back as the current snapshot");
    assert_eq!(
        practice_content_hash(&current.questions),
        stored_hash,
        "the legacy five-field content hash must survive the authoring reader unchanged"
    );
    assert_eq!(current.provider, "import");
    assert_eq!(current.version_number, 1);
    assert!(current.retired.is_empty());
    assert_eq!(
        current
            .questions
            .iter()
            .map(|question| question.identity.clone())
            .collect::<Vec<_>>(),
        imported
            .iter()
            .map(|(id, _, _)| id.clone())
            .collect::<Vec<_>>(),
        "the snapshot's identities are the imported row ids"
    );

    // An authoring edit of the imported test goes through, keeping the fallback
    // identities and the imported provenance.
    let before = current.questions[0].clone();
    let record = retirement_record_value(&practice_retirement_record(&before, "corrected"));
    let rewritten = {
        let mut value = question_json(&before);
        value["question"] = json!("What must you hold before entering Class B?");
        value
    };
    let edit = json!({
        "operationId": "7d1f4a90-3c2b-4e5f-8a90-0b1c2d3e4f50",
        "sourceMaterialId": ID,
        "reason": "edit",
        "expected": snapshot_value(&current),
        "next": {
            "title": current.title,
            "provider": current.provider,
            "model": current.model,
            "questions": [rewritten],
            "retired": [record.clone()],
        },
    });
    assert_eq!(
        save_practice_authoring_at(dir.path(), &edit)
            .unwrap()
            .status,
        "saved"
    );

    let after = read_current_snapshot(&conn, ID)
        .unwrap()
        .expect("the edited imported test still reads back");
    assert_eq!(after.version_number, 2);
    assert_eq!(after.provider, "import");
    assert_eq!(after.model, "");
    assert_eq!(after.retired.len(), 1);
    assert_eq!(
        after
            .questions
            .iter()
            .map(|question| question.identity.clone())
            .collect::<Vec<_>>(),
        current
            .questions
            .iter()
            .map(|question| question.identity.clone())
            .collect::<Vec<_>>(),
        "the fallback identities travel into the new version unchanged"
    );
    let (provider_after, retired_after): (String, String) = conn
        .query_row(
            "SELECT provider, retired_json FROM practice_tests WHERE source_material_id = ?1",
            [ID],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(provider_after, "import");
    assert_eq!(
        serde_json::from_str::<Value>(&retired_after).unwrap(),
        Value::Array(vec![record]),
        "the mirror's ledger holds exactly the one retirement the edit carried"
    );
    crate::backup::verify_schema_17_practice_authoring_semantics(&conn)
        .expect("the edited imported packet must still satisfy the schema-17 contract");
}

// GEN-03: these operations are independently asserted against real PDF-kit/03b
// authoring -> export -> validation -> operation preparation by studyPacketHandoff.test.ts.
fn gen03_fixtures() -> Vec<Value> {
    [
        include_str!("../fixtures/import-contract/gen03-operation.json"),
        include_str!("../fixtures/import-contract/gen03-handwritten-operation.json"),
    ]
    .iter()
    .map(|text| serde_json::from_str(text).unwrap())
    .collect()
}

fn assert_gen03_reopened(root: &Path, op: &Value) {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    let material: (String, Option<String>) = conn
        .query_row(
            "SELECT title, file_path FROM study_materials WHERE id = ?1",
            [ID],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(material.0, op["material"]["title"].as_str().unwrap());
    assert_eq!(material.1, None);
    if !op["studySet"].is_null() {
        let row: (String, String, String, String, String, String, String) = conn.query_row(
            "SELECT title, summary, sections_json, flashcards_json, source_notes, provider, model FROM ai_study_sets WHERE source_material_id = ?1", [ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        ).unwrap();
        let set = &op["studySet"];
        assert_eq!(row.0, set["title"].as_str().unwrap());
        assert_eq!(row.1, set["summary"].as_str().unwrap());
        assert_eq!(
            serde_json::from_str::<Value>(&row.2).unwrap(),
            set["sections"]
        );
        assert_eq!(
            serde_json::from_str::<Value>(&row.3).unwrap(),
            set["flashcards"]
        );
        assert_eq!(row.4, set["sourceNotes"].as_str().unwrap());
        assert_eq!((row.5.as_str(), row.6.as_str()), ("import", ""));
    } else {
        assert_eq!(count(&conn, "ai_study_sets"), 0);
    }
    if !op["practiceTest"].is_null() {
        let row: (String, String, String, String) = conn.query_row(
            "SELECT title, questions_json, provider, model FROM practice_tests WHERE source_material_id = ?1", [ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).unwrap();
        assert_eq!(row.0, op["practiceTest"]["title"].as_str().unwrap());
        assert_eq!(
            serde_json::from_str::<Value>(&row.1).unwrap(),
            op["practiceTest"]["questions"]
        );
        assert_eq!((row.2.as_str(), row.3.as_str()), ("import", ""));
        let items: Vec<Value> = conn.prepare("SELECT question_text, options_json, correct_index, explanation, source_page FROM practice_test_items ORDER BY ordinal").unwrap()
            .query_map([], |r| Ok(json!({ "question": r.get::<_, String>(0)?, "options": serde_json::from_str::<Value>(&r.get::<_, String>(1)?).unwrap(), "correctIndex": r.get::<_, i64>(2)?, "explanation": r.get::<_, String>(3)?, "sourcePage": r.get::<_, Option<i64>>(4)? }))).unwrap()
            .map(Result::unwrap).collect();
        assert_eq!(json!(items), op["practiceTest"]["questions"]);
        assert_eq!(count(&conn, "practice_test_versions"), 1);
        assert_eq!(count(&conn, "practice_attempts"), 0);
    } else {
        assert_eq!(count(&conn, "practice_tests"), 0);
    }
}

fn gen03_operation(mut op: Value) -> Value {
    op["materialId"] = json!(ID);
    op["operationId"] = json!(ID);
    op
}

#[test]
fn all_three_parts_export_import_reopen_match() {
    for fixture in gen03_fixtures() {
        let dir = TestDir::new();
        drop(setup_db(dir.path()));
        let op = gen03_operation(fixture);
        assert!(matches!(
            save(dir.path(), &op).unwrap(),
            NativeImportSaveResult::Saved { .. }
        ));
        assert_gen03_reopened(dir.path(), &op);
    }
}

#[test]
fn guide_only_cards_only_test_only_roundtrip() {
    for part in ["guide", "cards", "test"] {
        let dir = TestDir::new();
        drop(setup_db(dir.path()));
        let mut op = gen03_operation(gen03_fixtures().remove(0));
        if part == "test" {
            op["studySet"] = Value::Null;
        } else {
            op["practiceTest"] = Value::Null;
            if part == "guide" {
                op["studySet"]["flashcards"] = json!([]);
            } else {
                op["studySet"]["summary"] = json!("");
                op["studySet"]["sections"] = json!([]);
                op["studySet"]["sourceNotes"] = json!("");
            }
        }
        save(dir.path(), &op).unwrap();
        assert_gen03_reopened(dir.path(), &op);
    }
}

#[test]
fn import_commit_ack_crash_idempotent() {
    let dir = TestDir::new();
    let conn = setup_db(dir.path());
    let op = gen03_operation(gen03_fixtures().remove(0));
    // The command commits, but its acknowledgement is lost. Reopen and resend.
    save(dir.path(), &op).unwrap();
    let before = snapshot(&conn);
    drop(conn);
    assert!(matches!(
        save(dir.path(), &op).unwrap(),
        NativeImportSaveResult::AlreadySaved { .. }
    ));
    let reopened = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    assert_eq!(snapshot(&reopened), before);
    assert_gen03_reopened(dir.path(), &op);
}

#[test]
fn import_midwrite_failure_rolls_back_every_part() {
    for table in [
        "ai_study_sets",
        "practice_tests",
        "practice_test_versions",
        "practice_test_items",
    ] {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        let op = gen03_operation(gen03_fixtures().remove(0));
        abort_trigger(&conn, table);
        assert_eq!(code(save(dir.path(), &op)), "STORAGE_FAILURE");
        for table in [
            "study_materials",
            "ai_study_sets",
            "practice_tests",
            "practice_test_versions",
            "practice_test_items",
        ] {
            assert_eq!(count(&conn, table), 0);
        }
        conn.execute_batch("DROP TRIGGER synthetic_abort").unwrap();
        save(dir.path(), &op).unwrap();
        assert_gen03_reopened(dir.path(), &op);
    }
}
