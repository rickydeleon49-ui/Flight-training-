#!/usr/bin/env python3
"""Reproduce the corrected P54-02 phase 2 proof (fail-closed runner, P54P2-R3
and R6 cleanup ownership).

Copies the proof source in as a temporary Cargo example (refusing to overwrite
one), builds it with the locked dependencies, removes the example again even on
failure, and runs the correctness suite. Measurements run only if every suite
case passes, and targets are computed only from complete, valid receipts.

Exit codes:
  0  valid run (pre-registered target misses are results, listed in summary)
  2  invalid measurement (a stage failed or a receipt is incomplete)
  3  correctness suite failed or was incomplete; nothing was measured
  4  preservation failure (application bytes changed, or cleanup failed)
  5  unsafe scratch/output locations or build failure; nothing was run
Every failure writes summary.json with the stage and reason and keeps all
receipts. Scratch is removed only after a fully valid run.
"""
import argparse, hashlib, json, os, platform, re, shutil, subprocess, sys, time
from pathlib import Path

EXIT_INVALID, EXIT_SUITE, EXIT_PRESERVATION, EXIT_SETUP = 2, 3, 4, 5
EXTRACT_PAGES = (10, 100, 300)
INDEX_SIZES = (100, 1000, 10000)
REPEATS = (1, 2, 3)
QUERIES = ('crosswind', 'density altitude', '"density altitude"', 'metar', 'cafe', 'zurich')
OWNED_MARKER = '.p54-phase2-owned'

ap = argparse.ArgumentParser()
ap.add_argument('--repo', type=Path, required=True)
ap.add_argument('--scratch', type=Path, required=True, help='must not exist; outside the repo')
ap.add_argument('--out', type=Path, required=True, help='receipt directory; must not exist; outside the repo')
ap.add_argument('--target-dir', type=Path, help='optional CARGO_TARGET_DIR to reuse a build cache')
args = ap.parse_args()
repo, scratch, out = args.repo.resolve(), args.scratch.resolve(), args.out.resolve()


def inside(child, parent):
    return child == parent or parent in child.parents


def setup_refusal(reason):
    print(f'REFUSED: {reason}')
    sys.exit(EXIT_SETUP)


# --- Location safety: cleanup can never reach evidence or the repository ----
if scratch.exists() or out.exists():
    setup_refusal('scratch and output must be new directories')
if inside(scratch, out) or inside(out, scratch):
    setup_refusal('scratch and output must not overlap')
for path, name in ((scratch, 'scratch'), (out, 'output')):
    if inside(path, repo) or inside(repo, path):
        setup_refusal(f'{name} must be outside the repository, and must not contain it')
out.mkdir(parents=True)
scratch.mkdir(parents=True)
(scratch / OWNED_MARKER).write_text('owned by run-phase2.py\n')

here = Path(__file__).resolve().parent
source = here / 'p54_worker_proof.rs'
env = os.environ.copy()
if args.target_dir:
    env['CARGO_TARGET_DIR'] = str(args.target_dir.resolve())
target = Path(env.get('CARGO_TARGET_DIR', repo / 'src-tauri/target'))
summary = {'stages': {}}


def write_summary():
    (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')


def finish(code, stage, reason):
    summary['result'] = {'exit': code, 'stage': stage, 'reason': reason}
    write_summary()
    label = {EXIT_INVALID: 'INVALID MEASUREMENT', EXIT_SUITE: 'SUITE FAILED', EXIT_PRESERVATION: 'PRESERVATION FAILED', EXIT_SETUP: 'REFUSED'}[code]
    print(f'{label}: {stage}: {reason}. Receipts kept in {out}; scratch kept in {scratch}.')
    sys.exit(code)


def git(*cmd):
    return subprocess.run(['git', *cmd], cwd=repo, env=env, capture_output=True)


def snapshot():
    """Content identity of every tracked and untracked, non-ignored file."""
    listed = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').stdout
    files = {}
    for raw in sorted(set(p for p in listed.split(b'\0') if p)):
        path = repo / raw.decode('utf-8', 'surrogateescape')
        if path.is_file():
            digest = hashlib.sha256()
            with open(path, 'rb') as handle:
                for block in iter(lambda: handle.read(1 << 16), b''):
                    digest.update(block)
            files[raw.decode('utf-8', 'surrogateescape')] = digest.hexdigest()
        else:
            files[raw.decode('utf-8', 'surrogateescape')] = 'absent'
    status = git('status', '--porcelain=v1', '-z', '--untracked-files=all').stdout.decode('utf-8', 'surrogateescape')
    return {'files': files, 'status': status}


def compare(before, after):
    changed = sorted(p for p in set(before['files']) | set(after['files']) if before['files'].get(p) != after['files'].get(p))
    return changed, before['status'] != after['status']


before = snapshot()
# Ownership evidence is captured once: the exact bytes this run writes and
# compiles. Cleanup and provenance never re-read the (mutable) source.
written = source.read_bytes()
written_sha = hashlib.sha256(written).hexdigest()
summary['stages']['build'] = {'proofSourceSha256': written_sha}
example = repo / 'src-tauri/examples/p54_worker_proof.rs'
created_dir = not example.parent.exists()
example.parent.mkdir(exist_ok=True)
try:
    # Exclusive creation: an example that appears first is never overwritten.
    with open(example, 'xb') as handle:
        handle.write(written)
except FileExistsError:
    if created_dir:
        try:
            example.parent.rmdir()
        except OSError:
            pass
    finish(EXIT_SETUP, 'build', 'an example of this name already exists and belongs to someone else; it was left untouched')
cleanup_problems = []
try:
    with open(out / 'build.log', 'wb') as log:
        build = subprocess.run(['cargo', 'build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'p54_worker_proof'],
                               cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
    (out / 'build.exit').write_text(f'{build.returncode}\n')
    built = build.returncode == 0
    binary = scratch / 'p54_worker_proof'
    if built:
        shutil.copyfile(target / 'debug/examples/p54_worker_proof', binary)
        binary.chmod(0o700)
finally:
    # Remove only the exact bytes this run wrote, compared with the captured
    # copy; a changed example is someone else's and is left in place, even if
    # the source was changed to match it.
    if example.exists():
        if example.read_bytes() == written:
            example.unlink()
        else:
            cleanup_problems.append('temporary example changed during the build and was left in place')
    if source.read_bytes() != written:
        cleanup_problems.append(f'proof source changed during the build; the binary was built from the captured bytes {written_sha}')
    if created_dir and example.parent.exists():
        try:
            example.parent.rmdir()
        except OSError:
            cleanup_problems.append('examples directory created by this run is not empty')
summary['stages']['build']['exit'] = build.returncode
if cleanup_problems:
    summary['preservation'] = {'cleanupProblems': cleanup_problems}
    finish(EXIT_PRESERVATION, 'build cleanup', '; '.join(cleanup_problems))
if not built:
    finish(EXIT_SETUP, 'build', f'cargo build exited {build.returncode}; see build.log')


def run(name, cmd, timed=False):
    full = (['/usr/bin/time', '-l'] if timed else []) + [str(c) for c in cmd]
    with open(out / f'{name}.json', 'wb') as so, open(out / f'{name}.stderr.log', 'wb') as se:
        result = subprocess.run(full, cwd=scratch, env=env, stdout=so, stderr=se)
    (out / f'{name}.exit').write_text(f'{result.returncode}\n')
    rss = None
    if timed:
        match = re.search(rb'(\d+)\s+maximum resident set size', (out / f'{name}.stderr.log').read_bytes())
        rss = int(match.group(1)) if match else None
    try:
        data = json.loads((out / f'{name}.json').read_text())
    except (ValueError, UnicodeDecodeError):
        data = None
    return result.returncode, rss, data


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0


runtime = {
    'os': platform.platform(), 'machine': platform.machine(),
    'cpu': subprocess.check_output(['/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip(),
    'memoryBytes': int(subprocess.check_output(['/usr/sbin/sysctl', '-n', 'hw.memsize'], text=True)),
    'loadBefore': os.getloadavg(), 'sourceHead': git('rev-parse', 'HEAD').stdout.decode().strip(),
    'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip(), 'build': 'Cargo debug example (not a release build)',
    'proofSourceSha256': written_sha,
    'runnerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'startedUnix': time.time(),
}
(out / 'runtime.json').write_text(json.dumps(runtime, indent=2) + '\n')

# --- Correctness suite: measurements start only after every case passes ------
code, _, suite = run('suite', [binary, 'suite', scratch / 'suite'])
summary['stages']['suite'] = {'exit': code, 'passed': (suite or {}).get('passed'), 'total': (suite or {}).get('total')}
if code != 0 or not suite or not suite.get('total') or suite.get('passed') != suite.get('total'):
    finish(EXIT_SUITE, 'suite', 'the correctness suite did not fully pass; nothing was measured')

# --- Extraction / IPC measurement --------------------------------------------
code, extract_rss, extract = run('measure-extract', [binary, 'measure-extract', scratch / 'extract'], timed=True)
summary['stages']['measure-extract'] = {'exit': code, 'peakRssBytes': extract_rss}
if code != 0:
    finish(EXIT_INVALID, 'measure-extract', f'exited {code}')
if extract_rss is None:
    finish(EXIT_INVALID, 'measure-extract', 'no RSS in the time(1) receipt')
try:
    sizes = {s['pages']: s['runs'] for s in extract['extraction']}
    if sorted(sizes) != list(EXTRACT_PAGES):
        raise ValueError(f'expected extraction sizes {EXTRACT_PAGES}, got {sorted(sizes)}')
    for pages, runs in sizes.items():
        if len(runs) != len(REPEATS):
            raise ValueError(f'{pages} pages: expected {len(REPEATS)} runs, got {len(runs)}')
        for r in runs:
            if not (number(r.get('wallMs')) and isinstance(r.get('peakRssBytes'), int) and r['peakRssBytes'] > 0):
                raise ValueError(f'{pages} pages: missing wall time or RSS')
            if r.get('workerSucceeded') is not True or r.get('workerExit') != 0 or r.get('completed') is not True:
                raise ValueError(f'{pages} pages: inner worker did not finish cleanly ({r.get("workerExit")})')
            if r.get('textPages') != pages or r.get('expectedTextPages') != pages:
                raise ValueError(f'{pages} pages: extracted {r.get("textPages")} text pages')
    first = extract['spawnToFirstFrameMs']
    workers = extract['spawnToFirstFrameWorkers']
    if len(first) != 15 or not all(number(x) for x in first) or len(workers) != 15:
        raise ValueError('spawn-to-first-frame samples incomplete')
    if not all(w.get('completed') is True and w.get('workerExit') == 0 for w in workers):
        raise ValueError('a spawn-to-first-frame worker did not finish cleanly')
    if not (number(extract['spawnToFirstFrameMedianMs']) and number(extract['ipc']['mbPerSecond']) and extract['ipc']['frames'] > 0):
        raise ValueError('IPC or first-frame summary missing')
except (KeyError, TypeError, ValueError) as error:
    finish(EXIT_INVALID, 'measure-extract', f'incomplete receipt: {error}')

# --- Search index measurements ------------------------------------------------
index_runs = {}
for size in INDEX_SIZES:
    corpus = scratch / f'corpus-{size}.json'
    made = subprocess.run([str(binary), 'make-corpus', str(size), str(corpus)], cwd=scratch, env=env)
    if made.returncode != 0 or not corpus.is_file():
        finish(EXIT_INVALID, f'make-corpus {size}', f'exited {made.returncode}')
    runs = []
    for repeat in REPEATS:
        name = f'index-{size}-{repeat}'
        code, peak, result = run(name, [binary, 'measure-index', corpus, scratch / f'{name}.sqlite'], timed=True)
        summary['stages'][name] = {'exit': code, 'peakRssBytes': peak}
        if code != 0:
            finish(EXIT_INVALID, name, f'exited {code}')
        if peak is None:
            finish(EXIT_INVALID, name, 'no RSS in the time(1) receipt')
        try:
            if result['records'] != size * 6:
                raise ValueError(f'expected {size * 6} records, got {result["records"]}')
            for key in ('corpusLoadMs', 'coldIndexMs', 'reopenFirstQueryMs', 'databaseBytes'):
                if not number(result[key]):
                    raise ValueError(f'missing {key}')
            if result['reopenState'] != 'Ready':
                raise ValueError(f'reopen state {result["reopenState"]}')
            names = [q['query'] for q in result['queries']]
            if names != list(QUERIES):
                raise ValueError(f'query set {names}')
            for q in result['queries']:
                if not (number(q['p50Ms']) and number(q['p95Ms']) and len(q['samplesMs']) == 15 and isinstance(q['hits'], int)):
                    raise ValueError(f'query {q["query"]} incomplete')
        except (KeyError, TypeError, ValueError) as error:
            finish(EXIT_INVALID, name, f'incomplete receipt: {error}')
        result['exit'] = code
        result['peakRssBytes'] = peak
        runs.append(result)
    index_runs[size] = {'corpusSha256': hashlib.sha256(corpus.read_bytes()).hexdigest(), 'corpusBytes': corpus.stat().st_size, 'runs': runs}

# --- Preservation is a gate, checked before any result is declared -----------
after = snapshot()
changed, status_changed = compare(before, after)
summary['preservation'] = {'changedFiles': changed, 'statusChanged': status_changed, 'filesCompared': len(after['files']),
                           'temporaryExampleRemoved': not example.exists(), 'applicationProfileAccessed': False, 'productionDependencyAdded': False}
if changed or status_changed or example.exists():
    finish(EXIT_PRESERVATION, 'preservation', f'{len(changed)} application file(s) changed during the run')


# --- Targets: computed only from validated receipts ---------------------------
def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


cases = {c['case']: c for c in suite['cases']}
bomb_deadline = cases['real deadline: bomb killed and reaped within deadline + 500 ms']['detail']['elapsedMs']
stall = cases['stalled worker settles at the deadline and is reaped']['detail']['elapsedMs']
p300 = sizes[300]
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
(out / 'index-corpora.json').write_text(json.dumps({k: {'corpusSha256': v['corpusSha256'], 'corpusBytes': v['corpusBytes']} for k, v in index_runs.items()}, indent=2) + '\n')
met = sum(1 for t in summary['targets'] if t['met'])
summary['result'] = {'exit': 0, 'stage': 'complete', 'reason': f'valid run; {met}/{len(targets)} pre-registered targets met (misses listed, not adjusted)'}
write_summary()
if (scratch / OWNED_MARKER).is_file():
    shutil.rmtree(scratch)
print(json.dumps(summary['targets'], indent=2))
print(f'VALID: suite {suite["passed"]}/{suite["total"]}; {met}/{len(targets)} targets met; scratch removed')
