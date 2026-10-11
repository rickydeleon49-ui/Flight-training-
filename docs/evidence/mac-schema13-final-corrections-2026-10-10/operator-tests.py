"""Production bodies with scratch-only constant/tool substitutions, including real stat fields.
No test switches are distributed. Fake inspector executables exist only in this owned scratch.
"""
import pathlib,tempfile,subprocess,json,os,shutil,stat
PACK=pathlib.Path(__file__).resolve().parent
source=PACK/'hfd-operator.sh'
scratch=pathlib.Path(tempfile.mkdtemp(prefix='hfd-operator-final-')).resolve()
workspace=scratch/'Downloads/workspace'; workspace.parent.mkdir()
root=scratch/'Application Support/com.herflightdeck.app';(root/'backups').mkdir(parents=True)
tools=scratch/'tools';tools.mkdir(); apps=scratch/'Applications';apps.mkdir()
for name,body in {
 'id':'case "$1" in -u) echo "${MOCK_UID:-502}";; -un) echo "${MOCK_ACCOUNT:-hfdtest}";; esac',
 'group':'exit "${MOCK_GROUP:-1}"',
 'pgrep':'exit "${MOCK_PROCESS:-1}"',
 'stat':'if [ "$2" = "%u" ]; then echo "${MOCK_OWNER:-502}"; else exec /usr/bin/stat "$@"; fi',
 'cp':'if [ "${MOCK_COPY_FAIL:-0}" = 1 ]; then exit 1; else exec /bin/cp "$@"; fi'
}.items():
 p=tools/name;p.write_text('#!/bin/bash\n'+body+'\n');p.chmod(0o755)
s=source.read_text()
for old,new in [("APPROVED_ROOT='/Users/hfdtest/Library/Application Support/com.herflightdeck.app'",f"APPROVED_ROOT='{root}'"),("WORKSPACE='/Users/hfdtest/Downloads/hfd-schema13-workspace'",f"WORKSPACE='{workspace}'")]+[(f'{k}={v}',f'{k}={tools/name}') for k,v,name in [('ID_BIN','/usr/bin/id','id'),('GROUP_BIN','/usr/sbin/dseditgroup','group'),('PGREP_BIN','/usr/bin/pgrep','pgrep'),('STAT_BIN','/usr/bin/stat','stat'),('CP_BIN','/bin/cp','cp')]]:
 assert old in s,old;s=s.replace(old,new)
op=scratch/'op.sh';op.write_text(s);op.chmod(0o755)
results=[]
def run(*args,extra=None):
 env=dict(os.environ,HFD_WORKSPACE=str(workspace),HFD_PROFILES=str(workspace/'profiles'),HFD_RUN_ID='run-A',HFD_EVID=str(workspace/'evidence/run-A'))
 env.update(extra or {})
 return subprocess.run(['/bin/bash',str(op),*map(str,args)],env=env,capture_output=True,text=True)
def check(name,r,condition):results.append(dict(name=name,pass_=bool(condition),exit=r.returncode,output=r.stdout+r.stderr))
def mode():return stat.S_IMODE((root/'backups').stat().st_mode)
def active(run='run-A'):
 e=workspace/'evidence'/run;return e/(e/'active-backup-operation.txt').read_text().strip()
try:
 r=run('prepare');check('fresh owned workspace creation',r,r.returncode==0)
 r=run('fresh-root');check('existing app profile refuses fresh gate without changes',r,r.returncode==2 and (root/'backups').exists())
 r=run('prepare');check('existing workspace preserved',r,r.returncode==2)
 r=run('new-run','run-A');check('fresh run output creation',r,r.returncode==0)
 r=run('new-run','run-A');check('existing run refused',r,r.returncode==2)
 src=workspace/'profiles/source';src.mkdir();(src/'owned.txt').write_text('synthetic')
 for args,extra,name in [(['copy',src,workspace/'profiles/wronguid'],{'MOCK_UID':'501'},'wrong uid refusal'),(['copy',src,workspace/'profiles/admin'],{'MOCK_GROUP':'0'},'admin refusal'),(['copy',src,workspace/'profiles/group-error'],{'MOCK_GROUP':'2'},'account inspector error refusal'),(['copy',src,workspace/'profiles/process-error'],{'MOCK_PROCESS':'2'},'process inspector error refusal'),(['copy',src,workspace/'profiles/running'],{'MOCK_PROCESS':'0'},'running app refusal'),(['copy',src,workspace/'profiles/owner-error'],{'MOCK_OWNER':'501'},'ownership refusal')]:
  r=run(*args,extra=extra);check(name,r,r.returncode==2 and not pathlib.Path(args[-1]).exists())
 r=run('copy',src,workspace/'profiles/copied');check('allowed fresh copy retains complete source',r,r.returncode==0 and (workspace/'profiles/copied/owned.txt').read_text()=='synthetic' and src.exists())
 r=run('move',workspace/'profiles/copied',workspace/'profiles/moved');check('allowed move retains complete destination',r,r.returncode==0 and not (workspace/'profiles/copied').exists() and (workspace/'profiles/moved/owned.txt').read_text()=='synthetic')
 r=run('copy',src,workspace/'profiles/moved');check('existing destination preserved',r,r.returncode==2 and (workspace/'profiles/moved/owned.txt').read_text()=='synthetic')
 r=run('copy',src,src/'inner');check('self nesting refused',r,r.returncode==2 and not (src/'inner').exists())
 for path,dest,name in [(str(workspace/'profiles')+'/../outside',workspace/'profiles/traversal','source traversal'),(src,workspace/'profiles/../escaped','destination traversal')]:
  r=run('copy',path,dest);check(name,r,r.returncode==2 and not dest.exists())
 target=scratch/'outside';target.mkdir();(workspace/'profiles/link').symlink_to(target,target_is_directory=True)
 r=run('copy',src,workspace/'profiles/link/escaped');check('symlink destination parent refuses escape',r,r.returncode==2 and not (target/'escaped').exists())
 (workspace/'profiles/source-link').symlink_to(src,target_is_directory=True)
 r=run('copy',workspace/'profiles/source-link',workspace/'profiles/symlinkout');check('symlink source refused',r,r.returncode==2)
 (workspace/'profiles/dangling').symlink_to(target/'absent')
 r=run('copy',src,workspace/'profiles/dangling');check('dangling destination preserved',r,r.returncode==2 and (workspace/'profiles/dangling').is_symlink())
 r=run('copy',src,workspace/'profiles/copyfail',extra={'MOCK_COPY_FAIL':'1'});check('copy failure reported and source preserved',r,r.returncode==2 and (src/'owned.txt').read_text()=='synthetic')
 r=run('copy',src,workspace/'profiles/envpath',extra={'HFD_PROFILES':str(target)});check('profile env override refused',r,r.returncode==2)
 r=run('copy',src,workspace/'profiles/envworkspace',extra={'HFD_WORKSPACE':str(target)});check('workspace env override refused',r,r.returncode==2)
 for original in [0o700,0o750]:
  (root/'backups').chmod(original)
  r=run('block-backups');check(f'block spaced path exact {original:o}',r,r.returncode==0 and mode()==(original&~0o200))
  r=run('block-backups');check('repeated block refused',r,r.returncode==2 and mode()==(original&~0o200))
  record=active();r=run('unblock-backups',record);check(f'explicit recovery exact {original:o}',r,r.returncode==0 and mode()==original)
  r=run('unblock-backups',record);check('same-operation repeated recovery',r,r.returncode==0 and mode()==original)
 for args,name in [(['copy',src/'owned.txt',workspace/'profiles/loose'],'loose file refused'),(['copy',workspace/'profiles/missing',workspace/'profiles/missing-out'],'missing source refused'),(['copy',src,workspace/'profiles/absent/dest'],'missing parent refused'),(['unknown'],'unknown command refused')]:
  r=run(*args);check(name,r,r.returncode==2)
 r=run('help');check('help succeeds',r,r.returncode==0)
 r=run('copy',src,workspace/'profiles/wrongname',extra={'MOCK_ACCOUNT':'other'});check('wrong account name refused',r,r.returncode==2)
 r=run('copy',src,workspace/'profiles/group-missing',extra={'MOCK_GROUP':'127'});check('unavailable account inspector refused',r,r.returncode==2)
 old_record=active();run('new-run','run-B');b={'HFD_RUN_ID':'run-B','HFD_EVID':str(workspace/'evidence/run-B')}
 (root/'backups').chmod(0o750);run('block-backups',extra=b)
 r=run('unblock-backups',old_record,extra=b);check('cross-run record refuses and preserves 0550',r,r.returncode==2 and mode()==0o550)
 current=active('run-B'); original=current.read_text()
 for desc,content in [('missing run',original.replace('RUN_ID=run-B\n','')),('duplicate run',original+'RUN_ID=run-B\n'),('wrong operation',original.replace('OP_ID=backup-','OP_ID=wrong-')),('missing identity','\n'.join(x for x in original.splitlines() if not x.startswith('DEV_INO='))+'\n'),('invalid octal',original.replace('ORIGINAL_MODE=750','ORIGINAL_MODE=999'))]:
  current.write_text(content);r=run('unblock-backups',current,extra=b);check(desc+' refusal preserves mode',r,r.returncode==2 and mode()==0o550);current.write_text(original)
 r=run('unblock-backups',current,extra=b);check('interrupted operation explicit resume restores 0750',r,r.returncode==0 and mode()==0o750)
 run('block-backups',extra=b);record=active('run-B');(root/'backups').rename(root/'backups-preserved');(root/'backups').mkdir();(root/'backups').chmod(0o550)
 r=run('unblock-backups',record,extra=b);check('replacement inode refuses',r,r.returncode==2 and mode()==0o550)
 # The actual distributed file has no substitutions and must refuse despite old test switches.
 production_env=dict(os.environ,_HFD_TEST_TOOLS_DIR=str(tools),_HFD_TEST_ROOT=str(root),PATH=str(tools)+':'+os.environ['PATH'],HFD_WORKSPACE=str(workspace),HFD_PROFILES=str(workspace/'profiles'))
 r=subprocess.run(['/bin/bash',str(source),'copy',str(src),str(workspace/'profiles/bypass')],env=production_env,capture_output=True,text=True)
 check('actual production entry cannot impersonate uid/root via environment',r,r.returncode==2 and not (workspace/'profiles/bypass').exists())
finally:
 for p in [root/'backups',root/'backups-preserved']:
  if p.exists():p.chmod(0o700)
 shutil.rmtree(scratch)
print(json.dumps({'passed':sum(x['pass_'] for x in results),'failed':sum(not x['pass_'] for x in results),'results':results},indent=2));raise SystemExit(0 if all(x['pass_'] for x in results) else 1)
