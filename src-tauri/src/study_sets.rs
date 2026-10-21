//! Study sets she makes or edits herself (OFFLINE-03a): one atomic save that
//! keeps the whole previous set in `study_set_history` before anything
//! overwrites it. TS twin: `src/data/studySetTransaction.ts`; the two accept
//! and refuse the same operations, with the same codes and messages.
//!
//! The operation names the set it expects to replace, column for column, so
//! a change made elsewhere since she opened it is refused rather than lost.
//! Its id becomes the history row's id, so a retry after an uncertain answer
//! is recognised instead of applied twice.

use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::card_reviews::js_trim;

pub const MAX_RETIRED_ITEMS: usize = 2_000;
pub const MAX_RETIREMENT_TERMS: usize = 64;
pub const MAX_TITLE: usize = 500;
pub const MAX_SUMMARY: usize = 20_000;
pub const MAX_SECTIONS: usize = 100;
pub const MAX_HEADING: usize = 200;
pub const MAX_BODY: usize = 20_000;
pub const MAX_CARDS: usize = 500;
pub const MAX_FRONT: usize = 1_000;
pub const MAX_BACK: usize = 2_000;
pub const MAX_SOURCE_NOTES: usize = 20_000;
pub const MAX_MODEL: usize = 200;
pub const MAX_SOURCE_PAGE: i64 = 1_000;

/// The stored columns of one set, in the order history keeps them.
pub const SET_COLUMNS: [&str; 11] = [
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
];

/// Every refusal. The messages match `STUDY_SET_ERROR_MESSAGES` in
/// `src/data/persistenceErrors.ts` word for word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StudySetErrorCode {
    InvalidArgument,
    Conflict,
    SourceChanged,
    StaleContent,
    RetirementLimit,
    NotFound,
    StorageError,
}

impl StudySetErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::Conflict => "This save request was already used for different study content. Nothing has been saved.",
            Self::SourceChanged => "This PDF or your chosen pages changed. Nothing has been saved; review the source first.",
            Self::InvalidArgument => {
                "This study set couldn't be saved because part of it isn't valid. Nothing has been saved."
            }
            Self::StaleContent => {
                "This study set changed after you opened it. Nothing has been saved; look at it again first."
            }
            Self::RetirementLimit => {
                "This study set has reached its deletion and correction history limit. Your changes haven't been saved."
            }
            Self::NotFound => "That study material no longer exists. Nothing has been saved.",
            Self::StorageError => {
                "A storage problem stopped this study set from saving. Nothing has been saved."
            }
        }
    }

    pub fn error(self) -> StudySetErrorWire {
        StudySetErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

/// The wire refusal: one code and its fixed message, never engine text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StudySetErrorWire {
    pub code: StudySetErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for StudySetErrorWire {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for StudySetErrorWire {}

type Check<T> = Result<T, StudySetErrorCode>;

fn invalid<T>() -> Check<T> {
    Err(StudySetErrorCode::InvalidArgument)
}

fn storage<E>(_: E) -> StudySetErrorCode {
    StudySetErrorCode::StorageError
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

fn is_lower_uuid_v4(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            14 => *c == b'4',
            19 => matches!(c, b'8' | b'9' | b'a' | b'b'),
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
        })
}

/// `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`, the authoring core's item id.
pub fn is_item_id(value: &str) -> bool {
    let b = value.as_bytes();
    !b.is_empty()
        && b.len() <= 128
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b':' | b'-'))
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Text whose trimmed length is `min..=max` code points (`trimmedCodePoints`).
fn bounded(value: Option<&Value>, min: usize, max: usize) -> Check<String> {
    let Some(Value::String(text)) = value else {
        return invalid();
    };
    let length = js_trim(text).chars().count();
    if length < min || length > max {
        return invalid();
    }
    Ok(text.clone())
}

fn exact_keys(map: &Map<String, Value>, required: &[&str], optional: &[&str]) -> Check<()> {
    if required.iter().any(|key| !map.contains_key(*key))
        || map
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return invalid();
    }
    Ok(())
}

fn origin_of(map: &Map<String, Value>) -> Check<Option<String>> {
    match map.get("origin") {
        None => Ok(None),
        Some(Value::String(origin)) if origin == "user" || origin == "instructor" => {
            Ok(Some(origin.clone()))
        }
        Some(_) => invalid(),
    }
}

/// The identity fields every section and card may carry: an optional stable
/// id, an optional origin, and `replaces` only beside an origin.
fn identity(map: &Map<String, Value>, ids: &mut Vec<String>) -> Check<Map<String, Value>> {
    let mut out = Map::new();
    match map.get("itemId") {
        None => {}
        Some(Value::String(id)) if is_item_id(id) && id != "summary" && !ids.contains(id) => {
            ids.push(id.clone());
            out.insert("itemId".into(), json!(id));
        }
        Some(_) => return invalid(),
    }
    let origin = origin_of(map)?;
    match map.get("replaces") {
        None => {}
        Some(Value::String(id)) if is_item_id(id) && origin.is_some() => {
            out.insert("replaces".into(), json!(id));
        }
        Some(_) => return invalid(),
    }
    if let Some(origin) = origin {
        out.insert("origin".into(), json!(origin));
    }
    Ok(out)
}

fn validate_sections(value: Option<&Value>, ids: &mut Vec<String>) -> Check<Value> {
    let Some(Value::Array(sections)) = value else {
        return invalid();
    };
    if sections.len() > MAX_SECTIONS {
        return invalid();
    }
    let mut out = Vec::with_capacity(sections.len());
    for section in sections {
        let Value::Object(map) = section else {
            return invalid();
        };
        exact_keys(map, &["heading", "body"], &["itemId", "origin", "replaces"])?;
        let mut stored = Map::new();
        stored.insert(
            "heading".into(),
            json!(bounded(map.get("heading"), 1, MAX_HEADING)?),
        );
        stored.insert("body".into(), json!(bounded(map.get("body"), 1, MAX_BODY)?));
        stored.extend(identity(map, ids)?);
        out.push(Value::Object(stored));
    }
    Ok(Value::Array(out))
}

fn validate_cards(value: Option<&Value>, ids: &mut Vec<String>) -> Check<Value> {
    let Some(Value::Array(cards)) = value else {
        return invalid();
    };
    if cards.len() > MAX_CARDS {
        return invalid();
    }
    let mut out = Vec::with_capacity(cards.len());
    for card in cards {
        let Value::Object(map) = card else {
            return invalid();
        };
        exact_keys(
            map,
            &["front", "back", "sourcePage"],
            &["itemId", "origin", "replaces"],
        )?;
        let source_page = match map.get("sourcePage") {
            Some(Value::Null) => Value::Null,
            Some(Value::Number(n))
                if n.as_i64()
                    .is_some_and(|p| (1..=MAX_SOURCE_PAGE).contains(&p)) =>
            {
                json!(n.as_i64())
            }
            _ => return invalid(),
        };
        let mut stored = Map::new();
        stored.insert(
            "front".into(),
            json!(bounded(map.get("front"), 1, MAX_FRONT)?),
        );
        stored.insert("back".into(), json!(bounded(map.get("back"), 1, MAX_BACK)?));
        stored.insert("sourcePage".into(), source_page);
        stored.extend(identity(map, ids)?);
        out.push(Value::Object(stored));
    }
    Ok(Value::Array(out))
}

/// Unicode scalar order, never locale order (`scalarCompare`).
fn scalar_less(a: &str, b: &str) -> bool {
    a.chars().map(u32::from).lt(b.chars().map(u32::from))
}

/// The structure of a retirement list (`validateRetiredList`): at most 2,000
/// distinct entries, each naming an item, a reason, a 64-hex text key and at
/// most 64 terms in strictly increasing scalar order. The authoring core
/// checks each term's normalization before it uses a list.
pub fn validate_retired(value: &Value) -> Check<Value> {
    let Value::Array(entries) = value else {
        return invalid();
    };
    if entries.len() > MAX_RETIRED_ITEMS {
        return Err(StudySetErrorCode::RetirementLimit);
    }
    let mut keys = Vec::with_capacity(entries.len());
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let Value::Object(map) = entry else {
            return invalid();
        };
        exact_keys(map, &["kind", "itemId", "reason", "textKey", "terms"], &[])?;
        let (
            Some(Value::String(kind)),
            Some(Value::String(item_id)),
            Some(Value::String(reason)),
            Some(Value::String(text_key)),
            Some(Value::Array(terms)),
        ) = (
            map.get("kind"),
            map.get("itemId"),
            map.get("reason"),
            map.get("textKey"),
            map.get("terms"),
        )
        else {
            return invalid();
        };
        if !["summary", "section", "card"].contains(&kind.as_str())
            || !is_item_id(item_id)
            || (kind == "summary") != (item_id == "summary")
            || !["deleted", "corrected"].contains(&reason.as_str())
            || !is_lower_hex_64(text_key)
            || terms.len() > MAX_RETIREMENT_TERMS
        {
            return invalid();
        }
        let mut previous: Option<&str> = None;
        for term in terms {
            let Value::String(term) = term else {
                return invalid();
            };
            if term.is_empty()
                || term.chars().count() > MAX_BODY
                || previous.is_some_and(|p| !scalar_less(p, term))
            {
                return invalid();
            }
            previous = Some(term);
        }
        let key = (
            kind.clone(),
            item_id.clone(),
            reason.clone(),
            text_key.clone(),
        );
        if keys.contains(&key) {
            return invalid();
        }
        keys.push(key);
        out.push(json!({
            "kind": kind, "itemId": item_id, "reason": reason, "textKey": text_key, "terms": terms,
        }));
    }
    Ok(Value::Array(out))
}

/// A set ready to store: every column but the two timestamps.
#[derive(Debug, Clone, PartialEq)]
pub struct NextSet {
    pub title: String,
    pub summary: String,
    pub summary_origin: Option<String>,
    pub sections: Value,
    pub flashcards: Value,
    pub source_notes: String,
    pub provider: String,
    pub model: String,
    pub retired: Value,
}

fn plain(value: Option<&Value>, max: usize) -> Check<String> {
    let Some(Value::String(text)) = value else {
        return invalid();
    };
    if text.chars().count() > max {
        return invalid();
    }
    Ok(text.clone())
}

pub fn validate_next(value: &Value) -> Check<NextSet> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(
        map,
        &[
            "title",
            "summary",
            "summaryOrigin",
            "sections",
            "flashcards",
            "sourceNotes",
            "provider",
            "model",
            "retired",
        ],
        &[],
    )?;
    let summary_origin = match map.get("summaryOrigin") {
        Some(Value::Null) => None,
        Some(Value::String(origin)) if origin == "user" || origin == "instructor" => {
            Some(origin.clone())
        }
        _ => return invalid(),
    };
    let provider = match map.get("provider") {
        Some(Value::String(p)) if ["gemini", "import", "manual"].contains(&p.as_str()) => p.clone(),
        _ => return invalid(),
    };
    let mut ids = Vec::new();
    Ok(NextSet {
        title: plain(map.get("title"), MAX_TITLE)?,
        summary: bounded(map.get("summary"), 0, MAX_SUMMARY)?,
        summary_origin,
        sections: validate_sections(map.get("sections"), &mut ids)?,
        flashcards: validate_cards(map.get("flashcards"), &mut ids)?,
        source_notes: plain(map.get("sourceNotes"), MAX_SOURCE_NOTES)?,
        provider,
        model: plain(map.get("model"), MAX_MODEL)?,
        retired: validate_retired(map.get("retired").unwrap_or(&Value::Null))?,
    })
}

/// Why a save was made, and the history reason it records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveReason {
    Create,
    Edit,
    Correct,
    Delete,
    Regenerate,
    Restore,
    Remove,
}

impl SaveReason {
    fn parse(value: Option<&Value>) -> Check<Self> {
        Ok(match value.and_then(Value::as_str) {
            Some("create") => Self::Create,
            Some("edit") => Self::Edit,
            Some("correct") => Self::Correct,
            Some("delete") => Self::Delete,
            Some("regenerate") => Self::Regenerate,
            Some("restore") => Self::Restore,
            Some("remove") => Self::Remove,
            _ => return invalid(),
        })
    }

    fn history(self) -> &'static str {
        match self {
            Self::Create | Self::Edit => "edit",
            Self::Correct => "correct",
            Self::Delete | Self::Remove => "delete",
            Self::Regenerate => "regenerate",
            Self::Restore => "restore",
        }
    }

    fn renews_generated_at(self) -> bool {
        matches!(self, Self::Create | Self::Regenerate)
    }
}

/// A decoded save request.
#[derive(Debug, Clone)]
pub struct SaveOperation {
    pub pdf_kit_sources: Option<crate::pdf_kit_sources::Sources>,
    pub payload: Value,
    pub operation_id: String,
    pub material_id: String,
    pub reason: SaveReason,
    pub expected: Option<Map<String, Value>>,
    pub next: Option<NextSet>,
}

fn decode_row(value: &Value) -> Check<Map<String, Value>> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(map, &SET_COLUMNS, &[])?;
    for column in SET_COLUMNS {
        match map.get(column) {
            Some(Value::String(_)) => {}
            Some(Value::Null) if column == "summary_origin" => {}
            _ => return invalid(),
        }
    }
    Ok(map.clone())
}

pub fn decode_operation(value: &Value) -> Check<SaveOperation> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(
        map,
        &["operationId", "materialId", "reason", "expected", "next"],
        &["pdfKitSources"],
    )?;
    let operation_id = match map.get("operationId") {
        Some(Value::String(id)) if is_lower_uuid_v4(id) => id.clone(),
        _ => return invalid(),
    };
    let material_id = match map.get("materialId") {
        Some(Value::String(id)) if !id.is_empty() && id.len() <= 200 => id.clone(),
        _ => return invalid(),
    };
    let reason = SaveReason::parse(map.get("reason"))?;
    let expected = match map.get("expected") {
        Some(Value::Null) => None,
        Some(row) => Some(decode_row(row)?),
        None => return invalid(),
    };
    let next = match map.get("next") {
        Some(Value::Null) => None,
        Some(set) => Some(validate_next(set)?),
        None => return invalid(),
    };
    // Creating replaces nothing; removing leaves nothing; everything else
    // replaces a set she has open with another.
    let consistent = match reason {
        SaveReason::Create => expected.is_none() && next.is_some(),
        SaveReason::Remove => expected.is_some() && next.is_none(),
        _ => expected.is_some() && next.is_some(),
    };
    if !consistent {
        return invalid();
    }
    let pdf_kit_sources = map
        .get("pdfKitSources")
        .map(|v| {
            crate::pdf_kit_sources::decode(v, &material_id)
                .map_err(|_| StudySetErrorCode::InvalidArgument)
        })
        .transpose()?;
    if let Some(sources) = &pdf_kit_sources {
        crate::pdf_kit_sources::validate_content(sources, &value["next"])
            .map_err(|_| StudySetErrorCode::InvalidArgument)?;
    }
    Ok(SaveOperation {
        pdf_kit_sources,
        payload: value.clone(),
        operation_id,
        material_id,
        reason,
        expected,
        next,
    })
}

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

fn read_row(tx: &Transaction, material_id: &str) -> Check<Option<Map<String, Value>>> {
    tx.query_row(
        "SELECT title, summary, sections_json, flashcards_json, source_notes, provider, model,
                generated_at, updated_at, summary_origin, retired_json
           FROM ai_study_sets WHERE source_material_id = ?1",
        [material_id],
        |r| {
            let mut map = Map::new();
            for (index, column) in SET_COLUMNS.iter().enumerate() {
                let value: Option<String> = r.get(index)?;
                map.insert(
                    (*column).to_string(),
                    value.map(Value::String).unwrap_or(Value::Null),
                );
            }
            Ok(map)
        },
    )
    .optional()
    .map_err(storage)
}

fn parsed(row: &Map<String, Value>, column: &str) -> Value {
    row.get(column)
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str(text).ok())
        .unwrap_or(Value::Null)
}

/// Whether the stored row already holds this content (timestamps aside).
fn holds(row: &Map<String, Value>, next: &NextSet) -> bool {
    row.get("title") == Some(&json!(next.title))
        && row.get("summary") == Some(&json!(next.summary))
        && row.get("summary_origin") == Some(&json!(next.summary_origin))
        && row.get("source_notes") == Some(&json!(next.source_notes))
        && row.get("provider") == Some(&json!(next.provider))
        && row.get("model") == Some(&json!(next.model))
        && parsed(row, "sections_json") == next.sections
        && parsed(row, "flashcards_json") == next.flashcards
        && parsed(row, "retired_json") == next.retired
}

/// The result of a save.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub status: &'static str,
}

pub fn apply_operation(
    tx: &Transaction,
    operation: &SaveOperation,
    now: &str,
) -> Check<SaveResult> {
    let material: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM study_materials WHERE id = ?1",
            [&operation.material_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    if material.is_none() {
        return Err(StudySetErrorCode::NotFound);
    }
    let payload_json = crate::practice_sessions::canonical_json(&operation.payload);
    let payload_hash = crate::practice_sessions::compute_canonical_hash(&operation.payload);
    let has_receipts: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='study_set_save_operations')", [], |r|r.get(0)).map_err(storage)?;
    if has_receipts {
        let receipt: Option<(String,String,String)> = tx.query_row("SELECT material_id, payload_json, payload_hash FROM study_set_save_operations WHERE operation_id=?1", [&operation.operation_id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(storage)?;
        if let Some((material, payload, hash)) = receipt {
            if material != operation.material_id || payload != payload_json || hash != payload_hash
            {
                return Err(StudySetErrorCode::Conflict);
            }
            return Ok(SaveResult {
                status: "already_saved",
            });
        }
    }
    if let Some(sources) = &operation.pdf_kit_sources {
        if !has_receipts {
            return Err(StudySetErrorCode::StorageError);
        }
        crate::pdf_kit_sources::write(tx, sources).map_err(|e| {
            if e == "SOURCE_CHANGED" {
                StudySetErrorCode::SourceChanged
            } else {
                StudySetErrorCode::StorageError
            }
        })?;
    }
    let current = read_row(tx, &operation.material_id)?;

    // A retry of a save that already happened.
    let recorded: Option<String> = tx
        .query_row(
            "SELECT material_id FROM study_set_history WHERE id = ?1",
            [&operation.operation_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    let already = match (&current, &operation.next) {
        (Some(row), Some(next)) => {
            holds(row, next) && (recorded.is_some() || operation.reason == SaveReason::Create)
        }
        (None, None) => recorded.is_some(),
        _ => false,
    };
    if already && operation.pdf_kit_sources.is_none() {
        if recorded.is_some_and(|m| m != operation.material_id) {
            return Err(StudySetErrorCode::StaleContent);
        }
        return Ok(SaveResult {
            status: "already_saved",
        });
    }
    if recorded.is_some() || current != operation.expected {
        return Err(StudySetErrorCode::StaleContent);
    }

    if let Some(previous) = &current {
        let provider = previous
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        tx.execute(
            "INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
             VALUES (?1, ?2, 'study_set', ?3, ?4, ?5, ?6)",
            params![
                operation.operation_id,
                operation.material_id,
                operation.reason.history(),
                Value::Object(previous.clone()).to_string(),
                provider,
                now
            ],
        )
        .map_err(storage)?;
    }

    match &operation.next {
        None => {
            tx.execute(
                "DELETE FROM ai_study_sets WHERE source_material_id = ?1",
                [&operation.material_id],
            )
            .map_err(storage)?;
        }
        Some(next) => {
            let generated_at = match (&current, operation.reason.renews_generated_at()) {
                (Some(row), false) => row
                    .get("generated_at")
                    .and_then(Value::as_str)
                    .unwrap_or(now)
                    .to_string(),
                _ => now.to_string(),
            };
            tx.execute(
                "INSERT INTO ai_study_sets
                   (source_material_id, title, summary, sections_json, flashcards_json, source_notes,
                    provider, model, generated_at, updated_at, summary_origin, retired_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(source_material_id) DO UPDATE SET
                   title = excluded.title, summary = excluded.summary,
                   sections_json = excluded.sections_json, flashcards_json = excluded.flashcards_json,
                   source_notes = excluded.source_notes, provider = excluded.provider,
                   model = excluded.model, generated_at = excluded.generated_at,
                   updated_at = excluded.updated_at, summary_origin = excluded.summary_origin,
                   retired_json = excluded.retired_json",
                params![
                    operation.material_id,
                    next.title,
                    next.summary,
                    next.sections.to_string(),
                    next.flashcards.to_string(),
                    next.source_notes,
                    next.provider,
                    next.model,
                    generated_at,
                    now,
                    next.summary_origin,
                    next.retired.to_string()
                ],
            )
            .map_err(storage)?;
        }
    }
    if operation.pdf_kit_sources.is_some() {
        tx.execute("INSERT INTO study_set_save_operations (operation_id,material_id,payload_json,payload_hash) VALUES (?1,?2,?3,?4)",params![operation.operation_id,operation.material_id,payload_json,payload_hash]).map_err(storage)?;
    }
    Ok(SaveResult { status: "saved" })
}

/// Open the app database and run one save in an immediate transaction.
pub fn save_study_set_at(root: &Path, operation: &Value) -> Result<SaveResult, StudySetErrorWire> {
    let operation = decode_operation(operation).map_err(StudySetErrorCode::error)?;
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(StudySetErrorCode::StorageError.error());
    }
    let mut conn =
        Connection::open(&db_path).map_err(|_| StudySetErrorCode::StorageError.error())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| StudySetErrorCode::StorageError.error())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| StudySetErrorCode::StorageError.error())?;
    let has_receipt: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='study_set_save_operations')",[],|r|r.get(0)).unwrap_or(false) && conn.query_row("SELECT EXISTS(SELECT 1 FROM study_set_save_operations WHERE operation_id=?1)",[&operation.operation_id],|r|r.get(0)).unwrap_or(false);
    if !has_receipt {
        if let Some(sources) = &operation.pdf_kit_sources {
            crate::pdf_kit::validate_save_at(root, sources).map_err(|e| {
                if e.code == "INVALID_ARGUMENT" {
                    StudySetErrorCode::InvalidArgument.error()
                } else {
                    StudySetErrorCode::SourceChanged.error()
                }
            })?;
        }
    }
    save_on(
        &mut conn,
        &operation,
        &crate::card_reviews::format_iso_ms(now_ms()),
    )
    .map_err(StudySetErrorCode::error)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// One save on an open connection; any failure rolls everything back.
pub fn save_on(conn: &mut Connection, operation: &SaveOperation, now: &str) -> Check<SaveResult> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let result = apply_operation(&tx, operation, now)?;
    tx.commit().map_err(storage)?;
    Ok(result)
}

#[tauri::command]
pub async fn save_study_set_atomically(
    app: AppHandle,
    operation: Value,
    guide_job_id: Option<String>,
) -> Result<SaveResult, crate::gemini::sections::GuideSaveError> {
    let root =
        crate::storage::app_root(&app).map_err(|_| StudySetErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || match guide_job_id {
        Some(id) => crate::gemini::sections::save_guide_at(&root, &id, &operation),
        None => save_study_set_at(&root, &operation).map_err(Into::into),
    })
    .await
    .map_err(|_| StudySetErrorCode::StorageError.error())?
}

/* ------------------------------------------------------------------ */
/* Backup and restore verification (schema 16)                         */
/* ------------------------------------------------------------------ */

/// Stored study-set provenance a restored database must keep consistent:
/// each retirement list is well-formed, and each history row holds a whole
/// previous set (`validateManualStudyState`).
pub fn verify_stored_sets(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT source_material_id, retired_json FROM ai_study_sets")
        .map_err(|e| format!("Could not read study sets: {e}"))?;
    let rows = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Could not read study sets: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read study sets: {e}"))?;
    for (material_id, retired_json) in rows {
        let ok = serde_json::from_str::<Value>(&retired_json)
            .ok()
            .is_some_and(|value| validate_retired(&value).is_ok());
        if !ok {
            return Err(format!(
                "The study set for {material_id} has a damaged deletion and correction history."
            ));
        }
    }
    let mut statement = connection
        .prepare("SELECT id, kind, previous_json FROM study_set_history")
        .map_err(|e| format!("Could not read study set history: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Could not read study set history: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read study set history: {e}"))?;
    for (id, kind, previous_json) in rows {
        let ok = kind != "study_set"
            || serde_json::from_str::<Value>(&previous_json)
                .ok()
                .is_some_and(|value| decode_row(&value).is_ok());
        if !ok {
            return Err(format!("Study set history entry {id} is damaged."));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "study_sets_tests.rs"]
mod tests;
