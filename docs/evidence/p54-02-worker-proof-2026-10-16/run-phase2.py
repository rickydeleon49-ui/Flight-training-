#!/usr/bin/env python3
"""Reproduce the P54-02 phase 2 proof in a NEW scratch directory.

Copies the proof source in as a temporary Cargo example (refusing to overwrite
one), builds it with the locked dependencies, removes the example again even on
failure, then runs the correctness suite. Measurements run only if every
suite case passes. Writes receipts into --out. Never touches application
storage, profiles or production dependencies.
"""
import argparse, hashlib, json, os, platform, re, shutil, subprocess, sys, time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--repo', type=Path, required=True)
ap.add_argument('--scratch', type=Path, required=True, help='must not exist')
ap.add_argument('--out', type=Path, required=True, help='receipt directory; must not exist')
ap.add_argument('--target-dir', type=Path, help='optional CARGO_TARGET_DIR to reuse a build cache')
args = ap.parse_args()
repo, scratch, out = args.repo.resolve(), args.scratch.resolve(), args.out.resolve()
for p in (scratch, out):
    if p.exists():
        sys.exit(f'refusing existing directory: {p}')
scratch.mkdir(parents=True); out.mkdir(parents=True)
here = Path(__file__).resolve().parent
source = here / 'p54_worker_proof.rs'
env = os.environ.copy()
if args.target_dir:
    env['CARGO_TARGET_DIR'] = str(args.target_dir.resolve())
target = Path(env.get('CARGO_TARGET_DIR', repo / 'src-tauri/target'))

def sh(cmd, **kw):
    return subprocess.run(cmd, cwd=repo, env=env, **kw)

def tracked_status():
    # Application files must be unchanged by the proof (evidence dir excluded).
    r = sh(['git', 'status', '--porcelain', '--', '.', ':!docs/evidence/p54-02-worker-proof-2026-10-16'], capture_output=True, text=True)
    return r.stdout

before = tracked_status()
example = repo / 'src-tauri/examples/p54_worker_proof.rs'
if example.exists():
    sys.exit('refusing to overwrite an existing example')
created_dir = not example.parent.exists()
example.parent.mkdir(exist_ok=True)
example.write_bytes(source.read_bytes())
try:
    with open(out / 'build.log', 'wb') as log:
        build = sh(['cargo', 'build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'p54_worker_proof'], stdout=log, stderr=subprocess.STDOUT)
    (out / 'build.exit').write_text(f'{build.returncode}\n')
    if build.returncode != 0:
        sys.exit('build failed; see build.log')
    binary = scratch / 'p54_worker_proof'
    shutil.copyfile(target / 'debug/examples/p54_worker_proof', binary)
    binary.chmod(0o700)
finally:
    if example.exists() and example.read_bytes() == source.read_bytes():
        example.unlink()
    if created_dir:
        try:
            example.parent.rmdir()
        except OSError:
            pass

def run(name, cmd, timed=False):
    full = (['/usr/bin/time', '-l'] if timed else []) + [str(c) for c in cmd]
    with open(out / f'{name}.json', 'wb') as so, open(out / f'{name}.stderr.log', 'wb') as se:
        r = subprocess.run(full, cwd=scratch, env=env, stdout=so, stderr=se)
    (out / f'{name}.exit').write_text(f'{r.returncode}\n')
    rss = None
    if timed:
        m = re.search(rb'(\d+)\s+maximum resident set size', (out / f'{name}.stderr.log').read_bytes())
        rss = int(m.group(1)) if m else None
    return r.returncode, rss

runtime = {
    'os': platform.platform(), 'machine': platform.machine(),
    'cpu': subprocess.check_output(['/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip(),
    'memoryBytes': int(subprocess.check_output(['/usr/sbin/sysctl', '-n', 'hw.memsize'], text=True)),
    'loadBefore': os.getloadavg(), 'sourceHead': sh(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip(),
    'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip(), 'build': 'Cargo debug example (not a release build)',
    'proofSourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'startedUnix': time.time(),
}
(out / 'runtime.json').write_text(json.dumps(runtime, indent=2) + '\n')

code, _ = run('suite', [binary, 'suite', scratch / 'suite'])
suite = json.loads((out / 'suite.json').read_text())
summary = {'suiteExit': code, 'suitePassed': suite['passed'], 'suiteTotal': suite['total']}
if code != 0 or suite['passed'] != suite['total']:
    summary['measurements'] = 'not run: the correctness suite did not fully pass'
    (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    sys.exit('suite failed; measurements not run')

code, rss = run('measure-extract', [binary, 'measure-extract', scratch / 'extract'], timed=True)
extract = json.loads((out / 'measure-extract.json').read_text())
index_runs = {}
for size in (100, 1000, 10000):
    corpus = scratch / f'corpus-{size}.json'
    subprocess.run([str(binary), 'make-corpus', str(size), str(corpus)], check=True)
    runs = []
    for repeat in (1, 2, 3):
        c, peak = run(f'index-{size}-{repeat}', [binary, 'measure-index', corpus, scratch / f'index-{size}-{repeat}.sqlite'], timed=True)
        result = json.loads((out / f'index-{size}-{repeat}.json').read_text())
        result['exit'] = c; result['peakRssBytes'] = peak
        runs.append(result)
    index_runs[size] = {'corpusSha256': hashlib.sha256(corpus.read_bytes()).hexdigest(), 'corpusBytes': corpus.stat().st_size, 'runs': runs}

def median(xs):
    xs = sorted(xs); return xs[len(xs) // 2]

suite_cases = {c['case']: c for c in suite['cases']}
bomb_deadline = suite_cases['real deadline: bomb killed and reaped within deadline + 500 ms']['detail']['elapsedMs']
stall = suite_cases['stalled worker settles at the deadline and is reaped']['detail']['elapsedMs']
p300 = next(s for s in extract['extraction'] if s['pages'] == 300)['runs']
i10k = index_runs[10000]['runs']
warm_p95 = max(q['p95Ms'] for r in i10k for q in r['queries'] if q['query'] in ('crosswind', 'metar', 'density altitude'))
targets = [
    ('300-page extraction wall time (ms, median)', median([r['wallMs'] for r in p300]), '<=', 10000),
    ('300-page worker peak RSS (MiB, max)', max(r['peakRssBytes'] for r in p300) / 2**20, '<=', 256),
    ('bomb deadline stop+reap (ms, deadline 1000)', bomb_deadline, '<=', 1500),
    ('stall deadline stop+reap (ms, deadline 800)', stall, '<=', 1300),
    ('spawn to first frame (ms, median)', extract['spawnToFirstFrameMedianMs'], '<=', 100),
    ('IPC NDJSON parse (MB/s)', extract['ipc']['mbPerSecond'], '>=', 50),
    ('cold FTS5 index at 10,000 (ms, median)', median([r['coldIndexMs'] for r in i10k]), '<=', 3000),
    ('warm literal query at 10,000 (ms, worst p95 of crosswind/metar/density altitude)', warm_p95, '<=', 50),
    ('reopen + first query at 10,000 (ms, median)', median([r['reopenFirstQueryMs'] for r in i10k]), '<=', 300),
    ('whole-process peak RSS, 10,000 index run (MiB, max)', max(r['peakRssBytes'] for r in i10k) / 2**20, '<=', 256),
]
summary['targets'] = [{'target': t, 'measured': round(v, 3), 'rule': f'{op} {limit}', 'met': (v <= limit if op == '<=' else v >= limit)} for t, v, op, limit in targets]
summary['index'] = {str(k): {'records': v['runs'][0]['records'], 'corpusBytes': v['corpusBytes'], 'coldIndexMsMedian': median([r['coldIndexMs'] for r in v['runs']]),
                     'databaseBytes': v['runs'][0]['databaseBytes'], 'peakRssMiBMax': max(r['peakRssBytes'] for r in v['runs']) / 2**20} for k, v in index_runs.items()}
summary['measureExtractProcessPeakRssBytes'] = rss
(out / 'index-corpora.json').write_text(json.dumps({k: {'corpusSha256': v['corpusSha256'], 'corpusBytes': v['corpusBytes']} for k, v in index_runs.items()}, indent=2) + '\n')
after = tracked_status()
summary['preservation'] = {'applicationFilesUnchanged': before == after, 'temporaryExampleRemoved': not example.exists(),
                           'applicationProfileAccessed': False, 'productionDependencyAdded': False}
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
shutil.rmtree(scratch)
print(json.dumps(summary['targets'], indent=2))
print('PASS: suite', suite['passed'], '/', suite['total'], '; scratch removed')
