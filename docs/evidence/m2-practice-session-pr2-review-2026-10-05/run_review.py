from pathlib import Path
import subprocess,hashlib,json,os,shutil,sys
root=Path('/Users/rickymac/code/Flight-training-pr70-integration')
out=Path('/private/tmp/m2-pr2-review-evidence');out.mkdir(exist_ok=True)
manifest=root/'docs/evidence/m2-practice-session-pr2-ui-2026-10-05/SHA256SUMS'
before={line.split('  ',1)[1]:line.split('  ',1)[0] for line in manifest.read_text().splitlines()}
assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in before.items())
target=root/'src/pages/StudyLibrary/codex-pr2-review.test.ts'
assert not target.exists()
shutil.copy2('/private/tmp/m2-pr2-review.test.ts',target)
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:'+env['PATH'];env['SDKROOT']='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
commands=[('frontend',['npx','vitest','run',str(target.relative_to(root)),'src/pages/StudyLibrary/PracticeSessionPR2.test.ts','src/data/practiceSessionContract.test.ts','src/data/practiceStartupValidation.test.ts']),('native',['cargo','test','--manifest-path','src-tauri/Cargo.toml','--locked','--lib','req_erase_history','--','--test-threads=1'])]
result={}
if '--frontend-only' in sys.argv:
 commands=commands[:1]
try:
 for name,command in commands:
  with (out/(name+'.txt')).open('w') as log:
   log.write('$ '+' '.join(command)+'\n');log.flush()
   code=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
  result[name]={'command':command,'exit':code}
  print(name,code,flush=True)
finally:
 target.unlink()
 result['source_unchanged']=all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in before.items())
 (out/'results.json').write_text(json.dumps(result,indent=2)+'\n')
 (out/'source-hashes.json').write_text(json.dumps(before,indent=2)+'\n')
shutil.copy2('/private/tmp/m2-pr2-review.test.ts',out/'codex-pr2-review.test.ts')
