-- Candidate Migration 0013: Split-source lineage metadata and operation tracking log
-- Authoritative candidate DDL for Her Flight Deck Milestone 2 split lineage
--
-- This migration introduces durable split-source provenance for PDF study materials.
-- When a pilot divides an oversized FAA handbook or study PDF (auto or manual split),
-- this schema records the relationship between the child part and its source documents:
-- 1. Original root document: source_page_start, source_page_end, source_file_name, source_title, source_content_sha256, source_total_pages.
-- 2. Immediate parent part (for nested splits): parent_page_start, parent_page_end, parent_file_name, parent_title, parent_content_sha256, parent_total_pages.
-- 3. Child's own properties: child_page_count, nested_level.
-- 4. Authoritative split operation log: operation_id, source_material_id, receipt_canonical_json, receipt_hash, status.
--
-- Invariants enforced by this schema:
-- - Non-split materials (notes, direct imports, complete handbooks) have NO rows here.
-- - Child identity is mandatory: material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE.
-- - Physical page bounds are strictly integers >= 1: TYPEOF(...) = 'integer'.
-- - Range ordering: source_page_end >= source_page_start and parent_page_end >= parent_page_start.
-- - Range totals: source_total_pages >= source_page_end.
-- - Child page count matches range length: child_page_count = (source_page_end - source_page_start + 1).
-- - Cycle prevention: material_id != parent_material_id AND material_id != root_material_id.
-- - Structural tier classification:
--   nested_level = 1 requires parent_page_start, parent_page_end, and parent_total_pages to be NULL.
--   nested_level > 1 requires parent_page_start, parent_page_end, and parent_total_pages to be present.
-- - Parent deletion safety: ON DELETE SET NULL nullifies parent_material_id/root_material_id
--   while preserving immutable snapshot titles, filenames, hashes, and page ranges.
--   Children are NEVER cascade-deleted when a parent or root material is removed.
-- - Operation log tracking: operation_id primary key, declared delete policy (ON DELETE CASCADE),
--   receipt canonical JSON + hash, and status CHECK ('pending', 'committed', 'cancelled').

CREATE TABLE IF NOT EXISTS material_split_lineage (
  material_id            TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  parent_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  root_material_id       TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_page_start      INTEGER NOT NULL CHECK (TYPEOF(source_page_start) = 'integer' AND source_page_start >= 1),
  source_page_end        INTEGER NOT NULL CHECK (TYPEOF(source_page_end) = 'integer' AND source_page_end >= source_page_start),
  parent_page_start      INTEGER CHECK (parent_page_start IS NULL OR (TYPEOF(parent_page_start) = 'integer' AND parent_page_start >= 1)),
  parent_page_end        INTEGER CHECK (parent_page_end IS NULL OR (TYPEOF(parent_page_end) = 'integer' AND parent_page_end >= parent_page_start)),
  child_page_count       INTEGER NOT NULL CHECK (TYPEOF(child_page_count) = 'integer' AND child_page_count >= 1),
  source_file_name       TEXT NOT NULL,
  source_title           TEXT NOT NULL,
  source_content_sha256  TEXT,
  source_total_pages     INTEGER CHECK (source_total_pages IS NULL OR (TYPEOF(source_total_pages) = 'integer' AND source_total_pages >= source_page_end)),
  parent_file_name       TEXT,
  parent_title           TEXT,
  parent_content_sha256  TEXT,
  parent_total_pages     INTEGER CHECK (parent_total_pages IS NULL OR (TYPEOF(parent_total_pages) = 'integer' AND (parent_page_end IS NULL OR parent_total_pages >= parent_page_end))),
  nested_level           INTEGER NOT NULL DEFAULT 1 CHECK (TYPEOF(nested_level) = 'integer' AND nested_level >= 1),
  created_at             TEXT NOT NULL,
  CHECK (material_id != parent_material_id),
  CHECK (material_id != root_material_id),
  CHECK (child_page_count = (source_page_end - source_page_start + 1)),
  CHECK (parent_page_start IS NULL OR child_page_count = (parent_page_end - parent_page_start + 1)),
  CHECK ((parent_page_start IS NULL AND parent_page_end IS NULL) OR (parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL)),
  CHECK (
    (nested_level = 1 AND parent_page_start IS NULL AND parent_page_end IS NULL AND parent_total_pages IS NULL)
    OR
    (nested_level > 1 AND parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL AND parent_total_pages IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_split_lineage_parent ON material_split_lineage(parent_material_id);
CREATE INDEX IF NOT EXISTS idx_split_lineage_root ON material_split_lineage(root_material_id);

CREATE TABLE IF NOT EXISTS split_operation_log (
  operation_id           TEXT PRIMARY KEY NOT NULL,
  source_material_id     TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  receipt_canonical_json TEXT NOT NULL,
  receipt_hash           TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'cancelled')),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_split_operation_source ON split_operation_log(source_material_id);
CREATE INDEX IF NOT EXISTS idx_split_operation_status ON split_operation_log(status);
