#!/usr/bin/env python3
"""Generate the shared M3 contract fixtures (validation + constraint cases).

Run from the repository root:
  python3 -I docs/evidence/m3-skills-evidence-scope-2026-10-10/scripts/generate_fixtures.py

The same JSON files are read by the node:sqlite and sql.js tests
(tests/contract.test.ts) and by the rusqlite crate (native/tests/contract.rs).
Every value is synthetic.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
T = "2026-10-10T09:00:00.000Z"
H = "a" * 64
OP1 = "00000000-0000-4000-8000-0000000000a1"
OP2 = "00000000-0000-4000-8000-0000000000a2"
OP3 = "00000000-0000-4000-8000-0000000000a3"
OP4 = "00000000-0000-4000-8000-0000000000a4"
OBS = "00000000-0000-4000-8000-0000000000b1"
CUSTOM = "custom.00000000-0000-4000-8000-0000000000c1"

BASELINE = [
    f"INSERT INTO journal_entries (id, date, title, instructor_feedback, created_at, updated_at) VALUES ('j1', '2026-10-01', 'Pattern work', 'Flare later.', '{T}', '{T}')",
    f"INSERT INTO journal_entries (id, date, title, created_at, updated_at) VALUES ('j2', '2026-10-03', 'Crosswind', '{T}', '{T}')",
    f"INSERT INTO next_actions (id, title, related_type, related_id, created_at, updated_at) VALUES ('a1', 'Review flare timing', 'journal', 'j1', '{T}', '{T}')",
    f"INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at, retired_at) VALUES ('{CUSTOM}', 'custom', NULL, 'Short-field landing', '', 'landings', 'active', 1, '{T}', '{T}', NULL)",
    f"INSERT INTO skill_catalog_revisions (skill_id, revision, label, description, topic, status, catalog_version, changed_by, operation_id, changed_at) VALUES ('{CUSTOM}', 1, 'Short-field landing', '', 'landings', 'active', NULL, 'user', '{OP1}', '{T}')",
    f"INSERT INTO skill_observations (id, skill_id, skill_label_snapshot, journal_id, source_journal_id, source_journal_date, source_journal_title, source_field, source_text_sha256, attribution, instructor_name, wording, observed_on, revision, action_id, linked_action_id, linked_action_title, addressed_at, created_at, updated_at) VALUES ('{OBS}', 'builtin.normal_landing', 'Normal approach and landing', 'j1', 'j1', '2026-10-01', 'Pattern work', 'instructor_feedback', '{H}', 'instructor_transcribed', 'Synthetic CFI', 'Flare later.', '2026-10-01', 2, 'a1', 'a1', 'Review flare timing', NULL, '{T}', '{T}')",
    f"INSERT INTO skill_observation_revisions (observation_id, revision, change_kind, wording, observed_on, attribution, instructor_name, linked_action_id, linked_action_title, addressed_at, operation_id, recorded_at) VALUES ('{OBS}', 1, 'created', 'Flare later.', '2026-10-01', 'instructor_transcribed', 'Synthetic CFI', NULL, NULL, NULL, '{OP2}', '{T}')",
    f"INSERT INTO skill_observation_revisions (observation_id, revision, change_kind, wording, observed_on, attribution, instructor_name, linked_action_id, linked_action_title, addressed_at, operation_id, recorded_at) VALUES ('{OBS}', 2, 'linked_action', 'Flare later.', '2026-10-01', 'instructor_transcribed', 'Synthetic CFI', 'a1', 'Review flare timing', NULL, '{OP3}', '{T}')",
    f"INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at) VALUES ('{OP4}', 'builtin.normal_landing', 'status', 'practicing', NULL, 1, '{OP4}', '{T}')",
    f"INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased) VALUES ('{OP1}', 'create_custom_skill', '{H}', '{CUSTOM}', '{T}', '{{\"action\":\"create_custom_skill\",\"revision\":1,\"skillId\":\"{CUSTOM}\"}}', 0)",
    f"INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased) VALUES ('{OP2}', 'create_observation', '{H}', '{OBS}', '{T}', '{{\"action\":\"create_observation\",\"observationId\":\"{OBS}\",\"revision\":1}}', 0)",
    f"INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased) VALUES ('{OP3}', 'link_action', '{H}', '{OBS}', '{T}', '{{\"action\":\"link_action\",\"observationId\":\"{OBS}\",\"revision\":2}}', 0)",
    f"INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased) VALUES ('{OP4}', 'set_status', '{H}', 'builtin.normal_landing', '{T}', '{{\"action\":\"set_status\",\"sequence\":1,\"skillId\":\"builtin.normal_landing\"}}', 0)",
]

GONE = "00000000-0000-4000-8000-0000000000d1"

VALIDATION = [
    # Controls: states the app produces must be accepted.
    {"name": "valid populated baseline", "category": "control", "sql": [], "expect": "accept"},
    {"name": "debrief deleted: observation keeps its snapshot", "category": "control", "sql": ["DELETE FROM journal_entries WHERE id = 'j1'"], "expect": "accept"},
    {"name": "linked action deleted: the named record remains", "category": "control", "sql": ["DELETE FROM next_actions WHERE id = 'a1'"], "expect": "accept"},
    {"name": "erased observation leaves only a non-content tombstone", "category": "control", "sql": [
        f"INSERT INTO skill_evidence_operations (operation_id, action, request_hash, subject_id, applied_at, result_json, is_erased) VALUES ('00000000-0000-4000-8000-0000000000e1', 'create_observation', '{H}', '{GONE}', '{T}', NULL, 1)"
    ], "expect": "accept"},
    {"name": "retired custom skill with history", "category": "control", "sql": [
        f"UPDATE skill_catalog_entries SET status = 'retired', retired_at = '{T}', revision = 2 WHERE id = '{CUSTOM}'",
        f"INSERT INTO skill_catalog_revisions (skill_id, revision, label, description, topic, status, catalog_version, changed_by, operation_id, changed_at) VALUES ('{CUSTOM}', 2, 'Short-field landing', '', 'landings', 'retired', NULL, 'user', '00000000-0000-4000-8000-0000000000e2', '{T}')",
    ], "expect": "accept"},
    # Exact schema.
    {"name": "missing table", "category": "schema", "sql": ["DROP TABLE skill_self_assessments"], "expect": "refuse"},
    {"name": "extra column", "category": "schema", "sql": ["ALTER TABLE skill_observations ADD COLUMN verified INTEGER"], "expect": "refuse"},
    {"name": "attribution CHECK widened to allow a verified state", "category": "schema-check",
     "candidateEdits": [["attribution           TEXT NOT NULL CHECK (attribution IN ('self_report', 'instructor_transcribed'))", "attribution           TEXT NOT NULL CHECK (attribution IN ('self_report', 'instructor_transcribed', 'instructor_verified'))"]],
     "sql": [], "expect": "refuse"},
    {"name": "relink-forbidding CHECK removed", "category": "schema-check",
     "candidateEdits": [["  CHECK (journal_id IS NULL OR journal_id IS source_journal_id),\n", ""]], "sql": [], "expect": "refuse"},
    {"name": "deleting a debrief would cascade-delete its evidence", "category": "schema-fk",
     "candidateEdits": [["journal_id            TEXT REFERENCES journal_entries(id) ON DELETE SET NULL", "journal_id            TEXT REFERENCES journal_entries(id) ON DELETE CASCADE"]], "sql": [], "expect": "refuse"},
    {"name": "retiring is replaced by cascade-deleting a skill", "category": "schema-fk",
     "candidateEdits": [["skill_id              TEXT NOT NULL REFERENCES skill_catalog_entries(id) ON DELETE RESTRICT", "skill_id              TEXT NOT NULL REFERENCES skill_catalog_entries(id) ON DELETE CASCADE"]], "sql": [], "expect": "refuse"},
    {"name": "self-assessment sequence uniqueness removed", "category": "schema-key",
     "candidateEdits": [[",\n  UNIQUE (skill_id, kind, sequence)", ""]], "sql": [], "expect": "refuse"},
    {"name": "page index missing", "category": "schema-index", "sql": ["DROP INDEX idx_skill_observations_skill_page"], "expect": "refuse"},
    {"name": "page index on the wrong columns", "category": "schema-index",
     "candidateEdits": [["ON skill_observations(skill_id, observed_on, created_at, id)", "ON skill_observations(skill_id, created_at)"]], "sql": [], "expect": "refuse"},
    {"name": "append-only trigger missing", "category": "schema-trigger", "sql": ["DROP TRIGGER trg_skill_observation_revisions_no_update"], "expect": "refuse"},
    {"name": "append-only trigger weakened", "category": "schema-trigger",
     "candidateEdits": [["BEFORE UPDATE ON skill_observation_revisions\nBEGIN", "BEFORE UPDATE OF revision ON skill_observation_revisions\nBEGIN"]], "sql": [], "expect": "refuse"},
    # Catalog.
    {"name": "unknown built-in skill id", "category": "catalog", "sql": [
        f"INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at, retired_at) VALUES ('builtin.made_up', 'builtin', 1, 'Made up', '', 'general', 'active', 1, '{T}', '{T}', NULL)",
        f"INSERT INTO skill_catalog_revisions (skill_id, revision, label, description, topic, status, catalog_version, changed_by, operation_id, changed_at) VALUES ('builtin.made_up', 1, 'Made up', '', 'general', 'active', 1, 'catalog', NULL, '{T}')",
    ], "expect": "refuse"},
    {"name": "built-in renamed without a history entry", "category": "catalog", "sql": ["UPDATE skill_catalog_entries SET label = 'Renamed quietly' WHERE id = 'builtin.go_around'"], "expect": "refuse"},
    # History.
    {"name": "observation history gap", "category": "history", "sql": [f"UPDATE skill_observations SET revision = 3 WHERE id = '{OBS}'"], "expect": "refuse"},
    {"name": "current wording differs from its latest history entry", "category": "history", "sql": [f"UPDATE skill_observations SET wording = 'Tampered.' WHERE id = '{OBS}'"], "expect": "refuse"},
    {"name": "addressed state not recorded in history", "category": "history", "sql": [f"UPDATE skill_observations SET addressed_at = '{T}' WHERE id = '{OBS}'"], "expect": "refuse"},
    {"name": "self-assessment sequence gap", "category": "history", "sql": [
        f"INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at) VALUES ('s3', 'builtin.normal_landing', 'status', 'learning', NULL, 3, 's3', '{T}')"
    ], "expect": "refuse"},
    # Relationships.
    {"name": "observation of a skill that does not exist", "category": "relationships", "sql": [
        "PRAGMA foreign_keys = OFF",
        f"INSERT INTO skill_observations (id, skill_id, skill_label_snapshot, journal_id, source_journal_id, source_journal_date, source_journal_title, source_field, source_text_sha256, attribution, instructor_name, wording, observed_on, revision, created_at, updated_at) VALUES ('orphan', 'custom.00000000-0000-4000-8000-0000000000ff', 'Gone', NULL, 'j9', '2026-10-01', 'L', 'none', NULL, 'self_report', '', 'Orphan.', '2026-10-01', 1, '{T}', '{T}')",
        f"INSERT INTO skill_observation_revisions (observation_id, revision, change_kind, wording, observed_on, attribution, instructor_name, operation_id, recorded_at) VALUES ('orphan', 1, 'created', 'Orphan.', '2026-10-01', 'self_report', '', 'op', '{T}')",
        "PRAGMA foreign_keys = ON",
    ], "expect": "refuse"},
    # Receipts.
    {"name": "receipt result belongs to a different action", "category": "receipts", "sql": [
        f"UPDATE skill_evidence_operations SET result_json = '{{\"action\":\"erase_observation\"}}' WHERE operation_id = '{OP2}'"
    ], "expect": "refuse"},
    {"name": "erased tombstone whose observation is still present", "category": "receipts", "sql": [
        f"UPDATE skill_evidence_operations SET is_erased = 1, result_json = NULL WHERE operation_id = '{OP2}'"
    ], "expect": "refuse"},
]

LONG = "substr(replace(hex(zeroblob(1001)), '0', 'a'), 1, 2001)"
OBS_COLS = "id, skill_id, skill_label_snapshot, journal_id, source_journal_id, source_journal_date, source_journal_title, source_field, source_text_sha256, attribution, instructor_name, wording, observed_on, revision, created_at, updated_at"


def obs(id_, **kw):
    v = {
        "skill_id": "'builtin.go_around'", "label": "'Go-around'", "journal": "'j1'", "source": "'j1'", "date": "'2026-10-01'",
        "title": "'Pattern work'", "field": "'none'", "hash": "NULL", "attr": "'self_report'", "name": "''", "wording": "'Note.'",
        "observed": "'2026-10-01'", "revision": "1",
    }
    v.update(kw)
    return (f"INSERT INTO skill_observations ({OBS_COLS}) VALUES ('{id_}', {v['skill_id']}, {v['label']}, {v['journal']}, {v['source']}, "
            f"{v['date']}, {v['title']}, {v['field']}, {v['hash']}, {v['attr']}, {v['name']}, {v['wording']}, {v['observed']}, {v['revision']}, '{T}', '{T}')")


CONSTRAINTS = [
    {"name": "valid observation insert", "sql": obs("c1"), "expect": "ok"},
    {"name": "invalid calendar date", "sql": obs("c2", observed="'2026-02-30'"), "expect": "error"},
    {"name": "non-date text as date", "sql": obs("c3", observed="'yesterday'"), "expect": "error"},
    {"name": "verified attribution", "sql": obs("c4", attr="'instructor_verified'"), "expect": "error"},
    {"name": "instructor name on a self-report", "sql": obs("c5", name="'Someone'"), "expect": "error"},
    {"name": "instructor name on transcribed feedback", "sql": obs("c6", attr="'instructor_transcribed'", name="'Synthetic CFI'"), "expect": "ok"},
    {"name": "journal link differs from recorded source", "sql": obs("c7", journal="'j2'"), "expect": "error"},
    {"name": "source field without its fingerprint", "sql": obs("c8", field="'instructor_feedback'"), "expect": "error"},
    {"name": "malformed fingerprint", "sql": obs("c9", field="'instructor_feedback'", hash="'ABC'"), "expect": "error"},
    {"name": "wording of 2001 characters", "sql": obs("c10", wording=LONG), "expect": "error"},
    {"name": "blank wording", "sql": obs("c11", wording="'   '"), "expect": "error"},
    {"name": "unknown skill (foreign key)", "sql": obs("c12", skill_id="'builtin.nope'"), "expect": "error"},
    {"name": "relink an existing observation to another debrief", "sql": f"UPDATE skill_observations SET journal_id = 'j2' WHERE id = '{OBS}'", "expect": "error"},
    {"name": "action link without its snapshot", "sql": f"UPDATE skill_observations SET action_id = 'a1', linked_action_id = NULL, linked_action_title = NULL WHERE id = '{OBS}'", "expect": "error"},
    {"name": "rewrite observation history", "sql": "UPDATE skill_observation_revisions SET wording = 'x'", "expect": "error"},
    {"name": "delete part of an observation's history", "sql": f"DELETE FROM skill_observation_revisions WHERE observation_id = '{OBS}' AND revision = 2", "expect": "error"},
    {"name": "erase an observation with its history", "sql": f"DELETE FROM skill_observations WHERE id = '{OBS}'", "expect": "ok"},
    {"name": "delete a skill", "sql": "DELETE FROM skill_catalog_entries WHERE id = 'builtin.go_around'", "expect": "error"},
    {"name": "rewrite catalog history", "sql": "UPDATE skill_catalog_revisions SET label = 'x' WHERE skill_id = 'builtin.go_around'", "expect": "error"},
    {"name": "custom skill with a built-in id", "sql": f"INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at) VALUES ('builtin.mine', 'custom', NULL, 'Mine', '', 'general', 'active', 1, '{T}', '{T}')", "expect": "error"},
    {"name": "retired without a retirement time", "sql": f"UPDATE skill_catalog_entries SET status = 'retired' WHERE id = '{CUSTOM}'", "expect": "error"},
    {"name": "unknown topic", "sql": f"INSERT INTO skill_catalog_entries (id, origin, catalog_version, label, description, topic, status, revision, created_at, updated_at) VALUES ('custom.x', 'custom', NULL, 'X', '', 'aerobatics', 'active', 1, '{T}', '{T}')", "expect": "error"},
    {"name": "confidence outside 1-5", "sql": f"INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at) VALUES ('x1', 'builtin.go_around', 'confidence', NULL, 6, 1, 'x1', '{T}')", "expect": "error"},
    {"name": "status value on a confidence entry", "sql": f"INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at) VALUES ('x2', 'builtin.go_around', 'confidence', 'learning', NULL, 1, 'x2', '{T}')", "expect": "error"},
    {"name": "a proficiency status", "sql": f"INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at) VALUES ('x3', 'builtin.go_around', 'status', 'proficient', NULL, 1, 'x3', '{T}')", "expect": "error"},
    {"name": "duplicate self-assessment sequence", "sql": f"INSERT INTO skill_self_assessments (id, skill_id, kind, status, confidence, sequence, operation_id, set_at) VALUES ('x4', 'builtin.normal_landing', 'status', 'learning', NULL, 1, 'x4', '{T}')", "expect": "error"},
    {"name": "erased receipt that still holds a result", "sql": f"UPDATE skill_evidence_operations SET is_erased = 1 WHERE operation_id = '{OP2}'", "expect": "error"},
    {"name": "deleting the debrief clears only the live link", "sql": "DELETE FROM journal_entries WHERE id = 'j1'", "expect": "ok"},
    {"name": "deleting the action clears only the live link", "sql": "DELETE FROM next_actions WHERE id = 'a1'", "expect": "ok"},
]


def main():
    (HERE / "fixtures").mkdir(exist_ok=True)
    (HERE / "fixtures" / "validation-cases.json").write_text(json.dumps({"baseline": BASELINE, "cases": VALIDATION}, indent=2) + "\n")
    (HERE / "fixtures" / "constraint-cases.json").write_text(json.dumps({"baseline": BASELINE, "cases": CONSTRAINTS}, indent=2) + "\n")
    print(f"validation cases: {len(VALIDATION)}, constraint cases: {len(CONSTRAINTS)}")


if __name__ == "__main__":
    main()
