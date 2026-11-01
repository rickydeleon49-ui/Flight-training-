CREATE TABLE IF NOT EXISTS faa_downloads (
  material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  edition TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  bytes INTEGER NOT NULL,
  http_last_modified TEXT,
  downloaded_at TEXT NOT NULL
);
