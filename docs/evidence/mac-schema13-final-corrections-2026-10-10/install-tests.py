"""Scratch-only constant substitutions; actual production checks/copy/cleanup remain intact."""
import pathlib,tempfile,subprocess,json,os,shutil,hashlib,pwd,signal,time
PACK=pathlib.Path(__file__).resolve().parent
NODE='/opt/homebrew/opt/node@22/bin/node'
source=(PACK/'hfd-install-candidate.mjs').read_text();results=[]
def case(name,variant):
 scratch=pathlib.Path(tempfile.mkdtemp(prefix='hfd-install-test-')).resolve()
 workspace=scratch/'Downloads/workspace';evidence=workspace/'evidence/run-A';evidence.mkdir(parents=True)
 apps=scratch/'Applications';apps.mkdir();kit=scratch/'kit';(kit/'installers').mkdir(parents=True)
 payload=scratch/'payload/Her Flight Deck.app/Contents/MacOS';payload.mkdir(parents=True);exe=payload/'her-flight-deck';exe.write_bytes(b'SYNTHETIC EXECUTABLE')
 role='OLD' if variant=='old-success' else 'NEW'
 dmg=kit/('installers/OLD-schema12-2a6a415-adhoc.dmg' if role=='OLD' else 'installers/NEW-schema13-36a7b39-adhoc.dmg');dmg.write_bytes(b'SYNTHETIC DMG')
 trace=scratch/'trace';tools=scratch/'tools';tools.mkdir()
 image=tools/'hdiutil';image.write_text('''#!/usr/bin/env python3
import sys,pathlib,shutil,os
args=sys.argv[1:]; trace=pathlib.Path(os.environ['TRACE']);trace.open('a').write(args[0]+'\\n')
if args[0]=='attach':
 mount=pathlib.Path(args[args.index('-mountpoint')+1]);shutil.copytree(os.environ['PAYLOAD'],mount/'Her Flight Deck.app')
 if os.environ.get('BAD_MOUNT')=='1': (mount/'Her Flight Deck.app/Contents/MacOS/her-flight-deck').write_bytes(b'WRONG')
 if os.environ.get('ATTACH_FAIL')=='1':sys.exit(1)
else:
 for p in pathlib.Path(args[1]).iterdir(): shutil.rmtree(p) if p.is_dir() else p.unlink()
''');image.chmod(0o755)
 copy=tools/'copy';copy.write_text('''#!/bin/bash
printf 'copy\\n' >> "$TRACE"
if [ "${COPY_FAIL:-0}" = 1 ]; then exit 1; fi
if [ "${COPY_HOLD:-0}" = 1 ]; then sleep 30; fi
/bin/cp "$@"
if [ "${BAD_COPY:-0}" = 1 ]; then printf WRONG > "$3/Her Flight Deck.app/Contents/MacOS/her-flight-deck"; fi
''');copy.chmod(0o755)
 group=tools/'group';group.write_text('#!/bin/bash\nexit "${GROUP_STATUS:-1}"\n');group.chmod(0o755)
 pgrep=tools/'pgrep';pgrep.write_text('#!/bin/bash\nexit "${PGREP_STATUS:-1}"\n');pgrep.chmod(0o755)
 script=source.replace('uid:502',f'uid:{os.getuid()}').replace("account:'hfdtest'",f"account:'{pwd.getpwuid(os.getuid()).pw_name}'")
 for old,new in [('/Users/hfdtest/Downloads/hfd-schema13-workspace',str(workspace)),('/Users/hfdtest/Applications',str(apps)),('/Users/Shared/hfd-schema13-kit-2026-10-08',str(kit)),('/usr/bin/hdiutil',str(image)),('/bin/cp',str(copy)),('/usr/sbin/dseditgroup',str(group)),('/usr/bin/pgrep',str(pgrep)),('b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334',hashlib.sha256(dmg.read_bytes()).hexdigest()),('824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28',hashlib.sha256(exe.read_bytes()).hexdigest()),('ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62',hashlib.sha256(dmg.read_bytes()).hexdigest()),('2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a',hashlib.sha256(exe.read_bytes()).hexdigest())]:script=script.replace(old,new)
 op=scratch/'install.mjs';op.write_text(script)
 env=dict(os.environ,HFD_RUN_ID='run-A',TRACE=str(trace),PAYLOAD=str(scratch/'payload/Her Flight Deck.app'))
 target=apps/('HFD-OLD-2a6a415' if role=='OLD' else 'HFD-NEW-36a7b39')
 if variant=='bad-dmg':dmg.write_bytes(b'WRONG DMG')
 if variant=='bad-mount':env['BAD_MOUNT']='1'
 if variant=='copy-fail':env['COPY_FAIL']='1'
 if variant=='bad-copy':env['BAD_COPY']='1'
 if variant=='attach-fail':env['ATTACH_FAIL']='1'
 if variant=='admin':env['GROUP_STATUS']='0'
 if variant=='group-error':env['GROUP_STATUS']='2'
 if variant=='process-error':env['PGREP_STATUS']='2'
 if variant=='existing-receipt':(evidence/'install-NEW.json').write_text('KEEP')
 if variant=='existing':target.mkdir();(target/'preserved').write_text('KEEP')
 if variant=='dangling':target.symlink_to(scratch/'absent',target_is_directory=True)
 if variant=='symlink-parent':apps.rmdir();apps.symlink_to(scratch/'Downloads',target_is_directory=True)
 if variant=='interrupt':env['COPY_HOLD']='1'
 p=subprocess.Popen([NODE,str(op),role],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 if variant=='interrupt':
  for _ in range(100):
   if trace.exists() and 'copy' in trace.read_text():break
   time.sleep(.02)
  p.send_signal(signal.SIGTERM)
 out,err=p.communicate(timeout=40)
 calls=trace.read_text().splitlines() if trace.exists() else []
 mounted=list(evidence.glob('mount-*'))
 passed=p.returncode==(0 if variant in ['success','old-success'] else 2) and not mounted
 if variant in ['bad-dmg','admin','group-error','process-error','existing','dangling','symlink-parent','existing-receipt']:passed=passed and not calls
 else:passed=passed and 'detach' in calls
 if variant in ['bad-dmg','bad-mount','attach-fail','admin','group-error','process-error','existing','dangling','symlink-parent','existing-receipt']:passed=passed and 'copy' not in calls
 if variant=='existing':passed=passed and (target/'preserved').read_text()=='KEEP'
 if variant=='dangling':passed=passed and target.is_symlink()
 if variant in ['success','old-success']:passed=passed and (evidence/f'install-{role}.json').exists()
 results.append(dict(name=name,pass_=bool(passed),exit=p.returncode,calls=calls,output=out+err))
 shutil.rmtree(scratch)
for variant in ['success','old-success','bad-dmg','bad-mount','copy-fail','bad-copy','attach-fail','admin','group-error','process-error','existing','dangling','symlink-parent','existing-receipt','interrupt']:case(variant,variant)
print(json.dumps({'passed':sum(r['pass_'] for r in results),'failed':sum(not r['pass_'] for r in results),'results':results},indent=2));raise SystemExit(0 if all(r['pass_'] for r in results) else 1)
