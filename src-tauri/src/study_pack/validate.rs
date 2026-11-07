//! Every check a `.hfdpack` must pass before anything in it is trusted
//! (design section 4). The reader refuses the whole pack on the first failure
//! and never writes anything.
//!
//! The pack keeps its own ids (`s1`, `c3`, `q7`, `r1`). Existing validators
//! want UUIDs, so a validation-only adapter maps pack-local ids to throwaway
//! UUIDs and turns the stripped `retired` ledger into `[]` before calling
//! them. The adapter output is never written anywhere.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use super::format::*;
use super::revision;
use crate::study_sets::{is_item_id, is_lower_uuid_v4};

pub fn damaged(detail: &str) -> String {
    format!("This study pack is damaged ({detail}).")
}

/// One item of a validated pack.
#[derive(Debug, Clone)]
pub struct PackItem {
    pub manifest: ManifestItem,
    pub json: ItemJson,
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // read by the import stages
pub struct ValidatedPack {
    pub manifest: Manifest,
    pub items: Vec<PackItem>,
    pub pack_bytes: u64,
    pub uncompressed_bytes: u64,
}

fn is_hex64(value: &str) -> bool {
    crate::card_reviews::is_lower_hex_64(value)
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/* ------------------------------------------------------------------ */
/* Archive                                                             */
/* ------------------------------------------------------------------ */

fn read_entry(
    archive: &mut ZipArchive<File>,
    index: usize,
    limit: u64,
) -> Result<(Vec<u8>, String), String> {
    let entry = archive
        .by_index(index)
        .map_err(|_| damaged("a file inside it can't be read"))?;
    let declared = entry.size();
    if declared > limit {
        return Err(damaged("a file inside it is too large"));
    }
    let mut reader = entry.take(limit + 1);
    let mut bytes = Vec::with_capacity(declared.min(limit) as usize);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|_| damaged("a file inside it can't be read"))?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        hasher.update(&buffer[..read]);
        if bytes.len() as u64 > limit {
            return Err(damaged("a file inside it is too large"));
        }
    }
    if bytes.len() as u64 != declared {
        return Err(damaged("a file inside it has the wrong size"));
    }
    Ok((bytes, hex::encode(hasher.finalize())))
}

fn entry_limit(kind: EntryKind) -> u64 {
    match kind {
        EntryKind::Manifest => MAX_MANIFEST_BYTES,
        EntryKind::Item(_) => MAX_ITEM_JSON_BYTES,
        EntryKind::Pdf(_) => MAX_PDF_BYTES,
        EntryKind::Png(_) => MAX_PNG_BYTES,
    }
}

/// Exact pack limit: small entries pass; larger ones need
/// `uncompressed <= 200 * compressed`. (Backup keeps its own truncating check.)
pub(super) fn ratio_ok(uncompressed: u64, compressed: u64) -> bool {
    const FLOOR: u64 = 1024 * 1024;
    if uncompressed <= FLOOR {
        return true;
    }
    MAX_COMPRESSION_RATIO
        .checked_mul(compressed)
        .map_or(true, |limit| uncompressed <= limit)
}

/// Open the archive and check every entry's name, mode and size claims
/// without reading any content. Returns the entry index by name.
fn scan_archive(archive: &mut ZipArchive<File>) -> Result<(HashMap<String, usize>, u64), String> {
    if archive.len() > MAX_ENTRIES {
        return Err(damaged("it has too many files"));
    }
    let mut names = HashMap::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| damaged("its file list can't be read"))?;
        let raw_name = entry
            .name()
            .map_err(|_| damaged("a file name can't be read"))?
            .into_owned();
        let path = entry
            .enclosed_name()
            .ok_or_else(|| damaged("it contains an unsafe file path"))?;
        crate::backup::validate_archive_path(&raw_name, &path)
            .map_err(|_| damaged("it contains an unsafe or excessively long file path"))?;
        if !ratio_ok(entry.size(), entry.compressed_size()) {
            return Err(damaged("it contains an unsafe compression ratio"));
        }
        if entry.is_dir() {
            return Err(damaged("it contains a folder"));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(damaged("it contains a linked file"));
        }
        let kind = classify_entry(&raw_name)
            .ok_or_else(|| damaged(&format!("it contains an unexpected file: {raw_name}")))?;
        if entry.size() > entry_limit(kind) {
            return Err(damaged("a file inside it is too large"));
        }
        total = total
            .checked_add(entry.size())
            .filter(|t| *t <= MAX_TOTAL_UNCOMPRESSED)
            .ok_or_else(|| damaged("it is too large"))?;
        if names.insert(raw_name.clone(), index).is_some() {
            return Err(damaged(&format!(
                "it contains a duplicate file: {raw_name}"
            )));
        }
    }
    Ok((names, total))
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

pub fn validate_pack(path: &Path) -> Result<ValidatedPack, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "That study pack can't be opened.".to_string())?;
    if !metadata.is_file() {
        return Err(NOT_A_PACK.to_string());
    }
    if metadata.len() > MAX_PACK_BYTES {
        return Err(damaged("it is too large"));
    }
    let file = File::open(path).map_err(|_| "That study pack can't be opened.".to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| NOT_A_PACK.to_string())?;
    let (names, uncompressed_bytes) = scan_archive(&mut archive)?;

    let manifest_index = *names
        .get(MANIFEST_ENTRY)
        .ok_or_else(|| NOT_A_PACK.to_string())?;
    let (manifest_bytes, _) = read_entry(&mut archive, manifest_index, MAX_MANIFEST_BYTES)?;
    let manifest_value: Value =
        serde_json::from_slice(&manifest_bytes).map_err(|_| NOT_A_PACK.to_string())?;
    check_envelope(&manifest_value)?;
    let manifest: Manifest = serde_json::from_value(manifest_value)
        .map_err(|_| damaged("its contents list has an unknown or missing field"))?;
    check_manifest(&manifest)?;

    // Exactly the listed entries and nothing else.
    let mut expected: HashSet<&str> = HashSet::new();
    expected.insert(MANIFEST_ENTRY);
    for item in &manifest.items {
        expected.insert(item.entry.as_str());
        if let Some(file) = &item.file {
            expected.insert(file.entry.as_str());
        }
    }
    for name in &expected {
        if !names.contains_key(*name) {
            return Err(damaged(&format!("a file is missing: {name}")));
        }
    }
    if let Some(extra) = names.keys().find(|n| !expected.contains(n.as_str())) {
        return Err(damaged(&format!("it contains an unexpected file: {extra}")));
    }

    let mut items = Vec::with_capacity(manifest.items.len());
    for entry in &manifest.items {
        let (bytes, sha) = read_entry(&mut archive, names[&entry.entry], MAX_ITEM_JSON_BYTES)?;
        if sha != entry.entry_sha256 || bytes.len() as u64 != entry.entry_bytes {
            return Err(damaged("an item doesn't match its checksum"));
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| damaged("an item can't be read"))?;
        if contains_replaces(&value) {
            return Err(damaged("an item contains a replaces marker"));
        }
        let item: ItemJson = serde_json::from_value(value)
            .map_err(|_| damaged("an item has an unknown or missing field"))?;
        if item.item_ref != entry.item_ref {
            return Err(damaged("an item doesn't match its contents list"));
        }
        if let Some(file) = &entry.file {
            let limit = if entry.kind == "document" {
                MAX_PDF_BYTES
            } else {
                MAX_PNG_BYTES
            };
            let (file_bytes, file_sha) = read_entry(&mut archive, names[&file.entry], limit)?;
            if file_sha != file.sha256 || file_bytes.len() as u64 != file.bytes {
                return Err(damaged("a file doesn't match its checksum"));
            }
            check_file(entry, file, &file_bytes)?;
        }
        check_item(&manifest, entry, &item)?;
        let recomputed = revision::revision_of(&entry.kind, &item, entry.file.as_ref());
        if recomputed != entry.revision {
            return Err(damaged("an item doesn't match its revision"));
        }
        items.push(PackItem {
            manifest: entry.clone(),
            json: item,
        });
    }
    check_counts(&manifest, &items)?;
    Ok(ValidatedPack {
        manifest,
        items,
        pack_bytes: metadata.len(),
        uncompressed_bytes,
    })
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

fn check_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(char::is_control)
        && crate::documents::clean_file_name(name) == name
}

fn check_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.format != FORMAT
        || !(1..=SUPPORTED_MAX).contains(&manifest.pack_format)
        || manifest.min_reader_format < 1
        || manifest.min_reader_format > manifest.pack_format
    {
        return Err(NOT_A_PACK.to_string());
    }
    if !is_lower_uuid_v4(&manifest.pack_id)
        || !is_lower_uuid_v4(&manifest.namespace)
        || crate::card_reviews::parse_iso_ms(&manifest.created_at).is_none()
        || manifest.producer.app_version.is_empty()
        || manifest.producer.app_version.len() > 64
    {
        return Err(damaged("its header is invalid"));
    }
    if manifest.items.is_empty() || manifest.items.len() > MAX_ITEMS {
        return Err(damaged("it has no items or too many"));
    }
    let mut refs = HashSet::new();
    let mut item_ids = HashSet::new();
    let mut entries = HashSet::new();
    for item in &manifest.items {
        if !is_item_id(&item.item_ref) || !refs.insert(item.item_ref.as_str()) {
            return Err(damaged("an item reference is invalid or repeated"));
        }
        if item.item_id.is_empty()
            || item.item_id.chars().count() > 200
            || !item_ids.insert(item.item_id.as_str())
        {
            return Err(damaged("an item id is invalid or repeated"));
        }
        if !["document", "picture", "guide"].contains(&item.kind.as_str())
            || !is_hex64(&item.revision)
            || !is_hex64(&item.entry_sha256)
            || item.entry_bytes > MAX_ITEM_JSON_BYTES
        {
            return Err(damaged("an item entry is invalid"));
        }
        match classify_entry(&item.entry) {
            Some(EntryKind::Item(_)) if entries.insert(item.entry.as_str()) => {}
            _ => return Err(damaged("an item entry name is invalid or repeated")),
        }
        match (item.kind.as_str(), &item.file) {
            ("guide", None) => {}
            ("document" | "picture", Some(file)) => {
                let kind = classify_entry(&file.entry);
                let right_kind = matches!(
                    (item.kind.as_str(), kind),
                    ("document", Some(EntryKind::Pdf(_))) | ("picture", Some(EntryKind::Png(_)))
                );
                if !right_kind
                    || !entries.insert(file.entry.as_str())
                    || !is_hex64(&file.sha256)
                    || file.bytes == 0
                    || !check_file_name(&file.original_file_name)
                {
                    return Err(damaged("a file entry is invalid"));
                }
                let (limit, shape_ok) = if item.kind == "document" {
                    (
                        MAX_PDF_BYTES,
                        file.total_pages.is_some_and(|p| (1..=100_000).contains(&p))
                            && file.width.is_none()
                            && file.height.is_none(),
                    )
                } else {
                    (
                        MAX_PNG_BYTES,
                        file.total_pages.is_none() && file.width.is_some() && file.height.is_some(),
                    )
                };
                if file.bytes > limit || !shape_ok {
                    return Err(damaged("a file entry is invalid"));
                }
            }
            _ => return Err(damaged("an item's file doesn't match its kind")),
        }
    }
    Ok(())
}

fn check_counts(manifest: &Manifest, items: &[PackItem]) -> Result<(), String> {
    let mut counts = Counts {
        guides: 0,
        cards: 0,
        questions: 0,
        videos: 0,
        documents: 0,
        pictures: 0,
    };
    for item in items {
        if let Some(g) = &item.json.guide {
            counts.guides += 1;
            counts.cards += g.flashcards.len() as u64;
        }
        if let Some(p) = &item.json.practice {
            counts.questions += p.questions.len() as u64;
        }
        counts.videos += item.json.videos.len() as u64;
        match item.manifest.kind.as_str() {
            "document" => counts.documents += 1,
            "picture" => counts.pictures += 1,
            _ => {}
        }
    }
    if counts != manifest.counts {
        return Err(damaged("the counts don't match"));
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

fn check_file(entry: &ManifestItem, file: &ManifestFile, bytes: &[u8]) -> Result<(), String> {
    if entry.kind == "document" {
        let (sha, pages) = crate::navigation::identity_of_bytes(bytes)
            .map_err(|_| damaged("a PDF can't be read"))?;
        if sha != file.sha256 || Some(pages) != file.total_pages {
            return Err(damaged("a PDF doesn't match its page count"));
        }
    } else {
        let (width, height) = crate::visual_cards::inspect_png(bytes)
            .map_err(|_| damaged("a picture can't be read or is too large"))?;
        if Some(width) != file.width || Some(height) != file.height {
            return Err(damaged("a picture doesn't match its size"));
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Item content                                                        */
/* ------------------------------------------------------------------ */

/// The Rust twin of `validateVideoUrl` in materialVideoLinkRepository.ts:
/// trimmed, must parse as a WHATWG URL with an `https:` (or `http:`, which is
/// upgraded) scheme, at most 2000 UTF-16 units. Returns the stored spelling,
/// or None when the link is refused. Shared parity cases live in
/// src/testing/videoUrlParity.json and run in both languages.
pub fn canonical_video_url(input: &str) -> Option<String> {
    let url = crate::card_reviews::js_trim(input);
    let scheme = whatwg_special_scheme(url)?;
    let out = match scheme {
        "https" => url.to_string(),
        _ => {
            let rest = &url[url.find(':')? + 1..];
            format!("https:{rest}")
        }
    };
    (utf16_len(&out) <= 2000).then_some(out)
}

/// A hand port of the WHATWG URL parser, enough to decide whether
/// `new URL(text)` succeeds for an http(s) address. Returns the lowercase
/// scheme. Internationalised host names are accepted without the full IDNA
/// mapping table.
fn whatwg_special_scheme(text: &str) -> Option<&'static str> {
    let cleaned: String = text
        .trim_matches(|c: char| (c as u32) <= 0x20)
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let (scheme, rest) = cleaned.split_once(':')?;
    let mut chars = scheme.chars();
    if !chars.next()?.is_ascii_alphabetic()
        || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }
    let scheme: &'static str = match scheme.to_ascii_lowercase().as_str() {
        "https" => "https",
        "http" => "http",
        _ => return None,
    };
    let rest = rest.trim_start_matches(['/', '\\']);
    let end = rest.find(['/', '\\', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let (host, port) = if let Some(after) = host_port.strip_prefix('[') {
        let close = after.find(']')?;
        let tail = &after[close + 1..];
        let port = match tail {
            "" => "",
            _ => tail.strip_prefix(':')?,
        };
        (&host_port[..close + 2], port)
    } else {
        match host_port.split_once(':') {
            Some((h, p)) => (h, p),
            None => (host_port, ""),
        }
    };
    if !port.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if port.trim_start_matches('0').len() > 5
        || port.trim_start_matches('0').parse::<u32>().is_ok_and(|n| n > 65535)
    {
        return None;
    }
    host_ok(host).then_some(scheme)
}

fn host_ok(host: &str) -> bool {
    if let Some(inner) = host.strip_prefix('[') {
        return inner
            .strip_suffix(']')
            .is_some_and(|v| v.parse::<std::net::Ipv6Addr>().is_ok());
    }
    let mut decoded: Vec<u8> = Vec::with_capacity(host.len());
    let bytes = host.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                decoded.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    let domain = String::from_utf8_lossy(&decoded).to_lowercase();
    if domain.is_empty()
        || domain.chars().any(|c| {
            (c as u32) <= 0x20
                || c as u32 == 0x7f
                || matches!(
                    c,
                    '#' | '/' | ':' | '<' | '>' | '?' | '@' | '[' | '\\' | ']' | '^' | '|' | '%'
                )
        })
    {
        return false;
    }
    let mut labels: Vec<&str> = domain.split('.').collect();
    if labels.len() > 1 && labels.last() == Some(&"") {
        labels.pop();
    }
    let last = labels.last().copied().unwrap_or("");
    let numeric = !last.is_empty()
        && (last.chars().all(|c| c.is_ascii_digit())
            || last
                .strip_prefix("0x")
                .is_some_and(|h| h.chars().all(|c| c.is_ascii_hexdigit())));
    !numeric || ipv4_ok(&labels)
}

fn ipv4_ok(labels: &[&str]) -> bool {
    if labels.len() > 4 || labels.iter().any(|l| l.is_empty()) {
        return false;
    }
    let mut numbers: Vec<u64> = Vec::new();
    for label in labels {
        let (digits, radix) = if let Some(h) = label.strip_prefix("0x") {
            (h, 16)
        } else if label.len() > 1 && label.starts_with('0') {
            (&label[1..], 8)
        } else {
            (*label, 10)
        };
        if digits.is_empty() {
            numbers.push(0);
        } else {
            match u64::from_str_radix(digits, radix) {
                Ok(n) => numbers.push(n),
                Err(_) => return false,
            }
        }
    }
    let (last, init) = numbers.split_last().expect("non-empty");
    init.iter().all(|n| *n <= 255) && *last < 256u64.pow((5 - numbers.len()) as u32)
}

fn text_within(text: &str, min: usize, max: usize) -> bool {
    let n = crate::card_reviews::js_trim(text).chars().count();
    n >= min && n <= max
}

fn origin_ok(origin: &Option<String>) -> bool {
    origin
        .as_deref()
        .map_or(true, |o| o == "user" || o == "instructor")
}

pub(super) fn guide_value(g: &GuideJson) -> Value {
    let sections: Vec<Value> = g
        .sections
        .iter()
        .map(|s| {
            let mut m = Map::new();
            m.insert("heading".into(), json!(s.heading));
            m.insert("body".into(), json!(s.body));
            m.insert("itemId".into(), json!(s.item_id));
            if let Some(o) = &s.origin {
                m.insert("origin".into(), json!(o));
            }
            Value::Object(m)
        })
        .collect();
    let cards: Vec<Value> = g
        .flashcards
        .iter()
        .map(|c| {
            let mut m = Map::new();
            m.insert("front".into(), json!(c.front));
            m.insert("back".into(), json!(c.back));
            m.insert("sourcePage".into(), json!(c.source_page));
            m.insert("itemId".into(), json!(c.item_id));
            if let Some(o) = &c.origin {
                m.insert("origin".into(), json!(o));
            }
            if let Some(r) = &c.visual_region_id {
                m.insert("visualRegionId".into(), json!(r));
            }
            Value::Object(m)
        })
        .collect();
    json!({
        "title": g.title,
        "summary": g.summary,
        "summaryOrigin": g.summary_origin,
        "sections": sections,
        "flashcards": cards,
        "sourceNotes": g.source_notes,
        "provider": g.provider,
        "model": g.model,
        // The pack never carries the producer's edit history.
        "retired": [],
    })
}

/// A throwaway, valid UUID v4 for the validation adapter.
fn adapter_uuid(index: usize) -> String {
    format!("00000000-0000-4000-8000-{index:012x}")
}

pub(super) fn question_value(q: &QuestionJson, identity: &str) -> Value {
    let mut m = Map::new();
    m.insert("question".into(), json!(q.question));
    m.insert("options".into(), json!(q.options));
    m.insert("correctIndex".into(), json!(q.correct_index));
    m.insert("explanation".into(), json!(q.explanation));
    m.insert("sourcePage".into(), json!(q.source_page));
    m.insert("identity".into(), json!(identity));
    if let Some(o) = &q.origin {
        m.insert("origin".into(), json!(o));
    }
    if let Some(task) = q.acs_tasks.first() {
        m.insert("acsTask".into(), json!(task));
    }
    Value::Object(m)
}

/// The pack's own guide, practice and ids as one object, shaped for
/// `pdf_kit_sources::validate_content`.
pub(super) fn citation_target(guide: Option<&GuideJson>, practice: Option<&PracticeJson>) -> Value {
    let mut next = Map::new();
    next.insert(
        "summary".into(),
        guide.map_or(Value::Null, |g| json!(g.summary)),
    );
    if let Some(g) = guide {
        let v = guide_value(g);
        next.insert("sections".into(), v["sections"].clone());
        next.insert("flashcards".into(), v["flashcards"].clone());
    }
    if let Some(p) = practice {
        let qs: Vec<Value> = p
            .questions
            .iter()
            .map(|q| question_value(q, &q.identity))
            .collect();
        next.insert("questions".into(), Value::Array(qs));
    }
    Value::Object(next)
}

/// Citations: `pdf_kit_sources::decode` plus `validate_content`, on the
/// adapter form (throwaway run and material UUIDs).
pub fn check_citations(
    citations: &CitationsJson,
    guide: Option<&GuideJson>,
    practice: Option<&PracticeJson>,
    file: Option<&ManifestFile>,
) -> Result<(), String> {
    let bad = || damaged("its citations are invalid");
    let file = file.ok_or_else(bad)?;
    if citations.run.content_sha256 != file.sha256
        || !is_item_id(&citations.run_id)
        || citations
            .run
            .selected_pages
            .iter()
            .any(|p| i64::from(*p) > file.total_pages.unwrap_or(0))
        || citations
            .items
            .iter()
            .any(|i| i64::from(i.page) > file.total_pages.unwrap_or(0))
    {
        return Err(bad());
    }
    let run_uuid = adapter_uuid(1);
    let material_uuid = adapter_uuid(2);
    let summary_name = format!("summary:{}", citations.run_id);
    let items: Vec<Value> = citations
        .items
        .iter()
        .map(|i| {
            let logical = if i.item_kind == "summary" && i.logical_id == summary_name {
                format!("summary:{run_uuid}")
            } else {
                i.logical_id.clone()
            };
            json!({
                "itemKind": i.item_kind, "logicalId": logical, "contentHash": i.content_hash,
                "page": i.page, "startOffset": i.start_offset, "endOffset": i.end_offset,
                "quote": i.quote,
            })
        })
        .collect();
    let adapter = json!({
        "runId": run_uuid,
        "run": {
            "materialId": material_uuid, "contentSha256": citations.run.content_sha256,
            "selectedPages": citations.run.selected_pages,
            "extractorVersion": citations.run.extractor_version,
            "algorithmVersion": citations.run.algorithm_version,
            "createdAt": citations.run.created_at,
        },
        "items": items,
    });
    let sources = crate::pdf_kit_sources::decode(&adapter, &material_uuid).map_err(|_| bad())?;
    crate::pdf_kit_sources::validate_content(&sources, &citation_target(guide, practice))
        .map_err(|_| bad())
}

fn check_region(region: &RegionJson, manifest: &Manifest, own_ref: &str) -> Result<(), String> {
    let bad = || damaged("a picture card is invalid");
    let picture = manifest
        .items
        .iter()
        .find(|i| i.item_ref == region.image_ref && i.kind == "picture" && i.item_ref != own_ref)
        .and_then(|i| i.file.as_ref())
        .ok_or_else(bad)?;
    if picture.sha256 != region.image_sha256
        || picture.width != Some(region.image_width)
        || picture.height != Some(region.image_height)
        || !(1..=4096).contains(&region.image_width)
        || !(1..=4096).contains(&region.image_height)
        || region.image_width * region.image_height > 4_000_000
        || region.x < 0
        || region.y < 0
        || region.w < 1
        || region.h < 1
        || region
            .x
            .checked_add(region.w)
            .map_or(true, |n| n > region.image_width)
        || region
            .y
            .checked_add(region.h)
            .map_or(true, |n| n > region.image_height)
        || ![0, 90, 180, 270].contains(&region.rotation)
    {
        return Err(bad());
    }
    let id = revision::region_id(
        &region.image_sha256,
        region.image_width,
        region.image_height,
        (region.x, region.y, region.w, region.h),
        region.rotation,
    );
    if id != region.id {
        return Err(bad());
    }
    Ok(())
}

fn check_lineage(manifest: &Manifest, entry: &ManifestItem, l: &LineageJson) -> Result<(), String> {
    let bad = || damaged("split information is invalid");
    let total = entry
        .file
        .as_ref()
        .filter(|_| entry.kind == "document")
        .and_then(|f| f.total_pages)
        .ok_or_else(bad)?;
    for (link, id) in [
        (&l.parent_ref, &l.parent_item_id),
        (&l.root_ref, &l.root_item_id),
    ] {
        if link.is_some() && id.is_some() {
            return Err(bad());
        }
        if let Some(r) = link {
            if *r == entry.item_ref || !manifest.items.iter().any(|i| &i.item_ref == r) {
                return Err(bad());
            }
        }
        if let Some(id) = id {
            if id.is_empty() || id.chars().count() > 200 {
                return Err(bad());
            }
        }
    }
    let hex_ok = |v: &Option<String>| v.as_deref().map_or(true, is_hex64);
    let short = |v: &str| v.chars().count() <= 2000;
    let opt_short = |v: &Option<String>| v.as_deref().map_or(true, short);
    let parent_pages_present = l.parent_page_start.is_some() && l.parent_page_end.is_some();
    let ok = l.source_page_start >= 1
        && l.source_page_end >= l.source_page_start
        && l.child_page_count == l.source_page_end - l.source_page_start + 1
        && l.child_page_count == total
        && (l.parent_page_start.is_some() == l.parent_page_end.is_some())
        && l.parent_page_start.map_or(true, |s| s >= 1)
        && l.parent_page_end
            .map_or(true, |e| e >= l.parent_page_start.unwrap_or(1))
        && l.parent_page_start.map_or(true, |s| {
            l.parent_page_end
                .map_or(false, |e| l.child_page_count == e - s + 1)
        })
        && l.source_total_pages
            .map_or(true, |t| t >= l.source_page_end)
        && l.parent_total_pages
            .map_or(true, |t| l.parent_page_end.map_or(true, |e| t >= e))
        && l.nested_level >= 1
        && if l.nested_level == 1 {
            !parent_pages_present && l.parent_total_pages.is_none()
        } else {
            parent_pages_present && l.parent_total_pages.is_some()
        }
        && hex_ok(&l.source_content_sha256)
        && hex_ok(&l.parent_content_sha256)
        && short(&l.source_file_name)
        && short(&l.source_title)
        && opt_short(&l.parent_file_name)
        && opt_short(&l.parent_title);
    if ok {
        Ok(())
    } else {
        Err(bad())
    }
}

fn check_item(manifest: &Manifest, entry: &ManifestItem, item: &ItemJson) -> Result<(), String> {
    let total_pages = entry.file.as_ref().and_then(|f| f.total_pages);
    let page_ok = |page: Option<i64>| match page {
        None => true,
        Some(p) => total_pages.is_some_and(|t| p >= 1 && p <= t),
    };
    if !text_within(&item.title, 1, crate::study_sets::MAX_TITLE)
        || item.material_type.is_empty()
        || item.material_type.len() > 64
        || !item
            .material_type
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
        || item.topic.chars().count() > 200
        || item.topic.chars().any(char::is_control)
    {
        return Err(damaged("an item's title or type is invalid"));
    }
    if entry.kind == "picture"
        && (item.guide.is_some()
            || item.citations.is_some()
            || item.visual_regions.is_some()
            || item.practice.is_some()
            || !item.videos.is_empty()
            || item.lineage.is_some())
    {
        return Err(damaged("a picture carries study content"));
    }
    if item.citations.is_some() && entry.kind != "document" {
        return Err(damaged("its citations are invalid"));
    }

    // Guide.
    let regions: &[RegionJson] = item.visual_regions.as_deref().unwrap_or(&[]);
    if let Some(guide) = &item.guide {
        if !origin_ok(&guide.summary_origin)
            || guide.sections.iter().any(|s| !origin_ok(&s.origin))
            || guide.flashcards.iter().any(|c| !origin_ok(&c.origin))
        {
            return Err(damaged("a guide is invalid"));
        }
        crate::study_sets::validate_next(&guide_value(guide))
            .map_err(|_| damaged("a guide is invalid"))?;
        if guide.flashcards.iter().any(|c| !page_ok(c.source_page)) {
            return Err(damaged("a card names a page that doesn't exist"));
        }
        let mut region_ids = HashSet::new();
        for region in regions {
            check_region(region, manifest, &entry.item_ref)?;
            if !region_ids.insert(region.id.as_str()) {
                return Err(damaged("a picture card is repeated"));
            }
        }
        let used: HashSet<&str> = guide
            .flashcards
            .iter()
            .filter_map(|c| c.visual_region_id.as_deref())
            .collect();
        if used != region_ids {
            return Err(damaged("a picture card has no picture"));
        }
    } else if item.visual_regions.is_some() {
        return Err(damaged("a guide is missing"));
    }

    // Practice.
    if let Some(practice) = &item.practice {
        if !["gemini", "import", "manual"].contains(&practice.provider.as_str())
            || practice.title.chars().count() > crate::study_sets::MAX_TITLE
            || practice.model.chars().count() > crate::study_sets::MAX_MODEL
        {
            return Err(damaged("practice questions are invalid"));
        }
        let mut local_ids = HashSet::new();
        let mut adapter = Vec::new();
        for (index, q) in practice.questions.iter().enumerate() {
            if !is_item_id(&q.identity)
                || !local_ids.insert(q.identity.as_str())
                || q.acs_tasks.len() > 1
                || q.acs_tasks
                    .iter()
                    .any(|t| crate::acs_tasks::normalize(t).as_deref() != Some(t.as_str()))
                || !origin_ok(&q.origin)
                || !page_ok(q.source_page)
            {
                return Err(damaged("practice questions are invalid"));
            }
            adapter.push(question_value(q, &adapter_uuid(1000 + index)));
        }
        crate::practice_authoring::decode_questions(&Value::Array(adapter))
            .map_err(|_| damaged("practice questions are invalid"))?;
    }

    // Citations.
    if let Some(citations) = &item.citations {
        if item.guide.is_none() && item.practice.is_none() {
            return Err(damaged("its citations are invalid"));
        }
        check_citations(
            citations,
            item.guide.as_ref(),
            item.practice.as_ref(),
            entry.file.as_ref(),
        )?;
    }

    // Videos.
    if item.videos.len() > MAX_VIDEOS_PER_ITEM {
        return Err(damaged("it has too many video links"));
    }
    for video in &item.videos {
        if canonical_video_url(&video.url).as_deref() != Some(video.url.as_str())
            || video.title.trim() != video.title
            || utf16_len(&video.title) > 200
        {
            return Err(damaged("a video link is invalid"));
        }
    }

    if let Some(lineage) = &item.lineage {
        check_lineage(manifest, entry, lineage)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pack_ratio_check_is_exact() {
        assert!(ratio_ok(1024 * 1024, 0));
        assert!(!ratio_ok(2 * 1024 * 1024, 0));
        let c = 10_000;
        assert!(ratio_ok(200 * c, c));
        assert!(!ratio_ok(200 * c + 1, c));
        assert!(ratio_ok(u64::MAX, u64::MAX / 100), "the limit overflowing means no limit");
    }

    #[test]
    fn video_links_follow_the_app_rules() {
        assert_eq!(
            canonical_video_url(" https://youtu.be/x ").as_deref(),
            Some("https://youtu.be/x")
        );
        assert_eq!(
            canonical_video_url("http://example.com/a?b=1").as_deref(),
            Some("https://example.com/a?b=1")
        );
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../../../src/testing/videoUrlParity.json")).unwrap();
        assert!(cases.len() > 20);
        for case in &cases {
            let input = case["input"].as_str().unwrap();
            assert_eq!(
                canonical_video_url(input).as_deref(),
                case["expected"].as_str(),
                "{input:?}"
            );
        }
        for bad in [
            "",
            "ftp://example.com",
            "javascript:alert(1)",
            "https://",
            "example.com",
            "https://exa mple.com",
            "https://user@:80/x",
        ] {
            assert_eq!(canonical_video_url(bad), None, "{bad}");
        }
        let long = format!("https://example.com/{}", "a".repeat(2000));
        assert_eq!(canonical_video_url(&long), None);
    }
}
