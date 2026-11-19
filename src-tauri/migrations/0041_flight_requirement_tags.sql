-- BL-104: optional per-flight ticks that let "Hours still to go" count more of 61.109(a).
-- Additive: four nullable columns. Old rows read as NULL (nothing ticked) and are untouched.
ALTER TABLE journal_entries ADD COLUMN towered_full_stop_landings INTEGER;
ALTER TABLE journal_entries ADD COLUMN long_solo_xc INTEGER;
ALTER TABLE journal_entries ADD COLUMN night_xc_100 INTEGER;
ALTER TABLE journal_entries ADD COLUMN checkride_prep INTEGER;
