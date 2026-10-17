"""Run the exact submitted runner with disposable subprocess fault adapters."""
import contextlib, io, json, runpy, subprocess, sys, tempfile
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
RESULTS = []
for scenario in ('measurement_exit', 'preservation_changed'):
    with tempfile.TemporaryDirectory(prefix='hfd-review-runner-') as tmp:
        root = Path(tmp)
        repo = root / 'repo'
        (repo / 'src-tauri').mkdir(parents=True)
        target = root / 'target'
        (target / 'debug/examples').mkdir(parents=True)
        (target / 'debug/examples/p54_worker_proof').write_bytes(b'fault adapter')
        statuses = [b'', b' M src/App.tsx\n' if scenario == 'preservation_changed' else b'']

        def run(cmd, **kw):
            cmd = list(map(str, cmd))
            code = 0
            payload = b''
            if cmd[:2] == ['git', 'status']:
                payload = statuses.pop(0)
            elif cmd[:2] == ['git', 'rev-parse']:
                payload = b'fixture-head\n'
            elif 'suite' in cmd:
                payload = json.dumps({'passed': 2, 'total': 2, 'cases': [
                    {'case': 'real deadline: bomb killed and reaped within deadline + 500 ms', 'detail': {'elapsedMs': 1001}},
                    {'case': 'stalled worker settles at the deadline and is reaped', 'detail': {'elapsedMs': 801}}
                ]}).encode()
            elif 'measure-extract' in cmd:
                code = 17 if scenario == 'measurement_exit' else 0
                payload = json.dumps({'extraction': [{'pages': 300, 'runs': [{'wallMs': 100, 'peakRssBytes': 2**20}]*3}],
                    'spawnToFirstFrameMedianMs': 1, 'ipc': {'mbPerSecond': 100}}).encode()
            elif 'make-corpus' in cmd:
                Path(cmd[-1]).write_bytes(b'[]')
            elif 'measure-index' in cmd:
                code = 23 if scenario == 'measurement_exit' else 0
                payload = json.dumps({'records': 600, 'coldIndexMs': 1, 'queries': [{'query': 'crosswind', 'p95Ms': 1}],
                    'databaseBytes': 100, 'reopenFirstQueryMs': 1}).encode()
            if hasattr(kw.get('stdout'), 'write'):
                kw['stdout'].write(payload)
                if hasattr(kw.get('stderr'), 'write'):
                    kw['stderr'].write(b'1048576 maximum resident set size\n')
                return subprocess.CompletedProcess(cmd, code)
            return subprocess.CompletedProcess(cmd, code, payload.decode() if kw.get('text') else payload, '')

        def check_output(cmd, **kw):
            value = '33554432000\n' if 'hw.memsize' in cmd else 'review-runtime\n'
            return value if kw.get('text') else value.encode()

        output = io.StringIO()
        result = {'scenario': scenario}
        argv = [str(HERE / 'run-phase2.py'), '--repo', str(repo), '--scratch', str(root/'scratch'),
                '--out', str(root/'receipts'), '--target-dir', str(target)]
        with patch.object(sys, 'argv', argv), patch('subprocess.run', run), patch('subprocess.check_output', check_output), contextlib.redirect_stdout(output):
            try:
                runpy.run_path(str(HERE / 'run-phase2.py'), run_name='__main__')
                result['runnerExit'] = 0
            except SystemExit as exc:
                result['runnerExit'] = exc.code
        result['printedPass'] = 'PASS: suite' in output.getvalue()
        summary = json.loads((root/'receipts/summary.json').read_text())
        result['preservation'] = summary.get('preservation')
        result['extractExit'] = (root/'receipts/measure-extract.exit').read_text().strip()
        result['indexExit'] = (root/'receipts/index-10000-3.exit').read_text().strip()
        RESULTS.append(result)
(HERE/'runner-gate-diagnostic.json').write_text(json.dumps(RESULTS, indent=2)+'\n')
print(json.dumps(RESULTS, indent=2))
