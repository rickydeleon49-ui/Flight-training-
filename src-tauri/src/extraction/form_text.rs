//! Text extraction from inside Form XObjects (OFFLINE-01 / EXTRACT-FORM).
//!
//! PDFs saved by macOS Preview (and other PDF editors) after modifying pages
//! often wrap the page's entire content or parts of it inside Form XObjects.
//! Standard text extraction in lopdf only inspects the page's own content stream
//! and fonts, missing text inside Form XObjects.
//!
//! This module walks Form XObjects invoked by a page (via "Do"), decoding their
//! content streams, resolving fonts from the form's /Resources (falling back to
//! caller resources), and extracting text while enforcing depth limits, cycle
//! safety, and the per-page content budget.

use std::collections::HashSet;

use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, ObjectId};

use super::inspect::{MAX_FORM_DEPTH, MAX_PAGE_CONTENT_BYTES};

/// Decoded bytes still allowed for the current page during form extraction.
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

    fn take(&mut self, n: usize) -> Result<(), ()> {
        self.used = self.used.saturating_add(n);
        match self.left.checked_sub(n) {
            Some(left) => {
                self.left = left;
                Ok(())
            }
            None => {
                self.left = 0;
                self.exhausted = true;
                Err(())
            }
        }
    }
}

/// The page's resource dictionaries, nearest first (own, then inherited).
fn page_resources(doc: &Document, page_id: ObjectId) -> Option<Vec<Dictionary>> {
    let (own, inherited) = doc.get_page_resources(page_id).ok()?;
    let mut all = Vec::new();
    if let Some(own) = own {
        all.push(own.clone());
    }
    for id in inherited {
        if let Ok(dict) = doc.get_dictionary(id) {
            all.push(dict.clone());
        }
    }
    Some(all)
}

/// Decompress stream content up to the remaining budget limit.
fn decompress_stream_bytes(stream: &lopdf::Stream, budget: &mut Budget) -> Option<Vec<u8>> {
    let filter = match stream.dict.get(b"Filter") {
        Err(_) => {
            budget.take(stream.content.len()).ok()?;
            return Some(stream.content.clone());
        }
        Ok(Object::Name(name)) => name.as_slice(),
        Ok(Object::Array(list)) if list.len() == 1 => list[0].as_name().ok()?,
        _ => b"",
    };
    if filter == b"FlateDecode" {
        if let Ok(params) = stream.dict.get(b"DecodeParms") {
            let predictor = match params {
                Object::Dictionary(d) => match d.get(b"Predictor") {
                    Err(_) => 1,
                    Ok(Object::Integer(n)) => *n,
                    _ => return None,
                },
                Object::Null => 1,
                _ => return None,
            };
            if predictor != 1 {
                if budget.exhausted {
                    return None;
                }
                let mut s = stream.clone();
                s.decompress().ok()?;
                budget.take(s.content.len()).ok()?;
                return Some(s.content);
            }
        }
        use std::io::Read;
        let mut out = Vec::new();
        let limit = (budget.left as u64).saturating_add(1);
        let decoder = flate2::read::ZlibDecoder::new(stream.content.as_slice());
        let read = decoder.take(limit).read_to_end(&mut out);
        budget.take(out.len()).ok()?;
        read.ok()?;
        Some(out)
    } else {
        if budget.exhausted {
            return None;
        }
        let mut s = stream.clone();
        s.decompress().ok()?;
        budget.take(s.content.len()).ok()?;
        Some(s.content)
    }
}

/// Resolve a named XObject reference from resources.
fn resolve_xobject(doc: &Document, name: &[u8], resources: &[Dictionary]) -> Option<ObjectId> {
    resources.iter().find_map(|r| {
        let xobjects = match r.get(b"XObject").ok()? {
            Object::Reference(id) => doc.get_dictionary(*id).ok()?,
            Object::Dictionary(d) => d,
            _ => return None,
        };
        match xobjects.get(name).ok()? {
            Object::Reference(id) => Some(*id),
            _ => None,
        }
    })
}

/// A Type0 (composite) font whose glyph ids lopdf cannot turn into text.
fn is_unmapped_composite(doc: &Document, font: &Dictionary) -> bool {
    font.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Type0".as_slice())
        && !matches!(
            font.get_font_encoding(doc),
            Ok(lopdf::Encoding::UnicodeMapEncoding(_))
        )
}

/// Find a named font dictionary in scoped resources.
fn resolve_font<'a>(
    doc: &'a Document,
    name: &[u8],
    resources: &'a [Dictionary],
) -> Option<&'a Dictionary> {
    resources.iter().find_map(|r| {
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
    })
}

fn push_newline(out: &mut String) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}

struct FormWalker<'a> {
    doc: &'a Document,
    visited: HashSet<ObjectId>,
    budget: Budget,
    has_form_text: bool,
    unmapped_text: bool,
}

impl<'a> FormWalker<'a> {
    fn new(doc: &'a Document, budget_limit: usize) -> Self {
        Self {
            doc,
            visited: HashSet::new(),
            budget: Budget::new(budget_limit),
            has_form_text: false,
            unmapped_text: false,
        }
    }

    /// Walk a Form XObject's content stream operations.
    fn walk_form(
        &mut self,
        form_id: ObjectId,
        caller_resources: &[Dictionary],
        depth: usize,
        out: &mut String,
    ) {
        if depth > MAX_FORM_DEPTH || self.visited.contains(&form_id) || self.budget.exhausted {
            return;
        }
        self.visited.insert(form_id);

        let Ok(Object::Stream(stream)) = self.doc.get_object(form_id) else {
            return;
        };

        let subtype = stream.dict.get(b"Subtype").and_then(Object::as_name).ok();
        if subtype != Some(b"Form") {
            return;
        }

        let Some(decompressed_bytes) = decompress_stream_bytes(stream, &mut self.budget) else {
            return;
        };

        let Ok(content) = Content::decode(&decompressed_bytes) else {
            return;
        };

        // Form's own resources, falling back to caller's resources
        let own = match stream.dict.get(b"Resources") {
            Ok(Object::Dictionary(d)) => Some(d.clone()),
            Ok(Object::Reference(r)) => self.doc.get_dictionary(*r).ok().cloned(),
            _ => None,
        };
        let scoped: Vec<Dictionary> = match own {
            Some(d) => std::iter::once(d)
                .chain(caller_resources.iter().cloned())
                .collect(),
            None => caller_resources.to_vec(),
        };

        self.walk_operations(&content.operations, &scoped, depth, out);
    }

    /// Walk a slice of operations, resolving fonts and decoding text.
    fn walk_operations(
        &mut self,
        operations: &[Operation],
        resources: &[Dictionary],
        depth: usize,
        out: &mut String,
    ) {
        let mut current_font: Option<&Dictionary> = None;
        let mut current_encoding: Option<lopdf::Encoding> = None;
        let mut current_unmapped = false;
        let mut saved: Vec<Option<&Dictionary>> = Vec::new();

        for op in operations {
            if self.budget.exhausted {
                return;
            }
            match op.operator.as_str() {
                "q" => {
                    saved.push(current_font);
                }
                "Q" => {
                    if let Some(font) = saved.pop() {
                        current_font = font;
                        if let Some(f) = current_font {
                            current_unmapped = is_unmapped_composite(self.doc, f);
                            current_encoding = if current_unmapped {
                                None
                            } else {
                                f.get_font_encoding(self.doc).ok()
                            };
                        } else {
                            current_unmapped = false;
                            current_encoding = None;
                        }
                    }
                }
                "Tf" => {
                    if let Some(font_name) = op.operands.first().and_then(|o| o.as_name().ok()) {
                        current_font = resolve_font(self.doc, font_name, resources);
                        if let Some(font_dict) = current_font {
                            if is_unmapped_composite(self.doc, font_dict) {
                                current_unmapped = true;
                                current_encoding = None;
                            } else {
                                current_unmapped = false;
                                current_encoding = font_dict.get_font_encoding(self.doc).ok();
                            }
                        } else {
                            current_unmapped = false;
                            current_encoding = None;
                        }
                    }
                }
                "Tj" => {
                    if current_unmapped {
                        self.unmapped_text = true;
                    } else if let Some(enc) = &current_encoding {
                        if let Some(bytes) = op.operands.first().and_then(|o| o.as_str().ok()) {
                            if let Ok(decoded) = Document::decode_text(enc, bytes) {
                                if !decoded.is_empty() {
                                    out.push_str(&decoded);
                                    self.has_form_text = true;
                                }
                            }
                        }
                    }
                }
                "TJ" => {
                    if current_unmapped {
                        self.unmapped_text = true;
                    } else if let Some(enc) = &current_encoding {
                        for operand in &op.operands {
                            if let Object::Array(arr) = operand {
                                for item in arr {
                                    match item {
                                        Object::String(bytes, _) => {
                                            if let Ok(decoded) = Document::decode_text(enc, bytes) {
                                                if !decoded.is_empty() {
                                                    out.push_str(&decoded);
                                                    self.has_form_text = true;
                                                }
                                            }
                                        }
                                        // Same spacing as lopdf's collect_text.
                                        Object::Integer(i) if *i < -100 => out.push(' '),
                                        _ => {}
                                    }
                                }
                                out.push(' ');
                            }
                        }
                    }
                }
                "'" => {
                    push_newline(out);
                    if current_unmapped {
                        self.unmapped_text = true;
                    } else if let Some(enc) = &current_encoding {
                        if let Some(bytes) = op.operands.first().and_then(|o| o.as_str().ok()) {
                            if let Ok(decoded) = Document::decode_text(enc, bytes) {
                                if !decoded.is_empty() {
                                    out.push_str(&decoded);
                                    self.has_form_text = true;
                                }
                            }
                        }
                    }
                }
                "\"" => {
                    push_newline(out);
                    if current_unmapped {
                        self.unmapped_text = true;
                    } else if let Some(enc) = &current_encoding {
                        if let Some(bytes) = op.operands.get(2).and_then(|o| o.as_str().ok()) {
                            if let Ok(decoded) = Document::decode_text(enc, bytes) {
                                if !decoded.is_empty() {
                                    out.push_str(&decoded);
                                    self.has_form_text = true;
                                }
                            }
                        }
                    }
                }
                // lopdf breaks lines only on T*, ET, ' and ", never on Td/TD/Tm
                // moves; matching it keeps form text shaped like page text.
                "T*" | "ET" => {
                    push_newline(out);
                }
                "Do" => {
                    if let Some(name) = op.operands.first().and_then(|o| o.as_name().ok()) {
                        if let Some(xobj_id) = resolve_xobject(self.doc, name, resources) {
                            self.walk_form(xobj_id, resources, depth + 1, out);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// Extract text shown inside Form XObjects invoked by a page.
///
/// Returns `Some(text)` if at least one Form XObject showing readable text was
/// invoked and no unmapped composite font was encountered.
/// Returns `None` if no Form XObjects were invoked, or none showed text, or if
/// unmapped composite text was detected.
pub fn extract_page_form_text(doc: &Document, page_id: ObjectId) -> Option<String> {
    extract_page_form_text_within(doc, page_id, MAX_PAGE_CONTENT_BYTES)
}

/// `extract_page_form_text` with an explicit budget bound, for testing.
pub fn extract_page_form_text_within(
    doc: &Document,
    page_id: ObjectId,
    budget: usize,
) -> Option<String> {
    let resources = page_resources(doc, page_id)?;
    let content_data = doc.get_page_content(page_id).ok()?;
    let content = Content::decode(&content_data).ok()?;

    let mut walker = FormWalker::new(doc, budget);
    let mut out = String::new();

    // Look for "Do" in the page content to enter Form XObjects.
    for op in &content.operations {
        if op.operator == "Do" {
            if let Some(name) = op.operands.first().and_then(|o| o.as_name().ok()) {
                if let Some(xobj_id) = resolve_xobject(doc, name, &resources) {
                    walker.walk_form(xobj_id, &resources, 1, &mut out);
                }
            }
        }
    }

    if walker.unmapped_text || !walker.has_form_text {
        None
    } else {
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extraction::inspect::outcome;
    use crate::extraction::inspect::tests::PdfBuilder;
    use crate::extraction::inspect::Outcome;
    use lopdf::{dictionary, Stream};

    fn first_page(doc: &Document) -> ObjectId {
        *doc.get_pages().values().next().unwrap()
    }

    #[test]
    #[ignore = "local only: needs the real Preview-edited sample outside the repository"]
    fn inspect_sample_phak4_page1() {
        let sample_path =
            "/Users/rickymac/code/.gen-rel-loop/offline/extract-form-a1/samples/phak4_page1_removed.pdf";
        let doc = Document::load(sample_path).expect("load sample pdf");
        let page_1_id = first_page(&doc);
        let form_text = extract_page_form_text(&doc, page_1_id);
        assert!(form_text.is_some(), "form text should be found on page 1");
        let text = form_text.unwrap();
        assert!(
            text.len() > 3000,
            "expected ~3000 characters, got {}",
            text.len()
        );
        assert!(text.contains("Air is a Fluid"));
        assert!(text.contains("viscosity"));
    }

    /// (a) a page whose content is only "/Fm1 Do" and whose text is in Form /Fm1 with its own font now extracts that text
    #[test]
    fn test_a_page_content_only_form_do_extracts_form_text() {
        let mut b = PdfBuilder::new();
        let font = b.font();
        let form = b.form(
            "BT /F1 12 Tf (Form text extracted) Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => font } },
        );
        b.page(
            "/Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Fm1" => form } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page_id = first_page(&doc);

        let form_text = extract_page_form_text(&doc, page_id);
        assert_eq!(form_text.as_deref(), Some("Form text extracted\n"));
    }

    /// (b) nested forms (page -> Fm1 -> Fm2) extract the inner text
    #[test]
    fn test_b_nested_forms_extract_inner_text() {
        let mut b = PdfBuilder::new();
        let font = b.font();
        let inner_form = b.form(
            "BT /F1 12 Tf (Deep inner text) Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => font } },
        );
        let outer_form = b.form(
            "BT /F1 12 Tf (Outer text) Tj ET /FmInner Do",
            dictionary! {
                "Font" => dictionary! { "F1" => font },
                "XObject" => dictionary! { "FmInner" => inner_form },
            },
        );
        b.page(
            "/FmOuter Do",
            dictionary! { "XObject" => dictionary! { "FmOuter" => outer_form } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page_id = first_page(&doc);

        let form_text = extract_page_form_text(&doc, page_id).expect("extract form text");
        assert!(
            form_text.contains("Outer text"),
            "should have outer text: {form_text:?}"
        );
        assert!(
            form_text.contains("Deep inner text"),
            "should have inner text: {form_text:?}"
        );
    }

    /// (c) a form that invokes itself does not loop
    #[test]
    fn test_c_cyclic_form_does_not_loop() {
        let mut b = PdfBuilder::new();
        let font = b.font();
        let form_id = b.doc.new_object_id();
        let s = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
                "Resources" => dictionary! {
                    "Font" => dictionary! { "F1" => font },
                    "XObject" => dictionary! { "SelfRef" => form_id },
                }
            },
            b"BT /F1 12 Tf (Self cyclic text) Tj ET /SelfRef Do".to_vec(),
        );
        b.doc.objects.insert(form_id, Object::Stream(s));
        b.page(
            "/FmSelf Do",
            dictionary! { "XObject" => dictionary! { "FmSelf" => form_id } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page_id = first_page(&doc);

        // Must terminate safely and extract the text from the single visit
        let form_text = extract_page_form_text(&doc, page_id);
        assert_eq!(form_text.as_deref(), Some("Self cyclic text\n"));
    }

    /// (d) a page with inline text and no forms extracts exactly the same text as before
    #[test]
    fn test_d_inline_text_only_has_no_form_text() {
        let mut b = PdfBuilder::new();
        let font = b.font();
        b.page(
            "BT /F1 12 Tf (Only inline text) Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => font } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page_id = first_page(&doc);

        let form_text = extract_page_form_text(&doc, page_id);
        assert!(
            form_text.is_none(),
            "page without forms must return None for form text"
        );
    }

    /// (e) a form whose font is a Type0 font with no ToUnicode stays untrusted
    #[test]
    fn test_e_form_with_unmapped_type0_font_stays_untrusted() {
        let mut b = PdfBuilder::new();
        let descendant = b.doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "BaseFont" => "SyntheticCID",
            "CIDSystemInfo" => dictionary! { "Registry" => Object::string_literal("Adobe"),
                "Ordering" => Object::string_literal("Identity"), "Supplement" => 0 },
        });
        let unmapped_font = b.doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "SyntheticCID",
            "Encoding" => "Identity-H", "DescendantFonts" => vec![descendant.into()],
        });
        let form = b.form(
            "BT /F1 12 Tf <00410042> Tj ET",
            dictionary! { "Font" => dictionary! { "F1" => unmapped_font } },
        );
        b.page(
            "/Fm1 Do",
            dictionary! { "XObject" => dictionary! { "Fm1" => form } },
        );
        let doc = Document::load_mem(&b.bytes()).unwrap();
        let page_id = first_page(&doc);

        // form_text returns None because unmapped composite font was used
        let form_text = extract_page_form_text(&doc, page_id);
        assert!(
            form_text.is_none(),
            "unmapped composite font in form must not produce trusted text"
        );

        // inspect_page also marks unmapped_text, resulting in TextUnreadable
        let inspection = crate::extraction::inspect::inspect_page(&doc, page_id);
        assert!(inspection.unmapped_text);
        assert_eq!(outcome(&inspection, ""), Outcome::TextUnreadable);
    }
}
