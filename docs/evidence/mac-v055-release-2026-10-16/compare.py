"""Offline, read-only comparison of the restored library with the backup archive it came from.
usage: compare.py FIXTURE_DIR LABEL   (app must be stopped)
Retained: every fixture table's columns and rows, every fixture schema object's SQL, every fixture
ledger row (all columns, including installed_on/execution_time), every managed document's SHA-256.
Only app_metadata keys last_complete_backup_at/path/version are excluded.
New: ledger rows absent from the fixture are validated against the shipped SQL (SHA-384) and success.
"""
import sqlite3,subprocess,json,hashlib,sys,pathlib,datetime
fx=pathlib.Path(sys.argv[1]); label=sys.argv[2]
root=pathlib.Path.home()/'Library/Application Support/com.herflightdeck.app'
repo=pathlib.Path('/Users/rickymac/code/Flight-training-')
assert subprocess.run(['pgrep','-x','her-flight-deck'],capture_output=True).returncode==1,'app must be stopped'
EXCL={'last_complete_backup_at','last_complete_backup_path','last_complete_backup_version'}
def ro(p): return sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
a=ro(fx/'her-flight-deck.db'); b=ro(root/'her-flight-deck.db')
def norm(v): return {'hex':v.hex()} if isinstance(v,bytes) else v
def rows(c,t):
    r=[json.dumps([norm(x) for x in row],sort_keys=True) for row in c.execute(f'select * from "{t}"')]
    return sorted(r)
def cols(c,t): return [x[1:] for x in c.execute(f'pragma table_info("{t}")')]
res={'label':label,'at':datetime.datetime.now().astimezone().isoformat(),'fixture':str(fx),'root':str(root)}
ta=[t for (t,) in a.execute("select name from sqlite_master where type='table' order by name")]
tb=[t for (t,) in b.execute("select name from sqlite_master where type='table' order by name")]
res['fixtureTables']=len(ta); res['restoredTables']=len(tb); res['newTables']=sorted(set(tb)-set(ta)); res['missingTables']=sorted(set(ta)-set(tb))
diff={}; counts={}
for t in ta:
    if t not in tb: continue
    if t=='_sqlx_migrations': continue
    ca,cb=cols(a,t),cols(b,t)
    ra,rb=rows(a,t),rows(b,t)
    if t=='app_metadata':
        key=[x[0] for x in ca].index('key')
        ra=[r for r in ra if json.loads(r)[key] not in EXCL]; rb=[r for r in rb if json.loads(r)[key] not in EXCL]
    counts[t]=len(ra)
    d={}
    if ca!=cb: d['columns']={'fixture':ca,'restored':cb}
    sa,sb=set(ra),set(rb)
    if sa-sb: d['missingRows']=sorted(sa-sb)[:20]
    if sb-sa: d['extraRows']=sorted(sb-sa)[:20]
    if d: diff[t]=d
res['retainedRowCounts']=counts; res['retainedRowsTotal']=sum(counts.values()); res['tableDifferences']=diff
sa={(r[0],r[1]):r[2] for r in a.execute("select type,name,sql from sqlite_master")}
sb={(r[0],r[1]):r[2] for r in b.execute("select type,name,sql from sqlite_master")}
res['fixtureSchemaObjects']=len(sa); res['restoredSchemaObjects']=len(sb)
res['schemaObjectsChangedOrMissing']=[f'{k[0]}:{k[1]}' for k,v in sa.items() if sb.get(k,'<missing>')!=v]
res['newSchemaObjects']=sorted(f'{k[0]}:{k[1]}' for k in set(sb)-set(sa))
la={r[0]:[norm(x) for x in r] for r in a.execute('select * from _sqlx_migrations order by version')}
lb={r[0]:[norm(x) for x in r] for r in b.execute('select * from _sqlx_migrations order by version')}
res['ledgerColumns']=[x[1] for x in b.execute('pragma table_info(_sqlx_migrations)')]
res['originalLedgerVersions']=sorted(la); res['originalLedgerRowsIdentical']=all(lb.get(v)==r for v,r in la.items())
res['originalLedgerMismatches']=[v for v,r in la.items() if lb.get(v)!=r]
files={p.name.split('_')[0].lstrip('0'):p for p in (repo/'src-tauri/migrations').glob('*.sql')}
new=[]
for v in sorted(set(lb)-set(la)):
    r=dict(zip(res['ledgerColumns'],lb[v])); f=files[str(v)]
    new.append({'version':v,'description':r['description'],'success':r['success'],'installed_on':r['installed_on'],
      'checksumMatchesShippedSql':r['checksum']['hex']==hashlib.sha384(f.read_bytes()).hexdigest(),'file':f.name})
res['newLedgerRows']=new
if 'skill_catalog_entries' in tb:
    res['skillCatalogSeed']=b.execute("select count(*) from skill_catalog_entries where origin='builtin'").fetchone()[0]
    res['skillCatalogRevisionsSeed']=b.execute("select count(*) from skill_catalog_revisions").fetchone()[0]
def docs(d): return {str(p.relative_to(d/'documents')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (d/'documents').rglob('*') if p.is_file()} if (d/'documents').exists() else {}
da,db=docs(fx),docs(root)
res['fixtureDocuments']=da; res['documentsIdentical']=da==db; res['restoredDocumentsExtra']=sorted(set(db)-set(da))
res['integrityCheck']=b.execute('pragma integrity_check').fetchone()[0]
res['verdict']={'retainedRowsIdentical':not diff,'schemaRetained':not res['schemaObjectsChangedOrMissing'],
  'originalLedgerIdentical':res['originalLedgerRowsIdentical'],'documentsIdentical':res['documentsIdentical'],
  'newMigrationsValid':all(n['success'] in (1,True) and n['checksumMatchesShippedSql'] for n in new)}
out=pathlib.Path(__file__).parent/'snapshots'/f'{label}.json'; assert not out.exists(); out.write_text(json.dumps(res,indent=2)+'\n')
print(json.dumps({k:res[k] for k in ['verdict','newTables','missingTables','newSchemaObjects','newLedgerRows','retainedRowsTotal','integrityCheck']+(['skillCatalogSeed','skillCatalogRevisionsSeed'] if 'skillCatalogSeed' in res else [])},indent=1)[:3000])
if diff: print('DIFFS', json.dumps(diff)[:2000])
