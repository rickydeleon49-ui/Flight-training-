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
 for(const f of fs.readdirSync(pack+'/scratch/accepted-main/src-tauri/migrations').filter(f=>f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(pack+'/scratch/accepted-main/src-tauri/migrations/'+f,'utf8'));
 db.exec("INSERT INTO study_materials(id,title,material_type,topic,file_path,created_at,updated_at) VALUES('m','Synthetic','handbook','x','synthetic.pdf','x','x')");
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
   const observed={oldSuccess:old.success,controllerState:c.state,savedPage:db.prepare("SELECT last_requested_page AS page FROM material_reading_state WHERE material_id='m'").get().page};
   assert.deepEqual(observed,{oldSuccess:false,controllerState:'failed',savedPage:5},'the newer failed intent must supersede old callbacks and keep the saved tuple');
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
   const tokens=[],errors=[];for(let i=0;i<2;i++){try{tokens.push(p.reserveOperationOwnership('m'));}catch(e){errors.push(e);}}
   const claim=db.prepare("SELECT reserved_generation FROM material_operation_claims WHERE material_id='m'").get()??null;
   assert.equal(errors.length,2,'no-op claim writes must throw, observed '+JSON.stringify({tokens,claim}));
  }finally{db.close();}
 });
}
