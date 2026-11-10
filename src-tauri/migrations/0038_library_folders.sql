-- LIBRARY-ORG-01: her own folders in the Study Library. Personal organization only:
-- never part of a study pack. Deleting a folder never deletes a material.
CREATE TABLE library_folders (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Where one top-level material sits. No row = "Not in a folder", today's order.
-- folder_id is deliberately NOT a foreign key: a folder deleted on one device while the
-- other device moved something into it must not block a change file; an unknown
-- folder_id simply reads as "Not in a folder".
CREATE TABLE library_placements (
  material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  folder_id   TEXT,
  position    INTEGER,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_library_placements_folder ON library_placements(folder_id);

CREATE TRIGGER trg_sync_library_folders_insert AFTER INSERT ON library_folders FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('library_folders', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('library_folders', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_library_folders_update AFTER UPDATE ON library_folders FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('library_folders', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('library_folders', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_library_folders_delete AFTER DELETE ON library_folders FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('library_folders', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('library_folders', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_library_placements_insert AFTER INSERT ON library_placements FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('library_placements', NEW.material_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('library_placements', NEW.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_library_placements_update AFTER UPDATE ON library_placements FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('library_placements', NEW.material_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('library_placements', NEW.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_library_placements_delete AFTER DELETE ON library_placements FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('library_placements', OLD.material_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('library_placements', OLD.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;
