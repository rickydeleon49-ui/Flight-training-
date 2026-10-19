//! Explicit scratch-only OFFLINE-02a measurement executable. Never launches
//! Tauri, initializes a real profile or contacts a provider. All roots must be
//! children of the caller-supplied corpus directory containing frozen inputs.
use her_flight_deck_lib::extraction::{
    cache::{Cache, CACHE_FILE},
    inspect::Outcome,
    search::{self, Target},
    search_api::submit_search,
    service::Service,
    supervisor::{Extraction, PageResult},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

fn read(path: impl AsRef<Path>) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}
fn write(path: impl AsRef<Path>, value: &Value) {
    fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
}
fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}
fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn materials(manifest: &Value) -> Vec<Target> {
    manifest["materials"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| Target {
            material_id: m["id"].as_str().unwrap().into(),
            title: m["title"].as_str().unwrap().into(),
            material_type: "handbook".into(),
            original_file_name: Some(format!("{}.pdf", m["id"].as_str().unwrap())),
            added_at: "2026-10-19".into(),
            sha256: m["sha256"].as_str().unwrap().into(),
        })
        .collect()
}
fn fixture(dir: &Path, manifest: &Value) -> Arc<Service> {
    let root = dir.join("root");
    her_flight_deck_lib::extraction::search_api::initialize_storage(&root).unwrap();
    let svc = Arc::new(Service::new(root, PathBuf::from("worker-unused")));
    for t in materials(manifest) {
        assert_eq!(
            svc.verify(
                &svc.document_path(&format!("{}.pdf", t.material_id))
                    .unwrap()
            ),
            Some(t.sha256)
        );
    }
    svc
}
fn query(svc: Arc<Service>, ids: Vec<String>, q: String) -> (f64, Value, usize) {
    let entered = Instant::now();
    let result = loop {
        match submit_search(
            svc.clone(),
            q.clone(),
            ids.clone(),
            vec!["documentPages".into()],
            0,
            Instant::now(),
        ) {
            Ok(ticket) => break ticket.wait(),
            Err(code)
                if code == "index_preparing"
                    && entered.elapsed() < std::time::Duration::from_secs(5) =>
            {
                // A caller observes setup explicitly. Include this wait in the
                // first-query measurement; never discard it as a warm-up.
                std::thread::yield_now();
            }
            Err(code) => return (ms(entered), json!({"error":code}), 0),
        }
    };
    match result {
        Ok(r) => {
            let bytes = serde_json::to_vec(&r).unwrap();
            let elapsed = ms(entered);
            (
                elapsed,
                serde_json::from_slice(&bytes).unwrap(),
                bytes.len(),
            )
        }
        Err(e) => (ms(entered), json!({"error":e.code()}), 0),
    }
}
fn setup(dir: &Path, m: &Value) -> Value {
    let root = dir.join("root");
    assert!(!root.exists(), "setup never overwrites a root");
    fs::create_dir_all(root.join("documents")).unwrap();
    let mut cache = Cache::open(&root).unwrap();
    let input = fs::read(dir.join("documents.ndjson")).unwrap();
    assert_eq!(hash(&input), m["documentsSha256"].as_str().unwrap());
    for line in BufReader::new(input.as_slice()).lines() {
        let d: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let bytes = serde_json::to_vec(&d["pages"]).unwrap();
        assert_eq!(hash(&bytes), d["sha256"].as_str().unwrap());
        fs::write(
            root.join("documents")
                .join(format!("{}.pdf", d["id"].as_str().unwrap())),
            bytes,
        )
        .unwrap();
        let pages = d["pages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| PageResult {
                index: p["index"].as_u64().unwrap() as u32,
                outcome: match p["outcome"].as_str().unwrap() {
                    "text" => Outcome::Text,
                    "blank" => Outcome::Blank,
                    "image_only" | "imageOnly" => Outcome::ImageOnly,
                    "text_unreadable" | "textUnreadable" => Outcome::TextUnreadable,
                    "failed" => Outcome::Failed,
                    _ => Outcome::Unknown,
                },
                text: p["text"].as_str().unwrap().into(),
                error: None,
            })
            .collect();
        cache
            .publish(&Extraction {
                sha256: d["sha256"].as_str().unwrap().into(),
                peak_bytes: 0,
                pages,
            })
            .unwrap();
    }
    drop(cache);
    let db = Connection::open(root.join("her-flight-deck.db")).unwrap();
    let mut migrations: Vec<_> =
        fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations"))
            .unwrap()
            .map(|p| p.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "sql"))
            .collect();
    migrations.sort();
    db.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);")
        .unwrap();
    for (i, path) in migrations.iter().enumerate() {
        db.execute_batch(&fs::read_to_string(path).unwrap())
            .unwrap();
        db.execute("INSERT INTO schema_migrations VALUES (?1)", [i + 1])
            .unwrap();
    }
    for t in materials(m) {
        let file = format!("{}.pdf", t.material_id);
        let path = root.join("documents").join(&file);
        if !path.exists() {
            fs::copy(root.join("documents/doc001.pdf"), &path).unwrap();
        }
        db.execute(
            "INSERT INTO study_materials(id,title,material_type,original_file_name,created_at,updated_at,file_path) VALUES(?1,?2,'handbook',?3,'2026-10-19','2026-10-19',?3)",
            rusqlite::params![t.material_id, t.title, file],
        )
        .unwrap();
    }
    let mut conn = Connection::open(root.join(CACHE_FILE)).unwrap();
    conn.execute_batch("DELETE FROM search_passage; PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    fs::copy(root.join(CACHE_FILE), dir.join("baseline.db")).unwrap();
    let baseline = Connection::open(dir.join("baseline.db")).unwrap();
    baseline.execute_batch("DROP TRIGGER search_passage_ai; DROP TRIGGER search_passage_ad; DROP TRIGGER search_passage_au; DROP TABLE passage_fts; DROP TABLE search_passage; VACUUM;").unwrap();
    drop(baseline);
    let start = Instant::now();
    let tx = conn.transaction().unwrap();
    tx.execute("INSERT INTO search_passage(content_sha256,extractor_version,page_index,text) SELECT content_sha256,extractor_version,page_index,text FROM page_text WHERE outcome='text' ORDER BY content_sha256,page_index",[]).unwrap();
    tx.commit().unwrap();
    let index_ms = ms(start);
    conn.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(conn);
    let full = fs::metadata(root.join(CACHE_FILE)).unwrap().len();
    let baseline = fs::metadata(dir.join("baseline.db")).unwrap().len();
    json!({"indexMs":index_ms,"databaseBytes":full,"baselineBytes":baseline,"indexBytes":full-baseline,"canonicalBytes":m["canonicalBytes"],"storageRatio":(full-baseline) as f64/m["canonicalBytes"].as_u64().unwrap() as f64})
}
fn audit(dir: &Path, m: &Value) -> Value {
    let expected = read(dir.join("expected.json"));
    assert_eq!(
        hash(&fs::read(dir.join("expected.json")).unwrap()),
        m["expectedSha256"].as_str().unwrap()
    );
    let all = materials(m);
    let mut cases = Vec::new();
    for filter in ["all", "one", "quarter"] {
        let ids: Vec<String> = serde_json::from_value(m["filters"][filter].clone()).unwrap();
        let targets: Vec<_> = all
            .iter()
            .filter(|t| ids.contains(&t.material_id))
            .cloned()
            .collect();
        for (i, q) in m["queries"].as_array().unwrap().iter().enumerate() {
            let q = q.as_str().unwrap();
            let full =
                search::audit_order(dir.join("root").join(CACHE_FILE), &targets, q, false).unwrap();
            let capped =
                search::audit_order(dir.join("root").join(CACHE_FILE), &targets, q, true).unwrap();
            let mut set = full.clone();
            set.sort();
            let want: Vec<(String, u32)> =
                serde_json::from_value(expected[format!("{filter}:{i}")].clone()).unwrap();
            assert_eq!(set, want, "reference {filter} query {q}");
            assert_eq!(capped, full[..full.len().min(2000)], "cap {filter} {q}");
            cases.push(json!({"filter":filter,"query":q,"exhaustiveHits":full.len(),"cappedHits":capped.len(),"exactReference":true,"exactPrefix":true}));
        }
    }
    json!({"cases":cases})
}
fn bench(dir: &Path, m: &Value) -> Value {
    let start = Instant::now();
    let cache = Cache::open(&dir.join("root")).unwrap();
    let validation_ms = ms(start);
    drop(cache);
    let svc = fixture(dir, m);
    let ids = serde_json::from_value(m["filters"]["all"].clone()).unwrap();
    let (first_ms, first, _) = query(svc.clone(), ids, m["queries"][0].as_str().unwrap().into());
    let mut samples = Vec::new();
    for step in m["schedule"].as_array().unwrap() {
        let filter = step["filter"].as_str().unwrap();
        let index = step["query"].as_u64().unwrap() as usize;
        let ids: Vec<String> = serde_json::from_value(m["filters"][filter].clone()).unwrap();
        let q = m["queries"][index].as_str().unwrap().to_owned();
        for _ in 0..3 {
            query(svc.clone(), ids.clone(), q.clone());
        }
        for _ in 0..15 {
            let (elapsed, response, bytes) = query(svc.clone(), ids.clone(), q.clone());
            samples.push(json!({"filter":filter,"queryIndex":index,"ms":elapsed,"bytes":bytes,"error":response.get("error"),"groups":response["groups"].as_array().map(Vec::len)}));
        }
    }
    json!({"validationMs":validation_ms,"firstQueryMs":first_ms,"reopenPlusFirstQueryMs":validation_ms+first_ms,"firstError":first.get("error"),"samples":samples})
}
fn concurrent(dir: &Path, m: &Value, worker: &Path, pdf: &Path) -> Value {
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::{Condvar, Mutex};
    let svc = fixture(dir, m);
    // This is the prescribed WARM query case. Complete initialization and
    // three discarded queries before starting the extraction window.
    for _ in 0..3 {
        let ids = serde_json::from_value(m["filters"]["all"].clone()).unwrap();
        let (_, response, _) = query(svc.clone(), ids, m["queries"][0].as_str().unwrap().into());
        assert!(response.get("error").is_none());
    }
    let pdf_sha = hash(&fs::read(pdf).unwrap());
    let mut runs = Vec::new();
    for attempt in 1..=5 {
        let state = Arc::new((Mutex::new((false, false, None::<f64>)), Condvar::new()));
        let began = Instant::now();
        let mut child = Command::new(worker)
            .arg("--hfd-extract-worker")
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                serde_json::to_string(
                    &json!({"path":pdf,"sha256":pdf_sha,"limits":{"memoryBytes":536870912}}),
                )
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let observed = state.clone();
        let reader = std::thread::spawn(move || {
            let mut pages = Vec::new();
            for line in BufReader::new(stdout).lines() {
                let frame: Value = serde_json::from_str(&line.unwrap()).unwrap();
                let mut s = observed.0.lock().unwrap();
                match frame["type"].as_str() {
                    Some("page") => {
                        s.0 = true;
                        pages.push(PageResult {
                            index: frame["index"].as_u64().unwrap() as u32,
                            outcome: serde_json::from_value(frame["outcome"].clone()).unwrap(),
                            text: frame["text"].as_str().unwrap().into(),
                            error: frame
                                .get("error")
                                .and_then(Value::as_str)
                                .map(str::to_string),
                        });
                    }
                    Some("end") => {
                        s.1 = true;
                        s.2 = Some(ms(began));
                    }
                    _ => {}
                }
                observed.1.notify_all();
            }
            let mut s = observed.0.lock().unwrap();
            s.1 = true;
            observed.1.notify_all();
            pages
        });
        {
            let mut s = state.0.lock().unwrap();
            while !s.0 && !s.1 {
                s = state.1.wait(s).unwrap();
            }
        }
        let mut samples = Vec::new();
        for _ in 0..15 {
            if state.0.lock().unwrap().1 {
                break;
            }
            let start_ms = ms(began);
            let ids = serde_json::from_value(m["filters"]["all"].clone()).unwrap();
            let (elapsed, response, bytes) =
                query(svc.clone(), ids, m["queries"][0].as_str().unwrap().into());
            let end_ms = ms(began);
            if state.0.lock().unwrap().1 {
                break;
            }
            samples.push(json!({"startMs":start_ms,"endMs":end_ms,"ms":elapsed,"bytes":bytes,"error":response.get("error")}));
        }
        let exit = child.wait().unwrap();
        let pages = reader.join().unwrap();
        let end_ms = state.0.lock().unwrap().2;
        // No publish happens before the end frame: only the separate worker is
        // running during these samples. Publish is deliberately after join.
        let publish_start_ms = ms(began);
        if exit.success() {
            Cache::open(&dir.join("root"))
                .unwrap()
                .publish(&Extraction {
                    sha256: pdf_sha.clone(),
                    pages,
                    peak_bytes: 0,
                })
                .unwrap();
        }
        let accepted = samples.len() == 15
            && exit.success()
            && samples.iter().all(|s| {
                s["endMs"].as_f64().unwrap() < publish_start_ms
                    && end_ms.is_some_and(|end| s["endMs"].as_f64().unwrap() < end)
            });
        runs.push(json!({"attempt":attempt,"accepted":accepted,"samples":samples,"endFrameMs":end_ms,"publishBeganDuringSamples":false,"publishStartMs":publish_start_ms,"workerExit":exit.code()}));
        if accepted {
            break;
        }
    }
    let measured = runs.iter().any(|r| r["accepted"] == true);
    json!({"status":if measured{"MEASURED"}else{"NOT MEASURED"},"runs":runs})
}
fn reference() -> Value {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE VIRTUAL TABLE t USING fts5(text, tokenize='unicode61 remove_diacritics 2');",
    )
    .unwrap();
    let pairs = [
        ("café", "cafe"),
        ("ﬁnal", "final"),
        ("ＡＢＣ", "abc"),
        ("½", "1 2"),
        ("㎏", "kg"),
        ("straße", "straße"),
        ("气象", "气象"),
    ];
    for (index, (source, want)) in pairs.iter().enumerate() {
        db.execute(
            "INSERT INTO t(rowid,text) VALUES (?1,?2)",
            rusqlite::params![
                index + 1,
                her_flight_deck_lib::extraction::cache::canonical(source)
            ],
        )
        .unwrap();
        let expr = search::match_expression(&search::parse(want).unwrap());
        let hits: Vec<usize> = db
            .prepare("SELECT rowid FROM t WHERE t MATCH ?1")
            .unwrap()
            .query_map([expr], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(hits, vec![index + 1]);
    }
    for excluded in ["strasse", "气"] {
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM t WHERE t MATCH ?1", [excluded], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
    json!({"fixtures":7,"exclusions":2,"sqlite":db.query_row("SELECT sqlite_version()",[],|r|r.get::<_,String>(0)).unwrap()})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(args.len() >= 3, "MODE CORPUS_DIRECTORY [WORKER PDF]");
    let dir = PathBuf::from(&args[2]).canonicalize().unwrap();
    let m = read(dir.join("manifest.json"));
    // The marker is generated alongside the frozen corpus. It prevents an
    // accidental root argument from pointing at an existing app profile.
    assert!(dir.join("documents.ndjson").is_file());
    let result = match args[1].as_str() {
        "gate" => {
            let svc = Arc::new(Service::new(
                dir.join("must-not-be-created"),
                PathBuf::new(),
            ));
            assert!(!her_flight_deck_lib::extraction::service::extraction_enabled());
            assert_eq!(
                submit_search(
                    svc.clone(),
                    "wind".into(),
                    vec![],
                    vec!["documentPages".into()],
                    0,
                    Instant::now()
                )
                .err()
                .as_deref(),
                Some("offline_extraction_disabled")
            );
            assert_eq!(
                her_flight_deck_lib::extraction::search_api::verify_destination(
                    &svc,
                    "a",
                    &"0".repeat(64)
                ),
                Err("offline_extraction_disabled".into())
            );
            assert!(!dir.join("must-not-be-created").exists());
            json!({"search":"offline_extraction_disabled","destination":"offline_extraction_disabled","rootCreated":false})
        }
        "reference" => reference(),
        "setup" => setup(&dir, &m),
        "audit" => audit(&dir, &m),
        "bench" => bench(&dir, &m),
        "concurrent" => concurrent(&dir, &m, Path::new(&args[3]), Path::new(&args[4])),
        _ => panic!("unknown mode"),
    };
    write(dir.join(format!("last-{}.json", args[1])), &result);
    println!("{}", result);
}
