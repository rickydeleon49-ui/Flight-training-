use super::super::{parse, Coverage, Host, Point, Request, Response, Stop};
use super::*;
use crate::extraction::cache::{Cache, CACHE_FILE};
use rusqlite::functions::FunctionFlags;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "hfd-saved-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        Cache::open(&root).unwrap();
        let f = Self { root };
        // Her database runs in WAL mode (`tauriDb.ts`), so readers never
        // block the app's writes.
        f.db()
            .query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))
            .unwrap();
        f.db().execute_batch(
            "CREATE TABLE study_materials (id TEXT PRIMARY KEY, title TEXT NOT NULL);
             CREATE TABLE ai_study_sets (source_material_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
               summary TEXT NOT NULL DEFAULT '', sections_json TEXT NOT NULL DEFAULT '[]',
               flashcards_json TEXT NOT NULL DEFAULT '[]', source_notes TEXT NOT NULL DEFAULT '',
               updated_at TEXT NOT NULL DEFAULT '');
             CREATE TABLE practice_test_versions (id TEXT PRIMARY KEY, source_material_id TEXT,
               is_active INTEGER NOT NULL);
             CREATE TABLE practice_test_items (id TEXT PRIMARY KEY, version_id TEXT NOT NULL,
               question_text TEXT NOT NULL, options_json TEXT NOT NULL, correct_index INTEGER NOT NULL,
               explanation TEXT NOT NULL DEFAULT '');
             CREATE TABLE card_versions (id TEXT PRIMARY KEY, source_material_id TEXT NOT NULL, is_active INTEGER NOT NULL);
             CREATE TABLE card_items (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL);
             CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '');
             CREATE TABLE questions (id TEXT PRIMARY KEY, text TEXT NOT NULL, material_id TEXT,
               answer TEXT NOT NULL DEFAULT '');",
        )
        .unwrap();
        f
    }

    fn db(&self) -> Connection {
        Connection::open(self.root.join("her-flight-deck.db")).unwrap()
    }

    fn host(&self) -> Host {
        Host::start_with(self.root.join(CACHE_FILE), Duration::from_secs(60))
    }

    /// A material with a study set, an active and an inactive practice
    /// version, and a review snapshot holding other words.
    fn material(&self, id: &str, title: &str) {
        let db = self.db();
        db.execute("INSERT INTO study_materials VALUES (?1, ?2)", [id, title])
            .unwrap();
        db.execute(
            "INSERT INTO ai_study_sets (source_material_id, summary, sections_json, flashcards_json)
             VALUES (?1, 'Summary about magnetos', ?2, ?3)",
            rusqlite::params![
                id,
                r#"[{"heading":"Crosswind landings","body":"Use the wing-low method."},{"heading":"Stalls","body":"Recover promptly."}]"#,
                r#"[{"front":"What is a METAR?","back":"A routine weather report.","sourcePage":3}]"#
            ],
        )
        .unwrap();
        db.execute_batch(&format!(
            "INSERT INTO practice_test_versions VALUES ('{id}-v1', '{id}', 1), ('{id}-v0', '{id}', 0);
             INSERT INTO practice_test_items VALUES
               ('{id}-q1', '{id}-v1', 'Which instrument uses pitot pressure?',
                '[\"airspeed indicator\",\"altimeter\"]', 0, 'The isogonic explanation.'),
               ('{id}-q0', '{id}-v0', 'Superseded question about carburetors', '[\"x\"]', 0, '');
             INSERT INTO card_versions VALUES ('{id}-c', '{id}', 1);
             INSERT INTO card_items VALUES ('{id}-ci', '{id}-c', 'snapshot vortex', 'snapshot vortex');"
        ))
        .unwrap();
    }

    fn search(
        &self,
        host: &Host,
        query: &str,
        categories: Categories,
        materials: &[&str],
    ) -> Result<Response, Stop> {
        host.search(Request {
            targets: vec![],
            terms: parse(query)?,
            offset: 0,
            coverage: Coverage::default(),
            saved: Some(SavedRequest {
                categories,
                material_ids: materials.iter().map(|s| s.to_string()).collect(),
            }),
            saved_available: true,
        })
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

const ALL: Categories = Categories {
    guides: true,
    cards: true,
    practice: true,
    notes: true,
    questions: true,
};

fn hits(r: &Response) -> Vec<(String, &'static str, String)> {
    r.saved
        .as_ref()
        .unwrap()
        .groups
        .iter()
        .flat_map(|g| {
            g.passages.iter().map(move |p| {
                (
                    g.material_id.clone().unwrap_or_else(|| g.kind.to_string()),
                    p.kind,
                    p.record_id.clone(),
                )
            })
        })
        .collect()
}

#[test]
fn digests_are_length_prefixed_and_unambiguous() {
    assert_ne!(
        item_digest(&["a\u{0}b", "c"]),
        item_digest(&["a", "b\u{0}c"])
    );
    assert_eq!(
        item_digest(&["a", "b"]),
        hex::encode(Sha256::digest(b"1:a1:b"))
    );
    assert_eq!(
        item_digest(&["é"]),
        hex::encode(Sha256::digest("2:é".as_bytes()))
    );
}

#[test]
fn searches_current_content_and_never_answers_or_old_versions() {
    let f = Fixture::new();
    f.material("m1", "Handbook");
    f.db()
        .execute_batch(
            "INSERT INTO notes VALUES ('n1', 'Checkride', 'Bring the crosswind chart');
             INSERT INTO questions VALUES ('q1', 'Ask about crosswind limits', NULL, ''),
                                          ('q2', 'Linked crosswind question', 'm1', '');",
        )
        .unwrap();
    let host = f.host();
    let r = f.search(&host, "crosswind", ALL, &["m1"]).unwrap();
    let found = hits(&r);
    assert!(found.contains(&("m1".into(), "guide", "0".into())));
    assert!(found.contains(&("notes".into(), "note", "n1".into())));
    assert!(found.contains(&("questions".into(), "question", "q1".into())));
    assert!(found.contains(&("questions".into(), "question", "q2".into())));
    // Guides and cards carry the item's content digest.
    let guide = &r
        .saved
        .as_ref()
        .unwrap()
        .groups
        .iter()
        .find(|g| g.material_id.as_deref() == Some("m1"))
        .unwrap()
        .passages[0];
    assert_eq!(
        guide.rev.as_deref(),
        Some(item_digest(&["Crosswind landings", "Use the wing-low method."]).as_str())
    );
    let card = f.search(&host, "METAR", ALL, &["m1"]).unwrap();
    assert_eq!(hits(&card), vec![("m1".into(), "card", "0".into())]);
    assert_eq!(
        hits(&f.search(&host, "magnetos", ALL, &["m1"]).unwrap()),
        vec![("m1".into(), "summary", "summary".into())]
    );
    assert_eq!(
        hits(&f.search(&host, "pitot", ALL, &["m1"]).unwrap()),
        vec![("m1".into(), "practice", "m1-q1".into())]
    );
    // Options, explanations, inactive versions and review snapshots never hit.
    for word in ["altimeter", "isogonic", "carburetors", "vortex"] {
        assert!(
            hits(&f.search(&host, word, ALL, &["m1"]).unwrap()).is_empty(),
            "{word}"
        );
    }
    let coverage = &r.saved.as_ref().unwrap().coverage;
    assert_eq!(
        (
            coverage.study_sets,
            coverage.practice_versions,
            coverage.notes,
            coverage.questions
        ),
        (1, 1, 1, 2)
    );
}

#[test]
fn filters_follow_materials_and_categories() {
    let f = Fixture::new();
    f.material("m1", "Handbook");
    f.material("m2", "Weather");
    f.db()
        .execute_batch(
            "INSERT INTO notes VALUES ('n1', '', 'crosswind note');
             INSERT INTO questions VALUES ('q1', 'crosswind unlinked', NULL, ''), ('q2', 'crosswind linked', 'm2', '');",
        )
        .unwrap();
    let host = f.host();
    let r = f.search(&host, "crosswind", ALL, &["m1"]).unwrap();
    let found = hits(&r);
    assert!(found.iter().all(|h| h.0 != "m2"));
    assert!(
        !found.contains(&("questions".into(), "question", "q2".into())),
        "linked to an unselected material"
    );
    assert!(found.contains(&("questions".into(), "question", "q1".into())));
    let only_notes = Categories {
        notes: true,
        ..Categories::default()
    };
    assert_eq!(
        hits(
            &f.search(&host, "crosswind", only_notes, &["m1", "m2"])
                .unwrap()
        ),
        vec![("notes".into(), "note", "n1".into())]
    );
}

#[test]
fn every_commit_is_seen_by_the_next_search() {
    let f = Fixture::new();
    f.db()
        .execute("INSERT INTO notes VALUES ('n1', '', 'alpha')", [])
        .unwrap();
    let host = f.host();
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 1);
    f.db()
        .execute("UPDATE notes SET body = 'bravo' WHERE id = 'n1'", [])
        .unwrap();
    assert!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).is_empty());
    assert_eq!(hits(&f.search(&host, "bravo", ALL, &[]).unwrap()).len(), 1);
    f.db()
        .execute("INSERT INTO notes VALUES ('n2', '', 'bravo two')", [])
        .unwrap();
    assert_eq!(hits(&f.search(&host, "bravo", ALL, &[]).unwrap()).len(), 2);
    f.db().execute("DELETE FROM notes", []).unwrap();
    assert!(hits(&f.search(&host, "bravo", ALL, &[]).unwrap()).is_empty());
}

#[test]
fn a_commit_during_a_rebuild_is_picked_up_by_the_following_search() {
    let f = Fixture::new();
    f.db()
        .execute("INSERT INTO notes VALUES ('n1', '', 'alpha')", [])
        .unwrap();
    let host = f.host();
    let root = f.root.clone();
    let once = AtomicBool::new(false);
    *host.searcher_setup.lock().unwrap() = Some(Box::new(move |s: &mut Searcher| {
        *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
            if point == Point::B && label == "saved-rebuild" && !once.swap(true, Ordering::SeqCst) {
                // Inside the rebuild's snapshot, another connection commits.
                Connection::open(root.join("her-flight-deck.db"))
                    .unwrap()
                    .execute("INSERT INTO notes VALUES ('n2', '', 'alpha late')", [])
                    .unwrap();
            }
        }));
    }));
    // This search answers from its own snapshot.
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 1);
    // The next one sees a new data_version and rebuilds.
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 2);
}

#[test]
fn oversized_fields_are_skipped_and_counted_and_a_huge_collection_is_too_large() {
    let f = Fixture::new();
    let big = "a ".repeat(600_000);
    f.db()
        .execute_batch("INSERT INTO notes VALUES ('ok', '', 'crosswind fine')")
        .unwrap();
    f.db()
        .execute("INSERT INTO notes VALUES ('big', '', ?1)", [&big])
        .unwrap();
    let host = f.host();
    let r = f.search(&host, "crosswind", ALL, &[]).unwrap();
    assert_eq!(hits(&r), vec![("notes".into(), "note", "ok".into())]);
    assert_eq!(r.saved.as_ref().unwrap().coverage.too_large_items, 1);
    // Past the 32 MiB preflight nothing is indexed and the section says so.
    let db = f.db();
    for i in 0..40 {
        db.execute(
            "INSERT INTO notes VALUES (?1, '', ?2)",
            rusqlite::params![format!("x{i}"), &big],
        )
        .unwrap();
    }
    let r = f.search(&host, "crosswind", ALL, &[]).unwrap();
    assert_eq!(r.saved.as_ref().unwrap().state, "too_large");
    assert!(r.saved.as_ref().unwrap().groups.is_empty());
}

#[test]
fn past_the_record_cap_no_partial_index_is_used() {
    let f = Fixture::new();
    let db = f.db();
    db.execute_batch(&format!(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i <= {MAX_RECORDS})
         INSERT INTO notes SELECT 'n' || i, '', 'tiny crosswind' FROM n;"
    ))
    .unwrap();
    let host = f.host();
    let r = f.search(&host, "crosswind", ALL, &[]).unwrap();
    assert_eq!(r.saved.as_ref().unwrap().state, "too_large");
    assert!(r.saved.as_ref().unwrap().groups.is_empty());
}

#[test]
fn storage_not_ready_reports_unavailable() {
    let f = Fixture::new();
    let host = f.host();
    let r = host
        .search(Request {
            targets: vec![],
            terms: parse("crosswind").unwrap(),
            offset: 0,
            coverage: Coverage::default(),
            saved: Some(SavedRequest {
                categories: ALL,
                material_ids: vec![],
            }),
            saved_available: false,
        })
        .unwrap();
    assert_eq!(r.saved.unwrap().state, "unavailable");
}

const RACE_DEADLINE: Duration = Duration::from_millis(1500);

/// A host whose one-time setup (cache validation, connection, ATTACH) has
/// already run, so a race test's deadline covers only the search itself.
fn warmed(f: &Fixture) -> Host {
    let host = Host::start_with(f.root.join(CACHE_FILE), RACE_DEADLINE);
    let warm = host.search(Request {
        targets: vec![],
        terms: parse("warmup").unwrap(),
        offset: 0,
        coverage: Coverage::default(),
        saved: None,
        saved_available: false,
    });
    assert!(warm.is_ok());
    host
}

#[test]
fn point_a_a_deadline_before_a_rebuild_starts_publishes_nothing() {
    let f = Fixture::new();
    f.db()
        .execute("INSERT INTO notes VALUES ('n1', '', 'alpha')", [])
        .unwrap();
    let host = warmed(&f);
    let once = AtomicBool::new(false);
    *host.searcher_setup.lock().unwrap() = Some(Box::new(move |s: &mut Searcher| {
        *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
            if point == Point::A && label == "saved-rebuild" && !once.swap(true, Ordering::SeqCst) {
                std::thread::sleep(RACE_DEADLINE + Duration::from_millis(50));
            }
        }));
    }));
    assert_eq!(f.search(&host, "alpha", ALL, &[]), Err(Stop::Timeout));
    // Nothing partial was published: the next search rebuilds and is right.
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 1);
}

#[test]
fn point_b_a_deadline_after_the_recheck_stops_the_rebuild_and_publishes_nothing() {
    let f = Fixture::new();
    f.material("m1", "Handbook");
    f.db()
        .execute("INSERT INTO notes VALUES ('n1', '', 'alpha')", [])
        .unwrap();
    let host = warmed(&f);
    let guard = host.guard.clone();
    let once = AtomicBool::new(false);
    *host.searcher_setup.lock().unwrap() = Some(Box::new(move |s: &mut Searcher| {
        let g = guard.clone();
        *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
            if point == Point::B && label == "saved-rebuild" && !once.swap(true, Ordering::SeqCst) {
                // After the re-check: wait until the watchdog has issued an
                // interrupt for this request, then let the rebuild run.
                while g.interrupts.load(Ordering::SeqCst) < 1 {
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        }));
    }));
    let started = Instant::now();
    // Whichever stops it first (SQLite's interrupt or the per-row check),
    // the rebuild ends as a timeout within the bound and isn't published.
    assert_eq!(f.search(&host, "alpha", ALL, &[]), Err(Stop::Timeout));
    assert!(started.elapsed() <= RACE_DEADLINE + Duration::from_millis(150));
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 1);
}

#[test]
fn a_tick_interrupts_a_rebuild_query_that_is_already_running() {
    let f = Fixture::new();
    f.material("m1", "Handbook");
    f.db()
        .execute("INSERT INTO notes VALUES ('n1', '', 'alpha')", [])
        .unwrap();
    let host = warmed(&f);
    let guard = host.guard.clone();
    let interrupted: Arc<Mutex<Option<Arc<AtomicBool>>>> = Arc::new(Mutex::new(None));
    let seen = interrupted.clone();
    let gate = Arc::new(AtomicBool::new(true));
    let (tick_tx, tick_rx) = mpsc::channel::<u64>();
    let tick_tx = Mutex::new(tick_tx);
    let installed = AtomicBool::new(false);
    *host.searcher_setup.lock().unwrap() = Some(Box::new(move |s: &mut Searcher| {
        if installed.swap(true, Ordering::SeqCst) {
            return;
        }
        *seen.lock().unwrap() = Some(s.interrupted.clone());
        s.saved_extra_where = Some("AND hfd_test_gate() = 1");
        let g = guard.clone();
        let gate = gate.clone();
        s.conn
            .create_scalar_function("hfd_test_gate", 0, FunctionFlags::SQLITE_UTF8, move |_| {
                if gate.swap(false, Ordering::SeqCst) {
                    // Inside the running rebuild query: hold it until the
                    // deadline passes and the watchdog interrupts it.
                    let entered = g.interrupts.load(Ordering::SeqCst);
                    while g.interrupts.load(Ordering::SeqCst) <= entered {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    let _ = tick_tx
                        .lock()
                        .unwrap()
                        .send(g.interrupts.load(Ordering::SeqCst));
                }
                Ok(1)
            })
            .unwrap();
    }));
    let started = Instant::now();
    assert_eq!(f.search(&host, "alpha", ALL, &[]), Err(Stop::Timeout));
    assert!(started.elapsed() <= RACE_DEADLINE + Duration::from_millis(150));
    // The caller's wait ends at the deadline; the search thread sees the
    // watchdog's interrupt a tick later, so wait for its report.
    assert!(
        tick_rx.recv_timeout(Duration::from_secs(2)).is_ok(),
        "the query was running when the tick landed"
    );
    let interrupted = interrupted.lock().unwrap().clone().unwrap();
    let until = Instant::now() + Duration::from_secs(2);
    while !interrupted.load(Ordering::SeqCst) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(
        interrupted.load(Ordering::SeqCst),
        "SQLite reported SQLITE_INTERRUPT"
    );
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 1);
}
