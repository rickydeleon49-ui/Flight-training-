//! Synthetic loopback requests through the real feature/retry/guard paths.
use super::*;
use crate::fake_gemini::Recorded;
use crate::provider::{
    claude::{self, ClaudeProvider},
    ProviderId,
};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

struct FakeClaude {
    base: String,
    log: Arc<Mutex<Vec<Recorded>>>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl FakeClaude {
    fn start(replies: Vec<(u16, String, Option<u64>)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let log = Arc::new(Mutex::new(vec![]));
        let stop = Arc::new(AtomicBool::new(false));
        let (recorded, stopping) = (log.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            let mut replies = VecDeque::from(replies);
            for stream in listener.incoming() {
                if stopping.load(Ordering::SeqCst) {
                    break;
                }
                let mut stream = stream.unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(30)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let words: Vec<_> = first.split_whitespace().collect();
                let mut headers = Vec::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    let (key, value) = line.trim_end().split_once(':').unwrap();
                    headers.push((key.to_string(), value.trim().to_string()));
                }
                let length = headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                    .map(|(_, v)| v.parse::<usize>().unwrap())
                    .unwrap_or(0);
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                recorded.lock().unwrap().push(Recorded {
                    method: words[0].into(),
                    path: words[1].into(),
                    headers,
                    body,
                });
                let (status, body, retry) = if replies.len() > 1 {
                    replies.pop_front().unwrap()
                } else {
                    replies.front().unwrap().clone()
                };
                let retry = retry
                    .map(|s| format!("retry-after: {s}\r\n"))
                    .unwrap_or_default();
                let _ = write!(stream, "HTTP/1.1 {status} Test\r\ncontent-type: application/json\r\ncontent-length: {}\r\n{retry}connection: close\r\n\r\n{body}", body.len());
            }
        });
        Self {
            base,
            log,
            stop,
            thread: Some(thread),
        }
    }
    fn log(&self) -> Vec<Recorded> {
        self.log.lock().unwrap().clone()
    }
}
impl Drop for FakeClaude {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.base.trim_start_matches("http://"));
        self.thread.take().unwrap().join().unwrap();
    }
}
fn reply(text: Value) -> (u16, String, Option<u64>) {
    (200, json!({"stop_reason":"end_turn", "content":[{"type":"thinking", "thinking":"synthetic private reasoning"},{"type":"text","text":text.to_string()}]}).to_string(), None)
}
fn aid() -> Value {
    json!({"title":"Fictional guide","summary":"Study only","sections":[{"heading":"Wing","body":"The fictional wing is blue."}],"flashcards":[{"front":"Wing?","back":"Blue","sourcePage":1,"quote":"The fictional wing is blue."}],"sourceNotes":"Check with an instructor."})
}
fn cache() -> PreparedSources {
    PreparedSources::new(
        gemini_files::Policy::default(),
        gemini_files::system_clock(),
    )
}
fn source() -> LoadedSource {
    let mut source = LoadedSource::new(
        b"synthetic PDF bytes".to_vec(),
        "application/pdf",
        "synthetic.pdf",
    );
    source.page_count = Some(5);
    source
}
fn context<'a>(
    fake: &'a FakeClaude,
    http: &'a Client,
    cache: &'a PreparedSources,
    budget: &'a Budget,
    say: &'a (dyn Fn(String) + Sync),
) -> GenContext<'a> {
    GenContext {
        provider: AnyProvider::Claude(ClaudeProvider),
        http,
        base: &fake.base,
        api_key: "synthetic-claude-key-only",
        choice: ModelChoice::MostCapable,
        cache,
        epoch: cache.epoch(),
        budget,
        say,
    }
}
fn assert_schema(value: &Value) {
    let object = value.as_object().unwrap();
    for key in [
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "nullable",
    ] {
        assert!(!object.contains_key(key), "{key}");
    }
    let kind = value["type"]
        .as_str()
        .or_else(|| value["type"][0].as_str())
        .unwrap();
    assert_eq!(kind, kind.to_lowercase());
    if kind == "object" {
        assert_eq!(value["additionalProperties"], false);
        let props = value["properties"].as_object().unwrap();
        assert_eq!(value["required"].as_array().unwrap().len(), props.len());
        for (key, item) in props {
            assert!(value["required"].as_array().unwrap().contains(&json!(key)));
            assert_schema(item);
        }
    }
    if kind == "array" {
        assert_schema(&value["items"]);
    }
}
#[test]
fn claude_study_aid_records_headers_document_before_text_and_schema() {
    let fake = FakeClaude::start(vec![reply(aid())]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let result = tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).unwrap();
    assert_eq!(result.model, claude::MODEL);
    assert_eq!(result.title, "Fictional guide");
    let log = fake.log();
    assert_eq!(log.len(), 1);
    let request = &log[0];
    assert_eq!(request.path, "/v1/messages");
    assert_eq!(
        request.header("x-api-key"),
        Some("synthetic-claude-key-only")
    );
    assert_eq!(request.header("anthropic-version"), Some("2026-10-21"));
    assert_eq!(request.header("content-type"), Some("application/json"));
    assert!(request.header("x-goog-api-key").is_none());
    let body = request.json();
    assert_eq!(body["model"], claude::MODEL);
    assert_eq!(body["max_tokens"], 16000);
    assert_eq!(body["output_config"]["effort"], "medium");
    for key in ["temperature", "top_p", "top_k", "thinking", "citations"] {
        assert!(body.get(key).is_none());
    }
    assert_eq!(body["messages"][0]["content"][0]["type"], "document");
    assert_eq!(
        body["messages"][0]["content"][0]["source"]["media_type"],
        "application/pdf"
    );
    use base64::Engine;
    assert_eq!(
        body["messages"][0]["content"][0]["source"]["data"],
        base64::engine::general_purpose::STANDARD.encode(source().bytes)
    );
    assert_eq!(body["messages"][0]["content"][1]["type"], "text");
    assert_eq!(body["output_config"]["format"]["type"], "json_schema");
    assert_schema(&body["output_config"]["format"]["schema"]);
}
#[test]
fn claude_translates_all_five_contracts_and_nullable_without_constraints() {
    let kept = "This draft was started with Gemini. Use Gemini in Settings to continue it.";
    assert_eq!(
        AnyProvider::Claude(ClaudeProvider).wording(kept.into()),
        kept
    );

    for schema in [
        crate::provider::schemas::study_aid(),
        crate::provider::schemas::practice_test(),
        crate::provider::schemas::section(),
        crate::provider::schemas::ask_pdf(),
        crate::provider::schemas::ask_text(),
    ] {
        assert_schema(&AnyProvider::Claude(ClaudeProvider).translate_schema(&schema));
    }
    let schema = AnyProvider::Claude(ClaudeProvider)
        .translate_schema(&crate::provider::schemas::study_aid());
    assert_eq!(
        schema["properties"]["flashcards"]["items"]["properties"]["sourcePage"]["type"],
        json!(["integer", "null"])
    );
}
#[test]
fn claude_whole_pdf_over_300_pages_never_sends() {
    let fake = FakeClaude::start(vec![reply(aid())]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let mut src = source();
    src.page_count = Some(301);
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &src)).unwrap_err();
    assert!(error.contains("Take out the chapter"));
    assert!(fake.log().is_empty());
    src.page_count = Some(300);
    assert!(tauri::async_runtime::block_on(study_aid_with(&ctx, &src)).is_ok());
    // Native source loading must apply Claude's limit before Gemini's 1000-page
    // guard, including PDFs larger than Gemini itself accepts.
    let root = TempRoot::new();
    let path = root.0.join("documents/large.pdf");
    std::fs::write(&path, synthetic_pdf(1001)).unwrap();
    let error =
        tauri::async_runtime::block_on(check_pdf_length_for(&path, ctx.provider)).unwrap_err();
    assert!(error.contains("over the 300 this app sends to Anthropic"));
    assert!(!error.contains("Google"));
    assert!(
        tauri::async_runtime::block_on(check_pdf_length_for(&path, AnyProvider::default()))
            .unwrap_err()
            .contains("1000 Google")
    );
}
#[test]
fn claude_401_is_terminal_sanitized_and_has_no_fallback() {
    let fake = FakeClaude::start(vec![(401, json!({"type":"error","error":{"type":"authentication_error","message":"secret synthetic name"}}).to_string(), None)]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).unwrap_err();
    assert_eq!(
        error,
        "Claude didn't accept this key. Check it in Settings."
    );
    assert_eq!(fake.log().len(), 1);
}
#[test]
fn claude_retries_429_and_529_on_same_model_without_backup_notice() {
    let fake = FakeClaude::start(vec![
        (429, "{}".into(), Some(0)),
        (529, "{}".into(), Some(0)),
        reply(aid()),
    ]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let messages = Mutex::new(vec![]);
    let say = |m| messages.lock().unwrap().push(m);
    let ctx = context(&fake, &http, &cache, &budget, &say);
    assert!(tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).is_ok());
    assert_eq!(fake.log().len(), 3);
    for request in fake.log() {
        assert_eq!(request.json()["model"], claude::MODEL);
    }
    for message in messages.lock().unwrap().iter() {
        assert!(
            !message.contains("backup")
                && !message.contains("Gemini")
                && !message.contains("Google")
        );
    }
}
#[test]
fn claude_retry_after_beyond_budget_stops_without_another_request() {
    let fake = FakeClaude::start(vec![(429, "{}".into(), Some(120))]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(5)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).unwrap_err();
    assert_eq!(fake.log().len(), 1);
    assert!(!error.contains("backup"));
}
#[test]
fn claude_busy_exhausts_only_three_requests() {
    let fake = FakeClaude::start(vec![(529, "{}".into(), Some(0))]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).unwrap_err();
    assert_eq!(fake.log().len(), 3);
    assert!(error.starts_with("Claude is busy"));
}
#[test]
fn claude_refusal_and_max_tokens_do_not_save_partial_answers() {
    for (stop, expected) in [
        ("refusal", "Claude declined"),
        ("max_tokens", "Claude's answer reached its output limit"),
    ] {
        let fake = FakeClaude::start(vec![(
            200,
            json!({"stop_reason":stop,"content":[{"type":"text","text":aid().to_string()}]})
                .to_string(),
            None,
        )]);
        let (http, cache, budget) = (
            generation_client().unwrap(),
            cache(),
            Budget::new(Duration::from_secs(30)),
        );
        let ctx = context(&fake, &http, &cache, &budget, &|_| {});
        let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).unwrap_err();
        assert!(error.starts_with(expected));
        assert_eq!(fake.log().len(), 1);
    }
}
#[test]
fn claude_key_check_uses_model_get_and_busy_never_means_bad_key() {
    for status in [200, 401, 429, 529] {
        let fake = FakeClaude::start(vec![(status, "{}".into(), Some(120))]);
        let result =
            tauri::async_runtime::block_on(ClaudeProvider.verify_at(&fake.base, "synthetic-key"));
        assert_eq!(result.is_ok(), status == 200);
        if matches!(status, 429 | 529) {
            assert!(result.unwrap_err().contains("busy"));
        }
        let log = fake.log();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].method, "GET");
        assert_eq!(log[0].path, format!("/v1/models/{}", claude::MODEL));
        assert_eq!(log[0].header("anthropic-version"), Some("2026-10-21"));
        assert_eq!(log[0].header("x-api-key"), Some("synthetic-key"));
    }
}
#[test]
fn claude_ask_uses_pdf_contract_and_rejects_unverified_quote() {
    let response = json!({"answer":"Fictional explanation.","notAnswered":false,"passages":[{"page":1,"quote":"invented red wing"}]});
    let fake = FakeClaude::start(vec![reply(response)]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let answer = tauri::async_runtime::block_on(crate::gemini_ask::ask_gemini_with(
        &ctx,
        Some(&source()),
        None,
        "",
        "What color is the wing?",
        &[],
    ))
    .unwrap();
    assert!(answer.passages.unwrap().is_empty());
    assert_eq!(answer.model, claude::MODEL);
    let body = fake.log()[0].json();
    assert!(body["output_config"]["format"]["schema"]["properties"]
        .get("passages")
        .is_some());
    assert_schema(&body["output_config"]["format"]["schema"]);
}
#[test]
fn claude_ask_cut_off_by_max_tokens_says_to_ask_a_shorter_question() {
    let fake = FakeClaude::start(vec![(
        200,
        json!({"stop_reason":"max_tokens","content":[{"type":"text","text":"{\"answer\":\"Partial"}]})
            .to_string(),
        None,
    )]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let error = tauri::async_runtime::block_on(crate::gemini_ask::ask_gemini_with(
        &ctx,
        None,
        None,
        "Card context",
        "Why?",
        &[],
    ))
    .unwrap_err();
    assert_eq!(
        error,
        "Claude's answer got too long and was cut off. Try asking a shorter or more specific question."
    );
    assert_eq!(fake.log().len(), 1);
    assert_eq!(fake.log()[0].json()["max_tokens"], 16000);
}
#[test]
fn claude_text_source_uses_text_not_document() {
    let fake = FakeClaude::start(vec![reply(aid())]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let source = LoadedSource::new(
        b"fictional Gemini study aid notes".to_vec(),
        "text/plain",
        "notes.txt",
    );
    assert!(tauri::async_runtime::block_on(study_aid_with(&ctx, &source)).is_ok());
    let body = fake.log()[0].json();
    let blocks = body["messages"][0]["content"].as_array().unwrap();
    assert!(blocks.iter().all(|b| b["type"] == "text"));
    assert!(blocks
        .iter()
        .any(|b| b["text"] == "fictional Gemini study aid notes"));
    assert_eq!(ctx.provider.id(), ProviderId::Claude);
}

struct TempRoot(std::path::PathBuf);
impl TempRoot {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "hfd-claude-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("documents")).unwrap();
        Self(root)
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn synthetic_pdf(pages: u32) -> Vec<u8> {
    use lopdf::{dictionary, Document, Object};
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let ids:Vec<_>=(0..pages).map(|_|doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]})).collect();
    doc.objects.insert(pages_id,Object::Dictionary(dictionary!{"Type"=>"Pages","Count"=>i64::from(pages),"Kids"=>ids.into_iter().map(Object::Reference).collect::<Vec<_>>()}));
    let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
    doc.trailer.set("Root", catalog);
    let mut bytes = vec![];
    doc.save_to(&mut bytes).unwrap();
    bytes
}
#[test]
fn claude_flashcard_batches_and_practice_use_selected_provider() {
    let mut cards = aid();
    cards["flashcards"][0]["sourcePage"] = Value::Null;
    let fake = FakeClaude::start(vec![reply(cards)]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let root = TempRoot::new();
    let source = LoadedSource::new(b"fictional source".to_vec(), "text/plain", "notes.txt");
    std::fs::write(root.0.join("documents/notes.txt"), &source.bytes).unwrap();
    let answer = tauri::async_runtime::block_on(as_job(
        &root.0,
        JobKind::StudyAid,
        "fictional-material",
        None,
        &source,
        batches::generate(&ctx, &source, &root.0, "fictional-material", 20, true),
        &|_| {},
    ))
    .unwrap();
    assert_eq!(answer.answer.model, claude::MODEL);
    assert_eq!(answer.answer.flashcards.len(), 1);
    assert_eq!(fake.log().len(), 2);
    let fake = FakeClaude::start(vec![reply(
        json!({"title":"Fictional quiz","questions":[{"question":"Wing?","options":["Blue","Red","Green"],"correctIndex":0,"explanation":"Fictional wing is blue.","sourcePage":null,"quote":"The fictional wing is blue."}]}),
    )]);
    let budget = Budget::new(Duration::from_secs(30));
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    assert_eq!(
        tauri::async_runtime::block_on(practice_test_with(&ctx, &source))
            .unwrap()
            .model,
        claude::MODEL
    );
    assert_eq!(fake.log()[0].path, "/v1/messages");

    // An unfinished batch must not silently mix answers from two providers.
    let fake = FakeClaude::start(vec![reply(aid()), (401, "{}".into(), None)]);
    let budget = Budget::new(Duration::from_secs(30));
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    assert!(tauri::async_runtime::block_on(as_job(
        &root.0,
        JobKind::StudyAid,
        "partial-material",
        None,
        &source,
        batches::generate(&ctx, &source, &root.0, "partial-material", 20, true),
        &|_| {}
    ))
    .is_err());
    assert_eq!(fake.log().len(), 2);
    let budget = Budget::new(Duration::from_secs(30));
    let mut ctx = context(&fake, &http, &cache, &budget, &|_| {});
    ctx.provider = AnyProvider::default();
    let error = tauri::async_runtime::block_on(as_job(
        &root.0,
        JobKind::StudyAid,
        "partial-material",
        None,
        &source,
        batches::generate(&ctx, &source, &root.0, "partial-material", 20, true),
        &|_| {},
    ))
    .unwrap_err();
    assert!(error.contains("This draft was started with Claude"));
    assert_eq!(
        fake.log().len(),
        2,
        "switching cannot send an unfinished draft to a different provider"
    );
}

#[test]
fn claude_section_guide_sends_selected_pdf_without_upload_or_descriptor() {
    let root = TempRoot::new();
    std::fs::write(root.0.join("documents/book.pdf"), synthetic_pdf(8)).unwrap();
    crate::provider::save_choice(&root.0, ProviderId::Claude).unwrap();
    let request: sections::SectionRequest=serde_json::from_value(json!({"materialId":"fictional-material","relativePath":"book.pdf","chosenPages":[3,4,5],"baseRevision":null,"requestId":null})).unwrap();
    let fake = FakeClaude::start(vec![reply(
        json!({"body":"Fictional section only.","sourcePages":[3,4,5]}),
    )]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let id = sections::queue_study_guide_at(&root.0, &request, ModelChoice::MostCapable).unwrap();
    let answer = tauri::async_runtime::block_on(sections::activate(
        &ctx,
        &root.0,
        &request,
        Some(&id),
        &|_| {},
        &|_| {},
    ))
    .unwrap();
    assert_eq!(answer.answer.model, claude::MODEL);
    let log = fake.log();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].path, "/v1/messages");
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            log[0].json()["messages"][0]["content"][0]["source"]["data"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    assert_eq!(
        lopdf::Document::load_mem(&bytes).unwrap().get_pages().len(),
        3
    );
    let jobs = gemini_jobs::with(&root.0, |j| j.list());
    assert!(jobs[0].draft.as_ref().unwrap()["preparedFile"].is_null());
}
#[test]
fn claude_response_cap_and_cancel_admission_share_transport_guards() {
    let fake = FakeClaude::start(vec![(200, "x".repeat(1024 * 1024 + 1), None)]);
    let (http, cache, budget) = (
        generation_client().unwrap(),
        cache(),
        Budget::new(Duration::from_secs(30)),
    );
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    let error = tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).unwrap_err();
    assert!(error.contains("Claude's answer exceeded the 1 MiB"));
    let fake = FakeClaude::start(vec![reply(aid())]);
    let budget = Budget::new(Duration::from_secs(30));
    budget.attach_admission(Arc::new(|| false));
    let ctx = context(&fake, &http, &cache, &budget, &|_| {});
    assert!(tauri::async_runtime::block_on(study_aid_with(&ctx, &source())).is_err());
    assert!(fake.log().is_empty());
}
#[test]
fn claude_unknown_page_count_is_checked_locally_and_large_request_is_refused() {
    let mut src = LoadedSource::new(synthetic_pdf(301), "application/pdf", "synthetic.pdf");
    assert!(claude::check_source(&src)
        .unwrap_err()
        .contains("Take out the chapter"));
    // A count from before the file was read cannot override the actual PDF bytes.
    src.page_count = Some(5);
    assert!(claude::check_source(&src)
        .unwrap_err()
        .contains("Take out the chapter"));
    src = LoadedSource::new(vec![0; 25 * 1024 * 1024], "image/png", "synthetic.png");
    assert!(claude::check_source(&src)
        .unwrap_err()
        .contains("too large"));
}

#[test]
fn claude_request_cap_is_exactly_32000000_bytes() {
    // JSON quotes account for two bytes. Exercise the exact serialized guard.
    let mut body = json!("x".repeat(32_000_000 - 2));
    assert_eq!(serde_json::to_vec(&body).unwrap().len(), 32_000_000);
    assert!(claude::check_request(&body).is_ok());
    body = json!("x".repeat(32_000_000 - 1));
    assert!(claude::check_request(&body)
        .unwrap_err()
        .contains("too large"));
    assert!(claude::check_size(24_000_000).is_ok());
    assert!(claude::check_size(24_000_001).is_err());
}

#[test]
fn claude_shared_dynamic_message_set_has_no_gemini_or_google_instructions() {
    let provider = AnyProvider::from(ProviderId::Claude);
    let budget = Budget::new(Duration::from_secs(30));
    for stage in [
        Stage::Preparing,
        Stage::Generating,
        Stage::Reading,
        Stage::Validating,
        Stage::Pausing,
    ] {
        budget.at(stage);
        let message = budget.details_for(None, provider);
        assert!(
            !message.contains("Gemini") && !message.contains("Google"),
            "{message}"
        );
    }
    let mut messages = vec![retry_after_message_for(
        Duration::from_secs(120),
        &budget,
        provider,
    )];
    for lost in [
        Lost::Unreachable,
        Lost::NoAnswerInTime,
        Lost::AnswerCutShort,
        Lost::Dropped,
    ] {
        messages.push(lost_message_for(lost, &budget, provider));
        messages.push(waiting_message_for(
            Some(Setback::Lost(lost)),
            2,
            Duration::from_secs(1),
            provider,
        ));
    }
    messages.push(waiting_message_for(
        None,
        2,
        Duration::from_secs(1),
        provider,
    ));
    for status in [400, 401, 403, 404, 413, 429, 500, 529] {
        messages.push(claude::error_message(status));
    }
    for message in messages {
        assert!(
            !message.contains("Gemini") && !message.contains("Google"),
            "{message}"
        );
        assert!(
            !message.contains("billing") && !message.contains("free tier"),
            "{message}"
        );
    }
}

#[test]
fn claude_adapter_preserves_user_text_even_in_first_part() {
    let text = "This is a Gemini study aid from Google Earth for pilots.pdf";
    let body = ClaudeProvider.body(
        claude::MODEL,
        &json!({"contents":[{"parts":[{"text":text}]}]}),
    );
    assert_eq!(body["messages"][0]["content"][0]["text"], text);
}

#[test]
fn section_draft_provider_switch_is_clear_before_http_for_queued_and_restarted_guides() {
    for owner in [ProviderId::Gemini, ProviderId::Claude] {
        for restart in [false, true] {
            let root = TempRoot::new();
            std::fs::write(root.0.join("documents/book.pdf"), synthetic_pdf(3)).unwrap();
            crate::provider::save_choice(&root.0, owner).unwrap();
            let request: sections::SectionRequest = serde_json::from_value(json!({"materialId":"fictional-material","relativePath":"book.pdf","chosenPages":[1,2,3],"baseRevision":null,"requestId":null})).unwrap();
            let id =
                sections::queue_study_guide_at(&root.0, &request, ModelChoice::Standard).unwrap();
            if restart {
                gemini_jobs::forget(&root.0);
            }
            let selected = if owner == ProviderId::Gemini {
                ProviderId::Claude
            } else {
                ProviderId::Gemini
            };
            crate::provider::save_choice(&root.0, selected).unwrap();
            let fake = FakeClaude::start(vec![reply(aid())]);
            let (http, cache, budget) = (
                generation_client().unwrap(),
                cache(),
                Budget::new(Duration::from_secs(30)),
            );
            let mut ctx = context(&fake, &http, &cache, &budget, &|_| {});
            ctx.provider = selected.into();
            let before = gemini_jobs::with(&root.0, |j| j.list()[0].draft.clone());
            let error = tauri::async_runtime::block_on(sections::activate(
                &ctx,
                &root.0,
                &request,
                Some(&id),
                &|_| {},
                &|_| {},
            ))
            .unwrap_err();
            assert_eq!(error.code, "GUIDE_FAILED");
            let name = owner.name();
            assert_eq!(error.message, format!("This draft was started with {name}. Use {name} in Settings to continue it, or discard it and start a new one. Your finished work is kept."));
            assert!(fake.log().is_empty());
            assert_eq!(
                gemini_jobs::with(&root.0, |j| j.list()[0].draft.clone()),
                before
            );
        }
    }
}
