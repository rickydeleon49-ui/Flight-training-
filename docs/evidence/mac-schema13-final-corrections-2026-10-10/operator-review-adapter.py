"""Real shipped operator, environment-only probes, disposable reviewer-owned data.
No script edits, test account login or real profile access.
"""
import pathlib,tempfile,subprocess,json,os,shutil,stat
source=pathlib.Path('docs/evidence/mac-schema13-final-corrections-2026-10-10/hfd-operator.sh').resolve()
scratch=pathlib.Path(tempfile.mkdtemp(prefix='macv-extra-')).resolve()
tools=scratch/'tools';tools.mkdir()
for name,body in {'id':'case "$1" in -u) echo 502;; -un) echo hfdtest;; *) exit 2;; esac','dseditgroup':'exit 1','pgrep':'exit 1'}.items():
 p=tools/name;p.write_text('#!/bin/bash\n'+body+'\n');p.chmod(0o755)
profiles=scratch/'profiles';profiles.mkdir();evidence=scratch/'evidence';evidence.mkdir()
root=scratch/'unapproved Application Support/com.herflightdeck.app';(root/'backups').mkdir(parents=True);(root/'backups').chmod(0o700)
src=profiles/'source';src.mkdir();(src/'owned.txt').write_text('synthetic')
base=dict(os.environ,HFD_EVID=str(evidence/'run-A'),_HFD_TEST_TOOLS_DIR=str(tools),_HFD_TEST_ROOT=str(root),HFD_PROFILES=str(profiles),HFD_EVIDENCE_PARENT=str(evidence),HFD_WORKSPACE=str(scratch),HFD_RUN_ID='run-A')
results=[]
def run(*args,extra=None):
 env=dict(base,**(extra or {}));env['HFD_EVID']=str(evidence/env['HFD_RUN_ID'])
 return subprocess.run(['/bin/bash',str(source),*map(str,args)],capture_output=True,text=True,env=env)
def case(name,passed,r):results.append(dict(name=name,pass_=bool(passed),exit=r.returncode,output=r.stdout+r.stderr))
r=run('copy',src,profiles/'copied');case('shipped CLI environment cannot impersonate authorized uid and override roots',r.returncode==2 and not (profiles/'copied').exists(),r)
# Positive/recovery branches use a copied source with controlled constants/inspectors.
# The preceding no-bypass assertion ran the actual distributed entry, unchanged.
(evidence/'run-A').mkdir();(evidence/'run-B').mkdir()
stat_tool=tools/'stat';stat_tool.write_text('#!/bin/bash\nif [ "$2" = "%u" ]; then echo 502; else exec /usr/bin/stat "$@"; fi\n');stat_tool.chmod(0o755)
code=source.read_text().replace("APPROVED_ROOT='/Users/hfdtest/Library/Application Support/com.herflightdeck.app'",f"APPROVED_ROOT='{root}'").replace("WORKSPACE='/Users/hfdtest/Downloads/hfd-schema13-workspace'",f"WORKSPACE='{scratch}'")
for key,old,name in [('ID_BIN','/usr/bin/id','id'),('GROUP_BIN','/usr/sbin/dseditgroup','dseditgroup'),('PGREP_BIN','/usr/bin/pgrep','pgrep'),('STAT_BIN','/usr/bin/stat','stat')]:code=code.replace(f'{key}={old}',f'{key}={tools/name}')
source=scratch/'adapted-op.sh';source.write_text(code)
r=run('block-backups');case('control: environment adapter reaches positive backup block',r.returncode==0 and stat.S_IMODE((root/'backups').stat().st_mode)==0o500,r)
records=sorted((evidence/'run-A').glob('backup-*.txt'));old=records[0]
r=run('unblock-backups',old);case('control: explicit same-run restoration roundtrips',r.returncode==0 and stat.S_IMODE((root/'backups').stat().st_mode)==0o700,r)
(root/'backups').chmod(0o750)
run('block-backups',extra={'HFD_RUN_ID':'run-B'})
r=run('unblock-backups',old,extra={'HFD_RUN_ID':'run-B'});case('cross-run old record must refuse and preserve current blocked mode',r.returncode==2 and stat.S_IMODE((root/'backups').stat().st_mode)==0o550,r)
(root/'backups').chmod(0o700)
shutil.rmtree(scratch)
print(json.dumps({'actualUid':os.getuid(),'passed':sum(r['pass_'] for r in results),'failed':sum(not r['pass_'] for r in results),'results':results},indent=2));raise SystemExit(0 if all(r['pass_'] for r in results) else 1)
