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

use crate::documents;
use crate::lineage::{self, SplitSourceReceipt, WrittenPart};

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

fn open_pdf(path: &Path) -> Result<Document, String> {
    Document::load(path).map_err(unreadable_pdf)
}

fn unreadable_pdf(e: lopdf::Error) -> String {
    format!(
        "That PDF could not be read: {e}. If it opens in a PDF viewer, try saving a fresh \
         copy from there and adding that instead."
    )
}

/// Read a stored PDF once, keeping its exact bytes, so the fingerprint a split
/// records is of the very bytes the split was made from.
fn read_pdf_once(path: &Path) -> Result<(Vec<u8>, Document), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("That PDF could not be read: {e}"))?;
    let document = Document::load_mem(&bytes).map_err(unreadable_pdf)?;
    Ok((bytes, document))
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
/// (The commands read the source once through `read_pdf_once` instead.)
#[cfg(test)]
pub(crate) fn write_page_range(
    source: &Path,
    destination: &Path,
    first: u32,
    last: u32,
) -> Result<u32, String> {
    check_requested_range(first, last)?;
    let document = open_pdf(source)?;
    write_page_range_from_document(&document, destination, first, last)
}

fn check_requested_range(first: u32, last: u32) -> Result<(), String> {
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
    Ok(())
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

/// Select ordered source pages using the same pruned page-tree writer as splits.
/// The caller validates ascending, unique, nonempty pages before this function.
pub(crate) fn selected_bytes(bytes: &[u8], pages: &[u32]) -> Result<Vec<u8>, String> {
    let mut document = Document::load_mem(bytes).map_err(unreadable_pdf)?;
    let numbers: Vec<u32> = document.get_pages().into_keys().collect();
    if pages.is_empty()
        || pages.windows(2).any(|p| p[0] >= p[1])
        || pages.iter().any(|p| !numbers.contains(p))
    {
        return Err("Choose valid PDF pages in source order.".into());
    }
    if pages == numbers {
        return Ok(bytes.to_vec());
    }
    let removing: Vec<u32> = numbers.into_iter().filter(|p| !pages.contains(p)).collect();
    delete_pages_batch(&mut document, &removing);
    document.prune_objects();
    document.compress();
    let mut selected = Vec::new();
    document.save_to(&mut selected).map_err(|e| e.to_string())?;
    Ok(selected)
}

/// Return None when even the first page alone is oversized; render errors stay errors.
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
) -> Result<Option<(u32, Vec<u8>)>, String>
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

    Ok(best)
}

/// Copy of `source` holding only pages `first..=high`, pruned and compressed
/// once — the bounded base every candidate inside one part is trimmed from,
/// instead of each candidate re-cloning and re-compressing the *entire*
/// remaining book. For a book far longer than one part's page limit, this is
/// the difference between paying that cost once per part and paying it once
/// per binary-search step per part.
///
/// `prune_objects` sweeps from the trailer, including the catalog, so the
/// whole-document metadata graphs must be trimmed before each sweep.
/// Two-stage trimming keeps the same page resources as trimming directly;
/// rebuilt navigation objects may have different object numbers.
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

    trim_part_metadata(document, &removed);

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

/// Whole-document navigation and accessibility graphs cannot be copied as-is
/// into a part. In particular tagged structure may reference removed pages'
/// content/resources even after their direct /Pg references are stripped.
fn trim_part_metadata(document: &mut Document, removed: &HashSet<ObjectId>) {
    let Ok(root) = document.catalog().cloned() else {
        return;
    };
    let kept: HashSet<ObjectId> = document
        .get_pages()
        .into_values()
        .filter(|id| !removed.contains(id))
        .collect();
    let destination = |object: &Object| {
        crate::pdf_study_kit::destination(document, &root, object, 0).filter(|id| kept.contains(id))
    };

    // Flatten the surviving headings in reading order. A removed parent's
    // kept children are promoted, so a chapter in this part retains its own
    // heading. Rebuild links rather than retaining old Parent/Next graphs.
    let mut headings = Vec::new();
    let mut stack = Vec::new();
    if let Ok(outlines) = root.get(b"Outlines").and_then(|o| document.dereference(o)) {
        if let Ok(dict) = outlines.1.as_dict() {
            if let Ok(first) = dict.get(b"First") {
                stack.push(first.clone());
            }
        }
    }
    let mut seen = HashSet::new();
    while let Some(object) = stack.pop() {
        let Ok(id) = object.as_reference() else {
            continue;
        };
        if !seen.insert(id) {
            continue;
        }
        let Ok(item) = document.get_dictionary(id) else {
            continue;
        };
        if let Ok(next) = item.get(b"Next") {
            stack.push(next.clone());
        }
        if let Ok(child) = item.get(b"First") {
            stack.push(child.clone());
        }
        let target = item
            .get(b"Dest")
            .ok()
            .or_else(|| {
                let action = document
                    .dereference(item.get(b"A").ok()?)
                    .ok()?
                    .1
                    .as_dict()
                    .ok()?;
                (action.get(b"S").ok()?.as_name().ok()? == b"GoTo")
                    .then(|| action.get(b"D").ok())
                    .flatten()
            })
            .and_then(destination);
        if let (Some(page), Ok(title)) = (target, item.get(b"Title")) {
            if let Ok((_, title)) = document.dereference(title) {
                if matches!(title, Object::String(_, _)) {
                    headings.push((title.clone(), page));
                }
            }
        }
    }

    let mut annotations = Vec::new();
    for page in &kept {
        let Ok(items) = document
            .get_dictionary(*page)
            .and_then(|p| p.get(b"Annots"))
            .and_then(|o| document.dereference(o))
            .and_then(|(_, o)| o.as_array())
        else {
            continue;
        };
        let mut cleaned = Vec::new();
        for object in items {
            let Ok((_, object)) = document.dereference(object) else {
                continue;
            };
            let Ok(dict) = object.as_dict() else { continue };
            // Forms are omitted from parts; widgets must not retain the field
            // parent tree after AcroForm is removed from the catalog.
            if dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Widget")
                || dict
                    .get(b"P")
                    .and_then(Object::as_reference)
                    .ok()
                    .is_some_and(|id| removed.contains(&id))
            {
                continue;
            }
            let mut dict = dict.clone();
            dict.remove(b"StructParent");
            if let Ok(target) = dict.get(b"Dest") {
                let Some(id) = destination(target) else {
                    continue;
                };
                dict.set("Dest", vec![id.into(), Object::Name(b"Fit".to_vec())]);
            }
            if let Ok((_, action)) = dict.get(b"A").and_then(|o| document.dereference(o)) {
                if let Ok(action) = action.as_dict() {
                    let mut action = action.clone();
                    action.remove(b"Next");
                    if action.get(b"S").and_then(Object::as_name).ok() == Some(b"GoTo") {
                        let Some(id) = action.get(b"D").ok().and_then(destination) else {
                            continue;
                        };
                        action.set("D", vec![id.into(), Object::Name(b"Fit".to_vec())]);
                    }
                    dict.set("A", action);
                }
            }
            cleaned.push(Object::Dictionary(dict));
        }
        annotations.push((*page, cleaned));
    }
    for (id, items) in annotations {
        if let Ok(page) = document.get_dictionary_mut(id) {
            page.set("Annots", items);
        }
    }
    for id in &kept {
        if let Ok(page) = document.get_dictionary_mut(*id) {
            page.remove(b"StructParents");
        }
    }

    let outlines = if headings.is_empty() {
        None
    } else {
        let parent = document.new_object_id();
        let ids: Vec<_> = headings.iter().map(|_| document.new_object_id()).collect();
        for (index, (title, page)) in headings.into_iter().enumerate() {
            let mut item = Dictionary::new();
            item.set("Title", title);
            item.set("Parent", parent);
            item.set("Dest", vec![page.into(), Object::Name(b"Fit".to_vec())]);
            if index > 0 {
                item.set("Prev", ids[index - 1]);
            }
            if index + 1 < ids.len() {
                item.set("Next", ids[index + 1]);
            }
            document
                .objects
                .insert(ids[index], Object::Dictionary(item));
        }
        let mut tree = Dictionary::new();
        tree.set("Type", Object::Name(b"Outlines".to_vec()));
        tree.set("First", ids[0]);
        tree.set("Last", *ids.last().unwrap());
        tree.set("Count", ids.len() as i64);
        document.objects.insert(parent, Object::Dictionary(tree));
        Some(parent)
    };
    if let Ok(catalog) = document.catalog_mut() {
        // Accessibility tags cannot remain consistent per part. Omit their
        // tree and MarkInfo rather than falsely claiming this part is tagged.
        // Named destinations/forms/article threads are whole-document graphs;
        // outlines and links above have already resolved their kept targets.
        // PageLabels are omitted because source indices no longer match.
        for key in [
            b"StructTreeRoot".as_slice(),
            b"MarkInfo",
            b"Outlines",
            b"Names",
            b"Dests",
            b"AcroForm",
            b"OpenAction",
            b"PageLabels",
            b"Threads",
        ] {
            catalog.remove(key);
        }
        if let Some(id) = outlines {
            catalog.set("Outlines", id);
        }
    }
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

/// Save a page range from a stored PDF as a study document of its own, and
/// record a receipt of exactly what was split (see `lineage`).
///
/// `material_id` is the id the new material will be created with, so the
/// stored name cannot collide with anything already in the library.
/// `source_material_id` is the material whose PDF is being split; the receipt
/// is refused unless that material really owns `relative_path`.
#[tauri::command]
pub async fn split_pdf(
    app: AppHandle,
    relative_path: String,
    material_id: String,
    first_page: u32,
    last_page: u32,
    file_name: String,
    source_material_id: String,
) -> Result<SplitSourceReceipt, String> {
    let root = crate::storage::app_root(&app)?;
    run_off_thread(move || {
        split_range_at(
            &root,
            &source_material_id,
            &relative_path,
            &material_id,
            first_page,
            last_page,
            &file_name,
        )
    })
    .await
}

/// Own every temporary/final path until the complete split has a receipt.
/// A failed render, write, rename, or receipt removes the whole batch.
#[derive(Default)]
struct SplitFiles {
    paths: Vec<PathBuf>,
    keep: bool,
}

impl SplitFiles {
    fn write_part<F>(
        &mut self,
        directory: &Path,
        material_id: &str,
        name: &str,
        write: F,
    ) -> Result<(PathBuf, String), String>
    where
        F: FnOnce(&Path) -> Result<(), String>,
    {
        let (temporary, _) = documents::stored_destination_in(directory, ".pdf-split-tmp", name)?;
        self.paths.push(temporary.clone());
        write(&temporary)?;
        // Reserve the final name only after the temporary file is complete.
        // The reservation prevents overwriting another stored document.
        let (destination, stored_name) =
            documents::stored_destination_in(directory, material_id, name)?;
        self.paths.push(destination.clone());
        std::fs::rename(&temporary, &destination)
            .map_err(|error| format!("Could not save the split PDF: {error}"))?;
        self.paths.retain(|path| path != &temporary);
        Ok((destination, stored_name))
    }
}

impl Drop for SplitFiles {
    fn drop(&mut self) {
        if !self.keep {
            for path in &self.paths {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[doc(hidden)]
pub fn split_range_at(
    root: &Path,
    source_material_id: &str,
    relative_path: &str,
    material_id: &str,
    first_page: u32,
    last_page: u32,
    file_name: &str,
) -> Result<SplitSourceReceipt, String> {
    check_requested_range(first_page, last_page)?;
    let documents_dir = root.join(documents::DOCUMENTS_DIR);
    let source = documents_dir.join(documents::safe_relative_path(relative_path)?);
    let (bytes, document) = read_pdf_once(&source)?;
    let total = u32::try_from(document.get_pages().len()).unwrap_or(u32::MAX);
    if total == 0 {
        return Err("That PDF has no pages this application can read.".to_string());
    }
    let original_file_name = pdf_file_name(file_name);
    let mut files = SplitFiles::default();
    let outcome = (|| {
        let (destination, stored_name) = files.write_part(
            &documents_dir,
            material_id,
            &original_file_name,
            |temporary| {
                write_page_range_from_document(&document, temporary, first_page, last_page)?;
                let size = std::fs::metadata(temporary)
                    .map_err(|error| format!("The split PDF could not be read back: {error}"))?
                    .len();
                enforce_pdf_size_limit(temporary, size)
            },
        )?;
        let file_size = std::fs::metadata(&destination)
            .map_err(|error| format!("The split PDF could not be read back: {error}"))?
            .len();
        lineage::issue_receipt_at(
            root,
            source_material_id,
            relative_path,
            &bytes,
            total,
            &[WrittenPart {
                id: material_id.to_string(),
                first_page,
                last_page,
                file_path: stored_name,
                file_size,
                original_file_name,
            }],
            &[],
        )
    })();
    files.keep = outcome.is_ok();
    outcome
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
        "That page range is too large ({}; the limit is {}). Choose a shorter page range.",
        crate::gemini::describe_size(file_size),
        crate::gemini::describe_size(MAX_PDF_BYTES),
    ))
}

/// Split a stored PDF into consecutive parts that Google can read, and record
/// a receipt of exactly what was split (see `lineage`).
///
/// The original is read only. All output files are removed if any part fails,
/// so the library can never be left with half of an automatic split.
#[tauri::command]
pub async fn split_pdf_automatically(
    app: AppHandle,
    relative_path: String,
    batch_id: String,
    file_name: String,
    source_material_id: String,
) -> Result<SplitSourceReceipt, String> {
    let root = crate::storage::app_root(&app)?;
    run_off_thread(move || {
        split_automatically_at(
            &root,
            &source_material_id,
            &relative_path,
            &batch_id,
            &file_name,
            &|message| say(&app, message),
        )
    })
    .await
}

#[doc(hidden)]
pub fn split_automatically_at(
    root: &Path,
    source_material_id: &str,
    relative_path: &str,
    batch_id: &str,
    file_name: &str,
    report: &dyn Fn(String),
) -> Result<SplitSourceReceipt, String> {
    split_automatically_with_limits(
        root,
        source_material_id,
        relative_path,
        batch_id,
        file_name,
        report,
        (MAX_PAGES, MAX_PDF_BYTES),
    )
}

fn split_automatically_with_limits(
    root: &Path,
    source_material_id: &str,
    relative_path: &str,
    batch_id: &str,
    file_name: &str,
    report: &dyn Fn(String),
    limits: (u32, u64),
) -> Result<SplitSourceReceipt, String> {
    let documents_dir = root.join(documents::DOCUMENTS_DIR);
    let source = documents_dir.join(documents::safe_relative_path(relative_path)?);
    let (bytes, document) = read_pdf_once(&source)?;
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
    let mut files = SplitFiles::default();
    let result = (|| {
        let (parts, skipped_pages) = files.write_automatic_parts(
            &document,
            &documents_dir,
            batch_id,
            base,
            report,
            limits,
        )?;
        lineage::issue_receipt_at(
            root,
            source_material_id,
            relative_path,
            &bytes,
            total,
            &parts,
            &skipped_pages,
        )
    })();

    files.keep = result.is_ok();
    result
}

impl SplitFiles {
    fn write_automatic_parts(
        &mut self,
        document: &Document,
        directory: &Path,
        batch_id: &str,
        base: &str,
        report: &dyn Fn(String),
        limits: (u32, u64),
    ) -> Result<(Vec<WrittenPart>, Vec<u32>), String> {
        let (max_pages, max_bytes) = limits;
        let total = document.get_pages().len() as u32;
        let total_parts_estimate = total.div_ceil(max_pages).max(1);
        let mut parts = Vec::new();
        let mut skipped_pages = Vec::new();
        let mut first = 1;
        let mut number = 1;
        while first <= total {
            let window_high = total.min(first.saturating_add(max_pages - 1));
            report(format!(
                "Reading pages {first}\u{2013}{window_high} (part {number} of about \
                 {total_parts_estimate})…"
            ));
            // Bounded to at most max_pages pages, however long the book
            // is — every candidate below is cloned and pruned from this,
            // not from the whole remaining document. See `window_document`.
            let window = window_document(document, first, window_high, total);

            let part_name = format!("{base} - Part {number}.pdf");
            let part_id = format!("{batch_id}-part-{number}");
            let fitting =
                largest_fitting_last_page(first, window_high, max_pages, max_bytes, |candidate| {
                    render_window_range(&window, 1, candidate - first + 1)
                })?;
            let Some((last, part_bytes)) = fitting else {
                skipped_pages.push(first);
                report(format!("Page {first} is too large by itself and will be left out. Your original PDF is unchanged."));
                first += 1;
                continue;
            };
            let file_size = part_bytes.len() as u64;
            let (_, stored_name) =
                self.write_part(directory, &part_id, &part_name, |temporary| {
                    std::fs::write(temporary, &part_bytes)
                        .map_err(|e| format!("Could not save the split PDF: {e}"))
                })?;

            report(format!(
                "Created part {number}: pages {first}\u{2013}{last} ({} MB)",
                file_size.div_ceil(1024 * 1024)
            ));

            parts.push(WrittenPart {
                id: part_id,
                first_page: first,
                last_page: last,
                file_path: stored_name,
                file_size,
                original_file_name: part_name,
            });
            first = last + 1;
            number += 1;
        }
        if parts.is_empty() {
            return Err("Every page is too large by itself, so no parts were created. Your original PDF is unchanged.".into());
        }
        Ok((parts, skipped_pages))
    }
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

    /// Tagged navigation graphs deliberately share each page's own image.
    /// After /Pg stripping alone those images still survive through /OBJR.
    fn tagged_illustrated_pdf() -> Document {
        let mut doc = illustrated_pdf_with_pages(4);
        let pages: Vec<_> = doc.get_pages().into_values().collect();
        let images: Vec<_> = pages
            .iter()
            .map(|id| {
                doc.get_dictionary(*id)
                    .unwrap()
                    .get(b"Resources")
                    .unwrap()
                    .as_dict()
                    .unwrap()
                    .get(b"XObject")
                    .unwrap()
                    .as_dict()
                    .unwrap()
                    .get(b"Im0")
                    .unwrap()
                    .as_reference()
                    .unwrap()
            })
            .collect();
        let structure: Vec<Object> = pages
            .iter()
            .zip(&images)
            .map(|(page, image)| {
                doc.add_object(dictionary! {
                    "Type" => "StructElem", "S" => "Figure", "Pg" => *page,
                    "K" => dictionary! { "Type" => "OBJR", "Pg" => *page, "Obj" => *image },
                })
                .into()
            })
            .collect();
        let tags = doc.add_object(dictionary! { "Type" => "StructTreeRoot", "K" => structure });
        let outlines = doc.new_object_id();
        let parent = doc.new_object_id();
        let child = doc.new_object_id();
        let siblings: Vec<_> = (1..4).map(|_| doc.new_object_id()).collect();
        doc.objects.insert(
            parent,
            dictionary! {
                "Title" => Object::string_literal("Removed parent"), "Parent" => outlines,
                "Dest" => vec![pages[3].into(), Object::Name(b"Fit".to_vec())],
                "First" => child, "Last" => child, "Count" => 1, "Next" => siblings[0],
            }
            .into(),
        );
        doc.objects.insert(
            child,
            dictionary! {
                "Title" => Object::string_literal("Kept chapter"), "Parent" => parent,
                "A" => dictionary! { "S" => "GoTo", "D" => Object::string_literal("kept") },
            }
            .into(),
        );
        for (index, id) in siblings.iter().enumerate() {
            let mut item = dictionary! {
                "Title" => Object::string_literal("Removed chapter"), "Parent" => outlines,
                "Dest" => vec![pages[index+1].into(), Object::Name(b"Fit".to_vec())],
            };
            if index + 1 < siblings.len() {
                item.set("Next", siblings[index + 1]);
            }
            doc.objects.insert(*id, item.into());
        }
        doc.objects.insert(outlines, dictionary! { "Type" => "Outlines", "First" => parent, "Last" => *siblings.last().unwrap(), "Count" => 5 }.into());
        let names = doc.add_object(dictionary! { "Names" => vec![
            Object::string_literal("kept"), Object::Array(vec![pages[0].into(), Object::Name(b"Fit".to_vec())]),
            Object::string_literal("removed"), Object::Array(vec![pages[3].into(), Object::Name(b"Fit".to_vec())]),
        ] });
        let field = doc.new_object_id();
        let widgets: Vec<Object> = [0, 3].into_iter().map(|index| {
            doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Widget", "P" => pages[index], "Parent" => field,
                "AP" => dictionary! { "N" => images[index] } }).into()
        }).collect();
        doc.objects.insert(
            field,
            dictionary! { "FT" => "Tx", "Kids" => widgets.clone() }.into(),
        );
        let form = doc.add_object(dictionary! { "Fields" => vec![Object::Reference(field)] });
        let kept_link = dictionary! { "Subtype" => "Link", "P" => pages[0], "StructParent" => 1,
        "Dest" => Object::string_literal("kept") };
        let kept_action = dictionary! { "Subtype" => "Link", "P" => pages[0],
        "A" => dictionary! { "S" => "GoTo", "D" => Object::string_literal("kept"),
            "Next" => dictionary! { "S" => "GoTo", "D" => vec![pages[3].into(), Object::Name(b"Fit".to_vec())] } } };
        let removed_link = dictionary! { "Subtype" => "Link", "Dest" => vec![pages[3].into(), Object::Name(b"Fit".to_vec())] };
        let removed_action = dictionary! { "Subtype" => "Link", "A" => dictionary! { "S" => "GoTo", "D" => Object::Name(b"last".to_vec()) } };
        let wrong_owner = dictionary! { "Subtype" => "Text", "P" => pages[3] };
        doc.get_dictionary_mut(pages[0]).unwrap().set(
            "Annots",
            vec![
                widgets[0].clone(),
                kept_link.into(),
                kept_action.into(),
                removed_link.into(),
                removed_action.into(),
                wrong_owner.into(),
            ],
        );
        doc.get_dictionary_mut(pages[0])
            .unwrap()
            .set("StructParents", 0);
        doc.get_dictionary_mut(pages[3])
            .unwrap()
            .set("Annots", vec![widgets[1].clone()]);
        let root = doc.catalog_mut().unwrap();
        root.set("StructTreeRoot", tags);
        root.set("MarkInfo", dictionary! { "Marked" => true });
        root.set("Outlines", outlines);
        root.set("Names", dictionary! { "Dests" => names });
        root.set(
            "Dests",
            dictionary! { "last" => vec![pages[3].into(), Object::Name(b"Fit".to_vec())] },
        );
        root.set("AcroForm", form);
        root.set(
            "OpenAction",
            vec![pages[3].into(), Object::Name(b"Fit".to_vec())],
        );
        root.set("PageLabels", dictionary! { "Nums" => vec![0.into(), Object::Dictionary(dictionary! { "S" => "D" })] });
        doc
    }

    fn assert_trimmed_tagged_part(bytes: &[u8], source: &Document) {
        assert!(
            bytes.len() > 40_000 && bytes.len() < 65_000,
            "one image, not the whole book: {}",
            bytes.len()
        );
        let doc = Document::load_mem(bytes).unwrap();
        let page = *source.get_pages().get(&1).unwrap();
        assert_eq!(
            doc.get_pages().into_values().collect::<Vec<_>>(),
            vec![page]
        );
        for id in source.get_pages().values().skip(1) {
            assert!(!doc.objects.contains_key(id));
        }
        let root = doc.catalog().unwrap();
        for key in [
            b"StructTreeRoot".as_slice(),
            b"MarkInfo",
            b"Names",
            b"Dests",
            b"AcroForm",
            b"OpenAction",
            b"PageLabels",
        ] {
            assert!(
                root.get(key).is_err(),
                "{} survived",
                String::from_utf8_lossy(key)
            );
        }
        let outline = doc
            .get_dictionary(root.get(b"Outlines").unwrap().as_reference().unwrap())
            .unwrap();
        assert_eq!(outline.get(b"Count").unwrap().as_i64().unwrap(), 1);
        let heading = doc
            .get_dictionary(outline.get(b"First").unwrap().as_reference().unwrap())
            .unwrap();
        assert_eq!(
            heading.get(b"Title").unwrap().as_str().unwrap(),
            b"Kept chapter"
        );
        assert_eq!(
            heading.get(b"Dest").unwrap().as_array().unwrap()[0]
                .as_reference()
                .unwrap(),
            page
        );
        assert!(heading.get(b"Next").is_err());
        let page = doc.get_dictionary(page).unwrap();
        assert!(page.get(b"StructParents").is_err());
        let annots = page.get(b"Annots").unwrap().as_array().unwrap();
        assert_eq!(annots.len(), 2, "only the two kept links survive");
        assert!(annots[0].as_dict().unwrap().get(b"StructParent").is_err());
        assert!(annots[0]
            .as_dict()
            .unwrap()
            .get(b"Dest")
            .unwrap()
            .as_array()
            .is_ok());
        let action = annots[1]
            .as_dict()
            .unwrap()
            .get(b"A")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(action.get(b"D").unwrap().as_array().is_ok());
        assert!(action.get(b"Next").is_err());
        // Every reference in the serialized part resolves; no dangling /Pg,
        // /Dest, /P, or resource reference to an omitted object is left.
        let mut copy = doc.clone();
        let ids = copy.traverse_objects(|_| {});
        for id in ids {
            assert!(doc.objects.contains_key(&id), "dangling {id:?}");
        }
        let images = doc
            .objects
            .values()
            .filter(|o| {
                o.as_stream().is_ok_and(|s| {
                    s.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Image")
                })
            })
            .count();
        assert_eq!(images, 1);
    }

    #[test]
    fn tagged_pdf_parts_prune_other_pages_and_preserve_kept_headings() {
        let source = tagged_illustrated_pdf();
        let mut bytes = Vec::new();
        source.clone().save_to(&mut bytes).unwrap();
        let dir = scratch().join("tagged-parts");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("manual.pdf");
        write_page_range_from_document(&source, &path, 1, 1).unwrap();
        assert_trimmed_tagged_part(&std::fs::read(path).unwrap(), &source);
        assert_trimmed_tagged_part(&selected_bytes(&bytes, &[1]).unwrap(), &source);
        let window = window_document(&source, 1, 3, 4);
        assert_trimmed_tagged_part(&render_window_range(&window, 1, 1).unwrap(), &source);
        // Subsetting never changes the parsed source or its original bytes.
        let mut after = Vec::new();
        source.clone().save_to(&mut after).unwrap();
        assert_eq!(bytes, after);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn pdf_failed_partial_write_leaves_no_final_or_temporary_file() {
        let dir = scratch().join("failed-write");
        std::fs::create_dir_all(&dir).unwrap();
        {
            let mut files = SplitFiles::default();
            let error = files
                .write_part(&dir, "part", "chapter.pdf", |temporary| {
                    assert!(
                        !dir.join("part-chapter.pdf").exists(),
                        "final path must not exist during a write"
                    );
                    std::fs::write(temporary, b"partial PDF").unwrap();
                    Err("injected write failure".into())
                })
                .unwrap_err();
            assert!(error.contains("injected"));
        }
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    // Small synthetic byte limit exercises the production split/receipt flow
    // without allocating a 50 MiB image for every regression.
    fn library_with_oversized_pages(label: &str, oversized: &[u32]) -> PathBuf {
        let root = split_library(label, 4);
        let mut doc = pdf_with_pages(4);
        for page in oversized {
            let id = doc.get_pages()[page];
            let mut seed = 42u32;
            let data = (0..100_000)
                .map(|_| {
                    seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    (seed >> 16) as u8
                })
                .collect();
            let stream = doc.add_object(Stream::new(dictionary! {}, data));
            doc.get_dictionary_mut(id).unwrap().set("Contents", stream);
        }
        doc.save(root.join("documents/R-handbook.pdf")).unwrap();
        root
    }

    fn assert_oversized_page_skipped(label: &str, skipped: u32, ranges: &[(u32, u32)]) {
        let root = library_with_oversized_pages(label, &[skipped]);
        let source = root.join("documents/R-handbook.pdf");
        let before = std::fs::read(&source).unwrap();
        let receipt = split_automatically_with_limits(
            &root,
            "R",
            "R-handbook.pdf",
            "batch",
            "Book",
            &|_| {},
            (MAX_PAGES, 10_000),
        )
        .unwrap();
        assert_eq!(receipt.core.skipped_pages, vec![skipped]);
        assert_eq!(
            receipt
                .core
                .plan
                .iter()
                .map(|p| (p.selection.start, p.selection.end))
                .collect::<Vec<_>>(),
            ranges
        );
        for (index, part) in receipt.core.plan.iter().enumerate() {
            assert_eq!(part.id, format!("batch-part-{}", index + 1));
            assert!(part.file_size <= 10_000);
            assert_eq!(
                page_count(&root.join("documents").join(&part.file_path)).unwrap(),
                part.child_page_count
            );
        }
        lineage::save_split_batch_at(&root, &receipt, &presentation(&receipt)).unwrap();
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        let canonical: String = conn.query_row(
            "SELECT receipt_canonical_json FROM split_operation_log WHERE operation_id = ?1 AND status = 'committed'",
            [&receipt.operation_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&canonical).unwrap()["skippedPages"],
            serde_json::json!([skipped])
        );
        assert_eq!(std::fs::read(source).unwrap(), before);
        assert_eq!(
            std::fs::read_dir(root.join("documents")).unwrap().count(),
            ranges.len() + 1
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pdf_oversized_first_page_is_skipped_and_reported() {
        assert_oversized_page_skipped("oversized-first", 1, &[(2, 4)]);
    }

    #[test]
    fn pdf_oversized_middle_page_is_skipped_and_reported() {
        assert_oversized_page_skipped("oversized-middle", 2, &[(1, 1), (3, 4)]);
    }

    #[test]
    fn pdf_oversized_last_page_is_skipped_and_reported() {
        assert_oversized_page_skipped("oversized-last", 4, &[(1, 3)]);
    }

    #[test]
    fn pdf_all_pages_oversized_fails_plainly_without_files_or_receipt() {
        let root = library_with_oversized_pages("all-oversized", &[1, 2, 3, 4]);
        let before = std::fs::read(root.join("documents/R-handbook.pdf")).unwrap();
        let error = split_automatically_with_limits(
            &root,
            "R",
            "R-handbook.pdf",
            "batch",
            "Book",
            &|_| {},
            (MAX_PAGES, 10_000),
        )
        .unwrap_err();
        assert_eq!(error, "Every page is too large by itself, so no parts were created. Your original PDF is unchanged.");
        assert_eq!(
            std::fs::read_dir(root.join("documents")).unwrap().count(),
            1
        );
        assert_eq!(
            std::fs::read(root.join("documents/R-handbook.pdf")).unwrap(),
            before
        );
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM split_operation_log", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM study_materials", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pdf_real_failure_after_skipping_rolls_back_every_written_part() {
        let root = library_with_oversized_pages("skip-then-failure", &[2]);
        let created = std::cell::Cell::new(0);
        let error = split_automatically_with_limits(
            &root,
            "wrong-owner",
            "R-handbook.pdf",
            "batch",
            "Book",
            &|message| {
                if message.starts_with("Created") {
                    created.set(created.get() + 1);
                }
            },
            (MAX_PAGES, 10_000),
        )
        .unwrap_err();
        assert!(error.contains("no longer in the library"), "{error}");
        assert_eq!(created.get(), 2);
        assert_eq!(
            std::fs::read_dir(root.join("documents")).unwrap().count(),
            1
        );
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM split_operation_log", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pdf_failed_automatic_receipt_removes_all_parts_and_adds_no_rows() {
        let root = split_library("failed-auto-receipt", 1_001);
        let error = split_automatically_at(
            &root,
            "wrong-owner",
            "R-handbook.pdf",
            "batch",
            "Book.pdf",
            &|_| {},
        )
        .unwrap_err();
        assert!(error.contains("no longer in the library"), "{error}");
        assert_eq!(
            std::fs::read_dir(root.join("documents")).unwrap().count(),
            1
        );
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM study_materials", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM split_operation_log", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        std::fs::remove_dir_all(root).unwrap();
    }

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

    /// A disposable library folder: every shipped migration, and a material
    /// `R` that owns a real `pages`-page PDF.
    fn split_library(label: &str, pages: u32) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "her-flight-deck-split-lineage-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let documents_dir = root.join(documents::DOCUMENTS_DIR);
        std::fs::create_dir_all(&documents_dir).unwrap();
        write_pdf(&documents_dir, "R-handbook.pdf", pages);
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

    fn presentation(receipt: &SplitSourceReceipt) -> Vec<lineage::SplitPartPresentation> {
        receipt
            .core
            .plan
            .iter()
            .map(|part| lineage::SplitPartPresentation {
                id: part.id.clone(),
                title: format!("Part {}", part.id),
                notes: String::new(),
            })
            .collect()
    }

    #[test]
    fn a_manual_split_records_the_exact_bytes_and_engine_page_count() {
        let root = split_library("manual", 12);
        let source = std::fs::read(root.join("documents/R-handbook.pdf")).unwrap();
        let receipt =
            split_range_at(&root, "R", "R-handbook.pdf", "chapter", 3, 7, "Chapter").unwrap();
        assert_eq!(
            receipt.core.source_content_sha256,
            lineage::calculate_sha256(&source)
        );
        assert_eq!(receipt.core.source_total_pages, 12);
        let plan = &receipt.core.plan[0];
        assert_eq!(
            (
                plan.selection.start,
                plan.selection.end,
                plan.child_page_count
            ),
            (3, 7, 5)
        );
        let written = root.join("documents").join(&plan.file_path);
        assert_eq!(page_count(&written).unwrap(), 5);
        assert_eq!(std::fs::metadata(&written).unwrap().len(), plan.file_size);

        lineage::save_split_batch_at(&root, &receipt, &presentation(&receipt)).unwrap();
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        let pages: (u32, u32, u32) = conn
            .query_row(
                "SELECT source_page_start, source_page_end, source_total_pages
                   FROM material_split_lineage WHERE material_id = 'chapter'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(pages, (3, 7, 12));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_manual_split_of_a_pdf_the_material_does_not_own_leaves_no_file() {
        let root = split_library("not-owned", 6);
        write_pdf(&root.join("documents"), "other.pdf", 6);
        let before = std::fs::read_dir(root.join("documents")).unwrap().count();
        let error =
            split_range_at(&root, "R", "other.pdf", "chapter", 1, 2, "Chapter").unwrap_err();
        assert!(error.contains("does not belong"), "{error}");
        assert_eq!(
            std::fs::read_dir(root.join("documents")).unwrap().count(),
            before
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_automatic_split_records_every_part_against_the_same_source() {
        let root = split_library("automatic", 9);
        let receipt = split_automatically_at(
            &root,
            "R",
            "R-handbook.pdf",
            "batch",
            "Handbook.pdf",
            &|_| {},
        )
        .unwrap();
        let plan = &receipt.core.plan;
        assert!(!plan.is_empty());
        assert_eq!(plan[0].selection.start, 1);
        assert_eq!(plan.last().unwrap().selection.end, 9);
        for pair in plan.windows(2) {
            assert_eq!(pair[1].selection.start, pair[0].selection.end + 1);
        }
        lineage::save_split_batch_at(&root, &receipt, &presentation(&receipt)).unwrap();
        let conn = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        let saved: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM material_split_lineage WHERE root_material_id = 'R'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(saved as usize, plan.len());
        let _ = std::fs::remove_dir_all(root);
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
        .unwrap()
        .unwrap();
        assert_eq!((last, bytes.len() as u64), (509, 50));

        let (last, _) =
            largest_fitting_last_page(1, 2_500, 1_000, 5_000, |page| Ok(vec![0u8; page as usize]))
                .unwrap()
                .unwrap();
        assert_eq!(last, 1_000);
    }

    #[test]
    fn a_single_oversized_page_is_a_skip_but_a_render_failure_is_an_error() {
        assert!(
            largest_fitting_last_page(17, 30, 1_000, 50, |_| Ok(vec![0u8; 51]))
                .unwrap()
                .is_none()
        );
        assert_eq!(
            largest_fitting_last_page(17, 30, 1_000, 50, |_| Err("render failed".into()))
                .unwrap_err(),
            "render failed"
        );
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
        assert!(error.contains("range is too large"), "{error}");
        assert!(error.contains("Choose a shorter page range"), "{error}");
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
            .unwrap()
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

    /// The body of `split_pdf_automatically` without the Tauri handle: open,
    /// then per part window, find the largest fitting range, write. Returns
    /// the part ranges and byte sizes.
    fn automatic_split_core(source: &Path, out: &Path) -> Vec<(u32, u32, u64)> {
        let document = open_pdf(source).unwrap();
        let total = u32::try_from(document.get_pages().len()).unwrap();
        let mut parts = Vec::new();
        let mut first = 1;
        let mut number = 1;
        while first <= total {
            let window_high = total.min(first.saturating_add(MAX_PAGES - 1));
            let window = window_document(&document, first, window_high, total);
            let (last, bytes) = largest_fitting_last_page(
                first,
                window_high,
                MAX_PAGES,
                MAX_PDF_BYTES,
                |candidate| render_window_range(&window, 1, candidate - first + 1),
            )
            .unwrap()
            .unwrap();
            std::fs::write(out.join(format!("part-{number}.pdf")), &bytes).unwrap();
            parts.push((first, last, bytes.len() as u64));
            first = last + 1;
            number += 1;
        }
        parts
    }

    /// Manual measurement of automatic and manual splitting, long and
    /// image-heavy. Run in release mode:
    ///   cargo test --release --manifest-path src-tauri/Cargo.toml split_benchmark -- --ignored --nocapture
    #[test]
    #[ignore = "manual performance measurement; slow by design"]
    fn split_benchmark_long_and_image_heavy() {
        use std::time::Instant;
        const REPEATS: usize = 3;
        let dir = scratch().join("split-bench");
        std::fs::create_dir_all(&dir).unwrap();

        let fixtures = [
            ("long-3000-pages", {
                let path = dir.join("long.pdf");
                pdf_with_pages(3_000).save(&path).unwrap();
                path
            }),
            ("image-heavy-1200-pages", {
                let path = dir.join("images.pdf");
                illustrated_pdf_with_pages(1_200).save(&path).unwrap();
                path
            }),
        ];

        for (name, source) in &fixtures {
            let source_bytes = std::fs::metadata(source).unwrap().len();
            let mut automatic = Vec::new();
            let mut manual = Vec::new();
            let mut parts = Vec::new();
            for _ in 0..REPEATS {
                let out = dir.join(format!("{name}-out"));
                let _ = std::fs::remove_dir_all(&out);
                std::fs::create_dir_all(&out).unwrap();

                let started = Instant::now();
                parts = automatic_split_core(source, &out);
                automatic.push(started.elapsed().as_secs_f64() * 1000.0);

                let started = Instant::now();
                write_page_range(source, &out.join("manual.pdf"), 101, 600).unwrap();
                manual.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            automatic.sort_by(|a, b| a.partial_cmp(b).unwrap());
            manual.sort_by(|a, b| a.partial_cmp(b).unwrap());
            // The original is never modified.
            assert_eq!(std::fs::metadata(source).unwrap().len(), source_bytes);
            for (_, _, bytes) in &parts {
                assert!(*bytes <= MAX_PDF_BYTES);
            }
            println!(
                "BENCH {name}: source {source_bytes} bytes; parts {parts:?}; \
                 automatic ms median {:.0} (min {:.0}, max {:.0}); \
                 manual 101-600 ms median {:.0} (min {:.0}, max {:.0}); n={REPEATS}",
                automatic[1], automatic[0], automatic[2], manual[1], manual[0], manual[2]
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Local preparation before a Gemini request, without any network call:
    /// the page-count check `gemini::prepare_submission` runs, reading the
    /// file, Base64-encoding it, and serializing a request body of the same
    /// shape. Run in release mode:
    ///   cargo test --release --manifest-path src-tauri/Cargo.toml gemini_local_preparation_benchmark -- --ignored --nocapture
    #[test]
    #[ignore = "manual performance measurement; slow by design"]
    fn gemini_local_preparation_benchmark() {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        use std::time::Instant;
        const REPEATS: usize = 3;
        let dir = scratch().join("gemini-prep-bench");
        std::fs::create_dir_all(&dir).unwrap();
        let fixtures = [
            ("text-900-pages", {
                let path = dir.join("text.pdf");
                pdf_with_pages(900).save(&path).unwrap();
                path
            }),
            ("image-1000-pages-near-50MiB", {
                let path = dir.join("images.pdf");
                illustrated_pdf_with_pages(1_000).save(&path).unwrap();
                path
            }),
        ];
        for (name, path) in &fixtures {
            let (mut count, mut read, mut encode, mut body) =
                (Vec::new(), Vec::new(), Vec::new(), Vec::new());
            let mut sizes = (0usize, 0usize, 0usize);
            for _ in 0..REPEATS {
                let started = Instant::now();
                let pages = page_count(path).unwrap();
                count.push(started.elapsed().as_secs_f64() * 1000.0);
                assert!(pages <= MAX_PAGES);

                let started = Instant::now();
                let bytes = std::fs::read(path).unwrap();
                read.push(started.elapsed().as_secs_f64() * 1000.0);

                let started = Instant::now();
                let encoded = BASE64.encode(&bytes);
                encode.push(started.elapsed().as_secs_f64() * 1000.0);

                let started = Instant::now();
                let value = serde_json::json!({
                    "contents": [{"role": "user", "parts": [
                        {"text": "prompt"},
                        {"inline_data": {"mime_type": "application/pdf", "data": encoded}}
                    ]}]
                });
                let serialized = serde_json::to_vec(&value).unwrap();
                body.push(started.elapsed().as_secs_f64() * 1000.0);
                sizes = (bytes.len(), serialized.len(), pages as usize);
            }
            for samples in [&mut count, &mut read, &mut encode, &mut body] {
                samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
            }
            println!(
                "BENCH gemini-prep {name}: {} bytes, {} pages, body {} bytes; median ms: \
                 page count {:.0}, read {:.0}, base64 {:.0}, json body {:.0}; n={REPEATS}",
                sizes.0, sizes.2, sizes.1, count[1], read[1], encode[1], body[1]
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    use sha2::{Digest, Sha256};

    fn sha256_digest(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn generate_synthetic_fixture(
        num_pages: u32,
        img_w: u32,
        img_h: u32,
        doc_label: &str,
    ) -> Vec<u8> {
        let raster_bytes = if img_w > 0 && img_h > 0 {
            (img_w * img_h * 3) as usize
        } else {
            0
        };
        let mut chunks: Vec<u8> = Vec::new();
        let mut offsets: Vec<usize> = vec![0; (num_pages as usize) * 3 + 10];

        macro_rules! write_bytes {
            ($b:expr) => {
                chunks.extend_from_slice($b);
            };
        }

        write_bytes!(b"%PDF-1.5\n%\xFF\xFF\xFF\xFF\n");
        offsets[1] = chunks.len();
        write_bytes!(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

        let mut kids_str = String::new();
        for i in 0..num_pages {
            if i > 0 {
                kids_str.push(' ');
            }
            kids_str.push_str(&format!("{} 0 R", 3 + i));
        }
        offsets[2] = chunks.len();
        write_bytes!(format!(
            "2 0 obj\n<< /Type /Pages /Count {} /Kids [{}] >>\nendobj\n",
            num_pages, kids_str
        )
        .as_bytes());

        let mut next_id = 3 + num_pages;
        let font_obj_id = next_id;
        next_id += 1;

        let mut content_obj_ids = Vec::with_capacity(num_pages as usize);
        for _ in 0..num_pages {
            content_obj_ids.push(next_id);
            next_id += 1;
        }

        let mut image_obj_ids = Vec::with_capacity(num_pages as usize);
        if raster_bytes > 0 {
            for _ in 0..num_pages {
                image_obj_ids.push(next_id);
                next_id += 1;
            }
        }

        for i in 0..num_pages {
            offsets[(3 + i) as usize] = chunks.len();
            let res = if raster_bytes > 0 {
                format!(
                    "<< /Font << /F1 {} 0 R >> /XObject << /Im0 {} 0 R >> >>",
                    font_obj_id, image_obj_ids[i as usize]
                )
            } else {
                format!("<< /Font << /F1 {} 0 R >> >>", font_obj_id)
            };
            write_bytes!(format!("{} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources {} /Contents {} 0 R >>\nendobj\n", 3 + i, res, content_obj_ids[i as usize]).as_bytes());
        }

        offsets[font_obj_id as usize] = chunks.len();
        write_bytes!(format!(
            "{} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
            font_obj_id
        )
        .as_bytes());

        for i in 0..num_pages {
            offsets[content_obj_ids[i as usize] as usize] = chunks.len();
            let page_num = i + 1;
            let page_id_text = format!(
                "Synthetic {} - Page {} of {} (ID: P{:04})",
                doc_label, page_num, num_pages, page_num
            );
            let text_stream = if raster_bytes > 0 {
                format!(
                    "q 300 0 0 250 50 450 cm /Im0 Do Q\nBT /F1 12 Tf 50 400 Td ({}) Tj ET\n",
                    page_id_text
                )
            } else {
                format!("BT /F1 12 Tf 50 750 Td ({}) Tj ET\n", page_id_text)
            };
            write_bytes!(format!(
                "{} 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
                content_obj_ids[i as usize],
                text_stream.len(),
                text_stream
            )
            .as_bytes());
        }

        if raster_bytes > 0 {
            for i in 0..num_pages {
                offsets[image_obj_ids[i as usize] as usize] = chunks.len();
                let mut img_buf = vec![0u8; raster_bytes];
                let mut state: u32 = (i + 1).wrapping_mul(1103515245).wrapping_add(12345);
                for j in (0..raster_bytes).step_by(4) {
                    state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                    let bytes = state.to_le_bytes();
                    let end = (j + 4).min(raster_bytes);
                    img_buf[j..end].copy_from_slice(&bytes[..end - j]);
                }
                write_bytes!(format!("{} 0 obj\n<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length {} >>\nstream\n", image_obj_ids[i as usize], img_w, img_h, raster_bytes).as_bytes());
                write_bytes!(&img_buf);
                write_bytes!(b"\nendstream\nendobj\n");
            }
        }

        let startxref = chunks.len();
        let total = next_id - 1;
        write_bytes!(format!("xref\n0 {}\n0000000000 65535 f \n", total + 1).as_bytes());
        for i in 1..=total {
            write_bytes!(format!("{:010} 00000 n \n", offsets[i as usize]).as_bytes());
        }
        write_bytes!(format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            total + 1,
            startxref
        )
        .as_bytes());

        chunks
    }

    fn extract_page_id_from_content(content: &lopdf::content::Content) -> Option<u32> {
        for op in &content.operations {
            if op.operator == "Tj" {
                for operand in &op.operands {
                    if let lopdf::Object::String(bytes, _) = operand {
                        let text = String::from_utf8_lossy(bytes);
                        if let Some(idx) = text.find("(ID: P") {
                            let id_part = &text[idx + 6..];
                            if let Some(end) = id_part.find(')') {
                                if let Ok(id) = id_part[..end].parse::<u32>() {
                                    return Some(id);
                                }
                            }
                        }
                    }
                }
            }
        }
        None
    }

    fn extract_page_ids_from_document(path: &Path) -> Result<Vec<u32>, String> {
        let doc = lopdf::Document::load(path)
            .map_err(|e| format!("Failed to load PDF at {}: {e}", path.display()))?;
        let pages = doc.get_pages();
        let mut page_ids = Vec::with_capacity(pages.len());
        for (&_page_num, &page_obj_id) in pages.iter() {
            let content = doc
                .get_and_decode_page_content(page_obj_id)
                .map_err(|e| format!("Failed to decode content for page {page_obj_id:?}: {e}"))?;
            let id = extract_page_id_from_content(&content).ok_or_else(|| {
                format!(
                    "No valid page ID found on page {page_obj_id:?} in {}",
                    path.display()
                )
            })?;
            page_ids.push(id);
        }
        Ok(page_ids)
    }

    fn verify_exact_page_id_sequence(
        actual_ids: &[u32],
        start: u32,
        end: u32,
    ) -> Result<(), String> {
        let expected_count = (end - start + 1) as usize;
        if actual_ids.len() != expected_count {
            return Err(format!(
                "Count mismatch: expected {} pages ({start}..={end}), got {}",
                expected_count,
                actual_ids.len()
            ));
        }
        for (i, &id) in actual_ids.iter().enumerate() {
            let expected_id = start + i as u32;
            if id != expected_id {
                return Err(format!(
                    "Sequence mismatch at index {}: expected ID {}, got {}",
                    i, expected_id, id
                ));
            }
        }
        Ok(())
    }

    #[test]
    fn synthetic_fixture_generation_matches_accepted_specs() {
        let a = generate_synthetic_fixture(10, 0, 0, "Checklist");
        assert_eq!(a.len(), 3360);
        assert_eq!(
            sha256_digest(&a),
            "f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134"
        );
        let doc_a = lopdf::Document::load_mem(&a).unwrap();
        let pages_a = doc_a.get_pages();
        assert_eq!(pages_a.len(), 10);
        let mut ids_a = Vec::with_capacity(10);
        for (&_page_num, &page_obj_id) in pages_a.iter() {
            let content = doc_a.get_and_decode_page_content(page_obj_id).unwrap();
            ids_a.push(extract_page_id_from_content(&content).unwrap());
        }
        verify_exact_page_id_sequence(&ids_a, 1, 10).unwrap();

        let b = generate_synthetic_fixture(1050, 0, 0, "Handbook");
        assert_eq!(b.len(), 330934);
        assert_eq!(
            sha256_digest(&b),
            "0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1"
        );
        let doc_b = lopdf::Document::load_mem(&b).unwrap();
        assert_eq!(doc_b.get_pages().len(), 1050);
    }

    #[test]
    fn automatic_and_manual_splitting_on_1050_page_fixture() {
        let dir = scratch().join("fixture-b-split");
        std::fs::create_dir_all(&dir).unwrap();

        let source_path = dir.join("synthetic-long-manual.pdf");
        let bytes = generate_synthetic_fixture(1050, 0, 0, "Handbook");
        std::fs::write(&source_path, &bytes).unwrap();
        let initial_hash = sha256_digest(&std::fs::read(&source_path).unwrap());
        assert_eq!(
            initial_hash,
            "0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1"
        );

        let out_dir = dir.join("parts");
        std::fs::create_dir_all(&out_dir).unwrap();

        let parts = automatic_split_core(&source_path, &out_dir);
        assert_eq!(
            parts.len(),
            2,
            "1,050 pages split at MAX_PAGES (1,000) must produce 2 parts"
        );
        assert_eq!(parts[0].0, 1);
        assert_eq!(parts[0].1, 1000);
        assert!(parts[0].2 <= MAX_PDF_BYTES);
        assert_eq!(parts[1].0, 1001);
        assert_eq!(parts[1].1, 1050);
        assert!(parts[1].2 <= MAX_PDF_BYTES);

        // Verify child files load cleanly and report expected page counts
        let part1_path = out_dir.join("part-1.pdf");
        let part2_path = out_dir.join("part-2.pdf");
        assert_eq!(page_count(&part1_path).unwrap(), 1000);
        assert_eq!(page_count(&part2_path).unwrap(), 50);

        // Verify full ordered sequence of IDs for each child part
        let part1_ids = extract_page_ids_from_document(&part1_path).unwrap();
        verify_exact_page_id_sequence(&part1_ids, 1, 1000).unwrap();
        let part2_ids = extract_page_ids_from_document(&part2_path).unwrap();
        verify_exact_page_id_sequence(&part2_ids, 1001, 1050).unwrap();

        // Verify combined coverage covers all 1..=1050 source pages exactly once
        let mut combined_ids = part1_ids;
        combined_ids.extend(part2_ids);
        verify_exact_page_id_sequence(&combined_ids, 1, 1050).unwrap();

        // Test manual range 101..=300 extracts exactly 200 pages
        let manual_dest = dir.join("manual-101-300.pdf");
        let written = write_page_range(&source_path, &manual_dest, 101, 300).unwrap();
        assert_eq!(written, 200);
        assert_eq!(page_count(&manual_dest).unwrap(), 200);
        assert!(std::fs::metadata(&manual_dest).unwrap().len() <= MAX_PDF_BYTES);

        // Verify manual range contains exactly IDs 101..=300 in order, excluding outside pages
        let manual_ids = extract_page_ids_from_document(&manual_dest).unwrap();
        verify_exact_page_id_sequence(&manual_ids, 101, 300).unwrap();

        // Source file hash must remain completely identical
        let final_hash = sha256_digest(&std::fs::read(&source_path).unwrap());
        assert_eq!(final_hash, initial_hash);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn negative_regression_page_id_coverage_validator_rejects_wrong_repeated_or_reordered_ids() {
        // Correct count (200), but wrong start offset (1..=200 instead of 101..=300)
        let wrong_offset: Vec<u32> = (1..=200).collect();
        let res_offset = verify_exact_page_id_sequence(&wrong_offset, 101, 300);
        assert!(res_offset.is_err());
        assert!(res_offset
            .unwrap_err()
            .contains("Sequence mismatch at index 0"));

        // Correct count (4), but duplicated / repeated ID ([1, 2, 2, 4])
        let repeated = vec![1, 2, 2, 4];
        let res_repeat = verify_exact_page_id_sequence(&repeated, 1, 4);
        assert!(res_repeat.is_err());
        assert!(res_repeat
            .unwrap_err()
            .contains("Sequence mismatch at index 2"));

        // Correct count (4), but reordered / out-of-order IDs ([1, 3, 2, 4])
        let reordered = vec![1, 3, 2, 4];
        let res_reorder = verify_exact_page_id_sequence(&reordered, 1, 4);
        assert!(res_reorder.is_err());
        assert!(res_reorder
            .unwrap_err()
            .contains("Sequence mismatch at index 1"));

        // Count mismatch
        let short_seq = vec![1, 2, 3];
        let res_count = verify_exact_page_id_sequence(&short_seq, 1, 4);
        assert!(res_count.is_err());
        assert!(res_count.unwrap_err().contains("Count mismatch"));

        // Test with a synthetic PDF containing deliberately wrong page IDs
        let dir = scratch().join("fixture-negative-regression");
        std::fs::create_dir_all(&dir).unwrap();
        let bad_pdf_path = dir.join("corrupted-page-ids.pdf");

        // Generate a 3-page PDF where page 2 duplicates page 1's ID text
        let mut chunks = Vec::new();
        let mut offsets = [0usize; 9];
        macro_rules! write_bad {
            ($b:expr) => {
                chunks.extend_from_slice($b);
            };
        }
        write_bad!(b"%PDF-1.5\n%\xff\xff\xff\xff\n");
        offsets[1] = chunks.len();
        write_bad!(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        offsets[2] = chunks.len();
        write_bad!(b"2 0 obj\n<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>\nendobj\n");
        offsets[3] = chunks.len();
        write_bad!(b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>\nendobj\n");
        offsets[4] = chunks.len();
        write_bad!(b"4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>\nendobj\n"); // points to page 1's contents!
        offsets[5] = chunks.len();
        write_bad!(b"5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>\nendobj\n");
        offsets[6] = chunks.len();
        write_bad!(b"6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
        offsets[7] = chunks.len();
        let p1_text = "BT /F1 12 Tf 50 750 Td (Synthetic Bad - Page 1 of 3 (ID: P0001)) Tj ET\n";
        write_bad!(format!(
            "7 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
            p1_text.len(),
            p1_text
        )
        .as_bytes());
        offsets[8] = chunks.len();
        let p3_text = "BT /F1 12 Tf 50 750 Td (Synthetic Bad - Page 3 of 3 (ID: P0003)) Tj ET\n";
        write_bad!(format!(
            "8 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
            p3_text.len(),
            p3_text
        )
        .as_bytes());
        let startxref = chunks.len();
        write_bad!(b"xref\n0 9\n0000000000 65535 f \n");
        for offset in &offsets[1..=8] {
            write_bad!(format!("{:010} 00000 n \n", offset).as_bytes());
        }
        write_bad!(format!(
            "trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            startxref
        )
        .as_bytes());

        std::fs::write(&bad_pdf_path, &chunks).unwrap();
        let extracted_ids = extract_page_ids_from_document(&bad_pdf_path).unwrap();
        // Page 1 has ID 1, Page 2 points to Content 7 so has ID 1, Page 3 has ID 3
        assert_eq!(extracted_ids, vec![1, 1, 3]);
        // The validator must reject this even though count is 3
        assert_eq!(page_count(&bad_pdf_path).unwrap(), 3);
        let res = verify_exact_page_id_sequence(&extracted_ids, 1, 3);
        assert!(res.is_err(), "Validator must reject duplicated/wrong IDs");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "opt-in verification on byte-heavy 54 MiB fixture"]
    fn opt_in_byte_heavy_charts_fixture_split() {
        let dir = scratch().join("fixture-c-split");
        std::fs::create_dir_all(&dir).unwrap();

        let source_path = dir.join("synthetic-illustrated-charts.pdf");
        let bytes = generate_synthetic_fixture(60, 600, 500, "Charts");
        assert_eq!(bytes.len(), 54032644);
        assert_eq!(
            sha256_digest(&bytes),
            "b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d"
        );
        std::fs::write(&source_path, &bytes).unwrap();
        let initial_hash = sha256_digest(&std::fs::read(&source_path).unwrap());

        let out_dir = dir.join("parts");
        std::fs::create_dir_all(&out_dir).unwrap();

        let parts = automatic_split_core(&source_path, &out_dir);
        assert_eq!(
            parts.len(),
            2,
            "54 MB fixture must split into 2 parts under 50 MiB limit"
        );
        for (first, last, size) in &parts {
            assert!(
                *size <= MAX_PDF_BYTES,
                "Each part must obey MAX_PDF_BYTES (50 MiB)"
            );
            assert!(
                last - first < MAX_PAGES,
                "Each part must obey MAX_PAGES (1,000)"
            );
        }
        assert_eq!(parts[0].0, 1);
        assert_eq!(parts[0].1, 58);
        assert_eq!(parts[1].0, 59);
        assert_eq!(parts[1].1, 60);

        let part1_path = out_dir.join("part-1.pdf");
        let part2_path = out_dir.join("part-2.pdf");
        assert_eq!(page_count(&part1_path).unwrap(), 58);
        assert_eq!(page_count(&part2_path).unwrap(), 2);

        // Verify full ordered sequence of IDs for byte-heavy output parts
        let part1_ids = extract_page_ids_from_document(&part1_path).unwrap();
        verify_exact_page_id_sequence(&part1_ids, 1, 58).unwrap();
        let part2_ids = extract_page_ids_from_document(&part2_path).unwrap();
        verify_exact_page_id_sequence(&part2_ids, 59, 60).unwrap();

        // Verify combined coverage across all 60 pages
        let mut combined_ids = part1_ids;
        combined_ids.extend(part2_ids);
        verify_exact_page_id_sequence(&combined_ids, 1, 60).unwrap();

        // Manual range 10..=20 extracts exactly 11 pages
        let manual_dest = dir.join("manual-10-20.pdf");
        let written = write_page_range(&source_path, &manual_dest, 10, 20).unwrap();
        assert_eq!(written, 11);
        assert_eq!(page_count(&manual_dest).unwrap(), 11);
        assert!(std::fs::metadata(&manual_dest).unwrap().len() <= MAX_PDF_BYTES);

        // Verify manual range contains exactly IDs 10..=20 in order
        let manual_ids = extract_page_ids_from_document(&manual_dest).unwrap();
        verify_exact_page_id_sequence(&manual_ids, 10, 20).unwrap();

        // Source file hash untouched
        let final_hash = sha256_digest(&std::fs::read(&source_path).unwrap());
        assert_eq!(final_hash, initial_hash);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
