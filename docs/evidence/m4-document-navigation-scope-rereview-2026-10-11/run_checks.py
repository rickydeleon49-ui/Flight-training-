from pathlib import Path
import subprocess,json
r=Path('/tmp/hfd-m4-corrections-rereview'); node='/opt/homebrew/opt/node@22/bin/node'
commands=[('submitted-suites',[node,'--test','--test-reporter=tap','docs/evidence/m4-document-navigation-eval-2026-10-11/proof/proof.test.mjs','docs/evidence/m4-document-navigation-eval-2026-10-11/proof/databaseVerification.test.mjs'],r/'submitted'),('frozen-current',[node,'--test','--test-reporter=tap','frozen-current.test.mjs'],r),('diagnostics',[node,'--test','--test-reporter=tap','diagnostics.test.mjs'],r),('python-probe',['python3','docs/evidence/m4-document-navigation-eval-2026-10-11/scripts/verify_schema_probe.py'],r/'submitted')]
results=[]
for name,cmd,cwd in commands:
 p=subprocess.run(cmd,cwd=cwd,capture_output=True,text=True);(r/f'{name}.txt').write_text(p.stdout+p.stderr);results.append({'name':name,'command':cmd,'cwd':str(cwd),'exit':p.returncode});print(name,p.returncode)
(r/'checks.json').write_text(json.dumps({'node':subprocess.check_output([node,'--version'],text=True).strip(),'checks':results},indent=2)+'\n')
