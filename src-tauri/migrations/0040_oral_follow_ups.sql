-- BL-76: optional examiner-style follow-up questions on a saved oral scenario version.
-- Additive: a nullable JSON text column. Old rows read as NULL (no follow-ups) and are left
-- unchanged, so their content hashes stay the same. No CHECK clause, so old backups still
-- match the reference table text; the backup verifier checks the codec instead.
ALTER TABLE oral_scenario_versions ADD COLUMN follow_ups_json TEXT;
