//! Carries synced ratings onto appended card versions during apply.
//! A rating that reaches a device after it already holds a longer version
//! (the old card list plus new cards at the end) is copied onto the matching
//! cards of that version, with the same ids a local carry makes. It is
//! unlogged and deterministic (a pure function of versions and events), so
//! both devices derive identical rows. It writes no receipts: apply's
//! `ensure_rate_receipts` derives them after the run. Picture cards take part:
//! their region id is part of the card compared (once its link is present), so
//! a picture never matches a plain card or a different picture.

use rusqlite::types::Value as Sql;
use rusqlite::{params, Connection, OptionalExtension};

use crate::card_reviews::carried_event_id;
use crate::sync::apply::ApplyError;

type Card = Vec<Sql>;

struct Version {
    items: Vec<(String, Card)>,
}

fn load_versions(conn: &Connection, material: &str) -> Result<Vec<Version>, ApplyError> {
    let ids: Vec<String> = conn
        .prepare(
            "SELECT id FROM card_versions v WHERE source_material_id = ?1
             ORDER BY card_count, id",
        )?
        .query_map([material], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut versions = Vec::with_capacity(ids.len());
    for id in ids {
        let items = conn
            .prepare(
                "SELECT i.id, i.front, i.back, i.source_page, o.origin, r.region_id FROM card_items i
                 LEFT JOIN card_item_origins o ON o.item_id = i.id
                 LEFT JOIN card_item_visual_regions r ON r.item_id = i.id
                 WHERE i.version_id = ?1 ORDER BY i.ordinal",
            )?
            .query_map([&id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    vec![r.get::<_, Sql>(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?],
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        versions.push(Version { items });
    }
    Ok(versions)
}

/// Returns the item ids that gained at least one event, sorted and deduped.
/// Fails closed (writes nothing) without the sync guard row.
pub(crate) fn carry_missing(conn: &Connection, material: &str) -> Result<Vec<String>, ApplyError> {
    let guarded: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM app_metadata WHERE key = 'sync_applying'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if guarded.is_none() {
        return Err(ApplyError::BadRow);
    }
    let generation: i64 = conn.query_row(
        "SELECT COALESCE((SELECT generation FROM card_review_generations
                          WHERE source_material_id = ?1), 0)",
        [material],
        |r| r.get(0),
    )?;
    let versions = load_versions(conn, material)?;
    let mut gained = Vec::new();
    for (wi, w) in versions.iter().enumerate() {
        // Longest strict prefix among the shorter versions.
        let prefix = versions[..wi]
            .iter()
            .rev()
            .filter(|p| p.items.len() < w.items.len())
            .find(|p| p.items.iter().zip(&w.items).all(|(a, b)| a.1 == b.1));
        let Some(p) = prefix else { continue };
        for (src, dst) in p.items.iter().zip(&w.items) {
            carry_item(conn, &src.0, &dst.0, generation, &mut gained)?;
        }
    }
    gained.sort();
    gained.dedup();
    Ok(gained)
}

type SourceEvent = (
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

fn carry_item(
    conn: &Connection,
    src: &str,
    dst: &str,
    generation: i64,
    gained: &mut Vec<String>,
) -> Result<(), ApplyError> {
    let events: Vec<SourceEvent> = conn
        .prepare(
            "SELECT e.id, e.generation, e.rating, e.reviewed_at, e.scheduler_version,
                    e.prior_state_json, e.next_state_json,
                    COALESCE(m.device_id, (SELECT value FROM app_metadata WHERE key = 'device_id'), ''),
                    COALESCE(m.changed_at, e.reviewed_at)
             FROM card_review_events e
             LEFT JOIN sync_row_meta m ON m.table_name = 'card_review_events' AND m.row_id = e.id
             WHERE e.item_id = ?1 AND e.generation = ?2
             ORDER BY e.reviewed_at, e.id",
        )?
        .query_map(params![src, generation], |r| {
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
        })?
        .collect::<Result<_, _>>()?;
    for (id, gen, rating, at, scheduler, prior, next, origin, changed_at) in events {
        let present: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM card_review_events
                 WHERE item_id = ?1 AND generation = ?2 AND reviewed_at = ?3 AND rating = ?4",
                params![dst, gen, at, rating],
                |r| r.get(0),
            )
            .optional()?;
        if present.is_some() {
            continue;
        }
        let carried = carried_event_id(&id, dst);
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO card_review_events
               (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![carried, dst, gen, rating, at, scheduler, prior, next],
        )?;
        if inserted == 1 {
            conn.execute(
                "INSERT OR IGNORE INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
                 VALUES ('card_review_events', ?1, ?2, ?3, 0)",
                params![carried, origin, changed_at],
            )?;
            gained.push(dst.to_string());
        }
    }
    Ok(())
}
