//! The `.hfdpack` file format: manifest and item types, the entry allowlist,
//! the size limits and the version predicate (design section 4).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FORMAT: &str = "her-flight-deck-study-pack";
pub const PACK_FORMAT: i64 = 1;
/// The reader understands pack formats `1..=SUPPORTED_MAX`.
pub const SUPPORTED_MAX: i64 = 1;
pub const MANIFEST_ENTRY: &str = "manifest.json";

pub const MAX_PACK_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_TOTAL_UNCOMPRESSED: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 2_001;
pub const MAX_ITEMS: usize = 500;
pub const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
pub const MAX_ITEM_JSON_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_PDF_BYTES: u64 = crate::pdf::MAX_PDF_BYTES;
pub const MAX_PNG_BYTES: u64 = crate::visual_cards::MAX_BYTES as u64;
/// Backup allows 1000:1; a pack holds no database, so it allows far less.
pub const MAX_COMPRESSION_RATIO: u64 = 200;
pub const MAX_ENTRY_NUMBER: u32 = 2_000;
pub const MAX_VIDEOS_PER_ITEM: usize = 200;

pub const NOT_A_PACK: &str = "This file isn't a study pack.";
pub const DAMAGED: &str = "This study pack is damaged.";
pub const NEWER_APP: &str =
    "This study pack needs a newer version of Your Flight Deck. Update the app, then try again.";

/// What an archive entry name may be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Manifest,
    Item(u32),
    Pdf(u32),
    Png(u32),
}

fn entry_number(digits: &str) -> Option<u32> {
    if digits.is_empty()
        || digits.len() > 4
        || digits.starts_with('0')
        || !digits.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let n: u32 = digits.parse().ok()?;
    (1..=MAX_ENTRY_NUMBER).contains(&n).then_some(n)
}

/// `manifest.json | items/<n>.json | files/<n>.pdf | files/<n>.png`,
/// n = 1..=2000 without leading zeros. Nothing else is an entry.
pub fn classify_entry(name: &str) -> Option<EntryKind> {
    if name == MANIFEST_ENTRY {
        return Some(EntryKind::Manifest);
    }
    if let Some(rest) = name.strip_prefix("items/") {
        return entry_number(rest.strip_suffix(".json")?).map(EntryKind::Item);
    }
    let rest = name.strip_prefix("files/")?;
    if let Some(n) = rest.strip_suffix(".pdf") {
        return entry_number(n).map(EntryKind::Pdf);
    }
    entry_number(rest.strip_suffix(".png")?).map(EntryKind::Png)
}

/// Step 1 of the version predicate: only `{format, packFormat,
/// minReaderFormat}` are decoded; every other key is ignored.
pub fn check_envelope(manifest: &Value) -> Result<(), String> {
    let not_a_pack = || NOT_A_PACK.to_string();
    let Value::Object(map) = manifest else {
        return Err(not_a_pack());
    };
    if map.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(not_a_pack());
    }
    let integer = |key: &str| -> Option<i128> {
        let n = map.get(key)?.as_number()?;
        n.as_i64()
            .map(i128::from)
            .or_else(|| n.as_u64().map(i128::from))
    };
    let (Some(pack), Some(min)) = (integer("packFormat"), integer("minReaderFormat")) else {
        return Err(not_a_pack());
    };
    if pack < 1 || min < 1 {
        return Err(not_a_pack());
    }
    if min > pack {
        return Err(DAMAGED.to_string());
    }
    if pack > i128::from(SUPPORTED_MAX) {
        return Err(NEWER_APP.to_string());
    }
    Ok(())
}

/// A key named `replaces` anywhere in the document is refused.
pub fn contains_replaces(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.contains_key("replaces") || map.values().any(contains_replaces),
        Value::Array(items) => items.iter().any(contains_replaces),
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Producer {
    pub app_version: String,
    pub schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Counts {
    pub guides: u64,
    pub cards: u64,
    pub questions: u64,
    pub videos: u64,
    pub documents: u64,
    pub pictures: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestFile {
    pub entry: String,
    pub sha256: String,
    pub bytes: u64,
    pub total_pages: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub original_file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestItem {
    #[serde(rename = "ref")]
    pub item_ref: String,
    pub item_id: String,
    pub kind: String,
    pub revision: String,
    pub entry: String,
    pub entry_sha256: String,
    pub entry_bytes: u64,
    pub file: Option<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub pack_format: i64,
    pub min_reader_format: i64,
    pub pack_id: String,
    pub namespace: String,
    pub created_at: String,
    pub producer: Producer,
    pub items: Vec<ManifestItem>,
    pub counts: Counts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SectionJson {
    pub item_id: String,
    pub heading: String,
    pub body: String,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardJson {
    pub item_id: String,
    pub front: String,
    pub back: String,
    pub source_page: Option<i64>,
    pub origin: Option<String>,
    pub visual_region_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuideJson {
    pub title: String,
    pub summary: String,
    pub summary_origin: Option<String>,
    pub sections: Vec<SectionJson>,
    pub flashcards: Vec<CardJson>,
    pub source_notes: String,
    pub provider: String,
    pub model: String,
}

/// A picture region in pack form. `id` is the sha256 of the region content
/// (no owner), so it is the same for the same picture and rectangle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionJson {
    pub id: String,
    pub image_ref: String,
    pub image_sha256: String,
    pub image_width: i64,
    pub image_height: i64,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    pub rotation: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationRun {
    pub content_sha256: String,
    pub selected_pages: Vec<u32>,
    pub extractor_version: u32,
    pub algorithm_version: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationItem {
    pub item_kind: String,
    pub logical_id: String,
    pub content_hash: String,
    pub page: u32,
    pub start_offset: usize,
    pub end_offset: usize,
    pub quote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationsJson {
    /// Pack-local run name; the summary citation is `summary:<runId>`.
    pub run_id: String,
    pub run: CitationRun,
    pub items: Vec<CitationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionJson {
    pub identity: String,
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: i64,
    pub explanation: String,
    pub source_page: Option<i64>,
    pub origin: Option<String>,
    pub acs_tasks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PracticeJson {
    pub title: String,
    pub provider: String,
    pub model: String,
    pub questions: Vec<QuestionJson>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoJson {
    pub url: String,
    pub title: String,
}

/// Split lineage in pack form. A parent or root inside the pack is named by
/// `parentRef` / `rootRef`; one outside it by the producer's material id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineageJson {
    pub parent_ref: Option<String>,
    pub parent_item_id: Option<String>,
    pub root_ref: Option<String>,
    pub root_item_id: Option<String>,
    pub source_page_start: i64,
    pub source_page_end: i64,
    pub parent_page_start: Option<i64>,
    pub parent_page_end: Option<i64>,
    pub child_page_count: i64,
    pub source_file_name: String,
    pub source_title: String,
    pub source_content_sha256: Option<String>,
    pub source_total_pages: Option<i64>,
    pub parent_file_name: Option<String>,
    pub parent_title: Option<String>,
    pub parent_content_sha256: Option<String>,
    pub parent_total_pages: Option<i64>,
    pub nested_level: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemJson {
    #[serde(rename = "ref")]
    pub item_ref: String,
    pub title: String,
    pub material_type: String,
    pub topic: String,
    pub guide: Option<GuideJson>,
    pub citations: Option<CitationsJson>,
    pub visual_regions: Option<Vec<RegionJson>>,
    pub practice: Option<PracticeJson>,
    pub videos: Vec<VideoJson>,
    pub lineage: Option<LineageJson>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env(format: Value, pack: Value, min: Value) -> Value {
        json!({"format": format, "packFormat": pack, "minReaderFormat": min, "extra": [1]})
    }

    #[test]
    fn the_version_predicate_table() {
        let ok = |p: Value, m: Value| check_envelope(&env(json!(FORMAT), p, m));
        assert!(ok(json!(1), json!(1)).is_ok());
        assert_eq!(ok(json!(2), json!(1)).unwrap_err(), NEWER_APP);
        assert_eq!(ok(json!(2), json!(2)).unwrap_err(), NEWER_APP);
        assert_eq!(ok(json!(1), json!(2)).unwrap_err(), DAMAGED);
        for (p, m) in [
            (json!(0), json!(0)),
            (json!(0), json!(1)),
            (json!(1), json!(0)),
            (json!(-1), json!(-1)),
            (json!(1), json!(-3)),
            (json!("1"), json!(1)),
            (json!(1), json!("1")),
            (json!(1.5), json!(1)),
            (json!(1.0), json!(1.0)),
            (Value::Null, json!(1)),
        ] {
            assert_eq!(ok(p, m).unwrap_err(), NOT_A_PACK);
        }
        let mut missing = env(json!(FORMAT), json!(1), json!(1));
        missing.as_object_mut().unwrap().remove("minReaderFormat");
        assert_eq!(check_envelope(&missing).unwrap_err(), NOT_A_PACK);
        let wrong = env(json!("other"), json!(1), json!(1));
        assert_eq!(check_envelope(&wrong).unwrap_err(), NOT_A_PACK);
        assert_eq!(check_envelope(&json!([1])).unwrap_err(), NOT_A_PACK);
    }

    #[test]
    fn the_entry_allowlist() {
        assert_eq!(classify_entry("manifest.json"), Some(EntryKind::Manifest));
        assert_eq!(classify_entry("items/1.json"), Some(EntryKind::Item(1)));
        assert_eq!(classify_entry("files/2000.pdf"), Some(EntryKind::Pdf(2000)));
        assert_eq!(classify_entry("files/7.png"), Some(EntryKind::Png(7)));
        for bad in [
            "items/0.json",
            "items/01.json",
            "items/2001.json",
            "items/1.JSON",
            "items/a.json",
            "files/1.jpg",
            "files/1.pdf/",
            "items/",
            "notes.txt",
            "x/manifest.json",
            "",
        ] {
            assert_eq!(classify_entry(bad), None, "{bad}");
        }
    }

    #[test]
    fn replaces_is_found_at_any_depth() {
        assert!(contains_replaces(&json!({"a": [{"b": {"replaces": "x"}}]})));
        assert!(!contains_replaces(&json!({"a": "replaces"})));
    }
}
