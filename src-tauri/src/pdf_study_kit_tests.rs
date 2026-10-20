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
    let text = "Lift: An upward force.\nDrag — A resisting force.\nThrust means a forward force.\nWeight is defined as a downward force.\nLift: An upward force.";
    let k = kit(text);
    assert_eq!(
        k.glossary
            .iter()
            .map(|c| (&*c.term, &*c.answer))
            .collect::<Vec<_>>(),
        vec![
            ("Lift", "An upward force."),
            ("Drag", "A resisting force."),
            ("Thrust", "a forward force."),
            ("Weight", "a downward force."),
        ]
    );
    assert_eq!(k.glossary[0].evidence.len(), 2);
    evidence(&k.glossary[0].evidence[0], 1, 0, "Lift: An upward force.");
    evidence(
        &k.glossary[1].evidence[0],
        1,
        text.find("Drag").unwrap(),
        "Drag — A resisting force.",
    );
    assert_eq!(
        kit("Lift: unfinished\nQ: A complete sentence.\nBad: One. Two. Three.")
            .glossary
            .len(),
        0
    );
    assert_sources(&k, &input(&[(Outcome::Text, text)]));
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
    let text = "Remain at or below 3,000 ft AGL.\nWind is 10–15 kt.\nTolerance is ± 2 °C.\nFrequency is 123.45 MHz.\nPower is 75%.";
    let k = kit(text);
    assert_eq!(
        k.cloze
            .iter()
            .map(|c| (&*c.prompt, &*c.answer))
            .collect::<Vec<_>>(),
        vec![
            ("Remain ____.", "at or below 3,000 ft AGL"),
            ("Wind is ____.", "10–15 kt"),
            ("Tolerance is ____.", "± 2 °C"),
            ("Frequency is ____.", "123.45 MHz"),
            ("Power is ____.", "75%")
        ]
    );
    evidence(
        &k.cloze[0].evidence[0],
        1,
        0,
        "Remain at or below 3,000 ft AGL.",
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
    let k = kit("Lift: An upward force.\nDrag: Motion resistance.\nAir Traffic Control (ATC) directs traffic.\nPIC (Pilot In Command) is responsible.\nAltitude is 3,000 ft.\nHeight is 500 ft.");
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
        (Outcome::Text, "lift: An upward force."),
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
                "{}. Topic\nTerm{i}: Distinct explanation number {i}.\nWind is {i} kt.",
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
    assert_eq!(json["algorithmVersion"], 1);
    assert_eq!(json["contentSha256"], "a".repeat(64));
}

#[test]
fn identity_page_bounds_and_unicode_raw_offsets() {
    let mut src = input(&[(Outcome::Text, "Café: A local example.\nWind is −2 °C.")]);
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
    let k = kit("Wind is 10 kt.\nWind is 20 kt.");
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
    let text = "Ｏｆｆｉｃｅ： A local room.\nThe office is open.\nCafe\u{301}: A local place.\nThe café is open.";
    let k = kit(text);
    assert_eq!(k.glossary[0].term, "Ｏｆｆｉｃｅ");
    assert!(k
        .cloze
        .iter()
        .any(|c| c.prompt == "The ____ is open." && c.answer == "office"));
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
    let text = "Altitude is +2000ft.\nDistance is .5 NM.\nSpeed is 80 mph.\nMass is 7 lb.\nTemperature is -5°F.\nHeight is 10 feet.\nWind is 5 knots.\nRemain At or below 3,000 ft AGL.";
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
