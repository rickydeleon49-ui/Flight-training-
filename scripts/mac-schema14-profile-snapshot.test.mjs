/**
 * Regressions for the distributed schema-14 helper: the operator CLI exactly as shipped, plus
 * capture/compare behaviour through a disposable copy written by the proof runner (the helper
 * exports nothing and has no test route; only the copy carries a scratch lane).
 * Every write goes to a fresh task-owned temporary directory; no real profile is read.
 *
 * Run from the repository root: node --test scripts/mac-schema14-profile-snapshot.test.mjs
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { recognizeBuildOutput, walkerSensitivity, writeDisposableHelper } from './mac-schema14-verification-proof.mjs';

const REPO = process.cwd();
const HELPER = path.join(REPO, 'scripts', 'mac-schema14-profile-snapshot.mjs');
const RUNNER = path.join(REPO, 'scripts', 'mac-schema14-verification-proof.mjs');
const OPERATOR_ENTRY = '// @hfd-schema14-operator-entry';
const PR142 = path.join(REPO, 'docs', 'evidence', 'mac-installed-results-2026-10-11');
const RECEIPT_KEYS = ['last_complete_backup_at', 'last_complete_backup_path', 'last_complete_backup_version'];

let scratch;
let H;
let uid;
let counter = 0;

function cli(args, file = HELPER) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.split('\n').filter(l => !/ExperimentalWarning|trace-warnings/.test(l)).join('\n').trim() };
}

async function loadAdapter(dir) {
  const file = writeDisposableHelper(dir, { entry: 'export const adapter = { buildScratchProfile, cloneScratchProfile, setMetadata, withDb, applyShippedMigrations, takeSnapshot, scratchLane, compare, metadataKeyDigests, guardOperatorIsolation, BACKUP_RECEIPT_KEYS, APP_ID };' });
  return (await import(pathToFileURL(file).href)).adapter;
}

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const fresh = name => path.join(scratch, `${name}-${++counter}.json`);
const snap = (lib, name) => { const out = fresh(name); H.takeSnapshot(lib.root, uid, out); return out; };

/** A populated schema-13 library and its real 13 -> 14 upgrade, captured on one root. */
function upgradePair(name) {
  const lib = H.buildScratchProfile(path.join(scratch, name), REPO, { version: 13 });
  const s13 = snap(lib, `${name}-13`);
  H.withDb(lib.dbPath, db => H.applyShippedMigrations(db, REPO, 14, 14));
  return { lib, s13, s14: snap(lib, `${name}-14`) };
}

before(async () => {
  scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hfd-schema14-selfcheck-node-'));
  H = await loadAdapter(scratch);
  uid = process.getuid();
});

after(() => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });

describe('distributed helper', () => {
  it('exports nothing, has one operator entry, one fixed lane and no test or environment route', () => {
    const source = fs.readFileSync(HELPER, 'utf8');
    assert.equal(/^\s*export\s/m.test(source), false);
    assert.equal(source.split(OPERATOR_ENTRY).length, 2);
    assert.equal(/process\.env/.test(source), false);
    for (const token of ['testContext', 'internalTestFixture', 'scratchLane']) assert.equal(source.includes(token), false, token);
    assert.match(source, /const APPROVED = Object\.freeze\(\{\n {2}uid: 502,\n {2}account: 'hfdtest',/);
    assert.match(source, /function operatorLane\(\) \{\n {2}return Object\.freeze\(\{ profile: APPROVED\.root, uid: APPROVED\.uid, inspect: inspectAppProcesses, isolate: guardOperatorIsolation, operator: true \}\);\n\}/);
  });

  it('the distributed CLI refuses to self-check; the runner runs it in a disposable copy and every named regression passes', () => {
    const refused = cli(['self-check']);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /runs only in a disposable repository copy/);
    const r = cli(['self-check'], RUNNER);
    const report = JSON.parse(r.stdout);
    assert.equal(r.status, 0, report.checks.filter(c => !c.pass).map(c => c.name).join('; '));
    assert.equal(report.counts.failed, 0);
    assert.ok(report.counts.checks >= 97, `${report.counts.checks} checks`);
    assert.equal(report.pinnedCommit, '8a260c0b32bc213850ed85bf9488d6ef571354a9');
  });
});

describe('proof source walker', () => {
  it('sets aside genuine Cargo/Tauri build output but reports unexpected source and changed protected files', () => {
    const dir = path.join(scratch, 'walker');
    fs.mkdirSync(dir);
    const cases = walkerSensitivity(dir);
    assert.equal(cases.length, 11);
    for (const c of cases) assert.ok(c.pass, `${c.name}: changed ${JSON.stringify(c.changed)}, accepted ${JSON.stringify(c.accepted)}`);
    const byName = Object.fromEntries(cases.map(c => [c.name, c]));
    assert.deepEqual(byName['accepted: genuine Cargo target and Tauri gen schemas'].changed, []);
    assert.ok(byName['refused: source inside Tauri gen'].changed.includes('src-tauri/gen/schemas/payload.mjs'));
    assert.deepEqual(byName['refused: changed protected migration beside accepted build output'].changed, ['src-tauri/migrations/0001_initial_schema.sql']);
  });

  it('recognizes only the two exact build-output paths, and this checkout\'s real ones when present', () => {
    assert.equal(recognizeBuildOutput(REPO, 'src-tauri/src', new Set()).recognized, false);
    assert.equal(recognizeBuildOutput(REPO, 'target', new Set()).recognized, false);
    for (const rel of ['src-tauri/target', 'src-tauri/gen']) {
      if (!fs.existsSync(path.join(REPO, rel))) continue;
      const found = recognizeBuildOutput(REPO, rel, new Set());
      assert.equal(found.recognized, true, `${rel}: ${found.reason}`);
      assert.equal(recognizeBuildOutput(REPO, rel, new Set([`${rel}/tracked.txt`])).recognized, false, rel);
    }
  });
});

describe('operator CLI refusals', () => {
  it('snapshot outside the approved lane refuses and writes nothing', () => {
    const out = fresh('operator');
    const r = cli(['snapshot', '--json', out]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^REFUSED: /);
    assert.equal(fs.existsSync(out), false);
  });

  it('no flag retargets the lane or relaxes a rule', () => {
    for (const [args, pattern] of [
      [['snapshot', '--profile', '/tmp'], /--profile is not accepted/],
      [['snapshot', '--expect-uid', '0', '--json', fresh('retarget')], /cannot retarget the approved lane/],
      [['snapshot', '--allow-any-root'], /unknown argument --allow-any-root/],
      [['compare', '--before', 'a.json', '--after', 'b.json'], /must be an absolute path/],
    ]) {
      const r = cli(args);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(r.stderr, pattern, args.join(' '));
    }
  });

  it('the account guard refuses any uid other than the approved standard account', { skip: process.getuid() === 502 }, () => {
    assert.throws(() => H.guardOperatorIsolation(scratch), /must run as uid 502 \(hfdtest\)/);
  });
});

describe('operator CLI compare', () => {
  it('writes a fresh receipt for a genuine upgrade, then never clobbers it or an input', () => {
    const { s13, s14 } = upgradePair('cli-upgrade');
    const out = fresh('cmp-upgrade');
    const pass = cli(['compare', '--before', s13, '--after', s14, '--purpose', 'upgrade', '--json', out]);
    assert.equal(pass.status, 0, pass.stderr);
    const receipt = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(receipt.verdict, 'PASS');
    assert.deepEqual(receipt.diffs, []);
    const bytes = sha(out);
    const again = cli(['compare', '--before', s13, '--after', s14, '--purpose', 'upgrade', '--json', out]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already exists; evidence is never clobbered/);
    assert.equal(sha(out), bytes);
    const inputBytes = sha(s13);
    const alias = cli(['compare', '--before', s13, '--after', s14, '--purpose', 'upgrade', '--json', s13]);
    assert.equal(alias.status, 2);
    assert.match(alias.stderr, /aliases protected input/);
    assert.equal(sha(s13), inputBytes);
    const unchanged = cli(['compare', '--before', s13, '--after', s14, '--purpose', 'unchanged']);
    assert.equal(unchanged.status, 1);
    assert.equal(JSON.parse(unchanged.stdout).verdict, 'FAIL');
  });

  it('refuses the original PR #142 installed receipts instead of reinterpreting them, leaving them byte-identical', () => {
    const files = ['s12-populated.json', 's13-restored.json'].map(f => path.join(PR142, f));
    const hashes = files.map(sha);
    const r = cli(['compare', '--before', files[0], '--after', files[1], '--purpose', 'restore']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /legacy hfd-mac-profile-snapshot\/3 receipt from the historical schema-13 helper/);
    assert.deepEqual(files.map(sha), hashes);
  });

  it('refuses oversized and symlinked receipts before reading them', () => {
    const { s14 } = upgradePair('cli-bounds');
    const big = fresh('oversized');
    fs.closeSync(fs.openSync(big, 'w'));
    fs.truncateSync(big, 64 * 1024 * 1024 + 1);
    const oversized = cli(['compare', '--before', s14, '--after', big]);
    assert.equal(oversized.status, 2);
    assert.match(oversized.stderr, /over the 67108864-byte receipt bound/);
    const link = fresh('link');
    fs.symlinkSync(s14, link);
    const linked = cli(['compare', '--before', s14, '--after', link]);
    assert.equal(linked.status, 2);
    assert.match(linked.stderr, /without following links/);
  });
});

describe('the disposable copy\'s scratch lane', () => {
  it('refuses roots outside task-owned scratch, outside the temporary directory, or not named for the app', () => {
    const tmp = fs.realpathSync(os.tmpdir());
    for (const [root, pattern] of [
      [path.join(tmp, H.APP_ID), /not inside task-owned hfd-schema14-selfcheck-\* scratch/],
      [path.join(REPO, H.APP_ID), /is not under/],
      [path.join(scratch, 'not-the-app'), /is not a com\.herflightdeck\.app directory/],
      ['relative/com.herflightdeck.app', /needs an absolute root/],
    ]) assert.throws(() => H.scratchLane(root, uid), pattern, root);
  });

  it('is never selected outside a takeSnapshot call', () => {
    const lib = H.buildScratchProfile(path.join(scratch, 'lane-reset'), REPO, { version: 13, populate: false });
    snap(lib, 'lane-reset');
    assert.throws(() => H.takeSnapshot(path.join(fs.realpathSync(os.tmpdir()), H.APP_ID), uid, fresh('lane-outside')), /not inside task-owned/);
  });

  it('clones are independent single-linked files, so the hard-link guard is never tripped by fixture copies', () => {
    const lib = H.buildScratchProfile(path.join(scratch, 'clone-links'), REPO, { version: 13 });
    const clone = H.cloneScratchProfile(lib.root, path.join(scratch, 'clone-links-copy'));
    for (const name of ['mat.pdf', 'part.pdf']) {
      const a = fs.lstatSync(path.join(lib.root, 'documents', name));
      const b = fs.lstatSync(path.join(clone.root, 'documents', name));
      assert.equal(a.nlink, 1, name);
      assert.equal(b.nlink, 1, name);
      assert.notEqual(a.ino, b.ino, name);
    }
    const anchors = file => JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).fileAnchors);
    assert.equal(anchors(snap(clone, 'clone-dst')), anchors(snap(lib, 'clone-src')));
  });
});

describe('special metadata keys on real SQLite', () => {
  it('capture __proto__, constructor, toString and Unicode keys as own digests in a prototype-free map', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE app_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
    const keys = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'préférence_✈️_キー'];
    for (const k of keys) db.prepare('INSERT INTO app_metadata VALUES (?, ?)').run(k, `${k}-value`);
    const map = H.metadataKeyDigests(db);
    db.close();
    assert.equal(Object.getPrototypeOf(map), null);
    assert.deepEqual(Object.keys(map).sort(), [...keys].sort());
    const roundTrip = JSON.parse(JSON.stringify(map));
    assert.deepEqual(Object.keys(roundTrip).sort(), [...keys].sort());
    assert.ok(Object.values(roundTrip).every(v => /^[0-9a-f]{64}$/.test(v)));
  });

  it('retained special keys pass upgrade and restore; changed, removed or added ones fail restore by name', () => {
    const lib = H.buildScratchProfile(path.join(scratch, 'special'), REPO, { version: 13 });
    const special = [['__proto__', 'p'], ['constructor', 'c'], ['toString', 't'], ['préférence_✈️_キー', 'u']];
    H.setMetadata(lib.dbPath, special);
    const s13 = snap(lib, 'special-13');
    H.withDb(lib.dbPath, db => H.applyShippedMigrations(db, REPO, 14, 14));
    const s14 = snap(lib, 'special-14');
    assert.equal(H.compare({ before: s13, after: s14, purpose: 'upgrade' }).verdict, 'PASS');
    const restore = H.compare({ before: s13, after: s14, purpose: 'restore' });
    assert.equal(restore.verdict, 'PASS');
    assert.equal(restore.sections.backupReceipt.otherKeysCompared, 4);
    for (const [rows, remove, key] of [[[['__proto__', 'changed']], [], '__proto__'], [[], ['constructor'], 'constructor'], [[['toString2', 'x']], [], 'toString2']]) {
      H.setMetadata(lib.dbPath, rows, remove);
      const changed = H.compare({ before: s13, after: snap(lib, 'special-changed'), purpose: 'restore' });
      assert.equal(changed.verdict, 'FAIL');
      assert.ok(changed.diffs.includes(`app_metadata: keys other than the backup receipt differ (${key})`), changed.diffs.join('\n'));
      H.setMetadata(lib.dbPath, special, ['toString2']);
    }
  });

  it('sets aside exactly the three receipt keys, only for restore', () => {
    assert.deepEqual([...H.BACKUP_RECEIPT_KEYS], RECEIPT_KEYS);
    // A schema-14 restore baseline must carry M3 evidence, so use the writer-populated fixture.
    const lib = H.buildScratchProfile(path.join(scratch, 'receipt-scope'), REPO, { version: 14, writerEvidence: true });
    const s14 = snap(lib, 'receipt-scope-14');
    H.setMetadata(lib.dbPath, [...RECEIPT_KEYS.map(k => [k, 'x']), ['last_complete_backup_size', '1'], ['Last_Complete_Backup_At', 'x']]);
    const after14 = snap(lib, 'receipt-scope-after');
    const restore = H.compare({ before: s14, after: after14, purpose: 'restore' });
    assert.equal(restore.verdict, 'FAIL');
    assert.ok(restore.diffs.includes('app_metadata: keys other than the backup receipt differ (Last_Complete_Backup_At, last_complete_backup_size)'), restore.diffs.join('\n'));
    H.setMetadata(lib.dbPath, [], ['last_complete_backup_size', 'Last_Complete_Backup_At']);
    const onlyReceipt = snap(lib, 'receipt-scope-only');
    assert.equal(H.compare({ before: s14, after: onlyReceipt, purpose: 'restore' }).verdict, 'PASS');
    for (const purpose of ['unchanged', 'upgrade', 'history']) {
      const strict = H.compare({ before: s14, after: onlyReceipt, purpose });
      assert.equal(strict.receiptExclusion.applied, false, purpose);
      assert.ok(strict.diffs.includes(`app_metadata: keys differ (${RECEIPT_KEYS.join(', ')})`) || purpose === 'upgrade', purpose);
      assert.equal(strict.verdict, 'FAIL', purpose);
    }
  });
});

describe('inventory and runtime-root boundaries', () => {
  it('inventories sqlite-like user objects that a LIKE wildcard would hide, and compare names them', () => {
    const lib = H.buildScratchProfile(path.join(scratch, 'sqlitex'), REPO, { version: 14, writerEvidence: true });
    const before = snap(lib, 'sqlitex-before');
    H.withDb(lib.dbPath, db => db.exec('CREATE TABLE sqlitex_user_evidence (id TEXT PRIMARY KEY); CREATE INDEX sqlitex_probe_idx ON tags(name)'));
    const after = snap(lib, 'sqlitex-after');
    const names = JSON.parse(fs.readFileSync(after, 'utf8')).schemaObjects.names;
    assert.ok(names.includes('sqlitex_user_evidence') && names.includes('sqlitex_probe_idx'), names.join(','));
    assert.ok(!names.some(n => n.startsWith('sqlite_')), 'SQLite internal objects stay out of the inventory');
    const c = H.compare({ before, after, purpose: 'unchanged' });
    assert.equal(c.verdict, 'FAIL');
    assert.ok(c.diffs.some(d => /unexpected object\(s\) not created by migrations 1–14: sqlitex_probe_idx,sqlitex_user_evidence/.test(d)), c.diffs.join('\n'));
  });

  for (const child of ['backups', '.restore-staging', '.restore-pending']) {
    it(`refuses a symlinked ${child}/ root before listing it and writes no receipt`, () => {
      const lib = H.buildScratchProfile(path.join(scratch, `runtime${child.replace(/[^a-z]+/g, '-')}`), REPO, { version: 14, populate: false });
      const outside = fs.mkdtempSync(path.join(scratch, 'outside-'));
      fs.writeFileSync(path.join(outside, 'private.txt'), 'outside the profile');
      fs.rmSync(path.join(lib.root, child), { recursive: true, force: true });
      fs.symlinkSync(outside, path.join(lib.root, child), 'dir');
      const out = fresh(`runtime-link${child.replace(/[^a-z]+/g, '-')}`);
      assert.throws(() => H.takeSnapshot(lib.root, uid, out), new RegExp(`${child.replace('.', '\\.')}/ is a symlink`));
      assert.equal(fs.existsSync(out), false);
    });
  }

  it('still records a real (non-symlinked) backups/ root as runtime disclosure', () => {
    const lib = H.buildScratchProfile(path.join(scratch, 'runtime-real'), REPO, { version: 14, populate: false });
    fs.mkdirSync(path.join(lib.root, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(lib.root, 'backups', 'note.txt'), 'x');
    const runtime = JSON.parse(fs.readFileSync(snap(lib, 'runtime-real'), 'utf8')).runtimeFiles;
    assert.ok(runtime.some(f => f.relativePath === 'backups/note.txt' && /^[0-9a-f]{64}$/.test(f.sha256)), JSON.stringify(runtime));
  });
});
