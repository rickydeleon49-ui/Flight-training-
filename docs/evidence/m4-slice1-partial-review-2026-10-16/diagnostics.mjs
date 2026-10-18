import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from '/Users/rickymac/code/Flight-training-m4-slice1/node_modules/typescript/lib/typescript.js';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const repo='/Users/rickymac/code/Flight-training-m4-slice1';
const scratch=fs.mkdtempSync('/tmp/hfd-m4-review-');
try {
  for (const name of ['navigationTransaction','navigationShapes']) {
    const source=fs.readFileSync(path.join(repo,'src/data',name+'.ts'),'utf8');
    const built=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('"./navigationTransaction"','"./navigationTransaction.mjs"');
    fs.writeFileSync(path.join(scratch,name+'.mjs'),built);
  }
  const {executeNavigationOperation:op}=await import(pathToFileURL(path.join(scratch,'navigationTransaction.mjs')));
  const {isNavigationResultFor}=await import(pathToFileURL(path.join(scratch,'navigationShapes.mjs')));
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of fs.readdirSync(path.join(repo,'src-tauri/migrations')).filter(x=>x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(repo,'src-tauri/migrations',name),'utf8'));
  db.prepare("INSERT INTO study_materials (id,title,material_type,topic,created_at,updated_at) VALUES ('mat','Synthetic','handbook','general','x','x')").run();
  const hashA='a'.repeat(64), hashB='b'.repeat(64);
  db.prepare('INSERT INTO material_content_identities VALUES (?,?,?,?)').run('mat',hashA,50,'x');
  const exec=s=>db.exec(s), run=(s,p)=>{db.prepare(s).run(...p);}, query=(s,p)=>db.prepare(s).all(...p);
  const act=input=>op(exec,run,query,input);
  const first=await act({kind:'begin',materialId:'mat',supersedeGeneration:null});
  await act({kind:'commit',materialId:'mat',generation:first.generation,contentSha256:hashA,physicalPage:5,pageLabel:null});
  const staleConfirmation={kind:'set_read',materialId:'mat',physicalPage:5,confirmed:true};
  db.prepare('UPDATE material_content_identities SET content_sha256=? WHERE material_id=?').run(hashB,'mat');
  const second=await act({kind:'begin',materialId:'mat',supersedeGeneration:first.generation});
  const current=await act({kind:'commit',materialId:'mat',generation:second.generation,contentSha256:hashB,physicalPage:5,pageLabel:null});
  let failures=0;
  async function check(name,fn) {try {await fn();console.log('PASS',name);} catch(e){failures++; console.log('FAIL',name,':',e.message);}}
  await check('stale content-A read confirmation must not confirm content B at the same page',async()=>{
    let rejected=false;
    try {await act(staleConfirmation);}catch{rejected=true;}
    assert.equal(rejected,true,'old confirmation accepted; new content marked read');
  });
  await check('successful commit adapter must reject a different saved page/hash/label/status',()=>{
    const request={kind:'commit',materialId:'mat',generation:second.generation,contentSha256:hashB,physicalPage:5,pageLabel:null};
    const forged={committed:true,reason:null,readingState:{...current.readingState,lastRequestedPage:49,originatingContentSha256:hashA,lastRequestedPageLabel:'wrong',status:'drifted',confirmedRead:true}};
    assert.equal(isNavigationResultFor(request,forged),false,'inconsistent successful acknowledgement accepted');
  });
  db.close();
  console.log('Summary:',2-failures,'passed /',failures,'failed');
  process.exitCode=failures?1:0;
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
