import initSqlJs from 'sql.js';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createNodeSqliteDatabase} from './testing/nodeSqliteDb';
import {createSqlJsDatabase} from './sqlJsDb';
import type {SqlDatabase} from './db';
const WASM=`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock('sql.js/dist/sql-wasm.wasm?url',()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
beforeEach(()=>{const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const forms=[
 {label:'leading decimal in WHEN',sql:"CREATE TRIGGER probe AFTER INSERT ON source WHEN .5 BEGIN INSERT INTO target VALUES ('kept'); END;"},
 {label:'BOM before trigger body BEGIN',sql:"CREATE TRIGGER probe AFTER INSERT ON source \uFEFFBEGIN INSERT INTO target VALUES ('kept'); END;"},
];
const suffixes=['BEGIN;','BEGIN TRANSACTION;','COMMIT;','END;','SAVEPOINT sp1;','ROLLBACK;','ROLLBACK TO sp1;','RELEASE sp1;'];
const create=async(engine:'node:sqlite'|'sql.js'):Promise<SqlDatabase>=>engine==='node:sqlite'?createNodeSqliteDatabase():createSqlJsDatabase();
function close(db:SqlDatabase){if('close'in db)(db as {close():void}).close();}
describe.each(['node:sqlite','sql.js'] as const)('A2 eighth review — %s',engine=>{
 it.each(forms)('raw engine accepts and fires $label',async({sql})=>{
  if(engine==='node:sqlite'){
   const native='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */native);const db=new DatabaseSync(':memory:');
   try{db.exec('CREATE TABLE source(id TEXT); CREATE TABLE target(value TEXT)');db.prepare(sql).run();db.prepare("INSERT INTO source VALUES ('fire')").run();expect(db.prepare('SELECT value FROM target').all()).toEqual([{value:'kept'}]);}finally{db.close();}
  }else{
   const SQL=await initSqlJs({locateFile:()=>WASM});const db=new SQL.Database();
   try{db.run('CREATE TABLE source(id TEXT); CREATE TABLE target(value TEXT)');db.run(sql,[]);db.run("INSERT INTO source VALUES ('fire')",[]);expect(db.exec('SELECT value FROM target')[0]?.values).toEqual([['kept']]);}finally{db.close();}
  }
 });
 it.each(forms)('public driver accepts and fires $label',async({sql})=>{const db=await create(engine);try{await db.execute('CREATE TABLE source(id TEXT)');await db.execute('CREATE TABLE target(value TEXT)');await db.execute(sql);await db.execute("INSERT INTO source VALUES ('fire')");expect(await db.select('SELECT value FROM target')).toEqual([{value:'kept'}]);}finally{close(db);}});
 describe.each(forms)('$label',({sql})=>{
  describe.each(['execute','select'] as const)('%s',route=>{
   it.each(suffixes)('must refuse appended %s before creating the trigger',async(suffix)=>{const db=await create(engine);try{await db.execute('CREATE TABLE source(id TEXT)');await db.execute('CREATE TABLE target(value TEXT)');await expect(db[route](`${sql} ${suffix}`)).rejects.toThrow(/Transactions on this connection must go through/i);expect(await db.select("SELECT name FROM sqlite_master WHERE type='trigger' AND name='probe'")).toEqual([]);}finally{close(db);}});
  });
 });
});
