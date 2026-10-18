//! Native skills and feedback evidence contract (M3): real rusqlite
//! transactions, the shared fixtures in `fixtures/skill-evidence/`, the
//! schema 13 -> 14 upgrade, rollback, and the real backup/restore paths.
//! Every value is synthetic.

use super::*;
use std::io::{Read, Write};
use std::path::PathBuf;

use crate::practice_sessions::{mark_root_ready, unmark_root_ready};

/// An owned temporary directory, cleaned up on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "hfd-skill-test-{label}-{}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
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

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/skill-evidence")
        .join(name)
}

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(fixture_path(name)).unwrap()).unwrap()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

fn migration_14() -> &'static str {
    crate::migrations()
        .into_iter()
        .find(|m| m.version == 14)
        .unwrap()
        .sql
}

/// Migrations 1-13 as registered, then 14 (possibly edited), with the
/// plugin's migration table, the way an installed library records them.
fn migrate(conn: &Connection, migration14: Option<&str>) {
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
    )
    .unwrap();
    for m in crate::migrations().into_iter().filter(|m| m.version < 14) {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    if let Some(sql) = migration14 {
        conn.execute_batch(sql).unwrap();
        conn.execute("INSERT INTO _sqlx_migrations (version) VALUES (14)", [])
            .unwrap();
    }
}

fn library() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn, Some(migration_14()));
    conn
}

fn reference() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
    }
    conn
}

fn edited_migration(edits: Option<&Value>) -> String {
    let mut sql = migration_14().to_string();
    for edit in edits.and_then(|e| e.as_array()).into_iter().flatten() {
        let pair = edit.as_array().unwrap();
        let (from, to) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
        assert_eq!(
            sql.matches(from).count(),
            1,
            "migration edit must match exactly once: {from}"
        );
        sql = sql.replacen(from, to, 1);
    }
    sql
}

/// Decode, hash and run one request on an open connection (the command path
/// without the file root), as the TypeScript store does.
fn act(conn: &mut Connection, request: &Value) -> Result<Value, SkillEvidenceErrorCode> {
    let decoded = decode_action(request)?;
    let hash = request_hash(request)?;
    save_on_connection(conn, &decoded, &hash)
}

fn code(result: Result<Value, SkillEvidenceErrorCode>) -> SkillEvidenceErrorCode {
    result.expect_err("expected a refusal")
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn json_rows(conn: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut statement = conn.prepare(sql).unwrap();
    let columns = statement.column_count();
    statement
        .query_map([], |r| {
            let mut out = Vec::with_capacity(columns);
            for i in 0..columns {
                out.push(match r.get::<_, SqlValue>(i)? {
                    SqlValue::Null => Value::Null,
                    SqlValue::Integer(n) => json!(n),
                    SqlValue::Real(f) => json!(f),
                    SqlValue::Text(t) => json!(t),
                    SqlValue::Blob(_) => json!("<blob>"),
                });
            }
            Ok(out)
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

const J1: &str = "INSERT INTO journal_entries (id, date, title, instructor_feedback, was_difficult, created_at, updated_at) VALUES ('j1', '2026-10-01', 'Pattern work', 'Flare later.', 'Gusts.', '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z')";
const A1: &str = "INSERT INTO next_actions (id, title, created_at, updated_at) VALUES ('a1', 'Review flare timing', '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z')";

fn op(n: u32) -> String {
    format!("10000000-0000-4000-8000-{n:012x}")
}

fn obs(n: u32) -> String {
    format!("20000000-0000-4000-8000-{n:012x}")
}

fn create(
    n: u32,
    observation: u32,
    skill: &str,
    journal: &str,
    date: &str,
    wording: &str,
) -> Value {
    json!({
        "action": "create_observation", "operationId": op(n), "observationId": obs(observation),
        "skillId": skill, "journalId": journal, "sourceField": "none", "wording": wording,
        "observedOn": date, "attribution": "self_report", "instructorName": ""
    })
}

fn edit(n: u32, observation: u32, expected: i64, wording: &str, date: &str) -> Value {
    json!({
        "action": "edit_observation", "operationId": op(n), "observationId": obs(observation),
        "expectedRevision": expected, "wording": wording, "observedOn": date,
        "attribution": "self_report", "instructorName": ""
    })
}

/* ------------------------------------------------------------------ */
/* Shared contracts                                                    */
/* ------------------------------------------------------------------ */

#[test]
fn migration_14_is_the_reviewed_candidate_byte_for_byte() {
    let candidate = std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
        "../docs/evidence/m3-skills-evidence-scope-2026-10-10/candidate/0014_skills_evidence.sql",
    ))
    .unwrap();
    assert_eq!(migration_14(), candidate);
    // Schema 15 (M4 navigation) follows 14; migration 14 itself stays byte-identical.
    const _: () = assert!(crate::CURRENT_SCHEMA_VERSION >= 14);
}

#[test]
fn shared_validation_contract_native_outcomes() {
    let contract = fixture("validation-cases.json");
    let baseline = strings(&contract["baseline"]);
    let reference = reference();
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for case in contract["cases"].as_array().unwrap() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn, Some(&edited_migration(case.get("candidateEdits"))));
        for statement in baseline.iter().chain(strings(&case["sql"]).iter()) {
            conn.execute_batch(statement).unwrap();
        }
        let outcome = match crate::backup::verify_skill_evidence_against(&conn, &reference) {
            Ok(()) => "accept",
            Err(_) => "refuse",
        };
        let name = case["name"].as_str().unwrap();
        actual.push(format!("{name}: {outcome}"));
        expected.push(format!("{name}: {}", case["expect"].as_str().unwrap()));
    }
    assert_eq!(actual.len(), 85);
    assert_eq!(actual, expected);
}

#[test]
fn whole_application_validation_runs_the_schema_14_check() {
    let contract = fixture("validation-cases.json");
    let conn = library();
    for statement in strings(&contract["baseline"]) {
        conn.execute_batch(&statement).unwrap();
    }
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute_batch("UPDATE skill_observations SET wording = 'Tampered.'")
        .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("latest history entry"), "{error}");
}

#[test]
fn shared_constraint_contract_native_outcomes() {
    let contract = fixture("constraint-cases.json");
    let baseline = strings(&contract["baseline"]);
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for case in contract["cases"].as_array().unwrap() {
        let conn = library();
        for statement in &baseline {
            conn.execute_batch(statement).unwrap();
        }
        let outcome = if conn.execute_batch(case["sql"].as_str().unwrap()).is_ok() {
            "ok"
        } else {
            "error"
        };
        let name = case["name"].as_str().unwrap();
        actual.push(format!("{name}: {outcome}"));
        expected.push(format!("{name}: {}", case["expect"].as_str().unwrap()));
    }
    assert_eq!(actual.len(), 29);
    assert_eq!(actual, expected);
}

fn writer_library(extra: Option<&str>) -> Connection {
    let conn = library();
    conn.execute_batch(
        &std::fs::read_to_string(fixture_path("writer-populated-schema14.sql")).unwrap(),
    )
    .unwrap();
    if let Some(sql) = extra {
        conn.execute_batch(sql).unwrap();
    }
    conn
}

/// M3-R9: the library written by the real writer validates natively, and
/// removing any one history-owning receipt is refused.
#[test]
fn writer_library_requires_the_receipt_of_every_history_row() {
    let conn = writer_library(None);
    crate::backup::verify_application_connection(&conn).unwrap();
    let owning: Vec<(String, String)> = conn
        .prepare("SELECT operation_id, action FROM skill_evidence_operations WHERE is_erased = 0 AND action <> 'erase_observation' ORDER BY rowid")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut actions: Vec<&str> = owning.iter().map(|(_, a)| a.as_str()).collect();
    actions.sort_unstable();
    actions.dedup();
    assert_eq!(
        actions.len(),
        11,
        "every history-writing action is represented"
    );
    for (operation, action) in &owning {
        let broken = writer_library(Some(&format!(
            "DELETE FROM skill_evidence_operations WHERE operation_id = '{operation}'"
        )));
        assert!(
            crate::backup::verify_application_connection(&broken).is_err(),
            "removing the {action} receipt {operation} was accepted"
        );
    }
}

#[test]
fn shared_operation_contract_native_outcomes() {
    let contract = fixture("operation-cases.json");
    let baseline = strings(&contract["baseline"]);
    for case in contract["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut conn = library();
        for statement in &baseline {
            conn.execute_batch(statement).unwrap();
        }
        for (index, step) in case["steps"].as_array().unwrap().iter().enumerate() {
            if let Some(sql) = step.get("sql").and_then(Value::as_str) {
                conn.execute_batch(sql).unwrap();
                continue;
            }
            let outcome = match act(&mut conn, &step["request"]) {
                Ok(value) => value,
                Err(code) => json!({ "code": code }),
            };
            assert_eq!(outcome, step["expect"], "{name} / step {}", index + 1);
        }
        for (table, n) in case["rows"].as_object().unwrap() {
            assert_eq!(count(&conn, table), n.as_i64().unwrap(), "{name} / {table}");
        }
        for check in case["checks"].as_array().unwrap() {
            let sql = check["sql"].as_str().unwrap();
            let expected: Vec<Vec<Value>> = serde_json::from_value(check["rows"].clone()).unwrap();
            assert_eq!(json_rows(&conn, sql), expected, "{name} / {sql}");
        }
        let valid = crate::backup::verify_application_connection(&conn);
        if case.get("valid") == Some(&Value::Bool(false)) {
            assert!(valid.is_err(), "{name}: a damaged library was accepted");
        } else {
            valid.unwrap_or_else(|e| panic!("{name}: {e}"));
        }
    }
}

/// Reader parity: the native readers return exactly the TypeScript reader's
/// JSON for every read in `read-cases.json`, cursor strings included.
#[test]
fn shared_read_contract_native_outputs() {
    let contract = fixture("read-cases.json");
    let conn = writer_library(None);
    let reads = contract["reads"].as_array().unwrap();
    assert!(reads.len() >= 30);
    for read in reads {
        let input = &read["input"];
        let result = match read["kind"].as_str().unwrap() {
            "page" => read_evidence_page(&conn, input),
            "summary" => read_skill_summary_on(&conn, input),
            "skills" => list_skills_on(&conn, input),
            "history" => read_observation_history_on(&conn, input),
            other => panic!("unknown read {other}"),
        };
        let actual = match result {
            Ok(value) => value,
            Err(code) => json!({ "code": code }),
        };
        assert_eq!(actual, read["output"], "{} {}", read["kind"], input);
    }
}

#[test]
fn the_request_hash_is_the_typescript_canonical_hash() {
    // Same vector as skillEvidenceTransaction.test.ts.
    let request = json!({
        "action": "create_observation", "operationId": op(1), "observationId": obs(1),
        "skillId": "builtin.crosswind_landing", "journalId": "j1", "sourceField": "none",
        "wording": "H\u{e9}llo \"quoted\" \u{2708}\u{fe0e}\ttab\nline \u{1D11E} back\\slash",
        "observedOn": "2026-10-01", "attribution": "instructor_transcribed", "instructorName": "Zo\u{eb}"
    });
    decode_action(&request).unwrap();
    assert_eq!(
        request_hash(&request).unwrap(),
        "8c2456e1ecff47164663ed646ba7d66a444d05ad37719a2741ba439623c9cc42"
    );
}

#[test]
fn label_keys_match_the_typescript_normalization() {
    assert_eq!(
        label_key("  Short-FIELD \t landing "),
        "short-field landing"
    );
    assert_eq!(label_key("Cafe\u{301}"), label_key("Caf\u{e9}"));
    assert_eq!(label_key("A\u{a0}B\u{3000}C\u{feff}"), "a b c");
    assert_eq!(label_key("\u{feff}Go\u{2028}around"), "go around");
    // U+0085 is not JavaScript whitespace: it is kept.
    assert_eq!(label_key("Go\u{85}around"), "go\u{85}around");
    assert_eq!(label_key("ΟΔΟΣ"), "οδος");
}

/* ------------------------------------------------------------------ */
/* The command path, atomicity and failure behaviour                   */
/* ------------------------------------------------------------------ */

fn root_library(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    migrate(&conn, Some(migration_14()));
    conn.execute_batch(J1).unwrap();
    conn.execute_batch(A1).unwrap();
    mark_root_ready(root);
    conn
}

#[test]
fn the_command_path_saves_once_replays_and_reads_back() {
    let dir = TempDir::new("command");
    let conn = root_library(dir.path());
    let request = create(
        1,
        1,
        "builtin.normal_landing",
        "j1",
        "2026-10-01",
        "Flare later.",
    );
    let first = save_skill_evidence_at(dir.path(), &request).unwrap();
    assert_eq!(first["status"], "applied");
    let again = save_skill_evidence_at(dir.path(), &request).unwrap();
    assert_eq!(again["status"], "replayed");
    assert_eq!(again["result"], first["result"]);
    assert_eq!(count(&conn, "skill_observations"), 1);

    let page = read_at(
        dir.path(),
        read_evidence_page,
        &json!({ "skillId": "builtin.normal_landing" }),
    )
    .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["wording"], "Flare later.");
    assert_eq!(page["items"][0]["source"]["kind"], "present");
    let summary = read_at(
        dir.path(),
        read_skill_summary_on,
        &json!({ "skillId": "builtin.normal_landing" }),
    )
    .unwrap();
    assert_eq!(summary["observationCount"], 1);
    assert_eq!(summary["evidence"], "limited");
    assert_eq!(summary["status"], Value::Null);
    let list = read_at(dir.path(), list_skills_on, &json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 15);
    let history = read_at(
        dir.path(),
        read_observation_history_on,
        &json!({ "observationId": obs(1) }),
    )
    .unwrap();
    assert_eq!(history["currentRevision"], 1);
    assert_eq!(history["nextCursor"], Value::Null);

    // A refusal is one allowlisted code with its fixed message.
    let refused = save_skill_evidence_at(
        dir.path(),
        &create(2, 2, "builtin.normal_landing", "missing", "2026-10-01", "x"),
    )
    .unwrap_err();
    assert_eq!(refused.code, SkillEvidenceErrorCode::SourceMissing);
    assert_eq!(refused.message, "That lesson debrief no longer exists.");
    let wire = serde_json::to_value(&refused).unwrap();
    assert_eq!(
        wire,
        json!({ "code": "SOURCE_MISSING", "message": "That lesson debrief no longer exists." })
    );
}

#[test]
fn a_root_that_is_not_ready_refuses_before_any_write() {
    let dir = TempDir::new("not-ready");
    let conn = root_library(dir.path());
    unmark_root_ready(dir.path());
    let error = save_skill_evidence_at(
        dir.path(),
        &create(1, 1, "builtin.normal_landing", "j1", "2026-10-01", "x"),
    )
    .unwrap_err();
    assert_eq!(error.code, SkillEvidenceErrorCode::StorageFailure);
    assert_eq!(count(&conn, "skill_evidence_operations"), 0);
}

fn m3_counts(conn: &Connection) -> Vec<i64> {
    [
        "skill_catalog_entries",
        "skill_catalog_revisions",
        "skill_observations",
        "skill_observation_revisions",
        "skill_self_assessments",
        "skill_evidence_operations",
    ]
    .iter()
    .map(|t| count(conn, t))
    .collect()
}

/// A mid-transaction failure (the receipt insert, after the head row and its
/// history row were written) leaves every table exactly as it was.
#[test]
fn a_failure_after_the_first_writes_rolls_everything_back() {
    let mut conn = library();
    conn.execute_batch(J1).unwrap();
    act(
        &mut conn,
        &create(1, 1, "builtin.normal_landing", "j1", "2026-10-01", "First."),
    )
    .unwrap();
    let before = m3_counts(&conn);
    let rows_before = json_rows(&conn, "SELECT * FROM skill_observations");
    conn.execute_batch(
        "CREATE TRIGGER fault_receipt BEFORE INSERT ON skill_evidence_operations BEGIN SELECT RAISE(ABORT, 'injected fault'); END;",
    )
    .unwrap();
    for request in [
        create(
            2,
            2,
            "builtin.normal_landing",
            "j1",
            "2026-10-01",
            "Second.",
        ),
        edit(3, 1, 1, "First, edited.", "2026-10-01"),
        json!({ "action": "erase_observation", "operationId": op(4), "observationId": obs(1), "confirm": "erase" }),
        json!({ "action": "create_custom_skill", "operationId": op(5), "skillId": "custom.30000000-0000-4000-8000-000000000001", "label": "Mine", "description": "", "topic": "general" }),
        json!({ "action": "set_status", "operationId": op(6), "skillId": "builtin.go_around", "expectedSequence": 0, "status": "learning" }),
    ] {
        assert_eq!(
            code(act(&mut conn, &request)),
            SkillEvidenceErrorCode::StorageFailure
        );
        assert_eq!(m3_counts(&conn), before);
        assert_eq!(
            json_rows(&conn, "SELECT * FROM skill_observations"),
            rows_before
        );
    }
    conn.execute_batch("DROP TRIGGER fault_receipt").unwrap();
    // A failure on the history append also leaves the head row untouched.
    conn.execute_batch(
        "CREATE TRIGGER fault_history BEFORE INSERT ON skill_observation_revisions BEGIN SELECT RAISE(ABORT, 'injected fault'); END;",
    )
    .unwrap();
    assert_eq!(
        code(act(&mut conn, &edit(7, 1, 1, "Edited.", "2026-10-01"))),
        SkillEvidenceErrorCode::StorageFailure
    );
    assert_eq!(
        json_rows(&conn, "SELECT * FROM skill_observations"),
        rows_before
    );
    conn.execute_batch("DROP TRIGGER fault_history").unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn history_is_append_only_outside_an_erase() {
    let mut conn = library();
    conn.execute_batch(J1).unwrap();
    act(
        &mut conn,
        &create(1, 1, "builtin.normal_landing", "j1", "2026-10-01", "First."),
    )
    .unwrap();
    act(
        &mut conn,
        &json!({ "action": "set_status", "operationId": op(2), "skillId": "builtin.go_around", "expectedSequence": 0, "status": "learning" }),
    )
    .unwrap();
    for sql in [
        "UPDATE skill_observation_revisions SET wording = 'Rewritten.'",
        "DELETE FROM skill_observation_revisions",
        "UPDATE skill_catalog_revisions SET label = 'Renamed' WHERE skill_id = 'builtin.go_around'",
        "DELETE FROM skill_catalog_revisions WHERE skill_id = 'builtin.go_around'",
        "UPDATE skill_self_assessments SET status = 'practicing'",
        "DELETE FROM skill_self_assessments",
        "DELETE FROM skill_catalog_entries WHERE id = 'builtin.go_around'",
    ] {
        assert!(conn.execute_batch(sql).is_err(), "{sql} was allowed");
    }
}

#[test]
fn an_erase_leaves_no_trace_of_the_wording_in_any_table() {
    let mut conn = library();
    conn.execute_batch(J1).unwrap();
    conn.execute_batch(A1).unwrap();
    act(
        &mut conn,
        &create(
            1,
            1,
            "builtin.normal_landing",
            "j1",
            "2026-10-01",
            "Secret phrase qx91.",
        ),
    )
    .unwrap();
    act(
        &mut conn,
        &edit(2, 1, 1, "Secret phrase qx91, edited.", "2026-10-02"),
    )
    .unwrap();
    act(
        &mut conn,
        &json!({ "action": "link_action", "operationId": op(3), "observationId": obs(1), "expectedRevision": 2, "actionId": "a1" }),
    )
    .unwrap();
    act(
        &mut conn,
        &json!({ "action": "erase_observation", "operationId": op(4), "observationId": obs(1), "confirm": "erase" }),
    )
    .unwrap();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for table in tables {
        let columns: Vec<String> = conn
            .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for column in columns {
            let hits: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM \"{table}\" WHERE CAST(\"{column}\" AS TEXT) LIKE '%qx91%'"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(hits, 0, "{table}.{column} still holds the erased wording");
        }
    }
    let error =
        read_observation_history_on(&conn, &json!({ "observationId": obs(1) })).unwrap_err();
    assert_eq!(error, SkillEvidenceErrorCode::Erased);
    let unknown =
        read_observation_history_on(&conn, &json!({ "observationId": obs(9) })).unwrap_err();
    assert_eq!(unknown, SkillEvidenceErrorCode::NotFound);
    assert_eq!(count(&conn, "journal_entries"), 1);
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn every_revision_is_reachable_past_one_hundred_with_no_gap_or_repeat() {
    let mut conn = library();
    conn.execute_batch(J1).unwrap();
    act(
        &mut conn,
        &create(
            1,
            1,
            "builtin.normal_landing",
            "j1",
            "2026-10-01",
            "Version 1",
        ),
    )
    .unwrap();
    for revision in 2..=130 {
        act(
            &mut conn,
            &edit(
                revision,
                1,
                i64::from(revision) - 1,
                &format!("Version {revision}"),
                "2026-10-01",
            ),
        )
        .unwrap();
    }
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = read_observation_history_on(
            &conn,
            &json!({ "observationId": obs(1), "cursor": cursor, "limit": 100 }),
        )
        .unwrap();
        assert_eq!(page["currentRevision"], 130);
        for item in page["items"].as_array().unwrap() {
            seen.push(item["revision"].as_i64().unwrap());
        }
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(seen, (1..=130).rev().collect::<Vec<i64>>());
    assert_eq!(
        read_observation_history_on(&conn, &json!({ "observationId": obs(1), "limit": 101 }))
            .unwrap_err(),
        SkillEvidenceErrorCode::LimitExceeded
    );
    // A history cursor is bound to its observation.
    act(
        &mut conn,
        &create(
            200,
            2,
            "builtin.normal_landing",
            "j1",
            "2026-10-01",
            "Other",
        ),
    )
    .unwrap();
    act(
        &mut conn,
        &edit(201, 2, 1, "Other revision 2", "2026-10-01"),
    )
    .unwrap();
    let foreign = json!(["history", obs(1), 2]).to_string();
    assert_eq!(
        read_observation_history_on(
            &conn,
            &json!({ "observationId": obs(2), "cursor": foreign })
        )
        .unwrap_err(),
        SkillEvidenceErrorCode::InvalidArgument
    );
}

#[test]
fn limits_hold_at_their_exact_boundaries() {
    let mut conn = library();
    conn.execute_batch(J1).unwrap();
    let at_limit: String = "a".repeat(2_000);
    act(
        &mut conn,
        &create(
            1,
            1,
            "builtin.normal_landing",
            "j1",
            "2026-10-01",
            &at_limit,
        ),
    )
    .unwrap();
    let over: String = "a".repeat(2_001);
    assert_eq!(
        code(act(
            &mut conn,
            &create(2, 2, "builtin.normal_landing", "j1", "2026-10-01", &over)
        )),
        SkillEvidenceErrorCode::LimitExceeded
    );
    // 2,000 four-byte characters are exactly 8,000 bytes: accepted.
    let wide: String = "\u{1D11E}".repeat(2_000);
    assert_eq!(wide.len(), 8_000);
    act(
        &mut conn,
        &create(3, 3, "builtin.normal_landing", "j1", "2026-10-01", &wide),
    )
    .unwrap();
    // 50 observations per debrief.
    for n in 4..=51 {
        act(
            &mut conn,
            &create(n, n, "builtin.normal_landing", "j1", "2026-10-01", "Note."),
        )
        .unwrap();
    }
    assert_eq!(count(&conn, "skill_observations"), 50);
    assert_eq!(
        code(act(
            &mut conn,
            &create(
                52,
                52,
                "builtin.normal_landing",
                "j1",
                "2026-10-01",
                "One more."
            )
        )),
        SkillEvidenceErrorCode::LimitExceeded
    );
    // 200 custom skills, retired ones included.
    for n in 1..=200u32 {
        act(
            &mut conn,
            &json!({ "action": "create_custom_skill", "operationId": op(1_000 + n), "skillId": format!("custom.30000000-0000-4000-8000-{n:012x}"), "label": format!("Skill {n}"), "description": "", "topic": "general" }),
        )
        .unwrap();
    }
    assert_eq!(
        code(act(
            &mut conn,
            &json!({ "action": "create_custom_skill", "operationId": op(2_000), "skillId": "custom.30000000-0000-4000-8000-000000000999", "label": "Skill 201", "description": "", "topic": "general" })
        )),
        SkillEvidenceErrorCode::LimitExceeded
    );
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn stale_cursors_restart_and_cursors_are_bound_to_their_filters() {
    let mut conn = library();
    conn.execute_batch(J1).unwrap();
    for (n, date) in [(1, "2026-10-01"), (2, "2026-10-02"), (3, "2026-10-03")] {
        act(
            &mut conn,
            &create(
                n,
                n,
                "builtin.normal_landing",
                "j1",
                date,
                &format!("Note {n}"),
            ),
        )
        .unwrap();
    }
    let first = read_evidence_page(
        &conn,
        &json!({ "skillId": "builtin.normal_landing", "limit": 1 }),
    )
    .unwrap();
    assert_eq!(first["items"][0]["wording"], "Note 3");
    let cursor = first["nextCursor"].as_str().unwrap().to_string();
    // The cursor is the TypeScript reader's exact format.
    let parsed: Value = serde_json::from_str(&cursor).unwrap();
    assert_eq!(parsed[0], 2);
    assert_eq!(parsed[1], "builtin.normal_landing");
    // Another list's cursor, or a forged fence, is refused.
    assert_eq!(
        read_evidence_page(
            &conn,
            &json!({ "skillId": "builtin.go_around", "cursor": cursor, "limit": 1 })
        )
        .unwrap_err(),
        SkillEvidenceErrorCode::InvalidArgument
    );
    let mut forged = parsed.clone();
    forged[7] = json!(999);
    assert_eq!(
        read_evidence_page(
            &conn,
            &json!({ "skillId": "builtin.normal_landing", "cursor": forged.to_string() })
        )
        .unwrap_err(),
        SkillEvidenceErrorCode::InvalidArgument
    );
    // A wording-only edit keeps the cursor valid.
    act(&mut conn, &edit(10, 1, 1, "Note 1, reworded", "2026-10-01")).unwrap();
    let second = read_evidence_page(
        &conn,
        &json!({ "skillId": "builtin.normal_landing", "cursor": cursor, "limit": 1 }),
    )
    .unwrap();
    assert_eq!(second["items"][0]["wording"], "Note 2");
    // A date edit moving an unseen row above the cursor would skip it: STALE_CURSOR.
    act(&mut conn, &edit(11, 1, 2, "Note 1, reworded", "2026-10-05")).unwrap();
    assert_eq!(
        read_evidence_page(
            &conn,
            &json!({ "skillId": "builtin.normal_landing", "cursor": cursor, "limit": 1 })
        )
        .unwrap_err(),
        SkillEvidenceErrorCode::StaleCursor
    );
    // Page bounds.
    assert_eq!(
        read_evidence_page(&conn, &json!({ "limit": 51 })).unwrap_err(),
        SkillEvidenceErrorCode::LimitExceeded
    );
    assert_eq!(
        read_evidence_page(&conn, &json!({ "attribution": "verified" })).unwrap_err(),
        SkillEvidenceErrorCode::InvalidArgument
    );
}

/* ------------------------------------------------------------------ */
/* Upgrade, rollback, backup and restore                               */
/* ------------------------------------------------------------------ */

const NEW_TABLES: [&str; 7] = [
    "_sqlx_migrations",
    "skill_catalog_entries",
    "skill_catalog_revisions",
    "skill_observations",
    "skill_observation_revisions",
    "skill_self_assessments",
    "skill_evidence_operations",
];

fn dump(conn: &Connection, exclude: &[&str]) -> Vec<(String, Vec<Vec<Value>>)> {
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    tables
        .into_iter()
        .filter(|t| !exclude.contains(&t.as_str()))
        .map(|t| {
            let rows = json_rows(conn, &format!("SELECT * FROM \"{t}\" ORDER BY rowid"));
            (t, rows)
        })
        .collect()
}

/// A genuine schema-13 library: the rows a shipped schema-13 driver wrote
/// (debrief with action and question, practice attempt, rated card, split
/// lineage), on the registered migrations 1-13.
fn populated_schema13(path: &Path) -> Connection {
    let conn = Connection::open(path).unwrap();
    migrate(&conn, None);
    conn.execute_batch(&std::fs::read_to_string(fixture_path("populated-schema13.sql")).unwrap())
        .unwrap();
    conn
}

#[test]
fn a_populated_schema_13_library_upgrades_with_every_retained_row_identical() {
    let dir = TempDir::new("upgrade");
    let conn = populated_schema13(&dir.path().join("library.db"));
    crate::backup::verify_application_connection(&conn).unwrap();
    let before = dump(&conn, &NEW_TABLES);
    for (table, minimum) in [
        ("journal_entries", 2),
        ("next_actions", 2),
        ("questions", 2),
        ("practice_responses", 1),
        ("card_review_events", 1),
        ("material_split_lineage", 1),
    ] {
        assert!(count(&conn, table) >= minimum, "{table} is not populated");
    }
    // The upgrade, as the plugin runs it: the migration in one transaction.
    conn.execute_batch(&format!(
        "BEGIN IMMEDIATE; {} INSERT INTO _sqlx_migrations (version) VALUES (14); COMMIT;",
        migration_14()
    ))
    .unwrap();
    assert_eq!(dump(&conn, &NEW_TABLES), before);
    assert_eq!(count(&conn, "skill_catalog_entries"), 15);
    assert_eq!(count(&conn, "skill_catalog_revisions"), 15);
    // Existing debriefs gain no observations: nothing is backfilled.
    assert_eq!(count(&conn, "skill_observations"), 0);
    assert_eq!(count(&conn, "skill_evidence_operations"), 0);
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn a_failed_schema_14_upgrade_leaves_schema_13_untouched() {
    let dir = TempDir::new("rollback");
    let conn = populated_schema13(&dir.path().join("library.db"));
    let before = dump(&conn, &[]);
    let master_before = json_rows(
        &conn,
        "SELECT type, name, sql FROM sqlite_master ORDER BY name",
    );
    let result = conn.execute_batch(&format!(
        "BEGIN IMMEDIATE; {} INSERT INTO no_such_table VALUES (1); COMMIT;",
        migration_14()
    ));
    assert!(result.is_err());
    let _ = conn.execute_batch("ROLLBACK");
    assert_eq!(dump(&conn, &[]), before);
    assert_eq!(
        json_rows(
            &conn,
            "SELECT type, name, sql FROM sqlite_master ORDER BY name"
        ),
        master_before
    );
    let newest: i64 = conn
        .query_row("SELECT MAX(version) FROM _sqlx_migrations", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(newest, 13);
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn an_older_app_refuses_a_newer_library() {
    let conn = library();
    conn.execute(
        "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
        [crate::CURRENT_SCHEMA_VERSION + 1],
    )
    .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("newer database format"), "{error}");
}

/// Write evidence through the real command path onto a schema-13 library
/// upgraded to 14, so the backup holds genuine writer output.
fn populated_schema14_root(root: &Path) -> Connection {
    let conn = populated_schema13(&root.join("her-flight-deck.db"));
    conn.execute_batch(&format!(
        "{} INSERT INTO _sqlx_migrations (version) VALUES (14);",
        migration_14()
    ))
    .unwrap();
    conn.execute_batch(J1).unwrap();
    conn.execute_batch(A1).unwrap();
    mark_root_ready(root);
    for request in [
        create(
            1,
            1,
            "builtin.normal_landing",
            "j1",
            "2026-10-01",
            "Flare later.",
        ),
        edit(2, 1, 1, "Flare a little later.", "2026-10-01"),
        json!({ "action": "link_action", "operationId": op(3), "observationId": obs(1), "expectedRevision": 2, "actionId": "a1" }),
        json!({ "action": "set_addressed", "operationId": op(4), "observationId": obs(1), "expectedRevision": 3, "addressed": true }),
        json!({ "action": "create_custom_skill", "operationId": op(5), "skillId": "custom.30000000-0000-4000-8000-000000000001", "label": "Short-field landing", "description": "", "topic": "landings" }),
        json!({ "action": "set_status", "operationId": op(6), "skillId": "builtin.normal_landing", "expectedSequence": 0, "status": "practicing" }),
        json!({ "action": "set_confidence", "operationId": op(7), "skillId": "builtin.normal_landing", "expectedSequence": 0, "confidence": 3 }),
        create(8, 2, "builtin.go_around", "j1", "2026-10-01", "Erase me."),
        json!({ "action": "erase_observation", "operationId": op(9), "observationId": obs(2), "confirm": "erase" }),
    ] {
        save_skill_evidence_at(root, &request).unwrap();
    }
    conn
}

/// Rewrite a complete backup with a different database inside, recomputing
/// its integrity entry, so only the database's meaning can refuse it.
fn rewrite_archive_database(source: &Path, target: &Path, database: &[u8]) {
    use sha2::{Digest, Sha256};
    let mut archive = zip::ZipArchive::new(std::fs::File::open(source).unwrap()).unwrap();
    let mut writer = zip::ZipWriter::new(std::fs::File::create(target).unwrap());
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        if name == "her-flight-deck.db" {
            bytes = database.to_vec();
        } else if name == "integrity.json" {
            let mut integrity: Value = serde_json::from_slice(&bytes).unwrap();
            for file in integrity["files"].as_array_mut().unwrap() {
                if file["path"] == "her-flight-deck.db" {
                    file["bytes"] = json!(database.len());
                    file["sha256"] = json!(hex::encode(Sha256::digest(database)));
                }
            }
            bytes = serde_json::to_vec(&integrity).unwrap();
        }
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&bytes).unwrap();
    }
    writer.finish().unwrap();
}

#[test]
fn a_complete_backup_round_trips_and_a_tampered_one_is_refused_before_anything_moves() {
    let source = TempDir::new("backup-source");
    let out = TempDir::new("backup-out");
    let target = TempDir::new("backup-target");
    let conn = populated_schema14_root(source.path());
    crate::backup::verify_application_connection(&conn).unwrap();
    let expected = dump(&conn, &[]);
    drop(conn);

    let archive = out.path().join("library.hfdbackup");
    crate::backup::create_consistent_complete_backup_with_retry(source.path(), &archive, "0.5.3")
        .unwrap();
    crate::backup::inspect_archive(source.path(), &archive, "0.5.3").unwrap();
    crate::backup::stage_complete_restore_in(target.path(), &archive, "0.5.3").unwrap();
    crate::backup::apply_pending_restore_in(target.path()).unwrap();
    let restored = Connection::open(target.path().join("her-flight-deck.db")).unwrap();
    crate::backup::verify_application_connection(&restored).unwrap();
    assert_eq!(dump(&restored, &[]), expected);
    drop(restored);

    // The same backup with altered evidence (wording no longer matching its
    // history) is refused at inspection and at staging; the current library
    // is not replaced.
    let tampered_db = out.path().join("tampered.db");
    std::fs::copy(source.path().join("her-flight-deck.db"), &tampered_db).unwrap();
    {
        let c = Connection::open(&tampered_db).unwrap();
        c.execute_batch("UPDATE skill_observations SET wording = 'Altered.'")
            .unwrap();
    }
    let tampered = out.path().join("tampered.hfdbackup");
    rewrite_archive_database(&archive, &tampered, &std::fs::read(&tampered_db).unwrap());
    let inspected = crate::backup::inspect_archive(source.path(), &tampered, "0.5.3").unwrap_err();
    assert!(inspected.contains("latest history entry"), "{inspected}");
    let current = std::fs::read(target.path().join("her-flight-deck.db")).unwrap();
    let staged =
        crate::backup::stage_complete_restore_in(target.path(), &tampered, "0.5.3").unwrap_err();
    assert!(staged.contains("latest history entry"), "{staged}");
    assert!(!target.path().join(".restore-pending").exists());
    assert_eq!(
        std::fs::read(target.path().join("her-flight-deck.db")).unwrap(),
        current
    );

    // An erased observation stays erased through the round trip, and a
    // receipt removed from a backup is refused (history -> receipt).
    let removed_db = out.path().join("removed.db");
    std::fs::copy(source.path().join("her-flight-deck.db"), &removed_db).unwrap();
    {
        let c = Connection::open(&removed_db).unwrap();
        c.execute_batch(&format!(
            "DELETE FROM skill_evidence_operations WHERE operation_id = '{}'",
            op(6)
        ))
        .unwrap();
    }
    let removed = out.path().join("removed.hfdbackup");
    rewrite_archive_database(&archive, &removed, &std::fs::read(&removed_db).unwrap());
    let refusal = crate::backup::inspect_archive(source.path(), &removed, "0.5.3").unwrap_err();
    assert!(
        refusal.contains("no matching operation record"),
        "{refusal}"
    );
}
