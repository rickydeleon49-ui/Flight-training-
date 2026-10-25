CREATE TABLE flight_schools (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  hourly_cost_cents INTEGER CHECK (hourly_cost_cents IS NULL OR (typeof(hourly_cost_cents) = 'integer' AND hourly_cost_cents >= 0 AND hourly_cost_cents <= 9007199254740991)),
  aircraft_description TEXT CHECK (aircraft_description IS NULL OR length(aircraft_description) <= 2000),
  training_track TEXT CHECK (training_track IS NULL OR training_track IN ('Part 61', 'Part 141', 'not sure')),
  availability_description TEXT CHECK (availability_description IS NULL OR length(availability_description) <= 2000),
  discovery_flight_reflection TEXT CHECK (discovery_flight_reflection IS NULL OR length(discovery_flight_reflection) <= 20000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
