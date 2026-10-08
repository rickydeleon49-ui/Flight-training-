import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
const m=await import(pathToFileURL(process.env.C2_REVIEW_MODEL));
const {createDisposableDb:makeDb,getLibraryReviewDue:due,getLibraryRecentReviews:history,deriveCardVersion,DeferredReadController:Controller}=m;
const now='2026-10-07T15:00:00.000Z',mid='2026-10-08T00:00:00.000Z',o={nowUtc:now,nextLocalMidnightUtc:mid};
const cards=[{front:'F',back:'B',sourcePage:null}];
function put(db,id,c=cards,topic='one'){db.prepare('INSERT INTO study_materials(id,title,topic,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,id,topic,now,now);db.prepare('INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)').run(id,JSON.stringify(c),now,now);}
function event(db,id,c=cards){const v=deriveCardVersion(id,c);db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,?,?,?, 'gemini',?,1)").run(v.versionId,id,v.contentHash,c.length,now);const it=v.items[0];db.prepare('INSERT INTO card_items(id,version_id,ordinal,front,back) VALUES(?,?,0,?,?)').run(it.itemId,v.versionId,it.front,it.back);db.prepare("INSERT INTO card_review_events(id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES(?,?,0,'good',?,'simple-v1','null','null')").run(id,it.itemId,now);}
function tracked(db){const s={calls:0,eventQueries:0,rawIds:[]};return {stats:s,prepare(sql){const q=db.prepare(sql);return Object.fromEntries(['get','all'].map(method=>[method,(...a)=>{s.calls++;if(/FROM card_review_events e/.test(sql))s.eventQueries++;const x=q[method](...a);if(/SELECT flashcards_json FROM ai_study_sets/.test(sql))s.rawIds.push(a[0]);return x;}]));}};}

test('[final ownership] obsolete enrichment rejection cannot poison a newer owned retry',async()=>{
 let rejectA,resolveB;let n=0;
 const c=new Controller(null,{},(_db,opts)=>{n++;if(n===1)return new Promise((_r,j)=>rejectA=j);if(n===2)return new Promise(r=>resolveB=r);return {enrichment:[]};});
 c.results=[{id:'a',materialId:'a',versionId:'v-a',contentStatus:'pending'}];
 const a=c.enrichMaterials(['a']); const aError=a.catch(e=>e);
 c.setFilter({topic:'two'});c.results=[{id:'b',materialId:'b',versionId:'v-b',contentStatus:'pending'}];
 const b=c.enrichMaterials(['b']);rejectA(new Error('old'));await aError;
 assert.equal(c.error,null);assert.equal(c.lastFailedRead,null);assert.equal(c.isLoading,true);
 assert.equal(c.enrichMaterials(['b']),b);
 resolveB({enrichment:[{materialId:'b',contentStatus:'current',currentVersionId:'v-b'}]});await b;
 assert.equal(c.results[0].contentStatus,'current');assert.equal(c.isLoading,false);
});
test('[final progress] real bounded reader/controller finishes pending materials without duplicates',async()=>{
 const db=makeDb();try{
 for(let i=0;i<12;i++)put(db,`m${i}`);
 const q=tracked(db),c=new Controller(q,{maxBatchCardsBudget:500},(d,opts)=>history(d,opts));
 c.results=Array.from({length:12},(_,i)=>({id:`e${i}`,materialId:`m${i}`,versionId:deriveCardVersion(`m${i}`,cards).versionId,contentStatus:'pending',isEarlierVersion:null}));c.cursor='keep';c.isComplete=true;
 for(let i=0;i<12;i++)await c.enrichMaterials();
 assert.equal(c.results.filter(r=>r.contentStatus==='current').length,12);
 assert.equal(q.stats.rawIds.length,12);assert.equal(new Set(q.stats.rawIds).size,12);
 assert.equal(q.stats.eventQueries,0);assert.equal(c.cursor,'keep');assert.equal(c.results.length,12);
 }finally{db.close();}
});
test('[final combined work] failed targeted parse prevents page raw content under the same allowance',()=>{
 const db=makeDb();try{
 put(db,'bad',Array.from({length:500},()=>({front:'F',back:7,sourcePage:null})));put(db,'live');event(db,'live');
 const q=tracked(db),r=history(q,{enrichMaterialIds:['bad'],maxBatchCardsBudget:500});
 assert.deepEqual(q.stats.rawIds,['bad']);assert.equal(r.rows[0].contentStatus,'pending');assert.equal(r.summary.attemptedCards,500);assert.equal(r.summary.evaluatedCards,0);
 }finally{db.close();}
});
test('[final actual blocked publication] oversized history remains unknown and has an encoded inspection action',async()=>{
 const db=makeDb();try{put(db,'a/b');event(db,'a/b');db.prepare('UPDATE ai_study_sets SET flashcards_json=? WHERE source_material_id=?').run('X'.repeat(9*1024*1024),'a/b');
 const c=new Controller(db,{},(d,opts)=>history(d,opts));await c.loadNextPage();await c.enrichMaterials();
 assert.equal(c.results[0].isEarlierVersion,null);assert.equal(c.results[0].blockedReason,'oversize');assert.equal(c.results[0].inspectionTarget,'/study/a%2Fb');
 }finally{db.close();}
});
