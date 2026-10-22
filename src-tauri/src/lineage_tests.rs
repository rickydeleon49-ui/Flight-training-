//! Split-source lineage (M2): receipts, the bound save, cancel, read-back,
//! fingerprints and the schema-13 validator, on disposable library folders.
//! Every value is synthetic.

use super::*;
use std::path::PathBuf;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-lineage-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join(DOCUMENTS_DIR)).unwrap();
        Self(dir)
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

const T0: &str = "2026-10-08T12:00:00.000Z";

/// A library folder whose database has every shipped migration.
fn library(label: &str) -> TempDir {
    let dir = TempDir::new(label);
    let conn = Connection::open(dir.path().join(DATABASE_FILE)).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for migration in crate::migrations() {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [migration.version],
        )
        .unwrap();
    }
    dir
}

fn db(dir: &TempDir) -> Connection {
    let conn = Connection::open(dir.path().join(DATABASE_FILE)).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn
}

fn write_doc(dir: &TempDir, name: &str, bytes: &[u8]) {
    std::fs::write(dir.path().join(DOCUMENTS_DIR).join(name), bytes).unwrap();
}

/// A material that owns `file`, with a goal, an event and a tag to inherit.
fn material(dir: &TempDir, id: &str, title: &str, file: &str, bytes: &[u8]) {
    write_doc(dir, file, bytes);
    let conn = db(dir);
    conn.execute(
        "INSERT INTO study_materials (id, title, material_type, topic, review_status, priority,
           notes, file_path, original_file_name, file_size, created_at, updated_at)
         VALUES (?1, ?2, 'handbook', 'weather', 'confident', 'next_up', 'mine', ?3, ?4, ?5, ?6, ?6)",
        params![id, title, file, format!("{title}.pdf"), bytes.len() as i64, T0],
    )
    .unwrap();
}

fn tag(dir: &TempDir, material_id: &str, name: &str) {
    let conn = db(dir);
    conn.execute(
        "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?1, ?2)",
        params![name, T0],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO material_tags (material_id, tag_id) VALUES (?1, ?2)",
        params![material_id, name],
    )
    .unwrap();
}

/// A written part file and its plan entry.
fn part(dir: &TempDir, id: &str, first: u32, last: u32) -> WrittenPart {
    let file = format!("{id}-part.pdf");
    let bytes = format!("synthetic part {id} pages {first}-{last}");
    write_doc(dir, &file, bytes.as_bytes());
    WrittenPart {
        id: id.to_string(),
        first_page: first,
        last_page: last,
        file_path: file,
        file_size: bytes.len() as u64,
        original_file_name: format!("{id}.pdf"),
    }
}

fn issue(
    dir: &TempDir,
    source: &str,
    file: &str,
    total: u32,
    parts: &[WrittenPart],
) -> Result<SplitSourceReceipt, String> {
    let bytes = std::fs::read(dir.path().join(DOCUMENTS_DIR).join(file)).unwrap();
    issue_receipt_at(dir.path(), source, file, &bytes, total, parts, &[])
}

fn shown(receipt: &SplitSourceReceipt) -> Vec<SplitPartPresentation> {
    receipt
        .core
        .plan
        .iter()
        .map(|part| SplitPartPresentation {
            id: part.id.clone(),
            title: format!("Title of {}", part.id),
            notes: format!("Notes of {}", part.id),
        })
        .collect()
}

fn status(dir: &TempDir, operation: &str) -> Option<String> {
    db(dir)
        .query_row(
            "SELECT status FROM split_operation_log WHERE operation_id = ?1",
            [operation],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
}

fn count(dir: &TempDir, sql: &str) -> i64 {
    db(dir).query_row(sql, [], |r| r.get(0)).unwrap()
}

type LineageView = (
    Option<String>,
    Option<String>,
    u32,
    u32,
    Option<u32>,
    Option<u32>,
    u32,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    u32,
);

fn lineage_of(dir: &TempDir, id: &str) -> LineageView {
    db(dir)
        .query_row(
            "SELECT parent_material_id, root_material_id, source_page_start, source_page_end,
                    parent_page_start, parent_page_end, child_page_count, source_title,
                    source_content_sha256, parent_title, parent_file_name, nested_level
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
                ))
            },
        )
        .unwrap()
}

const ROOT: &[u8] = b"root handbook edition one";
const ROOT_FILE: &str = "R-root.pdf";

/// R (400 pages) with part A = R pages 101-300, saved through a receipt.
fn with_part_a(dir: &TempDir) -> SplitSourceReceipt {
    material(dir, "R", "Root Handbook", ROOT_FILE, ROOT);
    tag(dir, "R", "airspace");
    let a = part(dir, "A", 101, 300);
    let receipt = issue(dir, "R", ROOT_FILE, 400, &[a]).unwrap();
    save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap();
    receipt
}

#[test]
fn a_direct_split_records_the_original_and_inherits_the_source_settings() {
    let dir = library("direct");
    let receipt = with_part_a(&dir);
    assert_eq!(receipt.core.source_content_sha256, calculate_sha256(ROOT));
    assert_eq!(receipt.operation_id, receipt.receipt_hash);
    assert_eq!(
        status(&dir, &receipt.operation_id).as_deref(),
        Some("committed")
    );

    let (
        parent,
        root,
        start,
        end,
        p_start,
        p_end,
        count_,
        root_title,
        root_hash,
        p_title,
        p_file,
        level,
    ) = lineage_of(&dir, "A");
    assert_eq!((parent, root.as_deref()), (None, Some("R")));
    assert_eq!((start, end, count_, level), (101, 300, 200, 1));
    assert_eq!((p_start, p_end, p_title, p_file), (None, None, None, None));
    assert_eq!(root_title.as_deref(), Some("Root Handbook"));
    assert_eq!(root_hash, Some(calculate_sha256(ROOT)));

    let (title, kind, topic, priority, notes, status_): (
        String,
        String,
        String,
        String,
        String,
        String,
    ) = db(&dir)
        .query_row(
            "SELECT title, material_type, topic, priority, notes, review_status
                   FROM study_materials WHERE id = 'A'",
            [],
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
    assert_eq!(title, "Title of A");
    assert_eq!(notes, "Notes of A");
    assert_eq!(
        (kind.as_str(), topic.as_str(), priority.as_str()),
        ("handbook", "weather", "next_up")
    );
    assert_eq!(status_, "needs_review");
    assert_eq!(
        count(
            &dir,
            "SELECT COUNT(*) FROM material_tags WHERE material_id = 'A' AND tag_id = 'airspace'"
        ),
        1
    );
}

#[test]
fn a_part_of_a_part_records_both_tiers_with_the_canonical_pages() {
    let dir = library("nested");
    with_part_a(&dir);
    let a_bytes = std::fs::read(dir.path().join(DOCUMENTS_DIR).join("A-part.pdf")).unwrap();
    let b = part(&dir, "B", 20, 40);
    let receipt = issue(&dir, "A", "A-part.pdf", 200, &[b]).unwrap();
    assert!(receipt.core.is_nested);
    assert_eq!(receipt.core.nested_level, 2);
    save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap();

    let (
        parent,
        root,
        start,
        end,
        p_start,
        p_end,
        count_,
        root_title,
        root_hash,
        p_title,
        p_file,
        level,
    ) = lineage_of(&dir, "B");
    assert_eq!((parent.as_deref(), root.as_deref()), (Some("A"), Some("R")));
    assert_eq!(
        (start, end, p_start, p_end, count_, level),
        (120, 140, Some(20), Some(40), 21, 2)
    );
    assert_eq!(root_title.as_deref(), Some("Root Handbook"));
    assert_eq!(root_hash, Some(calculate_sha256(ROOT)));
    // The parent tier is A's own, never the original's.
    assert_eq!(p_title.as_deref(), Some("Title of A"));
    assert_eq!(p_file.as_deref(), Some("A.pdf"));
    let parent_hash: Option<String> = db(&dir)
        .query_row(
            "SELECT parent_content_sha256 FROM material_split_lineage WHERE material_id = 'B'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(parent_hash, Some(calculate_sha256(&a_bytes)));
}

#[test]
fn shared_compose_cases_match_the_typescript_arithmetic() {
    #[derive(serde::Deserialize)]
    struct Range {
        start: u32,
        end: u32,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        start: u32,
        end: u32,
        child_page_count: u32,
    }
    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        parent: Range,
        selection: Range,
        expected: Option<Expected>,
    }
    #[derive(serde::Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }
    let fixture: Fixture =
        serde_json::from_str(include_str!("../fixtures/split-lineage/compose.json")).unwrap();
    for (index, case) in fixture.cases.iter().enumerate() {
        let dir = library(&format!("compose-{index}"));
        material(&dir, "R", "Root", ROOT_FILE, ROOT);
        let parent_len = case.parent.end - case.parent.start + 1;
        let a = part(&dir, "A", case.parent.start, case.parent.end);
        let total = case.parent.end.max(400);
        let receipt = issue(&dir, "R", ROOT_FILE, total, &[a]).unwrap();
        save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap();
        let mut b = part(&dir, "B", 1, 1);
        b.first_page = case.selection.start;
        b.last_page = case.selection.end;
        let nested = issue(&dir, "A", "A-part.pdf", parent_len, &[b]);
        match &case.expected {
            Some(expected) => {
                let plan = &nested
                    .unwrap_or_else(|e| panic!("{}: {e}", case.name))
                    .core
                    .plan[0];
                assert_eq!(
                    (
                        plan.canonical_root_start,
                        plan.canonical_root_end,
                        plan.child_page_count
                    ),
                    (expected.start, expected.end, expected.child_page_count),
                    "{}",
                    case.name
                );
            }
            None => assert!(nested.is_err(), "{} should be refused", case.name),
        }
    }
}

#[test]
fn a_receipt_is_refused_for_a_file_the_material_does_not_own() {
    let dir = library("ownership");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    material(&dir, "X", "Other", "X-other.pdf", b"another handbook");
    let a = part(&dir, "A", 1, 10);
    let error = issue(&dir, "X", ROOT_FILE, 400, &[a]).unwrap_err();
    assert!(error.contains("does not belong"), "{error}");
    assert_eq!(count(&dir, "SELECT COUNT(*) FROM split_operation_log"), 0);
}

#[test]
fn an_edited_or_unrecorded_receipt_saves_nothing() {
    let dir = library("tamper");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    let a = part(&dir, "A", 1, 10);
    let receipt = issue(&dir, "R", ROOT_FILE, 400, &[a]).unwrap();

    let mut edited = receipt.clone();
    edited.core.source_total_pages = 9000;
    edited.core.plan[0].canonical_root_end = 5000;
    let error = save_split_batch_at(dir.path(), &edited, &shown(&edited)).unwrap_err();
    assert!(error.contains("does not match"), "{error}");

    // Re-hashing the edit does not help: that receipt was never recorded.
    let (_, hash) = receipt_hash(&edited.core).unwrap();
    edited.receipt_hash = hash.clone();
    edited.operation_id = hash;
    let error = save_split_batch_at(dir.path(), &edited, &shown(&edited)).unwrap_err();
    assert!(error.contains("does not match"), "{error}");

    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'A'"),
        0
    );
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM material_split_lineage"),
        0
    );
    assert_eq!(
        status(&dir, &receipt.operation_id).as_deref(),
        Some("pending")
    );
}

#[test]
fn a_changed_or_missing_source_and_a_wrong_sized_part_save_nothing() {
    let dir = library("stale");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    let a = part(&dir, "A", 1, 10);
    let receipt = issue(&dir, "R", ROOT_FILE, 400, &[a]).unwrap();

    write_doc(&dir, ROOT_FILE, b"root handbook edition two");
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("changed after it was split"), "{error}");

    std::fs::remove_file(dir.path().join(DOCUMENTS_DIR).join(ROOT_FILE)).unwrap();
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("is missing"), "{error}");

    write_doc(&dir, ROOT_FILE, ROOT);
    write_doc(&dir, "A-part.pdf", b"a different size entirely");
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("invalid size"), "{error}");
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'A'"),
        0
    );
}

#[test]
fn a_parent_whose_lineage_changed_after_the_split_is_refused() {
    let dir = library("drift");
    with_part_a(&dir);
    let b = part(&dir, "B", 20, 40);
    let receipt = issue(&dir, "A", "A-part.pdf", 200, &[b]).unwrap();
    db(&dir)
        .execute(
            "UPDATE material_split_lineage SET source_page_start = 111, source_page_end = 310
              WHERE material_id = 'A'",
            [],
        )
        .unwrap();
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("changed after it was split"), "{error}");
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'B'"),
        0
    );
}

#[test]
fn a_source_moved_to_another_file_or_removed_before_saving_is_refused() {
    let dir = library("moved");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    let a = part(&dir, "A", 1, 10);
    let receipt = issue(&dir, "R", ROOT_FILE, 400, &[a]).unwrap();
    write_doc(&dir, "R-replacement.pdf", ROOT);
    db(&dir)
        .execute(
            "UPDATE study_materials SET file_path = 'R-replacement.pdf' WHERE id = 'R'",
            [],
        )
        .unwrap();
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("different PDF"), "{error}");
    db(&dir)
        .execute("DELETE FROM study_materials WHERE id = 'R'", [])
        .unwrap();
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(
        error.contains("does not match") || error.contains("removed"),
        "{error}"
    );
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'A'"),
        0
    );
}

#[test]
fn presentation_must_name_exactly_the_planned_parts() {
    let dir = library("presentation");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    let receipt = issue(
        &dir,
        "R",
        ROOT_FILE,
        400,
        &[part(&dir, "A", 1, 10), part(&dir, "C", 11, 20)],
    )
    .unwrap();
    let mut wrong = shown(&receipt);
    wrong.reverse();
    assert!(save_split_batch_at(dir.path(), &receipt, &wrong).is_err());
    let mut blank = shown(&receipt);
    blank[0].title = "   ".to_string();
    assert!(save_split_batch_at(dir.path(), &receipt, &blank).is_err());
    assert!(save_split_batch_at(dir.path(), &receipt, &shown(&receipt)[..1]).is_err());
    assert_eq!(
        count(
            &dir,
            "SELECT COUNT(*) FROM study_materials WHERE id IN ('A', 'C')"
        ),
        0
    );
}

#[test]
fn a_saved_split_replays_and_reissuing_never_changes_a_settled_record() {
    let dir = library("replay");
    let receipt = with_part_a(&dir);
    let again = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap();
    assert!(again.idempotent_replay);
    assert_eq!(again.parts.len(), 1);
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'A'"),
        1
    );

    // The same split issued again leaves the committed record alone.
    let bytes = std::fs::read(dir.path().join(DOCUMENTS_DIR).join("A-part.pdf")).unwrap();
    let a = WrittenPart {
        id: "A".to_string(),
        first_page: 101,
        last_page: 300,
        file_path: "A-part.pdf".to_string(),
        file_size: bytes.len() as u64,
        original_file_name: "A.pdf".to_string(),
    };
    let reissued = issue(&dir, "R", ROOT_FILE, 400, &[a]).unwrap();
    assert_eq!(reissued.operation_id, receipt.operation_id);
    assert_eq!(
        status(&dir, &receipt.operation_id).as_deref(),
        Some("committed")
    );
    assert!(
        reconcile_split_batch_at(dir.path(), &receipt.operation_id)
            .unwrap()
            .reconciled
    );
}

#[test]
fn a_cancelled_split_stays_cancelled_and_cannot_be_saved() {
    let dir = library("cancelled");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    let a = part(&dir, "A", 1, 10);
    let kept = a.clone();
    let receipt = issue(&dir, "R", ROOT_FILE, 400, &[a]).unwrap();
    let cancelled = cancel_split_batch_at(dir.path(), &receipt.operation_id).unwrap();
    assert!(cancelled.cancelled);
    assert_eq!(cancelled.removed_files, vec!["A-part.pdf".to_string()]);

    write_doc(&dir, "A-part.pdf", b"synthetic part A pages 1-10");
    let reissued = issue(&dir, "R", ROOT_FILE, 400, &[kept]).unwrap();
    assert_eq!(reissued.operation_id, receipt.operation_id);
    assert_eq!(
        status(&dir, &receipt.operation_id).as_deref(),
        Some("cancelled")
    );
    let error = save_split_batch_at(dir.path(), &reissued, &shown(&reissued)).unwrap_err();
    assert!(error.contains("cancelled"), "{error}");
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'A'"),
        0
    );
}

#[test]
fn cancelling_removes_only_its_own_files_and_never_touches_a_saved_split() {
    let dir = library("cancel");
    let saved = with_part_a(&dir);
    write_doc(&dir, "unrelated.pdf", b"someone else's file");
    let pending = issue(&dir, "R", ROOT_FILE, 400, &[part(&dir, "C", 301, 400)]).unwrap();

    let result = cancel_split_batch_at(dir.path(), &saved.operation_id).unwrap();
    assert_eq!(
        (result.status.as_str(), result.cancelled),
        ("committed", false)
    );
    assert!(dir.path().join(DOCUMENTS_DIR).join("A-part.pdf").is_file());

    let result = cancel_split_batch_at(dir.path(), &pending.operation_id).unwrap();
    assert_eq!(result.removed_files, vec!["C-part.pdf".to_string()]);
    assert!(!dir.path().join(DOCUMENTS_DIR).join("C-part.pdf").exists());
    assert!(dir
        .path()
        .join(DOCUMENTS_DIR)
        .join("unrelated.pdf")
        .is_file());
    assert!(dir.path().join(DOCUMENTS_DIR).join(ROOT_FILE).is_file());

    // A second cancel removes nothing more; an unknown operation is reported.
    let again = cancel_split_batch_at(dir.path(), &pending.operation_id).unwrap();
    assert!(again.cancelled && again.removed_files.is_empty());
    assert_eq!(
        cancel_split_batch_at(dir.path(), "nope").unwrap().status,
        "unknown"
    );
}

#[test]
fn reconcile_reads_a_split_back_by_its_operation_id() {
    let dir = library("reconcile");
    let saved = with_part_a(&dir);
    let read = reconcile_split_batch_at(dir.path(), &saved.operation_id).unwrap();
    assert!(read.reconciled);
    assert_eq!(read.parts[0].id, "A");
    let pending = issue(&dir, "R", ROOT_FILE, 400, &[part(&dir, "C", 301, 400)]).unwrap();
    let read = reconcile_split_batch_at(dir.path(), &pending.operation_id).unwrap();
    assert_eq!((read.status.as_str(), read.reconciled), ("pending", false));
    assert_eq!(
        reconcile_split_batch_at(dir.path(), "nope").unwrap().status,
        "unknown"
    );
}

#[test]
fn an_existing_output_id_or_a_mid_save_failure_saves_nothing() {
    let dir = library("atomic");
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    material(&dir, "taken", "Already here", "taken.pdf", b"x");
    let receipt = issue(
        &dir,
        "R",
        ROOT_FILE,
        400,
        &[part(&dir, "A", 1, 10), part(&dir, "taken", 11, 20)],
    )
    .unwrap();
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("already exists"), "{error}");
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM study_materials WHERE id = 'A'"),
        0
    );

    let receipt = issue(
        &dir,
        "R",
        ROOT_FILE,
        400,
        &[part(&dir, "D", 1, 10), part(&dir, "E", 11, 20)],
    )
    .unwrap();
    db(&dir)
        .execute_batch(
            "CREATE TRIGGER fail_second BEFORE INSERT ON material_split_lineage
             WHEN NEW.material_id = 'E' BEGIN SELECT RAISE(FAIL, 'injected failure'); END;",
        )
        .unwrap();
    let error = save_split_batch_at(dir.path(), &receipt, &shown(&receipt)).unwrap_err();
    assert!(error.contains("injected failure"), "{error}");
    assert_eq!(
        count(
            &dir,
            "SELECT COUNT(*) FROM study_materials WHERE id IN ('D', 'E')"
        ),
        0
    );
    assert_eq!(
        count(&dir, "SELECT COUNT(*) FROM material_split_lineage"),
        0
    );
    assert_eq!(
        count(
            &dir,
            "SELECT COUNT(*) FROM material_tags WHERE material_id IN ('D', 'E')"
        ),
        0
    );
    assert_eq!(
        status(&dir, &receipt.operation_id).as_deref(),
        Some("pending")
    );
    // A refused save leaves the files for the interface to cancel.
    assert!(dir.path().join(DOCUMENTS_DIR).join("D-part.pdf").is_file());
}

#[test]
fn removing_the_original_keeps_every_part_and_its_history_truthfully() {
    let dir = library("delete");
    let saved = with_part_a(&dir);
    let b = part(&dir, "B", 20, 40);
    let nested = issue(&dir, "A", "A-part.pdf", 200, &[b]).unwrap();
    save_split_batch_at(dir.path(), &nested, &shown(&nested)).unwrap();

    db(&dir)
        .execute("DELETE FROM study_materials WHERE id = 'R'", [])
        .unwrap();
    assert_eq!(
        count(
            &dir,
            "SELECT COUNT(*) FROM study_materials WHERE id IN ('A', 'B')"
        ),
        2
    );
    let (_, root, start, end, _, _, _, root_title, root_hash, _, _, _) = lineage_of(&dir, "B");
    assert_eq!(root, None);
    assert_eq!((start, end), (120, 140));
    assert_eq!(root_title.as_deref(), Some("Root Handbook"));
    assert_eq!(root_hash, Some(calculate_sha256(ROOT)));
    let source: Option<String> = db(&dir)
        .query_row(
            "SELECT source_material_id FROM split_operation_log WHERE operation_id = ?1",
            [&saved.operation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(source, None);
    assert!(
        reconcile_split_batch_at(dir.path(), &saved.operation_id)
            .unwrap()
            .reconciled
    );

    // A part of A split now keeps the original's identity unknown — A is
    // never recorded as the original.
    let c = part(&dir, "C", 1, 5);
    let later = issue(&dir, "A", "A-part.pdf", 200, &[c]).unwrap();
    assert_eq!(later.core.root_material_id, None);
    save_split_batch_at(dir.path(), &later, &shown(&later)).unwrap();
    let (parent, root, _, _, _, _, _, _, _, _, _, _) = lineage_of(&dir, "C");
    assert_eq!((parent.as_deref(), root), (Some("A"), None));
}

#[test]
fn fingerprints_report_current_contents_and_missing_files() {
    let dir = library("fingerprint");
    write_doc(&dir, "here.pdf", b"present");
    let result = fingerprint_stored_documents_at(
        dir.path(),
        &["here.pdf".to_string(), "gone.pdf".to_string()],
    )
    .unwrap();
    assert_eq!(result[0].sha256, Some(calculate_sha256(b"present")));
    assert_eq!(result[1].sha256, None);
    assert!(fingerprint_stored_documents_at(dir.path(), &["../escape.pdf".to_string()]).is_err());
    let many: Vec<String> = (0..=MAX_HASH_REQUEST).map(|i| format!("{i}.pdf")).collect();
    assert!(fingerprint_stored_documents_at(dir.path(), &many).is_err());
}

#[test]
fn the_schema_13_validator_accepts_real_lineage_and_refuses_a_forged_record() {
    let dir = library("validator");
    with_part_a(&dir);
    let conn = db(&dir);
    crate::backup::verify_application_connection(&conn).unwrap();

    conn.execute(
        "UPDATE split_operation_log SET receipt_canonical_json = receipt_canonical_json || ' '",
        [],
    )
    .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("does not match its receipt"), "{error}");
}

#[test]
fn the_schema_13_validator_refuses_a_missing_lineage_index() {
    let dir = library("validator-index");
    let conn = db(&dir);
    conn.execute_batch("DROP INDEX idx_split_lineage_root;")
        .unwrap();
    let error = crate::backup::verify_application_connection(&conn).unwrap_err();
    assert!(error.contains("idx_split_lineage_root"), "{error}");
}

#[test]
fn a_library_without_split_tracking_refuses_receipts_and_saves() {
    let dir = TempDir::new("no-log");
    let conn = Connection::open(dir.path().join(DATABASE_FILE)).unwrap();
    for migration in crate::migrations().into_iter().filter(|m| m.version <= 12) {
        conn.execute_batch(migration.sql).unwrap();
    }
    drop(conn);
    material(&dir, "R", "Root", ROOT_FILE, ROOT);
    let error = issue(&dir, "R", ROOT_FILE, 400, &[part(&dir, "A", 1, 10)]).unwrap_err();
    assert!(error.contains("not been upgraded"), "{error}");
}

/// The receipt exactly as the webview receives it. `src/data/splitLineageShapes.test.ts`
/// checks its shape guard against this same file. Regenerate with
/// `SPLIT_LINEAGE_UPDATE_FIXTURE=1` after an intended change.
#[test]
fn the_serialized_receipt_matches_the_shared_fixture() {
    let dir = library("receipt-fixture");
    with_part_a(&dir);
    let b = part(&dir, "B", 20, 40);
    let receipt = issue(&dir, "A", "A-part.pdf", 200, &[b]).unwrap();
    let json = serde_json::to_string_pretty(&receipt).unwrap() + "\n";
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/split-lineage/receipt.json");
    if std::env::var("SPLIT_LINEAGE_UPDATE_FIXTURE").as_deref() == Ok("1") {
        std::fs::write(&path, &json).unwrap();
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
    let parsed: SplitSourceReceipt = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, receipt);
    let mut extra: serde_json::Value = serde_json::from_str(&json).unwrap();
    extra["core"]["plan"][0]["sourceContentSha256"] = serde_json::json!("forged");
    assert!(serde_json::from_value::<SplitSourceReceipt>(extra).is_err());
}

#[derive(serde::Deserialize)]
struct ValidationCase {
    name: String,
    category: String,
    sql: Vec<String>,
    expect: String,
}

#[derive(serde::Deserialize)]
struct ValidationContract {
    baseline: Vec<String>,
    cases: Vec<ValidationCase>,
}

/// The shared schema-13 contract; `src/data/splitLineageValidationParity.test.ts`
/// runs the same cases through the TypeScript twin.
#[test]
fn shared_lineage_validation_contract_native_outcomes() {
    let contract: ValidationContract = serde_json::from_str(include_str!(
        "../fixtures/split-lineage/validation-cases.json"
    ))
    .unwrap();
    let mut mismatches = Vec::new();
    for case in &contract.cases {
        let dir = TempDir::new("lineage-contract");
        let path = dir.path().join(DATABASE_FILE);
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for migration in crate::migrations() {
                conn.execute_batch(migration.sql).unwrap();
            }
            for statement in contract.baseline.iter().chain(&case.sql) {
                conn.execute_batch(statement)
                    .unwrap_or_else(|e| panic!("fixture statement failed: {statement}: {e}"));
            }
        }
        let conn = Connection::open(&path).unwrap();
        let result = crate::backup::verify_schema_13_lineage_semantics(&conn);
        let outcome = if result.is_ok() { "accept" } else { "refuse" };
        if outcome != case.expect {
            mismatches.push(format!(
                "{} [{}]: expected {}, got {result:?}",
                case.name, case.category, case.expect
            ));
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
    assert!(contract.cases.len() >= 15);
}

#[test]
fn pdf_skipped_page_receipt_refuses_invalid_order_bounds_and_overlap() {
    let dir = library("invalid-skips");
    material(&dir, "R", "Root Handbook", ROOT_FILE, ROOT);
    let kept = part(&dir, "B", 2, 3);
    for skipped in [vec![0], vec![5], vec![4, 1], vec![1, 1], vec![2]] {
        let error = issue_receipt_at(
            dir.path(),
            "R",
            ROOT_FILE,
            ROOT,
            4,
            std::slice::from_ref(&kept),
            &skipped,
        )
        .unwrap_err();
        assert_eq!(error, "The pages left out do not match this split.");
    }
}
