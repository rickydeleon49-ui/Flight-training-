//! Validated evidence bound to the content transaction. TS: pdfKitSources.ts.
use crate::practice_sessions::compute_canonical_hash;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sources {
    pub run_id: String,
    pub run: Run,
    pub items: Vec<Source>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Run {
    pub material_id: String,
    pub content_sha256: String,
    pub selected_pages: Vec<u32>,
    pub extractor_version: u32,
    pub algorithm_version: u32,
    pub created_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub item_kind: String,
    pub logical_id: String,
    pub content_hash: String,
    pub page: u32,
    pub start_offset: usize,
    pub end_offset: usize,
    pub quote: String,
}
fn hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub fn decode(v: &Value, material: &str) -> Result<Sources, String> {
    let s: Sources = serde_json::from_value(v.clone()).map_err(|_| "INVALID_ARGUMENT")?;
    let r = &s.run;
    if !crate::practice_sessions::is_uuid_v4(&s.run_id)
        || s.run_id.bytes().any(|c| c.is_ascii_uppercase())
        || r.material_id != material
        || !hex(&r.content_sha256)
        || r.selected_pages.is_empty()
        || r.selected_pages.len() > 1000
        || r.selected_pages.iter().any(|p| !(1..=1000).contains(p))
        || r.selected_pages.windows(2).any(|w| w[0] >= w[1])
        || r.extractor_version == 0
        || r.extractor_version > i32::MAX as u32
        || r.algorithm_version == 0
        || r.algorithm_version > i32::MAX as u32
        || r.created_at.len() != 24
        || crate::card_reviews::parse_iso_ms(&r.created_at).is_none()
        || s.items.is_empty()
        || s.items.len() > 2000
    {
        return Err("INVALID_ARGUMENT".into());
    }
    let mut seen = std::collections::HashSet::new();
    for i in &s.items {
        if !["summary", "section", "card", "question"].contains(&i.item_kind.as_str())
            || !crate::study_sets::is_item_id(&i.logical_id)
            || (i.item_kind == "summary" && i.logical_id != format!("summary:{}", s.run_id))
            || !hex(&i.content_hash)
            || !r.selected_pages.contains(&i.page)
            || i.start_offset >= i.end_offset
            || i.end_offset > 131072
            || i.quote.is_empty()
            || i.quote.chars().count() > 2000
            || i.quote.len() != i.end_offset - i.start_offset
            || !seen.insert((
                &i.item_kind,
                &i.logical_id,
                &i.content_hash,
                i.page,
                i.start_offset,
            ))
        {
            return Err("INVALID_ARGUMENT".into());
        }
    }
    Ok(s)
}
pub fn content(kind: &str, item: &Value) -> Value {
    if kind == "summary" {
        return item.clone();
    }
    let fields: &[&str] = match kind {
        "question" => &[
            "question",
            "options",
            "correctIndex",
            "explanation",
            "sourcePage",
        ],
        "card" => &["front", "back", "sourcePage"],
        _ => &["heading", "body"],
    };
    Value::Object(
        fields
            .iter()
            .map(|k| ((*k).into(), item[*k].clone()))
            .collect(),
    )
}
pub fn validate_content(s: &Sources, next: &Value) -> Result<(), String> {
    for i in &s.items {
        let item = if i.item_kind == "summary" {
            &next["summary"]
        } else {
            let field = match i.item_kind.as_str() {
                "question" => "questions",
                "card" => "flashcards",
                _ => "sections",
            };
            next[field]
                .as_array()
                .and_then(|a| {
                    a.iter().find(|v| {
                        v.get("identity")
                            .or_else(|| v.get("itemId"))
                            .and_then(Value::as_str)
                            == Some(&i.logical_id)
                    })
                })
                .ok_or("INVALID_ARGUMENT")?
        };
        if item.is_null() || compute_canonical_hash(&content(&i.item_kind, item)) != i.content_hash
        {
            return Err("INVALID_ARGUMENT".into());
        }
    }
    Ok(())
}
pub fn write(conn: &Connection, s: &Sources) -> Result<(), String> {
    let r = &s.run;
    let row = json!([
        s.run_id,
        r.material_id,
        r.content_sha256,
        serde_json::to_string(&r.selected_pages).map_err(|_| "STORAGE_ERROR")?,
        r.extractor_version,
        r.algorithm_version,
        r.created_at
    ]);
    let prior: Option<Value> = conn.query_row("SELECT run_id, material_id, content_sha256, selected_pages_json, extractor_version, algorithm_version, created_at FROM pdf_kit_runs WHERE run_id = ?1", [&s.run_id], |r| Ok(json!([r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,u32>(4)?,r.get::<_,u32>(5)?,r.get::<_,String>(6)?]))).optional().map_err(|_| "STORAGE_ERROR")?;
    if let Some(prior) = prior {
        if prior != row {
            return Err("SOURCE_CHANGED".into());
        }
    } else {
        conn.execute("INSERT INTO pdf_kit_runs (run_id, material_id, content_sha256, selected_pages_json, extractor_version, algorithm_version, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![s.run_id,r.material_id,r.content_sha256,row[3].as_str(),r.extractor_version,r.algorithm_version,r.created_at]).map_err(|_| "STORAGE_ERROR")?;
    }
    for i in &s.items {
        let prior: Option<(usize, String)> = conn.query_row("SELECT end_offset, quote FROM pdf_kit_item_sources WHERE run_id = ?1 AND item_kind = ?2 AND logical_id = ?3 AND content_hash = ?4 AND page = ?5 AND start_offset = ?6", params![s.run_id,i.item_kind,i.logical_id,i.content_hash,i.page,i.start_offset], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_| "STORAGE_ERROR")?;
        if let Some((end, quote)) = prior {
            if end != i.end_offset || quote != i.quote {
                return Err("SOURCE_CHANGED".into());
            }
        } else {
            conn.execute("INSERT INTO pdf_kit_item_sources (run_id,item_kind,logical_id,content_hash,page,start_offset,end_offset,quote) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![s.run_id,i.item_kind,i.logical_id,i.content_hash,i.page,i.start_offset,i.end_offset,i.quote]).map_err(|_| "STORAGE_ERROR")?;
        }
    }
    Ok(())
}
