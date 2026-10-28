CREATE TABLE visual_card_regions (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
 owner_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
 image_material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
 image_sha256 TEXT NOT NULL CHECK(length(image_sha256)=64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'),
 image_width INTEGER NOT NULL CHECK(typeof(image_width)='integer' AND image_width BETWEEN 1 AND 4096),
 image_height INTEGER NOT NULL CHECK(typeof(image_height)='integer' AND image_height BETWEEN 1 AND 4096),
 x INTEGER NOT NULL CHECK(typeof(x)='integer' AND x>=0),
 y INTEGER NOT NULL CHECK(typeof(y)='integer' AND y>=0),
 w INTEGER NOT NULL CHECK(typeof(w)='integer' AND w>0),
 h INTEGER NOT NULL CHECK(typeof(h)='integer' AND h>0),
 rotation INTEGER NOT NULL CHECK(typeof(rotation)='integer' AND rotation IN (0,90,180,270)),
 CHECK(image_width*image_height<=4000000),
 CHECK(x+w<=image_width AND y+h<=image_height)
);
CREATE INDEX visual_regions_owner ON visual_card_regions(owner_material_id);
CREATE TABLE card_item_visual_regions (
 item_id TEXT PRIMARY KEY NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
 region_id TEXT NOT NULL REFERENCES visual_card_regions(id) ON DELETE CASCADE
);
