//! Apply a peer's change file to the local database under the D4 rules.
//! One IMMEDIATE transaction holds the guard row, every write and the
//! receipt, so a file lands whole or not at all and the ledger triggers stay
//! silent. Not wired to any command yet (S-3).

use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap, HashSet};

use base64::Engine as _;
use rusqlite::types::Value as Sql;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{Map, Value};

use crate::card_reviews::parse_iso_ms;
use crate::sync::changeset::{Change, DecodedChangeFile, Op};
use crate::sync::receipts;
use crate::sync::replay::{self, ReplayError};
use crate::sync::tables::{self, MergeRule, SyncTable, SYNC_TABLES};

const GUARD: &str = "sync_applying";
const STATE: &str = "card_review_state";

/// Local events for one item, each with its durable origin device
/// (`sync_row_meta`, else this device, else '').
pub(crate) fn item_events(
    conn: &Connection,
    item: &str,
) -> Result<Vec<replay::ReviewEvent>, ApplyError> {
    let ids: Vec<(String, String)> = conn
        .prepare(
            "SELECT e.id, COALESCE(m.device_id,
               (SELECT value FROM app_metadata WHERE key = 'device_id'), '')
             FROM card_review_events e
             LEFT JOIN sync_row_meta m
               ON m.table_name = 'card_review_events' AND m.row_id = e.id
             WHERE e.item_id = ?1",
        )?
        .query_map([item], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let events_table = tables::table("card_review_events").ok_or(ApplyError::UnknownTable)?;
    let mut events = Vec::with_capacity(ids.len());
    for (id, device) in ids {
        let row = tables::read_row_json(conn, events_table, &id)?.ok_or(ApplyError::BadRow)?;
        events.push(replay::event_from_row(&row, &device).ok_or(ApplyError::BadRow)?);
    }
    Ok(events)
}

/// Re-derives the two state columns of each folded event, exactly as a local
/// rating writes them. Only writes where the stored JSON differs. Fails closed
/// (nothing written) unless the sync guard row is present, so the ledger
/// triggers stay silent. Returns how many rows changed.
pub(crate) fn rewrite_event_states(
    conn: &Connection,
    folded: &[replay::FoldedEvent],
) -> Result<usize, ApplyError> {
    let guarded: Option<i64> = conn
        .query_row("SELECT 1 FROM app_metadata WHERE key = ?1", [GUARD], |r| {
            r.get(0)
        })
        .optional()?;
    if guarded.is_none() {
        return Err(ApplyError::BadRow);
    }
    let mut changed = 0;
    for f in folded {
        let prior = f.prior.as_ref().map_or_else(
            || "null".to_string(),
            |p| crate::practice_sessions::canonical_json(&p.to_json()),
        );
        let next = crate::practice_sessions::canonical_json(&f.next.to_json());
        changed += conn.execute(
            "UPDATE card_review_events SET prior_state_json = ?2, next_state_json = ?3
             WHERE id = ?1 AND (prior_state_json IS NOT ?2 OR next_state_json IS NOT ?3)",
            params![f.id, prior, next],
        )?;
    }
    Ok(changed)
}

/// Startup re-fold for synced cards: for each item with an event that came
/// from another device, re-derive the event states, but only when the stored
/// `card_review_state` already equals the fold's last schedule. Any other item
/// or a fold error is skipped. The caller holds the sync guard.
pub(crate) fn refold_synced_items(conn: &Connection) -> rusqlite::Result<usize> {
    // Once per database: later synced ratings are re-folded during replay.
    let done: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM app_metadata WHERE key = ?1",
            [REFOLD_DONE],
            |r| r.get(0),
        )
        .optional()?;
    if done.is_some() {
        return Ok(0);
    }
    let changed = refold_all_synced_items(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?1, '1')",
        [REFOLD_DONE],
    )?;
    Ok(changed)
}

/// App-metadata key set once the startup re-fold has run on this database.
const REFOLD_DONE: &str = "sync_refold_done";

fn refold_all_synced_items(conn: &Connection) -> rusqlite::Result<usize> {
    let items: Vec<String> = conn
        .prepare(
            "SELECT DISTINCT e.item_id FROM card_review_events e
             JOIN sync_row_meta m ON m.table_name = 'card_review_events' AND m.row_id = e.id
             WHERE m.device_id IS NOT NULL
               AND m.device_id <> COALESCE((SELECT value FROM app_metadata WHERE key = 'device_id'), '')
             ORDER BY e.item_id",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut changed = 0;
    for item in items {
        let found: Option<(String, i64)> = conn
            .query_row(
                "SELECT v.source_material_id,
                        COALESCE((SELECT g.generation FROM card_review_generations g
                                  WHERE g.source_material_id = v.source_material_id), 0)
                 FROM card_items i JOIN card_versions v ON v.id = i.version_id
                 WHERE i.id = ?1",
                [&item],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((_material, generation)) = found else {
            continue;
        };
        // A row that can't be read skips only this card.
        let Ok(events) = item_events(conn, &item) else {
            continue;
        };
        let Ok(folded) = replay::fold_item(&events, generation) else {
            continue;
        };
        let Some(last) = folded.last() else {
            continue;
        };
        let s = &last.next;
        let same: bool = conn
            .query_row(
                "SELECT scheduler_version = ?2 AND step = ?3 AND due_at IS ?4
                        AND last_reviewed_at IS ?5 AND reps = ?6 AND lapses = ?7
                 FROM card_review_state WHERE item_id = ?1",
                params![
                    item,
                    s.scheduler_version,
                    s.step,
                    s.due_at,
                    s.last_reviewed_at,
                    s.reps,
                    s.lapses
                ],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(false);
        if !same {
            continue;
        }
        match rewrite_event_states(conn, &folded) {
            Ok(n) => changed += n,
            Err(ApplyError::Db(e)) => return Err(e),
            Err(_) => {}
        }
    }
    Ok(changed)
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct ApplyOutcome {
    /// `false`: the receipt already existed and nothing was done.
    pub applied: bool,
    pub written: usize,
    pub ignored: usize,
    pub replayed_items: usize,
    pub created_in_future: bool,
}

#[derive(Debug)]
pub(crate) enum ApplyError {
    Db(rusqlite::Error),
    UnknownTable,
    /// The table whose row named a column this database lacks.
    #[allow(dead_code)] // detail kept for logs/S-4
    UnknownColumn(&'static str),
    /// The table whose row needs a parent that is missing (not tombstoned).
    #[allow(dead_code)] // detail kept for logs/S-4
    MissingParent(&'static str),
    /// Primary key differs from `row_id`, a value has a bad shape, or a time
    /// cannot be read.
    BadRow,
    Replay(ReplayError),
}

impl std::fmt::Display for ApplyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db(_) => f.write_str("the changes could not be saved"),
            Self::UnknownTable => f.write_str("the change file names an unknown table"),
            Self::UnknownColumn(_) => f.write_str("the change file names an unknown column"),
            Self::MissingParent(_) => {
                f.write_str("the change file needs work from an earlier file that is not here yet")
            }
            Self::BadRow => f.write_str("the change file holds a row that is not valid"),
            Self::Replay(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ApplyError {}

impl From<rusqlite::Error> for ApplyError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e)
    }
}

/// Applies one decoded change file. `file_name` is its S-2a name; `now` is a
/// 24-byte ISO time used for the receipt and the guard value. Any error rolls
/// the whole file back (the database is unchanged and the file stays for a
/// later retry).
pub(crate) fn apply_change_file(
    conn: &mut Connection,
    file_name: &str,
    parsed: &DecodedChangeFile,
    now: &str,
) -> Result<ApplyOutcome, ApplyError> {
    let set = &parsed.set;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // A stale guard can only exist after a rollback, which SQLite already undid.
    tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
    let seen = tx
        .query_row(
            "SELECT 1 FROM sync_applied WHERE peer_device = ?1 AND file_name = ?2",
            params![set.device_id, file_name],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if seen {
        return Ok(ApplyOutcome {
            created_in_future: parsed.created_in_future,
            ..ApplyOutcome::default()
        });
    }
    tx.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2)",
        params![GUARD, now],
    )?;
    let mut outcome = {
        let mut engine = Engine::new(&tx, &set.device_id);
        engine.run(&set.changes)?;
        engine.out
    };
    // After every upsert, delete and replay, so a receipt never names a card
    // the same file then removes.
    receipts::ensure_rate_receipts(&tx, None)?;
    tx.execute(
        "INSERT INTO sync_applied (peer_device, file_name, applied_at) VALUES (?1, ?2, ?3)",
        params![set.device_id, file_name, now],
    )?;
    tx.execute("DELETE FROM app_metadata WHERE key = ?1", [GUARD])?;
    tx.commit()?;
    outcome.applied = true;
    outcome.created_in_future = parsed.created_in_future;
    Ok(outcome)
}

struct Meta {
    device: String,
    changed_at: String,
    deleted: bool,
}

/// A foreign key of a synced table, from `PRAGMA foreign_key_list`.
#[derive(Clone)]
struct Fk {
    /// `None`: the parent table stays local (not in the registry).
    parent: Option<&'static SyncTable>,
    parent_name: String,
    from: String,
    to: String,
}

/// One `card_review_state` row without its key and revision.
#[derive(Clone, PartialEq)]
struct StateRow {
    material: String,
    scheduler_version: String,
    step: i64,
    due_at: Option<String>,
    last_reviewed_at: Option<String>,
    reps: i64,
    lapses: i64,
    suspended: i64,
    flag: Option<String>,
}

/// D4 order of a `(changed_at, device_id)` pair: later time first, then the
/// lower device id. Unreadable local times sort oldest.
type Rank = (i64, Reverse<String>);

fn rank(ms: i64, device: &str) -> Rank {
    (ms, Reverse(device.to_string()))
}

/// The one LWW comparison every rule uses. No local meta: incoming wins. An
/// equal pair is not a win, so re-applying the same content writes nothing.
fn incoming_wins(local: Option<&Meta>, changed_at: &str, device: &str) -> Result<bool, ApplyError> {
    let in_ms = parse_iso_ms(changed_at).ok_or(ApplyError::BadRow)?;
    let Some(local) = local else {
        return Ok(true);
    };
    let loc_ms = parse_iso_ms(&local.changed_at).ok_or(ApplyError::BadRow)?;
    Ok(rank(in_ms, device) > rank(loc_ms, &local.device))
}

fn to_sql(value: &Value) -> Result<Sql, ApplyError> {
    Ok(match value {
        Value::Null => Sql::Null,
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => Sql::Integer(i),
            (None, Some(f)) => Sql::Real(f),
            _ => return Err(ApplyError::BadRow),
        },
        Value::String(s) => Sql::Text(s.clone()),
        Value::Object(o) if o.len() == 1 => {
            let text = o
                .get("$base64")
                .and_then(Value::as_str)
                .ok_or(ApplyError::BadRow)?;
            Sql::Blob(
                base64::engine::general_purpose::STANDARD
                    .decode(text)
                    .map_err(|_| ApplyError::BadRow)?,
            )
        }
        _ => return Err(ApplyError::BadRow),
    })
}

fn text<'r>(row: &'r Map<String, Value>, key: &str) -> Option<&'r str> {
    row.get(key).and_then(Value::as_str)
}

fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Earliest of two ISO times (`None` counts as absent).
fn earliest(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => {
            let key = |s: &str| (parse_iso_ms(s).unwrap_or(i64::MAX), s.to_string());
            Some(if key(&b) < key(&a) { b } else { a })
        }
        (a, b) => a.or(b),
    }
}

struct Engine<'a> {
    conn: &'a Connection,
    peer: &'a str,
    out: ApplyOutcome,
    columns: HashMap<&'static str, HashSet<String>>,
    fks: HashMap<&'static str, Vec<Fk>>,
    /// (child table, column) pairs whose foreign key blocks a parent delete,
    /// keyed by parent table. Filled on first use.
    restrict: Option<HashMap<String, Vec<(String, String)>>>,
    /// Card items whose state is replayed after every table is done.
    touched: BTreeSet<String>,
    /// Newest file `changed_at` among the changes that touched each item.
    item_changed_at: HashMap<String, String>,
    states: HashMap<String, &'a Change>,
    /// Version activation claims that won LWW: (active, rank).
    claims: HashMap<(&'static str, String), (bool, Rank)>,
    version_materials: BTreeSet<(&'static str, String)>,
    /// Rows stood in for by an identical local row (see `version_upsert`);
    /// their children are skipped.
    shadowed: HashSet<(&'static str, String)>,
}

impl<'a> Engine<'a> {
    fn new(conn: &'a Connection, peer: &'a str) -> Self {
        Self {
            conn,
            peer,
            out: ApplyOutcome::default(),
            columns: HashMap::new(),
            fks: HashMap::new(),
            restrict: None,
            touched: BTreeSet::new(),
            item_changed_at: HashMap::new(),
            states: HashMap::new(),
            claims: HashMap::new(),
            version_materials: BTreeSet::new(),
            shadowed: HashSet::new(),
        }
    }

    /// Inserts/updates parent-first in registry order, deletes in reverse,
    /// then version activation, then review replay.
    fn run(&mut self, changes: &'a [Change]) -> Result<(), ApplyError> {
        let mut upserts = Vec::new();
        let mut deletes = Vec::new();
        for change in changes {
            let index = SYNC_TABLES
                .iter()
                .position(|t| t.name == change.table)
                .ok_or(ApplyError::UnknownTable)?;
            if change.op == Op::Delete {
                deletes.push((index, change));
            } else {
                upserts.push((index, change));
            }
        }
        upserts.sort_by_key(|(i, c)| (*i, c.seq));
        deletes.sort_by_key(|(i, c)| (Reverse(*i), c.seq));
        for (index, change) in upserts {
            self.upsert(&SYNC_TABLES[index], change)?;
        }
        for (index, change) in deletes {
            self.delete(&SYNC_TABLES[index], change)?;
        }
        self.activate_versions()?;
        self.replay_touched()
    }

    /* ----------------------------- lookups ----------------------------- */

    fn meta(&self, table: &str, row_id: &str) -> Result<Option<Meta>, ApplyError> {
        Ok(self
            .conn
            .query_row(
                "SELECT COALESCE(device_id, ''), changed_at, deleted FROM sync_row_meta
                 WHERE table_name = ?1 AND row_id = ?2",
                [table, row_id],
                |r| {
                    Ok(Meta {
                        device: r.get(0)?,
                        changed_at: r.get(1)?,
                        deleted: r.get::<_, i64>(2)? == 1,
                    })
                },
            )
            .optional()?)
    }

    fn write_meta(
        &self,
        table: &str,
        row_id: &str,
        change: &Change,
        deleted: bool,
    ) -> Result<(), ApplyError> {
        self.conn.execute(
            "INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (table_name, row_id) DO UPDATE SET
               device_id = excluded.device_id, changed_at = excluded.changed_at,
               deleted = excluded.deleted",
            params![
                table,
                row_id,
                self.peer,
                change.changed_at,
                i64::from(deleted)
            ],
        )?;
        Ok(())
    }

    fn local_rank(&self, table: &str, row_id: &str) -> Result<Rank, ApplyError> {
        Ok(match self.meta(table, row_id)? {
            Some(m) => rank(parse_iso_ms(&m.changed_at).unwrap_or(i64::MIN), &m.device),
            None => rank(i64::MIN, "~"),
        })
    }

    fn exists(&self, table: &str, column: &str, value: &Sql) -> Result<bool, ApplyError> {
        let sql = format!(
            "SELECT 1 FROM {} WHERE {} = ?1 LIMIT 1",
            quoted(table),
            quoted(column)
        );
        Ok(self
            .conn
            .query_row(&sql, [value], |_| Ok(()))
            .optional()?
            .is_some())
    }

    fn generation(&self, material: &str) -> Result<i64, ApplyError> {
        Ok(self
            .conn
            .query_row(
                "SELECT generation FROM card_review_generations WHERE source_material_id = ?1",
                [material],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }

    fn material_of_item(&self, item: &str) -> Result<Option<String>, ApplyError> {
        Ok(self
            .conn
            .query_row(
                "SELECT v.source_material_id FROM card_items i
                 JOIN card_versions v ON v.id = i.version_id WHERE i.id = ?1",
                [item],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// Every key must be a column of the table (`PRAGMA table_info`), so
    /// only validated names ever reach SQL text.
    fn check_columns(
        &mut self,
        table: &'static SyncTable,
        row: &Map<String, Value>,
    ) -> Result<(), ApplyError> {
        if !self.columns.contains_key(table.name) {
            let mut stmt = self
                .conn
                .prepare(&format!("PRAGMA table_info({})", quoted(table.name)))?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<Result<HashSet<_>, _>>()?;
            self.columns.insert(table.name, names);
        }
        let known = self.columns.get(table.name);
        if row.keys().all(|k| known.is_some_and(|c| c.contains(k))) {
            Ok(())
        } else {
            Err(ApplyError::UnknownColumn(table.name))
        }
    }

    fn fks(&mut self, table: &'static SyncTable) -> Result<Vec<Fk>, ApplyError> {
        if let Some(found) = self.fks.get(table.name) {
            return Ok(found.clone());
        }
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA foreign_key_list({})", quoted(table.name)))?;
        let raw = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let list: Vec<Fk> = raw
            .into_iter()
            .map(|(parent_name, from, to)| {
                let parent = tables::table(&parent_name);
                let to = match (to, parent) {
                    (Some(to), _) if !to.is_empty() => to,
                    (_, Some(p)) => p.primary_key.to_string(),
                    _ => String::new(),
                };
                Fk {
                    parent,
                    parent_name,
                    from,
                    to,
                }
            })
            .collect();
        self.fks.insert(table.name, list.clone());
        Ok(list)
    }

    /// Checks every foreign key of an incoming row. A column whose parent
    /// table stays local is kept only when that parent exists here, else
    /// NULL. A synced parent that is missing: tombstoned or shadowed ⇒ the
    /// row is skipped (`None`); otherwise `MissingParent` (the file rolls
    /// back and is retried after the earlier file arrives).
    fn resolve_parents(
        &mut self,
        table: &'static SyncTable,
        row_id: &str,
        row: &Map<String, Value>,
    ) -> Result<Option<Map<String, Value>>, ApplyError> {
        let mut row = row.clone();
        for fk in self.fks(table)? {
            let value = match row.get(&fk.from) {
                None | Some(Value::Null) => continue,
                Some(v) => to_sql(v)?,
            };
            let Some(parent) = fk.parent else {
                if fk.to.is_empty() || !self.exists(&fk.parent_name, &fk.to, &value)? {
                    row.insert(fk.from.clone(), Value::Null);
                }
                continue;
            };
            let key = match &value {
                Sql::Text(s) => s.clone(),
                _ => return Err(ApplyError::BadRow),
            };
            if self.shadowed.contains(&(parent.name, key.clone())) {
                self.shadowed.insert((table.name, row_id.to_string()));
                return Ok(None);
            }
            if !self.exists(parent.name, &fk.to, &value)? {
                if self.meta(parent.name, &key)?.is_some_and(|m| m.deleted) {
                    return Ok(None);
                }
                return Err(ApplyError::MissingParent(table.name));
            }
        }
        Ok(Some(row))
    }

    /// True when a local row references `row_id` through a foreign key that
    /// refuses the delete (`RESTRICT`/`NO ACTION`), e.g. an attempt still on
    /// a practice version.
    fn delete_blocked(&mut self, table: &SyncTable, row_id: &str) -> Result<bool, ApplyError> {
        if self.restrict.is_none() {
            let names: Vec<String> = self
                .conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?
                .query_map([], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            let mut map: HashMap<String, Vec<(String, String)>> = HashMap::new();
            for child in names {
                let mut stmt = self
                    .conn
                    .prepare(&format!("PRAGMA foreign_key_list({})", quoted(&child)))?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, String>(6)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (parent, from, on_delete) in rows {
                    if on_delete == "RESTRICT" || on_delete == "NO ACTION" {
                        map.entry(parent).or_default().push((child.clone(), from));
                    }
                }
            }
            self.restrict = Some(map);
        }
        let children = self
            .restrict
            .as_ref()
            .and_then(|m| m.get(table.name))
            .cloned()
            .unwrap_or_default();
        for (child, column) in children {
            if self.exists(&child, &column, &Sql::Text(row_id.to_string()))? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// `INSERT … ON CONFLICT(pk) DO NOTHING` or `DO UPDATE SET` the given
    /// columns. Never `INSERT OR REPLACE`: that deletes first and would fire
    /// the foreign-key cascades on the row's children.
    fn insert_row(
        &self,
        table: &SyncTable,
        row: &Map<String, Value>,
        update: bool,
    ) -> Result<usize, ApplyError> {
        let cols: Vec<&String> = row.keys().collect();
        let names: Vec<String> = cols.iter().map(|c| quoted(c)).collect();
        let marks: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
        let sets: Vec<String> = cols
            .iter()
            .filter(|c| c.as_str() != table.primary_key)
            .map(|c| format!("{0} = excluded.{0}", quoted(c)))
            .collect();
        let action = if update && !sets.is_empty() {
            format!("DO UPDATE SET {}", sets.join(", "))
        } else {
            "DO NOTHING".to_string()
        };
        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT({}) {action}",
            quoted(table.name),
            names.join(", "),
            marks.join(", "),
            quoted(table.primary_key)
        );
        let values = cols
            .iter()
            .map(|c| to_sql(&row[c.as_str()]))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(self.conn.execute(&sql, params_from_iter(values))?)
    }

    fn touch(&mut self, item: &str, changed_at: &str) {
        self.touched.insert(item.to_string());
        let newer = self.item_changed_at.get(item).is_none_or(|old| {
            parse_iso_ms(changed_at).unwrap_or(i64::MIN) > parse_iso_ms(old).unwrap_or(i64::MIN)
        });
        if newer {
            self.item_changed_at
                .insert(item.to_string(), changed_at.to_string());
        }
    }

    /* ------------------------------ rules ------------------------------ */

    fn upsert(&mut self, table: &'static SyncTable, change: &'a Change) -> Result<(), ApplyError> {
        let row = change.row.as_ref().ok_or(ApplyError::BadRow)?;
        if text(row, table.primary_key) != Some(change.row_id.as_str()) {
            return Err(ApplyError::BadRow);
        }
        self.check_columns(table, row)?;
        match table.rule {
            MergeRule::Union => self.union_insert(table, change, row),
            MergeRule::Lww | MergeRule::LwwTombstone => self.lww_upsert(table, change, row),
            MergeRule::Max => self.raise_generation(table, change, row),
            MergeRule::VersionActivation => self.version_upsert(table, change, row),
            MergeRule::Replay => {
                self.touch(&change.row_id, &change.changed_at);
                self.states.insert(change.row_id.clone(), change);
                Ok(())
            }
        }
    }

    /// Write-once rows: insert when absent, never overwrite.
    fn union_insert(
        &mut self,
        table: &'static SyncTable,
        change: &Change,
        row: &Map<String, Value>,
    ) -> Result<(), ApplyError> {
        let Some(row) = self.resolve_parents(table, &change.row_id, row)? else {
            self.out.ignored += 1;
            return Ok(());
        };
        if table.name == "card_review_events" {
            let item = text(&row, "item_id").ok_or(ApplyError::BadRow)?;
            let generation = row
                .get("generation")
                .and_then(Value::as_i64)
                .ok_or(ApplyError::BadRow)?;
            self.touch(item, &change.changed_at);
            let material = self.material_of_item(item)?.ok_or(ApplyError::BadRow)?;
            // A delayed event from before a reset this device already has.
            if generation < self.generation(&material)? {
                self.out.ignored += 1;
                return Ok(());
            }
        }
        if self.insert_row(table, &row, false)? == 1 {
            self.write_meta(table.name, &change.row_id, change, false)?;
            self.out.written += 1;
        } else {
            self.out.ignored += 1;
        }
        Ok(())
    }

    fn lww_upsert(
        &mut self,
        table: &'static SyncTable,
        change: &Change,
        row: &Map<String, Value>,
    ) -> Result<(), ApplyError> {
        let local = self.meta(table.name, &change.row_id)?;
        if !incoming_wins(local.as_ref(), &change.changed_at, self.peer)? {
            self.out.ignored += 1;
            return Ok(());
        }
        let Some(mut row) = self.resolve_parents(table, &change.row_id, row)? else {
            self.out.ignored += 1;
            return Ok(());
        };
        if table.name == "practice_attempts" {
            self.settle_attempts(&change.row_id, &mut row)?;
        }
        self.insert_row(table, &row, true)?;
        self.write_meta(table.name, &change.row_id, change, false)?;
        self.out.written += 1;
        Ok(())
    }

    /// One in-progress attempt per material: the older one (tie → higher id)
    /// becomes `abandoned` before the incoming row is written, so the unique
    /// index never fires. A demoted local row keeps its meta (derived on
    /// every device by this same rule).
    fn settle_attempts(
        &self,
        row_id: &str,
        row: &mut Map<String, Value>,
    ) -> Result<(), ApplyError> {
        if text(row, "status") != Some("in_progress") {
            return Ok(());
        }
        let Some(material) = text(row, "source_material_id") else {
            return Ok(());
        };
        let other: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT id, started_at FROM practice_attempts
                 WHERE source_material_id = ?1 AND status = 'in_progress' AND id != ?2",
                [material, row_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((other_id, other_started)) = other else {
            return Ok(());
        };
        let started = text(row, "started_at")
            .ok_or(ApplyError::BadRow)?
            .to_string();
        let age = |at: &str, id: &str| {
            (
                parse_iso_ms(at).unwrap_or(i64::MIN),
                Reverse(id.to_string()),
            )
        };
        if age(&other_started, &other_id) < age(&started, row_id) {
            self.conn.execute(
                "UPDATE practice_attempts SET status = 'abandoned',
                   completed_at = COALESCE(completed_at, ?2), revision = revision + 1
                 WHERE id = ?1",
                params![other_id, started],
            )?;
        } else {
            row.insert("status".into(), Value::from("abandoned"));
            if row.get("completed_at").is_none_or(Value::is_null) {
                row.insert("completed_at".into(), Value::from(other_started));
            }
            let revision = row.get("revision").and_then(Value::as_i64).unwrap_or(0);
            row.insert("revision".into(), Value::from(revision + 1));
        }
        Ok(())
    }

    /// `Max`: a higher generation is a peer's reset. Drop this material's
    /// lower-generation events and its review state, clear its versions'
    /// `first_reviewed_at`, then take the counter. The local reset's version
    /// edits are not mirrored: versions travel by `VersionActivation`.
    fn raise_generation(
        &mut self,
        table: &'static SyncTable,
        change: &Change,
        row: &Map<String, Value>,
    ) -> Result<(), ApplyError> {
        let incoming = row
            .get("generation")
            .and_then(Value::as_i64)
            .ok_or(ApplyError::BadRow)?;
        let material = change.row_id.as_str();
        if incoming <= self.generation(material)? {
            self.out.ignored += 1;
            return Ok(());
        }
        let Some(row) = self.resolve_parents(table, material, row)? else {
            self.out.ignored += 1;
            return Ok(());
        };
        self.conn.execute(
            "DELETE FROM card_review_events WHERE generation < ?2 AND item_id IN (
               SELECT i.id FROM card_items i JOIN card_versions v ON v.id = i.version_id
               WHERE v.source_material_id = ?1)",
            params![material, incoming],
        )?;
        // Mirrors the local reset (card_reviews.rs): this device's receipts
        // for the dropped events are erased too.
        self.conn.execute(
            "UPDATE card_review_operations SET is_erased = 1, result_json = NULL
             WHERE source_material_id = ?1 AND is_erased = 0 AND generation < ?2",
            params![material, incoming],
        )?;
        self.conn.execute(
            "DELETE FROM card_review_state WHERE source_material_id = ?1",
            [material],
        )?;
        self.conn.execute(
            "UPDATE card_versions SET first_reviewed_at = NULL
             WHERE source_material_id = ?1 AND first_reviewed_at IS NOT NULL",
            [material],
        )?;
        self.insert_row(table, &row, true)?;
        self.write_meta(table.name, material, change, false)?;
        self.out.written += 1;
        let items: Vec<String> = self
            .conn
            .prepare(
                "SELECT DISTINCT e.item_id FROM card_review_events e
                 JOIN card_items i ON i.id = e.item_id
                 JOIN card_versions v ON v.id = i.version_id
                 WHERE v.source_material_id = ?1",
            )?
            .query_map([material], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        for item in items {
            self.touch(&item, &change.changed_at);
        }
        Ok(())
    }

    /// An incoming `first_reviewed_at` counts only within the current
    /// generation: not before this device's latest reset (the counter's
    /// meta time). With no reset (or no meta for it) it always counts.
    fn first_review_counts(&self, material: &str, at: &str) -> Result<bool, ApplyError> {
        if self.generation(material)? == 0 {
            return Ok(true);
        }
        let Some(reset) = self.meta("card_review_generations", material)? else {
            return Ok(true);
        };
        Ok(match (parse_iso_ms(at), parse_iso_ms(&reset.changed_at)) {
            (Some(at), Some(reset)) => at >= reset,
            _ => false,
        })
    }

    /// `VersionActivation`: rows union by id; content columns never change.
    /// New rows land inactive (demote before activate); `is_active` is
    /// decided per material in `activate_versions` from the LWW-winning
    /// claims; `first_reviewed_at` keeps the earliest value of the current
    /// generation.
    fn version_upsert(
        &mut self,
        table: &'static SyncTable,
        change: &Change,
        row: &Map<String, Value>,
    ) -> Result<(), ApplyError> {
        let Some(mut row) = self.resolve_parents(table, &change.row_id, row)? else {
            self.out.ignored += 1;
            return Ok(());
        };
        let material = text(&row, "source_material_id").map(str::to_string);
        let cards = table.name == "card_versions";
        let mut id = change.row_id.clone();
        if let (true, Some(m)) = (cards, &material) {
            // UNIQUE(source_material_id, content_hash): the same cards under
            // another id (ids are content-derived, so only legacy rows differ)
            // are treated as that local version: the claim and first review
            // apply to the local id, nothing is inserted, and the incoming
            // children are skipped as shadowed (the local copy holds them).
            let hash = text(&row, "content_hash").ok_or(ApplyError::BadRow)?;
            let existing: Option<String> = self
                .conn
                .query_row(
                    "SELECT id FROM card_versions
                     WHERE source_material_id = ?1 AND content_hash = ?2 AND id != ?3",
                    params![m, hash, id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(existing) = existing {
                self.shadowed.insert((table.name, id));
                id = existing;
            }
        }
        let incoming_first = match (cards, &material, text(&row, "first_reviewed_at")) {
            (true, Some(m), Some(at)) if self.first_review_counts(m, at)? => Some(at.to_string()),
            _ => None,
        };
        let claim = (
            row.get("is_active").and_then(Value::as_i64) == Some(1),
            rank(
                parse_iso_ms(&change.changed_at).ok_or(ApplyError::BadRow)?,
                self.peer,
            ),
        );
        let local = self.meta(table.name, &id)?;
        let wins = incoming_wins(local.as_ref(), &change.changed_at, self.peer)?;
        let present = self.exists(table.name, table.primary_key, &Sql::Text(id.clone()))?;
        let mut changed = false;
        if !present {
            row.insert("is_active".into(), Value::from(0));
            if cards {
                row.insert(
                    "first_reviewed_at".into(),
                    incoming_first.map_or(Value::Null, Value::from),
                );
            }
            self.insert_row(table, &row, false)?;
            changed = true;
        } else if cards {
            let local_first: Option<String> = self.conn.query_row(
                "SELECT first_reviewed_at FROM card_versions WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )?;
            let merged = earliest(local_first.clone(), incoming_first);
            if merged != local_first {
                self.conn.execute(
                    "UPDATE card_versions SET first_reviewed_at = ?2 WHERE id = ?1",
                    params![id, merged],
                )?;
                changed = true;
            }
        }
        if !present || wins {
            self.claims.insert((table.name, id.clone()), claim);
            self.write_meta(table.name, &id, change, false)?;
            changed = true;
        }
        if changed {
            self.out.written += 1;
        } else {
            self.out.ignored += 1;
        }
        if let Some(m) = material {
            self.version_materials.insert((table.name, m));
        }
        Ok(())
    }

    /// Per touched material: the active version is the active claim with the
    /// newest `(changed_at, device_id)` pair (tie → lower device id, then
    /// lower version id). Others are demoted before the winner is set, so
    /// the partial unique index on `is_active = 1` never fires.
    fn activate_versions(&mut self) -> Result<(), ApplyError> {
        for (name, material) in std::mem::take(&mut self.version_materials) {
            let table = tables::table(name).ok_or(ApplyError::UnknownTable)?;
            let rows: Vec<(String, i64)> = self
                .conn
                .prepare(&format!(
                    "SELECT id, is_active FROM {} WHERE source_material_id = ?1",
                    quoted(table.name)
                ))?
                .query_map([&material], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            let mut best: Option<(Rank, Reverse<String>)> = None;
            for (id, stored) in rows {
                let (active, at) = match self.claims.get(&(name, id.clone())) {
                    Some(claim) => claim.clone(),
                    None => (stored == 1, self.local_rank(name, &id)?),
                };
                let key = (at, Reverse(id));
                if active && best.as_ref().is_none_or(|b| key > *b) {
                    best = Some(key);
                }
            }
            let winner = best.map(|(_, Reverse(id))| id);
            self.conn.execute(
                &format!(
                    "UPDATE {} SET is_active = 0
                     WHERE source_material_id = ?1 AND is_active = 1 AND id IS NOT ?2",
                    quoted(table.name)
                ),
                params![material, winner],
            )?;
            if let Some(winner) = winner {
                self.conn.execute(
                    &format!(
                        "UPDATE {} SET is_active = 1 WHERE id = ?1 AND is_active = 0",
                        quoted(table.name)
                    ),
                    [winner],
                )?;
            }
        }
        Ok(())
    }

    fn delete(&mut self, table: &'static SyncTable, change: &Change) -> Result<(), ApplyError> {
        // Union rows are write-once (parent deletes cascade, resets travel as
        // `Max`); review state is rebuilt by replay, never deleted by a file.
        if matches!(table.rule, MergeRule::Union | MergeRule::Replay) {
            self.out.ignored += 1;
            return Ok(());
        }
        let local = self.meta(table.name, &change.row_id)?;
        if !incoming_wins(local.as_ref(), &change.changed_at, self.peer)?
            || self.delete_blocked(table, &change.row_id)?
        {
            self.out.ignored += 1;
            return Ok(());
        }
        if table.rule == MergeRule::VersionActivation {
            let material: Option<Option<String>> = self
                .conn
                .query_row(
                    &format!(
                        "SELECT source_material_id FROM {} WHERE id = ?1",
                        quoted(table.name)
                    ),
                    [&change.row_id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(Some(m)) = material {
                self.version_materials.insert((table.name, m));
            }
        }
        self.conn.execute(
            &format!(
                "DELETE FROM {} WHERE {} = ?1",
                quoted(table.name),
                quoted(table.primary_key)
            ),
            [&change.row_id],
        )?;
        self.write_meta(table.name, &change.row_id, change, true)?;
        self.out.written += 1;
        Ok(())
    }

    /* ------------------------------ replay ----------------------------- */

    fn local_events(&self, item: &str) -> Result<Vec<replay::ReviewEvent>, ApplyError> {
        item_events(self.conn, item)
    }

    fn local_state(&self, item: &str) -> Result<Option<(StateRow, i64)>, ApplyError> {
        Ok(self
            .conn
            .query_row(
                "SELECT source_material_id, scheduler_version, step, due_at, last_reviewed_at,
                        reps, lapses, suspended, flag, revision
                 FROM card_review_state WHERE item_id = ?1",
                [item],
                |r| {
                    Ok((
                        StateRow {
                            material: r.get(0)?,
                            scheduler_version: r.get(1)?,
                            step: r.get(2)?,
                            due_at: r.get(3)?,
                            last_reviewed_at: r.get(4)?,
                            reps: r.get(5)?,
                            lapses: r.get(6)?,
                            suspended: r.get(7)?,
                            flag: r.get(8)?,
                        },
                        r.get(9)?,
                    ))
                },
            )
            .optional()?)
    }

    /// `Replay`: the schedule always comes from the local events (after the
    /// Union inserts above); the file's schedule columns are never written.
    /// Then each kept event's prior/next state is re-derived from the fold, so
    /// every device holds one history (backup step 9).
    /// `suspended`/`flag` come from the file's row only when it wins LWW,
    /// else they stay as they are here: replay never clears them.
    fn replay_touched(&mut self) -> Result<(), ApplyError> {
        let state_table = tables::table(STATE).ok_or(ApplyError::UnknownTable)?;
        for item in std::mem::take(&mut self.touched) {
            let change = self.states.get(&item).copied();
            let Some(material) = self.material_of_item(&item)? else {
                // The card is not here: only a state row can name it.
                if let Some(change) = change {
                    let row = change.row.as_ref().ok_or(ApplyError::BadRow)?;
                    if self.resolve_parents(state_table, &item, row)?.is_none() {
                        self.out.ignored += 1;
                    }
                }
                continue;
            };
            let events = self.local_events(&item)?;
            let folded = replay::fold_item(&events, self.generation(&material)?)
                .map_err(ApplyError::Replay)?;
            rewrite_event_states(self.conn, &folded)?;
            let schedule = folded.last().map(|f| f.next.clone());
            let local = self.local_state(&item)?;
            let incoming = match change {
                Some(c)
                    if incoming_wins(
                        self.meta(STATE, &item)?.as_ref(),
                        &c.changed_at,
                        self.peer,
                    )? =>
                {
                    Some(c)
                }
                Some(_) => {
                    self.out.ignored += 1;
                    None
                }
                None => None,
            };
            let Some(s) = schedule else {
                // No rated event (e.g. a never-rated card suspended): plain LWW.
                // A row that carries a schedule but has no event at the barrier
                // was rated before a reset this device has: it is dropped.
                if let Some(c) = incoming {
                    let row = c.row.as_ref().ok_or(ApplyError::BadRow)?;
                    let unrated = row.get("due_at").is_none_or(Value::is_null)
                        && row.get("reps").and_then(Value::as_i64).unwrap_or(0) == 0;
                    if !unrated {
                        self.out.ignored += 1;
                        continue;
                    }
                    match self.resolve_parents(state_table, &item, row)? {
                        Some(row) => {
                            self.insert_row(state_table, &row, true)?;
                            self.write_meta(STATE, &item, c, false)?;
                            self.out.written += 1;
                        }
                        None => self.out.ignored += 1,
                    }
                }
                continue;
            };
            let (suspended, flag) = match (incoming, &local) {
                (Some(c), _) => {
                    let row = c.row.as_ref().ok_or(ApplyError::BadRow)?;
                    let suspended = match row.get("suspended").and_then(Value::as_i64) {
                        Some(n @ (0 | 1)) => n,
                        _ => return Err(ApplyError::BadRow),
                    };
                    let flag = match row.get("flag") {
                        None | Some(Value::Null) => None,
                        Some(Value::String(f)) => Some(f.clone()),
                        _ => return Err(ApplyError::BadRow),
                    };
                    (suspended, flag)
                }
                (None, Some((l, _))) => (l.suspended, l.flag.clone()),
                (None, None) => (0, None),
            };
            let next = StateRow {
                material,
                scheduler_version: s.scheduler_version,
                step: s.step,
                due_at: Some(s.due_at),
                last_reviewed_at: Some(s.last_reviewed_at),
                reps: s.reps,
                lapses: s.lapses,
                suspended,
                flag,
            };
            let meta_from = incoming;
            if local.as_ref().is_some_and(|(l, _)| *l == next) {
                if let Some(c) = meta_from {
                    self.write_meta(STATE, &item, c, false)?;
                }
                continue;
            }
            // Never below the rating count, which backup verification requires.
            let revision = local
                .as_ref()
                .map_or(1, |(_, r)| r + 1)
                .max(events.len() as i64);
            self.conn.execute(
                "INSERT INTO card_review_state
                   (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at,
                    reps, lapses, suspended, flag, revision)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(item_id) DO UPDATE SET
                   source_material_id = excluded.source_material_id,
                   scheduler_version = excluded.scheduler_version, step = excluded.step,
                   due_at = excluded.due_at, last_reviewed_at = excluded.last_reviewed_at,
                   reps = excluded.reps, lapses = excluded.lapses, suspended = excluded.suspended,
                   flag = excluded.flag, revision = excluded.revision",
                params![
                    item,
                    next.material,
                    next.scheduler_version,
                    next.step,
                    next.due_at,
                    next.last_reviewed_at,
                    next.reps,
                    next.lapses,
                    next.suspended,
                    next.flag,
                    revision
                ],
            )?;
            if let Some(c) = meta_from {
                self.write_meta(STATE, &item, c, false)?;
            } else if local.is_none() {
                // A new row with local values: the newest file change behind it.
                if let Some(at) = self.item_changed_at.get(&item) {
                    self.conn.execute(
                        "INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
                         VALUES (?1, ?2, ?3, ?4, 0)
                         ON CONFLICT (table_name, row_id) DO UPDATE SET
                           device_id = excluded.device_id, changed_at = excluded.changed_at,
                           deleted = 0",
                        params![STATE, item, self.peer, at],
                    )?;
                }
            }
            self.out.written += 1;
            self.out.replayed_items += 1;
        }
        Ok(())
    }
}
