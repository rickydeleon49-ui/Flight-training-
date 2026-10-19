//! Native card-review contract (M2-3 source slice C1): real rusqlite
//! transactions on disposable database files. Every value is synthetic.

use super::*;
use std::path::PathBuf;

use crate::practice_sessions::{mark_root_ready, unmark_root_ready};

/// An owned temporary directory, cleaned up on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-card-test-{label}-{}-{}",
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

const M: &str = "mat-cards";
const OTHER: &str = "mat-other";

fn cards_a() -> Vec<CanonicalCard> {
    vec![
        CanonicalCard {
            front: "Synthetic card one: which letter follows A?".into(),
            back: "B".into(),
            source_page: Some(1),
            origin: None,
        },
        CanonicalCard {
            front: "Synthetic card two: which letter follows B?".into(),
            back: "C".into(),
            source_page: Some(2),
            origin: None,
        },
        CanonicalCard {
            front: "Synthetic card three: which letter follows C?".into(),
            back: "D".into(),
            source_page: None,
            origin: None,
        },
    ]
}

fn cards_b() -> Vec<CanonicalCard> {
    cards_a()
        .into_iter()
        .enumerate()
        .map(|(i, mut card)| {
            card.back = format!("Synthetic regenerated {i}");
            card
        })
        .collect()
}

fn cards_json(cards: &[CanonicalCard]) -> String {
    serde_json::to_string(
        &cards
            .iter()
            .map(|c| json!({"front": c.front, "back": c.back, "sourcePage": c.source_page}))
            .collect::<Vec<_>>(),
    )
    .unwrap()
}

/// A ready root holding every registered migration.
fn setup(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
    )
    .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    mark_root_ready(root);
    conn
}

fn seed(conn: &Connection, id: &str, cards: &str) {
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?1, 'Synthetic', '2026-10-06T15:00:00.000Z', '2026-10-06T15:00:00.000Z')",
        [id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
         VALUES (?1, 'Synthetic', '', '[]', ?2, '', 'import', '', '2026-10-06T15:00:00.000Z', '2026-10-06T15:00:00.000Z')",
        params![id, cards],
    )
    .unwrap();
}

fn set_cards(conn: &Connection, id: &str, cards: &str) {
    conn.execute(
        "UPDATE ai_study_sets SET flashcards_json = ?1 WHERE source_material_id = ?2",
        params![cards, id],
    )
    .unwrap();
}

fn generation(conn: &Connection, id: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(generation), 0) FROM card_review_generations WHERE source_material_id = ?1",
        [id],
        |r| r.get(0),
    )
    .unwrap()
}

fn revision(conn: &Connection, item_id: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(revision), 0) FROM card_review_state WHERE item_id = ?1",
        [item_id],
        |r| r.get(0),
    )
    .unwrap()
}

#[derive(Debug, PartialEq, Eq)]
struct Counts {
    states: i64,
    events: i64,
    receipts: i64,
    tombstones: i64,
    versions: i64,
    generation: i64,
}

fn counts(conn: &Connection, id: &str) -> Counts {
    let n = |sql: &str| -> i64 { conn.query_row(sql, [id], |r| r.get(0)).unwrap() };
    Counts {
        states: n("SELECT COUNT(*) FROM card_review_state WHERE source_material_id = ?1"),
        events: n("SELECT COUNT(*) FROM card_review_events e JOIN card_items i ON i.id = e.item_id JOIN card_versions v ON v.id = i.version_id WHERE v.source_material_id = ?1"),
        receipts: n("SELECT COUNT(*) FROM card_review_operations WHERE source_material_id = ?1"),
        tombstones: n("SELECT COUNT(*) FROM card_review_operations WHERE source_material_id = ?1 AND is_erased = 1"),
        versions: n("SELECT COUNT(*) FROM card_versions WHERE source_material_id = ?1"),
        generation: generation(conn, id),
    }
}

static NEXT_OP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn op_id() -> String {
    let n = NEXT_OP.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    format!("e1000000-0000-4000-8000-{n:012x}")
}

/// A deliberate item action built from the current authoritative state.
fn item(
    conn: &Connection,
    material: &str,
    cards: &[CanonicalCard],
    ordinal: usize,
    kind: Value,
) -> Value {
    let version = card_version(material, cards);
    let item_id = &version.items[ordinal].item_id;
    let mut action = json!({
        "operationId": op_id(),
        "materialId": material,
        "versionContentHash": version.content_hash,
        "itemId": item_id,
        "expectedGeneration": generation(conn, material),
        "expectedRevision": revision(conn, item_id),
    });
    for (key, value) in kind.as_object().unwrap() {
        action[key] = value.clone();
    }
    action
}

fn rate(
    conn: &Connection,
    material: &str,
    cards: &[CanonicalCard],
    ordinal: usize,
    rating: &str,
) -> Value {
    item(
        conn,
        material,
        cards,
        ordinal,
        json!({"action": "rate", "rating": rating}),
    )
}

fn reset(conn: &Connection, material: &str) -> Value {
    json!({"action": "reset", "operationId": op_id(), "materialId": material, "expectedGeneration": generation(conn, material)})
}

fn refused(result: Result<Value, CardReviewErrorWire>) -> CardReviewErrorCode {
    let wire = result.expect_err("expected a refusal");
    assert_eq!(wire.message, wire.code.message());
    wire.code
}

/// Move a card's stored schedule so its due instant lands where a test needs
/// it, keeping the stored schedule and its rating event mutually consistent.
fn shift_review(conn: &Connection, item_id: &str, last_reviewed_at: &str) {
    let (step, event_id): (i64, String) = conn
        .query_row(
            "SELECT s.step, e.id FROM card_review_state s JOIN card_review_events e ON e.item_id = s.item_id WHERE s.item_id = ?1",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let due = format_iso_ms(parse_iso_ms(last_reviewed_at).unwrap() + step_delay_ms(step).unwrap());
    conn.execute(
        "UPDATE card_review_state SET last_reviewed_at = ?1, due_at = ?2 WHERE item_id = ?3",
        params![last_reviewed_at, due, item_id],
    )
    .unwrap();
    let next: String = conn
        .query_row(
            "SELECT next_state_json FROM card_review_events WHERE id = ?1",
            [&event_id],
            |r| r.get(0),
        )
        .unwrap();
    let mut next: Value = serde_json::from_str(&next).unwrap();
    next["lastReviewedAt"] = json!(last_reviewed_at);
    next["dueAt"] = json!(due);
    conn.execute(
        "UPDATE card_review_events SET reviewed_at = ?1, next_state_json = ?2 WHERE id = ?3",
        params![last_reviewed_at, canonical_json(&next), event_id],
    )
    .unwrap();
    let receipt: String = conn
        .query_row(
            "SELECT result_json FROM card_review_operations WHERE operation_id = ?1",
            [&event_id],
            |r| r.get(0),
        )
        .unwrap();
    let mut receipt: Value = serde_json::from_str(&receipt).unwrap();
    receipt["reviewedAt"] = json!(last_reviewed_at);
    receipt["dueAt"] = json!(due);
    conn.execute(
        "UPDATE card_review_operations SET result_json = ?1 WHERE operation_id = ?2",
        params![canonical_json(&receipt), event_id],
    )
    .unwrap();
}

/* ------------------------------------------------------------------ */
/* Identity, instants and scheduler                                    */
/* ------------------------------------------------------------------ */

#[test]
fn golden_identity_vectors_are_reproduced() {
    let golden: Value = serde_json::from_str(include_str!(
        "../../docs/evidence/m2-card-review-scope-2026-10-06/proof/fixtures/identity-golden.json"
    ))
    .unwrap();
    let material: Value = serde_json::from_str(include_str!(
        "../../docs/evidence/m2-card-review-scope-2026-10-06/proof/fixtures/synthetic-material.json"
    ))
    .unwrap();
    let SavedCards::Ok(cards) = parse_saved_cards(Some(&material["flashcards"].to_string())) else {
        panic!("synthetic cards must validate");
    };
    assert_eq!(
        canonical_cards_json(&cards),
        golden["canonicalJson"].as_str().unwrap()
    );
    let version = card_version(material["materialId"].as_str().unwrap(), &cards);
    assert_eq!(
        version.content_hash,
        golden["contentHash"].as_str().unwrap()
    );
    assert_eq!(version.version_id, golden["versionId"].as_str().unwrap());
    let items: Vec<&str> = version.items.iter().map(|i| i.item_id.as_str()).collect();
    let expected: Vec<&str> = golden["itemIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(items, expected);
}

#[test]
fn saved_card_validation_matches_the_typescript_rules() {
    let set = |v: Value| parse_saved_cards(Some(&v.to_string()));
    let card = |front: &str, back: &str, page: Value| json!({"front": front, "back": back, "sourcePage": page});
    assert_eq!(parse_saved_cards(None), SavedCards::None);
    assert_eq!(set(json!([])), SavedCards::None);
    assert!(matches!(
        set(json!([card("F", "B", Value::Null)])),
        SavedCards::Ok(_)
    ));
    assert!(matches!(
        set(json!(vec![card("F", "B", Value::Null); 500])),
        SavedCards::Ok(_)
    ));
    assert_eq!(
        set(json!(vec![card("F", "B", Value::Null); 501])),
        SavedCards::Malformed
    );
    assert!(matches!(
        set(json!([card(&"x".repeat(1_000), "B", Value::Null)])),
        SavedCards::Ok(_)
    ));
    assert_eq!(
        set(json!([card(&"x".repeat(1_001), "B", Value::Null)])),
        SavedCards::Malformed
    );
    assert!(matches!(
        set(json!([card("F", &"😀".repeat(2_000), Value::Null)])),
        SavedCards::Ok(_)
    ));
    assert_eq!(
        set(json!([card("F", &"😀".repeat(2_001), Value::Null)])),
        SavedCards::Malformed
    );
    assert!(matches!(
        set(json!([card(
            &format!("  {}\n", "x".repeat(1_000)),
            "B",
            Value::Null
        )])),
        SavedCards::Ok(_)
    ));
    for damaged in [
        json!({}),
        json!([card("F", "B", Value::Null), "text"]),
        json!([card("   ", "B", Value::Null)]),
        json!([card("F", "", Value::Null)]),
        json!([{"front": "F", "back": "B"}]),
        json!([card("F", "B", json!(0))]),
        json!([card("F", "B", json!(1_001))]),
        json!([card("F", "B", json!(1.5))]),
        json!([card("F", "B", json!("3"))]),
        json!([card("\u{feff}", "B", Value::Null)]),
    ] {
        assert_eq!(set(damaged.clone()), SavedCards::Malformed, "{damaged}");
    }
    assert_eq!(parse_saved_cards(Some("{not json")), SavedCards::Malformed);
    assert_eq!(
        parse_saved_cards(Some(r#"[{"front":"\ud800","back":"B","sourcePage":null}]"#)),
        SavedCards::Malformed
    );
    assert!(matches!(
        set(json!([card("\u{85}", "B", Value::Null)])),
        SavedCards::Ok(_)
    ));
    assert!(
        matches!(parse_saved_cards(Some(r#"[{"front":"F","back":"B","sourcePage":2.0}]"#)), SavedCards::Ok(c) if c[0].source_page == Some(2))
    );
}

#[test]
fn instants_round_trip_and_refuse_every_other_form() {
    for text in [
        "2026-10-06T15:00:00.000Z",
        "2024-02-29T23:59:59.999Z",
        "1970-01-01T00:00:00.000Z",
        "2026-11-02T06:00:00.000Z",
    ] {
        assert_eq!(format_iso_ms(parse_iso_ms(text).unwrap()), text);
    }
    for bad in [
        "2026-10-06T15:00:00Z",
        "2026-02-29T15:00:00.000Z",
        "2026-13-01T00:00:00.000Z",
        "2026-10-06T24:00:00.000Z",
        "2026-10-06 15:00:00.000Z",
        "2026-10-06T15:00:60.000Z",
    ] {
        assert_eq!(parse_iso_ms(bad), None, "{bad}");
    }
    assert_eq!(
        parse_iso_ms("2026-10-06T15:00:00.000Z"),
        Some(1_791_298_800_000)
    );
}

#[test]
fn simple_v1_matches_the_typescript_arithmetic() {
    let t0 = "2026-10-06T15:00:00.000Z";
    let gap = |s: &CardSchedule| {
        parse_iso_ms(&s.due_at).unwrap() - parse_iso_ms(&s.last_reviewed_at).unwrap()
    };
    let first: Vec<i64> = RATINGS
        .iter()
        .map(|r| gap(&schedule_card(None, r, t0).unwrap()))
        .collect();
    assert_eq!(first, vec![10 * MINUTE_MS, DAY_MS, DAY_MS, 3 * DAY_MS]);
    let mut state: Option<CardSchedule> = None;
    let mut now = t0.to_string();
    let mut longest = 0;
    for _ in 0..12 {
        let next = schedule_card(state.as_ref(), "easy", &now).unwrap();
        longest = longest.max(gap(&next));
        now = next.due_at.clone();
        state = Some(next);
    }
    assert_eq!(longest, 180 * DAY_MS);
    let ladder = schedule_card(
        Some(&schedule_card(None, "good", t0).unwrap()),
        "good",
        "2026-10-07T15:00:00.000Z",
    )
    .unwrap();
    let failed = schedule_card(Some(&ladder), "again", "2026-10-10T15:00:00.000Z").unwrap();
    assert_eq!((failed.step, failed.lapses, failed.reps), (-1, 1, 3));
    let again = schedule_card(Some(&failed), "again", "2026-10-10T15:10:00.000Z").unwrap();
    assert_eq!(again.lapses, 1);
    assert_eq!(
        schedule_card(Some(&ladder), "good", "2026-10-07T14:59:59.999Z"),
        Err(SchedulerRefusal::ClockBehindLastReview)
    );
    let mut foreign = ladder.clone();
    foreign.scheduler_version = "fsrs-6".into();
    assert_eq!(
        schedule_card(Some(&foreign), "good", "2026-10-09T15:00:00.000Z"),
        Err(SchedulerRefusal::UnsupportedSchedulerVersion)
    );
    // The serialized schedule is the exact object the TypeScript side stores.
    assert_eq!(
        canonical_json(&schedule_card(None, "good", t0).unwrap().to_json()),
        r#"{"dueAt":"2026-10-07T15:00:00.000Z","lapses":0,"lastReviewedAt":"2026-10-06T15:00:00.000Z","reps":1,"schedulerVersion":"simple-v1","step":0}"#
    );
}

/* ------------------------------------------------------------------ */
/* Strict decode and readiness                                         */
/* ------------------------------------------------------------------ */

#[test]
fn strict_decode_refuses_every_shape_outside_the_typed_union() {
    let dir = TempDir::new("decode");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let good = rate(&conn, M, &cards_a(), 0, "good");
    let mut cases: Vec<Value> = Vec::new();
    let mut with = |key: &str, value: Value| {
        let mut v = good.clone();
        v[key] = value;
        cases.push(v);
    };
    with("expectedGeneration", json!(-1));
    with("expectedRevision", json!(1.5));
    with("operationId", json!("E1000000-0000-4000-8000-000000000001"));
    with("operationId", json!("e1000000-0000-1000-8000-000000000001"));
    with("versionContentHash", json!("abc"));
    with("itemId", json!("Z".repeat(64)));
    with("rating", json!("perfect"));
    with("materialId", json!("has space"));
    with("extra", json!(1));
    let mut missing = good.clone();
    missing
        .as_object_mut()
        .unwrap()
        .remove("expectedGeneration");
    cases.push(missing);
    let mut reset_with_item = reset(&conn, M);
    reset_with_item["itemId"] = good["itemId"].clone();
    cases.push(reset_with_item);
    let mut suspend_with_rating = good.clone();
    suspend_with_rating["action"] = json!("suspend");
    cases.push(suspend_with_rating);
    let mut big = reset(&conn, M);
    big["materialId"] = json!("x".repeat(70_000));
    cases.push(big);
    cases.push(json!(["not", "an", "object"]));
    cases.push(json!({"action": "erase", "operationId": op_id(), "materialId": M, "expectedGeneration": 0}));
    for case in cases {
        assert_eq!(
            refused(save_card_review_at(dir.path(), &case)),
            CardReviewErrorCode::InvalidArgument,
            "{case}"
        );
    }
    assert_eq!(
        counts(&conn, M),
        Counts {
            states: 0,
            events: 0,
            receipts: 0,
            tombstones: 0,
            versions: 0,
            generation: 0
        }
    );
}

#[test]
fn a_root_that_is_not_ready_refuses_before_any_write() {
    let dir = TempDir::new("not-ready");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    unmark_root_ready(dir.path());
    assert_eq!(
        refused(save_card_review_at(dir.path(), &reset(&conn, M))),
        CardReviewErrorCode::NotReady
    );
    assert_eq!(counts(&conn, M).receipts, 0);
}

/* ------------------------------------------------------------------ */
/* CRS-R2: generation barrier, replay, isolation                       */
/* ------------------------------------------------------------------ */

#[test]
fn reset_racing_a_queued_rating_refuses_the_pre_reset_revision_0_request() {
    let dir = TempDir::new("race0");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let captured = rate(&conn, M, &cards_a(), 0, "good");
    save_card_review_at(dir.path(), &reset(&conn, M)).unwrap();
    let before = counts(&conn, M);
    assert_eq!(
        refused(save_card_review_at(dir.path(), &captured)),
        CardReviewErrorCode::StaleGeneration
    );
    assert_eq!(counts(&conn, M), before);
    assert_eq!(before.generation, 1);
}

#[test]
fn a_pre_reset_revision_1_request_stays_refused_after_a_new_rating_reaches_revision_1() {
    let dir = TempDir::new("race1");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    let captured = rate(&conn, M, &cards_a(), 0, "easy");
    assert_eq!(captured["expectedRevision"], json!(1));
    save_card_review_at(dir.path(), &reset(&conn, M)).unwrap();
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    assert_eq!(
        revision(&conn, &card_version(M, &cards_a()).items[0].item_id),
        1
    );
    let before = counts(&conn, M);
    assert_eq!(
        refused(save_card_review_at(dir.path(), &captured)),
        CardReviewErrorCode::StaleGeneration
    );
    assert_eq!(counts(&conn, M), before);
}

#[test]
fn committed_reset_replay_after_reopen_and_new_work_returns_its_result_and_erases_nothing() {
    let dir = TempDir::new("reset-replay");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let reset_action = reset(&conn, M);
    let first = save_card_review_at(dir.path(), &reset_action).unwrap();
    assert_eq!(
        first,
        json!({"action": "reset", "materialId": M, "generation": 1})
    );
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    drop(conn);
    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    let before = counts(&conn, M);
    assert_eq!(
        save_card_review_at(dir.path(), &reset_action).unwrap(),
        first
    );
    assert_eq!(counts(&conn, M), before);
    assert_eq!((before.generation, before.events, before.states), (1, 1, 1));
}

#[test]
fn repeated_resets_skip_tombstones_and_keep_routing_metadata() {
    let dir = TempDir::new("repeat-reset");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let rated = rate(&conn, M, &cards_a(), 0, "good");
    save_card_review_at(dir.path(), &rated).unwrap();
    let first_reset = reset(&conn, M);
    save_card_review_at(dir.path(), &first_reset).unwrap();
    save_card_review_at(dir.path(), &reset(&conn, M)).unwrap();
    let tomb: (String, String, i64, String, i64, Option<String>) = conn
        .query_row(
            "SELECT action, source_material_id, generation, request_hash, is_erased, result_json FROM card_review_operations WHERE operation_id = ?1",
            [rated["operationId"].as_str().unwrap()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .unwrap();
    assert_eq!(
        (tomb.0.as_str(), tomb.1.as_str(), tomb.2, tomb.4, tomb.5),
        ("rate", M, 0, 1, None)
    );
    assert!(is_lower_hex_64(&tomb.3));
    assert_eq!(
        refused(save_card_review_at(dir.path(), &first_reset)),
        CardReviewErrorCode::OperationErased
    );
    assert_eq!(generation(&conn, M), 2);
}

#[test]
fn reset_conflicts_stale_resets_and_isolation_from_other_materials_and_practice() {
    let dir = TempDir::new("reset-isolation");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    seed(&conn, OTHER, &cards_json(&cards_a()));
    crate::practice_sessions::save_practice_test_at(
        dir.path(),
        M,
        "Synthetic",
        r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,
        "synthetic",
    )
    .unwrap();
    let practice = |c: &Connection| -> (i64, i64) {
        c.query_row(
            "SELECT (SELECT COUNT(*) FROM practice_test_versions), (SELECT COUNT(*) FROM practice_test_items)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    };
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    save_card_review_at(dir.path(), &rate(&conn, OTHER, &cards_a(), 0, "good")).unwrap();
    let other_before = counts(&conn, OTHER);
    let practice_before = practice(&conn);
    let reset_action = reset(&conn, M);
    save_card_review_at(dir.path(), &reset_action).unwrap();
    assert_eq!(counts(&conn, OTHER), other_before);
    assert_eq!(practice(&conn), practice_before);
    let before = counts(&conn, M);
    let mut changed = reset_action.clone();
    changed["expectedGeneration"] = json!(1);
    assert_eq!(
        refused(save_card_review_at(dir.path(), &changed)),
        CardReviewErrorCode::OperationConflict
    );
    let mut stale = reset_action.clone();
    stale["operationId"] = json!(op_id());
    assert_eq!(
        refused(save_card_review_at(dir.path(), &stale)),
        CardReviewErrorCode::StaleGeneration
    );
    assert_eq!(counts(&conn, M), before);
}

#[test]
fn reset_keeps_the_current_snapshot_and_prunes_older_versions() {
    let dir = TempDir::new("reset-prune");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    set_cards(&conn, M, &cards_json(&cards_b()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_b(), 0, "good")).unwrap();
    save_card_review_at(dir.path(), &reset(&conn, M)).unwrap();
    let rows: Vec<(String, Option<String>, i64)> = conn
        .prepare("SELECT id, first_reviewed_at, is_active FROM card_versions WHERE source_material_id = ?1")
        .unwrap()
        .query_map([M], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![(card_version(M, &cards_b()).version_id, None, 1)]
    );
    // Damaged saved cards: reset prunes every snapshot.
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_b(), 1, "good")).unwrap();
    set_cards(&conn, M, "{not json");
    save_card_review_at(dir.path(), &reset(&conn, M)).unwrap();
    assert_eq!(counts(&conn, M).versions, 0);
}

/* ------------------------------------------------------------------ */
/* Item actions                                                        */
/* ------------------------------------------------------------------ */

#[test]
fn first_suspend_before_any_rating_creates_the_snapshot_without_a_review() {
    let dir = TempDir::new("first-suspend");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let result = save_card_review_at(
        dir.path(),
        &item(&conn, M, &cards_a(), 1, json!({"action": "suspend"})),
    )
    .unwrap();
    assert_eq!(result["dueAt"], Value::Null);
    assert_eq!(result["reviewedAt"], Value::Null);
    assert_eq!(result["suspended"], json!(true));
    let (created_at, first_reviewed_at, active, count): (String, Option<String>, i64, i64) = conn
        .query_row(
            "SELECT created_at, first_reviewed_at, is_active, card_count FROM card_versions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert!(parse_iso_ms(&created_at).is_some());
    assert_eq!((first_reviewed_at, active, count), (None, 1, 3));
    assert_eq!(counts(&conn, M).events, 0);
    save_card_review_at(
        dir.path(),
        &item(&conn, M, &cards_a(), 1, json!({"action": "resume"})),
    )
    .unwrap();
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 1, "easy")).unwrap();
    let first: Option<String> = conn
        .query_row("SELECT first_reviewed_at FROM card_versions", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(first.is_some());
}

#[test]
fn flags_and_suspensions_refuse_ratings_without_changing_the_schedule() {
    let dir = TempDir::new("flag");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let rated = save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    save_card_review_at(
        dir.path(),
        &item(
            &conn,
            M,
            &cards_a(),
            0,
            json!({"action": "flag", "reason": "not_in_source"}),
        ),
    )
    .unwrap();
    assert_eq!(
        refused(save_card_review_at(
            dir.path(),
            &rate(&conn, M, &cards_a(), 0, "good")
        )),
        CardReviewErrorCode::CardFlagged
    );
    let unflagged = save_card_review_at(
        dir.path(),
        &item(&conn, M, &cards_a(), 0, json!({"action": "unflag"})),
    )
    .unwrap();
    assert_eq!(unflagged["dueAt"], rated["dueAt"]);
    save_card_review_at(
        dir.path(),
        &item(&conn, M, &cards_a(), 0, json!({"action": "suspend"})),
    )
    .unwrap();
    assert_eq!(
        refused(save_card_review_at(
            dir.path(),
            &rate(&conn, M, &cards_a(), 0, "good")
        )),
        CardReviewErrorCode::CardSuspended
    );
    assert_eq!(counts(&conn, M).events, 1);
}

#[test]
fn same_id_replay_after_reopen_returns_the_stored_result_once() {
    let dir = TempDir::new("replay");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let action = rate(&conn, M, &cards_a(), 0, "good");
    let first = save_card_review_at(dir.path(), &action).unwrap();
    drop(conn);
    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    assert_eq!(save_card_review_at(dir.path(), &action).unwrap(), first);
    assert_eq!((counts(&conn, M).events, counts(&conn, M).receipts), (1, 1));
    let mut changed = action.clone();
    changed["rating"] = json!("easy");
    assert_eq!(
        refused(save_card_review_at(dir.path(), &changed)),
        CardReviewErrorCode::OperationConflict
    );
}

#[test]
fn stale_revision_stale_content_and_malformed_cards_refuse_without_writing() {
    let dir = TempDir::new("stale");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let stale = rate(&conn, M, &cards_a(), 0, "good");
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    let before = counts(&conn, M);
    assert_eq!(
        refused(save_card_review_at(dir.path(), &stale)),
        CardReviewErrorCode::StaleRevision
    );
    let old = rate(&conn, M, &cards_a(), 1, "good");
    set_cards(&conn, M, &cards_json(&cards_b()));
    assert_eq!(
        refused(save_card_review_at(dir.path(), &old)),
        CardReviewErrorCode::StaleContent
    );
    set_cards(&conn, M, r#"[{"front":"","back":"B","sourcePage":null}]"#);
    let mut again = old.clone();
    again["operationId"] = json!(op_id());
    assert_eq!(
        refused(save_card_review_at(dir.path(), &again)),
        CardReviewErrorCode::MalformedCards
    );
    set_cards(&conn, M, "[]");
    again["operationId"] = json!(op_id());
    assert_eq!(
        refused(save_card_review_at(dir.path(), &again)),
        CardReviewErrorCode::NotFound
    );
    assert_eq!(counts(&conn, M), before);
}

#[test]
fn clock_rollback_refuses_the_rating_with_nothing_written() {
    let dir = TempDir::new("clock");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    // The stored last review is a day ahead of the system clock.
    let item_id = card_version(M, &cards_a()).items[0].item_id.clone();
    let ahead = format_iso_ms(parse_iso_ms(&db_now_iso(&conn).unwrap()).unwrap() + DAY_MS);
    shift_review(&conn, &item_id, &ahead);
    let before = counts(&conn, M);
    assert_eq!(
        refused(save_card_review_at(
            dir.path(),
            &rate(&conn, M, &cards_a(), 0, "good")
        )),
        CardReviewErrorCode::ClockBehindLastReview
    );
    assert_eq!(counts(&conn, M), before);
}

#[test]
fn deleting_the_material_cascades_card_history_and_tombstones_refuse_replay() {
    let dir = TempDir::new("delete");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let rated = rate(&conn, M, &cards_a(), 0, "good");
    save_card_review_at(dir.path(), &rated).unwrap();
    save_card_review_at(dir.path(), &reset(&conn, M)).unwrap();
    save_card_review_at(
        dir.path(),
        &item(
            &conn,
            M,
            &cards_a(),
            1,
            json!({"action": "flag", "reason": "unclear"}),
        ),
    )
    .unwrap();
    conn.execute("DELETE FROM study_materials WHERE id = ?1", [M])
        .unwrap();
    assert_eq!(
        counts(&conn, M),
        Counts {
            states: 0,
            events: 0,
            receipts: 3,
            tombstones: 3,
            versions: 0,
            generation: 0
        }
    );
    let items: i64 = conn
        .query_row("SELECT COUNT(*) FROM card_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(items, 0);
    assert_eq!(
        refused(save_card_review_at(dir.path(), &rated)),
        CardReviewErrorCode::OperationErased
    );
    crate::backup::verify_schema_12_card_semantics(&conn).unwrap();
}

/* ------------------------------------------------------------------ */
/* Rollback by real SQL failure injection                              */
/* ------------------------------------------------------------------ */

fn inject(conn: &Connection, name: &str, timing: &str) {
    conn.execute_batch(&format!(
        "CREATE TRIGGER inject_{name} {timing} BEGIN SELECT RAISE(ABORT, 'synthetic injected failure'); END;"
    ))
    .unwrap();
}

#[test]
fn a_failing_event_receipt_state_or_generation_write_commits_nothing() {
    for (name, timing, use_reset) in [
        ("event", "BEFORE INSERT ON card_review_events", false),
        ("receipt", "BEFORE INSERT ON card_review_operations", false),
        ("state", "BEFORE INSERT ON card_review_state", false),
        (
            "generation",
            "BEFORE INSERT ON card_review_generations",
            true,
        ),
        (
            "reset_receipt",
            "BEFORE INSERT ON card_review_operations",
            true,
        ),
    ] {
        let dir = TempDir::new(name);
        let conn = setup(dir.path());
        seed(&conn, M, &cards_json(&cards_a()));
        if use_reset {
            save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
        }
        let before = counts(&conn, M);
        let items_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM card_items", [], |r| r.get(0))
            .unwrap();
        inject(&conn, name, timing);
        let action = if use_reset {
            reset(&conn, M)
        } else {
            rate(&conn, M, &cards_a(), 0, "good")
        };
        assert_eq!(
            refused(save_card_review_at(dir.path(), &action)),
            CardReviewErrorCode::StorageError,
            "{name}"
        );
        assert_eq!(counts(&conn, M), before, "{name}");
        let items_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM card_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(items_after, items_before, "{name}: no partial snapshot");
        conn.execute_batch(&format!("DROP TRIGGER inject_{name};"))
            .unwrap();
        // The same request identity then applies for real.
        save_card_review_at(dir.path(), &action).unwrap();
        crate::backup::verify_schema_12_card_semantics(&conn).unwrap();
    }
}

/* ------------------------------------------------------------------ */
/* The repository's due query on natively written rows                 */
/* ------------------------------------------------------------------ */

/// The exact due SQL the TypeScript repository runs (shared text, not a copy).
fn due_states_sql() -> &'static str {
    let source = include_str!("../../src/data/repositories/cardReviewRepository.ts");
    let start = source.find("export const DUE_STATES_SQL = `").unwrap()
        + "export const DUE_STATES_SQL = `".len();
    let end = start + source[start..].find('`').unwrap();
    &source[start..end]
}

fn due_ids(conn: &Connection, version_id: &str, now: &str, boundary: &str) -> Vec<String> {
    conn.prepare(due_states_sql())
        .unwrap()
        .query_map(params![version_id, M, now, boundary, 20], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn the_due_query_applies_exact_boundaries_and_current_version_ownership_on_native_rows() {
    let dir = TempDir::new("due-sql");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    let a = card_version(M, &cards_a());
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "again")).unwrap();
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 1, "good")).unwrap();
    let due_of = |item_id: &str| -> String {
        conn.query_row(
            "SELECT due_at FROM card_review_state WHERE item_id = ?1",
            [item_id],
            |r| r.get(0),
        )
        .unwrap()
    };
    let again_due = due_of(&a.items[0].item_id);
    let day_due = due_of(&a.items[1].item_id);
    let far = "2099-01-01T00:00:00.000Z";
    let minute_nine = format_iso_ms(parse_iso_ms(&again_due).unwrap() - MINUTE_MS);
    // Again: exact instant, never the end of the day.
    assert!(
        !due_ids(&conn, &a.version_id, &minute_nine, &minute_nine).contains(&a.items[0].item_id)
    );
    assert_eq!(
        due_ids(&conn, &a.version_id, &again_due, &again_due)[0],
        a.items[0].item_id
    );
    // Day step: the next local midnight is exclusive.
    assert!(!due_ids(&conn, &a.version_id, &again_due, &day_due).contains(&a.items[1].item_id));
    let just_after = format_iso_ms(parse_iso_ms(&day_due).unwrap() + 1);
    assert!(due_ids(&conn, &a.version_id, &again_due, &just_after).contains(&a.items[1].item_id));
    // Regenerated B is current: A's retained due rows are never B's due work.
    set_cards(&conn, M, &cards_json(&cards_b()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_b(), 0, "good")).unwrap();
    let b = card_version(M, &cards_b());
    assert_eq!(
        due_ids(&conn, &b.version_id, far, far),
        vec![b.items[0].item_id.clone()]
    );
    // Suspended and flagged rows are excluded before the limit.
    save_card_review_at(
        dir.path(),
        &item(&conn, M, &cards_b(), 0, json!({"action": "suspend"})),
    )
    .unwrap();
    assert!(due_ids(&conn, &b.version_id, far, far).is_empty());
    crate::backup::verify_schema_12_card_semantics(&conn).unwrap();
}

/* ------------------------------------------------------------------ */
/* Validation of natively written state, and schema ceilings           */
/* ------------------------------------------------------------------ */

#[test]
fn natively_written_card_history_passes_whole_application_validation() {
    let dir = TempDir::new("validate-native");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    seed(&conn, OTHER, &cards_json(&cards_b()));
    for rating in ["good", "again", "good", "hard", "easy"] {
        save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, rating)).unwrap();
    }
    save_card_review_at(
        dir.path(),
        &item(
            &conn,
            M,
            &cards_a(),
            1,
            json!({"action": "flag", "reason": "unclear"}),
        ),
    )
    .unwrap();
    save_card_review_at(
        dir.path(),
        &item(&conn, M, &cards_a(), 2, json!({"action": "suspend"})),
    )
    .unwrap();
    set_cards(&conn, M, &cards_json(&cards_b()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_b(), 0, "good")).unwrap();
    save_card_review_at(dir.path(), &rate(&conn, OTHER, &cards_b(), 2, "good")).unwrap();
    save_card_review_at(dir.path(), &reset(&conn, OTHER)).unwrap();
    save_card_review_at(dir.path(), &rate(&conn, OTHER, &cards_b(), 2, "again")).unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn a_schema_11_database_validates_and_a_newer_database_is_refused() {
    let dir = TempDir::new("ceiling");
    let path = dir.path().join("eleven.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for m in crate::migrations().into_iter().filter(|m| m.version <= 11) {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    crate::backup::verify_application_connection(&conn).unwrap();
    // Migration 12 applies to it with empty tables, and it still validates.
    conn.execute_batch(crate::migrations()[11].sql).unwrap();
    conn.execute("INSERT INTO _sqlx_migrations (version) VALUES (12)", [])
        .unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
    // And so does every later shipped migration, up to the current schema.
    for m in crate::migrations().into_iter().filter(|m| m.version > 12) {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
        crate::backup::verify_application_connection(&conn).unwrap();
    }
    conn.execute(
        "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
        [crate::CURRENT_SCHEMA_VERSION + 1],
    )
    .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("newer database format"), "{error}");
}

/* ------------------------------------------------------------------ */
/* Shared validator contract (native runner)                           */
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

#[test]
fn shared_card_validation_contract_native_outcomes() {
    let contract: ValidationContract =
        serde_json::from_str(include_str!("../fixtures/card-validation/cases.json")).unwrap();
    let mut mismatches = Vec::new();
    for case in &contract.cases {
        let dir = TempDir::new("card-contract");
        let path = dir.path().join("her-flight-deck.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for m in crate::migrations() {
                conn.execute_batch(m.sql).unwrap();
            }
            for statement in contract.baseline.iter().chain(&case.sql) {
                conn.execute_batch(statement)
                    .unwrap_or_else(|e| panic!("fixture statement failed: {statement}: {e}"));
            }
        }
        let conn = Connection::open(&path).unwrap();
        let result = crate::backup::verify_schema_12_card_semantics(&conn);
        let outcome = if result.is_ok() { "accept" } else { "refuse" };
        if outcome != case.expect {
            mismatches.push(format!(
                "{} [{}]: expected {}, got {result:?}",
                case.name, case.category, case.expect
            ));
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
    assert!(contract.cases.len() >= 30);
}

#[test]
fn every_native_message_is_the_typescript_allowlisted_message() {
    let typescript = include_str!("../../src/data/persistenceErrors.ts");
    for code in [
        CardReviewErrorCode::InvalidArgument,
        CardReviewErrorCode::OperationConflict,
        CardReviewErrorCode::OperationErased,
        CardReviewErrorCode::StaleGeneration,
        CardReviewErrorCode::StaleRevision,
        CardReviewErrorCode::StaleContent,
        CardReviewErrorCode::MalformedCards,
        CardReviewErrorCode::CardSuspended,
        CardReviewErrorCode::CardFlagged,
        CardReviewErrorCode::ClockBehindLastReview,
        CardReviewErrorCode::NotFound,
        CardReviewErrorCode::InvalidState,
        CardReviewErrorCode::NotReady,
        CardReviewErrorCode::StorageError,
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

/* ------------------------------------------------------------------ */
/* OFFLINE-03a: who wrote each card                                    */
/* ------------------------------------------------------------------ */

fn vector_cards(vector: &Value) -> Vec<CanonicalCard> {
    let SavedCards::Ok(cards) = parse_saved_cards(Some(&vector["cards"].to_string())) else {
        panic!("vector cards must validate");
    };
    cards
}

#[test]
fn origin_vectors_keep_legacy_hashes_and_match_independent_values() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../src/testing/cardOriginVectors.json")).unwrap();
    let material = fixture["materialId"].as_str().unwrap();
    for vector in fixture["vectors"].as_array().unwrap() {
        let cards = vector_cards(vector);
        assert_eq!(
            canonical_cards_json(&cards),
            vector["canonical"].as_str().unwrap()
        );
        let version = card_version(material, &cards);
        assert_eq!(version.content_hash, vector["contentHash"].as_str().unwrap());
        assert_eq!(version.version_id, vector["versionId"].as_str().unwrap());
        assert_eq!(
            version.items[0].item_id,
            vector["firstItemId"].as_str().unwrap()
        );
        assert_eq!(
            version_origin(&version.items),
            vector["versionOrigin"].as_str()
        );
    }
}

#[test]
fn an_unknown_card_origin_makes_the_set_malformed() {
    for origin in [json!("gemini"), json!(null), json!(1), json!("")] {
        let cards = json!([{"front": "F", "back": "B", "sourcePage": null, "origin": origin}]);
        assert_eq!(
            parse_saved_cards(Some(&cards.to_string())),
            SavedCards::Malformed
        );
    }
}

fn mine(mut cards: Vec<CanonicalCard>, ordinal: usize, origin: &str) -> Vec<CanonicalCard> {
    cards[ordinal].origin = Some(origin.to_string());
    cards
}

fn origin_cards_json(cards: &[CanonicalCard]) -> String {
    serde_json::to_string(
        &cards
            .iter()
            .map(|c| {
                let mut value = json!({"front": c.front, "back": c.back, "sourcePage": c.source_page});
                if let Some(origin) = &c.origin {
                    value["origin"] = json!(origin);
                }
                value
            })
            .collect::<Vec<_>>(),
    )
    .unwrap()
}

#[test]
fn a_snapshot_records_card_origins_beside_the_legacy_provider() {
    let dir = TempDir::new("origins");
    let conn = setup(dir.path());
    let cards = mine(cards_a(), 1, "instructor");
    seed(&conn, M, &origin_cards_json(&cards));
    conn.execute("UPDATE ai_study_sets SET provider = 'manual'", [])
        .unwrap();
    save_card_review_at(dir.path(), &rate(&conn, M, &cards, 1, "good")).unwrap();
    let version = card_version(M, &cards);
    let provider: String = conn
        .query_row("SELECT provider FROM card_versions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(provider, "import");
    let origin: String = conn
        .query_row(
            "SELECT origin FROM card_item_origins WHERE item_id = ?1",
            [&version.items[1].item_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(origin, "instructor");
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM card_item_origins", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1);
    let version_origin: String = conn
        .query_row("SELECT origin FROM card_version_origins", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version_origin, "mixed");
    crate::backup::verify_application_connection(&conn).unwrap();

    // A second action verifies the stored snapshot, origins included.
    save_card_review_at(dir.path(), &rate(&conn, M, &cards, 0, "good")).unwrap();

    // Restore refuses a snapshot whose side-table origin no longer matches its hash.
    conn.execute("UPDATE card_item_origins SET origin = 'user'", [])
        .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("content hash"), "{error}");
    conn.execute("DELETE FROM card_item_origins", []).unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("content hash"), "{error}");
}

#[test]
fn a_tampered_version_origin_is_refused() {
    let dir = TempDir::new("version-origin");
    let conn = setup(dir.path());
    let cards = mine(cards_a(), 0, "user");
    seed(&conn, M, &origin_cards_json(&cards));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards, 0, "good")).unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute("UPDATE card_version_origins SET origin = 'manual'", [])
        .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("origin does not match"), "{error}");
}

#[test]
fn legacy_cards_still_snapshot_without_origin_rows() {
    let dir = TempDir::new("legacy-origins");
    let conn = setup(dir.path());
    seed(&conn, M, &cards_json(&cards_a()));
    save_card_review_at(dir.path(), &rate(&conn, M, &cards_a(), 0, "good")).unwrap();
    let rows: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM card_item_origins) + (SELECT COUNT(*) FROM card_version_origins)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 0);
    crate::backup::verify_application_connection(&conn).unwrap();
}
