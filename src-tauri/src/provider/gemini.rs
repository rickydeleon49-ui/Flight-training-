//! Gemini adapter. Existing transport and refusal functions moved verbatim,
//! except generation delegates URL/header construction to `request`.
use super::*;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct GeminiProvider;

impl GeminiProvider {
    pub(crate) async fn prepare_pdf<'a>(
        self,
        ctx: &GenContext<'a>,
        source: &gemini_files::Source<'_>,
        avoid: Option<&str>,
    ) -> Result<gemini_files::Lease<'a>, String> {
        ctx.cache
            .prepare(
                ctx.http,
                ctx.base,
                ctx.api_key,
                source,
                ctx.epoch,
                avoid,
                ctx.budget,
                ctx.say,
            )
            .await
    }
    pub(crate) async fn upload(
        self,
        http: &Client,
        base: &str,
        key: &str,
        bytes: &[u8],
        mime: &str,
        budget: &Budget,
    ) -> Result<gemini_files::RemoteFile, String> {
        gemini_files::upload(http, base, key, bytes, mime, budget).await
    }
    pub(crate) async fn lookup(
        self,
        http: &Client,
        base: &str,
        key: &str,
        name: &str,
        mime: &str,
        budget: &Budget,
    ) -> Result<gemini_files::RemoteFile, gemini_files::LookupFailure> {
        gemini_files::lookup(http, base, key, name, mime, budget).await
    }
    pub(crate) async fn delete(
        self,
        http: &Client,
        base: &str,
        key: &str,
        name: &str,
        timeout: Duration,
    ) -> bool {
        gemini_files::delete(http, base, key, name, timeout).await
    }
    pub(crate) async fn retire(
        self,
        cache: &PreparedSources,
        http: &Client,
        key: &str,
        files: Vec<gemini_files::Retired>,
    ) -> usize {
        cache.retire(http, key, files).await
    }
    pub(crate) fn models(self, tier: crate::provider::Tier) -> (&'static str, &'static str) {
        match tier {
            crate::provider::Tier::Standard => (MODEL, FALLBACK_MODEL),
            crate::provider::Tier::MostCapable => (CAPABLE_MODEL, MODEL),
        }
    }
    pub(crate) fn request(
        self,
        http: &Client,
        base: &str,
        key: &str,
        model: &str,
        body: &Value,
    ) -> reqwest::RequestBuilder {
        http.post(format!("{base}/v1beta/models/{model}:generateContent"))
            .header("x-goog-api-key", key)
            .json(body)
    }
    pub(crate) async fn verify_key(self, key: &str) -> Result<(), String> {
        verify_key(key).await
    }
    pub(crate) async fn generate_json(
        self,
        ctx: &GenContext<'_>,
        model: &str,
        body: &Value,
    ) -> Result<Attempt, Failure> {
        generate_once(ctx, model, body).await
    }
    pub(crate) fn refusal(
        self,
        status: u16,
        body: &str,
        retry_after: Option<Duration>,
    ) -> crate::provider::RefusalKind {
        use crate::provider::RefusalKind;
        if has_invalid_key_reason(body) {
            RefusalKind::InvalidKey
        } else if status == 429 && is_lasting_quota(body) {
            RefusalKind::Quota
        } else if status == 429 {
            RefusalKind::RateLimited(retry_after)
        } else if status == 404 {
            RefusalKind::ModelGone
        } else {
            RefusalKind::Other(describe_refusal(
                RefusalContext::Generation,
                status,
                body,
                MODEL,
            ))
        }
    }
}

pub(crate) async fn verify_key(api_key: &str) -> Result<(), String> {
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

pub(crate) fn source_part(
    source: &LoadedSource,
    prepared: Option<&gemini_files::Prepared>,
) -> Value {
    match prepared {
        Some(p) => json!({"file_data": {"mime_type": p.mime, "file_uri": p.uri}}),
        None => {
            json!({"inline_data": {"mime_type": source.mime, "data": BASE64.encode(&source.bytes)}})
        }
    }
}

pub(crate) async fn generate_once(
    ctx: &GenContext<'_>,
    model: &str,
    body: &Value,
) -> Result<Attempt, Failure> {
    generate_once_for(ctx, crate::provider::AnyProvider::default(), model, body).await
}

pub(crate) async fn generate_once_for(
    ctx: &GenContext<'_>,
    provider: crate::provider::AnyProvider,
    model: &str,
    body: &Value,
) -> Result<Attempt, Failure> {
    // Every request has only what remains of the generation's one budget.
    ctx.budget.reset_stage(Stage::Generating);
    let Some(timeout) = ctx.budget.upload_timeout() else {
        return Err(gemini_files::out_of_time(
            ctx.budget,
            &format!("asking {}", provider.id().name()),
        )
        .into());
    };
    if !ctx.budget.checkpoint() {
        return Err(gemini_budget::CHECKPOINT_FAILED.to_string().into());
    }
    // Immediately before the request: a cancel recorded by now prevents it,
    // however far one poll of the work has run (GENREL04-R5).
    if !ctx.budget.admit() {
        return Err(gemini_cancel::CANCELLED.to_string().into());
    }
    let sent = ctx
        .budget
        .guard_stage(
            provider
                .request(ctx.http, ctx.base, ctx.api_key, model, body)
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
                        return Err(provider.wording("Gemini's answer exceeded the 1 MiB response limit. The earlier draft is kept.".to_string()).into());
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
    let raw = String::from_utf8(bytes).map_err(|_| {
        Failure::from(provider.wording("Gemini's answer was not readable text.".to_string()))
    })?;

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

pub(crate) fn is_lasting_quota(raw: &str) -> bool {
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

pub(crate) fn has_invalid_key_reason(raw: &str) -> bool {
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

pub(super) fn describe_refusal(
    context: RefusalContext,
    status: u16,
    body: &str,
    model: &str,
) -> String {
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
            "Google did not allow this key to use Gemini 3.8 Flash. Check this key's model access in Google AI Studio, or choose the standard model in Settings.".to_string()
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
