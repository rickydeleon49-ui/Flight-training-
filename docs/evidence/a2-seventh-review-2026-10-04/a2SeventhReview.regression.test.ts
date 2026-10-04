import initSqlJs from 'sql.js';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createNodeSqliteDatabase} from './testing/nodeSqliteDb';
import {createSqlJsDatabase} from './sqlJsDb';
import type {SqlDatabase} from './db';
vi.mock('sql.js/dist/sql-wasm.wasm?url',()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
const WASM=`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
beforeEach(()=>{const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const variables=['$value(case)','$value::ns(case)'];
const engines=['node:sqlite','sql.js'] as const;
async function raw(engine:typeof engines[number]){
 if(engine==='node:sqlite'){const native='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */native);const db=new DatabaseSync(':memory:');return {exec:(sql:string)=>db.exec(sql),query:(sql:string)=>db.prepare(sql).all(),close:()=>db.close()};}
 const SQL=await initSqlJs({locateFile:()=>WASM});const db=new SQL.Database();return {exec:(sql:string)=>db.run(sql),query:(sql:string)=>{const s=db.prepare(sql);try{const rows=[];while(s.step())rows.push(s.getAsObject());return rows;}finally{s.free();}},close:()=>db.close()};
}
async function driver(engine:typeof engines[number]):Promise<SqlDatabase>{return engine==='node:sqlite'?createNodeSqliteDatabase():createSqlJsDatabase();}
function close(db:SqlDatabase){if('close'in db)(db as {close():void}).close();}
describe.each(engines)('A2 seventh review — %s',engine=>{
 it('raw engine accepts a leading BOM before a real BEGIN transaction',async()=>{const db=await raw(engine);try{db.exec('CREATE TABLE probe(value TEXT)');db.exec("\uFEFFBEGIN; INSERT INTO probe VALUES ('rolled back'); ROLLBACK;");expect(db.query('SELECT value FROM probe')).toEqual([]);}finally{db.close();}});
 describe.each(['execute','select'] as const)('%s',route=>{
  it('must refuse a direct leading-BOM BEGIN before opening a transaction',async()=>{const db=await driver(engine);try{await expect(db[route]('\uFEFFBEGIN;')).rejects.toThrow(/Transactions on this connection must go through/i);}finally{close(db);}});
  it('must refuse a leading-BOM SAVEPOINT before opening a transaction',async()=>{const db=await driver(engine);try{await expect(db[route]('\uFEFFSAVEPOINT bom_probe;')).rejects.toThrow(/Transactions on this connection must go through/i);}finally{close(db);}});
 });
 it.each(variables)('raw engine accepts complete SQLite variable %s',async(variable)=>{const db=await raw(engine);try{expect(db.query(`SELECT ${variable} IS NULL AS unbound`)).toEqual([{unbound:1}]);}finally{db.close();}});
 it.each(variables)('public driver accepts complete SQLite variable %s',async(variable)=>{const db=await driver(engine);try{expect(await db.select(`SELECT ${variable} IS NULL AS unbound`)).toEqual([{unbound:1}]);}finally{close(db);}});
 describe.each(variables)('%s',variable=>{
  describe.each(['execute','select'] as const)('%s',route=>{
   it.each(['BEGIN;','COMMIT;','END;','SAVEPOINT sp1;','ROLLBACK;','RELEASE sp1;'])('must refuse trailing %s after a complete parameter token',async(ending)=>{const db=await driver(engine);try{await expect(db[route](`SELECT ${variable} IS NULL AS unbound; ${ending}`)).rejects.toThrow(/Transactions on this connection must go through/i);}finally{close(db);}});
  });
 });
 it('BOM refusal must preserve a later acknowledged public write after an unrelated query failure',async()=>{const db=await driver(engine);try{
  await db.execute('CREATE TABLE probe(value TEXT)');
  try{await db.select('\uFEFFBEGIN;');}catch(error){expect(String(error)).toMatch(/Transactions on this connection must go through/i);}
  await db.execute("INSERT INTO probe VALUES ('acknowledged')");
  await expect(db.select('SELECT * FROM definitely_missing_table')).rejects.toThrow();
  expect(await db.select('SELECT value FROM probe')).toEqual([{value:'acknowledged'}]);
 }finally{close(db);}});
});
