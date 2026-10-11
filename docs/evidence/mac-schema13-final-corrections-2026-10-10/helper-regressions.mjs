import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';
const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'hfd-snapshot-selfcheck-regressions-'));
const source=path.resolve(process.argv[2]??'scripts/mac-schema13-profile-snapshot.mjs');const body=fs.readFileSync(source,'utf8').split('const opts = parseArgs(process.argv.slice(2));')[0];const mod=path.join(dir,'helper.mjs');fs.writeFileSync(mod,body+'\nexport {newScratchRoot,buildSchema12Profile,takeSnapshot,compare,applyMigrations,MIGRATION13_CHECKSUM};\n');
const {newScratchRoot,buildSchema12Profile,takeSnapshot,compare,applyMigrations,MIGRATION13_CHECKSUM}=await import(pathToFileURL(mod));
let n=0;const root=newScratchRoot(dir),mig=path.resolve('src-tauri/migrations'),dbPath=buildSchema12Profile(root,mig),uid=fs.statSync(dbPath).uid;
const capture=()=>{const p=path.join(dir,`s-${n++}.json`);takeSnapshot(root,uid,p);return p;};
const s12=capture();let db=new DatabaseSync(dbPath);applyMigrations(db,mig,13,13,true);db.close();const s13=capture();
const results=[];function test(name,fn){try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
function comparison(before,after,purpose){const r=compare({before,after,purpose,jsonOut:path.join(dir,`r-${n++}.json`)});process.exitCode=0;return r;}
function reject(before,after,purpose){let r;try{r=comparison(before,after,purpose);}catch(e){assert.match(e.message,/REFUSED|snapshot|recapture/i);return;}assert.notEqual(r.verdict,'PASS');}
function edited(change){const s=JSON.parse(fs.readFileSync(s13));change(s);const p=path.join(dir,`edited-${n++}.json`);fs.writeFileSync(p,JSON.stringify(s));return p;}
test('pin equals shipped SQLx SHA384',()=>assert.equal(MIGRATION13_CHECKSUM,crypto.createHash('sha384').update(fs.readFileSync(path.join(mig,'0013_split_source_lineage.sql'))).digest('hex')));
for(const purpose of ['upgrade','restore'])test(`complete ${purpose} control`,()=>assert.equal(comparison(s12,s13,purpose).verdict,'PASS'));
test('unchanged complete schema13 control',()=>assert.equal(comparison(s13,s13,'unchanged').verdict,'PASS'));
const mutations={
 'empty definitions':s=>s.schemaObjects.definitions={},
 'one missing definition':s=>delete s.schemaObjects.definitions.idx_split_operation_status,
 'object count mismatch':s=>s.schemaObjects.count++,
 'definition object mismatch':s=>s.schemaObjects.objects.pop(),
 'definition digest missing':s=>delete s.schemaObjects.definitions.idx_split_operation_status.digest,
 'ledger rows absent':s=>s.ledger.rows=[],
 'ledger digest absent':s=>delete s.ledger.rowDigest,
 'ledger max inconsistent':s=>s.ledger.maxVersion=14,
 'schema13 columns missing':s=>delete s.schema13Tables.split_operation_log.columns,
 'schema13 key missing':s=>s.schema13Tables.material_split_lineage.primaryKey=[],
 'table inventory incomplete':s=>s.inventory.databaseTables.pop(),
};
for(const [name,change] of Object.entries(mutations))for(const purpose of ['upgrade','restore','unchanged'])test(`${purpose} refuses ${name}`,()=>reject(purpose==='unchanged'?s13:s12,edited(change),purpose));
for(const [name,sql] of [['missing migration13','UPDATE _sqlx_migrations SET version=14 WHERE version=13'],['failed migration13','UPDATE _sqlx_migrations SET success=0 WHERE version=13'],['wrong migration13 checksum',"UPDATE _sqlx_migrations SET checksum=zeroblob(48) WHERE version=13"]]){
 db=new DatabaseSync(dbPath);db.exec(sql);db.close();const p=capture();
 for(const purpose of ['upgrade','restore'])test(`${purpose} rejects actual ${name}`,()=>reject(s12,p,purpose));
 db=new DatabaseSync(dbPath);db.prepare('UPDATE _sqlx_migrations SET version=13, success=1, checksum=? WHERE version IN (13,14)').run(Buffer.from(MIGRATION13_CHECKSUM,'hex'));db.close();
}
test('old receipt stays partial and cannot certify gate',()=>{const old=edited(s=>s.schema='hfd-mac-profile-snapshot/2');assert.equal(comparison(old,old,'unchanged').verdict,'PARTIAL');});
fs.rmSync(dir,{recursive:true,force:true});console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results},null,2));process.exitCode=results.some(r=>!r.pass)?1:0;
