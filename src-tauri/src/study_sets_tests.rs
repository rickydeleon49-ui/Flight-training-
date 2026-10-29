//! Native study-set saves (OFFLINE-03a) on disposable in-memory databases.
//! Every value is synthetic.

use super::*;

const M: &str = "mat-study";
const NOW: &str = "2026-10-19T20:00:00.000Z";
const LATER: &str = "2026-10-19T21:00:00.000Z";

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?1, 'Synthetic', ?2, ?2)",
        params![M, NOW],
    )
    .unwrap();
    conn
}

fn op_id(n: u32) -> String {
    format!("5e700000-0000-4000-8000-{n:012x}")
}

fn manual_set() -> Value {
    json!({
        "title": "My crosswind notes",
        "summary": "Wing down into the wind.",
        "summaryOrigin": "user",
        "sections": [{"heading": "Crosswind", "body": "Aileron into the wind.", "itemId": "s-1", "origin": "user"}],
        "flashcards": [{"front": "Which wing is lowered?", "back": "The upwind wing.", "sourcePage": null, "itemId": "c-1", "origin": "user"}],
        "sourceNotes": "",
        "provider": "manual",
        "model": "",
        "retired": [],
    })
}

fn operation(n: u32, reason: &str, expected: Value, next: Value) -> SaveOperation {
    decode_operation(&json!({
        "operationId": op_id(n), "materialId": M, "reason": reason, "expected": expected, "next": next,
    }))
    .unwrap()
}

fn row(conn: &mut Connection) -> Value {
    let tx = conn.transaction().unwrap();
    let row = read_row(&tx, M).unwrap();
    row.map(Value::Object).unwrap_or(Value::Null)
}

fn history(conn: &Connection) -> Vec<(String, String, String)> {
    let mut statement = conn
        .prepare("SELECT id, reason, previous_json FROM study_set_history ORDER BY created_at, id")
        .unwrap();
    statement
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn a_set_she_writes_herself_is_saved_without_history() {
    let mut conn = database();
    let result = save_on(
        &mut conn,
        &operation(1, "create", Value::Null, manual_set()),
        NOW,
    )
    .unwrap();
    assert_eq!(result.status, "saved");
    let stored = row(&mut conn);
    assert_eq!(stored["provider"], "manual");
    assert_eq!(stored["summary_origin"], "user");
    assert_eq!(stored["generated_at"], NOW);
    assert_eq!(stored["retired_json"], "[]");
    assert!(history(&conn).is_empty());
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn an_edit_keeps_the_whole_previous_set_first() {
    let mut conn = database();
    save_on(
        &mut conn,
        &operation(1, "create", Value::Null, manual_set()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    let mut next = manual_set();
    next["flashcards"][0]["back"] = json!("The upwind wing, always.");
    save_on(
        &mut conn,
        &operation(2, "edit", before.clone(), next),
        LATER,
    )
    .unwrap();
    let after = row(&mut conn);
    assert_eq!(after["generated_at"], NOW);
    assert_eq!(after["updated_at"], LATER);
    let entries = history(&conn);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].0, op_id(2));
    assert_eq!(entries[0].1, "edit");
    let previous: Value = serde_json::from_str(&entries[0].2).unwrap();
    assert_eq!(previous, before);
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn a_change_made_elsewhere_is_refused_and_nothing_is_written() {
    let mut conn = database();
    save_on(
        &mut conn,
        &operation(1, "create", Value::Null, manual_set()),
        NOW,
    )
    .unwrap();
    let mut stale = row(&mut conn);
    stale["summary"] = json!("What she saw before another window saved.");
    let error = save_on(&mut conn, &operation(2, "edit", stale, manual_set()), LATER).unwrap_err();
    assert_eq!(error, StudySetErrorCode::StaleContent);
    assert!(history(&conn).is_empty());
    // Creating over an existing set is stale too.
    let mut other = manual_set();
    other["title"] = json!("Another");
    let error = save_on(
        &mut conn,
        &operation(3, "create", Value::Null, other),
        LATER,
    )
    .unwrap_err();
    assert_eq!(error, StudySetErrorCode::StaleContent);
}

#[test]
fn a_retry_is_recognised_instead_of_applied_twice() {
    let mut conn = database();
    let create = operation(1, "create", Value::Null, manual_set());
    save_on(&mut conn, &create, NOW).unwrap();
    assert_eq!(
        save_on(&mut conn, &create, LATER).unwrap().status,
        "already_saved"
    );
    let before = row(&mut conn);
    let mut next = manual_set();
    next["title"] = json!("Renamed");
    let edit = operation(2, "edit", before, next);
    save_on(&mut conn, &edit, LATER).unwrap();
    assert_eq!(
        save_on(&mut conn, &edit, LATER).unwrap().status,
        "already_saved"
    );
    assert_eq!(history(&conn).len(), 1);
    // The same id with different content is not a retry.
    let current = row(&mut conn);
    let mut different = manual_set();
    different["title"] = json!("Something else");
    let reused = operation(2, "edit", current, different);
    assert_eq!(
        save_on(&mut conn, &reused, LATER).unwrap_err(),
        StudySetErrorCode::StaleContent
    );
}

#[test]
fn removing_a_set_keeps_it_in_history_until_the_material_is_deleted() {
    let mut conn = database();
    save_on(
        &mut conn,
        &operation(1, "create", Value::Null, manual_set()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    let remove = operation(2, "remove", before.clone(), Value::Null);
    save_on(&mut conn, &remove, LATER).unwrap();
    assert_eq!(row(&mut conn), Value::Null);
    assert_eq!(
        save_on(&mut conn, &remove, LATER).unwrap().status,
        "already_saved"
    );
    let entries = history(&conn);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].1, "delete");
    // Restoring it brings the same content back and records nothing lost.
    let previous: Value = serde_json::from_str(&entries[0].2).unwrap();
    assert_eq!(previous, before);
    conn.execute("DELETE FROM study_materials WHERE id = ?1", [M])
        .unwrap();
    assert!(history(&conn).is_empty());
}

#[test]
fn a_failed_write_rolls_back_the_history_row_too() {
    let mut conn = database();
    save_on(
        &mut conn,
        &operation(1, "create", Value::Null, manual_set()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    conn.execute_batch(
        "CREATE TRIGGER fail_update BEFORE UPDATE ON ai_study_sets BEGIN SELECT RAISE(ABORT, 'injected'); END;",
    )
    .unwrap();
    let mut next = manual_set();
    next["title"] = json!("Never saved");
    let error = save_on(
        &mut conn,
        &operation(2, "edit", before.clone(), next),
        LATER,
    )
    .unwrap_err();
    assert_eq!(error, StudySetErrorCode::StorageError);
    assert!(history(&conn).is_empty());
    assert_eq!(row(&mut conn), before);
}

#[test]
fn a_missing_material_is_not_found() {
    let mut conn = database();
    let op = decode_operation(&json!({
        "operationId": op_id(9), "materialId": "gone", "reason": "create", "expected": null, "next": manual_set(),
    }))
    .unwrap();
    assert_eq!(
        save_on(&mut conn, &op, NOW).unwrap_err(),
        StudySetErrorCode::NotFound
    );
}

fn retired(n: usize) -> Value {
    Value::Array(
        (0..n)
            .map(|i| {
                json!({
                    "kind": "card", "itemId": format!("r-{i}"), "reason": "deleted",
                    "textKey": format!("{i:064x}"), "terms": ["back", "front"],
                })
            })
            .collect(),
    )
}

#[test]
fn the_retirement_limit_is_two_thousand_with_no_eviction() {
    assert!(validate_retired(&retired(2_000)).is_ok());
    assert_eq!(
        validate_retired(&retired(2_001)).unwrap_err(),
        StudySetErrorCode::RetirementLimit
    );
    let mut set = manual_set();
    set["retired"] = retired(2_001);
    let error = decode_operation(&json!({
        "operationId": op_id(1), "materialId": M, "reason": "create", "expected": null, "next": set,
    }))
    .unwrap_err();
    assert_eq!(error, StudySetErrorCode::RetirementLimit);
}

#[test]
fn malformed_operations_are_refused_before_any_database_work() {
    let base = json!({
        "operationId": op_id(1), "materialId": M, "reason": "create", "expected": null, "next": manual_set(),
    });
    let mut cases: Vec<Value> = Vec::new();
    let mut with = |path: &[&str], value: Value| {
        let mut op = base.clone();
        let mut target = &mut op;
        for key in &path[..path.len() - 1] {
            target = &mut target[*key];
        }
        target[path[path.len() - 1]] = value;
        cases.push(op);
    };
    with(&["operationId"], json!("not-a-uuid"));
    with(
        &["operationId"],
        json!("5E700000-0000-4000-8000-000000000001"),
    );
    with(&["reason"], json!("overwrite"));
    with(&["reason"], json!("edit"));
    with(&["next", "provider"], json!("other"));
    with(&["next", "summaryOrigin"], json!("gemini"));
    with(&["next", "title"], json!("x".repeat(MAX_TITLE + 1)));
    with(&["next", "summary"], json!("x".repeat(MAX_SUMMARY + 1)));
    with(
        &["next", "flashcards"],
        json!([{"front": "", "back": "B", "sourcePage": null}]),
    );
    with(
        &["next", "flashcards"],
        json!([{"front": "F", "back": "B"}]),
    );
    with(
        &["next", "flashcards"],
        json!([{"front": "F", "back": "B", "sourcePage": 0}]),
    );
    with(
        &["next", "flashcards"],
        json!([{"front": "F", "back": "B", "sourcePage": null, "origin": "gemini"}]),
    );
    with(
        &["next", "flashcards"],
        json!([{"front": "F", "back": "B", "sourcePage": null, "replaces": "c-0"}]),
    );
    with(
        &["next", "flashcards"],
        json!([{"front": "F", "back": "B", "sourcePage": null, "extra": 1}]),
    );
    with(
        &["next", "flashcards"],
        json!([{"front": "F", "back": "B", "sourcePage": null, "itemId": "summary"}]),
    );
    with(
        &["next", "sections"],
        json!([{"heading": "H", "body": "B", "itemId": "c-1"}]),
    );
    with(
        &["next", "retired"],
        json!([{"kind": "card", "itemId": "c", "reason": "deleted", "textKey": "x", "terms": []}]),
    );
    with(
        &["next", "retired"],
        json!([{"kind": "card", "itemId": "c", "reason": "deleted", "textKey": "0".repeat(64), "terms": ["b", "a"]}]),
    );
    with(
        &["next", "retired"],
        json!([{"kind": "card", "itemId": "summary", "reason": "deleted", "textKey": "0".repeat(64), "terms": []}]),
    );
    with(
        &["next", "retired"],
        json!([
            {"kind": "card", "itemId": "c", "reason": "deleted", "textKey": "0".repeat(64), "terms": []},
            {"kind": "card", "itemId": "c", "reason": "deleted", "textKey": "0".repeat(64), "terms": []}
        ]),
    );
    for case in cases {
        assert_eq!(
            decode_operation(&case).unwrap_err(),
            StudySetErrorCode::InvalidArgument,
            "{case}"
        );
    }
    // Surrounding whitespace is not counted, as for card review and import.
    let mut padded = base.clone();
    padded["next"]["flashcards"][0]["front"] = json!(format!(" {} \n", "x".repeat(MAX_FRONT)));
    assert!(decode_operation(&padded).is_ok());
}

#[test]
fn restore_refuses_a_damaged_retirement_list_or_history_entry() {
    let mut conn = database();
    save_on(
        &mut conn,
        &operation(1, "create", Value::Null, manual_set()),
        NOW,
    )
    .unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute("UPDATE ai_study_sets SET retired_json = '{}'", [])
        .unwrap();
    assert!(crate::backup::verify_application_connection(&conn)
        .unwrap_err()
        .contains("deletion and correction history"));
    conn.execute("UPDATE ai_study_sets SET retired_json = '[]'", [])
        .unwrap();
    conn.execute(
        "INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
         VALUES ('h', ?1, 'study_set', 'edit', '{\"title\":\"half\"}', 'manual', ?2)",
        params![M, NOW],
    )
    .unwrap();
    assert!(crate::backup::verify_application_connection(&conn)
        .unwrap_err()
        .contains("history entry h"));
}

#[test]
fn a_schema_15_backup_still_restores_under_schema_16() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for m in crate::migrations().into_iter().filter(|m| m.version <= 15) {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn an_altered_history_table_is_refused() {
    let conn = database();
    conn.execute_batch("DROP INDEX idx_study_set_history;")
        .unwrap();
    assert!(crate::backup::verify_application_connection(&conn)
        .unwrap_err()
        .contains("idx_study_set_history"));
}

#[test]
fn cards_fix_guide_wipe_recovery_is_atomic_idempotent_and_backup_valid() {
    let mut conn = database();
    let mut original = manual_set();
    original["provider"] = json!("gemini");
    save_on(
        &mut conn,
        &operation(100, "create", Value::Null, original.clone()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    let mut guide = original.clone();
    guide["summary"] = json!("New guide");
    guide["flashcards"] = json!([]);
    save_on(
        &mut conn,
        &operation(101, "regenerate", before, guide.clone()),
        LATER,
    )
    .unwrap();
    let wiped = row(&mut conn);
    let mut restored = guide.clone();
    restored["flashcards"] = original["flashcards"].clone();
    let mut wrong = restored.clone();
    wrong["summary"] = json!("Wrong guide");
    assert_eq!(
        save_on(
            &mut conn,
            &operation(102, "recover-cards", wiped.clone(), wrong),
            LATER
        ),
        Err(StudySetErrorCode::StaleContent)
    );
    let restore = operation(103, "recover-cards", wiped, restored);
    assert_eq!(save_on(&mut conn, &restore, LATER).unwrap().status, "saved");
    assert_eq!(
        save_on(&mut conn, &restore, LATER).unwrap().status,
        "already_saved"
    );
    let after = row(&mut conn);
    assert_eq!(
        parsed(after.as_object().unwrap(), "flashcards_json"),
        original["flashcards"]
    );
    assert_eq!(after["summary"], guide["summary"]);
    assert_eq!(history(&conn).len(), 2);
    assert_eq!(history(&conn)[1].1, "restore");
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn cards_fix_deliberate_clear_or_new_cards_never_recovers() {
    for reason in ["delete", "edit", "restore", "regenerate"] {
        let mut conn = database();
        let mut original = manual_set();
        original["provider"] = json!("gemini");
        save_on(
            &mut conn,
            &operation(110, "create", Value::Null, original.clone()),
            NOW,
        )
        .unwrap();
        let before = row(&mut conn);
        let mut clear = original.clone();
        clear["flashcards"] = json!([]);
        // A regeneration without a changed guide is not the guide-wipe pattern.
        if reason != "regenerate" {
            clear["summary"] = json!("Deliberately changed");
        }
        save_on(
            &mut conn,
            &operation(111, reason, before, clear.clone()),
            LATER,
        )
        .unwrap();
        let current = row(&mut conn);
        let mut next = clear;
        next["flashcards"] = original["flashcards"].clone();
        assert_eq!(
            save_on(
                &mut conn,
                &operation(112, "recover-cards", current.clone(), next),
                LATER
            ),
            Err(StudySetErrorCode::StaleContent)
        );
        assert_eq!(row(&mut conn), current);
    }
}

#[test]
fn cards_fix_recovery_never_crosses_materials_or_overwrites_new_cards() {
    let mut conn = database();
    let mut original = manual_set();
    original["provider"] = json!("gemini");
    save_on(
        &mut conn,
        &operation(120, "create", Value::Null, original.clone()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    let mut guide = original.clone();
    guide["summary"] = json!("New guide");
    guide["flashcards"] = json!([]);
    save_on(
        &mut conn,
        &operation(121, "regenerate", before, guide.clone()),
        LATER,
    )
    .unwrap();
    let wiped = row(&mut conn);
    conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('other','Other',?1,?1)", [NOW]).unwrap();
    let mut create = operation(122, "create", Value::Null, guide.clone());
    create.material_id = "other".into();
    save_on(&mut conn, &create, NOW).unwrap();
    let tx = conn.transaction().unwrap();
    let other = read_row(&tx, "other").unwrap();
    assert!(guide_card_recovery(&tx, "other", other.as_ref())
        .unwrap()
        .is_none());
    tx.rollback().unwrap();
    let mut restored = guide;
    restored["flashcards"] = original["flashcards"].clone();
    let retry = operation(123, "recover-cards", wiped.clone(), restored.clone());
    save_on(&mut conn, &operation(124, "edit", wiped, restored), LATER).unwrap();
    assert_eq!(
        save_on(&mut conn, &retry, LATER),
        Err(StudySetErrorCode::StaleContent)
    );
}

#[test]
fn cards_fix_later_practice_history_does_not_hide_guide_recovery() {
    let mut conn = database();
    let mut original = manual_set();
    original["provider"] = json!("gemini");
    save_on(
        &mut conn,
        &operation(130, "create", Value::Null, original.clone()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    let mut guide = original;
    guide["summary"] = json!("New guide");
    guide["flashcards"] = json!([]);
    save_on(
        &mut conn,
        &operation(131, "regenerate", before, guide),
        LATER,
    )
    .unwrap();
    // The practice payload belongs to the practice validator, not this detector.
    conn.execute("INSERT INTO study_set_history (id,material_id,kind,reason,previous_json,provider,created_at) VALUES (?1,?2,'practice','edit','{}','gemini',?3)", params![op_id(132),M,LATER]).unwrap();
    let tx = conn.transaction().unwrap();
    let current = read_row(&tx, M).unwrap();
    assert!(guide_card_recovery(&tx, M, current.as_ref())
        .unwrap()
        .is_some());
    tx.rollback().unwrap();
}

/// Replays the shared CARDS-FIX-01 vector (also replayed by the TypeScript
/// tests), returning the vector and the wiped row.
fn replay_recovery_vector(conn: &mut Connection) -> (Value, Value) {
    let vector: Value =
        serde_json::from_str(include_str!("../fixtures/cards-recovery/chain.json")).unwrap();
    assert_eq!(vector["materialId"], M);
    for (i, step) in vector["steps"].as_array().unwrap().iter().enumerate() {
        let expected = row(conn);
        let op = operation(
            140 + i as u32,
            step["reason"].as_str().unwrap(),
            expected,
            step["next"].clone(),
        );
        assert_eq!(save_on(conn, &op, LATER).unwrap().status, "saved");
    }
    let current = row(conn);
    (vector, current)
}

#[test]
fn cards_fix_shared_vector_chain_restores_the_nearest_generated_cards() {
    let mut conn = database();
    let (vector, wiped) = replay_recovery_vector(&mut conn);
    // Further guide regenerations after the wipe still leave the offer, and
    // it names the cards just before the wipe, not the older ones.
    let tx = conn.transaction().unwrap();
    let current = read_row(&tx, M).unwrap();
    let offer = guide_card_recovery(&tx, M, current.as_ref())
        .unwrap()
        .unwrap();
    tx.rollback().unwrap();
    let recovered = validate_next(&vector["recovered"]).unwrap();
    assert_eq!(offer, recovered);
    // The operation the TypeScript notice builds from the same vector.
    let ts_built = decode_operation(&json!({
        "operationId": op_id(150), "materialId": M, "reason": "recover-cards",
        "expected": wiped, "next": vector["recovered"],
    }))
    .unwrap();
    assert_eq!(
        save_on(&mut conn, &ts_built, LATER).unwrap().status,
        "saved"
    );
    let after = row(&mut conn);
    let cards = parsed(after.as_object().unwrap(), "flashcards_json");
    assert_eq!(cards, vector["recovered"]["flashcards"]);
    assert!(cards
        .as_array()
        .unwrap()
        .iter()
        .all(|card| card.get("origin").is_none()));
    assert_eq!(after["summary"], "Fifth guide.");
    let tx = conn.transaction().unwrap();
    let current = read_row(&tx, M).unwrap();
    assert!(guide_card_recovery(&tx, M, current.as_ref())
        .unwrap()
        .is_none());
    tx.rollback().unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn cards_fix_plain_generated_cards_are_restored() {
    let mut conn = database();
    let mut original = manual_set();
    original["provider"] = json!("gemini");
    original["summaryOrigin"] = Value::Null;
    original["sections"] = json!([{"heading": "Crosswind", "body": "Aileron into the wind."}]);
    original["flashcards"] = json!([{"front": "Generated?", "back": "Yes.", "sourcePage": 4}]);
    save_on(
        &mut conn,
        &operation(160, "create", Value::Null, original.clone()),
        NOW,
    )
    .unwrap();
    let before = row(&mut conn);
    let mut guide = original.clone();
    guide["summary"] = json!("New guide");
    guide["flashcards"] = json!([]);
    save_on(
        &mut conn,
        &operation(161, "regenerate", before, guide.clone()),
        LATER,
    )
    .unwrap();
    let wiped = row(&mut conn);
    let mut restored = guide;
    restored["flashcards"] = original["flashcards"].clone();
    let restore = operation(162, "recover-cards", wiped, restored);
    assert_eq!(save_on(&mut conn, &restore, LATER).unwrap().status, "saved");
    assert_eq!(
        parsed(row(&mut conn).as_object().unwrap(), "flashcards_json"),
        original["flashcards"]
    );
}

#[test]
fn cards_fix_restore_with_a_missing_visual_region_changes_nothing() {
    let mut conn = database();
    let (vector, _) = replay_recovery_vector(&mut conn);
    // The cards before the wipe pointed at a picture region that is gone.
    let mut cards = vector["recovered"]["flashcards"].clone();
    cards[0]["visualRegionId"] = json!("ab".repeat(32));
    let (id, previous): (String, String) = conn
        .query_row(
            "SELECT id, previous_json FROM study_set_history WHERE material_id=?1 AND previous_json LIKE '%What is Class B?%'",
            [M],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let mut previous: Value = serde_json::from_str(&previous).unwrap();
    previous["flashcards_json"] = json!(cards.to_string());
    conn.execute(
        "UPDATE study_set_history SET previous_json=?1 WHERE id=?2",
        params![previous.to_string(), id],
    )
    .unwrap();
    let current = row(&mut conn);
    let entries = history(&conn).len();
    let mut next = vector["recovered"].clone();
    next["flashcards"] = cards;
    let restore = operation(170, "recover-cards", current.clone(), next);
    assert!(save_on(&mut conn, &restore, LATER).is_err());
    assert_eq!(row(&mut conn), current);
    assert_eq!(history(&conn).len(), entries);
}
