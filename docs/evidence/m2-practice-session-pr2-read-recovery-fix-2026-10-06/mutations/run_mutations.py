"""Mutation proof for the R14 metadata loader: undo one guard at a time, run
the permanent R14 cases, require failure, restore byte-for-byte."""
from pathlib import Path
import json, os, subprocess

root = Path('/Users/rickymac/code/Flight-training-pr70-integration')
out = Path(__file__).resolve().parent
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:' + env['PATH']
HOOK = 'src/pages/StudyLibrary/usePracticeMetadata.ts'
TEST = ['npx', 'vitest', 'run', 'src/pages/StudyLibrary/PracticeMetadataReadRecovery.test.ts']
MUTATIONS = [
    ('M1', 'rejection is not consumed (failure handler removed)', HOOK,
     '''      () => {
        // Consumed here on purpose: the failure is shown as sanitized,
        // retryable status, never as raw database text.
        if (currentRequest.current !== request) return;
        inFlight.current = null;
        setState({ phase: "failed", materialId });
      },
''', '', None, None),
    ('M2', 'a stale success may publish (no request ownership on success)', HOOK,
     '''      ([conversionStatus, history]) => {
        if (currentRequest.current !== request) return;''', '''      ([conversionStatus, history]) => {''', None, None),
    ('M3', 'a stale failure may publish (no request ownership on failure)', HOOK,
     '''        // retryable status, never as raw database text.
        if (currentRequest.current !== request) return;''', '''        // retryable status, never as raw database text.''', None, None),
    ('M4', 'route change/unmount does not invalidate the request', HOOK,
     '''    return () => {
      currentRequest.current++;''', '''    return () => {''', None, None),
    ('M5', 'Retry is not locked while a request is in flight', HOOK,
     '    if (inFlight.current !== null) return;\n', '', None, None),
    ('M6', 'a failed read is shown as a loaded zero count', HOOK,
     '        setState({ phase: "failed", materialId });',
     '        setState({ phase: "loaded", materialId, conversionStatus: null, completedCount: 0 });', None, None),
]
results = []
for ident, label, rel, old, new, old2, new2 in MUTATIONS:
    path = root / rel
    original = path.read_bytes()
    text = original.decode()
    assert text.count(old) == 1, ident
    text = text.replace(old, new)
    if old2:
        assert text.count(old2) == 1, ident
        text = text.replace(old2, new2)
    try:
        path.write_text(text)
        with (out / f'{ident}.txt').open('w') as log:
            code = subprocess.run(TEST, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
    finally:
        path.write_bytes(original)
    results.append({'id': ident, 'mutation': label, 'exit': code, 'killed': code != 0,
                    'restored': path.read_bytes() == original})
summary = {'all_killed': all(r['killed'] for r in results), 'all_restored': all(r['restored'] for r in results),
           'mutations': results}
(out / 'results.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary))
