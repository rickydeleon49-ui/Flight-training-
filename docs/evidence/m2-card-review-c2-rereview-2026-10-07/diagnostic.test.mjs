import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as identity from '../../../src/logic/cardIdentity.ts';
import * as scheduler from '../../../src/logic/cardScheduler.ts';
const model=await import(process.env.C2_REVIEW_MODEL ?? '../m2-card-review-c2-scope-corrections-2026-10-07/proof/contractModel.mjs');
const NOW='2026-10-07T15:00:00.000Z', MID='2026-10-08T00:00:00.000Z';
const input={nowUtc:NOW,nextLocalMidnightUtc:MID};
const card=(front='front',back='back',sourcePage=null)=>({front,back,sourcePage});
function material(db,id){
 const raw=[card(id)];
 db.prepare('INSERT INTO study_materials(id,title,created_at,updated_at) VALUES(?,?,?,?)').run(id,id,NOW,NOW);
 db.prepare('INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)').run(id,JSON.stringify(raw),NOW,NOW);
 return raw;
}
function ratedAgain(db,id,raw){const v=model.deriveCardVersion(id,raw);
 db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,?,?,1,'import',?,1)").run(v.versionId,id,v.contentHash,NOW);
 const i=v.items[0];db.prepare('INSERT INTO card_items(id,version_id,ordinal,front,back) VALUES(?,?,0,?,?)').run(i.itemId,v.versionId,i.front,i.back);
 db.prepare("INSERT INTO card_review_state(item_id,source_material_id,scheduler_version,step,due_at,last_reviewed_at,reps,revision) VALUES(?,?,'simple-v1',-1,?,'2026-10-07T14:50:00.000Z',1,1)").run(i.itemId,id,NOW);
}
const parityCases=[
 ['overlong front',JSON.stringify([card('x'.repeat(1001))])],
 ['overlong back and page',JSON.stringify([card('front','x'.repeat(2001),1001)])],
 ['lone surrogate',JSON.stringify([card('front\uD800')])],
 ['empty string',''],
 ['accepted control character',JSON.stringify([card('a\u0001')])],
];
for(const [name,raw]of parityCases)test('[C2-R6] production parser parity: '+name,()=>{
 assert.deepEqual(model.parseSavedCards(raw),identity.parseSavedCards(raw));
});
test('[C2-R6] simple-v1 step 3 preserves approved sixteen-day interval',()=>{
 const prior={schedulerVersion:'simple-v1',step:2,reps:1,lapses:0,lastReviewedAt:NOW,dueAt:NOW};
 assert.equal(model.scheduleCard(prior,'good',NOW).dueAt,scheduler.scheduleCard(prior,'good',NOW).dueAt);
});
test('[C2-R4] no-migration baseline does not add an index absent from shipped schema',()=>{
 const shipped=new DatabaseSync(':memory:'),db=model.createDisposableDb();
 try{
  for(const file of readdirSync(new URL('../../../src-tauri/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())shipped.exec(readFileSync(new URL('../../../src-tauri/migrations/'+file,import.meta.url),'utf8'));
  assert.equal(shipped.prepare("SELECT name FROM sqlite_schema WHERE name='idx_materials_priority_updated'").get(),undefined);
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='idx_materials_priority_updated'").get(),undefined,'The no-migration benchmark baseline must match shipped indexes');
 }finally{db.close();shipped.close();}
});
test('[C2-R1] urgency ranking actually applies inside one candidate batch',()=>{
 const db=model.createDisposableDb();try{
  material(db,'a-new');const urgent=material(db,'z-again');ratedAgain(db,'z-again',urgent);
  assert.deepEqual(model.getLibraryReviewDue(db,input).materials.map(m=>m.materialId),['z-again','a-new']);
 }finally{db.close();}
});
test('[C2-R1] caller input cannot bypass the maximum 250-candidate request budget',()=>{
 const db=model.createDisposableDb();try{
  for(let i=0;i<260;i++)material(db,'m-'+i);
  try {
   const r=model.getLibraryReviewDue(db,{...input,limit:1000,candidateBatchBudget:1000});
   assert.ok(r.summary.scannedCandidates<=250,`Budget is declared capped at 250, got ${r.summary.scannedCandidates}`);
  } catch(error) {
   if(error.code==='ERR_ASSERTION')throw error;
   assert.match(String(error.code??error.message),/INVALID|LIMIT|BUDGET|VALIDATION|BOUND/i,'Oversized request may be rejected with a specific validation error');
  }
 }finally{db.close();}
});
test('[C2-R5] filter change clears the prior filter rows before next publication',async()=>{
 const db=model.createDisposableDb();try{
  material(db,'old');const c=new model.DeferredReadController(db,input);await c.loadNextPage();assert.equal(c.results.length,1);
  c.setFilter({topic:'navigation'});assert.deepEqual(c.results,[]);
 }finally{db.close();}
});
test('[C2-R5] two same-turn activations do not duplicate the complete page',async()=>{
 const db=model.createDisposableDb();try{
  material(db,'one');material(db,'two');const c=new model.DeferredReadController(db,input);
  const a=c.loadNextPage(),b=c.loadNextPage();await Promise.all([a,b]);
  assert.equal(c.results.length,new Set(c.results.map(m=>m.materialId)).size);
 }finally{db.close();}
});
test('[control] ordinary ASCII cards retain identical content identity',async()=>{
 const raw=[card('normal')];assert.deepEqual(model.parseSavedCards(JSON.stringify(raw)),identity.parseSavedCards(JSON.stringify(raw)));
 assert.deepEqual(model.deriveCardVersion('m',raw),await identity.cardVersion('m',raw));
});
