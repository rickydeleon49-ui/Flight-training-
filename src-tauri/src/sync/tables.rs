//! Which tables sync, how each one merges, and a read-only row reader.

use base64::Engine;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MergeRule {
    Union,
    Replay,
    Lww,
    LwwTombstone,
    /// Rows union by id; per `source_material_id` at most one `is_active = 1`:
    /// the active claim with the newest `sync_row_meta` (changed_at, device_id)
    /// pair (tie -> lower device id, then lower `id`); `first_reviewed_at` =
    /// earliest non-null within the current review generation.
    VersionActivation,
    /// One integer counter per key; the higher value wins and the receiver
    /// drops its lower-generation events/state (applied in S-2c).
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SyncTable {
    pub name: &'static str,
    pub primary_key: &'static str,
    pub rule: MergeRule,
}

const fn t(name: &'static str, primary_key: &'static str, rule: MergeRule) -> SyncTable {
    SyncTable {
        name,
        primary_key,
        rule,
    }
}

/// Every foreign-key parent comes before its children (S-2c deletes in reverse).
/// Never list `*_operations`, `app_metadata`, `material_operation_claims` or
/// `card_review_event_folds` (the local fold ledger of duplicate rating copies,
/// migration 0035) or `card_version_pending_claims` (bare card-version claims
/// waiting for their cards): they stay local.
pub(crate) const SYNC_TABLES: &[SyncTable] = &[
    t("study_materials", "id", MergeRule::Lww),
    // Content-addressed and write-once: the id is the hash of the descriptor.
    t("visual_card_regions", "id", MergeRule::Union),
    // Re-verified in place (navigation.rs upsert), so LWW, not Union.
    t("material_content_identities", "material_id", MergeRule::Lww),
    t(
        "card_review_generations",
        "source_material_id",
        MergeRule::Max,
    ),
    t("card_versions", "id", MergeRule::VersionActivation),
    t("card_version_origins", "version_id", MergeRule::Union),
    t("card_items", "id", MergeRule::Union),
    t("card_item_origins", "item_id", MergeRule::Union),
    // Fixed by the version's content hash; needs its item and its region.
    t("card_item_visual_regions", "item_id", MergeRule::Union),
    t("card_review_events", "id", MergeRule::Union),
    t("card_review_state", "item_id", MergeRule::Replay),
    t("practice_tests", "source_material_id", MergeRule::Lww),
    t("practice_test_versions", "id", MergeRule::VersionActivation),
    t("practice_test_items", "id", MergeRule::Union),
    t("practice_item_origins", "item_id", MergeRule::Union),
    t("practice_attempts", "id", MergeRule::Lww),
    // A changed answer updates the row in place (practice_sessions.rs).
    t("practice_responses", "id", MergeRule::Lww),
    t("ai_study_sets", "source_material_id", MergeRule::Lww),
    t("study_set_history", "id", MergeRule::Union),
    t("material_reading_state", "material_id", MergeRule::Lww),
    t("material_bookmarks", "id", MergeRule::LwwTombstone),
];

pub(crate) fn table(name: &str) -> Option<&'static SyncTable> {
    SYNC_TABLES.iter().find(|t| t.name == name)
}

/// One row as JSON, keyed by column name. The table and key names come only
/// from the constant registry, never from input.
pub(crate) fn read_row_json(
    conn: &Connection,
    table: &SyncTable,
    row_id: &str,
) -> Result<Option<Map<String, Value>>, rusqlite::Error> {
    let sql = format!(
        "SELECT * FROM {} WHERE {} = ?1",
        table.name, table.primary_key
    );
    let mut stmt = conn.prepare(&sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    stmt.query_row([row_id], |row| {
        let mut map = Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => {
                    serde_json::Number::from_f64(f).map_or(Value::Null, Value::Number)
                }
                ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
                ValueRef::Blob(bytes) => {
                    let mut blob = Map::new();
                    blob.insert(
                        "$base64".to_string(),
                        Value::String(base64::engine::general_purpose::STANDARD.encode(bytes)),
                    );
                    Value::Object(blob)
                }
            };
            map.insert(name.clone(), value);
        }
        Ok(map)
    })
    .optional()
}
