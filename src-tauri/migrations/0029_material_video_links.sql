CREATE TABLE IF NOT EXISTS material_video_links (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_video_links_material ON material_video_links(material_id);
