-- Migration 0012_card_reviews.sql
-- Additive tables for material-level flashcard reviews (M2-3 source slice C1).
-- Every instant is the 24-character UTC form YYYY-MM-DDTHH:MM:SS.sssZ.

-- 1. The reset barrier: no row means generation 0.
CREATE TABLE IF NOT EXISTS card_review_generations (
    source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
    generation         INTEGER NOT NULL CHECK (generation >= 0)
);

-- 2. Content-addressed card snapshots, created by the first item action.
CREATE TABLE IF NOT EXISTS card_versions (
    id                 TEXT PRIMARY KEY,
    source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
    content_hash       TEXT NOT NULL,
    card_count         INTEGER NOT NULL CHECK (card_count BETWEEN 1 AND 500),
    provider           TEXT NOT NULL CHECK (provider IN ('gemini', 'import')),
    created_at         TEXT NOT NULL,
    first_reviewed_at  TEXT,
    is_active          INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    UNIQUE (source_material_id, content_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_card_version
    ON card_versions(source_material_id)
    WHERE is_active = 1;

-- 3. The frozen cards of a snapshot.
CREATE TABLE IF NOT EXISTS card_items (
    id          TEXT PRIMARY KEY,
    version_id  TEXT NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
    front       TEXT NOT NULL,
    back        TEXT NOT NULL,
    source_page INTEGER,
    UNIQUE (version_id, ordinal)
);

-- 4. The current schedule and pause/flag state of each touched card.
CREATE TABLE IF NOT EXISTS card_review_state (
    item_id            TEXT PRIMARY KEY REFERENCES card_items(id) ON DELETE CASCADE,
    source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
    scheduler_version  TEXT NOT NULL,
    step               INTEGER NOT NULL CHECK (step BETWEEN -1 AND 7),
    due_at             TEXT,
    last_reviewed_at   TEXT,
    reps               INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
    lapses             INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    suspended          INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
    flag               TEXT CHECK (flag IN ('wrong_answer', 'unclear', 'not_in_source')),
    revision           INTEGER NOT NULL CHECK (revision >= 1),
    CHECK ((due_at IS NULL) = (last_reviewed_at IS NULL)),
    CHECK (due_at IS NOT NULL OR (reps = 0 AND step = -1))
);

CREATE INDEX IF NOT EXISTS idx_card_state_due
    ON card_review_state(source_material_id, suspended, due_at);

-- 5. Immutable ratings only.
CREATE TABLE IF NOT EXISTS card_review_events (
    id                TEXT PRIMARY KEY,
    item_id           TEXT NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
    generation        INTEGER NOT NULL CHECK (generation >= 0),
    rating            TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
    reviewed_at       TEXT NOT NULL,
    scheduler_version TEXT NOT NULL,
    prior_state_json  TEXT NOT NULL,
    next_state_json   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_events_item
    ON card_review_events(item_id, reviewed_at);

-- 6. Operation receipts. No foreign key, so non-content tombstones outlive
--    deletion and refuse a late replay.
CREATE TABLE IF NOT EXISTS card_review_operations (
    operation_id       TEXT PRIMARY KEY,
    action             TEXT NOT NULL CHECK (action IN ('rate', 'suspend', 'resume', 'flag', 'unflag', 'reset')),
    source_material_id TEXT NOT NULL,
    generation         INTEGER NOT NULL CHECK (generation >= 0),
    request_hash       TEXT NOT NULL,
    applied_at         TEXT NOT NULL,
    is_erased          INTEGER NOT NULL DEFAULT 0 CHECK (is_erased IN (0, 1)),
    result_json        TEXT,
    CHECK ((is_erased = 1) = (result_json IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_card_ops_material
    ON card_review_operations(source_material_id);

-- 7. Deleting a material erases its card content through the cascades above
--    and keeps only non-content receipt tombstones.
CREATE TRIGGER IF NOT EXISTS trg_card_ops_material_delete
AFTER DELETE ON study_materials
FOR EACH ROW
BEGIN
    UPDATE card_review_operations
    SET is_erased = 1, result_json = NULL
    WHERE source_material_id = OLD.id AND is_erased = 0;
END;
