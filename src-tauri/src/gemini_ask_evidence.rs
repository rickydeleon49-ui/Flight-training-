//! Transient, locally checked quote locations for the one submitted PDF.
//! A match establishes location, never whether a quote supports the answer.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AskPassage {
    pub page: u32,
    pub quote: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroundedReply {
    answer: String,
    not_answered: bool,
    passages: Vec<AskPassage>,
}

// Preserve punctuation, numbers and ordinary hyphens. Only join a line-end
// hyphen between letters, remove discretionary soft hyphens, fold case and
// collapse whitespace. Never use fuzzy matching or search another page.
fn normalized(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut joined = String::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\u{00ad}' {
            i += 1;
            continue;
        }
        if ch == '-' && i > 0 && chars[i - 1].is_alphabetic() {
            let mut end = i + 1;
            let mut newline = false;
            while end < chars.len() && chars[end].is_whitespace() {
                newline |= matches!(chars[end], '\r' | '\n');
                end += 1;
            }
            if newline && end < chars.len() && chars[end].is_alphabetic() {
                i = end;
                continue;
            }
        }
        joined.extend(ch.to_lowercase());
        i += 1;
    }
    joined.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn quote_matches(page: &str, quote: &str) -> bool {
    let quote = normalized(quote);
    !quote.is_empty() && normalized(page).contains(&quote)
}

pub fn validated_evidence(
    text: &str,
    page_count: Option<u32>,
    mut read_page: impl FnMut(u32) -> Option<String>,
) -> (bool, Vec<AskPassage>) {
    let Ok(reply) = serde_json::from_str::<GroundedReply>(text) else {
        return (false, vec![]);
    };
    // A malformed evidence envelope invalidates all its evidence, rather than
    // salvaging an over-limit prefix or trusting the not-answered flag.
    if reply.answer.trim().is_empty()
        || reply.answer.chars().count() > crate::gemini_ask::MAX_ANSWER_CHARS
        || reply.passages.len() > 3
        || reply
            .passages
            .iter()
            .any(|p| p.page == 0 || p.quote.trim().is_empty() || p.quote.chars().count() > 400)
        || (reply.not_answered && !reply.passages.is_empty())
    {
        return (false, vec![]);
    }
    if reply.not_answered {
        return (true, vec![]);
    }
    let passages = reply
        .passages
        .into_iter()
        .filter(|p| {
            if !page_count.is_some_and(|count| p.page <= count) {
                return false;
            }
            read_page(p.page).is_some_and(|page| quote_matches(&page, &p.quote))
        })
        .collect();
    (false, passages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn reply(passages: Value) -> Value {
        json!({"answer":"An invented study answer.","notAnswered":false,"passages":passages})
    }
    fn check(value: Value) -> (bool, Vec<AskPassage>) {
        validated_evidence(&value.to_string(), Some(2), |page| {
            match page {
            1 => Some("The fictional glider has a blue wing. Check pre-\nflight items. Limit 12-15 units.".into()),
            2 => Some("The fictional balloon has a green basket.".into()),
            _ => Some("The fictional glider has a blue wing.".into()),
        }
        })
    }
    #[test]
    fn valid_quotes_use_only_the_claimed_physical_page() {
        let (_, passages) = check(reply(json!([
            {"page":1,"quote":"GLIDER has a  blue\twing."},
            {"page":1,"quote":"Check preflight items."},
            {"page":2,"quote":"green basket."}
        ])));
        assert_eq!(passages.len(), 3);
        assert_eq!(passages[2].page, 2);
    }
    #[test]
    fn fabricated_wrong_page_and_out_of_range_quotes_are_dropped() {
        for (page, quote) in [(1, "red wing"), (2, "blue wing."), (3, "blue wing.")] {
            assert!(
                check(reply(json!([{"page":page,"quote":quote}])))
                    .1
                    .is_empty(),
                "{page}: {quote}"
            );
        }
        let (_, passages) = check(reply(json!([
            {"page":1,"quote":"blue wing."}, {"page":2,"quote":"blue wing."}
        ])));
        assert_eq!(passages.len(), 1);
    }
    #[test]
    fn punctuation_numbers_and_ordinary_hyphens_are_not_erased() {
        for quote in [
            "Limit 1215 units.",
            "Limit 12 15 units.",
            "Limit 12-16 units.",
        ] {
            assert!(check(reply(json!([{"page":1,"quote":quote}]))).1.is_empty());
        }
        assert_eq!(normalized("pre\u{ad}flight\n items"), "preflight items");
    }
    #[test]
    fn malformed_envelopes_never_produce_evidence() {
        let good = reply(json!([{"page":1,"quote":"blue wing."}]));
        let mut extra = good.clone();
        extra["extra"] = json!(true);
        let mut nested = good.clone();
        nested["passages"][0]["extra"] = json!(true);
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("notAnswered");
        let mut oversized_answer = good.clone();
        oversized_answer["answer"] = json!("x".repeat(crate::gemini_ask::MAX_ANSWER_CHARS + 1));
        for value in [
            extra,
            nested,
            missing,
            oversized_answer,
            reply(json!([{"page":0,"quote":"blue wing."}])),
            reply(json!([{"page":-1,"quote":"blue wing."}])),
            reply(json!([{"page":1.5,"quote":"blue wing."}])),
            reply(json!([{"page":"1","quote":"blue wing."}])),
            reply(json!([{"page":1,"quote":" "}])),
            reply(json!([{"page":1,"quote":"é".repeat(401)}])),
            reply(json!((0..4)
                .map(|_| json!({"page":1,"quote":"blue wing."}))
                .collect::<Vec<_>>())),
        ] {
            assert!(check(value.clone()).1.is_empty(), "{value}");
        }
        assert!(
            validated_evidence("not JSON", Some(2), |_| Some("blue wing.".into()))
                .1
                .is_empty()
        );
        assert!(validated_evidence("{\"answer\":\"x\",\"answer\":\"y\",\"notAnswered\":false,\"passages\":[{\"page\":1,\"quote\":\"blue wing.\"}]}", Some(2), |_| Some("blue wing.".into())).1.is_empty());
    }
    #[test]
    fn exact_caps_are_accepted() {
        let value = reply(json!((0..3)
            .map(|_| json!({"page":1,"quote":"é".repeat(400)}))
            .collect::<Vec<_>>()));
        assert_eq!(
            validated_evidence(&value.to_string(), Some(1), |_| Some("é".repeat(400)))
                .1
                .len(),
            3
        );
    }
    #[test]
    fn not_answered_and_no_evidence_stay_distinct() {
        assert_eq!(
            check(json!({"answer":"No coverage.","notAnswered":true,"passages":[]})),
            (true, vec![])
        );
        assert_eq!(check(reply(json!([]))), (false, vec![]));
        assert_eq!(
            check(
                json!({"answer":"No coverage.","notAnswered":true,"passages":[{"page":1,"quote":"blue wing."}]})
            ),
            (false, vec![])
        );
        let text = reply(json!([{"page":1,"quote":"blue wing."}])).to_string();
        assert!(
            validated_evidence(&text, None, |_| Some("blue wing.".into()))
                .1
                .is_empty()
        );
        assert!(validated_evidence(&text, Some(2), |_| None).1.is_empty());
    }
}
