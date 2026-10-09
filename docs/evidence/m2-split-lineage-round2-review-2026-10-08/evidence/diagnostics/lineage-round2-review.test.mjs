// Reviewer diagnostic for the round-2 split-lineage submission (SL-R7–SL-R9).
// Every case not labelled control or guard asserts the behaviour the round-2 prompt requires; each fails on the submission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDisposableLineageDb, insertMaterial, insertSplitLineage, getMaterialWithLineage, listSiblings, calculateSha256, validateAndSaveSplitBatch} from '../../m2-split-lineage-scope-round2-2026-10-08/proof/lineageContract.mjs';

const rootBytes = Buffer.from('root edition one');
const H = calculateSha256(rootBytes);
const aBytes = Buffer.from('parent A edition one');
const HA = calculateSha256(aBytes);
const forged = calculateSha256('forged edition');
const count = (db, sql) => db.prepare(sql).get().n;
function withDb(fn) { const db = createDisposableLineageDb(); try { insertMaterial(db, {id: 'R', title: 'Root'}); return fn(db); } finally { db.close(); } }
// Persisted A = R pages 101–300 of 400, with a known parent-tier snapshot.
function persistA(db, extra = {}) {
  insertMaterial(db, {id: 'A', title: 'Parent A'});
  insertSplitLineage(db, {materialId: 'A', parentMaterialId: 'R', rootMaterialId: 'R', sourcePageStart: 101, sourcePageEnd: 300, sourceTotalPages: 400, sourceTitle: 'Root', sourceFileName: 'root.pdf', sourceContentSha256: H, ...extra});
}
const nestedPart = (id, o = {}) => ({id, title: id, parentPageStart: 20, parentPageEnd: 40, ...o});

test('control: verified direct save with matching bytes persists the verified hash', () => withDb((db) => {
  const r = validateAndSaveSplitBatch(db, {parentMaterialId: 'R', expectedParentSha256: H, currentParentBytes: rootBytes, parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 400}]});
  assert.equal(r.savedPartsCount, 1);
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE material_id='c' AND source_content_sha256='" + H + "'"), 1);
}));

test('control: verified nested save derives canonical R120–140 from persisted A101–300', () => withDb((db) => {
  persistA(db);
  validateAndSaveSplitBatch(db, {parentMaterialId: 'A', expectedParentSha256: HA, currentParentBytes: aBytes, parts: [nestedPart('B')]});
  const row = db.prepare("SELECT source_page_start s, source_page_end e, child_page_count n, root_material_id r FROM material_split_lineage WHERE material_id='B'").get();
  assert.deepEqual({...row}, {s: 120, e: 140, n: 21, r: 'R'});
}));

test('[SL-R7] a new split without any verified source identity refuses all writes', () => withDb((db) => {
  assert.throws(() => validateAndSaveSplitBatch(db, {parentMaterialId: 'R', parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 10, sourceContentSha256: forged}]}));
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 0);
}));

test('[SL-R7] a caller hash cannot replace the hash of the bytes actually verified (direct)', () => withDb((db) => {
  try { validateAndSaveSplitBatch(db, {parentMaterialId: 'R', expectedParentSha256: H, currentParentBytes: rootBytes, parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 400, sourceContentSha256: forged}]}); } catch {}
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE source_content_sha256='" + forged + "'"), 0);
}));

test('[SL-R7] nested parts cannot override the persisted root hash or the verified parent hash', () => withDb((db) => {
  persistA(db);
  try { validateAndSaveSplitBatch(db, {parentMaterialId: 'A', expectedParentSha256: HA, currentParentBytes: aBytes, parts: [nestedPart('B', {sourceContentSha256: forged, parentContentSha256: forged})]}); } catch {}
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE material_id='B' AND (source_content_sha256='" + forged + "' OR parent_content_sha256='" + forged + "')"), 0);
}));

test('[SL-R7] a direct range is bounded by the authoritative source total, not an optional caller field', () => withDb((db) => {
  assert.throws(() => validateAndSaveSplitBatch(db, {parentMaterialId: 'R', expectedParentSha256: H, currentParentBytes: rootBytes, parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 9000}]}));
  assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 0);
}));

test('[SL-R7] stale on-disk source: an old caller Buffer cannot prove the current file is unchanged', () => withDb((db) => {
  const dir = mkdtempSync(join(tmpdir(), 'slr3-'));
  try {
    const file = join(dir, 'root.pdf');
    writeFileSync(file, 'root edition two (replaced on disk)');
    db.prepare("UPDATE study_materials SET file_path=? WHERE id='R'").run(file);
    assert.throws(() => validateAndSaveSplitBatch(db, {parentMaterialId: 'R', expectedParentSha256: H, currentParentBytes: rootBytes, parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 400}]}));
    assert.equal(count(db, "SELECT COUNT(*) n FROM study_materials WHERE id='c'"), 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
}));

test('guard: after the historical root is deleted, the immediate parent is never recorded as the root', () => withDb((db) => {
  persistA(db);
  db.prepare("DELETE FROM study_materials WHERE id='R'").run();
  try { validateAndSaveSplitBatch(db, {parentMaterialId: 'A', expectedParentSha256: HA, currentParentBytes: aBytes, parts: [nestedPart('B')]}); } catch {}
  assert.equal(count(db, "SELECT COUNT(*) n FROM material_split_lineage WHERE material_id='B' AND root_material_id='A'"), 0);
}));

test('[SL-R8] a nested part with an unknown parent hash is not certified by matching root bytes', () => withDb((db) => {
  persistA(db);
  insertMaterial(db, {id: 'B', title: 'B'});
  insertSplitLineage(db, {materialId: 'B', parentMaterialId: 'A', rootMaterialId: 'R', sourcePageStart: 120, sourcePageEnd: 140, parentPageStart: 20, parentPageEnd: 40, sourceTotalPages: 400, parentTotalPages: 200, sourceTitle: 'Root', sourceFileName: 'root.pdf', sourceContentSha256: H, nestedLevel: 2});
  assert.equal(getMaterialWithLineage(db, 'B', {currentFileBytes: rootBytes}).lineage.parentStatus, 'unknown');
}));

test('[SL-R8] unknown parent editions are not grouped as siblings through the root hash', () => withDb((db) => {
  persistA(db);
  for (const [id, s, e] of [['B1', 20, 40], ['B2', 41, 60]]) {
    insertMaterial(db, {id, title: id});
    insertSplitLineage(db, {materialId: id, parentMaterialId: 'A', rootMaterialId: 'R', sourcePageStart: 100 + s, sourcePageEnd: 100 + e, parentPageStart: s, parentPageEnd: e, sourceTotalPages: 400, parentTotalPages: 200, sourceTitle: 'Root', sourceFileName: 'root.pdf', sourceContentSha256: H, nestedLevel: 2});
  }
  assert.deepEqual(listSiblings(db, 'B1').map((x) => x.id), []);
}));

test('[SL-R9] a mid-transaction failure runs this operation\'s cleanup exactly once', () => withDb((db) => {
  db.exec("CREATE TRIGGER inj BEFORE INSERT ON material_split_lineage WHEN NEW.material_id='later' BEGIN SELECT RAISE(FAIL,'injected'); END");
  let calls = 0;
  assert.throws(() => validateAndSaveSplitBatch(db, {parentMaterialId: 'R', expectedParentSha256: H, currentParentBytes: rootBytes, parts: [{id: 'c', title: 'c', sourcePageStart: 1, sourcePageEnd: 10, sourceTotalPages: 400}, {id: 'later', title: 'later', sourcePageStart: 11, sourcePageEnd: 20, sourceTotalPages: 400}], onRollbackCleanup: () => { calls++; }}), /injected/);
  assert.equal(calls, 1);
}));
