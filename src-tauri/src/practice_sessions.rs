//! Practice sessions persistence foundation (M2 PR 1).
//!
//! Provides the native implementation for:
//! 1. Atomic state mutation for the five practice session actions:
//!    - `start_or_resume`
//!    - `record_response`
//!    - `complete_attempt`
//!    - `retake_attempt`
//!    - `abandon_attempt`
//! 2. Startup legacy conversion from legacy `practice_tests` rows to version 1.
//! 3. Single-connection atomic save/regeneration and deletion of practice tests.
//! 4. Durable operation receipts for idempotent replay and conflict detection.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::storage::app_root;

// Tracks readiness per canonical root path and per-root generation.
static READY_ROOTS: Mutex<Option<HashMap<PathBuf, u64>>> = Mutex::new(None);
static ROOT_GENERATIONS: Mutex<Option<HashMap<PathBuf, u64>>> = Mutex::new(None);

pub fn bump_readiness_generation_at(root: &Path) {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut lock = ROOT_GENERATIONS.lock().unwrap();
    let map = lock.get_or_insert_with(HashMap::new);
    let gen = map.entry(canonical).or_insert(1);
    *gen += 1;
}

#[allow(dead_code)]
pub fn bump_readiness_generation() {
    let mut lock = ROOT_GENERATIONS.lock().unwrap();
    if let Some(map) = lock.as_mut() {
        for gen in map.values_mut() {
            *gen += 1;
        }
    }
}

/// Test fixtures mark a root ready directly; the app goes through
/// `run_legacy_conversion_at`.
#[cfg(test)]
pub fn mark_root_ready(root: &Path) {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let current_gen = {
        let mut gen_lock = ROOT_GENERATIONS.lock().unwrap();
        let gen_map = gen_lock.get_or_insert_with(HashMap::new);
        *gen_map.entry(canonical.clone()).or_insert(1)
    };
    let mut lock = READY_ROOTS.lock().unwrap();
    let map = lock.get_or_insert_with(HashMap::new);
    map.insert(canonical, current_gen);
}

/// The current readiness generation of a root. Initialization captures it at
/// entry; a restore bumps it.
pub fn readiness_generation(root: &Path) -> u64 {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut gen_lock = ROOT_GENERATIONS.lock().unwrap();
    let gen_map = gen_lock.get_or_insert_with(HashMap::new);
    *gen_map.entry(canonical).or_insert(1)
}

/// Publish readiness for the generation initialization validated, only if no
/// restore has bumped the root since. The generation lock is held across the
/// publish so a concurrent bump cannot slip between the check and the insert.
pub fn mark_root_ready_at_generation(root: &Path, generation: u64) -> bool {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut gen_lock = ROOT_GENERATIONS.lock().unwrap();
    let gen_map = gen_lock.get_or_insert_with(HashMap::new);
    let current = *gen_map.entry(canonical.clone()).or_insert(1);
    if current != generation {
        return false;
    }
    let mut lock = READY_ROOTS.lock().unwrap();
    lock.get_or_insert_with(HashMap::new)
        .insert(canonical, generation);
    true
}

#[cfg(test)]
type ReadyPublishHook = Option<Box<dyn Fn(&Path)>>;

#[cfg(test)]
thread_local! {
    /// Test seam: runs after initialization commits and before it publishes
    /// readiness, so a test can bump the generation as a restore would.
    pub(crate) static BEFORE_READY_PUBLISH: std::cell::RefCell<ReadyPublishHook> =
        const { std::cell::RefCell::new(None) };
}

pub fn unmark_root_ready(root: &Path) {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut lock = READY_ROOTS.lock().unwrap();
    if let Some(map) = lock.as_mut() {
        map.remove(&canonical);
    }
}

pub fn is_root_ready(root: &Path) -> bool {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let current_gen = {
        let mut gen_lock = ROOT_GENERATIONS.lock().unwrap();
        let gen_map = gen_lock.get_or_insert_with(HashMap::new);
        *gen_map.entry(canonical.clone()).or_insert(1)
    };
    let mut lock = READY_ROOTS.lock().unwrap();
    if let Some(map) = lock.as_mut() {
        if let Some(gen) = map.get(&canonical) {
            return *gen == current_gen;
        }
    }
    false
}

/// Maximum payload size on the wire (64 KiB).
pub const MAX_REQUEST_PAYLOAD_BYTES: usize = 64 * 1024;
/// Maximum length of string IDs.
pub const MAX_ID_CHARS: usize = 128;
/// Maximum length of question text (code points).
pub const MAX_QUESTION_CHARS: usize = 10_000;
/// Maximum length of question explanation (code points).
pub const MAX_EXPLANATION_CHARS: usize = 5_000;
/// Minimum number of options per question.
pub const MIN_OPTIONS: usize = 2;
/// Maximum number of options per question.
pub const MAX_OPTIONS: usize = 8;
/// Maximum length of each option string (code points).
pub const MAX_OPTION_CHARS: usize = 1_000;
/// Maximum questions in a practice test.
pub const MAX_PRACTICE_QUESTIONS: usize = 200;

/// All five allowlisted error codes from Appendix E.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PracticeSessionErrorCode {
    #[serde(rename = "INVALID_ARGUMENT")]
    InvalidArgument,
    #[serde(rename = "INVALID_STATE")]
    InvalidState,
    #[serde(rename = "NOT_FOUND")]
    NotFound,
    #[serde(rename = "OPERATION_CONFLICT")]
    OperationConflict,
    #[serde(rename = "STORAGE_ERROR")]
    StorageError,
}

impl PracticeSessionErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArgument => "The request parameters are invalid.",
            Self::InvalidState => {
                "The requested operation cannot be performed in the current state."
            }
            Self::NotFound => "The requested resource was not found.",
            Self::OperationConflict => "The operation could not be completed due to a conflict.",
            Self::StorageError => "A storage error occurred while saving the practice session.",
        }
    }

    pub fn error(self) -> PracticeSessionErrorWire {
        PracticeSessionErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

/// The allowlisted wire error returned across IPC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PracticeSessionErrorWire {
    pub code: PracticeSessionErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for PracticeSessionErrorWire {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for PracticeSessionErrorWire {}

pub type ResultCheck<T> = Result<T, PracticeSessionErrorCode>;

/// Verify RFC 4122 v4 UUID format.
pub fn is_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, &c)| match i {
            8 | 13 | 18 | 23 => c == b'-',
            14 => c == b'4',
            19 => matches!(c, b'8' | b'9' | b'a' | b'b'),
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

/// Verify identifier format: nonempty ASCII [A-Za-z0-9_.-] string up to 128 chars.
pub fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_CHARS
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
}

/// Count Unicode code points.
pub fn code_point_count(s: &str) -> usize {
    s.chars().count()
}

/// Canonicalize JSON value into a compact string with object keys sorted alphabetically.
pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap_or_default(),
        Value::Array(arr) => {
            let elements: Vec<String> = arr.iter().map(canonical_json).collect();
            format!("[{}]", elements.join(","))
        }
        Value::Object(map) => {
            let sorted: BTreeMap<&String, &Value> = map.iter().collect();
            let pairs: Vec<String> = sorted
                .into_iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap_or_default(),
                        canonical_json(v)
                    )
                })
                .collect();
            format!("{{{}}}", pairs.join(","))
        }
    }
}

/// Compute SHA-256 hash of canonical JSON string, returned as 64-char lowercase hex.
pub fn compute_canonical_hash(value: &Value) -> String {
    let canonical = canonical_json(value);
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a UUID v4 string using SQLite's cryptographic randomblob facility.
pub fn generate_uuid_v4(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))",
        [],
        |row| row.get(0),
    )
}

/// Authoritative UTC ISO-8601 string from SQLite.
pub fn db_now_iso(conn: &Connection) -> Result<String, rusqlite::Error> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
        r.get(0)
    })
}

fn exact_keys_check<'a>(
    map: &'a Map<String, Value>,
    allowed: &[&str],
) -> ResultCheck<&'a Map<String, Value>> {
    if map.len() != allowed.len() {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }
    for &key in allowed {
        if !map.contains_key(key) {
            return Err(PracticeSessionErrorCode::InvalidArgument);
        }
    }
    Ok(map)
}

fn parse_string_field<'a>(map: &'a Map<String, Value>, key: &str) -> ResultCheck<&'a str> {
    match map.get(key) {
        Some(Value::String(s)) => Ok(s.as_str()),
        _ => Err(PracticeSessionErrorCode::InvalidArgument),
    }
}

fn parse_i64_field(map: &Map<String, Value>, key: &str) -> ResultCheck<i64> {
    match map.get(key) {
        Some(Value::Number(n)) => n.as_i64().ok_or(PracticeSessionErrorCode::InvalidArgument),
        _ => Err(PracticeSessionErrorCode::InvalidArgument),
    }
}

fn parse_bool_field(map: &Map<String, Value>, key: &str) -> ResultCheck<bool> {
    match map.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        _ => Err(PracticeSessionErrorCode::InvalidArgument),
    }
}

/* ------------------------------------------------------------------ */
/* Action Payloads                                                    */
/* ------------------------------------------------------------------ */

#[derive(Debug)]
pub enum PracticeActionPayload {
    StartOrResume {
        operation_id: String,
        material_id: String,
        version_id: String,
    },
    RecordResponse {
        operation_id: String,
        attempt_id: String,
        item_id: String,
        expected_revision: i64,
        selected_index: Option<i64>,
        is_dont_know: bool,
    },
    CompleteAttempt {
        operation_id: String,
        attempt_id: String,
        expected_revision: i64,
    },
    RetakeAttempt {
        operation_id: String,
        expected_attempt_id: Option<String>,
        material_id: String,
        version_id: String,
    },
    AbandonAttempt {
        operation_id: String,
        attempt_id: String,
        expected_revision: i64,
    },
}

impl PracticeActionPayload {
    pub fn operation_id(&self) -> &str {
        match self {
            Self::StartOrResume { operation_id, .. }
            | Self::RecordResponse { operation_id, .. }
            | Self::CompleteAttempt { operation_id, .. }
            | Self::RetakeAttempt { operation_id, .. }
            | Self::AbandonAttempt { operation_id, .. } => operation_id,
        }
    }

    pub fn action_name(&self) -> &'static str {
        match self {
            Self::StartOrResume { .. } => "start_or_resume",
            Self::RecordResponse { .. } => "record_response",
            Self::CompleteAttempt { .. } => "complete_attempt",
            Self::RetakeAttempt { .. } => "retake_attempt",
            Self::AbandonAttempt { .. } => "abandon_attempt",
        }
    }
}

/// Strictly decode and validate an incoming action request value.
pub fn decode_practice_action(value: &Value) -> ResultCheck<PracticeActionPayload> {
    let payload_str = value.to_string();
    if payload_str.len() > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }

    let map = value
        .as_object()
        .ok_or(PracticeSessionErrorCode::InvalidArgument)?;
    let action = parse_string_field(map, "action")?;
    let operation_id = parse_string_field(map, "operationId")?;
    if !is_uuid_v4(operation_id) {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }

    match action {
        "start_or_resume" => {
            exact_keys_check(map, &["action", "operationId", "materialId", "versionId"])?;
            let material_id = parse_string_field(map, "materialId")?;
            let version_id = parse_string_field(map, "versionId")?;
            if !is_valid_id(material_id) || !is_valid_id(version_id) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            Ok(PracticeActionPayload::StartOrResume {
                operation_id: operation_id.to_string(),
                material_id: material_id.to_string(),
                version_id: version_id.to_string(),
            })
        }
        "record_response" => {
            exact_keys_check(
                map,
                &[
                    "action",
                    "operationId",
                    "attemptId",
                    "itemId",
                    "expectedRevision",
                    "selectedIndex",
                    "isDontKnow",
                ],
            )?;
            let attempt_id = parse_string_field(map, "attemptId")?;
            let item_id = parse_string_field(map, "itemId")?;
            if !is_valid_id(attempt_id) || !is_valid_id(item_id) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            let expected_revision = parse_i64_field(map, "expectedRevision")?;
            if !(0..=2_147_483_647).contains(&expected_revision) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            let is_dont_know = parse_bool_field(map, "isDontKnow")?;
            let selected_index = match map.get("selectedIndex") {
                Some(Value::Null) => None,
                Some(Value::Number(n)) => {
                    let idx = n
                        .as_i64()
                        .ok_or(PracticeSessionErrorCode::InvalidArgument)?;
                    if !(0..=100).contains(&idx) {
                        return Err(PracticeSessionErrorCode::InvalidArgument);
                    }
                    Some(idx)
                }
                _ => return Err(PracticeSessionErrorCode::InvalidArgument),
            };

            // Constraint: is_dont_know = 1 <-> selected_index is null
            if is_dont_know {
                if selected_index.is_some() {
                    return Err(PracticeSessionErrorCode::InvalidArgument);
                }
            } else if selected_index.is_none() {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }

            Ok(PracticeActionPayload::RecordResponse {
                operation_id: operation_id.to_string(),
                attempt_id: attempt_id.to_string(),
                item_id: item_id.to_string(),
                expected_revision,
                selected_index,
                is_dont_know,
            })
        }
        "complete_attempt" => {
            exact_keys_check(
                map,
                &["action", "operationId", "attemptId", "expectedRevision"],
            )?;
            let attempt_id = parse_string_field(map, "attemptId")?;
            if !is_valid_id(attempt_id) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            let expected_revision = parse_i64_field(map, "expectedRevision")?;
            if !(0..=2_147_483_647).contains(&expected_revision) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            Ok(PracticeActionPayload::CompleteAttempt {
                operation_id: operation_id.to_string(),
                attempt_id: attempt_id.to_string(),
                expected_revision,
            })
        }
        "retake_attempt" => {
            exact_keys_check(
                map,
                &[
                    "action",
                    "operationId",
                    "expectedAttemptId",
                    "materialId",
                    "versionId",
                ],
            )?;
            let material_id = parse_string_field(map, "materialId")?;
            let version_id = parse_string_field(map, "versionId")?;
            if !is_valid_id(material_id) || !is_valid_id(version_id) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            let expected_attempt_id = match map.get("expectedAttemptId") {
                Some(Value::Null) => None,
                Some(Value::String(s)) => {
                    if !is_valid_id(s) {
                        return Err(PracticeSessionErrorCode::InvalidArgument);
                    }
                    Some(s.clone())
                }
                _ => return Err(PracticeSessionErrorCode::InvalidArgument),
            };
            Ok(PracticeActionPayload::RetakeAttempt {
                operation_id: operation_id.to_string(),
                expected_attempt_id,
                material_id: material_id.to_string(),
                version_id: version_id.to_string(),
            })
        }
        "abandon_attempt" => {
            exact_keys_check(
                map,
                &["action", "operationId", "attemptId", "expectedRevision"],
            )?;
            let attempt_id = parse_string_field(map, "attemptId")?;
            if !is_valid_id(attempt_id) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            let expected_revision = parse_i64_field(map, "expectedRevision")?;
            if !(0..=2_147_483_647).contains(&expected_revision) {
                return Err(PracticeSessionErrorCode::InvalidArgument);
            }
            Ok(PracticeActionPayload::AbandonAttempt {
                operation_id: operation_id.to_string(),
                attempt_id: attempt_id.to_string(),
                expected_revision,
            })
        }
        _ => Err(PracticeSessionErrorCode::InvalidArgument),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EraseHistoryPayload {
    pub operation_id: String,
    pub history_key: String,
}

/// Strictly decode and validate an incoming erase history request.
pub fn decode_erase_history_action(value: &Value) -> ResultCheck<EraseHistoryPayload> {
    let payload_str = value.to_string();
    if payload_str.len() > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }

    let map = value
        .as_object()
        .ok_or(PracticeSessionErrorCode::InvalidArgument)?;
    exact_keys_check(map, &["action", "operationId", "historyKey"])?;

    let action = parse_string_field(map, "action")?;
    if action != "erase_history" {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }

    let operation_id = parse_string_field(map, "operationId")?;
    if !is_uuid_v4(operation_id) {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }

    let history_key = parse_string_field(map, "historyKey")?;
    if !is_valid_id(history_key) {
        return Err(PracticeSessionErrorCode::InvalidArgument);
    }

    Ok(EraseHistoryPayload {
        operation_id: operation_id.to_string(),
        history_key: history_key.to_string(),
    })
}

/* ------------------------------------------------------------------ */
/* Execution Engine & State Machine                                   */
/* ------------------------------------------------------------------ */

/// Build the current PracticeSessionState wire shape for an in-progress attempt.
fn build_session_state(tx: &Transaction, attempt_id: &str) -> ResultCheck<Value> {
    let (version_id, started_at, total_questions, answered_count, revision): (
        String,
        String,
        i64,
        i64,
        i64,
    ) = tx
        .query_row(
            "SELECT version_id, started_at, total_questions, answered_count, revision
             FROM practice_attempts WHERE id = ?1 AND status = 'in_progress'",
            [attempt_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(|_| PracticeSessionErrorCode::StorageError)?
        .ok_or(PracticeSessionErrorCode::NotFound)?;

    // Fetch responses
    let mut stmt = tx
        .prepare(
            "SELECT item_id, selected_index, is_dont_know, is_correct, answered_at
             FROM practice_responses WHERE attempt_id = ?1 ORDER BY answered_at ASC, id ASC",
        )
        .map_err(|_| PracticeSessionErrorCode::StorageError)?;
    let response_rows = stmt
        .query_map([attempt_id], |row| {
            let is_dont_know: i64 = row.get(2)?;
            let is_correct: i64 = row.get(3)?;
            Ok(serde_json::json!({
                "itemId": row.get::<_, String>(0)?,
                "selectedIndex": row.get::<_, Option<i64>>(1)?,
                "isDontKnow": is_dont_know == 1,
                "isCorrect": is_correct == 1,
                "answeredAt": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|_| PracticeSessionErrorCode::StorageError)?;

    let mut responses = Vec::new();
    for r in response_rows {
        responses.push(r.map_err(|_| PracticeSessionErrorCode::StorageError)?);
    }

    // Determine nextUnansweredOrdinal: smallest ordinal in practice_test_items not in responses
    let next_unanswered_ordinal: Option<i64> = tx
        .query_row(
            "SELECT ordinal FROM practice_test_items
             WHERE version_id = ?1 AND id NOT IN (
                 SELECT item_id FROM practice_responses WHERE attempt_id = ?2
             ) ORDER BY ordinal ASC LIMIT 1",
            params![&version_id, attempt_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| PracticeSessionErrorCode::StorageError)?;

    Ok(serde_json::json!({
        "attemptId": attempt_id,
        "versionId": version_id,
        "status": "in_progress",
        "startedAt": started_at,
        "completedAt": null,
        "totalQuestions": total_questions,
        "answeredCount": answered_count,
        "revision": revision,
        "nextUnansweredOrdinal": next_unanswered_ordinal,
        "responses": responses,
    }))
}

/// Execute a state-modifying action within an open immediate transaction.
pub fn execute_action_transaction(
    tx: &Transaction,
    action: &PracticeActionPayload,
    request_value: &Value,
) -> ResultCheck<Value> {
    let operation_id = action.operation_id();
    let action_name = action.action_name();
    let current_hash = compute_canonical_hash(request_value);

    // 1. Inspect practice_session_operations for idempotent replay or conflict
    let receipt: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT request_hash, result_json, is_erased FROM practice_session_operations WHERE operation_id = ?1",
            [operation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|_| PracticeSessionErrorCode::StorageError)?;

    if let Some((stored_hash, result_json, is_erased)) = receipt {
        if stored_hash != current_hash {
            return Err(PracticeSessionErrorCode::OperationConflict);
        }
        if is_erased == 1 {
            return Err(PracticeSessionErrorCode::InvalidState);
        }
        let parsed_result: Value = serde_json::from_str(&result_json)
            .map_err(|_| PracticeSessionErrorCode::StorageError)?;
        return Ok(parsed_result);
    }

    let now = db_now_iso(tx).map_err(|_| PracticeSessionErrorCode::StorageError)?;

    // 2. Execute new action
    let (history_key, attempt_id, result_val) = match action {
        PracticeActionPayload::StartOrResume {
            material_id,
            version_id,
            ..
        } => {
            // Verify version exists, belongs to material_id, and is active
            let version_row: Option<(String, String, i64)> = tx
                .query_row(
                    "SELECT history_key, source_material_title, is_active
                     FROM practice_test_versions WHERE id = ?1 AND source_material_id = ?2",
                    params![version_id, material_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let (h_key, material_title, _is_active) = match version_row {
                Some((h, t, act)) if act == 1 => (h, t, act),
                _ => return Err(PracticeSessionErrorCode::NotFound),
            };

            // Check if there is an existing in_progress attempt
            let existing_attempt_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM practice_attempts WHERE source_material_id = ?1 AND status = 'in_progress'",
                    [material_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let att_id = if let Some(existing_id) = existing_attempt_id {
                existing_id
            } else {
                // Create a new attempt
                let count: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM practice_test_items WHERE version_id = ?1",
                        [version_id],
                        |r| r.get(0),
                    )
                    .map_err(|_| PracticeSessionErrorCode::StorageError)?;

                let new_id =
                    generate_uuid_v4(tx).map_err(|_| PracticeSessionErrorCode::StorageError)?;
                tx.execute(
                    "INSERT INTO practice_attempts (
                        id, version_id, source_material_id, source_material_title,
                        started_at, completed_at, status, revision, total_questions,
                        answered_count, correct_count, incorrect_count, dont_know_count, score_percent
                     ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'in_progress', 0, ?6, 0, 0, 0, 0, NULL)",
                    params![new_id, version_id, material_id, material_title, now, count],
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;
                new_id
            };

            let state = build_session_state(tx, &att_id)?;
            (h_key, att_id, state)
        }

        PracticeActionPayload::RetakeAttempt {
            expected_attempt_id,
            material_id,
            version_id,
            ..
        } => {
            // Verify version exists, belongs to material_id, and is active
            let version_row: Option<(String, String, i64)> = tx
                .query_row(
                    "SELECT history_key, source_material_title, is_active
                     FROM practice_test_versions WHERE id = ?1 AND source_material_id = ?2",
                    params![version_id, material_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let (h_key, material_title, _is_active) = match version_row {
                Some((h, t, act)) if act == 1 => (h, t, act),
                _ => return Err(PracticeSessionErrorCode::NotFound),
            };

            // Look up current in_progress attempt
            let current_in_progress: Option<String> = tx
                .query_row(
                    "SELECT id FROM practice_attempts WHERE source_material_id = ?1 AND status = 'in_progress'",
                    [material_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            match (current_in_progress, expected_attempt_id) {
                (Some(curr_id), Some(expected_id)) => {
                    if curr_id != *expected_id {
                        return Err(PracticeSessionErrorCode::InvalidState);
                    }
                    // Abandon current attempt
                    tx.execute(
                        "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?1, revision = revision + 1 WHERE id = ?2",
                        params![now, curr_id],
                    )
                    .map_err(|_| PracticeSessionErrorCode::StorageError)?;
                }
                (Some(_), None) => {
                    return Err(PracticeSessionErrorCode::InvalidState);
                }
                (None, Some(_)) => {
                    return Err(PracticeSessionErrorCode::InvalidState);
                }
                (None, None) => {
                    // No current in_progress attempt and none expected, continue
                }
            }

            // Create fresh attempt
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_test_items WHERE version_id = ?1",
                    [version_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let new_id =
                generate_uuid_v4(tx).map_err(|_| PracticeSessionErrorCode::StorageError)?;
            tx.execute(
                "INSERT INTO practice_attempts (
                    id, version_id, source_material_id, source_material_title,
                    started_at, completed_at, status, revision, total_questions,
                    answered_count, correct_count, incorrect_count, dont_know_count, score_percent
                 ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'in_progress', 0, ?6, 0, 0, 0, 0, NULL)",
                params![new_id, version_id, material_id, material_title, now, count],
            )
            .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let state = build_session_state(tx, &new_id)?;
            (h_key, new_id, state)
        }

        PracticeActionPayload::RecordResponse {
            attempt_id,
            item_id,
            expected_revision,
            selected_index,
            is_dont_know,
            ..
        } => {
            // Verify attempt exists and is in_progress
            let attempt_row: Option<(String, i64, String)> = tx
                .query_row(
                    "SELECT a.version_id, a.revision, v.history_key
                     FROM practice_attempts a
                     JOIN practice_test_versions v ON a.version_id = v.id
                     WHERE a.id = ?1 AND a.status = 'in_progress'",
                    [attempt_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let (version_id, current_revision, h_key) = match attempt_row {
                Some(row) => row,
                None => {
                    // Check if attempt exists with different status
                    let exists: bool = tx
                        .query_row(
                            "SELECT 1 FROM practice_attempts WHERE id = ?1",
                            [attempt_id],
                            |_| Ok(()),
                        )
                        .optional()
                        .map_err(|_| PracticeSessionErrorCode::StorageError)?
                        .is_some();
                    if exists {
                        return Err(PracticeSessionErrorCode::InvalidState);
                    } else {
                        return Err(PracticeSessionErrorCode::NotFound);
                    }
                }
            };

            if current_revision != *expected_revision {
                return Err(PracticeSessionErrorCode::InvalidState);
            }

            // Verify item belongs to attempt version
            let item_row: Option<(i64, String)> = tx
                .query_row(
                    "SELECT correct_index, options_json FROM practice_test_items WHERE id = ?1 AND version_id = ?2",
                    params![item_id, version_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let (correct_index, options_json) = match item_row {
                Some(row) => row,
                None => return Err(PracticeSessionErrorCode::NotFound),
            };

            let options: Vec<String> = serde_json::from_str(&options_json)
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            if let Some(sel) = selected_index {
                if *sel < 0 || *sel >= options.len() as i64 {
                    return Err(PracticeSessionErrorCode::InvalidArgument);
                }
            }

            let is_correct = !is_dont_know && selected_index.is_some_and(|s| s == correct_index);

            // Check if response already exists
            let existing_response: Option<(Option<i64>, i64, String)> = tx
                .query_row(
                    "SELECT selected_index, is_dont_know, answered_at FROM practice_responses WHERE attempt_id = ?1 AND item_id = ?2",
                    params![attempt_id, item_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let mut final_revision = current_revision;
            let mut result_answered_at = now.clone();

            if let Some((stored_sel, stored_dont_know, stored_answered_at)) = existing_response {
                let stored_dk_bool = stored_dont_know == 1;
                if stored_sel == *selected_index && stored_dk_bool == *is_dont_know {
                    // Identical already-stored choice is a no-op on state/revision/answered_at,
                    // but still writes operation receipt below!
                    result_answered_at = stored_answered_at;
                } else {
                    // Update response
                    tx.execute(
                        "UPDATE practice_responses SET selected_index = ?1, is_dont_know = ?2, is_correct = ?3, answered_at = ?4 WHERE attempt_id = ?5 AND item_id = ?6",
                        params![
                            selected_index,
                            if *is_dont_know { 1 } else { 0 },
                            if is_correct { 1 } else { 0 },
                            now,
                            attempt_id,
                            item_id,
                        ],
                    )
                    .map_err(|_| PracticeSessionErrorCode::StorageError)?;

                    final_revision += 1;
                    tx.execute(
                        "UPDATE practice_attempts SET revision = ?1 WHERE id = ?2",
                        params![final_revision, attempt_id],
                    )
                    .map_err(|_| PracticeSessionErrorCode::StorageError)?;
                }
            } else {
                // Insert new response
                let resp_id =
                    generate_uuid_v4(tx).map_err(|_| PracticeSessionErrorCode::StorageError)?;
                tx.execute(
                    "INSERT INTO practice_responses (
                        id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        resp_id,
                        attempt_id,
                        item_id,
                        selected_index,
                        if *is_dont_know { 1 } else { 0 },
                        if is_correct { 1 } else { 0 },
                        now,
                    ],
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

                final_revision += 1;
                tx.execute(
                    "UPDATE practice_attempts SET revision = ?1, answered_count = (SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?2) WHERE id = ?2",
                    params![final_revision, attempt_id],
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;
            }

            let ans_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1",
                    [attempt_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let res = serde_json::json!({
                "attemptId": attempt_id,
                "itemId": item_id,
                "answeredCount": ans_count,
                "revision": final_revision,
                "isCorrect": is_correct,
                "answeredAt": result_answered_at,
            });

            (h_key, attempt_id.clone(), res)
        }

        PracticeActionPayload::CompleteAttempt {
            attempt_id,
            expected_revision,
            ..
        } => {
            // Verify attempt exists and is in_progress
            let attempt_row: Option<(String, String, i64, i64, String)> = tx
                .query_row(
                    "SELECT a.version_id, a.started_at, a.revision, a.total_questions, v.history_key
                     FROM practice_attempts a
                     JOIN practice_test_versions v ON a.version_id = v.id
                     WHERE a.id = ?1 AND a.status = 'in_progress'",
                    [attempt_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let (version_id, started_at, current_revision, _total_questions, h_key) =
                match attempt_row {
                    Some(row) => row,
                    None => {
                        let exists: bool = tx
                            .query_row(
                                "SELECT 1 FROM practice_attempts WHERE id = ?1",
                                [attempt_id],
                                |_| Ok(()),
                            )
                            .optional()
                            .map_err(|_| PracticeSessionErrorCode::StorageError)?
                            .is_some();
                        if exists {
                            return Err(PracticeSessionErrorCode::InvalidState);
                        } else {
                            return Err(PracticeSessionErrorCode::NotFound);
                        }
                    }
                };

            if current_revision != *expected_revision {
                return Err(PracticeSessionErrorCode::InvalidState);
            }

            // Derive counts strictly from frozen questions and stored responses
            let actual_total: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_test_items WHERE version_id = ?1",
                    [&version_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let answered_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1",
                    [attempt_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let correct_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_responses r
                     JOIN practice_test_items i ON r.item_id = i.id
                     WHERE r.attempt_id = ?1 AND r.is_dont_know = 0 AND r.selected_index = i.correct_index",
                    [attempt_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let dont_know_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1 AND is_dont_know = 1",
                    [attempt_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let incorrect_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM practice_responses r
                     JOIN practice_test_items i ON r.item_id = i.id
                     WHERE r.attempt_id = ?1 AND r.is_dont_know = 0 AND r.selected_index != i.correct_index",
                    [attempt_id],
                    |r| r.get(0),
                )
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let unanswered_count = actual_total - answered_count;
            let score_percent = if actual_total > 0 {
                ((correct_count as f64 / actual_total as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            };

            let final_revision = current_revision + 1;

            tx.execute(
                "UPDATE practice_attempts SET
                    status = 'completed',
                    completed_at = ?1,
                    revision = ?2,
                    total_questions = ?3,
                    answered_count = ?4,
                    correct_count = ?5,
                    incorrect_count = ?6,
                    dont_know_count = ?7,
                    score_percent = ?8
                 WHERE id = ?9",
                params![
                    now,
                    final_revision,
                    actual_total,
                    answered_count,
                    correct_count,
                    incorrect_count,
                    dont_know_count,
                    score_percent,
                    attempt_id,
                ],
            )
            .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let res = serde_json::json!({
                "attemptId": attempt_id,
                "status": "completed",
                "startedAt": started_at,
                "completedAt": now,
                "totalQuestions": actual_total,
                "answeredCount": answered_count,
                "revision": final_revision,
                "correctCount": correct_count,
                "incorrectCount": incorrect_count,
                "dontKnowCount": dont_know_count,
                "unansweredCount": unanswered_count,
                "scorePercent": score_percent,
            });

            (h_key, attempt_id.clone(), res)
        }

        PracticeActionPayload::AbandonAttempt {
            attempt_id,
            expected_revision,
            ..
        } => {
            // Verify attempt exists and is in_progress
            let attempt_row: Option<(i64, String)> = tx
                .query_row(
                    "SELECT a.revision, v.history_key
                     FROM practice_attempts a
                     JOIN practice_test_versions v ON a.version_id = v.id
                     WHERE a.id = ?1 AND a.status = 'in_progress'",
                    [attempt_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let (current_revision, h_key) = match attempt_row {
                Some(row) => row,
                None => {
                    let exists: bool = tx
                        .query_row(
                            "SELECT 1 FROM practice_attempts WHERE id = ?1",
                            [attempt_id],
                            |_| Ok(()),
                        )
                        .optional()
                        .map_err(|_| PracticeSessionErrorCode::StorageError)?
                        .is_some();
                    if exists {
                        return Err(PracticeSessionErrorCode::InvalidState);
                    } else {
                        return Err(PracticeSessionErrorCode::NotFound);
                    }
                }
            };

            if current_revision != *expected_revision {
                return Err(PracticeSessionErrorCode::InvalidState);
            }

            let final_revision = current_revision + 1;

            tx.execute(
                "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?1, revision = ?2 WHERE id = ?3",
                params![now, final_revision, attempt_id],
            )
            .map_err(|_| PracticeSessionErrorCode::StorageError)?;

            let res = serde_json::json!({
                "attemptId": attempt_id,
                "status": "abandoned",
                "revision": final_revision,
                "completedAt": now,
            });

            (h_key, attempt_id.clone(), res)
        }
    };

    // 3. Store durable operation receipt
    let result_json =
        serde_json::to_string(&result_val).map_err(|_| PracticeSessionErrorCode::StorageError)?;

    tx.execute(
        "INSERT INTO practice_session_operations (
            operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        params![
            operation_id,
            action_name,
            current_hash,
            now,
            result_json,
            history_key,
            attempt_id,
        ],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError)?;

    Ok(result_val)
}

/// Execute save_practice_session_atomically at a specified database root.
pub fn save_practice_session_at(
    root: &Path,
    action_value: &Value,
) -> Result<Value, PracticeSessionErrorWire> {
    let payload = decode_practice_action(action_value).map_err(|c| c.error())?;
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(PracticeSessionErrorCode::StorageError.error());
    }

    if !is_root_ready(root) {
        return Err(PracticeSessionErrorCode::InvalidState.error());
    }

    let mut connection =
        Connection::open(&db_path).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    if let Err(e) = ensure_legacy_conversion_ready(&connection) {
        unmark_root_ready(root);
        return Err(e);
    }

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    let result = execute_action_transaction(&tx, &payload, action_value).map_err(|c| c.error())?;

    tx.commit()
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    Ok(result)
}

/// Execute erase_practice_history_atomically at a specified database root.
pub fn erase_practice_history_at(
    root: &Path,
    action_value: &Value,
) -> Result<Value, PracticeSessionErrorWire> {
    let payload = decode_erase_history_action(action_value).map_err(|c| c.error())?;
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(PracticeSessionErrorCode::StorageError.error());
    }

    if !is_root_ready(root) {
        return Err(PracticeSessionErrorCode::InvalidState.error());
    }

    let mut connection =
        Connection::open(&db_path).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    if let Err(e) = ensure_legacy_conversion_ready(&connection) {
        unmark_root_ready(root);
        return Err(e);
    }

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    let current_hash = compute_canonical_hash(action_value);

    // 1. Inspect practice_session_operations for replay or conflict
    let receipt: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT request_hash, result_json, is_erased FROM practice_session_operations WHERE operation_id = ?1",
            [&payload.operation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    if let Some((stored_hash, result_json, is_erased)) = receipt {
        if stored_hash != current_hash {
            return Err(PracticeSessionErrorCode::OperationConflict.error());
        }
        if is_erased == 1 {
            return Err(PracticeSessionErrorCode::InvalidState.error());
        }
        let parsed_result: Value = serde_json::from_str(&result_json)
            .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
        return Ok(parsed_result);
    }

    // 2. Turn associated receipts into non-content tombstones sufficient to refuse old replay
    tx.execute(
        "UPDATE practice_session_operations SET is_erased = 1, result_json = 'null' WHERE history_key = ?1",
        [&payload.history_key],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 3. Remove saved attempts/responses (including unfinished progress under that key)
    tx.execute(
        "DELETE FROM practice_attempts WHERE version_id IN (SELECT id FROM practice_test_versions WHERE history_key = ?1)",
        [&payload.history_key],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 4. Remove unused inactive versions/items under that key
    tx.execute(
        "DELETE FROM practice_test_versions WHERE history_key = ?1 AND is_active = 0",
        [&payload.history_key],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 5. Store erasure receipt
    let now = db_now_iso(&tx).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    let result_val = serde_json::json!({
        "action": "erase_history",
        "historyKey": payload.history_key,
        "erased": true,
    });
    let result_json = serde_json::to_string(&result_val)
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    tx.execute(
        "INSERT INTO practice_session_operations (
            operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
         ) VALUES (?1, 'erase_history', ?2, ?3, ?4, ?5, ?6, 0)",
        params![
            payload.operation_id,
            current_hash,
            now,
            result_json,
            payload.history_key,
            payload.history_key,
        ],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    tx.commit()
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    Ok(result_val)
}

/* ------------------------------------------------------------------ */
/* Legacy Practice Tests Conversion                                    */
/* ------------------------------------------------------------------ */

#[derive(Debug)]
pub struct ParsedLegacyQuestion {
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
    pub explanation: String,
    pub source_page: Option<i64>,
}

pub fn validate_legacy_questions(raw_json: &str) -> Option<Vec<ParsedLegacyQuestion>> {
    let parsed: Value = serde_json::from_str(raw_json).ok()?;
    let arr = parsed.as_array()?;
    if arr.is_empty() || arr.len() > MAX_PRACTICE_QUESTIONS {
        return None;
    }

    let mut questions = Vec::with_capacity(arr.len());
    for item in arr {
        let obj = item.as_object()?;
        let q_text = obj.get("question")?.as_str()?;
        let q_len = code_point_count(q_text);
        if q_len == 0 || q_len > MAX_QUESTION_CHARS {
            return None;
        }

        let opts_arr = obj.get("options")?.as_array()?;
        if opts_arr.len() < MIN_OPTIONS || opts_arr.len() > MAX_OPTIONS {
            return None;
        }

        let mut options = Vec::with_capacity(opts_arr.len());
        for opt in opts_arr {
            let opt_str = opt.as_str()?;
            let opt_len = code_point_count(opt_str);
            if opt_len == 0 || opt_len > MAX_OPTION_CHARS {
                return None;
            }
            options.push(opt_str.to_string());
        }

        let correct_idx = obj.get("correctIndex")?.as_i64()?;
        if correct_idx < 0 || correct_idx >= options.len() as i64 {
            return None;
        }

        let explanation = match obj.get("explanation") {
            Some(Value::String(s)) => {
                if code_point_count(s) > MAX_EXPLANATION_CHARS {
                    return None;
                }
                s.clone()
            }
            Some(Value::Null) | None => String::new(),
            _ => return None,
        };

        let source_page = match obj.get("sourcePage") {
            Some(Value::Null) | None => None,
            Some(Value::Number(n)) => {
                let page = n.as_i64()?;
                if !(1..=1_000).contains(&page) {
                    return None;
                }
                Some(page)
            }
            _ => return None,
        };

        questions.push(ParsedLegacyQuestion {
            question: q_text.to_string(),
            options,
            correct_index: correct_idx as usize,
            explanation,
            source_page,
        });
    }

    Some(questions)
}

#[derive(serde::Serialize)]
pub struct CanonicalQuestion<'a> {
    #[serde(rename = "correctIndex")]
    pub correct_index: usize,
    pub explanation: &'a str,
    pub options: &'a [String],
    pub question: &'a str,
    #[serde(rename = "sourcePage")]
    pub source_page: Option<i64>,
}

pub fn compute_canonical_content_hash(
    questions: &[CanonicalQuestion<'_>],
) -> Result<String, String> {
    let json = serde_json::to_string(questions)
        .map_err(|e| format!("Failed to serialize canonical questions: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

pub fn compute_canonical_content_hash_from_parsed(questions: &[ParsedLegacyQuestion]) -> String {
    let canonical: Vec<CanonicalQuestion<'_>> = questions
        .iter()
        .map(|q| CanonicalQuestion {
            correct_index: q.correct_index,
            explanation: &q.explanation,
            options: &q.options,
            question: &q.question,
            source_page: q.source_page,
        })
        .collect();
    let json = serde_json::to_string(&canonical).expect("Canonical serialization cannot fail");
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn ensure_legacy_conversion_ready(conn: &Connection) -> Result<(), PracticeSessionErrorWire> {
    let unmigrated_result: Result<i64, _> = conn.query_row(
        "SELECT COUNT(*) FROM practice_tests WHERE legacy_migrated_at IS NULL AND legacy_error IS NULL",
        [],
        |r| r.get(0),
    );
    match unmigrated_result {
        Ok(count) => {
            if count > 0 {
                return Err(PracticeSessionErrorCode::InvalidState.error());
            }
            Ok(())
        }
        Err(_) => Err(PracticeSessionErrorCode::InvalidState.error()),
    }
}

/// Initialize practice sessions for a root: convert legacy tests and validate
/// the whole application database on one transaction, commit only when both
/// succeed, then publish readiness for the generation that was validated.
///
/// Readiness is revoked at entry, so every failure (including an early
/// conversion error) leaves the root not ready. A failure rolls back, keeping
/// legacy rows, versions, progress and receipts exactly as they were.
pub fn run_legacy_conversion_at(root: &Path) -> Result<usize, String> {
    let generation = readiness_generation(root);
    unmark_root_ready(root);
    let converted = convert_and_validate_at(root)?;
    #[cfg(test)]
    BEFORE_READY_PUBLISH.with(|hook| {
        if let Some(hook) = hook.borrow().as_ref() {
            hook(root);
        }
    });
    if !mark_root_ready_at_generation(root, generation) {
        return Err(
            "The database was restored while it was being prepared. Try again.".to_string(),
        );
    }
    Ok(converted)
}

/// Legacy conversion plus full application validation on one owned
/// transaction; nothing commits unless validation of the pending state passes.
fn convert_and_validate_at(root: &Path) -> Result<usize, String> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err("Database file not found".to_string());
    }

    let mut conn = Connection::open(&db_path).map_err(|e| format!("DB open error: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Busy timeout error: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Pragma foreign_keys error: {e}"))?;

    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Transaction error: {e}"))?;

    let now: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .map_err(|e| format!("Time query error: {e}"))?;

    // Select legacy rows that need conversion
    let mut stmt = tx
        .prepare(
            "SELECT source_material_id, title, questions_json, provider, model, generated_at
             FROM practice_tests
             WHERE legacy_migrated_at IS NULL
               AND legacy_error IS NULL",
        )
        .map_err(|e| format!("Prepare error: {e}"))?;

    let rows: Vec<(String, String, String, String, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .map_err(|e| format!("Query map error: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Collect error: {e}"))?;

    drop(stmt);

    let mut converted_count = 0;
    for (material_id, title, questions_json, provider, model, generated_at) in rows {
        let valid_questions = validate_legacy_questions(&questions_json);
        match valid_questions {
            None => {
                tx.execute(
                    "UPDATE practice_tests SET legacy_error = 'MALFORMED_QUESTION' WHERE source_material_id = ?1",
                    [&material_id],
                )
                .map_err(|e| format!("Update legacy error: {e}"))?;
            }
            Some(questions) => {
                let content_hash = compute_canonical_content_hash_from_parsed(&questions);

                // Check if an active version already exists for this material
                let existing_version: Option<(String, String)> = tx
                    .query_row(
                        "SELECT id, content_hash FROM practice_test_versions WHERE source_material_id = ?1 AND is_active = 1",
                        [&material_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()
                    .map_err(|e| format!("Query existing version error: {e}"))?;

                if let Some((ver_id, active_hash)) = existing_version {
                    // Check if content matches
                    let mut items_stmt = tx
                        .prepare(
                            "SELECT ordinal, question_text, options_json, correct_index, explanation, source_page
                             FROM practice_test_items WHERE version_id = ?1 ORDER BY ordinal ASC",
                        )
                        .map_err(|e| format!("Prepare items check: {e}"))?;

                    let stored_items: Vec<(i64, String, String, i64, String, Option<i64>)> =
                        items_stmt
                            .query_map([&ver_id], |r| {
                                Ok((
                                    r.get(0)?,
                                    r.get(1)?,
                                    r.get(2)?,
                                    r.get(3)?,
                                    r.get(4)?,
                                    r.get(5)?,
                                ))
                            })
                            .map_err(|e| format!("Query items error: {e}"))?
                            .collect::<Result<_, _>>()
                            .map_err(|e| format!("Collect items error: {e}"))?;

                    let matches = active_hash == content_hash
                        && stored_items.len() == questions.len()
                        && stored_items.iter().enumerate().all(|(i, item)| {
                            let q = &questions[i];
                            let opts: Result<Vec<String>, _> = serde_json::from_str(&item.2);
                            item.1 == q.question
                                && item.3 == q.correct_index as i64
                                && item.4 == q.explanation
                                && item.5 == q.source_page
                                && opts.is_ok_and(|o| o == q.options)
                        });

                    if matches {
                        // Matching version repairs the unset marker without duplicating!
                        tx.execute(
                            "UPDATE practice_tests SET legacy_migrated_at = ?1, legacy_error = NULL WHERE source_material_id = ?2",
                            params![now, material_id],
                        )
                        .map_err(|e| format!("Update migrated_at error: {e}"))?;
                        converted_count += 1;
                        continue;
                    } else {
                        // Conflicting version: legacy content differs from existing version! Refuse startup!
                        return Err(format!(
                            "Conflicting legacy practice test for material {material_id}"
                        ));
                    }
                }

                let material_title: String = tx
                    .query_row(
                        "SELECT title FROM study_materials WHERE id = ?1",
                        [&material_id],
                        |r| r.get(0),
                    )
                    .unwrap_or_else(|_| title.clone());

                let version_id = generate_uuid_v4(&tx).map_err(|e| format!("UUID error: {e}"))?;

                // Insert into practice_test_versions
                tx.execute(
                    "INSERT INTO practice_test_versions (
                        id, source_material_id, history_key, source_material_title,
                        version_number, provider, model, title, content_hash, created_at, is_active
                     ) VALUES (?1, ?2, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, 1)",
                    params![
                        version_id,
                        material_id,
                        material_title,
                        provider,
                        model,
                        title,
                        content_hash,
                        generated_at,
                    ],
                )
                .map_err(|e| format!("Insert version error: {e}"))?;

                // Insert items
                for (ordinal, q) in questions.iter().enumerate() {
                    let item_id = generate_uuid_v4(&tx).map_err(|e| format!("UUID error: {e}"))?;
                    let options_json = serde_json::to_string(&q.options)
                        .map_err(|e| format!("JSON options error: {e}"))?;
                    tx.execute(
                        "INSERT INTO practice_test_items (
                            id, version_id, ordinal, question_text, options_json,
                            correct_index, explanation, source_page
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            item_id,
                            version_id,
                            ordinal as i64,
                            q.question,
                            options_json,
                            q.correct_index as i64,
                            q.explanation,
                            q.source_page,
                        ],
                    )
                    .map_err(|e| format!("Insert item error: {e}"))?;
                }

                // Mark legacy test as migrated
                tx.execute(
                    "UPDATE practice_tests SET legacy_migrated_at = ?1, legacy_error = NULL WHERE source_material_id = ?2",
                    params![now, material_id],
                )
                .map_err(|e| format!("Update migrated_at error: {e}"))?;

                converted_count += 1;
            }
        }
    }

    // Validate the pending state on this same transaction: a separate
    // connection would only see the bytes from before the conversion.
    crate::backup::verify_application_connection(&tx)
        .map_err(|e| format!("Semantic validation failed: {e}"))?;
    tx.commit().map_err(|e| format!("Commit error: {e}"))?;
    Ok(converted_count)
}

/* ------------------------------------------------------------------ */
/* Gemini Save / Regeneration & Remove Practice Test                  */
/* ------------------------------------------------------------------ */

pub fn save_practice_test_at(
    root: &Path,
    source_material_id: &str,
    title: &str,
    questions_json: &str,
    model: &str,
) -> Result<(), PracticeSessionErrorWire> {
    let valid_questions = validate_legacy_questions(questions_json)
        .ok_or_else(|| PracticeSessionErrorCode::InvalidArgument.error())?;

    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(PracticeSessionErrorCode::StorageError.error());
    }

    if !is_root_ready(root) {
        return Err(PracticeSessionErrorCode::InvalidState.error());
    }

    let mut conn =
        Connection::open(&db_path).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    if let Err(e) = ensure_legacy_conversion_ready(&conn) {
        unmark_root_ready(root);
        return Err(e);
    }

    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    let now = db_now_iso(&tx).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 1. Deactivate existing active version
    tx.execute(
        "UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ?1 AND is_active = 1",
        [source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 2. Abandon old in_progress attempt
    tx.execute(
        "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?1, revision = revision + 1 WHERE source_material_id = ?2 AND status = 'in_progress'",
        params![now, source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 3. Next version number
    let next_version_num: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM practice_test_versions WHERE source_material_id = ?1",
            [source_material_id],
            |r| r.get(0),
        )
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    let material_title: String = tx
        .query_row(
            "SELECT title FROM study_materials WHERE id = ?1",
            [source_material_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| title.to_string());

    let version_id =
        generate_uuid_v4(&tx).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    let content_hash = compute_canonical_content_hash_from_parsed(&valid_questions);

    // 4. Insert new version
    tx.execute(
        "INSERT INTO practice_test_versions (
            id, source_material_id, history_key, source_material_title,
            version_number, provider, model, title, content_hash, created_at, is_active
         ) VALUES (?1, ?2, ?2, ?3, ?4, 'gemini', ?5, ?6, ?7, ?8, 1)",
        params![
            version_id,
            source_material_id,
            material_title,
            next_version_num,
            model,
            title,
            content_hash,
            now,
        ],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 5. Insert items
    for (ordinal, q) in valid_questions.iter().enumerate() {
        let item_id =
            generate_uuid_v4(&tx).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
        let options_json = serde_json::to_string(&q.options)
            .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
        tx.execute(
            "INSERT INTO practice_test_items (
                id, version_id, ordinal, question_text, options_json,
                correct_index, explanation, source_page
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                item_id,
                version_id,
                ordinal as i64,
                q.question,
                options_json,
                q.correct_index as i64,
                q.explanation,
                q.source_page,
            ],
        )
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    }

    // 6. Update legacy row and clear error
    tx.execute(
        "INSERT INTO practice_tests (
            source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error
         ) VALUES (?1, ?2, ?3, 'gemini', ?4, ?5, ?5, ?5, NULL)
         ON CONFLICT(source_material_id) DO UPDATE SET
            title = excluded.title,
            questions_json = excluded.questions_json,
            provider = excluded.provider,
            model = excluded.model,
            generated_at = excluded.generated_at,
            updated_at = excluded.updated_at,
            legacy_migrated_at = excluded.legacy_migrated_at,
            legacy_error = NULL",
        params![
            source_material_id,
            title,
            questions_json,
            model,
            now,
        ],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    tx.commit()
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    Ok(())
}

pub fn remove_practice_test_at(
    root: &Path,
    source_material_id: &str,
) -> Result<(), PracticeSessionErrorWire> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(PracticeSessionErrorCode::StorageError.error());
    }

    if !is_root_ready(root) {
        return Err(PracticeSessionErrorCode::InvalidState.error());
    }

    let mut conn =
        Connection::open(&db_path).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    if let Err(e) = ensure_legacy_conversion_ready(&conn) {
        unmark_root_ready(root);
        return Err(e);
    }

    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 1. Deactivate active version
    tx.execute(
        "UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ?1 AND is_active = 1",
        [source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 2. Tombstone operations for in_progress/abandoned attempts
    tx.execute(
        "UPDATE practice_session_operations SET is_erased = 1, result_json = 'null'
         WHERE attempt_id IN (
             SELECT id FROM practice_attempts WHERE source_material_id = ?1 AND status IN ('in_progress', 'abandoned')
         )",
        [source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 3. Delete in_progress and abandoned attempts
    tx.execute(
        "DELETE FROM practice_attempts WHERE source_material_id = ?1 AND status IN ('in_progress', 'abandoned')",
        [source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 4. Prune versions with 0 completed attempts
    tx.execute(
        "DELETE FROM practice_test_versions
         WHERE source_material_id = ?1
           AND id NOT IN (SELECT DISTINCT version_id FROM practice_attempts WHERE status = 'completed')",
        [source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    // 5. Delete legacy row
    tx.execute(
        "DELETE FROM practice_tests WHERE source_material_id = ?1",
        [source_material_id],
    )
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    tx.commit()
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?;

    Ok(())
}

/* ------------------------------------------------------------------ */
/* Tauri Command Handlers                                             */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn save_practice_session_atomically(
    app: AppHandle,
    action: Value,
) -> Result<Value, PracticeSessionErrorWire> {
    let root = app_root(&app).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || save_practice_session_at(&root, &action))
        .await
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?
}

#[tauri::command]
pub async fn erase_practice_history_atomically(
    app: AppHandle,
    action: Value,
) -> Result<Value, PracticeSessionErrorWire> {
    let root = app_root(&app).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || erase_practice_history_at(&root, &action))
        .await
        .map_err(|_| PracticeSessionErrorCode::StorageError.error())?
}

#[tauri::command]
pub async fn save_practice_test_atomically(
    app: AppHandle,
    operation: Value,
) -> Result<(), PracticeSessionErrorWire> {
    let root = app_root(&app).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    let map = operation
        .as_object()
        .ok_or_else(|| PracticeSessionErrorCode::InvalidArgument.error())?;
    let source_material_id = map
        .get("sourceMaterialId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| PracticeSessionErrorCode::InvalidArgument.error())?;
    let title = map
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| PracticeSessionErrorCode::InvalidArgument.error())?;
    let questions_val = map
        .get("questions")
        .ok_or_else(|| PracticeSessionErrorCode::InvalidArgument.error())?;
    let questions_json = serde_json::to_string(questions_val)
        .map_err(|_| PracticeSessionErrorCode::InvalidArgument.error())?;
    let model = map.get("model").and_then(|v| v.as_str()).unwrap_or("");

    let sm_id = source_material_id.to_string();
    let t = title.to_string();
    let m = model.to_string();

    tauri::async_runtime::spawn_blocking(move || {
        save_practice_test_at(&root, &sm_id, &t, &questions_json, &m)
    })
    .await
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?
}

#[tauri::command]
pub async fn remove_practice_test_atomically(
    app: AppHandle,
    source_material_id: String,
) -> Result<(), PracticeSessionErrorWire> {
    let root = app_root(&app).map_err(|_| PracticeSessionErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || {
        remove_practice_test_at(&root, &source_material_id)
    })
    .await
    .map_err(|_| PracticeSessionErrorCode::StorageError.error())?
}

#[tauri::command]
pub async fn run_practice_legacy_conversion(app: AppHandle) -> Result<usize, String> {
    let root = app_root(&app).map_err(|e| format!("App root error: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || run_legacy_conversion_at(&root))
        .await
        .map_err(|e| format!("Join error: {e}"))?
}

#[cfg(test)]
#[path = "practice_session_tests.rs"]
mod tests;
