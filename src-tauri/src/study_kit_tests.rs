use super::*;

fn valid() -> Value {
    json!({"guide":{"body":"Overview.\n### Lift\n- Study lift.","sourcePages":[1]},
        "cards":[{"front":"What supports flight?","back":"Lift.","sourcePage":1,"quote":"Lift acts upwards."}],
        "questions":[{"question":"What supports flight?","options":["Lift","Drag","Weight"],"correctIndex":0,"explanation":"Lift acts upwards.","sourcePage":1,"quote":"Lift acts upwards."}]})
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
/// A paid guide that runs past the requested 12,000 characters is kept, up
/// to what a study set stores, like a guide part.
#[test]
fn study_kit_guide_over_the_requested_length_is_kept() {
    let mut v = valid();
    let body = format!("Overview.\n### Lift\n- {}", "Study lift. ".repeat(1200));
    assert!(body.chars().count() > 12_000 && body.chars().count() <= 20_000);
    v["guide"] = json!({"body": body, "sourcePages":[1]});
    assert!(validate(v, 2, MODEL, None)["parts"]["guide"]
        .get("answer")
        .is_some());
}

/// One bad card or question drops only itself; the part fails only when
/// none remain.
#[test]
fn study_kit_drops_only_invalid_cards_and_questions() {
    let good_card = json!({"front":"What supports flight?","back":"Lift.","sourcePage":1,"quote":"Lift acts upwards."});
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
    many["questions"] = json!((0..25)
        .map(|n| {
            let mut q = good_question.clone();
            q["question"] = json!(format!("Question {n}?"));
            q
        })
        .collect::<Vec<_>>());
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
    let body = request_body(json!({"text":"synthetic PDF"}), 150, false);
    assert_eq!(body["contents"].as_array().unwrap().len(), 1);
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 49_152);
    let prompt = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
    assert!(prompt.contains(r#"{"pdfPage":1,"sourcePage":1}"#));
    assert!(prompt.contains(r#"{"pdfPage":150,"sourcePage":150}"#));
    assert!(prompt.contains("never the number printed on the page"));
    assert!(prompt.contains("Never refer to option letters or positions in explanations."));
    assert!(prompt.starts_with("study-kit-prompt-v4: "));
    assert!(
        prompt.contains("Make up to about 20 distinct cards, only as many as the pages support")
    );
    assert!(prompt.contains("say it is not defined in these pages"));
    assert!(prompt.contains(
        "Explain each technical term in plain words the first time it appears (e.g. precession, aneroid)"
    ));
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
    assert_eq!(props["guide"]["properties"]["body"]["maxLength"], 12000);
    let source = LoadedSource::new(vec![1, 2, 3], "application/pdf", "synthetic.pdf");
    let claude_body = request_body(crate::provider::claude::source_part(&source), 150, true);
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

#[test]
fn checked_kit_shares_page_reads_between_cards_and_questions_and_removes_quotes() {
    let mut value = valid();
    value["cards"][0]["quote"] = json!("Lift acts upwards.");
    value["questions"][0]["quote"] = json!("Lift acts upwards.");
    let mut reads = [0; 3];
    let checked = validate_checked(value, 2, MODEL, None, |page| {
        reads[page as usize] += 1;
        Some(
            if page == 2 {
                "Lift acts upwards."
            } else {
                "Other text."
            }
            .into(),
        )
    });
    for (part, items) in [("cards", "flashcards"), ("questions", "questions")] {
        let item = &checked["parts"][part]["answer"][items][0];
        assert_eq!(item["sourcePage"], 2);
        assert!(item.get("quote").is_none());
        assert!(item.get("verificationNote").is_none());
        assert_eq!(checked["quoteCounts"][part]["kept"], 1);
    }
    assert_eq!(reads, [0, 1, 1]);
}

#[test]
fn checked_kit_keeps_unavailable_pages_marked_and_drops_non_three_choices() {
    let mut value = valid();
    value["cards"][0]["quote"] = json!("Lift acts upwards.");
    value["questions"][0]["quote"] = json!("Lift acts upwards.");
    let good = value["questions"][0].clone();
    let mut old = good.clone();
    old["options"] = json!(["Lift", "Drag", "Weight", "Thrust"]);
    value["questions"] = json!([good, old]);
    let checked = validate_checked(value, 2, MODEL, None, |_| None);
    assert_eq!(
        checked["parts"]["questions"]["answer"]["questions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(checked["quoteCounts"]["questions"]["droppedByChoices"], 1);
    assert_eq!(checked["quoteCounts"]["cards"]["unverified"], 1);
    // The review is told how many were made, kept and why the rest went.
    let summary = &checked["parts"]["questions"]["answer"]["checkSummary"];
    assert_eq!(summary["generated"], 2);
    assert_eq!(summary["kept"], 1);
    assert_eq!(summary["droppedByChoices"], 1);
    assert_eq!(summary["droppedOther"], 0);
    assert_eq!(
        checked["parts"]["cards"]["answer"]["flashcards"][0]["verificationNote"],
        "Couldn't check this against the page"
    );
}

#[test]
fn check_summary_counts_structural_drops_as_other() {
    let mut value = valid();
    let first = value["cards"][0].clone();
    value["cards"] = json!([first.clone(), first]);
    let checked = validate_checked(value, 2, MODEL, None, |_| None);
    let summary = &checked["parts"]["cards"]["answer"]["checkSummary"];
    assert_eq!(summary["generated"], 2);
    assert_eq!(summary["kept"], 1);
    assert_eq!(summary["droppedOther"], 1);
}

#[test]
fn majority_notice_survives_structural_removal_of_the_first_raw_item() {
    let mut value = valid();
    value["cards"] = json!([
        {"front":"Invalid reference?","back":"x","sourcePage":0,"quote":"x"},
        {"front":"Missing quote?","back":"x","sourcePage":1,"quote":"Invented"},
        {"front":"Supported?","back":"x","sourcePage":1,"quote":"Blue wing"}
    ]);
    let checked = validate_checked(value, 2, MODEL, None, |_| Some("Blue wing".into()));
    let cards = checked["parts"]["cards"]["answer"]["flashcards"]
        .as_array()
        .unwrap();
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[0]["verificationNote"], kit_evidence::FALLBACK);
    assert!(cards.iter().all(|c| c.get("verificationNote").is_some()));
}

#[test]
fn malformed_checked_envelopes_stay_failed_without_inventing_answers() {
    for value in [
        json!(42),
        json!([]),
        json!(null),
        json!({}),
        json!({"cards":[42]}),
    ] {
        let checked = validate_checked(value, 2, MODEL, None, |_| None);
        for part in ["guide", "cards", "questions"] {
            assert!(checked["parts"][part].get("answer").is_none());
            assert!(checked["parts"][part].get("error").is_some());
        }
    }
}

#[test]
fn claude_kit_prompt_is_v5d_and_gemini_stays_v4() {
    let text = |body: &Value| {
        body["contents"][0]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let g = text(&request_body(json!({"text":"x"}), 3, false));
    let c = text(&request_body(json!({"text":"x"}), 3, true));
    assert!(g.starts_with("study-kit-prompt-v4: Make a basic study kit"));
    assert!(g.ends_with(&format!("instruction. {}", crate::acs_tasks::prompt())));
    assert!(!g.contains("Write the guide first"));
    assert!(c.starts_with("study-kit-prompt-v5d: Make a study kit"));
    assert!(!c.contains("basic"));
    assert!(c.contains("Write the guide first and make it complete; the cards and questions come after it and must never make it shorter."));
    assert!(c.contains("acsTask is for questions only. Never put ACS task codes, this app or these instructions into the guide or cards (facts the pages themselves state about the ACS are fine)."));
    assert!(c.contains("only when the pages state enough facts to establish the correct answer; otherwise leave that question out"));
    assert!(c.contains("Never invent an answer"));
    // the ACS list sits inside the questions instruction, once, not at the end
    assert_eq!(c.matches(&crate::acs_tasks::prompt()).count(), 1);
    assert!(c.find("Make up to about 10").unwrap() < c.find(&crate::acs_tasks::prompt()).unwrap());
    assert!(c.contains("tests one learning objective that can be answered on its own"));
    assert!(c.contains("A card back supplies the missing fact and never restates the front"));
    assert!(c.contains("no giveaways in length or wording"));
    assert!(c.contains("cites the physical PDF page matching sourcePage"));
    assert!(c.contains("silently recheck every card and question"));
    assert!(c.contains("never print this check"));
    assert!(!g.contains("silently recheck"));
    assert!(c.ends_with("not operational flight instruction."));
}

fn q(stem: &str, options: Value, index: Value) -> Value {
    json!({"question":stem,"options":options,"correctIndex":index,"explanation":"why","sourcePage":1})
}
fn kept_questions(result: &Value) -> Vec<String> {
    result["parts"]["questions"]["answer"]["questions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|q| q["question"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn one_bad_correct_index_drops_only_that_question() {
    for bad in [json!(-1), json!(7), json!("1"), json!(1.5), json!(null)] {
        let mut v = valid();
        v["questions"] = json!([
            q("A?", json!(["a", "b", "c"]), json!(0)),
            q("Bad?", json!(["a", "b", "c"]), bad),
            q("C?", json!(["x", "y", "z"]), json!(2))
        ]);
        let kept = kept_questions(&validate(v, 2, MODEL, None));
        assert_eq!(kept, ["A?", "C?"]);
    }
}

#[test]
fn duplicate_choices_and_duplicate_items_are_dropped() {
    let mut v = valid();
    v["questions"] = json!([
        q(
            "Dup?",
            json!(["Increase", " increase ", "Decrease"]),
            json!(0)
        ),
        q(
            "Spaced?",
            json!(["Same  thing", "same thing", "Other"]),
            json!(0)
        ),
        q("Keep?", json!(["Up", "Down", "Level"]), json!(0)),
        q(" keep? ", json!(["up", "DOWN", "level"]), json!(1))
    ]);
    v["cards"] = json!([
        {"front":"What lifts?","back":"Wings.","sourcePage":1},
        {"front":" what  lifts? ","back":"WINGS.","sourcePage":1},
        {"front":"What lifts?","back":"Wings and speed.","sourcePage":1}
    ]);
    let result = validate(v, 2, MODEL, None);
    assert_eq!(kept_questions(&result), ["Keep?"]);
    assert_eq!(
        result["parts"]["cards"]["answer"]["flashcards"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn cards_over_the_storage_limit_are_dropped_by_code_points() {
    let card = |front: String, back: String, n: u32| json!({"front":front,"back":back,"sourcePage":1,"n":n});
    // Multibyte: 1,000 code points is far more than 1,000 bytes.
    let front_ok = "é".repeat(KIT_CARD_FRONT_MAX);
    let back_ok = "é".repeat(KIT_CARD_BACK_MAX);
    let mut v = valid();
    v["cards"] = json!([
        card(front_ok.clone(), back_ok.clone(), 1),
        card(format!("{front_ok}é"), "b".into(), 2),
        card("f".into(), format!("{back_ok}é"), 3),
        card("ok front".into(), "ok back".into(), 4)
    ]);
    let result = validate(v, 2, MODEL, None);
    let cards = result["parts"]["cards"]["answer"]["flashcards"]
        .as_array()
        .unwrap();
    // Exactly at the limit is kept; one more is dropped.
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[1]["front"], "ok front");
}

#[test]
fn a_kit_keeps_every_cited_page_and_shows_runs_compressed() {
    let mut v = valid();
    let pages: Vec<u32> = (1..=25).chain([31]).collect();
    v["guide"]["sourcePages"] = json!(pages);
    let result = validate(v, 40, MODEL, None);
    let notes = result["parts"]["guide"]["answer"]["sourceNotes"]
        .as_str()
        .unwrap();
    assert!(notes.starts_with("Source pages: 1–25, 31."), "{notes}");
    assert_eq!(compress_pages(&[1, 2, 4, 6, 7, 8]), "1, 2, 4, 6–8");
}
