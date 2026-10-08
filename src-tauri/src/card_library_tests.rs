//! Native library-wide reader contract (M2-4 / C2): real rusqlite reads on
//! disposable database files. Every value is synthetic.

use super::*;
use std::path::PathBuf;

use serde::Deserialize;

use crate::practice_sessions::{mark_root_ready, unmark_root_ready};

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-card-library-{label}-{}-{}",
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
struct Call {
    name: String,
    reader: String,
    input: Value,
    #[serde(rename = "cursorFrom")]
    cursor_from: Option<String>,
}

#[derive(Deserialize)]
struct Contract {
    baseline: Vec<String>,
    calls: Vec<Call>,
    expected: Map<String, Value>,
}

fn contract() -> Contract {
    serde_json::from_str(include_str!("../fixtures/card-library/cases.json")).unwrap()
}

/// A ready root holding every registered migration and the contract baseline.
fn baseline_root(label: &str, contract: &Contract) -> TempDir {
    let dir = TempDir::new(label);
    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
    }
    for statement in &contract.baseline {
        conn.execute_batch(statement)
            .unwrap_or_else(|e| panic!("baseline statement failed: {e}"));
    }
    drop(conn);
    mark_root_ready(dir.path());
    dir
}

fn run(root: &Path, reader: &str, input: &Value) -> Value {
    let read = if reader == "due" {
        read_library_review_due
    } else {
        read_library_recent_reviews
    };
    match read_at(root, read, input) {
        Ok(value) => value,
        Err(wire) => {
            assert_eq!(wire.message, wire.code.message());
            json!({ "error": serde_json::to_value(wire.code).unwrap() })
        }
    }
}

fn file_digest(path: &Path) -> String {
    crate::card_reviews::sha256_hex(&hex::encode(std::fs::read(path).unwrap()))
}

#[test]
fn shared_card_library_contract_native_outcomes() {
    let contract = contract();
    let dir = baseline_root("contract", &contract);
    let db = dir.path().join("her-flight-deck.db");
    let before = file_digest(&db);
    let mut results: Map<String, Value> = Map::new();
    let mut mismatches = Vec::new();
    for call in &contract.calls {
        let mut input = call.input.clone();
        if let Some(from) = &call.cursor_from {
            let previous = &results[from];
            let cursor = previous
                .get("nextCursor")
                .or_else(|| previous.get("next"))
                .cloned()
                .unwrap_or(Value::Null);
            input["cursor"] = cursor;
        }
        let actual = run(dir.path(), &call.reader, &input);
        if actual != contract.expected[&call.name] {
            mismatches.push(call.name.clone());
        }
        results.insert(call.name.clone(), actual);
    }
    assert!(
        mismatches.is_empty(),
        "native results differ for {mismatches:#?}"
    );
    assert!(contract.calls.len() >= 30);
    // Reads never write: the database file is byte-identical afterwards.
    assert_eq!(file_digest(&db), before);
}

#[test]
fn reads_refuse_before_readiness_and_never_open_for_writing() {
    let contract = contract();
    let dir = baseline_root("ready", &contract);
    unmark_root_ready(dir.path());
    let input = json!({ "nowUtc": "2026-10-06T16:00:00.000Z", "nextLocalMidnightUtc": "2026-10-07T05:00:00.000Z" });
    let refusal = read_at(dir.path(), read_library_review_due, &input).unwrap_err();
    assert_eq!(refusal.code, CardLibraryErrorCode::NotReady);
    mark_root_ready(dir.path());
    // A write attempted on the reader's own connection kind is refused by SQLite.
    let conn = Connection::open_with_flags(
        dir.path().join("her-flight-deck.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert!(conn.execute("DELETE FROM card_review_events", []).is_err());
    assert!(read_at(dir.path(), read_library_review_due, &input).is_ok());
}

#[test]
fn every_native_message_is_the_typescript_allowlisted_message() {
    let typescript = include_str!("../../src/logic/cardLibrary.ts");
    for code in [
        CardLibraryErrorCode::InvalidTime,
        CardLibraryErrorCode::InvalidFilter,
        CardLibraryErrorCode::InvalidInput,
        CardLibraryErrorCode::InvalidCursor,
        CardLibraryErrorCode::StaleCursor,
        CardLibraryErrorCode::InvalidTarget,
        CardLibraryErrorCode::NotReady,
        CardLibraryErrorCode::StorageError,
    ] {
        let name = serde_json::to_value(code).unwrap();
        let entry = format!(
            "{}: {}",
            name.as_str().unwrap(),
            serde_json::to_string(code.message()).unwrap()
        );
        assert!(
            typescript.contains(&entry),
            "missing TypeScript entry: {entry}"
        );
    }
}

#[test]
fn inspection_targets_match_encode_uri_component() {
    assert_eq!(get_study_inspection_target("a/b"), "/study/a%2Fb");
    assert_eq!(get_study_inspection_target("m-1_x.y~z"), "/study/m-1_x.y~z");
    assert_eq!(
        get_study_inspection_target("a b?c#é"),
        "/study/a%20b%3Fc%23%C3%A9"
    );
    assert_eq!(
        get_study_inspection_target("it's(ok)!*"),
        "/study/it's(ok)!*"
    );
}

#[test]
fn schedule_validation_owns_the_event_scheduler_version() {
    let good = r#"{"dueAt":"2026-10-07T15:00:00.000Z","lapses":0,"lastReviewedAt":"2026-10-06T15:00:00.000Z","reps":1,"schedulerVersion":"simple-v1","step":0}"#;
    let (_, schedule) = validate_schedule_state(Some(good), Some("simple-v1"));
    assert_eq!(schedule["intervalLabel"], json!("1d"));
    assert_eq!(schedule["intervalMinutes"], json!(1440));
    // An unsupported event version never acquires an interval; the parsed audit stays.
    let (parsed, schedule) = validate_schedule_state(Some(good), Some("fsrs-6"));
    assert!(parsed.is_object() && schedule.is_null());
    // A legacy state without its own version inherits only simple-v1.
    let legacy = r#"{"step":-1,"reps":2}"#;
    assert_eq!(
        validate_schedule_state(Some(legacy), Some("simple-v1")).1["intervalLabel"],
        json!("10m")
    );
    assert!(validate_schedule_state(Some(legacy), None).1.is_null());
    for bad in [
        r#"{"step":8,"schedulerVersion":"simple-v1"}"#,
        r#"{"step":0,"schedulerVersion":"simple-v1","dueAt":"2026-02-30T00:00:00.000Z"}"#,
        r#"{"step":0,"schedulerVersion":"simple-v1","reps":-1}"#,
        r#"{"step":0.5,"schedulerVersion":"simple-v1"}"#,
        "not json",
        "[]",
    ] {
        assert!(
            validate_schedule_state(Some(bad), Some("simple-v1"))
                .1
                .is_null(),
            "{bad}"
        );
    }
}
