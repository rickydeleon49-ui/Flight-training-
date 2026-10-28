//! Material-level flashcard reviews (M2-3 source slice C1).
//!
//! The native half of the card-review contract in
//! `docs/M2_CARD_REVIEW_SCOPE_2026-10-06.md`:
//!
//! - content-addressed card identity (the twin of `src/logic/cardIdentity.ts`)
//! - the deterministic `simple-v1` scheduler (the twin of `src/logic/cardScheduler.ts`)
//! - `save_card_review_atomically`: one dedicated connection and one
//!   immediate transaction per action. Same-ID replay is resolved first, then
//!   the per-material generation barrier, then the item or reset branch.
//!
//! The browser and test twin is `src/data/cardReviewTransaction.ts`. Every
//! refusal is one allowlisted code with its fixed message.

use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::practice_sessions::{canonical_json, compute_canonical_hash, db_now_iso, is_root_ready};
use crate::storage::app_root;

/// Maximum request size on the wire (64 KiB).
pub const MAX_REQUEST_PAYLOAD_BYTES: usize = 64 * 1024;
/// Bound on `expectedGeneration` and `expectedRevision`.
pub const MAX_EXPECTED_COUNTER: i64 = 1_000_000_000;
pub const MAX_CARDS: usize = 500;
pub const MAX_FRONT_CHARS: usize = 1_000;
pub const MAX_BACK_CHARS: usize = 2_000;
pub const MAX_SOURCE_PAGE: i64 = 1_000;

pub const SCHEDULER_VERSION: &str = "simple-v1";
pub const MINUTE_MS: i64 = 60_000;
pub const DAY_MS: i64 = 24 * 60 * MINUTE_MS;
pub const AGAIN_DELAY_MINUTES: i64 = 10;
pub const LADDER_DAYS: [i64; 8] = [1, 3, 7, 16, 35, 75, 150, 180];
pub const MAX_STEP: i64 = LADDER_DAYS.len() as i64 - 1;

pub const ITEM_ACTIONS: [&str; 5] = ["rate", "suspend", "resume", "flag", "unflag"];
pub const RATINGS: [&str; 4] = ["again", "hard", "good", "easy"];
pub const FLAG_REASONS: [&str; 3] = ["wrong_answer", "unclear", "not_in_source"];

/* ------------------------------------------------------------------ */
/* Allowlisted errors                                                  */
/* ------------------------------------------------------------------ */

/// The native card-review refusals. Messages match
/// `CARD_REVIEW_ERROR_MESSAGES` in `src/data/persistenceErrors.ts` word for word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CardReviewErrorCode {
    InvalidArgument,
    OperationConflict,
    OperationErased,
    StaleGeneration,
    StaleRevision,
    StaleContent,
    MalformedCards,
    CardSuspended,
    CardFlagged,
    ClockBehindLastReview,
    NotFound,
    InvalidState,
    NotReady,
    StorageError,
}

impl CardReviewErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArgument => "The card review request is invalid.",
            Self::OperationConflict => {
                "This request was already used for a different card review action."
            }
            Self::OperationErased => {
                "This card review request belongs to history that has been erased."
            }
            Self::StaleGeneration => {
                "Card reviews for this material were reset after this request was prepared."
            }
            Self::StaleRevision => "This card changed after this request was prepared.",
            Self::StaleContent => "These cards changed after this request was prepared.",
            Self::MalformedCards => "These saved cards can't be reviewed because they're damaged.",
            Self::CardSuspended => "This card is paused.",
            Self::CardFlagged => "This card is flagged.",
            Self::ClockBehindLastReview => {
                "The computer's clock is earlier than this card's last review."
            }
            Self::NotFound => "The card or material was not found.",
            Self::InvalidState => "Saved card review data is not in a state this request can use.",
            Self::NotReady => "Card reviews are not ready yet.",
            Self::StorageError => "A storage error occurred while saving the card review.",
        }
    }

    pub fn error(self) -> CardReviewErrorWire {
        CardReviewErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

/// The wire refusal: one code and its fixed message, never engine text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardReviewErrorWire {
    pub code: CardReviewErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for CardReviewErrorWire {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for CardReviewErrorWire {}

type Check<T> = Result<T, CardReviewErrorCode>;

fn storage<E>(_: E) -> CardReviewErrorCode {
    CardReviewErrorCode::StorageError
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/// Lower-case hex SHA-256 of UTF-8 text.
pub fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// ECMAScript `String.prototype.trim`: Unicode White_Space without U+0085,
/// plus U+FEFF, so both sides agree on every length boundary.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// A card side is valid when its trimmed length is 1–`max` code points.
pub fn is_valid_card_text(text: &str, max: usize) -> bool {
    let length = js_trim(text).chars().count();
    (1..=max).contains(&length)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalCard {
    pub visual_region_id: Option<String>,
    pub front: String,
    pub back: String,
    pub source_page: Option<i64>,
    /// `user` or `instructor` for a card she made or edited (OFFLINE-03);
    /// `None` for generated or imported cards, which hash exactly as before.
    pub origin: Option<String>,
}

/// The only card origins (`CardOrigin` in `cardIdentity.ts`).
pub const CARD_ORIGINS: [&str; 2] = ["user", "instructor"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardItem {
    pub item_id: String,
    pub ordinal: i64,
    pub card: CanonicalCard,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardVersion {
    pub version_id: String,
    pub content_hash: String,
    pub items: Vec<CardItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SavedCards {
    None,
    Malformed,
    Ok(Vec<CanonicalCard>),
}

/// An integral JSON number (JavaScript `Number.isInteger`), as an i64.
fn integral(number: &serde_json::Number) -> Option<i64> {
    number.as_i64().or_else(|| {
        number
            .as_f64()
            .filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15)
            .map(|f| f as i64)
    })
}

/// Validate a material's saved `flashcards_json` exactly as
/// `parseSavedCards` does: absent or `[]` is `None`; any damaged card makes
/// the whole set `Malformed`; nothing is converted to empty.
pub fn parse_saved_cards(flashcards_json: Option<&str>) -> SavedCards {
    let Some(text) = flashcards_json else {
        return SavedCards::None;
    };
    let Ok(Value::Array(cards)) = serde_json::from_str::<Value>(text) else {
        return SavedCards::Malformed;
    };
    if cards.is_empty() {
        return SavedCards::None;
    }
    if cards.len() > MAX_CARDS {
        return SavedCards::Malformed;
    }
    let mut out = Vec::with_capacity(cards.len());
    for card in cards {
        let Value::Object(map) = card else {
            return SavedCards::Malformed;
        };
        let (Some(Value::String(front)), Some(Value::String(back))) =
            (map.get("front"), map.get("back"))
        else {
            return SavedCards::Malformed;
        };
        if !is_valid_card_text(front, MAX_FRONT_CHARS) || !is_valid_card_text(back, MAX_BACK_CHARS)
        {
            return SavedCards::Malformed;
        }
        let source_page = match map.get("sourcePage") {
            Some(Value::Null) => None,
            Some(Value::Number(n)) => match integral(n) {
                Some(page) if (1..=MAX_SOURCE_PAGE).contains(&page) => Some(page),
                _ => return SavedCards::Malformed,
            },
            _ => return SavedCards::Malformed,
        };
        let origin = match map.get("origin") {
            None => None,
            Some(Value::String(value)) if CARD_ORIGINS.contains(&value.as_str()) => {
                Some(value.clone())
            }
            Some(_) => return SavedCards::Malformed,
        };
        let visual_region_id = match map.get("visualRegionId") {
            None => None,
            Some(Value::String(id)) if is_lower_hex_64(id) => Some(id.clone()),
            _ => return SavedCards::Malformed,
        };
        out.push(CanonicalCard {
            visual_region_id,
            front: front.clone(),
            back: back.clone(),
            source_page,
            origin,
        });
    }
    SavedCards::Ok(out)
}

/// The canonical JSON of ordered cards (sorted keys; front, back, sourcePage,
/// and `origin` only when a card has one, so legacy hashes are unchanged).
pub fn canonical_cards_json(cards: &[CanonicalCard]) -> String {
    let values: Vec<Value> = cards
        .iter()
        .map(|card| {
            let mut value =
                json!({ "front": card.front, "back": card.back, "sourcePage": card.source_page });
            if let Some(id) = &card.visual_region_id {
                value["visualRegionId"] = json!(id);
            }
            if let Some(origin) = &card.origin {
                value["origin"] = json!(origin);
            }
            value
        })
        .collect();
    canonical_json(&Value::Array(values))
}

/// The content-addressed version of a material's ordered cards.
pub fn card_version(material_id: &str, cards: &[CanonicalCard]) -> CardVersion {
    let content_hash = sha256_hex(&canonical_cards_json(cards));
    let version_id = sha256_hex(&format!("{material_id}\u{0}{content_hash}"));
    let items = cards
        .iter()
        .enumerate()
        .map(|(ordinal, card)| CardItem {
            item_id: sha256_hex(&format!("{version_id}\u{0}{ordinal}")),
            ordinal: ordinal as i64,
            card: card.clone(),
        })
        .collect();
    CardVersion {
        version_id,
        content_hash,
        items,
    }
}

/* ------------------------------------------------------------------ */
/* Instants and the simple-v1 scheduler                                */
/* ------------------------------------------------------------------ */

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// The 24-character UTC form of an instant (`Date#toISOString`).
pub fn format_iso_ms(ms: i64) -> String {
    let days = ms.div_euclid(DAY_MS);
    let in_day = ms.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        in_day / 3_600_000,
        (in_day / 60_000) % 60,
        (in_day / 1_000) % 60,
        in_day % 1_000
    )
}

/// Parse only the exact 24-character UTC form that round-trips.
pub fn parse_iso_ms(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() != 24
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'.'
        || b[23] != b'Z'
    {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let digits = &text[range];
        if digits.bytes().all(|c| c.is_ascii_digit()) {
            digits.parse().ok()
        } else {
            None
        }
    };
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second, milli) = (
        number(11..13)?,
        number(14..16)?,
        number(17..19)?,
        number(20..23)?,
    );
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let ms = (days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
        * 1_000
        + milli;
    (format_iso_ms(ms) == text).then_some(ms)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardSchedule {
    pub scheduler_version: String,
    pub step: i64,
    pub reps: i64,
    pub lapses: i64,
    pub last_reviewed_at: String,
    pub due_at: String,
}

impl CardSchedule {
    pub fn to_json(&self) -> Value {
        json!({
            "schedulerVersion": self.scheduler_version,
            "step": self.step,
            "reps": self.reps,
            "lapses": self.lapses,
            "lastReviewedAt": self.last_reviewed_at,
            "dueAt": self.due_at,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchedulerRefusal {
    InvalidRating,
    InvalidTime,
    UnsupportedSchedulerVersion,
    ClockBehindLastReview,
}

/// The wait a step sets after a review, in milliseconds.
pub fn step_delay_ms(step: i64) -> Option<i64> {
    if step == -1 {
        Some(AGAIN_DELAY_MINUTES * MINUTE_MS)
    } else {
        usize::try_from(step)
            .ok()
            .and_then(|i| LADDER_DAYS.get(i))
            .map(|days| days * DAY_MS)
    }
}

/// `simple-v1`: identical arithmetic to `scheduleCard`.
pub fn schedule_card(
    prior: Option<&CardSchedule>,
    rating: &str,
    now: &str,
) -> Result<CardSchedule, SchedulerRefusal> {
    if !RATINGS.contains(&rating) {
        return Err(SchedulerRefusal::InvalidRating);
    }
    let now_ms = parse_iso_ms(now).ok_or(SchedulerRefusal::InvalidTime)?;
    if let Some(prior) = prior {
        if prior.scheduler_version != SCHEDULER_VERSION {
            return Err(SchedulerRefusal::UnsupportedSchedulerVersion);
        }
        let last = parse_iso_ms(&prior.last_reviewed_at).ok_or(SchedulerRefusal::InvalidTime)?;
        if now_ms < last {
            return Err(SchedulerRefusal::ClockBehindLastReview);
        }
    }
    let from = prior.map_or(-1, |p| p.step);
    let mut lapses = prior.map_or(0, |p| p.lapses);
    let step = match rating {
        "again" => {
            if from >= 0 {
                lapses += 1;
            }
            -1
        }
        "hard" => from.max(0),
        "good" => (from + 1).min(MAX_STEP),
        _ => (from + 2).min(MAX_STEP),
    };
    let delay = step_delay_ms(step).ok_or(SchedulerRefusal::UnsupportedSchedulerVersion)?;
    Ok(CardSchedule {
        scheduler_version: SCHEDULER_VERSION.to_string(),
        step,
        reps: prior.map_or(0, |p| p.reps) + 1,
        lapses,
        last_reviewed_at: format_iso_ms(now_ms),
        due_at: format_iso_ms(now_ms + delay),
    })
}

/* ------------------------------------------------------------------ */
/* Strict decode                                                       */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemKind {
    Rate(String),
    Suspend,
    Resume,
    Flag(String),
    Unflag,
}

impl ItemKind {
    fn name(&self) -> &'static str {
        match self {
            Self::Rate(_) => "rate",
            Self::Suspend => "suspend",
            Self::Resume => "resume",
            Self::Flag(_) => "flag",
            Self::Unflag => "unflag",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CardAction {
    Item {
        operation_id: String,
        material_id: String,
        version_content_hash: String,
        item_id: String,
        expected_generation: i64,
        expected_revision: i64,
        kind: ItemKind,
    },
    Reset {
        operation_id: String,
        material_id: String,
        expected_generation: i64,
    },
}

impl CardAction {
    pub fn operation_id(&self) -> &str {
        match self {
            Self::Item { operation_id, .. } | Self::Reset { operation_id, .. } => operation_id,
        }
    }

    pub fn material_id(&self) -> &str {
        match self {
            Self::Item { material_id, .. } | Self::Reset { material_id, .. } => material_id,
        }
    }

    pub fn expected_generation(&self) -> i64 {
        match self {
            Self::Item {
                expected_generation,
                ..
            }
            | Self::Reset {
                expected_generation,
                ..
            } => *expected_generation,
        }
    }
}

fn lower_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, &c)| match i {
            8 | 13 | 18 | 23 => c == b'-',
            14 => c == b'4',
            19 => matches!(c, b'8' | b'9' | b'a' | b'b'),
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

pub fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn is_material_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-' || c == b'.')
}

fn exact_keys(map: &Map<String, Value>, keys: &[&str]) -> Check<()> {
    if map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)) {
        Ok(())
    } else {
        Err(CardReviewErrorCode::InvalidArgument)
    }
}

fn string_field<'a>(
    map: &'a Map<String, Value>,
    key: &str,
    valid: fn(&str) -> bool,
) -> Check<&'a str> {
    match map.get(key) {
        Some(Value::String(s)) if valid(s) => Ok(s),
        _ => Err(CardReviewErrorCode::InvalidArgument),
    }
}

fn counter_field(map: &Map<String, Value>, key: &str) -> Check<i64> {
    match map.get(key) {
        Some(Value::Number(n)) => integral(n)
            .filter(|v| (0..=MAX_EXPECTED_COUNTER).contains(v))
            .ok_or(CardReviewErrorCode::InvalidArgument),
        _ => Err(CardReviewErrorCode::InvalidArgument),
    }
}

/// Strict two-pass decode: the branch and its exact keys, then every field.
pub fn decode_card_action(value: &Value) -> Check<CardAction> {
    let map = value
        .as_object()
        .ok_or(CardReviewErrorCode::InvalidArgument)?;
    if value.to_string().len() > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(CardReviewErrorCode::InvalidArgument);
    }
    let action = match map.get("action") {
        Some(Value::String(s)) => s.as_str(),
        _ => return Err(CardReviewErrorCode::InvalidArgument),
    };
    const ITEM_KEYS: [&str; 7] = [
        "action",
        "operationId",
        "materialId",
        "versionContentHash",
        "itemId",
        "expectedGeneration",
        "expectedRevision",
    ];
    // Pass one: the branch and its exact keys.
    match action {
        "reset" => exact_keys(
            map,
            &["action", "operationId", "materialId", "expectedGeneration"],
        )?,
        "rate" => {
            let mut keys = [&ITEM_KEYS[..], &["rating"]].concat();
            if let Some(context) = map.get("homework") {
                crate::homework::cards::context(context)
                    .map_err(|_| CardReviewErrorCode::InvalidArgument)?;
                keys.push("homework");
            }
            exact_keys(map, &keys)?;
        }
        "flag" => exact_keys(map, &[&ITEM_KEYS[..], &["reason"]].concat())?,
        "suspend" | "resume" | "unflag" => exact_keys(map, &ITEM_KEYS)?,
        _ => return Err(CardReviewErrorCode::InvalidArgument),
    }
    // Pass two: types and bounds.
    let operation_id = string_field(map, "operationId", lower_uuid_v4)?.to_string();
    let material_id = string_field(map, "materialId", is_material_id)?.to_string();
    let expected_generation = counter_field(map, "expectedGeneration")?;
    if action == "reset" {
        return Ok(CardAction::Reset {
            operation_id,
            material_id,
            expected_generation,
        });
    }
    let kind = match action {
        "rate" => {
            ItemKind::Rate(string_field(map, "rating", |r| RATINGS.contains(&r))?.to_string())
        }
        "flag" => {
            ItemKind::Flag(string_field(map, "reason", |r| FLAG_REASONS.contains(&r))?.to_string())
        }
        "suspend" => ItemKind::Suspend,
        "resume" => ItemKind::Resume,
        _ => ItemKind::Unflag,
    };
    Ok(CardAction::Item {
        operation_id,
        material_id,
        version_content_hash: string_field(map, "versionContentHash", is_lower_hex_64)?.to_string(),
        item_id: string_field(map, "itemId", is_lower_hex_64)?.to_string(),
        expected_generation,
        expected_revision: counter_field(map, "expectedRevision")?,
        kind,
    })
}

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

struct StateRow {
    scheduler_version: String,
    step: i64,
    due_at: Option<String>,
    last_reviewed_at: Option<String>,
    reps: i64,
    lapses: i64,
    suspended: bool,
    flag: Option<String>,
    revision: i64,
}

fn read_generation(tx: &Transaction, material_id: &str) -> Check<i64> {
    tx.query_row(
        "SELECT generation FROM card_review_generations WHERE source_material_id = ?1",
        [material_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(storage)
    .map(|g| g.unwrap_or(0))
}

fn read_saved_set(tx: &Transaction, material_id: &str) -> Check<Option<(String, String)>> {
    tx.query_row(
        "SELECT flashcards_json, provider FROM ai_study_sets WHERE source_material_id = ?1",
        [material_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(storage)
}

fn read_state(tx: &Transaction, item_id: &str) -> Check<Option<StateRow>> {
    tx.query_row(
        "SELECT scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
         FROM card_review_state WHERE item_id = ?1",
        [item_id],
        |r| {
            Ok(StateRow {
                scheduler_version: r.get(0)?,
                step: r.get(1)?,
                due_at: r.get(2)?,
                last_reviewed_at: r.get(3)?,
                reps: r.get(4)?,
                lapses: r.get(5)?,
                suspended: r.get::<_, i64>(6)? == 1,
                flag: r.get(7)?,
                revision: r.get(8)?,
            })
        },
    )
    .optional()
    .map_err(storage)
}

/// A snapshot's own origin: `manual` when she wrote every card, `mixed` when
/// she wrote some, none when all are generated or imported (`versionOrigin`).
pub fn version_origin(items: &[CardItem]) -> Option<&'static str> {
    let mine = items
        .iter()
        .filter(|item| item.card.origin.is_some())
        .count();
    match mine {
        0 => None,
        n if n == items.len() => Some("manual"),
        _ => Some("mixed"),
    }
}

/// Write the snapshot if absent, verify a stored one against the derived
/// text, and make it the material's only active version.
fn materialize(
    tx: &Transaction,
    material_id: &str,
    version: &CardVersion,
    provider: &str,
    now: &str,
) -> Check<()> {
    let stored: Option<(String, String)> = tx
        .query_row(
            "SELECT source_material_id, content_hash FROM card_versions WHERE id = ?1",
            [&version.version_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(storage)?;
    if let Some((stored_material, stored_hash)) = stored {
        if stored_material != material_id || stored_hash != version.content_hash {
            return Err(CardReviewErrorCode::InvalidState);
        }
        let mut statement = tx
            .prepare(
                "SELECT i.id, i.ordinal, i.front, i.back, i.source_page, o.origin FROM card_items i
                 LEFT JOIN card_item_origins o ON o.item_id = i.id
                 WHERE i.version_id = ?1 ORDER BY i.ordinal",
            )
            .map_err(storage)?;
        let rows: Vec<CardItem> = statement
            .query_map([&version.version_id], |r| {
                Ok(CardItem {
                    item_id: r.get(0)?,
                    ordinal: r.get(1)?,
                    card: CanonicalCard {
                        visual_region_id: crate::visual_cards::frozen_id(
                            tx,
                            &r.get::<_, String>(0)?,
                        )?,
                        front: r.get(2)?,
                        back: r.get(3)?,
                        source_page: r.get(4)?,
                        origin: r.get(5)?,
                    },
                })
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        if rows != version.items {
            return Err(CardReviewErrorCode::InvalidState);
        }
    } else {
        // The legacy CHECK allows only these two; a set she made herself
        // records 'import' as its placeholder, and its true origin below.
        let provider = match provider {
            "gemini" | "import" => provider,
            "manual" => "import",
            _ => return Err(CardReviewErrorCode::InvalidState),
        };
        tx.execute(
            "INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, first_reviewed_at, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 0)",
            params![
                version.version_id,
                material_id,
                version.content_hash,
                version.items.len() as i64,
                provider,
                now
            ],
        )
        .map_err(storage)?;
        let mut insert = tx
            .prepare(
                "INSERT INTO card_items (id, version_id, ordinal, front, back, source_page)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(storage)?;
        for item in &version.items {
            insert
                .execute(params![
                    item.item_id,
                    version.version_id,
                    item.ordinal,
                    item.card.front,
                    item.card.back,
                    item.card.source_page
                ])
                .map_err(storage)?;
            if let Some(id) = &item.card.visual_region_id {
                crate::visual_cards::check_owner(tx, id, material_id)
                    .map_err(|_| CardReviewErrorCode::InvalidState)?;
                tx.execute(
                    "INSERT INTO card_item_visual_regions (item_id,region_id) VALUES (?1,?2)",
                    params![item.item_id, id],
                )
                .map_err(storage)?;
            }
            if let Some(origin) = &item.card.origin {
                tx.execute(
                    "INSERT INTO card_item_origins (item_id, origin) VALUES (?1, ?2)",
                    params![item.item_id, origin],
                )
                .map_err(storage)?;
            }
        }
        if let Some(origin) = version_origin(&version.items) {
            tx.execute(
                "INSERT INTO card_version_origins (version_id, origin) VALUES (?1, ?2)",
                params![version.version_id, origin],
            )
            .map_err(storage)?;
        }
    }
    tx.execute(
        "UPDATE card_versions SET is_active = 0 WHERE source_material_id = ?1 AND id != ?2 AND is_active = 1",
        params![material_id, version.version_id],
    )
    .map_err(storage)?;
    tx.execute(
        "UPDATE card_versions SET is_active = 1 WHERE id = ?1",
        [&version.version_id],
    )
    .map_err(storage)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_item(
    tx: &Transaction,
    operation_id: &str,
    material_id: &str,
    version_content_hash: &str,
    item_id: &str,
    expected_revision: i64,
    kind: &ItemKind,
    generation: i64,
    request_hash: &str,
    now: &str,
) -> Check<Value> {
    let (flashcards_json, provider) =
        read_saved_set(tx, material_id)?.ok_or(CardReviewErrorCode::NotFound)?;
    let cards = match parse_saved_cards(Some(&flashcards_json)) {
        SavedCards::Ok(cards) => cards,
        SavedCards::Malformed => return Err(CardReviewErrorCode::MalformedCards),
        SavedCards::None => return Err(CardReviewErrorCode::NotFound),
    };
    let version = card_version(material_id, &cards);
    if version.content_hash != version_content_hash {
        return Err(CardReviewErrorCode::StaleContent);
    }
    if !version.items.iter().any(|item| item.item_id == item_id) {
        return Err(CardReviewErrorCode::NotFound);
    }

    if let Some(id) = version
        .items
        .iter()
        .find(|i| i.item_id == item_id)
        .and_then(|i| i.card.visual_region_id.as_ref())
    {
        let r = crate::visual_cards::check_owner(tx, id, material_id)
            .map_err(|_| CardReviewErrorCode::InvalidState)?;
        if matches!(kind, ItemKind::Rate(_)) && r.image_material_id.is_none() {
            return Err(CardReviewErrorCode::InvalidState);
        }
    }
    materialize(tx, material_id, &version, &provider, now)?;
    crate::study_page_sources::freeze(
        tx,
        material_id,
        &version
            .items
            .iter()
            .map(|i| (i.item_id.clone(), i.ordinal as usize))
            .collect::<Vec<_>>(),
    )
    .map_err(storage)?;

    let current = read_state(tx, item_id)?;
    let revision = current.as_ref().map_or(0, |s| s.revision);
    if expected_revision != revision {
        return Err(CardReviewErrorCode::StaleRevision);
    }
    let mut next = current.unwrap_or(StateRow {
        scheduler_version: SCHEDULER_VERSION.to_string(),
        step: -1,
        due_at: None,
        last_reviewed_at: None,
        reps: 0,
        lapses: 0,
        suspended: false,
        flag: None,
        revision: 0,
    });
    next.revision = revision + 1;
    let mut reviewed_at: Option<String> = None;

    match kind {
        ItemKind::Rate(rating) => {
            if next.suspended {
                return Err(CardReviewErrorCode::CardSuspended);
            }
            if next.flag.is_some() {
                return Err(CardReviewErrorCode::CardFlagged);
            }
            let prior = match (&next.due_at, &next.last_reviewed_at) {
                (Some(due_at), Some(last_reviewed_at)) => Some(CardSchedule {
                    scheduler_version: next.scheduler_version.clone(),
                    step: next.step,
                    reps: next.reps,
                    lapses: next.lapses,
                    last_reviewed_at: last_reviewed_at.clone(),
                    due_at: due_at.clone(),
                }),
                _ => None,
            };
            let scheduled =
                schedule_card(prior.as_ref(), rating, now).map_err(|refusal| match refusal {
                    SchedulerRefusal::ClockBehindLastReview => {
                        CardReviewErrorCode::ClockBehindLastReview
                    }
                    _ => CardReviewErrorCode::InvalidState,
                })?;
            let prior_json = prior
                .as_ref()
                .map_or_else(|| "null".to_string(), |p| canonical_json(&p.to_json()));
            tx.execute(
                "INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    operation_id,
                    item_id,
                    generation,
                    rating,
                    scheduled.last_reviewed_at,
                    scheduled.scheduler_version,
                    prior_json,
                    canonical_json(&scheduled.to_json())
                ],
            )
            .map_err(storage)?;
            tx.execute(
                "UPDATE card_versions SET first_reviewed_at = ?1 WHERE id = ?2 AND first_reviewed_at IS NULL",
                params![scheduled.last_reviewed_at, version.version_id],
            )
            .map_err(storage)?;
            reviewed_at = Some(scheduled.last_reviewed_at.clone());
            next.scheduler_version = scheduled.scheduler_version;
            next.step = scheduled.step;
            next.due_at = Some(scheduled.due_at);
            next.last_reviewed_at = Some(scheduled.last_reviewed_at);
            next.reps = scheduled.reps;
            next.lapses = scheduled.lapses;
        }
        ItemKind::Suspend => next.suspended = true,
        ItemKind::Resume => next.suspended = false,
        ItemKind::Flag(reason) => next.flag = Some(reason.clone()),
        ItemKind::Unflag => next.flag = None,
    }

    tx.execute(
        "INSERT INTO card_review_state
           (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(item_id) DO UPDATE SET
           scheduler_version = excluded.scheduler_version, step = excluded.step, due_at = excluded.due_at,
           last_reviewed_at = excluded.last_reviewed_at, reps = excluded.reps, lapses = excluded.lapses,
           suspended = excluded.suspended, flag = excluded.flag, revision = excluded.revision",
        params![
            item_id,
            material_id,
            next.scheduler_version,
            next.step,
            next.due_at,
            next.last_reviewed_at,
            next.reps,
            next.lapses,
            i64::from(next.suspended),
            next.flag,
            next.revision
        ],
    )
    .map_err(storage)?;

    let result = json!({
        "action": kind.name(),
        "itemId": item_id,
        "generation": generation,
        "revision": next.revision,
        "dueAt": next.due_at,
        "reviewedAt": reviewed_at,
        "suspended": next.suspended,
        "flag": next.flag,
    });
    tx.execute(
        "INSERT INTO card_review_operations
           (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        params![
            operation_id,
            kind.name(),
            material_id,
            generation,
            request_hash,
            now,
            canonical_json(&result)
        ],
    )
    .map_err(storage)?;
    Ok(result)
}

fn apply_reset(
    tx: &Transaction,
    operation_id: &str,
    material_id: &str,
    generation: i64,
    request_hash: &str,
    now: &str,
) -> Check<Value> {
    let exists: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM study_materials WHERE id = ?1",
            [material_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    if exists.is_none() {
        return Err(CardReviewErrorCode::NotFound);
    }
    let keep = match read_saved_set(tx, material_id)? {
        Some((flashcards_json, _)) => match parse_saved_cards(Some(&flashcards_json)) {
            SavedCards::Ok(cards) => Some(card_version(material_id, &cards).version_id),
            _ => None,
        },
        None => None,
    };
    tx.execute(
        "DELETE FROM card_review_events WHERE item_id IN (
           SELECT i.id FROM card_items i JOIN card_versions v ON v.id = i.version_id WHERE v.source_material_id = ?1)",
        [material_id],
    )
    .map_err(storage)?;
    tx.execute(
        "DELETE FROM card_review_state WHERE source_material_id = ?1",
        [material_id],
    )
    .map_err(storage)?;
    match &keep {
        None => tx.execute(
            "DELETE FROM card_versions WHERE source_material_id = ?1",
            [material_id],
        ),
        Some(version_id) => tx
            .execute(
                "DELETE FROM card_versions WHERE source_material_id = ?1 AND id != ?2",
                params![material_id, version_id],
            )
            .and_then(|_| {
                tx.execute(
                    "UPDATE card_versions SET first_reviewed_at = NULL, is_active = 1 WHERE id = ?1",
                    [version_id],
                )
            }),
    }
    .map_err(storage)?;
    // Already tombstoned receipts are skipped, never rewritten.
    tx.execute(
        "UPDATE card_review_operations SET is_erased = 1, result_json = NULL
         WHERE source_material_id = ?1 AND is_erased = 0",
        [material_id],
    )
    .map_err(storage)?;
    let next = generation + 1;
    tx.execute(
        "INSERT INTO card_review_generations (source_material_id, generation) VALUES (?1, ?2)
         ON CONFLICT(source_material_id) DO UPDATE SET generation = excluded.generation",
        params![material_id, next],
    )
    .map_err(storage)?;
    let result = json!({ "action": "reset", "materialId": material_id, "generation": next });
    tx.execute(
        "INSERT INTO card_review_operations
           (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
         VALUES (?1, 'reset', ?2, ?3, ?4, ?5, 0, ?6)",
        params![
            operation_id,
            material_id,
            generation,
            request_hash,
            now,
            canonical_json(&result)
        ],
    )
    .map_err(storage)?;
    Ok(result)
}

/// Steps 3–6 of the scope's transaction on an open immediate transaction.
pub fn execute_card_review_transaction(
    tx: &Transaction,
    action: &CardAction,
    action_value: &Value,
) -> Check<Value> {
    let request_hash = compute_canonical_hash(action_value);
    let receipt: Option<(String, i64, Option<String>)> = tx
        .query_row(
            "SELECT request_hash, is_erased, result_json FROM card_review_operations WHERE operation_id = ?1",
            [action.operation_id()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(storage)?;
    if let Some((stored_hash, is_erased, result_json)) = receipt {
        if stored_hash != request_hash {
            return Err(CardReviewErrorCode::OperationConflict);
        }
        if is_erased == 1 {
            return Err(CardReviewErrorCode::OperationErased);
        }
        let text = result_json.ok_or(CardReviewErrorCode::InvalidState)?;
        return serde_json::from_str(&text).map_err(|_| CardReviewErrorCode::InvalidState);
    }

    let generation = read_generation(tx, action.material_id())?;
    if action.expected_generation() != generation {
        return Err(CardReviewErrorCode::StaleGeneration);
    }
    let now = db_now_iso(tx).map_err(storage)?;
    let result = match action {
        CardAction::Reset {
            operation_id,
            material_id,
            ..
        } => apply_reset(
            tx,
            operation_id,
            material_id,
            generation,
            &request_hash,
            &now,
        ),
        CardAction::Item {
            operation_id,
            material_id,
            version_content_hash,
            item_id,
            expected_revision,
            kind,
            ..
        } => apply_item(
            tx,
            operation_id,
            material_id,
            version_content_hash,
            item_id,
            *expected_revision,
            kind,
            generation,
            &request_hash,
            &now,
        ),
    }?;
    if action_value["action"] == "rate" && action_value.get("homework").is_some() {
        crate::homework::cards::record_rating(tx, action_value, &now)
            .map_err(|_| CardReviewErrorCode::InvalidState)?;
    }
    if action_value["action"] == "reset" {
        crate::homework::cards::invalidate(tx, action.material_id(), &now)
            .map_err(|_| CardReviewErrorCode::InvalidState)?;
    }
    Ok(result)
}

/// `save_card_review_atomically` at a database root: decode, readiness, one
/// dedicated connection (5 s busy timeout, foreign keys on), `BEGIN IMMEDIATE`,
/// commit only when the whole action applies.
pub fn save_card_review_at(root: &Path, operation: &Value) -> Result<Value, CardReviewErrorWire> {
    let action = decode_card_action(operation).map_err(CardReviewErrorCode::error)?;
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(CardReviewErrorCode::StorageError.error());
    }
    if !is_root_ready(root) {
        return Err(CardReviewErrorCode::NotReady.error());
    }
    let mut connection =
        Connection::open(&db_path).map_err(|_| CardReviewErrorCode::StorageError.error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| CardReviewErrorCode::StorageError.error())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| CardReviewErrorCode::StorageError.error())?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| CardReviewErrorCode::StorageError.error())?;
    let replay: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM card_review_operations WHERE operation_id=?1)",
            [action.operation_id()],
            |r| r.get(0),
        )
        .map_err(|_| CardReviewErrorCode::StorageError.error())?;
    let verify_visual = || -> Result<(), CardReviewErrorWire> {
        if let CardAction::Item {
            material_id,
            item_id,
            kind: ItemKind::Rate(_),
            ..
        } = &action
        {
            if let Some((text, _)) =
                read_saved_set(&tx, material_id).map_err(CardReviewErrorCode::error)?
            {
                if let SavedCards::Ok(cards) = parse_saved_cards(Some(&text)) {
                    let v = card_version(material_id, &cards);
                    if let Some(id) = v
                        .items
                        .iter()
                        .find(|i| &i.item_id == item_id)
                        .and_then(|i| i.card.visual_region_id.as_ref())
                    {
                        let r = crate::visual_cards::check_owner(&tx, id, material_id)
                            .map_err(|_| CardReviewErrorCode::InvalidState.error())?;
                        crate::visual_cards::verify_image(&tx, root, &r)
                            .map_err(|_| CardReviewErrorCode::InvalidState.error())?;
                    }
                }
            }
        }
        Ok(())
    };
    if !replay {
        verify_visual()?;
    }
    let result = execute_card_review_transaction(&tx, &action, operation)
        .map_err(CardReviewErrorCode::error)?;
    if !replay {
        verify_visual()?;
    }
    tx.commit()
        .map_err(|_| CardReviewErrorCode::StorageError.error())?;
    Ok(result)
}

#[tauri::command]
pub async fn save_card_review_atomically(
    app: AppHandle,
    operation: Value,
) -> Result<Value, CardReviewErrorWire> {
    let root = app_root(&app).map_err(|_| CardReviewErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || save_card_review_at(&root, &operation))
        .await
        .map_err(|_| CardReviewErrorCode::StorageError.error())?
}

#[cfg(test)]
#[path = "card_reviews_tests.rs"]
mod tests;
