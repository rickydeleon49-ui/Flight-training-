//! Versioned, deterministic study candidates over an identity-bound text snapshot.
//! This engine has no side effects. Offsets are UTF-8 byte offsets into raw text,
//! never into the separate canonical matching view. Nothing here saves a kit.
use crate::extraction::{
    cache::{canonical, EXTRACTOR_VERSION},
    inspect::Outcome,
};
use lopdf::{Document, Object, ObjectId};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const ALGORITHM_VERSION: u32 = 1;
pub const PROVENANCE_LABEL: &str = "Pulled from your PDF on this Mac";

/// Each page retains its cache key. A stale or differently keyed page is ignored.
#[derive(Debug, Clone)]
pub struct CachedPage {
    pub content_sha256: String,
    pub extractor_version: i64,
    pub page: u32,
    pub outcome: Outcome,
    pub text: String,
}

/// The caller supplies the actual PDF page count, not the selected-page count.
/// An optional in-memory document must be from these same content bytes. The
/// future command owns that byte identity check; this pure engine does no I/O.
#[derive(Debug, Clone)]
pub struct KitInput {
    pub content_sha256: String,
    pub extractor_version: i64,
    pub page_count: u32,
    pub pages: Vec<CachedPage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub page: u32,
    pub start_offset: usize,
    pub end_offset: usize,
    pub quote: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Rule {
    Definition,
    Acronym,
    TermCloze,
    NumberCloze,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardCandidate {
    pub term: String,
    pub prompt: String,
    pub answer: String,
    pub source_page: u32,
    pub rule: Rule,
    pub evidence: Vec<Evidence>,
    /// Distractors must have this exact pattern (including printed unit).
    pub pattern: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSentence {
    pub text: String,
    pub source_page: u32,
    pub evidence: Evidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineSection {
    pub heading: String,
    pub source_page: u32,
    pub sentences: Vec<SourceSentence>,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionCandidate {
    pub prompt: String,
    pub answer: String,
    pub choices: Vec<String>,
    pub correct_index: usize,
    pub source_page: u32,
    pub evidence: Vec<Evidence>,
    pub choice_evidence: Vec<Vec<Evidence>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitCandidates {
    pub algorithm_version: u32,
    pub content_sha256: String,
    pub pages_used: Vec<u32>,
    pub pages_skipped_image: u32,
    pub pages_skipped_unreadable: u32,
    pub pages_skipped_failed: u32,
    pub pages_skipped_other: u32,
    pub pages_skipped_ambiguous: u32,
    pub glossary: Vec<CardCandidate>,
    pub cloze: Vec<CardCandidate>,
    pub outline: Vec<OutlineSection>,
    pub questions: Vec<QuestionCandidate>,
}

const MAX_PAGE_BYTES: usize = 128 * 1024;
const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTLINE_NODES: usize = 256;

fn normalized(text: &str) -> String {
    canonical(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Matching is separate from evidence. NFKC may expand a ligature or compose
/// combining marks: every matching byte maps back to the entire raw cluster.
struct MatchingView {
    text: String,
    starts: Vec<usize>,
    ends: Vec<usize>,
}
impl MatchingView {
    fn new(raw: &str) -> Self {
        let mut result = Self {
            text: String::new(),
            starts: vec![],
            ends: vec![],
        };
        let mut boundaries = vec![0];
        for (i, c) in raw.char_indices().skip(1) {
            if unicode_normalization::char::canonical_combining_class(c) == 0 {
                boundaries.push(i);
            }
        }
        boundaries.push(raw.len());
        for pair in boundaries.windows(2) {
            let (start, end) = (pair[0], pair[1]);
            for c in canonical(&raw[start..end]).to_lowercase().chars() {
                let c = if c.is_whitespace() { ' ' } else { c };
                if c == ' ' && result.text.ends_with(' ') {
                    if let Some(last) = result.ends.last_mut() {
                        *last = end;
                    }
                    continue;
                }
                result.text.push(c);
                for _ in 0..c.len_utf8() {
                    result.starts.push(start);
                    result.ends.push(end);
                }
            }
        }
        result
    }
    fn raw_span(&self, start: usize, end: usize) -> Option<(usize, usize)> {
        (start < end && end <= self.starts.len()).then(|| (self.starts[start], self.ends[end - 1]))
    }
}

fn evidence(page: u32, start: usize, text: &str) -> Evidence {
    Evidence {
        page,
        start_offset: start,
        end_offset: start + text.len(),
        quote: text.into(),
    }
}
fn trimmed(page: u32, start: usize, text: &str) -> Evidence {
    let left = text.len() - text.trim_start().len();
    evidence(page, start + left, text.trim())
}
fn words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|s| s.chars().any(char::is_alphabetic))
        .count()
}
fn complete(text: &str) -> bool {
    text.chars().count() <= 2000
        && words(text) >= 2
        && text.chars().next().is_some_and(char::is_alphabetic)
        && text.ends_with(['.', '!', '?'])
        && !text.contains([':', '|', '\t'])
}
fn sentences(line: &Evidence) -> Vec<Evidence> {
    let mut result = vec![];
    let mut start = 0;
    for (i, c) in line.quote.char_indices() {
        if matches!(c, '.' | '!' | '?') {
            let end = i + c.len_utf8();
            if end == line.quote.len() || line.quote[end..].starts_with(char::is_whitespace) {
                let part = trimmed(
                    line.page,
                    line.start_offset + start,
                    &line.quote[start..end],
                );
                if complete(&part.quote) {
                    result.push(part);
                }
                start = end;
            }
        }
    }
    result
}
fn definition_complete(text: &str) -> bool {
    if text.chars().count() > 500 || !complete(text) {
        return false;
    }
    let e = evidence(1, 0, text);
    let parts = sentences(&e);
    // Every non-whitespace byte belongs to one of the complete sentences.
    if !(1..=2).contains(&parts.len()) {
        return false;
    }
    let mut cursor = 0;
    for part in &parts {
        if !text[cursor..part.start_offset].trim().is_empty() {
            return false;
        }
        cursor = part.end_offset;
    }
    text[cursor..].trim().is_empty()
}
fn term_ok(text: &str) -> bool {
    let raw_len = text.chars().count();
    if !(2..=80).contains(&raw_len) {
        return false;
    }
    let matching = canonical(text);
    let text = matching.as_str();
    let len = text.chars().count();
    (2..=80).contains(&len)
        && words(text) <= 10
        && text.chars().next().is_some_and(char::is_alphabetic)
        && text
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '’' | '\'' | '/'))
        && ![
            "page",
            "copyright",
            "chapter",
            "figure",
            "table",
            "section",
            "note",
            "warning",
            "caution",
        ]
        .iter()
        .any(|s| normalized(text).split_whitespace().next() == Some(s))
}
fn suspect_page(text: &str) -> bool {
    text.len() > MAX_PAGE_BYTES
        || text.contains(['\t', '|', '\u{FFFD}'])
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r'))
        || text.lines().any(|line| {
            let t = line.trim();
            t.contains("  ") || t.contains("..") || t.contains("\u{2022}")
        })
}

struct PageView {
    page: u32,
    lines: Vec<Evidence>,
    sentences: Vec<Evidence>,
}
fn page_view(page: &CachedPage) -> PageView {
    let mut offset = 0;
    let mut lines = vec![];
    for line in page.text.split_inclusive('\n') {
        let e = trimmed(page.page, offset, line);
        if !e.quote.is_empty() && e.quote.chars().count() <= 2000 {
            lines.push(e);
        }
        offset += line.len();
    }
    let sentences = lines.iter().flat_map(sentences).collect();
    PageView {
        page: page.page,
        lines,
        sentences,
    }
}

fn glossary_line(line: &Evidence) -> Option<CardCandidate> {
    let view = MatchingView::new(&line.quote);
    let (at, sep_len) = [":", " — ", " means ", " is defined as "]
        .into_iter()
        .find_map(|sep| view.text.find(sep).map(|at| (at, sep.len())))?;
    let (_, end) = view.raw_span(at, at + sep_len)?;
    let (start, _) = view.raw_span(at, at + sep_len)?;
    let term = line.quote[..start].trim();
    let answer = line.quote[end..].trim();
    if !term_ok(term) || !definition_complete(answer) {
        return None;
    }
    Some(CardCandidate {
        term: term.into(),
        prompt: format!("What does “{term}” mean in this PDF?"),
        answer: answer.into(),
        source_page: line.page,
        rule: Rule::Definition,
        evidence: vec![line.clone()],
        pattern: "definition".into(),
    })
}

fn is_acronym(text: &str) -> bool {
    (2..=10).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_uppercase())
}
fn initials(text: &str) -> String {
    text.split(|c: char| c.is_whitespace() || c == '-')
        .filter(|s| !s.is_empty())
        .filter(|s| {
            !["of", "the", "and", "for", "a", "an", "in", "to"].contains(&s.to_lowercase().as_str())
        })
        .filter_map(|s| s.chars().next())
        .collect::<String>()
        .to_uppercase()
}
fn plausible(phrase: &str, acronym: &str) -> bool {
    let all = phrase
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter_map(|s| s.chars().next())
        .collect::<String>()
        .to_uppercase();
    term_ok(phrase) && words(phrase) >= 2 && (initials(phrase) == acronym || all == acronym)
}
fn acronym_cards(line: &Evidence) -> Vec<CardCandidate> {
    let mut result = vec![];
    for (open, _) in line.quote.match_indices('(') {
        let Some(close_rel) = line.quote[open + 1..].find(')') else {
            continue;
        };
        let close = open + 1 + close_rel;
        let inside = &line.quote[open + 1..close];
        if inside.contains(['(', ')']) {
            continue;
        }
        let before = line.quote[..open].trim_end();
        let mut found = None;
        if is_acronym(inside) {
            // Use only the shortest adjacent suffix with matching initials.
            // Initials and word count prevent a preceding sentence fragment
            // from being mistaken for the explicit adjacent phrase.
            let positions: Vec<usize> = before
                .char_indices()
                .filter(|(i, c)| {
                    !c.is_whitespace() && (*i == 0 || before[..*i].ends_with(char::is_whitespace))
                })
                .map(|(i, _)| i)
                .collect();
            for &start in positions.iter().rev().take(14) {
                let phrase = &before[start..];
                if plausible(phrase, inside) {
                    found = Some((start, inside, phrase));
                    break;
                }
            }
        } else if let Some((start, acronym)) = before
            .rsplit_once(char::is_whitespace)
            .map(|(left, right)| (left.len() + 1, right))
            .or(Some((0, before)))
        {
            if is_acronym(acronym) && plausible(inside, acronym) {
                found = Some((start, acronym, inside));
            }
        }
        if let Some((start, acronym, phrase)) = found {
            let quote = &line.quote[start..close + 1];
            result.push(CardCandidate {
                term: acronym.into(),
                prompt: format!("What does “{acronym}” stand for in this PDF?"),
                answer: phrase.into(),
                source_page: line.page,
                rule: Rule::Acronym,
                evidence: vec![evidence(line.page, line.start_offset + start, quote)],
                pattern: "acronym".into(),
            });
        }
    }
    result
}

fn card_key(card: &CardCandidate) -> (u32, usize, Rule) {
    (
        card.source_page,
        card.evidence[0].start_offset,
        card.rule.clone(),
    )
}
fn merge_evidence(target: &mut Vec<Evidence>, source: &[Evidence]) {
    target.extend_from_slice(source);
}
fn dedup_cards(mut cards: Vec<CardCandidate>) -> Vec<CardCandidate> {
    cards.sort_by_key(card_key);
    let mut seen: BTreeMap<(String, String), usize> = BTreeMap::new();
    let mut result: Vec<CardCandidate> = vec![];
    for card in cards {
        let key = (normalized(&card.prompt), normalized(&card.answer));
        if let Some(&index) = seen.get(&key) {
            merge_evidence(&mut result[index].evidence, &card.evidence);
        } else {
            seen.insert(key, result.len());
            result.push(card);
        }
    }
    for card in &mut result {
        card.evidence
            .sort_by_key(|e| (e.page, e.start_offset, e.end_offset));
        card.evidence.dedup();
    }
    result
}
fn suppress_conflicts(cards: Vec<CardCandidate>) -> Vec<CardCandidate> {
    let mut answers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for c in &cards {
        answers
            .entry(normalized(&c.term))
            .or_default()
            .insert(normalized(&c.answer));
    }
    cards
        .into_iter()
        .filter(|c| answers[&normalized(&c.term)].len() == 1)
        .collect()
}

/// Number grammar preserves printed signs, commas, decimals and ranges. A
/// malformed continuation cannot turn into a smaller, plausible suffix value.
fn number_end(text: &str, start: usize) -> Option<usize> {
    let mut pos = start;
    if let Some(c) = text[pos..]
        .chars()
        .next()
        .filter(|c| matches!(c, '+' | '-' | '−' | '±'))
    {
        pos += c.len_utf8();
        while text[pos..].starts_with(' ') {
            pos += 1;
        }
    }
    let digit_start = pos;
    while text[pos..].starts_with(|c: char| c.is_ascii_digit() || c == ',' || c == '.') {
        pos += 1;
    }
    if pos == digit_start {
        return None;
    }
    let token = &text[digit_start..pos];
    let mut parts = token.split('.');
    let integer = parts.next()?;
    let fraction = parts.next();
    if parts.next().is_some()
        || fraction.is_some_and(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let groups: Vec<&str> = integer.split(',').collect();
    if (integer.is_empty() && fraction.is_none())
        || (!integer.is_empty() && groups.iter().any(|s| s.is_empty()))
        || (groups.len() > 1
            && (groups[0].len() > 3 || groups.iter().skip(1).any(|s| s.len() != 3)))
    {
        return None;
    }
    Some(pos)
}
fn number_spans(text: &str) -> Vec<(usize, usize, String)> {
    let mut result = vec![];
    let mut consumed = 0;
    for (start, c) in text.char_indices() {
        if start < consumed
            || !(c.is_ascii_digit()
                || matches!(c, '+' | '-' | '−' | '±')
                || (c == '.' && text[start + 1..].starts_with(|c: char| c.is_ascii_digit())))
        {
            continue;
        }
        if start > 0
            && text[..start].chars().next_back().is_some_and(|c| {
                c.is_alphanumeric() || matches!(c, ',' | '.' | '+' | '-' | '−' | '±' | '–')
            })
        {
            continue;
        }
        let Some(mut end) = number_end(text, start) else {
            continue;
        };
        let space_end = end + text[end..].len() - text[end..].trim_start_matches(' ').len();
        if let Some(sep) = text[space_end..]
            .chars()
            .next()
            .filter(|c| matches!(c, '-' | '–' | '−'))
        {
            let next = space_end + sep.len_utf8();
            let next = next + text[next..].len() - text[next..].trim_start_matches(' ').len();
            let Some(range_end) = number_end(text, next) else {
                continue;
            };
            end = range_end;
        } else if text[space_end..].starts_with("to ") {
            let next = space_end + 3;
            let Some(range_end) = number_end(text, next) else {
                continue;
            };
            end = range_end;
        }
        let unit_start = end + text[end..].len() - text[end..].trim_start_matches(' ').len();
        let Some(unit) = [
            "feet", "knots", "MHz", "mph", "°C", "°F", "ft", "kt", "NM", "lb", "%",
        ]
        .into_iter()
        .find(|u| {
            text[unit_start..].starts_with(u)
                && !text[unit_start + u.len()..].starts_with(char::is_alphanumeric)
        }) else {
            continue;
        };
        end = unit_start + unit.len();
        for suffix in [" AGL", " MSL"] {
            if text[end..].starts_with(suffix)
                && !text[end + suffix.len()..].starts_with(char::is_alphanumeric)
            {
                end += suffix.len();
                break;
            }
        }
        let mut begin = start;
        for qualifier in [
            "at or below ",
            "at or above ",
            "no more than ",
            "no less than ",
            "at least ",
            "at most ",
            "less than ",
            "more than ",
            "below ",
            "above ",
            "approximately ",
            "about ",
            "up to ",
        ] {
            if text[..start].to_lowercase().ends_with(qualifier) {
                let candidate = start - qualifier.len();
                if candidate == 0 || !text[..candidate].ends_with(char::is_alphanumeric) {
                    begin = candidate;
                    break;
                }
            }
        }
        consumed = end;
        result.push((begin, end, format!("number:{unit}")));
    }
    result
}
fn cloze_cards(pages: &[PageView], glossary: &[CardCandidate]) -> Vec<CardCandidate> {
    let mut result = vec![];
    for page in pages {
        for sentence in &page.sentences {
            if sentence.quote.contains("____") {
                continue;
            }
            let mut spans = number_spans(&sentence.quote);
            let view = MatchingView::new(&sentence.quote);
            for term in glossary {
                let needle = normalized(&term.term);
                let matches: Vec<_> = view
                    .text
                    .match_indices(&needle)
                    .filter(|(start, _)| {
                        (*start == 0 || !view.text[..*start].ends_with(char::is_alphanumeric))
                            && !view.text[*start + needle.len()..]
                                .starts_with(char::is_alphanumeric)
                    })
                    .collect();
                if matches.len() != 1 {
                    continue;
                }
                let (start, _) = matches[0];
                if let Some((a, b)) = view.raw_span(start, start + needle.len()) {
                    spans.push((a, b, "term".into()));
                }
            }
            spans.sort();
            spans.dedup();
            for (start, end, pattern) in spans {
                let answer = &sentence.quote[start..end];
                // One and only one span is replaced in each independent card.
                let prompt = format!("{}____{}", &sentence.quote[..start], &sentence.quote[end..]);
                result.push(CardCandidate {
                    term: answer.into(),
                    prompt,
                    answer: answer.into(),
                    source_page: page.page,
                    rule: if pattern == "term" {
                        Rule::TermCloze
                    } else {
                        Rule::NumberCloze
                    },
                    pattern,
                    evidence: vec![sentence.clone()],
                });
            }
        }
    }
    dedup_cards(result)
}

#[derive(Debug)]
struct Heading {
    page: u32,
    offset: usize,
    title: String,
}

/// Bounded dereference, separate from lopdf's unbounded convenience helpers.
fn resolve<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    let mut current = object;
    let mut seen = BTreeSet::new();
    for _ in 0..16 {
        match current {
            Object::Reference(id) => {
                if !seen.insert(*id) {
                    return None;
                }
                current = doc.objects.get(id)?;
            }
            _ => return Some(current),
        }
    }
    None
}
fn dictionary<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a lopdf::Dictionary> {
    resolve(doc, object)?.as_dict().ok()
}

/// Walk the actual page tree with explicit depth/node/cycle bounds; no recursive
/// page iterator is used on an untrusted graph. Used only for bookmark validation.
fn page_ids(
    doc: &Document,
    root: &lopdf::Dictionary,
    count: u32,
) -> Option<BTreeMap<ObjectId, u32>> {
    let mut stack = vec![(root.get(b"Pages").ok()?, 0usize)];
    let mut visited = BTreeSet::new();
    let mut pages = BTreeMap::new();
    let mut nodes = 0;
    while let Some((object, depth)) = stack.pop() {
        nodes += 1;
        if depth > 32 || nodes > 4000 {
            return None;
        }
        let id = object.as_reference().ok()?;
        if !visited.insert(id) {
            return None;
        }
        let dict = dictionary(doc, object)?;
        match dict.get(b"Type").ok()?.as_name().ok()? {
            b"Page" => {
                pages.insert(id, pages.len() as u32 + 1);
                if pages.len() > 1000 {
                    return None;
                }
            }
            b"Pages" => {
                let kids = resolve(doc, dict.get(b"Kids").ok()?)?.as_array().ok()?;
                if kids.len() > 1000 {
                    return None;
                }
                stack.extend(kids.iter().rev().map(|o| (o, depth + 1)));
            }
            _ => return None,
        }
    }
    (pages.len() == count as usize).then_some(pages)
}
fn destination(
    doc: &Document,
    root: &lopdf::Dictionary,
    object: &Object,
    depth: usize,
) -> Option<ObjectId> {
    if depth > 8 {
        return None;
    }
    let resolved = resolve(doc, object)?;
    if let Ok(array) = resolved.as_array() {
        let mode = array.get(1)?.as_name().ok()?;
        let params = match mode {
            b"Fit" | b"FitB" => 0,
            b"FitH" | b"FitV" | b"FitBH" | b"FitBV" => 1,
            b"XYZ" => 3,
            b"FitR" => 4,
            _ => return None,
        };
        if array.len() != params + 2 {
            return None;
        }
        for value in &array[2..] {
            match resolve(doc, value)? {
                Object::Integer(_) => {}
                Object::Real(f) if f.is_finite() => {}
                Object::Null if mode != b"FitR" => {}
                _ => return None,
            }
        }
        return array[0].as_reference().ok();
    }
    if let Ok(dict) = resolved.as_dict() {
        return destination(doc, root, dict.get(b"D").ok()?, depth + 1);
    }
    let name = match resolved {
        Object::Name(s) | Object::String(s, _) => s,
        _ => return None,
    };
    if let Some(dests) = root.get(b"Dests").ok().and_then(|o| dictionary(doc, o)) {
        if let Ok(target) = dests.get(name) {
            return destination(doc, root, target, depth + 1);
        }
    }
    let names = root.get(b"Names").ok().and_then(|o| dictionary(doc, o))?;
    let tree = names.get(b"Dests").ok()?;
    let mut stack = vec![(tree, 0usize)];
    let mut visited = BTreeSet::new();
    let mut nodes = 0;
    while let Some((node, level)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_OUTLINE_NODES {
            return None;
        }
        if level > 16 {
            continue;
        }
        if let Ok(id) = node.as_reference() {
            if !visited.insert(id) {
                continue;
            }
        }
        let Some(dict) = dictionary(doc, node) else {
            continue;
        };
        if let Some(pairs) = dict
            .get(b"Names")
            .ok()
            .and_then(|o| resolve(doc, o))
            .and_then(|o| o.as_array().ok())
        {
            if pairs.len() > 512 || pairs.len() % 2 != 0 {
                return None;
            }
            for pair in pairs.chunks_exact(2) {
                let key = match &pair[0] {
                    Object::Name(s) | Object::String(s, _) => s,
                    _ => continue,
                };
                if key == name {
                    return destination(doc, root, &pair[1], depth + 1);
                }
            }
        }
        if let Some(kids) = dict
            .get(b"Kids")
            .ok()
            .and_then(|o| resolve(doc, o))
            .and_then(|o| o.as_array().ok())
        {
            if kids.len() > 256 {
                return None;
            }
            stack.extend(kids.iter().rev().map(|o| (o, level + 1)));
        }
    }
    None
}

fn pdf_headings(doc: &Document, count: u32) -> Vec<Heading> {
    let Some(root) = doc
        .trailer
        .get(b"Root")
        .ok()
        .and_then(|o| dictionary(doc, o))
    else {
        return vec![];
    };
    let Some(pages) = page_ids(doc, root, count) else {
        return vec![];
    };
    let Some(outline) = root.get(b"Outlines").ok().and_then(|o| dictionary(doc, o)) else {
        return vec![];
    };
    let Some(first) = outline.get(b"First").ok() else {
        return vec![];
    };
    let mut stack = vec![(first, 0usize)];
    let mut seen = BTreeSet::new();
    let mut result = vec![];
    let mut nodes = 0;
    while let Some((object, depth)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_OUTLINE_NODES {
            break;
        }
        if depth > 16 {
            continue;
        }
        let Ok(id) = object.as_reference() else {
            continue;
        };
        if !seen.insert(id) {
            continue;
        }
        let Some(dict) = dictionary(doc, object) else {
            continue;
        };
        if let Ok(next) = dict.get(b"Next") {
            stack.push((next, depth));
        }
        if let Ok(child) = dict.get(b"First") {
            stack.push((child, depth + 1));
        }
        let title = dict
            .get(b"Title")
            .ok()
            .and_then(|o| resolve(doc, o))
            .and_then(|o| lopdf::decode_text_string(o).ok());
        let dest = dict.get(b"Dest").ok().or_else(|| {
            let action = dict.get(b"A").ok().and_then(|o| dictionary(doc, o))?;
            (action.get(b"S").ok()?.as_name().ok()? == b"GoTo")
                .then(|| action.get(b"D").ok())
                .flatten()
        });
        let page = dest
            .and_then(|o| destination(doc, root, o, 0))
            .and_then(|id| pages.get(&id).copied());
        if let (Some(title), Some(page)) = (title, page) {
            let title = title.trim();
            if !title.is_empty()
                && title.chars().count() <= 120
                && !title.chars().any(char::is_control)
            {
                result.push(Heading {
                    page,
                    offset: 0,
                    title: title.into(),
                });
            }
        }
    }
    result.sort_by(|a, b| (a.page, a.offset, &a.title).cmp(&(b.page, b.offset, &b.title)));
    result.dedup_by(|a, b| a.page == b.page);
    result
}
fn heading_line(line: &Evidence) -> bool {
    let text = &line.quote;
    let numbered = text.split_once(' ').is_some_and(|(prefix, rest)| {
        prefix.chars().next().is_some_and(|c| c.is_ascii_digit())
            && prefix.bytes().all(|c| c.is_ascii_digit() || c == b'.')
            && words(rest) > 0
    });
    let short = text.chars().count() <= 70
        && (1..=7).contains(&words(text))
        && text
            .split_whitespace()
            .filter(|s| !["and", "of", "the", "in", "for", "to"].contains(s))
            .all(|s| s.chars().next().is_some_and(char::is_uppercase));
    (numbered || short)
        && !text.contains([':', '(', ')', '—', '?', '!'])
        && !text.ends_with('.')
        && !text.to_lowercase().starts_with("page ")
}
fn outline(pages: &[PageView], document: Option<&Document>, count: u32) -> Vec<OutlineSection> {
    let mut headings = document
        .map(|doc| pdf_headings(doc, count))
        .unwrap_or_default();
    headings.retain(|h| pages.iter().any(|p| p.page == h.page));
    if headings.is_empty() {
        headings = pages
            .iter()
            .flat_map(|p| p.lines.iter())
            .filter(|e| heading_line(e))
            .map(|e| Heading {
                page: e.page,
                offset: e.start_offset,
                title: e.quote.clone(),
            })
            .collect();
    }
    if headings.is_empty() {
        // Actual contiguous text-page ranges; never span skipped picture pages.
        let mut previous = 0;
        for page in pages {
            if headings.last().map_or(true, |last| {
                page.page != previous + 1 || page.page > last.page + 4
            }) {
                headings.push(Heading {
                    page: page.page,
                    offset: 0,
                    title: format!("Pages {}–{}", page.page, page.page),
                });
            } else if let Some(last) = headings.last_mut() {
                last.title = format!("Pages {}–{}", last.page, page.page);
            }
            previous = page.page;
        }
    }
    let mut result = vec![];
    for (i, h) in headings.iter().enumerate() {
        let end = headings.get(i + 1).map(|h| (h.page, h.offset));
        let sentences: Vec<SourceSentence> = pages
            .iter()
            .flat_map(|p| &p.sentences)
            .filter(|s| {
                (s.page, s.start_offset) >= (h.page, h.offset)
                    && end.map_or(true, |end| (s.page, s.start_offset) < end)
            })
            .take(2)
            .map(|e| SourceSentence {
                text: e.quote.clone(),
                source_page: e.page,
                evidence: e.clone(),
            })
            .collect();
        if sentences.is_empty() {
            continue;
        }
        result.push(OutlineSection {
            heading: h.title.clone(),
            source_page: h.page,
            evidence: sentences.iter().map(|s| s.evidence.clone()).collect(),
            sentences,
        });
        if result.len() == 40 {
            break;
        }
    }
    result
}

fn overlap(a: &str, b: &str) -> bool {
    let clean = |s: &str| {
        normalized(s)
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let (a, b) = (clean(a), clean(b));
    a.contains(&b) || b.contains(&a)
}
fn questions(cards: &[CardCandidate], ambiguous: &BTreeSet<String>) -> Vec<QuestionCandidate> {
    let mut answers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for card in cards {
        answers
            .entry(normalized(&card.prompt))
            .or_default()
            .insert(normalized(&card.answer));
    }
    let mut result = vec![];
    for card in cards {
        if ambiguous.contains(&normalized(&card.prompt))
            || answers[&normalized(&card.prompt)].len() != 1
        {
            continue;
        }
        let mut choices = vec![(card.answer.clone(), card.evidence.clone())];
        for other in cards {
            if other.pattern != card.pattern
                || normalized(&other.answer) == normalized(&card.answer)
            {
                continue;
            }
            if choices.iter().any(|(a, _)| overlap(a, &other.answer)) {
                continue;
            }
            choices.push((other.answer.clone(), other.evidence.clone()));
            if choices.len() == 4 {
                break;
            }
        }
        if choices.len() < 2 {
            continue;
        }
        choices.sort_by(|a, b| (normalized(&a.0), &a.0).cmp(&(normalized(&b.0), &b.0)));
        let correct_index = choices
            .iter()
            .position(|(a, _)| a == &card.answer)
            .expect("answer retained");
        result.push(QuestionCandidate {
            prompt: card.prompt.clone(),
            answer: card.answer.clone(),
            correct_index,
            source_page: card.source_page,
            evidence: card.evidence.clone(),
            choices: choices.iter().map(|(a, _)| a.clone()).collect(),
            choice_evidence: choices.into_iter().map(|(_, e)| e).collect(),
        });
        if result.len() == 20 {
            break;
        }
    }
    result
}

/// No cached page can contribute without the exact hash and current extractor
/// version. Duplicate page indexes are refused as a group, not resolved by input
/// order. All emitted arrays follow page/offset/rule order before capping.
pub fn extract(input: &KitInput, document: Option<&Document>) -> Result<KitCandidates, String> {
    extract_cancellable(input, document, &|| true)
}

pub fn extract_cancellable(
    input: &KitInput,
    document: Option<&Document>,
    keep_going: &dyn Fn() -> bool,
) -> Result<KitCandidates, String> {
    let check = || {
        if keep_going() {
            Ok(())
        } else {
            Err("cancelled".to_string())
        }
    };
    check()?;
    if input.content_sha256.len() != 64
        || !input
            .content_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("invalid_content_sha256".into());
    }
    if input.extractor_version != EXTRACTOR_VERSION || !(1..=1000).contains(&input.page_count) {
        return Err("invalid_source_identity".into());
    }
    if input.pages.len() > 1000 {
        return Err("too_many_cached_pages".into());
    }
    let mut result = KitCandidates {
        algorithm_version: ALGORITHM_VERSION,
        content_sha256: input.content_sha256.clone(),
        pages_used: vec![],
        pages_skipped_image: 0,
        pages_skipped_unreadable: 0,
        pages_skipped_failed: 0,
        pages_skipped_other: 0,
        pages_skipped_ambiguous: 0,
        glossary: vec![],
        cloze: vec![],
        outline: vec![],
        questions: vec![],
    };
    let mut selected: BTreeMap<u32, Vec<&CachedPage>> = BTreeMap::new();
    for page in &input.pages {
        if page.content_sha256 == input.content_sha256
            && page.extractor_version == input.extractor_version
            && (1..=input.page_count).contains(&page.page)
        {
            selected.entry(page.page).or_default().push(page);
        }
    }
    let mut pages = vec![];
    let mut bytes: usize = 0;
    for group in selected.values() {
        check()?;
        if group.len() != 1 {
            result.pages_skipped_ambiguous += 1;
            continue;
        }
        let page = group[0];
        match page.outcome {
            Outcome::ImageOnly => {
                result.pages_skipped_image += 1;
                continue;
            }
            Outcome::TextUnreadable => {
                result.pages_skipped_unreadable += 1;
                continue;
            }
            Outcome::Failed => {
                result.pages_skipped_failed += 1;
                continue;
            }
            Outcome::Blank | Outcome::Unknown => {
                result.pages_skipped_other += 1;
                continue;
            }
            Outcome::Text => {}
        }
        bytes = bytes.saturating_add(page.text.len());
        if suspect_page(&page.text) || bytes > MAX_TOTAL_BYTES {
            result.pages_skipped_ambiguous += 1;
            continue;
        }
        if page.text.trim().is_empty() {
            result.pages_skipped_other += 1;
            continue;
        }
        result.pages_used.push(page.page);
        pages.push(page_view(page));
    }
    let mut boundary_counts: BTreeMap<String, BTreeSet<u32>> = BTreeMap::new();
    for page in &pages {
        check()?;
        for line in page.lines.first().into_iter().chain(page.lines.last()) {
            if heading_line(line) {
                boundary_counts
                    .entry(normalized(&line.quote))
                    .or_default()
                    .insert(page.page);
            }
        }
    }
    for page in &mut pages {
        page.lines.retain(|e| {
            !boundary_counts
                .get(&normalized(&e.quote))
                .is_some_and(|p| p.len() > 1)
        });
    }
    let mut glossary = vec![];
    for page in &pages {
        check()?;
        for line in &page.lines {
            check()?;
            if let Some(card) = glossary_line(line) {
                glossary.push(card);
            }
            glossary.extend(acronym_cards(line));
        }
    }
    let glossary = dedup_cards(suppress_conflicts(glossary));
    check()?;
    result.cloze = cloze_cards(&pages, &glossary[..glossary.len().min(40)]);
    let mut prompt_answers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for c in glossary.iter().chain(&result.cloze) {
        prompt_answers
            .entry(normalized(&c.prompt))
            .or_default()
            .insert(normalized(&c.answer));
    }
    let ambiguous = prompt_answers
        .into_iter()
        .filter(|(_, a)| a.len() > 1)
        .map(|(p, _)| p)
        .collect();
    result.glossary = glossary;
    result.glossary.truncate(40);
    result.cloze.truncate(40);
    check()?;
    result.outline = outline(&pages, document, input.page_count);
    let mut cards = result.glossary.clone();
    cards.extend(result.cloze.clone());
    cards.sort_by_key(card_key);
    result.questions = questions(&cards, &ambiguous);
    check()?;
    Ok(result)
}
