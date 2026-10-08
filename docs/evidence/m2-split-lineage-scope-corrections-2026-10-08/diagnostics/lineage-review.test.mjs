import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapChildPageToSource, createDisposableLineageDb, insertMaterial, insertSplitLineage, getMaterialWithLineage } from '../proof/lineageContract.mjs';

const seed = () => {
  const db = createDisposableLineageDb();
  insertMaterial(db, { id: 'p', title: 'Parent' });
  insertMaterial(db, { id: 'c', title: 'Child' });
  return db;
};

const row = (o = {}) => ({
  materialId: 'c',
  parentMaterialId: 'p',
  rootMaterialId: 'p',
  sourcePageStart: 101,
  sourcePageEnd: 300,
  sourceFileName: 'p.pdf',
  sourceTitle: 'Parent',
  sourceTotalPages: 400,
  ...o,
});

test('[control] valid child mapping remains one-based', () => {
  assert.equal(mapChildPageToSource(1, 101, 300), 101);
});

test('[control] deleting parent preserves child and provenance', () => {
  const db = seed();
  try {
    insertSplitLineage(db, row());
    db.prepare("DELETE FROM study_materials WHERE id='p'").run();
    const c = getMaterialWithLineage(db, 'c');
    assert.equal(c.lineage.sourcePageStart, 101);
    assert.equal(c.lineage.parentMaterialId, null);
  } finally {
    db.close();
  }
});

test('[SL-R2] child page beyond the recorded range must be refused', () => {
  assert.throws(() => mapChildPageToSource(201, 101, 300));
});

test('[SL-R2] SQL must refuse fractional physical page bounds', () => {
  const db = seed();
  try {
    assert.throws(() => insertSplitLineage(db, row({ sourcePageStart: 101.5 })));
  } finally {
    db.close();
  }
});

test('[SL-R2] SQL must refuse a lineage row without child material identity', () => {
  const db = seed();
  try {
    assert.throws(() => insertSplitLineage(db, row({ materialId: null })));
  } finally {
    db.close();
  }
});

test('[SL-R2] a split child cannot also be its own original root', () => {
  const db = seed();
  try {
    assert.throws(() => insertSplitLineage(db, row({ rootMaterialId: 'c' })));
  } finally {
    db.close();
  }
});

test('[SL-R3] disposable database claiming shipped schema must expose actual attempt/state tables', () => {
  const db = createDisposableLineageDb(false);
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(names.includes('practice_attempts'), 'actual migration 0011 practice_attempts is missing');
    assert.ok(names.includes('card_review_state'), 'actual migration 0012 card_review_state is missing');
    assert.ok(!names.includes('practice_sessions'), 'invented practice_sessions must not replace shipped attempts');
  } finally {
    db.close();
  }
});
