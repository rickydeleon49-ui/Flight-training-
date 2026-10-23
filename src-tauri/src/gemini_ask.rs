//! Interactive Gemini question-and-answer assistant for flight-training study.
//!
//! Unlike study aids and practice tests, this is an interactive query (short budget,
//! not journaled, chats are not saved to disk). It reuses the same prepared PDF
//! caching and retry infrastructure from `gemini.rs`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::gemini::{
    extract_text, generate_with_retries_at, generation_client, load_choice, prepare_submission,
    prepared_sources, run_generation, stored_key, GenContext, LoadedSource,
};
use crate::gemini_budget::Budget;
use crate::gemini_cancel::{CancelToken, Cancellable};
use crate::gemini_files::{self, GOOGLE_BASE};
use crate::storage;

const ASK_PROGRESS_EVENT: &str = "ask-gemini-progress";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AskProgress {
    request_id: String,
    message: String,
}

fn progress_reporter<'a>(
    request_id: &'a str,
    emit: &'a (dyn Fn(AskProgress) + Sync),
) -> impl Fn(String) + Sync + 'a {
    move |message| {
        emit(AskProgress {
            request_id: request_id.to_string(),
            message,
        });
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("The question request was not recognised. Try asking again.".into());
    }
    Ok(())
}

// Asks are transient, with no journal or stored-data changes. Keep their tokens
// separate from durable generation jobs, even if a caller reuses a job id.
static RUNNING_ASKS: Mutex<Option<HashMap<String, Arc<CancelToken>>>> = Mutex::new(None);

struct AskRegistration {
    request_id: String,
    token: Arc<CancelToken>,
}

impl AskRegistration {
    fn register(request_id: &str, budget: &Budget) -> Result<Self, String> {
        validate_request_id(request_id)?;
        let token = Arc::new(CancelToken::default());
        let mut running = RUNNING_ASKS.lock().unwrap_or_else(|e| e.into_inner());
        let asks = running.get_or_insert_with(HashMap::new);
        if asks.contains_key(request_id) {
            return Err("This question is already being asked.".into());
        }
        asks.insert(request_id.to_string(), token.clone());
        let admission = token.clone();
        budget.attach_admission(Arc::new(move || !admission.is_cancelled()));
        Ok(Self {
            request_id: request_id.to_string(),
            token,
        })
    }

    // Wrap preparation as well as generation: cancellation drops HTTP work and
    // releases only this ask's lease. It never invalidates the shared PDF cache.
    async fn run<T>(
        &self,
        work: impl Future<Output = Result<T, String>>,
    ) -> Result<Option<T>, String> {
        match Cancellable::new(work, self.token.clone()).await {
            Ok(result) => result.map(Some),
            Err(_) => Ok(None),
        }
    }
}

impl Drop for AskRegistration {
    fn drop(&mut self) {
        if let Some(asks) = RUNNING_ASKS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            asks.remove(&self.request_id);
        }
    }
}

#[tauri::command]
pub fn cancel_ask_gemini(request_id: String) -> Result<(), String> {
    validate_request_id(&request_id)?;
    let token = RUNNING_ASKS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|asks| asks.get(&request_id).cloned());
    if let Some(token) = token {
        token.cancel();
    }
    Ok(())
}

pub const ASK_INSTRUCTION: &str =
    "You are a patient flight-training study helper for a student pilot. \
     Answer from the attached PDF and the given context; say plainly when the PDF does not cover it. \
     Cite PDF page numbers you used. Keep it short and clear. \
     Give a focused answer of about 300 words at most. If the topic needs more, cover the most important points \
     and end by offering to go deeper on a part she names. \
     This is a study aid; remind her to check FAA guidance and her instructor for anything operational. \
     Write plain text with no Markdown: no asterisks or headings; separate paragraphs with a blank line.";

pub const ASK_GEMINI_BUDGET: Duration = Duration::from_secs(300);

pub const MAX_CONTEXT_CHARS: usize = 8000;
pub const MAX_QUESTION_CHARS: usize = 1000;
pub const MAX_HISTORY_TURNS: usize = 6;
pub const MAX_HISTORY_TURN_CHARS: usize = 2000;
pub const MAX_ANSWER_CHARS: usize = 12000;

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

pub fn validate_history(history: &[AskHistoryTurn]) -> Vec<AskHistoryTurn> {
    let turns = if history.len() > MAX_HISTORY_TURNS {
        &history[history.len() - MAX_HISTORY_TURNS..]
    } else {
        history
    };
    turns
        .iter()
        .map(|turn| {
            let text = if turn.text.chars().count() > MAX_HISTORY_TURN_CHARS {
                let mut text: String = turn.text.chars().take(MAX_HISTORY_TURN_CHARS - 1).collect();
                text.push('…');
                text
            } else {
                turn.text.clone()
            };
            AskHistoryTurn {
                role: turn.role.clone(),
                text,
            }
        })
        .collect()
}

/// Gemini sometimes escapes line breaks twice or adds Markdown emphasis even
/// when asked for plain text; the answer is shown as plain text, so both are
/// turned back into what she should read.
fn plain_answer(raw: &str) -> String {
    raw.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\t", " ")
        .replace("**", "")
        .replace("__", "")
        .trim()
        .to_string()
}

fn shorten_answer(answer: String) -> String {
    if answer.chars().count() <= MAX_ANSWER_CHARS {
        return answer;
    }

    // Include the blank line before the notice in the character budget.
    let prefix: String = answer.chars().take(MAX_ANSWER_CHARS - 2).collect();
    // A break in the first half would throw most of the answer away.
    let half = prefix.len() / 2;
    let end = prefix
        .rfind("\n\n")
        .filter(|&end| end >= half)
        .or_else(|| {
            prefix
                .char_indices()
                .rev()
                .find_map(|(index, ch)| {
                    let end = index + ch.len_utf8();
                    let sentence_end = matches!(ch, '。' | '！' | '？')
                        || (matches!(ch, '.' | '!' | '?')
                            && (end == prefix.len()
                                || prefix[end..].starts_with(char::is_whitespace)));
                    sentence_end.then_some(end)
                })
                .filter(|&end| end >= half)
        })
        .unwrap_or(prefix.len());
    format!(
        "{}\n\n(Answer shortened. Ask a follow-up for more.)",
        prefix[..end].trim_end()
    )
}

pub fn parse_and_validate_answer(
    text: &str,
    pdf_page_count: Option<u32>,
) -> Result<AskAnswer, String> {
    let parsed: RawAskResponse = serde_json::from_str(text)
        .map_err(|_| "Gemini did not return a usable answer. Try asking again.".to_string())?;

    let answer = plain_answer(&parsed.answer);
    if answer.is_empty() {
        return Err("Gemini did not return an answer. Try asking again.".to_string());
    }
    let answer = shorten_answer(answer);

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
    let valid_history = validate_history(history);

    let (raw, _model) = if let Some(src) = source {
        let build = |part: Value| build_ask_request(Some(part), context, &valid_history, question);
        run_generation(ctx, src, &build).await?
    } else {
        let body = build_ask_request(None, context, &valid_history, question);
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
    request_id: String,
    relative_path: Option<String>,
    material_id: String,
    context: String,
    question: String,
    history: Vec<AskHistoryTurn>,
) -> Result<Option<AskAnswer>, String> {
    validate_request_id(&request_id)?;
    let _ = &material_id;
    validate_question(&question)?;
    validate_context(&context)?;

    let budget = Budget::new(ASK_GEMINI_BUDGET);
    let registration = AskRegistration::register(&request_id, &budget)?;
    registration
        .run(async {
            // Recorded before the key is read, as every generation does, so a
            // disconnect or key change during this question makes it stale.
            let epoch = prepared_sources().epoch();

            let (api_key, source, page_count) = if let Some(rel_path) =
                relative_path.as_deref().filter(|p| !p.trim().is_empty())
            {
                let (api_key, source) = budget
                    .run(prepare_submission(&app, rel_path))
                    .await
                    .map_err(|_| gemini_files::out_of_time(&budget, "preparing the document"))??;
                let page_count = source.page_count;
                (api_key, Some(source), page_count)
            } else {
                let api_key = stored_key(&app)?;
                (api_key, None, None)
            };

            let root = storage::app_root(&app)?;
            let choice = load_choice(&root);
            let http = generation_client()?;
            let emit = |progress| {
                let _ = app.emit(ASK_PROGRESS_EVENT, progress);
            };
            let say = progress_reporter(&request_id, &emit);
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
                &history,
            )
            .await
        })
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

    fn answer_body() -> String {
        json!({"candidates": [{"content": {"parts": [{"text":
            json!({"answer": "A synthetic answer.", "sourcePages": [1]}).to_string()
        }]}}]})
        .to_string()
    }

    #[test]
    fn ask_progress_emitter_preserves_every_message_and_serializes_request_id() {
        let events = Mutex::new(Vec::new());
        let emit = |event| events.lock().unwrap().push(event);
        let say = progress_reporter("ask-emitter-test", &emit);
        for message in [
            "Preparing this PDF…",
            "Gemini is busy, trying again…",
            "Trying the backup Gemini model…",
        ] {
            say(message.into());
        }
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 3);
        for (event, message) in events.iter().zip([
            "Preparing this PDF…",
            "Gemini is busy, trying again…",
            "Trying the backup Gemini model…",
        ]) {
            assert_eq!(
                serde_json::to_value(event).unwrap(),
                json!({
                    "requestId": "ask-emitter-test", "message": message,
                })
            );
        }
    }

    #[test]
    fn ask_cancellation_drops_pending_work_and_keeps_other_requests_running() {
        use std::sync::atomic::AtomicBool;
        use std::task::{Context, Poll, Waker};

        struct DropFlag(Arc<AtomicBool>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let budget = Budget::new(ASK_GEMINI_BUDGET);
        let registration = AskRegistration::register("ask-pending-test", &budget).unwrap();
        let other_budget = Budget::new(ASK_GEMINI_BUDGET);
        let other = AskRegistration::register("ask-unrelated-test", &other_budget).unwrap();
        let dropped = Arc::new(AtomicBool::new(false));
        let flag = DropFlag(dropped.clone());
        let mut work = Box::pin(registration.run(async move {
            let _flag = flag;
            std::future::pending::<Result<(), String>>().await
        }));
        let mut cx = Context::from_waker(Waker::noop());
        assert!(work.as_mut().poll(&mut cx).is_pending());
        cancel_ask_gemini("ask-pending-test".into()).unwrap();
        assert_eq!(work.as_mut().poll(&mut cx), Poll::Ready(Ok(None)));
        assert!(dropped.load(Ordering::SeqCst), "in-flight work is dropped");
        assert!(!budget.can_continue(), "no later request may be sent");
        assert!(other_budget.can_continue());
        assert!(!other.token.is_cancelled());
    }

    #[test]
    fn ask_progress_forwards_retry_and_fallback_wording_with_request_id() {
        let rig = test_rig();
        rig.fake.behave(|b| {
            b.generate_statuses = vec![(503, "busy".into()), (503, "busy".into())];
            b.generate_retry_after = Some("0".into());
            // Queued answers follow statuses; generate_answer overrides them.
            b.generate_answers = vec![answer_body()];
        });
        let (budget, _) = crate::gemini_budget::testing::fake_budget(ASK_GEMINI_BUDGET);
        let registration = AskRegistration::register("ask-progress-test", &budget).unwrap();
        let events = Mutex::new(Vec::new());
        let emit = |event| events.lock().unwrap().push(event);
        let say = progress_reporter("ask-progress-test", &emit);
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
        let result = tauri::async_runtime::block_on(registration.run(ask_gemini_with(
            &ctx,
            None,
            None,
            "",
            "Why?",
            &[],
        )))
        .unwrap()
        .unwrap();
        assert_eq!(result.answer, "A synthetic answer.");
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 3, "two waits and the fallback notice");
        assert!(events.iter().all(|e| e.request_id == "ask-progress-test"));
        assert_eq!(events[0].message, "Gemini is busy or rate-limited. Waiting 0 seconds, then trying again — attempt 2 of 3.");
        assert_eq!(events[1].message, "Gemini is busy or rate-limited. Waiting 0 seconds, then trying again — attempt 3 of 3.");
        assert_eq!(events[2].message, "Trying the backup Gemini model…");
        assert_eq!(
            serde_json::to_value(&events[0]).unwrap()["requestId"],
            "ask-progress-test"
        );
    }

    #[test]
    fn cancelled_ask_stops_before_next_attempt_and_preserves_shared_pdf() {
        let rig = test_rig();
        rig.fake.behave(|b| {
            b.enforce_files = true;
            b.generate_statuses = vec![(503, "busy".into())];
            b.generate_retry_after = Some("0".into());
            // Leave an answer for a forbidden retry and the other job's ask.
            b.generate_answers = vec![answer_body()];
        });
        let source = LoadedSource::new(synthetic_pdf(5), "application/pdf", "documents/shared.pdf");
        let other_budget = Budget::new(ASK_GEMINI_BUDGET);
        let quiet = |_| ();
        let other_lease = tauri::async_runtime::block_on(rig.cache.prepare(
            &rig.http,
            &rig.fake.base,
            KEY,
            &crate::gemini_files::Source {
                bytes: &source.bytes,
                content_sha256: &source.content_sha256,
                mime: source.mime,
                scope: &source.scope,
            },
            rig.cache.epoch(),
            None,
            &other_budget,
            &quiet,
        ))
        .unwrap();
        let (budget, _) = crate::gemini_budget::testing::fake_budget(ASK_GEMINI_BUDGET);
        let registration = AskRegistration::register("ask-cancel-shared-test", &budget).unwrap();
        let say = |message: String| {
            if message.contains("trying again") {
                cancel_ask_gemini("ask-cancel-shared-test".into()).unwrap();
            }
        };
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
        let result = tauri::async_runtime::block_on(registration.run(ask_gemini_with(
            &ctx,
            Some(&source),
            Some(5),
            "",
            "Why?",
            &[],
        )))
        .unwrap();
        assert_eq!(result, None, "cancellation ends quietly");
        assert_eq!(rig.fake.count(|r| r.is_generate()), 1, "no next attempt");
        assert_eq!(rig.fake.count(|r| r.is_delete()), 0);
        assert!(other_lease.is_current());
        let other_ctx = GenContext {
            budget: &other_budget,
            say: &quiet,
            ..ctx
        };
        let answer = tauri::async_runtime::block_on(ask_gemini_with(
            &other_ctx,
            Some(&source),
            Some(5),
            "",
            "Another job's question",
            &[],
        ))
        .unwrap();
        assert_eq!(answer.answer, "A synthetic answer.");
        assert_eq!(
            rig.fake.count(|r| r.is_upload_start()),
            1,
            "the prepared PDF was reused"
        );
        assert_eq!(rig.fake.count(|r| r.is_generate()), 2);
        assert_eq!(rig.fake.count(|r| r.is_delete()), 0);
    }

    #[test]
    fn ask_request_ids_are_validated_before_registration_and_cancellation() {
        let budget = Budget::new(ASK_GEMINI_BUDGET);
        for id in [
            "".into(),
            "a".repeat(65),
            "ask_id".into(),
            "ask id".into(),
            "ask/id".into(),
            "é".into(),
            "a\n".into(),
        ] {
            assert!(AskRegistration::register(&id, &budget).is_err(), "{id:?}");
            assert!(cancel_ask_gemini(id.clone()).is_err(), "{id:?}");
        }
        for id in ["A-z09".into(), "a".repeat(64)] {
            let registered = AskRegistration::register(&id, &budget).unwrap();
            assert!(
                AskRegistration::register(&id, &budget).is_err(),
                "no token replacement"
            );
            cancel_ask_gemini(id.clone()).unwrap();
            assert!(registered.token.is_cancelled());
            drop(registered);
            let next = AskRegistration::register(&id, &budget).unwrap();
            assert!(!next.token.is_cancelled(), "finished requests are removed");
        }
        cancel_ask_gemini("already-finished".into()).unwrap();
    }

    #[test]
    fn ask_instruction_requests_a_focused_answer_and_a_follow_up() {
        assert!(ASK_INSTRUCTION.contains("focused answer of about 300 words at most"));
        assert!(ASK_INSTRUCTION.contains("cover the most important points"));
        assert!(ASK_INSTRUCTION.contains("end by offering to go deeper on a part she names"));
        assert!(ASK_INSTRUCTION.contains("Cite PDF page numbers"));
        assert!(ASK_INSTRUCTION.contains("check FAA guidance and her instructor"));
        assert!(ASK_INSTRUCTION.contains("Write plain text with no Markdown"));
        let request = build_ask_request(None, "", &[], "Explain in detail, step by step.");
        assert_eq!(request["contents"][0]["parts"][0]["text"], ASK_INSTRUCTION);
        assert_eq!(request["generationConfig"]["maxOutputTokens"], 4096);
    }

    #[test]
    fn long_answer_uses_the_last_paragraph_break_and_preserves_pages() {
        let first = format!("{}.", "a".repeat(6500));
        let second = format!("{}.", "b".repeat(5000));
        let tail = format!("{}? {}", "c".repeat(100), "d".repeat(8392));
        let raw = format!("{first}\n\n{second}\n\n{tail}");
        assert_eq!(raw.chars().count(), 20000);
        let response = json!({"answer": raw, "sourcePages": [4, 2, 2, 0, 6]});
        let result = parse_and_validate_answer(&response.to_string(), Some(5)).unwrap();
        let notice = "(Answer shortened. Ask a follow-up for more.)";
        assert_eq!(result.answer, format!("{first}\n\n{second}\n\n{notice}"));
        assert!(result.answer.ends_with(notice));
        assert!(result.answer.chars().count() <= 12000 + notice.chars().count());
        assert_eq!(result.source_pages, vec![2, 4]);
    }

    #[test]
    fn an_early_paragraph_break_does_not_throw_the_answer_away() {
        let raw = format!("Intro.\n\n{}. {}", "a".repeat(11000), "b".repeat(8990));
        let result = parse_and_validate_answer(&json!({"answer": raw}).to_string(), None).unwrap();
        assert!(result.answer.chars().count() > 11000);
        assert!(result
            .answer
            .ends_with("(Answer shortened. Ask a follow-up for more.)"));
    }

    #[test]
    fn long_answer_without_paragraphs_uses_the_last_sentence_end() {
        let first = format!("{}.", "a".repeat(6500));
        let second = format!("{}?", "b".repeat(5000));
        let raw = format!("{first} {second} {}", "c".repeat(8496));
        assert_eq!(raw.chars().count(), 20000);
        let response = json!({"answer": raw});
        let result = parse_and_validate_answer(&response.to_string(), None).unwrap();
        assert_eq!(
            result.answer,
            format!("{first} {second}\n\n(Answer shortened. Ask a follow-up for more.)")
        );
    }

    #[test]
    fn long_multibyte_answer_uses_a_unicode_sentence_boundary() {
        let sentence = format!("{}。", "航".repeat(7999));
        let raw = format!("{sentence}{}", "🛩".repeat(12000));
        assert_eq!(raw.chars().count(), 20000);
        let response = json!({"answer": raw});
        let result = parse_and_validate_answer(&response.to_string(), None).unwrap();
        assert_eq!(
            result.answer,
            format!("{sentence}\n\n(Answer shortened. Ask a follow-up for more.)")
        );
    }

    #[test]
    fn long_multibyte_answer_without_boundaries_has_a_char_safe_fallback() {
        let response = json!({"answer": "é🛩航".repeat(6667)});
        let result = parse_and_validate_answer(&response.to_string(), None).unwrap();
        let expected: String = "é🛩航".repeat(6667).chars().take(11998).collect();
        let notice = "(Answer shortened. Ask a follow-up for more.)";
        assert_eq!(result.answer, format!("{expected}\n\n{notice}"));
        assert_eq!(
            result.answer.chars().count(),
            12000 + notice.chars().count()
        );
    }

    #[test]
    fn normal_answers_through_the_new_limit_are_unchanged() {
        for answer in [
            "Check page 2.\n\nThis is a study aid.".to_string(),
            "é".repeat(7000),
            "航".repeat(12000),
        ] {
            let response = json!({"answer": answer, "sourcePages": [2]});
            let result = parse_and_validate_answer(&response.to_string(), Some(5)).unwrap();
            assert_eq!(result.answer, answer);
            assert_eq!(result.source_pages, vec![2]);
        }
    }

    #[test]
    fn a_full_length_model_answer_can_be_sent_as_history() {
        let answer = "航".repeat(MAX_ANSWER_CHARS);
        let history = validate_history(&[AskHistoryTurn {
            role: "model".into(),
            text: answer.clone(),
        }]);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].role, "model");
        assert_eq!(history[0].text.chars().count(), MAX_HISTORY_TURN_CHARS);
        assert_eq!(history[0].text, format!("{}…", "航".repeat(1999)));
        let request = build_ask_request(None, "", &history, "Why?");
        let prior = request["contents"][0]["parts"][1]["text"].as_str().unwrap();
        assert_eq!(
            prior,
            format!("Prior conversation:\nHelper: {}", history[0].text)
        );
        assert_eq!(answer.chars().count(), 12000);
    }

    #[test]
    fn history_accepts_any_turn_length_and_keeps_the_last_six() {
        let turns: Vec<_> = [0, 1, 1999, 2000, 2001, 6000, 20000, 100000]
            .into_iter()
            .enumerate()
            .map(|(index, length)| AskHistoryTurn {
                role: index.to_string(),
                text: "é".repeat(length),
            })
            .collect();
        for turn in &turns {
            let bounded = validate_history(std::slice::from_ref(turn));
            assert_eq!(bounded.len(), 1);
            assert!(bounded[0].text.chars().count() <= 2000);
            if turn.text.chars().count() <= 2000 {
                assert_eq!(&bounded[0], turn);
            } else {
                assert!(bounded[0].text.ends_with('…'));
            }
        }
        let bounded = validate_history(&turns);
        assert_eq!(bounded.len(), 6);
        assert_eq!(bounded[0].role, "2");
        assert_eq!(bounded[5].role, "7");
        assert!(validate_history(&[]).is_empty());
    }

    #[test]
    fn ask_budget_includes_five_minutes_for_preparation_and_answering() {
        assert_eq!(ASK_GEMINI_BUDGET, Duration::from_secs(300));
    }

    #[test]
    fn answers_lose_escaped_line_breaks_and_markdown_emphasis() {
        let text = r#"{"answer":"Two kinds:\\n\\n1. **Power-off** stall.\\n2. __Power-on__ stall.","sourcePages":[2]}"#;
        let answer = parse_and_validate_answer(text, Some(5)).unwrap();
        assert_eq!(
            answer.answer,
            "Two kinds:\n\n1. Power-off stall.\n2. Power-on stall."
        );
        assert_eq!(answer.source_pages, vec![2]);
    }

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
