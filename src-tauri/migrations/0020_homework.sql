CREATE TABLE homework_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instructions TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 20000),
  school TEXT CHECK (school IS NULL OR length(school) <= 200),
  instructor TEXT CHECK (instructor IS NULL OR length(instructor) <= 200),
  lesson_id TEXT REFERENCES schedule_events(id) ON DELETE SET NULL,
  source_lesson_id TEXT,
  due_date TEXT CHECK (due_date IS NULL OR (length(due_date)=10 AND date(due_date,'+0 days') IS due_date)),
  state TEXT NOT NULL CHECK (state IN ('upcoming','in_progress','completed','reopened')),
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  action_id TEXT UNIQUE REFERENCES next_actions(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
  CHECK (lesson_id IS NULL OR lesson_id IS source_lesson_id),
  CHECK ((state='completed') = (completed_at IS NOT NULL))
);
CREATE TABLE homework_activities (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (typeof(position)='integer' AND position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('read','cards','test','reflection','questions','checklist')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_material_id TEXT,
  source_revision TEXT CHECK (source_revision IS NULL OR (length(source_revision)=64 AND source_revision NOT GLOB '*[^0-9a-f]*')),
  card_set_id TEXT, test_version_id TEXT REFERENCES practice_test_versions(id) ON DELETE SET NULL,
  source_test_version_id TEXT,
  page_start INTEGER CHECK (page_start IS NULL OR (typeof(page_start)='integer' AND page_start >= 1)),
  page_end INTEGER CHECK (page_end IS NULL OR (typeof(page_end)='integer' AND page_end >= 1)),
  state TEXT NOT NULL CHECK (state IN ('upcoming','in_progress','completed','reopened')),
  cycle INTEGER NOT NULL CHECK (typeof(cycle)='integer' AND cycle >= 1),
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, removed_at TEXT,
  CHECK (material_id IS NULL OR material_id IS source_material_id),
  CHECK (test_version_id IS NULL OR test_version_id IS source_test_version_id),
  CHECK ((page_start IS NULL) = (page_end IS NULL)),
  CHECK (page_start IS NULL OR (kind='read' AND page_end >= page_start)),
  CHECK (card_set_id IS NULL OR kind='cards'),
  CHECK (source_test_version_id IS NULL OR kind='test'),
  CHECK ((state='completed') = (completed_at IS NOT NULL))
);
CREATE TABLE homework_runs (
  id TEXT PRIMARY KEY NOT NULL,
  activity_id TEXT NOT NULL REFERENCES homework_activities(id) ON DELETE RESTRICT,
  cycle INTEGER NOT NULL CHECK (typeof(cycle)='integer' AND cycle >= 1),
  activity_revision INTEGER NOT NULL CHECK (typeof(activity_revision)='integer' AND activity_revision >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('cards','test')),
  scope_json TEXT NOT NULL, evidence_json TEXT,
  attempt_id TEXT UNIQUE REFERENCES practice_attempts(id) ON DELETE SET NULL,
  source_attempt_id TEXT UNIQUE,
  started_at TEXT NOT NULL, finished_at TEXT, invalidated_at TEXT,
  CHECK (attempt_id IS NULL OR attempt_id IS source_attempt_id),
  CHECK ((kind='test') = (source_attempt_id IS NOT NULL)),
  CHECK ((finished_at IS NOT NULL) = (evidence_json IS NOT NULL))
);
CREATE UNIQUE INDEX idx_homework_run_open ON homework_runs(activity_id)
  WHERE finished_at IS NULL AND invalidated_at IS NULL;
CREATE TABLE homework_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL, applied_at TEXT NOT NULL,
  CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*')
);
CREATE TABLE homework_history (
  assignment_id TEXT NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  operation_id TEXT NOT NULL UNIQUE REFERENCES homework_operations(operation_id) ON DELETE RESTRICT,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('create','edit','start','record_evidence','complete','reopen','reorder','remove_activity','relink','archive')),
  snapshot_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, revision)
);
CREATE TRIGGER homework_history_no_update BEFORE UPDATE ON homework_history
BEGIN SELECT RAISE(ABORT,'Homework history is append-only'); END;
CREATE TRIGGER homework_history_no_delete BEFORE DELETE ON homework_history
BEGIN SELECT RAISE(ABORT,'Homework history is append-only'); END;
CREATE UNIQUE INDEX idx_homework_activity_order ON homework_activities(assignment_id,position) WHERE removed_at IS NULL;
CREATE INDEX idx_homework_due ON homework_assignments(archived,state,due_date,id);
CREATE INDEX idx_homework_lesson ON homework_assignments(lesson_id);
CREATE INDEX idx_homework_material ON homework_activities(material_id);
CREATE INDEX idx_homework_test ON homework_activities(test_version_id);
CREATE INDEX idx_homework_operations_assignment ON homework_operations(assignment_id);
