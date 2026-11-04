//! Adding a file: the phone accepts only small PDFs and never leaves a partial
//! or temporary file behind; the Mac behaves as it always did.

use super::*;
use lopdf::{dictionary, Document, Object};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

const BIG: PhoneLimits = PhoneLimits {
    max_bytes: u64::MAX,
    max_pages: 1_000,
};

fn scratch() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("hfd-import-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("source")).unwrap();
    dir
}

pub(crate) fn write_pdf(path: &Path, pages: u32) {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let kids: Vec<Object> = (0..pages)
        .map(|_| {
            doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            })
            .into()
        })
        .collect();
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Count" => i64::from(pages), "Kids" => kids,
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc.save(path).unwrap();
}

fn names(dir: &Path) -> Vec<String> {
    match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn nothing_left(docs: &Path) {
    let top: Vec<String> = names(docs)
        .into_iter()
        .filter(|n| n != ".incoming")
        .collect();
    assert!(top.is_empty(), "{top:?}");
    assert!(names(&docs.join(".incoming")).is_empty());
}

#[test]
fn file_url_with_percent_encoding_imports() {
    let c = scratch();
    let src = c.join("source").join("My PDF.pdf");
    write_pdf(&src, 1);
    let url = format!("file://{}", src.to_string_lossy().replace(' ', "%20"));
    let docs = c.join("documents");
    let done = import_document_in(&docs, &url, "m1", true, true, BIG).unwrap();
    assert_eq!(done.original_file_name, "My PDF.pdf");
    assert!(docs.join(&done.relative_path).is_file());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_refuses_non_pdf() {
    let c = scratch();
    let src = c.join("source").join("notes.txt");
    std::fs::write(&src, b"hello").unwrap();
    let docs = c.join("documents");
    let err = import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, BIG)
        .err()
        .unwrap();
    assert_eq!(
        err,
        "On the phone you can add PDFs. Other files can be added on your Mac."
    );
    nothing_left(&docs);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_refuses_empty_file() {
    let c = scratch();
    let src = c.join("source").join("later.pdf");
    std::fs::write(&src, b"").unwrap();
    let docs = c.join("documents");
    let err = import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, BIG)
        .err()
        .unwrap();
    assert!(err.contains("hasn't finished downloading"), "{err}");
    nothing_left(&docs);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_refuses_oversize_before_copying() {
    let c = scratch();
    let src = c.join("source").join("big.pdf");
    std::fs::write(&src, b"12345678901").unwrap();
    let docs = c.join("documents");
    let limits = PhoneLimits {
        max_bytes: 10,
        max_pages: 1_000,
    };
    let err = import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, limits)
        .err()
        .unwrap();
    assert!(err.contains("bigger than 50 MB"), "{err}");
    nothing_left(&docs);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_refuses_too_many_pages_and_leaves_no_file() {
    let c = scratch();
    let src = c.join("source").join("long.pdf");
    write_pdf(&src, 3);
    let docs = c.join("documents");
    let limits = PhoneLimits {
        max_bytes: u64::MAX,
        max_pages: 2,
    };
    let err = import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, limits)
        .err()
        .unwrap();
    assert!(err.contains("more than 1 000 pages"), "{err}");
    nothing_left(&docs);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_refuses_an_unreadable_pdf_and_leaves_no_file() {
    let c = scratch();
    let src = c.join("source").join("broken.pdf");
    std::fs::write(&src, b"not a pdf at all").unwrap();
    let docs = c.join("documents");
    assert!(import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, BIG).is_err());
    nothing_left(&docs);
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_accepts_a_small_pdf_with_identity() {
    let c = scratch();
    let src = c.join("source").join("small.PDF");
    write_pdf(&src, 3);
    let docs = c.join("documents");
    let done = import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, BIG).unwrap();
    assert_eq!(done.pdf_identity.as_ref().unwrap().total_pages, 3);
    assert!(docs.join(&done.relative_path).is_file());
    assert_eq!(
        std::fs::metadata(docs.join(&done.relative_path))
            .unwrap()
            .len(),
        done.file_size
    );
    assert_eq!(names(&docs).len(), 2); // the PDF and the empty .incoming folder
    assert!(names(&docs.join(".incoming")).is_empty());
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn mac_still_imports_anything() {
    let c = scratch();
    let src = c.join("source").join("notes.txt");
    std::fs::write(&src, b"hello").unwrap();
    let docs = c.join("documents");
    std::fs::create_dir_all(&docs).unwrap();
    let done = import_document_in(&docs, src.to_str().unwrap(), "m1", false, false, BIG).unwrap();
    assert!(done.pdf_identity.is_none());
    assert_eq!(
        std::fs::read(docs.join(&done.relative_path)).unwrap(),
        b"hello"
    );
    std::fs::remove_dir_all(c).unwrap();
}

#[test]
fn phone_import_uses_a_temp_then_renames() {
    let c = scratch();
    let src = c.join("source").join("a.pdf");
    write_pdf(&src, 1);
    let docs = c.join("documents");
    let done = import_document_in(&docs, src.to_str().unwrap(), "m1", true, true, BIG).unwrap();
    let stored = docs.join(&done.relative_path);
    assert_eq!(
        std::fs::read(&stored).unwrap(),
        std::fs::read(&src).unwrap()
    );
    assert!(!docs
        .join(".incoming")
        .join(format!("{}.tmp", done.relative_path))
        .exists());
    std::fs::remove_dir_all(c).unwrap();
}
