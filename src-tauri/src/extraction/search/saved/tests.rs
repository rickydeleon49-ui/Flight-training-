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
             CREATE TABLE homework_assignments (id TEXT PRIMARY KEY,title TEXT,instructions TEXT,archived INTEGER);
             CREATE TABLE homework_activities (id TEXT PRIMARY KEY,assignment_id TEXT,title TEXT,body TEXT,material_id TEXT,removed_at TEXT);
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
                material_filters_active: false,
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
    homework: true,
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
fn saved_search_authored_practice_indexes_only_stems() {
    let root = std::env::temp_dir().join(format!(
        "hfd-saved-authored-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let f = Fixture { root };
    Cache::open(&f.root).unwrap();
    let db = f.db();
    db.pragma_update(None, "foreign_keys", "ON").unwrap();
    for migration in crate::migrations() {
        db.execute_batch(migration.sql).unwrap();
    }
    db.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at)
         VALUES ('authored', 'Handbook', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z')",
        [],
    )
    .unwrap();
    drop(db);
    crate::practice_authoring::save_practice_authoring_at(
        &f.root,
        &serde_json::json!({
            "operationId": "fa000000-0000-4000-8000-0000000000e0",
            "sourceMaterialId": "authored",
            "reason": "create",
            "expected": null,
            "next": {
                "title": "Handwritten practice", "provider": "manual", "model": "",
                "retired": [],
                "questions": [{
                    "identity": "fa000000-0000-4000-8000-0000000000e1",
                    "origin": "user", "question": "Stemprivacyword?",
                    "options": ["Optionprivacyword", "Other"], "correctIndex": 0,
                    "explanation": "Explanationprivacyword", "sourcePage": null
                }]
            }
        }),
    )
    .unwrap();
    let host = f.host();
    let response = f
        .search(&host, "Stemprivacyword", ALL, &["authored"])
        .unwrap();
    let found = hits(&response);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, "authored");
    assert_eq!(found[0].1, "practice");
    let stem_response = serde_json::to_string(&response).unwrap();
    for word in ["Optionprivacyword", "Explanationprivacyword"] {
        assert!(!stem_response.contains(word), "snippet leaked {word}");
        assert!(hits(&f.search(&host, word, ALL, &["authored"]).unwrap()).is_empty());
    }
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
                material_filters_active: false,
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
    crate::test_wait::wait_for("running rebuild watchdog tick report", || {
        tick_rx.try_recv().is_ok()
    });
    let interrupted = interrupted.lock().unwrap().clone().unwrap();
    crate::test_wait::wait_for("SQLite reported SQLITE_INTERRUPT", || {
        interrupted.load(Ordering::SeqCst)
    });
    assert_eq!(hits(&f.search(&host, "alpha", ALL, &[]).unwrap()).len(), 1);
}

#[test]
fn digests_match_the_shared_vectors_used_by_the_ui() {
    // Computed outside both implementations; src/logic/savedSearch.test.ts
    // checks the same values.
    for (fields, hex) in [
        (
            vec!["a", "b"],
            "facdde7abf1eac5b301273ab2e282f79bab0100f058833a7b8bdf9f80741e149",
        ),
        (
            vec!["é"],
            "2f23c71856587c2a6ffdb64f0e11e9940b35da318947308f6a02ee01898e6107",
        ),
        (
            vec!["a\u{0}b", "c"],
            "0f45d85bef43c532705b8e59087cb895ab148782c674d20610e5975f46a84334",
        ),
        (
            vec!["a", "b\u{0}c"],
            "948d2b0c65c70f1736d40043f14736a059763420fe3c8c71c8ea646bbf05c964",
        ),
        (
            vec!["Crosswind landings", "Use the wing-low method."],
            "247767ba8b30e060aed68c6d6ffde318a8ff2015ea49bac365d799aa044f9011",
        ),
        (
            vec!["✈️ fly", "日本語"],
            "4549eb77598f1c0f00e7ffe55a5490e1e78be88ebba40113d2ede078c768291a",
        ),
    ] {
        assert_eq!(item_digest(&fields), hex, "{fields:?}");
    }
}

#[test]
fn a_huge_title_is_never_read_or_repeated_per_passage() {
    let f = Fixture::new();
    let cards: Vec<String> = (0..500)
        .map(|i| format!(r#"{{"front":"tiny {i}","back":"crosswind"}}"#))
        .collect();
    let db = f.db();
    for (id, title) in [("huge", "T".repeat(3_000_000)), ("long", "L".repeat(1000))] {
        db.execute("INSERT INTO study_materials VALUES (?1, ?2)", [id, &title])
            .unwrap();
        db.execute(
            "INSERT INTO ai_study_sets (source_material_id, flashcards_json) VALUES (?1, ?2)",
            [id, &format!("[{}]", cards.join(","))],
        )
        .unwrap();
    }
    let host = f.host();
    let r = f
        .search(&host, "crosswind", ALL, &["huge", "long"])
        .unwrap();
    let groups = &r.saved.as_ref().unwrap().groups;
    let title_of = |id: &str| {
        groups
            .iter()
            .find(|g| g.material_id.as_deref() == Some(id))
            .unwrap()
            .title
            .clone()
    };
    // Over the byte cap: never read, shown as untitled.
    assert_eq!(title_of("huge"), "Untitled material");
    // Under it: clipped once, for the group.
    assert_eq!(title_of("long").chars().count(), LABEL_CHARS);
    assert!(serde_json::to_vec(&r).unwrap().len() <= super::super::MAX_RESPONSE_BYTES);
}

#[test]
fn homework_search_current_uuid_digest_scope_and_rebuild() {
    let f = Fixture::new();
    let db = f.db();
    db.execute_batch("INSERT INTO homework_assignments VALUES ('a','Fronts','Prepare privately',0),('b','ArchivedFronts','hidden',1);
        INSERT INTO homework_activities VALUES ('x','a','Clouds','Write reflection',NULL,NULL),('y','a','Linked','Linked fronts','m1',NULL),('z','a','RemovedFronts','hidden',NULL,'gone');").unwrap();
    let host = f.host();
    let response = f.search(&host, "fronts", ALL, &[]).unwrap();
    let saved = response.saved.unwrap();
    let group = saved.groups.iter().find(|g| g.kind == "homework").unwrap();
    assert_eq!(group.title, "Homework");
    let heading = group.passages.iter().find(|p| p.record_id == "a").unwrap();
    assert_eq!(
        heading.rev,
        Some(item_digest(&["Fronts", "Prepare privately"]))
    );
    assert!(!group
        .passages
        .iter()
        .any(|p| p.record_id == "b" || p.record_id == "a:z"));
    let reflection = f.search(&host, "reflection", ALL, &[]).unwrap();
    assert!(reflection
        .saved
        .unwrap()
        .groups
        .iter()
        .any(|g| g.passages.iter().any(|p| p.record_id == "a:x")));
    db.execute(
        "UPDATE homework_activities SET body='New reflection' WHERE id='x'",
        [],
    )
    .unwrap();
    let changed = f.search(&host, "reflection", ALL, &[]).unwrap();
    let p = changed
        .saved
        .unwrap()
        .groups
        .into_iter()
        .flat_map(|g| g.passages)
        .find(|p| p.record_id == "a:x")
        .unwrap();
    assert_eq!(p.rev, Some(item_digest(&["Clouds", "New reflection"])));
    db.execute(
        "UPDATE homework_assignments SET archived=1 WHERE id='a'",
        [],
    )
    .unwrap();
    assert!(f
        .search(&host, "reflection", ALL, &[])
        .unwrap()
        .saved
        .unwrap()
        .groups
        .is_empty());
}

#[test]
fn homework_search_excludes_archived_assignments_and_removed_activities() {
    let f = Fixture::new();
    let db = f.db();
    db.execute_batch(
        "INSERT INTO homework_assignments VALUES
           ('active', 'Activeword', '', 0),
           ('archived', 'Archivedword', '', 1);
         INSERT INTO homework_activities VALUES
           ('archived-activity', 'archived', 'Archivedactivityword', '', NULL, NULL),
           ('removed-activity', 'active', 'Removedactivityword', '', NULL, 'gone');",
    )
    .unwrap();
    let host = f.host();
    let expected_coverage = SavedCoverage {
        homework: 1,
        ..SavedCoverage::default()
    };
    let expected_hits = vec![("homework".into(), "homework", "active".into())];
    let response = f.search(&host, "activeword", ALL, &[]).unwrap();
    assert_eq!(hits(&response), expected_hits);
    assert_eq!(response.saved.as_ref().unwrap().state, "ok");
    assert_eq!(response.saved.as_ref().unwrap().coverage, expected_coverage);
    for word in [
        "archivedword",
        "archivedactivityword",
        "removedactivityword",
    ] {
        let response = f.search(&host, word, ALL, &[]).unwrap();
        assert!(hits(&response).is_empty(), "{word} must not be indexed");
        assert_eq!(response.saved.as_ref().unwrap().state, "ok", "{word}");
        assert_eq!(
            response.saved.as_ref().unwrap().coverage,
            expected_coverage,
            "{word} must not count toward coverage"
        );
    }

    // Each excluded row alone exceeds the preflight total-byte limit.
    // Search must still index the active assignment, without oversized items.
    let oversized = "x".repeat(MAX_SAVED_BYTES as usize + 1);
    for sql in [
        "UPDATE homework_assignments SET instructions=?1 WHERE id='archived'",
        "UPDATE homework_activities SET body=?1 WHERE id='archived-activity'",
        "UPDATE homework_activities SET body=?1 WHERE id='removed-activity'",
    ] {
        db.execute(sql, [&oversized]).unwrap();
        let response = f.search(&host, "activeword", ALL, &[]).unwrap();
        assert_eq!(response.saved.as_ref().unwrap().state, "ok", "{sql}");
        assert_eq!(hits(&response), expected_hits, "{sql}");
        assert_eq!(
            response.saved.as_ref().unwrap().coverage,
            expected_coverage,
            "{sql}"
        );
        db.execute(sql, [""]).unwrap();
    }
}

#[test]
fn homework_material_filters_never_include_unrelated_bodies() {
    let f = Fixture::new();
    f.db().execute_batch("INSERT INTO homework_assignments VALUES ('a','Scopeword heading','',0),('b','Scopeword unlinked','',0);
      INSERT INTO homework_activities VALUES ('x','a','Scopeword linked','Body','m1',NULL),('y','a','Scopeword unrelated','Body','m2',NULL),('z','b','Scopeword unlinked','Body',NULL,NULL);").unwrap();
    let host = f.host();
    let scoped = |ids: Vec<String>| {
        host.search(Request {
            targets: vec![],
            terms: parse("scopeword").unwrap(),
            offset: 0,
            coverage: Coverage::default(),
            saved: Some(SavedRequest {
                categories: ALL,
                material_ids: ids,
                material_filters_active: true,
            }),
            saved_available: true,
        })
        .unwrap()
    };
    let response = scoped(vec!["m1".into()]);
    let ids: Vec<_> = response
        .saved
        .unwrap()
        .groups
        .into_iter()
        .flat_map(|g| g.passages)
        .map(|p| p.record_id)
        .collect();
    assert!(ids.contains(&"a".to_string()));
    assert!(ids.contains(&"a:x".to_string()));
    assert!(!ids.contains(&"a:y".to_string()));
    assert!(!ids.contains(&"b".to_string()));
    assert!(scoped(vec![]).saved.unwrap().groups.is_empty());
    f.db()
        .execute(
            "UPDATE homework_activities SET removed_at='gone' WHERE id='x'",
            [],
        )
        .unwrap();
    assert!(scoped(vec!["m1".into()]).saved.unwrap().groups.is_empty());
}

#[test]
fn homework_obeys_field_and_total_byte_bounds() {
    let f = Fixture::new();
    let db = f.db();
    db.execute(
        "INSERT INTO homework_assignments VALUES ('a','bounded',?1,0)",
        ["x".repeat(MAX_TEXT_FIELD_BYTES as usize + 1)],
    )
    .unwrap();
    let host = f.host();
    let saved = f.search(&host, "bounded", ALL, &[]).unwrap().saved.unwrap();
    assert_eq!(saved.state, "ok");
    assert_eq!(saved.coverage.too_large_items, 1);
    assert!(saved.groups.is_empty());
    db.execute(
        "UPDATE homework_assignments SET instructions=?1",
        ["x".repeat(MAX_SAVED_BYTES as usize + 1)],
    )
    .unwrap();
    assert_eq!(
        f.search(&host, "bounded", ALL, &[])
            .unwrap()
            .saved
            .unwrap()
            .state,
        "too_large"
    );
}
