use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

const BLOCKED: &str = "This phone has 12 card reviews and 1 practice test that aren't saved anywhere else yet. Save my phone work first, then get your study material.";

fn scratch() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("hfd-phone-work-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("app")).unwrap();
    dir
}

/// A root with a small but valid application database plus the four ledger tables.
fn root_in(container: &Path) -> PathBuf {
    let root = container.join("app");
    let connection = Connection::open(root.join(DB_FILE)).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE settings (id TEXT PRIMARY KEY);
             CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT);
             CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
             CREATE TABLE audit_payload (value TEXT NOT NULL);
             INSERT INTO _sqlx_migrations(version) VALUES (9);
             INSERT INTO audit_payload(value) VALUES ('fictional record');
             CREATE TABLE card_review_events (reviewed_at TEXT);
             CREATE TABLE practice_attempts (started_at TEXT, status TEXT);
             CREATE TABLE material_bookmarks (updated_at TEXT);
             CREATE TABLE material_reading_state (updated_at TEXT);",
        )
        .unwrap();
    root
}

fn exec(root: &Path, sql: &str) {
    Connection::open(root.join(DB_FILE))
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}

fn write_baseline(root: &Path, at: &str) {
    std::fs::write(
        root.join(PHONE_WORK_FILE),
        format!("{{\"baselineAt\":\"{at}\"}}"),
    )
    .unwrap();
}

fn totals(w: &UnsavedPhoneWork) -> [i64; 4] {
    [w.reviews, w.tests, w.bookmarks, w.reading_positions]
}

fn one_of_each(root: &Path, at: &str) {
    exec(
        root,
        &format!(
            "INSERT INTO card_review_events VALUES ('{at}');
             INSERT INTO practice_attempts VALUES ('{at}', 'abandoned');
             INSERT INTO material_bookmarks VALUES ('{at}');
             INSERT INTO material_reading_state VALUES ('{at}');"
        ),
    );
}

#[test]
fn no_baseline_counts_every_row() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, "2026-01-01T00:00:00.000Z");
    let work = unsaved_phone_work_in(&root).unwrap();
    assert_eq!(totals(&work), [1, 1, 1, 1]);
    assert!(work.since.is_none());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn empty_tables_are_nothing_unsaved() {
    let c = scratch();
    let root = root_in(&c);
    let work = unsaved_phone_work_in(&root).unwrap();
    assert_eq!(totals(&work), [0, 0, 0, 0]);
    assert!(work.since.is_none());
    assert!(sentence(&work).is_none());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn rows_older_than_the_baseline_are_saved() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, "2026-01-01T00:00:00.000Z");
    write_baseline(&root, "2026-02-01T00:00:00Z");
    assert_eq!(totals(&unsaved_phone_work_in(&root).unwrap()), [0, 0, 0, 0]);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn rows_newer_than_the_baseline_are_unsaved_per_kind() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, "2026-03-01T00:00:00Z");
    exec(
        &root,
        "INSERT INTO card_review_events VALUES ('2026-03-02T00:00:00+00:00');
         INSERT INTO card_review_events VALUES ('2026-01-01T00:00:00Z');",
    );
    write_baseline(&root, "2026-02-01T00:00:00Z");
    let work = unsaved_phone_work_in(&root).unwrap();
    assert_eq!(totals(&work), [2, 1, 1, 1]);
    assert_eq!(work.since.as_deref(), Some("2026-02-01T00:00:00Z"));
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn timestamp_formats_all_compare_correctly() {
    let c = scratch();
    let root = root_in(&c);
    write_baseline(&root, "2026-05-01T12:00:00Z");
    exec(
        &root,
        "INSERT INTO card_review_events VALUES
           ('2026-05-01T12:00:01Z'), ('2026-05-01T12:00:01.000Z'), ('2026-05-01T12:00:01+00:00'),
           ('2026-05-01T11:59:59Z'), ('2026-05-01T11:59:59.000Z'), ('2026-05-01T11:59:59+00:00'),
           ('2026-05-01T12:00:00.000Z');",
    );
    assert_eq!(unsaved_phone_work_in(&root).unwrap().reviews, 3);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn baseline_is_never_older_than_the_newest_restored_row() {
    let c = scratch();
    let root = root_in(&c);
    exec(
        &root,
        "INSERT INTO card_review_events VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'));
         INSERT INTO material_bookmarks VALUES ('2020-01-01T00:00:00Z');",
    );
    let now: String = Connection::open_in_memory()
        .unwrap()
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .unwrap();
    record_baseline_in(&root, &now).unwrap();
    assert_eq!(totals(&unsaved_phone_work_in(&root).unwrap()), [0, 0, 0, 0]);
    // A genuinely later phone review is still caught.
    exec(
        &root,
        "INSERT INTO card_review_events VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours'));",
    );
    assert_eq!(unsaved_phone_work_in(&root).unwrap().reviews, 1);
    assert!(!root.join(format!("{PHONE_WORK_FILE}.writing")).exists());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn missing_or_corrupt_file_means_no_baseline() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, "2026-01-01T00:00:00Z");
    for garbage in ["not json", "{}", "{\"baselineAt\":5}", ""] {
        std::fs::write(root.join(PHONE_WORK_FILE), garbage).unwrap();
        let work = unsaved_phone_work_in(&root).unwrap();
        assert_eq!(totals(&work), [1, 1, 1, 1]);
        assert!(work.since.is_none());
    }
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn no_database_or_missing_tables_is_nothing_unsaved() {
    let c = scratch();
    let root = c.join("app");
    assert_eq!(totals(&unsaved_phone_work_in(&root).unwrap()), [0, 0, 0, 0]);
    record_baseline_in(&root, "2026-01-01T00:00:00Z").unwrap();
    assert_eq!(
        unsaved_phone_work_in(&root).unwrap().since.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
    std::fs::remove_dir_all(c).unwrap();
}

fn archive_of(root: &Path, container: &Path) -> PathBuf {
    let archive = container.join("picked.hfdbackup");
    crate::backup::write_complete_backup(root, &archive, "0.6.7").unwrap();
    archive
}

fn staged(root: &Path) -> bool {
    root.join(".restore-staging").exists() || root.join(".restore-pending").exists()
}

#[test]
fn phone_refuses_to_stage_with_unsaved_work() {
    let c = scratch();
    let root = root_in(&c);
    let archive = archive_of(&root, &c);
    exec(
        &root,
        "INSERT INTO card_review_events VALUES ('2026-03-01T00:00:00Z');",
    );
    let err = refuse_unsaved(&root, true).unwrap_err();
    assert!(err.contains("1 card review"), "{err}");
    assert!(err.contains("Save my phone work"), "{err}");
    let err = crate::backup::stage_complete_restore_guarded_in(&root, &archive, "0.6.7", true)
        .unwrap_err();
    assert!(err.contains("Save my phone work"), "{err}");
    assert!(!staged(&root));
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_stages_when_nothing_is_unsaved() {
    let c = scratch();
    let root = root_in(&c);
    let archive = archive_of(&root, &c);
    crate::backup::stage_complete_restore_guarded_in(&root, &archive, "0.6.7", true).unwrap();
    assert!(root.join(".restore-pending").is_dir());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_stages_again_after_the_baseline_moves() {
    let c = scratch();
    let root = root_in(&c);
    let archive = archive_of(&root, &c);
    exec(
        &root,
        "INSERT INTO card_review_events VALUES ('2026-03-01T00:00:00Z');",
    );
    assert!(
        crate::backup::stage_complete_restore_guarded_in(&root, &archive, "0.6.7", true).is_err()
    );
    record_baseline_in(&root, "2026-03-02T00:00:00Z").unwrap();
    crate::backup::stage_complete_restore_guarded_in(&root, &archive, "0.6.7", true).unwrap();
    assert!(root.join(".restore-pending").is_dir());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn mac_is_unaffected() {
    let c = scratch();
    let root = root_in(&c);
    let archive = archive_of(&root, &c);
    exec(
        &root,
        "INSERT INTO card_review_events VALUES ('2026-03-01T00:00:00Z');",
    );
    assert!(refuse_unsaved(&root, false).is_ok());
    crate::backup::stage_complete_restore_guarded_in(&root, &archive, "0.6.7", false).unwrap();
    assert!(root.join(".restore-pending").is_dir());
    std::fs::remove_dir_all(c).unwrap();
}

fn work(reviews: i64, tests: i64, bookmarks: i64, reading_positions: i64) -> UnsavedPhoneWork {
    UnsavedPhoneWork {
        reviews,
        tests,
        bookmarks,
        reading_positions,
        since: None,
    }
}

#[test]
fn sentence_matches_the_typescript_wording() {
    assert_eq!(sentence(&work(12, 1, 0, 0)).as_deref(), Some(BLOCKED));
}

#[test]
fn sentence_handles_each_kind_and_plurals() {
    let s = sentence(&work(1, 2, 1, 1)).unwrap();
    assert!(
        s.contains("1 card review, 2 practice tests, 1 bookmark, and 1 reading position that"),
        "{s}"
    );
    assert!(sentence(&work(0, 0, 0, 3))
        .unwrap()
        .contains("3 reading positions that"));
    assert!(sentence(&work(0, 0, 0, 0)).is_none());
}

#[test]
fn sentence_uses_plain_words() {
    let s = sentence(&work(12, 1, 3, 2)).unwrap().to_lowercase();
    for word in ["baseline", "ledger", "sync", "restore", "database"] {
        assert!(!s.contains(word), "{word}");
    }
}
