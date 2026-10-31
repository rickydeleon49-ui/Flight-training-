//! Transient checks for newly generated cards/questions, never saved-data readers.
use super::LoadedSource;
use crate::extraction::{
    inspect::{outcome, Outcome},
    worker::read_page,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) const QUOTE_RULE: &str = "Every card and question must include a required quote of at most 300 characters, copied word-for-word from its cited sourcePage. sourcePage is the physical PDF page (1 = first page), never the printed page label.";
const UNVERIFIED: &str = "Couldn't check this against the page";
pub(super) const FALLBACK: &str = "Couldn't check more than half of these items against the pages. All items were kept for you to review.";

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Counts {
    pub kept: usize,
    pub dropped_by_quote: usize,
    pub unverified: usize,
    pub dropped_by_choices: usize,
    #[serde(skip)]
    pub majority_fallback: bool,
}

/// Cache successful and unavailable pages alike; load the submitted bytes only.
/// No managed profile, network or extraction-cache writes are needed.
pub(super) struct PageText {
    doc: Option<lopdf::Document>,
    pages: std::collections::BTreeMap<u32, lopdf::ObjectId>,
    cache: HashMap<u32, Option<String>>,
}
impl PageText {
    pub fn new(source: &LoadedSource) -> Self {
        let doc = (source.mime == "application/pdf")
            .then(|| lopdf::Document::load_mem(&source.bytes).ok())
            .flatten();
        let pages = doc.as_ref().map(|d| d.get_pages()).unwrap_or_default();
        Self {
            doc,
            pages,
            cache: HashMap::new(),
        }
    }
    pub fn page(&mut self, page: u32) -> Option<String> {
        self.cache
            .entry(page)
            .or_insert_with(|| {
                let doc = self.doc.as_ref()?;
                let id = *self.pages.get(&page)?;
                let (inspection, text) = read_page(doc, page, id);
                (outcome(&inspection, &text) == Outcome::Text && !text.trim().is_empty())
                    .then_some(text)
            })
            .clone()
    }
}

pub(super) fn check_source_items(
    items: &mut Value,
    source: &LoadedSource,
    questions: bool,
) -> Counts {
    // Only PDFs have pages to check against: other sources just lose the quote
    // (3 choices are still enforced for questions).
    if source.mime != "application/pdf" {
        return check_without_pages(items, questions);
    }
    let mut pages = PageText::new(source);
    check_items(items, source.page_count.unwrap_or(0), questions, |p| {
        pages.page(p)
    })
}

fn check_without_pages(items: &mut Value, questions: bool) -> Counts {
    let mut counts = Counts::default();
    let Some(items) = items.as_array_mut() else {
        return counts;
    };
    items.retain_mut(|item| {
        if let Some(obj) = item.as_object_mut() {
            obj.remove("quote");
            obj.remove("verificationNote");
        }
        let valid = !questions || item["options"].as_array().is_some_and(|a| a.len() == 3);
        if valid {
            counts.kept += 1;
        } else {
            counts.dropped_by_choices += 1;
        }
        valid
    });
    counts
}

/// One helper for the kit, card units and separate practice requests. A failed
/// quote is dropped only when the cited page has readable text. The majority
/// safeguard applies separately to cards/questions, after choice enforcement.
pub(super) fn check_items(
    items: &mut Value,
    page_count: u32,
    questions: bool,
    mut read: impl FnMut(u32) -> Option<String>,
) -> Counts {
    let mut counts = Counts::default();
    let Some(items) = items.as_array_mut() else {
        return counts;
    };
    items.retain(|item| {
        let valid = !questions || item["options"].as_array().is_some_and(|a| a.len() == 3);
        if !valid {
            counts.dropped_by_choices += 1;
        }
        valid
    });
    let mut cached = HashMap::new();
    // 0 = verified, 1 = unavailable, 2 = failed.
    let states: Vec<u8> = items
        .iter_mut()
        .map(|item| {
            // Never trust a model-supplied verification note.
            if let Some(obj) = item.as_object_mut() {
                obj.remove("verificationNote");
            }
            let page = item["sourcePage"]
                .as_u64()
                .and_then(|p| u32::try_from(p).ok());
            let quote = item["quote"].as_str().unwrap_or("").to_string();
            if let Some(obj) = item.as_object_mut() {
                obj.remove("quote");
            }
            let Some(page) = page.filter(|p| *p > 0 && *p <= page_count) else {
                return 2;
            };
            if quote.trim().is_empty() || quote.chars().count() > 300 {
                return 2;
            }
            let mut cited_available = false;
            for candidate in [Some(page), page.checked_sub(1), page.checked_add(1)]
                .into_iter()
                .flatten()
                .filter(|p| *p > 0 && *p <= page_count)
            {
                let text = cached
                    .entry(candidate)
                    .or_insert_with(|| read(candidate).filter(|t| !t.trim().is_empty()));
                if candidate == page {
                    cited_available = text.is_some();
                }
                if text
                    .as_ref()
                    .is_some_and(|text| crate::gemini_ask_evidence::quote_matches(text, &quote))
                {
                    item["sourcePage"] = json!(candidate);
                    return 0;
                }
            }
            if cited_available {
                2
            } else {
                1
            }
        })
        .collect();
    let fallback = states.iter().filter(|s| **s == 2).count() > items.len() / 2;
    counts.majority_fallback = fallback;
    let mut index = 0;
    items.retain_mut(|item| {
        let state = states[index];
        let first = index == 0;
        index += 1;
        if state == 2 && !fallback {
            counts.dropped_by_quote += 1;
            return false;
        }
        if fallback || state == 1 {
            if item.is_object() {
                item["verificationNote"] = json!(if fallback && first {
                    FALLBACK
                } else {
                    UNVERIFIED
                });
            }
            counts.unverified += 1;
        }
        counts.kept += 1;
        true
    });
    crate::logging::log::info!(
        "Study item checks: kept {}, dropped by quote {}, unverified {}, dropped by choices {}",
        counts.kept,
        counts.dropped_by_quote,
        counts.unverified,
        counts.dropped_by_choices
    );
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    fn card(page: u32, quote: &str) -> Value {
        json!({"front":"Synthetic?", "back":"Synthetic.","sourcePage":page,"quote":quote})
    }
    fn run(items: &mut Value, read: impl FnMut(u32) -> Option<String>) -> Counts {
        check_items(items, 3, false, read)
    }
    #[test]
    fn verifies_page_and_neighbour_using_ask_normalization_and_corrects_page() {
        let mut items = json!([card(1, "preflight checks"), card(2, "preflight checks")]);
        let mut reads = [0; 4];
        let c = run(&mut items, |p| {
            reads[p as usize] += 1;
            Some(
                if p == 1 {
                    "Pre-\nflight   checks"
                } else {
                    "Other text"
                }
                .into(),
            )
        });
        assert_eq!(c.kept, 2);
        assert_eq!(c.unverified, 0);
        assert_eq!(items[1]["sourcePage"], 1);
        assert!(items[0].get("quote").is_none());
        assert!(reads.iter().all(|n| *n <= 1));
    }
    #[test]
    fn drops_failed_quote_but_keeps_unavailable_text() {
        let mut items = json!([
            card(1, "Blue wing"),
            card(1, "Invented"),
            card(3, "Unknown")
        ]);
        let c = run(&mut items, |p| {
            if p == 3 {
                None
            } else {
                Some("Blue wing".into())
            }
        });
        assert_eq!((c.kept, c.dropped_by_quote, c.unverified), (2, 1, 1));
        assert_eq!(items[1]["verificationNote"], UNVERIFIED);
    }
    #[test]
    fn majority_failures_keep_every_item_unverified_with_one_summary() {
        let mut items = json!([
            card(1, "Invented"),
            card(1, "Also invented"),
            card(1, "Blue wing")
        ]);
        let c = run(&mut items, |_| Some("Blue wing".into()));
        assert_eq!((c.kept, c.dropped_by_quote, c.unverified), (3, 0, 3));
        assert_eq!(items[0]["verificationNote"], FALLBACK);
        assert_eq!(items[2]["verificationNote"], UNVERIFIED);
    }
    #[test]
    fn choices_are_enforced_even_when_all_quotes_fail() {
        let mut items = json!((2..=5)
            .map(|n| {
                let mut c = card(1, "Invented");
                c["options"] = json!(vec!["x"; n]);
                c
            })
            .collect::<Vec<_>>());
        let c = check_items(&mut items, 1, true, |_| Some("Blue wing".into()));
        assert_eq!((c.kept, c.dropped_by_choices, c.unverified), (1, 3, 1));
        assert_eq!(items[0]["options"].as_array().unwrap().len(), 3);
    }
    #[test]
    fn non_pdf_items_keep_without_notes_but_still_need_three_choices() {
        let mut items = json!([
            {"question":"Q?","options":["a","b","c"],"sourcePage":null,"quote":"x"},
            {"question":"Q2?","options":["a","b","c","d"],"sourcePage":null,"quote":"x"}
        ]);
        let c = check_without_pages(&mut items, true);
        assert_eq!((c.kept, c.dropped_by_choices, c.unverified), (1, 1, 0));
        assert!(items[0].get("quote").is_none());
        assert!(items[0].get("verificationNote").is_none());
    }
    #[test]
    fn missing_oversized_and_punctuation_changing_quotes_fail() {
        for quote in ["", "Limit 1215", &"x".repeat(301)] {
            let mut items = json!([card(1, "Limit 12-15"), card(1, quote)]);
            let c = run(&mut items, |_| Some("Limit 12-15".into()));
            assert_eq!(c.dropped_by_quote, 1);
        }
    }
}
