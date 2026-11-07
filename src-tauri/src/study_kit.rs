//! One document, one generation, three independently reviewable checkpoints.
//! This adds a journal kind, not a database migration or a change to old kinds.
use super::*;

pub(crate) const PAGE_MESSAGE: &str = "Choose up to 150 pages first. Use Choose fewer pages to send, then make your study kit from that part.";
const INCOMPLETE: &str = "The study kit got too long and was cut off. Try fewer pages, or make one part at a time with its own button.";
/// Output allowance for the whole kit. Gemini 3.x and Claude Haiku 5.5 both
/// think by default, and that thinking over up to 150 pages counts in the
/// same allowance as the ~9,000-token answer (guide, 20 cards, 10 questions).
/// 49,152 stays within both caps: Gemini 3.5/3.8 Flash 65,536 output tokens;
/// Claude Haiku 5.5 128K (provider/claude.rs sends the same figure).
pub(crate) const KIT_OUTPUT_TOKENS: u32 = 49_152;
pub(crate) const SENDING: &str = "Sending your PDF…";
pub(crate) const WRITING: &str = "Gemini is writing your study kit…";
/// Most cards and questions one kit keeps.
const MAX_KIT_CARDS: usize = 60;
const MAX_KIT_QUESTIONS: usize = 20;
/// Storage limits (trimmed code points) a ready card must fit. These mirror
/// STUDY_SET_LIMITS.front/back in src/data/studySetTransaction.ts; a vitest
/// (src/data/kitLimits.test.ts) fails if the two sides drift apart.
const KIT_CARD_FRONT_MAX: usize = 1_000;
const KIT_CARD_BACK_MAX: usize = 2_000;

/// Contiguous runs compress for display: [1,2,3,5] -> "1–3, 5".
fn compress_pages(pages: &[u32]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < pages.len() {
        let mut j = i;
        while j + 1 < pages.len() && pages[j + 1] == pages[j] + 1 {
            j += 1;
        }
        out.push(if j > i + 1 {
            format!("{}–{}", pages[i], pages[j])
        } else if j == i + 1 {
            format!("{}, {}", pages[i], pages[j])
        } else {
            pages[i].to_string()
        });
        i = j + 1;
    }
    out.join(", ")
}

fn card_fits_storage(card: &Flashcard) -> bool {
    (1..=KIT_CARD_FRONT_MAX).contains(&card.front.trim().chars().count())
        && (1..=KIT_CARD_BACK_MAX).contains(&card.back.trim().chars().count())
}

fn check_source(source: &LoadedSource) -> Result<u32, String> {
    if source.mime != "application/pdf" {
        return Err("Choose a PDF to make a study kit.".into());
    }
    let pages = source
        .page_count
        .ok_or("Could not count this PDF's pages. Choose a chapter and try again.")?;
    if pages == 0 || pages > 150 {
        return Err(PAGE_MESSAGE.into());
    }
    Ok(pages)
}

fn request_body(part: Value, pages: u32, claude: bool) -> Value {
    // The same pdfPage→sourcePage list the guide parts send. The kit reads the
    // whole stored PDF, so each sourcePage is the page's position in the file.
    let mapping: Vec<_> = (1..=pages)
        .map(|p| json!({"pdfPage":p,"sourcePage":p}))
        .collect();
    let mapping = json!(mapping);
    let prompt = format!("study-kit-prompt-v4: Make a basic study kit for a beginner from ONLY the attached selected PDF pages 1–{pages}. Read ONLY these selected PDF pages and cite their sourcePage numbers: {mapping}. sourcePage is the page's position in the attached file (1 = first page), never the number printed on the page. Do not discuss other pages. Use only supported facts. Do not invent procedures, regulations, numbers or page references. If ambiguous or outdated, say so rather than guessing. Return JSON with three parts: guide {{body, sourcePages}}, cards, questions. The guide must follow guide-section-prompt-v3: a 2–3 sentence overview, then one Markdown ### heading per main topic or chapter, each with short bullets in plain words. Cover every main topic AND every key fact a beginner must learn from these pages: definitions, numbers and values (with units), cause→effect, cautions, and the point of each figure. Preserve complete lists, methods, conditions, comparisons and stated purposes, and state both halves of compound facts; naming a topic is not enough. Use only as many short bullets as the pages support; fewer are fine. Do not repeat content or add generic explanations. Remove repetition before shortening facts; if everything cannot fit, name the topics you left out. Before returning, check every page and figure for missed facts. Never add a fact, definition or page that is not in the pages. Explain each technical term in plain words the first time it appears (e.g. precession, aneroid), using only explanations found in these pages; if a needed term is not defined there, say it is not defined in these pages. Keep the source's distinctions; never narrow a claim or add advice, in the guide, cards and questions. No long paragraphs; body at most 12000 characters. Make up to about 20 distinct cards, only as many as the pages support with front, back, sourcePage, quote; each back answers the front directly, never repeats the question. Make up to about 10 multiple-choice questions, only as many as the pages support with question, exactly 3 options, one correct, two plausible wrong answers of similar length, like the FAA knowledge test, correctIndex (zero-based single correct choice), explanation, sourcePage, quote. Every card and question must include a required quote of at most 300 characters, copied word-for-word as one continuous passage (no ellipses) from its cited sourcePage. Never refer to option letters or positions in explanations. Cite the pages actually used. This is an AI study aid to check against current FAA material, aircraft documents and her instructor, not operational flight instruction.");
    let prompt = if claude {
        claude_prompt(&prompt)
    } else {
        format!("{prompt} {}", crate::acs_tasks::prompt())
    };
    // Guide ~2,500 tokens + 20 cards ~3,000 + 10 questions ~3,000,
    // with space for JSON and thinking across 150 pages.
    json!({"contents":[{"role":"user","parts":[{"text":prompt},part]}],
        "generationConfig":{"responseMimeType":"application/json","maxOutputTokens":KIT_OUTPUT_TOKENS,
        "responseSchema":AnyProvider::default().translate_schema(&crate::provider::schemas::study_kit())}})
}

/// Claude-only kit prompt (v5d). Gemini keeps v4 byte for byte. The guide comes
/// first and must stay complete; the ACS list belongs to the questions only, so
/// it cannot leak into the guide or cards.
fn claude_prompt(v4: &str) -> String {
    let swap = |text: String, from: &str, to: &str| {
        debug_assert!(text.contains(from), "v5d anchor missing: {from}");
        text.replacen(from, to, 1)
    };
    let text = swap(
        v4.to_string(),
        "study-kit-prompt-v4: Make a basic study kit",
        "study-kit-prompt-v5d: Make a study kit",
    );
    let text = swap(
        text,
        "guide {body, sourcePages}, cards, questions. ",
        "guide {body, sourcePages}, cards, questions. Write the guide first and make it complete; the cards and questions come after it and must never make it shorter. ",
    );
    let text = swap(
        text,
        "explanation, sourcePage, quote. Every card",
        &format!("explanation, sourcePage, quote. If the pages show a question with fewer than three options or no answer, write a three-option question only when the pages state enough facts to establish the correct answer; otherwise leave that question out. Never invent an answer, and never mention this limit. {} acsTask is for questions only. Never put ACS task codes, this app or these instructions into the guide or cards (facts the pages themselves state about the ACS are fine). Every card", crate::acs_tasks::prompt()),
    );
    swap(
        text,
        "Cite the pages actually used. This is an AI study aid",
        &format!("Cite the pages actually used. {CLAUDE_ITEM_RULES} This is an AI study aid"),
    )
}

/// Quality rules for Claude cards and questions, ending in a silent check.
const CLAUDE_ITEM_RULES: &str = "Card and question quality: each card or question tests one learning objective that can be answered on its own; keep a mechanism and its mitigation in separate items, but a valid cause→effect pair stays one card. A card back supplies the missing fact and never restates the front. All options of a question answer the same question, read grammatically with the stem, and are plausible confusions taken from the source, with no giveaways in length or wording. Each explanation says why the answer follows and cites the physical PDF page matching sourcePage; the quote must support the answer. Before answering, silently recheck every card and question against these rules and fix or drop any that fail; never print this check.";

fn aid(cards: Value, body: Option<String>, model: &str) -> Value {
    json!({"title":"Study kit", "summary":"", "sections":body.map(|body| vec![json!({"heading":"Study guide", "body":body})]).unwrap_or_default(),
        "flashcards":cards, "sourceNotes":"AI study aid. Check against current FAA material and your instructor.", "model":model})
}

/// Deserialize and validate each part independently: a malformed sibling cannot
/// take a paid, usable draft away. Failed parts remain visible until dismissed.
fn validate(value: Value, pages: u32, model: &str, practice_revision: Option<&str>) -> Value {
    let chosen: Vec<u32> = (1..=pages).collect();
    let guide = sections::validate_basic_kit_guide(&value["guide"], &chosen, model)
        .map(|(body, pages)| {
            let mut result = aid(json!([]), Some(body), model);
            result["sourceNotes"] = json!(format!("Source pages: {}. AI study aid. Check against current FAA material and your instructor.", compress_pages(&pages)));
            result
        });
    // One bad card or question costs only itself: each is checked by the
    // single generators' own per-item rule, and a part fails only when none
    // of its items remain.
    let cards = (|| -> Result<Value, String> {
        let mut parsed: GeneratedStudyAid =
            serde_json::from_value(aid(value["cards"].clone(), None, model))
                .map_err(|_| "Invalid cards")?;
        parsed
            .flashcards
            .retain(|card| batches::card_ok(card, Some(pages)) && card_fits_storage(card));
        let mut seen = std::collections::HashSet::new();
        parsed.flashcards.retain(|card| {
            seen.insert((
                batches::normalized(&card.front),
                batches::normalized(&card.back),
            ))
        });
        parsed.flashcards.truncate(MAX_KIT_CARDS);
        if parsed.flashcards.is_empty() {
            return Err("No cards".into());
        }
        // Existing batch validation requires a descriptive nonblank summary.
        parsed.summary = "Flashcards from your PDF".into();
        batches::validate(&parsed, Some(pages), MAX_KIT_CARDS)?;
        let mut v = serde_json::to_value(parsed).map_err(|e| e.to_string())?;
        v["summary"] = json!("Flashcards from your PDF");
        Ok(v)
    })();
    let questions = (|| -> Result<Value, String> {
        // Each question is read on its own: a bad correctIndex (negative,
        // string, fractional) or missing field drops only that question.
        let items = value["questions"].as_array().ok_or("Invalid questions")?;
        let mut seen = std::collections::HashSet::new();
        let questions: Vec<PracticeQuestion> = items
            .iter()
            .filter_map(|item| serde_json::from_value::<PracticeQuestion>(item.clone()).ok())
            .filter(|q| q.options.len() == 3 && q.source_page.is_some_and(|p| p != 0 && p <= pages))
            .filter(|q| {
                let choices: Vec<String> =
                    q.options.iter().map(|o| batches::normalized(o)).collect();
                let distinct: std::collections::HashSet<_> = choices.iter().collect();
                distinct.len() == choices.len()
                    && seen.insert((batches::normalized(&q.question), choices))
            })
            .collect();
        let test = GeneratedPracticeTest {
            title: "Practice questions".into(),
            questions,
            model: model.into(),
        };
        let mut test = sanitize_practice_test(test)?;
        test.questions.truncate(MAX_KIT_QUESTIONS);
        serde_json::to_value(test).map_err(|e| e.to_string())
    })();
    // The error is stored inside the result, past the wording pass, so it
    // names the real button for the provider that made it.
    let helper = if model.starts_with("claude-") {
        "Claude"
    } else {
        "Gemini"
    };
    let make_cards = format!("Make new cards with {helper}");
    let part = |answer: Result<Value, String>, name: &str, button: &str| match answer {
        Ok(answer) => json!({"answer":answer}),
        Err(_) => {
            json!({"error":format!("The {name} part could not be used. Your other usable parts are kept for review. Redo this part with {button}. Nothing was saved automatically.")})
        }
    };
    json!({"parts":{
        "guide":part(guide, "study guide", "Create study guide or Regenerate"),
        "cards":part(cards, "flashcard", &make_cards),
        "questions":part(questions, "practice question", "Create practice test or Regenerate")},
        "practiceRevision":practice_revision})
}

/// Check both item types against one local page-text cache for this response.
fn validate_checked(
    mut value: Value,
    pages: u32,
    model: &str,
    practice_revision: Option<&str>,
    mut read_page: impl FnMut(u32) -> Option<String>,
) -> Value {
    // Share missing-page results too, so an extraction failure is not retried.
    let mut cache = std::collections::HashMap::new();
    let mut read = |p| cache.entry(p).or_insert_with(|| read_page(p)).clone();
    let cards = value
        .get_mut("cards")
        .map(|items| kit_evidence::check_items(items, pages, false, &mut read))
        .unwrap_or_default();
    let questions = value
        .get_mut("questions")
        .map(|items| kit_evidence::check_items(items, pages, true, &mut read))
        .unwrap_or_default();
    let mut result = validate(value, pages, model, practice_revision);
    // Structural validation can drop the first raw item. Keep the one-time
    // majority notice on the first item that actually reaches her draft.
    for (part, field, counts) in [
        ("cards", "flashcards", &cards),
        ("questions", "questions", &questions),
    ] {
        if counts.majority_fallback {
            if let Some(first) = result
                .get_mut("parts")
                .and_then(|v| v.get_mut(part))
                .and_then(|v| v.get_mut("answer"))
                .and_then(|v| v.get_mut(field))
                .and_then(Value::as_array_mut)
                .and_then(|a| a.first_mut())
            {
                first["verificationNote"] = json!(kit_evidence::FALLBACK);
            }
        }
    }
    result["quoteCounts"] = json!({"cards":cards,"questions":questions});
    result
}

async fn generate(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    practice_revision: Option<&str>,
) -> Result<Value, String> {
    let pages = check_source(source)?;
    // The line follows the real stage: sending (and, for Gemini, the upload
    // message), then writing once the request itself goes out.
    (ctx.say)(SENDING.into());
    let (raw, model) = run_generation(ctx, source, &|part| {
        (ctx.say)(WRITING.into());
        request_body(
            part,
            pages,
            ctx.provider.id() == crate::provider::ProviderId::Claude,
        )
    })
    .await?;
    ctx.budget.reset_stage(Stage::Validating);
    ctx.budget.validation_checkpoint()?;
    let text = ctx.extract_text(&raw).map_err(|message| {
        if message.contains("output limit") || message.contains("incomplete") {
            INCOMPLETE.to_string()
        } else {
            message
        }
    })?;
    let value = serde_json::from_str(&text).map_err(|_| INCOMPLETE.to_string())?;
    let mut local = kit_evidence::PageText::new(source);
    let result = validate_checked(value, pages, model, practice_revision, |p| local.page(p));
    ctx.budget.validation_checkpoint()?;
    Ok(result)
}

/// Present durable parts as the existing review flows' jobs, without allocating
/// three journal slots. IDs are virtual; acknowledgements remove only that part.
pub(super) fn review_records(record: JobRecord) -> Vec<JobRecord> {
    if record.kind != JobKind::StudyKit || record.stage != JobStage::Ready {
        return vec![record];
    }
    let Some(parts) = record.result.as_ref().and_then(|r| r["parts"].as_object()) else {
        return vec![record];
    };
    [
        ("guide", JobKind::StudyAid),
        ("cards", JobKind::StudyAid),
        ("questions", JobKind::PracticeTest),
    ]
    .into_iter()
    .filter_map(|(part, kind)| {
        let content = parts.get(part)?;
        let mut child = record.clone();
        child.id = format!("{}#{part}", record.id);
        child.kind = kind;
        child.request_id = Some(format!(
            "{}study-kit:{}",
            if part == "cards" { "flashcards:" } else { "" },
            record.id
        ));
        child.draft = Some(json!({"kind":"study-kit-part"}));
        child.result = content.get("answer").cloned();
        child.error = content
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string);
        child.stage = if child.result.is_some() {
            JobStage::Ready
        } else {
            JobStage::Failed
        };
        if part == "questions" {
            child.base_revision = record
                .result
                .as_ref()
                .and_then(|r| r["practiceRevision"].as_str())
                .map(str::to_string);
        }
        Some(child)
    })
    .collect()
}

/// The kit queue's consent no longer matches: another provider is selected.
pub(crate) const KIT_PROVIDER_CHANGED: &str =
    "Your provider or your chapters changed. Check them and confirm again.";
/// The kit queue's consent no longer matches: the chapter file changed.
pub(crate) const KIT_SOURCE_CHANGED: &str = "This chapter changed. Make it again from its page.";

/// The kit queue (SOURCE-01b) asks for exactly the provider and the file bytes
/// the student agreed to. Either one differing refuses before any job begins,
/// so nothing is sent or paid for.
fn check_expected(
    provider: crate::provider::ProviderId,
    content_sha256: &str,
    expected_provider: Option<&str>,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let company = match provider {
        crate::provider::ProviderId::Claude => "Anthropic",
        crate::provider::ProviderId::Gemini => "Google",
    };
    if expected_provider.is_some_and(|expected| expected != company) {
        return Err(KIT_PROVIDER_CHANGED.to_string());
    }
    if expected_sha256.is_some_and(|expected| expected != content_sha256) {
        return Err(KIT_SOURCE_CHANGED.to_string());
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn generate_study_kit(
    app: AppHandle,
    relative_path: String,
    material_id: String,
    base_revision: Option<String>,
    practice_revision: Option<String>,
    request_id: Option<String>,
    expected_provider: Option<String>,
    expected_sha256: Option<String>,
) -> Result<JobAnswer<Value>, String> {
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    budget.section_generation_limit(480);
    let epoch = prepared_sources().epoch();
    let (provider, api_key, source) = budget
        .run(prepare_submission(&app, &relative_path))
        .await
        .map_err(|_| "Preparing your PDF took too long.")??;
    // SOURCE-01b: the last check before anything is sent or a job is begun.
    check_expected(
        provider.id(),
        &source.content_sha256,
        expected_provider.as_deref(),
        expected_sha256.as_deref(),
    )?;
    check_source(&source)?;
    let root = app_root(&app)?;
    let http = generation_client()?;
    let reporter = reporter_for(&app, &material_id, JobKind::StudyKit);
    reporter.follow(&budget);
    let progress = |m: String| reporter.say(provider.wording(m));
    let started = |id: &str| reporter.started(id);
    let ctx = GenContext {
        provider,
        http: &http,
        base: provider.base(),
        api_key: &api_key,
        choice: load_choice(&root),
        cache: prepared_sources(),
        epoch,
        budget: &budget,
        say: &progress,
    };
    as_job_with(
        &root,
        JobKind::StudyKit,
        &material_id,
        base_revision.as_deref(),
        &source,
        generate(&ctx, &source, practice_revision.as_deref()),
        &job_changed(&app),
        JobHooks {
            started: Some(&started),
            cancellable: true,
            request_id: request_id.as_deref(),
            budget: Some(&budget),
        },
    )
    .await
    .map_err(|m| provider.wording(m))
}

#[cfg(test)]
#[path = "study_kit_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "live_bench_tests.rs"]
mod live_bench;

#[cfg(test)]
mod kit_queue_expected_tests {
    use super::*;
    use crate::provider::ProviderId;

    #[test]
    fn kit_queue_expected_provider_and_checksum_refuse_before_sending() {
        assert!(check_expected(ProviderId::Gemini, "abc", None, None).is_ok());
        assert!(check_expected(ProviderId::Gemini, "abc", Some("Google"), Some("abc")).is_ok());
        assert!(check_expected(ProviderId::Claude, "abc", Some("Anthropic"), Some("abc")).is_ok());
        assert_eq!(
            check_expected(ProviderId::Claude, "abc", Some("Google"), Some("abc")).unwrap_err(),
            KIT_PROVIDER_CHANGED
        );
        assert_eq!(
            check_expected(ProviderId::Gemini, "abc", Some("Google"), Some("def")).unwrap_err(),
            KIT_SOURCE_CHANGED
        );
    }
}

#[cfg(test)]
mod acs_tests {
    use super::*;
    #[test]
    fn kit_prompt_contains_every_task() {
        let body = request_body(json!({"text":"Synthetic source"}), 1, false);
        let body = body.to_string();
        for (code, _) in crate::acs_tasks::ACS_TASKS {
            assert!(body.contains(code));
        }
        assert!(body.contains("chosen ONLY from this list, or null if none fits clearly"));
    }
}
