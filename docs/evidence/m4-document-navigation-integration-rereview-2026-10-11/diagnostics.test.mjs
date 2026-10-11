import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parsePageReference,translateSplitCoordinates,reconcileBookmarksOnContentDrift} from './submitted/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/contractModel.mjs';
import {DocumentPersistenceProtocol} from './submitted/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/persistenceProtocol.mjs';
import {OpenerController} from './submitted/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/openerController.mjs';
const A='a'.repeat(64),B='b'.repeat(64);
const lineage={materialId:'child',rootMaterialId:'root',parentMaterialId:'parent',sourcePageStart:101,sourcePageEnd:116,sourceTotalPages:200,parentPageStart:21,parentPageEnd:36,parentTotalPages:50,childPageCount:16,nestedLevel:2};
const material={id:'m',title:'Doc',filePath:'doc.pdf',contentSha256:A,totalPages:50};
function held(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function withDb(fn){const db=new DatabaseSync(':memory:');try{
 const dir=path.resolve('src-tauri/migrations');const names=fs.readdirSync(dir).filter(p=>p.endsWith('.sql')&&Number(p.slice(0,4))<=13).sort();assert.equal(names.length,13);for(const p of names)db.exec(fs.readFileSync(path.join(dir,p),'utf8'));
 const protocol=new DocumentPersistenceProtocol(db);protocol.applyCandidateDdl(fs.readFileSync(new URL('./submitted/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/candidate/candidate_migration_0015.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO study_materials (id,title,material_type,topic,created_at,updated_at) VALUES ('m','Doc','study_guide','general','x','x')");return fn(db,protocol);
 }finally{db.close();}}
function bookmark(id='b',pageIndex=42,hash=A){return {id,materialId:'m',pageIndex,originatingContentSha256:hash,title:'Bookmark'};}
test('[control] bounded physical reference and complete nested translation work',()=>{
 assert.equal(parsePageReference(3,{provenance:'physical_index',totalPages:50}).physicalIndex,3);
 assert.equal(translateSplitCoordinates({direction:'child_to_parent',page:3},lineage).parentPage,23);
});
test('[control] newer missing-path intent still blocks obsolete opener',async()=>{
 const h=held();const c=new OpenerController({injectedOpener:()=>h.promise});const a=c.requestOpen(material,42);
 await c.requestOpen({id:'other',filePath:null},1);h.resolve();assert.equal((await a).success,false);assert.equal(c.lastNotice,null);
});
test('[M4-R9] unknown and invalid totals cannot resolve physical destinations',()=>{
 for(const totalPages of [undefined,null,NaN,Infinity,2.5,'50'])assert.equal(parsePageReference(42,{provenance:'physical_index',totalPages}).isResolved,false,String(totalPages));
});
test('[M4-R9] label maps without bounds cannot resolve a verified destination',()=>{
 assert.equal(parsePageReference('iv',{labelToPhysicalMap:{iv:42}}).isResolved,false);
});
test('[M4-R9] genuine first-level nullable parent metadata permits root navigation',()=>{
 const first={...lineage,parentMaterialId:null,parentPageStart:null,parentPageEnd:null,parentTotalPages:null,nestedLevel:1};
 assert.equal(translateSplitCoordinates({direction:'child_to_root',page:3},first).success,true);
});
test('[M4-R9] live root translation requires complete range metadata',()=>{
 const {sourcePageEnd,...incomplete}=lineage;assert.equal(translateSplitCoordinates({direction:'child_to_root',page:3},incomplete).success,false);
});
test('[M4-R9] reverse translation cannot succeed without destination identity',()=>{
 const {materialId,...incomplete}=lineage;assert.equal(translateSplitCoordinates({direction:'root_to_child',page:105},incomplete).success,false);
});
test('[M4-R9] translated arithmetic must remain a safe integer',()=>{
 const invalid={childPageCount:3,sourcePageStart:Number.MAX_SAFE_INTEGER,rootMaterialId:'root'};
 assert.equal(translateSplitCoordinates({direction:'child_to_root',page:3},invalid).success,false);
});
test('[M4-R10] persisted bookmark cannot default verified outside active bounds',()=>withDb((db,p)=>{
 p.saveContentIdentity('m',A,10);try{p.addBookmark(bookmark());}catch{return;}
 assert.notEqual(db.prepare("SELECT status FROM material_bookmarks WHERE id='b'").get().status,'verified');
}));
test('[M4-R10] identity replacement atomically invalidates bookmark and reading state',()=>withDb((db,p)=>{
 p.saveContentIdentity('m',A,50);p.addBookmark(bookmark());p.saveReadingState('m',42,{contentSha256:A});
 p.saveContentIdentity('m',B,10);
 assert.notEqual(db.prepare("SELECT status FROM material_bookmarks WHERE id='b'").get().status,'verified');
 assert.notEqual(db.prepare("SELECT status FROM material_reading_state WHERE material_id='m'").get().status,'active');
}));
test('[M4-R10] reading state cannot be active outside persisted content bounds',()=>withDb((db,p)=>{
 p.saveContentIdentity('m',A,10);try{p.saveReadingState('m',42,{contentSha256:A});}catch{return;}
 assert.notEqual(db.prepare("SELECT status FROM material_reading_state WHERE material_id='m'").get().status,'active');
}));
test('[M4-R10] unknown bounds cannot reverify a matching-hash bookmark',()=>{
 const b={originatingContentSha256:A,pageIndex:42,status:'unverified'};
 assert.notEqual(reconcileBookmarksOnContentDrift([b],A)[0].status,'verified');
});
test('[M4-R11] same material with different content cannot inherit prior requested page',async()=>{
 const c=new OpenerController({injectedOpener:async f=>{if(f==='new.pdf')throw Error('Missing');}});
 await c.requestOpen(material,42);const r=await c.requestOpen({...material,filePath:'new.pdf',contentSha256:B,totalPages:10},3);
 assert.equal(r.lastRequestedPage,null);
});
// The asynchronous database proof owns its connection through both save completions.
test('[M4-R11] held old save commits after newer save and must be fenced',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE progress (id TEXT PRIMARY KEY, page INTEGER)');
 const h=held();const c=new OpenerController({injectedOpener:async()=>{},injectedPersistence:async(id,page)=>{if(page===42)await h.promise;db.prepare('INSERT INTO progress VALUES (?,?) ON CONFLICT(id) DO UPDATE SET page=excluded.page').run(id,page);}});
 try{const old=c.requestOpen(material,42);await Promise.resolve();assert.equal((await c.requestOpen(material,3)).success,true);h.resolve();assert.equal((await old).success,false);assert.equal(db.prepare('SELECT page FROM progress').get().page,3);}finally{db.close();}
});
test('[M4-R11] public progress accessor must not leak A after failed B',async()=>{
 const c=new OpenerController({injectedOpener:async()=>{}});await c.requestOpen(material,42);
 await c.requestOpen({id:'B',filePath:null},1);assert.equal(c.lastRequestedPage,null);
});
test('[M4-R11] opener refuses out-of-bounds destination before native invocation',async()=>{
 let calls=0;const c=new OpenerController({injectedOpener:async()=>{calls++;}});
 assert.equal((await c.requestOpen({...material,totalPages:10},42)).success,false);assert.equal(calls,0);
});
