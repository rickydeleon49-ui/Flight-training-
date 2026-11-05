//! Turn the local change log into a change file. Reads only; writes nothing.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

use crate::sync::changeset::{self, Change, ChangeSet, Op, CHANGE_FORMAT_VERSION};
use crate::sync::tables;

const EXPORTED_KEY: &str = "exported_through_seq";
const FLOOR_KEY: &str = "sync_floor_seq";

pub(crate) struct ExportedChanges {
    pub file: changeset::EncodedChangeFile,
    pub from_seq: i64,
    pub to_seq: i64,
    pub change_count: usize,
}

#[derive(Debug)]
pub(crate) enum ExportError {
    Db(rusqlite::Error),
    Encode(changeset::ChangeFileError),
    /// A ledger entry whose row or metadata is gone.
    Inconsistent,
    UnknownTable,
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db(_) => f.write_str("the change log could not be read"),
            Self::Encode(e) => write!(f, "{e}"),
            Self::Inconsistent => f.write_str("the change log does not match the data"),
            Self::UnknownTable => f.write_str("the change log names an unknown table"),
        }
    }
}

impl std::error::Error for ExportError {}

impl From<rusqlite::Error> for ExportError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e)
    }
}

/// The changes after `since_seq`, one per row (its last logged op), or `None`
/// when nothing is new. Everything is read in one transaction; nothing is
/// written. The caller writes the file, fsyncs it, and only then calls
/// `set_exported_through_seq(to_seq)`.
pub(crate) fn export_changes_in(
    conn: &mut Connection,
    device_id: &str,
    since_seq: i64,
    app_version: &str,
    created_at: &str,
) -> Result<Option<ExportedChanges>, ExportError> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let to_seq: Option<i64> =
        tx.query_row("SELECT MAX(seq) FROM local_changes", [], |r| r.get(0))?;
    let to_seq = match to_seq {
        Some(n) if n > since_seq => n,
        _ => return Ok(None),
    };
    let from_seq = since_seq + 1;
    let logged: Vec<(i64, String, String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT seq, table_name, row_id, op FROM local_changes
             WHERE seq BETWEEN ?1 AND ?2
               AND seq = (SELECT MAX(l2.seq) FROM local_changes l2
                          WHERE l2.table_name = local_changes.table_name
                            AND l2.row_id = local_changes.row_id
                            AND l2.seq BETWEEN ?1 AND ?2)
             ORDER BY seq",
        )?;
        let rows = stmt.query_map([from_seq, to_seq], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?;
        rows.collect::<Result<_, _>>()?
    };
    let mut changes = Vec::with_capacity(logged.len());
    for (seq, table_name, row_id, op) in logged {
        let table = tables::table(&table_name).ok_or(ExportError::UnknownTable)?;
        let (changed_at, deleted): (String, i64) = tx
            .query_row(
                "SELECT changed_at, deleted FROM sync_row_meta
                 WHERE table_name = ?1 AND row_id = ?2",
                [&table_name, &row_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or(ExportError::Inconsistent)?;
        let (op, row) = if op == "delete" || deleted == 1 {
            (Op::Delete, None)
        } else {
            let row =
                tables::read_row_json(&tx, table, &row_id)?.ok_or(ExportError::Inconsistent)?;
            (
                if op == "insert" {
                    Op::Insert
                } else {
                    Op::Update
                },
                Some(row),
            )
        };
        changes.push(Change {
            seq,
            table: table_name,
            row_id,
            op,
            changed_at,
            row,
        });
    }
    drop(tx); // nothing was written: rolls back
    let change_count = changes.len();
    let file = changeset::encode(&ChangeSet {
        format_version: CHANGE_FORMAT_VERSION,
        schema_version: crate::CURRENT_SCHEMA_VERSION,
        device_id: device_id.to_string(),
        app_version: app_version.to_string(),
        created_at: created_at.to_string(),
        from_seq,
        to_seq,
        changes,
    })
    .map_err(ExportError::Encode)?;
    Ok(Some(ExportedChanges {
        file,
        from_seq,
        to_seq,
        change_count,
    }))
}

/// Missing means nothing has been exported yet.
pub(crate) fn exported_through_seq(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            [EXPORTED_KEY],
            |r| r.get(0),
        )
        .optional()?;
    Ok(value.and_then(|v| v.parse().ok()).unwrap_or(0))
}

pub(crate) fn set_exported_through_seq(
    conn: &Connection,
    to_seq: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        rusqlite::params![EXPORTED_KEY, to_seq.to_string()],
    )?;
    Ok(())
}

/// Where this device's own exports start: whatever the change log held when a
/// restore put it there. Stored as text; missing, junk or negative means 0.
pub(crate) fn sync_floor_seq(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let value: Option<String> = conn
        .query_row(
            "SELECT CAST(value AS TEXT) FROM app_metadata WHERE key = ?1",
            [FLOOR_KEY],
            |r| r.get(0),
        )
        .optional()?;
    Ok(value
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0))
}
