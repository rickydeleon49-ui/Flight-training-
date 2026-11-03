import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { buildPdf } from './generate-pdf-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'com.herflightdeck.synthetic.';
const dbName = 'her-flight-deck.db';
let DatabaseSync;
const marker = '.qa-sample-01.json';
const materialId = 'a1000000-0000-4000-8000-000000000001';
const imageId = 'a1000000-0000-4000-8000-000000000002';
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest();
const refuse = (message) => { throw Object.assign(new Error(message), { exitCode: 2 }); };

export function profilePath(id, home = homedir()) {
  // Accept a short profile id or its full synthetic identifier, never a path.
  if (typeof id !== 'string') refuse('Use a synthetic profile id.');
  const suffix = id.startsWith(prefix) ? id.slice(prefix.length) : id;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(suffix) || id.startsWith('com.') && !id.startsWith(prefix)) {
    refuse('Use a synthetic profile id.');
  }
  return path.join(home, 'Library', 'Application Support', prefix + suffix);
}

function noSymlinks(target) {
  for (let current = target; ; current = path.dirname(current)) {
    let stat;
    try { stat = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) refuse('Synthetic profile paths must not contain symbolic links.');
    if (path.dirname(current) === current) break;
  }
}

function checkTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) refuse('Synthetic profiles must contain only ordinary files and directories.');
    if (entry.isDirectory()) checkTree(name);
  }
}

async function assertClosed(dir) {
  if (!existsSync(dir)) return;
  // lsof also catches an idle app whose SQLite connection holds no write lock.
  const result = spawnSync('lsof', ['-t', '+D', dir], { encoding: 'utf8' });
  if (result.error || ![0, 1].includes(result.status)) refuse('Could not check whether the synthetic profile is running.');
  if (result.stdout.trim()) refuse('Close the app for this synthetic profile before seeding.');
  const filename = path.join(dir, dbName);
  if (existsSync(filename)) {
    DatabaseSync ??= (await import('node:sqlite')).DatabaseSync;
    let db;
    try {
      db = new DatabaseSync(filename, { readOnly: true });
      db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK');
    } catch {
      refuse('Close the app for this synthetic profile before seeding.');
    } finally { db?.close(); }
  }
}

function migrationFiles() {
  const recorded = JSON.parse(readFileSync(path.join(root, 'src/data/migration-checksums.json'), 'utf8'));
  const names = readdirSync(path.join(root, 'src-tauri/migrations')).filter(n => n.endsWith('.sql')).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(recorded).sort())) throw Error('Migration checksum inventory differs.');
  return names.map(name => {
    const sql = readFileSync(path.join(root, 'src-tauri/migrations', name), 'utf8').replace(/\r\n?/g, '\n');
    if (hash(sql).toString('hex') !== recorded[name]) throw Error('Migration checksum differs: ' + name);
    return { version: Number(name.slice(0, 4)), description: name.slice(5, -4), sql };
  });
}

function nativeMigrations(filename, migrations) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(`PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS _sqlx_migrations (
        version BIGINT PRIMARY KEY, description TEXT NOT NULL,
        installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL);`);
    const applied = db.prepare('SELECT * FROM _sqlx_migrations ORDER BY version').all();
    for (const row of applied) {
      const m = migrations.find(m => m.version === row.version);
      if (!m || !row.success || !Buffer.from(row.checksum).equals(hash(m.sql, 'sha384'))) throw Error('Applied migration checksum differs.');
    }
    for (const m of migrations) {
      if (!applied.some(row => row.version === m.version)) {
        db.exec(m.sql);
        db.prepare('INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES (?,?,1,?,0)')
          .run(m.version, m.description, hash(m.sql, 'sha384'));
      }
      db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?,?,?)').run(m.version, m.description, new Date().toISOString());
    }
    db.exec('COMMIT');
  } finally { db.close(); }
}

// A simple fictional airspace band, also described on page two of the PDF.
function picturePng() {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, tail]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(300); header.writeUInt32BE(200, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(200 * 901);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) {
    const color = y >= 70 && y < 130 ? [120, 70, 170] : [220, 235, 245];
    color.forEach((c, i) => { pixels[y * 901 + 1 + x * 3 + i] = c; });
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function seedData(load, filename, dir) {
  const { createNodeSqliteDatabase } = await load('src/data/testing/nodeSqliteDb.ts');
  const db = await createNodeSqliteDatabase(filename);
  try {
    if (existsSync(path.join(dir, marker))) return;
    const { documentRepository } = await load('src/data/repositories/documentRepository.ts');
    const { profileRepository } = await load('src/data/repositories/profileRepository.ts');
    const { journalRepository } = await load('src/data/repositories/journalRepository.ts');
    const { oralScenarioRepository } = await load('src/data/repositories/oralScenarioRepository.ts');
    const { practiceSessionRepository } = await load('src/data/repositories/practiceSessionRepository.ts');
    const { cardReviewRepository } = await load('src/data/repositories/cardReviewRepository.ts');
    const { executeCardReviewAction } = await load('src/data/cardReviewTransaction.ts');
    const { visualRegionHash } = await load('src/data/visualCards.ts');
    const docs = documentRepository(db);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const lines = [
      ['Fictional weather exercise. Study aid; check with your instructor.', 'At imaginary Meadow Field, clouds build during the afternoon.', 'Compare a current briefing with the planned route and alternatives.', 'A changing ceiling calls for a new decision before departure.'],
      ['Fictional airspace exercise. This is not a navigation chart.', 'Picture exercise: a purple band crosses a pale blue sky.', 'The purple band marks a made-up practice area, not real airspace.', 'Describe its position, then verify real boundaries on current charts.'],
      ['Fictional decision exercise. No flight authorization is implied.', 'A student sees lower clouds on the imagined route.', 'Discuss delaying, changing the route, or staying on the ground.', 'Explain what information is missing before making a decision.'],
    ];
    const pdf = buildPdf(3, 0, 0, 'QA weather and airspace', lines, ['', 'q 0.862745 0.921569 0.960784 rg 50 400 300 200 re f 0.470588 0.274510 0.666667 rg 50 470 300 60 re f Q\n']);
    const png = picturePng();
    mkdirSync(path.join(dir, 'documents'), { recursive: true });
    for (const [name, bytes] of [['qa-sample-weather.pdf', pdf], ['qa-sample-airspace.png', png]]) {
      if (existsSync(path.join(dir, 'documents', name))) throw Error('Sample document already exists without a seed receipt.');
      writeFileSync(path.join(dir, 'documents', name), bytes);
    }
    await profileRepository(db).update({ pilotName: 'Alex Example (fictional)', currentFocus: 'Fictional QA weather and airspace practice' });
    await docs.create({ id: materialId, title: 'Fictional weather and airspace', materialType: 'reference', topic: 'weather', filePath: 'qa-sample-weather.pdf', originalFileName: 'qa-sample-weather.pdf', fileSize: pdf.length });
    await docs.create({ id: imageId, title: 'Fictional airspace picture from page 2', materialType: 'reference', filePath: 'qa-sample-airspace.png', originalFileName: 'qa-sample-airspace.png', fileSize: png.length });
    const descriptor = { ownerMaterialId: materialId, imageMaterialId: imageId, imageSha256: hash(png).toString('hex'), imageWidth: 300, imageHeight: 200, x: 0, y: 70, w: 300, h: 60, rotation: 0 };
    const region = { ...descriptor, id: await visualRegionHash(descriptor) };
    const prompts = ['What changed in the imagined weather?', 'What information is missing?', 'When should you get a fresh briefing?', 'What can a lowering ceiling change?', 'Name a conservative alternative.', 'Where are real airspace boundaries checked?', 'What does the fictional purple band show?', 'Who can help check your understanding?', 'Why consider alternate routes?', 'What makes this a study aid?', 'What should you check before departure?', 'Describe the purple band in the picture.'];
    const answers = ['Clouds build in the afternoon.', 'A current briefing and route conditions.', 'Before deciding whether to depart.', 'Whether the planned route remains suitable.', 'Delay the flight and discuss conditions.', 'On current official charts with instructor guidance.', 'Only a made-up practice area.', 'Your instructor.', 'Conditions may change along the planned route.', 'It uses fictional places and conditions.', 'A current briefing, charts, and instructor guidance.', 'A horizontal purple band across a pale blue field.'];
    await docs.saveStudySet({ operationId: randomUUID(), materialId, reason: 'create', expected: null, visualRegions: [region], next: {
      title: 'Fictional weather and airspace study guide', summary: 'Fictional study aid. Check real guidance with your instructor.', summaryOrigin: 'user',
      sections: lines.map((page, i) => ({ heading: `Exercise ${i + 1}`, body: page.join('\n'), itemId: `qa-section-${i}`, origin: 'user' })),
      flashcards: prompts.map((front, i) => ({ front, back: answers[i], sourcePage: i === 11 ? 2 : i % 3 + 1, itemId: `qa-card-${i}`, origin: 'user', ...(i === 11 ? { visualRegionId: region.id } : {}) })),
      sourceNotes: 'Fictional offline QA sample; no real flight data.', provider: 'manual', model: '', retired: [],
    } });
    const cards = cardReviewRepository(db);
    const raw = new DatabaseSync(filename);
    try {
      for (let i = 0; i < 12; i++) {
        const snapshot = await cards.getCardReviewSnapshot(materialId);
        const at = new Date(now.getTime() - (i < 5 ? 2 * 86400000 : 3600000)).toISOString();
        await executeCardReviewAction(s => raw.exec(s), (s, p) => raw.prepare(s).run(...p), (s, p) => raw.prepare(s).all(...p), {
          action: 'rate', operationId: randomUUID(), materialId, versionContentHash: snapshot.current.contentHash,
          itemId: snapshot.current.items[i].itemId, expectedGeneration: snapshot.generation, expectedRevision: 0, rating: i < 5 ? 'good' : 'easy',
        }, at);
      }
    } finally { raw.close(); }
    await db.savePracticeAuthoringAtomically({ operationId: randomUUID(), sourceMaterialId: materialId, reason: 'create', expected: null, next: {
      title: 'Fictional weather decisions', provider: 'manual', model: '', retired: [],
      questions: prompts.slice(0, 4).map((question, i) => ({ question, options: [answers[i], 'Ignore the missing information.', 'Treat the fictional exercise as a real clearance.'], correctIndex: 0, explanation: answers[i], sourcePage: i % 3 + 1, identity: randomUUID(), origin: 'user' })),
    } });
    const practice = practiceSessionRepository(db);
    const active = await practice.getActiveVersion(materialId);
    const start = await practice.saveSessionAction({ action: 'start_or_resume', operationId: randomUUID(), materialId, versionId: active.version.id });
    for (let i = 0; i < active.items.length; i++) await practice.saveSessionAction({ action: 'record_response', operationId: randomUUID(), attemptId: start.attemptId, itemId: active.items[i].id, expectedRevision: i, selectedIndex: i % 2, isDontKnow: false });
    await practice.saveSessionAction({ action: 'complete_attempt', operationId: randomUUID(), attemptId: start.attemptId, expectedRevision: active.items.length });
    await oralScenarioRepository(db).create(materialId, { prompt: 'At fictional Meadow Field the clouds are lowering. Talk through your decision.', assumptions: 'Imagined daytime training flight; no actual weather or clearance.', points: ['Get current information.', 'Discuss conservative alternatives with an instructor.'], sourcePage: 3, origin: 'user' });
    const assignmentId = randomUUID();
    const at = now.toISOString();
    await db.saveHomeworkAtomically({ version: 1, operationId: randomUUID(), assignmentId, baseRevision: 0, changeKind: 'create', at, next: {
      version: 1,
      assignment: { id: assignmentId, title: 'Fictional weather preparation', instructions: 'Discuss the sample with an instructor.', school: null, instructor: null, lesson_id: null, source_lesson_id: null, due_date: today, state: 'upcoming', revision: 1, action_id: null, archived: 0, created_at: at, updated_at: at, completed_at: null },
      activities: [{ record: { id: randomUUID(), assignment_id: assignmentId, position: 0, kind: 'reflection', title: 'Consider an alternative', body: 'Describe a conservative choice for the fictional weather.', material_id: null, source_material_id: null, source_revision: null, card_set_id: null, test_version_id: null, source_test_version_id: null, page_start: null, page_end: null, state: 'upcoming', cycle: 1, revision: 1, created_at: at, updated_at: at, completed_at: null, removed_at: null, answer: '' }, source: null, evidence: null }], runs: [],
    } });
    await journalRepository(db).create({ date: today, title: 'Fictional ground study', practiced: 'Practised weather decisions using the fictional QA sample.', materialIds: [materialId] });
    writeFileSync(path.join(dir, marker), JSON.stringify({ version: 1, materialId, oralAnswer: 'Skipped: this branch has no migration 32 oral_answers.' }) + '\n');
  } finally { db.close(); }
  // Reopen runs the application's full schema and semantic validator.
  const verified = await createNodeSqliteDatabase(filename);
  verified.close();
}

export async function seedProfile(id, { reset = false, home = homedir() } = {}) {
  if (process.versions.node.split('.')[0] !== '22') refuse('Run this script with Node 22.');
  const target = profilePath(id, home);
  noSymlinks(target);
  if (existsSync(target)) checkTree(target);
  await assertClosed(target);
  DatabaseSync ??= (await import('node:sqlite')).DatabaseSync;
  const migrations = migrationFiles();
  const { createServer } = await import('vite');
  const server = await createServer({ root, configFile: false, cacheDir: path.join(root, 'node_modules/.vite-qa-sample'), resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
  mkdirSync(path.dirname(target), { recursive: true });
  const stage = mkdtempSync(path.join(path.dirname(target), `${path.basename(target)}-staging-`));
  let old;
  try {
    if (!reset && existsSync(target)) cpSync(target, stage, { recursive: true });
    const filename = path.join(stage, dbName);
    nativeMigrations(filename, migrations);
    await seedData(name => server.ssrLoadModule('/' + name), filename, stage);
    const check = new DatabaseSync(filename);
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || check.prepare('PRAGMA foreign_key_check').all().length) throw Error('SQLite integrity check failed.');
    } finally { check.close(); }
    await assertClosed(target);
    if (existsSync(target)) { old = stage + '-previous'; renameSync(target, old); }
    try { renameSync(stage, target); } catch (error) { if (old) renameSync(old, target); throw error; }
    if (old) rmSync(old, { recursive: true });
    return target;
  } finally {
    rmSync(stage, { recursive: true, force: true });
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const ids = args.filter(a => a !== '--reset');
    if (ids.length !== 1 || args.length !== ids.length + Number(args.includes('--reset'))) refuse('Usage: node scripts/seed-sample-profile.mjs <profile-id> [--reset]');
    await seedProfile(ids[0], { reset: args.includes('--reset') });
    console.log('Synthetic sample ready.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
