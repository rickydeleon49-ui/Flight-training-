//! Local rating receipts for ratings that arrived from another device.
//!
//! Receipts never travel (`card_review_operations` is not a sync table), but
//! the backup validator wants a live "rate" receipt for every current
//! rating event and a state revision that is at least the rating count. Both
//! are derived here from the events themselves, so a Mac or phone that took
//! another device's ratings still passes backup verification.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::card_reviews::sha256_hex;
use crate::logging::log;
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
/// below its current rating count, and re-derives the event states of synced
/// cards whose stored state already equals the fold. Not logged as a local
/// change. Returns the number of rows touched.
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
    let mut changed = crate::sync::apply::refold_synced_items(&tx)?;
    changed += ensure_rate_receipts(&tx, None)?;
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
    // The picture links are repaired on their own (see `repair_picture_links_at`),
    // so a problem there can never roll this repair back.
    tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
    tx.commit()?;
    Ok(changed)
}

/// Gives a picture card version back the frozen picture links it lost (a Mac
/// that took a phone-made version before picture cards synced). Exact match
/// only: a saved list of the same material (current or earlier) must produce
/// exactly that version id, every picture it names must exist and belong to
/// the material, and the version's cards must all be there. Anything else is
/// left alone; nothing is guessed. Runs under the sync guard (not logged).
pub(crate) fn repair_picture_sidecars(conn: &Connection) -> rusqlite::Result<usize> {
    use crate::card_reviews::{card_version, parse_saved_cards, SavedCards};
    let mut lists: Vec<(String, String)> = Vec::new();
    for sql in [
        "SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE flashcards_json LIKE '%visualRegionId%'",
        "SELECT material_id, json_extract(previous_json, '$.flashcards_json') FROM study_set_history
         WHERE kind = 'study_set' AND previous_json LIKE '%visualRegionId%'",
    ] {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
        for row in rows {
            if let (material, Some(json)) = row? {
                lists.push((material, json));
            }
        }
    }
    let mut added = 0;
    for (material, json) in lists {
        let SavedCards::Ok(cards) = parse_saved_cards(Some(&json)) else {
            continue;
        };
        let version = card_version(&material, &cards);
        let known: i64 = conn.query_row(
            "SELECT COUNT(*) FROM card_versions WHERE id = ?1 AND source_material_id = ?2 AND content_hash = ?3 AND card_count = ?4",
            params![version.version_id, material, version.content_hash, cards.len() as i64],
            |r| r.get(0),
        )?;
        let items: i64 = conn.query_row(
            "SELECT COUNT(*) FROM card_items WHERE version_id = ?1",
            [&version.version_id],
            |r| r.get(0),
        )?;
        if known != 1 || items != cards.len() as i64 {
            continue;
        }
        let mut missing = Vec::new();
        let mut exact = true;
        for item in &version.items {
            let Some(region) = &item.card.visual_region_id else {
                continue;
            };
            let linked: Option<String> = conn
                .query_row(
                    "SELECT region_id FROM card_item_visual_regions WHERE item_id = ?1",
                    [&item.item_id],
                    |r| r.get(0),
                )
                .optional()?;
            match linked {
                Some(have) if &have == region => {}
                Some(_) => exact = false,
                None => {
                    if crate::visual_cards::check_owner(conn, region, &material).is_err() {
                        exact = false;
                    }
                    missing.push((item.item_id.clone(), region.clone()));
                }
            }
        }
        if !exact {
            continue;
        }
        // A version gets all of its links or none: one savepoint per version, so a
        // bad one is skipped without undoing the rest.
        conn.execute_batch("SAVEPOINT picture_links")?;
        let mut done = 0;
        let mut failed = None;
        for (item, region) in missing {
            match conn.execute(
                "INSERT OR IGNORE INTO card_item_visual_regions (item_id, region_id) VALUES (?1, ?2)",
                params![item, region],
            ) {
                Ok(n) => done += n,
                Err(e) => {
                    failed = Some(e);
                    break;
                }
            }
        }
        if let Some(e) = failed {
            log::warn!("A picture version's links could not be restored: {e}");
            conn.execute_batch("ROLLBACK TO picture_links; RELEASE picture_links")?;
        } else {
            conn.execute_batch("RELEASE picture_links")?;
            added += done;
        }
    }
    Ok(added)
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

/// Restores lost picture links in the app database in `root` (exact matches
/// only), in a transaction of its own. Best effort: a database error is logged,
/// never swallowed silently and never allowed to touch the receipts repair.
pub(crate) fn repair_picture_links_at(root: &std::path::Path) -> Result<usize, String> {
    let path = root.join("her-flight-deck.db");
    if !path.is_file() {
        return Err("no database yet".to_string());
    }
    let run = || -> rusqlite::Result<usize> {
        let mut conn = Connection::open(&path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        if !crate::visual_cards::exists(&conn) {
            return Ok(0);
        }
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
        tx.execute(
            "INSERT INTO app_metadata (key, value) VALUES (?1, 'repair')",
            [GUARD],
        )?;
        let added = repair_picture_sidecars(&tx)?;
        if added == 0 {
            // Nothing to mend: leave the file exactly as it was.
            return Ok(0);
        }
        tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
        tx.commit()?;
        Ok(added)
    };
    run().map_err(|e| {
        log::warn!("Picture links were not checked: {e}");
        e.to_string()
    })
}
