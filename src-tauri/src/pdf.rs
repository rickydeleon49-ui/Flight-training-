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

use std::path::{Path, PathBuf};

use lopdf::Document;
use tauri::AppHandle;

use crate::documents::{self, ImportedDocument};

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
    document.delete_pages(&removing);

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

fn largest_fitting_last_page<F>(
    first: u32,
    total: u32,
    max_pages: u32,
    max_bytes: u64,
    mut write_candidate: F,
) -> Result<(u32, u64), String>
where
    F: FnMut(u32) -> Result<u64, String>,
{
    let mut low = first;
    let mut high = total.min(first.saturating_add(max_pages - 1));
    let mut best = None;

    while low <= high {
        let middle = low + (high - low) / 2;
        let bytes = write_candidate(middle)?;
        if bytes <= max_bytes {
            best = Some((middle, bytes));
            low = middle.saturating_add(1);
        } else if middle == first {
            break;
        } else {
            high = middle - 1;
        }
    }

    match best {
        Some((last, _)) => Ok((last, write_candidate(last)?)),
        None => Err(format!(
            "Page {first} is larger than 50 MB by itself. Compress that PDF and try again."
        )),
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

    let file_size = std::fs::metadata(&destination)
        .map_err(|e| format!("The split PDF could not be read back: {e}"))?
        .len();

    Ok(ImportedDocument {
        relative_path: stored_name,
        original_file_name,
        file_size,
    })
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
        let mut created_paths = Vec::new();
        let result = (|| {
            let mut parts = Vec::new();
            let mut first = 1;
            let mut number = 1;
            while first <= total {
                let part_name = format!("{base} - Part {number}.pdf");
                let part_id = format!("{batch_id}-part-{number}");
                let (destination, stored_name) =
                    documents::stored_destination(&app, &part_id, &part_name)?;
                created_paths.push(destination.clone());

                let (last, file_size) = largest_fitting_last_page(
                    first,
                    total,
                    MAX_PAGES,
                    MAX_PDF_BYTES,
                    |candidate| {
                        write_page_range_from_document(&document, &destination, first, candidate)?;
                        std::fs::metadata(&destination)
                            .map(|metadata| metadata.len())
                            .map_err(|e| format!("The split PDF could not be read back: {e}"))
                    },
                )?;

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
    fn the_new_document_is_named_like_the_pdf_it_is() {
        assert_eq!(pdf_file_name("PHAK chapter 3"), "PHAK chapter 3.pdf");
        assert_eq!(pdf_file_name("PHAK chapter 3.pdf"), "PHAK chapter 3.pdf");
        assert_eq!(pdf_file_name("  "), "chapter.pdf");
    }

    #[test]
    fn automatic_ranges_use_the_largest_fitting_page_and_respect_page_limit() {
        let (last, bytes) =
            largest_fitting_last_page(1, 2_500, 1_000, 50, |page| Ok(u64::from(page) / 10))
                .unwrap();
        assert_eq!((last, bytes), (509, 50));

        let (last, _) =
            largest_fitting_last_page(1, 2_500, 1_000, 5_000, |page| Ok(u64::from(page))).unwrap();
        assert_eq!(last, 1_000);
    }

    #[test]
    fn a_single_oversized_page_gets_an_actionable_error() {
        let error = largest_fitting_last_page(17, 30, 1_000, 50, |_| Ok(51)).unwrap_err();
        assert!(error.contains("Page 17"));
        assert!(error.contains("Compress"));
    }
}
