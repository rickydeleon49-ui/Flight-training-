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
    let content = doc
        .get_page_content(page_id)
        .ok()
        .and_then(|bytes| Content::decode_strict(&bytes).ok());
    let Some(content) = content else {
        found.complete = false;
        found.unreadable_page = true;
        return found;
    };
    let mut stack = Vec::new();
    walk(doc, &content, &resources, 0, &mut stack, &mut found);
    found
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
            let content = stream
                .get_plain_content()
                .ok()
                .and_then(|bytes| Content::decode_strict(&bytes).ok());
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

/// Decide a page's outcome from its inspection and extracted text.
pub fn outcome(inspection: &Inspection, text: &str) -> Outcome {
    if !text.trim().is_empty() {
        Outcome::Text
    } else if inspection.unreadable_page {
        Outcome::Failed
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

    #[test]
    fn text_operator_without_a_usable_font_is_unreadable() {
        let mut b = PdfBuilder::new();
        b.page("BT /F9 12 Tf (No font here) Tj ET", dictionary! {});
        let (i, o) = classify(b);
        assert!(i.shows_text);
        assert_eq!(o, Outcome::TextUnreadable);
    }
}
