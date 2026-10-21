//! Homework card queues and rating attribution on the caller's owned transaction.
use super::*;

pub(crate) fn context(v: &Value) -> Result<(), String> {
    keys(
        v,
        "assignmentId runId expectedRevision activityRevision cycle",
    )?;
    ensure(uuid(s(v, "assignmentId")?) && uuid(s(v, "runId")?))?;
    for k in ["expectedRevision", "activityRevision", "cycle"] {
        ensure(n(v, k)? >= 1)?;
    }
    Ok(())
}
pub(super) fn row(r: &Value) -> Value {
    json!({"id":r["id"],"activity_id":r["activity_id"],"cycle":r["cycle"],"activity_revision":r["activity_revision"],"kind":"cards",
        "scope_json":canonical_json(&r["scope"]),"evidence_json":if r["finished_at"].is_null(){Value::Null}else{json!(canonical_json(&r["ratings"]))},
        "attempt_id":null,"source_attempt_id":null,"started_at":r["started_at"],"finished_at":r["finished_at"],"invalidated_at":r["invalidated_at"]})
}
pub(super) fn snapshot(v: &Value) -> Result<(), String> {
    let runs = list(v, "runs")?;
    let mut ids = Vec::new();
    let mut open = std::collections::HashSet::new();
    for r in runs {
        keys(r,"id activity_id cycle activity_revision kind scope ratings started_at finished_at invalidated_at")?;
        ensure(
            uuid(s(r, "id")?)
                && uuid(s(r, "activity_id")?)
                && r["kind"] == "cards"
                && n(r, "cycle")? >= 1
                && n(r, "activity_revision")? >= 1,
        )?;
        ids.push(s(r, "id")?);
        let activity = list(v, "activities")?
            .iter()
            .find(|e| e["record"]["id"] == r["activity_id"])
            .ok_or(INVALID)?;
        let a = &activity["record"];
        ensure(
            instant(s(r, "started_at")?)
                && s(r, "started_at")? > s(a, "created_at")?
                && s(r, "started_at")? <= s(&v["assignment"], "updated_at")?
                && n(r, "cycle")? <= n(a, "cycle")?
                && n(r, "activity_revision")? <= n(a, "revision")?,
        )?;
        let scope = &r["scope"];
        keys(scope,"version material_id source_revision card_set_id generation item_ids next_local_midnight")?;
        ensure(
            scope["version"] == 1
                && uuid(s(scope, "material_id")?)
                && hash(s(scope, "source_revision")?)
                && hash(s(scope, "card_set_id")?)
                && (0..=1_000_000_000).contains(&n(scope, "generation")?),
        )?;
        let items = list(scope, "item_ids")?;
        ensure(
            !items.is_empty()
                && items.len() <= 20
                && items.iter().all(|i| i.as_str().is_some_and(hash))
                && items.iter().collect::<std::collections::HashSet<_>>().len() == items.len(),
        )?;
        let midnight =
            crate::card_reviews::parse_iso_ms(s(scope, "next_local_midnight")?).ok_or(INVALID)?;
        let start = crate::card_reviews::parse_iso_ms(s(r, "started_at")?).ok_or(INVALID)?;
        ensure(midnight > start && midnight - start <= 27 * 3600000)?;
        let ratings = list(r, "ratings")?;
        let mut rated = std::collections::HashSet::new();
        let mut operations = std::collections::HashSet::new();
        for x in ratings {
            keys(x,"event_id operation_id item_id generation reviewed_at rating item_revision assignment_revision")?;
            ensure(
                uuid(s(x, "event_id")?)
                    && x["event_id"] == x["operation_id"]
                    && items.contains(&x["item_id"])
                    && rated.insert(s(x, "item_id")?)
                    && operations.insert(s(x, "operation_id")?),
            )?;
            ensure(
                x["generation"] == scope["generation"]
                    && instant(s(x, "reviewed_at")?)
                    && s(x, "reviewed_at")? > s(r, "started_at")?
                    && s(x, "reviewed_at")? <= s(&v["assignment"], "updated_at")?
                    && ["again", "hard", "good", "easy"].contains(&s(x, "rating")?)
                    && (0..=1_000_000_000).contains(&n(x, "item_revision")?)
                    && n(x, "assignment_revision")? >= 1
                    && n(x, "assignment_revision")? < n(&v["assignment"], "revision")?,
            )?;
        }
        opt_check(r, "finished_at", instant)?;
        opt_check(r, "invalidated_at", instant)?;
        ensure(!r["finished_at"].is_null() == (ratings.len() == items.len()))?;
        if !r["finished_at"].is_null() {
            ensure(
                r["invalidated_at"].is_null()
                    && r["finished_at"] == ratings.last().ok_or(INVALID)?["reviewed_at"],
            )?;
        }
        if !r["invalidated_at"].is_null() {
            ensure(
                s(r, "invalidated_at")? >= s(r, "started_at")?
                    && s(r, "invalidated_at")? <= s(&v["assignment"], "updated_at")?,
            )?;
        }
        if r["invalidated_at"].is_null() && r["cycle"] == a["cycle"] {
            ensure(
                a["kind"] == "cards"
                    && a["revision"] == r["activity_revision"]
                    && a["source_material_id"] == scope["material_id"]
                    && a["source_revision"] == scope["source_revision"]
                    && a["card_set_id"] == scope["card_set_id"],
            )?;
            ensure(if r["finished_at"].is_null() {
                a["state"] == "in_progress" && a["removed_at"].is_null()
            } else {
                a["state"] == "completed" && a["completed_at"] == r["finished_at"]
            })?;
        }
        if r["finished_at"].is_null() && r["invalidated_at"].is_null() {
            ensure(open.insert(s(r, "activity_id")?))?;
        }
    }
    ensure(ids.windows(2).all(|p| p[0] < p[1]))?;
    for e in list(v, "activities")? {
        let a = &e["record"];
        if a["kind"] == "cards"
            && a["removed_at"].is_null()
            && ["in_progress", "completed"].contains(&s(a, "state")?)
        {
            let matching: Vec<_> = runs
                .iter()
                .filter(|r| {
                    r["activity_id"] == a["id"]
                        && r["cycle"] == a["cycle"]
                        && r["invalidated_at"].is_null()
                })
                .collect();
            ensure(
                matching.len() == 1
                    && (a["state"] == "completed") == !matching[0]["finished_at"].is_null(),
            )?;
        }
    }
    Ok(())
}
pub(super) fn transition(previous: &Value, op: &Value) -> Result<(), String> {
    let runs = list(&op["next"], "runs")?;
    let old = list(previous, "runs")?;
    let change = s(op, "changeKind")?;
    ensure(old.iter().all(|p| runs.iter().any(|r| r["id"] == p["id"])))?;
    let mut starts = 0;
    let mut ratings = 0;
    for r in runs {
        let Some(p) = old.iter().find(|p| p["id"] == r["id"]) else {
            starts += 1;
            ensure(
                change == "start"
                    && r["started_at"] == op["at"]
                    && list(r, "ratings")?.is_empty()
                    && r["finished_at"].is_null()
                    && r["invalidated_at"].is_null(),
            )?;
            continue;
        };
        if r == p {
            continue;
        }
        if change == "record_evidence" {
            ratings += 1;
            let xs = list(r, "ratings")?;
            let ps = list(p, "ratings")?;
            ensure(
                p["finished_at"].is_null()
                    && p["invalidated_at"].is_null()
                    && except(p, r, &["ratings", "finished_at"])
                    && xs.len() == ps.len() + 1
                    && &xs[..ps.len()] == ps,
            )?;
            let last = xs.last().ok_or(INVALID)?;
            ensure(
                last["reviewed_at"] == op["at"]
                    && last["assignment_revision"] == op["baseRevision"],
            )?;
        } else {
            ensure(
                p["finished_at"].is_null()
                    && p["invalidated_at"].is_null()
                    && r["invalidated_at"] == op["at"]
                    && except(p, r, &["invalidated_at"]),
            )?;
            let a = &list(&op["next"], "activities")?
                .iter()
                .find(|e| e["record"]["id"] == r["activity_id"])
                .ok_or(INVALID)?["record"];
            ensure(
                ["reopen", "edit", "relink", "remove_activity"].contains(&change)
                    && (a["cycle"] != r["cycle"] || !a["removed_at"].is_null()),
            )?;
        }
    }
    ensure(change != "start" || starts == 1)?;
    ensure(change != "record_evidence" || ratings == 1)?;
    for p in old
        .iter()
        .filter(|r| r["finished_at"].is_null() && r["invalidated_at"].is_null())
    {
        let a = &list(&op["next"], "activities")?
            .iter()
            .find(|e| e["record"]["id"] == p["activity_id"])
            .ok_or(INVALID)?["record"];
        if a["cycle"] != p["cycle"] || !a["removed_at"].is_null() {
            ensure(
                runs.iter().find(|r| r["id"] == p["id"]).ok_or(INVALID)?["invalidated_at"]
                    == op["at"],
            )?;
        }
    }
    Ok(())
}
fn rating_action(v: &Value, r: &Value, x: &Value) -> Value {
    json!({"action":"rate","operationId":x["operation_id"],"materialId":r["scope"]["material_id"],"versionContentHash":r["scope"]["source_revision"],"itemId":x["item_id"],"expectedGeneration":x["generation"],"expectedRevision":x["item_revision"],"rating":x["rating"],"homework":{"assignmentId":v["assignment"]["id"],"runId":r["id"],"expectedRevision":x["assignment_revision"],"activityRevision":r["activity_revision"],"cycle":r["cycle"]}})
}
pub(super) fn events(conn: &Connection, v: &Value, r: &Value, writing: bool) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let scope = &r["scope"];
    let material = s(scope, "material_id")?;
    let digest = format!(
        "{:x}",
        Sha256::digest(format!("{material}\0{}", s(scope, "source_revision")?).as_bytes())
    );
    ensure(scope["card_set_id"] == digest)?;
    let sets = rows(
        conn,
        "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?",
        &[&material],
    )?;
    if let crate::card_reviews::SavedCards::Ok(cards) = crate::card_reviews::parse_saved_cards(
        sets.first().and_then(|v| v["flashcards_json"].as_str()),
    ) {
        let current = crate::card_reviews::card_version(material, &cards);
        if scope["card_set_id"] == current.version_id {
            ensure(
                list(scope, "item_ids")?
                    .iter()
                    .all(|id| current.items.iter().any(|i| *id == i.item_id)),
            )?;
        }
    }
    for id in list(scope, "item_ids")? {
        let items=rows(conn,"SELECT i.version_id,v.source_material_id FROM card_items i JOIN card_versions v ON v.id=i.version_id WHERE i.id=?",&[&id.as_str().ok_or(INVALID)?])?;
        if let Some(item) = items.first() {
            ensure(
                item["version_id"] == scope["card_set_id"]
                    && item["source_material_id"] == scope["material_id"],
            )?;
        }
    }
    for x in list(r, "ratings")? {
        let es = rows(
            conn,
            "SELECT * FROM card_review_events WHERE id=?",
            &[&s(x, "event_id")?],
        )?;
        let receipts = rows(
            conn,
            "SELECT * FROM card_review_operations WHERE operation_id=?",
            &[&s(x, "operation_id")?],
        )?;
        if let Some(e) = es.first() {
            ensure(
                e["item_id"] == x["item_id"]
                    && e["generation"] == x["generation"]
                    && e["reviewed_at"] == x["reviewed_at"]
                    && e["rating"] == x["rating"],
            )?;
        }
        if let Some(receipt) = receipts.first() {
            ensure(
                receipt["action"] == "rate"
                    && receipt["source_material_id"] == r["scope"]["material_id"]
                    && receipt["generation"] == x["generation"]
                    && receipt["applied_at"] == x["reviewed_at"]
                    && receipt["request_hash"] == compute_canonical_hash(&rating_action(v, r, x)),
            )?;
            if receipt["is_erased"] == 0 {
                let result = parse(s(receipt, "result_json")?)?;
                ensure(
                    result["itemId"] == x["item_id"]
                        && result["reviewedAt"] == x["reviewed_at"]
                        && n(&result, "revision")? == n(x, "item_revision")? + 1,
                )?;
            }
        }
        if writing {
            ensure(!es.is_empty() && receipts.first().is_some_and(|p| p["is_erased"] == 0))?;
        }
    }
    Ok(())
}
pub(super) fn live_rows(conn: &Connection, v: &Value) -> Result<(), String> {
    let actual=rows(conn,"SELECT r.* FROM homework_runs r JOIN homework_activities a ON a.id=r.activity_id WHERE a.assignment_id=? ORDER BY r.id",&[&s(&v["assignment"],"id")?])?;
    ensure(actual == list(v, "runs")?.iter().map(row).collect::<Vec<_>>())?;
    for r in list(v, "runs")? {
        events(conn, v, r, false)?;
    }
    Ok(())
}
fn queue(conn: &Connection, r: &Value, at: &str) -> Result<Vec<Value>, String> {
    let scope = &r["scope"];
    let material = s(scope, "material_id")?;
    let sets = rows(
        conn,
        "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?",
        &[&material],
    )?;
    let crate::card_reviews::SavedCards::Ok(cards) = crate::card_reviews::parse_saved_cards(
        sets.first().and_then(|v| v["flashcards_json"].as_str()),
    ) else {
        return Err(INVALID.into());
    };
    let version = crate::card_reviews::card_version(material, &cards);
    ensure(
        version.version_id == scope["card_set_id"]
            && version.content_hash == scope["source_revision"],
    )?;
    let generation = rows(
        conn,
        "SELECT generation FROM card_review_generations WHERE source_material_id=?",
        &[&material],
    )?;
    ensure(
        scope["generation"]
            == generation
                .first()
                .map(|v| v["generation"].clone())
                .unwrap_or(json!(0)),
    )?;
    let due=rows(conn,"SELECT s.item_id FROM card_review_state s JOIN card_items i ON i.id=s.item_id WHERE i.version_id=? AND s.source_material_id=? AND s.suspended=0 AND s.flag IS NULL AND s.due_at IS NOT NULL AND ((s.step<0 AND s.due_at<=?) OR (s.step>=0 AND s.due_at<?)) ORDER BY CASE WHEN s.step<0 THEN 0 ELSE 1 END,s.due_at,i.ordinal,s.item_id LIMIT 20",&[&version.version_id,&material,&at,&s(scope,"next_local_midnight")?])?;
    let mut selected: Vec<Value> = due.iter().map(|v| v["item_id"].clone()).collect();
    let mut fresh = 0;
    for item in &version.items {
        if fresh >= 10 || selected.len() >= 20 {
            break;
        }
        let state = rows(
            conn,
            "SELECT due_at,suspended,flag FROM card_review_state WHERE item_id=?",
            &[&item.item_id],
        )?;
        if state.first().map_or(true, |s| {
            s["due_at"].is_null() && s["suspended"] == 0 && s["flag"].is_null()
        }) {
            selected.push(json!(item.item_id));
            fresh += 1;
        }
    }
    Ok(selected)
}
pub(super) fn writes(
    conn: &Connection,
    previous: Option<&Value>,
    op: &Value,
) -> Result<(), String> {
    for r in list(&op["next"], "runs")? {
        let prior = previous
            .and_then(|p| p["runs"].as_array())
            .and_then(|ps| ps.iter().find(|p| p["id"] == r["id"]));
        if prior.is_none() {
            ensure(
                op["next"]["assignment"]["archived"] == 0
                    && queue(conn, r, s(op, "at")?)? == *list(&r["scope"], "item_ids")?,
            )?;
        }
        if list(r, "ratings")?.len()
            > prior
                .map(|p| list(p, "ratings").map(Vec::len))
                .transpose()?
                .unwrap_or(0)
        {
            events(conn, &op["next"], r, true)?;
        }
    }
    Ok(())
}
fn latest(conn: &Connection, id: &str) -> Result<Value, String> {
    let h=rows(conn,"SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1",&[&id])?;
    parse(s(h.first().ok_or(INVALID)?, "snapshot_json")?)
}
pub(crate) fn record_rating(conn: &Connection, action: &Value, at: &str) -> Result<(), String> {
    let c = &action["homework"];
    context(c)?;
    let previous = latest(conn, s(c, "assignmentId")?)?;
    ensure(
        previous["assignment"]["revision"] == c["expectedRevision"]
            && previous["assignment"]["archived"] == 0,
    )?;
    let mut next = previous.clone();
    let r = next["runs"]
        .as_array_mut()
        .ok_or(INVALID)?
        .iter_mut()
        .find(|r| r["id"] == c["runId"])
        .ok_or(INVALID)?;
    ensure(
        r["cycle"] == c["cycle"]
            && r["activity_revision"] == c["activityRevision"]
            && r["finished_at"].is_null()
            && r["invalidated_at"].is_null(),
    )?;
    ensure(
        r["scope"]["material_id"] == action["materialId"]
            && r["scope"]["source_revision"] == action["versionContentHash"]
            && r["scope"]["generation"] == action["expectedGeneration"]
            && list(&r["scope"], "item_ids")?.contains(&action["itemId"])
            && !list(r, "ratings")?
                .iter()
                .any(|x| x["item_id"] == action["itemId"])
            && at > s(r, "started_at")?
            && at >= s(&previous["assignment"], "updated_at")?,
    )?;
    r["ratings"].as_array_mut().ok_or(INVALID)?.push(json!({"event_id":action["operationId"],"operation_id":action["operationId"],"item_id":action["itemId"],"generation":action["expectedGeneration"],"reviewed_at":at,"rating":action["rating"],"item_revision":action["expectedRevision"],"assignment_revision":c["expectedRevision"]}));
    let finished = list(r, "ratings")?.len() == list(&r["scope"], "item_ids")?.len();
    if finished {
        r["finished_at"] = json!(at);
    }
    let activity_id = r["activity_id"].clone();
    let e = next["activities"]
        .as_array_mut()
        .ok_or(INVALID)?
        .iter_mut()
        .find(|e| e["record"]["id"] == activity_id)
        .ok_or(INVALID)?;
    ensure(
        e["record"]["cycle"] == c["cycle"]
            && e["record"]["revision"] == c["activityRevision"]
            && e["record"]["removed_at"].is_null()
            && e["record"]["material_id"] == action["materialId"],
    )?;
    e["record"]["updated_at"] = json!(at);
    if finished {
        e["record"]["state"] = json!("completed");
        e["record"]["completed_at"] = json!(at);
        let mut evidence = json!({"version":1,"activity_id":activity_id});
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
            evidence[k] = e["record"][k].clone();
        }
        e["evidence"] = evidence;
    }
    next["assignment"]["revision"] = json!(n(&previous["assignment"], "revision")? + 1);
    next["assignment"]["updated_at"] = json!(at);
    let all = list(&next, "activities")?
        .iter()
        .filter(|e| e["record"]["removed_at"].is_null())
        .all(|e| e["record"]["state"] == "completed");
    next["assignment"]["state"] = json!(if all { "completed" } else { "in_progress" });
    next["assignment"]["completed_at"] = if all { json!(at) } else { Value::Null };
    let op = json!({"version":1,"operationId":action["operationId"],"assignmentId":c["assignmentId"],"baseRevision":c["expectedRevision"],"changeKind":"record_evidence","at":at,"next":next});
    apply(conn, &op).map_err(|e| e.message.to_string())?;
    Ok(())
}
pub(crate) fn invalidate(conn: &Connection, material: &str, at: &str) -> Result<(), String> {
    invalidate_if(conn, material, at, false)
}
pub(crate) fn invalidate_drift(conn: &Connection, material: &str, at: &str) -> Result<(), String> {
    invalidate_if(conn, material, at, true)
}
fn invalidate_if(
    conn: &Connection,
    material: &str,
    at: &str,
    drift_only: bool,
) -> Result<(), String> {
    if rows(
        conn,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='homework_runs'",
        &[],
    )?
    .is_empty()
    {
        return Ok(());
    }
    let sets = rows(
        conn,
        "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?",
        &[&material],
    )?;
    let current = match crate::card_reviews::parse_saved_cards(
        sets.first().and_then(|v| v["flashcards_json"].as_str()),
    ) {
        crate::card_reviews::SavedCards::Ok(cards) => {
            Some(crate::card_reviews::card_version(material, &cards).version_id)
        }
        _ => None,
    };
    let assignments=rows(conn,"SELECT DISTINCT a.assignment_id FROM homework_runs r JOIN homework_activities a ON a.id=r.activity_id WHERE r.kind='cards' AND r.finished_at IS NULL AND r.invalidated_at IS NULL",&[])?;
    for a in assignments {
        let previous = latest(conn, s(&a, "assignment_id")?)?;
        let mut next = previous.clone();
        let mut changed = Vec::new();
        for r in next["runs"].as_array_mut().ok_or(INVALID)? {
            if r["finished_at"].is_null()
                && r["invalidated_at"].is_null()
                && r["scope"]["material_id"] == material
            {
                if drift_only
                    && current
                        .as_ref()
                        .is_some_and(|v| r["scope"]["card_set_id"] == *v)
                {
                    continue;
                }
                ensure(at >= s(&previous["assignment"], "updated_at")?)?;
                r["invalidated_at"] = json!(at);
                changed.push(r["activity_id"].clone());
            }
        }
        if changed.is_empty() {
            continue;
        }
        for e in next["activities"]
            .as_array_mut()
            .ok_or(INVALID)?
            .iter_mut()
            .filter(|e| changed.contains(&e["record"]["id"]))
        {
            e["record"]["cycle"] = json!(n(&e["record"], "cycle")? + 1);
            e["record"]["state"] = json!("reopened");
            e["record"]["updated_at"] = json!(at);
            e["record"]["completed_at"] = Value::Null;
            e["evidence"] = Value::Null;
        }
        next["assignment"]["revision"] = json!(n(&previous["assignment"], "revision")? + 1);
        next["assignment"]["updated_at"] = json!(at);
        next["assignment"]["state"] = json!("reopened");
        next["assignment"]["completed_at"] = Value::Null;
        apply(conn,&json!({"version":1,"operationId":operation_uuid(&next),"assignmentId":next["assignment"]["id"],"baseRevision":previous["assignment"]["revision"],"changeKind":"reopen","at":at,"next":next})).map_err(|e|e.message.to_string())?;
    }
    Ok(())
}

fn operation_uuid(next: &Value) -> String {
    let h = compute_canonical_hash(next);
    format!(
        "{}-{}-4{}-8{}-{}",
        &h[..8],
        &h[8..12],
        &h[13..16],
        &h[17..20],
        &h[20..32]
    )
}
