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
use tauri::AppHandle;

use crate::documents;
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
/// Google publishes a shutdown date per model, so this constant has an expiry
/// and moving it forward is a normal part of a release. `gemini-2.5-flash`,
/// which this replaces, shuts down on 16 October 2026.
const MODEL: &str = "gemini-3.5-flash";
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

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
    let response = client(VERIFY_TIMEOUT)?
        .get(url)
        .header("x-goog-api-key", api_key)
        .send()
        .await
        .map_err(|e| describe_transport_error(&e))?;

    if response.status().is_success() {
        return Ok(());
    }

    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    if matches!(status.as_u16(), 400 | 401 | 403) {
        Err(
            "Google did not accept that key. Check it in Google AI Studio and try again."
                .to_string(),
        )
    } else if status.as_u16() == 404 {
        // Her key is fine; this build is asking for a model that is gone.
        // Blaming the key would send her to fix something that is not broken.
        Err(format!(
            "Google has retired the {MODEL} model this version of Her Flight Deck uses. Install the latest version and try again."
        ))
    } else {
        Err(format!(
            "Gemini returned {status}: {}",
            compact_error(&detail)
        ))
    }
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

#[tauri::command]
pub async fn generate_study_aid(
    app: AppHandle,
    relative_path: String,
    material_title: String,
) -> Result<GeneratedStudyAid, String> {
    let api_key = stored_key(&app)?;
    let path = documents::stored_document_path(&app, &relative_path)?;
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Could not read that study file: {e}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err("That file is larger than Gemini's 50 MB document limit.".to_string());
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    let mime = mime_type(file_name)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read that study file: {e}"))?;

    let prompt = format!(
        "Create an accurate private-pilot study aid from the attached source titled {material_title:?}. \
         Use only facts supported by the source. Do not invent regulations, procedures, numbers, or page references. \
         Return JSON only with: title (string), summary (string), sections (array of objects with heading and body), \
         flashcards (10-20 objects with front, back, and sourcePage as a page number or null), and sourceNotes (string). \
         Keep explanations clear for a student pilot. When the source is ambiguous or may be outdated, say so. \
         This is a study aid, not operational flight instruction; remind the learner to verify current FAA, aircraft, \
         flight-school, and instructor guidance."
    );

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
            "temperature": 0.2,
            "maxOutputTokens": 8192
        }
    });
    let url =
        format!("https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent");
    let response = client(GENERATE_TIMEOUT)?
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| describe_transport_error(&e))?;

    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Could not read Gemini's response: {e}"))?;
    if !status.is_success() {
        if status.as_u16() == 429 {
            return Err("The free Gemini limit has been reached. Wait for Google's quota to reset, then try again.".to_string());
        }
        // Google retires a model on a published date. When that day comes this
        // build asks for something that no longer exists, and the honest answer
        // is that the application needs updating, not that her key is wrong.
        if status.as_u16() == 404 {
            return Err(format!(
                "Google has retired the {MODEL} model this version of Her Flight Deck uses. Install the latest version and try again."
            ));
        }
        return Err(format!("Gemini returned {status}: {}", compact_error(&raw)));
    }

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
    result.model = MODEL.to_string();
    Ok(result)
}
