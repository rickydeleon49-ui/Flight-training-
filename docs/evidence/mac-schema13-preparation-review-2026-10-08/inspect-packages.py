import subprocess,pathlib,json,hashlib
out=pathlib.Path('/tmp/mac-schema13-review');root=pathlib.Path('/Users/rickymac/code/.qwen/tmp/schema13-candidates')
results=[]
for name in ['NEW-schema13-36a7b39.dmg','OLD-schema12-2a6a415.dmg']:
 mount=out/name.removesuffix('.dmg');mount.mkdir(exist_ok=True)
 attach=subprocess.run(['hdiutil','attach','-readonly','-nobrowse','-mountpoint',str(mount),str(root/name)],capture_output=True,text=True);(out/(name+'.attach.txt')).write_text(attach.stdout+attach.stderr);assert attach.returncode==0
 try:
  app=mount/'Her Flight Deck.app';exe=app/'Contents/MacOS/her-flight-deck';commands=[('exe-verify',['codesign','--verify','--strict','--verbose=4',str(exe)]),('bundle-verify',['codesign','--verify','--deep','--strict','--verbose=4',str(app)]),('signature',['codesign','-dv','--verbose=4',str(exe)]),('arch',['lipo','-archs',str(exe)])];data={'dmg':name,'dmg_sha256':hashlib.sha256((root/name).read_bytes()).hexdigest(),'exe_sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),'checks':[]}
  for label,args in commands:
   p=subprocess.run(args,capture_output=True,text=True);(out/(name+'.'+label+'.txt')).write_text(p.stdout+p.stderr);data['checks'].append({'check':label,'exit':p.returncode,'output':p.stdout+p.stderr})
  results.append(data);print(json.dumps(data),flush=True)
 finally:
  subprocess.run(['hdiutil','detach',str(mount)],check=True,stdout=subprocess.DEVNULL)
(out/'package-results.json').write_text(json.dumps(results,indent=2)+'\n')
