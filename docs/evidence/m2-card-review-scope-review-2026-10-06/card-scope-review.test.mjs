import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createStore, apply, erase, cardVersion } from './submitted/evidence/proof/contractModel.mjs';
import { schedule, isDue } from './submitted/evidence/proof/simpleScheduler.mjs';
const T0='2026-10-06T15:00:00.000Z';
const T9='2026-10-06T15:09:00.000Z';
const T11='2026-10-06T15:11:00.000Z';
const END='2026-10-06T23:59:59.999Z';
const QUERY='SELECT item_id FROM card_review_state WHERE source_material_id = ? AND suspended = 0 AND flag IS NULL AND due_at <= ? ORDER BY due_at, item_id';
function db(){
 const d=new DatabaseSync(':memory:');
 d.exec(`CREATE TABLE card_review_state(item_id TEXT, source_material_id TEXT, step INTEGER, due_at TEXT, suspended INTEGER, flag TEXT); CREATE TABLE card_versions(id TEXT, source_material_id TEXT, content_hash TEXT, is_active INTEGER); CREATE TABLE card_items(id TEXT,version_id TEXT);`);
 return d;
}
const cardsA=[{front:'Synthetic A',back:'Synthetic answer A',sourcePage:null}];
const cardsB=[{front:'Synthetic B',back:'Synthetic answer B',sourcePage:null}];
const a=cardVersion('material',cardsA),b=cardVersion('material',cardsB);
const rate=(id,revision=0)=>({action:'rate',operationId:id,itemId:a.items[0].itemId,expectedRevision:revision,rating:'good'});
test('[CRS-R1] the documented end-of-day SQL must not return an Again card at minute nine',()=>{
 const d=db();try{
  const state=schedule(null,'again',T0);assert.equal(isDue(state,T9,'UTC'),false);
  d.prepare('INSERT INTO card_review_state VALUES(?,?,?,?,?,?)').run('again','material',state.step,state.dueAt,0,null);
  const actual=d.prepare(QUERY).all('material',END).map(x=>x.item_id);
  assert.deepEqual(actual,[],'documented SQL disagrees with correct pure isDue');
 }finally{d.close();}
});
test('[CRS-R1] the documented material-only SQL must exclude an inactive content version',()=>{
 const d=db();try{
  d.prepare('INSERT INTO card_versions VALUES(?,?,?,?)').run(a.versionId,'material',a.contentHash,0);
  d.prepare('INSERT INTO card_versions VALUES(?,?,?,?)').run(b.versionId,'material',b.contentHash,1);
  const insert=d.prepare('INSERT INTO card_review_state VALUES(?,?,?,?,?,?)');
  insert.run(a.items[0].itemId,'material',0,T0,0,null);insert.run(b.items[0].itemId,'material',0,T0,0,null);
  d.prepare('INSERT INTO card_items VALUES(?,?)').run(a.items[0].itemId,a.versionId);d.prepare('INSERT INTO card_items VALUES(?,?)').run(b.items[0].itemId,b.versionId);
  assert.deepEqual(d.prepare(QUERY).all('material',END).map(x=>x.item_id),[b.items[0].itemId]);
 }finally{d.close();}
});
test('[CRS-R2] reset must refuse a revision-zero request created before reset but never applied',()=>{
 const store=createStore();const old=rate('a1000000-0000-4000-8000-000000000011');
 erase(store,[a.items[0].itemId]);
 assert.throws(()=>apply(store,old,T11),e=>e.code==='STALE_REVISION'||e.code==='STALE_GENERATION'||e.code==='OPERATION_ERASED');
});
test('[CRS-R2] a stale revision-one request must not become valid after reset and one new rating',()=>{
 const store=createStore();apply(store,rate('a1000000-0000-4000-8000-000000000012'),T0);
 const old=rate('a1000000-0000-4000-8000-000000000013',1);
 erase(store,[a.items[0].itemId]);apply(store,rate('a1000000-0000-4000-8000-000000000014'),T9);
 assert.throws(()=>apply(store,old,T11),e=>e.code==='STALE_REVISION'||e.code==='STALE_GENERATION'||e.code==='OPERATION_ERASED');
});
test('[CRS-R2] erasing again must tolerate an already tombstoned receipt',()=>{
 const store=createStore();apply(store,rate('a1000000-0000-4000-8000-000000000015'),T0);
 erase(store,[a.items[0].itemId]);assert.doesNotThrow(()=>erase(store,[a.items[0].itemId]));
});
