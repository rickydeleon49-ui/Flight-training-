-- Connect actions directly to Study Library materials while preserving
-- polymorphic related_type and related_id for the debrief/source reference.
-- Deleting the study material sets material_id to NULL without cascading
-- or deleting the action or its parent debrief.
ALTER TABLE next_actions ADD COLUMN material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL;
ALTER TABLE next_actions ADD COLUMN source_material_id TEXT;
CREATE INDEX IF NOT EXISTS idx_actions_material ON next_actions(material_id);

-- Preserve source provenance on questions and actions when referenced records are deleted,
-- distinguishing "never linked" from "previous source deleted" even after foreign keys set NULL.
ALTER TABLE questions ADD COLUMN source_journal_id TEXT;
ALTER TABLE questions ADD COLUMN source_material_id TEXT;
ALTER TABLE questions ADD COLUMN source_event_id TEXT;

CREATE TRIGGER IF NOT EXISTS trg_journal_delete_questions
BEFORE DELETE ON journal_entries
FOR EACH ROW
BEGIN
    UPDATE questions
    SET source_journal_id = OLD.id
    WHERE journal_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_material_delete_questions
BEFORE DELETE ON study_materials
FOR EACH ROW
BEGIN
    UPDATE questions
    SET source_material_id = OLD.id
    WHERE material_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_event_delete_questions
BEFORE DELETE ON schedule_events
FOR EACH ROW
BEGIN
    UPDATE questions
    SET source_event_id = OLD.id
    WHERE event_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_material_delete_actions
BEFORE DELETE ON study_materials
FOR EACH ROW
BEGIN
    UPDATE next_actions
    SET source_material_id = OLD.id
    WHERE material_id = OLD.id;
END;

-- Accepted debrief operations. A debrief save carries a stable operation id
-- that the form keeps until that exact operation succeeds; replaying an id
-- that already committed (a retry after a lost response) is a no-op, so it can
-- never undo work done on the resulting action or question afterwards.
-- Deliberately no foreign key: deleting a debrief keeps this small history.
CREATE TABLE IF NOT EXISTS debrief_operations (
    id         TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL,
    applied_at TEXT NOT NULL
);
