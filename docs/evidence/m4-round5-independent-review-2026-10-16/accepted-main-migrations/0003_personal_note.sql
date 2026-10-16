-- Her Flight Deck — the personal part of the profile.
--
-- Why she started, and a photo to go with it.
--
-- The photo is stored as a downscaled data URL rather than a file on disk.
-- The schema comment on documents warns against putting binaries in SQLite,
-- and that still holds for study materials — but this one is different: it is
-- capped at a few tens of kilobytes by the resize before it is ever saved,
-- there is exactly one of it, and keeping it here means it lives in the same
-- private database as everything else about her rather than needing its own
-- file lifecycle and asset-protocol plumbing.

ALTER TABLE settings ADD COLUMN why_note TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN photo    TEXT;
