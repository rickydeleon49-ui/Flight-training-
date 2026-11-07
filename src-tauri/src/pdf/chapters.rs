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

/// Turn sorted, distinct chapter starts into ranges that cover every page.
/// Pages before the first start become a leading "Front pages" entry.
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
        chapters.push(Chapter {
            title: title.trim().to_string(),
            first_page: *page,
            last_page: starts.get(i + 1).map_or(total, |(next, _)| next - 1),
        });
    }
    chapters
}

/// Chapters from the outline: the shallowest level with at least two distinct
/// chapter starts (a lone wrapper bookmark is skipped).
pub(crate) fn outline_chapters(document: &Document, total: u32) -> Vec<Chapter> {
    for entries in outline_levels(document, total).into_values() {
        let mut by_page: BTreeMap<u32, String> = BTreeMap::new();
        for (page, title) in entries {
            by_page.entry(page).or_insert(title);
        }
        if by_page.len() >= 2 {
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
/// numeral as its own word). Digits may run straight into the next text.
fn chapter_number(line: &str) -> Option<String> {
    let head = line.get(..8)?;
    if !head.eq_ignore_ascii_case("chapter ") {
        return None;
    }
    let rest = line[8..].trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if !digits.is_empty() {
        return Some(digits);
    }
    let word = rest
        .split(|c: char| !c.is_alphanumeric())
        .next()
        .unwrap_or("");
    let roman = !word.is_empty() && word.len() <= 6 && word.chars().all(|c| "IVXLivxl".contains(c));
    roman.then(|| word.to_ascii_uppercase())
}

/// Chapter starts read from page text: "Chapter N" in the first lines of a
/// page. A line repeated at the top of most pages is a running header, not a
/// start, and the same chapter number twice in a row is a header too.
fn text_starts(document: &Document, total: u32) -> Vec<(u32, String)> {
    let tops: Vec<(u32, Vec<String>)> = (1..=total)
        .map(|page| {
            (
                page,
                top_lines(&document.extract_text(&[page]).unwrap_or_default()),
            )
        })
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
            .find_map(|l| chapter_number(l).map(|n| (n, l.clone())));
        if let Some((number, line)) = found {
            if last_number.as_ref() != Some(&number) {
                last_number = Some(number);
                starts.push((page, line));
            }
        }
    }
    starts
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

#[doc(hidden)]
pub fn split_ranges_at(
    root: &Path,
    source_material_id: &str,
    relative_path: &str,
    batch_id: &str,
    file_name: &str,
    ranges: &[PageRangeRequest],
) -> Result<SplitSourceReceipt, String> {
    let provider = crate::provider::AnyProvider::selected(root);
    split_ranges_with_limits(
        root,
        (source_material_id, relative_path, batch_id, file_name),
        ranges,
        (KIT_PAGE_LIMIT.min(MAX_PAGES), &|bytes| {
            fits_provider(provider, bytes)
        }),
    )
}

fn split_ranges_with_limits(
    root: &Path,
    (source_material_id, relative_path, batch_id, file_name): (&str, &str, &str, &str),
    ranges: &[PageRangeRequest],
    limits: (u32, &dyn Fn(u64) -> bool),
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
        for range in &ranges {
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
