"""Reproduce P54-02 nonproduction probes. Requires existing locked repo deps and a verified MiniSearch archive; runs no install hooks."""
import argparse, base64, datetime, gzip, hashlib, io, json, os, platform, re, shutil, subprocess, tarfile, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--scratch', type=Path, required=True, help='new directory; existing output is refused')
parser.add_argument('--archive', type=Path, required=True, help='minisearch-7.2.0.tgz from the frozen registry record')
parser.add_argument('--sdk', type=Path, required=True)
args = parser.parse_args()
repo, root, sources = args.repo.resolve(), args.scratch.resolve(), Path(__file__).resolve().parent
if root.exists(): raise SystemExit('scratch must be a NEW directory; preserve previous receipts')
if not args.sdk.is_dir(): raise SystemExit('explicit SDK directory does not exist')
raw = args.archive.read_bytes()
expected = 'dqT2XBYUOZOiC5t2HRnwADjhNS2cecp9u+TJRiJ1Qp/f5qjkeT5APcGPjHw+bz89Ms8Jp+cG4AlE+QZ/QnDglg=='
if base64.b64encode(hashlib.sha512(raw).digest()).decode() != expected: raise SystemExit('MiniSearch7.2.0 archive integrity mismatch')
root.mkdir(parents=True)
(root/'.p54-search-evaluation-owned').write_text('Synthetic data and disposable outputs only. No application profile access.\n')
for name in ['make-corpus.mjs', 'search-node-probe.mjs', 'local_search_probe.rs']: shutil.copyfile(sources/name, root/name)
with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tar:
    for name in ['package/dist/es/index.js', 'package/LICENSE.txt', 'package/package.json']:
        item = tar.getmember(name)
        if not item.isfile(): raise SystemExit('archive member must be a regular file')
        target = root/name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(tar.extractfile(item).read())
env = os.environ.copy(); env['SDKROOT'] = str(args.sdk.resolve())
protected = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']
before = {name: hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in protected}
example = repo/'src-tauri/examples/local_search_probe.rs'
if example.exists(): raise SystemExit('refusing to overwrite an existing example')
example.parent.mkdir(exist_ok=True)
example.write_bytes((root/'local_search_probe.rs').read_bytes())
try:
    with (root/'native-build.log').open('w') as log:
        result = subprocess.run(['cargo','build','--locked','--manifest-path','src-tauri/Cargo.toml','--example','local_search_probe'], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
    (root/'native-build.exit').write_text(str(result.returncode)+'\n')
    if result.returncode: raise RuntimeError('native probe build failed; receipt preserved')
    binary = root/'native-search-probe'
    shutil.copyfile(repo/'src-tauri/target/debug/examples/local_search_probe', binary); binary.chmod(0o700)
finally:
    if example.exists() and example.read_bytes() == (root/'local_search_probe.rs').read_bytes(): example.unlink()
    try: example.parent.rmdir()
    except OSError: pass

def check(name, command, measured=True):
    with (root/(name+'.json')).open('w') as out, (root/(name+'.time.log')).open('w') as err:
        result = subprocess.run((['/usr/bin/time','-l'] if measured else [])+list(map(str,command)), cwd=repo, env=env, stdout=out, stderr=err)
    (root/(name+'.exit')).write_text(str(result.returncode)+'\n')
    if result.returncode: raise RuntimeError(name+' failed; preserve raw logs')
    value = json.loads((root/(name+'.json')).read_text())
    match = re.search(r'(\d+)\s+maximum resident set size',(root/(name+'.time.log')).read_text())
    if isinstance(value, dict): value['processPeakRssBytes'] = int(match.group(1)) if match else None
    return value

runtime = {'os':platform.platform(),'architecture':platform.machine(),'cpu':subprocess.check_output(['/usr/sbin/sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),'memoryBytes':int(subprocess.check_output(['/usr/sbin/sysctl','-n','hw.memsize'],text=True)),'loadBefore':os.getloadavg(),'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'mode':'Cargo debug native + Node22; synthetic all-match query microbenchmark, not native painted interaction','startedUnix':time.time(),'node':subprocess.check_output(['node','--version'],env=env,text=True).strip()}
(root/'runtime.json').write_text(json.dumps(runtime,indent=2)+'\n')
subprocess.run(['node',str(root/'make-corpus.mjs'),str(root/'corpus')],cwd=repo,env=env,check=True)
check('sqljs-capability',['node',root/'search-node-probe.mjs','capability',repo])
check('native-capability',[binary,'capability'])
check('pdf-extraction',[binary,'extraction'])
results=[]
for materials in [100,1000,10000]:
    for repetition in range(1,4):
        corpus = root/'corpus'/f'corpus-{materials}.json'
        for engine in ['native','mini']:
            name=f'{engine}-{materials}-{repetition}'
            command=[binary,'bench',corpus,root/f'{name}.sqlite'] if engine=='native' else ['node','--expose-gc',root/'search-node-probe.mjs','mini',repo,corpus]
            results.append({'materials':materials,'repetition':repetition,**check(name,command)})
            print(name,'okay',flush=True)
(root/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
checks=[]
for n in [100,1000,10000]:
    for repetition in range(1,4):
        pair=[v for v in results if v['materials']==n and v['repetition']==repetition]
        first,second=pair
        for q in ['crosswind','density altitude','metar','café']:
            a=next(v for v in first['search'] if v['query']==q);b=next(v for v in second['search'] if v['query']==q)
            assert (a['hits'],a['idsSha256'])==(b['hits'],b['idsSha256']), (n,repetition,q)
        # Default tokenizers intentionally differ on accent folding; record, don't silently normalize.
        a=next(v for v in first['search'] if v['query']=='cafe');b=next(v for v in second['search'] if v['query']=='cafe')
        assert a['hits']>0 and b['hits']==0
        checks.append({'materials':n,'repetition':repetition,'fourExactResultSetsEqual':True,'accentFoldingDifference':{'fts5':a['hits'],'miniSearch':b['hits']}})
(root/'semantic-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
esm=(root/'package/dist/es/index.js').read_bytes()
(root/'package-size.json').write_text(json.dumps({'version':'7.2.0','esmBytes':len(esm),'esmGzipBytes':len(gzip.compress(esm,mtime=0)),'sha256':hashlib.sha256(esm).hexdigest(),'notProductionBundleDelta':True},indent=2)+'\n')
after={name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in protected}
assert before==after
(root/'preservation.json').write_text(json.dumps({'protectedInputsUnchanged':before,'temporaryExampleRemoved':not example.exists(),'applicationProfileAccessed':False,'productionDependencyAdded':False},indent=2)+'\n')
print('PASS:18 engine runs;36 matching query-result-set checks;9 documented accent differences; temporary example removed',flush=True)
