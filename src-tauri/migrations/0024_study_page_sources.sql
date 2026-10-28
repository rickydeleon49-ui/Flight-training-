-- PDF-STUDY-01c: private page snapshots, separate from shared study content.
CREATE TABLE study_page_sources (
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 source_material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
 material_title TEXT NOT NULL CHECK (length(material_title) BETWEEN 1 AND 500),
 content_sha256 TEXT CHECK (content_sha256 IS NULL OR (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
 physical_page INTEGER NOT NULL CHECK (typeof(physical_page) = 'integer' AND physical_page >= 1),
 printed_label TEXT CHECK (printed_label IS NULL OR length(printed_label) <= 100),
 bookmark_id TEXT REFERENCES material_bookmarks(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE study_page_source_bindings (
 source_id TEXT NOT NULL REFERENCES study_page_sources(id) ON DELETE CASCADE,
 owner_key TEXT NOT NULL CHECK (length(owner_key) BETWEEN 1 AND 200),
 binding_kind TEXT NOT NULL CHECK (binding_kind IN ('authored_card','authored_question','frozen_card','frozen_question')),
 item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 128),
 content_fingerprint TEXT NOT NULL CHECK (length(content_fingerprint) = 64 AND content_fingerprint NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY (source_id, owner_key, binding_kind, item_key, content_fingerprint)
);
CREATE TRIGGER collect_study_page_sources AFTER DELETE ON study_page_source_bindings
BEGIN
 DELETE FROM study_page_sources WHERE id = OLD.source_id AND NOT EXISTS
 (SELECT 1 FROM study_page_source_bindings WHERE source_id = OLD.source_id);
END;
CREATE TRIGGER erase_frozen_card_page_sources AFTER DELETE ON card_items
BEGIN
 DELETE FROM study_page_source_bindings WHERE binding_kind = 'frozen_card' AND item_key = OLD.id;
END;
CREATE TRIGGER erase_material_card_page_sources AFTER DELETE ON study_materials
BEGIN
 DELETE FROM study_page_source_bindings WHERE owner_key = OLD.id
 AND binding_kind IN ('authored_card', 'frozen_card');
END;
