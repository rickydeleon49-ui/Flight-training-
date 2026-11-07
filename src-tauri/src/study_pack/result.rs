//! What an import tells her afterwards, read back from its receipt row, and
//! the plain sentences built from it (design sections 3 and 7).

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use super::guard::pack_sql;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    pub operation_id: String,
    pub pack_id: String,
    pub added: u64,
    pub added_guides: u64,
    pub added_documents: u64,
    pub added_pictures: u64,
    pub added_practice: u64,
    pub skipped: u64,
    pub new_versions: u64,
    pub readded: u64,
    pub cards_left_out: u64,
    pub cards_left_out_removed: u64,
    pub committed_at: String,
}

const COLUMNS: &str = "operation_id, pack_id, added, added_guides, added_documents,
    added_pictures, added_practice, skipped, new_versions, readded, cards_left_out,
    cards_left_out_removed, committed_at";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<PackResult> {
    let n = |i: usize| r.get::<_, i64>(i).map(|v| v.max(0) as u64);
    Ok(PackResult {
        operation_id: r.get(0)?,
        pack_id: r.get(1)?,
        added: n(2)?,
        added_guides: n(3)?,
        added_documents: n(4)?,
        added_pictures: n(5)?,
        added_practice: n(6)?,
        skipped: n(7)?,
        new_versions: n(8)?,
        readded: n(9)?,
        cards_left_out: n(10)?,
        cards_left_out_removed: n(11)?,
        committed_at: r.get(12)?,
    })
}

fn failed(e: rusqlite::Error) -> String {
    format!("Could not read the study pack record: {e}")
}

pub fn read_result(conn: &Connection, op_id: &str) -> Result<Option<PackResult>, String> {
    let sql = format!("SELECT {COLUMNS} FROM study_pack_imports WHERE operation_id = ?1");
    conn.query_row(pack_sql(&sql)?, [op_id], row)
        .optional()
        .map_err(failed)
}

/// Receipts she has not been told about yet, oldest first.
pub fn pending_results(conn: &Connection) -> Result<Vec<PackResult>, String> {
    let sql = format!(
        "SELECT {COLUMNS} FROM study_pack_imports i
         WHERE NOT EXISTS (SELECT 1 FROM study_pack_acks a WHERE a.operation_id = i.operation_id)
         ORDER BY committed_at, operation_id"
    );
    let mut statement = conn.prepare(pack_sql(&sql)?).map_err(failed)?;
    let rows = statement.query_map([], row).map_err(failed)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(failed)
}

/// Insert-only: telling her twice is harmless, and an unknown id is refused.
pub fn ack(conn: &Connection, op_id: &str, now: &str) -> Result<(), String> {
    let sql = "INSERT INTO study_pack_acks (operation_id, acked_at)
               SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM study_pack_imports WHERE operation_id = ?1)
                 AND NOT EXISTS (SELECT 1 FROM study_pack_acks WHERE operation_id = ?1)";
    conn.execute(pack_sql(sql)?, [op_id, now]).map_err(failed)?;
    Ok(())
}

#[allow(dead_code)] // used by the Stage 3 screen
pub fn other_versions_line(count: u64) -> Option<String> {
    match count {
        0 => None,
        1 => Some(
            "1 is another version of a guide or PDF you have, added next to yours (marked \u{201c}updated\u{201d})."
                .to_string(),
        ),
        n => Some(format!(
            "{n} are other versions of guides or PDFs you have, added next to yours (marked \u{201c}updated\u{201d})."
        )),
    }
}

/// "Added 11 guides, 3 PDFs and 1 practice set. Your own work wasn't changed."
#[allow(dead_code)] // used by the Stage 3 screen
pub fn success_sentence(result: &PackResult) -> String {
    if result.added == 0 {
        return "Everything in this study pack is already in your library.".to_string();
    }
    let plural = |n: u64, one: &str, many: &str| {
        (n > 0).then(|| format!("{n} {}", if n == 1 { one } else { many }))
    };
    let parts: Vec<String> = [
        plural(result.added_guides, "guide", "guides"),
        plural(result.added_documents, "PDF", "PDFs"),
        plural(result.added_practice, "practice set", "practice sets"),
    ]
    .into_iter()
    .flatten()
    .collect();
    let named = match parts.as_slice() {
        [] => return "Your study pack was added. Your own work wasn't changed.".to_string(),
        [one] => one.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    };
    format!("Added {named}. Your own work wasn't changed.")
}
