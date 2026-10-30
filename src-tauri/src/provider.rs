//! Provider boundary for native AI operations. P0 deliberately selects only
//! Gemini; no preference writer, command or student-facing surface exists.
use std::path::Path;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(crate) use crate::gemini::provider_impl::GeminiProvider;
use crate::gemini::{Attempt, Failure, GenContext, LoadedSource};
use crate::gemini_budget::Budget;
use crate::gemini_files::{
    self, Lease, LookupFailure, Prepared, PreparedSources, RemoteFile, Retired,
};

pub(crate) mod schemas;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProviderId {
    #[default]
    Gemini,
}

/// Read only. Unknown, unreadable and missing preferences retain Gemini.
/// P0 does not connect this reader to Settings or write any app data.
#[allow(dead_code)]
pub(crate) fn load_choice(root: &Path) -> ProviderId {
    std::fs::read_to_string(root.join("ai-provider"))
        .ok()
        .and_then(|s| match s.trim() {
            "gemini" => Some(ProviderId::Gemini),
            _ => None,
        })
        .unwrap_or_else(|| AnyProvider::default().id())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tier {
    Standard,
    MostCapable,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RefusalKind {
    InvalidKey,
    RateLimited(Option<Duration>),
    Quota,
    /// A missing/unsupported model response, not proof of retirement.
    ModelGone,
    Other(String),
}

/// Concrete async dispatch avoids a new async-trait dependency and boxed
/// futures. Request construction and every provider operation live here;
/// retry, budget, cancellation and lease ownership remain with their callers.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AnyProvider {
    Gemini(GeminiProvider),
}

impl Default for AnyProvider {
    fn default() -> Self {
        Self::Gemini(GeminiProvider)
    }
}

impl AnyProvider {
    pub(crate) fn id(self) -> ProviderId {
        match self {
            Self::Gemini(_) => ProviderId::Gemini,
        }
    }
    pub(crate) fn models(self, tier: Tier) -> (&'static str, &'static str) {
        match self {
            Self::Gemini(p) => p.models(tier),
        }
    }
    pub(crate) async fn verify_key(self, key: &str) -> Result<(), String> {
        match self {
            Self::Gemini(p) => p.verify_key(key).await,
        }
    }
    pub(crate) fn source_part(self, source: &LoadedSource, prepared: Option<&Prepared>) -> Value {
        match self {
            Self::Gemini(_) => crate::gemini::provider_impl::source_part(source, prepared),
        }
    }
    pub(crate) async fn prepare_pdf<'a>(
        self,
        ctx: &GenContext<'a>,
        source: &gemini_files::Source<'_>,
        avoid: Option<&str>,
    ) -> Result<Lease<'a>, String> {
        match self {
            Self::Gemini(p) => p.prepare_pdf(ctx, source, avoid).await,
        }
    }
    pub(crate) async fn lookup(
        self,
        http: &Client,
        base: &str,
        key: &str,
        name: &str,
        mime: &str,
        budget: &Budget,
    ) -> Result<RemoteFile, LookupFailure> {
        match self {
            Self::Gemini(p) => p.lookup(http, base, key, name, mime, budget).await,
        }
    }
    pub(crate) async fn upload(
        self,
        http: &Client,
        base: &str,
        key: &str,
        bytes: &[u8],
        mime: &str,
        budget: &Budget,
    ) -> Result<RemoteFile, String> {
        match self {
            Self::Gemini(p) => p.upload(http, base, key, bytes, mime, budget).await,
        }
    }
    pub(crate) async fn delete(
        self,
        http: &Client,
        base: &str,
        key: &str,
        name: &str,
        timeout: Duration,
    ) -> bool {
        match self {
            Self::Gemini(p) => p.delete(http, base, key, name, timeout).await,
        }
    }
    pub(crate) async fn retire(
        self,
        cache: &PreparedSources,
        http: &Client,
        key: &str,
        files: Vec<Retired>,
    ) -> usize {
        match self {
            Self::Gemini(p) => p.retire(cache, http, key, files).await,
        }
    }
    pub(crate) async fn generate_json(
        self,
        ctx: &GenContext<'_>,
        model: &str,
        body: &Value,
    ) -> Result<Attempt, Failure> {
        match self {
            Self::Gemini(p) => p.generate_json(ctx, model, body).await,
        }
    }
    pub(crate) fn describe_refusal(
        self,
        status: u16,
        body: &str,
        retry_after: Option<Duration>,
    ) -> RefusalKind {
        match self {
            Self::Gemini(p) => p.refusal(status, body, retry_after),
        }
    }
    pub(crate) fn translate_schema(self, schema: &Schema) -> Value {
        match self {
            Self::Gemini(_) => schema.gemini_json(),
        }
    }
}

/// The small structural vocabulary used by today's contracts. Constraints
/// are optional so omission stays distinct from a false/zero value.
#[derive(Clone, Debug)]
pub(crate) struct Schema {
    kind: Kind,
    nullable: Option<bool>,
    minimum: Option<i64>,
    max_length: Option<usize>,
    max_items: Option<usize>,
    enum_values: Option<Vec<String>>,
}
#[derive(Clone, Debug)]
enum Kind {
    Object {
        properties: Vec<(String, Schema)>,
        required: Vec<String>,
    },
    Array(Box<Schema>),
    String,
    Integer,
    Boolean,
}
impl Schema {
    fn new(kind: Kind) -> Self {
        Self {
            kind,
            nullable: None,
            minimum: None,
            max_length: None,
            max_items: None,
            enum_values: None,
        }
    }
    pub(crate) fn object(properties: &[(&str, Schema)], required: &[&str]) -> Self {
        Self::new(Kind::Object {
            properties: properties
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            required: required.iter().map(|s| s.to_string()).collect(),
        })
    }
    pub(crate) fn array(items: Schema) -> Self {
        Self::new(Kind::Array(Box::new(items)))
    }
    pub(crate) fn string() -> Self {
        Self::new(Kind::String)
    }
    pub(crate) fn integer() -> Self {
        Self::new(Kind::Integer)
    }
    pub(crate) fn boolean() -> Self {
        Self::new(Kind::Boolean)
    }
    pub(crate) fn nullable(mut self, value: bool) -> Self {
        self.nullable = Some(value);
        self
    }
    pub(crate) fn minimum(mut self, value: i64) -> Self {
        self.minimum = Some(value);
        self
    }
    pub(crate) fn max_length(mut self, value: usize) -> Self {
        self.max_length = Some(value);
        self
    }
    pub(crate) fn max_items(mut self, value: usize) -> Self {
        self.max_items = Some(value);
        self
    }
    #[allow(dead_code)] // Part of the approved subset; no current schema uses enum.
    pub(crate) fn enumeration(mut self, values: &[&str]) -> Self {
        self.enum_values = Some(values.iter().map(|v| v.to_string()).collect());
        self
    }
    fn gemini_json(&self) -> Value {
        let mut value = match &self.kind {
            Kind::Object {
                properties,
                required,
            } => {
                let properties: serde_json::Map<String, Value> = properties
                    .iter()
                    .map(|(k, v)| (k.clone(), v.gemini_json()))
                    .collect();
                json!({"type":"OBJECT", "required":required, "properties":properties})
            }
            Kind::Array(items) => json!({"type":"ARRAY", "items":items.gemini_json()}),
            Kind::String => json!({"type":"STRING"}),
            Kind::Integer => json!({"type":"INTEGER"}),
            Kind::Boolean => json!({"type":"BOOLEAN"}),
        };
        if let Some(v) = self.nullable {
            value["nullable"] = json!(v);
        }
        if let Some(v) = self.minimum {
            value["minimum"] = json!(v);
        }
        if let Some(v) = self.max_length {
            value["maxLength"] = json!(v);
        }
        if let Some(v) = self.max_items {
            value["maxItems"] = json!(v);
        }
        if let Some(v) = &self.enum_values {
            value["enum"] = json!(v);
        }
        value
    }
}

#[cfg(test)]
#[path = "provider/schema_tests.rs"]
mod schema_tests;
#[cfg(test)]
mod tests {
    use super::*;
    struct TempRoot(std::path::PathBuf);
    impl TempRoot {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "hfd-provider-p0-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn choice_absent() {
        let root = TempRoot::new();
        assert_eq!(load_choice(root.path()), ProviderId::Gemini);
        assert!(!root.path().join("ai-provider").exists());
    }
    #[test]
    fn choice_unknown() {
        let root = TempRoot::new();
        std::fs::write(root.path().join("ai-provider"), "claude").unwrap();
        assert_eq!(load_choice(root.path()), ProviderId::Gemini);
        assert_eq!(
            std::fs::read_to_string(root.path().join("ai-provider")).unwrap(),
            "claude"
        );
    }
    #[test]
    fn choice_gemini() {
        let root = TempRoot::new();
        std::fs::write(root.path().join("ai-provider"), "gemini").unwrap();
        assert_eq!(load_choice(root.path()), ProviderId::Gemini);
        assert_eq!(
            serde_json::to_string(&ProviderId::Gemini).unwrap(),
            "\"gemini\""
        );
    }
    #[test]
    fn choice_unreadable() {
        let root = TempRoot::new();
        std::fs::create_dir(root.path().join("ai-provider")).unwrap();
        assert_eq!(load_choice(root.path()), ProviderId::Gemini);
    }
    #[test]
    fn generation_url_and_headers_identical() {
        let http = Client::new();
        let body = json!({"contents":[]});
        let base = "http://127.0.0.1:12345";
        let model = "synthetic-model";
        let old = http
            .post(format!("{base}/v1beta/models/{model}:generateContent"))
            .header("x-goog-api-key", "synthetic-only")
            .json(&body)
            .build()
            .unwrap();
        let AnyProvider::Gemini(provider) = AnyProvider::default();
        let new = provider
            .request(&http, base, "synthetic-only", model, &body)
            .build()
            .unwrap();
        assert_eq!(new.url(), old.url());
        assert_eq!(new.headers(), old.headers());
        assert_eq!(new.method(), old.method());
        assert_eq!(
            new.body().unwrap().as_bytes(),
            old.body().unwrap().as_bytes()
        );
    }
    #[test]
    fn refusal_kinds_preserve_provider_facts_without_echoing_raw_errors() {
        let provider = AnyProvider::default();
        assert_eq!(
            provider.describe_refusal(400, r#"{"error":{"reason":"API_KEY_INVALID"}}"#, None),
            RefusalKind::InvalidKey
        );
        assert_eq!(
            provider.describe_refusal(
                429,
                r#"{"error":{"details":[{"violations":[{"quotaId":"RequestsPerDay"}]}]}}"#,
                None
            ),
            RefusalKind::Quota
        );
        let retry = Some(Duration::from_secs(2));
        assert_eq!(
            provider.describe_refusal(429, "{}", retry),
            RefusalKind::RateLimited(retry)
        );
        assert_eq!(
            provider.describe_refusal(404, "{}", None),
            RefusalKind::ModelGone
        );
        let RefusalKind::Other(message) = provider.describe_refusal(
            400,
            r#"{"error":{"message":"synthetic-private-name"}}"#,
            None,
        ) else {
            panic!("expected other refusal")
        };
        assert!(!message.contains("synthetic-private-name"));
    }
    #[test]
    fn choice_invalid_utf8_is_read_only_and_defaults_to_gemini() {
        let root = TempRoot::new();
        std::fs::write(root.path().join("ai-provider"), [0xff]).unwrap();
        assert_eq!(load_choice(root.path()), ProviderId::Gemini);
        assert_eq!(
            std::fs::read(root.path().join("ai-provider")).unwrap(),
            [0xff]
        );
    }
    #[test]
    fn enum_constraint_is_translated() {
        assert_eq!(
            AnyProvider::default().translate_schema(&Schema::string().enumeration(&["a", "b"])),
            json!({"type":"STRING", "enum":["a", "b"]})
        );
    }
}
