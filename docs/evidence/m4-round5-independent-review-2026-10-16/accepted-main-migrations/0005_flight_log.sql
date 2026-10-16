-- Add a compact training-flight log to each lesson debrief.
-- All fields are optional so existing journal entries remain valid.
ALTER TABLE journal_entries ADD COLUMN aircraft_type TEXT NOT NULL DEFAULT '';
ALTER TABLE journal_entries ADD COLUMN aircraft_id TEXT NOT NULL DEFAULT '';
ALTER TABLE journal_entries ADD COLUMN departure_airport TEXT NOT NULL DEFAULT '';
ALTER TABLE journal_entries ADD COLUMN arrival_airport TEXT NOT NULL DEFAULT '';
ALTER TABLE journal_entries ADD COLUMN instructor_name TEXT NOT NULL DEFAULT '';
ALTER TABLE journal_entries ADD COLUMN total_time REAL;
ALTER TABLE journal_entries ADD COLUMN dual_received REAL;
ALTER TABLE journal_entries ADD COLUMN solo_time REAL;
ALTER TABLE journal_entries ADD COLUMN pic_time REAL;
ALTER TABLE journal_entries ADD COLUMN cross_country_time REAL;
ALTER TABLE journal_entries ADD COLUMN night_time REAL;
ALTER TABLE journal_entries ADD COLUMN actual_instrument_time REAL;
ALTER TABLE journal_entries ADD COLUMN simulated_instrument_time REAL;
ALTER TABLE journal_entries ADD COLUMN day_landings INTEGER;
ALTER TABLE journal_entries ADD COLUMN night_landings INTEGER;
