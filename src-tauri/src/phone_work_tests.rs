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

// ---- W-1: save my phone work ----

fn sql_now(offset: &str) -> String {
    Connection::open_in_memory()
        .unwrap()
        .query_row(
            &format!("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '{offset}')"),
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
}

fn docs_in(container: &Path) -> PathBuf {
    container.join("docs")
}

fn leftovers(dir: &Path) -> Vec<String> {
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                found.extend(leftovers(&path));
            } else if name.ends_with(".hfdbackup")
                || name.ends_with(".tmp")
                || name.ends_with(".replaced")
                || name.ends_with(".writing")
            {
                found.push(name);
            }
        }
    }
    found
}

#[test]
fn saving_writes_the_phone_copy_and_marks_everything_saved() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, &sql_now("-1 hour"));
    let docs = docs_in(&c);
    let now = now_utc().unwrap();
    let saved = save_phone_work_in(&root, &docs, "0.6.7", &now).unwrap();
    let file = docs.join(PHONE_WORK_ARCHIVE);
    assert!(file.is_file());
    assert!(saved.file_bytes > 0);
    assert_eq!(saved.file_name, PHONE_WORK_ARCHIVE);
    assert!(crate::backup::inspect_archive(&root, &file, "0.6.7").is_ok());
    assert_eq!(totals(&unsaved_phone_work_in(&root).unwrap()), [0, 0, 0, 0]);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn baseline_moves_only_after_a_successful_save() {
    for existing in [false, true] {
        let c = scratch();
        let root = root_in(&c);
        one_of_each(&root, &sql_now("-1 hour"));
        if existing {
            write_baseline(&root, "2020-01-01T00:00:00.000Z");
        }
        let before = std::fs::read(root.join(PHONE_WORK_FILE)).ok();
        let not_a_folder = c.join("docs-is-a-file");
        std::fs::write(&not_a_folder, b"x").unwrap();
        let now = now_utc().unwrap();
        assert!(save_phone_work_in(&root, &not_a_folder, "0.6.7", &now).is_err());
        assert_eq!(std::fs::read(root.join(PHONE_WORK_FILE)).ok(), before);
        assert_eq!(before.is_some(), existing);
        assert_eq!(totals(&unsaved_phone_work_in(&root).unwrap()), [1, 1, 1, 1]);
        assert!(leftovers(&c).is_empty(), "{:?}", leftovers(&c));
        std::fs::remove_dir_all(c).unwrap();
    }
}

#[test]
fn saving_again_replaces_the_previous_copy() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, &sql_now("-1 hour"));
    let docs = docs_in(&c);
    save_phone_work_in(&root, &docs, "0.6.7", &now_utc().unwrap()).unwrap();
    save_phone_work_in(&root, &docs, "0.6.7", &now_utc().unwrap()).unwrap();
    let names: Vec<_> = std::fs::read_dir(&docs)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(names, vec![PHONE_WORK_ARCHIVE.to_string()]);
    assert!(crate::backup::inspect_archive(&root, &docs.join(PHONE_WORK_ARCHIVE), "0.6.7").is_ok());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn save_never_moves_the_baseline_backwards() {
    let c = scratch();
    let root = root_in(&c);
    let ahead = sql_now("+1 hour");
    record_baseline_in(&root, &ahead).unwrap();
    save_phone_work_in(&root, &docs_in(&c), "0.6.7", &now_utc().unwrap()).unwrap();
    let text = std::fs::read_to_string(root.join(PHONE_WORK_FILE)).unwrap();
    assert!(text.contains(&ahead), "{text}");
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn a_row_written_during_the_snapshot_stays_unsaved() {
    let c = scratch();
    let root = root_in(&c);
    exec(
        &root,
        &format!(
            "INSERT INTO card_review_events VALUES ('{}');",
            sql_now("-1 hour")
        ),
    );
    let now = now_utc().unwrap();
    exec(
        &root,
        &format!(
            "INSERT INTO card_review_events VALUES ('{}');",
            sql_now("+1 second")
        ),
    );
    save_phone_work_in(&root, &docs_in(&c), "0.6.7", &now).unwrap();
    assert_eq!(unsaved_phone_work_in(&root).unwrap().reviews, 1);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn work_done_after_a_save_is_unsaved_again() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, &sql_now("-1 hour"));
    let docs = docs_in(&c);
    save_phone_work_in(&root, &docs, "0.6.7", &now_utc().unwrap()).unwrap();
    exec(
        &root,
        &format!(
            "INSERT INTO card_review_events VALUES ('{}');",
            sql_now("+1 minute")
        ),
    );
    assert_eq!(totals(&unsaved_phone_work_in(&root).unwrap()), [1, 0, 0, 0]);
    assert!(refuse_unsaved(&root, true).is_err());
    // A later "now" than the new row, as a real second save would have.
    save_phone_work_in(&root, &docs, "0.6.7", &sql_now("+2 minutes")).unwrap();
    assert!(refuse_unsaved(&root, true).is_ok());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn now_utc_is_rfc3339_utc() {
    let now = now_utc().unwrap();
    assert!(now.ends_with('Z'));
    let parsed: Option<f64> = Connection::open_in_memory()
        .unwrap()
        .query_row("SELECT julianday(?1)", [&now], |r| r.get(0))
        .unwrap();
    assert!(parsed.is_some());
}

#[test]
fn mac_refuses_the_phones_copy() {
    assert_eq!(
        refuse_phone_copy(Some("ios"), false).unwrap_err(),
        "This is your iPhone's copy \u{2014} it can't replace what's on the Mac."
    );
    assert!(refuse_phone_copy(Some("ios"), true).is_ok());
    assert!(refuse_phone_copy(Some("macos"), false).is_ok());
    assert!(refuse_phone_copy(None, false).is_ok());
}

#[test]
fn plain_words() {
    let text = format!(
        "{} {}",
        refuse_phone_copy(Some("ios"), false).unwrap_err(),
        PHONE_WORK_ARCHIVE
    )
    .to_lowercase();
    for word in [
        "sync", "ledger", "baseline", "database", "archive", "manifest", "restore",
    ] {
        assert!(!text.contains(word), "{word}");
    }
}

// ---- W-1b: keep a copy made before the last Mac restore ----

fn docs_names(docs: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(docs)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

fn restore_day() -> (String, String) {
    let at = "2026-11-04T10:00:00.000Z".to_string();
    (
        at,
        "My phone work (before 4 Nov 2026).hfdbackup".to_string(),
    )
}

/// Save once, restore at `restored`, add a review, return (root, docs, copy A bytes).
fn saved_then_restored(c: &Path, restored: &str) -> (PathBuf, PathBuf, Vec<u8>) {
    let root = root_in(c);
    one_of_each(&root, &sql_now("-1 hour"));
    let docs = docs_in(c);
    save_phone_work_in(&root, &docs, "0.6.7", "2026-11-03T10:00:00.000Z").unwrap();
    let a = std::fs::read(docs.join(PHONE_WORK_ARCHIVE)).unwrap();
    record_baseline_in(&root, restored).unwrap();
    exec(
        &root,
        "INSERT INTO card_review_events VALUES ('2026-11-05T00:00:00.000Z');",
    );
    (root, docs, a)
}

#[test]
fn old_baseline_file_without_new_fields_still_reads() {
    let c = scratch();
    let root = root_in(&c);
    write_baseline(&root, "2026-01-01T00:00:00.000Z");
    let file = read_file(&root).unwrap();
    assert_eq!(file.baseline_at, "2026-01-01T00:00:00.000Z");
    assert!(file.restored_at.is_none() && file.copy_saved_at.is_none());
    assert_eq!(
        read_baseline(&root).as_deref(),
        Some("2026-01-01T00:00:00.000Z")
    );
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn restore_then_save_keeps_the_earlier_copy() {
    let c = scratch();
    let (at, kept) = restore_day();
    let (root, docs, a) = saved_then_restored(&c, &at);
    let saved = save_phone_work_in(&root, &docs, "0.6.7", "2026-11-05T01:00:00.000Z").unwrap();
    assert_eq!(saved.kept_file_name.as_deref(), Some(kept.as_str()));
    assert_eq!(
        docs_names(&docs),
        vec![kept.clone(), PHONE_WORK_ARCHIVE.to_string()]
    );
    assert_eq!(std::fs::read(docs.join(&kept)).unwrap(), a);
    assert_ne!(std::fs::read(docs.join(PHONE_WORK_ARCHIVE)).unwrap(), a);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn saving_twice_without_a_restore_replaces_in_place() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, &sql_now("-1 hour"));
    let docs = docs_in(&c);
    save_phone_work_in(&root, &docs, "0.6.7", &sql_now("-2 minutes")).unwrap();
    let second = save_phone_work_in(&root, &docs, "0.6.7", &sql_now("-1 minutes")).unwrap();
    assert_eq!(docs_names(&docs), vec![PHONE_WORK_ARCHIVE.to_string()]);
    assert!(second.kept_file_name.is_none());
    // A save after a restore, then another save: the second keeps nothing new.
    record_baseline_in(&root, &sql_now("+1 hour")).unwrap();
    save_phone_work_in(&root, &docs, "0.6.7", &sql_now("+2 hours")).unwrap();
    let again = save_phone_work_in(&root, &docs, "0.6.7", &sql_now("+3 hours")).unwrap();
    assert!(again.kept_file_name.is_none());
    assert_eq!(docs_names(&docs).len(), 2);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn two_restores_on_the_same_day_keep_both_copies() {
    let c = scratch();
    let (at, kept) = restore_day();
    let (root, docs, a) = saved_then_restored(&c, &at);
    save_phone_work_in(&root, &docs, "0.6.7", "2026-11-04T11:00:00.000Z").unwrap();
    let b = std::fs::read(docs.join(PHONE_WORK_ARCHIVE)).unwrap();
    record_baseline_in(&root, "2026-11-04T12:00:00.000Z").unwrap();
    let saved = save_phone_work_in(&root, &docs, "0.6.7", "2026-11-04T13:00:00.000Z").unwrap();
    let second = "My phone work (before 4 Nov 2026) 2.hfdbackup".to_string();
    assert_eq!(saved.kept_file_name.as_deref(), Some(second.as_str()));
    assert_eq!(std::fs::read(docs.join(&kept)).unwrap(), a);
    assert_eq!(std::fs::read(docs.join(&second)).unwrap(), b);
    assert_eq!(docs_names(&docs).len(), 3);
    std::fs::remove_dir_all(c).unwrap();
}

#[cfg(unix)]
#[test]
fn failed_rename_overwrites_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let c = scratch();
    let (at, _) = restore_day();
    let (root, docs, a) = saved_then_restored(&c, &at);
    let baseline_before = std::fs::read(root.join(PHONE_WORK_FILE)).unwrap();
    std::fs::set_permissions(&docs, std::fs::Permissions::from_mode(0o555)).unwrap();
    let result = save_phone_work_in(&root, &docs, "0.6.7", "2026-11-05T01:00:00.000Z");
    std::fs::set_permissions(&docs, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        result.unwrap_err(),
        "Your earlier phone copy couldn't be kept, so nothing was replaced. Try again."
    );
    assert_eq!(std::fs::read(docs.join(PHONE_WORK_ARCHIVE)).unwrap(), a);
    assert_eq!(docs_names(&docs), vec![PHONE_WORK_ARCHIVE.to_string()]);
    assert_eq!(
        std::fs::read(root.join(PHONE_WORK_FILE)).unwrap(),
        baseline_before
    );
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn restore_keeps_copy_saved_at() {
    let c = scratch();
    let root = root_in(&c);
    save_phone_work_in(&root, &docs_in(&c), "0.6.7", "2026-11-03T10:00:00.000Z").unwrap();
    record_baseline_in(&root, "2026-11-04T10:00:00.000Z").unwrap();
    let file = read_file(&root).unwrap();
    assert_eq!(
        file.copy_saved_at.as_deref(),
        Some("2026-11-03T10:00:00.000Z")
    );
    assert_eq!(
        file.restored_at.as_deref(),
        Some("2026-11-04T10:00:00.000Z")
    );
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn save_keeps_restored_at() {
    let c = scratch();
    let root = root_in(&c);
    record_baseline_in(&root, "2026-11-04T10:00:00.000Z").unwrap();
    save_phone_work_in(&root, &docs_in(&c), "0.6.7", "2026-11-05T10:00:00.000Z").unwrap();
    let file = read_file(&root).unwrap();
    assert_eq!(
        file.restored_at.as_deref(),
        Some("2026-11-04T10:00:00.000Z")
    );
    assert_eq!(
        file.copy_saved_at.as_deref(),
        Some("2026-11-05T10:00:00.000Z")
    );
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn copy_without_copy_saved_at_after_a_restore_is_kept() {
    let c = scratch();
    let root = root_in(&c);
    let docs = docs_in(&c);
    save_phone_work_in(&root, &docs, "0.6.7", "2026-11-03T10:00:00.000Z").unwrap();
    let a = std::fs::read(docs.join(PHONE_WORK_ARCHIVE)).unwrap();
    // A W-1-era file: baseline and a restore time, but no copySavedAt.
    std::fs::write(
        root.join(PHONE_WORK_FILE),
        "{\"baselineAt\":\"2026-11-04T10:00:00.000Z\",\"restoredAt\":\"2026-11-04T10:00:00.000Z\"}",
    )
    .unwrap();
    let saved = save_phone_work_in(&root, &docs, "0.6.7", "2026-11-05T10:00:00.000Z").unwrap();
    let (_, kept) = restore_day();
    assert_eq!(saved.kept_file_name.as_deref(), Some(kept.as_str()));
    assert_eq!(std::fs::read(docs.join(&kept)).unwrap(), a);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn unknown_state_keeps_an_existing_copy() {
    let c = scratch();
    let root = root_in(&c);
    one_of_each(&root, &sql_now("-1 hour"));
    let docs = docs_in(&c);
    save_phone_work_in(&root, &docs, "0.6.7", &sql_now("-2 minutes")).unwrap();
    let a = std::fs::read(docs.join(PHONE_WORK_ARCHIVE)).unwrap();
    std::fs::remove_file(root.join(PHONE_WORK_FILE)).unwrap();
    let saved = save_phone_work_in(&root, &docs, "0.6.7", &sql_now("-1 minutes")).unwrap();
    let kept = saved.kept_file_name.expect("the earlier copy is kept");
    assert_eq!(std::fs::read(docs.join(&kept)).unwrap(), a);
    assert_eq!(docs_names(&docs).len(), 2);
    std::fs::remove_dir_all(c).unwrap();
}
