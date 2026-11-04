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
const SCHEMA: i64 = 32;

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
