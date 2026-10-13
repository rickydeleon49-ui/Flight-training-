import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const pack=process.env.M4_REVIEW_TARGET_PACK ? path.resolve(process.env.M4_REVIEW_TARGET_PACK) : path.join(root,'submitted');
const {OpenerController}=await import(pathToFileURL(path.join(pack,'proof/openerController.mjs')).href);
const {DocumentPersistenceProtocol}=await import(pathToFileURL(path.join(pack,'proof/persistenceProtocol.mjs')).href);
const ledger=path.join(root,'submitted/shipped/migrations');
const hash='a'.repeat(64);
const mat={id:'mat_sample_001',title:'IFH',filePath:'ifh.pdf'};
const rec=(page)=>({status:'resolved',destination:{materialId:mat.id,coordinateSpace:'material_physical',contentSha256:hash,physicalPage:page,totalPages:50,pageLabel:null,provenance:'physical_index'}});
const hold=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function openDb(file=':memory:'){
 const db=new DatabaseSync(file);
 for(const f of fs.readdirSync(ledger).filter(f=>f.endsWith('.sql')).sort())
  db.exec(fs.readFileSync(path.join(ledger,f),'utf8'));
 const p=new DocumentPersistenceProtocol(db);
 p.applyCandidateDdl(fs.readFileSync(path.join(pack,'candidate/candidate_migration_0015.sql'),'utf8'));
 db.prepare("INSERT INTO study_materials (id,title,material_type,topic,file_path,created_at,updated_at) VALUES ('mat_sample_001','IFH','handbook','x','/ifh.pdf','x','x')").run();
 p.saveContentIdentity(mat.id,hash,50);
 return {db,p};
}
const page=db=>db.prepare('SELECT last_requested_page FROM material_reading_state WHERE material_id=?').get(mat.id)?.last_requested_page;
const controller=(p,opts={})=>new OpenerController({identityProvider:id=>p.getCurrentIdentity(id),injectedOpener:async()=>{},injectedPersistence:async(d,g)=>p.commitNavigation(d,g),...opts});

test('[M4-R28] overlapping controllers with earlier completion still retain later request',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hfd-r28-'));
 const {db,p}=openDb(path.join(tmp,'store.db'));
 const db2=new DatabaseSync(path.join(tmp,'store.db'));
 const p2=new DocumentPersistenceProtocol(db2);
 try {
  const a=hold(),b=hold();
  const c1=controller(p,{injectedOpener:async()=>a.promise});
  const c2=controller(p2,{injectedOpener:async()=>b.promise});
  const older=c1.requestOpen(mat,rec(10));
  const newer=c2.requestOpen(mat,rec(20));
  console.log(JSON.stringify({case:'R28-tokens',olderToken:c1.currentIntentId,newerToken:c2.currentIntentId}));
  a.resolve();const oldResult=await older;
  b.resolve();const newResult=await newer;
  console.log(JSON.stringify({case:'R28',oldResult,newResult,finalPage:page(db)}));
  assert.equal(page(db),20,'[M4-R28] later request must save even when earlier completion lands first');
 }finally{db2.close();db.close();fs.rmSync(tmp,{recursive:true});}
});

test('[M4-R29] abort while persistence is pending cannot change the saved page',async()=>{
 const {db,p}=openDb(); const gate=hold(),entered=hold();
 try {
  p.saveReadingState(mat.id,5,{contentSha256:hash,generation:1});
  const c=controller(p,{injectedPersistence:async(d,g)=>{entered.resolve();await gate.promise;return p.commitNavigation(d,g);}});
  const pending=c.requestOpen(mat,rec(42));await entered.promise;c.abort();gate.resolve();
  const result=await pending;
  console.log(JSON.stringify({case:'R29',result,finalPage:page(db),controllerState:c.state}));
  assert.equal(page(db),5,'[M4-R29] abort must fence an already pending persistence operation before commit');
 }finally{db.close();}
});

test('[M4-R30] late fulfilled commit acknowledgement cannot overwrite newer controller progress',async()=>{
 const {db,p}=openDb();const gate=hold(),entered=hold();
 try{
  const c=controller(p,{injectedPersistence:async(d,g)=>{const result=p.commitNavigation(d,g);if(d.physicalPage===10){entered.resolve();await gate.promise;}return result;}});
  const older=c.requestOpen(mat,rec(10));await entered.promise;
  const newer=await c.requestOpen(mat,rec(20));assert.equal(newer.saved,true);
  const winningNotice=c.lastNotice;
  gate.resolve();const oldResult=await older;
  console.log(JSON.stringify({case:'R30-normal',oldResult,durablePage:page(db),controllerPage:c.lastRequestedPage}));
  assert.equal(page(db),20);
  assert.equal(c.lastRequestedPage,20,'[M4-R30] stale acknowledged operation must not replace winning controller progress');
  assert.equal(c.lastNotice,winningNotice);
 }finally{db.close();}
});

test('[M4-R30] late retry acknowledgement cannot overwrite newer controller progress',async()=>{
 const {db,p}=openDb();const gate=hold(),entered=hold();let first=true;
 try{
  const c=controller(p,{injectedPersistence:async(d,g)=>{
   if(d.physicalPage===42&&first){first=false;throw new Error('one failure');}
   const result=p.commitNavigation(d,g);
   if(d.physicalPage===42){entered.resolve();await gate.promise;}
   return result;
  }});
  const unsaved=await c.requestOpen(mat,rec(42));assert.equal(unsaved.saved,false);
  const retry=unsaved.retrySave();await entered.promise;
  const newer=await c.requestOpen(mat,rec(20));assert.equal(newer.saved,true);
  gate.resolve();const late=await retry;
  console.log(JSON.stringify({case:'R30-retry',late,durablePage:page(db),controllerPage:c.lastRequestedPage}));
  assert.equal(page(db),20);
  assert.equal(c.lastRequestedPage,20,'[M4-R30] retry must recheck immutable operation ownership after its await');
 }finally{db.close();}
});

test('[M4-R30] obsolete opener failure must leave the winner notice and state intact',async()=>{
 const {db,p}=openDb();const gate=hold();
 try{
  const c=controller(p,{injectedOpener:async(_file,target)=>{if(target===10){await gate.promise;throw new Error('old open failure');}}});
  const older=c.requestOpen(mat,rec(10));
  await c.requestOpen(mat,rec(20));
  const winningNotice=c.lastNotice;
  gate.resolve();await older;
  console.log(JSON.stringify({case:'R30-failure',durablePage:page(db),controllerState:c.state,notice:c.lastNotice}));
  assert.equal(page(db),20);
  assert.equal(c.state,'opened','[M4-R30] superseded failure must not abort the winning route');
  assert.equal(c.lastNotice,winningNotice);
 }finally{db.close();}
});
