//! Atomic debrief persistence.
//!
//! One debrief save (journal entry, its study materials, and optionally the
//! action and instructor question she accepted from it) runs as a single
//! immediate SQLite transaction on one dedicated connection.
//!
//! Contract (shared with `src/data/db.ts` `DebriefSaveOperation` and
//! `src/data/debriefTransaction.ts`; replayed from the real form's payloads in
//! `fixtures/debrief-contract/`):
//! - Unknown fields are rejected, so the frontend and this struct cannot drift
//!   apart silently.
//! - `operation_id` identifies one exact save. An id that already committed is
//!   a retry and changes nothing, so it can never undo later work.
//! - A new operation writes the journal as sent, and on an action or question
//!   this journal owns it writes only the debrief-managed fields: action title
//!   and material; question text, lesson and material. Status, completion,
//!   answers, priority, category, dates and estimates are never written.
//! - An existing record that this journal does not own is refused, never
//!   overwritten or deleted.
//! - A referenced event, goal or material that no longer exists degrades to no
//!   link. Any error rolls back the whole operation.

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;

use crate::storage::app_root;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebriefSaveOperation {
    pub operation_id: String,
    pub target_id: String,
    pub journal: DebriefJournalPayload,
    #[serde(default)]
    pub action: Option<DebriefActionPayload>,
    #[serde(default)]
    pub withdraw_action_id: Option<String>,
    #[serde(default)]
    pub question: Option<DebriefQuestionPayload>,
    #[serde(default)]
    pub withdraw_question_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebriefJournalPayload {
    #[serde(default)]
    pub event_id: Option<String>,
    pub date: String,
    pub title: String,
    #[serde(default)]
    pub aircraft_type: Option<String>,
    #[serde(default)]
    pub aircraft_id: Option<String>,
    #[serde(default)]
    pub departure_airport: Option<String>,
    #[serde(default)]
    pub arrival_airport: Option<String>,
    #[serde(default)]
    pub instructor_name: Option<String>,
    #[serde(default)]
    pub total_time: Option<f64>,
    #[serde(default)]
    pub dual_received: Option<f64>,
    #[serde(default)]
    pub solo_time: Option<f64>,
    #[serde(default)]
    pub pic_time: Option<f64>,
    #[serde(default)]
    pub cross_country_time: Option<f64>,
    #[serde(default)]
    pub night_time: Option<f64>,
    #[serde(default)]
    pub actual_instrument_time: Option<f64>,
    #[serde(default)]
    pub simulated_instrument_time: Option<f64>,
    #[serde(default)]
    pub day_landings: Option<i64>,
    #[serde(default)]
    pub night_landings: Option<i64>,
    #[serde(default)]
    pub mission: Option<String>,
    #[serde(default)]
    pub practiced: Option<String>,
    #[serde(default)]
    pub went_well: Option<String>,
    #[serde(default)]
    pub was_difficult: Option<String>,
    #[serde(default)]
    pub instructor_feedback: Option<String>,
    #[serde(default)]
    pub questions_for_next_time: Option<String>,
    #[serde(default)]
    pub confidence: Option<i64>,
    #[serde(default)]
    pub goal_id: Option<String>,
    #[serde(default)]
    pub material_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebriefActionPayload {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub material_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebriefQuestionPayload {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub event_id: Option<String>,
    #[serde(default)]
    pub material_id: Option<String>,
}

#[tauri::command]
pub async fn save_debrief_operation(
    app: AppHandle,
    operation: DebriefSaveOperation,
) -> Result<(), String> {
    let root = app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_debrief_operation_at(&root, &operation))
        .await
        .map_err(|error| format!("Could not complete debrief save: {error}"))?
}

/// Whether a row matches. A failed query is an error, never "no".
fn exists(tx: &Transaction, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<bool, String> {
    tx.query_row(sql, args, |_| Ok(()))
        .optional()
        .map(|row| row.is_some())
        .map_err(|e| format!("Could not check the database: {e}"))
}

/// The id when that record still exists; otherwise no link.
fn live_or_none(
    tx: &Transaction,
    table: &str,
    id: &Option<String>,
) -> Result<Option<String>, String> {
    match id {
        Some(id) if exists(tx, &format!("SELECT 1 FROM {table} WHERE id = ?1"), &[id])? => {
            Ok(Some(id.clone()))
        }
        _ => Ok(None),
    }
}

pub fn save_debrief_operation_at(root: &Path, op: &DebriefSaveOperation) -> Result<(), String> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err("Database file is missing.".to_string());
    }

    let mut connection = Connection::open(&db_path)
        .map_err(|e| format!("Could not open database for debrief save: {e}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Could not set database busy timeout: {e}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Could not enable foreign keys: {e}"))?;

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Could not start debrief transaction: {e}"))?;

    // Same ISO-8601 form (with milliseconds) the browser writes.
    let now: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .map_err(|e| format!("Could not read the clock: {e}"))?;

    // 0. An operation that already committed is a retry: change nothing.
    if exists(
        &tx,
        "SELECT 1 FROM debrief_operations WHERE id = ?1",
        &[&op.operation_id],
    )? {
        return tx
            .commit()
            .map_err(|e| format!("Could not finish debrief transaction: {e}"));
    }

    let journal_id = &op.target_id;
    let j = &op.journal;

    // 1. Journal entry, written as shown in the form.
    let event_id = live_or_none(&tx, "schedule_events", &j.event_id)?;
    let goal_id = live_or_none(&tx, "goals", &j.goal_id)?;
    let mut material_ids = Vec::new();
    for id in j.material_ids.iter().flatten() {
        if let Some(live) = live_or_none(&tx, "study_materials", &Some(id.clone()))? {
            material_ids.push(live);
        }
    }
    let text = |value: &Option<String>| value.clone().unwrap_or_default();

    if exists(
        &tx,
        "SELECT 1 FROM journal_entries WHERE id = ?1",
        &[journal_id],
    )? {
        tx.execute(
            "UPDATE journal_entries SET
                event_id = ?1, date = ?2, title = ?3, aircraft_type = ?4, aircraft_id = ?5,
                departure_airport = ?6, arrival_airport = ?7, instructor_name = ?8,
                total_time = ?9, dual_received = ?10, solo_time = ?11, pic_time = ?12,
                cross_country_time = ?13, night_time = ?14, actual_instrument_time = ?15,
                simulated_instrument_time = ?16, day_landings = ?17, night_landings = ?18,
                mission = ?19, practiced = ?20, went_well = ?21, was_difficult = ?22,
                instructor_feedback = ?23, questions_for_next_time = ?24, confidence = ?25,
                goal_id = ?26, updated_at = ?27
             WHERE id = ?28",
            params![
                event_id,
                j.date,
                j.title,
                text(&j.aircraft_type),
                text(&j.aircraft_id),
                text(&j.departure_airport),
                text(&j.arrival_airport),
                text(&j.instructor_name),
                j.total_time,
                j.dual_received,
                j.solo_time,
                j.pic_time,
                j.cross_country_time,
                j.night_time,
                j.actual_instrument_time,
                j.simulated_instrument_time,
                j.day_landings,
                j.night_landings,
                text(&j.mission),
                text(&j.practiced),
                text(&j.went_well),
                text(&j.was_difficult),
                text(&j.instructor_feedback),
                text(&j.questions_for_next_time),
                j.confidence,
                goal_id,
                now,
                journal_id,
            ],
        )
        .map_err(|e| format!("Failed to update journal entry: {e}"))?;
    } else {
        tx.execute(
            "INSERT INTO journal_entries (
                id, event_id, date, title, aircraft_type, aircraft_id,
                departure_airport, arrival_airport, instructor_name,
                total_time, dual_received, solo_time, pic_time,
                cross_country_time, night_time, actual_instrument_time,
                simulated_instrument_time, day_landings, night_landings,
                mission, practiced, went_well, was_difficult,
                instructor_feedback, questions_for_next_time,
                confidence, goal_id, created_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?28
            )",
            params![
                journal_id,
                event_id,
                j.date,
                j.title,
                text(&j.aircraft_type),
                text(&j.aircraft_id),
                text(&j.departure_airport),
                text(&j.arrival_airport),
                text(&j.instructor_name),
                j.total_time,
                j.dual_received,
                j.solo_time,
                j.pic_time,
                j.cross_country_time,
                j.night_time,
                j.actual_instrument_time,
                j.simulated_instrument_time,
                j.day_landings,
                j.night_landings,
                text(&j.mission),
                text(&j.practiced),
                text(&j.went_well),
                text(&j.was_difficult),
                text(&j.instructor_feedback),
                text(&j.questions_for_next_time),
                j.confidence,
                goal_id,
                now,
            ],
        )
        .map_err(|e| format!("Failed to insert journal entry: {e}"))?;
    }

    tx.execute(
        "DELETE FROM journal_materials WHERE journal_id = ?1",
        params![journal_id],
    )
    .map_err(|e| format!("Failed to clear journal materials: {e}"))?;
    for id in &material_ids {
        tx.execute(
            "INSERT INTO journal_materials (journal_id, material_id) VALUES (?1, ?2)",
            params![journal_id, id],
        )
        .map_err(|e| format!("Failed to link journal material: {e}"))?;
    }

    // 2. Action: create, update only the debrief-managed fields, or withdraw.
    if let Some(action) = &op.action {
        let material_id = live_or_none(&tx, "study_materials", &action.material_id)?;
        if exists(
            &tx,
            "SELECT 1 FROM next_actions WHERE id = ?1",
            &[&action.id],
        )? {
            if !exists(
                &tx,
                "SELECT 1 FROM next_actions WHERE id = ?1 AND related_type = 'journal' AND related_id = ?2",
                &[&action.id, journal_id],
            )? {
                return Err(format!(
                    "Action {} is not owned by journal {journal_id}",
                    action.id
                ));
            }
            // SQLite evaluates every expression against the old row, so the
            // provenance clears only when the link actually changes.
            tx.execute(
                "UPDATE next_actions SET
                    title = ?1,
                    source_material_id = CASE WHEN material_id IS ?2 THEN source_material_id ELSE NULL END,
                    material_id = ?2,
                    updated_at = ?3
                 WHERE id = ?4 AND related_type = 'journal' AND related_id = ?5",
                params![action.title, material_id, now, action.id, journal_id],
            )
            .map_err(|e| format!("Failed to update action: {e}"))?;
        } else {
            tx.execute(
                "INSERT INTO next_actions (
                    id, title, description, category, priority, status,
                    due_date, estimated_minutes, related_type, related_id,
                    material_id, created_at, updated_at
                ) VALUES (?1, ?2, '', 'prepare', 'next_up', 'open', NULL, NULL, 'journal', ?3, ?4, ?5, ?5)",
                params![action.id, action.title, journal_id, material_id, now],
            )
            .map_err(|e| format!("Failed to insert action: {e}"))?;
        }
    } else if let Some(withdraw) = &op.withdraw_action_id {
        if exists(
            &tx,
            "SELECT 1 FROM next_actions WHERE id = ?1 AND NOT (related_type IS 'journal' AND related_id IS ?2)",
            &[withdraw, journal_id],
        )? {
            return Err(format!(
                "Action {withdraw} is not owned by journal {journal_id}"
            ));
        }
        tx.execute(
            "DELETE FROM next_actions WHERE id = ?1 AND related_type = 'journal' AND related_id = ?2",
            params![withdraw, journal_id],
        )
        .map_err(|e| format!("Failed to delete withdrawn action: {e}"))?;
    }

    // 3. Question: create, update only the debrief-managed fields, or withdraw.
    if let Some(question) = &op.question {
        let event_id = live_or_none(&tx, "schedule_events", &question.event_id)?;
        let material_id = live_or_none(&tx, "study_materials", &question.material_id)?;
        if exists(
            &tx,
            "SELECT 1 FROM questions WHERE id = ?1",
            &[&question.id],
        )? {
            if !exists(
                &tx,
                "SELECT 1 FROM questions WHERE id = ?1 AND journal_id IS ?2",
                &[&question.id, journal_id],
            )? {
                return Err(format!(
                    "Question {} is not owned by journal {journal_id}",
                    question.id
                ));
            }
            tx.execute(
                "UPDATE questions SET
                    text = ?1,
                    source_event_id = CASE WHEN event_id IS ?2 THEN source_event_id ELSE NULL END,
                    event_id = ?2,
                    source_material_id = CASE WHEN material_id IS ?3 THEN source_material_id ELSE NULL END,
                    material_id = ?3,
                    updated_at = ?4
                 WHERE id = ?5 AND journal_id = ?6",
                params![question.text, event_id, material_id, now, question.id, journal_id],
            )
            .map_err(|e| format!("Failed to update question: {e}"))?;
        } else {
            tx.execute(
                "INSERT INTO questions (
                    id, text, topic, event_id, material_id, journal_id,
                    status, answer, created_at, updated_at
                ) VALUES (?1, ?2, 'general', ?3, ?4, ?5, 'to_ask', '', ?6, ?6)",
                params![
                    question.id,
                    question.text,
                    event_id,
                    material_id,
                    journal_id,
                    now
                ],
            )
            .map_err(|e| format!("Failed to insert question: {e}"))?;
        }
    } else if let Some(withdraw) = &op.withdraw_question_id {
        if exists(
            &tx,
            "SELECT 1 FROM questions WHERE id = ?1 AND journal_id IS NOT ?2",
            &[withdraw, journal_id],
        )? {
            return Err(format!(
                "Question {withdraw} is not owned by journal {journal_id}"
            ));
        }
        tx.execute(
            "DELETE FROM questions WHERE id = ?1 AND journal_id = ?2",
            params![withdraw, journal_id],
        )
        .map_err(|e| format!("Failed to delete withdrawn question: {e}"))?;
    }

    // 4. Record the operation so a replay of it is a no-op.
    tx.execute(
        "INSERT INTO debrief_operations (id, journal_id, applied_at) VALUES (?1, ?2, ?3)",
        params![op.operation_id, journal_id, now],
    )
    .map_err(|e| format!("Failed to record debrief operation: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Could not commit debrief transaction: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Value};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Instant;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!(
                "hfd-debrief-test-{}-{}-{}",
                std::process::id(),
                id,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            TestDir(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A database built from the app's own registered migrations, the way the
    /// desktop app builds one, with the migration history backups expect.
    fn setup_db(root: &Path) -> Connection {
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(&format!(
            "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO _sqlx_migrations (version) VALUES ({});",
            crate::CURRENT_SCHEMA_VERSION
        ))
        .unwrap();
        conn
    }

    // Identical to SEED_SQL and PROGRESS_SQL in debriefContract.test.ts.
    const SEED_SQL: [&str; 2] = [
        "INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
         VALUES ('material-1', 'Airplane Flying Handbook Ch. 8', 'reference', 'aerodynamics', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')",
        "INSERT INTO schedule_events (id, title, event_type, date, status, created_at, updated_at)
         VALUES ('event-1', 'Crosswind landings', 'flight_lesson', '2099-01-10', 'scheduled', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')",
    ];
    const PROGRESS_SQL: [&str; 2] = [
        "UPDATE next_actions SET status = 'completed', completed_at = '2026-09-27T10:00:00.000Z',
                priority = 'important', due_date = '2026-10-01', estimated_minutes = 25,
                description = 'Flew it twice with my instructor' WHERE id = 'action-1'",
        "UPDATE questions SET status = 'answered', answer = 'Hold it into the wind, more as you slow',
                answered_at = '2026-09-27T10:05:00.000Z', topic = 'aerodynamics' WHERE id = 'question-1'",
    ];

    fn seed(conn: &Connection) {
        for sql in SEED_SQL {
            conn.execute(sql, []).unwrap();
        }
    }

    fn fixture_text(name: &str) -> &'static str {
        match name {
            "01-create" => include_str!("../fixtures/debrief-contract/01-create.json"),
            "02-update" => include_str!("../fixtures/debrief-contract/02-update.json"),
            "03-withdraw-action" => {
                include_str!("../fixtures/debrief-contract/03-withdraw-action.json")
            }
            "04-withdraw-question" => {
                include_str!("../fixtures/debrief-contract/04-withdraw-question.json")
            }
            "expected" => include_str!("../fixtures/debrief-contract/expected.json"),
            other => panic!("no fixture {other}"),
        }
    }

    /// Deserialize the real frontend payload, exactly as Tauri would.
    fn fixture(name: &str) -> DebriefSaveOperation {
        serde_json::from_str(fixture_text(name))
            .unwrap_or_else(|e| panic!("{name} must deserialize: {e}"))
    }

    fn rows(conn: &Connection, sql: &str) -> Value {
        let mut stmt = conn.prepare(sql).unwrap();
        let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
        let out: Vec<Value> = stmt
            .query_map([], |row| {
                let mut object = Map::new();
                for (i, name) in names.iter().enumerate() {
                    let value = match row.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(n) => json!(n),
                        rusqlite::types::ValueRef::Real(f) => json!(f),
                        rusqlite::types::ValueRef::Text(t) => {
                            json!(String::from_utf8_lossy(t).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(_) => Value::Null,
                    };
                    object.insert(name.clone(), value);
                }
                Ok(Value::Object(object))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        Value::Array(out)
    }

    /// The same rows, in the same shape, as `snapshot` in debriefContract.test.ts.
    fn snapshot(conn: &Connection) -> Value {
        json!({
            "journal": rows(conn, "SELECT id, date, title, event_id, was_difficult, questions_for_next_time FROM journal_entries ORDER BY id"),
            "journalMaterials": rows(conn, "SELECT journal_id, material_id FROM journal_materials ORDER BY journal_id, material_id"),
            "actions": rows(conn, "SELECT id, title, description, category, priority, status, due_date, estimated_minutes, related_type, related_id, material_id, source_material_id, completed_at FROM next_actions ORDER BY id"),
            "questions": rows(conn, "SELECT id, text, topic, status, answer, answered_at, event_id, material_id, journal_id, source_event_id, source_material_id, source_journal_id FROM questions ORDER BY id"),
            "operations": rows(conn, "SELECT id, journal_id FROM debrief_operations ORDER BY id"),
        })
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn frontend_contract_fixtures_persist_the_same_rows_as_the_browser_transaction() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        let expected: Value = serde_json::from_str(fixture_text("expected")).unwrap();

        save_debrief_operation_at(dir.path(), &fixture("01-create")).unwrap();
        assert_eq!(snapshot(&conn), expected["afterCreate"]);

        for sql in PROGRESS_SQL {
            conn.execute(sql, []).unwrap();
        }
        save_debrief_operation_at(dir.path(), &fixture("01-create")).unwrap();
        assert_eq!(snapshot(&conn), expected["afterProgressAndReplay"]);

        save_debrief_operation_at(dir.path(), &fixture("02-update")).unwrap();
        assert_eq!(snapshot(&conn), expected["afterUpdate"]);

        save_debrief_operation_at(dir.path(), &fixture("03-withdraw-action")).unwrap();
        assert_eq!(snapshot(&conn), expected["afterWithdrawAction"]);

        save_debrief_operation_at(dir.path(), &fixture("04-withdraw-question")).unwrap();
        assert_eq!(snapshot(&conn), expected["afterWithdrawQuestion"]);
    }

    #[test]
    fn contract_rejects_the_old_and_drifted_payload_shapes() {
        let base: Value = serde_json::from_str(fixture_text("01-create")).unwrap();
        let reject = |mutate: &dyn Fn(&mut Value)| {
            let mut value = base.clone();
            mutate(&mut value);
            serde_json::from_value::<DebriefSaveOperation>(value).is_err()
        };
        assert!(reject(&|v| {
            v["isNew"] = json!(true);
        }));
        assert!(reject(&|v| {
            v["journal"]["id"] = json!("journal-1");
        }));
        assert!(reject(&|v| {
            let id = v["withdrawActionId"].take();
            v.as_object_mut().unwrap().remove("withdrawActionId");
            v["withdrawnActionId"] = id;
        }));
        assert!(reject(&|v| {
            v.as_object_mut().unwrap().remove("operationId");
        }));
        // The canonical shape itself round-trips.
        assert!(serde_json::from_value::<DebriefSaveOperation>(base.clone()).is_ok());
    }

    #[test]
    fn both_withdrawal_fixtures_carry_the_ids_into_rust() {
        let action = fixture("03-withdraw-action");
        assert!(action.action.is_none());
        assert_eq!(action.withdraw_action_id.as_deref(), Some("action-1"));
        let question = fixture("04-withdraw-question");
        assert!(question.question.is_none());
        assert_eq!(question.withdraw_question_id.as_deref(), Some("question-1"));
    }

    #[test]
    fn retry_after_a_committed_operation_changes_nothing() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        let op = fixture("01-create");
        save_debrief_operation_at(dir.path(), &op).unwrap();
        for sql in PROGRESS_SQL {
            conn.execute(sql, []).unwrap();
        }
        let before = snapshot(&conn);
        // An interrupted response: the form retries the same operation twice.
        save_debrief_operation_at(dir.path(), &op).unwrap();
        save_debrief_operation_at(dir.path(), &op).unwrap();
        assert_eq!(snapshot(&conn), before);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM debrief_operations"), 1);
    }

    #[test]
    fn distinct_operations_with_identical_text_stay_distinct() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        let first = fixture("01-create");
        let mut second = first.clone();
        second.operation_id = "operation-other".into();
        second.target_id = "journal-other".into();
        second.action.as_mut().unwrap().id = "action-other".into();
        second.question.as_mut().unwrap().id = "question-other".into();
        save_debrief_operation_at(dir.path(), &first).unwrap();
        save_debrief_operation_at(dir.path(), &second).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM next_actions"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM questions"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM journal_entries"), 2);
    }

    #[test]
    fn a_request_cannot_overwrite_or_delete_a_record_it_does_not_own() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        conn.execute(
            "INSERT INTO next_actions (id, title, status, created_at, updated_at) VALUES ('independent', 'Buy a kneeboard', 'open', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO questions (id, text, status, created_at, updated_at) VALUES ('independent-q', 'Which headset?', 'to_ask', 'x', 'x')",
            [],
        )
        .unwrap();

        let mut claim = fixture("01-create");
        claim.action.as_mut().unwrap().id = "independent".into();
        assert!(save_debrief_operation_at(dir.path(), &claim)
            .unwrap_err()
            .contains("not owned"));

        let mut claim_q = fixture("01-create");
        claim_q.question.as_mut().unwrap().id = "independent-q".into();
        assert!(save_debrief_operation_at(dir.path(), &claim_q)
            .unwrap_err()
            .contains("not owned"));

        let mut withdraw = fixture("04-withdraw-question");
        withdraw.withdraw_action_id = Some("independent".into());
        withdraw.withdraw_question_id = Some("independent-q".into());
        assert!(save_debrief_operation_at(dir.path(), &withdraw).is_err());

        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM next_actions WHERE id = 'independent' AND title = 'Buy a kneeboard'"),
            1
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM questions WHERE id = 'independent-q' AND text = 'Which headset?'"),
            1
        );
        // Every refused operation rolled back completely.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM journal_entries"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM debrief_operations"), 0);
    }

    #[test]
    fn references_that_no_longer_exist_degrade_to_no_link() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        // No seed: the fixture's material and lesson do not exist.
        save_debrief_operation_at(dir.path(), &fixture("01-create")).unwrap();
        let (material, event): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT material_id, event_id FROM questions WHERE id = 'question-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((material, event), (None, None));
    }

    #[test]
    fn a_failure_part_way_through_rolls_back_the_whole_operation() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        conn.execute_batch(
            "CREATE TRIGGER fail_question BEFORE INSERT ON questions
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
        )
        .unwrap();
        let error = save_debrief_operation_at(dir.path(), &fixture("01-create")).unwrap_err();
        assert!(error.contains("injected failure"));
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM journal_entries"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM journal_materials"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM next_actions"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM debrief_operations"), 0);
    }

    #[test]
    fn a_held_write_lock_fails_within_the_busy_timeout() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        let holder = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        let started = Instant::now();
        let result = save_debrief_operation_at(dir.path(), &fixture("01-create"));
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(10));
        holder.execute_batch("ROLLBACK").unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM journal_entries"), 0);
    }

    #[test]
    fn normal_deletions_keep_the_records_and_remember_the_deleted_source() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        save_debrief_operation_at(dir.path(), &fixture("01-create")).unwrap();

        // Ordinary deletions with foreign keys on, as the app performs them.
        conn.execute("DELETE FROM study_materials WHERE id = 'material-1'", [])
            .unwrap();
        conn.execute("DELETE FROM schedule_events WHERE id = 'event-1'", [])
            .unwrap();
        conn.execute("DELETE FROM journal_entries WHERE id = 'journal-1'", [])
            .unwrap();

        let action: (Option<String>, Option<String>, String) = conn
            .query_row(
                "SELECT material_id, source_material_id, related_id FROM next_actions WHERE id = 'action-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            action,
            (None, Some("material-1".into()), "journal-1".into())
        );

        let question: [Option<String>; 6] = conn
            .query_row(
                "SELECT journal_id, source_journal_id, material_id, source_material_id, event_id, source_event_id FROM questions WHERE id = 'question-1'",
                [],
                |r| Ok([r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?]),
            )
            .unwrap();
        assert_eq!(
            question,
            [
                None,
                Some("journal-1".into()),
                None,
                Some("material-1".into()),
                None,
                Some("event-1".into())
            ]
        );
    }

    #[test]
    fn choosing_a_new_link_replaces_the_deleted_source_provenance() {
        let dir = TestDir::new();
        let conn = setup_db(dir.path());
        seed(&conn);
        save_debrief_operation_at(dir.path(), &fixture("01-create")).unwrap();
        conn.execute("DELETE FROM study_materials WHERE id = 'material-1'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at) VALUES ('material-2', 'AIM 4-3', 'reference', 'airports', 'x', 'x')",
            [],
        )
        .unwrap();

        // Re-saving with the link unchanged (still gone) keeps the provenance.
        let mut same = fixture("02-update");
        save_debrief_operation_at(dir.path(), &same).unwrap();
        let kept: Option<String> = conn
            .query_row(
                "SELECT source_material_id FROM next_actions WHERE id = 'action-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kept.as_deref(), Some("material-1"));

        same.operation_id = "operation-relink".into();
        same.action.as_mut().unwrap().material_id = Some("material-2".into());
        save_debrief_operation_at(dir.path(), &same).unwrap();
        let (now_linked, source): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT material_id, source_material_id FROM next_actions WHERE id = 'action-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(now_linked.as_deref(), Some("material-2"));
        assert_eq!(source, None);
    }

    #[test]
    fn complete_backup_export_validation_and_restore_keep_debrief_links() {
        let root = TestDir::new();
        let elsewhere = TestDir::new();
        let restore_target = TestDir::new();
        let conn = setup_db(root.path());
        seed(&conn);
        save_debrief_operation_at(root.path(), &fixture("01-create")).unwrap();
        conn.execute("DELETE FROM schedule_events WHERE id = 'event-1'", [])
            .unwrap();
        let before = snapshot(&conn);
        drop(conn);

        let version = env!("CARGO_PKG_VERSION");
        let archive = elsewhere.path().join("debrief.hfdbackup");
        crate::backup::create_consistent_complete_backup_with_retry(root.path(), &archive, version)
            .unwrap();
        crate::backup::inspect_archive(root.path(), &archive, version).unwrap();
        crate::backup::stage_complete_restore_in(restore_target.path(), &archive, version).unwrap();
        crate::backup::apply_pending_restore_in(restore_target.path()).unwrap();

        let restored = Connection::open(restore_target.path().join("her-flight-deck.db")).unwrap();
        assert_eq!(snapshot(&restored), before);
        // The provenance of the deleted lesson survived the round trip.
        let source: Option<String> = restored
            .query_row(
                "SELECT source_event_id FROM questions WHERE id = 'question-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(source.as_deref(), Some("event-1"));
    }
}
