#!/usr/bin/env python3
"""Run the frozen release harness schedule and retain all raw outcomes."""
import argparse,hashlib,json,math,platform,re,subprocess,time
from pathlib import Path
HERE=Path(__file__).resolve().parent

def dump(p,obj):p.write_text(json.dumps(obj,indent=2)+'\n')
def percentile(values,p):return sorted(values)[max(0,math.ceil(len(values)*p)-1)]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--harness',type=Path,required=True);ap.add_argument('--corpora',type=Path,required=True);ap.add_argument('--worker',type=Path,required=True);ap.add_argument('--phak',type=Path,required=True);ap.add_argument("--tag",default="");a=ap.parse_args()
    freeze=json.loads((HERE/'frozen-manifest.json').read_text());assert hashlib.sha256((HERE/'generate.py').read_bytes()).hexdigest()==freeze['generatorSha256']
    out=HERE/('receipts'+('-'+a.tag if a.tag else ''));out.mkdir(exist_ok=True)
    def run(mode,directory,label,extra=()):
        cmd=['/usr/bin/time','-l',str(a.harness),mode,str(directory),*map(str,extra)]
        assert not (out/(label+'.stdout.txt')).exists(), 'never overwrite a receipt'
        started=time.time();r=subprocess.run(cmd,capture_output=True,timeout=900)
        (out/(label+'.stdout.txt')).write_bytes(r.stdout);(out/(label+'.stderr.txt')).write_bytes(r.stderr)
        dump(out/(label+'.exit.json'),{'command':cmd,'exit':r.returncode,'startedUnix':started,'endedUnix':time.time()})
        if r.returncode:raise RuntimeError(f'{label} exit {r.returncode}; preserved raw output')
        result=json.loads(r.stdout);match=re.search(rb'(\d+)\s+maximum resident set size',r.stderr);result['peakRssBytes']=int(match[1]) if match else None
        return result
    # Check the Python reference against the same frozen examples as bundled
    # FTS, before any timed command. No SQLite is used by this reference.
    from generate import tokens
    for source,expected in freeze['referenceFixtures'].items(): assert tokens(source)==tokens(expected)
    all_results=[]
    reference=run('reference',a.corpora/'phak','reference-fixtures')
    for corpus in freeze['corpora']:
        name=corpus['name'];directory=a.corpora/name
        assert hashlib.sha256((directory/'documents.ndjson').read_bytes()).hexdigest()==corpus['documentsSha256']
        assert hashlib.sha256((directory/'expected.json').read_bytes()).hexdigest()==corpus['expectedSha256']
        print('measuring',name,flush=True)
        setup=run('setup',directory,name+'-setup');audit=run('audit',directory,name+'-audit');processes=[run('bench',directory,f'{name}-process-{i}') for i in range(1,4)]
        cells=[]
        for f in ['all','one','quarter']:
            for qi,q in enumerate(corpus['queries']):
                rows=[s for p in processes for s in p['samples'] if s['filter']==f and s['queryIndex']==qi];assert len(rows)==45
                values=[s['ms'] for s in rows];cells.append({'filter':f,'query':q,'queryIndex':qi,'samples':45,'p50Ms':percentile(values,.50),'p95Ms':percentile(values,.95),'maxBytes':max(s['bytes'] for s in rows),'errors':[s['error'] for s in rows if s['error']]})
        all_results.append({'name':name,'setup':setup,'auditCases':len(audit['cases']),'processes':[{k:v for k,v in p.items() if k!='samples'} for p in processes],'cells':cells})
    concurrent=run('concurrent',a.corpora/'scaled-10000','concurrent-10000',extra=(a.worker,a.phak))
    accepted=next((r for r in concurrent['runs'] if r['accepted']),None)
    if accepted: concurrent['p95Ms']=percentile([s['ms'] for s in accepted['samples']],.95)
    result={'frozenManifestSha256':hashlib.sha256((HERE/'frozen-manifest.json').read_bytes()).hexdigest(),'harnessSha256':hashlib.sha256(a.harness.read_bytes()).hexdigest(),'workerSha256':hashlib.sha256(a.worker.read_bytes()).hexdigest(),'hardware':{'cpu':subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),'memoryBytes':int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True)),'macOS':subprocess.check_output(['sw_vers'],text=True),'python':platform.python_version()},'reference':reference,'results':all_results,'concurrent':concurrent,'targets':freeze['targets']}
    dump(HERE/('results'+('-'+a.tag if a.tag else '')+'.json'),result)
if __name__=='__main__':main()
