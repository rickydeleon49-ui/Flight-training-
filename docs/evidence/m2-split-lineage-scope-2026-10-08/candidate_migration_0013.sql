-- Candidate Migration 0013: Split-source lineage metadata
-- Milestone 2 / Split-Source Lineage (Proposed for Owner Approval)
--
-- This migration introduces durable split-source provenance for PDF study materials.
-- When a pilot divides an oversized FAA handbook or study PDF (auto or manual split),
-- this table records the relationship between the child part and its source document,
-- including original physical page ranges, content hashes, and parent references.
--
-- Invariants enforced by this schema:
-- 1. Non-split materials (notes, direct imports, complete handbooks) have NO rows here.
-- 2. Physical page bounds are 1-based integers: CHECK (source_page_start >= 1) and CHECK (source_page_end >= source_page_start).
-- 3. Total pages bound: CHECK (source_total_pages IS NULL OR source_total_pages >= source_page_end).
-- 4. Self-parenting is prohibited: CHECK (material_id != parent_material_id).
-- 5. Child deletion cascades: ON DELETE CASCADE removes lineage when the child material is deleted.
-- 6. Parent deletion preserves child: ON DELETE SET NULL nullifies parent_material_id while
--    preserving source_file_name, source_title, source_content_sha256, and page ranges.
--    Children are NEVER silently cascade-deleted when a parent is removed.

CREATE TABLE IF NOT EXISTS material_split_lineage (
  material_id            TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
  parent_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  root_material_id       TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_page_start      INTEGER NOT NULL,
  source_page_end        INTEGER NOT NULL,
  source_file_name       TEXT NOT NULL,
  source_title           TEXT NOT NULL,
  source_content_sha256  TEXT,
  source_total_pages     INTEGER,
  nested_level           INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  CHECK (source_page_start >= 1),
  CHECK (source_page_end >= source_page_start),
  CHECK (source_total_pages IS NULL OR source_total_pages >= source_page_end),
  CHECK (nested_level >= 1),
  CHECK (material_id != parent_material_id)
);

CREATE INDEX IF NOT EXISTS idx_split_lineage_parent ON material_split_lineage(parent_material_id);
CREATE INDEX IF NOT EXISTS idx_split_lineage_root ON material_split_lineage(root_material_id);
