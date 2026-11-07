//! The runtime guard behind invariant I1 (design section 0): an import only
//! inserts. Every pack statement goes through `pack_sql`, and the commit
//! connection carries temporary triggers that abort any write that would
//! change one of her existing rows.
//!
//! This is the one file in `study_pack/` that spells the forbidden SQL words,
//! because it has to name them to refuse them. The grep test skips it.

use rusqlite::Connection;

/// The sync ledger is written by triggers that upsert (migration 0033), so it
/// is the one set of tables the guard cannot cover.
pub const EXCLUDED_TABLES: [&str; 3] = ["local_changes", "sync_row_meta", "sync_applied"];

pub const ABORT_TEXT: &str = "PACK_I1";

const FORBIDDEN_WORDS: [&str; 5] = ["REPLACE", "UPDATE", "DELETE", "PRAGMA", "CONFLICT"];

/// Accept only a single literal `INSERT INTO ...` or `SELECT ...` that has none
/// of the words that can change an existing row. Case, comments and extra
/// whitespace do not matter.
pub fn pack_sql(sql: &str) -> Result<&str, String> {
    let mut plain = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '-' if chars.peek() == Some(&'-') => {
                for n in chars.by_ref() {
                    if n == '\n' {
                        break;
                    }
                }
                plain.push(' ');
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for n in chars.by_ref() {
                    if previous == '*' && n == '/' {
                        break;
                    }
                    previous = n;
                }
                plain.push(' ');
            }
            _ => plain.push(c),
        }
    }
    let upper = plain.to_uppercase();
    let trimmed = upper.trim().trim_end_matches(';').trim_end();
    let starts_ok = trimmed.starts_with("INSERT INTO ") || trimmed.starts_with("SELECT ");
    let one_statement = !trimmed.contains(';');
    let words_ok = !trimmed
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .any(|word| FORBIDDEN_WORDS.contains(&word));
    if starts_ok && one_statement && words_ok {
        Ok(sql)
    } else {
        Err(format!("{ABORT_TEXT}: statement refused"))
    }
}

/// The tables that get a guard trigger: every real table, in the main schema,
/// except SQLite's own, virtual and shadow tables, and the sync ledger.
pub fn guarded_tables(conn: &Connection) -> Result<Vec<String>, String> {
    let read = |sql: &str| -> Result<Vec<(String, String)>, String> {
        let mut statement = conn
            .prepare(sql)
            .map_err(|e| format!("Could not read the library structure: {e}"))?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Could not read the library structure: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the library structure: {e}"))
    };
    let tables = read("SELECT name, sql FROM main.sqlite_master WHERE type = 'table' ORDER BY name")?;
    let virtual_names: Vec<String> = tables
        .iter()
        .filter(|(_, sql)| sql.to_uppercase().starts_with("CREATE VIRTUAL"))
        .map(|(name, _)| name.clone())
        .collect();
    Ok(tables
        .into_iter()
        .filter(|(name, sql)| {
            !name.to_lowercase().starts_with("sqlite_")
                && !sql.to_uppercase().starts_with("CREATE VIRTUAL")
                && !virtual_names.iter().any(|v| name.starts_with(&format!("{v}_")))
                && !EXCLUDED_TABLES.contains(&name.as_str())
        })
        .map(|(name, _)| name)
        .collect())
}

/// Turn the guard on for this connection. Call inside the commit transaction.
/// `recursive_triggers` makes a replace-style write fire the delete trigger
/// too; the triggers alone are never trusted for that, `pack_sql` refuses it.
pub fn install(conn: &Connection) -> Result<(), String> {
    let fail = |e: rusqlite::Error| format!("Could not protect your library: {e}");
    conn.pragma_update(None, "recursive_triggers", true)
        .map_err(fail)?;
    for (index, table) in guarded_tables(conn)?.iter().enumerate() {
        for (kind, op) in [("u", "UPDATE"), ("d", "DELETE")] {
            let quoted = table.replace('"', "\"\"");
            conn.execute_batch(&format!(
                "CREATE TEMP TRIGGER pack_i1_{kind}_{index} BEFORE {op} ON main.\"{quoted}\"
                 BEGIN SELECT RAISE(ABORT, '{ABORT_TEXT}'); END;"
            ))
            .map_err(fail)?;
        }
    }
    Ok(())
}

/// Run a content statement through `pack_sql` first.
pub fn execute(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<usize, String> {
    let sql = pack_sql(sql)?;
    conn.execute(sql, params)
        .map_err(|e| format!("Could not add the study pack: {e}"))
}
