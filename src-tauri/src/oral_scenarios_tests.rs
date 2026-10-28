use super::*;

pub(crate) const MATERIAL: &str = "oral-material";
pub(crate) fn uid(n: u32) -> String {
    format!("0a1c0000-0000-4000-8000-{n:012}")
}

pub(crate) fn library_at(c: &Connection) {
    c.execute_batch(
        "PRAGMA foreign_keys=ON; CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);",
    )
    .unwrap();
    for m in crate::migrations() {
        c.execute_batch(m.sql).unwrap();
        c.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
            .unwrap();
    }
    c.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES (?1,'Fictional practice panel','x','x')",[MATERIAL]).unwrap();
}

fn library() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    library_at(&c);
    c
}

pub(crate) fn content(prompt: &str, points: usize) -> Value {
    json!({
        "prompt": prompt,
        "assumptions": "Imagine the fictional Alpha panel.\nLine two ✈",
        "points": (0..points).map(|i| format!("Point {i} — Bravo")).collect::<Vec<_>>(),
        "sourcePage": 3,
        "origin": "instructor",
    })
}

pub(crate) fn create(op: u32, scenario: u32, version: u32, prompt: &str) -> Value {
    json!({"action":"create","operationId":uid(op),"materialId":MATERIAL,"at":"2026-10-28T10:00:00.000Z","scenarioId":uid(scenario),"versionId":uid(version),"content":content(prompt, 3)})
}

fn order(c: &Connection) -> Vec<String> {
    let mut s = c
        .prepare("SELECT id FROM oral_scenarios WHERE material_id=?1 AND removed_at IS NULL ORDER BY position")
        .unwrap();
    s.query_map([MATERIAL], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn verify(c: &Connection) -> Result<(), String> {
    crate::backup::verify_schema_25_oral_scenarios(c)
}

#[test]
fn points_codec_is_exact_and_bounded() {
    let twelve: Vec<String> = (0..12).map(|i| format!("p{i}")).collect();
    assert!(decode_points(&serde_json::to_string(&twelve).unwrap()).is_some());
    let thirteen: Vec<String> = (0..13).map(|i| format!("p{i}")).collect();
    assert!(decode_points(&serde_json::to_string(&thirteen).unwrap()).is_none());
    assert!(decode_points("[]").is_none());
    assert!(decode_points("[\"\"]").is_none());
    assert!(decode_points("[\"  \"]").is_none());
    assert!(decode_points(&serde_json::to_string(&["é".repeat(500)]).unwrap()).is_some());
    assert!(decode_points(&serde_json::to_string(&["é".repeat(501)]).unwrap()).is_none());
    assert!(
        decode_points("[\"a\", \"b\"]").is_none(),
        "not the exact encoding"
    );
    assert!(decode_points("[1]").is_none());
    assert!(decode_points("{\"0\":\"a\"}").is_none());
}

#[test]
fn create_edit_reorder_remove_and_idempotent_retry() {
    let mut c = library();
    let a = create(1, 10, 11, "Scenario Alpha: explain the three lights");
    let first = execute(&mut c, &a).unwrap();
    assert_eq!(first["versionNumber"], 1);
    assert_eq!(
        execute(&mut c, &a).unwrap(),
        first,
        "retry returns the receipt"
    );
    let mut changed = a.clone();
    changed["content"]["prompt"] = json!("Different");
    assert_eq!(execute(&mut c, &changed).unwrap_err().code, "CONFLICT");
    execute(&mut c, &create(2, 20, 21, "Scenario Bravo")).unwrap();
    assert_eq!(order(&c), vec![uid(10), uid(20)]);

    let edit = json!({"action":"edit","operationId":uid(3),"materialId":MATERIAL,"at":"t","scenarioId":uid(10),"versionId":uid(12),"baseVersion":1,"content":content("Scenario Alpha, edited", 12)});
    assert_eq!(execute(&mut c, &edit).unwrap()["versionNumber"], 2);
    let stale = json!({"action":"edit","operationId":uid(4),"materialId":MATERIAL,"at":"t","scenarioId":uid(10),"versionId":uid(13),"baseVersion":1,"content":content("Stale", 1)});
    assert_eq!(execute(&mut c, &stale).unwrap_err().code, "STALE");
    let versions: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM oral_scenario_versions WHERE scenario_id=?1",
            [uid(10)],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(versions, 2, "the earlier version stays readable");

    let reorder = json!({"action":"reorder","operationId":uid(5),"materialId":MATERIAL,"at":"t","order":[uid(20),uid(10)]});
    execute(&mut c, &reorder).unwrap();
    assert_eq!(order(&c), vec![uid(20), uid(10)]);
    let wrong = json!({"action":"reorder","operationId":uid(6),"materialId":MATERIAL,"at":"t","order":[uid(20)]});
    assert_eq!(execute(&mut c, &wrong).unwrap_err().code, "STALE");

    let remove = json!({"action":"remove","operationId":uid(7),"materialId":MATERIAL,"at":"t","scenarioId":uid(20)});
    execute(&mut c, &remove).unwrap();
    assert_eq!(order(&c), vec![uid(10)]);
    assert_eq!(execute(&mut c, &remove).unwrap()["action"], "remove");
    let again = json!({"action":"remove","operationId":uid(8),"materialId":MATERIAL,"at":"t","scenarioId":uid(20)});
    assert_eq!(execute(&mut c, &again).unwrap_err().code, "MISSING");
    execute(&mut c, &create(9, 30, 31, "Scenario Charlie")).unwrap();
    assert_eq!(order(&c), vec![uid(10), uid(30)]);
    verify(&c).unwrap();

    // Receipts hold a hash and ids, never her text.
    let receipts: String = c
        .query_row(
            "SELECT group_concat(payload_hash || result_json, '') FROM oral_save_operations",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!receipts.contains("Scenario") && !receipts.contains("Bravo"));
}

#[test]
fn refuses_invalid_operations_before_writing() {
    let mut c = library();
    for bad in [
        {
            let mut o = create(1, 10, 11, "x");
            o["content"] = content("x", 13);
            o
        },
        {
            let mut o = create(1, 10, 11, "x");
            o["content"]["origin"] = json!("study_aid");
            o
        },
        {
            let mut o = create(1, 10, 11, "   ");
            o["content"]["prompt"] = json!("   ");
            o
        },
        {
            let mut o = create(1, 10, 11, "x");
            o["extra"] = json!(1);
            o
        },
        {
            let mut o = create(1, 10, 11, "x");
            o["content"]["sourcePage"] = json!(0);
            o
        },
    ] {
        assert_eq!(execute(&mut c, &bad).unwrap_err().code, "INVALID");
    }
    let mut missing = create(1, 10, 11, "x");
    missing["materialId"] = json!("nope");
    assert_eq!(execute(&mut c, &missing).unwrap_err().code, "MISSING");
    let n: i64 = c
        .query_row(
            "SELECT (SELECT COUNT(*) FROM oral_scenarios)+(SELECT COUNT(*) FROM oral_save_operations)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn deleting_the_material_removes_its_scenarios() {
    let mut c = library();
    execute(&mut c, &create(1, 10, 11, "Scenario Alpha")).unwrap();
    c.execute("DELETE FROM study_materials WHERE id=?1", [MATERIAL])
        .unwrap();
    for table in [
        "oral_scenarios",
        "oral_scenario_versions",
        "oral_save_operations",
    ] {
        let n: i64 = c
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "{table}");
    }
    verify(&c).unwrap();
}

#[test]
fn verifier_refuses_corrupt_rows() {
    let tamper = |sql: &str| {
        let mut c = library();
        execute(&mut c, &create(1, 10, 11, "Scenario Alpha")).unwrap();
        let edit = json!({"action":"edit","operationId":uid(2),"materialId":MATERIAL,"at":"t","scenarioId":uid(10),"versionId":uid(12),"baseVersion":1,"content":content("Edited", 2)});
        execute(&mut c, &edit).unwrap();
        verify(&c).unwrap();
        c.pragma_update(None, "foreign_keys", "OFF").unwrap();
        c.execute_batch(sql).unwrap();
        verify(&c)
    };
    let thirteen =
        serde_json::to_string(&(0..13).map(|i| format!("Point {i}")).collect::<Vec<_>>()).unwrap();
    for sql in [
        "UPDATE oral_scenario_versions SET prompt='Changed behind her back' WHERE version_number=1".to_string(),
        format!("UPDATE oral_scenario_versions SET points_json='{thirteen}' WHERE version_number=1"),
        "UPDATE oral_scenario_versions SET points_json='[\"a\", \"b\"]' WHERE version_number=1".to_string(),
        "UPDATE oral_scenario_versions SET content_hash=replace(content_hash, substr(content_hash,1,1), CASE substr(content_hash,1,1) WHEN 'a' THEN 'b' ELSE 'a' END) WHERE version_number=2".to_string(),
        "DELETE FROM oral_scenario_versions WHERE version_number=1".to_string(),
        "UPDATE oral_scenario_versions SET scenario_id='0a1c0000-0000-4000-8000-999999999999' WHERE version_number=2".to_string(),
        "UPDATE oral_save_operations SET result_json='{\"prompt\":\"Scenario Alpha\"}'".to_string(),
        "UPDATE oral_save_operations SET action='answer'".to_string(),
        "DROP INDEX idx_oral_scenario_order".to_string(),
    ] {
        assert!(tamper(&sql).is_err(), "accepted: {sql}");
    }
}

#[test]
fn verifier_runs_from_the_application_check() {
    let mut c = library();
    execute(&mut c, &create(1, 10, 11, "Scenario Alpha")).unwrap();
    crate::backup::verify_application_connection(&c).unwrap();
    c.execute(
        "UPDATE oral_scenario_versions SET points_json='[\"Only one\"]'",
        [],
    )
    .unwrap();
    assert!(crate::backup::verify_application_connection(&c).is_err());
}

#[test]
fn content_hash_matches_the_typescript_twin() {
    // The same literal is asserted in src/data/oralScenarios.test.ts.
    assert_eq!(
        content_hash(&uid(10), 2, &content("Scenario Alpha \"quoted\"\n✈", 2)),
        "b2a60eb7007922a82cf294fb7974d960fb422064142dab736482c9c0aa928c91"
    );
}
