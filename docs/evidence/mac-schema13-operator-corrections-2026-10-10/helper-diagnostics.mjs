// Real submitted helper bodies and shipped migrations; only exports/CLI extraction added.
// Every profile is disposable scratch; no real account data or app process is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const source=path.resolve(process.argv[2]??'scripts/mac-schema13-profile-snapshot.mjs');
const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'hfd-snapshot-selfcheck-review-'));
const parts=fs.readFileSync(source,'utf8').split('const opts = parseArgs(process.argv.slice(2));');
assert.equal(parts.length,2);
const modulePath=path.join(dir,'actual-helper.mjs');
fs.writeFileSync(modulePath,parts[0]+'\nexport { newScratchRoot, buildSchema12Profile, takeSnapshot, compare, applyMigrations };\n');
const {newScratchRoot,buildSchema12Profile,takeSnapshot,compare,applyMigrations}=await import(pathToFileURL(modulePath));
const root=newScratchRoot(dir),mig=path.resolve('src-tauri/migrations');
const dbPath=buildSchema12Profile(root,mig),uid=fs.statSync(dbPath).uid;
let seq=0;const capture=()=>{const out=path.join(dir,`snapshot-${seq++}.json`);takeSnapshot(root,uid,out);return out;};
const s12=capture();
let db=new DatabaseSync(dbPath);applyMigrations(db,mig,13,13,true);db.close();
const s13=capture();
const results=[];
function comparison(before,after,purpose){const out=path.join(dir,`compare-${seq++}.json`);const r=compare({before,after,purpose,jsonOut:out});process.exitCode=0;return r;}
function test(name,fn){try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,assertion:e.message});}}
test('[control] real populated schema12 to real schema13 upgrade passes',()=>assert.equal(comparison(s12,s13,'upgrade').verdict,'PASS'));
test('[control] unchanged real schema13 profile passes',()=>assert.equal(comparison(s13,s13,'unchanged').verdict,'PASS'));
db=new DatabaseSync(dbPath);
db.prepare('INSERT INTO split_operation_log VALUES(?,?,?,?,?,?,?)').run('op-review','m1','{}','0'.repeat(64),'pending','t','t');db.close();
const operation=capture();
test('[MACV-R8] an added pending operation cannot pass unchanged',()=>assert.equal(comparison(s13,operation,'unchanged').verdict,'FAIL'));
db=new DatabaseSync(dbPath);db.exec('DELETE FROM split_operation_log;');
db.exec("INSERT INTO material_split_lineage(material_id,source_page_start,source_page_end,child_page_count,source_file_name,source_title,source_total_pages,nested_level,created_at) VALUES('m1',1,1,1,'one.pdf','Synthetic one',10,1,'t');");db.close();
const lineage=capture();
test('[MACV-R8] an added lineage row cannot pass unchanged',()=>assert.equal(comparison(s13,lineage,'unchanged').verdict,'FAIL'));
db=new DatabaseSync(dbPath);db.exec('DELETE FROM material_split_lineage; CREATE INDEX idx_review_schema_change ON study_materials(title);');db.close();
const schemaChange=capture();
test('[MACV-R8] changed schema objects cannot pass unchanged',()=>assert.equal(comparison(s13,schemaChange,'unchanged').verdict,'FAIL'));
db=new DatabaseSync(dbPath);db.exec('DROP INDEX idx_review_schema_change; DROP INDEX idx_split_operation_status;');db.close();
const missingIndex=capture();
test('[MACV-R8] upgrade requires all indexes actually created by 0013',()=>assert.equal(comparison(s12,missingIndex,'upgrade').verdict,'FAIL'));
test('[MACV-R8] restore requires all indexes actually created by 0013',()=>assert.equal(comparison(s12,missingIndex,'restore').verdict,'FAIL'));
fs.rmSync(dir,{recursive:true,force:true});
console.log(JSON.stringify({source,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results},null,2));
process.exitCode=results.some(r=>!r.pass)?1:0;
