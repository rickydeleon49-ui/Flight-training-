//! One-time seeding of the ledger with phone work made before migration 0033.
//! Not wired to any command yet.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

use crate::card_reviews::parse_iso_ms;
use crate::phone_work::{KINDS, PHONE_WORK_FILE};
use crate::sync::tables::SYNC_TABLES;

const DONE_KEY: &str = "sync_bootstrapped";

pub(crate) struct BootstrapOutcome {
    #[allow(dead_code)] // S-4 reports the seed
    pub seeded: usize,
    #[allow(dead_code)] // S-4 reports the seed
    pub skipped: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Baseline {
    baseline_at: String,
}

/// `?1` is the baseline (NULL = everything counts). `NEWER(x)` is true for a
/// timestamp expression after it. Returns (row id, changed_at) per row.
fn newer(expr: &str) -> String {
    format!("(?1 IS NULL OR julianday({expr}) > julianday(?1))")
}

/// Rows to seed for one registry table. Tables tied to a timestamp of their
/// own, or of their parent, are seeded; see the report for the rest.
fn seed_sql(name: &str, pk: &str) -> Option<String> {
    let attempt = "MAX(started_at, COALESCE(completed_at, started_at))";
    let sql = match name {
        "card_review_generations" => {
            // Resets: generation > 0 always travels (Max rule). changed_at = now (?2).
            return Some(
                "SELECT source_material_id, ?2 FROM card_review_generations WHERE generation > 0"
                    .to_string(),
            );
        }
        "material_content_identities" => {
            format!("SELECT material_id, verified_at FROM {name} WHERE {}", newer("verified_at"))
        }
        "card_versions" => {
            format!("SELECT id, created_at FROM {name} WHERE {}", newer("created_at"))
        }
        "card_version_origins" => format!(
            "SELECT o.version_id, v.created_at FROM {name} o JOIN card_versions v ON v.id = o.version_id WHERE {}",
            newer("v.created_at")
        ),
        "card_items" => format!(
            "SELECT i.id, v.created_at FROM {name} i JOIN card_versions v ON v.id = i.version_id WHERE {}",
            newer("v.created_at")
        ),
        "card_item_origins" => format!(
            "SELECT o.item_id, v.created_at FROM {name} o JOIN card_items i ON i.id = o.item_id \
             JOIN card_versions v ON v.id = i.version_id WHERE {}",
            newer("v.created_at")
        ),
        "card_review_state" => format!(
            "SELECT s.item_id, MAX(e.reviewed_at) FROM {name} s JOIN card_review_events e ON e.item_id = s.item_id \
             WHERE {} GROUP BY s.item_id",
            newer("e.reviewed_at")
        ),
        "practice_test_versions" => {
            format!("SELECT id, created_at FROM {name} WHERE {}", newer("created_at"))
        }
        "practice_test_items" => format!(
            "SELECT i.id, v.created_at FROM {name} i JOIN practice_test_versions v ON v.id = i.version_id WHERE {}",
            newer("v.created_at")
        ),
        "practice_item_origins" => format!(
            "SELECT o.item_id, v.created_at FROM {name} o JOIN practice_test_items i ON i.id = o.item_id \
             JOIN practice_test_versions v ON v.id = i.version_id WHERE {}",
            newer("v.created_at")
        ),
        "practice_attempts" => {
            format!("SELECT id, {attempt} FROM {name} WHERE {}", newer(attempt))
        }
        "practice_responses" => {
            format!("SELECT id, answered_at FROM {name} WHERE {}", newer("answered_at"))
        }
        "study_set_history" => {
            format!("SELECT id, created_at FROM {name} WHERE {}", newer("created_at"))
        }
        _ => {
            let (_, column) = KINDS.iter().find(|(t, _)| *t == name)?;
            format!("SELECT {pk}, {column} FROM {name} WHERE {}", newer(column))
        }
    };
    Some(sql)
}

fn read_baseline(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join(PHONE_WORK_FILE)).ok()?;
    let file: Baseline = serde_json::from_str(&text).ok()?;
    let at = file.baseline_at.trim();
    if at.is_empty() {
        None
    } else {
        Some(file.baseline_at)
    }
}

/// Seeds the ledger once, on the phone only, from work the triggers never saw.
/// Rows already in the ledger are skipped.
pub(crate) fn bootstrap_in(
    root: &Path,
    conn: &mut Connection,
    phone: bool,
    now: &str,
) -> Result<BootstrapOutcome, String> {
    let skipped = BootstrapOutcome {
        seeded: 0,
        skipped: true,
    };
    if !phone {
        return Ok(skipped);
    }
    let baseline = read_baseline(root);
    let err = |e: rusqlite::Error| format!("Could not prepare the sync log: {e}");
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let done: Option<String> = tx
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            [DONE_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if done.is_some() {
        return Ok(skipped);
    }
    let device_id: Option<String> = tx
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'device_id'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let mut seeded = 0;
    for entry in SYNC_TABLES {
        let Some(sql) = seed_sql(entry.name, entry.primary_key) else {
            continue;
        };
        let found: Vec<(String, Option<String>)> = {
            let mut stmt = tx.prepare(&sql).map_err(err)?;
            let all: [&dyn rusqlite::ToSql; 2] = [&baseline, &now];
            let rows = stmt
                .query_map(&all[..stmt.parameter_count()], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .map_err(err)?;
            rows.collect::<Result<_, _>>().map_err(err)?
        };
        for (row_id, stamp) in found {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM sync_row_meta WHERE table_name = ?1 AND row_id = ?2)",
                    [entry.name, row_id.as_str()],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if exists {
                continue;
            }
            // A missing or unreadable timestamp (possible with no baseline) counts as now.
            let changed_at = match stamp {
                Some(s) if parse_iso_ms(&s).is_some() => s,
                _ => now.to_string(),
            };
            tx.execute(
                "INSERT INTO local_changes (table_name, row_id, op, changed_at) VALUES (?1, ?2, 'insert', ?3)",
                rusqlite::params![entry.name, row_id, changed_at],
            )
            .map_err(err)?;
            tx.execute(
                "INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted) VALUES (?1, ?2, ?3, ?4, 0)",
                rusqlite::params![entry.name, row_id, device_id, changed_at],
            )
            .map_err(err)?;
            seeded += 1;
        }
    }
    tx.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2)",
        [DONE_KEY, now],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(BootstrapOutcome {
        seeded,
        skipped: false,
    })
}
