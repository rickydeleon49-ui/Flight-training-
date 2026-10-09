// Reviewer diagnostic for the round-4 split-lineage submission (SL-R12–SL-R13).
// Every source has a real file. Controls pass on the submission; [SL-R*] cases fail on it and must pass after correction.
// Uses only the receipt API (createSplitSourceReceipt / validateAndSaveSplitBatch / reconcileBatch / cancelBatch(db, operationId)).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, existsSync, rmSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDisposableLineageDb, insertMaterial, insertSplitLineage, calculateSha256, validateAndSaveSplitBatch, createSplitSourceReceipt, reconcileBatch, cancelBatch} from '../../m2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs';

let dir;
const one = (db, sql, ...a) => db.prepare(sql).get(...a);
function setup(fn) {
  dir = mkdtempSync(join(tmpdir(), 'slr5-'));
  const db = createDisposableLineageDb();
  try {
    const root = join(dir, 'root.pdf');
    writeFileSync(root, 'root edition one');
    insertMaterial(db, {id: 'R', title: 'Root', filePath: root, originalFileName: 'root.pdf'});
    return fn(db, root);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
}
function persistA(db) {
  const a = join(dir, 'a.pdf');
  writeFileSync(a, 'parent A edition one');
  insertMaterial(db, {id: 'A', title: 'Parent A', filePath: a, originalFileName: 'a.pdf'});
  insertSplitLineage(db, {materialId: 'A', parentMaterialId: null, rootMaterialId: 'R', sourcePageStart: 101, sourcePageEnd: 300, sourceTotalPages: 400, sourceTitle: 'Root', sourceFileName: 'root.pdf', sourceContentSha256: calculateSha256('root edition one')});
}
const plan = (id, start, end, filePath = null) => [{id, title: id, selection: {start, end}, ...(filePath ? {filePath} : {})}];
const receiptFor = (db, id = 'c', extra = {}) => createSplitSourceReceipt(db, {sourceMaterialId: 'R', sourceTotalPages: 400, plan: plan(id, 1, 10), ...extra});

test('control: nested receipt save derives R120–140 and records the parent hash of the bytes split', () => setup((db) => {
  persistA(db);
  validateAndSaveSplitBatch(db, {receipt: createSplitSourceReceipt(db, {sourceMaterialId: 'A', sourceTotalPages: 200, plan: plan('B', 20, 40)})});
  const row = one(db, "SELECT source_page_start s, source_page_end e, parent_content_sha256 h FROM material_split_lineage WHERE material_id='B'");
  assert.deepEqual({...row}, {s: 120, e: 140, h: calculateSha256('parent A edition one')});
}));

test('control: an edited receipt and a drifted nested snapshot are both refused', () => setup((db) => {
  const r = receiptFor(db);
  assert.throws(() => validateAndSaveSplitBatch(db, {receipt: {...r, sourceTotalPages: 9000}}));
  persistA(db);
  const nested = createSplitSourceReceipt(db, {sourceMaterialId: 'A', sourceTotalPages: 200, plan: plan('B', 20, 40)});
  db.prepare("UPDATE material_split_lineage SET source_page_start=111, source_page_end=310 WHERE material_id='A'").run();
  assert.throws(() => validateAndSaveSplitBatch(db, {receipt: nested}));
}));

test('control: receipt replay after commit returns the persisted parts', () => setup((db) => {
  const r = receiptFor(db);
  validateAndSaveSplitBatch(db, {receipt: r});
  assert.equal(validateAndSaveSplitBatch(db, {receipt: r}).idempotentReplay, true);
  assert.equal(reconcileBatch(db, r.operationId).reconciled, true);
}));

test('control: cancelling a pending operation deletes its recorded staged file and blocks its save', () => setup((db) => {
  const staged = join(dir, 'c.pdf');
  writeFileSync(staged, 'staged part');
  const r = receiptFor(db, 'c', {plan: plan('c', 1, 10, staged)});
  cancelBatch(db, r.operationId);
  assert.equal(existsSync(staged), false);
  assert.throws(() => validateAndSaveSplitBatch(db, {receipt: r}));
}));

test('[SL-R12] a nested part records the immediate parent (not the root) in its parent tier', () => setup((db) => {
  persistA(db);
  validateAndSaveSplitBatch(db, {receipt: createSplitSourceReceipt(db, {sourceMaterialId: 'A', sourceTotalPages: 200, plan: plan('B', 20, 40)})});
  const row = one(db, "SELECT parent_title t, parent_file_name f, source_title rt, source_file_name rf FROM material_split_lineage WHERE material_id='B'");
  assert.deepEqual({...row}, {t: 'Parent A', f: 'a.pdf', rt: 'Root', rf: 'root.pdf'});
}));

test('[SL-R12] re-issuing an identical receipt never resets a committed operation', () => setup((db) => {
  const r = receiptFor(db);
  validateAndSaveSplitBatch(db, {receipt: r});
  try { receiptFor(db); } catch {}
  assert.equal(one(db, 'SELECT status s FROM split_operation_log WHERE operation_id=?', r.operationId).s, 'committed');
  assert.equal(reconcileBatch(db, r.operationId).reconciled, true);
}));

test('[SL-R12] re-issuing an identical receipt never revives a cancelled operation', () => setup((db) => {
  const staged = join(dir, 'c.pdf');
  writeFileSync(staged, 'staged part');
  const r = receiptFor(db, 'c', {plan: plan('c', 1, 10, staged)});
  cancelBatch(db, r.operationId);
  let again = null;
  try { again = receiptFor(db, 'c', {plan: plan('c', 1, 10, staged)}); } catch {}
  if (again) { try { validateAndSaveSplitBatch(db, {receipt: again}); } catch {} }
  assert.equal(one(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'").n, 0);
}));

test('[SL-R13] cancellation deletes only files recorded by the operation, never caller-listed paths', () => {
  const d = mkdtempSync(join(tmpdir(), 'slr5-cancel-'));
  try {
    const unrelated = join(d, 'someone-elses.pdf');
    writeFileSync(unrelated, 'not staged by any operation');
    try { cancelBatch('no-such-operation', [unrelated], false); } catch {}
    assert.equal(existsSync(unrelated), true);
  } finally { rmSync(d, {recursive: true, force: true}); }
});
