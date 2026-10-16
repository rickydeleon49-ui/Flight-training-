from pathlib import Path
import sqlite3,subprocess,json,hashlib,sys,datetime
r=Path('/Users/rickymac/Library/Application Support/com.herflightdeck.app'); e=Path(__file__).parent
assert subprocess.run(['pgrep','-x','her-flight-deck'],capture_output=True).returncode==1,'App must be stopped'
c=sqlite3.connect((r/'her-flight-deck.db').as_uri()+'?mode=ro',uri=True)
def norm(v):return {'hex':v.hex()} if isinstance(v,bytes) else v
tables={}
for (t,) in c.execute("select name from sqlite_master where type='table' order by name"):
 rows=[[norm(x) for x in row] for row in c.execute('select * from "'+t.replace('"','""')+'"')]
 tables[t]={'columns':[x[1] for x in c.execute('pragma table_info("'+t+'")')], 'rows':sorted(rows,key=lambda x:json.dumps(x,sort_keys=True))}
obj={'at':datetime.datetime.now().astimezone().isoformat(),'uid':r.stat().st_uid,'inode':r.stat().st_ino,'tables':tables,'schema':list(c.execute("select type,name,tbl_name,sql from sqlite_master order by type,name")),'documents':{str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (r/'documents').rglob('*') if p.is_file()}}
p=e/(sys.argv[1]+'.json');assert not p.exists();p.write_text(json.dumps(obj,indent=2)+'\n');print(p);print({t:len(v['rows']) for t,v in tables.items() if len(v['rows'])})
