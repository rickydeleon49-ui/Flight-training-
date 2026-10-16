-- Gemini-generated practice tests stay local after generation and remain
-- tied to the source material, exactly like ai_study_sets. Deleting the
-- source removes only its generated test.
CREATE TABLE practice_tests (
  source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
  title               TEXT NOT NULL DEFAULT '',
  questions_json      TEXT NOT NULL DEFAULT '[]',
  provider            TEXT NOT NULL DEFAULT 'gemini',
  model               TEXT NOT NULL DEFAULT '',
  generated_at        TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
