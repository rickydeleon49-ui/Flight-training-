-- Candidate Migration 0015: Document navigation, bookmarks, reading state, and content identity
-- Authoritative candidate DDL for Her Flight Deck Milestone 4 (Document Navigation Slice 1)
--
-- STATUS: PROPOSED / UNREGISTERED. DO NOT REGISTER OR APPLY IN RUNTIME.
--
-- Context and Architectural Constraints:
-- 1. Shipped migrations 0001–0013 and candidate 0014 (M3 skills evidence) are untouched.
-- 2. Fully additive schema: no columns are dropped or altered on existing tables.
-- 3. Document files remain in private app data ($APPCONFIG/documents/), referenced by study_materials.file_path.
-- 4. Foreign key cascade: deleting a study_material cascades to its navigation state, bookmarks, and identity cache.
-- 5. Strict integer typing: physical page indices must be integers >= 1 (1-based physical PDF index).
-- 6. Page labels (e.g. "iv", "3-12", "Cover") are kept distinct from 1-based physical page indices.
-- 7. Content identity: tracks verified SHA-256 hashes of imported/root documents so content drift and replacement
--    can be detected, alerting the pilot before navigating stale bookmarks.
-- 8. Authoritative backup compliance: all three tables participate in standard SQLite backup/restore; no derived FTS
--    or temporary cache tables are placed in authoritative backup scope.

-- 1. Reading state: tracks the last physical page and optional label viewed by the pilot.
CREATE TABLE IF NOT EXISTS material_reading_state (
  material_id          TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  last_read_page       INTEGER NOT NULL CHECK (TYPEOF(last_read_page) = 'integer' AND last_read_page >= 1),
  last_read_page_label TEXT,
  updated_at           TEXT NOT NULL
);

-- 2. Bookmarks: user-created navigation points within a study document.
CREATE TABLE IF NOT EXISTS material_bookmarks (
  id           TEXT PRIMARY KEY NOT NULL,
  material_id  TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  page_index   INTEGER NOT NULL CHECK (TYPEOF(page_index) = 'integer' AND page_index >= 1),
  page_label   TEXT,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_material
  ON material_bookmarks(material_id);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_page
  ON material_bookmarks(material_id, page_index);

-- 3. Document content identity: caches verified SHA-256 and total page counts for imported documents.
-- Used to detect if a file was replaced with a different edition or modified on disk.
CREATE TABLE IF NOT EXISTS material_content_identities (
  material_id    TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL,
  total_pages    INTEGER CHECK (total_pages IS NULL OR (TYPEOF(total_pages) = 'integer' AND total_pages >= 1)),
  verified_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_content_sha
  ON material_content_identities(content_sha256);
