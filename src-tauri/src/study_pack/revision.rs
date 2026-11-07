//! The revision of one pack item: sha256 of the canonical JSON of an
//! identity-free projection P (design section 3).
//!
//! P holds content only. It has no ids, refs, region ids or hashes, citations,
//! provider, model, timestamps, item selection or item order. Sections, cards
//! and questions keep their authored order, because that order is content.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::format::{CardJson, ItemJson, ManifestFile, RegionJson};
use crate::practice_sessions::canonical_json;

fn origin_value(origin: &Option<String>) -> Value {
    origin.as_ref().map_or(Value::Null, |o| json!(o))
}

fn file_value(kind: &str, file: Option<&ManifestFile>) -> Value {
    match (kind, file) {
        ("document", Some(f)) => json!({
            "sha256": f.sha256, "bytes": f.bytes, "totalPages": f.total_pages,
        }),
        ("picture", Some(f)) => json!({
            "sha256": f.sha256, "width": f.width, "height": f.height,
        }),
        _ => Value::Null,
    }
}

fn card_value(card: &CardJson, regions: &[RegionJson]) -> Value {
    let picture = card
        .visual_region_id
        .as_ref()
        .and_then(|id| regions.iter().find(|r| &r.id == id))
        .map_or(Value::Null, |r| {
            json!({
                "imageSha256": r.image_sha256, "imageWidth": r.image_width,
                "imageHeight": r.image_height, "x": r.x, "y": r.y, "w": r.w,
                "h": r.h, "rotation": r.rotation,
            })
        });
    json!({
        "front": card.front, "back": card.back, "sourcePage": card.source_page,
        "origin": origin_value(&card.origin), "picture": picture,
    })
}

/// The projection P of one item.
pub fn projection(kind: &str, item: &ItemJson, file: Option<&ManifestFile>) -> Value {
    let regions: &[RegionJson] = item.visual_regions.as_deref().unwrap_or(&[]);
    let guide = item.guide.as_ref().map_or(Value::Null, |g| {
        json!({
            "title": g.title,
            "summary": g.summary,
            "summaryOrigin": origin_value(&g.summary_origin),
            "sections": g.sections.iter().map(|s| json!({
                "heading": s.heading, "body": s.body, "origin": origin_value(&s.origin),
            })).collect::<Vec<_>>(),
            "flashcards": g.flashcards.iter().map(|c| card_value(c, regions)).collect::<Vec<_>>(),
            "sourceNotes": g.source_notes,
        })
    });
    let practice = item.practice.as_ref().map_or(Value::Null, |p| {
        json!({
            "title": p.title,
            "questions": p.questions.iter().map(|q| {
                let mut tasks = q.acs_tasks.clone();
                tasks.sort();
                json!({
                    "question": q.question, "options": q.options,
                    "correctIndex": q.correct_index, "explanation": q.explanation,
                    "sourcePage": q.source_page, "origin": origin_value(&q.origin),
                    "acsTasks": tasks,
                })
            }).collect::<Vec<_>>(),
        })
    });
    let mut videos: Vec<(&str, &str)> = item
        .videos
        .iter()
        .map(|v| (v.url.as_str(), v.title.as_str()))
        .collect();
    videos.sort();
    let lineage = item.lineage.as_ref().map_or(Value::Null, |l| {
        json!({
            "pages": {
                "sourcePageStart": l.source_page_start, "sourcePageEnd": l.source_page_end,
                "parentPageStart": l.parent_page_start, "parentPageEnd": l.parent_page_end,
            },
            "nestedLevel": l.nested_level,
        })
    });
    json!({
        "kind": kind,
        "title": item.title,
        "materialType": item.material_type,
        "topic": item.topic,
        "file": file_value(kind, file),
        "guide": guide,
        "practice": practice,
        "videos": videos.iter().map(|(u, t)| json!({"url": u, "title": t})).collect::<Vec<_>>(),
        "lineage": lineage,
    })
}

/// Lower-case hex sha256 of the canonical JSON of P.
pub fn revision_of(kind: &str, item: &ItemJson, file: Option<&ManifestFile>) -> String {
    let canonical = canonical_json(&projection(kind, item, file));
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

/// The pack-local id of a picture region: the hash of its content alone.
pub fn region_id(
    image_sha256: &str,
    image_width: i64,
    image_height: i64,
    rect: (i64, i64, i64, i64),
    rotation: i64,
) -> String {
    let value = json!({
        "version": 1, "imageSha256": image_sha256, "imageWidth": image_width,
        "imageHeight": image_height, "x": rect.0, "y": rect.1, "w": rect.2,
        "h": rect.3, "rotation": rotation,
    });
    hex::encode(Sha256::digest(canonical_json(&value).as_bytes()))
}
