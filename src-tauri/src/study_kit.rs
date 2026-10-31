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

fn request_body(part: Value, pages: u32) -> Value {
    // The same pdfPage→sourcePage list the guide parts send. The kit reads the
    // whole stored PDF, so each sourcePage is the page's position in the file.
    let mapping: Vec<_> = (1..=pages)
        .map(|p| json!({"pdfPage":p,"sourcePage":p}))
        .collect();
    let mapping = json!(mapping);
    let prompt = format!("study-kit-prompt-v3: Make a basic study kit for a beginner from ONLY the attached selected PDF pages 1–{pages}. Read ONLY these selected PDF pages and cite their sourcePage numbers: {mapping}. sourcePage is the page's position in the attached file (1 = first page), never the number printed on the page. Do not discuss other pages. Use only supported facts. Do not invent procedures, regulations, numbers or page references. If ambiguous or outdated, say so rather than guessing. Return JSON with three parts: guide {{body, sourcePages}}, cards, questions. The guide must follow guide-section-prompt-v2: a 2–3 sentence overview, then one Markdown ### heading per main topic or chapter (about 6–10 topics), each with 2–4 short bullets in plain words. Explain each technical term in plain words the first time it appears (e.g. precession, aneroid), in the guide, cards and questions. No long paragraphs; body at most 8000 characters. Make about 20 distinct cards with front, back, sourcePage, quote; each back answers the front directly, never repeats the question. Make about 10 multiple-choice questions with question, exactly 3 options, one correct, two plausible wrong answers of similar length, like the FAA knowledge test, correctIndex (zero-based single correct choice), explanation, sourcePage, quote. Every card and question must include a required quote of at most 300 characters, copied word-for-word from its cited sourcePage. Never refer to option letters or positions in explanations. Cite the pages actually used. This is an AI study aid to check against current FAA material, aircraft documents and her instructor, not operational flight instruction.");
    // Guide ~2,500 tokens + 20 cards ~3,000 + 10 questions ~3,000,
    // with space for JSON and thinking across 150 pages.
    json!({"contents":[{"role":"user","parts":[{"text":prompt},part]}],
        "generationConfig":{"responseMimeType":"application/json","maxOutputTokens":KIT_OUTPUT_TOKENS,
        "responseSchema":AnyProvider::default().translate_schema(&crate::provider::schemas::study_kit())}})
}

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
            result["sourceNotes"] = json!(format!("Source pages: {}. AI study aid. Check against current FAA material and your instructor.", pages.iter().map(u32::to_string).collect::<Vec<_>>().join(", ")));
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
            .retain(|card| batches::card_ok(card, Some(pages)));
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
        let mut test: GeneratedPracticeTest = serde_json::from_value(
            json!({"title":"Practice questions", "questions":value["questions"], "model":model}),
        )
        .map_err(|_| "Invalid questions")?;
        test.questions.retain(|q| {
            q.options.len() == 3 && q.source_page.is_some_and(|p| p != 0 && p <= pages)
        });
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
        request_body(part, pages)
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

#[tauri::command]
pub async fn generate_study_kit(
    app: AppHandle,
    relative_path: String,
    material_id: String,
    base_revision: Option<String>,
    practice_revision: Option<String>,
    request_id: Option<String>,
) -> Result<JobAnswer<Value>, String> {
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    budget.section_generation_limit(480);
    let epoch = prepared_sources().epoch();
    let (provider, api_key, source) = budget
        .run(prepare_submission(&app, &relative_path))
        .await
        .map_err(|_| "Preparing your PDF took too long.")??;
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
