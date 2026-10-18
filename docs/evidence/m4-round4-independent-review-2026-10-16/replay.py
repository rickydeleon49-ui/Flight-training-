import pathlib,subprocess,os,shutil,json,time
OUT=pathlib.Path(__file__).parent
SOURCE=pathlib.Path('/Users/rickymac/code/Flight-training-m4-round4')
GIT=pathlib.Path('/Users/rickymac/code/Flight-training-')
PACK='docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11'
PIN='e8720003a76be680812dfe3605d58e7eb6372d00'
results=[]
def run(label,args,cwd,env):
 t=time.monotonic(); p=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (OUT/(label+'.txt')).write_bytes(p.stdout)
 results.append({'label':label,'command':args,'cwd':str(cwd),'exit':p.returncode,'seconds':round(time.monotonic()-t,2)})
 (OUT/'replay.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(results[-1]),flush=True)
 return p.returncode
for lane,node in [('node22','/opt/homebrew/opt/node@22/bin/node'),('node26','/opt/homebrew/bin/node')]:
 env=os.environ.copy(); env['PATH']=str(pathlib.Path(node).parent)+':'+env['PATH']; env['npm_config_cache']=str(OUT/'npm-cache')
 env['M4_REVIEW_TARGET_PACK']=str(SOURCE/PACK)
 run(lane+'-frozen-diagnostics',[node,'--test','--test-reporter=tap','docs/evidence/m4-round3-senior-review-2026-10-11/diagnostics.test.mjs'],SOURCE,env)
 clone=OUT/(lane+'-disposable')
 if run(lane+'-clone',['git','clone','--shared','--quiet','--no-checkout',str(GIT),str(clone)],OUT,env): raise SystemExit(1)
 if run(lane+'-checkout',['git','checkout','--quiet','--detach','7e495580a48828c2c81cc4d8057e028acfc2a8eb'],clone,env): raise SystemExit(1)
 shutil.copytree(SOURCE/'docs',clone/'docs',dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','accepted-main','.DS_Store'))
 if run(lane+'-prepare',[node,PACK+'/scripts/prepare-accepted-main.mjs',PIN],clone,env): raise SystemExit(1)
 args=[node,PACK+'/scripts/run_integration_proof.mjs']
 if lane=='node22': args+=['--install']
 else:
  # Reuse bytes installed by the measured Node22 npm-ci step above; external log remains the real install receipt.
  shutil.copytree(OUT/'node22-disposable'/PACK/'scratch/pdfjs-engine/node_modules',clone/PACK/'scratch/pdfjs-engine/node_modules',symlinks=True)
 if run(lane+'-full-runner',args,clone,env):
  print((OUT/(lane+'-full-runner.txt')).read_text()[-2000:],flush=True)
  raise SystemExit(1)
