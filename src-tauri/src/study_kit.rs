//! One document, one generation, three independently reviewable checkpoints.
//! This adds a journal kind, not a database migration or a change to old kinds.
use super::*;

pub(crate) const PAGE_MESSAGE: &str = "Choose up to 150 pages first. Use Choose fewer pages to send, then make your study kit from that part.";
const INCOMPLETE: &str = "The study kit answer was cut off or incomplete. Nothing was saved. Choose fewer pages and try again.";

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
    let prompt = format!("study-kit-prompt-v1: Make a basic study kit for a beginner from ONLY the attached selected PDF pages 1–{pages}. Cite sourcePage numbers from this PDF; do not discuss other pages. Use only supported facts. Do not invent procedures, regulations, numbers or page references. If ambiguous or outdated, say so rather than guessing. Return JSON with three parts: guide {{body, sourcePages}}, cards, questions. The guide must follow guide-section-prompt-v2: a 2–3 sentence overview, then one Markdown ### heading per main topic or chapter (about 6–10 topics), each with 2–4 short bullets in plain words. No long paragraphs; body at most 8000 characters. Make about 20 distinct cards with front, back, sourcePage; each back answers the front directly, never repeats the question. Make about 10 multiple-choice questions with question, 3–5 options, correctIndex (zero-based single correct choice), explanation, sourcePage. Cite the pages actually used. This is an AI study aid to check against current FAA material, aircraft documents and her instructor, not operational flight instruction.");
    // Guide ~2,500 tokens + 20 cards ~3,000 + 10 questions ~3,000,
    // with space for JSON and Gemini thinking across 150 pages.
    json!({"contents":[{"role":"user","parts":[{"text":prompt},part]}],
        "generationConfig":{"responseMimeType":"application/json","maxOutputTokens":32768,
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
    let cards = (|| -> Result<Value, String> {
        let mut v = aid(value["cards"].clone(), None, model);
        // Existing batch validation requires a descriptive nonblank summary.
        v["summary"] = json!("Flashcards from your PDF");
        let parsed: GeneratedStudyAid =
            serde_json::from_value(v.clone()).map_err(|_| "Invalid cards")?;
        batches::validate(&parsed, Some(pages), 60)?;
        if parsed.flashcards.is_empty() {
            return Err("No cards".into());
        }
        Ok(v)
    })();
    let questions = (|| -> Result<Value, String> {
        let test: GeneratedPracticeTest = serde_json::from_value(
            json!({"title":"Practice questions", "questions":value["questions"], "model":model}),
        )
        .map_err(|_| "Invalid questions")?;
        let expected = test.questions.len();
        let test = sanitize_practice_test(test)?;
        if test.questions.len() != expected
            || expected > 20
            || test
                .questions
                .iter()
                .any(|q| q.source_page.is_none_or(|p| p == 0 || p > pages))
        {
            return Err("Invalid questions".into());
        }
        serde_json::to_value(test).map_err(|e| e.to_string())
    })();
    let part = |answer: Result<Value, String>, name: &str, button: &str| match answer {
        Ok(answer) => json!({"answer":answer}),
        Err(_) => {
            json!({"error":format!("The {name} part could not be used. Your other usable parts are kept for review. Redo this part with {button}. Nothing was saved automatically.")})
        }
    };
    json!({"parts":{
        "guide":part(guide, "study guide", "Create study guide or Regenerate"),
        "cards":part(cards, "flashcard", "Make new cards"),
        "questions":part(questions, "practice question", "Create practice test or Regenerate")},
        "practiceRevision":practice_revision})
}

async fn generate(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    practice_revision: Option<&str>,
) -> Result<Value, String> {
    let pages = check_source(source)?;
    (ctx.say)("Making your study kit…".into());
    let (raw, model) = run_generation(ctx, source, &|part| request_body(part, pages)).await?;
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
    let result = validate(value, pages, model, practice_revision);
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
