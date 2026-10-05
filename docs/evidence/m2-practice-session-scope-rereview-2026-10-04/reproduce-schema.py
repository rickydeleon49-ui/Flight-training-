"""Proposed DDL only; all SQLite databases are disposable and in memory."""
import hashlib
import json
import re
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent
proposal = root / 'submitted-scope.md.txt'
raw = proposal.read_bytes()
sql = re.search(r'```sql\n(.*?)\n```', raw.decode(), re.S).group(1)


def fresh():
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
        CREATE TABLE study_materials(id TEXT PRIMARY KEY);
        CREATE TABLE practice_tests(source_material_id TEXT PRIMARY KEY,
            questions_json TEXT, generated_at TEXT);
    ''')
    db.executescript(sql)
    assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
    return db


def add(db, table, **fields):
    names = ','.join(fields)
    marks = ','.join('?' for _ in fields)
    db.execute(f'INSERT INTO {table} ({names}) VALUES ({marks})', list(fields.values()))


def version(db, ident, active=1):
    add(db, 'practice_test_versions', id=ident, source_material_id='material',
        source_material_title='Synthetic source', content_hash=ident,
        created_at='2026-10-04T12:00:00Z', is_active=active)


def item(db, ident, ver):
    add(db, 'practice_test_items', id=ident, version_id=ver, ordinal=0,
        question_text='Which synthetic letter is first?', options_json='["A","B"]',
        correct_index=0, explanation='Synthetic explanation')


def attempt(db, ident, ver, state='in_progress'):
    add(db, 'practice_attempts', id=ident, version_id=ver, source_material_id='material',
        source_material_title='Synthetic source', started_at='2026-10-04T12:00:00Z',
        status=state, total_questions=1)


def response(db, ident, att, itm, selected=0, unknown=0):
    add(db, 'practice_responses', id=ident, attempt_id=att, item_id=itm,
        selected_index=selected, is_dont_know=unknown, is_correct=0,
        answered_at='2026-10-04T12:01:00Z')


def rejects(db, operation):
    db.execute('SAVEPOINT diagnostic')
    try:
        operation()
    except sqlite3.IntegrityError:
        return True
    finally:
        db.execute('ROLLBACK TO diagnostic')
        db.execute('RELEASE diagnostic')
    return False


db = fresh()
add(db, 'study_materials', id='material')
version(db, 'v1')
item(db, 'i1', 'v1')
attempt(db, 'a1', 'v1')
observations = {}
observations['second_active_version_rejected'] = rejects(db, lambda: version(db, 'v2'))
version(db, 'v2', 0)
item(db, 'i2', 'v2')
observations['cross_version_insert_rejected'] = rejects(db, lambda: response(db, 'r-cross', 'a1', 'i2'))
observations['dont_know_with_selection_rejected'] = rejects(db, lambda: response(db, 'r-bad', 'a1', 'i1', 2, 1))
response(db, 'r1', 'a1', 'i1')
db.execute('UPDATE practice_responses SET item_id=? WHERE id=?', ('i2', 'r1'))
observations['cross_version_update_accepted_by_sketch'] = db.execute(
    'SELECT item_id FROM practice_responses WHERE id="r1"').fetchone()[0] == 'i2'
db.execute('UPDATE practice_responses SET item_id="i1" WHERE id="r1"')
attempt(db, 'a2', 'v1')
observations['two_in_progress_attempts_accepted_by_sketch'] = db.execute(
    'SELECT COUNT(*) FROM practice_attempts WHERE status="in_progress"').fetchone()[0] == 2
response(db, 'r-null', 'a2', 'i1', None, 0)
observations['null_selection_without_dont_know_accepted_by_check'] = True
observations['operation_receipt_storage_defined_in_sketch'] = any(
    'operation' in row[1].lower()
    for table, in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    for row in db.execute(f'PRAGMA table_info({table})'))
add(db, 'practice_tests', source_material_id='material', questions_json='[{"synthetic":true}]',
    generated_at='2026-10-04T12:00:00Z')
observations['new_writer_without_marker_is_reselected_for_legacy_conversion'] = db.execute(
    'SELECT source_material_id FROM practice_tests WHERE legacy_migrated_at IS NULL AND legacy_error IS NULL'
).fetchall() == [('material',)]
observations['reconversion_active_insert_conflicts'] = rejects(db, lambda: version(db, 'converted'))
assert observations['new_writer_without_marker_is_reselected_for_legacy_conversion']
assert observations['reconversion_active_insert_conflicts']
observations['foreign_key_violations'] = db.execute('PRAGMA foreign_key_check').fetchall()
assert observations['second_active_version_rejected']
assert observations['cross_version_insert_rejected']
assert observations['dont_know_with_selection_rejected']
assert observations['cross_version_update_accepted_by_sketch']
assert observations['two_in_progress_attempts_accepted_by_sketch']
assert not observations['operation_receipt_storage_defined_in_sketch']
assert observations['foreign_key_violations'] == []

# The chosen Policy A does preserve completed review and remove the draft version.
db = fresh()
add(db, 'study_materials', id='material')
version(db, 'v1', 0)
version(db, 'v2')
item(db, 'i1', 'v1')
item(db, 'i2', 'v2')
attempt(db, 'done', 'v1', 'completed')
attempt(db, 'draft', 'v2')
response(db, 'r-done', 'done', 'i1')
db.execute('DELETE FROM study_materials WHERE id="material"')
observations['policy_a_after_material_delete'] = {
    'versions': db.execute('SELECT id,source_material_id,is_active FROM practice_test_versions').fetchall(),
    'attempts': db.execute('SELECT id,status,source_material_id FROM practice_attempts').fetchall(),
    'items': db.execute('SELECT id FROM practice_test_items').fetchall(),
    'responses': db.execute('SELECT id FROM practice_responses').fetchall(),
}
assert observations['policy_a_after_material_delete'] == {
    'versions': [('v1', None, 0)], 'attempts': [('done', 'completed', None)],
    'items': [('i1',)], 'responses': [('r-done',)]}
assert db.execute('PRAGMA foreign_key_check').fetchall() == []

# Mirrors only the relevant current basic-schema/ceiling predicates; not Rust execution.
old = sqlite3.connect(':memory:')
old.executescript('''CREATE TABLE settings(id TEXT);
    CREATE TABLE study_materials(id TEXT);
    CREATE TABLE _sqlx_migrations(version INTEGER);
    INSERT INTO _sqlx_migrations VALUES(10);''')
tables = {r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
observations['minimal_schema10_fixture'] = {
    'current_basic_table_and_ceiling_predicates_pass': {'settings', 'study_materials'} <= tables
        and old.execute('SELECT MAX(version) FROM _sqlx_migrations').fetchone()[0] <= 10,
    'unconditional_proposed_table_check_passes': {
        'practice_test_versions', 'practice_test_items', 'practice_attempts', 'practice_responses'} <= tables,
}
assert observations['minimal_schema10_fixture'] == {
    'current_basic_table_and_ceiling_predicates_pass': True,
    'unconditional_proposed_table_check_passes': False}
print(json.dumps({'proposal_sha256': hashlib.sha256(raw).hexdigest(),
    'observations': observations}, indent=2))
