-- Migration 0018: authoritative source evidence for locally extracted PDF kits.
CREATE TABLE IF NOT EXISTS pdf_kit_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL,
  selected_pages_json TEXT NOT NULL,
  extractor_version INTEGER NOT NULL,
  algorithm_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pdf_kit_item_sources (
  run_id TEXT NOT NULL REFERENCES pdf_kit_runs(run_id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('summary','section','card','question')),
  logical_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page BETWEEN 1 AND 1000),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
  quote TEXT NOT NULL CHECK (length(quote) BETWEEN 1 AND 2000),
  PRIMARY KEY (run_id, item_kind, logical_id, content_hash, page, start_offset)
);
CREATE INDEX IF NOT EXISTS idx_pdf_kit_runs_material ON pdf_kit_runs(material_id);
