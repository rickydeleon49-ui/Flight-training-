// CONTENT-01 owner-only helper: add video links from a manifest to a QA profile DB (app CLOSED).
// node scripts/content/add-video-links.mjs --profile <dir> --manifest <file> [--dry-run | --check]
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const prefix = 'com.herflightdeck.synthetic.';
const dbName = 'her-flight-deck.db';
const refuse = (message) => { throw Object.assign(new Error(message), { exitCode: 2 }); };

// Exact copy of validateVideoUrl / validateTitle in
// src/data/repositories/materialVideoLinkRepository.ts (the script cannot import .ts under Node 22).
// The test runs both against src/testing/videoUrlParity.json and the TypeScript source rules.
export function validateVideoUrl(input) {
  let url = String(input).trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') url = 'https:' + url.slice(url.indexOf(':') + 1);
    else if (parsed.protocol !== 'https:') throw new Error();
    if (url.length > 2000) throw new Error();
  } catch { throw new Error('Invalid video link.'); }
  return url;
}
export function validateTitle(input) {
  const title = String(input).trim();
  if (title.length > 200) throw new Error('Keep the name to 200 characters or fewer.');
  return title;
}

export function assertSyntheticProfile(dir, home = homedir()) {
  if (typeof dir !== 'string' || !dir) refuse('--profile is required.');
  const base = path.join(home, 'Library', 'Application Support');
  const resolved = path.resolve(dir);
  const name = path.basename(resolved);
  if (name === 'com.herflightdeck.app' || resolved.split(path.sep).includes('com.herflightdeck.app')) refuse('Refusing the real app profile.');
  if (path.dirname(resolved) !== base || !name.startsWith(prefix) || name.length === prefix.length) {
    refuse('Profile must be under ~/Library/Application Support/' + prefix + '*');
  }
  let current = resolved;
  for (;;) {
    let stat;
    try { stat = lstatSync(current); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (stat?.isSymbolicLink()) refuse('Profile path must not contain symbolic links.');
    if (path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  if (!existsSync(path.join(resolved, dbName))) refuse('No database found in the profile.');
  const realDir = realpathSync(resolved);
  for (const suffix of ['', '-wal', '-shm']) {
    const file = path.join(resolved, dbName + suffix);
    let stat;
    try { stat = lstatSync(file); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (stat.isSymbolicLink()) refuse('Database file must not be a symbolic link: ' + dbName + suffix);
    if (stat.nlink > 1) refuse('Database file must not be a hard link: ' + dbName + suffix);
    const real = realpathSync(file);
    if (path.dirname(real) !== realDir) refuse('Database file resolves outside the profile: ' + dbName + suffix);
  }
  return resolved;
}

function assertClosed(dir) {
  const result = spawnSync('lsof', ['-t', '+D', dir], { encoding: 'utf8' });
  if (result.error || ![0, 1].includes(result.status)) refuse('Could not check whether the app is running.');
  if (result.stdout.trim()) refuse('Close the app for this profile first (its files are open).');
}

export function loadManifest(file) {
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { refuse('Manifest is not readable JSON.'); }
  if (!Array.isArray(data)) refuse('Manifest must be an array.');
  const seenMaterials = new Set();
  return data.map((entry, i) => {
    const where = `manifest entry ${i}`;
    if (!entry || typeof entry !== 'object') refuse(`${where}: not an object.`);
    for (const key of ['materialId', 'sourceChecksum', 'title']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) refuse(`${where}: ${key} is required.`);
    }
    if (seenMaterials.has(entry.materialId)) refuse(`${where}: material listed twice.`);
    seenMaterials.add(entry.materialId);
    if (!Array.isArray(entry.videos) || !entry.videos.length) refuse(`${where}: videos must be a non-empty array.`);
    const titles = new Set();
    const videos = entry.videos.map((v, j) => {
      let url, title;
      try {
        if (!v || typeof v.url !== 'string' || typeof v.title !== 'string') throw new Error('missing url or title');
        url = validateVideoUrl(v.url);
        title = validateTitle(v.title);
        if (!title) throw new Error('empty title');
      } catch (e) { refuse(`${where} video ${j}: ${e.message}`); }
      const key = title.toLowerCase();
      if (titles.has(key)) refuse(`${where}: duplicate title "${title}".`);
      titles.add(key);
      return { url, title };
    });
    return { materialId: entry.materialId, sourceChecksum: entry.sourceChecksum.trim().toLowerCase(), title: entry.title, videos };
  });
}

// sha256 of a material's stored PDF (the value the app records on first open), or null.
function fileSha256(dir, filePath) {
  if (!filePath) return null;
  const docs = path.join(dir, 'documents');
  const file = path.resolve(docs, filePath);
  if (!file.startsWith(docs + path.sep) || !existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// Prints materialId, title, sha256 of the real file bytes and the stored value (flags mismatches).
function printChecksums(db, dir) {
  const rows = db.prepare('SELECT m.id, m.title, m.file_path, c.content_sha256 AS stored FROM study_materials m LEFT JOIN material_content_identities c ON c.material_id = m.id ORDER BY m.title, m.id').all();
  const lines = [];
  let mismatches = 0;
  for (const r of rows) {
    const actual = fileSha256(dir, r.file_path);
    const flag = !actual ? 'NO-FILE' : !r.stored ? 'NO-STORED' : actual !== r.stored ? 'MISMATCH' : 'ok';
    if (flag !== 'ok') mismatches++;
    lines.push(`${r.id}\t${r.title}\t${actual ?? '-'}\t${r.stored ?? '-'}\t${flag}`);
  }
  return { lines, mismatches };
}

// Returns { added, skipped, missing, diffs } and writes only when mode is 'apply'.
export async function run({ profile, manifest, mode = 'apply', home = homedir() }) {
  if (process.versions.node.split('.')[0] !== '22') refuse('Run this script with Node 22.');
  const dir = assertSyntheticProfile(profile, home);
  const readOnlyMode = mode !== 'apply';
  if (mode === 'print-checksums') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, dbName), { readOnly: true });
    try { return printChecksums(db, dir); } finally { db.close(); }
  }
  const entries = loadManifest(manifest);
  if (mode !== 'check') assertClosed(dir);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, dbName), { readOnly: readOnlyMode });
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const material = db.prepare('SELECT id, file_path FROM study_materials WHERE id = ?');
    const checksum = db.prepare('SELECT content_sha256 FROM material_content_identities WHERE material_id = ?');
    const existing = db.prepare('SELECT url, title FROM material_video_links WHERE material_id = ?');
    const plan = [];
    const diffs = [];
    for (const e of entries) {
      const mat = material.get(e.materialId);
      if (!mat) refuse(`Material not found: ${e.materialId} (${e.title}).`);
      // Prefer the checksum the app recorded; a chapter never opened has none, so use its stored file's sha256.
      const stored = checksum.get(e.materialId)?.content_sha256 ?? fileSha256(dir, mat.file_path);
      if (!stored) refuse(`No checksum for ${e.materialId} (${e.title}): no recorded checksum and no stored file.`);
      if (stored !== e.sourceChecksum) refuse(`Checksum mismatch for ${e.materialId} (${e.title}).`);
      const rows = existing.all(e.materialId);
      const have = new Set(rows.map(r => r.url));
      for (const v of e.videos) plan.push({ materialId: e.materialId, ...v, present: have.has(v.url) });
      if (mode === 'check') {
        const want = new Map(e.videos.map(v => [v.url, v.title]));
        for (const [url, title] of want) {
          const got = rows.find(r => r.url === url);
          if (!got) diffs.push(`missing: ${e.materialId} ${title} <${url}>`);
          else if (got.title !== title) diffs.push(`wrong title: ${e.materialId} <${url}> has "${got.title}", expected "${title}"`);
        }
        for (const r of rows) if (!want.has(r.url)) diffs.push(`extra: ${e.materialId} "${r.title}" <${r.url}>`);
      }
    }
    const seen = new Set();
    const todo = plan.filter(p => {
      if (p.present) return false;
      const key = p.materialId + '\n' + p.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const result = { added: todo.length, skipped: plan.length - todo.length, missing: todo, diffs };
    if (mode === 'apply' && todo.length) {
      const insert = db.prepare('INSERT INTO material_video_links (id, material_id, url, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const p of todo) {
          const at = new Date().toISOString();
          insert.run(randomUUID(), p.materialId, p.url, p.title, at, at);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    return result;
  } finally { db.close(); }
}

function parseArgs(argv) {
  const out = { mode: 'apply' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') out.profile = argv[++i];
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--dry-run') out.mode = 'dry-run';
    else if (a === '--check') out.mode = 'check';
    else if (a === '--print-checksums') out.mode = 'print-checksums';
    else refuse('Unknown argument: ' + a);
  }
  if (!out.profile || (!out.manifest && out.mode !== 'print-checksums')) refuse('Usage: add-video-links.mjs --profile <dir> --manifest <file> [--dry-run|--check] | --profile <dir> --print-checksums');
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const r = await run(args);
    if (args.mode === 'print-checksums') {
      console.log('materialId\ttitle\tfile_sha256\tstored_sha256\tstatus');
      for (const l of r.lines) console.log(l);
      process.exit(r.mismatches ? 1 : 0);
    }
    if (args.mode === 'check') {
      console.log(r.diffs.length ? `check: ${r.diffs.length} difference(s).` : `check: all ${r.skipped} link(s) match.`);
      for (const d of r.diffs) console.log('  ' + d);
      process.exit(r.diffs.length ? 1 : 0);
    }
    console.log(`${args.mode === 'dry-run' ? 'dry-run: would add' : 'added'} ${r.added}, skipped ${r.skipped}, refused 0.`);
  } catch (e) {
    console.error('refused: ' + e.message);
    console.log('added 0, skipped 0, refused 1.');
    process.exit(e.exitCode ?? 1);
  }
}
