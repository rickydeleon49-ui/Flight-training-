-- Migration 0016: study material she makes herself (OFFLINE-03).
--
-- Owner-approved scope: docs/OFFLINE_03_INVENTORY_AND_PROPOSAL_2026-10-19.md
-- (§2.2, §2.3, §2.5, §2.7 and §4).
--
-- Rules:
-- - Additive only. New tables cascade from the rows they describe, so deleting
--   a material removes its history and origins with it.
-- - study_set_history keeps the whole previous set or test, as stored, before
--   any edit, deletion, correction, regeneration or restore overwrites it.
--   Rows are never updated.
-- - Origins live in side tables because the legacy card_versions.provider
--   CHECK allows only 'gemini' and 'import'. That column is a compatibility
--   placeholder; display reads origin from these tables.
-- - summary_origin and retired_json describe the set's summary and the items
--   she deleted, corrected or rewrote. Existing rows get NULL and '[]'.
-- - material_bookmarks.quote is reserved for passage quotes (03c). Nothing
--   writes it yet.

CREATE TABLE IF NOT EXISTS study_set_history (
  id            TEXT PRIMARY KEY NOT NULL,
  material_id   TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('study_set', 'practice')),
  reason        TEXT NOT NULL CHECK (reason IN ('edit', 'delete', 'correct', 'regenerate', 'import', 'restore')),
  previous_json TEXT NOT NULL,
  provider      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_set_history
  ON study_set_history(material_id, created_at);

CREATE TABLE IF NOT EXISTS card_version_origins (
  version_id TEXT PRIMARY KEY NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
  origin     TEXT NOT NULL CHECK (origin IN ('manual', 'mixed'))
);

CREATE TABLE IF NOT EXISTS card_item_origins (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
  origin  TEXT NOT NULL CHECK (origin IN ('user', 'instructor'))
);

CREATE TABLE IF NOT EXISTS practice_item_origins (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES practice_test_items(id) ON DELETE CASCADE,
  origin  TEXT NOT NULL CHECK (origin IN ('user', 'instructor'))
);

ALTER TABLE ai_study_sets ADD COLUMN summary_origin TEXT
  CHECK (summary_origin IS NULL OR summary_origin IN ('user', 'instructor'));
ALTER TABLE ai_study_sets ADD COLUMN retired_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE material_bookmarks ADD COLUMN quote TEXT
  CHECK (quote IS NULL OR LENGTH(quote) <= 500);
