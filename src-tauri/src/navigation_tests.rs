//! Native document navigation contract (M4 Slice 1): real rusqlite
//! transactions on the registered migrations, real PDFs written with lopdf,
//! the shared cases in `fixtures/navigation/`, and the wire commands. Every
//! value is synthetic.

use super::*;
use std::path::PathBuf;

use lopdf::{dictionary, Document, Object};

use crate::practice_sessions::{mark_root_ready, unmark_root_ready};

/// An owned temporary directory, cleaned up on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "hfd-navigation-test-{label}-{}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
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

const MAT: &str = "mat-navigation-1";
const OTHER: &str = "mat-navigation-2";

/// A minimal, real PDF with `pages` pages; `salt` changes its bytes.
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
            "Type" => "Pages",
            "Count" => i64::from(pages),
            "Kids" => kids,
        }),
    );
    let catalog_id = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    document.trailer.set("Root", catalog_id);
    document.trailer.set(
        "Info",
        Object::Dictionary(dictionary! { "Title" => Object::string_literal(salt) }),
    );
    let mut out = Vec::new();
    document.save_to(&mut out).unwrap();
    out
}

/// A library database with every registered migration, two materials and a
/// managed file path for the first.
fn library(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);",
    )
    .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    for (id, file) in [(MAT, Some("ifh.pdf")), (OTHER, None)] {
        conn.execute(
            "INSERT INTO study_materials (id, title, material_type, topic, file_path, created_at, updated_at)
             VALUES (?1, 'Synthetic handbook', 'handbook', 'general', ?2, 'x', 'x')",
            params![id, file],
        )
        .unwrap();
    }
    conn
}

fn write_file(root: &Path, name: &str, bytes: &[u8]) {
    std::fs::write(root.join(DOCUMENTS_DIR).join(name), bytes).unwrap();
}

fn op(conn: &mut Connection, value: Value) -> Check<Value> {
    let decoded = decode_operation(&value)?;
    run_operation_on(conn, &decoded)
}

fn begin_op(conn: &mut Connection, supersede: Option<i64>) -> Check<i64> {
    op(
        conn,
        json!({ "kind": "begin", "materialId": MAT, "supersedeGeneration": supersede }),
    )
    .map(|v| v["generation"].as_i64().unwrap())
}

fn commit_op(
    conn: &mut Connection,
    generation: i64,
    hash: &str,
    page: i64,
    label: Option<&str>,
) -> Value {
    op(
        conn,
        json!({
            "kind": "commit", "materialId": MAT, "generation": generation,
            "contentSha256": hash, "physicalPage": page, "pageLabel": label,
        }),
    )
    .unwrap()
}

fn set_read_op(
    conn: &mut Connection,
    hash: &str,
    owner: i64,
    page: i64,
    confirmed: bool,
) -> Check<Value> {
    op(
        conn,
        json!({
            "kind": "set_read", "materialId": MAT, "expectedContentSha256": hash,
            "expectedOwnerGeneration": owner, "physicalPage": page, "confirmed": confirmed,
        }),
    )
}

/// The exact stored tuple, or None.
/// (page, label, confirmed_read, origin hash, status, owner generation)
type Tuple = (i64, Option<String>, i64, Option<String>, String, i64);

fn tuple(conn: &Connection) -> Option<Tuple> {
    conn.query_row(
        "SELECT last_requested_page, last_requested_page_label, confirmed_read, originating_content_sha256, status, owner_generation
           FROM material_reading_state WHERE material_id = ?1",
        [MAT],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    )
    .optional()
    .unwrap()
}

fn claim(conn: &Connection) -> Option<(i64, i64)> {
    claim_of(conn, MAT).unwrap()
}

/// A library whose material has a verified 50-page identity and page 5 saved.
fn seeded(root: &Path) -> (Connection, String) {
    let mut conn = library(root);
    write_file(root, "ifh.pdf", &pdf_bytes(50, "a"));
    let identity = inspect_identity_on(&mut conn, root, MAT).unwrap();
    let hash = identity["contentSha256"].as_str().unwrap().to_string();
    let token = begin_op(&mut conn, None).unwrap();
    assert_eq!(
        commit_op(&mut conn, token, &hash, 5, Some("v"))["committed"],
        true
    );
    (conn, hash)
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

#[test]
fn requests_are_decoded_strictly() {
    let good = json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 3, "pageLabel": null });
    assert!(decode_operation(&good).is_ok());
    let mut extra = good.clone();
    extra["status"] = json!("active");
    for bad in [
        extra,
        json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "A".repeat(64), "physicalPage": 3, "pageLabel": null }),
        json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 0, "pageLabel": null }),
        json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 2.5, "pageLabel": null }),
        json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 9_007_199_254_740_992_i64, "pageLabel": null }),
        json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 3, "pageLabel": " iv" }),
        json!({ "kind": "commit", "materialId": MAT, "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 3, "pageLabel": "x".repeat(101) }),
        json!({ "kind": "commit", "materialId": "../x", "generation": 1, "contentSha256": "a".repeat(64), "physicalPage": 3, "pageLabel": null }),
        json!({ "kind": "begin", "materialId": MAT }),
        json!({ "kind": "erase", "materialId": MAT }),
        json!({ "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": "a".repeat(64), "bookmarkId": "b1", "physicalPage": 1, "pageLabel": null, "title": "", "notes": "" }),
        json!({ "kind": "add_bookmark", "materialId": MAT, "bookmarkId": "b1", "physicalPage": 1, "pageLabel": null, "title": "t", "notes": "" }),
        json!({ "kind": "set_read", "materialId": MAT, "physicalPage": 5, "confirmed": true }),
        json!({ "kind": "set_read", "materialId": MAT, "expectedContentSha256": "a".repeat(64), "expectedOwnerGeneration": 0, "physicalPage": 5, "confirmed": true }),
        json!({ "kind": "set_read", "materialId": MAT, "expectedContentSha256": "a".repeat(64), "expectedOwnerGeneration": 1, "physicalPage": 5, "confirmed": "yes" }),
    ] {
        assert_eq!(decode_operation(&bad), Err(Code::InvalidArgument), "{bad}");
    }
}

/* ------------------------------------------------------------------ */
/* Reservation: durable, increasing, fail-closed (R28, R33, R38)        */
/* ------------------------------------------------------------------ */

#[test]
fn reservations_are_distinct_increasing_and_durable_across_connections() {
    let dir = TempDir::new("tokens");
    let mut a = library(dir.path());
    let mut b = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    b.pragma_update(None, "foreign_keys", "ON").unwrap();
    let t1 = begin_op(&mut a, None).unwrap();
    let t2 = begin_op(&mut b, None).unwrap();
    let t3 = begin_op(&mut a, None).unwrap();
    assert_eq!([t1, t2, t3], [1, 2, 3]);
    drop(a);
    drop(b);
    let mut reopened = Connection::open(dir.path().join("her-flight-deck.db")).unwrap();
    assert_eq!(
        claim(&reopened),
        Some((3, 0)),
        "each token was durable before it was returned"
    );
    assert_eq!(
        begin_op(&mut reopened, None).unwrap(),
        4,
        "a restart continues the sequence"
    );
}

#[test]
fn a_reservation_that_cannot_be_written_issues_no_token() {
    let dir = TempDir::new("abort");
    let (mut conn, _) = seeded(dir.path());
    let before = claim(&conn);
    conn.execute_batch("CREATE TRIGGER block_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, 'blocked'); END;")
        .unwrap();
    for _ in 0..2 {
        assert_eq!(begin_op(&mut conn, None), Err(Code::StorageFailure));
    }
    assert_eq!(claim(&conn), before);
    assert_eq!(tuple(&conn).unwrap().0, 5);
}

#[test]
fn an_ignored_claim_write_issues_no_token() {
    for phase in ["INSERT", "UPDATE"] {
        let dir = TempDir::new("ignore");
        let (mut conn, _) = seeded(dir.path());
        if phase == "INSERT" {
            conn.execute("DELETE FROM material_operation_claims", [])
                .unwrap();
        }
        let before = claim(&conn);
        conn.execute_batch(&format!(
            "CREATE TRIGGER ignore_claim BEFORE {phase} ON material_operation_claims BEGIN SELECT RAISE(IGNORE); END;"
        ))
        .unwrap();
        for _ in 0..2 {
            assert_eq!(
                begin_op(&mut conn, None),
                Err(Code::StorageFailure),
                "{phase}"
            );
        }
        assert_eq!(
            claim(&conn),
            before,
            "{phase}: the prior claim is unchanged"
        );
        assert_eq!(
            tuple(&conn).unwrap().0,
            5,
            "{phase}: the saved tuple is unchanged"
        );
    }
}

#[test]
fn a_claim_that_persists_the_wrong_token_fails_closed_and_rolls_back() {
    let dir = TempDir::new("skew");
    let (mut conn, _) = seeded(dir.path());
    let before = claim(&conn);
    conn.execute_batch(
        "CREATE TRIGGER skew AFTER UPDATE OF reserved_generation ON material_operation_claims
           WHEN NEW.reserved_generation <> 999
           BEGIN UPDATE material_operation_claims SET reserved_generation = 999 WHERE material_id = NEW.material_id; END;",
    )
    .unwrap();
    assert_eq!(begin_op(&mut conn, None), Err(Code::StorageFailure));
    assert_eq!(claim(&conn), before);
}

#[test]
fn reservation_refuses_overflow_without_changing_the_claim() {
    let dir = TempDir::new("overflow");
    let mut conn = library(dir.path());
    conn.execute(
        "INSERT INTO material_operation_claims VALUES (?1, ?2, 0, 'x')",
        params![MAT, MAX_SAFE - 1],
    )
    .unwrap();
    assert_eq!(begin_op(&mut conn, None), Err(Code::LimitExceeded));
    assert_eq!(claim(&conn), Some((MAX_SAFE - 1, 0)));
}

#[test]
fn begin_supersedes_only_a_token_that_was_issued() {
    let dir = TempDir::new("supersede");
    let mut conn = library(dir.path());
    let a = begin_op(&mut conn, None).unwrap();
    assert_eq!(begin_op(&mut conn, Some(a + 5)), Err(Code::InvalidArgument));
    let b = begin_op(&mut conn, Some(a)).unwrap();
    assert_eq!(claim(&conn), Some((b, a)));
}

/* ------------------------------------------------------------------ */
/* Commit: exact current claim, trusted identity, whole tuple (R34)     */
/* ------------------------------------------------------------------ */

#[test]
fn only_the_exact_current_token_commits_and_refusals_write_nothing() {
    let dir = TempDir::new("commit");
    let (mut conn, hash) = seeded(dir.path());
    let before = tuple(&conn);
    let owner = begin_op(&mut conn, None).unwrap();

    let future = commit_op(&mut conn, owner + 100, &hash, 9, None);
    assert_eq!(future["committed"], false);
    assert_eq!(future["reason"], "unreserved");
    let stale = commit_op(&mut conn, owner - 1, &hash, 9, None);
    assert_eq!(stale["reason"], "superseded");
    assert_eq!(tuple(&conn), before, "refusals leave the exact tuple");

    let ok = commit_op(&mut conn, owner, &hash, 20, Some("xx"));
    assert_eq!(ok["committed"], true);
    assert_eq!(
        tuple(&conn),
        Some((
            20,
            Some("xx".into()),
            0,
            Some(hash.clone()),
            "active".into(),
            owner
        ))
    );
    let replay = commit_op(&mut conn, owner, &hash, 42, None);
    assert_eq!(
        replay["reason"], "replayed",
        "a committed token cannot write again"
    );
    assert_eq!(tuple(&conn).unwrap().0, 20);
}

#[test]
fn a_commit_needs_a_claim_and_the_recorded_identity() {
    let dir = TempDir::new("identity");
    let mut conn = library(dir.path());
    assert_eq!(
        commit_op(&mut conn, 1, &"a".repeat(64), 1, None)["reason"],
        "unreserved"
    );
    let token = begin_op(&mut conn, None).unwrap();
    assert_eq!(
        commit_op(&mut conn, token, &"a".repeat(64), 1, None)["reason"],
        "identity_unknown"
    );
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(10, "b"));
    let hash = inspect_identity_on(&mut conn, dir.path(), MAT).unwrap()["contentSha256"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        commit_op(&mut conn, token, &"b".repeat(64), 1, None)["reason"],
        "identity_changed"
    );
    assert_eq!(
        commit_op(&mut conn, token, &hash, 11, None)["reason"],
        "out_of_bounds"
    );
    assert!(tuple(&conn).is_none());
    assert_eq!(
        commit_op(&mut conn, token, &hash, 10, None)["committed"],
        true
    );
}

#[test]
fn a_late_commit_for_a_superseded_or_cancelled_token_is_refused_inside_its_transaction() {
    let dir = TempDir::new("late");
    let (mut conn, hash) = seeded(dir.path());
    let before = tuple(&conn);
    let a = begin_op(&mut conn, None).unwrap();
    let b = begin_op(&mut conn, Some(a)).unwrap();
    assert_eq!(
        commit_op(&mut conn, a, &hash, 10, None)["reason"],
        "cancelled"
    );
    assert_eq!(tuple(&conn), before);
    op(
        &mut conn,
        json!({ "kind": "cancel", "materialId": MAT, "generation": b }),
    )
    .unwrap();
    assert_eq!(
        commit_op(&mut conn, b, &hash, 20, None)["reason"],
        "cancelled"
    );
    assert_eq!(
        tuple(&conn),
        before,
        "nothing a cancelled request sends can land"
    );
}

#[test]
fn a_claim_that_cannot_be_read_refuses_the_commit() {
    let dir = TempDir::new("unreadable");
    let (mut conn, hash) = seeded(dir.path());
    let token = begin_op(&mut conn, None).unwrap();
    conn.execute_batch("DROP TABLE material_operation_claims;")
        .unwrap();
    let decoded = decode_operation(&json!({
        "kind": "commit", "materialId": MAT, "generation": token,
        "contentSha256": hash, "physicalPage": 9, "pageLabel": null,
    }))
    .unwrap();
    assert_eq!(
        run_operation_on(&mut conn, &decoded),
        Err(Code::StorageFailure)
    );
    assert_eq!(tuple(&conn).unwrap().0, 5);
}

/* ------------------------------------------------------------------ */
/* Read confirmation and bookmarks                                     */
/* ------------------------------------------------------------------ */

#[test]
fn read_confirmation_applies_only_to_the_current_page_and_resets_on_a_new_request() {
    let dir = TempDir::new("read");
    let (mut conn, hash) = seeded(dir.path());
    let owner = tuple(&conn).unwrap().5;
    assert_eq!(
        set_read_op(&mut conn, &hash, owner, 6, true),
        Err(Code::StaleState)
    );
    let state = set_read_op(&mut conn, &hash, owner, 5, true).unwrap();
    assert_eq!(state["confirmedRead"], true);
    let cleared = set_read_op(&mut conn, &hash, owner, 5, false).unwrap();
    assert_eq!(
        cleared["confirmedRead"], false,
        "clearing is its own explicit step"
    );
    set_read_op(&mut conn, &hash, owner, 5, true).unwrap();
    let token = begin_op(&mut conn, None).unwrap();
    commit_op(&mut conn, token, &hash, 8, None);
    assert_eq!(
        tuple(&conn).unwrap().2,
        0,
        "a new request is not confirmed reading"
    );
    assert_eq!(
        set_read_op(&mut conn, &hash, owner, 5, true),
        Err(Code::StaleState)
    );
}

/// M4S1-R1, the reviewed sequence: content A is saved at page 5 and its
/// confirmation is held; the file becomes content B and B is saved at page 5
/// too. The held confirmation (and a held clear) must change nothing.
#[test]
fn a_held_confirmation_for_replaced_content_at_the_same_page_changes_nothing() {
    let dir = TempDir::new("read-stale-content");
    let (mut conn, hash_a) = seeded(dir.path());
    let owner_a = tuple(&conn).unwrap().5;
    set_read_op(&mut conn, &hash_a, owner_a, 5, true).unwrap();
    let held_confirm = (hash_a.clone(), owner_a, 5, true);
    let held_clear = (hash_a.clone(), owner_a, 5, false);

    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "b"));
    let hash_b = inspect_identity_on(&mut conn, dir.path(), MAT).unwrap()["contentSha256"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(hash_a, hash_b);
    let token = begin_op(&mut conn, None).unwrap();
    assert_eq!(
        commit_op(&mut conn, token, &hash_b, 5, None)["committed"],
        true
    );
    let before = tuple(&conn).unwrap();
    assert_eq!(before.2, 0);

    for (hash, owner, page, confirmed) in [held_confirm, held_clear] {
        assert_eq!(
            set_read_op(&mut conn, &hash, owner, page, confirmed),
            Err(Code::StaleState)
        );
        assert_eq!(
            tuple(&conn).unwrap(),
            before,
            "the stored tuple is untouched"
        );
    }
    // The current request can still be confirmed and cleared.
    assert_eq!(
        set_read_op(&mut conn, &hash_b, token, 5, true).unwrap()["confirmedRead"],
        true
    );
    assert_eq!(
        set_read_op(&mut conn, &hash_b, token, 5, false).unwrap()["confirmedRead"],
        false
    );
}

/// M4S1-R1: same content and page, but a newer saved request. A confirmation
/// held from the older request is stale even though page and hash agree.
#[test]
fn a_held_confirmation_from_an_older_generation_of_the_same_page_changes_nothing() {
    let dir = TempDir::new("read-stale-generation");
    let (mut conn, hash) = seeded(dir.path());
    let old_owner = tuple(&conn).unwrap().5;
    let token = begin_op(&mut conn, None).unwrap();
    assert_eq!(
        commit_op(&mut conn, token, &hash, 5, Some("v"))["committed"],
        true
    );
    set_read_op(&mut conn, &hash, token, 5, true).unwrap();
    let before = tuple(&conn).unwrap();
    for confirmed in [true, false] {
        assert_eq!(
            set_read_op(&mut conn, &hash, old_owner, 5, confirmed),
            Err(Code::StaleState)
        );
        assert_eq!(tuple(&conn).unwrap(), before);
    }
}

#[test]
fn bookmarks_need_a_verified_identity_and_an_in_range_page() {
    let dir = TempDir::new("bookmarks");
    let mut conn = library(dir.path());
    let add = |conn: &mut Connection, hash: &str, id: &str, page: i64| {
        op(
            conn,
            json!({
                "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": hash,
                "bookmarkId": id, "physicalPage": page,
                "pageLabel": "3-12", "title": "Airspace chart", "notes": "",
            }),
        )
    };
    let unknown = "a".repeat(64);
    assert_eq!(
        add(&mut conn, &unknown, "b1", 3),
        Err(Code::IdentityUnknown)
    );
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(12, "c"));
    let hash = inspect_identity_on(&mut conn, dir.path(), MAT).unwrap()["contentSha256"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(add(&mut conn, &hash, "b1", 13), Err(Code::PageOutOfRange));
    assert_eq!(
        add(&mut conn, &unknown, "b1", 3),
        Err(Code::StaleState),
        "a bookmark made for other content is refused"
    );
    let saved = add(&mut conn, &hash, "b1", 3).unwrap();
    assert_eq!(saved["status"], "verified");
    assert_eq!(saved["originatingContentSha256"], hash);
    assert_eq!(
        add(&mut conn, &hash, "b1", 4),
        Err(Code::InvalidArgument),
        "ids are unique"
    );
    let listed = op(&mut conn, json!({ "kind": "read", "materialId": MAT })).unwrap();
    assert_eq!(listed["bookmarks"].as_array().unwrap().len(), 1);
    let gone = op(
        &mut conn,
        json!({ "kind": "delete_bookmark", "materialId": MAT, "bookmarkId": "b1" }),
    )
    .unwrap();
    assert_eq!(gone["deleted"], true);
    let again = op(
        &mut conn,
        json!({ "kind": "delete_bookmark", "materialId": MAT, "bookmarkId": "b1" }),
    )
    .unwrap();
    assert_eq!(again["deleted"], false);
}

#[test]
fn bookmarks_are_limited_per_material() {
    let dir = TempDir::new("limit");
    let (mut conn, hash) = seeded(dir.path());
    for i in 0..MAX_BOOKMARKS_PER_MATERIAL {
        conn.execute(
            "INSERT INTO material_bookmarks (id, material_id, page_index, originating_content_sha256, title, created_at, updated_at)
             VALUES (?1, ?2, 1, ?3, 't', 'x', 'x')",
            params![format!("seed{i}"), MAT, hash],
        )
        .unwrap();
    }
    let over = op(
        &mut conn,
        json!({
            "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": hash,
            "bookmarkId": "one-more", "physicalPage": 1,
            "pageLabel": null, "title": "t", "notes": "",
        }),
    );
    assert_eq!(over, Err(Code::LimitExceeded));
}

/* ------------------------------------------------------------------ */
/* Trusted identity and reconciliation                                 */
/* ------------------------------------------------------------------ */

#[test]
fn identity_comes_from_the_file_bytes_and_replacement_marks_saved_places_drifted() {
    let dir = TempDir::new("drift");
    let (mut conn, first_hash) = seeded(dir.path());
    op(
        &mut conn,
        json!({
            "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": first_hash,
            "bookmarkId": "b1", "physicalPage": 40,
            "pageLabel": null, "title": "Late chapter", "notes": "",
        }),
    )
    .unwrap();
    // Same file again: unchanged.
    let same = inspect_identity_on(&mut conn, dir.path(), MAT).unwrap();
    assert_eq!(same["changed"], false);
    assert_eq!(same["totalPages"], 50);

    // Replaced with different, shorter bytes.
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(20, "replaced"));
    let replaced = inspect_identity_on(&mut conn, dir.path(), MAT).unwrap();
    assert_eq!(replaced["changed"], true);
    assert_eq!(replaced["totalPages"], 20);
    assert_ne!(replaced["contentSha256"], first_hash);
    let state = op(&mut conn, json!({ "kind": "read", "materialId": MAT })).unwrap();
    assert_eq!(state["readingState"]["status"], "drifted");
    assert_eq!(
        state["readingState"]["lastRequestedPage"], 5,
        "the saved page is kept, not moved"
    );
    assert_eq!(state["bookmarks"][0]["status"], "drifted");

    // Restored to the original bytes: verified again.
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "a"));
    inspect_identity_on(&mut conn, dir.path(), MAT).unwrap();
    let state = op(&mut conn, json!({ "kind": "read", "materialId": MAT })).unwrap();
    assert_eq!(state["readingState"]["status"], "active");
    assert_eq!(state["bookmarks"][0]["status"], "verified");
}

#[test]
fn missing_and_unreadable_files_are_refused_without_recording_an_identity() {
    let dir = TempDir::new("missing");
    let mut conn = library(dir.path());
    assert_eq!(
        inspect_identity_on(&mut conn, dir.path(), MAT),
        Err(Code::FileMissing)
    );
    assert_eq!(
        inspect_identity_on(&mut conn, dir.path(), OTHER),
        Err(Code::FileMissing)
    );
    assert_eq!(
        inspect_identity_on(&mut conn, dir.path(), "nope"),
        Err(Code::NotFound)
    );
    write_file(dir.path(), "ifh.pdf", b"not a pdf at all");
    assert_eq!(
        inspect_identity_on(&mut conn, dir.path(), MAT),
        Err(Code::NotAPdf)
    );
    assert_eq!(identity_of(&conn, MAT).unwrap(), None);
}

#[test]
fn deleting_a_material_removes_all_four_kinds_of_navigation_rows() {
    let dir = TempDir::new("cascade");
    let (mut conn, hash) = seeded(dir.path());
    op(
        &mut conn,
        json!({
            "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": hash,
            "bookmarkId": "b1", "physicalPage": 2,
            "pageLabel": null, "title": "t", "notes": "",
        }),
    )
    .unwrap();
    conn.execute("DELETE FROM study_materials WHERE id = ?1", [MAT])
        .unwrap();
    for table in [
        "material_content_identities",
        "material_reading_state",
        "material_bookmarks",
        "material_operation_claims",
    ] {
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "{table}");
    }
}

/* ------------------------------------------------------------------ */
/* Wire commands                                                       */
/* ------------------------------------------------------------------ */

#[test]
fn wire_commands_refuse_until_the_library_is_ready_and_return_allowlisted_errors() {
    let dir = TempDir::new("wire");
    let _conn = library(dir.path());
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(7, "w"));
    let input = json!({ "materialId": MAT });
    assert_eq!(
        inspect_navigation_identity_at(dir.path(), &input),
        Err(Code::StorageFailure.error())
    );
    mark_root_ready(dir.path());
    let identity = inspect_navigation_identity_at(dir.path(), &input).unwrap();
    assert_eq!(identity["totalPages"], 7);
    let begun = navigation_operation_at(
        dir.path(),
        &json!({ "kind": "begin", "materialId": MAT, "supersedeGeneration": null }),
    )
    .unwrap();
    assert_eq!(begun["generation"], 1);
    let refused = navigation_operation_at(
        dir.path(),
        &json!({ "kind": "read", "materialId": "missing" }),
    );
    assert_eq!(refused, Err(Code::NotFound.error()));
    let wire = serde_json::to_value(Code::NotFound.error()).unwrap();
    assert_eq!(
        wire,
        json!({ "code": "NOT_FOUND", "message": "That study material is no longer here." })
    );
    unmark_root_ready(dir.path());
}

/* ------------------------------------------------------------------ */
/* Schema 15: upgrade, rollback, verification, backup and restore       */
/* ------------------------------------------------------------------ */

fn navigation_rows(conn: &Connection) -> Vec<String> {
    let mut out = Vec::new();
    for table in crate::backup::NAVIGATION_TABLES {
        let mut statement = conn
            .prepare(&format!("SELECT * FROM {table} ORDER BY 1, 2"))
            .unwrap();
        let width = statement.column_count();
        let rows = statement
            .query_map([], |r| {
                let mut cells = Vec::with_capacity(width);
                for i in 0..width {
                    cells.push(format!("{:?}", r.get::<_, rusqlite::types::Value>(i)?));
                }
                Ok(format!("{table}|{}", cells.join("|")))
            })
            .unwrap();
        out.extend(rows.map(Result::unwrap));
    }
    out
}

/// A populated schema-14 library: materials, a study set and a split part.
fn populated_schema14(root: &Path) -> Connection {
    let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for m in crate::migrations().into_iter().filter(|m| m.version <= 14) {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO study_materials (id, title, material_type, topic, file_path, created_at, updated_at)
         VALUES (?1, 'Synthetic handbook', 'handbook', 'general', 'ifh.pdf', 'x', 'x')",
        [MAT],
    )
    .unwrap();
    conn
}

fn table_dump(conn: &Connection, table: &str) -> Vec<String> {
    let mut statement = conn
        .prepare(&format!("SELECT * FROM {table} ORDER BY 1"))
        .unwrap();
    let width = statement.column_count();
    let rows = statement
        .query_map([], |r| {
            let mut cells = Vec::with_capacity(width);
            for i in 0..width {
                cells.push(format!("{:?}", r.get::<_, rusqlite::types::Value>(i)?));
            }
            Ok(cells.join("|"))
        })
        .unwrap();
    rows.map(Result::unwrap).collect()
}

fn migration_15() -> &'static str {
    crate::migrations()
        .into_iter()
        .find(|m| m.version == 15)
        .unwrap()
        .sql
}

#[test]
fn a_populated_schema14_library_upgrades_to_15_keeping_every_row() {
    let dir = TempDir::new("upgrade");
    let conn = populated_schema14(dir.path());
    let before: Vec<Vec<String>> = ["study_materials", "skill_catalog_entries", "settings"]
        .iter()
        .map(|t| table_dump(&conn, t))
        .collect();
    crate::backup::verify_application_connection(&conn).unwrap();
    conn.execute_batch(&format!(
        "BEGIN; {} INSERT INTO _sqlx_migrations (version) VALUES (15); COMMIT;",
        migration_15()
    ))
    .unwrap();
    crate::backup::verify_application_connection(&conn).unwrap();
    let after: Vec<Vec<String>> = ["study_materials", "skill_catalog_entries", "settings"]
        .iter()
        .map(|t| table_dump(&conn, t))
        .collect();
    assert_eq!(before, after, "the upgrade only adds");
    assert!(navigation_rows(&conn).is_empty());
}

#[test]
fn a_failed_schema15_upgrade_rolls_back_to_an_intact_schema14_library() {
    let dir = TempDir::new("rollback");
    let conn = populated_schema14(dir.path());
    let before = table_dump(&conn, "study_materials");
    // The plugin applies each migration in its own transaction; a fault
    // part-way leaves nothing of it behind.
    let failed = conn.execute_batch(&format!(
        "BEGIN; {} SELECT RAISE(ABORT, 'injected fault'); COMMIT;",
        migration_15()
    ));
    assert!(failed.is_err());
    let _ = conn.execute_batch("ROLLBACK;");
    for table in crate::backup::NAVIGATION_TABLES {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0, "{table} must not survive a failed upgrade");
    }
    let newest: i64 = conn
        .query_row("SELECT MAX(version) FROM _sqlx_migrations", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(newest, 14);
    assert_eq!(table_dump(&conn, "study_materials"), before);
    crate::backup::verify_application_connection(&conn).unwrap();
}

#[test]
fn verification_refuses_inconsistent_ownership_and_altered_navigation_schema() {
    let dir = TempDir::new("verify");
    let (conn, _) = seeded(dir.path());
    crate::backup::verify_application_connection(&conn).unwrap();
    drop(conn);
    let db = dir.path().join("her-flight-deck.db");
    let cases: [(&str, &str); 5] = [
        ("UPDATE material_operation_claims SET cancelled_generation = reserved_generation + 1", "never issued"),
        ("UPDATE material_reading_state SET owner_generation = 99", "never issued"),
        ("DROP INDEX idx_material_bookmarks_page", "idx_material_bookmarks_page"),
        (
            "PRAGMA foreign_keys = OFF; INSERT INTO material_bookmarks (id, material_id, page_index, title, created_at, updated_at) VALUES ('orphan', 'gone', 1, 't', 'x', 'x');",
            "foreign key constraints",
        ),
        (
            "PRAGMA foreign_keys = OFF; ALTER TABLE material_content_identities RENAME TO old_identities;
             CREATE TABLE material_content_identities (material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE, content_sha256 TEXT NOT NULL, total_pages INTEGER NOT NULL CHECK (TYPEOF(total_pages) = 'integer' AND total_pages >= 1), verified_at TEXT NOT NULL);
             INSERT INTO material_content_identities SELECT * FROM old_identities; DROP TABLE old_identities;
             CREATE INDEX idx_material_content_sha ON material_content_identities(content_sha256);",
            "CHECK constraints",
        ),
    ];
    for (i, (sql, expected)) in cases.iter().enumerate() {
        let copy = dir.path().join(format!("case-{i}.db"));
        std::fs::copy(&db, &copy).unwrap();
        let c = Connection::open(&copy).unwrap();
        c.execute_batch(sql).unwrap();
        let error = crate::backup::verify_application_connection(&c).unwrap_err();
        assert!(error.contains(expected), "case {i}: {error}");
    }
}

#[test]
fn a_complete_backup_round_trips_all_four_navigation_tables() {
    let source = TempDir::new("backup-source");
    let out = TempDir::new("backup-out");
    let target = TempDir::new("backup-target");
    let (mut conn, hash) = seeded(source.path());
    let owner = tuple(&conn).unwrap().5;
    op(&mut conn, json!({
        "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": hash,
        "bookmarkId": "b1", "physicalPage": 12,
        "pageLabel": "ii", "title": "Weather minimums", "notes": "Check against the instructor's notes.",
    }))
    .unwrap();
    set_read_op(&mut conn, &hash, owner, 5, true).unwrap();
    let expected = navigation_rows(&conn);
    assert_eq!(expected.len(), 4, "one row in each table: {expected:?}");
    drop(conn);
    mark_root_ready(source.path());

    let archive = out.path().join("library.hfdbackup");
    crate::backup::create_consistent_complete_backup_with_retry(source.path(), &archive, "0.5.5")
        .unwrap();
    crate::backup::inspect_archive(source.path(), &archive, "0.5.5").unwrap();
    crate::backup::stage_complete_restore_in(target.path(), &archive, "0.5.5").unwrap();
    crate::backup::apply_pending_restore_in(target.path()).unwrap();
    let restored = Connection::open(target.path().join("her-flight-deck.db")).unwrap();
    crate::backup::verify_application_connection(&restored).unwrap();
    assert_eq!(navigation_rows(&restored), expected);
    assert!(target.path().join(DOCUMENTS_DIR).join("ifh.pdf").is_file());
    unmark_root_ready(source.path());
}

/* ------------------------------------------------------------------ */
/* The authoritative file check (M4S1-R3)                              */
/* ------------------------------------------------------------------ */

/// The production path: the managed file is read inside the transaction.
fn checked(conn: &mut Connection, root: &Path, value: Value) -> Check<Value> {
    let decoded = decode_operation(&value)?;
    run_operation_checked(conn, root, &decoded)
}

fn commit_json(generation: i64, hash: &str, page: i64) -> Value {
    json!({
        "kind": "commit", "materialId": MAT, "generation": generation,
        "contentSha256": hash, "physicalPage": page, "pageLabel": null,
    })
}

fn identity_hash(conn: &Connection) -> Option<String> {
    identity_of(conn, MAT).unwrap().map(|i| i.content_sha256)
}

#[test]
fn a_file_replaced_after_inspection_cannot_authorize_a_save_and_its_drift_is_kept() {
    let dir = TempDir::new("r3-replace");
    let (mut conn, hash_a) = seeded(dir.path());
    let before = tuple(&conn).unwrap();
    let token = begin_op(&mut conn, None).unwrap();
    // Replaced after the last inspection, with fewer pages.
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(3, "replaced"));
    let verdict = checked(&mut conn, dir.path(), commit_json(token, &hash_a, 7)).unwrap();
    assert_eq!(verdict["committed"], false);
    assert_eq!(verdict["reason"], "identity_changed");
    let after = tuple(&conn).unwrap();
    assert_eq!(after.0, before.0, "the saved page is kept, not moved");
    assert_eq!(after.5, before.5, "the save did not happen");
    assert_eq!(after.4, "drifted", "the old place is visibly drifted");
    let recorded = identity_of(&conn, MAT).unwrap().unwrap();
    assert_ne!(recorded.content_sha256, hash_a);
    assert_eq!(
        recorded.total_pages, 3,
        "the new identity is recorded atomically"
    );
    assert_eq!(verdict["readingState"]["status"], "drifted");
}

#[test]
fn a_file_deleted_after_inspection_refuses_the_save_and_writes_nothing() {
    let dir = TempDir::new("r3-delete");
    let (mut conn, hash) = seeded(dir.path());
    let before = (tuple(&conn), identity_hash(&conn));
    let token = begin_op(&mut conn, None).unwrap();
    let claim_before = claim(&conn);
    std::fs::remove_file(dir.path().join(DOCUMENTS_DIR).join("ifh.pdf")).unwrap();
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &hash, 6)),
        Err(Code::FileMissing)
    );
    assert_eq!((tuple(&conn), identity_hash(&conn)), before);
    assert_eq!(claim(&conn), claim_before);
    let owner = before.0.unwrap().5;
    assert_eq!(
        checked(
            &mut conn,
            dir.path(),
            json!({
                "kind": "set_read", "materialId": MAT, "expectedContentSha256": hash,
                "expectedOwnerGeneration": owner, "physicalPage": 5, "confirmed": true,
            })
        ),
        Err(Code::FileMissing)
    );
    assert_eq!(tuple(&conn).unwrap().2, 0);
}

#[test]
fn relinking_after_inspection_is_judged_by_the_bytes_now_linked() {
    let dir = TempDir::new("r3-relink");
    let (mut conn, hash) = seeded(dir.path());
    // Relinked to a copy with the same bytes: still the same content.
    write_file(dir.path(), "copy.pdf", &pdf_bytes(50, "a"));
    conn.execute(
        "UPDATE study_materials SET file_path = 'copy.pdf' WHERE id = ?1",
        [MAT],
    )
    .unwrap();
    let token = begin_op(&mut conn, None).unwrap();
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &hash, 6)).unwrap()["committed"],
        true
    );
    // Relinked to different bytes: refused, recorded, drifted.
    write_file(dir.path(), "other.pdf", &pdf_bytes(50, "other"));
    conn.execute(
        "UPDATE study_materials SET file_path = 'other.pdf' WHERE id = ?1",
        [MAT],
    )
    .unwrap();
    let token = begin_op(&mut conn, None).unwrap();
    let verdict = checked(&mut conn, dir.path(), commit_json(token, &hash, 9)).unwrap();
    assert_eq!(verdict["reason"], "identity_changed");
    assert_eq!(tuple(&conn).unwrap().0, 6);
    // Unlinked entirely.
    conn.execute(
        "UPDATE study_materials SET file_path = NULL WHERE id = ?1",
        [MAT],
    )
    .unwrap();
    let token = begin_op(&mut conn, None).unwrap();
    let current = identity_hash(&conn).unwrap();
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &current, 2)),
        Err(Code::FileMissing)
    );
}

#[test]
fn held_confirmation_and_bookmark_across_a_replacement_are_refused_and_drift_is_kept() {
    let dir = TempDir::new("r3-held-actions");
    let (mut conn, hash_a) = seeded(dir.path());
    let owner = tuple(&conn).unwrap().5;
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "b"));
    let held_bookmark = json!({
        "kind": "add_bookmark", "materialId": MAT, "expectedContentSha256": hash_a,
        "bookmarkId": "held", "physicalPage": 4, "pageLabel": null, "title": "t", "notes": "",
    });
    assert_eq!(
        checked(&mut conn, dir.path(), held_bookmark.clone()),
        Err(Code::FileChanged)
    );
    let state = op(&mut conn, json!({ "kind": "read", "materialId": MAT })).unwrap();
    assert_eq!(state["bookmarks"].as_array().unwrap().len(), 0);
    assert_eq!(state["readingState"]["status"], "drifted", "drift was kept");
    // Now that B is recorded, the held A bookmark and confirmation stay stale.
    assert_eq!(
        checked(&mut conn, dir.path(), held_bookmark),
        Err(Code::StaleState)
    );
    let confirm = json!({
        "kind": "set_read", "materialId": MAT, "expectedContentSha256": hash_a,
        "expectedOwnerGeneration": owner, "physicalPage": 5, "confirmed": true,
    });
    assert_eq!(
        checked(&mut conn, dir.path(), confirm),
        Err(Code::StaleState)
    );
    assert_eq!(tuple(&conn).unwrap().2, 0);
}

/// A reader stand-in: records what it was handed and can change the file
/// while the open is "held", or fail.
struct FakeOpener<F: Fn()> {
    opened: std::cell::RefCell<Vec<PathBuf>>,
    during: F,
    fail: bool,
}

impl<F: Fn()> DocumentOpener for FakeOpener<F> {
    fn open_path(&self, path: &Path) -> Result<(), ()> {
        (self.during)();
        self.opened.borrow_mut().push(path.to_path_buf());
        if self.fail {
            Err(())
        } else {
            Ok(())
        }
    }
}

fn opener<F: Fn()>(during: F, fail: bool) -> FakeOpener<F> {
    FakeOpener {
        opened: std::cell::RefCell::new(Vec::new()),
        during,
        fail,
    }
}

#[test]
fn opening_hands_over_only_the_verified_content() {
    let dir = TempDir::new("r3-open");
    let (conn, hash) = seeded(dir.path());
    let quiet = opener(|| {}, false);
    let opened = open_verified_on(&conn, dir.path(), MAT, &hash, &quiet).unwrap();
    assert_eq!(opened["contentSha256"], hash);
    assert_eq!(
        quiet.opened.borrow().as_slice(),
        &[dir.path().join(DOCUMENTS_DIR).join("ifh.pdf")]
    );
    // Asked for other content than is recorded and on disk.
    let other = "c".repeat(64);
    let refused = opener(|| {}, false);
    assert_eq!(
        open_verified_on(&conn, dir.path(), MAT, &other, &refused),
        Err(Code::FileChanged)
    );
    // Replaced on disk since inspection.
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "b"));
    assert_eq!(
        open_verified_on(&conn, dir.path(), MAT, &hash, &refused),
        Err(Code::FileChanged)
    );
    std::fs::remove_file(dir.path().join(DOCUMENTS_DIR).join("ifh.pdf")).unwrap();
    assert_eq!(
        open_verified_on(&conn, dir.path(), MAT, &hash, &refused),
        Err(Code::FileMissing)
    );
    assert!(
        refused.opened.borrow().is_empty(),
        "nothing was handed over"
    );
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "a"));
    let failing = opener(|| {}, true);
    assert_eq!(
        open_verified_on(&conn, dir.path(), MAT, &hash, &failing),
        Err(Code::OpenFailed)
    );
    assert_eq!(
        open_verified_on(&conn, dir.path(), OTHER, &hash, &quiet),
        Err(Code::FileMissing)
    );
}

#[test]
fn a_file_changed_while_the_open_is_held_cannot_be_saved_as_that_page() {
    let dir = TempDir::new("r3-held-open");
    let (mut conn, hash) = seeded(dir.path());
    let token = begin_op(&mut conn, None).unwrap();
    let root = dir.path().to_path_buf();
    let swapping = opener(
        move || write_file(&root, "ifh.pdf", &pdf_bytes(50, "swapped")),
        false,
    );
    open_verified_on(&conn, dir.path(), MAT, &hash, &swapping).unwrap();
    let verdict = checked(&mut conn, dir.path(), commit_json(token, &hash, 9)).unwrap();
    assert_eq!(verdict["reason"], "identity_changed");
    assert_eq!(tuple(&conn).unwrap().0, 5);
}

#[test]
fn a_save_only_retry_rechecks_the_file_and_the_token() {
    let dir = TempDir::new("r3-retry");
    let (mut conn, hash) = seeded(dir.path());
    let token = begin_op(&mut conn, None).unwrap();
    // The first save fails in storage and writes nothing.
    conn.execute_batch(
        "CREATE TRIGGER fail_save BEFORE UPDATE ON material_reading_state BEGIN SELECT RAISE(ABORT, 'disk'); END;",
    )
    .unwrap();
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &hash, 9)),
        Err(Code::StorageFailure)
    );
    conn.execute_batch("DROP TRIGGER fail_save;").unwrap();
    assert_eq!(tuple(&conn).unwrap().0, 5);
    // The same token retried after the file changed is refused...
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "b"));
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &hash, 9)).unwrap()["reason"],
        "identity_changed"
    );
    // Restoring the original is itself a change from what is now recorded, so
    // the first attempt after it is refused too and records A again...
    write_file(dir.path(), "ifh.pdf", &pdf_bytes(50, "a"));
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &hash, 9)).unwrap()["reason"],
        "identity_changed"
    );
    assert_eq!(
        tuple(&conn).unwrap().4,
        "active",
        "A's saved place is verified again"
    );
    // ...after which the same retry succeeds exactly once.
    let saved = checked(&mut conn, dir.path(), commit_json(token, &hash, 9)).unwrap();
    assert_eq!(saved["committed"], true, "{saved}");
    assert_eq!(saved["readingState"]["lastRequestedPage"], 9);
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(token, &hash, 9)).unwrap()["reason"],
        "replayed"
    );
    // A retry for a token that was superseded meanwhile is refused.
    let older = begin_op(&mut conn, None).unwrap();
    let _newer = begin_op(&mut conn, Some(older)).unwrap();
    assert_eq!(
        checked(&mut conn, dir.path(), commit_json(older, &hash, 3)).unwrap()["reason"],
        "cancelled"
    );
}

#[test]
fn the_wire_commands_use_the_checked_path() {
    let dir = TempDir::new("r3-wire");
    let (conn, hash) = seeded(dir.path());
    drop(conn);
    mark_root_ready(dir.path());
    let token = navigation_operation_at(
        dir.path(),
        &json!({ "kind": "begin", "materialId": MAT, "supersedeGeneration": null }),
    )
    .unwrap()["generation"]
        .as_i64()
        .unwrap();
    std::fs::remove_file(dir.path().join(DOCUMENTS_DIR).join("ifh.pdf")).unwrap();
    assert_eq!(
        navigation_operation_at(dir.path(), &commit_json(token, &hash, 6)),
        Err(Code::FileMissing.error())
    );
    let quiet = opener(|| {}, false);
    assert_eq!(
        open_navigation_document_at(
            dir.path(),
            &json!({ "materialId": MAT, "expectedContentSha256": hash }),
            &quiet
        ),
        Err(Code::FileMissing.error())
    );
    assert_eq!(
        open_navigation_document_at(dir.path(), &json!({ "materialId": MAT }), &quiet),
        Err(Code::InvalidArgument.error())
    );
    let wire = serde_json::to_value(Code::OpenFailed.error()).unwrap();
    assert_eq!(wire["code"], "OPEN_FAILED");
    unmark_root_ready(dir.path());
}
