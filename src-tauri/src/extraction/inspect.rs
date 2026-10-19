//! Per-page outcomes that never guess (OFFLINE-01 proposal §4.4).
//!
//! A page's content and every Form XObject it invokes are inspected,
//! recursively and within fixed bounds, for text-showing operators and drawn
//! images. Only a complete inspection can call a page blank or image-only;
//! anything missing, cyclic, too deep, unsupported or malformed makes it
//! incomplete, and the page is reported as `unknown` unless it yielded text.

use lopdf::content::Content;
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};

/// Forms nested deeper than this make an inspection incomplete.
pub const MAX_FORM_DEPTH: usize = 8;

/// A page's decoded content, including every form it invokes, may not
/// exceed this. Decoding stops at the limit, so an outsized page (a real
/// handbook page decodes to 60 MB and 2 million operations) never costs
/// more than this before it is refused. Such a page is `failed` with
/// `page_content_limit`; the rest of the document carries on.
pub const MAX_PAGE_CONTENT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// Non-empty extracted text.
    Text,
    /// Complete inspection: no text-showing operators and no image drawn.
    Blank,
    /// Complete inspection: an image drawn and no text-showing operators.
    /// It says the page's content is an image, not that it was scanned.
    ImageOnly,
    /// Text-showing operators, but no usable text came out.
    TextUnreadable,
    /// Inspection was incomplete.
    Unknown,
    /// The page's content could not be read at all.
    Failed,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Inspection {
    pub shows_text: bool,
    pub draws_image: bool,
    /// Text was shown in a composite (Type0) font with no `/ToUnicode` map.
    /// `lopdf` still returns *something* for it (glyph ids), so the page's
    /// text cannot be trusted.
    pub unmapped_text: bool,
    pub complete: bool,
    /// The page's own content stream could not be read or parsed.
    pub unreadable_page: bool,
    /// The page's decoded content passed `MAX_PAGE_CONTENT_BYTES`.
    pub content_too_large: bool,
    /// Decoded bytes charged to this page, including partial output before
    /// a decoder error.
    pub decoded_bytes: usize,
}

/// Why strict decoding gave up.
enum Refused {
    Unreadable,
    TooLarge,
}

/// Decoded bytes still allowed for the current page. Once exhausted it
/// stays exhausted: nothing more is decoded anywhere in the page's walk.
struct Budget {
    left: usize,
    used: usize,
    exhausted: bool,
}

impl Budget {
    fn new(limit: usize) -> Self {
        Self {
            left: limit,
            used: 0,
            exhausted: false,
        }
    }

    fn take(&mut self, n: usize) -> Result<(), Refused> {
        self.used = self.used.saturating_add(n);
        match self.left.checked_sub(n) {
            Some(left) => {
                self.left = left;
                Ok(())
            }
            None => {
                self.left = 0;
                self.exhausted = true;
                Err(Refused::TooLarge)
            }
        }
    }
}

/// Inspect one page. Never panics; every failure only clears `complete`.
pub fn inspect_page(doc: &Document, page_id: ObjectId) -> Inspection {
    inspect_page_within(doc, page_id, MAX_PAGE_CONTENT_BYTES)
}

/// `inspect_page` with an explicit content budget, for tests.
pub fn inspect_page_within(doc: &Document, page_id: ObjectId, budget: usize) -> Inspection {
    let mut budget = Budget::new(budget);
    let mut found = Inspection {
        complete: true,
        ..Inspection::default()
    };
    let resources = page_resources(doc, page_id);
    let Some(resources) = resources else {
        found.complete = false;
        found.unreadable_page = true;
        return found;
    };
    let content = match strict_page_content(doc, page_id, &mut budget) {
        Ok(bytes) => Content::decode_strict(&bytes).ok(),
        Err(Refused::TooLarge) => {
            found.complete = false;
            found.content_too_large = true;
            found.decoded_bytes = budget.used;
            return found;
        }
        Err(Refused::Unreadable) => None,
    };
    let Some(content) = content else {
        found.complete = false;
        found.unreadable_page = true;
        found.decoded_bytes = budget.used;
        return found;
    };
    let mut walker = Walker {
        doc,
        stack: Vec::new(),
        budget,
        found,
    };
    walker.walk(&content, &resources, 0, &mut false);
    let mut found = walker.found;
    found.decoded_bytes = walker.budget.used;
    found
}

/// A stream's decoded bytes, or `None` unless decoding is known to be
/// complete. `lopdf` logs and keeps partial output for corrupt Flate or LZW
/// data and silently skips missing content objects, so it cannot tell a
/// blank page from an unreadable one. Only unfiltered streams and a single
/// FlateDecode with no predictor are accepted; the zlib stream must reach its
/// verified end. Anything else is treated as unreadable, never as empty.
///
/// Decoding counts against `budget` and stops as soon as it would pass it.
fn strict_stream_bytes(stream: &lopdf::Stream, budget: &mut Budget) -> Result<Vec<u8>, Refused> {
    let filter = match stream.dict.get(b"Filter") {
        Err(_) => {
            budget.take(stream.content.len())?;
            return Ok(stream.content.clone());
        }
        Ok(Object::Name(name)) => name.as_slice(),
        Ok(Object::Array(list)) if list.len() == 1 => {
            list[0].as_name().map_err(|_| Refused::Unreadable)?
        }
        Ok(_) => return Err(Refused::Unreadable),
    };
    if filter != b"FlateDecode" {
        return Err(Refused::Unreadable);
    }
    if let Ok(params) = stream.dict.get(b"DecodeParms") {
        let predictor = match params {
            // Absent means 1; a present value must be exactly the integer 1.
            Object::Dictionary(d) => match d.get(b"Predictor") {
                Err(_) => 1,
                Ok(Object::Integer(n)) => *n,
                Ok(_) => return Err(Refused::Unreadable),
            },
            Object::Null => 1,
            _ => return Err(Refused::Unreadable),
        };
        if predictor != 1 {
            return Err(Refused::Unreadable);
        }
    }
    use std::io::Read;
    let mut out = Vec::new();
    // Saturating: an unlimited budget (usize::MAX) must not wrap to 0.
    let limit = (budget.left as u64).saturating_add(1);
    let read = flate2::read::ZlibDecoder::new(stream.content.as_slice())
        .take(limit)
        .read_to_end(&mut out);
    // Charge what was produced even when decoding then failed.
    budget.take(out.len())?;
    read.map_err(|_| Refused::Unreadable)?;
    // Stopping at the limit leaves the zlib stream unfinished, so only a
    // stream that fit is known to be complete; the reader errors on a
    // truncated or corrupt one.
    Ok(out)
}

/// Every entry of the page's `/Contents`, resolved and strictly decoded.
/// A page with no `/Contents` is legitimately empty; a dangling reference,
/// a non-stream entry or any undecodable stream makes the page unreadable.
fn strict_page_content(
    doc: &Document,
    page_id: ObjectId,
    budget: &mut Budget,
) -> Result<Vec<u8>, Refused> {
    let page = doc
        .get_dictionary(page_id)
        .map_err(|_| Refused::Unreadable)?;
    let entries: Vec<ObjectId> = match page.get(b"Contents") {
        Err(_) => return Ok(Vec::new()),
        Ok(Object::Reference(id)) => vec![*id],
        Ok(Object::Array(list)) => list
            .iter()
            .map(|o| o.as_reference().ok())
            .collect::<Option<Vec<_>>>()
            .ok_or(Refused::Unreadable)?,
        Ok(_) => return Err(Refused::Unreadable),
    };
    let mut content = Vec::new();
    for id in entries {
        let stream = doc
            .get_object(id)
            .and_then(Object::as_stream)
            .map_err(|_| Refused::Unreadable)?;
        content.extend_from_slice(&strict_stream_bytes(stream, budget)?);
        content.push(b'\n');
    }
    Ok(content)
}

/// The page's resource dictionaries, nearest first (own, then inherited).
fn page_resources(doc: &Document, page_id: ObjectId) -> Option<Vec<Dictionary>> {
    let (own, inherited) = doc.get_page_resources(page_id).ok()?;
    let mut all = Vec::new();
    if let Some(own) = own {
        all.push(own.clone());
    }
    for id in inherited {
        all.push(doc.get_dictionary(id).ok()?.clone());
    }
    Some(all)
}

/// Traversal state shared by one page's walk: the document, the forms
/// being walked (for cycle detection), the page's content budget and what
/// has been found so far.
struct Walker<'d> {
    doc: &'d Document,
    stack: Vec<ObjectId>,
    budget: Budget,
    found: Inspection,
}

impl Walker<'_> {
    fn walk(
        &mut self,
        content: &Content<Vec<lopdf::content::Operation>>,
        resources: &[Dictionary],
        depth: usize,
        font_unmapped: &mut bool,
    ) {
        // The selected font is graphics state: `q` saves it, `Q` restores it.
        let mut saved: Vec<bool> = Vec::new();
        for op in &content.operations {
            if self.budget.exhausted {
                return;
            }
            match op.operator.as_str() {
                "q" => saved.push(*font_unmapped),
                "Q" => {
                    if let Some(previous) = saved.pop() {
                        *font_unmapped = previous;
                    }
                }
                "Tf" => {
                    *font_unmapped = op
                        .operands
                        .first()
                        .and_then(|o| o.as_name().ok())
                        .map(|name| is_unmapped_composite(self.doc, name, resources))
                        .unwrap_or(false);
                }
                "Tj" | "TJ" | "'" | "\"" => {
                    self.found.shows_text = true;
                    if *font_unmapped {
                        self.found.unmapped_text = true;
                    }
                }
                "BI" => self.found.draws_image = true,
                "Do" => {
                    let name = op.operands.first().and_then(|o| o.as_name().ok());
                    match name {
                        Some(name) => self.invoke(name, resources, depth, font_unmapped),
                        None => self.found.complete = false,
                    }
                }
                _ => {}
            }
        }
    }

    /// Resolve one `Do` operand and follow it: an image is noted, a form is
    /// walked with its own resources (falling back to the caller's), and
    /// anything else leaves the inspection incomplete.
    fn invoke(
        &mut self,
        name: &[u8],
        resources: &[Dictionary],
        depth: usize,
        font_unmapped: &mut bool,
    ) {
        let target = resources.iter().find_map(|r| {
            let xobjects = match r.get(b"XObject").ok()? {
                Object::Reference(id) => self.doc.get_dictionary(*id).ok()?,
                Object::Dictionary(d) => d,
                _ => return None,
            };
            match xobjects.get(name).ok()? {
                Object::Reference(id) => Some(*id),
                _ => None,
            }
        });
        let Some(id) = target else {
            self.found.complete = false;
            return;
        };
        let Ok(Object::Stream(stream)) = self.doc.get_object(id) else {
            self.found.complete = false;
            return;
        };
        let subtype = stream.dict.get(b"Subtype").and_then(Object::as_name).ok();
        match subtype {
            Some(b"Image") => self.found.draws_image = true,
            Some(b"Form") => {
                if depth + 1 > MAX_FORM_DEPTH || self.stack.contains(&id) {
                    self.found.complete = false;
                    return;
                }
                let content = match strict_stream_bytes(stream, &mut self.budget) {
                    Ok(bytes) => Content::decode_strict(&bytes).ok(),
                    Err(Refused::TooLarge) => {
                        self.found.complete = false;
                        self.found.content_too_large = true;
                        return;
                    }
                    Err(Refused::Unreadable) => None,
                };
                let Some(content) = content else {
                    self.found.complete = false;
                    return;
                };
                let own = match stream.dict.get(b"Resources") {
                    Ok(Object::Dictionary(d)) => Some(d.clone()),
                    Ok(Object::Reference(r)) => match self.doc.get_dictionary(*r) {
                        Ok(d) => Some(d.clone()),
                        Err(_) => {
                            self.found.complete = false;
                            return;
                        }
                    },
                    _ => None,
                };
                let scoped: Vec<Dictionary> = match own {
                    Some(d) => std::iter::once(d)
                        .chain(resources.iter().cloned())
                        .collect(),
                    None => resources.to_vec(),
                };
                // A form inherits the caller's graphics state, including the
                // selected font, and invoking it is an implicit `q`/`Q`.
                let caller_font = *font_unmapped;
                self.stack.push(id);
                self.walk(&content, &scoped, depth + 1, font_unmapped);
                self.stack.pop();
                *font_unmapped = caller_font;
            }
            _ => self.found.complete = false,
        }
    }
}

/// A Type0 (composite) font whose glyph ids `lopdf` cannot turn into text.
/// `lopdf` decodes such a font through its `/ToUnicode` map only when
/// `get_font_encoding` yields a parsed map; on a missing, null, dangling or
/// corrupt map it silently falls back to a one-byte encoding and produces
/// glyph bytes as "text". So the same function decides here: anything other
/// than a parsed map is unmapped.
fn is_unmapped_composite(doc: &Document, name: &[u8], resources: &[Dictionary]) -> bool {
    let font = resources.iter().find_map(|r| {
        let fonts = match r.get(b"Font").ok()? {
            Object::Reference(id) => doc.get_dictionary(*id).ok()?,
            Object::Dictionary(d) => d,
            _ => return None,
        };
        match fonts.get(name).ok()? {
            Object::Reference(id) => doc.get_dictionary(*id).ok(),
            Object::Dictionary(d) => Some(d),
            _ => None,
        }
    });
    match font {
        Some(f) => {
            f.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Type0".as_slice())
                && !matches!(
                    f.get_font_encoding(doc),
                    Ok(lopdf::Encoding::UnicodeMapEncoding(_))
                )
        }
        None => false,
    }
}

/// Decide a page's outcome from its inspection and extracted text. A page
/// whose own content couldn't be read is `failed` even if some text came
/// out, since that text may be only part of the page.
pub fn outcome(inspection: &Inspection, text: &str) -> Outcome {
    if inspection.unreadable_page || inspection.content_too_large {
        Outcome::Failed
    } else if inspection.unmapped_text {
        Outcome::TextUnreadable
    } else if !text.trim().is_empty() {
        Outcome::Text
    } else if !inspection.complete {
        Outcome::Unknown
    } else if inspection.shows_text {
        Outcome::TextUnreadable
    } else if inspection.draws_image {
        Outcome::ImageOnly
    } else {
        Outcome::Blank
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    /// A one-page document from raw content, with optional extra
    /// resources and objects. Synthetic only.
    pub(crate) struct PdfBuilder {
        pub doc: Document,
        pages_id: ObjectId,
        kids: Vec<Object>,
    }

    impl PdfBuilder {
        pub fn new() -> Self {
            let mut doc = Document::with_version("1.5");
            let pages_id = doc.new_object_id();
            Self {
                doc,
                pages_id,
                kids: Vec::new(),
            }
        }

        pub fn font(&mut self) -> ObjectId {
            self.doc.add_object(dictionary! {
                "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
                "Encoding" => "WinAnsiEncoding",
            })
        }

        pub fn image(&mut self) -> ObjectId {
            let mut s = Stream::new(
                dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
                "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8 },
                vec![0u8],
            );
            s.allows_compression = false;
            self.doc.add_object(s)
        }

        pub fn form(&mut self, content: &str, resources: Dictionary) -> ObjectId {
            let s = Stream::new(
                dictionary! { "Type" => "XObject", "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 100.into(), 100.into()], "Resources" => resources },
                content.as_bytes().to_vec(),
            );
            self.doc.add_object(s)
        }

        pub fn page(&mut self, content: &str, resources: Dictionary) -> ObjectId {
            let content_id = self
                .doc
                .add_object(Stream::new(dictionary! {}, content.as_bytes().to_vec()));
            let page = self.doc.add_object(dictionary! {
                "Type" => "Page", "Parent" => self.pages_id, "Contents" => content_id,
                "Resources" => resources,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            });
            self.kids.push(page.into());
            page
        }

        pub fn finish(mut self) -> Document {
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
            self.doc
        }

        pub fn bytes(self) -> Vec<u8> {
            let mut doc = self.finish();
            let mut out = Vec::new();
            doc.save_to(&mut out).unwrap();
            out
        }
    }

    fn first_page(doc: &Document) -> ObjectId {
        *doc.get_pages().values().next().unwrap()
    }

    fn classify(b: PdfBuilder) -> (Inspection, Outcome) {
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page = first_page(&doc);
        let inspection = inspect_page(&doc, page);
        let text = doc.extract_text(&[1]).unwrap_or_default();
        let o = outcome(&inspection, &text);
        (inspection, o)
    }

    /// Diagnostic for real documents (01c): decoded content size and
    /// operation count per page. Run with
    /// `HFD_DIAG_PDF=/path HFD_DIAG_PAGES=440-460 cargo test --release --lib
    /// extraction::inspect::tests::diagnose_pages -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn diagnose_pages() {
        let path = std::env::var("HFD_DIAG_PDF").expect("HFD_DIAG_PDF");
        let range = std::env::var("HFD_DIAG_PAGES").unwrap_or_else(|_| "1-10".into());
        let (lo, hi) = range.split_once('-').unwrap();
        let (lo, hi): (u32, u32) = (lo.parse().unwrap(), hi.parse().unwrap());
        let doc = Document::load_mem(&std::fs::read(path).unwrap()).unwrap();
        for (n, id) in doc.get_pages() {
            if n < lo || n > hi {
                continue;
            }
            let raw = strict_page_content(&doc, id, &mut Budget::new(usize::MAX)).ok();
            let bytes = raw.as_ref().map(|b| b.len()).unwrap_or(0);
            let ops = raw
                .and_then(|b| Content::decode_strict(&b).ok())
                .map(|c| c.operations.len())
                .unwrap_or(0);
            println!("page {n}: decoded content {bytes} bytes, {ops} operations");
        }
    }

    /// Diagnostic for real documents (01c): resident memory after reading
    /// the file and after `lopdf` loads it. Same environment variables as
    /// `diagnose_pages`.
    #[test]
    #[ignore]
    fn diagnose_load() {
        let rss = || {
            let out = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .parse::<u64>()
                .unwrap()
                / 1024
        };
        let path = std::env::var("HFD_DIAG_PDF").expect("HFD_DIAG_PDF");
        println!("start: {} MiB", rss());
        let bytes = std::fs::read(path).unwrap();
        println!(
            "file read ({} MiB): {} MiB RSS, {} MiB counted live",
            bytes.len() >> 20,
            rss(),
            crate::extraction::alloc::COUNTER.live() >> 20
        );
        let doc = Document::load_mem(&bytes).unwrap();
        println!(
            "loaded ({} objects): {} MiB RSS, {} MiB counted live",
            doc.objects.len(),
            rss(),
            crate::extraction::alloc::COUNTER.live() >> 20
        );
        drop(bytes);
        println!(
            "file bytes dropped: {} MiB RSS, {} MiB counted live",
            rss(),
            crate::extraction::alloc::COUNTER.live() >> 20
        );
        let streams: usize = doc
            .objects
            .values()
            .filter_map(|o| o.as_stream().ok())
            .map(|s| s.content.len())
            .sum();
        println!("stream bytes held by the document: {} MiB", streams >> 20);
    }

    /// Diagnostic for real documents (01c): every page whose inspection finds
    /// text in an unmapped composite font, with that font's encoding result
    /// and the text `lopdf` would extract. Same environment variable as
    /// `diagnose_pages`.
    #[test]
    #[ignore]
    fn diagnose_unmapped() {
        let path = std::env::var("HFD_DIAG_PDF").expect("HFD_DIAG_PDF");
        let doc = Document::load_mem(&std::fs::read(path).unwrap()).unwrap();
        for (n, id) in doc.get_pages() {
            if !inspect_page(&doc, id).unmapped_text {
                continue;
            }
            let fonts = doc.get_page_fonts(id).unwrap_or_default();
            let mut described = Vec::new();
            for (name, font) in fonts {
                if font.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Type0".as_slice()) {
                    continue;
                }
                let encoding = match font.get_font_encoding(&doc) {
                    Ok(lopdf::Encoding::UnicodeMapEncoding(_)) => "parsed map",
                    Ok(_) => "fallback one-byte",
                    Err(_) => "error",
                };
                let to_unicode = match font.get(b"ToUnicode") {
                    Err(_) => "absent",
                    Ok(Object::Reference(_)) => "reference",
                    Ok(_) => "other",
                };
                described.push(format!("{}={encoding}/ToUnicode {to_unicode}", String::from_utf8_lossy(&name)));
            }
            let text = doc.extract_text(&[n]).unwrap_or_default();
            let excerpt: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(100).collect();
            println!("page {n}: [{}] text: {excerpt:?}", described.join(", "));
        }
    }

    #[test]
    fn text_page() {
        let mut b = PdfBuilder::new();
        let f = b.font();
        b.page(
            "BT /F1 12 Tf 72 700 Td (Crosswind landing) Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => f } },
        );
        assert_eq!(classify(b).1, Outcome::Text);
    }

    #[test]
    fn blank_page_needs_complete_inspection() {
        let mut b = PdfBuilder::new();
        b.page("0 0 m 10 10 l S", dictionary! {});
        let (i, o) = classify(b);
        assert!(i.complete);
        assert_eq!(o, Outcome::Blank);
    }

    #[test]
    fn image_xobject_only_is_image_only() {
        let mut b = PdfBuilder::new();
        let img = b.image();
        b.page(
            "q 100 0 0 100 0 0 cm /Im1 Do Q",
            dictionary! { "XObject" => dictionary! { "Im1" => img } },
        );
        assert_eq!(classify(b).1, Outcome::ImageOnly);
    }

    #[test]
    fn inline_image_counts_as_an_image() {
        let mut b = PdfBuilder::new();
        b.page(
            "q 10 0 0 10 0 0 cm BI /W 1 /H 1 /CS /G /BPC 8 ID \u{0} EI Q",
            dictionary! {},
        );
        let (i, o) = classify(b);
        assert!(i.draws_image);
        assert_eq!(o, Outcome::ImageOnly);
    }

    #[test]
    fn image_on_page_and_text_in_a_form_is_not_image_only() {
        let mut b = PdfBuilder::new();
        let f = b.font();
        let img = b.image();
        let form = b.form(
            "BT /F1 12 Tf (Hidden in a form) Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => f } },
        );
        b.page(
            "/Im1 Do /Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Im1" => img, "Fm1" => form } },
        );
        let (i, o) = classify(b);
        assert!(i.complete && i.shows_text && i.draws_image);
        // lopdf extracts page-level text only, so the form's text is unread.
        assert_eq!(o, Outcome::TextUnreadable);
    }

    #[test]
    fn missing_xobject_is_unknown_not_blank() {
        let mut b = PdfBuilder::new();
        b.page("/Missing Do", dictionary! {});
        let (i, o) = classify(b);
        assert!(!i.complete);
        assert_eq!(o, Outcome::Unknown);
    }

    #[test]
    fn self_referencing_form_is_cut_and_unknown() {
        let mut b = PdfBuilder::new();
        let id = b.doc.new_object_id();
        let s = Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()],
            "Resources" => dictionary! { "XObject" => dictionary! { "Fm1" => id } } },
            b"/Fm1 Do".to_vec(),
        );
        b.doc.objects.insert(id, Object::Stream(s));
        b.page(
            "/Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Fm1" => id } },
        );
        let (i, o) = classify(b);
        assert!(!i.complete);
        assert_eq!(o, Outcome::Unknown);
    }

    #[test]
    fn forms_nested_past_the_limit_are_unknown() {
        let mut b = PdfBuilder::new();
        let mut inner = b.form("0 0 m S", dictionary! {});
        for _ in 0..MAX_FORM_DEPTH {
            inner = b.form(
                "/Fm1 Do",
                dictionary! { "XObject" => dictionary! { "Fm1" => inner } },
            );
        }
        b.page(
            "/Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Fm1" => inner } },
        );
        assert_eq!(classify(b).1, Outcome::Unknown);
    }

    #[test]
    fn forms_within_the_limit_are_followed() {
        let mut b = PdfBuilder::new();
        let img = b.image();
        let mut inner = b.form(
            "/Im1 Do",
            dictionary! { "XObject" => dictionary! { "Im1" => img } },
        );
        for _ in 0..(MAX_FORM_DEPTH - 1) {
            inner = b.form(
                "/Fm1 Do",
                dictionary! { "XObject" => dictionary! { "Fm1" => inner } },
            );
        }
        b.page(
            "/Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Fm1" => inner } },
        );
        let (i, o) = classify(b);
        assert!(i.complete);
        assert_eq!(o, Outcome::ImageOnly);
    }

    #[test]
    fn malformed_content_is_failed_not_blank() {
        let mut b = PdfBuilder::new();
        b.page("BT /F1 12 Tf (unterminated", dictionary! {});
        let (_, o) = classify(b);
        assert!(matches!(o, Outcome::Failed | Outcome::Unknown), "{o:?}");
        assert_ne!(o, Outcome::Blank);
    }

    fn page_with_contents(b: &mut PdfBuilder, contents: Object) {
        let page = b.page("", dictionary! {});
        b.doc
            .get_dictionary_mut(page)
            .unwrap()
            .set("Contents", contents);
    }

    #[test]
    fn a_dangling_contents_reference_is_failed_not_blank() {
        let mut b = PdfBuilder::new();
        page_with_contents(&mut b, Object::Reference((999, 0)));
        let (i, o) = classify(b);
        assert!(i.unreadable_page);
        assert_eq!(o, Outcome::Failed);
    }

    #[test]
    fn a_valid_stream_beside_a_missing_one_is_failed() {
        let mut b = PdfBuilder::new();
        let f = b.font();
        let good = b.doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf (Half a page) Tj ET".to_vec(),
        ));
        let page = b.page("", dictionary! { "Font" => dictionary! { "F1" => f } });
        b.doc.get_dictionary_mut(page).unwrap().set(
            "Contents",
            vec![Object::Reference(good), Object::Reference((999, 0))],
        );
        let (_, o) = classify(b);
        assert_eq!(
            o,
            Outcome::Failed,
            "partial text from part of a page is not reported as the page's text"
        );
    }

    #[test]
    fn corrupt_and_unsupported_filters_are_failed_not_blank() {
        for (filter, data) in [
            ("FlateDecode", b"x\x9c not really zlib data".to_vec()),
            ("ASCIIHexDecode", b"2020>".to_vec()),
            ("LZWDecode", vec![0x80, 0x0b]),
        ] {
            let mut b = PdfBuilder::new();
            let mut s = Stream::new(dictionary! { "Filter" => filter }, data);
            s.allows_compression = false;
            let id = b.doc.add_object(s);
            page_with_contents(&mut b, Object::Reference(id));
            let (_, o) = classify(b);
            assert_eq!(o, Outcome::Failed, "{filter}");
        }
    }

    #[test]
    fn malformed_or_unsupported_predictors_are_failed() {
        for params in [
            dictionary! { "Predictor" => "Bogus" },
            dictionary! { "Predictor" => 1.5 },
            dictionary! { "Predictor" => 12, "Columns" => 4 },
        ] {
            let mut b = PdfBuilder::new();
            let mut s = Stream::new(dictionary! {}, b"0 0 m 10 10 l S ".repeat(50));
            s.compress().unwrap();
            s.dict.set("DecodeParms", params.clone());
            let id = b.doc.add_object(s);
            page_with_contents(&mut b, Object::Reference(id));
            assert_eq!(classify(b).1, Outcome::Failed, "{params:?}");
        }
        let mut b = PdfBuilder::new();
        let mut s = Stream::new(dictionary! {}, b"0 0 m 10 10 l S ".repeat(50));
        s.compress().unwrap();
        s.dict.set("DecodeParms", dictionary! { "Predictor" => 1 });
        let id = b.doc.add_object(s);
        page_with_contents(&mut b, Object::Reference(id));
        assert_eq!(
            classify(b).1,
            Outcome::Blank,
            "an explicit Predictor 1 is fine"
        );
    }

    #[test]
    fn an_outsized_page_is_failed_and_stops_at_the_budget() {
        for compress in [false, true] {
            let mut b = PdfBuilder::new();
            let mut s = Stream::new(dictionary! {}, b"0 0 m 10 10 l S ".repeat(4096));
            if compress {
                s.compress().unwrap();
            } else {
                s.allows_compression = false;
            }
            let id = b.doc.add_object(s);
            page_with_contents(&mut b, Object::Reference(id));
            let doc = Document::load_mem(&b.bytes()).unwrap();
            let page = first_page(&doc);
            let small = inspect_page_within(&doc, page, 1024);
            assert!(small.content_too_large, "compress={compress}");
            assert_eq!(outcome(&small, ""), Outcome::Failed);
            let roomy = inspect_page_within(&doc, page, 1 << 20);
            assert!(!roomy.content_too_large && roomy.complete);
            assert_eq!(outcome(&roomy, ""), Outcome::Blank);
        }
    }

    #[test]
    fn an_exhausted_budget_stops_the_whole_walk() {
        let mut b = PdfBuilder::new();
        let big = "0 0 m 10 10 l S ".repeat(200);
        let form = b.form(&big, dictionary! {});
        // Ten invocations of a form larger than the whole budget.
        b.page(
            &"/Fm1 Do ".repeat(10),
            dictionary! { "XObject" => dictionary! { "Fm1" => form } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let i = inspect_page_within(&doc, first_page(&doc), 1024);
        assert!(i.content_too_large);
        assert!(
            i.decoded_bytes < 2 * big.len(),
            "decoded {} bytes: no form is decoded after exhaustion",
            i.decoded_bytes
        );
    }

    #[test]
    fn an_exact_boundary_fits_and_one_more_byte_does_not() {
        let content = "0 0 m 10 10 l S ".repeat(64);
        for compress in [false, true] {
            let mut b = PdfBuilder::new();
            let mut s = Stream::new(dictionary! {}, content.as_bytes().to_vec());
            if compress {
                s.compress().unwrap();
            } else {
                s.allows_compression = false;
            }
            let id = b.doc.add_object(s);
            page_with_contents(&mut b, Object::Reference(id));
            let doc = Document::load_mem(&b.bytes()).unwrap();
            let page = first_page(&doc);
            let exact = inspect_page_within(&doc, page, content.len());
            assert!(
                !exact.content_too_large && exact.complete,
                "compress={compress}"
            );
            let short = inspect_page_within(&doc, page, content.len() - 1);
            assert!(short.content_too_large, "compress={compress}");
        }
    }

    #[test]
    fn decoder_errors_are_charged_and_still_unreadable() {
        let mut b = PdfBuilder::new();
        // Large enough to decode across many reads, so output exists before
        // the error; a small stream can fail inside its only read.
        let mut s = Stream::new(dictionary! {}, b"0 0 m 10 10 l S ".repeat(200_000));
        s.compress().unwrap();
        // A bad Adler-32 checksum: the data decodes, then the reader errors.
        let last = s.content.len() - 1;
        s.content[last] ^= 0xff;
        s.allows_compression = false;
        let id = b.doc.add_object(s);
        page_with_contents(&mut b, Object::Reference(id));
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let i = inspect_page_within(&doc, first_page(&doc), 8 << 20);
        assert!(i.unreadable_page && !i.content_too_large);
        assert!(
            i.decoded_bytes > 0,
            "partial output before the error was charged"
        );
        assert_eq!(outcome(&i, ""), Outcome::Failed);
    }

    /// A Type0 font with the given `/ToUnicode` entry (or none).
    fn composite_font(b: &mut PdfBuilder, to_unicode: Option<Object>) -> ObjectId {
        let descendant = b.doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "BaseFont" => "SyntheticCID",
            "CIDSystemInfo" => dictionary! { "Registry" => Object::string_literal("Adobe"),
                "Ordering" => Object::string_literal("Identity"), "Supplement" => 0 },
        });
        let mut font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "SyntheticCID",
            "Encoding" => "Identity-H", "DescendantFonts" => vec![descendant.into()],
        };
        if let Some(entry) = to_unicode {
            font.set("ToUnicode", entry);
        }
        b.doc.add_object(font)
    }

    const VALID_CMAP: &str = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n\
        /CMapName /Synthetic def /CMapType 2 def\n\
        1 begincodespacerange <0000> <FFFF> endcodespacerange\n\
        2 beginbfchar <0041> <0041> <0042> <0042> endbfchar\n\
        endcmap CMapName currentdict /CMap defineresource pop end end";

    #[test]
    fn a_valid_tounicode_map_still_yields_text() {
        let mut b = PdfBuilder::new();
        let map = b
            .doc
            .add_object(Stream::new(dictionary! {}, VALID_CMAP.as_bytes().to_vec()));
        let font = composite_font(&mut b, Some(Object::Reference(map)));
        b.page(
            "BT /F1 12 Tf <00410042> Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => font } },
        );
        let (i, o) = classify(b);
        assert!(!i.unmapped_text);
        assert_eq!(o, Outcome::Text);
    }

    #[test]
    fn unusable_tounicode_entries_are_unmapped() {
        type MakeEntry = fn(&mut PdfBuilder) -> Object;
        let make: [(&str, MakeEntry); 3] = [
            ("null", |_| Object::Null),
            ("dangling", |_| Object::Reference((9999, 0))),
            ("not a cmap", |b| {
                Object::Reference(
                    b.doc
                        .add_object(Stream::new(dictionary! {}, b"garbage".to_vec())),
                )
            }),
        ];
        for (label, entry) in make {
            let mut b = PdfBuilder::new();
            let value = entry(&mut b);
            let font = composite_font(&mut b, Some(value));
            b.page(
                "BT /F1 12 Tf <00410042> Tj ET",
                dictionary! { "Font" => dictionary! { "F1" => font } },
            );
            let (i, o) = classify(b);
            assert!(i.unmapped_text, "{label}");
            assert_ne!(o, Outcome::Text, "{label}");
        }
    }

    /// Ordinary text first (so the page has some), then the unmapped font.
    fn mixed_resources(b: &mut PdfBuilder) -> Dictionary {
        let plain = b.font();
        let cid = composite_font(b, None);
        dictionary! { "F1" => plain, "F2" => cid }
    }

    #[test]
    fn a_form_inherits_the_callers_unmapped_font() {
        let mut b = PdfBuilder::new();
        let fonts = mixed_resources(&mut b);
        // The form shows text without its own Tf: it uses the caller's font.
        let form = b.form("BT <00410042> Tj ET", dictionary! {});
        b.page(
            "BT /F1 12 Tf (Plain words) Tj ET BT /F2 12 Tf ET /Fm1 Do",
            dictionary! { "Font" => fonts, "XObject" => dictionary! { "Fm1" => form } },
        );
        let (i, o) = classify(b);
        assert!(i.unmapped_text);
        assert_eq!(o, Outcome::TextUnreadable);
    }

    #[test]
    fn nested_forms_inherit_and_restore_the_font() {
        let mut b = PdfBuilder::new();
        let fonts = mixed_resources(&mut b);
        let inner = b.form("BT <00410042> Tj ET", dictionary! {});
        let outer = b.form(
            "/Fi Do",
            dictionary! { "XObject" => dictionary! { "Fi" => inner } },
        );
        b.page(
            "BT /F2 12 Tf ET /Fo Do",
            dictionary! { "Font" => fonts, "XObject" => dictionary! { "Fo" => outer } },
        );
        assert!(
            classify(b).0.unmapped_text,
            "the unmapped font reaches a nested form"
        );
    }

    #[test]
    fn q_and_capital_q_restore_the_selected_font() {
        // Restored to the unmapped font by Q, then text is shown.
        let mut b = PdfBuilder::new();
        let fonts = mixed_resources(&mut b);
        b.page(
            "BT /F2 12 Tf ET q BT /F1 12 Tf (Plain) Tj ET Q BT <0041> Tj ET",
            dictionary! { "Font" => fonts },
        );
        assert!(classify(b).0.unmapped_text, "Q restored the unmapped font");
        // And the other way: an unmapped font inside q/Q does not leak out.
        let mut b = PdfBuilder::new();
        let fonts = mixed_resources(&mut b);
        b.page(
            "BT /F1 12 Tf ET q BT /F2 12 Tf ET Q BT (Plain again) Tj ET",
            dictionary! { "Font" => fonts },
        );
        let (i, o) = classify(b);
        assert!(!i.unmapped_text, "Q restored the plain font");
        assert_eq!(o, Outcome::Text);
    }

    #[test]
    fn a_cid_font_without_tounicode_never_yields_text() {
        let mut b = PdfBuilder::new();
        let descendant = b.doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "BaseFont" => "SyntheticCID",
            "CIDSystemInfo" => dictionary! { "Registry" => Object::string_literal("Adobe"),
                "Ordering" => Object::string_literal("Identity"), "Supplement" => 0 },
        });
        let font = b.doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "SyntheticCID",
            "Encoding" => "Identity-H", "DescendantFonts" => vec![descendant.into()],
        });
        b.page(
            "BT /F1 12 Tf <00410042> Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => font } },
        );
        let (i, o) = classify(b);
        assert!(i.shows_text);
        assert_ne!(
            o,
            Outcome::Text,
            "glyph ids without a ToUnicode map must not be reported as text"
        );
    }

    #[test]
    fn forms_count_against_the_same_page_budget() {
        let mut b = PdfBuilder::new();
        let big = "0 0 m 10 10 l S ".repeat(200);
        let form = b.form(&big, dictionary! {});
        b.page(
            "/Fm1 Do /Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Fm1" => form } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page = first_page(&doc);
        // One copy of the form fits; the second invocation does not.
        let i = inspect_page_within(&doc, page, big.len() + 64);
        assert!(i.content_too_large);
        assert_eq!(outcome(&i, ""), Outcome::Failed);
    }

    #[test]
    fn a_truncated_flate_stream_is_failed() {
        let mut b = PdfBuilder::new();
        let mut s = Stream::new(dictionary! {}, b"0 0 m 10 10 l S ".repeat(200));
        s.compress().unwrap();
        let cut = s.content.len() / 2;
        s.content.truncate(cut);
        s.allows_compression = false;
        let id = b.doc.add_object(s);
        page_with_contents(&mut b, Object::Reference(id));
        assert_eq!(classify(b).1, Outcome::Failed);
    }

    #[test]
    fn a_compressed_blank_page_is_still_blank() {
        let mut b = PdfBuilder::new();
        let mut s = Stream::new(dictionary! {}, b"0 0 m 10 10 l S ".repeat(200));
        s.compress().unwrap();
        let id = b.doc.add_object(s);
        page_with_contents(&mut b, Object::Reference(id));
        assert_eq!(classify(b).1, Outcome::Blank);
    }

    #[test]
    fn a_page_with_no_contents_at_all_is_blank() {
        let mut b = PdfBuilder::new();
        let page = b.page("", dictionary! {});
        b.doc.get_dictionary_mut(page).unwrap().remove(b"Contents");
        assert_eq!(classify(b).1, Outcome::Blank);
    }

    #[test]
    fn text_operator_without_a_usable_font_is_unreadable() {
        let mut b = PdfBuilder::new();
        b.page("BT /F9 12 Tf (No font here) Tj ET", dictionary! {});
        let (i, o) = classify(b);
        assert!(i.shows_text);
        assert_eq!(o, Outcome::TextUnreadable);
    }
}
