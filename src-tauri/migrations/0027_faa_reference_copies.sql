-- Local FAA shelf intake details; personal material notes remain hers.
CREATE TABLE faa_reference_copies (
    material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
    reference_id TEXT NOT NULL CHECK(reference_id IN ('private-acs', 'phak', 'phak-addendum')),
    edition TEXT NOT NULL DEFAULT '' CHECK(length(edition) <= 200),
    content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
    total_pages INTEGER NOT NULL CHECK(typeof(total_pages) = 'integer' AND total_pages >= 1),
    created_at TEXT NOT NULL
);
