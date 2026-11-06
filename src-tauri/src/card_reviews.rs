//! Material-level flashcard reviews (M2-3 source slice C1).
//!
//! The native half of the card-review contract:
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
        "UPDATE card_versions SET is_active = 1 WHERE id = ?1 AND is_active = 0",
        [&version.version_id],
    )
    .map_err(storage)?;
    Ok(())
}

/// A UUIDv4-shaped id derived from `seed`, so the native and browser twins
/// (and a retry) make the same ids for the same carried rating.
pub fn derived_uuid_v4(seed: &str) -> String {
    let h = sha256_hex(seed);
    let nibble = u8::from_str_radix(&h[16..17], 16).unwrap_or(0);
    let variant = b"89ab"[(nibble % 4) as usize] as char;
    format!(
        "{}-{}-4{}-{}{}-{}",
        &h[0..8],
        &h[8..12],
        &h[13..16],
        variant,
        &h[17..20],
        &h[20..32]
    )
}

/// The id of rating `event_id` carried onto `item_id`; local carry and sync
/// apply must agree.
pub(crate) fn carried_event_id(event_id: &str, item_id: &str) -> String {
    derived_uuid_v4(&format!("{event_id}\u{0}{item_id}"))
}

/// PER-CARD CARRY-OVER (owner decision 05 Nov: an edit changes only the card
/// she edited). After a save, every card of the new list that is the same card
/// as a card of ANY stored version of the material keeps that card's ratings:
/// the ratings are copied onto the new version's item (with their receipts),
/// the state row follows, and nothing existing is changed or deleted. A card
/// is "the same card" when its `CanonicalCard` is equal (front, back, page,
/// origin, picture region), so an edited card starts fresh, a moved card keeps
/// its ratings and a deleted card does not stop the others (`match_cards`).
/// The work is done by `carry_into`, which the sync apply also uses (R13b2),
/// so both paths derive the same rows. Picture cards are carried like any
/// other card; their sidecars are written by `materialize` inside the
/// savepoint, which refuses a region the material does not own. Failure
/// inside rolls back to the savepoint and leaves the save itself untouched.
/// A save that matches no stored card makes no version. A list never studied
/// on this device that shares a card with its predecessor is still
/// snapshotted, so ratings from another device carry in sync (S-6a5). The
/// browser twin skips the snapshot of a never-studied list, because the
/// browser build has no sync.
pub fn carry_review_state(
    tx: &Transaction,
    material_id: &str,
    before_json: &str,
    after_json: &str,
    provider: &str,
    now: &str,
) {
    if tx.execute_batch("SAVEPOINT review_carry").is_err() {
        return;
    }
    let ok = carry_inner(tx, material_id, before_json, after_json, provider, now).is_ok();
    let _ = tx.execute_batch(if ok {
        "RELEASE review_carry"
    } else {
        "ROLLBACK TO review_carry; RELEASE review_carry"
    });
}

fn carry_inner(
    tx: &Transaction,
    material_id: &str,
    before_json: &str,
    after_json: &str,
    provider: &str,
    now: &str,
) -> Check<()> {
    let (SavedCards::Ok(old), SavedCards::Ok(new)) = (
        parse_saved_cards(Some(before_json)),
        parse_saved_cards(Some(after_json)),
    ) else {
        return Ok(());
    };
    if !matches!(provider, "gemini" | "import" | "manual") {
        return Ok(());
    }
    let (old_version, new_version) = (
        card_version(material_id, &old),
        card_version(material_id, &new),
    );
    // A save with no change: nothing to carry and no activation to log.
    if old_version.version_id == new_version.version_id {
        return Ok(());
    }
    let shares_a_card = |cards: &[CanonicalCard]| !match_cards(cards, &new).is_empty();
    let stored_shares = load_versions(tx, material_id)?
        .iter()
        .any(|v| v.verified && v.version_id != new_version.version_id && shares_a_card(&v.cards));
    if !shares_a_card(&old) && !stored_shares {
        return Ok(());
    }
    // Stores the new list when it is new (verifying a stored one) and makes it
    // the active version; reverting to a stored list takes this path too.
    materialize(tx, material_id, &new_version, provider, now)?;
    carry_into(tx, material_id, &new_version.version_id, true)?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* The per-card carry engine (shared with the sync apply)              */
/* ------------------------------------------------------------------ */

type CardKey<'a> = (
    &'a str,
    &'a str,
    Option<i64>,
    Option<&'a str>,
    Option<&'a str>,
);

fn card_key(card: &CanonicalCard) -> CardKey<'_> {
    (
        card.front.as_str(),
        card.back.as_str(),
        card.source_page,
        card.origin.as_deref(),
        card.visual_region_id.as_deref(),
    )
}

/// Pairs `(src_ordinal, dst_ordinal)` of equal cards. The k-th occurrence of a
/// card in `src` maps to the k-th occurrence in `dst`; extra copies on either
/// side get no match. Bytes are compared exactly: no trimming, no folding. The
/// result is sorted by `src_ordinal` and depends on nothing but the inputs.
pub(crate) fn match_cards(src: &[CanonicalCard], dst: &[CanonicalCard]) -> Vec<(usize, usize)> {
    let mut slots: std::collections::BTreeMap<CardKey<'_>, Vec<usize>> =
        std::collections::BTreeMap::new();
    for (d, card) in dst.iter().enumerate() {
        slots.entry(card_key(card)).or_default().push(d);
    }
    let mut taken: std::collections::BTreeMap<CardKey<'_>, usize> =
        std::collections::BTreeMap::new();
    let mut out = Vec::new();
    for (s, card) in src.iter().enumerate() {
        let key = card_key(card);
        let used = taken.entry(key).or_insert(0);
        if let Some(&d) = slots.get(&key).and_then(|v| v.get(*used)) {
            out.push((s, d));
            *used += 1;
        }
    }
    out
}

/// One stored version of a material with its cards re-read from the database.
/// `verified` is false when the recomputed content hash or item ids differ from
/// what is stored (a missing picture link, damage): such a version is never a
/// source, so a broken picture cannot match a plain card.
struct StoredVersion {
    version_id: String,
    created_at: String,
    first_reviewed_at: Option<String>,
    cards: Vec<CanonicalCard>,
    item_ids: Vec<String>,
    verified: bool,
}

/// Every stored version of the material, ordered by `card_count, id`.
fn load_versions(conn: &Connection, material: &str) -> Check<Vec<StoredVersion>> {
    type Head = (String, String, String, Option<String>);
    let heads: Vec<Head> = conn
        .prepare(
            "SELECT id, content_hash, created_at, first_reviewed_at FROM card_versions
             WHERE source_material_id = ?1 ORDER BY card_count, id",
        )
        .map_err(storage)?
        .query_map([material], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(storage)?
        .collect::<Result<_, _>>()
        .map_err(storage)?;
    let mut out = Vec::with_capacity(heads.len());
    for (version_id, content_hash, created_at, first_reviewed_at) in heads {
        let rows: Vec<(String, CanonicalCard)> = conn
            .prepare(
                "SELECT i.id, i.front, i.back, i.source_page, o.origin, r.region_id FROM card_items i
                 LEFT JOIN card_item_origins o ON o.item_id = i.id
                 LEFT JOIN card_item_visual_regions r ON r.item_id = i.id
                 WHERE i.version_id = ?1 ORDER BY i.ordinal",
            )
            .map_err(storage)?
            .query_map([&version_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    CanonicalCard {
                        front: r.get(1)?,
                        back: r.get(2)?,
                        source_page: r.get(3)?,
                        origin: r.get(4)?,
                        visual_region_id: r.get(5)?,
                    },
                ))
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        let (item_ids, cards): (Vec<String>, Vec<CanonicalCard>) = rows.into_iter().unzip();
        let derived = card_version(material, &cards);
        let verified = !cards.is_empty()
            && derived.version_id == version_id
            && derived.content_hash == content_hash
            && derived
                .items
                .iter()
                .map(|i| i.item_id.as_str())
                .eq(item_ids.iter().map(String::as_str));
        out.push(StoredVersion {
            version_id,
            created_at,
            first_reviewed_at,
            cards,
            item_ids,
            verified,
        });
    }
    Ok(out)
}

/// A current-generation rating event with its durable origin.
struct StoredEvent {
    id: String,
    item_id: String,
    generation: i64,
    rating: String,
    reviewed_at: String,
    scheduler_version: String,
    prior: String,
    next: String,
    device: String,
    changed_at: String,
}

fn load_events(conn: &Connection, material: &str, generation: i64) -> Check<Vec<StoredEvent>> {
    conn.prepare(
        "SELECT e.id, e.item_id, e.generation, e.rating, e.reviewed_at, e.scheduler_version,
                e.prior_state_json, e.next_state_json,
                COALESCE(m.device_id, (SELECT value FROM app_metadata WHERE key = 'device_id'), ''),
                COALESCE(m.changed_at, e.reviewed_at)
         FROM card_review_events e
         JOIN card_items i ON i.id = e.item_id
         JOIN card_versions v ON v.id = i.version_id
         LEFT JOIN sync_row_meta m ON m.table_name = 'card_review_events' AND m.row_id = e.id
         WHERE v.source_material_id = ?1 AND e.generation = ?2
         ORDER BY e.reviewed_at, e.id",
    )
    .map_err(storage)?
    .query_map(params![material, generation], |r| {
        Ok(StoredEvent {
            id: r.get(0)?,
            item_id: r.get(1)?,
            generation: r.get(2)?,
            rating: r.get(3)?,
            reviewed_at: r.get(4)?,
            scheduler_version: r.get(5)?,
            prior: r.get(6)?,
            next: r.get(7)?,
            device: r.get(8)?,
            changed_at: r.get(9)?,
        })
    })
    .map_err(storage)?
    .collect::<Result<_, _>>()
    .map_err(storage)
}

type EventsByKey<'a> = std::collections::BTreeMap<(&'a str, &'a str), Vec<usize>>;

fn events_by_key(events: &[StoredEvent]) -> EventsByKey<'_> {
    let mut map: EventsByKey<'_> = std::collections::BTreeMap::new();
    for (i, e) in events.iter().enumerate() {
        map.entry((e.reviewed_at.as_str(), e.rating.as_str()))
            .or_default()
            .push(i);
    }
    map
}

/// The original rating behind event `start`. Event x is a copy when some event
/// r with the same time and rating has `carried_event_id(r.id, x.item) == x.id`;
/// follow that to the root. A one-hop id is the same as a plain carry makes.
/// Multi-hop ids exist only from old builds, which carried by path. The walk
/// is bounded by the number of versions; a cycle makes `start` its own root.
fn root_index(
    events: &[StoredEvent],
    by_key: &EventsByKey<'_>,
    start: usize,
    bound: usize,
) -> usize {
    let mut seen = vec![start];
    let mut current = start;
    for _ in 0..=bound {
        let x = &events[current];
        let parent = by_key
            .get(&(x.reviewed_at.as_str(), x.rating.as_str()))
            .and_then(|candidates| {
                candidates
                    .iter()
                    .copied()
                    .find(|&r| r != current && carried_event_id(&events[r].id, &x.item_id) == x.id)
            });
        match parent {
            None => return current,
            Some(p) if seen.contains(&p) => return start,
            Some(p) => {
                seen.push(p);
                current = p;
            }
        }
    }
    start
}

/// Lazy, memoized root lookup. Only events asked about are resolved. Copies of
/// one rating share a (time, rating) group and one root, so the first root found
/// in a group is tried first: one hash confirms a one-hop copy (checked, never
/// assumed), and only an event it does not confirm (an old-build path id) takes
/// the full walk. This keeps a save near R x V hashes, not R x V^2.
struct RootResolver<'a> {
    events: &'a [StoredEvent],
    by_key: &'a EventsByKey<'a>,
    bound: usize,
    memo: Vec<Option<usize>>,
    hint: std::collections::HashMap<(&'a str, &'a str), usize>,
}

impl<'a> RootResolver<'a> {
    fn new(events: &'a [StoredEvent], by_key: &'a EventsByKey<'a>, bound: usize) -> Self {
        Self {
            events,
            by_key,
            bound,
            memo: vec![None; events.len()],
            hint: std::collections::HashMap::new(),
        }
    }

    fn root(&mut self, i: usize) -> usize {
        if let Some(r) = self.memo[i] {
            return r;
        }
        let x = &self.events[i];
        let key = (x.reviewed_at.as_str(), x.rating.as_str());
        let root = match self.hint.get(&key) {
            Some(&h) if h == i || carried_event_id(&self.events[h].id, &x.item_id) == x.id => h,
            _ => {
                let r = root_index(self.events, self.by_key, i, self.bound);
                self.hint.entry(key).or_insert(r);
                r
            }
        };
        self.memo[i] = Some(root);
        root
    }
}

/// The id of the original rating behind `event_id` (itself when it is one, or
/// when its chain cycles or is unknown). Current generation only.
#[cfg(test)]
pub(crate) fn root_event_id(conn: &Connection, material: &str, event_id: &str) -> Check<String> {
    let generation = read_generation_conn(conn, material)?;
    let events = load_events(conn, material, generation)?;
    let versions = load_versions(conn, material)?.len();
    let by_key = events_by_key(&events);
    Ok(match events.iter().position(|e| e.id == event_id) {
        Some(i) => events[root_index(&events, &by_key, i, versions)].id.clone(),
        None => event_id.to_string(),
    })
}

/// Whether `version_id` is stored for `material` with items that still hash to
/// its `content_hash` (a missing picture link makes it false).
pub(crate) fn version_is_verified(conn: &Connection, material: &str, version_id: &str) -> bool {
    load_versions(conn, material)
        .map(|v| v.iter().any(|v| v.version_id == version_id && v.verified))
        .unwrap_or(false)
}

/// Which of `candidates` (event ids just inserted by a sync apply) are
/// duplicate copies of a rating the item already holds: another event on the
/// same item with the same generation, time and rating whose root (all rows now
/// present) is the same. Of two candidates the lowest id stays; a candidate
/// is never kept over a non-candidate. A root that cannot be resolved is its
/// own root, so such a row is never reported. Sorted ids, current generation.
pub(crate) fn duplicate_copies(
    conn: &Connection,
    material: &str,
    candidates: &[String],
) -> Check<Vec<String>> {
    let generation = read_generation_conn(conn, material)?;
    let events = load_events(conn, material, generation)?;
    // Only the count is needed for the walk bound: no re-hash of every card.
    let versions: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM card_versions WHERE source_material_id = ?1",
            [material],
            |r| r.get::<_, i64>(0),
        )
        .map_err(storage)? as usize;
    let by_key = events_by_key(&events);
    let mut resolver = RootResolver::new(&events, &by_key, versions);
    let wanted: std::collections::BTreeSet<&str> = candidates.iter().map(String::as_str).collect();
    // Of two copies the canonical id (the root itself or carried(root, item))
    // stays, then the lowest id: a device that already holds the root copy keeps it.
    let rank_of = |i: usize, resolver: &mut RootResolver<'_>| {
        let root = resolver.root(i);
        let canonical = events[i].id == events[root].id
            || events[i].id == carried_event_id(&events[root].id, &events[i].item_id);
        (!canonical, events[i].id.clone())
    };
    let mut ordered: Vec<usize> = (0..events.len())
        .filter(|&i| wanted.contains(events[i].id.as_str()))
        .collect();
    ordered.sort_by_key(|&i| rank_of(i, &mut resolver));
    let mut dropped: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();
    for &c in &ordered {
        let key = (events[c].reviewed_at.as_str(), events[c].rating.as_str());
        let Some(group) = by_key.get(&key) else {
            continue;
        };
        let root = resolver.root(c);
        let mine = rank_of(c, &mut resolver);
        let beaten = group.iter().copied().any(|o| {
            o != c
                && !dropped.contains(&o)
                && events[o].item_id == events[c].item_id
                && resolver.root(o) == root
                && (!wanted.contains(events[o].id.as_str()) || rank_of(o, &mut resolver) < mine)
        });
        if beaten {
            dropped.insert(c);
        }
    }
    let mut ids: Vec<String> = dropped.into_iter().map(|i| events[i].id.clone()).collect();
    ids.sort();
    Ok(ids)
}

fn read_generation_conn(conn: &Connection, material: &str) -> Check<i64> {
    conn.query_row(
        "SELECT generation FROM card_review_generations WHERE source_material_id = ?1",
        [material],
        |r| r.get(0),
    )
    .optional()
    .map_err(storage)
    .map(|g| g.unwrap_or(0))
}

type StateTuple = (
    String,
    i64,
    Option<String>,
    Option<String>,
    i64,
    i64,
    i64,
    Option<String>,
    i64,
);

fn state_tuple(conn: &Connection, item: &str) -> Check<Option<StateTuple>> {
    conn.query_row(
        "SELECT scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
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
                r.get(8)?,
            ))
        },
    )
    .optional()
    .map_err(storage)
}

const SYNC_GUARD: &str = "sync_applying";

/// Carry the ratings of every other stored version of `material` onto the
/// version `dst_version_id`, card by card (`match_cards`). Returns the
/// destination items that gained at least one event, sorted and deduped.
///
/// - Sources: every other VERIFIED stored version. All current-generation
///   events of a matched source item are read, receipt or not.
/// - Ids: `carried_event_id(root, dst_item)`, where root is the original
///   rating (`root_index`), so every path to a card gives the same id.
/// - Present rule: a group (time, rating) is skipped when the destination item
///   already holds an event with that time and rating. A group fed by several
///   roots takes the lowest root id.
/// - `logged = true` (a local save): each event gets a receipt copied from its
///   root's live `rate` receipt, with `itemId` = the destination; a root with
///   no live receipt is skipped. `logged = false` (sync, caller holds the sync
///   guard row): the root's `sync_row_meta` is copied and no receipt is made
///   (`ensure_rate_receipts` derives them later).
/// - State: an item that had no events and no state and got all its events
///   from ONE source item whose state agrees with them copies that state row
///   (today's append shape). Any other item that gained events is re-folded:
///   `fold_item` over its events, each event's prior/next rewritten under the
///   sync guard (unlogged, so provenance stays), the state row set from the
///   fold (`suspended`/`flag` kept, else taken from the newest matched source).
/// - R13b2 note: a copy takes its prior/next from the chosen SOURCE event, not
///   the root row (the re-fold rewrites them, and the verbatim branch needs the
///   source item's own chain). Two devices that pick different source copies can
///   give the same id with different prior/next until the receiver re-folds.
pub(crate) fn carry_into(
    conn: &Connection,
    material: &str,
    dst_version_id: &str,
    logged: bool,
) -> Check<Vec<String>> {
    let guard_present = conn
        .query_row(
            "SELECT 1 FROM app_metadata WHERE key = ?1",
            [SYNC_GUARD],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(storage)?
        .is_some();
    if !logged && !guard_present {
        return Err(CardReviewErrorCode::InvalidState);
    }
    let generation = read_generation_conn(conn, material)?;
    let versions = load_versions(conn, material)?;
    let dst = versions
        .iter()
        .find(|v| v.version_id == dst_version_id && v.verified)
        .ok_or(CardReviewErrorCode::InvalidState)?;
    let sources: Vec<&StoredVersion> = versions
        .iter()
        .filter(|v| v.verified && v.version_id != dst_version_id)
        .collect();
    let matches: Vec<Vec<(usize, usize)>> = sources
        .iter()
        .map(|s| match_cards(&s.cards, &dst.cards))
        .collect();
    if matches.iter().all(Vec::is_empty) {
        return Ok(Vec::new());
    }

    let events = load_events(conn, material, generation)?;
    let by_key = events_by_key(&events);
    let mut by_item: std::collections::HashMap<&str, Vec<usize>> = std::collections::HashMap::new();
    for (i, e) in events.iter().enumerate() {
        by_item.entry(e.item_id.as_str()).or_default().push(i);
    }
    let mut resolver = RootResolver::new(&events, &by_key, versions.len());
    // Live rate receipts: (generation, applied_at, result_json) by operation id.
    let mut receipts: std::collections::HashMap<String, (i64, String, String)> =
        std::collections::HashMap::new();
    if logged {
        let rows: Vec<(String, i64, String, String)> = conn
            .prepare(
                "SELECT operation_id, generation, applied_at, result_json FROM card_review_operations
                 WHERE source_material_id = ?1 AND action = 'rate' AND is_erased = 0
                   AND result_json IS NOT NULL",
            )
            .map_err(storage)?
            .query_map([material], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        for (id, g, at, result) in rows {
            receipts.insert(id, (g, at, result));
        }
    }

    struct Gain {
        item: String,
        sources: std::collections::BTreeSet<String>,
        added: i64,
        had_events: bool,
        had_state: bool,
    }
    let mut gains: Vec<Gain> = Vec::new();
    let mut contributing: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();

    for (d, dst_item) in dst.item_ids.iter().enumerate() {
        // Matched source items of this card, in source order.
        let mut matched: Vec<(usize, &str)> = Vec::new();
        for (si, pairs) in matches.iter().enumerate() {
            for &(s, dd) in pairs {
                if dd == d {
                    matched.push((si, sources[si].item_ids[s].as_str()));
                }
            }
        }
        if matched.is_empty() {
            continue;
        }
        let existing = by_item.get(dst_item.as_str());
        let present: std::collections::BTreeSet<(&str, &str)> = existing
            .map(|v| {
                v.iter()
                    .map(|&i| (events[i].reviewed_at.as_str(), events[i].rating.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        // (time, rating) -> root id -> (root index, source event index, source version)
        type Group<'a> = std::collections::BTreeMap<&'a str, (usize, usize, usize)>;
        let mut groups: std::collections::BTreeMap<(&str, &str), Group<'_>> =
            std::collections::BTreeMap::new();
        for &(si, src_item) in &matched {
            for &ei in by_item.get(src_item).map(Vec::as_slice).unwrap_or(&[]) {
                let root = resolver.root(ei);
                groups
                    .entry((events[ei].reviewed_at.as_str(), events[ei].rating.as_str()))
                    .or_default()
                    .entry(events[root].id.as_str())
                    .or_insert((root, ei, si));
            }
        }
        let mut gain = Gain {
            item: dst_item.clone(),
            sources: std::collections::BTreeSet::new(),
            added: 0,
            had_events: existing.is_some_and(|v| !v.is_empty()),
            had_state: state_tuple(conn, dst_item)?.is_some(),
        };
        for (key, group) in &groups {
            if present.contains(key) {
                continue;
            }
            let chosen = group
                .values()
                .find(|(root, _, _)| !logged || receipts.contains_key(&events[*root].id));
            let Some(&(root, ei, si)) = chosen else {
                continue;
            };
            let (root_ev, src_ev) = (&events[root], &events[ei]);
            let carried = carried_event_id(&root_ev.id, dst_item);
            let inserted = conn
                .execute(
                    "INSERT OR IGNORE INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        carried,
                        dst_item,
                        src_ev.generation,
                        src_ev.rating,
                        src_ev.reviewed_at,
                        src_ev.scheduler_version,
                        src_ev.prior,
                        src_ev.next
                    ],
                )
                .map_err(storage)?;
            if inserted != 1 {
                continue;
            }
            if logged {
                let (op_generation, applied_at, result) = &receipts[&root_ev.id];
                let Ok(mut result) = serde_json::from_str::<Value>(result) else {
                    return Err(CardReviewErrorCode::InvalidState);
                };
                result["itemId"] = json!(dst_item);
                conn.execute(
                    "INSERT OR IGNORE INTO card_review_operations
                       (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
                     VALUES (?1, 'rate', ?2, ?3, ?4, ?5, 0, ?6)",
                    params![
                        carried,
                        material,
                        op_generation,
                        sha256_hex(&carried),
                        applied_at,
                        canonical_json(&result)
                    ],
                )
                .map_err(storage)?;
            } else {
                conn.execute(
                    "INSERT OR IGNORE INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
                     VALUES ('card_review_events', ?1, ?2, ?3, 0)",
                    params![carried, root_ev.device, root_ev.changed_at],
                )
                .map_err(storage)?;
            }
            gain.sources.insert(events[ei].item_id.clone());
            gain.added += 1;
            contributing.insert(si);
        }
        if gain.added > 0 {
            gains.push(gain);
        } else if logged && !gain.had_state {
            // Nothing rated to carry: a paused or flagged card keeps that.
            copy_unrated_state(conn, &sources, &matched, dst_item)?;
        }
    }

    for gain in &gains {
        let verbatim = if !gain.had_events && !gain.had_state && gain.sources.len() == 1 {
            let src_item = gain.sources.iter().next().map(String::as_str).unwrap_or("");
            let src_events = by_item.get(src_item).map_or(0, Vec::len) as i64;
            match state_tuple(conn, src_item)? {
                Some(s) if s.4 == gain.added && src_events == gain.added => {
                    conn.execute(
                        "INSERT OR IGNORE INTO card_review_state
                           (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
                         SELECT ?1, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
                         FROM card_review_state WHERE item_id = ?2",
                        params![gain.item, src_item],
                    )
                    .map_err(storage)?;
                    true
                }
                _ => false,
            }
        } else {
            false
        };
        if !verbatim {
            refold_item(
                conn,
                material,
                generation,
                dst,
                &gain.item,
                &sources,
                &matches,
                guard_present,
            )?;
        }
    }

    if !gains.is_empty() {
        let earliest = contributing
            .iter()
            .filter_map(|&si| sources[si].first_reviewed_at.clone())
            .min();
        if let Some(at) = earliest {
            conn.execute(
                "UPDATE card_versions SET first_reviewed_at = ?1 WHERE id = ?2 AND first_reviewed_at IS NULL",
                params![at, dst_version_id],
            )
            .map_err(storage)?;
        }
    }
    let mut gained: Vec<String> = gains.into_iter().map(|g| g.item).collect();
    gained.sort();
    gained.dedup();
    Ok(gained)
}

/// The newest-created matched source item (tie: lowest version id) that has a
/// state row, for `suspended`/`flag`.
fn preferred_source_state(
    conn: &Connection,
    sources: &[&StoredVersion],
    matched: &[(usize, &str)],
) -> Check<Option<StateTuple>> {
    let mut order: Vec<&(usize, &str)> = matched.iter().collect();
    order.sort_by(|a, b| {
        sources[b.0]
            .created_at
            .cmp(&sources[a.0].created_at)
            .then(sources[a.0].version_id.cmp(&sources[b.0].version_id))
    });
    for (_, item) in order {
        if let Some(state) = state_tuple(conn, item)? {
            return Ok(Some(state));
        }
    }
    Ok(None)
}

/// A card that gained no rating but is paused or flagged on a matched source
/// keeps that (today's append did this); only an unrated state row is copied.
fn copy_unrated_state(
    conn: &Connection,
    sources: &[&StoredVersion],
    matched: &[(usize, &str)],
    dst_item: &str,
) -> Check<()> {
    let mut order: Vec<&(usize, &str)> = matched.iter().collect();
    order.sort_by(|a, b| {
        sources[b.0]
            .created_at
            .cmp(&sources[a.0].created_at)
            .then(sources[a.0].version_id.cmp(&sources[b.0].version_id))
    });
    for (_, item) in order {
        if let Some(state) = state_tuple(conn, item)? {
            if state.2.is_none() && state.3.is_none() && state.4 == 0 {
                conn.execute(
                    "INSERT OR IGNORE INTO card_review_state
                       (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
                     SELECT ?1, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
                     FROM card_review_state WHERE item_id = ?2",
                    params![dst_item, item],
                )
                .map_err(storage)?;
            }
            return Ok(());
        }
    }
    Ok(())
}

/// Re-derive one item's history after events were added: fold all its events
/// in D4 order, rewrite each event's prior/next (unlogged, under the guard row,
/// so `sync_row_meta` provenance survives), and set the state row from the
/// fold. `suspended`/`flag` and the revision counter follow `replay_touched`.
#[allow(clippy::too_many_arguments)]
fn refold_item(
    conn: &Connection,
    material: &str,
    generation: i64,
    dst: &StoredVersion,
    item: &str,
    sources: &[&StoredVersion],
    matches: &[Vec<(usize, usize)>],
    guard_present: bool,
) -> Check<()> {
    let events = crate::sync::apply::item_events(conn, item).map_err(storage)?;
    let folded = crate::sync::replay::fold_item(&events, generation).map_err(storage)?;
    let Some(last) = folded.last() else {
        return Ok(());
    };
    if !guard_present {
        conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES (?1, ?2)",
            params![SYNC_GUARD, "carry"],
        )
        .map_err(storage)?;
    }
    let rewritten = crate::sync::apply::rewrite_event_states(conn, &folded).map_err(storage);
    if !guard_present {
        conn.execute("DELETE FROM app_metadata WHERE key = ?1", [SYNC_GUARD])
            .map_err(storage)?;
    }
    rewritten?;
    let schedule = &last.next;
    let local = state_tuple(conn, item)?;
    let (suspended, flag, revision) = match &local {
        Some(l) => (l.6, l.7.clone(), l.8 + 1),
        None => {
            let d = dst
                .item_ids
                .iter()
                .position(|i| i == item)
                .ok_or(CardReviewErrorCode::InvalidState)?;
            let mut matched: Vec<(usize, &str)> = Vec::new();
            for (si, pairs) in matches.iter().enumerate() {
                for &(s, dd) in pairs {
                    if dd == d {
                        matched.push((si, sources[si].item_ids[s].as_str()));
                    }
                }
            }
            match preferred_source_state(conn, sources, &matched)? {
                Some(s) => (s.6, s.7, 1),
                None => (0, None, 1),
            }
        }
    };
    conn.execute(
        "INSERT INTO card_review_state
           (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(item_id) DO UPDATE SET
           scheduler_version = excluded.scheduler_version, step = excluded.step, due_at = excluded.due_at,
           last_reviewed_at = excluded.last_reviewed_at, reps = excluded.reps, lapses = excluded.lapses,
           suspended = excluded.suspended, flag = excluded.flag, revision = excluded.revision",
        params![
            item,
            material,
            schedule.scheduler_version,
            schedule.step,
            schedule.due_at,
            schedule.last_reviewed_at,
            schedule.reps,
            schedule.lapses,
            suspended,
            flag,
            revision.max(folded.len() as i64)
        ],
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

#[cfg(test)]
#[path = "card_carry_tests.rs"]
mod carry_tests;
