//! Turning an oversized study PDF into study-sized parts.
//!
//! Google reads a PDF up to 50 MB or 1,000 pages, whichever comes first, and
//! an FAA handbook is comfortably past both. That limit is Google's and the
//! same however the file is sent, so the way through it is not a bigger
//! request — it is a smaller document.
//!
//! Splitting happens on her own machine: the pages she asks for are copied
//! into a new file in the same private storage as everything else, and the
//! original is left exactly as it was.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::documents::{self, ImportedDocument};

#[derive(Clone, Serialize)]
struct SplitProgress {
    message: String,
}

const SPLIT_PROGRESS_EVENT: &str = "pdf-split-progress";

/// Say which part is being read or has just been written.
///
/// Progress is a courtesy, exactly like Gemini's — a window that will not
/// take the event changes nothing about whether the split finishes.
fn say(app: &AppHandle, message: String) {
    let _ = app.emit(SPLIT_PROGRESS_EVENT, SplitProgress { message });
}

/// The most pages one split may carry.
///
/// Google reads 1,000 pages at a time, so a wider range would produce a file
/// it still refuses — and she would have done the work for nothing.
pub(crate) const MAX_PAGES: u32 = 1_000;
pub(crate) const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024;

/// What a stored PDF holds, so a page range can be asked for sensibly.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutline {
    pub pages: u32,
    /// The most pages one split may take, so the interface can say so.
    pub max_pages_per_split: u32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPart {
    pub relative_path: String,
    pub original_file_name: String,
    pub file_size: u64,
    pub first_page: u32,
    pub last_page: u32,
}

fn open_pdf(path: &Path) -> Result<Document, String> {
    Document::load(path).map_err(|e| {
        format!(
            "That PDF could not be read: {e}. If it opens in a PDF viewer, try saving a fresh \
             copy from there and adding that instead."
        )
    })
}

/// How many pages a stored PDF has.
fn page_count(path: &Path) -> Result<u32, String> {
    let document = open_pdf(path)?;
    let pages = u32::try_from(document.get_pages().len()).unwrap_or(u32::MAX);
    if pages == 0 {
        return Err("That PDF has no pages this application can read.".to_string());
    }
    Ok(pages)
}

/// Copy pages `first..=last` of `source` into a new PDF at `destination`.
///
/// Returns how many pages were written. The source is only ever read.
fn write_page_range(
    source: &Path,
    destination: &Path,
    first: u32,
    last: u32,
) -> Result<u32, String> {
    if first == 0 {
        return Err("Pages are numbered from 1.".to_string());
    }
    if last < first {
        return Err("The last page comes before the first one.".to_string());
    }
    let wanted = last - first + 1;
    if wanted > MAX_PAGES {
        return Err(format!(
            "That is {wanted} pages. Google reads {MAX_PAGES} at a time, so choose a smaller \
             range — a chapter makes a better study aid than a whole book anyway."
        ));
    }

    let document = open_pdf(source)?;
    write_page_range_from_document(&document, destination, first, last)
}

fn write_page_range_from_document(
    source: &Document,
    destination: &Path,
    first: u32,
    last: u32,
) -> Result<u32, String> {
    let mut document = source.clone();
    let numbers: Vec<u32> = document.get_pages().into_keys().collect();
    let total = u32::try_from(numbers.len()).unwrap_or(u32::MAX);
    if first > total {
        return Err(format!(
            "This PDF has {total} pages, so there is no page {first}."
        ));
    }
    if last > total {
        return Err(format!(
            "This PDF has {total} pages, so there is no page {last}."
        ));
    }

    // Everything outside the range goes; what is left is her chapter.
    let removing: Vec<u32> = numbers
        .iter()
        .copied()
        .filter(|number| *number < first || *number > last)
        .collect();
    let kept = total - u32::try_from(removing.len()).unwrap_or(0);
    delete_pages_batch(&mut document, &removing);

    // Deleting pages leaves their content, fonts and images behind as
    // unreferenced objects. Without this the "chapter" is very nearly the
    // size of the book it came from, which is the whole problem again.
    document.prune_objects();
    document.compress();

    document
        .save(destination)
        .map_err(|e| format!("Could not save the split PDF: {e}"))?;

    Ok(kept)
}

/// Binary-search the largest page range starting at `first` that still fits
/// `max_bytes`, trying at most `max_pages` pages.
///
/// `render_candidate` hands back the *actual bytes* a given last page would
/// produce, not just their count — the winning candidate's bytes are kept
/// from whichever trial found them, so the caller never has to render the
/// same range twice to get hold of what it already measured.
fn largest_fitting_last_page<F>(
    first: u32,
    total: u32,
    max_pages: u32,
    max_bytes: u64,
    mut render_candidate: F,
) -> Result<(u32, Vec<u8>), String>
where
    F: FnMut(u32) -> Result<Vec<u8>, String>,
{
    let mut low = first;
    let mut high = total.min(first.saturating_add(max_pages - 1));
    let mut best: Option<(u32, Vec<u8>)> = None;

    while low <= high {
        let middle = low + (high - low) / 2;
        let bytes = render_candidate(middle)?;
        if bytes.len() as u64 <= max_bytes {
            low = middle.saturating_add(1);
            best = Some((middle, bytes));
        } else if middle == first {
            break;
        } else {
            high = middle - 1;
        }
    }

    best.ok_or_else(|| {
        format!("Page {first} is larger than 50 MB by itself. Compress that PDF and try again.")
    })
}

/// Copy of `source` holding only pages `first..=high`, pruned and compressed
/// once — the bounded base every candidate inside one part is trimmed from,
/// instead of each candidate re-cloning and re-compressing the *entire*
/// remaining book. For a book far longer than one part's page limit, this is
/// the difference between paying that cost once per part and paying it once
/// per binary-search step per part.
///
/// `prune_objects` does a fresh reachability sweep from the current page
/// tree every time it runs (see `lopdf`'s `processor.rs`), and `compress`
/// only rewrites each stream object's own bytes — neither depends on how
/// many *other* objects exist, so trimming a document in two stages (once to
/// this window, later further within it) produces exactly the same kept
/// objects and bytes as trimming directly to the final range in one stage.
fn window_document(source: &Document, first: u32, high: u32, total: u32) -> Document {
    let mut window = source.clone();
    let outside: Vec<u32> = (1..=total)
        .filter(|page| *page < first || *page > high)
        .collect();
    delete_pages_batch(&mut window, &outside);
    window.prune_objects();
    window.compress();
    window
}

/// Render pages `first..=last` of an already-windowed document to bytes, in
/// memory — nothing touches disk until the caller has the winning candidate.
///
/// `window`'s own page numbering restarts at 1 (lopdf numbers a document's
/// pages by tree order, not by any number carried over from where it was cut
/// from), so `first` here is relative to the window, not the original book.
fn render_window_range(window: &Document, first: u32, last: u32) -> Result<Vec<u8>, String> {
    let mut candidate = window.clone();
    let total = u32::try_from(candidate.get_pages().len()).unwrap_or(u32::MAX);
    let outside: Vec<u32> = (1..=total)
        .filter(|page| *page < first || *page > last)
        .collect();
    delete_pages_batch(&mut candidate, &outside);
    candidate.prune_objects();

    let mut bytes = Vec::new();
    candidate
        .save_to(&mut bytes)
        .map_err(|e| format!("Could not save the split PDF: {e}"))?;
    Ok(bytes)
}

/// Remove all unwanted page references in one pass. `lopdf::delete_pages`
/// traverses the entire object graph for *each* removed page; on a long book
/// that makes splitting quadratic even before any candidate is rendered.
/// Keep its page-tree Count updates and reference cleanup, but batch both.
fn delete_pages_batch(document: &mut Document, page_numbers: &[u32]) {
    let pages = document.get_pages();
    let removed: HashSet<ObjectId> = page_numbers
        .iter()
        .filter_map(|number| pages.get(number).copied())
        .collect();
    if removed.is_empty() {
        return;
    }

    let mut decrements: HashMap<ObjectId, i64> = HashMap::new();
    for page_id in &removed {
        let mut parent = document
            .get_dictionary(*page_id)
            .ok()
            .and_then(|page| page.get(b"Parent").ok())
            .and_then(|value| value.as_reference().ok());
        let mut visited = HashSet::new();
        while let Some(id) = parent {
            if !visited.insert(id) {
                break;
            }
            *decrements.entry(id).or_default() += 1;
            parent = document
                .get_dictionary(id)
                .ok()
                .and_then(|tree| tree.get(b"Parent").ok())
                .and_then(|value| value.as_reference().ok());
        }
    }
    for (id, decrement) in decrements {
        if let Some(Ok(tree)) = document.objects.get_mut(&id).map(Object::as_dict_mut) {
            if let Ok(count) = tree.get(b"Count").and_then(Object::as_i64) {
                tree.set("Count", count - decrement);
            }
        }
    }

    strip_references_from_dictionary(&mut document.trailer, &removed);
    for object in document.objects.values_mut() {
        strip_references(object, &removed);
    }
    document.objects.retain(|id, _| !removed.contains(id));
}

fn strip_references_from_dictionary(dictionary: &mut Dictionary, removed: &HashSet<ObjectId>) {
    let keys: Vec<Vec<u8>> = dictionary
        .iter()
        .filter_map(|(key, value)| match value {
            Object::Reference(id) if removed.contains(id) => Some(key.clone()),
            _ => None,
        })
        .collect();
    for key in keys {
        dictionary.remove(&key);
    }
    for (_, value) in dictionary.iter_mut() {
        strip_references(value, removed);
    }
}

fn strip_references(object: &mut Object, removed: &HashSet<ObjectId>) {
    match object {
        Object::Array(items) => {
            items.retain(|item| !matches!(item, Object::Reference(id) if removed.contains(id)));
            for item in items {
                strip_references(item, removed);
            }
        }
        Object::Dictionary(dictionary) => strip_references_from_dictionary(dictionary, removed),
        Object::Stream(stream) => strip_references_from_dictionary(&mut stream.dict, removed),
        _ => {}
    }
}

/// How many pages a stored PDF has, counted away from the interface thread.
///
/// Also used before a document is sent to Google, which reads 1,000 pages at
/// a time: see `MAX_PAGES` and `gemini`.
// Parsing a large handbook takes a moment; the window must stay alive.
pub(crate) async fn count_pages(path: PathBuf) -> Result<u32, String> {
    run_off_thread(move || page_count(&path)).await
}

/// Read a stored PDF's shape, so a page range can be asked for.
#[tauri::command]
pub async fn inspect_pdf(app: AppHandle, relative_path: String) -> Result<PdfOutline, String> {
    let path = documents::stored_document_path(&app, &relative_path)?;
    let pages = count_pages(path).await?;
    Ok(PdfOutline {
        pages,
        max_pages_per_split: MAX_PAGES,
    })
}

/// Save a page range from a stored PDF as a study document of its own.
///
/// `material_id` is the id of the material the new file will belong to, so
/// the stored name cannot collide with anything already in the library.
#[tauri::command]
pub async fn split_pdf(
    app: AppHandle,
    relative_path: String,
    material_id: String,
    first_page: u32,
    last_page: u32,
    file_name: String,
) -> Result<ImportedDocument, String> {
    let source = documents::stored_document_path(&app, &relative_path)?;
    let original_file_name = pdf_file_name(&file_name);
    let (destination, stored_name) =
        documents::stored_destination(&app, &material_id, &original_file_name)?;

    let written = destination.clone();
    if let Err(error) =
        run_off_thread(move || write_page_range(&source, &written, first_page, last_page)).await
    {
        let _ = std::fs::remove_file(&destination);
        return Err(error);
    }

    let file_size = match std::fs::metadata(&destination) {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            let _ = std::fs::remove_file(&destination);
            return Err(format!("The split PDF could not be read back: {error}"));
        }
    };
    enforce_pdf_size_limit(&destination, file_size)?;

    Ok(ImportedDocument {
        relative_path: stored_name,
        original_file_name,
        file_size,
    })
}

/// Refuse a split result over Google's PDF limit, against a plain path and
/// size so this can be tested without a full split.
///
/// The page-count check inside `write_page_range` only rules out what
/// Google would refuse on page count alone; a chosen range can still land
/// over the byte limit on an illustrated handbook. Nothing about a chapter
/// this size can be studied with Gemini, so it is refused here — removing
/// the oversized file so a rejected range never lingers as a stored document
/// nothing points at — rather than saved and only discovered unusable later.
fn enforce_pdf_size_limit(destination: &Path, file_size: u64) -> Result<(), String> {
    if file_size <= MAX_PDF_BYTES {
        return Ok(());
    }
    let _ = std::fs::remove_file(destination);
    Err(format!(
        "That range came out to {}, over the {} limit Google reads. Choose a smaller page range.",
        crate::gemini::describe_size(file_size),
        crate::gemini::describe_size(MAX_PDF_BYTES),
    ))
}

/// Split a stored PDF into consecutive parts that Google can read.
///
/// The original is read only. All output files are removed if any part fails,
/// so the library can never be left with half of an automatic split.
#[tauri::command]
pub async fn split_pdf_automatically(
    app: AppHandle,
    relative_path: String,
    batch_id: String,
    file_name: String,
) -> Result<Vec<PdfPart>, String> {
    let source = documents::stored_document_path(&app, &relative_path)?;
    run_off_thread(move || {
        let document = open_pdf(&source)?;
        let total = u32::try_from(document.get_pages().len()).unwrap_or(u32::MAX);
        if total == 0 {
            return Err("That PDF has no pages this application can read.".to_string());
        }

        let base = file_name.trim().trim_end_matches(".pdf").trim();
        let base = if base.is_empty() {
            "Study document"
        } else {
            base
        };
        let total_parts_estimate = total.div_ceil(MAX_PAGES).max(1);
        let mut created_paths = Vec::new();
        let result = (|| {
            let mut parts = Vec::new();
            let mut first = 1;
            let mut number = 1;
            while first <= total {
                let window_high = total.min(first.saturating_add(MAX_PAGES - 1));
                say(
                    &app,
                    format!(
                        "Reading pages {first}\u{2013}{window_high} (part {number} of about \
                         {total_parts_estimate})…"
                    ),
                );
                // Bounded to at most MAX_PAGES pages, however long the book
                // is — every candidate below is cloned and pruned from this,
                // not from the whole remaining document. See `window_document`.
                let window = window_document(&document, first, window_high, total);

                let part_name = format!("{base} - Part {number}.pdf");
                let part_id = format!("{batch_id}-part-{number}");
                let (destination, stored_name) =
                    documents::stored_destination(&app, &part_id, &part_name)?;
                created_paths.push(destination.clone());

                let (last, bytes) = largest_fitting_last_page(
                    first,
                    window_high,
                    MAX_PAGES,
                    MAX_PDF_BYTES,
                    |candidate| render_window_range(&window, 1, candidate - first + 1),
                )?;
                let file_size = bytes.len() as u64;
                std::fs::write(&destination, &bytes)
                    .map_err(|e| format!("Could not save the split PDF: {e}"))?;

                say(
                    &app,
                    format!(
                        "Created part {number}: pages {first}\u{2013}{last} \
                         ({} MB)",
                        file_size.div_ceil(1024 * 1024)
                    ),
                );

                parts.push(PdfPart {
                    relative_path: stored_name,
                    original_file_name: part_name,
                    file_size,
                    first_page: first,
                    last_page: last,
                });
                first = last + 1;
                number += 1;
            }
            Ok(parts)
        })();

        if result.is_err() {
            for path in created_paths {
                let _ = std::fs::remove_file(path);
            }
        }
        result
    })
    .await
}

/// Make sure the new document is named like the PDF it is.
fn pdf_file_name(requested: &str) -> String {
    let trimmed = requested.trim();
    let base = if trimmed.is_empty() {
        "chapter"
    } else {
        trimmed
    };
    if base.to_ascii_lowercase().ends_with(".pdf") {
        base.to_string()
    } else {
        format!("{base}.pdf")
    }
}

/// Run the PDF work away from the interface thread.
///
/// A handbook takes seconds to parse, and a frozen window during those
/// seconds looks exactly like a crash.
async fn run_off_thread<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "Reading that PDF was interrupted. Try it again.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Object, Stream};
    use std::path::PathBuf;

    /// A minimal, real PDF with `pages` numbered pages.
    fn pdf_with_pages(pages: u32) -> Document {
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
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Count" => i64::from(pages),
                "Kids" => kids,
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        document
    }

    fn illustrated_pdf_with_pages(pages: u32) -> Document {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let kids: Vec<Object> =
            (0..pages)
                .map(|page| {
                    // Distinct RGB raster data on every page. This is a valid
                    // image XObject rather than a page-count-only fixture.
                    let mut seed = page + 1;
                    let pixels: Vec<u8> = (0..128 * 128 * 3)
                        .map(|_| {
                            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                            (seed >> 16) as u8
                        })
                        .collect();
                    let image = document.add_object(Stream::new(
                        dictionary! {
                            "Type" => "XObject", "Subtype" => "Image",
                            "Width" => 128, "Height" => 128,
                            "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
                        },
                        pixels,
                    ));
                    let contents = document.add_object(Stream::new(
                        dictionary! {},
                        b"q 128 0 0 128 0 0 cm /Im0 Do Q".to_vec(),
                    ));
                    document.add_object(dictionary! {
                    "Type" => "Page", "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image } },
                    "Contents" => contents,
                }).into()
                })
                .collect();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Count" => i64::from(pages), "Kids" => kids,
            }),
        );
        let catalog_id =
            document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        document.trailer.set("Root", catalog_id);
        document
    }

    fn assert_batch_matches_lopdf(source: &Document, outside: &[u32]) {
        let mut original = source.clone();
        original.delete_pages(outside);
        original.prune_objects();
        original.compress();
        let mut old_bytes = Vec::new();
        original.save_to(&mut old_bytes).unwrap();

        let mut batched = source.clone();
        delete_pages_batch(&mut batched, outside);
        batched.prune_objects();
        batched.compress();
        let mut new_bytes = Vec::new();
        batched.save_to(&mut new_bytes).unwrap();
        assert_eq!(old_bytes, new_bytes);
        assert_eq!(original.get_pages().len(), batched.get_pages().len());
    }

    #[test]
    fn batch_deletion_matches_lopdf_on_illustrated_pages() {
        let document = illustrated_pdf_with_pages(40);
        let outside: Vec<u32> = (1..=40).filter(|page| *page < 11 || *page > 25).collect();
        assert_batch_matches_lopdf(&document, &outside);
    }

    #[test]
    fn batch_deletion_updates_nested_page_tree_counts() {
        let mut document = pdf_with_pages(30);
        let root = document
            .catalog()
            .unwrap()
            .get(b"Pages")
            .unwrap()
            .as_reference()
            .unwrap();
        let first_branch = document.new_object_id();
        let second_branch = document.new_object_id();
        let original_kids = document
            .get_dictionary(root)
            .unwrap()
            .get(b"Kids")
            .unwrap()
            .as_array()
            .unwrap()
            .clone();
        for (index, page) in original_kids.iter().enumerate() {
            let page_id = page.as_reference().unwrap();
            document.get_dictionary_mut(page_id).unwrap().set(
                "Parent",
                if index < 15 {
                    first_branch
                } else {
                    second_branch
                },
            );
        }
        document.objects.insert(
            first_branch,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Parent" => root, "Count" => 15,
                "Kids" => original_kids[..15].to_vec(),
            }),
        );
        document.objects.insert(
            second_branch,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Parent" => root, "Count" => 15,
                "Kids" => original_kids[15..].to_vec(),
            }),
        );
        document.get_dictionary_mut(root).unwrap().set(
            "Kids",
            vec![
                Object::Reference(first_branch),
                Object::Reference(second_branch),
            ],
        );

        let outside: Vec<u32> = (1..=30).filter(|page| *page < 8 || *page > 22).collect();
        assert_batch_matches_lopdf(&document, &outside);
    }

    #[test]
    #[ignore = "manual performance measurement on a long and image-heavy PDF"]
    fn batch_deletion_benchmark() {
        use std::time::Instant;

        let long = pdf_with_pages(3_000);
        let start = Instant::now();
        let window = window_document(&long, 1, 1_000, 3_000);
        for candidate in [250u32, 375, 438, 469, 485] {
            render_window_range(&window, 1, candidate).unwrap();
        }
        println!(
            "batch long-book window + 5 candidates: {:?}",
            start.elapsed()
        );

        let illustrated = illustrated_pdf_with_pages(120);
        let outside: Vec<u32> = (1..=120).filter(|page| *page > 50).collect();
        let old_start = Instant::now();
        let mut old = illustrated.clone();
        old.delete_pages(&outside);
        old.prune_objects();
        old.compress();
        let old_elapsed = old_start.elapsed();
        let new_start = Instant::now();
        let mut new = illustrated.clone();
        delete_pages_batch(&mut new, &outside);
        new.prune_objects();
        new.compress();
        println!(
            "illustrated 120-page cut: old {:?}, batch {:?}",
            old_elapsed,
            new_start.elapsed()
        );
        let mut old_bytes = Vec::new();
        let mut new_bytes = Vec::new();
        old.save_to(&mut old_bytes).unwrap();
        new.save_to(&mut new_bytes).unwrap();
        assert_eq!(old_bytes, new_bytes);
    }

    fn write_pdf(dir: &Path, name: &str, pages: u32) -> PathBuf {
        let path = dir.join(name);
        pdf_with_pages(pages).save(&path).unwrap();
        path
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "her-flight-deck-pdf-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_chapter_comes_out_with_only_its_own_pages() {
        let dir = scratch();
        let source = write_pdf(&dir, "handbook.pdf", 40);
        let chapter = dir.join("chapter.pdf");

        let kept = write_page_range(&source, &chapter, 11, 20).unwrap();

        assert_eq!(kept, 10);
        assert_eq!(page_count(&chapter).unwrap(), 10);
        // The book she split is untouched.
        assert_eq!(page_count(&source).unwrap(), 40);
    }

    #[test]
    fn a_single_page_is_a_valid_range() {
        let dir = scratch();
        let source = write_pdf(&dir, "single-source.pdf", 12);
        let one = dir.join("one.pdf");

        assert_eq!(write_page_range(&source, &one, 7, 7).unwrap(), 1);
        assert_eq!(page_count(&one).unwrap(), 1);
    }

    #[test]
    fn the_whole_document_may_be_asked_for() {
        let dir = scratch();
        let source = write_pdf(&dir, "whole-source.pdf", 5);
        let copy = dir.join("whole.pdf");

        assert_eq!(write_page_range(&source, &copy, 1, 5).unwrap(), 5);
        assert_eq!(page_count(&copy).unwrap(), 5);
    }

    #[test]
    fn a_range_that_cannot_be_meant_is_refused_by_name() {
        let dir = scratch();
        let source = write_pdf(&dir, "refusals.pdf", 30);
        let out = dir.join("out.pdf");

        assert!(write_page_range(&source, &out, 0, 4)
            .unwrap_err()
            .contains("numbered from 1"));
        assert!(write_page_range(&source, &out, 9, 4)
            .unwrap_err()
            .contains("before the first"));
        // Past the end of the book, said with the number she can act on.
        assert!(write_page_range(&source, &out, 44, 50)
            .unwrap_err()
            .contains("30 pages"));
        assert!(write_page_range(&source, &out, 22, 44)
            .unwrap_err()
            .contains("30 pages"));
    }

    #[test]
    fn a_range_google_would_still_refuse_is_refused_here_first() {
        let dir = scratch();
        let source = write_pdf(&dir, "long.pdf", 20);
        let out = dir.join("too-many.pdf");

        let complaint = write_page_range(&source, &out, 1, MAX_PAGES + 1).unwrap_err();
        assert!(complaint.contains("1000") || complaint.contains("1,000"));
        // Nothing is written for a range that could never be used.
        assert!(!out.exists());
    }

    /// The point of the feature: a chapter has to be *smaller* than the book.
    ///
    /// Deleting pages alone leaves their content, fonts and images in the
    /// file as unreferenced objects, and the "chapter" comes out very nearly
    /// the size of the handbook — which is the problem she started with.
    #[test]
    fn the_pages_left_behind_do_not_come_with_it() {
        let dir = scratch();
        let source = dir.join("weighty.pdf");

        // Fifty pages carrying a kilobyte of content each.
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let kids: Vec<Object> = (0..50)
            .map(|page| {
                let content = document.add_object(Stream::new(
                    dictionary! {},
                    format!("% page {page}\n{}", "0 0 m 1 1 l S\n".repeat(200)).into_bytes(),
                ));
                document
                    .add_object(dictionary! {
                        "Type" => "Page",
                        "Parent" => pages_id,
                        "Contents" => content,
                        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    })
                    .into()
            })
            .collect();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Count" => 50i64, "Kids" => kids,
            }),
        );
        let catalog = document.add_object(dictionary! {
            "Type" => "Catalog", "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog);
        document.save(&source).unwrap();

        let chapter = dir.join("five-pages.pdf");
        assert_eq!(write_page_range(&source, &chapter, 1, 5).unwrap(), 5);

        let book = std::fs::metadata(&source).unwrap().len();
        let part = std::fs::metadata(&chapter).unwrap().len();
        assert!(
            part * 4 < book,
            "a tenth of the pages came out as {part} bytes of a {book}-byte book"
        );
    }

    #[test]
    fn a_file_that_is_not_a_pdf_says_so_instead_of_panicking() {
        let dir = scratch();
        let fake = dir.join("not-really.pdf");
        std::fs::write(&fake, b"this is not a PDF").unwrap();

        assert!(page_count(&fake).unwrap_err().contains("could not be read"));
    }

    #[test]
    fn a_deeply_nested_malformed_pdf_is_rejected_without_exhausting_the_stack() {
        let dir = scratch();
        let malformed = dir.join("deeply-nested.pdf");
        let depth = 2_000;
        let mut bytes = b"%PDF-1.7\n1 0 obj\n".to_vec();
        bytes.extend(std::iter::repeat_n(b'[', depth));
        bytes.extend_from_slice(b"0");
        bytes.extend(std::iter::repeat_n(b']', depth));
        bytes.extend_from_slice(b"\nendobj\n%%EOF\n");
        std::fs::write(&malformed, bytes).unwrap();

        assert!(page_count(&malformed).is_err());
    }

    #[test]
    fn the_new_document_is_named_like_the_pdf_it_is() {
        assert_eq!(pdf_file_name("PHAK chapter 3"), "PHAK chapter 3.pdf");
        assert_eq!(pdf_file_name("PHAK chapter 3.pdf"), "PHAK chapter 3.pdf");
        assert_eq!(pdf_file_name("  "), "chapter.pdf");
    }

    #[test]
    fn automatic_ranges_use_the_largest_fitting_page_and_respect_page_limit() {
        let (last, bytes) = largest_fitting_last_page(1, 2_500, 1_000, 50, |page| {
            Ok(vec![0u8; (page / 10) as usize])
        })
        .unwrap();
        assert_eq!((last, bytes.len() as u64), (509, 50));

        let (last, _) =
            largest_fitting_last_page(1, 2_500, 1_000, 5_000, |page| Ok(vec![0u8; page as usize]))
                .unwrap();
        assert_eq!(last, 1_000);
    }

    #[test]
    fn a_single_oversized_page_gets_an_actionable_error() {
        let error =
            largest_fitting_last_page(17, 30, 1_000, 50, |_| Ok(vec![0u8; 51])).unwrap_err();
        assert!(error.contains("Page 17"));
        assert!(error.contains("Compress"));
    }

    #[test]
    fn a_manual_range_under_the_byte_limit_is_left_alone() {
        let dir = scratch();
        let file = dir.join("chapter.pdf");
        std::fs::write(&file, b"pretend pdf bytes").unwrap();

        assert!(enforce_pdf_size_limit(&file, MAX_PDF_BYTES).is_ok());
        assert!(
            file.is_file(),
            "a range within the limit must not be removed"
        );
    }

    #[test]
    fn a_manual_range_over_the_byte_limit_is_refused_and_removed() {
        let dir = scratch();
        let file = dir.join("chapter.pdf");
        std::fs::write(&file, b"pretend pdf bytes").unwrap();

        let error = enforce_pdf_size_limit(&file, MAX_PDF_BYTES + 1).unwrap_err();
        assert!(error.contains("Choose a smaller page range"), "{error}");
        assert!(
            !file.exists(),
            "an oversized manual range must not be left as a stored document"
        );
    }

    #[test]
    fn windowing_a_document_first_produces_the_same_split_as_windowing_it_directly() {
        // Kept small deliberately: `delete_pages` walks the whole live object
        // graph once per page it removes (see `lopdf`'s `delete_object`), so
        // a page count picked to demonstrate scale rather than prove
        // equivalence turns this one test into most of the suite's runtime.
        let full = pdf_with_pages(60);

        // The old, single-stage approach: clone the whole book and trim
        // straight to the final range.
        let mut direct = full.clone();
        let direct_total = u32::try_from(direct.get_pages().len()).unwrap();
        let direct_outside: Vec<u32> = (1..=direct_total)
            .filter(|page| *page < 21 || *page > 35)
            .collect();
        direct.delete_pages(&direct_outside);
        direct.prune_objects();
        direct.compress();
        let mut direct_bytes = Vec::new();
        direct.save_to(&mut direct_bytes).unwrap();

        // The new, two-stage approach this module now uses: window to a
        // bound first, then trim further within that window.
        let window = window_document(&full, 11, 40, 60);
        let windowed_bytes = render_window_range(&window, 11, 25).unwrap();

        assert_eq!(direct_bytes, windowed_bytes);
    }

    #[test]
    fn automatic_splitting_on_illustrated_document_produces_valid_consecutive_parts() {
        let total_pages = 25;
        let document = illustrated_pdf_with_pages(total_pages);
        let mut original_bytes = Vec::new();
        document.clone().save_to(&mut original_bytes).unwrap();

        let mut parts = Vec::new();
        let mut first = 1;

        // Cap each part at 10 pages to test consecutive multi-part splitting
        let max_pages_per_part = 10;
        while first <= total_pages {
            let window_high = total_pages.min(first + max_pages_per_part - 1);
            let window = window_document(&document, first, window_high, total_pages);
            let (last, bytes) = largest_fitting_last_page(
                first,
                window_high,
                max_pages_per_part,
                MAX_PDF_BYTES,
                |candidate| render_window_range(&window, 1, candidate - first + 1),
            )
            .unwrap();

            assert!(last >= first);
            assert!(last <= window_high);
            assert!(bytes.len() as u64 <= MAX_PDF_BYTES);
            parts.push((first, last, bytes));

            first = last + 1;
        }

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].0, 1);
        assert_eq!(parts[0].1, 10);
        assert_eq!(parts[1].0, 11);
        assert_eq!(parts[1].1, 20);
        assert_eq!(parts[2].0, 21);
        assert_eq!(parts[2].1, 25);

        // Verify original document is untouched
        let mut current_bytes = Vec::new();
        document.clone().save_to(&mut current_bytes).unwrap();
        assert_eq!(original_bytes, current_bytes);
    }

    /// Not a strict timing assertion — CI hardware varies — but the ratio
    /// between "reload and re-clone the whole remaining book for every
    /// binary-search candidate" (what this module did before) and "clone a
    /// bounded window once per part" (what it does now) should be large and
    /// growing with page count, which is the actual claim being made.
    /// `#[ignore]`d: it exists to be run by hand while working on this code,
    /// not on every `cargo test`, since it deliberately reproduces the slow
    /// path to measure it.
    #[test]
    #[ignore = "run explicitly to measure the improvement; deliberately slow on purpose"]
    fn windowing_is_substantially_faster_than_reprocessing_the_whole_book_per_candidate() {
        use std::time::Instant;

        let pages = 3_000;
        let document = pdf_with_pages(pages);

        let old_way = Instant::now();
        for candidate in [250u32, 375, 438, 469, 485] {
            // What every candidate used to cost: clone the *whole* document,
            // trim to just this one range, save.
            write_page_range_from_document(
                &document,
                &std::env::temp_dir().join("hfd-old-way-bench.pdf"),
                1,
                candidate,
            )
            .unwrap();
        }
        let old_elapsed = old_way.elapsed();

        let new_way = Instant::now();
        let window = window_document(&document, 1, 1_000.min(pages), pages);
        for candidate in [250u32, 375, 438, 469, 485] {
            render_window_range(&window, 1, candidate).unwrap();
        }
        let new_elapsed = new_way.elapsed();

        println!("old (whole-book clone per candidate): {old_elapsed:?}");
        println!("new (windowed clone per candidate):    {new_elapsed:?}");
        assert!(
            new_elapsed < old_elapsed,
            "windowing should be faster, not just different: old {old_elapsed:?} vs new {new_elapsed:?}"
        );

        let _ = std::fs::remove_file(std::env::temp_dir().join("hfd-old-way-bench.pdf"));
    }
}
