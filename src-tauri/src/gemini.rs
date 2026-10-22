//! Gemini connection and document analysis.
//!
//! The user supplies her own Google AI Studio key. It is kept in a file beside
//! her other data — see `secrets` for why it is not in the operating system's
//! credential manager any more — and never returned to JavaScript.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::documents;
use crate::gemini_budget::{self, Budget, Stage, MAX_GENERATION_ATTEMPTS};
use crate::gemini_cancel;
use crate::gemini_files::{self, PreparedSources, Source, GOOGLE_BASE};
use crate::gemini_jobs::{self, CancelOutcome, JobKind, JobRecord, JobStage};
use crate::lineage::calculate_sha256;
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

/// The more capable model she can choose in Settings instead of `MODEL`.
///
/// Google offers it only to keys with billing turned on, and each document
/// costs noticeably more, so it is never the default and is only used once she
/// has chosen it. Pinned and checked against the official model documentation
/// before release, exactly like `MODEL`.
const CAPABLE_MODEL: &str = "gemini-4-argon";

/// Her model choice, kept beside the key in the application data folder.
///
/// Like the key it is never part of a backup: `allowed_archive_path` admits
/// only the database and `documents/`, so no archive carries or plants it.
const MODEL_CHOICE_FILE: &str = "gemini-model";
/// Where a partly written choice waits before it replaces the real one.
const MODEL_CHOICE_WRITING: &str = "gemini-model.writing";

/// Which Gemini model her documents go to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModelChoice {
    /// `MODEL`: fast, inexpensive and available on Google's free tier.
    Standard,
    /// `CAPABLE_MODEL`: slower and costlier, for long or complex material.
    MostCapable,
}

impl ModelChoice {
    fn as_str(self) -> &'static str {
        match self {
            ModelChoice::Standard => "standard",
            ModelChoice::MostCapable => "most-capable",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "standard" => Some(ModelChoice::Standard),
            "most-capable" => Some(ModelChoice::MostCapable),
            _ => None,
        }
    }

    /// The model asked first.
    fn primary(self) -> &'static str {
        match self {
            ModelChoice::Standard => MODEL,
            ModelChoice::MostCapable => CAPABLE_MODEL,
        }
    }

    /// The model asked once when the primary stays busy or is unavailable.
    fn fallback(self) -> &'static str {
        match self {
            ModelChoice::Standard => FALLBACK_MODEL,
            ModelChoice::MostCapable => MODEL,
        }
    }

    /// What she is told when the request moves to the fallback.
    fn fallback_notice(self) -> &'static str {
        match self {
            ModelChoice::Standard => "Trying the backup Gemini model…",
            ModelChoice::MostCapable => {
                "Gemini 4 Argon is not answering right now, so trying the standard Gemini model…"
            }
        }
    }
}

/// Her saved choice. Anything missing, unreadable or unrecognised means the
/// standard model, so a damaged preference never sends a document to the
/// costlier one.
pub(crate) fn load_choice(root: &Path) -> ModelChoice {
    std::fs::read_to_string(root.join(MODEL_CHOICE_FILE))
        .ok()
        .and_then(|value| ModelChoice::parse(&value))
        .unwrap_or(ModelChoice::Standard)
}

/// Save her choice, replacing any previous one.
fn save_choice(root: &Path, choice: ModelChoice) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;
    // Write beside the target and rename over it, so an interrupted write
    // leaves the previous choice rather than an unreadable one.
    let writing = root.join(MODEL_CHOICE_WRITING);
    std::fs::write(&writing, choice.as_str())
        .map_err(|e| format!("Could not save the Gemini model choice: {e}"))?;
    std::fs::rename(&writing, root.join(MODEL_CHOICE_FILE)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not save the Gemini model choice: {e}")
    })
}

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

/// Inline data is base64-encoded inside the JSON request, which makes it a
/// third larger, and the request cap applies to the encoded request. A file
/// that fits the cap raw can still overflow it once encoded, so an inline
/// source is held to what fits after encoding, with room for the prompt and
/// response schema. PDFs no longer travel inline (GEN-REL-01); this bounds the
/// images and text that still do.
const INLINE_REQUEST_OVERHEAD: u64 = 256 * 1024;

/// The encoded size of `bytes` raw bytes sent inline, plus the request around it.
fn inline_request_bytes(bytes: u64) -> u64 {
    bytes
        .div_ceil(3)
        .saturating_mul(4)
        .saturating_add(INLINE_REQUEST_OVERHEAD)
}

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
const GENERATE_TIMEOUT: Duration = Duration::from_secs(900);

/// The client for generation. Its overall timeout is only a backstop: every
/// request is given what remains of the generation's one budget, and a
/// connection that cannot be made in `CONNECT_TIMEOUT` counts as unreachable.
pub(crate) fn generation_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(gemini_budget::CONNECT_TIMEOUT)
        .timeout(GENERATE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Could not start the connection to Gemini: {e}"))
}

/// Redirects are never followed: every address this client talks to is
/// Google's own and validated before use, and a redirect would carry the key
/// and a document's bytes to an address nobody checked. A 3xx is reported as
/// the refusal it is.
fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
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
    matches!(status, 408 | 429 | 500 | 502 | 503 | 504)
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

    if bytes > limit {
        return Err(format!(
            "That file is {}, over the {} limit for this kind of file. {advice}",
            describe_size(bytes),
            describe_size(limit),
        ));
    }
    // Everything but a PDF is still sent inline, encoded.
    if mime != "application/pdf" && inline_request_bytes(bytes) > MAX_INLINE_BYTES {
        return Err(format!(
            "That file is {}, too large to send in one request once it is encoded. {advice}",
            describe_size(bytes),
        ));
    }
    Ok(())
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
///
/// GEN-REL-04: every event names the job it belongs to (its material and
/// output, and its journal id once it has one), so a window shows it only
/// beside that job. A stage is the stage actually reached; nothing here is a
/// percentage, since no measure of Gemini's own progress exists.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiProgress {
    job_id: Option<String>,
    material_id: String,
    kind: JobKind,
    stage: Option<&'static str>,
    message: Option<String>,
    attempt: u32,
    max_attempts: u32,
}

/// The event the Study Library listens for.
const PROGRESS_EVENT: &str = "gemini-progress";

/// Reports one generation's progress, scoped to its job.
pub(crate) struct Reporter {
    material_id: String,
    kind: JobKind,
    job_id: Mutex<Option<String>>,
    attempts: AtomicU32,
    limit: AtomicU32,
    send: Box<dyn Fn(GeminiProgress) + Send + Sync>,
}

impl Reporter {
    pub(crate) fn new(
        material_id: &str,
        kind: JobKind,
        send: Box<dyn Fn(GeminiProgress) + Send + Sync>,
    ) -> Arc<Reporter> {
        Arc::new(Reporter {
            material_id: material_id.to_string(),
            kind,
            job_id: Mutex::new(None),
            attempts: AtomicU32::new(0),
            limit: AtomicU32::new(MAX_GENERATION_ATTEMPTS),
            send,
        })
    }

    fn emit(&self, stage: Option<Stage>, message: Option<String>) {
        // Progress is a courtesy. A window that will not take it changes
        // nothing about whether the study aid arrives.
        (self.send)(GeminiProgress {
            job_id: self
                .job_id
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            material_id: self.material_id.clone(),
            kind: self.kind,
            stage: stage.map(Stage::key),
            message,
            attempt: self.attempts.load(Ordering::SeqCst),
            max_attempts: self.limit.load(Ordering::SeqCst),
        });
    }

    /// The job has begun: from now on every event carries its id.
    fn started(&self, job_id: &str) {
        *self.job_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(job_id.to_string());
        self.emit(Some(Stage::Preparing), None);
    }

    pub(crate) fn say(&self, message: String) {
        self.emit(None, Some(message));
    }

    /// Follow `budget`'s stages.
    pub(crate) fn follow(self: &Arc<Self>, budget: &Budget) {
        let reporter = self.clone();
        budget.observe(Arc::new(move |stage, attempts| {
            reporter.attempts.store(attempts, Ordering::SeqCst);
            reporter.emit(Some(stage), None);
        }));
    }
}

fn reporter_for(app: &AppHandle, material_id: &str, kind: JobKind) -> Arc<Reporter> {
    let app = app.clone();
    Reporter::new(
        material_id,
        kind,
        Box::new(move |progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        }),
    )
}

/// What one generation request came to.
enum Attempt {
    /// The response body, ready to be parsed.
    Answered(String),
    /// Google replied, but not with a result.
    Refused {
        status: u16,
        body: String,
        retry_after: Option<Duration>,
    },
    /// No complete reply arrived.
    Lost(Lost),
}

/// How a request ended without Google's reply in hand.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Lost {
    /// No connection was made: nothing reached Google, so trying again is safe.
    Unreachable,
    /// Google had the request, but no reply arrived in the time left.
    NoAnswerInTime,
    /// Google began replying, but the rest did not arrive in the time left.
    AnswerCutShort,
    /// The connection broke after the request was sent: Google may or may not
    /// have finished, and trying again may be charged again.
    Dropped,
}

impl Lost {
    fn category(self) -> &'static str {
        match self {
            Lost::Unreachable => "could not reach Google",
            Lost::NoAnswerInTime => "no answer in time",
            Lost::AnswerCutShort => "answer cut short",
            Lost::Dropped => "connection interrupted",
        }
    }
}

/// Whether this run has already looked in the old credential manager.
static LEGACY_CHECKED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiStatus {
    configured: bool,
    /// The model her documents are sent to first, given her choice.
    model: &'static str,
    /// "standard" or "most-capable".
    choice: &'static str,
}

impl GeminiStatus {
    fn new(configured: bool, choice: ModelChoice) -> Self {
        GeminiStatus {
            configured,
            model: choice.primary(),
            choice: choice.as_str(),
        }
    }
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

pub(crate) fn stored_key(app: &AppHandle) -> Result<String, String> {
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

#[tauri::command]
pub fn gemini_status(app: AppHandle) -> GeminiStatus {
    let root = app_root(&app).ok();
    let configured = root
        .as_deref()
        .map(|root| current_key(root).ok().flatten().is_some())
        .unwrap_or(false);
    let choice = root
        .as_deref()
        .map(load_choice)
        .unwrap_or(ModelChoice::Standard);
    GeminiStatus::new(configured, choice)
}

/// Choose which model her documents go to. The key is untouched.
#[tauri::command]
pub fn set_gemini_model(app: AppHandle, choice: String) -> Result<GeminiStatus, String> {
    let choice = ModelChoice::parse(&choice)
        .ok_or_else(|| "That is not one of the Gemini models this version offers.".to_string())?;
    let root = app_root(&app)?;
    save_choice(&root, choice)?;
    let configured = current_key(&root).ok().flatten().is_some();
    Ok(GeminiStatus::new(configured, choice))
}

#[tauri::command]
pub async fn configure_gemini(app: AppHandle, api_key: String) -> Result<GeminiStatus, String> {
    let trimmed = api_key.trim();
    if trimmed.len() < 20 {
        return Err("Paste the complete Gemini API key from Google AI Studio.".to_string());
    }
    verify_key(trimmed).await?;
    let root = app_root(&app)?;
    let previous = current_key(&root).ok().flatten();
    secrets::save_key(&root, trimmed)?;
    // A new key ends in-flight work. Native guide references stay retained;
    // their fingerprint requires explicit Continue with a different key.
    end_prepared_context(previous).await;
    Ok(GeminiStatus::new(true, load_choice(&root)))
}

#[tauri::command]
pub async fn disconnect_gemini(app: AppHandle) -> Result<GeminiStatus, String> {
    let root = app_root(&app)?;
    let previous = current_key(&root).ok().flatten();
    secrets::forget_key(&root)?;
    end_prepared_context(previous).await;
    // Clear anything still sitting in the old credential manager as well, so
    // disconnecting really does leave no key behind. Best effort: on macOS an
    // updated build is usually refused access to its predecessor's item.
    if let Ok(entry) = Entry::new(LEGACY_SERVICE, LEGACY_ACCOUNT) {
        let _ = entry.delete_credential();
    }
    Ok(GeminiStatus::new(false, load_choice(&root)))
}

/// End the prepared-source context and retire, best effort and bounded, the
/// uploads made with `previous_key`. Anything not removed expires at Google.
async fn end_prepared_context(previous_key: Option<String>) {
    let retired = prepared_sources().invalidate_all();
    let (Some(key), false) = (previous_key, retired.is_empty()) else {
        return;
    };
    if let Ok(http) = client(VERIFY_TIMEOUT) {
        tauri::async_runtime::spawn(async move {
            prepared_sources().retire(&http, &key, retired).await;
        });
    }
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
/// The one selected source as read for this request.
pub(crate) struct LoadedSource {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    /// SHA-256 of exactly these bytes: what a prepared copy is bound to.
    pub content_sha256: String,
    /// The selected managed source (its stored path).
    pub scope: String,
}

impl LoadedSource {
    pub(crate) fn new(bytes: Vec<u8>, mime: &'static str, scope: &str) -> Self {
        LoadedSource {
            content_sha256: calculate_sha256(&bytes),
            bytes,
            mime,
            scope: scope.to_string(),
        }
    }

    fn as_source(&self) -> Source<'_> {
        Source {
            bytes: &self.bytes,
            content_sha256: &self.content_sha256,
            mime: self.mime,
            scope: &self.scope,
        }
    }
}

pub(crate) async fn prepare_submission(
    app: &AppHandle,
    relative_path: &str,
) -> Result<(String, LoadedSource), String> {
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
    Ok((api_key, LoadedSource::new(bytes, mime, relative_path)))
}

/// The session's prepared PDFs (GEN-REL-01): native memory only.
pub(crate) fn prepared_sources() -> &'static PreparedSources {
    static PREPARED: OnceLock<PreparedSources> = OnceLock::new();
    PREPARED.get_or_init(|| {
        PreparedSources::new(
            gemini_files::Policy::default(),
            gemini_files::system_clock(),
        )
    })
}

/// Everything one generation needs, without the window: tests run the same
/// code against a loopback endpoint.
pub(crate) struct GenContext<'a> {
    pub(crate) http: &'a Client,
    pub(crate) base: &'a str,
    pub(crate) api_key: &'a str,
    pub(crate) choice: ModelChoice,
    pub(crate) cache: &'a PreparedSources,
    /// The prepared-source context this generation began in.
    pub(crate) epoch: u64,
    /// The one active budget every step of this generation draws from.
    pub(crate) budget: &'a Budget,
    pub(crate) say: &'a (dyn Fn(String) + Sync),
}

impl GenContext<'_> {
    /// False once the prepared-source context this generation began in has
    /// ended (disconnect or a new key).
    fn current(&self) -> bool {
        self.cache.epoch() == self.epoch
    }

    fn stale() -> Failure {
        Failure {
            message: gemini_files::STALE_CONTEXT.to_string(),
            status: None,
        }
    }
}

/// How the selected source appears in a request. A PDF is referred to by its
/// prepared copy; it is never also embedded.
fn source_part(source: &LoadedSource, prepared: Option<&gemini_files::Prepared>) -> Value {
    match prepared {
        Some(p) => json!({"file_data": {"mime_type": p.mime, "file_uri": p.uri}}),
        None => {
            json!({"inline_data": {"mime_type": source.mime, "data": BASE64.encode(&source.bytes)}})
        }
    }
}

/// Run one generation over the selected source. A PDF is prepared once and
/// referred to; anything else is sent inline as before.
///
/// If Google refuses a request that referred to a prepared copy, the copy is
/// checked: if it is gone or not ready, it is prepared again exactly once, and
/// the request made once more. If the copy is fine, the refusal stands as it is
/// (so a retired model still reads as a retired model, not as a missing
/// upload). A lookup that itself fails is reported, never turned into an
/// upload.
///
/// The copy stays leased while it is used, so replacing or evicting it cannot
/// delete it mid-request. If the context ends (disconnect or a new key) at any
/// point, the operation is refused and nothing it produced is returned.
pub(crate) async fn run_generation(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    build: &(dyn Fn(Value) -> Value + Sync),
) -> Result<(String, &'static str), String> {
    // Also bound cache coalescing, readiness and best-effort cleanup awaits.
    // Dropping a lease queues its owned remote file for later cleanup.
    match ctx
        .budget
        .run(run_generation_inner(ctx, source, build))
        .await
    {
        Ok(result) if ctx.current() => result,
        Ok(_) => Err(gemini_files::STALE_CONTEXT.to_string()),
        Err(()) => {
            if ctx.budget.cancelled() {
                return Err(gemini_cancel::CANCELLED.into());
            }
            let stage = ctx.budget.stage();
            if matches!(stage, Stage::Generating | Stage::Reading) {
                let lost = if stage == Stage::Reading {
                    Lost::AnswerCutShort
                } else {
                    Lost::NoAnswerInTime
                };
                ctx.budget.categorize(lost.category());
                Err(lost_message(lost, ctx.budget))
            } else {
                Err(gemini_files::out_of_time(
                    ctx.budget,
                    "finishing this study aid",
                ))
            }
        }
    }
}

async fn run_generation_inner(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    build: &(dyn Fn(Value) -> Value + Sync),
) -> Result<(String, &'static str), String> {
    if source.mime != "application/pdf" {
        let body = build(source_part(source, None));
        return generate_with_retries_at(ctx, &body)
            .await
            .map_err(|f| f.message);
    }
    let view = source.as_source();
    let lease = ctx
        .cache
        .prepare(
            ctx.http,
            ctx.base,
            ctx.api_key,
            &view,
            ctx.epoch,
            None,
            ctx.budget,
            ctx.say,
        )
        .await?;
    let outcome = generate_on(ctx, source, &lease, build).await;
    let outcome = match outcome {
        Err(failure) if matches!(failure.status, Some(400 | 403 | 404)) => {
            let prepared = lease.prepared().clone();
            match gemini_files::lookup(
                ctx.http,
                ctx.base,
                ctx.api_key,
                &prepared.name,
                &prepared.mime,
                ctx.budget,
            )
            .await
            {
                Ok(file) if file.state == gemini_files::FileState::Active => Err(failure.message),
                Err(
                    gemini_files::LookupFailure::Other(message)
                    | gemini_files::LookupFailure::Auth(message),
                ) => Err(message),
                _ => {
                    ctx.cache
                        .finish_admitted(lease, ctx.http, ctx.api_key, ctx.budget)
                        .await;
                    (ctx.say)("The prepared copy of this PDF was no longer available at Google, so it is being prepared once more.".to_string());
                    let again = ctx
                        .cache
                        .prepare(
                            ctx.http,
                            ctx.base,
                            ctx.api_key,
                            &view,
                            ctx.epoch,
                            Some(&prepared.name),
                            ctx.budget,
                            ctx.say,
                        )
                        .await?;
                    let outcome = generate_on(ctx, source, &again, build)
                        .await
                        .map_err(|f| f.message);
                    ctx.cache
                        .finish_admitted(again, ctx.http, ctx.api_key, ctx.budget)
                        .await;
                    // Checked after the cleanup await, not before it.
                    return if ctx.current() {
                        outcome
                    } else {
                        Err(gemini_files::STALE_CONTEXT.to_string())
                    };
                }
            }
        }
        other => other.map_err(|f| f.message),
    };
    ctx.cache
        .finish_admitted(lease, ctx.http, ctx.api_key, ctx.budget)
        .await;
    // Checked after the cleanup await, not before it.
    if ctx.current() {
        outcome
    } else {
        Err(gemini_files::STALE_CONTEXT.to_string())
    }
}

/// One generation request referring to a leased copy, refused before sending
/// if the copy's context has already ended.
async fn generate_on(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    lease: &gemini_files::Lease<'_>,
    build: &(dyn Fn(Value) -> Value + Sync),
) -> Result<(String, &'static str), Failure> {
    if !lease.is_current() {
        return Err(GenContext::stale());
    }
    let body = build(source_part(source, Some(lease.prepared())));
    generate_with_retries_at(ctx, &body).await
}

/// Said to the window whenever a job changes stage.
const JOB_EVENT: &str = "gemini-job";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobChanged {
    id: String,
    stage: JobStage,
}

/// What a generation command returns: the validated answer, plus the job it is
/// recorded under so the window can save it, or save it again, without asking
/// Gemini twice (GEN-REL-02).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobAnswer<T: Serialize> {
    #[serde(flatten)]
    answer: T,
    job_id: Option<String>,
    /// SHA-256 of exactly the bytes that were sent.
    content_sha256: String,
    /// Whether the answer is on disk as a checkpoint. False means only this
    /// window holds it: a restart before it is saved would lose it.
    checkpointed: bool,
}

/// If a job's work stops without an outcome (a panic, a dropped future), the
/// job must not stay `running` and hold the lock until the app restarts, and
/// a window following it must hear that it ended.
struct RunningJob<'a> {
    root: &'a Path,
    id: Option<String>,
    changed: &'a (dyn Fn(&JobRecord) + Sync),
}

impl RunningJob<'_> {
    /// Record the outcome. `Err` means it could not be written to disk; the
    /// job has then been released.
    fn finish(mut self, outcome: Result<Value, &str>) -> Result<Option<JobRecord>, String> {
        let Some(id) = self.id.take() else {
            return Ok(None);
        };
        let (written, record) = gemini_jobs::with(self.root, |journal| {
            let written = match outcome {
                Ok(result) => journal.ready(&id, result),
                Err(message) => journal.failed(&id, message),
            };
            (written, journal.list().into_iter().find(|j| j.id == id))
        });
        (self.changed)(&record.clone().unwrap_or_else(|| released(&id)));
        written.map(|()| record)
    }
}

/// What a window following a job hears when the job is gone from the journal.
fn released(id: &str) -> JobRecord {
    JobRecord {
        id: id.to_string(),
        kind: JobKind::StudyAid,
        material_id: String::new(),
        relative_path: String::new(),
        content_sha256: String::new(),
        base_revision: None,
        request_id: None,
        stage: JobStage::Failed,
        created_at: 0,
        updated_at: 0,
        result: None,
        draft: None,
        error: None,
    }
}

impl Drop for RunningJob<'_> {
    fn drop(&mut self) {
        if let Some(id) = self.id.take() {
            let record = gemini_jobs::with(self.root, |journal| {
                let _ = journal.failed(
                    &id,
                    "Creating this study aid stopped before Gemini's answer arrived. Nothing was saved; try again.",
                );
                journal.list().into_iter().find(|j| j.id == id)
            });
            // Heard by a window that is following this job after a reload.
            (self.changed)(&record.unwrap_or_else(|| released(&id)));
        }
    }
}

/// Said when a job's record disappeared before it could settle.
const RECORD_LOST: &str =
    "This study aid's record was lost before it could be kept, so nothing was saved. Try again.";

/// What a command adds to a recorded job (GEN-REL-04): who to tell once it
/// has begun, and whether she can cancel it.
#[derive(Clone, Copy, Default)]
struct JobHooks<'a> {
    started: Option<&'a (dyn Fn(&str) + Sync)>,
    cancellable: bool,
    /// The window's own id for this request, which it can cancel by before it
    /// has learned the job's id.
    request_id: Option<&'a str>,
    /// The generation's budget, which then checks the cancel token before
    /// every request and pause.
    budget: Option<&'a Budget>,
}

/// Run one generation as a recorded job. `material_id` is the window's own
/// identity for the material. Every generation is recorded, so the one-at-a-
/// time rule holds for every caller. Tests use it without command hooks.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
async fn as_job<T, F>(
    root: &Path,
    kind: JobKind,
    material_id: &str,
    base_revision: Option<&str>,
    source: &LoadedSource,
    work: F,
    changed: &(dyn Fn(&JobRecord) + Sync),
) -> Result<JobAnswer<T>, String>
where
    T: Serialize,
    F: std::future::Future<Output = Result<T, String>>,
{
    as_job_with(
        root,
        kind,
        material_id,
        base_revision,
        source,
        work,
        changed,
        JobHooks::default(),
    )
    .await
}

/// `as_job`, with the command's hooks. A cancellable job's work is dropped as
/// soon as the journal records it cancelled, and a job the journal records as
/// cancelled never hands over an answer, even one that had just arrived.
#[allow(clippy::too_many_arguments)]
async fn as_job_with<T, F>(
    root: &Path,
    kind: JobKind,
    material_id: &str,
    base_revision: Option<&str>,
    source: &LoadedSource,
    work: F,
    changed: &(dyn Fn(&JobRecord) + Sync),
    hooks: JobHooks<'_>,
) -> Result<JobAnswer<T>, String>
where
    T: Serialize,
    F: std::future::Future<Output = Result<T, String>>,
{
    let id = Some(gemini_jobs::with(root, |journal| {
        journal.begin_request(
            kind,
            material_id,
            &source.scope,
            &source.content_sha256,
            base_revision,
            hooks.request_id,
        )
    })?);
    // The token exists before anyone can learn the job's id. A cancel that
    // reached the journal in between (it lists the job as soon as it begins)
    // found no token to wake, so the journal is read again once the token is
    // registered: any later cancel finds the token.
    let registration = id.as_deref().map(|id| {
        let registration = hooks.cancellable.then(|| gemini_cancel::register(id));
        if let Some(budget) = hooks.budget {
            // Every later request asks the journal, under the lock the cancel
            // is recorded under.
            let (probe_root, probe_id) = (root.to_path_buf(), id.to_string());
            budget.attach_probe(Arc::new(move || {
                gemini_jobs::with(&probe_root, |journal| journal.admits(&probe_id))
            }));
            let (root, id) = (root.to_path_buf(), id.to_string());
            budget.attach_admission(Arc::new(move || {
                gemini_jobs::with(&root, |journal| journal.admit_bounded(&id))
            }));
        }
        if let Some(registration) = &registration {
            let cancelled = gemini_jobs::with(root, |journal| {
                journal
                    .list()
                    .iter()
                    .any(|j| j.id == id && j.stage == JobStage::Cancelled)
            });
            if cancelled {
                registration.token.cancel();
            }
        }
        if let Some(started) = hooks.started {
            started(id);
        }
        registration
    });
    if let (Some(budget), Some(job_id)) = (hooks.budget, id.as_deref()) {
        let draft = gemini_jobs::with(root, |journal| {
            journal
                .list()
                .into_iter()
                .find(|j| j.id == job_id)
                .and_then(|j| j.draft)
        });
        if let Some(draft) = draft {
            budget.restore_draft(&draft);
        }
        {
            let (path, timing_id) = (root.to_path_buf(), job_id.to_string());
            if !budget.enable_stages(Arc::new(move |timing| {
                gemini_jobs::with(&path, |journal| {
                    journal
                        .checkpoint_timing(&timing_id, timing.clone())
                        .is_ok()
                })
            })) {
                if budget.cancelled() {
                    return Err(gemini_cancel::CANCELLED.into());
                }
                gemini_jobs::with(root, |journal| {
                    journal.failed(job_id, gemini_budget::CHECKPOINT_FAILED)
                })?;
                return Err(gemini_budget::CHECKPOINT_FAILED.into());
            }
        }
    }
    let running = RunningJob { root, id, changed };
    let work = async {
        let outcome = if let Some(budget) = hooks.budget {
            match budget.run(work).await {
                Ok(value) => value,
                Err(()) if budget.cancelled() => Err(gemini_cancel::CANCELLED.into()),
                Err(()) => Err(gemini_files::out_of_time(
                    budget,
                    "finishing this study aid",
                )),
            }
        } else {
            work.await
        };
        if let Some(budget) = hooks.budget {
            if outcome.is_ok() {
                budget.validation_checkpoint()?;
            } else {
                let _ = budget.persist_timing();
            }
        }
        outcome
    };
    let outcome = match registration.flatten() {
        Some(registration) => {
            match gemini_cancel::Cancellable::new(work, registration.token.clone()).await {
                Ok(outcome) => outcome,
                Err(gemini_cancel::Cancelled) => Err(gemini_cancel::CANCELLED.to_string()),
            }
        }
        None => work.await,
    };
    let recorded = match &outcome {
        Ok(answer) => match serde_json::to_value(answer) {
            Ok(value) => running.finish(Ok(value)),
            Err(_) => running.finish(Err("Gemini's answer could not be kept.")),
        },
        Err(message) => running.finish(Err(message)),
    };
    match (outcome, recorded) {
        // Cancelled, whichever came first: the journal decided, and nothing
        // is handed over.
        (
            _,
            Ok(Some(JobRecord {
                stage: JobStage::Cancelled,
                ..
            })),
        ) => Err(gemini_cancel::CANCELLED.to_string()),
        // Too large to keep, or not serializable: the journal says why.
        (
            Ok(_),
            Ok(Some(JobRecord {
                stage: JobStage::Failed,
                error: Some(message),
                ..
            })),
        ) => Err(message),
        (Ok(answer), Ok(Some(record))) => Ok(JobAnswer {
            answer,
            checkpointed: true,
            job_id: Some(record.id),
            content_sha256: source.content_sha256.clone(),
        }),
        // The record vanished before the job could settle: nothing confirms
        // the answer is wanted, so it is not handed over (GENREL04-R6).
        (Ok(_), Ok(None)) => Err(RECORD_LOST.to_string()),
        // The answer is valid but could not be written down: hand it over,
        // honestly marked as held only by this window.
        (Ok(answer), Err(_)) => Ok(JobAnswer {
            answer,
            job_id: None,
            content_sha256: source.content_sha256.clone(),
            checkpointed: false,
        }),
        (Err(message), _) => Err(message),
    }
}

fn job_changed(app: &AppHandle) -> impl Fn(&JobRecord) + Sync + '_ {
    move |record: &JobRecord| {
        let _ = app.emit(
            JOB_EVENT,
            JobChanged {
                id: record.id.clone(),
                stage: record.stage,
            },
        );
    }
}

/// Every recorded job: what the window rebuilds itself from after a reload or
/// a restart.
#[tauri::command]
pub fn gemini_jobs(app: AppHandle) -> Result<Vec<JobRecord>, String> {
    let root = app_root(&app)?;
    Ok(gemini_jobs::with(&root, |journal| {
        journal
            .list()
            .into_iter()
            .filter(|r| r.kind != JobKind::PdfKit)
            .collect()
    }))
}

/// She asked to cancel a running job (GEN-REL-04). The journal decides first:
/// only a job still running is recorded as cancelled, and only then is its
/// work woken to stop. A job that already finished keeps its outcome, and the
/// window is told so.
pub(crate) fn cancel_job(
    root: &Path,
    job_id: &str,
    changed: &(dyn Fn(&JobRecord) + Sync),
) -> Result<CancelOutcome, String> {
    // Decided in the journal, under the lock every request's admission asks
    // under: once this commits, no further request is admitted. Waking the
    // work afterwards only makes it stop sooner.
    let (outcome, record) = gemini_jobs::with(root, |journal| {
        let outcome = journal.cancel(job_id);
        (outcome, journal.list().into_iter().find(|j| j.id == job_id))
    });
    let outcome = outcome?;
    if outcome.cancelled {
        gemini_cancel::wake(job_id);
        if let Some(record) = record {
            changed(&record);
        }
    }
    Ok(outcome)
}

/// Cancel by the window's request id: works before the window knows the
/// job's id, and before the job has even begun (it is then refused before
/// anything is sent).
pub(crate) fn cancel_request(
    root: &Path,
    request_id: &str,
    changed: &(dyn Fn(&JobRecord) + Sync),
) -> Result<CancelOutcome, String> {
    // One journal decision, under the lock admission asks under.
    let (outcome, record) = gemini_jobs::with(root, |journal| {
        let outcome = journal.cancel_request(request_id);
        let record = outcome
            .as_ref()
            .ok()
            .and_then(|(_, id)| id.clone())
            .and_then(|id| journal.list().into_iter().find(|j| j.id == id));
        (outcome, record)
    });
    let (outcome, job_id) = outcome?;
    if outcome.cancelled {
        if let Some(job_id) = job_id {
            gemini_cancel::wake(&job_id);
        }
        if let Some(record) = record {
            changed(&record);
        }
    }
    Ok(outcome)
}

#[tauri::command]
pub fn cancel_gemini_job(
    app: AppHandle,
    job_id: Option<String>,
    request_id: Option<String>,
) -> Result<CancelOutcome, String> {
    let root = app_root(&app)?;
    let outcome = match (request_id, job_id.clone()) {
        (Some(request_id), _) => cancel_request(&root, &request_id, &job_changed(&app)),
        (None, Some(job_id)) => cancel_job(&root, &job_id, &job_changed(&app)),
        (None, None) => Err("There was nothing to cancel.".to_string()),
    }?;
    if outcome.cancelled && outcome.stage.is_none() {
        if let Some(id) = job_id {
            let _ = app.emit(
                JOB_EVENT,
                JobChanged {
                    id,
                    stage: JobStage::Cancelled,
                },
            );
        }
    }
    Ok(outcome)
}

/// The window saved or dismissed a finished job.
#[tauri::command]
pub async fn acknowledge_gemini_job(app: AppHandle, job_id: String) -> Result<bool, String> {
    let root = app_root(&app)?;
    let key = current_key(&root).ok().flatten();
    let (removed, descriptor) = sections::take_discard_at(&root, &job_id, prepared_sources())?;
    if let (true, Some((descriptor, sha)), Some(key), Ok(http)) =
        (removed, descriptor, key, client(VERIFY_TIMEOUT))
    {
        tauri::async_runtime::spawn(async move {
            prepared_sources()
                .discard_reference(
                    &descriptor,
                    &job_id,
                    &http,
                    gemini_files::GOOGLE_BASE,
                    &key,
                    &sha,
                )
                .await;
        });
    }
    Ok(removed)
}

#[tauri::command]
pub async fn generate_study_aid(
    app: AppHandle,
    relative_path: String,
    material_id: String,
    base_revision: Option<String>,
    request_id: Option<String>,
    target_cards: Option<u32>,
) -> Result<JobAnswer<GeneratedStudyAid>, String> {
    let target = batches::target(target_cards)?;
    // The context is recorded before the key is read, so a disconnect or key
    // change at any later point makes this operation stale.
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let epoch = prepared_sources().epoch();
    let (api_key, source) = budget
        .run(prepare_submission(&app, &relative_path))
        .await
        .map_err(|_| gemini_files::out_of_time(&budget, "preparing the document"))??;
    let root = app_root(&app)?;
    let choice = load_choice(&root);
    let http = generation_client()?;
    // The invocation budget already includes source preparation.
    // Progress names this job and reports the stages actually reached.
    let reporter = reporter_for(&app, &material_id, JobKind::StudyAid);
    reporter.limit.store(9, Ordering::SeqCst);
    reporter.follow(&budget);
    let progress = |message: String| reporter.say(message);
    let started = |job_id: &str| reporter.started(job_id);
    let ctx = GenContext {
        http: &http,
        base: GOOGLE_BASE,
        api_key: &api_key,
        choice,
        cache: prepared_sources(),
        epoch,
        budget: &budget,
        say: &progress,
    };
    as_job_with(
        &root,
        JobKind::StudyAid,
        &material_id,
        base_revision.as_deref(),
        &source,
        async {
            batches::generate(&ctx, &source, &root, &material_id, target)
                .await
                .map_err(|m| format!("{m}\n{}", budget.details(None)))
        },
        &job_changed(&app),
        JobHooks {
            started: Some(&started),
            cancellable: true,
            request_id: request_id.as_deref(),
            budget: Some(&budget),
        },
    )
    .await
}

/// The study guide and flashcards, from the selected source.
#[cfg(test)]
async fn study_aid_with(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
) -> Result<GeneratedStudyAid, String> {
    let prompt =
        "Create an accurate private-pilot study aid from the attached source. \
         Use only facts supported by the source. Do not invent regulations, procedures, numbers, or page references. \
         Return JSON only with: title (string), summary (string), sections (array of objects with heading and body), \
         flashcards (10-20 objects with front, back, and sourcePage as a page number or null), and sourceNotes (string). \
         A section body may use simple Markdown: \"- \" or \"1. \" lists, **bold**, *italic*, \"> \" quotes and pipe tables \
         with a header row. Do not use links, images or HTML. \
         Keep explanations clear for a student pilot. When the source is ambiguous or may be outdated, say so. \
         This is a study aid, not operational flight instruction; remind the learner to verify current FAA, aircraft, \
         flight-school, and instructor guidance.";

    study_aid_request(ctx, source, prompt, 8192, false).await
}

async fn study_aid_request(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    prompt: &str,
    output_tokens: u32,
    guide_only: bool,
) -> Result<GeneratedStudyAid, String> {
    let build = |part: Value| {
        let mut request = json!({
            "contents": [{"role": "user", "parts": [
                {"text": prompt},
                part
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
                "maxOutputTokens": output_tokens
            }
        });
        if guide_only {
            let schema = &mut request["generationConfig"]["responseSchema"];
            schema["required"] = json!(["title", "summary", "sections", "sourceNotes"]);
            schema["properties"]
                .as_object_mut()
                .unwrap()
                .remove("flashcards");
        }
        request
    };
    let (raw, model_used) = run_generation(ctx, source, &build).await?;

    ctx.budget.reset_stage(Stage::Validating);
    ctx.budget.validation_checkpoint()?;
    ctx.budget.categorize("invalid or incomplete output");
    let text = extract_text(&raw)?;
    let mut value: Value = serde_json::from_str(&text)
        .map_err(|_| "Gemini's study guide was incomplete. Try generating it again.".to_string())?;
    // Guide cards are outside this unit's contract. Ignore even malformed cards
    // before deserializing; only separately validated card units enter the set.
    if guide_only {
        if let Some(object) = value.as_object_mut() {
            object.insert("flashcards".to_string(), json!([]));
        }
    }
    let mut result: GeneratedStudyAid = serde_json::from_value(value)
        .map_err(|_| "Gemini's study guide was incomplete. Try generating it again.".to_string())?;
    result.model = model_used.to_string();
    ctx.budget.validation_checkpoint()?;
    Ok(result)
}

/// Pull the model's actual answer out of Gemini's response envelope.
///
/// Shared by every kind of generation this application asks Gemini for, so a
/// malformed envelope is refused the same way regardless of what was asked.
pub(crate) fn extract_text(raw: &str) -> Result<String, String> {
    let envelope: Value = serde_json::from_str(raw)
        .map_err(|_| "Gemini returned an unreadable response.".to_string())?;
    if envelope
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
        .is_some_and(|v| v != "BLOCK_REASON_UNSPECIFIED")
    {
        return Err("Gemini blocked this source and did not create a study aid. Check the selected source; repeating the same request may not help.".to_string());
    }
    if let Some(reason) = envelope
        .pointer("/candidates/0/finishReason")
        .and_then(Value::as_str)
    {
        match reason {
            "STOP" => {},
            "MAX_TOKENS" => return Err("Gemini's answer reached its output limit and is incomplete. Nothing was saved. Choose a chapter or fewer pages and try again.".to_string()),
            "SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII" => return Err("Gemini blocked this answer. Nothing was saved; check the selected source before trying again.".to_string()),
            _ => return Err("Gemini stopped before completing its answer. Nothing was saved; try a smaller selected source.".to_string()),
        }
    }
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
    material_id: String,
    base_revision: Option<String>,
    request_id: Option<String>,
) -> Result<JobAnswer<GeneratedPracticeTest>, String> {
    // The context is recorded before the key is read, so a disconnect or key
    // change at any later point makes this operation stale.
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let epoch = prepared_sources().epoch();
    let (api_key, source) = budget
        .run(prepare_submission(&app, &relative_path))
        .await
        .map_err(|_| gemini_files::out_of_time(&budget, "preparing the document"))??;
    let root = app_root(&app)?;
    let choice = load_choice(&root);
    let http = generation_client()?;
    // The invocation budget already includes source preparation.
    // Progress names this job and reports the stages actually reached.
    let reporter = reporter_for(&app, &material_id, JobKind::PracticeTest);
    reporter.follow(&budget);
    let progress = |message: String| reporter.say(message);
    let started = |job_id: &str| reporter.started(job_id);
    let ctx = GenContext {
        http: &http,
        base: GOOGLE_BASE,
        api_key: &api_key,
        choice,
        cache: prepared_sources(),
        epoch,
        budget: &budget,
        say: &progress,
    };
    as_job_with(
        &root,
        JobKind::PracticeTest,
        &material_id,
        base_revision.as_deref(),
        &source,
        async {
            practice_test_with(&ctx, &source)
                .await
                .map_err(|m| format!("{m}\n{}", budget.details(None)))
        },
        &job_changed(&app),
        JobHooks {
            started: Some(&started),
            cancellable: true,
            request_id: request_id.as_deref(),
            budget: Some(&budget),
        },
    )
    .await
}

/// A practice test from the selected source; the same prepared PDF a study
/// guide used is referred to again, not re-sent.
async fn practice_test_with(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
) -> Result<GeneratedPracticeTest, String> {
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

    let build = |part: Value| {
        json!({
            "contents": [{"role": "user", "parts": [
                {"text": prompt},
                part
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
        })
    };
    let (raw, model_used) = run_generation(ctx, source, &build).await?;
    ctx.budget.reset_stage(Stage::Validating);
    ctx.budget.validation_checkpoint()?;
    ctx.budget.categorize("invalid or incomplete output");
    let text = extract_text(&raw)?;
    let result: GeneratedPracticeTest = serde_json::from_str(&text).map_err(|_| {
        "Gemini's practice test was incomplete. Try generating it again.".to_string()
    })?;
    let mut result = sanitize_practice_test(result)?;
    result.model = model_used.to_string();
    ctx.budget.validation_checkpoint()?;
    Ok(result)
}

/// One request to one model.
async fn generate_once(
    ctx: &GenContext<'_>,
    model: &str,
    body: &Value,
) -> Result<Attempt, Failure> {
    // Every request has only what remains of the generation's one budget.
    ctx.budget.reset_stage(Stage::Generating);
    let Some(timeout) = ctx.budget.upload_timeout() else {
        return Err(gemini_files::out_of_time(ctx.budget, "asking Gemini").into());
    };
    if !ctx.budget.checkpoint() {
        return Err(gemini_budget::CHECKPOINT_FAILED.to_string().into());
    }
    // Immediately before the request: a cancel recorded by now prevents it,
    // however far one poll of the work has run (GENREL04-R5).
    if !ctx.budget.admit() {
        return Err(gemini_cancel::CANCELLED.to_string().into());
    }
    let url = format!("{}/v1beta/models/{model}:generateContent", ctx.base);
    let sent = ctx
        .budget
        .guard_stage(
            ctx.http
                .post(url)
                .header("x-goog-api-key", ctx.api_key)
                .json(body)
                .timeout(timeout)
                .send(),
        )
        .await;
    let mut response = match sent {
        Err(()) if ctx.budget.cancelled() => {
            return Err(gemini_cancel::CANCELLED.to_string().into())
        }
        Err(()) => return Ok(Attempt::Lost(Lost::NoAnswerInTime)),
        Ok(sent) => match sent {
            Ok(response) => response,
            // Checked first: a connect timeout is also a timeout, but nothing
            // reached Google, so it is safe to try again.
            Err(error) if error.is_connect() => return Ok(Attempt::Lost(Lost::Unreachable)),
            Err(error) if error.is_timeout() => return Ok(Attempt::Lost(Lost::NoAnswerInTime)),
            Err(_) => return Ok(Attempt::Lost(Lost::Dropped)),
        },
    };

    let status = response.status().as_u16();
    ctx.budget.saw_status(status);
    let retry_after = gemini_budget::retry_after(
        response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok()),
    );
    ctx.budget.reset_stage(Stage::Reading);
    if !ctx.budget.checkpoint() {
        return Err(gemini_budget::CHECKPOINT_FAILED.to_string().into());
    }
    const MAX_ANSWER_BYTES: usize = 1024 * 1024;
    let mut bytes = Vec::new();
    loop {
        match ctx.budget.guard_stage(response.chunk()).await {
            Err(()) if ctx.budget.cancelled() => {
                return Err(gemini_cancel::CANCELLED.to_string().into())
            }
            Err(()) => return Ok(Attempt::Lost(Lost::AnswerCutShort)),
            Ok(chunk) => match chunk {
                Ok(Some(chunk)) => {
                    if bytes.len().saturating_add(chunk.len()) > MAX_ANSWER_BYTES {
                        return Err("Gemini's answer exceeded the 1 MiB response limit. The earlier draft is kept.".to_string().into());
                    }
                    if !chunk.is_empty() {
                        ctx.budget.reset_stage(Stage::Reading);
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(error) if error.is_timeout() => return Ok(Attempt::Lost(Lost::AnswerCutShort)),
                Err(_) => return Ok(Attempt::Lost(Lost::Dropped)),
            },
        }
    }
    let raw = String::from_utf8(bytes)
        .map_err(|_| Failure::from("Gemini's answer was not readable text.".to_string()))?;

    if (200..300).contains(&status) {
        Ok(Attempt::Answered(raw))
    } else {
        Ok(Attempt::Refused {
            status,
            body: raw,
            retry_after,
        })
    }
}

/// Why generation ended without an answer: the message, and the status of a
/// refusal Google will not reconsider (so a missing prepared file can be told
/// apart from a missing model).
pub(crate) struct Failure {
    pub(crate) message: String,
    pub(crate) status: Option<u16>,
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure {
            message,
            status: None,
        }
    }
}

/// What the last attempt ran into, for the closing message when the attempts
/// or the time run out.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Setback {
    Busy,
    RateLimited,
    Lost(Lost),
}

/// Ask until Google answers, refuses for good, or the attempts or the budget
/// run out (GEN-REL-03).
///
/// At most `MAX_GENERATION_ATTEMPTS` requests, the backup model included: the
/// main model, the main model again after a pause, then the backup. A pause is
/// Google's own `Retry-After` when it gives one, otherwise a growing backoff,
/// and it is taken only if it fits in what remains of the one budget. Only
/// failures worth waiting out are retried: capacity (408, 5xx), a temporary
/// rate limit, a connection that was never made, and a connection dropped
/// after sending (honestly described, since Google may have finished it). A
/// request that times out has used the whole budget, so nothing follows it.
///
/// Returns the response body and the model that produced it.
pub(crate) async fn generate_with_retries_at(
    ctx: &GenContext<'_>,
    body: &Value,
) -> Result<(String, &'static str), Failure> {
    let choice = ctx.choice;
    let mut model = choice.primary();
    let mut on_fallback = false;
    let mut setback: Option<Setback> = None;
    let mut retry = 0u32;

    loop {
        // Every request, including one after a pause, belongs to the context
        // the generation began in.
        if !ctx.current() {
            return Err(GenContext::stale());
        }
        if ctx.budget.remaining().is_zero() {
            return Err(gemini_files::out_of_time(ctx.budget, "asking Gemini").into());
        }
        let Some(attempt) = ctx.budget.start_attempt() else {
            break;
        };
        if attempt == MAX_GENERATION_ATTEMPTS && !on_fallback {
            // The last attempt goes to the backup model: a model-specific
            // capacity or rate limit may spare it.
            model = choice.fallback();
            on_fallback = true;
            (ctx.say)(choice.fallback_notice().to_string());
        }

        let mut retry_after = None;
        match generate_once(ctx, model, body).await? {
            Attempt::Answered(raw) => return Ok((raw, model)),
            Attempt::Refused {
                status,
                body,
                retry_after: asked,
            } => {
                if status == 429 && is_lasting_quota(&body) {
                    ctx.budget.categorize("quota used up");
                    return Err(Failure {
                        message: quota_message(),
                        status: Some(status),
                    });
                }
                if !is_retryable(status) {
                    ctx.budget.categorize("refused");
                    return Err(Failure {
                        message: describe_refusal(RefusalContext::Generation, status, &body, model),
                        status: Some(status),
                    });
                }
                setback = Some(if status == 429 {
                    Setback::RateLimited
                } else {
                    Setback::Busy
                });
                retry_after = asked;
                if !on_fallback && moves_straight_to_fallback(choice, status) {
                    model = choice.fallback();
                    on_fallback = true;
                    (ctx.say)(choice.fallback_notice().to_string());
                }
            }
            Attempt::Lost(lost @ (Lost::NoAnswerInTime | Lost::AnswerCutShort)) => {
                // The request had all the time that was left.
                ctx.budget.categorize(lost.category());
                return Err(lost_message(lost, ctx.budget).into());
            }
            Attempt::Lost(lost) => setback = Some(Setback::Lost(lost)),
        }

        if attempt >= MAX_GENERATION_ATTEMPTS {
            break;
        }
        let pause = retry_after.unwrap_or_else(|| backoff_delay(retry, jitter_millis()));
        retry += 1;
        (ctx.say)(waiting_message(setback, ctx.budget.attempts() + 1, pause));
        if !ctx.budget.pause(pause).await {
            if ctx.budget.cancelled() {
                return Err(gemini_cancel::CANCELLED.to_string().into());
            }
            ctx.budget.categorize("time limit reached");
            return Err(match retry_after {
                Some(asked) => retry_after_message(asked, ctx.budget),
                None => gemini_files::out_of_time(ctx.budget, "trying again"),
            }
            .into());
        }
    }

    let tried = ctx.budget.attempts();
    Err(match setback {
        Some(Setback::RateLimited) => {
            ctx.budget.categorize("rate limited");
            rate_limit_message()
        }
        Some(Setback::Lost(lost)) => {
            ctx.budget.categorize(lost.category());
            lost_message(lost, ctx.budget)
        }
        _ => {
            ctx.budget.categorize("Google busy");
            busy_message(tried, on_fallback)
        }
    }
    .into())
}

/// Whether a refusal from the chosen model should skip the waiting and go
/// straight to the fallback.
///
/// The capable model can be limited separately. Switch after a temporary 429,
/// while still honoring Retry-After or the bounded backoff. Persistent quota
/// exhaustion is stopped earlier, before choosing any fallback.
fn moves_straight_to_fallback(choice: ModelChoice, status: u16) -> bool {
    choice == ModelChoice::MostCapable && status == 429
}

/// What the interface says during one of the pauses.
fn waiting_message(setback: Option<Setback>, next: u32, pause: Duration) -> String {
    let seconds = pause.as_millis().div_ceil(1000);
    let what = match setback {
        Some(Setback::Lost(Lost::Unreachable)) => "Could not reach Google.",
        Some(Setback::Lost(_)) => "The connection to Google was interrupted. Google may have processed the request; trying again may incur additional charges.",
        _ => "Gemini is busy or rate-limited.",
    };
    format!("{what} Waiting {seconds} seconds, then trying again — attempt {next} of {MAX_GENERATION_ATTEMPTS}.")
}

/// Said after every attempt met a busy Google.
///
/// It names what was tried, not how long it took: each request may also have
/// waited, so a duration worked out from the pauses alone would understate it.
fn busy_message(tried: u32, used_backup: bool) -> String {
    let backup = if used_backup {
        ", the last of them with the backup Flash-Lite model,"
    } else {
        ""
    };
    format!(
        "Google's servers are busy. Her Flight Deck asked {tried} times{backup} pausing between \
         attempts, and Google was still at capacity. This is Google's side, not your key or your \
         document — the same file usually works a few minutes later."
    )
}

/// Said when a key has used up its allowance for the day, or has none for this
/// model: waiting a few minutes cannot help, so nothing is retried.
fn quota_message() -> String {
    "Google reports an exhausted daily allowance or no available quota for this model. Automatic retries have stopped. Check the quota reset, plan and billing in Google AI Studio, or choose the standard model in Settings.".to_string()
}

/// Said when Google asked for a pause longer than the time that remains.
fn retry_after_message(asked: Duration, budget: &Budget) -> String {
    let wait = gemini_budget::describe(asked);
    format!(
        "Google asked Her Flight Deck to wait {wait} before trying again, which is longer than the time left of the {} it allows for one study aid. Nothing was saved; try again after that.",
        gemini_budget::describe(budget.total())
    )
}

/// Said when no complete reply arrived. Only a connection that was never made
/// points at the internet connection.
fn lost_message(lost: Lost, budget: &Budget) -> String {
    if budget.stage_policy() {
        match lost {
            Lost::NoAnswerInTime => {
                return "Gemini is taking longer to answer. You can try again.".into()
            }
            Lost::AnswerCutShort => return "The rest of the answer stopped arriving.".into(),
            _ => {}
        }
    }
    let limit = gemini_budget::describe(budget.total());
    match lost {
        Lost::Unreachable => "Could not reach Google, even after trying again. Check the internet connection. No complete answer was received; an earlier attempt may still have reached Google.".to_string(),
        Lost::NoAnswerInTime => format!(
            "Gemini did not answer within the {limit} Her Flight Deck allows for one study aid. Google may still have been working on it. Repeating the request may incur additional charges. Nothing was saved. Large documents take longest: choosing a chapter or fewer pages first usually helps. If short documents also stop like this, check the connection."
        ),
        Lost::AnswerCutShort => format!(
            "Gemini started answering, but the rest did not arrive within the {limit} Her Flight Deck allows for one study aid. Nothing was saved. Google may have processed this request; repeating it may incur additional charges. Try a chapter or fewer pages to reduce the wait."
        ),
        Lost::Dropped => "The connection to Google was interrupted after the request was sent, even after trying again. Google may or may not have finished it. Repeated requests may incur additional provider charges. Nothing was saved. Try again in a few minutes.".to_string(),
    }
}

/// Whether a 429 is a lasting quota rather than a moment's rate limit: a daily
/// allowance used up, or none at all on this plan. Read from Google's error
/// details only; the message text is never shown.
fn is_lasting_quota(raw: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return false;
    };
    let violations = value
        .pointer("/error/details")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|detail| detail.get("violations").and_then(Value::as_array))
        .flatten();
    let mut lasting = false;
    for violation in violations {
        let id = violation
            .get("quotaId")
            .and_then(Value::as_str)
            .unwrap_or("");
        if id.contains("PerDay") {
            lasting = true;
        }
        if violation
            .get("quotaValue")
            .is_some_and(|v| v.as_str() == Some("0") || v.as_u64() == Some(0))
        {
            lasting = true;
        }
    }
    lasting
}

/// Said after generation's retries and backup model ended on a rate limit.
fn rate_limit_message() -> String {
    "Gemini's rate or spending limit was reached for this project. Her Flight Deck retried briefly and tried its backup model. Check the project's limits and billing in Google AI Studio, or wait and try again.".to_string()
}

/// A rate limit seen without generation's retry history (the connection check,
/// or a single refusal), so it claims nothing about what else was tried.
fn rate_limited_now_message(context: RefusalContext) -> String {
    match context {
        RefusalContext::Verification => "Gemini's rate or spending limit was reached for this project, so the key could not be checked. Check the project's limits and billing in Google AI Studio, or wait and try again.".to_string(),
        RefusalContext::Generation => "Gemini's rate or spending limit was reached for this project. Check the project's limits and billing in Google AI Studio, or wait and try again.".to_string(),
    }
}

/// Google's capacity was short, seen without generation's retry history.
fn busy_now_message(context: RefusalContext) -> String {
    match context {
        RefusalContext::Verification => "Google's servers are busy, so the key could not be checked right now. This is Google's side, not necessarily your key — try connecting again in a few minutes.".to_string(),
        RefusalContext::Generation => "Google's servers are busy right now. This is Google's side, not your key or your document — try again in a few minutes.".to_string(),
    }
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
///
/// It sees one response, not the retries around it, so its rate-limit and busy
/// wording claims no attempts or backup model. Generation's own exhausted
/// outcomes use `busy_message` and `rate_limit_message`, which do.
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
        403 if model == CAPABLE_MODEL => {
            "Google did not allow this key to use Gemini 4 Argon. It needs a key with billing turned on. Turn on billing for this key in Google AI Studio, or choose the standard model in Settings.".to_string()
        }
        403 => {
            "Google denied project or API access. Check API key restrictions, API enablement, permissions, or project/billing configuration in Google AI Studio or Google Cloud Console.".to_string()
        }
        // Google retires a model on a published date. When that day comes this
        // build asks for something that no longer exists, and the honest answer
        // is that the application needs updating, not that her key is wrong.
        402 => "Google requires payment or additional credits for this request. Automatic retries have stopped; check billing in Google AI Studio.".to_string(),
        404 => format!(
            "Google could not find the {model} model or does not support this request for it. Check for an app update and the model's availability for this project in Google AI Studio. A 404 alone does not establish model retirement."
        ),
        429 => rate_limited_now_message(context),
        500..=504 => busy_now_message(context),
        // Fixed wording: Google's own message text is never repeated, since it
        // can echo an uploaded file's name or address, or other request values.
        _ => format!(
            "Google refused the request ({status}). Nothing was saved; try again in a few minutes, or try a different file."
        ),
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
    fn missing_model_404_mentions_availability_and_update_without_inventing_retirement() {
        let message = describe_refusal(RefusalContext::Generation, 404, "{}", MODEL);
        assert!(message.contains("could not find"));
        assert!(!message.contains("has retired"));
        assert!(message.contains(MODEL));
        assert!(message.contains("app update"));
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
    fn the_busy_message_blames_google_not_the_key() {
        let message = busy_message(MAX_GENERATION_ATTEMPTS, true);
        assert!(message.contains("busy"));
        assert!(message.contains("not your key"));
    }

    /// Phrases that claim a retry history: how many requests were made, that the
    /// backup model was tried, or how long it all took.
    fn claims_retry_history(message: &str) -> bool {
        message.contains("tried")
            || message.contains("retried")
            || message.contains("backup")
            || message.contains("Flash-Lite")
            || message.contains(&format!("{MAX_GENERATION_ATTEMPTS} times"))
    }

    #[test]
    fn a6_the_exhausted_busy_message_makes_no_elapsed_time_claim() {
        // The nominal pauses leave out request time (up to the generation
        // timeout per request), jitter and the backup request, so any duration
        // here would understate the real wait.
        let message = busy_message(MAX_GENERATION_ATTEMPTS, true);
        assert!(!message.contains("second"), "{message}");
        assert!(!message.contains("over about"), "{message}");
        assert!(
            !message.contains("minute") || message.contains("minutes later"),
            "{message}"
        );
    }

    #[test]
    fn a6_the_exhausted_messages_still_say_what_generation_actually_tried() {
        let busy = busy_message(MAX_GENERATION_ATTEMPTS, true);
        assert!(
            busy.contains(&format!("{MAX_GENERATION_ATTEMPTS} times")),
            "{busy}"
        );
        assert!(busy.contains("backup"), "{busy}");
        assert!(busy.contains("not your key"), "{busy}");
        let limited = rate_limit_message();
        assert!(limited.contains("rate or spending limit"), "{limited}");
        assert!(limited.contains("backup"), "{limited}");
    }

    #[test]
    fn a6_connection_check_refusals_do_not_claim_a_backup_model_or_retry_count() {
        // Checking a key retries the primary model only and never uses the
        // backup, so it must not borrow generation's retry history.
        let limited = describe_refusal(RefusalContext::Verification, 429, "{}", MODEL);
        assert!(limited.contains("rate or spending limit"), "{limited}");
        assert!(!claims_retry_history(&limited), "{limited}");
        for status in [500, 502, 503, 504] {
            let busy = describe_refusal(RefusalContext::Verification, status, "{}", MODEL);
            assert!(busy.contains("busy"), "{status}: {busy}");
            assert!(!claims_retry_history(&busy), "{status}: {busy}");
            assert!(!busy.contains("second"), "{status}: {busy}");
        }
    }

    #[test]
    fn a6_a_single_refusal_without_retry_context_stays_generic() {
        // describe_refusal knows only one response, never the retries around it.
        for status in [429, 500, 503] {
            let message = describe_refusal(RefusalContext::Generation, status, "{}", MODEL);
            assert!(!claims_retry_history(&message), "{status}: {message}");
        }
    }

    #[test]
    fn a_wait_says_how_long_and_which_attempt_is_next() {
        let message = waiting_message(None, 2, Duration::from_millis(1_500));
        assert!(message.contains("2 seconds"));
        // Attempt 2 of 4: the one about to happen, counted the way she counts.
        assert!(message.contains("attempt 2 of 3"));
        assert!(waiting_message(None, 3, Duration::from_millis(6_000)).contains("attempt 3 of 3"));
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

    /// A private directory to play the part of her application data folder.
    fn choice_scratch(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hfd-gemini-choice-{label}-{}-{}",
            std::process::id(),
            jitter_millis()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn each_choice_names_its_models_and_round_trips_its_label() {
        assert_eq!(ModelChoice::Standard.primary(), MODEL);
        assert_eq!(ModelChoice::Standard.fallback(), FALLBACK_MODEL);
        assert_eq!(ModelChoice::MostCapable.primary(), CAPABLE_MODEL);
        // When Argon cannot answer, her request falls back to the standard
        // model rather than straight to the lightest one.
        assert_eq!(ModelChoice::MostCapable.fallback(), MODEL);
        for choice in [ModelChoice::Standard, ModelChoice::MostCapable] {
            assert_eq!(ModelChoice::parse(choice.as_str()), Some(choice));
        }
        assert_eq!(
            ModelChoice::parse(" most-capable\n"),
            Some(ModelChoice::MostCapable)
        );
        assert_eq!(ModelChoice::parse("gemini-4-argon"), None);
        assert_eq!(ModelChoice::parse(""), None);
    }

    #[test]
    fn a_missing_damaged_or_unknown_choice_means_the_standard_model() {
        let root = choice_scratch("default");
        assert_eq!(load_choice(&root), ModelChoice::Standard);
        std::fs::write(root.join(MODEL_CHOICE_FILE), "pro-please").unwrap();
        assert_eq!(load_choice(&root), ModelChoice::Standard);
        std::fs::write(root.join(MODEL_CHOICE_FILE), [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(load_choice(&root), ModelChoice::Standard);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_saved_choice_survives_and_can_be_changed_back() {
        let root = choice_scratch("save");
        save_choice(&root, ModelChoice::MostCapable).unwrap();
        assert_eq!(load_choice(&root), ModelChoice::MostCapable);
        assert!(!root.join(MODEL_CHOICE_WRITING).exists());
        save_choice(&root, ModelChoice::Standard).unwrap();
        assert_eq!(load_choice(&root), ModelChoice::Standard);
        // The key file is a different file and is never touched.
        assert_ne!(MODEL_CHOICE_FILE, crate::secrets::KEY_FILE);
        assert!(!root.join(crate::secrets::KEY_FILE).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn status_reports_the_model_her_choice_sends_documents_to() {
        let standard = GeminiStatus::new(true, ModelChoice::Standard);
        assert_eq!((standard.model, standard.choice), (MODEL, "standard"));
        let capable = GeminiStatus::new(false, ModelChoice::MostCapable);
        assert_eq!(
            (capable.model, capable.choice),
            (CAPABLE_MODEL, "most-capable")
        );
    }

    #[test]
    fn only_argons_rate_limit_skips_straight_to_the_standard_model() {
        assert!(moves_straight_to_fallback(ModelChoice::MostCapable, 429));
        for status in [400, 403, 404, 500, 502, 503, 504] {
            assert!(!moves_straight_to_fallback(
                ModelChoice::MostCapable,
                status
            ));
        }
        for status in [429, 503] {
            assert!(!moves_straight_to_fallback(ModelChoice::Standard, status));
        }
    }

    #[test]
    fn a_403_from_argon_explains_billing_and_the_standard_choice() {
        let message = describe_refusal(RefusalContext::Generation, 403, "{}", CAPABLE_MODEL);
        assert!(message.contains("Gemini 4 Argon"));
        assert!(message.contains("billing"));
        assert!(message.contains("standard model in Settings"));
        let standard = describe_refusal(RefusalContext::Generation, 403, "{}", MODEL);
        assert!(!standard.contains("Argon"));
        assert!(standard.contains("billing configuration"));
    }

    #[test]
    fn the_fallback_notices_name_what_is_happening() {
        assert_eq!(
            ModelChoice::Standard.fallback_notice(),
            "Trying the backup Gemini model…"
        );
        assert!(ModelChoice::MostCapable
            .fallback_notice()
            .contains("trying the standard Gemini model"));
    }
}

#[cfg(test)]
#[path = "gemini_slowlink_tests.rs"]
mod slowlink_tests;

#[cfg(test)]
#[path = "gemini_generation_tests.rs"]
mod generation_tests;

#[cfg(test)]
#[path = "gemini_recovery_tests.rs"]
mod recovery_tests;

#[cfg(test)]
#[path = "gemini_cancel_flow_tests.rs"]
mod cancel_flow_tests;

#[path = "gemini_batches.rs"]
mod batches;

#[path = "gemini_sections.rs"]
pub(crate) mod sections;
