-- Gemini-generated study aids stay local after generation and remain tied to
-- the source material. Deleting the source removes only its generated aid.
CREATE TABLE ai_study_sets (
  source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
  title              TEXT NOT NULL DEFAULT '',
  summary            TEXT NOT NULL DEFAULT '',
  sections_json      TEXT NOT NULL DEFAULT '[]',
  flashcards_json    TEXT NOT NULL DEFAULT '[]',
  source_notes       TEXT NOT NULL DEFAULT '',
  provider           TEXT NOT NULL DEFAULT 'gemini',
  model              TEXT NOT NULL DEFAULT '',
  generated_at       TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
