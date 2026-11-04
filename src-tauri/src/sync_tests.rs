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
        let dir = std::env::temp_dir().join(format!(
            "hfd-sync-test-{label}-{}-{}",
            std::process::id(),
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
        material: String,
        hash: String,
        item: String,
    }

    fn card(conn: &Connection, material: &str) -> Card {
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
    fn act(conn: &mut Connection, c: &Card, action: &str, extra: Value, op: u64) {
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

    fn rate(conn: &mut Connection, c: &Card, rating: &str, op: u64) {
        act(conn, c, "rate", json!({ "rating": rating }), op);
    }

    type StateTuple = (
        i64,
        i64,
        i64,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        i64,
    );

    fn state(conn: &Connection, item: &str) -> Option<StateTuple> {
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
            assert_eq!(got.7, rev + 1);
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
               "appVersion": "0.0.0-test", "createdAt": 1, "schemaVersion": SCHEMA, "platform": "ios"})
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
