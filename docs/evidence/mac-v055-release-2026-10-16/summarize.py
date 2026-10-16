import json,sys
prev=None
for l in open(sys.argv[1]):
    d=json.loads(l)
    if d.get('end'): print(d['t'],'END'); break
    key=(tuple((p['pid'],str(p['onscreenWindows'])) for p in d['pids']),d['front'].get('frontName'),d['front'].get('frontPid'),tuple(d['staged']),d.get('action'))
    if key!=prev:
        print(d['t'],'pids',[(p['pid'],p['onscreenWindows']) for p in d['pids']],'front',d['front'].get('frontName'),d['front'].get('frontPid'),'staged',d['staged'],d.get('action',''),d.get('frontAfterAction',{}).get('frontName',''),d.get('tAfterAction',''))
        prev=key
