//! Gemini connection and document analysis.
//!
//! The user supplies her own Google AI Studio key. It is kept in a file beside
//! her other data — see `secrets` for why it is not in the operating system's
//! credential manager any more — and never returned to JavaScript.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::documents;
use crate::pdf;
use crate::secrets;
use crate::storage::app_root;

/// Where the key used to be kept. Retained only long enough to move an
/// existing key across; once no one is upgrading from 0.3.0 or earlier this
/// and the `keyring` dependency can go.
const LEGACY_SERVICE: &str = "com.herflightdeck.app";
const LEGACY_ACCOUNT: &str = "gemini-api-key";
/// The model her key is checked against and her documents are sent to.
///
/// Pinned deliberately rather than using a `-latest` alias: those are
/// hot-swapped under you and have themselves resolved to a retired model.
/// Google publishes shutdown dates for individual models, so its support
/// status is checked against the official model documentation before release.
const MODEL: &str = "gemini-3.5-flash";

/// Where a request goes when the model above is too busy to answer.
///
/// A 503 is Google's capacity, not her key and not her file, and it is
/// usually specific to one model — so an overloaded current model is worth
/// one attempt on the lighter stable model before giving up. Its
/// support status is checked before each release exactly like `MODEL`.
const FALLBACK_MODEL: &str = "gemini-3.5-flash-lite";

/* ------------------------------------------------------------------ */
/* What Google will accept                                             */
/* ------------------------------------------------------------------ */

/// Google reads a PDF up to 50 MB **or** 1,000 pages, whichever comes first,
/// and that ceiling is the same whether the bytes are sent inline or uploaded
/// first. It is Google's limit rather than one this application chose, so
/// raising the number here would only turn a clear message into a rejected
/// request and a confusing error from Google.
const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024;

/// Everything else rides the inline request cap, which Google raised from
/// 20 MB to 100 MB in January 2026.
const MAX_INLINE_BYTES: u64 = 100 * 1024 * 1024;

/// Plain text runs out of context window long before it runs out of request.
/// The model reads roughly a million tokens and a megabyte of text is roughly
/// a quarter of a million of them, so four megabytes is the honest ceiling —
/// beyond it Google rejects the request for a reason she cannot act on.
const MAX_TEXT_BYTES: u64 = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Waiting out a busy model                                            */
/* ------------------------------------------------------------------ */

/// How many times one model is asked before moving on.
const MAX_ATTEMPTS: u32 = 4;
/// The first pause between attempts. Each one after it doubles.
const FIRST_BACKOFF_MS: u64 = 1_500;
/// However many attempts have failed, no single pause is longer than this.
const MAX_BACKOFF_MS: u64 = 12_000;

/// Checking a key is one small round trip; it should never hang the dialog.
const VERIFY_TIMEOUT: Duration = Duration::from_secs(30);
/// Generating reads a whole document, so it is given room — but not forever.
/// Without a bound, a stalled connection leaves "Creating study aid…" spinning
/// with nothing to cancel it.
const GENERATE_TIMEOUT: Duration = Duration::from_secs(300);

fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Could not start the connection to Gemini: {e}"))
}

/// Say plainly which failures are worth waiting out and which are not.
fn describe_transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "Gemini did not answer in time. Check the internet connection and try again.".to_string()
    } else if error.is_connect() {
        "Could not reach Gemini. Check the internet connection and try again.".to_string()
    } else {
        format!("Could not reach Gemini: {error}")
    }
}

/// Which failures are worth waiting out.
///
/// Google's troubleshooting guidance calls 429 (rate limiting) and transient
/// 5xx failures retryable. Attempts and pauses are bounded below; other 4xx
/// responses indicate a request or authorization problem.
fn is_retryable(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504)
}

/// A few milliseconds of noise, so retries do not march in lockstep.
///
/// Derived from the clock rather than a random-number crate: this needs to be
/// unpredictable enough to spread two attempts apart, which is a much smaller
/// ask than randomness.
fn jitter_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| u64::from(since.subsec_millis()))
        .unwrap_or(0)
}

/// How long to wait before attempt `attempt + 1`, doubling and then capped.
///
/// Google's answer to an overloaded model is to wait and try again, so the
/// pauses grow: roughly 1.5s, 3s, 6s. The jitter is added on top, up to a
/// quarter of the wait, so a retry never lands on exactly the busy moment
/// another one is aiming at.
fn backoff_delay(attempt: u32, jitter: u64) -> Duration {
    let base = FIRST_BACKOFF_MS
        .saturating_mul(1u64 << attempt.min(16))
        .min(MAX_BACKOFF_MS);
    Duration::from_millis(base + jitter % (base / 4 + 1))
}

/// The largest this kind of file may be, and what to do when it is larger.
///
/// The limits are Google's, not ours — see the constants. Saying which limit
/// was hit, and what would get her unstuck, is the difference between a dead
/// end and a next step.
fn check_size(mime: &str, bytes: u64) -> Result<(), String> {
    let (limit, advice) = match mime {
        "application/pdf" => (
            MAX_PDF_BYTES,
            "Google reads a PDF up to 50 MB or 1,000 pages, whichever comes first. \
             Split the handbook and add the chapter you are studying as its own file — \
             a study aid from one chapter is more useful than one from the whole book anyway.",
        ),
        "text/plain" => (
            MAX_TEXT_BYTES,
            "A text file this size is more than the model can hold in mind at once. \
             Add the part you are studying as its own file.",
        ),
        _ => (
            MAX_INLINE_BYTES,
            "Save it at a smaller size, or add the page you are studying on its own.",
        ),
    };

    if bytes <= limit {
        return Ok(());
    }
    Err(format!(
        "That file is {}, over the {} limit for this kind of file. {advice}",
        describe_size(bytes),
        describe_size(limit),
    ))
}

/// Whether a PDF is short enough for Google to read.
///
/// Google's PDF limit is 50 MB **or** 1,000 pages, whichever comes first, and
/// a handbook reaches the page limit long before the size one — a 900-page
/// PHAK is well under 50 MB. Checking only the bytes let those through to be
/// refused by Google after the whole upload, with an error she could not act
/// on. The page limit is `pdf::MAX_PAGES`, the same number the split tool
/// holds a chapter to.
fn check_page_count(pages: u32) -> Result<(), String> {
    if pages <= pdf::MAX_PAGES {
        return Ok(());
    }
    Err(format!(
        "That PDF is {pages} pages, over the {} Google reads at a time. Take out the chapter \
         you are studying and make the study aid from that — a study aid from one chapter is \
         more useful than one from the whole book anyway.",
        pdf::MAX_PAGES
    ))
}

/// Count a stored PDF's pages and hold it to Google's limit.
///
/// A PDF this application cannot parse is let through rather than stopped:
/// its length is unknown, not known to be too great, and Google may well read
/// it. Refusing on a failed count would be inventing a reason to say no.
async fn check_pdf_length(path: &Path) -> Result<(), String> {
    match pdf::count_pages(path.to_path_buf()).await {
        Ok(pages) => check_page_count(pages),
        Err(_) => Ok(()),
    }
}

/// Bytes as she would say them: "62 MB", not "65,011,712 bytes".
pub(crate) fn describe_size(bytes: u64) -> String {
    const MB: u64 = 1024 * 1024;
    if bytes >= MB {
        format!("{} MB", bytes.div_ceil(MB))
    } else {
        format!("{} KB", bytes.div_ceil(1024).max(1))
    }
}

/// Sent to the interface while a request is being waited out.
///
/// Without it, four retries and a standby attempt are a silent half-minute
/// under "Gemini is reviewing this document" — which reads as a hang. The
/// sentence is written here, beside the logic that knows what is happening.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiProgress {
    message: String,
}

/// The event the Study Library listens for.
const PROGRESS_EVENT: &str = "gemini-progress";

fn say(app: &AppHandle, message: String) {
    // Progress is a courtesy. A window that will not take it changes nothing
    // about whether the study aid arrives.
    let _ = app.emit(PROGRESS_EVENT, GeminiProgress { message });
}

/// What Google said when it would not produce a study aid.
enum Attempt {
    /// The response body, ready to be parsed.
    Answered(String),
    /// Google replied, but not with a result.
    Refused { status: u16, body: String },
}

/// Whether this run has already looked in the old credential manager.
static LEGACY_CHECKED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiStatus {
    configured: bool,
    model: &'static str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySection {
    heading: String,
    body: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flashcard {
    front: String,
    back: String,
    source_page: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedStudyAid {
    title: String,
    summary: String,
    sections: Vec<StudySection>,
    flashcards: Vec<Flashcard>,
    source_notes: String,
    #[serde(default)]
    model: String,
}

/// Move a key out of the operating system's credential manager, once.
///
/// On macOS this usually fails after an update — an unsigned application is a
/// different application to the keychain every time it is rebuilt, which is
/// the whole reason the key moved. When the keychain does still release it,
/// she is spared pasting the key one last time.
fn migrate_legacy_key(root: &Path) -> Option<String> {
    // Ask the credential manager at most once per run. On macOS an item it
    // refuses can raise a system prompt, and reaching for it on every status
    // check would pester her about a key she may have disconnected on purpose.
    if LEGACY_CHECKED.swap(true, Ordering::SeqCst) {
        return None;
    }
    let entry = Entry::new(LEGACY_SERVICE, LEGACY_ACCOUNT).ok()?;
    let found = entry.get_password().ok()?;
    let key = found.trim();
    if key.is_empty() {
        return None;
    }
    secrets::save_key(root, key).ok()?;
    // Best effort: the same signature check that blocks reading blocks this.
    let _ = entry.delete_credential();
    Some(key.to_string())
}

/// The key she has connected, if there is one.
///
/// `Ok(None)` means none is stored. That is deliberately distinct from an
/// error, so a folder we cannot read never again looks like a key she never
/// entered.
fn current_key(root: &Path) -> Result<Option<String>, String> {
    if let Some(key) = secrets::load_key(root)? {
        return Ok(Some(key));
    }
    Ok(migrate_legacy_key(root))
}

fn stored_key(app: &AppHandle) -> Result<String, String> {
    current_key(&app_root(app)?)?
        .ok_or_else(|| "Gemini is not connected. Connect it in Settings first.".to_string())
}

async fn verify_key(api_key: &str) -> Result<(), String> {
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{MODEL}");
    let http = client(VERIFY_TIMEOUT)?;

    // A busy model must not read as a bad key. Connecting is the one moment
    // she has no way to tell those apart, so an overload is waited out here
    // rather than reported as something wrong with what she pasted.
    let mut response = http
        .get(&url)
        .header("x-goog-api-key", api_key)
        .send()
        .await
        .map_err(|e| describe_transport_error(&e))?;
    for attempt in 0..MAX_ATTEMPTS {
        if !is_retryable(response.status().as_u16()) || attempt + 1 == MAX_ATTEMPTS {
            break;
        }
        tokio::time::sleep(backoff_delay(attempt, jitter_millis())).await;
        response = http
            .get(&url)
            .header("x-goog-api-key", api_key)
            .send()
            .await
            .map_err(|e| describe_transport_error(&e))?;
    }

    if response.status().is_success() {
        return Ok(());
    }

    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    Err(describe_refusal(
        RefusalContext::Verification,
        status.as_u16(),
        &detail,
        MODEL,
    ))
}

fn compact_error(raw: &str) -> String {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "The request could not be completed.".to_string())
}

#[tauri::command]
pub fn gemini_status(app: AppHandle) -> GeminiStatus {
    GeminiStatus {
        configured: app_root(&app)
            .and_then(|root| current_key(&root))
            .ok()
            .flatten()
            .is_some(),
        model: MODEL,
    }
}

#[tauri::command]
pub async fn configure_gemini(app: AppHandle, api_key: String) -> Result<GeminiStatus, String> {
    let trimmed = api_key.trim();
    if trimmed.len() < 20 {
        return Err("Paste the complete Gemini API key from Google AI Studio.".to_string());
    }
    verify_key(trimmed).await?;
    secrets::save_key(&app_root(&app)?, trimmed)?;
    Ok(GeminiStatus {
        configured: true,
        model: MODEL,
    })
}

#[tauri::command]
pub fn disconnect_gemini(app: AppHandle) -> Result<GeminiStatus, String> {
    secrets::forget_key(&app_root(&app)?)?;
    // Clear anything still sitting in the old credential manager as well, so
    // disconnecting really does leave no key behind. Best effort: on macOS an
    // updated build is usually refused access to its predecessor's item.
    if let Ok(entry) = Entry::new(LEGACY_SERVICE, LEGACY_ACCOUNT) {
        let _ = entry.delete_credential();
    }
    Ok(GeminiStatus {
        configured: false,
        model: MODEL,
    })
}

fn mime_type(file_name: &str) -> Result<&'static str, String> {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".pdf") {
        Ok("application/pdf")
    } else if lower.ends_with(".png") {
        Ok("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Ok("image/jpeg")
    } else if lower.ends_with(".webp") {
        Ok("image/webp")
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        Ok("text/plain")
    } else {
        Err("Gemini study tools currently support PDF, TXT, Markdown, PNG, JPG, and WebP files. Convert this file to PDF first.".to_string())
    }
}

/// What one Gemini submission needs: her key, and the one file she chose,
/// validated against Google's document limits before a single byte leaves
/// this computer.
///
/// Both `generate_study_aid` and `generate_practice_test` read the same
/// stored document through this, so "Gemini reads only the selected study
/// document" is one guarded path rather than two copies that could drift.
async fn prepare_submission(
    app: &AppHandle,
    relative_path: &str,
) -> Result<(String, Vec<u8>, &'static str), String> {
    let api_key = stored_key(app)?;
    let path = documents::stored_document_path(app, relative_path)?;
    let metadata = std::fs::metadata(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "This study file is missing from app storage. Restore or re-attach the file before generating.".to_string()
        } else {
            format!("Could not read that study file: {e}")
        }
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    let mime = mime_type(file_name)?;
    check_size(mime, metadata.len())?;
    // Size is only half of Google's PDF limit; the other half is pages.
    if mime == "application/pdf" {
        check_pdf_length(&path).await?;
    }
    let bytes = std::fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "This study file is missing from app storage. Restore or re-attach the file before generating.".to_string()
        } else {
            format!("Could not read that study file: {e}")
        }
    })?;
    Ok((api_key, bytes, mime))
}

#[tauri::command]
pub async fn generate_study_aid(
    app: AppHandle,
    relative_path: String,
) -> Result<GeneratedStudyAid, String> {
    let (api_key, bytes, mime) = prepare_submission(&app, &relative_path).await?;

    let prompt =
        "Create an accurate private-pilot study aid from the attached source. \
         Use only facts supported by the source. Do not invent regulations, procedures, numbers, or page references. \
         Return JSON only with: title (string), summary (string), sections (array of objects with heading and body), \
         flashcards (10-20 objects with front, back, and sourcePage as a page number or null), and sourceNotes (string). \
         Keep explanations clear for a student pilot. When the source is ambiguous or may be outdated, say so. \
         This is a study aid, not operational flight instruction; remind the learner to verify current FAA, aircraft, \
         flight-school, and instructor guidance.";

    let body = json!({
        "contents": [{"role": "user", "parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": mime, "data": BASE64.encode(bytes)}}
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "required": ["title", "summary", "sections", "flashcards", "sourceNotes"],
                "properties": {
                    "title": {"type": "STRING"},
                    "summary": {"type": "STRING"},
                    "sections": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "required": ["heading", "body"],
                            "properties": {
                                "heading": {"type": "STRING"},
                                "body": {"type": "STRING"}
                            }
                        }
                    },
                    "flashcards": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "required": ["front", "back", "sourcePage"],
                            "properties": {
                                "front": {"type": "STRING"},
                                "back": {"type": "STRING"},
                                "sourcePage": {"type": "INTEGER", "nullable": true}
                            }
                        }
                    },
                    "sourceNotes": {"type": "STRING"}
                }
            },
            "maxOutputTokens": 8192
        }
    });
    let (raw, model_used) = generate_with_retries(&app, &api_key, &body).await?;

    let envelope: Value = serde_json::from_str(&raw)
        .map_err(|_| "Gemini returned an unreadable response.".to_string())?;
    let text = envelope
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "Gemini did not return a study guide. Try the document again.".to_string()
        })?;
    let mut result: GeneratedStudyAid = serde_json::from_str(text)
        .map_err(|_| "Gemini's study guide was incomplete. Try generating it again.".to_string())?;
    result.model = model_used.to_string();
    Ok(result)
}

/// Pull the model's actual answer out of Gemini's response envelope.
///
/// Shared by every kind of generation this application asks Gemini for, so a
/// malformed envelope is refused the same way regardless of what was asked.
fn extract_text(raw: &str) -> Result<String, String> {
    let envelope: Value = serde_json::from_str(raw)
        .map_err(|_| "Gemini returned an unreadable response.".to_string())?;
    envelope
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Gemini did not return a usable answer. Try the document again.".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeQuestion {
    question: String,
    options: Vec<String>,
    correct_index: u32,
    explanation: String,
    source_page: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPracticeTest {
    title: String,
    questions: Vec<PracticeQuestion>,
    #[serde(default)]
    model: String,
}

/// Keep only the questions a quiz screen can actually render safely.
///
/// Gemini's response schema below already asks for well-shaped questions, but
/// a schema is a request, not a guarantee — nothing stops a returned
/// `correctIndex` from pointing past the end of its own `options`, or
/// `options` from holding fewer than two choices. Indexing either blindly in
/// the interface would be a crash over a document that is otherwise fine to
/// study from, so a malformed question is dropped rather than trusted, and
/// only the ones that are safe to render reach the caller. A response that is
/// *entirely* malformed still fails outright: an empty test would look like
/// "this document has no practice questions", which is a different claim than
/// "Gemini's answer could not be used."
fn sanitize_practice_test(
    mut test: GeneratedPracticeTest,
) -> Result<GeneratedPracticeTest, String> {
    test.questions.retain(|question| {
        !question.question.trim().is_empty()
            && !question.explanation.trim().is_empty()
            && question.options.len() >= 2
            && question
                .options
                .iter()
                .all(|option| !option.trim().is_empty())
            && (question.correct_index as usize) < question.options.len()
    });

    if test.questions.is_empty() {
        return Err(
            "Gemini's practice test did not come back usable. Try generating it again.".to_string(),
        );
    }
    Ok(test)
}

/// Create a multiple-choice practice test from the selected study document.
///
/// Reuses the exact same validated read as `generate_study_aid` — the same
/// file, checked against the same size and page limits, and nothing else —
/// so a practice test can never be generated from a document that would have
/// been refused for a study guide.
#[tauri::command]
pub async fn generate_practice_test(
    app: AppHandle,
    relative_path: String,
) -> Result<GeneratedPracticeTest, String> {
    let (api_key, bytes, mime) = prepare_submission(&app, &relative_path).await?;

    let prompt =
        "Create an accurate private-pilot practice test from the attached source. \
         Use only facts supported by the source. Do not invent regulations, procedures, numbers, or page references. \
         Return JSON only with: title (string) and questions (10-20 objects with question, options as an array of \
         3 to 5 short answer choices, correctIndex as the zero-based index into options of the single correct \
         choice, explanation, and sourcePage as a page number or null). Each question must have exactly one \
         correct option. Keep the questions clear for a student pilot studying this material. When the source is \
         ambiguous or may be outdated, say so in the explanation rather than guessing. This is a practice test, \
         not operational flight instruction; the learner must verify every answer against current FAA material, \
         aircraft documentation, and their instructor.";

    let body = json!({
        "contents": [{"role": "user", "parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": mime, "data": BASE64.encode(bytes)}}
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "required": ["title", "questions"],
                "properties": {
                    "title": {"type": "STRING"},
                    "questions": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "required": ["question", "options", "correctIndex", "explanation", "sourcePage"],
                            "properties": {
                                "question": {"type": "STRING"},
                                "options": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"}
                                },
                                "correctIndex": {"type": "INTEGER"},
                                "explanation": {"type": "STRING"},
                                "sourcePage": {"type": "INTEGER", "nullable": true}
                            }
                        }
                    }
                }
            },
            "maxOutputTokens": 8192
        }
    });
    let (raw, model_used) = generate_with_retries(&app, &api_key, &body).await?;
    let text = extract_text(&raw)?;
    let result: GeneratedPracticeTest = serde_json::from_str(&text).map_err(|_| {
        "Gemini's practice test was incomplete. Try generating it again.".to_string()
    })?;
    let mut result = sanitize_practice_test(result)?;
    result.model = model_used.to_string();
    Ok(result)
}

/// One request to one model.
async fn generate_once(
    http: &Client,
    api_key: &str,
    model: &str,
    body: &Value,
) -> Result<Attempt, String> {
    let url =
        format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
    let response = http
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(body)
        .send()
        .await
        .map_err(|e| describe_transport_error(&e))?;

    let status = response.status().as_u16();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Could not read Gemini's response: {e}"))?;

    if (200..300).contains(&status) {
        Ok(Attempt::Answered(raw))
    } else {
        Ok(Attempt::Refused { status, body: raw })
    }
}

/// Ask until Google answers, moves the problem elsewhere, or is plainly busy.
///
/// "The model is overloaded" is the single most common way this fails, and it
/// says nothing about her key, her quota or her document — Google's own
/// capacity is short for a moment. Retrying with a growing pause is the
/// documented answer, and an overload is usually specific to one model, so a
/// primary that stays busy is worth one attempt on the standby.
///
/// Returns the response body and the model that produced it.
async fn generate_with_retries(
    app: &AppHandle,
    api_key: &str,
    body: &Value,
) -> Result<(String, &'static str), String> {
    let http = client(GENERATE_TIMEOUT)?;
    let mut primary_rate_limited = false;

    for attempt in 0..MAX_ATTEMPTS {
        match generate_once(&http, api_key, MODEL, body).await? {
            Attempt::Answered(raw) => return Ok((raw, MODEL)),
            Attempt::Refused { status, body } => {
                primary_rate_limited |= status == 429;
                if !is_retryable(status) {
                    return Err(describe_refusal(
                        RefusalContext::Generation,
                        status,
                        &body,
                        MODEL,
                    ));
                }
                if attempt + 1 < MAX_ATTEMPTS {
                    let pause = backoff_delay(attempt, jitter_millis());
                    say(app, waiting_message(attempt, pause));
                    tokio::time::sleep(pause).await;
                }
            }
        }
    }

    // A model-specific rate or capacity limit may spare the backup model.
    say(app, "Trying the backup Gemini model…".to_string());
    match generate_once(&http, api_key, FALLBACK_MODEL, body).await? {
        Attempt::Answered(raw) => return Ok((raw, FALLBACK_MODEL)),
        Attempt::Refused { status, body } if !is_retryable(status) => {
            return Err(describe_refusal(
                RefusalContext::Generation,
                status,
                &body,
                FALLBACK_MODEL,
            ));
        }
        Attempt::Refused { status: 429, .. } => return Err(rate_limit_message()),
        Attempt::Refused { .. } => {}
    }

    if primary_rate_limited {
        Err(rate_limit_message())
    } else {
        Err(busy_message())
    }
}

/// What the interface says during one of the pauses.
fn waiting_message(attempt: u32, pause: Duration) -> String {
    let seconds = pause.as_millis().div_ceil(1000);
    format!(
        "Gemini is busy or rate-limited. Waiting {seconds} seconds, then trying again — attempt {} of {MAX_ATTEMPTS}.",
        attempt + 2,
    )
}

/// Said after every attempt has been made and Google is still overloaded.
fn busy_message() -> String {
    format!(
        "Google's servers are busy. Her Flight Deck tried {MAX_ATTEMPTS} times over about \
         {} seconds and then tried the backup Flash-Lite model, and Google was still at capacity. \
         This is Google's side, not your key or your document — the same file usually works \
         a few minutes later.",
        total_wait_seconds(),
    )
}

fn rate_limit_message() -> String {
    "Gemini's rate or spending limit was reached for this project. Her Flight Deck retried briefly and tried its backup model. Check the project's limits and billing in Google AI Studio, or wait and try again.".to_string()
}

/// Roughly how long the retries took, for the message above.
fn total_wait_seconds() -> u64 {
    let millis: u64 = (0..MAX_ATTEMPTS.saturating_sub(1))
        .map(|attempt| backoff_delay(attempt, 0).as_millis() as u64)
        .sum();
    millis.div_ceil(1000)
}

fn has_invalid_key_reason(raw: &str) -> bool {
    let Ok(val) = serde_json::from_str::<Value>(raw) else {
        return false;
    };
    if let Some(details) = val.pointer("/error/details").and_then(Value::as_array) {
        for item in details {
            if let Some(reason) = item.get("reason").and_then(Value::as_str) {
                if reason.eq_ignore_ascii_case("API_KEY_INVALID") {
                    return true;
                }
            }
        }
    }
    if let Some(reason) = val.pointer("/error/reason").and_then(Value::as_str) {
        if reason.eq_ignore_ascii_case("API_KEY_INVALID") {
            return true;
        }
    }
    if let Some(msg) = val.pointer("/error/message").and_then(Value::as_str) {
        if msg.contains("API_KEY_INVALID") || msg.contains("API key not valid") {
            return true;
        }
    }
    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefusalContext {
    Verification,
    Generation,
}

/// Turn a refusal Google will not reconsider into something worth reading.
fn describe_refusal(context: RefusalContext, status: u16, body: &str, model: &str) -> String {
    if has_invalid_key_reason(body) {
        return "Google did not accept that key. Check it in Google AI Studio and try again."
            .to_string();
    }
    match status {
        400 => match context {
            RefusalContext::Verification => {
                "Google rejected the connection check as invalid. Check your request or try again.".to_string()
            }
            RefusalContext::Generation => {
                "Google rejected the request as invalid. Check the document format or try a different file.".to_string()
            }
        },
        401 => {
            "Google did not accept the authentication credentials. Check your API key in Google AI Studio and try again.".to_string()
        }
        403 => {
            "Google denied project or API access. Check API key restrictions, API enablement, permissions, or project/billing configuration in Google AI Studio or Google Cloud Console.".to_string()
        }
        // Google retires a model on a published date. When that day comes this
        // build asks for something that no longer exists, and the honest answer
        // is that the application needs updating, not that her key is wrong.
        404 => format!(
            "Google has retired the {model} model this version of Her Flight Deck uses. Install the latest version and try again."
        ),
        429 => rate_limit_message(),
        500..=504 => busy_message(),
        _ => format!("Gemini returned {status}: {}", compact_error(body)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_googles_own_capacity_is_worth_waiting_out() {
        // Rate-limited, busy or briefly broken: retry briefly and boundedly.
        for status in [429, 500, 502, 503, 504] {
            assert!(is_retryable(status), "{status} should be retried");
        }
        // A retired model, a bad key or a bad request should fail immediately.
        for status in [200, 400, 401, 403, 404] {
            assert!(!is_retryable(status), "{status} should not be retried");
        }
    }

    #[test]
    fn rate_limit_error_does_not_invent_a_free_tier_or_blame_the_key() {
        let message = describe_refusal(RefusalContext::Generation, 429, "", MODEL);
        assert!(message.contains("rate or spending limit"));
        assert!(!message.contains("free Gemini"));
        assert!(!message.contains("key is invalid"));
    }

    #[test]
    fn structured_invalid_key_reason_asks_to_check_key() {
        let body = json!({
            "error": {
                "code": 400,
                "message": "API key not valid. Please pass a valid API key.",
                "status": "INVALID_ARGUMENT",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                        "reason": "API_KEY_INVALID",
                        "domain": "googleapis.com"
                    }
                ]
            }
        })
        .to_string();
        for context in [RefusalContext::Verification, RefusalContext::Generation] {
            let message = describe_refusal(context, 400, &body, MODEL);
            assert!(message.contains("Google did not accept that key"));
            assert!(message.contains("Google AI Studio"));
        }
    }

    #[test]
    fn generic_400_in_verification_rejects_connection_check_without_blaming_key_or_document() {
        let body = json!({
            "error": {
                "code": 400,
                "message": "Request contains an invalid argument.",
                "status": "INVALID_ARGUMENT"
            }
        })
        .to_string();
        let message = describe_refusal(RefusalContext::Verification, 400, &body, MODEL);
        assert!(message.contains("Google rejected the connection check as invalid"));
        assert!(!message.to_lowercase().contains("document"));
        assert!(!message.to_lowercase().contains("key"));
    }

    #[test]
    fn generic_400_in_generation_rejects_as_invalid_and_mentions_document() {
        let body = json!({
            "error": {
                "code": 400,
                "message": "Request contains an invalid argument.",
                "status": "INVALID_ARGUMENT"
            }
        })
        .to_string();
        let message = describe_refusal(RefusalContext::Generation, 400, &body, MODEL);
        assert!(message.contains("Google rejected the request as invalid"));
        assert!(message.contains("document format"));
        assert!(!message.to_lowercase().contains("key"));
    }

    #[test]
    fn auth_401_reports_authentication_not_accepted() {
        let message = describe_refusal(RefusalContext::Verification, 401, "{}", MODEL);
        assert!(message.contains("authentication"));
        assert!(message.contains("Google AI Studio"));
    }

    #[test]
    fn access_denied_403_mentions_restrictions_enablement_permissions_or_billing() {
        let message = describe_refusal(RefusalContext::Verification, 403, "{}", MODEL);
        assert!(message.contains("denied project or API access"));
        assert!(message.contains("restrictions"));
        assert!(message.contains("enablement"));
        assert!(message.contains("permissions"));
        assert!(message.contains("billing"));
    }

    #[test]
    fn retired_model_404_mentions_model_retirement_and_update() {
        let message = describe_refusal(RefusalContext::Generation, 404, "{}", MODEL);
        assert!(message.contains("retired"));
        assert!(message.contains(MODEL));
        assert!(message.contains("latest version"));
    }

    #[test]
    fn rate_limit_429_returns_rate_limit_guidance() {
        let message = describe_refusal(RefusalContext::Generation, 429, "{}", MODEL);
        assert!(message.contains("rate or spending limit"));
        assert!(!message.contains("free Gemini"));
        assert!(!message.contains("key is invalid"));
    }

    #[test]
    fn retryable_5xx_returns_transient_busy_message() {
        for status in [500, 502, 503, 504] {
            let message = describe_refusal(RefusalContext::Generation, status, "{}", MODEL);
            assert!(
                message.contains("Google's servers are busy") || message.contains("at capacity"),
                "status {status} should indicate transient server capacity"
            );
        }
    }

    #[test]
    fn each_pause_is_longer_than_the_last_until_the_cap() {
        let plain = |attempt| backoff_delay(attempt, 0).as_millis();
        assert!(plain(0) < plain(1));
        assert!(plain(1) < plain(2));
        assert_eq!(plain(0), u128::from(FIRST_BACKOFF_MS));
        // However many attempts fail, one pause never grows without bound.
        for attempt in 0..64 {
            assert!(backoff_delay(attempt, 0).as_millis() <= u128::from(MAX_BACKOFF_MS));
        }
    }

    #[test]
    fn jitter_spreads_retries_without_stretching_them() {
        // Up to a quarter more than the pause itself, never less than it.
        for attempt in 0..5 {
            let plain = backoff_delay(attempt, 0).as_millis();
            let jittered = backoff_delay(attempt, 999).as_millis();
            assert!(jittered >= plain);
            assert!(jittered <= plain + plain / 4 + 1);
        }
    }

    #[test]
    fn the_busy_message_blames_google_and_says_how_long_it_tried() {
        let message = busy_message();
        assert!(message.contains("busy"));
        assert!(message.contains("not your key"));
        assert!(total_wait_seconds() >= 1);
    }

    #[test]
    fn a_wait_says_how_long_and_which_attempt_is_next() {
        let message = waiting_message(0, Duration::from_millis(1_500));
        assert!(message.contains("2 seconds"));
        // Attempt 2 of 4: the one about to happen, counted the way she counts.
        assert!(message.contains("attempt 2 of 4"));
        assert!(waiting_message(2, Duration::from_millis(6_000)).contains("attempt 4 of 4"));
    }

    #[test]
    fn a_pdf_is_held_to_googles_document_limit() {
        assert!(check_size("application/pdf", MAX_PDF_BYTES).is_ok());

        let complaint = check_size("application/pdf", MAX_PDF_BYTES + 1).unwrap_err();
        // She is told what to do about it, not only that it is too big.
        assert!(complaint.contains("50 MB"));
        assert!(complaint.contains("1,000 pages"));
        assert!(complaint.contains("Split"));
    }

    #[test]
    fn a_pdf_is_held_to_googles_page_limit_as_well_as_its_size() {
        // A handbook can be well under 50 MB and still far too long, so the
        // pages are counted before anything is uploaded.
        assert!(check_page_count(pdf::MAX_PAGES).is_ok());

        let complaint = check_page_count(1_200).unwrap_err();
        assert!(complaint.contains("1200 pages"));
        assert!(complaint.contains("1000"));
        assert!(complaint.contains("chapter"));
    }

    #[test]
    fn other_files_are_not_held_to_the_pdf_limit() {
        // The inline cap is twice the PDF one, so an image between the two is
        // sent rather than refused for a limit that does not apply to it.
        let between = MAX_PDF_BYTES + 1;
        assert!(check_size("image/png", between).is_ok());
        assert!(check_size("image/png", MAX_INLINE_BYTES + 1).is_err());
    }

    #[test]
    fn text_is_held_to_what_the_model_can_read_at_once() {
        assert!(check_size("text/plain", MAX_TEXT_BYTES).is_ok());
        let complaint = check_size("text/plain", MAX_TEXT_BYTES + 1).unwrap_err();
        assert!(complaint.contains("hold in mind"));
    }

    #[test]
    fn sizes_are_reported_the_way_she_would_say_them() {
        assert_eq!(describe_size(62 * 1024 * 1024), "62 MB");
        assert_eq!(describe_size(50 * 1024 * 1024), "50 MB");
        assert_eq!(describe_size(3 * 1024), "3 KB");
        // Never "0 KB" for a file that exists.
        assert_eq!(describe_size(1), "1 KB");
    }

    #[test]
    fn only_the_file_types_google_reads_are_offered() {
        assert_eq!(mime_type("handbook.PDF").unwrap(), "application/pdf");
        assert_eq!(mime_type("chart.jpeg").unwrap(), "image/jpeg");
        assert_eq!(mime_type("notes.md").unwrap(), "text/plain");
        assert!(mime_type("syllabus.docx").is_err());
    }

    fn valid_question() -> PracticeQuestion {
        PracticeQuestion {
            question: "What is the standard traffic pattern altitude?".to_string(),
            options: vec!["800 ft AGL".to_string(), "1,000 ft AGL".to_string()],
            correct_index: 1,
            explanation: "1,000 ft AGL is the standard pattern altitude absent other guidance."
                .to_string(),
            source_page: Some(42),
        }
    }

    #[test]
    fn a_well_formed_practice_test_passes_through_untouched() {
        let test = GeneratedPracticeTest {
            title: "Traffic patterns".to_string(),
            questions: vec![valid_question(), valid_question()],
            model: String::new(),
        };
        let sanitized = sanitize_practice_test(test).unwrap();
        assert_eq!(sanitized.questions.len(), 2);
    }

    #[test]
    fn a_correct_index_past_the_end_of_its_own_options_is_dropped() {
        let mut broken = valid_question();
        broken.correct_index = 5; // Only two options exist.
        let test = GeneratedPracticeTest {
            title: "Bad index".to_string(),
            questions: vec![broken, valid_question()],
            model: String::new(),
        };
        let sanitized = sanitize_practice_test(test).unwrap();
        assert_eq!(sanitized.questions.len(), 1);
    }

    #[test]
    fn a_question_with_fewer_than_two_options_is_dropped() {
        let mut broken = valid_question();
        broken.options = vec!["Only one choice".to_string()];
        let test = GeneratedPracticeTest {
            title: "Too few options".to_string(),
            questions: vec![broken, valid_question()],
            model: String::new(),
        };
        let sanitized = sanitize_practice_test(test).unwrap();
        assert_eq!(sanitized.questions.len(), 1);
    }

    #[test]
    fn blank_question_or_explanation_text_is_dropped() {
        let mut blank_question = valid_question();
        blank_question.question = "   ".to_string();
        let mut blank_explanation = valid_question();
        blank_explanation.explanation = "".to_string();
        let test = GeneratedPracticeTest {
            title: "Blank text".to_string(),
            questions: vec![blank_question, blank_explanation, valid_question()],
            model: String::new(),
        };
        let sanitized = sanitize_practice_test(test).unwrap();
        assert_eq!(sanitized.questions.len(), 1);
    }

    #[test]
    fn a_test_left_with_no_usable_questions_is_an_error_not_an_empty_test() {
        let mut broken = valid_question();
        broken.correct_index = 99;
        let test = GeneratedPracticeTest {
            title: "All broken".to_string(),
            questions: vec![broken],
            model: String::new(),
        };
        let error = sanitize_practice_test(test).unwrap_err();
        assert!(error.contains("Try generating it again"), "{error}");
    }

    #[test]
    fn extract_text_refuses_an_envelope_with_no_answer() {
        assert!(extract_text("{}").is_err());
        assert!(extract_text("not json at all").is_err());
        assert_eq!(
            extract_text(r#"{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}"#).unwrap(),
            "hello"
        );
    }
}
