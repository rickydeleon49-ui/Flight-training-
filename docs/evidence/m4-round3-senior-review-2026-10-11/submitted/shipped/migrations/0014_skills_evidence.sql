-- CANDIDATE migration 0014: M3 skills and feedback evidence.
-- NOT REGISTERED. This file lives in the evidence pack only. It must not be
-- copied to src-tauri/migrations, src/data/migrations.ts, lib.rs or
-- migration-checksums.json until the scope is accepted and the owner has
-- approved M3-D1..D9.
--
-- What it adds (nothing existing is altered):
-- 1. skill_catalog_entries   - one row per skill: built-in catalog skills
--                              (stable 'builtin.*' ids) and custom skills
--                              ('custom.*' ids). Never deleted; retired instead.
-- 2. skill_catalog_revisions - append-only label/description/topic/status
--                              history, so a rename never rewrites the past.
-- 3. skill_observations      - the current state of each deliberate
--                              observation, bound to the debrief it came from,
--                              with a snapshot of that source.
-- 4. skill_observation_revisions - append-only history of every change to an
--                              observation (wording, date, attribution, links,
--                              addressed state).
-- 5. skill_self_assessments  - append-only Learning/Practicing/Needs review
--                              labels and the separate 1-5 confidence.
-- 6. skill_evidence_operations - idempotency receipts; erased subjects keep a
--                              non-content tombstone so a replay cannot
--                              resurrect them.
--
-- Deliberately absent: any "verified instructor", "proficient", "ready",
-- "endorsed" or "signed off" state. The attribution CHECK allows only what
-- the learner can honestly assert on a local, single-user app.

CREATE TABLE IF NOT EXISTS skill_catalog_entries (
  id               TEXT PRIMARY KEY NOT NULL,
  origin           TEXT NOT NULL CHECK (origin IN ('builtin', 'custom')),
  catalog_version  INTEGER CHECK (catalog_version IS NULL OR (TYPEOF(catalog_version) = 'integer' AND catalog_version >= 1)),
  label            TEXT NOT NULL CHECK (length(trim(label)) >= 1 AND length(label) <= 80),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  topic            TEXT NOT NULL CHECK (topic IN ('weather', 'navigation', 'regulations', 'communications', 'aerodynamics', 'aircraft_systems', 'flight_planning', 'airports', 'performance', 'emergency_procedures', 'landings', 'general')),
  status           TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  revision         INTEGER NOT NULL CHECK (TYPEOF(revision) = 'integer' AND revision >= 1),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  retired_at       TEXT,
  CHECK ((origin = 'builtin' AND id GLOB 'builtin.?*' AND catalog_version IS NOT NULL)
      OR (origin = 'custom' AND id GLOB 'custom.?*' AND catalog_version IS NULL)),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS skill_catalog_revisions (
  skill_id         TEXT NOT NULL REFERENCES skill_catalog_entries(id) ON DELETE RESTRICT,
  revision         INTEGER NOT NULL CHECK (TYPEOF(revision) = 'integer' AND revision >= 1),
  label            TEXT NOT NULL CHECK (length(trim(label)) >= 1 AND length(label) <= 80),
  description      TEXT NOT NULL CHECK (length(description) <= 500),
  topic            TEXT NOT NULL CHECK (topic IN ('weather', 'navigation', 'regulations', 'communications', 'aerodynamics', 'aircraft_systems', 'flight_planning', 'airports', 'performance', 'emergency_procedures', 'landings', 'general')),
  status           TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  catalog_version  INTEGER CHECK (catalog_version IS NULL OR (TYPEOF(catalog_version) = 'integer' AND catalog_version >= 1)),
  changed_by       TEXT NOT NULL CHECK (changed_by IN ('catalog', 'user')),
  operation_id     TEXT,
  changed_at       TEXT NOT NULL,
  PRIMARY KEY (skill_id, revision),
  CHECK ((changed_by = 'user') = (operation_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS skill_observations (
  id                    TEXT PRIMARY KEY NOT NULL,
  skill_id              TEXT NOT NULL REFERENCES skill_catalog_entries(id) ON DELETE RESTRICT,
  skill_label_snapshot  TEXT NOT NULL CHECK (length(skill_label_snapshot) <= 80),
  journal_id            TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  source_journal_id     TEXT NOT NULL,
  source_journal_date   TEXT NOT NULL,
  source_journal_title  TEXT NOT NULL CHECK (length(source_journal_title) <= 200),
  source_field          TEXT NOT NULL CHECK (source_field IN ('instructor_feedback', 'went_well', 'was_difficult', 'practiced', 'none')),
  source_text_sha256    TEXT CHECK (source_text_sha256 IS NULL OR (length(source_text_sha256) = 64 AND source_text_sha256 NOT GLOB '*[^0-9a-f]*')),
  attribution           TEXT NOT NULL CHECK (attribution IN ('self_report', 'instructor_transcribed')),
  instructor_name       TEXT NOT NULL DEFAULT '' CHECK (length(instructor_name) <= 120),
  wording               TEXT NOT NULL CHECK (length(trim(wording)) >= 1 AND length(wording) <= 2000 AND length(CAST(wording AS BLOB)) <= 8000),
  observed_on           TEXT NOT NULL CHECK (date(observed_on) IS observed_on),
  revision              INTEGER NOT NULL CHECK (TYPEOF(revision) = 'integer' AND revision >= 1),
  action_id             TEXT REFERENCES next_actions(id) ON DELETE SET NULL,
  linked_action_id      TEXT,
  linked_action_title   TEXT CHECK (linked_action_title IS NULL OR length(linked_action_title) <= 200),
  addressed_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (journal_id IS NULL OR journal_id IS source_journal_id),
  CHECK (attribution = 'instructor_transcribed' OR instructor_name = ''),
  CHECK ((source_field = 'none') = (source_text_sha256 IS NULL)),
  CHECK (action_id IS NULL OR action_id IS linked_action_id),
  CHECK ((linked_action_id IS NULL) = (linked_action_title IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_skill_observations_page ON skill_observations(observed_on, created_at, id);
CREATE INDEX IF NOT EXISTS idx_skill_observations_skill_page ON skill_observations(skill_id, observed_on, created_at, id);
CREATE INDEX IF NOT EXISTS idx_skill_observations_journal ON skill_observations(journal_id);
CREATE INDEX IF NOT EXISTS idx_skill_observations_source_journal ON skill_observations(source_journal_id);
CREATE INDEX IF NOT EXISTS idx_skill_observations_action ON skill_observations(action_id);

CREATE TABLE IF NOT EXISTS skill_observation_revisions (
  observation_id       TEXT NOT NULL REFERENCES skill_observations(id) ON DELETE CASCADE,
  revision             INTEGER NOT NULL CHECK (TYPEOF(revision) = 'integer' AND revision >= 1),
  change_kind          TEXT NOT NULL CHECK (change_kind IN ('created', 'edited', 'linked_action', 'unlinked_action', 'marked_addressed', 'cleared_addressed')),
  wording              TEXT NOT NULL CHECK (length(trim(wording)) >= 1 AND length(wording) <= 2000 AND length(CAST(wording AS BLOB)) <= 8000),
  observed_on          TEXT NOT NULL CHECK (date(observed_on) IS observed_on),
  attribution          TEXT NOT NULL CHECK (attribution IN ('self_report', 'instructor_transcribed')),
  instructor_name      TEXT NOT NULL CHECK (length(instructor_name) <= 120),
  linked_action_id     TEXT,
  linked_action_title  TEXT CHECK (linked_action_title IS NULL OR length(linked_action_title) <= 200),
  addressed_at         TEXT,
  operation_id         TEXT NOT NULL,
  recorded_at          TEXT NOT NULL,
  PRIMARY KEY (observation_id, revision),
  CHECK ((revision = 1) = (change_kind = 'created')),
  CHECK (attribution = 'instructor_transcribed' OR instructor_name = ''),
  CHECK ((linked_action_id IS NULL) = (linked_action_title IS NULL))
);

CREATE TABLE IF NOT EXISTS skill_self_assessments (
  id          TEXT PRIMARY KEY NOT NULL,
  skill_id    TEXT NOT NULL REFERENCES skill_catalog_entries(id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('status', 'confidence')),
  status      TEXT CHECK (status IS NULL OR status IN ('learning', 'practicing', 'needs_review')),
  confidence  INTEGER CHECK (confidence IS NULL OR (TYPEOF(confidence) = 'integer' AND confidence BETWEEN 1 AND 5)),
  sequence    INTEGER NOT NULL CHECK (TYPEOF(sequence) = 'integer' AND sequence >= 1),
  operation_id TEXT NOT NULL,
  set_at      TEXT NOT NULL,
  CHECK (kind = 'status' OR status IS NULL),
  CHECK (kind = 'confidence' OR confidence IS NULL),
  UNIQUE (skill_id, kind, sequence)
);

CREATE TABLE IF NOT EXISTS skill_evidence_operations (
  operation_id  TEXT PRIMARY KEY NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create_custom_skill', 'edit_custom_skill', 'retire_skill', 'restore_skill', 'create_observation', 'edit_observation', 'link_action', 'unlink_action', 'set_addressed', 'set_status', 'set_confidence', 'erase_observation')),
  request_hash  TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  subject_id    TEXT NOT NULL,
  applied_at    TEXT NOT NULL,
  result_json   TEXT,
  is_erased     INTEGER NOT NULL DEFAULT 0 CHECK (is_erased IN (0, 1)),
  CHECK ((is_erased = 1) = (result_json IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_skill_evidence_operations_subject ON skill_evidence_operations(subject_id);

-- History is append-only. Catalog history and self-assessments can never be
-- rewritten or removed; observation history can be removed only by erasing
-- the observation itself (the cascade runs after its parent row is gone).
CREATE TRIGGER IF NOT EXISTS trg_skill_catalog_revisions_no_update
BEFORE UPDATE ON skill_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'skill catalog history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_catalog_revisions_no_delete
BEFORE DELETE ON skill_catalog_revisions
BEGIN
  SELECT RAISE(ABORT, 'skill catalog history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_observation_revisions_no_update
BEFORE UPDATE ON skill_observation_revisions
BEGIN
  SELECT RAISE(ABORT, 'observation history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_observation_revisions_no_partial_delete
BEFORE DELETE ON skill_observation_revisions
WHEN EXISTS (SELECT 1 FROM skill_observations WHERE id = OLD.observation_id)
BEGIN
  SELECT RAISE(ABORT, 'observation history can only be erased with its observation');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_self_assessments_no_update
BEFORE UPDATE ON skill_self_assessments
BEGIN
  SELECT RAISE(ABORT, 'self-assessment history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_skill_self_assessments_no_delete
BEFORE DELETE ON skill_self_assessments
BEGIN
  SELECT RAISE(ABORT, 'self-assessment history is append-only');
END;

-- Built-in catalog, version 1. Plain labels only: no ACS codes are claimed
-- (M3-D1). Ids are stable forever; a later catalog version may rename or
-- retire a skill through a new additive migration that appends a revision.
INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at, retired_at) VALUES
  ('builtin.preflight_inspection', 'builtin', 1, 'Preflight inspection', 'Walking around and checking the airplane before flight.', 'aircraft_systems', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.checklist_use', 'builtin', 1, 'Using checklists', 'Following the checklist at each phase of flight.', 'general', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.radio_communications', 'builtin', 1, 'Radio communications', 'Talking with ATC and other traffic clearly.', 'communications', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.taxiing', 'builtin', 1, 'Taxiing', 'Moving safely on the ground, including wind and signage.', 'airports', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.traffic_pattern', 'builtin', 1, 'Traffic pattern', 'Flying the pattern: entry, spacing, altitude and turns.', 'airports', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.normal_takeoff', 'builtin', 1, 'Normal takeoff and climb', 'Takeoff roll, rotation and initial climb.', 'performance', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.normal_landing', 'builtin', 1, 'Normal approach and landing', 'Stabilized approach, flare and touchdown.', 'landings', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.crosswind_landing', 'builtin', 1, 'Crosswind landing', 'Holding centerline and correcting for wind.', 'landings', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.go_around', 'builtin', 1, 'Go-around', 'Deciding early and flying the go-around.', 'landings', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.slow_flight', 'builtin', 1, 'Slow flight', 'Controlling the airplane near the low end of its speed range.', 'aerodynamics', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.stalls', 'builtin', 1, 'Stalls and recovery', 'Recognizing a stall and recovering promptly.', 'aerodynamics', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.steep_turns', 'builtin', 1, 'Steep turns', 'Holding altitude and bank through a steep turn.', 'aerodynamics', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.ground_reference', 'builtin', 1, 'Ground reference maneuvers', 'Correcting for wind relative to a ground track.', 'navigation', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.emergency_approach', 'builtin', 1, 'Emergency approach and landing', 'Best glide, field selection and checklist with no engine power.', 'emergency_procedures', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL),
  ('builtin.weather_decisions', 'builtin', 1, 'Weather decisions', 'Gathering weather and deciding whether and how to go.', 'weather', 'active', 1, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', NULL);

INSERT INTO skill_catalog_revisions (skill_id, revision, label, description, topic, status, catalog_version, changed_by, operation_id, changed_at)
  SELECT id, 1, label, description, topic, status, catalog_version, 'catalog', NULL, created_at FROM skill_catalog_entries WHERE origin = 'builtin';
