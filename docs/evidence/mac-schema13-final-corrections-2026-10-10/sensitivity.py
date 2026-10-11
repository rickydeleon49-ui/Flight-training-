import pathlib,tempfile,subprocess,json,shutil
PACK=pathlib.Path(__file__).resolve().parent;NODE='/opt/homebrew/opt/node@22/bin/node';results=[]
mutants=[
 ('R9-account', 'operator', '[ "$uid" = "$APPROVED_UID" ] && [ "$name" = "$APPROVED_ACCOUNT" ] && [ "$resolved" = "$APPROVED_UID" ] || die \'must run as uid 502 (hfdtest)\'', ':'),
 ('R9-run-binding','operator', '[ -z "$requested" ] || [ "$requested" = "$record" ] || die \'record is not this run’s active operation\'', ':'),
 ('R10-complete-facts','helper','if (p.length === 0) p.push(...validateCompleteFacts(snap));','// reverted completeness validation'),
 ('R10-checksum','helper','migration.checksum.v.toLowerCase() !== MIGRATION13_CHECKSUM','false'),
 ('R11-mounted-hash','installer',"if(hash(binary)!==c.exe)throw Error('mounted executable hash mismatch; nothing copied');",'// reverted mounted hash gate'),
 ('R11-detach','installer',"const r=await tool(TOOLS.image,['detach',mount]);","const r={code:0}; // reverted detach"),
]
for name,kind,old,new in mutants:
 scratch=pathlib.Path(tempfile.mkdtemp(prefix='hfd-revert-')).resolve()
 try:
  if kind=='helper':
   p=scratch/'helper.mjs';s=pathlib.Path('scripts/mac-schema13-profile-snapshot.mjs').read_text();assert old in s;p.write_text(s.replace(old,new));args=[NODE,str(PACK/'helper-regressions.mjs'),str(p)]
  else:
   script='hfd-operator.sh' if kind=='operator' else 'hfd-install-candidate.mjs';test='operator-tests.py' if kind=='operator' else 'install-tests.py'
   s=(PACK/script).read_text();assert old in s;(scratch/script).write_text(s.replace(old,new));shutil.copyfile(PACK/test,scratch/test);args=['python3',str(scratch/test)]
  r=subprocess.run(args,capture_output=True,text=True);report=json.loads(r.stdout);failures=[x['name'] for x in report['results'] if not x.get('pass',x.get('pass_',False))]
  results.append(dict(mutation=name,exit=r.returncode,flipped=r.returncode!=0 and bool(failures),failingAssertions=failures,stderr=r.stderr))
 finally:shutil.rmtree(scratch)
print(json.dumps({'total':len(results),'allFlippedToFail':all(r['flipped'] for r in results),'results':results},indent=2));raise SystemExit(0 if all(r['flipped'] for r in results) else 1)
