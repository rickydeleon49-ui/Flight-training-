//! OFFLINE-01a: the real binary as the extraction worker, driven through the
//! supervisor exactly as the app will. All documents are synthetic.

use her_flight_deck_lib::extraction::inspect::Outcome;
use her_flight_deck_lib::extraction::supervisor::{self, Extraction, Failure, Job};
use her_flight_deck_lib::extraction::worker::{
    Limits, EXIT_BAD_ARGS, EXIT_BAD_REQUEST, WORKER_FLAG,
};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const WORKER: &str = env!("CARGO_BIN_EXE_her-flight-deck");
const MIB: usize = 1024 * 1024;

struct Scratch(PathBuf);
impl Scratch {
    fn new(tag: &str) -> Self {
        // Parallel tests can read the same clock value; never share a folder.
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "hfd-extract-{tag}-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn write(&self, name: &str, bytes: &[u8]) -> (PathBuf, String) {
        let path = self.0.join(name);
        std::fs::write(&path, bytes).unwrap();
        (path, hex::encode(Sha256::digest(bytes)))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A small builder for synthetic PDFs.
struct Pdf {
    doc: Document,
    pages_id: ObjectId,
    kids: Vec<Object>,
    font: ObjectId,
}
impl Pdf {
    fn new() -> Self {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        });
        Self {
            doc,
            pages_id,
            kids: Vec::new(),
            font,
        }
    }
    fn page_with(&mut self, content: Vec<u8>, resources: lopdf::Dictionary, compress: bool) {
        let mut stream = Stream::new(dictionary! {}, content);
        if compress {
            stream.compress().unwrap();
        } else {
            stream.allows_compression = false;
        }
        let content_id = self.doc.add_object(stream);
        let page = self.doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => self.pages_id, "Contents" => content_id,
            "Resources" => resources,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        self.kids.push(page.into());
    }
    fn text(&mut self, words: &str) {
        let font = self.font;
        self.page_with(
            format!("BT /F1 12 Tf 72 700 Td ({words}) Tj ET").into_bytes(),
            dictionary! { "Font" => dictionary! { "F1" => font } },
            false,
        );
    }
    fn image(&mut self) {
        let mut img = Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8 },
            vec![0u8],
        );
        img.allows_compression = false;
        let img = self.doc.add_object(img);
        self.page_with(
            b"q 100 0 0 100 0 0 cm /Im1 Do Q".to_vec(),
            dictionary! { "XObject" => dictionary! { "Im1" => img } },
            false,
        );
    }
    fn blank(&mut self) {
        self.page_with(b"0 0 m 10 10 l S".to_vec(), dictionary! {}, false);
    }
    fn bytes(mut self) -> Vec<u8> {
        let count = self.kids.len() as i64;
        self.doc.objects.insert(
            self.pages_id,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Count" => count, "Kids" => self.kids },
            ),
        );
        let catalog = self
            .doc
            .add_object(dictionary! { "Type" => "Catalog", "Pages" => self.pages_id });
        self.doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        self.doc.save_to(&mut out).unwrap();
        out
    }
}

fn run_with(
    file: &Path,
    sha: &str,
    limits: Limits,
    deadline: Duration,
    extra: Option<serde_json::Value>,
    cancel: Arc<AtomicBool>,
) -> Result<Extraction, Failure> {
    supervisor::run(Job {
        worker: Path::new(WORKER),
        file,
        sha256: sha,
        limits,
        deadline,
        cancel,
        extra,
    })
}

fn run(file: &Path, sha: &str, limits: Limits) -> Result<Extraction, Failure> {
    run_with(
        file,
        sha,
        limits,
        Duration::from_secs(20),
        None,
        Arc::new(AtomicBool::new(false)),
    )
}

fn hook(
    file: &Path,
    sha: &str,
    memory: usize,
    hook: serde_json::Value,
    deadline: Duration,
) -> Result<Extraction, Failure> {
    let limits = Limits {
        memory_bytes: Some(memory),
        ..Limits::default()
    };
    run_with(
        file,
        sha,
        limits,
        deadline,
        Some(serde_json::json!({ "test": hook })),
        Arc::new(AtomicBool::new(false)),
    )
}

fn sample(s: &Scratch) -> (PathBuf, String) {
    let mut pdf = Pdf::new();
    pdf.text("Crosswind landing technique");
    s.write("sample.pdf", &pdf.bytes())
}

#[test]
fn extracts_text_image_and_blank_pages_in_order() {
    let s = Scratch::new("pages");
    let mut pdf = Pdf::new();
    pdf.text("Density altitude");
    pdf.image();
    pdf.blank();
    let (path, sha) = s.write("three.pdf", &pdf.bytes());
    let out = run(&path, &sha, Limits::default()).unwrap();
    assert_eq!(out.sha256, sha);
    let outcomes: Vec<_> = out.pages.iter().map(|p| (p.index, p.outcome)).collect();
    assert_eq!(
        outcomes,
        vec![
            (1, Outcome::Text),
            (2, Outcome::ImageOnly),
            (3, Outcome::Blank)
        ]
    );
    assert!(out.pages[0].text.contains("Density altitude"));
    assert!(out.pages[1].text.is_empty() && out.pages[2].text.is_empty());
}

#[test]
fn a_changed_file_is_refused_by_identity() {
    let s = Scratch::new("identity");
    let (path, _) = sample(&s);
    let wrong = "0".repeat(64);
    assert_eq!(
        run(&path, &wrong, Limits::default()),
        Err(Failure::Reported("identity_mismatch".into()))
    );
}

#[test]
fn not_a_pdf_and_oversized_input_are_reported_not_crashed() {
    let s = Scratch::new("input");
    let (path, sha) = s.write("notes.pdf", b"plain text, not a PDF");
    assert_eq!(
        run(&path, &sha, Limits::default()),
        Err(Failure::Reported("malformed".into()))
    );
    let (path, sha) = sample(&s);
    let limits = Limits {
        input_bytes: Some(64),
        ..Limits::default()
    };
    assert_eq!(
        run(&path, &sha, limits),
        Err(Failure::Reported("input_too_large".into()))
    );
}

#[test]
fn page_text_over_its_limit_fails_that_page_only() {
    let s = Scratch::new("pagelimit");
    let (path, sha) = sample(&s);
    let limits = Limits {
        page_text_bytes: Some(8),
        ..Limits::default()
    };
    let out = run(&path, &sha, limits).unwrap();
    assert_eq!(out.pages[0].outcome, Outcome::Failed);
    assert_eq!(out.pages[0].error.as_deref(), Some("page_text_limit"));
    assert!(out.pages[0].text.is_empty());
}

#[test]
fn a_content_stream_bomb_stops_at_the_memory_cap() {
    let s = Scratch::new("bomb");
    let mut pdf = Pdf::new();
    let font = pdf.font;
    let mut content = b"BT /F1 12 Tf (x) Tj ET ".to_vec();
    content.resize(96 * MIB, b' ');
    pdf.page_with(
        content,
        dictionary! { "Font" => dictionary! { "F1" => font } },
        true,
    );
    let bytes = pdf.bytes();
    assert!(bytes.len() < MIB, "the bomb is small on disk");
    let (path, sha) = s.write("bomb.pdf", &bytes);
    let limits = Limits {
        memory_bytes: Some(48 * MIB),
        ..Limits::default()
    };
    assert_eq!(run(&path, &sha, limits), Err(Failure::MemoryLimit));
}

/// A large string stored inside a compressed object stream, referenced by a
/// cross-reference stream, so `lopdf` decompresses it while *loading*.
#[test]
fn an_object_stream_bomb_decoded_at_load_stops_at_the_memory_cap() {
    let s = Scratch::new("objstm");
    let mut pdf = Pdf::new();
    pdf.text("ok");
    let filler = Object::string_literal(vec![b' '; 96 * MIB]);
    let filler = pdf.doc.add_object(dictionary! { "Filler" => filler });
    let count = pdf.kids.len() as i64;
    let kids = std::mem::take(&mut pdf.kids);
    pdf.doc.objects.insert(
        pdf.pages_id,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Count" => count, "Kids" => kids }),
    );
    let catalog = pdf.doc.add_object(
        dictionary! { "Type" => "Catalog", "Pages" => pdf.pages_id, "HfdFiller" => filler },
    );
    pdf.doc.trailer.set("Root", catalog);
    let mut options = lopdf::SaveOptions::builder()
        .use_object_streams(true)
        .use_xref_streams(true)
        .build();
    // The save options default to an uncompressed object stream.
    options.object_stream_config.compression_level = 6;
    let mut bytes = Vec::new();
    pdf.doc.save_with_options(&mut bytes, options).unwrap();
    assert!(
        bytes.len() < MIB,
        "the bomb is small on disk ({} bytes)",
        bytes.len()
    );
    let (path, sha) = s.write("objstm.pdf", &bytes);
    // Uncapped, the same file loads: the cap is what stops it.
    assert!(Document::load_mem(&bytes).is_ok());
    let limits = Limits {
        memory_bytes: Some(48 * MIB),
        ..Limits::default()
    };
    assert_eq!(run(&path, &sha, limits), Err(Failure::MemoryLimit));
}

#[test]
fn an_aborting_allocation_past_the_cap_is_a_memory_limit() {
    let s = Scratch::new("abort");
    let (path, sha) = sample(&s);
    let r = hook(
        &path,
        &sha,
        16 * MIB,
        serde_json::json!({ "allocate": 64 * MIB }),
        Duration::from_secs(20),
    );
    assert_eq!(r, Err(Failure::MemoryLimit));
}

#[test]
fn a_fallible_reservation_past_the_cap_never_reports_success() {
    let s = Scratch::new("fallible");
    let (path, sha) = sample(&s);
    let r = hook(
        &path,
        &sha,
        16 * MIB,
        serde_json::json!({ "tryReserve": 64 * MIB }),
        Duration::from_secs(20),
    );
    assert_eq!(r, Err(Failure::MemoryLimit));
}

#[test]
fn a_cap_below_what_is_already_allocated_is_a_memory_limit() {
    let s = Scratch::new("startcap");
    let (path, sha) = sample(&s);
    let limits = Limits {
        memory_bytes: Some(1024),
        ..Limits::default()
    };
    assert_eq!(run(&path, &sha, limits), Err(Failure::MemoryLimit));
}

#[test]
fn a_stack_overflow_is_a_plain_worker_failure() {
    let s = Scratch::new("stack");
    let (path, sha) = sample(&s);
    let r = hook(
        &path,
        &sha,
        256 * MIB,
        serde_json::json!("overflowStack"),
        Duration::from_secs(20),
    );
    assert!(matches!(r, Err(Failure::WorkerFailed(_))), "{r:?}");
}

#[test]
fn the_deadline_kills_and_cancellation_wins() {
    let s = Scratch::new("deadline");
    let (path, sha) = sample(&s);
    let started = std::time::Instant::now();
    let r = hook(
        &path,
        &sha,
        256 * MIB,
        serde_json::json!({ "sleep": 10_000 }),
        Duration::from_millis(300),
    );
    assert_eq!(r, Err(Failure::Timeout));
    assert!(started.elapsed() < Duration::from_secs(5));

    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        flag.store(true, Ordering::Release);
    });
    let r = run_with(
        &path,
        &sha,
        Limits {
            memory_bytes: Some(256 * MIB),
            ..Limits::default()
        },
        Duration::from_secs(20),
        Some(serde_json::json!({ "test": { "sleep": 10_000 } })),
        cancel,
    );
    assert_eq!(r, Err(Failure::Cancelled));
}

#[test]
fn the_flag_with_anything_else_exits_without_output() {
    for args in [
        vec![WORKER_FLAG, WORKER_FLAG],
        vec![WORKER_FLAG, "extra"],
        vec!["extra", WORKER_FLAG],
    ] {
        let out = Command::new(WORKER)
            .args(&args)
            .env_clear()
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(EXIT_BAD_ARGS), "{args:?}");
        assert!(out.stdout.is_empty());
    }
}

#[test]
fn empty_oversized_and_unknown_requests_are_refused() {
    let send = |bytes: &[u8]| {
        let mut child = Command::new(WORKER)
            .arg(WORKER_FLAG)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let _ = child.stdin.take().unwrap().write_all(bytes);
        child.wait_with_output().unwrap()
    };
    for request in [
        Vec::new(),
        vec![b' '; 5000],
        br#"{"path":"/x","sha256":"00","bypass":true}"#.to_vec(),
    ] {
        let out = send(&request);
        assert_eq!(out.status.code(), Some(EXIT_BAD_REQUEST));
        assert!(out.stdout.is_empty());
    }
}
