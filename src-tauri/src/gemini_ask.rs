//! Interactive Gemini question-and-answer assistant for flight-training study.
//!
//! Unlike study aids and practice tests, this is an interactive query (short budget,
//! not journaled, chats are not saved to disk). It reuses the same prepared PDF
//! caching and retry infrastructure from `gemini.rs`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;

use crate::gemini::{
    extract_text, generate_with_retries_at, generation_client, load_choice, prepare_submission,
    prepared_sources, run_generation, stored_key, GenContext, LoadedSource,
};
use crate::gemini_budget::Budget;
use crate::gemini_files::{self, GOOGLE_BASE};
use crate::storage;

pub const ASK_INSTRUCTION: &str =
    "You are a patient flight-training study helper for a student pilot. \
     Answer from the attached PDF and the given context; say plainly when the PDF does not cover it. \
     Cite PDF page numbers you used. Keep it short and clear. \
     This is a study aid; remind her to check FAA guidance and her instructor for anything operational.";

pub const ASK_GEMINI_BUDGET: Duration = Duration::from_secs(90);

pub const MAX_CONTEXT_CHARS: usize = 8000;
pub const MAX_QUESTION_CHARS: usize = 1000;
pub const MAX_HISTORY_TURNS: usize = 6;
pub const MAX_HISTORY_TURN_CHARS: usize = 2000;
pub const MAX_ANSWER_CHARS: usize = 6000;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AskHistoryTurn {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AskAnswer {
    pub answer: String,
    pub source_pages: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAskResponse {
    answer: String,
    #[serde(default)]
    source_pages: Vec<i64>,
}

#[cfg(test)]
pub fn require_connected_key(key: Option<&str>) -> Result<&str, String> {
    match key {
        Some(k) if !k.trim().is_empty() => Ok(k),
        _ => Err("Gemini is not connected. Connect it in Settings first.".to_string()),
    }
}

pub fn validate_question(question: &str) -> Result<(), String> {
    let trimmed = question.trim();
    if trimmed.is_empty() {
        return Err("Enter a question before asking.".to_string());
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err("Questions can be up to 1,000 characters.".to_string());
    }
    Ok(())
}

pub fn validate_context(context: &str) -> Result<(), String> {
    if context.chars().count() > MAX_CONTEXT_CHARS {
        return Err("Context is too large (maximum 8,000 characters).".to_string());
    }
    Ok(())
}

pub fn validate_history(history: &[AskHistoryTurn]) -> Result<&[AskHistoryTurn], String> {
    let turns = if history.len() > MAX_HISTORY_TURNS {
        &history[history.len() - MAX_HISTORY_TURNS..]
    } else {
        history
    };
    for turn in turns {
        if turn.text.chars().count() > MAX_HISTORY_TURN_CHARS {
            return Err("History entries can be up to 2,000 characters.".to_string());
        }
    }
    Ok(turns)
}

pub fn parse_and_validate_answer(
    text: &str,
    pdf_page_count: Option<u32>,
) -> Result<AskAnswer, String> {
    let parsed: RawAskResponse = serde_json::from_str(text)
        .map_err(|_| "Gemini did not return a usable answer. Try asking again.".to_string())?;

    let answer = parsed.answer.trim().to_string();
    if answer.is_empty() {
        return Err("Gemini did not return an answer. Try asking again.".to_string());
    }
    if answer.chars().count() > MAX_ANSWER_CHARS {
        return Err("Gemini's answer was longer than expected. Try asking again.".to_string());
    }

    let mut source_pages = Vec::new();
    if let Some(max_page) = pdf_page_count {
        for page in parsed.source_pages {
            if page >= 1 && (page as u64) <= (max_page as u64) {
                source_pages.push(page as u32);
            }
        }
    }
    source_pages.sort_unstable();
    source_pages.dedup();

    Ok(AskAnswer {
        answer,
        source_pages,
    })
}

pub fn build_ask_request(
    pdf_part: Option<Value>,
    context: &str,
    history: &[AskHistoryTurn],
    question: &str,
) -> Value {
    let mut parts = vec![json!({"text": ASK_INSTRUCTION})];
    if let Some(part) = pdf_part {
        parts.push(part);
    }
    if !context.trim().is_empty() {
        parts.push(json!({"text": format!("Context:\n{}", context.trim())}));
    }
    if !history.is_empty() {
        let mut history_text = String::from("Prior conversation:\n");
        for turn in history {
            let role_name = if turn.role == "model" || turn.role == "assistant" {
                "Helper"
            } else {
                "Student"
            };
            history_text.push_str(&format!("{role_name}: {}\n", turn.text.trim()));
        }
        parts.push(json!({"text": history_text.trim()}));
    }
    parts.push(json!({"text": format!("Question:\n{}", question.trim())}));

    json!({
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "required": ["answer", "sourcePages"],
                "properties": {
                    "answer": {"type": "STRING"},
                    "sourcePages": {
                        "type": "ARRAY",
                        "items": {"type": "INTEGER"}
                    }
                }
            },
            "maxOutputTokens": 4096
        }
    })
}

pub async fn ask_gemini_with(
    ctx: &GenContext<'_>,
    source: Option<&LoadedSource>,
    page_count: Option<u32>,
    context: &str,
    question: &str,
    history: &[AskHistoryTurn],
) -> Result<AskAnswer, String> {
    validate_question(question)?;
    validate_context(context)?;
    let valid_history = validate_history(history)?;

    let (raw, _model) = if let Some(src) = source {
        let build = |part: Value| build_ask_request(Some(part), context, valid_history, question);
        run_generation(ctx, src, &build).await?
    } else {
        let body = build_ask_request(None, context, valid_history, question);
        ctx.budget
            .run(generate_with_retries_at(ctx, &body))
            .await
            .map_err(|_| gemini_files::out_of_time(ctx.budget, "asking Gemini"))?
            .map_err(|f| f.message)?
    };

    let text = extract_text(&raw)?;
    parse_and_validate_answer(&text, page_count)
}

#[tauri::command]
pub async fn ask_gemini(
    app: AppHandle,
    relative_path: Option<String>,
    material_id: String,
    context: String,
    question: String,
    history: Vec<AskHistoryTurn>,
) -> Result<AskAnswer, String> {
    let _ = &material_id;
    validate_question(&question)?;
    validate_context(&context)?;
    let valid_history = validate_history(&history)?;

    let budget = Budget::new(ASK_GEMINI_BUDGET);
    // Recorded before the key is read, as every generation does, so a
    // disconnect or key change during this question makes it stale.
    let epoch = prepared_sources().epoch();

    let (api_key, source, page_count) =
        if let Some(rel_path) = relative_path.as_deref().filter(|p| !p.trim().is_empty()) {
            let (api_key, source) = budget
                .run(prepare_submission(&app, rel_path))
                .await
                .map_err(|_| gemini_files::out_of_time(&budget, "preparing the document"))??;
            let page_count = lopdf::Document::load_mem(&source.bytes)
                .map(|d| d.get_pages().len() as u32)
                .ok();
            (api_key, Some(source), page_count)
        } else {
            let api_key = stored_key(&app)?;
            (api_key, None, None)
        };

    let root = storage::app_root(&app)?;
    let choice = load_choice(&root);
    let http = generation_client()?;
    let say = |_| ();
    let ctx = GenContext {
        http: &http,
        base: GOOGLE_BASE,
        api_key: &api_key,
        choice,
        cache: prepared_sources(),
        epoch,
        budget: &budget,
        say: &say,
    };

    ask_gemini_with(
        &ctx,
        source.as_ref(),
        page_count,
        &context,
        &question,
        valid_history,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake_gemini::FakeGemini;
    use crate::gemini::ModelChoice;
    use crate::gemini_files::{Policy, PreparedSources};
    use lopdf::{dictionary, Document, Object};
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Arc;

    const KEY: &str = "synthetic-key-AAAAAAAAAAAAAAAAAAAA";

    fn synthetic_pdf(pages: u32) -> Vec<u8> {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let kids: Vec<Object> = (0..pages)
            .map(|_| {
                document
                    .add_object(dictionary! {
                        "Type" => "Page",
                        "Parent" => pages_id,
                        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    })
                    .into()
            })
            .collect();
        document.objects.insert(
            pages_id,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Count" => i64::from(pages), "Kids" => kids },
            ),
        );
        let catalog_id =
            document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        document.trailer.set("Root", catalog_id);
        let mut out = Vec::new();
        document.save_to(&mut out).unwrap();
        out
    }

    struct TestRig {
        fake: FakeGemini,
        http: reqwest::Client,
        cache: PreparedSources,
        #[allow(dead_code)]
        now: Arc<AtomicI64>,
    }

    fn test_rig() -> TestRig {
        let now = Arc::new(AtomicI64::new(1_700_000_000));
        let clock_now = now.clone();
        TestRig {
            fake: FakeGemini::start(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap(),
            cache: PreparedSources::new(
                Policy {
                    poll_interval: Duration::from_millis(1),
                    poll_cap: Duration::from_millis(2),
                    max_polls: 3,
                    delete_timeout: Duration::from_secs(2),
                    ..Policy::default()
                },
                Arc::new(move || clock_now.load(Ordering::SeqCst)),
            ),
            now,
        }
    }

    #[test]
    fn a_good_answer_round_trips() {
        let rig = test_rig();
        let pdf_bytes = synthetic_pdf(5);
        let source = LoadedSource::new(pdf_bytes, "application/pdf", "documents/test.pdf");

        let fake_answer = json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json!({
                            "answer": "The pitot tube provides dynamic pressure for the airspeed indicator.",
                            "sourcePages": [4, 2]
                        }).to_string()
                    }]
                }
            }]
        });
        rig.fake
            .behave(|b| b.generate_answer = Some(fake_answer.to_string()));

        let budget = Budget::new(ASK_GEMINI_BUDGET);
        let say = |_| ();
        let ctx = GenContext {
            http: &rig.http,
            base: &rig.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &rig.cache,
            epoch: rig.cache.epoch(),
            budget: &budget,
            say: &say,
        };

        let result = tauri::async_runtime::block_on(ask_gemini_with(
            &ctx,
            Some(&source),
            Some(5),
            "Question: What does the pitot tube do?",
            "Why does the airspeed indicator need the pitot tube?",
            &[],
        ))
        .expect("ask_gemini_with should succeed");

        assert_eq!(
            result.answer,
            "The pitot tube provides dynamic pressure for the airspeed indicator."
        );
        // Pages must be sorted and deduplicated
        assert_eq!(result.source_pages, vec![2, 4]);
    }

    #[test]
    fn bad_page_numbers_are_dropped() {
        let rig = test_rig();
        let pdf_bytes = synthetic_pdf(5);
        let source = LoadedSource::new(pdf_bytes, "application/pdf", "documents/test.pdf");

        // Gemini returns out-of-range, non-positive, and duplicate pages: 0, 2, 2, 6, 999, -1
        let fake_answer = json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json!({
                            "answer": "Check page 2 of your handbook.",
                            "sourcePages": [0, 2, 2, 6, 999, -1]
                        }).to_string()
                    }]
                }
            }]
        });
        rig.fake
            .behave(|b| b.generate_answer = Some(fake_answer.to_string()));

        let budget = Budget::new(ASK_GEMINI_BUDGET);
        let say = |_| ();
        let ctx = GenContext {
            http: &rig.http,
            base: &rig.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &rig.cache,
            epoch: rig.cache.epoch(),
            budget: &budget,
            say: &say,
        };

        let result = tauri::async_runtime::block_on(ask_gemini_with(
            &ctx,
            Some(&source),
            Some(5),
            "Context here",
            "What page is this on?",
            &[],
        ))
        .expect("ask_gemini_with should succeed");

        // Only page 2 is in 1..=5
        assert_eq!(result.source_pages, vec![2]);
    }

    #[test]
    fn overlong_question_is_refused_before_sending() {
        let rig = test_rig();
        let budget = Budget::new(ASK_GEMINI_BUDGET);
        let say = |_| ();
        let ctx = GenContext {
            http: &rig.http,
            base: &rig.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &rig.cache,
            epoch: rig.cache.epoch(),
            budget: &budget,
            say: &say,
        };

        let overlong_question = "x".repeat(1001);
        let result = tauri::async_runtime::block_on(ask_gemini_with(
            &ctx,
            None,
            None,
            "Context",
            &overlong_question,
            &[],
        ));

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Questions can be up to 1,000 characters."
        );
        // Verified: NO request was sent to fake gemini!
        assert_eq!(rig.fake.count(|r| r.is_generate()), 0);
    }

    #[test]
    fn missing_key_gives_plain_message() {
        assert_eq!(
            require_connected_key(None).unwrap_err(),
            "Gemini is not connected. Connect it in Settings first."
        );
        assert_eq!(
            require_connected_key(Some("")).unwrap_err(),
            "Gemini is not connected. Connect it in Settings first."
        );
    }
}
