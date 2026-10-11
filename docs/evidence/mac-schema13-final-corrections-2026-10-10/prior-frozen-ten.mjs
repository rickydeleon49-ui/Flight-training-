// Frozen review diagnostics. Only exports are added to a scratch copy of the actual helper;
// function bodies are unchanged. Child-process responses are controlled; no app is launched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const source=path.resolve(process.argv[2] ?? 'scripts/mac-schema13-profile-snapshot.mjs');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'macv-diagnostic-'));
const extracted=fs.readFileSync(source,'utf8').split("const opts = parseArgs(process.argv.slice(2));");
assert.equal(extracted.length,2,'the source CLI boundary must still be unique');
const modulePath=path.join(scratch,'submitted-helper.mjs');
fs.writeFileSync(modulePath,extracted[0]+'\nexport { guardProfile, digestTable, compare, snapshot, HISTORY_TABLES };\n');
const {guardProfile,digestTable,compare,snapshot,HISTORY_TABLES}=await import(pathToFileURL(modulePath));
const root=path.join(scratch,'com.herflightdeck.app');fs.mkdirSync(root);
const dbPath=path.join(root,'her-flight-deck.db');
let db=new DatabaseSync(dbPath);db.exec('CREATE TABLE probe(id TEXT PRIMARY KEY,value TEXT);');db.close();
const originalExec=childProcess.execFileSync;
function mockPgrep(kind){
 childProcess.execFileSync=(file,args,opts)=>{
  assert.equal(file,'/usr/bin/pgrep');
  if(kind==='live')return '4242\n';
  const e=new Error(kind==='none'?'no matches':'process inspection failed');e.status=kind==='none'?1:2;throw e;
 };syncBuiltinESMExports();
}
const results=[];
function test(name,fn){try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,assertion:e.message});}}
const uid=fs.statSync(dbPath).uid;
mockPgrep('none');
test('[control] no-match exit 1 permits a scratch root',()=>assert.equal(guardProfile(root,uid),dbPath));
mockPgrep('live');
test('[MACV-R4] a matched live app must refuse before copying/reading',()=>assert.throws(()=>guardProfile(root,uid),/still running/));
mockPgrep('error');
test('[MACV-R4] process-inspection exit 2 must fail closed',()=>assert.throws(()=>guardProfile(root,uid),/REFUSED/));
mockPgrep('none');
test('[MACV-R4] output cannot overwrite the input database',()=>{
 const original=fs.readFileSync(dbPath);let refused=false;
 try{snapshot({expectProfile:root,expectUid:uid,jsonOut:dbPath});}catch{refused=true;}
 const preserved=fs.readFileSync(dbPath).equals(original);
 fs.writeFileSync(dbPath,original);
 assert.ok(refused&&preserved,`refused=${refused}; database preserved=${preserved}`);
});
const base={schema:'hfd-mac-profile-snapshot/1',profile:root,database:'her-flight-deck.db',ownerUid:uid,
 ledger:{table:'_sqlx_migrations',maxVersion:12,versions:Array.from({length:12},(_,i)=>i+1)},
 history:Object.fromEntries(HISTORY_TABLES.map(t=>[t.name,{rowCount:1,sha256:'a'.repeat(64)}])),
 schema13Tables:{material_split_lineage:{absent:true,rowCount:0},split_operation_log:{absent:true,rowCount:0}},
 fileAnchors:[{relativePath:'documents/probe.pdf',bytes:4,sha256:'b'.repeat(64)}]};
function comparison(a,b,historyOnly,purpose=historyOnly?'history':'unchanged'){
 const before=path.join(scratch,'before.json'),after=path.join(scratch,'after.json'),out=path.join(scratch,'comparison.json');
 fs.writeFileSync(before,JSON.stringify(a));fs.writeFileSync(after,JSON.stringify(b));
 const r=compare({before,after,historyOnly,purpose,jsonOut:out});process.exitCode=0;return r;
}
test('[control] unchanged history-only comparison passes',()=>assert.equal(comparison(base,base,true).retainedHistoryUnchanged,true));
test('[control] an ordinary changed history row is detected',()=>{
 const b=structuredClone(base);b.history.practice_responses.sha256='c'.repeat(64);
 assert.equal(comparison(base,b,true).retainedHistoryUnchanged,false);
});
test('[MACV-R5] Step C default compare must accept unchanged schema 12',()=>assert.equal(comparison(base,base,false).retainedHistoryUnchanged,true));
test('[MACV-R5] Step D restore comparison must detect a changed document',()=>{
 const b=structuredClone(base);b.ledger.maxVersion=13;b.fileAnchors[0].sha256='c'.repeat(64);
 assert.equal(comparison(base,b,true,'restore').retainedHistoryUnchanged,false);
});
test('[MACV-R5] snapshots missing every required history table cannot pass',()=>{
 const missing=structuredClone(base);missing.history={};
 let rejected=false;try{rejected=!comparison(missing,missing,true).retainedHistoryUnchanged;}catch{rejected=true;}
 assert.equal(rejected,true);
});
db=new DatabaseSync(dbPath);
test('[MACV-R5] TEXT changed after embedded NUL must change its digest',()=>{
 db.prepare('INSERT INTO probe(id,value) VALUES(?,?)').run('x','before\u0000one');
 const a=digestTable(db,'probe',['id']);
 db.prepare('UPDATE probe SET value=? WHERE id=?').run('before\u0000two','x');
 const b=digestTable(db,'probe',['id']);
 const actual=db.prepare('SELECT hex(value) AS bytes FROM probe').get().bytes;
 assert.notEqual(a.sha256,b.sha256,`stored changed bytes ${actual}, but hash=${a.sha256}`);
});
db.close();childProcess.execFileSync=originalExec;syncBuiltinESMExports();
fs.rmSync(scratch,{recursive:true,force:true});
console.log(JSON.stringify({source,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2));
process.exitCode=results.some(x=>!x.pass)?1:0;
