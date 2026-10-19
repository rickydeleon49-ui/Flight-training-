#!/usr/bin/env python3
"""Freeze OFFLINE-02a corpora and independent expected hits BEFORE timing.
Inputs: hash-recorded FAA worker frames; output corpora stay outside Git.
Python's reference scan never executes SQLite/FTS. Fixed seed and schedule.
"""
import argparse,collections,hashlib,json,math,random,re,unicodedata
from pathlib import Path
SEED=20261019

def canonical(s):
    return ''.join(' ' if unicodedata.category(c)=='Cc' else c for c in unicodedata.normalize('NFKC',s) if c not in '\ue000\ue001')
def tokens(s):
    # Selected query vocabulary is ASCII. unicode61 folds Latin accents but
    # does not casefold sharp-s or split an unspaced CJK run.
    s=''.join(c for c in unicodedata.normalize('NFD',canonical(s).lower()) if unicodedata.category(c)!='Mn')
    return re.findall(r'[^\W_]+',s,re.UNICODE)
def hit(ts,q):
    terms=re.findall(r'"([^"]+)"|(\S+)',q)
    return all(any(ts[i:i+len(w)]==w for i in range(len(ts)-len(w)+1)) for a,b in terms if (w:=tokens(a or b)))
def sha(b):return hashlib.sha256(b).hexdigest()
def dump(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n')
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--frames',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--manifest',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    inputs=json.loads((a.frames/'inputs.json').read_text());real=[]
    for entry in inputs['entries']:
        raw=(a.frames/(entry['name']+'.ndjson')).read_bytes();assert sha(raw)==entry['framesSha256']
        frames=[json.loads(l) for l in raw.splitlines()];pages=[{'index':f['index'],'outcome':f['outcome'],'text':canonical(f['text'])} for f in frames if f['type']=='page']
        real.append((entry,pages))
    phak=real[0][1];readable=[p for p in phak if p['outcome']=='text'];freq=collections.Counter();occ=collections.Counter();lengths=[]
    for p in readable:
        ts=tokens(p['text']);freq.update(ts);occ.update(set(ts));lengths.append(len(ts))
    rare='isogonic' if 1<=occ['isogonic']<=3 else min(w for w,n in occ.items() if 1<=n<=3 and w.isascii() and w.isalpha() and len(w)<=64)
    vocab=sorted(freq);weights=[freq[w] for w in vocab];rng=random.Random(SEED)
    corpora=[]
    def emit(name,docs):
        directory=a.out/name;directory.mkdir(exist_ok=True);records=[];meta=[]
        for i,(title,pages,original_sha) in enumerate(docs,1):
            body=json.dumps(pages,ensure_ascii=False,separators=(',',':')).encode();digest=sha(body)
            record={'id':f'doc{i:03}','title':title,'sha256':digest,'sourceSha256':original_sha,'pages':pages};records.append(record)
            meta.append({k:v for k,v in record.items() if k!='pages'}|{'pages':len(pages),'textPages':sum(p['outcome']=='text' for p in pages)})
        lines=b''.join((json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n').encode() for d in records);(directory/'documents.ndjson').write_bytes(lines)
        materials=[{'id':d['id'],'title':d['title'],'sha256':d['sha256'],'pages':len(d['pages'])} for d in records]
        if name.startswith('scaled'):
            materials.append({'id':'doc001-copy','title':'Generated handbook 01 (copy)','sha256':records[0]['sha256'],'pages':500})
        ids=sorted(m['id'] for m in materials);filters={'all':ids,'one':[records[0]['id']],'quarter':ids[::4]}
        corpus_freq=collections.Counter(t for d in records for p in d['pages'] if p['outcome']=='text' for t in tokens(p['text']))
        worst=min(corpus_freq,key=lambda w:(-corpus_freq[w],w))
        queries=['aircraft',rare,'"density altitude"','wind shear final approach runway landing pilot airspeed','zzqxv',worst]
        # Freeze independent expectations once, with no FTS involved.
        indexed=[(d['sha256'],p['index'],tokens(p['text'])) for d in records for p in d['pages'] if p['outcome']=='text']
        expected={}
        for filt,selected in filters.items():
            hashes={m['sha256'] for m in materials if m['id'] in selected}
            for qi,q in enumerate(queries):expected[f'{filt}:{qi}']=sorted([h,p] for h,p,ts in indexed if h in hashes and hit(ts,q))
        dump(directory/'expected.json',expected)
        c={'name':name,'materials':materials,'documents':meta,'filters':filters,'queries':queries,'schedule':[{'filter':f,'query':i,'warmups':3,'samples':15} for f in filters for i in range(6)],'canonicalBytes':sum(len(p['text'].encode()) for d in records for p in d['pages'] if p['outcome']=='text'),'textPages':len(indexed),'documentsSha256':sha(lines),'expectedSha256':sha((directory/'expected.json').read_bytes())}
        dump(directory/'manifest.json',c);corpora.append(c)
        print(name,len(indexed),flush=True)
    emit('phak',[('PHAK',phak,real[0][0]['sha256'])])
    emit('afh',[(entry['name'],pages,entry['sha256']) for entry,pages in real[1:]])
    for size in (1000,10000,30000):
        docs=[]
        for doc in range(size//500):
            pages=[{'index':i+1,'outcome':'text','text':' '.join(rng.choices(vocab,weights=weights,k=rng.choice(lengths)))} for i in range(500)]
            docs.append((f'Generated handbook {doc+1:02}',pages,None))
        emit(f'scaled-{size}',docs)
    manifest={'seed':SEED,'generatorSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,'rareWord':rare,'referenceFixtures':{'café':'cafe','ﬁnal':'final','ＡＢＣ':'abc','½':'1 2','㎏':'kg','straße':'straße','气象':'气象'},'freshProcesses':3,'percentiles':'nearest-rank','concurrency':{'corpus':'scaled-10000','filter':'all','queryIndex':0,'worker':'PHAK','start':'first page frame','sampleEndBefore':['end frame','publish transaction'],'requiredSamples':15,'maxRuns':5,'incomplete':'NOT MEASURED'},'targets':{'phakIndexMs':1000,'rebuild10000Ms':5000,'validate30000Ms':1000,'p50_10000Ms':20,'p95_10000Ms':50,'p95_30000Ms':150,'worstP95Ms':2000,'concurrentP95Ms':100,'reopen10000Ms':300,'responseBytes':65536,'indexStorageRatio':1.0,'rss30000Bytes':268435456},'corpora':corpora}
    dump(a.manifest,manifest)
if __name__=='__main__':main()
