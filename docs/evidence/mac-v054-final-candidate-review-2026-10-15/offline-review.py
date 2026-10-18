import collections, hashlib, json, pathlib, sqlite3

REPO = pathlib.Path('/Users/rickymac/code/Flight-training-')
RUN = pathlib.Path('/Users/rickymac/.codex/task-recovery/v054-final-candidate-20261015/installed-run-20261016')
ROOT = RUN / 'test-profile-after-restores'
EXCLUSIONS = {'last_complete_backup_at', 'last_complete_backup_path', 'last_complete_backup_version'}
MIGRATIONS = {int(p.name.split('_')[0]): p for p in (REPO / 'src-tauri/migrations').glob('*.sql')}

def ro(p):
    return sqlite3.connect(p.resolve().as_uri() + '?mode=ro', uri=True)

def schema(c):
    return {(t, n): sql for t, n, sql in c.execute('SELECT type,name,sql FROM sqlite_master')}

def rows(c, table):
    data = c.execute('SELECT * FROM "' + table.replace('"', '""') + '"').fetchall()
    if table == 'app_metadata':
        data = [r for r in data if r[0] not in EXCLUSIONS]
    return collections.Counter(data)

def docs(root):
    d = root / 'documents'
    return {str(p.relative_to(d)): hashlib.sha256(p.read_bytes()).hexdigest() for p in d.rglob('*') if p.is_file()}

results = []
for version, actual in [(12, ROOT), (13, ROOT / 'backups/2026-10-16-060329-before-restore'), (14, ROOT / 'backups/2026-10-16-060218-before-restore')]:
    fixture = RUN / 'fixtures' / ('s' + str(version))
    a, b = ro(fixture / 'her-flight-deck.db'), ro(actual / 'her-flight-deck.db')
    expected = sqlite3.connect(':memory:')
    a.backup(expected)
    for v in range(version + 1, 15):
        expected.executescript(MIGRATIONS[v].read_text())
    assert schema(expected) == schema(b), ('complete schema definitions', version)
    al = {r[0]: r for r in a.execute('SELECT * FROM _sqlx_migrations')}
    bl = {r[0]: r for r in b.execute('SELECT * FROM _sqlx_migrations')}
    assert set(bl) == set(range(1, 15)), ('ledger coverage', version)
    assert all(bl[v] == r for v, r in al.items()), ('retained ledger bytes', version)
    for v in range(version + 1, 15):
        row = dict(zip([x[1] for x in b.execute('PRAGMA table_info(_sqlx_migrations)')], bl[v]))
        assert row['success'] == 1
        assert row['checksum'] == hashlib.sha384(MIGRATIONS[v].read_bytes()).digest()
    differences = []
    for table, in expected.execute("SELECT name FROM sqlite_master WHERE type='table' AND name != '_sqlx_migrations'"):
        er, br = rows(expected, table), rows(b, table)
        if er != br:
            missing, added = er - br, br - er
            columns = [r[1] for r in b.execute('PRAGMA table_info("' + table + '")')]
            differences.append({'table': table, 'missing': [{k: v for k, v in zip(columns, r)} for r in missing.elements()], 'added': [{k: v for k, v in zip(columns, r)} for r in added.elements()]})
    assert docs(fixture) == docs(actual), ('all managed documents', version)
    assert b.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
    assert b.execute('PRAGMA foreign_key_check').fetchall() == []
    results.append({'fixtureSchema': version, 'actual': str(actual), 'completeSchemaMatchesExpected': True, 'ledgerCoverageAndChecksumsValid': True, 'retainedLedgerIdentical': True, 'allDocumentsIdentical': True, 'integrityAndForeignKeys': True, 'differences': differences})
    a.close(); b.close(); expected.close()
out = pathlib.Path(__file__).with_name('offline-review.json')
out.write_text(json.dumps(results, indent=2) + '\n')
for r in results:
    print(json.dumps({k: v for k, v in r.items() if k != 'differences'}))
    print('Changed tables:', [d['table'] for d in r['differences']])
