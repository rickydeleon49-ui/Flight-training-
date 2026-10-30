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

fn word_multiset(text: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    let mut current = String::new();
    for c in text.chars() {
        if c.is_alphanumeric() {
            for lc in c.to_lowercase() {
                current.push(lc);
            }
        } else {
            if current.chars().count() >= 2 {
                *counts.entry(current).or_insert(0) += 1;
            }
            current = String::new();
        }
    }
    if current.chars().count() >= 2 {
        *counts.entry(current).or_insert(0) += 1;
    }
    counts
}

fn content_match_ok(source_text: &str, part_text: &str) -> Result<(), usize> {
    let source_words = word_multiset(source_text);
    if source_words.is_empty() {
        return Ok(());
    }
    let part_words = word_multiset(part_text);
    let mut missing_count = 0;
    for (word, &s_count) in &source_words {
        let p_count = part_words.get(word).copied().unwrap_or(0);
        if s_count > p_count {
            missing_count += s_count - p_count;
        }
    }
    if missing_count <= 3 {
        Ok(())
    } else {
        Err(missing_count)
    }
}

fn verify_content_match(
    source_doc: &lopdf::Document,
    source_start_page: u32,
    part_doc: &lopdf::Document,
    part_label: &str,
) -> Result<(), String> {
    let part_page_count = part_doc.get_pages().len() as u32;
    for part_page in 1..=part_page_count {
        let source_page = source_start_page + part_page - 1;
        let source_text = source_doc.extract_text(&[source_page]).unwrap_or_default();
        let part_text = part_doc.extract_text(&[part_page]).unwrap_or_default();
        if let Err(missing_count) = content_match_ok(&source_text, &part_text) {
            return Err(format!(
                "{part_label} page {part_page} (source page {source_page}): missing {missing_count} words"
            ));
        }
    }
    Ok(())
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
            Readiness::Searchable { pages, .. } => {
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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeCaseRow {
    name: String,
    status: String,
    notes: String,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    split_edge_cases: Vec<EdgeCaseRow>,
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
fn judge_content_pass() {
    assert!(content_match_ok(
        "The quick brown fox jumps over the lazy dog.",
        "The quick brown fox jumps over the lazy dog."
    )
    .is_ok());
    assert!(content_match_ok(
        "FAA-H-8083-25B, Pilot's Handbook of Aeronautical Knowledge",
        "faa h 8083 25b pilot s handbook of aeronautical knowledge"
    )
    .is_ok());
    assert!(content_match_ok(
        "airspeed altitude heading vertical speed engine rpm fuel",
        "airspeed altitude heading vertical speed engine rpm fuel"
    )
    .is_ok());
    assert!(content_match_ok(
        "airspeed altitude heading vertical speed engine rpm fuel",
        "altitude heading vertical speed engine rpm fuel"
    )
    .is_ok());
    assert!(content_match_ok(
        "airspeed altitude heading vertical speed engine rpm fuel",
        "heading vertical speed engine rpm fuel"
    )
    .is_ok());
    assert!(content_match_ok(
        "airspeed altitude heading vertical speed engine rpm fuel",
        "vertical speed engine rpm fuel"
    )
    .is_ok());
    assert!(content_match_ok(
        "engine oil pressure temperature",
        "engine oil pressure temperature extra notes added by reader"
    )
    .is_ok());
    assert!(content_match_ok("", "any content here").is_ok());
    assert!(content_match_ok("   \t\n  ", "any content here").is_ok());
    assert!(content_match_ok("a b c", "x y z").is_ok());
    assert_eq!(
        content_match_ok(
            "airspeed altitude heading vertical speed engine rpm fuel",
            "speed engine rpm fuel"
        ),
        Err(4)
    );
}

#[test]
fn judge_content_fail() {
    let res = content_match_ok(
        "airspeed altitude heading vertical speed engine rpm fuel",
        "speed engine rpm fuel",
    );
    assert_eq!(res, Err(4));

    let res2 = content_match_ok("navigation compass rudder elevator aileron", "");
    assert_eq!(res2, Err(5));

    let res3 = content_match_ok(
        "warning warning warning warning warning danger",
        "warning danger",
    );
    assert_eq!(res3, Err(4));
}

fn run_nested_split_part_1(
    part1_path: &Path,
    part1_name: &str,
    part1_pages: u32,
    failures: &mut Vec<String>,
    structured_failures: &mut Vec<ReportFailureEntry>,
) -> EdgeCaseRow {
    let lib_2f = TempLibrary::new("edge-2f");
    let dest = lib_2f.doc_dir().join(part1_name);
    if let Err(e) = std::fs::copy(part1_path, &dest) {
        let reason = format!("cannot copy part 1 for nested split: {e}");
        record_failure(
            part1_name,
            "EDGE_2F",
            &reason,
            failures,
            structured_failures,
        );
        return EdgeCaseRow {
            name: "2f. Nested split Part 1".to_string(),
            status: "FAIL".to_string(),
            notes: reason,
        };
    }
    let part1_size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    if let Err(e) = lib_2f.init_db(part1_name, part1_size) {
        let reason = format!("cannot init db for nested split: {e}");
        record_failure(
            part1_name,
            "EDGE_2F",
            &reason,
            failures,
            structured_failures,
        );
        return EdgeCaseRow {
            name: "2f. Nested split Part 1".to_string(),
            status: "FAIL".to_string(),
            notes: reason,
        };
    }
    let doc_part1 = match lopdf::Document::load(&dest) {
        Ok(d) => d,
        Err(e) => {
            let reason = format!("cannot load part 1 with lopdf: {e}");
            record_failure(
                part1_name,
                "EDGE_2F",
                &reason,
                failures,
                structured_failures,
            );
            return EdgeCaseRow {
                name: "2f. Nested split Part 1".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            };
        }
    };
    let split_res = pdf::split_automatically_at(
        &lib_2f.path,
        "source-mat",
        part1_name,
        "batch-nested",
        part1_name,
        &|_| {},
    );
    match split_res {
        Ok(receipt) => {
            if let Err(e) =
                verify_page_coverage(part1_pages, &receipt.core.plan, &receipt.core.skipped_pages)
            {
                record_failure(part1_name, "EDGE_2F", &e, failures, structured_failures);
                return EdgeCaseRow {
                    name: "2f. Nested split Part 1".to_string(),
                    status: "FAIL".to_string(),
                    notes: e,
                };
            }
            for (i, part) in receipt.core.plan.iter().enumerate() {
                let p_path = lib_2f.doc_dir().join(&part.file_path);
                match lopdf::Document::load(&p_path) {
                    Ok(doc) => {
                        if let Err(e) = verify_content_match(
                            &doc_part1,
                            part.selection.start,
                            &doc,
                            &format!("nested part {} ({})", i + 1, part.file_path),
                        ) {
                            record_failure(
                                part1_name,
                                "EDGE_2F",
                                &e,
                                failures,
                                structured_failures,
                            );
                            return EdgeCaseRow {
                                name: "2f. Nested split Part 1".to_string(),
                                status: "FAIL".to_string(),
                                notes: e,
                            };
                        }
                    }
                    Err(e) => {
                        let reason = format!("cannot reopen nested part {}: {e}", part.file_path);
                        record_failure(
                            part1_name,
                            "EDGE_2F",
                            &reason,
                            failures,
                            structured_failures,
                        );
                        return EdgeCaseRow {
                            name: "2f. Nested split Part 1".to_string(),
                            status: "FAIL".to_string(),
                            notes: reason,
                        };
                    }
                }
            }
            EdgeCaseRow {
                name: "2f. Nested split Part 1".to_string(),
                status: "PASS".to_string(),
                notes: format!(
                    "{} parts; coverage and content PASS",
                    receipt.core.plan.len()
                ),
            }
        }
        Err(e) => {
            let reason = format!("nested automatic split failed: {e}");
            record_failure(
                part1_name,
                "EDGE_2F",
                &reason,
                failures,
                structured_failures,
            );
            EdgeCaseRow {
                name: "2f. Nested split Part 1".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
    }
}

struct SplitEdgeCaseTarget<'a> {
    source_entry: &'a Path,
    file_name: &'a str,
    total_source_pages: u32,
    file_size: u64,
    source_doc: &'a lopdf::Document,
}

fn run_split_edge_cases(
    target: &SplitEdgeCaseTarget<'_>,
    multi_part_candidate: Option<(&Path, &str, u32)>,
    failures: &mut Vec<String>,
    structured_failures: &mut Vec<ReportFailureEntry>,
) -> Vec<EdgeCaseRow> {
    let source_entry = target.source_entry;
    let file_name = target.file_name;
    let total_source_pages = target.total_source_pages;
    let file_size = target.file_size;
    let source_doc = target.source_doc;
    let mut rows = Vec::new();
    let temp_lib = TempLibrary::new("edge-cases");
    let copy_path = temp_lib.doc_dir().join(file_name);
    if let Err(e) = std::fs::copy(source_entry, &copy_path) {
        let reason = format!("cannot copy source to edge temp lib: {e}");
        record_failure(
            file_name,
            "EDGE_SETUP",
            &reason,
            failures,
            structured_failures,
        );
        return rows;
    }
    if let Err(e) = temp_lib.init_db(file_name, file_size) {
        let reason = format!("cannot init db in edge temp lib: {e}");
        record_failure(
            file_name,
            "EDGE_SETUP",
            &reason,
            failures,
            structured_failures,
        );
        return rows;
    }

    // 2a. take out page 1 only
    let row_2a = match pdf::split_range_at(
        &temp_lib.path,
        "source-mat",
        file_name,
        "edge-2a",
        1,
        1,
        "edge_2a_p1.pdf",
    ) {
        Ok(receipt) => {
            if receipt.core.plan.is_empty() {
                let reason = "split range for page 1 produced no parts".to_string();
                record_failure(file_name, "EDGE_2A", &reason, failures, structured_failures);
                EdgeCaseRow {
                    name: "2a. Take out page 1 only".to_string(),
                    status: "FAIL".to_string(),
                    notes: reason,
                }
            } else {
                let part = &receipt.core.plan[0];
                let p_path = temp_lib.doc_dir().join(&part.file_path);
                match lopdf::Document::load(&p_path) {
                    Ok(doc) => {
                        let pages = doc.get_pages().len();
                        if pages != 1 {
                            let reason = format!("reopened page count {pages} != 1");
                            record_failure(
                                file_name,
                                "EDGE_2A",
                                &reason,
                                failures,
                                structured_failures,
                            );
                            EdgeCaseRow {
                                name: "2a. Take out page 1 only".to_string(),
                                status: "FAIL".to_string(),
                                notes: reason,
                            }
                        } else if let Err(e) =
                            verify_content_match(source_doc, 1, &doc, "2a (page 1)")
                        {
                            record_failure(file_name, "EDGE_2A", &e, failures, structured_failures);
                            EdgeCaseRow {
                                name: "2a. Take out page 1 only".to_string(),
                                status: "FAIL".to_string(),
                                notes: e,
                            }
                        } else {
                            EdgeCaseRow {
                                name: "2a. Take out page 1 only".to_string(),
                                status: "PASS".to_string(),
                                notes: "reopened 1 page; content PASS".to_string(),
                            }
                        }
                    }
                    Err(e) => {
                        let reason = format!("cannot reopen part with lopdf: {e}");
                        record_failure(
                            file_name,
                            "EDGE_2A",
                            &reason,
                            failures,
                            structured_failures,
                        );
                        EdgeCaseRow {
                            name: "2a. Take out page 1 only".to_string(),
                            status: "FAIL".to_string(),
                            notes: reason,
                        }
                    }
                }
            }
        }
        Err(e) => {
            let reason = format!("split range failed: {e}");
            record_failure(file_name, "EDGE_2A", &reason, failures, structured_failures);
            EdgeCaseRow {
                name: "2a. Take out page 1 only".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
    };
    rows.push(row_2a);

    // 2b. take out the last page only
    let row_2b = match pdf::split_range_at(
        &temp_lib.path,
        "source-mat",
        file_name,
        "edge-2b",
        total_source_pages,
        total_source_pages,
        "edge_2b_last.pdf",
    ) {
        Ok(receipt) => {
            if receipt.core.plan.is_empty() {
                let reason = "split range for last page produced no parts".to_string();
                record_failure(file_name, "EDGE_2B", &reason, failures, structured_failures);
                EdgeCaseRow {
                    name: "2b. Take out last page only".to_string(),
                    status: "FAIL".to_string(),
                    notes: reason,
                }
            } else {
                let part = &receipt.core.plan[0];
                let p_path = temp_lib.doc_dir().join(&part.file_path);
                match lopdf::Document::load(&p_path) {
                    Ok(doc) => {
                        let pages = doc.get_pages().len();
                        if pages != 1 {
                            let reason = format!("reopened page count {pages} != 1");
                            record_failure(
                                file_name,
                                "EDGE_2B",
                                &reason,
                                failures,
                                structured_failures,
                            );
                            EdgeCaseRow {
                                name: "2b. Take out last page only".to_string(),
                                status: "FAIL".to_string(),
                                notes: reason,
                            }
                        } else if let Err(e) = verify_content_match(
                            source_doc,
                            total_source_pages,
                            &doc,
                            "2b (last page)",
                        ) {
                            record_failure(file_name, "EDGE_2B", &e, failures, structured_failures);
                            EdgeCaseRow {
                                name: "2b. Take out last page only".to_string(),
                                status: "FAIL".to_string(),
                                notes: e,
                            }
                        } else {
                            EdgeCaseRow {
                                name: "2b. Take out last page only".to_string(),
                                status: "PASS".to_string(),
                                notes: "reopened 1 page; content PASS".to_string(),
                            }
                        }
                    }
                    Err(e) => {
                        let reason = format!("cannot reopen part with lopdf: {e}");
                        record_failure(
                            file_name,
                            "EDGE_2B",
                            &reason,
                            failures,
                            structured_failures,
                        );
                        EdgeCaseRow {
                            name: "2b. Take out last page only".to_string(),
                            status: "FAIL".to_string(),
                            notes: reason,
                        }
                    }
                }
            }
        }
        Err(e) => {
            let reason = format!("split range failed: {e}");
            record_failure(file_name, "EDGE_2B", &reason, failures, structured_failures);
            EdgeCaseRow {
                name: "2b. Take out last page only".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
    };
    rows.push(row_2b);

    // 2c. take out the whole document (1..last)
    let row_2c = match pdf::split_range_at(
        &temp_lib.path,
        "source-mat",
        file_name,
        "edge-2c",
        1,
        total_source_pages,
        "edge_2c_whole.pdf",
    ) {
        Ok(receipt) => {
            if receipt.core.plan.is_empty() {
                let reason = "split range for whole document produced no parts".to_string();
                record_failure(file_name, "EDGE_2C", &reason, failures, structured_failures);
                EdgeCaseRow {
                    name: "2c. Take out whole document (1..last)".to_string(),
                    status: "FAIL".to_string(),
                    notes: reason,
                }
            } else {
                let part = &receipt.core.plan[0];
                let p_path = temp_lib.doc_dir().join(&part.file_path);
                match lopdf::Document::load(&p_path) {
                    Ok(doc) => {
                        let pages = doc.get_pages().len() as u32;
                        if pages != total_source_pages {
                            let reason =
                                format!("reopened page count {pages} != {total_source_pages}");
                            record_failure(
                                file_name,
                                "EDGE_2C",
                                &reason,
                                failures,
                                structured_failures,
                            );
                            EdgeCaseRow {
                                name: "2c. Take out whole document (1..last)".to_string(),
                                status: "FAIL".to_string(),
                                notes: reason,
                            }
                        } else if let Err(e) =
                            verify_content_match(source_doc, 1, &doc, "2c (whole doc)")
                        {
                            record_failure(file_name, "EDGE_2C", &e, failures, structured_failures);
                            EdgeCaseRow {
                                name: "2c. Take out whole document (1..last)".to_string(),
                                status: "FAIL".to_string(),
                                notes: e,
                            }
                        } else {
                            EdgeCaseRow {
                                name: "2c. Take out whole document (1..last)".to_string(),
                                status: "PASS".to_string(),
                                notes: format!("reopened {total_source_pages} pages; content PASS"),
                            }
                        }
                    }
                    Err(e) => {
                        let reason = format!("cannot reopen part with lopdf: {e}");
                        record_failure(
                            file_name,
                            "EDGE_2C",
                            &reason,
                            failures,
                            structured_failures,
                        );
                        EdgeCaseRow {
                            name: "2c. Take out whole document (1..last)".to_string(),
                            status: "FAIL".to_string(),
                            notes: reason,
                        }
                    }
                }
            }
        }
        // A whole document over the part limit must be refused with a plain
        // reason; that refusal is the correct outcome, not a failure.
        Err(e) if file_size > 52_428_800 && e.to_string().contains("too large") => EdgeCaseRow {
            name: "2c. Take out whole document (1..last)".to_string(),
            status: "PASS".to_string(),
            notes: format!("refused as expected (over the part limit): {e}"),
        },
        Err(e) => {
            let reason = format!("split range failed: {e}");
            record_failure(file_name, "EDGE_2C", &reason, failures, structured_failures);
            EdgeCaseRow {
                name: "2c. Take out whole document (1..last)".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
    };
    rows.push(row_2c);

    // 2d. take out pages 9-25
    let mut part_2d_path = None;
    let row_2d = match pdf::split_range_at(
        &temp_lib.path,
        "source-mat",
        file_name,
        "edge-2d",
        9,
        25,
        "edge_2d_9_25.pdf",
    ) {
        Ok(receipt) => {
            if receipt.core.plan.is_empty() {
                let reason = "split range for pages 9-25 produced no parts".to_string();
                record_failure(file_name, "EDGE_2D", &reason, failures, structured_failures);
                EdgeCaseRow {
                    name: "2d. Take out pages 9-25".to_string(),
                    status: "FAIL".to_string(),
                    notes: reason,
                }
            } else {
                let part = &receipt.core.plan[0];
                let p_path = temp_lib.doc_dir().join(&part.file_path);
                part_2d_path = Some(p_path.clone());
                match lopdf::Document::load(&p_path) {
                    Ok(doc) => {
                        let pages = doc.get_pages().len();
                        if pages != 17 {
                            let reason = format!("reopened page count {pages} != 17");
                            record_failure(
                                file_name,
                                "EDGE_2D",
                                &reason,
                                failures,
                                structured_failures,
                            );
                            EdgeCaseRow {
                                name: "2d. Take out pages 9-25".to_string(),
                                status: "FAIL".to_string(),
                                notes: reason,
                            }
                        } else if let Err(e) =
                            verify_content_match(source_doc, 9, &doc, "2d (pages 9-25)")
                        {
                            record_failure(file_name, "EDGE_2D", &e, failures, structured_failures);
                            EdgeCaseRow {
                                name: "2d. Take out pages 9-25".to_string(),
                                status: "FAIL".to_string(),
                                notes: e,
                            }
                        } else {
                            EdgeCaseRow {
                                name: "2d. Take out pages 9-25".to_string(),
                                status: "PASS".to_string(),
                                notes: "reopened 17 pages; content PASS".to_string(),
                            }
                        }
                    }
                    Err(e) => {
                        let reason = format!("cannot reopen part with lopdf: {e}");
                        record_failure(
                            file_name,
                            "EDGE_2D",
                            &reason,
                            failures,
                            structured_failures,
                        );
                        EdgeCaseRow {
                            name: "2d. Take out pages 9-25".to_string(),
                            status: "FAIL".to_string(),
                            notes: reason,
                        }
                    }
                }
            }
        }
        Err(e) => {
            let reason = format!("split range failed: {e}");
            record_failure(file_name, "EDGE_2D", &reason, failures, structured_failures);
            EdgeCaseRow {
                name: "2d. Take out pages 9-25".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
    };
    rows.push(row_2d);

    // 2e. split automatically a file that is already under the limits
    let lib_2e = TempLibrary::new("edge-2e");
    let (target_e_name, target_e_pages) = if total_source_pages <= 1000 && file_size <= 52_428_800 {
        let dest = lib_2e.doc_dir().join(file_name);
        let _ = std::fs::copy(source_entry, &dest);
        let _ = lib_2e.init_db(file_name, file_size);
        (file_name.to_string(), total_source_pages)
    } else if let Some(ref p2d) = part_2d_path {
        let dest = lib_2e.doc_dir().join("under_limits.pdf");
        let _ = std::fs::copy(p2d, &dest);
        let sz = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        let _ = lib_2e.init_db("under_limits.pdf", sz);
        ("under_limits.pdf".to_string(), 17)
    } else {
        ("none.pdf".to_string(), 0)
    };

    let row_2e = if target_e_pages > 0 {
        match pdf::split_automatically_at(
            &lib_2e.path,
            "source-mat",
            &target_e_name,
            "batch-2e",
            &target_e_name,
            &|_| {},
        ) {
            Ok(receipt) => {
                let part_count = receipt.core.plan.len();
                if part_count != 1 {
                    let reason = format!("expected 1 part for file under limits, got {part_count}");
                    record_failure(file_name, "EDGE_2E", &reason, failures, structured_failures);
                    EdgeCaseRow {
                        name: "2e. Split under limits automatically".to_string(),
                        status: "FAIL".to_string(),
                        notes: reason,
                    }
                } else if receipt.core.plan[0].child_page_count != target_e_pages {
                    let reason = format!(
                        "part page count {} != {target_e_pages}",
                        receipt.core.plan[0].child_page_count
                    );
                    record_failure(file_name, "EDGE_2E", &reason, failures, structured_failures);
                    EdgeCaseRow {
                        name: "2e. Split under limits automatically".to_string(),
                        status: "FAIL".to_string(),
                        notes: reason,
                    }
                } else if let Err(e) = verify_page_coverage(
                    target_e_pages,
                    &receipt.core.plan,
                    &receipt.core.skipped_pages,
                ) {
                    record_failure(file_name, "EDGE_2E", &e, failures, structured_failures);
                    EdgeCaseRow {
                        name: "2e. Split under limits automatically".to_string(),
                        status: "FAIL".to_string(),
                        notes: e,
                    }
                } else {
                    EdgeCaseRow {
                        name: "2e. Split under limits automatically".to_string(),
                        status: "PASS".to_string(),
                        notes: format!("1 part covering all {target_e_pages} pages"),
                    }
                }
            }
            Err(e) => {
                let reason = format!("automatic split failed: {e}");
                record_failure(file_name, "EDGE_2E", &reason, failures, structured_failures);
                EdgeCaseRow {
                    name: "2e. Split under limits automatically".to_string(),
                    status: "FAIL".to_string(),
                    notes: reason,
                }
            }
        }
    } else {
        let reason = "no under-limits file available".to_string();
        record_failure(file_name, "EDGE_2E", &reason, failures, structured_failures);
        EdgeCaseRow {
            name: "2e. Split under limits automatically".to_string(),
            status: "FAIL".to_string(),
            notes: reason,
        }
    };
    rows.push(row_2e);

    // 2f. nested: split automatically Part 1 of a split (when a split produced 2+ parts): coverage and CONTENT checks pass
    let row_2f = if let Some((cand_path, cand_name, cand_pages)) = multi_part_candidate {
        run_nested_split_part_1(
            cand_path,
            cand_name,
            cand_pages,
            failures,
            structured_failures,
        )
    } else {
        EdgeCaseRow {
            name: "2f. Nested split Part 1".to_string(),
            status: "PASS".to_string(),
            notes: "N/A (split did not produce 2+ parts)".to_string(),
        }
    };
    rows.push(row_2f);

    // 2g. split the same source twice: both runs succeed, leave no temp or empty files,
    // and the second run's parts are byte-identical in page count and coverage to the first.
    let lib_2g_1 = TempLibrary::new("edge-2g-1");
    let lib_2g_2 = TempLibrary::new("edge-2g-2");
    let (target_g_name, target_g_size, target_g_entry) =
        if total_source_pages <= 1000 && file_size <= 52_428_800 {
            (file_name.to_string(), file_size, source_entry.to_path_buf())
        } else if let Some(ref p2d) = part_2d_path {
            let sz = std::fs::metadata(p2d).map(|m| m.len()).unwrap_or(0);
            ("under_limits.pdf".to_string(), sz, p2d.clone())
        } else {
            (file_name.to_string(), file_size, source_entry.to_path_buf())
        };

    let _ = std::fs::copy(&target_g_entry, lib_2g_1.doc_dir().join(&target_g_name));
    let _ = lib_2g_1.init_db(&target_g_name, target_g_size);
    let _ = std::fs::copy(&target_g_entry, lib_2g_2.doc_dir().join(&target_g_name));
    let _ = lib_2g_2.init_db(&target_g_name, target_g_size);

    let res_g1 = pdf::split_automatically_at(
        &lib_2g_1.path,
        "source-mat",
        &target_g_name,
        "batch-2g",
        &target_g_name,
        &|_| {},
    );
    let res_g2 = pdf::split_automatically_at(
        &lib_2g_2.path,
        "source-mat",
        &target_g_name,
        "batch-2g",
        &target_g_name,
        &|_| {},
    );

    let row_2g = match (res_g1, res_g2) {
        (Ok(rec1), Ok(rec2)) => {
            let mut g_ok = true;
            let mut g_err = String::new();
            if let Err(e) = check_temp_docs_folder(&lib_2g_1.doc_dir()) {
                g_ok = false;
                g_err = format!("run 1 left temporary or empty files: {e}");
            } else if let Err(e) = check_temp_docs_folder(&lib_2g_2.doc_dir()) {
                g_ok = false;
                g_err = format!("run 2 left temporary or empty files: {e}");
            } else if rec1.core.plan.len() != rec2.core.plan.len() {
                g_ok = false;
                g_err = format!(
                    "part counts differ: run 1 has {}, run 2 has {}",
                    rec1.core.plan.len(),
                    rec2.core.plan.len()
                );
            } else if rec1.core.skipped_pages != rec2.core.skipped_pages {
                g_ok = false;
                g_err = "skipped pages differ between run 1 and run 2".to_string();
            } else {
                for (i, (p1, p2)) in rec1.core.plan.iter().zip(rec2.core.plan.iter()).enumerate() {
                    if p1.child_page_count != p2.child_page_count {
                        g_ok = false;
                        g_err = format!(
                            "part {} page count differs: {} vs {}",
                            i + 1,
                            p1.child_page_count,
                            p2.child_page_count
                        );
                        break;
                    }
                    if p1.selection.start != p2.selection.start
                        || p1.selection.end != p2.selection.end
                    {
                        g_ok = false;
                        g_err = format!(
                            "part {} selection differs: {}..{} vs {}..{}",
                            i + 1,
                            p1.selection.start,
                            p1.selection.end,
                            p2.selection.start,
                            p2.selection.end
                        );
                        break;
                    }
                    let b1 =
                        std::fs::read(lib_2g_1.doc_dir().join(&p1.file_path)).unwrap_or_default();
                    let b2 =
                        std::fs::read(lib_2g_2.doc_dir().join(&p2.file_path)).unwrap_or_default();
                    if b1 != b2 {
                        g_ok = false;
                        g_err = format!(
                            "part {} bytes differ between run 1 and run 2 (len {} vs {})",
                            i + 1,
                            b1.len(),
                            b2.len()
                        );
                        break;
                    }
                }
            }
            if g_ok {
                EdgeCaseRow {
                    name: "2g. Split same source twice".to_string(),
                    status: "PASS".to_string(),
                    notes: format!(
                        "both succeeded; {} parts byte-identical; no temp files",
                        rec1.core.plan.len()
                    ),
                }
            } else {
                record_failure(file_name, "EDGE_2G", &g_err, failures, structured_failures);
                EdgeCaseRow {
                    name: "2g. Split same source twice".to_string(),
                    status: "FAIL".to_string(),
                    notes: g_err,
                }
            }
        }
        (Err(e1), _) => {
            let reason = format!("run 1 failed: {e1}");
            record_failure(file_name, "EDGE_2G", &reason, failures, structured_failures);
            EdgeCaseRow {
                name: "2g. Split same source twice".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
        (_, Err(e2)) => {
            let reason = format!("run 2 failed: {e2}");
            record_failure(file_name, "EDGE_2G", &reason, failures, structured_failures);
            EdgeCaseRow {
                name: "2g. Split same source twice".to_string(),
                status: "FAIL".to_string(),
                notes: reason,
            }
        }
    };
    rows.push(row_2g);

    rows
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
    let mut edge_case_rows: Vec<EdgeCaseRow> = Vec::new();
    let mut edge_cases_tested = false;
    let mut multi_part_split_info: Option<(PathBuf, String, u32)> = None;

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

        let source_doc = lopdf::Document::load(&copy_path).ok();
        let total_source_pages = read_res.total_pages_opt.unwrap_or_else(|| {
            source_doc
                .as_ref()
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
                                    if let Some(ref s_doc) = source_doc {
                                        if let Err(e) = verify_content_match(
                                            s_doc,
                                            part.selection.start,
                                            &doc,
                                            &format!("part {} ({})", i + 1, part.file_path),
                                        ) {
                                            split_ok = false;
                                            split_reason = e;
                                            break;
                                        }
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
                        notes.push_str("; split content PASS");
                        if !receipt.core.plan.is_empty() {
                            passing_first_part = Some(receipt.core.plan[0].clone());
                            if receipt.core.plan.len() >= 2 && multi_part_split_info.is_none() {
                                multi_part_split_info = Some((
                                    temp_lib.doc_dir().join(&receipt.core.plan[0].file_path),
                                    receipt.core.plan[0].file_path.clone(),
                                    receipt.core.plan[0].child_page_count,
                                ));
                            }
                        }
                    } else {
                        split_status = "FAIL".to_string();
                        let check_tag = if split_reason.contains("missing") {
                            "SPLIT_CONTENT"
                        } else {
                            "SPLIT"
                        };
                        record_failure(
                            &file_name,
                            check_tag,
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
                                } else if let Some(ref s_doc) = source_doc {
                                    if let Err(e) = verify_content_match(
                                        s_doc,
                                        11,
                                        &doc,
                                        &format!("chapter ({})", part.file_path),
                                    ) {
                                        ch_ok = false;
                                        ch_err = e;
                                    }
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
                        notes.push_str("; chapter content PASS");
                    } else {
                        chapter_status = "FAIL".to_string();
                        let check_tag = if ch_err.contains("missing") {
                            "CHAPTER_CONTENT"
                        } else {
                            "CHAPTER"
                        };
                        record_failure(
                            &file_name,
                            check_tag,
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

        if !edge_cases_tested && total_source_pages >= 30 {
            edge_cases_tested = true;
            if let Some(ref s_doc) = source_doc {
                let candidate_part = multi_part_split_info
                    .as_ref()
                    .map(|(p, f, c)| (p.as_path(), f.as_str(), *c));
                let edge_results = run_split_edge_cases(
                    &SplitEdgeCaseTarget {
                        source_entry: entry,
                        file_name: &file_name,
                        total_source_pages,
                        file_size,
                        source_doc: s_doc,
                    },
                    candidate_part,
                    &mut failures,
                    &mut structured_failures,
                );
                edge_case_rows.extend(edge_results);
            }
        } else if edge_cases_tested && multi_part_split_info.is_some() {
            if let Some(row) = edge_case_rows.iter_mut().find(|r| r.name.starts_with("2f")) {
                if row.notes.contains("N/A") {
                    if let Some((ref cand_path, ref cand_name, cand_pages)) = multi_part_split_info
                    {
                        *row = run_nested_split_part_1(
                            cand_path,
                            cand_name,
                            cand_pages,
                            &mut failures,
                            &mut structured_failures,
                        );
                    }
                }
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

    if !edge_case_rows.is_empty() {
        report_md.push_str("## SPLIT EDGE CASES\n\n");
        report_md.push_str("| Edge Case | Status | Notes |\n");
        report_md.push_str("| --- | --- | --- |\n");
        for row in &edge_case_rows {
            report_md.push_str(&format!(
                "| {} | {} | {} |\n",
                row.name, row.status, row.notes
            ));
        }
        report_md.push('\n');
    }

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
        split_edge_cases: edge_case_rows.clone(),
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

    if !edge_case_rows.is_empty() {
        println!("SPLIT EDGE CASES");
        println!("| Edge Case | Status | Notes |");
        println!("| --- | --- | --- |");
        for row in &edge_case_rows {
            println!("| {} | {} | {} |", row.name, row.status, row.notes);
        }
        println!();
    }

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
