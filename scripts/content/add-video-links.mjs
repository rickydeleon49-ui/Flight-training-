// CONTENT-01 owner-only helper: add video links from a manifest to a QA profile DB (app CLOSED).
// node scripts/content/add-video-links.mjs --profile <dir> --manifest <file> [--dry-run | --check]
import { randomUUID } from 'node:crypto';
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

// Returns { added, skipped, missing } and writes only when mode is 'apply'.
export async function run({ profile, manifest, mode = 'apply', home = homedir() }) {
  if (process.versions.node.split('.')[0] !== '22') refuse('Run this script with Node 22.');
  const dir = assertSyntheticProfile(profile, home);
  const entries = loadManifest(manifest);
  if (mode !== 'check') assertClosed(dir);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, dbName), { readOnly: mode !== 'apply' });
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const material = db.prepare('SELECT id FROM study_materials WHERE id = ?');
    const checksum = db.prepare('SELECT content_sha256 FROM material_content_identities WHERE material_id = ?');
    const existing = db.prepare('SELECT url FROM material_video_links WHERE material_id = ?');
    const plan = [];
    for (const e of entries) {
      if (!material.get(e.materialId)) refuse(`Material not found: ${e.materialId} (${e.title}).`);
      const stored = checksum.get(e.materialId)?.content_sha256;
      if (stored !== e.sourceChecksum) refuse(`Checksum mismatch for ${e.materialId} (${e.title}).`);
      const have = new Set(existing.all(e.materialId).map(r => r.url));
      for (const v of e.videos) plan.push({ materialId: e.materialId, ...v, present: have.has(v.url) });
    }
    const seen = new Set();
    const todo = plan.filter(p => {
      if (p.present) return false;
      const key = p.materialId + '\n' + p.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const result = { added: todo.length, skipped: plan.length - todo.length, missing: todo };
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
    else refuse('Unknown argument: ' + a);
  }
  if (!out.profile || !out.manifest) refuse('Usage: add-video-links.mjs --profile <dir> --manifest <file> [--dry-run|--check]');
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const r = await run(args);
    if (args.mode === 'check') {
      console.log(r.missing.length ? `check: ${r.missing.length} link(s) missing, ${r.skipped} present.` : `check: all ${r.skipped} link(s) present.`);
      for (const m of r.missing) console.log(`  missing: ${m.materialId} ${m.title}`);
      process.exit(r.missing.length ? 1 : 0);
    }
    console.log(`${args.mode === 'dry-run' ? 'dry-run: would add' : 'added'} ${r.added}, skipped ${r.skipped}, refused 0.`);
  } catch (e) {
    console.error('refused: ' + e.message);
    console.log('added 0, skipped 0, refused 1.');
    process.exit(e.exitCode ?? 1);
  }
}
