-- Small, non-personal application flags.
--
-- This keeps one-time product setup (such as installing the starter pack)
-- separate from her profile and training record.
CREATE TABLE app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
