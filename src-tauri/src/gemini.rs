//! Gemini connection and document analysis.
//!
//! The user supplies her own Google AI Studio key. It is stored by the
//! operating system's credential manager and never returned to JavaScript.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::documents;

const SERVICE: &str = "com.herflightdeck.app";
const ACCOUNT: &str = "gemini-api-key";
const MODEL: &str = "gemini-2.5-flash";
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

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

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("Could not open secure credential storage: {e}"))
}

fn stored_key() -> Result<String, String> {
    entry()?
        .get_password()
        .map_err(|_| "Gemini is not connected. Connect it in Settings first.".to_string())
}

async fn verify_key(api_key: &str) -> Result<(), String> {
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{MODEL}");
    let response = Client::new()
        .get(url)
        .header("x-goog-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("Could not reach Gemini: {e}"))?;

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
pub fn gemini_status() -> GeminiStatus {
    GeminiStatus {
        configured: entry()
            .and_then(|item| item.get_password().map_err(|e| e.to_string()))
            .is_ok(),
        model: MODEL,
    }
}

#[tauri::command]
pub async fn configure_gemini(api_key: String) -> Result<GeminiStatus, String> {
    let trimmed = api_key.trim();
    if trimmed.len() < 20 {
        return Err("Paste the complete Gemini API key from Google AI Studio.".to_string());
    }
    verify_key(trimmed).await?;
    entry()?
        .set_password(trimmed)
        .map_err(|e| format!("Could not save the key securely: {e}"))?;
    Ok(GeminiStatus {
        configured: true,
        model: MODEL,
    })
}

#[tauri::command]
pub fn disconnect_gemini() -> Result<GeminiStatus, String> {
    let item = entry()?;
    match item.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(GeminiStatus {
            configured: false,
            model: MODEL,
        }),
        Err(e) => Err(format!("Could not remove the Gemini key: {e}")),
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

#[tauri::command]
pub async fn generate_study_aid(
    app: AppHandle,
    relative_path: String,
    material_title: String,
) -> Result<GeneratedStudyAid, String> {
    let api_key = stored_key()?;
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
    let response = Client::new()
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Gemini: {e}"))?;

    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Could not read Gemini's response: {e}"))?;
    if !status.is_success() {
        if status.as_u16() == 429 {
            return Err("The free Gemini limit has been reached. Wait for Google's quota to reset, then try again.".to_string());
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
