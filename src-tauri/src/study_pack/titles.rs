//! Insert-time title steps (design section 3, "Second-copy title"):
//! normalize whitespace, then for a second copy cut to fit and add the date
//! suffix. None of this is part of the revision.

use crate::card_reviews::{format_iso_ms, js_trim, parse_iso_ms};

pub const TITLE_LIMIT: usize = 500;

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Trim both ends and collapse each inner run of whitespace to one space.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in js_trim(text).chars() {
        if c.is_whitespace() {
            in_space = true;
            continue;
        }
        if in_space {
            out.push(' ');
            in_space = false;
        }
        out.push(c);
    }
    out
}

/// ` (updated 1 Nov 2026)` from the manifest `createdAt` (UTC).
pub fn suffix(created_at: &str) -> String {
    let iso = parse_iso_ms(created_at).map_or_else(|| created_at.to_string(), format_iso_ms);
    let number =
        |range: std::ops::Range<usize>| iso.get(range).and_then(|t| t.parse::<usize>().ok());
    match (number(0..4), number(5..7), number(8..10)) {
        (Some(year), Some(month @ 1..=12), Some(day)) => {
            format!(" (updated {day} {} {year})", MONTHS[month - 1])
        }
        _ => " (updated)".to_string(),
    }
}

/// The stored title. A blank title stays blank, with no suffix.
pub fn stored(title: &str, second_copy_suffix: Option<&str>) -> String {
    let title = normalize(title);
    let Some(suffix) = second_copy_suffix else {
        return title;
    };
    if title.is_empty() {
        return title;
    }
    let room = TITLE_LIMIT.saturating_sub(suffix.chars().count());
    if title.chars().count() <= room {
        return format!("{title}{suffix}");
    }
    let cut: String = title.chars().take(room).collect();
    format!("{}{suffix}", js_trim(&cut))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_is_normalized_and_blank_stays_blank() {
        assert_eq!(normalize("  a \t b\n\n c  "), "a b c");
        assert_eq!(normalize(" \t "), "");
        assert_eq!(stored(" \t ", Some(" (updated x)")), "");
        assert_eq!(stored("  Notes  ", None), "Notes");
    }

    #[test]
    fn the_suffix_uses_the_pack_date() {
        assert_eq!(suffix("2026-11-01T10:00:00.000Z"), " (updated 1 Nov 2026)");
        assert_eq!(suffix("2026-12-25T23:59:59.999Z"), " (updated 25 Dec 2026)");
    }

    #[test]
    fn a_long_title_keeps_meaning_and_the_whole_suffix() {
        let s = suffix("2026-11-01T10:00:00.000Z");
        let room = TITLE_LIMIT - s.chars().count();
        // Whitespace is dropped before cutting; a space at the cut is trimmed.
        let padded = format!("   {} {}   ", "a".repeat(room - 1), "b".repeat(50));
        let out = stored(&padded, Some(&s));
        assert!(out.ends_with(&s));
        assert!(out.chars().count() <= TITLE_LIMIT);
        assert!(!out.contains(" b"), "the cut space is trimmed: {out}");
        let multi = "é漢😀".repeat(400);
        let out = stored(&multi, Some(&s));
        assert_eq!(out.chars().count(), TITLE_LIMIT);
        assert!(out.ends_with(&s));
    }
}
