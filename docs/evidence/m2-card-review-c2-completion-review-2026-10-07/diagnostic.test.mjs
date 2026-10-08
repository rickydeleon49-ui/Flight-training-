import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
const model=await import(pathToFileURL(process.env.C2_REVIEW_MODEL ?? new URL('../m2-card-review-c2-scope-completion-2026-10-07/proof/contractModel.mjs',import.meta.url).pathname));
const {createDisposableDb,deriveCardVersion,getLibraryReviewDue:getDue,getLibraryRecentReviews:getHistory,DeferredReadController:Controller}=model;
const now='2026-10-07T15:00:00.000Z',mid='2026-10-08T00:00:00.000Z';
const opts={nowUtc:now,nextLocalMidnightUtc:mid};
function material(db,id,{topic='navigation',due=false}={}){
  const cards=[{front:id+' front',back:id+' back',sourcePage:null}];
  db.prepare('INSERT INTO study_materials(id,title,topic,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,id,topic,now,now);
  db.prepare('INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)').run(id,JSON.stringify(cards),now,now);
  const v=deriveCardVersion(id,cards);
  if(due){
    db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,?,?,1,'gemini',?,1)").run(v.versionId,id,v.contentHash,now);
    db.prepare('INSERT INTO card_items(id,version_id,ordinal,front,back) VALUES(?,?,0,?,?)').run(v.items[0].itemId,v.versionId,cards[0].front,cards[0].back);
    db.prepare("INSERT INTO card_review_state(item_id,source_material_id,scheduler_version,step,due_at,last_reviewed_at,reps,revision) VALUES(?,?,'simple-v1',0,?,?,1,1)").run(v.items[0].itemId,id,now,now);
  }
  return v;
}
function event(db,id,v){
  db.prepare("INSERT INTO card_review_events(id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES(?,?,0,'good',?,'simple-v1',?,?)").run(id,v.items[0].itemId,now,JSON.stringify({step:0,dueAt:now,reps:1}),JSON.stringify({step:1,dueAt:'2026-10-10T00:00:00.000Z',reps:2}));
}
function acceptsCursorRejection(run){try{return run();}catch(e){if(/CURSOR|STALE|INVALID/i.test(String(e.code??'')+' '+e.message))return null;throw e;}}
test('[C2-R7] due_today excludes new-only materials',()=>{
 const db=createDisposableDb();try{material(db,'a-new');material(db,'b-due',{due:true});assert.deepEqual(getDue(db,{...opts,statusFilter:'due_today'}).materials.map(x=>x.materialId),['b-due']);}finally{db.close();}
});
test('[C2-R7] new_only excludes due materials',()=>{
 const db=createDisposableDb();try{material(db,'a-new');material(db,'b-due',{due:true});assert.deepEqual(getDue(db,{...opts,statusFilter:'new_only'}).materials.map(x=>x.materialId),['a-new']);}finally{db.close();}
});
test('[C2-R7] history materialId filter is applied before pagination',()=>{
 const db=createDisposableDb();try{const a=material(db,'a',{due:true}),b=material(db,'b',{due:true});event(db,'ev-a',a);event(db,'ev-b',b);assert.deepEqual(getHistory(db,{materialId:'a',limit:1}).rows.map(x=>x.materialId),['a']);}finally{db.close();}
});
test('[C2-R7] history topic filter is applied before pagination',()=>{
 const db=createDisposableDb();try{const a=material(db,'a',{due:true,topic:'aerodynamics'}),b=material(db,'b',{due:true});event(db,'ev-a',a);event(db,'ev-b',b);assert.deepEqual(getHistory(db,{topic:'aerodynamics',limit:1}).rows.map(x=>x.materialId),['a']);}finally{db.close();}
});
test('[C2-R8] pending cursor cannot cross a topic filter',()=>{
 const db=createDisposableDb();try{material(db,'a',{topic:'aerodynamics'});material(db,'b',{topic:'aerodynamics'});material(db,'c');const p=getDue(db,{...opts,topic:'aerodynamics',limit:1});assert.ok(p.nextCursor);const n=acceptsCursorRejection(()=>getDue(db,{...opts,topic:'navigation',limit:1,cursor:p.nextCursor}));if(n)assert.ok(n.materials.every(x=>x.topic==='navigation'),'previous-topic rows leaked');}finally{db.close();}
});
test('[C2-R8] pending cursor does not return a deleted material',()=>{
 const db=createDisposableDb();try{material(db,'a');material(db,'b');const p=getDue(db,{...opts,limit:1});db.prepare("DELETE FROM study_materials WHERE id='b'").run();const n=acceptsCursorRejection(()=>getDue(db,{...opts,limit:1,cursor:p.nextCursor}));if(n)assert.ok(!n.materials.some(x=>x.materialId==='b'),'cached deleted summary returned');}finally{db.close();}
});
test('[C2-R8] pending cursor recomputes changed current raw cards or rejects',()=>{
 const db=createDisposableDb();try{material(db,'a');material(db,'b');const p=getDue(db,{...opts,limit:1});db.prepare("UPDATE ai_study_sets SET flashcards_json='[]' WHERE source_material_id='b'").run();const n=acceptsCursorRejection(()=>getDue(db,{...opts,limit:1,cursor:p.nextCursor}));if(n)assert.ok(!n.materials.some(x=>x.materialId==='b'),'cached summary survived content removal');}finally{db.close();}
});
test('[C2-R8] pending cursor is owned by the clock boundary',()=>{
 const db=createDisposableDb();try{material(db,'a',{due:true});material(db,'b',{due:true});const p=getDue(db,{...opts,limit:1}); // two actionable rows, remaining row cached
 const changed={nowUtc:'2026-10-06T15:00:00.000Z',nextLocalMidnightUtc:'2026-10-07T00:00:00.000Z'};
 // Independently derive current expected summaries at the new boundary.
 const fresh=getDue(db,{...changed,limit:250}).materials;
 const n=acceptsCursorRejection(()=>getDue(db,{...changed,limit:1,cursor:p.nextCursor}));
 if(n)for(const row of n.materials)assert.deepEqual(row,fresh.find(x=>x.materialId===row.materialId),'summary retained prior clock boundary');
 }finally{db.close();}
});
test('[C2-R9] controller preserves distinct history event IDs from one material',async()=>{
 const db=createDisposableDb();try{const v=material(db,'a',{due:true});event(db,'ev-a',v);event(db,'ev-b',v);const c=new Controller(db,{limit:20},getHistory);await c.loadNextPage();assert.deepEqual(c.results.map(x=>x.id),['ev-b','ev-a']);}finally{db.close();}
});
test('[C2-R9] synchronous reader rejection releases its lock and retry works',async()=>{
 let calls=0;const c=new Controller(null,{},()=>{if(++calls===1)throw new Error('sync database refusal');return {materials:[{materialId:'a'}],nextCursor:null};});
 await assert.rejects(c.loadNextPage(),/sync database refusal/);assert.equal(c.busyPromise===null,true,'settled rejection left an owned busyPromise');await c.retryRead();assert.equal(calls,2);assert.equal(c.results.length,1);
});
test('[C2-R9] reset fresh traversal replaces surviving stale summaries',async()=>{
 let calls=0;const c=new Controller(null,{},async()=>({materials:[{materialId:'a',newCount:++calls},{materialId:'b',newCount:1}],nextCursor:null}));await c.loadNextPage();c.onReset('b');await c.loadNextPage();assert.equal(c.results.find(x=>x.materialId==='a').newCount,2,'fresh a suppressed by material dedup');
});
test('[C2-R9] invalidation clears loading when old read is held',async()=>{
 let resolve;const c=new Controller(null,{},()=>new Promise(r=>{resolve=r;}));const p=c.loadNextPage();c.setFilter({topic:'navigation'});const loading=c.isLoading;resolve({materials:[],nextCursor:null});await p;assert.equal(loading,false,'new idle generation kept obsolete loading flag');
});
test('[C2-R10] valid-empty history context is distinct from unavailable',()=>{
 const db=createDisposableDb();try{const v=material(db,'a',{due:true});event(db,'ev-a',v);db.prepare("UPDATE ai_study_sets SET flashcards_json='[]' WHERE source_material_id='a'").run();const empty=getHistory(db).rows[0];db.prepare("DELETE FROM ai_study_sets WHERE source_material_id='a'").run();const unavailable=getHistory(db).rows[0];assert.notEqual(empty.contentStatus,unavailable.contentStatus,'valid empty and unavailable collapsed');}finally{db.close();}
});
test('[C2-R10] event payload retains prior and next interval/state context',()=>{
 const db=createDisposableDb();try{const v=material(db,'a',{due:true});event(db,'ev-a',v);const row=getHistory(db).rows[0];assert.deepEqual(row.priorState,{step:0,dueAt:now,reps:1});assert.deepEqual(row.nextState,{step:1,dueAt:'2026-10-10T00:00:00.000Z',reps:2});}finally{db.close();}
});
test('[control] stale A settling cannot release held B lock',async()=>{
 const held=[];let calls=0;const c=new Controller(null,{},()=>{calls++;return new Promise((resolve,reject)=>held.push({resolve,reject}));});const a=c.loadNextPage();c.setFilter({topic:'navigation'});const b=c.loadNextPage();held[0].resolve({materials:[{materialId:'old'}],nextCursor:null});await a;assert.equal(c.isLoading,true);assert.ok(c.busyPromise);const duplicate=c.loadNextPage();assert.equal(calls,2);held[1].resolve({materials:[{materialId:'new'}],nextCursor:null});await Promise.all([b,duplicate]);assert.deepEqual(c.results,[{materialId:'new'}]);
});

test('[control] fixture card shape is accepted by production parser',()=>{const db=createDisposableDb();try{material(db,'a');assert.equal(getDue(db,opts).materials[0]?.newCount,1);}finally{db.close();}});
