//! Claude's Messages adapter. No remote Files API or persistent source copies.
use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

pub(crate) const BASE: &str = "https://api.anthropic.com";
pub(crate) const MODEL: &str = "claude-haiku-5-5";
/// "Most capable": Sonnet 5.5. Both models allow 128K output, above every max_tokens we send.
pub(crate) const CAPABLE_MODEL: &str = "claude-sonnet-5-5";
/// Anthropic API version header. "2023-06-01" is the current stable value; a made-up date gets HTTP 400.
const VERSION: &str = "2023-06-01";
/// Output cap for every non-kit request. Haiku/Sonnet 5.5 think adaptively and
/// that thinking counts toward max_tokens, so 16,000 could be eaten before the
/// answer; both models allow 128K output. The kit keeps its own 49,152.
pub(crate) const MAX_OUTPUT_TOKENS: u32 = 32_000;
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
            // Every property is required. Keep the contract's own order (the
            // order Claude writes its answer in); any others follow alphabetically.
            let mut order: Vec<&str> = schema["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|key| properties.contains_key(*key))
                .collect();
            for key in properties.keys() {
                if !order.contains(&key.as_str()) {
                    order.push(key);
                }
            }
            out.insert("required".into(), json!(order));
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

/// Serialize a translated schema with every `properties` object written in the
/// order of its sibling `required` array (others alphabetical), because Claude's
/// structured output follows the schema's property order. Every piece goes through
/// serde_json, so the bytes parse back to exactly the same Value.
pub(crate) fn ordered_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut parts = Vec::with_capacity(map.len());
            for (key, inner) in map {
                let text = match (key.as_str(), inner) {
                    ("properties", Value::Object(props)) => {
                        let mut keys: Vec<&String> = Vec::with_capacity(props.len());
                        for name in map
                            .get("required")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                        {
                            if let Some((k, _)) = props.get_key_value(name) {
                                if !keys.contains(&k) {
                                    keys.push(k);
                                }
                            }
                        }
                        for k in props.keys() {
                            if !keys.contains(&k) {
                                keys.push(k);
                            }
                        }
                        let items: Vec<String> = keys
                            .into_iter()
                            .map(|k| {
                                format!(
                                    "{}:{}",
                                    serde_json::to_string(k).unwrap_or_default(),
                                    ordered_json(&props[k])
                                )
                            })
                            .collect();
                        format!("{{{}}}", items.join(","))
                    }
                    _ => ordered_json(inner),
                };
                parts.push(format!(
                    "{}:{}",
                    serde_json::to_string(key).unwrap_or_default(),
                    text
                ));
            }
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(ordered_json).collect::<Vec<_>>().join(",")
        ),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
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

#[cfg(test)]
pub(crate) fn check_request(body: &Value) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(body).map_err(|_| "The request could not be prepared.".to_string())?;
    check_wire(&bytes)
}

/// The cap applies to the bytes actually sent.
pub(crate) fn check_wire(bytes: &[u8]) -> Result<(), String> {
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
        // A combined kit needs room for all three outputs plus Haiku 5.5's
        // default adaptive thinking (128K output cap). Existing requests
        // retain their accepted 16,000-token Claude allowance.
        let tokens = if body["generationConfig"]["responseSchema"]["properties"]
            .get("guide")
            .is_some()
        {
            crate::gemini::study_kit::KIT_OUTPUT_TOKENS
        } else {
            MAX_OUTPUT_TOKENS
        };
        // Haiku thinks less (it was spending its budget before the answer);
        // Sonnet keeps "medium".
        let effort = if model == MODEL { "low" } else { "medium" };
        json!({"model":model,"max_tokens":tokens,"messages":[{"role":"user","content":content}],
            "output_config":{"effort":effort,"format":{"type":"json_schema",
                "schema":translate_schema(&body["generationConfig"]["responseSchema"])}}})
    }
    /// The exact bytes sent: `body()` with the schema's properties written in
    /// contract order (guide, then cards, then questions).
    pub(crate) fn wire(self, model: &str, body: &Value) -> Vec<u8> {
        let sent = self.body(model, body);
        let schema = ordered_json(&sent["output_config"]["format"]["schema"]);
        let json_str = |v: &Value| serde_json::to_string(v).unwrap_or_default();
        format!(
            "{{\"model\":{},\"max_tokens\":{},\"messages\":{},\"output_config\":{{\"effort\":{},\"format\":{{\"type\":\"json_schema\",\"schema\":{}}}}}}}",
            json_str(&sent["model"]),
            json_str(&sent["max_tokens"]),
            json_str(&sent["messages"]),
            json_str(&sent["output_config"]["effort"]),
            schema
        )
        .into_bytes()
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
            .header("content-type", "application/json")
            .body(self.wire(model, body))
    }
    pub(crate) async fn generate_json(
        self,
        ctx: &GenContext<'_>,
        model: &str,
        body: &Value,
    ) -> Result<Attempt, Failure> {
        check_wire(&self.wire(model, body))?;
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
                let body = response.text().await.unwrap_or_default();
                return Err(verify_error(status, &body));
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

pub(crate) const WORKSPACE_MESSAGE: &str = "This Claude key isn't tied to a workspace. In Anthropic's console, open a workspace, create a key there, and paste that key here.";

/// Key check errors: a 400 for a key without a workspace gets its own fix-it message.
fn verify_error(status: u16, body: &str) -> String {
    if status == 400 && body.contains("anthropic-workspace-id") {
        return WORKSPACE_MESSAGE.into();
    }
    error_message(status)
}

pub(crate) fn error_message(status: u16) -> String {
    match status {
        401 => "Claude didn't accept this key. Check it in Settings.",
        403 => "Claude did not allow this request. Check this key's access in Anthropic's console.",
        404 => "Claude could not find this model. Check for an app update.",
        413 => "That file is too large to send to Anthropic. Take out the chapter you are studying and try again.",
        429 | 500..=599 => "Claude is busy or rate-limited. Your Flight Deck retried briefly. Wait a little and try again.",
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

pub(crate) const OUTPUT_LIMIT_MESSAGE: &str = "Claude's answer reached its output limit and is incomplete. Nothing was saved. Choose a chapter or fewer pages and try again.";

pub(crate) fn extract_text(raw: &str) -> Result<String, String> {
    let envelope: Value = serde_json::from_str(raw)
        .map_err(|_| "Claude returned an unreadable response.".to_string())?;
    match envelope["stop_reason"].as_str() {
        Some("end_turn") => {},
        Some("max_tokens") => return Err(OUTPUT_LIMIT_MESSAGE.into()),
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

#[cfg(test)]
mod version_tests {
    use serde_json::json;
    #[test]
    fn sends_the_real_anthropic_api_version() {
        // Only real versions are accepted; an invented date fails every call with HTTP 400.
        assert_eq!(super::VERSION, "2023-06-01");
    }

    #[test]
    fn a_key_without_a_workspace_says_how_to_fix_it() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use."}}"#;
        assert_eq!(super::verify_error(400, body), super::WORKSPACE_MESSAGE);
        assert_eq!(super::verify_error(400, "{}"), super::error_message(400));
        assert_eq!(super::verify_error(401, body), super::error_message(401));
    }

    #[test]
    fn non_kit_requests_get_32k_and_the_kit_keeps_its_own_cap() {
        let body = json!({"generationConfig":{"responseSchema":{"type":"OBJECT","properties":{"title":{"type":"STRING"}}}},"contents":[{"parts":[{"text":"x"}]}]});
        let sent = super::ClaudeProvider.body(super::MODEL, &body);
        assert_eq!(sent["max_tokens"], 32_000);
        assert_eq!(super::MAX_OUTPUT_TOKENS, 32_000);
        const { assert!(crate::gemini::study_kit::KIT_OUTPUT_TOKENS > super::MAX_OUTPUT_TOKENS) };
    }

    #[test]
    fn each_choice_selects_its_claude_model() {
        use crate::provider::{AnyProvider, ProviderId, Tier};
        let p = AnyProvider::from(ProviderId::Claude);
        assert_eq!(p.models(Tier::Standard), (super::MODEL, super::MODEL));
        assert_eq!(
            p.models(Tier::MostCapable),
            (super::CAPABLE_MODEL, super::MODEL)
        );
        assert_eq!(super::CAPABLE_MODEL, "claude-sonnet-5-5");
    }
}
