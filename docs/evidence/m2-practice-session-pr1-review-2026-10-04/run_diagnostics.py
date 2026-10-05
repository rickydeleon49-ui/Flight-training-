from pathlib import Path
import subprocess,os,hashlib,json
root=Path('/Users/rickymac/code/Flight-training-pr70-integration');out=Path('/private/tmp/m2-pr1-review')
backup=root/'src-tauri/src/backup.rs';before=backup.read_bytes();test=root/'src/data/codex-diagnostic.test.ts'
assert not test.exists()
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:'+env['PATH'];env['SDKROOT']='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
results={}
try:
 test.write_bytes((out/'codex-diagnostic.test.ts').read_bytes())
 with (out/'frontend-diagnostics.txt').open('w') as log:
  r=subprocess.run(['npx','vitest','run','src/data/codex-diagnostic.test.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT);results['frontend_exit']=r.returncode
 backup.write_bytes(before+b'\n'+(out/'codex_backup_diagnostic.rs').read_bytes())
 with (out/'native-diagnostics.txt').open('w') as log:
  r=subprocess.run(['cargo','test','--manifest-path','src-tauri/Cargo.toml','--locked','codex_m2_review','--','--nocapture'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT);results['native_exit']=r.returncode
finally:
 backup.write_bytes(before);test.unlink(missing_ok=True);results['backup_restored']=backup.read_bytes()==before
 (out/'diagnostic-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
