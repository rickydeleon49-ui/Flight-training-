//! Where a split part came from (M2 split-source lineage, SL-D1–D8).
//!
//! The PDF splitter issues a `SplitSourceReceipt` for the exact bytes it
//! split: the source material, a SHA-256 of those bytes, the engine's page
//! count and, for a part of a part, a snapshot of the parent's own lineage.
//! The receipt is recorded as `pending` in `split_operation_log` together with
//! the hash of its canonical JSON. Saving the parts accepts nothing but such a
//! recorded receipt, so the webview can never supply a hash, total, range or
//! level of its own: provenance only ever comes from what was really split.
//!
//! Display text (a part's title and notes) is not provenance and comes from
//! the interface; type, topic, priority, goal, event and tags are copied from
//! the source material inside the save transaction.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::documents::{safe_relative_path, DOCUMENTS_DIR};
use crate::storage::app_root;

/// The most parts one save may create.
pub const MAX_PARTS_PER_BATCH: usize = 200;
/// The most stored documents one fingerprint request may name.
pub const MAX_HASH_REQUEST: usize = 20;
const MAX_TITLE_CHARS: usize = 500;
const MAX_NOTES_CHARS: usize = 20_000;

const DATABASE_FILE: &str = "her-flight-deck.db";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageSelection {
    pub start: u32,
    pub end: u32,
}

/// One planned output part, fixed when the split ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitPlanPart {
    /// The id the new study material is created with.
    pub id: String,
    /// Pages of the immediate source this part holds.
    pub selection: PageSelection,
    pub child_page_count: u32,
    /// The same pages counted in the original (root) document.
    pub canonical_root_start: u32,
    pub canonical_root_end: u32,
    /// Stored (relative) path of the part's own PDF.
    pub file_path: String,
    pub file_size: u64,
    pub original_file_name: String,
}

/// The parent's lineage as it stood when a part of a part was split.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitParentSnapshot {
    /// `None` when the original was already removed from the library.
    pub root_material_id: Option<String>,
    pub root_title: String,
    pub root_file_name: String,
    pub root_content_sha256: Option<String>,
    pub root_total_pages: Option<u32>,
    pub parent_root_page_start: u32,
    pub parent_root_page_end: u32,
    pub parent_total_pages: u32,
    pub parent_nested_level: u32,
    pub parent_title: String,
    pub parent_file_name: String,
}

/// The fields the receipt hash covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitReceiptCore {
    pub source_material_id: String,
    pub source_file_path: String,
    pub source_file_size: u64,
    pub source_content_sha256: String,
    pub source_total_pages: u32,
    pub is_nested: bool,
    pub root_material_id: Option<String>,
    pub root_title: String,
    pub root_file_name: String,
    pub root_content_sha256: Option<String>,
    pub root_total_pages: Option<u32>,
    pub parent_snapshot: Option<SplitParentSnapshot>,
    pub nested_level: u32,
    pub plan: Vec<SplitPlanPart>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitSourceReceipt {
    /// Everything the hash covers.
    pub core: SplitReceiptCore,
    pub receipt_hash: String,
    pub operation_id: String,
}

/// Display text for one planned part.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitPartPresentation {
    pub id: String,
    pub title: String,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSplitPart {
    pub id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitBatchSaveResult {
    pub operation_id: String,
    pub parts: Vec<SavedSplitPart>,
    pub idempotent_replay: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitBatchReconciliation {
    pub operation_id: String,
    /// `pending`, `committed`, `cancelled` or `unknown`.
    pub status: String,
    pub parts: Vec<SavedSplitPart>,
    pub reconciled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitBatchCancelResult {
    pub operation_id: String,
    pub status: String,
    pub cancelled: bool,
    pub removed_files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDocumentFingerprint {
    pub relative_path: String,
    /// `None` when the file is not there or cannot be read.
    pub sha256: Option<String>,
}

/// Lowercase hexadecimal SHA-256.
pub fn calculate_sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// JSON with object keys in sorted order, so a receipt hashes the same way
/// wherever it is serialized.
pub fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", inner.join(","))
        }
        serde_json::Value::Object(map) => {
            let sorted: BTreeMap<&String, &serde_json::Value> = map.iter().collect();
            let inner: Vec<String> = sorted
                .into_iter()
                .map(|(key, item)| {
                    format!(
                        "{}:{}",
                        serde_json::Value::String(key.clone()),
                        canonical_json(item)
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        other => other.to_string(),
    }
}

/// The hash of a receipt's canonical JSON. It is also the operation id.
pub fn receipt_hash(core: &SplitReceiptCore) -> Result<(String, String), String> {
    let value = serde_json::to_value(core)
        .map_err(|error| format!("Could not record the split receipt: {error}"))?;
    let canonical = canonical_json(&value);
    let hash = calculate_sha256(canonical.as_bytes());
    Ok((canonical, hash))
}

pub(crate) fn open_library(root: &Path) -> Result<Connection, String> {
    let database = root.join(DATABASE_FILE);
    if !database.is_file() {
        return Err("The library database is missing.".to_string());
    }
    let connection = Connection::open(database)
        .map_err(|error| format!("Could not open the library database: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Could not configure the library database: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not protect library references: {error}"))?;
    Ok(connection)
}

fn stored_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let safe = safe_relative_path(relative_path)?;
    Ok(root.join(DOCUMENTS_DIR).join(safe))
}

fn require_operation_log(connection: &Connection) -> Result<(), String> {
    let present: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'split_operation_log'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not inspect the library database: {error}"))?;
    if present == 0 {
        return Err(
            "This library has not been upgraded for split tracking yet, so nothing was saved."
                .to_string(),
        );
    }
    Ok(())
}

/// One output part the splitter wrote, before it is planned.
#[derive(Debug, Clone)]
pub struct WrittenPart {
    pub id: String,
    pub first_page: u32,
    pub last_page: u32,
    pub file_path: String,
    pub file_size: u64,
    pub original_file_name: String,
}

#[derive(Debug, Clone)]
struct SourceLineageRow {
    root_material_id: Option<String>,
    source_page_start: u32,
    source_page_end: u32,
    child_page_count: u32,
    source_file_name: String,
    source_title: String,
    source_content_sha256: Option<String>,
    source_total_pages: Option<u32>,
    nested_level: u32,
}

fn source_lineage(
    connection: &Connection,
    material_id: &str,
) -> Result<Option<SourceLineageRow>, String> {
    connection
        .query_row(
            "SELECT root_material_id, source_page_start, source_page_end, child_page_count,
                    source_file_name, source_title, source_content_sha256, source_total_pages,
                    nested_level
               FROM material_split_lineage WHERE material_id = ?1",
            params![material_id],
            |row| {
                Ok(SourceLineageRow {
                    root_material_id: row.get(0)?,
                    source_page_start: row.get(1)?,
                    source_page_end: row.get(2)?,
                    child_page_count: row.get(3)?,
                    source_file_name: row.get(4)?,
                    source_title: row.get(5)?,
                    source_content_sha256: row.get(6)?,
                    source_total_pages: row.get(7)?,
                    nested_level: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Could not read where this PDF came from: {error}"))
}

/// Build a receipt for parts just split from `source_bytes` and record it as
/// `pending`. An identical receipt that is already recorded, in any state, is
/// left exactly as it is.
pub fn issue_receipt(
    connection: &Connection,
    source_material_id: &str,
    source_file_path: &str,
    source_bytes: &[u8],
    source_total_pages: u32,
    parts: &[WrittenPart],
) -> Result<SplitSourceReceipt, String> {
    safe_relative_path(source_file_path)?;
    if source_total_pages == 0 {
        return Err("That PDF has no pages this application can read.".to_string());
    }
    if parts.is_empty() || parts.len() > MAX_PARTS_PER_BATCH {
        return Err(format!(
            "A split makes between 1 and {MAX_PARTS_PER_BATCH} parts."
        ));
    }
    require_operation_log(connection)?;

    let source: Option<(String, Option<String>, Option<String>)> = connection
        .query_row(
            "SELECT title, original_file_name, file_path FROM study_materials WHERE id = ?1",
            params![source_material_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read the source material: {error}"))?;
    let Some((source_title, source_original_name, source_path)) = source else {
        return Err("The material being split is no longer in the library.".to_string());
    };
    if source_path.as_deref() != Some(source_file_path) {
        return Err("That PDF does not belong to the material being split.".to_string());
    }
    let source_file_name = source_original_name.unwrap_or_else(|| {
        Path::new(source_file_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("document.pdf")
            .to_string()
    });
    let source_content_sha256 = calculate_sha256(source_bytes);

    let parent = source_lineage(connection, source_material_id)?;
    let (root_material_id, root_title, root_file_name, root_hash, root_total, snapshot, level) =
        match &parent {
            Some(lineage) => {
                if lineage.child_page_count != source_total_pages {
                    return Err(
                        "This part's recorded page count no longer matches its PDF, so it \
                         cannot be split with a trustworthy record of where it came from."
                            .to_string(),
                    );
                }
                (
                    lineage.root_material_id.clone(),
                    lineage.source_title.clone(),
                    lineage.source_file_name.clone(),
                    lineage.source_content_sha256.clone(),
                    lineage.source_total_pages,
                    Some(SplitParentSnapshot {
                        root_material_id: lineage.root_material_id.clone(),
                        root_title: lineage.source_title.clone(),
                        root_file_name: lineage.source_file_name.clone(),
                        root_content_sha256: lineage.source_content_sha256.clone(),
                        root_total_pages: lineage.source_total_pages,
                        parent_root_page_start: lineage.source_page_start,
                        parent_root_page_end: lineage.source_page_end,
                        parent_total_pages: lineage.child_page_count,
                        parent_nested_level: lineage.nested_level,
                        parent_title: source_title.clone(),
                        parent_file_name: source_file_name.clone(),
                    }),
                    lineage.nested_level + 1,
                )
            }
            None => (
                Some(source_material_id.to_string()),
                source_title.clone(),
                source_file_name.clone(),
                Some(source_content_sha256.clone()),
                Some(source_total_pages),
                None,
                1,
            ),
        };

    let mut plan = Vec::with_capacity(parts.len());
    for part in parts {
        if part.first_page == 0
            || part.last_page < part.first_page
            || part.last_page > source_total_pages
        {
            return Err(format!(
                "Pages {}–{} are outside this {source_total_pages}-page PDF.",
                part.first_page, part.last_page
            ));
        }
        safe_relative_path(&part.file_path)?;
        let (root_start, root_end) = match &parent {
            Some(lineage) => (
                lineage.source_page_start + part.first_page - 1,
                lineage.source_page_start + part.last_page - 1,
            ),
            None => (part.first_page, part.last_page),
        };
        plan.push(SplitPlanPart {
            id: part.id.clone(),
            selection: PageSelection {
                start: part.first_page,
                end: part.last_page,
            },
            child_page_count: part.last_page - part.first_page + 1,
            canonical_root_start: root_start,
            canonical_root_end: root_end,
            file_path: part.file_path.clone(),
            file_size: part.file_size,
            original_file_name: part.original_file_name.clone(),
        });
    }

    let core = SplitReceiptCore {
        source_material_id: source_material_id.to_string(),
        source_file_path: source_file_path.to_string(),
        source_file_size: source_bytes.len() as u64,
        source_content_sha256,
        source_total_pages,
        is_nested: parent.is_some(),
        root_material_id,
        root_title,
        root_file_name,
        root_content_sha256: root_hash,
        root_total_pages: root_total,
        parent_snapshot: snapshot,
        nested_level: level,
        plan,
    };
    let (canonical, hash) = receipt_hash(&core)?;
    connection
        .execute(
            "INSERT INTO split_operation_log (
                operation_id, source_material_id, receipt_canonical_json, receipt_hash,
                status, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?1, 'pending',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE NOT EXISTS (SELECT 1 FROM split_operation_log WHERE operation_id = ?1)",
            params![hash, source_material_id, canonical],
        )
        .map_err(|error| format!("Could not record this split: {error}"))?;
    Ok(SplitSourceReceipt {
        core,
        receipt_hash: hash.clone(),
        operation_id: hash,
    })
}

/// `issue_receipt` on its own connection to the library at `root`.
pub fn issue_receipt_at(
    root: &Path,
    source_material_id: &str,
    source_file_path: &str,
    source_bytes: &[u8],
    source_total_pages: u32,
    parts: &[WrittenPart],
) -> Result<SplitSourceReceipt, String> {
    let connection = open_library(root)?;
    issue_receipt(
        &connection,
        source_material_id,
        source_file_path,
        source_bytes,
        source_total_pages,
        parts,
    )
}

fn persisted_parts(
    connection: &Connection,
    plan: &[SplitPlanPart],
) -> Result<Vec<SavedSplitPart>, String> {
    let mut parts = Vec::with_capacity(plan.len());
    for planned in plan {
        let found = connection
            .query_row(
                "SELECT id, title, file_path, file_size FROM study_materials WHERE id = ?1",
                params![planned.id],
                |row| {
                    Ok(SavedSplitPart {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        file_path: row.get(2)?,
                        file_size: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Could not read a saved part: {error}"))?;
        if let Some(part) = found {
            parts.push(part);
        }
    }
    Ok(parts)
}

fn check_presentation(
    plan: &[SplitPlanPart],
    presentation: &[SplitPartPresentation],
) -> Result<(), String> {
    if presentation.len() != plan.len()
        || presentation
            .iter()
            .zip(plan)
            .any(|(shown, planned)| shown.id != planned.id)
    {
        return Err("The part titles do not match the parts that were split.".to_string());
    }
    for shown in presentation {
        let title = shown.title.trim();
        if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
            return Err("Each part needs a title of a reasonable length.".to_string());
        }
        if shown.notes.chars().count() > MAX_NOTES_CHARS {
            return Err("A part's notes are too long.".to_string());
        }
    }
    Ok(())
}

/// Save the parts of a recorded split, with their lineage, in one immediate
/// transaction. Nothing is written, and no file is touched, unless every
/// check passes; a refused or failed save leaves the operation `pending` so
/// the interface can cancel it (which removes its staged files) or retry.
pub fn save_split_batch_at(
    root: &Path,
    receipt: &SplitSourceReceipt,
    presentation: &[SplitPartPresentation],
) -> Result<SplitBatchSaveResult, String> {
    let core = &receipt.core;
    if core.plan.is_empty() || core.plan.len() > MAX_PARTS_PER_BATCH {
        return Err(format!(
            "A split makes between 1 and {MAX_PARTS_PER_BATCH} parts."
        ));
    }
    let (_, computed) = receipt_hash(core)?;
    if computed != receipt.receipt_hash || computed != receipt.operation_id {
        return Err(
            "This split's record does not match what was split, so nothing was saved.".to_string(),
        );
    }

    let mut connection = open_library(root)?;
    require_operation_log(&connection)?;
    let recorded: Option<(Option<String>, String, String)> = connection
        .query_row(
            "SELECT source_material_id, receipt_hash, status FROM split_operation_log
              WHERE operation_id = ?1",
            params![receipt.operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read this split's record: {error}"))?;
    let Some((recorded_source, recorded_hash, status)) = recorded else {
        return Err(
            "This split's record does not match what was split, so nothing was saved.".to_string(),
        );
    };
    if recorded_hash != computed || recorded_source.as_deref() != Some(&core.source_material_id) {
        return Err(
            "This split's record does not match what was split, so nothing was saved.".to_string(),
        );
    }
    match status.as_str() {
        "committed" => {
            return Ok(SplitBatchSaveResult {
                operation_id: receipt.operation_id.clone(),
                parts: persisted_parts(&connection, &core.plan)?,
                idempotent_replay: true,
            });
        }
        "cancelled" => {
            return Err("This split was cancelled, so its parts were not saved.".to_string());
        }
        _ => {}
    }
    check_presentation(&core.plan, presentation)?;

    // The file read cannot sit inside the SQLite transaction. Re-hash the
    // source as it is on disk now; the transaction below then confirms the
    // material still points at that same file.
    let source_bytes = std::fs::read(stored_path(root, &core.source_file_path)?).map_err(|_| {
        "The PDF this was split from is missing, so the parts were not saved.".to_string()
    })?;
    if calculate_sha256(&source_bytes) != core.source_content_sha256 {
        return Err(
            "The PDF this was split from changed after it was split, so the parts were not \
             saved. Split it again."
                .to_string(),
        );
    }
    for part in &core.plan {
        let metadata = std::fs::metadata(stored_path(root, &part.file_path)?)
            .map_err(|_| format!("The PDF part is missing: {}", part.file_path))?;
        if !metadata.is_file()
            || metadata.len() == 0
            || metadata.len() > crate::pdf::MAX_PDF_BYTES
            || metadata.len() != part.file_size
        {
            return Err(format!(
                "The PDF part has an invalid size: {}",
                part.file_path
            ));
        }
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start saving PDF parts: {error}"))?;

    let still_pending: Option<String> = transaction
        .query_row(
            "SELECT status FROM split_operation_log WHERE operation_id = ?1 AND receipt_hash = ?2",
            params![receipt.operation_id, computed],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read this split's record: {error}"))?;
    if still_pending.as_deref() != Some("pending") {
        return Err(
            "This split was cancelled or saved elsewhere, so nothing was saved.".to_string(),
        );
    }

    type SourceRow = (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    );
    let source: Option<SourceRow> = transaction
        .query_row(
            "SELECT material_type, topic, priority, goal_id, event_id, file_path, title,
                    original_file_name
               FROM study_materials WHERE id = ?1",
            params![core.source_material_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Could not read the source material: {error}"))?;
    let Some((material_type, topic, priority, goal_id, event_id, file_path, _, _)) = source else {
        return Err(
            "The material this was split from was removed, so the parts were not saved."
                .to_string(),
        );
    };
    if file_path.as_deref() != Some(core.source_file_path.as_str()) {
        return Err(
            "The material this was split from now has a different PDF, so the parts were not \
             saved."
                .to_string(),
        );
    }

    if core.is_nested {
        let Some(snapshot) = &core.parent_snapshot else {
            return Err("This split's record is incomplete, so nothing was saved.".to_string());
        };
        let current = source_lineage(&transaction, &core.source_material_id)?;
        let unchanged = current.is_some_and(|row| {
            row.root_material_id == snapshot.root_material_id
                && row.source_title == snapshot.root_title
                && row.source_file_name == snapshot.root_file_name
                && row.source_content_sha256 == snapshot.root_content_sha256
                && row.source_total_pages == snapshot.root_total_pages
                && row.source_page_start == snapshot.parent_root_page_start
                && row.source_page_end == snapshot.parent_root_page_end
                && row.child_page_count == snapshot.parent_total_pages
                && row.nested_level == snapshot.parent_nested_level
        });
        if !unchanged {
            return Err(
                "Where this part came from changed after it was split, so the new parts were \
                 not saved."
                    .to_string(),
            );
        }
    } else if source_lineage(&transaction, &core.source_material_id)?.is_some() {
        return Err(
            "Where this PDF came from changed after it was split, so the parts were not saved."
                .to_string(),
        );
    }

    for part in &core.plan {
        let taken: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM study_materials WHERE id = ?1",
                params![part.id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not check the new parts: {error}"))?;
        if taken > 0 {
            return Err(format!(
                "A material with the id {} already exists, so nothing was saved.",
                part.id
            ));
        }
    }

    let now: String = transaction
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("Could not read the clock: {error}"))?;

    let snapshot = core.parent_snapshot.as_ref();
    for (part, shown) in core.plan.iter().zip(presentation) {
        transaction
            .execute(
                "INSERT INTO study_materials (id, title, material_type, topic, review_status,
                   priority, goal_id, event_id, notes, file_path, original_file_name, file_size,
                   created_at, updated_at, last_reviewed_at)
                 VALUES (?1, ?2, ?3, ?4, 'needs_review', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, NULL)",
                params![
                    part.id,
                    shown.title.trim(),
                    material_type,
                    topic,
                    priority,
                    goal_id,
                    event_id,
                    shown.notes,
                    part.file_path,
                    part.original_file_name,
                    part.file_size as i64,
                    now,
                ],
            )
            .map_err(|error| format!("Could not save a PDF part: {error}"))?;
        transaction
            .execute(
                "INSERT INTO material_tags (material_id, tag_id)
                 SELECT ?1, tag_id FROM material_tags WHERE material_id = ?2",
                params![part.id, core.source_material_id],
            )
            .map_err(|error| format!("Could not attach a PDF tag: {error}"))?;
        transaction
            .execute(
                "INSERT INTO material_split_lineage (
                    material_id, parent_material_id, root_material_id,
                    source_page_start, source_page_end, parent_page_start, parent_page_end,
                    child_page_count, source_file_name, source_title, source_content_sha256,
                    source_total_pages, parent_file_name, parent_title, parent_content_sha256,
                    parent_total_pages, nested_level, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    part.id,
                    core.is_nested.then_some(core.source_material_id.as_str()),
                    core.root_material_id,
                    part.canonical_root_start,
                    part.canonical_root_end,
                    core.is_nested.then_some(part.selection.start),
                    core.is_nested.then_some(part.selection.end),
                    part.child_page_count,
                    core.root_file_name,
                    core.root_title,
                    core.root_content_sha256,
                    core.root_total_pages,
                    snapshot.map(|parent| parent.parent_file_name.as_str()),
                    snapshot.map(|parent| parent.parent_title.as_str()),
                    core.is_nested.then_some(core.source_content_sha256.as_str()),
                    snapshot.map(|parent| parent.parent_total_pages),
                    core.nested_level,
                    now,
                ],
            )
            .map_err(|error| format!("Could not record where a part came from: {error}"))?;
    }
    let marked = transaction
        .execute(
            "UPDATE split_operation_log
                SET status = 'committed', updated_at = ?2
              WHERE operation_id = ?1 AND status = 'pending'",
            params![receipt.operation_id, now],
        )
        .map_err(|error| format!("Could not finish recording this split: {error}"))?;
    if marked != 1 {
        return Err(
            "This split was cancelled or saved elsewhere, so nothing was saved.".to_string(),
        );
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not commit PDF parts: {error}"))?;

    Ok(SplitBatchSaveResult {
        operation_id: receipt.operation_id.clone(),
        parts: core
            .plan
            .iter()
            .zip(presentation)
            .map(|(part, shown)| SavedSplitPart {
                id: part.id.clone(),
                title: shown.title.trim().to_string(),
                file_path: Some(part.file_path.clone()),
                file_size: Some(part.file_size as i64),
            })
            .collect(),
        idempotent_replay: false,
    })
}

fn recorded_plan(canonical: &str) -> Result<Vec<SplitPlanPart>, String> {
    let core: SplitReceiptCore = serde_json::from_str(canonical)
        .map_err(|error| format!("This split's record could not be read: {error}"))?;
    Ok(core.plan)
}

/// Cancel a split that was not saved: mark it `cancelled` and remove the part
/// files its own receipt recorded. A saved split is never touched.
pub fn cancel_split_batch_at(
    root: &Path,
    operation_id: &str,
) -> Result<SplitBatchCancelResult, String> {
    let connection = open_library(root)?;
    require_operation_log(&connection)?;
    let recorded: Option<(String, String)> = connection
        .query_row(
            "SELECT status, receipt_canonical_json FROM split_operation_log WHERE operation_id = ?1",
            params![operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read this split's record: {error}"))?;
    let result =
        |status: &str, cancelled: bool, removed_files: Vec<String>| SplitBatchCancelResult {
            operation_id: operation_id.to_string(),
            status: status.to_string(),
            cancelled,
            removed_files,
        };
    let Some((status, canonical)) = recorded else {
        return Ok(result("unknown", false, Vec::new()));
    };
    if status == "committed" {
        return Ok(result("committed", false, Vec::new()));
    }
    let plan = recorded_plan(&canonical)?;
    if status == "pending" {
        let changed = connection
            .execute(
                "UPDATE split_operation_log
                    SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE operation_id = ?1 AND status = 'pending'",
                params![operation_id],
            )
            .map_err(|error| format!("Could not cancel this split: {error}"))?;
        if changed != 1 {
            // Saved or cancelled in the meantime: report what it is now.
            return cancel_split_batch_at(root, operation_id);
        }
    }
    // Pending (just cancelled) or already cancelled: its files are not in use.
    let mut removed = Vec::new();
    for part in &plan {
        let Ok(path) = stored_path(root, &part.file_path) else {
            continue;
        };
        let owned_elsewhere: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM study_materials WHERE file_path = ?1",
                params![part.file_path],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not check a part file: {error}"))?;
        if owned_elsewhere == 0 && path.is_file() && std::fs::remove_file(&path).is_ok() {
            removed.push(part.file_path.clone());
        }
    }
    Ok(result("cancelled", true, removed))
}

/// Read a split back by its operation id: what state it is in and which of
/// its parts are in the library.
pub fn reconcile_split_batch_at(
    root: &Path,
    operation_id: &str,
) -> Result<SplitBatchReconciliation, String> {
    let connection = open_library(root)?;
    require_operation_log(&connection)?;
    let recorded: Option<(String, String)> = connection
        .query_row(
            "SELECT status, receipt_canonical_json FROM split_operation_log WHERE operation_id = ?1",
            params![operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read this split's record: {error}"))?;
    let Some((status, canonical)) = recorded else {
        return Ok(SplitBatchReconciliation {
            operation_id: operation_id.to_string(),
            status: "unknown".to_string(),
            parts: Vec::new(),
            reconciled: false,
        });
    };
    let plan = recorded_plan(&canonical)?;
    let parts = persisted_parts(&connection, &plan)?;
    let reconciled = status == "committed" && parts.len() == plan.len();
    Ok(SplitBatchReconciliation {
        operation_id: operation_id.to_string(),
        status,
        parts,
        reconciled,
    })
}

/// Fingerprint stored documents so their current contents can be compared
/// with what was split. A file that is not there reads as `None`.
pub fn fingerprint_stored_documents_at(
    root: &Path,
    relative_paths: &[String],
) -> Result<Vec<StoredDocumentFingerprint>, String> {
    if relative_paths.len() > MAX_HASH_REQUEST {
        return Err(format!(
            "At most {MAX_HASH_REQUEST} documents can be checked at once."
        ));
    }
    relative_paths
        .iter()
        .map(|relative_path| {
            let path = stored_path(root, relative_path)?;
            let sha256 = std::fs::read(path)
                .ok()
                .map(|bytes| calculate_sha256(&bytes));
            Ok(StoredDocumentFingerprint {
                relative_path: relative_path.clone(),
                sha256,
            })
        })
        .collect()
}

async fn off_thread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Could not finish: {error}"))?
}

#[tauri::command]
pub async fn save_split_batch(
    app: AppHandle,
    receipt: SplitSourceReceipt,
    presentation: Vec<SplitPartPresentation>,
) -> Result<SplitBatchSaveResult, String> {
    let root = app_root(&app)?;
    off_thread(move || save_split_batch_at(&root, &receipt, &presentation)).await
}

#[tauri::command]
pub async fn cancel_split_batch(
    app: AppHandle,
    operation_id: String,
) -> Result<SplitBatchCancelResult, String> {
    let root = app_root(&app)?;
    off_thread(move || cancel_split_batch_at(&root, &operation_id)).await
}

#[tauri::command]
pub async fn reconcile_split_batch(
    app: AppHandle,
    operation_id: String,
) -> Result<SplitBatchReconciliation, String> {
    let root = app_root(&app)?;
    off_thread(move || reconcile_split_batch_at(&root, &operation_id)).await
}

#[tauri::command]
pub async fn fingerprint_stored_documents(
    app: AppHandle,
    relative_paths: Vec<String>,
) -> Result<Vec<StoredDocumentFingerprint>, String> {
    let root = app_root(&app)?;
    off_thread(move || fingerprint_stored_documents_at(&root, &relative_paths)).await
}

#[cfg(test)]
#[path = "lineage_tests.rs"]
mod tests;
