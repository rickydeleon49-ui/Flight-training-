//! Claude's Messages adapter. No remote Files API or persistent source copies.
use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

pub(crate) const BASE: &str = "https://api.anthropic.com";
pub(crate) const MODEL: &str = "claude-haiku-5-5";
const VERSION: &str = "2026-10-21";
const MAX_REQUEST_BYTES: usize = 32_000_000;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ClaudeProvider;

pub(crate) fn translate_schema(schema: &Value) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        let kind = kind.to_lowercase();
        out.insert(
            "type".into(),
            if schema["nullable"] == true {
                json!([kind, "null"])
            } else {
                json!(kind)
            },
        );
        if kind == "object" {
            let properties: serde_json::Map<String, Value> = schema["properties"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(key, value)| (key.clone(), translate_schema(value)))
                .collect();
            out.insert(
                "required".into(),
                json!(properties.keys().collect::<Vec<_>>()),
            );
            out.insert("properties".into(), json!(properties));
            out.insert("additionalProperties".into(), json!(false));
        }
    }
    if let Some(items) = schema.get("items") {
        out.insert("items".into(), translate_schema(items));
    }
    if let Some(values) = schema.get("enum") {
        out.insert("enum".into(), values.clone());
    }
    Value::Object(out)
}

pub(crate) fn source_part(source: &LoadedSource) -> Value {
    if source.mime == "text/plain" {
        return json!({"type":"text", "text":String::from_utf8_lossy(&source.bytes)});
    }
    json!({"type":if source.mime == "application/pdf" {"document"} else {"image"},
        "source":{"type":"base64","media_type":source.mime,"data":BASE64.encode(&source.bytes)}})
}

pub(crate) fn check_source(source: &LoadedSource) -> Result<(), String> {
    if source.mime == "application/pdf" {
        let pages = lopdf::Document::load_mem(&source.bytes).ok().map(|pdf| pdf.get_pages().len() as u32).or(source.page_count)
            .ok_or_else(|| "Could not count this PDF's pages. Take out the chapter you are studying and try again.".to_string())?;
        check_pages(pages)?;
    }
    // Account for base64 before allocating a full request. Exact encoded JSON
    // size (including prompt/schema) is checked again immediately before send.
    check_size(source.bytes.len() as u64)
}

pub(crate) fn check_pages(pages: u32) -> Result<(), String> {
    if pages > 300 {
        return Err(format!("That PDF is {pages} pages, over the 300 this app sends to Anthropic at a time. Take out the chapter you are studying and make the study aid from that — a study aid from one chapter is more useful than one from the whole book anyway."));
    }
    Ok(())
}

pub(crate) fn check_size(bytes: u64) -> Result<(), String> {
    if bytes.div_ceil(3).saturating_mul(4) > MAX_REQUEST_BYTES as u64 {
        return Err(error_message(413));
    }
    Ok(())
}

pub(crate) fn check_request(body: &Value) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(body).map_err(|_| "The request could not be prepared.".to_string())?;
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err(error_message(413));
    }
    Ok(())
}

impl ClaudeProvider {
    pub(crate) fn body(self, model: &str, body: &Value) -> Value {
        // Feature builders share a content/schema contract with Gemini. Only
        // this adapter knows Claude's wire envelope. Documents precede text.
        let parts = body.pointer("/contents/0/parts").and_then(Value::as_array);
        let mut content = Vec::new();
        let mut text = Vec::new();
        for part in parts.into_iter().flatten() {
            if part.get("source").is_some() {
                content.push(part.clone());
            } else if let Some(value) = part.get("text").and_then(Value::as_str) {
                text.push(json!({"type":"text", "text":value}));
            }
        }
        content.extend(text);
        json!({"model":model,"max_tokens":16000,"messages":[{"role":"user","content":content}],
            "output_config":{"effort":"low","format":{"type":"json_schema",
                "schema":translate_schema(&body["generationConfig"]["responseSchema"])}}})
    }
    pub(crate) fn request(
        self,
        http: &Client,
        base: &str,
        key: &str,
        model: &str,
        body: &Value,
    ) -> reqwest::RequestBuilder {
        http.post(format!("{base}/v1/messages"))
            .header("x-api-key", key)
            .header("anthropic-version", VERSION)
            .json(&self.body(model, body))
    }
    pub(crate) async fn generate_json(
        self,
        ctx: &GenContext<'_>,
        model: &str,
        body: &Value,
    ) -> Result<Attempt, Failure> {
        check_request(&self.body(model, body))?;
        crate::gemini::provider_impl::generate_once_for(ctx, AnyProvider::Claude(self), model, body)
            .await
    }
    pub(crate) async fn verify_key(self, key: &str) -> Result<(), String> {
        self.verify_at(BASE, key).await
    }
    pub(crate) async fn verify_at(self, base: &str, key: &str) -> Result<(), String> {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Could not start the connection to Claude.".to_string())?;
        let budget = Budget::new(Duration::from_secs(30));
        for attempt in 0..4 {
            let timeout = budget.remaining();
            if timeout.is_zero() {
                break;
            }
            let response = http
                .get(format!("{base}/v1/models/{MODEL}"))
                .header("x-api-key", key)
                .header("anthropic-version", VERSION)
                .header("content-type", "application/json")
                .timeout(timeout)
                .send()
                .await
                .map_err(|_| {
                    "Could not reach Claude. Check the internet connection and try again."
                        .to_string()
                })?;
            let status = response.status().as_u16();
            if status == 200 {
                return Ok(());
            }
            if !matches!(status, 429 | 500 | 502 | 503 | 504 | 529) {
                return Err(error_message(status));
            }
            if attempt == 3 {
                break;
            }
            let wait = crate::gemini_budget::retry_after(
                response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok()),
            )
            .unwrap_or(Duration::from_millis(1500 * (1 << attempt)));
            if !budget.pause(wait).await {
                break;
            }
        }
        Err("Claude is busy, so the key could not be checked. Wait a little and try again.".into())
    }
}

pub(crate) fn error_message(status: u16) -> String {
    match status {
        401 => "Claude didn't accept this key. Check it in Settings.",
        403 => "Claude did not allow this request. Check this key's access in Anthropic's console.",
        404 => "Claude could not find this model. Check for an app update.",
        413 => "That file is too large to send to Anthropic. Take out the chapter you are studying and try again.",
        429 | 500..=599 => "Claude is busy or rate-limited. Her Flight Deck retried briefly. Wait a little and try again.",
        _ => "Claude could not accept this request. Try a different section or question.",
    }.to_string()
}

pub(crate) fn refusal(status: u16, retry_after: Option<Duration>) -> RefusalKind {
    match status {
        401 => RefusalKind::InvalidKey,
        429 | 529 => RefusalKind::RateLimited(retry_after),
        404 => RefusalKind::ModelGone,
        _ => RefusalKind::Other(error_message(status)),
    }
}

pub(crate) fn extract_text(raw: &str) -> Result<String, String> {
    let envelope: Value = serde_json::from_str(raw)
        .map_err(|_| "Claude returned an unreadable response.".to_string())?;
    match envelope["stop_reason"].as_str() {
        Some("end_turn") => {},
        Some("max_tokens") => return Err("Claude's answer reached its output limit and is incomplete. Nothing was saved. Choose a chapter or fewer pages and try again.".into()),
        Some("refusal") => return Err("Claude declined to answer this one. Try a different section or question.".into()),
        _ => return Err("Claude stopped before completing its answer. Nothing was saved; try a smaller selected source.".into()),
    }
    let text: String = envelope["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    if text.trim().is_empty() {
        return Err("Claude did not return a usable answer. Try the document again.".into());
    }
    Ok(text)
}
