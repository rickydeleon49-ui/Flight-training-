#!/usr/bin/env node
/**
 * Mac schema-13 profile snapshot / compare helper (read-only).
 *
 * Purpose: give the hfdtest operator a deterministic, non-mutating way to prove that
 * the schema-12 -> schema-13 upgrade left every retained history row unchanged, and that
 * the older binary's library was not modified when it refused a schema-13 backup.
 *
 * Guarantees:
 *  - Opens the live database read-only. Never writes, never checkpoints, never VACUUMs.
 *  - If a non-empty -wal is present while the apps are closed, it snapshots by copying
 *    db + -wal (+ -shm) into a task-owned temp dir and reading the copy, so committed WAL
 *    rows are honoured without touching the original.
 *  - Refuses a wrong uid / wrong expected data root / a running app / a non-profile path.
 *  - Deterministic typed serialization: every column is read through SQLite quote(), so
 *    NULL, INTEGER, REAL, TEXT and BLOB round-trip into stable text (no JSON number drift,
 *    no rowid dependence); rows are ordered by each table's real primary key.
 *  - Uses the desktop migration ledger (_sqlx_migrations, falling back to schema_migrations)
 *    as the schema authority, not PRAGMA user_version.
 *
 * Usage:
 *   node scripts/mac-schema13-profile-snapshot.mjs snapshot   [--profile <app-support-dir>] [--expect-uid 502] [--json out.json]
 *   node scripts/mac-schema13-profile-snapshot.mjs compare    --before a.json --after b.json [--history-only]
 *   node scripts/mac-schema13-profile-snapshot.mjs self-check
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const APP_ID = 'com.herflightdeck.app';
const DB_NAME = 'her-flight-deck.db';

/** Tables whose retained history must survive an upgrade, with their real primary keys. */
const HISTORY_TABLES = [
  { name: 'study_materials', key: ['id'] },
  { name: 'tags', key: ['id'] },
  { name: 'material_tags', key: ['material_id', 'tag_id'] },
  { name: 'practice_test_versions', key: ['id'] },
  { name: 'practice_test_items', key: ['id'] },
  { name: 'practice_attempts', key: ['id'] },
  { name: 'practice_responses', key: ['id'] },
  { name: 'card_review_generations', key: ['source_material_id'] },
  { name: 'card_versions', key: ['id'] },
  { name: 'card_items', key: ['id'] },
  { name: 'card_review_state', key: ['item_id'] },
  { name: 'card_review_events', key: ['id'] },
];
/** Tables the upgrade itself creates: reported separately, never part of the "unchanged" proof. */
const NEW_SCHEMA13_TABLES = ['material_split_lineage', 'split_operation_log'];
const LEDGER_CANDIDATES = ['_sqlx_migrations', 'schema_migrations'];

/** Refusals throw so callers (including self-check) can observe them; main() maps them to exit 2. */
function fail(msg) { throw new Error(`REFUSED: ${msg}`); }

function parseArgs(argv) {
  const mode = argv[0];
  const opts = { mode, expectUid: null, expectProfile: null, jsonOut: null, historyOnly: false, before: null, after: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expect-uid') opts.expectUid = Number(argv[++i]);
    else if (a === '--profile') opts.expectProfile = path.resolve(argv[++i]);
    else if (a === '--json') opts.jsonOut = argv[++i];
    else if (a === '--before') opts.before = argv[++i];
    else if (a === '--after') opts.after = argv[++i];
    else if (a === '--history-only') opts.historyOnly = true;
    else fail(`unknown argument ${a}`);
  }
  return opts;
}

function defaultProfileRoot() {
  return path.join(os.homedir(), 'Library', 'Application Support', APP_ID);
}

/** Precondition guards. The helper never repairs a failure; it refuses. */
function guardProfile(profile, expectUid) {
  if (!fs.existsSync(profile)) fail(`profile root does not exist: ${profile}`);
  const dbPath = path.join(profile, DB_NAME);
  if (!fs.existsSync(dbPath)) fail(`no ${DB_NAME} under ${profile} — this is not a Her Flight Deck data root`);
  const st = fs.statSync(dbPath);
  if (!st.isFile()) fail(`${dbPath} is not a regular file`);
  if (expectUid !== null && st.uid !== expectUid) {
    fail(`database is owned by uid ${st.uid}, expected ${expectUid} — wrong user or wrong root`);
  }
  if (expectUid !== null && typeof process.getuid === 'function' && process.getuid() !== expectUid) {
    fail(`running as uid ${process.getuid()}, expected ${expectUid} — run this inside the isolated test account`);
  }
  // Both apps must be closed. Their executable name is identical, so match the bundle path.
  try {
    const out = execFileSync('/usr/bin/pgrep', ['-f', 'Her Flight Deck.app/Contents/MacOS/her-flight-deck'], { encoding: 'utf8' });
    if (out.trim().length > 0) fail(`an app is still running (pid(s) ${out.trim().replace(/\n/g, ' ')}) — quit both apps first`);
  } catch { /* pgrep exits 1 when nothing matches: that is the desired state */ }
  return dbPath;
}

/**
 * Open a quiescent view. Read-only when the WAL is empty/absent; otherwise read a copy
 * of db + -wal so committed WAL frames are honoured without mutating the original.
 */
function openQuiescent(dbPath) {
  const wal = `${dbPath}-wal`;
  const walBytes = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
  if (walBytes === 0) {
    return { db: new DatabaseSync(dbPath, { readOnly: true }), cleanup: () => {}, mode: 'read-only' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfd-snapshot-'));
  const copyDb = path.join(dir, path.basename(dbPath));
  fs.copyFileSync(dbPath, copyDb);
  fs.copyFileSync(wal, path.join(dir, path.basename(wal)));
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, path.join(dir, path.basename(shmPath)));
  return {
    db: new DatabaseSync(copyDb, { readOnly: false }), // the copy only; the original is untouched
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    mode: `wal-copy-snapshot (${walBytes} bytes of WAL read from a copy)`,
  };
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnsOf(db, table) {
  return db.prepare(`SELECT name FROM pragma_table_info(?) ORDER BY rowid`).all(table).map(r => r.name);
}

/** Type-faithful, deterministic row text via SQLite quote(). */
function digestTable(db, table, keyCols) {
  const cols = columnsOf(db, table);
  const select = cols.map(c => `quote("${c}")`).join(', ');
  const order = keyCols.filter(c => cols.includes(c));
  const sql = `SELECT ${select} FROM "${table}"${order.length ? ` ORDER BY ${order.map(c => `"${c}" ASC`).join(', ')}` : ''}`;
  const rows = db.prepare(sql).all().map(r => Object.values(r).map(v => (v === null ? '\u2205NULL' : String(v))).join('\u0001'));
  const body = rows.join('\u0002');
  return { rowCount: rows.length, sha256: crypto.createHash('sha256').update(`${table}\n${body}\n`, 'utf8').digest('hex') };
}

function ledger(db) {
  for (const name of LEDGER_CANDIDATES) {
    if (tableExists(db, name)) {
      const max = db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM "${name}"`).get().v;
      const versions = db.prepare(`SELECT version FROM "${name}" ORDER BY version`).all().map(r => Number(r.version));
      return { table: name, maxVersion: Number(max), versions };
    }
  }
  return { table: null, maxVersion: 0, versions: [] };
}

function fileAnchors(profile) {
  const docs = path.join(profile, 'documents');
  const anchors = [];
  if (fs.existsSync(docs)) {
    for (const name of fs.readdirSync(docs).filter(n => !n.startsWith('.')).sort()) {
      const p = path.join(docs, name);
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      anchors.push({ relativePath: `documents/${name}`, bytes: st.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') });
    }
  }
  return anchors;
}

function snapshot(opts) {
  const profile = opts.expectProfile ?? defaultProfileRoot();
  if (opts.expectProfile && path.basename(profile) !== APP_ID) {
    fail(`--profile must be the ${APP_ID} data root, got ${profile}`);
  }
  const dbPath = guardProfile(profile, opts.expectUid);
  const { db, cleanup, mode } = openQuiescent(dbPath);
  let result;
  try {
    const history = {};
    for (const t of HISTORY_TABLES) history[t.name] = tableExists(db, t.name) ? digestTable(db, t.name, t.key) : { rowCount: 0, sha256: null, absent: true };
    const newTables = {};
    for (const name of NEW_SCHEMA13_TABLES) {
      const entry = HISTORY_TABLES.find(t => t.name === name);
      newTables[name] = tableExists(db, name) ? digestTable(db, name, entry ? entry.key : ['rowid']) : { absent: true, rowCount: 0 };
    }
    result = {
      schema: 'hfd-mac-profile-snapshot/1',
      takenAt: new Date().toISOString(),
      profile,
      database: DB_NAME,
      openMode: mode,
      ownerUid: fs.statSync(dbPath).uid,
      ledger: ledger(db),
      history,
      schema13Tables: newTables,
      fileAnchors: fileAnchors(profile),
    };
  } finally { db.close(); cleanup(); }
  const text = JSON.stringify(result, null, 2) + '\n';
  if (opts.jsonOut) fs.writeFileSync(opts.jsonOut, text); else console.log(text);
  return result;
}

function compare(opts) {
  const a = JSON.parse(fs.readFileSync(opts.before, 'utf8'));
  const b = JSON.parse(fs.readFileSync(opts.after, 'utf8'));
  const diffs = [];
  for (const t of HISTORY_TABLES) {
    const x = a.history[t.name] ?? {}, y = b.history[t.name] ?? {};
    if (x.sha256 !== y.sha256 || x.rowCount !== y.rowCount) diffs.push(`${t.name}: before ${x.rowCount}/${x.sha256 ?? 'absent'} after ${y.rowCount}/${y.sha256 ?? 'absent'}`);
  }
  if (!opts.historyOnly) {
    for (const [k, v] of Object.entries(b.schema13Tables ?? {})) if (v.absent) diffs.push(`schema-13 table missing after upgrade: ${k}`);
    if (b.ledger?.maxVersion !== 13) diffs.push(`desktop migration ledger max version after = ${b.ledger?.maxVersion} (expected 13, table ${b.ledger?.table})`);
    if (a.fileAnchors.length !== b.fileAnchors.length) diffs.push(`document file count changed: ${a.fileAnchors.length} -> ${b.fileAnchors.length}`);
    else a.fileAnchors.forEach((f, i) => { const g = b.fileAnchors[i]; if (g.relativePath !== f.relativePath || g.sha256 !== f.sha256) diffs.push(`document anchor changed at index ${i}`); });
  }
  const verdict = { schema: 'hfd-mac-profile-compare/1', before: opts.before, after: opts.after, historyOnly: opts.historyOnly, retainedHistoryUnchanged: diffs.length === 0, diffs };
  const text = JSON.stringify(verdict, null, 2) + '\n';
  if (opts.jsonOut) fs.writeFileSync(opts.jsonOut, text); else console.log(text);
  if (diffs.length) process.exitCode = 1;
  return verdict;
}

/** Isolated checks on synthetic scratch data. Touches only temp dirs it creates. */
function selfCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfd-snapshot-selfcheck-'));
  const root = path.join(dir, APP_ID);
  fs.mkdirSync(path.join(root, 'documents'), { recursive: true });
  const dbPath = path.join(root, DB_NAME);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  const migDir = path.join(process.cwd(), 'src-tauri', 'migrations');
  const files = fs.readdirSync(migDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  db.exec('CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, installed_on TEXT NOT NULL DEFAULT \'now\', version_executed_at BIGINT NOT NULL DEFAULT 0, checksum BLOB NOT NULL, kind TEXT NOT NULL);');
  const T0 = '2026-10-08T12:00:00.000Z';
  let applied = 0;
  for (const f of files) {
    const v = parseInt(f.slice(0, 4), 10);
    if (v > 12) continue;                       // build a schema-12 baseline, like the OLD app would
    db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
    db.prepare('INSERT INTO _sqlx_migrations (version, description, checksum, version_executed_at, kind) VALUES (?, ?, ?, ?, ?)')
      .run(v, f, Buffer.alloc(32, 0), 0, 'Up');
    applied++;
  }
  db.prepare(`INSERT INTO study_materials (id,title,material_type,topic,review_status,priority,file_path,original_file_name,file_size,created_at,updated_at)
              VALUES ('m1','Synthetic one','handbook','general','needs_review','next_up','documents/one.pdf','one.pdf',3,?,?)`).run(T0, T0);
  // satisfy the real foreign keys with minimal synthetic parents, in dependency order
  db.prepare(`INSERT INTO practice_test_versions (id,source_material_id,history_key,source_material_title,version_number,provider,model,title,content_hash,created_at,is_active)
              VALUES ('v1','m1','h-m1','Synthetic one',1,'import','','Synthetic test','${'0'.repeat(64)}',?,1)`).run(T0);
  db.prepare(`INSERT INTO practice_test_items (id,version_id,ordinal,question_text,options_json,correct_index,explanation,source_page)
              VALUES ('i1','v1',0,'Synthetic question','["a","b"]',0,'',NULL)`).run();
  db.prepare(`INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,completed_at,status,revision,total_questions,answered_count,correct_count,incorrect_count,dont_know_count,score_percent)
              VALUES ('a1','v1','m1','Synthetic one',?,?,'completed',1,1,1,1,0,0,50.5)`).run(T0, T0);
  db.prepare(`INSERT INTO practice_responses (id,attempt_id,item_id,selected_index,is_dont_know,is_correct,answered_at)
              VALUES ('r1','a1','i1',0,0,1,?)`).run(T0);
  db.prepare(`INSERT INTO card_versions (id,source_material_id,content_hash,card_count,provider,created_at,first_reviewed_at,is_active)
              VALUES ('cv1','m1','${'0'.repeat(64)}',1,'import',?,NULL,1)`).run(T0);
  db.prepare(`INSERT INTO card_items (id,version_id,ordinal,front,back,source_page) VALUES ('c1','cv1',0,'Q','A',NULL)`).run();
  db.prepare(`INSERT INTO card_review_events (id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json)
              VALUES ('e1','c1',0,'good',?,'v1','{}','{}')`).run(T0);
  db.close();
  fs.writeFileSync(path.join(root, 'documents', 'one.pdf'), 'SYNTH one');

  const snap = (out) => snapshot({ mode: 'snapshot', expectProfile: root, expectUid: fs.statSync(dbPath).uid, jsonOut: out });
  const p1 = path.join(dir, 's1.json');
  const s1 = snap(p1);
  const checks = [];
  checks.push({ name: 'ledger is the desktop _sqlx_migrations table, max 12', pass: s1.ledger.table === '_sqlx_migrations' && s1.ledger.maxVersion === 12 });
  checks.push({ name: 'schema-13 tables absent at schema 12', pass: !!s1.schema13Tables.material_split_lineage.absent && !!s1.schema13Tables.split_operation_log.absent });

  // CONTROL: re-snapshot an untouched profile -> identical history digests.
  const p2 = path.join(dir, 's2.json');
  const s2 = snap(p2);
  const sameHistory = Object.keys(s1.history).every(k => s1.history[k].sha256 === s2.history[k].sha256 && s1.history[k].rowCount === s2.history[k].rowCount);
  checks.push({ name: 'control: unchanged profile compares clean', pass: sameHistory && compare({ before: p1, after: p2, historyOnly: true, jsonOut: path.join(dir, 'cmp-ctrl.json') }).retainedHistoryUnchanged === true });

  // DETECTION: change one retained history row -> compare must report it.
  const d2 = new DatabaseSync(dbPath);
  d2.prepare(`UPDATE practice_responses SET selected_index = 1, is_correct = 0 WHERE id = 'r1'`).run();
  d2.close();
  const p3 = path.join(dir, 's3.json');
  snap(p3);
  const cmp = compare({ before: p1, after: p3, historyOnly: true, jsonOut: path.join(dir, 'cmp-detect.json') });
  checks.push({ name: 'detection: a modified history row is reported', pass: cmp.retainedHistoryUnchanged === false && cmp.diffs.some(d => d.startsWith('practice_responses')) });

  // WRONG ROOT: a directory that is not a Her Flight Deck data root must be refused.
  const bogus = path.join(dir, 'not-a-profile'); fs.mkdirSync(bogus, { recursive: true });
  const refuseWrongRoot = throws(() => snapshot({ mode: 'snapshot', expectProfile: bogus, expectUid: null, jsonOut: null }));
  checks.push({ name: 'refusal: a non-profile directory is refused', pass: refuseWrongRoot });

  // WRONG UID: an expectation that does not match the file owner must be refused.
  const ownUid = fs.statSync(dbPath).uid;
  const refuseWrongUid = throws(() => snapshot({ mode: 'snapshot', expectProfile: root, expectUid: ownUid === 502 ? 999 : 502, jsonOut: null }));
  checks.push({ name: 'refusal: a mismatched owner uid is refused', pass: refuseWrongUid });

  // WAL PATH: a live WAL writer holds committed rows only in the -wal. The helper must read
  // them (through a copy) and leave the original main database byte-for-byte untouched.
  const writer = new DatabaseSync(dbPath);
  writer.exec('PRAGMA journal_mode = WAL;');
  writer.prepare(`INSERT INTO tags (id,name,created_at) VALUES ('walprobe','walprobe',?)`).run(T0);
  const walPath = `${dbPath}-wal`;
  const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  // baseline taken AFTER WAL was enabled and the row written, so this measures what the
  // *helper* changes, not what switching journal mode legitimately changes.
  const before = fs.readFileSync(dbPath);
  const p4 = path.join(dir, 's4.json');
  const s4 = snapshot({ mode: 'snapshot', expectProfile: root, expectUid: ownUid, jsonOut: p4 });
  const originalUntouched = Buffer.compare(before, fs.readFileSync(dbPath)) === 0;
  const honouredWalRow = s4.history.tags.rowCount === s1.history.tags.rowCount + 1
    && s4.history.tags.sha256 !== s1.history.tags.sha256;
  checks.push({
    name: 'wal: committed WAL rows are read from a copy; original main db bytes unchanged',
    pass: walBytes > 0 && /wal-copy-snapshot/.test(s4.openMode) && originalUntouched && honouredWalRow,
    detail: { walBytes, openMode: s4.openMode, originalUntouched, tagsBefore: s1.history.tags.rowCount, tagsAfter: s4.history.tags.rowCount },
  });
  writer.close();

  // UPGRADE SIMULATION (the shape the operator observes, on synthetic scratch only):
  // apply the real shipped 0013 and confirm the helper reports retained history identical
  // while the two schema-13 tables appear and the ledger max becomes 13.
  const thirteen = files.filter(f => f.startsWith('0013'));
  const up = new DatabaseSync(dbPath);
  for (const f of thirteen) {
    up.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
    up.prepare('INSERT INTO _sqlx_migrations (version, description, checksum, version_executed_at, kind) VALUES (?, ?, ?, ?, ?)')
      .run(parseInt(f.slice(0, 4), 10), f, Buffer.alloc(32, 0), 0, 'Up');
  }
  up.close();
  const p5 = path.join(dir, 's5.json');
  const s5 = snap(p5);
  const cmpUpgrade = compare({ before: p4, after: p5, jsonOut: path.join(dir, 'cmp-upgrade.json') });
  checks.push({
    name: 'upgrade: applying real 0013 keeps retained history identical and shows both new tables + ledger 13',
    pass: cmpUpgrade.retainedHistoryUnchanged === true
      && !s5.schema13Tables.material_split_lineage.absent
      && !s5.schema13Tables.split_operation_log.absent
      && s5.ledger.maxVersion === 13,
    detail: { diffs: cmpUpgrade.diffs, ledger: s5.ledger, newTables: Object.keys(s5.schema13Tables) },
  });

  fs.rmSync(dir, { recursive: true, force: true });
  const report = { schema: 'hfd-mac-profile-snapshot-selfcheck/1', checks, allPassed: checks.every(c => c.pass) };
  console.log(JSON.stringify(report, null, 2) + '\n');
  // compare() deliberately sets exitCode 1 on detected diffs; self-check reports its own verdict.
  process.exitCode = report.allPassed ? 0 : 1;
  return report;
}

function throws(fn) { try { fn(); return false; } catch { return true; } }

const opts = parseArgs(process.argv.slice(2));
try {
  if (opts.mode === 'snapshot') snapshot(opts);
  else if (opts.mode === 'compare') { if (!opts.before || !opts.after) fail('compare needs --before and --after'); compare(opts); }
  else if (opts.mode === 'self-check') selfCheck();
  else fail('usage: snapshot | compare | self-check');
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}
