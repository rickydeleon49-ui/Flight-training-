#!/usr/bin/env python3
"""Permanent regressions for run-phase2.py's failure and preservation gates
(P54P2-R3) and its cleanup ownership (P54P2-R6).

Runs the real runner beside this file under standard-library mocks for its
subprocesses, in fresh temporary directories. Nothing is compiled, no proof
runs, and no application file is touched. Usage: python3 -I test_run_phase2.py
(optionally with RUNNER=/path/to/run-phase2.py to test another copy).
"""
import contextlib, hashlib, io, json, os, runpy, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
RUNNER = Path(os.environ.get('RUNNER', HERE / 'run-phase2.py'))
SOURCE = HERE / 'p54_worker_proof.rs'
OTHER_WRITER = b'new work from the other writer\n'


def suite_json(passed=71, total=71):
    return {'passed': passed, 'total': total, 'cases': [
        {'case': 'real deadline: bomb killed and reaped within deadline + 500 ms', 'detail': {'elapsedMs': 1001}},
        {'case': 'stalled worker settles at the deadline and is reaped', 'detail': {'elapsedMs': 801}},
    ]}


def extract_json(scenario):
    runs = lambda pages: [{
        'wallMs': 10.0, 'peakRssBytes': 2**20,
        'textPages': pages - 1 if scenario == 'text_pages_mismatch' and pages == 300 else pages, 'expectedTextPages': pages,
        'workerExit': 1 if scenario == 'inner_worker_failed' else 0,
        'workerSucceeded': scenario != 'inner_worker_failed', 'completed': scenario != 'inner_worker_failed', 'fileBytes': 1000,
    } for _ in range(3)]
    return {'extraction': [{'pages': p, 'runs': runs(p)} for p in (10, 100, 300)],
            'spawnToFirstFrameMs': [1.0] * 15, 'spawnToFirstFrameWorkers': [{'workerExit': 0, 'completed': True}] * 15,
            'spawnToFirstFrameMedianMs': 1.0, 'ipc': {'bytes': 100, 'frames': 10, 'parseMs': 1.0, 'mbPerSecond': 100.0}}


def index_json(size, scenario):
    result = {'records': size * 6, 'corpusLoadMs': 1.0, 'coldIndexMs': 1.0, 'databaseBytes': 100, 'reopenFirstQueryMs': 1.0,
              'reopenState': 'Ready', 'reopenFirstQueryHits': 1,
              'queries': [{'query': q, 'hits': 1, 'samplesMs': [1.0] * 15, 'p50Ms': 1.0, 'p95Ms': 1.0}
                          for q in ('crosswind', 'density altitude', '"density altitude"', 'metar', 'cafe', 'zurich')]}
    if scenario == 'missing_field':
        del result['coldIndexMs']
    return result


def run_runner(scenario, layout='normal'):
    with tempfile.TemporaryDirectory(prefix='hfd-p54-runner-test-') as tmp:
        root = Path(tmp)
        repo = root / 'repo'
        (repo / 'src').mkdir(parents=True)
        (repo / 'src-tauri').mkdir()
        app = repo / 'src/App.tsx'
        app.write_text('export const app = 1;\n')
        target = root / 'target'
        (target / 'debug/examples').mkdir(parents=True)
        (target / 'debug/examples/p54_worker_proof').write_bytes(b'stand-in binary')
        scratch, out = root / 'scratch', root / 'receipts'
        if layout == 'out_inside_scratch':
            out = scratch / 'receipts'
        if layout == 'out_inside_repo':
            out = repo / 'receipts'
        calls = []
        calls_seen = {'ls-files': 0}
        dirty = ' M src/App.tsx' if scenario == 'dirty_content_changed' else ''
        statuses = [dirty, ' M src/App.tsx' if scenario == 'status_changed' else dirty]

        def fake_run(cmd, **kw):
            cmd = [str(c) for c in cmd]
            calls.append(cmd)
            code, payload, stderr = 0, b'', b''
            if cmd[:2] == ['git', 'ls-files']:
                payload = b'src/App.tsx\0'
                if scenario == 'example_preexisting' and not calls_seen['ls-files']:
                    # Another writer's example appears just before exclusive creation.
                    (repo / 'src-tauri/examples').mkdir(exist_ok=True)
                    (repo / 'src-tauri/examples/p54_worker_proof.rs').write_bytes(OTHER_WRITER)
                calls_seen['ls-files'] += 1
            elif cmd[:2] == ['git', 'status']:
                payload = statuses.pop(0).encode()
            elif cmd[:2] == ['git', 'rev-parse']:
                payload = b'fixture-head\n'
            elif cmd[:2] == ['cargo', 'build']:
                if scenario == 'example_changed':
                    (repo / 'src-tauri/examples/p54_worker_proof.rs').write_text('someone else edited this\n')
                if scenario in ('source_changed', 'source_and_example_changed'):
                    (runner_copy.parent / 'p54_worker_proof.rs').write_bytes(OTHER_WRITER)
                if scenario == 'source_and_example_changed':
                    (repo / 'src-tauri/examples/p54_worker_proof.rs').write_bytes(OTHER_WRITER)
            elif 'suite' in cmd:
                payload = json.dumps(suite_json(70 if scenario == 'suite_failed' else 71)).encode()
            elif 'measure-extract' in cmd:
                code = 17 if scenario == 'extract_exit' else 0
                payload = json.dumps(extract_json(scenario)).encode()
                stderr = b'1048576  maximum resident set size\n'
                if scenario == 'dirty_content_changed':
                    app.write_text('export const app = 2;\n')  # same status line, new bytes
            elif 'make-corpus' in cmd:
                Path(cmd[-1]).write_bytes(b'[]')
            elif 'measure-index' in cmd:
                size = int(Path(cmd[-2]).stem.split('-')[1])
                code = 23 if scenario == 'index_exit' else 0
                payload = json.dumps(index_json(size, scenario)).encode()
                stderr = b'' if scenario == 'missing_rss' else b'2097152  maximum resident set size\n'
            if hasattr(kw.get('stdout'), 'write'):
                kw['stdout'].write(payload)
                if hasattr(kw.get('stderr'), 'write'):
                    kw['stderr'].write(stderr)
                return subprocess.CompletedProcess(cmd, code)
            if kw.get('text'):
                return subprocess.CompletedProcess(cmd, code, payload.decode(), stderr.decode())
            return subprocess.CompletedProcess(cmd, code, payload, stderr)

        def fake_check_output(cmd, **kw):
            value = '34359738368\n' if 'hw.memsize' in cmd else 'stand-in\n'
            return value if kw.get('text') else value.encode()

        # The runner reads its proof source from beside itself.
        runner_copy = root / 'runner' / 'run-phase2.py'
        runner_copy.parent.mkdir()
        runner_copy.write_bytes(RUNNER.read_bytes())
        (runner_copy.parent / 'p54_worker_proof.rs').write_bytes(SOURCE.read_bytes())
        argv = [str(runner_copy), '--repo', str(repo), '--scratch', str(scratch), '--out', str(out), '--target-dir', str(target)]
        printed = io.StringIO()
        with patch.object(sys, 'argv', argv), patch('subprocess.run', fake_run), patch('subprocess.check_output', fake_check_output), contextlib.redirect_stdout(printed):
            try:
                runpy.run_path(str(runner_copy), run_name='__main__')
                exit_code = 0
            except SystemExit as exc:
                exit_code = exc.code
        summary_path = out / 'summary.json'
        summary = json.loads(summary_path.read_text()) if summary_path.exists() else None
        example_path = repo / 'src-tauri/examples/p54_worker_proof.rs'
        return {
            'exampleBytes': example_path.read_bytes() if example_path.exists() else None,
            'exit': exit_code, 'printed': printed.getvalue(), 'summary': summary,
            'measuredExtract': any('measure-extract' in c for c in calls), 'built': any(c[:2] == ['cargo', 'build'] for c in calls),
            'scratchKept': scratch.exists(), 'exampleLeft': (repo / 'src-tauri/examples/p54_worker_proof.rs').exists(),
        }


ORIGINAL_SHA = hashlib.sha256(SOURCE.read_bytes()).hexdigest()


class RunnerGates(unittest.TestCase):
    def assertFailed(self, result, code, stage):
        self.assertEqual(result['exit'], code, result['printed'])
        self.assertNotIn('VALID:', result['printed'])
        self.assertEqual(result['summary']['result']['exit'], code)
        self.assertIn(stage, result['summary']['result']['stage'])
        self.assertTrue(result['scratchKept'], 'failure must keep scratch for inspection')

    def test_normal_success_is_valid(self):
        r = run_runner('success')
        self.assertEqual(r['exit'], 0, r['printed'])
        self.assertIn('VALID: suite 71/71', r['printed'])
        self.assertEqual(len(r['summary']['targets']), 10)
        self.assertEqual(r['summary']['preservation']['changedFiles'], [])
        self.assertFalse(r['scratchKept'])
        self.assertFalse(r['exampleLeft'])

    def test_nonzero_extraction_is_invalid(self):
        self.assertFailed(run_runner('extract_exit'), 2, 'measure-extract')

    def test_nonzero_index_is_invalid(self):
        self.assertFailed(run_runner('index_exit'), 2, 'index-100-1')

    def test_failed_inner_worker_is_invalid(self):
        r = run_runner('inner_worker_failed')
        self.assertFailed(r, 2, 'measure-extract')
        self.assertIn('inner worker', r['summary']['result']['reason'])

    def test_wrong_text_page_count_is_invalid(self):
        r = run_runner('text_pages_mismatch')
        self.assertFailed(r, 2, 'measure-extract')
        self.assertIn('text pages', r['summary']['result']['reason'])

    def test_missing_rss_is_invalid(self):
        r = run_runner('missing_rss')
        self.assertFailed(r, 2, 'index-100-1')
        self.assertIn('RSS', r['summary']['result']['reason'])

    def test_missing_measurement_field_is_invalid(self):
        r = run_runner('missing_field')
        self.assertFailed(r, 2, 'index-100-1')
        self.assertIn('coldIndexMs', r['summary']['result']['reason'])

    def test_failed_suite_measures_nothing(self):
        r = run_runner('suite_failed')
        self.assertFailed(r, 3, 'suite')
        self.assertFalse(r['measuredExtract'])

    def test_changed_status_fails_preservation(self):
        self.assertFailed(run_runner('status_changed'), 4, 'preservation')

    def test_already_dirty_file_changing_again_fails_preservation(self):
        r = run_runner('dirty_content_changed')
        self.assertFailed(r, 4, 'preservation')
        self.assertEqual(r['summary']['preservation']['changedFiles'], ['src/App.tsx'])
        self.assertFalse(r['summary']['preservation']['statusChanged'])

    def test_example_changed_by_someone_else_is_left_and_fails(self):
        r = run_runner('example_changed')
        self.assertFailed(r, 4, 'build cleanup')
        self.assertTrue(r['exampleLeft'], 'another writer\'s example must not be deleted')

    def test_source_only_edit_removes_own_example_and_keeps_captured_identity(self):
        r = run_runner('source_changed')
        self.assertFailed(r, 4, 'build cleanup')
        self.assertFalse(r['exampleLeft'], 'the example still held this run\'s bytes, so it is this run\'s to remove')
        self.assertEqual(r['summary']['stages']['build']['proofSourceSha256'], ORIGINAL_SHA)
        self.assertIn('proof source changed', r['summary']['result']['reason'])

    def test_source_and_example_changed_to_matching_bytes_is_left_and_fails(self):
        r = run_runner('source_and_example_changed')
        self.assertFailed(r, 4, 'build cleanup')
        self.assertTrue(r['exampleLeft'], 'another writer\'s matching example must not be deleted')
        self.assertEqual(r['exampleBytes'], OTHER_WRITER)
        self.assertEqual(r['summary']['stages']['build']['proofSourceSha256'], ORIGINAL_SHA)

    def test_example_appearing_before_exclusive_creation_is_never_overwritten(self):
        r = run_runner('example_preexisting')
        self.assertEqual(r['exit'], 5, r['printed'])
        self.assertFalse(r['built'])
        self.assertEqual(r['exampleBytes'], OTHER_WRITER)

    def test_success_records_the_captured_source_identity(self):
        r = run_runner('success')
        self.assertEqual(r['exit'], 0, r['printed'])
        self.assertEqual(r['summary']['stages']['build']['proofSourceSha256'], ORIGINAL_SHA)
        self.assertFalse(r['exampleLeft'])

    def test_overlapping_locations_refused_before_anything_runs(self):
        r = run_runner('success', layout='out_inside_scratch')
        self.assertEqual(r['exit'], 5)
        self.assertFalse(r['built'])

    def test_output_inside_repository_refused(self):
        r = run_runner('success', layout='out_inside_repo')
        self.assertEqual(r['exit'], 5)
        self.assertFalse(r['built'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
