-- S-6a7: picture cards sync. visual_card_regions and card_item_visual_regions join the sync
-- ledger (same triggers as 0033, silenced by app_metadata 'sync_applying'). Both are
-- content-addressed and write-once (Union): a region id is the hash of its descriptor and a
-- sidecar row is fixed by the card version's content hash. The only in-place change is
-- image_material_id SET NULL when the picture file's material is deleted; receivers ignore
-- that update (the material delete travels and cascades the same NULL on their side).
-- Rows that already exist are logged once so a device's earlier pictures also travel; a
-- sidecar is logged only when its card item is already in the ledger, so the receiver always
-- has the item it hangs on. Add-only; no table changes.
INSERT INTO local_changes (table_name, row_id, op, changed_at)
  SELECT 'visual_card_regions', id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM visual_card_regions r
  WHERE NOT EXISTS (SELECT 1 FROM sync_row_meta m WHERE m.table_name = 'visual_card_regions' AND m.row_id = r.id);
INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
  SELECT 'visual_card_regions', id, (SELECT value FROM app_metadata WHERE key = 'device_id'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0
  FROM visual_card_regions r
  WHERE NOT EXISTS (SELECT 1 FROM sync_row_meta m WHERE m.table_name = 'visual_card_regions' AND m.row_id = r.id);
INSERT INTO local_changes (table_name, row_id, op, changed_at)
  SELECT 'card_item_visual_regions', s.item_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM card_item_visual_regions s
  WHERE EXISTS (SELECT 1 FROM sync_row_meta c WHERE c.table_name = 'card_items' AND c.row_id = s.item_id AND c.deleted = 0)
    AND NOT EXISTS (SELECT 1 FROM sync_row_meta m WHERE m.table_name = 'card_item_visual_regions' AND m.row_id = s.item_id);
INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
  SELECT 'card_item_visual_regions', s.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0
  FROM card_item_visual_regions s
  WHERE EXISTS (SELECT 1 FROM sync_row_meta c WHERE c.table_name = 'card_items' AND c.row_id = s.item_id AND c.deleted = 0)
    AND NOT EXISTS (SELECT 1 FROM sync_row_meta m WHERE m.table_name = 'card_item_visual_regions' AND m.row_id = s.item_id);

CREATE TRIGGER trg_sync_visual_card_regions_insert AFTER INSERT ON visual_card_regions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('visual_card_regions', NEW.id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('visual_card_regions', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_visual_card_regions_update AFTER UPDATE ON visual_card_regions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('visual_card_regions', NEW.id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('visual_card_regions', NEW.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_visual_card_regions_delete AFTER DELETE ON visual_card_regions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('visual_card_regions', OLD.id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('visual_card_regions', OLD.id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;

CREATE TRIGGER trg_sync_card_item_visual_regions_insert AFTER INSERT ON card_item_visual_regions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_item_visual_regions', NEW.item_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_item_visual_regions', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_item_visual_regions_update AFTER UPDATE ON card_item_visual_regions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_item_visual_regions', NEW.item_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_item_visual_regions', NEW.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 0;
END;

CREATE TRIGGER trg_sync_card_item_visual_regions_delete AFTER DELETE ON card_item_visual_regions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM app_metadata WHERE key = 'sync_applying')
BEGIN
  INSERT INTO local_changes (table_name, row_id, op, changed_at)
    VALUES ('card_item_visual_regions', OLD.item_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
    VALUES ('card_item_visual_regions', OLD.item_id, (SELECT value FROM app_metadata WHERE key = 'device_id'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT (table_name, row_id) DO UPDATE SET
      device_id = excluded.device_id, changed_at = excluded.changed_at, deleted = 1;
END;
