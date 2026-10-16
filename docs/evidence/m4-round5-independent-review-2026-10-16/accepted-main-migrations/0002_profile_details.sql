-- Her Flight Deck — profile details.
--
-- Adds the facts that make the application hers: where and with whom she
-- trains, when she started, when her medical runs out, and which accent
-- colour the interface uses.
--
-- Deliberately NOT added here: exam and checkride target dates. Milestones
-- already carry a target date and the Schedule already handles dated
-- deadlines, so putting them here too would create a second source of truth
-- for the same fact.

ALTER TABLE settings ADD COLUMN flight_school       TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN instructor_name     TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN home_airport        TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN aircraft_type       TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN training_started_on TEXT;

-- Her own reminder of when the certificate expires. The document itself
-- remains the authority; the application only counts down to it.
ALTER TABLE settings ADD COLUMN medical_expiry      TEXT;

ALTER TABLE settings ADD COLUMN accent_color        TEXT NOT NULL DEFAULT 'berry';
