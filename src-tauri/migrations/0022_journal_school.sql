-- Add optional school-name snapshot to journal entries.
-- Snapshot only: no foreign key to flight_schools, preserving historical entries
-- if comparison schools are deleted or renamed.
ALTER TABLE journal_entries ADD COLUMN school_name TEXT CHECK (school_name IS NULL OR length(school_name) <= 200);
