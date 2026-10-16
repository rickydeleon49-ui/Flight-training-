import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const pack = process.env.M4_REVIEW_TARGET_PACK;
const { DocumentPersistenceProtocol } = await import(pathToFileURL(pack+'/proof/persistenceProtocol.mjs'));
const { OpenerController } = await import(pathToFileURL(pack+'/proof/openerController.mjs'));
const hash='a'.repeat(64);
const material={id:'m',title:'Synthetic',filePath:'synthetic.pdf'};
const dest=(page)=>({materialId:'m',coordinateSpace:'material_physical',contentSha256:hash,totalPages:50,physicalPage:page,pageLabel:String(page),provenance:'physical_index'});
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE study_materials(id TEXT PRIMARY KEY NOT NULL); INSERT INTO study_materials VALUES('m');");
 const p=new DocumentPersistenceProtocol(db);
 p.applyCandidateDdl(fs.readFileSync(pack+'/candidate/candidate_migration_0015.sql','utf8'));
 p.replaceContentIdentity('m',hash,50);
 const seed=p.reserveOperationOwnership('m'); p.commitNavigation(dest(5),seed);
 return {db,p};
}
for (const boundary of ['opener','persistence']) {
 test(`a newer failed reservation supersedes an older held ${boundary}`,async()=>{
  const {db,p}=fixture();let release;const held=new Promise(r=>release=r);let entered;const reached=new Promise(r=>entered=r);let writes=0;
  const c=new OpenerController({
   identityProvider:id=>p.getCurrentIdentity(id),
   injectedOpener:async()=>{if(boundary==='opener'){entered();await held;}},
   injectedPersistence:async(d,g)=>{writes++;if(boundary==='persistence'){entered();await held;}return p.commitNavigation(d,g);},
  });
  try {
   const a=c.requestOpen(material,{status:'resolved',destination:dest(10)});await reached;
   db.exec("CREATE TRIGGER reject_claim BEFORE UPDATE ON material_operation_claims BEGIN SELECT RAISE(ABORT,'reservation blocked'); END;");
   const b=await c.requestOpen(material,{status:'resolved',destination:dest(20)});
   assert.equal(b.success,false);assert.match(b.error,/reservation blocked/);
   release();const old=await a;
   assert.equal(old.success,false,`the superseded ${boundary} must not report success`);
   assert.equal(c.state,'failed','the newest failure must stay published');
   assert.equal(db.prepare("SELECT last_requested_page AS page FROM material_reading_state WHERE material_id='m'").get().page,5,'older work must not replace page5 after the newer intent failed');
   if(boundary==='opener')assert.equal(writes,0,'older opener continuation must not reach persistence');
  } finally{release();db.close();}
 });
}
for(const phase of ['INSERT','UPDATE']){
 test(`an ignored ${phase} cannot issue an unpersisted reservation token`,()=>{
  const {db,p}=fixture();
  try{
   if(phase==='INSERT')db.exec('DELETE FROM material_operation_claims');
   db.exec(`CREATE TRIGGER ignore_claim BEFORE ${phase} ON material_operation_claims BEGIN SELECT RAISE(IGNORE); END;`);
   assert.throws(()=>p.reserveOperationOwnership('m'),undefined,'a no-op claim write must be treated as a reservation failure');
  }finally{db.close();}
 });
}
