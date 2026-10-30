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
            (
                "flashcards",
                Schema::array(Schema::object(
                    &[
                        ("front", Schema::string()),
                        ("back", Schema::string()),
                        ("sourcePage", Schema::integer().nullable(true)),
                    ],
                    &["front", "back", "sourcePage"],
                )),
            ),
            ("sourceNotes", Schema::string()),
        ],
        &["title", "summary", "sections", "flashcards", "sourceNotes"],
    )
}
pub(crate) fn practice_test() -> Schema {
    Schema::object(
        &[
            ("title", Schema::string()),
            (
                "questions",
                Schema::array(Schema::object(
                    &[
                        ("question", Schema::string()),
                        ("options", Schema::array(Schema::string())),
                        ("correctIndex", Schema::integer()),
                        ("explanation", Schema::string()),
                        ("sourcePage", Schema::integer().nullable(true)),
                    ],
                    &[
                        "question",
                        "options",
                        "correctIndex",
                        "explanation",
                        "sourcePage",
                    ],
                )),
            ),
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
