use super::*;

fn valid() -> Value {
    json!({"guide":{"body":"Overview.\n### Lift\n- Study lift.","sourcePages":[1]},
        "cards":[{"front":"What supports flight?","back":"Lift.","sourcePage":1}],
        "questions":[{"question":"What supports flight?","options":["Lift","Drag","Weight"],"correctIndex":0,"explanation":"Lift acts upwards.","sourcePage":1}]})
}
#[test]
fn study_kit_three_valid_drafts_and_each_invalid_sibling_keeps_other_two() {
    let all = validate(valid(), 2, MODEL, Some("practice-v1"));
    assert!(all["parts"]
        .as_object()
        .unwrap()
        .values()
        .all(|p| p.get("answer").is_some()));
    assert!(all["parts"]["guide"]["answer"]["sourceNotes"]
        .as_str()
        .unwrap()
        .contains("Source pages: 1"));
    for part in ["guide", "cards", "questions"] {
        let mut v = valid();
        v[part] = json!("malformed");
        let result = validate(v, 2, MODEL, None);
        let parts = result["parts"].as_object().unwrap();
        assert_eq!(
            parts.values().filter(|p| p.get("answer").is_some()).count(),
            2
        );
        assert!(parts[part]["error"]
            .as_str()
            .unwrap()
            .contains("Redo this part"));
    }
}
#[test]
fn study_kit_existing_validators_reject_invalid_references_and_answers() {
    for (part, change) in [
        (
            "guide",
            json!({"body":"x".repeat(20_001),"sourcePages":[1]}),
        ),
        ("cards", json!([{"front":"?","back":"","sourcePage":1}])),
        (
            "questions",
            json!([{"question":"?","options":["a","b"],"correctIndex":4,"explanation":"why","sourcePage":1}]),
        ),
    ] {
        let mut v = valid();
        v[part] = change;
        assert!(validate(v, 2, MODEL, None)["parts"][part]
            .get("error")
            .is_some());
    }
}
/// A paid guide that runs past the requested 8,000 characters is kept, up
/// to what a study set stores, like a guide part.
#[test]
fn study_kit_guide_over_the_requested_length_is_kept() {
    let mut v = valid();
    let body = format!("Overview.\n### Lift\n- {}", "Study lift. ".repeat(800));
    assert!(body.chars().count() > 8_000 && body.chars().count() <= 20_000);
    v["guide"] = json!({"body": body, "sourcePages":[1]});
    assert!(validate(v, 2, MODEL, None)["parts"]["guide"]
        .get("answer")
        .is_some());
}

/// One bad card or question drops only itself; the part fails only when
/// none remain.
#[test]
fn study_kit_drops_only_invalid_cards_and_questions() {
    let good_card = json!({"front":"What supports flight?","back":"Lift.","sourcePage":1});
    let good_question = json!({"question":"What supports flight?","options":["Lift","Drag","Weight"],"correctIndex":0,"explanation":"Lift acts upwards.","sourcePage":2});
    let mut v = valid();
    v["cards"] = json!([
        good_card,
        {"front":"Who publishes the FARs?","back":"The FAA.","sourcePage":null},
        {"front":"Printed page","back":"Out of range.","sourcePage":201},
        {"front":"Zero","back":"Page zero.","sourcePage":0},
        {"front":"","back":"Blank front.","sourcePage":1}
    ]);
    v["questions"] = json!([
        good_question,
        {"question":"Who publishes the FARs?","options":["FAA","NTSB"],"correctIndex":0,"explanation":"The FAA.","sourcePage":null},
        {"question":"Bad index","options":["a","b"],"correctIndex":4,"explanation":"why","sourcePage":1},
        {"question":"Printed page","options":["a","b"],"correctIndex":0,"explanation":"why","sourcePage":201}
    ]);
    let result = validate(v, 2, MODEL, None);
    let cards = result["parts"]["cards"]["answer"]["flashcards"]
        .as_array()
        .unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["front"], "What supports flight?");
    assert_eq!(
        result["parts"]["cards"]["answer"]["summary"],
        "Flashcards from your PDF"
    );
    let questions = result["parts"]["questions"]["answer"]["questions"]
        .as_array()
        .unwrap();
    assert_eq!(questions.len(), 1);
    assert_eq!(questions[0]["sourcePage"], 2);

    // More than a kit keeps is trimmed, not failed.
    let mut many = valid();
    many["questions"] = json!(vec![good_question.clone(); 25]);
    let result = validate(many, 2, MODEL, None);
    assert_eq!(
        result["parts"]["questions"]["answer"]["questions"]
            .as_array()
            .unwrap()
            .len(),
        20
    );

    // Nothing usable left: that part fails, naming the real button.
    let mut none = valid();
    none["cards"] = json!([{"front":"?","back":"x","sourcePage":null}]);
    none["questions"] = json!([{"question":"?","options":["a","b"],"correctIndex":0,"explanation":"why","sourcePage":9}]);
    let result = validate(none, 2, MODEL, None);
    assert!(result["parts"]["cards"]["error"]
        .as_str()
        .unwrap()
        .contains("Redo this part with Make new cards with Gemini."));
    assert!(result["parts"]["questions"].get("error").is_some());
    assert!(result["parts"]["guide"].get("answer").is_some());
    let claude = validate(
        json!({"guide":valid()["guide"],"cards":[],"questions":valid()["questions"]}),
        2,
        "claude-haiku-5-5",
        None,
    );
    assert!(claude["parts"]["cards"]["error"]
        .as_str()
        .unwrap()
        .contains("Make new cards with Claude."));
}

#[test]
fn study_kit_request_has_three_shared_shapes_tokens_and_claude_envelope() {
    let body = request_body(json!({"text":"synthetic PDF"}), 150);
    assert_eq!(body["contents"].as_array().unwrap().len(), 1);
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 49_152);
    let prompt = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
    assert!(prompt.contains(r#"{"pdfPage":1,"sourcePage":1}"#));
    assert!(prompt.contains(r#"{"pdfPage":150,"sourcePage":150}"#));
    assert!(prompt.contains("never the number printed on the page"));
    assert!(prompt.contains("Never refer to option letters or positions in explanations."));
    let props = &body["generationConfig"]["responseSchema"]["properties"];
    assert_eq!(props.as_object().unwrap().len(), 3);
    let cards = AnyProvider::default().translate_schema(&crate::provider::schemas::study_aid());
    let practice =
        AnyProvider::default().translate_schema(&crate::provider::schemas::practice_test());
    assert_eq!(
        props["cards"]["items"],
        cards["properties"]["flashcards"]["items"]
    );
    assert_eq!(
        props["questions"]["items"],
        practice["properties"]["questions"]["items"]
    );
    assert_eq!(props["guide"]["properties"]["body"]["maxLength"], 8000);
    let source = LoadedSource::new(vec![1, 2, 3], "application/pdf", "synthetic.pdf");
    let claude_body = request_body(crate::provider::claude::source_part(&source), 150);
    let claude = crate::provider::claude::ClaudeProvider.body("claude-haiku-5-5", &claude_body);
    let content = claude["messages"][0]["content"].as_array().unwrap();
    assert_eq!(
        content.iter().filter(|c| c["type"] == "document").count(),
        1
    );
    assert_eq!(content[0]["source"]["media_type"], "application/pdf");
    assert_eq!(claude["max_tokens"], 49_152);
    assert_eq!(
        claude["output_config"]["format"]["schema"]["properties"]["questions"]["items"]["type"],
        "object"
    );
}
#[test]
fn study_kit_page_guard_and_journal_independent_acknowledgement_restart() {
    let mut source = LoadedSource::new(vec![], "application/pdf", "synthetic.pdf");
    source.page_count = Some(151);
    assert_eq!(check_source(&source).unwrap_err(), PAGE_MESSAGE);
    source.page_count = Some(150);
    assert_eq!(check_source(&source).unwrap(), 150);
    let temp = TempDir::new();
    let mut j = gemini_jobs::Journal::open(temp.path());
    let id = j
        .begin(
            JobKind::StudyKit,
            "material",
            "synthetic.pdf",
            &"a".repeat(64),
            None,
        )
        .unwrap();
    j.ready(&id, validate(valid(), 2, MODEL, Some("practice-v1")))
        .unwrap();
    let mut j = gemini_jobs::Journal::open(temp.path());
    assert_eq!(j.list()[0].kind, JobKind::StudyKit);
    let records = review_records(j.list()[0].clone());
    assert_eq!(records.len(), 3);
    assert_eq!(
        records
            .iter()
            .find(|r| r.kind == JobKind::PracticeTest)
            .unwrap()
            .base_revision
            .as_deref(),
        Some("practice-v1")
    );
    assert!(j.acknowledge_kit_part(&format!("{id}#cards")).unwrap());
    let mut j = gemini_jobs::Journal::open(temp.path());
    assert_eq!(review_records(j.list()[0].clone()).len(), 2);
    assert!(j.acknowledge_kit_part(&format!("{id}#guide")).unwrap());
    assert!(j.acknowledge_kit_part(&format!("{id}#questions")).unwrap());
    assert!(j.list().is_empty());
}
#[test]
fn study_kit_interruption_and_cancel_are_durable_and_never_automatically_resend() {
    let temp = TempDir::new();
    let mut j = gemini_jobs::Journal::open(temp.path());
    let id = j
        .begin(
            JobKind::StudyKit,
            "material",
            "synthetic.pdf",
            &"a".repeat(64),
            None,
        )
        .unwrap();
    let mut j = gemini_jobs::Journal::open(temp.path());
    assert_eq!(j.list()[0].stage, JobStage::Interrupted);
    let next = j
        .begin(
            JobKind::StudyKit,
            "material",
            "synthetic.pdf",
            &"a".repeat(64),
            None,
        )
        .unwrap();
    assert_ne!(id, next);
    j.cancel(&next).unwrap();
    assert_eq!(
        gemini_jobs::Journal::open(temp.path()).list()[0].stage,
        JobStage::Cancelled
    );
}
#[test]
fn study_kit_one_loopback_generation_and_cut_off_message() {
    let fake = crate::fake_gemini::FakeGemini::start();
    let envelope = json!({"candidates":[{"content":{"parts":[{"text":valid().to_string()}]},"finishReason":"STOP"}]}).to_string();
    fake.behave(|b| b.generate_answer = Some(envelope));
    let mut source = LoadedSource::new(vec![1, 2, 3], "application/pdf", "synthetic.pdf");
    source.page_count = Some(2);
    let http = generation_client().unwrap();
    let cache = PreparedSources::new(
        crate::gemini_files::Policy::default(),
        Arc::new(|| 1_700_000_000),
    );
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let said = std::sync::Mutex::new(Vec::<String>::new());
    let say = |m: String| said.lock().unwrap().push(m);
    let ctx = GenContext {
        provider: AnyProvider::default(),
        http: &http,
        base: &fake.base,
        api_key: "synthetic-key",
        choice: ModelChoice::Standard,
        cache: &cache,
        epoch: cache.epoch(),
        budget: &budget,
        say: &say,
    };
    let result = tauri::async_runtime::block_on(generate(&ctx, &source, None)).unwrap();
    assert_eq!(result["parts"].as_object().unwrap().len(), 3);
    assert_eq!(fake.count(|r| r.is_generate()), 1);
    // The line follows the real stage: sending first, writing last (the
    // request is out), never stuck on the upload line.
    {
        let said = said.lock().unwrap();
        assert_eq!(said.first().map(String::as_str), Some(SENDING));
        assert_eq!(said.last().map(String::as_str), Some(WRITING));
    }
    assert_eq!(
        crate::provider::AnyProvider::Claude(crate::provider::claude::ClaudeProvider)
            .wording(WRITING.to_string()),
        "Claude is writing your study kit…"
    );
    fake.behave(|b| {
        b.generate_answer = Some(json!({"candidates":[{"finishReason":"MAX_TOKENS"}]}).to_string())
    });
    assert_eq!(
        tauri::async_runtime::block_on(generate(&ctx, &source, None)).unwrap_err(),
        INCOMPLETE
    );
}

struct TempDir(std::path::PathBuf);
impl TempDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "hfd-study-kit-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
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

#[test]
fn study_kit_valid_parts_block_duplicate_single_requests_but_invalid_part_can_be_redone() {
    let temp = TempDir::new();
    let mut j = gemini_jobs::Journal::open(temp.path());
    let sha = "a".repeat(64);
    let id = j
        .begin(JobKind::StudyKit, "material", "synthetic.pdf", &sha, None)
        .unwrap();
    let mut broken = valid();
    broken["questions"] = Value::Null;
    j.ready(&id, validate(broken, 2, MODEL, None)).unwrap();
    assert!(j
        .begin(JobKind::StudyKit, "material", "synthetic.pdf", &sha, None)
        .is_err());
    assert!(j
        .begin(JobKind::StudyAid, "material", "synthetic.pdf", &sha, None)
        .is_err());
    assert!(j
        .queue_sections("material", "synthetic.pdf", &sha, None, None, json!({}))
        .is_err());
    assert!(j
        .begin(
            JobKind::PracticeTest,
            "material",
            "synthetic.pdf",
            &sha,
            None
        )
        .is_ok());
}

/// Guide and cards saved, questions failed: nothing is left to save, so a new
/// kit may start (and replaces the old record).
#[test]
fn study_kit_with_only_failed_parts_left_does_not_block_a_new_kit() {
    let temp = TempDir::new();
    let mut j = gemini_jobs::Journal::open(temp.path());
    let sha = "a".repeat(64);
    let id = j
        .begin(JobKind::StudyKit, "material", "synthetic.pdf", &sha, None)
        .unwrap();
    let mut broken = valid();
    broken["questions"] = Value::Null;
    j.ready(&id, validate(broken, 2, MODEL, None)).unwrap();
    assert!(j.acknowledge_kit_part(&format!("{id}#guide")).unwrap());
    assert!(j.acknowledge_kit_part(&format!("{id}#cards")).unwrap());
    assert_eq!(review_records(j.list()[0].clone()).len(), 1);
    let next = j
        .begin(JobKind::StudyKit, "material", "synthetic.pdf", &sha, None)
        .expect("a kit with only a failed part left blocks nothing");
    assert_ne!(next, id);
    assert!(j.list().iter().all(|r| r.id != id));
}
