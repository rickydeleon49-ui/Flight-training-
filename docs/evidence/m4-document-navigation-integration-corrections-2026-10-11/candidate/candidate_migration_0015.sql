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
-- 7. Durable Content Ownership (M4-R3): Each bookmark and reading state row binds directly to
--    originating_content_sha256. When a file is replaced with different bytes, bookmarks retain their
--    originating hash and can be flagged as unverified/drifted rather than silently mislinked.
-- 8. Strict Hash Formatting (M4-R3): content_sha256 must be exactly 64 hexadecimal characters.
-- 9. Honest Reading Semantics (M4-R4): reading state distinguishes last_requested_page from confirmed_read.
-- 10. Bounded Fields: title <= 500 chars, notes <= 20000 chars, page_label <= 100 chars.
-- 11. Authoritative backup compliance: all three tables participate in standard SQLite backup/restore;
--     no derived FTS or temporary cache tables are placed in authoritative backup scope.

-- 1. Reading state: tracks the last physical page requested and optional confirmed reading progress.
CREATE TABLE IF NOT EXISTS material_reading_state (
  material_id                 TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  last_requested_page         INTEGER NOT NULL CHECK (TYPEOF(last_requested_page) = 'integer' AND last_requested_page >= 1),
  last_requested_page_label   TEXT CHECK (last_requested_page_label IS NULL OR LENGTH(last_requested_page_label) <= 100),
  confirmed_read              INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_read IN (0, 1)),
  originating_content_sha256  TEXT NOT NULL CHECK (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unverified', 'drifted')),
  updated_at                  TEXT NOT NULL
);

-- 2. Bookmarks: user-created navigation points bound to originating document content.
CREATE TABLE IF NOT EXISTS material_bookmarks (
  id                          TEXT PRIMARY KEY NOT NULL,
  material_id                 TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  page_index                  INTEGER NOT NULL CHECK (TYPEOF(page_index) = 'integer' AND page_index >= 1),
  page_label                  TEXT CHECK (page_label IS NULL OR LENGTH(page_label) <= 100),
  originating_content_sha256  TEXT NOT NULL CHECK (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  title                       TEXT NOT NULL CHECK (LENGTH(title) <= 500),
  notes                       TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 20000),
  status                      TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'unverified', 'drifted')),
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_material
  ON material_bookmarks(material_id);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_page
  ON material_bookmarks(material_id, page_index);

CREATE INDEX IF NOT EXISTS idx_material_bookmarks_hash
  ON material_bookmarks(originating_content_sha256);

-- 3. Document content identity: caches verified SHA-256 and total page counts.
CREATE TABLE IF NOT EXISTS material_content_identities (
  material_id    TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL CHECK (LENGTH(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  total_pages    INTEGER NOT NULL CHECK (TYPEOF(total_pages) = 'integer' AND total_pages >= 1),
  verified_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_content_sha
  ON material_content_identities(content_sha256);
