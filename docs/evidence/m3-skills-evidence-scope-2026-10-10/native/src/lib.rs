//! DISPOSABLE M3 prototype: the native twin of
//! `prototype/skillEvidenceValidation.ts` (`validateSkillEvidenceState`),
//! on the same rusqlite 0.32.1 / bundled SQLite the app links.
//!
//! The production slice moves `verify_schema_14_skill_evidence_semantics`
//! into `src-tauri/src/backup.rs` next to `verify_schema_13_lineage_semantics`
//! and calls it from `verify_application_connection` for `newest >= 14`.

use rusqlite::{params_from_iter, types::Value, Connection};
use unicode_normalization::UnicodeNormalization;

/// The shipped migrations 0001-0013, read from the repository unchanged.
pub const SHIPPED: [&str; 13] = [
    include_str!("../../../../../src-tauri/migrations/0001_initial_schema.sql"),
    include_str!("../../../../../src-tauri/migrations/0002_profile_details.sql"),
    include_str!("../../../../../src-tauri/migrations/0003_personal_note.sql"),
    include_str!("../../../../../src-tauri/migrations/0004_app_metadata.sql"),
    include_str!("../../../../../src-tauri/migrations/0005_flight_log.sql"),
    include_str!("../../../../../src-tauri/migrations/0006_pilot_toolkit.sql"),
    include_str!("../../../../../src-tauri/migrations/0007_ai_study.sql"),
    include_str!("../../../../../src-tauri/migrations/0008_notes.sql"),
    include_str!("../../../../../src-tauri/migrations/0009_practice_tests.sql"),
    include_str!("../../../../../src-tauri/migrations/0010_debrief_links.sql"),
    include_str!("../../../../../src-tauri/migrations/0011_practice_sessions.sql"),
    include_str!("../../../../../src-tauri/migrations/0012_card_reviews.sql"),
    include_str!("../../../../../src-tauri/migrations/0013_split_source_lineage.sql"),
];

/// The candidate migration from this evidence pack.
pub const CANDIDATE: &str = include_str!("../../candidate/0014_skills_evidence.sql");
pub const CANDIDATE_VERSION: i64 = 14;

pub const M3_TABLES: [&str; 6] = [
    "skill_catalog_entries",
    "skill_catalog_revisions",
    "skill_observations",
    "skill_observation_revisions",
    "skill_self_assessments",
    "skill_evidence_operations",
];

pub const M3_INDEXES: [(&str, &str); 6] = [
    ("skill_observations", "idx_skill_observations_page"),
    ("skill_observations", "idx_skill_observations_skill_page"),
    ("skill_observations", "idx_skill_observations_journal"),
    ("skill_observations", "idx_skill_observations_source_journal"),
    ("skill_observations", "idx_skill_observations_action"),
    ("skill_evidence_operations", "idx_skill_evidence_operations_subject"),
];

pub const M3_TRIGGERS: [&str; 6] = [
    "trg_skill_catalog_revisions_no_update",
    "trg_skill_catalog_revisions_no_delete",
    "trg_skill_observation_revisions_no_update",
    "trg_skill_observation_revisions_no_partial_delete",
    "trg_skill_self_assessments_no_update",
    "trg_skill_self_assessments_no_delete",
];

const MAX_CUSTOM_SKILLS: i64 = 200;

/// JavaScript's `\s` and `String.prototype.trim` set (ECMAScript WhiteSpace and
/// LineTerminator). Deliberately not `char::is_whitespace`, which differs at
/// U+0085 and U+FEFF.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// The write path's duplicate-name key (TS `labelKey`): NFC, trimmed, runs of
/// whitespace collapsed to one space, then lower-cased.
pub fn label_key(label: &str) -> String {
    let nfc: String = label.nfc().collect();
    let mut collapsed = String::with_capacity(nfc.len());
    let mut in_space = false;
    for c in nfc.trim_matches(is_js_space).chars() {
        if is_js_space(c) {
            if !in_space {
                collapsed.push(' ');
            }
            in_space = true;
        } else {
            collapsed.push(c);
            in_space = false;
        }
    }
    collapsed.to_lowercase()
}

pub const SKILL_ACTIONS: [&str; 4] = ["create_custom_skill", "edit_custom_skill", "retire_skill", "restore_skill"];
pub const OBSERVATION_HISTORY_ACTIONS: [&str; 5] = ["create_observation", "edit_observation", "link_action", "unlink_action", "set_addressed"];
pub const ASSESSMENT_ACTIONS: [&str; 2] = ["set_status", "set_confidence"];

/// The decoded number a result carries (`revision` or `sequence`), or the erase flag.
#[derive(Debug, PartialEq, Eq)]
pub enum ResultValue {
    Number(i64),
    Erased,
}

const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// TS `Number.isSafeInteger(v) && v >= 1`, applied to a JSON number.
fn positive(v: &serde_json::Value) -> Option<i64> {
    let f = v.as_f64()?;
    if !v.is_number() || f.fract() != 0.0 || !(1.0..=MAX_SAFE).contains(&f) {
        return None;
    }
    Some(f as i64)
}

/// Exact result decoding (TS `decodeStoredResult`): exactly the keys of the
/// action, the right types and ranges, and the receipt's own subject.
pub fn decode_result(text: Option<&str>, action: &str, subject: &str) -> Result<ResultValue, String> {
    let parsed: serde_json::Value = serde_json::from_str(text.ok_or("The result is missing.")?).map_err(|_| "The result is not readable.")?;
    let object = parsed.as_object().ok_or("A result must be an object.")?;
    let (subject_key, value_key) = if SKILL_ACTIONS.contains(&action) {
        ("skillId", "revision")
    } else if OBSERVATION_HISTORY_ACTIONS.contains(&action) {
        ("observationId", "revision")
    } else if ASSESSMENT_ACTIONS.contains(&action) {
        ("skillId", "sequence")
    } else if action == "erase_observation" {
        ("observationId", "erased")
    } else {
        return Err("Unknown action.".into());
    };
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let mut wanted = vec!["action", subject_key, value_key];
    wanted.sort_unstable();
    if keys != wanted {
        return Err(format!("A {action} result has exactly: {}.", wanted.join(", ")));
    }
    if object.get("action").and_then(|a| a.as_str()) != Some(action) {
        return Err("The result belongs to a different action.".into());
    }
    if object.get(subject_key).and_then(|s| s.as_str()) != Some(subject) {
        return Err("The result names a different subject.".into());
    }
    if action == "erase_observation" {
        return if object.get("erased") == Some(&serde_json::Value::Bool(true)) {
            Ok(ResultValue::Erased)
        } else {
            Err("An erase result must say erased: true.".into())
        };
    }
    let n = positive(&object[value_key]).ok_or(format!("{value_key} must be a positive whole number."))?;
    let creates = action == "create_custom_skill" || action == "create_observation";
    if value_key == "revision" && (if creates { n != 1 } else { n < 2 }) {
        return Err("The result revision does not fit its action.".into());
    }
    Ok(ResultValue::Number(n))
}

/// Apply 0001-0013 (and optionally the candidate, possibly edited) with the
/// same `schema_migrations` bookkeeping as the TS adapters. The candidate runs
/// in one transaction, so a failure leaves the library at 13.
pub fn migrate(conn: &Connection, candidate: Option<&str>) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL)",
    )
    .map_err(|e| e.to_string())?;
    let applied = |v: i64| -> Result<bool, String> {
        conn.query_row("SELECT COUNT(*) FROM schema_migrations WHERE version = ?1", [v], |r| r.get::<_, i64>(0))
            .map(|n| n > 0)
            .map_err(|e| e.to_string())
    };
    for (i, sql) in SHIPPED.iter().enumerate() {
        let version = i as i64 + 1;
        if applied(version)? {
            continue;
        }
        conn.execute_batch(sql).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?1, 'shipped', 'x')",
            [version],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(sql) = candidate {
        if !applied(CANDIDATE_VERSION)? {
            conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
            let result = conn.execute_batch(sql).and_then(|_| {
                conn.execute(
                    "INSERT INTO schema_migrations (version, description, applied_at) VALUES (14, 'skills_evidence', 'x')",
                    [],
                )
                .map(|_| ())
            });
            match result {
                Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string())?,
                Err(e) => {
                    let _ = conn.execute_batch("ROLLBACK");
                    return Err(e.to_string());
                }
            }
        }
    }
    Ok(())
}

pub fn reference() -> Result<Connection, String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    migrate(&conn, Some(CANDIDATE))?;
    Ok(conn)
}

type Row = Vec<(String, Value)>;

fn rows(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Row>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = statement.column_names().iter().map(|s| s.to_string()).collect();
    let mapped = statement
        .query_map(params_from_iter(params.iter()), |r| {
            let mut out = Vec::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                out.push((name.clone(), r.get::<_, Value>(i)?));
            }
            Ok(out)
        })
        .map_err(|e| e.to_string())?;
    mapped.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn get<'a>(row: &'a Row, key: &str) -> &'a Value {
    row.iter().find(|(k, _)| k == key).map(|(_, v)| v).unwrap_or(&Value::Null)
}

/// Text form used for comparisons (TS `str`): NULL stays None.
fn text(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::Integer(i) => Some(i.to_string()),
        Value::Real(f) => Some(f.to_string()),
        Value::Text(s) => Some(s.clone()),
        Value::Blob(b) => Some(format!("{b:?}")),
    }
}

fn int(v: &Value) -> i64 {
    match v {
        Value::Integer(i) => *i,
        Value::Text(s) => s.parse().unwrap_or(-1),
        _ => -1,
    }
}

fn count(conn: &Connection, sql: &str, params: &[Value]) -> Result<i64, String> {
    Ok(rows(conn, sql, params)?.first().map(|r| int(&r[0].1)).unwrap_or(0))
}

/// Comments removed, whitespace collapsed, lower-cased (TS `normalizeSql`).
pub fn normalize_sql(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut clean = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '-' && chars.get(i + 1) == Some(&'-') {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else {
            clean.push(chars[i]);
            i += 1;
        }
    }
    clean.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// CHECK expressions of a CREATE TABLE, whitespace/quotes removed, sorted (TS `checkConstraints`).
pub fn check_constraints(sql: &str) -> Vec<String> {
    let chars: Vec<char> = normalize_sql(sql).chars().collect();
    let is_word = |c: Option<&char>| c.map(|c| c.is_ascii_alphanumeric() || *c == '_').unwrap_or(false);
    let mut checks = Vec::new();
    let mut in_quote = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' {
            in_quote = !in_quote;
            i += 1;
            continue;
        }
        let at_check = !in_quote
            && chars.len() >= i + 5
            && chars[i..i + 5].iter().collect::<String>() == "check"
            && (i == 0 || !is_word(chars.get(i - 1)))
            && !is_word(chars.get(i + 5));
        if !at_check {
            i += 1;
            continue;
        }
        let mut j = i + 5;
        while chars.get(j) == Some(&' ') {
            j += 1;
        }
        if chars.get(j) != Some(&'(') {
            i += 5;
            continue;
        }
        let mut depth = 0;
        let mut quoted = false;
        let mut expression = String::new();
        while j < chars.len() {
            let d = chars[j];
            if d == '\'' {
                quoted = !quoted;
            } else if !quoted && d == '(' {
                depth += 1;
            } else if !quoted && d == ')' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            if depth > 0 && !(depth == 1 && d == '(' && expression.is_empty()) {
                expression.push(d);
            }
            j += 1;
        }
        checks.push(expression.chars().filter(|ch| !ch.is_whitespace() && *ch != '"' && *ch != '`').collect());
        i = j + 1;
    }
    checks.sort();
    checks
}

fn columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    Ok(rows(
        conn,
        &format!("SELECT name, type, \"notnull\" AS required, pk, dflt_value FROM pragma_table_info('{table}') ORDER BY name"),
        &[],
    )?
    .iter()
    .map(|r| {
        format!(
            "{}|{}|{}|{}|{}",
            text(get(r, "name")).unwrap_or_default(),
            text(get(r, "type")).unwrap_or_default().to_lowercase(),
            int(get(r, "required")),
            int(get(r, "pk")),
            text(get(r, "dflt_value")).unwrap_or_default()
        )
    })
    .collect())
}

fn foreign_keys(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let list = rows(
        conn,
        &format!(
            "SELECT id, \"table\" AS parent, \"from\" AS child, \"to\" AS target, on_update, on_delete, \"match\" AS matching
               FROM pragma_foreign_key_list('{table}') ORDER BY id, seq"
        ),
        &[],
    )?;
    let mut grouped: Vec<(i64, Vec<String>)> = Vec::new();
    for r in &list {
        let id = int(get(r, "id"));
        let child = format!(
            "{}>{}",
            text(get(r, "child")).unwrap_or_default().to_lowercase(),
            text(get(r, "target")).unwrap_or_default().to_lowercase()
        );
        if let Some(entry) = grouped.iter_mut().find(|(g, _)| *g == id) {
            entry.1.push(child);
        } else {
            let head = [
                text(get(r, "parent")).unwrap_or_default().to_lowercase(),
                text(get(r, "on_update")).unwrap_or_default().to_uppercase(),
                text(get(r, "on_delete")).unwrap_or_default().to_uppercase(),
                text(get(r, "matching")).unwrap_or_default().to_uppercase(),
            ]
            .join("|");
            grouped.push((id, vec![head, child]));
        }
    }
    let mut out: Vec<String> = grouped.into_iter().map(|(_, e)| e.join("|")).collect();
    out.sort();
    Ok(out)
}

fn key_indexes(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for r in rows(conn, &format!("SELECT name, origin FROM pragma_index_list('{table}') WHERE origin IN ('pk', 'u')"), &[])? {
        let name = text(get(&r, "name")).unwrap_or_default();
        let cols: Vec<String> = rows(conn, &format!("SELECT name FROM pragma_index_info('{name}') ORDER BY seqno"), &[])?
            .iter()
            .map(|c| text(get(c, "name")).unwrap_or_default())
            .collect();
        out.push(format!("{}|{}", text(get(&r, "origin")).unwrap_or_default(), cols.join(",")));
    }
    out.sort();
    Ok(out)
}

fn master_sql(conn: &Connection, kind: &str, name: &str) -> Result<Option<String>, String> {
    Ok(rows(conn, "SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2", &[kind.to_string().into(), name.to_string().into()])?
        .first()
        .and_then(|r| text(get(r, "sql"))))
}

fn index_shape(conn: &Connection, table: &str, index: &str) -> Result<Option<String>, String> {
    let listed = rows(
        conn,
        &format!("SELECT \"unique\" AS uniq FROM pragma_index_list('{table}') WHERE name = ?1"),
        &[index.to_string().into()],
    )?;
    let Some(first) = listed.first() else { return Ok(None) };
    let cols: Vec<String> = rows(conn, &format!("SELECT name FROM pragma_index_info('{index}') ORDER BY seqno"), &[])?
        .iter()
        .map(|c| text(get(c, "name")).unwrap_or_default())
        .collect();
    Ok(Some(format!("{}|{}", int(get(first, "uniq")), cols.join(","))))
}

/// The schema-14 contract (TS twin: `validateSkillEvidenceState`).
pub fn verify_schema_14_skill_evidence_semantics(conn: &Connection, reference: &Connection) -> Result<(), String> {
    // 1. Exact shape.
    for table in M3_TABLES {
        let Some(sql) = master_sql(conn, "table", table)? else {
            return Err(format!("The database is missing required table: {table}"));
        };
        let ref_sql = master_sql(reference, "table", table)?.unwrap_or_default();
        if columns(conn, table)? != columns(reference, table)? {
            return Err(format!("Table {table} columns do not match the registered migration contract."));
        }
        if foreign_keys(conn, table)? != foreign_keys(reference, table)? {
            return Err(format!("Table {table} foreign keys do not match the registered migration contract."));
        }
        if check_constraints(&sql) != check_constraints(&ref_sql) {
            return Err(format!("Table {table} CHECK constraints do not match the registered migration contract."));
        }
        if key_indexes(conn, table)? != key_indexes(reference, table)? {
            return Err(format!("Table {table} keys do not match the registered migration contract."));
        }
    }
    for (table, index) in M3_INDEXES {
        let Some(actual) = index_shape(conn, table, index)? else {
            return Err(format!("The database is missing required index: {index}"));
        };
        if Some(actual) != index_shape(reference, table, index)? {
            return Err(format!("Index {index} does not match the registered migration contract."));
        }
    }
    for trigger in M3_TRIGGERS {
        let Some(sql) = master_sql(conn, "trigger", trigger)? else {
            return Err(format!("The database is missing required trigger: {trigger}"));
        };
        if normalize_sql(&sql) != normalize_sql(&master_sql(reference, "trigger", trigger)?.unwrap_or_default()) {
            return Err(format!("Trigger {trigger} does not match the registered migration contract."));
        }
    }

    // 2. Relationships.
    for table in M3_TABLES {
        if !rows(conn, &format!("SELECT 1 FROM pragma_foreign_key_check('{table}') LIMIT 1"), &[])?.is_empty() {
            return Err(format!("Table {table} has a record pointing at something that does not exist."));
        }
    }

    // 3. Built-in catalog equals the shipped one.
    let shipped = rows(reference, "SELECT * FROM skill_catalog_revisions WHERE revision = 1 AND changed_by = 'catalog'", &[])?;
    let builtins = rows(conn, "SELECT id FROM skill_catalog_entries WHERE origin = 'builtin'", &[])?;
    let shipped_ids: Vec<Option<String>> = shipped.iter().map(|r| text(get(r, "skill_id"))).collect();
    if builtins.len() != shipped.len() || builtins.iter().any(|r| !shipped_ids.contains(&text(get(r, "id")))) {
        return Err("The built-in skill catalog does not match this version of the app.".into());
    }
    for r in &shipped {
        let id = text(get(r, "skill_id")).unwrap_or_default();
        let first = rows(conn, "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = 1", &[id.clone().into()])?;
        let ok = first.first().map(|f| {
            ["label", "description", "topic", "status", "catalog_version", "changed_by", "changed_at"]
                .iter()
                .all(|k| text(get(f, k)) == text(get(r, k)))
        });
        if ok != Some(true) {
            return Err(format!("Built-in skill {id} does not match the shipped catalog."));
        }
    }
    if count(conn, "SELECT COUNT(*) FROM skill_catalog_entries WHERE origin = 'custom'", &[])? > MAX_CUSTOM_SKILLS {
        return Err("There are more custom skills than this app supports.".into());
    }

    // 4. Skill history: contiguous, head equals latest, pinned built-in
    //    wording and catalog version, legal steps, unique active names.
    let mut active_names: Vec<(String, String)> = Vec::new();
    for skill in rows(conn, "SELECT * FROM skill_catalog_entries ORDER BY id", &[])? {
        let id = text(get(&skill, "id")).unwrap_or_default();
        let history = rows(conn, "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 ORDER BY revision", &[id.clone().into()])?;
        if history.len() as i64 != int(get(&skill, "revision")) || history.iter().enumerate().any(|(i, h)| int(get(h, "revision")) != i as i64 + 1) {
            return Err(format!("Skill {id} has gaps in its history."));
        }
        let latest = history.last().unwrap();
        if ["label", "description", "topic", "status", "catalog_version"].iter().any(|k| text(get(latest, k)) != text(get(&skill, k))) {
            return Err(format!("Skill {id} does not match its latest history entry."));
        }
        let builtin = text(get(&skill, "origin")).as_deref() == Some("builtin");
        let reference_row = shipped.iter().find(|r| text(get(r, "skill_id")).as_deref() == Some(id.as_str()));
        for (i, h) in history.iter().enumerate() {
            if let Some(r) = reference_row.filter(|_| builtin) {
                if ["label", "description", "topic", "catalog_version"].iter().any(|k| text(get(h, k)) != text(get(r, k))) {
                    return Err(format!("Built-in skill {id} changed its catalog wording."));
                }
            }
            if !builtin && !matches!(get(h, "catalog_version"), Value::Null) {
                return Err(format!("Custom skill {id} has a catalog version."));
            }
            if i == 0 {
                if !builtin && (text(get(h, "changed_by")).as_deref() != Some("user") || text(get(h, "status")).as_deref() != Some("active")) {
                    return Err(format!("Custom skill {id} did not start as an active skill of yours."));
                }
                continue;
            }
            let prev = &history[i - 1];
            if text(get(h, "changed_by")).as_deref() != Some("user") {
                return Err(format!("Skill {id} has a later revision that is not a recorded change."));
            }
            let same_wording = ["label", "description", "topic"].iter().all(|k| text(get(h, k)) == text(get(prev, k)));
            let step = (text(get(prev, "status")).unwrap_or_default(), text(get(h, "status")).unwrap_or_default());
            let legal = match (step.0.as_str(), step.1.as_str()) {
                ("active", "active") => !same_wording,
                ("active", "retired") | ("retired", "active") => same_wording,
                _ => false,
            };
            if !legal {
                return Err(format!("Skill {id} has a history step the app cannot make."));
            }
        }
        if text(get(&skill, "status")).as_deref() == Some("active") {
            let key = label_key(&text(get(&skill, "label")).unwrap_or_default());
            if let Some((_, other)) = active_names.iter().find(|(k, _)| *k == key) {
                return Err(format!("Active skills {other} and {id} have the same name."));
            }
            active_names.push((key, id));
        }
    }

    // 5. Observation history.
    for obs in rows(conn, "SELECT * FROM skill_observations", &[])? {
        let id = text(get(&obs, "id")).unwrap_or_default();
        let history = rows(conn, "SELECT * FROM skill_observation_revisions WHERE observation_id = ?1 ORDER BY revision", &[id.clone().into()])?;
        if history.len() as i64 != int(get(&obs, "revision")) || history.iter().enumerate().any(|(i, h)| int(get(h, "revision")) != i as i64 + 1) {
            return Err(format!("Observation {id} has gaps in its history."));
        }
        let latest = history.last().unwrap();
        if ["wording", "observed_on", "attribution", "instructor_name", "linked_action_id", "linked_action_title", "addressed_at"]
            .iter()
            .any(|k| text(get(&obs, k)) != text(get(latest, k)))
        {
            return Err(format!("Observation {id} does not match its latest history entry."));
        }
        let journal = text(get(&obs, "journal_id"));
        if journal.is_some() && journal != text(get(&obs, "source_journal_id")) {
            return Err(format!("Observation {id} points at a different debrief than it was recorded from."));
        }
    }

    // 6. Self-assessment sequences.
    for g in rows(
        conn,
        "SELECT skill_id, kind, COUNT(*) AS n, MIN(sequence) AS lo, MAX(sequence) AS hi FROM skill_self_assessments GROUP BY skill_id, kind",
        &[],
    )? {
        if int(get(&g, "lo")) != 1 || int(get(&g, "hi")) != int(get(&g, "n")) {
            return Err(format!(
                "Skill {} has gaps in its {} history.",
                text(get(&g, "skill_id")).unwrap_or_default(),
                text(get(&g, "kind")).unwrap_or_default()
            ));
        }
    }

    // 7. Receipts: exact results, own subject, owned history of the right kind;
    //    tombstones are non-content observation receipts whose subject is gone.
    for op in rows(conn, "SELECT * FROM skill_evidence_operations ORDER BY rowid", &[])? {
        let id = text(get(&op, "operation_id")).unwrap_or_default();
        let action = text(get(&op, "action")).unwrap_or_default();
        let subject = text(get(&op, "subject_id")).unwrap_or_default();
        let present = count(conn, "SELECT COUNT(*) FROM skill_observations WHERE id = ?1", &[subject.clone().into()])? > 0;
        if int(get(&op, "is_erased")) != 0 {
            if !OBSERVATION_HISTORY_ACTIONS.contains(&action.as_str()) {
                return Err(format!("Operation {id} is erased, but only observation changes can be erased."));
            }
            if present {
                return Err(format!("Operation {id} says its observation was erased, but it is still here."));
            }
            continue;
        }
        let value = decode_result(text(get(&op, "result_json")).as_deref(), &action, &subject)
            .map_err(|e| format!("Operation {id} has an invalid result: {e}"))?;
        let number = match value {
            ResultValue::Number(n) => n,
            ResultValue::Erased => 0,
        };
        if SKILL_ACTIONS.contains(&action.as_str()) {
            let row = rows(conn, "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = ?2", &[subject.clone().into(), number.into()])?;
            let Some(row) = row.first() else {
                return Err(format!("Operation {id} does not own the skill history it names."));
            };
            if text(get(row, "operation_id")).as_deref() != Some(id.as_str()) || text(get(row, "changed_by")).as_deref() != Some("user") {
                return Err(format!("Operation {id} does not own the skill history it names."));
            }
            let prev = if number > 1 {
                rows(conn, "SELECT status FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = ?2", &[subject.clone().into(), (number - 1).into()])?
                    .first()
                    .and_then(|r| text(get(r, "status")))
            } else {
                None
            };
            let status = text(get(row, "status")).unwrap_or_default();
            let fits = match action.as_str() {
                "create_custom_skill" => subject.starts_with("custom.") && status == "active",
                "edit_custom_skill" => status == "active" && prev.as_deref() == Some("active"),
                "retire_skill" => status == "retired",
                _ => status == "active" && prev.as_deref() == Some("retired"),
            };
            if !fits {
                return Err(format!("Operation {id} names a skill change of a different kind."));
            }
        } else if OBSERVATION_HISTORY_ACTIONS.contains(&action.as_str()) {
            if !present {
                return Err(format!("Operation {id} is a live record of an observation that is not here."));
            }
            let row = rows(
                conn,
                "SELECT change_kind, operation_id FROM skill_observation_revisions WHERE observation_id = ?1 AND revision = ?2",
                &[subject.clone().into(), number.into()],
            )?;
            let Some(row) = row.first().filter(|r| text(get(r, "operation_id")).as_deref() == Some(id.as_str())) else {
                return Err(format!("Operation {id} does not own the observation history it names."));
            };
            let kind = text(get(row, "change_kind")).unwrap_or_default();
            let fits = match action.as_str() {
                "create_observation" => kind == "created",
                "edit_observation" => kind == "edited",
                "link_action" => kind == "linked_action",
                "unlink_action" => kind == "unlinked_action",
                _ => kind == "marked_addressed" || kind == "cleared_addressed",
            };
            if !fits {
                return Err(format!("Operation {id} names an observation change of a different kind."));
            }
        } else if ASSESSMENT_ACTIONS.contains(&action.as_str()) {
            let kind = if action == "set_status" { "status" } else { "confidence" };
            let row = rows(
                conn,
                "SELECT id, operation_id FROM skill_self_assessments WHERE skill_id = ?1 AND kind = ?2 AND sequence = ?3",
                &[subject.clone().into(), kind.to_string().into(), number.into()],
            )?;
            let owned = row
                .first()
                .map(|r| text(get(r, "operation_id")).as_deref() == Some(id.as_str()) && text(get(r, "id")).as_deref() == Some(id.as_str()));
            if owned != Some(true) {
                return Err(format!("Operation {id} does not own the self-assessment it names."));
            }
        } else {
            if present {
                return Err(format!("Operation {id} says it erased an observation that is still here."));
            }
            if count(
                conn,
                "SELECT COUNT(*) FROM skill_evidence_operations WHERE subject_id = ?1 AND is_erased = 0 AND action <> 'erase_observation'",
                &[subject.clone().into()],
            )? > 0
            {
                return Err(format!("Operation {id} erased an observation whose earlier records were not cleared."));
            }
        }
    }
    Ok(())
}

/// The candidate binary's whole-database decision for M3 (ceiling + schema 14).
/// The accepted schema 11-13 checks are the app's own and are not re-implemented here.
pub fn verify_candidate(conn: &Connection, reference: &Connection) -> Result<(), String> {
    let quick: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if quick != "ok" {
        return Err("The database is damaged or incomplete.".into());
    }
    let newest = count(conn, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations", &[])?;
    if newest > CANDIDATE_VERSION {
        return Err("That backup was created by a newer database format. Update the app first.".into());
    }
    if newest >= 14 {
        verify_schema_14_skill_evidence_semantics(conn, reference)?;
    }
    Ok(())
}

/// Every row of every user table in rowid order, as text, for equality checks.
pub fn dump(conn: &Connection, exclude: &[&str]) -> Result<Vec<(String, Vec<String>)>, String> {
    let mut out = Vec::new();
    let tables = rows(conn, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", &[])?;
    for t in tables {
        let name = text(get(&t, "name")).unwrap_or_default();
        if exclude.contains(&name.as_str()) {
            continue;
        }
        let data = rows(conn, &format!("SELECT * FROM \"{name}\" ORDER BY rowid"), &[])?
            .iter()
            .map(|r| r.iter().map(|(k, v)| format!("{k}={:?}", v)).collect::<Vec<_>>().join(","))
            .collect();
        out.push((name, data));
    }
    Ok(out)
}
