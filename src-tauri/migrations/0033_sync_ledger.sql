-- S-2b: the sync ledger. Every local write to a synced table is logged by a trigger
-- (local_changes + sync_row_meta) unless an app_metadata 'sync_applying' row is present
-- (set only while a peer's changes are being applied). sync_applied records change files
-- already applied. Add-only; never pruned. sync_row_meta.device_id may be NULL until the
-- frontend has created app_metadata 'device_id'.
CREATE TABLE local_changes (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  op         TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  changed_at TEXT NOT NULL
);
CREATE TABLE sync_row_meta (
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  device_id  TEXT,
  changed_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  PRIMARY KEY (table_name, row_id)
);
CREATE TABLE sync_applied (
  peer_device TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  applied_at  TEXT NOT NULL,
  PRIMARY KEY (peer_device, file_name)
);

CREATE TRIGGER trg_sync_study_materials_insert AFTER INSERT ON study_materials FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('study_materials', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('study_materials', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_study_materials_update AFTER UPDATE ON study_materials FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('study_materials', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('study_materials', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_study_materials_delete AFTER DELETE ON study_materials FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('study_materials', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('study_materials', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_material_content_identities_insert AFTER INSERT ON material_content_identities FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_content_identities', NEW.material_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_content_identities', NEW.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_material_content_identities_update AFTER UPDATE ON material_content_identities FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_content_identities', NEW.material_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_content_identities', NEW.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_material_content_identities_delete AFTER DELETE ON material_content_identities FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_content_identities', OLD.material_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_content_identities', OLD.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_review_generations_insert AFTER INSERT ON card_review_generations FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_generations', NEW.source_material_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_generations', NEW.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_review_generations_update AFTER UPDATE ON card_review_generations FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_generations', NEW.source_material_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_generations', NEW.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_review_generations_delete AFTER DELETE ON card_review_generations FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_generations', OLD.source_material_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_generations', OLD.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_versions_insert AFTER INSERT ON card_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_versions', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_versions', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_versions_update AFTER UPDATE ON card_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_versions', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_versions', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_versions_delete AFTER DELETE ON card_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_versions', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_versions', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_version_origins_insert AFTER INSERT ON card_version_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_version_origins', NEW.version_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_version_origins', NEW.version_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_version_origins_update AFTER UPDATE ON card_version_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_version_origins', NEW.version_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_version_origins', NEW.version_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_version_origins_delete AFTER DELETE ON card_version_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_version_origins', OLD.version_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_version_origins', OLD.version_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_items_insert AFTER INSERT ON card_items FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_items', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_items', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_items_update AFTER UPDATE ON card_items FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_items', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_items', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_items_delete AFTER DELETE ON card_items FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_items', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_items', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_item_origins_insert AFTER INSERT ON card_item_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_item_origins', NEW.item_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_item_origins', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_item_origins_update AFTER UPDATE ON card_item_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_item_origins', NEW.item_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_item_origins', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_item_origins_delete AFTER DELETE ON card_item_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_item_origins', OLD.item_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_item_origins', OLD.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_review_events_insert AFTER INSERT ON card_review_events FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_events', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_events', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_review_events_update AFTER UPDATE ON card_review_events FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_events', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_events', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_review_events_delete AFTER DELETE ON card_review_events FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_events', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_events', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_review_state_insert AFTER INSERT ON card_review_state FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_state', NEW.item_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_state', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_review_state_update AFTER UPDATE ON card_review_state FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_state', NEW.item_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_state', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_review_state_delete AFTER DELETE ON card_review_state FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_review_state', OLD.item_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_review_state', OLD.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_practice_tests_insert AFTER INSERT ON practice_tests FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_tests', NEW.source_material_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_tests', NEW.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_tests_update AFTER UPDATE ON practice_tests FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_tests', NEW.source_material_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_tests', NEW.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_tests_delete AFTER DELETE ON practice_tests FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_tests', OLD.source_material_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_tests', OLD.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_practice_test_versions_insert AFTER INSERT ON practice_test_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_test_versions', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_test_versions', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_test_versions_update AFTER UPDATE ON practice_test_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_test_versions', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_test_versions', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_test_versions_delete AFTER DELETE ON practice_test_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_test_versions', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_test_versions', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_practice_test_items_insert AFTER INSERT ON practice_test_items FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_test_items', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_test_items', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_test_items_update AFTER UPDATE ON practice_test_items FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_test_items', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_test_items', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_test_items_delete AFTER DELETE ON practice_test_items FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_test_items', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_test_items', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_practice_item_origins_insert AFTER INSERT ON practice_item_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_item_origins', NEW.item_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_item_origins', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_item_origins_update AFTER UPDATE ON practice_item_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_item_origins', NEW.item_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_item_origins', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_item_origins_delete AFTER DELETE ON practice_item_origins FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_item_origins', OLD.item_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_item_origins', OLD.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_practice_attempts_insert AFTER INSERT ON practice_attempts FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_attempts', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_attempts', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_attempts_update AFTER UPDATE ON practice_attempts FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_attempts', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_attempts', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_attempts_delete AFTER DELETE ON practice_attempts FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_attempts', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_attempts', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_practice_responses_insert AFTER INSERT ON practice_responses FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_responses', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_responses', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_responses_update AFTER UPDATE ON practice_responses FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_responses', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_responses', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_practice_responses_delete AFTER DELETE ON practice_responses FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('practice_responses', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('practice_responses', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_ai_study_sets_insert AFTER INSERT ON ai_study_sets FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('ai_study_sets', NEW.source_material_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('ai_study_sets', NEW.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_ai_study_sets_update AFTER UPDATE ON ai_study_sets FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('ai_study_sets', NEW.source_material_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('ai_study_sets', NEW.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_ai_study_sets_delete AFTER DELETE ON ai_study_sets FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('ai_study_sets', OLD.source_material_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('ai_study_sets', OLD.source_material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_study_set_history_insert AFTER INSERT ON study_set_history FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('study_set_history', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('study_set_history', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_study_set_history_update AFTER UPDATE ON study_set_history FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('study_set_history', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('study_set_history', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_study_set_history_delete AFTER DELETE ON study_set_history FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('study_set_history', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('study_set_history', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_material_reading_state_insert AFTER INSERT ON material_reading_state FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_reading_state', NEW.material_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_reading_state', NEW.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_material_reading_state_update AFTER UPDATE ON material_reading_state FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_reading_state', NEW.material_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_reading_state', NEW.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_material_reading_state_delete AFTER DELETE ON material_reading_state FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_reading_state', OLD.material_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_reading_state', OLD.material_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_material_bookmarks_insert AFTER INSERT ON material_bookmarks FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_bookmarks', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_bookmarks', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_material_bookmarks_update AFTER UPDATE ON material_bookmarks FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_bookmarks', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_bookmarks', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_material_bookmarks_delete AFTER DELETE ON material_bookmarks FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('material_bookmarks', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('material_bookmarks', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;
