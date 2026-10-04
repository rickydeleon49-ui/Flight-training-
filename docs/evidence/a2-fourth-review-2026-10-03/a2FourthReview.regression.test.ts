import initSqlJs from 'sql.js';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createNodeSqliteDatabase } from './testing/nodeSqliteDb';
import { createSqlJsDatabase } from './sqlJsDb';
import type { SqlDatabase } from './db';
const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const triggerCases = [
  ['trigger name end', `CREATE TRIGGER end AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('kept'); END;`, 'source', 'observed'],
  ['table name end', `CREATE TRIGGER ordinary AFTER INSERT ON end BEGIN INSERT INTO observed VALUES ('kept'); END;`, 'end', 'observed'],
  ['body table end', `CREATE TRIGGER ordinary AFTER INSERT ON source BEGIN INSERT INTO end VALUES ('kept'); END;`, 'source', 'end'],
] as const;

describe.each(['node:sqlite', 'sql.js'] as const)('A2 fourth review — %s', (engine) => {
  it.each(triggerCases)('raw engine control: %s is legal and fires', async (_name, sql, source, output) => {
    if (engine === 'node:sqlite') {
      const native = 'node:sqlite';
      const { DatabaseSync } = await import(/* @vite-ignore */ native);
      const raw = new DatabaseSync(':memory:');
      try {
        raw.exec('CREATE TABLE source (id TEXT); CREATE TABLE end (value TEXT); CREATE TABLE observed (value TEXT)');
        raw.prepare(sql).run();
        raw.prepare(`INSERT INTO ${source} VALUES ('probe')`).run();
        expect(raw.prepare(`SELECT value FROM ${output}`).all()).toEqual([{ value: 'kept' }]);
      } finally { raw.close(); }
    } else {
      const SQL = await initSqlJs({ locateFile: () => WASM });
      const raw = new SQL.Database();
      try {
        raw.run('CREATE TABLE source (id TEXT); CREATE TABLE end (value TEXT); CREATE TABLE observed (value TEXT)');
        raw.run(sql, []);
        raw.run(`INSERT INTO ${source} VALUES ('probe')`, []);
        expect(raw.exec(`SELECT value FROM ${output}`)[0]?.values).toEqual([['kept']]);
      } finally { raw.close(); }
    }
  });

  it.each(triggerCases)('R8 public guard must preserve identifier use: %s', async (_name, sql, source, output) => {
    const db: SqlDatabase = engine === 'node:sqlite' ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
    try {
      await db.execute('CREATE TABLE source (id TEXT)');
      await db.execute('CREATE TABLE end (value TEXT)');
      await db.execute('CREATE TABLE observed (value TEXT)');
      await expect(db.execute(sql)).resolves.toBeUndefined();
      await db.execute(`INSERT INTO ${source} VALUES ('probe')`);
      expect(await db.select(`SELECT value FROM ${output}`)).toEqual([{ value: 'kept' }]);
    } finally { if ('close' in db) (db as { close(): void }).close(); }
  });

  it('R9 notes-only update must preserve the omitted stored title byte-for-byte', async () => {
    const db: SqlDatabase = engine === 'node:sqlite' ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
    try {
      await db.saveMaterialAtomically!({ mode: 'create', id: 'kept', fields: { title: 'Initial title' }, tags: ['Kept'] });
      await db.execute('UPDATE study_materials SET title = ? WHERE id = ?', ['  Stored title  ', 'kept']);
      const before = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'kept'");
      await db.saveMaterialAtomically!({ mode: 'update', id: 'kept', fields: { notes: 'Changed note' } });
      const after = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'kept'");
      const unchanged = (row: Record<string, unknown>) => { const { notes: _notes, updated_at: _updated, ...rest } = row; return rest; };
      console.log(JSON.stringify({ engine, before, after }));
      expect(unchanged(after[0]!)).toEqual(unchanged(before[0]!));
      if (engine === 'sql.js') {
        const reopened = await createSqlJsDatabase();
        expect(await reopened.select("SELECT * FROM study_materials WHERE id = 'kept'")).toEqual(after);
      }
    } finally { if ('close' in db) (db as { close(): void }).close(); }
  });
});
