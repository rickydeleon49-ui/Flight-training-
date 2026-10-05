import {it,expect,vi} from 'vitest';
vi.mock('sql.js/dist/sql-wasm.wasm?url',()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
import {createSqlJsDatabase} from './sqlJsDb';
import {practiceSessionRepository} from './repositories/practiceSessionRepository';
it('browser reopen refuses semantically invalid persisted practice state',async()=>{
 const old=globalThis.localStorage;const stored=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:{getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>stored.set(key,value)}});
 try{const db=await createSqlJsDatabase();await db.execute("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('mat','Synthetic','2026-10-04','2026-10-04')");await db.savePracticeTestAtomically!({sourceMaterialId:'mat',title:'Synthetic',questions:[{question:'Synthetic',options:['A','B'],correctIndex:0,explanation:'',sourcePage:null}],model:'synthetic'});const repo=practiceSessionRepository(db);const v=(await repo.getActiveVersion('mat'))!;await repo.saveSessionAction({action:'start_or_resume',operationId:crypto.randomUUID(),materialId:'mat',versionId:v.version.id});await db.execute('UPDATE practice_attempts SET total_questions=99,answered_count=88');await expect(createSqlJsDatabase()).rejects.toThrow();}
 finally{Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:old});}
});
