-- Migration 0011_practice_sessions.sql
-- Additive tables for durable, versioned, resumable practice tests.

-- 1. Versioned practice tests (anchors items and historical attempts)
CREATE TABLE IF NOT EXISTS practice_test_versions (
    id                    TEXT PRIMARY KEY,
    source_material_id    TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
    history_key           TEXT NOT NULL,
    source_material_title TEXT NOT NULL,
    version_number        INTEGER NOT NULL DEFAULT 1,
    provider              TEXT NOT NULL DEFAULT 'gemini',
    model                 TEXT NOT NULL DEFAULT '',
    title                 TEXT NOT NULL DEFAULT '',
    content_hash          TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- At most one active version per study material
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_practice_version
    ON practice_test_versions(source_material_id)
    WHERE is_active = 1 AND source_material_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_practice_versions_history
    ON practice_test_versions(history_key);

-- 2. Stable practice questions belonging to a test version
CREATE TABLE IF NOT EXISTS practice_test_items (
    id            TEXT PRIMARY KEY,
    version_id    TEXT NOT NULL REFERENCES practice_test_versions(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    options_json  TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    explanation   TEXT NOT NULL DEFAULT '',
    source_page   INTEGER,
    UNIQUE(version_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_practice_items_version
    ON practice_test_items(version_id, ordinal);

-- 3. Individual user attempts on a specific test version
CREATE TABLE IF NOT EXISTS practice_attempts (
    id                    TEXT PRIMARY KEY,
    version_id            TEXT NOT NULL REFERENCES practice_test_versions(id) ON DELETE RESTRICT,
    source_material_id    TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
    source_material_title TEXT NOT NULL,
    started_at            TEXT NOT NULL,
    completed_at          TEXT,
    status                TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    revision              INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    total_questions       INTEGER NOT NULL,
    answered_count        INTEGER NOT NULL DEFAULT 0,
    correct_count         INTEGER NOT NULL DEFAULT 0,
    incorrect_count       INTEGER NOT NULL DEFAULT 0,
    dont_know_count       INTEGER NOT NULL DEFAULT 0,
    score_percent         REAL
);

-- At most one in-progress attempt per study material
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_in_progress_attempt
    ON practice_attempts(source_material_id)
    WHERE status = 'in_progress' AND source_material_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_practice_attempts_material
    ON practice_attempts(source_material_id, status);

CREATE INDEX IF NOT EXISTS idx_practice_attempts_version
    ON practice_attempts(version_id);

-- 4. Recorded responses per item within an attempt
CREATE TABLE IF NOT EXISTS practice_responses (
    id             TEXT PRIMARY KEY,
    attempt_id     TEXT NOT NULL REFERENCES practice_attempts(id) ON DELETE CASCADE,
    item_id        TEXT NOT NULL REFERENCES practice_test_items(id) ON DELETE CASCADE,
    selected_index INTEGER,
    is_dont_know   INTEGER NOT NULL DEFAULT 0 CHECK (is_dont_know IN (0, 1)),
    is_correct     INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
    answered_at    TEXT NOT NULL,
    UNIQUE(attempt_id, item_id),
    CHECK (
        (is_dont_know = 1 AND selected_index IS NULL) OR
        (is_dont_know = 0 AND selected_index IS NOT NULL AND selected_index >= 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_practice_responses_attempt
    ON practice_responses(attempt_id);

-- 5. Persistent operation receipts for idempotent replay
CREATE TABLE IF NOT EXISTS practice_session_operations (
    operation_id   TEXT PRIMARY KEY,
    action         TEXT NOT NULL,
    request_hash   TEXT NOT NULL,
    applied_at     TEXT NOT NULL,
    result_json    TEXT NOT NULL,
    history_key    TEXT NOT NULL,
    attempt_id     TEXT NOT NULL,
    is_erased      INTEGER NOT NULL DEFAULT 0 CHECK (is_erased IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_practice_ops_history
    ON practice_session_operations(history_key);

CREATE INDEX IF NOT EXISTS idx_practice_ops_attempt
    ON practice_session_operations(attempt_id);

-- 6. Triggers enforcing that an item belongs to the attempt's version on INSERT or UPDATE
CREATE TRIGGER IF NOT EXISTS trg_enforce_response_item_version_insert
BEFORE INSERT ON practice_responses
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Item does not belong to attempt version')
    WHERE (
        SELECT version_id FROM practice_attempts WHERE id = NEW.attempt_id
    ) != (
        SELECT version_id FROM practice_test_items WHERE id = NEW.item_id
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_enforce_response_item_version_update
BEFORE UPDATE OF item_id, attempt_id ON practice_responses
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Item does not belong to attempt version')
    WHERE (
        SELECT version_id FROM practice_attempts WHERE id = NEW.attempt_id
    ) != (
        SELECT version_id FROM practice_test_items WHERE id = NEW.item_id
    );
END;

-- 7. Trigger handling material deletion cleanup (Policy A)
CREATE TRIGGER IF NOT EXISTS trg_cleanup_material_delete
AFTER DELETE ON study_materials
FOR EACH ROW
BEGIN
    UPDATE practice_session_operations
    SET is_erased = 1, result_json = 'null'
    WHERE attempt_id IN (SELECT id FROM practice_attempts
        WHERE source_material_id IS NULL AND status IN ('in_progress', 'abandoned'));

    DELETE FROM practice_attempts
    WHERE source_material_id IS NULL AND status IN ('in_progress', 'abandoned');

    UPDATE practice_test_versions
    SET is_active = 0
    WHERE source_material_id IS NULL AND is_active = 1;

    DELETE FROM practice_test_versions
    WHERE source_material_id IS NULL
      AND id NOT IN (SELECT DISTINCT version_id FROM practice_attempts WHERE status = 'completed');
END;

-- 8. Durable migration tracking for legacy practice_tests
ALTER TABLE practice_tests ADD COLUMN legacy_migrated_at TEXT;
ALTER TABLE practice_tests ADD COLUMN legacy_error TEXT;
