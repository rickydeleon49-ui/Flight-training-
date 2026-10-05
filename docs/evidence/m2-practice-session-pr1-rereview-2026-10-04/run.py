from pathlib import Path
import subprocess,os,json,hashlib
root=Path('/Users/rickymac/code/Flight-training-pr70-integration');out=Path('/private/tmp/m2-pr1-rereview');backup=root/'src-tauri/src/backup.rs';original=backup.read_bytes();test=root/'src/data/codex-diagnostic.test.ts';assert not test.exists()
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:'+env['PATH'];env['SDKROOT']='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk';results={}
paths=subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=root,text=True).splitlines()+subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=root,text=True).splitlines();paths=sorted(set(p for p in paths if p.startswith(('src/','src-tauri/'))))
hashes={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths};(out/'source-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
try:
 test.write_bytes((root/'docs/evidence/m2-practice-session-pr1-review-2026-10-04/codex-diagnostic.test.ts').read_bytes())
 with (out/'focused-frontend.txt').open('w') as log:results['frontend_exit']=subprocess.run(['npx','vitest','run','src/data/codex-diagnostic.test.ts','src/data/practiceSessionContract.test.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
 test.unlink()
 backup.write_bytes(original+b'\n'+(root/'docs/evidence/m2-practice-session-pr1-review-2026-10-04/codex_backup_diagnostic.rs').read_bytes()+b'\n'+(out/'additional.rs').read_bytes())
 with (out/'focused-native.txt').open('w') as log:results['native_exit']=subprocess.run(['cargo','test','--manifest-path','src-tauri/Cargo.toml','--locked','--lib','--','codex_m2_','practice_sessions::tests','--test-threads=1'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
finally:
 backup.write_bytes(original);test.unlink(missing_ok=True);results['all_source_restored']=all(hashlib.sha256((root/p).read_bytes()).hexdigest()==d for p,d in hashes.items());(out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
