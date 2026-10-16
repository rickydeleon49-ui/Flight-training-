//! Document navigation (M4 Slice 1, schema 15).
//!
//! The native half of the owner-approved navigation scope
//! (`docs/M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md`), ported from the
//! accepted prototype in
//! `docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/`:
//!
//! - `inspect_navigation_identity`: the trusted identity of a managed PDF. The
//!   hash and page count come from one read of the file's own bytes, never
//!   from the interface. The file is read again inside the write transaction
//!   and the identity is recorded only when both reads agree, so a file
//!   replaced mid-check is refused instead of half-recorded. Bookmarks and the
//!   reading state are reconciled against the new identity in the same
//!   transaction.
//! - `navigation_operation`: ownership and persistence, one `BEGIN IMMEDIATE`
//!   transaction per call. A reservation returns its token only after exactly
//!   one claim row changed and a read-back finds that token (M4-R33/R38). A
//!   commit writes the whole page/hash/label tuple only for the exact,
//!   current, non-cancelled reserved token (M4-R34), within the trusted
//!   identity's page count; anything else is a refusal verdict that writes
//!   nothing.
//!
//! The browser twin is `src/data/navigationTransaction.ts`; the shared cases
//! in `fixtures/navigation/operation-cases.json` hold the two sides equal.
//! Every refusal is one allowlisted code with its fixed message
//! (`NAVIGATION_ERROR_MESSAGES` in `src/data/navigationShapes.ts`).

use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::card_reviews::is_lower_hex_64;
use crate::documents::{safe_relative_path, DOCUMENTS_DIR};
use crate::lineage::calculate_sha256;
use crate::practice_sessions::{db_now_iso, is_root_ready};
use crate::storage::app_root;

/* ------------------------------------------------------------------ */
/* Limits (TS `NAVIGATION_LIMITS`)                                     */
/* ------------------------------------------------------------------ */

pub const MAX_ID_CHARS: usize = 128;
pub const MAX_TITLE_CHARS: usize = 500;
pub const MAX_NOTES_CHARS: usize = 20_000;
pub const MAX_LABEL_CHARS: usize = 100;
pub const MAX_BOOKMARKS_PER_MATERIAL: i64 = 500;
pub const MAX_SAFE: i64 = 9_007_199_254_740_991;

/* ------------------------------------------------------------------ */
/* Allowlisted errors                                                  */
/* ------------------------------------------------------------------ */

/// The navigation refusals. Messages match `NAVIGATION_ERROR_MESSAGES` in
/// `src/data/navigationShapes.ts` word for word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NavigationErrorCode {
    InvalidArgument,
    NotFound,
    FileMissing,
    NotAPdf,
    FileChanged,
    IdentityUnknown,
    PageOutOfRange,
    StaleState,
    LimitExceeded,
    StorageFailure,
}

impl NavigationErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidArgument => "That request is not valid.",
            Self::NotFound => "That study material is no longer here.",
            Self::FileMissing => "The file for this material isn't in your library anymore.",
            Self::NotAPdf => "This file can't be read as a PDF, so its pages can't be checked.",
            Self::FileChanged => "The file changed while it was being checked. Try again.",
            Self::IdentityUnknown => "This document's pages haven't been checked yet.",
            Self::PageOutOfRange => "That page isn't in this document.",
            Self::StaleState => "This changed somewhere else. Reload to see the latest.",
            Self::LimitExceeded => "That is more than this can hold.",
            Self::StorageFailure => "The change could not be saved.",
        }
    }

    pub fn error(self) -> NavigationErrorWire {
        NavigationErrorWire {
            code: self,
            message: self.message(),
        }
    }
}

type Code = NavigationErrorCode;
type Check<T> = Result<T, Code>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NavigationErrorWire {
    pub code: NavigationErrorCode,
    pub message: &'static str,
}

fn storage<E>(_: E) -> Code {
    Code::StorageFailure
}

/* ------------------------------------------------------------------ */
/* Strict request decoding                                             */
/* ------------------------------------------------------------------ */

fn exact<'a>(value: &'a Value, keys: &[&str]) -> Check<&'a Map<String, Value>> {
    let map = value.as_object().ok_or(Code::InvalidArgument)?;
    if map.len() != keys.len() || !keys.iter().all(|k| map.contains_key(*k)) {
        return Err(Code::InvalidArgument);
    }
    Ok(map)
}

fn code_points(text: &str) -> usize {
    text.chars().count()
}

fn id_field(map: &Map<String, Value>, key: &str) -> Check<String> {
    let text = map
        .get(key)
        .and_then(Value::as_str)
        .ok_or(Code::InvalidArgument)?;
    if text.is_empty()
        || code_points(text) > MAX_ID_CHARS
        || !text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Code::InvalidArgument);
    }
    Ok(text.to_string())
}

/// A JSON number that is a whole number in [1, MAX_SAFE].
fn positive_field(map: &Map<String, Value>, key: &str) -> Check<i64> {
    positive(map.get(key).ok_or(Code::InvalidArgument)?)
}

fn positive(value: &Value) -> Check<i64> {
    let n = value.as_i64().ok_or(Code::InvalidArgument)?;
    if !(1..=MAX_SAFE).contains(&n) {
        return Err(Code::InvalidArgument);
    }
    Ok(n)
}

fn nullable_positive(map: &Map<String, Value>, key: &str) -> Check<Option<i64>> {
    match map.get(key).ok_or(Code::InvalidArgument)? {
        Value::Null => Ok(None),
        other => positive(other).map(Some),
    }
}

fn hash_field(map: &Map<String, Value>, key: &str) -> Check<String> {
    let text = map
        .get(key)
        .and_then(Value::as_str)
        .ok_or(Code::InvalidArgument)?;
    if !is_lower_hex_64(text) {
        return Err(Code::InvalidArgument);
    }
    Ok(text.to_string())
}

/// A printed label: null, or 1–100 code points with no surrounding space.
fn label_field(map: &Map<String, Value>, key: &str) -> Check<Option<String>> {
    match map.get(key).ok_or(Code::InvalidArgument)? {
        Value::Null => Ok(None),
        Value::String(text) => {
            if text.is_empty() || text.trim() != text || code_points(text) > MAX_LABEL_CHARS {
                return Err(Code::InvalidArgument);
            }
            Ok(Some(text.clone()))
        }
        _ => Err(Code::InvalidArgument),
    }
}

fn text_field(map: &Map<String, Value>, key: &str, max: usize, allow_empty: bool) -> Check<String> {
    let text = map
        .get(key)
        .and_then(Value::as_str)
        .ok_or(Code::InvalidArgument)?;
    if code_points(text) > max || text.trim() != text || (!allow_empty && text.is_empty()) {
        return Err(Code::InvalidArgument);
    }
    Ok(text.to_string())
}

/// One decoded navigation operation (TS `NavigationOperation`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Operation {
    Begin {
        material_id: String,
        supersede_generation: Option<i64>,
    },
    Cancel {
        material_id: String,
        generation: i64,
    },
    Commit {
        material_id: String,
        generation: i64,
        content_sha256: String,
        physical_page: i64,
        page_label: Option<String>,
    },
    Read {
        material_id: String,
    },
    SetRead {
        material_id: String,
        physical_page: i64,
        confirmed: bool,
    },
    AddBookmark {
        material_id: String,
        bookmark_id: String,
        physical_page: i64,
        page_label: Option<String>,
        title: String,
        notes: String,
    },
    DeleteBookmark {
        material_id: String,
        bookmark_id: String,
    },
}

pub fn decode_operation(value: &Value) -> Check<Operation> {
    let kind = value
        .as_object()
        .and_then(|m| m.get("kind"))
        .and_then(Value::as_str)
        .ok_or(Code::InvalidArgument)?;
    match kind {
        "begin" => {
            let m = exact(value, &["kind", "materialId", "supersedeGeneration"])?;
            Ok(Operation::Begin {
                material_id: id_field(m, "materialId")?,
                supersede_generation: nullable_positive(m, "supersedeGeneration")?,
            })
        }
        "cancel" => {
            let m = exact(value, &["kind", "materialId", "generation"])?;
            Ok(Operation::Cancel {
                material_id: id_field(m, "materialId")?,
                generation: positive_field(m, "generation")?,
            })
        }
        "commit" => {
            let m = exact(
                value,
                &[
                    "kind",
                    "materialId",
                    "generation",
                    "contentSha256",
                    "physicalPage",
                    "pageLabel",
                ],
            )?;
            Ok(Operation::Commit {
                material_id: id_field(m, "materialId")?,
                generation: positive_field(m, "generation")?,
                content_sha256: hash_field(m, "contentSha256")?,
                physical_page: positive_field(m, "physicalPage")?,
                page_label: label_field(m, "pageLabel")?,
            })
        }
        "read" => {
            let m = exact(value, &["kind", "materialId"])?;
            Ok(Operation::Read {
                material_id: id_field(m, "materialId")?,
            })
        }
        "set_read" => {
            let m = exact(value, &["kind", "materialId", "physicalPage", "confirmed"])?;
            Ok(Operation::SetRead {
                material_id: id_field(m, "materialId")?,
                physical_page: positive_field(m, "physicalPage")?,
                confirmed: m
                    .get("confirmed")
                    .and_then(Value::as_bool)
                    .ok_or(Code::InvalidArgument)?,
            })
        }
        "add_bookmark" => {
            let m = exact(
                value,
                &[
                    "kind",
                    "materialId",
                    "bookmarkId",
                    "physicalPage",
                    "pageLabel",
                    "title",
                    "notes",
                ],
            )?;
            Ok(Operation::AddBookmark {
                material_id: id_field(m, "materialId")?,
                bookmark_id: id_field(m, "bookmarkId")?,
                physical_page: positive_field(m, "physicalPage")?,
                page_label: label_field(m, "pageLabel")?,
                title: text_field(m, "title", MAX_TITLE_CHARS, false)?,
                notes: text_field(m, "notes", MAX_NOTES_CHARS, true)?,
            })
        }
        "delete_bookmark" => {
            let m = exact(value, &["kind", "materialId", "bookmarkId"])?;
            Ok(Operation::DeleteBookmark {
                material_id: id_field(m, "materialId")?,
                bookmark_id: id_field(m, "bookmarkId")?,
            })
        }
        _ => Err(Code::InvalidArgument),
    }
}

/* ------------------------------------------------------------------ */
/* Reads shared by operations                                          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq)]
struct Identity {
    content_sha256: String,
    total_pages: i64,
    verified_at: String,
}

fn material_exists(tx: &Connection, material_id: &str) -> Check<bool> {
    tx.query_row(
        "SELECT COUNT(*) FROM study_materials WHERE id = ?1",
        [material_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n == 1)
    .map_err(storage)
}

fn identity_of(tx: &Connection, material_id: &str) -> Check<Option<Identity>> {
    tx.query_row(
        "SELECT content_sha256, total_pages, verified_at FROM material_content_identities WHERE material_id = ?1",
        [material_id],
        |r| {
            Ok(Identity {
                content_sha256: r.get(0)?,
                total_pages: r.get(1)?,
                verified_at: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(storage)
}

fn claim_of(tx: &Connection, material_id: &str) -> Check<Option<(i64, i64)>> {
    tx.query_row(
        "SELECT reserved_generation, cancelled_generation FROM material_operation_claims WHERE material_id = ?1",
        [material_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(storage)
}

fn saved_owner(tx: &Connection, material_id: &str) -> Check<i64> {
    Ok(tx
        .query_row(
            "SELECT owner_generation FROM material_reading_state WHERE material_id = ?1",
            [material_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(storage)?
        .unwrap_or(0))
}

fn identity_json(material_id: &str, identity: &Identity) -> Value {
    json!({
        "materialId": material_id,
        "contentSha256": identity.content_sha256,
        "totalPages": identity.total_pages,
        "verifiedAt": identity.verified_at,
    })
}

fn reading_state_json(tx: &Connection, material_id: &str) -> Check<Value> {
    let row = tx
        .query_row(
            "SELECT last_requested_page, last_requested_page_label, confirmed_read,
                    originating_content_sha256, status, owner_generation, updated_at
               FROM material_reading_state WHERE material_id = ?1",
            [material_id],
            |r| {
                Ok(json!({
                    "materialId": material_id,
                    "lastRequestedPage": r.get::<_, i64>(0)?,
                    "lastRequestedPageLabel": r.get::<_, Option<String>>(1)?,
                    "confirmedRead": r.get::<_, i64>(2)? == 1,
                    "originatingContentSha256": r.get::<_, Option<String>>(3)?,
                    "status": r.get::<_, String>(4)?,
                    "ownerGeneration": r.get::<_, i64>(5)?,
                    "updatedAt": r.get::<_, String>(6)?,
                }))
            },
        )
        .optional()
        .map_err(storage)?;
    Ok(row.unwrap_or(Value::Null))
}

fn bookmark_json(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, String>(0)?,
        "materialId": r.get::<_, String>(1)?,
        "physicalPage": r.get::<_, i64>(2)?,
        "pageLabel": r.get::<_, Option<String>>(3)?,
        "originatingContentSha256": r.get::<_, Option<String>>(4)?,
        "title": r.get::<_, String>(5)?,
        "notes": r.get::<_, String>(6)?,
        "status": r.get::<_, String>(7)?,
        "createdAt": r.get::<_, String>(8)?,
        "updatedAt": r.get::<_, String>(9)?,
    }))
}

const BOOKMARK_COLUMNS: &str = "id, material_id, page_index, page_label, originating_content_sha256, title, notes, status, created_at, updated_at";

fn bookmarks_json(tx: &Connection, material_id: &str) -> Check<Vec<Value>> {
    let mut statement = tx
        .prepare(&format!(
            "SELECT {BOOKMARK_COLUMNS} FROM material_bookmarks WHERE material_id = ?1
              ORDER BY page_index ASC, created_at ASC, id ASC LIMIT ?2"
        ))
        .map_err(storage)?;
    let rows = statement
        .query_map(
            params![material_id, MAX_BOOKMARKS_PER_MATERIAL],
            bookmark_json,
        )
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage);
    rows
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/// Apply one operation inside an open immediate transaction.
pub fn execute_operation(tx: &Transaction<'_>, op: &Operation) -> Check<Value> {
    match op {
        Operation::Begin {
            material_id,
            supersede_generation,
        } => begin(tx, material_id, *supersede_generation),
        Operation::Cancel {
            material_id,
            generation,
        } => cancel(tx, material_id, *generation),
        Operation::Commit {
            material_id,
            generation,
            content_sha256,
            physical_page,
            page_label,
        } => commit(
            tx,
            material_id,
            *generation,
            content_sha256,
            *physical_page,
            page_label.as_deref(),
        ),
        Operation::Read { material_id } => read(tx, material_id),
        Operation::SetRead {
            material_id,
            physical_page,
            confirmed,
        } => set_read(tx, material_id, *physical_page, *confirmed),
        Operation::AddBookmark {
            material_id,
            bookmark_id,
            physical_page,
            page_label,
            title,
            notes,
        } => add_bookmark(
            tx,
            material_id,
            bookmark_id,
            *physical_page,
            page_label.as_deref(),
            title,
            notes,
        ),
        Operation::DeleteBookmark {
            material_id,
            bookmark_id,
        } => delete_bookmark(tx, material_id, bookmark_id),
    }
}

/// Reserve the next token, optionally cancelling the request it supersedes in
/// the same transaction. The token is returned only after exactly one claim
/// row changed and a read-back finds exactly this token (M4-R33/R38).
fn begin(tx: &Transaction<'_>, material_id: &str, supersede: Option<i64>) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let (reserved, cancelled) = claim_of(tx, material_id)?.unwrap_or((0, 0));
    let base = reserved.max(saved_owner(tx, material_id)?);
    if base >= MAX_SAFE - 1 {
        return Err(Code::LimitExceeded);
    }
    let next = base + 1;
    // A supersede names a token this material actually issued; anything else
    // is refused rather than recorded.
    let cancel_to = match supersede {
        Some(token) if token > reserved => return Err(Code::InvalidArgument),
        Some(token) => cancelled.max(token),
        None => cancelled,
    };
    let now = db_now_iso(tx).map_err(storage)?;
    let changed = tx
        .execute(
            "INSERT INTO material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(material_id) DO UPDATE SET
               reserved_generation = excluded.reserved_generation,
               cancelled_generation = excluded.cancelled_generation,
               updated_at = excluded.updated_at",
            params![material_id, next, cancel_to, now],
        )
        .map_err(storage)?;
    if changed != 1 {
        return Err(Code::StorageFailure);
    }
    match claim_of(tx, material_id)? {
        Some((r, c)) if r == next && c == cancel_to => Ok(json!({ "generation": next })),
        _ => Err(Code::StorageFailure),
    }
}

/// Cancel an issued token so a late commit for it is refused inside its own
/// transaction. Cancelling an already-cancelled or older token is a no-op.
fn cancel(tx: &Transaction<'_>, material_id: &str, generation: i64) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let Some((reserved, cancelled)) = claim_of(tx, material_id)? else {
        return Err(Code::InvalidArgument);
    };
    if generation > reserved {
        return Err(Code::InvalidArgument);
    }
    if generation <= cancelled {
        return Ok(json!({ "cancelledGeneration": cancelled }));
    }
    let now = db_now_iso(tx).map_err(storage)?;
    let changed = tx
        .execute(
            "UPDATE material_operation_claims SET cancelled_generation = ?2, updated_at = ?3 WHERE material_id = ?1",
            params![material_id, generation, now],
        )
        .map_err(storage)?;
    if changed != 1 {
        return Err(Code::StorageFailure);
    }
    match claim_of(tx, material_id)? {
        Some((_, c)) if c == generation => Ok(json!({ "cancelledGeneration": generation })),
        _ => Err(Code::StorageFailure),
    }
}

fn refused(reason: &str, tx: &Connection, material_id: &str) -> Check<Value> {
    Ok(json!({
        "committed": false,
        "reason": reason,
        "readingState": reading_state_json(tx, material_id)?,
    }))
}

/// Write the whole tuple for the exact current token, or refuse and write nothing.
fn commit(
    tx: &Transaction<'_>,
    material_id: &str,
    generation: i64,
    content_sha256: &str,
    physical_page: i64,
    page_label: Option<&str>,
) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let Some((reserved, cancelled)) = claim_of(tx, material_id)? else {
        return refused("unreserved", tx, material_id);
    };
    if cancelled >= generation {
        return refused("cancelled", tx, material_id);
    }
    if reserved > generation {
        return refused("superseded", tx, material_id);
    }
    if reserved != generation {
        return refused("unreserved", tx, material_id);
    }
    let Some(identity) = identity_of(tx, material_id)? else {
        return refused("identity_unknown", tx, material_id);
    };
    if identity.content_sha256 != content_sha256 {
        return refused("identity_changed", tx, material_id);
    }
    if physical_page > identity.total_pages {
        return refused("out_of_bounds", tx, material_id);
    }
    if saved_owner(tx, material_id)? >= generation {
        return refused("replayed", tx, material_id);
    }
    let now = db_now_iso(tx).map_err(storage)?;
    let changed = tx
        .execute(
            "INSERT INTO material_reading_state
               (material_id, last_requested_page, last_requested_page_label, confirmed_read,
                originating_content_sha256, status, owner_generation, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4, 'active', ?5, ?6)
             ON CONFLICT(material_id) DO UPDATE SET
               last_requested_page = excluded.last_requested_page,
               last_requested_page_label = excluded.last_requested_page_label,
               confirmed_read = 0,
               originating_content_sha256 = excluded.originating_content_sha256,
               status = 'active',
               owner_generation = excluded.owner_generation,
               updated_at = excluded.updated_at",
            params![
                material_id,
                physical_page,
                page_label,
                content_sha256,
                generation,
                now
            ],
        )
        .map_err(storage)?;
    if changed != 1 {
        return Err(Code::StorageFailure);
    }
    Ok(json!({
        "committed": true,
        "reason": null,
        "readingState": reading_state_json(tx, material_id)?,
    }))
}

fn read(tx: &Transaction<'_>, material_id: &str) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let identity = identity_of(tx, material_id)?;
    Ok(json!({
        "materialId": material_id,
        "identity": identity.as_ref().map(|i| identity_json(material_id, i)),
        "readingState": reading_state_json(tx, material_id)?,
        "bookmarks": bookmarks_json(tx, material_id)?,
    }))
}

/// Confirm or clear reading of the page last requested. It applies only while
/// that page is still the last requested one for the current verified file.
fn set_read(
    tx: &Transaction<'_>,
    material_id: &str,
    physical_page: i64,
    confirmed: bool,
) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let identity = identity_of(tx, material_id)?.ok_or(Code::StaleState)?;
    let row: Option<(i64, Option<String>, String)> = tx
        .query_row(
            "SELECT last_requested_page, originating_content_sha256, status FROM material_reading_state WHERE material_id = ?1",
            [material_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(storage)?;
    match row {
        Some((page, Some(hash), status))
            if page == physical_page && hash == identity.content_sha256 && status == "active" => {}
        _ => return Err(Code::StaleState),
    }
    let now = db_now_iso(tx).map_err(storage)?;
    let changed = tx
        .execute(
            "UPDATE material_reading_state SET confirmed_read = ?2, updated_at = ?3 WHERE material_id = ?1",
            params![material_id, i64::from(confirmed), now],
        )
        .map_err(storage)?;
    if changed != 1 {
        return Err(Code::StorageFailure);
    }
    reading_state_json(tx, material_id)
}

fn add_bookmark(
    tx: &Transaction<'_>,
    material_id: &str,
    bookmark_id: &str,
    physical_page: i64,
    page_label: Option<&str>,
    title: &str,
    notes: &str,
) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let identity = identity_of(tx, material_id)?.ok_or(Code::IdentityUnknown)?;
    if physical_page > identity.total_pages {
        return Err(Code::PageOutOfRange);
    }
    let existing: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM material_bookmarks WHERE id = ?1",
            [bookmark_id],
            |r| r.get(0),
        )
        .map_err(storage)?;
    if existing != 0 {
        return Err(Code::InvalidArgument);
    }
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM material_bookmarks WHERE material_id = ?1",
            [material_id],
            |r| r.get(0),
        )
        .map_err(storage)?;
    if count >= MAX_BOOKMARKS_PER_MATERIAL {
        return Err(Code::LimitExceeded);
    }
    let now = db_now_iso(tx).map_err(storage)?;
    let changed = tx
        .execute(
            "INSERT INTO material_bookmarks
               (id, material_id, page_index, page_label, originating_content_sha256, title, notes, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'verified', ?8, ?8)",
            params![
                bookmark_id,
                material_id,
                physical_page,
                page_label,
                identity.content_sha256,
                title,
                notes,
                now
            ],
        )
        .map_err(storage)?;
    if changed != 1 {
        return Err(Code::StorageFailure);
    }
    tx.query_row(
        &format!("SELECT {BOOKMARK_COLUMNS} FROM material_bookmarks WHERE id = ?1"),
        [bookmark_id],
        bookmark_json,
    )
    .map_err(storage)
}

fn delete_bookmark(tx: &Transaction<'_>, material_id: &str, bookmark_id: &str) -> Check<Value> {
    if !material_exists(tx, material_id)? {
        return Err(Code::NotFound);
    }
    let changed = tx
        .execute(
            "DELETE FROM material_bookmarks WHERE id = ?1 AND material_id = ?2",
            params![bookmark_id, material_id],
        )
        .map_err(storage)?;
    Ok(json!({ "deleted": changed == 1 }))
}

/* ------------------------------------------------------------------ */
/* Trusted identity                                                    */
/* ------------------------------------------------------------------ */

/// The hash and page count of one exact byte buffer.
pub fn identity_of_bytes(bytes: &[u8]) -> Check<(String, i64)> {
    let document = lopdf::Document::load_mem(bytes).map_err(|_| Code::NotAPdf)?;
    let pages = i64::try_from(document.get_pages().len()).unwrap_or(i64::MAX);
    if pages < 1 {
        return Err(Code::NotAPdf);
    }
    Ok((calculate_sha256(bytes), pages))
}

/// Bring bookmarks and reading state in line with the current identity:
/// matching hash and an in-range page verify; an unknown hash is unverified;
/// a different hash or a page past the end has drifted.
fn reconcile(tx: &Transaction<'_>, material_id: &str, hash: &str, total: i64) -> Check<()> {
    tx.execute(
        "UPDATE material_bookmarks SET status = CASE
             WHEN originating_content_sha256 IS NULL THEN 'unverified'
             WHEN originating_content_sha256 = ?2 AND page_index <= ?3 THEN 'verified'
             ELSE 'drifted' END
         WHERE material_id = ?1",
        params![material_id, hash, total],
    )
    .map_err(storage)?;
    tx.execute(
        "UPDATE material_reading_state SET status = CASE
             WHEN originating_content_sha256 IS NULL THEN 'unverified'
             WHEN originating_content_sha256 = ?2 AND last_requested_page <= ?3 THEN 'active'
             ELSE 'drifted' END
         WHERE material_id = ?1",
        params![material_id, hash, total],
    )
    .map_err(storage)?;
    Ok(())
}

fn material_file(tx: &Connection, material_id: &str) -> Check<String> {
    let path: Option<Option<String>> = tx
        .query_row(
            "SELECT file_path FROM study_materials WHERE id = ?1",
            [material_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    match path {
        None => Err(Code::NotFound),
        Some(None) => Err(Code::FileMissing),
        Some(Some(p)) if p.trim().is_empty() => Err(Code::FileMissing),
        Some(Some(p)) => Ok(p),
    }
}

fn read_managed(root: &Path, relative: &str) -> Check<Vec<u8>> {
    let safe = safe_relative_path(relative).map_err(|_| Code::FileMissing)?;
    let path = root.join(DOCUMENTS_DIR).join(safe);
    match std::fs::read(path) {
        Ok(bytes) => Ok(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Code::FileMissing),
        Err(_) => Err(Code::StorageFailure),
    }
}

/// Inspect one material's managed file and record its identity.
pub fn inspect_identity_on(
    connection: &mut Connection,
    root: &Path,
    material_id: &str,
) -> Check<Value> {
    let relative = material_file(connection, material_id)?;
    let first = read_managed(root, &relative)?;
    let (hash, total) = identity_of_bytes(&first)?;
    drop(first);

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    // The material may have been relinked, and the file replaced, while the
    // bytes were being read; record nothing unless a second read agrees.
    if material_file(&tx, material_id)? != relative {
        return Err(Code::FileChanged);
    }
    let again = read_managed(root, &relative)?;
    if calculate_sha256(&again) != hash {
        return Err(Code::FileChanged);
    }
    drop(again);

    let previous = identity_of(&tx, material_id)?;
    let changed = previous
        .as_ref()
        .is_some_and(|p| p.content_sha256 != hash || p.total_pages != total);
    let now = db_now_iso(&tx).map_err(storage)?;
    let written = tx
        .execute(
            "INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(material_id) DO UPDATE SET
               content_sha256 = excluded.content_sha256,
               total_pages = excluded.total_pages,
               verified_at = excluded.verified_at",
            params![material_id, hash, total, now],
        )
        .map_err(storage)?;
    if written != 1 {
        return Err(Code::StorageFailure);
    }
    reconcile(&tx, material_id, &hash, total)?;
    let recorded = identity_of(&tx, material_id)?.ok_or(Code::StorageFailure)?;
    if recorded.content_sha256 != hash || recorded.total_pages != total {
        return Err(Code::StorageFailure);
    }
    tx.commit().map_err(storage)?;
    let mut out = identity_json(material_id, &recorded);
    out["changed"] = Value::Bool(changed);
    Ok(out)
}

/* ------------------------------------------------------------------ */
/* Connections and commands                                            */
/* ------------------------------------------------------------------ */

fn open_ready(root: &Path) -> Check<Connection> {
    let db_path = root.join("her-flight-deck.db");
    if !db_path.is_file() || !is_root_ready(root) {
        return Err(Code::StorageFailure);
    }
    let connection = Connection::open(&db_path).map_err(storage)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(storage)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(storage)?;
    Ok(connection)
}

/// One operation in one immediate transaction; any refusal rolls it back.
pub fn run_operation_on(connection: &mut Connection, op: &Operation) -> Check<Value> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let outcome = execute_operation(&tx, op)?;
    tx.commit().map_err(storage)?;
    Ok(outcome)
}

pub fn navigation_operation_at(
    root: &Path,
    operation: &Value,
) -> Result<Value, NavigationErrorWire> {
    let op = decode_operation(operation).map_err(Code::error)?;
    let mut connection = open_ready(root).map_err(Code::error)?;
    run_operation_on(&mut connection, &op).map_err(Code::error)
}

pub fn inspect_navigation_identity_at(
    root: &Path,
    input: &Value,
) -> Result<Value, NavigationErrorWire> {
    let m = exact(input, &["materialId"]).map_err(Code::error)?;
    let material_id = id_field(m, "materialId").map_err(Code::error)?;
    let mut connection = open_ready(root).map_err(Code::error)?;
    inspect_identity_on(&mut connection, root, &material_id).map_err(Code::error)
}

#[tauri::command]
pub async fn navigation_operation(
    app: AppHandle,
    operation: Value,
) -> Result<Value, NavigationErrorWire> {
    let root = app_root(&app).map_err(|_| Code::StorageFailure.error())?;
    tauri::async_runtime::spawn_blocking(move || navigation_operation_at(&root, &operation))
        .await
        .map_err(|_| Code::StorageFailure.error())?
}

#[tauri::command]
pub async fn inspect_navigation_identity(
    app: AppHandle,
    input: Value,
) -> Result<Value, NavigationErrorWire> {
    let root = app_root(&app).map_err(|_| Code::StorageFailure.error())?;
    tauri::async_runtime::spawn_blocking(move || inspect_navigation_identity_at(&root, &input))
        .await
        .map_err(|_| Code::StorageFailure.error())?
}

#[cfg(test)]
#[path = "navigation_tests.rs"]
mod tests;
