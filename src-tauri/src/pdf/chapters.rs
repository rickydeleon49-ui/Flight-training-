//! Finding the chapters of a stored PDF, and saving chosen page ranges as parts
//! of one split (one receipt, all or nothing).

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use lopdf::Document;
use serde::{Deserialize, Serialize};

use super::{
    documents, lineage, pdf_file_name, read_pdf_once, render_window_range, window_document,
    SplitFiles, MAX_PAGES,
};
use crate::lineage::{SplitSourceReceipt, WrittenPart};

/// Pages one study kit may read (study_kit.rs).
const KIT_PAGE_LIMIT: u32 = 150;
/// Room kept for the prompt around the PDF when checking the request size.
const PROMPT_OVERHEAD_BYTES: u64 = 256 * 1024;
/// Pages per chunk when a PDF has no usable outline or headings.
const CHUNK_PAGES: u32 = 30;
/// Longest book name or chapter title kept in a part's file name, so the
/// stored name (id + book + title) stays well under the 255-byte file limit.
const NAME_PART_CHARS: usize = 60;
/// Only the first lines of a page count as "the top of the page".
const TOP_LINES: usize = 3;
/// Longest chapter title shown; longer "titles" are page text.
const MAX_TITLE_CHARS: usize = 80;
/// An outline with more entries than this per page is the page text turned
/// into bookmarks, not a contents list.
const MAX_OUTLINE_ENTRIES_PER_PAGE: u64 = 4;
/// Chapters average at least this many pages; finer outline levels are not
/// chapters.
const MIN_CHAPTER_PAGES: u32 = 3;
/// A heading kept after "Chapter N" on the same line is at most this long.
const MAX_HEADING_CHARS: usize = 50;
const MAX_HEADING_WORDS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub title: String,
    pub first_page: u32,
    pub last_page: u32,
}

/// Outline entries by level: (page, title), skipping entries that point
/// outside the book or have no title. Shared with the section planner.
pub(crate) fn outline_levels(
    document: &Document,
    total: u32,
) -> BTreeMap<usize, Vec<(u32, String)>> {
    let mut levels: BTreeMap<usize, Vec<(u32, String)>> = BTreeMap::new();
    if let Ok(toc) = document.get_toc() {
        for entry in toc.toc {
            if let Ok(page) = u32::try_from(entry.page) {
                if page > 0 && page <= total && !entry.title.trim().is_empty() {
                    levels
                        .entry(entry.level)
                        .or_default()
                        .push((page, entry.title));
                }
            }
        }
    }
    levels
}

/// At most `max` characters, cut at a character boundary and trimmed.
fn clip(text: &str, max: usize) -> String {
    text.chars()
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// True when `title` reads like a heading, not a run of page text: short,
/// mostly letters. Outline and text titles that fail this are not shown.
fn clean_title(title: &str) -> bool {
    let title = title.trim();
    let visible = title.chars().filter(|c| !c.is_whitespace()).count();
    let letters = title.chars().filter(|c| c.is_alphabetic()).count();
    title.chars().count() <= MAX_TITLE_CHARS && letters >= 1 && letters * 2 >= visible
}

/// Turn sorted, distinct chapter starts into ranges that cover every page.
/// Pages before the first start become a leading "Front pages" entry. A start
/// without a clean title is named by its pages.
fn cover(starts: Vec<(u32, String)>, total: u32) -> Vec<Chapter> {
    let mut chapters = Vec::new();
    if let Some((first, _)) = starts.first() {
        if *first > 1 {
            chapters.push(Chapter {
                title: "Front pages".into(),
                first_page: 1,
                last_page: first - 1,
            });
        }
    }
    for (i, (page, title)) in starts.iter().enumerate() {
        let last_page = starts.get(i + 1).map_or(total, |(next, _)| next - 1);
        let title = if clean_title(title) {
            title.trim().to_string()
        } else {
            pages_title(*page, last_page)
        };
        chapters.push(Chapter {
            title,
            first_page: *page,
            last_page,
        });
    }
    chapters
}

fn pages_title(first: u32, last: u32) -> String {
    if first == last {
        format!("Page {first}")
    } else {
        format!("Pages {first}\u{2013}{last}")
    }
}

/// An outline title without the publisher's file-name dressing: "02 - AFH
/// Chapter 1 (Draft 4)" reads "Chapter 1". Anything else is left as it is.
fn tidy_outline_title(title: &str) -> String {
    let mut text = title.trim();
    if let Some(open) = text.rfind('(') {
        let draft = text[open + 1..].strip_suffix(')').map(|inner| {
            let words: Vec<&str> = inner.split_whitespace().collect();
            words.len() == 2
                && words[0].eq_ignore_ascii_case("draft")
                && words[1].chars().all(|c| c.is_ascii_digit())
        });
        if draft == Some(true) && open > 0 {
            text = text[..open].trim_end();
        }
    }
    if let Some((number, rest)) = text.split_once(" - ") {
        let numbered = !number.is_empty() && number.chars().all(|c| c.is_ascii_digit() || c == '.');
        if let (true, Some((tag, tail))) = (numbered, rest.split_once(' ')) {
            let tag_ok =
                (2..=6).contains(&tag.len()) && tag.chars().all(|c| c.is_ascii_uppercase());
            if tag_ok && !tail.trim().is_empty() {
                text = tail.trim();
            }
        }
    }
    text.to_string()
}

/// Chapters from the outline: the shallowest level with at least two distinct
/// chapter starts (a lone wrapper bookmark is skipped). An outline that is
/// really the page text turned into bookmarks (as some PDF tools make from the
/// tagged structure: thousands of entries, paragraphs and figure text as
/// titles, a "chapter" every page or two) is not used.
pub(crate) fn outline_chapters(document: &Document, total: u32) -> Vec<Chapter> {
    let levels = outline_levels(document, total);
    let entries: usize = levels.values().map(Vec::len).sum();
    if entries as u64 > u64::from(total) * MAX_OUTLINE_ENTRIES_PER_PAGE {
        return Vec::new();
    }
    for entries in levels.into_values() {
        let mut by_page: BTreeMap<u32, String> = BTreeMap::new();
        for (page, title) in entries {
            by_page
                .entry(page)
                .or_insert_with(|| tidy_outline_title(&title));
        }
        if by_page.len() >= 2 {
            let clean = by_page.values().filter(|t| clean_title(t)).count();
            let too_fine = by_page.len() as u64 * u64::from(MIN_CHAPTER_PAGES) > u64::from(total);
            if too_fine || clean * 2 < by_page.len() {
                return Vec::new();
            }
            return cover(by_page.into_iter().collect(), total);
        }
    }
    Vec::new()
}

/// A line with its digits blanked, so "Page 4" and "Page 5" compare equal.
fn shape(line: &str) -> String {
    line.chars()
        .map(|c| {
            if c.is_ascii_digit() {
                '#'
            } else {
                c.to_ascii_lowercase()
            }
        })
        .collect()
}

fn top_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .take(TOP_LINES)
        .collect()
}

/// The chapter number if the line starts with "Chapter N" (digits, or a roman
/// numeral as its own word), with a clean title: "Chapter N", plus the rest of
/// the line only when it is a short heading set apart from the number.
fn chapter_number(line: &str) -> Option<(String, String)> {
    let head = line.get(..8)?;
    if !head.eq_ignore_ascii_case("chapter ") {
        return None;
    }
    let rest = line[8..].trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let number = if digits.is_empty() {
        let word = rest
            .split(|c: char| !c.is_alphanumeric())
            .next()
            .unwrap_or("");
        let roman =
            !word.is_empty() && word.len() <= 6 && word.chars().all(|c| "IVXLivxl".contains(c));
        if !roman {
            return None;
        }
        word.to_ascii_uppercase()
    } else {
        digits
    };
    let after = &rest[number.len()..];
    let heading = after
        .strip_prefix(|c: char| c.is_whitespace() || ":-\u{2013}\u{2014}.".contains(c))
        .map(|h| h.trim_matches(|c: char| c.is_whitespace() || ":-\u{2013}\u{2014}.".contains(c)))
        .filter(|h| {
            h.chars().count() <= MAX_HEADING_CHARS
                && h.split_whitespace().count() <= MAX_HEADING_WORDS
                && !h.contains(". ")
                && clean_title(h)
        });
    let title = match heading {
        Some(h) => format!("Chapter {number}: {h}"),
        None => format!("Chapter {number}"),
    };
    Some((number, title))
}

/// A chapter page number at the start of a line, as many handbooks print
/// them: "5-12" (chapter 5, page 12) or "A-3" (appendix A). Returns the
/// chapter label and the page within it. "1-10" is never read as "1-1".
fn page_label(line: &str) -> Option<(String, u32)> {
    let (label, rest) = line.split_once('-')?;
    let numbered =
        !label.is_empty() && label.len() <= 2 && label.chars().all(|c| c.is_ascii_digit());
    let lettered = label.len() == 1 && label.chars().all(|c| c.is_ascii_uppercase());
    if !numbered && !lettered || numbered && label.starts_with('0') {
        return None;
    }
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > 3 {
        return None;
    }
    Some((label.to_string(), digits.parse().ok()?))
}

/// Chapter starts from chapter page numbers ("3-1" opens chapter 3), used only
/// when most pages carry such a number as their first or last line (where
/// page numbers sit). A start counts only when the next page carries the same
/// chapter's numbers too, so a contents page that ends in "I-1" is not a
/// start. Chapters must count up; lettered parts (appendices, glossary,
/// index) come after, each once.
fn label_starts(texts: &[(u32, String)], total: u32) -> Vec<(u32, String)> {
    let labelled: Vec<(u32, String, u32, Vec<String>)> = texts
        .iter()
        .filter_map(|(page, text)| {
            let lines: Vec<String> = text
                .lines()
                .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|l| !l.is_empty())
                .collect();
            let (label, within) = [lines.first(), lines.last()]
                .into_iter()
                .flatten()
                .find_map(|l| page_label(l))?;
            Some((*page, label, within, lines))
        })
        .collect();
    if (labelled.len() as u64) * 2 <= u64::from(total) {
        return Vec::new();
    }
    let mut starts = Vec::new();
    let mut last_number = 0;
    let mut letters_seen: Vec<String> = Vec::new();
    let label_on: HashMap<u32, String> = labelled
        .iter()
        .map(|(page, label, _, _)| (*page, label.clone()))
        .collect();
    for (page, label, within, lines) in labelled {
        let continues = page == total || label_on.get(&(page + 1)) == Some(&label);
        if within != 1 || !continues {
            continue;
        }
        let title = if let Ok(number) = label.parse::<u32>() {
            if number <= last_number || !letters_seen.is_empty() {
                continue;
            }
            last_number = number;
            format!("Chapter {number}")
        } else {
            if letters_seen.contains(&label) {
                continue;
            }
            letters_seen.push(label.clone());
            // Only a known name; otherwise `cover` names it by its pages.
            let appendix = format!("Appendix {label}");
            let named = |word: &str| lines.iter().any(|l| l.eq_ignore_ascii_case(word));
            if named(&appendix) {
                appendix
            } else {
                ["Glossary", "Index"]
                    .into_iter()
                    .find(|word| named(word))
                    .unwrap_or_default()
                    .to_string()
            }
        };
        starts.push((page, title));
    }
    starts
}

/// Chapter starts read from page text: chapter page numbers ("4-1") when the
/// book uses them, otherwise "Chapter N" in the first lines of a page. A line
/// repeated at the top of most pages is a running header, not a start, and
/// the same chapter number twice in a row is a header too. Titles are never
/// page text: "Chapter N" (with a short heading), or the pages.
fn text_starts(document: &Document, total: u32) -> Vec<(u32, String)> {
    let texts: Vec<(u32, String)> = (1..=total)
        .map(|page| (page, document.extract_text(&[page]).unwrap_or_default()))
        .collect();
    let by_label = label_starts(&texts, total);
    if by_label.len() >= 2 {
        return name_chapters(document, by_label);
    }
    let tops: Vec<(u32, Vec<String>)> = texts
        .iter()
        .map(|(page, text)| (*page, top_lines(text)))
        .collect();
    let mut repeats: HashMap<String, u32> = HashMap::new();
    for (_, lines) in &tops {
        let mut seen: Vec<String> = lines.iter().map(|l| shape(l)).collect();
        seen.dedup();
        for shaped in seen {
            *repeats.entry(shaped).or_default() += 1;
        }
    }
    let header = |line: &str| repeats.get(&shape(line)).copied().unwrap_or(0) * 2 > total;
    let mut starts = Vec::new();
    let mut last_number = None;
    for (page, lines) in tops {
        let found = lines
            .iter()
            .filter(|l| !header(l))
            .find_map(|l| chapter_number(l));
        if let Some((number, title)) = found {
            if last_number.as_ref() != Some(&number) {
                last_number = Some(number);
                starts.push((page, title));
            }
        }
    }
    name_chapters(document, starts)
}

/// One whitespace-collapsed, non-empty line of page text.
fn page_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect()
}

/// A short line with no sentence in it: a piece of a title.
fn title_piece(line: &str) -> bool {
    line.chars().count() <= 40
        && line.split_whitespace().count() <= 6
        && !line.ends_with(['.', ',', ';', ':', ']', ')', '?', '!'])
        && !line.chars().any(|c| c.is_ascii_digit() || c == '[')
        && line.chars().any(char::is_alphabetic)
}

/// The title lines just before `lines[end]`: up to three short pieces, and
/// only when the line before them ends a sentence (or is the page number or
/// the top of the page), so a run of body text is never taken.
fn pieces_before(lines: &[String], end: usize) -> Option<String> {
    let mut start = end;
    while start > 0
        && end - start < 3
        && title_piece(&lines[start - 1])
        && page_label(&lines[start - 1]).is_none()
    {
        start -= 1;
    }
    if start == end {
        return None;
    }
    let stop_ok = start == 0
        || page_label(&lines[start - 1]).is_some()
        || lines[start - 1].ends_with(['.', ']', ')', '?', '!']);
    stop_ok.then(|| lines[start..end].join(" "))
}

/// The real name of chapter `number` from the text of its first page. These
/// handbooks print the name as large lines that the text extractor puts after
/// the body, next to a lone "Chapter N" line; or just before a line that
/// starts "Chapter NBody..." (glued); or split around a glued "Chapter N"
/// ("FlightChapter 8 Instruments"). Anything else gives None, and a body
/// sentence is never taken.
fn chapter_heading(text: &str, number: &str) -> Option<String> {
    let lines = page_lines(text);
    let marker = format!("Chapter {number}");
    let heading = lines.iter().enumerate().find_map(|(i, line)| {
        if *line == marker {
            return pieces_before(&lines, i);
        }
        if let Some(rest) = line.strip_prefix(&marker) {
            // Glued: "Chapter 7Introduction...", the name is the lines above.
            return rest
                .chars()
                .next()
                .is_some_and(char::is_alphabetic)
                .then(|| pieces_before(&lines, i))
                .flatten();
        }
        // Split: "FlightChapter 8 Instruments".
        let at = line.find(&marker)?;
        let before = &line[..at];
        let after = line[at + marker.len()..].trim();
        let glued = before.chars().last().is_some_and(char::is_alphabetic);
        let whole = format!("{before} {after}");
        (glued
            && !after.is_empty()
            && title_piece(before)
            && title_piece(after)
            && title_piece(&whole))
        .then_some(whole)
    })?;
    let ok = heading.chars().count() <= MAX_HEADING_CHARS
        && heading.split_whitespace().count() <= MAX_HEADING_WORDS
        && !heading.eq_ignore_ascii_case("introduction")
        && clean_title(&heading);
    ok.then_some(heading)
}

/// Give chapters named only "Chapter N" the name printed on their first page.
fn name_chapters(document: &Document, starts: Vec<(u32, String)>) -> Vec<(u32, String)> {
    starts
        .into_iter()
        .map(|(page, title)| {
            let number = title
                .strip_prefix("Chapter ")
                .filter(|n| n.chars().all(|c| c.is_ascii_alphanumeric()));
            let named = number.and_then(|number| {
                let text = document.extract_text(&[page]).ok()?;
                chapter_heading(&text, number)
            });
            match named {
                Some(heading) => (page, format!("{title}: {heading}")),
                None => (page, title),
            }
        })
        .collect()
}

/// Even chunks of about `CHUNK_PAGES` pages covering every page.
fn chunks(total: u32) -> Vec<Chapter> {
    let count = total.div_ceil(CHUNK_PAGES).max(1);
    let size = total.div_ceil(count).max(1);
    (0..count)
        .filter_map(|i| {
            let first = i * size + 1;
            (first <= total).then(|| Chapter {
                title: format!("Pages {first}\u{2013}{}", ((i + 1) * size).min(total)),
                first_page: first,
                last_page: ((i + 1) * size).min(total),
            })
        })
        .collect()
}

/// Chapters of a PDF and how they were found: "outline", "text" or "chunks".
pub(crate) fn detect_chapters(
    document: &Document,
    total: u32,
    mostly_pictures: bool,
) -> (Vec<Chapter>, &'static str) {
    let from_outline = outline_chapters(document, total);
    if !from_outline.is_empty() {
        return (from_outline, "outline");
    }
    if !mostly_pictures {
        let starts = text_starts(document, total);
        if starts.len() >= 2 {
            return (cover(starts, total), "text");
        }
    }
    (chunks(total), "chunks")
}

/// One range a caller asked for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRangeRequest {
    pub first_page: u32,
    pub last_page: u32,
    #[serde(default)]
    pub title: String,
}

fn validate_ranges(
    ranges: &[PageRangeRequest],
    total: u32,
) -> Result<Vec<PageRangeRequest>, String> {
    if ranges.is_empty() {
        return Err("Choose at least one page range.".into());
    }
    let mut sorted = ranges.to_vec();
    sorted.sort_by_key(|r| (r.first_page, r.last_page));
    for r in &sorted {
        if r.first_page == 0 || r.last_page < r.first_page {
            return Err(format!(
                "Pages {}\u{2013}{} are not a valid range: the last page cannot come before the first.",
                r.first_page, r.last_page
            ));
        }
        if r.last_page > total {
            return Err(format!(
                "Pages {}\u{2013}{} go past the end: this PDF has {total} pages.",
                r.first_page, r.last_page
            ));
        }
    }
    for pair in sorted.windows(2) {
        if pair[1].first_page <= pair[0].last_page {
            return Err(format!(
                "Pages {}\u{2013}{} overlap pages {}\u{2013}{}.",
                pair[0].first_page, pair[0].last_page, pair[1].first_page, pair[1].last_page
            ));
        }
    }
    Ok(sorted)
}

/// Whether a part of this many bytes can go to the provider with its prompt.
fn fits_provider(provider: crate::provider::AnyProvider, bytes: u64) -> bool {
    match provider {
        crate::provider::AnyProvider::Claude(_) => {
            crate::provider::claude::check_size(bytes.saturating_add(PROMPT_OVERHEAD_BYTES)).is_ok()
        }
        crate::provider::AnyProvider::Gemini(_) => crate::gemini::pdf_fits(bytes),
    }
}

/// Cut `first..=last` (pages of the window starting at `offset`) into parts
/// that fit, halving until they do. A single page that cannot fit is refused.
fn fit_parts(
    window: &Document,
    offset: u32,
    (first, last): (u32, u32),
    limits: (u32, &dyn Fn(u64) -> bool),
    out: &mut Vec<(u32, u32, Vec<u8>)>,
) -> Result<(), String> {
    let (max_pages, fits) = limits;
    if last - first < max_pages {
        let bytes = render_window_range(window, first - offset + 1, last - offset + 1)?;
        if fits(bytes.len() as u64) {
            out.push((first, last, bytes));
            return Ok(());
        }
        if first == last {
            return Err(format!(
                "Page {first} is too large to send by itself, so this PDF cannot be split into \
                 chapters. Nothing was saved."
            ));
        }
    }
    let middle = first + (last - first) / 2;
    fit_parts(window, offset, (first, middle), limits, out)?;
    fit_parts(window, offset, (middle + 1, last), limits, out)
}

/// Saves the ranges as parts of one receipt, and says "Saving chapter 5 of 23\u{2026}" before each range.
pub fn split_ranges_reporting(
    root: &Path,
    ids: (&str, &str, &str, &str),
    ranges: &[PageRangeRequest],
    progress: &dyn Fn(String),
) -> Result<SplitSourceReceipt, String> {
    let provider = crate::provider::AnyProvider::selected(root);
    split_ranges_inner(
        root,
        ids,
        ranges,
        (KIT_PAGE_LIMIT.min(MAX_PAGES), &|bytes| {
            fits_provider(provider, bytes)
        }),
        progress,
    )
}

#[cfg(test)]
fn split_ranges_with_limits(
    root: &Path,
    ids: (&str, &str, &str, &str),
    ranges: &[PageRangeRequest],
    limits: (u32, &dyn Fn(u64) -> bool),
) -> Result<SplitSourceReceipt, String> {
    split_ranges_inner(root, ids, ranges, limits, &|_| {})
}

fn split_ranges_inner(
    root: &Path,
    (source_material_id, relative_path, batch_id, file_name): (&str, &str, &str, &str),
    ranges: &[PageRangeRequest],
    limits: (u32, &dyn Fn(u64) -> bool),
    progress: &dyn Fn(String),
) -> Result<SplitSourceReceipt, String> {
    let documents_dir = root.join(documents::DOCUMENTS_DIR);
    let source = documents::contained_document_path(&documents_dir, relative_path)?;
    let (bytes, document) = read_pdf_once(&source)?;
    let total = u32::try_from(document.get_pages().len()).unwrap_or(u32::MAX);
    if total == 0 {
        return Err("That PDF has no pages this application can read.".to_string());
    }
    let ranges = validate_ranges(ranges, total)?;
    let base = pdf_file_name(file_name);
    let base = base.trim_end_matches(".pdf");

    let mut files = SplitFiles::default();
    let result = (|| {
        let mut parts = Vec::new();
        let count = ranges.len();
        for (position, range) in ranges.iter().enumerate() {
            progress(format!(
                "Saving chapter {} of {count}\u{2026}",
                position + 1
            ));
            let window = window_document(&document, range.first_page, range.last_page, total);
            let mut fitted = Vec::new();
            fit_parts(
                &window,
                range.first_page,
                (range.first_page, range.last_page),
                limits,
                &mut fitted,
            )?;
            let many = fitted.len() > 1;
            for (first, last, part_bytes) in fitted {
                let number = parts.len() + 1;
                let title = match (range.title.trim(), many) {
                    ("", _) => format!("Pages {first}\u{2013}{last}"),
                    (t, false) => t.to_string(),
                    (t, true) => format!("{t} (pages {first}\u{2013}{last})"),
                };
                let name = format!(
                    "{} - {}.pdf",
                    clip(base, NAME_PART_CHARS),
                    clip(&title, NAME_PART_CHARS)
                );
                let part_id = format!("{batch_id}-part-{number}");
                let (_, stored_name) =
                    files.write_part(&documents_dir, &part_id, &name, |tmp| {
                        std::fs::write(tmp, &part_bytes)
                            .map_err(|e| format!("Could not save the split PDF: {e}"))
                    })?;
                parts.push(WrittenPart {
                    id: part_id,
                    first_page: first,
                    last_page: last,
                    file_path: stored_name,
                    file_size: part_bytes.len() as u64,
                    original_file_name: name,
                });
            }
        }
        lineage::issue_receipt_at(
            root,
            source_material_id,
            relative_path,
            &bytes,
            total,
            &parts,
            &[],
        )
    })();
    if result.is_ok() {
        files.keep = true;
        return result;
    }
    if files.discard() {
        return result;
    }
    result.map_err(|error| {
        format!(
            "{error} Some temporary files could not be removed; restart the app before trying again."
        )
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn clip_keeps_names_short_and_utf8_safe() {
        let long = "\u{00e9}".repeat(200);
        assert_eq!(
            super::clip(&long, NAME_PART_CHARS).chars().count(),
            NAME_PART_CHARS
        );
        assert_eq!(super::clip(" Weather ", NAME_PART_CHARS), "Weather");
    }

    use super::*;
    use crate::pdf::mostly_pictures;
    use lopdf::{dictionary, Object, ObjectId, Stream};

    /// A PDF with the given text lines on each page. `junk[i]` adds that many
    /// incompressible bytes to page i+1 (to make a page large).
    /// `outline` is (level starting at 1, title, destination page) in order.
    fn book(
        pages: &[Vec<&str>],
        junk: &[(usize, usize)],
        outline: &[(usize, &str, u32)],
    ) -> Document {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font = document.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let page_ids: Vec<ObjectId> = pages
            .iter()
            .enumerate()
            .map(|(i, lines)| {
                // One text object per line, as most PDF writers emit.
                let mut content = String::new();
                for (n, line) in lines.iter().enumerate() {
                    content.push_str(&format!(
                        "BT /F1 12 Tf 50 {} Td ({line}) Tj ET\n",
                        750 - 20 * n
                    ));
                }
                let mut bytes = content.into_bytes();
                if let Some((_, size)) = junk.iter().find(|(page, _)| *page == i + 1) {
                    let mut x: u32 = 12345;
                    bytes.extend((0..*size).map(|_| {
                        x = x.wrapping_mul(1_103_515_245).wrapping_add(12345);
                        b'0' + ((x >> 16) % 10) as u8 + (((x >> 20) % 40) as u8)
                    }));
                    bytes.extend(b" ");
                }
                let contents = document.add_object(Stream::new(dictionary! {}, bytes));
                document.add_object(dictionary! {
                    "Type" => "Page", "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
                    "Contents" => contents,
                })
            })
            .collect();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Count" => pages.len() as i64,
                "Kids" => page_ids.iter().map(|id| Object::Reference(*id)).collect::<Vec<Object>>(),
            }),
        );
        let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => pages_id };
        if !outline.is_empty() {
            let root = document.new_object_id();
            let ids: Vec<ObjectId> = outline.iter().map(|_| document.new_object_id()).collect();
            // parent index per item, from levels
            let mut stack: Vec<usize> = Vec::new();
            let mut parent: Vec<Option<usize>> = Vec::new();
            for (i, (level, _, _)) in outline.iter().enumerate() {
                while stack.last().is_some_and(|&p| outline[p].0 >= *level) {
                    stack.pop();
                }
                parent.push(stack.last().copied());
                stack.push(i);
            }
            for (i, (_, title, page)) in outline.iter().enumerate() {
                // A page past the end points at an object that is not a page.
                let target = page_ids
                    .get(*page as usize - 1)
                    .copied()
                    .unwrap_or((9999, 0));
                let mut entry = dictionary! {
                    "Title" => Object::string_literal(*title),
                    "Parent" => parent[i].map_or(root, |p| ids[p]),
                    "Dest" => vec![Object::Reference(target), Object::Name(b"Fit".to_vec())],
                };
                let siblings: Vec<usize> = (0..outline.len())
                    .filter(|&j| parent[j] == parent[i])
                    .collect();
                let position = siblings.iter().position(|&j| j == i).unwrap();
                if let Some(next) = siblings.get(position + 1) {
                    entry.set("Next", ids[*next]);
                }
                let children: Vec<usize> = (0..outline.len())
                    .filter(|&j| parent[j] == Some(i))
                    .collect();
                if let (Some(first), Some(last)) = (children.first(), children.last()) {
                    entry.set("First", ids[*first]);
                    entry.set("Last", ids[*last]);
                }
                document.objects.insert(ids[i], entry.into());
            }
            let top: Vec<usize> = (0..outline.len())
                .filter(|&j| parent[j].is_none())
                .collect();
            document.objects.insert(
                root,
                dictionary! {
                    "Type" => "Outlines",
                    "First" => ids[top[0]], "Last" => ids[*top.last().unwrap()],
                    "Count" => outline.len() as i64,
                }
                .into(),
            );
            catalog.set("Outlines", root);
        }
        let catalog_id = document.add_object(catalog);
        document.trailer.set("Root", catalog_id);
        document
    }

    fn plain(count: usize) -> Vec<Vec<&'static str>> {
        vec![vec!["Body text of a page with enough words to count as text."]; count]
    }

    fn spans(chapters: &[Chapter]) -> Vec<(u32, u32)> {
        chapters
            .iter()
            .map(|c| (c.first_page, c.last_page))
            .collect()
    }

    fn found(document: &Document, total: u32) -> (Vec<(u32, u32)>, &'static str) {
        let (chapters, source) = detect_chapters(document, total, mostly_pictures(document));
        (spans(&chapters), source)
    }

    #[test]
    fn a_single_wrapper_bookmark_is_skipped() {
        let doc = book(
            &plain(20),
            &[],
            &[
                (1, "Whole Book", 1),
                (2, "One", 1),
                (2, "Two", 8),
                (2, "Three", 15),
            ],
        );
        let chapters = outline_chapters(&doc, 20);
        assert_eq!(spans(&chapters), vec![(1, 7), (8, 14), (15, 20)]);
        assert_eq!(chapters[1].title, "Two");
    }

    #[test]
    fn an_outline_with_only_a_second_level_still_works() {
        let doc = book(&plain(12), &[], &[(1, "Part", 1), (2, "A", 1), (2, "B", 6)]);
        assert_eq!(spans(&outline_chapters(&doc, 12)), vec![(1, 5), (6, 12)]);
    }

    #[test]
    fn unsorted_duplicate_and_out_of_range_destinations_are_cleaned() {
        let doc = book(
            &plain(10),
            &[],
            &[
                (1, "Late", 7),
                (1, "Early", 3),
                (1, "Same page again", 3),
                (1, "Nowhere", 99),
            ],
        );
        let chapters = outline_chapters(&doc, 10);
        assert_eq!(spans(&chapters), vec![(1, 2), (3, 6), (7, 10)]);
        assert_eq!(chapters[0].title, "Front pages");
        assert_eq!(chapters[1].title, "Early");
    }

    #[test]
    fn printed_page_numbers_in_titles_do_not_move_the_physical_start() {
        let doc = book(
            &plain(10),
            &[],
            &[
                (1, "Chapter 1 ... page 1", 4),
                (1, "Chapter 2 ... page 5", 8),
            ],
        );
        assert_eq!(
            spans(&outline_chapters(&doc, 10)),
            vec![(1, 3), (4, 7), (8, 10)]
        );
    }

    #[test]
    fn front_matter_and_the_last_page_are_covered() {
        let doc = book(&plain(9), &[], &[(1, "A", 3), (1, "B", 6)]);
        let chapters = outline_chapters(&doc, 9);
        assert_eq!(spans(&chapters), vec![(1, 2), (3, 5), (6, 9)]);
        let covered: u32 = chapters
            .iter()
            .map(|c| c.last_page - c.first_page + 1)
            .sum();
        assert_eq!(covered, 9);
    }

    #[test]
    fn a_book_starting_at_page_one_has_no_front_pages_entry() {
        let doc = book(&plain(6), &[], &[(1, "A", 1), (1, "B", 4)]);
        assert_eq!(spans(&outline_chapters(&doc, 6)), vec![(1, 3), (4, 6)]);
    }

    fn headed(
        pages: u32,
        starts: &[(u32, &'static str)],
        header: Option<&'static str>,
    ) -> Vec<Vec<&'static str>> {
        (1..=pages)
            .map(|p| {
                let mut lines = Vec::new();
                if let Some(h) = header {
                    lines.push(h);
                }
                if let Some((_, t)) = starts.iter().find(|(s, _)| *s == p) {
                    lines.push(*t);
                }
                lines.push("Body text of a page with enough words to count as text.");
                lines
            })
            .collect()
    }

    #[test]
    fn text_chapters_are_found_without_an_outline() {
        let doc = book(
            &headed(
                12,
                &[
                    (3, "Chapter 1"),
                    (7, "CHAPTER 2"),
                    (10, "Chapter 3: Weather"),
                ],
                None,
            ),
            &[],
            &[],
        );
        assert_eq!(
            found(&doc, 12),
            (vec![(1, 2), (3, 6), (7, 9), (10, 12)], "text")
        );
    }

    #[test]
    fn a_running_header_is_not_a_chapter_start() {
        // "Chapter 4 Weather" tops every page, only two pages hold real starts.
        let doc = book(
            &headed(
                10,
                &[(1, "Chapter 1"), (6, "Chapter 2")],
                Some("Pilot Handbook"),
            ),
            &[],
            &[],
        );
        assert_eq!(found(&doc, 10), (vec![(1, 5), (6, 10)], "text"));
        let only_header = book(&headed(10, &[], Some("Chapter 4 Weather")), &[], &[]);
        assert_eq!(found(&only_header, 10), (vec![(1, 10)], "chunks"));
    }

    #[test]
    fn a_repeated_chapter_number_on_following_pages_is_one_start() {
        let mut pages = headed(8, &[(1, "Chapter 1"), (5, "Chapter 2")], None);
        pages[1].insert(0, "Chapter 1");
        pages[2].insert(0, "Chapter 1");
        let doc = book(&pages, &[], &[]);
        assert_eq!(found(&doc, 8), (vec![(1, 4), (5, 8)], "text"));
    }

    #[test]
    fn chapter_in_the_middle_of_a_page_is_not_counted() {
        let mut pages = headed(10, &[(2, "Chapter 1"), (6, "Chapter 2")], None);
        pages[8] = vec!["a", "b", "c", "d", "see Chapter 3", "e"];
        pages[3] = vec!["As we said in Chapter 1 earlier", "x"];
        let doc = book(&pages, &[], &[]);
        assert_eq!(found(&doc, 10), (vec![(1, 1), (2, 5), (6, 10)], "text"));
    }

    #[test]
    fn a_pdf_without_text_falls_back_to_even_chunks() {
        let pages: Vec<Vec<&str>> = vec![vec![]; 70];
        let doc = book(&pages, &[], &[]);
        let (ranges, source) = found(&doc, 70);
        assert_eq!(source, "chunks");
        assert_eq!(ranges, vec![(1, 24), (25, 48), (49, 70)]);
        assert_eq!(
            found(&book(&vec![vec![]; 20], &[], &[]), 20),
            (vec![(1, 20)], "chunks")
        );
        assert_eq!(
            found(&book(&vec![vec![]; 61], &[], &[]), 61).0,
            vec![(1, 21), (22, 42), (43, 61)]
        );
    }

    #[test]
    fn one_chapter_start_alone_is_not_enough() {
        let doc = book(&headed(40, &[(5, "Chapter 1")], None), &[], &[]);
        assert_eq!(found(&doc, 40), (vec![(1, 20), (21, 40)], "chunks"));
    }

    #[test]
    fn the_outline_wins_over_text() {
        let doc = book(
            &headed(10, &[(2, "Chapter 1"), (4, "Chapter 2")], None),
            &[],
            &[(1, "A", 1), (1, "B", 5)],
        );
        assert_eq!(found(&doc, 10), (vec![(1, 4), (5, 10)], "outline"));
    }

    /// A book whose pages carry chapter page numbers ("2-3") as their first
    /// line, like the FAA handbooks, after `front` unnumbered pages.
    fn numbered(front: usize, chapters: &[(&str, u32)]) -> Vec<Vec<String>> {
        let mut pages: Vec<Vec<String>> = (0..front)
            .map(|_| vec!["Front matter words on a page.".to_string()])
            .collect();
        for (label, count) in chapters {
            for k in 1..=*count {
                pages.push(vec![
                    format!("{label}-{k}"),
                    "Introduction".to_string(),
                    "Body text of a page with enough words to count as text.".to_string(),
                ]);
            }
        }
        pages
    }

    fn as_refs(pages: &[Vec<String>]) -> Vec<Vec<&str>> {
        pages
            .iter()
            .map(|p| p.iter().map(String::as_str).collect())
            .collect()
    }

    #[test]
    fn an_outline_made_from_page_text_is_not_used() {
        // Like the real PHAK: wrapper bookmarks, then a "level" whose entries
        // are figure captions, map labels and paragraphs, nearly one a page.
        // (Bookmark titles are distinct: the outline reader keeps one per title.)
        let junk: Vec<String> = (1..=12u32)
            .map(|page| match page % 4 {
                0 => format!("15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 11 Rock Springs {page} Salt Lake City"),
                1 => format!("Figure 1-{page}.  Standard airway beacon installation. D-KC"),
                2 => format!("SubchaptersVolumeChapterTitleCode of Federal Regulations12345{page}"),
                _ => format!("The Aeronautical Information Manual is designed to provide the aviation community with basic flight information {page}"),
            })
            .collect();
        let mut outline = vec![(1, "Document", 12), (2, "Article", 12)];
        for (page, title) in (1..=12u32).zip(&junk) {
            outline.push((3, title.as_str(), page));
        }
        let doc = book(&plain(12), &[], &outline);
        assert!(outline_chapters(&doc, 12).is_empty());
        let (chapters, source) = detect_chapters(&doc, 12, false);
        assert_eq!(source, "chunks");
        assert_eq!(spans(&chapters), vec![(1, 12)]);
        assert!(chapters.iter().all(|c| !c.title.contains("Rock Springs")));
    }

    #[test]
    fn an_outline_with_thousands_of_entries_is_not_used() {
        // Two clean top-level entries, but 52 bookmarks for 10 pages.
        let paragraphs: Vec<String> = (0..50).map(|i| format!("Paragraph {i}")).collect();
        let mut outline: Vec<(usize, &str, u32)> = vec![(1, "One", 1)];
        outline.extend(paragraphs[..25].iter().map(|t| (2, t.as_str(), 1)));
        outline.push((1, "Two", 5));
        outline.extend(paragraphs[25..].iter().map(|t| (2, t.as_str(), 5)));
        let doc = book(&plain(10), &[], &outline);
        assert!(outline_chapters(&doc, 10).is_empty());
    }

    #[test]
    fn one_messy_outline_title_is_named_by_its_pages() {
        let doc = book(
            &plain(30),
            &[],
            &[
                (1, "Weather Theory", 1),
                (1, "1051209075 0.1600.150", 11),
                (1, "Navigation", 21),
            ],
        );
        let titles: Vec<String> = outline_chapters(&doc, 30)
            .into_iter()
            .map(|c| c.title)
            .collect();
        assert_eq!(
            titles,
            vec!["Weather Theory", "Pages 11\u{2013}20", "Navigation"]
        );
    }

    #[test]
    fn chapter_page_numbers_find_the_chapters() {
        let mut pages = numbered(3, &[("1", 4), ("2", 3), ("3", 5), ("A", 2), ("I", 2)]);
        // The index's first page says what it is.
        pages[3 + 4 + 3 + 5 + 2].insert(1, "Index".to_string());
        // A contents page lists chapter starts mid-page and ends with "I-1".
        pages[1] = vec![
            "Contents".into(),
            "Chapter 3 ....".into(),
            "3-1".into(),
            "Index ....".into(),
            "I-1".into(),
        ];
        let doc = book(&as_refs(&pages), &[], &[]);
        let (chapters, source) = detect_chapters(&doc, pages.len() as u32, false);
        assert_eq!(source, "text");
        assert_eq!(
            spans(&chapters),
            vec![(1, 3), (4, 7), (8, 10), (11, 15), (16, 17), (18, 19)]
        );
        let titles: Vec<&str> = chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(
            titles,
            vec![
                "Front pages",
                "Chapter 1",
                "Chapter 2",
                "Chapter 3",
                "Pages 16\u{2013}17",
                "Index"
            ]
        );
    }

    #[test]
    fn a_later_page_number_is_not_read_as_a_chapter_start() {
        // "1-10" and "1-11" must not count as "1-1"; only real "N-1" pages.
        let pages = numbered(0, &[("1", 12), ("2", 12)]);
        let doc = book(&as_refs(&pages), &[], &[]);
        assert_eq!(found(&doc, 24), (vec![(1, 12), (13, 24)], "text"));
    }

    #[test]
    fn text_titles_are_never_page_text() {
        let doc = book(
            &headed(
                12,
                &[
                    (1, "Chapter 7IntroductionThis chapter covers the primary systems found on most aircraft."),
                    (5, "Chapter 8 In order to safely fly any aircraft, a pilot must understand. The rest"),
                    (9, "Chapter 9: Weather Theory"),
                ],
                None,
            ),
            &[],
            &[],
        );
        let titles: Vec<String> = detect_chapters(&doc, 12, false)
            .0
            .into_iter()
            .map(|c| c.title)
            .collect();
        assert_eq!(
            titles,
            vec!["Chapter 7", "Chapter 8", "Chapter 9: Weather Theory"]
        );
    }

    // ---- real chapter names, AFH name cleanup, progress ----

    #[test]
    fn heading_is_the_title_lines_set_apart_from_the_body() {
        // Normal: the big title lines come after the body, beside a lone "Chapter 5".
        let text = "5-1\nIntroduction\nThrust, drag, lift and weight act on all aircraft.  \n\
                    opposes the downward force of weight.\nAerodynamics  \nof Flight\nChapter 5\n";
        assert_eq!(
            chapter_heading(text, "5").as_deref(),
            Some("Aerodynamics of Flight")
        );
        // Glued: the name is the line above "Chapter 7Introduction...".
        let glued = "7-1\nAircraft Systems\nChapter 7IntroductionThis chapter covers the engine.\n";
        assert_eq!(
            chapter_heading(glued, "7").as_deref(),
            Some("Aircraft Systems")
        );
        // Split around the number.
        let split =
            "8-1\nIntroductionIn order to fly, a pilot must read.\nFlightChapter 8 Instruments\n";
        assert_eq!(
            chapter_heading(split, "8").as_deref(),
            Some("Flight Instruments")
        );
    }

    #[test]
    fn heading_is_missing_or_rejected_rather_than_guessed() {
        // No "Chapter N" line at all.
        assert_eq!(
            chapter_heading("3-1\nIntroduction\nSome words here.\n", "3"),
            None
        );
        // Body text before "Chapter 4" that is not a sentence end: not a title.
        let body = "4-1\nThis chapter examines the fundamental physical laws governing the forces\nChapter 4\n";
        assert_eq!(chapter_heading(body, "4"), None);
        // A sentence before it is never taken.
        let sentence = "6-1\nThe pilot reads the manual.\nChapter 6\n";
        assert_eq!(chapter_heading(sentence, "6"), None);
        // A section label alone is not a name.
        assert_eq!(chapter_heading("9-1\nIntroduction\nChapter 9\n", "9"), None);
        // A cross-reference in the body is not the chapter marker.
        assert_eq!(chapter_heading("2-1\nSee Chapter 2 for more.\n", "2"), None);
    }

    #[test]
    fn text_chapters_get_real_names_from_their_first_pages() {
        let pages: Vec<Vec<String>> = (1..=12)
            .map(|page| {
                let (chapter, within) = if page <= 6 { (1, page) } else { (2, page - 6) };
                let mut lines = vec![format!("{chapter}-{within}")];
                if within == 1 {
                    lines.push("Body of the introduction ends here.".into());
                    lines.push(if chapter == 1 {
                        "Basic Flying".into()
                    } else {
                        "Weather".into()
                    });
                    lines.push(format!("Chapter {chapter}"));
                } else {
                    lines.push("Body text of a page with enough words to count as text.".into());
                }
                lines
            })
            .collect();
        let refs: Vec<Vec<&str>> = pages
            .iter()
            .map(|p| p.iter().map(String::as_str).collect())
            .collect();
        let doc = book(&refs, &[], &[]);
        let (chapters, source) = detect_chapters(&doc, 12, false);
        assert_eq!(source, "text");
        let titles: Vec<&str> = chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["Chapter 1: Basic Flying", "Chapter 2: Weather"]
        );
    }

    #[test]
    fn afh_outline_names_lose_the_file_name_dressing() {
        for (raw, wanted) in [
            ("02 - AFH Chapter 1 (Draft 4)", "Chapter 1"),
            ("19 - AFH Chapter 18 (Draft 3)", "Chapter 18"),
            ("20 - AFH Glossary (Draft 4)", "Glossary"),
            ("21 - AFH Index (Draft 5)", "Index"),
            ("01.1 - AFH Front Matter (Draft 3)", "Front Matter"),
            ("1 Introduction", "1 Introduction"),
            ("Chapter 3 (Draft)", "Chapter 3 (Draft)"),
            ("Ground - Handling", "Ground - Handling"),
        ] {
            assert_eq!(tidy_outline_title(raw), wanted, "{raw}");
        }
        let doc = book(
            &plain(10),
            &[],
            &[
                (1, "02 - AFH Chapter 1 (Draft 4)", 1),
                (1, "03 - AFH Chapter 2 (Draft 2)", 5),
            ],
        );
        let titles: Vec<String> = outline_chapters(&doc, 10)
            .into_iter()
            .map(|c| c.title)
            .collect();
        assert_eq!(titles, vec!["Chapter 1", "Chapter 2"]);
    }

    // ---- splitting ranges ----

    fn library(label: &str, document: &mut Document) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "her-flight-deck-chapters-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let documents_dir = root.join(documents::DOCUMENTS_DIR);
        std::fs::create_dir_all(&documents_dir).unwrap();
        document.save(documents_dir.join("R-handbook.pdf")).unwrap();
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        for migration in crate::migrations() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute(
            "INSERT INTO study_materials (id, title, file_path, original_file_name, file_size,
               created_at, updated_at)
             VALUES ('R', 'Handbook', 'R-handbook.pdf', 'Handbook.pdf', 1,
               '2026-10-08T12:00:00.000Z', '2026-10-08T12:00:00.000Z')",
            [],
        )
        .unwrap();
        root
    }

    fn range(first_page: u32, last_page: u32, title: &str) -> PageRangeRequest {
        PageRangeRequest {
            first_page,
            last_page,
            title: title.into(),
        }
    }

    fn files_in(root: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(root.join("documents"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn receipts(root: &Path) -> i64 {
        rusqlite::Connection::open(root.join("her-flight-deck.db"))
            .unwrap()
            .query_row("SELECT COUNT(*) FROM split_operation_log", [], |r| r.get(0))
            .unwrap()
    }

    fn split(
        root: &Path,
        ranges: &[PageRangeRequest],
        limits: (u32, &dyn Fn(u64) -> bool),
    ) -> Result<SplitSourceReceipt, String> {
        split_ranges_with_limits(
            root,
            ("R", "R-handbook.pdf", "batch", "Handbook.pdf"),
            ranges,
            limits,
        )
    }

    #[test]
    fn chapters_save_as_parts_of_one_receipt_and_keep_the_original() {
        let mut doc = book(&plain(12), &[], &[]);
        let root = library("one", &mut doc);
        let receipt = split(
            &root,
            &[range(5, 12, "Two"), range(1, 4, "One")],
            (150, &|_| true),
        )
        .unwrap();
        let plan: Vec<_> = receipt
            .core
            .plan
            .iter()
            .map(|p| {
                (
                    p.selection.start,
                    p.selection.end,
                    p.canonical_root_start,
                    p.canonical_root_end,
                    p.child_page_count,
                )
            })
            .collect();
        assert_eq!(plan, vec![(1, 4, 1, 4, 4), (5, 12, 5, 12, 8)]);
        assert_eq!(receipt.core.source_total_pages, 12);
        assert!(receipt.core.skipped_pages.is_empty());
        assert_eq!(receipts(&root), 1);
        assert_eq!(files_in(&root).len(), 3);
        assert!(files_in(&root).contains(&"R-handbook.pdf".to_string()));
        for part in &receipt.core.plan {
            let child = Document::load(root.join("documents").join(&part.file_path)).unwrap();
            assert_eq!(child.get_pages().len() as u32, part.child_page_count);
        }
        assert!(receipt.core.plan[1].original_file_name.contains("Two"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn saving_says_which_chapter_it_is_on() {
        let mut doc = book(&plain(12), &[], &[]);
        let root = library("progress", &mut doc);
        let said = std::cell::RefCell::new(Vec::new());
        split_ranges_inner(
            &root,
            ("R", "R-handbook.pdf", "batch", "Handbook.pdf"),
            &[range(1, 4, "One"), range(5, 12, "Two")],
            (150, &|_| true),
            &|message| said.borrow_mut().push(message),
        )
        .unwrap();
        assert_eq!(
            said.into_inner(),
            vec![
                "Saving chapter 1 of 2\u{2026}",
                "Saving chapter 2 of 2\u{2026}"
            ]
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn bad_ranges_are_refused_and_leave_nothing() {
        let mut doc = book(&plain(10), &[], &[]);
        let root = library("bad", &mut doc);
        let before = files_in(&root);
        let all: &dyn Fn(u64) -> bool = &|_| true;
        for (ranges, wanted) in [
            (vec![range(1, 5, "a"), range(5, 8, "b")], "overlap"),
            (vec![range(1, 5, "a"), range(3, 4, "b")], "overlap"),
            (vec![range(6, 4, "a")], "cannot come before"),
            (vec![range(0, 4, "a")], "not a valid range"),
            (vec![range(8, 11, "a")], "past the end"),
            (vec![], "at least one"),
        ] {
            let error = split(&root, &ranges, (150, all)).unwrap_err();
            assert!(error.contains(wanted), "{error}");
        }
        assert_eq!(files_in(&root), before);
        assert_eq!(receipts(&root), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_chapter_over_the_page_limit_is_subdivided_without_losing_pages() {
        let mut doc = book(&plain(23), &[], &[]);
        let root = library("pages", &mut doc);
        let receipt = split(
            &root,
            &[range(1, 3, "Short"), range(4, 23, "Long")],
            (6, &|_| true),
        )
        .unwrap();
        let plan: Vec<_> = receipt
            .core
            .plan
            .iter()
            .map(|p| (p.selection.start, p.selection.end))
            .collect();
        assert_eq!(plan, vec![(1, 3), (4, 8), (9, 13), (14, 18), (19, 23)]);
        assert!(plan.iter().all(|(a, b)| b - a < 6));
        assert!(receipt.core.plan[1]
            .original_file_name
            .contains("Long (pages 4\u{2013}8)"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_chapter_over_the_size_limit_is_subdivided() {
        // Pages 3 and 4 are big; the limit lets one big page through, not two.
        let mut doc = book(&plain(6), &[(3, 9000), (4, 9000)], &[]);
        let root = library("size", &mut doc);
        let limit = 12_000;
        let receipt = split(&root, &[range(1, 6, "Everything")], (150, &|b| b <= limit)).unwrap();
        let plan: Vec<_> = receipt
            .core
            .plan
            .iter()
            .map(|p| (p.selection.start, p.selection.end))
            .collect();
        assert!(plan.len() >= 2);
        assert_eq!(plan[0].0, 1);
        assert_eq!(plan.last().unwrap().1, 6);
        for pair in plan.windows(2) {
            assert_eq!(pair[1].0, pair[0].1 + 1);
        }
        for part in &receipt.core.plan {
            assert!(part.file_size <= limit, "{} bytes", part.file_size);
            assert_eq!(part.canonical_root_start, part.selection.start);
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_single_page_over_the_limit_is_refused_by_number_and_nothing_is_split() {
        let mut doc = book(&plain(6), &[(5, 30_000)], &[]);
        let root = library("oversize", &mut doc);
        let before = files_in(&root);
        let error = split(
            &root,
            &[range(1, 3, "Fine"), range(4, 6, "Heavy")],
            (150, &|b| b <= 15_000),
        )
        .unwrap_err();
        assert!(error.contains("Page 5 is too large"), "{error}");
        // The first chapter was already written when the second failed.
        assert_eq!(files_in(&root), before);
        assert_eq!(receipts(&root), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_receipt_failure_removes_only_this_operations_files() {
        let mut doc = book(&plain(8), &[], &[]);
        let root = library("receipt", &mut doc);
        std::fs::write(root.join("documents/other-keep.pdf"), b"keep me").unwrap();
        let before = files_in(&root);
        let error = split_ranges_with_limits(
            &root,
            ("NOT-A-MATERIAL", "R-handbook.pdf", "batch", "Handbook.pdf"),
            &[range(1, 4, "a"), range(5, 8, "b")],
            (150, &|_| true),
        )
        .unwrap_err();
        assert!(error.contains("no longer in the library"), "{error}");
        assert_eq!(files_in(&root), before);
        assert_eq!(receipts(&root), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_failed_rollback_says_to_restart_and_records_nothing() {
        let mut doc = book(&plain(8), &[], &[]);
        let root = library("rollback", &mut doc);
        crate::pdf::FAIL_SPLIT_REMOVE.with(|f| f.set(true));
        let error = split_ranges_with_limits(
            &root,
            ("NOT-A-MATERIAL", "R-handbook.pdf", "batch", "Handbook.pdf"),
            &[range(1, 4, "a"), range(5, 8, "b")],
            (150, &|_| true),
        )
        .unwrap_err();
        crate::pdf::FAIL_SPLIT_REMOVE.with(|f| f.set(false));
        assert!(error.contains("restart the app"), "{error}");
        assert!(error.contains("no longer in the library"), "{error}");
        assert_eq!(receipts(&root), 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_part_over_claudes_limit_stays_whole_for_gemini() {
        use crate::provider::{save_choice, AnyProvider, ProviderId};
        // Between Claude's request limit and Gemini's PDF limit.
        let size = 40 * 1024 * 1024;
        let root = std::env::temp_dir().join(format!("fits-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        save_choice(&root, ProviderId::Claude).unwrap();
        assert!(!fits_provider(AnyProvider::selected(&root), size));
        save_choice(&root, ProviderId::Gemini).unwrap();
        assert!(fits_provider(AnyProvider::selected(&root), size));
        assert!(!fits_provider(
            AnyProvider::selected(&root),
            crate::pdf::MAX_PDF_BYTES + 1
        ));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_selected_providers_limit_decides_whether_a_part_is_subdivided() {
        let mut doc = book(&plain(6), &[(5, 30_000)], &[]);
        let root = library("provider-limit", &mut doc);
        let claude_like = |b: u64| b <= 15_000;
        let gemini_like = |_: u64| true;
        let refused = split(&root, &[range(1, 6, "All")], (150, &claude_like)).unwrap_err();
        assert!(refused.contains("too large"), "{refused}");
        let whole = split(&root, &[range(1, 6, "All")], (150, &gemini_like)).unwrap();
        assert_eq!(whole.core.plan.len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn saved_children_map_back_to_the_original_pages() {
        let mut doc = book(&plain(9), &[], &[]);
        let root = library("lineage", &mut doc);
        let receipt = split(&root, &[range(4, 9, "Back")], (150, &|_| true)).unwrap();
        let presentation: Vec<_> = receipt
            .core
            .plan
            .iter()
            .map(|p| lineage::SplitPartPresentation {
                id: p.id.clone(),
                title: "Back".into(),
                notes: String::new(),
            })
            .collect();
        lineage::save_split_batch_at(&root, &receipt, &presentation).unwrap();
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        let row: (u32, u32, u32, String) = conn
            .query_row(
                "SELECT source_page_start, source_page_end, child_page_count, root_material_id
                   FROM material_split_lineage WHERE material_id = 'batch-part-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(row, (4, 9, 6, "R".to_string()));
        let _ = std::fs::remove_dir_all(root);
    }
}
