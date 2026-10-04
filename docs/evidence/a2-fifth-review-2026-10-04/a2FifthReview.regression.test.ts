import initSqlJs from 'sql.js';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createNodeSqliteDatabase} from './testing/nodeSqliteDb';
import {createSqlJsDatabase} from './sqlJsDb';
import type {SqlDatabase} from './db';
const WASM=`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock('sql.js/dist/sql-wasm.wasm?url',()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
beforeEach(()=>{const stored=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>stored.get(k)??null,setItem:(k:string,v:string)=>stored.set(k,v)});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const forms=[['unquoted END table','end'],['SQLite single-quoted table',"'end'"]] as const;
const endings=['BEGIN;','BEGIN TRANSACTION;','COMMIT;','END;','SAVEPOINT sp1;','ROLLBACK;','ROLLBACK TO sp1;','RELEASE sp1;'];
const trigger=(table:string)=>`CREATE TRIGGER ordinary AFTER INSERT ON ${table} BEGIN INSERT INTO observed VALUES ('kept'); END;`;
describe.each(['node:sqlite','sql.js'] as const)('A2 fifth review — %s',(engine)=>{
  it.each(forms)('raw control: %s trigger is legal and fires',async(_label,table)=>{
    if(engine==='node:sqlite'){
      const native='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */native);const raw=new DatabaseSync(':memory:');
      try{raw.exec('CREATE TABLE end (value TEXT); CREATE TABLE observed (value TEXT)');raw.prepare(trigger(table)).run();raw.prepare("INSERT INTO end VALUES ('probe')").run();expect(raw.prepare('SELECT value FROM observed').all()).toEqual([{value:'kept'}]);}finally{raw.close();}
    }else{
      const SQL=await initSqlJs({locateFile:()=>WASM});const raw=new SQL.Database();
      try{raw.run('CREATE TABLE end (value TEXT); CREATE TABLE observed (value TEXT)');raw.run(trigger(table),[]);raw.run("INSERT INTO end VALUES ('probe')",[]);expect(raw.exec('SELECT value FROM observed')[0]?.values).toEqual([['kept']]);}finally{raw.close();}
    }
  });
  it.each(forms)('public control: %s trigger is legal and fires',async(_label,table)=>{
    const db:SqlDatabase=engine==='node:sqlite'?await createNodeSqliteDatabase():await createSqlJsDatabase();
    try{await db.execute('CREATE TABLE end (value TEXT)');await db.execute('CREATE TABLE observed (value TEXT)');await db.execute(trigger(table));await db.execute("INSERT INTO end VALUES ('probe')");expect(await db.select('SELECT value FROM observed')).toEqual([{value:'kept'}]);}finally{if('close'in db)(db as {close():void}).close();}
  });
  describe.each(forms)('%s',(_label,table)=>{
    describe.each(['execute','select'] as const)('%s',(route)=>{
      it.each(endings)('must refuse %s after completed legal trigger before execution',async(ending)=>{
        const db:SqlDatabase=engine==='node:sqlite'?await createNodeSqliteDatabase():await createSqlJsDatabase();
        try{
          await db.execute('CREATE TABLE end (value TEXT)');await db.execute('CREATE TABLE observed (value TEXT)');
          await expect(db[route](`${trigger(table)} ${ending}`)).rejects.toThrow(/Transactions on this connection must go through/i);
          expect(await db.select("SELECT name FROM sqlite_master WHERE type='trigger' AND name='ordinary'")).toEqual([]);
        }finally{if('close'in db)(db as {close():void}).close();}
      });
    });
  });
});
