-- ORAL-01d: her finished oral answers, each frozen to the scenario version she answered.
-- Kept in complete backups only, never in exports; she can delete one or all.
CREATE TABLE oral_answers (
 id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
 scenario_id TEXT NOT NULL REFERENCES oral_scenarios(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES oral_scenario_versions(id) ON DELETE CASCADE,
 answer TEXT NOT NULL DEFAULT '' CHECK (length(answer) <= 20000),
 covered_json TEXT NOT NULL DEFAULT '[]',
 revealed_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK (finished_at IS NULL OR revealed_at IS NOT NULL)
);
