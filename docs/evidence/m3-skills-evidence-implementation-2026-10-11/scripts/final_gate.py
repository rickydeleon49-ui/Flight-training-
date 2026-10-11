import os,subprocess,pathlib,json,time,shutil,runpy
repo=pathlib.Path(__file__).resolve().parents[4]
base=repo/'docs/evidence/m3-skills-evidence-implementation-2026-10-11'
out=pathlib.Path(os.environ.get('M3_GATE_OUT', str(base/'final-gate-rerun')));out.mkdir(exist_ok=True)
env=dict(os.environ);env['PATH']='/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:'+env['PATH']
env['SDKROOT']=subprocess.check_output(['xcrun','--sdk','macosx','--show-sdk-path'],text=True).strip()
checks=[]
def check(name,cmd,extra=None):
    start=time.monotonic();e=env| (extra or {})
    with (out/(name+'.txt')).open('w') as f:
        f.write('$ '+ ' '.join(cmd)+'\n# cwd: '+str(repo)+'\n# SDKROOT: '+e['SDKROOT']+'\n');f.flush()
        r=subprocess.run(cmd,cwd=repo,env=e,stdout=f,stderr=subprocess.STDOUT)
        f.write('\n# exit='+str(r.returncode)+'\n')
    item={'name':name,'command':cmd,'exit':r.returncode,'seconds':round(time.monotonic()-start,2)}
    checks.append(item);(out/'summary.json').write_text(json.dumps(checks,indent=2)+'\n');print(name,r.returncode,flush=True)
    if r.returncode: raise SystemExit(r.returncode)
for name,cmd in [
 ('typecheck',['npm','run','typecheck']),
 ('focused',['npx','vitest','run','src/data/skillEvidenceBrowserDriver.test.ts','src/data/skillEvidenceTransaction.test.ts','src/state/skillEvidence','src/pages/FlightPath/skills']),
 ('frontend-all',['npm','test']),
 ('build',['npm','run','build']),
 ('rust-all',['cargo','test','--locked','--manifest-path','src-tauri/Cargo.toml']),
 ('clippy',['cargo','clippy','--locked','--manifest-path','src-tauri/Cargo.toml','--all-targets','--','-D','warnings']),
 ('fmt-check',['cargo','fmt','--manifest-path','src-tauri/Cargo.toml','--','--check']),
 ('cargo-lock',['npm','run','test:cargo-lock']),
 ('whitespace',['git','diff','--check']),
]: check(name,cmd)
