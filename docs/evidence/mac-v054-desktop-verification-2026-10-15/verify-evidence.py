"""Offline audit of the frozen synthetic native-run snapshots; no profile access."""
from pathlib import Path
import json,sqlite3,hashlib,sys
root=Path(__file__).resolve().parent;repo=root.parents[2]
receipt_keys={'last_complete_backup_at','last_complete_backup_path','last_complete_backup_version'}
def read(name):return json.loads((root/(name+'.json')).read_text())
def compare(a,b,restore=False):
 a=read(a);b=read(b);changes=[]
 assert set(a['tables'])==set(b['tables'])
 for t,x in a['tables'].items():
  y=b['tables'][t]
  if restore and t=='app_metadata':
   x={**x,'rows':[z for z in x['rows'] if z[0] not in receipt_keys]}
   y={**y,'rows':[z for z in y['rows'] if z[0] not in receipt_keys]}
  if x!=y:changes.append(t)
 assert not changes,changes
 assert a['schema']==b['schema']
 assert a['documents']==b['documents']
 return {'tables':len(a['tables']),'schemaDefinitions':len(a['schema']),'managedDocuments':len(a['documents']),'metadataExclusions':sorted(receipt_keys) if restore else []}
def migrate(a_name,b_name,restore=False):
 a=read(a_name);b=read(b_name);m=repo/'src-tauri/migrations/0014_skills_evidence.sql';sql=m.read_bytes()
 assert set(b['tables'])-set(a['tables'])=={'skill_catalog_entries','skill_catalog_revisions','skill_observations','skill_observation_revisions','skill_self_assessments','skill_evidence_operations'}
 for t,x in a['tables'].items():
  if t=='_sqlx_migrations':continue
  y=b['tables'][t]
  if restore and t=='app_metadata':
   x={**x,'rows':[z for z in x['rows'] if z[0] not in receipt_keys]};y={**y,'rows':[z for z in y['rows'] if z[0] not in receipt_keys]}
  assert x==y,t
 old=a['tables']['_sqlx_migrations']['rows'];new=b['tables']['_sqlx_migrations']['rows']
 assert len(old)==13 and {r[0] for r in old}==set(range(1,14))
 assert all(r in new for r in old)
 assert len(new)==14
 row=next(r for r in new if r[0]==14);assert row[3]==1 and row[4]=={'hex':hashlib.sha384(sql).hexdigest()}
 c=sqlite3.connect(':memory:');c.executescript('create table journal_entries(id text primary key);create table next_actions(id text primary key);');c.executescript(sql.decode())
 for t in set(b['tables'])-set(a['tables']):
  rows=sorted([list(x) for x in c.execute('select * from '+t)],key=lambda x:json.dumps(x,sort_keys=True));assert rows==b['tables'][t]['rows'],t
 assert all(x in b['schema'] for x in a['schema'])
 actual=sorted(x for x in b['schema'] if x not in a['schema'])
 expected=sorted(list(x) for x in c.execute("select type,name,tbl_name,sql from sqlite_master where name not in ('journal_entries','next_actions','sqlite_autoindex_journal_entries_1','sqlite_autoindex_next_actions_1')"))
 assert actual==expected
 assert a['documents']==b['documents']
 return {'retainedTables':len(a['tables']),'oldLedgerRowsExactlyRetained':13,'newMigration14Checksum':row[4]['hex'],'newSchemaAndSeedExact':True,'managedDocumentsIdentical':True,'metadataExclusions':sorted(receipt_keys) if restore else []}
results={
 'current14Restore':compare('schema14-backup-before','schema14-restored',True),
 'populated13To14Upgrade':migrate('upgrade13-before','upgrade14-after'),
 'older13RestoreTo14':migrate('upgrade13-before','restore13-after',True),
 'skillsCancellation':compare('skills-before-cancel','skills-after-cancel'),
 'guardedSaveFailure':compare('guarded-save-before','guarded-save-after'),
 'damagedArchiveRefusal':compare('skills-backup14-before','invalid-backup-after'),
 'populatedSkills14Restore':compare('skills-backup14-before','skills-restored14-after',True),
}
q=read('permission-operation');z=read('permission-recovery');assert z['recovered'] and z['recoveredMode']==q['oldMode'] and all(z[k]==q[k] for k in ['operation','path','inode','uid','oldMode','temporaryMode']);results['permissionRecovery']='PASS'
pdf=read('pdf-page-audit');original=next(v for k,v in pdf.items() if 'Chapter' not in k);chapter=next(v for k,v in pdf.items() if 'Chapter' in k);assert original['pages']==10 and chapter['pages']==3;assert ['P0002','P0003','P0004']==[x.split('ID: ')[1].split(')')[0] for x in chapter['text']];results['chapterPageIdentity']='PASS'
f=read('date-bug-confirmation');assert f['actualLocalTime'].startswith('2026-10-15') and f['actualLocalTime'].endswith('-07:00');assert f['database']['last_reviewed_at'].startswith('2026-10-16');results['dateBug']='CONFIRMED'
for name in ['restore13-window-observation','restore14-skills-window-observation']:assert '19387' in json.dumps(read(name)) or '19899' in json.dumps(read(name))
results['restartWindow']='OPEN: data checks are distinct from visible window recovery'
print(json.dumps({'success':True,'offlineOnly':True,'results':results},indent=2))
