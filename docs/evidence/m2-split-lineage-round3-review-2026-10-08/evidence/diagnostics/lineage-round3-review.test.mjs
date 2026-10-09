// Reviewer diagnostic for the round-3 split-lineage submission (SL-R10–SL-R11).
// Supersedes lineage-round2-review.test.mjs: every source here has a real file on disk, because a
// split always reads a stored PDF. Cases labelled control pass on the submission; [SL-R*] cases must
// fail on the submission and pass after correction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, existsSync, rmSync, unlinkSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDisposableLineageDb, insertMaterial, insertSplitLineage, calculateSha256, validateAndSaveSplitBatch, createSplitSourceReceipt, cancelBatch} from '../../m2-split-lineage-scope-round3-2026-10-08/proof/lineageContract.mjs';

const CANDIDATE_DDL = readFileSync(fileURLToPath(new URL('../../m2-split-lineage-scope-round3-2026-10-08/candidate_migration_0013.sql', import.meta.url)), 'utf8');
let dir;
const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;
function setup(fn) {
  dir = mkdtempSync(join(tmpdir(), 'slr4-'));
  const db = createDisposableLineageDb();
  try {
    const root = join(dir, 'root.pdf');
    writeFileSync(root, 'root edition one');
    insertMaterial(db, {id: 'R', title: 'Root', filePath: root});
    return fn(db, root);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
}
function persistA(db) {
  const a = join(dir, 'a.pdf');
  writeFileSync(a, 'parent A edition one');
  insertMaterial(db, {id: 'A', title: 'Parent A', filePath: a});
  insertSplitLineage(db, {materialId: 'A', parentMaterialId: null, rootMaterialId: 'R', sourcePageStart: 101, sourcePageEnd: 300, sourceTotalPages: 400, sourceTitle: 'Root', sourceFileName: 'root.pdf', sourceContentSha256: calculateSha256('root edition one')});
  return a;
}
const plan = (id, start, end) => [{id, title: id, selection: {start, end}}];

test('control: a receipt-based direct save persists the receipt hash and total', () => setup((db) => {
  const receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: plan('c', 1, 10)});
  validateAndSaveSplitBatch(db, {receipt});
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE material_id='c' AND source_content_sha256=? AND source_total_pages=400", calculateSha256('root edition one')), 1);
}));

test('control: a receipt-based nested save derives R120–140', () => setup((db) => {
  persistA(db);
  validateAndSaveSplitBatch(db, {receipt: createSplitSourceReceipt(db, {sourceMaterialId: 'A', sourceTotalPages: 200, plan: plan('B', 20, 40)})});
  assert.deepEqual({...db.prepare("SELECT source_page_start s, source_page_end e FROM material_split_lineage WHERE material_id='B'").get()}, {s: 120, e: 140});
}));

test('control: a source file replaced between receipt and save is refused', () => setup((db, root) => {
  const receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: plan('c', 1, 10)});
  writeFileSync(root, 'root edition two');
  assert.throws(() => validateAndSaveSplitBatch(db, {receipt}));
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 0);
}));

test('control: saving the same receipt twice replays without new rows', () => setup((db) => {
  const receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: plan('c', 1, 10)});
  validateAndSaveSplitBatch(db, {receipt});
  assert.equal(validateAndSaveSplitBatch(db, {receipt}).idempotentReplay, true);
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 1);
}));

test('control: a mid-transaction failure with a receipt rolls back and cleans up exactly once', () => setup((db) => {
  db.exec("CREATE TRIGGER inj BEFORE INSERT ON material_split_lineage WHEN NEW.material_id='later' BEGIN SELECT RAISE(FAIL,'injected'); END");
  const receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: [...plan('c', 1, 10), ...plan('later', 11, 20)]});
  let calls = 0;
  assert.throws(() => validateAndSaveSplitBatch(db, {receipt, onRollbackCleanup: () => { calls++; }}), /injected/);
  assert.equal(calls, 1);
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id IN ('c','later')"), 0);
}));

test('[SL-R10] a save without a receipt is refused, even with matching expected hash and bytes', () => setup((db) => {
  const bytes = Buffer.from('root edition one');
  assert.throws(() => validateAndSaveSplitBatch(db, {parentMaterialId: 'R', expectedParentSha256: calculateSha256(bytes), currentParentBytes: bytes, parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 10}]}));
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 0);
}));

test('[SL-R10] a recorded source file that is missing cannot be replaced by caller bytes', () => setup((db, root) => {
  unlinkSync(root);
  let receipt = null;
  try { receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceBytes: Buffer.from('anything'), sourceTotalPages: 400, plan: plan('c', 1, 10)}); } catch {}
  if (receipt) { try { validateAndSaveSplitBatch(db, {receipt}); } catch {} }
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 0);
}));

test('[SL-R10] an edited receipt (total and plan) is not accepted as authoritative', () => setup((db) => {
  const real = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: plan('c', 1, 10)});
  const edited = {...real, sourceTotalPages: 9000, plan: [{...real.plan[0], selection: {start: 1, end: 5000}, childPageCount: 5000, canonicalRootEnd: 5000}]};
  try { validateAndSaveSplitBatch(db, {receipt: edited}); } catch {}
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE source_page_end > 400"), 0);
}));

test('[SL-R10] caller parts cannot replace the receipt plan', () => setup((db) => {
  const receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: plan('c', 1, 10)});
  try { validateAndSaveSplitBatch(db, {receipt, parts: [{id: 'c', title: 'c', selection: {start: 1, end: 300}}]}); } catch {}
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE material_id='c' AND source_page_end <> 10"), 0);
}));

test('[SL-R10] the nested parent snapshot in the receipt is compared at save time', () => setup((db) => {
  persistA(db);
  const receipt = createSplitSourceReceipt(db, {sourceMaterialId: 'A', sourceTotalPages: 200, plan: plan('B', 20, 40)});
  db.prepare("UPDATE material_split_lineage SET source_page_start=111, source_page_end=310 WHERE material_id='A'").run();
  try { validateAndSaveSplitBatch(db, {receipt}); } catch {}
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE material_id='B'"), 0);
}));

test('[SL-R11] the operation log is part of the candidate DDL, not the shipped baseline', () => {
  const db = createDisposableLineageDb(false);
  try {
    assert.equal(count(db, "SELECT COUNT(*) n FROM sqlite_master WHERE name='split_operation_log'"), 0);
    db.exec(CANDIDATE_DDL);
    assert.equal(count(db, "SELECT COUNT(*) n FROM sqlite_master WHERE name='split_operation_log'"), 1);
  } finally { db.close(); }
});

test('[SL-R11] cancelling before commit removes this operation\'s staged file', () => {
  const d = mkdtempSync(join(tmpdir(), 'slr4-cancel-'));
  try {
    const staged = join(d, 'staged-part.pdf');
    writeFileSync(staged, 'staged');
    cancelBatch('op-before', [staged], false);
    assert.equal(existsSync(staged), false);
  } finally { rmSync(d, {recursive: true, force: true}); }
});
