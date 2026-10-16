import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const pack = process.env.M4_REVIEW_TARGET_PACK || path.join(path.dirname(fileURLToPath(import.meta.url)), 'submitted-pack');
const { DocumentPersistenceProtocol } = await import(pathToFileURL(pack + '/proof/persistenceProtocol.mjs'));
const { validateTraceability } = await import(pathToFileURL(pack + '/scripts/evidenceChecks.mjs'));
const hash = 'a'.repeat(64);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE study_materials(id TEXT PRIMARY KEY NOT NULL); INSERT INTO study_materials VALUES ('m');");
  const p = new DocumentPersistenceProtocol(db);
  p.applyCandidateDdl(fs.readFileSync(pack + '/candidate/candidate_migration_0015.sql', 'utf8'));
  p.replaceContentIdentity('m', hash, 50);
  return { db, p, dest: {materialId:'m', contentSha256:hash, physicalPage:5, totalPages:50, pageLabel:'v'} };
}
test('reservation database failure must not return an unpersisted token', () => {
  const { db,p } = fixture();
  try {
    p.reserveOperationOwnership('m');
    db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, 'claim write blocked'); END;");
    assert.throws(() => p.reserveOperationOwnership('m'), /claim write blocked/);
  } finally { db.close(); }
});
test('commit must reject a generation that was never the reserved owner', () => {
  const {db,p,dest} = fixture();
  try {
    const owner = p.reserveOperationOwnership('m');
    const result = p.commitNavigation(dest, owner + 100);
    assert.equal(result.committed, false, 'an unreserved future token is not the authorized owner');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM material_reading_state').get().n, 0);
  } finally { db.close(); }
});
test('a blocked claim write cannot allocate equal tokens and make the earlier request win', () => {
  const {db,p,dest} = fixture();
  try {
    const seed = p.reserveOperationOwnership('m');
    p.commitNavigation(dest, seed);
    db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT, 'claim write blocked'); END;");
    let a,b;
    try { a=p.reserveOperationOwnership('m'); b=p.reserveOperationOwnership('m'); }
    catch { return; } // Correct fail-closed behavior: no requests proceed with false ownership.
    const old = p.commitNavigation({...dest,physicalPage:10,pageLabel:'x'},a);
    const newer = p.commitNavigation({...dest,physicalPage:20,pageLabel:'xx'},b);
    assert.equal(old.committed,false,'earlier request must not become a stale winner after a later claim attempt');
    assert.equal(newer.committed,false,'failed reservations cannot authorize either write');
    assert.equal(db.prepare("SELECT last_requested_page FROM material_reading_state WHERE material_id='m'").get().last_requested_page,5);
  } finally { db.close(); }
});
test('active unexecuted mutant claims cannot escape via NAVIGATION in their ID', () => {
  const result=validateTraceability({texts:['M1_REAL\nM99_NAVIGATION_NEVER_EXECUTED'],executedTests:new Set(),executedMutants:new Set(['M1_REAL']),measured:{mappedTests:72,mutants:1}});
  assert.equal(result.ok,false,'the active fabricated mutant must be rejected');
  assert.deepEqual(result.unexecutedCitedMutants,['M99_NAVIGATION_NEVER_EXECUTED']);
});
