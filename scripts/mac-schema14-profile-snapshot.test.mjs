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
import { compareDependencyLock, recognizeBuildOutput, walkerSensitivity, writeDisposableHelper } from './mac-schema14-verification-proof.mjs';

const REPO = process.cwd();
const HELPER = path.join(REPO, 'scripts', 'mac-schema14-profile-snapshot.mjs');
const RUNNER = path.join(REPO, 'scripts', 'mac-schema14-verification-proof.mjs');
const OPERATOR_ENTRY = '// @hfd-schema14-operator-entry';
const PR142 = path.join(REPO, 'docs', 'evidence', 'mac-installed-results-2026-10-11');
const RECEIPT_KEYS = ['last_complete_backup_at', 'last_complete_backup_path', 'last_complete_backup_version'];

/** The frozen helper's live-source anchors that alarm once a schema-15 migration is registered. */
const LATER_SCHEMA_ALARMS = [
  "anchor: CURRENT_SCHEMA_VERSION in the shipped source equals this helper's pinned ceiling",
  'anchor: the registered migrations are exactly the pinned 1–14 with their descriptions',
  'anchor: shipped migration files match migration-checksums.json and the pinned SHA-256/SQLx SHA-384 checksums',
  'anchor: every pinned object definition equals what the shipped migrations create (97 objects, none redefined after schema 12)',
];
const SCHEMA15_OBJECTS = [
  'material_content_identities', 'idx_material_content_sha', 'material_reading_state', 'idx_material_reading_state_owner',
  'material_bookmarks', 'idx_material_bookmarks_material', 'idx_material_bookmarks_page', 'idx_material_bookmarks_hash',
  'material_operation_claims',
];
// Migration 16 (OFFLINE-03a) adds four tables and an index, and adds columns to
// ai_study_sets (schema 7) and material_bookmarks (schema 15).
const SCHEMA16_OBJECTS = ['study_set_history', 'idx_study_set_history', 'card_version_origins', 'card_item_origins', 'practice_item_origins'];
// Migration 17 (OFFLINE-03b) adds a table and an index, and adds columns to
// practice_tests and practice_test_items (schema 9).
const SCHEMA17_OBJECTS = ['practice_save_operations', 'idx_practice_save_ops_material'];
// Migration 18 adds only the two PDF-kit source tables and their material index.
const SCHEMA20_OBJECTS = ['homework_assignments', 'homework_activities', 'homework_runs', 'idx_homework_run_open',
  'homework_operations', 'homework_history', 'homework_history_no_update', 'homework_history_no_delete',
  'idx_homework_activity_order', 'idx_homework_due', 'idx_homework_lesson', 'idx_homework_material',
  'idx_homework_test', 'idx_homework_operations_assignment'];
const SCHEMA18_OBJECTS = ['pdf_kit_runs', 'pdf_kit_item_sources', 'idx_pdf_kit_runs_material'];

/** Each alarm's detail names only the later schemas 15 through 28: migrations 1–14 and their objects still match. */
function assertOnlyLaterSchemas(checks) {
  for (const c of checks) {
    if (c.name === LATER_SCHEMA_ALARMS[0]) assert.equal(c.detail.found, '31');
    else if (c.name === LATER_SCHEMA_ALARMS[1]) assert.deepEqual(c.detail.registered.slice(14), ['15:document_navigation', '16:manual_study', '17:practice_authoring', '18:pdf_kit_provenance', '19:study_set_save_receipts', '20:homework', '21:flight_schools', '22:journal_school', '23:homework_answers', '24:study_page_sources', '25:oral_scenarios', '26:visual_card_regions', '27:faa_reference_copies', '28:practice_item_acs_tasks', '29:material_video_links', '30:student_pilot_steps', '31:faa_downloads']);
    else if (c.name === LATER_SCHEMA_ALARMS[2]) assert.deepEqual(c.detail.map(m => m.version), [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    else if (c.name === LATER_SCHEMA_ALARMS[3]) {
      assert.deepEqual(c.detail.drift, ['journal_entries', 'ai_study_sets', 'practice_tests', 'practice_test_items', ...SCHEMA15_OBJECTS, ...SCHEMA16_OBJECTS, ...SCHEMA17_OBJECTS, ...SCHEMA18_OBJECTS, 'study_set_save_operations', ...SCHEMA20_OBJECTS, 'flight_schools', 'study_page_sources', 'study_page_source_bindings', 'collect_study_page_sources', 'erase_frozen_card_page_sources', 'erase_material_card_page_sources', 'oral_scenarios', 'idx_oral_scenario_order', 'oral_scenario_versions', 'oral_save_operations', 'visual_card_regions', 'visual_regions_owner', 'card_item_visual_regions', 'faa_reference_copies', 'practice_item_acs_tasks', 'material_video_links', 'idx_material_video_links_material', 'student_pilot_steps', 'faa_downloads']);
      assert.deepEqual(c.detail.redefinedAfterBaseline, ['ai_study_sets@16', 'material_bookmarks@16', 'practice_tests@17', 'practice_test_items@17', 'journal_entries@22', 'homework_activities@23']);
    } else assert.fail(`unexpected failing check: ${c.name}`);
  }
}

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
    // The helper stays frozen at schema 14. Since migrations 15, 16, 17 and 18 shipped in source, exactly its
    // four live-source anchors alarm, and each names only those later schemas (the historical-ceiling
    // alarm, in the manner of the schema-13 helper's). Every other regression must still pass.
    const failed = report.checks.filter(c => !c.pass);
    assert.deepEqual(failed.map(c => c.name), LATER_SCHEMA_ALARMS, failed.map(c => c.name).join('; '));
    assertOnlyLaterSchemas(failed);
    assert.equal(r.status, 1);
    assert.equal(report.counts.failed, LATER_SCHEMA_ALARMS.length);
    assert.ok(report.counts.checks >= 97, `${report.counts.checks} checks`);
    assert.equal(report.pinnedCommit, '8a260c0b32bc213850ed85bf9488d6ef571354a9');
  });
});

describe('full self-check reporting', () => {
  it('reports lost special keys as named failures, completes all checks and exits nonzero', () => {
    const dir = path.join(scratch, 'full-selfcheck-lost-key');
    fs.mkdirSync(dir);
    const file = writeDisposableHelper(dir, {
      entry: 'selfCheck();',
      edit: { from: 'const out = Object.create(null);', to: 'const out = {};' },
    });
    const result = cli([], file);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout); // An uncaught refusal produced no report before F3.
    assert.equal(report.allPassed, false);
    assert.ok(report.counts.checks >= 102);
    assert.ok(report.counts.failed > 0);
    const named = name => {
      const check = report.checks.find(c => c.name === name);
      assert.ok(check, `missing check: ${name}`);
      return check;
    };
    assert.equal(named('metadata: __proto__, constructor, toString and a Unicode key are captured as own digests and counts agree').pass, false);
    assert.equal(named('comparison: upgrade accepts its snapshots for upgrade').pass, false);
    assert.match(named('comparison: upgrade accepts its snapshots for upgrade').detail.refusal, /keyDigests lists 4 keys but the table has 5 rows/);
    assert.equal(named('contract upgrade: no receipt key is set aside outside restore').pass, false);
    // A later-schema alarm since migrations 15, 16, 17 and 18 (see LATER_SCHEMA_ALARMS), not caused by this edit.
    assert.equal(named('anchor: the registered migrations are exactly the pinned 1–14 with their descriptions').pass, false);
    assertOnlyLaterSchemas([named('anchor: the registered migrations are exactly the pinned 1–14 with their descriptions')]);
    assert.equal(named('scratch leak check: no WAL-copy scratch directory survived the run').pass, true);
    assert.doesNotMatch(result.stderr, /Error: REFUSED:|at selfCheck \(/);
  });

  it('runs the historical schema13 self-check with only its intentional schema-ceiling alarm', () => {
    const result = cli(['self-check'], path.join(REPO, 'scripts/mac-schema13-profile-snapshot.mjs'));
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    const failed = report.checks.filter(c => !c.pass).map(c => c.name);
    assert.deepEqual(failed, ["anchor: CURRENT_SCHEMA_VERSION in the shipped source still equals this helper's constant"]);
    assert.equal(report.counts.passed, 105);
    assert.equal(report.counts.failed, 1);
    assert.ok(report.checks.filter(c => /special metadata key/.test(c.name)).every(c => c.pass));
  });
});

describe('proof source walker', () => {
  it('sets aside genuine Cargo/Tauri build output but reports unexpected source and changed protected files', () => {
    const dir = path.join(scratch, 'walker');
    fs.mkdirSync(dir);
    const cases = walkerSensitivity(dir);
    assert.equal(cases.length, 17);
    for (const c of cases) assert.ok(c.pass, `${c.name}: changed ${JSON.stringify(c.changed)}, accepted ${JSON.stringify(c.accepted)}`);
    const byName = Object.fromEntries(cases.map(c => [c.name, c]));
    assert.deepEqual(byName['accepted: genuine Cargo target and Tauri gen schemas'].changed, []);
    assert.ok(byName['refused: source inside Tauri gen'].changed.includes('src-tauri/gen/schemas/payload.mjs'));
    assert.deepEqual(byName['refused: changed protected migration beside accepted build output'].changed, ['src-tauri/migrations/0001_initial_schema.sql']);
    assert.deepEqual(byName['accepted: Apple Silicon target output beside host output'].changed, []);
    assert.ok(byName['refused: unknown target name in Cargo target'].changed.includes('src-tauri/target/x86_64-apple-darwin/release/libz.rlib'));
    assert.ok(byName['refused: source beside the Apple Silicon target profile'].changed.includes('src-tauri/target/aarch64-apple-darwin/build.rs'));
  });

  it('recognizes Cargo\'s Apple Silicon target folder only in its exact tagged shape', () => {
    const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    const TAG = 'Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n# For information about cache directory tags see https://bford.info/cachedir/\n';
    const TRIPLE = 'src-tauri/target/aarch64-apple-darwin';
    const put = (root, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body, { flag: 'wx' }); };
    const tree = (name, edit) => {
      const root = path.join(scratch, `target-shape-${name}`);
      fs.mkdirSync(root);
      put(root, '.gitignore', ignore);
      put(root, 'src-tauri/target/CACHEDIR.TAG', TAG);
      put(root, 'src-tauri/target/release/deps/libhost.rlib', 'rlib');
      put(root, `${TRIPLE}/CACHEDIR.TAG`, TAG);
      put(root, `${TRIPLE}/release/deps/libx.rlib`, 'rlib');
      put(root, `${TRIPLE}/release/.cargo-lock`, '');
      // Cargo hard-links its own outputs inside a profile; the profile is not descended.
      fs.linkSync(path.join(root, `${TRIPLE}/release/deps/libx.rlib`), path.join(root, `${TRIPLE}/release/libx.rlib`));
      const tracked = edit?.(root) ?? new Set();
      return recognizeBuildOutput(root, 'src-tauri/target', tracked);
    };

    const genuine = tree('genuine');
    assert.equal(genuine.recognized, true, genuine.reason);
    assert.deepEqual(genuine.targets, [{ triple: 'aarch64-apple-darwin', entries: ['CACHEDIR.TAG', 'release'] }]);
    const both = tree('both-profiles', root => { put(root, `${TRIPLE}/debug/deps/liby.rlib`, 'rlib'); });
    assert.equal(both.recognized, true, both.reason);

    const refused = [
      ['an unknown target name', root => { put(root, 'src-tauri/target/x86_64-apple-darwin/CACHEDIR.TAG', TAG); }, /unexpected top-level entries: x86_64-apple-darwin/],
      ['a lookalike target name', root => { put(root, 'src-tauri/target/aarch64-apple-darwin-x/CACHEDIR.TAG', TAG); }, /unexpected top-level entries: aarch64-apple-darwin-x/],
      ['an unexpected file at the target root', root => { put(root, 'src-tauri/target/notes.md', 'x'); }, /unexpected top-level entries: notes\.md/],
      ['an unexpected file beside the target profiles', root => { put(root, `${TRIPLE}/build.rs`, 'fn main() {}'); }, /aarch64-apple-darwin: unexpected entries: build\.rs/],
      ['an unknown directory beside the target profiles', root => { fs.mkdirSync(path.join(root, `${TRIPLE}/src`)); }, /aarch64-apple-darwin: unexpected entries: src/],
      ['a target folder that is a file', root => { fs.rmSync(path.join(root, TRIPLE), { recursive: true }); put(root, TRIPLE, 'x'); }, /aarch64-apple-darwin is not a real directory/],
      ['a symlinked target folder', root => { const real = path.join(scratch, `elsewhere-${++counter}`); fs.renameSync(path.join(root, TRIPLE), real); fs.symlinkSync(real, path.join(root, TRIPLE)); }, /aarch64-apple-darwin is not a real directory/],
      ['a symlinked target profile', root => { const real = path.join(scratch, `elsewhere-${++counter}`); fs.renameSync(path.join(root, `${TRIPLE}/release`), real); fs.symlinkSync(real, path.join(root, `${TRIPLE}/release`)); }, /aarch64-apple-darwin\/release is not a real directory/],
      ['a missing target cache tag', root => { fs.rmSync(path.join(root, `${TRIPLE}/CACHEDIR.TAG`)); }, /aarch64-apple-darwin: no single-linked Cargo CACHEDIR\.TAG/],
      ['an invalid target cache tag', root => { fs.writeFileSync(path.join(root, `${TRIPLE}/CACHEDIR.TAG`), 'Signature: 0000\n'); }, /aarch64-apple-darwin: no single-linked Cargo CACHEDIR\.TAG/],
      ['a symlinked target cache tag', root => { fs.rmSync(path.join(root, `${TRIPLE}/CACHEDIR.TAG`)); fs.symlinkSync(path.join(root, 'src-tauri/target/CACHEDIR.TAG'), path.join(root, `${TRIPLE}/CACHEDIR.TAG`)); }, /aarch64-apple-darwin: no single-linked Cargo CACHEDIR\.TAG/],
      ['a hard-linked target cache tag', root => { fs.linkSync(path.join(root, `${TRIPLE}/CACHEDIR.TAG`), path.join(scratch, `tag-link-${++counter}`)); }, /aarch64-apple-darwin: no single-linked Cargo CACHEDIR\.TAG/],
      ['a tracked path inside the target folder', () => new Set([`${TRIPLE}/release/deps/libx.rlib`]), /a tracked path lies inside it/],
      ['a missing top-level cache tag', root => { fs.rmSync(path.join(root, 'src-tauri/target/CACHEDIR.TAG')); }, /^no single-linked Cargo CACHEDIR\.TAG$/],
    ];
    for (const [name, edit, reason] of refused) {
      const found = tree(name.replace(/[^a-z]+/g, '-'), edit);
      assert.equal(found.recognized, false, `${name} was accepted`);
      assert.match(found.reason, reason, `${name}: ${found.reason}`);
    }
  });

  it('recognizes only the two exact build-output paths, and this checkout\'s real ones when present', () => {
    assert.equal(recognizeBuildOutput(REPO, 'src-tauri/src', new Set()).recognized, false);
    assert.equal(recognizeBuildOutput(REPO, 'target', new Set()).recognized, false);
    for (const rel of ['src-tauri/target', 'src-tauri/gen/schemas']) {
      if (!fs.existsSync(path.join(REPO, rel))) continue;
      const found = recognizeBuildOutput(REPO, rel, new Set());
      assert.equal(found.recognized, true, `${rel}: ${found.reason}`);
      assert.equal(recognizeBuildOutput(REPO, rel, new Set([`${rel}/tracked.txt`])).recognized, false, rel);
    }
  });
});

describe('post-merge replay dependency lock (QA-02)', () => {
  // Built from this checkout's own lock, so CI's shallow clone needs no history.
  const baseline = fs.readFileSync(path.join(REPO, 'package-lock.json'));
  const lock = () => JSON.parse(baseline.toString('utf8'));
  const text = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const bumped = version => { const l = lock(); l.version = version; l.packages[''].version = version; return l; };
  const firstDependency = l => Object.keys(l.packages).find(k => k.startsWith('node_modules/') && l.packages[k].integrity && l.packages[k].resolved);

  it('accepts an identical lock and a version-only bump of both root fields', () => {
    assert.equal(baseline.toString('utf8'), text(lock()).toString('utf8'), 'the checked-in lock is in npm canonical form');
    assert.deepEqual(compareDependencyLock(baseline, baseline), { ok: true, baselineVersion: lock().version, candidateVersion: lock().version, versionOnly: false });
    const r = compareDependencyLock(baseline, text(bumped('9.9.9')));
    assert.deepEqual(r, { ok: true, baselineVersion: lock().version, candidateVersion: '9.9.9', versionOnly: true });
  });

  it('refuses any other difference, including dependency, integrity, resolution and inconsistent root versions', () => {
    const cases = [
      ['a direct dependency added', l => { l.packages[''].dependencies = { ...l.packages[''].dependencies, 'left-pad': '^1.3.0' }; }, /more than the application version/],
      ['a direct dependency range changed', l => { const [name] = Object.keys(l.packages[''].dependencies); l.packages[''].dependencies[name] = '*'; }, /more than the application version/],
      ['a transitive package version changed', l => { l.packages[firstDependency(l)].version = '0.0.0-tampered'; }, /more than the application version/],
      ['a package integrity changed', l => { l.packages[firstDependency(l)].integrity = 'sha512-tampered'; }, /more than the application version/],
      ['a package resolution changed', l => { l.packages[firstDependency(l)].resolved = 'https://example.invalid/pkg.tgz'; }, /more than the application version/],
      ['a package removed', l => { delete l.packages[firstDependency(l)]; }, /more than the application version/],
      ['the lock name changed', l => { l.name = 'someone-else'; l.packages[''].name = 'someone-else'; }, /more than the application version/],
      ['only the top-level version bumped', l => { l.packages[''].version = lock().version; }, /candidate lock root versions disagree/],
      ['only packages[""] version bumped', l => { l.version = lock().version; }, /candidate lock root versions disagree/],
      ['root version fields removed', l => { delete l.version; delete l.packages[''].version; }, /candidate lock lacks the root version fields/],
    ];
    for (const [name, edit, reason] of cases) {
      const l = bumped('9.9.9');
      edit(l);
      const r = compareDependencyLock(baseline, text(l));
      assert.equal(r.ok, false, `${name} was accepted`);
      assert.match(r.reason, reason, `${name}: ${r.reason}`);
    }
    const reformatted = Buffer.from(JSON.stringify(bumped('9.9.9'), null, 4) + '\n');
    assert.match(compareDependencyLock(baseline, reformatted).reason, /more than the application version/);
    assert.match(compareDependencyLock(baseline, Buffer.from('{ not json')).reason, /candidate package-lock.json is not JSON/);
    assert.match(compareDependencyLock(Buffer.from(JSON.stringify(lock())), baseline).reason, /baseline lock is not in npm's canonical form/);
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
