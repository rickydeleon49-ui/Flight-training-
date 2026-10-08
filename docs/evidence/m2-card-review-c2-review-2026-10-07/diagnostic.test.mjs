import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createDisposableDb, deriveCardVersion, getLibraryReviewDue, getLibraryRecentReviews } = await import(process.env.C2_REVIEW_MODEL ?? '../m2-card-review-c2-scope-2026-10-07/proof/contractModel.mjs');
const NOW='2026-10-07T15:00:00.000Z', MID='2026-10-08T00:00:00.000Z';
const due=(db,extra={})=>getLibraryReviewDue(db,{nowUtc:NOW,nextLocalMidnightUtc:MID,...extra});
const cards=(tag,n)=>Array.from({length:n},(_,i)=>({front:tag+i,back:'answer '+i,sourcePage:null}));
function material(db,id,raw,updated=NOW){
 db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES(?,?,?,?)").run(id,id,NOW,updated);
 db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)").run(id,JSON.stringify(raw),NOW,updated);
}
function version(db,id,raw,active){
 const v=deriveCardVersion(id,raw);
 db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,?,?,?,'import',?,?)").run(v.versionId,id,v.contentHash,raw.length,NOW,active);
 for(const i of v.items) db.prepare("INSERT INTO card_items(id,version_id,ordinal,front,back,source_page) VALUES(?,?,?,?,?,?)").run(i.itemId,v.versionId,i.ordinal,i.front,i.back,i.sourcePage);
 return v;
}
function state(db,id,item,when='2026-10-07T10:00:00.000Z'){
 db.prepare("INSERT INTO card_review_state(item_id,source_material_id,scheduler_version,step,due_at,last_reviewed_at,reps,revision) VALUES(?,?,'simple-v1',0,?,'2026-10-06T10:00:00.000Z',1,1)").run(item,id,when);
}
function event(db,item,id){db.prepare("INSERT INTO card_review_events(id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES(?,?,0,'good',?,'simple-v1','{}','{}')").run(id,item,NOW);}

test('[C2-R1] discovery can reach actionable material beyond 250 ineligible candidates',()=>{
 const db=createDisposableDb();try{
  for(let i=0;i<250;i++){const id='filled-'+String(i).padStart(3,'0'),raw=cards(id,1);material(db,id,raw);const v=version(db,id,raw,1);state(db,id,v.items[0].itemId,'2026-10-20T10:00:00.000Z');}
  material(db,'older-new',cards('new',1),'2026-10-01T00:00:00.000Z');
  let cursor=null,found=false;
  for(let page=0;page<10;page++){const result=due(db,{cursor});found ||= result.materials.some(m=>m.materialId==='older-new');cursor=result.nextCursor;if(found||!cursor)break;}
  assert.ok(found,'Older new material must be discoverable through bounded continuation; exhausted candidates must not imply caught up');
 }finally{db.close();}
});
test('[C2-R1] returned due cursor actually advances to a different material',()=>{
 const db=createDisposableDb();try{
  material(db,'one',cards('one',1));material(db,'two',cards('two',1));
  const first=due(db,{limit:1});assert.ok(first.nextCursor);
  const second=due(db,{limit:1,cursor:first.nextCursor});
  assert.notEqual(second.materials[0].materialId,first.materials[0].materialId,'nextCursor must be consumable, not repeat page one');
 }finally{db.close();}
});
test('[C2-R1] 400 due materials do not bypass the stated 250 discovery bound',()=>{
 const db=createDisposableDb();try{
  for(let i=0;i<400;i++){const id='due-'+i,raw=cards(id,1);material(db,id,raw);const v=version(db,id,raw,1);state(db,id,v.items[0].itemId);}
  let rawReads=0;
  const measured={prepare(sql){const s=db.prepare(sql);return {all(...args){return s.all(...args);},get(...args){if(sql.includes('SELECT flashcards_json FROM ai_study_sets'))rawReads++;return s.get(...args);}};}};
  due(measured,{limit:50});assert.ok(rawReads<=250,`Expected bounded discovery; instead ${rawReads} raw material reads for 50 results`);
 }finally{db.close();}
});
test('[C2-R2] raw A reversion reuses inactive A schedule while B remains last-active',()=>{
 const db=createDisposableDb();try{
  const a=cards('A',3),b=cards('B',2);material(db,'m',a);
  const av=version(db,'m',a,0),bv=version(db,'m',b,1);state(db,'m',av.items[0].itemId);state(db,'m',bv.items[0].itemId,'2026-10-20T10:00:00.000Z');
  const r=due(db).materials[0];assert.equal(r.totalDueCount,1,'Retained current A due work must return before a new mutation updates is_active');assert.equal(r.newCount,2);
 }finally{db.close();}
});
test('[C2-R2] retired A state cannot consume current B new-card count',()=>{
 const db=createDisposableDb();try{
  const a=cards('A',4),b=cards('B',3);material(db,'m',b);
  const av=version(db,'m',a,0),bv=version(db,'m',b,1);
  for(const i of av.items)state(db,'m',i.itemId);state(db,'m',bv.items[0].itemId);
  const r=due(db).materials[0];assert.equal(r.totalDueCount,1);assert.equal(r.newCount,2,'Only B current item states may reduce B new count');
 }finally{db.close();}
});
test('[C2-R3] history marks old A earlier after raw B replacement without writes',()=>{
 const db=createDisposableDb();try{
  const a=cards('A',1),b=cards('B',1);material(db,'m',b);const av=version(db,'m',a,1);event(db,av.items[0].itemId,'ev');
  assert.equal(getLibraryRecentReviews(db,{}).rows[0].isEarlierVersion,true,'The stale active flag is not current content identity');
 }finally{db.close();}
});
test('[C2-R3] history marks retained A current after raw A reversion without writes',()=>{
 const db=createDisposableDb();try{
  const a=cards('A',1),b=cards('B',1);material(db,'m',a);const av=version(db,'m',a,0);version(db,'m',b,1);event(db,av.items[0].itemId,'ev');
  assert.equal(getLibraryRecentReviews(db,{}).rows[0].isEarlierVersion,false,'Raw current A is current even when its snapshot is inactive');
 }finally{db.close();}
});
test('[control] ordinary active current content returns due and new counts',()=>{
 const db=createDisposableDb();try{const raw=cards('A',3);material(db,'m',raw);const v=version(db,'m',raw,1);state(db,'m',v.items[0].itemId);const r=due(db).materials[0];assert.equal(r.totalDueCount,1);assert.equal(r.newCount,2);}finally{db.close();}
});
test('[control] history consumes all 35 tied events without loss or duplicates',()=>{
 const db=createDisposableDb();try{
  const raw=cards('A',1);material(db,'m',raw);const v=version(db,'m',raw,1);for(let i=0;i<35;i++)event(db,v.items[0].itemId,'ev-'+String(i).padStart(2,'0'));
  const expected=db.prepare('SELECT id FROM card_review_events ORDER BY reviewed_at DESC,id DESC').all().map(r=>r.id);
  let cursor=null,seen=[];for(let i=0;i<20;i++){const page=getLibraryRecentReviews(db,{cursor,limit:4});seen.push(...page.rows.map(r=>r.id));cursor=page.next;if(!cursor)break;}
  assert.deepEqual(seen,expected);
 }finally{db.close();}
});
