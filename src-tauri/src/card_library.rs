//! Library-wide card review reads (M2-4 / C2, approved C2-D1–D9).
//!
//! The native twin of `src/data/cardLibraryReader.ts`: the same validation,
//! SQL, admission ledger, ranking, history provenance and cursor encoding,
//! so both produce identical results (held equal by
//! `fixtures/card-library/cases.json`).
//!
//! Reads never write: each command opens the database read-only and runs
//! every query of one page inside one deferred transaction, a consistent
//! snapshot. Raw saved card sets are read only after a byte preflight and a
//! conservative 500-card work reservation; a set over 8 MiB is never read.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection, OpenFlags, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::card_reviews::{
    card_version, js_trim, parse_iso_ms, parse_saved_cards, CardVersion, SavedCards,
    AGAIN_DELAY_MINUTES, LADDER_DAYS, SCHEDULER_VERSION,
};
use crate::practice_sessions::{canonical_json, is_root_ready};
use crate::storage::app_root;

pub const MAX_CANDIDATE_BATCH: i64 = 250;
pub const DEFAULT_DUE_PAGE_LIMIT: i64 = 50;
pub const MAX_DUE_PAGE_LIMIT: i64 = 250;
pub const DEFAULT_HISTORY_PAGE_LIMIT: i64 = 20;
pub const MAX_HISTORY_PAGE_LIMIT: i64 = 100;
pub const DEFAULT_BATCH_CARDS_BUDGET: i64 = 2_500;
pub const MAX_BATCH_CARDS_BUDGET: i64 = 100_000;
pub const DEFAULT_BATCH_RAW_BYTES_BUDGET: i64 = 2 * 1024 * 1024;
pub const MIN_BATCH_RAW_BYTES_BUDGET: i64 = 1024;
pub const MAX_BATCH_RAW_BYTES_BUDGET: i64 = 64 * 1024 * 1024;
pub const ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES: i64 = 8 * 1024 * 1024;
pub const CARD_WORK_RESERVATION: i64 = 500;
pub const MAX_HISTORY_TARGETS: usize = 250;
pub const MAX_CURSOR_LENGTH: usize = 32_768;
pub const MAX_ID_LENGTH: usize = 64;
pub const MAX_TOPIC_LENGTH: usize = 256;

/* ------------------------------------------------------------------ */
/* Allowlisted errors                                                  */
/* ------------------------------------------------------------------ */

/// Messages match `CARD_LIBRARY_ERROR_MESSAGES` in `src/logic/cardLibrary.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CardLibraryErrorCode {
    InvalidTime,
    InvalidFilter,
    InvalidInput,
    InvalidCursor,
    StaleCursor,
    InvalidTarget,
    NotReady,
    StorageError,
}

impl CardLibraryErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidTime => "The review clock for this request is invalid.",
            Self::InvalidFilter => "That review filter isn't supported.",
            Self::InvalidInput => "The review request is invalid.",
            Self::InvalidCursor => "That page position is invalid.",
            Self::StaleCursor => "The filters or clock changed since this page was loaded.",
            Self::InvalidTarget => "The cards to check are invalid.",
            Self::NotReady => "Card reviews are not ready yet.",
            Self::StorageError => "Card reviews couldn't be read just now.",
        }
    }

    pub fn error(self) -> CardLibraryErrorWire {
        CardLibraryErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardLibraryErrorWire {
    pub code: CardLibraryErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for CardLibraryErrorWire {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for CardLibraryErrorWire {}

type Check<T> = Result<T, CardLibraryErrorCode>;

fn storage<E>(_: E) -> CardLibraryErrorCode {
    CardLibraryErrorCode::StorageError
}

/* ------------------------------------------------------------------ */
/* Input helpers (JavaScript semantics)                                */
/* ------------------------------------------------------------------ */

/// JavaScript string length: UTF-16 code units.
fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Code-unit string order, as JavaScript's `<` compares strings.
fn js_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `parseBoundedInteger`: absent or unusable values take the default;
/// usable numbers are floored and clamped.
fn bounded_integer(value: Option<&Value>, fallback: i64, min: i64, max: i64) -> i64 {
    match value {
        Some(Value::Number(n)) => match n.as_f64() {
            Some(f) if f.is_finite() && f >= 0.0 => (f.floor() as i64).clamp(min, max),
            _ => fallback,
        },
        _ => fallback,
    }
}

fn optional_text(
    value: Option<&Value>,
    max: usize,
    code: CardLibraryErrorCode,
) -> Check<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if !s.is_empty() && js_len(s) <= max => Ok(Some(s.clone())),
        _ => Err(code),
    }
}

fn is_instant(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(s)) if parse_iso_ms(s).is_some())
}

fn bounded_id(value: Option<&Value>) -> Option<&str> {
    match value {
        Some(Value::String(s)) if !s.is_empty() && js_len(s) <= MAX_ID_LENGTH => Some(s),
        _ => None,
    }
}

fn number_is(value: Option<&Value>, expected: f64) -> bool {
    matches!(value, Some(Value::Number(n)) if n.as_f64() == Some(expected))
}

pub fn get_study_inspection_target(material_id: &str) -> String {
    // encodeURIComponent: unreserved A-Z a-z 0-9 - _ . ! ~ * ' ( ) stay.
    let mut out = String::from("/study/");
    for byte in material_id.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/* ------------------------------------------------------------------ */
/* Cursors                                                             */
/* ------------------------------------------------------------------ */

fn encode_cursor(payload: &Value) -> Check<String> {
    let encoded = STANDARD.encode(canonical_json(payload).as_bytes());
    if encoded.len() > MAX_CURSOR_LENGTH {
        return Err(CardLibraryErrorCode::InvalidCursor);
    }
    Ok(encoded)
}

fn decode_cursor(value: Option<&Value>) -> Check<Option<Map<String, Value>>> {
    let text = match value {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) if !s.is_empty() && s.len() <= MAX_CURSOR_LENGTH => s,
        _ => return Err(CardLibraryErrorCode::InvalidCursor),
    };
    let bytes = STANDARD
        .decode(text)
        .map_err(|_| CardLibraryErrorCode::InvalidCursor)?;
    let utf8 = String::from_utf8(bytes).map_err(|_| CardLibraryErrorCode::InvalidCursor)?;
    match serde_json::from_str::<Value>(&utf8) {
        Ok(Value::Object(map)) => Ok(Some(map)),
        _ => Err(CardLibraryErrorCode::InvalidCursor),
    }
}

fn exact_keys(map: &Map<String, Value>, keys: &[&str]) -> bool {
    map.len() == keys.len() && keys.iter().all(|k| map.contains_key(*k))
}

struct DueContext {
    topic: Option<String>,
    status_filter: &'static str,
    now_utc: String,
    next_midnight: String,
}

impl DueContext {
    fn to_json(&self) -> Value {
        json!({
            "topic": self.topic,
            "statusFilter": self.status_filter,
            "nowUtc": self.now_utc,
            "nextLocalMidnightUtc": self.next_midnight,
        })
    }
}

struct DueCursor {
    rem_ids: Vec<String>,
    lc: String,
    lp: i64,
    lu: String,
    is_exhausted: bool,
}

fn validate_due_cursor(
    raw: Option<Map<String, Value>>,
    ctx: &DueContext,
) -> Check<Option<DueCursor>> {
    let Some(raw) = raw else { return Ok(None) };
    let invalid = CardLibraryErrorCode::InvalidCursor;
    if !exact_keys(
        &raw,
        &[
            "v",
            "type",
            "remIds",
            "lc",
            "lp",
            "lu",
            "isExhausted",
            "ctx",
        ],
    ) {
        return Err(invalid);
    }
    if !number_is(raw.get("v"), 1.0) || raw.get("type") != Some(&json!("due")) {
        return Err(invalid);
    }
    let Some(Value::Object(c)) = raw.get("ctx") else {
        return Err(invalid);
    };
    if !exact_keys(
        c,
        &["topic", "statusFilter", "nowUtc", "nextLocalMidnightUtc"],
    ) {
        return Err(invalid);
    }
    let Some(Value::Bool(is_exhausted)) = raw.get("isExhausted") else {
        return Err(invalid);
    };
    let Some(Value::Array(rem)) = raw.get("remIds") else {
        return Err(invalid);
    };
    if rem.len() > MAX_CANDIDATE_BATCH as usize {
        return Err(invalid);
    }
    let mut seen = HashSet::new();
    let mut rem_ids = Vec::with_capacity(rem.len());
    for id in rem {
        let id = bounded_id(Some(id)).ok_or(invalid)?;
        if !seen.insert(id.to_string()) {
            return Err(invalid);
        }
        rem_ids.push(id.to_string());
    }
    let lc = bounded_id(raw.get("lc")).ok_or(invalid)?.to_string();
    let lp = if number_is(raw.get("lp"), 0.0) {
        0
    } else if number_is(raw.get("lp"), 1.0) {
        1
    } else {
        return Err(invalid);
    };
    let lu = bounded_id(raw.get("lu")).ok_or(invalid)?.to_string();
    if c.get("topic") != Some(&json!(ctx.topic))
        || c.get("statusFilter") != Some(&json!(ctx.status_filter))
        || c.get("nowUtc") != Some(&json!(ctx.now_utc))
        || c.get("nextLocalMidnightUtc") != Some(&json!(ctx.next_midnight))
    {
        return Err(CardLibraryErrorCode::StaleCursor);
    }
    Ok(Some(DueCursor {
        rem_ids,
        lc,
        lp,
        lu,
        is_exhausted: *is_exhausted,
    }))
}

/* ------------------------------------------------------------------ */
/* Admission ledger                                                    */
/* ------------------------------------------------------------------ */

struct Ledger {
    cards_budget: i64,
    bytes_budget: i64,
    raw_reads: i64,
    raw_bytes: i64,
    attempted_cards: i64,
    evaluated_cards: i64,
    single_set_lane_used: bool,
}

impl Ledger {
    fn new(cards_budget: i64, bytes_budget: i64) -> Self {
        Self {
            cards_budget,
            bytes_budget,
            raw_reads: 0,
            raw_bytes: 0,
            attempted_cards: 0,
            evaluated_cards: 0,
            single_set_lane_used: false,
        }
    }

    fn admit(&mut self, byte_len: i64) -> bool {
        if self.raw_reads > 0 {
            if self.raw_bytes + byte_len > self.bytes_budget {
                return false;
            }
            if self.attempted_cards + CARD_WORK_RESERVATION > self.cards_budget {
                return false;
            }
        } else if byte_len > self.bytes_budget || self.cards_budget < CARD_WORK_RESERVATION {
            self.single_set_lane_used = true;
        }
        self.raw_reads += 1;
        self.attempted_cards += CARD_WORK_RESERVATION;
        true
    }

    fn transferred(&mut self, raw: &str) {
        self.raw_bytes += raw.len() as i64;
    }

    fn reconcile(&mut self, card_count: i64) {
        self.attempted_cards = self.attempted_cards - CARD_WORK_RESERVATION + card_count;
        self.evaluated_cards += card_count;
    }

    fn exhausted(&self) -> bool {
        self.single_set_lane_used
            || self.raw_bytes >= self.bytes_budget
            || self.attempted_cards >= self.cards_budget
    }
}

fn read_raw_set(tx: &Transaction, material_id: &str) -> Check<Option<String>> {
    let row: Option<Option<String>> = tx
        .query_row(
            "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?1",
            [material_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
        .map_err(storage)?;
    Ok(row.flatten())
}

fn byte_lengths(tx: &Transaction, ids: &[String]) -> Check<HashMap<String, Option<i64>>> {
    let mut statement = tx
        .prepare(
            "SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len
             FROM ai_study_sets WHERE source_material_id IN (SELECT value FROM json_each(?1))",
        )
        .map_err(storage)?;
    let rows = statement
        .query_map([serde_json::to_string(ids).map_err(storage)?], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
        })
        .map_err(storage)?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(storage)?;
    Ok(rows)
}

struct ItemState {
    step: i64,
    due_at: Option<String>,
    suspended: bool,
    flagged: bool,
}

fn read_states(
    tx: &Transaction,
    version_ids: &[String],
) -> Check<HashMap<String, HashMap<String, ItemState>>> {
    let mut by_version: HashMap<String, HashMap<String, ItemState>> = HashMap::new();
    if version_ids.is_empty() {
        return Ok(by_version);
    }
    let mut statement = tx
        .prepare(
            "SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag
             FROM card_items i JOIN card_review_state s ON s.item_id = i.id
             WHERE i.version_id IN (SELECT value FROM json_each(?1))",
        )
        .map_err(storage)?;
    let rows = statement
        .query_map(
            [serde_json::to_string(version_ids).map_err(storage)?],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    ItemState {
                        step: r.get(2)?,
                        due_at: r.get(3)?,
                        suspended: r.get::<_, i64>(4)? == 1,
                        flagged: r.get::<_, Option<String>>(5)?.is_some(),
                    },
                ))
            },
        )
        .map_err(storage)?;
    for row in rows {
        let (version_id, item_id, state) = row.map_err(storage)?;
        by_version
            .entry(version_id)
            .or_default()
            .insert(item_id, state);
    }
    Ok(by_version)
}

/* ------------------------------------------------------------------ */
/* Review due                                                          */
/* ------------------------------------------------------------------ */

#[derive(Clone)]
struct Candidate {
    material_id: String,
    title: String,
    topic: String,
    priority: String,
    updated_at: String,
}

fn candidate_from(r: &rusqlite::Row) -> rusqlite::Result<Candidate> {
    Ok(Candidate {
        material_id: r.get(0)?,
        title: r.get(1)?,
        topic: r.get(2)?,
        priority: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

struct Entry {
    candidate: Candidate,
    card_count: i64,
    again: i64,
    day: i64,
    new: i64,
    retained: i64,
    earliest_due_at: Option<String>,
}

impl Entry {
    fn total_due(&self) -> i64 {
        self.again + self.day
    }

    fn bucket(&self) -> u8 {
        if self.again > 0 {
            0
        } else if self.day > 0 {
            1
        } else if self.total_due() == 0 && self.new > 0 {
            2
        } else {
            3
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "materialId": self.candidate.material_id,
            "title": self.candidate.title,
            "topic": self.candidate.topic,
            "priority": self.candidate.priority,
            "updatedAt": self.candidate.updated_at,
            "cardCount": self.card_count,
            "againCount": self.again,
            "dayCount": self.day,
            "newCount": self.new,
            "totalDueCount": self.total_due(),
            "retainedCardCount": self.retained,
            "earliestDueAt": self.earliest_due_at,
        })
    }
}

fn evaluate(
    candidate: &Candidate,
    version: &CardVersion,
    states: Option<&HashMap<String, ItemState>>,
    now: &str,
    boundary: &str,
) -> Entry {
    let empty = HashMap::new();
    let states = states.unwrap_or(&empty);
    let mut entry = Entry {
        candidate: candidate.clone(),
        card_count: version.items.len() as i64,
        again: 0,
        day: 0,
        new: 0,
        retained: 0,
        earliest_due_at: None,
    };
    for item in &version.items {
        let state = states.get(&item.item_id);
        if state.is_some() {
            entry.retained += 1;
        }
        if let Some(s) = state {
            if s.suspended || s.flagged {
                continue;
            }
        }
        let Some(due_at) = state.and_then(|s| s.due_at.as_deref()) else {
            entry.new += 1;
            continue;
        };
        let step = state.map_or(0, |s| s.step);
        let due = if step < 0 {
            due_at <= now
        } else {
            due_at < boundary
        };
        if !due {
            continue;
        }
        if step < 0 {
            entry.again += 1;
        } else {
            entry.day += 1;
        }
        let earlier = match entry.earliest_due_at.as_deref() {
            Some(current) => due_at < current,
            None => true,
        };
        if earlier {
            entry.earliest_due_at = Some(due_at.to_string());
        }
    }
    entry
}

fn matches_filter(entry: &Entry, filter: &str) -> bool {
    match filter {
        "due_today" => entry.total_due() > 0,
        "new_only" => entry.total_due() == 0 && entry.new > 0,
        _ => entry.total_due() > 0 || entry.new > 0,
    }
}

fn compare_urgency(a: &Entry, b: &Entry) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    a.bucket()
        .cmp(&b.bucket())
        .then_with(|| {
            let rank = |e: &Entry| u8::from(e.candidate.priority != "next_up");
            rank(a).cmp(&rank(b))
        })
        .then_with(|| match (&a.earliest_due_at, &b.earliest_due_at) {
            (Some(x), Some(y)) => js_cmp(x, y),
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (None, None) => Ordering::Equal,
        })
        .then_with(|| js_cmp(&a.candidate.title, &b.candidate.title))
        .then_with(|| js_cmp(&a.candidate.material_id, &b.candidate.material_id))
}

fn oversize_issue(candidate: &Candidate, raw_bytes: i64) -> Value {
    json!({
        "materialId": candidate.material_id,
        "title": candidate.title,
        "code": "PAYLOAD_TOO_LARGE",
        "rawBytes": raw_bytes,
        "allowedBytes": ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES,
        "inspectionTarget": get_study_inspection_target(&candidate.material_id),
    })
}

const CANDIDATE_COLUMNS: &str = "m.id AS material_id, m.title, m.topic, m.priority, m.updated_at";
const HAS_CARDS: &str =
    "a.flashcards_json IS NOT NULL AND a.flashcards_json != '[]' AND a.flashcards_json != ''";
const RANK: &str = "CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END";

/// Validated inputs of one Review due read.
struct DueInput {
    ctx: DueContext,
    limit: i64,
    batch: i64,
    cards_budget: i64,
    bytes_budget: i64,
    cursor: Option<DueCursor>,
}

fn decode_due_input(input: &Value) -> Check<DueInput> {
    let map = input
        .as_object()
        .ok_or(CardLibraryErrorCode::InvalidInput)?;
    if !is_instant(map.get("nowUtc")) || !is_instant(map.get("nextLocalMidnightUtc")) {
        return Err(CardLibraryErrorCode::InvalidTime);
    }
    let status_filter = match map.get("statusFilter") {
        None | Some(Value::Null) => "all",
        Some(Value::String(s)) if s == "all" => "all",
        Some(Value::String(s)) if s == "due_today" => "due_today",
        Some(Value::String(s)) if s == "new_only" => "new_only",
        _ => return Err(CardLibraryErrorCode::InvalidFilter),
    };
    let topic = optional_text(
        map.get("topic"),
        MAX_TOPIC_LENGTH,
        CardLibraryErrorCode::InvalidInput,
    )?;
    let ctx = DueContext {
        topic,
        status_filter,
        now_utc: map["nowUtc"].as_str().unwrap_or_default().to_string(),
        next_midnight: map["nextLocalMidnightUtc"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    };
    let batch = bounded_integer(
        map.get("candidateBatchBudget"),
        MAX_CANDIDATE_BATCH,
        1,
        MAX_CANDIDATE_BATCH,
    );
    let limit = bounded_integer(
        map.get("limit"),
        DEFAULT_DUE_PAGE_LIMIT,
        1,
        MAX_DUE_PAGE_LIMIT,
    );
    let cards_budget = bounded_integer(
        map.get("maxBatchCardsBudget"),
        DEFAULT_BATCH_CARDS_BUDGET,
        1,
        MAX_BATCH_CARDS_BUDGET,
    );
    let bytes_budget = bounded_integer(
        map.get("maxBatchRawJsonBytesBudget"),
        DEFAULT_BATCH_RAW_BYTES_BUDGET,
        MIN_BATCH_RAW_BYTES_BUDGET,
        MAX_BATCH_RAW_BYTES_BUDGET,
    );
    let cursor = validate_due_cursor(decode_cursor(map.get("cursor"))?, &ctx)?;
    Ok(DueInput {
        ctx,
        limit,
        batch,
        cards_budget,
        bytes_budget,
        cursor,
    })
}

fn due_result(
    materials: &[Entry],
    next_cursor: Option<String>,
    issues: Vec<Value>,
    ledger: &Ledger,
    scanned: i64,
    evaluated: i64,
) -> Value {
    let sum = |f: fn(&Entry) -> i64| materials.iter().map(f).sum::<i64>();
    json!({
        "materials": materials.iter().map(Entry::to_json).collect::<Vec<_>>(),
        "nextCursor": next_cursor,
        "issues": issues,
        "summary": {
            "scannedCandidates": scanned,
            "evaluatedCandidates": evaluated,
            "attemptedCards": ledger.attempted_cards,
            "evaluatedCards": ledger.evaluated_cards,
            "rawReads": ledger.raw_reads,
            "rawBytesTransferred": ledger.raw_bytes,
            "actionableCount": materials.len(),
            "againCount": sum(|m| m.again),
            "dayCount": sum(|m| m.day),
            "totalDueCount": sum(Entry::total_due),
            "newCount": sum(|m| m.new),
            "isComplete": next_cursor_is_none(&next_cursor),
            "isPageLocal": true,
            "issues": issues,
        },
    })
}

fn next_cursor_is_none(cursor: &Option<String>) -> bool {
    cursor.is_none()
}

fn due_cursor(
    rem: &[String],
    lc: &str,
    lp: i64,
    lu: &str,
    is_exhausted: bool,
    ctx: &DueContext,
) -> Check<String> {
    encode_cursor(&json!({
        "v": 1,
        "type": "due",
        "remIds": rem,
        "lc": lc,
        "lp": lp,
        "lu": lu,
        "isExhausted": is_exhausted,
        "ctx": ctx.to_json(),
    }))
}

pub fn read_library_review_due(tx: &Transaction, input: &Value) -> Check<Value> {
    let input = decode_due_input(input)?;
    let ctx = &input.ctx;
    let mut ledger = Ledger::new(input.cards_budget, input.bytes_budget);
    let mut issues: Vec<Value> = Vec::new();
    let mut scanned = 0i64;

    if let Some(cursor) = input.cursor.as_ref().filter(|c| !c.rem_ids.is_empty()) {
        let mut page: Vec<Entry> = Vec::new();
        let mut consumed = 0usize;
        let mut evaluated = 0i64;
        let sql = format!(
            "SELECT {CANDIDATE_COLUMNS}, LENGTH(CAST(a.flashcards_json AS BLOB)) AS byte_len
             FROM study_materials m JOIN ai_study_sets a ON a.source_material_id = m.id
             WHERE m.id = ?1 AND {HAS_CARDS}"
        );
        for id in &cursor.rem_ids {
            if page.len() as i64 >= input.limit {
                break;
            }
            let row: Option<(Candidate, Option<i64>)> = tx
                .query_row(&sql, [id], |r| {
                    Ok((candidate_from(r)?, r.get::<_, Option<i64>>(5)?))
                })
                .map(Some)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(other),
                })
                .map_err(storage)?;
            let Some((candidate, byte_len)) = row.filter(|(c, _)| match &ctx.topic {
                Some(t) => &c.topic == t,
                None => true,
            }) else {
                consumed += 1;
                continue;
            };
            let byte_len = byte_len.unwrap_or(0);
            if byte_len > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES {
                issues.push(oversize_issue(&candidate, byte_len));
                consumed += 1;
                scanned += 1;
                continue;
            }
            if !ledger.admit(byte_len) {
                break;
            }
            let raw = read_raw_set(tx, id)?;
            scanned += 1;
            consumed += 1;
            if let Some(raw) = raw {
                ledger.transferred(&raw);
                if let SavedCards::Ok(cards) = parse_saved_cards(Some(&raw)) {
                    ledger.reconcile(cards.len() as i64);
                    let version = card_version(id, &cards);
                    let states = read_states(tx, std::slice::from_ref(&version.version_id))?;
                    let entry = evaluate(
                        &candidate,
                        &version,
                        states.get(&version.version_id),
                        &ctx.now_utc,
                        &ctx.next_midnight,
                    );
                    evaluated += 1;
                    if matches_filter(&entry, ctx.status_filter) {
                        page.push(entry);
                    }
                }
            }
            if ledger.exhausted() {
                break;
            }
        }
        let left = &cursor.rem_ids[consumed..];
        let next = if left.is_empty() && cursor.is_exhausted {
            None
        } else {
            Some(due_cursor(
                left,
                &cursor.lc,
                cursor.lp,
                &cursor.lu,
                cursor.is_exhausted,
                ctx,
            )?)
        };
        return Ok(due_result(&page, next, issues, &ledger, scanned, evaluated));
    }

    let mut sql = format!(
        "SELECT {CANDIDATE_COLUMNS} FROM study_materials m
         JOIN ai_study_sets a ON a.source_material_id = m.id WHERE {HAS_CARDS}"
    );
    let mut params: Vec<SqlValue> = Vec::new();
    if let Some(topic) = &ctx.topic {
        sql.push_str(" AND m.topic = ?");
        params.push(SqlValue::Text(topic.clone()));
    }
    if let Some(c) = &input.cursor {
        sql.push_str(&format!(
            " AND (({RANK} > ?) OR ({RANK} = ? AND m.updated_at < ?) OR ({RANK} = ? AND m.updated_at = ? AND m.id > ?))"
        ));
        params.extend([
            SqlValue::Integer(c.lp),
            SqlValue::Integer(c.lp),
            SqlValue::Text(c.lu.clone()),
            SqlValue::Integer(c.lp),
            SqlValue::Text(c.lu.clone()),
            SqlValue::Text(c.lc.clone()),
        ]);
    }
    sql.push_str(&format!(
        " ORDER BY {RANK} ASC, m.updated_at DESC, m.id ASC LIMIT ?"
    ));
    params.push(SqlValue::Integer(input.batch + 1));
    let mut statement = tx.prepare(&sql).map_err(storage)?;
    let rows: Vec<Candidate> = statement
        .query_map(params_from_iter(params), candidate_from)
        .map_err(storage)?
        .collect::<Result<_, _>>()
        .map_err(storage)?;
    let has_more = rows.len() as i64 > input.batch;
    let batch: Vec<Candidate> = rows.into_iter().take(input.batch as usize).collect();
    if batch.is_empty() {
        return Ok(due_result(&[], None, issues, &ledger, 0, 0));
    }
    let lengths = byte_lengths(
        tx,
        &batch
            .iter()
            .map(|c| c.material_id.clone())
            .collect::<Vec<_>>(),
    )?;

    let mut admitted: Vec<(Candidate, CardVersion)> = Vec::new();
    let mut last_index: Option<usize> = None;
    for (index, candidate) in batch.iter().enumerate() {
        let byte_len = lengths
            .get(&candidate.material_id)
            .copied()
            .flatten()
            .unwrap_or(0);
        if byte_len > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES {
            issues.push(oversize_issue(candidate, byte_len));
            last_index = Some(index);
            scanned += 1;
            continue;
        }
        if !ledger.admit(byte_len) {
            break;
        }
        let raw = read_raw_set(tx, &candidate.material_id)?;
        scanned += 1;
        last_index = Some(index);
        if let Some(raw) = raw {
            ledger.transferred(&raw);
            if let SavedCards::Ok(cards) = parse_saved_cards(Some(&raw)) {
                ledger.reconcile(cards.len() as i64);
                admitted.push((
                    candidate.clone(),
                    card_version(&candidate.material_id, &cards),
                ));
            }
        }
        if ledger.exhausted() {
            break;
        }
    }

    let mut version_ids: Vec<String> = Vec::new();
    for (_, version) in &admitted {
        if !version_ids.contains(&version.version_id) {
            version_ids.push(version.version_id.clone());
        }
    }
    let states = read_states(tx, &version_ids)?;
    let mut actionable: Vec<Entry> = admitted
        .iter()
        .map(|(c, v)| {
            evaluate(
                c,
                v,
                states.get(&v.version_id),
                &ctx.now_utc,
                &ctx.next_midnight,
            )
        })
        .filter(|e| matches_filter(e, ctx.status_filter))
        .collect();
    actionable.sort_by(compare_urgency);
    let limit = input.limit as usize;
    let rem: Vec<String> = actionable
        .iter()
        .skip(limit)
        .map(|e| e.candidate.material_id.clone())
        .collect();
    actionable.truncate(limit);
    let last = &batch[last_index.unwrap_or(batch.len() - 1)];
    let is_exhausted = !has_more && last_index == Some(batch.len() - 1);
    let next = if rem.is_empty() && is_exhausted {
        None
    } else {
        let lp = i64::from(last.priority != "next_up");
        Some(due_cursor(
            &rem,
            &last.material_id,
            lp,
            &last.updated_at,
            is_exhausted,
            ctx,
        )?)
    };
    Ok(due_result(
        &actionable,
        next,
        issues,
        &ledger,
        scanned,
        admitted.len() as i64,
    ))
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

#[derive(Clone)]
enum Current {
    Ok(String),
    Unavailable(Option<&'static str>),
    Malformed,
    ValidEmpty,
    Pending(&'static str, Option<String>),
}

fn resolve_current(
    tx: &Transaction,
    ledger: &mut Ledger,
    material_id: &str,
    byte_len: i64,
) -> Check<Current> {
    if byte_len > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES {
        return Ok(Current::Pending(
            "oversize",
            Some(get_study_inspection_target(material_id)),
        ));
    }
    if !ledger.admit(byte_len) {
        return Ok(Current::Pending("budget_exceeded", None));
    }
    let Some(raw) = read_raw_set(tx, material_id)? else {
        return Ok(Current::Unavailable(Some("unreadable_cards")));
    };
    ledger.transferred(&raw);
    if js_trim(&raw) == "[]" {
        return Ok(Current::ValidEmpty);
    }
    Ok(match parse_saved_cards(Some(&raw)) {
        SavedCards::Ok(cards) => {
            ledger.reconcile(cards.len() as i64);
            Current::Ok(card_version(material_id, &cards).version_id)
        }
        SavedCards::Malformed => Current::Malformed,
        SavedCards::None => Current::ValidEmpty,
    })
}

impl Current {
    fn status(&self) -> &'static str {
        match self {
            Self::Ok(_) => "current",
            Self::Unavailable(_) => "unavailable",
            Self::Malformed => "malformed",
            Self::ValidEmpty => "valid_empty",
            Self::Pending(..) => "pending",
        }
    }

    fn version_id(&self) -> Option<&str> {
        match self {
            Self::Ok(v) => Some(v),
            _ => None,
        }
    }

    fn reason(&self) -> Option<&'static str> {
        match self {
            Self::Unavailable(r) => *r,
            Self::Pending(r, _) => Some(r),
            _ => None,
        }
    }

    fn inspection_target(&self) -> Option<&str> {
        match self {
            Self::Pending(_, t) => t.as_deref(),
            _ => None,
        }
    }

    fn enrichment(&self, material_id: &str) -> Value {
        json!({
            "materialId": material_id,
            "contentStatus": self.status(),
            "currentVersionId": self.version_id(),
            "reason": self.reason(),
            "inspectionTarget": self.inspection_target(),
        })
    }
}

fn json_integer(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64().or_else(|| {
            n.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15)
                .map(|f| f as i64)
        }),
        _ => None,
    }
}

/// `validateScheduleState`: (parsed object, validated schedule).
pub fn validate_schedule_state(
    state_json: Option<&str>,
    event_version: Option<&str>,
) -> (Value, Value) {
    let Some(text) = state_json.filter(|t| !t.is_empty()) else {
        return (Value::Null, Value::Null);
    };
    let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(text) else {
        return (Value::Null, Value::Null);
    };
    let invalid = (Value::Object(parsed.clone()), Value::Null);
    if event_version.is_some_and(|v| v != SCHEDULER_VERSION) {
        return invalid;
    }
    match parsed.get("schedulerVersion") {
        None | Some(Value::Null) => {
            if event_version != Some(SCHEDULER_VERSION) {
                return invalid;
            }
        }
        Some(v) if v == &json!(SCHEDULER_VERSION) => {}
        Some(_) => return invalid,
    }
    let Some(step) = json_integer(parsed.get("step")).filter(|s| (-1..=7).contains(s)) else {
        return invalid;
    };
    for key in ["dueAt", "lastReviewedAt"] {
        match parsed.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::String(s)) if parse_iso_ms(s).is_some() => {}
            Some(_) => return invalid,
        }
    }
    for key in ["reps", "lapses"] {
        match parsed.get(key) {
            None | Some(Value::Null) => {}
            v if json_integer(v).is_some_and(|n| n >= 0) => {}
            Some(_) => return invalid,
        }
    }
    let interval_days = if step >= 0 {
        Some(LADDER_DAYS[step as usize])
    } else {
        None
    };
    let interval_minutes = if step == -1 {
        AGAIN_DELAY_MINUTES
    } else {
        interval_days.unwrap_or(0) * 1440
    };
    let label = if step == -1 {
        format!("{AGAIN_DELAY_MINUTES}m")
    } else {
        format!("{}d", interval_days.unwrap_or(0))
    };
    let instant = |key: &str| {
        parsed
            .get(key)
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(Value::Null)
    };
    let count = |key: &str| {
        json_integer(parsed.get(key))
            .filter(|n| *n >= 0)
            .map_or(Value::Null, |n| json!(n))
    };
    let schedule = json!({
        "schedulerVersion": SCHEDULER_VERSION,
        "step": step,
        "dueAt": instant("dueAt"),
        "lastReviewedAt": instant("lastReviewedAt"),
        "reps": count("reps"),
        "lapses": count("lapses"),
        "intervalDays": interval_days,
        "intervalMinutes": interval_minutes,
        "intervalLabel": label,
    });
    (Value::Object(parsed), schedule)
}

struct EventRow {
    id: String,
    item_id: String,
    rating: String,
    reviewed_at: String,
    scheduler_version: String,
    prior: Option<String>,
    next: Option<String>,
    ordinal: i64,
    front: String,
    back: String,
    source_page: Option<i64>,
    version_id: String,
    content_hash: String,
    material_id: String,
    material_title: String,
    topic: String,
}

pub fn read_library_recent_reviews(tx: &Transaction, input: &Value) -> Check<Value> {
    let map = input
        .as_object()
        .ok_or(CardLibraryErrorCode::InvalidInput)?;
    let enrichment_only =
        map.get("enrichmentOnly") == Some(&Value::Bool(true)) || number_is(map.get("limit"), 0.0);
    let limit = if enrichment_only {
        0
    } else {
        bounded_integer(
            map.get("limit"),
            DEFAULT_HISTORY_PAGE_LIMIT,
            1,
            MAX_HISTORY_PAGE_LIMIT,
        )
    };
    let cards_budget = bounded_integer(
        map.get("maxBatchCardsBudget"),
        DEFAULT_BATCH_CARDS_BUDGET,
        1,
        MAX_BATCH_CARDS_BUDGET,
    );
    let bytes_budget = bounded_integer(
        map.get("maxBatchRawJsonBytesBudget"),
        DEFAULT_BATCH_RAW_BYTES_BUDGET,
        MIN_BATCH_RAW_BYTES_BUDGET,
        MAX_BATCH_RAW_BYTES_BUDGET,
    );
    let material_id = optional_text(
        map.get("materialId"),
        MAX_ID_LENGTH,
        CardLibraryErrorCode::InvalidInput,
    )?;
    let topic = optional_text(
        map.get("topic"),
        MAX_TOPIC_LENGTH,
        CardLibraryErrorCode::InvalidInput,
    )?;
    let mut targets: Vec<String> = Vec::new();
    match map.get("enrichMaterialIds") {
        None | Some(Value::Null) => {}
        Some(Value::Array(ids)) => {
            for id in ids {
                let id = bounded_id(Some(id)).ok_or(CardLibraryErrorCode::InvalidTarget)?;
                if !targets.iter().any(|t| t == id) {
                    targets.push(id.to_string());
                }
            }
            if targets.len() > MAX_HISTORY_TARGETS {
                return Err(CardLibraryErrorCode::InvalidTarget);
            }
        }
        Some(_) => return Err(CardLibraryErrorCode::InvalidTarget),
    }
    let ctx = json!({ "materialId": material_id, "topic": topic });
    let cursor = match decode_cursor(map.get("cursor"))? {
        None => None,
        Some(raw) => {
            let invalid = CardLibraryErrorCode::InvalidCursor;
            if !exact_keys(&raw, &["v", "type", "t", "id", "ctx"])
                || !number_is(raw.get("v"), 1.0)
                || raw.get("type") != Some(&json!("history"))
            {
                return Err(invalid);
            }
            let Some(Value::Object(c)) = raw.get("ctx") else {
                return Err(invalid);
            };
            if !exact_keys(c, &["materialId", "topic"]) || !is_instant(raw.get("t")) {
                return Err(invalid);
            }
            let id = bounded_id(raw.get("id")).ok_or(invalid)?.to_string();
            if c.get("materialId") != ctx.get("materialId") || c.get("topic") != ctx.get("topic") {
                return Err(CardLibraryErrorCode::StaleCursor);
            }
            Some((raw["t"].as_str().unwrap_or_default().to_string(), id))
        }
    };

    let mut page: Vec<EventRow> = Vec::new();
    let mut next: Option<String> = None;
    if !enrichment_only {
        let mut sql = String::from(
            "SELECT e.id, e.item_id, e.rating, e.reviewed_at, e.scheduler_version, e.prior_state_json, e.next_state_json,
                    i.ordinal, i.front, i.back, i.source_page, v.id, v.content_hash, v.source_material_id, m.title, m.topic
             FROM card_review_events e
             JOIN card_items i ON i.id = e.item_id
             JOIN card_versions v ON v.id = i.version_id
             JOIN study_materials m ON m.id = v.source_material_id
             WHERE 1 = 1",
        );
        let mut params: Vec<SqlValue> = Vec::new();
        if let Some(id) = &material_id {
            sql.push_str(" AND m.id = ?");
            params.push(SqlValue::Text(id.clone()));
        }
        if let Some(t) = &topic {
            sql.push_str(" AND m.topic = ?");
            params.push(SqlValue::Text(t.clone()));
        }
        if let Some((t, id)) = &cursor {
            sql.push_str(" AND (e.reviewed_at < ? OR (e.reviewed_at = ? AND e.id < ?))");
            params.extend([
                SqlValue::Text(t.clone()),
                SqlValue::Text(t.clone()),
                SqlValue::Text(id.clone()),
            ]);
        }
        sql.push_str(" ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?");
        params.push(SqlValue::Integer(limit + 1));
        let mut statement = tx.prepare(&sql).map_err(storage)?;
        let rows: Vec<EventRow> = statement
            .query_map(params_from_iter(params), |r| {
                Ok(EventRow {
                    id: r.get(0)?,
                    item_id: r.get(1)?,
                    rating: r.get(2)?,
                    reviewed_at: r.get(3)?,
                    scheduler_version: r.get(4)?,
                    prior: r.get(5)?,
                    next: r.get(6)?,
                    ordinal: r.get(7)?,
                    front: r.get(8)?,
                    back: r.get(9)?,
                    source_page: r.get(10)?,
                    version_id: r.get(11)?,
                    content_hash: r.get(12)?,
                    material_id: r.get(13)?,
                    material_title: r.get(14)?,
                    topic: r.get(15)?,
                })
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        let more = rows.len() as i64 > limit;
        page = rows.into_iter().take(limit as usize).collect();
        if let (true, Some(last)) = (more, page.last()) {
            next = Some(encode_cursor(&json!({
                "v": 1, "type": "history", "t": last.reviewed_at, "id": last.id, "ctx": ctx,
            }))?);
        }
    }

    let mut ledger = Ledger::new(cards_budget, bytes_budget);
    let mut current: Vec<(String, Current)> = Vec::new();
    let mut enrichment: Vec<Value> = Vec::new();
    for target in &targets {
        let info = if material_id.as_ref().is_some_and(|m| m != target) {
            Current::Unavailable(Some("filter_mismatch"))
        } else {
            let row: Option<(String, Option<i64>)> = tx
                .query_row(
                    "SELECT m.topic, LENGTH(CAST(a.flashcards_json AS BLOB)) AS byte_len
                     FROM study_materials m LEFT JOIN ai_study_sets a ON a.source_material_id = m.id WHERE m.id = ?1",
                    [target],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map(Some)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(other),
                })
                .map_err(storage)?;
            match row {
                None => Current::Unavailable(Some("not_found")),
                Some((t, _)) if topic.as_ref().is_some_and(|want| &t != want) => {
                    Current::Unavailable(Some("filter_mismatch"))
                }
                Some((_, None)) => Current::Unavailable(Some("no_study_set")),
                Some((_, Some(len))) => resolve_current(tx, &mut ledger, target, len)?,
            }
        };
        enrichment.push(info.enrichment(target));
        current.push((target.clone(), info));
    }
    let known = |current: &Vec<(String, Current)>, id: &str| current.iter().any(|(m, _)| m == id);
    let mut page_materials: Vec<String> = Vec::new();
    for row in &page {
        if !known(&current, &row.material_id) && !page_materials.contains(&row.material_id) {
            page_materials.push(row.material_id.clone());
        }
    }
    if !page_materials.is_empty() {
        let lengths = byte_lengths(tx, &page_materials)?;
        for id in &page_materials {
            let info = match lengths.get(id) {
                Some(Some(len)) => resolve_current(tx, &mut ledger, id, *len)?,
                _ => Current::Unavailable(None),
            };
            current.push((id.clone(), info));
        }
    }
    let lookup: HashMap<&str, &Current> = current.iter().map(|(m, c)| (m.as_str(), c)).collect();

    let rows: Vec<Value> = page
        .iter()
        .map(|row| {
            let info = lookup.get(row.material_id.as_str()).copied();
            let (status, earlier): (&str, Value) = match info {
                None | Some(Current::Unavailable(_)) => ("unavailable", json!(true)),
                Some(Current::Pending(..)) => ("pending", Value::Null),
                Some(Current::Ok(v)) if v == &row.version_id => ("current", json!(false)),
                Some(Current::Ok(_)) => ("earlier", json!(true)),
                Some(other) => (other.status(), json!(true)),
            };
            let (prior_parsed, prior_schedule) =
                validate_schedule_state(row.prior.as_deref(), Some(&row.scheduler_version));
            let (next_parsed, next_schedule) =
                validate_schedule_state(row.next.as_deref(), Some(&row.scheduler_version));
            let field = |key: &str| next_schedule.get(key).cloned().unwrap_or(Value::Null);
            json!({
                "id": row.id,
                "itemId": row.item_id,
                "materialId": row.material_id,
                "materialTitle": row.material_title,
                "topic": row.topic,
                "versionId": row.version_id,
                "contentHash": row.content_hash,
                "ordinal": row.ordinal,
                "front": row.front,
                "back": row.back,
                "sourcePage": row.source_page,
                "rating": row.rating,
                "reviewedAt": row.reviewed_at,
                "schedulerVersion": row.scheduler_version,
                "priorStateRaw": row.prior,
                "nextStateRaw": row.next,
                "priorState": prior_parsed,
                "nextState": next_parsed,
                "priorSchedule": prior_schedule,
                "nextSchedule": next_schedule,
                "step": field("step"),
                "dueAt": field("dueAt"),
                "intervalDays": field("intervalDays"),
                "intervalMinutes": field("intervalMinutes"),
                "intervalLabel": field("intervalLabel"),
                "isEarlierVersion": earlier,
                "contentStatus": status,
                "currentVersionId": info.and_then(|c| c.version_id()),
                "blockedReason": info.and_then(|c| c.reason()),
                "inspectionTarget": info.and_then(|c| c.inspection_target()),
            })
        })
        .collect();
    let pending: Vec<&String> = current
        .iter()
        .filter(|(_, c)| matches!(c, Current::Pending(reason, _) if *reason != "oversize"))
        .map(|(m, _)| m)
        .collect();
    Ok(json!({
        "rows": rows,
        "next": next,
        "pendingMaterialIds": pending,
        "enrichment": if targets.is_empty() { Value::Null } else { Value::Array(enrichment) },
        "summary": {
            "eventsReturned": page.len(),
            "rawReads": ledger.raw_reads,
            "rawBytesTransferred": ledger.raw_bytes,
            "attemptedCards": ledger.attempted_cards,
            "evaluatedCards": ledger.evaluated_cards,
            "maxBatchCardsBudget": cards_budget,
            "maxBatchRawJsonBytesBudget": bytes_budget,
            "isPageLocal": true,
        },
    }))
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/// Run one read on a read-only connection inside one deferred transaction.
pub fn read_at(
    root: &Path,
    reader: fn(&Transaction, &Value) -> Check<Value>,
    input: &Value,
) -> Result<Value, CardLibraryErrorWire> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(CardLibraryErrorCode::StorageError.error());
    }
    if !is_root_ready(root) {
        return Err(CardLibraryErrorCode::NotReady.error());
    }
    let mut connection = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| CardLibraryErrorCode::StorageError.error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| CardLibraryErrorCode::StorageError.error())?;
    let tx = connection
        .transaction()
        .map_err(|_| CardLibraryErrorCode::StorageError.error())?;
    let result = reader(&tx, input).map_err(CardLibraryErrorCode::error)?;
    tx.rollback()
        .map_err(|_| CardLibraryErrorCode::StorageError.error())?;
    Ok(result)
}

#[tauri::command]
pub async fn get_library_review_due(
    app: AppHandle,
    input: Value,
) -> Result<Value, CardLibraryErrorWire> {
    let root = app_root(&app).map_err(|_| CardLibraryErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || read_at(&root, read_library_review_due, &input))
        .await
        .map_err(|_| CardLibraryErrorCode::StorageError.error())?
}

#[tauri::command]
pub async fn get_library_recent_reviews(
    app: AppHandle,
    input: Value,
) -> Result<Value, CardLibraryErrorWire> {
    let root = app_root(&app).map_err(|_| CardLibraryErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || {
        read_at(&root, read_library_recent_reviews, &input)
    })
    .await
    .map_err(|_| CardLibraryErrorCode::StorageError.error())?
}

#[cfg(test)]
#[path = "card_library_tests.rs"]
mod tests;
