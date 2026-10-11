//! Skills and feedback evidence (M3, schema 14).
//!
//! The native half of `docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md` §6–§7:
//!
//! - `save_skill_evidence_action`: a request decoded strictly by serde
//!   (`deny_unknown_fields`, exact keys, then the same bounds as the
//!   TypeScript decoder), hashed over the same canonical JSON as
//!   `canonicalJson`, and applied in one `BEGIN IMMEDIATE` transaction on one
//!   dedicated connection. A known operation id with the same hash replays
//!   its stored result (decoded exactly, naming the request's own subject); a
//!   different hash is `OPERATION_CONFLICT`; a tombstone is `ERASED`; a
//!   damaged receipt is `STORAGE_FAILURE`, never returned as truth.
//! - the bounded readers: fenced, filter-bound evidence pages, the skill
//!   summary, the skill list and observation history pages.
//!
//! The browser and test twins are `src/data/skillEvidenceTransaction.ts` and
//! `src/data/skillEvidenceReader.ts`; the shared fixtures in
//! `fixtures/skill-evidence/` hold the two sides equal. Every refusal is one
//! allowlisted code with its fixed message (`SKILL_EVIDENCE_ERROR_MESSAGES`
//! in `src/data/skillEvidenceShapes.ts`).

use std::path::Path;
use std::time::Duration;

use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, OpenFlags, OptionalExtension,
    Transaction, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use unicode_normalization::UnicodeNormalization;

use crate::card_reviews::sha256_hex;
use crate::practice_sessions::{canonical_json, db_now_iso, is_root_ready};
use crate::storage::app_root;

/* ------------------------------------------------------------------ */
/* Limits (TS `SKILL_EVIDENCE_LIMITS`)                                 */
/* ------------------------------------------------------------------ */

pub const WORDING_CODE_POINTS: usize = 2_000;
pub const WORDING_BYTES: usize = 8_000;
pub const SKILL_LABEL_CODE_POINTS: usize = 80;
pub const SKILL_DESCRIPTION_CODE_POINTS: usize = 500;
pub const INSTRUCTOR_NAME_CODE_POINTS: usize = 120;
pub const SOURCE_TITLE_CODE_POINTS: usize = 200;
pub const MAX_CUSTOM_SKILLS: i64 = 200;
pub const REQUEST_BYTES: usize = 16_384;
pub const PAGE_DEFAULT: i64 = 20;
pub const PAGE_MAX: i64 = 50;
pub const REVISION_PAGE_DEFAULT: i64 = 20;
pub const REVISION_PAGE_MAX: i64 = 100;
pub const OBSERVATIONS_PER_DEBRIEF: i64 = 50;

const MAX_SAFE: i64 = 9_007_199_254_740_991;
const CURSOR_VERSION: i64 = 2;

const TOPICS: [&str; 12] = [
    "weather",
    "navigation",
    "regulations",
    "communications",
    "aerodynamics",
    "aircraft_systems",
    "flight_planning",
    "airports",
    "performance",
    "emergency_procedures",
    "landings",
    "general",
];
const SOURCE_FIELDS: [&str; 5] = [
    "instructor_feedback",
    "went_well",
    "was_difficult",
    "practiced",
    "none",
];
const STATUSES: [&str; 3] = ["learning", "practicing", "needs_review"];

pub const SKILL_ACTIONS: [&str; 4] = [
    "create_custom_skill",
    "edit_custom_skill",
    "retire_skill",
    "restore_skill",
];
pub const OBSERVATION_HISTORY_ACTIONS: [&str; 5] = [
    "create_observation",
    "edit_observation",
    "link_action",
    "unlink_action",
    "set_addressed",
];
pub const ASSESSMENT_ACTIONS: [&str; 2] = ["set_status", "set_confidence"];

/* ------------------------------------------------------------------ */
/* Allowlisted errors                                                  */
/* ------------------------------------------------------------------ */

/// The skill-evidence refusals. Messages match `SKILL_EVIDENCE_ERROR_MESSAGES`
/// in `src/data/skillEvidenceShapes.ts` word for word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SkillEvidenceErrorCode {
    InvalidArgument,
    LimitExceeded,
    NotFound,
    SourceMissing,
    SkillRetired,
    BuiltinReadOnly,
    DuplicateLabel,
    StaleRevision,
    OperationConflict,
    Erased,
    StaleCursor,
    StorageFailure,
}

impl SkillEvidenceErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArgument => "That request is not valid.",
            Self::LimitExceeded => "That is more than this can hold.",
            Self::NotFound => "That is no longer here.",
            Self::SourceMissing => "That lesson debrief no longer exists.",
            Self::SkillRetired => "That skill is retired. Restore it to add new observations.",
            Self::BuiltinReadOnly => {
                "Built-in skill names come from the catalog and cannot be edited."
            }
            Self::DuplicateLabel => "An active skill already has that name.",
            Self::StaleRevision => "This changed somewhere else. Reload to see the latest.",
            Self::OperationConflict => "That request id was already used for a different change.",
            Self::Erased => "That observation was erased.",
            Self::StaleCursor => {
                "The list changed while you were reading it. Start again from the newest."
            }
            Self::StorageFailure => "The change could not be saved.",
        }
    }

    pub fn error(self) -> SkillEvidenceErrorWire {
        SkillEvidenceErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

/// The wire refusal: one code and its fixed message, never engine text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkillEvidenceErrorWire {
    pub code: SkillEvidenceErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for SkillEvidenceErrorWire {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for SkillEvidenceErrorWire {}

use SkillEvidenceErrorCode as Code;

pub type Check<T> = Result<T, SkillEvidenceErrorCode>;

fn storage<E>(_: E) -> SkillEvidenceErrorCode {
    Code::StorageFailure
}

/* ------------------------------------------------------------------ */
/* Text rules shared with TypeScript                                   */
/* ------------------------------------------------------------------ */

/// JavaScript's `\s` and `String.prototype.trim` set (ECMAScript WhiteSpace
/// and LineTerminator). Deliberately not `char::is_whitespace`, which differs
/// at U+0085 and U+FEFF.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// The write path's duplicate-name key (TS `labelKey`): NFC, trimmed, runs of
/// whitespace collapsed to one space, then lower-cased.
pub fn label_key(label: &str) -> String {
    let nfc: String = label.nfc().collect();
    let mut collapsed = String::with_capacity(nfc.len());
    let mut in_space = false;
    for c in js_trim(&nfc).chars() {
        if is_js_space(c) {
            if !in_space {
                collapsed.push(' ');
            }
            in_space = true;
        } else {
            collapsed.push(c);
            in_space = false;
        }
    }
    collapsed.to_lowercase()
}

fn is_control(c: char, multiline: bool) -> bool {
    let n = c as u32;
    if multiline {
        n <= 0x08 || (0x0b..=0x1f).contains(&n) || n == 0x7f
    } else {
        n <= 0x1f || n == 0x7f
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

/// `builtin.[a-z0-9_]{1,60}` or `custom.<lower-case uuid v4>`.
pub fn is_skill_id(value: &str) -> bool {
    if let Some(rest) = value.strip_prefix("builtin.") {
        return (1..=60).contains(&rest.len())
            && rest
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_');
    }
    value.strip_prefix("custom.").is_some_and(lower_uuid_v4)
}

/// TS `shortText`: 1–64 UTF-16 units, no control character.
fn is_short_text(value: &str) -> bool {
    let units = value.encode_utf16().count();
    (1..=64).contains(&units) && !value.chars().any(|c| is_control(c, false))
}

/// TS `isCalendarDate`: `YYYY-MM-DD` that `Date.UTC` maps back to itself.
/// Years 0000–0099 fail there (they map to 1900–1999), so they fail here too.
pub fn is_calendar_date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        let s = &value[r];
        s.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| s.parse().ok())?
    };
    let (Some(y), Some(m), Some(d)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };
    if y < 100 || !(1..=12).contains(&m) || d < 1 {
        return false;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    d <= days
}

/// TS `Number.isSafeInteger(v) && v >= min`, on a JSON number.
fn safe_integer(value: &Value, min: i64) -> Option<i64> {
    let number = value.as_number()?;
    let n = if let Some(i) = number.as_i64() {
        i
    } else {
        let f = number.as_f64()?;
        if f.fract() != 0.0 || f.abs() > MAX_SAFE as f64 {
            return None;
        }
        f as i64
    };
    (min..=MAX_SAFE).contains(&n).then_some(n)
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/* ------------------------------------------------------------------ */
/* Strict decoding                                                     */
/* ------------------------------------------------------------------ */

/// The wire shape: exact keys per action. Values are checked in the
/// TypeScript decoder's order afterwards, so a request with two faults is
/// refused with the same code on both sides.
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Wire {
    CreateCustomSkill {
        operation_id: Value,
        skill_id: Value,
        label: Value,
        description: Value,
        topic: Value,
    },
    EditCustomSkill {
        operation_id: Value,
        skill_id: Value,
        expected_revision: Value,
        label: Value,
        description: Value,
        topic: Value,
    },
    RetireSkill {
        operation_id: Value,
        skill_id: Value,
        expected_revision: Value,
    },
    RestoreSkill {
        operation_id: Value,
        skill_id: Value,
        expected_revision: Value,
    },
    CreateObservation {
        operation_id: Value,
        observation_id: Value,
        skill_id: Value,
        journal_id: Value,
        source_field: Value,
        wording: Value,
        observed_on: Value,
        attribution: Value,
        instructor_name: Value,
    },
    EditObservation {
        operation_id: Value,
        observation_id: Value,
        expected_revision: Value,
        wording: Value,
        observed_on: Value,
        attribution: Value,
        instructor_name: Value,
    },
    LinkAction {
        operation_id: Value,
        observation_id: Value,
        expected_revision: Value,
        action_id: Value,
    },
    UnlinkAction {
        operation_id: Value,
        observation_id: Value,
        expected_revision: Value,
    },
    SetAddressed {
        operation_id: Value,
        observation_id: Value,
        expected_revision: Value,
        addressed: Value,
    },
    SetStatus {
        operation_id: Value,
        skill_id: Value,
        expected_sequence: Value,
        status: Value,
    },
    SetConfidence {
        operation_id: Value,
        skill_id: Value,
        expected_sequence: Value,
        confidence: Value,
    },
    EraseObservation {
        operation_id: Value,
        observation_id: Value,
        confirm: Value,
    },
}

/// The editable content of an observation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Content {
    pub wording: String,
    pub observed_on: String,
    pub attribution: String,
    pub instructor_name: String,
}

/// A decoded request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    CreateCustomSkill {
        skill_id: String,
        label: String,
        description: String,
        topic: String,
    },
    EditCustomSkill {
        skill_id: String,
        expected_revision: i64,
        label: String,
        description: String,
        topic: String,
    },
    SetSkillStatus {
        retire: bool,
        skill_id: String,
        expected_revision: i64,
    },
    CreateObservation {
        observation_id: String,
        skill_id: String,
        journal_id: String,
        source_field: String,
        content: Content,
    },
    EditObservation {
        observation_id: String,
        expected_revision: i64,
        content: Content,
    },
    LinkFollowUp {
        observation_id: String,
        expected_revision: i64,
        action_id: String,
    },
    UnlinkFollowUp {
        observation_id: String,
        expected_revision: i64,
    },
    SetAddressed {
        observation_id: String,
        expected_revision: i64,
        addressed: bool,
    },
    SetAssessment {
        status_kind: bool,
        skill_id: String,
        expected_sequence: i64,
        status: Option<String>,
        confidence: Option<i64>,
    },
    EraseObservation {
        observation_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub name: &'static str,
    pub operation_id: String,
    pub action: Action,
}

impl Request {
    /// The subject a request acts on: the skill for skill and assessment
    /// actions, otherwise the observation (TS `subjectOf`).
    pub fn subject(&self) -> &str {
        match &self.action {
            Action::CreateCustomSkill { skill_id, .. }
            | Action::EditCustomSkill { skill_id, .. }
            | Action::SetSkillStatus { skill_id, .. }
            | Action::SetAssessment { skill_id, .. } => skill_id,
            Action::CreateObservation { observation_id, .. }
            | Action::EditObservation { observation_id, .. }
            | Action::LinkFollowUp { observation_id, .. }
            | Action::UnlinkFollowUp { observation_id, .. }
            | Action::SetAddressed { observation_id, .. }
            | Action::EraseObservation { observation_id } => observation_id,
        }
    }
}

fn bounded_text(value: &Value, max: usize, required: bool, multiline: bool) -> Check<String> {
    let text = value.as_str().ok_or(Code::InvalidArgument)?;
    if text.chars().any(|c| is_control(c, multiline)) {
        return Err(Code::InvalidArgument);
    }
    if required && js_trim(text).is_empty() {
        return Err(Code::InvalidArgument);
    }
    if text.chars().count() > max {
        return Err(Code::LimitExceeded);
    }
    Ok(text.to_string())
}

fn skill_id(value: &Value) -> Check<String> {
    value
        .as_str()
        .filter(|v| is_skill_id(v))
        .map(str::to_string)
        .ok_or(Code::InvalidArgument)
}

fn uuid(value: &Value) -> Check<String> {
    value
        .as_str()
        .filter(|v| lower_uuid_v4(v))
        .map(str::to_string)
        .ok_or(Code::InvalidArgument)
}

fn any_id(value: &Value) -> Check<String> {
    value
        .as_str()
        .filter(|v| is_short_text(v))
        .map(str::to_string)
        .ok_or(Code::InvalidArgument)
}

fn revision_number(value: &Value) -> Check<i64> {
    safe_integer(value, 0).ok_or(Code::InvalidArgument)
}

fn topic(value: &Value) -> Check<String> {
    value
        .as_str()
        .filter(|v| TOPICS.contains(v))
        .map(str::to_string)
        .ok_or(Code::InvalidArgument)
}

fn content(
    wording: &Value,
    observed_on: &Value,
    attribution: &Value,
    instructor_name: &Value,
) -> Check<Content> {
    let attribution = attribution
        .as_str()
        .filter(|a| *a == "self_report" || *a == "instructor_transcribed")
        .ok_or(Code::InvalidArgument)?;
    let instructor_name = bounded_text(instructor_name, INSTRUCTOR_NAME_CODE_POINTS, false, false)?;
    if attribution == "self_report" && !instructor_name.is_empty() {
        return Err(Code::InvalidArgument);
    }
    let wording = bounded_text(wording, WORDING_CODE_POINTS, true, true)?;
    if wording.len() > WORDING_BYTES {
        return Err(Code::LimitExceeded);
    }
    let observed_on = observed_on
        .as_str()
        .filter(|d| is_calendar_date(d))
        .ok_or(Code::InvalidArgument)?;
    Ok(Content {
        wording,
        observed_on: observed_on.to_string(),
        attribution: attribution.to_string(),
        instructor_name,
    })
}

/// Strict decoding: exact keys, exact types, enforced bounds; nothing is coerced.
pub fn decode_action(value: &Value) -> Check<Request> {
    let map = value.as_object().ok_or(Code::InvalidArgument)?;
    let name = match map.get("action").and_then(Value::as_str) {
        Some(n) => ACTIONS
            .iter()
            .copied()
            .find(|known| *known == n)
            .ok_or(Code::InvalidArgument)?,
        None => return Err(Code::InvalidArgument),
    };
    let wire: Wire = serde_json::from_value(value.clone()).map_err(|_| Code::InvalidArgument)?;
    let operation = |v: &Value| uuid(v);
    let (operation_id, action) = match wire {
        Wire::CreateCustomSkill {
            operation_id,
            skill_id: id,
            label,
            description,
            topic: t,
        } => {
            let op = operation(&operation_id)?;
            let id = id
                .as_str()
                .filter(|v| v.strip_prefix("custom.").is_some_and(lower_uuid_v4))
                .ok_or(Code::InvalidArgument)?
                .to_string();
            let label = bounded_text(&label, SKILL_LABEL_CODE_POINTS, true, false)?;
            let description =
                bounded_text(&description, SKILL_DESCRIPTION_CODE_POINTS, false, true)?;
            let topic = topic(&t)?;
            (
                op,
                Action::CreateCustomSkill {
                    skill_id: id,
                    label,
                    description,
                    topic,
                },
            )
        }
        Wire::EditCustomSkill {
            operation_id,
            skill_id: id,
            expected_revision,
            label,
            description,
            topic: t,
        } => {
            let op = operation(&operation_id)?;
            let skill_id = skill_id(&id)?;
            let expected_revision = revision_number(&expected_revision)?;
            let label = bounded_text(&label, SKILL_LABEL_CODE_POINTS, true, false)?;
            let description =
                bounded_text(&description, SKILL_DESCRIPTION_CODE_POINTS, false, true)?;
            let topic = topic(&t)?;
            (
                op,
                Action::EditCustomSkill {
                    skill_id,
                    expected_revision,
                    label,
                    description,
                    topic,
                },
            )
        }
        Wire::RetireSkill {
            operation_id,
            skill_id: id,
            expected_revision,
        }
        | Wire::RestoreSkill {
            operation_id,
            skill_id: id,
            expected_revision,
        } => {
            let op = operation(&operation_id)?;
            let skill_id = skill_id(&id)?;
            let expected_revision = revision_number(&expected_revision)?;
            (
                op,
                Action::SetSkillStatus {
                    retire: name == "retire_skill",
                    skill_id,
                    expected_revision,
                },
            )
        }
        Wire::CreateObservation {
            operation_id,
            observation_id,
            skill_id: id,
            journal_id,
            source_field,
            wording,
            observed_on,
            attribution,
            instructor_name,
        } => {
            let op = operation(&operation_id)?;
            let source_field = source_field
                .as_str()
                .filter(|f| SOURCE_FIELDS.contains(f))
                .ok_or(Code::InvalidArgument)?
                .to_string();
            let observation_id = uuid(&observation_id)?;
            let skill_id = skill_id(&id)?;
            let journal_id = any_id(&journal_id)?;
            let content = content(&wording, &observed_on, &attribution, &instructor_name)?;
            (
                op,
                Action::CreateObservation {
                    observation_id,
                    skill_id,
                    journal_id,
                    source_field,
                    content,
                },
            )
        }
        Wire::EditObservation {
            operation_id,
            observation_id,
            expected_revision,
            wording,
            observed_on,
            attribution,
            instructor_name,
        } => {
            let op = operation(&operation_id)?;
            let observation_id = uuid(&observation_id)?;
            let expected_revision = revision_number(&expected_revision)?;
            let content = content(&wording, &observed_on, &attribution, &instructor_name)?;
            (
                op,
                Action::EditObservation {
                    observation_id,
                    expected_revision,
                    content,
                },
            )
        }
        Wire::LinkAction {
            operation_id,
            observation_id,
            expected_revision,
            action_id,
        } => {
            let op = operation(&operation_id)?;
            let observation_id = uuid(&observation_id)?;
            let expected_revision = revision_number(&expected_revision)?;
            let action_id = any_id(&action_id)?;
            (
                op,
                Action::LinkFollowUp {
                    observation_id,
                    expected_revision,
                    action_id,
                },
            )
        }
        Wire::UnlinkAction {
            operation_id,
            observation_id,
            expected_revision,
        } => {
            let op = operation(&operation_id)?;
            let observation_id = uuid(&observation_id)?;
            let expected_revision = revision_number(&expected_revision)?;
            (
                op,
                Action::UnlinkFollowUp {
                    observation_id,
                    expected_revision,
                },
            )
        }
        Wire::SetAddressed {
            operation_id,
            observation_id,
            expected_revision,
            addressed,
        } => {
            let op = operation(&operation_id)?;
            let addressed = addressed.as_bool().ok_or(Code::InvalidArgument)?;
            let observation_id = uuid(&observation_id)?;
            let expected_revision = revision_number(&expected_revision)?;
            (
                op,
                Action::SetAddressed {
                    observation_id,
                    expected_revision,
                    addressed,
                },
            )
        }
        Wire::SetStatus {
            operation_id,
            skill_id: id,
            expected_sequence,
            status,
        } => {
            let op = operation(&operation_id)?;
            let status = match &status {
                Value::Null => None,
                Value::String(s) if STATUSES.contains(&s.as_str()) => Some(s.clone()),
                _ => return Err(Code::InvalidArgument),
            };
            let skill_id = skill_id(&id)?;
            let expected_sequence = revision_number(&expected_sequence)?;
            (
                op,
                Action::SetAssessment {
                    status_kind: true,
                    skill_id,
                    expected_sequence,
                    status,
                    confidence: None,
                },
            )
        }
        Wire::SetConfidence {
            operation_id,
            skill_id: id,
            expected_sequence,
            confidence,
        } => {
            let op = operation(&operation_id)?;
            let confidence = match &confidence {
                Value::Null => None,
                other => Some(
                    safe_integer(other, 1)
                        .filter(|c| *c <= 5)
                        .ok_or(Code::InvalidArgument)?,
                ),
            };
            let skill_id = skill_id(&id)?;
            let expected_sequence = revision_number(&expected_sequence)?;
            (
                op,
                Action::SetAssessment {
                    status_kind: false,
                    skill_id,
                    expected_sequence,
                    status: None,
                    confidence,
                },
            )
        }
        Wire::EraseObservation {
            operation_id,
            observation_id,
            confirm,
        } => {
            let op = operation(&operation_id)?;
            if confirm.as_str() != Some("erase") {
                return Err(Code::InvalidArgument);
            }
            let observation_id = uuid(&observation_id)?;
            (op, Action::EraseObservation { observation_id })
        }
    };
    Ok(Request {
        name,
        operation_id,
        action,
    })
}

const ACTIONS: [&str; 12] = [
    "create_custom_skill",
    "edit_custom_skill",
    "retire_skill",
    "restore_skill",
    "create_observation",
    "edit_observation",
    "link_action",
    "unlink_action",
    "set_addressed",
    "set_status",
    "set_confidence",
    "erase_observation",
];

/* ------------------------------------------------------------------ */
/* Exact result decoding (TS `decodeStoredResult`)                     */
/* ------------------------------------------------------------------ */

/// The decoded number a result carries (`revision` or `sequence`), or the erase flag.
#[derive(Debug, PartialEq, Eq)]
pub enum ResultValue {
    Number(i64),
    Erased,
}

/// Exactly the keys of the action, the right types and ranges, and the
/// receipt's own subject.
pub fn decode_result(
    text: Option<&str>,
    action: &str,
    subject: &str,
) -> Result<ResultValue, String> {
    let parsed: Value = serde_json::from_str(text.ok_or("The result is missing.")?)
        .map_err(|_| "The result is not readable.")?;
    decode_result_value(&parsed, action, subject)
}

pub fn decode_result_value(
    parsed: &Value,
    action: &str,
    subject: &str,
) -> Result<ResultValue, String> {
    let object = parsed.as_object().ok_or("A result must be an object.")?;
    let (subject_key, value_key) = if SKILL_ACTIONS.contains(&action) {
        ("skillId", "revision")
    } else if OBSERVATION_HISTORY_ACTIONS.contains(&action) {
        ("observationId", "revision")
    } else if ASSESSMENT_ACTIONS.contains(&action) {
        ("skillId", "sequence")
    } else if action == "erase_observation" {
        ("observationId", "erased")
    } else {
        return Err("Unknown action.".into());
    };
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut wanted = vec!["action", subject_key, value_key];
    wanted.sort_unstable();
    if keys != wanted {
        return Err(format!(
            "A {action} result has exactly: {}.",
            wanted.join(", ")
        ));
    }
    if object.get("action").and_then(Value::as_str) != Some(action) {
        return Err("The result belongs to a different action.".into());
    }
    if object.get(subject_key).and_then(Value::as_str) != Some(subject) {
        return Err("The result names a different subject.".into());
    }
    if action == "erase_observation" {
        return if object.get("erased") == Some(&Value::Bool(true)) {
            Ok(ResultValue::Erased)
        } else {
            Err("An erase result must say erased: true.".into())
        };
    }
    let n = safe_integer(&object[value_key], 1)
        .ok_or(format!("{value_key} must be a positive whole number."))?;
    let creates = action == "create_custom_skill" || action == "create_observation";
    if value_key == "revision" && (if creates { n != 1 } else { n < 2 }) {
        return Err("The result revision does not fit its action.".into());
    }
    Ok(ResultValue::Number(n))
}

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

fn result_json(request: &Request, value_key: &str, value: Value) -> Value {
    let subject_key = match &request.action {
        Action::CreateCustomSkill { .. }
        | Action::EditCustomSkill { .. }
        | Action::SetSkillStatus { .. }
        | Action::SetAssessment { .. } => "skillId",
        _ => "observationId",
    };
    let mut map = Map::new();
    map.insert("action".into(), json!(request.name));
    map.insert(subject_key.into(), json!(request.subject()));
    map.insert(value_key.into(), value);
    Value::Object(map)
}

/// The canonical request hash and its size check, before any transaction.
pub fn request_hash(request_value: &Value) -> Check<String> {
    let canonical = canonical_json(request_value);
    if canonical.len() > REQUEST_BYTES {
        return Err(Code::LimitExceeded);
    }
    Ok(sha256_hex(&canonical))
}

/// The scope's transaction on an open immediate transaction: replay first,
/// then every safety check before the first write, then the head change, one
/// history row and the receipt. Returns `{ status, result }`.
pub fn execute_skill_evidence_transaction(
    tx: &Connection,
    request: &Request,
    hash: &str,
) -> Check<Value> {
    let receipt: Option<(String, String, String, Option<String>, i64)> = tx
        .query_row(
            "SELECT action, subject_id, request_hash, result_json, is_erased FROM skill_evidence_operations WHERE operation_id = ?1",
            [&request.operation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(storage)?;
    if let Some((action, subject, stored_hash, result, is_erased)) = receipt {
        if stored_hash != hash {
            return Err(Code::OperationConflict);
        }
        if is_erased == 1 {
            return Err(Code::Erased);
        }
        if action != request.name || subject != request.subject() {
            return Err(Code::StorageFailure);
        }
        let text = result.ok_or(Code::StorageFailure)?;
        decode_result(Some(&text), request.name, request.subject()).map_err(storage)?;
        let parsed: Value = serde_json::from_str(&text).map_err(storage)?;
        return Ok(json!({ "status": "replayed", "result": parsed }));
    }
    let now = db_now_iso(tx).map_err(storage)?;
    let result = apply(tx, request, &now)?;
    tx.execute(
        "INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        params![
            request.operation_id,
            request.name,
            hash,
            request.subject(),
            now,
            result.to_string()
        ],
    )
    .map_err(storage)?;
    Ok(json!({ "status": "applied", "result": result }))
}

struct SkillRow {
    origin: String,
    catalog_version: Option<i64>,
    label: String,
    description: String,
    topic: String,
    status: String,
    revision: i64,
}

fn require_skill(tx: &Connection, skill_id: &str) -> Check<SkillRow> {
    tx.query_row(
        "SELECT origin, catalog_version, label, description, topic, status, revision FROM skill_catalog_entries WHERE id = ?1",
        [skill_id],
        |r| {
            Ok(SkillRow {
                origin: r.get(0)?,
                catalog_version: r.get(1)?,
                label: r.get(2)?,
                description: r.get(3)?,
                topic: r.get(4)?,
                status: r.get(5)?,
                revision: r.get(6)?,
            })
        },
    )
    .optional()
    .map_err(storage)?
    .ok_or(Code::NotFound)
}

fn exists(tx: &Connection, sql: &str, value: &str) -> Check<bool> {
    tx.query_row(sql, [value], |_| Ok(()))
        .optional()
        .map(|row| row.is_some())
        .map_err(storage)
}

fn refuse_duplicate_label(tx: &Connection, label: &str, except: Option<&str>) -> Check<()> {
    let key = label_key(label);
    let mut statement = tx
        .prepare("SELECT id, label FROM skill_catalog_entries WHERE status = 'active'")
        .map_err(storage)?;
    let rows = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(storage)?;
    for row in rows {
        let (id, other) = row.map_err(storage)?;
        if Some(id.as_str()) != except && label_key(&other) == key {
            return Err(Code::DuplicateLabel);
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_skill_revision(
    tx: &Connection,
    skill_id: &str,
    revision: i64,
    label: &str,
    description: &str,
    topic: &str,
    status: &str,
    catalog_version: Option<i64>,
    operation_id: &str,
    now: &str,
) -> Check<()> {
    tx.execute(
        "INSERT INTO skill_catalog_revisions (skill_id, revision, label, description, topic, status, catalog_version, changed_by, operation_id, changed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'user', ?8, ?9)",
        params![skill_id, revision, label, description, topic, status, catalog_version, operation_id, now],
    )
    .map(|_| ())
    .map_err(storage)
}

struct ObservationState {
    content: Content,
    action_id: Option<String>,
    linked_action_id: Option<String>,
    linked_action_title: Option<String>,
    addressed_at: Option<String>,
}

fn append_observation_revision(
    tx: &Connection,
    observation_id: &str,
    revision: i64,
    kind: &str,
    s: &ObservationState,
    operation_id: &str,
    now: &str,
) -> Check<()> {
    tx.execute(
        "INSERT INTO skill_observation_revisions (
           observation_id, revision, change_kind, wording, observed_on, attribution, instructor_name,
           linked_action_id, linked_action_title, addressed_at, operation_id, recorded_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            observation_id,
            revision,
            kind,
            s.content.wording,
            s.content.observed_on,
            s.content.attribution,
            s.content.instructor_name,
            s.linked_action_id,
            s.linked_action_title,
            s.addressed_at,
            operation_id,
            now
        ],
    )
    .map(|_| ())
    .map_err(storage)
}

fn apply(tx: &Connection, request: &Request, now: &str) -> Check<Value> {
    let op = request.operation_id.as_str();
    match &request.action {
        Action::CreateCustomSkill {
            skill_id,
            label,
            description,
            topic,
        } => {
            if exists(
                tx,
                "SELECT 1 FROM skill_catalog_entries WHERE id = ?1",
                skill_id,
            )? {
                return Err(Code::OperationConflict);
            }
            let custom: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM skill_catalog_entries WHERE origin = 'custom'",
                    [],
                    |r| r.get(0),
                )
                .map_err(storage)?;
            if custom >= MAX_CUSTOM_SKILLS {
                return Err(Code::LimitExceeded);
            }
            refuse_duplicate_label(tx, label, None)?;
            tx.execute(
                "INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at, retired_at)
                 VALUES (?1, 'custom', NULL, ?2, ?3, ?4, 'active', 1, ?5, ?5, NULL)",
                params![skill_id, label, description, topic, now],
            )
            .map_err(storage)?;
            append_skill_revision(
                tx,
                skill_id,
                1,
                label,
                description,
                topic,
                "active",
                None,
                op,
                now,
            )?;
            Ok(result_json(request, "revision", json!(1)))
        }
        Action::EditCustomSkill {
            skill_id,
            expected_revision,
            label,
            description,
            topic,
        } => {
            let skill = require_skill(tx, skill_id)?;
            if skill.origin != "custom" {
                return Err(Code::BuiltinReadOnly);
            }
            if skill.revision != *expected_revision {
                return Err(Code::StaleRevision);
            }
            if skill.status == "retired" {
                return Err(Code::SkillRetired);
            }
            if skill.label == *label && skill.description == *description && skill.topic == *topic {
                return Err(Code::InvalidArgument);
            }
            refuse_duplicate_label(tx, label, Some(skill_id))?;
            let revision = skill.revision + 1;
            tx.execute(
                "UPDATE skill_catalog_entries SET label = ?1, description = ?2, topic = ?3, revision = ?4, updated_at = ?5 WHERE id = ?6 AND revision = ?7",
                params![label, description, topic, revision, now, skill_id, expected_revision],
            )
            .map_err(storage)?;
            append_skill_revision(
                tx,
                skill_id,
                revision,
                label,
                description,
                topic,
                "active",
                None,
                op,
                now,
            )?;
            Ok(result_json(request, "revision", json!(revision)))
        }
        Action::SetSkillStatus {
            retire,
            skill_id,
            expected_revision,
        } => {
            let skill = require_skill(tx, skill_id)?;
            if skill.revision != *expected_revision {
                return Err(Code::StaleRevision);
            }
            let target = if *retire { "retired" } else { "active" };
            if skill.status == target {
                return Err(Code::InvalidArgument);
            }
            if !retire {
                refuse_duplicate_label(tx, &skill.label, Some(skill_id))?;
            }
            let revision = skill.revision + 1;
            let retired_at = retire.then_some(now);
            tx.execute(
                "UPDATE skill_catalog_entries SET status = ?1, retired_at = ?2, revision = ?3, updated_at = ?4 WHERE id = ?5 AND revision = ?6",
                params![target, retired_at, revision, now, skill_id, expected_revision],
            )
            .map_err(storage)?;
            let catalog_version = if skill.origin == "builtin" {
                skill.catalog_version
            } else {
                None
            };
            append_skill_revision(
                tx,
                skill_id,
                revision,
                &skill.label,
                &skill.description,
                &skill.topic,
                target,
                catalog_version,
                op,
                now,
            )?;
            Ok(result_json(request, "revision", json!(revision)))
        }
        Action::CreateObservation {
            observation_id,
            skill_id,
            journal_id,
            source_field,
            content,
        } => {
            if exists(
                tx,
                "SELECT 1 FROM skill_observations WHERE id = ?1",
                observation_id,
            )? {
                return Err(Code::OperationConflict);
            }
            if exists(
                tx,
                "SELECT 1 FROM skill_evidence_operations WHERE subject_id = ?1 AND is_erased = 1",
                observation_id,
            )? {
                return Err(Code::Erased);
            }
            let skill = require_skill(tx, skill_id)?;
            if skill.status == "retired" {
                return Err(Code::SkillRetired);
            }
            type JournalRow = (
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
            );
            let journal: Option<JournalRow> = tx
                .query_row(
                    "SELECT date, title, instructor_feedback, went_well, was_difficult, practiced FROM journal_entries WHERE id = ?1",
                    [journal_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
                )
                .optional()
                .map_err(storage)?;
            let Some((date, title, feedback, went_well, difficult, practiced)) = journal else {
                return Err(Code::SourceMissing);
            };
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM skill_observations WHERE journal_id = ?1",
                    [journal_id],
                    |r| r.get(0),
                )
                .map_err(storage)?;
            if count >= OBSERVATIONS_PER_DEBRIEF {
                return Err(Code::LimitExceeded);
            }
            let source_hash = if source_field == "none" {
                None
            } else {
                let text = match source_field.as_str() {
                    "instructor_feedback" => feedback,
                    "went_well" => went_well,
                    "was_difficult" => difficult,
                    _ => practiced,
                }
                .unwrap_or_default();
                if js_trim(&text).is_empty() {
                    return Err(Code::InvalidArgument);
                }
                Some(sha256_hex(&text))
            };
            tx.execute(
                "INSERT INTO skill_observations (
                   id, skill_id, skill_label_snapshot, journal_id, source_journal_id, source_journal_date, source_journal_title,
                   source_field, source_text_sha256, attribution, instructor_name, wording, observed_on, revision,
                   action_id, linked_action_id, linked_action_title, addressed_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, NULL, NULL, NULL, NULL, ?13, ?13)",
                params![
                    observation_id,
                    skill_id,
                    skill.label,
                    journal_id,
                    date,
                    clip(&title.unwrap_or_default(), SOURCE_TITLE_CODE_POINTS),
                    source_field,
                    source_hash,
                    content.attribution,
                    content.instructor_name,
                    content.wording,
                    content.observed_on,
                    now
                ],
            )
            .map_err(storage)?;
            let state = ObservationState {
                content: content.clone(),
                action_id: None,
                linked_action_id: None,
                linked_action_title: None,
                addressed_at: None,
            };
            append_observation_revision(tx, observation_id, 1, "created", &state, op, now)?;
            Ok(result_json(request, "revision", json!(1)))
        }
        Action::EditObservation {
            observation_id,
            expected_revision,
            ..
        }
        | Action::LinkFollowUp {
            observation_id,
            expected_revision,
            ..
        }
        | Action::UnlinkFollowUp {
            observation_id,
            expected_revision,
        }
        | Action::SetAddressed {
            observation_id,
            expected_revision,
            ..
        } => {
            type ObservationRow = (
                String,
                String,
                String,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
                i64,
            );
            let row: Option<ObservationRow> = tx
                .query_row(
                    "SELECT wording, observed_on, attribution, instructor_name, action_id, linked_action_id, linked_action_title, addressed_at, revision
                       FROM skill_observations WHERE id = ?1",
                    [observation_id],
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
                .map_err(storage)?;
            let Some((
                wording,
                observed_on,
                attribution,
                instructor_name,
                action_id,
                linked_id,
                linked_title,
                addressed_at,
                revision,
            )) = row
            else {
                return Err(Code::NotFound);
            };
            if revision != *expected_revision {
                return Err(Code::StaleRevision);
            }
            let mut next = ObservationState {
                content: Content {
                    wording,
                    observed_on,
                    attribution,
                    instructor_name,
                },
                action_id,
                linked_action_id: linked_id,
                linked_action_title: linked_title,
                addressed_at,
            };
            let kind = match &request.action {
                Action::EditObservation { content, .. } => {
                    if next.content == *content {
                        return Err(Code::InvalidArgument);
                    }
                    next.content = content.clone();
                    "edited"
                }
                Action::LinkFollowUp { action_id, .. } => {
                    let title: Option<Option<String>> = tx
                        .query_row(
                            "SELECT title FROM next_actions WHERE id = ?1",
                            [action_id],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(storage)?;
                    let Some(title) = title else {
                        return Err(Code::NotFound);
                    };
                    if next.action_id.as_deref() == Some(action_id.as_str()) {
                        return Err(Code::InvalidArgument);
                    }
                    next.action_id = Some(action_id.clone());
                    next.linked_action_id = Some(action_id.clone());
                    next.linked_action_title =
                        Some(clip(&title.unwrap_or_default(), SOURCE_TITLE_CODE_POINTS));
                    "linked_action"
                }
                Action::UnlinkFollowUp { .. } => {
                    if next.linked_action_id.is_none() {
                        return Err(Code::InvalidArgument);
                    }
                    next.action_id = None;
                    next.linked_action_id = None;
                    next.linked_action_title = None;
                    "unlinked_action"
                }
                Action::SetAddressed { addressed, .. } => {
                    if next.addressed_at.is_some() == *addressed {
                        return Err(Code::InvalidArgument);
                    }
                    next.addressed_at = addressed.then(|| now.to_string());
                    if *addressed {
                        "marked_addressed"
                    } else {
                        "cleared_addressed"
                    }
                }
                _ => return Err(Code::StorageFailure),
            };
            let revision = revision + 1;
            tx.execute(
                "UPDATE skill_observations SET wording = ?1, observed_on = ?2, attribution = ?3, instructor_name = ?4,
                   action_id = ?5, linked_action_id = ?6, linked_action_title = ?7, addressed_at = ?8, revision = ?9, updated_at = ?10
                 WHERE id = ?11 AND revision = ?12",
                params![
                    next.content.wording,
                    next.content.observed_on,
                    next.content.attribution,
                    next.content.instructor_name,
                    next.action_id,
                    next.linked_action_id,
                    next.linked_action_title,
                    next.addressed_at,
                    revision,
                    now,
                    observation_id,
                    expected_revision
                ],
            )
            .map_err(storage)?;
            append_observation_revision(tx, observation_id, revision, kind, &next, op, now)?;
            Ok(result_json(request, "revision", json!(revision)))
        }
        Action::SetAssessment {
            status_kind,
            skill_id,
            expected_sequence,
            status,
            confidence,
        } => {
            require_skill(tx, skill_id)?;
            let kind = if *status_kind { "status" } else { "confidence" };
            let latest: Option<(i64, Option<String>, Option<i64>)> = tx
                .query_row(
                    "SELECT sequence, status, confidence FROM skill_self_assessments WHERE skill_id = ?1 AND kind = ?2 ORDER BY sequence DESC LIMIT 1",
                    params![skill_id, kind],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(storage)?;
            let current = latest.as_ref().map(|l| l.0).unwrap_or(0);
            if current != *expected_sequence {
                return Err(Code::StaleRevision);
            }
            let unchanged = match &latest {
                Some((_, s, c)) => {
                    if *status_kind {
                        s == status
                    } else {
                        c == confidence
                    }
                }
                None => {
                    if *status_kind {
                        status.is_none()
                    } else {
                        confidence.is_none()
                    }
                }
            };
            if unchanged {
                return Err(Code::InvalidArgument);
            }
            let sequence = current + 1;
            tx.execute(
                "INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?1, ?7)",
                params![op, skill_id, kind, status, confidence, sequence, now],
            )
            .map_err(storage)?;
            Ok(result_json(request, "sequence", json!(sequence)))
        }
        Action::EraseObservation { observation_id } => {
            if !exists(
                tx,
                "SELECT 1 FROM skill_observations WHERE id = ?1",
                observation_id,
            )? {
                return Err(Code::NotFound);
            }
            // Receipts for the subject become non-content tombstones, so an old
            // retry cannot bring the observation back.
            tx.execute(
                "UPDATE skill_evidence_operations SET is_erased = 1, result_json = NULL WHERE subject_id = ?1 AND is_erased = 0",
                [observation_id],
            )
            .map_err(storage)?;
            // The observation, then (by cascade, once it is gone) its history.
            tx.execute(
                "DELETE FROM skill_observations WHERE id = ?1",
                [observation_id],
            )
            .map_err(storage)?;
            Ok(result_json(request, "erased", json!(true)))
        }
    }
}

/// `save_skill_evidence_action` at a database root: decode and hash, readiness,
/// one dedicated connection (5 s busy timeout, foreign keys on),
/// `BEGIN IMMEDIATE`, commit only when the whole action applies.
pub fn save_skill_evidence_at(
    root: &Path,
    operation: &Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    let request = decode_action(operation).map_err(Code::error)?;
    let hash = request_hash(operation).map_err(Code::error)?;
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() || !is_root_ready(root) {
        return Err(Code::StorageFailure.error());
    }
    let mut connection = Connection::open(&db_path).map_err(|_| Code::StorageFailure.error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| Code::StorageFailure.error())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| Code::StorageFailure.error())?;
    save_on_connection(&mut connection, &request, &hash).map_err(Code::error)
}

/// One immediate transaction on an open connection; any refusal or failure
/// rolls the whole change back, receipt included.
pub fn save_on_connection(
    connection: &mut Connection,
    request: &Request,
    hash: &str,
) -> Check<Value> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let outcome = execute_skill_evidence_transaction(&tx, request, hash)?;
    tx.commit().map_err(storage)?;
    Ok(outcome)
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

type Row = Vec<(String, SqlValue)>;

fn rows(conn: &Connection, sql: &str, values: &[SqlValue]) -> Check<Vec<Row>> {
    let mut statement = conn.prepare(sql).map_err(storage)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mapped = statement
        .query_map(params_from_iter(values.iter()), |r| {
            let mut out = Vec::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                out.push((name.clone(), r.get::<_, SqlValue>(i)?));
            }
            Ok(out)
        })
        .map_err(storage)?;
    mapped.collect::<Result<Vec<_>, _>>().map_err(storage)
}

fn field<'a>(row: &'a Row, key: &str) -> &'a SqlValue {
    row.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v)
        .unwrap_or(&SqlValue::Null)
}

/// TS `s()`: NULL is the empty string.
fn s(row: &Row, key: &str) -> String {
    match field(row, key) {
        SqlValue::Null => String::new(),
        SqlValue::Integer(i) => i.to_string(),
        SqlValue::Real(f) => f.to_string(),
        SqlValue::Text(t) => t.clone(),
        SqlValue::Blob(_) => String::new(),
    }
}

/// TS `n()`: NULL stays null.
fn n(row: &Row, key: &str) -> Value {
    match field(row, key) {
        SqlValue::Null => Value::Null,
        _ => Value::String(s(row, key)),
    }
}

fn int(row: &Row, key: &str) -> i64 {
    match field(row, key) {
        SqlValue::Integer(i) => *i,
        SqlValue::Real(f) => *f as i64,
        SqlValue::Text(t) => t.parse().unwrap_or(0),
        _ => 0,
    }
}

fn text(value: &str) -> SqlValue {
    SqlValue::Text(value.to_string())
}

/// The filters a cursor is bound to, normalized: absent and empty are null.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Filters {
    skill_id: Option<String>,
    journal_id: Option<String>,
    attribution: Option<String>,
}

struct Cursor {
    filters: Filters,
    o: String,
    c: String,
    i: String,
    fence: i64,
}

fn optional_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(t)) if !t.is_empty() => Some(t.clone()),
        _ => None,
    }
}

/// TS `checkFilters` + `normalizeFilters`.
fn filters_of(input: &Map<String, Value>) -> Check<Filters> {
    for key in ["skillId", "journalId"] {
        match input.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::String(t)) if t.is_empty() || is_short_text(t) => {}
            _ => return Err(Code::InvalidArgument),
        }
    }
    match input.get("attribution") {
        None | Some(Value::Null) => {}
        Some(Value::String(t))
            if t.is_empty() || t == "self_report" || t == "instructor_transcribed" => {}
        Some(Value::Bool(false)) => {}
        _ => return Err(Code::InvalidArgument),
    }
    Ok(Filters {
        skill_id: optional_value(input.get("skillId")),
        journal_id: optional_value(input.get("journalId")),
        attribution: optional_value(input.get("attribution")),
    })
}

fn page_limit(value: Option<&Value>, default: i64, max: i64) -> Check<i64> {
    match value {
        None => Ok(default),
        Some(v) => safe_integer(v, 1)
            .filter(|l| *l <= max)
            .ok_or(Code::LimitExceeded),
    }
}

fn encode_cursor(cursor: &Cursor) -> String {
    let f = &cursor.filters;
    json!([
        CURSOR_VERSION,
        f.skill_id,
        f.journal_id,
        f.attribution,
        cursor.o,
        cursor.c,
        cursor.i,
        cursor.fence
    ])
    .to_string()
}

fn decode_cursor(raw: &str) -> Check<Cursor> {
    let parsed: Value = serde_json::from_str(raw).map_err(|_| Code::InvalidArgument)?;
    let items = parsed.as_array().ok_or(Code::InvalidArgument)?;
    if items.len() != 8 || safe_integer(&items[0], 0) != Some(CURSOR_VERSION) {
        return Err(Code::InvalidArgument);
    }
    let filter = |v: &Value| -> Check<Option<String>> {
        match v {
            Value::Null => Ok(None),
            Value::String(t) if is_short_text(t) => Ok(Some(t.clone())),
            _ => Err(Code::InvalidArgument),
        }
    };
    let skill_id = filter(&items[1])?;
    let journal_id = filter(&items[2])?;
    let attribution = match &items[3] {
        Value::Null => None,
        Value::String(t) if t == "self_report" || t == "instructor_transcribed" => Some(t.clone()),
        _ => return Err(Code::InvalidArgument),
    };
    let o = items[4]
        .as_str()
        .filter(|d| is_calendar_date(d))
        .ok_or(Code::InvalidArgument)?;
    let c = items[5]
        .as_str()
        .filter(|t| is_short_text(t))
        .ok_or(Code::InvalidArgument)?;
    let i = items[6]
        .as_str()
        .filter(|t| is_short_text(t))
        .ok_or(Code::InvalidArgument)?;
    let fence = safe_integer(&items[7], 0).ok_or(Code::InvalidArgument)?;
    Ok(Cursor {
        filters: Filters {
            skill_id,
            journal_id,
            attribution,
        },
        o: o.to_string(),
        c: c.to_string(),
        i: i.to_string(),
        fence,
    })
}

const PAGE_SELECT: &str = "
  SELECT o.*, s.label AS skill_label, s.status AS skill_status,
         j.id AS live_journal_id, j.title AS live_journal_title, j.date AS live_journal_date,
         j.instructor_feedback AS live_instructor_feedback, j.went_well AS live_went_well,
         j.was_difficult AS live_was_difficult, j.practiced AS live_practiced,
         a.id AS live_action_id, a.title AS live_action_title, a.status AS live_action_status
    FROM skill_observations o
    JOIN skill_catalog_entries s ON s.id = o.skill_id
    LEFT JOIN journal_entries j ON j.id = o.journal_id
    LEFT JOIN next_actions a ON a.id = o.action_id";

const FENCE_SQL: &str = "SELECT COALESCE(MAX(rowid), 0) AS fence FROM skill_evidence_operations";
const EDITS_AFTER_FENCE_SQL: &str = "SELECT subject_id, result_json FROM skill_evidence_operations
  WHERE rowid > ?1 AND action = 'edit_observation' AND is_erased = 0 ORDER BY rowid";

fn fence(conn: &Connection) -> Check<i64> {
    conn.query_row(FENCE_SQL, [], |r| r.get(0)).map_err(storage)
}

fn before(key: (&str, &str, &str), cursor: &Cursor) -> bool {
    key.0 < cursor.o.as_str()
        || (key.0 == cursor.o
            && (key.1 < cursor.c.as_str() || (key.1 == cursor.c && key.2 < cursor.i.as_str())))
}

/// TS `assertCursorFresh`: refuse a cursor whose list changed underneath it.
fn assert_cursor_fresh(conn: &Connection, cursor: &Cursor) -> Check<()> {
    if cursor.fence > fence(conn)? {
        return Err(Code::InvalidArgument);
    }
    let f = &cursor.filters;
    for edit in rows(
        conn,
        EDITS_AFTER_FENCE_SQL,
        &[SqlValue::Integer(cursor.fence)],
    )? {
        let observation_id = s(&edit, "subject_id");
        let result = match field(&edit, "result_json") {
            SqlValue::Text(t) => Some(t.as_str()),
            _ => None,
        };
        let revision = match decode_result(result, "edit_observation", &observation_id) {
            Ok(ResultValue::Number(r)) => r,
            _ => return Err(Code::StaleCursor),
        };
        let found = rows(
            conn,
            "SELECT skill_id, source_journal_id, created_at FROM skill_observations WHERE id = ?1",
            &[text(&observation_id)],
        )?;
        let Some(obs) = found.first() else { continue };
        if f.skill_id
            .as_ref()
            .is_some_and(|id| *id != s(obs, "skill_id"))
        {
            continue;
        }
        if f.journal_id
            .as_ref()
            .is_some_and(|id| *id != s(obs, "source_journal_id"))
        {
            continue;
        }
        let pair = rows(
            conn,
            "SELECT revision, observed_on, attribution FROM skill_observation_revisions WHERE observation_id = ?1 AND revision IN (?2, ?3) ORDER BY revision",
            &[
                text(&observation_id),
                SqlValue::Integer(revision - 1),
                SqlValue::Integer(revision),
            ],
        )?;
        if pair.len() != 2 {
            return Err(Code::StaleCursor);
        }
        let created = s(obs, "created_at");
        let side = |row: &Row| -> &'static str {
            if f.attribution
                .as_ref()
                .is_some_and(|a| *a != s(row, "attribution"))
            {
                "out"
            } else if before((&s(row, "observed_on"), &created, &observation_id), cursor) {
                "unseen"
            } else {
                "seen"
            }
        };
        let after = side(&pair[1]);
        if after != "out" && after != side(&pair[0]) {
            return Err(Code::StaleCursor);
        }
    }
    Ok(())
}

fn to_item(row: &Row) -> Value {
    let field_name = s(row, "source_field");
    let source = if !matches!(field(row, "live_journal_id"), SqlValue::Null) {
        let text_changed = if field_name == "none" {
            Value::Null
        } else {
            let live = s(row, &format!("live_{field_name}"));
            Value::Bool(Some(sha256_hex(&live)) != Some(s(row, "source_text_sha256")))
        };
        json!({
            "kind": "present",
            "journalId": s(row, "live_journal_id"),
            "currentTitle": s(row, "live_journal_title"),
            "currentDate": s(row, "live_journal_date"),
            "renamed": s(row, "live_journal_title") != s(row, "source_journal_title"),
            "textChanged": text_changed,
        })
    } else {
        json!({ "kind": "deleted", "sourceJournalId": s(row, "source_journal_id") })
    };
    let action = if !matches!(field(row, "live_action_id"), SqlValue::Null) {
        json!({
            "kind": "linked",
            "actionId": s(row, "live_action_id"),
            "title": s(row, "live_action_title"),
            "actionStatus": s(row, "live_action_status"),
        })
    } else if !matches!(field(row, "linked_action_id"), SqlValue::Null) {
        json!({
            "kind": "deleted",
            "formerActionId": s(row, "linked_action_id"),
            "formerTitle": s(row, "linked_action_title"),
        })
    } else {
        json!({ "kind": "none" })
    };
    json!({
        "id": s(row, "id"),
        "skillId": s(row, "skill_id"),
        "skillLabel": s(row, "skill_label"),
        "skillLabelAtRecording": s(row, "skill_label_snapshot"),
        "skillRetired": s(row, "skill_status") == "retired",
        "wording": s(row, "wording"),
        "observedOn": s(row, "observed_on"),
        "attribution": s(row, "attribution"),
        "instructorName": s(row, "instructor_name"),
        "revision": int(row, "revision"),
        "source": source,
        "sourceSnapshot": {
            "title": s(row, "source_journal_title"),
            "date": s(row, "source_journal_date"),
            "field": field_name,
        },
        "action": action,
        "addressedAt": n(row, "addressed_at"),
        "createdAt": s(row, "created_at"),
        "updatedAt": s(row, "updated_at"),
    })
}

/// `read_skill_evidence_page`: one bounded, fenced, filter-bound page.
pub fn read_evidence_page(conn: &Connection, input: &Value) -> Check<Value> {
    let empty = Map::new();
    let input = match input {
        Value::Object(map) => map,
        Value::Null => &empty,
        _ => return Err(Code::InvalidArgument),
    };
    let filters = filters_of(input)?;
    let limit = page_limit(input.get("limit"), PAGE_DEFAULT, PAGE_MAX)?;
    let cursor = match input.get("cursor") {
        None | Some(Value::Null) => None,
        Some(Value::String(raw)) if raw.is_empty() => None,
        Some(Value::String(raw)) => {
            let cursor = decode_cursor(raw)?;
            if cursor.filters != filters {
                return Err(Code::InvalidArgument);
            }
            Some(cursor)
        }
        _ => return Err(Code::InvalidArgument),
    };
    let mut clauses: Vec<&str> = Vec::new();
    let mut values: Vec<SqlValue> = Vec::new();
    if let Some(id) = &filters.skill_id {
        clauses.push("o.skill_id = ?");
        values.push(text(id));
    }
    if let Some(id) = &filters.journal_id {
        clauses.push("o.journal_id = ?");
        values.push(text(id));
    }
    if let Some(a) = &filters.attribution {
        clauses.push("o.attribution = ?");
        values.push(text(a));
    }
    if let Some(c) = &cursor {
        clauses.push("(o.observed_on, o.created_at, o.id) < (?, ?, ?)");
        values.extend([text(&c.o), text(&c.c), text(&c.i)]);
        assert_cursor_fresh(conn, c)?;
    }
    values.push(SqlValue::Integer(limit + 1));
    let head = fence(conn)?;
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let sql = format!(
        "{PAGE_SELECT}\n    {where_clause}\n    ORDER BY o.observed_on DESC, o.created_at DESC, o.id DESC\n    LIMIT ?"
    );
    let found = rows(conn, &sql, &values)?;
    let visible = &found[..found.len().min(limit as usize)];
    let items: Vec<Value> = visible.iter().map(to_item).collect();
    let next = match visible.last() {
        Some(last) if found.len() as i64 > limit => Value::String(encode_cursor(&Cursor {
            filters,
            o: s(last, "observed_on"),
            c: s(last, "created_at"),
            i: s(last, "id"),
            fence: head,
        })),
        _ => Value::Null,
    };
    Ok(json!({ "items": items, "nextCursor": next }))
}

fn evidence_level(observations: i64, debriefs: i64) -> &'static str {
    if observations == 0 {
        "none"
    } else if observations < 3 || debriefs < 2 {
        "limited"
    } else {
        "recorded"
    }
}

/// `read_skill_summary`: one skill's summary, or null when it does not exist.
pub fn read_skill_summary_on(conn: &Connection, input: &Value) -> Check<Value> {
    let skill_id = input
        .get("skillId")
        .and_then(Value::as_str)
        .filter(|id| is_skill_id(id))
        .ok_or(Code::InvalidArgument)?;
    let found = rows(
        conn,
        "SELECT * FROM skill_catalog_entries WHERE id = ?1",
        &[text(skill_id)],
    )?;
    let Some(skill) = found.first() else {
        return Ok(Value::Null);
    };
    let latest = |kind: &str| -> Check<Option<Row>> {
        Ok(rows(
            conn,
            "SELECT sequence, status, confidence FROM skill_self_assessments WHERE skill_id = ?1 AND kind = ?2 ORDER BY sequence DESC LIMIT 1",
            &[text(skill_id), text(kind)],
        )?
        .into_iter()
        .next())
    };
    let status = latest("status")?;
    let confidence = latest("confidence")?;
    let counts = rows(
        conn,
        "SELECT COUNT(*) AS total,
                COALESCE(SUM(attribution = 'self_report'), 0) AS self_count,
                COALESCE(SUM(attribution = 'instructor_transcribed'), 0) AS instructor_count,
                COUNT(DISTINCT source_journal_id) AS debriefs,
                MAX(observed_on) AS last_observed
           FROM skill_observations WHERE skill_id = ?1",
        &[text(skill_id)],
    )?;
    let c = counts.first().cloned().unwrap_or_default();
    let total = int(&c, "total");
    let debriefs = int(&c, "debriefs");
    Ok(json!({
        "skillId": skill_id,
        "label": s(skill, "label"),
        "origin": s(skill, "origin"),
        "retired": s(skill, "status") == "retired",
        "revision": int(skill, "revision"),
        "status": status.as_ref().map(|r| n(r, "status")).unwrap_or(Value::Null),
        "statusSequence": status.as_ref().map(|r| int(r, "sequence")).unwrap_or(0),
        "confidence": confidence
            .as_ref()
            .and_then(|r| match field(r, "confidence") {
                SqlValue::Null => None,
                _ => Some(int(r, "confidence")),
            }),
        "confidenceSequence": confidence.as_ref().map(|r| int(r, "sequence")).unwrap_or(0),
        "observationCount": total,
        "selfReportCount": int(&c, "self_count"),
        "instructorTranscribedCount": int(&c, "instructor_count"),
        "distinctDebriefs": debriefs,
        "lastObservedOn": n(&c, "last_observed"),
        "evidence": evidence_level(total, debriefs),
    }))
}

/// `list_skills`: built-in first, then hers, by name.
pub fn list_skills_on(conn: &Connection, input: &Value) -> Check<Value> {
    let include_retired = match input.get("includeRetired") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        _ => return Err(Code::InvalidArgument),
    };
    let sql = format!(
        "SELECT id, label, description, origin, topic, status, revision FROM skill_catalog_entries
          {}
          ORDER BY origin = 'custom', label COLLATE NOCASE, id",
        if include_retired {
            ""
        } else {
            "WHERE status = 'active'"
        }
    );
    let list: Vec<Value> = rows(conn, &sql, &[])?
        .iter()
        .map(|r| {
            json!({
                "id": s(r, "id"),
                "label": s(r, "label"),
                "description": s(r, "description"),
                "origin": s(r, "origin"),
                "topic": s(r, "topic"),
                "retired": s(r, "status") == "retired",
                "revision": int(r, "revision"),
            })
        })
        .collect();
    Ok(Value::Array(list))
}

/// `read_observation_history`: one bounded page, newest first; ERASED for an
/// erased observation and NOT_FOUND for an unknown one.
pub fn read_observation_history_on(conn: &Connection, input: &Value) -> Check<Value> {
    let observation_id = input
        .get("observationId")
        .and_then(Value::as_str)
        .filter(|id| lower_uuid_v4(id))
        .ok_or(Code::InvalidArgument)?;
    let limit = page_limit(input.get("limit"), REVISION_PAGE_DEFAULT, REVISION_PAGE_MAX)?;
    let found = rows(
        conn,
        "SELECT revision FROM skill_observations WHERE id = ?1",
        &[text(observation_id)],
    )?;
    let Some(obs) = found.first() else {
        let erased = !rows(
            conn,
            "SELECT 1 FROM skill_evidence_operations WHERE subject_id = ?1 AND is_erased = 1 LIMIT 1",
            &[text(observation_id)],
        )?
        .is_empty();
        return Err(if erased { Code::Erased } else { Code::NotFound });
    };
    let current = int(obs, "revision");
    let up_to = match input.get("cursor") {
        None | Some(Value::Null) => current,
        Some(Value::String(raw)) if raw.is_empty() => current,
        Some(Value::String(raw)) => {
            let parsed: Value = serde_json::from_str(raw).map_err(|_| Code::InvalidArgument)?;
            let items = parsed.as_array().ok_or(Code::InvalidArgument)?;
            if items.len() != 3 || items[0].as_str() != Some("history") {
                return Err(Code::InvalidArgument);
            }
            if items[1].as_str() != Some(observation_id) {
                return Err(Code::InvalidArgument);
            }
            let before_revision = safe_integer(&items[2], 2)
                .filter(|b| *b <= current)
                .ok_or(Code::InvalidArgument)?;
            before_revision - 1
        }
        _ => return Err(Code::InvalidArgument),
    };
    let found = rows(
        conn,
        "SELECT * FROM skill_observation_revisions WHERE observation_id = ?1 AND revision <= ?2 ORDER BY revision DESC LIMIT ?3",
        &[
            text(observation_id),
            SqlValue::Integer(up_to),
            SqlValue::Integer(limit + 1),
        ],
    )?;
    let visible = &found[..found.len().min(limit as usize)];
    let items: Vec<Value> = visible
        .iter()
        .map(|r| {
            json!({
                "revision": int(r, "revision"),
                "changeKind": s(r, "change_kind"),
                "wording": s(r, "wording"),
                "observedOn": s(r, "observed_on"),
                "attribution": s(r, "attribution"),
                "instructorName": s(r, "instructor_name"),
                "linkedActionId": n(r, "linked_action_id"),
                "linkedActionTitle": n(r, "linked_action_title"),
                "addressedAt": n(r, "addressed_at"),
                "recordedAt": s(r, "recorded_at"),
            })
        })
        .collect();
    let next = match visible.last() {
        Some(last) if found.len() as i64 > limit => {
            Value::String(json!(["history", observation_id, int(last, "revision")]).to_string())
        }
        _ => Value::Null,
    };
    Ok(json!({
        "observationId": observation_id,
        "currentRevision": current,
        "items": items,
        "nextCursor": next,
    }))
}

/// Run one read on a read-only connection inside one deferred transaction, so
/// a page and its fence come from the same snapshot.
pub fn read_at(
    root: &Path,
    reader: fn(&Connection, &Value) -> Check<Value>,
    input: &Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() || !is_root_ready(root) {
        return Err(Code::StorageFailure.error());
    }
    let mut connection = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| Code::StorageFailure.error())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|_| Code::StorageFailure.error())?;
    let tx: Transaction = connection
        .transaction()
        .map_err(|_| Code::StorageFailure.error())?;
    let result = reader(&tx, input).map_err(Code::error)?;
    tx.rollback().map_err(|_| Code::StorageFailure.error())?;
    Ok(result)
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn save_skill_evidence_action(
    app: AppHandle,
    operation: Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    let root = app_root(&app).map_err(|_| Code::StorageFailure.error())?;
    tauri::async_runtime::spawn_blocking(move || save_skill_evidence_at(&root, &operation))
        .await
        .map_err(|_| Code::StorageFailure.error())?
}

async fn read_command(
    app: AppHandle,
    reader: fn(&Connection, &Value) -> Check<Value>,
    input: Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    let root = app_root(&app).map_err(|_| Code::StorageFailure.error())?;
    tauri::async_runtime::spawn_blocking(move || read_at(&root, reader, &input))
        .await
        .map_err(|_| Code::StorageFailure.error())?
}

#[tauri::command]
pub async fn read_skill_evidence_page(
    app: AppHandle,
    input: Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    read_command(app, read_evidence_page, input).await
}

#[tauri::command]
pub async fn read_skill_summary(
    app: AppHandle,
    input: Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    read_command(app, read_skill_summary_on, input).await
}

#[tauri::command]
pub async fn list_skills(app: AppHandle, input: Value) -> Result<Value, SkillEvidenceErrorWire> {
    read_command(app, list_skills_on, input).await
}

#[tauri::command]
pub async fn read_observation_history(
    app: AppHandle,
    input: Value,
) -> Result<Value, SkillEvidenceErrorWire> {
    read_command(app, read_observation_history_on, input).await
}

#[cfg(test)]
#[path = "skill_evidence_tests.rs"]
mod tests;
