//! Build a `.hfdpack` from the library (design sections 2 and 6 A).
//!
//! Export reads the database and never changes a study row. The only write is
//! the producer namespace, created once in `app_metadata`. The pack is written
//! to a temp file beside the target, synced, renamed, then opened again and
//! validated like any pack from outside.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::format::*;
use super::revision;
use super::validate;
use crate::practice_sessions::compute_canonical_hash;

const NAMESPACE_KEY: &str = "study_pack_namespace";
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub pack_id: String,
    pub namespace: String,
    pub items: usize,
    pub documents: u64,
    pub pictures: u64,
    pub guides: u64,
    pub cards: u64,
    pub questions: u64,
    pub videos: u64,
    /// Picture cards left out because their picture could not be shared.
    pub cards_left_out: u64,
    pub bytes: u64,
}

/* ------------------------------------------------------------------ */
/* Namespace                                                           */
/* ------------------------------------------------------------------ */

/// The producer namespace: created once, then only ever read. The insert is
/// insert-if-absent, so an existing value is never replaced.
pub fn ensure_namespace(conn: &Connection) -> Result<String, String> {
    let fresh = crate::practice_sessions::generate_uuid_v4(conn)
        .map_err(|_| "Could not prepare the study pack.".to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?1, ?2)",
        params![NAMESPACE_KEY, fresh],
    )
    .map_err(|_| "Could not prepare the study pack.".to_string())?;
    let stored: String = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            [NAMESPACE_KEY],
            |r| r.get(0),
        )
        .map_err(|_| "Could not prepare the study pack.".to_string())?;
    if !crate::study_sets::is_lower_uuid_v4(&stored) {
        return Err("Could not prepare the study pack.".to_string());
    }
    Ok(stored)
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

enum FileData {
    Pdf {
        bytes: Vec<u8>,
        sha: String,
        pages: i64,
    },
    Png {
        bytes: Vec<u8>,
        sha: String,
        width: i64,
        height: i64,
    },
}

impl FileData {
    fn bytes(&self) -> &[u8] {
        match self {
            Self::Pdf { bytes, .. } | Self::Png { bytes, .. } => bytes,
        }
    }
}

struct Loaded {
    id: String,
    title: String,
    material_type: String,
    topic: String,
    file_name: String,
    file: Option<FileData>,
}

fn no_longer_exists() -> String {
    "That study material no longer exists.".to_string()
}

fn read_stored_file(root: &Path, relative: &str, limit: u64) -> Result<Vec<u8>, String> {
    let unreadable = || "A file in your library can't be read.".to_string();
    let documents = root.join("documents");
    let path = crate::documents::contained_document_path(&documents, relative)
        .map_err(|_| unreadable())?;
    let meta = std::fs::symlink_metadata(&path).map_err(|_| unreadable())?;
    if !meta.is_file() || meta.len() > limit {
        return Err("A file in your library is too large to share.".to_string());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|_| unreadable())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unreadable())?;
    if bytes.len() as u64 > limit {
        return Err("A file in your library is too large to share.".to_string());
    }
    Ok(bytes)
}

fn load_material(conn: &Connection, root: &Path, id: &str) -> Result<Loaded, String> {
    type MaterialRow = (String, String, String, Option<String>, Option<String>);
    let row: Option<MaterialRow> = conn
        .query_row(
            "SELECT title, material_type, topic, file_path, original_file_name
               FROM study_materials WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(|_| "Could not read your library.".to_string())?;
    let (title, material_type, topic, file_path, original) = row.ok_or_else(no_longer_exists)?;
    let (file, default_name) = match file_path.as_deref().filter(|p| !p.is_empty()) {
        None => (None, String::new()),
        Some(relative) => {
            let bytes = read_stored_file(root, relative, MAX_PDF_BYTES)?;
            if bytes.starts_with(&PNG_SIGNATURE) {
                if bytes.len() as u64 > MAX_PNG_BYTES {
                    return Err("A picture in your library is too large to share.".to_string());
                }
                let (width, height) = crate::visual_cards::inspect_png(&bytes)
                    .map_err(|_| format!("\"{title}\" is not a picture this app can share."))?;
                let sha = hex::encode(Sha256::digest(&bytes));
                (
                    Some(FileData::Png {
                        bytes,
                        sha,
                        width,
                        height,
                    }),
                    "picture.png".to_string(),
                )
            } else {
                let (sha, pages) = crate::navigation::identity_of_bytes(&bytes).map_err(|_| {
                    format!("\"{title}\" is not a PDF or picture this app can share.")
                })?;
                (
                    Some(FileData::Pdf { bytes, sha, pages }),
                    "document.pdf".to_string(),
                )
            }
        }
    };
    let file_name = original
        .map(|n| crate::documents::clean_file_name(&n))
        .filter(|n| {
            n.len() <= 255 && !n.contains(['/', '\\', '\0']) && !n.chars().any(char::is_control)
        })
        .unwrap_or(default_name);
    Ok(Loaded {
        id: id.to_string(),
        title: if title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            title
        },
        material_type,
        topic,
        file_name,
        file,
    })
}

struct DbGuide {
    title: String,
    summary: String,
    summary_origin: Option<String>,
    sections: Vec<Value>,
    cards: Vec<Value>,
    source_notes: String,
    provider: String,
    model: String,
}

fn read_guide(conn: &Connection, id: &str) -> Result<Option<DbGuide>, String> {
    let bad = || "A study guide in your library can't be read.".to_string();
    #[allow(clippy::type_complexity)]
    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
    )> = conn
        .query_row(
            "SELECT title, summary, sections_json, flashcards_json, source_notes,
                    provider, model, summary_origin
               FROM ai_study_sets WHERE source_material_id = ?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            },
        )
        .optional()
        .map_err(|_| bad())?;
    let Some((title, summary, sections, cards, source_notes, provider, model, origin)) = row else {
        return Ok(None);
    };
    let list = |text: &str| -> Result<Vec<Value>, String> {
        match serde_json::from_str::<Value>(text) {
            Ok(Value::Array(items)) => Ok(items),
            _ => Err(bad()),
        }
    };
    Ok(Some(DbGuide {
        title,
        summary,
        summary_origin: origin.filter(|o| o == "user" || o == "instructor"),
        sections: list(&sections)?,
        cards: list(&cards)?,
        source_notes,
        provider,
        model,
    }))
}

fn origin_of(value: &Value) -> Option<String> {
    value
        .get("origin")
        .and_then(Value::as_str)
        .filter(|o| *o == "user" || *o == "instructor")
        .map(str::to_string)
}

fn str_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// A picture the pack can carry: its pack ref and its identity.
struct PictureRef {
    item_ref: String,
    sha: String,
    width: i64,
    height: i64,
}

/// Where a pack item came from, for rewriting citations.
#[derive(Default)]
struct IdMap {
    /// (kind, producer logical id) -> (pack-local id, producer content hash)
    items: HashMap<(String, String), (String, String)>,
    summary_hash: String,
}

struct BuiltGuide {
    guide: GuideJson,
    regions: Vec<RegionJson>,
    ids: IdMap,
    left_out: u64,
}

fn build_guide(
    conn: &Connection,
    db: &DbGuide,
    pictures: &HashMap<String, PictureRef>,
    own: &Loaded,
) -> Result<BuiltGuide, String> {
    let page_ok = |page: Option<i64>| -> Option<i64> {
        match (page, &own.file) {
            (Some(p), Some(FileData::Pdf { pages, .. })) if p >= 1 && p <= *pages => Some(p),
            _ => None,
        }
    };
    let mut ids = IdMap {
        summary_hash: compute_canonical_hash(&json!(db.summary)),
        ..IdMap::default()
    };
    let mut sections = Vec::new();
    for (index, s) in db.sections.iter().enumerate() {
        let local = format!("s{}", index + 1);
        if let Some(real) = s.get("itemId").and_then(Value::as_str) {
            ids.items.insert(
                ("section".into(), real.to_string()),
                (
                    local.clone(),
                    compute_canonical_hash(&crate::pdf_kit_sources::content("section", s)),
                ),
            );
        }
        sections.push(SectionJson {
            item_id: local,
            heading: str_of(s, "heading"),
            body: str_of(s, "body"),
            origin: origin_of(s),
        });
    }
    let mut cards = Vec::new();
    let mut regions: Vec<RegionJson> = Vec::new();
    let mut left_out = 0u64;
    for c in &db.cards {
        let mut region_id = None;
        if let Some(real) = c.get("visualRegionId").and_then(Value::as_str) {
            let region = crate::visual_cards::read_region(conn, real)
                .ok()
                .and_then(|r| {
                    let image = r.image_material_id.clone()?;
                    let picture = pictures.get(&image)?;
                    (picture.sha == r.image_sha256
                        && picture.width == r.image_width
                        && picture.height == r.image_height)
                        .then_some((r, picture))
                });
            let Some((r, picture)) = region else {
                left_out += 1;
                continue;
            };
            let id = revision::region_id(
                &r.image_sha256,
                r.image_width,
                r.image_height,
                (r.x, r.y, r.w, r.h),
                r.rotation,
            );
            if !regions.iter().any(|known| known.id == id) {
                regions.push(RegionJson {
                    id: id.clone(),
                    image_ref: picture.item_ref.clone(),
                    image_sha256: r.image_sha256,
                    image_width: r.image_width,
                    image_height: r.image_height,
                    x: r.x,
                    y: r.y,
                    w: r.w,
                    h: r.h,
                    rotation: r.rotation,
                });
            }
            region_id = Some(id);
        }
        let local = format!("c{}", cards.len() + 1);
        if let Some(real) = c.get("itemId").and_then(Value::as_str) {
            ids.items.insert(
                ("card".into(), real.to_string()),
                (
                    local.clone(),
                    compute_canonical_hash(&crate::pdf_kit_sources::content("card", c)),
                ),
            );
        }
        cards.push(CardJson {
            item_id: local,
            front: str_of(c, "front"),
            back: str_of(c, "back"),
            source_page: page_ok(c.get("sourcePage").and_then(Value::as_i64)),
            origin: origin_of(c),
            visual_region_id: region_id,
        });
    }
    Ok(BuiltGuide {
        guide: GuideJson {
            title: db.title.clone(),
            summary: db.summary.clone(),
            summary_origin: db.summary_origin.clone(),
            sections,
            flashcards: cards,
            source_notes: db.source_notes.clone(),
            provider: db.provider.clone(),
            model: db.model.clone(),
        },
        regions,
        ids,
        left_out,
    })
}

fn build_practice(
    conn: &Connection,
    own: &Loaded,
    ids: &mut IdMap,
) -> Result<Option<PracticeJson>, String> {
    let snapshot = crate::practice_authoring::read_current_snapshot(conn, &own.id)
        .map_err(|_| "Practice questions in your library can't be read.".to_string())?;
    let Some(snapshot) = snapshot.filter(|s| !s.questions.is_empty()) else {
        return Ok(None);
    };
    let mut questions = Vec::new();
    for (index, q) in snapshot.questions.iter().enumerate() {
        let local = format!("q{}", index + 1);
        let db_form = crate::practice_authoring::question_value(q);
        ids.items.insert(
            ("question".into(), q.identity.clone()),
            (
                local.clone(),
                compute_canonical_hash(&crate::pdf_kit_sources::content("question", &db_form)),
            ),
        );
        let source_page = match (q.source_page, &own.file) {
            (Some(p), Some(FileData::Pdf { pages, .. })) if p >= 1 && p <= *pages => Some(p),
            _ => None,
        };
        questions.push(QuestionJson {
            identity: local,
            question: q.question.clone(),
            options: q.options.clone(),
            correct_index: q.correct_index,
            explanation: q.explanation.clone(),
            source_page,
            origin: q.origin.clone(),
            acs_tasks: q.acs_task.iter().cloned().collect(),
        });
    }
    Ok(Some(PracticeJson {
        title: snapshot.title,
        provider: snapshot.provider,
        model: snapshot.model,
        questions,
    }))
}

/// The citation run that covers the most current items, rewritten to
/// pack-local ids with hashes of the pack's own content. Only a run made on
/// exactly this file counts, and only items whose stored hash still matches.
fn build_citations(
    conn: &Connection,
    own: &Loaded,
    guide: Option<&GuideJson>,
    practice: Option<&PracticeJson>,
    ids: &IdMap,
) -> Result<Option<CitationsJson>, String> {
    let Some(FileData::Pdf { sha, .. }) = &own.file else {
        return Ok(None);
    };
    let bad = || "Study sources in your library can't be read.".to_string();
    let mut runs = conn
        .prepare(
            "SELECT run_id, selected_pages_json, extractor_version, algorithm_version, created_at
               FROM pdf_kit_runs WHERE material_id = ?1 AND content_sha256 = ?2
              ORDER BY created_at DESC, run_id DESC",
        )
        .map_err(|_| bad())?;
    let runs: Vec<(String, String, u32, u32, String)> = runs
        .query_map(params![own.id, sha], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .map_err(|_| bad())?
        .collect::<Result<_, _>>()
        .map_err(|_| bad())?;
    let target = validate::citation_target(guide, practice);
    let mut best: Option<CitationsJson> = None;
    for (run_id, pages, extractor, algorithm, created_at) in runs {
        let Ok(selected_pages) = serde_json::from_str::<Vec<u32>>(&pages) else {
            continue;
        };
        let mut sources = conn
            .prepare(
                "SELECT item_kind, logical_id, content_hash, page, start_offset, end_offset, quote
                   FROM pdf_kit_item_sources WHERE run_id = ?1
                  ORDER BY item_kind, logical_id, page, start_offset",
            )
            .map_err(|_| bad())?;
        let rows: Vec<(String, String, String, u32, usize, usize, String)> = sources
            .query_map([&run_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            })
            .map_err(|_| bad())?
            .collect::<Result<_, _>>()
            .map_err(|_| bad())?;
        let mut items = Vec::new();
        for (kind, logical, hash, page, start, end, quote) in rows {
            let (local, pack_hash) = if kind == "summary" {
                if guide.is_none()
                    || logical != format!("summary:{run_id}")
                    || hash != ids.summary_hash
                {
                    continue;
                }
                ("summary:r1".to_string(), ids.summary_hash.clone())
            } else {
                let Some((local, db_hash)) = ids.items.get(&(kind.clone(), logical.clone())) else {
                    continue;
                };
                if *db_hash != hash {
                    continue;
                }
                let field = match kind.as_str() {
                    "question" => "questions",
                    "card" => "flashcards",
                    _ => "sections",
                };
                let found = target[field].as_array().and_then(|a| {
                    a.iter().find(|v| {
                        v.get("identity")
                            .or_else(|| v.get("itemId"))
                            .and_then(Value::as_str)
                            == Some(local.as_str())
                    })
                });
                let Some(found) = found else { continue };
                (
                    local.clone(),
                    compute_canonical_hash(&crate::pdf_kit_sources::content(&kind, found)),
                )
            };
            items.push(CitationItem {
                item_kind: kind,
                logical_id: local,
                content_hash: pack_hash,
                page,
                start_offset: start,
                end_offset: end,
                quote,
            });
        }
        if items.is_empty() {
            continue;
        }
        if best.as_ref().map_or(true, |b| items.len() > b.items.len()) {
            best = Some(CitationsJson {
                run_id: "r1".to_string(),
                run: CitationRun {
                    content_sha256: sha.clone(),
                    selected_pages,
                    extractor_version: extractor,
                    algorithm_version: algorithm,
                    created_at,
                },
                items,
            });
        }
    }
    // A run that does not pass the pack's own checks is left out, not shipped.
    if let (Some(c), Some(FileData::Pdf { sha, pages, .. })) = (&best, &own.file) {
        let file = ManifestFile {
            entry: String::new(),
            sha256: sha.clone(),
            bytes: 0,
            total_pages: Some(*pages),
            width: None,
            height: None,
            original_file_name: String::new(),
        };
        if validate::check_citations(c, guide, practice, Some(&file)).is_err() {
            return Ok(None);
        }
    }
    Ok(best)
}

fn build_videos(conn: &Connection, id: &str) -> Result<Vec<VideoJson>, String> {
    let bad = || "Video links in your library can't be read.".to_string();
    let mut statement = conn
        .prepare(
            "SELECT url, title FROM material_video_links WHERE material_id = ?1
              ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(|_| bad())?;
    let rows: Vec<(String, String)> = statement
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| bad())?
        .collect::<Result<_, _>>()
        .map_err(|_| bad())?;
    Ok(rows
        .into_iter()
        .filter(|(url, title)| {
            validate::canonical_video_url(url).as_deref() == Some(url.as_str())
                && title.trim() == title
                && title.encode_utf16().count() <= 200
        })
        .take(MAX_VIDEOS_PER_ITEM)
        .map(|(url, title)| VideoJson { url, title })
        .collect())
}

fn build_lineage(
    conn: &Connection,
    id: &str,
    refs: &HashMap<String, String>,
) -> Result<Option<LineageJson>, String> {
    type Row = (
        Option<String>,
        Option<String>,
        i64,
        i64,
        Option<i64>,
        Option<i64>,
        i64,
        String,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        i64,
    );
    let row: Option<Row> = conn
        .query_row(
            "SELECT parent_material_id, root_material_id, source_page_start, source_page_end,
                    parent_page_start, parent_page_end, child_page_count, source_file_name,
                    source_title, source_content_sha256, source_total_pages, parent_file_name,
                    parent_title, parent_content_sha256, parent_total_pages, nested_level
               FROM material_split_lineage WHERE material_id = ?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                    r.get(12)?,
                    r.get(13)?,
                    r.get(14)?,
                    r.get(15)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "Split information in your library can't be read.".to_string())?;
    let Some(r) = row else { return Ok(None) };
    let link = |material: &Option<String>| -> (Option<String>, Option<String>) {
        match material {
            None => (None, None),
            Some(m) => match refs.get(m) {
                Some(item_ref) => (Some(item_ref.clone()), None),
                None => (None, Some(m.clone())),
            },
        }
    };
    let (parent_ref, parent_item_id) = link(&r.0);
    let (root_ref, root_item_id) = link(&r.1);
    Ok(Some(LineageJson {
        parent_ref,
        parent_item_id,
        root_ref,
        root_item_id,
        source_page_start: r.2,
        source_page_end: r.3,
        parent_page_start: r.4,
        parent_page_end: r.5,
        child_page_count: r.6,
        source_file_name: r.7,
        source_title: r.8,
        source_content_sha256: r.9,
        source_total_pages: r.10,
        parent_file_name: r.11,
        parent_title: r.12,
        parent_content_sha256: r.13,
        parent_total_pages: r.14,
        nested_level: r.15,
    }))
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

struct BuiltItem {
    manifest: ManifestItem,
    item_bytes: Vec<u8>,
    file_bytes: Option<Vec<u8>>,
}

fn temp_beside(dest: &Path) -> Result<PathBuf, String> {
    let name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Choose a file name for the study pack.".to_string())?;
    let parent = dest
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    Ok(parent.join(format!(".{name}.{}.tmp", std::process::id())))
}

fn write_zip(temp: &Path, manifest: &[u8], items: &[BuiltItem]) -> Result<(), String> {
    use zip::write::SimpleFileOptions;
    fn failed<E>(_: E) -> String {
        "Could not save the study pack.".to_string()
    }
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .map_err(|_| "Could not save the study pack.".to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let json = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let stored = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o644);
    zip.start_file(MANIFEST_ENTRY, json).map_err(failed)?;
    zip.write_all(manifest).map_err(failed)?;
    for item in items {
        zip.start_file(&item.manifest.entry, json).map_err(failed)?;
        zip.write_all(&item.item_bytes).map_err(failed)?;
        if let (Some(file), Some(bytes)) = (&item.manifest.file, &item.file_bytes) {
            zip.start_file(&file.entry, stored).map_err(failed)?;
            zip.write_all(bytes).map_err(failed)?;
        }
    }
    let file = zip.finish().map_err(failed)?;
    file.sync_all().map_err(failed)?;
    Ok(())
}

/// Export `material_ids` (and the pictures their picture cards need) to
/// `dest`. `root` is the library folder.
pub fn export_study_pack_in(
    root: &Path,
    material_ids: &[String],
    dest: &Path,
    app_version: &str,
) -> Result<ExportSummary, String> {
    let conn = Connection::open(root.join("her-flight-deck.db"))
        .map_err(|_| "Could not open your library.".to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "Could not open your library.".to_string())?;
    let namespace = ensure_namespace(&conn)?;
    let schema_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
            [],
            |r| r.get(0),
        )
        .unwrap_or(crate::CURRENT_SCHEMA_VERSION);

    let mut selected: Vec<String> = Vec::new();
    for id in material_ids {
        if !selected.contains(id) {
            selected.push(id.clone());
        }
    }
    if selected.is_empty() {
        return Err("Choose at least one item to share.".to_string());
    }

    // One consistent read of everything below.
    let read = conn
        .unchecked_transaction()
        .map_err(|_| "Could not read your library.".to_string())?;

    let mut loaded: Vec<Loaded> = Vec::new();
    for id in &selected {
        loaded.push(load_material(&read, root, id)?);
    }
    let mut guides: HashMap<String, DbGuide> = HashMap::new();
    for m in &loaded {
        if !matches!(m.file, Some(FileData::Png { .. })) {
            if let Some(g) = read_guide(&read, &m.id)? {
                guides.insert(m.id.clone(), g);
            }
        }
    }
    // Pictures the selected guides depend on are added automatically.
    let mut dependencies: Vec<String> = Vec::new();
    for g in guides.values() {
        for card in &g.cards {
            let Some(region) = card
                .get("visualRegionId")
                .and_then(Value::as_str)
                .and_then(|r| crate::visual_cards::read_region(&read, r).ok())
            else {
                continue;
            };
            if let Some(image) = region.image_material_id {
                if !selected.contains(&image) && !dependencies.contains(&image) {
                    dependencies.push(image);
                }
            }
        }
    }
    dependencies.sort();
    for id in dependencies {
        if let Ok(m) = load_material(&read, root, &id) {
            if matches!(m.file, Some(FileData::Png { .. })) {
                loaded.push(m);
            }
        }
    }
    if loaded.len() > MAX_ITEMS {
        return Err("That is too many items for one study pack.".to_string());
    }

    let refs: HashMap<String, String> = loaded
        .iter()
        .enumerate()
        .map(|(i, m)| (m.id.clone(), format!("m{}", i + 1)))
        .collect();
    let pictures: HashMap<String, PictureRef> = loaded
        .iter()
        .filter_map(|m| match &m.file {
            Some(FileData::Png {
                sha, width, height, ..
            }) => Some((
                m.id.clone(),
                PictureRef {
                    item_ref: refs[&m.id].clone(),
                    sha: sha.clone(),
                    width: *width,
                    height: *height,
                },
            )),
            _ => None,
        })
        .collect();

    let mut built: Vec<BuiltItem> = Vec::new();
    let mut counts = Counts {
        guides: 0,
        cards: 0,
        questions: 0,
        videos: 0,
        documents: 0,
        pictures: 0,
    };
    let mut cards_left_out = 0u64;
    for (index, m) in loaded.iter().enumerate() {
        let n = index + 1;
        let is_picture = matches!(m.file, Some(FileData::Png { .. }));
        let kind = match &m.file {
            None => "guide",
            Some(FileData::Pdf { .. }) => "document",
            Some(FileData::Png { .. }) => "picture",
        };
        let (mut guide, mut regions, mut ids) = (None, None, IdMap::default());
        if let Some(db) = guides.get(&m.id) {
            let b = build_guide(&read, db, &pictures, m)?;
            cards_left_out += b.left_out;
            ids = b.ids;
            regions = (!b.regions.is_empty()).then_some(b.regions);
            guide = Some(b.guide);
        }
        let practice = if is_picture {
            None
        } else {
            build_practice(&read, m, &mut ids)?
        };
        let citations = if is_picture {
            None
        } else {
            build_citations(&read, m, guide.as_ref(), practice.as_ref(), &ids)?
        };
        let videos = if is_picture {
            Vec::new()
        } else {
            build_videos(&read, &m.id)?
        };
        let lineage = if kind == "document" {
            build_lineage(&read, &m.id, &refs)?
        } else {
            None
        };
        if kind == "guide" && guide.is_none() && practice.is_none() && videos.is_empty() {
            return Err(format!("\"{}\" has nothing to share yet.", m.title));
        }
        let item = ItemJson {
            item_ref: refs[&m.id].clone(),
            title: m.title.clone(),
            material_type: m.material_type.clone(),
            topic: m.topic.clone(),
            guide,
            citations,
            visual_regions: regions,
            practice,
            videos,
            lineage,
        };
        let file = m.file.as_ref().map(|f| match f {
            FileData::Pdf { bytes, sha, pages } => ManifestFile {
                entry: format!("files/{n}.pdf"),
                sha256: sha.clone(),
                bytes: bytes.len() as u64,
                total_pages: Some(*pages),
                width: None,
                height: None,
                original_file_name: m.file_name.clone(),
            },
            FileData::Png {
                bytes,
                sha,
                width,
                height,
            } => ManifestFile {
                entry: format!("files/{n}.png"),
                sha256: sha.clone(),
                bytes: bytes.len() as u64,
                total_pages: None,
                width: Some(*width),
                height: Some(*height),
                original_file_name: m.file_name.clone(),
            },
        });
        let revision = revision::revision_of(kind, &item, file.as_ref());
        let item_bytes =
            serde_json::to_vec(&item).map_err(|_| "Could not build the study pack.".to_string())?;
        if item_bytes.len() as u64 > MAX_ITEM_JSON_BYTES {
            return Err(format!("\"{}\" is too large for a study pack.", m.title));
        }
        if let Some(g) = &item.guide {
            counts.guides += 1;
            counts.cards += g.flashcards.len() as u64;
        }
        counts.questions += item
            .practice
            .as_ref()
            .map_or(0, |p| p.questions.len() as u64);
        counts.videos += item.videos.len() as u64;
        match kind {
            "document" => counts.documents += 1,
            "picture" => counts.pictures += 1,
            _ => {}
        }
        built.push(BuiltItem {
            manifest: ManifestItem {
                item_ref: item.item_ref.clone(),
                item_id: m.id.clone(),
                kind: kind.to_string(),
                revision,
                entry: format!("items/{n}.json"),
                entry_sha256: hex::encode(Sha256::digest(&item_bytes)),
                entry_bytes: item_bytes.len() as u64,
                file,
            },
            item_bytes,
            file_bytes: m.file.as_ref().map(|f| f.bytes().to_vec()),
        });
    }
    drop(read);

    let pack_id = crate::practice_sessions::generate_uuid_v4(&conn)
        .map_err(|_| "Could not prepare the study pack.".to_string())?;
    let created_at = crate::practice_sessions::db_now_iso(&conn)
        .map_err(|_| "Could not prepare the study pack.".to_string())?;
    let manifest = Manifest {
        format: FORMAT.to_string(),
        pack_format: PACK_FORMAT,
        min_reader_format: 1,
        pack_id: pack_id.clone(),
        namespace: namespace.clone(),
        created_at,
        producer: Producer {
            app_version: app_version.to_string(),
            schema_version,
        },
        items: built.iter().map(|b| b.manifest.clone()).collect(),
        counts: counts.clone(),
    };
    let manifest_bytes =
        serde_json::to_vec(&manifest).map_err(|_| "Could not build the study pack.".to_string())?;
    if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("That is too many items for one study pack.".to_string());
    }

    let temp = temp_beside(dest)?;
    let result = write_zip(&temp, &manifest_bytes, &built).and_then(|()| {
        std::fs::rename(&temp, dest).map_err(|_| "Could not save the study pack.".to_string())
    });
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    // The pack must pass the same checks as one that arrives from outside.
    let validated = match validate::validate_pack(dest) {
        Ok(v) => v,
        Err(error) => {
            let _ = std::fs::remove_file(dest);
            return Err(format!("The study pack didn't pass its own check. {error}"));
        }
    };
    Ok(ExportSummary {
        pack_id,
        namespace,
        items: validated.items.len(),
        documents: counts.documents,
        pictures: counts.pictures,
        guides: counts.guides,
        cards: counts.cards,
        questions: counts.questions,
        videos: counts.videos,
        cards_left_out,
        bytes: validated.pack_bytes,
    })
}

/// Test helper: the set of entry names in a pack.
#[cfg(test)]
pub(crate) fn entry_names(path: &Path) -> std::collections::HashSet<String> {
    let file = std::fs::File::open(path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().unwrap().into_owned())
        .collect()
}
