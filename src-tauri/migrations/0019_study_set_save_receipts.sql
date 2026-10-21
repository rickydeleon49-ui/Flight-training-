-- Additive receipts for PDF-bound study-set operations. Legacy saves keep
-- their existing history/content retry behavior and create no new receipts.
CREATE TABLE IF NOT EXISTS study_set_save_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);
