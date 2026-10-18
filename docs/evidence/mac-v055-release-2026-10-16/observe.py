"""Bounded restore observer. Logs, with ms UTC timestamps, every her-flight-deck PID and its
executable path, its on-screen windows (window server, not accessibility) and the frontmost app.
When armed, it activates Claude the moment a restore is staged (or a new PID appears), once,
so the restart happens while another app is frontmost.
usage: observe.py OUT.jsonl SECONDS ARMED(0/1)"""
import subprocess,json,sys,time,datetime,os,pathlib
out,dur,armed=sys.argv[1],float(sys.argv[2]),sys.argv[3]=='1'
tools='/Users/rickymac/.codex/task-recovery/v054-final-candidate-20261015/tools'
root=pathlib.Path.home()/'Library/Application Support/com.herflightdeck.app'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def pids():
    r=subprocess.run(['pgrep','-x','her-flight-deck'],capture_output=True,text=True).stdout.split(); return [int(p) for p in r]
def exe(p):
    r=subprocess.run(['ps','-o','comm=','-p',str(p)],capture_output=True,text=True).stdout.strip(); return r
def wins(p):
    try: d=json.loads(subprocess.run([tools+'/windows',str(p)],capture_output=True,text=True,timeout=3).stdout)
    except Exception as e: return 'error:'+str(e)
    return [w['number'] for w in d['windows'] if w['onscreen'] and w['bounds'].get('Height',0)>100]
def front():
    try: return json.loads(subprocess.run([tools+'/front'],capture_output=True,text=True,timeout=3).stdout)
    except Exception as e: return {'error':str(e)}
f=open(out,'a'); end=time.time()+dur; first=None; fired=False
while time.time()<end:
    ps=pids()
    if first is None and ps: first=set(ps)
    staged=[n for n in ('.restore-staging','.restore-pending','restore-journal.json') if (root/n).exists()]
    ev={'t':now(),'pids':[{'pid':p,'exe':exe(p),'onscreenWindows':wins(p)} for p in ps],'front':front(),'staged':staged}
    if armed and not fired and (staged or (first is not None and set(ps)-first)):
        subprocess.run(['osascript','-e','tell application "Claude" to activate'])
        fired=True; ev['action']='activated Claude'; ev['frontAfterAction']=front(); ev['tAfterAction']=now()
    f.write(json.dumps(ev)+'\n'); f.flush(); time.sleep(0.15)
f.write(json.dumps({'t':now(),'end':True})+'\n')
