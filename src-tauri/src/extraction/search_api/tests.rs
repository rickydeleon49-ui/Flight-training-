use super::*;
use crate::extraction::inspect::Outcome;
use crate::extraction::supervisor::{Extraction, PageResult};
use sha2::{Digest, Sha256};
use std::fs;

fn wait_ready(svc: &Service) {
    crate::test_wait::wait_for(
        "search API initialization ready",
        || match search_initialization(svc).unwrap() {
            Initialization::Ready => true,
            Initialization::Failed => panic!("index initialization failed"),
            Initialization::Preparing => false,
        },
    );
}

struct Fixture {
    root: PathBuf,
    svc: Arc<Service>,
}
impl Fixture {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "hfd-search-api-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("documents")).unwrap();
        Connection::open(root.join("her-flight-deck.db")).unwrap().execute_batch("CREATE TABLE study_materials(id TEXT PRIMARY KEY,title TEXT,material_type TEXT,original_file_name TEXT,created_at TEXT,file_path TEXT);").unwrap();
        crate::practice_sessions::mark_root_ready(&root);
        let svc = Arc::new(Service::new(root.clone(), PathBuf::from("not-a-worker")));
        Self { root, svc }
    }
    fn add(&self, id: &str, bytes: &[u8], pages: &[(Outcome, &str)], verify: bool) -> String {
        let relative = format!("{id}.pdf");
        let path = self.root.join("documents").join(&relative);
        fs::write(&path, bytes).unwrap();
        Connection::open(self.root.join("her-flight-deck.db"))
            .unwrap()
            .execute(
                "INSERT INTO study_materials VALUES(?1,?1,'handbook',?2,'2026-10-19',?2)",
                rusqlite::params![id, relative],
            )
            .unwrap();
        let sha = hex::encode(Sha256::digest(bytes));
        if verify {
            assert_eq!(self.svc.verify(&path), Some(sha.clone()));
        }
        if !pages.is_empty() {
            Cache::open(&self.root)
                .unwrap()
                .publish(&Extraction {
                    sha256: sha.clone(),
                    peak_bytes: 0,
                    pages: pages
                        .iter()
                        .enumerate()
                        .map(|(i, (outcome, text))| PageResult {
                            index: i as u32 + 1,
                            outcome: *outcome,
                            text: (*text).into(),
                            error: None,
                        })
                        .collect(),
                })
                .unwrap();
        }
        sha
    }
    fn search(&self, ids: &[&str], query: &str) -> search::Response {
        wait_ready(&self.svc);
        submit_search(
            self.svc.clone(),
            query.into(),
            ids.iter().map(|s| s.to_string()).collect(),
            vec!["documentPages".into()],
            0,
            Instant::now(),
        )
        .unwrap()
        .wait()
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        crate::practice_sessions::unmark_root_ready(&self.root);
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn resolves_only_current_filtered_documents_and_reports_all_exclusions() {
    let f = Fixture::new();
    let pages = [
        (Outcome::Text, "crosswind landing"),
        (Outcome::ImageOnly, "crosswind fake"),
        (Outcome::TextUnreadable, "crosswind garbage"),
        (Outcome::Blank, ""),
    ];
    f.add("a", b"aaa", &pages, true);
    f.add("copy", b"aaa", &[], true);
    f.add("unchecked", b"bbb", &pages, false);
    f.add("unprepared", b"ccc", &[], true);
    let failed = f.add("failed", b"ddd", &[], true);
    Cache::open(&f.root)
        .unwrap()
        .publish_failure(&failed, "malformed")
        .unwrap();
    f.add("gone", b"eee", &pages, true);
    fs::remove_file(f.root.join("documents/gone.pdf")).unwrap();
    f.add("changed", b"fff", &pages, true);
    fs::write(f.root.join("documents/changed.pdf"), b"different").unwrap();
    f.add("excluded", b"ggg", &pages, true);
    // A note: a material with no document.
    Connection::open(f.root.join("her-flight-deck.db"))
        .unwrap()
        .execute(
            "INSERT INTO study_materials VALUES('note','note','notes',NULL,'2026-10-19',NULL)",
            [],
        )
        .unwrap();
    let r = f.search(
        &[
            "a",
            "copy",
            "a",
            "unchecked",
            "unprepared",
            "failed",
            "gone",
            "changed",
            "deleted",
            "note",
        ],
        "crosswind",
    );
    assert_eq!(
        r.groups
            .iter()
            .map(|g| (
                g.material_id.as_str(),
                g.passages.iter().map(|p| p.page_index).collect::<Vec<_>>()
            ))
            .collect::<Vec<_>>(),
        vec![("a", vec![1]), ("copy", vec![1])]
    );
    assert_eq!(
        r.coverage,
        Coverage {
            searched_documents: 2,
            // Text and blank pages, as in the readiness summary.
            searched_pages: 4,
            image_pages: 2,
            other_unsearchable_pages: 2,
            not_checked: 2,
            not_prepared: 1,
            could_not_prepare: 1,
            // Only the file that is gone; the deleted row and the note
            // aren't missing files.
            missing: 1,
            ..Coverage::default()
        }
    );
}

#[test]
fn fresh_session_after_restore_has_no_verified_files() {
    let f = Fixture::new();
    f.add("a", b"aaa", &[(Outcome::Text, "wind")], true);
    let fresh = Arc::new(Service::new(f.root.clone(), PathBuf::new()));
    wait_ready(&fresh);
    let r = submit_search(
        fresh,
        "wind".into(),
        vec!["a".into()],
        vec!["documentPages".into()],
        0,
        Instant::now(),
    )
    .unwrap()
    .wait()
    .unwrap();
    assert!(r.groups.is_empty());
    assert_eq!(r.coverage.not_checked, 1);
}

#[test]
fn destination_rehashes_same_stamp_replacements_and_rejects_deleted_rows() {
    let f = Fixture::new();
    let sha = f.add("a", b"before", &[(Outcome::Text, "wind")], true);
    assert_eq!(
        verify_destination(&f.svc, "a", &sha).unwrap(),
        Destination::Ok
    );
    let path = f.root.join("documents/a.pdf");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, b"after!").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    assert!(
        f.svc.current(&path).is_some(),
        "stamp deliberately unchanged"
    );
    assert_eq!(
        verify_destination(&f.svc, "a", &sha).unwrap(),
        Destination::Changed
    );
    assert!(f.search(&["a"], "wind").groups.is_empty());
    Connection::open(f.root.join("her-flight-deck.db"))
        .unwrap()
        .execute("DELETE FROM study_materials", [])
        .unwrap();
    assert_eq!(
        verify_destination(&f.svc, "a", &sha).unwrap(),
        Destination::Missing
    );
}

#[test]
fn opening_a_result_does_not_wait_for_a_preparation_in_progress() {
    let f = Fixture::new();
    let sha = f.add("a", b"before", &[(Outcome::Text, "wind")], true);
    // A preparation holds the slot for up to its deadline.
    let held = f.svc.hold_slot_for_test();
    let (done, answer) = std::sync::mpsc::channel();
    let svc = f.svc.clone();
    let checking = sha.clone();
    std::thread::spawn(move || {
        let _ = done.send(verify_destination(&svc, "a", &checking));
    });
    let result = answer.recv_timeout(Duration::from_secs(5));
    drop(held);
    assert_eq!(
        result.expect("the destination check waited for the preparation"),
        Ok(Destination::Ok)
    );
}

#[cfg(unix)]
#[test]
fn managed_paths_never_follow_symlinks_outside_documents() {
    let f = Fixture::new();
    let sha = f.add("a", b"aaa", &[(Outcome::Text, "wind")], true);
    fs::write(f.root.join("outside.pdf"), b"aaa").unwrap();
    fs::remove_file(f.root.join("documents/a.pdf")).unwrap();
    std::os::unix::fs::symlink(f.root.join("outside.pdf"), f.root.join("documents/a.pdf")).unwrap();
    assert_eq!(
        verify_destination(&f.svc, "a", &sha).unwrap(),
        Destination::Missing
    );
    assert_eq!(f.search(&["a"], "wind").coverage.missing, 1);
}

#[test]
fn validates_limits_and_never_queries_unready_storage() {
    let f = Fixture::new();
    let submit = |q: &str, ids: Vec<String>, types: Vec<String>, offset| {
        submit_search(f.svc.clone(), q.into(), ids, types, offset, Instant::now())
            .err()
            .unwrap()
    };
    assert_eq!(
        submit(
            "wind",
            vec![String::new(); 5001],
            vec!["documentPages".into()],
            0
        ),
        "too_many_materials"
    );
    assert_eq!(
        submit("wind", vec![], vec!["flashcards".into()], 0),
        "unsupported_content_type"
    );
    assert_eq!(
        submit("wind", vec![], vec!["documentPages".into()], 201),
        "offset_too_deep"
    );
    assert_eq!(
        submit("", vec![], vec!["documentPages".into()], 0),
        "empty_query"
    );
    wait_ready(&f.svc);
    crate::practice_sessions::unmark_root_ready(&f.root);
    let result = submit_search(
        f.svc.clone(),
        "wind".into(),
        vec![],
        vec!["documentPages".into()],
        0,
        Instant::now(),
    )
    .unwrap()
    .wait();
    assert_eq!(result, Err(Stop::Failed));
    assert_eq!(
        verify_destination(&f.svc, "a", &"0".repeat(64)),
        Err("storage_not_ready".into())
    );
}
