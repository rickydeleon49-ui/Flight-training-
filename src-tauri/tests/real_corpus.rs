use her_flight_deck_lib::extraction::cache::{Cache, Summary, EXTRACTOR_VERSION};
use her_flight_deck_lib::extraction::service::{Readiness, Service};
use her_flight_deck_lib::extraction::supervisor::{self, Failure, Job};
use her_flight_deck_lib::extraction::worker::{Limits, MAX_INPUT_BYTES};
use her_flight_deck_lib::lineage::SplitPlanPart;
use her_flight_deck_lib::pdf;
use her_flight_deck_lib::pdf_study_kit::{self, CachedPage, Evidence, KitInput};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

const WORKER: &str = env!("CARGO_BIN_EXE_her-flight-deck");

struct TempLibrary {
    path: PathBuf,
}

impl TempLibrary {
    fn new(tag: &str) -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let sanitized_tag: String = tag
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let path = std::env::temp_dir().join(format!(
            "hfd-real-corpus-{sanitized_tag}-{}-{}-{}",
            std::process::id(),
            id,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(path.join("documents")).expect("create documents directory");
        Self { path }
    }

    fn doc_dir(&self) -> PathBuf {
        self.path.join("documents")
    }

    fn init_db(&self, file_name: &str, file_size: u64) -> Result<(), String> {
        let db_path = self.path.join("her-flight-deck.db");
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("cannot open db at {}: {e}", db_path.display()))?;
        for migration in her_flight_deck_lib::migrations() {
            conn.execute_batch(migration.sql)
                .map_err(|e| format!("cannot apply migration {}: {e}", migration.description))?;
        }
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size,
               created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5,
               '2026-10-21T12:00:00.000Z', '2026-10-21T12:00:00.000Z')",
            rusqlite::params![
                "source-mat",
                file_name,
                file_name,
                file_name,
                file_size as i64,
            ],
        )
        .map_err(|e| format!("cannot insert study_materials row: {e}"))?;
        Ok(())
    }
}

impl Drop for TempLibrary {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn compute_sha256(path: &Path) -> Result<String, std::io::Error> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn check_temp_docs_folder(doc_dir: &Path) -> Result<(), String> {
    let entries =
        std::fs::read_dir(doc_dir).map_err(|e| format!("cannot read documents directory: {e}"))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            let meta = std::fs::metadata(&path)
                .map_err(|e| format!("cannot get metadata of {}: {e}", path.display()))?;
            if meta.len() == 0 {
                return Err(format!(
                    "file {:?} is empty (0 bytes)",
                    path.file_name().unwrap_or_default()
                ));
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.')
                || name.starts_with('~')
                || name.ends_with(".tmp")
                || name.contains("tmp")
            {
                return Err(format!(
                    "temporary file {:?} left in documents folder",
                    name
                ));
            }
        }
    }
    Ok(())
}

fn kit_kept_ok(text_pages: u32, kept: usize) -> bool {
    if text_pages >= 5 {
        kept * 5 >= (text_pages as usize) * 4
    } else {
        true
    }
}

fn coverage_ok(total_pages: u32, part_ranges: &[(u32, u32)], skipped: &[u32]) -> bool {
    if total_pages == 0 {
        return false;
    }
    let mut covered = vec![0u32; total_pages as usize + 1];
    for &(start, end) in part_ranges {
        if start == 0 || end > total_pages || start > end {
            return false;
        }
        for p in start..=end {
            covered[p as usize] += 1;
        }
    }
    for &p in skipped {
        if p == 0 || p > total_pages {
            return false;
        }
        covered[p as usize] += 1;
    }
    for p in 1..=total_pages {
        if covered[p as usize] != 1 {
            return false;
        }
    }
    true
}

fn bloat_ok(part_bytes: u64, part_pages: u32, total_pages: u32, source_bytes: u64) -> bool {
    if total_pages == 0 {
        return false;
    }
    let allowed =
        3.0 * (part_pages as f64 / total_pages as f64) * (source_bytes as f64) + 2_097_152.0;
    (part_bytes as f64) <= allowed
}

fn evidence_ok(page_text: &str, start: usize, end: usize, quote: &str) -> bool {
    if start > end || end > page_text.len() {
        return false;
    }
    if !page_text.is_char_boundary(start) || !page_text.is_char_boundary(end) {
        return false;
    }
    &page_text[start..end] == quote
}

fn verify_page_coverage(
    total_pages: u32,
    plan: &[SplitPlanPart],
    skipped_pages: &[u32],
) -> Result<(), String> {
    let ranges: Vec<(u32, u32)> = plan
        .iter()
        .map(|p| (p.selection.start, p.selection.end))
        .collect();
    if coverage_ok(total_pages, &ranges, skipped_pages) {
        Ok(())
    } else {
        Err(format!(
            "page coverage check failed: total {total_pages} pages not covered exactly once by {} parts and {} skipped pages",
            plan.len(),
            skipped_pages.len()
        ))
    }
}

fn record_failure(
    file: &str,
    check: &str,
    reason: &str,
    failures: &mut Vec<String>,
    structured: &mut Vec<ReportFailureEntry>,
) {
    failures.push(format!("FAIL {file} {check}: {reason}"));
    structured.push(ReportFailureEntry {
        file: file.to_string(),
        check: check.to_string(),
        reason: reason.to_string(),
    });
}

struct ReadKitResult {
    read_status: String,
    read_seconds: f64,
    total_pages_opt: Option<u32>,
    text_pages: u32,
    image_pages: u32,
    kit_status: String,
    pages_kept_opt: Option<usize>,
    sections_opt: Option<usize>,
    cards_opt: Option<usize>,
    questions_opt: Option<usize>,
    notes: String,
}

struct ReadKitTarget<'a> {
    relative_path: &'a str,
    full_path: &'a Path,
    sha: &'a str,
    file_size: u64,
    report_name: &'a str,
}

fn run_read_and_kit(
    lib_path: &Path,
    target: &ReadKitTarget<'_>,
    repeat_count: usize,
    failures: &mut Vec<String>,
    structured_failures: &mut Vec<ReportFailureEntry>,
) -> ReadKitResult {
    let is_oversized = target.file_size > MAX_INPUT_BYTES;
    let read_start = Instant::now();
    let mut read_pass = false;
    let mut total_pages_opt: Option<u32> = None;
    let mut text_pages: u32 = 0;
    let mut image_pages: u32 = 0;
    let mut notes: String;

    let read_seconds: f64;

    if is_oversized {
        let finished = supervisor::run_detailed(Job {
            worker: Path::new(WORKER),
            file: target.full_path,
            sha256: target.sha,
            limits: Limits::default(),
            deadline: Duration::from_secs(120),
            cancel: Arc::new(AtomicBool::new(false)),
            extra: None,
        });
        let read_elapsed = read_start.elapsed();
        read_seconds = read_elapsed.as_secs_f64();

        if read_elapsed > Duration::from_secs(120) {
            record_failure(
                target.report_name,
                "READ",
                &format!("exceeded deadline 120s ({:.1}s)", read_seconds),
                failures,
                structured_failures,
            );
        }

        match finished.result {
            Err(Failure::Reported(ref code)) if code == "input_too_large" => {
                read_pass = read_elapsed <= Duration::from_secs(120);
                notes = format!("read {:.1} s; refused (>128 MiB size limit)", read_seconds);
            }
            other => {
                record_failure(
                    target.report_name,
                    "READ",
                    &format!(
                        "file over 128 MiB was not refused with input_too_large: {:?}",
                        other
                    ),
                    failures,
                    structured_failures,
                );
                notes = format!(
                    "read {:.1} s; not refused as expected: {:?}",
                    read_seconds, other
                );
            }
        }
    } else {
        let svc = Service::new(lib_path.to_path_buf(), PathBuf::from(WORKER));
        let readiness = svc.prepare(target.relative_path, Arc::new(AtomicBool::new(false)));
        let read_elapsed = read_start.elapsed();
        read_seconds = read_elapsed.as_secs_f64();

        if read_elapsed > Duration::from_secs(120) {
            record_failure(
                target.report_name,
                "READ",
                &format!("exceeded deadline 120s ({:.1}s)", read_seconds),
                failures,
                structured_failures,
            );
        }

        match readiness {
            Readiness::Searchable { pages } => {
                total_pages_opt = Some(pages);
                if let Ok(cache) = Cache::open(lib_path) {
                    if let Some(Summary::Complete(counts)) = cache.summary(target.sha) {
                        text_pages = counts.text;
                        image_pages = counts.image_only;
                        read_pass = read_elapsed <= Duration::from_secs(120);
                        notes = format!(
                            "read {:.1} s; {} pages, {} text, {} image",
                            read_seconds, pages, text_pages, image_pages
                        );
                    } else {
                        record_failure(
                            target.report_name,
                            "READ",
                            "missing summary in cache after Searchable",
                            failures,
                            structured_failures,
                        );
                        notes = format!("read {:.1} s; missing cache summary", read_seconds);
                    }
                } else {
                    record_failure(
                        target.report_name,
                        "READ",
                        "cannot open cache after Searchable",
                        failures,
                        structured_failures,
                    );
                    notes = format!("read {:.1} s; cannot open cache", read_seconds);
                }
            }
            Readiness::Partial {
                pages,
                image_pages: img,
                ..
            } => {
                total_pages_opt = Some(pages);
                image_pages = img;
                if let Ok(cache) = Cache::open(lib_path) {
                    if let Some(Summary::Complete(counts)) = cache.summary(target.sha) {
                        text_pages = counts.text;
                        image_pages = counts.image_only;
                        read_pass = read_elapsed <= Duration::from_secs(120);
                        notes = format!(
                            "read {:.1} s; {} pages, {} text, {} image",
                            read_seconds, pages, text_pages, image_pages
                        );
                    } else {
                        record_failure(
                            target.report_name,
                            "READ",
                            "missing summary in cache after Partial",
                            failures,
                            structured_failures,
                        );
                        notes = format!("read {:.1} s; missing cache summary", read_seconds);
                    }
                } else {
                    record_failure(
                        target.report_name,
                        "READ",
                        "cannot open cache after Partial",
                        failures,
                        structured_failures,
                    );
                    notes = format!("read {:.1} s; cannot open cache", read_seconds);
                }
            }
            Readiness::CouldNotProcess { ref code } => {
                record_failure(
                    target.report_name,
                    "READ",
                    &format!("could not process: {}", code),
                    failures,
                    structured_failures,
                );
                notes = format!("read {:.1} s; could not process ({})", read_seconds, code);
            }
            other => {
                record_failure(
                    target.report_name,
                    "READ",
                    &format!("extraction failed: {:?}", other),
                    failures,
                    structured_failures,
                );
                notes = format!("read {:.1} s; failed ({:?})", read_seconds, other);
            }
        }
    }

    let read_status = if read_pass { "PASS" } else { "FAIL" };
    let mut kit_status = "-".to_string();
    let mut pages_kept_opt: Option<usize> = None;
    let mut sections_opt: Option<usize> = None;
    let mut cards_opt: Option<usize> = None;
    let mut questions_opt: Option<usize> = None;

    if read_pass && text_pages > 0 {
        let total_pages = total_pages_opt.unwrap_or(0);
        let cache = Cache::open(lib_path).expect("open cache for kit");
        let mut cached_pages = Vec::new();
        let mut page_text_map: HashMap<u32, String> = HashMap::new();

        for page_idx in 1..=total_pages {
            if let Some((outcome, text)) = cache.page(target.sha, page_idx) {
                page_text_map.insert(page_idx, text.clone());
                cached_pages.push(CachedPage {
                    content_sha256: target.sha.to_string(),
                    extractor_version: EXTRACTOR_VERSION,
                    page: page_idx,
                    outcome,
                    text,
                });
            }
        }

        let kit_input = KitInput {
            content_sha256: target.sha.to_string(),
            extractor_version: EXTRACTOR_VERSION,
            page_count: total_pages,
            pages: cached_pages,
        };

        let doc = lopdf::Document::load(target.full_path).ok();
        let mut first_candidates = None;
        let mut first_json = String::new();
        let mut kit_pass = true;

        for run_i in 0..repeat_count {
            match pdf_study_kit::extract(&kit_input, doc.as_ref()) {
                Ok(candidates) => {
                    let json_str = serde_json::to_string(&candidates).expect("serialize kit");
                    if run_i == 0 {
                        first_json = json_str;
                        first_candidates = Some(candidates);
                    } else if json_str != first_json {
                        record_failure(
                            target.report_name,
                            "KIT",
                            &format!(
                                "serialized result differs between run 1 and run {}",
                                run_i + 1
                            ),
                            failures,
                            structured_failures,
                        );
                        kit_pass = false;
                        break;
                    }
                }
                Err(err) => {
                    record_failure(
                        target.report_name,
                        "KIT",
                        &format!("extraction failed on run {}: {}", run_i + 1, err),
                        failures,
                        structured_failures,
                    );
                    kit_pass = false;
                    break;
                }
            }
        }

        if let Some(candidates) = first_candidates {
            let pages_kept = candidates.pages_used.len();
            let sections = candidates.outline.len();
            let cards = candidates.glossary.len() + candidates.cloze.len();
            let questions = candidates.questions.len();

            pages_kept_opt = Some(pages_kept);
            sections_opt = Some(sections);
            cards_opt = Some(cards);
            questions_opt = Some(questions);

            if !kit_kept_ok(text_pages, pages_kept) {
                record_failure(
                    target.report_name,
                    "KIT",
                    &format!(
                        "pages kept {} < 80% of text pages {}",
                        pages_kept, text_pages
                    ),
                    failures,
                    structured_failures,
                );
                kit_pass = false;
            }
            if text_pages >= 5 && sections + cards + questions == 0 {
                record_failure(
                    target.report_name,
                    "KIT",
                    &format!(
                        "text pages >= 5 ({}) but sections + cards + questions == 0",
                        text_pages
                    ),
                    failures,
                    structured_failures,
                );
                kit_pass = false;
            }

            let mut all_evidence: Vec<&Evidence> = Vec::new();
            for card in &candidates.glossary {
                all_evidence.extend(&card.evidence);
            }
            for card in &candidates.cloze {
                all_evidence.extend(&card.evidence);
            }
            for section in &candidates.outline {
                all_evidence.extend(&section.evidence);
                for sentence in &section.sentences {
                    all_evidence.push(&sentence.evidence);
                }
            }
            for question in &candidates.questions {
                all_evidence.extend(&question.evidence);
                for choice_evidence in &question.choice_evidence {
                    all_evidence.extend(choice_evidence);
                }
            }

            for ev in all_evidence {
                let Some(page_text) = page_text_map.get(&ev.page) else {
                    record_failure(
                        target.report_name,
                        "KIT",
                        &format!("evidence quote references missing page {}", ev.page),
                        failures,
                        structured_failures,
                    );
                    kit_pass = false;
                    break;
                };
                if !evidence_ok(page_text, ev.start_offset, ev.end_offset, &ev.quote) {
                    record_failure(
                        target.report_name,
                        "KIT",
                        &format!(
                            "evidence quote mismatch on page {} [{}..{}]: expected {:?}, actual in bounds: {}",
                            ev.page,
                            ev.start_offset,
                            ev.end_offset,
                            ev.quote,
                            ev.end_offset <= page_text.len()
                        ),
                        failures,
                        structured_failures,
                    );
                    kit_pass = false;
                    break;
                }
            }

            kit_status = if kit_pass {
                "PASS".into()
            } else {
                "FAIL".into()
            };
            notes = format!(
                "read {:.1} s; kept {}/{} text pages, {} sections, {} cards, {} questions",
                read_seconds, pages_kept, text_pages, sections, cards, questions
            );
        } else {
            kit_status = "FAIL".into();
            notes = format!("read {:.1} s; kit extraction failed", read_seconds);
        }
    }

    ReadKitResult {
        read_status: read_status.to_string(),
        read_seconds,
        total_pages_opt,
        text_pages,
        image_pages,
        kit_status,
        pages_kept_opt,
        sections_opt,
        cards_opt,
        questions_opt,
        notes,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportFileEntry {
    file: String,
    size_bytes: u64,
    size_mb: f64,
    pages: Option<u32>,
    text_pages: u32,
    image_pages: u32,
    read_status: String,
    read_seconds: f64,
    kit_status: String,
    pages_kept: Option<usize>,
    sections: Option<usize>,
    cards: Option<usize>,
    questions: Option<usize>,
    split_status: String,
    chapter_status: String,
    notes: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportFailureEntry {
    file: String,
    check: String,
    reason: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportJson {
    corpus: String,
    overall: String,
    total_files: usize,
    failure_count: usize,
    failures: Vec<ReportFailureEntry>,
    files: Vec<ReportFileEntry>,
}

#[test]
fn judge_kit_kept() {
    assert!(kit_kept_ok(10, 8));
    assert!(kit_kept_ok(10, 9));
    assert!(kit_kept_ok(5, 4));
    assert!(kit_kept_ok(4, 0));

    assert!(!kit_kept_ok(10, 7));
    assert!(!kit_kept_ok(5, 3));
    assert!(!kit_kept_ok(100, 79));
}

#[test]
fn judge_coverage() {
    assert!(coverage_ok(10, &[(1, 5), (6, 10)], &[]));
    assert!(coverage_ok(10, &[(1, 4), (6, 9)], &[5, 10]));
    assert!(coverage_ok(1, &[(1, 1)], &[]));

    assert!(!coverage_ok(10, &[(1, 5), (6, 9)], &[]));
    assert!(!coverage_ok(10, &[(1, 6), (6, 10)], &[]));
    assert!(!coverage_ok(10, &[(0, 5), (6, 10)], &[]));
    assert!(!coverage_ok(10, &[(1, 11)], &[]));
    assert!(!coverage_ok(10, &[(5, 2)], &[]));
    assert!(!coverage_ok(10, &[(1, 10)], &[5]));
    assert!(!coverage_ok(10, &[(1, 10)], &[11]));
    assert!(!coverage_ok(0, &[], &[]));
}

#[test]
fn judge_bloat() {
    assert!(bloat_ok(2_000_000, 10, 100, 10_485_760));
    assert!(bloat_ok(5_242_880, 10, 100, 10_485_760));

    assert!(!bloat_ok(5_242_881, 10, 100, 10_485_760));
    assert!(!bloat_ok(10_000_000, 10, 100, 10_485_760));
    assert!(!bloat_ok(100, 10, 0, 10_485_760));
}

#[test]
fn judge_evidence() {
    let text = "The quick brown fox jumps over the lazy dog.";
    assert!(evidence_ok(text, 0, 3, "The"));
    assert!(evidence_ok(text, 4, 9, "quick"));
    assert!(evidence_ok(text, 0, text.len(), text));
    assert!(evidence_ok(text, 5, 5, ""));

    assert!(!evidence_ok(text, 0, 3, "Fox"));
    assert!(!evidence_ok(text, 0, 100, "The"));
    assert!(!evidence_ok(text, 5, 2, "quick"));
    let utf8_text = "Héllo wörld";
    assert!(!evidence_ok(utf8_text, 1, 2, "é"));
}

#[test]
#[ignore = "SKIPPED: set HFD_REAL_CORPUS"]
fn real_corpus() {
    let corpus_env = match std::env::var("HFD_REAL_CORPUS") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            println!("SKIPPED: set HFD_REAL_CORPUS");
            return;
        }
    };

    let corpus_path = PathBuf::from(&corpus_env);
    if !corpus_path.is_dir() {
        println!(
            "FAIL: HFD_REAL_CORPUS directory {:?} not found",
            corpus_path
        );
        panic!("HFD_REAL_CORPUS directory not found: {:?}", corpus_path);
    }

    let out_dir = match std::env::var("HFD_REAL_CORPUS_OUT") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => std::env::temp_dir().join(format!("hfd-corpus-out-{}", std::process::id())),
    };
    std::fs::create_dir_all(&out_dir).expect("create HFD_REAL_CORPUS_OUT directory");

    let repeat_count = std::env::var("HFD_REAL_CORPUS_REPEAT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(3);

    let mut entries: Vec<PathBuf> = std::fs::read_dir(&corpus_path)
        .expect("read corpus directory")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .map(|ext| ext.eq_ignore_ascii_case("pdf"))
                    .unwrap_or(false)
        })
        .collect();

    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut failures: Vec<String> = Vec::new();
    let mut structured_failures: Vec<ReportFailureEntry> = Vec::new();
    let mut report_files: Vec<ReportFileEntry> = Vec::new();
    let mut table_rows: Vec<String> = Vec::new();

    for entry in &entries {
        let file_name = entry
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown.pdf".to_string());

        let sha_before = match compute_sha256(entry) {
            Ok(s) => s,
            Err(e) => {
                record_failure(
                    &file_name,
                    "SHA",
                    &format!("cannot read source file: {e}"),
                    &mut failures,
                    &mut structured_failures,
                );
                continue;
            }
        };

        let temp_lib = TempLibrary::new(&file_name);
        let copy_path = temp_lib.doc_dir().join(&file_name);

        if let Err(e) = std::fs::copy(entry, &copy_path) {
            record_failure(
                &file_name,
                "READ",
                &format!("cannot copy to temp library: {e}"),
                &mut failures,
                &mut structured_failures,
            );
            continue;
        }

        let file_size = match std::fs::metadata(&copy_path) {
            Ok(m) => m.len(),
            Err(e) => {
                record_failure(
                    &file_name,
                    "READ",
                    &format!("cannot read metadata of copy: {e}"),
                    &mut failures,
                    &mut structured_failures,
                );
                continue;
            }
        };

        if let Err(e) = temp_lib.init_db(&file_name, file_size) {
            record_failure(
                &file_name,
                "SETUP",
                &format!("cannot init temp library db: {e}"),
                &mut failures,
                &mut structured_failures,
            );
            continue;
        }

        let size_mb = (file_size as f64) / (1024.0 * 1024.0);

        let read_res = run_read_and_kit(
            &temp_lib.path,
            &ReadKitTarget {
                relative_path: &file_name,
                full_path: &copy_path,
                sha: &sha_before,
                file_size,
                report_name: &file_name,
            },
            repeat_count,
            &mut failures,
            &mut structured_failures,
        );

        let mut notes = read_res.notes.clone();

        let total_source_pages = read_res.total_pages_opt.unwrap_or_else(|| {
            lopdf::Document::load(&copy_path)
                .map(|d| d.get_pages().len() as u32)
                .unwrap_or(0)
        });
        let total_pages_opt = read_res.total_pages_opt.or(if total_source_pages > 0 {
            Some(total_source_pages)
        } else {
            None
        });

        // SPLIT check: for every PDF of at least 20 MiB
        let mut split_status = "-".to_string();
        let mut passing_first_part: Option<SplitPlanPart> = None;
        if file_size >= 20 * 1024 * 1024 {
            let split_res = pdf::split_automatically_at(
                &temp_lib.path,
                "source-mat",
                &file_name,
                "batch-auto",
                &file_name,
                &|_| {},
            );
            match split_res {
                Ok(receipt) => {
                    let mut split_ok = true;
                    let mut split_reason = String::new();

                    // Coverage check: parts' ranges + skipped pages cover every source page exactly once
                    if let Err(e) = verify_page_coverage(
                        total_source_pages,
                        &receipt.core.plan,
                        &receipt.core.skipped_pages,
                    ) {
                        split_ok = false;
                        split_reason = e;
                    }

                    // Part-by-part checks
                    if split_ok {
                        for (i, part) in receipt.core.plan.iter().enumerate() {
                            let part_path = temp_lib.doc_dir().join(&part.file_path);
                            let meta = match std::fs::metadata(&part_path) {
                                Ok(m) => m,
                                Err(e) => {
                                    split_ok = false;
                                    split_reason = format!(
                                        "cannot stat part {} ({}): {e}",
                                        i + 1,
                                        part.file_path
                                    );
                                    break;
                                }
                            };
                            if meta.len() > 52_428_800 || part.file_size > 52_428_800 {
                                split_ok = false;
                                split_reason = format!(
                                    "part {} ({}) size {} exceeds 52,428,800 bytes",
                                    i + 1,
                                    part.file_path,
                                    meta.len()
                                );
                                break;
                            }
                            if part.child_page_count > 1000 {
                                split_ok = false;
                                split_reason = format!(
                                    "part {} ({}) has {} pages, exceeding 1,000 limit",
                                    i + 1,
                                    part.file_path,
                                    part.child_page_count
                                );
                                break;
                            }
                            // Bloat check
                            if !bloat_ok(
                                part.file_size,
                                part.child_page_count,
                                total_source_pages,
                                file_size,
                            ) {
                                let allowed_bytes = 3.0
                                    * (part.child_page_count as f64 / total_source_pages as f64)
                                    * (file_size as f64)
                                    + 2_097_152.0;
                                split_ok = false;
                                split_reason = format!(
                                    "part {} ({}) bloat check failed: size {} > allowed {:.0} bytes",
                                    i + 1,
                                    part.file_path,
                                    part.file_size,
                                    allowed_bytes
                                );
                                break;
                            }
                            // Reopen with lopdf and verify page count
                            match lopdf::Document::load(&part_path) {
                                Ok(doc) => {
                                    let doc_pages = doc.get_pages().len() as u32;
                                    if doc_pages != part.child_page_count {
                                        split_ok = false;
                                        split_reason = format!(
                                            "part {} ({}) lopdf page count {} does not match expected {}",
                                            i + 1,
                                            part.file_path,
                                            doc_pages,
                                            part.child_page_count
                                        );
                                        break;
                                    }
                                }
                                Err(e) => {
                                    split_ok = false;
                                    split_reason = format!(
                                        "part {} ({}) cannot be reopened with lopdf: {e}",
                                        i + 1,
                                        part.file_path
                                    );
                                    break;
                                }
                            }
                        }
                    }

                    // No empty files in documents folder and no temporary files left
                    if split_ok {
                        if let Err(e) = check_temp_docs_folder(&temp_lib.doc_dir()) {
                            split_ok = false;
                            split_reason = e;
                        }
                    }

                    // Source SHA-256 unchanged
                    if split_ok {
                        match compute_sha256(entry) {
                            Ok(sha) if sha == sha_before => {}
                            Ok(_) => {
                                split_ok = false;
                                split_reason =
                                    "source SHA-256 changed after automatic split".to_string();
                            }
                            Err(e) => {
                                split_ok = false;
                                split_reason = format!("cannot check source SHA-256: {e}");
                            }
                        }
                        match compute_sha256(&copy_path) {
                            Ok(sha) if sha == sha_before => {}
                            Ok(_) => {
                                split_ok = false;
                                split_reason =
                                    "copy SHA-256 changed after automatic split".to_string();
                            }
                            Err(e) => {
                                split_ok = false;
                                split_reason = format!("cannot check copy SHA-256: {e}");
                            }
                        }
                    }

                    let part_sizes: Vec<String> = receipt
                        .core
                        .plan
                        .iter()
                        .map(|p| format!("{:.1} MB", (p.file_size as f64) / (1024.0 * 1024.0)))
                        .collect();
                    let part_count = receipt.core.plan.len();
                    let split_note = if receipt.core.skipped_pages.is_empty() {
                        format!("split {} parts ({})", part_count, part_sizes.join(", "))
                    } else {
                        let skipped_str = receipt
                            .core
                            .skipped_pages
                            .iter()
                            .map(|p| p.to_string())
                            .collect::<Vec<_>>()
                            .join(", ");
                        format!(
                            "split {} parts ({}); skipped pages {}",
                            part_count,
                            part_sizes.join(", "),
                            skipped_str
                        )
                    };
                    notes.push_str(&format!("; {split_note}"));

                    if split_ok {
                        split_status = "PASS".to_string();
                        if !receipt.core.plan.is_empty() {
                            passing_first_part = Some(receipt.core.plan[0].clone());
                        }
                    } else {
                        split_status = "FAIL".to_string();
                        record_failure(
                            &file_name,
                            "SPLIT",
                            &split_reason,
                            &mut failures,
                            &mut structured_failures,
                        );
                    }
                }
                Err(e) => {
                    split_status = "FAIL".to_string();
                    record_failure(
                        &file_name,
                        "SPLIT",
                        &format!("automatic split failed: {e}"),
                        &mut failures,
                        &mut structured_failures,
                    );
                    notes.push_str(&format!("; split failed: {e}"));
                }
            }
        }

        // CHAPTER check: for every PDF with at least 30 pages, extract pages 11-20
        let mut chapter_status = "-".to_string();
        if total_source_pages >= 30 {
            let chapter_res = pdf::split_range_at(
                &temp_lib.path,
                "source-mat",
                &file_name,
                "chapter-manual",
                11,
                20,
                "Chapter.pdf",
            );
            match chapter_res {
                Ok(receipt) => {
                    let mut ch_ok = true;
                    let mut ch_err = String::new();
                    if receipt.core.plan.is_empty() {
                        ch_ok = false;
                        ch_err = "manual split range produced no parts".to_string();
                    } else {
                        let part = &receipt.core.plan[0];
                        let chapter_path = temp_lib.doc_dir().join(&part.file_path);
                        match lopdf::Document::load(&chapter_path) {
                            Ok(doc) => {
                                let pages = doc.get_pages().len();
                                if pages != 10 {
                                    ch_ok = false;
                                    ch_err = format!("chapter has {} pages, expected 10", pages);
                                }
                            }
                            Err(e) => {
                                ch_ok = false;
                                ch_err = format!("cannot reopen chapter PDF with lopdf: {e}");
                            }
                        }
                        if ch_ok {
                            let actual_bytes = match std::fs::metadata(&chapter_path) {
                                Ok(m) => m.len(),
                                Err(_) => part.file_size,
                            };
                            if !bloat_ok(actual_bytes, 10, total_source_pages, file_size) {
                                let max_allowed =
                                    3.0 * (10.0 / total_source_pages as f64) * (file_size as f64)
                                        + 2_097_152.0;
                                ch_ok = false;
                                ch_err = format!(
                                    "chapter bloat check failed: size {} > allowed {:.0} bytes",
                                    actual_bytes, max_allowed
                                );
                            }
                        }
                    }
                    if ch_ok {
                        chapter_status = "PASS".to_string();
                    } else {
                        chapter_status = "FAIL".to_string();
                        record_failure(
                            &file_name,
                            "CHAPTER",
                            &ch_err,
                            &mut failures,
                            &mut structured_failures,
                        );
                    }
                }
                Err(e) => {
                    chapter_status = "FAIL".to_string();
                    record_failure(
                        &file_name,
                        "CHAPTER",
                        &format!("manual split range failed: {e}"),
                        &mut failures,
                        &mut structured_failures,
                    );
                }
            }
        }

        // Check source SHA-256 after the test to verify source wasn't modified
        match compute_sha256(entry) {
            Ok(sha_after) => {
                if sha_before != sha_after {
                    record_failure(
                        &file_name,
                        "SHA",
                        &format!(
                            "source SHA-256 changed after test (before: {sha_before}, after: {sha_after})"
                        ),
                        &mut failures,
                        &mut structured_failures,
                    );
                }
            }
            Err(e) => {
                record_failure(
                    &file_name,
                    "SHA",
                    &format!("cannot re-read source file: {e}"),
                    &mut failures,
                    &mut structured_failures,
                );
            }
        }

        let pages_display = total_pages_opt
            .map(|p| p.to_string())
            .unwrap_or_else(|| "-".to_string());

        table_rows.push(format!(
            "| {} | {:.2} | {} | {} | {} | {} | {} | {} |",
            file_name,
            size_mb,
            pages_display,
            read_res.read_status,
            read_res.kit_status,
            split_status,
            chapter_status,
            notes
        ));

        report_files.push(ReportFileEntry {
            file: file_name.clone(),
            size_bytes: file_size,
            size_mb,
            pages: total_pages_opt,
            text_pages: read_res.text_pages,
            image_pages: read_res.image_pages,
            read_status: read_res.read_status.clone(),
            read_seconds: read_res.read_seconds,
            kit_status: read_res.kit_status.clone(),
            pages_kept: read_res.pages_kept_opt,
            sections: read_res.sections_opt,
            cards: read_res.cards_opt,
            questions: read_res.questions_opt,
            split_status,
            chapter_status,
            notes,
        });

        // Big-book flow: after a PASSING SPLIT of a file, also run READ and KIT on the FIRST part
        if let Some(first_part) = passing_first_part {
            let part_row_name = format!("{file_name} — Part 1");
            let part_path = temp_lib.doc_dir().join(&first_part.file_path);
            let part_size = match std::fs::metadata(&part_path) {
                Ok(m) => m.len(),
                Err(e) => {
                    record_failure(
                        &part_row_name,
                        "READ",
                        &format!("cannot stat part file: {e}"),
                        &mut failures,
                        &mut structured_failures,
                    );
                    first_part.file_size
                }
            };
            let part_size_mb = (part_size as f64) / (1024.0 * 1024.0);
            let part_sha = match compute_sha256(&part_path) {
                Ok(s) => s,
                Err(e) => {
                    record_failure(
                        &part_row_name,
                        "SHA",
                        &format!("cannot compute SHA of part: {e}"),
                        &mut failures,
                        &mut structured_failures,
                    );
                    String::new()
                }
            };

            let part_res = run_read_and_kit(
                &temp_lib.path,
                &ReadKitTarget {
                    relative_path: &first_part.file_path,
                    full_path: &part_path,
                    sha: &part_sha,
                    file_size: part_size,
                    report_name: &part_row_name,
                },
                repeat_count,
                &mut failures,
                &mut structured_failures,
            );

            let part_pages = part_res
                .total_pages_opt
                .unwrap_or(first_part.child_page_count);
            let part_pages_display = part_pages.to_string();

            table_rows.push(format!(
                "| {} | {:.2} | {} | {} | {} | {} | {} | {} |",
                part_row_name,
                part_size_mb,
                part_pages_display,
                part_res.read_status,
                part_res.kit_status,
                "-",
                "-",
                part_res.notes
            ));

            report_files.push(ReportFileEntry {
                file: part_row_name,
                size_bytes: part_size,
                size_mb: part_size_mb,
                pages: Some(part_pages),
                text_pages: part_res.text_pages,
                image_pages: part_res.image_pages,
                read_status: part_res.read_status,
                read_seconds: part_res.read_seconds,
                kit_status: part_res.kit_status,
                pages_kept: part_res.pages_kept_opt,
                sections: part_res.sections_opt,
                cards: part_res.cards_opt,
                questions: part_res.questions_opt,
                split_status: "-".to_string(),
                chapter_status: "-".to_string(),
                notes: part_res.notes,
            });
        }
    }

    let overall_line = if failures.is_empty() {
        "OVERALL PASS".to_string()
    } else {
        format!("OVERALL FAIL ({} failures)", failures.len())
    };

    let mut report_md = String::new();
    report_md.push_str("# Real Corpus Test Report\n\n");
    report_md.push_str(&format!("- Corpus: {}\n", corpus_path.display()));
    report_md.push_str(&format!("- Total files: {}\n", report_files.len()));
    report_md.push_str(&format!("- Result: {}\n\n", overall_line));
    report_md.push_str("| file | MB | pages | READ | KIT | SPLIT | CHAPTER | notes |\n");
    report_md.push_str("| --- | --- | --- | --- | --- | --- | --- | --- |\n");
    for row in &table_rows {
        report_md.push_str(row);
        report_md.push('\n');
    }
    report_md.push('\n');

    if !failures.is_empty() {
        report_md.push_str("## Failures\n\n");
        for failure in &failures {
            report_md.push_str(failure);
            report_md.push('\n');
        }
        report_md.push('\n');
    }
    report_md.push_str(&overall_line);
    report_md.push('\n');

    let report_json = ReportJson {
        corpus: corpus_path.to_string_lossy().to_string(),
        overall: if failures.is_empty() {
            "PASS".to_string()
        } else {
            "FAIL".to_string()
        },
        total_files: report_files.len(),
        failure_count: failures.len(),
        failures: structured_failures,
        files: report_files,
    };

    std::fs::write(out_dir.join("report.md"), &report_md).expect("write report.md");

    std::fs::write(
        out_dir.join("report.json"),
        serde_json::to_string_pretty(&report_json).expect("serialize report.json"),
    )
    .expect("write report.json");

    println!("Report written to {}", out_dir.display());
    println!();
    println!("| file | MB | pages | READ | KIT | SPLIT | CHAPTER | notes |");
    println!("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for row in &table_rows {
        println!("{row}");
    }
    println!();

    for failure in &failures {
        println!("{failure}");
    }
    if !failures.is_empty() {
        println!();
    }

    println!("{overall_line}");

    if !failures.is_empty() {
        panic!("{overall_line}");
    }
}
