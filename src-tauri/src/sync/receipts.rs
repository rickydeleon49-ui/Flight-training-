//! Local rating receipts for ratings that arrived from another device.
//!
//! Receipts never travel (`card_review_operations` is not a sync table), but
//! the backup validator wants a live "rate" receipt for every current
//! rating event and a state revision that is at least the rating count. Both
//! are derived here from the events themselves, so a Mac or phone that took
//! another device's ratings still passes backup verification.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::card_reviews::sha256_hex;
use crate::practice_sessions::canonical_json;

/// App-metadata key that silences the change log while sync writes rows.
const GUARD: &str = "sync_applying";

type EventRow = (String, String, String, i64, String, String);

/// Adds a derived receipt to every current-generation rating event that has
/// none (all materials, or only `materials`). `INSERT OR IGNORE`, so an
/// existing receipt is never touched. Returns how many were added.
pub(crate) fn ensure_rate_receipts(
    conn: &Connection,
    materials: Option<&[String]>,
) -> rusqlite::Result<usize> {
    let mut statement = conn.prepare(
        "SELECT e.id, e.item_id, v.source_material_id, e.generation, e.reviewed_at, e.next_state_json
         FROM card_review_events e
         JOIN card_items i ON i.id = e.item_id
         JOIN card_versions v ON v.id = i.version_id
         WHERE NOT EXISTS (SELECT 1 FROM card_review_operations o WHERE o.operation_id = e.id)
           AND e.generation = COALESCE(
             (SELECT g.generation FROM card_review_generations g
              WHERE g.source_material_id = v.source_material_id), 0)
         ORDER BY e.id",
    )?;
    let rows: Vec<EventRow> = statement
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    let mut added = 0;
    for (id, item, material, generation, reviewed_at, next_json) in rows {
        if materials.is_some_and(|only| !only.contains(&material)) {
            continue;
        }
        let Ok(next) = serde_json::from_str::<Value>(&next_json) else {
            continue;
        };
        let (Some(due_at), Some(reps)) = (
            next.get("dueAt").and_then(Value::as_str),
            next.get("reps")
                .and_then(Value::as_i64)
                .filter(|reps| *reps >= 1),
        ) else {
            continue;
        };
        let result = canonical_json(&json!({
            "action": "rate",
            "dueAt": due_at,
            "flag": null,
            "generation": generation,
            "itemId": item,
            "reviewedAt": reviewed_at,
            "revision": reps,
            "suspended": false,
        }));
        added += conn.execute(
            "INSERT OR IGNORE INTO card_review_operations
               (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
             VALUES (?1, 'rate', ?2, ?3, ?4, ?5, 0, ?6)",
            params![id, material, generation, sha256_hex(&id), reviewed_at, result],
        )?;
    }
    Ok(added)
}

/// Startup repair for a database that took ratings before receipts were
/// derived: adds the missing receipts and raises any state revision that is
/// below its current rating count. Only ever adds or raises, and is not
/// logged as a local change. Returns the number of rows touched.
pub(crate) fn repair_synced_ratings(conn: &mut Connection) -> rusqlite::Result<usize> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    // Only once every migration is recorded: sqlx then has nothing left to
    // run, so it cannot race this repair. A pending one waits for next launch.
    let latest = crate::migrations()
        .iter()
        .map(|m| m.version)
        .max()
        .unwrap_or(0);
    let done: i64 = match tx.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
        [],
        |r| r.get(0),
    ) {
        Ok(n) => n,
        Err(e) if e.to_string().contains("no such table") => 0,
        Err(e) => return Err(e),
    };
    if done < latest {
        // Dropping the transaction rolls it back: nothing changed.
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
            Some("not migrated yet".to_string()),
        ));
    }
    tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
    tx.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, 'repair')",
        [GUARD],
    )?;
    let mut changed = ensure_rate_receipts(&tx, None)?;
    changed += tx.execute(
        "UPDATE card_review_state SET revision = (
           SELECT COUNT(*) FROM card_review_events e
           WHERE e.item_id = card_review_state.item_id
             AND e.generation = COALESCE(
               (SELECT g.generation FROM card_review_generations g
                WHERE g.source_material_id = card_review_state.source_material_id), 0))
         WHERE revision < (
           SELECT COUNT(*) FROM card_review_events e
           WHERE e.item_id = card_review_state.item_id
             AND e.generation = COALESCE(
               (SELECT g.generation FROM card_review_generations g
                WHERE g.source_material_id = card_review_state.source_material_id), 0))",
        [],
    )?;
    tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
    tx.commit()?;
    Ok(changed)
}

/// Opens the app database in `root` and runs [`repair_synced_ratings`].
/// Best effort: a missing database or a schema that is not migrated yet
/// returns an error for the caller to log, and nothing is changed.
pub(crate) fn repair_synced_ratings_at(root: &std::path::Path) -> Result<usize, String> {
    let path = root.join("her-flight-deck.db");
    if !path.is_file() {
        return Err("no database yet".to_string());
    }
    let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    repair_synced_ratings(&mut conn).map_err(|e| e.to_string())
}
