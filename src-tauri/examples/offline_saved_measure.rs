//! OFFLINE-02c §6 measurement harness for saved-content search. One fresh
//! process per run; the frozen manifest decides queries and schedule.
//!
//! Usage: offline_saved_measure <corpus dir> <manifest.json> <process #> <out.json>
//!
//! The corpus directory holds the generated `her-flight-deck.db` and
//! `expected.json`. Correctness checks are untimed; timed samples use the
//! production search command path (`Host::search`).

use her_flight_deck_lib::extraction::cache::{Cache, CACHE_FILE};
use her_flight_deck_lib::extraction::search::{
    audit_saved, parse, Categories, Coverage, Host, Initialization, Request, Response,
    SavedRequest, CANDIDATE_LIMIT,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const ALL: Categories = Categories {
    guides: true,
    cards: true,
    practice: true,
    notes: true,
    questions: true,
};

fn read(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn request(query: &str, categories: Categories, materials: &[String]) -> Request {
    Request {
        targets: vec![],
        terms: parse(query).unwrap(),
        offset: 0,
        coverage: Coverage::default(),
        saved: Some(SavedRequest {
            categories,
            material_ids: materials.to_vec(),
        }),
        saved_available: true,
    }
}

fn identities(r: &Response) -> Vec<(String, String, String)> {
    r.saved
        .as_ref()
        .unwrap()
        .groups
        .iter()
        .flat_map(|g| {
            g.passages.iter().map(move |p| {
                (
                    p.kind.to_string(),
                    if g.kind == "material" {
                        g.material_id.clone().unwrap_or_default()
                    } else {
                        String::new()
                    },
                    p.record_id.clone(),
                )
            })
        })
        .collect()
}

fn nearest_rank(samples: &[f64], p: f64) -> f64 {
    let mut s = samples.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let rank = ((p / 100.0) * s.len() as f64).ceil().max(1.0) as usize;
    s[rank - 1]
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let corpus = PathBuf::from(&args[1]);
    let manifest = read(Path::new(&args[2]));
    let process: u32 = args[3].parse().unwrap();
    let out = PathBuf::from(&args[4]);
    let expected = read(&corpus.join("expected.json"));
    let queries: Vec<String> = manifest["queries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|q| q.as_str().unwrap().to_string())
        .collect();
    let materials: Vec<String> = (1..=100).map(|m| format!("m{m:03}")).collect();
    let db_path = corpus.join("her-flight-deck.db");
    let edit = Connection::open(&db_path).unwrap();
    let mut slot = "zzeditslot".to_string();
    let mut marker = 0u64;
    let mut errors: Vec<String> = Vec::new();
    // The edited note's frozen membership in each query's expected set; the
    // post-edit reference check must keep it (§6).
    let manifest_path = PathBuf::from(&args[2]);
    let checker = manifest_path.with_file_name("check_note.py");
    let note_expected: Vec<bool> = (0..queries.len())
        .map(|qi| {
            expected[qi.to_string()]
                .as_array()
                .unwrap()
                .iter()
                .any(|x| x[0] == "note" && x[2] == "n0000")
        })
        .collect();
    let mut post_edit_checks = 0u64;
    let mut max_bytes = 0usize;

    // A fresh process: fresh cache beside the corpus, nothing verified.
    let _ = std::fs::remove_file(corpus.join(CACHE_FILE));
    Cache::open(&corpus).unwrap();
    let host = Host::start(corpus.join(CACHE_FILE));
    let started = Instant::now();
    while host.initialization() != Initialization::Ready {
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "setup never finished"
        );
        std::thread::sleep(Duration::from_millis(1));
    }

    // Cold rebuild: the first saved search in this process.
    let before = host.saved_rebuilds();
    let t = Instant::now();
    let cold = host.search(request(&queries[0], ALL, &materials));
    let cold_ms = t.elapsed().as_secs_f64() * 1000.0;
    if cold.is_err() || host.saved_rebuilds() != before + 1 {
        errors.push(format!("cold: {:?}", cold.as_ref().err()));
    }

    // Untimed correctness: exhaustive equals the reference set, and the
    // capped production order is its prefix.
    let mut correctness = Vec::new();
    let saved_request = SavedRequest {
        categories: ALL,
        material_ids: materials.clone(),
    };
    for (qi, q) in queries.iter().enumerate() {
        // The frozen identities group notes and questions under "" (they
        // are shown as "Your notes" and "Instructor questions"); the audit
        // reports a linked question's material, so it is normalized here.
        let normalize = |items: Vec<(String, String, String)>| -> Vec<(String, String, String)> {
            items
                .into_iter()
                .map(|(k, g, r)| {
                    let g = if k == "note" || k == "question" {
                        String::new()
                    } else {
                        g
                    };
                    (k, g, r)
                })
                .collect()
        };
        let all =
            normalize(audit_saved(corpus.join(CACHE_FILE), &saved_request, q, false).unwrap());
        let capped =
            normalize(audit_saved(corpus.join(CACHE_FILE), &saved_request, q, true).unwrap());
        let want: BTreeSet<(String, String, String)> = expected[qi.to_string()]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| {
                (
                    x[0].as_str().unwrap().to_string(),
                    x[1].as_str().unwrap().to_string(),
                    x[2].as_str().unwrap().to_string(),
                )
            })
            .collect();
        let got: BTreeSet<_> = all.iter().cloned().collect();
        let exact = got == want && got.len() == all.len();
        let prefix = capped[..] == all[..all.len().min(CANDIDATE_LIMIT)];
        if !exact || !prefix {
            errors.push(format!("query {qi}: exact {exact} prefix {prefix}"));
        }
        correctness.push(json!({"query": qi, "expected": want.len(), "found": all.len(), "exact": exact, "cappedPrefix": prefix}));
    }

    let mut results = Vec::new();
    for (qi, q) in queries.iter().enumerate() {
        let want: BTreeSet<(String, String, String)> = expected[qi.to_string()]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| {
                (
                    x[0].as_str().unwrap().to_string(),
                    x[1].as_str().unwrap().to_string(),
                    x[2].as_str().unwrap().to_string(),
                )
            })
            .collect();
        for mode in ["rebuild", "cached"] {
            let mut timed = Vec::new();
            for i in 0..18 {
                if mode == "rebuild" {
                    marker += 1;
                    let next = format!("editmarker{marker}");
                    edit.execute(
                        "UPDATE notes SET body = substr(body, 1, length(body) - length(?1)) || ?2 WHERE id = 'n0000'",
                        [&slot, &next],
                    )
                    .unwrap();
                    slot = next;
                    // Outside timing: rerun the independent reference scan on
                    // the committed note and require unchanged membership.
                    let (title, body): (String, String) = edit
                        .query_row(
                            "SELECT title, body FROM notes WHERE id = 'n0000'",
                            [],
                            |r| Ok((r.get(0)?, r.get(1)?)),
                        )
                        .unwrap();
                    let mut child = std::process::Command::new("python3")
                        .arg("-I")
                        .arg(&checker)
                        .arg(&manifest_path)
                        .stdin(std::process::Stdio::piped())
                        .stdout(std::process::Stdio::piped())
                        .spawn()
                        .unwrap();
                    use std::io::Write;
                    child
                        .stdin
                        .take()
                        .unwrap()
                        .write_all(json!({"title": title, "body": body}).to_string().as_bytes())
                        .unwrap();
                    let out = child.wait_with_output().unwrap();
                    let membership: Vec<bool> =
                        serde_json::from_slice(&out.stdout).unwrap_or_default();
                    post_edit_checks += 1;
                    if !out.status.success() || membership != note_expected {
                        errors.push(format!("post-edit reference q{qi} s{i}: {membership:?}"));
                    }
                }
                let before = host.saved_rebuilds();
                let t = Instant::now();
                let r = host.search(request(q, ALL, &materials));
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                let rebuilt = host.saved_rebuilds() - before;
                match &r {
                    Ok(resp) => {
                        max_bytes = max_bytes.max(serde_json::to_vec(resp).unwrap().len());
                        if !identities(resp).iter().all(|id| want.contains(id)) {
                            errors.push(format!("{mode} q{qi} s{i}: a shown item isn't expected"));
                        }
                    }
                    Err(e) => errors.push(format!("{mode} q{qi} s{i}: {e:?}")),
                }
                if (mode == "rebuild" && rebuilt != 1) || (mode == "cached" && rebuilt != 0) {
                    errors.push(format!("{mode} q{qi} s{i}: rebuilt {rebuilt}"));
                }
                if mode == "rebuild" {
                    // Untimed freshness: the edit is found, and only there.
                    let notes = Categories {
                        notes: true,
                        ..Categories::default()
                    };
                    let fresh = host.search(request(&slot, notes, &materials));
                    let ok = matches!(&fresh, Ok(r) if identities(r) == vec![("note".to_string(), String::new(), "n0000".to_string())]);
                    if !ok {
                        errors.push(format!("fresh q{qi} s{i}"));
                    }
                }
                // Admission (§6): a rebuild sample counts only if it rebuilt
                // exactly once, a cached sample only if it didn't rebuild.
                let admitted = r.is_ok()
                    && ((mode == "rebuild" && rebuilt == 1) || (mode == "cached" && rebuilt == 0));
                if i >= 3 && admitted {
                    timed.push(ms);
                }
            }
            results.push(json!({
                "query": qi, "mode": mode, "samplesMs": timed,
                "p50Ms": if timed.is_empty() { Value::Null } else { json!(nearest_rank(&timed, 50.0)) },
                "p95Ms": if timed.is_empty() { Value::Null } else { json!(nearest_rank(&timed, 95.0)) },
            }));
        }
    }
    let report = json!({
        "process": process,
        "coldRebuildMs": cold_ms,
        "correctness": correctness,
        "results": results,
        "maxResponseBytes": max_bytes,
        "postEditReferenceChecks": post_edit_checks,
        "errors": errors,
    });
    std::fs::write(out, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    println!(
        "process {process}: cold {cold_ms:.1} ms, {} errors",
        report["errors"].as_array().unwrap().len()
    );
}
