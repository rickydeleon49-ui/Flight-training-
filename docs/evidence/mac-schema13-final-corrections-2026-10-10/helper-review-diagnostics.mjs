import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const source=path.resolve('scripts/mac-schema13-profile-snapshot.mjs');
const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'hfd-snapshot-selfcheck-review-'));
const parts=fs.readFileSync(source,'utf8').split('const opts = parseArgs(process.argv.slice(2));');
assert.equal(parts.length,2);
const mod=path.join(dir,'helper.mjs');
fs.writeFileSync(mod,parts[0]+'\nexport {newScratchRoot,buildSchema12Profile,takeSnapshot,compare,applyMigrations};\n');
const {newScratchRoot,buildSchema12Profile,takeSnapshot,compare,applyMigrations}=await import(pathToFileURL(mod));
const root=newScratchRoot(dir),mig=path.resolve('src-tauri/migrations');
const dbPath=buildSchema12Profile(root,mig),uid=fs.statSync(dbPath).uid;
let n=0;
const capture=()=>{const p=path.join(dir,`s-${n++}.json`);takeSnapshot(root,uid,p);return p;};
const s12=capture();let db=new DatabaseSync(dbPath);applyMigrations(db,mig,13,13,true);db.close();const s13=capture();
const results=[];
function cmp(a,b,purpose){const r=compare({before:a,after:b,purpose,jsonOut:path.join(dir,`c-${n++}.json`)});process.exitCode=0;return r;}
function test(name,fn){try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
test('control: complete real upgrade passes',()=>assert.equal(cmp(s12,s13,'upgrade').verdict,'PASS'));
test('control: complete real restore passes',()=>assert.equal(cmp(s12,s13,'restore').verdict,'PASS'));
const incomplete=JSON.parse(fs.readFileSync(s13));incomplete.schemaObjects.definitions={};
const missing=path.join(dir,'missing-definitions.json');fs.writeFileSync(missing,JSON.stringify(incomplete));
for(const purpose of ['upgrade','restore'])test(`${purpose}: incomplete v3 definition anchors cannot certify PASS`,()=>{
 let r;try{r=cmp(s12,missing,purpose);}catch{return;}assert.notEqual(r.verdict,'PASS');
});
db=new DatabaseSync(dbPath);db.exec('UPDATE _sqlx_migrations SET version=14 WHERE version=13');db.close();const wrongLedger=capture();
test('restore: actual ledger missing migration13 cannot certify schema13 restore',()=>assert.notEqual(cmp(s12,wrongLedger,'restore').verdict,'PASS'));
fs.rmSync(dir,{recursive:true,force:true});console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results},null,2));process.exitCode=results.some(r=>!r.pass)?1:0;
