//! OFFLINE-03b r6 — the native side of the shared parity fixture.
//!
//! `src/testing/practiceAuthoringVectors.json` is generated once from the
//! TypeScript reference contract and asserted identically by
//! `src/data/practiceAuthoringParity.test.ts` and by the runner here. If the
//! Rust engine disagrees with the fixture, the Rust is wrong. The
//! conventions copied from the TypeScript runner's header:
//! - a FRESH database per scenario (all migrations applied, foreign keys
//!   on) with `mat-a` and `mat-b` pre-inserted as study materials;
//! - `"$current"` / `"$current:<mat>"` are substituted with the live
//!   `read_current_snapshot` result before the save; `null` stays `null`;
//! - the summary fields are `versionNumber`, `contentHash` =
//!   `practiceContentHash(questions)`, `questionCount`, `origins` aligned
//!   to `ordinal` with null where a question carries no origin, and
//!   `retiredCount` = ledger length;
//! - `expect` is either `{status, current}` or `{error: "<CODE>"}`;
//! - server-owned ids and timestamps are deliberately NOT asserted — they
//!   differ per engine by design.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::practice_authoring::{
    append_practice_retirements, decode_question, entry_json, practice_content_hash,
    practice_retirement_record, read_current_snapshot, retirement_record_value,
    save_practice_authoring_at, snapshot_value, PracticeAuthoringErrorCode, RetirementRecord,
};
use crate::practice_sessions::{
    compute_canonical_content_hash_from_parsed, compute_canonical_hash, mark_root_ready,
    save_practice_session_at, ParsedLegacyQuestion,
};

const STAMP: &str = "2026-10-20T02:00:00.000Z";

/// An owned temporary directory for test databases, cleaned up on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-practice-authoring-test-{label}-{}-{}",
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    hash_vectors: Vec<HashVector>,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashVector {
    name: String,
    questions: Vec<Value>,
    content_hash: String,
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    operation: Value,
    expect: Value,
}

fn fixture() -> Fixture {
    serde_json::from_str(include_str!(
        "../../src/testing/practiceAuthoringVectors.json"
    ))
    .unwrap()
}

/// A fresh database with every migration applied, foreign keys on, and
/// `mat-a`/`mat-b` pre-inserted — the shared runner's seeding.
fn seeded_database(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for migration in crate::migrations() {
        conn.execute_batch(migration.sql).unwrap();
    }
    for [id, title] in [
        ["mat-a", "Parity material A"],
        ["mat-b", "Parity material B"],
    ] {
        conn.execute(
            "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params![id, title, STAMP],
        )
        .unwrap();
    }
    conn
}

fn open_reader(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn
}

/// The `$current` substitution: the material's live snapshot as the exact
/// decoded JSON, or null when there is none.
fn snapshot_json(conn: &Connection, material_id: &str) -> Value {
    read_current_snapshot(conn, material_id)
        .unwrap()
        .map(|snapshot| snapshot_value(&snapshot))
        .unwrap_or(Value::Null)
}

/// The shared summary: versionNumber, contentHash, questionCount, origins
/// aligned to ordinal, retiredCount.
fn current_summary(conn: &Connection, material_id: &str) -> Value {
    let Some(current) = read_current_snapshot(conn, material_id).unwrap() else {
        return Value::Null;
    };
    json!({
        "versionNumber": current.version_number,
        "contentHash": practice_content_hash(&current.questions),
        "questionCount": current.questions.len(),
        "origins": current
            .questions
            .iter()
            .map(|q| q.origin.clone().map(Value::String).unwrap_or(Value::Null))
            .collect::<Vec<_>>(),
        "retiredCount": current.retired.len(),
    })
}

/// The fixture's raw hash-vector questions projected exactly as
/// `canonicalHashableQuestions` does: five content fields, plus `origin`
/// only when present; identity and replaces never join.
fn hash_vector_value(questions: &[Value]) -> String {
    let projected: Vec<Value> = questions
        .iter()
        .map(|question| {
            let map = question.as_object().unwrap();
            let mut out = Map::new();
            for key in [
                "question",
                "options",
                "correctIndex",
                "explanation",
                "sourcePage",
            ] {
                out.insert(
                    key.to_string(),
                    map.get(key).cloned().unwrap_or(Value::Null),
                );
            }
            if let Some(origin) = map.get("origin") {
                out.insert("origin".to_string(), origin.clone());
            }
            Value::Object(out)
        })
        .collect();
    compute_canonical_hash(&Value::Array(projected))
}

#[test]
fn shared_practice_authoring_hash_vectors_native() {
    let fixture = fixture();
    let mut mismatches: Vec<String> = Vec::new();
    for vector in &fixture.hash_vectors {
        let computed = hash_vector_value(&vector.questions);
        if computed != vector.content_hash {
            mismatches.push(format!(
                "{}: computed {computed} != stored {}",
                vector.name, vector.content_hash
            ));
        }
        // Origin-less sets must be byte-identical to the legacy
        // five-field hash the native conversion produces today.
        let originless = vector.questions.iter().all(|q| q.get("origin").is_none());
        if originless {
            let parsed: Vec<ParsedLegacyQuestion> = vector
                .questions
                .iter()
                .map(|q| ParsedLegacyQuestion {
                    question: q["question"].as_str().unwrap().to_string(),
                    options: q["options"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|o| o.as_str().unwrap().to_string())
                        .collect(),
                    correct_index: q["correctIndex"].as_i64().unwrap() as usize,
                    explanation: q["explanation"].as_str().unwrap().to_string(),
                    source_page: q["sourcePage"].as_i64(),
                })
                .collect();
            let legacy = compute_canonical_content_hash_from_parsed(&parsed);
            if legacy != vector.content_hash {
                mismatches.push(format!(
                    "{}: legacy five-field hash {legacy} != stored {}",
                    vector.name, vector.content_hash
                ));
            }
        }
    }
    let present = fixture
        .hash_vectors
        .iter()
        .find(|v| v.name == "identity-and-replaces-present")
        .expect("identity-and-replaces pair present");
    let removed = fixture
        .hash_vectors
        .iter()
        .find(|v| v.name == "identity-and-replaces-removed")
        .expect("identity-and-replaces pair present");
    if hash_vector_value(&present.questions) != hash_vector_value(&removed.questions) {
        mismatches.push("identity/replaces pair hashes differ — they must never join".to_string());
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn shared_practice_authoring_contract_native_outcomes() {
    let fixture = fixture();
    let mut mismatches: Vec<String> = Vec::new();
    for scenario in &fixture.scenarios {
        let dir = TempDir::new(&scenario.name);
        drop(seeded_database(dir.path()));
        for (index, step) in scenario.steps.iter().enumerate() {
            let material = step.operation["sourceMaterialId"]
                .as_str()
                .unwrap()
                .to_string();
            let operation_id = step.operation["operationId"].as_str().unwrap();
            let label = format!(
                "{} step {} ({} {})",
                scenario.name,
                index + 1,
                step.operation["reason"].as_str().unwrap_or("?"),
                &operation_id[operation_id.len() - 4..],
            );
            let raw = &step.operation["expected"];
            let expected = match raw {
                Value::String(token) if token == "$current" => {
                    let conn = open_reader(dir.path());
                    let value = snapshot_json(&conn, &material);
                    drop(conn);
                    value
                }
                Value::String(token) if token.starts_with("$current:") => {
                    let conn = open_reader(dir.path());
                    let value = snapshot_json(&conn, &token["$current:".len()..]);
                    drop(conn);
                    value
                }
                other => other.clone(),
            };
            let mut operation = step.operation.clone();
            operation
                .as_object_mut()
                .unwrap()
                .insert("expected".to_string(), expected);
            let actual = match super::practice_authoring::execute_practice_authoring(
                &mut open_reader(dir.path()),
                &operation,
            ) {
                Ok(result) => {
                    let conn = open_reader(dir.path());
                    let mut current = current_summary(&conn, &material);
                    if step.expect["current"].get("pdfSourceCount").is_some() && !current.is_null()
                    {
                        let n: i64 = conn.query_row("SELECT COUNT(*) FROM pdf_kit_item_sources s JOIN pdf_kit_runs r ON r.run_id = s.run_id WHERE r.material_id = ?1", [&material], |r| r.get(0)).unwrap();
                        current["pdfSourceCount"] = json!(n);
                    }
                    let value = json!({
                        "status": result.status,
                        "current": current,
                    });
                    drop(conn);
                    value
                }
                Err(wire) => json!({
                    "error": serde_json::to_value(wire.code).unwrap().as_str().unwrap(),
                }),
            };
            if actual != step.expect {
                mismatches.push(format!(
                    "{label}: expected {}, Rust gave {}",
                    step.expect, actual
                ));
            }
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

/// Mirrors `every_native_message_is_the_typescript_allowlisted_message`:
/// each code's message is the allowlisted TypeScript string, byte for byte.
/// There is no native `IPC_TRANSPORT_ERROR`; that code is TypeScript-only.
#[test]
fn every_native_practice_authoring_message_is_the_typescript_allowlisted_message() {
    let typescript = include_str!("../../src/data/persistenceErrors.ts");
    for code in [
        PracticeAuthoringErrorCode::InvalidArgument,
        PracticeAuthoringErrorCode::StaleContent,
        PracticeAuthoringErrorCode::Conflict,
        PracticeAuthoringErrorCode::AttemptActive,
        PracticeAuthoringErrorCode::RetirementLimit,
        PracticeAuthoringErrorCode::NotFound,
        PracticeAuthoringErrorCode::StorageError,
    ] {
        let wire = serde_json::to_value(code.error()).unwrap();
        let name = wire["code"].as_str().unwrap();
        let entry = format!("{name}: {}", serde_json::to_string(code.message()).unwrap());
        assert!(
            typescript.contains(&entry),
            "missing TypeScript entry: {entry}"
        );
    }
}

/// The ported ledger append retains, deduplicates and bounds exactly as the
/// TS `appendPracticeRetirements` contract states: records are only ever
/// retained or added, and the whole growth beyond 2,000 refuses.
#[test]
fn append_practice_retirements_retains_grows_and_caps() {
    let record = |item_id: &str, digest: usize, terms: &[&str]| RetirementRecord {
        kind: "question".to_string(),
        item_id: item_id.to_string(),
        reason: "deleted".to_string(),
        text_key: format!("{digest:064x}"),
        terms: terms.iter().map(|t| t.to_string()).collect(),
    };
    let existing = vec![record("id-1", 1, &["alpha"])];
    let incoming = vec![
        record("id-1", 1, &["alpha"]), // exact repeat — deduplicated
        record("id-2", 2, &["bravo"]),
    ];
    let out = append_practice_retirements(&existing, &incoming).unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(entry_json(&out[0]), entry_json(&existing[0]));
    assert_eq!(entry_json(&out[1]), entry_json(&incoming[1]));
    let big: Vec<RetirementRecord> = (0..=2_000)
        .map(|i| record(&format!("many-{i}"), i, &["word"]))
        .collect();
    assert_eq!(
        append_practice_retirements(&existing, &big),
        Err(PracticeAuthoringErrorCode::RetirementLimit)
    );
}

/* ------------------------------------------------------------------ */
/* Native-only contracts (main prompt section C3) and schema-17        */
/* application verification (r6c item 1d).                             */
/* ------------------------------------------------------------------ */

/// One question in the shared exact-key shape; absent optional keys are
/// omitted, never sent as null (`exactKeys` refuses an unknown key, and
/// `origin: null` is not a string).
fn q_json(identity: &str, stem: &str, origin: Option<&str>, replaces: Option<&str>) -> Value {
    let mut map = Map::new();
    map.insert("question".into(), json!(stem));
    map.insert("options".into(), json!(["Alpha option", "Bravo option"]));
    map.insert("correctIndex".into(), json!(0));
    map.insert(
        "explanation".into(),
        json!(format!("Synthetic explanation for {stem}.")),
    );
    map.insert("sourcePage".into(), Value::Null);
    map.insert("identity".into(), json!(identity));
    if let Some(origin) = origin {
        map.insert("origin".into(), json!(origin));
    }
    if let Some(replaces) = replaces {
        map.insert("replaces".into(), json!(replaces));
    }
    Value::Object(map)
}

fn next_json(title: &str, provider: &str, questions: Vec<Value>, retired: Vec<Value>) -> Value {
    json!({ "title": title, "provider": provider, "model": "", "questions": questions, "retired": retired })
}

fn op(
    operation_id: &str,
    material_id: &str,
    reason: &str,
    expected: Value,
    next: Option<Value>,
) -> Value {
    json!({
        "operationId": operation_id,
        "sourceMaterialId": material_id,
        "reason": reason,
        "expected": expected,
        "next": next.unwrap_or(Value::Null),
    })
}

/// The exact ledger entry one wording produces — the same fingerprint the
/// TS `practiceRetirementRecord` builds for the same question.
fn retirement_for(question: &Value, reason: &str) -> Value {
    retirement_record_value(&practice_retirement_record(
        &decode_question(question).unwrap(),
        reason,
    ))
}

fn current_json(root: &std::path::Path, material_id: &str) -> Value {
    let conn = open_reader(root);
    let value = snapshot_json(&conn, material_id);
    drop(conn);
    value
}

fn count_rows(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// The way an installed library records its migrations — the verification
/// ladder reads this table before it runs any schema check.
fn recorded_migrations(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
    )
    .unwrap();
    for migration in crate::migrations() {
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            rusqlite::params![migration.version],
        )
        .unwrap();
    }
}

/// A library fully migrated to schema 17 with a real authored test (receipt,
/// mirror, history and origins rows) passes the whole application ladder —
/// including the new `verify_schema_17_practice_authoring_semantics`.
#[test]
fn a_fully_migrated_schema_17_library_passes_application_verification() {
    let dir = TempDir::new("verify-17-pass");
    let conn = seeded_database(dir.path());
    recorded_migrations(&conn);
    drop(conn);

    let identity = "fa000000-0000-4000-8000-0000000000e1";
    let q = q_json(identity, "Verification stem", Some("user"), None);
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000e0",
            "mat-a",
            "create",
            Value::Null,
            Some(next_json(
                "Verification test",
                "manual",
                vec![q.clone()],
                vec![],
            )),
        ),
    )
    .unwrap();
    let edited = q_json(identity, "Verification stem edited", Some("user"), None);
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000e2",
            "mat-a",
            "edit",
            current_json(dir.path(), "mat-a"),
            Some(next_json(
                "Verification test",
                "manual",
                vec![edited],
                vec![retirement_for(&q, "corrected")],
            )),
        ),
    )
    .unwrap();

    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    crate::backup::verify_application_connection(&conn)
        .expect("a fully migrated schema-17 authoring library must verify");
}

/// The 0017 columns are demanded at 17 and nowhere weaker: a schema-17
/// library whose `practice_test_items` lost `logical_id` is refused with the
/// neighbouring check's message naming the column.
#[test]
fn a_schema_17_library_without_logical_id_is_refused() {
    let dir = TempDir::new("verify-17-no-logical-id");
    let conn = seeded_database(dir.path());
    recorded_migrations(&conn);
    drop(conn);

    let identity = "fa000000-0000-4000-8000-0000000000e5";
    let q = q_json(identity, "Verification stem", Some("user"), None);
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000e4",
            "mat-a",
            "create",
            Value::Null,
            Some(next_json("Verification test", "manual", vec![q], vec![])),
        ),
    )
    .unwrap();

    // SQLite cannot drop a column: rebuild the table without logical_id,
    // keeping every row, the 0017 replaces_id column, the compound UNIQUE
    // and the secondary index the schema-11 contract demands. The two
    // response-version triggers name the table, so they travel with it —
    // recreated from migration 0011's exact text the contract compares.
    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
    conn.execute_batch(
        "BEGIN;
         DROP TRIGGER trg_enforce_response_item_version_insert;
         DROP TRIGGER trg_enforce_response_item_version_update;
         CREATE TABLE practice_test_items_rebuilt (
            id            TEXT PRIMARY KEY,
            version_id    TEXT NOT NULL REFERENCES practice_test_versions(id) ON DELETE CASCADE,
            ordinal       INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            options_json  TEXT NOT NULL,
            correct_index INTEGER NOT NULL,
            explanation   TEXT NOT NULL DEFAULT '',
            source_page   INTEGER,
            replaces_id   TEXT,
            UNIQUE(version_id, ordinal)
         );
         INSERT INTO practice_test_items_rebuilt (
            id, version_id, ordinal, question_text, options_json,
            correct_index, explanation, source_page, replaces_id
         ) SELECT id, version_id, ordinal, question_text, options_json,
                   correct_index, explanation, source_page, replaces_id
              FROM practice_test_items;
         DROP TABLE practice_test_items;
         ALTER TABLE practice_test_items_rebuilt RENAME TO practice_test_items;
         CREATE INDEX idx_practice_items_version ON practice_test_items(version_id, ordinal);
         CREATE TRIGGER trg_enforce_response_item_version_insert
         BEFORE INSERT ON practice_responses
         FOR EACH ROW
         BEGIN
             SELECT RAISE(ABORT, 'Item does not belong to attempt version')
             WHERE (
                 SELECT version_id FROM practice_attempts WHERE id = NEW.attempt_id
             ) != (
                 SELECT version_id FROM practice_test_items WHERE id = NEW.item_id
             );
         END;
         CREATE TRIGGER trg_enforce_response_item_version_update
         BEFORE UPDATE OF item_id, attempt_id ON practice_responses
         FOR EACH ROW
         BEGIN
             SELECT RAISE(ABORT, 'Item does not belong to attempt version')
             WHERE (
                 SELECT version_id FROM practice_attempts WHERE id = NEW.attempt_id
             ) != (
                 SELECT version_id FROM practice_test_items WHERE id = NEW.item_id
             );
         END;
         COMMIT;",
    )
    .unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();

    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert_eq!(
        error,
        "Table practice_test_items missing required column: logical_id"
    );
    assert!(error.contains("logical_id"));
}

/// C3(a): manual editing refuses while an attempt is in progress; plain
/// regeneration replaces and abandons — the native mirror of the TS test,
/// starting the attempt through `save_practice_session_at` exactly as
/// `practice_session_tests.rs` does.
#[test]
fn attempt_active_refuses_editing_and_regeneration_abandons_the_attempt() {
    let dir = TempDir::new("attempt-active");
    let conn = seeded_database(dir.path());
    drop(conn);
    mark_root_ready(dir.path());

    let identity = "fa000000-0000-4000-8000-0000000000a1";
    let q = q_json(identity, "Attempt guard stem", None, None);
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000a0",
            "mat-a",
            "create",
            Value::Null,
            Some(next_json(
                "Attempt guard test",
                "gemini",
                vec![q.clone()],
                vec![],
            )),
        ),
    )
    .unwrap();

    let version_id = {
        let conn = open_reader(dir.path());
        read_current_snapshot(&conn, "mat-a")
            .unwrap()
            .unwrap()
            .version_id
    };
    let started = save_practice_session_at(
        dir.path(),
        &json!({
            "action": "start_or_resume",
            "operationId": "fa000000-0000-4000-8000-0000000000a3",
            "materialId": "mat-a",
            "versionId": version_id,
        }),
    )
    .unwrap();
    let attempt_id = started["attemptId"].as_str().unwrap().to_string();

    let expected = current_json(dir.path(), "mat-a");
    let edited = q_json(identity, "Edited while active", None, None);
    let wire = save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000a4",
            "mat-a",
            "edit",
            expected.clone(),
            Some(next_json(
                "Attempt guard test",
                "manual",
                vec![edited],
                vec![retirement_for(&q, "corrected")],
            )),
        ),
    )
    .unwrap_err();
    assert_eq!(wire.code, PracticeAuthoringErrorCode::AttemptActive);
    assert_eq!(
        wire.message,
        "Finish or abandon your current practice attempt before editing these questions. Nothing has been saved."
    );

    let replacement = q_json(
        "fa000000-0000-4000-8000-0000000000a5",
        "Freshly generated",
        None,
        None,
    );
    let saved = save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000a6",
            "mat-a",
            "regenerate",
            expected,
            Some(next_json(
                "Attempt guard test",
                "gemini",
                vec![replacement],
                vec![],
            )),
        ),
    )
    .unwrap();
    assert_eq!(saved.status, "saved");

    let conn = open_reader(dir.path());
    let status: String = conn
        .query_row(
            "SELECT status FROM practice_attempts WHERE id = ?1",
            rusqlite::params![attempt_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "abandoned");
    let current = read_current_snapshot(&conn, "mat-a").unwrap().unwrap();
    assert_eq!(current.version_number, 2);
    assert_eq!(
        count_rows(
            &conn,
            "SELECT COUNT(*) FROM practice_test_versions WHERE is_active = 1"
        ),
        1
    );
}

/// C3(b): an injected failure mid-transaction rolls back receipt, history,
/// version, items and origins — the native shape of the TS injected-failure
/// test, raising ABORT from a trigger on the origins insert.
#[test]
fn an_injected_trigger_failure_mid_transaction_rolls_everything_back() {
    let dir = TempDir::new("injected-failure");
    let conn = seeded_database(dir.path());
    drop(conn);

    let identity = "fa000000-0000-4000-8000-0000000000b1";
    let q = q_json(identity, "Rollback guard stem", Some("user"), None);
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000b0",
            "mat-a",
            "create",
            Value::Null,
            Some(next_json(
                "Rollback guard test",
                "manual",
                vec![q.clone()],
                vec![],
            )),
        ),
    )
    .unwrap();

    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    let before = (
        count_rows(&conn, "SELECT COUNT(*) FROM practice_test_versions"),
        count_rows(
            &conn,
            "SELECT COUNT(*) FROM study_set_history WHERE kind = 'practice'",
        ),
        count_rows(&conn, "SELECT COUNT(*) FROM practice_save_operations"),
        count_rows(&conn, "SELECT COUNT(*) FROM practice_test_items"),
    );
    conn.execute_batch(
        "CREATE TRIGGER trg_injected_authoring_failure
           BEFORE INSERT ON practice_item_origins
         BEGIN
           SELECT RAISE(ABORT, 'injected mid-transaction failure');
         END;",
    )
    .unwrap();
    let expected = snapshot_json(&conn, "mat-a");
    drop(conn);

    let changed = q_json(identity, "Changed synthetic stem", Some("user"), None);
    let wire = save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000b2",
            "mat-a",
            "edit",
            expected,
            Some(next_json(
                "Rollback guard test",
                "manual",
                vec![changed],
                vec![retirement_for(&q, "corrected")],
            )),
        ),
    )
    .unwrap_err();
    assert_eq!(wire.code, PracticeAuthoringErrorCode::StorageError);

    let conn = open_reader(dir.path());
    assert_eq!(
        (
            count_rows(&conn, "SELECT COUNT(*) FROM practice_test_versions"),
            count_rows(
                &conn,
                "SELECT COUNT(*) FROM study_set_history WHERE kind = 'practice'"
            ),
            count_rows(&conn, "SELECT COUNT(*) FROM practice_save_operations"),
            count_rows(&conn, "SELECT COUNT(*) FROM practice_test_items"),
        ),
        before
    );
    let current = read_current_snapshot(&conn, "mat-a").unwrap().unwrap();
    assert_eq!(current.questions[0].question, "Rollback guard stem");
    assert!(current.retired.is_empty());
}

/// C3(c): a legacy-fallback identity (logical_id NULL — the row's own
/// immutable id is its identity) owned by mat-b refuses a mat-a create.
#[test]
fn a_legacy_fallback_identity_owned_by_another_material_refuses_a_create() {
    let dir = TempDir::new("legacy-fallback-identity");
    let conn = seeded_database(dir.path());
    let legacy_item_id = "fa000000-0000-4000-8000-0000000000c1";
    conn.execute(
        "INSERT INTO practice_test_versions (
           id, source_material_id, history_key, source_material_title,
           version_number, provider, model, title, content_hash, created_at, is_active
         ) VALUES ('ver-c-b', 'mat-b', 'mat-b', 'Parity material B', 1, 'gemini', '', 'Legacy B', 'hash-c', ?1, 1)",
        rusqlite::params![STAMP],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO practice_test_items (
           id, version_id, ordinal, question_text, options_json, correct_index
         ) VALUES (?1, 'ver-c-b', 0, 'Legacy B stem', '[\"A\",\"B\"]', 0)",
        rusqlite::params![legacy_item_id],
    )
    .unwrap();
    drop(conn);

    let q = q_json(legacy_item_id, "Colliding stem", None, None);
    let wire = save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000c2",
            "mat-a",
            "create",
            Value::Null,
            Some(next_json("Colliding test", "manual", vec![q], vec![])),
        ),
    )
    .unwrap_err();
    assert_eq!(wire.code, PracticeAuthoringErrorCode::InvalidArgument);

    let conn = open_reader(dir.path());
    assert!(read_current_snapshot(&conn, "mat-a").unwrap().is_none());
    assert_eq!(
        count_rows(&conn, "SELECT COUNT(*) FROM practice_save_operations"),
        0
    );
}

/// C3(d): foreign ownership of a replacement target. mat-a legitimately
/// held identity X — it is in mat-a's preserved authoring history, so the
/// lineage guard passes — while mat-b now holds the living row. The save
/// must still refuse: ownership is resolved over every living material.
#[test]
fn a_foreign_owned_replacement_target_that_passes_lineage_is_refused() {
    let dir = TempDir::new("foreign-replaces");
    let conn = seeded_database(dir.path());
    drop(conn);

    // Step 1: mat-a creates a test holding identity X as her own wording.
    let identity_x = "fa000000-0000-4000-8000-0000000000d1";
    let x = q_json(identity_x, "Identity X stem", Some("user"), None);
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000d0",
            "mat-a",
            "create",
            Value::Null,
            Some(next_json("Lineage test", "manual", vec![x.clone()], vec![])),
        ),
    )
    .unwrap();

    // Step 2: regeneration retires X's exact wording; the v1 snapshot —
    // the one that proves mat-a legitimately held X — stays preserved.
    let z = q_json(
        "fa000000-0000-4000-8000-0000000000d2",
        "Regenerated stem",
        None,
        None,
    );
    save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000d3",
            "mat-a",
            "regenerate",
            current_json(dir.path(), "mat-a"),
            Some(next_json(
                "Lineage test",
                "gemini",
                vec![z],
                vec![retirement_for(&x, "deleted")],
            )),
        ),
    )
    .unwrap();

    // mat-b now holds the living row for X (seeded outside the engine —
    // the state the ownership guard exists to refuse).
    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute(
        "INSERT INTO practice_test_versions (
           id, source_material_id, history_key, source_material_title,
           version_number, provider, model, title, content_hash, created_at, is_active
         ) VALUES ('ver-d-b', 'mat-b', 'mat-b', 'Parity material B', 1, 'gemini', '', 'Foreign B', 'hash-d', ?1, 1)",
        rusqlite::params![STAMP],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO practice_test_items (
           id, version_id, ordinal, question_text, options_json, correct_index, logical_id
         ) VALUES ('item-d-b-x', 'ver-d-b', 0, 'Foreign B stem', '[\"A\",\"B\"]', 0, ?1)",
        rusqlite::params![identity_x],
    )
    .unwrap();
    drop(conn);

    // Step 3: mat-a regenerates again, replacing a question whose target X
    // passes the lineage guard (it is in mat-a's own preserved history and
    // in its ledger) but belongs to a living other material.
    let w = q_json(
        "fa000000-0000-4000-8000-0000000000d4",
        "Replacement stem",
        Some("user"),
        Some(identity_x),
    );
    let wire = save_practice_authoring_at(
        dir.path(),
        &op(
            "fa000000-0000-4000-8000-0000000000d5",
            "mat-a",
            "regenerate",
            current_json(dir.path(), "mat-a"),
            Some(next_json(
                "Lineage test",
                "gemini",
                vec![w],
                vec![retirement_for(&x, "deleted")],
            )),
        ),
    )
    .unwrap_err();
    assert_eq!(wire.code, PracticeAuthoringErrorCode::InvalidArgument);

    // Nothing moved: mat-a still on v2 with exactly two receipts.
    let conn = open_reader(dir.path());
    let current = read_current_snapshot(&conn, "mat-a").unwrap().unwrap();
    assert_eq!(current.version_number, 2);
    assert_eq!(
        current.questions[0].identity,
        "fa000000-0000-4000-8000-0000000000d2"
    );
    assert_eq!(
        count_rows(&conn, "SELECT COUNT(*) FROM practice_save_operations"),
        2
    );
}

/* ------------------------------------------------------------------ */
/* OFFLINE-03b r7: the shared schema-17 validation contract, native    */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
struct ValidationContract {
    baseline: Vec<String>,
    cases: Vec<ValidationCase>,
}

#[derive(Deserialize)]
struct ValidationCase {
    name: String,
    category: String,
    sql: Vec<String>,
    expect: String,
}

/// The native half of `src-tauri/fixtures/practice-authoring-validation/cases.json`:
/// all migrations, then `baseline`, then the case's own `sql`; the database is
/// closed and reopened so a `writable_schema` edit takes effect exactly as it
/// would on the next launch; then `verify_schema_17_practice_authoring_semantics`
/// decides. Its TypeScript twin is `validatePracticeAuthoringState` and its
/// runner is `src/data/practiceAuthoringValidationParity.test.ts`; all three
/// must give the listed outcome for every case.
#[test]
fn shared_practice_authoring_validation_contract_native_outcomes() {
    let contract: ValidationContract = serde_json::from_str(include_str!(
        "../fixtures/practice-authoring-validation/cases.json"
    ))
    .unwrap();
    let mut mismatches = Vec::new();
    for case in &contract.cases {
        let dir = TempDir::new("authoring-contract");
        let path = dir.path().join("her-flight-deck.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for migration in crate::migrations() {
                conn.execute_batch(migration.sql).unwrap();
            }
            for statement in contract.baseline.iter().chain(&case.sql) {
                conn.execute_batch(statement)
                    .unwrap_or_else(|e| panic!("fixture statement failed: {statement}: {e}"));
            }
        }
        let conn = Connection::open(&path).unwrap();
        let result = crate::backup::verify_schema_17_practice_authoring_semantics(&conn);
        let outcome = if result.is_ok() { "accept" } else { "refuse" };
        if outcome != case.expect {
            mismatches.push(format!(
                "{} [{}]: expected {}, got {result:?}",
                case.name, case.category, case.expect
            ));
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
    assert!(contract.cases.len() >= 26);
}

fn kit_operation() -> Value {
    fixture()
        .scenarios
        .into_iter()
        .find(|s| s.name == "pdf-kit-receipt-and-edit-lineage")
        .unwrap()
        .steps
        .remove(0)
        .operation
}
#[test]
fn provenance_atomic_with_save_injected_failure_rolls_back_all() {
    let dir = TempDir::new("kit-rollback");
    let mut conn = seeded_database(dir.path());
    conn.execute_batch("CREATE TRIGGER inject_kit BEFORE INSERT ON practice_tests BEGIN SELECT RAISE(FAIL,'synthetic'); END;").unwrap();
    assert_eq!(
        super::practice_authoring::execute_practice_authoring(&mut conn, &kit_operation())
            .unwrap_err()
            .code,
        PracticeAuthoringErrorCode::StorageError
    );
    for table in [
        "pdf_kit_runs",
        "pdf_kit_item_sources",
        "practice_tests",
        "practice_test_versions",
        "practice_save_operations",
    ] {
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "{table}");
    }
}
#[test]
fn content_hash_mismatch_refused_before_write() {
    let dir = TempDir::new("kit-hash");
    let mut conn = seeded_database(dir.path());
    let mut op = kit_operation();
    op["pdfKitSources"]["items"][0]["contentHash"] = json!("b".repeat(64));
    assert_eq!(
        super::practice_authoring::execute_practice_authoring(&mut conn, &op)
            .unwrap_err()
            .code,
        PracticeAuthoringErrorCode::InvalidArgument
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM pdf_kit_runs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn shared_pdf_kit_study_save_contract() {
    let dir = TempDir::new("kit-study-parity");
    let mut conn = seeded_database(dir.path());
    let steps: Vec<Value> = serde_json::from_str(include_str!(
        "../../src/testing/pdfKitStudySaveVectors.json"
    ))
    .unwrap();
    for step in steps {
        let mut op = step["operation"].clone();
        if op["expected"] == "$current" {
            let mut map = Map::new();
            conn.query_row("SELECT title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at, summary_origin, retired_json FROM ai_study_sets WHERE source_material_id='mat-a'",[],|r| {
                for (i,c) in crate::study_sets::SET_COLUMNS.iter().enumerate() {map.insert(c.to_string(),r.get::<_,Option<String>>(i)?.map(Value::String).unwrap_or(Value::Null));} Ok(())
            }).unwrap();
            op["expected"] = Value::Object(map);
        }
        let actual = match crate::study_sets::decode_operation(&op) {
            Ok(decoded) => match crate::study_sets::save_on(&mut conn, &decoded, STAMP) {
                Ok(r) => json!({"status":r.status}),
                Err(code) => json!({"error":code}),
            },
            Err(code) => json!({"error":code}),
        };
        assert_eq!(actual, step["expect"], "{op}");
    }
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM pdf_kit_item_sources", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn edited_kit_item_keeps_sources_and_shows_edit_origin() {
    let dir = TempDir::new("kit-edit");
    let mut conn = seeded_database(dir.path());
    let op = kit_operation();
    super::practice_authoring::execute_practice_authoring(&mut conn, &op).unwrap();
    let snapshot = read_current_snapshot(&conn, "mat-a").unwrap().unwrap();
    let before = decode_question(&op["next"]["questions"][0]).unwrap();
    let retirement = retirement_record_value(&practice_retirement_record(&before, "corrected"));
    let mut next = op["next"].clone();
    next["questions"][0]["question"] = json!("Edited synthetic question");
    next["questions"][0]["origin"] = json!("instructor");
    next["retired"] = json!([retirement]);
    let edit = json!({"operationId":"001c0001-0000-4000-8000-000000000040","sourceMaterialId":"mat-a","reason":"correct","expected":snapshot_value(&snapshot),"next":next});
    super::practice_authoring::execute_practice_authoring(&mut conn, &edit).unwrap();
    assert_eq!(
        read_current_snapshot(&conn, "mat-a")
            .unwrap()
            .unwrap()
            .questions[0]
            .origin
            .as_deref(),
        Some("instructor")
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM pdf_kit_item_sources", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
