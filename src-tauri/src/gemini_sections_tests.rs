use super::*;
use crate::fake_gemini::FakeGemini;

struct TempDir(std::path::PathBuf);
impl TempDir {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "hfd-guide-sections-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
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
fn reply(body: &str, page: u32) -> String {
    json!({"candidates":[{"content":{"parts":[{"text":json!({"body":body,"sourcePages":[page]}).to_string()}]},"finishReason":"STOP"}]}).to_string()
}

struct Rig {
    dir: TempDir,
    fake: FakeGemini,
    cache: std::sync::Mutex<Arc<PreparedSources>>,
    http: Client,
    request: SectionRequest,
    clock: Arc<std::sync::atomic::AtomicI64>,
    messages: std::sync::Mutex<Vec<String>>,
}
impl Rig {
    fn new(pages: u32) -> Self {
        let dir = TempDir::new();
        std::fs::create_dir(dir.path().join("documents")).unwrap();
        std::fs::write(
            dir.path().join("documents/a.pdf"),
            generation_tests::pdf(pages, "sections"),
        )
        .unwrap();
        let clock = Arc::new(std::sync::atomic::AtomicI64::new(1_700_000_000));
        let now = clock.clone();
        Self {
            clock,
            messages: std::sync::Mutex::new(vec![]),
            dir,
            fake: FakeGemini::start(),
            cache: std::sync::Mutex::new(Arc::new(PreparedSources::new(
                gemini_files::Policy::default(),
                Arc::new(move || now.load(Ordering::SeqCst)),
            ))),
            http: generation_client().unwrap(),
            request: SectionRequest {
                material_id: "mat-a".into(),
                relative_path: "a.pdf".into(),
                chosen_pages: (1..=pages).collect(),
                base_revision: None,
                request_id: None,
            },
        }
    }
    fn run(&self, id: Option<&str>) -> Result<JobAnswer<GeneratedStudyAid>, SectionError> {
        self.run_with(id, &self.request, &|_| {})
    }
    fn run_with(
        &self,
        id: Option<&str>,
        req: &SectionRequest,
        hook: &(dyn Fn(&str) + Sync),
    ) -> Result<JobAnswer<GeneratedStudyAid>, SectionError> {
        self.run_key(id, req, hook, "synthetic-only")
    }
    fn run_key(
        &self,
        id: Option<&str>,
        req: &SectionRequest,
        hook: &(dyn Fn(&str) + Sync),
        key: &str,
    ) -> Result<JobAnswer<GeneratedStudyAid>, SectionError> {
        let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
        let cache = self.cache.lock().unwrap().clone();
        let ctx = GenContext {
            http: &self.http,
            base: &self.fake.base,
            api_key: key,
            choice: ModelChoice::Standard,
            cache: &cache,
            epoch: cache.epoch(),
            budget: &budget,
            say: &|m| self.messages.lock().unwrap().push(m),
        };
        tauri::async_runtime::block_on(activate(&ctx, self.dir.path(), req, id, hook))
    }
    fn id(&self) -> String {
        gemini_jobs::with(self.dir.path(), |j| j.list()[0].id.clone())
    }
    fn requests(&self) -> Vec<Value> {
        self.fake
            .log()
            .iter()
            .filter(|r| r.is_generate())
            .map(|r| r.json())
            .collect()
    }
    fn answer(&self, count: usize) {
        self.fake.behave(|b| {
            b.generate_answers = (0..count)
                .map(|n| reply("Synthetic section body.", n as u32 * 5 + 1))
                .collect()
        });
    }
    fn reopen(&self) {
        gemini_jobs::forget(self.dir.path());
        let now = self.clock.clone();
        *self.cache.lock().unwrap() = Arc::new(PreparedSources::new(
            gemini_files::Policy::default(),
            Arc::new(move || now.load(Ordering::SeqCst)),
        ));
    }
}

#[test]
fn planner_bounds() {
    let p = plan(&(1..=16).collect::<Vec<_>>(), &[]).unwrap();
    assert_eq!(
        p.iter()
            .map(|s| (s.page_start, s.page_end))
            .collect::<Vec<_>>(),
        [(1, 5), (6, 10), (11, 15), (16, 16)]
    );
    let hints = vec![(1, 24, "Chapter".to_string())];
    assert_eq!(
        plan(&(1..=24).collect::<Vec<_>>(), &hints)
            .unwrap()
            .iter()
            .map(|s| (s.page_start, s.page_end))
            .collect::<Vec<_>>(),
        [(1, 10), (11, 20), (21, 24)]
    );
    assert_eq!(
        plan(&(1..=201).collect::<Vec<_>>(), &[]).unwrap_err().code,
        "TOO_MANY_SECTIONS"
    );
    let s = &p[0];
    assert!(validate_section(
        s,
        &json!({"body":"x".repeat(16_000),"sourcePages":[1]}).to_string(),
        &(1..=16).collect::<Vec<_>>(),
        "model"
    )
    .is_ok());
    assert!(validate_section(
        s,
        &json!({"body":"x".repeat(16_001),"sourcePages":[1]}).to_string(),
        &(1..=16).collect::<Vec<_>>(),
        "model"
    )
    .is_err());
}

#[test]
fn finish_3_kill_reopen_retry_only_section_4() {
    let r = Rig::new(20);
    r.fake.behave(|b| {
        b.generate_answers = (1..=3)
            .map(|n| reply(&format!("Body {n}"), (n - 1) * 5 + 1))
            .chain(["bad JSON".into()])
            .collect()
    });
    assert!(r.run(None).is_err());
    let id = r.id();
    let before = r.requests();
    assert_eq!(before.len(), 4);
    r.reopen();
    assert_eq!(r.requests().len(), 4, "reopen sends nothing");
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Body 4", 16)));
    let result = r.run(Some(&id)).unwrap();
    assert_eq!(result.answer.sections.len(), 4);
    let after = r.requests();
    assert_eq!(after.len(), 5);
    assert_eq!(
        after[4], after[3],
        "the exact unfinished request uses the retained PDF"
    );
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(r.fake.count(|q| q.is_lookup()), 1);
    for (i, body) in after[..4].iter().enumerate() {
        let first = i as u32 * 5 + 1;
        let last = first + 4;
        let pages: Vec<_> = (first..=last)
            .map(|p| json!({"pdfPage":p,"sourcePage":p}))
            .collect();
        let prompt=format!("guide-section-prompt-v1: Write only section section-{:02} (Pages {first}–{last}) from the attached PDF. Read ONLY these selected PDF pages and cite their original sourcePage numbers: {}. Do not discuss other pages. Use only supported facts; do not invent procedures or regulations. Return JSON with body (nonempty Markdown, at most 16000 characters) and sourcePages (ordered unique original source page numbers actually used). This is a Gemini study aid to check against current FAA material and her instructor.",i+1,json!(pages));
        let expected = json!({"contents":[{"role":"user","parts":[{"text":prompt},{"file_data":{"mime_type":"application/pdf","file_uri":format!("{}/v1beta/files/synthetic-1",r.fake.base)}}]}],"generationConfig":{"responseMimeType":"application/json","maxOutputTokens":8192,"responseSchema":{"type":"OBJECT","required":["body","sourcePages"],"properties":{"body":{"type":"STRING"},"sourcePages":{"type":"ARRAY","items":{"type":"INTEGER"}}}}}});
        assert_eq!(*body, expected);
        assert!(
            !body.to_string().contains("Body "),
            "finished output never resent"
        );
    }
}

#[test]
fn overnight_retry_renews_activation_not_finished_sections() {
    let r = Rig::new(10);
    r.fake
        .behave(|b| b.generate_answers = vec![reply("First", 1), "bad".into()]);
    assert!(r.run(None).is_err());
    let id = r.id();
    gemini_jobs::with(r.dir.path(), |j| j.test_expire_sections(&id));
    r.reopen();
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Second", 6)));
    assert!(r.run(Some(&id)).is_ok());
    assert_eq!(r.requests().len(), 3);
    let d = read_draft(r.dir.path(), &id).unwrap();
    assert_eq!(d.activations.len(), 2);
    assert_eq!(d.activations[1].submissions, 1);
    assert_eq!(d.timing["policy"], "stage-v1");
    assert!(d.timing["remainingMillis"].as_u64().unwrap() > 890_000);
}

#[test]
fn complete_guide_save_retry_zero_network() {
    let r = Rig::new(5);
    r.answer(1);
    let first = r.run(None).unwrap();
    let id = r.id();
    let count = r.fake.log().len();
    r.reopen();
    let second = r.run(Some(&id)).unwrap();
    assert_eq!(
        serde_json::to_value(first.answer).unwrap(),
        serde_json::to_value(second.answer).unwrap()
    );
    assert_eq!(r.fake.log().len(), count);
    assert!(gemini_jobs::with(r.dir.path(), |j| j.acknowledge(&id)).unwrap());
    r.reopen();
    assert!(r.run(Some(&id)).is_err());
    assert_eq!(r.fake.log().len(), count);
}

#[test]
fn changed_pdf_or_pages_requires_consent() {
    let r = Rig::new(10);
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    assert!(r.run(None).is_err());
    let id = r.id();
    let count = r.fake.log().len();
    let mut changed = r.request.clone();
    changed.chosen_pages.reverse();
    assert_eq!(
        r.run_with(Some(&id), &changed, &|_| {}).unwrap_err().code,
        "SOURCE_CHANGED"
    );
    std::fs::write(
        r.dir.path().join("documents/a.pdf"),
        generation_tests::pdf(10, "changed"),
    )
    .unwrap();
    assert_eq!(r.run(Some(&id)).unwrap_err().code, "SOURCE_CHANGED");
    assert_eq!(r.fake.log().len(), count);
}

#[test]
fn pdf_changed_between_sections_stops_before_next_request() {
    let r = Rig::new(20);
    r.fake.behave(|b| {
        b.generate_answers = (1..=4)
            .map(|n| reply(&format!("Body {n}"), (n - 1) * 5 + 1))
            .collect()
    });
    let commits = std::sync::atomic::AtomicUsize::new(0);
    let error: SectionError = r
        .run_with(None, &r.request, &|point| {
            if point == "after-section-commit" && commits.fetch_add(1, Ordering::SeqCst) == 1 {
                let d = read_draft(r.dir.path(), &r.id()).unwrap();
                assert_eq!(d.results["section-02"].status, Status::Complete);
                std::fs::write(
                    r.dir.path().join("documents/a.pdf"),
                    generation_tests::pdf(20, "changed between sections"),
                )
                .unwrap();
            }
        })
        .unwrap_err();
    assert_eq!(error.code, "SOURCE_CHANGED");
    assert_eq!(r.requests().len(), 2, "section 3 must never be sent");
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(commits.load(Ordering::SeqCst), 2);

    let id = r.id();
    r.reopen();
    let d = read_draft(r.dir.path(), &id).expect("partial draft must remain in the journal");
    assert_eq!(d.results.len(), 4);
    for n in 1..=2 {
        let result = &d.results[&format!("section-{n:02}")];
        assert_eq!(result.status, Status::Complete);
        let content = result.content.as_ref().unwrap();
        assert_eq!(content.body, format!("Body {n}"));
        assert_eq!(content.source_pages, vec![(n - 1) * 5 + 1]);
    }
    for n in 3..=4 {
        let result = &d.results[&format!("section-{n:02}")];
        assert_eq!(result.status, Status::Pending);
        assert!(result.content.is_none());
    }
}

#[test]
fn restart_requires_consent_and_keeps_old_draft() {
    let r = Rig::new(5);
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    assert!(r.run(None).is_err());
    let id = r.id();
    let old = read_draft(r.dir.path(), &id).unwrap();
    assert_eq!(
        restart_draft(r.dir.path(), &id, false, &r.request, ModelChoice::Standard)
            .unwrap_err()
            .code,
        "CONSENT_REQUIRED"
    );
    let new = restart_draft(r.dir.path(), &id, true, &r.request, ModelChoice::Standard).unwrap();
    assert_ne!(id, new);
    assert_eq!(
        serde_json::to_value(old).unwrap(),
        serde_json::to_value(read_draft(r.dir.path(), &id).unwrap()).unwrap()
    );
    assert_eq!(r.requests().len(), 1);
}

#[test]
fn checkpoint_failure_stops_next_section() {
    let r = Rig::new(10);
    r.answer(2);
    let root = r.dir.path().to_path_buf();
    assert!(r
        .run_with(None, &r.request, &move |point| {
            if point == "before-section-commit" {
                std::fs::create_dir(root.join("gemini-jobs.json.writing")).unwrap();
            }
        })
        .is_err());
    assert_eq!(r.requests().len(), 1);
    std::fs::remove_dir(r.dir.path().join("gemini-jobs.json.writing")).unwrap();
    r.reopen();
    assert_ne!(
        read_draft(r.dir.path(), &r.id()).unwrap().results["section-01"].status,
        Status::Complete
    );
}

#[test]
fn cancel_before_dispatch_and_after_checkpoint() {
    for point in ["before-reservation", "after-section-commit"] {
        let r = Rig::new(10);
        r.answer(2);
        let root = r.dir.path().to_path_buf();
        let result = r.run_with(None, &r.request, &move |at| {
            if at == point {
                gemini_jobs::with(&root, |j| {
                    let id = j.list()[0].id.clone();
                    j.cancel(&id).unwrap();
                });
            }
        });
        assert!(result.is_err());
        assert_eq!(
            r.requests().len(),
            usize::from(point == "after-section-commit")
        );
        r.reopen();
        let d = read_draft(r.dir.path(), &r.id()).unwrap();
        assert_eq!(
            d.results["section-01"].status == Status::Complete,
            point == "after-section-commit"
        );
    }
}

#[test]
fn concurrent_workers_cannot_duplicate_section() {
    let r = Rig::new(5);
    r.answer(1);
    r.run_with(None, &r.request, &|point| {
        if point == "after-reservation" {
            let id = r.id();
            std::thread::scope(|scope| {
                let second = scope.spawn(|| r.run(Some(&id)));
                assert!(second.join().unwrap().is_err());
            });
        }
    })
    .unwrap();
    assert_eq!(r.requests().len(), 1);
}

#[test]
fn corrupt_journal_fails_closed_no_dispatch() {
    let r = Rig::new(5);
    std::fs::write(r.dir.path().join("gemini-jobs.json"), b"{broken").unwrap();
    assert!(r.run(None).is_err());
    r.reopen();
    assert!(r.run(None).is_err());
    assert!(r.fake.log().is_empty());
}

#[test]
fn crash_points_preserve_durable_state() {
    for point in [
        "before-reservation",
        "after-reservation",
        "after-section-commit",
        "after-ready",
    ] {
        let r = Rig::new(5);
        r.answer(1);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            r.run_with(None, &r.request, &|at| {
                if at == point {
                    panic!("synthetic crash");
                }
            })
        }));
        assert!(result.is_err());
        let id = r.id();
        let count = r.requests().len();
        r.reopen();
        assert_eq!(r.requests().len(), count);
        r.answer(1);
        r.run(Some(&id)).unwrap();
        assert_eq!(
            r.requests().len(),
            if matches!(point, "after-section-commit" | "after-ready") {
                count
            } else {
                count + 1
            }
        );
    }
}

fn init_database(root: &Path) {
    let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('mat-a','Synthetic','2026-10-20T00:00:00.000Z','2026-10-20T00:00:00.000Z')", []).unwrap();
}
fn save_operation(answer: &GeneratedStudyAid) -> Value {
    json!({"operationId":"5e700000-0000-4000-8000-000000000001","materialId":"mat-a","reason":"create","expected":null,"next":{
        "title":answer.title,"summary":answer.summary,"summaryOrigin":null,"sections":answer.sections,"flashcards":[],
        "sourceNotes":answer.source_notes,"provider":"gemini","model":answer.model,"retired":[]}})
}
fn stored(root: &Path) -> Value {
    let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
    conn.query_row("SELECT title,summary,sections_json,flashcards_json,source_notes,provider,model,generated_at,updated_at,summary_origin,retired_json FROM ai_study_sets WHERE source_material_id='mat-a'", [], |row| {
        let mut out = serde_json::Map::new();
        for (i,key) in crate::study_sets::SET_COLUMNS.iter().enumerate() {
            let v: Option<String> = row.get(i)?;
            out.insert((*key).into(),v.map_or(Value::Null,Value::String));
        }
        Ok(Value::Object(out))
    }).unwrap()
}

#[test]
fn stale_edited_set_not_overwritten() {
    let r = Rig::new(5);
    r.answer(1);
    init_database(r.dir.path());
    let first = r.run(None).unwrap();
    let id = r.id();
    let op = save_operation(&first.answer);
    // Her edit arrives after generation began against no saved set.
    let mut her_op = op.clone();
    her_op["operationId"] = json!("5e700000-0000-4000-8000-000000000002");
    her_op["next"]["title"] = json!("Her edited title");
    crate::study_sets::save_study_set_at(r.dir.path(), &her_op).unwrap();
    let before = stored(r.dir.path());
    let error = save_guide_at(r.dir.path(), &id, &op).unwrap_err();
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "STALE_CONTENT"
    );
    assert_eq!(stored(r.dir.path()), before);
    assert_eq!(r.requests().len(), 1);
}

#[test]
fn crash_after_final_save_and_after_acknowledgement() {
    let r = Rig::new(5);
    r.answer(1);
    init_database(r.dir.path());
    let result = r.run(None).unwrap();
    let id = r.id();
    let op = save_operation(&result.answer);
    assert_eq!(
        save_guide_at(r.dir.path(), &id, &op).unwrap().status,
        "saved"
    );
    // Crash after the SQLite commit, before acknowledgement: same save is idempotent.
    let count = r.fake.log().len();
    let saved = stored(r.dir.path());
    r.reopen();
    r.run(Some(&id)).unwrap();
    assert_eq!(
        save_guide_at(r.dir.path(), &id, &op).unwrap().status,
        "already_saved"
    );
    assert_eq!(stored(r.dir.path()), saved);
    assert!(gemini_jobs::with(r.dir.path(), |j| j.acknowledge(&id)).unwrap());
    r.reopen();
    assert!(r.run(Some(&id)).is_err());
    assert_eq!(stored(r.dir.path()), saved);
    assert_eq!(r.fake.log().len(), count);
}

#[test]
fn source_changed_before_save_is_typed_and_zero_network() {
    let r = Rig::new(5);
    r.answer(1);
    init_database(r.dir.path());
    let result = r.run(None).unwrap();
    let id = r.id();
    let count = r.fake.log().len();
    std::fs::write(
        r.dir.path().join("documents/a.pdf"),
        generation_tests::pdf(5, "changed"),
    )
    .unwrap();
    let error = save_guide_at(r.dir.path(), &id, &save_operation(&result.answer)).unwrap_err();
    assert_eq!(
        serde_json::to_value(error).unwrap()["code"],
        "SOURCE_CHANGED"
    );
    assert_eq!(r.fake.log().len(), count);
}

#[test]
fn fresh_request_cannot_bypass_restart_consent() {
    let r = Rig::new(5);
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    assert!(r.run(None).is_err());
    let id = r.id();
    let count = r.fake.log().len();
    std::fs::write(
        r.dir.path().join("documents/a.pdf"),
        generation_tests::pdf(5, "changed"),
    )
    .unwrap();
    assert!(r.run(None).is_err());
    assert_eq!(r.fake.log().len(), count);
    assert!(read_draft(r.dir.path(), &id).is_ok());
}

#[test]
fn section_attempts_and_activation_ledger_are_durable_and_bounded() {
    let r = Rig::new(10);
    // Two retries on the first section exhaust both spare submissions. The
    // second section still gets its one initial submission, never a retry.
    r.fake.behave(|b| {
        b.generate_statuses = vec![(503, "busy".into()), (503, "busy".into())];
        b.generate_retry_after = Some("0".into());
        b.generate_answers = vec![reply("First", 1), "bad".into()];
    });
    assert!(r.run(None).is_err());
    let d = read_draft(r.dir.path(), &r.id()).unwrap();
    assert_eq!(d.activations[0].submissions, 4);
    assert_eq!(d.activations[0].reservations["section-01"], 3);
    assert_eq!(d.activations[0].reservations["section-02"], 1);
    let bodies = r.requests();
    assert_eq!(bodies.len(), 4);
    assert_eq!(bodies[0], bodies[1]);
    assert_eq!(bodies[1], bodies[2]);
    assert_ne!(bodies[2], bodies[3]);
}

#[test]
fn selected_pdf_hash_and_request_page_mapping_survive_reopen() {
    let r = Rig::new(20);
    let mut req = r.request.clone();
    req.chosen_pages = vec![3, 4, 5, 11, 12];
    r.fake
        .behave(|b| b.generate_answers = vec![reply("First range", 3), "bad".into()]);
    assert!(r.run_with(None, &req, &|_| {}).is_err());
    let id = r.id();
    let d = read_draft(r.dir.path(), &id).unwrap();
    assert_ne!(d.identity.original_sha256, d.identity.selected_sha256);
    r.reopen();
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Second range", 11)));
    assert!(r.run_with(Some(&id), &req, &|_| {}).is_ok());
    let bodies = r.requests();
    assert_eq!(bodies.len(), 3);
    assert_eq!(bodies[1], bodies[2]);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(r.fake.count(|q| q.is_lookup()), 1);
    let prompt = bodies[2]["contents"][0]["parts"][0]["text"]
        .as_str()
        .unwrap();
    assert!(prompt.contains("\"pdfPage\":4,\"sourcePage\":11"));
    let upload = r
        .fake
        .log()
        .into_iter()
        .find(|q| q.is_upload_finalize())
        .unwrap();
    assert_eq!(
        lopdf::Document::load_mem(&upload.body)
            .unwrap()
            .get_pages()
            .len(),
        5
    );
}

#[cfg(unix)]
#[test]
fn corruption_quarantine_failure_still_blocks() {
    use std::os::unix::fs::PermissionsExt;
    let r = Rig::new(5);
    std::fs::write(r.dir.path().join("gemini-jobs.json"), b"{broken").unwrap();
    std::fs::set_permissions(r.dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let mut journal = gemini_jobs::Journal::open(r.dir.path());
    std::fs::set_permissions(r.dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(journal
        .begin(JobKind::StudyAid, "mat-a", "a.pdf", &"a".repeat(64), None)
        .is_err());
    assert!(r.fake.log().is_empty());
}

#[test]
fn section_journal_limits_refuse_without_eviction_or_upload() {
    let r = Rig::new(5);
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    for i in 0..8 {
        let mut req = r.request.clone();
        req.material_id = format!("mat-{i}");
        assert!(r.run_with(None, &req, &|_| {}).is_err());
    }
    let before = gemini_jobs::with(r.dir.path(), |j| j.list());
    assert_eq!(before.len(), 8);
    let count = r.fake.log().len();
    assert!(r.run(None).is_err());
    assert_eq!(r.fake.log().len(), count);
    assert_eq!(gemini_jobs::with(r.dir.path(), |j| j.list()), before);
    let too_many = Rig::new(201);
    assert_eq!(too_many.run(None).unwrap_err().code, "TOO_MANY_SECTIONS");
    assert!(too_many.fake.log().is_empty());
}

#[test]
fn legacy_retry_cannot_replace_a_later_section_draft() {
    let r = Rig::new(5);
    gemini_jobs::with(r.dir.path(), |j| {
        let id = j
            .begin(JobKind::StudyAid, "mat-a", "a.pdf", &"a".repeat(64), None)
            .unwrap();
        j.checkpoint_draft(&id, json!({"target":20})).unwrap();
        j.failed(&id, "Synthetic pause").unwrap();
    });
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    assert!(r.run(None).is_err());
    let before = gemini_jobs::with(r.dir.path(), |j| j.list());
    assert_eq!(before.len(), 2);
    assert!(gemini_jobs::with(r.dir.path(), |j| j.begin(
        JobKind::StudyAid,
        "mat-a",
        "a.pdf",
        &"a".repeat(64),
        None
    ))
    .is_err());
    assert_eq!(gemini_jobs::with(r.dir.path(), |j| j.list()), before);
}

fn paused_reference(r: &Rig) -> (String, Value) {
    r.fake
        .behave(|b| b.generate_answers = vec![reply("Finished first", 1), "bad".into()]);
    assert!(r.run(None).is_err());
    let id = r.id();
    let disk: Value =
        serde_json::from_slice(&std::fs::read(r.dir.path().join("gemini-jobs.json")).unwrap())
            .unwrap();
    let descriptor = disk["jobs"][0]["draft"]["preparedFile"].clone();
    assert!(
        descriptor.is_object(),
        "successful preparation must commit its descriptor"
    );
    (id, descriptor)
}
fn counts(r: &Rig) -> (usize, usize, usize) {
    (
        r.fake.count(|q| q.is_upload_finalize()),
        r.fake.count(|q| q.is_lookup()),
        r.requests().len(),
    )
}
fn edit_descriptor(r: &Rig, edit: impl FnOnce(&mut Value)) {
    gemini_jobs::forget(r.dir.path());
    let path = r.dir.path().join("gemini-jobs.json");
    let mut disk: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    edit(&mut disk["jobs"][0]["draft"]["preparedFile"]);
    std::fs::write(path, serde_json::to_vec(&disk).unwrap()).unwrap();
}
#[test]
fn valid_remote_reference_survives_reopen_zero_uploads() {
    let r = Rig::new(10);
    let (id, _) = paused_reference(&r);
    let first = r.requests();
    assert_eq!(counts(&r), (1, 0, 2));
    r.reopen();
    assert_eq!(counts(&r), (1, 0, 2));
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Second", 6)));
    r.run(Some(&id)).unwrap();
    assert_eq!(counts(&r), (1, 1, 3));
    assert_eq!(r.requests()[2], first[1]);
}
#[test]
fn expired_reference_one_upload_no_finished_requests() {
    for missing in [false, true] {
        let r = Rig::new(10);
        let (id, _) = paused_reference(&r);
        let first = r.requests();
        if missing {
            r.fake.vanish("files/synthetic-1");
        } else {
            r.clock.store(4_070_908_801, Ordering::SeqCst); // after 2099 expiry
            r.fake
                .behave(|b| b.expiration_time = Some("2100-01-01T00:00:00Z".into()));
        }
        r.reopen();
        r.fake
            .behave(|b| b.generate_answer = Some(reply("Second", 6)));
        r.run(Some(&id)).unwrap();
        assert_eq!(counts(&r), (2, usize::from(missing), 3));
        let mut expected = first[1].clone();
        expected["contents"][0]["parts"][1]["file_data"]["file_uri"] =
            json!(format!("{}/v1beta/files/synthetic-2", r.fake.base));
        assert_eq!(r.requests()[2], expected);
    }
}
#[test]
fn lookup_failure_no_reupload() {
    for transport in [false, true] {
        let r = Rig::new(10);
        let (id, _) = paused_reference(&r);
        r.reopen();
        r.fake.behave(|b| {
            b.lookup_status = (!transport).then_some(503);
            b.drop_lookups = transport;
        });
        assert_eq!(
            r.run(Some(&id)).unwrap_err().code,
            "REFERENCE_LOOKUP_FAILED"
        );
        assert_eq!(counts(&r), (1, 1, 2));
    }
}
#[test]
fn auth_error_pauses_without_upload() {
    for status in [401, 403] {
        let r = Rig::new(10);
        let (id, _) = paused_reference(&r);
        r.reopen();
        r.fake.behave(|b| b.lookup_status = Some(status));
        assert_eq!(r.run(Some(&id)).unwrap_err().code, "REFERENCE_AUTH_FAILED");
        assert_eq!(counts(&r), (1, 1, 2));
    }
}
#[test]
fn tampered_descriptor_fails_closed() {
    for (field, value) in [
        (
            "uri",
            json!("https://foreign.invalid/v1beta/files/foreign?key=secret"),
        ),
        ("name", json!("files/other-owned-looking-name")),
        ("allowedHost", json!("foreign.invalid")),
        ("mime", json!("text/plain")),
        ("expiresAt", json!(4_000_000_000i64)),
        ("selectedSha256", json!("a".repeat(64))),
        ("integrity", json!("a".repeat(64))),
        ("credentialFingerprint", json!("broken")),
        ("unknown", json!("secret")),
        ("null", Value::Null),
    ] {
        let r = Rig::new(10);
        let (id, _) = paused_reference(&r);
        edit_descriptor(&r, |d| {
            if field == "null" {
                *d = Value::Null;
            } else {
                d[field] = value;
            }
        });
        r.reopen();
        assert_eq!(
            r.run(Some(&id)).unwrap_err().code,
            "DESCRIPTOR_INVALID",
            "{field}"
        );
        assert_eq!(counts(&r), (1, 0, 2), "{field}");
    }
}
#[test]
fn key_change_requires_continue_no_upload() {
    let r = Rig::new(10);
    let (id, _) = paused_reference(&r);
    r.reopen();
    assert_eq!(
        r.run_key(Some(&id), &r.request, &|_| {}, "synthetic-changed")
            .unwrap_err()
            .code,
        "KEY_CHANGED"
    );
    assert_eq!(counts(&r), (1, 0, 2));
}
#[test]
fn descriptor_never_in_ipc_logs_exports_backups() {
    use std::io::Read;
    let r = Rig::new(10);
    let (id, descriptor) = paused_reference(&r);
    assert_eq!(
        descriptor
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec![
            "allowedHost",
            "credentialFingerprint",
            "expiresAt",
            "integrity",
            "mime",
            "name",
            "selectedSha256",
            "uri"
        ]
    );
    let descriptor_json = descriptor.to_string();
    for secret in [
        "synthetic-only",
        "upload_id=",
        "X-Goog-Upload",
        "Authorization",
        "Bearer ",
        "?",
    ] {
        assert!(
            !descriptor_json.contains(secret),
            "persisted secret {secret}"
        );
    }
    let records = gemini_jobs::with(r.dir.path(), |j| j.list());
    let ipc = serde_json::to_string(&records).unwrap();
    let debug = format!("{records:?}");
    let logs = serde_json::to_string(&*r.messages.lock().unwrap()).unwrap();
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Second", 6)));
    let answer = r.run(Some(&id)).unwrap();
    let export = serde_json::to_string(&answer).unwrap();
    init_database(r.dir.path());
    let out = TempDir::new();
    let archive = out.path().join("synthetic.hfdbackup");
    crate::backup::create_consistent_complete_backup_with_retry(r.dir.path(), &archive, "0.5.7")
        .unwrap();
    let mut zip = zip::ZipArchive::new(std::fs::File::open(archive).unwrap()).unwrap();
    let mut backup = vec![];
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).unwrap();
        assert!(!entry.name().contains("gemini-jobs"));
        entry.read_to_end(&mut backup).unwrap();
    }
    let backup = String::from_utf8_lossy(&backup);
    for output in [&ipc, &debug, &logs, &export, backup.as_ref()] {
        for field in [
            "preparedFile",
            "allowedHost",
            "credentialFingerprint",
            "integrity",
            "expiresAt",
        ] {
            assert!(!output.contains(field), "leaked {field}");
        }
        for field in [
            "name",
            "uri",
            "allowedHost",
            "credentialFingerprint",
            "integrity",
        ] {
            assert!(
                !output.contains(descriptor[field].as_str().unwrap()),
                "leaked {field}"
            );
        }
    }
    let disk = std::fs::read_to_string(r.dir.path().join("gemini-jobs.json")).unwrap();
    assert!(!disk.contains("synthetic-only"));
    assert!(!disk.contains("upload_id="));
    assert!(!disk.contains("X-Goog-Upload"));
    assert!(!disk.contains("Bearer "));
}
#[test]
fn paused_reference_retained_until_expiry_or_discard() {
    for expire in [false, true] {
        let r = Rig::new(10);
        let (_, _) = paused_reference(&r);
        let cache = r.cache.lock().unwrap().clone();
        let retired = cache.invalidate_all();
        tauri::async_runtime::block_on(cache.retire(&r.http, "synthetic-only", retired));
        assert_eq!(r.fake.count(|q| q.is_delete()), 0);
        assert!(r.fake.exists("files/synthetic-1"));
        // Invalidate twice: retained ownership must not disappear with ready entries.
        if expire {
            r.clock.store(4_070_908_801, Ordering::SeqCst);
        }
        let retired = cache.invalidate_all();
        tauri::async_runtime::block_on(cache.retire(&r.http, "synthetic-only", retired));
        assert_eq!(r.fake.count(|q| q.is_delete()), usize::from(expire));
    }
}
#[test]
fn delete_only_owned_with_matching_key() {
    let r = Rig::new(10);
    let (id, _) = paused_reference(&r);
    let cache = r.cache.lock().unwrap().clone();
    let retired = cache.invalidate_all();
    tauri::async_runtime::block_on(cache.retire(&r.http, "synthetic-changed", retired));
    assert_eq!(r.fake.count(|q| q.is_delete()), 0);
    assert!(r.fake.exists("files/synthetic-1"));
    // Discard commits before the best-effort authenticated deletion.
    assert!(tauri::async_runtime::block_on(discard_at(
        r.dir.path(),
        &id,
        &cache,
        &r.http,
        &r.fake.base,
        Some("synthetic-only")
    ))
    .unwrap());
    assert_eq!(r.fake.count(|q| q.is_delete()), 1);
    let deletes: Vec<_> = r.fake.log().into_iter().filter(|q| q.is_delete()).collect();
    assert_eq!(deletes[0].path, "/v1beta/files/synthetic-1");
}
#[test]
fn crash_before_and_after_descriptor_commit() {
    for point in ["before-descriptor-commit", "after-descriptor-commit"] {
        let r = Rig::new(5);
        r.answer(1);
        let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            r.run_with(None, &r.request, &|at| {
                if at == point {
                    panic!("synthetic descriptor crash");
                }
            })
        }));
        assert!(crashed.is_err(), "hook {point} must run");
        assert_eq!(counts(&r), (1, 0, 0));
        let id = r.id();
        let disk: Value =
            serde_json::from_slice(&std::fs::read(r.dir.path().join("gemini-jobs.json")).unwrap())
                .unwrap();
        assert_eq!(
            disk["jobs"][0]["draft"].get("preparedFile").is_some(),
            point == "after-descriptor-commit"
        );
        r.reopen();
        assert_eq!(counts(&r), (1, 0, 0));
        r.run(Some(&id)).unwrap();
        assert_eq!(
            counts(&r),
            if point == "after-descriptor-commit" {
                (1, 1, 1)
            } else {
                (2, 0, 1)
            }
        );
    }
}

#[test]
fn descriptor_checkpoint_failure_no_section_request() {
    let r = Rig::new(5);
    r.answer(1);
    let error = r.run_with(None, &r.request, &|point| {
        if point == "before-descriptor-commit" {
            std::fs::create_dir(r.dir.path().join("gemini-jobs.json.writing")).unwrap();
        }
    });
    assert!(error.is_err());
    assert_eq!(counts(&r), (1, 0, 0));
    std::fs::remove_dir(r.dir.path().join("gemini-jobs.json.writing")).unwrap();
    r.reopen();
    let disk: Value =
        serde_json::from_slice(&std::fs::read(r.dir.path().join("gemini-jobs.json")).unwrap())
            .unwrap();
    assert!(disk["jobs"][0]["draft"].get("preparedFile").is_none());
    assert_eq!(counts(&r), (1, 0, 0));
}
#[test]
fn shared_reference_retains_other_draft_on_discard() {
    let r = Rig::new(10);
    let (first, _) = paused_reference(&r);
    let mut req = r.request.clone();
    req.material_id = "mat-b".into();
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    assert!(r.run_with(None, &req, &|_| {}).is_err());
    let second = gemini_jobs::with(r.dir.path(), |j| {
        j.list()
            .into_iter()
            .find(|j| j.material_id == "mat-b")
            .unwrap()
            .id
    });
    let cache = r.cache.lock().unwrap().clone();
    assert!(tauri::async_runtime::block_on(discard_at(
        r.dir.path(),
        &first,
        &cache,
        &r.http,
        &r.fake.base,
        Some("synthetic-only")
    ))
    .unwrap());
    assert_eq!(r.fake.count(|q| q.is_delete()), 0);
    assert!(tauri::async_runtime::block_on(discard_at(
        r.dir.path(),
        &second,
        &cache,
        &r.http,
        &r.fake.base,
        Some("synthetic-only")
    ))
    .unwrap());
    assert_eq!(r.fake.count(|q| q.is_delete()), 1);
}
#[test]
fn discard_reference_wrong_key_or_tampering_never_deletes() {
    for tamper in [false, true] {
        let r = Rig::new(10);
        let (id, _) = paused_reference(&r);
        if tamper {
            edit_descriptor(&r, |d| {
                d["name"] = json!("files/foreign");
                d["uri"] = json!(format!("{}/v1beta/files/foreign", r.fake.base));
            });
        }
        r.reopen();
        let cache = r.cache.lock().unwrap().clone();
        assert!(tauri::async_runtime::block_on(discard_at(
            r.dir.path(),
            &id,
            &cache,
            &r.http,
            &r.fake.base,
            Some(if tamper {
                "synthetic-only"
            } else {
                "synthetic-changed"
            })
        ))
        .unwrap());
        assert_eq!(r.fake.count(|q| q.is_delete()), 0);
        assert!(r.fake.exists("files/synthetic-1"));
    }
}
#[test]
fn nonactive_reference_pauses_without_replacement() {
    for state in ["PROCESSING", "FAILED", "UNKNOWN"] {
        let r = Rig::new(10);
        let (id, _) = paused_reference(&r);
        r.fake.set_state("files/synthetic-1", state);
        r.reopen();
        assert_eq!(
            r.run(Some(&id)).unwrap_err().code,
            "REFERENCE_LOOKUP_FAILED"
        );
        assert_eq!(counts(&r), (1, 1, 2));
    }
}

#[test]
fn descriptor_public_fingerprint_cannot_forge_ownership() {
    use sha2::{Digest, Sha256};
    let r = Rig::new(10);
    let (id, _) = paused_reference(&r);
    edit_descriptor(&r, |d| {
        d["name"] = json!("files/foreign");
        d["uri"] = json!(format!("{}/v1beta/files/foreign", r.fake.base));
        // Attack using only persisted public metadata. The authentication key
        // must be derived separately from the fingerprint stored in the file.
        let public_hash = hex::decode(d["credentialFingerprint"].as_str().unwrap()).unwrap();
        let mut ip = [0x36u8; 64];
        let mut op = [0x5cu8; 64];
        for (i, b) in public_hash.iter().enumerate() {
            ip[i] ^= b;
            op[i] ^= b;
        }
        let mut inner = Sha256::new();
        inner.update(ip);
        inner.update(b"hfd-native-prepared-file-v1\0");
        inner.update(
            serde_json::to_vec(&json!([
                d["name"],
                d["uri"],
                d["allowedHost"],
                d["mime"],
                d["expiresAt"],
                d["selectedSha256"],
                d["credentialFingerprint"]
            ]))
            .unwrap(),
        );
        let mut outer = Sha256::new();
        outer.update(op);
        outer.update(inner.finalize());
        d["integrity"] = json!(hex::encode(outer.finalize()));
    });
    r.reopen();
    assert_eq!(r.run(Some(&id)).unwrap_err().code, "DESCRIPTOR_INVALID");
    assert_eq!(counts(&r), (1, 0, 2));
    let cache = r.cache.lock().unwrap().clone();
    assert!(tauri::async_runtime::block_on(discard_at(
        r.dir.path(),
        &id,
        &cache,
        &r.http,
        &r.fake.base,
        Some("synthetic-only")
    ))
    .unwrap());
    assert_eq!(r.fake.count(|q| q.is_delete()), 0);
}
