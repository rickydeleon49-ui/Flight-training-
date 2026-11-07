-- PACK-01: provenance of study packs added to this library (design 6 B).
-- Append-only: rows are only ever inserted. A row is "live" while material_id
-- is set; deleting a material turns its rows into tombstones (SET NULL), which
-- is how a later import knows she removed something.

CREATE TABLE study_pack_imports (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) = 36),
  pack_id TEXT NOT NULL CHECK (length(pack_id) = 36),
  pack_sha256 TEXT NOT NULL CHECK (length(pack_sha256) = 64),
  pack_format INTEGER NOT NULL,
  added INTEGER NOT NULL,
  added_guides INTEGER NOT NULL,
  added_documents INTEGER NOT NULL,
  added_pictures INTEGER NOT NULL,
  added_practice INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  new_versions INTEGER NOT NULL,
  readded INTEGER NOT NULL,
  cards_left_out INTEGER NOT NULL,
  cards_left_out_removed INTEGER NOT NULL,
  committed_at TEXT NOT NULL
);

CREATE TABLE study_pack_items (
  namespace TEXT NOT NULL CHECK (length(namespace) = 36),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  revision TEXT NOT NULL CHECK (length(revision) = 64 AND revision NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL CHECK (kind IN ('document', 'picture', 'guide')),
  file_sha256 TEXT CHECK (file_sha256 IS NULL OR (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*')),
  material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  link TEXT NOT NULL CHECK (link IN ('added', 'alias')),
  operation_id TEXT NOT NULL REFERENCES study_pack_imports(operation_id),
  imported_at TEXT NOT NULL CHECK (length(imported_at) = 24),
  PRIMARY KEY (namespace, item_id, operation_id)
);

CREATE INDEX idx_study_pack_items_identity ON study_pack_items(namespace, item_id);
CREATE INDEX idx_study_pack_items_revision ON study_pack_items(revision);
CREATE INDEX idx_study_pack_items_file ON study_pack_items(file_sha256) WHERE kind = 'picture';
CREATE UNIQUE INDEX idx_study_pack_items_added ON study_pack_items(material_id) WHERE link = 'added' AND material_id IS NOT NULL;

CREATE TABLE study_pack_acks (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES study_pack_imports(operation_id),
  acked_at TEXT NOT NULL
);
