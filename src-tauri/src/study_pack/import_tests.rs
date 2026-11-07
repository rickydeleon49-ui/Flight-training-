//! Stage 2 tests: the transactional import, on a populated synthetic "her"
//! library seeded with cleanup-eligible state. Every test that imports checks
//! that her pre-existing rows and files are byte-identical afterwards.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::fault;
use super::install::{self, add_study_pack_in};
use super::journal;
use super::result::PackResult;
use super::tests::*;
use crate::practice_sessions::compute_canonical_hash;

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

fn op() -> String {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    format!("{:08x}-aaaa-4aaa-8aaa-{:012x}", n, nanos & 0xffff_ffff_ffff)
}

fn count(lib: &Lib, sql: &str) -> i64 {
    lib.conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn text(lib: &Lib, sql: &str) -> String {
    lib.conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Her own library: a PDF with a guide, a practice version with an attempt in
/// progress, notes, plus state a careless writer would clean up: an orphan
/// page-source binding and an unlinked file in documents/.
fn her() -> Lib {
    let her = lib();
    let pdf = pdf_bytes(3, "hers");
    her.material("her-1", "My own handbook", Some(("hers.pdf", &pdf)));
    her.guide(
        "her-1",
        "Her summary",
        json!([{"heading": "H", "body": "B", "itemId": "her-sec"}]),
        json!([{"front": "F", "back": "B", "sourcePage": 1, "itemId": "her-card"}]),
    );
    her.practice("her-1");
    her.conn
        .execute(
            "INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title,
                 started_at, status, revision, total_questions)
             VALUES ('att-1', 'ver-1', 'her-1', 'My own handbook', ?1, 'in_progress', 0, 2)",
            [NOW],
        )
        .unwrap();
    her.conn
        .execute(
            "INSERT INTO study_page_sources (id, source_material_id, material_title, physical_page, created_at)
             VALUES ('aaaaaaaa-0000-4000-8000-0000000000aa', 'her-1', 'My own handbook', 1, ?1)",
            [NOW],
        )
        .unwrap();
    her.conn
        .execute(
            "INSERT INTO study_page_source_bindings VALUES
               ('aaaaaaaa-0000-4000-8000-0000000000aa', 'orphan-owner', 'authored_question', 'gone',
                ?1)",
            [sha(b"fp")],
        )
        .unwrap();
    std::fs::write(her.root().join("documents/stray.pdf"), b"unlinked").unwrap();
    her
}

struct Snapshot {
    rows: BTreeMap<String, Vec<String>>,
    files: BTreeMap<String, (String, u64)>,
}

const LEDGER: [&str; 3] = ["local_changes", "sync_row_meta", "sync_applied"];

fn snapshot(lib: &Lib) -> Snapshot {
    let tables: Vec<String> = lib
        .conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut rows = BTreeMap::new();
    for table in tables {
        if LEDGER.contains(&table.as_str()) {
            continue;
        }
        let mut statement = lib
            .conn
            .prepare(&format!("SELECT * FROM \"{table}\""))
            .unwrap();
        let columns = statement.column_count();
        let mut all: Vec<String> = statement
            .query_map([], |r| {
                Ok(format!(
                    "{:?}",
                    (0..columns)
                        .map(|i| r.get::<_, rusqlite::types::Value>(i).unwrap())
                        .collect::<Vec<_>>()
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        all.sort();
        rows.insert(table, all);
    }
    let mut files = BTreeMap::new();
    for entry in std::fs::read_dir(lib.root().join("documents")).unwrap() {
        let entry = entry.unwrap();
        if entry.path().is_file() {
            let meta = std::fs::symlink_metadata(entry.path()).unwrap();
            files.insert(
                entry.file_name().to_string_lossy().into_owned(),
                (
                    sha(&std::fs::read(entry.path()).unwrap()),
                    journal::file_id(&meta).unwrap().1,
                ),
            );
        }
    }
    Snapshot { rows, files }
}

/// Every row and every file that existed before is still there, unchanged.
fn assert_untouched(before: &Snapshot, lib: &Lib) {
    let after = snapshot(lib);
    for (table, old) in &before.rows {
        let now = &after.rows[table];
        for row in old {
            assert!(now.contains(row), "a row of {table} changed or vanished: {row}");
        }
    }
    for (name, old) in &before.files {
        assert_eq!(after.files.get(name), Some(old), "file {name} changed");
    }
}

fn add(her: &Lib, pack: &Path) -> Result<PackResult, String> {
    add_study_pack_in(her.root(), true, pack, &op())
}

fn pack_of(producer: &Lib, ids: &[&str], name: &str) -> PathBuf {
    producer.export(ids, name).unwrap();
    producer.out(name)
}

fn staging_left(lib: &Lib) -> bool {
    let imports = journal::imports_dir(lib.root());
    imports.is_dir()
        && std::fs::read_dir(imports)
            .unwrap()
            .filter_map(Result::ok)
            .any(|e| e.file_name() != journal::FAILED_DIR)
}

fn titles_of(lib: &Lib) -> Vec<String> {
    lib.conn
        .prepare("SELECT title FROM study_materials ORDER BY title")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn new_material(lib: &Lib, title: &str) -> String {
    text(
        lib,
        &format!("SELECT id FROM study_materials WHERE title = '{title}'"),
    )
}

/* ------------------------------------------------------------------ */
/* Happy path                                                          */
/* ------------------------------------------------------------------ */

#[test]
fn a_study_pack_is_added_field_by_field() {
    let (producer, pdf_sha) = seeded();
    let pack = pack_of(&producer, &["m-pdf", "m-guide", "m-child"], "all.hfdpack");
    let her = her();
    let before = snapshot(&her);
    let ledger_before = count(&her, "SELECT COUNT(*) FROM local_changes WHERE table_name='study_materials'");

    let result = add(&her, &pack).unwrap();
    assert_eq!(
        (
            result.added,
            result.added_guides,
            result.added_documents,
            result.added_pictures,
            result.added_practice,
            result.skipped,
            result.new_versions,
            result.readded,
            result.cards_left_out
        ),
        (4, 2, 2, 1, 0, 0, 0, 0, 0)
    );
    assert_untouched(&before, &her);
    assert!(!staging_left(&her));
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_materials"), 5);
    assert_eq!(
        count(&her, "SELECT COUNT(*) FROM local_changes WHERE table_name='study_materials'"),
        ledger_before + 4,
        "the sync ledger sees exactly the new materials"
    );

    // Materials: reset state, fresh ids, files linked and identical.
    let handbook = new_material(&her, "Handbook");
    assert_ne!(handbook, "m-pdf");
    let (status, priority, notes, path, original, size): (String, String, String, String, String, i64) = her
        .conn
        .query_row(
            "SELECT review_status, priority, notes, file_path, original_file_name, file_size
             FROM study_materials WHERE id = ?1",
            [&handbook],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .unwrap();
    assert_eq!((status.as_str(), priority.as_str(), notes.as_str()), ("needs_review", "later", ""));
    assert_eq!(original, "handbook.pdf");
    assert_eq!(path, format!("{handbook}-handbook.pdf"));
    assert_eq!(her.file_of(&handbook), producer.file_of("m-pdf"));
    assert_eq!(size as usize, producer.file_of("m-pdf").len());
    assert_eq!(her.file_of(&new_material(&her, "Panel picture")), PANEL);

    // PDF identity: written for PDFs, not for the picture.
    assert_eq!(
        text(&her, &format!("SELECT content_sha256 FROM material_content_identities WHERE material_id='{handbook}'")),
        pdf_sha
    );
    assert_eq!(count(&her, "SELECT COUNT(*) FROM material_content_identities"), 2);

    // Guide: its own title, text, fresh ids, history never copied.
    let (title, summary, origin, retired, sections, cards): (String, String, Option<String>, String, String, String) = her
        .conn
        .query_row(
            "SELECT title, summary, summary_origin, retired_json, sections_json, flashcards_json
             FROM ai_study_sets WHERE source_material_id = ?1",
            [&handbook],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .unwrap();
    assert_eq!((title.as_str(), summary.as_str(), retired.as_str()), ("Guide title", "Summary text", "[]"));
    assert_eq!(origin.as_deref(), Some("instructor"));
    let sections: Vec<Value> = serde_json::from_str(&sections).unwrap();
    let cards: Vec<Value> = serde_json::from_str(&cards).unwrap();
    assert_eq!(sections.len(), 2);
    assert_eq!(sections[0]["origin"], "user");
    assert_ne!(sections[0]["itemId"], "sec-real");
    assert_eq!(cards.len(), 3);
    assert!(cards.iter().all(|c| c["itemId"] != "card-real"));
    assert!(sections.iter().chain(&cards).all(|v| crate::study_sets::is_lower_uuid_v4(v["itemId"].as_str().unwrap())));
    assert!(sections.iter().chain(&cards).all(|v| v.get("replaces").is_none()));
    assert_eq!(cards[0]["origin"], "instructor");
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_set_history WHERE kind='study_set'"), 0);

    // Picture card: region recomputed for the new owner and the new image.
    let picture = new_material(&her, "Panel picture");
    let region_id = cards[2]["visualRegionId"].as_str().unwrap().to_string();
    let region = crate::visual_cards::read_region(&her.conn, &region_id).unwrap();
    assert_eq!(region.owner_material_id, handbook);
    assert_eq!(region.image_material_id.as_deref(), Some(picture.as_str()));
    assert_eq!(region.id, region.hash());
    assert_eq!(region.image_sha256, sha(PANEL));

    // Citations: new run, local summary id, hashes of the stored items.
    let run: String = text(&her, &format!("SELECT run_id FROM pdf_kit_runs WHERE material_id='{handbook}'"));
    assert_ne!(run, "run-real");
    assert!(crate::practice_sessions::is_uuid_v4(&run));
    assert_eq!(count(&her, &format!("SELECT COUNT(*) FROM pdf_kit_item_sources WHERE run_id='{run}'")), 4);
    assert_eq!(
        count(&her, &format!("SELECT COUNT(*) FROM pdf_kit_item_sources WHERE run_id='{run}' AND logical_id='summary:{run}'")),
        1
    );
    let hash_of = |kind: &str, logical: &str| text(&her, &format!("SELECT content_hash FROM pdf_kit_item_sources WHERE run_id='{run}' AND item_kind='{kind}' AND logical_id='{logical}'"));
    assert_eq!(hash_of("summary", &format!("summary:{run}")), summary_hash("Summary text"));
    assert_eq!(
        hash_of("card", cards[0]["itemId"].as_str().unwrap()),
        compute_canonical_hash(&crate::pdf_kit_sources::content("card", &cards[0]))
    );
    assert_eq!(
        hash_of("section", sections[0]["itemId"].as_str().unwrap()),
        compute_canonical_hash(&crate::pdf_kit_sources::content("section", &sections[0]))
    );

    // Practice: a fresh version 1 with questions, ACS tasks and origins.
    let (version, number, active, history_key): (String, i64, i64, String) = her
        .conn
        .query_row(
            "SELECT id, version_number, is_active, history_key FROM practice_test_versions WHERE source_material_id=?1",
            [&handbook],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!((number, active), (1, 1));
    assert_eq!(history_key, handbook);
    assert_eq!(count(&her, &format!("SELECT COUNT(*) FROM practice_test_items WHERE version_id='{version}' AND replaces_id IS NULL")), 2);
    assert_eq!(count(&her, &format!("SELECT COUNT(*) FROM practice_test_items WHERE version_id='{version}' AND logical_id IN ('{Q1}','{Q2}')")), 0);
    let first: String = text(&her, &format!("SELECT id FROM practice_test_items WHERE version_id='{version}' AND ordinal=0"));
    assert_eq!(text(&her, &format!("SELECT acs_task FROM practice_item_acs_tasks WHERE item_id='{first}'")), "PA.I.A");
    assert_eq!(text(&her, &format!("SELECT origin FROM practice_item_origins WHERE item_id='{first}'")), "user");
    assert_eq!(count(&her, &format!("SELECT COUNT(*) FROM practice_tests WHERE source_material_id='{handbook}'")), 1);
    assert_eq!(count(&her, &format!("SELECT COUNT(*) FROM study_set_history WHERE material_id='{handbook}'")), 0);

    // Videos and lineage.
    assert_eq!(count(&her, &format!("SELECT COUNT(*) FROM material_video_links WHERE material_id='{handbook}'")), 2);
    let child = new_material(&her, "Chapter 2");
    let (parent, root): (String, String) = her
        .conn
        .query_row("SELECT parent_material_id, root_material_id FROM material_split_lineage WHERE material_id=?1", [&child], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!((parent, root), (handbook.clone(), handbook.clone()));

    // Provenance and receipt.
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_items WHERE link='added'"), 4);
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_imports"), 1);
    assert_eq!(
        count(&her, "SELECT COUNT(*) FROM study_pack_items i JOIN study_materials m ON m.id=i.material_id"),
        4
    );
    crate::backup::verify_schema_37_study_packs(&her.conn).unwrap();
    // The same pack again changes nothing and writes no item rows.
    let again = add(&her, &pack).unwrap();
    assert_eq!((again.added, again.skipped), (0, 4));
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_items"), 4);
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_imports"), 2);
    assert_untouched(&before, &her);
    let _ = fault::CRASH;
    let _ = params![1];
    let _: Option<&Connection> = None;
    let _ = install::UNSUPPORTED;
}
