import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { linkSync, symlinkSync, renameSync } from 'node:fs';
import { validateTitle, validateVideoUrl } from './add-video-links.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts/content/add-video-links.mjs');
const M1 = 'b1000000-0000-4000-8000-000000000001';
const M2 = 'b1000000-0000-4000-8000-000000000002';
const SUM1 = 'a'.repeat(64);
const SUM2 = 'b'.repeat(64);

function setup(t, profileName = 'com.herflightdeck.synthetic.t1') {
  const home = mkdtempSync(path.join(realpathSync(tmpdir()), 'add-video-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'Library', 'Application Support', profileName);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'her-flight-deck.db'));
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(path.join(root, 'src-tauri/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(root, 'src-tauri/migrations', name), 'utf8'));
  }
  const now = new Date().toISOString();
  for (const [id, sum] of [[M1, SUM1], [M2, SUM2]]) {
    db.prepare('INSERT INTO study_materials(id,title,created_at,updated_at) VALUES (?,?,?,?)').run(id, 'Mat ' + id.slice(-1), now, now);
    db.prepare('INSERT INTO material_content_identities(material_id,content_sha256,total_pages,verified_at) VALUES (?,?,?,?)').run(id, sum, 3, now);
  }
  db.close();
  return { home, dir };
}
function manifest(home, entries) {
  const file = path.join(home, 'manifest.json');
  writeFileSync(file, JSON.stringify(entries));
  return file;
}
const entry = (over = {}) => ({ materialId: M1, sourceChecksum: SUM1, title: 'One', videos: [
  { url: 'https://example.com/a', title: 'A' }, { url: 'http://example.com/b', title: 'B' }], ...over });
function cli(home, dir, file, ...flags) {
  return spawnSync(process.execPath, [script, '--profile', dir, '--manifest', file, ...flags], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}
function links(dir) {
  const db = new DatabaseSync(path.join(dir, 'her-flight-deck.db'), { readOnly: true });
  try { return db.prepare('SELECT * FROM material_video_links ORDER BY url').all(); } finally { db.close(); }
}

test('adds links, upgrades http, uses repository id and timestamp formats', t => {
  const { home, dir } = setup(t);
  const r = cli(home, dir, manifest(home, [entry()]));
  assert.equal(r.status, 0, r.stderr);
  const rows = links(dir);
  assert.deepEqual(rows.map(x => x.url), ['https://example.com/a', 'https://example.com/b']);
  assert.match(rows[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(rows[0].created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(rows[0].created_at, rows[0].updated_at);
  assert.match(r.stdout, /added 2, skipped 0/);
});

test('refuses a profile that is not synthetic', t => {
  const { home, dir } = setup(t, 'com.herflightdeck.other');
  const r = cli(home, dir, manifest(home, [entry()]));
  assert.notEqual(r.status, 0);
  assert.equal(links(dir).length, 0);
});

test('refuses the real app id', t => {
  const { home, dir } = setup(t, 'com.herflightdeck.app');
  const r = cli(home, dir, manifest(home, [entry()]));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /real app/);
  assert.equal(links(dir).length, 0);
});

test('refuses a checksum mismatch and writes nothing', t => {
  const { home, dir } = setup(t);
  const r = cli(home, dir, manifest(home, [entry(), entry({ materialId: M2, sourceChecksum: SUM1 })]));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Checksum mismatch/);
  assert.equal(links(dir).length, 0);
});

test('refuses a missing material', t => {
  const { home, dir } = setup(t);
  const r = cli(home, dir, manifest(home, [entry({ materialId: 'b1000000-0000-4000-8000-0000000000ff' })]));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Material not found/);
  assert.equal(links(dir).length, 0);
});

test('refuses duplicate titles, bad urls and bad titles', t => {
  const { home, dir } = setup(t);
  const bad = (videos) => cli(home, dir, manifest(home, [entry({ videos })]));
  assert.notEqual(bad([{ url: 'https://x.com/1', title: 'Same' }, { url: 'https://x.com/2', title: ' same ' }]).status, 0);
  assert.notEqual(bad([{ url: 'ftp://x.com/1', title: 'A' }]).status, 0);
  assert.notEqual(bad([{ url: 'https://x.com/1', title: 'x'.repeat(201) }]).status, 0);
  assert.notEqual(bad([{ url: 'https://x.com/' + 'a'.repeat(2000), title: 'A' }]).status, 0);
  assert.equal(links(dir).length, 0);
});

test('rerun is safe: half applied completes with no duplicates', t => {
  const { home, dir } = setup(t);
  const db = new DatabaseSync(path.join(dir, 'her-flight-deck.db'));
  db.prepare('INSERT INTO material_video_links VALUES (?,?,?,?,?,?)').run('x1', M1, 'https://example.com/a', 'A', 't', 't');
  db.close();
  const file = manifest(home, [entry()]);
  const first = cli(home, dir, file);
  assert.match(first.stdout, /added 1, skipped 1/);
  const second = cli(home, dir, file);
  assert.match(second.stdout, /added 0, skipped 2/);
  assert.equal(links(dir).length, 2);
});

test('dry-run writes nothing', t => {
  const { home, dir } = setup(t);
  const r = cli(home, dir, manifest(home, [entry()]), '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would add 2/);
  assert.equal(links(dir).length, 0);
});

test('--check fails until every link is present, then passes', t => {
  const { home, dir } = setup(t);
  const file = manifest(home, [entry()]);
  assert.notEqual(cli(home, dir, file, '--check').status, 0);
  assert.equal(cli(home, dir, file).status, 0);
  const ok = cli(home, dir, file, '--check');
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /all 2 link/);
});

test('refuses when the profile files are open (app running)', t => {
  const { home, dir } = setup(t);
  const holder = spawnSync('true');
  assert.equal(holder.status, 0);
  const child = spawnSync('sh', ['-c', `exec 3<"${dir}/her-flight-deck.db"; "${process.execPath}" "${script}" --profile "${dir}" --manifest "${manifest(home, [entry()])}"`], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Close the app/);
  assert.equal(links(dir).length, 0);
});

test('validators agree with the app parity cases and repository rules', () => {
  const cases = JSON.parse(readFileSync(path.join(root, 'src/testing/videoUrlParity.json'), 'utf8'));
  for (const c of cases) {
    if (c.expected === null) assert.throws(() => validateVideoUrl(c.input), undefined, c.input);
    else assert.equal(validateVideoUrl(c.input), c.expected, c.input);
  }
  assert.equal(validateVideoUrl(' http://a.com/x '), 'https://a.com/x');
  assert.throws(() => validateVideoUrl('mailto:a@b.c'));
  assert.equal(validateTitle('  hi '), 'hi');
  assert.throws(() => validateTitle('x'.repeat(201)));
  assert.equal(validateTitle('x'.repeat(200)).length, 200);
  // The TypeScript source still carries the rules this copy mirrors.
  const src = readFileSync(path.join(root, 'src/data/repositories/materialVideoLinkRepository.ts'), 'utf8');
  assert.ok(src.includes('url.length > 2000') && src.includes('title.length > 200') && src.includes('parsed.protocol === "http:"'));
});

const dbFile = dir => path.join(dir, 'her-flight-deck.db');

test('refuses a symlinked database', t => {
  const { home, dir } = setup(t);
  renameSync(dbFile(dir), path.join(home, 'real.db'));
  symlinkSync(path.join(home, 'real.db'), dbFile(dir));
  const r = cli(home, dir, manifest(home, [entry()]));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /symbolic link/);
});

test('refuses a hard-linked database', t => {
  const { home, dir } = setup(t);
  linkSync(dbFile(dir), path.join(home, 'alias.db'));
  const r = cli(home, dir, manifest(home, [entry()]), '--check');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /hard link/);
});

test('--check reports wrong title, extra link and missing material', t => {
  const { home, dir } = setup(t);
  const file = manifest(home, [entry()]);
  assert.equal(cli(home, dir, file).status, 0);
  const db = new DatabaseSync(dbFile(dir));
  db.prepare('UPDATE material_video_links SET title = ? WHERE url = ?').run('Renamed', 'https://example.com/a');
  db.prepare('INSERT INTO material_video_links VALUES (?,?,?,?,?,?)').run('x9', M1, 'https://example.com/extra', 'Extra', 't', 't');
  db.close();
  const r = cli(home, dir, file, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /wrong title/);
  assert.match(r.stdout, /extra:/);
  const gone = cli(home, dir, manifest(home, [entry({ materialId: 'b1000000-0000-4000-8000-0000000000ff' })]), '--check');
  assert.notEqual(gone.status, 0);
  assert.match(gone.stderr, /Material not found/);
});

test('--check reports a missing link', t => {
  const { home, dir } = setup(t);
  const r = cli(home, dir, manifest(home, [entry()]), '--check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing:/);
});

test('refuses a material with no identity row and no stored file', t => {
  const { home, dir } = setup(t);
  const db = new DatabaseSync(dbFile(dir));
  db.prepare('DELETE FROM material_content_identities WHERE material_id = ?').run(M1);
  db.close();
  const r = cli(home, dir, manifest(home, [entry()]));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No checksum/);
  assert.equal(links(dir).length, 0);
});

test('no identity row: uses the stored file sha256 (match adds, mismatch refuses)', t => {
  const { home, dir } = setup(t);
  mkdirSync(path.join(dir, 'documents'));
  writeFileSync(path.join(dir, 'documents', 'one.pdf'), 'hello');
  const sum = createHash('sha256').update('hello').digest('hex');
  const db = new DatabaseSync(dbFile(dir));
  db.prepare('DELETE FROM material_content_identities WHERE material_id = ?').run(M1);
  db.prepare('UPDATE study_materials SET file_path = ? WHERE id = ?').run('one.pdf', M1);
  db.close();
  const bad = cli(home, dir, manifest(home, [entry()]));
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Checksum mismatch/);
  assert.equal(links(dir).length, 0);
  const ok = cli(home, dir, manifest(home, [entry({ sourceChecksum: sum })]));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(links(dir).length, 2);
});

test('a recorded identity wins over the stored file', t => {
  const { home, dir } = setup(t);
  mkdirSync(path.join(dir, 'documents'));
  writeFileSync(path.join(dir, 'documents', 'one.pdf'), 'hello');
  const db = new DatabaseSync(dbFile(dir));
  db.prepare('UPDATE study_materials SET file_path = ? WHERE id = ?').run('one.pdf', M1);
  db.close();
  const r = cli(home, dir, manifest(home, [entry({ sourceChecksum: createHash('sha256').update('hello').digest('hex') })]));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Checksum mismatch/);
});

test('--print-checksums hashes the real file and flags a mismatch', t => {
  const { home, dir } = setup(t);
  mkdirSync(path.join(dir, 'documents'));
  writeFileSync(path.join(dir, 'documents', 'one.pdf'), 'hello');
  writeFileSync(path.join(dir, 'documents', 'two.pdf'), 'world');
  const sum = createHash('sha256').update('hello').digest('hex');
  const db = new DatabaseSync(dbFile(dir));
  db.prepare('UPDATE study_materials SET file_path = ? WHERE id = ?').run('one.pdf', M1);
  db.prepare('UPDATE study_materials SET file_path = ? WHERE id = ?').run('two.pdf', M2);
  db.prepare('UPDATE material_content_identities SET content_sha256 = ? WHERE material_id = ?').run(sum, M1);
  db.close();
  const r = spawnSync(process.execPath, [script, '--profile', dir, '--print-checksums'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  const lines = r.stdout.split('\n');
  assert.ok(lines.find(l => l.startsWith(M1) && l.includes(sum) && l.endsWith('\tok')));
  assert.ok(lines.find(l => l.startsWith(M2) && l.endsWith('\tMISMATCH')));
});
