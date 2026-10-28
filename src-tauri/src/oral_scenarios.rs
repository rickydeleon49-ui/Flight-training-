//! ORAL-01c: her saved oral-question scenarios. The native twin of
//! `src/data/oralScenarios.ts`: one bounded codec, one owned transaction and
//! the semantic half of the backup verifier. Every edit adds a frozen version;
//! receipts keep a hash of the request, never her text. Answers are never stored.
use crate::card_reviews::js_trim;
use crate::practice_sessions::{canonical_json, compute_canonical_hash};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(crate) const POINTS_MAX: usize = 12;
pub(crate) const POINT_MAX_CHARS: usize = 500;
const PROMPT_MAX_CHARS: usize = 4000;
const ASSUMPTIONS_MAX_CHARS: usize = 2000;
const SOURCE_PAGE_MAX: i64 = 100_000;
const SCENARIOS_MAX: usize = 200;
const MATERIAL_ID_MAX: usize = 200;
const AT_MAX: usize = 64;
const ACTIONS: &[&str] = &["create", "edit", "reorder", "remove"];

#[derive(Debug, serde::Serialize)]
pub(crate) struct OralError {
    code: &'static str,
    message: &'static str,
}

pub(crate) fn error(code: &'static str) -> OralError {
    let (code, message) = match code {
        "INVALID" => (
            "INVALID",
            "Part of this scenario isn't valid. Nothing was saved.",
        ),
        "CONFLICT" => (
            "CONFLICT",
            "This save clashed with an earlier one. Nothing was changed.",
        ),
        "STALE" => (
            "STALE",
            "Your scenarios changed in the meantime. Close this and try again.",
        ),
        "MISSING" => (
            "MISSING",
            "That scenario or material is no longer here. Nothing was changed.",
        ),
        _ => (
            "STORAGE",
            "The scenario could not be saved. Nothing was changed.",
        ),
    };
    OralError { code, message }
}

fn ensure(ok: bool, code: &'static str) -> Result<(), OralError> {
    if ok {
        Ok(())
    } else {
        Err(error(code))
    }
}

pub(crate) fn is_id(v: &Value) -> bool {
    v.as_str().is_some_and(|t| {
        let b = t.as_bytes();
        b.len() == 36
            && b.iter().enumerate().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    *c == b'-'
                } else {
                    c.is_ascii_digit() || (b'a'..=b'f').contains(c)
                }
            })
    })
}

fn exact_keys(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}

fn bounded_text(v: &Value, required: bool, max: usize) -> bool {
    v.as_str()
        .is_some_and(|t| t.chars().count() <= max && (!required || !js_trim(t).is_empty()))
}

/// The one points codec: 1–12 strings, each 1–500 characters, nothing else.
pub(crate) fn valid_points(v: &Value) -> bool {
    v.as_array().is_some_and(|a| {
        (1..=POINTS_MAX).contains(&a.len())
            && a.iter().all(|p| bounded_text(p, true, POINT_MAX_CHARS))
    })
}

/// Decodes only the exact encoding the writer produces.
pub(crate) fn decode_points(raw: &str) -> Option<Value> {
    let parsed: Value = serde_json::from_str(raw).ok()?;
    (valid_points(&parsed) && serde_json::to_string(&parsed).ok()? == raw).then_some(parsed)
}

fn valid_source_page(v: &Value) -> bool {
    v.is_null()
        || v.as_i64()
            .is_some_and(|n| (1..=SOURCE_PAGE_MAX).contains(&n))
}

/// Content she can write; stored rows may also carry the reserved `study_aid`.
pub(crate) fn valid_content(v: &Value, stored: bool) -> bool {
    let origins: &[&str] = if stored {
        &["user", "instructor", "study_aid"]
    } else {
        &["user", "instructor"]
    };
    exact_keys(
        v,
        &["prompt", "assumptions", "points", "sourcePage", "origin"],
    ) && bounded_text(&v["prompt"], true, PROMPT_MAX_CHARS)
        && bounded_text(&v["assumptions"], false, ASSUMPTIONS_MAX_CHARS)
        && valid_points(&v["points"])
        && valid_source_page(&v["sourcePage"])
        && v["origin"].as_str().is_some_and(|o| origins.contains(&o))
}

/// SHA-256 of the canonical descriptor of one frozen version.
pub(crate) fn content_hash(scenario_id: &str, version_number: i64, content: &Value) -> String {
    compute_canonical_hash(&json!({
        "scenarioId": scenario_id,
        "versionNumber": version_number,
        "prompt": content["prompt"],
        "assumptions": content["assumptions"],
        "points": content["points"],
        "sourcePage": content["sourcePage"],
        "origin": content["origin"],
    }))
}

pub(crate) fn decode_operation(v: &Value) -> Result<(), OralError> {
    let action = v["action"].as_str().unwrap_or("");
    let keys: &[&str] = match action {
        "create" => &[
            "action",
            "operationId",
            "materialId",
            "at",
            "scenarioId",
            "versionId",
            "content",
        ],
        "edit" => &[
            "action",
            "operationId",
            "materialId",
            "at",
            "scenarioId",
            "versionId",
            "baseVersion",
            "content",
        ],
        "reorder" => &["action", "operationId", "materialId", "at", "order"],
        "remove" => &["action", "operationId", "materialId", "at", "scenarioId"],
        _ => return Err(error("INVALID")),
    };
    ensure(exact_keys(v, keys) && is_id(&v["operationId"]), "INVALID")?;
    ensure(
        v["materialId"]
            .as_str()
            .is_some_and(|m| !m.is_empty() && m.encode_utf16().count() <= MATERIAL_ID_MAX),
        "INVALID",
    )?;
    ensure(
        v["at"]
            .as_str()
            .is_some_and(|a| !a.is_empty() && a.encode_utf16().count() <= AT_MAX),
        "INVALID",
    )?;
    if action != "reorder" {
        ensure(is_id(&v["scenarioId"]), "INVALID")?;
    }
    if action == "create" || action == "edit" {
        ensure(
            is_id(&v["versionId"]) && valid_content(&v["content"], false),
            "INVALID",
        )?;
    }
    if action == "edit" {
        ensure(
            v["baseVersion"]
                .as_i64()
                .is_some_and(|n| (1..=9_007_199_254_740_991).contains(&n)),
            "INVALID",
        )?;
    }
    if action == "reorder" {
        let order = v["order"].as_array().ok_or_else(|| error("INVALID"))?;
        ensure(
            (1..=SCENARIOS_MAX).contains(&order.len()) && order.iter().all(is_id),
            "INVALID",
        )?;
        let unique: std::collections::BTreeSet<&str> =
            order.iter().filter_map(Value::as_str).collect();
        ensure(unique.len() == order.len(), "INVALID")?;
    }
    Ok(())
}

/// The stored result: ids and numbers only.
pub(crate) fn decode_result(raw: &str, action: &str) -> Option<Value> {
    let r: Value = serde_json::from_str(raw).ok()?;
    if !exact_keys(
        &r,
        &[
            "version",
            "action",
            "scenarioId",
            "versionId",
            "versionNumber",
        ],
    ) || canonical_json(&r) != raw
        || r["version"] != json!(1)
        || r["action"] != json!(action)
    {
        return None;
    }
    let ok = match action {
        "create" | "edit" => {
            is_id(&r["scenarioId"])
                && is_id(&r["versionId"])
                && r["versionNumber"].as_i64().is_some_and(|n| n >= 1)
        }
        "remove" => {
            is_id(&r["scenarioId"]) && r["versionId"].is_null() && r["versionNumber"].is_null()
        }
        "reorder" => {
            r["scenarioId"].is_null() && r["versionId"].is_null() && r["versionNumber"].is_null()
        }
        _ => false,
    };
    ok.then_some(r)
}

fn storage<E>(_: E) -> OralError {
    error("STORAGE")
}

fn exists(conn: &Connection, sql: &str, id: &str) -> Result<bool, OralError> {
    conn.query_row(sql, [id], |_| Ok(()))
        .optional()
        .map(|r| r.is_some())
        .map_err(storage)
}

fn insert_version(
    conn: &Connection,
    scenario_id: &str,
    version_id: &str,
    number: i64,
    content: &Value,
    at: &str,
) -> Result<(), OralError> {
    let points = serde_json::to_string(&content["points"]).map_err(storage)?;
    conn.execute(
        "INSERT INTO oral_scenario_versions (id, scenario_id, version_number, prompt, assumptions, points_json, source_page, origin, content_hash, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            version_id,
            scenario_id,
            number,
            content["prompt"].as_str(),
            content["assumptions"].as_str(),
            points,
            content["sourcePage"].as_i64(),
            content["origin"].as_str(),
            content_hash(scenario_id, number, content),
            at
        ],
    )
    .map_err(storage)?;
    Ok(())
}

fn apply(conn: &Connection, op: &Value) -> Result<Value, OralError> {
    decode_operation(op)?;
    let text = |k: &str| op[k].as_str().unwrap_or_default().to_string();
    let (operation_id, material_id, action, at) = (
        text("operationId"),
        text("materialId"),
        text("action"),
        text("at"),
    );
    let hash = compute_canonical_hash(op);
    let receipt: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT payload_hash, material_id, action, result_json FROM oral_save_operations WHERE operation_id=?1",
            [&operation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(storage)?;
    if let Some((stored_hash, stored_material, stored_action, result)) = receipt {
        ensure(
            stored_hash == hash && stored_material == material_id && stored_action == action,
            "CONFLICT",
        )?;
        return decode_result(&result, &action).ok_or_else(|| error("STORAGE"));
    }
    ensure(
        exists(
            conn,
            "SELECT 1 FROM study_materials WHERE id=?1",
            &material_id,
        )?,
        "MISSING",
    )?;
    let mut stmt = conn
        .prepare("SELECT id, position FROM oral_scenarios WHERE material_id=?1 AND removed_at IS NULL ORDER BY position")
        .map_err(storage)?;
    let active: Vec<(String, i64)> = stmt
        .query_map([&material_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(storage)?
        .collect::<Result<_, _>>()
        .map_err(storage)?;
    let last = active.last().map(|a| a.1);
    let is_active = |id: &str| active.iter().any(|a| a.0 == id);
    let result = match action.as_str() {
        "create" => {
            let (scenario, version) = (text("scenarioId"), text("versionId"));
            ensure(active.len() < SCENARIOS_MAX, "INVALID")?;
            ensure(
                !exists(conn, "SELECT 1 FROM oral_scenarios WHERE id=?1", &scenario)?
                    && !exists(
                        conn,
                        "SELECT 1 FROM oral_scenario_versions WHERE id=?1",
                        &version,
                    )?,
                "CONFLICT",
            )?;
            let position = last.map_or(0, |p| p + 1);
            conn.execute(
                "INSERT INTO oral_scenarios (id, material_id, position, removed_at, created_at, updated_at) VALUES (?1,?2,?3,NULL,?4,?4)",
                params![scenario, material_id, position, at],
            )
            .map_err(storage)?;
            insert_version(conn, &scenario, &version, 1, &op["content"], &at)?;
            json!({"version":1,"action":"create","scenarioId":scenario,"versionId":version,"versionNumber":1})
        }
        "edit" => {
            let (scenario, version) = (text("scenarioId"), text("versionId"));
            ensure(is_active(&scenario), "MISSING")?;
            let latest: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(version_number),0) FROM oral_scenario_versions WHERE scenario_id=?1",
                    [&scenario],
                    |r| r.get(0),
                )
                .map_err(storage)?;
            let base = op["baseVersion"].as_i64().unwrap_or(0);
            ensure(latest == base, "STALE")?;
            ensure(
                !exists(
                    conn,
                    "SELECT 1 FROM oral_scenario_versions WHERE id=?1",
                    &version,
                )?,
                "CONFLICT",
            )?;
            insert_version(conn, &scenario, &version, base + 1, &op["content"], &at)?;
            conn.execute(
                "UPDATE oral_scenarios SET updated_at=?1 WHERE id=?2",
                params![at, scenario],
            )
            .map_err(storage)?;
            json!({"version":1,"action":"edit","scenarioId":scenario,"versionId":version,"versionNumber":base + 1})
        }
        "reorder" => {
            let order: Vec<&str> = op["order"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            ensure(
                order.len() == active.len() && order.iter().all(|id| is_active(id)),
                "STALE",
            )?;
            // A high transaction-local offset avoids transient UNIQUE conflicts.
            let offset = last.unwrap_or(0) + order.len() as i64 + 1;
            conn.execute(
                "UPDATE oral_scenarios SET position=position+?1 WHERE material_id=?2 AND removed_at IS NULL",
                params![offset, material_id],
            )
            .map_err(storage)?;
            for (index, id) in order.iter().enumerate() {
                conn.execute(
                    "UPDATE oral_scenarios SET position=?1, updated_at=?2 WHERE id=?3",
                    params![index as i64, at, id],
                )
                .map_err(storage)?;
            }
            json!({"version":1,"action":"reorder","scenarioId":null,"versionId":null,"versionNumber":null})
        }
        _ => {
            let scenario = text("scenarioId");
            ensure(is_active(&scenario), "MISSING")?;
            conn.execute(
                "UPDATE oral_scenarios SET removed_at=?1, updated_at=?1 WHERE id=?2",
                params![at, scenario],
            )
            .map_err(storage)?;
            json!({"version":1,"action":"remove","scenarioId":scenario,"versionId":null,"versionNumber":null})
        }
    };
    conn.execute(
        "INSERT INTO oral_save_operations (operation_id, material_id, action, payload_hash, result_json, applied_at) VALUES (?1,?2,?3,?4,?5,?6)",
        params![operation_id, material_id, action, hash, canonical_json(&result), at],
    )
    .map_err(storage)?;
    Ok(result)
}

pub(crate) fn execute(conn: &mut Connection, op: &Value) -> Result<Value, OralError> {
    decode_operation(op)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let result = apply(&tx, op)?;
    tx.commit().map_err(storage)?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn save_oral_scenario_operation(
    app: tauri::AppHandle,
    operation: Value,
) -> Result<Value, OralError> {
    let root = crate::storage::app_root(&app).map_err(storage)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = root.join("her-flight-deck.db");
        if !path.is_file() {
            return Err(error("STORAGE"));
        }
        let mut conn = Connection::open(path).map_err(storage)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(storage)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(storage)?;
        execute(&mut conn, &operation)
    })
    .await
    .map_err(storage)?
}

/// The semantic half of `verify_schema_25_oral_scenarios`: every frozen
/// version's codec and hash, contiguous version numbers, and receipts that
/// hold ids only and point at real rows.
pub(crate) fn validate_database(conn: &Connection) -> Result<(), String> {
    const DAMAGED: &str = "Damaged oral scenario.";
    let read = |sql: &str| -> Result<Vec<Vec<rusqlite::types::Value>>, String> {
        let mut stmt = conn.prepare(sql).map_err(|_| DAMAGED.to_string())?;
        let n = stmt.column_count();
        let rows = stmt
            .query_map([], |r| {
                (0..n)
                    .map(|i| r.get::<_, rusqlite::types::Value>(i))
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|_| DAMAGED.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| DAMAGED.to_string())
    };
    use rusqlite::types::Value as V;
    let txt = |v: &V| match v {
        V::Text(t) => Some(t.clone()),
        _ => None,
    };
    let int = |v: &V| match v {
        V::Integer(n) => Some(*n),
        _ => None,
    };
    for row in read("SELECT id, (SELECT COUNT(*) FROM oral_scenario_versions v WHERE v.scenario_id = s.id), (SELECT COALESCE(MAX(version_number), 0) FROM oral_scenario_versions v WHERE v.scenario_id = s.id) FROM oral_scenarios s")? {
        let id = txt(&row[0]).map(Value::String).unwrap_or(Value::Null);
        let (n, top) = (int(&row[1]).unwrap_or(0), int(&row[2]).unwrap_or(-1));
        if !is_id(&id) || n < 1 || n != top {
            return Err("Damaged oral scenario versions.".into());
        }
    }
    for row in read("SELECT id, scenario_id, version_number, prompt, assumptions, points_json, source_page, origin, content_hash, created_at FROM oral_scenario_versions ORDER BY scenario_id, version_number")? {
        let id = txt(&row[0]).map(Value::String).unwrap_or(Value::Null);
        let scenario = txt(&row[1]).ok_or(DAMAGED)?;
        let number = int(&row[2]).ok_or(DAMAGED)?;
        let points = txt(&row[5]).and_then(|p| decode_points(&p)).ok_or(DAMAGED)?;
        let source_page = match &row[6] {
            V::Null => Value::Null,
            V::Integer(n) => json!(n),
            _ => return Err(DAMAGED.into()),
        };
        let content = json!({
            "prompt": txt(&row[3]).ok_or(DAMAGED)?,
            "assumptions": txt(&row[4]).ok_or(DAMAGED)?,
            "points": points,
            "sourcePage": source_page,
            "origin": txt(&row[7]).ok_or(DAMAGED)?,
        });
        if !is_id(&id)
            || !valid_content(&content, true)
            || !txt(&row[9]).is_some_and(|c| !c.is_empty())
            || txt(&row[8]) != Some(content_hash(&scenario, number, &content))
        {
            return Err(DAMAGED.into());
        }
    }
    const RECEIPT: &str = "An oral scenario save receipt is damaged.";
    for row in
        read("SELECT operation_id, material_id, action, result_json FROM oral_save_operations")?
    {
        let id = txt(&row[0]).map(Value::String).unwrap_or(Value::Null);
        let material = txt(&row[1]).ok_or(RECEIPT)?;
        let action = txt(&row[2]).ok_or(RECEIPT)?;
        if !is_id(&id) || !ACTIONS.contains(&action.as_str()) {
            return Err(RECEIPT.into());
        }
        let result = txt(&row[3])
            .and_then(|r| decode_result(&r, &action))
            .ok_or(RECEIPT)?;
        if let Some(scenario) = result["scenarioId"].as_str() {
            let owner: Option<(String, Option<String>)> = conn
                .query_row(
                    "SELECT material_id, removed_at FROM oral_scenarios WHERE id=?1",
                    [scenario],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|_| RECEIPT)?;
            match owner {
                Some((m, removed))
                    if m == material && (action != "remove" || removed.is_some()) => {}
                _ => return Err(RECEIPT.into()),
            }
        }
        if let Some(version) = result["versionId"].as_str() {
            let found: Option<(String, i64)> = conn
                .query_row(
                    "SELECT scenario_id, version_number FROM oral_scenario_versions WHERE id=?1",
                    [version],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|_| RECEIPT)?;
            match found {
                Some((s, n))
                    if Some(s.as_str()) == result["scenarioId"].as_str()
                        && Some(n) == result["versionNumber"].as_i64()
                        && (action != "create" || n == 1) => {}
                _ => return Err(RECEIPT.into()),
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "oral_scenarios_tests.rs"]
pub(crate) mod tests;
