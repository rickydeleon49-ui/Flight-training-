import runpy,pathlib,os,sys
base=pathlib.Path(__file__).resolve().parents[1]
m=runpy.run_path(str(base/'scripts/run_sensitivity.py'));g=m['main'].__globals__
g['OUT']=pathlib.Path(os.environ.get('M3_SENSITIVITY_OUT', str(base/'sensitivity-rerun')));g['OUT'].mkdir(exist_ok=True)
original=g['run'];number=0
def recorded(tree,scratch,test):
 global number
 number+=1
 code,command,output=original(tree,scratch,test)
 (g['OUT']/f'raw-{number:02}.txt').write_text(f'$ {command}\n# cwd: {tree}\n'+output+f'\n# exit={code}\n')
 return code,command,output
g['run']=recorded
if len(sys.argv) != 2: raise SystemExit("usage: run_current_sensitivity.py <disposable-scratch-directory>")
scratch=pathlib.Path(sys.argv[1]).resolve();scratch.mkdir(parents=True,exist_ok=True)
sys.argv=['run_sensitivity.py',str(scratch)]
sys.exit(m['main']())
