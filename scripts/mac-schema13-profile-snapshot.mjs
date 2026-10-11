#!/usr/bin/env node
/**
 * Mac schema-13 profile snapshot / compare helper (read-only).
 *
 * Purpose: give the hfdtest operator a deterministic, non-mutating way to prove that the
 * schema-12 -> schema-13 upgrade left the whole retained library unchanged, that the older
 * binary really did not touch it when it refused a schema-13 backup, and that a restored
 * schema-12 backup came back complete.
 *
 * Guarantees:
 *  - Fails closed. Only pgrep's documented no-match status counts as "stopped". Matched pids,
 *    an inspector that errored, was unrunnable, or answered unparseably all refuse — inability
 *    to inspect is never read as proof that nothing is running. Refusal happens before any
 *    database/WAL/SHM byte is read or copied, and a failed copy always cleans up its scratch.
 *  - The operator entrypoint cannot be configured away. CLI snapshot/compare always target the
 *    approved isolated lane (uid 502, a standard non-admin account, the canonical
 *    /Users/hfdtest/Library/Application Support/com.herflightdeck.app) and write only to a
 *    fresh path. No flag relaxes any of it; scratch fixtures live on an internal test path the
 *    CLI cannot reach.
 *  - No output may sit inside the profile or alias the database, its WAL/SHM, a managed
 *    document, or an input receipt — by resolved path or by device:inode (hard links). A
 *    symlinked destination is refused, and evidence is never silently overwritten.
 *  - Digests are a framed binary encoding of column identity/order plus the exact stored type
 *    and full bytes of every value, so embedded NULs in TEXT, BLOB bytes, full 64-bit INTEGERs,
 *    REAL bit patterns (0.0 vs -0.0) and NULL vs '' are all distinct. Ordering always uses the
 *    table's real primary key; a declared key that disagrees with the schema is a refusal, not
 *    a silent fallback to arbitrary row order.
 *  - Inventory comes from the shipped schema (0001-0012 => 33 retained tables, including the
 *    operation ledgers) plus the migration ledger, schema objects, managed file bytes and
 *    isolation facts. A snapshot that cannot show all of them is refused instead of passing.
 *  - Comparisons are purpose-specific: `unchanged`, `upgrade` and `restore` are complete gate
 *    contracts; `history` is explicitly partial and can never set a gate PASS.
 *
 * Operator usage (from the staged kit, absolute paths only):
 *   node "$KIT/bin/mac-schema13-profile-snapshot.mjs" snapshot --json "$EVID/s12-initial.json"
 *   node "$KIT/bin/mac-schema13-profile-snapshot.mjs" compare --before "$EVID/a.json" --after "$EVID/b.json" --purpose unchanged --json "$EVID/cmp-1.json"
 * Repo-only self-test (isolated scratch data; never touches a real profile):
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
const DOCUMENTS_DIR = 'documents';
const BACKUP_DIR = 'backups';
const VERSION_FILE = 'last-run-version.txt';
const CURRENT_SCHEMA_VERSION = 13;
const RETAINED_SCHEMA_VERSION = 12;
// SQLx 0.8 uses SHA-384 of the exact SQL bytes, verified against the installed source.
const MIGRATION13_CHECKSUM = 'f126deadc4c31c153cd7dc3ac081a4cebe58bc2dbc260bcd386abc210e0d1fc22707bc7c7d62a73b9d124fdb625df03d';

const SNAP_V1 = 'hfd-mac-profile-snapshot/1';
const SNAP_V2 = 'hfd-mac-profile-snapshot/2';
const SNAP_V3 = 'hfd-mac-profile-snapshot/3';
const COMPARE_SCHEMA = 'hfd-mac-profile-compare/3';
const SCRATCH_PREFIX = 'hfd-snapshot-selfcheck-';
// Distinct from SCRATCH_PREFIX so a leak count never mixes the two.
const COPY_PREFIX = 'hfd-snapshot-copy-';

/** pgrep(1) documents exit status 1 as "no processes matched"; that alone means stopped. */
const PGREP_NO_MATCH = 1;
const PROCESS_PROBES = [
  { label: 'bundle-path', file: '/usr/bin/pgrep', args: ['-f', 'Her Flight Deck.app/Contents/MacOS/her-flight-deck'] },
  { label: 'executable-name', file: '/usr/bin/pgrep', args: ['-x', 'her-flight-deck'] },
];

/** The isolated lane the owner approved on 2026-10-08. Operator mode never asks to be told this. */
const APPROVED = Object.freeze({
  uid: 502,
  account: 'hfdtest',
  root: path.join('/Users', 'hfdtest', 'Library', 'Application Support', APP_ID),
});

/** Objects created by migration 0013 — the only schema additions an upgrade may show. */
const SCHEMA13_TABLES = ['material_split_lineage', 'split_operation_log'];
const SCHEMA13_OBJECTS = [
  'material_split_lineage', 'split_operation_log',
  'idx_split_lineage_parent', 'idx_split_lineage_root',
  'idx_split_operation_source', 'idx_split_operation_status',
];
const LEDGER_CANDIDATES = ['_sqlx_migrations', 'schema_migrations'];

const normalizeSql = (sql) => (sql ?? '').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

const EXPECTED_SCHEMA13_DEFINITIONS = Object.freeze({
  idx_split_lineage_parent:
    'CREATE INDEX idx_split_lineage_parent ON material_split_lineage(parent_material_id)',
  idx_split_lineage_root:
    'CREATE INDEX idx_split_lineage_root ON material_split_lineage(root_material_id)',
  idx_split_operation_source:
    'CREATE INDEX idx_split_operation_source ON split_operation_log(source_material_id)',
  idx_split_operation_status:
    'CREATE INDEX idx_split_operation_status ON split_operation_log(status)',
  material_split_lineage:
    `CREATE TABLE material_split_lineage (
  material_id            TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  parent_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  root_material_id       TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_page_start      INTEGER NOT NULL CHECK (TYPEOF(source_page_start) = 'integer' AND source_page_start >= 1),
  source_page_end        INTEGER NOT NULL CHECK (TYPEOF(source_page_end) = 'integer' AND source_page_end >= source_page_start),
  parent_page_start      INTEGER CHECK (parent_page_start IS NULL OR (TYPEOF(parent_page_start) = 'integer' AND parent_page_start >= 1)),
  parent_page_end        INTEGER CHECK (parent_page_end IS NULL OR (TYPEOF(parent_page_end) = 'integer' AND parent_page_end >= parent_page_start)),
  child_page_count       INTEGER NOT NULL CHECK (TYPEOF(child_page_count) = 'integer' AND child_page_count >= 1),
  source_file_name       TEXT NOT NULL,
  source_title           TEXT NOT NULL,
  source_content_sha256  TEXT,
  source_total_pages     INTEGER CHECK (source_total_pages IS NULL OR (TYPEOF(source_total_pages) = 'integer' AND source_total_pages >= source_page_end)),
  parent_file_name       TEXT,
  parent_title           TEXT,
  parent_content_sha256  TEXT,
  parent_total_pages     INTEGER CHECK (parent_total_pages IS NULL OR (TYPEOF(parent_total_pages) = 'integer' AND (parent_page_end IS NULL OR parent_total_pages >= parent_page_end))),
  nested_level           INTEGER NOT NULL DEFAULT 1 CHECK (TYPEOF(nested_level) = 'integer' AND nested_level >= 1),
  created_at             TEXT NOT NULL,
  CHECK (material_id != parent_material_id),
  CHECK (material_id != root_material_id),
  CHECK (child_page_count = (source_page_end - source_page_start + 1)),
  CHECK (parent_page_start IS NULL OR child_page_count = (parent_page_end - parent_page_start + 1)),
  CHECK ((parent_page_start IS NULL AND parent_page_end IS NULL) OR (parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL)),
  CHECK (
    (nested_level = 1 AND parent_page_start IS NULL AND parent_page_end IS NULL AND parent_total_pages IS NULL)
    OR
    (nested_level > 1 AND parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL AND parent_total_pages IS NOT NULL)
  )
)`,
  split_operation_log:
    `CREATE TABLE split_operation_log (
  operation_id           TEXT PRIMARY KEY NOT NULL,
  source_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  receipt_canonical_json TEXT NOT NULL,
  receipt_hash           TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'cancelled')),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
)`,
});

/**
 * Retained library inventory, grouped exactly as the shipped migrations create it. Every
 * entry is digested, because "the library is unchanged" has to mean the whole library —
 * including the operation ledgers — not only the visible practice/card history.
 */
const VISIBLE_HISTORY_TABLES = [
  { name: 'study_materials', key: ['id'] },
  { name: 'tags', key: ['id'] },
  { name: 'material_tags', key: ['material_id', 'tag_id'] },
  { name: 'practice_tests', key: ['source_material_id'] },
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
/** Idempotency/operation ledgers: retained rows an upgrade or a refusal must not disturb. */
const OPERATION_TABLES = [
  { name: 'practice_session_operations', key: ['operation_id'] },
  { name: 'card_review_operations', key: ['operation_id'] },
  { name: 'debrief_operations', key: ['id'] },
];
/** Everything else the app owns at schema 12 or earlier. */
const LIBRARY_TABLES = [
  { name: 'settings', key: ['id'] },
  { name: 'milestones', key: ['id'] },
  { name: 'goals', key: ['id'] },
  { name: 'goal_checklist_items', key: ['id'] },
  { name: 'schedule_events', key: ['id'] },
  { name: 'event_prep_items', key: ['id'] },
  { name: 'event_materials', key: ['event_id', 'material_id'] },
  { name: 'next_actions', key: ['id'] },
  { name: 'journal_entries', key: ['id'] },
  { name: 'journal_materials', key: ['journal_id', 'material_id'] },
  { name: 'questions', key: ['id'] },
  { name: 'transactions', key: ['id'] },
  { name: 'fund_goals', key: ['id'] },
  { name: 'app_metadata', key: ['key'] },
  { name: 'pilot_toolkit', key: ['id'] },
  { name: 'ai_study_sets', key: ['source_material_id'] },
  { name: 'notes', key: ['id'] },
];
const HISTORY_TABLES = [...VISIBLE_HISTORY_TABLES, ...OPERATION_TABLES, ...LIBRARY_TABLES];
/**
 * The backup receipt: app_metadata keys the app writes only after an export has finished
 * (src/data/repositories/appRepository.ts), so an archive can never hold the values its own
 * export wrote. Only the restore contract sets them aside, by exact name, while every other
 * app_metadata key is still compared row by row. Every other contract protects them as usual.
 */
const BACKUP_RECEIPT_KEYS = ['last_complete_backup_at', 'last_complete_backup_path', 'last_complete_backup_version'];
const RETAINED_NAMES = HISTORY_TABLES.map(t => t.name);
/** A gate that claims populated data needs that data actually present in the baseline. */
const POPULATION_REQUIREMENT = ['practice_attempts', 'practice_responses', 'card_review_state', 'card_review_events'];

/** Refusals throw so callers (including the frozen review diagnostics) can observe them. */
function fail(msg) { throw new Error(`REFUSED: ${msg}`); }

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function isHex64(v) { return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v); }
function sameList(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); }

function parseArgs(argv) {
  const mode = argv[0];
  const opts = { mode, expectUid: null, expectProfile: null, jsonOut: null, historyOnly: false, purpose: null, before: null, after: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expect-uid') opts.expectUid = Number(argv[++i]);
    else if (a === '--profile') opts.expectProfile = argv[++i];
    else if (a === '--json') opts.jsonOut = argv[++i];
    else if (a === '--before') opts.before = argv[++i];
    else if (a === '--after') opts.after = argv[++i];
    else if (a === '--purpose') opts.purpose = argv[++i];
    else if (a === '--history-only') opts.historyOnly = true;
    else fail(`unknown argument ${a} — no flag relaxes the isolation or output rules`);
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Process inspection: explicit result classification (MACV-R4)
 * ------------------------------------------------------------------ */

/**
 * Classify one probe result. Only the documented no-match status is success; matched pids,
 * exit 2/3, a missing or unrunnable inspector, a signal death and unparseable output are each
 * a distinct non-stopped state that every caller must refuse on.
 */
function classifyProcessProbe(result) {
  if (!result || typeof result !== 'object') return { state: 'malformed', detail: 'no inspection result at all' };
  if (result.ok === true) {
    if (typeof result.output !== 'string') return { state: 'malformed', detail: 'inspection returned a non-text result' };
    const lines = result.output.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (lines.length === 0) return { state: 'malformed', detail: 'inspection exited 0 without naming a pid' };
    if (!lines.every(s => /^[1-9]\d{0,7}$/.test(s))) return { state: 'malformed', detail: `unparseable pid list ${JSON.stringify(lines.slice(0, 4))}` };
    return { state: 'running', pids: lines.map(Number) };
  }
  if (result.ok === false) {
    if (result.code === 'ENOENT' || result.code === 'EACCES') return { state: 'unavailable', detail: `inspector not runnable (${result.code})` };
    if (result.status === undefined || result.status === null) return { state: 'error', detail: `inspection ended without an exit status (signal ${result.signal ?? 'unknown'})` };
    if (result.status === PGREP_NO_MATCH) return { state: 'stopped' };
    return { state: 'error', detail: `inspection exited ${result.status}${result.message ? `: ${String(result.message).split('\n')[0]}` : ''}` };
  }
  return { state: 'malformed', detail: 'inspection result was neither a success nor a failure' };
}

function runProcessProbe(probe) {
  try {
    return { ok: true, output: execFileSync(probe.file, probe.args, { encoding: 'utf8' }) };
  } catch (error) {
    return {
      ok: false,
      status: error?.status ?? null,
      code: error?.code ?? null,
      signal: error?.signal ?? null,
      message: String(error?.message ?? error),
    };
  }
}

/** Both candidate installs share one executable name, so every probe must answer "stopped". */
function inspectAppProcesses() {
  const probes = PROCESS_PROBES.map(probe => ({ label: probe.label, ...classifyProcessProbe(runProcessProbe(probe)) }));
  const running = probes.filter(p => p.state === 'running');
  const unusable = probes.filter(p => p.state !== 'running' && p.state !== 'stopped');
  const state = running.length > 0 ? 'running' : unusable.length > 0 ? unusable[0].state : 'stopped';
  return {
    state,
    controlled: false,
    probes,
    pids: running.flatMap(p => p.pids ?? []),
    detail: unusable.length > 0 ? unusable.map(p => `${p.label}: ${p.detail ?? p.state}`).join('; ') : undefined,
  };
}

/** A fixed answer for the internal scratch path only; the operator CLI never uses this. */
function controlledInspection(state, detail) {
  return { state, controlled: true, probes: [{ label: 'test-controlled', state, detail }], pids: state === 'running' ? [4321] : [], detail };
}

/* ------------------------------------------------------------------ *
 * Operator isolation policy (MACV-R4)
 * ------------------------------------------------------------------ */

function classifyAccountProbe(result, nonMemberIsSuccess) {
  if (!result || typeof result !== 'object') return { state: 'malformed', detail: 'no account-inspection result' };
  if (result.ok === true) {
    const out = typeof result.output === 'string' ? result.output.trim() : '';
    if (out === '') return { state: 'malformed', detail: 'account inspection returned nothing' };
    return { state: 'ok', output: out };
  }
  if (result.code === 'ENOENT') return { state: 'unavailable', detail: 'account inspector not runnable (ENOENT)' };
  if (result.status === undefined || result.status === null) return { state: 'error', detail: `account inspection ended without an exit status (signal ${result.signal ?? 'unknown'})` };
  if (nonMemberIsSuccess && result.status === 1) return { state: 'ok', output: '' };
  return { state: 'error', detail: `account inspection exited ${result.status}` };
}

function runAccountProbe(file, args, options = {}) {
  try { return classifyAccountProbe({ ok: true, output: execFileSync(file, args, { encoding: 'utf8' }) }, options.nonMemberIsSuccess); }
  catch (error) {
    return classifyAccountProbe({ ok: false, status: error?.status ?? null, code: error?.code ?? null, signal: error?.signal ?? null }, options.nonMemberIsSuccess);
  }
}

/**
 * Operator mode is only ever allowed against the approved isolated lane. Any probe that
 * cannot answer fails closed, so a machine where the checks are unavailable is refused
 * rather than trusted.
 */
function guardOperatorIsolation(profileArg) {
  const facts = {};
  if (typeof process.getuid !== 'function') fail('this platform has no numeric uid, so the isolated-lane guard cannot run');
  const actualUid = process.getuid();
  facts.actualUid = actualUid;
  if (actualUid !== APPROVED.uid) fail(`must run as uid ${APPROVED.uid} (${APPROVED.account}), got uid ${actualUid} — never run this against the everyday account`);

  const idUid = runAccountProbe('/usr/bin/id', ['-u', APPROVED.account], {});
  if (idUid.state !== 'ok') fail(`could not confirm ${APPROVED.account}'s uid (${idUid.detail ?? idUid.state})`);
  if (Number(idUid.output) !== APPROVED.uid) fail(`${APPROVED.account} resolves to uid ${idUid.output}, expected ${APPROVED.uid} — the approved lane is not present`);
  facts.approvedAccountUid = Number(idUid.output);

  const groups = runAccountProbe('/usr/bin/id', ['-Gn', APPROVED.account], {});
  if (groups.state !== 'ok') fail(`could not read ${APPROVED.account}'s group list (${groups.detail ?? groups.state})`);
  if (groups.output.split(/\s+/).filter(Boolean).includes('admin')) fail(`${APPROVED.account} belongs to admin — the approved lane must be a standard account`);
  facts.standardAccount = true;

  const membership = runAccountProbe('/usr/sbin/dseditgroup', ['-o', 'checkmember', '-m', APPROVED.account, 'admin'], { nonMemberIsSuccess: true });
  if (membership.state !== 'ok') fail(`could not confirm ${APPROVED.account}'s admin membership (${membership.detail ?? membership.state}) — failing closed instead of assuming standard`);
  facts.adminMembership = membership.output === '' ? 'none' : membership.output.split('\n')[0];

  if (!fs.existsSync(profileArg)) fail(`approved data root does not exist: ${profileArg}`);
  const rootLink = fs.lstatSync(profileArg);
  if (rootLink.isSymbolicLink()) fail(`approved data root is a symlink: ${profileArg}`);
  if (!rootLink.isDirectory()) fail(`approved data root is not a directory: ${profileArg}`);
  if (rootLink.uid !== APPROVED.uid) fail(`approved data root is owned by uid ${rootLink.uid}, expected ${APPROVED.uid}`);
  const realProfile = fs.realpathSync(profileArg);
  const realApproved = fs.existsSync(APPROVED.root) ? fs.realpathSync(APPROVED.root) : APPROVED.root;
  if (realProfile !== realApproved) fail(`resolved data root ${realProfile} is not the approved ${realApproved}`);
  facts.rootRealpath = realProfile;
  return facts;
}

/* ------------------------------------------------------------------ *
 * Output-path protection (MACV-R4)
 * ------------------------------------------------------------------ */

function safeRealpath(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function realParent(target) {
  try { return fs.realpathSync(path.dirname(target)); } catch { return path.resolve(path.dirname(target)); }
}

function isWithin(dir, target) {
  const rel = path.relative(dir, target);
  return rel === '' || (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Paths/inodes an output must never hit. Metadata only — no file content is read here, so
 * building this list is not itself a read of the library.
 */
function protectedTargets(profile, { receipts = [] } = {}) {
  const targets = [];
  const add = (p) => {
    let st = null;
    try { st = fs.lstatSync(p); } catch { /* absent: path equality still guards it */ }
    targets.push({ path: safeRealpath(p), inode: st ? `${st.dev}:${st.ino}` : null });
  };
  if (profile) {
    const dbPath = path.join(profile, DB_NAME);
    add(profile);
    add(dbPath);
    add(`${dbPath}-wal`);
    add(`${dbPath}-shm`);
    for (const f of listManagedFilePaths(profile)) add(f.absolutePath);
  }
  for (const r of receipts) if (r) add(r);
  return targets;
}

/**
 * Reject, before a single byte is written: an output inside the profile, an output aliasing
 * the database/WAL/SHM/a managed document/an input receipt (resolved path or device:inode,
 * which also catches hard links), a symlink or non-regular destination, and — when asked —
 * any destination that already exists, so evidence is never clobbered.
 */
function guardOutputPath(rawOut, protectedSet, { freshRequired, label }) {
  if (typeof rawOut !== 'string' || rawOut.length === 0) fail(`${label} needs an output path`);
  if (!path.isAbsolute(rawOut)) fail(`${label} output must be an absolute path, got ${rawOut}`);
  const target = path.resolve(rawOut);
  const candidate = path.join(realParent(target), path.basename(target));
  for (const t of protectedSet) {
    if (t.path && (candidate === t.path || isWithin(t.path, candidate))) fail(`${label} output ${target} aliases protected input ${t.path}`);
  }
  let st = null;
  try { st = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') fail(`${label} output ${target} could not be inspected (${error.code})`); }
  if (st) {
    if (st.isSymbolicLink()) fail(`${label} output ${target} is a symlink`);
    if (!st.isFile()) fail(`${label} output ${target} is not a regular file`);
    const id = `${st.dev}:${st.ino}`;
    const alias = protectedSet.find(t => t.inode && t.inode === id);
    if (alias) fail(`${label} output ${target} is a hard link to protected input ${alias.path}`);
    if (freshRequired) fail(`${label} output ${target} already exists; evidence is never clobbered — choose a fresh path`);
  }
  return { target, candidate };
}

function writeReceipt(rawOut, protectedSet, { freshRequired, label, text }) {
  const { target } = guardOutputPath(rawOut, protectedSet, { freshRequired, label });
  fs.writeFileSync(target, text, { flag: freshRequired ? 'wx' : 'w' });
  return target;
}

/* ------------------------------------------------------------------ *
 * Profile guards + quiescent open
 * ------------------------------------------------------------------ */

function statRegular(p, label) {
  let st;
  try { st = fs.lstatSync(p); }
  catch (error) { if (error.code === 'ENOENT') return null; fail(`${label} ${p} could not be inspected (${error.code})`); }
  if (st.isSymbolicLink()) fail(`${label} ${p} is a symlink — refusing to follow it`);
  if (!st.isFile()) fail(`${label} ${p} is not a regular file`);
  if (st.nlink > 1) fail(`${label} ${p} has ${st.nlink} hard links — refusing an aliased copy`);
  return st;
}

/**
 * Precondition guards: structural, ownership, and a *confirmed* stopped app. Nothing here
 * opens or copies a database byte, and the refusal below is deliberately outside any catch.
 */
function guardProfile(profile, expectUid, inspection = inspectAppProcesses()) {
  if (typeof profile !== 'string' || !path.isAbsolute(profile)) fail(`profile root must be an absolute path, got ${profile}`);
  if (!fs.existsSync(profile)) fail(`profile root does not exist: ${profile}`);
  const rootLink = fs.lstatSync(profile);
  if (rootLink.isSymbolicLink()) fail(`profile root ${profile} is a symlink — refusing to follow it`);
  if (!rootLink.isDirectory()) fail(`profile root ${profile} is not a directory`);
  const realProfile = fs.realpathSync(profile);
  if (path.basename(realProfile) !== APP_ID) fail(`profile root ${realProfile} is not a ${APP_ID} data root`);

  const dbPath = path.join(profile, DB_NAME);
  const dbStat = statRegular(dbPath, 'database');
  if (!dbStat) fail(`no ${DB_NAME} under ${profile} — this is not a Her Flight Deck data root`);
  if (expectUid !== null && expectUid !== undefined) {
    if (!Number.isInteger(expectUid)) fail(`expected uid must be an integer, got ${expectUid}`);
    if (dbStat.uid !== expectUid) fail(`database is owned by uid ${dbStat.uid}, expected ${expectUid} — wrong user or wrong root`);
    if (typeof process.getuid === 'function' && process.getuid() !== expectUid) {
      fail(`running as uid ${process.getuid()}, expected ${expectUid} — run this inside the isolated test account`);
    }
  }
  for (const suffix of ['-wal', '-shm']) statRegular(`${dbPath}${suffix}`, 'sidecar');

  // Everything that could read or copy database bytes starts below this line.
  if (!inspection || typeof inspection.state !== 'string') fail('process inspection produced no result');
  if (inspection.state === 'running') {
    fail(`an app is still running (pid(s) ${(inspection.pids ?? []).join(' ')}) — quit both apps and confirm before snapshotting`);
  }
  if (inspection.state !== 'stopped') {
    fail(`process inspection did not confirm a stopped app (${inspection.state}${inspection.detail ? `: ${inspection.detail}` : ''}) — inability to inspect is not proof that nothing is running`);
  }
  return dbPath;
}

function fileAnchor(absolutePath, relativePath) {
  const buf = fs.readFileSync(absolutePath);
  return { relativePath, bytes: buf.length, sha256: sha256Hex(buf) };
}

/** Every regular file under documents/, recursively, metadata only, sorted by relative path. */
function listManagedFilePaths(profile) {
  const docs = path.join(profile, DOCUMENTS_DIR);
  const found = [];
  if (!fs.existsSync(docs)) return found;
  const rootStat = fs.lstatSync(docs);
  if (rootStat.isSymbolicLink()) fail(`${DOCUMENTS_DIR}/ is a symlink — refusing to follow it`);
  if (!rootStat.isDirectory()) fail(`${DOCUMENTS_DIR}/ is not a directory`);
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st;
      try { st = fs.lstatSync(abs); } catch (error) { fail(`managed file ${rel} could not be inspected (${error.code})`); }
      if (st.isSymbolicLink()) fail(`managed file ${DOCUMENTS_DIR}/${rel} is a symlink — refusing an aliased document`);
      if (st.isDirectory()) { walk(abs, rel); continue; }
      if (!st.isFile()) fail(`managed file ${DOCUMENTS_DIR}/${rel} is not a regular file`);
      found.push({ absolutePath: abs, relativePath: `${DOCUMENTS_DIR}/${rel}` });
    }
  };
  walk(docs, '');
  return found.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}

function rootLinkIsSymlink(st) { return st.isSymbolicLink(); }

function managedFileAnchors(profile) {
  return listManagedFilePaths(profile).map(f => fileAnchor(f.absolutePath, f.relativePath));
}

/** Backup/restore/last-run artifacts: recorded for disclosure, never claimed as protected content. */
function listRuntimeFiles(profile) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st;
      try { st = fs.lstatSync(abs); } catch { out.push({ relativePath: rel, unreadable: true }); continue; }
      if (st.isSymbolicLink()) { out.push({ relativePath: rel, symlink: true }); continue; }
      if (st.isDirectory()) { walk(abs, rel); continue; }
      if (!st.isFile()) { out.push({ relativePath: rel, special: true }); continue; }
      try { out.push(fileAnchor(abs, rel)); } catch { out.push({ relativePath: rel, unreadable: true }); }
    }
  };
  for (const child of [BACKUP_DIR, '.restore-staging', '.restore-pending']) {
    if (fs.existsSync(path.join(profile, child))) walk(path.join(profile, child), child);
  }
  const marker = path.join(profile, VERSION_FILE);
  if (fs.existsSync(marker)) { try { out.push(fileAnchor(marker, VERSION_FILE)); } catch { out.push({ relativePath: VERSION_FILE, unreadable: true }); } }
  return out.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}

function databaseFileAnchors(dbPath) {
  const anchors = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    anchors.push({ relativePath: path.basename(p), bytes: st.size, sha256: sha256Hex(fs.readFileSync(p)) });
  }
  return anchors;
}

/**
 * Open a quiescent view: read-only when the WAL is empty/absent, otherwise through a copy of
 * db + -wal (+ -shm) so committed WAL frames are honoured without touching the original. The
 * originals are re-hashed around the copy — a change mid-copy means something is still
 * writing, which refuses. Cleanup runs even when copying or opening the copy fails.
 */
function openQuiescent(dbPath) {
  const wal = `${dbPath}-wal`;
  let walBytes = 0;
  try { const st = fs.lstatSync(wal); if (st.isFile()) walBytes = st.size; } catch { /* no WAL */ }
  if (walBytes === 0) {
    return { db: new DatabaseSync(dbPath, { readOnly: true }), cleanup: () => {}, mode: 'read-only', walBytes: 0 };
  }
  let dir;
  let before;
  try {
    before = databaseFileAnchors(dbPath);
    dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), COPY_PREFIX));
    fs.copyFileSync(dbPath, path.join(dir, DB_NAME));
    fs.copyFileSync(wal, path.join(dir, path.basename(wal)));
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, path.join(dir, path.basename(shmPath)));
    const after = databaseFileAnchors(dbPath);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fail('the database or its WAL changed while it was being copied — something is still writing; quit the app, confirm no process, then retry');
    }
    const db = new DatabaseSync(path.join(dir, DB_NAME));
    return {
      db,
      cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } },
      mode: `wal-copy-snapshot (${walBytes} bytes of WAL read from a copy; originals re-hashed unchanged)`,
      walBytes,
      originalsBefore: before,
    };
  } catch (error) {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    const message = String(error?.message ?? error);
    if (message.startsWith('REFUSED:')) throw error;
    fail(`the library could not be copied for a quiescent read (${message}) — nothing was read from it and the scratch copy was removed`);
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic framed digests (MACV-R5)
 * ------------------------------------------------------------------ */

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnsOf(db, table) {
  return db.prepare('SELECT name, pk FROM pragma_table_info(?) ORDER BY cid').all(table);
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function framed(text) { const b = Buffer.from(String(text), 'utf8'); return [u32(b.length), b]; }
function framedBytes(buf) { return [u32(buf.length), buf]; }

/** Exact stored value -> {tag, payload, json}: real type and full bytes, never a truncating form. */
function encodeCell(type, value, hexValue) {
  switch (type) {
    case 'null': return { tag: 'n', payload: Buffer.alloc(0), json: { t: 'null', v: null } };
    case 'integer': {
      const text = typeof value === 'bigint' ? value.toString()
        : (typeof value === 'number' && Number.isInteger(value) ? String(value) : null);
      if (text === null) fail(`INTEGER value could not be written exactly (${String(value)})`);
      return { tag: 'i', payload: Buffer.from(text, 'utf8'), json: { t: 'integer', v: text } };
    }
    case 'real': {
      if (typeof value !== 'number') fail('REAL value did not arrive as a number');
      const b = Buffer.alloc(8);
      b.writeDoubleBE(value, 0);
      return { tag: 'r', payload: b, json: { t: 'real', v: b.toString('hex') } };
    }
    case 'text': {
      if (typeof hexValue !== 'string') fail('TEXT value produced no byte form');
      return { tag: 'x', payload: Buffer.from(hexValue, 'hex'), json: { t: 'text', v: hexValue } };
    }
    case 'blob': {
      if (typeof hexValue !== 'string') fail('BLOB value produced no byte form');
      return { tag: 'b', payload: Buffer.from(hexValue, 'hex'), json: { t: 'blob', v: hexValue } };
    }
    default: fail(`unknown SQLite storage type ${JSON.stringify(type)} — refusing to hash a value it cannot represent exactly`);
  }
}

/**
 * Frame = magic | table identity | ordered column identity | real primary key | rows
 * (each cell: type tag + exact length + exact bytes) | row-count trailer. Explicit lengths
 * make every boundary unambiguous, so no stored byte sequence can imitate another row.
 */
function digestRows(table, columns, primaryKey, rows) {
  const parts = [Buffer.from('HFDTAB1', 'ascii'), ...framed(table), u32(columns.length)];
  for (const c of columns) parts.push(...framed(c));
  parts.push(u32(primaryKey.length));
  for (const c of primaryKey) parts.push(...framed(c));
  parts.push(u32(rows.length));
  for (const row of rows) for (const cell of row) parts.push(Buffer.from(cell.tag, 'ascii'), ...framedBytes(cell.payload));
  parts.push(u32(rows.length));
  return sha256Hex(Buffer.concat(parts));
}

function typedSelect(cols) {
  const select = [];
  cols.forEach((c, i) => { select.push(`typeof("${c}") AS "T${i}"`, `"${c}" AS "V${i}"`, `hex("${c}") AS "H${i}"`); });
  return select.join(', ');
}

function prepared(db, sql) {
  const stmt = db.prepare(sql);
  if (typeof stmt.setReadBigInts === 'function') stmt.setReadBigInts(true);
  return stmt;
}

/**
 * Type-faithful, deterministic digest of one table. A declared key must equal the real
 * primary key, so schema drift is refused instead of being hashed in arbitrary order.
 */
function digestTable(db, table, declaredKey) {
  if (typeof table !== 'string' || !/^[A-Za-z0-9_]+$/.test(table)) fail(`unsafe table name ${JSON.stringify(table)}`);
  const info = columnsOf(db, table);
  const cols = info.map(r => r.name);
  if (cols.length === 0) fail(`table ${table} has no columns (it does not exist)`);
  const primaryKey = info.filter(r => r.pk > 0).sort((a, b) => a.pk - b.pk).map(r => r.name);
  if (primaryKey.length === 0) fail(`table ${table} has no primary key — refusing an unordered digest`);
  if (declaredKey !== undefined && declaredKey !== null) {
    if (!Array.isArray(declaredKey) || !sameList(declaredKey, primaryKey)) {
      fail(`${table}: declared key [${(declaredKey ?? []).join(',')}] is not the real primary key [${primaryKey.join(',')}]`);
    }
  }
  const order = primaryKey.map(c => `"${c}" ASC`).join(', ');
  const rows = prepared(db, `SELECT ${typedSelect(cols)} FROM "${table}" ORDER BY ${order}`).all();
  const cells = rows.map(raw => cols.map((c, i) => encodeCell(raw[`T${i}`], raw[`V${i}`], raw[`H${i}`])));
  return { rowCount: cells.length, sha256: digestRows(table, cols, primaryKey, cells), columns: cols, primaryKey };
}

/**
 * One framed digest per app_metadata row, keyed by its key, so the restore contract can set
 * the backup receipt aside by name and still compare every other row. Digests only: values
 * such as the saved backup path never enter a receipt.
 */
function metadataKeyDigests(db) {
  const info = columnsOf(db, 'app_metadata');
  const cols = info.map(r => r.name);
  const primaryKey = info.filter(r => r.pk > 0).sort((a, b) => a.pk - b.pk).map(r => r.name);
  if (!sameList(primaryKey, ['key'])) fail(`app_metadata: primary key [${primaryKey.join(',')}] is not [key]`);
  const keyIndex = cols.indexOf('key');
  const out = {};
  for (const raw of prepared(db, `SELECT ${typedSelect(cols)} FROM "app_metadata" ORDER BY "key" ASC`).all()) {
    if (raw[`T${keyIndex}`] !== 'text') fail('app_metadata has a key that is not text');
    const cells = cols.map((c, i) => encodeCell(raw[`T${i}`], raw[`V${i}`], raw[`H${i}`]));
    out[String(raw[`V${keyIndex}`])] = digestRows('app_metadata', cols, primaryKey, [cells]);
  }
  return out;
}

function isKeyDigestMap(map) {
  return !!map && typeof map === 'object' && !Array.isArray(map) && Object.values(map).every(isHex64);
}

/** Restore only: compare app_metadata as the archive holds it, setting aside the backup receipt by name. */
function backupReceiptComparison(before, after) {
  const policy = 'restore compares the archive contents: the backup-receipt keys the export wrote after creating the archive are set aside by exact name; every other app_metadata key is compared row by row';
  if (!isKeyDigestMap(before?.keyDigests) || !isKeyDigestMap(after?.keyDigests)) {
    return { applied: false, excludedKeys: BACKUP_RECEIPT_KEYS, policy, reason: 'one or both snapshots predate per-key app_metadata digests, so app_metadata is compared strictly; recapture both snapshots to apply the receipt exclusion' };
  }
  const x = before.keyDigests, y = after.keyDigests;
  const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);
  const otherKeys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => !BACKUP_RECEIPT_KEYS.includes(k)).sort();
  const otherKeysChanged = otherKeys.filter(k => !has(x, k) || !has(y, k) || x[k] !== y[k]);
  return {
    applied: true,
    excludedKeys: BACKUP_RECEIPT_KEYS,
    policy,
    receiptKeysBefore: BACKUP_RECEIPT_KEYS.filter(k => has(x, k)),
    receiptKeysAfter: BACKUP_RECEIPT_KEYS.filter(k => has(y, k)),
    otherKeysCompared: otherKeys.length,
    otherKeysChanged,
    otherKeysIdentical: otherKeysChanged.length === 0,
  };
}

function actualPrimaryKey(db, table) {
  return columnsOf(db, table).filter(r => r.pk > 0).sort((a, b) => a.pk - b.pk).map(r => r.name);
}

function ledger(db) {
  for (const name of LEDGER_CANDIDATES) {
    if (!tableExists(db, name)) continue;
    const cols = columnsOf(db, name).map(r => r.name);
    if (!cols.includes('version')) fail(`ledger ${name} has no version column`);
    const digest = digestTable(db, name, actualPrimaryKey(db, name));
    const versions = db.prepare(`SELECT "version" AS v FROM "${name}" ORDER BY "version" ASC`).all().map(r => Number(r.v));
    const rows = prepared(db, `SELECT ${typedSelect(cols)} FROM "${name}" ORDER BY "version" ASC`).all()
      .map(raw => Object.fromEntries(cols.map((c, i) => [c, encodeCell(raw[`T${i}`], raw[`V${i}`], raw[`H${i}`]).json])));
    return { table: name, columns: cols, maxVersion: versions.length ? Math.max(...versions) : 0, versions, rowCount: digest.rowCount, rowDigest: digest.sha256, rows };
  }
  return { table: null, columns: [], maxVersion: 0, versions: [], rowCount: 0, rowDigest: null, rows: [] };
}

function schemaObjects(db) {
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const parts = [Buffer.from('HFDOBJ1', 'ascii'), u32(rows.length)];
  for (const r of rows) parts.push(...framed(r.type), ...framed(r.name), ...framed(r.sql ?? ''));
  const objects = rows.map(r => ({ type: r.type, name: r.name, sql: r.sql ?? '' }));
  const definitions = Object.fromEntries(rows.map(r => [r.name, {
    type: r.type,
    sql: r.sql ?? '',
    digest: sha256Hex(Buffer.concat([Buffer.from(r.type, 'utf8'), Buffer.from(r.name, 'utf8'), Buffer.from(r.sql ?? '', 'utf8')])),
  }]));
  return {
    count: rows.length,
    names: rows.map(r => r.name).sort(),
    digest: sha256Hex(Buffer.concat(parts)),
    objects,
    definitions,
  };
}

/* ------------------------------------------------------------------ *
 * Snapshot
 * ------------------------------------------------------------------ */

function buildSnapshot(db, profile, dbPath, extra) {
  const history = {};
  for (const t of HISTORY_TABLES) {
    history[t.name] = tableExists(db, t.name) ? digestTable(db, t.name, t.key) : { rowCount: 0, sha256: null, absent: true };
  }
  if (history.app_metadata.absent !== true) history.app_metadata.keyDigests = metadataKeyDigests(db);
  const schema13Tables = {};
  for (const name of SCHEMA13_TABLES) {
    schema13Tables[name] = tableExists(db, name) ? { absent: false, ...digestTable(db, name) } : { absent: true, rowCount: 0 };
  }
  const led = ledger(db);
  if (!led.table) fail(`${profile} has no desktop migration ledger (${LEDGER_CANDIDATES.join(' or ')}) — this is not a Her Flight Deck library`);
  const missing = Object.entries(history).filter(([, v]) => v.absent).map(([k]) => k).sort();
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  const unexpectedTables = tableNames
    .filter(n => !RETAINED_NAMES.includes(n) && !SCHEMA13_TABLES.includes(n) && !LEDGER_CANDIDATES.includes(n))
    .sort();
  const objects = schemaObjects(db);
  return {
    schema: SNAP_V3,
    takenAt: new Date().toISOString(),
    profile,
    database: DB_NAME,
    openMode: extra.openMode,
    ownerUid: fs.statSync(dbPath).uid,
    isolation: extra.isolation,
    helper: { node: process.version, snapshotSchema: SNAP_V3, currentSchemaVersion: CURRENT_SCHEMA_VERSION },
    ledger: led,
    history,
    schema13Tables,
    inventory: {
      retainedTables: RETAINED_NAMES.slice().sort(),
      schema13Tables: SCHEMA13_TABLES.slice().sort(),
      presentRetained: Object.entries(history).filter(([, v]) => !v.absent).map(([k]) => k).sort(),
      missingRetained: missing,
      databaseTables: tableNames.slice().sort(),
      unexpectedTables,
      complete: missing.length === 0 && unexpectedTables.length === 0,
    },
    schemaObjects: objects,
    fileAnchors: managedFileAnchors(profile),
    runtimeFiles: listRuntimeFiles(profile),
    databaseFileAnchors: databaseFileAnchors(dbPath),
  };
}

function isTestContext(ctx) { return !!ctx && ctx.internalTestFixture === true; }

/** Internal scratch checks reach this; the CLI cannot, so the operator path stays hard. */
function assertTestContext(ctx) {
  if (!isTestContext(ctx)) return null;
  if (typeof ctx.root !== 'string') fail('internal test context has no root');
  const realTmp = fs.realpathSync(os.tmpdir());
  const resolved = safeRealpath(ctx.root);
  if (!isWithin(realTmp, resolved)) fail(`internal test root ${resolved} is not under ${realTmp}`);
  const parts = path.relative(realTmp, resolved).split(path.sep);
  if (!parts.some(x => x.startsWith(SCRATCH_PREFIX))) fail(`internal test root ${resolved} is not inside task-owned ${SCRATCH_PREFIX}* scratch`);
  if (path.basename(resolved) !== APP_ID) fail(`internal test root ${resolved} is not a ${APP_ID} directory`);
  if (!Number.isInteger(ctx.uid)) fail('internal test context needs a numeric uid');
  return { root: resolved, uid: ctx.uid, inspect: ctx.inspect ?? (() => controlledInspection('stopped')) };
}

function snapshot(opts) {
  const ctx = assertTestContext(opts.testContext);
  const operator = !ctx;
  const label = 'snapshot';

  // 1. Resolve the target. Operator mode has exactly one legal answer.
  const profile = ctx ? safeRealpath(opts.expectProfile ?? ctx.root) : path.resolve(opts.expectProfile ?? APPROVED.root);
  if (ctx && profile !== ctx.root) fail(`${label}: internal test root ${profile} escapes its own scratch directory`);

  // 2. Output protection, before anything is opened or copied.
  if (opts.jsonOut) guardOutputPath(opts.jsonOut, protectedTargets(profile), { label, freshRequired: false });

  // 3. Argument sanity: the approved lane cannot be retargeted from the command line.
  if (operator && opts.expectUid !== null && opts.expectUid !== undefined && Number(opts.expectUid) !== APPROVED.uid) {
    fail(`${label}: --expect-uid cannot retarget the approved lane; only uid ${APPROVED.uid} is allowed`);
  }
  const expectUid = ctx ? ctx.uid : APPROVED.uid;

  // 4. Guards: structural, ownership, confirmed-stopped app — still no database byte read.
  const inspection = ctx ? ctx.inspect() : inspectAppProcesses();
  const dbPath = guardProfile(profile, expectUid, inspection);

  // 5. Operator isolation policy (real uid, standard account, canonical approved root).
  if (operator) guardOperatorIsolation(profile);

  // 6. Read, then re-check the destination (it may have appeared while reading) and write.
  const { db, cleanup, mode } = openQuiescent(dbPath);
  let result;
  try {
    result = buildSnapshot(db, profile, dbPath, {
      openMode: mode,
      isolation: {
        operator,
        approvedRoot: APPROVED.root,
        approvedUid: APPROVED.uid,
        expectedUid: expectUid,
        processInspection: inspection,
        testFixture: !!ctx,
      },
    });
  } finally {
    try { db.close(); } finally { cleanup(); }
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (opts.jsonOut) writeReceipt(opts.jsonOut, protectedTargets(profile), { label, freshRequired: operator, text });
  else console.log(text.trimEnd());
  return result;
}

/* ------------------------------------------------------------------ *
 * Validation + purpose-specific comparison (MACV-R5)
 * ------------------------------------------------------------------ */

const PURPOSES = {
  unchanged: { gateEligible: true, label: 'protected library invariance: the same data before and after' },
  upgrade: { gateEligible: true, label: 'a genuine schema-12 library upgraded to schema-13' },
  restore: { gateEligible: true, label: 'a genuine schema-12 backup restored and migrated to schema-13' },
  history: { gateEligible: false, label: 'retained history maps only — explicitly partial, never a gate verdict' },
};

// Current receipts must contain every fact consumed by a complete contract.
function validateCompleteFacts(snap) {
  const errors = [];
  const add = x => errors.push(`${x}; recapture a complete v3 snapshot`);
  const list = x => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0) && new Set(x).size === x.length;
  for (const [name, entry] of Object.entries({...snap.history, ...snap.schema13Tables})) {
    if (entry.absent === true) {
      if (entry.rowCount !== 0 || entry.sha256 != null) add(`${name} has inconsistent absent-table facts`);
      continue;
    }
    if (!list(entry.columns) || !entry.columns.length || !list(entry.primaryKey) || !entry.primaryKey.length || entry.primaryKey.some(k => !entry.columns.includes(k))) add(`${name} lacks complete column/key identity`);
  }
  const o = snap.schemaObjects;
  if (!o || !list(o.names) || !Number.isInteger(o.count) || o.count !== o.names.length || !o.definitions || typeof o.definitions !== 'object' || Array.isArray(o.definitions) || !Array.isArray(o.objects)) { add('schema object inventory is incomplete'); }
  else {
    if (!sameList(Object.keys(o.definitions).sort(), [...o.names].sort()) || o.objects.length !== o.count) add('schema object names/count/definitions disagree');
    const rows = [];
    for (const name of o.names) {
      const d = o.definitions[name];
      if (!d || !['table','index','view','trigger'].includes(d.type) || typeof d.sql !== 'string' || !d.sql.trim() || !isHex64(d.digest)) { add(`schema object ${name} lacks a valid definition`); continue; }
      if (d.digest !== sha256Hex(Buffer.concat([Buffer.from(d.type),Buffer.from(name),Buffer.from(d.sql)]))) add(`schema object ${name} definition digest is inconsistent`);
      rows.push({type:d.type,name,sql:d.sql});
    }
    rows.sort((a,b)=>a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    if (JSON.stringify(rows) !== JSON.stringify(o.objects)) add('schema object definition and object inventories disagree');
    const parts = [Buffer.from('HFDOBJ1'),u32(rows.length)];
    for (const row of rows) parts.push(...framed(row.type),...framed(row.name),...framed(row.sql));
    if (o.digest !== sha256Hex(Buffer.concat(parts))) add('schema object aggregate digest is inconsistent');
  }
  const led = snap.ledger;
  if (!led || led.table !== '_sqlx_migrations' || !list(led.columns) || !['version','description','installed_on','success','checksum','execution_time'].every(k=>led.columns.includes(k)) || !Array.isArray(led.rows) || !isHex64(led.rowDigest) || led.rowCount !== led.rows.length || led.rows.length !== led.versions?.length) { add('SQLx ledger facts are incomplete'); }
  else {
    const cells=[];
    for (let i=0;i<led.rows.length;i++) {
      const row=led.rows[i], encoded=[];
      if (!row || !sameList(Object.keys(row).sort(), [...led.columns].sort()) || row.version?.t !== 'integer' || row.version.v !== String(led.versions[i]) || row.success?.t !== 'integer' || row.success.v !== '1' || row.checksum?.t !== 'blob' || !/^[a-fA-F0-9]{96}$/.test(row.checksum.v??'')) { add(`SQLx ledger row ${i} is incomplete or unsuccessful`); continue; }
      for (const column of led.columns) {
        const cell=row[column];
        try {
          if (!cell || typeof cell !== 'object') throw Error();
          if (cell.t === 'integer' && /^-?(0|[1-9][0-9]*)$/.test(cell.v)) encoded.push(encodeCell('integer',BigInt(cell.v)));
          else if (cell.t === 'text' || cell.t === 'blob') {
            if (typeof cell.v !== 'string' || !/^(?:[a-fA-F0-9]{2})*$/.test(cell.v)) throw Error();
            encoded.push(encodeCell(cell.t,null,cell.v));
          } else if (cell.t === 'null' && cell.v === null) encoded.push(encodeCell('null',null));
          else if (cell.t === 'real' && /^[a-fA-F0-9]{16}$/.test(cell.v)) encoded.push(encodeCell('real',Buffer.from(cell.v,'hex').readDoubleBE(0)));
          else throw Error();
        } catch { add(`SQLx ledger row ${i}/${column} has an invalid cell`); }
      }
      cells.push(encoded);
    }
    if (led.maxVersion !== led.versions.at(-1)) add('SQLx ledger maxVersion disagrees with rows');
    if (cells.length===led.rows.length && cells.every(row=>row.length===led.columns.length) && digestRows(led.table,led.columns,['version'],cells)!==led.rowDigest) add('SQLx ledger row digest is inconsistent');
  }
  const inventory=snap.inventory;
  const expectedTables=[...RETAINED_NAMES,...SCHEMA13_TABLES.filter(name=>snap.schema13Tables[name]?.absent!==true),snap.ledger?.table].sort();
  if (!inventory || !sameList(inventory.retainedTables, [...RETAINED_NAMES].sort()) || !sameList(inventory.schema13Tables,[...SCHEMA13_TABLES].sort()) || !sameList(inventory.databaseTables,expectedTables) || inventory.missingRetained?.length!==0 || inventory.unexpectedTables?.length!==0 || !sameList(inventory.presentRetained,[...RETAINED_NAMES].sort())) add('complete table inventory is inconsistent');
  return errors;
}

function validateSnapshot(side, snap) {
  const p = [];
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return [`${side}: is not a snapshot object`];
  if (snap.schema !== SNAP_V1 && snap.schema !== SNAP_V2 && snap.schema !== SNAP_V3) p.push(`unknown snapshot schema ${JSON.stringify(snap.schema)}`);
  if (typeof snap.profile !== 'string' || !path.isAbsolute(snap.profile)) p.push('profile is not an absolute path');
  if (snap.database !== DB_NAME) p.push(`database must be ${DB_NAME}`);
  if (!Number.isInteger(snap.ownerUid) || snap.ownerUid < 0) p.push('ownerUid is not a non-negative integer');

  const led = snap.ledger;
  if (!led || typeof led !== 'object') p.push('ledger facts are missing');
  else {
    if (typeof led.table !== 'string' || !LEDGER_CANDIDATES.includes(led.table)) p.push(`ledger.table ${JSON.stringify(led.table)} is not a known migration ledger`);
    if (!Number.isInteger(led.maxVersion) || led.maxVersion < 0) p.push('ledger.maxVersion is not a non-negative integer');
    if (!Array.isArray(led.versions) || led.versions.length === 0) p.push('ledger.versions is empty — a migrated library always records the versions it applied');
    else if (led.versions.some(v => !Number.isInteger(v))) p.push('ledger.versions contains a non-integer');
    else if (led.versions.some((v, i) => i > 0 && v <= led.versions[i - 1])) p.push('ledger.versions are not strictly increasing');
  }

  if (!snap.history || typeof snap.history !== 'object' || Array.isArray(snap.history)) p.push('retained table digests are missing');
  else {
    for (const name of RETAINED_NAMES) {
      const entry = snap.history[name];
      if (!entry) { p.push(`missing required table entry ${name}`); continue; }
      if (entry.absent === true) { p.push(`required table ${name} is absent`); continue; }
      if (!Number.isInteger(entry.rowCount) || entry.rowCount < 0) p.push(`${name}.rowCount is not a non-negative integer`);
      if (!isHex64(entry.sha256)) p.push(`${name}.sha256 is not 64 lowercase hex digits`);
    }
    const extra = Object.keys(snap.history).filter(k => !RETAINED_NAMES.includes(k));
    if (extra.length) p.push(`unexpected table entries ${extra.join(',')}`);
    const meta = snap.history.app_metadata;
    if (meta && meta.keyDigests !== undefined) {
      if (!isKeyDigestMap(meta.keyDigests)) p.push('app_metadata.keyDigests is not a map of 64-hex digests');
      else if (Object.keys(meta.keyDigests).length !== meta.rowCount) p.push(`app_metadata.keyDigests lists ${Object.keys(meta.keyDigests).length} keys but the table has ${meta.rowCount} rows`);
    }
  }

  if (!snap.schema13Tables || typeof snap.schema13Tables !== 'object' || Array.isArray(snap.schema13Tables)) p.push('schema-13 table facts are missing');
  else {
    for (const name of SCHEMA13_TABLES) {
      const entry = snap.schema13Tables[name];
      if (!entry) { p.push(`missing schema-13 table fact ${name}`); continue; }
      if (!Number.isInteger(entry.rowCount) || entry.rowCount < 0) p.push(`${name}.rowCount is not a non-negative integer`);
      if (entry.absent !== true && !isHex64(entry.sha256)) p.push(`${name} claims to exist without a digest`);
    }
  }

  if (!Array.isArray(snap.fileAnchors)) p.push('fileAnchors is not an array');
  else {
    const seen = new Set();
    for (const f of snap.fileAnchors) {
      if (!f || typeof f.relativePath !== 'string' || !Number.isInteger(f.bytes) || f.bytes < 0 || !isHex64(f.sha256)) { p.push('a file anchor is malformed'); break; }
      if (seen.has(f.relativePath)) { p.push(`duplicate file anchor ${f.relativePath}`); break; }
      seen.add(f.relativePath);
    }
  }

  if (snap.schema === SNAP_V2 || snap.schema === SNAP_V3) {
    if (!snap.inventory || !Array.isArray(snap.inventory.retainedTables) || typeof snap.inventory.complete !== 'boolean') p.push('inventory facts are missing');
    else if (!snap.inventory.complete) p.push(`inventory is incomplete (missing ${(snap.inventory.missingRetained ?? []).join(',') || 'none'}; unexpected ${(snap.inventory.unexpectedTables ?? []).join(',') || 'none'})`);
    else if (snap.inventory.retainedTables.length !== RETAINED_NAMES.length) p.push(`inventory lists ${snap.inventory.retainedTables.length} retained tables, expected ${RETAINED_NAMES.length}`);
    if (!snap.schemaObjects || !isHex64(snap.schemaObjects.digest)) p.push('schema object digest is missing');
    if (!snap.isolation || !snap.isolation.processInspection) p.push('isolation facts are missing');
    else if (snap.isolation.processInspection.state !== 'stopped') p.push(`the snapshot was not taken with a confirmed stopped app (${snap.isolation.processInspection.state})`);
    if (!Array.isArray(snap.databaseFileAnchors)) p.push('database file anchors are missing');
    if (Object.entries(snap.history ?? {}).some(([, v]) => !Array.isArray(v?.columns) || !Array.isArray(v?.primaryKey))) p.push('a table digest is missing its column identity');
    if (!Array.isArray(snap.ledger?.rows)) p.push('ledger rows are missing');
  }
  if (snap.schema === SNAP_V3) {
    if (p.length === 0) p.push(...validateCompleteFacts(snap));
  }
  return p.map(x => `${side}: ${x}`);
}

function entryEqual(x, y) {
  return (x?.sha256 ?? null) === (y?.sha256 ?? null)
    && (x?.rowCount ?? 0) === (y?.rowCount ?? 0)
    && (x?.absent === true) === (y?.absent === true);
}

function anchorMap(list) { const m = {}; for (const f of list ?? []) m[f.relativePath] = f; return m; }

function compareAnchors(a, b, diffs, tag) {
  const x = anchorMap(a), y = anchorMap(b);
  const names = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  for (const name of names) {
    const l = x[name], r = y[name];
    if (!l) { diffs.push(`${tag}: file added ${name}`); continue; }
    if (!r) { diffs.push(`${tag}: file removed ${name}`); continue; }
    if (l.sha256 !== r.sha256) diffs.push(`${tag}: file bytes changed ${name} (${l.bytes}B -> ${r.bytes}B)`);
    else if (l.bytes !== r.bytes) diffs.push(`${tag}: file size changed ${name}`);
  }
}

function ledgerIdentity(a, b, diffs, tag) {
  if ((a.ledger.table ?? null) !== (b.ledger.table ?? null)) diffs.push(`${tag}: ledger table changed ${a.ledger.table} -> ${b.ledger.table}`);
  const ac = a.ledger.columns ?? [], bc = b.ledger.columns ?? [];
  if (ac.length && bc.length && ac.join() !== bc.join()) diffs.push(`${tag}: ledger columns changed ${ac.join(',')} -> ${bc.join(',')}`);
}

function ledgerInvariant(a, b, diffs, tag) {
  ledgerIdentity(a, b, diffs, tag);
  if (a.ledger.maxVersion !== b.ledger.maxVersion) diffs.push(`${tag}: ledger max version changed ${a.ledger.maxVersion} -> ${b.ledger.maxVersion}`);
  if ((a.ledger.versions ?? []).join() !== (b.ledger.versions ?? []).join()) diffs.push(`${tag}: ledger recorded version list changed ${(a.ledger.versions ?? []).join(',')} -> ${(b.ledger.versions ?? []).join(',')}`);
  if (a.ledger.rowDigest && b.ledger.rowDigest && a.ledger.rowDigest !== b.ledger.rowDigest) diffs.push(`${tag}: ledger rows changed`);
}

function ledgerPrefix(a, b, diffs, tag) {
  ledgerIdentity(a, b, diffs, tag);
  const before = a.ledger.versions ?? [], after = b.ledger.versions ?? [];
  if (after.length < before.length) { diffs.push(`${tag}: ledger lost ${before.length - after.length} recorded migration(s)`); return; }
  for (let i = 0; i < before.length; i++) {
    if (after[i] !== before[i]) { diffs.push(`${tag}: ledger version at position ${i} changed ${before[i]} -> ${after[i]}`); return; }
  }
  if (before.length && after.length > before.length && after[before.length] <= before[before.length - 1]) {
    diffs.push(`${tag}: ledger added a version that is not newer (${after[before.length]})`);
  }
  const rowsBefore = a.ledger.rows ?? [], rowsAfter = b.ledger.rows ?? [];
  if (rowsBefore.length && rowsAfter.length) {
    if (rowsAfter.length < rowsBefore.length) { diffs.push(`${tag}: ledger rows disappeared`); return; }
    for (let i = 0; i < rowsBefore.length; i++) {
      if (JSON.stringify(rowsAfter[i]) !== JSON.stringify(rowsBefore[i])) { diffs.push(`${tag}: ledger row ${JSON.stringify(rowsBefore[i]?.version?.v ?? i)} changed content`); return; }
    }
  }
}

function missingPopulation(snap) {
  return POPULATION_REQUIREMENT.filter(name => (snap.history?.[name]?.rowCount ?? 0) < 1);
}

function resolvePurpose(opts) {
  let purpose = opts.purpose;
  if (!purpose && opts.historyOnly) purpose = 'history';
  if (!purpose) purpose = 'unchanged';
  if (!Object.prototype.hasOwnProperty.call(PURPOSES, purpose)) fail(`unknown purpose ${JSON.stringify(purpose)} (expected ${Object.keys(PURPOSES).join('|')})`);
  return purpose;
}

function compare(opts) {
  if (!opts.before || !opts.after) fail('compare needs --before and --after');
  let a, b;
  try { a = JSON.parse(fs.readFileSync(opts.before, 'utf8')); } catch (error) { fail(`compare could not read --before ${opts.before} (${String(error.message).split('\n')[0]})`); }
  try { b = JSON.parse(fs.readFileSync(opts.after, 'utf8')); } catch (error) { fail(`compare could not read --after ${opts.after} (${String(error.message).split('\n')[0]})`); }
  const problems = [...validateSnapshot('before', a), ...validateSnapshot('after', b)];
  if (problems.length) fail(`snapshot(s) are not usable for a verdict — ${problems.join('; ')}`);

  const purpose = resolvePurpose(opts);
  const contract = PURPOSES[purpose];
  const subset = a.schema !== SNAP_V3 || b.schema !== SNAP_V3;
  const diffs = [];
  const notes = [];
  const sections = {};

  if (a.profile !== b.profile) diffs.push(`profile root changed ${a.profile} -> ${b.profile}`);
  if (a.database !== b.database) diffs.push('database file name changed');
  if (a.ownerUid !== b.ownerUid) diffs.push(`library owner uid changed ${a.ownerUid} -> ${b.ownerUid}`);

  // Retained library digests — every inventoried table, not only the visible history.
  const tablesDiffering = RETAINED_NAMES.filter(name => !entryEqual(a.history[name], b.history[name]));
  // A restore baseline captured after the export carries the backup receipt the export wrote
  // once the archive existed. Restore compares what the archive holds: app_metadata passes only
  // when every key other than the receipt is identical row by row.
  const receipt = purpose === 'restore' ? backupReceiptComparison(a.history.app_metadata, b.history.app_metadata) : null;
  const receiptOnly = receipt?.applied === true && receipt.otherKeysIdentical && tablesDiffering.includes('app_metadata');
  const changedTables = receiptOnly ? tablesDiffering.filter(name => name !== 'app_metadata') : tablesDiffering;
  const historyUnchanged = changedTables.length === 0;
  for (const name of changedTables) {
    diffs.push(`${name}: before ${a.history[name].rowCount}/${a.history[name].sha256 ?? 'absent'} after ${b.history[name].rowCount}/${b.history[name].sha256 ?? 'absent'}`);
  }
  if (receipt?.applied && !receipt.otherKeysIdentical) diffs.push(`app_metadata: keys other than the backup receipt differ (${receipt.otherKeysChanged.join(', ')})`);
  if (receiptOnly) notes.push(`restore: app_metadata differs only in the backup receipt (${BACKUP_RECEIPT_KEYS.join(', ')}), which the export writes after creating the archive; every other app_metadata key matched`);
  const columnDrift = subset ? [] : RETAINED_NAMES.filter(name => (a.history[name].columns ?? []).join() !== (b.history[name].columns ?? []).join());
  for (const name of columnDrift) diffs.push(`${name}: column identity/order changed`);
  sections.retainedTables = { compared: RETAINED_NAMES.length, changed: changedTables, columnDrift, receiptOnlyDifference: receiptOnly ? ['app_metadata'] : [] };
  if (receipt) sections.backupReceipt = { ...receipt, receiptOnlyDifference: receiptOnly };

  // Managed document bytes.
  const fileDiffs = [];
  compareAnchors(a.fileAnchors, b.fileAnchors, fileDiffs, 'files');
  sections.files = { before: (a.fileAnchors ?? []).length, after: (b.fileAnchors ?? []).length, changed: fileDiffs };
  diffs.push(...fileDiffs);
  const filesUnchanged = fileDiffs.length === 0;

  // Migration ledger, per contract.
  const ledgerDiffs = [];
  if (purpose === 'unchanged' || purpose === 'history') ledgerInvariant(a, b, ledgerDiffs, 'ledger');
  else ledgerPrefix(a, b, ledgerDiffs, 'ledger');
  if (purpose === 'upgrade' && b.ledger.maxVersion !== CURRENT_SCHEMA_VERSION) ledgerDiffs.push(`ledger: upgraded library is version ${b.ledger.maxVersion}, expected ${CURRENT_SCHEMA_VERSION}`);
  if (purpose === 'upgrade' && a.ledger.maxVersion !== RETAINED_SCHEMA_VERSION) ledgerDiffs.push(`ledger: upgrade baseline library is version ${a.ledger.maxVersion}, expected ${RETAINED_SCHEMA_VERSION}`);
  if (purpose === 'restore' && b.ledger.maxVersion !== CURRENT_SCHEMA_VERSION) ledgerDiffs.push(`ledger: restored library is version ${b.ledger.maxVersion}, expected exactly ${CURRENT_SCHEMA_VERSION}`);
  if ((purpose === 'upgrade' || purpose === 'restore') && !subset) {
    const expectedBefore = Array.from({length: 12}, (_, i) => i + 1);
    const expectedAfter = [...expectedBefore, 13];
    if (!sameList(a.ledger.versions, expectedBefore) || !sameList(b.ledger.versions, expectedAfter)) ledgerDiffs.push('ledger: expected the exact migration sequence 1–12 to 1–13');
    const migration = b.ledger.rows.find(row => row.version?.v === '13');
    if (!migration || migration.success?.t !== 'integer' || migration.success.v !== '1' || migration.checksum?.t !== 'blob' || migration.checksum.v.toLowerCase() !== MIGRATION13_CHECKSUM) ledgerDiffs.push('ledger: migration 13 is absent, unsuccessful or does not match the shipped SQLx checksum');
  }
  if (purpose === 'restore' && a.ledger.maxVersion !== RETAINED_SCHEMA_VERSION) ledgerDiffs.push(`ledger: restore baseline library is version ${a.ledger.maxVersion}, expected ${RETAINED_SCHEMA_VERSION}`);
  if (purpose === 'upgrade' && !subset && a.ledger.maxVersion === CURRENT_SCHEMA_VERSION && b.ledger.maxVersion === CURRENT_SCHEMA_VERSION && (a.ledger.rows ?? []).length === (b.ledger.rows ?? []).length) {
    ledgerDiffs.push('ledger: no migration was actually applied between these snapshots');
  }
  sections.ledger = { before: { table: a.ledger.table, maxVersion: a.ledger.maxVersion, versions: a.ledger.versions }, after: { table: b.ledger.table, maxVersion: b.ledger.maxVersion, versions: b.ledger.versions }, diffs: ledgerDiffs };
  diffs.push(...ledgerDiffs);

  // Schema-13 tables (presence, row counts, digests, columns, keys).
  const schema13Diffs = [];
  const absentBefore = SCHEMA13_TABLES.filter(n => a.schema13Tables[n]?.absent === true);
  const absentAfter = SCHEMA13_TABLES.filter(n => b.schema13Tables[n]?.absent === true);
  if (purpose === 'unchanged' || purpose === 'history') {
    if (absentBefore.join() !== absentAfter.join()) schema13Diffs.push(`schema-13 table presence changed (${absentBefore.join(',') || 'none'} absent -> ${absentAfter.join(',') || 'none'} absent)`);
    if (purpose === 'unchanged') {
      for (const name of SCHEMA13_TABLES) {
        const ta = a.schema13Tables?.[name], tb = b.schema13Tables?.[name];
        if (ta && tb && !ta.absent && !tb.absent) {
          if (ta.rowCount !== tb.rowCount || ta.sha256 !== tb.sha256) {
            schema13Diffs.push(`${name}: before ${ta.rowCount}/${ta.sha256 ?? 'absent'} after ${tb.rowCount}/${tb.sha256 ?? 'absent'}`);
          }
          if ((ta.columns ?? []).join() !== (tb.columns ?? []).join()) {
            schema13Diffs.push(`${name}: column identity/order changed`);
          }
          if ((ta.primaryKey ?? []).join() !== (tb.primaryKey ?? []).join()) {
            schema13Diffs.push(`${name}: primary key identity changed`);
          }
        }
      }
    }
  } else {
    if (purpose === 'upgrade') {
      if (absentBefore.length !== SCHEMA13_TABLES.length) schema13Diffs.push('upgrade baseline is not a pre-0013 library (schema-13 tables already present)');
      if (absentAfter.length > 0) schema13Diffs.push(`schema-13 table(s) still absent after: ${absentAfter.join(',')}`);
      for (const name of SCHEMA13_TABLES) {
        const tb = b.schema13Tables?.[name];
        if (tb && !tb.absent && tb.rowCount !== 0) {
          schema13Diffs.push(`new schema-13 table ${name} has ${tb.rowCount} rows, expected 0 for upgrade baseline`);
        }
      }
    } else if (purpose === 'restore') {
      if (absentAfter.length > 0) schema13Diffs.push(`schema-13 table(s) still absent after restore: ${absentAfter.join(',')}`);
      for (const name of SCHEMA13_TABLES) {
        const tb = b.schema13Tables?.[name];
        if (tb && !tb.absent && tb.rowCount !== 0) {
          schema13Diffs.push(`restored library has residual ${name} rows (${tb.rowCount}), expected 0`);
        }
      }
    }
  }
  sections.schema13 = { absentBefore, absentAfter, diffs: schema13Diffs };
  diffs.push(...schema13Diffs);

  // Baseline population: an empty fixture library cannot certify populated-data retention.
  const populationDiffs = [];
  if (purpose === 'upgrade' || purpose === 'restore') {
    const missing = missingPopulation(a);
    if (missing.length) populationDiffs.push(`baseline has no ${missing.join(', ')} rows — an empty library cannot prove populated-data retention`);
    if ((a.fileAnchors ?? []).length === 0) populationDiffs.push('baseline has no managed document files');
  }
  sections.population = { required: POPULATION_REQUIREMENT, diffs: populationDiffs };
  diffs.push(...populationDiffs);

  // Schema objects comparison.
  const objectDiffs = [];
  if (!subset && (purpose === 'unchanged' || purpose === 'upgrade' || purpose === 'restore')) {
    const beforeNames = new Set(a.schemaObjects?.names ?? []);
    const afterNames = new Set(b.schemaObjects?.names ?? []);
    const added = [...afterNames].filter(n => !beforeNames.has(n)).sort();
    const removed = [...beforeNames].filter(n => !afterNames.has(n)).sort();

    if (purpose === 'unchanged') {
      if (a.schemaObjects?.digest !== b.schemaObjects?.digest) {
        objectDiffs.push(`schema objects digest changed (before ${a.schemaObjects?.digest} after ${b.schemaObjects?.digest})`);
      }
      if (added.length) objectDiffs.push(`schema objects added: ${added.join(',')}`);
      if (removed.length) objectDiffs.push(`schema objects removed: ${removed.join(',')}`);
      if (a.schemaObjects?.definitions && b.schemaObjects?.definitions) {
        for (const name of beforeNames) {
          if (afterNames.has(name)) {
            const da = a.schemaObjects.definitions[name];
            const db = b.schemaObjects.definitions[name];
            if (da && db) {
              if (da.type !== db.type || da.sql !== db.sql) {
                objectDiffs.push(`schema object ${name} definition changed`);
              }
            }
          }
        }
      }
    } else if (purpose === 'upgrade') {
      if (removed.length) objectDiffs.push(`schema objects removed across upgrade: ${removed.join(',')}`);
      if (a.schemaObjects?.definitions && b.schemaObjects?.definitions) {
        for (const name of beforeNames) {
          if (afterNames.has(name)) {
            const da = a.schemaObjects.definitions[name];
            const db = b.schemaObjects.definitions[name];
            if (da && db) {
              if (da.type !== db.type || da.sql !== db.sql) {
                objectDiffs.push(`pre-existing schema object ${name} definition changed across upgrade`);
              }
            }
          }
        }
      }
      const missingRequired = SCHEMA13_OBJECTS.filter(n => !added.includes(n)).sort();
      if (missingRequired.length) {
        objectDiffs.push(`schema objects missing from migration 0013: ${missingRequired.join(',')}`);
      }
      const unexpected = added.filter(n => !SCHEMA13_OBJECTS.includes(n)).sort();
      if (unexpected.length) {
        objectDiffs.push(`schema objects added that migration 0013 does not create: ${unexpected.join(',')}`);
      }
      if (b.schemaObjects?.definitions) {
        for (const name of SCHEMA13_OBJECTS) {
          const def = b.schemaObjects.definitions[name];
          if (def && EXPECTED_SCHEMA13_DEFINITIONS[name]) {
            if (normalizeSql(def.sql) !== normalizeSql(EXPECTED_SCHEMA13_DEFINITIONS[name])) {
              objectDiffs.push(`schema object ${name} definition does not match shipped migration 0013`);
            }
          }
        }
      }
    } else if (purpose === 'restore') {
      if (removed.length) objectDiffs.push(`schema objects removed across restore: ${removed.join(',')}`);
      if (a.schemaObjects?.definitions && b.schemaObjects?.definitions) {
        for (const name of beforeNames) {
          if (afterNames.has(name)) {
            const da = a.schemaObjects.definitions[name];
            const db = b.schemaObjects.definitions[name];
            if (da && db) {
              if (da.type !== db.type || da.sql !== db.sql) {
                objectDiffs.push(`pre-existing schema object ${name} definition changed across restore`);
              }
            }
          }
        }
      }
      const missingRequired = SCHEMA13_OBJECTS.filter(n => !afterNames.has(n)).sort();
      if (missingRequired.length) {
        objectDiffs.push(`restored library is missing required schema-13 objects: ${missingRequired.join(',')}`);
      }
      const unexpected = [...afterNames].filter(n => !beforeNames.has(n) && !SCHEMA13_OBJECTS.includes(n)).sort();
      if (unexpected.length) {
        objectDiffs.push(`restored library has unexpected schema objects: ${unexpected.join(',')}`);
      }
      if (b.schemaObjects?.definitions) {
        for (const name of SCHEMA13_OBJECTS) {
          const def = b.schemaObjects.definitions[name];
          if (def && EXPECTED_SCHEMA13_DEFINITIONS[name]) {
            if (normalizeSql(def.sql) !== normalizeSql(EXPECTED_SCHEMA13_DEFINITIONS[name])) {
              objectDiffs.push(`restored schema object ${name} definition does not match shipped migration 0013`);
            }
          }
        }
      }
    }
    sections.schemaObjects = { added, removed, unexpected: added.filter(n => !SCHEMA13_OBJECTS.includes(n)), digestBefore: a.schemaObjects?.digest, digestAfter: b.schemaObjects?.digest, diffs: objectDiffs };
    diffs.push(...objectDiffs);
  }

  // Isolation facts must be consistent between the two captures.
  const isolationDiffs = [];
  if (!subset) {
    if (a.isolation.approvedRoot !== b.isolation.approvedRoot) isolationDiffs.push('approved root policy changed between snapshots');
    if (a.isolation.approvedUid !== b.isolation.approvedUid) isolationDiffs.push('approved uid policy changed between snapshots');
    if (a.isolation.operator !== b.isolation.operator) isolationDiffs.push('one snapshot came from the operator path and the other from an internal test path');
    isolationDiffs.push(...Object.entries({ ...a.isolation, ...b.isolation }).filter(() => false).map(() => 'unused'));
  }
  sections.isolation = { diffs: isolationDiffs };
  diffs.push(...isolationDiffs);

  // Database file bytes: recorded, never a gate fact — SQLite may legitimately rewrite the
  // header or checkpoint a WAL while an app is open, so only logical content is protected.
  const dbFileDiffs = [];
  compareAnchors(a.databaseFileAnchors ?? [], b.databaseFileAnchors ?? [], dbFileDiffs, 'database-file');
  sections.databaseFiles = { informational: true, changed: dbFileDiffs };
  if (dbFileDiffs.length) notes.push('database file bytes changed; the logical content digests are the authority');

  const protectedDataUnchanged = historyUnchanged && filesUnchanged && ledgerDiffs.length === 0
    && schema13Diffs.length === 0 && columnDrift.length === 0 && populationDiffs.length === 0 && objectDiffs.length === 0 && isolationDiffs.length === 0;
  const retainedDataUnchanged = historyUnchanged && filesUnchanged;
  const gateEligible = contract.gateEligible && !subset;
  const verdict = diffs.length > 0 ? 'FAIL' : (gateEligible ? 'PASS' : 'PARTIAL');
  // Per-purpose meaning of the compatibility field, stated in the receipt itself.
  const retainedMeaning = purpose === 'history'
    ? 'retained table digests only (partial contract)'
    : purpose === 'unchanged'
      ? 'every protected fact of the library: retained tables, schema-13 tables, managed file bytes, ledger, and schema objects'
      : 'retained history and managed file bytes across the migration/restore';
  const retainedHistoryUnchanged = purpose === 'unchanged' ? protectedDataUnchanged : retainedDataUnchanged;
  if (subset) notes.push(`one or both snapshots are prior or subset version (${a.schema !== SNAP_V3 ? a.schema : b.schema}): recapture with ${SNAP_V3} for complete gate PASS`);
  if (purpose === 'history') notes.push('purpose "history" compares retained table digests only: explicitly partial, never a gate verdict');

  const outcome = {
    schema: COMPARE_SCHEMA,
    purpose,
    contract: contract.label,
    gateEligible,
    complete: purpose !== 'history' && !subset,
    before: opts.before,
    after: opts.after,
    verdict,
    retainedHistoryUnchanged,
    retainedMeaning,
    historyUnchanged,
    filesUnchanged,
    protectedDataUnchanged,
    baselinePopulated: purpose === 'upgrade' || purpose === 'restore' ? populationDiffs.length === 0 : undefined,
    sections,
    notes,
    diffs,
  };
  const text = `${JSON.stringify(outcome, null, 2)}\n`;
  if (opts.jsonOut) writeReceipt(opts.jsonOut, protectedTargets(null, { receipts: [opts.before, opts.after] }), { label: 'compare', freshRequired: opts.requireFreshOutput === true, text });
  else console.log(text.trimEnd());
  if (diffs.length > 0) process.exitCode = 1;
  return outcome;
}

/** The CLI always demands fresh, non-aliased destinations; nothing on argv can turn that off. */
function compareOperatorEntry(opts) {
  return compare({ ...opts, requireFreshOutput: true });
}

/* ------------------------------------------------------------------ *
 * Internal scratch checks — permanent regressions for MACV-R4/R5
 * ------------------------------------------------------------------ */

function refusal(fn) {
  try { fn(); return { refused: false, message: '' }; }
  catch (e) { const message = String(e.message ?? e); return { refused: message.startsWith('REFUSED:'), message }; }
}

function scratchMigrationsDir() {
  const dir = path.join(process.cwd(), 'src-tauri', 'migrations');
  if (!fs.existsSync(dir)) fail('self-check must run from the repository root (it builds real schema from src-tauri/migrations)');
  return dir;
}

function migrationFiles(migDir, minVersion, maxVersion) {
  return fs.readdirSync(migDir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().filter(f => {
    const v = parseInt(f.slice(0, 4), 10);
    return v >= minVersion && v <= maxVersion;
  });
}

function applyMigrations(db, migDir, minVersion, maxVersion, recordLedger) {
  for (const f of migrationFiles(migDir, minVersion, maxVersion)) {
    db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
    if (recordLedger) {
      db.prepare('INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time, installed_on) VALUES (?, ?, ?, ?, ?, ?)')
        .run(parseInt(f.slice(0, 4), 10), f, 1, crypto.createHash('sha384').update(fs.readFileSync(path.join(migDir, f))).digest(), 0, '2026-10-08T12:00:00.000Z');
    }
  }
}

/** Synthetic but schema-faithful populated library, inserted in foreign-key dependency order. */
function seedLibrary(db) {
  const T0 = '2026-10-08T12:00:00.000Z';
  const Z = '0'.repeat(64);
  db.prepare(`INSERT INTO study_materials (id,title,material_type,topic,review_status,priority,file_path,original_file_name,file_size,created_at,updated_at)
              VALUES ('m1','Synthetic one','handbook','general','needs_review','next_up','documents/one.pdf','one.pdf',3,?,?)`).run(T0, T0);
  db.prepare(`INSERT INTO practice_test_versions (id,source_material_id,history_key,source_material_title,version_number,provider,model,title,content_hash,created_at,is_active)
              VALUES ('v1','m1','h-m1','Synthetic one',1,'import','','Synthetic test',?,?,1)`).run(Z, T0);
  db.prepare(`INSERT INTO practice_test_items (id,version_id,ordinal,question_text,options_json,correct_index,explanation,source_page)
              VALUES ('i1','v1',0,'Synthetic question','["a","b"]',0,'',NULL)`).run();
  db.prepare(`INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,completed_at,status,revision,total_questions,answered_count,correct_count,incorrect_count,dont_know_count,score_percent)
              VALUES ('a1','v1','m1','Synthetic one',?,?,'completed',1,1,1,1,0,0,50.5)`).run(T0, T0);
  db.prepare(`INSERT INTO practice_responses (id,attempt_id,item_id,selected_index,is_dont_know,is_correct,answered_at)
              VALUES ('r1','a1','i1',0,0,1,?)`).run(T0);
  db.prepare(`INSERT INTO card_versions (id,source_material_id,content_hash,card_count,provider,created_at,first_reviewed_at,is_active)
              VALUES ('cv1','m1',?,1,'import',?,NULL,1)`).run(Z, T0);
  db.prepare(`INSERT INTO card_items (id,version_id,ordinal,front,back,source_page) VALUES ('c1','cv1',0,'Q','A',NULL)`).run();
  db.prepare(`INSERT INTO card_review_events (id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json)
              VALUES ('e1','c1',0,'good',?,'v1','{}','{}')`).run(T0);
  db.prepare(`INSERT INTO card_review_state (item_id,source_material_id,scheduler_version,step,due_at,last_reviewed_at,reps,lapses,suspended,flag,revision)
              VALUES ('c1','m1','v1',0,?,?,1,0,0,NULL,1)`).run(T0, T0);
}

function newScratchRoot(parentDir) {
  const root = path.join(parentDir, APP_ID);
  fs.mkdirSync(path.join(root, DOCUMENTS_DIR), { recursive: true });
  return root;
}

function buildSchema12Profile(root, migDir, { seed = true } = {}) {
  const dbPath = path.join(root, DB_NAME);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);");
  applyMigrations(db, migDir, 0, RETAINED_SCHEMA_VERSION, true);
  if (seed) seedLibrary(db);
  db.close();
  fs.writeFileSync(path.join(root, DOCUMENTS_DIR, 'one.pdf'), 'SYNTH one');
  return dbPath;
}

function takeSnapshot(root, uid, outName, inspect) {
  return snapshot({
    mode: 'snapshot',
    expectProfile: root,
    jsonOut: outName,
    testContext: { internalTestFixture: true, root, uid, inspect: inspect ?? (() => controlledInspection('stopped')) },
  });
}

function scratchDirCount() {
  try { return fs.readdirSync(fs.realpathSync(os.tmpdir())).filter(n => n.startsWith(COPY_PREFIX)).length; } catch { return -1; }
}

function distinctDigests(values) {
  const set = new Set(values.map(v => v.sha256));
  return { count: values.length, unique: set.size };
}

/** Isolated checks on synthetic scratch data. Touches only temp directories it creates itself. */
function selfCheck() {
  const realTmp = fs.realpathSync(os.tmpdir());
  const migDir = scratchMigrationsDir();
  const dir = fs.mkdtempSync(path.join(realTmp, SCRATCH_PREFIX));
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const paths = {};

  try {
    /* ============================ capture + inventory ============================ */
    const root = newScratchRoot(dir);
    const dbPath = buildSchema12Profile(root, migDir);
    const uid = fs.statSync(dbPath).uid;
    paths.s12Initial = path.join(dir, 's12-initial.json');
    const s1 = takeSnapshot(root, uid, paths.s12Initial);
    add('ledger is the desktop _sqlx_migrations table at schema 12',
      s1.ledger.table === '_sqlx_migrations' && s1.ledger.maxVersion === 12 && s1.ledger.versions.join() === Array.from({ length: 12 }, (_, i) => i + 1).join(),
      { table: s1.ledger.table, maxVersion: s1.ledger.maxVersion, rows: s1.ledger.rowCount });
    add('inventory is the shipped schema: 33 retained tables, none missing, no unexpected objects',
      s1.inventory.complete === true && s1.inventory.retainedTables.length === 33 && s1.inventory.missingRetained.length === 0 && s1.inventory.unexpectedTables.length === 0,
      { retained: s1.inventory.retainedTables.length, unexpected: s1.inventory.unexpectedTables });
    add('operation-ledger tables are part of the retained inventory',
      ['practice_session_operations', 'card_review_operations', 'debrief_operations'].every(n => n in s1.history));
    add('schema-13 tables are reported absent at schema 12',
      s1.schema13Tables.material_split_lineage.absent === true && s1.schema13Tables.split_operation_log.absent === true);
    add('baseline is populated with the completed attempt, responses, card state and card event',
      POPULATION_REQUIREMENT.every(n => s1.history[n].rowCount >= 1) && s1.fileAnchors.length === 1,
      POPULATION_REQUIREMENT.map(n => `${n}=${s1.history[n].rowCount}`));
    add('snapshot records a confirmed stopped app', s1.isolation.processInspection.state === 'stopped' && s1.isolation.testFixture === true);

    const keyProbe = new DatabaseSync(dbPath, { readOnly: true });
    const drift = HISTORY_TABLES.filter(t => actualPrimaryKey(keyProbe, t.name).join() !== t.key.join()).map(t => t.name);
    add('every declared key equals the real primary key in the shipped schema', drift.length === 0, { drift });
    keyProbe.close();

    /* ============================ digest fidelity (R5) ============================ */
    const fidelity = (() => {
      const out = [];
      const mk = (ddl) => { const d = new DatabaseSync(':memory:'); d.exec(ddl); return d; };
      const one = (d, cols, key) => digestTable(d, 'probe', key);

      const d1 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
      d1.prepare('INSERT INTO probe VALUES(?,?)').run('x', 'before\u0000one');
      const nulBefore = one(d1);
      const storedBefore = d1.prepare('SELECT hex(value) AS h FROM probe').get().h;
      d1.prepare('UPDATE probe SET value=? WHERE id=?').run('before\u0000two', 'x');
      const nulAfter = one(d1);
      const storedAfter = d1.prepare('SELECT hex(value) AS h FROM probe').get().h;
      out.push({ name: 'TEXT differing only after an embedded NUL changes its digest', pass: nulBefore.sha256 !== nulAfter.sha256 && storedBefore !== storedAfter, detail: { storedBefore, storedAfter } });
      d1.close();

      const d2 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
      const ins = d2.prepare('INSERT INTO probe VALUES(?,?)');
      ins.run('a', 'same'); ins.run('b', 'same');
      const order1 = one(d2);
      const d3 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
      d3.prepare('INSERT INTO probe VALUES(?,?)').run('b', 'same');
      d3.prepare('INSERT INTO probe VALUES(?,?)').run('a', 'same');
      const order2 = one(d3);
      out.push({ name: 'control: identical content digests identically regardless of insert order', pass: order1.sha256 === order2.sha256 && order1.rowCount === 2 });
      d2.close(); d3.close();

      // One value each, stored with the type the literal says — bound JS numbers would collapse.
      const types = [
        ['null', 'NULL'], ['integer', '1'], ['real', '1.0'], ['text', "'1'"], ['blob', "X'31'"], ['emptytext', "''"],
      ];
      const digests = types.map(([label, literal]) => {
        const d = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value);');
        d.exec(`INSERT INTO probe VALUES('x', ${literal})`);
        const stored = d.prepare('SELECT typeof(value) AS t FROM probe').get().t;
        const r = { label, stored, ...digestTable(d, 'probe', ['id']) };
        d.close();
        return r;
      });
      const storedTypes = digests.map(x => x.stored);
      out.push({ name: 'each storage type hashes distinctly (NULL, INTEGER, REAL, TEXT, BLOB, empty TEXT)', pass: distinctDigests(digests).unique === digests.length && new Set(storedTypes).size === 5, detail: digests.map(x => `${x.label}/${x.stored}:${x.sha256.slice(0, 8)}`) });

      const d4 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value);');
      d4.prepare('INSERT INTO probe VALUES(?,?)').run('x', 9007199254740993n);
      const big1 = digestTable(d4, 'probe', ['id']);
      d4.prepare('UPDATE probe SET value=? WHERE id=?').run(9007199254740992n, 'x');
      const big2 = digestTable(d4, 'probe', ['id']);
      d4.prepare('UPDATE probe SET value=? WHERE id=?').run(-0.0, 'x');
      const negZero = digestTable(d4, 'probe', ['id']);
      d4.prepare('UPDATE probe SET value=? WHERE id=?').run(0, 'x');
      const posZero = digestTable(d4, 'probe', ['id']);
      out.push({ name: 'full 64-bit INTEGERs and -0.0 vs 0.0 are distinguished', pass: big1.sha256 !== big2.sha256 && negZero.sha256 !== posZero.sha256 });
      d4.close();

      const d5 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
      d5.prepare('INSERT INTO probe VALUES(?,?)').run('x', new Uint8Array([0, 1, 2, 0, 255]));
      const blob1 = digestTable(d5, 'probe', ['id']);
      d5.prepare('UPDATE probe SET value=? WHERE id=?').run(new Uint8Array([0, 1, 2, 1, 255]), 'x');
      const blob2 = digestTable(d5, 'probe', ['id']);
      out.push({ name: 'BLOB byte changes are detected', pass: blob1.sha256 !== blob2.sha256 });
      d5.close();

      // Framing: separators/control characters inside one value cannot imitate two rows/columns.
      const d6 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
      d6.prepare('INSERT INTO probe VALUES(?,?)').run('x', 'a\u0001b\u0002c');
      const glued = digestTable(d6, 'probe', ['id']);
      const d7 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, a TEXT, b TEXT);');
      d7.prepare('INSERT INTO probe(id,a,b) VALUES(?,?,?)').run('x', 'a\u0001b', 'c');
      const splitCols = digestTable(d7, 'probe');
      out.push({ name: 'control separators inside a value cannot imitate another row/column layout', pass: glued.sha256 !== splitCols.sha256 });
      d6.close(); d7.close();

      // Column identity is part of the frame: same bytes, renamed column -> different digest.
      const d8 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
      d8.prepare('INSERT INTO probe VALUES(?,?)').run('x', 'same-bytes');
      const colA = digestTable(d8, 'probe', ['id']);
      const d9 = mk('CREATE TABLE probe2(id TEXT PRIMARY KEY, value TEXT);');
      d9.prepare('INSERT INTO probe2 VALUES(?,?)').run('x', 'same-bytes');
      const otherTable = digestTable(d9, 'probe2', ['id']);
      out.push({ name: 'table identity is part of the frame (same rows in another table differ)', pass: colA.sha256 !== otherTable.sha256 });
      d8.close(); d9.close();

      const d10 = mk('CREATE TABLE probe(id TEXT, value TEXT);');
      const noPk = refusal(() => digestTable(d10, 'probe'));
      out.push({ name: 'a table without a primary key is refused instead of hashed in arbitrary order', pass: noPk.refused, detail: noPk.message });
      d10.close();

      const d11 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, other TEXT);');
      const wrongKey = refusal(() => digestTable(d11, 'probe', ['id', 'other']));
      out.push({ name: 'a declared key that is not the real primary key is refused', pass: wrongKey.refused && /primary key/.test(wrongKey.message), detail: wrongKey.message });
      d11.close();

      const d12 = mk('CREATE TABLE probe(id TEXT PRIMARY KEY);');
      const missingTable = refusal(() => digestTable(d12, 'nosuchtable'));
      out.push({ name: 'digesting a table that does not exist is refused', pass: missingTable.refused, detail: missingTable.message });
      d12.close();
      return out;
    })();
    fidelity.forEach(c => add(`digest: ${c.name}`, c.pass, c.detail));

    /* ============================ fail-closed guards (R4) ============================ */
    const classifications = [
      [{ ok: false, status: 1 }, 'stopped'],
      [{ ok: true, output: '4242\n' }, 'running'],
      [{ ok: true, output: '4242\n4343\n' }, 'running'],
      [{ ok: false, status: 2, message: 'Cannot get process list' }, 'error'],
      [{ ok: false, status: 3 }, 'error'],
      [{ ok: false, status: null, signal: 'SIGKILL' }, 'error'],
      [{ ok: false, code: 'ENOENT' }, 'unavailable'],
      [{ ok: false, code: 'EACCES' }, 'unavailable'],
      [{ ok: true, output: '' }, 'malformed'],
      [{ ok: true, output: 'not-a-pid\n' }, 'malformed'],
      [{ ok: true, output: 42 }, 'malformed'],
      [null, 'malformed'],
    ];
    const cls = classifications.map(([input, expected]) => ({ expected, got: classifyProcessProbe(input).state }));
    add('production classifier: only the documented no-match status is stopped', cls.every(x => x.expected === x.got), cls);

    // Composition: the *production* classifier feeding the *production* guard, on synthetic pgrep
    // results. The state-only cases below inject a finished verdict, so this is what proves a bad
    // pgrep answer actually reaches the refusal instead of being reinterpreted on the way.
    const composed = [
      [{ ok: true, output: '4242\n' }, 'running', /still running/],
      [{ ok: true, output: '4242\n4343\n' }, 'running', /still running/],
      [{ ok: false, status: 1 }, 'stopped', null],
      [{ ok: false, status: 2, message: 'Cannot get process list' }, 'error', /did not confirm a stopped app/],
      [{ ok: false, status: 3 }, 'error', /did not confirm a stopped app/],
      [{ ok: false, code: 'ENOENT' }, 'unavailable', /did not confirm a stopped app/],
      [{ ok: true, output: 'not-a-pid\n' }, 'malformed', /did not confirm a stopped app/],
      [{ ok: true, output: '' }, 'malformed', /did not confirm a stopped app/],
    ];
    const composedResults = composed.map(([probeResult, expectedState, pattern]) => {
      const verdict = classifyProcessProbe(probeResult);
      const inspection = { state: verdict.state, controlled: false, probes: [{ label: 'synthetic', ...verdict }], pids: verdict.pids ?? [] };
      const outcome = refusal(() => guardProfile(root, uid, inspection));
      const expectedRefusal = expectedState !== 'stopped';
      return { expectedState, gotState: verdict.state, refused: outcome.refused, message: outcome.message,
        pass: verdict.state === expectedState && (expectedRefusal ? (outcome.refused && pattern.test(outcome.message)) : !outcome.refused) };
    });
    add('production guard: a matched pid from real pgrep text refuses before any read',
      composedResults[0].pass && composedResults[1].pass, composedResults.slice(0, 2));
    add('production guard: an unusable or unparseable inspection answer refuses fail closed, and only exit 1 permits',
      composedResults.slice(2).every(x => x.pass), composedResults.slice(2));

    const baselineLeaks = scratchDirCount();
    const dbOriginal = fs.readFileSync(dbPath);
    for (const [state, pattern] of [['running', /still running/], ['error', /REFUSED.*stopped app/], ['unavailable', /REFUSED/], ['malformed', /REFUSED/]]) {
      const out = path.join(dir, `guard-${state}.json`);
      const r = refusal(() => takeSnapshot(root, uid, out, () => controlledInspection(state, state === 'error' ? 'bundle-path: inspection exited 2' : undefined)));
      add(`guard: inspection state "${state}" refuses the snapshot`, r.refused && pattern.test(r.message), r.message);
      add(`guard: "${state}" refusal leaves the database bytes untouched and writes no receipt`,
        Buffer.compare(dbOriginal, fs.readFileSync(dbPath)) === 0 && !fs.existsSync(out));
    }
    add('guard: a confirmed-stopped inspection permits the snapshot (control)', fs.existsSync(paths.s12Initial));

    // The refusal must precede any attempt to open or copy the database: make it unreadable.
    fs.chmodSync(dbPath, 0o000);
    const unreadable = refusal(() => takeSnapshot(root, uid, path.join(dir, 'unreadable.json'), () => controlledInspection('running')));
    const leakedWhileUnreadable = scratchDirCount();
    fs.chmodSync(dbPath, 0o644);
    add('guard: with the database unreadable a running-app refusal still comes from the guard (no open/copy attempted)',
      unreadable.refused && /still running/.test(unreadable.message) && !/EACCES/i.test(unreadable.message), unreadable.message);
    add('guard: refusal creates no WAL-copy scratch directory', leakedWhileUnreadable === baselineLeaks, { baselineLeaks, leakedWhileUnreadable });

    // A failed WAL copy must clean up after itself.
    const walProfile = newScratchRoot(path.join(dir, 'wal'));
    const walDb = buildSchema12Profile(walProfile, migDir);
    fs.writeFileSync(`${walDb}-wal`, Buffer.alloc(4104, 7));
    fs.chmodSync(`${walDb}-wal`, 0o000);
    const copyFailure = refusal(() => takeSnapshot(walProfile, uid, path.join(dir, 'wal-fail.json')));
    fs.chmodSync(`${walDb}-wal`, 0o644);
    add('copy: a failed WAL copy refuses and removes its scratch directory',
      copyFailure.refused && scratchDirCount() === baselineLeaks, { message: copyFailure.message, leaks: scratchDirCount() });

    // Real WAL copy path: committed frames honoured, originals untouched.
    const writer = new DatabaseSync(walDb);
    writer.exec('PRAGMA journal_mode = WAL;');
    writer.prepare(`INSERT INTO tags (id,name,created_at) VALUES ('walprobe','walprobe','2026-10-08T12:00:00.000Z')`).run();
    const mainBefore = fs.readFileSync(walDb);
    const walSnap = takeSnapshot(walProfile, uid, path.join(dir, 'wal-snap.json'));
    add('wal: committed frames are read from a copy while the original main database bytes stay unchanged',
      /wal-copy-snapshot/.test(walSnap.openMode) && Buffer.compare(mainBefore, fs.readFileSync(walDb)) === 0 && walSnap.history.tags.rowCount === 1,
      { mode: walSnap.openMode, tags: walSnap.history.tags.rowCount });
    writer.close();

    for (const [name, target] of [['a non-profile directory', path.join(dir, 'not-a-profile')], ['a missing root', path.join(dir, 'does-not-exist')]]) {
      fs.mkdirSync(target, { recursive: true });
      const r = refusal(() => takeSnapshot(target, uid, path.join(dir, `refuse-${name.replace(/\W+/g, '-')}.json`)));
      add(`guard: ${name} is refused`, r.refused, r.message);
    }
    const linkRoot = path.join(dir, 'symlink-root');
    fs.symlinkSync(root, linkRoot, 'dir');
    const symlinkRoot = refusal(() => guardProfile(linkRoot, uid, controlledInspection('stopped')));
    add('guard: a symlinked profile root is refused by the production guard', symlinkRoot.refused && /symlink/.test(symlinkRoot.message), symlinkRoot.message);

    const wrongUid = refusal(() => takeSnapshot(root, uid === 999 ? 1 : 999, path.join(dir, 'wrong-uid.json')));
    add('guard: a mismatched owner uid is refused', wrongUid.refused, wrongUid.message);

    const docProfile = newScratchRoot(path.join(dir, 'doclink'));
    buildSchema12Profile(docProfile, migDir);
    fs.symlinkSync('/etc/hosts', path.join(docProfile, DOCUMENTS_DIR, 'evil.pdf'));
    const docLink = refusal(() => takeSnapshot(docProfile, uid, path.join(dir, 'doclink.json')));
    add('guard: a symlinked managed document is refused', docLink.refused, docLink.message);

    /* ============================ output protection (R4) ============================ */
    const aliasRefusal = refusal(() => snapshot({ mode: 'snapshot', expectProfile: root, jsonOut: dbPath, testContext: { internalTestFixture: true, root, uid } }));
    add('output: --json cannot overwrite the input database (path/inode alias)',
      aliasRefusal.refused && /protected input/.test(aliasRefusal.message) && Buffer.compare(dbOriginal, fs.readFileSync(dbPath)) === 0, aliasRefusal.message);
    const dbAfterAlias = fs.readFileSync(dbPath);
    add('output: every input byte of the database is identical after the refusal', Buffer.compare(dbOriginal, dbAfterAlias) === 0);

    const insideProfile = refusal(() => snapshot({ mode: 'snapshot', expectProfile: root, jsonOut: path.join(root, DOCUMENTS_DIR, 'report.json'), testContext: { internalTestFixture: true, root, uid } }));
    add('output: --json inside the profile root is refused', insideProfile.refused, insideProfile.message);

    const relativeOut = refusal(() => snapshot({ mode: 'snapshot', expectProfile: root, jsonOut: 'report.json', testContext: { internalTestFixture: true, root, uid } }));
    add('output: a relative --json path is refused', relativeOut.refused, relativeOut.message);

    const hardLink = path.join(dir, 'db-hardlink');
    fs.linkSync(dbPath, hardLink);
    const protectDb = protectedTargets(root);
    const hardLinkOut = refusal(() => guardOutputPath(hardLink, protectDb, { label: 'snapshot', freshRequired: false }));
    add('output: a hard link to the database is detected as an alias', hardLinkOut.refused && /hard link/.test(hardLinkOut.message), hardLinkOut.message);
    fs.unlinkSync(hardLink);
    add('output: the alias test is self-cleaning, so the scratch database is single-linked again',
      fs.statSync(dbPath).nlink === 1, { nlink: fs.statSync(dbPath).nlink });

    const outSym = path.join(dir, 'out-link.json');
    fs.symlinkSync(path.join(dir, 'target.json'), outSym);
    const symOut = refusal(() => guardOutputPath(outSym, protectedTargets(root), { label: 'snapshot', freshRequired: false }));
    add('output: a symlinked destination is refused', symOut.refused, symOut.message);

    const existing = path.join(dir, 'existing.json');
    fs.writeFileSync(existing, 'PRIOR EVIDENCE\n');
    const notFresh = refusal(() => guardOutputPath(existing, protectedTargets(root), { label: 'snapshot', freshRequired: true }));
    add('output: an existing destination is refused when freshness is required (CLI mode)', notFresh.refused && /already exists/.test(notFresh.message), notFresh.message);
    add('output: the refused clobber attempt left the previous evidence intact', fs.readFileSync(existing, 'utf8') === 'PRIOR EVIDENCE\n');

    const operatorArbitrary = refusal(() => snapshot({ mode: 'snapshot', expectProfile: root, jsonOut: path.join(dir, 'operator.json') }));
    add('operator: the CLI path refuses any root that is not the approved lane', operatorArbitrary.refused && /REFUSED/.test(operatorArbitrary.message), operatorArbitrary.message);
    const retarget = refusal(() => snapshot({ mode: 'snapshot', expectProfile: root, expectUid: 0, jsonOut: path.join(dir, 'retarget.json') }));
    add('operator: nothing on argv can retarget the approved uid', retarget.refused && /cannot retarget/.test(retarget.message), retarget.message);
    const cliFlags = ['snapshot', '--profile', '/tmp', '--expect-uid', '0', '--json', '/tmp/x.json'].slice(1);
    const parsed = parseArgs(['snapshot', ...cliFlags]);
    add('operator: parseArgs never produces an internal test context', parsed.testContext === undefined && Object.keys(parsed).every(k => !['testContext'].includes(k)), Object.keys(parsed));

    /* ============================ contracts (R5) ============================ */
    // Every contract is exercised on one profile in place, exactly as the physical gate does:
    // the same active root is captured before and after, never two different directories.
    const s12AgainPath = path.join(dir, 's12-again.json');
    takeSnapshot(root, uid, s12AgainPath);
    const cmpUnchanged = compare({ before: paths.s12Initial, after: s12AgainPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-unchanged.json') });
    add('contract unchanged: two schema-12 captures pass without demanding schema-13 tables or version 13',
      cmpUnchanged.verdict === 'PASS' && cmpUnchanged.retainedHistoryUnchanged === true && cmpUnchanged.diffs.length === 0 && cmpUnchanged.sections.schema13.absentAfter.length === 2,
      { verdict: cmpUnchanged.verdict, ledger: cmpUnchanged.sections.ledger.after.maxVersion });

    const cmpHistory = compare({ before: paths.s12Initial, after: s12AgainPath, purpose: 'history', jsonOut: path.join(dir, 'cmp-history.json') });
    add('contract history: explicitly partial and never gate eligible, even when clean',
      cmpHistory.retainedHistoryUnchanged === true && cmpHistory.gateEligible === false && cmpHistory.verdict === 'PARTIAL' && cmpHistory.complete === false,
      { verdict: cmpHistory.verdict, gateEligible: cmpHistory.gateEligible });
    const cmpHistoryAlias = compare({ before: paths.s12Initial, after: s12AgainPath, historyOnly: true, jsonOut: path.join(dir, 'cmp-history-alias.json') });
    add('contract history: --history-only still resolves to the partial history contract',
      cmpHistoryAlias.purpose === 'history' && cmpHistoryAlias.gateEligible === false);

    // Upgrade the same root in place with the real shipped 0013.
    const up = new DatabaseSync(dbPath);
    applyMigrations(up, migDir, RETAINED_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION, true);
    up.close();
    const s13Path = path.join(dir, 's13-upgraded.json');
    const s13 = takeSnapshot(root, uid, s13Path);
    const cmpUpgrade = compare({ before: paths.s12Initial, after: s13Path, purpose: 'upgrade', jsonOut: path.join(dir, 'cmp-upgrade.json') });
    add('contract upgrade: real 0013 keeps every retained table and document identical and shows both new tables + ledger 13',
      cmpUpgrade.verdict === 'PASS' && cmpUpgrade.retainedHistoryUnchanged === true && s13.ledger.maxVersion === 13 && s13.schema13Tables.material_split_lineage.absent === false && s13.schema13Tables.split_operation_log.absent === false,
      { verdict: cmpUpgrade.verdict, diffs: cmpUpgrade.diffs });
    const cmpRestore = compare({ before: paths.s12Initial, after: s13Path, purpose: 'restore', jsonOut: path.join(dir, 'cmp-restore-pass.json') });
    add('contract restore: a restored schema-12 library migrated to 13 passes with identical history and documents',
      cmpRestore.verdict === 'PASS' && cmpRestore.retainedHistoryUnchanged === true, { diffs: cmpRestore.diffs });
    const cmpAsUnchanged = compare({ before: paths.s12Initial, after: s13Path, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-upgrade-as-unchanged.json') });
    add('contract unchanged: a real migration is not "nothing changed" — it fails on the ledger and presence facts',
      cmpAsUnchanged.verdict === 'FAIL' && cmpAsUnchanged.diffs.some(d => /ledger/.test(d)) && cmpAsUnchanged.diffs.some(d => /presence/.test(d)),
      { diffs: cmpAsUnchanged.diffs });

    // One changed document, nothing else: must fail on its own under both migration contracts.
    fs.writeFileSync(path.join(root, DOCUMENTS_DIR, 'one.pdf'), 'SYNTH ONE-TAMPERED');
    const s13DocPath = path.join(dir, 's13-tampered-doc.json');
    takeSnapshot(root, uid, s13DocPath);
    for (const purpose of ['upgrade', 'restore']) {
      const cmp = compare({ before: paths.s12Initial, after: s13DocPath, purpose, jsonOut: path.join(dir, `cmp-${purpose}-doc.json`) });
      add(`contract ${purpose}: a changed document fails even when every retained digest is identical`,
        cmp.verdict === 'FAIL' && cmp.historyUnchanged === true && cmp.filesUnchanged === false && cmp.retainedHistoryUnchanged === false,
        { diffs: cmp.diffs });
    }
    fs.writeFileSync(path.join(root, DOCUMENTS_DIR, 'one.pdf'), 'SYNTH one');

    // One modified retained row on the upgraded root: reported by name.
    const mut = new DatabaseSync(dbPath);
    mut.prepare(`UPDATE practice_responses SET selected_index = 1, is_correct = 0 WHERE id = 'r1'`).run();
    mut.close();
    const s13MutPath = path.join(dir, 's13-mutated-row.json');
    takeSnapshot(root, uid, s13MutPath);
    const cmpMutated = compare({ before: s13Path, after: s13MutPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-mutated.json') });
    add('contract unchanged: a modified retained row is reported by name',
      cmpMutated.verdict === 'FAIL' && cmpMutated.diffs.some(d => d.startsWith('practice_responses')), { diffs: cmpMutated.diffs });
    // Restore the row so db is back to pristine s13
    const mutFix = new DatabaseSync(dbPath);
    mutFix.prepare(`UPDATE practice_responses SET selected_index = 0, is_correct = 1 WHERE id = 'r1'`).run();
    mutFix.close();

    /* ============================ MACV-R8 schema-13 & object comparisons ============================ */
    // Control: unchanged real schema13 profile passes
    const cmpS13Unchanged = compare({ before: s13Path, after: s13Path, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-s13-unchanged.json') });
    add('MACV-R8 control: unchanged real schema13 profile passes',
      cmpS13Unchanged.verdict === 'PASS' && cmpS13Unchanged.diffs.length === 0);

    // Added pending operation in split_operation_log fails unchanged
    const opDb = new DatabaseSync(dbPath);
    opDb.prepare('INSERT INTO split_operation_log (operation_id, source_material_id, receipt_canonical_json, receipt_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('op-test', 'm1', '{}', '0'.repeat(64), 'pending', '2026-10-08T12:00:00.000Z', '2026-10-08T12:00:00.000Z');
    opDb.close();
    const s13OpPath = path.join(dir, 's13-with-op.json');
    takeSnapshot(root, uid, s13OpPath);
    const cmpOpUnchanged = compare({ before: s13Path, after: s13OpPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-op-unchanged.json') });
    add('MACV-R8: an added pending operation cannot pass unchanged',
      cmpOpUnchanged.verdict === 'FAIL' && cmpOpUnchanged.diffs.some(d => /split_operation_log/.test(d)), { diffs: cmpOpUnchanged.diffs });

    // Operation status change (update) fails unchanged
    const opUpdateDb = new DatabaseSync(dbPath);
    opUpdateDb.prepare("UPDATE split_operation_log SET status = 'committed', updated_at = '2026-10-08T12:05:00.000Z' WHERE operation_id = 'op-test'").run();
    opUpdateDb.close();
    const s13OpUpdatedPath = path.join(dir, 's13-with-op-completed.json');
    takeSnapshot(root, uid, s13OpUpdatedPath);
    const cmpOpUpdate = compare({ before: s13OpPath, after: s13OpUpdatedPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-op-update.json') });
    add('MACV-R8: updated operation status (pending -> completed) cannot pass unchanged',
      cmpOpUpdate.verdict === 'FAIL' && cmpOpUpdate.diffs.some(d => /split_operation_log/.test(d)), { diffs: cmpOpUpdate.diffs });

    // Operation row deleted fails unchanged
    const opDelDb = new DatabaseSync(dbPath);
    opDelDb.prepare("DELETE FROM split_operation_log WHERE operation_id = 'op-test'").run();
    opDelDb.close();
    const s13OpDelPath = path.join(dir, 's13-with-op-deleted.json');
    takeSnapshot(root, uid, s13OpDelPath);
    const cmpOpDelete = compare({ before: s13OpPath, after: s13OpDelPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-op-del.json') });
    add('MACV-R8: deleted operation row cannot pass unchanged',
      cmpOpDelete.verdict === 'FAIL' && cmpOpDelete.diffs.some(d => /split_operation_log/.test(d)), { diffs: cmpOpDelete.diffs });

    // Prepopulated schema-13 rows fail upgrade and restore
    const cmpOpUpgrade = compare({ before: paths.s12Initial, after: s13OpPath, purpose: 'upgrade', jsonOut: path.join(dir, 'cmp-op-upgrade.json') });
    add('MACV-R8: prepopulated split_operation_log row fails upgrade (expected empty)',
      cmpOpUpgrade.verdict === 'FAIL' && cmpOpUpgrade.diffs.some(d => /split_operation_log/.test(d)), { diffs: cmpOpUpgrade.diffs });
    const cmpOpRestore = compare({ before: paths.s12Initial, after: s13OpPath, purpose: 'restore', jsonOut: path.join(dir, 'cmp-op-restore.json') });
    add('MACV-R8: residual split_operation_log row fails restore (expected empty)',
      cmpOpRestore.verdict === 'FAIL' && cmpOpRestore.diffs.some(d => /split_operation_log/.test(d)), { diffs: cmpOpRestore.diffs });

    // Added lineage row fails unchanged, upgrade, and restore
    const linDb = new DatabaseSync(dbPath);
    linDb.prepare("INSERT INTO material_split_lineage (material_id, source_page_start, source_page_end, child_page_count, source_file_name, source_title, source_total_pages, nested_level, created_at) VALUES ('m1', 1, 1, 1, 'one.pdf', 'Synthetic one', 10, 1, '2026-10-08T12:00:00.000Z')").run();
    linDb.close();
    const s13LinPath = path.join(dir, 's13-with-lineage.json');
    takeSnapshot(root, uid, s13LinPath);
    const cmpLinUnchanged = compare({ before: s13Path, after: s13LinPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-lin-unchanged.json') });
    add('MACV-R8: an added lineage row cannot pass unchanged',
      cmpLinUnchanged.verdict === 'FAIL' && cmpLinUnchanged.diffs.some(d => /material_split_lineage/.test(d)), { diffs: cmpLinUnchanged.diffs });
    const cmpLinRestore = compare({ before: paths.s12Initial, after: s13LinPath, purpose: 'restore', jsonOut: path.join(dir, 'cmp-lin-restore.json') });
    add('MACV-R8: residual material_split_lineage row fails restore (expected empty)',
      cmpLinRestore.verdict === 'FAIL' && cmpLinRestore.diffs.some(d => /material_split_lineage/.test(d)), { diffs: cmpLinRestore.diffs });
    // Clean up lineage row
    const linDelDb = new DatabaseSync(dbPath);
    linDelDb.exec('DELETE FROM material_split_lineage;');
    linDelDb.close();

    // Changed schema objects (added index) fails unchanged
    const idxDb = new DatabaseSync(dbPath);
    idxDb.exec('CREATE INDEX idx_review_schema_change ON study_materials(title);');
    idxDb.close();
    const s13IdxPath = path.join(dir, 's13-extra-idx.json');
    takeSnapshot(root, uid, s13IdxPath);
    const cmpIdxUnchanged = compare({ before: s13Path, after: s13IdxPath, purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-idx-unchanged.json') });
    add('MACV-R8: changed schema objects (added index) cannot pass unchanged',
      cmpIdxUnchanged.verdict === 'FAIL' && cmpIdxUnchanged.diffs.some(d => /schema objects/.test(d)), { diffs: cmpIdxUnchanged.diffs });

    // Missing migration 0013 index fails upgrade and restore
    const dropIdxDb = new DatabaseSync(dbPath);
    dropIdxDb.exec('DROP INDEX idx_review_schema_change; DROP INDEX idx_split_operation_status;');
    dropIdxDb.close();
    const s13MissingIdxPath = path.join(dir, 's13-missing-idx.json');
    takeSnapshot(root, uid, s13MissingIdxPath);
    const cmpMissingIdxUp = compare({ before: paths.s12Initial, after: s13MissingIdxPath, purpose: 'upgrade', jsonOut: path.join(dir, 'cmp-missing-idx-up.json') });
    add('MACV-R8: upgrade requires all indexes actually created by 0013',
      cmpMissingIdxUp.verdict === 'FAIL' && cmpMissingIdxUp.diffs.some(d => /idx_split_operation_status/.test(d)), { diffs: cmpMissingIdxUp.diffs });
    const cmpMissingIdxRest = compare({ before: paths.s12Initial, after: s13MissingIdxPath, purpose: 'restore', jsonOut: path.join(dir, 'cmp-missing-idx-rest.json') });
    add('MACV-R8: restore requires all indexes actually created by 0013',
      cmpMissingIdxRest.verdict === 'FAIL' && cmpMissingIdxRest.diffs.some(d => /idx_split_operation_status/.test(d)), { diffs: cmpMissingIdxRest.diffs });

    // Altered index definition fails upgrade
    const altIdxDb = new DatabaseSync(dbPath);
    altIdxDb.exec('CREATE INDEX idx_split_operation_status ON split_operation_log(status, source_material_id);');
    altIdxDb.close();
    const s13AltIdxPath = path.join(dir, 's13-alt-idx.json');
    takeSnapshot(root, uid, s13AltIdxPath);
    const cmpAltIdxUp = compare({ before: paths.s12Initial, after: s13AltIdxPath, purpose: 'upgrade', jsonOut: path.join(dir, 'cmp-alt-idx-up.json') });
    add('MACV-R8: altered index definition fails upgrade',
      cmpAltIdxUp.verdict === 'FAIL' && cmpAltIdxUp.diffs.some(d => /idx_split_operation_status/.test(d)), { diffs: cmpAltIdxUp.diffs });

    // Restore index back to pristine 0013 definition
    const fixIdxDb = new DatabaseSync(dbPath);
    fixIdxDb.exec('DROP INDEX idx_split_operation_status; CREATE INDEX idx_split_operation_status ON split_operation_log(status);');
    fixIdxDb.close();


    // An empty library, upgraded in place inside its own root, cannot certify populated data.
    const emptyRoot = newScratchRoot(path.join(dir, 'empty'));
    const emptyDb = buildSchema12Profile(emptyRoot, migDir, { seed: false });
    fs.rmSync(path.join(emptyRoot, DOCUMENTS_DIR, 'one.pdf'));
    const empty12 = path.join(dir, 's12-empty.json');
    takeSnapshot(emptyRoot, uid, empty12);
    const emptyUp = new DatabaseSync(emptyDb);
    applyMigrations(emptyUp, migDir, RETAINED_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION, true);
    emptyUp.close();
    const empty13 = path.join(dir, 's13-empty.json');
    takeSnapshot(emptyRoot, uid, empty13);
    const cmpEmpty = compare({ before: empty12, after: empty13, purpose: 'upgrade', jsonOut: path.join(dir, 'cmp-empty.json') });
    add('contract upgrade: an empty library cannot certify populated-data retention',
      cmpEmpty.verdict === 'FAIL' && cmpEmpty.baselinePopulated === false && cmpEmpty.diffs.some(d => /populated-data retention/.test(d)), { diffs: cmpEmpty.diffs });

    // Structure validation must refuse before any verdict, never quietly pass.
    const v1Fixture = (dirName, mutator) => {
      const base = {
        schema: SNAP_V1,
        profile: root,
        database: DB_NAME,
        ownerUid: uid,
        ledger: { table: '_sqlx_migrations', maxVersion: 12, versions: Array.from({ length: 12 }, (_, i) => i + 1) },
        history: Object.fromEntries(HISTORY_TABLES.map(t => [t.name, { rowCount: 1, sha256: 'a'.repeat(64) }])),
        schema13Tables: { material_split_lineage: { absent: true, rowCount: 0 }, split_operation_log: { absent: true, rowCount: 0 } },
        fileAnchors: [{ relativePath: 'documents/probe.pdf', bytes: 4, sha256: 'b'.repeat(64) }],
      };
      if (mutator) mutator(base);
      const p = path.join(dir, `${dirName}.json`);
      fs.writeFileSync(p, JSON.stringify(base));
      return p;
    };
    const cmpV1Unchanged = compare({ before: v1Fixture('v1-a'), after: v1Fixture('v1-b'), purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-v1.json') });
    add('frozen compatibility: a schema-12 pair in the declared-subset form still reports the unchanged result the review asserts',
      cmpV1Unchanged.retainedHistoryUnchanged === true && cmpV1Unchanged.gateEligible === false && cmpV1Unchanged.verdict === 'PARTIAL');
    const cmpV1Doc = compare({ before: v1Fixture('v1-c'), after: v1Fixture('v1-d', s => { s.fileAnchors[0].sha256 = 'c'.repeat(64); s.ledger.maxVersion = 13; }), historyOnly: true, purpose: 'restore', jsonOut: path.join(dir, 'cmp-v1-doc.json') });
    add('frozen compatibility: the restore purpose still detects the changed document in the subset form',
      cmpV1Doc.retainedHistoryUnchanged === false && cmpV1Doc.historyUnchanged === true);
    const noHistory = refusal(() => compare({ before: v1Fixture('v1-e', s => { s.history = {}; }), after: v1Fixture('v1-f', s => { s.history = {}; }), purpose: 'history', jsonOut: path.join(dir, 'cmp-v1-nohistory.json') }));
    add('validation: a snapshot missing every retained table entry is refused, not passed',
      noHistory.refused && /required table/.test(noHistory.message), noHistory.message);
    const oneAbsent = refusal(() => compare({ before: v1Fixture('v1-g', s => { s.history.settings = { rowCount: 0, sha256: null, absent: true }; }), after: v1Fixture('v1-h'), purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-v1-absent.json') }));
    add('validation: a missing required table in one snapshot is refused', oneAbsent.refused && /absent/.test(oneAbsent.message), oneAbsent.message);
    const badHash = refusal(() => compare({ before: v1Fixture('v1-i', s => { s.history.tags.sha256 = 'zz'; }), after: v1Fixture('v1-j'), purpose: 'history', jsonOut: path.join(dir, 'cmp-v1-badhash.json') }));
    add('validation: a malformed digest is refused', badHash.refused && /hex/.test(badHash.message), badHash.message);
    const emptyLedger = refusal(() => compare({ before: v1Fixture('v1-k', s => { s.ledger.versions = []; }), after: v1Fixture('v1-l'), purpose: 'unchanged', jsonOut: path.join(dir, 'cmp-v1-ledger.json') }));
    add('validation: a snapshot with no recorded migration versions is refused', emptyLedger.refused && /versions/.test(emptyLedger.message), emptyLedger.message);
    const incompletePath = path.join(dir, 'v2-incomplete.json');
    fs.writeFileSync(incompletePath, JSON.stringify({ ...JSON.parse(fs.readFileSync(s13Path, 'utf8')), inventory: { ...s13.inventory, complete: false, missingRetained: ['notes'] } }));
    const incompleteInventory = refusal(() => compare({ before: s13Path, after: incompletePath, purpose: 'upgrade', jsonOut: path.join(dir, 'cmp-v2-incomplete.json') }));
    add('validation: an incomplete v2 inventory is refused', incompleteInventory.refused && /incomplete/.test(incompleteInventory.message), incompleteInventory.message);
    const badPurpose = refusal(() => compare({ before: paths.s12Initial, after: path.join(dir, 's12-again.json'), purpose: 'whatever', jsonOut: path.join(dir, 'cmp-badpurpose.json') }));
    add('validation: an unknown purpose is refused', badPurpose.refused && /purpose/.test(badPurpose.message), badPurpose.message);

    const receiptAlias = refusal(() => compare({ before: paths.s12Initial, after: path.join(dir, 's12-again.json'), purpose: 'history', jsonOut: paths.s12Initial }));
    add('output: compare --json cannot overwrite an input receipt', receiptAlias.refused && /protected input/.test(receiptAlias.message), receiptAlias.message);

    /* ============================ restore baseline vs. backup receipt ============================ */
    // Installed verification (2026-10-11) compared a restored library with a baseline captured
    // after the export, which had written last_complete_backup_* once the archive existed.
    {
      const rDir = path.join(dir, 'receipt');
      fs.mkdirSync(rDir);
      const rRoot = newScratchRoot(rDir);
      const rDb = buildSchema12Profile(rRoot, migDir);
      const rUid = fs.statSync(rDb).uid;
      const setMeta = (rows, del = []) => {
        const d = new DatabaseSync(rDb);
        for (const [k, v] of rows) d.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
        for (const k of del) d.prepare('DELETE FROM app_metadata WHERE key = ?').run(k);
        d.close();
      };
      const snap = (name) => { const p = path.join(rDir, `${name}.json`); return { p, s: takeSnapshot(rRoot, rUid, p) }; };
      const cmp = (before, after, purpose, name) => compare({ before, after, purpose, jsonOut: path.join(rDir, `cmp-${name}.json`) });
      const receiptRows = [['last_complete_backup_at', '2026-10-11T12:00:00.000Z'], ['last_complete_backup_version', '0.9.0'], ['last_complete_backup_path', '/synthetic/backups/hfd.zip']];

      // Archive state: one ordinary metadata row. The export then writes the receipt.
      setMeta([['daily_plan_session', '{"synthetic":true}']]);
      const archiveState = snap('archive-state');
      setMeta(receiptRows);
      const postExport = snap('post-export');
      add('receipt: snapshots record one digest per app_metadata key, digests only',
        Object.keys(postExport.s.history.app_metadata.keyDigests).length === postExport.s.history.app_metadata.rowCount
          && BACKUP_RECEIPT_KEYS.every(k => isHex64(postExport.s.history.app_metadata.keyDigests[k]))
          && !fs.readFileSync(postExport.p, 'utf8').includes('/synthetic/backups/hfd.zip'),
        { keys: Object.keys(postExport.s.history.app_metadata.keyDigests) });

      // Restore = the archive's bytes back in place, then the real 0013.
      setMeta([], BACKUP_RECEIPT_KEYS);
      const r = new DatabaseSync(rDb);
      applyMigrations(r, migDir, RETAINED_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION, true);
      r.close();
      const restored = snap('restored');
      const pass = cmp(postExport.p, restored.p, 'restore', 'receipt-pass');
      add('receipt: restore passes against a post-export baseline when only the backup receipt differs, and says so',
        pass.verdict === 'PASS' && pass.sections.backupReceipt.applied === true && pass.sections.backupReceipt.receiptOnlyDifference === true
          && pass.sections.retainedTables.receiptOnlyDifference.join() === 'app_metadata' && pass.sections.backupReceipt.receiptKeysBefore.length === 3
          && pass.sections.backupReceipt.receiptKeysAfter.length === 0 && pass.notes.some(n => /backup receipt/.test(n)),
        { verdict: pass.verdict, diffs: pass.diffs, backupReceipt: pass.sections.backupReceipt });
      const archivePass = cmp(archiveState.p, restored.p, 'restore', 'receipt-archive');
      add('receipt: restore against the archive-state baseline passes with nothing set aside',
        archivePass.verdict === 'PASS' && archivePass.sections.backupReceipt.receiptOnlyDifference === false, { diffs: archivePass.diffs });

      for (const purpose of ['unchanged', 'history']) {
        const strict = cmp(postExport.p, archiveState.p, purpose, `receipt-${purpose}`);
        add(`receipt: the ${purpose} contract still protects the backup receipt (exclusion is restore-only)`,
          strict.verdict === 'FAIL' && strict.sections.retainedTables.changed.includes('app_metadata') && strict.sections.backupReceipt === undefined,
          { verdict: strict.verdict, diffs: strict.diffs });
      }

      // Every other app_metadata key stays strict under restore: changed, added and removed.
      const restoredMeta = (name, rows, del) => { setMeta(rows, del); const out = snap(name); setMeta([], rows.map(([k]) => k)); return out; };
      const changed = restoredMeta('restored-meta-changed', [['daily_plan_session', '{"synthetic":false}']], []);
      setMeta([['daily_plan_session', '{"synthetic":true}']]);
      const cmpChanged = cmp(postExport.p, changed.p, 'restore', 'receipt-other-changed');
      add('receipt: a changed non-receipt app_metadata value still fails restore, naming the key',
        cmpChanged.verdict === 'FAIL' && cmpChanged.diffs.some(d => /keys other than the backup receipt differ \(daily_plan_session\)/.test(d))
          && cmpChanged.sections.retainedTables.changed.includes('app_metadata'),
        { diffs: cmpChanged.diffs });
      const added = restoredMeta('restored-meta-added', [['synthetic_extra', 'x']], []);
      const cmpAdded = cmp(postExport.p, added.p, 'restore', 'receipt-other-added');
      add('receipt: an extra non-receipt app_metadata key still fails restore',
        cmpAdded.verdict === 'FAIL' && cmpAdded.diffs.some(d => /synthetic_extra/.test(d)), { diffs: cmpAdded.diffs });
      setMeta([], ['daily_plan_session']);
      const removed = snap('restored-meta-removed');
      setMeta([['daily_plan_session', '{"synthetic":true}']]);
      const cmpRemoved = cmp(postExport.p, removed.p, 'restore', 'receipt-other-removed');
      add('receipt: a missing non-receipt app_metadata key still fails restore',
        cmpRemoved.verdict === 'FAIL' && cmpRemoved.diffs.some(d => /daily_plan_session/.test(d)), { diffs: cmpRemoved.diffs });

      // Records and PDFs stay strict alongside a receipt-only metadata difference.
      const attempt = new DatabaseSync(rDb);
      attempt.prepare("UPDATE practice_attempts SET score_percent = 49.5 WHERE id = 'a1'").run();
      attempt.close();
      const recordChanged = snap('restored-record-changed');
      const cmpRecord = cmp(postExport.p, recordChanged.p, 'restore', 'receipt-record');
      add('receipt: a changed restored record still fails restore beside a receipt-only metadata difference',
        cmpRecord.verdict === 'FAIL' && cmpRecord.sections.retainedTables.changed.join() === 'practice_attempts', { diffs: cmpRecord.diffs });
      const fix = new DatabaseSync(rDb);
      fix.prepare("UPDATE practice_attempts SET score_percent = 50.5 WHERE id = 'a1'").run();
      fix.close();
      fs.writeFileSync(path.join(rRoot, DOCUMENTS_DIR, 'one.pdf'), 'SYNTH one, altered');
      const pdfChanged = snap('restored-pdf-changed');
      const cmpPdf = cmp(postExport.p, pdfChanged.p, 'restore', 'receipt-pdf');
      add('receipt: changed PDF bytes still fail restore beside a receipt-only metadata difference',
        cmpPdf.verdict === 'FAIL' && cmpPdf.filesUnchanged === false && cmpPdf.sections.retainedTables.changed.length === 0, { diffs: cmpPdf.diffs });

      // Older snapshots (no per-key digests) keep the strict result, so earlier evidence reads the same.
      const strip = (p, name) => { const s = JSON.parse(fs.readFileSync(p, 'utf8')); delete s.history.app_metadata.keyDigests; const out = path.join(rDir, `${name}.json`); fs.writeFileSync(out, JSON.stringify(s)); return out; };
      const cmpLegacy = cmp(strip(postExport.p, 'post-export-legacy'), restored.p, 'restore', 'receipt-legacy');
      add('receipt: a baseline without per-key digests is compared strictly and fails, with the reason recorded',
        cmpLegacy.verdict === 'FAIL' && cmpLegacy.sections.backupReceipt.applied === false && /predate/.test(cmpLegacy.sections.backupReceipt.reason)
          && cmpLegacy.sections.retainedTables.changed.includes('app_metadata'),
        { verdict: cmpLegacy.verdict, backupReceipt: cmpLegacy.sections.backupReceipt });

      // Per-key digests must agree with the table they describe.
      const forged = JSON.parse(fs.readFileSync(restored.p, 'utf8'));
      forged.history.app_metadata.keyDigests.synthetic_ghost = 'a'.repeat(64);
      const forgedPath = path.join(rDir, 'restored-forged.json');
      fs.writeFileSync(forgedPath, JSON.stringify(forged));
      const forgedRefusal = refusal(() => cmp(postExport.p, forgedPath, 'restore', 'receipt-forged'));
      add('receipt: per-key digests that disagree with the table row count are refused',
        forgedRefusal.refused && /keyDigests lists/.test(forgedRefusal.message), forgedRefusal.message);
      const repoSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'repositories', 'appRepository.ts'), 'utf8');
      add('anchor: the excluded receipt keys are exactly the backup keys appRepository.ts writes',
        BACKUP_RECEIPT_KEYS.every(k => repoSrc.includes(`"${k}"`)) && [...repoSrc.matchAll(/"(last_complete_backup_[a-z_]+)"/g)].map(m => m[1]).sort().join() === BACKUP_RECEIPT_KEYS.join(),
        { found: [...repoSrc.matchAll(/"(last_complete_backup_[a-z_]+)"/g)].map(m => m[1]) });
    }

    /* ============================ environment + drift anchors ============================ */
    const realInspection = inspectAppProcesses();
    add('environment: real process inspection result is recorded (never assumed stopped)',
      typeof realInspection.state === 'string' && realInspection.probes.length === PROCESS_PROBES.length, realInspection);
    const libSrc = fs.readFileSync(path.join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8');
    const declared = libSrc.match(/CURRENT_SCHEMA_VERSION[^=]*=\s*(\d+)/);
    add('anchor: CURRENT_SCHEMA_VERSION in the shipped source still equals this helper\'s constant', !!declared && Number(declared[1]) === CURRENT_SCHEMA_VERSION, { found: declared?.[1] });
    const sql13 = fs.readFileSync(path.join(migDir, '0013_split_source_lineage.sql'), 'utf8');
    const createdTables = [...sql13.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map(m => m[1]);
    const createdIndexes = [...sql13.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map(m => m[1]);
    const created = [...createdTables, ...createdIndexes];
    add('anchor: the recorded schema-13 object list equals what migration 0013 actually creates',
      created.slice().sort().join() === SCHEMA13_OBJECTS.slice().sort().join(), { created: created.slice().sort(), expected: SCHEMA13_OBJECTS.slice().sort() });
    const ledger13 = JSON.parse(fs.readFileSync(s13Path, 'utf8'));
    add('upgrade added exactly one ledger row (12 -> 13) with the earlier rows untouched',
      ledger13.ledger.versions.length === 13 && ledger13.ledger.rows.length === 13 && ledger13.ledger.maxVersion === 13, { versions: ledger13.ledger.versions });
    add('scratch leak check: no WAL-copy scratch directory survived the run', scratchDirCount() === baselineLeaks, { before: baselineLeaks, after: scratchDirCount() });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const report = {
    schema: 'hfd-mac-profile-snapshot-selfcheck/3',
    node: process.version,
    counts: { checks: checks.length, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length },
    inventory: { retainedTables: RETAINED_NAMES.length, schema13Tables: SCHEMA13_TABLES.length },
    checks,
    allPassed: checks.every(c => c.pass),
  };
  // Refusals quote the scratch paths they protected, and those names are random per run. Redacting
  // the scratch root keeps the receipt byte-reproducible without hiding any verdict or value.
  const text = JSON.stringify(report, null, 2).split(dir).join('<scratch>');
  console.log(`${text}\n`);
  process.exitCode = report.allPassed ? 0 : 1;
  return report;
}

const opts = parseArgs(process.argv.slice(2));
try {
  if (opts.mode === 'snapshot') snapshot(opts);
  else if (opts.mode === 'compare') compareOperatorEntry(opts);
  else if (opts.mode === 'self-check') selfCheck();
  else fail('usage: snapshot [--json <fresh absolute path>] | compare --before a.json --after b.json [--purpose unchanged|upgrade|restore|history] [--json <fresh absolute path>] | self-check');
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}
