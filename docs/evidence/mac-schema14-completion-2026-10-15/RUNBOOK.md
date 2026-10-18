# Schema-14 installed verification — canonical future walkthrough (15 October 2026)

This is the one canonical walkthrough for a **future** installed run of a schema-14 candidate. Nothing in it has been executed. It cannot start yet: no schema-14 candidate exists, and the inputs in §1 are missing. Do not substitute the frozen v0.5.3 / schema-13 candidates or kit, and do not invent values.

## 0. Lane (unchanged from the owner's approval)

- Run only in the macOS account `hfdtest`, uid 502. It must be a standard account, not a member of `admin`.
- Profile: `/Users/hfdtest/Library/Application Support/com.herflightdeck.app`. The helper accepts no other root and has no flag to change that.
- Never run any step in the everyday account. Never point either app at another library. Never bypass Gatekeeper globally.
- Synthetic data only.

## 1. Inputs the run needs

The owner selected v0.5.4 and the local unsigned/ad-hoc candidate route. Source review and integration precede that build. No installer exists yet; physical testing remains deferred. The choices below do not grant permission to launch an app or access a profile.

| Variable | Meaning | Status |
| --- | --- | --- |
| `HFD14_CANDIDATE_COMMIT` | Source commit the candidate was built from. It must contain migrations 1–14 exactly as pinned by the helper’s immutable schema contract (`8a260c0…`); this continuation is prepared on accepted main `16f9cf3…` with identical migrations/fixtures, with no migration 15. | unavailable |
| `HFD14_DMG` / `HFD14_DMG_SHA256` | Candidate installer and its SHA-256 | unavailable |
| `HFD14_BIN_SHA256` | SHA-256 of `Her Flight Deck.app/Contents/MacOS/her-flight-deck` inside the DMG | unavailable |
| `HFD14_VERSION` | Selected next app version; bundle identifier stays `com.herflightdeck.app` | v0.5.4 selected; source configuration still 0.5.3 pending its own reviewed change |
| `HFD14_BASE13_DMG` / SHA-256 | A schema-13 build to create the populated schema-13 library before upgrading. It must be a separately authorized identity; the frozen kit is not retargeted. | unavailable |
| `HFD14_KIT` | Read-only staged kit containing this helper, `env.sh`, a transfer manifest and a reviewed operator tool for the schema-14 kit, with `stopped`, `new-run`, `copy`, `move`, and run/operation-bound `block-backups` / `unblock-backups` | unavailable: the schema-13 `hfd-operator.sh` is bound to its own kit and candidates |
| Owner authorization | Existing hfdtest isolation policy is retained, but physical execution is deferred | no installed run is requested by this preparation |

## 2. Variables used below

Once the inputs exist, they come from the kit's `env.sh`:

```bash
export HFD_NODE="/opt/homebrew/opt/node@22/bin/node"
export HFD14_HELPER="$HFD14_KIT/bin/mac-schema14-profile-snapshot.mjs"
export HFD_OP="$HFD14_KIT/bin/hfd-operator.sh"          # schema-14 kit's reviewed operator tool
export HFD_ROOT="/Users/hfdtest/Library/Application Support/com.herflightdeck.app"
export HFD_EVID="/Users/hfdtest/Downloads/hfd-schema14-workspace/evidence/$HFD_RUN_ID"   # fresh per run
```

Every snapshot and comparison writes to a new absolute path under `$HFD_EVID`. The helper refuses an existing, symlinked or aliasing destination.

## 3. Before any step

```bash
/usr/bin/id -u; /usr/bin/id -un; /usr/sbin/dseditgroup -o checkmember -m hfdtest admin
"$HFD_NODE" --version                    # v22.x
/usr/bin/shasum -a 256 "$HFD14_HELPER"   # must equal the reviewed helper hash in source-manifest.json
```

The helper has no self-check of its own in the kit: `self-check` refuses with exit 2. Its regressions run only in the repository (`node scripts/mac-schema14-verification-proof.mjs self-check`), before the kit is staged.

Expected output: `502`, `hfdtest`, `dseditgroup` exit 1 (not a member). Before **every** snapshot, quit the app with Cmd-Q and run `"$HFD_OP" stopped`. The helper refuses on its own if any process is found or inspection fails.

## 4. Gates

| Gate | Before → after | `--purpose` | PASS means |
| --- | --- | --- | --- |
| U1 upgrade | populated schema-13 library (debriefs, practice, cards, a split, managed PDFs) → after the first schema-14 launch and quit | `upgrade` | Migration 14 is recorded with the pinned SQLx checksum. All retained rows, metadata and file bytes are identical. Only the exact catalog seed is added, and the evidence tables are empty. |
| U2 invariance | schema-14 library holding Skills evidence the app created (observation, edit, link, status, confidence, custom skill, erased observation) → after a cancelled dialog | `unchanged` | Every fact is identical, including M3 history and tombstones. |
| U3 safe failure | same library → after a save attempted while `"$HFD_OP" block-backups` is active, then `"$HFD_OP" unblock-backups` | `unchanged` | Nothing changed, and the write block was recovered (permission facts are identical). |
| R1 restore | snapshot after exporting a schema-12, -13 and -14 backup → after restoring each into the schema-14 app and quitting | `restore` | Only `last_complete_backup_at`, `last_complete_backup_path` and `last_complete_backup_version` may differ, and the result says so. Everything else is identical; restores from older schemas add only the seed and empty tables. |

Command shape (identical for every gate):

```bash
"$HFD_OP" stopped
"$HFD_NODE" "$HFD14_HELPER" snapshot --json "$HFD_EVID/<gate>-before.json"
#   ... the one UI action for the gate, then Cmd-Q ...
"$HFD_OP" stopped
"$HFD_NODE" "$HFD14_HELPER" snapshot --json "$HFD_EVID/<gate>-after.json"
"$HFD_NODE" "$HFD14_HELPER" compare --before "$HFD_EVID/<gate>-before.json" --after "$HFD_EVID/<gate>-after.json" --purpose <purpose> --json "$HFD_EVID/cmp-<gate>.json"
```

`compare` exits 0 on PASS, 1 on FAIL and 2 on refusal. Keep every receipt, including FAIL ones; never rerun over an existing output. If `snapshot` refuses because `backups/`, `.restore-staging/` or `.restore-pending/` is a symlink, stop and report it; do not move or delete anything in the data root. `--purpose history` is partial by design and never a gate result.

## 5. Still out of scope

- Mid-save fault injection after a backup receipt: release binaries have no reachable seam.
- Developer ID signing and notarization.
- Release.
- M4 production decisions.

## 6. Hand back

Hand back the whole `$HFD_EVID` folder, terminal logs with exit codes, the DMG/binary hashes as observed, and screenshots of the gate actions. Profiles and backups stay local.

## 7. Post-merge source-only reproduction (F2)

This section runs only synthetic source proofs. It does not execute any installed gate above. Run from the repository root with Python 3, Git, Node 22 and npm available. Set `HFD_SCHEMA14_SOURCE_COMMIT` to the full merged commit to reproduce, or leave it unset to use your fetched `origin/main`. The F1–F3 PR’s final comment records the tested merged identity. Fetch if needed before starting.

The committed source manifest lists exactly the 20 helper-package source/document/receipt paths. Its own file and SHA256SUMS complete the 22-path overlay. The original baseline/HEAD check and allowlist are unchanged. Workflow changes and this follow-up’s separate evidence are outside that overlay; Linux CI validates the workflow separately. The full follow-up inventory is in `docs/evidence/mac-schema14-followup-2026-10-15/submission-manifest.json`. Earlier package receipts remain historical, not relabelled as executions of changed source.

**Dependency lock (QA-02, 15 October 2026).** The replay always installs dependencies from the baseline lock inside the detached baseline worktree; the commit's lock is never copied. The commit's `package-lock.json` must therefore be the baseline lock with, at most, the two synchronized application-version fields (`version` and `packages[""].version`) changed together, as `scripts/bump-version.mjs` writes them, byte-for-byte in npm's format. An identical lock passes as before; otherwise `compareDependencyLock` in the commit's verified proof runner decides, before any worktree is created. Commits from before QA-02 whose lock differs have no such function and still refuse. Any dependency, range, integrity, resolution, key-order or formatting change, or root versions that disagree, refuses. A version-only commit such as a release-candidate bump can be replayed. This remains a replay of the helper component on the immutable baseline, never a certification of the commit's whole application source. The original raw-equality refusal on `fee7869` is preserved in `docs/evidence/mac-local-v054-build-2026-10-15/versioned-proof-replay.json`.

The procedure reads bytes from the selected Git commit, verifies every listed size/hash before copying, creates a detached temporary worktree at **16f9cf3**, installs dependencies only there, runs the unchanged proof and removes that worktree in `finally`, including on an interrupt. It never copies local dirty files or edits current checkout files. The final receipt is retained in a fresh system-temp directory, with the selected commit, all commands/exits, 12-stage proof and cleanup facts. Node22 remains mandatory. No application build is run.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
python3 - <<'PY_REPRO'
import hashlib, json, os, pathlib, shutil, signal, subprocess, tempfile, time

BASE = '16f9cf3dedbfef0be09711ec42c0f7b8d3ef4b78'
MANIFEST = 'docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json'
SUMS = 'docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS'
repo = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
def git(*args):
    return subprocess.check_output(['git', '-C', str(repo), *args])
commit = git('rev-parse', '--verify', os.environ.get('HFD_SCHEMA14_SOURCE_COMMIT', 'origin/main') + '^{commit}').decode().strip()
start_status = git('status', '--porcelain=v1', '--untracked-files=all')
manifest_bytes = git('show', f'{commit}:{MANIFEST}')
manifest = json.loads(manifest_bytes)
assert manifest['base'] == BASE and manifest['schemaContractCommit'] == '8a260c0b32bc213850ed85bf9488d6ef571354a9'
files = manifest['files']
assert len({f['path'] for f in files}) == len(files) == 20
payload = {}
for f in files:
    p = pathlib.PurePosixPath(f['path'])
    assert not p.is_absolute() and '..' not in p.parts and str(p) == f['path']
    b = git('show', f"{commit}:{f['path']}")
    assert len(b) == f['bytes'] and hashlib.sha256(b).hexdigest() == f['sha256'], f['path']
    payload[f['path']] = b
payload[MANIFEST] = manifest_bytes
payload[SUMS] = git('show', f'{commit}:{SUMS}')
for line in payload[SUMS].decode().splitlines():
    digest, p = line.split('  ', 1)
    assert p in payload and hashlib.sha256(payload[p]).hexdigest() == digest, p
assert len(payload[SUMS].decode().splitlines()) == 21
# QA-02: the replay installs the baseline lock, so the commit's lock must match it apart from the
# two synchronized application-version fields. An identical lock (every commit replayed before
# QA-02) needs nothing more; otherwise compareDependencyLock in the commit's own copy of the proof
# runner, whose bytes were verified against the manifest above, decides.
base_lock = git('show', f'{BASE}:package-lock.json')
commit_lock = git('show', f'{commit}:package-lock.json')
lock_check = {'ok': True, 'identical': True}
if commit_lock != base_lock:
  with tempfile.TemporaryDirectory(prefix='hfd-schema14-lockcheck-') as check:
    check = pathlib.Path(check)
    (check / 'proof.mjs').write_bytes(payload['scripts/mac-schema14-verification-proof.mjs'])
    (check / 'baseline-lock.json').write_bytes(base_lock)
    (check / 'candidate-lock.json').write_bytes(commit_lock)
    lock_check = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', (
        "import fs from 'node:fs';"
        f"import {{ compareDependencyLock }} from {json.dumps((check / 'proof.mjs').as_uri())};"
        f"const read = name => fs.readFileSync({json.dumps(str(check))} + '/' + name);"
        "process.stdout.write(JSON.stringify(compareDependencyLock(read('baseline-lock.json'), read('candidate-lock.json'))));"
    )], cwd=check, text=True))
assert lock_check['ok'], f"package-lock.json: {lock_check['reason']}"
root = pathlib.Path(tempfile.mkdtemp(prefix='hfd-schema14-postmerge-'))
worktree = root / 'worktree'
receipt_dir = pathlib.Path(tempfile.mkdtemp(prefix='hfd-schema14-postmerge-receipt-'))
receipt = {'commit': commit, 'base': BASE, 'copiedPaths': sorted(payload), 'dependencyLock': lock_check, 'commands': [], 'success': False}
added = False
failure = None

def command(argv, cwd):
    started = time.time()
    p = subprocess.run(argv, cwd=cwd, text=True, capture_output=True)
    receipt['commands'].append({'argv': argv, 'cwd': str(cwd), 'startedAt': started, 'durationSeconds': time.time() - started, 'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr})
    if p.returncode:
        raise RuntimeError(f'{argv} exited {p.returncode}: {p.stderr[-1500:]}')
    return p

def interrupted(signum, frame):
    raise InterruptedError(f'interrupted by signal {signum}')
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGHUP, interrupted)
try:
    command(['git', '-C', str(repo), 'worktree', 'add', '--detach', str(worktree), BASE], repo)
    added = True
    for p, b in payload.items():
        mode = git('ls-tree', commit, '--', p).decode().split()[0]
        assert mode in ('100644', '100755'), p
        dest = worktree / p
        assert not dest.is_symlink(), p
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b)
        dest.chmod(0o755 if mode == '100755' else 0o644)
    command(['node', '--version'], worktree)
    assert receipt['commands'][-1]['stdout'].startswith('v22.')
    command(['npm', 'ci'], worktree)  # dependencies only in the disposable worktree
    p = command(['node', 'scripts/mac-schema14-verification-proof.mjs'], worktree)
    last = p.stdout.strip().splitlines()[-1]
    assert last.startswith('PASS: 12/12 stages; receipt '), last
    proof_path = pathlib.Path(last.split('; receipt ', 1)[1])
    receipt['proof'] = json.loads(proof_path.read_bytes())
    assert receipt['proof']['summary'] == {'stages': 12, 'passed': 12, 'failed': 0}
    receipt['success'] = True
except BaseException as error:
    receipt['error'] = f'{type(error).__name__}: {error}'
    failure = error
finally:
    if added:
        cleanup = subprocess.run(['git', '-C', str(repo), 'worktree', 'remove', '--force', str(worktree)], text=True, capture_output=True)
        receipt['cleanup'] = {'exit': cleanup.returncode, 'stderr': cleanup.stderr, 'worktreeRemoved': not worktree.exists()}
        if cleanup.returncode or worktree.exists():
            receipt['success'] = False
    shutil.rmtree(root, ignore_errors=True)
    receipt['sourceCheckoutStatusUnchanged'] = git('status', '--porcelain=v1', '--untracked-files=all') == start_status
    receipt['success'] = receipt['success'] and receipt['sourceCheckoutStatusUnchanged']
    output = receipt_dir / 'reproduction.json'
    output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"{'PASS' if receipt['success'] else 'FAIL'}: post-merge reproduction; receipt {output}")
if failure:
    raise failure
assert receipt['success'], receipt
PY_REPRO
```

Expected final line: `PASS: post-merge reproduction; receipt <temporary path>`. The nested proof must report 12/12 stages; cleanup must report exit 0, `worktreeRemoved: true` and `sourceCheckoutStatusUnchanged: true`. A current-HEAD direct proof refusal is expected after integration: use this procedure, not pin or allowlist changes.
