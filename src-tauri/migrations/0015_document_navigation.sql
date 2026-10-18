-- Migration 0015: document navigation (M4 Slice 1).
--
-- Bookmarks, the last page she asked to open, and the verified identity of each
-- managed PDF, plus the durable operation claims that decide which open request
-- may record its page. Owner-approved scope: docs/M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md.
-- Accepted prototype: docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/.
--
-- Rules:
-- - Additive only. Every table cascades from study_materials, so deleting a
--   material removes its navigation state, bookmarks, identity and claims.
-- - Physical pages are 1-based whole numbers. Printed labels ("iv", "3-12")
--   are stored separately and never stand in for a physical page.
-- - A content hash, where present, is exactly 64 lowercase hex characters.
--   Bookmarks and reading state keep the hash of the file they were made for,
--   and it may be NULL: an unknown identity is stored as unverified, never
--   invented.
-- - material_content_identities is written only from the file's own bytes by
--   the native inspector; page and hash are never taken from the interface.
-- - Reading state separates the last requested page from an explicit read
--   confirmation. Opening a page never confirms reading.
-- - Ownership: material_operation_claims.reserved_generation is the latest
--   token issued for a material and cancelled_generation the highest cancelled
--   one; both only increase. A navigation commit writes only for the exact,
--   current, non-cancelled reserved token, and owner_generation records the
--   token that wrote the stored tuple.

CREATE TABLE IF NOT EXISTS material_content_identities (
  material_id    TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL CHECK (LENGTH(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  total_pages    INTEGER NOT NULL CHECK (TYPEOF(total_pages) = 'integer' AND total_pages >= 1),
  verified_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_content_sha
  ON material_content_identities(content_sha256);

CREATE TABLE IF NOT EXISTS material_reading_state (
  material_id                 TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  last_requested_page         INTEGER NOT NULL CHECK (TYPEOF(last_requested_page) = 'integer' AND last_requested_page >= 1),
  last_requested_page_label   TEXT CHECK (last_requested_page_label IS NULL OR LENGTH(last_requested_page_label) <= 100),
  confirmed_read              INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_read IN (0, 1)),
  originating_content_sha256  TEXT CHECK (
    originating_content_sha256 IS NULL
    OR (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unverified', 'drifted')),
  owner_generation            INTEGER NOT NULL DEFAULT 0 CHECK (TYPEOF(owner_generation) = 'integer' AND owner_generation >= 0),
  updated_at                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_reading_state_owner
  ON material_reading_state(material_id, owner_generation);

CREATE TABLE IF NOT EXISTS material_bookmarks (
  id                          TEXT PRIMARY KEY NOT NULL,
  material_id                 TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  page_index                  INTEGER NOT NULL CHECK (TYPEOF(page_index) = 'integer' AND page_index >= 1),
  page_label                  TEXT CHECK (page_label IS NULL OR LENGTH(page_label) <= 100),
  originating_content_sha256  TEXT CHECK (
    originating_content_sha256 IS NULL
    OR (LENGTH(originating_content_sha256) = 64 AND originating_content_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
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

CREATE TABLE IF NOT EXISTS material_operation_claims (
  material_id           TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  reserved_generation   INTEGER NOT NULL DEFAULT 0 CHECK (TYPEOF(reserved_generation) = 'integer' AND reserved_generation >= 0),
  cancelled_generation  INTEGER NOT NULL DEFAULT 0 CHECK (TYPEOF(cancelled_generation) = 'integer' AND cancelled_generation >= 0),
  updated_at            TEXT NOT NULL
);
