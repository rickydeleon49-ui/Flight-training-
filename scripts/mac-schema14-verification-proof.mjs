#!/usr/bin/env node
/**
 * Disposable proof package for the schema-14 verification helper (source-only).
 *
 * Run from the repository root with the locked dependencies installed:
 *   node scripts/mac-schema14-verification-proof.mjs              # every stage, one receipt
 *   node scripts/mac-schema14-verification-proof.mjs self-check   # the schema-14 helper self-check
 *
 * The distributed helper has no test route: snapshot() always takes its operator lane. This
 * runner is the only place a scratch lane exists. writeDisposableHelper() copies the helper into
 * fresh task-owned scratch, replaces the marked lane region with SCRATCH_LANE (task-owned
 * temporary roots only) and replaces the operator entry point; the regressions import that copy.
 *
 * Every database, snapshot, helper copy and receipt it creates lives in fresh temporary
 * directories; nothing is written into the repository, an application-data folder or an
 * installed app. The machine-readable receipt is written once, exclusively, to a new temporary
 * directory whose path is printed. Exit 0 only when every stage passes.
 *
 * Stages:
 *  1. source identity without a git process: HEAD read from the repository's ref files equals the
 *     pinned commit, every tracked path outside the allowed list matches the pinned HEAD tree
 *     (index blob ids and worktree bytes), and no untracked path lies outside the allowed list.
 *     Gitignored Cargo/Tauri build output (src-tauri/target, src-tauri/gen) is set aside and
 *     listed only when its exact shape is recognized; otherwise every file in it is reported. A
 *     sensitivity stage proves that on disposable trees;
 *  2. historical schema-13 helper self-check: passing regressions, with its disclosed live-source
 *     ceiling alarm reported separately as the one expected failure;
 *     A disposable copy with the own-key map reverted must fail exactly its special-key checks;
 *  3. schema-14 helper self-check;
 *  4. PR #142 replay: all six original installed comparisons give their original verdicts and
 *     exact diffs with the live schema-13 helper; the schema-14 helper refuses them as legacy;
 *  5. installed-schema anchors: the pinned definitions and SQLx ledger facts equal what the
 *     installed app actually recorded in PR #142's schema-12 and schema-13 snapshots;
 *  6. disposable fixture proofs and named regressions on a pristine helper copy;
 *  7. guard reversions: each named guard removed from a disposable copy makes its named
 *     regression fail while an unrelated control on the same copy still passes;
 *  8. production writers and validator: the permanent vitest regression, run and recorded.
 *
 * Boundaries stated in the receipt: scratch libraries carry a synthetic SQLx ledger (exact SQLx
 * table, shipped descriptions and SHA-384 checksums, written by the helper's scratch builder, not
 * SQLx); restores put closed database copies back in place (archive-state fidelity, not a native
 * backup/restore run); no schema-14 installer exists, so its identity is recorded as unavailable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.cwd();
// Repository baseline for this continuation; the helper's immutable schema contract stays at 8a260c0.
const PINNED_COMMIT = '16f9cf3dedbfef0be09711ec42c0f7b8d3ef4b78';
const HELPER14 = path.join(REPO, 'scripts', 'mac-schema14-profile-snapshot.mjs');
const HELPER13 = path.join(REPO, 'scripts', 'mac-schema13-profile-snapshot.mjs');
const PR142 = path.join(REPO, 'docs', 'evidence', 'mac-installed-results-2026-10-11');
const FROZEN_KIT = path.join(REPO, 'docs', 'evidence', 'mac-schema13-final-corrections-2026-10-10');
const OPERATOR_ENTRY = '// @hfd-schema14-operator-entry';
const LANE_BEGIN = '// @hfd-schema14-operator-lane-begin';
const LANE_END = '// @hfd-schema14-operator-lane-end';
const HISTORICAL_CEILING_ALARM = "anchor: CURRENT_SCHEMA_VERSION in the shipped source still equals this helper's constant";
const SCRATCH_PREFIX = 'hfd-schema14-selfcheck-proof-';
const ALLOWED_CHANGES = new Set([
  'STATUS.md',
  'ROADMAP.md',
  'docs/MAC_SCHEMA14_COMPLETION_REVIEWER_HANDOFF_2026-10-15.md',
  'docs/evidence/mac-schema14-completion-2026-10-15/baseline.json',
  'docs/evidence/mac-schema14-completion-2026-10-15/execution-receipts.json',
  'docs/evidence/mac-schema14-completion-2026-10-15/proof-receipt.json',
  'docs/evidence/mac-schema14-completion-2026-10-15/README.md',
  'docs/evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md',
  'docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json',
  'docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS',

  'scripts/mac-schema13-profile-snapshot.mjs',
  'scripts/mac-schema14-profile-snapshot.mjs',
  'scripts/mac-schema14-profile-snapshot.test.mjs',
  'scripts/mac-schema14-verification-proof.mjs',
  'src/logic/currentSchemaVerification.test.ts',
  'docs/MAC_SCHEMA14_VERIFICATION_PREPARATION_REPORT_2026-10-11.md',
  'docs/PROJECT_HANDOFF.md',
  'docs/evidence/mac-schema14-verification-preparation-2026-10-11/README.md',
  'docs/evidence/mac-schema14-verification-preparation-2026-10-11/RUNBOOK.md',
  'docs/evidence/mac-schema14-verification-preparation-2026-10-11/verification-receipts.json',
  'docs/evidence/mac-schema14-verification-preparation-2026-10-11/source-manifest.json',
  'docs/evidence/mac-schema14-verification-preparation-2026-10-11/SHA256SUMS',
]);
/** Infrastructure, not task output: the prepared dependency link. */
const INFRASTRUCTURE = new Set(['node_modules']);
/**
 * Untracked, gitignored build output that `cargo` and `tauri-build` write into src-tauri when the
 * required Cargo checks run. Each is accepted only at its exact path, as a real directory, under
 * its exact .gitignore rule, with no tracked path inside it and with its generator's shape (see
 * recognizeBuildOutput). Anything else there is walked and reported like any other untracked file.
 */
const BUILD_OUTPUT = Object.freeze({
  'src-tauri/target': { kind: 'cargo-target', ignoreRule: 'src-tauri/target/' },
  'src-tauri/gen': { kind: 'tauri-gen-schemas', ignoreRule: 'src-tauri/gen/' },
});
const CARGO_TARGET_ENTRIES = new Set(['CACHEDIR.TAG', '.rustc_info.json', '.future-incompat-report.json', 'debug', 'release', 'tmp']);
/**
 * Cross-target folders Cargo writes under target/ for `--target <triple>`. Only the project's one
 * supported Mac lane (Apple Silicon) is recognized, and only as Cargo writes it: its own single-linked
 * cache tag plus real profile directories. Any other triple, or anything else inside, is refused.
 */
const CARGO_TARGET_TRIPLES = new Set(['aarch64-apple-darwin']);
const CARGO_TRIPLE_PROFILES = new Set(['debug', 'release']);
const CARGO_CACHEDIR_TAG = 'Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n';
const TAURI_GEN_SCHEMA = /^(acl-manifests|capabilities|desktop-schema|mobile-schema|(macOS|linux|windows|iOS|android)-schema)\.json$/;
const TAURI_GEN_MAX_BYTES = 16 * 1024 * 1024;
/**
 * Current accepted baseline tree minus the exact submitted paths: 4306 of 4310 entries.
 * Generated from git ls-tree -r 16f9cf3dedbfef0be09711ec42c0f7b8d3ef4b78; runtime still verifies the
 * immutable digest, index blob ids/modes and worktree bytes without starting git.
 * The helper retains the original schema-contract pin; no migration/fixture bytes changed.
 */
const PINNED_TREE = Object.freeze({ entries: 4306, sha256: '3ebb29ae0c656c62fdd52648d96b95711bf5c34213d236b0f5a4b6e93c5b6346' });

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = p => sha256(fs.readFileSync(p));
const quiet = text => String(text ?? '').split('\n').filter(l => !/ExperimentalWarning: SQLite|--trace-warnings/.test(l)).join('\n').trim();
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

let scratch = '';
const redact = value => JSON.parse(JSON.stringify(value).split(scratch).join('<scratch>').split(REPO).join('<repo>'));
const stages = [];

function stage(id, title, fn) {
  const t0 = Date.now();
  let result;
  try {
    result = fn();
  } catch (error) {
    result = { pass: false, error: String(error?.stack ?? error) };
  }
  stages.push(redact({ id, title, durationMs: Date.now() - t0, ...result }));
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${id}  ${title}`);
}

async function stageAsync(id, title, fn) {
  const t0 = Date.now();
  let result;
  try {
    result = await fn();
  } catch (error) {
    result = { pass: false, error: String(error?.stack ?? error) };
  }
  stages.push(redact({ id, title, durationMs: Date.now() - t0, ...result }));
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${id}  ${title}`);
}

function run(file, args) {
  const t0 = Date.now();
  const r = spawnSync(file, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { command: [path.basename(file) === path.basename(process.execPath) ? 'node' : file, ...args].join(' '), exit: r.status, signal: r.signal, durationMs: Date.now() - t0, stdout: r.stdout, stderr: quiet(r.stderr) };
}

/* ------------------------------------------------------------------ *
 * Source identity without a git process (read-only reads of .git)
 * ------------------------------------------------------------------ */

function gitDirs() {
  const dotGit = path.join(REPO, '.git');
  const st = fs.lstatSync(dotGit);
  const gitDir = st.isDirectory() ? dotGit : path.resolve(REPO, fs.readFileSync(dotGit, 'utf8').match(/^gitdir: (.+)$/m)[1].trim());
  const commonFile = path.join(gitDir, 'commondir');
  const commonDir = fs.existsSync(commonFile) ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim()) : gitDir;
  return { gitDir, commonDir };
}

/** HEAD -> symbolic ref -> loose or packed commit id. */
function headCommit() {
  const { gitDir, commonDir } = gitDirs();
  const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  if (/^[0-9a-f]{40}$/.test(head)) return { commit: head, ref: 'detached' };
  const ref = head.match(/^ref: (\S+)$/)?.[1];
  if (!ref) throw new Error(`unreadable HEAD: ${head}`);
  for (const dir of [gitDir, commonDir]) {
    const loose = path.join(dir, ref);
    if (fs.existsSync(loose)) return { commit: fs.readFileSync(loose, 'utf8').trim(), ref };
  }
  const packed = fs.readFileSync(path.join(commonDir, 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(` ${ref}`));
  if (!packed) throw new Error(`ref ${ref} not found`);
  return { commit: packed.slice(0, 40), ref };
}

/** Stage-0 entries of a version 2 or 3 index: mode, blob id, path. */
function indexEntries() {
  const buf = fs.readFileSync(path.join(gitDirs().gitDir, 'index'));
  if (buf.toString('latin1', 0, 4) !== 'DIRC') throw new Error('index signature is not DIRC');
  const version = buf.readUInt32BE(4);
  if (version !== 2 && version !== 3) throw new Error(`index version ${version} is not supported`);
  const count = buf.readUInt32BE(8);
  const entries = [];
  let off = 12;
  for (let i = 0; i < count; i++) {
    const mode = buf.readUInt32BE(off + 24);
    const sha = buf.toString('hex', off + 40, off + 60);
    const flags = buf.readUInt16BE(off + 60);
    const extended = version === 3 && (flags & 0x4000) !== 0;
    const nameStart = off + 62 + (extended ? 2 : 0);
    const nameEnd = buf.indexOf(0, nameStart);
    const name = buf.toString('utf8', nameStart, nameEnd);
    const stageBits = (flags >> 12) & 3;
    entries.push({ mode: mode.toString(8).padStart(6, '0'), sha, path: name, stage: stageBits });
    off += Math.ceil((nameEnd - off + 1) / 8) * 8;
  }
  return entries;
}

function blobId(bytes) {
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * QA-02: whether a later commit's package-lock.json is the pinned baseline lock with only the
 * application's own version changed. The post-merge replay installs dependencies from the baseline
 * lock in a detached baseline worktree, so the candidate must carry exactly the same dependency
 * graph. The only permitted difference is the two synchronized root fields `version` and
 * `packages[""].version`, which scripts/bump-version.mjs changes together; the candidate must be
 * byte-identical to the baseline as npm would write it with that version substituted. Any package,
 * range, integrity, resolution, key-order or formatting change, or root versions that disagree, is
 * refused. This compares one component's inputs; it never certifies the candidate application.
 */
export function compareDependencyLock(baselineBytes, candidateBytes) {
  const refuse = reason => ({ ok: false, reason });
  const parse = (bytes, label) => {
    try { return { value: JSON.parse(Buffer.from(bytes).toString('utf8')) }; } catch { return { error: `${label} package-lock.json is not JSON` }; }
  };
  const base = parse(baselineBytes, 'baseline');
  if (base.error) return refuse(base.error);
  const cand = parse(candidateBytes, 'candidate');
  if (cand.error) return refuse(cand.error);
  const rootVersion = (lock, label) => {
    const top = lock?.version;
    const pkg = lock?.packages?.['']?.version;
    if (typeof top !== 'string' || typeof pkg !== 'string') return { error: `${label} lock lacks the root version fields` };
    if (top !== pkg) return { error: `${label} lock root versions disagree (${top} vs packages[""] ${pkg})` };
    return { version: top };
  };
  const bv = rootVersion(base.value, 'baseline');
  if (bv.error) return refuse(bv.error);
  const cv = rootVersion(cand.value, 'candidate');
  if (cv.error) return refuse(cv.error);
  const npmText = lock => `${JSON.stringify(lock, null, 2)}\n`;
  if (npmText(base.value) !== Buffer.from(baselineBytes).toString('utf8')) return refuse('baseline lock is not in npm\'s canonical form');
  const expected = structuredClone(base.value);
  expected.version = cv.version;
  expected.packages[''].version = cv.version;
  if (npmText(expected) !== Buffer.from(candidateBytes).toString('utf8')) {
    return refuse('candidate lock differs from the baseline in more than the application version');
  }
  return { ok: true, baselineVersion: bv.version, candidateVersion: cv.version, versionOnly: bv.version !== cv.version };
}

/** Cargo's cache-directory tag: a regular, single-linked, small file starting with Cargo's signature. */
function isCargoTag(tag) {
  const st = fs.existsSync(tag) ? fs.lstatSync(tag) : null;
  return Boolean(st?.isFile() && st.nlink === 1 && st.size <= 4096 && fs.readFileSync(tag, 'utf8').startsWith(CARGO_CACHEDIR_TAG));
}

/**
 * Recognizes one BUILD_OUTPUT directory, or says why it is not recognized. Cargo's target is not
 * descended (it holds gigabytes and Cargo's own hard links); it must be a real directory carrying
 * Cargo's cache-directory tag with only Cargo's top-level entries, plus at most the Apple Silicon
 * cross-target folder in the same tagged shape. Tauri's gen must hold only
 * schemas/ with generated schema JSON: regular, single-linked, bounded, parseable files.
 */
export function recognizeBuildOutput(root, rel, trackedPaths) {
  const spec = BUILD_OUTPUT[rel];
  if (!spec) return { recognized: false, reason: 'not a recognized build-output path' };
  const no = reason => ({ recognized: false, kind: spec.kind, reason });
  let ignore = '';
  try { ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); } catch { return no('no .gitignore'); }
  if (!ignore.split('\n').some(l => l.trim() === spec.ignoreRule)) return no(`.gitignore has no ${spec.ignoreRule} rule`);
  if ([...trackedPaths].some(p => p === rel || p.startsWith(`${rel}/`))) return no('a tracked path lies inside it');
  const abs = path.join(root, rel);
  const st = fs.lstatSync(abs);
  if (!st.isDirectory()) return no('not a real directory');
  const names = fs.readdirSync(abs).sort();
  if (spec.kind === 'cargo-target') {
    const unknown = names.filter(n => !CARGO_TARGET_ENTRIES.has(n) && !CARGO_TARGET_TRIPLES.has(n));
    if (unknown.length) return no(`unexpected top-level entries: ${unknown.join(', ')}`);
    if (!isCargoTag(path.join(abs, 'CACHEDIR.TAG'))) return no('no single-linked Cargo CACHEDIR.TAG');
    const targets = [];
    for (const n of names.filter(x => x !== 'CACHEDIR.TAG')) {
      const s = fs.lstatSync(path.join(abs, n));
      if (n.startsWith('.') ? !s.isFile() : !s.isDirectory()) return no(`${n} is not a ${n.startsWith('.') ? 'regular file' : 'real directory'}`);
      if (!CARGO_TARGET_TRIPLES.has(n)) continue;
      // A cross-target folder: Cargo's own tag and profile directories, nothing else.
      const inner = fs.readdirSync(path.join(abs, n)).sort();
      const stray = inner.filter(x => x !== 'CACHEDIR.TAG' && !CARGO_TRIPLE_PROFILES.has(x));
      if (stray.length) return no(`${n}: unexpected entries: ${stray.join(', ')}`);
      if (!isCargoTag(path.join(abs, n, 'CACHEDIR.TAG'))) return no(`${n}: no single-linked Cargo CACHEDIR.TAG`);
      for (const profile of inner.filter(x => x !== 'CACHEDIR.TAG')) {
        if (!fs.lstatSync(path.join(abs, n, profile)).isDirectory()) return no(`${n}/${profile} is not a real directory`);
      }
      targets.push({ triple: n, entries: inner });
    }
    return { recognized: true, kind: spec.kind, path: rel, ignoreRule: spec.ignoreRule, topLevel: names, targets, descended: false };
  }
  if (names.length !== 1 || names[0] !== 'schemas' || !fs.lstatSync(path.join(abs, 'schemas')).isDirectory()) return no('must contain only a schemas directory');
  const files = [];
  for (const n of fs.readdirSync(path.join(abs, 'schemas')).sort()) {
    const f = path.join(abs, 'schemas', n);
    const s = fs.lstatSync(f);
    if (!TAURI_GEN_SCHEMA.test(n)) return no(`unexpected file schemas/${n}`);
    if (!s.isFile() || s.nlink !== 1 || s.size > TAURI_GEN_MAX_BYTES) return no(`schemas/${n} is not a regular, single-linked, bounded file`);
    const bytes = fs.readFileSync(f);
    try { JSON.parse(bytes.toString('utf8')); } catch { return no(`schemas/${n} is not JSON`); }
    files.push({ path: `${rel}/schemas/${n}`, bytes: bytes.length, sha256: sha256(bytes) });
  }
  if (!files.length) return no('schemas is empty');
  return { recognized: true, kind: spec.kind, path: rel, ignoreRule: spec.ignoreRule, files };
}

/**
 * Tracked entries must match their bytes and mode on disk; untracked paths are listed by walking
 * the tree (only .git and the dependency link skipped). Recognized build output is returned
 * separately; unrecognized build output is walked and every file in it is reported.
 */
export function classifyWorktree(root, entries) {
  const changed = [];
  for (const e of entries) {
    const abs = path.join(root, e.path);
    let st;
    try { st = fs.lstatSync(abs); } catch { changed.push({ status: ' D', path: e.path }); continue; }
    const bytes = e.mode === '120000' ? (st.isSymbolicLink() ? Buffer.from(fs.readlinkSync(abs)) : null) : (st.isFile() ? fs.readFileSync(abs) : null);
    const exec = e.mode === '100755';
    if (!bytes || blobId(bytes) !== e.sha || (e.mode !== '120000' && ((st.mode & 0o111) !== 0) !== exec)) changed.push({ status: ' M', path: e.path });
  }
  const tracked = new Set(entries.map(e => e.path));
  const buildOutput = [];
  const refusedBuildOutput = [];
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.git' || INFRASTRUCTURE.has(r)) { if (INFRASTRUCTURE.has(r)) changed.push({ status: '??', path: r }); continue; }
      if (BUILD_OUTPUT[r]) {
        const found = recognizeBuildOutput(root, r, tracked);
        if (found.recognized) { buildOutput.push(found); continue; }
        refusedBuildOutput.push({ path: r, ...found });
      }
      const st = fs.lstatSync(path.join(dir, name));
      if (st.isDirectory()) walk(path.join(dir, name), r);
      else if (!tracked.has(r)) changed.push({ status: '??', path: r });
    }
  };
  walk(root, '');
  changed.sort((a, b) => byPath(a.path, b.path));
  return { changed, buildOutput, refusedBuildOutput };
}

/** Tracked paths outside the allowed list must equal the pinned tree in the index and on disk. */
function sourceIdentity() {
  const head = headCommit();
  const entries = indexEntries();
  const kept = entries.filter(e => !ALLOWED_CHANGES.has(e.path)).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const treeDigest = crypto.createHash('sha256');
  for (const e of kept) treeDigest.update(`${e.mode} ${e.sha} ${e.path}\n`);
  const indexMatchesPin = kept.length === PINNED_TREE.entries && treeDigest.digest('hex') === PINNED_TREE.sha256 && entries.every(e => e.stage === 0);
  return { head, indexEntries: entries.length, indexMatchesPinnedTree: indexMatchesPin, pinnedTree: PINNED_TREE, ...classifyWorktree(REPO, entries) };
}

/**
 * Sensitivity of classifyWorktree on disposable trees: genuine Cargo/Tauri output is accepted,
 * while source beside or inside it, a misshapen, symlinked, hard-linked, unignored or tracked
 * build directory, and a changed or deleted protected file are each reported.
 */
export function walkerSensitivity(dir) {
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  const MIGRATION = 'src-tauri/migrations/0001_initial_schema.sql';
  const HELPER = 'scripts/mac-schema14-profile-snapshot.mjs';
  const GEN = ['src-tauri/gen/schemas/capabilities.json', 'src-tauri/gen/schemas/macOS-schema.json'];
  const put = (root, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body, { flag: 'wx' }); };
  const HOST_TARGET = ['src-tauri/target/.rustc_info.json', 'src-tauri/target/CACHEDIR.TAG', 'src-tauri/target/debug/deps/libx.rlib', 'src-tauri/target/debug/libx.rlib'];
  const TRIPLE_TAG = `${CARGO_CACHEDIR_TAG}# For information about cache directory tags see https://bford.info/cachedir/\n`;
  const TRIPLE_FILES = ['src-tauri/target/aarch64-apple-darwin/CACHEDIR.TAG', 'src-tauri/target/aarch64-apple-darwin/release/deps/liba.rlib', 'src-tauri/target/aarch64-apple-darwin/release/liba.rlib'];
  const withTriple = root => {
    put(root, TRIPLE_FILES[0], TRIPLE_TAG);
    put(root, TRIPLE_FILES[1], 'rlib');
    fs.linkSync(path.join(root, TRIPLE_FILES[1]), path.join(root, TRIPLE_FILES[2]));
  };
  const build = (name, edit) => {
    const root = path.join(dir, name);
    fs.mkdirSync(root);
    put(root, '.gitignore', ignore);
    put(root, MIGRATION, 'CREATE TABLE t (id TEXT);\n');
    put(root, HELPER, '// helper\n');
    put(root, 'src-tauri/target/CACHEDIR.TAG', `${CARGO_CACHEDIR_TAG}# For information about cache directory tags see https://bford.info/cachedir/\n`);
    put(root, 'src-tauri/target/.rustc_info.json', '{}\n');
    put(root, 'src-tauri/target/debug/deps/libx.rlib', 'rlib');
    fs.linkSync(path.join(root, 'src-tauri/target/debug/deps/libx.rlib'), path.join(root, 'src-tauri/target/debug/libx.rlib'));
    for (const g of GEN) put(root, g, '{"generated":true}\n');
    const entries = ['.gitignore', MIGRATION, HELPER].map(p => ({ mode: '100644', sha: blobId(fs.readFileSync(path.join(root, p))), path: p, stage: 0 }));
    return { root, entries: edit?.(root, entries) ?? entries };
  };
  const cases = [
    ['accepted: genuine Cargo target and Tauri gen schemas', null, [], ['cargo-target', 'tauri-gen-schemas']],
    ['refused: unexpected source beside the build output', root => put(root, 'src-tauri/src/extra.rs', 'fn x() {}\n'), ['src-tauri/src/extra.rs'], ['cargo-target', 'tauri-gen-schemas']],
    ['refused: source inside Tauri gen', root => put(root, 'src-tauri/gen/schemas/payload.mjs', 'export {};\n'), [...GEN, 'src-tauri/gen/schemas/payload.mjs'], ['cargo-target']],
    ['refused: unknown top-level entry in Cargo target', root => put(root, 'src-tauri/target/notes.md', 'x\n'), ['src-tauri/target/.rustc_info.json', 'src-tauri/target/CACHEDIR.TAG', 'src-tauri/target/debug/deps/libx.rlib', 'src-tauri/target/debug/libx.rlib', 'src-tauri/target/notes.md'], ['tauri-gen-schemas']],
    ['refused: Cargo target without its cache tag', root => fs.rmSync(path.join(root, 'src-tauri/target/CACHEDIR.TAG')), ['src-tauri/target/.rustc_info.json', 'src-tauri/target/debug/deps/libx.rlib', 'src-tauri/target/debug/libx.rlib'], ['tauri-gen-schemas']],
    ['refused: Cargo target is a symlink', root => { const real = path.join(dir, 'elsewhere-target'); fs.renameSync(path.join(root, 'src-tauri/target'), real); fs.symlinkSync(real, path.join(root, 'src-tauri/target')); }, ['src-tauri/target'], ['tauri-gen-schemas']],
    ['refused: hard-linked Tauri gen schema', root => fs.linkSync(path.join(root, GEN[0]), path.join(dir, 'outside-link.json')), GEN, ['cargo-target']],
    ['refused: build output without its .gitignore rule', root => fs.writeFileSync(path.join(root, '.gitignore'), ignore.split('\n').filter(l => !/^src-tauri\/(target|gen)\/$/.test(l.trim())).join('\n')), ['.gitignore', ...GEN, 'src-tauri/target/.rustc_info.json', 'src-tauri/target/CACHEDIR.TAG', 'src-tauri/target/debug/deps/libx.rlib', 'src-tauri/target/debug/libx.rlib'], []],
    ['refused: tracked path inside build output', (root, entries) => [...entries, { mode: '100644', sha: blobId(fs.readFileSync(path.join(root, GEN[0]))), path: GEN[0], stage: 0 }], [GEN[1]], ['cargo-target']],
    ['refused: changed protected migration beside accepted build output', root => fs.appendFileSync(path.join(root, MIGRATION), '-- edited\n'), [MIGRATION], ['cargo-target', 'tauri-gen-schemas']],
    ['refused: deleted protected migration beside accepted build output', root => fs.rmSync(path.join(root, MIGRATION)), [MIGRATION], ['cargo-target', 'tauri-gen-schemas']],
    // QA-01: the canonical Apple Silicon target folder (`--target aarch64-apple-darwin`).
    ['accepted: Apple Silicon target output beside host output', root => withTriple(root), [], ['cargo-target', 'tauri-gen-schemas']],
    ['refused: unknown target name in Cargo target', root => { withTriple(root); put(root, 'src-tauri/target/x86_64-apple-darwin/CACHEDIR.TAG', TRIPLE_TAG); put(root, 'src-tauri/target/x86_64-apple-darwin/release/libz.rlib', 'rlib'); }, [...HOST_TARGET, ...TRIPLE_FILES, 'src-tauri/target/x86_64-apple-darwin/CACHEDIR.TAG', 'src-tauri/target/x86_64-apple-darwin/release/libz.rlib'], ['tauri-gen-schemas']],
    ['refused: source beside the Apple Silicon target profile', root => { withTriple(root); put(root, 'src-tauri/target/aarch64-apple-darwin/build.rs', 'fn main() {}\n'); }, [...HOST_TARGET, ...TRIPLE_FILES, 'src-tauri/target/aarch64-apple-darwin/build.rs'], ['tauri-gen-schemas']],
    ['refused: tracked path inside the Apple Silicon target', (root, entries) => { withTriple(root); return [...entries, { mode: '100644', sha: blobId(fs.readFileSync(path.join(root, TRIPLE_FILES[1]))), path: TRIPLE_FILES[1], stage: 0 }]; }, [...HOST_TARGET, TRIPLE_FILES[0], TRIPLE_FILES[2]], ['tauri-gen-schemas']],
  ];
  return cases.map(([name, edit, expectChanged, expectAccepted]) => {
    const { root, entries } = build(name.replace(/[^a-z]+/g, '-'), edit);
    const r = classifyWorktree(root, entries);
    const changed = r.changed.map(c => c.path);
    const accepted = r.buildOutput.map(b => b.kind).sort();
    return { name, changed, accepted, refusedBuildOutput: r.refusedBuildOutput.map(b => `${b.path}: ${b.reason}`), pass: sameList(changed, [...expectChanged].sort(byPath)) && sameList(accepted, expectAccepted) };
  });
}

const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Changed or untracked paths relative to the pinned tree, and the build output set aside. */
function changedPaths() {
  const { changed, buildOutput, refusedBuildOutput } = sourceIdentity();
  return { changed, buildOutput, refusedBuildOutput };
}

function protectedHashes() {
  const files = [
    ...fs.readdirSync(PR142).map(f => path.join(PR142, f)),
    path.join(FROZEN_KIT, 'final-helper.mjs'),
    path.join(FROZEN_KIT, 'SHA256SUMS'),
    path.join(REPO, 'docs', 'MAC_INSTALLED_RESULTS_2026-10-11.md'),
    ...fs.readdirSync(path.join(REPO, 'src-tauri', 'migrations')).map(f => path.join(REPO, 'src-tauri', 'migrations', f)),
    ...fs.readdirSync(path.join(REPO, 'src-tauri', 'fixtures', 'skill-evidence')).map(f => path.join(REPO, 'src-tauri', 'fixtures', 'skill-evidence', f)),
  ].sort();
  return Object.fromEntries(files.map(f => [path.relative(REPO, f), fileSha(f)]));
}

/* ------------------------------------------------------------------ *
 * Disposable helper copies
 * ------------------------------------------------------------------ */

/**
 * The scratch lane a disposable copy carries instead of the distributed operator lane. It accepts
 * only task-owned scratch under the real temporary directory, never an application-data location,
 * and it lives only in this runner and in the copies it writes.
 */
const SCRATCH_LANE = `// Disposable-copy scratch lane (written by scripts/mac-schema14-verification-proof.mjs).
let selectedScratchLane = null;
function scratchLane(root, uid, inspect) {
  const realTmp = fs.realpathSync(os.tmpdir());
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('scratch lane needs an absolute root');
  const resolved = safeRealpath(root);
  if (!isWithin(realTmp, resolved)) fail(\`scratch root \${resolved} is not under \${realTmp}\`);
  if (!path.relative(realTmp, resolved).split(path.sep).some(x => x.startsWith(SCRATCH_PREFIX))) fail(\`scratch root \${resolved} is not inside task-owned \${SCRATCH_PREFIX}* scratch\`);
  if (path.basename(resolved) !== APP_ID) fail(\`scratch root \${resolved} is not a \${APP_ID} directory\`);
  for (const real of [APPROVED.root, path.join(os.homedir(), 'Library', 'Application Support')]) {
    if (isWithin(safeRealpath(real), resolved)) fail(\`scratch root \${resolved} is inside a real application-data location\`);
  }
  if (!Number.isInteger(uid)) fail('scratch lane needs a numeric uid');
  return Object.freeze({ profile: resolved, uid, inspect: inspect ?? (() => controlledInspection('stopped')), isolate: () => ({ scratch: true }), operator: false });
}
function operatorLane() {
  if (!selectedScratchLane) fail('disposable copy: no scratch lane is selected');
  return selectedScratchLane;
}
function takeSnapshot(root, uid, outPath, inspect) {
  selectedScratchLane = scratchLane(root, uid, inspect);
  try { return snapshot({ mode: 'snapshot', jsonOut: outPath }); } finally { selectedScratchLane = null; }
}
`;

/**
 * Write a disposable copy of the distributed helper into `dir` (fresh, task-owned scratch): the
 * marked lane region becomes SCRATCH_LANE, an optional exact edit (matching exactly once) is
 * applied, and the operator entry point is replaced by `entry`. The distributed file is only read.
 */
export function writeDisposableHelper(dir, { entry, edit } = {}) {
  const realTmp = fs.realpathSync(os.tmpdir());
  const realDir = fs.realpathSync(dir);
  if (!realDir.startsWith(`${realTmp}${path.sep}`) || !path.relative(realTmp, realDir).split(path.sep).some(x => x.startsWith('hfd-schema14-selfcheck-'))) {
    throw new Error(`disposable helper copies belong in task-owned scratch, not ${realDir}`);
  }
  const source = fs.readFileSync(HELPER14, 'utf8');
  for (const marker of [OPERATOR_ENTRY, LANE_BEGIN, LANE_END]) {
    if (source.split(marker).length !== 2) throw new Error(`marker ${marker} must appear exactly once in the distributed helper`);
  }
  const begin = source.indexOf(LANE_BEGIN);
  const end = source.indexOf(LANE_END) + LANE_END.length;
  let body = `${source.slice(0, begin)}${SCRATCH_LANE}${source.slice(end, source.indexOf(OPERATOR_ENTRY))}`;
  if (edit) {
    if (body.split(edit.from).length !== 2) throw new Error(`reversion target must match exactly once: ${edit.from}`);
    body = body.replace(edit.from, edit.to);
  }
  const file = path.join(realDir, 'mac-schema14-profile-snapshot.disposable.mjs');
  fs.writeFileSync(file, `${body}${entry}\n`, { flag: 'wx' });
  return file;
}

const ADAPTER_EXPORTS = 'buildScratchProfile, cloneScratchProfile, setMetadata, withDb, applyShippedMigrations, takeSnapshot, compare, evaluateContract, PINNED_OBJECT_MAP, PINNED_MIGRATIONS, SQLX_LEDGER_DDL_SHA256, BACKUP_RECEIPT_KEYS';
let copies = 0;

/** A disposable copy with an adapter export, optionally with one exact edit, imported. */
async function loadCopy(edit) {
  const dir = path.join(scratch, `copy-${++copies}`);
  fs.mkdirSync(dir);
  const file = writeDisposableHelper(dir, { edit, entry: `export const adapter = { ${ADAPTER_EXPORTS} };` });
  const H = (await import(pathToFileURL(file).href)).adapter;
  return { H, file, copySha256: fileSha(file) };
}

/* ------------------------------------------------------------------ *
 * Named regressions: each builds its own disposable libraries
 * ------------------------------------------------------------------ */

let libraries = 0;
const uid = process.getuid();
const SPECIAL = [['__proto__', 'proto-value'], ['constructor', 'constructor-value'], ['toString', 'tostring-value'], ['préférence_✈️_キー', 'unicode-value']];
const RECEIPT_ROWS = [['last_complete_backup_at', '2026-10-11T12:00:00.000Z'], ['last_complete_backup_path', '/synthetic/backups/hfd.zip'], ['last_complete_backup_version', '0.6.0']];

function newLib(H, options) {
  return H.buildScratchProfile(path.join(scratch, `lib-${++libraries}`), REPO, options);
}
function snapOf(H, lib, name) {
  const out = path.join(scratch, `snap-${libraries}-${name}-${crypto.randomUUID()}.json`);
  H.takeSnapshot(lib.root, uid, out);
  return out;
}
const named = (c, text) => c.diffs.includes(text) || c.diffs.some(d => d.endsWith(text));

/** A populated schema-13 library (accepted fixture), captured, then genuinely upgraded to 14. */
function upgraded(H, { before13, after14Sql, keys = SPECIAL } = {}) {
  const lib = newLib(H, { version: 13 });
  H.setMetadata(lib.dbPath, keys);
  if (before13) H.withDb(lib.dbPath, db => db.exec(before13));
  const s13 = snapOf(H, lib, 's13');
  H.withDb(lib.dbPath, db => H.applyShippedMigrations(db, REPO, 14, 14));
  if (after14Sql) H.withDb(lib.dbPath, db => db.exec(after14Sql));
  return { lib, s13, s14: snapOf(H, lib, 's14') };
}

const REGRESSIONS = {
  // Ordinary metadata only, so the control does not depend on any guard a reversion removes.
  'control-genuine-upgrade': H => {
    const { s13, s14 } = upgraded(H, { keys: [['daily_plan_session', '{"synthetic":true}']] });
    const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
    return { pass: c.verdict === 'PASS' && c.diffs.length === 0, verdict: c.verdict, diffs: c.diffs };
  },
  'special-keys-own-digests': H => {
    const { s13, s14 } = upgraded(H);
    const snap = JSON.parse(fs.readFileSync(s14, 'utf8'));
    const meta = snap.tables.app_metadata;
    const own = SPECIAL.every(([k]) => Object.hasOwn(meta.keyDigests, k)) && Object.keys(meta.keyDigests).length === meta.rowCount;
    let restore;
    try { restore = H.compare({ before: s13, after: s14, purpose: 'restore' }); } catch (error) { restore = { verdict: 'REFUSED', diffs: [String(error.message)] }; }
    return { pass: own && restore.verdict === 'PASS', ownKeys: Object.keys(meta.keyDigests), rowCount: meta.rowCount, restore: restore.verdict, diffs: restore.diffs };
  },
  'missing-ledger-row': H => {
    const { s13, s14 } = upgraded(H, { before13: 'DELETE FROM _sqlx_migrations WHERE version = 7' });
    const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
    return { pass: c.verdict === 'FAIL' && named(c, 'ledger: registered migration(s) 7 are missing from the SQLx ledger'), verdict: c.verdict, diffs: c.diffs };
  },
  'incomplete-inventory': H => {
    const { s14 } = upgraded(H);
    const s = JSON.parse(fs.readFileSync(s14, 'utf8'));
    delete s.inventory;
    const forged = path.join(scratch, `no-inventory-${crypto.randomUUID()}.json`);
    fs.writeFileSync(forged, JSON.stringify(s));
    try {
      const c = H.compare({ before: s14, after: forged, purpose: 'unchanged' });
      return { pass: false, verdict: c.verdict, diffs: c.diffs };
    } catch (error) {
      return { pass: /table inventory is missing/.test(error.message), refusal: error.message };
    }
  },
  'incomplete-definitions': H => {
    const { s14 } = upgraded(H);
    const s = JSON.parse(fs.readFileSync(s14, 'utf8'));
    s.schemaObjects.definitions.skill_observations.sql = '';
    const forged = path.join(scratch, `blank-definition-${crypto.randomUUID()}.json`);
    fs.writeFileSync(forged, JSON.stringify(s));
    try {
      const c = H.compare({ before: s14, after: forged, purpose: 'unchanged' });
      return { pass: false, verdict: c.verdict, diffs: c.diffs };
    } catch (error) {
      return { pass: /schema object skill_observations lacks a complete definition/.test(error.message), refusal: error.message };
    }
  },
  'exclusion-scope-restore': H => {
    const lib = newLib(H, { version: 14, writerEvidence: true });
    H.setMetadata(lib.dbPath, [...SPECIAL, ['daily_plan_session', '{"synthetic":true}']]);
    const archive = snapOf(H, lib, 'archive');
    H.setMetadata(lib.dbPath, [...RECEIPT_ROWS, ['daily_plan_session', '{"synthetic":false}']]);
    const c = H.compare({ before: archive, after: snapOf(H, lib, 'changed'), purpose: 'restore' });
    return { pass: c.verdict === 'FAIL' && named(c, 'app_metadata: keys other than the backup receipt differ (daily_plan_session)'), verdict: c.verdict, diffs: c.diffs };
  },
  'exclusion-restore-only': H => {
    const lib = newLib(H, { version: 14, writerEvidence: true });
    H.setMetadata(lib.dbPath, SPECIAL);
    const before = snapOf(H, lib, 'before');
    H.setMetadata(lib.dbPath, RECEIPT_ROWS);
    const c = H.compare({ before, after: snapOf(H, lib, 'after'), purpose: 'unchanged' });
    return { pass: c.verdict === 'FAIL' && named(c, 'app_metadata: keys differ (last_complete_backup_at, last_complete_backup_path, last_complete_backup_version)'), verdict: c.verdict, diffs: c.diffs };
  },
  'retained-data': H => {
    const { s13, s14 } = upgraded(H, { after14Sql: 'UPDATE practice_responses SET is_correct = 1 - is_correct' });
    const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
    return { pass: c.verdict === 'FAIL' && c.sections.tables.changed.includes('practice_responses'), verdict: c.verdict, changed: c.sections.tables.changed, diffs: c.diffs };
  },
  'seed-content': H => {
    const { s13, s14 } = upgraded(H, { after14Sql: "UPDATE skill_catalog_entries SET label = 'Taxi practice' WHERE id = 'builtin.taxiing'" });
    const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
    return { pass: c.verdict === 'FAIL' && c.diffs.some(d => d.startsWith('skill_catalog_entries: expected exactly the migration-14 catalog seed')), verdict: c.verdict, diffs: c.diffs };
  },
  'ledger-prefix-rows': H => {
    const { s13, s14 } = upgraded(H, { after14Sql: "UPDATE _sqlx_migrations SET installed_on = '2026-10-12 00:00:00' WHERE version = 3" });
    const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
    return { pass: c.verdict === 'FAIL' && named(c, 'ledger: retained migration 3 row changed (description, timestamp, success, checksum or execution facts)'), verdict: c.verdict, diffs: c.diffs };
  },
  'altered-definition': H => {
    const { s13, s14 } = upgraded(H, { after14Sql: 'DROP INDEX idx_split_lineage_parent; CREATE INDEX idx_split_lineage_parent ON material_split_lineage(parent_material_id, root_material_id)' });
    const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
    return { pass: c.verdict === 'FAIL' && named(c, 'schema: object idx_split_lineage_parent definition differs from shipped migration 13'), verdict: c.verdict, diffs: c.diffs };
  },
  'unrecovered-permission-block': H => {
    const lib = newLib(H, { version: 14, writerEvidence: true });
    const before = snapOf(H, lib, 'before');
    fs.chmodSync(path.join(lib.root, 'backups'), 0o555);
    const blocked = snapOf(H, lib, 'blocked');
    fs.chmodSync(path.join(lib.root, 'backups'), 0o755);
    const c = H.compare({ before, after: blocked, purpose: 'unchanged' });
    return { pass: c.verdict === 'FAIL' && c.diffs.some(d => d.startsWith('permissions: backups changed directory 0755')), verdict: c.verdict, diffs: c.diffs };
  },
  'sqlite-prefix-literal': H => {
    // LIKE 'sqlite_%' would treat _ as a wildcard and hide this user table from the inventory.
    const lib = newLib(H, { version: 14, writerEvidence: true });
    const before = snapOf(H, lib, 'before');
    H.withDb(lib.dbPath, db => db.exec('CREATE TABLE sqlitex_user_evidence (id TEXT PRIMARY KEY)'));
    const after = snapOf(H, lib, 'after');
    const captured = JSON.parse(fs.readFileSync(after, 'utf8')).schemaObjects.names.includes('sqlitex_user_evidence');
    const c = H.compare({ before, after, purpose: 'unchanged' });
    return { pass: captured && c.verdict === 'FAIL' && c.diffs.some(d => /unexpected object\(s\) not created by migrations 1–14: sqlitex_user_evidence/.test(d)), captured, verdict: c.verdict, diffs: c.diffs };
  },
  'runtime-root-symlink': H => {
    const lib = newLib(H, { version: 14, writerEvidence: true });
    const outside = path.join(scratch, `outside-${crypto.randomUUID()}`);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.txt'), 'outside the profile');
    fs.rmSync(path.join(lib.root, 'backups'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(lib.root, 'backups'), 'dir');
    const out = path.join(scratch, `snap-runtime-link-${crypto.randomUUID()}.json`);
    let message = '';
    try { H.takeSnapshot(lib.root, uid, out); } catch (error) { message = String(error?.message ?? error); }
    const wroteReceipt = fs.existsSync(out);
    const hashedOutside = wroteReceipt && JSON.parse(fs.readFileSync(out, 'utf8')).runtimeFiles.some(f => f.relativePath === 'backups/private.txt');
    return { pass: /backups\/ is a symlink/.test(message) && !wroteReceipt, refusal: message, wroteReceipt, hashedOutside };
  },
};

/** Each reversion removes one named guard from a disposable copy; its regression must then fail. */
const REVERSIONS = [
  { id: 'special-key own-key map', regression: 'special-keys-own-digests', from: 'const out = Object.create(null);', to: 'const out = {};' },
  { id: 'missing-ledger guard', regression: 'missing-ledger-row', from: '  if (missing.length) diffs.push(', to: '  if (false) diffs.push(' },
  { id: 'inventory completeness guard', regression: 'incomplete-inventory', from: '  validateInventoryFacts(snap, add);', to: '' },
  { id: 'definition completeness guard', regression: 'incomplete-definitions', from: '  validateObjectFacts(snap.schemaObjects, add);', to: '' },
  { id: 'exclusion scope (exact three keys)', regression: 'exclusion-scope-restore', from: 'const other = changedMetadataKeys(x, y, BACKUP_RECEIPT_KEYS);', to: 'const other = changedMetadataKeys(x, y, [...Object.keys(x), ...Object.keys(y)]);' },
  { id: 'exclusion scope (restore only)', regression: 'exclusion-restore-only', from: "if (t.name === 'app_metadata' && purpose === 'restore' && ", to: "if (t.name === 'app_metadata' && " },
  { id: 'retained-data guard', regression: 'retained-data', from: '      if (!entryEqual(ea, eb)) {', to: '      if (false) {' },
  { id: 'seed-content guard', regression: 'seed-content', from: 'eb.sha256 !== seed.sha256', to: 'false' },
  { id: 'ledger-prefix row guard', regression: 'ledger-prefix-rows', from: '    if (canonicalJson(before[i]) !== canonicalJson(after[i]))', to: '    if (false)' },
  { id: 'definition-pin guard', regression: 'altered-definition', from: '    .filter(([n, e]) => present.has(n) && (defs[n].type !== e.type', to: '    .filter(([n, e]) => false && (defs[n].type !== e.type' },
  { id: 'literal sqlite_ prefix exclusion', regression: 'sqlite-prefix-literal', from: `const USER_OBJECT_FILTER = "substr(name, 1, 7) <> 'sqlite_'";`, to: `const USER_OBJECT_FILTER = "name NOT LIKE 'sqlite_%'";` },
  // Reverting to a link-following stat lets the walk list and hash files outside the profile.
  { id: 'symlinked runtime-root refusal', regression: 'runtime-root-symlink', from: "    try { st = fs.lstatSync(abs); } catch (error) {\n      if (error.code === 'ENOENT') continue;", to: "    try { st = fs.statSync(abs); } catch (error) {\n      if (error.code === 'ENOENT') continue;" },
  { id: 'permission-recovery guard', regression: 'unrecovered-permission-block', from: "if (purpose === 'unchanged') diffs.push(...permDiffs);", to: 'if (false) diffs.push(...permDiffs);' },
];

function runRegression(H, name) {
  try {
    return REGRESSIONS[name](H);
  } catch (error) {
    return { pass: false, startupOrRuntimeError: String(error?.message ?? error) };
  }
}

/* ------------------------------------------------------------------ *
 * Stages
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

const RUNNER = fileURLToPath(import.meta.url);

function requireRepositoryRoot() {
  if (!fs.existsSync(path.join(REPO, 'src-tauri', 'migrations')) || !fs.existsSync(HELPER14)) {
    console.error('REFUSED: run from the repository root (node scripts/mac-schema14-verification-proof.mjs)');
    process.exit(2);
  }
}

/** The helper's own self-check, executed in a disposable copy; its report is passed through unchanged. */
function selfCheckCommand() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), SCRATCH_PREFIX));
  try {
    const file = writeDisposableHelper(dir, { entry: 'selfCheck();' });
    const r = spawnSync(process.execPath, [file], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    process.stdout.write(r.stdout);
    const err = quiet(r.stderr);
    if (err) console.error(err);
    process.exitCode = r.status === 0 ? 0 : 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function proof() {
  scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), SCRATCH_PREFIX));
  const started = Date.now();
  const helperShaBefore = { schema13: fileSha(HELPER13), schema14: fileSha(HELPER14) };
  const protectedBefore = protectedHashes();

  stage('source-identity', 'clone is at the pinned commit; only allowed paths differ from the pinned tree; pinned migration bytes', () => {
    const identity = sourceIdentity();
    const outside = identity.changed.filter(c => !ALLOWED_CHANGES.has(c.path) && !INFRASTRUCTURE.has(c.path));
    const checksums = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'data', 'migration-checksums.json'), 'utf8'));
    const migrations = Object.keys(checksums).sort().map(f => ({ file: f, sha256: fileSha(path.join(REPO, 'src-tauri', 'migrations', f)), recorded: checksums[f] }));
    const ceiling = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf8').match(/CURRENT_SCHEMA_VERSION[^=]*=\s*(\d+)/)?.[1];
    return {
      pass: identity.head.commit === PINNED_COMMIT && identity.indexMatchesPinnedTree && outside.length === 0 && migrations.length === 14 && migrations.every(m => m.sha256 === m.recorded) && ceiling === '14',
      method: 'read-only reads of .git (HEAD, refs, index) and worktree bytes; no git process was started',
      head: identity.head.commit,
      headRef: identity.head.ref,
      pinnedCommit: PINNED_COMMIT,
      indexEntries: identity.indexEntries,
      indexMatchesPinnedTree: identity.indexMatchesPinnedTree,
      pinnedTree: identity.pinnedTree,
      changedPaths: identity.changed,
      outsideAllowedPaths: outside,
      buildOutputSetAside: identity.buildOutput,
      buildOutputNotRecognized: identity.refusedBuildOutput,
      migrations,
      sourceCeiling: Number(ceiling),
      helperSha256: helperShaBefore,
      nodeModules: { link: (() => { try { return fs.readlinkSync(path.join(REPO, 'node_modules')).replace(/.*\/runtime\//, '<runtime>/'); } catch { return 'not a link'; } })(), packageLockSha256: fileSha(path.join(REPO, 'package-lock.json')) },
    };
  });

  stage('source-walker-sensitivity', 'on disposable trees, genuine Cargo/Tauri build output is set aside while unexpected source and changed protected files are reported', () => {
    const dir = path.join(scratch, 'walker');
    fs.mkdirSync(dir);
    const cases = walkerSensitivity(dir);
    return { pass: cases.length === 15 && cases.every(c => c.pass), cases };
  });

  stage('distributed-helper-lane','the distributed schema-14 helper has one fixed operator lane and no test route; its CLI refuses here and writes nothing', () => {
    const source = fs.readFileSync(HELPER14, 'utf8');
    const region = source.slice(source.indexOf(LANE_BEGIN), source.indexOf(LANE_END));
    const outsideRegion = source.replace(region, '');
    const forbidden = ['testContext', 'internalTestFixture', 'scratchLane', 'selectedScratchLane', 'process.env'].filter(t => source.includes(t));
    const laneFixed = region.includes('return Object.freeze({ profile: APPROVED.root, uid: APPROVED.uid, inspect: inspectAppProcesses, isolate: guardOperatorIsolation, operator: true });')
      && /function takeSnapshot\(\) \{\n {2}fail\(/.test(region) && (region.match(/^function /gm) ?? []).length === 2;
    const laneCalls = (outsideRegion.match(/= operatorLane\(\);/g) ?? []).length;
    const out = path.join(scratch, 'distributed-snapshot.json');
    const cliSnapshot = run(process.execPath, [HELPER14, 'snapshot', '--json', out]);
    const cliSelfCheck = run(process.execPath, [HELPER14, 'self-check']);
    return {
      pass: forbidden.length === 0 && laneFixed && laneCalls === 1 && !/^\s*export\s/m.test(source)
        && cliSnapshot.exit === 2 && /^REFUSED: /.test(cliSnapshot.stderr) && !fs.existsSync(out)
        && cliSelfCheck.exit === 2 && /runs only in a disposable repository copy/.test(cliSelfCheck.stderr),
      forbiddenTokens: forbidden,
      laneRegionIsTheApprovedLane: laneFixed,
      operatorLaneCallsOutsideRegion: laneCalls,
      cliSnapshot: { command: cliSnapshot.command.replace(scratch, '<scratch>'), exit: cliSnapshot.exit, refusal: cliSnapshot.stderr.split('\n')[0], wroteReceipt: fs.existsSync(out) },
      cliSelfCheck: { exit: cliSelfCheck.exit, refusal: cliSelfCheck.stderr.split('\n')[0] },
    };
  });

  stage('historical-schema13-self-check', 'live schema-13 helper: every regression passes; the disclosed ceiling alarm is the only failure', () => {
    const r = run(process.execPath, [HELPER13, 'self-check']);
    const report = JSON.parse(r.stdout);
    const failed = report.checks.filter(c => !c.pass).map(c => c.name);
    const special = report.checks.filter(c => /special metadata key/.test(c.name)).map(c => ({ name: c.name, pass: c.pass }));
    return {
      pass: r.exit === 1 && sameList(failed, [HISTORICAL_CEILING_ALARM]) && special.length >= 7 && special.every(c => c.pass),
      command: r.command,
      exit: r.exit,
      counts: report.counts,
      expectedFailure: { name: HISTORICAL_CEILING_ALARM, reason: 'intentional: this historical helper stays bound to schema 13 while accepted source is 14', detail: report.checks.find(c => c.name === HISTORICAL_CEILING_ALARM)?.detail },
      regressionsPassing: report.counts.passed,
      specialKeyChecks: special,
      stdoutSha256: sha256(r.stdout),
    };
  });

  stage('historical-special-key-reversion', 'live schema-13 helper with its own-key map reverted in a disposable copy: exactly the special-key checks fail', () => {
    const live = fs.readFileSync(HELPER13, 'utf8');
    const from = 'const out = Object.create(null);';
    if (live.split(from).length !== 2) throw new Error(`reversion target must match exactly once: ${from}`);
    const dir = path.join(scratch, 'historical-reversion');
    fs.mkdirSync(dir);
    const copy = path.join(dir, 'mac-schema13-profile-snapshot.reverted.mjs');
    fs.writeFileSync(copy, live.replace(from, 'const out = {};'), { flag: 'wx' });
    const r = run(process.execPath, [copy, 'self-check']);
    const report = JSON.parse(r.stdout);
    const failed = report.checks.filter(c => !c.pass).map(c => c.name);
    const specialFailed = failed.filter(n => /special metadata key/.test(n));
    const unrelated = failed.filter(n => !/special metadata key/.test(n) && n !== HISTORICAL_CEILING_ALARM);
    return {
      pass: r.exit === 1 && report.counts.checks === JSON.parse(run(process.execPath, [HELPER13, 'self-check']).stdout).counts.checks
        && specialFailed.length === 6 && specialFailed.some(n => /capture own digests and counts agree/.test(n)) && unrelated.length === 0,
      edit: { from, to: 'const out = {};' },
      copySha256: fileSha(copy),
      exit: r.exit,
      counts: report.counts,
      specialKeyChecksFailed: specialFailed,
      expectedCeilingAlarm: failed.includes(HISTORICAL_CEILING_ALARM),
      unrelatedFailures: unrelated,
    };
  });

  stage('schema14-self-check', 'schema-14 helper self-check, run in a disposable copy: every named source-only regression passes', () => {
    const r = run(process.execPath, [RUNNER, 'self-check']);
    const report = JSON.parse(r.stdout);
    return { pass: r.exit === 0 && report.allPassed === true && report.counts.failed === 0, command: r.command, exit: r.exit, counts: report.counts, failed: report.checks.filter(c => !c.pass).map(c => c.name), stdoutSha256: sha256(r.stdout) };
  });

  stage('pr142-replay', 'all six original PR #142 comparisons replay with their original verdicts and exact diffs; the schema-14 helper refuses them', () => {
    const replays = [];
    for (const f of fs.readdirSync(PR142).filter(n => n.startsWith('cmp-')).sort()) {
      const original = JSON.parse(fs.readFileSync(path.join(PR142, f), 'utf8'));
      const before = path.join(PR142, path.basename(original.before));
      const after = path.join(PR142, path.basename(original.after));
      const r = run(process.execPath, [HELPER13, 'compare', '--before', before, '--after', after, '--purpose', original.purpose]);
      const replay = JSON.parse(r.stdout);
      const refused = run(process.execPath, [HELPER14, 'compare', '--before', before, '--after', after, '--purpose', original.purpose]);
      replays.push({
        receipt: f,
        purpose: original.purpose,
        originalVerdict: original.verdict,
        replayVerdict: replay.verdict,
        exit: r.exit,
        diffsIdentical: JSON.stringify(replay.diffs) === JSON.stringify(original.diffs),
        diffs: replay.diffs,
        schema14: { exit: refused.exit, refusal: refused.stderr.split('\n')[0] },
        pass: replay.verdict === original.verdict && JSON.stringify(replay.diffs) === JSON.stringify(original.diffs) && r.exit === (original.verdict === 'FAIL' ? 1 : 0)
          && refused.exit === 2 && /legacy hfd-mac-profile-snapshot\/3 receipt/.test(refused.stderr),
      });
    }
    const restore = replays.find(x => x.receipt === 'cmp-g3-restore.json');
    return { pass: replays.length === 6 && replays.every(x => x.pass) && restore?.replayVerdict === 'FAIL', replays };
  });

  await stageAsync('installed-schema-anchors', "pinned definitions and SQLx facts equal what the installed app recorded in PR #142", async () => {
    const { H } = await loadCopy();
    const out = [];
    for (const [file, version] of [['s12-populated.json', 12], ['s12-fresh.json', 12], ['s13-restored.json', 13], ['s13-upgraded.json', 13]]) {
      const s = JSON.parse(fs.readFileSync(path.join(PR142, file), 'utf8'));
      const defs = s.schemaObjects.definitions;
      const expected = [...H.PINNED_OBJECT_MAP].filter(([, [, since]]) => since <= version);
      const mismatched = expected.filter(([n, [type, , digest]]) => !defs[n] || defs[n].type !== type || sha256(Buffer.from(defs[n].sql, 'utf8')) !== digest).map(([n]) => n);
      const extra = Object.keys(defs).filter(n => n !== '_sqlx_migrations' && !H.PINNED_OBJECT_MAP.has(n));
      const ledgerDdl = sha256(Buffer.from(defs._sqlx_migrations.sql, 'utf8')) === H.SQLX_LEDGER_DDL_SHA256;
      const rows = s.ledger.rows.map(r => {
        const m = H.PINNED_MIGRATIONS.find(p => String(p.version) === r.version.v);
        return !!m && Buffer.from(r.description.v, 'hex').toString('utf8') === m.description && r.checksum.v.toLowerCase() === m.sqlx && r.success.v === '1' && r.installed_on.t === 'text' && r.execution_time.t === 'integer';
      });
      out.push({ file, version, objects: Object.keys(defs).length, expectedObjects: expected.length + 1, mismatched, extra, ledgerDefinitionMatches: ledgerDdl, ledgerRows: rows.length, ledgerRowsMatchPins: rows.every(Boolean),
        pass: mismatched.length === 0 && extra.length === 0 && ledgerDdl && Object.keys(defs).length === expected.length + 1 && rows.length === version && rows.every(Boolean) });
    }
    return { pass: out.every(x => x.pass), note: 'read-only comparison of committed PR #142 receipts; no installed app or profile was opened', snapshots: out };
  });

  const REGRESSION_NAMES = Object.keys(REGRESSIONS);
  await stageAsync('fixture-proofs', 'disposable fixture proofs and named regressions on a pristine helper copy', async () => {
    const { H, copySha256 } = await loadCopy();
    const results = {};
    for (const name of REGRESSION_NAMES) results[name] = runRegression(H, name);

    // Populated 13 -> 14 upgrade, 12/13/14 archive-state restores, and schema-14 invariance.
    const proofs = {};
    {
      const { s13, s14 } = upgraded(H);
      const c = H.compare({ before: s13, after: s14, purpose: 'upgrade' });
      proofs.upgrade13to14 = { verdict: c.verdict, seeded: c.sections.tables.seededAdditions, empty: c.sections.tables.emptyAdditions, retainedChanged: c.sections.tables.changed, filesCompared: c.sections.files.before, receiptExclusion: c.receiptExclusion,
        pass: c.verdict === 'PASS' && sameList(c.sections.tables.seededAdditions, ['skill_catalog_entries', 'skill_catalog_revisions']) && c.sections.tables.emptyAdditions.length === 4 && c.receiptExclusion.applied === false };
    }
    for (const version of [12, 13]) {
      const lib = newLib(H, { version });
      H.setMetadata(lib.dbPath, SPECIAL);
      const archive = H.cloneScratchProfile(lib.root, path.join(scratch, `archive-${version}-${crypto.randomUUID()}`));
      H.setMetadata(lib.dbPath, RECEIPT_ROWS);
      const postExport = snapOf(H, lib, 'post-export');
      fs.copyFileSync(archive.dbPath, lib.dbPath);
      H.withDb(lib.dbPath, db => H.applyShippedMigrations(db, REPO, version + 1, 14));
      const c = H.compare({ before: postExport, after: snapOf(H, lib, 'restored'), purpose: 'restore' });
      proofs[`restore${version}to14`] = { verdict: c.verdict, diffs: c.diffs, backupReceipt: c.sections.backupReceipt, empty: c.sections.tables.emptyAdditions, notes: c.notes,
        pass: c.verdict === 'PASS' && c.sections.backupReceipt.receiptOnlyDifference === true && sameList(c.sections.backupReceipt.receiptKeysBefore, H.BACKUP_RECEIPT_KEYS) };
    }
    {
      const lib = newLib(H, { version: 14, writerEvidence: true });
      H.setMetadata(lib.dbPath, SPECIAL);
      const base = snapOf(H, lib, 'base');
      const again = H.compare({ before: base, after: snapOf(H, lib, 'again'), purpose: 'unchanged' });
      const archive = H.cloneScratchProfile(lib.root, path.join(scratch, `archive-14-${crypto.randomUUID()}`));
      H.setMetadata(lib.dbPath, RECEIPT_ROWS);
      const postExport = snapOf(H, lib, 'post-export');
      fs.copyFileSync(archive.dbPath, lib.dbPath);
      const restore = H.compare({ before: postExport, after: snapOf(H, lib, 'restored'), purpose: 'restore' });
      const m3 = JSON.parse(fs.readFileSync(base, 'utf8')).m3Evidence;
      const tampers = {};
      for (const [name, sql, table] of [
        ['observation', "UPDATE skill_observations SET wording = 'Altered.'", 'skill_observations'],
        ['revision', "INSERT INTO skill_observation_revisions SELECT observation_id, revision + 100, 'edited', wording, observed_on, attribution, instructor_name, linked_action_id, linked_action_title, addressed_at, operation_id, recorded_at FROM skill_observation_revisions LIMIT 1", 'skill_observation_revisions'],
        ['self-assessment', "INSERT INTO skill_self_assessments SELECT 'extra-' || id, skill_id, kind, status, confidence, sequence + 100, operation_id, set_at FROM skill_self_assessments LIMIT 1", 'skill_self_assessments'],
        ['tombstone', "UPDATE skill_evidence_operations SET applied_at = '2030-01-01T00:00:00.000Z' WHERE is_erased = 1", 'skill_evidence_operations'],
        ['custom skill', "UPDATE skill_catalog_entries SET description = 'Edited.' WHERE origin = 'custom'", 'skill_catalog_entries'],
        ['explicit link', "UPDATE skill_observations SET linked_action_id = '20000000-0000-4000-8000-000000000002', linked_action_title = 'Review flare timing', action_id = '20000000-0000-4000-8000-000000000002'", 'skill_observations'],
      ]) {
        fs.copyFileSync(archive.dbPath, lib.dbPath);
        H.withDb(lib.dbPath, db => db.exec(sql));
        const c = H.compare({ before: base, after: snapOf(H, lib, `tamper-${name}`), purpose: 'unchanged' });
        tampers[name] = { verdict: c.verdict, changed: c.sections.tables.changed, pass: c.verdict === 'FAIL' && sameList(c.sections.tables.changed, [table]) };
      }
      proofs.writerPopulated14 = { m3Evidence: m3, unchanged: again.verdict, restore: restore.verdict, restoreReceipt: restore.sections.backupReceipt, tampers,
        pass: again.verdict === 'PASS' && restore.verdict === 'PASS' && restore.sections.backupReceipt.receiptOnlyDifference === true && Object.values(tampers).every(t => t.pass)
          && m3.observations >= 1 && m3.erasedOperations >= 1 && m3.statusAssessments >= 1 && m3.confidenceAssessments >= 1 };
    }
    return {
      pass: Object.values(results).every(r => r.pass) && Object.values(proofs).every(p => p.pass),
      copySha256,
      helperSha256: fileSha(HELPER14),
      regressions: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v])),
      proofs,
    };
  });

  await stageAsync('guard-reversions', 'removing each named guard from a disposable copy fails its named regression; the control still passes', async () => {
    const reversions = [];
    for (const r of REVERSIONS) {
      const { H, copySha256 } = await loadCopy({ from: r.from, to: r.to });
      const control = runRegression(H, 'control-genuine-upgrade');
      const target = runRegression(H, r.regression);
      reversions.push({
        guard: r.id,
        regression: r.regression,
        edit: { from: r.from, to: r.to },
        copySha256,
        controlPassed: control.pass === true,
        regressionFailed: target.pass === false && !target.startupOrRuntimeError,
        observed: target,
        pass: control.pass === true && target.pass === false && !target.startupOrRuntimeError,
      });
    }
    return { pass: reversions.length === REVERSIONS.length && reversions.every(x => x.pass), helperSha256Unchanged: fileSha(HELPER14) === helperShaBefore.schema14, reversions };
  });

  stage('production-writers-and-validator', 'permanent vitest regression: production M3 writer and validateApplicationDatabase against the helper', () => {
    const report = path.join(scratch, 'vitest-report.json');
    const r = run(process.execPath, [path.join('node_modules', 'vitest', 'vitest.mjs'), 'run', '--configLoader', 'runner', '--no-cache', '--reporter=json', `--outputFile=${report}`, 'src/logic/currentSchemaVerification.test.ts']);
    const json = JSON.parse(fs.readFileSync(report, 'utf8'));
    const tests = json.testResults.flatMap(f => f.assertionResults.map(a => ({ name: a.fullName, status: a.status })));
    return { pass: r.exit === 0 && json.numFailedTests === 0 && json.numPassedTests === tests.length && tests.length >= 8, command: r.command.replace(scratch, '<scratch>'), exit: r.exit, counts: { total: json.numTotalTests, passed: json.numPassedTests, failed: json.numFailedTests }, tests };
  });

  stage('protected-sources-unchanged', 'helpers, PR #142 evidence, frozen kit, migrations and fixtures are byte-identical after the run', () => {
    const after = protectedHashes();
    const differing = Object.keys({ ...protectedBefore, ...after }).filter(k => protectedBefore[k] !== after[k]);
    const helpersAfter = { schema13: fileSha(HELPER13), schema14: fileSha(HELPER14) };
    const tree = changedPaths();
    const changed = tree.changed.filter(c => !ALLOWED_CHANGES.has(c.path) && !INFRASTRUCTURE.has(c.path));
    return { pass: differing.length === 0 && JSON.stringify(helpersAfter) === JSON.stringify(helperShaBefore) && changed.length === 0, filesChecked: Object.keys(after).length, differing, helpersAfter, frozenKitFinalHelperSha256: after['docs/evidence/mac-schema13-final-corrections-2026-10-10/final-helper.mjs'], outsideAllowedPaths: changed, buildOutputSetAside: tree.buildOutput, buildOutputNotRecognized: tree.refusedBuildOutput };
  });

  /* ------------------------------------------------------------------ *
   * Receipt (exclusive write to a fresh temporary directory)
   * ------------------------------------------------------------------ */

  fs.rmSync(scratch, { recursive: true, force: true });
  const receiptDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hfd-schema14-proof-receipt-'));
  const receiptPath = path.join(receiptDir, 'proof-receipt.json');
  const passed = stages.filter(s => s.pass).length;
  const receipt = {
    schema: 'hfd-schema14-verification-proof/1',
    runner: { node: process.version, platform: `${process.platform}-${process.arch}`, cwd: '<repo>', startedAt: new Date(started).toISOString(), durationMs: Date.now() - started },
    pinnedCommit: PINNED_COMMIT,
    boundaries: {
      syntheticSqlxLedger: 'scratch libraries carry a ledger written by the helper scratch builder with SQLx\'s exact table definition, the shipped descriptions and SQLx SHA-384 checksums; it is not written by SQLx; stage installed-schema-anchors compares the pins with the genuine installed ledger recorded in PR #142',
      restores: 'archive-state fidelity: closed database copies are put back in place and migrated; no native backup archive or native restore path was exercised',
      productionCode: 'stage production-writers-and-validator runs the TypeScript production M3 writer and validateApplicationDatabase on node:sqlite; the native Rust validator and SQLx migrator were not run',
      installedApp: 'not launched, installed or inspected; no real profile was read',
      schema14Installer: 'unavailable: no schema-14 installer, hash, version or lane exists; nothing was constructed',
    },
    summary: { stages: stages.length, passed, failed: stages.length - passed },
    verdict: passed === stages.length ? 'PASS' : 'FAIL',
    stages,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`${receipt.verdict}: ${passed}/${stages.length} stages; receipt ${receiptPath}`);
  process.exitCode = receipt.verdict === 'PASS' ? 0 : 1;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(RUNNER);
if (invokedDirectly) {
  requireRepositoryRoot();
  const command = process.argv[2];
  if (command === 'self-check') selfCheckCommand();
  else if (command === undefined) await proof();
  else { console.error(`REFUSED: unknown command ${command} (use no argument, or self-check)`); process.exit(2); }
}
