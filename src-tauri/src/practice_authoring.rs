//! Practice-question authoring (OFFLINE-03b): the native twin of
//! `src/data/practiceAuthoring.ts`. Same exact-key contract, same refusals at
//! the same logical points, same canonical bytes and messages — one durable
//! receipt, retirement protection and provenance enforcement whether the save
//! came through this command or through the TypeScript fallback.
//!
//! TS twin: `src/data/practiceAuthoring.ts`; the two accept and refuse the
//! same operations, with the same codes and messages (there is no native
//! `IPC_TRANSPORT_ERROR`; that code is TypeScript-only).

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::card_reviews::sha256_hex;
use crate::practice_sessions::{code_point_count, is_uuid_v4};
use crate::study_sets::is_item_id;

/// Mirrors the TS bounds in `practiceAuthoring.ts`.
const MAX_PRACTICE_QUESTIONS: usize = 200;
const MAX_QUESTION_CHARS: usize = 10_000;
const MIN_OPTIONS: usize = 2;
const MAX_OPTIONS: usize = 8;
const MAX_OPTION_CHARS: usize = 1_000;
const MAX_EXPLANATION_CHARS: usize = 5_000;
const MIN_SOURCE_PAGE: i64 = 1;
const MAX_SOURCE_PAGE: i64 = 1_000;
pub const MAX_RETIRED_ITEMS: usize = 2_000;
const MAX_RETIREMENT_TERMS: usize = 64;
const MAX_TITLE_CHARS: usize = 500;
const MAX_MODEL_CHARS: usize = 200;
const MAX_MATERIAL_ID_CHARS: usize = 200;
const MAX_SAVED_AT_CHARS: usize = 64;

const PROVIDERS: [&str; 3] = ["gemini", "import", "manual"];
const HISTORY_REASON: [(Reason, &str); 6] = [
    (Reason::Create, "edit"),
    (Reason::Edit, "edit"),
    (Reason::Correct, "correct"),
    (Reason::Regenerate, "regenerate"),
    (Reason::Restore, "restore"),
    (Reason::Remove, "delete"),
];

/// Every refusal. The messages match `PRACTICE_AUTHORING_ERROR_MESSAGES` in
/// `src/data/persistenceErrors.ts` word for word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PracticeAuthoringErrorCode {
    InvalidArgument,
    StaleContent,
    Conflict,
    AttemptActive,
    RetirementLimit,
    NotFound,
    StorageError,
}

impl PracticeAuthoringErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArgument => {
                "These practice questions couldn't be saved because part of them isn't valid. Nothing has been saved."
            }
            Self::StaleContent => {
                "This practice test changed after you opened it. Nothing has been saved; look at it again first."
            }
            Self::Conflict => {
                "This save request was already used for different practice content. Nothing has been saved."
            }
            Self::AttemptActive => {
                "Finish or abandon your current practice attempt before editing these questions. Nothing has been saved."
            }
            Self::RetirementLimit => {
                "This practice test has reached its deletion and correction history limit. Your changes haven't been saved."
            }
            Self::NotFound => "That study material no longer exists. Nothing has been saved.",
            Self::StorageError => {
                "A storage problem stopped these practice questions from saving. Nothing has been saved."
            }
        }
    }

    pub fn error(self) -> PracticeAuthoringErrorWire {
        PracticeAuthoringErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

/// The wire refusal: one code and its fixed message, never engine text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PracticeAuthoringErrorWire {
    pub code: PracticeAuthoringErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for PracticeAuthoringErrorWire {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for PracticeAuthoringErrorWire {}

type Check<T> = Result<T, PracticeAuthoringErrorCode>;

fn invalid<T>() -> Check<T> {
    Err(PracticeAuthoringErrorCode::InvalidArgument)
}

/* ------------------------------------------------------------------ */
/* Decoded shapes                                                      */
/* ------------------------------------------------------------------ */

/// `PracticeSaveReason` — why the save was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Reason {
    Create,
    Edit,
    Correct,
    Regenerate,
    Restore,
    Remove,
}

impl Reason {
    fn parse(value: Option<&Value>) -> Check<Self> {
        Ok(match value.and_then(Value::as_str) {
            Some("create") => Self::Create,
            Some("edit") => Self::Edit,
            Some("correct") => Self::Correct,
            Some("regenerate") => Self::Regenerate,
            Some("restore") => Self::Restore,
            Some("remove") => Self::Remove,
            _ => return invalid(),
        })
    }

    /// The `action` the receipt stores — the reason itself.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Edit => "edit",
            Self::Correct => "correct",
            Self::Regenerate => "regenerate",
            Self::Restore => "restore",
            Self::Remove => "remove",
        }
    }

    /// `HISTORY_REASON` — the stored history reason this operation records.
    fn history(self) -> &'static str {
        HISTORY_REASON
            .iter()
            .find(|(r, _)| *r == self)
            .map(|(_, h)| *h)
            .unwrap_or("")
    }

    fn renews_generated_at(self) -> bool {
        matches!(self, Self::Create | Self::Regenerate)
    }
}

/// One entry of a retirement ledger (`PracticeRetirementRecord`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetirementRecord {
    pub kind: String,
    pub item_id: String,
    pub reason: String,
    pub text_key: String,
    pub terms: Vec<String>,
}

/// `PracticeAuthoringQuestion` — content, provenance and a server-known
/// identity; never server state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthoringQuestion {
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: i64,
    pub explanation: String,
    pub source_page: Option<i64>,
    pub identity: String,
    pub origin: Option<String>,
    pub replaces: Option<String>,
}

/// `PracticeSnapshot` — the shared exact-key snapshot: what is stored,
/// expected and kept in history.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub version_id: String,
    pub version_number: i64,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub saved_at: String,
    pub questions: Vec<AuthoringQuestion>,
    pub retired: Vec<RetirementRecord>,
}

/// `PracticeNext` — the desired content of one save: content and editor
/// metadata, no server state.
#[derive(Debug, Clone, PartialEq)]
pub struct PracticeNext {
    pub title: String,
    pub provider: String,
    pub model: String,
    pub questions: Vec<AuthoringQuestion>,
    pub retired: Vec<RetirementRecord>,
}

/// `PracticeSaveOperation`.
#[derive(Debug, Clone)]
pub struct SaveOperation {
    pub operation_id: String,
    pub material_id: String,
    pub reason: Reason,
    pub expected: Option<Snapshot>,
    pub next: Option<PracticeNext>,
}

/* ------------------------------------------------------------------ */
/* Decode primitives                                                   */
/* ------------------------------------------------------------------ */

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// JS `value.length` for the string checks the TS contract spells with
/// `.length` rather than `codePointLength`.
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// JS `previous < term` — UTF-16 code-unit order, not locale order.
fn utf16_less(a: &str, b: &str) -> bool {
    a.encode_utf16().lt(b.encode_utf16())
}

/// `typeof value === "number" && Number.isInteger(value)` — serde's `as_i64`
/// already refuses numbers with a fractional part, like `Number.isInteger`.
fn as_integer(value: &Value) -> Option<i64> {
    value.as_i64()
}

/// Mirrors the TS `exactKeys`.
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

/// Mirrors the TS `boundedText`: a string of at most `max` code points.
fn bounded_text(value: &Value, max: usize) -> Check<String> {
    let Value::String(text) = value else {
        return invalid();
    };
    if code_point_count(text) > max {
        return invalid();
    }
    Ok(text.clone())
}

/// Mirrors the TS `nonEmptyText`: a string of 1..=`max` UTF-16 units.
fn non_empty_text(value: &Value, max: usize) -> Check<String> {
    let Value::String(text) = value else {
        return invalid();
    };
    let length = utf16_len(text);
    if length == 0 || length > max {
        return invalid();
    }
    Ok(text.clone())
}

/// Mirrors the TS `originOf`, on the present `origin` key.
fn origin_of(value: &Value) -> Check<String> {
    match value {
        Value::String(origin) if origin == "user" || origin == "instructor" => Ok(origin.clone()),
        _ => invalid(),
    }
}

/* ------------------------------------------------------------------ */
/* Decoders (`decodeQuestion` …)                                       */
/* ------------------------------------------------------------------ */

/// Mirrors the TS `decodeQuestion`.
pub fn decode_question(value: &Value) -> Check<AuthoringQuestion> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(
        map,
        &[
            "question",
            "options",
            "correctIndex",
            "explanation",
            "sourcePage",
            "identity",
        ],
        &["origin", "replaces"],
    )?;
    let Value::String(question) = &map["question"] else {
        return invalid();
    };
    let question_length = code_point_count(question);
    if question_length == 0 || question_length > MAX_QUESTION_CHARS {
        return invalid();
    }
    let Value::Array(options) = &map["options"] else {
        return invalid();
    };
    if options.len() < MIN_OPTIONS || options.len() > MAX_OPTIONS {
        return invalid();
    }
    let mut parsed_options = Vec::with_capacity(options.len());
    for option in options {
        let Value::String(option) = option else {
            return invalid();
        };
        let length = code_point_count(option);
        if length == 0 || length > MAX_OPTION_CHARS {
            return invalid();
        }
        parsed_options.push(option.clone());
    }
    let correct_index =
        as_integer(&map["correctIndex"]).ok_or(PracticeAuthoringErrorCode::InvalidArgument)?;
    if correct_index < 0 || correct_index >= parsed_options.len() as i64 {
        return invalid();
    }
    let Value::String(explanation) = &map["explanation"] else {
        return invalid();
    };
    if code_point_count(explanation) > MAX_EXPLANATION_CHARS {
        return invalid();
    }
    let source_page = match &map["sourcePage"] {
        Value::Null => None,
        value => {
            let page = as_integer(value).ok_or(PracticeAuthoringErrorCode::InvalidArgument)?;
            if !(MIN_SOURCE_PAGE..=MAX_SOURCE_PAGE).contains(&page) {
                return invalid();
            }
            Some(page)
        }
    };
    let Value::String(identity) = &map["identity"] else {
        return invalid();
    };
    if !is_uuid_v4(identity) {
        return invalid();
    }
    let mut out = AuthoringQuestion {
        question: question.clone(),
        options: parsed_options,
        correct_index,
        explanation: explanation.clone(),
        source_page,
        identity: identity.clone(),
        origin: None,
        replaces: None,
    };
    if let Some(origin) = map.get("origin") {
        out.origin = Some(origin_of(origin)?);
    }
    if map.contains_key("replaces") {
        let replaces = match &map["replaces"] {
            Value::String(id) if is_uuid_v4(id) => id.clone(),
            _ => return invalid(),
        };
        if out.origin.is_none() {
            return invalid();
        }
        out.replaces = Some(replaces);
    }
    Ok(out)
}

/// Mirrors the TS `decodeRetirement` (the dedupe `keys` set is threaded in).
fn decode_retirement(
    value: &Value,
    keys: &mut Vec<(String, String, String, String)>,
) -> Check<RetirementRecord> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(map, &["kind", "itemId", "reason", "textKey", "terms"], &[])?;
    let Value::String(kind) = &map["kind"] else {
        return invalid();
    };
    let Value::String(item_id) = &map["itemId"] else {
        return invalid();
    };
    let Value::String(reason) = &map["reason"] else {
        return invalid();
    };
    let Value::String(text_key) = &map["textKey"] else {
        return invalid();
    };
    let Value::Array(terms) = &map["terms"] else {
        return invalid();
    };
    if kind != "question"
        || !is_item_id(item_id)
        || (reason != "deleted" && reason != "corrected")
        || !is_lower_hex_64(text_key)
        || terms.len() > MAX_RETIREMENT_TERMS
    {
        return invalid();
    }
    let mut parsed_terms = Vec::with_capacity(terms.len());
    let mut previous: Option<String> = None;
    for term in terms {
        let Value::String(term) = term else {
            return invalid();
        };
        if term.is_empty() || code_point_count(term) > MAX_QUESTION_CHARS {
            return invalid();
        }
        if previous.is_some_and(|p| !utf16_less(&p, term)) {
            return invalid();
        }
        previous = Some(term.clone());
        parsed_terms.push(term.clone());
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
    Ok(RetirementRecord {
        kind: kind.clone(),
        item_id: item_id.clone(),
        reason: reason.clone(),
        text_key: text_key.clone(),
        terms: parsed_terms,
    })
}

/// Mirrors the TS `decodeRetirements`.
pub fn decode_retirements(value: &Value) -> Check<Vec<RetirementRecord>> {
    let Value::Array(entries) = value else {
        return invalid();
    };
    if entries.len() > MAX_RETIRED_ITEMS {
        return Err(PracticeAuthoringErrorCode::RetirementLimit);
    }
    let mut keys = Vec::with_capacity(entries.len());
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        out.push(decode_retirement(entry, &mut keys)?);
    }
    Ok(out)
}

/// Mirrors the TS `decodeQuestions`.
pub fn decode_questions(value: &Value) -> Check<Vec<AuthoringQuestion>> {
    let Value::Array(entries) = value else {
        return invalid();
    };
    if entries.is_empty() || entries.len() > MAX_PRACTICE_QUESTIONS {
        return invalid();
    }
    let mut ids: Vec<String> = Vec::with_capacity(entries.len());
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let question = decode_question(entry)?;
        if ids.contains(&question.identity) {
            return invalid();
        }
        ids.push(question.identity.clone());
        out.push(question);
    }
    Ok(out)
}

/// Mirrors the TS `decodePracticeSnapshot`.
pub fn decode_practice_snapshot(value: &Value) -> Check<Snapshot> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(
        map,
        &[
            "schemaVersion",
            "versionId",
            "versionNumber",
            "title",
            "provider",
            "model",
            "savedAt",
            "questions",
            "retired",
        ],
        &[],
    )?;
    if map["schemaVersion"].as_i64() != Some(1) {
        return invalid();
    }
    let Value::String(version_id) = &map["versionId"] else {
        return invalid();
    };
    if !is_uuid_v4(version_id) {
        return invalid();
    }
    let version_number =
        as_integer(&map["versionNumber"]).ok_or(PracticeAuthoringErrorCode::InvalidArgument)?;
    if version_number < 1 {
        return invalid();
    }
    let provider = provider_of(&map["provider"])?;
    Ok(Snapshot {
        version_id: version_id.clone(),
        version_number,
        title: bounded_text(&map["title"], MAX_TITLE_CHARS)?,
        provider,
        model: bounded_text(&map["model"], MAX_MODEL_CHARS)?,
        saved_at: non_empty_text(&map["savedAt"], MAX_SAVED_AT_CHARS)?,
        questions: decode_questions(&map["questions"])?,
        retired: decode_retirements(&map["retired"])?,
    })
}

fn provider_of(value: &Value) -> Check<String> {
    match value {
        Value::String(provider) if PROVIDERS.contains(&provider.as_str()) => Ok(provider.clone()),
        _ => invalid(),
    }
}

/// Mirrors the TS `decodePracticeNext`.
pub fn decode_practice_next(value: &Value) -> Check<PracticeNext> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(
        map,
        &["title", "provider", "model", "questions", "retired"],
        &[],
    )?;
    let provider = provider_of(&map["provider"])?;
    Ok(PracticeNext {
        title: bounded_text(&map["title"], MAX_TITLE_CHARS)?,
        provider,
        model: bounded_text(&map["model"], MAX_MODEL_CHARS)?,
        questions: decode_questions(&map["questions"])?,
        retired: decode_retirements(&map["retired"])?,
    })
}

/// Mirrors the TS `decodePracticeOperation`.
pub fn decode_practice_operation(value: &Value) -> Check<SaveOperation> {
    let Value::Object(map) = value else {
        return invalid();
    };
    exact_keys(
        map,
        &[
            "operationId",
            "sourceMaterialId",
            "reason",
            "expected",
            "next",
        ],
        &[],
    )?;
    let Value::String(operation_id) = &map["operationId"] else {
        return invalid();
    };
    if !is_uuid_v4(operation_id) {
        return invalid();
    }
    let Value::String(material_id) = &map["sourceMaterialId"] else {
        return invalid();
    };
    let id_length = utf16_len(material_id);
    if id_length == 0 || id_length > MAX_MATERIAL_ID_CHARS {
        return invalid();
    }
    let reason = Reason::parse(map.get("reason"))?;
    let expected = match &map["expected"] {
        Value::Null => None,
        value => Some(decode_practice_snapshot(value)?),
    };
    let next = match &map["next"] {
        Value::Null => None,
        value => Some(decode_practice_next(value)?),
    };
    // Mirrors the TS `consistent` pairing: a restore may expect no current
    // test, a create expects none and carries no ledger, a remove carries
    // no content, and everything else keeps the exact pairing.
    let consistent = match reason {
        Reason::Create => expected.is_none() && next.as_ref().is_some_and(|n| n.retired.is_empty()),
        Reason::Remove => next.is_none(),
        Reason::Restore => next.is_some(),
        _ => expected.is_some() && next.is_some(),
    };
    if !consistent {
        return invalid();
    }
    Ok(SaveOperation {
        operation_id: operation_id.clone(),
        material_id: material_id.clone(),
        reason,
        expected,
        next,
    })
}

/* ------------------------------------------------------------------ */
/* Hashing (`canonicalHashableQuestions`, `practiceContentHash`)       */
/* ------------------------------------------------------------------ */

/// Mirrors the TS `canonicalHashableQuestions`: five content fields, plus
/// `origin` only when present. `identity`, `replaces`, `retired` and
/// `schemaVersion` never join the canonical question hash.
pub fn canonical_hashable_questions(questions: &[AuthoringQuestion]) -> Value {
    Value::Array(
        questions
            .iter()
            .map(|question| {
                let mut map = Map::new();
                map.insert("question".into(), json!(question.question));
                map.insert("options".into(), json!(question.options));
                map.insert("correctIndex".into(), json!(question.correct_index));
                map.insert("explanation".into(), json!(question.explanation));
                map.insert(
                    "sourcePage".into(),
                    question.source_page.map(Value::from).unwrap_or(Value::Null),
                );
                if let Some(origin) = &question.origin {
                    map.insert("origin".into(), json!(origin));
                }
                Value::Object(map)
            })
            .collect(),
    )
}

/// Mirrors the TS `practiceContentHash` — SHA-256 of the canonical JSON,
/// byte-identical to `compute_canonical_content_hash` for five-field sets.
pub fn practice_content_hash(questions: &[AuthoringQuestion]) -> String {
    crate::practice_sessions::compute_canonical_hash(&canonical_hashable_questions(questions))
}

/// The TS `\s` set (ES WhiteSpace + LineTerminator + U+FEFF) — deliberately
/// not `char::is_whitespace`: JS keeps U+0085 out and takes U+FEFF in.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\u{000B}' | '\u{000C}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    ) || c == ' '
        || c == '\n'
        || c == '\r'
}

/// Mirrors `normalizedStudyText` in `src/logic/studyAuthoring.ts`:
/// NFKC, lowercase, collapsed Unicode whitespace, trimmed.
pub fn normalized_study_text(text: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let lowered = text.nfkc().collect::<String>().to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut in_run = false;
    for c in lowered.chars() {
        if is_js_whitespace(c) {
            in_run = true;
            continue;
        }
        if in_run && !out.is_empty() {
            out.push(' ');
        }
        in_run = false;
        out.push(c);
    }
    out
}

/// Whether the character continues a `\p{L}\p{N}\p{M}` word run. Combining
/// marks are recognized through their canonical combining class (Mn/Me);
/// the NFKC-folded, lowercased study text never contains spacing (Mc) marks.
fn is_word_continue(c: char) -> bool {
    c.is_alphabetic()
        || c.is_numeric()
        || unicode_normalization::char::canonical_combining_class(c) != 0
}

/// Mirrors `retirementTerms` in `src/logic/studyAuthoring.ts`: first 64
/// distinct normalized words in Unicode-scalar order.
pub fn retirement_terms(fields: &[String]) -> Vec<String> {
    let joined = fields
        .iter()
        .map(|field| normalized_study_text(field))
        .collect::<Vec<_>>()
        .join(" ");
    let chars: Vec<char> = joined.chars().collect();
    let mut words: Vec<String> = Vec::new();
    let mut index = 0usize;
    while index < chars.len() {
        let c = chars[index];
        if !(c.is_alphabetic() || c.is_numeric()) {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < chars.len() && is_word_continue(chars[index]) {
            index += 1;
        }
        let word: String = chars[start..index].iter().collect();
        if !words.contains(&word) {
            words.push(word);
        }
    }
    words.sort_by(|a, b| a.chars().cmp(b.chars()));
    words.truncate(MAX_RETIREMENT_TERMS);
    words
}

/// Mirrors the TS `practiceRetirementFields`.
pub fn practice_retirement_fields(question: &AuthoringQuestion) -> Vec<String> {
    let mut fields = Vec::with_capacity(question.options.len() + 3);
    fields.push(question.question.clone());
    fields.extend(question.options.iter().cloned());
    fields.push(format!("answer:{}", question.correct_index));
    fields.push(question.explanation.clone());
    fields
}

/// Mirrors the TS `practiceRetirementRecord` — the exact fingerprint one
/// wording produces for a `deleted` or `corrected` ledger entry.
pub fn practice_retirement_record(question: &AuthoringQuestion, reason: &str) -> RetirementRecord {
    let fields = practice_retirement_fields(question);
    let normalized: Vec<String> = fields.iter().map(|f| normalized_study_text(f)).collect();
    RetirementRecord {
        kind: "question".to_string(),
        item_id: question.identity.clone(),
        reason: reason.to_string(),
        text_key: sha256_hex(
            &Value::Array(
                normalized
                    .into_iter()
                    .map(Value::String)
                    .collect::<Vec<_>>(),
            )
            .to_string(),
        ),
        terms: retirement_terms(&fields),
    }
}

/// Mirrors the TS `appendPracticeRetirements`: exact repeats deduplicate,
/// the whole growth beyond the 2,000-entry bound refuses; nothing is ever
/// evicted or altered. Ported with the contract; the native save stores the
/// ledger the operation carries, so its first production consumer is the
/// r7 backup/startup twin — until then it is reachable only from tests.
#[cfg(test)]
pub fn append_practice_retirements(
    existing: &[RetirementRecord],
    incoming: &[RetirementRecord],
) -> Check<Vec<RetirementRecord>> {
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<RetirementRecord> = Vec::new();
    for entry in existing.iter().chain(incoming) {
        let key = entry_json(entry);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(entry.clone());
    }
    if out.len() > MAX_RETIRED_ITEMS {
        return Err(PracticeAuthoringErrorCode::RetirementLimit);
    }
    Ok(out)
}

/// Mirrors the TS `allowsOriginTransition`: promotion only, never a
/// downgrade or a silent drop.
pub fn allows_origin_transition(before: Option<&str>, after: Option<&str>) -> bool {
    match before {
        None => true,
        Some("user") => matches!(after, Some("user") | Some("instructor")),
        Some(_) => after == Some("instructor"),
    }
}

/* ------------------------------------------------------------------ */
/* Canonical shapes back to JSON                                       */
/* ------------------------------------------------------------------ */

/// Mirrors the TS `entryJson` key — one retirement record, compared
/// byte-identically (terms included).
pub fn entry_json(entry: &RetirementRecord) -> String {
    json!([
        entry.kind,
        entry.item_id,
        entry.reason,
        entry.text_key,
        entry.terms
    ])
    .to_string()
}

/// The decoded retirement record as stored JSON (TS keeps the decode order;
/// `canonical_json` sorts, and `retired_json` is only ever re-parsed).
pub fn retirement_record_value(entry: &RetirementRecord) -> Value {
    json!({
        "kind": entry.kind,
        "itemId": entry.item_id,
        "reason": entry.reason,
        "textKey": entry.text_key,
        "terms": entry.terms,
    })
}

/// The decoded question as stored JSON.
pub fn question_value(question: &AuthoringQuestion) -> Value {
    let mut map = Map::new();
    map.insert("question".into(), json!(question.question));
    map.insert("options".into(), json!(question.options));
    map.insert("correctIndex".into(), json!(question.correct_index));
    map.insert("explanation".into(), json!(question.explanation));
    map.insert(
        "sourcePage".into(),
        question.source_page.map(Value::from).unwrap_or(Value::Null),
    );
    map.insert("identity".into(), json!(question.identity));
    if let Some(origin) = &question.origin {
        map.insert("origin".into(), json!(origin));
    }
    if let Some(replaces) = &question.replaces {
        map.insert("replaces".into(), json!(replaces));
    }
    Value::Object(map)
}

fn retired_value(entries: &[RetirementRecord]) -> Value {
    Value::Array(entries.iter().map(retirement_record_value).collect())
}

fn questions_value(questions: &[AuthoringQuestion]) -> Value {
    Value::Array(questions.iter().map(question_value).collect())
}

/// Mirrors the TS `decodePracticeSnapshot` output shape.
pub fn snapshot_value(snapshot: &Snapshot) -> Value {
    json!({
        "schemaVersion": 1,
        "versionId": snapshot.version_id,
        "versionNumber": snapshot.version_number,
        "title": snapshot.title,
        "provider": snapshot.provider,
        "model": snapshot.model,
        "savedAt": snapshot.saved_at,
        "questions": questions_value(&snapshot.questions),
        "retired": retired_value(&snapshot.retired),
    })
}

/// Mirrors the TS `decodePracticeNext` output shape.
pub fn next_value(next: &PracticeNext) -> Value {
    json!({
        "title": next.title,
        "provider": next.provider,
        "model": next.model,
        "questions": questions_value(&next.questions),
        "retired": retired_value(&next.retired),
    })
}

/// Mirrors the TS `decodePracticeOperation` output shape.
pub fn operation_value(operation: &SaveOperation) -> Value {
    json!({
        "operationId": operation.operation_id,
        "sourceMaterialId": operation.material_id,
        "reason": operation.reason.as_str(),
        "expected": operation.expected.as_ref().map(snapshot_value).unwrap_or(Value::Null),
        "next": operation.next.as_ref().map(next_value).unwrap_or(Value::Null),
    })
}

/* ------------------------------------------------------------------ */
/* Snapshot assembly from stored rows (`buildSnapshotFromRows` …)      */
/* ------------------------------------------------------------------ */

use rusqlite::{params, Connection, OptionalExtension};

/// The version columns of `SnapshotSourceRows.version`.
struct VersionFields {
    id: String,
    version_number: i64,
    title: String,
    provider: String,
    model: Option<String>,
    created_at: String,
}

/// The item columns of one `SnapshotSourceRows.items` entry.
struct ItemFields {
    id: String,
    question_text: String,
    options_json: String,
    correct_index: i64,
    explanation: Option<String>,
    source_page: Option<i64>,
    logical_id: Option<String>,
    replaces_id: Option<String>,
    origin: Option<String>,
}

/// Mirrors the TS `SnapshotSourceRows`.
pub struct SnapshotSourceRows {
    version: VersionFields,
    items: Vec<ItemFields>,
    retired_json: Option<String>,
}

fn storage<E: std::fmt::Debug>(_: E) -> PracticeAuthoringErrorCode {
    PracticeAuthoringErrorCode::StorageError
}

/// Mirrors the TS `parseOptions`: a JSON array of strings or nothing.
fn parse_options(raw: &str) -> Check<Vec<String>> {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Array(entries)) => entries
            .iter()
            .map(|entry| match entry {
                Value::String(text) => Ok(text.clone()),
                _ => Err(PracticeAuthoringErrorCode::StorageError),
            })
            .collect(),
        _ => Err(PracticeAuthoringErrorCode::StorageError),
    }
}

/// Mirrors the TS `buildSnapshotFromRows`: the exact snapshot a material's
/// active version currently holds.
pub fn build_snapshot_from_rows(rows: &SnapshotSourceRows) -> Check<Snapshot> {
    let mut questions = Vec::with_capacity(rows.items.len());
    for item in &rows.items {
        let identity = item.logical_id.clone().unwrap_or_else(|| item.id.clone());
        let origin = match item.origin.as_deref() {
            Some("user") | Some("instructor") => item.origin.clone(),
            _ => None,
        };
        let replaces = origin.as_ref().and_then(|_| item.replaces_id.clone());
        questions.push(AuthoringQuestion {
            question: item.question_text.clone(),
            options: parse_options(&item.options_json)?,
            correct_index: item.correct_index,
            explanation: item.explanation.clone().unwrap_or_default(),
            source_page: item.source_page,
            identity,
            origin,
            replaces,
        });
    }
    let retired = match rows
        .retired_json
        .as_deref()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .as_ref()
        .map(decode_retirements)
    {
        Some(Ok(entries)) => entries,
        _ => Vec::new(),
    };
    Ok(Snapshot {
        version_id: rows.version.id.clone(),
        version_number: rows.version.version_number,
        title: rows.version.title.clone(),
        provider: rows.version.provider.clone(),
        model: rows.version.model.clone().unwrap_or_default(),
        saved_at: rows.version.created_at.clone(),
        questions,
        retired,
    })
}

/// The `SNAPSHOT_SELECT` of the TS twin, statement for statement.
const SNAPSHOT_SELECT: &str = "
  SELECT v.id, v.version_number, v.title, v.provider, v.model, v.created_at,
         i.id AS item_id_row, i.ordinal, i.question_text, i.options_json, i.correct_index,
         i.explanation, i.source_page, i.logical_id, i.replaces_id, o.origin
    FROM practice_test_versions v
    JOIN practice_test_items i ON i.version_id = v.id
    LEFT JOIN practice_item_origins o ON o.item_id = i.id
   WHERE v.source_material_id = ?1 AND v.is_active = 1
   ORDER BY i.ordinal ASC";

/// Mirrors the TS `readCurrentSnapshot`: the material's current test exactly
/// as stored, or null when there is none.
pub fn read_current_snapshot(conn: &Connection, material_id: &str) -> Check<Option<Snapshot>> {
    let mut statement = conn.prepare(SNAPSHOT_SELECT).map_err(storage)?;
    let rows = statement
        .query_map(params![material_id], |row| {
            Ok((
                VersionFields {
                    id: row.get(0)?,
                    version_number: row.get(1)?,
                    title: row.get(2)?,
                    provider: row.get(3)?,
                    model: row.get(4)?,
                    created_at: row.get(5)?,
                },
                ItemFields {
                    id: row.get(6)?,
                    question_text: row.get(8)?,
                    options_json: row.get(9)?,
                    correct_index: row.get(10)?,
                    explanation: row.get(11)?,
                    source_page: row.get(12)?,
                    logical_id: row.get(13)?,
                    replaces_id: row.get(14)?,
                    origin: row.get(15)?,
                },
            ))
        })
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    let Some(first_version) = rows.first().map(|(version, _)| VersionFields {
        id: version.id.clone(),
        version_number: version.version_number,
        title: version.title.clone(),
        provider: version.provider.clone(),
        model: version.model.clone(),
        created_at: version.created_at.clone(),
    }) else {
        return Ok(None);
    };
    let items = rows.into_iter().map(|(_, item)| item).collect();
    let retired_json: Option<Option<String>> = conn
        .query_row(
            "SELECT retired_json FROM practice_tests WHERE source_material_id = ?1",
            params![material_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?;
    Ok(Some(build_snapshot_from_rows(&SnapshotSourceRows {
        version: first_version,
        items,
        retired_json: retired_json.flatten(),
    })?))
}

/// Mirrors the TS `snapshotFromHistoryRow`: a stored history row for a
/// material, or None when that entry is damaged (`previous_json` in text).
pub fn snapshot_from_history_row(previous_json: &str) -> Option<Snapshot> {
    serde_json::from_str::<Value>(previous_json)
        .ok()
        .and_then(|parsed| decode_practice_snapshot(&parsed).ok())
}

/// Mirrors the TS `decodePracticeRetirements` (strict stored-list decode).
pub fn decode_practice_retirements(value: &Value) -> Check<Vec<RetirementRecord>> {
    decode_retirements(value)
}

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

use std::path::Path;
use std::time::Duration;

use rusqlite::{Transaction, TransactionBehavior};
use tauri::AppHandle;

use crate::practice_sessions::{
    canonical_json, compute_canonical_hash, db_now_iso, generate_uuid_v4,
};

/// The result of a save: `saved`, or the receipt's `already_saved`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SaveResult {
    pub status: &'static str,
}

/// Mirrors the TS `sameSnapshot`.
fn same_snapshot(current: Option<&Snapshot>, expected: Option<&Snapshot>) -> bool {
    let left = current.map(snapshot_value).unwrap_or(Value::Null);
    let right = expected.map(snapshot_value).unwrap_or(Value::Null);
    canonical_json(&left) == canonical_json(&right)
}

/// Mirrors the TS `applyOperation`: every guard fires before any write; a
/// rusqlite failure surfaces as `STORAGE_ERROR` and rolls the transaction
/// back whole.
pub fn apply_operation(
    tx: &Transaction,
    operation: &SaveOperation,
    payload_json: &str,
    payload_hash: &str,
    now: &str,
) -> Check<SaveResult> {
    let material: Option<Option<String>> = tx
        .query_row(
            "SELECT title FROM study_materials WHERE id = ?1",
            params![&operation.material_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?;
    let material_title = match material {
        None => return Err(PracticeAuthoringErrorCode::NotFound),
        Some(title) => title,
    };

    // Retries: the receipt lookup is first. An exact match returns
    // already_saved even after later operations; any mismatch is CONFLICT.
    let receipt: Option<(String, String, String, String, String)> = tx
        .query_row(
            "SELECT material_id, action, payload_json, payload_hash, result_json FROM practice_save_operations WHERE operation_id = ?1",
            params![&operation.operation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(storage)?;
    if let Some((material_id, action, stored_json, stored_hash, result_json)) = receipt {
        if material_id != operation.material_id
            || action != operation.reason.as_str()
            || stored_json != payload_json
            || stored_hash != payload_hash
        {
            return Err(PracticeAuthoringErrorCode::Conflict);
        }
        let stored: Value = match serde_json::from_str(&result_json) {
            Ok(stored) => stored,
            Err(_) => return Err(PracticeAuthoringErrorCode::Conflict),
        };
        if stored.get("status").and_then(Value::as_str) != Some("saved") {
            return Err(PracticeAuthoringErrorCode::Conflict);
        }
        return Ok(SaveResult {
            status: "already_saved",
        });
    }

    let current = read_current_snapshot(tx, &operation.material_id)?;
    if !same_snapshot(current.as_ref(), operation.expected.as_ref()) {
        return Err(PracticeAuthoringErrorCode::StaleContent);
    }
    if let Some(next) = &operation.next {
        enforce_stored_lineage(
            tx,
            &operation.material_id,
            operation.expected.as_ref(),
            next,
        )?;
    }
    // Restoring an absent current test needs no history row for that absent
    // state, but the preserved snapshots still hold this material's whole
    // retirement ledger and every record they hold must travel with the
    // restore (the TS union check).
    if operation.reason == Reason::Restore && current.is_none() && operation.next.is_some() {
        let mut required: Vec<String> = Vec::new();
        for previous_json in preserved_history(tx, &operation.material_id, false)? {
            let Some(snapshot) = snapshot_from_history_row(&previous_json) else {
                continue; // a damaged envelope proves nothing
            };
            for entry in &snapshot.retired {
                let key = entry_json(entry);
                if !required.contains(&key) {
                    required.push(key);
                }
            }
        }
        let next = operation
            .next
            .as_ref()
            .ok_or(PracticeAuthoringErrorCode::StorageError)?;
        let offered: Vec<String> = next.retired.iter().map(entry_json).collect();
        for key in &required {
            if !offered.contains(key) {
                return invalid();
            }
        }
    }

    let in_progress: i64 = tx
        .query_row(
            "SELECT COUNT(*) AS n FROM practice_attempts WHERE source_material_id = ?1 AND status = 'in_progress'",
            params![&operation.material_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    let has_in_progress = in_progress > 0;

    if operation.reason == Reason::Remove {
        if let Some(current) = &current {
            // The delete history row is written only when a current test exists.
            let history_id = generate_uuid_v4(tx).map_err(storage)?;
            tx.execute(
                "INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
                 VALUES (?1, ?2, 'practice', 'delete', ?3, ?4, ?5)",
                params![
                    history_id,
                    operation.material_id,
                    canonical_json(&snapshot_value(current)),
                    current.provider,
                    now
                ],
            )
            .map_err(storage)?;
        }
        tx.execute(
            "UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ?1 AND is_active = 1",
            params![&operation.material_id],
        )
        .map_err(storage)?;
        tx.execute(
            "UPDATE practice_session_operations SET is_erased = 1, result_json = 'null'
             WHERE attempt_id IN (SELECT id FROM practice_attempts WHERE source_material_id = ?1 AND status IN ('in_progress', 'abandoned'))",
            params![&operation.material_id],
        )
        .map_err(storage)?;
        tx.execute(
            "DELETE FROM practice_attempts WHERE source_material_id = ?1 AND status IN ('in_progress', 'abandoned')",
            params![&operation.material_id],
        )
        .map_err(storage)?;
        tx.execute(
            "DELETE FROM practice_test_versions
              WHERE source_material_id = ?1
                AND id NOT IN (SELECT DISTINCT version_id FROM practice_attempts WHERE status = 'completed')",
            params![&operation.material_id],
        )
        .map_err(storage)?;
        tx.execute(
            "DELETE FROM practice_tests WHERE source_material_id = ?1",
            params![&operation.material_id],
        )
        .map_err(storage)?;
        tx.execute(
            "INSERT INTO practice_save_operations (operation_id, material_id, action, payload_json, payload_hash, result_json, applied_at)
             VALUES (?1, ?2, 'remove', ?3, ?4, ?5, ?6)",
            params![
                operation.operation_id,
                operation.material_id,
                payload_json,
                payload_hash,
                json!({ "status": "saved" }).to_string(),
                now
            ],
        )
        .map_err(storage)?;
        return Ok(SaveResult { status: "saved" });
    }

    // The decoder's consistency rule makes this unreachable for a non-remove
    // reason; TS's `operation.next!` would crash there and surface the same
    // `STORAGE_ERROR` through the transaction catch.
    let next = operation
        .next
        .as_ref()
        .ok_or(PracticeAuthoringErrorCode::StorageError)?;
    if operation.reason != Reason::Regenerate && has_in_progress {
        return Err(PracticeAuthoringErrorCode::AttemptActive);
    }

    // A logical identity belongs to exactly one material that still lives.
    enforce_foreign_ownership(tx, &operation.material_id, next)?;

    let version_id = generate_uuid_v4(tx).map_err(storage)?;
    let next_ver = next_version_number(tx, &operation.material_id)?;
    let content_hash = practice_content_hash(&next.questions);

    tx.execute(
        "INSERT INTO practice_save_operations (operation_id, material_id, action, payload_json, payload_hash, result_json, applied_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            operation.operation_id,
            operation.material_id,
            operation.reason.as_str(),
            payload_json,
            payload_hash,
            json!({ "status": "saved", "versionId": version_id }).to_string(),
            now
        ],
    )
    .map_err(storage)?;
    if let Some(current) = &current {
        tx.execute(
            "INSERT INTO study_set_history (id, material_id, kind, reason, previous_json, provider, created_at)
             VALUES (?1, ?2, 'practice', ?3, ?4, ?5, ?6)",
            params![
                generate_uuid_v4(tx).map_err(storage)?,
                operation.material_id,
                operation.reason.history(),
                canonical_json(&snapshot_value(current)),
                current.provider,
                now
            ],
        )
        .map_err(storage)?;
    }
    if operation.reason == Reason::Regenerate && has_in_progress {
        // The approved plain-provider behavior: replacing the test
        // deliberately abandons the attempt in progress against the old one.
        tx.execute(
            "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?1, revision = revision + 1 WHERE source_material_id = ?2 AND status = 'in_progress'",
            params![now, &operation.material_id],
        )
        .map_err(storage)?;
    }
    // Every replacement deactivates the version it replaces; the partial
    // unique index allows exactly one active version per material.
    tx.execute(
        "UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ?1 AND is_active = 1",
        params![&operation.material_id],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO practice_test_versions (
           id, source_material_id, history_key, source_material_title,
           version_number, provider, model, title, content_hash, created_at, is_active
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1)",
        params![
            version_id,
            operation.material_id,
            operation.material_id,
            material_title.unwrap_or_else(|| next.title.clone()),
            next_ver,
            next.provider,
            next.model,
            next.title,
            content_hash,
            now
        ],
    )
    .map_err(storage)?;
    for (index, question) in next.questions.iter().enumerate() {
        let item_id = generate_uuid_v4(tx).map_err(storage)?;
        tx.execute(
            "INSERT INTO practice_test_items (
               id, version_id, ordinal, question_text, options_json,
               correct_index, explanation, source_page, logical_id, replaces_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                item_id,
                version_id,
                index as i64,
                question.question,
                json!(question.options).to_string(),
                question.correct_index,
                question.explanation,
                question.source_page,
                question.identity,
                question.replaces
            ],
        )
        .map_err(storage)?;
        if let Some(origin) = &question.origin {
            tx.execute(
                "INSERT INTO practice_item_origins (item_id, origin) VALUES (?1, ?2)",
                params![item_id, origin],
            )
            .map_err(storage)?;
        }
    }
    let mirror_generated_at: Option<Option<String>> = tx
        .query_row(
            "SELECT generated_at FROM practice_tests WHERE source_material_id = ?1",
            params![&operation.material_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?;
    let generated_at = match (&mirror_generated_at, operation.reason.renews_generated_at()) {
        (Some(Some(previous)), false) => previous.clone(),
        _ => now.to_string(),
    };
    let legacy_questions: Vec<Value> = next
        .questions
        .iter()
        .map(|question| {
            json!({
                "question": question.question,
                "options": question.options,
                "correctIndex": question.correct_index,
                "explanation": question.explanation,
                "sourcePage": question.source_page,
            })
        })
        .collect();
    tx.execute(
        "INSERT INTO practice_tests (
           source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error, retired_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)
         ON CONFLICT(source_material_id) DO UPDATE SET
           title = excluded.title,
           questions_json = excluded.questions_json,
           provider = excluded.provider,
           model = excluded.model,
           generated_at = excluded.generated_at,
           updated_at = excluded.updated_at,
           legacy_migrated_at = excluded.legacy_migrated_at,
           legacy_error = NULL,
           retired_json = excluded.retired_json",
        params![
            operation.material_id,
            next.title,
            Value::Array(legacy_questions).to_string(),
            next.provider,
            next.model,
            generated_at,
            now,
            now,
            retired_value(&next.retired).to_string()
        ],
    )
    .map_err(storage)?;
    Ok(SaveResult { status: "saved" })
}

/// Mirrors the TS `executePracticeAuthoring`: validate, then save in one
/// immediate transaction. Any statement failure rolls the whole operation
/// back — receipt, history, version, items, origins, mirror and attempt
/// changes alike — and surfaces as `STORAGE_ERROR`.
pub fn execute_practice_authoring(
    conn: &mut Connection,
    input: &Value,
) -> Result<SaveResult, PracticeAuthoringErrorWire> {
    let operation = decode_practice_operation(input).map_err(PracticeAuthoringErrorCode::error)?;
    if let (Some(expected), Some(next)) = (&operation.expected, &operation.next) {
        validate_protection(expected, next, operation.reason)
            .map_err(PracticeAuthoringErrorCode::error)?;
    }
    let payload = operation_value(&operation);
    let payload_json = canonical_json(&payload);
    let payload_hash = compute_canonical_hash(&payload);
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    let now = db_now_iso(&tx).map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    let result = apply_operation(&tx, &operation, &payload_json, &payload_hash, &now)
        .map_err(PracticeAuthoringErrorCode::error)?;
    tx.commit()
        .map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    Ok(result)
}

/// Open the app database and run one authoring save in an immediate
/// transaction, exactly as the study-set twin of 03a does.
pub fn save_practice_authoring_at(
    root: &Path,
    operation: &Value,
) -> Result<SaveResult, PracticeAuthoringErrorWire> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(PracticeAuthoringErrorCode::StorageError.error());
    }
    let mut conn =
        Connection::open(&db_path).map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    execute_practice_authoring(&mut conn, operation)
}

#[tauri::command]
pub async fn save_practice_authoring_atomically(
    app: AppHandle,
    operation: Value,
) -> Result<SaveResult, PracticeAuthoringErrorWire> {
    let root = crate::storage::app_root(&app)
        .map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?;
    tauri::async_runtime::spawn_blocking(move || save_practice_authoring_at(&root, &operation))
        .await
        .map_err(|_| PracticeAuthoringErrorCode::StorageError.error())?
}

/* ------------------------------------------------------------------ */
/* The guards (`validateProtection`, `enforceStoredLineage`, …)        */
/* ------------------------------------------------------------------ */

/// Mirrors the TS `validateProtection`: the protection rules provable from
/// the two snapshots alone, refused before any transaction begins.
pub fn validate_protection(expected: &Snapshot, next: &PracticeNext, reason: Reason) -> Check<()> {
    let next_by_identity: Vec<(&String, &AuthoringQuestion)> = next
        .questions
        .iter()
        .map(|question| (&question.identity, question))
        .collect();
    let expected_by_identity: Vec<(&String, &AuthoringQuestion)> = expected
        .questions
        .iter()
        .map(|question| (&question.identity, question))
        .collect();
    let retired_ids: Vec<&String> = expected
        .retired
        .iter()
        .map(|entry| &entry.item_id)
        .collect();
    let next_entries: Vec<String> = next.retired.iter().map(entry_json).collect();

    let has_exact_record = |before: &AuthoringQuestion, record_reason: &str| -> bool {
        let computed = practice_retirement_record(before, record_reason);
        next_entries.contains(&entry_json(&computed))
    };

    for entry in &expected.retired {
        if !next_entries.contains(&entry_json(entry)) {
            return invalid();
        }
    }

    for before in &expected.questions {
        let after = next_by_identity
            .iter()
            .find(|(identity, _)| *identity == &before.identity)
            .map(|(_, question)| *question);
        let Some(after) = after else {
            let needs_record = matches!(reason, Reason::Edit | Reason::Correct)
                || (reason == Reason::Regenerate && before.origin.is_some());
            if needs_record {
                let replaced = next
                    .questions
                    .iter()
                    .any(|question| question.replaces.as_deref() == Some(before.identity.as_str()));
                if !has_exact_record(before, if replaced { "corrected" } else { "deleted" }) {
                    return invalid();
                }
            }
            continue;
        };
        if !allows_origin_transition(before.origin.as_deref(), after.origin.as_deref()) {
            return invalid();
        }
        if matches!(reason, Reason::Edit | Reason::Correct) {
            let old_record = practice_retirement_record(before, "corrected");
            let new_record = practice_retirement_record(after, "corrected");
            if old_record.text_key != new_record.text_key || old_record.terms != new_record.terms {
                // Her wording changed, so the exact earlier wording must be retired.
                if !has_exact_record(before, "corrected") {
                    return invalid();
                }
            }
        }
    }

    let origin_in_snapshot = |identity: &str| -> (bool, Option<String>) {
        if let Some((_, question)) = expected_by_identity
            .iter()
            .find(|(id, _)| id.as_str() == identity)
        {
            return (true, question.origin.clone());
        }
        if let Some((_, question)) = next_by_identity
            .iter()
            .find(|(id, _)| id.as_str() == identity)
        {
            return (true, question.origin.clone());
        }
        if retired_ids.iter().any(|id| id.as_str() == identity) {
            return (true, None);
        }
        (false, None)
    };
    for question in &next.questions {
        let mut target = question.replaces.clone();
        let mut seen: Vec<String> = vec![question.identity.clone()];
        while let Some(current) = target {
            if seen.contains(&current) {
                return invalid();
            }
            seen.push(current.clone());
            let (known, found_origin) = origin_in_snapshot(&current);
            if !known {
                if matches!(reason, Reason::Edit | Reason::Correct | Reason::Create) {
                    return invalid();
                }
                break;
            }
            if let Some(found_origin) = found_origin {
                if !allows_origin_transition(
                    Some(found_origin.as_str()),
                    question.origin.as_deref(),
                ) {
                    return invalid();
                }
                break;
            }
            target = next_by_identity
                .iter()
                .find(|(id, _)| id.as_str() == current.as_str())
                .and_then(|(_, question)| question.replaces.clone());
        }
    }
    Ok(())
}

/// One provenance label dominating the other: instructor dominates user,
/// user dominates no record (`strongest` in the TS twin).
fn strongest_origin(a: Option<&str>, b: Option<&str>) -> Option<String> {
    if a == Some("instructor") || b == Some("instructor") {
        Some("instructor".to_string())
    } else if a == Some("user") || b == Some("user") {
        Some("user".to_string())
    } else {
        None
    }
}

/// The material's preserved authoring snapshots, newest label order first —
/// the `previous_json` texts of its `study_set_history` rows.
fn preserved_history(
    conn: &Connection,
    material_id: &str,
    order_by_recency: bool,
) -> Check<Vec<String>> {
    let sql = if order_by_recency {
        "SELECT previous_json FROM study_set_history
          WHERE material_id = ?1 AND kind = 'practice'
          ORDER BY created_at DESC, id DESC"
    } else {
        "SELECT previous_json FROM study_set_history WHERE material_id = ?1 AND kind = 'practice'"
    };
    let mut statement = conn.prepare(sql).map_err(storage)?;
    let rows = statement
        .query_map(params![material_id], |row| row.get::<_, String>(0))
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    Ok(rows)
}

/// Mirrors the TS `enforceStoredLineage`: the authoritative lineage check
/// inside the transaction, resolved against the material's whole preserved
/// authoring history.
pub fn enforce_stored_lineage(
    conn: &Connection,
    material_id: &str,
    expected: Option<&Snapshot>,
    next: &PracticeNext,
) -> Check<()> {
    let rows = preserved_history(conn, material_id, true)?;
    // Provenance is monotone across every preserved snapshot, so wall-clock
    // ties and random row ids can never pick a weaker label over a stronger
    // one: fold every identity through `strongest_origin`.
    let mut history_origin: Vec<(String, Option<String>)> = Vec::new();
    for previous_json in &rows {
        let Some(snapshot) = snapshot_from_history_row(previous_json) else {
            continue; // a damaged envelope is refused at startup by the schema-17 validator
        };
        for question in &snapshot.questions {
            match history_origin
                .iter_mut()
                .find(|(identity, _)| identity == &question.identity)
            {
                Some((_, origin)) => {
                    *origin = strongest_origin(origin.as_deref(), question.origin.as_deref());
                }
                None => history_origin.push((question.identity.clone(), question.origin.clone())),
            }
        }
    }
    let expected_questions: Vec<&AuthoringQuestion> = expected
        .map(|s| s.questions.iter().collect())
        .unwrap_or_default();
    let next_by_identity: Vec<(&String, &AuthoringQuestion)> =
        next.questions.iter().map(|q| (&q.identity, q)).collect();
    let retired_ids: Vec<&String> = expected
        .map(|s| s.retired.iter().map(|e| &e.item_id).collect())
        .unwrap_or_default();

    let origin_of_identity = |identity: &str| -> (bool, Option<String>) {
        if let Some(question) = expected_questions
            .iter()
            .find(|q| q.identity == identity)
            .copied()
        {
            return (true, question.origin.clone());
        }
        if let Some((_, origin)) = history_origin.iter().find(|(id, _)| id == identity) {
            return (true, origin.clone());
        }
        if let Some((_, question)) = next_by_identity
            .iter()
            .find(|(id, _)| id.as_str() == identity)
        {
            return (true, question.origin.clone());
        }
        if retired_ids.iter().any(|id| id.as_str() == identity) {
            return (true, None);
        }
        (false, None)
    };
    for question in &next.questions {
        let mut target = question.replaces.clone();
        let mut seen: Vec<String> = vec![question.identity.clone()];
        while let Some(current) = target {
            if seen.contains(&current) {
                return invalid();
            }
            seen.push(current.clone());
            let (known, found_origin) = origin_of_identity(&current);
            if !known {
                return invalid();
            }
            if let Some(found_origin) = found_origin {
                if !allows_origin_transition(
                    Some(found_origin.as_str()),
                    question.origin.as_deref(),
                ) {
                    return invalid();
                }
                break;
            }
            target = next_by_identity
                .iter()
                .find(|(id, _)| id.as_str() == current.as_str())
                .and_then(|(_, question)| question.replaces.clone());
        }
        // A re-added identity (restore, recreate) follows the accepted
        // monotone transition rule over its strongest recorded provenance.
        let in_expected = expected_questions
            .iter()
            .any(|q| q.identity == question.identity);
        if !in_expected {
            if let Some((_, recorded)) = history_origin
                .iter()
                .find(|(identity, _)| identity == &question.identity)
            {
                if !allows_origin_transition(recorded.as_deref(), question.origin.as_deref()) {
                    return invalid();
                }
            }
        }
    }
    Ok(())
}

/// Mirrors the TS `claimedIdentities`: the incoming logical identities plus
/// the replacement targets they name.
pub fn claimed_identities(next: &PracticeNext) -> Vec<String> {
    let mut claims: Vec<String> = Vec::new();
    for question in &next.questions {
        if !claims.contains(&question.identity) {
            claims.push(question.identity.clone());
        }
        if let Some(replaces) = &question.replaces {
            if !claims.contains(replaces) {
                claims.push(replaces.clone());
            }
        }
    }
    claims
}

/// Mirrors the TS `tokenPatterns`: quoted-token patterns, so a claim only
/// ever matches its own JSON string value.
fn token_patterns(claims: &[String]) -> Vec<String> {
    claims.iter().map(|id| format!("%\"{id}\"%")).collect()
}

/// Mirrors the TS `nextVersionNumber`: server-owned version numbers never
/// go backwards — the highest number this material ever owned, over every
/// surviving row and every preserved snapshot.
pub fn next_version_number(conn: &Connection, material_id: &str) -> Check<i64> {
    let highest: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) AS highest FROM practice_test_versions
              WHERE source_material_id = ?1 OR history_key = ?2",
            params![material_id, material_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    let mut highest = highest;
    for previous_json in preserved_history(conn, material_id, false)? {
        if let Some(snapshot) = snapshot_from_history_row(&previous_json) {
            if snapshot.version_number > highest {
                highest = snapshot.version_number;
            }
        }
    }
    Ok(highest + 1)
}

/// Mirrors the TS `enforceForeignOwnership`: a logical identity belongs to
/// exactly one material that still lives, resolved across that material's
/// current and inactive rows, detached history-group rows, preserved
/// snapshots and retirement ledgers.
pub fn enforce_foreign_ownership(
    conn: &Connection,
    material_id: &str,
    next: &PracticeNext,
) -> Check<()> {
    let claims = claimed_identities(next);
    if claims.is_empty() {
        return Ok(());
    }
    let placeholders = claims.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let patterns = token_patterns(&claims);
    let owner = "COALESCE(v.source_material_id, v.history_key)";
    let held: Option<i64> = conn
        .query_row(
            &format!(
                "SELECT 1 FROM practice_test_items i
                   JOIN practice_test_versions v ON v.id = i.version_id
                  WHERE COALESCE(i.logical_id, i.id) IN ({placeholders})
                    AND {owner} != ?
                    AND EXISTS (SELECT 1 FROM study_materials m WHERE m.id = {owner})
                  LIMIT 1"
            ),
            rusqlite::params_from_iter(
                claims
                    .iter()
                    .chain(std::iter::once(&material_id.to_string())),
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?;
    if held.is_some() {
        return invalid();
    }

    let like_clauses = patterns
        .iter()
        .map(|_| "previous_json LIKE ?")
        .collect::<Vec<_>>()
        .join(" OR ");
    let preserved_sql = format!(
        "SELECT previous_json FROM study_set_history
          WHERE kind = 'practice' AND material_id != ?
            AND EXISTS (SELECT 1 FROM study_materials m WHERE m.id = study_set_history.material_id)
            AND ({like_clauses})"
    );
    let mut statement = conn.prepare(&preserved_sql).map_err(storage)?;
    let preserved = statement
        .query_map(
            rusqlite::params_from_iter(
                std::iter::once(&material_id.to_string()).chain(patterns.iter()),
            ),
            |row| row.get::<_, String>(0),
        )
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    drop(statement);
    let claim_set: Vec<&String> = claims.iter().collect();
    for previous_json in &preserved {
        let Some(snapshot) = snapshot_from_history_row(previous_json) else {
            continue; // damaged envelopes prove nothing
        };
        let named = snapshot.questions.iter().any(|question| {
            claim_set.iter().any(|claim| **claim == question.identity)
                || question
                    .replaces
                    .as_ref()
                    .is_some_and(|replaces| claim_set.iter().any(|claim| **claim == *replaces))
        });
        let ledger = snapshot
            .retired
            .iter()
            .any(|entry| claim_set.iter().any(|claim| **claim == entry.item_id));
        if named || ledger {
            return invalid();
        }
    }

    let ledger_clauses = patterns
        .iter()
        .map(|_| "retired_json LIKE ?")
        .collect::<Vec<_>>()
        .join(" OR ");
    let ledgers_sql = format!(
        "SELECT retired_json FROM practice_tests
          WHERE source_material_id != ?
            AND EXISTS (SELECT 1 FROM study_materials m WHERE m.id = practice_tests.source_material_id)
            AND ({ledger_clauses})"
    );
    let mut statement = conn.prepare(&ledgers_sql).map_err(storage)?;
    let ledgers = statement
        .query_map(
            rusqlite::params_from_iter(
                std::iter::once(&material_id.to_string()).chain(patterns.iter()),
            ),
            |row| row.get::<_, String>(0),
        )
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    drop(statement);
    for retired_json in &ledgers {
        let Ok(parsed) = serde_json::from_str::<Value>(retired_json) else {
            continue; // a damaged ledger is refused at startup by the schema-17 validator
        };
        let Ok(retired) = decode_practice_retirements(&parsed) else {
            continue;
        };
        if retired
            .iter()
            .any(|entry| claim_set.iter().any(|claim| **claim == entry.item_id))
        {
            return invalid();
        }
    }
    Ok(())
}
