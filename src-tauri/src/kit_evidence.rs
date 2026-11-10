//! Transient checks for newly generated cards/questions, never saved-data readers.
use super::LoadedSource;
use crate::extraction::{
    inspect::{outcome, Outcome},
    worker::read_page,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) const QUOTE_RULE: &str = "Every card and question must include a required quote of at most 300 characters, copied word-for-word as one continuous passage (no ellipses) from its cited sourcePage. sourcePage is the physical PDF page (1 = first page), never the printed page label.";
const UNVERIFIED: &str = "Couldn't check this against the page";
pub(super) const UNCERTAIN: &str = "Not matched to the page word for word";
pub(super) const FALLBACK: &str = "Couldn't check more than half of these items against the pages. All items were kept for you to review.";

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Counts {
    pub kept: usize,
    pub dropped_by_quote: usize,
    pub unverified: usize,
    pub uncertain: usize,
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

fn loose(t: &str) -> String {
    crate::gemini_ask_evidence::expand_ligatures(t)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn words(t: &str) -> Vec<String> {
    crate::gemini_ask_evidence::expand_ligatures(t)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        .map(str::to_lowercase)
        .collect()
}
fn numbers(t: &str) -> Vec<String> {
    t.split(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .map(|n| n.trim_matches(|c| c == '.' || c == ','))
        .filter(|n| n.chars().any(|c| c.is_ascii_digit()))
        .map(|n| n.replace(',', ""))
        .collect()
}

/// How well a quote fits a page. Only `Exact` counts as verified.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Fit {
    None = 0,
    /// Most words are on the page but not as one ordered passage: it may even
    /// say the opposite ("increases" and "decreases" swapped). Kept, flagged.
    Loose = 1,
    /// Same words in the same order (after punctuation, ligature and layout
    /// normalization), in one contiguous passage.
    Exact = 2,
}

/// Kit quote check, tolerant of what PDF text extraction does to real quotes
/// (31 Oct live bench: every quote drop was a real sentence): punctuation and
/// curly quotes, headings run into the sentence, page breaks.
/// Exact when the letters/digits match contiguously. A quote of 6+ words with
/// >=80% of its words on the page and every number it states is only Loose.
pub(crate) fn kit_quote_fit(page: &str, quote: &str) -> Fit {
    // Elided quotes ("A … B"): every part must match on its own.
    let parts: Vec<&str> = quote
        .split(['…'])
        .flat_map(|p| p.split("..."))
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() > 1 {
        return parts
            .iter()
            .map(|p| one_quote_fit(page, p))
            .min()
            .unwrap_or(Fit::None);
    }
    one_quote_fit(page, quote)
}

fn one_quote_fit(page: &str, quote: &str) -> Fit {
    // A tiny fragment ("engine power") proves nothing about a whole card.
    let q = loose(quote);
    if q.chars().count() < 12 {
        return Fit::None;
    }
    // Numbers must match exactly on every path ("12-15" is not "1215").
    let page_numbers = numbers(page);
    if !numbers(quote).iter().all(|n| page_numbers.contains(n)) {
        return Fit::None;
    }
    if crate::gemini_ask_evidence::quote_matches(page, quote) || loose(page).contains(&q) {
        return Fit::Exact;
    }
    let qw = words(quote);
    if qw.len() < 6 {
        return Fit::None;
    }
    let pw: std::collections::HashSet<String> = words(page).into_iter().collect();
    let hit = qw.iter().filter(|w| pw.contains(*w)).count();
    if hit * 10 >= qw.len() * 8 {
        Fit::Loose
    } else {
        Fit::None
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
    // 0 = verified, 1 = unavailable, 2 = failed, 3 = uncertain (loose match only).
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
            if quote.trim().is_empty() || quote.chars().count() > 600 {
                return 2;
            }
            let mut cited_available = false;
            let mut loose_match = false;
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
                match text.as_ref().map(|text| kit_quote_fit(text, &quote)) {
                    Some(Fit::Exact) => {
                        item["sourcePage"] = json!(candidate);
                        return 0;
                    }
                    // A loose match never moves the item to another page.
                    Some(Fit::Loose) => loose_match = true,
                    _ => {}
                }
            }
            // A sentence that runs over a page break: cited page + the next one.
            if page < page_count {
                let next = cached
                    .entry(page + 1)
                    .or_insert_with(|| read(page + 1).filter(|t| !t.trim().is_empty()))
                    .clone();
                let here = cached.get(&page).cloned().flatten();
                if let (Some(a), Some(b)) = (here, next) {
                    match kit_quote_fit(&format!("{a}\n{b}"), &quote) {
                        Fit::Exact => return 0,
                        Fit::Loose => loose_match = true,
                        Fit::None => {}
                    }
                }
            }
            if loose_match {
                3
            } else if cited_available {
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
        if fallback || state == 1 || state == 3 {
            if item.is_object() {
                item["verificationNote"] = json!(if fallback && first {
                    FALLBACK
                } else if state == 3 {
                    UNCERTAIN
                } else {
                    UNVERIFIED
                });
            }
            counts.unverified += 1;
            if state == 3 {
                counts.uncertain += 1;
            }
        }
        counts.kept += 1;
        true
    });
    crate::logging::log::info!(
        "Study item checks: kept {}, dropped by quote {}, unverified {} (uncertain {}), dropped by choices {}",
        counts.kept,
        counts.dropped_by_quote,
        counts.unverified,
        counts.uncertain,
        counts.dropped_by_choices
    );
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    fn kit_quote_exact(page: &str, quote: &str) -> bool {
        kit_quote_fit(page, quote) == Fit::Exact
    }
    fn card(page: u32, quote: &str) -> Value {
        json!({"front":"Synthetic?", "back":"Synthetic.","sourcePage":page,"quote":quote})
    }
    fn run(items: &mut Value, read: impl FnMut(u32) -> Option<String>) -> Counts {
        check_items(items, 3, false, read)
    }
    #[test]
    fn verifies_page_and_neighbour_using_ask_normalization_and_corrects_page() {
        let mut items = json!([
            card(1, "preflight checks done"),
            card(2, "preflight checks done")
        ]);
        let mut reads = [0; 4];
        let c = run(&mut items, |p| {
            reads[p as usize] += 1;
            Some(
                if p == 1 {
                    "Pre-\nflight   checks done"
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
            card(1, "Blue wing tips glow"),
            card(1, "Invented fact here"),
            card(3, "Unknown words here")
        ]);
        let c = run(&mut items, |p| {
            if p == 3 {
                None
            } else {
                Some("Blue wing tips glow".into())
            }
        });
        assert_eq!((c.kept, c.dropped_by_quote, c.unverified), (2, 1, 1));
        assert_eq!(items[1]["verificationNote"], UNVERIFIED);
    }
    #[test]
    fn majority_failures_keep_every_item_unverified_with_one_summary() {
        let mut items = json!([
            card(1, "Invented fact here"),
            card(1, "Also an invented fact"),
            card(1, "Blue wing tips glow")
        ]);
        let c = run(&mut items, |_| Some("Blue wing tips glow".into()));
        assert_eq!((c.kept, c.dropped_by_quote, c.unverified), (3, 0, 3));
        assert_eq!(items[0]["verificationNote"], FALLBACK);
        assert_eq!(items[2]["verificationNote"], UNVERIFIED);
    }
    #[test]
    fn choices_are_enforced_even_when_all_quotes_fail() {
        let mut items = json!((2..=5)
            .map(|n| {
                let mut c = card(1, "Invented fact here");
                c["options"] = json!(vec!["x"; n]);
                c
            })
            .collect::<Vec<_>>());
        let c = check_items(&mut items, 1, true, |_| Some("Blue wing tips glow".into()));
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
    fn real_pdf_quirks_from_the_live_bench_pass() {
        // punctuation / curly quotes / heading run-in
        assert!(kit_quote_exact("risks of flight into four categories: Pilot-in-command (PIC),\nAircraft, enVironment, and External pressures (PAVE)", "four categories: Pilot-in-command (PIC), Aircraft, enVironment, and External pressures (PAVE)"));
        assert!(kit_quote_exact(
            "Get-there-itis\nThis disposition impairs pilot judgment",
            "Get-there-itis This disposition impairs pilot judgment"
        ));
    }
    #[test]
    fn two_column_order_is_only_uncertain() {
        let page = "The purpose of an AOA indicator is to give\nOTHER COLUMN TEXT\nthe pilot better situation awareness pertaining to the aerodynamic health of the airfoil.";
        let quote = "The purpose of an AOA indicator is to give the pilot better situation awareness pertaining to the aerodynamic health of the airfoil.";
        assert_eq!(kit_quote_fit(page, quote), Fit::Loose);
    }
    #[test]
    fn elided_quotes_need_every_part() {
        let page =
            "Macho: “I can do it.” Pilots who try to prove... Antidote: Taking chances is foolish.";
        assert!(kit_quote_exact(
            page,
            "Macho: “I can do it.” ... Taking chances is foolish."
        ));
        assert!(!kit_quote_exact(
            page,
            "Macho: “I can do it.” … Always take chances when flying."
        ));
    }
    #[test]
    fn page_break_quote_passes_on_cited_plus_next_page() {
        let mut items = json!([card(1, "The motion about the aircraft’s longitudinal axis is “roll,” the motion about its lateral axis is “pitch,” and the motion about its vertical axis is “yaw.”")]);
        let c = run(&mut items, |p| {
            Some(if p == 1 { "Figure 5-18. Axes. The motion about the aircraft’s longitudinal axis is “roll,” the motion about its lateral axis is" } else if p == 2 { "Figure 5-19. A weight-shift aircraft. “pitch,” and the motion about its vertical axis is “yaw.” Yaw is" } else { "unrelated" }.into())
        });
        assert_eq!((c.kept, c.dropped_by_quote), (1, 0));
    }
    #[test]
    fn wrong_page_wrong_numbers_and_short_fragments_still_fail() {
        let page = "Density altitude increases as temperature rises. High density altitude reduces engine power, propeller thrust and wing lift.";
        assert!(!kit_quote_exact(page, "Pilots should always complete a full preflight inspection before every flight in the aircraft."));
        assert!(!kit_quote_exact(
            page,
            "High density altitude reduces engine power by 30 percent and wing lift."
        ));
        assert!(!kit_quote_exact(page, "engine power"));
        assert!(kit_quote_exact(
            page,
            "High density altitude reduces engine power, propeller thrust, and wing lift."
        ));
    }
    #[test]
    fn missing_oversized_and_punctuation_changing_quotes_fail() {
        for quote in ["", "Speed limit 1215 knots", &"x".repeat(601)] {
            let mut items = json!([card(1, "Speed limit 12-15 knots"), card(1, quote)]);
            let c = run(&mut items, |_| Some("Speed limit 12-15 knots".into()));
            assert_eq!(c.dropped_by_quote, 1);
        }
    }
    #[test]
    fn pdf_ligatures_match_plain_letters_but_numbers_stay_exact() {
        let page = "Eﬃcient ﬂight control is the ﬁrst skill; maximum 12 knots.";
        assert!(kit_quote_exact(page, "Efficient flight control"));
        assert!(kit_quote_exact(
            page,
            "efficient flight control is the first skill"
        ));
        assert!(!kit_quote_exact(
            page,
            "efficient flight control; maximum 13 knots"
        ));
        assert!(crate::gemini_ask_evidence::quote_matches(
            page,
            "Efficient flight control"
        ));
    }
    #[test]
    fn reversed_meaning_is_uncertain_and_an_ordered_quote_is_verified() {
        let page = "Pressure increases as temperature decreases in this fictional example.";
        assert_eq!(
            kit_quote_fit(
                page,
                "Pressure increases as temperature decreases in this fictional example."
            ),
            Fit::Exact
        );
        assert_eq!(
            kit_quote_fit(
                page,
                "Pressure decreases as temperature increases in this fictional example."
            ),
            Fit::Loose
        );
        let mut items = json!([card(
            1,
            "Pressure decreases as temperature increases in this fictional example."
        )]);
        let c = run(&mut items, |_| Some(page.into()));
        assert_eq!(
            (c.kept, c.dropped_by_quote, c.unverified, c.uncertain),
            (1, 0, 1, 1)
        );
        assert_eq!(items[0]["verificationNote"], UNCERTAIN);
    }
    #[test]
    fn a_loose_match_on_a_neighbour_page_does_not_move_the_item() {
        let mut items = json!([card(
            1,
            "Pressure decreases as temperature increases in this fictional example."
        )]);
        let c = run(&mut items, |p| {
            Some(
                if p == 2 {
                    "Pressure increases as temperature decreases in this fictional example."
                } else {
                    "Unrelated words only."
                }
                .into(),
            )
        });
        assert_eq!((c.kept, c.uncertain), (1, 1));
        assert_eq!(items[0]["sourcePage"], 1);
    }
    #[test]
    fn an_exact_match_on_a_neighbour_page_still_moves_the_item() {
        let mut items = json!([card(
            1,
            "Pressure increases as temperature decreases in this fictional example."
        )]);
        let c = run(&mut items, |p| {
            Some(
                if p == 2 {
                    "Pressure increases as temperature decreases in this fictional example."
                } else {
                    "Unrelated words only."
                }
                .into(),
            )
        });
        assert_eq!((c.kept, c.uncertain, c.unverified), (1, 0, 0));
        assert_eq!(items[0]["sourcePage"], 2);
    }
    #[test]
    fn number_difference_still_fails() {
        let page =
            "Pressure increases to 30 PSI as temperature decreases in this fictional example.";
        assert_eq!(
            kit_quote_fit(
                page,
                "Pressure increases to 40 PSI as temperature decreases in this fictional example."
            ),
            Fit::None
        );
        let mut items = json!([
            card(
                1,
                "Pressure increases to 30 PSI as temperature decreases in this fictional example."
            ),
            card(
                1,
                "Pressure increases to 40 PSI as temperature decreases in this fictional example."
            )
        ]);
        let c = run(&mut items, |_| Some(page.into()));
        assert_eq!((c.kept, c.dropped_by_quote, c.uncertain), (1, 1, 0));
    }
    #[test]
    fn elided_quote_with_loose_part_is_only_loose() {
        let page = "Macho: “I can do it.” Pilots who try to prove... Antidote: Taking chances is foolish and dangerous for pilots.";
        // Part 1 is exact, part 2 has words reversed (loose)
        let quote = "Macho: “I can do it.” ... chances Taking foolish and dangerous is for pilots.";
        assert_eq!(kit_quote_fit(page, quote), Fit::Loose);
    }
}
