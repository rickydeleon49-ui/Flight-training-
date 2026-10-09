import subprocess, pathlib, json, hashlib, sys
# Mirrors the reviewer's inspect-packages.py exactly (same commands, same read-only mount,
# detach in all outcomes), pointed at the corrected local ad hoc signed candidates.
out = pathlib.Path(sys.argv[1]); root = pathlib.Path('/Users/rickymac/code/.qwen/tmp/schema13-candidates')
mounts = pathlib.Path('/tmp/mac-schema13-adhoc-inspect')   # mounts never live inside the repo
out.mkdir(parents=True, exist_ok=True); mounts.mkdir(parents=True, exist_ok=True)
names = ['NEW-schema13-36a7b39-adhoc.dmg', 'OLD-schema12-2a6a415-adhoc.dmg']
results = []
for name in names:
    mount = mounts / name.removesuffix('.dmg'); mount.mkdir(exist_ok=True)
    attach = subprocess.run(['hdiutil','attach','-readonly','-nobrowse','-mountpoint',str(mount),str(root/name)], capture_output=True, text=True)
    (out/(name+'.attach.txt')).write_text(attach.stdout+attach.stderr)
    assert attach.returncode == 0, f"attach failed for {name}: {attach.stderr}"
    try:
        app = mount/'Her Flight Deck.app'; exe = app/'Contents/MacOS/her-flight-deck'
        commands = [
            ('exe-verify', ['codesign','--verify','--strict','--verbose=4',str(exe)]),
            ('bundle-verify', ['codesign','--verify','--deep','--strict','--verbose=4',str(app)]),
            ('signature', ['codesign','-dv','--verbose=4',str(exe)]),
            ('arch', ['lipo','-archs',str(exe)]),
            ('plist', ['plutil','-extract','CFBundleIdentifier','raw',str(app/'Contents/Info.plist')]),
        ]
        data = {'dmg': name,
                'dmg_sha256': hashlib.sha256((root/name).read_bytes()).hexdigest(),
                'exe_sha256': hashlib.sha256(exe.read_bytes()).hexdigest(),
                'checks': []}
        for label,args in commands:
            p = subprocess.run(args, capture_output=True, text=True)
            (out/(name+'.'+label+'.txt')).write_text(p.stdout+p.stderr)
            data['checks'].append({'check': label, 'exit': p.returncode, 'output': p.stdout+p.stderr})
        results.append(data)
        print(json.dumps({k:v for k,v in data.items() if k!='checks'}), flush=True)
        for c in data['checks']:
            print('   ', c['check'], 'exit', c['exit'], repr(c['output'][:120]), flush=True)
    finally:
        subprocess.run(['hdiutil','detach',str(mount)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
(out/'package-results.json').write_text(json.dumps(results, indent=2)+'\n')
ok = all(c['exit']==0 for r in results for c in r['checks'] if c['check'] in ('exe-verify','bundle-verify','arch','plist'))
print('strict bundle + executable verification passes for both candidates:', ok)
sys.exit(0 if ok else 1)
