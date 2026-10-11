//! The shared M3 contracts on the app's rusqlite/bundled SQLite. Same fixtures
//! and expected outcomes as tests/contract.test.ts (node:sqlite, sql.js).

use m3_skills_evidence_native::*;
use rusqlite::{backup::Backup, Connection};
use serde_json::Value;
use std::time::Duration;

fn fixture(name: &str) -> Value {
    let path = format!("{}/../fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect()
}

fn edited_candidate(edits: Option<&Value>) -> String {
    let mut sql = CANDIDATE.to_string();
    for edit in edits.and_then(|e| e.as_array()).into_iter().flatten() {
        let pair = edit.as_array().unwrap();
        let (from, to) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
        assert_eq!(sql.matches(from).count(), 1, "candidate edit must match exactly once: {from}");
        sql = sql.replacen(from, to, 1);
    }
    sql
}

#[test]
fn engine_is_the_apps_bundled_sqlite() {
    let conn = Connection::open_in_memory().unwrap();
    let version: String = conn.query_row("SELECT sqlite_version()", [], |r| r.get(0)).unwrap();
    println!("rusqlite 0.32.1 bundled SQLite {version}");
    assert!(version.starts_with("3."));
}

#[test]
fn shared_validation_contract_native_outcomes() {
    let contract = fixture("validation-cases.json");
    let baseline = strings(&contract["baseline"]);
    let reference = reference().unwrap();
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for case in contract["cases"].as_array().unwrap() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn, Some(&edited_candidate(case.get("candidateEdits")))).unwrap();
        for statement in baseline.iter().chain(strings(&case["sql"]).iter()) {
            conn.execute_batch(statement).unwrap();
        }
        let outcome = match verify_schema_14_skill_evidence_semantics(&conn, &reference) {
            Ok(()) => "accept",
            Err(_) => "refuse",
        };
        let name = case["name"].as_str().unwrap();
        actual.push(format!("{name}: {outcome}"));
        expected.push(format!("{name}: {}", case["expect"].as_str().unwrap()));
    }
    assert_eq!(actual, expected);
}

#[test]
fn shared_constraint_contract_native_outcomes() {
    let contract = fixture("constraint-cases.json");
    let baseline = strings(&contract["baseline"]);
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for case in contract["cases"].as_array().unwrap() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn, Some(CANDIDATE)).unwrap();
        for statement in &baseline {
            conn.execute_batch(statement).unwrap();
        }
        let outcome = if conn.execute_batch(case["sql"].as_str().unwrap()).is_ok() { "ok" } else { "error" };
        let name = case["name"].as_str().unwrap();
        actual.push(format!("{name}: {outcome}"));
        expected.push(format!("{name}: {}", case["expect"].as_str().unwrap()));
    }
    assert_eq!(actual, expected);
}

fn populated_schema13() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn, None).unwrap();
    let rows = std::fs::read_to_string(format!("{}/../fixtures/populated-schema13.sql", env!("CARGO_MANIFEST_DIR"))).unwrap();
    conn.execute_batch(&rows).unwrap();
    conn
}

const M3: [&str; 7] = [
    "schema_migrations",
    "skill_catalog_entries",
    "skill_catalog_revisions",
    "skill_observations",
    "skill_observation_revisions",
    "skill_self_assessments",
    "skill_evidence_operations",
];

#[test]
fn populated_schema13_upgrades_with_every_retained_row_identical() {
    let conn = populated_schema13();
    let before = dump(&conn, &M3).unwrap();
    assert!(before.iter().any(|(t, rows)| t == "practice_responses" && rows.len() == 1));
    assert!(before.iter().any(|(t, rows)| t == "card_review_events" && rows.len() == 1));
    assert!(before.iter().any(|(t, rows)| t == "material_split_lineage" && rows.len() == 1));
    migrate(&conn, Some(CANDIDATE)).unwrap();
    assert_eq!(dump(&conn, &M3).unwrap(), before);
    let catalog: i64 = conn.query_row("SELECT COUNT(*) FROM skill_catalog_entries", [], |r| r.get(0)).unwrap();
    let observations: i64 = conn.query_row("SELECT COUNT(*) FROM skill_observations", [], |r| r.get(0)).unwrap();
    assert_eq!((catalog, observations), (15, 0));
    verify_candidate(&conn, &reference().unwrap()).unwrap();
}

#[test]
fn a_failed_candidate_migration_leaves_schema_13_untouched() {
    let conn = populated_schema13();
    let before = dump(&conn, &[]).unwrap();
    let broken = format!("{CANDIDATE}\nINSERT INTO no_such_table VALUES (1);");
    assert!(migrate(&conn, Some(&broken)).is_err());
    assert_eq!(dump(&conn, &[]).unwrap(), before);
    let m3: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'skill_%'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(m3, 0);
}

#[test]
fn backup_api_copy_restores_validated_and_identical() {
    let contract = fixture("validation-cases.json");
    let conn = populated_schema13();
    migrate(&conn, Some(CANDIDATE)).unwrap();
    // The fixture's journals use ids j1/j2; the populated library has its own, so add them.
    for statement in strings(&contract["baseline"]) {
        conn.execute_batch(&statement).unwrap();
    }
    let reference = reference().unwrap();
    verify_candidate(&conn, &reference).unwrap();
    let dir = std::env::temp_dir().join(format!("m3-native-backup-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.db");
    {
        let mut target = Connection::open(&path).unwrap();
        let backup = Backup::new(&conn, &mut target).unwrap();
        backup.run_to_completion(64, Duration::from_millis(0), None).unwrap();
    }
    let restored = Connection::open(&path).unwrap();
    restored.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    verify_candidate(&restored, &reference).unwrap();
    assert_eq!(dump(&restored, &[]).unwrap(), dump(&conn, &[]).unwrap());
    // A tampered copy is refused.
    restored.execute_batch("UPDATE skill_observations SET wording = 'Tampered.'").unwrap();
    assert!(verify_candidate(&restored, &reference).is_err());
    drop(restored);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_candidate_refuses_a_library_newer_than_itself() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn, Some(CANDIDATE)).unwrap();
    conn.execute_batch("INSERT INTO schema_migrations (version, description, applied_at) VALUES (15, 'future', 'x')").unwrap();
    let error = verify_candidate(&conn, &reference().unwrap()).unwrap_err();
    assert!(error.contains("newer database format"));
}

fn writer_library(extra: Option<&str>) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn, Some(CANDIDATE)).unwrap();
    let rows = std::fs::read_to_string(format!("{}/../fixtures/writer-populated-schema14.sql", env!("CARGO_MANIFEST_DIR"))).unwrap();
    conn.execute_batch(&rows).unwrap();
    if let Some(sql) = extra {
        conn.execute_batch(sql).unwrap();
    }
    conn
}

/// M3-R9: the library written by the real candidate writer validates natively,
/// and removing any one receipt that owns history is refused (TS twin:
/// tests/remaining-validation.test.ts).
#[test]
fn writer_library_requires_the_receipt_of_every_history_row() {
    let reference = reference().unwrap();
    let conn = writer_library(None);
    verify_candidate(&conn, &reference).unwrap();
    let mut statement = conn
        .prepare("SELECT operation_id, action FROM skill_evidence_operations WHERE is_erased = 0 AND action <> 'erase_observation' ORDER BY rowid")
        .unwrap();
    let owning: Vec<(String, String)> = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
    let mut actions: Vec<&str> = owning.iter().map(|(_, a)| a.as_str()).collect();
    actions.sort_unstable();
    actions.dedup();
    assert_eq!(actions.len(), 11, "every history-writing action is represented");
    for (operation, action) in &owning {
        let broken = writer_library(Some(&format!("DELETE FROM skill_evidence_operations WHERE operation_id = '{operation}'")));
        assert!(verify_candidate(&broken, &reference).is_err(), "removing the {action} receipt {operation} was accepted");
    }
}
