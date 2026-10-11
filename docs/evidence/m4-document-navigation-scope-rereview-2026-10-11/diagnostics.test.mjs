import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validatePageIndex, parsePageReference, translateSplitCoordinates, reconcileBookmarksOnContentDrift} from './submitted/docs/evidence/m4-document-navigation-eval-2026-10-11/proof/contractModel.mjs';
import {OpenerController} from './submitted/docs/evidence/m4-document-navigation-eval-2026-10-11/proof/openerController.mjs';
import {StructuralPdfParser} from './submitted/docs/evidence/m4-document-navigation-eval-2026-10-11/proof/pdfParserDemonstration.mjs';
const lineage={materialId:'child',rootMaterialId:'root',parentMaterialId:'parent',sourcePageStart:101,sourcePageEnd:116,sourceTotalPages:200,parentPageStart:21,parentPageEnd:36,parentTotalPages:50,childPageCount:16,nestedLevel:2};
const material={id:'A',title:'A',filePath:'a.pdf',totalPages:50,contentSha256:'a'.repeat(64)};
function held(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('[control] validated physical index and complete nested parent range work',()=>{
 assert.equal(validatePageIndex(3,16).valid,true);
 assert.equal(translateSplitCoordinates({direction:'child_to_parent',page:3},lineage).parentPage,23);
});
test('[control] explicit abort refuses obsolete opener success',async()=>{
 const h=held();const c=new OpenerController({injectedOpener:()=>h.promise});const p=c.requestOpen(material,3);c.abort();h.resolve();assert.equal((await p).success,false);assert.equal(c.lastNotice,null);
});
test('[M4-R5] unsafe integer totals cannot validate a physical destination',()=>{
 assert.equal(validatePageIndex(1,Number.MAX_SAFE_INTEGER+1).valid,false);
});
test('[M4-R5] integer sourcePage without coordinate provenance remains unresolved',()=>{
 assert.equal(parsePageReference(42).physicalIndex,null);
});
test('[M4-R5] explicit physical zero cannot become a resolved destination',()=>{
 assert.equal(parsePageReference('0',{provenance:'physical_index'}).isResolved,false);
});
test('[M4-R5] parent ranges cannot concatenate string coordinates',()=>{
 assert.equal(translateSplitCoordinates({direction:'child_to_parent',page:3},{...lineage,parentPageStart:'21'}).success,false);
});
test('[M4-R5] parent range length must match child length',()=>{
 assert.equal(translateSplitCoordinates({direction:'child_to_parent',page:3},{...lineage,parentPageEnd:22}).success,false);
});
test('[M4-R5] root destination cannot exceed known root page count',()=>{
 assert.equal(translateSplitCoordinates({direction:'child_to_root',page:3},{...lineage,sourceTotalPages:100}).success,false);
});
test('[M4-R5] reverse translation includes the destination child identity',()=>{
 assert.equal(translateSplitCoordinates({direction:'root_to_child',page:105},lineage).sourceMaterialId,'child');
});
test('[M4-R6] same-hash revalidation cannot verify an out-of-bounds bookmark',()=>{
 const b={id:'b',originatingContentSha256:'a'.repeat(64),pageIndex:42,status:'unverified'};
 const result=reconcileBookmarksOnContentDrift([b],'a'.repeat(64),{totalPages:10});
 assert.notEqual(result[0].status,'verified');
});
test('[M4-R7] later missing-path request supersedes earlier pending opener',async()=>{
 const h=held();const c=new OpenerController({injectedOpener:()=>h.promise});const a=c.requestOpen(material,42);
 assert.equal((await c.requestOpen({id:'B',title:'B',filePath:null},1)).success,false);
 h.resolve();assert.equal((await a).success,false);assert.equal(c.state,'failed');assert.equal(c.lastNotice,null);
});
test('[M4-R7] failing another material cannot expose prior material requested page',async()=>{
 const c=new OpenerController({injectedOpener:async p=>{if(p==='b.pdf')throw Error('Missing B');}});
 await c.requestOpen(material,42);const b=await c.requestOpen({id:'B',title:'B',filePath:'b.pdf'},1);
 assert.equal(b.lastRequestedPage,null);
});
test('[M4-R7] malformed destination is refused before invoking opener',async()=>{
 let calls=0;const c=new OpenerController({injectedOpener:async()=>{calls++;}});
 assert.equal((await c.requestOpen(material,NaN)).success,false);assert.equal(calls,0);
});
test('[M4-R7] successful open exercises injected durable persistence',async()=>{
 let writes=0;const c=new OpenerController({injectedOpener:async()=>{},injectedPersistence:async()=>{writes++;}});
 await c.requestOpen(material,3);assert.equal(writes,1);
});
test('[M4-R8] custom parser cannot establish page-tree consistency',()=>{
 const b=fs.readFileSync(new URL('./submitted/docs/evidence/m4-document-navigation-eval-2026-10-11/fixtures/handbook_root_sample.pdf',import.meta.url));
 // Same-width corruption keeps object offsets unchanged: 50 actual leaves, declared /Count 99.
 const corrupted=Buffer.from(b.toString('latin1').replace('/Count 50','/Count 99'),'latin1');
 const p=new StructuralPdfParser(corrupted);let refused=false;
 try{p.parse();}catch{refused=true;}finally{p.cleanup();}
 assert.equal(refused,true);
});
