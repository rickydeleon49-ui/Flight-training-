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
    choice: ModelChoice,
    stage_scale: f64,
    started_ids: std::sync::Mutex<Vec<String>>,
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
            choice: ModelChoice::Standard,
            stage_scale: 1.0,
            started_ids: std::sync::Mutex::new(vec![]),
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
        budget.scale_stages(self.stage_scale);
        let cache = self.cache.lock().unwrap().clone();
        let ctx = GenContext {
            provider: crate::provider::AnyProvider::default(),
            http: &self.http,
            base: &self.fake.base,
            api_key: key,
            choice: self.choice,
            cache: &cache,
            epoch: cache.epoch(),
            budget: &budget,
            say: &|m| self.messages.lock().unwrap().push(m),
        };
        tauri::async_runtime::block_on(activate(&ctx, self.dir.path(), req, id, hook, &|id| {
            self.started_ids.lock().unwrap().push(id.to_string())
        }))
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
        [(1, 5), (6, 10), (11, 16)]
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
    // A long selection is never refused for having too many sections: it
    // merges to the limit instead.
    let merged = plan(&(1..=201).collect::<Vec<_>>(), &[]).unwrap();
    assert_eq!(merged.len(), MAX_SECTIONS);
    assert_eq!(merged[0].heading, "Pages 1–5");
    assert_eq!(
        merged
            .iter()
            .flat_map(|s| s.page_start..=s.page_end)
            .count(),
        201
    );
    let over = plan(&(1..=205).collect::<Vec<_>>(), &[]).unwrap();
    assert_eq!(over.len(), MAX_SECTIONS);
    assert_eq!(over[0].heading, "Pages 1–10");
    // Only a selection that cannot merge below the limit — more separate runs
    // than the guide can hold — is still refused.
    assert_eq!(
        plan(&(0..41u32).map(|n| n * 2 + 1).collect::<Vec<_>>(), &[])
            .unwrap_err()
            .code,
        "TOO_MANY_SECTIONS"
    );
    assert_eq!(
        plan(&(0..40u32).map(|n| n * 2 + 1).collect::<Vec<_>>(), &[])
            .unwrap()
            .len(),
        40
    );
    let s = &p[0];
    assert!(validate_section(
        s,
        &json!({"body":"x".repeat(crate::study_sets::MAX_BODY),"sourcePages":[1]}).to_string(),
        &(1..=16).collect::<Vec<_>>(),
        "model"
    )
    .is_ok());
    assert!(validate_section(
        s,
        &json!({"body":"x".repeat(crate::study_sets::MAX_BODY + 1),"sourcePages":[1]}).to_string(),
        &(1..=16).collect::<Vec<_>>(),
        "model"
    )
    .is_err());
    // A dense section that runs past the requested 12,000 characters (as a
    // 6-page fuel-system section did on the real Powerplant handbook) is kept.
    assert!(validate_section(
        s,
        &json!({"body":"x".repeat(17_500),"sourcePages":[1]}).to_string(),
        &(1..=16).collect::<Vec<_>>(),
        "model"
    )
    .is_ok());
}

#[test]
fn a_heading_on_every_page_merges_into_at_most_40_sections() {
    // The shape of "amt_powerplant_handbook — Part 1 of 4": a bookmark on
    // nearly every page must still plan, never refuse.
    let pages: Vec<u32> = (1..=102).collect();
    let hints: Vec<(u32, u32, String)> = pages
        .iter()
        .map(|page| (*page, *page, format!("Heading {page}")))
        .collect();
    let manifest = plan(&pages, &hints).unwrap();
    assert!(
        manifest.len() <= MAX_SECTIONS,
        "{} sections",
        manifest.len()
    );
    assert_eq!(
        manifest
            .iter()
            .flat_map(|s| s.page_start..=s.page_end)
            .collect::<Vec<_>>(),
        pages,
        "every chosen page once and in source order"
    );
    assert!(manifest
        .windows(2)
        .all(|pair| pair[0].page_end + 1 == pair[1].page_start));
    assert_eq!(
        manifest.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
        (1..=manifest.len())
            .map(|n| format!("section-{n:02}"))
            .collect::<Vec<_>>()
    );
    // A merged group keeps the first heading of the group, plainly.
    assert_eq!(manifest[0].heading, "Heading 1 (and 4 more)");
    assert_eq!((manifest[0].page_start, manifest[0].page_end), (1, 5));
    assert_eq!(manifest.len(), 20);
    assert_eq!(manifest[19].heading, "Heading 96 (and 6 more)");
    assert_eq!((manifest[19].page_start, manifest[19].page_end), (96, 102));
    assert!(manifest
        .iter()
        .all(|s| s.heading.starts_with(&format!("Heading {}", s.page_start))));
}

#[test]
fn validate_section_tolerant_source_pages() {
    let section = Section {
        id: "section-02".into(),
        heading: "Pages 11–20".into(),
        page_start: 11,
        page_end: 20,
    };
    let chosen: Vec<u32> = (1..=102).collect();
    // [12, 3, 12, 15, 99] for a section of pages 11-20 is accepted with [12, 15]
    let accepted = validate_section(
        &section,
        &json!({
            "body": "Valid section body text.",
            "sourcePages": [12, 3, 12, 15, 99]
        })
        .to_string(),
        &chosen,
        "model",
    )
    .unwrap();
    assert_eq!(accepted.source_pages, vec![12, 15]);

    // An answer whose pages are all outside the section is rejected
    let err = validate_section(
        &section,
        &json!({
            "body": "Valid section body text.",
            "sourcePages": [1, 2, 3, 99, 100]
        })
        .to_string(),
        &chosen,
        "model",
    )
    .unwrap_err();
    assert_eq!(
        err.message,
        "The section answer or its source pages were invalid; earlier sections are kept."
    );
}

#[test]
fn heading_every_two_pages_plans_into_at_most_21_sensible_sections() {
    // A 102-page selection with a heading every 2 pages plans into at most 21
    // sections, each at most 10 pages, covering every page once in order.
    let pages: Vec<u32> = (1..=102).collect();
    let hints: Vec<(u32, u32, String)> = (0..51)
        .map(|i| (i * 2 + 1, i * 2 + 2, format!("Heading {}", i * 2 + 1)))
        .collect();
    let manifest = plan(&pages, &hints).unwrap();
    assert!(
        manifest.len() <= 21,
        "expected at most 21 sections, got {}",
        manifest.len()
    );
    assert!(
        manifest.iter().all(|s| s.page_end - s.page_start < 10),
        "each section at most 10 pages"
    );
    assert_eq!(
        manifest
            .iter()
            .flat_map(|s| s.page_start..=s.page_end)
            .collect::<Vec<_>>(),
        pages,
        "covering every page once in order"
    );
    assert!(manifest
        .windows(2)
        .all(|pair| pair[0].page_end + 1 == pair[1].page_start));
}

/// A synthetic PDF whose outline puts a chapter title at the outer level and a
/// sub-heading on every page of that chapter, as a large FAA handbook does.
fn outlined_pdf(pages: u32, chapters: u32) -> Vec<u8> {
    use lopdf::{dictionary, Document, Object};
    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let outlines = document.new_object_id();
    let page_ids: Vec<(u32, u16)> = (0..pages)
        .map(|_| {
            document.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            })
        })
        .collect();
    let fit = Object::Name(b"Fit".to_vec());
    let dest = |page: u32| {
        Object::Array(vec![
            Object::Reference(page_ids[usize::try_from(page - 1).unwrap()]),
            fit.clone(),
        ])
    };
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => i64::from(pages),
            "Kids" => page_ids.iter().map(|id| Object::Reference(*id)).collect::<Vec<Object>>(),
        }),
    );
    let catalog = document.add_object(dictionary! {
        "Type" => "Catalog", "Pages" => pages_id, "Outlines" => outlines
    });
    document.trailer.set("Root", catalog);
    let step = (pages / chapters).max(1);
    let chapter_ids: Vec<(u32, u16)> = (0..chapters).map(|_| document.new_object_id()).collect();
    for (index, chapter) in (0..chapters).enumerate() {
        let start = 1 + chapter * step;
        let end = if chapter + 1 == chapters {
            pages
        } else {
            start + step - 1
        };
        let span: Vec<u32> = (start..=end).collect();
        let sub_ids: Vec<(u32, u16)> = span.iter().map(|_| document.new_object_id()).collect();
        for (offset, page) in span.iter().enumerate() {
            let mut entry = dictionary! {
                "Title" => Object::string_literal(format!("Sub {page}")),
                "Dest" => dest(*page),
            };
            if offset + 1 < sub_ids.len() {
                entry.set("Next", sub_ids[offset + 1]);
            }
            document.objects.insert(sub_ids[offset], entry.into());
        }
        let mut entry = dictionary! {
            "Title" => Object::string_literal(format!("Chapter {}", chapter + 1)),
            "Dest" => dest(start),
            "First" => sub_ids[0],
            "Last" => sub_ids[sub_ids.len() - 1],
        };
        if index + 1 < chapter_ids.len() {
            entry.set("Next", chapter_ids[index + 1]);
        }
        document.objects.insert(chapter_ids[index], entry.into());
    }
    document.objects.insert(
        outlines,
        dictionary! {
            "Type" => "Outlines",
            "First" => chapter_ids[0],
            "Last" => *chapter_ids.last().unwrap(),
            "Count" => i64::from(chapters),
        }
        .into(),
    );
    let mut out = Vec::new();
    document.save_to(&mut out).unwrap();
    out
}

#[test]
fn a_deep_outline_plans_from_chapter_headings_only() {
    let r = Rig::new(102);
    std::fs::write(r.dir.path().join("documents/a.pdf"), outlined_pdf(102, 5)).unwrap();
    let (identity, _) = source(r.dir.path(), &r.request, "gemini-2.5-flash").unwrap();
    assert!(identity.manifest.len() <= MAX_SECTIONS);
    // Five chapters over 102 pages give ten-page sections; the 102 sub-headings
    // never become boundaries, because they would not fit the guide.
    assert_eq!(
        identity
            .manifest
            .iter()
            .map(|s| s.heading.as_str())
            .collect::<Vec<_>>(),
        [
            "Chapter 1",
            "Chapter 1",
            "Chapter 2",
            "Chapter 2",
            "Chapter 3",
            "Chapter 3",
            "Chapter 4",
            "Chapter 4",
            "Chapter 5",
            "Chapter 5",
            "Chapter 5",
        ]
    );
    // A small enough outline still keeps its next level.
    let small = Rig::new(10);
    std::fs::write(
        small.dir.path().join("documents/a.pdf"),
        outlined_pdf(10, 3),
    )
    .unwrap();
    let (small_plan, _) = source(small.dir.path(), &small.request, "gemini-2.5-flash").unwrap();
    assert_eq!(
        small_plan
            .manifest
            .iter()
            .map(|s| s.heading.as_str())
            .collect::<Vec<_>>(),
        ["Chapter 1 (and 4 more)", "Sub 6 (and 4 more)",]
    );
}

#[test]
fn an_unchanged_plan_keeps_its_sections() {
    // The merge must not shift a plan that already fits the limit.
    assert_eq!(
        plan(&(1..=16).collect::<Vec<_>>(), &[])
            .unwrap()
            .iter()
            .map(|s| (s.page_start, s.page_end, s.heading.clone()))
            .collect::<Vec<_>>(),
        [
            (1, 5, "Pages 1–5".to_string()),
            (6, 10, "Pages 6–10".to_string()),
            (11, 16, "Pages 11–16".to_string()),
        ]
    );
    assert_eq!(
        plan(
            &(1..=24).collect::<Vec<_>>(),
            &[(1, 24, "Chapter".to_string())]
        )
        .unwrap()
        .iter()
        .map(|s| (s.id.clone(), s.page_start, s.page_end))
        .collect::<Vec<_>>(),
        [
            ("section-01".to_string(), 1, 10),
            ("section-02".to_string(), 11, 20),
            ("section-03".to_string(), 21, 24),
        ]
    );
    // 200 pages with no bookmarks still plan as forty five-page sections.
    assert_eq!(
        plan(&(1..=200).collect::<Vec<_>>(), &[])
            .unwrap()
            .iter()
            .map(|s| (s.page_start, s.page_end))
            .collect::<Vec<_>>(),
        (0..40u32)
            .map(|n| (n * 5 + 1, n * 5 + 5))
            .collect::<Vec<_>>()
    );
}

#[test]
fn merging_never_mixes_two_chosen_runs() {
    let mut pages: Vec<u32> = (1..=60).collect();
    pages.extend(62..=102);
    let hints: Vec<(u32, u32, String)> = pages
        .iter()
        .map(|page| (*page, *page, format!("Heading {page}")))
        .collect();
    let manifest = plan(&pages, &hints).unwrap();
    assert!(
        manifest.len() <= MAX_SECTIONS,
        "{} sections",
        manifest.len()
    );
    assert_eq!(
        manifest
            .iter()
            .flat_map(|s| s.page_start..=s.page_end)
            .collect::<Vec<_>>(),
        pages
    );
    assert!(
        manifest
            .iter()
            .all(|s| s.page_start > 61 || s.page_end < 61),
        "page 61 was not chosen, so no section may cover it"
    );
    assert!(manifest
        .windows(2)
        .any(|pair| pair[0].page_end + 2 == pair[1].page_start));
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
    // Section 4's bad answer gets its one intended answer-shape retry.
    assert_eq!(before.len(), 5);
    r.reopen();
    assert_eq!(r.requests().len(), 5, "reopen sends nothing");
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Body 4", 16)));
    let result = r.run(Some(&id)).unwrap();
    assert_eq!(result.answer.sections.len(), 4);
    let after = r.requests();
    assert_eq!(after.len(), 6);
    assert_eq!(
        after[5], after[3],
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
        let prompt=format!("guide-section-prompt-v1: Write only section section-{:02} (Pages {first}–{last}) from the attached PDF. Read ONLY these selected PDF pages and cite their original sourcePage numbers: {}. Do not discuss other pages. Use only supported facts; do not invent procedures or regulations. Return JSON with body (nonempty Markdown, at most 12000 characters) and sourcePages (ordered unique original source page numbers actually used). This is a Gemini study aid to check against current FAA material and her instructor.",i+1,json!(pages));
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
    // 2 first-run sends + the one shape retry of "bad" + 1 after renewal.
    assert_eq!(r.requests().len(), 4);
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
fn updated_app_plan_version_returns_plan_changed() {
    let r = Rig::new(10);
    r.fake.behave(|b| b.generate_answer = Some("bad".into()));
    assert!(r.run(None).is_err());
    let id = r.id();

    // Mutate planner_version on disk while keeping PDF hash and chosen pages identical
    gemini_jobs::forget(r.dir.path());
    let path = r.dir.path().join("gemini-jobs.json");
    let mut disk: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    disk["jobs"][0]["draft"]["identity"]["plannerVersion"] =
        Value::String("pdf-outline-earlier-version".into());
    std::fs::write(path, serde_json::to_vec(&disk).unwrap()).unwrap();

    let err = r.run(Some(&id)).unwrap_err();
    assert_eq!(err.code, "PLAN_CHANGED");
    assert_eq!(
        err.message,
        "Her Flight Deck was updated since this guide started. Keep your earlier sections, or start a new guide?"
    );

    // If PDF hash changes as well, it returns SOURCE_CHANGED
    std::fs::write(
        r.dir.path().join("documents/a.pdf"),
        generation_tests::pdf(10, "changed"),
    )
    .unwrap();
    let source_err = r.run(Some(&id)).unwrap_err();
    assert_eq!(source_err.code, "SOURCE_CHANGED");
}

#[test]
fn section_guide_time_limit_pauses_and_keeps_finished_sections_wording() {
    let r = Rig::new(10);
    let budget = Budget::new(Duration::ZERO);
    let cache = r.cache.lock().unwrap().clone();
    let ctx = GenContext {
        provider: crate::provider::AnyProvider::default(),
        http: &r.http,
        base: &r.fake.base,
        api_key: "synthetic-only",
        choice: ModelChoice::Standard,
        cache: &cache,
        epoch: cache.epoch(),
        budget: &budget,
        say: &|m| r.messages.lock().unwrap().push(m),
    };
    let err = tauri::async_runtime::block_on(activate(
        &ctx,
        r.dir.path(),
        &r.request,
        None,
        &|_| {},
        &|_| {},
    ))
    .unwrap_err();
    assert_eq!(err.code, "GUIDE_PAUSED");
    assert_eq!(
        err.message,
        "This took longer than 15 minutes, so Her Flight Deck paused. Your finished sections are kept — Try again to continue."
    );
    assert!(!err.message.contains("Nothing was saved"));

    let journal = gemini_jobs::Journal::open(r.dir.path());
    let job = journal.list().into_iter().next().unwrap();
    assert_eq!(job.stage, JobStage::Failed);
    assert_eq!(
        job.error.as_deref(),
        Some("This took longer than 15 minutes, so Her Flight Deck paused. Your finished sections are kept — Try again to continue.")
    );
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
    // The bad answer's one shape retry; restart itself sends nothing.
    assert_eq!(r.requests().len(), 2);
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
    // bodies[2] is the first run's one shape retry of the bad answer.
    assert_eq!(bodies.len(), 4);
    assert_eq!(bodies[1], bodies[3]);
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 1);
    assert_eq!(r.fake.count(|q| q.is_lookup()), 1);
    let prompt = bodies[3]["contents"][0]["parts"][0]["text"]
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
    let too_many = Rig::new(84);
    let mut scattered = too_many.request.clone();
    scattered.chosen_pages = (0..41u32).map(|n| n * 2 + 1).collect();
    // Only more separate runs than the guide can hold is still refused.
    assert_eq!(
        too_many
            .run_with(None, &scattered, &|_| {})
            .unwrap_err()
            .code,
        "TOO_MANY_SECTIONS"
    );
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

// Section 2's "bad" answer gets its one intended answer-shape retry, so the
// paused fixture has sent three generate requests (counts' third value).
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
    assert_eq!(counts(&r), (1, 0, 3));
    r.reopen();
    assert_eq!(counts(&r), (1, 0, 3));
    r.fake
        .behave(|b| b.generate_answer = Some(reply("Second", 6)));
    r.run(Some(&id)).unwrap();
    assert_eq!(counts(&r), (1, 1, 4));
    assert_eq!(r.requests()[3], first[1]);
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
        assert_eq!(counts(&r), (2, usize::from(missing), 4));
        let mut expected = first[1].clone();
        expected["contents"][0]["parts"][1]["file_data"]["file_uri"] =
            json!(format!("{}/v1beta/files/synthetic-2", r.fake.base));
        assert_eq!(r.requests()[3], expected);
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
        assert_eq!(counts(&r), (1, 1, 3));
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
        assert_eq!(counts(&r), (1, 1, 3));
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
        assert_eq!(counts(&r), (1, 0, 3), "{field}");
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
    assert_eq!(counts(&r), (1, 0, 3));
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
        assert_eq!(counts(&r), (1, 1, 3));
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
    assert_eq!(counts(&r), (1, 0, 3));
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

#[test]
fn queue_creates_waiting_draft_with_zero_network() {
    let r = Rig::new(10);
    let job_id = queue_study_guide_at(r.dir.path(), &r.request, ModelChoice::Standard).unwrap();
    assert_eq!(r.fake.count(|r| r.is_generate()), 0);
    assert_eq!(r.fake.count(|r| r.is_upload_finalize()), 0);
    assert_eq!(r.fake.count(|r| r.is_lookup()), 0);
    assert_eq!(r.fake.log().len(), 0);
    let d = read_draft(r.dir.path(), &job_id).unwrap();
    assert_eq!(d.queue_state, Some(QueueState::WaitingForHer));
    assert_eq!(d.identity.manifest.len(), 2);
    assert!(d.results.values().all(|res| res.status == Status::Pending));
}

#[test]
fn queue_reopen_no_network() {
    let r = Rig::new(10);
    let job_id = queue_study_guide_at(r.dir.path(), &r.request, ModelChoice::Standard).unwrap();
    assert_eq!(r.fake.log().len(), 0);
    r.reopen();
    assert_eq!(r.fake.count(|r| r.is_generate()), 0);
    assert_eq!(r.fake.count(|r| r.is_upload_finalize()), 0);
    assert_eq!(r.fake.count(|r| r.is_lookup()), 0);
    assert_eq!(r.fake.log().len(), 0);
    let d = read_draft(r.dir.path(), &job_id).unwrap();
    assert_eq!(d.queue_state, Some(QueueState::WaitingForHer));
}

#[test]
fn running_and_paused_queue_items_wait_for_her_after_reopen() {
    let r = Rig::new(10);
    let mut queued = Vec::new();
    for state in ["running", "paused", "cancelled"] {
        let mut req = r.request.clone();
        req.material_id = format!("mat-{state}");
        let id = queue_study_guide_at(r.dir.path(), &req, ModelChoice::Standard).unwrap();
        queued.push((id, state));
    }
    let path = r.dir.path().join("gemini-jobs.json");
    let mut persisted: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for (id, state) in &queued {
        let job = persisted["jobs"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|j| j["id"].as_str() == Some(id.as_str()))
            .unwrap();
        job["draft"]["queueState"] = json!(state);
    }
    std::fs::write(&path, serde_json::to_vec(&persisted).unwrap()).unwrap();
    assert!(r.fake.log().is_empty());

    r.reopen();
    let journal = gemini_jobs::Journal::open(r.dir.path());
    let jobs = journal.list();
    for (id, state) in &queued {
        let draft = jobs
            .iter()
            .find(|j| j.id == *id)
            .unwrap()
            .draft
            .as_ref()
            .unwrap();
        if *state == "cancelled" {
            let original = persisted["jobs"]
                .as_array()
                .unwrap()
                .iter()
                .find(|j| j["id"].as_str() == Some(id.as_str()))
                .unwrap();
            assert_eq!(draft, &original["draft"], "cancelled draft is unchanged");
        } else {
            assert_eq!(draft["queueState"], "waiting-for-her", "was {state}");
        }
    }
    assert!(
        r.fake.log().is_empty(),
        "reopen sends zero network requests"
    );
}

#[test]
fn start_now_resumes_through_existing_rules() {
    let r = Rig::new(10);
    let job_id = queue_study_guide_at(r.dir.path(), &r.request, ModelChoice::Standard).unwrap();
    assert_eq!(r.fake.log().len(), 0);
    r.fake.behave(|b| {
        b.generate_answers = vec![reply("First", 1), reply("Second", 6)];
    });
    let outcome = r.run(Some(&job_id)).unwrap();
    assert_eq!(outcome.job_id.as_deref(), Some(job_id.as_str()));
    assert_eq!(r.fake.count(|r| r.is_upload_finalize()), 1);
    assert_eq!(r.requests().len(), 2);
    let d = read_draft(r.dir.path(), &job_id).unwrap();
    assert_eq!(d.results["section-01"].status, Status::Complete);
    assert_eq!(d.results["section-02"].status, Status::Complete);
}

#[test]
fn unrequested_material_never_uploads() {
    let r = Rig::new(10);
    let _job_id = queue_study_guide_at(r.dir.path(), &r.request, ModelChoice::Standard).unwrap();
    std::fs::write(
        r.dir.path().join("documents/b.pdf"),
        generation_tests::pdf(5, "other"),
    )
    .unwrap();
    let other_req = SectionRequest {
        material_id: "mat-b".into(),
        relative_path: "b.pdf".into(),
        chosen_pages: vec![1, 2, 3, 4, 5],
        base_revision: None,
        request_id: None,
    };
    let (other_id, _) = source(r.dir.path(), &other_req, "gemini-2.5-flash").unwrap();
    assert_eq!(other_id.material_id, "mat-b");
    r.reopen();
    assert_eq!(r.fake.count(|r| r.is_upload_finalize()), 0);
    assert_eq!(r.fake.count(|r| r.is_generate()), 0);
    assert_eq!(r.fake.count(|r| r.is_lookup()), 0);
}

#[test]
fn queue_overflow_refused_without_eviction() {
    let r = Rig::new(5);
    let mut queued_ids = Vec::new();
    for i in 1..=8 {
        let pdf_name = format!("mat-{i}.pdf");
        std::fs::write(
            r.dir.path().join("documents").join(&pdf_name),
            generation_tests::pdf(5, &format!("doc-{i}")),
        )
        .unwrap();
        let req = SectionRequest {
            material_id: format!("mat-{i}"),
            relative_path: pdf_name,
            chosen_pages: vec![1, 2, 3, 4, 5],
            base_revision: None,
            request_id: None,
        };
        let id = queue_study_guide_at(r.dir.path(), &req, ModelChoice::Standard).unwrap();
        queued_ids.push(id);
    }
    assert_eq!(gemini_jobs::with(r.dir.path(), |j| j.list().len()), 8);
    let pdf_9 = "mat-9.pdf";
    std::fs::write(
        r.dir.path().join("documents").join(pdf_9),
        generation_tests::pdf(5, "doc-9"),
    )
    .unwrap();
    let req_9 = SectionRequest {
        material_id: "mat-9".into(),
        relative_path: pdf_9.into(),
        chosen_pages: vec![1, 2, 3, 4, 5],
        base_revision: None,
        request_id: None,
    };
    let err = queue_study_guide_at(r.dir.path(), &req_9, ModelChoice::Standard).unwrap_err();
    assert_eq!(err.message, gemini_jobs::FULL);
    let current_ids: Vec<String> = gemini_jobs::with(r.dir.path(), |j| {
        j.list().into_iter().map(|job| job.id).collect()
    });
    assert_eq!(current_ids, queued_ids);
}

#[test]
fn cancel_waiting_item_removes_it_without_network() {
    let r = Rig::new(10);
    let job_id = queue_study_guide_at(r.dir.path(), &r.request, ModelChoice::Standard).unwrap();
    assert_eq!(gemini_jobs::with(r.dir.path(), |j| j.list().len()), 1);
    let outcome = cancel_job(r.dir.path(), &job_id, &|_| {}).unwrap();
    assert!(outcome.cancelled);
    assert_eq!(gemini_jobs::with(r.dir.path(), |j| j.list().len()), 0);
    assert_eq!(r.fake.count(|r| r.is_generate()), 0);
    assert_eq!(r.fake.count(|r| r.is_upload_finalize()), 0);
    assert_eq!(r.fake.count(|r| r.is_lookup()), 0);
    assert_eq!(r.fake.log().len(), 0);
}

#[test]
fn cancelled_queue_item_stays_cancelled_after_reopen() {
    let r = Rig::new(10);
    r.answer(2);
    let job_id = queue_study_guide_at(r.dir.path(), &r.request, ModelChoice::Standard).unwrap();
    let root = r.dir.path().to_path_buf();
    let id_for_cancel = job_id.clone();
    let outcome = r.run_with(Some(&job_id), &r.request, &move |at| {
        if at == "before-reservation" {
            let _ = cancel_job(&root, &id_for_cancel, &|_| {});
        }
    });
    assert!(outcome.is_err());
    let requests_before = r.fake.log().len();

    r.reopen();
    let journal = gemini_jobs::Journal::open(r.dir.path());
    let job = journal.list().into_iter().find(|j| j.id == job_id).unwrap();
    assert_eq!(job.stage, JobStage::Cancelled);
    let d = read_draft(r.dir.path(), &job_id).unwrap();
    assert_eq!(d.queue_state, Some(QueueState::Cancelled));
    assert_eq!(r.fake.log().len(), requests_before);
}

#[test]
fn validate_section_unescapes_newlines_before_digest_and_storage() {
    let section = Section {
        id: "section-01".into(),
        heading: "Pages 1–5".into(),
        page_start: 1,
        page_end: 5,
    };
    for (raw, expected) in [
        (
            "## Heading\\n\\n- One\\n- Two",
            "## Heading\n\n- One\n- Two",
        ),
        (
            "## Heading\\r\\n\\r\\n- One\\r\\n- Two",
            "## Heading\n\n- One\n- Two",
        ),
        (
            "## Heading\nLiteral \\n stays.",
            "## Heading\nLiteral \\n stays.",
        ),
    ] {
        let result = validate_section(
            &section,
            &json!({"body": raw, "sourcePages": [1]}).to_string(),
            &[1, 2, 3, 4, 5],
            "model",
        )
        .unwrap();
        assert_eq!(result.body, expected);
        assert_eq!(result.content_digest, digest(&result));
    }
    assert!(validate_section(
        &section,
        &json!({"body": "\\n\\n", "sourcePages": [1]}).to_string(),
        &[1],
        "model"
    )
    .is_err());
}

#[test]
fn capable_model_max_tokens_answer_falls_back_to_standard_once() {
    let mut r = Rig::new(4);
    r.choice = ModelChoice::MostCapable;
    r.fake.behave(|b| {
        b.generate_answers = vec![
            json!({"candidates":[{"finishReason":"MAX_TOKENS"}]}).to_string(),
            reply("Synthetic section.", 1),
        ]
    });
    let answer = r.run(None).unwrap();
    assert_eq!(answer.answer.model, "gemini-3.5-flash");
    let log = r.fake.log();
    let requests: Vec<_> = log.iter().filter(|r| r.is_generate()).collect();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].path.contains("gemini-3.8-flash"));
    assert!(requests[1].path.contains("gemini-3.5-flash"));
    assert!(r
        .messages
        .lock()
        .unwrap()
        .iter()
        .any(|m| m == r.choice.fallback_notice()));
    let d = read_draft(r.dir.path(), &r.id()).unwrap();
    assert_eq!(
        d.results["section-01"].content.as_ref().unwrap().model,
        "gemini-3.5-flash"
    );
}
#[test]
fn capable_model_403_falls_back_without_consuming_extra_reservations() {
    let mut r = Rig::new(4);
    r.choice = ModelChoice::MostCapable;
    r.fake.behave(|b| {
        b.generate_statuses = vec![(403, "{}".into())];
        b.generate_answers = vec![reply("Synthetic section.", 1)];
    });
    r.run(None).unwrap();
    assert_eq!(r.requests().len(), 2);
    assert_eq!(
        read_draft(r.dir.path(), &r.id()).unwrap().activations[0].submissions,
        2
    );
}
#[test]
fn invalid_section_answer_is_reported_with_its_reason() {
    let r = Rig::new(4);
    r.fake
        .behave(|b| b.generate_answers = vec![reply("Synthetic section.", 0); 3]);
    let error = r.run(None).unwrap_err();
    assert_eq!(error.code, "GUIDE_FAILED");
    assert_eq!(
        error.message,
        "The section answer or its source pages were invalid; earlier sections are kept."
    );
    assert_eq!(
        r.requests().len(),
        2,
        "an answer-shape failure retries only once"
    );
    assert_eq!(
        gemini_jobs::with(r.dir.path(), |j| j.list()[0].error.clone()).as_deref(),
        Some(error.message.as_str())
    );
}
#[test]
fn section_progress_names_each_section() {
    let r = Rig::new(10);
    r.answer(2);
    r.run(None).unwrap();
    let messages = r.messages.lock().unwrap();
    assert_eq!(*r.started_ids.lock().unwrap(), vec![r.id()]);
    assert!(messages
        .iter()
        .any(|m| m.starts_with("Writing section 1 of 2:")));
    assert!(messages.iter().any(|m| m == "Section 1 of 2 saved."));
    assert!(messages.iter().any(|m| m == "Section 2 of 2 saved."));
}

#[test]
fn internal_section_failure_text_is_not_marked_as_a_plain_reason() {
    let error = SectionError::from(
        "Could not keep track of this study aid: Permission denied (os error 13)".to_string(),
    );
    assert_eq!(error.code, "GUIDE_PAUSED");
}

#[test]
fn capable_fallback_stays_for_the_rest_of_the_guide() {
    // 15 pages plan three sections (14 merge into two).
    let mut r = Rig::new(15);
    r.choice = ModelChoice::MostCapable;
    r.fake.behave(|b| {
        b.generate_answers = vec![
            json!({"candidates":[{"finishReason":"MAX_TOKENS"}]}).to_string(),
            reply("First", 1),
            reply("Second", 6),
            reply("Third", 11),
        ]
    });
    let answer = r.run(None).unwrap();
    assert_eq!(answer.answer.sections.len(), 3);
    assert_eq!(answer.answer.model, "gemini-3.5-flash");
    let log = r.fake.log();
    let paths: Vec<_> = log
        .iter()
        .filter(|q| q.is_generate())
        .map(|q| q.path.clone())
        .collect();
    assert_eq!(paths.len(), 4);
    assert_eq!(
        paths
            .iter()
            .filter(|p| p.contains("gemini-3.8-flash"))
            .count(),
        1
    );
}

#[test]
fn native_section_failure_preserves_plain_reason_on_wire() {
    let reason = "Gemini's answer reached its output limit. Try again.";
    let error = SectionError::native(reason);
    let wire = serde_json::to_value(&error).unwrap();
    assert_eq!(wire["code"], "GUIDE_FAILED");
    assert_eq!(wire["message"], reason);
}

#[test]
fn section_first_header_timeout_stops_without_another_submission() {
    let mut r = Rig::new(4);
    r.stage_scale = 0.01;
    r.fake
        .behave(|b| b.generate_first_byte_delay = Some(Duration::from_secs(3)));
    let started = std::time::Instant::now();
    let error = r.run(None).unwrap_err();
    assert_eq!(error.code, "GUIDE_FAILED");
    assert_eq!(
        error.message,
        "Gemini is taking longer to answer. You can try again."
    );
    assert_eq!(
        r.requests().len(),
        1,
        "a section timeout must not start another long wait"
    );
    assert!(started.elapsed() >= Duration::from_millis(2400));
}
#[test]
fn capable_invalid_fallback_answer_does_not_retry_a_third_time() {
    let mut r = Rig::new(4);
    r.choice = ModelChoice::MostCapable;
    r.fake.behave(|b| {
        b.generate_answers =
            vec![json!({"candidates":[{"finishReason":"MAX_TOKENS"}]}).to_string(); 3]
    });
    assert_eq!(r.run(None).unwrap_err().code, "GUIDE_FAILED");
    assert_eq!(r.requests().len(), 2);
}

#[test]
fn capable_unavailable_section_model_uses_standard_fallback() {
    for status in [404, 429, 503] {
        let mut r = Rig::new(4);
        r.choice = ModelChoice::MostCapable;
        r.fake.behave(|b| {
            b.generate_statuses = vec![(status, "{}".into())];
            b.generate_answers = vec![reply("Synthetic section.", 1)];
        });
        r.run(None).unwrap();
        let log = r.fake.log();
        let requests: Vec<_> = log.iter().filter(|r| r.is_generate()).collect();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].path.contains("gemini-3.5-flash"));
    }
}

#[test]
fn cancelling_at_the_first_section_progress_event_is_not_reactivated() {
    let dir = TempDir::new();
    std::fs::create_dir(dir.path().join("documents")).unwrap();
    std::fs::write(
        dir.path().join("documents/a.pdf"),
        generation_tests::pdf(4, "sections"),
    )
    .unwrap();
    let request = SectionRequest {
        material_id: "mat-a".into(),
        relative_path: "a.pdf".into(),
        chosen_pages: vec![1, 2, 3, 4],
        base_revision: None,
        request_id: None,
    };
    let http = generation_client().unwrap();
    let cache = PreparedSources::new(gemini_files::Policy::default(), Arc::new(|| 1_700_000_000));
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let ctx = GenContext {
        provider: crate::provider::AnyProvider::default(),
        http: &http,
        base: "http://127.0.0.1:9",
        api_key: "synthetic-only",
        choice: ModelChoice::MostCapable,
        cache: &cache,
        epoch: cache.epoch(),
        budget: &budget,
        say: &|_| {},
    };
    let error = tauri::async_runtime::block_on(activate(
        &ctx,
        dir.path(),
        &request,
        None,
        &|_| {},
        &|id| {
            gemini_jobs::with(dir.path(), |j| j.cancel(id).unwrap());
        },
    ))
    .unwrap_err();
    assert_eq!(error.message, gemini_cancel::CANCELLED);
    let record = gemini_jobs::with(dir.path(), |j| j.list()[0].clone());
    assert_eq!(record.stage, gemini_jobs::JobStage::Cancelled);
    let d = read_draft(dir.path(), &record.id).unwrap();
    assert!(d.activations.iter().all(|a| a.submissions == 0));
}
