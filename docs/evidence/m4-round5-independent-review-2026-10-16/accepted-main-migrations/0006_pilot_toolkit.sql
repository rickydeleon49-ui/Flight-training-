-- Personal records for the integrated pilot toolkit. The JSON document is
-- versioned by the TypeScript layer so new optional fields can be added safely.
CREATE TABLE pilot_toolkit (
  id TEXT PRIMARY KEY CHECK (id = 'toolkit'),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
