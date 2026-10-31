//! LIVE-BENCH: a headless live bench that runs the app's own study-kit and
//! card Why? code against real PDFs with no window. Test-only (cfg(test)) and
//! `#[ignore]`d: it never ships and plain `cargo test` never sends anything.
//!
//! HFD_LIVE_BENCH=1 HFD_LIVE_PROFILE=<QA profile dir> HFD_LIVE_PDFS=<dir>
//! HFD_LIVE_OUT=<file.md> HFD_LIVE_MAX_SENDS=<n> cargo test --locked
//! --manifest-path src-tauri/Cargo.toml live_bench -- --ignored --nocapture
//! --test-threads=1
//!
//! The key is read from the profile's key file the way the app reads it and is
//! never printed, logged or written; the report is checked not to contain it.
use super::*;
use crate::extraction::inspect::{outcome, Outcome};
use crate::extraction::worker::{read_page, MAX_PAGE_TEXT_BYTES};
use crate::gemini_ask::{ask_card_why_with, why_page_text, ASK_GEMINI_BUDGET};
use std::fmt::Write as _;
use std::path::PathBuf;
use std::time::Instant;

struct BenchEnv {
    profile: PathBuf,
    pdfs: PathBuf,
    out: PathBuf,
    max_sends: u32,
}

fn is_real_student(path: &str) -> bool {
    path.contains("com.herflightdeck.app") && !path.contains(".synthetic.")
}

/// Ok(None): not asked for, so skip. Err: asked for but refused.
fn bench_env() -> Result<Option<BenchEnv>, String> {
    if std::env::var("HFD_LIVE_BENCH").as_deref() != Ok("1") {
        return Ok(None);
    }
    let var = |name: &str| std::env::var(name).map_err(|_| format!("{name} is not set"));
    let profile = var("HFD_LIVE_PROFILE")?;
    let real = std::fs::canonicalize(&profile)
        .map_err(|_| "HFD_LIVE_PROFILE is not a folder".to_string())?;
    if is_real_student(&profile) || is_real_student(&real.to_string_lossy()) {
        return Err("refused: HFD_LIVE_PROFILE is the real student's data folder".into());
    }
    let max_sends = var("HFD_LIVE_MAX_SENDS")?
        .parse()
        .map_err(|_| "HFD_LIVE_MAX_SENDS is not a number".to_string())?;
    Ok(Some(BenchEnv {
        profile: real,
        pdfs: var("HFD_LIVE_PDFS")?.into(),
        out: var("HFD_LIVE_OUT")?.into(),
        max_sends,
    }))
}

#[derive(Default)]
struct KitRow {
    seconds: f64,
    finish: String,
    tokens: String,
    guide: Option<(usize, usize, usize)>,
    guide_pages_bad: usize,
    cards: usize,
    cards_dropped: usize,
    dropped_by_quote: usize,
    unverified: usize,
    dropped_by_choices: usize,
    cards_pages_bad: usize,
    questions: usize,
    questions_dropped: usize,
    questions_pages_bad: usize,
    positions: Vec<usize>,
    letter_explanations: usize,
    acs_tags: Vec<String>,
    raw_acs: Vec<String>,
    part_errors: Vec<String>,
    error: Option<String>,
    sample_cards: Vec<(String, String, u32)>,
}

struct WhyRow {
    cited: u32,
    seconds: f64,
    sentences: usize,
    refused: bool,
    label: String,
    answer: String,
    error: Option<String>,
}

struct PdfRow {
    name: String,
    mb: f64,
    pages: Option<u32>,
    kit: Option<KitRow>,
    skipped: Option<String>,
    whys: Vec<WhyRow>,
}

fn guide_shape(body: &str) -> (usize, usize, usize) {
    let words = body.split_whitespace().count();
    let lines = body.lines().map(str::trim_start);
    let headings = lines.clone().filter(|l| l.starts_with('#')).count();
    let bullets = lines
        .filter(|l| {
            l.starts_with("- ")
                || l.starts_with("* ")
                || l.starts_with("• ")
                || l.split_once(['.', ')']).is_some_and(|(n, rest)| {
                    !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) && rest.starts_with(' ')
                })
        })
        .count();
    (words, headings, bullets)
}

/// The bin/quality.py LETTER check: an explanation that names an option by
/// its letter (which the shuffle would make wrong).
fn names_letter(text: &str) -> bool {
    let letter = |w: &str| {
        let w = w.trim_start_matches('(');
        let w = w.trim_end_matches(|c: char| ".,;:!?)".contains(c));
        matches!(w, "A" | "B" | "C" | "D")
    };
    let bare = |w: &str| {
        w.trim_matches(|c: char| !c.is_alphanumeric())
            .to_ascii_lowercase()
    };
    let words: Vec<&str> = text.split_whitespace().collect();
    for (i, w) in words.iter().enumerate() {
        let next = |k: usize| words.get(i + k).copied().unwrap_or("");
        let b = bare(w);
        // option|answer|choice|letter <A-D>
        if matches!(b.as_str(), "option" | "answer" | "choice" | "letter")
            && w.ends_with(char::is_alphabetic)
            && letter(next(1))
        {
            return true;
        }
        // <A-D> is correct|incorrect|wrong|right
        if matches!(*w, "A" | "B" | "C" | "D")
            && next(1) == "is"
            && matches!(
                bare(next(2)).as_str(),
                "correct" | "incorrect" | "wrong" | "right"
            )
        {
            return true;
        }
        // correct answer|option is <A-D>
        if b == "correct"
            && matches!(bare(next(1)).as_str(), "answer" | "option")
            && next(2) == "is"
            && letter(next(3))
        {
            return true;
        }
    }
    // "B) " style
    let chars: Vec<char> = text.chars().collect();
    chars.windows(3).enumerate().any(|(i, w)| {
        matches!(w[0], 'A'..='D')
            && w[1] == ')'
            && w[2].is_whitespace()
            && (i == 0 || !chars[i - 1].is_alphanumeric())
    })
}

fn sentences(text: &str) -> usize {
    let chars: Vec<char> = text.chars().collect();
    chars
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            matches!(c, '.' | '!' | '?')
                && chars.get(i + 1).is_none_or(|n| n.is_whitespace())
                && *i > 0
                && chars[i - 1].is_alphanumeric()
        })
        .count()
}

fn refused(answer: &str) -> bool {
    let a = answer.to_lowercase();
    [
        "not answered",
        "do not cover",
        "don't cover",
        "does not cover",
        "doesn't cover",
        "not covered",
        "do not mention",
        "don't mention",
        "does not mention",
        "cannot answer",
        "can't answer",
    ]
    .iter()
    .any(|p| a.contains(p))
}

/// The frontend's sentLine("card", pages).
fn sent_label(pages: &[u32]) -> String {
    match (pages.iter().min(), pages.iter().max()) {
        (Some(a), Some(b)) if a == b => format!("Sent: this card and the text of page {a}"),
        (Some(a), Some(b)) => format!("Sent: this card and the text of pages {a}–{b}"),
        _ => "Sent: this card only".into(),
    }
}

fn page_bad(page: Option<u64>, pages: u32) -> bool {
    page.is_none_or(|p| p == 0 || p > u64::from(pages))
}

/// One kit exactly as `generate` makes it (same request builder, same
/// envelope reading, same validation and answer shuffle), with the raw
/// envelope kept for finishReason and the dropped counts.
fn run_kit(ctx: &GenContext<'_>, source: &LoadedSource, pages: u32) -> KitRow {
    let mut row = KitRow::default();
    let started = Instant::now();
    let generated = tauri::async_runtime::block_on(run_generation(ctx, source, &|part| {
        request_body(part, pages)
    }));
    row.seconds = started.elapsed().as_secs_f64();
    let (raw, model) = match generated {
        Ok(ok) => ok,
        Err(e) => {
            row.error = Some(e);
            return row;
        }
    };
    let envelope: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    row.finish = envelope
        .pointer("/candidates/0/finishReason")
        .and_then(Value::as_str)
        .unwrap_or("(none)")
        .to_string();
    let usage = &envelope["usageMetadata"];
    row.tokens = format!(
        "out {} / thinking {}",
        usage["candidatesTokenCount"].as_u64().unwrap_or(0),
        usage["thoughtsTokenCount"].as_u64().unwrap_or(0)
    );
    let text = match ctx.extract_text(&raw) {
        Ok(text) => text,
        Err(message) => {
            row.error = Some(
                if message.contains("output limit") || message.contains("incomplete") {
                    format!("{INCOMPLETE} (cut off: {message})")
                } else {
                    message
                },
            );
            return row;
        }
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        row.error = Some(format!("{INCOMPLETE} (answer JSON did not parse)"));
        return row;
    };
    let count = |part: &str| value[part].as_array().map_or(0, Vec::len);
    let (raw_cards, raw_questions) = (count("cards"), count("questions"));
    row.guide_pages_bad = value["guide"]["sourcePages"].as_array().map_or(0, |a| {
        a.iter().filter(|p| page_bad(p.as_u64(), pages)).count()
    });
    let raw_value = value.clone();
    row.raw_acs = raw_value["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|q| q["acsTask"].to_string())
        .collect();
    let mut local = kit_evidence::PageText::new(source);
    let result = validate_checked(value, pages, model, None, |p| local.page(p));
    dump_drops(&raw_value, &result, &mut local);
    for kind in ["cards", "questions"] {
        let c = &result["quoteCounts"][kind];
        row.dropped_by_quote += c["droppedByQuote"].as_u64().unwrap_or(0) as usize;
        row.unverified += c["unverified"].as_u64().unwrap_or(0) as usize;
        row.dropped_by_choices += c["droppedByChoices"].as_u64().unwrap_or(0) as usize;
    }
    let parts = &result["parts"];
    for part in ["guide", "cards", "questions"] {
        if let Some(e) = parts[part]["error"].as_str() {
            row.part_errors.push(format!("{part}: {e}"));
        }
    }
    if let Some(body) = parts["guide"]["answer"]["sections"][0]["body"].as_str() {
        row.guide = Some(guide_shape(body));
    }
    if let Some(cards) = parts["cards"]["answer"]["flashcards"].as_array() {
        row.cards = cards.len();
        row.cards_pages_bad = cards
            .iter()
            .filter(|c| page_bad(c["sourcePage"].as_u64(), pages))
            .count();
        let pick = [0, cards.len() / 2];
        for i in pick.into_iter().filter(|&i| i < cards.len()) {
            let c = &cards[i];
            if let Some(p) = c["sourcePage"].as_u64() {
                let front = c["front"].as_str().unwrap_or_default().to_string();
                if row.sample_cards.iter().all(|(f, _, _)| *f != front) {
                    row.sample_cards.push((
                        front,
                        c["back"].as_str().unwrap_or_default().to_string(),
                        p as u32,
                    ));
                }
            }
        }
    }
    row.cards_dropped = raw_cards.saturating_sub(row.cards);
    if let Some(questions) = parts["questions"]["answer"]["questions"].as_array() {
        row.questions = questions.len();
        let width = questions
            .iter()
            .map(|q| q["options"].as_array().map_or(0, Vec::len))
            .max()
            .unwrap_or(0);
        row.positions = vec![0; width];
        for q in questions {
            if let Some(i) = q["correctIndex"].as_u64() {
                if let Some(slot) = row.positions.get_mut(i as usize) {
                    *slot += 1;
                }
            }
            if names_letter(q["explanation"].as_str().unwrap_or_default()) {
                row.letter_explanations += 1;
            }
            row.acs_tags
                .push(q["acsTask"].as_str().unwrap_or("none").to_string());
        }
        row.questions_pages_bad = questions
            .iter()
            .filter(|q| page_bad(q["sourcePage"].as_u64(), pages))
            .count();
    }
    row.questions_dropped = raw_questions.saturating_sub(row.questions);
    row
}

/// Diagnostic: append every quote-dropped item, its quote and a lenient
/// (letters/digits only) re-check on pages p-1..p+1, to HFD_LIVE_DROPS.
fn dump_drops(raw: &Value, result: &Value, pages: &mut kit_evidence::PageText) {
    let Ok(path) = std::env::var("HFD_LIVE_DROPS") else {
        return;
    };
    let loose = |t: &str| {
        t.chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
            .to_lowercase()
    };
    let mut out = String::new();
    for (kind, key, kept_ptr) in [
        ("cards", "front", "/parts/cards/answer/flashcards"),
        ("questions", "question", "/parts/questions/answer/questions"),
    ] {
        let kept: Vec<&str> = result
            .pointer(kept_ptr)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|i| i[key].as_str()).collect())
            .unwrap_or_default();
        for item in raw[kind].as_array().into_iter().flatten() {
            let text = item[key].as_str().unwrap_or_default();
            if kept.contains(&text) {
                continue;
            }
            let page = item["sourcePage"].as_u64().unwrap_or(0) as u32;
            let quote = item["quote"].as_str().unwrap_or_default();
            let q = loose(quote);
            let mut verdict = "NOT FOUND (loose) on p-1..p+1".to_string();
            for cand in [page, page.saturating_sub(1), page + 1] {
                if let Some(t) = pages.page(cand) {
                    if !q.is_empty() && loose(&t).contains(&q) {
                        verdict = format!("loose match on page {cand} (strict matcher missed)");
                        break;
                    }
                }
            }
            let _ = writeln!(
                out,
                "- **{kind}** p{page}: {text}\n  - quote: \"{quote}\"\n  - {verdict}"
            );
        }
    }
    if !out.is_empty() {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        use std::io::Write as _;
        let _ = f.write_all(out.as_bytes());
    }
}

fn run_why(ctx: &GenContext<'_>, doc: &lopdf::Document, card: &(String, String, u32)) -> WhyRow {
    let (front, back, cited) = card;
    let page_ids = doc.get_pages();
    // The page window, read on this Mac by the app's own page reader, kept
    // only where the cache would keep it (readable text within the cap).
    let page_text = why_page_text(*cited, |page| {
        let id = page_ids.get(&page)?;
        let (inspection, text) = read_page(doc, page, *id);
        (outcome(&inspection, &text) == Outcome::Text && text.len() <= MAX_PAGE_TEXT_BYTES)
            .then_some(text)
    });
    let context = format!("Card front: {front}\n\nCard back: {back}\n\nSource page: {cited}");
    let started = Instant::now();
    let answer = tauri::async_runtime::block_on(ask_card_why_with(
        ctx,
        page_text,
        &context,
        "Why is this the answer?",
        &[],
    ));
    let seconds = started.elapsed().as_secs_f64();
    match answer {
        Ok(a) => WhyRow {
            cited: *cited,
            seconds,
            sentences: sentences(&a.answer),
            refused: refused(&a.answer),
            label: sent_label(a.context_pages.as_deref().unwrap_or_default()),
            answer: a.answer,
            error: None,
        },
        Err(e) => WhyRow {
            cited: *cited,
            seconds,
            sentences: 0,
            refused: false,
            label: String::new(),
            answer: String::new(),
            error: Some(e),
        },
    }
}

fn report(rows: &[PdfRow], model: &str, max_sends: u32, sends: u32) -> String {
    let mut s = String::new();
    let _ = writeln!(
        s,
        "# Live bench\n\nModel choice: {model}. Sends: {sends} of {max_sends}.\n"
    );
    s.push_str("| PDF | pages | kit s | finish | guide w/h/b | cards (dropped) | qs (dropped) | dropped by quote | unverified | dropped by choices | correct A/B/C | bad pages | Why? (s, sentences, refused) | flags |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n");
    for r in rows {
        let pages = r.pages.map_or("?".into(), |p| p.to_string());
        let Some(k) = &r.kit else {
            let _ = writeln!(
                s,
                "| {} ({:.1} MB) | {pages} | – | – | – | – | – | – | – | – | – | – | – | {} |",
                r.name,
                r.mb,
                r.skipped.as_deref().unwrap_or("")
            );
            continue;
        };
        let guide = k
            .guide
            .map_or("–".into(), |(w, h, b)| format!("{w}/{h}/{b}"));
        let hist = k
            .positions
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join("/");
        let bad = k.guide_pages_bad + k.cards_pages_bad + k.questions_pages_bad;
        let whys = r
            .whys
            .iter()
            .map(|w| match &w.error {
                Some(_) => "error".to_string(),
                None => format!(
                    "{:.0}s, {}, {}",
                    w.seconds,
                    w.sentences,
                    if w.refused { "yes" } else { "no" }
                ),
            })
            .collect::<Vec<_>>()
            .join("; ");
        let mut flags = Vec::new();
        if k.questions > 0 && k.positions.iter().any(|&n| n * 10 > k.questions * 4) {
            flags.push("position >40%".to_string());
        }
        if bad > 0 {
            flags.push(format!("{bad} page(s) out of range"));
        }
        if k.letter_explanations > 0 {
            flags.push(format!(
                "{} explanation(s) name a letter",
                k.letter_explanations
            ));
        }
        if k.error.is_some() {
            flags.push("kit error".into());
        }
        if !k.part_errors.is_empty() {
            flags.push(format!("{} part(s) failed", k.part_errors.len()));
        }
        let _ = writeln!(
            s,
            "| {} ({:.1} MB) | {pages} | {:.0} | {} | {guide} | {} ({}) | {} ({}) | {} | {} | {} | {} | {bad} | {} | {} |",
            r.name,
            r.mb,
            k.seconds,
            k.finish,
            k.cards,
            k.cards_dropped,
            k.questions,
            k.questions_dropped,
            k.dropped_by_quote,
            k.unverified,
            k.dropped_by_choices,
            if hist.is_empty() { "–".into() } else { hist },
            if whys.is_empty() { "–".into() } else { whys },
            if flags.is_empty() { "ok".into() } else { flags.join(", ") }
        );
    }
    for r in rows {
        let _ = writeln!(s, "\n## {}\n", r.name);
        let _ = writeln!(
            s,
            "- Size {:.1} MB, pages {}",
            r.mb,
            r.pages.map_or("unknown".into(), |p| p.to_string())
        );
        if let Some(why) = &r.skipped {
            let _ = writeln!(s, "- Skipped: {why}");
        }
        if let Some(k) = &r.kit {
            let _ = writeln!(
                s,
                "- Kit: {:.1} s, finishReason {}, tokens {}",
                k.seconds, k.finish, k.tokens
            );
            if let Some(e) = &k.error {
                let _ = writeln!(s, "- Kit error (verbatim): {e}");
            }
            if let Some((w, h, b)) = k.guide {
                let _ = writeln!(s, "- Guide: {w} words, {h} headings, {b} bullets");
            }
            let _ = writeln!(
                s,
                "- Cards {} kept, {} dropped invalid; questions {} kept, {} dropped invalid",
                k.cards, k.cards_dropped, k.questions, k.questions_dropped
            );
            let _ = writeln!(
                s,
                "- Correct positions: {:?}; explanations naming a letter: {}",
                k.positions, k.letter_explanations
            );
            let _ = writeln!(
                s,
                "- ACS tasks per question: {} (raw from model: {})",
                k.acs_tags.join(", "),
                k.raw_acs.join(", ")
            );
            let _ = writeln!(
                s,
                "- sourcePage out of 1..={}: guide {}, cards {}, questions {}",
                r.pages.unwrap_or(0),
                k.guide_pages_bad,
                k.cards_pages_bad,
                k.questions_pages_bad
            );
            for e in &k.part_errors {
                let _ = writeln!(s, "- Part error (verbatim): {e}");
            }
        }
        for w in &r.whys {
            let _ = writeln!(
                s,
                "- Why? on a card citing page {}: {:.1} s",
                w.cited, w.seconds
            );
            match &w.error {
                Some(e) => {
                    let _ = writeln!(s, "  - Error (verbatim): {e}");
                }
                None => {
                    let _ = writeln!(
                        s,
                        "  - {} sentences, refused: {}, label: \"{}\"",
                        w.sentences, w.refused, w.label
                    );
                    let _ = writeln!(s, "  - Answer: {}", w.answer.replace('\n', " "));
                }
            }
        }
    }
    s
}

#[test]
#[ignore = "live: sends real PDFs to the provider; run with HFD_LIVE_BENCH=1 (see module docs)"]
fn live_bench() {
    let env = match bench_env() {
        Ok(Some(env)) => env,
        Ok(None) => {
            eprintln!("live bench skipped: HFD_LIVE_BENCH is not 1");
            return;
        }
        Err(why) => panic!("live bench refused: {why}"),
    };
    let root = env.profile.as_path();
    let provider = AnyProvider::selected(root);
    let choice = load_choice(root);
    // The key file, read as the app reads it. The old keychain move is not
    // tried: a QA profile without a key file is refused instead.
    let key = match crate::secrets::load_key_for(root, provider.id()) {
        Ok(Some(key)) => key,
        _ => panic!("live bench refused: no readable key file in the QA profile"),
    };
    let mut files: Vec<(u64, PathBuf)> = std::fs::read_dir(&env.pdfs)
        .expect("HFD_LIVE_PDFS is readable")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")))
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.len(), p)))
        .collect();
    files.sort();
    let http = generation_client().expect("HTTP client");
    let say = |_: String| {};
    let mut sends = 0u32;
    let mut rows = Vec::new();
    for (size, path) in files {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut row = PdfRow {
            name: name.clone(),
            mb: size as f64 / 1_048_576.0,
            pages: None,
            kit: None,
            skipped: None,
            whys: Vec::new(),
        };
        if sends >= env.max_sends {
            row.skipped = Some("send cap reached".into());
            rows.push(row);
            continue;
        }
        eprintln!("live bench: {name}");
        let pages = tauri::async_runtime::block_on(check_pdf_length_for(&path, provider));
        let bytes = std::fs::read(&path).expect("PDF is readable");
        let mut source = LoadedSource::new(bytes, "application/pdf", &name);
        match pages {
            Ok(count) => source.page_count = count,
            Err(e) => {
                row.skipped = Some(format!("app refused before sending: {e}"));
                rows.push(row);
                continue;
            }
        }
        row.pages = source.page_count;
        let pages = match check_source(&source) {
            Ok(pages) => pages,
            Err(e) => {
                row.skipped = Some(format!("app refused before sending: {e}"));
                rows.push(row);
                continue;
            }
        };
        let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
        budget.section_generation_limit(480);
        let ctx = GenContext {
            provider,
            http: &http,
            base: provider.base(),
            api_key: &key,
            choice,
            cache: prepared_sources(),
            epoch: prepared_sources().epoch(),
            budget: &budget,
            say: &say,
        };
        sends += 1;
        let kit = run_kit(&ctx, &source, pages);
        let doc = lopdf::Document::load_mem(&source.bytes).ok();
        for card in &kit.sample_cards {
            if sends >= env.max_sends {
                break;
            }
            let Some(doc) = doc.as_ref() else { break };
            let budget = Budget::new(ASK_GEMINI_BUDGET);
            let ctx = GenContext {
                budget: &budget,
                epoch: prepared_sources().epoch(),
                ..ctx
            };
            sends += 1;
            row.whys.push(run_why(&ctx, doc, card));
        }
        row.kit = Some(kit);
        rows.push(row);
    }
    let text = report(&rows, &format!("{choice:?}"), env.max_sends, sends);
    if text.contains(key.as_str()) {
        panic!("live bench refused to write a report that would contain the key");
    }
    std::fs::write(&env.out, &text).expect("HFD_LIVE_OUT is writable");
    let written = std::fs::read_to_string(&env.out).expect("report reads back");
    if written.contains(key.as_str()) {
        let _ = std::fs::remove_file(&env.out);
        panic!("live bench removed a report that contained the key");
    }
    println!("{}", text.split("\n## ").next().unwrap_or_default());
    println!("Report: {}", env.out.display());
}

#[test]
fn live_bench_helpers_match_the_quality_script() {
    assert!(names_letter("Option B is the right one."));
    assert!(names_letter("The correct answer is (C)."));
    assert!(names_letter("A is correct because lift acts upward."));
    assert!(names_letter("See B) above for why."));
    assert!(!names_letter(
        "A stall happens at the critical angle of attack."
    ));
    assert!(!names_letter("Lift acts upward; drag acts rearward."));
    assert_eq!(
        guide_shape("Intro.\n### Lift\n- one\n- two\n1. three"),
        (9, 1, 3)
    );
    assert_eq!(sentences("One. Two! Three? 3.5 knots"), 3);
    assert_eq!(
        sent_label(&[3, 4, 5]),
        "Sent: this card and the text of pages 3–5"
    );
    assert_eq!(sent_label(&[]), "Sent: this card only");
    assert!(is_real_student("/x/com.herflightdeck.app"));
    assert!(!is_real_student(
        "/x/com.herflightdeck.synthetic.codex.hub06"
    ));
}
