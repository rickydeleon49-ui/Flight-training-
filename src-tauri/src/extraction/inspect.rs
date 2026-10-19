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
    pub complete: bool,
    /// The page's own content stream could not be read or parsed.
    pub unreadable_page: bool,
}

/// Inspect one page. Never panics; every failure only clears `complete`.
pub fn inspect_page(doc: &Document, page_id: ObjectId) -> Inspection {
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
    let content =
        strict_page_content(doc, page_id).and_then(|bytes| Content::decode_strict(&bytes).ok());
    let Some(content) = content else {
        found.complete = false;
        found.unreadable_page = true;
        return found;
    };
    let mut stack = Vec::new();
    walk(doc, &content, &resources, 0, &mut stack, &mut found);
    found
}

/// A stream's decoded bytes, or `None` unless decoding is known to be
/// complete. `lopdf` logs and keeps partial output for corrupt Flate or LZW
/// data and silently skips missing content objects, so it cannot tell a
/// blank page from an unreadable one. Only unfiltered streams and a single
/// FlateDecode with no predictor are accepted; the zlib stream must reach its
/// verified end. Anything else is treated as unreadable, never as empty.
pub fn strict_stream_bytes(stream: &lopdf::Stream) -> Option<Vec<u8>> {
    let filter = match stream.dict.get(b"Filter") {
        Err(_) => return Some(stream.content.clone()),
        Ok(Object::Name(name)) => name.as_slice(),
        Ok(Object::Array(list)) if list.len() == 1 => list[0].as_name().ok()?,
        Ok(_) => return None,
    };
    if filter != b"FlateDecode" {
        return None;
    }
    if let Ok(params) = stream.dict.get(b"DecodeParms") {
        let predictor = match params {
            Object::Dictionary(d) => d.get(b"Predictor").and_then(Object::as_i64).unwrap_or(1),
            Object::Null => 1,
            _ => return None,
        };
        if predictor != 1 {
            return None;
        }
    }
    let mut out = Vec::new();
    use std::io::Read;
    flate2::read::ZlibDecoder::new(stream.content.as_slice())
        .read_to_end(&mut out)
        .ok()?;
    Some(out)
}

/// Every entry of the page's `/Contents`, resolved and strictly decoded.
/// A page with no `/Contents` is legitimately empty; a dangling reference,
/// a non-stream entry or any undecodable stream makes the page unreadable.
fn strict_page_content(doc: &Document, page_id: ObjectId) -> Option<Vec<u8>> {
    let page = doc.get_dictionary(page_id).ok()?;
    let entries: Vec<ObjectId> = match page.get(b"Contents") {
        Err(_) => return Some(Vec::new()),
        Ok(Object::Reference(id)) => vec![*id],
        Ok(Object::Array(list)) => list
            .iter()
            .map(|o| o.as_reference().ok())
            .collect::<Option<Vec<_>>>()?,
        Ok(_) => return None,
    };
    let mut content = Vec::new();
    for id in entries {
        let stream = doc.get_object(id).ok()?.as_stream().ok()?;
        content.extend_from_slice(&strict_stream_bytes(stream)?);
        content.push(b'\n');
    }
    Some(content)
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

fn walk(
    doc: &Document,
    content: &Content<Vec<lopdf::content::Operation>>,
    resources: &[Dictionary],
    depth: usize,
    stack: &mut Vec<ObjectId>,
    found: &mut Inspection,
) {
    for op in &content.operations {
        match op.operator.as_str() {
            "Tj" | "TJ" | "'" | "\"" => found.shows_text = true,
            "BI" => found.draws_image = true,
            "Do" => {
                let name = op.operands.first().and_then(|o| o.as_name().ok());
                match name {
                    Some(name) => invoke(doc, name, resources, depth, stack, found),
                    None => found.complete = false,
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
    doc: &Document,
    name: &[u8],
    resources: &[Dictionary],
    depth: usize,
    stack: &mut Vec<ObjectId>,
    found: &mut Inspection,
) {
    let target = resources.iter().find_map(|r| {
        let xobjects = match r.get(b"XObject").ok()? {
            Object::Reference(id) => doc.get_dictionary(*id).ok()?,
            Object::Dictionary(d) => d,
            _ => return None,
        };
        match xobjects.get(name).ok()? {
            Object::Reference(id) => Some(*id),
            _ => None,
        }
    });
    let Some(id) = target else {
        found.complete = false;
        return;
    };
    let Ok(Object::Stream(stream)) = doc.get_object(id) else {
        found.complete = false;
        return;
    };
    let subtype = stream.dict.get(b"Subtype").and_then(Object::as_name).ok();
    match subtype {
        Some(b"Image") => found.draws_image = true,
        Some(b"Form") => {
            if depth + 1 > MAX_FORM_DEPTH || stack.contains(&id) {
                found.complete = false;
                return;
            }
            let content =
                strict_stream_bytes(stream).and_then(|bytes| Content::decode_strict(&bytes).ok());
            let Some(content) = content else {
                found.complete = false;
                return;
            };
            let own = match stream.dict.get(b"Resources") {
                Ok(Object::Dictionary(d)) => Some(d.clone()),
                Ok(Object::Reference(r)) => match doc.get_dictionary(*r) {
                    Ok(d) => Some(d.clone()),
                    Err(_) => {
                        found.complete = false;
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
            stack.push(id);
            walk(doc, &content, &scoped, depth + 1, stack, found);
            stack.pop();
        }
        _ => found.complete = false,
    }
}

/// Decide a page's outcome from its inspection and extracted text. A page
/// whose own content couldn't be read is `failed` even if some text came
/// out, since that text may be only part of the page.
pub fn outcome(inspection: &Inspection, text: &str) -> Outcome {
    if inspection.unreadable_page {
        Outcome::Failed
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
