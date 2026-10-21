//! HW-01b: bounded codec, independent semantic validation and one owned transaction.
use crate::practice_sessions::{canonical_json, compute_canonical_hash};
use rusqlite::{params, types::ValueRef, Connection, TransactionBehavior};
use serde_json::{json, Value};
#[path = "homework_cards.rs"]
pub(crate) mod cards;
const LIMIT: usize = 1024 * 1024;
const ASSIGNMENT: &str = "id title instructions school instructor lesson_id source_lesson_id due_date state revision action_id archived created_at updated_at completed_at";
const ACTIVITY: &str = "id assignment_id position kind title body material_id source_material_id source_revision card_set_id test_version_id source_test_version_id page_start page_end state cycle revision created_at updated_at completed_at removed_at";
const TARGET: &[&str] = &[
    "material_id",
    "source_material_id",
    "source_revision",
    "card_set_id",
    "test_version_id",
    "source_test_version_id",
    "page_start",
    "page_end",
];
const CHANGES: &[&str] = &[
    "create",
    "edit",
    "start",
    "record_evidence",
    "complete",
    "reopen",
    "reorder",
    "remove_activity",
    "relink",
    "archive",
];
const INVALID: &str = "Part of this homework isn't valid. Your changes haven't been saved.";
fn ensure(ok: bool) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(INVALID.into())
    }
}
fn keys(v: &Value, names: &str) -> Result<(), String> {
    let o = v.as_object().ok_or(INVALID)?;
    ensure(
        o.len() == names.split_whitespace().count()
            && names.split_whitespace().all(|k| o.contains_key(k)),
    )
}
fn s<'a>(v: &'a Value, k: &str) -> Result<&'a str, String> {
    v[k].as_str().ok_or_else(|| INVALID.into())
}
fn n(v: &Value, k: &str) -> Result<i64, String> {
    v[k].as_i64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| INVALID.into())
}
fn list<'a>(v: &'a Value, k: &str) -> Result<&'a Vec<Value>, String> {
    v[k].as_array().ok_or_else(|| INVALID.into())
}
fn uuid(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 36
        && b[14] == b'4'
        && b"89ab".contains(&b[19])
        && b.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(c)
            }
        })
}
fn hash(t: &str) -> bool {
    t.len() == 64
        && t.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn text(t: &str, max: usize, required: bool) -> bool {
    !t.contains('\0')
        && t.chars().count() <= max
        && t.len() <= 4 * max
        && (!required || !crate::card_reviews::js_trim(t).is_empty())
}
fn instant(t: &str) -> bool {
    crate::card_reviews::parse_iso_ms(t).is_some()
}
fn date(t: &str) -> bool {
    t.len() == 10 && instant(&format!("{t}T00:00:00.000Z"))
}
fn opt_check(v: &Value, k: &str, check: impl Fn(&str) -> bool) -> Result<(), String> {
    ensure(v[k].is_null() || v[k].as_str().is_some_and(check))
}
fn pointers(a: &Value, live: &str, source: &str) -> bool {
    a[live].is_null() || a[live] == a[source]
}
fn except(a: &Value, b: &Value, skip: &[&str]) -> bool {
    let strip = |v: &Value| -> Value {
        v.as_object()
            .unwrap()
            .iter()
            .filter(|(k, _)| !skip.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    };
    strip(a) == strip(b)
}
pub(crate) fn parse(raw: &str) -> Result<Value, String> {
    ensure(raw.len() <= LIMIT)?;
    let v: Value = serde_json::from_str(raw).map_err(|_| INVALID)?;
    ensure(canonical_json(&v) == raw)?;
    Ok(v)
}
fn validate_record(v: &Value, activity: bool) -> Result<(), String> {
    keys(v, if activity { ACTIVITY } else { ASSIGNMENT })?;
    ensure(uuid(s(v, "id")?) && text(s(v, "title")?, 200, true))?;
    ensure(n(v, "revision")? >= 1)?;
    ensure(["upcoming", "in_progress", "completed", "reopened"].contains(&s(v, "state")?))?;
    ensure(
        instant(s(v, "created_at")?)
            && instant(s(v, "updated_at")?)
            && s(v, "updated_at")? >= s(v, "created_at")?,
    )?;
    opt_check(v, "completed_at", instant)?;
    ensure((v["state"] == "completed") == !v["completed_at"].is_null())?;
    if let Some(t) = v["completed_at"].as_str() {
        ensure(t > s(v, "created_at")? && t <= s(v, "updated_at")?)?;
    }
    if activity {
        ensure(
            uuid(s(v, "assignment_id")?)
                && n(v, "position")? >= 0
                && n(v, "cycle")? >= 1
                && text(s(v, "body")?, 20000, false),
        )?;
        ensure(
            [
                "read",
                "cards",
                "test",
                "reflection",
                "questions",
                "checklist",
            ]
            .contains(&s(v, "kind")?),
        )?;
        for k in [
            "material_id",
            "source_material_id",
            "test_version_id",
            "source_test_version_id",
        ] {
            opt_check(v, k, uuid)?;
        }
        for k in ["source_revision", "card_set_id"] {
            opt_check(v, k, hash)?;
        }
        for k in ["page_start", "page_end"] {
            ensure(v[k].is_null() || n(v, k)? >= 1)?;
        }
        opt_check(v, "removed_at", instant)?;
        if let Some(t) = v["removed_at"].as_str() {
            ensure(t >= s(v, "created_at")? && t <= s(v, "updated_at")?)?;
        }
        ensure(
            pointers(v, "material_id", "source_material_id")
                && pointers(v, "test_version_id", "source_test_version_id"),
        )?;
        ensure(v["page_start"].is_null() == v["page_end"].is_null())?;
        if !v["page_start"].is_null() {
            ensure(v["kind"] == "read" && n(v, "page_end")? >= n(v, "page_start")?)?;
        }
        ensure(v["card_set_id"].is_null() || v["kind"] == "cards")?;
        ensure(v["source_test_version_id"].is_null() || v["kind"] == "test")?;
        ensure(v["source_revision"].is_null() || !v["source_material_id"].is_null())?;
        ensure(
            v["card_set_id"].is_null() == (v["kind"] != "cards" || v["source_revision"].is_null()),
        )?;
        ensure(
            v["source_test_version_id"].is_null()
                == (v["kind"] != "test" || v["source_revision"].is_null()),
        )?;
        if !["read", "cards", "test"].contains(&s(v, "kind")?) {
            ensure(v["source_revision"].is_null())?;
        }
    } else {
        ensure(text(s(v, "instructions")?, 20000, false))?;
        for k in ["school", "instructor"] {
            opt_check(v, k, |t| text(t, 200, false))?;
        }
        for k in ["lesson_id", "source_lesson_id"] {
            opt_check(v, k, uuid)?;
        }
        opt_check(v, "due_date", date)?;
        ensure(
            v["action_id"].is_null()
                && [0, 1].contains(&n(v, "archived")?)
                && pointers(v, "lesson_id", "source_lesson_id"),
        )?;
    }
    Ok(())
}
pub(crate) fn validate_snapshot(v: &Value) -> Result<(), String> {
    keys(v, "version assignment activities runs")?;
    ensure(v["version"] == 1 && canonical_json(v).len() <= LIMIT)?;
    let a = &v["assignment"];
    validate_record(a, false)?;
    let entries = list(v, "activities")?;
    let mut ids = Vec::new();
    let mut positions = Vec::new();
    let mut any = false;
    let mut all = true;
    let mut reopened = false;
    for e in entries {
        keys(e, "record source evidence")?;
        let r = &e["record"];
        validate_record(r, true)?;
        ensure(
            r["assignment_id"] == a["id"]
                && s(r, "created_at")? >= s(a, "created_at")?
                && s(r, "updated_at")? <= s(a, "updated_at")?,
        )?;
        ids.push(s(r, "id")?);
        if r["removed_at"].is_null() {
            positions.push(n(r, "position")?);
            all &= r["state"] == "completed";
            any |= r["state"] == "completed" || r["state"] == "in_progress";
            reopened |= r["state"] == "reopened";
        }
        ensure(e["source"].is_null() == r["source_material_id"].is_null())?;
        if !e["source"].is_null() {
            keys(&e["source"], "title total_pages")?;
            ensure(text(s(&e["source"], "title")?, 200, true))?;
            ensure(e["source"]["total_pages"].is_null() || n(&e["source"], "total_pages")? >= 1)?;
        }
        if r["kind"] != "read" {
            ensure(e["source"]["total_pages"].is_null())?;
        }
        if !r["page_end"].is_null() {
            ensure(
                !r["source_revision"].is_null()
                    && n(r, "page_end")? <= n(&e["source"], "total_pages")?,
            )?;
        }
        ensure((r["state"] == "completed") == !e["evidence"].is_null())?;
        if !e["evidence"].is_null() {
            ensure(r["kind"] != "test")?;
            let mut evidence = json!({"version":1,"activity_id":r["id"]});
            for k in [
                "revision",
                "cycle",
                "kind",
                "completed_at",
                "body",
                "source_material_id",
                "source_revision",
                "page_start",
                "page_end",
            ] {
                evidence[k] = r[k].clone();
            }
            ensure(e["evidence"] == evidence)?;
            if r["kind"] == "read" {
                ensure(!r["source_revision"].is_null() && !r["page_end"].is_null())?;
            }
            if ["reflection", "questions"].contains(&s(r, "kind")?) {
                ensure(text(s(r, "body")?, 20000, true))?;
            }
        }
        if r["state"] == "in_progress" {
            ensure(
                r["kind"] != "test"
                    && (r["kind"] != "read"
                        || (!r["source_revision"].is_null() && !r["page_end"].is_null())),
            )?;
        }
    }
    ensure(ids.windows(2).all(|p| p[0] < p[1]) && positions.len() <= 100)?;
    positions.sort();
    ensure(positions.iter().enumerate().all(|(i, n)| *n == i as i64))?;
    cards::snapshot(v)?;
    let summary = if all && !positions.is_empty() {
        "completed"
    } else if any {
        "in_progress"
    } else {
        "upcoming"
    };
    ensure(a["state"] == summary || (a["state"] == "reopened" && reopened))
}
pub(crate) fn decode_operation(v: &Value) -> Result<(), String> {
    keys(
        v,
        "version operationId assignmentId baseRevision changeKind at next",
    )?;
    ensure(
        v["version"] == 1
            && uuid(s(v, "operationId")?)
            && uuid(s(v, "assignmentId")?)
            && n(v, "baseRevision")? >= 0
            && n(v, "baseRevision")? < 9_007_199_254_740_991
            && CHANGES.contains(&s(v, "changeKind")?)
            && instant(s(v, "at")?)
            && canonical_json(v).len() <= LIMIT,
    )?;
    validate_snapshot(&v["next"])
}
pub(crate) fn transition(previous: Option<&Value>, op: &Value) -> Result<(), String> {
    decode_operation(op)?;
    let next = &op["next"];
    let a = &next["assignment"];
    let at = s(op, "at")?;
    let change = s(op, "changeKind")?;
    ensure(
        a["id"] == op["assignmentId"]
            && n(a, "revision")? == n(op, "baseRevision")? + 1
            && a["updated_at"] == at,
    )?;
    let Some(previous) = previous else {
        ensure(list(next, "runs")?.is_empty())?;
        ensure(
            change == "create"
                && op["baseRevision"] == 0
                && a["state"] == "upcoming"
                && a["archived"] == 0
                && a["created_at"] == at,
        )?;
        for e in list(next, "activities")? {
            let r = &e["record"];
            ensure(
                r["cycle"] == 1
                    && r["revision"] == 1
                    && r["state"] == "upcoming"
                    && r["created_at"] == at
                    && r["updated_at"] == at
                    && r["removed_at"].is_null(),
            )?;
        }
        return Ok(());
    };
    let mut normalized = previous.clone();
    if next["assignment"]["lesson_id"].is_null()
        && next["assignment"]["source_lesson_id"] == previous["assignment"]["source_lesson_id"]
    {
        normalized["assignment"]["lesson_id"] = Value::Null;
    }
    for e in normalized["activities"].as_array_mut().unwrap() {
        if let Some(live) = list(next, "activities")?
            .iter()
            .find(|p| p["record"]["id"] == e["record"]["id"])
        {
            for (pointer, source) in [
                ("material_id", "source_material_id"),
                ("test_version_id", "source_test_version_id"),
            ] {
                if live["record"][pointer].is_null()
                    && live["record"][source] == e["record"][source]
                {
                    e["record"][pointer] = Value::Null;
                }
            }
        }
    }
    let previous = &normalized;
    let old = &previous["assignment"];
    ensure(
        old["revision"] == op["baseRevision"] && at >= s(old, "updated_at")? && change != "create",
    )?;
    let mut skips = vec!["revision", "updated_at", "state", "completed_at"];
    if change == "edit" {
        skips.extend([
            "title",
            "instructions",
            "school",
            "instructor",
            "lesson_id",
            "source_lesson_id",
            "due_date",
        ]);
    }
    if change == "archive" {
        skips.push("archived");
    }
    ensure(except(old, a, &skips))?;
    let entries = list(next, "activities")?;
    let prior_entries = list(previous, "activities")?;
    ensure(prior_entries.iter().all(|p| {
        entries
            .iter()
            .any(|e| e["record"]["id"] == p["record"]["id"])
    }))?;
    let mut affected = 0;
    let mut reopened = false;
    for e in entries {
        let r = &e["record"];
        let prior = prior_entries.iter().find(|p| p["record"]["id"] == r["id"]);
        let Some(prior) = prior else {
            ensure(
                change == "edit"
                    && r["cycle"] == 1
                    && r["revision"] == 1
                    && r["state"] == "upcoming"
                    && r["created_at"] == at
                    && r["updated_at"] == at
                    && r["removed_at"].is_null(),
            )?;
            affected += 1;
            continue;
        };
        if prior == e {
            continue;
        }
        affected += 1;
        let p = &prior["record"];
        ensure(
            p["removed_at"].is_null()
                && r["updated_at"] == at
                && r["created_at"] == p["created_at"],
        )?;
        let spec =
            p["kind"] != r["kind"] || p["body"] != r["body"] || TARGET.iter().any(|k| p[k] != r[k]);
        match change {
            "edit" | "relink" => {
                let mut allowed = vec![
                    "title",
                    "kind",
                    "body",
                    "updated_at",
                    "state",
                    "completed_at",
                    "revision",
                    "cycle",
                ];
                allowed.extend(TARGET);
                ensure(except(p, r, &allowed))?;
                if change == "relink" {
                    allowed.retain(|k| !["title", "kind", "body"].contains(k));
                    ensure(except(p, r, &allowed))?;
                }
                ensure(
                    n(r, "revision")? == n(p, "revision")? + i64::from(spec)
                        && n(r, "cycle")? == n(p, "cycle")? + i64::from(spec),
                )?;
                if spec {
                    ensure(
                        r["state"] == "reopened"
                            && r["completed_at"].is_null()
                            && e["evidence"].is_null(),
                    )?;
                    reopened = true;
                } else {
                    ensure(
                        r["state"] == p["state"]
                            && r["completed_at"] == p["completed_at"]
                            && e["evidence"] == prior["evidence"]
                            && e["source"] == prior["source"],
                    )?;
                }
            }
            "start" | "record_evidence" => {
                ensure(
                    p["kind"] == "cards"
                        && except(p, r, &["state", "completed_at", "updated_at"])
                        && e["source"] == prior["source"],
                )?;
                ensure(if change == "start" {
                    ["upcoming", "reopened", "in_progress"].contains(&s(p, "state")?)
                        && r["state"] == "in_progress"
                        && e["evidence"].is_null()
                } else {
                    p["state"] == "in_progress"
                        && ["in_progress", "completed"].contains(&s(r, "state")?)
                })?;
            }
            "complete" => {
                ensure(
                    except(p, r, &["state", "completed_at", "updated_at"])
                        && e["source"] == prior["source"]
                        && p["state"] != "completed"
                        && r["state"] == "completed"
                        && r["completed_at"] == at
                        && at > s(p, "created_at")?,
                )?;
            }
            "reopen" => {
                ensure(
                    except(p, r, &["cycle", "state", "completed_at", "updated_at"])
                        && e["source"] == prior["source"]
                        && n(r, "cycle")? == n(p, "cycle")? + 1
                        && r["state"] == "reopened"
                        && r["completed_at"].is_null()
                        && e["evidence"].is_null(),
                )?;
                reopened = true;
            }
            "reorder" | "remove_activity" => {
                let mut allowed = vec!["position", "updated_at"];
                if change == "remove_activity" {
                    allowed.push("removed_at");
                }
                ensure(
                    except(p, r, &allowed)
                        && e["source"] == prior["source"]
                        && e["evidence"] == prior["evidence"],
                )?;
                if !r["removed_at"].is_null() {
                    ensure(change == "remove_activity" && r["removed_at"] == at)?;
                }
            }
            _ => return Err(INVALID.into()),
        }
    }
    cards::transition(previous, op)?;
    if ["reopen", "complete", "relink", "start"].contains(&change) {
        ensure(affected > 0)?;
    }
    if change == "archive" {
        ensure(affected == 0 && old["archived"] != a["archived"])?;
    }
    if reopened {
        ensure(a["state"] == "reopened")?;
    } else if change == "complete" {
        ensure(a["state"] != "reopened")?;
    } else if a["state"] == "reopened" {
        ensure(old["state"] == "reopened")?;
    }
    if a["state"] == "completed" {
        ensure(
            a["completed_at"]
                == if old["state"] == "completed" {
                    old["completed_at"].clone()
                } else {
                    json!(at)
                },
        )?;
    }
    Ok(())
}

pub(crate) fn rows(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Value>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|n| n.to_string())
        .collect();
    let mapped = statement
        .query_map(params, |r| {
            let mut object = serde_json::Map::new();
            for (i, k) in names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Text(t) => json!(std::str::from_utf8(t).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            i,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?),
                    _ => {
                        return Err(rusqlite::Error::InvalidColumnType(
                            i,
                            k.clone(),
                            r.get_ref(i)?.data_type(),
                        ))
                    }
                };
                object.insert(k.clone(), v);
            }
            Ok(Value::Object(object))
        })
        .map_err(|e| e.to_string())?;
    mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
fn live_matches(snapshot: &Value, assignment: &Value, activities: &[Value]) -> bool {
    let mut expected = snapshot.clone();
    if assignment["lesson_id"].is_null() {
        expected["assignment"]["lesson_id"] = Value::Null;
    }
    for e in expected["activities"].as_array_mut().unwrap() {
        if let Some(r) = activities.iter().find(|r| r["id"] == e["record"]["id"]) {
            for k in ["material_id", "test_version_id"] {
                if r[k].is_null() {
                    e["record"][k] = Value::Null;
                }
            }
        }
    }
    expected["assignment"] == *assignment
        && expected["activities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["record"].clone())
            .collect::<Vec<_>>()
            == activities
}
pub(crate) fn sources(conn: &Connection, snapshot: &Value, writing: bool) -> Result<(), String> {
    for e in list(snapshot, "activities")? {
        let r = &e["record"];
        if let Some(id) = r["card_set_id"].as_str() {
            use sha2::{Digest, Sha256};
            ensure(
                hex::encode(Sha256::digest(
                    format!(
                        "{}\0{}",
                        s(r, "source_material_id")?,
                        s(r, "source_revision")?
                    )
                    .as_bytes(),
                )) == id,
            )?;
        }
        if let Some(id) = r["source_test_version_id"].as_str() {
            let versions = rows(conn,"SELECT source_material_id,history_key,content_hash FROM practice_test_versions WHERE id=?", &[&id])?;
            if let Some(v) = versions.first() {
                ensure(
                    (v["source_material_id"] == r["source_material_id"]
                        || v["source_material_id"].is_null())
                        && v["history_key"] == s(r, "source_material_id")?
                        && v["content_hash"] == r["source_revision"],
                )?;
            } else if writing && !r["test_version_id"].is_null() {
                return Err("SOURCE".into());
            }
        }
        if writing && r["kind"] == "read" && r["state"] == "completed" && r["material_id"].is_null()
        {
            return Err("SOURCE".into());
        }
        if !writing || r["material_id"].is_null() {
            continue;
        }
        let id = s(r, "material_id")?;
        ensure(!rows(conn, "SELECT id FROM study_materials WHERE id=?", &[&id])?.is_empty())?;
        if r["kind"] == "read" && !r["source_revision"].is_null() {
            let identities = rows(conn,"SELECT content_sha256,total_pages FROM material_content_identities WHERE material_id=?",&[&id])?;
            let identity = identities.first().ok_or("SOURCE")?;
            ensure(
                identity["content_sha256"] == r["source_revision"]
                    && identity["total_pages"] == e["source"]["total_pages"]
                    && (r["page_end"].is_null()
                        || n(r, "page_end")? <= n(identity, "total_pages")?),
            )?;
        }
        if r["kind"] == "cards" && !r["source_revision"].is_null() {
            let sets = rows(
                conn,
                "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?",
                &[&id],
            )?;
            let set = sets.first().ok_or("SOURCE")?;
            let cards = crate::card_reviews::parse_saved_cards(set["flashcards_json"].as_str());
            let crate::card_reviews::SavedCards::Ok(cards) = cards else {
                return Err("SOURCE".into());
            };
            let derived = crate::card_reviews::card_version(id, &cards);
            ensure(
                derived.content_hash == s(r, "source_revision")?
                    && derived.version_id == s(r, "card_set_id")?,
            )?;
        }
    }
    Ok(())
}
pub(crate) fn validate_database(conn: &Connection) -> Result<(), String> {
    let mut run_count = 0;
    let mut seen = std::collections::HashSet::new();
    let mut count = 0;
    for assignment in rows(conn, "SELECT * FROM homework_assignments ORDER BY id", &[])? {
        let id = s(&assignment, "id")?;
        let mut previous: Option<Value> = None;
        for row in rows(
            conn,
            "SELECT * FROM homework_history WHERE assignment_id=? ORDER BY revision",
            &[&id],
        )? {
            count += 1;
            let receipts = rows(
                conn,
                "SELECT * FROM homework_operations WHERE operation_id=?",
                &[&s(&row, "operation_id")?],
            )?;
            let receipt = receipts.first().ok_or(INVALID)?;
            let op = parse(s(receipt, "request_json")?)?;
            decode_operation(&op)?;
            ensure(
                op["operationId"] == row["operation_id"]
                    && op["assignmentId"] == id
                    && receipt["assignment_id"] == id,
            )?;
            ensure(
                n(&op, "baseRevision")?
                    == previous
                        .as_ref()
                        .map(|p| n(&p["assignment"], "revision"))
                        .transpose()?
                        .unwrap_or(0)
                    && n(&row, "revision")? == n(&op, "baseRevision")? + 1,
            )?;
            ensure(
                op["changeKind"] == row["change_kind"]
                    && op["at"] == row["recorded_at"]
                    && op["at"] == receipt["applied_at"],
            )?;
            ensure(
                compute_canonical_hash(&op) == receipt["request_hash"]
                    && parse(s(&row, "snapshot_json")?)? == op["next"],
            )?;
            ensure(
                s(receipt, "result_json")?
                    == canonical_json(
                        &json!({"version":1,"assignmentId":id,"revision":row["revision"]}),
                    ),
            )?;
            transition(previous.as_ref(), &op)?;
            sources(conn, &op["next"], false)?;
            for r in list(&op["next"], "runs")? {
                cards::events(conn, &op["next"], r, false)?;
            }
            previous = Some(op["next"].clone());
            for e in list(previous.as_ref().unwrap(), "activities")? {
                ensure(!seen.contains(s(&e["record"], "id")?))?;
            }
        }
        let previous = previous.ok_or(INVALID)?;
        ensure(previous["assignment"]["revision"] == assignment["revision"])?;
        let activities = rows(
            conn,
            "SELECT * FROM homework_activities WHERE assignment_id=? ORDER BY id",
            &[&id],
        )?;
        ensure(live_matches(&previous, &assignment, &activities))?;
        cards::live_rows(conn, &previous)?;
        run_count += list(&previous, "runs")?.len();
        for e in list(&previous, "activities")? {
            seen.insert(s(&e["record"], "id")?.to_string());
        }
    }
    ensure(
        n(
            &rows(conn, "SELECT COUNT(*) AS n FROM homework_runs", &[])?[0],
            "n",
        )? == run_count as i64,
    )?;
    ensure(
        n(
            &rows(conn, "SELECT COUNT(*) AS n FROM homework_operations", &[])?[0],
            "n",
        )? == count,
    )?;
    ensure(
        n(
            &rows(conn, "SELECT COUNT(*) AS n FROM homework_activities", &[])?[0],
            "n",
        )? == seen.len() as i64,
    )
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct HomeworkError {
    code: &'static str,
    message: &'static str,
}
fn error(code: &'static str) -> HomeworkError {
    let message = match code {
        "INVALID" => INVALID,
        "STALE" => "This homework changed after you opened it. Your changes haven't been saved; reload it to continue.",
        "CONFLICT" => "This save request was already used for different homework. Your changes haven't been saved.",
        "SOURCE" => "Source missing or changed — choose a source to continue.",
        _ => "A storage problem stopped this homework from saving. Your changes haven't been saved.",
    };
    HomeworkError { code, message }
}
fn put(conn: &Connection, table: &str, record: &Value) -> Result<(), String> {
    let object = record.as_object().ok_or(INVALID)?;
    let fields: Vec<&str> = object.keys().map(String::as_str).collect();
    let updates = fields
        .iter()
        .filter(|k| **k != "id")
        .map(|k| format!("{k}=excluded.{k}"))
        .collect::<Vec<_>>()
        .join(",");
    let params: Vec<rusqlite::types::Value> = object
        .values()
        .map(|v| match v {
            Value::Null => rusqlite::types::Value::Null,
            Value::String(s) => rusqlite::types::Value::Text(s.clone()),
            _ => rusqlite::types::Value::Integer(v.as_i64().unwrap()),
        })
        .collect();
    conn.execute(
        &format!(
            "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT(id) DO UPDATE SET {updates}",
            fields.join(","),
            vec!["?"; fields.len()].join(",")
        ),
        rusqlite::params_from_iter(params),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn apply(conn: &Connection, op: &Value) -> Result<Value, HomeworkError> {
    let raw = canonical_json(op);
    let hash = compute_canonical_hash(op);
    let id = s(op, "assignmentId").map_err(|_| error("INVALID"))?;
    let receipts = rows(
        conn,
        "SELECT * FROM homework_operations WHERE operation_id=?",
        &[&s(op, "operationId").unwrap()],
    )
    .map_err(|_| error("STORAGE"))?;
    if let Some(receipt) = receipts.first() {
        if receipt["request_json"] != raw || receipt["request_hash"] != hash {
            return Err(error("CONFLICT"));
        }
        let result = parse(s(receipt, "result_json").map_err(|_| error("INVALID"))?)
            .map_err(|_| error("INVALID"))?;
        if result
            != json!({"version":1,"assignmentId":id,"revision":n(op,"baseRevision").unwrap()+1})
        {
            return Err(error("INVALID"));
        }
        return Ok(result);
    }
    let assignments = rows(
        conn,
        "SELECT * FROM homework_assignments WHERE id=?",
        &[&id],
    )
    .map_err(|_| error("STORAGE"))?;
    let assignment = assignments.first();
    if assignment
        .map(|a| a["revision"].clone())
        .unwrap_or(json!(0))
        != op["baseRevision"]
    {
        return Err(error("STALE"));
    }
    let mut previous = None;
    if let Some(assignment) = assignment {
        let history = rows(conn,"SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1",&[&id]).map_err(|_|error("STORAGE"))?;
        let snapshot = history.first().ok_or_else(|| error("INVALID"))?;
        let snapshot = parse(s(snapshot, "snapshot_json").map_err(|_| error("INVALID"))?)
            .map_err(|_| error("INVALID"))?;
        let activities = rows(
            conn,
            "SELECT * FROM homework_activities WHERE assignment_id=? ORDER BY id",
            &[&id],
        )
        .map_err(|_| error("STORAGE"))?;
        if !live_matches(&snapshot, assignment, &activities) {
            return Err(error("INVALID"));
        }
        cards::live_rows(conn, &snapshot).map_err(|_| error("INVALID"))?;
        previous = Some(snapshot);
    }
    transition(previous.as_ref(), op).map_err(|_| error("INVALID"))?;
    cards::writes(conn, previous.as_ref(), op).map_err(|_| error("INVALID"))?;
    let next = &op["next"];
    let mut checked = next.clone();
    checked["activities"] = Value::Array(
        list(next, "activities")
            .unwrap()
            .iter()
            .filter(|e| {
                let prior = previous
                    .as_ref()
                    .and_then(|p| p["activities"].as_array())
                    .and_then(|a| a.iter().find(|p| p["record"]["id"] == e["record"]["id"]));
                match prior {
                    None => true,
                    Some(p) => {
                        p["source"] != e["source"]
                            || p["record"]["kind"] != e["record"]["kind"]
                            || TARGET
                                .iter()
                                .filter(|k| !["material_id", "test_version_id"].contains(k))
                                .any(|k| p["record"][k] != e["record"][k])
                            || (e["record"]["state"] == "completed"
                                && p["record"]["state"] != "completed")
                    }
                }
            })
            .cloned()
            .collect(),
    );
    sources(conn, &checked, true).map_err(|_| error("SOURCE"))?;
    let perform = || -> Result<Value, String> {
        let maximum = rows(
            conn,
            "SELECT COALESCE(MAX(position),0) AS n FROM homework_activities WHERE assignment_id=?",
            &[&id],
        )?;
        let offset = n(&maximum[0], "n")? + list(next, "activities")?.len() as i64 + 1;
        ensure(offset <= 4_503_599_627_370_495)?;
        conn.execute("UPDATE homework_activities SET position=position+? WHERE assignment_id=? AND removed_at IS NULL",params![offset,id]).map_err(|e|e.to_string())?;
        put(conn, "homework_assignments", &next["assignment"])?;
        for e in list(next, "activities")? {
            let owner = rows(
                conn,
                "SELECT assignment_id FROM homework_activities WHERE id=?",
                &[&s(&e["record"], "id")?],
            )?;
            ensure(owner.first().map_or(true, |o| o["assignment_id"] == id))?;
            put(conn, "homework_activities", &e["record"])?;
        }
        for r in list(next, "runs")? {
            let owner = rows(
                conn,
                "SELECT activity_id FROM homework_runs WHERE id=?",
                &[&s(r, "id")?],
            )?;
            ensure(
                owner
                    .first()
                    .map_or(true, |o| o["activity_id"] == r["activity_id"]),
            )?;
            put(conn, "homework_runs", &cards::row(r))?;
        }
        let result =
            json!({"version":1,"assignmentId":id,"revision":next["assignment"]["revision"]});
        conn.execute(
            "INSERT INTO homework_operations VALUES (?,?,?,?,?,?)",
            params![
                s(op, "operationId")?,
                id,
                raw,
                hash,
                canonical_json(&result),
                s(op, "at")?
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO homework_history VALUES (?,?,?,?,?,?)",
            params![
                id,
                n(&next["assignment"], "revision")?,
                s(op, "operationId")?,
                s(op, "changeKind")?,
                canonical_json(next),
                s(op, "at")?
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(result)
    };
    perform().map_err(|_| error("STORAGE"))
}
pub(crate) fn execute_homework(conn: &mut Connection, op: &Value) -> Result<Value, HomeworkError> {
    decode_operation(op).map_err(|_| error("INVALID"))?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| error("STORAGE"))?;
    let result = apply(&tx, op)?;
    tx.commit().map_err(|_| error("STORAGE"))?;
    Ok(result)
}
#[tauri::command]
pub(crate) async fn save_homework_atomically(
    app: tauri::AppHandle,
    operation: Value,
) -> Result<Value, HomeworkError> {
    let root = crate::storage::app_root(&app).map_err(|_| error("STORAGE"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = root.join("her-flight-deck.db");
        if !path.is_file() {
            return Err(error("STORAGE"));
        }
        let mut conn = Connection::open(path).map_err(|_| error("STORAGE"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| error("STORAGE"))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|_| error("STORAGE"))?;
        execute_homework(&mut conn, &operation)
    })
    .await
    .map_err(|_| error("STORAGE"))?
}
