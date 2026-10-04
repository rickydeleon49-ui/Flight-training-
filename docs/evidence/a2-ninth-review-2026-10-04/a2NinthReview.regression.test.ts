import initSqlJs from 'sql.js';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createNodeSqliteDatabase} from './testing/nodeSqliteDb';
import {createSqlJsDatabase} from './sqlJsDb';
import type {SqlDatabase} from './db';
vi.mock('sql.js/dist/sql-wasm.wasm?url',()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
const WASM=`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
beforeEach(()=>{const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const engines=['node:sqlite','sql.js'] as const;
async function raw(engine:typeof engines[number]){
 if(engine==='node:sqlite'){const native='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */native);const db=new DatabaseSync(':memory:');return {exec:(sql:string)=>db.exec(sql),query:(sql:string)=>db.prepare(sql).all(),close:()=>db.close()};}
 const SQL=await initSqlJs({locateFile:()=>WASM});const db=new SQL.Database();return {exec:(sql:string)=>db.run(sql),query:(sql:string)=>{const s=db.prepare(sql);try{const rows=[];while(s.step())rows.push(s.getAsObject());return rows;}finally{s.free();}},close:()=>db.close()};
}
async function driver(engine:typeof engines[number]):Promise<SqlDatabase>{return engine==='node:sqlite'?createNodeSqliteDatabase():createSqlJsDatabase();}
function close(db:SqlDatabase){if('close'in db)(db as {close():void}).close();}
const prefixes=[{label:'ordinary comment text after CR',sql:'--\rignored\n'},{label:'CASE comment text after CR',sql:'--\rCASE\n'}];
const suffixes=['BEGIN;','BEGIN TRANSACTION;','COMMIT;','END;','SAVEPOINT sp1;','ROLLBACK;','ROLLBACK TO sp1;','RELEASE sp1;'];
const trigger="CREATE --\rignored\nTRIGGER probe AFTER INSERT ON source BEGIN INSERT INTO target VALUES ('kept'); END;";
describe.each(engines)('A2 ninth review — %s',engine=>{
 it.each(prefixes)('raw engine keeps $label inside comment until LF',async({sql})=>{const db=await raw(engine);try{db.exec('CREATE TABLE probe(value TEXT)');db.exec(`${sql}BEGIN; INSERT INTO probe VALUES ('rolled back'); ROLLBACK;`);expect(db.query('SELECT value FROM probe')).toEqual([]);}finally{db.close();}});
 it.each(['--\rBEGIN;\n','--\rCASE\n'])('public driver accepts valid SELECT with comment %j',async(prefix)=>{const db=await driver(engine);try{expect(await db.select(`${prefix}SELECT 7 AS value`)).toEqual([{value:7}]);}finally{close(db);}});
 it('raw engine accepts and fires trigger with a CR-containing lookahead comment',async()=>{const db=await raw(engine);try{db.exec('CREATE TABLE source(id TEXT); CREATE TABLE target(value TEXT)');db.exec(trigger);db.exec("INSERT INTO source VALUES ('fire')");expect(db.query('SELECT value FROM target')).toEqual([{value:'kept'}]);}finally{db.close();}});
 it('public driver accepts and fires trigger with a CR-containing lookahead comment',async()=>{const db=await driver(engine);try{await db.execute('CREATE TABLE source(id TEXT)');await db.execute('CREATE TABLE target(value TEXT)');await db.execute(trigger);await db.execute("INSERT INTO source VALUES ('fire')");expect(await db.select('SELECT value FROM target')).toEqual([{value:'kept'}]);}finally{close(db);}});
 describe.each(prefixes)('$label',({sql})=>{describe.each(['execute','select'] as const)('%s',route=>{it.each(suffixes)('must refuse %s after actual line-comment ending',async(suffix)=>{const db=await driver(engine);try{await expect(db[route](`${sql}${suffix}`)).rejects.toThrow(/Transactions on this connection must go through/i);}finally{close(db);}});});});
 it('refusal must preserve an acknowledged write after unrelated query failure',async()=>{const db=await driver(engine);try{
  await db.execute('CREATE TABLE probe(value TEXT)');
  try{await db.select('--\rignored\nBEGIN;');}catch(error){expect(String(error)).toMatch(/Transactions on this connection must go through/i);}
  await db.execute("INSERT INTO probe VALUES ('acknowledged')");
  await expect(db.select('SELECT * FROM definitely_missing_table')).rejects.toThrow();
  expect(await db.select('SELECT value FROM probe')).toEqual([{value:'acknowledged'}]);
 }finally{close(db);}});
});
