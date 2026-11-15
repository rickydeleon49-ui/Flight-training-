-- BL-21: a generated practice question whose source page could not be matched is flagged
-- "not checked". Additive: old rows read as 0 (checked) and are left unchanged.
-- No CHECK clause: it would make old backups differ from the reference table text; the
-- backup verifier enforces 0/1 instead.
ALTER TABLE practice_test_items ADD COLUMN unchecked INTEGER NOT NULL DEFAULT 0;
