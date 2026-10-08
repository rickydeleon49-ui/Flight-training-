-- Optional / Provisional Migration 0013: Library-Wide Card Review Acceleration
--
-- STATUS: NOT RECOMMENDED FOR C2. Provided for engineering evaluation only.
--
-- Evaluation finding:
-- Benchmarks on 5,000 materials and 10,000 review events prove that Bounded On-Demand
-- Discovery over Schema 12 tables achieves p50 = 22.6ms and p95 = 25.3ms, well inside
-- the 50ms user-perceived interaction budget. Therefore, NO MIGRATION is required
-- for C2. Schema 12 remains current.
--
-- If persistent indexing is ever requested by the owner in a future milestone,
-- the following migration would be candidate 0013:

-- 1. Accelerates library-wide History keyset paging:
CREATE INDEX IF NOT EXISTS idx_card_events_library_history
    ON card_review_events(reviewed_at DESC, id DESC);

-- 2. Optional rebuildable cache table for current-content metadata:
CREATE TABLE IF NOT EXISTS card_material_cache (
    source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
    content_hash       TEXT NOT NULL,
    card_count         INTEGER NOT NULL CHECK (card_count BETWEEN 0 AND 500),
    status             TEXT NOT NULL CHECK (status IN ('none', 'ok', 'malformed')),
    has_active_snapshot INTEGER NOT NULL CHECK (has_active_snapshot IN (0, 1)),
    synced_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_material_cache_status
    ON card_material_cache(status, has_active_snapshot);

-- Migration and Compatibility Impact if 0013 were adopted:
-- 1. CURRENT_SCHEMA_VERSION would bump from 12 to 13 in src-tauri/src/lib.rs.
-- 2. Checksum registry would add 0013_card_reviews_c2_acceleration.sql in:
--    - src/data/migration-checksums.json
--    - src/data/migrations.ts
-- 3. Tauri Backup & Restore (src-tauri/src/backup.rs):
--    - Restoring schema 11 or 12 databases into schema 13 would apply 0013,
--      creating empty cache tables that rebuild on demand.
--    - Restoring schema 14+ backups would be refused by the schema ceiling.
--    - Export manifests would record formatVersion = 13.
-- 4. Native connection invariant:
--    - Cache table updates must be performed within existing atomic mutation
--      transactions or via rebuildable background tasks, never unowned pooled calls.
