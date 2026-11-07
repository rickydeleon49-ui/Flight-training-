-- CARRY-3DEV: a local fold ledger. When the sync apply folds a duplicate copy of one rating
-- (card_review_events) into its keeper, the removed row is kept here so later copies that
-- name it as a parent still resolve to the original rating. Local only: no triggers, not in
-- the sync registry, never exported, never counted, never replayed.
CREATE TABLE IF NOT EXISTS card_review_event_folds (
    id          TEXT PRIMARY KEY,
    item_id     TEXT NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
    generation  INTEGER NOT NULL CHECK (generation >= 0),
    rating      TEXT NOT NULL CHECK (rating IN ('again','hard','good','easy')),
    reviewed_at TEXT NOT NULL,
    device_id   TEXT,
    changed_at  TEXT,
    folded_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_event_folds_item ON card_review_event_folds(item_id);

-- CARRY-3DEV: a card-version activation claim that arrived without its version (a bare update,
-- the normal way a device that merely re-activated a received version reports it). The version
-- cannot be built from that file, so the claim waits here, local only, and is merged by the
-- usual newest (changed_at, device) order when a later file builds the version. Not in the sync
-- registry, never exported.
CREATE TABLE IF NOT EXISTS card_version_pending_claims (
    id                 TEXT PRIMARY KEY,
    source_material_id TEXT NOT NULL,
    is_active          INTEGER NOT NULL CHECK (is_active IN (0,1)),
    changed_at         TEXT NOT NULL,
    device_id          TEXT NOT NULL,
    first_reviewed_at  TEXT
);
