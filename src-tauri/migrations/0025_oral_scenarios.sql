-- ORAL-01c: her saved oral-question scenarios. Each edit adds a frozen version.
-- 'study_aid' and the answer actions are reserved now because a CHECK cannot widen later.
CREATE TABLE oral_scenarios (
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
 removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_oral_scenario_order ON oral_scenarios(material_id, position) WHERE removed_at IS NULL;
CREATE TABLE oral_scenario_versions (
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 scenario_id TEXT NOT NULL REFERENCES oral_scenarios(id) ON DELETE CASCADE,
 version_number INTEGER NOT NULL CHECK (typeof(version_number) = 'integer' AND version_number >= 1),
 prompt TEXT NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 4000),
 assumptions TEXT NOT NULL DEFAULT '' CHECK (length(assumptions) <= 2000),
 points_json TEXT NOT NULL,
 source_page INTEGER CHECK (source_page IS NULL OR (typeof(source_page) = 'integer' AND source_page >= 1)),
 origin TEXT NOT NULL CHECK (origin IN ('user', 'instructor', 'study_aid')),
 content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL,
 UNIQUE (scenario_id, version_number)
);
CREATE TABLE oral_save_operations (
 operation_id TEXT PRIMARY KEY NOT NULL,
 material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK (action IN ('create','edit','reorder','remove','answer','finish','erase')),
 payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
 result_json TEXT NOT NULL, applied_at TEXT NOT NULL
);
