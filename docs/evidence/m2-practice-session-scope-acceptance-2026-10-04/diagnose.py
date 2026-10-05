"""Proposed DDL checks only; no application/user files are opened."""
from pathlib import Path
import hashlib, json, re, sqlite3

root = Path(__file__).resolve().parent


def diagnose(path):
    raw = path.read_bytes()
    sql = re.search(r'```sql\n(.*?)\n```', raw.decode(), re.S).group(1)
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('CREATE TABLE study_materials(id TEXT PRIMARY KEY); CREATE TABLE practice_tests(source_material_id TEXT PRIMARY KEY, questions_json TEXT, generated_at TEXT);')
    db.executescript(sql)
    cols = lambda table: {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
    def add(table, **fields):
        db.execute(f'INSERT INTO {table} ({",".join(fields)}) VALUES ({",".join("?" for _ in fields)})', list(fields.values()))
    def ver(ident, active):
        fields=dict(id=ident, source_material_id='material', source_material_title='Synthetic', content_hash=ident, created_at='2026-10-04T12:00:00Z', is_active=active)
        if 'history_key' in cols('practice_test_versions'): fields['history_key']='material'
        add('practice_test_versions', **fields)
    def attempt(ident, version, status='in_progress'):
        add('practice_attempts', id=ident, version_id=version, source_material_id='material', source_material_title='Synthetic', started_at='2026-10-04T12:00:00Z', status=status, total_questions=1)
    def response(ident, attempt_id, item_id, selected, unknown):
        add('practice_responses', id=ident, attempt_id=attempt_id, item_id=item_id, selected_index=selected, is_dont_know=unknown, is_correct=0, answered_at='2026-10-04T12:01:00Z')
    def rejects(operation):
        db.execute('SAVEPOINT check_case')
        try:
            operation()
        except sqlite3.IntegrityError:
            return True
        finally:
            db.execute('ROLLBACK TO check_case')
            db.execute('RELEASE check_case')
        return False
    add('study_materials', id='material')
    ver('v1', 1)
    out={'second_active_version_rejected': rejects(lambda: ver('v2', 1))}
    ver('v2', 0)
    for ident, version in [('i1', 'v1'), ('i2', 'v2')]:
        add('practice_test_items', id=ident, version_id=version, ordinal=0, question_text='Synthetic?', options_json='["A","B"]', correct_index=0)
    attempt('a1', 'v1')
    out['second_in_progress_attempt_rejected']=rejects(lambda: attempt('a2', 'v1'))
    out['cross_version_insert_rejected']=rejects(lambda: response('bad', 'a1', 'i2', 0, 0))
    out['null_selection_without_flag_rejected']=rejects(lambda: response('null', 'a1', 'i1', None, 0))
    out['dont_know_with_selection_rejected']=rejects(lambda: response('wrong', 'a1', 'i1', 1, 1))
    response('r1', 'a1', 'i1', 0, 0)
    out['cross_version_update_rejected']=rejects(lambda: db.execute('UPDATE practice_responses SET item_id="i2" WHERE id="r1"'))
    out['durable_receipt_table_exists']={'operation_id','action','request_hash','result_json','applied_at'} <= cols('practice_session_operations')
    db.execute('UPDATE practice_attempts SET status="completed" WHERE id="a1"')
    attempt('draft', 'v2')
    if 'history_key' in cols('practice_session_operations'):
        add('practice_session_operations', operation_id='receipt', action='start_or_resume', request_hash='0'*64, applied_at='2026-10-04T12:00:00Z', result_json='{"attemptId":"draft"}', history_key='material', attempt_id='draft')
    db.execute('DELETE FROM study_materials WHERE id="material"')
    out['policy_a_completed_review_retained_draft_pruned']=(
        db.execute('SELECT id,source_material_id,is_active FROM practice_test_versions').fetchall()==[('v1',None,0)]
        and db.execute('SELECT id,status FROM practice_attempts').fetchall()==[('a1','completed')]
        and db.execute('SELECT id FROM practice_responses').fetchall()==[('r1',)])
    out['foreign_keys_enabled_and_clean']=db.execute('PRAGMA foreign_keys').fetchone()[0]==1 and db.execute('PRAGMA foreign_key_check').fetchall()==[]
    if 'history_key' in cols('practice_session_operations'):
        out['history_key_survives_material_deletion']=db.execute('SELECT history_key FROM practice_test_versions').fetchone()[0]=='material'
        out['pruned_attempt_receipt_tombstoned']=db.execute('SELECT is_erased,result_json FROM practice_session_operations').fetchone()==(1,'null')
        out['revision_nonnegative_constraint']=rejects(lambda: db.execute('UPDATE practice_attempts SET revision=-1'))
    assert all(out.values()), out
    json_examples = re.findall(r'```json\n(.*?)\n```', raw.decode(), re.S)
    for example in json_examples: json.loads(example)
    return {'sha256':hashlib.sha256(raw).hexdigest(),'schema_checks':out,'valid_json_examples':len(json_examples)}

print(json.dumps({name:diagnose(root/name) for name in ['submitted-scope.md.txt','reviewed-scope.md.txt']}, indent=2))
