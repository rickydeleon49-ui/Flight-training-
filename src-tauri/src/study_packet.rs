//! Structured study packets (`hfd-study-packet`): the native picker and the
//! atomic save.
//!
//! Slice A (`pick_study_packet`) opens a native dialog for one JSON file, reads
//! it with a hard bound, and returns its text for the TypeScript validator. It
//! never copies a document, creates a directory, touches the database or uses
//! the network. The webview cannot name a path: the user picks it here.
//!
//! Slice B (`save_structured_study_material_atomically`, owner-approved in
//! docs/STRUCTURED_STUDY_IMPORT_SLICE_B_OWNER_APPROVAL_2026-10-04.md) stores a
//! previewed packet as one new material with its imported study set and
//! practice test, in a single transaction. It is offline and create-new only.

use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use unicode_normalization::UnicodeNormalization;

use crate::storage::app_root;

/// The contract's 4 MiB packet limit; the same number as `MAX_TEXT_BYTES`.
pub(crate) const MAX_PACKET_BYTES: u64 = 4 * 1024 * 1024;
/// File names longer than this are shortened before they reach the webview.
const MAX_FILE_NAME_CHARS: usize = 255;

/// What the webview receives. `sha256` covers the original bytes, BOM
/// included; it is for display and is not the persistence content hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedPacket {
    pub file_name: String,
    pub byte_length: u64,
    pub sha256: String,
    pub text: String,
    pub bom_removed: bool,
}

/// Every way reading can fail. Each maps to one fixed code and message that
/// never include file contents or a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketReadError {
    NotRegularFile,
    Empty,
    TooLarge,
    ReadFailed,
    UnsupportedEncoding,
    InvalidUtf8,
}

/// The serialized error: a fixed code and message only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PacketReadFailure {
    pub code: &'static str,
    pub message: &'static str,
}

impl PacketReadError {
    pub fn failure(self) -> PacketReadFailure {
        let (code, message) = match self {
            // A directory, pipe or device is reported like any unreadable file.
            Self::NotRegularFile | Self::ReadFailed => {
                ("file_read_failed", "The file could not be read.")
            }
            Self::Empty => ("file_empty", "The file is empty."),
            Self::TooLarge => (
                "file_too_large",
                "The file is larger than the 4 MiB limit for a study packet.",
            ),
            Self::UnsupportedEncoding => (
                "unsupported_encoding",
                "The file is not UTF-8. Export it again as UTF-8 JSON.",
            ),
            Self::InvalidUtf8 => (
                "invalid_utf8",
                "The file contains bytes that are not valid UTF-8.",
            ),
        };
        PacketReadFailure { code, message }
    }
}

impl From<PacketReadError> for PacketReadFailure {
    fn from(error: PacketReadError) -> Self {
        error.failure()
    }
}

/// Let the user choose one `.json` study packet and read it.
///
/// `Ok(None)` means the dialog was cancelled. The dialog and the read both run
/// on a blocking worker, never on the UI thread.
#[tauri::command]
pub async fn pick_study_packet(app: AppHandle) -> Result<Option<PickedPacket>, PacketReadFailure> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(choice) = app
            .dialog()
            .file()
            .set_title("Choose a study packet")
            .add_filter("Study packet", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = choice
            .into_path()
            .map_err(|_| PacketReadError::ReadFailed)?;
        read_packet_file(&path).map(Some)
    })
    .await
    .map_err(|_| PacketReadError::ReadFailed.failure())?
    .map_err(PacketReadFailure::from)
}

/// Read a packet from a path the user selected.
///
/// The path is checked to be a regular file *before* opening, so a named pipe
/// cannot block the open, and the opened handle is checked again.
pub(crate) fn read_packet_file(path: &Path) -> Result<PickedPacket, PacketReadError> {
    let metadata = std::fs::metadata(path).map_err(|_| PacketReadError::ReadFailed)?;
    if !metadata.is_file() {
        return Err(PacketReadError::NotRegularFile);
    }
    let file = File::open(path).map_err(|_| PacketReadError::ReadFailed)?;
    let opened = file.metadata().map_err(|_| PacketReadError::ReadFailed)?;
    if !opened.is_file() {
        return Err(PacketReadError::NotRegularFile);
    }
    let bytes = read_bounded(file, opened.len(), MAX_PACKET_BYTES)?;
    decode_packet(display_name(path), bytes)
}

/// The size seen before reading is checked first; then at most `limit + 1`
/// bytes are read, so a file that grows after that check is still refused.
pub(crate) fn read_bounded<R: Read>(
    reader: R,
    observed_len: u64,
    limit: u64,
) -> Result<Vec<u8>, PacketReadError> {
    if observed_len > limit {
        return Err(PacketReadError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(observed_len.min(limit) as usize);
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PacketReadError::ReadFailed)?;
    if bytes.len() as u64 > limit {
        return Err(PacketReadError::TooLarge);
    }
    Ok(bytes)
}

/// Original bytes to the returned packet: hash first, then encoding checks.
pub(crate) fn decode_packet(
    file_name: String,
    bytes: Vec<u8>,
) -> Result<PickedPacket, PacketReadError> {
    if bytes.is_empty() {
        return Err(PacketReadError::Empty);
    }
    if bytes.starts_with(&[0xfe, 0xff]) || bytes.starts_with(&[0xff, 0xfe]) {
        return Err(PacketReadError::UnsupportedEncoding);
    }
    let sha256 = hex(&Sha256::digest(&bytes));
    let byte_length = bytes.len() as u64;
    let bom_removed = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let body = if bom_removed { &bytes[3..] } else { &bytes[..] };
    let text = std::str::from_utf8(body).map_err(|_| PacketReadError::InvalidUtf8)?;
    if text.is_empty() {
        return Err(PacketReadError::Empty);
    }
    Ok(PickedPacket {
        file_name,
        byte_length,
        sha256,
        text: text.to_string(),
        bom_removed,
    })
}

/// The last path component only, never the directory.
fn display_name(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name: String = name.chars().take(MAX_FILE_NAME_CHARS).collect();
    if name.is_empty() {
        "study-packet.json".to_string()
    } else {
        name
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Slice B: one atomic save of a validated, previewed packet.
// ---------------------------------------------------------------------------
//
// The webview sends the operation built from the accepted validator's
// persistence payload. It is taken as untyped JSON so that a malformed value
// fails here, in application code, with one fixed code and message, instead
// of inside Tauri's argument decoding, whose messages echo unknown key names.
// Nothing below ever returns a key name, payload text or database error.
//
// Validation mirrors the normative table in
// docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md §4.3 and the
// browser transaction in src/data/structuredImportTransaction.ts. Strings are
// normalized with the validator's line and block rules (CR/CRLF to LF,
// whitespace as JavaScript's `\s` defines it) before code points are counted.
// Unicode NFC composition is applied consistently to line and block fields
// before bounds, duplicate choice detection, title equality, stored content
// and idempotent retries, matching the approved TypeScript validator.

/// Successful outcomes. `already_saved` is a retry whose stored content matched.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum NativeImportSaveResult {
    Saved {
        #[serde(rename = "materialId")]
        material_id: String,
    },
    AlreadySaved {
        #[serde(rename = "materialId")]
        material_id: String,
    },
}

/// The serialized failure: one allowlisted code and its fixed message.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportSaveError {
    pub code: String,
    pub message: String,
}

/// Every refusal the save can return (preparation §4.3, table 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportSaveCode {
    InvalidArgument,
    InvalidOperationId,
    InvalidHashFormat,
    EmptySubstantiveContent,
    ContentLimitExceeded,
    InvalidSourcePage,
    UnsupportedProvider,
    IdempotencyConflict,
    StorageFailure,
}

impl ImportSaveCode {
    #[cfg(test)]
    pub const ALL: [ImportSaveCode; 9] = [
        Self::InvalidArgument,
        Self::InvalidOperationId,
        Self::InvalidHashFormat,
        Self::EmptySubstantiveContent,
        Self::ContentLimitExceeded,
        Self::InvalidSourcePage,
        Self::UnsupportedProvider,
        Self::IdempotencyConflict,
        Self::StorageFailure,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidArgument => "INVALID_ARGUMENT",
            Self::InvalidOperationId => "INVALID_OPERATION_ID",
            Self::InvalidHashFormat => "INVALID_HASH_FORMAT",
            Self::EmptySubstantiveContent => "EMPTY_SUBSTANTIVE_CONTENT",
            Self::ContentLimitExceeded => "CONTENT_LIMIT_EXCEEDED",
            Self::InvalidSourcePage => "INVALID_SOURCE_PAGE",
            Self::UnsupportedProvider => "UNSUPPORTED_PROVIDER",
            Self::IdempotencyConflict => "IDEMPOTENCY_CONFLICT",
            Self::StorageFailure => "STORAGE_FAILURE",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArgument => "The import operation payload is malformed or invalid.",
            Self::InvalidOperationId => {
                "The operation ID is invalid or does not match the material ID."
            }
            Self::InvalidHashFormat => {
                "The packet hash must be a 64-character lowercase hexadecimal string."
            }
            Self::EmptySubstantiveContent => {
                "The material must contain at least one study aid with substantive content."
            }
            Self::ContentLimitExceeded => {
                "One or more material fields exceed the allowed length or count limits."
            }
            Self::InvalidSourcePage => "Source page must be null for imported packets.",
            Self::UnsupportedProvider => {
                "The specified AI provider or model is not recognized or permitted."
            }
            Self::IdempotencyConflict => {
                "An existing material with this ID exists but its stored content does not match the import."
            }
            Self::StorageFailure => "Failed to durably persist the imported study material.",
        }
    }

    pub fn error(self) -> NativeImportSaveError {
        NativeImportSaveError {
            code: self.code().to_string(),
            message: self.message().to_string(),
        }
    }
}

type Check<T> = Result<T, ImportSaveCode>;

/// The accepted packet limits (src/logic/studyPacket/limits.ts).
mod import_limits {
    pub const TITLE: usize = 200;
    pub const SUMMARY: usize = 20_000;
    pub const SECTIONS: usize = 100;
    pub const HEADING: usize = 200;
    pub const BODY: usize = 20_000;
    pub const SOURCE_NOTES: usize = 5_000;
    pub const FLASHCARDS: usize = 500;
    pub const FRONT: usize = 1_000;
    pub const BACK: usize = 2_000;
    pub const QUESTIONS: usize = 200;
    pub const QUESTION: usize = 2_000;
    pub const CHOICES_MIN: usize = 2;
    pub const CHOICES_MAX: usize = 6;
    pub const CHOICE_TEXT: usize = 500;
    pub const EXPLANATION: usize = 4_000;
}

/// The stored JSON shapes, in the same field order the app writes for Gemini.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredSection {
    pub heading: String,
    pub body: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredFlashcard {
    pub front: String,
    pub back: String,
    pub source_page: Option<u32>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredQuestion {
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
    pub explanation: String,
    pub source_page: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportStudySet {
    pub summary: String,
    pub sections: Vec<StoredSection>,
    pub flashcards: Vec<StoredFlashcard>,
    pub source_notes: String,
}

/// A decoded, validated and normalized operation, ready to store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportContent {
    pub material_id: String,
    pub title: String,
    pub study_set: Option<ImportStudySet>,
    pub practice_test: Option<Vec<StoredQuestion>>,
}

// ----------------------------- normalization -----------------------------

/// Exactly the characters JavaScript's `\s` matches, so both sides agree.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn unify_newlines(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

/// Single-line fields: LF, NFC, every whitespace run becomes one space, trimmed.
pub(crate) fn normalize_line(value: &str) -> String {
    let unified = unify_newlines(value);
    let nfc: String = unified.nfc().collect();
    let mut out = String::with_capacity(nfc.len());
    let mut pending_space = false;
    for c in nfc.chars() {
        if is_js_space(c) {
            pending_space = true;
        } else {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        }
    }
    out
}

/// Block fields: LF, NFC, leading blank lines and trailing whitespace removed.
pub(crate) fn normalize_block(value: &str) -> String {
    let unified = unify_newlines(value);
    let nfc: String = unified.nfc().collect();
    let mut rest = nfc.as_str();
    while let Some(end) = rest.find('\n') {
        if rest[..end].chars().all(|c| c == ' ' || c == '\t') {
            rest = &rest[end + 1..];
        } else {
            break;
        }
    }
    rest.trim_end_matches(is_js_space).to_string()
}

#[derive(Clone, Copy)]
enum Kind {
    Line,
    Block,
}

/// Normalize, then require `min..=max` code points (`min` is 0 or 1).
fn bounded(raw: &str, kind: Kind, min: usize, max: usize) -> Check<String> {
    let value = match kind {
        Kind::Line => normalize_line(raw),
        Kind::Block => normalize_block(raw),
    };
    let length = value.chars().count();
    if length < min {
        return Err(ImportSaveCode::InvalidArgument);
    }
    if length > max {
        return Err(ImportSaveCode::ContentLimitExceeded);
    }
    Ok(value)
}

/// RFC 4122 version 4, lowercase, as `crypto.randomUUID()` produces it.
fn is_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, &c)| match i {
            8 | 13 | 18 | 23 => c == b'-',
            14 => c == b'4',
            19 => matches!(c, b'8' | b'9' | b'a' | b'b'),
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

fn is_content_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

// ------------------------------- decoding -------------------------------

/// A JSON object with exactly these keys, all required. Anything else is
/// refused without saying which key was wrong.
fn exact_object<'a>(value: &'a Value, keys: &[&str]) -> Check<&'a Map<String, Value>> {
    let map = value.as_object().ok_or(ImportSaveCode::InvalidArgument)?;
    if map.len() != keys.len() || !keys.iter().all(|key| map.contains_key(*key)) {
        return Err(ImportSaveCode::InvalidArgument);
    }
    Ok(map)
}

fn string_at<'a>(map: &'a Map<String, Value>, key: &str) -> Check<&'a str> {
    map[key].as_str().ok_or(ImportSaveCode::InvalidArgument)
}

fn array_at<'a>(map: &'a Map<String, Value>, key: &str) -> Check<&'a Vec<Value>> {
    map[key].as_array().ok_or(ImportSaveCode::InvalidArgument)
}

struct RawCard<'a> {
    front: &'a str,
    back: &'a str,
    source_page: &'a Value,
}

struct RawStudySet<'a> {
    title: &'a str,
    provider: &'a str,
    model: &'a str,
    summary: &'a str,
    sections: Vec<(&'a str, &'a str)>,
    flashcards: Vec<RawCard<'a>>,
    source_notes: &'a str,
}

struct RawQuestion<'a> {
    question: &'a str,
    options: Vec<&'a str>,
    correct_index: &'a Value,
    explanation: &'a str,
    source_page: &'a Value,
}

struct RawPracticeTest<'a> {
    title: &'a str,
    provider: &'a str,
    model: &'a str,
    questions: Vec<RawQuestion<'a>>,
}

struct RawOperation<'a> {
    operation_id: &'a str,
    material_id: &'a str,
    content_hash: &'a str,
    title: &'a str,
    study_set: Option<RawStudySet<'a>>,
    practice_test: Option<RawPracticeTest<'a>>,
}

/// Pass 1: the exact shape and JSON types, with no interpretation.
fn decode_shape(value: &Value) -> Check<RawOperation<'_>> {
    let root = exact_object(
        value,
        &[
            "operationId",
            "materialId",
            "contentHash",
            "material",
            "studySet",
            "practiceTest",
        ],
    )?;
    let material = exact_object(&root["material"], &["title"])?;

    let study_set = match &root["studySet"] {
        Value::Null => None,
        set => {
            let set = exact_object(
                set,
                &[
                    "title",
                    "provider",
                    "model",
                    "summary",
                    "sections",
                    "flashcards",
                    "sourceNotes",
                ],
            )?;
            let sections = array_at(set, "sections")?
                .iter()
                .map(|section| {
                    let section = exact_object(section, &["heading", "body"])?;
                    Ok((string_at(section, "heading")?, string_at(section, "body")?))
                })
                .collect::<Check<Vec<_>>>()?;
            let flashcards = array_at(set, "flashcards")?
                .iter()
                .map(|card| {
                    let card = exact_object(card, &["front", "back", "sourcePage"])?;
                    Ok(RawCard {
                        front: string_at(card, "front")?,
                        back: string_at(card, "back")?,
                        source_page: &card["sourcePage"],
                    })
                })
                .collect::<Check<Vec<_>>>()?;
            Some(RawStudySet {
                title: string_at(set, "title")?,
                provider: string_at(set, "provider")?,
                model: string_at(set, "model")?,
                summary: string_at(set, "summary")?,
                sections,
                flashcards,
                source_notes: string_at(set, "sourceNotes")?,
            })
        }
    };

    let practice_test = match &root["practiceTest"] {
        Value::Null => None,
        test => {
            let test = exact_object(test, &["title", "provider", "model", "questions"])?;
            let questions = array_at(test, "questions")?
                .iter()
                .map(|question| {
                    let question = exact_object(
                        question,
                        &[
                            "question",
                            "options",
                            "correctIndex",
                            "explanation",
                            "sourcePage",
                        ],
                    )?;
                    let options = array_at(question, "options")?
                        .iter()
                        .map(|option| option.as_str().ok_or(ImportSaveCode::InvalidArgument))
                        .collect::<Check<Vec<_>>>()?;
                    if !question["correctIndex"].is_number() {
                        return Err(ImportSaveCode::InvalidArgument);
                    }
                    Ok(RawQuestion {
                        question: string_at(question, "question")?,
                        options,
                        correct_index: &question["correctIndex"],
                        explanation: string_at(question, "explanation")?,
                        source_page: &question["sourcePage"],
                    })
                })
                .collect::<Check<Vec<_>>>()?;
            Some(RawPracticeTest {
                title: string_at(test, "title")?,
                provider: string_at(test, "provider")?,
                model: string_at(test, "model")?,
                questions,
            })
        }
    };

    Ok(RawOperation {
        operation_id: string_at(root, "operationId")?,
        material_id: string_at(root, "materialId")?,
        content_hash: string_at(root, "contentHash")?,
        title: string_at(material, "title")?,
        study_set,
        practice_test,
    })
}

/// Decode and validate an operation before any database access.
pub(crate) fn decode_import_operation(value: &Value) -> Check<ImportContent> {
    use import_limits as limit;
    let raw = decode_shape(value)?;

    // Identity and digest.
    if !is_uuid_v4(raw.operation_id)
        || !is_uuid_v4(raw.material_id)
        || raw.operation_id != raw.material_id
    {
        return Err(ImportSaveCode::InvalidOperationId);
    }
    if !is_content_hash(raw.content_hash) {
        return Err(ImportSaveCode::InvalidHashFormat);
    }

    // Provenance is fixed: an import is never attributed to a model.
    let provenance = [
        raw.study_set.as_ref().map(|s| (s.provider, s.model)),
        raw.practice_test.as_ref().map(|t| (t.provider, t.model)),
    ];
    if provenance
        .iter()
        .flatten()
        .any(|(provider, model)| *provider != "import" || !model.is_empty())
    {
        return Err(ImportSaveCode::UnsupportedProvider);
    }

    // No imported item may claim a verified source page.
    let pages = raw
        .study_set
        .iter()
        .flat_map(|s| s.flashcards.iter().map(|c| c.source_page))
        .chain(
            raw.practice_test
                .iter()
                .flat_map(|t| t.questions.iter().map(|q| q.source_page)),
        );
    for page in pages {
        if !page.is_null() {
            return Err(ImportSaveCode::InvalidSourcePage);
        }
    }

    let title = bounded(raw.title, Kind::Line, 1, limit::TITLE)?;

    let study_set = match &raw.study_set {
        None => None,
        Some(set) => {
            if normalize_line(set.title) != title {
                return Err(ImportSaveCode::InvalidArgument);
            }
            let summary = bounded(set.summary, Kind::Block, 0, limit::SUMMARY)?;
            if set.sections.len() > limit::SECTIONS || set.flashcards.len() > limit::FLASHCARDS {
                return Err(ImportSaveCode::ContentLimitExceeded);
            }
            let sections = set
                .sections
                .iter()
                .map(|(heading, body)| {
                    Ok(StoredSection {
                        heading: bounded(heading, Kind::Line, 1, limit::HEADING)?,
                        body: bounded(body, Kind::Block, 1, limit::BODY)?,
                    })
                })
                .collect::<Check<Vec<_>>>()?;
            let flashcards = set
                .flashcards
                .iter()
                .map(|card| {
                    Ok(StoredFlashcard {
                        front: bounded(card.front, Kind::Block, 1, limit::FRONT)?,
                        back: bounded(card.back, Kind::Block, 1, limit::BACK)?,
                        source_page: None,
                    })
                })
                .collect::<Check<Vec<_>>>()?;
            let source_notes = bounded(set.source_notes, Kind::Block, 0, limit::SOURCE_NOTES)?;
            Some(ImportStudySet {
                summary,
                sections,
                flashcards,
                source_notes,
            })
        }
    };

    let practice_test = match &raw.practice_test {
        None => None,
        Some(test) => {
            if normalize_line(test.title) != title {
                return Err(ImportSaveCode::InvalidArgument);
            }
            if test.questions.is_empty() {
                return Err(ImportSaveCode::InvalidArgument);
            }
            if test.questions.len() > limit::QUESTIONS {
                return Err(ImportSaveCode::ContentLimitExceeded);
            }
            let questions = test
                .questions
                .iter()
                .map(|q| {
                    let question = bounded(q.question, Kind::Block, 1, limit::QUESTION)?;
                    if q.options.len() < limit::CHOICES_MIN {
                        return Err(ImportSaveCode::InvalidArgument);
                    }
                    if q.options.len() > limit::CHOICES_MAX {
                        return Err(ImportSaveCode::ContentLimitExceeded);
                    }
                    let options = q
                        .options
                        .iter()
                        .map(|option| bounded(option, Kind::Line, 1, limit::CHOICE_TEXT))
                        .collect::<Check<Vec<_>>>()?;
                    let mut folded: Vec<String> =
                        options.iter().map(|o| o.to_lowercase()).collect();
                    folded.sort();
                    folded.dedup();
                    if folded.len() != options.len() {
                        return Err(ImportSaveCode::InvalidArgument);
                    }
                    let correct_index = q
                        .correct_index
                        .as_u64()
                        .filter(|index| (*index as usize) < options.len())
                        .ok_or(ImportSaveCode::InvalidArgument)?
                        as usize;
                    Ok(StoredQuestion {
                        question,
                        options,
                        correct_index,
                        explanation: bounded(q.explanation, Kind::Block, 1, limit::EXPLANATION)?,
                        source_page: None,
                    })
                })
                .collect::<Check<Vec<_>>>()?;
            Some(questions)
        }
    };

    // At least one substantive aid. Notes alone never count.
    let set_substantive = study_set.as_ref().is_some_and(|s| {
        !s.summary.is_empty() || !s.sections.is_empty() || !s.flashcards.is_empty()
    });
    let test_substantive = practice_test.as_ref().is_some_and(|q| !q.is_empty());
    if !set_substantive && !test_substantive {
        return Err(ImportSaveCode::EmptySubstantiveContent);
    }
    // A study set that is sent must itself carry something (notes need one too).
    if study_set.is_some() && !set_substantive {
        return Err(ImportSaveCode::InvalidArgument);
    }

    Ok(ImportContent {
        material_id: raw.material_id.to_string(),
        title,
        study_set,
        practice_test,
    })
}

// -------------------------------- storage --------------------------------

fn sections_json(set: &ImportStudySet) -> Check<String> {
    serde_json::to_string(&set.sections).map_err(|_| ImportSaveCode::StorageFailure)
}

fn flashcards_json(set: &ImportStudySet) -> Check<String> {
    serde_json::to_string(&set.flashcards).map_err(|_| ImportSaveCode::StorageFailure)
}

fn questions_json(questions: &[StoredQuestion]) -> Check<String> {
    serde_json::to_string(questions).map_err(|_| ImportSaveCode::StorageFailure)
}

/// Stored JSON text compared as values, so key order cannot cause a conflict.
fn same_json(stored: &str, expected: &str) -> bool {
    match (
        serde_json::from_str::<Value>(stored),
        serde_json::from_str::<Value>(expected),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// A retry is accepted only when every stored content field matches (§4.4).
/// The client's content hash is never trusted as proof of equality.
fn stored_content_matches(tx: &Transaction, content: &ImportContent) -> Check<bool> {
    let storage = |_| ImportSaveCode::StorageFailure;
    let id = &content.material_id;
    let (title, material_type): (String, String) = tx
        .query_row(
            "SELECT title, material_type FROM study_materials WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(storage)?;
    if title != content.title || material_type != "study_guide" {
        return Ok(false);
    }

    type SetRow = (String, String, String, String, String, String, String);
    let set: Option<SetRow> = tx
        .query_row(
            "SELECT title, summary, sections_json, flashcards_json, source_notes, provider, model
               FROM ai_study_sets WHERE source_material_id = ?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(storage)?;
    match (&content.study_set, set) {
        (None, None) => {}
        (Some(expected), Some((s_title, summary, sections, cards, notes, provider, model))) => {
            if s_title != content.title
                || summary != expected.summary
                || notes != expected.source_notes
                || provider != "import"
                || !model.is_empty()
                || !same_json(&sections, &sections_json(expected)?)
                || !same_json(&cards, &flashcards_json(expected)?)
            {
                return Ok(false);
            }
        }
        _ => return Ok(false),
    }

    let test: Option<(String, String, String, String)> = tx
        .query_row(
            "SELECT title, questions_json, provider, model
               FROM practice_tests WHERE source_material_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(storage)?;
    match (&content.practice_test, test) {
        (None, None) => {}
        (Some(expected), Some((t_title, questions, provider, model))) => {
            if t_title != content.title
                || provider != "import"
                || !model.is_empty()
                || !same_json(&questions, &questions_json(expected)?)
            {
                return Ok(false);
            }
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// Store a validated operation in one immediate transaction on a dedicated
/// connection. Any failure before the commit leaves no row behind.
pub(crate) fn persist_import(
    root: &Path,
    content: &ImportContent,
) -> Check<NativeImportSaveResult> {
    let storage = |_| ImportSaveCode::StorageFailure;
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() {
        return Err(ImportSaveCode::StorageFailure);
    }
    let mut connection = Connection::open(&db_path).map_err(storage)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(storage)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(storage)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;

    let id = &content.material_id;
    let exists = tx
        .query_row("SELECT 1 FROM study_materials WHERE id = ?1", [id], |_| {
            Ok(())
        })
        .optional()
        .map_err(storage)?
        .is_some();
    if exists {
        if !stored_content_matches(&tx, content)? {
            return Err(ImportSaveCode::IdempotencyConflict);
        }
        tx.commit().map_err(storage)?;
        return Ok(NativeImportSaveResult::AlreadySaved {
            material_id: id.clone(),
        });
    }

    // Same ISO-8601 form (with milliseconds) the browser writes.
    let now: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .map_err(storage)?;

    // Every material field except the title is a fixed default.
    tx.execute(
        "INSERT INTO study_materials (
            id, title, material_type, topic, review_status, priority,
            goal_id, event_id, notes, file_path, original_file_name, file_size,
            created_at, updated_at, last_reviewed_at
         ) VALUES (?1, ?2, 'study_guide', 'general', 'needs_review', 'later',
            NULL, NULL, '', NULL, NULL, NULL, ?3, ?3, NULL)",
        params![id, content.title, now],
    )
    .map_err(storage)?;

    if let Some(set) = &content.study_set {
        tx.execute(
            "INSERT INTO ai_study_sets (
                source_material_id, title, summary, sections_json, flashcards_json,
                source_notes, provider, model, generated_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'import', '', ?7, ?7)",
            params![
                id,
                content.title,
                set.summary,
                sections_json(set)?,
                flashcards_json(set)?,
                set.source_notes,
                now
            ],
        )
        .map_err(storage)?;
    }

    if let Some(questions) = &content.practice_test {
        let q_json = questions_json(questions)?;
        tx.execute(
            "INSERT INTO practice_tests (
                source_material_id, title, questions_json, provider, model,
                generated_at, updated_at, legacy_migrated_at, legacy_error
             ) VALUES (?1, ?2, ?3, 'import', '', ?4, ?4, ?4, NULL)",
            params![id, content.title, q_json, now],
        )
        .map_err(storage)?;

        let version_id = crate::practice_sessions::generate_uuid_v4(&tx)
            .map_err(|_| ImportSaveCode::StorageFailure)?;
        let canonical_questions: Vec<crate::practice_sessions::CanonicalQuestion<'_>> = questions
            .iter()
            .map(|q| crate::practice_sessions::CanonicalQuestion {
                correct_index: q.correct_index,
                explanation: &q.explanation,
                options: &q.options,
                question: &q.question,
                source_page: q.source_page.map(|p| p as i64),
            })
            .collect();
        let content_hash =
            crate::practice_sessions::compute_canonical_content_hash(&canonical_questions)
                .map_err(|_| ImportSaveCode::StorageFailure)?;

        tx.execute(
            "INSERT INTO practice_test_versions (
                id, source_material_id, history_key, source_material_title,
                version_number, provider, model, title, content_hash, created_at, is_active
             ) VALUES (?1, ?2, ?2, ?3, 1, 'import', '', ?3, ?4, ?5, 1)",
            params![version_id, id, content.title, content_hash, now],
        )
        .map_err(storage)?;

        for (ordinal, q) in questions.iter().enumerate() {
            let item_id = crate::practice_sessions::generate_uuid_v4(&tx)
                .map_err(|_| ImportSaveCode::StorageFailure)?;
            let options_json =
                serde_json::to_string(&q.options).map_err(|_| ImportSaveCode::StorageFailure)?;
            tx.execute(
                "INSERT INTO practice_test_items (
                    id, version_id, ordinal, question_text, options_json,
                    correct_index, explanation, source_page
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                params![
                    item_id,
                    version_id,
                    ordinal as i64,
                    q.question,
                    options_json,
                    q.correct_index as i64,
                    q.explanation,
                ],
            )
            .map_err(storage)?;
        }
    }

    tx.commit().map_err(storage)?;
    Ok(NativeImportSaveResult::Saved {
        material_id: id.clone(),
    })
}

/// Decode, validate and store, returning only allowlisted outcomes.
pub(crate) fn save_structured_import_at(
    root: &Path,
    operation: &Value,
) -> Result<NativeImportSaveResult, NativeImportSaveError> {
    let content = decode_import_operation(operation).map_err(ImportSaveCode::error)?;
    persist_import(root, &content).map_err(ImportSaveCode::error)
}

/// Save one previewed study packet as a new material, atomically.
///
/// `operation` is untyped on purpose (see the section comment above). The
/// validation and the transaction run on a blocking worker.
#[tauri::command]
pub async fn save_structured_study_material_atomically(
    app: AppHandle,
    operation: Value,
) -> Result<NativeImportSaveResult, NativeImportSaveError> {
    let root = app_root(&app).map_err(|_| ImportSaveCode::StorageFailure.error())?;
    tauri::async_runtime::spawn_blocking(move || save_structured_import_at(&root, &operation))
        .await
        .map_err(|_| ImportSaveCode::StorageFailure.error())?
}

#[cfg(test)]
#[path = "study_packet_save_tests.rs"]
mod save_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;

    /// An owned temporary directory, removed afterwards. Never the app profile.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "hfd-study-packet-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PACKET: &[u8] = br#"{"format":"hfd-study-packet","formatVersion":1,"title":"Invented","guide":{"summary":"x"}}"#;

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn padded(len: usize) -> Vec<u8> {
        let mut bytes = PACKET.to_vec();
        bytes.resize(len, b' ');
        bytes
    }

    #[test]
    fn reads_a_regular_file_and_hashes_its_original_bytes() {
        let dir = TempDir::new("plain");
        let picked = read_packet_file(&dir.file("packet.json", PACKET)).unwrap();
        assert_eq!(picked.file_name, "packet.json");
        assert_eq!(picked.byte_length, PACKET.len() as u64);
        assert_eq!(picked.sha256, sha(PACKET));
        assert_eq!(picked.text.as_bytes(), PACKET);
        assert!(!picked.bom_removed);
    }

    #[test]
    fn strips_one_utf8_bom_but_hashes_it() {
        let dir = TempDir::new("bom");
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(PACKET);
        let picked = read_packet_file(&dir.file("bom.json", &bytes)).unwrap();
        assert!(picked.bom_removed);
        assert_eq!(picked.text.as_bytes(), PACKET);
        assert_eq!(picked.byte_length, bytes.len() as u64);
        assert_eq!(picked.sha256, sha(&bytes));
        assert_ne!(picked.sha256, sha(PACKET));
    }

    #[test]
    fn only_one_bom_is_stripped() {
        let mut bytes = vec![0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(PACKET);
        let picked = decode_packet("x.json".into(), bytes).unwrap();
        assert!(
            picked.text.starts_with('\u{feff}'),
            "the second BOM stays for the validator to refuse"
        );
    }

    #[test]
    fn empty_files_and_a_bom_alone_are_empty() {
        let dir = TempDir::new("empty");
        assert_eq!(
            read_packet_file(&dir.file("empty.json", b"")),
            Err(PacketReadError::Empty)
        );
        assert_eq!(
            read_packet_file(&dir.file("bom-only.json", &[0xef, 0xbb, 0xbf])),
            Err(PacketReadError::Empty)
        );
    }

    #[test]
    fn accepts_exactly_the_limit_and_refuses_one_byte_more() {
        let dir = TempDir::new("limit");
        let at =
            read_packet_file(&dir.file("at.json", &padded(MAX_PACKET_BYTES as usize))).unwrap();
        assert_eq!(at.byte_length, MAX_PACKET_BYTES);
        assert_eq!(
            read_packet_file(&dir.file("over.json", &padded(MAX_PACKET_BYTES as usize + 1))),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn refuses_an_oversized_observed_length_before_reading_anything() {
        struct MustNotRead;
        impl Read for MustNotRead {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                panic!("read after the size check failed");
            }
        }
        assert_eq!(
            read_bounded(MustNotRead, MAX_PACKET_BYTES + 1, MAX_PACKET_BYTES),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn growth_after_the_size_check_is_still_refused_simulated_reader() {
        // Simulated: the observed length says 10 bytes, the stream then yields more than the limit.
        let grown = vec![b' '; MAX_PACKET_BYTES as usize + 10];
        assert_eq!(
            read_bounded(Cursor::new(grown), 10, MAX_PACKET_BYTES),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn growth_after_the_size_check_is_still_refused_real_file() {
        // Real temporary file: observe its size, append past the limit through a second handle, then read.
        let dir = TempDir::new("growth");
        let path = dir.file("growing.json", PACKET);
        let file = File::open(&path).unwrap();
        let observed = file.metadata().unwrap().len();
        let mut writer = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writer
            .write_all(&vec![b' '; MAX_PACKET_BYTES as usize])
            .unwrap();
        writer.flush().unwrap();
        assert!(observed <= MAX_PACKET_BYTES);
        assert_eq!(
            read_bounded(file, observed, MAX_PACKET_BYTES),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn refuses_invalid_utf8_and_utf16_byte_order_marks() {
        let dir = TempDir::new("encoding");
        assert_eq!(
            read_packet_file(&dir.file("bad.json", &[b'{', b'"', 0xc3, 0x28, b'"', b'}'])),
            Err(PacketReadError::InvalidUtf8)
        );
        assert_eq!(
            read_packet_file(&dir.file("overlong.json", &[b'"', 0xc0, 0xaf, b'"'])),
            Err(PacketReadError::InvalidUtf8)
        );
        assert_eq!(
            read_packet_file(&dir.file("utf16le.json", &[0xff, 0xfe, b'{', 0, b'}', 0])),
            Err(PacketReadError::UnsupportedEncoding)
        );
        assert_eq!(
            read_packet_file(&dir.file("utf16be.json", &[0xfe, 0xff, 0, b'{', 0, b'}'])),
            Err(PacketReadError::UnsupportedEncoding)
        );
    }

    #[test]
    fn requires_a_regular_file() {
        let dir = TempDir::new("kinds");
        assert_eq!(
            read_packet_file(&dir.0),
            Err(PacketReadError::NotRegularFile)
        );
        assert_eq!(
            read_packet_file(&dir.0.join("missing.json")),
            Err(PacketReadError::ReadFailed)
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_named_pipe_without_blocking() {
        let dir = TempDir::new("fifo");
        let fifo = dir.0.join("pipe.json");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(status.success());
        // Opening a FIFO for reading would block until a writer appears; the pre-open check refuses it first.
        assert_eq!(
            read_packet_file(&fifo),
            Err(PacketReadError::NotRegularFile)
        );
    }

    #[test]
    fn returns_only_the_file_name_never_the_directory() {
        let dir = TempDir::new("name");
        let path = dir.file("Private Folder Packet.json", PACKET);
        let picked = read_packet_file(&path).unwrap();
        assert_eq!(picked.file_name, "Private Folder Packet.json");
        let parent = dir.0.to_string_lossy().into_owned();
        assert!(!serde_json::to_string(&picked).unwrap().contains(&parent));
    }

    #[test]
    fn failures_are_fixed_codes_and_messages_without_contents_or_paths() {
        let dir = TempDir::new("failures");
        let secret = "SENTINEL-PRIVATE-7f3a";
        let path = dir.file(&format!("{secret}.json"), &[0xff, 0xfe, b's', 0]);
        let failure = read_packet_file(&path).unwrap_err().failure();
        let json = serde_json::to_string(&failure).unwrap();
        assert_eq!(
            json,
            r#"{"code":"unsupported_encoding","message":"The file is not UTF-8. Export it again as UTF-8 JSON."}"#
        );
        assert!(!json.contains(secret));
        for error in [
            PacketReadError::NotRegularFile,
            PacketReadError::Empty,
            PacketReadError::TooLarge,
            PacketReadError::ReadFailed,
            PacketReadError::UnsupportedEncoding,
            PacketReadError::InvalidUtf8,
        ] {
            let failure = error.failure();
            assert!(
                [
                    "file_read_failed",
                    "file_empty",
                    "file_too_large",
                    "unsupported_encoding",
                    "invalid_utf8"
                ]
                .contains(&failure.code),
                "{failure:?}"
            );
            assert!(!failure.message.contains('/'));
        }
    }

    #[test]
    fn serializes_camel_case_fields_for_the_webview() {
        let picked = decode_packet("p.json".into(), PACKET.to_vec()).unwrap();
        let value: serde_json::Value = serde_json::to_value(&picked).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["bomRemoved", "byteLength", "fileName", "sha256", "text"]
        );
    }

    #[test]
    fn cancellation_is_an_empty_result() {
        // The command returns Ok(None) when the dialog is dismissed; the webview receives null.
        let cancelled: Option<PickedPacket> = None;
        assert_eq!(serde_json::to_string(&cancelled).unwrap(), "null");
    }

    #[test]
    fn reading_writes_nothing_beside_the_selected_file() {
        let dir = TempDir::new("readonly");
        let path = dir.file("packet.json", PACKET);
        let before = std::fs::read_dir(&dir.0).unwrap().count();
        read_packet_file(&path).unwrap();
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), before);
        assert_eq!(std::fs::read(&path).unwrap(), PACKET);
    }
}
