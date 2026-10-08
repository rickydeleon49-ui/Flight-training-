-- Optional / Provisional Migration 0013: Library-Wide Card Review Acceleration
--
-- STATUS: PROPOSED ALTERNATIVE UNDER C2-D8 / C2-D9 (UNAPPROVED).
-- Recommendation: Design 1 (Bounded On-Demand Discovery, No Migration) is recommended.
--
-- Evaluation finding from corrected benchmarks:
-- Measured on 5,000 materials and 10,000 review events on Apple M5 (Node v22.23.3 / SQLite 3.53.4):
-- - Review Due first page (limit 50, candidate budget 250): p50 = 3.24 ms, p95 = 4.19 ms
-- - Full discovery across all 84 pages (5,000 materials): p50 = 251.27 ms
-- - History keyset page 1 (limit 20): p50 = 9.63 ms, p95 = 12.15 ms
-- - 500-card full parse/canonicalize/hash: p50 = 0.48 ms
--
-- In-memory SQLite measurements satisfy read budgets without schema changes.
-- Desktop IPC and WebKit rendering remain unmeasured until implementation testing.
-- If persistent indexing is ever authorized by the owner, candidate 0013 provides:

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
