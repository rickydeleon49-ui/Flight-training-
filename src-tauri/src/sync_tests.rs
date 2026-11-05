//! Synthetic-data tests for the sync foundation: change files, the table
//! registry and replay. In-memory SQLite only; no files on disk.

use std::io::Write;

use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

use crate::card_reviews::{format_iso_ms, parse_iso_ms, schedule_card, CardSchedule};
use crate::sync::changeset::{
    decode, encode, file_name, folder, Change, ChangeFileError, ChangeSet, Op,
    CHANGE_FORMAT_VERSION, MAX_DECODED_BYTES,
};
use crate::sync::replay::{event_from_row, order_key, replay_item, ReplayError, ReviewEvent};
use crate::sync::tables::{read_row_json, table, MergeRule, SYNC_TABLES};

const NOW: &str = "2026-11-04T12:00:00.000Z";
const SCHEMA: i64 = crate::CURRENT_SCHEMA_VERSION;

fn migrated() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
    }
    conn
}

fn row(pairs: &[(&str, Value)]) -> Option<Map<String, Value>> {
    Some(
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
}

fn change(seq: i64, table: &str, id: &str, op: Op, row: Option<Map<String, Value>>) -> Change {
    Change {
        seq,
        table: table.to_string(),
        row_id: id.to_string(),
        op,
        changed_at: "2026-11-04T11:00:00.000Z".to_string(),
        row,
    }
}

fn sample_set() -> ChangeSet {
    sorted(unsorted_set())
}

fn unsorted_set() -> ChangeSet {
    ChangeSet {
        format_version: CHANGE_FORMAT_VERSION,
        schema_version: SCHEMA,
        device_id: "11111111-2222-4333-8444-555555555555".to_string(),
        app_version: "0.0.0-test".to_string(),
        created_at: "2026-11-04T11:30:00.000Z".to_string(),
        from_seq: 1,
        to_seq: 3,
        changes: vec![
            change(3, "material_bookmarks", "bm-3", Op::Delete, None),
            change(
                1,
                "card_review_events",
                "ev-1",
                Op::Insert,
                row(&[
                    ("id", json!("ev-1")),
                    ("generation", json!(0)),
                    ("note", Value::Null),
                ]),
            ),
            change(
                2,
                "material_bookmarks",
                "bm-2",
                Op::Update,
                row(&[
                    ("id", json!("bm-2")),
                    ("blob", json!({"$base64": "AAEC"})),
                    ("ratio", json!(1.5)),
                ]),
            ),
        ],
    }
}

fn sorted(mut set: ChangeSet) -> ChangeSet {
    set.changes.sort_by_key(|c| c.seq);
    set
}

/// Build a valid-looking file from raw JSON text, bypassing `encode`'s checks.
fn pack(json: &str, from: i64, to: i64) -> (Vec<u8>, String) {
    let mut gz = flate2::GzBuilder::new()
        .mtime(0)
        .write(Vec::new(), flate2::Compression::default());
    gz.write_all(json.as_bytes()).unwrap();
    let bytes = gz.finish().unwrap();
    let name = file_name("x", from, to, &hex::encode(sha2_digest(&bytes)));
    (bytes, name)
}

fn sha2_digest(bytes: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).to_vec()
}

fn pack_set(set: &ChangeSet) -> (Vec<u8>, String) {
    pack(
        &serde_json::to_string(set).unwrap(),
        set.from_seq,
        set.to_seq,
    )
}

fn decode_set(
    set: &ChangeSet,
) -> Result<crate::sync::changeset::DecodedChangeFile, ChangeFileError> {
    let (bytes, name) = pack_set(set);
    decode(&bytes, &name, SCHEMA, NOW)
}

/* ------------------------------ format ------------------------------ */

#[test]
fn encode_then_decode_is_identity() {
    let set = unsorted_set();
    let encoded = encode(&set).unwrap();
    assert!(encoded.file_name.starts_with("1-3-"));
    assert!(encoded.file_name.ends_with(".json.gz"));
    assert_eq!(
        encoded.file_name,
        file_name(&set.device_id, 1, 3, &encoded.sha256)
    );
    let decoded = decode(&encoded.bytes, &encoded.file_name, SCHEMA, NOW).unwrap();
    assert!(!decoded.created_in_future);
    assert_eq!(decoded.set, sorted(set.clone()));
    assert_eq!(folder(&set.device_id), format!("changes/{}", set.device_id));
}

#[test]
fn encoding_is_byte_identical_for_equal_sets() {
    let a = encode(&unsorted_set()).unwrap();
    let mut reordered = unsorted_set();
    reordered.changes.reverse();
    let b = encode(&reordered).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.bytes, encode(&sample_set()).unwrap().bytes);
}

#[test]
fn duplicate_seq_is_refused_at_encode() {
    let mut set = sample_set();
    set.changes[2].seq = 1;
    assert_eq!(encode(&set), Err(ChangeFileError::DuplicateSeq));
}

#[test]
fn a_flipped_byte_is_refused() {
    let encoded = encode(&sample_set()).unwrap();
    for i in [0, encoded.bytes.len() / 2, encoded.bytes.len() - 1] {
        let mut bytes = encoded.bytes.clone();
        bytes[i] ^= 0x01;
        assert_eq!(
            decode(&bytes, &encoded.file_name, SCHEMA, NOW),
            Err(ChangeFileError::NameMismatch)
        );
    }
}

#[test]
fn a_renamed_file_is_refused() {
    let encoded = encode(&sample_set()).unwrap();
    let sha = &encoded.sha256[..12];
    for name in [
        format!("1-4-{sha}.json.gz"),
        format!("2-3-{sha}.json.gz"),
        "1-3-000000000000.json.gz".to_string(),
        format!("1-3-{sha}.json"),
        "whatever.json.gz".to_string(),
    ] {
        assert_eq!(
            decode(&encoded.bytes, &name, SCHEMA, NOW),
            Err(ChangeFileError::NameMismatch),
            "{name}"
        );
    }
}

#[test]
fn newer_schema_is_kept_not_applied() {
    let mut set = sample_set();
    set.schema_version = SCHEMA + 1;
    assert_eq!(decode_set(&set), Err(ChangeFileError::SchemaTooNew));
}

#[test]
fn newer_format_is_refused() {
    let mut set = sample_set();
    set.format_version = CHANGE_FORMAT_VERSION + 1;
    assert_eq!(decode_set(&set), Err(ChangeFileError::FormatTooNew));
}

#[test]
fn oversized_gzip_is_refused_before_full_inflate() {
    let mut gz = flate2::GzBuilder::new().write(Vec::new(), flate2::Compression::default());
    let zeros = vec![0u8; 1024 * 1024];
    for _ in 0..70 {
        gz.write_all(&zeros).unwrap();
    }
    let bytes = gz.finish().unwrap();
    assert!(bytes.len() < 1024 * 1024);
    const { assert!(70 * 1024 * 1024 > MAX_DECODED_BYTES) };
    let name = file_name("x", 1, 1, &hex::encode(sha2_digest(&bytes)));
    assert_eq!(
        decode(&bytes, &name, SCHEMA, NOW),
        Err(ChangeFileError::TooLarge)
    );
}

#[test]
fn future_created_at_is_a_warning_not_an_error() {
    let now_ms = parse_iso_ms(NOW).unwrap();
    for (minutes, flagged) in [(6, true), (4, false)] {
        let mut set = sample_set();
        set.created_at = format_iso_ms(now_ms + minutes * 60_000);
        let decoded = decode_set(&set).unwrap();
        assert_eq!(decoded.created_in_future, flagged, "{minutes} min");
    }
    let mut set = sample_set();
    set.created_at = "yesterday".to_string();
    assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
}

#[test]
fn delete_with_a_row_is_malformed() {
    let mut set = sample_set();
    set.changes[2].row = row(&[("id", json!("bm-3"))]);
    assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
    let mut set = sample_set();
    set.changes[0].row = None;
    assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
}

#[test]
fn unsorted_or_out_of_range_seq_is_malformed() {
    let mut set = sample_set();
    set.changes.swap(0, 1);
    assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
    let mut set = sample_set();
    set.to_seq = 2;
    assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
}

#[test]
fn row_key_must_match_row_id() {
    for bad in [
        row(&[("id", json!("other"))]),
        row(&[("name", json!("bm-2"))]),
        row(&[("id", json!(2))]),
    ] {
        let mut set = sample_set();
        set.changes[1].row = bad;
        assert_eq!(encode(&set), Err(ChangeFileError::Malformed));
        assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
    }
}

#[test]
fn bad_changed_at_is_malformed() {
    let mut set = sample_set();
    set.changes[0].changed_at = "later".to_string();
    assert_eq!(encode(&set), Err(ChangeFileError::Malformed));
    assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
}

#[test]
fn empty_or_inverted_seq_range_is_malformed() {
    let mut zero = sample_set();
    zero.from_seq = 0;
    let mut inverted = sample_set();
    inverted.to_seq = 0;
    let mut empty = sample_set();
    empty.changes.clear();
    for set in [zero, inverted, empty] {
        assert_eq!(encode(&set), Err(ChangeFileError::Malformed));
        assert_eq!(decode_set(&set), Err(ChangeFileError::Malformed));
    }
}

#[test]
fn unknown_table_is_refused() {
    let mut set = sample_set();
    set.changes[0].table = "card_review_operations".to_string();
    assert_eq!(
        decode_set(&set),
        Err(ChangeFileError::UnknownTable(
            "card_review_operations".to_string()
        ))
    );
}

#[test]
fn bad_device_id_is_refused() {
    for id in ["../x", "a b", "", &"a".repeat(65), "UPPER"] {
        let mut set = sample_set();
        set.device_id = id.to_string();
        assert_eq!(encode(&set), Err(ChangeFileError::BadDeviceId), "{id:?}");
    }
    let mut set = sample_set();
    set.device_id = "a".repeat(64);
    assert!(encode(&set).is_ok());
}

#[test]
fn error_messages_name_no_path_and_no_row() {
    let row_text = "synthetic-row-text";
    let all = [
        ChangeFileError::BadDeviceId,
        ChangeFileError::DuplicateSeq,
        ChangeFileError::Compress,
        ChangeFileError::NameMismatch,
        ChangeFileError::TooLarge,
        ChangeFileError::Malformed,
        ChangeFileError::FormatTooNew,
        ChangeFileError::SchemaTooNew,
        ChangeFileError::UnknownTable("some_table".to_string()),
        ChangeFileError::UnknownTable("../etc/x.json.gz".to_string()),
    ];
    for e in all {
        let text = e.to_string();
        for bad in ["/", "\\", ".json.gz", row_text] {
            assert!(
                !text.contains(bad),
                "an error message leaks a path or row text"
            );
        }
    }
}

/* ----------------------------- registry ----------------------------- */

#[test]
fn registry_is_the_d6_set_in_order() {
    let names: Vec<&str> = SYNC_TABLES.iter().map(|t| t.name).collect();
    assert_eq!(
        names,
        [
            "study_materials",
            "material_content_identities",
            "card_review_generations",
            "card_versions",
            "card_version_origins",
            "card_items",
            "card_item_origins",
            "card_review_events",
            "card_review_state",
            "practice_tests",
            "practice_test_versions",
            "practice_test_items",
            "practice_item_origins",
            "practice_attempts",
            "practice_responses",
            "ai_study_sets",
            "study_set_history",
            "material_reading_state",
            "material_bookmarks",
        ]
    );
    assert_eq!(table("study_materials").unwrap().primary_key, "id");
    assert!(table("app_metadata").is_none());
}

#[test]
fn every_sync_table_and_key_exists_in_the_migrated_schema() {
    let conn = migrated();
    for t in SYNC_TABLES {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", t.name))
            .unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(!cols.is_empty(), "{} is missing", t.name);
        assert!(cols.iter().any(|c| c == t.primary_key), "{} pk", t.name);
    }
}

#[test]
fn no_local_only_table_is_listed() {
    for t in SYNC_TABLES {
        assert!(!t.name.ends_with("_operations"), "{}", t.name);
        assert!(
            ![
                "app_metadata",
                "material_operation_claims",
                "practice_save_operations"
            ]
            .contains(&t.name),
            "{}",
            t.name
        );
    }
}

#[test]
fn every_registry_parent_comes_before_its_children() {
    let conn = migrated();
    for (i, t) in SYNC_TABLES.iter().enumerate() {
        let mut stmt = conn
            .prepare(&format!("PRAGMA foreign_key_list({})", t.name))
            .unwrap();
        let parents: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(2))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for parent in parents {
            if let Some(j) = SYNC_TABLES.iter().position(|p| p.name == parent) {
                assert!(j < i, "{parent} must come before {}", t.name);
            }
        }
    }
}

#[test]
fn every_version_table_has_is_active_and_created_at() {
    let conn = migrated();
    for t in SYNC_TABLES
        .iter()
        .filter(|t| t.rule == MergeRule::VersionActivation)
    {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", t.name))
            .unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for needed in ["is_active", "created_at"] {
            assert!(
                cols.iter().any(|c| c == needed),
                "{} lacks {needed}",
                t.name
            );
        }
    }
}

fn seed_material_and_bookmark(conn: &Connection) {
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at)
         VALUES ('mat-sync', 'Synthetic', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')",
        [],
    )
    .unwrap();
}

#[test]
fn read_row_json_maps_every_sqlite_type() {
    let conn = migrated();
    seed_material_and_bookmark(&conn);
    let materials = table("study_materials").unwrap();
    let got = read_row_json(&conn, materials, "mat-sync")
        .unwrap()
        .unwrap();
    assert_eq!(got["id"], json!("mat-sync"));
    assert_eq!(got["title"], json!("Synthetic"));
    assert!(got.values().any(Value::is_null));
    assert_eq!(read_row_json(&conn, materials, "nope").unwrap(), None);

    conn.execute_batch(
        "CREATE TABLE typed (id TEXT PRIMARY KEY, n INTEGER, r REAL, b BLOB, z TEXT);",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO typed VALUES ('t1', 7, 2.5, x'000102', NULL)",
        [],
    )
    .unwrap();
    let typed = crate::sync::tables::SyncTable {
        name: "typed",
        primary_key: "id",
        rule: crate::sync::tables::MergeRule::Union,
    };
    let got = read_row_json(&conn, &typed, "t1").unwrap().unwrap();
    assert_eq!(got["n"], json!(7));
    assert_eq!(got["r"], json!(2.5));
    assert_eq!(got["b"], json!({"$base64": "AAEC"}));
    assert_eq!(got["z"], Value::Null);
}

#[test]
fn read_row_json_keys_are_the_column_names() {
    let conn = migrated();
    seed_material_and_bookmark(&conn);
    let t = table("study_materials").unwrap();
    let got = read_row_json(&conn, t, "mat-sync").unwrap().unwrap();
    let mut stmt = conn.prepare("PRAGMA table_info(study_materials)").unwrap();
    let mut cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut keys: Vec<String> = got.keys().cloned().collect();
    cols.sort();
    keys.sort();
    assert_eq!(keys, cols);
}

/* ------------------------------ replay ------------------------------ */

fn ev(
    id: &str,
    item: &str,
    device: &str,
    generation: i64,
    rating: &str,
    at_ms: i64,
) -> ReviewEvent {
    ReviewEvent {
        id: id.to_string(),
        item_id: item.to_string(),
        device_id: device.to_string(),
        generation,
        rating: rating.to_string(),
        reviewed_at: format_iso_ms(at_ms),
        scheduler_version: crate::card_reviews::SCHEDULER_VERSION.to_string(),
    }
}

fn fold(events: &[ReviewEvent]) -> Option<CardSchedule> {
    let mut prior: Option<CardSchedule> = None;
    for e in events {
        prior = Some(schedule_card(prior.as_ref(), &e.rating, &e.reviewed_at).unwrap());
    }
    prior
}

#[test]
fn replay_matches_the_live_rating_path() {
    use crate::card_reviews::{
        card_version, decode_card_action, execute_card_review_transaction, CanonicalCard,
    };
    let conn = migrated();
    let cards = vec![CanonicalCard {
        visual_region_id: None,
        front: "Synthetic front".into(),
        back: "Synthetic back".into(),
        source_page: Some(1),
        origin: None,
    }];
    let material = "mat-live";
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?1, 'Synthetic', '2026-10-06T15:00:00.000Z', '2026-10-06T15:00:00.000Z')",
        [material],
    )
    .unwrap();
    let cards_json = serde_json::to_string(
        &json!([{"front": "Synthetic front", "back": "Synthetic back", "sourcePage": 1}]),
    )
    .unwrap();
    conn.execute(
        "INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
         VALUES (?1, 'Synthetic', '', '[]', ?2, '', 'import', '', '2026-10-06T15:00:00.000Z', '2026-10-06T15:00:00.000Z')",
        params![material, cards_json],
    )
    .unwrap();
    let version = card_version(material, &cards);
    let item_id = version.items[0].item_id.clone();

    let mut conn = conn;
    for (n, rating) in ["good", "good", "again"].iter().enumerate() {
        let revision: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(revision), 0) FROM card_review_state WHERE item_id = ?1",
                [&item_id],
                |r| r.get(0),
            )
            .unwrap();
        let value = json!({
            "action": "rate", "rating": rating,
            "operationId": format!("e1000000-0000-4000-8000-{:012x}", n + 1),
            "materialId": material,
            "versionContentHash": version.content_hash,
            "itemId": item_id,
            "expectedGeneration": 0,
            "expectedRevision": revision,
        });
        let action = decode_card_action(&value).unwrap();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        execute_card_review_transaction(&tx, &action, &value).unwrap();
        tx.commit().unwrap();
    }

    let events_table = table("card_review_events").unwrap();
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM card_review_events WHERE item_id = ?1")
        .unwrap()
        .query_map([&item_id], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(ids.len(), 3);
    let mut events = Vec::new();
    let mut last_next_state = String::new();
    let mut latest = String::new();
    for id in &ids {
        let r = read_row_json(&conn, events_table, id).unwrap().unwrap();
        let e = event_from_row(&r, "device-a").unwrap();
        if e.reviewed_at >= latest {
            latest = e.reviewed_at.clone();
            last_next_state = r["next_state_json"].as_str().unwrap().to_string();
        }
        events.push(e);
    }
    let replayed = replay_item(&events, 0).unwrap().unwrap();
    let stored: (i64, i64, i64, String, String) = conn
        .query_row(
            "SELECT step, reps, lapses, last_reviewed_at, due_at FROM card_review_state WHERE item_id = ?1",
            [&item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(
        stored,
        (
            replayed.step,
            replayed.reps,
            replayed.lapses,
            replayed.last_reviewed_at.clone(),
            replayed.due_at.clone()
        )
    );
    assert_eq!(
        crate::practice_sessions::canonical_json(&replayed.to_json()),
        last_next_state
    );
    assert_eq!(replayed.reps, 3);
}

#[test]
fn older_generation_never_replays() {
    let t = 1_000_000_000_000;
    let events = vec![
        ev("a", "i", "d", 0, "easy", t),
        ev("b", "i", "d", 0, "easy", t + 1_000),
        ev("c", "i", "d", 1, "good", t + 2_000),
    ];
    assert_eq!(replay_item(&events, 0), Ok(fold(&events[2..])));
    assert_eq!(replay_item(&events, 0).unwrap().unwrap().reps, 1);
}

#[test]
fn identical_duplicates_count_once() {
    let t = 1_000_000_000_000;
    let a = ev("a", "i", "d", 0, "good", t);
    let b = ev("b", "i", "d", 0, "good", t + 1_000);
    let once = replay_item(&[a.clone(), b.clone()], 0);
    assert_eq!(replay_item(&[a.clone(), a.clone(), b.clone(), a], 0), once);
    assert_eq!(once.unwrap().unwrap().reps, 2);
}

#[test]
fn conflicting_duplicate_ids_are_refused() {
    let t = 1_000_000_000_000;
    let a = ev("a", "i", "d", 0, "good", t);
    let mut a2 = a.clone();
    a2.rating = "again".into();
    assert_eq!(
        replay_item(&[a.clone(), a2.clone()], 0),
        Err(ReplayError::ConflictingDuplicate)
    );
    assert_eq!(
        replay_item(&[a2, a], 0),
        Err(ReplayError::ConflictingDuplicate)
    );
}

#[test]
fn unsupported_scheduler_version_is_refused() {
    let mut e = ev("a", "i", "d", 0, "good", 1_000_000_000_000);
    e.scheduler_version = "simple-v2".into();
    assert_eq!(
        replay_item(&[e], 0),
        Err(ReplayError::Scheduler(
            crate::card_reviews::SchedulerRefusal::UnsupportedSchedulerVersion
        ))
    );
}

#[test]
fn events_before_the_local_barrier_never_replay() {
    let t = 1_000_000_000_000;
    let g0 = ev("a", "i", "d", 0, "good", t);
    let g1 = ev("b", "i", "d", 1, "good", t + 1_000);
    assert_eq!(replay_item(std::slice::from_ref(&g0), 1), Ok(None));
    assert_eq!(replay_item(&[g0, g1.clone()], 1), Ok(fold(&[g1])));
}

#[test]
fn a_peer_reset_raises_the_barrier() {
    let t = 1_000_000_000_000;
    let g0 = ev("a", "i", "d", 0, "good", t);
    let g1 = ev("b", "i", "e", 1, "easy", t + 1_000);
    assert_eq!(replay_item(&[g0, g1.clone()], 0), Ok(fold(&[g1])));
    let neg = ev("c", "i", "d", -1, "good", t);
    assert_eq!(replay_item(&[neg], 0), Err(ReplayError::BadGeneration));
}

#[test]
fn mixed_items_are_refused() {
    let t = 1_000_000_000_000;
    let events = vec![
        ev("a", "i1", "d", 0, "good", t),
        ev("b", "i2", "d", 0, "good", t),
    ];
    assert_eq!(replay_item(&events, 0), Err(ReplayError::MixedItems));
    assert_eq!(replay_item(&[], 0), Ok(None));
    let mut bad = ev("a", "i1", "d", 0, "good", t);
    bad.reviewed_at = "soon".into();
    assert_eq!(replay_item(&[bad], 0), Err(ReplayError::BadTime));
}

#[test]
fn event_from_row_tolerates_extra_columns() {
    let r = row(&[
        ("id", json!("e")),
        ("item_id", json!("i")),
        ("generation", json!(2)),
        ("rating", json!("good")),
        ("reviewed_at", json!(format_iso_ms(5))),
        ("scheduler_version", json!("simple-v1")),
        ("future_column", json!([1, 2])),
    ])
    .unwrap();
    let e = event_from_row(&r, "dev").unwrap();
    assert_eq!((e.generation, e.device_id.as_str()), (2, "dev"));
    let mut missing = r.clone();
    missing.remove("rating");
    assert_eq!(event_from_row(&missing, "dev"), None);
    assert_eq!(order_key(&e), (5, "dev", "e"));
}

mod replay_properties {
    use super::*;
    use proptest::prelude::*;

    const MAX_MS: i64 = 7_258_118_399_999;

    fn rating() -> impl Strategy<Value = &'static str> {
        prop::sample::select(crate::card_reviews::RATINGS.to_vec())
    }

    fn device() -> impl Strategy<Value = &'static str> {
        prop::sample::select(vec!["dev-a", "dev-b"])
    }

    /// Strictly increasing instants, so the sorted order is the index order.
    fn sequential() -> impl Strategy<Value = Vec<ReviewEvent>> {
        (
            0..=MAX_MS / 2,
            prop::collection::vec((rating(), device(), 1..=50_000_000_000i64), 1..40),
        )
            .prop_map(|(start, steps)| {
                let mut at = start;
                steps
                    .into_iter()
                    .enumerate()
                    .map(|(i, (r, d, gap))| {
                        at += gap;
                        ev(&format!("ev-{i:03}"), "item", d, 0, r, at)
                    })
                    .collect()
            })
    }

    proptest! {
        #[test]
        fn replay_of_any_interleaving_equals_sequential(
            (originals, shuffled) in sequential().prop_flat_map(|v| (Just(v.clone()), Just(v).prop_shuffle()))
        ) {
            let truth = fold(&originals);
            prop_assert!(truth.is_some());
            prop_assert_eq!(replay_item(&shuffled, 0), Ok(truth));
        }

        #[test]
        fn replay_is_order_independent_with_conflicts_refused(
            (events, pos) in sequential().prop_flat_map(|v| {
                let n = v.len() + 1;
                (Just(v).prop_shuffle(), 0..n)
            })
        ) {
            let mut conflicting = events[0].clone();
            conflicting.rating = if conflicting.rating == "again" { "good" } else { "again" }.into();
            let mut with = events.clone();
            with.insert(pos, conflicting);
            prop_assert_eq!(replay_item(&with, 0), Err(ReplayError::ConflictingDuplicate));
        }

        #[test]
        fn replay_is_idempotent(events in sequential()) {
            let doubled: Vec<ReviewEvent> = events.iter().chain(events.iter()).cloned().collect();
            let once = replay_item(&events, 0);
            prop_assert!(matches!(once, Ok(Some(_))));
            prop_assert_eq!(replay_item(&doubled, 0), once);
        }

        #[test]
        fn ties_break_by_device_then_id(
            at in 0..=MAX_MS,
            r1 in rating(), r2 in rating(),
            same_device in any::<bool>(),
        ) {
            let d2 = if same_device { "dev-a" } else { "dev-b" };
            let x = ev("ev-a", "item", "dev-a", 0, r1, at);
            let y = ev("ev-b", "item", d2, 0, r2, at);
            // x sorts first: lower device id, or the same device and lower id.
            prop_assert!(order_key(&x) < order_key(&y));
            let expected = fold(&[x.clone(), y.clone()]);
            prop_assert_eq!(replay_item(&[x.clone(), y.clone()], 0), Ok(expected.clone()));
            prop_assert_eq!(replay_item(&[y, x], 0), Ok(expected));
        }

        #[test]
        fn replay_never_refuses_a_sorted_union(
            raw in prop::collection::vec((rating(), device(), 0..=MAX_MS, 0..3i64), 1..40)
        ) {
            let events: Vec<ReviewEvent> = raw
                .into_iter()
                .enumerate()
                .map(|(i, (r, d, at, g))| ev(&format!("ev-{i:03}"), "item", d, g, r, at))
                .collect();
            let got = replay_item(&events, 0);
            prop_assert!(matches!(got, Ok(Some(_))), "{:?}", got);
        }
    }
}

/// One minimal plain-SQL row per synced table, parents first: (table, id, insert, update).
/// `T` is the timestamp; ids end in a digit so a suffix can make a second copy.
const ROWS: &[(&str, &str, &str, &str)] = &[
    ("study_materials", "m1", "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','Mat','T','T')", "UPDATE study_materials SET title = 'Mat2'"),
    ("material_content_identities", "m1", "INSERT INTO material_content_identities (material_id,content_sha256,total_pages,verified_at) VALUES ('m1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',3,'T')", "UPDATE material_content_identities SET total_pages = 4"),
    ("card_review_generations", "m1", "INSERT INTO card_review_generations (source_material_id,generation) VALUES ('m1',1)", "UPDATE card_review_generations SET generation = 2"),
    ("card_versions", "v1", "INSERT INTO card_versions (id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES ('v1','m1','h',1,'import','T',1)", "UPDATE card_versions SET card_count = 2"),
    ("card_version_origins", "v1", "INSERT INTO card_version_origins (version_id,origin) VALUES ('v1','manual')", "UPDATE card_version_origins SET origin = 'mixed'"),
    ("card_items", "i1", "INSERT INTO card_items (id,version_id,ordinal,front,back) VALUES ('i1','v1',0,'f','b')", "UPDATE card_items SET back = 'b2'"),
    ("card_item_origins", "i1", "INSERT INTO card_item_origins (item_id,origin) VALUES ('i1','user')", "UPDATE card_item_origins SET origin = 'instructor'"),
    ("card_review_events", "e1", "INSERT INTO card_review_events (id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES ('e1','i1',0,'good','T','s','{}','{}')", "UPDATE card_review_events SET rating = 'easy'"),
    ("card_review_state", "i1", "INSERT INTO card_review_state (item_id,source_material_id,scheduler_version,step,revision) VALUES ('i1','m1','s',-1,1)", "UPDATE card_review_state SET revision = 2"),
    ("practice_tests", "m1", "INSERT INTO practice_tests (source_material_id,generated_at,updated_at) VALUES ('m1','T','T')", "UPDATE practice_tests SET title = 't'"),
    ("practice_test_versions", "pv1", "INSERT INTO practice_test_versions (id,source_material_id,history_key,source_material_title,content_hash,created_at) VALUES ('pv1','m1','hk','Mat','h','T')", "UPDATE practice_test_versions SET title = 't'"),
    ("practice_test_items", "pi1", "INSERT INTO practice_test_items (id,version_id,ordinal,question_text,options_json,correct_index) VALUES ('pi1','pv1',0,'q','[\"a\",\"b\"]',0)", "UPDATE practice_test_items SET explanation = 'x'"),
    ("practice_item_origins", "pi1", "INSERT INTO practice_item_origins (item_id,origin) VALUES ('pi1','user')", "UPDATE practice_item_origins SET origin = 'instructor'"),
    ("practice_attempts", "a1", "INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,status,total_questions,answered_count,correct_count) VALUES ('a1','pv1','m1','Mat','T','in_progress',1,1,1)", "UPDATE practice_attempts SET answered_count = 1"),
    ("practice_responses", "r1", "INSERT INTO practice_responses (id,attempt_id,item_id,selected_index,is_correct,answered_at) VALUES ('r1','a1','pi1',0,1,'T')", "UPDATE practice_responses SET selected_index = 1"),
    ("ai_study_sets", "m1", "INSERT INTO ai_study_sets (source_material_id,generated_at,updated_at) VALUES ('m1','T','T')", "UPDATE ai_study_sets SET title = 't'"),
    ("study_set_history", "h1", "INSERT INTO study_set_history (id,material_id,kind,reason,previous_json,provider,created_at) VALUES ('h1','m1','study_set','edit','{}','gemini','T')", "UPDATE study_set_history SET provider = 'import'"),
    ("material_reading_state", "m1", "INSERT INTO material_reading_state (material_id,last_requested_page,updated_at) VALUES ('m1',1,'T')", "UPDATE material_reading_state SET last_requested_page = 2"),
    ("material_bookmarks", "b1", "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('b1','m1',1,'t','T','T')", "UPDATE material_bookmarks SET title = 'u'"),
];

const OLD: &str = "2026-10-01T10:00:00.000Z";
const NEW: &str = "2026-11-02T10:00:00.000Z";
const BASELINE: &str = "2026-10-15T10:00:00.000Z";

/// Rewrites the ids of `ROWS` SQL for a second copy with `suffix`, at time `ts`.
fn graph_sql(sql: &str, suffix: &str, ts: &str) -> String {
    let mut out = sql.replace("'T'", &format!("'{ts}'"));
    for (_, id, _, _) in ROWS {
        out = out.replace(&format!("'{id}'"), &format!("'{id}{suffix}'"));
    }
    out
}

fn insert_graph(conn: &Connection, suffix: &str, ts: &str) {
    for (name, _, insert, _) in ROWS {
        conn.execute(&graph_sql(insert, suffix, ts), [])
            .unwrap_or_else(|e| panic!("insert into {name}: {e}"));
    }
}

/// Writes without the triggers logging, as data that predates the ledger.
fn insert_graph_unlogged(conn: &Connection, suffix: &str, ts: &str) {
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', '1')",
        [],
    )
    .unwrap();
    insert_graph(conn, suffix, ts);
    conn.execute("DELETE FROM app_metadata WHERE key = 'sync_applying'", [])
        .unwrap();
}

fn unlogged(conn: &Connection, sql: &str) {
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', '1')",
        [],
    )
    .unwrap();
    conn.execute(sql, []).unwrap();
    conn.execute("DELETE FROM app_metadata WHERE key = 'sync_applying'", [])
        .unwrap();
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "hfd-sync-test-{label}-{}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

mod ledger {
    use super::*;

    fn ops(conn: &Connection, table: &str, id: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT op FROM local_changes WHERE table_name = ?1 AND row_id = ?2 ORDER BY seq",
            )
            .unwrap();
        stmt.query_map([table, id], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn deleted(conn: &Connection, table: &str, id: &str) -> Option<i64> {
        conn.query_row(
            "SELECT deleted FROM sync_row_meta WHERE table_name = ?1 AND row_id = ?2",
            [table, id],
            |r| r.get(0),
        )
        .ok()
    }

    #[test]
    fn rows_cover_the_registry_in_order() {
        let names: Vec<&str> = ROWS.iter().map(|r| r.0).collect();
        let registry: Vec<&str> = SYNC_TABLES.iter().map(|t| t.name).collect();
        assert_eq!(names, registry);
    }

    #[test]
    fn every_registry_table_has_insert_update_delete_triggers() {
        let conn = migrated();
        for t in SYNC_TABLES {
            for op in ["insert", "update", "delete"] {
                let n = count(
                    &conn,
                    &format!(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_sync_{}_{op}' AND tbl_name = '{}'",
                        t.name, t.name
                    ),
                );
                assert_eq!(n, 1, "{} {op}", t.name);
            }
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_sync_%'"), 57);
    }

    #[test]
    fn no_sync_trigger_targets_an_unlisted_table() {
        let conn = migrated();
        let mut stmt = conn
            .prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_sync_%'")
            .unwrap();
        let targets: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for target in targets {
            assert!(table(&target).is_some(), "{target}");
        }
    }

    #[test]
    fn ledger_records_insert_update_delete_for_every_registry_table() {
        let conn = migrated();
        insert_graph(&conn, "", NOW);
        for (name, id, _, update) in ROWS {
            conn.execute(update, [])
                .unwrap_or_else(|e| panic!("update {name}: {e}"));
            assert_eq!(ops(&conn, name, id), ["insert", "update"], "{name}");
            assert_eq!(deleted(&conn, name, id), Some(0), "{name}");
        }
        for (name, id, _, _) in ROWS.iter().rev() {
            let pk = table(name).unwrap().primary_key;
            conn.execute(&format!("DELETE FROM {name} WHERE {pk} = '{id}'"), [])
                .unwrap_or_else(|e| panic!("delete {name}: {e}"));
            assert_eq!(
                ops(&conn, name, id),
                ["insert", "update", "delete"],
                "{name}"
            );
            assert_eq!(deleted(&conn, name, id), Some(1), "{name}");
        }
        insert_graph(&conn, "", NOW);
        for (name, id, _, _) in ROWS {
            assert_eq!(deleted(&conn, name, id), Some(0), "{name} re-insert");
        }
    }

    #[test]
    fn the_guard_row_silences_every_trigger() {
        let conn = migrated();
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', '1')",
            [],
        )
        .unwrap();
        insert_graph(&conn, "", NOW);
        for (_, _, _, update) in ROWS {
            conn.execute(update, []).unwrap();
        }
        conn.execute("DELETE FROM study_materials", []).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_changes"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sync_row_meta"), 0);
        conn.execute("DELETE FROM app_metadata WHERE key = 'sync_applying'", [])
            .unwrap();
        insert_graph(&conn, "", NOW);
        assert!(count(&conn, "SELECT COUNT(*) FROM local_changes") > 0);
    }

    #[test]
    fn device_id_comes_from_app_metadata() {
        let conn = migrated();
        conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','a','T','T')", []).unwrap();
        let first: Option<String> = conn
            .query_row(
                "SELECT device_id FROM sync_row_meta WHERE row_id = 'm1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(first, None);
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', 'dev-1')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m2','b','T','T')", []).unwrap();
        let second: Option<String> = conn
            .query_row(
                "SELECT device_id FROM sync_row_meta WHERE row_id = 'm2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(second.as_deref(), Some("dev-1"));
    }

    #[test]
    fn upgrading_a_populated_schema_32_database_records_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let all = crate::migrations();
        for m in all.iter().filter(|m| m.version <= 32) {
            conn.execute_batch(m.sql).unwrap();
        }
        insert_graph(&conn, "", NOW);
        for m in all.iter().filter(|m| m.version == 33) {
            conn.execute_batch(m.sql).unwrap();
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_changes"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sync_row_meta"), 0);
        conn.execute("UPDATE study_materials SET title = 'later'", [])
            .unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_changes"), 1);
    }

    #[test]
    fn a_backup_of_schema_33_passes_restore_verification_with_all_triggers() {
        let conn = migrated();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in crate::migrations() {
            conn.execute(
                "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
                [m.version],
            )
            .unwrap();
        }
        crate::backup::verify_application_connection(&conn).unwrap();
        let dir = TempDir::new("backup");
        let path = dir.0.join("copy.db");
        conn.execute("VACUUM INTO ?1", [path.to_str().unwrap()])
            .unwrap();
        crate::backup::verify_application_database(&path).unwrap();
        let copy = Connection::open(&path).unwrap();
        assert_eq!(count(&copy, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_sync_%'"), 57);
        for table in ["local_changes", "sync_row_meta", "sync_applied"] {
            assert_eq!(
                count(
                    &copy,
                    &format!("SELECT COUNT(*) FROM sqlite_master WHERE name = '{table}'")
                ),
                1
            );
        }
    }
}

mod export {
    use super::*;
    use crate::sync::export::{export_changes_in, exported_through_seq, set_exported_through_seq};

    const DEV: &str = "11111111-2222-4333-8444-555555555555";

    fn exp(conn: &mut Connection, since: i64) -> Option<crate::sync::export::ExportedChanges> {
        export_changes_in(conn, DEV, since, "0.0.0-test", NOW).unwrap()
    }

    fn decoded(file: &crate::sync::changeset::EncodedChangeFile) -> ChangeSet {
        decode(&file.bytes, &file.file_name, SCHEMA, NOW)
            .unwrap()
            .set
    }

    /// seq 1 material insert, 2 b1 insert, 3 b1 update, 4 b2 insert, 5 b2 delete.
    fn ledger() -> Connection {
        let conn = migrated();
        conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','a','T','T')", []).unwrap();
        for id in ["b1", "b2"] {
            conn.execute(&format!("INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('{id}','m1',1,'t','T','T')"), []).unwrap();
            if id == "b1" {
                conn.execute(
                    "UPDATE material_bookmarks SET title = 'u' WHERE id = 'b1'",
                    [],
                )
                .unwrap();
            }
        }
        conn.execute("DELETE FROM material_bookmarks WHERE id = 'b2'", [])
            .unwrap();
        conn
    }

    #[test]
    fn export_coalesces_to_the_last_op_per_row() {
        let mut conn = ledger();
        let out = exp(&mut conn, 0).unwrap();
        assert_eq!((out.from_seq, out.to_seq, out.change_count), (1, 5, 3));
        let set = decoded(&out.file);
        let got: Vec<(String, Op)> = set
            .changes
            .iter()
            .map(|c| (c.row_id.clone(), c.op))
            .collect();
        assert_eq!(
            got,
            [
                ("m1".to_string(), Op::Insert),
                ("b1".to_string(), Op::Update),
                ("b2".to_string(), Op::Delete)
            ]
        );
        assert_eq!(set.schema_version, SCHEMA);
    }

    #[test]
    fn export_uses_meta_changed_at_and_the_last_seq() {
        let mut conn = ledger();
        conn.execute(
            "UPDATE sync_row_meta SET changed_at = '2026-11-03T01:02:03.004Z' WHERE row_id = 'b1'",
            [],
        )
        .unwrap();
        let set = decoded(&exp(&mut conn, 0).unwrap().file);
        let b1 = set.changes.iter().find(|c| c.row_id == "b1").unwrap();
        assert_eq!(b1.seq, 3);
        assert_eq!(b1.changed_at, "2026-11-03T01:02:03.004Z");
        assert_eq!(b1.row.as_ref().unwrap()["title"], json!("u"));
    }

    #[test]
    fn export_of_a_delete_carries_no_row() {
        let mut conn = ledger();
        let set = decoded(&exp(&mut conn, 0).unwrap().file);
        let b2 = set.changes.iter().find(|c| c.row_id == "b2").unwrap();
        assert_eq!(b2.op, Op::Delete);
        assert!(b2.row.is_none());
    }

    #[test]
    fn export_returns_none_when_nothing_is_new() {
        let mut conn = migrated();
        assert!(exp(&mut conn, 0).is_none());
        let mut conn = ledger();
        assert!(exp(&mut conn, 5).is_none());
        assert!(exp(&mut conn, 9).is_none());
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_changes"), 5);
    }

    #[test]
    fn re_export_from_an_earlier_watermark_is_byte_identical() {
        let mut conn = ledger();
        let first = exp(&mut conn, 0).unwrap();
        let again = exp(&mut conn, 0).unwrap();
        assert_eq!(first.file.bytes, again.file.bytes);
        assert_eq!(first.file.file_name, again.file.file_name);
        let partial = exp(&mut conn, 2).unwrap();
        assert_ne!(partial.file.bytes, first.file.bytes);
        let after = exp(&mut conn, 0).unwrap();
        assert_eq!(first.file.bytes, after.file.bytes);
    }

    #[test]
    fn a_write_during_export_lands_in_the_next_file() {
        let dir = TempDir::new("export");
        let path = dir.0.join("db.sqlite");
        let mut a = Connection::open(&path).unwrap();
        for m in crate::migrations() {
            a.execute_batch(m.sql).unwrap();
        }
        a.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','a','T','T')", []).unwrap();
        let first = export_changes_in(&mut a, DEV, 0, "0.0.0-test", NOW)
            .unwrap()
            .unwrap();
        let first_bytes = first.file.bytes.clone();
        let b = Connection::open(&path).unwrap();
        b.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m2','b','T','T')", []).unwrap();
        let second = export_changes_in(&mut a, DEV, first.to_seq, "0.0.0-test", NOW)
            .unwrap()
            .unwrap();
        let set = decoded(&second.file);
        assert_eq!(set.changes.len(), 1);
        assert_eq!(set.changes[0].row_id, "m2");
        assert_eq!(set.from_seq, first.to_seq + 1);
        assert_eq!(first.file.bytes, first_bytes);
        assert_eq!(decoded(&first.file).changes.len(), 1);
    }

    #[test]
    fn exported_through_seq_round_trips() {
        let conn = migrated();
        assert_eq!(exported_through_seq(&conn).unwrap(), 0);
        set_exported_through_seq(&conn, 7).unwrap();
        set_exported_through_seq(&conn, 9).unwrap();
        assert_eq!(exported_through_seq(&conn).unwrap(), 9);
    }
}

mod bootstrap {
    use super::*;
    use crate::sync::bootstrap::bootstrap_in;
    use std::collections::HashSet;

    fn root_with_baseline(baseline: Option<&str>) -> TempDir {
        let dir = TempDir::new("boot");
        if let Some(b) = baseline {
            std::fs::write(
                dir.0.join("phone-work.json"),
                format!("{{\"baselineAt\":\"{b}\"}}"),
            )
            .unwrap();
        }
        dir
    }

    fn ledger_ids(conn: &Connection) -> HashSet<(String, String)> {
        let mut stmt = conn
            .prepare("SELECT table_name, row_id FROM sync_row_meta")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn has(set: &HashSet<(String, String)>, table: &str, id: &str) -> bool {
        set.contains(&(table.to_string(), id.to_string()))
    }

    fn id_of(table: &str, suffix: &str) -> String {
        format!("{}{suffix}", ROWS.iter().find(|r| r.0 == table).unwrap().1)
    }

    fn two_generations() -> Connection {
        let conn = migrated();
        insert_graph_unlogged(&conn, "o", OLD);
        insert_graph_unlogged(&conn, "n", NEW);
        conn
    }

    #[test]
    fn bootstrap_seeds_only_rows_newer_than_the_baseline() {
        let mut conn = two_generations();
        let dir = root_with_baseline(Some(BASELINE));
        let out = bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        assert!(!out.skipped);
        let ids = ledger_ids(&conn);
        assert_eq!(out.seeded, ids.len());
        for (table, _) in crate::phone_work::KINDS {
            assert!(has(&ids, table, &id_of(table, "n")), "{table} new");
            assert!(!has(&ids, table, &id_of(table, "o")), "{table} old");
        }
        assert!(has(&ids, "card_review_state", "i1n"));
        assert!(!has(&ids, "card_review_state", "i1o"));
        let stamp: String = conn
            .query_row("SELECT changed_at FROM sync_row_meta WHERE table_name = 'material_bookmarks' AND row_id = 'b1n'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stamp, NEW);
    }

    #[test]
    fn bootstrap_without_a_baseline_seeds_every_row() {
        let mut conn = two_generations();
        let dir = root_with_baseline(None);
        bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        let ids = ledger_ids(&conn);
        for (name, id, _, _) in ROWS {
            for suffix in ["o", "n"] {
                assert!(has(&ids, name, &format!("{id}{suffix}")), "{name}{suffix}");
            }
        }
    }

    #[test]
    fn bootstrap_runs_once() {
        let mut conn = two_generations();
        let dir = root_with_baseline(Some(BASELINE));
        let first = bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        assert!(first.seeded > 0);
        unlogged(&conn, &graph_sql(ROWS[0].2, "z", NEW));
        let second = bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        assert!(second.skipped);
        assert_eq!(second.seeded, 0);
        assert!(!has(&ledger_ids(&conn), "study_materials", "m1z"));
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_bootstrapped'"
            ),
            1
        );
    }

    #[test]
    fn bootstrap_skips_rows_already_in_the_ledger() {
        let mut conn = migrated();
        insert_graph(&conn, "n", NEW);
        let before = count(&conn, "SELECT COUNT(*) FROM local_changes");
        let dir = root_with_baseline(None);
        let out = bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        assert_eq!(out.seeded, 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_changes"), before);
    }

    #[test]
    fn bootstrap_is_a_no_op_off_the_phone() {
        let mut conn = two_generations();
        let dir = root_with_baseline(None);
        let out = bootstrap_in(&dir.0, &mut conn, false, NOW).unwrap();
        assert!(out.skipped);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_changes"), 0);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_bootstrapped'"
            ),
            0
        );
    }

    #[test]
    fn an_attempt_started_before_the_baseline_but_completed_after_is_seeded() {
        let mut conn = two_generations();
        unlogged(&conn, &format!("UPDATE practice_attempts SET status = 'completed', completed_at = '{NEW}' WHERE id = 'a1o'"));
        let dir = root_with_baseline(Some(BASELINE));
        bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        let ids = ledger_ids(&conn);
        assert!(has(&ids, "practice_attempts", "a1o"));
        assert!(!has(&ids, "practice_responses", "r1o"));
    }

    #[test]
    fn a_response_answered_after_the_baseline_is_seeded_by_its_own_time() {
        let mut conn = two_generations();
        unlogged(
            &conn,
            &format!("UPDATE practice_responses SET answered_at = '{NEW}' WHERE id = 'r1o'"),
        );
        let dir = root_with_baseline(Some(BASELINE));
        bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        let ids = ledger_ids(&conn);
        assert!(has(&ids, "practice_responses", "r1o"));
        assert!(!has(&ids, "practice_attempts", "a1o"));
    }

    #[test]
    fn foreign_key_parents_and_children_of_new_versions_are_seeded() {
        let mut conn = two_generations();
        let dir = root_with_baseline(Some(BASELINE));
        bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        let ids = ledger_ids(&conn);
        for (table, id) in [
            ("card_versions", "v1n"),
            ("card_version_origins", "v1n"),
            ("card_items", "i1n"),
            ("card_item_origins", "i1n"),
            ("practice_test_versions", "pv1n"),
            ("practice_test_items", "pi1n"),
            ("practice_item_origins", "pi1n"),
        ] {
            assert!(has(&ids, table, id), "{table}");
        }
        assert!(!has(&ids, "card_items", "i1o"));
        assert!(!has(&ids, "practice_test_items", "pi1o"));
    }

    #[test]
    fn a_reset_counter_above_zero_is_always_seeded_at_now() {
        let mut conn = two_generations();
        unlogged(
            &conn,
            "UPDATE card_review_generations SET generation = 0 WHERE source_material_id = 'm1n'",
        );
        let dir = root_with_baseline(Some(BASELINE));
        bootstrap_in(&dir.0, &mut conn, true, NOW).unwrap();
        let ids = ledger_ids(&conn);
        assert!(has(&ids, "card_review_generations", "m1o"));
        assert!(!has(&ids, "card_review_generations", "m1n"));
        let stamp: String = conn
            .query_row(
                "SELECT changed_at FROM sync_row_meta WHERE table_name = 'card_review_generations'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamp, NOW);
    }
}

/* ------------------------------- apply ------------------------------ */

mod apply {
    use super::*;
    use crate::sync::apply::{apply_change_file, ApplyError, ApplyOutcome};
    use crate::sync::changeset::EncodedChangeFile;
    use crate::sync::export::export_changes_in;
    use rusqlite::types::Value as Sql;
    use rusqlite::OptionalExtension;
    use std::sync::{Arc, Mutex};

    pub(super) const MAC: &str = "aaaa-mac";
    pub(super) const PHONE: &str = "bbbb-phone";
    const T1: &str = "2026-11-01T10:00:00.000Z";
    const T2: &str = "2026-11-02T10:00:00.000Z";
    const T3: &str = "2026-11-03T10:00:00.000Z";

    pub(super) fn device(id: &str) -> Connection {
        let conn = migrated();
        set_device(&conn, id);
        conn
    }

    fn set_device(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
            [id],
        )
        .unwrap();
    }

    pub(super) fn ship(conn: &mut Connection, dev: &str, since: i64) -> EncodedChangeFile {
        export_changes_in(conn, dev, since, "0.0.0-test", NOW)
            .unwrap()
            .unwrap()
            .file
    }

    pub(super) fn take(conn: &mut Connection, file: &EncodedChangeFile) -> ApplyOutcome {
        try_take(conn, file).unwrap()
    }

    fn try_take(
        conn: &mut Connection,
        file: &EncodedChangeFile,
    ) -> Result<ApplyOutcome, ApplyError> {
        let parsed = decode(&file.bytes, &file.file_name, SCHEMA, NOW).unwrap();
        apply_change_file(conn, &file.file_name, &parsed, NOW)
    }

    fn ch(seq: i64, table: &str, id: &str, op: Op, at: &str, row: Option<Value>) -> Change {
        Change {
            seq,
            table: table.to_string(),
            row_id: id.to_string(),
            op,
            changed_at: at.to_string(),
            row: row.map(|v| v.as_object().unwrap().clone()),
        }
    }

    /// A change file from a literal set (seq range = the changes' seqs).
    fn file_of(dev: &str, created_at: &str, changes: Vec<Change>) -> EncodedChangeFile {
        let from = changes.iter().map(|c| c.seq).min().unwrap();
        let to = changes.iter().map(|c| c.seq).max().unwrap();
        encode(&ChangeSet {
            format_version: CHANGE_FORMAT_VERSION,
            schema_version: SCHEMA,
            device_id: dev.to_string(),
            app_version: "0.0.0-test".to_string(),
            created_at: created_at.to_string(),
            from_seq: from,
            to_seq: to,
            changes,
        })
        .unwrap()
    }

    fn material_row(id: &str, title: &str) -> Value {
        json!({"id": id, "title": title, "created_at": T1, "updated_at": T1})
    }

    fn bookmark_row(id: &str, title: &str) -> Value {
        json!({"id": id, "material_id": "m1", "page_index": 1, "title": title,
               "created_at": T1, "updated_at": T1})
    }

    fn material_file(dev: &str) -> EncodedChangeFile {
        file_of(
            dev,
            T1,
            vec![ch(
                1,
                "study_materials",
                "m1",
                Op::Insert,
                T1,
                Some(material_row("m1", "Mat")),
            )],
        )
    }

    fn bookmark_file(dev: &str, seq: i64, op: Op, at: &str, title: &str) -> EncodedChangeFile {
        let row = (op != Op::Delete).then(|| bookmark_row("b1", title));
        file_of(
            dev,
            at,
            vec![ch(seq, "material_bookmarks", "b1", op, at, row)],
        )
    }

    fn title(conn: &Connection, sql: &str) -> Option<String> {
        conn.query_row(sql, [], |r| r.get(0)).optional().unwrap()
    }

    fn meta_pair(conn: &Connection, table: &str, id: &str) -> (String, String, i64) {
        conn.query_row(
            "SELECT changed_at, device_id, deleted FROM sync_row_meta WHERE table_name = ?1 AND row_id = ?2",
            [table, id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap()
    }

    fn guard_rows(conn: &Connection) -> i64 {
        count(
            conn,
            "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_applying'",
        )
    }

    /// Every registry table plus the ledger, receipts and app_metadata.
    fn dump(conn: &Connection) -> Vec<String> {
        let mut names: Vec<&str> = SYNC_TABLES.iter().map(|t| t.name).collect();
        names.extend([
            "local_changes",
            "sync_row_meta",
            "sync_applied",
            "app_metadata",
        ]);
        let mut out = Vec::new();
        for name in names {
            let mut stmt = conn
                .prepare(&format!("SELECT * FROM {name} ORDER BY 1, 2"))
                .unwrap();
            let n = stmt.column_count();
            let rows: Vec<String> = stmt
                .query_map([], |r| {
                    let mut cells = Vec::new();
                    for i in 0..n {
                        cells.push(format!("{:?}", r.get::<_, Sql>(i)?));
                    }
                    Ok(format!("{name}: {}", cells.join("|")))
                })
                .unwrap()
                .map(Result::unwrap)
                .collect();
            out.extend(rows);
        }
        out
    }

    /// A peer whose ledger holds one row of every registry table (events
    /// at generation 1, real scheduler version) plus its change file.
    pub(super) fn every_rule_peer(dev: &str) -> (Connection, EncodedChangeFile) {
        let mut peer = device(dev);
        insert_graph(&peer, "", T1);
        peer.execute(
            "UPDATE card_review_events SET generation = 1, scheduler_version = ?1",
            [crate::card_reviews::SCHEDULER_VERSION],
        )
        .unwrap();
        let file = ship(&mut peer, dev, 0);
        (peer, file)
    }

    /* --------------------------- card helpers --------------------------- */

    pub(super) struct Card {
        pub(super) material: String,
        pub(super) hash: String,
        pub(super) item: String,
    }

    pub(super) fn card(conn: &Connection, material: &str) -> Card {
        use crate::card_reviews::{card_version, CanonicalCard};
        conn.execute(
            "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?1, 'Synthetic', ?2, ?2)",
            params![material, T1],
        )
        .unwrap();
        let cards_json =
            json!([{"front": "Synthetic front", "back": "Synthetic back", "sourcePage": 1}])
                .to_string();
        conn.execute(
            "INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
             VALUES (?1, 'Synthetic', '', '[]', ?2, '', 'import', '', ?3, ?3)",
            params![material, cards_json, T1],
        )
        .unwrap();
        let version = card_version(
            material,
            &[CanonicalCard {
                visual_region_id: None,
                front: "Synthetic front".into(),
                back: "Synthetic back".into(),
                source_page: Some(1),
                origin: None,
            }],
        );
        Card {
            material: material.to_string(),
            hash: version.content_hash.clone(),
            item: version.items[0].item_id.clone(),
        }
    }

    /// Runs one card action through the live path; `extra` adds e.g. the
    /// rating or flag reason.
    pub(super) fn act(conn: &mut Connection, c: &Card, action: &str, extra: Value, op: u64) {
        use crate::card_reviews::{decode_card_action, execute_card_review_transaction};
        let generation: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(generation), 0) FROM card_review_generations WHERE source_material_id = ?1",
                [&c.material],
                |r| r.get(0),
            )
            .unwrap();
        let revision: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(revision), 0) FROM card_review_state WHERE item_id = ?1",
                [&c.item],
                |r| r.get(0),
            )
            .unwrap();
        let mut value = json!({
            "action": action,
            "operationId": format!("e1000000-0000-4000-8000-{op:012x}"),
            "materialId": c.material,
            "expectedGeneration": generation,
        });
        if action != "reset" {
            value["versionContentHash"] = json!(c.hash);
            value["itemId"] = json!(c.item);
            value["expectedRevision"] = json!(revision);
        }
        if let Value::Object(more) = extra {
            for (k, v) in more {
                value[k] = v;
            }
        }
        let decoded = decode_card_action(&value).unwrap();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        execute_card_review_transaction(&tx, &decoded, &value).unwrap();
        tx.commit().unwrap();
        // Distinct millisecond times for every action.
        std::thread::sleep(std::time::Duration::from_millis(3));
    }

    pub(super) fn rate(conn: &mut Connection, c: &Card, rating: &str, op: u64) {
        act(conn, c, "rate", json!({ "rating": rating }), op);
    }

    pub(super) type StateTuple = (
        i64,
        i64,
        i64,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        i64,
    );

    pub(super) fn state(conn: &Connection, item: &str) -> Option<StateTuple> {
        conn.query_row(
            "SELECT step, reps, lapses, last_reviewed_at, due_at, suspended, flag, revision
             FROM card_review_state WHERE item_id = ?1",
            [item],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            },
        )
        .optional()
        .unwrap()
    }

    /// Every event of the item, with its origin device from the meta.
    fn events_of(conn: &Connection, item: &str) -> Vec<ReviewEvent> {
        let t = table("card_review_events").unwrap();
        let ids: Vec<(String, String)> = conn
            .prepare(
                "SELECT e.id, m.device_id FROM card_review_events e
                 JOIN sync_row_meta m ON m.table_name = 'card_review_events' AND m.row_id = e.id
                 WHERE e.item_id = ?1",
            )
            .unwrap()
            .query_map([item], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        ids.iter()
            .map(|(id, dev)| {
                event_from_row(&read_row_json(conn, t, id).unwrap().unwrap(), dev).unwrap()
            })
            .collect()
    }

    /* ------------------------------ tests ------------------------------ */

    #[test]
    fn re_import_of_an_applied_file_is_a_no_op() {
        let (_peer, file) = every_rule_peer(PHONE);
        let mut mac = device(MAC);
        let first = take(&mut mac, &file);
        assert!(first.applied);
        assert!(first.written > 0);
        let before = dump(&mac);
        let again = take(&mut mac, &file);
        assert_eq!(again, ApplyOutcome::default());
        assert_eq!(dump(&mac), before);
    }

    #[test]
    fn a_mid_import_failure_leaves_the_database_byte_identical() {
        let (_peer, file) = every_rule_peer(PHONE);
        let mut mac = device(MAC);
        insert_graph(&mac, "x", T1);
        mac.execute_batch(
            "CREATE TEMP TRIGGER boom BEFORE INSERT ON material_bookmarks WHEN NEW.id = 'b1'
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();
        let before = dump(&mac);
        assert!(matches!(try_take(&mut mac, &file), Err(ApplyError::Db(_))));
        assert_eq!(dump(&mac), before);
        assert_eq!(guard_rows(&mac), 0);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM sync_applied"), 0);
    }

    #[test]
    fn a_stale_guard_row_is_removed_before_apply() {
        let mut mac = device(MAC);
        mac.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', 'stale')",
            [],
        )
        .unwrap();
        take(&mut mac, &material_file(PHONE));
        assert_eq!(guard_rows(&mac), 0);
        // The triggers record again once the guard is gone.
        mac.execute("UPDATE study_materials SET title = 'Edited'", [])
            .unwrap();
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM local_changes"), 1);
    }

    #[test]
    fn success_clears_the_guard_and_writes_the_receipt() {
        let mut mac = device(MAC);
        let file = material_file(PHONE);
        let out = take(&mut mac, &file);
        assert!(out.applied);
        assert_eq!(out.written, 1);
        assert_eq!(guard_rows(&mac), 0);
        let receipt: (String, String, String) = mac
            .query_row(
                "SELECT peer_device, file_name, applied_at FROM sync_applied",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            receipt,
            (PHONE.to_string(), file.file_name.clone(), NOW.to_string())
        );
        assert_eq!(
            meta_pair(&mac, "study_materials", "m1"),
            (T1.to_string(), PHONE.to_string(), 0)
        );
    }

    /// A file DB in WAL mode with a `probe()` SQL function that a temp
    /// trigger calls while the apply transaction is open.
    fn probed_file_db(
        label: &str,
        probe: impl Fn(&std::path::Path) -> String + Send + 'static,
    ) -> (TempDir, Connection, Arc<Mutex<Vec<String>>>) {
        let dir = TempDir::new(label);
        let path = dir.0.join("db.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        set_device(&conn, MAC);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let probe_path = path.clone();
        conn.create_scalar_function(
            "probe",
            0,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8,
            move |_| {
                let note = probe(&probe_path);
                sink.lock().unwrap().push(note);
                Ok(0)
            },
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TEMP TRIGGER probe_apply AFTER INSERT ON study_materials BEGIN SELECT probe(); END;",
        )
        .unwrap();
        (dir, conn, seen)
    }

    #[test]
    fn a_concurrent_writer_is_blocked_during_apply_and_logged_after() {
        let (dir, mut a, seen) = probed_file_db("apply-busy", |path| {
            let b = Connection::open(path).unwrap();
            b.busy_timeout(std::time::Duration::from_millis(50))
                .unwrap();
            match b.execute(
                "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m-b','b','T','T')",
                [],
            ) {
                Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::DatabaseBusy => "busy".into(),
                other => format!("not busy: {other:?}"),
            }
        });
        take(&mut a, &material_file(PHONE));
        assert_eq!(*seen.lock().unwrap(), ["busy"]);
        let b = Connection::open(dir.0.join("db.sqlite")).unwrap();
        b.execute(
            "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m-b','b','T','T')",
            [],
        )
        .unwrap();
        let logged: Vec<(String, String)> = b
            .prepare("SELECT row_id, changed_at FROM local_changes")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(logged.len(), 1);
        assert_eq!(logged[0].0, "m-b");
        assert_ne!(logged[0].1, T1);
        assert_eq!(meta_pair(&b, "study_materials", "m-b").1, MAC);
    }

    #[test]
    fn a_snapshot_taken_during_apply_never_carries_the_guard() {
        let (dir, mut a, seen) = probed_file_db("apply-snap", |path| {
            let c = Connection::open(path).unwrap();
            let live = count(
                &c,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_applying'",
            );
            let copy = path.with_file_name("snapshot.db");
            c.execute("VACUUM INTO ?1", [copy.to_str().unwrap()])
                .unwrap();
            let snap = Connection::open(&copy).unwrap();
            let copied = count(
                &snap,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_applying'",
            );
            format!("{live}/{copied}")
        });
        take(&mut a, &material_file(PHONE));
        assert_eq!(*seen.lock().unwrap(), ["0/0"]);
        drop(dir);
    }

    #[test]
    fn applied_rows_never_appear_in_local_changes() {
        let (_peer, file) = every_rule_peer(PHONE);
        let mut mac = device(MAC);
        insert_graph(&mac, "x", T1);
        let before = count(&mac, "SELECT COUNT(*) FROM local_changes");
        let out = take(&mut mac, &file);
        assert!(out.written >= SYNC_TABLES.len() - 1, "{out:?}");
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM local_changes"), before);
        for t in SYNC_TABLES {
            let n = count(&mac, &format!("SELECT COUNT(*) FROM {}", t.name));
            assert!(n >= 1, "{} is empty", t.name);
        }
    }

    #[test]
    fn reversed_file_arrival_never_lets_the_older_file_overwrite() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        let f1 = bookmark_file(PHONE, 2, Op::Insert, T1, "old");
        let f2 = bookmark_file(PHONE, 3, Op::Update, T2, "new");
        take(&mut mac, &f2);
        let late = take(&mut mac, &f1);
        assert_eq!((late.written, late.ignored), (0, 1));
        assert_eq!(
            title(&mac, "SELECT title FROM material_bookmarks WHERE id = 'b1'"),
            Some("new".into())
        );
        assert_eq!(
            meta_pair(&mac, "material_bookmarks", "b1"),
            (T2.to_string(), PHONE.to_string(), 0)
        );
    }

    #[test]
    fn lww_tie_breaks_to_the_lower_device_id() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        take(&mut mac, &bookmark_file("bbbb", 2, Op::Insert, T2, "b"));
        take(&mut mac, &bookmark_file("aaaa", 2, Op::Insert, T2, "a"));
        take(&mut mac, &bookmark_file("cccc", 2, Op::Insert, T2, "c"));
        assert_eq!(
            title(&mac, "SELECT title FROM material_bookmarks WHERE id = 'b1'"),
            Some("a".into())
        );
        assert_eq!(meta_pair(&mac, "material_bookmarks", "b1").1, "aaaa");
    }

    #[test]
    fn equal_rows_are_not_rewritten() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        take(&mut mac, &bookmark_file(PHONE, 2, Op::Insert, T2, "same"));
        let before = dump(&mac);
        // Same changes under a new file name (another createdAt).
        let again = file_of(
            PHONE,
            T3,
            vec![
                ch(
                    1,
                    "study_materials",
                    "m1",
                    Op::Insert,
                    T1,
                    Some(material_row("m1", "Mat")),
                ),
                ch(
                    2,
                    "material_bookmarks",
                    "b1",
                    Op::Insert,
                    T2,
                    Some(bookmark_row("b1", "same")),
                ),
            ],
        );
        let out = take(&mut mac, &again);
        assert_eq!((out.applied, out.written, out.ignored), (true, 0, 2));
        let after: Vec<String> = dump(&mac)
            .into_iter()
            .filter(|r| !r.starts_with("sync_applied"))
            .collect();
        let before: Vec<String> = before
            .into_iter()
            .filter(|r| !r.starts_with("sync_applied"))
            .collect();
        assert_eq!(after, before);
    }

    #[test]
    fn union_never_overwrites_an_existing_row() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        let history = |provider: &str| {
            json!({"id": "h1", "material_id": "m1", "kind": "study_set", "reason": "edit",
                   "previous_json": "{}", "provider": provider, "created_at": T1})
        };
        take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![ch(
                    2,
                    "study_set_history",
                    "h1",
                    Op::Insert,
                    T1,
                    Some(history("gemini")),
                )],
            ),
        );
        let out = take(
            &mut mac,
            &file_of(
                PHONE,
                T3,
                vec![ch(
                    3,
                    "study_set_history",
                    "h1",
                    Op::Update,
                    T3,
                    Some(history("import")),
                )],
            ),
        );
        assert_eq!((out.written, out.ignored), (0, 1));
        assert_eq!(
            title(
                &mac,
                "SELECT provider FROM study_set_history WHERE id = 'h1'"
            ),
            Some("gemini".into())
        );
        assert_eq!(meta_pair(&mac, "study_set_history", "h1").0, T1);
    }

    #[test]
    fn a_tombstone_beats_an_older_incoming_update_and_stays_forever() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        take(&mut mac, &bookmark_file(PHONE, 2, Op::Insert, T1, "kept"));
        take(&mut mac, &bookmark_file(PHONE, 3, Op::Delete, T3, ""));
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM material_bookmarks"), 0);
        let out = take(
            &mut mac,
            &bookmark_file("cccc", 1, Op::Update, T2, "late edit"),
        );
        assert_eq!(out.ignored, 1);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM material_bookmarks"), 0);
        assert_eq!(
            meta_pair(&mac, "material_bookmarks", "b1"),
            (T3.to_string(), PHONE.to_string(), 1)
        );
        // A tombstone for a row never seen here is kept too.
        let gone = file_of(
            PHONE,
            T3,
            vec![ch(4, "material_bookmarks", "b9", Op::Delete, T3, None)],
        );
        take(&mut mac, &gone);
        assert_eq!(meta_pair(&mac, "material_bookmarks", "b9").2, 1);
    }

    #[test]
    fn a_newer_local_edit_beats_an_older_incoming_delete() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        take(&mut mac, &bookmark_file(PHONE, 2, Op::Insert, T3, "edited"));
        let out = take(&mut mac, &bookmark_file("cccc", 1, Op::Delete, T2, ""));
        assert_eq!(out.ignored, 1);
        assert_eq!(
            title(&mac, "SELECT title FROM material_bookmarks WHERE id = 'b1'"),
            Some("edited".into())
        );
    }

    #[test]
    fn two_devices_rating_the_same_card_equals_sequential() {
        let mut mac = device(MAC);
        let mut phone = device(PHONE);
        let c = card(&mac, "mat-two");
        card(&phone, "mat-two");
        rate(&mut mac, &c, "good", 1);
        rate(&mut phone, &c, "easy", 2);
        rate(&mut mac, &c, "hard", 3);
        rate(&mut phone, &c, "again", 4);
        let from_mac = ship(&mut mac, MAC, 0);
        let from_phone = ship(&mut phone, PHONE, 0);
        let mac_rev = state(&mac, &c.item).unwrap().7;
        let phone_rev = state(&phone, &c.item).unwrap().7;
        let out = take(&mut mac, &from_phone);
        assert_eq!(out.replayed_items, 1);
        take(&mut phone, &from_mac);

        let mut union = events_of(&mac, &c.item);
        assert_eq!(union.len(), 4);
        union.sort_by(|a, b| order_key(a).cmp(&order_key(b)));
        let want = fold(&union).unwrap();
        for (conn, rev) in [(&mac, mac_rev), (&phone, phone_rev)] {
            let got = state(conn, &c.item).unwrap();
            assert_eq!(
                (got.0, got.1, got.2, got.3.clone(), got.4.clone()),
                (
                    want.step,
                    want.reps,
                    want.lapses,
                    Some(want.last_reviewed_at.clone()),
                    Some(want.due_at.clone())
                )
            );
            // Never below the rating count (backup verification needs it).
            assert_eq!(got.7, (rev + 1).max(4));
        }
        assert_eq!(
            state(&mac, &c.item),
            state(&phone, &c.item).map(|mut s| {
                s.7 = state(&mac, &c.item).unwrap().7;
                s
            })
        );
    }

    #[test]
    fn a_suspend_on_the_mac_survives_a_rating_on_the_phone() {
        let mut mac = device(MAC);
        let mut phone = device(PHONE);
        let c = card(&mac, "mat-susp");
        card(&phone, "mat-susp");
        rate(&mut phone, &c, "good", 1);
        act(&mut mac, &c, "suspend", json!({}), 2);
        act(&mut mac, &c, "flag", json!({"reason": "unclear"}), 3);
        let out = take(&mut mac, &ship(&mut phone, PHONE, 0));
        assert_eq!(out.replayed_items, 1);
        let got = state(&mac, &c.item).unwrap();
        let want = fold(&events_of(&mac, &c.item)).unwrap();
        assert_eq!((got.1, got.4.clone()), (want.reps, Some(want.due_at)));
        assert_eq!((got.5, got.6.as_deref()), (1, Some("unclear")));
    }

    #[test]
    fn delayed_pre_reset_events_are_ignored_after_a_local_reset() {
        let mut mac = device(MAC);
        let mut phone = device(PHONE);
        let c = card(&mac, "mat-reset");
        card(&phone, "mat-reset");
        rate(&mut phone, &c, "good", 1);
        act(&mut mac, &c, "reset", json!({}), 2);
        let out = take(&mut mac, &ship(&mut phone, PHONE, 0));
        assert!(out.ignored >= 1);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM card_review_events"), 0);
        assert_eq!(state(&mac, &c.item), None);
        assert_eq!(
            count(&mac, "SELECT generation FROM card_review_generations"),
            1
        );
    }

    #[test]
    fn a_peer_reset_raises_the_local_generation() {
        let mut mac = device(MAC);
        let mut phone = device(PHONE);
        let c = card(&mac, "mat-raise");
        card(&phone, "mat-raise");
        rate(&mut mac, &c, "easy", 1);
        rate(&mut phone, &c, "good", 2);
        act(&mut phone, &c, "reset", json!({}), 3);
        act(&mut phone, &c, "reset", json!({}), 4);
        rate(&mut phone, &c, "hard", 5);
        let out = take(&mut mac, &ship(&mut phone, PHONE, 0));
        assert_eq!(out.replayed_items, 1);
        assert_eq!(
            count(&mac, "SELECT generation FROM card_review_generations"),
            2
        );
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM card_review_events WHERE generation < 2"
            ),
            0
        );
        let events = events_of(&mac, &c.item);
        assert_eq!(events.len(), 1);
        let got = state(&mac, &c.item).unwrap();
        let want = fold(&events).unwrap();
        assert_eq!((got.1, got.3), (want.reps, Some(want.last_reviewed_at)));
        assert_eq!(got.7, 1);
    }

    #[test]
    fn first_reviewed_at_after_a_peer_reset_is_null() {
        let mut mac = device(MAC);
        let mut phone = device(PHONE);
        let c = card(&mac, "mat-first");
        card(&phone, "mat-first");
        rate(&mut mac, &c, "good", 1);
        act(&mut phone, &c, "reset", json!({}), 2);
        take(&mut mac, &ship(&mut phone, PHONE, 0));
        let first: Option<String> = mac
            .query_row("SELECT first_reviewed_at FROM card_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(first, None);
    }

    fn attempt_row(id: &str, started: &str) -> Value {
        json!({"id": id, "version_id": "pv1", "source_material_id": "m1",
               "source_material_title": "Mat", "started_at": started, "status": "in_progress",
               "revision": 0, "total_questions": 1})
    }

    fn practice_base() -> Vec<Change> {
        vec![
            ch(
                1,
                "study_materials",
                "m1",
                Op::Insert,
                T1,
                Some(material_row("m1", "Mat")),
            ),
            ch(
                2,
                "practice_test_versions",
                "pv1",
                Op::Insert,
                T1,
                Some(json!({
                "id": "pv1", "source_material_id": "m1", "history_key": "hk",
                "source_material_title": "Mat", "content_hash": "h1", "created_at": T1, "is_active": 1})),
            ),
        ]
    }

    #[test]
    fn a_second_in_progress_attempt_abandons_the_older() {
        let mut mac = device(MAC);
        take(&mut mac, &file_of(PHONE, T1, practice_base()));
        take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![ch(
                    3,
                    "practice_attempts",
                    "a-old",
                    Op::Insert,
                    T1,
                    Some(attempt_row("a-old", T1)),
                )],
            ),
        );
        take(
            &mut mac,
            &file_of(
                "cccc",
                T2,
                vec![ch(
                    1,
                    "practice_attempts",
                    "a-new",
                    Op::Insert,
                    T2,
                    Some(attempt_row("a-new", T2)),
                )],
            ),
        );
        let status = |id: &str| {
            title(
                &mac,
                &format!("SELECT status FROM practice_attempts WHERE id = '{id}'"),
            )
        };
        assert_eq!(status("a-old"), Some("abandoned".into()));
        assert_eq!(status("a-new"), Some("in_progress".into()));
        // The other order: an older incoming attempt lands abandoned.
        let mut other = device(MAC);
        take(&mut other, &file_of(PHONE, T1, practice_base()));
        take(
            &mut other,
            &file_of(
                "cccc",
                T2,
                vec![ch(
                    1,
                    "practice_attempts",
                    "a-new",
                    Op::Insert,
                    T2,
                    Some(attempt_row("a-new", T2)),
                )],
            ),
        );
        take(
            &mut other,
            &file_of(
                PHONE,
                T1,
                vec![ch(
                    3,
                    "practice_attempts",
                    "a-old",
                    Op::Insert,
                    T1,
                    Some(attempt_row("a-old", T1)),
                )],
            ),
        );
        let status = |id: &str| {
            title(
                &other,
                &format!("SELECT status FROM practice_attempts WHERE id = '{id}'"),
            )
        };
        assert_eq!(status("a-old"), Some("abandoned".into()));
        assert_eq!(status("a-new"), Some("in_progress".into()));
    }

    fn version_change(
        seq: i64,
        id: &str,
        hash: &str,
        active: i64,
        at: &str,
        first: Option<&str>,
    ) -> Change {
        ch(
            seq,
            "card_versions",
            id,
            Op::Update,
            at,
            Some(json!({
            "id": id, "source_material_id": "m1", "content_hash": hash, "card_count": 1,
            "provider": "import", "created_at": T1, "first_reviewed_at": first, "is_active": active})),
        )
    }

    fn active_card_version(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT id FROM card_versions WHERE is_active = 1")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn a_card_version_collision_keeps_the_newest_active() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![version_change(2, "v1", "h1", 1, T1, Some(T2))],
            ),
        );
        take(
            &mut mac,
            &file_of(
                "cccc",
                T2,
                vec![version_change(
                    1,
                    "v2",
                    "h2",
                    1,
                    T2,
                    Some("2026-11-01T12:00:00.000Z"),
                )],
            ),
        );
        assert_eq!(active_card_version(&mac), ["v2"]);
        // v1 arrives again from a device that reviewed it earlier.
        take(
            &mut mac,
            &file_of(
                "dddd",
                T1,
                vec![version_change(
                    1,
                    "v1",
                    "h1",
                    1,
                    T1,
                    Some("2026-11-01T11:00:00.000Z"),
                )],
            ),
        );
        assert_eq!(active_card_version(&mac), ["v2"]);
        assert_eq!(
            title(
                &mac,
                "SELECT first_reviewed_at FROM card_versions WHERE id = 'v1'"
            ),
            Some("2026-11-01T11:00:00.000Z".into())
        );
        // Same material + content under another id maps onto the local row.
        let out = take(
            &mut mac,
            &file_of(
                "eeee",
                T3,
                vec![version_change(1, "v1-legacy", "h1", 1, T3, None)],
            ),
        );
        assert_eq!(out.written, 1);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM card_versions"), 2);
        assert_eq!(active_card_version(&mac), ["v1"]);
    }

    #[test]
    fn reactivating_an_older_card_version_stays_active_both_ways() {
        let mut mac = device(MAC);
        let mut phone = device(PHONE);
        for conn in [&mac, &phone] {
            conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','Mat','T','T')", []).unwrap();
            for (id, hash, created, active) in [("v1", "h1", T1, 0), ("v2", "h2", T2, 1)] {
                conn.execute(
                    "INSERT INTO card_versions (id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES (?1,'m1',?2,1,'import',?3,?4)",
                    params![id, hash, created, active],
                )
                .unwrap();
            }
        }
        let mac_seq = count(&mac, "SELECT MAX(seq) FROM local_changes");
        let phone_seq = count(&phone, "SELECT MAX(seq) FROM local_changes");
        take(&mut mac, &ship(&mut phone, PHONE, 0));
        take(&mut phone, &ship(&mut mac, MAC, 0));
        std::thread::sleep(std::time::Duration::from_millis(3));
        // The phone switches back to the older set, as the live path does.
        phone
            .execute("UPDATE card_versions SET is_active = 0 WHERE id = 'v2'", [])
            .unwrap();
        phone
            .execute("UPDATE card_versions SET is_active = 1 WHERE id = 'v1'", [])
            .unwrap();
        take(&mut mac, &ship(&mut phone, PHONE, phone_seq));
        assert_eq!(active_card_version(&mac), ["v1"]);
        assert_eq!(active_card_version(&phone), ["v1"]);
        assert!(export_changes_in(&mut mac, MAC, mac_seq, "0.0.0-test", NOW)
            .unwrap()
            .is_none());
        let back = ship(&mut mac, MAC, 0);
        take(&mut phone, &back);
        assert_eq!(active_card_version(&phone), ["v1"]);
    }

    #[test]
    fn a_practice_version_collision_keeps_the_newest_active() {
        let mut mac = device(MAC);
        take(&mut mac, &file_of(PHONE, T1, practice_base()));
        let pv2 = ch(
            1,
            "practice_test_versions",
            "pv2",
            Op::Insert,
            T2,
            Some(json!({
            "id": "pv2", "source_material_id": "m1", "history_key": "hk",
            "source_material_title": "Mat", "content_hash": "h2", "created_at": T2, "is_active": 1})),
        );
        take(&mut mac, &file_of("cccc", T2, vec![pv2]));
        let active: Vec<String> = mac
            .prepare("SELECT id FROM practice_test_versions WHERE is_active = 1")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(active, ["pv2"]);
    }

    #[test]
    fn a_version_delete_with_a_local_attempt_is_ignored() {
        let mut mac = device(MAC);
        take(&mut mac, &file_of(PHONE, T1, practice_base()));
        take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![ch(
                    3,
                    "practice_attempts",
                    "a1",
                    Op::Insert,
                    T1,
                    Some(attempt_row("a1", T1)),
                )],
            ),
        );
        let out = take(
            &mut mac,
            &file_of(
                "cccc",
                T3,
                vec![ch(1, "practice_test_versions", "pv1", Op::Delete, T3, None)],
            ),
        );
        assert_eq!((out.written, out.ignored), (0, 1));
        assert_eq!(
            count(&mac, "SELECT COUNT(*) FROM practice_test_versions"),
            1
        );
    }

    #[test]
    fn a_newer_schema_file_is_refused_before_apply() {
        let (bytes, name) = pack_set(&ChangeSet {
            schema_version: SCHEMA + 1,
            ..sample_set()
        });
        assert_eq!(
            decode(&bytes, &name, SCHEMA, NOW).unwrap_err(),
            ChangeFileError::SchemaTooNew
        );
        let mac = device(MAC);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM sync_applied"), 0);
    }

    #[test]
    fn a_future_created_at_is_reported_not_refused() {
        let mut mac = device(MAC);
        let file = file_of(
            PHONE,
            "2026-11-05T12:00:00.000Z",
            vec![ch(
                1,
                "study_materials",
                "m1",
                Op::Insert,
                T1,
                Some(material_row("m1", "Mat")),
            )],
        );
        let out = take(&mut mac, &file);
        assert!(out.applied && out.created_in_future);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM study_materials"), 1);
    }

    #[test]
    fn an_orphan_of_a_tombstoned_parent_is_skipped_and_a_truly_missing_parent_aborts() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        take(
            &mut mac,
            &file_of(
                PHONE,
                T3,
                vec![ch(2, "study_materials", "m1", Op::Delete, T3, None)],
            ),
        );
        let out = take(
            &mut mac,
            &bookmark_file("cccc", 1, Op::Insert, T2, "orphan"),
        );
        assert_eq!((out.written, out.ignored), (0, 1));
        let lost = file_of(
            "cccc",
            T2,
            vec![ch(
                2,
                "material_bookmarks",
                "b2",
                Op::Insert,
                T2,
                Some(json!({
                "id": "b2", "material_id": "m-none", "page_index": 1, "title": "t",
                "created_at": T1, "updated_at": T1})),
            )],
        );
        assert!(matches!(
            try_take(&mut mac, &lost),
            Err(ApplyError::MissingParent("material_bookmarks"))
        ));
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM sync_applied WHERE peer_device = 'cccc'"
            ),
            1
        );
    }

    #[test]
    fn a_delete_on_a_union_table_is_ignored() {
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        let history = json!({"id": "h1", "material_id": "m1", "kind": "study_set", "reason": "edit",
                             "previous_json": "{}", "provider": "gemini", "created_at": T1});
        take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![ch(
                    2,
                    "study_set_history",
                    "h1",
                    Op::Insert,
                    T1,
                    Some(history),
                )],
            ),
        );
        let out = take(
            &mut mac,
            &file_of(
                PHONE,
                T3,
                vec![ch(3, "study_set_history", "h1", Op::Delete, T3, None)],
            ),
        );
        assert_eq!((out.written, out.ignored), (0, 1));
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM study_set_history"), 1);
    }

    #[test]
    fn a_material_linked_to_a_goal_applies_with_the_link_cleared() {
        let mut mac = device(MAC);
        let mut row = material_row("m1", "Mat");
        row["goal_id"] = json!("goal-on-the-phone");
        let out = take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![ch(1, "study_materials", "m1", Op::Insert, T1, Some(row))],
            ),
        );
        assert_eq!(out.written, 1);
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM study_materials WHERE goal_id IS NULL"
            ),
            1
        );
    }

    #[test]
    fn edited_in_place_tables_merge_by_lww() {
        assert_eq!(
            table("material_content_identities").unwrap().rule,
            MergeRule::Lww
        );
        assert_eq!(table("practice_responses").unwrap().rule, MergeRule::Lww);
        let mut mac = device(MAC);
        take(&mut mac, &material_file(PHONE));
        let identity = |pages: i64| json!({"material_id": "m1", "content_sha256": "a".repeat(64), "total_pages": pages, "verified_at": T1});
        take(
            &mut mac,
            &file_of(
                PHONE,
                T1,
                vec![ch(
                    2,
                    "material_content_identities",
                    "m1",
                    Op::Insert,
                    T1,
                    Some(identity(3)),
                )],
            ),
        );
        take(
            &mut mac,
            &file_of(
                PHONE,
                T2,
                vec![ch(
                    3,
                    "material_content_identities",
                    "m1",
                    Op::Update,
                    T2,
                    Some(identity(5)),
                )],
            ),
        );
        assert_eq!(
            count(&mac, "SELECT total_pages FROM material_content_identities"),
            5
        );
    }

    #[test]
    fn an_unknown_column_is_refused() {
        let mut mac = device(MAC);
        let mut row = material_row("m1", "Mat");
        row["no_such_column"] = json!(1);
        let file = file_of(
            PHONE,
            T1,
            vec![ch(1, "study_materials", "m1", Op::Insert, T1, Some(row))],
        );
        assert!(matches!(
            try_take(&mut mac, &file),
            Err(ApplyError::UnknownColumn("study_materials"))
        ));
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM study_materials"), 0);
    }
}

/* ------------------------------- ingest ----------------------------- */

mod ingest {
    use super::apply::{device, every_rule_peer, take, MAC, PHONE};
    use super::*;
    use crate::sync::export::export_changes_in;
    use crate::sync::ingest::{export_changes_from_archive, IngestError};

    /// A zip with `manifest.json` and a `VACUUM INTO` copy of `conn`.
    fn archive(dir: &TempDir, conn: &Connection, manifest: Value) -> std::path::PathBuf {
        let db = dir.0.join("source.db");
        let _ = std::fs::remove_file(&db);
        conn.execute("VACUUM INTO ?1", [db.to_str().unwrap()])
            .unwrap();
        let path = dir.0.join("phone-backup.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(manifest.to_string().as_bytes()).unwrap();
        zip.start_file("her-flight-deck.db", opts).unwrap();
        zip.write_all(&std::fs::read(&db).unwrap()).unwrap();
        zip.finish().unwrap();
        path
    }

    fn phone_manifest() -> Value {
        json!({"format": "her-flight-deck-complete-backup", "formatVersion": 3,
               "appVersion": "0.0.0-test", "schemaVersion": SCHEMA, "platform": "ios"})
    }

    fn ingest(
        path: &std::path::Path,
    ) -> Result<Option<crate::sync::export::ExportedChanges>, IngestError> {
        ingest_at(path, NOW)
    }

    /// Ingests run one at a time so `ingest_removes_its_temp_dir` never sees
    /// another test's working folder.
    static INGESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn ingest_at(
        path: &std::path::Path,
        created_at: &str,
    ) -> Result<Option<crate::sync::export::ExportedChanges>, IngestError> {
        let _one = INGESTS.lock().unwrap_or_else(|e| e.into_inner());
        export_changes_from_archive(path, Some(MAC), "0.0.0-test", created_at)
    }

    fn leftover_dirs() -> usize {
        let prefix = format!("hfd-sync-ingest-{}-", std::process::id());
        std::fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
            .count()
    }

    #[test]
    fn a_phone_backup_ingests_as_a_change_file() {
        let dir = TempDir::new("ingest");
        let (mut phone, direct) = every_rule_peer(PHONE);
        let path = archive(&dir, &phone, phone_manifest());
        let out = ingest(&path).unwrap().unwrap();
        assert_eq!(out.file.bytes, direct.bytes);
        let same = export_changes_in(&mut phone, PHONE, 0, "0.0.0-test", NOW)
            .unwrap()
            .unwrap();
        assert_eq!(out.file.file_name, same.file.file_name);
        let mut mac = device(MAC);
        let applied = take(&mut mac, &out.file);
        assert!(applied.applied && applied.written > 0);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM study_materials"), 1);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM local_changes"), 0);
    }

    #[test]
    fn re_ingesting_the_same_backup_is_a_no_op() {
        let dir = TempDir::new("ingest-again");
        let (_phone, _) = every_rule_peer(PHONE);
        let path = archive(&dir, &_phone, phone_manifest());
        let mut mac = device(MAC);
        take(&mut mac, &ingest(&path).unwrap().unwrap().file);
        let again = take(&mut mac, &ingest(&path).unwrap().unwrap().file);
        assert!(!again.applied);
        // A newer createdAt (new file name) still writes nothing.
        let later = ingest_at(&path, "2026-11-04T13:00:00.000Z")
            .unwrap()
            .unwrap();
        let out = take(&mut mac, &later.file);
        assert!(out.applied);
        assert_eq!(out.written, 0);
    }

    #[test]
    fn a_mac_backup_is_refused_for_ingest() {
        let dir = TempDir::new("ingest-mac");
        let (phone, _) = every_rule_peer(PHONE);
        let mut manifest = phone_manifest();
        manifest["platform"] = json!("macos");
        let path = archive(&dir, &phone, manifest);
        assert!(matches!(ingest(&path), Err(IngestError::NotAPhoneBackup)));
        manifest = phone_manifest();
        manifest.as_object_mut().unwrap().remove("platform");
        let path = archive(&dir, &phone, manifest);
        assert!(matches!(ingest(&path), Err(IngestError::NotAPhoneBackup)));
    }

    #[test]
    fn a_pre_ledger_backup_is_too_old() {
        let dir = TempDir::new("ingest-old");
        let old = Connection::open_in_memory().unwrap();
        for m in crate::migrations().iter().filter(|m| m.version < 33) {
            old.execute_batch(m.sql).unwrap();
        }
        old.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
            [PHONE],
        )
        .unwrap();
        let path = archive(&dir, &old, phone_manifest());
        let Err(err) = ingest(&path) else {
            panic!("a pre-ledger archive was accepted")
        };
        assert!(matches!(err, IngestError::ArchiveTooOld));
        assert!(err.to_string().contains("Update the app on your phone"));
    }

    #[test]
    fn an_archive_without_a_device_id_is_refused() {
        let dir = TempDir::new("ingest-noid");
        let conn = migrated();
        conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','a','T','T')", [])
            .unwrap();
        let path = archive(&dir, &conn, phone_manifest());
        assert!(matches!(ingest(&path), Err(IngestError::NoDeviceId)));
    }

    #[test]
    fn a_newer_schema_phone_archive_is_refused() {
        let dir = TempDir::new("ingest-new");
        let (phone, _) = every_rule_peer(PHONE);
        let mut manifest = phone_manifest();
        manifest["schemaVersion"] = json!(SCHEMA + 1);
        let path = archive(&dir, &phone, manifest);
        assert!(matches!(ingest(&path), Err(IngestError::SchemaTooNew)));
    }

    #[test]
    fn an_archive_from_this_device_is_refused() {
        let dir = TempDir::new("ingest-self");
        let (phone, _) = every_rule_peer(MAC);
        let path = archive(&dir, &phone, phone_manifest());
        assert!(matches!(ingest(&path), Err(IngestError::SameDevice)));
    }

    #[test]
    fn ingest_uses_the_manifest_time_for_the_file_name() {
        let dir = TempDir::new("ingest-time");
        let (phone, _) = every_rule_peer(PHONE);
        let mut manifest = phone_manifest();
        manifest["createdAt"] = json!(1_700_000_000u64);
        manifest["appVersion"] = json!("9.9.9-phone");
        let path = archive(&dir, &phone, manifest);
        let a = ingest_at(&path, NOW).unwrap().unwrap();
        let b = ingest_at(&path, "2030-01-01T00:00:00.000Z")
            .unwrap()
            .unwrap();
        assert_eq!(a.file.file_name, b.file.file_name);
        assert_eq!(a.file.bytes, b.file.bytes);
        let set = decode(&a.file.bytes, &a.file.file_name, SCHEMA, NOW)
            .unwrap()
            .set;
        assert_eq!(set.created_at, "2023-11-14T22:13:20.000Z");
        assert_eq!(set.app_version, "9.9.9-phone");
        // A manifest without them falls back to the arguments.
        let path = archive(&dir, &phone, phone_manifest());
        let c = ingest_at(&path, NOW).unwrap().unwrap();
        let set = decode(&c.file.bytes, &c.file.file_name, SCHEMA, NOW)
            .unwrap()
            .set;
        assert_eq!(
            (set.created_at.as_str(), set.app_version.as_str()),
            (NOW, "0.0.0-test")
        );
    }

    #[test]
    fn a_restored_phone_sends_only_work_after_the_restore() {
        let dir = TempDir::new("ingest-floor");
        let (phone, _) = every_rule_peer(PHONE);
        let floor: i64 = count(&phone, "SELECT MAX(seq) FROM local_changes");
        // Odd spellings read as text, like the export watermark.
        phone
            .execute(
                "INSERT INTO app_metadata (key, value) VALUES ('sync_floor_seq', ?1)",
                [floor.to_string()],
            )
            .unwrap();
        assert!(ingest(&archive(&dir, &phone, phone_manifest()))
            .unwrap()
            .is_none());
        phone
            .execute(
                "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('b9','m1',2,'after',?1,?1)",
                [NEW],
            )
            .unwrap();
        let out = ingest(&archive(&dir, &phone, phone_manifest()))
            .unwrap()
            .unwrap();
        let set = decode(&out.file.bytes, &out.file.file_name, SCHEMA, NOW)
            .unwrap()
            .set;
        assert_eq!(set.from_seq, floor + 1);
        assert_eq!(set.changes.len(), 1);
        assert_eq!(set.changes[0].row_id, "b9");
    }

    #[test]
    fn ingest_removes_its_temp_dir() {
        let dir = TempDir::new("ingest-clean");
        let (phone, _) = every_rule_peer(PHONE);
        let good = archive(&dir, &phone, phone_manifest());
        ingest(&good).unwrap();
        let bare = migrated();
        let bad = archive(&dir, &bare, phone_manifest());
        assert!(ingest(&bad).is_err());
        let _one = INGESTS.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(leftover_dirs(), 0);
    }
}

mod progress {
    use super::apply::{device, every_rule_peer, MAC, PHONE};
    use super::*;
    use crate::sync::progress::{import_phone_progress_in, PhoneProgress, ProgressOutcome};
    use sha2::{Digest, Sha256};

    const SAVED: u64 = 1_699_000_000;
    const OLD_TIME: &str = "2026-10-01T10:00:00.000Z";

    pub(super) fn manifest() -> Value {
        json!({"format": "her-flight-deck-complete-backup", "formatVersion": 3,
               "appVersion": "0.0.0-test", "createdAt": SAVED,
               "schemaVersion": SCHEMA, "platform": "ios"})
    }

    /// A phone archive: the manifest, a copy of `conn`, and `docs` under `documents/`.
    pub(super) fn archive(
        dir: &TempDir,
        conn: &Connection,
        manifest: Value,
        docs: &[(&str, &[u8])],
    ) -> std::path::PathBuf {
        let db = dir.0.join("source.db");
        let _ = std::fs::remove_file(&db);
        conn.execute("VACUUM INTO ?1", [db.to_str().unwrap()])
            .unwrap();
        let path = dir.0.join("My phone work.hfdbackup");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(manifest.to_string().as_bytes()).unwrap();
        zip.start_file("her-flight-deck.db", opts).unwrap();
        zip.write_all(&std::fs::read(&db).unwrap()).unwrap();
        for (name, bytes) in docs {
            zip.start_file(format!("documents/{name}"), opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    /// The Mac's app folder with an empty library database.
    pub(super) fn mac_root() -> TempDir {
        let root = TempDir::new("progress-mac");
        let conn = Connection::open(root.0.join("her-flight-deck.db")).unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
            [MAC],
        )
        .unwrap();
        root
    }

    pub(super) fn mac_db(root: &TempDir) -> Connection {
        Connection::open(root.0.join("her-flight-deck.db")).unwrap()
    }

    pub(super) fn run(root: &TempDir, archive: &std::path::Path) -> Result<PhoneProgress, String> {
        import_phone_progress_in(&root.0, archive, Some(MAC), "0.0.0-test", NOW)
    }

    #[test]
    fn a_phone_backup_brings_in_reviews_and_counts_them() {
        let dir = TempDir::new("progress-a");
        let root = mac_root();
        let (phone, _) = every_rule_peer(PHONE);
        let got = run(&root, &archive(&dir, &phone, manifest(), &[])).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        let c = &got.counts;
        assert_eq!(
            (c.reviews, c.tests, c.bookmarks, c.reading_positions),
            (1, 1, 1, 1)
        );
        assert_eq!((c.materials, c.guides, c.generated_tests), (1, 1, 1));
        assert_eq!(got.phone_saved_at, Some(SAVED));
        assert!(!got.from_future);
        let mac = mac_db(&root);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM card_review_events"), 1);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM local_changes"), 0);
    }

    #[test]
    fn the_same_backup_twice_is_already_in() {
        let dir = TempDir::new("progress-b");
        let root = mac_root();
        let (phone, _) = every_rule_peer(PHONE);
        let path = archive(&dir, &phone, manifest(), &[]);
        run(&root, &path).unwrap();
        let again = run(&root, &path).unwrap();
        assert_eq!(again.outcome, ProgressOutcome::AlreadyIn);
        assert_eq!(again.counts.reviews, 0);
    }

    #[test]
    fn a_newer_backup_adds_only_the_new_work() {
        let dir = TempDir::new("progress-c");
        let root = mac_root();
        let (phone, _) = every_rule_peer(PHONE);
        run(&root, &archive(&dir, &phone, manifest(), &[])).unwrap();
        phone
            .execute(
                "INSERT INTO card_review_events (id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES ('e2','i1',1,'good',?1,?2,'{}','{}')",
                params![NEW, crate::card_reviews::SCHEDULER_VERSION],
            )
            .unwrap();
        let mut later = manifest();
        later["createdAt"] = json!(SAVED + 3600);
        let got = run(&root, &archive(&dir, &phone, later, &[])).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!(got.counts.reviews, 1);
        assert_eq!(got.counts.bookmarks, 0);
        assert_eq!(got.counts.materials, 0);
        assert_eq!(
            count(&mac_db(&root), "SELECT COUNT(*) FROM card_review_events"),
            2
        );
    }

    /// Every row of the tables a failed apply must leave alone.
    pub(super) fn snapshot(conn: &Connection) -> Vec<String> {
        let mut out = Vec::new();
        for (table, cols) in [
            (
                "sync_row_meta",
                "table_name || row_id || changed_at || device_id || deleted",
            ),
            ("sync_applied", "peer_device || file_name"),
            ("practice_responses", "id || attempt_id || item_id"),
            ("app_metadata", "key || '=' || value"),
        ] {
            let mut stmt = conn
                .prepare(&format!("SELECT {cols} FROM {table} ORDER BY 1"))
                .unwrap();
            out.extend(
                stmt.query_map([], |r| r.get::<_, String>(0))
                    .unwrap()
                    .map(|r| format!("{table}:{}", r.unwrap())),
            );
        }
        out
    }

    #[test]
    fn a_unique_collision_changes_nothing_and_keeps_plain_words() {
        let dir = TempDir::new("progress-d");
        let root = mac_root();
        {
            let mac = mac_db(&root);
            insert_graph_unlogged(&mac, "", OLD_TIME);
            unlogged(&mac, "UPDATE practice_responses SET id = 'r-mac'");
        }
        let (phone, _) = every_rule_peer(PHONE);
        let before = snapshot(&mac_db(&root));
        let err = run(&root, &archive(&dir, &phone, manifest(), &[])).unwrap_err();
        assert!(err.starts_with("Part of that file overlaps work already on this Mac"));
        assert!(err.contains("Keep the file"));
        assert_eq!(snapshot(&mac_db(&root)), before);
        let mac = mac_db(&root);
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_applying'"
            ),
            0
        );
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM sync_applied"), 0);
    }

    #[test]
    fn an_attempt_for_a_deleted_material_is_skipped() {
        let dir = TempDir::new("progress-e");
        let root = mac_root();
        let phone = device(PHONE);
        insert_graph(&phone, "", OLD_TIME);
        let path = archive(&dir, &phone, manifest(), &[]);
        // The Mac deletes the material after the phone's work was logged.
        std::thread::sleep(std::time::Duration::from_millis(20));
        {
            let mac = mac_db(&root);
            insert_graph_unlogged(&mac, "", OLD_TIME);
            mac.execute("DELETE FROM study_materials WHERE id = 'm1'", [])
                .unwrap();
        }
        let got = run(&root, &path).unwrap();
        assert_ne!(got.outcome, ProgressOutcome::AlreadyIn);
        let mac = mac_db(&root);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM study_materials"), 0);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM practice_attempts"), 0);
    }

    fn phone_with_pdf(bytes: &[u8]) -> Connection {
        let phone = device(PHONE);
        insert_graph(&phone, "", OLD_TIME);
        phone
            .execute("UPDATE study_materials SET file_path = 'phone-one.pdf'", [])
            .unwrap();
        phone
            .execute(
                "UPDATE material_content_identities SET content_sha256 = ?1",
                [hex::encode(Sha256::digest(bytes))],
            )
            .unwrap();
        phone
    }

    #[test]
    fn a_phone_pdf_is_placed_from_the_archive() {
        let dir = TempDir::new("progress-f");
        let root = mac_root();
        let pdf: &[u8] = b"%PDF-1.4 synthetic phone pdf";
        let phone = phone_with_pdf(pdf);
        let path = archive(&dir, &phone, manifest(), &[("phone-one.pdf", pdf)]);
        let got = run(&root, &path).unwrap();
        assert_eq!((got.pdfs_added, got.pdfs_waiting), (1, 0));
        assert_eq!(
            std::fs::read(root.0.join("documents/phone-one.pdf")).unwrap(),
            pdf
        );
        // Nothing is left behind next to it.
        let names: Vec<_> = std::fs::read_dir(root.0.join("documents"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1);
        // Again: already in, and a PDF already in place is not "waiting".
        let again = run(&root, &path).unwrap();
        assert_eq!(again.outcome, ProgressOutcome::AlreadyIn);
        assert_eq!((again.pdfs_added, again.pdfs_waiting), (0, 0));
    }

    #[test]
    fn a_missing_pdf_is_reported_not_fatal() {
        let dir = TempDir::new("progress-g");
        let root = mac_root();
        let pdf: &[u8] = b"%PDF-1.4 synthetic phone pdf";
        let phone = phone_with_pdf(pdf);
        let got = run(&root, &archive(&dir, &phone, manifest(), &[])).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!((got.pdfs_added, got.pdfs_waiting), (0, 1));
        assert_eq!(
            count(&mac_db(&root), "SELECT COUNT(*) FROM study_materials"),
            1
        );
        // A wrong file under the right name is also only reported.
        let wrong = archive(
            &dir,
            &phone,
            manifest(),
            &[("phone-one.pdf", b"other bytes")],
        );
        let got = run(&root, &wrong).unwrap();
        assert_eq!((got.pdfs_added, got.pdfs_waiting), (0, 1));
        assert!(!root.0.join("documents/phone-one.pdf").exists());
        // The right file arriving later is picked up even though the work is already in.
        let right = archive(&dir, &phone, manifest(), &[("phone-one.pdf", pdf)]);
        let got = run(&root, &right).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::AlreadyIn);
        assert_eq!((got.pdfs_added, got.pdfs_waiting), (1, 0));
    }

    #[test]
    fn progress_errors_name_no_path() {
        let dir = TempDir::new("progress-h");
        let root = mac_root();
        let (phone, _) = every_rule_peer(PHONE);
        let mut errors = Vec::new();
        errors.push(run(&root, &dir.0.join("missing.hfdbackup")).unwrap_err());
        let junk = dir.0.join("junk.hfdbackup");
        std::fs::write(&junk, b"not a zip").unwrap();
        errors.push(run(&root, &junk).unwrap_err());
        let mut mac_manifest = manifest();
        mac_manifest["platform"] = json!("macos");
        errors.push(run(&root, &archive(&dir, &phone, mac_manifest, &[])).unwrap_err());
        let (mac_copy, _) = every_rule_peer(MAC);
        errors.push(run(&root, &archive(&dir, &mac_copy, manifest(), &[])).unwrap_err());
        let mut newer = manifest();
        newer["schemaVersion"] = json!(SCHEMA + 1);
        errors.push(run(&root, &archive(&dir, &phone, newer, &[])).unwrap_err());
        let elsewhere = TempDir::new("progress-h-empty");
        errors.push(run(&elsewhere, &archive(&dir, &phone, manifest(), &[])).unwrap_err());
        for err in errors {
            let lower = err.to_lowercase();
            assert!(!err.contains('/') && !err.contains('\\'), "{err}");
            assert!(!err.contains(dir.0.to_str().unwrap()), "{err}");
            for word in [
                "sync",
                "merge",
                "conflict",
                "import",
                "ingest",
                "ledger",
                "change file",
                "device",
                "database",
                "sqlite",
                "manifest",
                "constraint",
            ] {
                assert!(!lower.contains(word), "{word} in {err}");
            }
        }
    }
}

mod blobs {
    use super::*;
    use crate::sync::blobs::*;
    use sha2::{Digest, Sha256};
    use std::io::Read;

    const CAP: u64 = MAX_BLOB_BYTES;

    fn sha_of(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    fn names(dir: &std::path::Path) -> Vec<String> {
        match std::fs::read_dir(dir) {
            Ok(rd) => rd
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    fn material(conn: &Connection, id: &str, path: Option<&str>, sha: Option<&str>) {
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, created_at, updated_at) VALUES (?1, 'T', ?2, ?3, ?3)",
            params![id, path, NOW],
        )
        .unwrap();
        if let Some(sha) = sha {
            conn.execute(
                "INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at) VALUES (?1, ?2, 1, ?3)",
                params![id, sha, NOW],
            )
            .unwrap();
        }
    }

    /// (db, app root, sync root) with `m-1` -> documents/m-1.pdf holding `bytes`.
    fn setup(bytes: &[u8]) -> (Connection, TempDir, TempDir) {
        let conn = migrated();
        let app = TempDir::new("blob-app");
        let sync = TempDir::new("blob-sync");
        std::fs::create_dir_all(app.0.join("documents")).unwrap();
        std::fs::write(app.0.join("documents/m-1.pdf"), bytes).unwrap();
        material(&conn, "m-1", Some("m-1.pdf"), Some(&sha_of(bytes)));
        (conn, app, sync)
    }

    #[test]
    fn blob_names_must_be_64_lowercase_hex() {
        let conn = migrated();
        let dir = TempDir::new("blob-names");
        let good = "a".repeat(64);
        for bad in [
            "A".repeat(64),
            "a".repeat(63),
            "a".repeat(65),
            "../x".to_string(),
            "a/b".to_string(),
            String::new(),
        ] {
            assert!(blob_relative_path(&bad).is_none());
            assert!(matches!(blob_exists(&dir.0, &bad), Err(BlobError::BadName)));
            assert!(matches!(read_blob(&dir.0, &bad), Err(BlobError::BadName)));
            assert!(matches!(
                materials_with_sha(&conn, &bad),
                Err(BlobError::BadName)
            ));
        }
        assert_eq!(blob_relative_path(&good).unwrap(), format!("blobs/{good}"));
    }

    #[test]
    fn put_then_read_round_trips() {
        let dir = TempDir::new("blob-rt");
        let data = b"%PDF-1.7 synthetic".to_vec();
        let sha = sha_of(&data);
        let out = put_blob(&dir.0, &data[..], Some(&sha)).unwrap();
        assert_eq!(
            out,
            PutOutcome::Written {
                sha256: sha.clone(),
                bytes: data.len() as u64
            }
        );
        assert!(blob_exists(&dir.0, &sha).unwrap());
        assert_eq!(read_blob(&dir.0, &sha).unwrap(), data);
        assert!(matches!(
            put_blob(&dir.0, &data[..], None).unwrap(),
            PutOutcome::AlreadyPresent { .. }
        ));
        assert!(!blob_exists(&dir.0, &"0".repeat(64)).unwrap());
        assert!(matches!(
            read_blob(&dir.0, &"0".repeat(64)),
            Err(BlobError::Missing)
        ));
    }

    #[test]
    fn over_cap_is_refused_before_writing() {
        let dir = TempDir::new("blob-cap");
        let src = dir.0.join("big.bin");
        let f = std::fs::File::create(&src).unwrap();
        f.set_len(CAP + 1).unwrap();
        drop(f);
        let sync = dir.0.join("sync");
        assert!(matches!(
            put_blob_from_file(&sync, &src, None),
            Err(BlobError::TooLarge)
        ));
        assert!(names(&sync.join("blobs")).is_empty());
        assert!(matches!(
            put_blob(&sync, std::io::repeat(0).take(CAP + 1), None),
            Err(BlobError::TooLarge)
        ));
        assert!(names(&sync.join("blobs")).is_empty());
        let out = put_blob(&sync, std::io::repeat(0).take(CAP), None).unwrap();
        assert!(matches!(out, PutOutcome::Written { bytes, .. } if bytes == CAP));
    }

    #[test]
    fn existing_blob_is_never_rewritten() {
        let dir = TempDir::new("blob-once");
        let data = b"same bytes".to_vec();
        let sha = sha_of(&data);
        put_blob(&dir.0, &data[..], None).unwrap();
        let path = dir.0.join("blobs").join(&sha);
        let before = std::fs::metadata(&path).unwrap();
        #[cfg(unix)]
        let inode = std::os::unix::fs::MetadataExt::ino(&before);
        std::thread::sleep(std::time::Duration::from_millis(20));
        let out = put_blob(&dir.0, &data[..], Some(&sha)).unwrap();
        assert!(matches!(out, PutOutcome::AlreadyPresent { .. }));
        let after = std::fs::metadata(&path).unwrap();
        assert_eq!(before.modified().unwrap(), after.modified().unwrap());
        #[cfg(unix)]
        assert_eq!(inode, std::os::unix::fs::MetadataExt::ino(&after));
        assert_eq!(names(&dir.0.join("blobs")), vec![sha]);
    }

    #[test]
    fn corrupt_existing_blob_is_repaired() {
        let dir = TempDir::new("blob-repair");
        let data = b"good bytes".to_vec();
        let sha = sha_of(&data);
        std::fs::create_dir_all(dir.0.join("blobs")).unwrap();
        std::fs::write(dir.0.join("blobs").join(&sha), b"rotten").unwrap();
        let out = put_blob(&dir.0, &data[..], Some(&sha)).unwrap();
        assert!(matches!(out, PutOutcome::Written { .. }));
        assert_eq!(read_blob(&dir.0, &sha).unwrap(), data);
        assert_eq!(names(&dir.0.join("blobs")), vec![sha]);
    }

    #[test]
    fn sha_mismatch_on_read_is_refused() {
        let dir = TempDir::new("blob-read-bad");
        let data = b"some bytes".to_vec();
        let sha = sha_of(&data);
        put_blob(&dir.0, &data[..], None).unwrap();
        let path = dir.0.join("blobs").join(&sha);
        let mut flipped = data.clone();
        flipped[0] ^= 1;
        std::fs::write(&path, &flipped).unwrap();
        let mut sink = Vec::new();
        assert!(matches!(
            read_blob_into(&dir.0, &sha, &mut sink),
            Err(BlobError::ShaMismatch)
        ));
        assert_eq!(sink, flipped);
        std::fs::write(&path, &data).unwrap();
        let other = "b".repeat(64);
        std::fs::rename(&path, dir.0.join("blobs").join(&other)).unwrap();
        assert!(matches!(
            read_blob(&dir.0, &other),
            Err(BlobError::ShaMismatch)
        ));
    }

    #[test]
    fn expected_sha_mismatch_on_put_is_refused() {
        let dir = TempDir::new("blob-put-bad");
        let data = b"abc".to_vec();
        let wrong = "c".repeat(64);
        assert!(matches!(
            put_blob(&dir.0, &data[..], Some(&wrong)),
            Err(BlobError::ShaMismatch)
        ));
        assert!(names(&dir.0.join("blobs")).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_blob_is_refused() {
        let dir = TempDir::new("blob-link");
        let data = b"linked".to_vec();
        let sha = sha_of(&data);
        std::fs::create_dir_all(dir.0.join("blobs")).unwrap();
        let real = dir.0.join("real.bin");
        std::fs::write(&real, &data).unwrap();
        let path = dir.0.join("blobs").join(&sha);
        std::os::unix::fs::symlink(&real, &path).unwrap();
        assert!(matches!(read_blob(&dir.0, &sha), Err(BlobError::NotAFile)));
        assert!(matches!(
            put_blob(&dir.0, &data[..], None),
            Err(BlobError::NotAFile)
        ));
        assert!(!blob_exists(&dir.0, &sha).unwrap());
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(matches!(read_blob(&dir.0, &sha), Err(BlobError::NotAFile)));
        let src_link = dir.0.join("src-link");
        std::os::unix::fs::symlink(&real, &src_link).unwrap();
        assert!(matches!(
            put_blob_from_file(&dir.0, &src_link, None),
            Err(BlobError::NotAFile)
        ));
        assert_eq!(names(&dir.0.join("blobs")), vec![sha]);
    }

    #[test]
    fn failed_put_leaves_no_temp_file() {
        struct Failing(usize);
        impl Read for Failing {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.0 >= 1024 {
                    return Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe));
                }
                let n = buf.len().min(1024 - self.0);
                buf[..n].fill(7);
                self.0 += n;
                Ok(n)
            }
        }
        let dir = TempDir::new("blob-fail");
        assert!(matches!(
            put_blob(&dir.0, Failing(0), None),
            Err(BlobError::Io(_))
        ));
        assert!(names(&dir.0.join("blobs")).is_empty());
    }

    #[test]
    fn material_lookup_reports_no_file_unverified_and_ready() {
        let conn = migrated();
        let sha = sha_of(b"x");
        material(&conn, "m-none", None, None);
        material(&conn, "m-blank", Some("  "), None);
        material(&conn, "m-raw", Some("m-raw.pdf"), None);
        material(&conn, "m-ok", Some("m-ok.pdf"), Some(&sha));
        material(&conn, "m-ok2", Some("m-ok2.pdf"), Some(&sha));
        assert!(material_blob(&conn, "nope").unwrap().is_none());
        assert!(matches!(
            material_blob(&conn, "m-none").unwrap(),
            Some(MaterialBlob::NoFile)
        ));
        assert!(matches!(
            material_blob(&conn, "m-blank").unwrap(),
            Some(MaterialBlob::NoFile)
        ));
        assert!(matches!(
            material_blob(&conn, "m-raw").unwrap(),
            Some(MaterialBlob::Unverified { relative_path }) if relative_path == "m-raw.pdf"
        ));
        match material_blob(&conn, "m-ok").unwrap() {
            Some(MaterialBlob::Ready(f)) => {
                assert_eq!(f.material_id, "m-ok");
                assert_eq!(f.relative_path, "m-ok.pdf");
                assert_eq!(f.content_sha256, sha);
            }
            _ => panic!("expected ready"),
        }
        assert_eq!(materials_with_sha(&conn, &sha).unwrap(), ["m-ok", "m-ok2"]);
        assert!(materials_with_sha(&conn, &"d".repeat(64))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn publish_reads_the_pdf_from_documents() {
        let (conn, app, sync) = setup(b"pdf one");
        let sha = sha_of(b"pdf one");
        let out = publish_material_blob(&conn, &app.0, &sync.0, "m-1").unwrap();
        assert!(matches!(out, Some(PutOutcome::Written { .. })));
        assert_eq!(read_blob(&sync.0, &sha).unwrap(), b"pdf one");
        assert!(publish_material_blob(&conn, &app.0, &sync.0, "nope")
            .unwrap()
            .is_none());
        material(&conn, "m-raw", Some("m-raw.pdf"), None);
        assert!(matches!(
            publish_material_blob(&conn, &app.0, &sync.0, "m-raw"),
            Err(BlobError::NoIdentity)
        ));
        // Edited since it was checked.
        let sync2 = TempDir::new("blob-sync2");
        std::fs::write(app.0.join("documents/m-1.pdf"), b"pdf two").unwrap();
        assert!(matches!(
            publish_material_blob(&conn, &app.0, &sync2.0, "m-1"),
            Err(BlobError::ShaMismatch)
        ));
        assert!(names(&sync2.0.join("blobs")).is_empty());
        material(&conn, "m-bad", Some("../m.pdf"), Some(&sha));
        assert!(matches!(
            publish_material_blob(&conn, &app.0, &sync2.0, "m-bad"),
            Err(BlobError::BadMaterialPath)
        ));
    }

    #[test]
    fn place_writes_a_missing_pdf_once() {
        let (conn, app, sync) = setup(b"pdf one");
        let docs = app.0.join("documents");
        let sha = sha_of(b"pdf one");
        std::fs::remove_file(docs.join("m-1.pdf")).unwrap();
        assert_eq!(
            place_material_blob(&conn, &app.0, &sync.0, "m-1").unwrap(),
            Some(PlaceOutcome::NotYetAvailable)
        );
        assert!(names(&docs).is_empty());
        put_blob(&sync.0, &b"pdf one"[..], Some(&sha)).unwrap();
        assert_eq!(
            place_material_blob(&conn, &app.0, &sync.0, "m-1").unwrap(),
            Some(PlaceOutcome::Placed { bytes: 7 })
        );
        assert_eq!(std::fs::read(docs.join("m-1.pdf")).unwrap(), b"pdf one");
        assert_eq!(names(&docs), vec!["m-1.pdf"]);
        assert_eq!(
            place_material_blob(&conn, &app.0, &sync.0, "m-1").unwrap(),
            Some(PlaceOutcome::AlreadyPresent)
        );
        assert!(place_material_blob(&conn, &app.0, &sync.0, "nope")
            .unwrap()
            .is_none());
    }

    #[test]
    fn place_never_overwrites_a_different_local_file() {
        let (conn, app, sync) = setup(b"pdf one");
        let docs = app.0.join("documents");
        put_blob(&sync.0, &b"pdf one"[..], None).unwrap();
        std::fs::write(docs.join("m-1.pdf"), b"mine").unwrap();
        assert!(matches!(
            place_material_blob(&conn, &app.0, &sync.0, "m-1"),
            Err(BlobError::LocalFileDiffers)
        ));
        assert_eq!(std::fs::read(docs.join("m-1.pdf")).unwrap(), b"mine");
        assert_eq!(names(&docs), vec!["m-1.pdf"]);
        #[cfg(unix)]
        {
            let elsewhere = docs.join("other.pdf");
            std::fs::write(&elsewhere, b"pdf one").unwrap();
            std::fs::remove_file(docs.join("m-1.pdf")).unwrap();
            std::os::unix::fs::symlink(&elsewhere, docs.join("m-1.pdf")).unwrap();
            assert!(matches!(
                place_material_blob(&conn, &app.0, &sync.0, "m-1"),
                Err(BlobError::LocalFileDiffers)
            ));
            assert_eq!(std::fs::read(&elsewhere).unwrap(), b"pdf one");
        }
    }

    #[test]
    fn place_loses_a_race_to_a_new_local_file_without_overwriting() {
        let (conn, app, sync) = setup(b"pdf one");
        let docs = app.0.join("documents");
        put_blob(&sync.0, &b"pdf one"[..], None).unwrap();
        std::fs::remove_file(docs.join("m-1.pdf")).unwrap();
        let target = docs.join("m-1.pdf");
        let res = place_material_blob_with(
            &conn,
            &app.0,
            &sync.0,
            "m-1",
            |sha, sink| read_blob_into(&sync.0, sha, sink),
            || std::fs::write(&target, b"raced").unwrap(),
        );
        assert!(matches!(res, Err(BlobError::LocalFileDiffers)));
        assert_eq!(std::fs::read(&target).unwrap(), b"raced");
        assert_eq!(names(&docs), vec!["m-1.pdf"]);
    }

    #[test]
    fn place_treats_an_unreadable_blob_as_not_yet_available() {
        let (conn, app, sync) = setup(b"pdf one");
        let docs = app.0.join("documents");
        put_blob(&sync.0, &b"pdf one"[..], None).unwrap();
        std::fs::remove_file(docs.join("m-1.pdf")).unwrap();
        let res = place_material_blob_with(
            &conn,
            &app.0,
            &sync.0,
            "m-1",
            |_, _| Err(BlobError::Io(std::io::ErrorKind::TimedOut)),
            || {},
        );
        assert_eq!(res.unwrap(), Some(PlaceOutcome::NotYetAvailable));
        assert!(names(&docs).is_empty());
        let res = place_material_blob_with(
            &conn,
            &app.0,
            &sync.0,
            "m-1",
            |_, _| Err(BlobError::ShaMismatch),
            || {},
        );
        assert!(matches!(res, Err(BlobError::ShaMismatch)));
        assert!(names(&docs).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn place_refuses_a_path_outside_documents() {
        let (conn, app, sync) = setup(b"pdf one");
        let docs = app.0.join("documents");
        let outside = TempDir::new("blob-outside");
        std::os::unix::fs::symlink(&outside.0, docs.join("sub")).unwrap();
        material(&conn, "m-2", Some("sub/m-2.pdf"), Some(&sha_of(b"pdf one")));
        put_blob(&sync.0, &b"pdf one"[..], None).unwrap();
        assert!(matches!(
            place_material_blob(&conn, &app.0, &sync.0, "m-2"),
            Err(BlobError::BadMaterialPath)
        ));
        assert!(names(&outside.0).is_empty());
    }

    #[test]
    fn error_messages_name_no_path() {
        let errors = [
            BlobError::BadName,
            BlobError::TooLarge,
            BlobError::ShaMismatch,
            BlobError::NotAFile,
            BlobError::Missing,
            BlobError::NoIdentity,
            BlobError::BadMaterialPath,
            BlobError::LocalFileDiffers,
            BlobError::Io(std::io::ErrorKind::NotFound),
            BlobError::Db(rusqlite::Error::QueryReturnedNoRows),
        ];
        for e in errors {
            let text = e.to_string();
            for bad in ["/", "\\", ".pdf", ".tmp", "blobs"] {
                assert!(!text.contains(bad), "{text}");
            }
            assert!(!text.split_whitespace().any(is_blob_name), "{text}");
        }
    }
}

mod send {
    use super::*;
    use crate::phone_work::PHONE_WORK_FILE;
    use crate::sync::apply::apply_change_file;
    use crate::sync::blobs::{place_material_blob, put_blob, PlaceOutcome};
    use crate::sync::bootstrap::bootstrap_in;
    use crate::sync::export::{exported_through_seq, set_exported_through_seq};
    use crate::sync::send::{
        remove_stale_temps, send_locked, send_phone_progress_in, SentPhoneProgress, PROGRESS_FILE,
    };
    use sha2::{Digest, Sha256};
    use std::path::{Path, PathBuf};

    pub(super) const DEVICE: &str = "aaaaaaaa-2222-4333-8444-555555555555";
    pub(super) const BEFORE: &str = "2026-11-01T00:00:00.000Z";

    pub(super) struct Phone {
        pub(super) root: TempDir,
        pub(super) docs: PathBuf,
    }

    impl Phone {
        pub(super) fn db(&self) -> Connection {
            let c = Connection::open(self.root.0.join("her-flight-deck.db")).unwrap();
            c.pragma_update(None, "foreign_keys", "ON").unwrap();
            c
        }
        pub(super) fn send(&self) -> Result<SentPhoneProgress, String> {
            send_locked(&self.root.0, &self.docs, "0.0.0-test", NOW)
        }
        pub(super) fn file(&self) -> PathBuf {
            self.docs.join(PROGRESS_FILE)
        }
        pub(super) fn outbox(&self) -> Vec<String> {
            let dir = self
                .root
                .0
                .join("outbox")
                .join(crate::sync::changeset::folder(DEVICE));
            let mut v: Vec<String> = std::fs::read_dir(dir)
                .map(|rd| {
                    rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            v.sort();
            v
        }
        fn baseline(&self) -> String {
            std::fs::read_to_string(self.root.0.join(PHONE_WORK_FILE)).unwrap_or_default()
        }
    }

    /// A phone: migrated database on disk, its own id, ledger already seeded,
    /// and a baseline from the last Mac copy.
    pub(super) fn phone() -> Phone {
        static PHONES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = PHONES.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let root = TempDir::new(&format!("send-root-{n}"));
        let docs = root.0.join("docs-out");
        std::fs::write(
            root.0.join(PHONE_WORK_FILE),
            format!("{{\"baselineAt\":\"{BEFORE}\"}}"),
        )
        .unwrap();
        let mut conn = Connection::open(root.0.join("her-flight-deck.db")).unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
            [DEVICE],
        )
        .unwrap();
        bootstrap_in(&root.0, &mut conn, true, BEFORE).unwrap();
        Phone { root, docs }
    }

    pub(super) fn sha_of(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    pub(super) fn add_bookmark(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO study_materials (id,title,created_at,updated_at) VALUES ('m1','a',?1,?1)",
            [NOW],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES (?1,'m1',1,'t',?2,?2)",
            params![id, NOW],
        )
        .unwrap();
    }

    pub(super) fn add_pdf(p: &Phone, id: &str, name: &str, bytes: &[u8], identity: bool) {
        std::fs::create_dir_all(p.root.0.join("documents")).unwrap();
        std::fs::write(p.root.0.join("documents").join(name), bytes).unwrap();
        let conn = p.db();
        conn.execute(
            "INSERT INTO study_materials (id,title,file_path,created_at,updated_at) VALUES (?1,'T',?2,?3,?3)",
            params![id, name, NOW],
        )
        .unwrap();
        if identity {
            conn.execute(
                "INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at) VALUES (?1, ?2, 1, ?3)",
                params![id, sha_of(bytes), NOW],
            )
            .unwrap();
        }
    }

    pub(super) fn entries(path: &Path) -> Vec<String> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        let mut v: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        v.sort();
        v
    }

    pub(super) fn read_entry(path: &Path, name: &str) -> Vec<u8> {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        let mut out = Vec::new();
        zip.by_name(name).unwrap().read_to_end(&mut out).unwrap();
        out
    }

    pub(super) fn manifest(path: &Path) -> Value {
        serde_json::from_slice(&read_entry(path, "manifest.json")).unwrap()
    }

    fn unsaved(p: &Phone) -> i64 {
        let w = crate::phone_work::unsaved_phone_work_in(&p.root.0).unwrap();
        w.reviews + w.tests + w.bookmarks + w.reading_positions + w.materials
    }

    #[test]
    fn a_send_writes_one_file_in_documents_with_the_store_layout() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 one", true);
        let sent = p.send().unwrap();
        assert!(!sent.nothing_new);
        assert_eq!((sent.pdfs_included, sent.pdfs_left), (1, 0));
        assert!(sent.file_bytes > 0);
        let names = entries(&p.file());
        let change = format!("changes/{DEVICE}/{}", p.outbox()[0]);
        assert_eq!(
            names,
            vec![
                "blobs/".to_string() + &sha_of(b"%PDF-1.7 one"),
                change,
                "manifest.json".to_string()
            ]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
        );
        let m = manifest(&p.file());
        assert_eq!(m["kind"], "phoneProgress");
        assert_eq!(m["platform"], "ios");
        assert_eq!(m["deviceId"], DEVICE);
        // Only the one file in Documents, no temps, no staging.
        let left: Vec<_> = std::fs::read_dir(&p.docs)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec![PROGRESS_FILE.to_string()]);
        assert!(!std::fs::read_dir(&p.root.0).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".progress-staging")));
        assert_eq!(unsaved(&p), 0);
    }

    #[test]
    fn the_zip_is_the_s3c_contract() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let pdf = b"%PDF-1.7 contract";
        add_pdf(&p, "m2", "m2.pdf", pdf, true);
        p.send().unwrap();
        let m = manifest(&p.file());
        let mut mac = migrated();
        let sync = TempDir::new("send-contract");
        for name in m["files"].as_array().unwrap() {
            let name = name.as_str().unwrap();
            let bytes = read_entry(&p.file(), &format!("changes/{DEVICE}/{name}"));
            let parsed = decode(&bytes, name, SCHEMA, NOW).unwrap();
            apply_change_file(&mut mac, name, &parsed, NOW).unwrap();
        }
        let sha = sha_of(pdf);
        let blob = read_entry(&p.file(), &format!("blobs/{sha}"));
        put_blob(&sync.0, &blob[..], Some(&sha)).unwrap();
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM material_bookmarks"), 1);
        let app = TempDir::new("send-contract-app");
        std::fs::create_dir_all(app.0.join("documents")).unwrap();
        let placed = place_material_blob(&mac, &app.0, &sync.0, "m2");
        assert!(
            matches!(placed, Ok(Some(PlaceOutcome::Placed { .. }))),
            "{placed:?}"
        );
    }

    #[test]
    fn a_second_send_adds_a_second_file_and_the_zip_holds_both() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        p.send().unwrap();
        add_bookmark(&p.db(), "b2");
        let sent = p.send().unwrap();
        assert!(!sent.nothing_new);
        assert_eq!(sent.counts.bookmarks, 1);
        assert_eq!(p.outbox().len(), 2);
        let m = manifest(&p.file());
        assert_eq!(m["files"].as_array().unwrap().len(), 2);
        assert_eq!(
            m["fromSeq"].as_i64().unwrap(),
            1.max(m["fromSeq"].as_i64().unwrap())
        );
    }

    #[test]
    fn nothing_new_leaves_the_file_alone() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        p.send().unwrap();
        let before = std::fs::read(p.file()).unwrap();
        let mtime = std::fs::metadata(p.file()).unwrap().modified().unwrap();
        let again = p.send().unwrap();
        assert!(again.nothing_new);
        assert_eq!(std::fs::read(p.file()).unwrap(), before);
        assert_eq!(
            std::fs::metadata(p.file()).unwrap().modified().unwrap(),
            mtime
        );
        assert_eq!(p.outbox().len(), 1);
    }

    #[test]
    fn a_deleted_file_is_rebuilt_from_the_outbox_and_still_noted_as_sent() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        p.send().unwrap();
        std::fs::remove_file(p.file()).unwrap();
        let again = p.send().unwrap();
        assert!(!again.nothing_new);
        assert!(p.file().is_file());
        assert_eq!(p.outbox().len(), 1);
        assert!(p.baseline().contains("progressSentAt"));
    }

    #[test]
    fn nothing_to_send_at_all_changes_nothing() {
        let p = phone();
        let before = p.baseline();
        let sent = p.send().unwrap();
        assert!(sent.nothing_new);
        assert!(!p.file().exists());
        assert_eq!(p.baseline(), before);
    }

    #[test]
    fn a_send_starts_after_the_sync_floor() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        add_bookmark(&p.db(), "b2");
        let top = count(&p.db(), "SELECT MAX(seq) FROM local_changes");
        p.db()
            .execute(
                "INSERT INTO app_metadata (key, value) VALUES ('sync_floor_seq', ?1)",
                [(top - 1).to_string()],
            )
            .unwrap();
        p.send().unwrap();
        assert_eq!(p.outbox().len(), 1);
        assert!(
            p.outbox()[0].starts_with(&format!("{top}-")),
            "{:?}",
            p.outbox()
        );
    }

    #[test]
    fn a_restore_clears_the_old_outbox() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let other = p
            .root
            .0
            .join("outbox/changes/bbbbbbbb-2222-4333-8444-555555555555");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("1-1-abcdefabcdef.json.gz"), b"old").unwrap();
        p.send().unwrap();
        assert!(!other.exists());
        assert_eq!(p.outbox().len(), 1);
    }

    #[test]
    fn the_watermark_moves_only_after_the_file_is_durable() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        // The Documents folder is a plain file: the zip cannot be written.
        std::fs::write(&p.docs, b"not a folder").unwrap();
        let before = p.baseline();
        assert!(p.send().is_err());
        assert_eq!(p.baseline(), before, "baseline must not move");
        assert!(unsaved(&p) > 0);
        std::fs::remove_file(&p.docs).unwrap();
        // Simulated crash: the outbox file was written but the watermark never moved.
        let wm = exported_through_seq(&p.db()).unwrap();
        assert!(wm >= 1, "the failed send exported once");
        set_exported_through_seq(&p.db(), 0).unwrap();
        p.db()
            .execute(
                "DELETE FROM app_metadata WHERE key='exported_through_seq'",
                [],
            )
            .unwrap();
        let sent = p.send().unwrap();
        assert!(!sent.nothing_new);
        let names = p.outbox();
        let mut froms: Vec<&str> = names.iter().map(|n| n.split('-').next().unwrap()).collect();
        froms.dedup();
        assert_eq!(froms.len(), names.len(), "one file per from_seq: {names:?}");
        assert_eq!(unsaved(&p), 0);
    }

    #[test]
    fn a_failed_send_leaves_the_old_file_and_the_baseline_alone() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        p.send().unwrap();
        let old = std::fs::read(p.file()).unwrap();
        add_bookmark(&p.db(), "b2");
        p.db()
            .execute(
                "UPDATE material_bookmarks SET updated_at = '2026-11-05T00:00:00.000Z' WHERE id = 'b2'",
                [],
            )
            .unwrap();
        let before = p.baseline();
        // An unreadable outbox file makes the build fail part-way.
        use std::os::unix::fs::PermissionsExt;
        let first = p
            .root
            .0
            .join("outbox")
            .join(crate::sync::changeset::folder(DEVICE))
            .join(&p.outbox()[0]);
        std::fs::set_permissions(&first, std::fs::Permissions::from_mode(0o000)).unwrap();
        let failed = p.send();
        std::fs::set_permissions(&first, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(failed.is_err());
        assert_eq!(p.baseline(), before);
        assert_eq!(std::fs::read(p.file()).unwrap(), old);
        assert!(unsaved(&p) > 0);
        // Next time it works and both files are in.
        assert!(!p.send().unwrap().nothing_new);
        assert_eq!(manifest(&p.file())["files"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn an_unchecked_pdf_is_left_behind_not_fatal() {
        let p = phone();
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 unchecked", false);
        add_pdf(&p, "m3", "m3.pdf", b"%PDF-1.7 checked", true);
        let sent = p.send().unwrap();
        assert_eq!((sent.pdfs_included, sent.pdfs_left), (1, 1));
        assert!(p.file().is_file());
        assert_eq!(entries(&p.file()).len(), 3);
    }

    #[test]
    fn two_materials_sharing_one_pdf_make_one_entry() {
        let p = phone();
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 same", true);
        add_pdf(&p, "m3", "m3.pdf", b"%PDF-1.7 same", true);
        let sent = p.send().unwrap();
        assert_eq!((sent.pdfs_included, sent.pdfs_left), (2, 0));
        let blobs: Vec<_> = entries(&p.file())
            .into_iter()
            .filter(|n| n.starts_with("blobs/"))
            .collect();
        assert_eq!(blobs.len(), 1);
    }

    #[test]
    fn stale_temps_older_than_a_day_are_removed_and_fresh_ones_kept() {
        let p = phone();
        std::fs::create_dir_all(&p.docs).unwrap();
        let old_stage = p.root.0.join(".progress-staging-1-1");
        let new_stage = p.root.0.join(".progress-staging-2-2");
        let old_tmp = p.docs.join(".My phone progress-1-1.writing");
        let new_tmp = p.docs.join(".My phone progress-2-2.writing");
        let other = p.docs.join("keep-me.txt");
        for d in [&old_stage, &new_stage] {
            std::fs::create_dir_all(d.join("blobs")).unwrap();
        }
        for f in [&old_tmp, &new_tmp, &other] {
            std::fs::write(f, b"x").unwrap();
        }
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3 * 86_400);
        std::fs::File::open(&old_stage)
            .unwrap()
            .set_modified(old)
            .unwrap();
        std::fs::File::options()
            .write(true)
            .open(&old_tmp)
            .unwrap()
            .set_modified(old)
            .unwrap();
        std::fs::File::options()
            .write(true)
            .open(&other)
            .unwrap()
            .set_modified(old)
            .unwrap();
        remove_stale_temps(&p.root.0, &p.docs, std::time::SystemTime::now());
        assert!(!old_stage.exists() && new_stage.exists());
        assert!(!old_tmp.exists() && new_tmp.exists());
        assert!(other.exists());
    }

    #[test]
    fn send_errors_name_no_path() {
        let empty = TempDir::new("send-empty");
        let docs = empty.0.join("docs");
        let e = send_locked(&empty.0, &docs, "0.0.0-test", NOW).unwrap_err();
        assert!(!e.contains("Mac"), "{e}");
        let p = phone();
        add_bookmark(&p.db(), "b1");
        std::fs::write(&p.docs, b"x").unwrap();
        let e = p.send().unwrap_err();
        for banned in [
            "/", "sync", "merge", "conflict", "Mac", "outbox", "ledger", "sqlite",
        ] {
            assert!(!e.to_lowercase().contains(&banned.to_lowercase()), "{e}");
        }
        // No device id yet.
        let q = phone();
        q.db()
            .execute("DELETE FROM app_metadata WHERE key = 'device_id'", [])
            .unwrap();
        let e = q.send().unwrap_err();
        assert!(e.contains("isn't ready"), "{e}");
    }

    #[test]
    fn counts_match_the_kinds_table() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        add_bookmark(&p.db(), "b2");
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 c", true);
        let before = crate::phone_work::unsaved_phone_work_in(&p.root.0).unwrap();
        let sent = p.send().unwrap();
        assert_eq!(sent.counts.bookmarks, before.bookmarks);
        assert_eq!(sent.counts.materials, before.materials);
        assert_eq!(sent.counts.reviews, before.reviews);
    }

    #[test]
    fn a_send_seeds_the_ledger_first_when_prepare_never_ran() {
        let root = TempDir::new("send-unprepared");
        let docs = root.0.join("docs-out");
        std::fs::write(
            root.0.join(PHONE_WORK_FILE),
            format!("{{\"baselineAt\":\"{BEFORE}\"}}"),
        )
        .unwrap();
        let conn = Connection::open(root.0.join("her-flight-deck.db")).unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
            [DEVICE],
        )
        .unwrap();
        // Pre-ledger phone work: present without any ledger row.
        conn.execute_batch("DROP TRIGGER IF EXISTS trg_sync_study_materials_insert;")
            .ok();
        conn.execute(
            "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('old1','a',?1,?1)",
            [NOW],
        )
        .unwrap();
        conn.execute("DELETE FROM local_changes", []).unwrap();
        conn.execute("DELETE FROM sync_row_meta", []).unwrap();
        drop(conn);
        let sent = send_locked(&root.0, &docs, "0.0.0-test", NOW).unwrap();
        assert!(!sent.nothing_new);
        assert_eq!(sent.counts.materials, 1);
        let m = manifest(&docs.join(PROGRESS_FILE));
        assert_eq!(m["files"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_send_after_a_restore_keeps_the_earlier_progress_file() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        p.send().unwrap();
        let first = std::fs::read(p.file()).unwrap();
        // A restore: new identity, floor moved, watermark gone.
        let top = count(&p.db(), "SELECT MAX(seq) FROM local_changes");
        let other = "cccccccc-2222-4333-8444-555555555555";
        let c = p.db();
        c.execute(
            "UPDATE app_metadata SET value = ?1 WHERE key = 'device_id'",
            [other],
        )
        .unwrap();
        c.execute(
            "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_floor_seq', ?1)",
            [top.to_string()],
        )
        .unwrap();
        c.execute(
            "DELETE FROM app_metadata WHERE key = 'exported_through_seq'",
            [],
        )
        .unwrap();
        drop(c);
        add_bookmark(&p.db(), "b2");
        p.send().unwrap();
        let kept = p
            .docs
            .join("My phone progress (before 4 Nov 2026).hfdprogress");
        assert_eq!(std::fs::read(&kept).unwrap(), first);
        assert_eq!(manifest(&p.file())["deviceId"], other);
    }

    #[test]
    fn a_watermark_ahead_of_the_log_refuses_without_changes() {
        let p = phone();
        add_bookmark(&p.db(), "b1");
        set_exported_through_seq(&p.db(), 9999).unwrap();
        let before = p.baseline();
        assert!(p.send().is_err());
        assert_eq!(p.baseline(), before);
        assert!(!p.file().exists());
    }

    #[test]
    fn a_second_send_at_the_same_time_is_refused() {
        let p = phone();
        let _held = crate::sync::send::hold_for_test();
        let e = send_phone_progress_in(&p.root.0, &p.docs, "0.0.0-test", NOW).unwrap_err();
        assert_eq!(e, "Already sending. Try again in a moment.");
    }

    #[test]
    fn bootstrap_after_a_restore_seeds_nothing_and_marks_done() {
        let root = TempDir::new("send-restored");
        std::fs::write(
            root.0.join(PHONE_WORK_FILE),
            format!("{{\"baselineAt\":\"{NOW}\"}}"),
        )
        .unwrap();
        let mut conn = migrated();
        conn.execute(
            "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('r1','a',?1,?1)",
            [BEFORE],
        )
        .unwrap();
        conn.execute("DELETE FROM local_changes", []).unwrap();
        conn.execute("DELETE FROM sync_row_meta", []).unwrap();
        let out = bootstrap_in(&root.0, &mut conn, true, NOW).unwrap();
        assert_eq!(out.seeded, 0);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM app_metadata WHERE key='sync_bootstrapped'"
            ),
            1
        );
    }

    #[test]
    fn the_pdf_sentence_inputs_survive_a_sent_status() {
        let p = phone();
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 u", false);
        let sent = p.send().unwrap();
        assert!(!sent.nothing_new && sent.pdfs_left == 1);
        // A left-out PDF keeps the work counted as not saved.
        assert!(unsaved(&p) > 0);
    }
}

mod accept {
    use super::apply::MAC;
    use super::progress::{archive, mac_db, mac_root, manifest as backup_manifest, run, snapshot};
    use super::send::{add_bookmark, add_pdf, entries, phone, read_entry, sha_of, Phone, DEVICE};
    use super::*;
    use crate::sync::progress::{PhoneProgress, ProgressOutcome};
    use std::path::PathBuf;

    /// Sends from the phone and returns the name of the file that appeared.
    fn send_new(p: &Phone) -> String {
        let before = p.outbox();
        p.send().unwrap();
        p.outbox()
            .into_iter()
            .find(|n| !before.contains(n))
            .expect("a new file")
    }

    fn change_bytes(p: &Phone, name: &str) -> Vec<u8> {
        let folder = crate::sync::changeset::folder(DEVICE);
        std::fs::read(p.root.0.join("outbox").join(folder).join(name)).unwrap()
    }

    /// Every PDF entry the phone's current progress file carries.
    fn blob_entries(p: &Phone) -> Vec<(String, Vec<u8>)> {
        entries(&p.file())
            .into_iter()
            .filter(|n| n.starts_with("blobs/"))
            .map(|n| {
                let bytes = read_entry(&p.file(), &n);
                (n, bytes)
            })
            .collect()
    }

    /// A progress file listing exactly `files`, with `extra` entries beside them.
    fn progress_zip(
        dir: &TempDir,
        p: &Phone,
        files: &[&str],
        extra: &[(String, Vec<u8>)],
        edit: impl FnOnce(&mut Value),
    ) -> PathBuf {
        let mut m: Value = serde_json::from_slice(&read_entry(&p.file(), "manifest.json")).unwrap();
        m["files"] = json!(files);
        edit(&mut m);
        let path = dir.0.join("My phone progress.hfdprogress");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(m.to_string().as_bytes()).unwrap();
        for name in files {
            zip.start_file(format!("changes/{DEVICE}/{name}"), opts)
                .unwrap();
            zip.write_all(&change_bytes(p, name)).unwrap();
        }
        for (name, bytes) in extra {
            zip.start_file(name.as_str(), opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    fn applied(conn: &Connection) -> i64 {
        count(conn, "SELECT COUNT(*) FROM sync_applied")
    }

    const BANNED: [&str; 12] = [
        "sync",
        "merge",
        "conflict",
        "export",
        "ledger",
        "change file",
        "device",
        "blob",
        "outbox",
        "import",
        "ingest",
        "hfd-progress",
    ];

    fn assert_plain(text: &str) {
        let lower = text.to_lowercase();
        assert!(!text.contains('/') && !text.contains('\\'), "{text}");
        for word in BANNED {
            assert!(!lower.contains(word), "{word} in {text}");
        }
    }

    fn leftovers() -> usize {
        std::fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&format!("hfd-progress-{}-", std::process::id()))
            })
            .count()
    }

    #[test]
    fn a_progress_file_brings_in_the_phones_work() {
        let dir = TempDir::new("accept-a");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let got = run(&root, &progress_zip(&dir, &p, &[&name], &[], |_| {})).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!((got.counts.bookmarks, got.counts.materials), (1, 1));
        assert!(got.phone_saved_at.is_some());
        let mac = mac_db(&root);
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM material_bookmarks"), 1);
        assert_eq!(
            count(
                &mac,
                &format!("SELECT COUNT(*) FROM sync_applied WHERE peer_device='{DEVICE}' AND file_name='{name}'")
            ),
            1
        );
    }

    #[test]
    fn the_same_progress_file_twice_is_already_in() {
        let dir = TempDir::new("accept-b");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let path = progress_zip(&dir, &p, &[&name], &[], |_| {});
        run(&root, &path).unwrap();
        let before = snapshot(&mac_db(&root));
        let again = run(&root, &path).unwrap();
        assert_eq!(again.outcome, ProgressOutcome::AlreadyIn);
        assert_eq!(again.counts.bookmarks, 0);
        assert_eq!(snapshot(&mac_db(&root)), before);
    }

    #[test]
    fn a_second_send_with_more_work_adds_only_the_new_file() {
        let dir = TempDir::new("accept-c");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let first = send_new(&p);
        run(&root, &progress_zip(&dir, &p, &[&first], &[], |_| {})).unwrap();
        add_bookmark(&p.db(), "b2");
        let second = send_new(&p);
        let got = run(
            &root,
            &progress_zip(&dir, &p, &[&first, &second], &[], |_| {}),
        )
        .unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!((got.counts.bookmarks, got.counts.materials), (1, 0));
        assert_eq!(applied(&mac_db(&root)), 2);
    }

    #[test]
    fn a_pdf_arrives_on_a_later_import_of_the_same_file() {
        let dir = TempDir::new("accept-d");
        let root = mac_root();
        let p = phone();
        let pdf = b"%PDF-1.7 later";
        add_pdf(&p, "m2", "m2.pdf", pdf, true);
        let name = send_new(&p);
        let blobs = blob_entries(&p);
        assert_eq!(blobs.len(), 1);
        let first = run(&root, &progress_zip(&dir, &p, &[&name], &[], |_| {})).unwrap();
        assert_eq!(first.outcome, ProgressOutcome::Added);
        assert_eq!((first.pdfs_added, first.pdfs_waiting), (0, 1));
        let second = run(&root, &progress_zip(&dir, &p, &[&name], &blobs, |_| {})).unwrap();
        assert_eq!(second.outcome, ProgressOutcome::AlreadyIn);
        assert_eq!((second.pdfs_added, second.pdfs_waiting), (1, 0));
        let placed = std::fs::read(root.0.join("documents").join("m2.pdf")).unwrap();
        assert_eq!(sha_of(&placed), sha_of(pdf));
    }

    #[test]
    fn two_materials_sharing_one_pdf_are_both_placed() {
        let dir = TempDir::new("accept-e");
        let root = mac_root();
        let p = phone();
        let pdf = b"%PDF-1.7 shared";
        add_pdf(&p, "m2", "a.pdf", pdf, true);
        add_pdf(&p, "m3", "b.pdf", pdf, true);
        let name = send_new(&p);
        let blobs = blob_entries(&p);
        assert_eq!(blobs.len(), 1);
        let got = run(&root, &progress_zip(&dir, &p, &[&name], &blobs, |_| {})).unwrap();
        assert_eq!((got.pdfs_added, got.pdfs_waiting), (2, 0));
        assert!(root.0.join("documents").join("a.pdf").is_file());
        assert!(root.0.join("documents").join("b.pdf").is_file());
    }

    #[test]
    fn a_file_from_this_mac_is_refused() {
        let dir = TempDir::new("accept-f");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let path = progress_zip(&dir, &p, &[&name], &[], |m| m["deviceId"] = json!(MAC));
        let e = run(&root, &path).unwrap_err();
        assert_eq!(e, "That file was made on this Mac.");
        assert_eq!(applied(&mac_db(&root)), 0);
    }

    #[test]
    fn a_newer_app_file_is_refused() {
        let dir = TempDir::new("accept-g");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let newer =
            "That file was made by a newer version of the app. Update the app on this Mac first.";
        let schema = progress_zip(&dir, &p, &[&name], &[], |m| {
            m["schemaVersion"] = json!(SCHEMA + 1)
        });
        assert_eq!(run(&root, &schema).unwrap_err(), newer);
        let format = progress_zip(&dir, &p, &[&name], &[], |m| m["formatVersion"] = json!(2));
        assert_eq!(run(&root, &format).unwrap_err(), newer);
        let none = progress_zip(&dir, &p, &[&name], &[], |m| {
            m.as_object_mut().unwrap().remove("formatVersion");
        });
        let e = run(&root, &none).unwrap_err();
        assert!(e.starts_with("That file couldn't be read"), "{e}");
        assert_eq!(applied(&mac_db(&root)), 0);
    }

    #[test]
    fn an_older_schema_file_is_taken() {
        let dir = TempDir::new("accept-h");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let path = progress_zip(&dir, &p, &[&name], &[], |m| {
            m["schemaVersion"] = json!(SCHEMA - 1)
        });
        assert_eq!(run(&root, &path).unwrap().outcome, ProgressOutcome::Added);
    }

    #[test]
    fn an_empty_list_is_nothing_new() {
        let dir = TempDir::new("accept-i");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        send_new(&p);
        let got = run(&root, &progress_zip(&dir, &p, &[], &[], |_| {})).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::NothingNew);
    }

    #[test]
    fn a_bad_change_file_changes_nothing() {
        let dir = TempDir::new("accept-j");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let first = send_new(&p);
        add_bookmark(&p.db(), "b2");
        let second = send_new(&p);
        // Same listing, the second file's bytes damaged.
        let mut bad = change_bytes(&p, &second);
        let mid = bad.len() / 2;
        bad[mid] ^= 0xff;
        let folder = crate::sync::changeset::folder(DEVICE);
        std::fs::write(p.root.0.join("outbox").join(&folder).join(&second), &bad).unwrap();
        let path = progress_zip(&dir, &p, &[&first, &second], &[], |_| {});
        let e = run(&root, &path).unwrap_err();
        assert!(e.starts_with("That file couldn't be read"), "{e}");
        assert_eq!(applied(&mac_db(&root)), 0);
        assert_eq!(
            count(&mac_db(&root), "SELECT COUNT(*) FROM study_materials"),
            0
        );
    }

    #[test]
    fn a_stop_partway_keeps_the_earlier_file_and_resumes() {
        let dir = TempDir::new("accept-k");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let first = send_new(&p);
        // The material m2 arrives in `middle`, its bookmark in `last`.
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 k", true);
        let middle = send_new(&p);
        p.db()
            .execute(
                "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('b9','m2',1,'t',?1,?1)",
                [NOW],
            )
            .unwrap();
        let last = send_new(&p);
        let path = progress_zip(&dir, &p, &[&first, &last], &[], |_| {});
        let e = run(&root, &path).unwrap_err();
        assert!(e.starts_with("Some of that file was brought in"), "{e}");
        assert_plain(&e);
        assert_eq!(applied(&mac_db(&root)), 1);
        let path = progress_zip(&dir, &p, &[&first, &middle, &last], &[], |_| {});
        let got = run(&root, &path).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!((got.counts.bookmarks, got.counts.materials), (1, 1));
        assert_eq!(applied(&mac_db(&root)), 3);
    }

    #[test]
    fn a_stop_still_places_the_pdfs_of_earlier_files() {
        let dir = TempDir::new("accept-l");
        let root = mac_root();
        let p = phone();
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 l", true);
        let first = send_new(&p);
        let blobs = blob_entries(&p);
        add_pdf(&p, "m3", "m3.pdf", b"%PDF-1.7 skipped", true);
        let _skipped = send_new(&p);
        p.db()
            .execute(
                "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('b9','m3',1,'t',?1,?1)",
                [NOW],
            )
            .unwrap();
        let last = send_new(&p);
        let path = progress_zip(&dir, &p, &[&first, &last], &[], |_| {});
        run(&root, &path).unwrap_err();
        // Nothing was lost: the first file is in; its PDF has not come yet.
        let path = progress_zip(&dir, &p, &[&first, &last], &blobs, |_| {});
        let e = run(&root, &path).unwrap_err();
        assert!(e.starts_with("Some of that file was brought in"), "{e}");
        assert!(root.0.join("documents").join("m2.pdf").is_file());
    }

    #[test]
    fn zip_entries_outside_the_manifest_are_ignored() {
        let dir = TempDir::new("accept-m");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let extra = vec![
            ("../x".to_string(), b"x".to_vec()),
            (
                "changes/other/1-1-abcdefabcdef.json.gz".to_string(),
                b"x".to_vec(),
            ),
            ("blobs/notahash".to_string(), b"x".to_vec()),
        ];
        let path = progress_zip(&dir, &p, &[&name], &extra, |_| {});
        assert_eq!(run(&root, &path).unwrap().outcome, ProgressOutcome::Added);
        assert!(!root.0.join("../x").exists());
        let mut found: Vec<String> = std::fs::read_dir(&root.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        found.sort();
        assert!(
            found.iter().all(|n| n.starts_with("her-flight-deck.db")),
            "{found:?}"
        );
    }

    #[test]
    fn an_oversized_entry_is_refused_before_any_write() {
        let dir = TempDir::new("accept-n");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let first = send_new(&p);
        add_bookmark(&p.db(), "b2");
        let second = send_new(&p);
        let path = progress_zip(&dir, &p, &[&first, &second], &[], |_| {});
        // Rebuild with the second entry far over the cap.
        let mut zipped = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let mut m: Value = serde_json::from_slice(&read_entry(&p.file(), "manifest.json")).unwrap();
        m["files"] = json!([first, second]);
        zipped.start_file("manifest.json", opts).unwrap();
        zipped.write_all(m.to_string().as_bytes()).unwrap();
        zipped
            .start_file(format!("changes/{DEVICE}/{first}"), opts)
            .unwrap();
        zipped.write_all(&change_bytes(&p, &first)).unwrap();
        zipped
            .start_file(format!("changes/{DEVICE}/{second}"), opts)
            .unwrap();
        let chunk = vec![0u8; 1024 * 1024];
        for _ in 0..65 {
            zipped.write_all(&chunk).unwrap();
        }
        zipped.finish().unwrap();
        let e = run(&root, &path).unwrap_err();
        assert!(e.starts_with("That file couldn't be read"), "{e}");
        assert_eq!(applied(&mac_db(&root)), 0);
    }

    #[test]
    fn a_backup_file_still_takes_the_old_path() {
        let dir = TempDir::new("accept-o");
        let root = mac_root();
        let (phone_db, _) = super::apply::every_rule_peer(super::apply::PHONE);
        let got = run(&root, &archive(&dir, &phone_db, backup_manifest(), &[])).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
    }

    #[test]
    fn a_progress_file_after_a_backup_of_the_same_work_adds_nothing() {
        let dir = TempDir::new("accept-p");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let backup = archive(&dir, &p.db(), backup_manifest(), &[]);
        let got = run(&root, &backup).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        let before = snapshot(&mac_db(&root));
        let name = send_new(&p);
        let got: PhoneProgress =
            run(&root, &progress_zip(&dir, &p, &[&name], &[], |_| {})).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::NothingNew);
        assert_eq!(
            count(&mac_db(&root), "SELECT COUNT(*) FROM material_bookmarks"),
            1
        );
        let after = snapshot(&mac_db(&root));
        let strip = |v: Vec<String>| -> Vec<String> {
            v.into_iter()
                .filter(|r| !r.starts_with("sync_applied:"))
                .collect()
        };
        assert_eq!(strip(after), strip(before));
    }
    #[test]
    fn accept_errors_name_no_path_and_no_banned_word() {
        let dir = TempDir::new("accept-q");
        let root = mac_root();
        let p = phone();
        add_bookmark(&p.db(), "b1");
        let name = send_new(&p);
        let cases = vec![
            progress_zip(&dir, &p, &[&name], &[], |m| m["deviceId"] = json!(MAC)),
            progress_zip(&dir, &p, &[&name], &[], |m| m["formatVersion"] = json!(2)),
            progress_zip(&dir, &p, &[&name], &[], |m| {
                m["files"] = json!([name, name])
            }),
            progress_zip(&dir, &p, &[&name], &[], |m| {
                m["files"] = json!(["../evil.json.gz"])
            }),
            progress_zip(&dir, &p, &[&name], &[], |m| {
                m["files"] = json!(["9-9-abcdefabcdef.json.gz"])
            }),
        ];
        for path in cases {
            let e = run(&root, &path).unwrap_err();
            assert_plain(&e);
        }
        let mut stopped = String::new();
        stopped.push_str("Some of that file was brought in, then it stopped. What's here is safe. Keep the file \u{2014} a later update may take the rest.");
        assert_plain(&stopped);
        let platform = progress_zip(&dir, &p, &[&name], &[], |m| m["platform"] = json!("macos"));
        // Existing sentences for a file that is not from the phone say "backup".
        assert!(run(&root, &platform)
            .unwrap_err()
            .contains("not made on the phone"));
    }

    #[test]
    fn the_temp_root_is_removed_on_every_path() {
        let dir = TempDir::new("accept-r");
        let root = mac_root();
        let p = phone();
        add_pdf(&p, "m2", "m2.pdf", b"%PDF-1.7 r", true);
        let name = send_new(&p);
        let blobs = blob_entries(&p);
        run(&root, &progress_zip(&dir, &p, &[&name], &blobs, |_| {})).unwrap();
        let bad = progress_zip(&dir, &p, &[&name], &[], |m| m["deviceId"] = json!(MAC));
        run(&root, &bad).unwrap_err();
        for _ in 0..40 {
            if leftovers() == 0 {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("a temp folder was left behind");
    }
}

mod mac_send {
    use super::apply::MAC;
    use super::progress::mac_root;
    use super::send::{entries, manifest, phone, read_entry, sha_of, Phone};
    use super::*;
    use crate::sync::apply::apply_change_file;
    use crate::sync::export::export_changes_in;
    use crate::sync::send::{
        change_stream_mark, remove_stale_temps_for, restart_change_stream, send_mac_changes_in,
        send_mac_changes_locked, SentChanges, Side, MAC_FILE,
    };
    use std::path::PathBuf;

    pub(super) const COPY_FIRST: &str =
        "Send a full copy to your iPhone first; after that only changes are sent.";

    pub(super) struct MacApp {
        pub(super) root: TempDir,
        pub(super) out: PathBuf,
    }

    pub(super) fn mac_app() -> MacApp {
        let root = mac_root();
        let out = root.0.join("icloud");
        MacApp { root, out }
    }

    impl MacApp {
        pub(super) fn db(&self) -> Connection {
            let c = Connection::open(self.root.0.join("her-flight-deck.db")).unwrap();
            c.pragma_update(None, "foreign_keys", "ON").unwrap();
            c
        }
        pub(super) fn send(&self) -> Result<SentChanges, String> {
            send_mac_changes_locked(&self.root.0, &self.out, "0.0.0-test", NOW)
        }
        pub(super) fn file(&self) -> PathBuf {
            self.out.join(MAC_FILE)
        }
        pub(super) fn outbox_dir(&self) -> PathBuf {
            self.root
                .0
                .join("outbox")
                .join(crate::sync::changeset::folder(MAC))
        }
        /// A full copy was made: the stream restarts after the newest change.
        pub(super) fn mark_copy(&self) -> i64 {
            let mark = change_stream_mark(&self.root.0).unwrap();
            restart_change_stream(&self.root.0, mark).unwrap();
            mark
        }
        pub(super) fn material(&self, id: &str, title: &str) {
            self.db()
                .execute(
                    "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES (?1,?2,?3,?3)",
                    params![id, title, NOW],
                )
                .unwrap();
        }
        /// Gives the phone what a full copy holds, then restarts the stream.
        pub(super) fn copy_to(&self, p: &Phone) -> i64 {
            let mark = change_stream_mark(&self.root.0).unwrap();
            let mut conn = self.db();
            if let Some(exp) = export_changes_in(&mut conn, MAC, 0, "0.0.0-test", NOW).unwrap() {
                let parsed = decode(&exp.file.bytes, &exp.file.file_name, SCHEMA, NOW).unwrap();
                let mut phone_db = p.db();
                apply_change_file(&mut phone_db, &exp.file.file_name, &parsed, NOW).unwrap();
                phone_db.execute("DELETE FROM sync_applied", []).unwrap();
            }
            // A restored phone's change log holds the copy's: numbers up to the mark.
            let have: i64 = p
                .db()
                .query_row("SELECT COALESCE(MAX(seq), 0) FROM local_changes", [], |r| {
                    r.get(0)
                })
                .unwrap();
            for seq in (have + 1)..=mark {
                p.db()
                    .execute(
                        "INSERT INTO local_changes (seq, table_name, row_id, op, changed_at) VALUES (?1, 'study_materials', 'copied', 'insert', ?2)",
                        params![seq, OLD],
                    )
                    .unwrap();
            }
            p.db()
                .execute(
                    "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_floor_seq', ?1)",
                    [mark.to_string()],
                )
                .unwrap();
            // A restore notes which Mac the copy came from.
            p.db()
                .execute(
                    "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_copy_from_device', ?1)",
                    [MAC],
                )
                .unwrap();
            restart_change_stream(&self.root.0, mark).unwrap();
            mark
        }
    }

    #[test]
    fn a_mac_send_writes_one_file_with_the_store_layout() {
        let mac = mac_app();
        mac.material("m1", "Before the copy");
        let mark = mac.mark_copy();
        mac.material("m2", "After the copy");
        let sent = mac.send().unwrap();
        assert!(!sent.nothing_new);
        assert_eq!(sent.counts.materials, 1);
        assert_eq!(sent.file_name, MAC_FILE);
        let m = manifest(&mac.file());
        assert_eq!(m["kind"], "macChanges");
        assert_eq!(m["platform"], "macos");
        assert_eq!(m["deviceId"], MAC);
        assert_eq!(m["fromSeq"].as_i64().unwrap(), mark + 1);
        let names = entries(&mac.file());
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.contains(&"manifest.json".to_string()));
        assert!(names
            .iter()
            .any(|n| n.starts_with(&format!("changes/{MAC}/"))));
        let left: Vec<_> = std::fs::read_dir(&mac.out)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec![MAC_FILE.to_string()]);
    }

    #[test]
    fn a_mac_with_no_copy_refuses_changes() {
        let mac = mac_app();
        mac.material("m1", "x");
        assert_eq!(mac.send().unwrap_err(), COPY_FIRST);
        assert!(!mac.file().exists());
    }

    #[test]
    fn a_full_copy_restarts_the_stream() {
        let mac = mac_app();
        mac.material("m1", "x");
        mac.mark_copy();
        mac.material("m2", "y");
        mac.send().unwrap();
        assert!(mac.outbox_dir().is_dir());
        mac.material("m3", "z");
        let mark = mac.mark_copy();
        assert!(!mac.outbox_dir().exists());
        assert_eq!(
            crate::sync::export::exported_through_seq(&mac.db()).unwrap(),
            mark
        );
        mac.material("m4", "w");
        let sent = mac.send().unwrap();
        assert_eq!(sent.counts.materials, 1);
        assert_eq!(manifest(&mac.file())["fromSeq"].as_i64().unwrap(), mark + 1);
    }

    #[test]
    fn a_change_during_the_copy_still_arrives() {
        let mac = mac_app();
        mac.material("m1", "x");
        // The mark is read before the copy starts; this change lands during it.
        let mark = change_stream_mark(&mac.root.0).unwrap();
        mac.material("m5", "during");
        restart_change_stream(&mac.root.0, mark).unwrap();
        let sent = mac.send().unwrap();
        assert_eq!(sent.counts.materials, 1);
    }

    #[test]
    fn nothing_new_leaves_the_mac_file_alone() {
        let mac = mac_app();
        mac.mark_copy();
        let first = mac.send().unwrap();
        assert!(first.nothing_new);
        assert!(!mac.file().exists());
        mac.material("m2", "y");
        mac.send().unwrap();
        let before = std::fs::read(mac.file()).unwrap();
        let again = mac.send().unwrap();
        assert!(again.nothing_new);
        assert_eq!(std::fs::read(mac.file()).unwrap(), before);
    }

    #[test]
    fn a_missing_mac_file_is_written_again_and_reported() {
        let mac = mac_app();
        mac.mark_copy();
        mac.material("m2", "y");
        mac.send().unwrap();
        std::fs::remove_file(mac.file()).unwrap();
        let again = mac.send().unwrap();
        assert!(!again.nothing_new);
        assert!(mac.file().exists());
    }

    #[test]
    fn a_mac_pdf_travels_as_a_blob() {
        let mac = mac_app();
        mac.mark_copy();
        let pdf = b"%PDF-1.7 from the mac";
        std::fs::create_dir_all(mac.root.0.join("documents")).unwrap();
        std::fs::write(mac.root.0.join("documents").join("m9.pdf"), pdf).unwrap();
        mac.db()
            .execute(
                "INSERT INTO study_materials (id,title,file_path,created_at,updated_at) VALUES ('m9','T','m9.pdf',?1,?1)",
                [NOW],
            )
            .unwrap();
        mac.db()
            .execute(
                "INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at) VALUES ('m9', ?1, 1, ?2)",
                params![sha_of(pdf), NOW],
            )
            .unwrap();
        let sent = mac.send().unwrap();
        assert_eq!((sent.pdfs_included, sent.pdfs_left), (1, 0));
        let sha = sha_of(pdf);
        assert_eq!(read_entry(&mac.file(), &format!("blobs/{sha}")), pdf);
    }

    #[test]
    fn mac_send_errors_name_no_path() {
        let empty = TempDir::new("mac-send-empty");
        let e =
            send_mac_changes_locked(&empty.0, &empty.0.join("out"), "0.0.0-test", NOW).unwrap_err();
        assert_eq!(
            e,
            "This Mac's study library couldn't be opened. Close and open the app, then try again."
        );
        let mac = mac_app();
        let held = crate::sync::send::hold_for_test();
        let busy = send_mac_changes_in(&mac.root.0, &mac.out, "0.0.0-test", NOW).unwrap_err();
        drop(held);
        assert_eq!(busy, "Already sending. Try again in a moment.");
        for text in [e, busy, COPY_FIRST.to_string()] {
            assert!(!text.contains('/') && !text.contains('\\'), "{text}");
            let lower = text.to_lowercase();
            for word in ["sync", "ledger", "outbox", "device", "blob", "export"] {
                assert!(!lower.contains(word), "{word} in {text}");
            }
        }
    }

    #[test]
    fn stale_temps_are_swept_by_side_prefix() {
        let root = TempDir::new("mac-send-stale");
        let out = root.0.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let mine = out.join(".Changes from my Mac-1.writing");
        let phones = out.join(".My phone progress-1.writing");
        std::fs::write(&mine, b"x").unwrap();
        std::fs::write(&phones, b"x").unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(3 * 86_400);
        remove_stale_temps_for(Side::Mac, &root.0, &out, later);
        assert!(!mine.exists());
        assert!(phones.exists());
    }

    #[test]
    fn an_unknown_earlier_file_is_kept_not_replaced() {
        let mac = mac_app();
        mac.mark_copy();
        std::fs::create_dir_all(&mac.out).unwrap();
        std::fs::write(mac.file(), b"not a zip").unwrap();
        mac.material("m2", "y");
        mac.send().unwrap();
        let names: Vec<String> = std::fs::read_dir(&mac.out)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names
            .iter()
            .any(|n| n.starts_with("Changes from my Mac (before ")));
        let _ = phone;
    }
}

mod phone_accept {
    use super::apply::MAC;
    use super::mac_send::{mac_app, MacApp};
    use super::progress::{mac_db, mac_root};
    use super::send::{phone, Phone, DEVICE};
    use super::*;
    use crate::sync::progress::{import_mac_changes_in, import_phone_progress_in, ProgressOutcome};

    const NOT_YET: &str = "Put your study material on this phone first: on the Mac, Settings \u{2192} Send to my iPhone \u{2192} Send a full copy instead.";
    const NEEDS_EARLIER: &str = "That file needs earlier changes from your Mac that aren't on this phone yet. On the Mac, send a full copy instead.";
    const SEND_FIRST: &str = "This phone has work that isn't saved anywhere else yet. Send my progress to the Mac first, then get the Mac's changes.";

    /// A Mac with materials m1 and m2, and a phone that holds its full copy.
    fn setup() -> (MacApp, Phone) {
        let mac = mac_app();
        mac.material("m1", "One");
        mac.material("m2", "Two");
        let p = phone();
        mac.copy_to(&p);
        (mac, p)
    }

    fn accept(p: &Phone, mac: &MacApp) -> Result<crate::sync::progress::MacChanges, String> {
        import_mac_changes_in(&p.root.0, &mac.file(), Some(DEVICE), NOW)
    }

    fn unsaved(p: &Phone) -> i64 {
        let w = crate::phone_work::unsaved_phone_work_in(&p.root.0).unwrap();
        w.reviews
            + w.tests
            + w.bookmarks
            + w.reading_positions
            + w.materials
            + w.guides
            + w.generated_tests
    }

    fn bookmark(conn: &Connection, id: &str, material: &str) {
        conn.execute(
            "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES (?1,?2,1,'t',?3,?3)",
            params![id, material, NOW],
        )
        .unwrap();
    }

    fn has(conn: &Connection, table: &str, key: &str, id: &str) -> bool {
        count(
            conn,
            &format!("SELECT COUNT(*) FROM {table} WHERE {key} = '{id}'"),
        ) == 1
    }

    #[test]
    fn a_changes_file_brings_in_the_macs_work() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        let before = count(&p.db(), "SELECT COUNT(*) FROM local_changes");
        let got = accept(&p, &mac).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!(got.counts.materials, 1);
        assert!(got.mac_saved_at.is_some());
        assert!(has(&p.db(), "study_materials", "id", "m3"));
        assert_eq!(count(&p.db(), "SELECT COUNT(*) FROM sync_applied"), 1);
        assert_eq!(count(&p.db(), "SELECT COUNT(*) FROM local_changes"), before);
    }

    #[test]
    fn the_same_file_twice_is_already_in() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        let again = accept(&p, &mac).unwrap();
        assert_eq!(again.outcome, ProgressOutcome::AlreadyIn);
        assert_eq!(again.counts.materials, 0);
    }

    #[test]
    fn a_phone_without_a_copy_is_refused() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        p.db()
            .execute("DELETE FROM app_metadata WHERE key = 'sync_floor_seq'", [])
            .unwrap();
        assert_eq!(accept(&p, &mac).unwrap_err(), NOT_YET);
        assert!(!has(&p.db(), "study_materials", "id", "m3"));
        assert_eq!(count(&p.db(), "SELECT COUNT(*) FROM sync_applied"), 0);
    }

    #[test]
    fn a_gap_is_refused() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        p.db()
            .execute(
                "UPDATE app_metadata SET value = '0' WHERE key = 'sync_floor_seq'",
                [],
            )
            .unwrap();
        assert_eq!(accept(&p, &mac).unwrap_err(), NEEDS_EARLIER);
        assert!(!has(&p.db(), "study_materials", "id", "m3"));
    }

    #[test]
    fn a_gap_after_an_applied_file_is_refused() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        // A second file that skips a change number: its zip lists only itself.
        mac.material("m4", "Four");
        mac.send().unwrap();
        mac.material("m5", "Five");
        let conn = mac.db();
        let hole = conn
            .query_row("SELECT MAX(seq) FROM local_changes", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap();
        // Move the watermark past m5 without exporting it.
        crate::sync::export::set_exported_through_seq(&conn, hole).unwrap();
        mac.material("m6", "Six");
        mac.send().unwrap();
        let got = accept(&p, &mac);
        assert_eq!(got.unwrap_err(), NEEDS_EARLIER);
        assert!(!has(&p.db(), "study_materials", "id", "m6"));
    }

    #[test]
    fn overlap_below_the_floor_writes_nothing() {
        let (mac, p) = setup();
        // Re-send everything the copy already holds.
        crate::sync::export::set_exported_through_seq(&mac.db(), 0).unwrap();
        mac.send().unwrap();
        let got = accept(&p, &mac).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::NothingNew);
        assert_eq!(got.counts.materials, 0);
        assert!(has(&p.db(), "study_materials", "id", "m1"));
    }

    #[test]
    fn a_phone_file_on_the_phone_is_wrong_side() {
        let (_, p) = setup();
        bookmark(&p.db(), "b1", "m1");
        p.send().unwrap();
        let other = phone();
        let e =
            import_mac_changes_in(&other.root.0, &p.file(), Some("zzzz-other"), NOW).unwrap_err();
        assert_eq!(
            e,
            "That file was made on an iPhone. Choose the file from your Mac."
        );
    }

    #[test]
    fn a_mac_file_on_the_mac_is_wrong_side() {
        let (mac, _p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        let other = mac_root();
        let e = import_phone_progress_in(
            &other.0,
            &mac.file(),
            Some("dddd-other-mac"),
            "0.0.0-test",
            NOW,
        )
        .unwrap_err();
        assert_eq!(
            e,
            "That file holds changes from a Mac. Choose the file from your iPhone."
        );
        assert_eq!(
            count(&mac_db(&other), "SELECT COUNT(*) FROM sync_applied"),
            0
        );
    }

    #[test]
    fn cascade_delete_keeps_sent_phone_events_in_the_file_and_other_materials_intact() {
        let (mac, p) = setup();
        bookmark(&p.db(), "bm1", "m1");
        bookmark(&p.db(), "bm2", "m2");
        p.send().unwrap();
        let progress = std::fs::read(p.file()).unwrap();
        import_phone_progress_in(&mac.root.0, &p.file(), Some(MAC), "0.0.0-test", NOW).unwrap();
        mac.db()
            .execute("DELETE FROM study_materials WHERE id = 'm1'", [])
            .unwrap();
        mac.send().unwrap();
        let got = accept(&p, &mac).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!(got.counts.removed, 1);
        let db = p.db();
        assert!(!has(&db, "study_materials", "id", "m1"));
        assert!(!has(&db, "material_bookmarks", "id", "bm1"));
        assert!(has(&db, "study_materials", "id", "m2"));
        assert!(has(&db, "material_bookmarks", "id", "bm2"));
        // Her sent work is still in the file and on the Mac.
        assert_eq!(std::fs::read(p.file()).unwrap(), progress);
        let m = mac.db();
        assert_eq!(
            count(
                &m,
                &format!("SELECT COUNT(*) FROM sync_applied WHERE peer_device = '{DEVICE}'")
            ),
            1
        );
        assert!(has(&m, "material_bookmarks", "id", "bm2"));
    }

    #[test]
    fn cascade_delete_takes_review_events_but_keeps_the_sent_file() {
        let mac = mac_app();
        insert_graph(&mac.db(), "", OLD);
        mac.db()
            .execute(
                "UPDATE card_review_events SET generation = 1, scheduler_version = ?1",
                [crate::card_reviews::SCHEDULER_VERSION],
            )
            .unwrap();
        let p = phone();
        mac.copy_to(&p);
        p.db()
            .execute(
                "INSERT INTO card_review_events (id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES ('e2','i1',1,'good',?1,?2,'{}','{}')",
                params![NOW, crate::card_reviews::SCHEDULER_VERSION],
            )
            .unwrap();
        p.send().unwrap();
        let sent = std::fs::read(p.file()).unwrap();
        import_phone_progress_in(&mac.root.0, &p.file(), Some(MAC), "0.0.0-test", NOW).unwrap();
        assert!(has(&mac.db(), "card_review_events", "id", "e2"));
        mac.db()
            .execute("DELETE FROM study_materials WHERE id = 'm1'", [])
            .unwrap();
        mac.send().unwrap();
        let got = accept(&p, &mac).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        let db = p.db();
        assert!(!has(&db, "study_materials", "id", "m1"));
        assert!(!has(&db, "card_review_events", "id", "e1"));
        assert!(!has(&db, "card_review_events", "id", "e2"));
        assert_eq!(std::fs::read(p.file()).unwrap(), sent);
    }

    #[test]
    fn a_delete_is_refused_while_phone_work_is_unsent() {
        let (mac, p) = setup();
        mac.db()
            .execute("DELETE FROM study_materials WHERE id = 'm2'", [])
            .unwrap();
        mac.send().unwrap();
        bookmark(&p.db(), "bm1", "m1");
        assert_eq!(accept(&p, &mac).unwrap_err(), SEND_FIRST);
        assert!(has(&p.db(), "study_materials", "id", "m2"));
        assert_eq!(count(&p.db(), "SELECT COUNT(*) FROM sync_applied"), 0);
        p.send().unwrap();
        let got = accept(&p, &mac).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert!(!has(&p.db(), "study_materials", "id", "m2"));
    }

    #[test]
    fn a_child_tombstone_never_touches_another_parent() {
        let (mac, p) = setup();
        bookmark(&mac.db(), "ba", "m1");
        bookmark(&mac.db(), "bb", "m2");
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        // A real cascade: deleting m1 tombstones its bookmark too.
        mac.db()
            .execute("DELETE FROM study_materials WHERE id = 'm1'", [])
            .unwrap();
        assert_eq!(
            count(
                &mac.db(),
                "SELECT COUNT(*) FROM local_changes WHERE table_name = 'material_bookmarks' AND row_id = 'ba' AND op = 'delete'"
            ),
            1
        );
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        let db = p.db();
        assert!(!has(&db, "material_bookmarks", "id", "ba"));
        assert!(has(&db, "material_bookmarks", "id", "bb"));
        assert!(!has(&db, "study_materials", "id", "m1"));
        assert!(has(&db, "study_materials", "id", "m2"));
    }

    #[test]
    fn the_phones_newer_edit_wins_over_the_macs() {
        let (mac, p) = setup();
        mac.db()
            .execute(
                "UPDATE study_materials SET title = 'From Mac' WHERE id = 'm1'",
                [],
            )
            .unwrap();
        mac.send().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        p.db()
            .execute(
                "UPDATE study_materials SET title = 'From phone' WHERE id = 'm1'",
                [],
            )
            .unwrap();
        accept(&p, &mac).unwrap();
        let title: String = p
            .db()
            .query_row(
                "SELECT title FROM study_materials WHERE id = 'm1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "From phone");
    }

    #[test]
    fn macs_rows_are_not_unsaved_phone_work() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        assert!(has(&p.db(), "study_materials", "id", "m3"));
        assert_eq!(unsaved(&p), 0);
    }

    #[test]
    fn a_phone_edit_of_a_mac_row_is_unsaved() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        p.db()
            .execute(
                "UPDATE study_materials SET title = 'Mine' WHERE id = 'm3'",
                [],
            )
            .unwrap();
        assert_eq!(unsaved(&p), 1);
    }

    #[test]
    fn a_blocked_practice_delete_keeps_the_phones_attempts_on_the_phone() {
        let (mac, p) = {
            let mac = mac_app();
            mac.material("m1", "One");
            for table in [
                "practice_tests",
                "practice_test_versions",
                "practice_test_items",
            ] {
                let sql = ROWS.iter().find(|r| r.0 == table).unwrap().2;
                mac.db().execute(&graph_sql(sql, "", NOW), []).unwrap();
            }
            let p = phone();
            mac.copy_to(&p);
            (mac, p)
        };
        // The phone takes a test on that version and sends it.
        let attempt = ROWS.iter().find(|r| r.0 == "practice_attempts").unwrap().2;
        p.db().execute(&graph_sql(attempt, "", NOW), []).unwrap();
        p.send().unwrap();
        // The Mac deletes the version before it has seen the attempt.
        mac.db()
            .execute("DELETE FROM practice_test_versions WHERE id = 'pv1'", [])
            .unwrap();
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        let db = p.db();
        assert!(has(&db, "practice_test_versions", "id", "pv1"));
        assert!(has(&db, "practice_attempts", "id", "a1"));
        // The Mac skips the attempt: its parent is gone there.
        let _ = import_phone_progress_in(&mac.root.0, &p.file(), Some(MAC), "0.0.0-test", NOW);
        assert!(!has(&mac.db(), "practice_attempts", "id", "a1"));
    }

    #[test]
    fn a_stop_partway_keeps_the_earlier_file_and_resumes() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        // m4 is never exported; the second file's bookmark needs it.
        mac.material("m4", "Four");
        let hole: i64 = mac
            .db()
            .query_row("SELECT MAX(seq) FROM local_changes", [], |r| r.get(0))
            .unwrap();
        crate::sync::export::set_exported_through_seq(&mac.db(), hole).unwrap();
        bookmark(&mac.db(), "b9", "m4");
        mac.send().unwrap();
        // The phone is told its copy already covers the numbers between.
        p.db()
            .execute(
                "UPDATE app_metadata SET value = ?1 WHERE key = 'sync_floor_seq'",
                [hole.to_string()],
            )
            .unwrap();
        let e = accept(&p, &mac).unwrap_err();
        assert!(e.starts_with("Some of that file was brought in"), "{e}");
        assert!(has(&p.db(), "study_materials", "id", "m3"));
        assert!(!has(&p.db(), "material_bookmarks", "id", "b9"));
        assert_eq!(count(&p.db(), "SELECT COUNT(*) FROM sync_applied"), 1);
        // A later file that carries m4 lets the rest through.
        p.db()
            .execute(
                "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m4','Four',?1,?1)",
                [NOW],
            )
            .unwrap();
        let got = accept(&p, &mac).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert!(has(&p.db(), "material_bookmarks", "id", "b9"));
        assert_eq!(count(&p.db(), "SELECT COUNT(*) FROM sync_applied"), 2);
    }

    #[test]
    fn the_temp_root_is_removed_on_every_path() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        accept(&p, &mac).unwrap();
        let other = phone();
        accept(&other, &mac).unwrap_err();
        let me = format!("hfd-progress-{}-", std::process::id());
        for _ in 0..40 {
            let n = std::fs::read_dir(std::env::temp_dir())
                .unwrap()
                .filter(|e| {
                    e.as_ref()
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(&me)
                })
                .count();
            if n == 0 {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("a temp folder was left behind");
    }

    #[test]
    fn accept_errors_name_no_path() {
        let (mac, p) = setup();
        mac.material("m3", "Three");
        mac.send().unwrap();
        let other = phone();
        let texts = [
            accept(&other, &mac).unwrap_err(),
            import_mac_changes_in(&p.root.0, &p.root.0.join("missing"), Some(DEVICE), NOW)
                .unwrap_err(),
            NOT_YET.to_string(),
            NEEDS_EARLIER.to_string(),
            SEND_FIRST.to_string(),
        ];
        for text in texts {
            assert!(!text.contains('/') && !text.contains('\\'), "{text}");
            let lower = text.to_lowercase();
            for word in [
                "sync", "merge", "conflict", "export", "ledger", "outbox", "blob", "ingest",
            ] {
                assert!(!lower.contains(word), "{word} in {text}");
            }
        }
    }
}

mod prune {
    use super::apply::MAC;
    use super::mac_send::{mac_app, MacApp};
    use super::send::{phone, Phone, DEVICE};
    use super::*;
    use crate::sync::progress::{import_mac_changes_in, import_phone_progress_in, ProgressOutcome};
    use crate::sync::send::{applied_map, prune_files, prune_outbox, restart_change_stream};

    const NEEDS_EARLIER: &str = "That file needs earlier changes from your Mac that aren't on this phone yet. On the Mac, send a full copy instead.";

    fn setup() -> (MacApp, Phone) {
        let mac = mac_app();
        mac.material("m1", "One");
        let p = phone();
        mac.copy_to(&p);
        (mac, p)
    }

    fn accept(p: &Phone, mac: &MacApp) -> Result<crate::sync::progress::MacChanges, String> {
        import_mac_changes_in(&p.root.0, &mac.file(), Some(DEVICE), NOW)
    }

    /// The phone does one more thing and sends it; returns the new outbox file.
    fn phone_sends(p: &Phone, id: &str) {
        p.db()
            .execute(
                "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES (?1,'m1',1,'t',?2,?2)",
                params![id, NOW],
            )
            .unwrap();
        p.send().unwrap();
    }

    fn mac_takes(mac: &MacApp, p: &Phone) {
        import_phone_progress_in(&mac.root.0, &p.file(), Some(MAC), "0.0.0-test", NOW).unwrap();
    }

    fn mac_changes(mac: &MacApp, id: &str) {
        mac.material(id, "More");
        mac.send().unwrap();
    }

    fn applied_in(path: &std::path::Path) -> serde_json::Value {
        super::send::manifest(path)["applied"].clone()
    }

    #[test]
    fn the_phone_drops_what_the_mac_confirmed() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_changes(&mac, "m3");
        // Before the Mac has seen anything, its file confirms nothing.
        assert!(applied_in(&mac.file()).is_null());
        mac_takes(&mac, &p);
        // The Mac has no new change, only a new mark: the file is still rewritten.
        let again = mac.send().unwrap();
        assert!(again.nothing_new);
        assert_eq!(applied_in(&mac.file())[DEVICE].as_i64().unwrap(), p_to(&p));
        accept(&p, &mac).unwrap();
        assert!(p.outbox().is_empty());
        // The next send starts from what is left, and the Mac still takes it.
        phone_sends(&p, "b2");
        assert_eq!(p.outbox().len(), 1);
        let got =
            import_phone_progress_in(&mac.root.0, &p.file(), Some(MAC), "0.0.0-test", NOW).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!(got.counts.bookmarks, 1);
    }

    fn p_to(p: &Phone) -> i64 {
        let name = p.outbox().last().cloned().unwrap();
        crate::sync::changeset::parse_name(&name).unwrap().1
    }

    #[test]
    fn nothing_is_dropped_without_a_confirmation() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_changes(&mac, "m3");
        accept(&p, &mac).unwrap();
        assert_eq!(p.outbox().len(), 1);
    }

    #[test]
    fn a_hole_in_the_macs_applied_list_stops_pruning_there() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        phone_sends(&p, "b2");
        phone_sends(&p, "b3");
        let all = p.outbox();
        assert_eq!(all.len(), 3);
        mac_takes(&mac, &p);
        mac.db()
            .execute("DELETE FROM sync_applied WHERE file_name = ?1", [&all[1]])
            .unwrap();
        mac_changes(&mac, "m3");
        accept(&p, &mac).unwrap();
        assert_eq!(p.outbox(), all[1..].to_vec());
    }

    #[test]
    fn the_applied_map_skips_unparsable_names_and_bad_ids() {
        let mac = mac_app();
        let conn = mac.db();
        for (peer, name) in [
            (DEVICE, "1-5-aaaaaaaaaaaa.json.gz"),
            (DEVICE, "6-9-bbbbbbbbbbbb.json.gz"),
            (DEVICE, "nonsense"),
            (DEVICE, "20-30-cccccccccccc.json.gz"),
            ("BAD ID", "1-5-dddddddddddd.json.gz"),
        ] {
            conn.execute(
                "INSERT INTO sync_applied (peer_device, file_name, applied_at) VALUES (?1, ?2, ?3)",
                params![peer, name, NOW],
            )
            .unwrap();
        }
        let map = applied_map(&conn);
        assert_eq!(map.len(), 1);
        assert_eq!(map[DEVICE], (1, 9));
    }

    #[test]
    fn a_crash_mid_prune_only_leaves_more_files() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        phone_sends(&p, "b2");
        phone_sends(&p, "b3");
        let all = p.outbox();
        mac_takes(&mac, &p);
        let dir = p
            .root
            .0
            .join("outbox")
            .join(crate::sync::changeset::folder(DEVICE));
        let mut calls = 0;
        let removed = prune_files(&dir, 0, i64::MAX, |path| {
            calls += 1;
            if calls == 2 {
                return Err(std::io::Error::other("crash"));
            }
            std::fs::remove_file(path)
        });
        assert_eq!(removed, 1);
        assert_eq!(p.outbox(), all[1..].to_vec());
        // The next send rebuilds from what is left and the Mac takes it all.
        phone_sends(&p, "b4");
        let got =
            import_phone_progress_in(&mac.root.0, &p.file(), Some(MAC), "0.0.0-test", NOW).unwrap();
        assert_eq!(got.outcome, ProgressOutcome::Added);
        assert_eq!(got.counts.bookmarks, 1);
        assert_eq!(
            count(&mac.db(), "SELECT COUNT(*) FROM material_bookmarks"),
            4
        );
    }

    #[test]
    fn a_stop_partway_keeps_earlier_files() {
        let (_mac, p) = setup();
        phone_sends(&p, "b1");
        phone_sends(&p, "b2");
        phone_sends(&p, "b3");
        let all = p.outbox();
        let dir = p
            .root
            .0
            .join("outbox")
            .join(crate::sync::changeset::folder(DEVICE));
        let (_, first_to, _) = crate::sync::changeset::parse_name(&all[0]).unwrap();
        // Only the first file is confirmed: the pass ends there.
        assert_eq!(
            prune_files(&dir, 0, first_to, |p| std::fs::remove_file(p)),
            1
        );
        assert_eq!(p.outbox(), all[1..].to_vec());
        // A run that starts after the oldest file confirms nothing of it.
        assert_eq!(
            prune_files(&dir, i64::MAX, i64::MAX, |p| std::fs::remove_file(p)),
            0
        );
        assert_eq!(p.outbox(), all[1..].to_vec());
    }

    #[test]
    fn pruning_never_passes_the_phones_own_watermark() {
        let (_mac, p) = setup();
        phone_sends(&p, "b1");
        phone_sends(&p, "b2");
        let all = p.outbox();
        let (_, first_to, _) = crate::sync::changeset::parse_name(&all[0]).unwrap();
        let conn = p.db();
        crate::sync::export::set_exported_through_seq(&conn, first_to).unwrap();
        let manifest = serde_json::json!({
            "applied": { DEVICE: 1_000_000 },
            "appliedFrom": { DEVICE: 0 },
        });
        prune_outbox(&p.root.0, &conn, &manifest);
        assert_eq!(p.outbox(), all[1..].to_vec());
        // A manifest without the run's start confirms nothing.
        let partial = serde_json::json!({ "applied": { DEVICE: 1_000_000 } });
        prune_outbox(&p.root.0, &conn, &partial);
        assert_eq!(p.outbox(), all[1..].to_vec());
    }

    #[test]
    fn another_macs_file_is_refused_and_prunes_nothing() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        mac_changes(&mac, "m3");
        p.db()
            .execute(
                "UPDATE app_metadata SET value = 'someone-else' WHERE key = 'sync_copy_from_device'",
                [],
            )
            .unwrap();
        assert_eq!(accept(&p, &mac).unwrap_err(), NEEDS_EARLIER);
        // The phone restarts its own stream (S-6a3): the old outbox goes and
        // its work counts as unsaved until it is sent again and saved.
        assert!(p.outbox().is_empty());
        assert_eq!(
            count(
                &p.db(),
                "SELECT COUNT(*) FROM study_materials WHERE id = 'm3'"
            ),
            0
        );
    }

    #[test]
    fn a_phone_that_does_not_know_its_copys_mac_prunes_nothing() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        mac_changes(&mac, "m3");
        p.db()
            .execute(
                "DELETE FROM app_metadata WHERE key = 'sync_copy_from_device'",
                [],
            )
            .unwrap();
        accept(&p, &mac).unwrap();
        assert_eq!(p.outbox().len(), 1);
    }

    #[test]
    fn a_restore_notes_which_mac_the_copy_came_from() {
        let p = phone();
        p.db()
            .execute(
                "UPDATE app_metadata SET value = ?1 WHERE key = 'device_id'",
                [MAC],
            )
            .unwrap();
        crate::backup::reset_sync_identity(&p.root.0).unwrap();
        let db = p.db();
        let source: String = db
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'sync_copy_from_device'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(source, MAC);
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'device_id'"
            ),
            0
        );
        // A copy with no usable id leaves no stale source behind.
        db.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('device_id', 'Not Valid!')",
            [],
        )
        .unwrap();
        crate::backup::reset_sync_identity(&p.root.0).unwrap();
        assert_eq!(
            count(
                &p.db(),
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_copy_from_device'"
            ),
            0
        );
    }

    #[test]
    fn a_failed_source_save_leaves_the_device_id_untouched() {
        let p = phone();
        p.db()
            .execute(
                "UPDATE app_metadata SET value = ?1 WHERE key = 'device_id'",
                [MAC],
            )
            .unwrap();
        p.db()
            .execute_batch(
                "CREATE TRIGGER block_source BEFORE INSERT ON app_metadata
                 WHEN NEW.key = 'sync_copy_from_device'
                 BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
            )
            .unwrap();
        assert!(crate::backup::reset_sync_identity(&p.root.0).is_err());
        // Nothing half-done: the id is untouched, so the whole reset can rerun.
        assert_eq!(
            count(
                &p.db(),
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'device_id'"
            ),
            1
        );
    }

    #[test]
    fn a_running_send_makes_pruning_wait_for_the_next_file() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        mac_changes(&mac, "m3");
        crate::sync::send::tests_wait::NO_WAIT.with(|n| n.set(true));
        let busy = crate::sync::send::hold_for_test();
        accept(&p, &mac).unwrap();
        drop(busy);
        crate::sync::send::tests_wait::NO_WAIT.with(|n| n.set(false));
        assert_eq!(p.outbox().len(), 1);
        accept(&p, &mac).unwrap();
        assert!(p.outbox().is_empty());
    }

    #[test]
    fn a_mark_past_the_log_cannot_skip_changes() {
        let mac = mac_app();
        mac.material("m1", "One");
        let max: i64 = mac
            .db()
            .query_row("SELECT MAX(seq) FROM local_changes", [], |r| r.get(0))
            .unwrap();
        restart_change_stream(&mac.root.0, max + 1_000).unwrap();
        mac.material("m2", "Two");
        let sent = mac.send().unwrap();
        assert_eq!(sent.counts.materials, 1);
        assert_eq!(
            super::send::manifest(&mac.file())["fromSeq"]
                .as_i64()
                .unwrap(),
            max + 1
        );
    }

    #[test]
    fn the_temp_root_is_removed_on_every_path() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        mac_changes(&mac, "m3");
        accept(&p, &mac).unwrap();
        accept(&p, &mac).unwrap();
        let other = phone();
        accept(&other, &mac).unwrap_err();
        let me = format!("hfd-progress-{}-", std::process::id());
        for _ in 0..40 {
            let n = std::fs::read_dir(std::env::temp_dir())
                .unwrap()
                .filter(|e| {
                    e.as_ref()
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(&me)
                })
                .count();
            let docs_left = std::fs::read_dir(&p.docs)
                .map(|rd| {
                    rd.filter(|e| {
                        e.as_ref()
                            .unwrap()
                            .file_name()
                            .to_string_lossy()
                            .starts_with('.')
                    })
                    .count()
                })
                .unwrap_or(0);
            if n == 0 && docs_left == 0 {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        panic!("a temp folder was left behind");
    }

    fn restarted(p: &Phone) -> bool {
        count(
            &p.db(),
            "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_stream_restarted'",
        ) == 1
    }

    fn exported_mark(p: &Phone) -> i64 {
        count(
            &p.db(),
            "SELECT COUNT(*) FROM app_metadata WHERE key = 'exported_through_seq'",
        )
    }

    /// A second Mac (its own id) that has made one full copy and one change.
    fn other_mac() -> MacApp {
        let mac = mac_app();
        mac.db()
            .execute(
                "UPDATE app_metadata SET value = 'cccc-mac2' WHERE key = 'device_id'",
                [],
            )
            .unwrap();
        mac.material("m9", "Elsewhere");
        mac.mark_copy();
        mac.material("m10", "Later");
        mac.send().unwrap();
        mac
    }

    #[test]
    fn a_different_macs_file_restarts_the_phone_stream() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        mac_changes(&mac, "m3");
        accept(&p, &mac).unwrap();
        // The copy's Mac pruned everything the phone had sent.
        assert!(p.outbox().is_empty());
        phone_sends(&p, "b2");
        assert_eq!(exported_mark(&p), 1);
        let m2 = other_mac();
        assert_eq!(accept(&p, &m2).unwrap_err(), NEEDS_EARLIER);
        assert!(restarted(&p));
        assert_eq!(exported_mark(&p), 0);
        assert!(p.outbox().is_empty());
        assert!(crate::phone_work::refuse_unsaved(&p.root.0, true).is_err());
        // The next send starts at the copy's floor and holds all the work.
        let floor: i64 = p
            .db()
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key = 'sync_floor_seq'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        p.send().unwrap();
        let name = p.outbox().remove(0);
        assert_eq!(
            crate::sync::changeset::parse_name(&name).unwrap().0,
            floor + 1
        );
        // Sending is not saving: the work still counts, so a full copy that
        // would replace it is still refused.
        assert!(crate::phone_work::refuse_unsaved(&p.root.0, true).is_err());
        // A file from the first Mac that arrives after the re-send prunes nothing.
        mac_takes(&mac, &p);
        mac.send().unwrap();
        accept(&p, &mac).unwrap();
        assert_eq!(p.outbox().len(), 1);
        // Only saving the phone's work clears the count.
        crate::phone_work::record_saved_through_in(&p.root.0, NOW).unwrap();
        assert!(!restarted(&p));
        assert!(crate::phone_work::refuse_unsaved(&p.root.0, true).is_ok());
    }

    #[test]
    fn an_older_mac_that_refuses_the_resend_never_lets_the_work_be_wiped() {
        let (_mac, p) = setup();
        let m2 = other_mac();
        // The phone made work on a material from its own copy, which the
        // older second Mac does not have.
        p.db()
            .execute(
                "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('b5','m1',1,'t',?1,?1)",
                [NOW],
            )
            .unwrap();
        assert_eq!(accept(&p, &m2).unwrap_err(), NEEDS_EARLIER);
        p.send().unwrap();
        let taken =
            import_phone_progress_in(&m2.root.0, &p.file(), Some("cccc-mac2"), "0.0.0-test", NOW);
        assert!(taken.is_err());
        // Sent, but not accepted anywhere: the work still counts as unsaved,
        // so the second Mac's full copy cannot wipe it.
        assert!(crate::phone_work::refuse_unsaved(&p.root.0, true).is_err());
    }

    #[test]
    fn a_gap_needs_earlier_does_not_restart_the_stream() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        mac_changes(&mac, "m3");
        p.db()
            .execute(
                "UPDATE app_metadata SET value = '0' WHERE key = 'sync_floor_seq'",
                [],
            )
            .unwrap();
        let before = p.outbox();
        assert_eq!(accept(&p, &mac).unwrap_err(), NEEDS_EARLIER);
        assert!(!restarted(&p));
        assert_eq!(exported_mark(&p), 1);
        assert_eq!(p.outbox(), before);
    }

    #[test]
    fn send_first_leaves_the_outbox_untouched() {
        let (mac, p) = setup();
        phone_sends(&p, "b1");
        mac_takes(&mac, &p);
        // Unsent phone work, and the Mac deletes the material it sits on.
        p.db()
            .execute(
                "INSERT INTO material_bookmarks (id,material_id,page_index,title,created_at,updated_at) VALUES ('b9','m1',1,'t',?1,?1)",
                ["2026-11-05T00:00:00.000Z"],
            )
            .unwrap();
        mac.db()
            .execute("DELETE FROM study_materials WHERE id = 'm1'", [])
            .unwrap();
        mac.send().unwrap();
        let before = p.outbox();
        let got = accept(&p, &mac);
        assert!(got.is_err(), "{:?}", got.map(|g| g.outcome));
        assert!(!restarted(&p));
        assert_eq!(p.outbox(), before);
        assert_eq!(
            count(
                &p.db(),
                "SELECT COUNT(*) FROM study_materials WHERE id = 'm1'"
            ),
            1
        );
    }

    #[test]
    fn an_applied_list_without_its_start_prunes_nothing() {
        let (_mac, p) = setup();
        phone_sends(&p, "b1");
        let manifest = serde_json::json!({ "applied": { DEVICE: 1_000_000 } });
        prune_outbox(&p.root.0, &p.db(), &manifest);
        assert_eq!(p.outbox().len(), 1);
    }

    /// The Mac's file with no change files, only what it has applied.
    fn empty_files_copy(mac: &MacApp, dir: &TempDir) -> std::path::PathBuf {
        let mut m: Value =
            serde_json::from_slice(&super::send::read_entry(&mac.file(), "manifest.json")).unwrap();
        m["files"] = json!([]);
        let path = dir.0.join("Changes from my Mac.hfdchanges");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(m.to_string().as_bytes()).unwrap();
        zip.finish().unwrap();
        path
    }

    #[test]
    fn an_empty_files_list_prunes_only_for_the_copys_mac() {
        let dir = TempDir::new("prune-empty");
        for (copy_source, left) in [(None, 0), (Some("someone-else"), 1)] {
            let (mac, p) = setup();
            phone_sends(&p, "b1");
            mac_takes(&mac, &p);
            mac_changes(&mac, "m3");
            if let Some(source) = copy_source {
                p.db()
                    .execute(
                        "UPDATE app_metadata SET value = ?1 WHERE key = 'sync_copy_from_device'",
                        [source],
                    )
                    .unwrap();
            }
            let path = empty_files_copy(&mac, &dir);
            let got = import_mac_changes_in(&p.root.0, &path, Some(DEVICE), NOW);
            assert!(got.is_ok(), "{:?}", got.err());
            assert_eq!(p.outbox().len(), left);
        }
    }
}

mod synced_ratings {
    use super::apply::{card, rate, state, MAC, PHONE};
    use super::progress::{mac_db, mac_root, run};
    use super::send::{phone, Phone};
    use super::*;

    /// The phone rates one card three times and another once, sends, and the
    /// Mac takes the file. Returns the Mac folder and the two cards.
    fn phone_rates_then_mac_takes() -> (TempDir, Vec<crate::sync_tests::apply::Card>) {
        let dir = TempDir::new("synced-ratings");
        let root = mac_root();
        let p = phone();
        let mut conn = p.db();
        let a = card(&conn, "mat-a");
        let b = card(&conn, "mat-b");
        rate(&mut conn, &a, "good", 1);
        rate(&mut conn, &a, "easy", 2);
        rate(&mut conn, &a, "hard", 3);
        rate(&mut conn, &b, "good", 4);
        drop(conn);
        p.send().unwrap();
        let zip = zip_of(&dir, &p);
        run(&root, &zip).unwrap();
        (root, vec![a, b])
    }

    /// Records the migration history a real app database carries, so the
    /// backup verifier can run on a test database.
    fn with_history(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in crate::migrations() {
            conn.execute(
                "INSERT OR IGNORE INTO _sqlx_migrations (version) VALUES (?1)",
                [m.version],
            )
            .unwrap();
        }
    }

    fn zip_of(dir: &TempDir, p: &Phone) -> std::path::PathBuf {
        let out = dir.0.join("phone-progress.hfdprogress");
        std::fs::copy(p.file(), &out).unwrap();
        out
    }

    #[test]
    fn a_mac_that_takes_phone_ratings_still_passes_backup_verification() {
        let (root, cards) = phone_rates_then_mac_takes();
        let mac = mac_db(&root);
        with_history(&mac);
        crate::backup::verify_application_connection(&mac).unwrap();
        let events: i64 = count(&mac, "SELECT COUNT(*) FROM card_review_events");
        assert_eq!(events, 4);
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM card_review_events e JOIN card_review_operations o
                 ON o.operation_id = e.id AND o.action = 'rate' AND o.is_erased = 0"
            ),
            4
        );
        assert!(state(&mac, &cards[0].item).unwrap().7 >= 3);
        let copy = root.0.join("copy.db");
        mac.execute("VACUUM INTO ?1", [copy.to_str().unwrap()])
            .unwrap();
        crate::backup::verify_application_database(&copy).unwrap();
    }

    fn receipt_rows(conn: &Connection) -> Vec<String> {
        conn.prepare(
            "SELECT operation_id || '|' || action || '|' || source_material_id || '|' || generation
                 || '|' || request_hash || '|' || applied_at || '|' || is_erased || '|' || COALESCE(result_json, '')
             FROM card_review_operations ORDER BY operation_id",
        )
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }

    #[test]
    fn the_phone_passes_verification_after_taking_mac_ratings() {
        use super::mac_send::mac_app;
        use crate::sync::progress::import_mac_changes_in;
        let mac = mac_app();
        let mut mac_conn = mac.db();
        let a = card(&mac_conn, "mat-a");
        let p = phone();
        mac.copy_to(&p);
        rate(&mut mac_conn, &a, "good", 1);
        rate(&mut mac_conn, &a, "easy", 2);
        mac.send().unwrap();
        import_mac_changes_in(&p.root.0, &mac.file(), Some(super::send::DEVICE), NOW).unwrap();
        let conn = p.db();
        with_history(&conn);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM card_review_events"), 2);
        crate::backup::verify_application_connection(&conn).unwrap();
        assert!(state(&conn, &a.item).unwrap().7 >= 2);
    }

    #[test]
    fn derived_receipts_are_deterministic_and_never_overwrite() {
        let dir = TempDir::new("synced-det");
        let p = phone();
        let mut conn = p.db();
        let a = card(&conn, "mat-a");
        rate(&mut conn, &a, "good", 1);
        rate(&mut conn, &a, "hard", 2);
        drop(conn);
        p.send().unwrap();
        let zip = zip_of(&dir, &p);
        let (one, two) = (mac_root(), mac_root());
        run(&one, &zip).unwrap();
        run(&two, &zip).unwrap();
        let first = receipt_rows(&mac_db(&one));
        assert_eq!(first.len(), 2);
        assert_eq!(first, receipt_rows(&mac_db(&two)));
        // A receipt that is already there is left alone.
        let mac = mac_db(&one);
        mac.execute(
            "UPDATE card_review_operations SET applied_at = '2026-01-01T00:00:00.000Z'",
            [],
        )
        .unwrap();
        let before = receipt_rows(&mac);
        assert_eq!(
            crate::sync::receipts::ensure_rate_receipts(&mac, None).unwrap(),
            0
        );
        assert_eq!(receipt_rows(&mac), before);
    }

    /// Two devices, one card each side; `a` rates and ships to `b`.
    fn pair() -> (Connection, Connection, crate::sync_tests::apply::Card) {
        use super::apply::device;
        let a = device(MAC);
        let b = device(PHONE);
        let c = card(&a, "mat-pair");
        card(&b, "mat-pair");
        (a, b, c)
    }

    #[test]
    fn a_peer_reset_erases_receipts_and_keeps_verification() {
        use super::apply::{act, ship, take};
        let (mut a, mut b, c) = pair();
        rate(&mut a, &c, "good", 1);
        rate(&mut a, &c, "easy", 2);
        take(&mut b, &ship(&mut a, MAC, 0));
        act(&mut b, &c, "reset", json!({}), 3);
        take(&mut a, &ship(&mut b, PHONE, 0));
        with_history(&a);
        crate::backup::verify_application_connection(&a).unwrap();
        assert_eq!(count(&a, "SELECT COUNT(*) FROM card_review_events"), 0);
        assert_eq!(state(&a, &c.item), None);
        assert_eq!(
            count(&a, "SELECT COUNT(*) FROM card_review_operations WHERE is_erased = 0 AND action = 'rate'"),
            0
        );
        assert!(
            count(
                &a,
                "SELECT COUNT(*) FROM card_review_operations WHERE is_erased = 1"
            ) >= 2
        );
        rate(&mut a, &c, "good", 4);
        crate::backup::verify_application_connection(&a).unwrap();
    }

    #[test]
    fn a_synced_material_delete_erases_receipts_under_the_guard() {
        let (root, _cards) = phone_rates_then_mac_takes();
        let mac = mac_db(&root);
        with_history(&mac);
        mac.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', 'test')",
            [],
        )
        .unwrap();
        mac.execute("DELETE FROM study_materials WHERE id = 'mat-a'", [])
            .unwrap();
        mac.execute("DELETE FROM app_metadata WHERE key = 'sync_applying'", [])
            .unwrap();
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM card_review_operations WHERE source_material_id = 'mat-a' AND is_erased = 0"
            ),
            0
        );
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM card_review_events"), 1);
        crate::backup::verify_application_connection(&mac).unwrap();
    }

    #[test]
    fn the_startup_repair_fixes_a_mac_hit_before_this_round() {
        let (root, _cards) = phone_rates_then_mac_takes();
        let mut mac = mac_db(&root);
        with_history(&mac);
        // The old way: events and state with no receipts and a low revision.
        mac.execute("DELETE FROM card_review_operations", [])
            .unwrap();
        mac.execute("UPDATE card_review_state SET revision = 1", [])
            .unwrap();
        assert!(crate::backup::verify_application_connection(&mac).is_err());
        let logged = count(&mac, "SELECT COUNT(*) FROM local_changes");
        let n = crate::sync::receipts::repair_synced_ratings(&mut mac).unwrap();
        assert!(n >= 4);
        crate::backup::verify_application_connection(&mac).unwrap();
        assert_eq!(count(&mac, "SELECT COUNT(*) FROM local_changes"), logged);
        let before = receipt_rows(&mac);
        assert_eq!(
            crate::sync::receipts::repair_synced_ratings(&mut mac).unwrap(),
            0
        );
        assert_eq!(receipt_rows(&mac), before);
        assert_eq!(
            count(
                &mac,
                "SELECT COUNT(*) FROM app_metadata WHERE key = 'sync_applying'"
            ),
            0
        );
    }

    #[test]
    fn a_late_event_from_before_a_reset_gets_no_receipt() {
        use super::apply::{act, ship, take};
        let (mut a, mut b, c) = pair();
        rate(&mut b, &c, "good", 1);
        act(&mut a, &c, "reset", json!({}), 2);
        take(&mut a, &ship(&mut b, PHONE, 0));
        assert_eq!(count(&a, "SELECT COUNT(*) FROM card_review_events"), 0);
        assert_eq!(
            count(
                &a,
                "SELECT COUNT(*) FROM card_review_operations WHERE action = 'rate'"
            ),
            0
        );
        with_history(&a);
        crate::backup::verify_application_connection(&a).unwrap();
    }

    #[test]
    fn a_carry_after_synced_ratings_copies_them() {
        use crate::study_sets::{decode_operation, save_on};
        let (root, cards) = phone_rates_then_mac_takes();
        let mut mac = mac_db(&root);
        with_history(&mac);
        let col = |name: &str| -> Option<String> {
            mac.query_row(
                &format!("SELECT {name} FROM ai_study_sets WHERE source_material_id = 'mat-a'"),
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        let mut expected = Map::new();
        for name in [
            "title",
            "summary",
            "sections_json",
            "flashcards_json",
            "source_notes",
            "provider",
            "model",
            "generated_at",
            "updated_at",
            "summary_origin",
            "retired_json",
        ] {
            expected.insert(
                name.to_string(),
                col(name).map(Value::String).unwrap_or(Value::Null),
            );
        }
        let next = json!({
            "title": "Synthetic", "summary": "", "summaryOrigin": null, "sections": [],
            "flashcards": [
                {"front": "Synthetic front", "back": "Synthetic back", "sourcePage": 1},
                {"front": "Second front", "back": "Second back", "sourcePage": 1}
            ],
            "sourceNotes": "", "provider": "import", "model": "", "retired": [],
        });
        let op = decode_operation(&json!({
            "operationId": "5e700000-0000-4000-8000-000000000001",
            "materialId": "mat-a", "reason": "edit",
            "expected": Value::Object(expected), "next": next,
        }))
        .unwrap();
        save_on(&mut mac, &op, NOW).unwrap();
        let carried: i64 = count(
            &mac,
            "SELECT COUNT(*) FROM card_review_events e JOIN card_items i ON i.id = e.item_id
             JOIN card_versions v ON v.id = i.version_id
             WHERE v.source_material_id = 'mat-a' AND v.is_active = 1",
        );
        assert_eq!(carried, 3);
        crate::backup::verify_application_connection(&mac).unwrap();
        let _ = cards;
    }
}
