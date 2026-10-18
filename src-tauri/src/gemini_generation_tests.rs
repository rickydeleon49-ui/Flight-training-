//! GEN-REL-01: a selected PDF is prepared once and referred to, never sent
//! again inline. Every request is made to a loopback stand-in
//! (`fake_gemini`); the PDFs are synthetic; no key, profile or provider is
//! used. Lines starting `MEASURE` are captured into the evidence receipts.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use lopdf::{dictionary, Document, Object};

use super::*;
use crate::fake_gemini::FakeGemini;
use crate::gemini_files::{Policy, PreparedSources};

const KEY: &str = "synthetic-key-AAAAAAAAAAAAAAAAAAAA";
const OTHER_KEY: &str = "synthetic-key-BBBBBBBBBBBBBBBBBBBB";

/// A real PDF of `pages` pages; `salt` changes its bytes but not its length
/// when the salts have the same length.
fn pdf(pages: u32, salt: &str) -> Vec<u8> {
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
    let catalog_id = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    document.trailer.set("Root", catalog_id);
    document.trailer.set(
        "Info",
        Object::Dictionary(dictionary! { "Title" => Object::string_literal(salt) }),
    );
    let mut out = Vec::new();
    document.save_to(&mut out).unwrap();
    out
}

struct Rig {
    fake: FakeGemini,
    http: Client,
    cache: PreparedSources,
    now: Arc<AtomicI64>,
    said: std::sync::Mutex<Vec<String>>,
}

fn rig() -> Rig {
    rig_with(Policy {
        poll_interval: Duration::from_millis(1),
        poll_cap: Duration::from_millis(2),
        max_polls: 3,
        delete_timeout: Duration::from_secs(2),
        ..Policy::default()
    })
}

fn rig_with(policy: Policy) -> Rig {
    let now = Arc::new(AtomicI64::new(1_700_000_000));
    let clock_now = now.clone();
    Rig {
        fake: FakeGemini::start(),
        http: client(Duration::from_secs(10)).unwrap(),
        cache: PreparedSources::new(policy, Arc::new(move || clock_now.load(Ordering::SeqCst))),
        now,
        said: std::sync::Mutex::new(Vec::new()),
    }
}

impl Rig {
    fn guide(&self, key: &str, source: &LoadedSource) -> Result<GeneratedStudyAid, String> {
        let say = |m: String| self.said.lock().unwrap().push(m);
        let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
        let ctx = GenContext {
            http: &self.http,
            base: &self.fake.base,
            api_key: key,
            choice: ModelChoice::Standard,
            cache: &self.cache,
            epoch: self.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        tauri::async_runtime::block_on(study_aid_with(&ctx, source))
    }
    fn test(&self, key: &str, source: &LoadedSource) -> Result<GeneratedPracticeTest, String> {
        let say = |m: String| self.said.lock().unwrap().push(m);
        let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
        let ctx = GenContext {
            http: &self.http,
            base: &self.fake.base,
            api_key: key,
            choice: ModelChoice::Standard,
            cache: &self.cache,
            epoch: self.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        tauri::async_runtime::block_on(practice_test_with(&ctx, source))
    }
    fn uploads(&self) -> usize {
        self.fake.count(|r| r.is_upload_finalize())
    }
    fn generations(&self) -> Vec<Value> {
        self.fake
            .log()
            .iter()
            .filter(|r| r.is_generate())
            .map(|r| r.json())
            .collect()
    }
}

fn file_uri(body: &Value) -> Option<String> {
    body.pointer("/contents/0/parts/1/file_data/file_uri")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn source(bytes: Vec<u8>, scope: &str) -> LoadedSource {
    LoadedSource::new(bytes, "application/pdf", scope)
}

/// No request body carries the PDF's bytes or their base64 form, except the
/// one upload that is supposed to.
fn assert_never_inline(rig: &Rig, bytes: &[u8]) {
    let encoded = BASE64.encode(bytes);
    let probe = &encoded[..encoded.len().min(4096)];
    for r in rig.fake.log() {
        let text = String::from_utf8_lossy(&r.body);
        assert!(
            !text.contains(probe),
            "{} {} carried the PDF as base64",
            r.method,
            r.path
        );
        assert!(
            !text.contains("inline_data"),
            "{} {} used inline_data",
            r.method,
            r.path
        );
        if !r.is_upload_finalize() {
            assert!(
                r.body.len() < bytes.len() || bytes.len() < 4096,
                "{} {} carried the whole PDF",
                r.method,
                r.path
            );
        }
    }
}

#[test]
fn a_guide_then_a_practice_test_upload_the_pdf_once_and_refer_to_it() {
    let r = rig();
    let bytes = pdf(40, "guide-then-test");
    let src = source(bytes.clone(), "documents/child-chapter-3.pdf");

    let guide = r.guide(KEY, &src).unwrap();
    let test = r.test(KEY, &src).unwrap();

    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1);
    assert_eq!(r.uploads(), 1, "one upload for both generations");
    let finalize = r
        .fake
        .log()
        .into_iter()
        .find(|q| q.is_upload_finalize())
        .unwrap();
    assert_eq!(
        finalize.body, bytes,
        "the upload is exactly the selected file's bytes"
    );
    assert_eq!(
        finalize.header("x-goog-upload-command"),
        Some("upload, finalize")
    );
    let start = r
        .fake
        .log()
        .into_iter()
        .find(|q| q.is_upload_start())
        .unwrap();
    assert_eq!(
        start.header("x-goog-upload-header-content-length"),
        Some(bytes.len().to_string().as_str())
    );
    assert_eq!(
        start.header("x-goog-upload-header-content-type"),
        Some("application/pdf")
    );
    assert!(
        !String::from_utf8_lossy(&start.body).contains("child-chapter"),
        "no local file name in upload metadata"
    );

    let generations = r.generations();
    assert_eq!(generations.len(), 2);
    let uri = file_uri(&generations[0]).expect("guide refers to the prepared file");
    assert_eq!(
        file_uri(&generations[1]),
        Some(uri.clone()),
        "the test refers to the same prepared file"
    );
    assert_eq!(uri, format!("{}/v1beta/files/synthetic-1", r.fake.base));
    assert_never_inline(&r, &bytes);
    // A cached copy is still checked before reuse.
    assert_eq!(r.fake.count(|q| q.is_lookup()), 1);
    assert_eq!(guide.model, "gemini-3.5-flash");
    assert_eq!(test.model, "gemini-3.5-flash");

    let generate_bytes: usize = r
        .fake
        .log()
        .iter()
        .filter(|q| q.is_generate())
        .map(|q| q.body.len())
        .sum();
    let legacy_inline = 2 * inline_request_bytes(bytes.len() as u64) as usize;
    println!(
        "MEASURE guide_then_test pdf_bytes={} upload_requests=1 uploaded_bytes={} generate_requests=2 generate_body_bytes={} legacy_two_inline_requests_bytes~={} lookups=1",
        bytes.len(),
        finalize.body.len(),
        generate_bytes,
        legacy_inline,
    );
}

#[test]
fn changed_bytes_at_the_same_path_and_size_are_prepared_again_and_the_old_copy_retired() {
    let r = rig();
    let a = pdf(10, "version-A");
    let b = pdf(10, "version-B");
    assert_eq!(a.len(), b.len(), "same size");
    assert_ne!(a, b);
    let scope = "documents/same-path.pdf";

    r.guide(KEY, &source(a, scope)).unwrap();
    r.guide(KEY, &source(b.clone(), scope)).unwrap();

    assert_eq!(r.uploads(), 2, "new bytes never hit the old copy");
    let generations = r.generations();
    assert_ne!(file_uri(&generations[0]), file_uri(&generations[1]));
    assert!(
        r.fake
            .count(|q| q.is_delete() && q.path.ends_with("/files/synthetic-1"))
            == 1,
        "the replaced copy is retired"
    );
    assert!(!r.fake.exists("files/synthetic-1"));
    assert!(r.fake.exists("files/synthetic-2"));
    let finalizes: Vec<_> = r
        .fake
        .log()
        .into_iter()
        .filter(|q| q.is_upload_finalize())
        .collect();
    assert_eq!(finalizes[1].body, b);
}

#[test]
fn a_different_selected_source_or_key_never_shares_a_prepared_copy() {
    let r = rig();
    let bytes = pdf(5, "shared-bytes");
    r.guide(KEY, &source(bytes.clone(), "documents/part-1.pdf"))
        .unwrap();
    // Identical bytes, another selected source: its own preparation.
    r.guide(KEY, &source(bytes.clone(), "documents/part-1-copy.pdf"))
        .unwrap();
    assert_eq!(r.uploads(), 2);
    // Same source, another key (another project): its own preparation.
    r.guide(OTHER_KEY, &source(bytes, "documents/part-1.pdf"))
        .unwrap();
    assert_eq!(r.uploads(), 3);
    let keys: Vec<String> = r
        .fake
        .log()
        .iter()
        .filter(|q| q.is_generate())
        .map(|q| q.header("x-goog-api-key").unwrap().to_string())
        .collect();
    assert_eq!(keys, vec![KEY, KEY, OTHER_KEY]);
    // Nothing made with one key was deleted with the other.
    assert_eq!(r.fake.count(|q| q.is_delete()), 0);
    let uris: Vec<_> = r.generations().iter().map(file_uri).collect();
    assert_eq!(
        uris.iter().collect::<std::collections::HashSet<_>>().len(),
        3
    );
}

#[test]
fn text_and_images_still_go_inline_and_are_held_to_the_encoded_request_limit() {
    let r = rig();
    let text = LoadedSource::new(
        b"Synthetic notes about Class B airspace.".to_vec(),
        "text/plain",
        "documents/notes.txt",
    );
    r.guide(KEY, &text).unwrap();
    assert_eq!(r.uploads(), 0);
    let body = &r.generations()[0];
    assert_eq!(
        body.pointer("/contents/0/parts/1/inline_data/mime_type")
            .and_then(Value::as_str),
        Some("text/plain")
    );
    // A raw size under the request cap can overflow it once encoded.
    let raw = 80 * 1024 * 1024;
    assert!(raw <= MAX_INLINE_BYTES);
    assert!(check_size("image/png", raw)
        .unwrap_err()
        .contains("once it is encoded"));
    assert!(check_size("image/png", 70 * 1024 * 1024).is_ok());
    // PDFs keep Google's own PDF limit and no longer travel inline.
    assert!(check_size("application/pdf", MAX_PDF_BYTES).is_ok());
    assert!(check_size("application/pdf", MAX_PDF_BYTES + 1).is_err());
}

#[test]
fn a_processing_file_is_waited_for_boundedly_before_it_is_used() {
    let r = rig();
    r.fake.behave(|b| {
        b.initial_state = "PROCESSING";
        b.polls_until_active = Some(1);
    });
    r.guide(KEY, &source(pdf(3, "processing"), "documents/p.pdf"))
        .unwrap();
    assert_eq!(r.fake.count(|q| q.is_lookup()), 2, "polled until ACTIVE");
    assert_eq!(r.generations().len(), 1);
    assert!(r
        .said
        .lock()
        .unwrap()
        .iter()
        .any(|m| m.contains("preparing the uploaded PDF")));
}

#[test]
fn processing_that_never_finishes_stops_at_the_poll_bound_and_retires_the_upload() {
    let r = rig();
    r.fake.behave(|b| {
        b.initial_state = "PROCESSING";
        b.polls_until_active = None;
    });
    let error = r
        .guide(KEY, &source(pdf(3, "stuck"), "documents/p.pdf"))
        .unwrap_err();
    assert!(error.contains("still preparing"), "{error}");
    assert_eq!(
        r.fake.count(|q| q.is_lookup()),
        3,
        "exactly max_polls checks"
    );
    assert_eq!(
        r.generations().len(),
        0,
        "never generated from an unready file"
    );
    assert_eq!(r.uploads(), 1, "no re-upload loop");
    assert_eq!(r.fake.count(|q| q.is_delete()), 1);
    assert_eq!(r.cache.ready_len(), 0);
}

#[test]
fn failed_processing_is_explained_without_generation_or_a_retry_loop() {
    let r = rig();
    r.fake.behave(|b| b.initial_state = "FAILED");
    let error = r
        .guide(KEY, &source(pdf(3, "failed"), "documents/p.pdf"))
        .unwrap_err();
    assert!(error.contains("could not process this PDF"), "{error}");
    assert_eq!(r.generations().len(), 0);
    assert_eq!(r.uploads(), 1);
    assert_eq!(
        r.fake.count(|q| q.is_delete()),
        1,
        "its own failed upload is retired"
    );
    assert_eq!(r.cache.ready_len(), 0);
}

#[test]
fn a_locally_expired_copy_is_not_reused_and_is_prepared_once_more() {
    let r = rig();
    r.fake
        .behave(|b| b.expiration_time = Some("2023-11-15T00:00:00Z".to_string()));
    // 1_700_000_000 is 2023-11-14T22:13:20Z: the copy expires about 1h46m later.
    let src = source(pdf(4, "expiring"), "documents/e.pdf");
    r.guide(KEY, &src).unwrap();
    r.now.store(1_700_000_000 + 6_000, Ordering::SeqCst); // inside the reuse margin
    r.test(KEY, &src).unwrap();
    assert_eq!(
        r.uploads(),
        2,
        "too close to expiry to trust for another request"
    );
    assert_eq!(
        r.fake.count(|q| q.is_lookup()),
        0,
        "no lookup of an expired copy"
    );
    let uris: Vec<_> = r.generations().iter().map(file_uri).collect();
    assert_ne!(uris[0], uris[1]);
}

#[test]
fn a_copy_deleted_at_google_is_detected_before_reuse_and_prepared_once_more() {
    let r = rig();
    let src = source(pdf(4, "vanishing"), "documents/v.pdf");
    r.guide(KEY, &src).unwrap();
    r.fake.vanish("files/synthetic-1");
    r.test(KEY, &src).unwrap();
    assert_eq!(r.uploads(), 2);
    assert_eq!(r.fake.count(|q| q.is_lookup()), 1);
    assert_eq!(
        file_uri(&r.generations()[1]),
        Some(format!("{}/v1beta/files/synthetic-2", r.fake.base))
    );
}

#[test]
fn a_copy_lost_during_generation_is_prepared_again_exactly_once() {
    let r = rig();
    let src = source(pdf(4, "lost"), "documents/l.pdf");
    // The first generation is refused because the file is gone, and so is the
    // generation after the one re-preparation: bounded, then explained.
    r.fake.behave(|b| {
        b.generate_statuses = vec![
            (
                400,
                r#"{"error":{"code":400,"message":"synthetic: file missing"}}"#.to_string(),
            ),
            (
                400,
                r#"{"error":{"code":400,"message":"synthetic: file missing"}}"#.to_string(),
            ),
        ];
    });
    // Make the lookup after the first refusal report the file missing.
    r.fake.behave(|b| b.lookup_status = Some(404));
    let error = r.guide(KEY, &src).unwrap_err();
    assert!(error.contains("rejected the request"), "{error}");
    assert_eq!(r.uploads(), 2, "exactly one re-preparation");
    assert_eq!(r.generations().len(), 2, "exactly one more generation");
}

#[test]
fn a_refusal_while_the_copy_is_healthy_stands_and_is_not_turned_into_a_reupload() {
    let r = rig();
    r.fake.behave(|b| {
        b.generate_statuses = vec![(
            404,
            r#"{"error":{"code":404,"message":"models/x is not found"}}"#.to_string(),
        )];
    });
    let error = r
        .guide(KEY, &source(pdf(2, "model-404"), "documents/m.pdf"))
        .unwrap_err();
    assert!(
        error.contains("could not find the gemini-3.5-flash model"),
        "a missing model still reads as a missing model: {error}"
    );
    assert_eq!(r.uploads(), 1);
    assert_eq!(
        r.fake.count(|q| q.is_lookup()),
        1,
        "the copy was checked and found healthy"
    );
}

#[test]
fn a_throttled_upload_is_explained_once_without_generation() {
    let r = rig();
    r.fake.behave(|b| b.start_status = Some(429));
    let error = r
        .guide(KEY, &source(pdf(2, "throttled"), "documents/t.pdf"))
        .unwrap_err();
    assert!(error.contains("limiting uploads"), "{error}");
    assert_eq!(r.fake.count(|q| q.is_upload_start()), 1, "no upload loop");
    assert_eq!(r.generations().len(), 0);
}

#[test]
fn an_interrupted_upload_is_explained_caches_nothing_and_the_next_try_uploads_again() {
    let r = rig();
    r.fake.behave(|b| b.drop_finalize = true);
    let src = source(pdf(2, "interrupted"), "documents/i.pdf");
    let error = r.guide(KEY, &src).unwrap_err();
    assert!(
        error.contains("interrupted") || error.contains("Could not reach"),
        "{error}"
    );
    assert!(
        !error.contains("upload_id"),
        "no upload session locator in the message: {error}"
    );
    assert_eq!(r.generations().len(), 0);
    assert_eq!(r.cache.ready_len(), 0);
    r.fake.behave(|b| b.drop_finalize = false);
    r.guide(KEY, &src).unwrap();
    assert_eq!(r.fake.count(|q| q.is_upload_finalize()), 2);
}

#[test]
fn malformed_upload_answers_are_refused_and_never_followed() {
    for (label, setup) in [
        (
            "no upload address",
            Box::new(|b: &mut crate::fake_gemini::Behaviour| b.omit_upload_url = true)
                as Box<dyn Fn(&mut crate::fake_gemini::Behaviour)>,
        ),
        (
            "foreign upload address",
            Box::new(|b: &mut crate::fake_gemini::Behaviour| b.foreign_upload_url = true),
        ),
        (
            "foreign file URI",
            Box::new(|b: &mut crate::fake_gemini::Behaviour| b.foreign_file_uri = true),
        ),
        (
            "finalize refused",
            Box::new(|b: &mut crate::fake_gemini::Behaviour| b.finalize_status = Some(500)),
        ),
    ] {
        let r = rig();
        r.fake.behave(|b| setup(b));
        let error = r
            .guide(KEY, &source(pdf(2, "malformed"), "documents/x.pdf"))
            .unwrap_err();
        assert!(!error.contains("elsewhere.invalid"), "{label}: {error}");
        assert_eq!(r.generations().len(), 0, "{label}");
        assert_eq!(r.cache.ready_len(), 0, "{label}");
    }
}

#[test]
fn an_unusable_generation_answer_is_refused_and_the_valid_copy_stays_reusable() {
    let r = rig();
    let src = source(pdf(2, "garbage"), "documents/g.pdf");
    r.fake.behave(|b| b.garbage_answer = true);
    let error = r.guide(KEY, &src).unwrap_err();
    assert!(error.contains("did not return a usable answer"), "{error}");
    r.fake.behave(|b| b.garbage_answer = false);
    r.test(KEY, &src).unwrap();
    assert_eq!(r.uploads(), 1, "the prepared copy was still valid");
}

#[test]
fn a_lookup_failure_is_reported_without_uploading_again() {
    let r = rig();
    let src = source(pdf(2, "lookup-500"), "documents/k.pdf");
    r.guide(KEY, &src).unwrap();
    r.fake.behave(|b| b.lookup_status = Some(500));
    let error = r.test(KEY, &src).unwrap_err();
    assert!(error.contains("busy"), "{error}");
    assert_eq!(r.uploads(), 1);
    assert_eq!(r.generations().len(), 1);
}

#[test]
fn only_the_selected_split_part_is_sent_first_page_and_last_page() {
    let dir = std::env::temp_dir().join(format!("hfd-genrel01-split-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let parent_path = dir.join("parent.pdf");
    let parent = pdf(30, "parent-handbook");
    std::fs::write(&parent_path, &parent).unwrap();
    let r = rig();
    for (label, first, last) in [("first", 1u32, 1u32), ("last", 30, 30), ("chapter", 11, 20)] {
        let child_path = dir.join(format!("child-{label}.pdf"));
        let written = crate::pdf::write_page_range(&parent_path, &child_path, first, last).unwrap();
        assert_eq!(written, last - first + 1);
        let child = std::fs::read(&child_path).unwrap();
        let before = r.uploads();
        r.guide(
            KEY,
            &source(child.clone(), &format!("documents/child-{label}.pdf")),
        )
        .unwrap();
        let finalize = r
            .fake
            .log()
            .into_iter()
            .filter(|q| q.is_upload_finalize())
            .nth(before)
            .unwrap();
        assert_eq!(
            finalize.body, child,
            "{label}: only the child's bytes leave"
        );
        let uploaded = Document::load_mem(&finalize.body).unwrap();
        assert_eq!(
            uploaded.get_pages().len() as u32,
            last - first + 1,
            "{label}"
        );
        assert_ne!(finalize.body, parent);
        println!(
            "MEASURE split_{label} parent_bytes={} child_bytes={} child_pages={}",
            parent.len(),
            child.len(),
            last - first + 1
        );
    }
    assert_eq!(
        std::fs::read(&parent_path).unwrap(),
        parent,
        "the original is untouched"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn messages_and_cache_identity_never_carry_the_key_locators_or_paths() {
    let r = rig();
    let src = source(pdf(2, "privacy"), "documents/private-folder/her-file.pdf");
    r.guide(KEY, &src).unwrap();
    let key = r.cache.key_for(&r.fake.base, KEY, &src.as_source());
    let debug = format!("{key:?}");
    assert!(!debug.contains(KEY), "the key itself is never kept");
    for message in r.said.lock().unwrap().iter() {
        assert!(!message.contains("files/"), "{message}");
        assert!(!message.contains("upload_id"), "{message}");
        assert!(!message.contains("private-folder"), "{message}");
        assert!(!message.contains(KEY), "{message}");
    }
    // Upload metadata names no local file.
    let start = r
        .fake
        .log()
        .into_iter()
        .find(|q| q.is_upload_start())
        .unwrap();
    assert!(!String::from_utf8_lossy(&start.body).contains("her-file"));
}

/// A synthetic PDF padded to about `megabytes` with an unreferenced stream of
/// pseudo-random bytes (so it neither compresses nor matches another file).
fn large_pdf(pages: u32, megabytes: usize) -> Vec<u8> {
    let mut document = Document::load_mem(&pdf(pages, "large")).unwrap();
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let data: Vec<u8> = (0..megabytes * 1024 * 1024)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state & 0xff) as u8
        })
        .collect();
    document.add_object(lopdf::Stream::new(dictionary! {}, data));
    let mut out = Vec::new();
    document.save_to(&mut out).unwrap();
    out
}

#[test]
fn a_large_pdf_is_uploaded_once_and_never_inlined() {
    let r = rig();
    let bytes = large_pdf(200, 8);
    assert!(bytes.len() > 8 * 1024 * 1024);
    let src = source(bytes.clone(), "documents/large-handbook-part.pdf");
    r.guide(KEY, &src).unwrap();
    r.test(KEY, &src).unwrap();
    assert_eq!(r.uploads(), 1);
    assert_never_inline(&r, &bytes);
    let log = r.fake.log();
    let uploaded: usize = log
        .iter()
        .filter(|q| q.is_upload_finalize())
        .map(|q| q.body.len())
        .sum();
    let generate_max = log
        .iter()
        .filter(|q| q.is_generate())
        .map(|q| q.body.len())
        .max()
        .unwrap();
    let total: usize = log.iter().map(|q| q.body.len()).sum();
    assert_eq!(uploaded, bytes.len());
    assert!(
        generate_max < 8 * 1024,
        "a generation request refers, it does not carry: {generate_max}"
    );
    println!(
        "MEASURE large_pdf pdf_bytes={} uploaded_bytes={} largest_generate_body_bytes={} all_request_body_bytes={} legacy_two_inline_requests_bytes~={}",
        bytes.len(),
        uploaded,
        generate_max,
        total,
        2 * inline_request_bytes(bytes.len() as u64),
    );
}

/* ------------------------------------------------------------------ */
/* Review round 1 regressions (GENREL01-R1, R5)                        */
/* ------------------------------------------------------------------ */

#[test]
fn r5_redirects_are_never_followed_with_the_key_or_the_pdf() {
    let r = rig();
    let elsewhere = FakeGemini::start();
    let target = format!("{}/upload/v1beta/files?upload_id=u99", elsewhere.base);

    // The fixture is meaningful: a client with reqwest's default policy
    // follows this redirect, carrying the key to the other server.
    let default_client = Client::builder().build().unwrap();
    r.fake
        .behave(|b| b.finalize_redirect = Some(target.clone()));
    let _ = tauri::async_runtime::block_on(gemini_files::upload(
        &default_client,
        &r.fake.base,
        KEY,
        b"%PDF-synthetic-redirect-probe",
        "application/pdf",
        &Budget::new(gemini_budget::ACTIVE_BUDGET),
    ));
    let leaked = elsewhere.log();
    assert_eq!(leaked.len(), 1, "the default policy follows the redirect");
    assert_eq!(leaked[0].header("x-goog-api-key"), Some(KEY));

    // The application's client refuses it: nothing reaches the other server.
    let before = elsewhere.log().len();
    let bytes = pdf(2, "redirected");
    let error = r
        .guide(KEY, &source(bytes.clone(), "documents/r.pdf"))
        .unwrap_err();
    assert!(error.contains("refused the upload (307)"), "{error}");
    assert_eq!(
        elsewhere.log().len(),
        before,
        "no request, key or PDF bytes"
    );
    assert_eq!(r.generations().len(), 0);

    // A redirected generation request is refused the same way.
    r.fake.behave(|b| {
        b.finalize_redirect = None;
        b.generate_redirect = Some(format!(
            "{}/v1beta/models/x:generateContent",
            elsewhere.base
        ));
    });
    assert!(r.guide(KEY, &source(bytes, "documents/r.pdf")).is_err());
    assert_eq!(
        elsewhere.log().len(),
        before,
        "nothing followed the redirect"
    );
}

#[test]
fn r1_a_generation_begun_before_disconnect_is_refused_without_any_request() {
    let r = rig();
    let say = |m: String| r.said.lock().unwrap().push(m);
    let old = r.cache.epoch();
    r.cache.invalidate_all();
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let ctx = GenContext {
        http: &r.http,
        base: &r.fake.base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: old,
        budget: &budget,
        say: &say,
    };
    let outcome = tauri::async_runtime::block_on(study_aid_with(
        &ctx,
        &source(pdf(2, "old-epoch"), "documents/o.pdf"),
    ));
    assert_eq!(outcome.unwrap_err(), gemini_files::STALE_CONTEXT);
    assert_eq!(r.fake.log().len(), 0);
}

/* ------------------------------------------------------------------ */
/* Review round 2 regressions (GENREL01-R8, R9)                        */
/* ------------------------------------------------------------------ */

#[test]
fn r8_a_result_is_refused_if_the_context_ends_during_the_final_cleanup() {
    use crate::fake_gemini::Gate;
    let r = rig();
    let a = source(pdf(2, "r8-final-A"), "documents/s.pdf");
    let generate = Arc::new(Gate::default());
    let delete = Arc::new(Gate::default());
    r.fake.behave(|b| b.generate_gate = Some(generate.clone()));
    std::thread::scope(|scope| {
        let running = scope.spawn(|| r.guide(KEY, &a));
        wait_for(|| generate.waiting() == 1);
        // Changed bytes at the same selected source: A's deletion is
        // deferred because the running generation still uses it.
        let b_bytes = pdf(2, "r8-final-B");
        let content = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(&b_bytes));
        let b = gemini_files::Source {
            bytes: &b_bytes,
            content_sha256: &content,
            mime: "application/pdf",
            scope: "documents/s.pdf",
        };
        let lease = tauri::async_runtime::block_on(r.cache.prepare(
            &r.http,
            &r.fake.base,
            KEY,
            &b,
            r.cache.epoch(),
            None,
            &Budget::new(gemini_budget::ACTIVE_BUDGET),
            &|_| {},
        ))
        .unwrap();
        tauri::async_runtime::block_on(r.cache.finish(lease, &r.http, KEY));
        assert!(r.fake.exists("files/synthetic-1"), "A still in use");
        r.fake.behave(|b| b.delete_gate = Some(delete.clone()));
        generate.open();
        wait_for(|| delete.waiting() == 1);
        r.cache.invalidate_all();
        delete.open();
        assert_eq!(
            running.join().unwrap().unwrap_err(),
            gemini_files::STALE_CONTEXT
        );
    });
}

#[test]
fn r8_a_retry_after_a_pause_is_not_sent_once_the_context_has_ended() {
    let r = rig();
    r.fake
        .behave(|b| b.generate_statuses = vec![(503, r#"{"error":{"code":503}}"#.to_string())]);
    let src = source(pdf(2, "r8-retry"), "documents/t.pdf");
    std::thread::scope(|scope| {
        let running = scope.spawn(|| r.guide(KEY, &src));
        wait_for(|| r.said.lock().unwrap().iter().any(|m| m.contains("Waiting")));
        r.cache.invalidate_all();
        assert_eq!(
            running.join().unwrap().unwrap_err(),
            gemini_files::STALE_CONTEXT
        );
    });
    assert_eq!(r.generations().len(), 1, "no request after the pause");
}

#[test]
fn r9_an_unclassified_refusal_never_repeats_googles_message_text() {
    let r = rig();
    let echoed = format!(
        "files/synthetic-1 {}/v1beta/files/synthetic-1 {KEY} upload_id=u1 \
         /Users/someone/Documents/private.pdf SOURCE-CONTENT-MARKER",
        r.fake.base
    );
    r.fake.behave(|b| {
        b.generate_statuses = vec![(
            409,
            json!({"error": {"code": 409, "message": echoed}}).to_string(),
        )]
    });
    let error = r
        .guide(KEY, &source(pdf(2, "r9"), "documents/n.pdf"))
        .unwrap_err();
    assert!(error.contains("(409)"), "{error}");
    for forbidden in [
        "files/synthetic",
        "/v1beta/",
        KEY,
        "upload_id",
        "/Users/",
        "SOURCE-CONTENT-MARKER",
    ] {
        assert!(!error.contains(forbidden), "{forbidden} in: {error}");
    }
}

fn wait_for(f: impl Fn() -> bool) {
    for _ in 0..5_000 {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("timed out");
}

#[test]
fn r10_a_permission_refusal_after_a_refused_generation_never_uploads_again() {
    let r = rig();
    let src = source(pdf(2, "r10-generation"), "documents/p.pdf");
    r.fake.behave(|b| {
        b.generate_statuses = vec![(403, r#"{"error":{"code":403}}"#.to_string())];
        b.lookup_status = Some(403);
    });
    let error = r.guide(KEY, &src).unwrap_err();
    assert!(error.contains("did not allow this key"), "{error}");
    assert_eq!(r.uploads(), 1, "the copy is not prepared again");
    assert_eq!(r.generations().len(), 1);
    assert!(
        !r.said
            .lock()
            .unwrap()
            .iter()
            .any(|m| m.contains("no longer available")),
        "it is not described as a missing copy"
    );
}

/* ------------------------------------------------------------------ */
/* GEN-REL-02: generations are recorded jobs                           */
/* ------------------------------------------------------------------ */

struct JobRoot(std::path::PathBuf);

impl JobRoot {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-gen-jobs-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        JobRoot(dir)
    }
}

impl Drop for JobRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl Rig {
    fn guide_job(
        &self,
        root: &std::path::Path,
        material: &str,
        source: &LoadedSource,
    ) -> Result<JobAnswer<GeneratedStudyAid>, String> {
        let say = |m: String| self.said.lock().unwrap().push(m);
        let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
        let ctx = GenContext {
            http: &self.http,
            base: &self.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &self.cache,
            epoch: self.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        tauri::async_runtime::block_on(as_job(
            root,
            JobKind::StudyAid,
            material,
            None,
            source,
            study_aid_with(&ctx, source),
            &|_| {},
        ))
    }
}

#[test]
fn a_finished_generation_is_checkpointed_with_its_source_identity_and_nothing_secret() {
    let r = rig();
    let root = JobRoot::new("checkpoint");
    let src = source(pdf(2, "job-checkpoint"), "documents/j.pdf");
    let answer = r.guide_job(&root.0, "mat-j", &src).unwrap();
    let id = answer.job_id.clone().unwrap();
    assert_eq!(answer.content_sha256, src.content_sha256);

    let jobs = gemini_jobs::with(&root.0, |j| j.list());
    let job = jobs.iter().find(|j| j.id == id).unwrap();
    assert_eq!(job.stage, JobStage::Ready);
    assert_eq!(job.material_id, "mat-j");
    assert_eq!(job.relative_path, "documents/j.pdf");
    assert_eq!(job.content_sha256, src.content_sha256);
    assert_eq!(
        job.result.as_ref().unwrap()["title"],
        "Synthetic airspace",
        "the validated answer is the checkpoint"
    );

    let on_disk = std::fs::read_to_string(root.0.join(gemini_jobs::JOURNAL_FILE)).unwrap();
    for forbidden in [
        KEY,
        "files/synthetic",
        "/v1beta/",
        "upload_id",
        &r.fake.base,
    ] {
        assert!(!on_disk.contains(forbidden), "{forbidden} in the journal");
    }
    assert_eq!(r.generations().len(), 1);
}

#[test]
fn a_failed_generation_is_recorded_and_frees_the_lock() {
    let r = rig();
    let root = JobRoot::new("failed");
    r.fake.behave(|b| b.start_status = Some(429));
    let src = source(pdf(2, "job-failed"), "documents/f.pdf");
    let error = r.guide_job(&root.0, "mat-f", &src).unwrap_err();
    let jobs = gemini_jobs::with(&root.0, |j| j.list());
    assert_eq!(jobs[0].stage, JobStage::Failed);
    assert_eq!(jobs[0].error.as_deref(), Some(error.as_str()));
    r.fake.behave(|b| b.start_status = None);
    assert!(
        r.guide_job(&root.0, "mat-f", &src).is_ok(),
        "not left running"
    );
}

#[test]
fn while_one_job_runs_another_is_refused_before_anything_is_sent() {
    let r = rig();
    let root = JobRoot::new("busy");
    gemini_jobs::with(&root.0, |j| {
        j.begin(
            JobKind::PracticeTest,
            "mat-other",
            "documents/o.pdf",
            "x",
            None,
        )
    })
    .unwrap();
    let error = r
        .guide_job(
            &root.0,
            "mat-b",
            &source(pdf(2, "job-busy"), "documents/b.pdf"),
        )
        .unwrap_err();
    assert_eq!(error, gemini_jobs::BUSY);
    assert_eq!(r.fake.log().len(), 0, "nothing reached Gemini");
}

#[test]
fn work_that_stops_without_an_outcome_does_not_hold_the_lock() {
    let root = JobRoot::new("dropped");
    let src = source(b"%PDF-synthetic-dropped".to_vec(), "documents/d.pdf");
    let never = std::future::pending::<Result<GeneratedStudyAid, String>>();
    let heard = std::sync::Mutex::new(Vec::new());
    let changed = |record: &JobRecord| heard.lock().unwrap().push(record.stage);
    let job = as_job(
        &root.0,
        JobKind::StudyAid,
        "mat-d",
        None,
        &src,
        never,
        &changed,
    );
    // Poll once so the job begins, then drop it, as a cancelled task would.
    let waker = std::task::Waker::noop();
    let mut cx = std::task::Context::from_waker(waker);
    let mut job = Box::pin(job);
    assert!(std::future::Future::poll(job.as_mut(), &mut cx).is_pending());
    assert_eq!(
        gemini_jobs::with(&root.0, |j| j.list())[0].stage,
        JobStage::Running
    );
    drop(job);
    let jobs = gemini_jobs::with(&root.0, |j| j.list());
    assert_eq!(jobs[0].stage, JobStage::Failed);
    assert!(jobs[0].error.as_deref().unwrap().contains("stopped"));
    // GENREL02-R5: a window following the job hears that it ended.
    assert_eq!(*heard.lock().unwrap(), vec![JobStage::Failed]);
}

#[test]
fn r13_every_generation_is_recorded_so_none_can_bypass_the_lock() {
    let r = rig();
    let root = JobRoot::new("r13");
    let held = source(b"%PDF-synthetic-r13-held".to_vec(), "documents/h.pdf");
    let never = std::future::pending::<Result<GeneratedStudyAid, String>>();
    let first = as_job(
        &root.0,
        JobKind::StudyAid,
        "mat-h",
        None,
        &held,
        never,
        &|_| {},
    );
    let waker = std::task::Waker::noop();
    let mut cx = std::task::Context::from_waker(waker);
    let mut first = Box::pin(first);
    assert!(std::future::Future::poll(first.as_mut(), &mut cx).is_pending());
    // Whichever page or caller asks next, it meets the same lock.
    for (kind, material) in [
        (JobKind::StudyAid, "mat-x"),
        (JobKind::PracticeTest, "mat-h"),
    ] {
        let src = source(pdf(2, "r13-second"), "documents/x.pdf");
        let say = |m: String| r.said.lock().unwrap().push(m);
        let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
        let ctx = GenContext {
            http: &r.http,
            base: &r.fake.base,
            api_key: KEY,
            choice: ModelChoice::Standard,
            cache: &r.cache,
            epoch: r.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        let refused = tauri::async_runtime::block_on(as_job(
            &root.0,
            kind,
            material,
            None,
            &src,
            study_aid_with(&ctx, &src),
            &|_| {},
        ));
        assert_eq!(refused.unwrap_err(), gemini_jobs::BUSY);
    }
    assert_eq!(r.fake.log().len(), 0, "nothing reached Gemini");
    drop(first);
}

#[test]
fn the_window_receives_the_answer_job_and_content_identity_in_one_shape() {
    let r = rig();
    let root = JobRoot::new("shape");
    let src = source(pdf(2, "job-shape"), "documents/s.pdf");
    let value = serde_json::to_value(r.guide_job(&root.0, "mat-s", &src).unwrap()).unwrap();
    assert_eq!(value["title"], "Synthetic airspace");
    assert!(value["jobId"].as_str().unwrap().starts_with("job-"));
    assert_eq!(value["contentSha256"], src.content_sha256.as_str());
    assert!(value.get("answer").is_none(), "flattened");
}

#[test]
fn r2_an_answer_that_cannot_be_checkpointed_is_handed_over_marked_as_not_kept() {
    let r = rig();
    let root = JobRoot::new("r2-checkpoint");
    let src = source(pdf(2, "r2-not-kept"), "documents/k.pdf");
    let say = |m: String| r.said.lock().unwrap().push(m);
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let ctx = GenContext {
        http: &r.http,
        base: &r.fake.base,
        api_key: KEY,
        choice: ModelChoice::Standard,
        cache: &r.cache,
        epoch: r.cache.epoch(),
        budget: &budget,
        say: &say,
    };
    let blocked = root.0.join("gemini-jobs.json.writing");
    let work = async {
        let answer = study_aid_with(&ctx, &src).await;
        // The disk fills up after Gemini answered, before the checkpoint.
        std::fs::create_dir_all(&blocked).unwrap();
        answer
    };
    let answer = tauri::async_runtime::block_on(as_job(
        &root.0,
        JobKind::StudyAid,
        "mat-k",
        None,
        &src,
        work,
        &|_| {},
    ))
    .unwrap();
    assert!(!answer.checkpointed);
    assert!(answer.job_id.is_none());
    std::fs::remove_dir_all(&blocked).unwrap();
    assert!(
        gemini_jobs::with(&root.0, |j| j.list())
            .iter()
            .all(|j| j.stage != JobStage::Running),
        "the lock is not held"
    );
    let value = serde_json::to_value(&answer).unwrap();
    assert_eq!(value["checkpointed"], false);
}
