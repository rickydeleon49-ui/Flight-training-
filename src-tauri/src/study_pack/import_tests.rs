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
    her.conn
        .execute("UPDATE ai_study_sets SET retired_json='[]'", [])
        .unwrap();
    her.practice("her-1");
    let legacy = json!([
        {"question": "Q one?", "options": ["a", "b"], "correctIndex": 1, "explanation": "because", "sourcePage": 2},
        {"question": "Q two?", "options": ["a", "b"], "correctIndex": 1, "explanation": "because", "sourcePage": 2}
    ]);
    her.conn
        .execute(
            "INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model,
                 generated_at, updated_at, legacy_migrated_at, legacy_error, retired_json)
             VALUES ('her-1', 'Practice title', ?1, 'manual', 'm', ?2, ?2, ?2, NULL, '[]')",
            params![legacy.to_string(), NOW],
        )
        .unwrap();
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
            assert!(
                now.contains(row),
                "a row of {table} changed or vanished: {row}"
            );
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
    let ledger_before = count(
        &her,
        "SELECT COUNT(*) FROM local_changes WHERE table_name='study_materials'",
    );

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
        count(
            &her,
            "SELECT COUNT(*) FROM local_changes WHERE table_name='study_materials'"
        ),
        ledger_before + 4,
        "the sync ledger sees exactly the new materials"
    );

    // Materials: reset state, fresh ids, files linked and identical.
    let handbook = new_material(&her, "Handbook");
    assert_ne!(handbook, "m-pdf");
    let (status, priority, notes, path, original, size): (
        String,
        String,
        String,
        String,
        String,
        i64,
    ) = her
        .conn
        .query_row(
            "SELECT review_status, priority, notes, file_path, original_file_name, file_size
             FROM study_materials WHERE id = ?1",
            [&handbook],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        (status.as_str(), priority.as_str(), notes.as_str()),
        ("needs_review", "later", "")
    );
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
    assert_eq!(
        count(&her, "SELECT COUNT(*) FROM material_content_identities"),
        2
    );

    // Guide: its own title, text, fresh ids, history never copied.
    let (title, summary, origin, retired, sections, cards): (
        String,
        String,
        Option<String>,
        String,
        String,
        String,
    ) = her
        .conn
        .query_row(
            "SELECT title, summary, summary_origin, retired_json, sections_json, flashcards_json
             FROM ai_study_sets WHERE source_material_id = ?1",
            [&handbook],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        (title.as_str(), summary.as_str(), retired.as_str()),
        ("Guide title", "Summary text", "[]")
    );
    assert_eq!(origin.as_deref(), Some("instructor"));
    let sections: Vec<Value> = serde_json::from_str(&sections).unwrap();
    let cards: Vec<Value> = serde_json::from_str(&cards).unwrap();
    assert_eq!(sections.len(), 2);
    assert_eq!(sections[0]["origin"], "user");
    assert_ne!(sections[0]["itemId"], "sec-real");
    assert_eq!(cards.len(), 3);
    assert!(cards.iter().all(|c| c["itemId"] != "card-real"));
    assert!(sections
        .iter()
        .chain(&cards)
        .all(|v| crate::study_sets::is_lower_uuid_v4(v["itemId"].as_str().unwrap())));
    assert!(sections
        .iter()
        .chain(&cards)
        .all(|v| v.get("replaces").is_none()));
    assert_eq!(cards[0]["origin"], "instructor");
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_set_history WHERE kind='study_set'"
        ),
        0
    );

    // Picture card: region recomputed for the new owner and the new image.
    let picture = new_material(&her, "Panel picture");
    let region_id = cards[2]["visualRegionId"].as_str().unwrap().to_string();
    let region = crate::visual_cards::read_region(&her.conn, &region_id).unwrap();
    assert_eq!(region.owner_material_id, handbook);
    assert_eq!(region.image_material_id.as_deref(), Some(picture.as_str()));
    assert_eq!(region.id, region.hash());
    assert_eq!(region.image_sha256, sha(PANEL));

    // Citations: new run, local summary id, hashes of the stored items.
    let run: String = text(
        &her,
        &format!("SELECT run_id FROM pdf_kit_runs WHERE material_id='{handbook}'"),
    );
    assert_ne!(run, "run-real");
    assert!(crate::practice_sessions::is_uuid_v4(&run));
    assert_eq!(
        count(
            &her,
            &format!("SELECT COUNT(*) FROM pdf_kit_item_sources WHERE run_id='{run}'")
        ),
        4
    );
    assert_eq!(
        count(&her, &format!("SELECT COUNT(*) FROM pdf_kit_item_sources WHERE run_id='{run}' AND logical_id='summary:{run}'")),
        1
    );
    let hash_of = |kind: &str, logical: &str| {
        text(&her, &format!("SELECT content_hash FROM pdf_kit_item_sources WHERE run_id='{run}' AND item_kind='{kind}' AND logical_id='{logical}'"))
    };
    assert_eq!(
        hash_of("summary", &format!("summary:{run}")),
        summary_hash("Summary text")
    );
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
    let first: String = text(
        &her,
        &format!("SELECT id FROM practice_test_items WHERE version_id='{version}' AND ordinal=0"),
    );
    assert_eq!(
        text(
            &her,
            &format!("SELECT acs_task FROM practice_item_acs_tasks WHERE item_id='{first}'")
        ),
        "PA.I.A"
    );
    assert_eq!(
        text(
            &her,
            &format!("SELECT origin FROM practice_item_origins WHERE item_id='{first}'")
        ),
        "user"
    );
    assert_eq!(
        count(
            &her,
            &format!("SELECT COUNT(*) FROM practice_tests WHERE source_material_id='{handbook}'")
        ),
        1
    );
    assert_eq!(
        count(
            &her,
            &format!("SELECT COUNT(*) FROM study_set_history WHERE material_id='{handbook}'")
        ),
        0
    );

    // Videos and lineage.
    assert_eq!(
        count(
            &her,
            &format!("SELECT COUNT(*) FROM material_video_links WHERE material_id='{handbook}'")
        ),
        2
    );
    let child = new_material(&her, "Chapter 2");
    let (parent, root): (String, String) = her
        .conn
        .query_row("SELECT parent_material_id, root_material_id FROM material_split_lineage WHERE material_id=?1", [&child], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!((parent, root), (handbook.clone(), handbook.clone()));

    // Provenance and receipt.
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_pack_items WHERE link='added'"
        ),
        4
    );
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_imports"), 1);
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_pack_items i JOIN study_materials m ON m.id=i.material_id"
        ),
        4
    );
    crate::backup::verify_schema_37_study_packs(&her.conn).unwrap();
    // The same pack again changes nothing and writes no item rows.
    let again = add(&her, &pack).unwrap();
    assert_eq!((again.added, again.skipped), (0, 4));
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_items"), 4);
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_imports"), 2);
    assert_untouched(&before, &her);
}

/* ------------------------------------------------------------------ */
/* Dedup: revisions, second copies, tombstones                         */
/* ------------------------------------------------------------------ */

/// The producer's guide-only item under a given title: a new title is a new
/// revision of the same identity.
fn revision_pack(producer: &Lib, title: &str) -> PathBuf {
    producer
        .conn
        .execute(
            "UPDATE study_materials SET title=?1 WHERE id='m-guide'",
            [title],
        )
        .unwrap();
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let name = format!(
        "rev-{}.hfdpack",
        N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    );
    pack_of(producer, &["m-guide"], &name)
}

fn date_suffix(pack: &Path) -> String {
    super::titles::suffix(
        &super::validate::validate_pack(pack)
            .unwrap()
            .manifest
            .created_at,
    )
}

fn item_rows(lib: &Lib) -> i64 {
    count(lib, "SELECT COUNT(*) FROM study_pack_items")
}

fn delete_material(lib: &Lib, title: &str) {
    lib.conn
        .execute("DELETE FROM study_materials WHERE title=?1", [title])
        .unwrap();
}

#[test]
fn another_version_is_added_beside_hers_and_never_touches_hers() {
    let (producer, _) = seeded();
    let her = her();
    let r1 = revision_pack(&producer, "Notes");
    assert_eq!(add(&her, &r1).unwrap().added, 1);
    // She edits her copy; revisions are pack content, not hers.
    her.conn
        .execute("UPDATE ai_study_sets SET summary='Mine now' WHERE source_material_id=(SELECT id FROM study_materials WHERE title='Notes')", [])
        .unwrap();
    let again = add(&her, &r1).unwrap();
    assert_eq!(
        (again.added, again.skipped),
        (0, 1),
        "edited copy: same revision is skipped"
    );
    assert_eq!(text(&her, "SELECT summary FROM ai_study_sets WHERE source_material_id=(SELECT id FROM study_materials WHERE title='Notes')"), "Mine now");

    let before = snapshot(&her);
    let rows_before = item_rows(&her);
    let r2 = revision_pack(&producer, "Notes, revised");
    let result = add(&her, &r2).unwrap();
    assert_eq!(
        (result.added, result.new_versions, result.readded),
        (1, 1, 0)
    );
    let suffix = date_suffix(&r2);
    assert_untouched(&before, &her);
    assert_eq!(item_rows(&her), rows_before + 1);
    let copy = new_material(&her, &format!("Notes, revised{suffix}"));
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM ai_study_sets WHERE source_material_id='{copy}'")
        ),
        format!("Guide title{suffix}"),
        "the guide title carries the suffix too"
    );
    // The same pack again adds nothing; a third revision is a third copy.
    let again = add(&her, &r2).unwrap();
    assert_eq!((again.added, again.skipped), (0, 1));
    let r3 = revision_pack(&producer, "Notes, third");
    assert_eq!(add(&her, &r3).unwrap().new_versions, 1);
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_materials WHERE title LIKE 'Notes%'"
        ),
        3
    );
    assert_untouched(&before, &her);
}

#[test]
fn a_deleted_copy_comes_back_as_another_version_while_the_other_is_live() {
    let (producer, _) = seeded();
    let her = her();
    let r1 = revision_pack(&producer, "Notes");
    let r2 = revision_pack(&producer, "Notes v2");
    add(&her, &r1).unwrap();
    add(&her, &r2).unwrap();
    // Delete R2 keeping R1, re-import R2: row 3 (new_versions), not row 4.
    delete_material(&her, &format!("Notes v2{}", date_suffix(&r2)));
    let result = add(&her, &r2).unwrap();
    assert_eq!(
        (result.added, result.new_versions, result.readded),
        (1, 1, 0)
    );
    // Delete R1 keeping R2, then the R1 pack: row 3 with the R1 pack's suffix.
    delete_material(&her, "Notes");
    let result = add(&her, &r1).unwrap();
    assert_eq!(
        (result.added, result.new_versions, result.readded),
        (1, 1, 0)
    );
    assert_eq!(
        count(
            &her,
            &format!(
                "SELECT COUNT(*) FROM study_materials WHERE title='Notes{}'",
                date_suffix(&r1)
            )
        ),
        1
    );
}

#[test]
fn deleting_every_copy_means_added_back_without_a_suffix() {
    let (producer, _) = seeded();
    let her = her();
    let r1 = revision_pack(&producer, "Notes");
    add(&her, &r1).unwrap();
    delete_material(&her, "Notes");
    let tombstones = count(
        &her,
        "SELECT COUNT(*) FROM study_pack_items WHERE material_id IS NULL",
    );
    assert_eq!(tombstones, 1);
    let result = add(&her, &r1).unwrap();
    assert_eq!(
        (result.added, result.new_versions, result.readded),
        (1, 0, 1)
    );
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_materials WHERE title='Notes'"
        ),
        1
    );
    assert_eq!(
        item_rows(&her),
        2,
        "a new row; the old tombstone row is unchanged"
    );
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_pack_items WHERE material_id IS NULL"
        ),
        1
    );
    crate::backup::verify_schema_37_study_packs(&her.conn).unwrap();
}

#[test]
fn an_older_pack_after_a_newer_one_is_another_version_never_newer() {
    let (producer, _) = seeded();
    let her = her();
    let r1 = revision_pack(&producer, "Notes");
    let r2 = revision_pack(&producer, "Notes later");
    add(&her, &r2).unwrap();
    let result = add(&her, &r1).unwrap();
    assert_eq!((result.new_versions, result.readded), (1, 0));
    for line in [1, 2].map(|n| super::result::other_versions_line(n).unwrap()) {
        assert!(!line.to_lowercase().contains("newer"), "{line}");
        assert!(line.contains("another version") || line.contains("other versions"));
    }
    assert_eq!(super::result::other_versions_line(0), None);
}

#[test]
fn cross_namespace_aliases_never_pile_up_and_copies_follow_the_rules() {
    let (a, _) = seeded();
    let (b, _) = seeded();
    let her = her();
    let a1 = revision_pack(&a, "Notes");
    let b1 = revision_pack(&b, "Notes");
    let b2 = revision_pack(&b, "Notes B2");
    let a2 = revision_pack(&a, "Notes B2");
    assert_eq!(add(&her, &a1).unwrap().added, 1); // A(R1) added M
    let alias = add(&her, &b1).unwrap();
    assert_eq!((alias.added, alias.skipped), (0, 1)); // B(R1) alias of M
    assert_eq!(item_rows(&her), 2);
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_pack_items WHERE link='alias'"
        ),
        1
    );
    let m2 = add(&her, &b2).unwrap(); // B(R2) -> row 3, copy M2
    assert_eq!((m2.added, m2.new_versions), (1, 1));
    let a2r = add(&her, &a2).unwrap(); // A(R2) aliases M2: no third copy
    assert_eq!((a2r.added, a2r.skipped), (0, 1));
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_materials WHERE title LIKE 'Notes%'"
        ),
        2
    );
    // Three imports of B(R1) alias M: still exactly one B row for it.
    for _ in 0..3 {
        add(&her, &b1).unwrap();
    }
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_items WHERE link='alias' AND revision=(SELECT revision FROM study_pack_items WHERE link='added' ORDER BY imported_at LIMIT 1)"), 1);
    // Delete M: A(R1) and B(R1) rows are tombstones; both stay live via M2.
    delete_material(&her, "Notes");
    let a1_again = add(&her, &a1).unwrap(); // row 3: copy M' with suffix
    assert_eq!(
        (a1_again.added, a1_again.new_versions, a1_again.readded),
        (1, 1, 0)
    );
    let b1_again = add(&her, &b1).unwrap(); // B(R1) aliases M'
    assert_eq!((b1_again.added, b1_again.skipped), (0, 1));
    let rows = item_rows(&her);
    add(&her, &b1).unwrap(); // B(R1) again: no row
    assert_eq!(item_rows(&her), rows);
}

#[test]
fn same_content_in_a_new_namespace_is_an_alias() {
    let (a, _) = seeded();
    let (b, _) = seeded();
    let her = her();
    add(&her, &revision_pack(&a, "Notes")).unwrap();
    let result = add(&her, &revision_pack(&b, "Notes")).unwrap();
    assert_eq!((result.added, result.skipped), (0, 1));
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_materials WHERE title='Notes'"
        ),
        1
    );
}

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */

/// A producer with a PDF whose guide has one plain card and one picture
/// card, and the picture itself.
fn pic_producer() -> Lib {
    let p = lib();
    p.material(
        "m-pdf",
        "Handbook",
        Some(("handbook.pdf", &pdf_bytes(4, "pic"))),
    );
    p.material("m-pic", "Panel picture", Some(("panel.png", PANEL)));
    let region = p.region("m-pdf", "m-pic", (1, 1, 10, 10));
    p.guide(
        "m-pdf",
        "Summary",
        json!([{"heading": "Intro", "body": "Body"}]),
        json!([
            {"front": "Plain", "back": "Card", "sourcePage": 1},
            {"front": "Pic", "back": "Look", "sourcePage": null, "visualRegionId": region}
        ]),
    );
    p
}

/// Give the producer a picture with other bytes (and a matching card region).
fn swap_picture(p: &Lib, bytes: &[u8]) {
    p.replace_file("m-pic", bytes);
    p.conn
        .execute("DELETE FROM visual_card_regions", [])
        .unwrap();
    let region = p.region("m-pdf", "m-pic", (1, 1, 10, 10));
    let cards = json!([
        {"front": "Plain", "back": "Card", "sourcePage": 1},
        {"front": "Pic", "back": "Look", "sourcePage": null, "visualRegionId": region}
    ]);
    p.conn
        .execute(
            "UPDATE ai_study_sets SET flashcards_json=?1 WHERE source_material_id='m-pdf'",
            [cards.to_string()],
        )
        .unwrap();
}

fn rename(p: &Lib, id: &str, title: &str) {
    p.conn
        .execute(
            "UPDATE study_materials SET title=?1 WHERE id=?2",
            params![title, id],
        )
        .unwrap();
}

fn pic_pack(p: &Lib, name: &str) -> PathBuf {
    pack_of(p, &["m-pic"], name)
}

fn live_pictures(lib: &Lib) -> i64 {
    count(
        lib,
        "SELECT COUNT(*) FROM study_materials WHERE file_path LIKE '%.png'",
    )
}

#[test]
fn a_picture_with_the_same_bytes_under_the_same_identity_is_reused_with_one_alias_row() {
    let p = pic_producer();
    let her = her();
    let r1 = pic_pack(&p, "r1.hfdpack");
    assert_eq!(add(&her, &r1).unwrap().added_pictures, 1);
    let before = snapshot(&her);
    rename(&p, "m-pic", "Panel, renamed");
    let r2 = pic_pack(&p, "r2.hfdpack");
    let result = add(&her, &r2).unwrap();
    assert_eq!(
        (result.added, result.skipped, result.added_pictures),
        (0, 1, 0)
    );
    assert_eq!(live_pictures(&her), 1, "reused, not added again");
    assert_eq!(item_rows(&her), 2, "one new alias row");
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_pack_items WHERE link='alias' AND kind='picture'"
        ),
        1
    );
    assert_untouched(&before, &her);
    // R2 again hits L1: no pile-up.
    let again = add(&her, &r2).unwrap();
    assert_eq!((again.added, again.skipped), (0, 1));
    assert_eq!(item_rows(&her), 2);
}

#[test]
fn a_guide_uses_the_picture_she_already_has() {
    let p = pic_producer();
    let her = her();
    add(&her, &pic_pack(&p, "pic.hfdpack")).unwrap();
    let picture = new_material(&her, "Panel picture");
    let result = add(&her, &pack_of(&p, &["m-pdf"], "guide.hfdpack")).unwrap();
    assert_eq!(
        (result.added, result.added_pictures, result.skipped),
        (1, 0, 1)
    );
    assert_eq!(live_pictures(&her), 1);
    let handbook = new_material(&her, "Handbook");
    let image: String = text(
        &her,
        &format!("SELECT image_material_id FROM visual_card_regions WHERE owner_material_id='{handbook}'"),
    );
    assert_eq!(image, picture);
}

#[test]
fn a_removed_picture_stays_removed_and_its_cards_are_left_out_and_counted() {
    let p = pic_producer();
    let her = her();
    let pack = pack_of(&p, &["m-pdf"], "all.hfdpack");
    assert_eq!(add(&her, &pack).unwrap().added, 2);
    delete_material(&her, "Panel picture");
    delete_material(&her, "Handbook");
    assert_eq!(live_pictures(&her), 0);
    let result = add(&her, &pack).unwrap();
    assert_eq!(
        (result.added, result.readded, result.added_pictures),
        (1, 1, 0)
    );
    assert_eq!(
        (result.cards_left_out, result.cards_left_out_removed),
        (1, 1)
    );
    assert_eq!(live_pictures(&her), 0, "the picture was not added back");
    let handbook = new_material(&her, "Handbook");
    let cards: Vec<Value> = serde_json::from_str(&text(
        &her,
        &format!("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id='{handbook}'"),
    ))
    .unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(
        count(
            &her,
            &format!(
                "SELECT COUNT(*) FROM visual_card_regions WHERE owner_material_id='{handbook}'"
            )
        ),
        0,
        "no unused region"
    );
    crate::backup::verify_schema_37_study_packs(&her.conn).unwrap();
}

#[test]
fn a_deleted_second_copy_of_a_picture_is_not_re_added() {
    let p = pic_producer();
    let her = her();
    add(&her, &pic_pack(&p, "r1.hfdpack")).unwrap();
    swap_picture(&p, &fake_png(20, 20, "v2"));
    rename(&p, "m-pic", "Panel v2");
    let r2 = pic_pack(&p, "r2.hfdpack");
    let result = add(&her, &r2).unwrap();
    assert_eq!(
        (result.added, result.added_pictures, result.new_versions),
        (1, 1, 0)
    );
    assert_eq!(live_pictures(&her), 2);
    delete_material(&her, &format!("Panel v2{}", date_suffix(&r2)));
    let again = add(&her, &r2).unwrap();
    assert_eq!((again.added, again.skipped), (0, 1), "P3, not P4");
    assert_eq!(live_pictures(&her), 1);
    assert_eq!(item_rows(&her), 2, "no row for a removed picture");
}

#[test]
fn identical_bytes_under_a_new_namespace_after_she_deleted_it_are_not_re_added() {
    let a = pic_producer();
    let b = pic_producer();
    let her = her();
    add(&her, &pic_pack(&a, "a.hfdpack")).unwrap();
    delete_material(&her, "Panel picture");
    rename(&b, "m-pic", "Another title");
    let result = add(&her, &pic_pack(&b, "b.hfdpack")).unwrap();
    assert_eq!((result.added, result.skipped), (0, 1));
    assert_eq!(live_pictures(&her), 0);
    assert_eq!(item_rows(&her), 1);
}

#[test]
fn two_items_with_the_same_tombstoned_picture_are_both_removed_and_write_no_rows() {
    let p = pic_producer();
    p.material("m-pic2", "Panel picture", Some(("panel2.png", PANEL)));
    let her = her();
    // Fresh library: one picture added, its twin aliased.
    let both = pack_of(&p, &["m-pic", "m-pic2"], "both.hfdpack");
    let first = add(&her, &both).unwrap();
    assert_eq!(
        (first.added, first.skipped),
        (1, 1),
        "one added and one alias"
    );
    assert_eq!(item_rows(&her), 2);
    delete_material(&her, "Panel picture");
    let rows = item_rows(&her);
    let second = add(&her, &both).unwrap();
    assert_eq!((second.added, second.skipped), (0, 2));
    assert_eq!(item_rows(&her), rows);
    assert_eq!(live_pictures(&her), 0);
}

#[test]
fn a_live_picture_with_the_same_bytes_but_another_title_is_reused() {
    let a = pic_producer();
    let b = pic_producer();
    let her = her();
    add(&her, &pic_pack(&a, "a.hfdpack")).unwrap();
    rename(&b, "m-pic", "Retitled");
    let result = add(&her, &pic_pack(&b, "b.hfdpack")).unwrap();
    assert_eq!((result.added, result.skipped), (0, 1));
    assert_eq!(live_pictures(&her), 1);
}

#[test]
fn a_changed_picture_with_a_new_guide_copy_adds_a_new_picture_and_leaves_hers() {
    let p = pic_producer();
    let her = her();
    let r1 = pack_of(&p, &["m-pdf"], "r1.hfdpack");
    add(&her, &r1).unwrap();
    let before = snapshot(&her);
    swap_picture(&p, &fake_png(30, 30, "v2"));
    rename(&p, "m-pdf", "Handbook v2");
    let r2 = pack_of(&p, &["m-pdf"], "r2.hfdpack");
    let result = add(&her, &r2).unwrap();
    assert_eq!(
        (result.added, result.added_pictures, result.new_versions),
        (2, 1, 1)
    );
    assert_untouched(&before, &her);
    assert_eq!(live_pictures(&her), 2);
    let suffix = date_suffix(&r2);
    let copy = new_material(&her, &format!("Handbook v2{suffix}"));
    let image: String = text(
        &her,
        &format!(
            "SELECT image_material_id FROM visual_card_regions WHERE owner_material_id='{copy}'"
        ),
    );
    assert_eq!(
        her.file_of(&image),
        fake_png(30, 30, "v2"),
        "the new copy uses the new picture"
    );
}

#[test]
fn a_picture_over_the_card_limit_or_with_other_bytes_leaves_those_cards_out() {
    let p = pic_producer();
    let her = her();
    add(&her, &pic_pack(&p, "pic.hfdpack")).unwrap();
    let picture = new_material(&her, "Panel picture");
    // Her library already uses that picture on 20 cards.
    let mut cards = Vec::new();
    for i in 0..20 {
        let region = her.region("her-1", &picture, (i, 0, 5, 5));
        cards.push(json!({"front": format!("f{i}"), "back": "b", "sourcePage": null, "itemId": format!("pc-{i}"), "visualRegionId": region}));
    }
    her.conn
        .execute(
            "UPDATE ai_study_sets SET flashcards_json=?1 WHERE source_material_id='her-1'",
            [Value::Array(cards).to_string()],
        )
        .unwrap();
    let guide = pack_of(&p, &["m-pdf"], "guide.hfdpack");
    let result = add(&her, &guide).unwrap();
    assert_eq!(
        (result.cards_left_out, result.cards_left_out_removed),
        (1, 0)
    );

    // A picture whose file no longer has the bytes: left out too.
    let her2 = her_with_picture(&p);
    let picture2 = new_material(&her2, "Panel picture");
    her2.replace_file(&picture2, &fake_png(12, 12, "other"));
    let result = add(&her2, &guide).unwrap();
    assert_eq!(
        (result.cards_left_out, result.cards_left_out_removed),
        (1, 0)
    );
    // A missing file is unusable.
    let her3 = her_with_picture(&p);
    let picture3 = new_material(&her3, "Panel picture");
    let rel = text(
        &her3,
        &format!("SELECT file_path FROM study_materials WHERE id='{picture3}'"),
    );
    std::fs::remove_file(her3.root().join("documents").join(rel)).unwrap();
    let result = add(&her3, &guide).unwrap();
    assert_eq!(result.cards_left_out, 1);
    let handbook = new_material(&her3, "Handbook");
    assert_eq!(
        count(
            &her3,
            &format!(
                "SELECT COUNT(*) FROM visual_card_regions WHERE owner_material_id='{handbook}'"
            )
        ),
        0
    );
}

fn her_with_picture(p: &Lib) -> Lib {
    let her = her();
    add(&her, &pic_pack(p, "pic.hfdpack")).unwrap();
    her
}

/* ------------------------------------------------------------------ */
/* Titles, counts, lookup branches                                     */
/* ------------------------------------------------------------------ */

#[test]
fn titles_are_normalized_and_blank_guide_and_practice_titles_stay_blank() {
    let p = lib();
    p.material(
        "m-1",
        "  Padded \t  title  ",
        Some(("a.pdf", &pdf_bytes(2, "t"))),
    );
    p.guide("m-1", "S", json!([]), json!([]));
    p.practice("m-1");
    p.conn
        .execute("UPDATE ai_study_sets SET title='   '", [])
        .unwrap();
    p.conn
        .execute("UPDATE practice_test_versions SET title=' \t '", [])
        .unwrap();
    let her = her();
    // Row 5: normalized, never suffixed; blank titles stored as "".
    let r1 = pack_of(&p, &["m-1"], "r1.hfdpack");
    add(&her, &r1).unwrap();
    let id = new_material(&her, "Padded title");
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM ai_study_sets WHERE source_material_id='{id}'")
        ),
        ""
    );
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM practice_test_versions WHERE source_material_id='{id}'")
        ),
        ""
    );
    // Row 3: the material title gets the suffix, the blank ones do not.
    rename(&p, "m-1", "Padded title again");
    let r2 = pack_of(&p, &["m-1"], "r2.hfdpack");
    assert_eq!(add(&her, &r2).unwrap().new_versions, 1);
    let copy = new_material(&her, &format!("Padded title again{}", date_suffix(&r2)));
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM ai_study_sets WHERE source_material_id='{copy}'")
        ),
        ""
    );
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM practice_test_versions WHERE source_material_id='{copy}'")
        ),
        ""
    );
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM practice_tests WHERE source_material_id='{copy}'")
        ),
        ""
    );
    crate::backup::verify_application_connection(&her.conn).unwrap();
}

#[test]
fn a_second_copy_of_a_practice_set_carries_the_suffix_on_its_title() {
    let (producer, _) = seeded();
    let her = her();
    let r1 = pack_of(&producer, &["m-pdf"], "r1.hfdpack");
    add(&her, &r1).unwrap();
    producer
        .conn
        .execute(
            "UPDATE study_materials SET title='Handbook 2' WHERE id='m-pdf'",
            [],
        )
        .unwrap();
    let r2 = pack_of(&producer, &["m-pdf"], "r2.hfdpack");
    let result = add(&her, &r2).unwrap();
    assert_eq!(result.new_versions, 1);
    let suffix = date_suffix(&r2);
    let copy = new_material(&her, &format!("Handbook 2{suffix}"));
    assert_eq!(
        text(
            &her,
            &format!("SELECT title FROM practice_test_versions WHERE source_material_id='{copy}'")
        ),
        format!("Practice title{suffix}")
    );
}

#[test]
fn receipt_counts_for_each_kind_of_pack() {
    let p = lib();
    p.material("m-prac", "Practice only", None);
    p.practice("m-prac");
    let pdf = pdf_bytes(2, "x");
    p.material("m-doc", "PDF only", Some(("d.pdf", &pdf)));
    p.material(
        "m-both",
        "Guide and PDF",
        Some(("b.pdf", &pdf_bytes(2, "y"))),
    );
    p.guide("m-both", "S", json!([]), json!([]));
    p.material("m-pic", "A picture", Some(("p.png", PANEL)));
    let her = her();
    let counts = |r: &PackResult| {
        (
            r.added,
            r.added_guides,
            r.added_documents,
            r.added_pictures,
            r.added_practice,
            r.skipped,
        )
    };
    let practice = pack_of(&p, &["m-prac"], "prac.hfdpack");
    let r = add(&her, &practice).unwrap();
    assert_eq!(counts(&r), (1, 0, 0, 0, 1, 0));
    assert_eq!(
        super::result::success_sentence(&r),
        "Added 1 practice set. Your own work wasn't changed."
    );
    let r = add(&her, &pack_of(&p, &["m-both"], "both.hfdpack")).unwrap();
    assert_eq!(counts(&r), (1, 1, 1, 0, 0, 0));
    let r = add(&her, &pack_of(&p, &["m-doc"], "doc.hfdpack")).unwrap();
    assert_eq!(counts(&r), (1, 0, 1, 0, 0, 0));
    assert_eq!(
        super::result::success_sentence(&r),
        "Added 1 PDF. Your own work wasn't changed."
    );
    let r = add(&her, &pack_of(&p, &["m-pic"], "pic.hfdpack")).unwrap();
    assert_eq!(counts(&r), (1, 0, 0, 1, 0, 0));
    assert_eq!(
        super::result::success_sentence(&r),
        "Your study pack was added. Your own work wasn't changed."
    );
    let r = add(&her, &practice).unwrap();
    assert_eq!(counts(&r), (0, 0, 0, 0, 0, 1));
    assert_eq!(
        super::result::success_sentence(&r),
        "Everything in this study pack is already in your library."
    );
    crate::backup::verify_schema_37_study_packs(&her.conn).unwrap();
    let eleven = PackResult {
        added: 15,
        added_guides: 11,
        added_documents: 3,
        added_practice: 1,
        ..r
    };
    assert_eq!(
        super::result::success_sentence(&eleven),
        "Added 11 guides, 3 PDFs and 1 practice set. Your own work wasn't changed."
    );
}

fn seed_extra_row(
    lib: &Lib,
    op: &str,
    namespace: &str,
    item: &str,
    rev: &str,
    material: &str,
    at: &str,
) {
    lib.conn
        .execute(
            "INSERT INTO study_pack_imports VALUES (?1, ?2, ?3, 1, 0,0,0,0,0,0,0,0,0,0, ?4)",
            params![
                op,
                "11111111-1111-4111-8111-111111111111",
                "a".repeat(64),
                at
            ],
        )
        .unwrap();
    lib.conn
        .execute(
            "INSERT INTO study_pack_items VALUES (?1, ?2, ?3, 'document', ?4, ?5, 'alias', ?6, ?7)",
            params![namespace, item, rev, "b".repeat(64), material, op, at],
        )
        .unwrap();
}

#[test]
fn the_oldest_live_link_of_an_identity_and_revision_is_the_one_used() {
    let (producer, _) = seeded();
    let pair = pack_of(&producer, &["m-pdf", "m-child"], "pc.hfdpack");
    let pack = super::validate::validate_pack(&pair).unwrap();
    let parent = pack
        .items
        .iter()
        .find(|i| i.json.title == "Handbook")
        .unwrap()
        .manifest
        .clone();
    // (rival imported later, rival operation id, rival expected to win)
    for (later, rival_op, rival_wins) in [
        (true, "ffffffff-ffff-4fff-8fff-ffffffffffff", false),
        (false, "00000000-0000-4000-8000-000000000000", true),
        (false, "ffffffff-ffff-4fff-8fff-ffffffffffff", false),
    ] {
        let her = her();
        add(&her, &pair).unwrap();
        let first = new_material(&her, "Handbook");
        her.material("rival", "Rival copy", None);
        let first_at: String = text(&her, "SELECT imported_at FROM study_pack_items WHERE kind='document' ORDER BY imported_at LIMIT 1");
        let at = if later {
            "2999-01-01T00:00:00.000Z".to_string()
        } else {
            first_at
        };
        seed_extra_row(
            &her,
            rival_op,
            &pack.manifest.namespace,
            &parent.item_id,
            &parent.revision,
            "rival",
            &at,
        );
        // Delete only the child; the pair again: the parent skips through L1 and
        // the child (all copies gone) is added back, with that parent.
        delete_material(&her, "Chapter 2");
        let result = add(&her, &pair).unwrap();
        assert_eq!((result.added, result.readded), (1, 1));
        let linked: String = text(
            &her,
            "SELECT parent_material_id FROM material_split_lineage",
        );
        assert_eq!(
            linked,
            if rival_wins {
                "rival".to_string()
            } else {
                first
            }
        );
    }
}

#[test]
fn lineage_resolves_through_the_outcome_map_in_either_manifest_order() {
    // Two PDFs with the same content under two ids: the second is an alias of
    // the first (row 2). A chapter whose parent is the *second* resolves to
    // the first's planned material, with the child listed first or last.
    let p = lib();
    let pdf = pdf_bytes(5, "dup");
    p.material("dup-a", "Same", Some(("same.pdf", &pdf)));
    p.material("dup-b", "Same", Some(("same.pdf", &pdf)));
    p.material("chap", "Chapter", Some(("chap.pdf", &pdf_bytes(3, "chap"))));
    p.conn
        .execute(
            "INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id,
                 source_page_start, source_page_end, child_page_count, source_file_name, source_title,
                 source_content_sha256, source_total_pages, nested_level, created_at)
             VALUES ('chap','dup-b','dup-b',2,4,3,'same.pdf','Same',?1,5,1,?2)",
            params![sha(&pdf), NOW],
        )
        .unwrap();
    for (order, name) in [
        (["chap", "dup-a", "dup-b"], "first.hfdpack"),
        (["dup-a", "dup-b", "chap"], "last.hfdpack"),
    ] {
        let her = her();
        let result = add(&her, &pack_of(&p, &order, name)).unwrap();
        assert_eq!((result.added, result.skipped), (2, 1));
        let same = new_material(&her, "Same");
        let parent: String = text(
            &her,
            "SELECT parent_material_id FROM material_split_lineage",
        );
        assert_eq!(parent, same, "alias resolves to the earlier planned item");
        assert_eq!(
            count(
                &her,
                "SELECT COUNT(*) FROM study_pack_items WHERE link='alias'"
            ),
            1
        );
    }
}

#[test]
fn an_outside_parent_resolves_to_the_newest_live_copy_or_to_nothing() {
    let (producer, _) = seeded();
    let child_only = pack_of(&producer, &["m-child"], "child.hfdpack");
    // No live row for the parent: NULL.
    let her1 = her();
    add(&her1, &child_only).unwrap();
    assert_eq!(count(&her1, "SELECT COUNT(*) FROM material_split_lineage WHERE parent_material_id IS NULL AND root_material_id IS NULL"), 1);
    // Several live rows with different revisions: current() = newest.
    let her2 = her();
    add(&her2, &pack_of(&producer, &["m-pdf"], "r1.hfdpack")).unwrap();
    producer
        .conn
        .execute(
            "UPDATE study_materials SET title='Handbook 2' WHERE id='m-pdf'",
            [],
        )
        .unwrap();
    let r2 = pack_of(&producer, &["m-pdf"], "r2.hfdpack");
    add(&her2, &r2).unwrap();
    add(&her2, &child_only).unwrap();
    let newest = new_material(&her2, &format!("Handbook 2{}", date_suffix(&r2)));
    assert_eq!(
        text(
            &her2,
            "SELECT parent_material_id FROM material_split_lineage"
        ),
        newest
    );
}

/* ------------------------------------------------------------------ */
/* I1g: the insert-only guard                                          */
/* ------------------------------------------------------------------ */

use super::guard;

fn guarded(her: &Lib) -> Connection {
    let conn = super::commit::open_commit_connection(her.root()).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    guard::install(&conn).unwrap();
    conn
}

#[test]
fn the_guard_covers_exactly_the_real_tables_and_works_with_autoincrement_tables() {
    let her = her();
    let conn = guarded(&her);
    let tables = guard::guarded_tables(&conn).unwrap();
    assert!(!tables.iter().any(|t| t.starts_with("sqlite_")));
    assert!(!tables
        .iter()
        .any(|t| guard::EXCLUDED_TABLES.contains(&t.as_str())));
    assert!(tables.contains(&"study_materials".to_string()));
    // sqlite_sequence exists (local_changes is AUTOINCREMENT) and has no trigger.
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM sqlite_master WHERE name='sqlite_sequence'"
        ),
        1
    );
    let expected: i64 = guard::guarded_tables(&conn).unwrap().len() as i64 * 2;
    let triggers: i64 = conn
        .query_row("SELECT COUNT(*) FROM temp.sqlite_master WHERE type='trigger' AND name LIKE 'pack_i1_%'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(triggers, expected);
    let mut real: Vec<String> = her
        .conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .filter(|n: &String| !guard::EXCLUDED_TABLES.contains(&n.as_str()))
        .collect();
    real.sort();
    let mut seen = tables.clone();
    seen.sort();
    assert_eq!(seen, real);
    conn.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn every_writer_that_changes_one_of_her_rows_aborts_with_pack_i1() {
    let her = her();
    let before = snapshot(&her);
    for sql in [
        "UPDATE study_materials SET title='x' WHERE id='her-1'",
        "DELETE FROM study_materials WHERE id='her-1'",
        "INSERT OR REPLACE INTO study_materials (id, title, created_at, updated_at) VALUES ('her-1','x','a','b')",
        "REPLACE INTO study_materials (id, title, created_at, updated_at) VALUES ('her-1','x','a','b')",
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('her-1','x','a','b')
           ON CONFLICT(id) DO UPDATE SET title='x'",
    ] {
        let conn = guarded(&her);
        let error = conn.execute(sql, []).unwrap_err().to_string();
        assert!(error.contains("PACK_I1") || error.contains("UNIQUE"), "{sql}: {error}");
        if !sql.starts_with("INSERT INTO") {
            assert!(error.contains("PACK_I1"), "{sql}: {error}");
        }
        conn.execute_batch("ROLLBACK").unwrap();
    }
    assert_untouched(&before, &her);
}

#[test]
fn recursive_triggers_are_what_makes_a_replace_visible_to_the_guard() {
    for (recursive, bypassed) in [(false, true), (true, false)] {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
             INSERT INTO t VALUES (1, 'hers');
             CREATE TEMP TRIGGER g BEFORE DELETE ON main.t BEGIN SELECT RAISE(ABORT,'PACK_I1'); END;",
        )
        .unwrap();
        conn.pragma_update(None, "recursive_triggers", recursive)
            .unwrap();
        let outcome = conn.execute("INSERT OR REPLACE INTO t VALUES (1, 'new')", []);
        assert_eq!(outcome.is_ok(), bypassed, "recursive_triggers={recursive}");
    }
}

#[test]
fn pack_sql_accepts_inserts_and_selects_and_refuses_everything_else() {
    for ok in [
        "INSERT INTO t (a) VALUES (1)",
        "  insert   into t(a)\n values (1);",
        "SELECT updated_at FROM t WHERE x = 1 -- a note",
        "INSERT INTO t SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM u)",
    ] {
        assert!(guard::pack_sql(ok).is_ok(), "{ok}");
    }
    for bad in [
        "INSERT OR REPLACE INTO t VALUES (1)",
        "insert or replace into t values (1)",
        "REPLACE INTO t VALUES (1)",
        "INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING",
        "INSERT INTO t VALUES (1) on conflict(a) do update set a=2",
        "UPDATE t SET a=1",
        "DELETE FROM t",
        "PRAGMA foreign_keys=OFF",
        "/* hidden */ UPDATE t SET a = 1",
        "SELECT 1; DROP TABLE t",
        "-- note\nDELETE FROM t",
        "INSERT INTO t SELECT 1 WHERE (SELECT replace('a','a','b'))",
        "DROP TABLE t",
        "",
    ] {
        assert!(guard::pack_sql(bad).is_err(), "{bad}");
    }
}

#[test]
fn no_pack_source_file_spells_a_statement_that_could_change_her_rows() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/study_pack");
    let forbidden = ["or replace", "replace into", "on conflict"];
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if !name.ends_with(".rs")
            || ["tests.rs", "import_tests.rs", "guard.rs"].contains(&name.as_str())
        {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap().to_lowercase();
        for word in forbidden {
            assert!(!source.contains(word), "{name} contains `{word}`");
        }
        // The two statement verbs that change rows never appear as SQL here.
        for verb in ["\"update ", "\"delete from"] {
            assert!(!source.contains(verb), "{name} contains `{verb}`");
        }
    }
    // The source does not hide one in a string built from parts either:
    // every content statement is passed through pack_sql (commit.rs, plan.rs).
    let commit = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/study_pack/commit.rs"),
    )
    .unwrap();
    assert!(commit.contains("use super::guard::{self, execute};"));
}

/* ------------------------------------------------------------------ */
/* Lookups: orderings, ties                                            */
/* ------------------------------------------------------------------ */

#[test]
fn lookups_break_ties_by_the_stated_total_orders_and_the_text_is_fixed_width() {
    let her = her();
    for m in ["m1", "m2", "m3"] {
        her.material(m, m, None);
    }
    let ns = "11111111-1111-4111-8111-111111111111";
    let rev = "c".repeat(64);
    let at = "2026-11-02T10:00:00.000Z";
    // Two receipts with the same imported_at, different operation ids.
    seed_extra_row(
        &her,
        "00000000-0000-4000-8000-000000000002",
        ns,
        "item-b",
        &rev,
        "m2",
        at,
    );
    seed_extra_row(
        &her,
        "00000000-0000-4000-8000-000000000001",
        ns,
        "item-a",
        &rev,
        "m1",
        at,
    );
    let look = super::plan::Lookups { conn: &her.conn };
    // L2: smaller operation id first (then namespace, item).
    assert_eq!(look.l2(&rev).unwrap().as_deref(), Some("m1"));
    // L3 (current): greater operation id for the same identity.
    seed_extra_row(
        &her,
        "00000000-0000-4000-8000-000000000003",
        ns,
        "item-a",
        &"d".repeat(64),
        "m3",
        at,
    );
    assert_eq!(look.l3(ns, "item-a").unwrap().as_deref(), Some("m3"));
    // Two live rows with R in one operation: smaller (namespace, item).
    her.conn
        .execute(
            "INSERT INTO study_pack_items VALUES (?1, 'item-0', ?2, 'document', ?3, 'm2', 'alias', '00000000-0000-4000-8000-000000000002', ?4)",
            params![ns, rev, "b".repeat(64), at],
        )
        .unwrap();
    assert_eq!(
        look.l2(&rev).unwrap().as_deref(),
        Some("m1"),
        "the other operation still has the smaller id"
    );
    her.conn.execute("DELETE FROM study_pack_items WHERE operation_id='00000000-0000-4000-8000-000000000001'", []).unwrap();
    assert_eq!(look.l2(&rev).unwrap().as_deref(), Some("m2"));
    assert_eq!(
        text(&her, &format!("SELECT item_id FROM study_pack_items WHERE revision='{rev}' ORDER BY imported_at, operation_id, namespace, item_id LIMIT 1")),
        "item-0"
    );
    // A non-24-character timestamp is refused by the table itself.
    let refused = her.conn.execute(
        "INSERT INTO study_pack_items VALUES (?1, 'x', ?2, 'guide', NULL, 'm1', 'alias', '00000000-0000-4000-8000-000000000003', '2026-11-02')",
        params![ns, rev],
    );
    assert!(refused.is_err());
}

#[test]
fn the_same_content_twice_in_a_pack_is_one_added_and_one_alias_and_a_live_row_beats_a_tombstone() {
    let p = lib();
    p.material("g-1", "Twin", None);
    p.material("g-2", "Twin", None);
    for id in ["g-1", "g-2"] {
        p.guide(id, "Same summary", json!([]), json!([]));
    }
    let her = her();
    let pack = pack_of(&p, &["g-1", "g-2"], "twins.hfdpack");
    let r = add(&her, &pack).unwrap();
    assert_eq!(
        (r.added, r.skipped),
        (1, 1),
        "the result depends on manifest order only"
    );
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_materials WHERE title='Twin'"
        ),
        1
    );
}

#[test]
fn a_revision_with_one_live_and_tombstoned_rows_aliases_the_live_one() {
    let (a, _) = seeded();
    let (b, _) = seeded();
    let (c, _) = seeded();
    let her = her();
    let (pa, pb, pc) = (
        revision_pack(&a, "Shared"),
        revision_pack(&b, "Shared"),
        revision_pack(&c, "Shared"),
    );
    add(&her, &pa).unwrap();
    add(&her, &pb).unwrap(); // alias of the same material
    delete_material(&her, "Shared"); // both rows are now tombstones
    let back = add(&her, &pa).unwrap();
    assert_eq!((back.added, back.readded), (1, 1));
    let tombstones = count(
        &her,
        "SELECT COUNT(*) FROM study_pack_items WHERE material_id IS NULL",
    );
    let result = add(&her, &pc).unwrap();
    assert_eq!(
        (result.added, result.skipped),
        (0, 1),
        "the live copy wins over the tombstones"
    );
    assert_eq!(
        count(
            &her,
            "SELECT COUNT(*) FROM study_pack_items WHERE material_id IS NULL"
        ),
        tombstones
    );
}

/* ------------------------------------------------------------------ */
/* Crash recovery                                                      */
/* ------------------------------------------------------------------ */

use super::reconcile::{Mode, Report};

fn reconcile(her: &Lib) -> Report {
    super::reconcile_study_pack_imports_in(her.root(), true).unwrap()
}

fn doc_names(her: &Lib) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(her.root().join("documents"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn all_pack(producer: &Lib) -> PathBuf {
    pack_of(producer, &["m-pdf", "m-guide", "m-child"], "all.hfdpack")
}

/// Run an import that "dies" at `point`, leaving everything as it is.
fn die_at(her: &Lib, pack: &Path, point: &'static str) {
    fault::crash_at(point);
    let outcome = add(her, pack).unwrap_err();
    fault::clear();
    assert_eq!(outcome, fault::CRASH, "crash at {point}");
}

fn op_dir_of(her: &Lib) -> PathBuf {
    std::fs::read_dir(journal::imports_dir(her.root()))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.file_name().unwrap() != journal::FAILED_DIR)
        .expect("an op dir")
}

fn assert_nothing_added(her: &Lib, before: &Snapshot, names_before: &[String]) {
    assert_untouched(before, her);
    assert_eq!(doc_names(her), names_before);
    assert_eq!(count(her, "SELECT COUNT(*) FROM study_pack_imports"), 0);
    assert_eq!(count(her, "SELECT COUNT(*) FROM study_materials"), 1);
    assert!(!staging_left(her));
}

fn assert_one_complete_import(her: &Lib, before: &Snapshot) {
    assert_untouched(before, her);
    assert_eq!(count(her, "SELECT COUNT(*) FROM study_pack_imports"), 1);
    assert_eq!(count(her, "SELECT COUNT(*) FROM study_materials"), 5);
    assert_eq!(
        count(
            her,
            "SELECT COUNT(*) FROM study_pack_items WHERE link='added'"
        ),
        4
    );
    for rel in ["handbook.pdf", "chapter2.pdf", "panel.png"] {
        assert!(doc_names(her).iter().any(|n| n.ends_with(rel)), "{rel}");
    }
    assert!(!staging_left(her));
    crate::backup::verify_application_connection(&her.conn).unwrap();
}

#[test]
fn a_crash_at_every_point_leaves_nothing_or_exactly_one_complete_import() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let before_commit = [
        "journal-done:PREPARING",
        "staged",
        "installing",
        "moved:1",
        "moved:2",
        "moved:3",
        "installed",
        "pre-commit",
        "before-commit",
    ];
    let after_commit = ["after-commit", "receipt-confirmed", "after-committed"];
    for point in before_commit {
        let her = her();
        let before = snapshot(&her);
        let names = doc_names(&her);
        die_at(&her, &pack, point);
        assert!(
            staging_left(&her),
            "{point}: the journal stays for recovery"
        );
        let report = reconcile(&her);
        assert_eq!(report.completed, 0, "{point}");
        assert_nothing_added(&her, &before, &names);
    }
    for point in after_commit {
        let her = her();
        let before = snapshot(&her);
        die_at(&her, &pack, point);
        let report = reconcile(&her);
        assert_eq!(report.completed, 1, "{point}");
        assert_one_complete_import(&her, &before);
    }
}

#[test]
fn recovery_after_real_process_death() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    for point in ["moved:1", "installed", "after-commit", "after-committed"] {
        let her = her();
        let before = snapshot(&her);
        let names = doc_names(&her);
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "study_pack::import_tests::child_import_entry",
                "--test-threads=1",
                "--nocapture",
            ])
            .env(fault::ABORT_ENV, point)
            .env("HFD_PACK_CHILD_ROOT", her.root())
            .env("HFD_PACK_CHILD_PACK", &pack)
            .output()
            .unwrap()
            .status;
        assert!(!status.success(), "the child must die at {point}");
        reconcile(&her);
        if point.starts_with("after-commit") || point == "after-committed" {
            assert_one_complete_import(&her, &before);
        } else {
            assert_nothing_added(&her, &before, &names);
        }
    }
}

/// Runs only inside the child process of `recovery_after_real_process_death`.
#[test]
fn child_import_entry() {
    let (Ok(root), Ok(pack)) = (
        std::env::var("HFD_PACK_CHILD_ROOT"),
        std::env::var("HFD_PACK_CHILD_PACK"),
    ) else {
        return;
    };
    let _ = add_study_pack_in(Path::new(&root), true, Path::new(&pack), &op());
}

#[test]
fn a_failed_directory_sync_rolls_back_with_no_receipt() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    for point in [
        "fsync:root",
        "fsync:pack-imports",
        "fsync:op",
        "fsync:files",
        "fsync:documents",
        "fsync:files-moved",
        "fsync:op-journal",
    ] {
        let her = her();
        let before = snapshot(&her);
        let names = doc_names(&her);
        fault::fail_at(point);
        let error = add(&her, &pack).unwrap_err();
        fault::clear();
        assert!(error.contains("injected failure"), "{point}: {error}");
        assert_nothing_added(&her, &before, &names);
    }
}

#[test]
fn the_order_of_durable_steps_is_fixed_and_the_commit_connection_syncs_fully() {
    let (producer, _) = seeded();
    let her = her();
    fault::clear();
    add(&her, &all_pack(&producer)).unwrap();
    let trace = fault::trace();
    fault::clear();
    let at = |name: &str| {
        trace
            .iter()
            .position(|p| p == name)
            .unwrap_or_else(|| panic!("{name} missing in {trace:?}"))
    };
    assert!(at("fsync:root") < at("fsync:pack-imports"));
    assert!(at("fsync:pack-imports") < at("fsync:op"));
    assert!(
        at("fsync:op") < at("journal:PREPARING"),
        "new directory entries are durable before the first journal write"
    );
    assert!(at("journal-done:STAGED") < at("journal:INSTALLING"));
    assert!(at("moved:3") < at("fsync:documents"));
    assert!(at("fsync:documents") < at("journal:INSTALLED"));
    assert!(at("after-commit") < at("receipt-confirmed"));
    assert!(at("receipt-confirmed") < at("journal:COMMITTED"));
    assert!(at("journal-done:COMMITTED") < at("staging-deleted"));
    let conn = super::commit::open_commit_connection(her.root()).unwrap();
    let synchronous: i64 = conn
        .query_row("PRAGMA synchronous", [], |r| r.get(0))
        .unwrap();
    assert_eq!(synchronous, 2, "FULL");
}

#[test]
fn an_unknown_commit_keeps_staging_and_reconcile_decides_by_the_receipt() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    let before = snapshot(&her);
    fault::fail_at("after-commit");
    let error = add(&her, &pack).unwrap_err();
    fault::clear();
    assert!(error.contains("injected failure"));
    assert!(staging_left(&her), "staging is kept");
    let report = reconcile(&her);
    assert_eq!(report.completed, 1);
    assert_one_complete_import(&her, &before);
}

#[test]
fn a_failed_committed_journal_write_keeps_the_import_and_reconcile_finishes_it() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    let before = snapshot(&her);
    let committed = std::rc::Rc::new(std::cell::Cell::new(false));
    let flag = committed.clone();
    fault::set_hook(move |p| {
        if p == "journal:COMMITTED" {
            flag.set(true);
        }
        if flag.get() && p == "fsync:op-journal" {
            return Err("injected failure".to_string());
        }
        Ok(())
    });
    let result = add(&her, &pack).unwrap();
    fault::clear();
    assert_eq!(result.added, 4, "the committed result is kept");
    assert!(staging_left(&her), "staging stays until reconcile");
    assert_eq!(reconcile(&her).completed, 1);
    assert_one_complete_import(&her, &before);
}

#[test]
fn same_size_corruption_is_caught_before_commit() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    for point in ["staged", "verify"] {
        let her = her();
        let before = snapshot(&her);
        let names = doc_names(&her);
        let root = her.root().to_path_buf();
        fault::set_hook(move |p| {
            if p != point {
                return Ok(());
            }
            let target = if point == "staged" {
                let op = std::fs::read_dir(journal::imports_dir(&root))
                    .unwrap()
                    .next()
                    .unwrap()
                    .unwrap()
                    .path();
                op.join("files/1")
            } else {
                let docs = root.join("documents");
                std::fs::read_dir(docs)
                    .unwrap()
                    .map(|e| e.unwrap().path())
                    .find(|p| {
                        p.to_string_lossy().ends_with("handbook.pdf")
                            || p.to_string_lossy().ends_with("panel.png")
                    })
                    .unwrap()
            };
            let mut bytes = std::fs::read(&target).unwrap();
            let last = bytes.len() - 1;
            bytes[last] ^= 0xff;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .open(&target)
                .unwrap();
            std::io::Write::write_all(&mut file, &bytes).unwrap();
            Ok(())
        });
        let error = add(&her, &pack).unwrap_err();
        fault::clear();
        assert!(error.contains("didn't copy correctly"), "{point}: {error}");
        assert_nothing_added(&her, &before, &names);
    }
}

/* ------------------------------------------------------------------ */
/* Deletion authority                                                  */
/* ------------------------------------------------------------------ */

/// An import that died with every file installed and no receipt.
fn installed_and_dead(her: &Lib, producer: &Lib) -> (PathBuf, journal::Journal) {
    die_at(her, &all_pack(producer), "installed");
    let op = op_dir_of(her);
    let j = journal::read(&op).unwrap();
    (op, j)
}

fn dest_of(j: &journal::Journal, suffix: &str) -> String {
    j.files
        .iter()
        .find(|f| f.dest.ends_with(suffix))
        .unwrap()
        .dest
        .clone()
}

fn exists(her: &Lib, name: &str) -> bool {
    her.root().join("documents").join(name).exists()
}

fn link_row(her: &Lib, id: &str, file_path: &str) {
    her.conn
        .execute(
            "INSERT INTO study_materials (id, title, material_type, topic, notes, file_path, original_file_name, created_at, updated_at)
             VALUES (?1, ?1, 'study_guide', 'x', '', ?2, 'x.pdf', ?3, ?3)",
            params![id, file_path, NOW],
        )
        .unwrap();
}

#[allow(clippy::type_complexity)]
#[test]
fn a_rolled_back_file_that_a_row_references_is_kept_in_every_spelling() {
    let (producer, _) = seeded();
    let insensitive = {
        let dir = std::env::temp_dir().join(format!("hfd-case-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a"), b"1").unwrap();
        let yes = dir.join("A").exists();
        std::fs::remove_dir_all(&dir).ok();
        yes
    };
    let mut spellings: Vec<(&str, Box<dyn Fn(&str) -> String>)> =
        vec![("exact", Box::new(|d| d.to_string()))];
    if insensitive {
        spellings.push(("case variant", Box::new(|d| d.to_uppercase())));
    }
    #[cfg(unix)]
    spellings.push((
        "through a directory link",
        Box::new(|d| format!("loop/{d}")),
    ));
    for (label, spell) in spellings {
        let her = her();
        let (_, j) = installed_and_dead(&her, &producer);
        #[cfg(unix)]
        std::os::unix::fs::symlink(".", her.root().join("documents/loop")).unwrap();
        let handbook = dest_of(&j, "handbook.pdf");
        link_row(&her, "her-linker", &spell(&handbook));
        reconcile(&her);
        assert!(
            exists(&her, &handbook),
            "{label}: a referenced file is kept"
        );
        assert!(
            !exists(&her, &dest_of(&j, "chapter2.pdf")),
            "{label}: the others were removed"
        );
        assert!(!staging_left(&her));
    }
}

#[test]
fn only_the_very_file_this_operation_wrote_may_be_removed() {
    let (producer, _) = seeded();
    // Same bytes, different inode, at a journal dest.
    let her1 = her();
    let (_, j) = installed_and_dead(&her1, &producer);
    let handbook = dest_of(&j, "handbook.pdf");
    let path = her1.root().join("documents").join(&handbook);
    let bytes = std::fs::read(&path).unwrap();
    std::fs::write(her1.root().join("documents/swap.tmp"), &bytes).unwrap();
    std::fs::rename(her1.root().join("documents/swap.tmp"), &path).unwrap();
    // A same-hash unreferenced file elsewhere.
    std::fs::write(her1.root().join("documents/foreign.pdf"), &bytes).unwrap();
    reconcile(&her1);
    assert!(
        exists(&her1, &handbook),
        "identical bytes at another inode are not ours"
    );
    assert!(exists(&her1, "foreign.pdf"));
    assert!(!exists(&her1, &dest_of(&j, "panel.png")));
    assert!(exists(&her1, "stray.pdf"));

    // A journal that names one of her files: not under this operation's ids.
    let her2 = her();
    let (op, mut j) = installed_and_dead(&her2, &producer);
    let stray = std::fs::symlink_metadata(her2.root().join("documents/stray.pdf")).unwrap();
    let (dev, ino) = journal::file_id(&stray).unwrap();
    j.files[0].dest = "stray.pdf".into();
    j.files[0].dev = dev;
    j.files[0].ino = ino;
    std::fs::write(op.join("journal.json"), serde_json::to_vec(&j).unwrap()).unwrap();
    reconcile(&her2);
    assert!(
        exists(&her2, "stray.pdf"),
        "a dest outside this op's ids is kept"
    );

    // A forged journal that names a referenced file with a matching id and inode.
    let her3 = her();
    let (op, mut j) = installed_and_dead(&her3, &producer);
    let uuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let name = format!("{uuid}-doc.pdf");
    std::fs::write(her3.root().join("documents").join(&name), b"hers").unwrap();
    link_row(&her3, "her-doc", &name);
    let meta = std::fs::symlink_metadata(her3.root().join("documents").join(&name)).unwrap();
    let (dev, ino) = journal::file_id(&meta).unwrap();
    j.id_map.insert("forged".into(), uuid.into());
    j.files[0].dest = name.clone();
    j.files[0].dev = dev;
    j.files[0].ino = ino;
    std::fs::write(op.join("journal.json"), serde_json::to_vec(&j).unwrap()).unwrap();
    reconcile(&her3);
    assert!(
        exists(&her3, &name),
        "a referenced file named in a forged journal is kept"
    );
}

#[test]
fn lookup_failures_and_unreadable_journals_delete_no_document() {
    let (producer, _) = seeded();
    // The pack tables are missing: nothing can be proven.
    let her1 = her();
    let (_, j) = installed_and_dead(&her1, &producer);
    let names = doc_names(&her1);
    her1.conn.execute_batch("DROP TABLE study_pack_acks; DROP TABLE study_pack_items; DROP TABLE study_pack_imports;").unwrap();
    assert_eq!(reconcile(&her1).left, 1);
    assert_eq!(doc_names(&her1), names);
    assert!(staging_left(&her1), "retried on the next call");
    // Restore staging quarantines it instead and deletes no document.
    crate::library_lock::with_library_lock(her1.root(), true, Mode::Restore, |_| Ok(())).unwrap();
    assert_eq!(doc_names(&her1), names);
    assert!(!staging_left(&her1));
    let quarantined = journal::imports_dir(her1.root()).join(journal::FAILED_DIR);
    assert!(quarantined.join(&j.op_id).join("journal.json").exists());

    // An unreadable journal: files/ deleted, journal kept in .failed/, documents untouched.
    let her2 = her();
    let (op, j) = installed_and_dead(&her2, &producer);
    let names = doc_names(&her2);
    std::fs::write(op.join("journal.json"), b"{ not json").unwrap();
    reconcile(&her2);
    assert_eq!(doc_names(&her2), names);
    assert!(journal::imports_dir(her2.root())
        .join(journal::FAILED_DIR)
        .join(format!("{}.json", j.op_id))
        .exists());
    assert!(!staging_left(&her2));
}

#[cfg(unix)]
#[test]
fn a_half_finished_hard_link_move_is_cleaned_up() {
    let (producer, _) = seeded();
    let her = her();
    let before = snapshot(&her);
    let names = doc_names(&her);
    die_at(&her, &all_pack(&producer), "moved:1");
    let op = op_dir_of(&her);
    let j = journal::read(&op).unwrap();
    let first = &j.files[0];
    let dest = her.root().join("documents").join(&first.dest);
    std::fs::hard_link(&dest, op.join("files").join(first.n.to_string())).unwrap();
    reconcile(&her);
    assert_nothing_added(&her, &before, &names);
}

#[test]
fn rollback_reads_and_removes_inside_one_write_transaction() {
    let (producer, _) = seeded();
    let her = her();
    let (_, _) = installed_and_dead(&her, &producer);
    let root = her.root().to_path_buf();
    let blocked = std::rc::Rc::new(std::cell::Cell::new(false));
    let seen = blocked.clone();
    fault::set_hook(move |p| {
        if p == "rollback:between-check-and-remove" {
            let other = Connection::open(root.join("her-flight-deck.db")).unwrap();
            other
                .busy_timeout(std::time::Duration::from_millis(100))
                .unwrap();
            // A second writer cannot get in between the check and the remove.
            let attempt =
                other.execute("UPDATE study_materials SET notes='x' WHERE id='her-1'", []);
            seen.set(attempt.is_err());
            // Nor can one link the file: a plain insert is refused too.
            let link = other.execute(
                "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('late','late','a','b')",
                [],
            );
            assert!(link.is_err());
        }
        Ok(())
    });
    reconcile(&her);
    fault::clear();
    assert!(
        blocked.get(),
        "the write lock was held across check and remove"
    );
}

#[test]
fn writers_racing_a_rollback_never_leave_a_row_pointing_at_a_deleted_file() {
    let (producer, _) = seeded();
    let her = her();
    let (_, j) = installed_and_dead(&her, &producer);
    let handbook = dest_of(&j, "handbook.pdf");
    her.material("her-2", "Needs a file", None);
    let root = her.root().to_path_buf();
    let handbook2 = handbook.clone();
    let results = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let out = results.clone();
    fault::set_hook(move |p| {
        if p == "rollback:between-check-and-remove" {
            // Same process, lock held by the reconcile: the locked entry points are busy.
            out.borrow_mut().push(
                crate::documents::reattach_unlinked_file_locked(&root, true, "her-2", &handbook2)
                    .unwrap_err(),
            );
            out.borrow_mut().push(
                crate::documents::import_unlinked_file_locked(&root, true, &handbook2).unwrap_err(),
            );
            out.borrow_mut().push(
                crate::documents::trash_unlinked_file_locked(&root, true, &handbook2)
                    .map(|_| String::new())
                    .unwrap_err(),
            );
            out.borrow_mut().push(
                crate::documents::check_library_locked(&root, true)
                    .map(|_| String::new())
                    .unwrap_err(),
            );
        }
        Ok(())
    });
    reconcile(&her);
    fault::clear();
    for busy in results.borrow().iter() {
        assert_eq!(busy, crate::library_lock::PACK_BUSY);
    }
    assert!(
        !results.borrow().is_empty() && results.borrow().len() % 4 == 0,
        "four writers per file"
    );
    // The other order: the rollback finished, the late writer finds no file.
    let late =
        crate::documents::reattach_unlinked_file_in(her.root(), "her-2", &handbook).unwrap_err();
    assert!(!late.is_empty());
    let dangling = count(
        &her,
        "SELECT COUNT(*) FROM study_materials WHERE file_path IS NOT NULL",
    );
    for row in her
        .conn
        .prepare("SELECT file_path FROM study_materials WHERE file_path IS NOT NULL")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
    {
        assert!(
            exists(&her, &row.unwrap()),
            "no row points at a deleted file"
        );
    }
    assert!(dangling >= 1);
}

/* ------------------------------------------------------------------ */
/* Lock, refusals, results                                             */
/* ------------------------------------------------------------------ */

#[test]
fn the_library_lock_keeps_a_pack_and_a_backup_or_restore_from_interleaving() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    let root = her.root().to_path_buf();
    let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::<String>::new()));
    let out = seen.clone();
    let pack2 = pack.clone();
    fault::set_hook(move |p| {
        if p == "installing" {
            let note = |e: Result<(), String>| out.borrow_mut().push(e.unwrap_err());
            note(crate::documents::check_library_locked(&root, true).map(|_| ()));
            note(crate::library_lock::with_library_lock(
                &root,
                true,
                Mode::Restore,
                |_| Ok(()),
            ));
            note(crate::library_lock::with_library_lock(
                &root,
                true,
                Mode::Normal,
                |_| Ok(()),
            ));
            note(add_study_pack_in(&root, true, &pack2, &op()).map(|_| ()));
            note(super::reconcile_study_pack_imports_in(&root, true).map(|_| ()));
        }
        Ok(())
    });
    add(&her, &pack).unwrap();
    fault::clear();
    assert_eq!(seen.borrow().len(), 5);
    assert!(
        seen.borrow()
            .iter()
            .all(|m| m == crate::library_lock::PACK_BUSY),
        "{:?}",
        seen.borrow()
    );
    // The other direction: a backup/restore holder makes an add wait its turn.
    let busy = crate::library_lock::with_library_lock(her.root(), true, Mode::Normal, |_| {
        add_study_pack_in(her.root(), true, &pack, &op()).map(|_| ())
    })
    .unwrap_err();
    assert_eq!(busy, crate::library_lock::LIBRARY_BUSY);
}

#[test]
fn storage_that_this_process_does_not_own_is_never_touched() {
    let (producer, _) = seeded();
    let her = her();
    die_at(&her, &all_pack(&producer), "installed");
    let names = doc_names(&her);
    let error = add_study_pack_in(her.root(), false, &all_pack(&producer), &op()).unwrap_err();
    assert_eq!(error, install::UNSUPPORTED);
    let report = super::reconcile_study_pack_imports_in(her.root(), false).unwrap();
    assert_eq!(report, Report::default());
    assert!(staging_left(&her));
    assert_eq!(doc_names(&her), names);
}

#[test]
fn the_same_device_probe_refuses_second_devices_zero_and_unstable_inodes() {
    assert!(install::storage_ok(7, 7, [(7, 42); 3]));
    assert!(
        !install::storage_ok(7, 8, [(7, 42); 3]),
        "a mocked second device"
    );
    assert!(!install::storage_ok(7, 7, [(7, 0); 3]), "inode 0");
    assert!(
        !install::storage_ok(7, 7, [(7, 42), (7, 42), (7, 43)]),
        "an unstable inode"
    );
}

#[test]
fn an_import_is_refused_while_a_restore_is_pending_and_changes_nothing() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    for (label, make) in [
        (
            "pending folder",
            Box::new(|root: &Path| std::fs::create_dir(root.join(".restore-pending")).unwrap())
                as Box<dyn Fn(&Path)>,
        ),
        (
            "journal",
            Box::new(|root: &Path| {
                std::fs::write(root.join(crate::backup::RESTORE_JOURNAL_FILE), b"{}").unwrap()
            }),
        ),
    ] {
        let her = her();
        let before = snapshot(&her);
        make(her.root());
        assert_eq!(
            add(&her, &pack).unwrap_err(),
            install::RESTORE_FIRST,
            "{label}"
        );
        assert_untouched(&before, &her);
        assert!(!journal::imports_dir(her.root()).exists());
    }
}

fn write_restore_journal(root: &Path, phase: crate::backup::RestorePhase) {
    let mut journal = crate::backup::RestoreJournal::new("backups/x".to_string(), false);
    journal.phase = phase;
    std::fs::write(
        root.join(crate::backup::RESTORE_JOURNAL_FILE),
        serde_json::to_vec(&journal).unwrap(),
    )
    .unwrap();
}

#[test]
fn a_finished_restore_journal_does_not_block_adding_a_pack() {
    use crate::backup::RestorePhase;
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    for phase in [RestorePhase::Committed, RestorePhase::RolledBack] {
        let her = her();
        write_restore_journal(her.root(), phase);
        add(&her, &pack).expect("a finished restore must not block");
    }
    for phase in [
        crate::backup::RestorePhase::Activating,
        crate::backup::RestorePhase::UnresolvedRecovery,
    ] {
        let her = her();
        write_restore_journal(her.root(), phase);
        assert_eq!(add(&her, &pack).unwrap_err(), install::RESTORE_FIRST);
    }
}

#[test]
fn a_result_is_recovered_from_its_receipt_and_acknowledged_once() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    die_at(&her, &pack, "after-committed");
    reconcile(&her);
    let pending = super::result::pending_results(&her.conn).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].added, 4);
    let by_id = super::result::read_result(&her.conn, &pending[0].operation_id).unwrap();
    assert_eq!(by_id.as_ref(), Some(&pending[0]));
    super::result::ack(&her.conn, &pending[0].operation_id, NOW).unwrap();
    super::result::ack(&her.conn, &pending[0].operation_id, NOW).unwrap();
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_acks"), 1);
    assert!(super::result::pending_results(&her.conn)
        .unwrap()
        .is_empty());
    super::result::ack(&her.conn, "not-an-operation", NOW).unwrap();
    assert_eq!(
        count(&her, "SELECT COUNT(*) FROM study_pack_acks"),
        1,
        "an unknown id writes nothing"
    );
    // The same operation id asked again answers from the receipt, adding nothing.
    let id = pending[0].operation_id.clone();
    let again = add_study_pack_in(her.root(), true, &pack, &id).unwrap();
    assert_eq!(again, pending[0]);
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_materials"), 5);
}

#[test]
fn a_library_that_changed_while_staging_abandons_the_import() {
    let p = pic_producer();
    let her = her_with_picture(&p);
    let picture = new_material(&her, "Panel picture");
    let names_before = doc_names(&her);
    let materials = count(&her, "SELECT COUNT(*) FROM study_materials") - 1;
    let root = her.root().to_path_buf();
    fault::set_hook(move |point| {
        if point == "staged" {
            // Her TS connection deletes the picture the plan reused.
            let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
            conn.pragma_update(None, "foreign_keys", true).unwrap();
            conn.execute(
                "DELETE FROM study_materials WHERE title='Panel picture'",
                [],
            )
            .unwrap();
        }
        Ok(())
    });
    let error = add(&her, &pack_of(&p, &["m-pdf"], "guide.hfdpack")).unwrap_err();
    fault::clear();
    assert_eq!(error, super::commit::CHANGED);
    assert_eq!(
        count(&her, "SELECT COUNT(*) FROM study_materials"),
        materials
    );
    assert!(!staging_left(&her));
    assert_eq!(
        count(&her, "SELECT COUNT(*) FROM study_pack_imports"),
        1,
        "only the earlier import"
    );
    assert_eq!(doc_names(&her), names_before, "the new file went out again");
    let _ = picture;
}

#[test]
fn a_pack_with_a_replaces_marker_is_refused_before_anything_is_written() {
    let (producer, _) = seeded();
    let base = all_pack(&producer);
    let bad = tampered(&producer, &base, "bad.hfdpack", |entries, _| {
        let name = entries
            .iter()
            .find(|(n, _)| n.starts_with("items/"))
            .unwrap()
            .0
            .clone();
        let mut value = item_json(entries, &name);
        value["x"] = json!({"replaces": "a"});
        set_item_json(entries, &name, &value);
    });
    let her = her();
    let before = snapshot(&her);
    let error = add(&her, &bad).unwrap_err();
    assert!(error.contains("damaged"), "{error}");
    assert_untouched(&before, &her);
    assert!(!journal::imports_dir(her.root()).exists());
}

/* ------------------------------------------------------------------ */
/* Migration, validation, backup and restore                           */
/* ------------------------------------------------------------------ */

fn dump(lib: &Lib, table: &str) -> Vec<String> {
    snapshot(lib).rows.remove(table).unwrap_or_default()
}

#[test]
fn schema_37_upgrades_a_36_database_and_leaves_its_rows_alone() {
    let dir = TempDir::new();
    let conn = Connection::open(dir.path().join("old.db")).unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY)")
        .unwrap();
    for m in crate::migrations().into_iter().filter(|m| m.version <= 36) {
        conn.execute_batch(m.sql).unwrap();
        conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
            .unwrap();
    }
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('old','Hers',?1,?1)",
        [NOW],
    )
    .unwrap();
    let before: Vec<String> = conn
        .prepare("SELECT id || title FROM study_materials")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(conn.prepare("SELECT 1 FROM study_pack_imports").is_err());
    let m37 = crate::migrations()
        .into_iter()
        .find(|m| m.version == 37)
        .unwrap();
    conn.execute_batch(m37.sql).unwrap();
    conn.execute("INSERT INTO _sqlx_migrations VALUES (37)", [])
        .unwrap();
    let after: Vec<String> = conn
        .prepare("SELECT id || title FROM study_materials")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(before, after);
    crate::backup::verify_schema_37_study_packs(&conn).unwrap();
    assert_eq!(crate::CURRENT_SCHEMA_VERSION, 37);
}

#[test]
fn native_restore_validation_refuses_missing_and_malformed_provenance() {
    let damages = [
        "DROP TABLE study_pack_acks",
        "PRAGMA ignore_check_constraints = ON; UPDATE study_pack_items SET link = 'bogus'",
        "PRAGMA foreign_keys = OFF; INSERT INTO study_pack_items VALUES ('11111111-1111-4111-8111-111111111111','i2','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','guide',NULL,NULL,'alias','99999999-9999-4999-8999-999999999999','2026-11-07T10:00:00.000Z')",
        "DROP INDEX idx_study_pack_items_added; INSERT INTO study_pack_items SELECT namespace, 'i3', revision, kind, file_sha256, material_id, 'added', operation_id, imported_at FROM study_pack_items",
        "UPDATE study_pack_imports SET added_practice = 9",
        "UPDATE study_pack_imports SET added = 0, added_pictures = 0, new_versions = 1",
        "UPDATE study_pack_items SET kind = 'guide'",
        "UPDATE study_pack_items SET file_sha256 = NULL",
    ];
    for sql in damages {
        let her = her();
        let (producer, _) = seeded();
        add(&her, &pack_of(&producer, &["m-guide"], "g.hfdpack")).unwrap();
        // m-guide is guide-only; make the row a document so the kind rules can be broken.
        her.conn
            .execute(
                "UPDATE study_pack_items SET kind='document', file_sha256=?1",
                ["a".repeat(64)],
            )
            .unwrap();
        crate::backup::verify_schema_37_study_packs(&her.conn).unwrap();
        her.conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        her.conn.execute_batch(sql).unwrap();
        assert!(
            crate::backup::verify_schema_37_study_packs(&her.conn).is_err(),
            "{sql}"
        );
    }
}

#[test]
fn an_import_survives_backup_and_restore_and_the_same_pack_then_adds_nothing() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    let first = add(&her, &pack).unwrap();
    super::result::ack(&her.conn, &first.operation_id, NOW).unwrap();
    let provenance = (
        dump(&her, "study_pack_imports"),
        dump(&her, "study_pack_items"),
        dump(&her, "study_pack_acks"),
    );
    let archive = her.out("backup.hfdbackup");
    crate::backup::create_consistent_complete_backup_with_retry(her.root(), &archive, "0.6.8")
        .unwrap();
    crate::backup::stage_complete_restore_in(her.root(), &archive, "0.6.8").unwrap();
    let decision = crate::backup::handle_startup_restore_in(her.root()).unwrap();
    assert!(matches!(
        decision,
        crate::backup::StartupRestoreDecision::RestoreCompleted
    ));
    let reopened = Connection::open(her.root().join("her-flight-deck.db")).unwrap();
    let rows = |table: &str| -> Vec<String> {
        let mut statement = reopened
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
        all
    };
    assert_eq!(
        (
            rows("study_pack_imports"),
            rows("study_pack_items"),
            rows("study_pack_acks")
        ),
        provenance
    );
    drop(reopened);
    let again = add(&her, &pack).unwrap();
    assert_eq!((again.added, again.skipped), (0, 4));
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_items"), 4);
}

#[test]
fn two_adds_at_once_never_interleave() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    let root = her.root().to_path_buf();
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let (root, pack) = (root.clone(), pack.clone());
            std::thread::spawn(move || add_study_pack_in(&root, true, &pack, &op()))
        })
        .collect();
    let mut added = 0;
    for h in handles {
        match h.join().unwrap() {
            Ok(r) => added += r.added,
            Err(message) => assert_eq!(message, crate::library_lock::PACK_BUSY),
        }
    }
    assert_eq!(
        added, 4,
        "exactly one of them added the pack; later ones skipped"
    );
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_materials"), 5);
    assert!(!staging_left(&her));
}

#[test]
fn dropped_picture_cards_leave_no_citation_and_a_run_with_nothing_left_is_omitted() {
    for (cite_plain, expect_run) in [(true, true), (false, false)] {
        let p = lib();
        let pdf = pdf_bytes(4, "cited");
        p.material("m-pdf", "Handbook", Some(("handbook.pdf", &pdf)));
        p.material("m-pic", "Panel picture", Some(("panel.png", PANEL)));
        let region = p.region("m-pdf", "m-pic", (1, 1, 10, 10));
        let plain = json!({"front": "Plain", "back": "Card", "sourcePage": 1, "itemId": "c-plain"});
        let pic = json!({"front": "Pic", "back": "Look", "sourcePage": null, "itemId": "c-pic", "visualRegionId": region});
        p.guide("m-pdf", "Summary", json!([]), json!([plain, pic]));
        p.conn
            .execute(
                "INSERT INTO pdf_kit_runs VALUES ('run-1','m-pdf',?1,'[1,2]',1,1,?2)",
                params![sha(&pdf), NOW],
            )
            .unwrap();
        let mut sources = vec![("c-pic", pic.clone())];
        if cite_plain {
            sources.push(("c-plain", plain.clone()));
        }
        for (logical, card) in sources {
            p.conn
                .execute(
                    "INSERT INTO pdf_kit_item_sources VALUES ('run-1','card',?1,?2,1,0,5,'Alpha')",
                    params![
                        logical,
                        compute_canonical_hash(&crate::pdf_kit_sources::content("card", &card))
                    ],
                )
                .unwrap();
        }
        let her = her();
        let pack = pack_of(&p, &["m-pdf"], "cited.hfdpack");
        add(&her, &pack).unwrap();
        delete_material(&her, "Panel picture");
        delete_material(&her, "Handbook");
        let result = add(&her, &pack).unwrap();
        assert_eq!(
            (result.cards_left_out, result.cards_left_out_removed),
            (1, 1)
        );
        let handbook = new_material(&her, "Handbook");
        let runs = count(
            &her,
            &format!("SELECT COUNT(*) FROM pdf_kit_runs WHERE material_id='{handbook}'"),
        );
        assert_eq!(runs, i64::from(expect_run));
        if expect_run {
            let run: String = text(
                &her,
                &format!("SELECT run_id FROM pdf_kit_runs WHERE material_id='{handbook}'"),
            );
            assert_eq!(
                count(
                    &her,
                    &format!("SELECT COUNT(*) FROM pdf_kit_item_sources WHERE run_id='{run}'")
                ),
                1
            );
        }
        assert_eq!(
            count(
                &her,
                &format!(
                    "SELECT COUNT(*) FROM visual_card_regions WHERE owner_material_id='{handbook}'"
                )
            ),
            0
        );
        crate::backup::verify_application_connection(&her.conn).unwrap();
    }
}

#[test]
fn the_preview_counts_what_is_in_the_pack_and_what_she_has_without_writing_anything() {
    let (producer, _) = seeded();
    let pack = all_pack(&producer);
    let her = her();
    let before = snapshot(&her);
    let preview = super::inspect::inspect_study_pack_in(her.root(), &pack).unwrap();
    assert_eq!(
        (
            preview.guides,
            preview.cards,
            preview.questions,
            preview.videos,
            preview.documents,
            preview.already_in_library
        ),
        (2, 3, 2, 2, 2, 0)
    );
    assert_untouched(&before, &her);
    assert!(!journal::imports_dir(her.root()).exists());
    assert_eq!(count(&her, "SELECT COUNT(*) FROM study_pack_imports"), 0);
    add(&her, &pack).unwrap();
    let preview = super::inspect::inspect_study_pack_in(her.root(), &pack).unwrap();
    assert_eq!(preview.already_in_library, 3, "the picture is never named");
}
