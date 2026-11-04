import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { buildPdf, FIXTURE_SPECS } from './generate-pdf-fixtures.mjs';
import { profilePath, seedProfile } from './seed-sample-profile.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/seed-sample-profile.mjs');
const dbName = 'her-flight-deck.db';
const materialId = 'a1000000-0000-4000-8000-000000000001';
function temporary(t) {
  const home = mkdtempSync(path.join(realpathSync(tmpdir()), 'qa-sample-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}
function cli(home, ...args) {
  return spawnSync(process.execPath, [script, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}
function contents(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e =>
    [e.name, e.isDirectory() ? contents(path.join(dir, e.name)) : readFileSync(path.join(dir, e.name)).toString('base64')]);
}
function counts(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const tables = ['study_materials', 'ai_study_sets', 'card_items', 'card_review_state', 'card_review_events', 'practice_tests', 'practice_test_versions', 'practice_test_items', 'practice_attempts', 'practice_responses', 'oral_scenarios', 'visual_card_regions', 'card_item_visual_regions', 'journal_entries', 'homework_assignments', 'homework_activities'];
    return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  } finally { db.close(); }
}

test('real identifiers, foreign identifiers, paths, traversal and invalid arguments refuse with no writes', t => {
  const home = temporary(t);
  const real = path.join(home, 'Library', 'Application Support', 'com.herflightdeck.app');
  mkdirSync(real, { recursive: true }); writeFileSync(path.join(real, 'keep'), 'fictional sentinel');
  const before = contents(home);
  for (const id of ['com.herflightdeck.app', 'com.example.synthetic.qa', '../qa', '/tmp/com.herflightdeck.synthetic.qa', 'com.herflightdeck.synthetic.', 'com.herflightdeck.synthetic.qa/../app', '--unknown', 'qa.with.dots']) {
    const result = cli(home, id, '--reset');
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(contents(home), before);
  }
  assert.equal(cli(home).status, 2);
  assert.equal(cli(home, 'qa', '--reset', '--reset').status, 2);
  assert.equal(profilePath('qa', home), profilePath('com.herflightdeck.synthetic.qa', home));
});

test('symlink targets, parents and internal files refuse before reset or writes', async t => {
  const home = temporary(t);
  const real = path.join(home, 'real-sentinel'); mkdirSync(real); writeFileSync(path.join(real, 'keep'), 'keep');
  const target = profilePath('links', home); mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(real, target);
  await assert.rejects(seedProfile('links', { home, reset: true }), { exitCode: 2 });
  rmSync(target); mkdirSync(target); symlinkSync(real, path.join(target, 'documents'));
  await assert.rejects(seedProfile('links', { home, reset: true }), { exitCode: 2 });
  rmSync(target, { recursive: true }); rmSync(path.dirname(target), { recursive: true });
  symlinkSync(real, path.dirname(target));
  await assert.rejects(seedProfile('links', { home }), { exitCode: 2 });
  assert.equal(readFileSync(path.join(real, 'keep'), 'utf8'), 'keep');
});

test('fresh profile, semantic validation, unchanged second run, running refusal and isolated reset', async t => {
  const home = temporary(t);
  const result = cli(home, 'student');
  assert.equal(result.status, 0, result.stderr);
  const target = profilePath('student', home);
  const filename = path.join(target, dbName);
  const expected = { study_materials: 2, ai_study_sets: 1, card_items: 12, card_review_state: 12, card_review_events: 12, practice_tests: 1, practice_test_versions: 1, practice_test_items: 4, practice_attempts: 1, practice_responses: 4, oral_scenarios: 1, visual_card_regions: 1, card_item_visual_regions: 1, journal_entries: 1, homework_assignments: 1, homework_activities: 1 };
  assert.deepEqual(counts(filename), expected);
  const db = new DatabaseSync(filename);
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const files = JSON.parse(readFileSync(path.join(root, 'src/data/migration-checksums.json')));
    const applied = db.prepare('SELECT * FROM _sqlx_migrations ORDER BY version').all();
    assert.equal(applied.length, Object.keys(files).length);
    for (const row of applied) {
      const name = Object.keys(files).find(n => Number(n.slice(0, 4)) === row.version);
      const sql = readFileSync(path.join(root, 'src-tauri/migrations', name), 'utf8').replace(/\r\n?/g, '\n');
      assert.equal(createHash('sha256').update(sql).digest('hex'), files[name]);
      assert.deepEqual(Buffer.from(row.checksum), createHash('sha384').update(sql).digest());
      assert.equal(row.success, 1);
    }
    assert.deepEqual({ ...db.prepare('SELECT status,correct_count,incorrect_count,score_percent FROM practice_attempts').get() }, { status: 'completed', correct_count: 2, incorrect_count: 2, score_percent: 50 });
    const [picture] = db.prepare('SELECT flashcards_json FROM ai_study_sets').all();
    assert.equal(JSON.parse(picture.flashcards_json).at(-1).sourcePage, 2);
    const pdf = readFileSync(path.join(target, 'documents/qa-sample-weather.pdf'), 'latin1');
    assert.match(pdf, /\/Count 3/); assert.match(pdf, /Fictional weather exercise/); assert.match(pdf, /300 60 re f/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='oral_answers'").get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM oral_answers').get().n, 0);
    const before = contents(target);
    for (const reset of [false, true]) {
      const busy = cli(home, 'student', ...(reset ? ['--reset'] : []));
      assert.equal(busy.status, 2, busy.stderr);
      assert.equal(busy.stderr.trim(), 'Close the app for this synthetic profile before seeding.');
      assert.deepEqual(contents(target), before);
    }
  } finally { db.close(); }
  const before = contents(target);
  assert.equal(cli(home, 'student').status, 0);
  assert.deepEqual(counts(filename), expected);
  assert.deepEqual(contents(target), before);

  const { createServer } = await import('vite');
  const server = await createServer({ root, configFile: false, resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
  try {
    const { inspectPng } = await server.ssrLoadModule('/src/logic/visualPng.ts');
    assert.deepEqual(inspectPng(readFileSync(path.join(target, 'documents/qa-sample-airspace.png'))), { width: 300, height: 200 });
    const { createNodeSqliteDatabase } = await server.ssrLoadModule('/src/data/testing/nodeSqliteDb.ts');
    // This open invokes validateApplicationDatabase against the real migration reference.
    const app = await createNodeSqliteDatabase(filename);
    try {
      const { cardReviewRepository } = await server.ssrLoadModule('/src/data/repositories/cardReviewRepository.ts');
      const cards = cardReviewRepository(app);
      const snapshot = await cards.getCardReviewSnapshot(materialId);
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      const queueInput = { materialId, currentVersionId: snapshot.current.versionId, currentItemIds: snapshot.current.items.map(i => i.itemId), nowUtc: new Date().toISOString(), nextLocalMidnightUtc: midnight.toISOString() };
      const due = await cards.getDueQueue(queueInput);
      assert.equal(due.length, 5);
      for (const item of due) await cards.saveAction({ action: 'rate', operationId: crypto.randomUUID(), materialId, versionContentHash: snapshot.current.contentHash, itemId: item.itemId, expectedGeneration: snapshot.generation, expectedRevision: snapshot.states[item.itemId].revision, rating: 'easy' });
      assert.equal((await cards.getDueQueue(queueInput)).length, 0);
    } finally { app.close(); }
    const validated = await createNodeSqliteDatabase(filename); validated.close();
  } finally { await server.close(); }
  const neighbor = profilePath('neighbor', home); mkdirSync(neighbor); writeFileSync(path.join(neighbor, 'keep'), 'keep');
  writeFileSync(path.join(target, 'remove-on-reset'), 'discard');
  assert.equal(cli(home, 'student', '--reset').status, 0);
  assert.deepEqual(counts(filename), expected);
  assert.equal(existsSync(path.join(target, 'remove-on-reset')), false);
  assert.equal(readFileSync(path.join(neighbor, 'keep'), 'utf8'), 'keep');
  assert.deepEqual(readdirSync(path.dirname(target)).sort(), [path.basename(neighbor), path.basename(target)].sort());
});

test('an existing native profile is upgraded and unrelated fictional rows survive', t => {
  const home = temporary(t);
  const target = profilePath('existing', home); mkdirSync(target, { recursive: true });
  const filename = path.join(target, dbName);
  const db = new DatabaseSync(filename);
  try {
    const sql = readFileSync(path.join(root, 'src-tauri/migrations/0001_initial_schema.sql'), 'utf8');
    db.exec(sql);
    db.exec(`CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY,description TEXT NOT NULL,installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,success BOOLEAN NOT NULL,checksum BLOB NOT NULL,execution_time BIGINT NOT NULL)`);
    db.prepare('INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES (1,?,1,?,0)').run('initial_schema', createHash('sha384').update(sql).digest());
    db.exec("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES ('fictional-keep','Fictional existing material','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
  } finally { db.close(); }
  writeFileSync(path.join(target, 'keep.txt'), 'fictional existing file');
  const result = cli(home, 'existing');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(counts(filename).study_materials, 3);
  assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'fictional existing file');
});

test('bad applied checksums and damaged practice state leave the original profile untouched', t => {
  const home = temporary(t);
  assert.equal(cli(home, 'damaged').status, 0);
  const target = profilePath('damaged', home);
  const filename = path.join(target, dbName);
  let db = new DatabaseSync(filename);
  const originalChecksum = db.prepare('SELECT checksum FROM _sqlx_migrations WHERE version=1').get().checksum;
  db.prepare('UPDATE _sqlx_migrations SET checksum=? WHERE version=1').run(Buffer.alloc(48)); db.close();
  let before = contents(target);
  let result = cli(home, 'damaged');
  assert.equal(result.status, 1); assert.match(result.stderr, /Applied migration checksum differs/);
  assert.deepEqual(contents(target), before);
  db = new DatabaseSync(filename);
  db.prepare('UPDATE _sqlx_migrations SET checksum=? WHERE version=1').run(originalChecksum);
  db.exec('UPDATE practice_attempts SET correct_count=0'); db.close();
  before = contents(target); result = cli(home, 'damaged');
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(contents(target), before);
});


test('the existing PDF generator fixtures keep their published bytes and hashes', () => {
  for (const f of FIXTURE_SPECS.filter(f => f.freeEntries === undefined)) {
    const bytes = buildPdf(f.pages, f.imgW, f.imgH, f.label);
    assert.equal(bytes.length, f.expectedBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), f.expectedSha256);
  }
});
