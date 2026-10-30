//! OFFLINE-01a: readiness and preparation through the real worker, across
//! the restore and staleness cases of proposal §4.3. Synthetic files only.

use her_flight_deck_lib::extraction::cache::Cache;
use her_flight_deck_lib::extraction::service::{PartialReason, Readiness, Service};
use her_flight_deck_lib::extraction::supervisor::{self, Job};
use her_flight_deck_lib::extraction::worker::Limits;
use lopdf::{dictionary, Document, Object, Stream};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

const WORKER: &str = env!("CARGO_BIN_EXE_her-flight-deck");

struct Root(PathBuf);
impl Root {
    fn new(tag: &str) -> Self {
        // Parallel tests can read the same clock value; never share a folder.
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "hfd-service-{tag}-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(p.join("documents")).unwrap();
        Self(p)
    }
    fn doc(&self, rel: &str) -> PathBuf {
        self.0.join("documents").join(rel)
    }
    fn session(&self) -> Service {
        Service::new(self.0.clone(), PathBuf::from(WORKER))
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A one-page PDF: text when `words` is given, otherwise a single image.
fn pdf(words: Option<&str>) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
    });
    let mut img = Stream::new(
        dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
        "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8 },
        vec![0u8],
    );
    img.allows_compression = false;
    let img = doc.add_object(img);
    let content = match words {
        Some(w) => format!("BT /F1 12 Tf 72 700 Td ({w}) Tj ET"),
        None => "q 100 0 0 100 0 0 cm /Im1 Do Q".into(),
    };
    let mut stream = Stream::new(dictionary! {}, content.into_bytes());
    stream.allows_compression = false;
    let content_id = doc.add_object(stream);
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => font }, "XObject" => dictionary! { "Im1" => img } },
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Count" => 1, "Kids" => vec![page.into()] },
        ),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn no_cancel() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

fn verify(svc: &Service, root: &Root, rel: &str) {
    svc.verify(&root.doc(rel)).expect("file hashes");
}

#[test]
fn a_new_session_checks_first_then_reuses_the_cache() {
    let root = Root::new("session");
    std::fs::write(root.doc("guide.pdf"), pdf(Some("Weight and balance"))).unwrap();
    let first = root.session();
    assert_eq!(first.readiness("guide.pdf"), Readiness::Checking);
    assert_eq!(
        first.prepare("guide.pdf", no_cancel()),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );

    let second = root.session();
    assert_eq!(
        second.readiness("guide.pdf"),
        Readiness::Checking,
        "nothing is trusted from a previous session"
    );
    verify(&second, &root, "guide.pdf");
    assert_eq!(
        second.readiness("guide.pdf"),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
}

#[test]
fn rollback_to_older_bytes_and_forward_again_never_shows_stale_readiness() {
    let root = Root::new("rollback");
    let (a, b) = (pdf(Some("Version A")), pdf(None));
    std::fs::write(root.doc("chart.pdf"), &a).unwrap();
    root.session().prepare("chart.pdf", no_cancel());

    // A restore puts older, different bytes back under the same name.
    std::fs::write(root.doc("chart.pdf"), &b).unwrap();
    let s = root.session();
    verify(&s, &root, "chart.pdf");
    assert_eq!(
        s.readiness("chart.pdf"),
        Readiness::NotPrepared,
        "A's text is never shown for B"
    );
    let after = s.prepare("chart.pdf", no_cancel());
    assert_eq!(
        after,
        Readiness::Partial {
            searchable: 0,
            pages: 1,
            image_pages: 1,
            reason: PartialReason::ImagePages,
            few_text_pages: 0
        }
    );

    // Restoring A's bytes again reuses A's entry with no new extraction.
    std::fs::write(root.doc("chart.pdf"), &a).unwrap();
    let s = root.session();
    verify(&s, &root, "chart.pdf");
    assert_eq!(
        s.readiness("chart.pdf"),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
}

#[test]
fn a_database_only_restore_resolves_by_the_bytes_on_disk() {
    let root = Root::new("dbonly");
    let bytes = pdf(Some("Airspace classes"));
    std::fs::write(root.doc("old-name.pdf"), &bytes).unwrap();
    root.session().prepare("old-name.pdf", no_cancel());
    // The restored database points at another name holding the same bytes.
    std::fs::write(root.doc("restored-name.pdf"), &bytes).unwrap();
    let s = root.session();
    verify(&s, &root, "restored-name.pdf");
    assert_eq!(
        s.readiness("restored-name.pdf"),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
}

#[test]
fn a_late_worker_publishes_for_its_bytes_only() {
    let root = Root::new("late");
    let (a, b) = (pdf(Some("Late A")), pdf(Some("Current B")));
    let path = root.doc("notes.pdf");
    std::fs::write(&path, &a).unwrap();
    let sha_a = her_flight_deck_lib::extraction::service::hash_file(&path).unwrap();
    let result = supervisor::run(Job {
        worker: Path::new(WORKER),
        file: &path,
        sha256: &sha_a,
        limits: Limits::default(),
        deadline: Duration::from_secs(20),
        cancel: no_cancel(),
        extra: None,
    })
    .unwrap();
    // The file is replaced before the old result is published.
    std::fs::write(&path, &b).unwrap();
    Cache::open(&root.0).unwrap().publish(&result).unwrap();
    let s = root.session();
    verify(&s, &root, "notes.pdf");
    assert_eq!(
        s.readiness("notes.pdf"),
        Readiness::NotPrepared,
        "B is not shown as prepared by A's result"
    );
}

#[test]
fn same_stamp_different_bytes_is_caught_across_sessions_and_at_action_time() {
    let root = Root::new("stamp");
    let path = root.doc("same.pdf");
    let (a, mut b) = (pdf(Some("AAAA")), pdf(Some("BBBB")));
    b.resize(a.len(), b' ');
    assert_eq!(a.len(), b.len());
    std::fs::write(&path, &a).unwrap();
    let s1 = root.session();
    s1.prepare("same.pdf", no_cancel());
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();

    // Rewrite in place, keeping size, inode and modification time.
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        f.write_all(&b).unwrap();
        f.set_modified(modified).unwrap();
    }
    let s2 = root.session();
    assert_eq!(
        s2.readiness("same.pdf"),
        Readiness::Checking,
        "a stamp from before is only a hint"
    );
    verify(&s2, &root, "same.pdf");
    assert_eq!(s2.readiness("same.pdf"), Readiness::NotPrepared);
    // Within the old session the stamp still matches, but acting re-hashes.
    assert_eq!(
        s1.prepare("same.pdf", no_cancel()),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
    let cache = Cache::open(&root.0).unwrap();
    let sha_b = her_flight_deck_lib::extraction::service::hash_file(&path).unwrap();
    let (_, text) = cache.page(&sha_b, 1).unwrap();
    assert!(
        text.contains("BBBB"),
        "the action extracted the bytes actually on disk"
    );
}

#[test]
fn moved_missing_and_non_pdf_files_are_reported_plainly() {
    let root = Root::new("moved");
    std::fs::write(root.doc("away.pdf"), pdf(Some("Moved"))).unwrap();
    let s = root.session();
    verify(&s, &root, "away.pdf");
    std::fs::rename(root.doc("away.pdf"), root.0.join("elsewhere.pdf")).unwrap();
    assert_eq!(s.readiness("away.pdf"), Readiness::Missing);
    assert_eq!(
        s.readiness("../escape.pdf"),
        Readiness::Missing,
        "unsafe paths never resolve"
    );
    std::fs::write(root.doc("notes.txt"), b"plain").unwrap();
    assert_eq!(s.readiness("notes.txt"), Readiness::Unsupported);
}

#[test]
fn a_file_the_worker_cannot_read_is_could_not_process() {
    let root = Root::new("bad");
    std::fs::write(root.doc("broken.pdf"), b"%PDF-1.5 truncated nonsense").unwrap();
    let s = root.session();
    assert_eq!(
        s.prepare("broken.pdf", no_cancel()),
        Readiness::CouldNotProcess {
            code: "malformed".into()
        }
    );
}

/// Rewrite `path` in place with `bytes` of the same length, keeping its
/// modification time (and so its whole stamp).
fn rewrite_keeping_stamp(path: &Path, bytes: &[u8]) {
    use std::io::Write;
    let modified = std::fs::metadata(path).unwrap().modified().unwrap();
    let mut f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    f.write_all(bytes).unwrap();
    f.set_modified(modified).unwrap();
}

fn same_length(a: &[u8], mut b: Vec<u8>) -> Vec<u8> {
    assert!(b.len() <= a.len());
    b.resize(a.len(), b' ');
    b
}

#[test]
fn a_file_replaced_after_the_worker_read_it_never_shows_the_old_result() {
    let root = Root::new("during");
    let path = root.doc("live.pdf");
    let a = pdf(Some("Original words AAAA"));
    let b = same_length(&a, pdf(Some("Replaced BBBB")));
    std::fs::write(&path, &a).unwrap();
    let svc = Arc::new(root.session());
    let worker = {
        let svc = svc.clone();
        std::thread::spawn(move || {
            svc.prepare_with(
                "live.pdf",
                no_cancel(),
                Some(serde_json::json!({ "test": { "sleepAfterRead": 800 } })),
            )
        })
    };
    std::thread::sleep(Duration::from_millis(300));
    rewrite_keeping_stamp(&path, &b);
    let after = worker.join().unwrap();
    assert_eq!(
        after,
        Readiness::NotPrepared,
        "A's result is not reported for B, even with the same stamp"
    );
}

#[test]
fn a_transient_identity_failure_is_not_cached_against_the_original_bytes() {
    let root = Root::new("transient");
    let path = root.doc("swap.pdf");
    let a = pdf(Some("Stable AAAA"));
    let b = same_length(&a, pdf(Some("Swap BBBB")));
    std::fs::write(&path, &a).unwrap();
    let svc = Arc::new(root.session());
    let worker = {
        let svc = svc.clone();
        std::thread::spawn(move || {
            svc.prepare_with(
                "swap.pdf",
                no_cancel(),
                Some(serde_json::json!({ "test": { "sleep": 800 } })),
            )
        })
    };
    // Replaced after hashing but before the worker reads it.
    std::thread::sleep(Duration::from_millis(300));
    std::fs::write(&path, &b).unwrap();
    assert_eq!(worker.join().unwrap(), Readiness::NotPrepared);
    // Back to the original bytes: nothing failed was stored for them.
    std::fs::write(&path, &a).unwrap();
    let s = root.session();
    verify(&s, &root, "swap.pdf");
    assert_eq!(
        s.readiness("swap.pdf"),
        Readiness::NotPrepared,
        "no cached failure for A"
    );
    assert_eq!(
        s.prepare("swap.pdf", no_cancel()),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
}

#[test]
fn queued_work_is_deduplicated_serialized_and_completes() {
    let root = Root::new("queue");
    std::fs::write(root.doc("q.pdf"), pdf(Some("Queued"))).unwrap();
    let svc = Arc::new(root.session());
    for _ in 0..50 {
        assert!(svc.enqueue_verify(root.doc("q.pdf")));
    }
    svc.wait_idle();
    assert_eq!(svc.readiness("q.pdf"), Readiness::NotPrepared);
    assert!(svc.enqueue_prepare("q.pdf".into()));
    assert!(
        svc.enqueue_prepare("q.pdf".into()),
        "a duplicate is accepted but not queued twice"
    );
    svc.wait_idle();
    assert_eq!(
        svc.readiness("q.pdf"),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
}

#[test]
fn failures_before_identity_is_verified_are_never_cached() {
    let root = Root::new("preidentity");
    std::fs::write(root.doc("pre.pdf"), pdf(Some("Pre-identity"))).unwrap();
    let s = root.session();
    // Oversized: refused before the hash is checked.
    let r = s.prepare_with(
        "pre.pdf",
        no_cancel(),
        Some(serde_json::json!({ "limits": { "inputBytes": 16 } })),
    );
    assert_eq!(
        r,
        Readiness::NotPrepared,
        "input_too_large before identity is not stored"
    );
    // A memory breach before identity (a cap below startup use).
    let r = s.prepare_with(
        "pre.pdf",
        no_cancel(),
        Some(serde_json::json!({ "limits": { "memoryBytes": 1024 } })),
    );
    assert_eq!(
        r,
        Readiness::NotPrepared,
        "a breach before identity is not stored"
    );
    // The same bytes still prepare normally.
    assert_eq!(
        s.prepare("pre.pdf", no_cancel()),
        Readiness::Searchable {
            pages: 1,
            few_text_pages: 1
        }
    );
}

#[test]
fn a_failure_after_identity_is_cached_for_those_bytes() {
    let root = Root::new("postidentity");
    std::fs::write(root.doc("bad.pdf"), b"%PDF-1.5 not really a document").unwrap();
    let s = root.session();
    assert_eq!(
        s.prepare("bad.pdf", no_cancel()),
        Readiness::CouldNotProcess {
            code: "malformed".into()
        }
    );
    let again = root.session();
    verify(&again, &root, "bad.pdf");
    assert_eq!(
        again.readiness("bad.pdf"),
        Readiness::CouldNotProcess {
            code: "malformed".into()
        }
    );
}

/// OFFLINE-02a composition: genuine PDF bytes → real extraction child →
/// published FTS passages → authoritative row/stamp resolution → bounded
/// native command → freshly hashed destination. No Tauri UI is launched.
#[test]
fn prepared_real_pdf_is_searchable_and_its_destination_is_revalidated() {
    use her_flight_deck_lib::extraction::search_api::{
        initialize_storage, submit_search, verify_destination, Destination,
    };
    let root = Root::new("search-composition");
    let db = rusqlite::Connection::open(root.0.join("her-flight-deck.db")).unwrap();
    let mut migrations: Vec<_> =
        std::fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations"))
            .unwrap()
            .map(|p| p.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "sql"))
            .collect();
    migrations.sort();
    db.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)")
        .unwrap();
    for (i, path) in migrations.iter().enumerate() {
        db.execute_batch(&std::fs::read_to_string(path).unwrap())
            .unwrap();
        db.execute("INSERT INTO schema_migrations VALUES (?1)", [i + 1])
            .unwrap();
    }
    for (id, words) in [
        ("text", Some("Crosswind landing technique")),
        ("image", None),
    ] {
        let name = format!("{id}.pdf");
        std::fs::write(root.doc(&name), pdf(words)).unwrap();
        db.execute("INSERT INTO study_materials(id,title,file_path,original_file_name,created_at,updated_at) VALUES (?1,?1,?2,?2,'2026-10-19','2026-10-19')",rusqlite::params![id,name]).unwrap();
    }
    initialize_storage(&root.0).unwrap();
    let svc = Arc::new(root.session());
    for name in ["text.pdf", "image.pdf"] {
        svc.prepare(name, no_cancel());
    }
    let before = std::fs::read(root.0.join("her-flight-deck.db")).unwrap();
    let until = std::time::Instant::now() + Duration::from_secs(5);
    while her_flight_deck_lib::extraction::search_api::search_initialization(&svc).unwrap()
        != her_flight_deck_lib::extraction::search::Initialization::Ready
    {
        assert!(std::time::Instant::now() < until);
        std::thread::yield_now();
    }
    let response = submit_search(
        svc.clone(),
        "crosswind".into(),
        vec!["text".into(), "image".into()],
        vec!["documentPages".into()],
        0,
        std::time::Instant::now(),
    )
    .unwrap()
    .wait()
    .unwrap();
    assert_eq!(response.groups.len(), 1);
    assert_eq!(response.groups[0].material_id, "text");
    assert_eq!(response.groups[0].passages[0].page_index, 1);
    assert_eq!(response.coverage.searched_pages, 1);
    assert_eq!(response.coverage.image_pages, 1);
    let sha = &response.groups[0].passages[0].content_sha256;
    assert_eq!(
        verify_destination(&svc, "text", sha).unwrap(),
        Destination::Ok
    );
    assert_eq!(
        std::fs::read(root.0.join("her-flight-deck.db")).unwrap(),
        before,
        "search and destination checks never write the authoritative DB"
    );
    std::fs::write(root.doc("text.pdf"), pdf(Some("Different replacement"))).unwrap();
    assert_eq!(
        verify_destination(&svc, "text", sha).unwrap(),
        Destination::Changed
    );
}

#[test]
fn readiness_counts_pages_that_look_like_pictures_of_text() {
    let root = Root::new("fewtext");
    let long = "Weight and balance moments add up across every station";
    std::fs::write(root.doc("full.pdf"), pdf(Some(long))).unwrap();
    std::fs::write(root.doc("thin.pdf"), pdf(Some("Page 3"))).unwrap();
    let s = root.session();
    for (name, few) in [("full.pdf", 0), ("thin.pdf", 1)] {
        verify(&s, &root, name);
        assert_eq!(
            s.prepare(name, no_cancel()),
            Readiness::Searchable {
                pages: 1,
                few_text_pages: few
            },
            "{name}"
        );
    }
}
