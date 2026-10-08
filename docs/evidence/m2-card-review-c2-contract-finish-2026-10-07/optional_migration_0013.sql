-- OPTIONAL / UNAPPROVED MIGRATION VARIANT: 0013_optional_candidate_priority_index.sql
--
-- NOTE: This index is NOT part of the shipped baseline migrations (0001-0012).
-- Baseline C2 design operates cleanly and within budget on shipped migrations 0001-0012.
-- If the owner approves this optional index in a future migration, it would index
-- (priority, updated_at, id) on study_materials to optimize candidate order queries.
--
-- Status: PROPOSED / UNAPPROVED COMPARISON VARIANT ONLY.
-- Impact: Requires a new schema migration (0013), schema version bump, and migration testing.

CREATE INDEX IF NOT EXISTS idx_materials_priority_updated
    ON study_materials(priority, updated_at DESC, id ASC);
