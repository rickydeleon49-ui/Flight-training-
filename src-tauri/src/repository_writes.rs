//! Atomic replacements for the small repository writes that otherwise use the SQL pool.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use std::{path::Path, time::Duration};
use tauri::AppHandle;

const STORAGE_ERROR: &str = "A storage problem stopped this save. Nothing has been saved.";
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    Journal,
    Schedule,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FundGoal {
    id: String,
    title: String,
    target: i64,
    active: bool,
    created_at: String,
    updated_at: String,
}
fn open(root: &Path) -> Result<Connection, String> {
    let path = root.join("her-flight-deck.db");
    if !path.is_file() {
        return Err(STORAGE_ERROR.into());
    }
    let conn = Connection::open(path).map_err(|_| STORAGE_ERROR)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| STORAGE_ERROR)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| STORAGE_ERROR)?;
    Ok(conn)
}
fn replace_links(
    conn: &mut Connection,
    kind: LinkKind,
    id: &str,
    ids: &[String],
) -> rusqlite::Result<()> {
    let (table, column) = match kind {
        LinkKind::Journal => ("journal_materials", "journal_id"),
        LinkKind::Schedule => ("event_materials", "event_id"),
    };
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(&format!("DELETE FROM {table} WHERE {column} = ?1"), [id])?;
    for material_id in ids {
        tx.execute(
            &format!("INSERT INTO {table} ({column}, material_id) VALUES (?1, ?2)"),
            params![id, material_id],
        )?;
    }
    tx.commit()
}
fn create_goal(conn: &mut Connection, goal: &FundGoal) -> Result<(), String> {
    if !goal.active {
        return Err("The new savings target must be active.".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| STORAGE_ERROR)?;
    let existing = tx
        .query_row(
            "SELECT title, target, created_at FROM fund_goals WHERE id = ?1",
            [&goal.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|_| STORAGE_ERROR)?;
    if let Some(existing) = existing {
        if existing != (goal.title.clone(), goal.target, goal.created_at.clone()) {
            return Err("This savings target save was already used with different values.".into());
        }
    } else {
        tx.execute(
            "UPDATE fund_goals SET active = 0, updated_at = ?1",
            [&goal.updated_at],
        )
        .map_err(|_| STORAGE_ERROR)?;
        tx.execute("INSERT INTO fund_goals (id, title, target, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)", params![goal.id, goal.title, goal.target, goal.created_at, goal.updated_at]).map_err(|_| STORAGE_ERROR)?;
    }
    tx.commit().map_err(|_| STORAGE_ERROR.into())
}
#[tauri::command]
pub async fn replace_material_links_atomically(
    app: AppHandle,
    kind: LinkKind,
    id: String,
    material_ids: Vec<String>,
) -> Result<(), String> {
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        replace_links(&mut open(&root)?, kind, &id, &material_ids).map_err(|_| STORAGE_ERROR.into())
    })
    .await
    .map_err(|_| STORAGE_ERROR)?
}
#[tauri::command]
pub async fn create_fund_goal_atomically(app: AppHandle, goal: FundGoal) -> Result<(), String> {
    let root = crate::storage::app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || create_goal(&mut open(&root)?, &goal))
        .await
        .map_err(|_| STORAGE_ERROR)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("../migrations/0001_initial_schema.sql"))
            .unwrap();
        db.pragma_update(None, "foreign_keys", "ON").unwrap();
        db.execute_batch("INSERT INTO journal_entries (id,date,created_at,updated_at) VALUES ('p','','',''); INSERT INTO schedule_events (id,title,date,created_at,updated_at) VALUES ('p','','','',''); INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('old','','',''),('a','','',''),('b','','','');").unwrap();
        db
    }
    fn links_test(kind: LinkKind, table: &str) {
        for failed in ["a", "b"] {
            let mut db = database();
            replace_links(&mut db, kind, "p", &["old".into()]).unwrap();
            db.execute_batch(&format!("CREATE TRIGGER fail_link BEFORE INSERT ON {table} WHEN NEW.material_id = '{failed}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;")).unwrap();
            let ids = ["a".into(), "b".into()];
            assert!(replace_links(&mut db, kind, "p", &ids).is_err());
            let read = |db: &Connection| {
                db.prepare(&format!(
                    "SELECT material_id FROM {table} ORDER BY material_id"
                ))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
            };
            assert_eq!(read(&db), ["old"]);
            db.execute_batch("DROP TRIGGER fail_link").unwrap();
            replace_links(&mut db, kind, "p", &ids).unwrap();
            replace_links(&mut db, kind, "p", &ids).unwrap();
            assert_eq!(read(&db), ["a", "b"]);
            assert!(replace_links(&mut db, kind, "p", &["missing".into()]).is_err());
            assert_eq!(read(&db), ["a", "b"]);
            replace_links(&mut db, kind, "p", &[]).unwrap();
            assert!(read(&db).is_empty());
        }
    }
    #[test]
    fn journal_links_rollback_and_success() {
        links_test(LinkKind::Journal, "journal_materials");
    }
    #[test]
    fn schedule_links_rollback_and_success() {
        links_test(LinkKind::Schedule, "event_materials");
    }
    fn goal(id: &str) -> FundGoal {
        FundGoal {
            id: id.into(),
            title: id.into(),
            target: 100,
            active: true,
            created_at: "original".into(),
            updated_at: format!("changed-{id}"),
        }
    }
    #[test]
    fn goal_rollback_success_and_retry() {
        let mut db = database();
        create_goal(&mut db, &goal("old")).unwrap();
        db.execute_batch("CREATE TRIGGER fail_goal BEFORE INSERT ON fund_goals BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").unwrap();
        assert!(create_goal(&mut db, &goal("new")).is_err());
        let old: (i64, String, i64) = db.query_row("SELECT active, updated_at, (SELECT count(*) FROM fund_goals) FROM fund_goals WHERE id='old'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(old, (1, "changed-old".into(), 1));
        db.execute_batch("DROP TRIGGER fail_goal").unwrap();
        create_goal(&mut db, &goal("new")).unwrap();
        create_goal(&mut db, &goal("old")).unwrap();
        let active: String = db
            .query_row("SELECT id FROM fund_goals WHERE active=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(active, "new");
        let mut conflict = goal("old");
        conflict.target = 999;
        assert!(create_goal(&mut db, &conflict).is_err());
    }
}
