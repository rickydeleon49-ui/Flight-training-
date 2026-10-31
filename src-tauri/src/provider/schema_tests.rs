use super::*;
use serde_json::json;
#[test]
fn study_aid_schema_identity() {
    let expected = json!({
        "type": "OBJECT",
        "required": ["title", "summary", "sections", "flashcards", "sourceNotes"],
        "properties": {
            "title": {"type": "STRING"},
            "summary": {"type": "STRING"},
            "sections": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "required": ["heading", "body"],
                    "properties": {
                        "heading": {"type": "STRING"},
                        "body": {"type": "STRING"}
                    }
                }
            },
            "flashcards": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "required": ["front", "back", "sourcePage", "quote"],
                    "properties": {
                        "front": {"type": "STRING"},
                        "back": {"type": "STRING"},
                        "sourcePage": {"type": "INTEGER", "nullable": true},
                        "quote": {"type": "STRING", "maxLength": 300}
                    }
                }
            },
            "sourceNotes": {"type": "STRING"}
        }
    });
    let actual = AnyProvider::default().translate_schema(&schemas::study_aid());
    assert_eq!(actual, expected);
    assert_eq!(
        serde_json::to_vec(&actual).unwrap(),
        serde_json::to_vec(&expected).unwrap()
    );
}
#[test]
fn practice_test_schema_identity() {
    let expected = json!({
        "type": "OBJECT",
        "required": ["title", "questions"],
        "properties": {
            "title": {"type": "STRING"},
            "questions": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "required": ["question", "acsTask", "options", "correctIndex", "explanation", "sourcePage", "quote"],
                    "properties": {
                        "question": {"type": "STRING"},
                        "acsTask": {"type": "STRING", "nullable": true},
                        "options": {
                            "type": "ARRAY", "minItems": 3, "maxItems": 3,
                            "items": {"type": "STRING"}
                        },
                        "correctIndex": {"type": "INTEGER"},
                        "explanation": {"type": "STRING"},
                        "sourcePage": {"type": "INTEGER", "nullable": true},
                        "quote": {"type": "STRING", "maxLength": 300}
                    }
                }
            }
        }
    });
    let actual = AnyProvider::default().translate_schema(&schemas::practice_test());
    assert_eq!(actual, expected);
    assert_eq!(
        serde_json::to_vec(&actual).unwrap(),
        serde_json::to_vec(&expected).unwrap()
    );
}
#[test]
fn section_schema_identity() {
    let expected = json!({"type":"OBJECT","required":["body","sourcePages"],"properties":{"body":{"type":"STRING"},"sourcePages":{"type":"ARRAY","items":{"type":"INTEGER"}}}});
    let actual = AnyProvider::default().translate_schema(&schemas::section());
    assert_eq!(actual, expected);
    assert_eq!(
        serde_json::to_vec(&actual).unwrap(),
        serde_json::to_vec(&expected).unwrap()
    );
}
#[test]
fn ask_pdf_schema_identity() {
    let expected = json!({
        "type": "OBJECT",
        "required": ["answer", "notAnswered", "passages"],
        "properties": {
            "answer": {"type": "STRING", "maxLength": crate::gemini_ask::MAX_ANSWER_CHARS},
            "notAnswered": {"type": "BOOLEAN"},
            "passages": {
                "type": "ARRAY", "maxItems": 3,
                "items": {
                    "type": "OBJECT", "required": ["page", "quote"],
                    "properties": {
                        "page": {"type": "INTEGER", "minimum": 1},
                        "quote": {"type": "STRING", "maxLength": 400}
                    }
                }
            }
        }
    });
    let actual = AnyProvider::default().translate_schema(&schemas::ask_pdf());
    assert_eq!(actual, expected);
    assert_eq!(
        serde_json::to_vec(&actual).unwrap(),
        serde_json::to_vec(&expected).unwrap()
    );
}
#[test]
fn ask_text_schema_identity() {
    let expected = json!({
        "type": "OBJECT",
        "required": ["answer", "sourcePages"],
        "properties": {
            "answer": {"type": "STRING"},
            "sourcePages": {"type": "ARRAY", "items": {"type": "INTEGER"}}
        }
    });
    let actual = AnyProvider::default().translate_schema(&schemas::ask_text());
    assert_eq!(actual, expected);
    assert_eq!(
        serde_json::to_vec(&actual).unwrap(),
        serde_json::to_vec(&expected).unwrap()
    );
}
