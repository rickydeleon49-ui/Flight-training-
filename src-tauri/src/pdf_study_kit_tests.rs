//! Synthetic golden vectors only; no disk PDF, provider, or key access.
use crate::extraction::{cache::EXTRACTOR_VERSION, inspect::Outcome};
use crate::pdf_study_kit::*;

fn input(texts: &[(Outcome, &str)]) -> KitInput {
    let hash = "a".repeat(64);
    KitInput {
        content_sha256: hash.clone(),
        extractor_version: EXTRACTOR_VERSION,
        page_count: texts.len() as u32,
        pages: texts
            .iter()
            .enumerate()
            .map(|(i, (outcome, text))| CachedPage {
                content_sha256: hash.clone(),
                extractor_version: EXTRACTOR_VERSION,
                page: i as u32 + 1,
                outcome: *outcome,
                text: text.to_string(),
            })
            .collect(),
    }
}
fn kit(text: &str) -> KitCandidates {
    extract(&input(&[(Outcome::Text, text)]), None).unwrap()
}
fn evidence(e: &Evidence, page: u32, start: usize, quote: &str) {
    assert_eq!(
        e,
        &Evidence {
            page,
            start_offset: start,
            end_offset: start + quote.len(),
            quote: quote.into()
        }
    );
}
fn assert_sources(k: &KitCandidates, src: &KitInput) {
    for e in k
        .glossary
        .iter()
        .chain(&k.cloze)
        .flat_map(|x| &x.evidence)
        .chain(k.outline.iter().flat_map(|x| &x.evidence))
        .chain(k.questions.iter().flat_map(|x| &x.evidence))
    {
        let text = &src.pages.iter().find(|p| p.page == e.page).unwrap().text;
        assert!((1..=src.page_count.min(1000)).contains(&e.page));
        assert_eq!(&text[e.start_offset..e.end_offset], e.quote);
        assert!(e.quote.chars().count() <= 2000);
    }
}

#[test]
fn glossary_colon_dash_and_sentence_forms() {
    let text = "Lift: An upward force.\nDrag — A resisting force.\nThrust means forward force.\nWeight is defined as downward force.\nLift: An upward force.";
    let k = kit(text);
    // A definition that opens in lower case is the tail of a sentence that wrapped
    // across lines, so v4 keeps only the colon and dash forms quoted here.
    assert_eq!(
        k.glossary
            .iter()
            .map(|c| (&*c.term, &*c.answer))
            .collect::<Vec<_>>(),
        vec![("Lift", "An upward force."), ("Drag", "A resisting force."),]
    );
    assert_eq!(k.glossary[0].evidence.len(), 2);
    evidence(&k.glossary[0].evidence[0], 1, 0, "Lift: An upward force.");
    evidence(
        &k.glossary[1].evidence[0],
        1,
        text.find("Drag").unwrap(),
        "Drag — A resisting force.",
    );
    // The two sentence separators still work once the definition opens with a capital.
    assert_eq!(
        kit(
            "VASI means Visual Approach Slope Indicator.\nQAR is defined as Quick Access Recorder."
        )
        .glossary
        .iter()
        .map(|c| (&*c.term, &*c.answer))
        .collect::<Vec<_>>(),
        vec![
            ("VASI", "Visual Approach Slope Indicator."),
            ("QAR", "Quick Access Recorder."),
        ]
    );
    assert_eq!(
        kit("Lift: unfinished\nQ: A complete sentence.\nBad: One. Two. Three.")
            .glossary
            .len(),
        0
    );
    assert_sources(&k, &input(&[(Outcome::Text, text)]));
}

const JUSTIFIED_PROSE: &str = "  Café  lift  is  defined  as  An  upward  force.  \n  Air  Traffic  Control  (ATC)  directs  traffic.  Lift  supports  the  airplane.  \n";

#[test]
fn justified_prose_keeps_sentences_cards_and_exact_raw_evidence() {
    let src = input(&[(Outcome::Text, JUSTIFIED_PROSE)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.pages_used, vec![1]);
    assert_eq!(k.pages_skipped_ambiguous, 0);
    let definition = k
        .glossary
        .iter()
        .find(|c| c.rule == Rule::Definition)
        .unwrap();
    assert_eq!(definition.term, "Café  lift");
    assert_eq!(definition.answer, "An upward force.");
    evidence(
        &definition.evidence[0],
        1,
        2,
        "Café  lift  is  defined  as  An  upward  force.",
    );
    let acronym = k.glossary.iter().find(|c| c.rule == Rule::Acronym).unwrap();
    assert_eq!(acronym.term, "ATC");
    assert_eq!(acronym.answer, "Air Traffic Control");
    evidence(
        &acronym.evidence[0],
        1,
        JUSTIFIED_PROSE.find("Air").unwrap(),
        "Air  Traffic  Control  (ATC)",
    );
    let sentences: Vec<_> = k.outline.iter().flat_map(|s| &s.sentences).collect();
    // Outlines intentionally keep at most two sentences per section.
    assert_eq!(
        sentences
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Café  lift  is  defined  as  An  upward  force.",
            "Air  Traffic  Control  (ATC)  directs  traffic.",
        ]
    );
    for sentence in sentences {
        assert_eq!(sentence.text, sentence.evidence.quote);
        let e = &sentence.evidence;
        assert_eq!(&JUSTIFIED_PROSE[e.start_offset..e.end_offset], e.quote);
    }
    assert!(k.cloze.iter().any(|c| c.answer == "ATC"));
    assert!(k.cloze.iter().any(|c| c.answer == "Café lift"));
    assert_sources(&k, &src);
}

#[test]
fn justified_prose_does_not_admit_layout_garbled_pages() {
    for garbled in [
        "Lift: An upward force.     Drag: An opposing force.",
        "Lift........An upward force.",
        "Lift:\tAn upward force.",
        "Lift | An upward force.",
        "Lift: An upward \u{FFFD} force.",
        "Lift: An upward \u{0007} force.",
    ] {
        let src = input(&[(Outcome::Text, JUSTIFIED_PROSE), (Outcome::Text, garbled)]);
        let k = extract(&src, None).unwrap();
        assert_eq!(k.pages_used, vec![1], "{garbled:?}");
        assert_eq!(k.pages_skipped_ambiguous, 1, "{garbled:?}");
        assert_sources(&k, &src);
    }
    // A three-space gap was here as a garbled page; it is ordinary justified prose
    // and is asserted admissible by three_space_gaps_are_prose_and_keep_their_lines.
}

/// Real PHAK text puts a figure label on its own line in the middle of prose. One
/// such line must not throw the page away: only that line is dropped, so the prose
/// around it keeps its cards and every quote stays at its exact raw offsets.
const PROSE_WITH_FIGURE_LABEL: &str = "Lift: An upward force.\nDrag — A resisting force.\nRisk Assessment Matrix      LikelihoodSeverity\nManeuvering speed means Va for light turbulence.\nXPDR    5537  IDNT  LCL 10:12:34\n";

#[test]
fn one_figure_label_line_is_dropped_and_its_page_stays() {
    let src = input(&[(Outcome::Text, PROSE_WITH_FIGURE_LABEL)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.pages_used, vec![1]);
    assert_eq!(k.pages_skipped_ambiguous, 0);
    // The prose lines around the figure labels still make their cards, each one
    // quoted from the exact raw bytes of its own line. The dropped line also ends
    // the paragraph, so nothing is joined across a figure label.
    assert_eq!(
        k.glossary
            .iter()
            .map(|c| (&*c.term, &*c.answer))
            .collect::<Vec<_>>(),
        vec![
            ("Lift", "An upward force."),
            ("Drag", "A resisting force."),
            ("Maneuvering speed", "Va for light turbulence."),
        ]
    );
    for (card, quote) in k.glossary.iter().zip([
        "Lift: An upward force.",
        "Drag — A resisting force.",
        "Maneuvering speed means Va for light turbulence.",
    ]) {
        evidence(
            &card.evidence[0],
            1,
            PROSE_WITH_FIGURE_LABEL.find(quote).unwrap(),
            quote,
        );
    }
    // The figure label was the page's only heading-shaped line, so dropping just
    // that line leaves the outline on its page-range fallback.
    assert_eq!(
        k.outline.iter().map(|s| &*s.heading).collect::<Vec<_>>(),
        vec!["Pages 1–1"]
    );
    assert_eq!(
        k.outline
            .iter()
            .flat_map(|s| &s.sentences)
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Drag — A resisting force.",
            "Maneuvering speed means Va for light turbulence."
        ]
    );
    let emitted = k
        .glossary
        .iter()
        .chain(&k.cloze)
        .flat_map(|c| &c.evidence)
        .chain(k.outline.iter().flat_map(|s| s.evidence.iter()))
        .chain(
            k.outline
                .iter()
                .flat_map(|s| s.sentences.iter().map(|x| &x.evidence)),
        )
        .chain(
            k.questions
                .iter()
                .flat_map(|q| q.evidence.iter().chain(q.choice_evidence.iter().flatten())),
        );
    for e in emitted {
        assert!(!e.quote.contains("    "), "{e:?} kept a layout gap");
        assert!(
            !e.quote.contains("Matrix") && !e.quote.contains("XPDR"),
            "{e:?} came from a figure line"
        );
    }
    assert_sources(&k, &src);
}

/// Real PHAK text pads a numbered item with three spaces after the marker and
/// opens a three-space word gap in justified prose. Both stay, gap and all.
const THREE_SPACE_PROSE: &str = "1.   Accept no unnecessary risk.\nCeilings are above 1,000 feet   but less than 3,000 feet ceilings.\n";

#[test]
fn three_space_gaps_are_prose_and_keep_their_lines() {
    let src = input(&[(Outcome::Text, THREE_SPACE_PROSE)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.pages_used, vec![1]);
    assert_eq!(k.pages_skipped_ambiguous, 0);
    let sentences: Vec<_> = k.outline.iter().flat_map(|s| &s.sentences).collect();
    assert_eq!(
        sentences
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Accept no unnecessary risk.",
            "Ceilings are above 1,000 feet   but less than 3,000 feet ceilings.",
        ]
    );
    // The printed gap survives verbatim and the offsets still slice the raw page.
    assert!(sentences[1].text.contains("feet   but"));
    for sentence in &sentences {
        evidence(
            &sentence.evidence,
            1,
            THREE_SPACE_PROSE.find(&*sentence.text).unwrap(),
            &sentence.text,
        );
    }
    assert_eq!(
        k.cloze.iter().map(|c| &*c.answer).collect::<Vec<_>>(),
        vec!["above 1,000 feet", "less than 3,000 feet"]
    );
    assert_sources(&k, &src);
}

/// A page that is mostly figure or table text has no prose left, so it is still
/// skipped whole.
const FIGURE_PAGE: &str = "VC010  18/18 A2960 METAR KIND 1950Z 16012KT 3SM RA                  BKN020\nXPDR    5537  IDNT  LCL 10:12:34\nRisk Assessment Matrix      LikelihoodSeverity\nLift: An upward force.\n";

#[test]
fn a_mostly_figure_page_and_a_tabbed_page_are_still_suspect() {
    let tabbed = "Lift: An upward force.\nWind is 10 kt.\nDrag:\tA resisting force.\n";
    for garbled in [FIGURE_PAGE, tabbed] {
        let src = input(&[(Outcome::Text, JUSTIFIED_PROSE), (Outcome::Text, garbled)]);
        let k = extract(&src, None).unwrap();
        assert_eq!(k.pages_used, vec![1], "{garbled:?}");
        assert_eq!(k.pages_skipped_ambiguous, 1, "{garbled:?}");
        assert_sources(&k, &src);
    }
}

const BULLETED_PROSE: &str = "1. The Four Forces\n\u{2022} Lift acts upward on the airplane.\n  \u{25E6} Weight acts toward the earth.\n\u{25AA} Thrust: A forward force.\n- Drag — A resisting force.\n\u{2981} Total lift equals total weight in level flight.\n";

#[test]
fn bulleted_list_items_are_prose_and_keep_exact_raw_offsets() {
    let src = input(&[(Outcome::Text, BULLETED_PROSE)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.pages_used, vec![1]);
    assert_eq!(k.pages_skipped_ambiguous, 0);
    // Each bullet item is its own line; only the marker is dropped, so a card
    // quotes the raw bytes that follow it.
    assert_eq!(
        k.glossary
            .iter()
            .map(|c| (&*c.term, &*c.answer))
            .collect::<Vec<_>>(),
        vec![
            ("Thrust", "A forward force."),
            ("Drag", "A resisting force.")
        ]
    );
    evidence(
        &k.glossary[0].evidence[0],
        1,
        BULLETED_PROSE.find("Thrust").unwrap(),
        "Thrust: A forward force.",
    );
    evidence(
        &k.glossary[1].evidence[0],
        1,
        BULLETED_PROSE.find("Drag").unwrap(),
        "Drag — A resisting force.",
    );
    let sentences: Vec<_> = k.outline.iter().flat_map(|s| &s.sentences).collect();
    assert_eq!(
        sentences
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Lift acts upward on the airplane.",
            "Weight acts toward the earth."
        ]
    );
    for sentence in &sentences {
        assert_eq!(
            sentence.evidence.start_offset,
            BULLETED_PROSE.find(&*sentence.text).unwrap()
        );
    }
    // No emitted quote ever carries a marker.
    let marks = ['\u{2022}', '\u{25E6}', '\u{25AA}', '\u{2981}'];
    for e in k
        .glossary
        .iter()
        .chain(&k.cloze)
        .flat_map(|c| &c.evidence)
        .chain(k.outline.iter().flat_map(|s| &s.evidence))
    {
        assert!(!e.quote.contains(marks), "{e:?} still holds a marker");
    }
    assert_sources(&k, &src);
}

/// Real cached AFH text sets several consecutive list items on one line. Those
/// are ordinary items, not merged columns, so the page stays and every item is
/// quoted from the exact raw bytes that follow its own marker.
const MERGED_LIST_ITEMS: &str = "The initial climb begins when the airplane leaves the surface at 50 feet AGL. \u{2981} Failure to review the AFM and POH performance charts before 60 knots. \u{2981} Failure to clear the area below 100 feet.\n";

#[test]
fn several_bullets_on_one_line_are_items_and_never_make_a_page_suspect() {
    for merged in [
        "\u{2022} Lift: An upward force. \u{2022} Drag: An opposing force.",
        "\u{2022} Lift acts upward. \u{2022} Weight acts downward.",
        "Lift acts upward. \u{25E6} Weight acts downward.",
        "\u{25AA}\u{2981} Lift acts upward.",
        "\u{2022} Lift acts upward. Weight acts downward. \u{25AA}",
        MERGED_LIST_ITEMS,
    ] {
        let src = input(&[(Outcome::Text, BULLETED_PROSE), (Outcome::Text, merged)]);
        let k = extract(&src, None).unwrap();
        assert_eq!(k.pages_used, vec![1, 2], "{merged:?}");
        assert_eq!(k.pages_skipped_ambiguous, 0, "{merged:?}");
        assert_sources(&k, &src);
    }
    let src = input(&[(Outcome::Text, MERGED_LIST_ITEMS)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.pages_used, vec![1]);
    // One line per item: the text before the first bullet and each item, so a
    // cloze card carries the whole sentence it came from at its raw offsets.
    let items = [
        "The initial climb begins when the airplane leaves the surface at 50 feet AGL.",
        "Failure to review the AFM and POH performance charts before 60 knots.",
        "Failure to clear the area below 100 feet.",
    ];
    let mut sentences = k.cloze.iter().map(|c| &c.evidence[0]);
    for item in items {
        let e = sentences
            .next()
            .unwrap_or_else(|| panic!("{item:?} lost its line"));
        evidence(e, 1, MERGED_LIST_ITEMS.find(item).unwrap(), item);
    }
    assert!(sentences.next().is_none());
    // A section deliberately keeps two sentences, and they are the first items.
    let outline: Vec<_> = k
        .outline
        .iter()
        .flat_map(|s| &s.sentences)
        .map(|s| s.text.as_str())
        .collect();
    assert_eq!(outline, items[..2].to_vec());
    for e in k
        .glossary
        .iter()
        .chain(&k.cloze)
        .flat_map(|c| &c.evidence)
        .chain(k.outline.iter().flat_map(|s| &s.evidence))
        .chain(k.questions.iter().flat_map(|q| &q.evidence))
    {
        assert!(
            !e.quote
                .contains(['\u{2022}', '\u{25E6}', '\u{25AA}', '\u{2981}']),
            "{e:?} still holds a marker"
        );
    }
    assert_sources(&k, &src);
}

#[test]
fn dot_leaders_are_suspect_and_a_short_dot_run_is_not() {
    for prose in [
        "Lift.. An upward force.",
        "Lift... An upward force.",
        "The lift is steady... the ride is smooth.",
    ] {
        let src = input(&[(Outcome::Text, JUSTIFIED_PROSE), (Outcome::Text, prose)]);
        let k = extract(&src, None).unwrap();
        assert_eq!(k.pages_used, vec![1, 2], "{prose:?}");
        assert_eq!(k.pages_skipped_ambiguous, 0, "{prose:?}");
        assert_sources(&k, &src);
    }
    for garbled in [
        "Lift........An upward force.",
        "Lift .... an upward force.",
        "Lift . . . . an upward force.",
        "Lift. . . . . an upward force.",
    ] {
        let src = input(&[(Outcome::Text, JUSTIFIED_PROSE), (Outcome::Text, garbled)]);
        let k = extract(&src, None).unwrap();
        assert_eq!(k.pages_used, vec![1], "{garbled:?}");
        assert_eq!(k.pages_skipped_ambiguous, 1, "{garbled:?}");
        assert_sources(&k, &src);
    }
    let ellipsis = "The lift is steady... the ride is smooth.";
    let src = input(&[(Outcome::Text, ellipsis)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(
        k.outline
            .iter()
            .flat_map(|s| &s.sentences)
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec!["The lift is steady...", "the ride is smooth."]
    );
    assert_sources(&k, &src);
    assert_eq!(
        kit("Lift: An upward force...").glossary[0].answer,
        "An upward force..."
    );
}

#[test]
fn acronym_explicit_only_and_conflicts_suppressed() {
    let src = input(&[(Outcome::Text, "Air Traffic Control (ATC) directs traffic.\nPIC (Pilot In Command) is responsible.\nXYZ is unexplained.\nWrong Phrase (QQ) is ignored."),
        (Outcome::Text, "Automatic Throttle Control (ATC) is different.")]);
    let k = extract(&src, None).unwrap();
    assert_eq!(
        k.glossary
            .iter()
            .map(|c| (&*c.term, &*c.answer))
            .collect::<Vec<_>>(),
        vec![("PIC", "Pilot In Command")]
    );
    evidence(
        &k.glossary[0].evidence[0],
        1,
        src.pages[0].text.find("PIC").unwrap(),
        "PIC (Pilot In Command)",
    );
    assert!(!k.cloze.iter().any(|c| c.answer == "ATC"));
    assert_sources(&k, &src);
}

#[test]
fn number_unit_cloze_keeps_qualifiers_and_ranges() {
    let text = "Remain below 3,000 ft AGL on this route.\nThe wind is 10–15 kt at the surface.\nTolerance is ± 2 °C for this gauge.\nFrequency is 123.45 MHz on tower.\nPower is 75% of the rated maximum.";
    let k = kit(text);
    // A blank also needs real sentence around it, so each of these lines carries
    // the four words of context v4 asks for. "at or below" is only cardable when
    // printed as a capital (see numeric_units_signs_decimals_and_bounds_are_literal).
    assert_eq!(
        k.cloze
            .iter()
            .map(|c| (&*c.prompt, &*c.answer))
            .collect::<Vec<_>>(),
        vec![
            ("Remain ____ on this route.", "below 3,000 ft AGL"),
            ("The wind is ____ at the surface.", "10–15 kt"),
            ("Tolerance is ____ for this gauge.", "± 2 °C"),
            ("Frequency is ____ on tower.", "123.45 MHz"),
            ("Power is ____ of the rated maximum.", "75%")
        ]
    );
    evidence(
        &k.cloze[0].evidence[0],
        1,
        0,
        "Remain below 3,000 ft AGL on this route.",
    );
    assert_sources(&k, &input(&[(Outcome::Text, text)]));
}

fn document(pages: u32) -> lopdf::Document {
    use lopdf::{dictionary, Object};
    let mut doc = lopdf::Document::with_version("1.5");
    let tree = doc.new_object_id();
    let mut ids = Vec::new();
    for _ in 0..pages {
        let id = doc.add_object(dictionary! {"Type"=>"Page", "Parent"=>tree});
        ids.push(Object::Reference(id));
    }
    doc.objects.insert(
        tree,
        dictionary! {"Type"=>"Pages", "Kids"=>ids, "Count"=>pages}.into(),
    );
    let root = doc.add_object(dictionary! {"Type"=>"Catalog", "Pages"=>tree});
    doc.trailer.set("Root", root);
    doc
}

#[test]
fn outline_bookmarks_then_headings_then_page_ranges() {
    use lopdf::{dictionary, Object};
    let src = input(&[
        (
            Outcome::Text,
            "1. Forces\nLift acts upward. Drag resists motion.",
        ),
        (Outcome::Text, "Wind varies. Check the source."),
    ]);
    let mut doc = document(2);
    let page = doc.get_pages()[&1];
    let outline = doc.new_object_id();
    let entry = doc.add_object(dictionary! {"Title"=>Object::string_literal("Source chapter"), "Dest"=>vec![Object::Reference(page), Object::Name(b"Fit".to_vec())]});
    doc.get_object_mut(entry)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Next", entry); // cycle must terminate
    doc.objects
        .insert(outline, dictionary! {"First"=>entry}.into());
    let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    doc.get_object_mut(root)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Outlines", outline);
    let k = extract(&src, Some(&doc)).unwrap();
    assert_eq!(k.outline.len(), 1);
    assert_eq!(k.outline[0].heading, "Source chapter");
    assert_eq!(
        k.outline[0]
            .sentences
            .iter()
            .map(|s| &*s.text)
            .collect::<Vec<_>>(),
        vec!["Lift acts upward.", "Drag resists motion."]
    );
    evidence(&k.outline[0].evidence[0], 1, 10, "Lift acts upward.");
    assert_sources(&k, &src);
    let h = extract(&src, None).unwrap();
    assert_eq!(h.outline[0].heading, "1. Forces");
    let fallback = kit("Wind varies. Check the source.");
    assert_eq!(fallback.outline[0].heading, "Pages 1–1");
    assert_eq!(fallback.outline[0].source_page, 1);
    // A destination outside the actual page tree is refused, then heading fallback applies.
    doc.get_object_mut(entry)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set(
            "Dest",
            vec![Object::Reference((999, 0)), Object::Name(b"Fit".to_vec())],
        );
    assert_eq!(
        extract(&src, Some(&doc)).unwrap().outline[0].heading,
        "1. Forces"
    );
}

#[test]
fn ambiguous_multicolumn_tables_and_image_pages_emit_nothing_fabricated() {
    let src = input(&[
        (Outcome::Text, "Lift: A force.     Drag: Another force."),
        (Outcome::Text, "Term | Meaning\nLift | Upward."),
        (Outcome::ImageOnly, "Lift: Ignore this text."),
        (Outcome::TextUnreadable, "Drag: Ignore this text."),
        (Outcome::Failed, "Wind: Ignore this text."),
        (Outcome::Blank, ""),
        (Outcome::Unknown, ""),
    ]);
    let k = extract(&src, None).unwrap();
    assert!(
        k.glossary.is_empty()
            && k.cloze.is_empty()
            && k.outline.is_empty()
            && k.questions.is_empty()
    );
    assert_eq!(k.pages_skipped_image, 1);
    assert_eq!(k.pages_skipped_unreadable, 1);
    assert_eq!(k.pages_skipped_failed, 1);
    assert_eq!(k.pages_skipped_ambiguous, 2);
    assert_eq!(k.pages_skipped_other, 2);
    assert!(k.pages_used.is_empty());
}

#[test]
fn questions_use_only_in_pdf_distractors_or_fall_back_to_cards() {
    let k = kit("Lift: An upward force.\nDrag: Motion resistance.");
    assert_eq!(k.questions.len(), 2);
    assert_eq!(k.questions[0].prompt, "What does “Lift” mean in this PDF?");
    assert_eq!(
        k.questions[0].choices,
        vec!["An upward force.", "Motion resistance."]
    );
    assert_eq!(k.questions[0].correct_index, 0);
    assert_eq!(k.questions[0].answer, "An upward force.");
    assert_eq!(k.questions[1].correct_index, 1);
    evidence(&k.questions[0].evidence[0], 1, 0, "Lift: An upward force.");
    assert_eq!(k.questions[0].choice_evidence.len(), 2);
    assert_eq!(kit("Lift: An upward force.").questions.len(), 0);
    assert_eq!(
        kit("Lift: An upward force.\nOther: An upward force in motion.")
            .questions
            .len(),
        0
    );
}

#[test]
fn distractors_never_mix_patterns() {
    let k = kit("Lift: An upward force.\nDrag: Motion resistance.\nAir Traffic Control (ATC) directs traffic.\nPIC (Pilot In Command) is responsible.\nAltitude is 3,000 ft above the field.\nHeight is 500 ft over the terrain.");
    let cards = k.glossary.iter().chain(&k.cloze).collect::<Vec<_>>();
    for rule in [Rule::Definition, Rule::Acronym, Rule::NumberCloze] {
        assert!(
            cards.iter().filter(|c| c.rule == rule).count() >= 2,
            "fixture must supply at least two {rule:?} cards"
        );
    }

    let mut question_patterns = std::collections::BTreeSet::new();
    for question in &k.questions {
        let source = cards
            .iter()
            .find(|c| {
                c.prompt == question.prompt
                    && c.answer == question.answer
                    && c.source_page == question.source_page
                    && c.evidence == question.evidence
            })
            .expect("every question must have a source card");
        question_patterns.insert(&source.pattern);
        for choice in &question.choices {
            assert!(
                cards
                    .iter()
                    .any(|c| c.pattern == source.pattern && c.answer == *choice),
                "choice {choice:?} must share source pattern {:?}",
                source.pattern
            );
            if source.rule == Rule::Definition {
                assert!(!k
                    .cloze
                    .iter()
                    .any(|c| c.rule == Rule::NumberCloze && c.answer == *choice));
            }
            if source.rule == Rule::Acronym {
                assert!(!k
                    .glossary
                    .iter()
                    .any(|c| c.rule == Rule::Definition && c.answer == *choice));
            }
        }
    }
    let available_patterns = cards.iter().map(|c| &c.pattern).collect();
    assert_eq!(question_patterns, available_patterns);
}

#[test]
fn repeat_same_bytes_same_candidates() {
    let src = input(&[
        (Outcome::Text, "Lift: An upward force.\nWind is 10 kt."),
        (Outcome::Text, "Lift: An upward force."),
    ]);
    let first = extract(&src, None).unwrap();
    for _ in 0..10 {
        assert_eq!(
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&extract(&src, None).unwrap()).unwrap()
        );
    }
    let mut shuffled = src.clone();
    shuffled.pages.reverse();
    assert_eq!(first, extract(&shuffled, None).unwrap());
    assert_eq!(first.glossary.len(), 1);
    assert_eq!(first.glossary[0].evidence.len(), 2);
    assert_sources(&first, &src);
}

#[test]
fn caps_are_enforced_without_quota_filling() {
    let texts = (0..60)
        .map(|i| {
            format!(
                "{}. Topic\nTerm{i}: Distinct explanation number {i}.\nWind is {i} kt at the field.",
                i + 1
            )
        })
        .collect::<Vec<_>>();
    let src = input(
        &texts
            .iter()
            .map(|s| (Outcome::Text, &**s))
            .collect::<Vec<_>>(),
    );
    let k = extract(&src, None).unwrap();
    assert_eq!(
        (
            k.glossary.len(),
            k.cloze.len(),
            k.outline.len(),
            k.questions.len()
        ),
        (40, 40, 40, 20)
    );
    assert_sources(&k, &src);
    let empty = kit("An incomplete fragment");
    assert!(
        empty.glossary.is_empty()
            && empty.cloze.is_empty()
            && empty.outline.is_empty()
            && empty.questions.is_empty()
    );
}

#[test]
fn pdf_kit_module_has_zero_network_imports() {
    let source = include_str!("pdf_study_kit.rs");
    for forbidden in [
        "gemini",
        "reqwest",
        "upload",
        "TcpStream",
        "std::net",
        "std::fs",
        "Command::",
    ] {
        assert!(
            !source.to_lowercase().contains(&forbidden.to_lowercase()),
            "unexpected dependency: {forbidden}"
        );
    }
}

#[test]
fn label_is_pulled_from_your_pdf_never_ai_or_verified() {
    assert_eq!(PROVENANCE_LABEL, "Pulled from your PDF on this Mac");
    for word in ["ai", "generated", "verified", "written by you"] {
        assert!(!PROVENANCE_LABEL.to_lowercase().contains(word));
    }
    let json = serde_json::to_value(kit("Lift: An upward force.")).unwrap();
    assert_eq!(json["algorithmVersion"], 4);
    assert_eq!(json["contentSha256"], "a".repeat(64));
}

#[test]
fn identity_page_bounds_and_unicode_raw_offsets() {
    let mut src = input(&[(
        Outcome::Text,
        "Café: A local example.\nThe wind is −2 °C at the field.",
    )]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.glossary[0].term, "Café");
    assert!(k.cloze.iter().any(|c| c.answer == "−2 °C"));
    assert_sources(&k, &src);
    src.pages[0].content_sha256 = "b".repeat(64);
    assert!(extract(&src, None).unwrap().glossary.is_empty());
    src.pages[0].content_sha256 = src.content_sha256.clone();
    src.pages[0].extractor_version += 1;
    assert!(extract(&src, None).unwrap().glossary.is_empty());
    src.pages[0].extractor_version = EXTRACTOR_VERSION;
    src.pages[0].page = 2;
    assert!(extract(&src, None).unwrap().glossary.is_empty());
    src.page_count = 1001;
    assert!(extract(&src, None).is_err());
}

#[test]
fn unsafe_fragments_duplicate_pages_and_question_stems_are_refused() {
    assert!(kit("Lift: A force. X.").glossary.is_empty());
    let k = kit("The wind is 10 kt at the field.\nThe wind is 20 kt at the field.");
    assert_eq!(k.cloze.len(), 2);
    assert!(k.questions.is_empty());
    let mut src = input(&[(Outcome::Text, "Lift: A force.")]);
    src.pages.push(src.pages[0].clone());
    assert!(extract(&src, None).unwrap().glossary.is_empty());
    let conflict = kit("Lift: An upward force.\nLift: A different explanation.");
    assert!(conflict.glossary.is_empty());
    let src = input(&[
        (Outcome::Text, "Wind varies."),
        (Outcome::ImageOnly, ""),
        (Outcome::Text, "Rain falls."),
    ]);
    let k = extract(&src, None).unwrap();
    assert_eq!(
        k.outline.iter().map(|s| &*s.heading).collect::<Vec<_>>(),
        vec!["Pages 1–1", "Pages 3–3"]
    );
}

#[test]
fn matching_view_preserves_nfkc_and_combining_mark_evidence() {
    let text = "Ｏｆｆｉｃｅ： A local room.\nThe office is open at the field.\nCafe\u{301}: A local place.\nThe café is open at the field.";
    let k = kit(text);
    assert_eq!(k.glossary[0].term, "Ｏｆｆｉｃｅ");
    assert!(k
        .cloze
        .iter()
        .any(|c| c.prompt == "The ____ is open at the field." && c.answer == "office"));
    assert!(k.cloze.iter().any(|c| c.answer == "café"));
    assert_sources(&k, &input(&[(Outcome::Text, text)]));
}

#[test]
fn named_destinations_and_malformed_or_cyclic_trees_are_bounded() {
    use lopdf::{dictionary, Object};
    let src = input(&[(Outcome::Text, "Wind varies.")]);
    let mut doc = document(1);
    let page = doc.get_pages()[&1];
    let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let entry = doc.add_object(dictionary! {"Title"=>Object::string_literal("Named chapter"), "Dest"=>Object::Name(b"chapter".to_vec())});
    let outline = doc.add_object(dictionary! {"First"=>entry});
    let names = doc.add_object(dictionary! {"Names"=>vec![Object::string_literal("chapter"),Object::Array(vec![page.into(), Object::Name(b"Fit".to_vec())])]});
    doc.get_object_mut(root)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Outlines", outline);
    doc.get_object_mut(root)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Names", dictionary! {"Dests"=>names});
    assert_eq!(
        extract(&src, Some(&doc)).unwrap().outline[0].heading,
        "Named chapter"
    );
    doc.get_object_mut(names)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set(
            "Names",
            vec![
                Object::string_literal("chapter"),
                Object::Array(vec![page.into(), Object::Name(b"FitR".to_vec())]),
            ],
        );
    assert_eq!(
        extract(&src, Some(&doc)).unwrap().outline[0].heading,
        "Pages 1–1"
    );
    let tree = doc
        .get_object(root)
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"Pages")
        .unwrap()
        .as_reference()
        .unwrap();
    doc.get_object_mut(tree)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("Kids", vec![Object::Reference(tree)]);
    assert_eq!(
        extract(&src, Some(&doc)).unwrap().outline[0].heading,
        "Pages 1–1"
    );
}

#[test]
fn numeric_units_signs_decimals_and_bounds_are_literal() {
    let text = "Pressure altitude is +2000ft today.\nGround distance is .5 NM today.\nCruise speed is 80 mph today.\nBaggage mass is 7 lb here.\nOutside temperature is -5°F now.\nThe pattern height is 10 feet.\nThe wind is 5 knots here.\nRemain At or below 3,000 ft AGL on this route.";
    let k = kit(text);
    assert_eq!(
        k.cloze.iter().map(|c| &*c.answer).collect::<Vec<_>>(),
        vec![
            "+2000ft",
            ".5 NM",
            "80 mph",
            "7 lb",
            "-5°F",
            "10 feet",
            "5 knots",
            "At or below 3,000 ft AGL"
        ]
    );
    assert_sources(&k, &input(&[(Outcome::Text, text)]));
    assert!(
        kit("Range is 1,00 ft.\nValue is 1.2.3 MHz.\nA ____ is 2 kt.")
            .cloze
            .is_empty()
    );
    assert!(kit("ﬀ: A local example.").glossary.is_empty());
    let term = "ﬀ".repeat(41); // 41 raw characters, 82 in its normalized matching view
                               // A normalized term that cannot be handled safely may be rejected too.
    assert!(kit(&format!("{}: A local example.", term.repeat(2)))
        .glossary
        .is_empty());
}

/// Real FAA pages wrap one sentence over several text lines. v3 read a line at a
/// time, so it carded the tail of a wrapped sentence as if it were the whole
/// thought: "increased to over ____.", "ADM training in the general aviation
/// (____) environment.". Here the two wrapped lines are one sentence, and the
/// evidence is the raw bytes of both of them, newline included.
const WRAPPED_PROSE: &str = "8. Density Altitude\nCrew Resource Management (CRM) applies to every phase of the flight.\nThe density altitude rose sharply because the field elevation\nand the outside temperature combined to push the takeoff distance over 2,000 feet.\n";
const WRAPPED_SENTENCE: &str = "The density altitude rose sharply because the field elevation\nand the outside temperature combined to push the takeoff distance over 2,000 feet.";

#[test]
fn a_wrapped_sentence_is_one_card_whose_evidence_spans_both_lines() {
    let src = input(&[(Outcome::Text, WRAPPED_PROSE)]);
    let k = extract(&src, None).unwrap();
    assert_eq!(k.pages_used, vec![1]);
    assert_eq!(k.pages_skipped_ambiguous, 0);
    // A good acronym card is still found on its own line, and a good number cloze
    // still comes out of the wrapped sentence.
    assert_eq!(k.glossary.len(), 1);
    let acronym = &k.glossary[0];
    assert_eq!(
        (&*acronym.term, &*acronym.answer),
        ("CRM", "Crew Resource Management")
    );
    let card = k
        .cloze
        .iter()
        .find(|c| c.answer == "2,000 feet")
        .expect("the wrapped sentence must still make its number card");
    assert_eq!(card.rule, Rule::NumberCloze);
    assert_eq!(
        card.prompt,
        "The density altitude rose sharply because the field elevation and the outside temperature combined to push the takeoff distance over ____."
    );
    assert!(!card.prompt.contains('\n'));
    assert!(!card.prompt.contains("  "));
    let start = WRAPPED_PROSE.find("The density").unwrap();
    evidence(&card.evidence[0], 1, start, WRAPPED_SENTENCE);
    // The quote is exactly the raw page text at its own offsets, wrapping and all.
    assert!(card.evidence[0].quote.contains('\n'));
    assert_eq!(
        &WRAPPED_PROSE[card.evidence[0].start_offset..card.evidence[0].end_offset],
        WRAPPED_SENTENCE
    );
    // The outline sees the same two sentences, not one per line.
    let sentences: Vec<_> = k.outline.iter().flat_map(|s| &s.sentences).collect();
    assert_eq!(
        sentences
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Crew Resource Management (CRM) applies to every phase of the flight.",
            WRAPPED_SENTENCE,
        ]
    );
    // v3 cut the paragraph at every line end and carded the tail on its own.
    assert!(!k
        .cloze
        .iter()
        .any(|c| c.prompt.starts_with("and the outside")));
    assert_eq!(k.cloze.len(), 2);
    assert_sources(&k, &src);
}

/// The owner's bad cards, rebuilt as small synthetic pages with the same shapes.
/// Every one of them is a wrapping artefact, so v4 emits nothing for it.
#[test]
fn wrapped_fragments_and_filler_blanks_produce_no_card() {
    // "to provide different" was the term of a broken " means " split whose
    // definition opened in lower case: neither half is a card.
    let filler = kit("The FSS network uses remote receivers\nspecialized to provide different means of accessing weather information.");
    assert!(
        filler.glossary.is_empty(),
        "a lower-case definition is not a meaning"
    );
    assert!(!filler
        .cloze
        .iter()
        .any(|c| c.answer == "to provide different"));
    assert!(!filler
        .cloze
        .iter()
        .any(|c| c.prompt == "____ means of accessing weather information."));

    // A term that is a bare connector ("of circumstances." was blanked to "of")
    // is prose glue, so neither its card nor a question offering it appears.
    let connector = kit("of — A particle that joins two ideas in a sentence.\nHazard factors explain a minor percentage\nof circumstances.");
    assert!(connector.glossary.is_empty());
    assert!(!connector.cloze.iter().any(|c| c.answer == "of"));
    assert!(!connector
        .questions
        .iter()
        .any(|q| q.choices.contains(&"of".to_string())));

    // "avionics safely" is the tail of the line above its colon, and its
    // "definition" starts mid-sentence; the good line beside it still cards.
    let broken = kit("avionics safely: information, automation, and risk.\nChecklist: A printed sequence of the pilot actions.");
    assert_eq!(
        broken.glossary.iter().map(|c| &*c.term).collect::<Vec<_>>(),
        vec!["Checklist"]
    );
    assert!(!broken
        .glossary
        .iter()
        .any(|c| c.prompt == "What does “avionics safely” mean in this PDF?"));

    // A blank that opens with a lower-case function word is refused even when its
    // term card exists, which is the "surface of ____" shape.
    let glue = kit("the ground: The surface beneath the airplane in this chapter.\nThe pilot compares the air temperature and dew point at the surface of the ground, and the spread is 14 °C today.");
    assert!(glue.glossary.iter().any(|c| c.term == "the ground"));
    assert!(!glue.cloze.iter().any(|c| c.answer == "the ground"));

    // And a blank that runs past a short phrase is a clause, not an answer.
    let clause = kit("temperature at which air becomes saturated: The FAA prints it in the TAF.\nThe dew point is the temperature at which air becomes saturated in this example.");
    assert!(clause
        .glossary
        .iter()
        .any(|c| c.term == "temperature at which air becomes saturated"));
    assert!(clause.cloze.is_empty());

    // A fragment prompt with no real question around it is refused, even when the
    // number inside it is printed correctly.
    assert!(kit("4. Climb Performance\nincreased to over 20 feet.")
        .cloze
        .is_empty());
}

#[test]
fn wrapped_sentence_card_prompt_collapses_whitespace_and_preserves_evidence_offsets() {
    let raw = "8. Density Altitude\nMany   principles   have   been\nsuccessfully applied to push the takeoff distance over 2,000 feet.\n";
    let wrapped_sentence = "Many   principles   have   been\nsuccessfully applied to push the takeoff distance over 2,000 feet.";
    let src = input(&[(Outcome::Text, raw)]);
    let k = extract(&src, None).unwrap();
    let card = k
        .cloze
        .iter()
        .find(|c| c.answer == "2,000 feet")
        .expect("number blank card present");
    assert_eq!(
        card.prompt,
        "Many principles have been successfully applied to push the takeoff distance over ____."
    );
    assert!(!card.prompt.contains('\n'));
    assert!(!card.prompt.contains("  "));
    let start = raw.find("Many").unwrap();
    evidence(&card.evidence[0], 1, start, wrapped_sentence);
    assert!(card.evidence[0].quote.contains('\n'));
    assert!(card.evidence[0].quote.contains("   "));
    assert_eq!(
        &raw[card.evidence[0].start_offset..card.evidence[0].end_offset],
        wrapped_sentence
    );
    assert_sources(&k, &src);
}

#[test]
fn label_lines_drop_single_lowercase_words_while_real_terms_and_numbers_stay() {
    let text = "screens: PFD (left display screen) and MFD.\nCenter of pressure: The point where the total aerodynamic force is concentrated.\nVisual Approach Slope Indicator (VASI) guides the descent.\nThe standard atmosphere has a surface temperature of 59 °F or 15 °C at sea level.\n";
    let src = input(&[(Outcome::Text, text)]);
    let k = extract(&src, None).unwrap();

    // (b) the "screens:" label line gives no card while "Center of pressure: The point where ..." still does
    assert!(
        !k.glossary
            .iter()
            .any(|c| c.term == "screens" || c.prompt.contains("screens")),
        "screens label line must give no glossary card"
    );
    assert!(
        !k.cloze
            .iter()
            .any(|c| c.answer == "screens" || c.term == "screens"),
        "screens must give no cloze card"
    );
    let cop = k
        .glossary
        .iter()
        .find(|c| c.term == "Center of pressure")
        .expect("Center of pressure definition card must appear");
    assert_eq!(
        cop.answer,
        "The point where the total aerodynamic force is concentrated."
    );
    assert_eq!(
        cop.prompt,
        "What does “Center of pressure” mean in this PDF?"
    );

    // (c) a good acronym card and a good number blank ("... a surface temperature of 59 °F or 15 °C ...") still appear
    let vasi = k
        .glossary
        .iter()
        .find(|c| c.term == "VASI")
        .expect("good acronym card VASI must appear");
    assert_eq!(vasi.answer, "Visual Approach Slope Indicator");
    assert_eq!(vasi.rule, Rule::Acronym);

    let temp_f = k
        .cloze
        .iter()
        .find(|c| c.answer == "59 °F")
        .expect("number blank for 59 °F must appear");
    assert_eq!(temp_f.rule, Rule::NumberCloze);
    assert_eq!(
        temp_f.prompt,
        "The standard atmosphere has a surface temperature of ____ or 15 °C at sea level."
    );

    let temp_c = k
        .cloze
        .iter()
        .find(|c| c.answer == "15 °C")
        .expect("number blank for 15 °C must appear");
    assert_eq!(temp_c.rule, Rule::NumberCloze);
    assert_eq!(
        temp_c.prompt,
        "The standard atmosphere has a surface temperature of 59 °F or ____ at sea level."
    );

    assert_sources(&k, &src);
}
