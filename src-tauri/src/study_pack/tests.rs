use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use lopdf::{dictionary, Document, Object};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::export::{entry_names, export_study_pack_in, ExportSummary};
use super::format::*;
use super::validate::validate_pack;
use crate::practice_sessions::compute_canonical_hash;

const NOW: &str = "2026-11-01T10:00:00.000Z";
const PANEL: &[u8] = include_bytes!("../../../src/testing/fixtures/visual/practice-panel.png");
const Q1: &str = "aaaaaaaa-0000-4000-8000-000000000001";
const Q2: &str = "aaaaaaaa-0000-4000-8000-000000000002";
const GONE: &str = "bbbbbbbb-0000-4000-8000-000000000009";

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!(
            "hfd-pack-{}-{n}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn pdf_bytes(pages: u32, salt: &str) -> Vec<u8> {
    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let kids: Vec<Object> = (0..pages)
        .map(|_| {
            document
                .add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                })
                .into()
        })
        .collect();
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Count" => i64::from(pages), "Kids" => kids,
        }),
    );
    let catalog_id = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    document.trailer.set("Root", catalog_id);
    let info = document.add_object(dictionary! { "Title" => Object::string_literal(salt) });
    document.trailer.set("Info", info);
    let mut out = Vec::new();
    document.save_to(&mut out).unwrap();
    out
}

/// A structurally valid PNG of any size (the app checks structure, not pixels).
fn fake_png(width: u32, height: u32, salt: &str) -> Vec<u8> {
    let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
    let mut chunk = |kind: &[u8; 4], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&[0, 0, 0, 0]);
    };
    let mut header = Vec::new();
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &header);
    chunk(b"IDAT", salt.as_bytes());
    chunk(b"IEND", &[]);
    out
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

struct Lib {
    dir: TempDir,
    conn: Connection,
}

fn lib() -> Lib {
    let dir = TempDir::new();
    std::fs::create_dir_all(dir.path().join("documents")).unwrap();
    let conn = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY)")
        .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
            .unwrap();
    }
    Lib { dir, conn }
}

impl Lib {
    fn root(&self) -> &Path {
        self.dir.path()
    }

    fn material(&self, id: &str, title: &str, file: Option<(&str, &[u8])>) {
        let (path, name) = match file {
            Some((name, bytes)) => {
                let rel = format!("{id}-{name}");
                std::fs::write(self.root().join("documents").join(&rel), bytes).unwrap();
                (Some(rel), Some(name.to_string()))
            }
            None => (None, None),
        };
        self.conn
            .execute(
                "INSERT INTO study_materials (id, title, material_type, topic, notes, file_path,
                     original_file_name, created_at, updated_at)
                 VALUES (?1, ?2, 'study_guide', 'regs', 'SECRET-NOTE-TEXT', ?3, ?4, ?5, ?5)",
                params![id, title, path, name, NOW],
            )
            .unwrap();
    }

    fn replace_file(&self, id: &str, bytes: &[u8]) {
        let rel: String = self
            .conn
            .query_row(
                "SELECT file_path FROM study_materials WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        std::fs::write(self.root().join("documents").join(rel), bytes).unwrap();
    }

    fn guide(&self, id: &str, summary: &str, sections: Value, cards: Value) {
        self.conn
            .execute(
                "INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json,
                     flashcards_json, source_notes, provider, model, generated_at, updated_at,
                     summary_origin, retired_json)
                 VALUES (?1, 'Guide title', ?2, ?3, ?4, 'notes', 'gemini', 'model-a', ?5, ?5,
                     'instructor', '[{\"kind\":\"card\",\"itemId\":\"x\"}]')",
                params![id, summary, sections.to_string(), cards.to_string(), NOW],
            )
            .unwrap();
    }

    fn region(&self, owner: &str, image: &str, rect: (i64, i64, i64, i64)) -> String {
        let (sha, (w, h)) = {
            let bytes = self.file_of(image);
            (
                sha(&bytes),
                crate::visual_cards::inspect_png(&bytes).unwrap(),
            )
        };
        let mut region = crate::visual_cards::Region {
            id: String::new(),
            owner_material_id: owner.to_string(),
            image_material_id: Some(image.to_string()),
            image_sha256: sha,
            image_width: w,
            image_height: h,
            x: rect.0,
            y: rect.1,
            w: rect.2,
            h: rect.3,
            rotation: 0,
        };
        region.id = region.hash();
        self.conn
            .execute(
                "INSERT INTO visual_card_regions (id,owner_material_id,image_material_id,image_sha256,
                     image_width,image_height,x,y,w,h,rotation) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![region.id, owner, image, region.image_sha256, w, h, rect.0, rect.1, rect.2, rect.3, 0],
            )
            .unwrap();
        region.id
    }

    fn file_of(&self, id: &str) -> Vec<u8> {
        let rel: String = self
            .conn
            .query_row(
                "SELECT file_path FROM study_materials WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        std::fs::read(self.root().join("documents").join(rel)).unwrap()
    }

    fn practice(&self, id: &str) {
        self.conn
            .execute(
                "INSERT INTO practice_test_versions (id, source_material_id, history_key,
                     source_material_title, version_number, provider, model, title, content_hash,
                     created_at, is_active)
                 VALUES ('ver-1', ?1, ?1, 'T', 1, 'manual', 'm', 'Practice title', 'h', ?2, 1)",
                params![id, NOW],
            )
            .unwrap();
        for (ordinal, (item, logical, replaces, text, origin, acs)) in [
            (
                "it-1",
                Q1,
                Some(GONE),
                "Q one?",
                Some("user"),
                Some("PA.I.A"),
            ),
            ("it-2", Q2, None, "Q two?", None, None),
        ]
        .into_iter()
        .enumerate()
        {
            self.conn
                .execute(
                    "INSERT INTO practice_test_items (id, version_id, ordinal, question_text,
                         options_json, correct_index, explanation, source_page, logical_id, replaces_id)
                     VALUES (?1,'ver-1',?2,?3,'[\"a\",\"b\"]',1,'because',2,?4,?5)",
                    params![item, ordinal as i64, text, logical, replaces],
                )
                .unwrap();
            if let Some(origin) = origin {
                self.conn
                    .execute(
                        "INSERT INTO practice_item_origins VALUES (?1,?2)",
                        params![item, origin],
                    )
                    .unwrap();
            }
            if let Some(task) = acs {
                self.conn
                    .execute(
                        "INSERT INTO practice_item_acs_tasks VALUES (?1,?2)",
                        params![item, task],
                    )
                    .unwrap();
            }
        }
    }

    fn video(&self, id: &str, url: &str, title: &str) {
        self.conn
            .execute(
                "INSERT INTO material_video_links (id, material_id, url, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![format!("v-{url}"), id, url, title, NOW],
            )
            .unwrap();
    }

    fn export(&self, ids: &[&str], name: &str) -> Result<ExportSummary, String> {
        let ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
        export_study_pack_in(self.root(), &ids, &self.out(name), "0.6.9")
    }

    fn out(&self, name: &str) -> PathBuf {
        let dir = self.root().join("out");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }
}

fn summary_hash(summary: &str) -> String {
    compute_canonical_hash(&json!(summary))
}

/// A library with a handbook (guide, practice, citations, video, picture
/// card), a picture, a guide-only material and a chapter-split child.
fn seeded() -> (Lib, String) {
    let lib = lib();
    let pdf = pdf_bytes(5, "handbook");
    lib.material("m-pdf", "Handbook", Some(("handbook.pdf", &pdf)));
    lib.material("m-pic", "Panel picture", Some(("panel.png", PANEL)));
    lib.material("m-guide", "Notes guide", None);
    lib.material(
        "m-child",
        "Chapter 2",
        Some(("chapter2.pdf", &pdf_bytes(3, "chapter"))),
    );

    let region = lib.region("m-pdf", "m-pic", (1, 1, 10, 10));
    let sections = json!([
        {"heading": "Intro", "body": "Body one", "itemId": "sec-real", "origin": "user", "replaces": "old-sec"},
        {"heading": "Second", "body": "Body two"}
    ]);
    let cards = json!([
        {"front": "F1", "back": "B1", "sourcePage": 2, "itemId": "card-real", "origin": "instructor", "replaces": "old"},
        {"front": "F2", "back": "B2", "sourcePage": 99},
        {"front": "Pic", "back": "Look", "sourcePage": null, "visualRegionId": region}
    ]);
    lib.guide("m-pdf", "Summary text", sections.clone(), cards.clone());
    lib.guide(
        "m-guide",
        "Other summary",
        json!([{"heading": "H", "body": "B"}]),
        json!([]),
    );
    lib.practice("m-pdf");
    lib.video("m-pdf", "https://youtu.be/abc", "Intro video");
    lib.video("m-pdf", "https://example.com/two", "");

    let pdf_sha = sha(&pdf);
    lib.conn
        .execute(
            "INSERT INTO pdf_kit_runs VALUES ('run-real','m-pdf',?1,'[1,2,3]',1,1,?2)",
            params![pdf_sha, NOW],
        )
        .unwrap();
    let q_db =
        crate::practice_authoring::question_value(&crate::practice_authoring::AuthoringQuestion {
            acs_task: Some("PA.I.A".into()),
            question: "Q one?".into(),
            options: vec!["a".into(), "b".into()],
            correct_index: 1,
            explanation: "because".into(),
            source_page: Some(2),
            identity: Q1.into(),
            origin: Some("user".into()),
            replaces: Some(GONE.into()),
        });
    let source_rows = [
        (
            "summary",
            "summary:run-real".to_string(),
            summary_hash("Summary text"),
        ),
        (
            "section",
            "sec-real".to_string(),
            compute_canonical_hash(&crate::pdf_kit_sources::content("section", &sections[0])),
        ),
        (
            "card",
            "card-real".to_string(),
            compute_canonical_hash(&crate::pdf_kit_sources::content("card", &cards[0])),
        ),
        (
            "question",
            Q1.to_string(),
            compute_canonical_hash(&crate::pdf_kit_sources::content("question", &q_db)),
        ),
    ];
    for (kind, logical, hash) in source_rows {
        lib.conn
            .execute(
                "INSERT INTO pdf_kit_item_sources VALUES ('run-real',?1,?2,?3,1,0,5,'Alpha')",
                params![kind, logical, hash],
            )
            .unwrap();
    }

    lib.conn
        .execute(
            "INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id,
                 source_page_start, source_page_end, child_page_count, source_file_name, source_title,
                 source_content_sha256, source_total_pages, nested_level, created_at)
             VALUES ('m-child','m-pdf','m-pdf',2,4,3,'handbook.pdf','Handbook',?1,5,1,?2)",
            params![pdf_sha, NOW],
        )
        .unwrap();

    // Things that must never leave the library.
    lib.conn
        .execute(
            "INSERT INTO app_metadata VALUES ('provider_secret','SECRET-API-KEY')",
            [],
        )
        .unwrap();
    std::fs::write(lib.root().join("gemini.key"), "SECRET-KEY-FILE").unwrap();
    (lib, pdf_sha)
}

fn read_pack(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    (0..archive.len())
        .map(|i| {
            let mut e = archive.by_index(i).unwrap();
            let name = e.name().unwrap().into_owned();
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut e, &mut bytes).unwrap();
            (name, bytes)
        })
        .collect()
}

#[derive(Clone, Copy)]
enum Method {
    Stored,
    Deflated,
}

fn write_pack(path: &Path, entries: &[(String, Vec<u8>)]) {
    write_pack_with(path, entries, |_| (Method::Stored, None));
}

fn write_pack_with(
    path: &Path,
    entries: &[(String, Vec<u8>)],
    how: impl Fn(&str) -> (Method, Option<u32>),
) {
    use zip::write::SimpleFileOptions;
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        let (method, mode) = how(name);
        let mut options = SimpleFileOptions::default().compression_method(match method {
            Method::Stored => zip::CompressionMethod::Stored,
            Method::Deflated => zip::CompressionMethod::Deflated,
        });
        if let Some(mode) = mode {
            options = options.unix_permissions(mode);
        }
        zip.start_file(name.as_str(), options).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}

/// Rewrite a valid pack with `edit` applied, then re-seal the manifest's
/// checksums so only the edit itself can fail.
fn tampered(
    lib: &Lib,
    base: &Path,
    name: &str,
    edit: impl FnOnce(&mut Vec<(String, Vec<u8>)>, &mut Value),
) -> PathBuf {
    let mut entries = read_pack(base);
    let idx = entries
        .iter()
        .position(|(n, _)| n == "manifest.json")
        .unwrap();
    let mut manifest: Value = serde_json::from_slice(&entries[idx].1).unwrap();
    edit(&mut entries, &mut manifest);
    for item in manifest["items"].as_array_mut().unwrap() {
        let entry = item["entry"].as_str().unwrap().to_string();
        if let Some((_, bytes)) = entries.iter().find(|(n, _)| *n == entry) {
            item["entrySha256"] = json!(sha(bytes));
            item["entryBytes"] = json!(bytes.len());
        }
        if item["file"].is_object() {
            let file = item["file"]["entry"].as_str().unwrap().to_string();
            if let Some((_, bytes)) = entries.iter().find(|(n, _)| *n == file) {
                item["file"]["sha256"] = json!(sha(bytes));
                item["file"]["bytes"] = json!(bytes.len());
            }
        }
    }
    let idx = entries
        .iter()
        .position(|(n, _)| n == "manifest.json")
        .unwrap();
    entries[idx].1 = serde_json::to_vec(&manifest).unwrap();
    let out = lib.out(name);
    write_pack(&out, &entries);
    out
}

fn item_json(entries: &mut [(String, Vec<u8>)], name: &str) -> Value {
    let e = entries.iter().find(|(n, _)| n == name).unwrap();
    serde_json::from_slice(&e.1).unwrap()
}

fn set_item_json(entries: &mut [(String, Vec<u8>)], name: &str, value: &Value) {
    let e = entries.iter_mut().find(|(n, _)| n == name).unwrap();
    e.1 = serde_json::to_vec(value).unwrap();
}

fn revisions(path: &Path) -> HashMap<String, String> {
    validate_pack(path)
        .unwrap()
        .items
        .into_iter()
        .map(|i| (i.manifest.item_id, i.manifest.revision))
        .collect()
}

fn all_ids() -> [&'static str; 4] {
    ["m-pdf", "m-guide", "m-child", "m-pic"]
}

/* ------------------------------------------------------------------ */

#[test]
fn round_trip_export_validates_and_counts_match() {
    let (lib, _) = seeded();
    let summary = lib
        .export(&["m-pdf", "m-guide", "m-child"], "all.hfdpack")
        .unwrap();
    let pack = validate_pack(&lib.out("all.hfdpack")).unwrap();
    assert_eq!(summary.items, 4, "the picture is added as a dependency");
    assert_eq!(pack.manifest.counts.documents, 2);
    assert_eq!(pack.manifest.counts.pictures, 1);
    assert_eq!(pack.manifest.counts.guides, 2);
    assert_eq!(pack.manifest.counts.cards, 3);
    assert_eq!(pack.manifest.counts.questions, 2);
    assert_eq!(pack.manifest.counts.videos, 2);
    assert_eq!(summary.cards, 3);
    assert_eq!(pack.manifest.format, FORMAT);
    assert_eq!(pack.manifest.pack_format, 1);
    let names = entry_names(&lib.out("all.hfdpack"));
    assert_eq!(names.len(), 1 + 4 + 3);
    let handbook = pack
        .items
        .iter()
        .find(|i| i.manifest.item_id == "m-pdf")
        .unwrap();
    assert_eq!(handbook.json.videos.len(), 2);
}

#[test]
fn nothing_private_is_in_any_entry() {
    let (lib, _) = seeded();
    lib.export(&all_ids(), "all.hfdpack").unwrap();
    for (name, bytes) in read_pack(&lib.out("all.hfdpack")) {
        let text = String::from_utf8_lossy(&bytes);
        for secret in [
            "SECRET-NOTE-TEXT",
            "SECRET-API-KEY",
            "SECRET-KEY-FILE",
            "provider_secret",
        ] {
            assert!(!text.contains(secret), "{secret} leaked into {name}");
        }
    }
    // The library itself is untouched except for the namespace key.
    let notes: String = lib
        .conn
        .query_row(
            "SELECT notes FROM study_materials WHERE id='m-pdf'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(notes, "SECRET-NOTE-TEXT");
}

#[test]
fn a_picture_a_guide_needs_is_added_automatically() {
    let (lib, _) = seeded();
    let summary = lib.export(&["m-pdf"], "one.hfdpack").unwrap();
    assert_eq!(summary.items, 2);
    let pack = validate_pack(&lib.out("one.hfdpack")).unwrap();
    let kinds: Vec<_> = pack
        .items
        .iter()
        .map(|i| i.manifest.kind.as_str())
        .collect();
    assert_eq!(kinds, ["document", "picture"]);
    let guide = pack.items[0].json.guide.as_ref().unwrap();
    let card = guide
        .flashcards
        .iter()
        .find(|c| c.visual_region_id.is_some())
        .unwrap();
    let region = &pack.items[0].json.visual_regions.as_ref().unwrap()[0];
    assert_eq!(Some(&region.id), card.visual_region_id.as_ref());
    assert_eq!(region.image_ref, pack.items[1].manifest.item_ref);
}

#[test]
fn a_missing_picture_leaves_its_cards_out_and_is_counted() {
    let (lib, _) = seeded();
    lib.conn
        .execute("DELETE FROM study_materials WHERE id='m-pic'", [])
        .unwrap();
    let summary = lib.export(&["m-pdf"], "one.hfdpack").unwrap();
    assert_eq!(summary.cards_left_out, 1);
    assert_eq!(summary.cards, 2);
    assert_eq!(summary.items, 1);
}

#[test]
fn citations_follow_the_file_and_use_a_local_summary_id() {
    let (lib, pdf_sha) = seeded();
    lib.export(&["m-pdf"], "a.hfdpack").unwrap();
    let pack = validate_pack(&lib.out("a.hfdpack")).unwrap();
    let citations = pack.items[0].json.citations.as_ref().unwrap();
    assert_eq!(citations.run_id, "r1");
    assert_eq!(citations.run.content_sha256, pdf_sha);
    let kinds: Vec<_> = citations
        .items
        .iter()
        .map(|i| i.item_kind.as_str())
        .collect();
    assert_eq!(kinds, ["card", "question", "section", "summary"]);
    let summary = citations
        .items
        .iter()
        .find(|i| i.item_kind == "summary")
        .unwrap();
    assert_eq!(summary.logical_id, "summary:r1");

    // A run made on different bytes is not shipped.
    lib.conn
        .execute(
            "UPDATE pdf_kit_runs SET content_sha256 = ?1",
            [sha(b"other")],
        )
        .unwrap();
    lib.export(&["m-pdf"], "b.hfdpack").unwrap();
    let pack = validate_pack(&lib.out("b.hfdpack")).unwrap();
    assert!(pack.items[0].json.citations.is_none());
}

#[test]
fn a_citation_whose_item_was_edited_is_dropped() {
    let (lib, _) = seeded();
    lib.conn
        .execute(
            "UPDATE pdf_kit_item_sources SET content_hash = ?1 WHERE item_kind = 'section'",
            [sha(b"stale")],
        )
        .unwrap();
    lib.export(&["m-pdf"], "a.hfdpack").unwrap();
    let pack = validate_pack(&lib.out("a.hfdpack")).unwrap();
    let c = pack.items[0].json.citations.as_ref().unwrap();
    assert!(c.items.iter().all(|i| i.item_kind != "section"));
}

#[test]
fn replaces_and_retired_are_stripped_and_the_guide_title_is_kept() {
    let (lib, _) = seeded();
    lib.export(&all_ids(), "all.hfdpack").unwrap();
    for (name, bytes) in read_pack(&lib.out("all.hfdpack")) {
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains("replaces"), "{name}");
        assert!(!text.contains("retired"), "{name}");
        assert!(!text.contains("old-sec") && !text.contains(GONE), "{name}");
    }
    let pack = validate_pack(&lib.out("all.hfdpack")).unwrap();
    let guide = pack.items[0].json.guide.as_ref().unwrap();
    assert_eq!(guide.title, "Guide title");
    assert_eq!(pack.items[0].json.title, "Handbook");
    assert_eq!(guide.sections[0].origin.as_deref(), Some("user"));
    assert_eq!(
        guide.flashcards[1].source_page, None,
        "page 99 is past the end"
    );
}

#[test]
fn split_lineage_is_exported_with_refs_inside_the_pack() {
    let (lib, _) = seeded();
    lib.export(&["m-pdf", "m-child"], "in.hfdpack").unwrap();
    let pack = validate_pack(&lib.out("in.hfdpack")).unwrap();
    let child = pack
        .items
        .iter()
        .find(|i| i.manifest.item_id == "m-child")
        .unwrap();
    let lineage = child.json.lineage.as_ref().unwrap();
    let parent_ref = &pack
        .items
        .iter()
        .find(|i| i.manifest.item_id == "m-pdf")
        .unwrap()
        .manifest
        .item_ref;
    assert_eq!(lineage.parent_ref.as_ref(), Some(parent_ref));
    assert_eq!(lineage.root_ref.as_ref(), Some(parent_ref));
    assert_eq!(
        (
            lineage.source_page_start,
            lineage.source_page_end,
            lineage.child_page_count
        ),
        (2, 4, 3)
    );

    // Parent not in the pack: named by its producer id instead.
    lib.export(&["m-child"], "out.hfdpack").unwrap();
    let pack = validate_pack(&lib.out("out.hfdpack")).unwrap();
    let lineage = pack.items[0].json.lineage.as_ref().unwrap();
    assert_eq!(lineage.parent_item_id.as_deref(), Some("m-pdf"));
    assert!(lineage.parent_ref.is_none());
}

#[test]
fn the_namespace_is_created_once_and_never_replaced() {
    let (lib, _) = seeded();
    lib.export(&["m-pdf"], "a.hfdpack").unwrap();
    lib.export(&["m-guide"], "b.hfdpack").unwrap();
    let a = validate_pack(&lib.out("a.hfdpack"))
        .unwrap()
        .manifest
        .namespace;
    let b = validate_pack(&lib.out("b.hfdpack"))
        .unwrap()
        .manifest
        .namespace;
    assert_eq!(a, b);
    let stored: String = lib
        .conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key='study_pack_namespace'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, a);
    let packs: Vec<String> = [lib.out("a.hfdpack"), lib.out("b.hfdpack")]
        .iter()
        .map(|p| validate_pack(p).unwrap().manifest.pack_id)
        .collect();
    assert_ne!(packs[0], packs[1]);
}

#[test]
fn revision_is_equal_across_selection_order_and_numbering() {
    let (lib, _) = seeded();
    lib.export(&["m-pdf", "m-guide", "m-child"], "full.hfdpack")
        .unwrap();
    lib.export(&["m-guide"], "subset.hfdpack").unwrap();
    lib.export(&["m-child", "m-guide", "m-pdf"], "reversed.hfdpack")
        .unwrap();
    let full = revisions(&lib.out("full.hfdpack"));
    let subset = revisions(&lib.out("subset.hfdpack"));
    let reversed = revisions(&lib.out("reversed.hfdpack"));
    assert_eq!(full["m-guide"], subset["m-guide"]);
    for id in ["m-pdf", "m-guide", "m-child", "m-pic"] {
        assert_eq!(full[id], reversed[id], "{id}");
    }
    let a = validate_pack(&lib.out("full.hfdpack")).unwrap();
    let b = validate_pack(&lib.out("reversed.hfdpack")).unwrap();
    let ref_a = &a
        .items
        .iter()
        .find(|i| i.manifest.item_id == "m-pdf")
        .unwrap()
        .manifest
        .item_ref;
    let ref_b = &b
        .items
        .iter()
        .find(|i| i.manifest.item_id == "m-pdf")
        .unwrap()
        .manifest
        .item_ref;
    assert_ne!(ref_a, ref_b, "refs were renumbered");
}

fn revision_of_handbook(lib: &Lib, name: &str) -> String {
    lib.export(&["m-pdf"], name).unwrap();
    revisions(&lib.out(name))["m-pdf"].clone()
}

#[test]
fn revision_changes_with_content_and_ignores_provenance() {
    type Edit = Box<dyn Fn(&Lib)>;
    let edits: Vec<(&str, Edit)> = vec![
        (
            "material title",
            Box::new(|l| {
                l.conn
                    .execute(
                        "UPDATE study_materials SET title='New' WHERE id='m-pdf'",
                        [],
                    )
                    .unwrap();
            }),
        ),
        (
            "guide summary",
            Box::new(|l| {
                l.conn.execute("UPDATE ai_study_sets SET summary='Changed' WHERE source_material_id='m-pdf'", []).unwrap();
            }),
        ),
        (
            "guide title",
            Box::new(|l| {
                l.conn
                    .execute(
                        "UPDATE ai_study_sets SET title='T2' WHERE source_material_id='m-pdf'",
                        [],
                    )
                    .unwrap();
            }),
        ),
        (
            "question text",
            Box::new(|l| {
                l.conn
                    .execute(
                        "UPDATE practice_test_items SET question_text='Changed?' WHERE id='it-2'",
                        [],
                    )
                    .unwrap();
            }),
        ),
        (
            "video title",
            Box::new(|l| {
                l.conn
                    .execute(
                        "UPDATE material_video_links SET title='Other' WHERE url LIKE '%two'",
                        [],
                    )
                    .unwrap();
            }),
        ),
        (
            "file bytes",
            Box::new(|l| {
                l.replace_file("m-pdf", &pdf_bytes(5, "different"));
            }),
        ),
        (
            "picture geometry",
            Box::new(|l| {
                let moved = l.region("m-pdf", "m-pic", (2, 2, 10, 10));
                let text: String = l.conn.query_row("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id='m-pdf'", [], |r| r.get(0)).unwrap();
                let mut cards: Value = serde_json::from_str(&text).unwrap();
                cards[2]["visualRegionId"] = json!(moved);
                l.conn.execute("UPDATE ai_study_sets SET flashcards_json=?1 WHERE source_material_id='m-pdf'", [cards.to_string()]).unwrap();
            }),
        ),
        (
            "section origin only",
            Box::new(|l| {
                let text: String = l
                    .conn
                    .query_row(
                        "SELECT sections_json FROM ai_study_sets WHERE source_material_id='m-pdf'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                let mut s: Value = serde_json::from_str(&text).unwrap();
                s[0]["origin"] = json!("instructor");
                l.conn.execute("UPDATE ai_study_sets SET sections_json=?1 WHERE source_material_id='m-pdf'", [s.to_string()]).unwrap();
            }),
        ),
        (
            "card origin only",
            Box::new(|l| {
                let text: String = l.conn.query_row("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id='m-pdf'", [], |r| r.get(0)).unwrap();
                let mut c: Value = serde_json::from_str(&text).unwrap();
                c[0]["origin"] = json!("user");
                l.conn.execute("UPDATE ai_study_sets SET flashcards_json=?1 WHERE source_material_id='m-pdf'", [c.to_string()]).unwrap();
            }),
        ),
        (
            "question origin only",
            Box::new(|l| {
                l.conn
                    .execute(
                        "UPDATE practice_item_origins SET origin='instructor' WHERE item_id='it-1'",
                        [],
                    )
                    .unwrap();
            }),
        ),
    ];
    let (base_lib, _) = seeded();
    let base = revision_of_handbook(&base_lib, "base.hfdpack");
    for (label, edit) in edits {
        let (lib, _) = seeded();
        edit(&lib);
        assert_ne!(
            revision_of_handbook(&lib, "edited.hfdpack"),
            base,
            "{label}"
        );
    }
    // Provider, model and run timestamps are provenance, not content.
    let (lib, _) = seeded();
    lib.conn
        .execute(
            "UPDATE ai_study_sets SET provider='manual', model='other-model'",
            [],
        )
        .unwrap();
    lib.conn
        .execute(
            "UPDATE practice_test_versions SET provider='import', model='x'",
            [],
        )
        .unwrap();
    lib.conn
        .execute(
            "UPDATE pdf_kit_runs SET created_at='2026-12-31T23:59:59.999Z'",
            [],
        )
        .unwrap();
    assert_eq!(revision_of_handbook(&lib, "prov.hfdpack"), base);
}

#[test]
fn guide_and_practice_titles_are_in_the_revision_but_questions_keep_order() {
    let (lib, _) = seeded();
    let base = revision_of_handbook(&lib, "a.hfdpack");
    lib.conn
        .execute("UPDATE practice_test_items SET ordinal = ordinal + 10", [])
        .unwrap();
    lib.conn
        .execute("UPDATE practice_test_items SET ordinal = 11 - ordinal", [])
        .unwrap();
    assert_ne!(
        revision_of_handbook(&lib, "b.hfdpack"),
        base,
        "authored order is content"
    );
}

/* ----------------------------- rejects ----------------------------- */

fn valid_pack(lib: &Lib) -> PathBuf {
    lib.export(&["m-pdf"], "base.hfdpack").unwrap();
    lib.out("base.hfdpack")
}

fn expect_refused(path: &Path, needle: &str) {
    let error = validate_pack(path).expect_err("pack should be refused");
    assert!(
        error.contains(needle),
        "{error:?} should mention {needle:?}"
    );
}

#[test]
fn unknown_keys_are_refused_in_the_manifest_and_in_items() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let p = tampered(&lib, &base, "k1.hfdpack", |_, m| {
        m["surprise"] = json!(1);
    });
    expect_refused(&p, "damaged");
    let p = tampered(&lib, &base, "k2.hfdpack", |e, _| {
        let mut v = item_json(e, "items/1.json");
        v["surprise"] = json!(true);
        set_item_json(e, "items/1.json", &v);
    });
    expect_refused(&p, "unknown or missing field");
    let p = tampered(&lib, &base, "k3.hfdpack", |_, m| {
        m["items"][0]["file"]["surprise"] = json!(1);
    });
    expect_refused(&p, "damaged");
}

#[test]
fn duplicate_refs_missing_and_extra_entries_are_refused() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let p = tampered(&lib, &base, "d1.hfdpack", |_, m| {
        m["items"][1]["ref"] = m["items"][0]["ref"].clone();
    });
    expect_refused(&p, "repeated");
    let p = tampered(&lib, &base, "d2.hfdpack", |e, _| {
        e.retain(|(n, _)| n != "items/2.json");
    });
    expect_refused(&p, "missing");
    let p = tampered(&lib, &base, "d3.hfdpack", |e, _| {
        e.push(("files/9.pdf".into(), b"x".to_vec()));
    });
    expect_refused(&p, "unexpected file");
    let p = tampered(&lib, &base, "d4.hfdpack", |e, _| {
        e.push(("notes.txt".into(), b"x".to_vec()));
    });
    expect_refused(&p, "unexpected file");
    let p = tampered(&lib, &base, "d5.hfdpack", |_, m| {
        m["items"][1]["itemId"] = m["items"][0]["itemId"].clone();
    });
    expect_refused(&p, "repeated");
}

#[test]
fn unsafe_names_modes_and_folders_are_refused() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let long = format!("items/{}.json", "a".repeat(256));
    for (i, bad) in ["../x", "/abs", "a\\b", "C:x", long.as_str()]
        .iter()
        .enumerate()
    {
        let p = tampered(&lib, &base, &format!("n{i}.hfdpack"), |e, _| {
            e.push((bad.to_string(), b"x".to_vec()));
        });
        assert!(validate_pack(&p).is_err(), "{bad}");
    }
    let p = lib.out("symlink.hfdpack");
    {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
        zip.add_symlink(
            "files/5.pdf",
            "target",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.finish().unwrap();
    }
    expect_refused(&p, "linked file");
    let p = lib.out("dir.hfdpack");
    {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
        zip.add_directory("items/", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
    }
    expect_refused(&p, "folder");
}

#[test]
fn oversized_bombs_and_too_many_entries_are_refused() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    // A PDF one byte over 50 MiB.
    let p = lib.out("big.hfdpack");
    write_pack(
        &p,
        &[
            ("manifest.json".into(), b"{}".to_vec()),
            (
                "files/1.pdf".into(),
                vec![0u8; (MAX_PDF_BYTES + 1) as usize],
            ),
        ],
    );
    expect_refused(&p, "too large");
    // 201:1 once past the 1 MiB floor.
    let p = lib.out("bomb.hfdpack");
    let mut entries = read_pack(&base);
    entries.push(("items/77.json".into(), vec![0u8; 8 * 1024 * 1024 - 1]));
    write_pack_with(&p, &entries, |n| {
        (
            if n == "items/77.json" {
                Method::Deflated
            } else {
                Method::Stored
            },
            None,
        )
    });
    expect_refused(&p, "compression ratio");
    // 2,002 entries.
    let p = lib.out("many.hfdpack");
    let mut entries: Vec<(String, Vec<u8>)> = (1..=2000)
        .map(|n| (format!("items/{n}.json"), Vec::new()))
        .collect();
    entries.push(("manifest.json".into(), b"{}".to_vec()));
    entries.push(("files/1.pdf".into(), Vec::new()));
    assert_eq!(entries.len(), 2002);
    write_pack(&p, &entries);
    expect_refused(&p, "too many files");
}

#[test]
fn checksums_truncation_and_directory_damage_are_refused() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    // Flip a byte of the PDF without re-sealing the manifest.
    let p = lib.out("flip.hfdpack");
    let mut entries = read_pack(&base);
    let pdf = entries
        .iter_mut()
        .find(|(n, _)| n.ends_with(".pdf"))
        .unwrap();
    let last = pdf.1.len() / 2;
    pdf.1[last] ^= 0xff;
    write_pack(&p, &entries);
    expect_refused(&p, "checksum");
    // Truncated.
    let bytes = std::fs::read(&base).unwrap();
    let p = lib.out("cut.hfdpack");
    std::fs::write(&p, &bytes[..bytes.len() / 2]).unwrap();
    assert_eq!(validate_pack(&p).unwrap_err(), NOT_A_PACK);
    // Corrupt central directory.
    let mut damaged = bytes.clone();
    let at = damaged
        .windows(4)
        .rposition(|w| w == [0x50, 0x4b, 0x01, 0x02])
        .unwrap();
    damaged[at..at + 4].copy_from_slice(&[0, 0, 0, 0]);
    let p = lib.out("cd.hfdpack");
    std::fs::write(&p, damaged).unwrap();
    assert!(validate_pack(&p).is_err());
    // Not a zip at all.
    let p = lib.out("text.hfdpack");
    std::fs::write(&p, b"hello").unwrap();
    assert_eq!(validate_pack(&p).unwrap_err(), NOT_A_PACK);
}

#[test]
fn file_content_is_checked_against_the_manifest() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let p = tampered(&lib, &base, "notpdf.hfdpack", |e, _| {
        e.iter_mut().find(|(n, _)| n.ends_with(".pdf")).unwrap().1 = b"just text".to_vec();
    });
    expect_refused(&p, "PDF can't be read");
    let p = tampered(&lib, &base, "pages.hfdpack", |_, m| {
        m["items"][0]["file"]["totalPages"] = json!(4);
    });
    expect_refused(&p, "page count");
    let p = tampered(&lib, &base, "mpx.hfdpack", |e, m| {
        let png = fake_png(3000, 2000, "big");
        e.iter_mut().find(|(n, _)| n.ends_with(".png")).unwrap().1 = png;
        m["items"][1]["file"]["width"] = json!(3000);
        m["items"][1]["file"]["height"] = json!(2000);
    });
    expect_refused(&p, "picture");
    let p = tampered(&lib, &base, "size.hfdpack", |_, m| {
        m["items"][1]["file"]["width"] = json!(7);
    });
    expect_refused(&p, "picture");
}

#[test]
fn replaces_is_refused_anywhere_including_inside_a_section() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let p = tampered(&lib, &base, "r1.hfdpack", |e, _| {
        let mut v = item_json(e, "items/1.json");
        v["guide"]["sections"][0]["replaces"] = json!("old");
        set_item_json(e, "items/1.json", &v);
    });
    expect_refused(&p, "replaces");
    let p = tampered(&lib, &base, "r2.hfdpack", |e, _| {
        let mut v = item_json(e, "items/1.json");
        v["practice"]["questions"][0]["replaces"] = json!(GONE);
        set_item_json(e, "items/1.json", &v);
    });
    expect_refused(&p, "replaces");
}

#[test]
fn a_changed_item_fails_its_revision_and_counts_must_match() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let p = tampered(&lib, &base, "rev.hfdpack", |e, _| {
        let mut v = item_json(e, "items/1.json");
        v["guide"]["sourceNotes"] = json!("Sneaky edit");
        set_item_json(e, "items/1.json", &v);
    });
    expect_refused(&p, "revision");
    let p = tampered(&lib, &base, "cnt.hfdpack", |_, m| {
        m["counts"]["cards"] = json!(99);
    });
    expect_refused(&p, "counts");
}

#[test]
fn the_item_checks_refuse_bad_guides_regions_links_and_lineage() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    type Change = Box<dyn Fn(&mut Value)>;
    let cases: Vec<(&str, Change)> = vec![
        (
            "empty heading",
            Box::new(|v| {
                v["guide"]["sections"][0]["heading"] = json!("");
            }),
        ),
        (
            "bad provider",
            Box::new(|v| {
                v["guide"]["provider"] = json!("evil");
            }),
        ),
        (
            "bad origin",
            Box::new(|v| {
                v["guide"]["sections"][0]["origin"] = json!("admin");
            }),
        ),
        (
            "dangling region",
            Box::new(|v| {
                v["guide"]["flashcards"][2]["visualRegionId"] = json!("0".repeat(64));
            }),
        ),
        (
            "wrong region id",
            Box::new(|v| {
                v["visualRegions"][0]["id"] = json!("1".repeat(64));
                v["guide"]["flashcards"][2]["visualRegionId"] = json!("1".repeat(64));
            }),
        ),
        (
            "region out of bounds",
            Box::new(|v| {
                v["visualRegions"][0]["w"] = json!(99999);
            }),
        ),
        (
            "http link",
            Box::new(|v| {
                v["videos"][0]["url"] = json!("http://x.com/a");
            }),
        ),
        (
            "javascript link",
            Box::new(|v| {
                v["videos"][0]["url"] = json!("javascript:alert(1)");
            }),
        ),
        (
            "bad acs",
            Box::new(|v| {
                v["practice"]["questions"][0]["acsTasks"] = json!(["PA.ZZ.Z"]);
            }),
        ),
        (
            "two acs",
            Box::new(|v| {
                v["practice"]["questions"][0]["acsTasks"] = json!(["PA.I.A", "PA.I.B"]);
            }),
        ),
        (
            "bad correct index",
            Box::new(|v| {
                v["practice"]["questions"][0]["correctIndex"] = json!(9);
            }),
        ),
        (
            "citation sha",
            Box::new(|v| {
                v["citations"]["run"]["contentSha256"] = json!("2".repeat(64));
            }),
        ),
        (
            "citation hash",
            Box::new(|v| {
                v["citations"]["items"][0]["contentHash"] = json!("3".repeat(64));
            }),
        ),
        (
            "citation id",
            Box::new(|v| {
                v["citations"]["items"][0]["logicalId"] = json!("nope");
            }),
        ),
        (
            "card page past end",
            Box::new(|v| {
                v["guide"]["flashcards"][0]["sourcePage"] = json!(6);
            }),
        ),
        (
            "lineage on a split",
            Box::new(|v| {
                v["lineage"] = json!({"parentRef":null,"parentItemId":null,"rootRef":null,"rootItemId":null,"sourcePageStart":1,"sourcePageEnd":2,"parentPageStart":null,"parentPageEnd":null,"childPageCount":3,"sourceFileName":"a","sourceTitle":"b","sourceContentSha256":null,"sourceTotalPages":null,"parentFileName":null,"parentTitle":null,"parentContentSha256":null,"parentTotalPages":null,"nestedLevel":1});
            }),
        ),
    ];
    for (i, (label, edit)) in cases.iter().enumerate() {
        let p = tampered(&lib, &base, &format!("c{i}.hfdpack"), |e, _| {
            let mut v = item_json(e, "items/1.json");
            edit(&mut v);
            set_item_json(e, "items/1.json", &v);
        });
        let err = validate_pack(&p).expect_err(label);
        assert!(!err.contains("revision"), "{label}: {err}");
    }
}

#[test]
fn the_version_predicate_is_applied_to_whole_packs() {
    let (lib, _) = seeded();
    let base = valid_pack(&lib);
    let cases = [
        (json!(2), json!(1), NEWER_APP),
        (json!(2), json!(2), NEWER_APP),
        (json!(1), json!(2), DAMAGED),
        (json!(0), json!(0), NOT_A_PACK),
        (json!("1"), json!(1), NOT_A_PACK),
        (json!(1.5), json!(1), NOT_A_PACK),
        (json!(-1), json!(1), NOT_A_PACK),
    ];
    for (i, (pack, min, expected)) in cases.into_iter().enumerate() {
        let p = tampered(&lib, &base, &format!("v{i}.hfdpack"), |_, m| {
            m["packFormat"] = pack.clone();
            m["minReaderFormat"] = min.clone();
            m["unknownFutureKey"] = json!({"anything": true});
        });
        assert_eq!(validate_pack(&p).unwrap_err(), expected, "{i}");
    }
    let p = tampered(&lib, &base, "fmt.hfdpack", |_, m| {
        m["format"] = json!("some-other-format");
    });
    assert_eq!(validate_pack(&p).unwrap_err(), NOT_A_PACK);
    let p = tampered(&lib, &base, "miss.hfdpack", |_, m| {
        m.as_object_mut().unwrap().remove("minReaderFormat");
    });
    assert_eq!(validate_pack(&p).unwrap_err(), NOT_A_PACK);
}

#[test]
fn export_writes_nothing_but_the_namespace_and_leaves_no_temp_file() {
    let (lib, _) = seeded();
    let dump = |c: &Connection| -> String {
        let mut out = String::new();
        for table in [
            "study_materials",
            "ai_study_sets",
            "pdf_kit_runs",
            "pdf_kit_item_sources",
            "visual_card_regions",
            "material_video_links",
            "practice_test_items",
        ] {
            let mut st = c.prepare(&format!("SELECT * FROM {table}")).unwrap();
            let n = st.column_count();
            let rows = st
                .query_map([], |r| {
                    (0..n)
                        .map(|i| {
                            r.get::<_, rusqlite::types::Value>(i)
                                .map(|v| format!("{v:?}"))
                        })
                        .collect::<Result<Vec<_>, _>>()
                })
                .unwrap();
            for row in rows {
                out.push_str(&row.unwrap().join("|"));
                out.push('\n');
            }
        }
        out
    };
    let before = dump(&lib.conn);
    lib.export(&all_ids(), "x.hfdpack").unwrap();
    assert_eq!(before, dump(&lib.conn));
    let leftovers: Vec<_> = std::fs::read_dir(lib.root().join("out"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(leftovers.len(), 1, "{leftovers:?}");
    assert!(lib.export(&[], "none.hfdpack").is_err());
    assert!(lib.export(&["missing"], "none.hfdpack").is_err());
}
