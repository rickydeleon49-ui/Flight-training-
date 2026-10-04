import initSqlJs from 'sql.js';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createNodeSqliteDatabase} from './testing/nodeSqliteDb';
import {createSqlJsDatabase} from './sqlJsDb';
import type {SqlDatabase} from './db';
const WASM=`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock('sql.js/dist/sql-wasm.wasm?url',()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
beforeEach(()=>{const stored=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>stored.get(k)??null,setItem:(k:string,v:string)=>stored.set(k,v)});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const identifiers=['case$bucket','écase','caseé','✈case'];
const endings=['BEGIN;','BEGIN TRANSACTION;','COMMIT;','END;','SAVEPOINT sp1;','ROLLBACK;','ROLLBACK TO sp1;','RELEASE sp1;'];
const trigger=(name:string)=>`CREATE TRIGGER ordinary AFTER INSERT ON source BEGIN INSERT INTO ${name} VALUES ('kept'); END;`;
describe.each(['node:sqlite','sql.js'] as const)('A2 sixth review — %s',(engine)=>{
  it.each(identifiers)('raw control: %s is a legal complete identifier and trigger fires',async(name)=>{
    if(engine==='node:sqlite'){
      const native='node:sqlite';const {DatabaseSync}=await import(/* @vite-ignore */native);const raw=new DatabaseSync(':memory:');
      try{raw.exec(`CREATE TABLE source (id TEXT); CREATE TABLE ${name} (value TEXT)`);raw.prepare(trigger(name)).run();raw.prepare("INSERT INTO source VALUES ('probe')").run();expect(raw.prepare(`SELECT value FROM ${name}`).all()).toEqual([{value:'kept'}]);}finally{raw.close();}
    }else{
      const SQL=await initSqlJs({locateFile:()=>WASM});const raw=new SQL.Database();
      try{raw.run(`CREATE TABLE source (id TEXT); CREATE TABLE ${name} (value TEXT)`);raw.run(trigger(name),[]);raw.run("INSERT INTO source VALUES ('probe')",[]);expect(raw.exec(`SELECT value FROM ${name}`)[0]?.values).toEqual([['kept']]);}finally{raw.close();}
    }
  });
  it.each(identifiers)('public control: %s remains legal and trigger fires',async(name)=>{
    const db:SqlDatabase=engine==='node:sqlite'?await createNodeSqliteDatabase():await createSqlJsDatabase();
    try{await db.execute('CREATE TABLE source (id TEXT)');await db.execute(`CREATE TABLE ${name} (value TEXT)`);await db.execute(trigger(name));await db.execute("INSERT INTO source VALUES ('probe')");expect(await db.select(`SELECT value FROM ${name}`)).toEqual([{value:'kept'}]);}finally{if('close'in db)(db as {close():void}).close();}
  });
  describe.each(identifiers)('%s',(name)=>{
    describe.each(['execute','select'] as const)('%s',(route)=>{
      it.each(endings)('must refuse %s after completed trigger using a whole identifier',async(ending)=>{
        const db:SqlDatabase=engine==='node:sqlite'?await createNodeSqliteDatabase():await createSqlJsDatabase();
        try{await db.execute('CREATE TABLE source (id TEXT)');await db.execute(`CREATE TABLE ${name} (value TEXT)`);
          await expect(db[route](`${trigger(name)} ${ending}`)).rejects.toThrow(/Transactions on this connection must go through/i);
          expect(await db.select("SELECT name FROM sqlite_master WHERE type='trigger' AND name='ordinary'")).toEqual([]);
        }finally{if('close'in db)(db as {close():void}).close();}
      });
    });
  });
  it.each(identifiers)('must refuse BEGIN after an ordinary SELECT from %s',async(name)=>{
    const db:SqlDatabase=engine==='node:sqlite'?await createNodeSqliteDatabase():await createSqlJsDatabase();
    try{await db.execute(`CREATE TABLE ${name} (value TEXT)`);await db.execute(`INSERT INTO ${name} VALUES ('acknowledged')`);
      expect(await db.select(`SELECT value FROM ${name}`)).toEqual([{value:'acknowledged'}]);
      await expect(db.select(`SELECT value FROM ${name}; BEGIN;`)).rejects.toThrow(/Transactions on this connection must go through/i);
    }finally{if('close'in db)(db as {close():void}).close();}
  });
});
