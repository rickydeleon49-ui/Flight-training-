use super::Schema;
pub(crate) fn study_aid() -> Schema {
    Schema::object(
        &[
            ("title", Schema::string()),
            ("summary", Schema::string()),
            (
                "sections",
                Schema::array(Schema::object(
                    &[("heading", Schema::string()), ("body", Schema::string())],
                    &["heading", "body"],
                )),
            ),
            ("flashcards", Schema::array(card())),
            ("sourceNotes", Schema::string()),
        ],
        &["title", "summary", "sections", "flashcards", "sourceNotes"],
    )
}
pub(crate) fn practice_test() -> Schema {
    Schema::object(
        &[
            ("title", Schema::string()),
            ("questions", Schema::array(question())),
        ],
        &["title", "questions"],
    )
}
pub(crate) fn section() -> Schema {
    Schema::object(
        &[
            ("body", Schema::string()),
            ("sourcePages", Schema::array(Schema::integer())),
        ],
        &["body", "sourcePages"],
    )
}
pub(crate) fn ask_pdf() -> Schema {
    Schema::object(
        &[
            (
                "answer",
                Schema::string().max_length(crate::gemini_ask::MAX_ANSWER_CHARS),
            ),
            ("notAnswered", Schema::boolean()),
            (
                "passages",
                Schema::array(Schema::object(
                    &[
                        ("page", Schema::integer().minimum(1)),
                        ("quote", Schema::string().max_length(400)),
                    ],
                    &["page", "quote"],
                ))
                .max_items(3),
            ),
        ],
        &["answer", "notAnswered", "passages"],
    )
}
pub(crate) fn ask_text() -> Schema {
    Schema::object(
        &[
            ("answer", Schema::string()),
            ("sourcePages", Schema::array(Schema::integer())),
        ],
        &["answer", "sourcePages"],
    )
}

/// Reuse the exact single-generator shapes inside one response envelope.
fn card() -> Schema {
    Schema::object(
        &[
            ("front", Schema::string()),
            ("back", Schema::string()),
            ("sourcePage", Schema::integer().nullable(true)),
            ("quote", Schema::string().max_length(300)),
        ],
        &["front", "back", "sourcePage", "quote"],
    )
}
fn question() -> Schema {
    Schema::object(
        &[
            ("question", Schema::string()),
            (
                "options",
                Schema::array(Schema::string()).min_items(3).max_items(3),
            ),
            ("correctIndex", Schema::integer()),
            ("explanation", Schema::string()),
            ("sourcePage", Schema::integer().nullable(true)),
            ("quote", Schema::string().max_length(300)),
        ],
        &[
            "question",
            "options",
            "correctIndex",
            "explanation",
            "sourcePage",
            "quote",
        ],
    )
}
pub(crate) fn study_kit() -> Schema {
    Schema::object(
        &[
            (
                "guide",
                Schema::object(
                    &[
                        ("body", Schema::string().max_length(8000)),
                        ("sourcePages", Schema::array(Schema::integer())),
                    ],
                    &["body", "sourcePages"],
                ),
            ),
            ("cards", Schema::array(card())),
            ("questions", Schema::array(question())),
        ],
        &["guide", "cards", "questions"],
    )
}
