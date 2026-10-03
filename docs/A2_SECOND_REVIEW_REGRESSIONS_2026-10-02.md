# A2 second-review diagnostic regressions

Reviewed source was the uncommitted A2 implementation based on `533a8f5`, not the current main API. These five tests failed on that snapshot; they are evidence to promote into maintained tests when the matching implementation is available. The Markdown file is not application code and is not automatically executed. Use [the correction prompt](A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md); do not add a production test backdoor.

```typescript
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
import { createSqlJsDatabase } from "./sqlJsDb";
import type { MaterialSaveOperation, SqlDatabase } from "./db";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const create = (id: string): MaterialSaveOperation => ({
  mode: "create", id, fields: { title: "Synthetic guide" }, tags: ["Synthetic tag"],
  createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z",
});
const rows = (db: SqlDatabase) => db.select("SELECT id, title FROM study_materials ORDER BY id");

describe("A2 second review: transaction ownership boundary", () => {
  it.each(["commented execute", "select"] as const)(
    "node:sqlite %s cannot make a later failure erase an acknowledged public write",
    async (route) => {
      const db = await createNodeSqliteDatabase();
      try {
        await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
        const attempt = route === "select"
          ? db.select("BEGIN IMMEDIATE")
          : db.execute("/* synthetic leading comment */ BEGIN IMMEDIATE");
        // A refusal is a safe outcome; if admitted, no later operation may erase an acknowledged write.
        await attempt.catch(() => undefined);
        await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
        const outcome = await db.saveMaterialAtomically!(create("after-public-call"))
          .then(() => "saved", () => "rejected");
        const remaining = await db.select("SELECT id FROM unrelated");
        console.log(JSON.stringify({ route, outcome, remaining }));
        expect(remaining).toEqual([{ id: "acknowledged" }]);
      } finally {
        db.close();
      }
    },
  );

  it("sql.js select cannot open a transaction that export rolls back after an acknowledged write", async () => {
    const db = await createSqlJsDatabase();
    await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    await db.select("BEGIN IMMEDIATE").catch(() => undefined);
    await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
    const remaining = await db.select("SELECT id FROM unrelated");
    const reopened = await createSqlJsDatabase();
    const durable = await reopened.select("SELECT id FROM unrelated");
    console.log(JSON.stringify({ route: "sql.js select", remaining, durable }));
    expect({ remaining, durable }).toEqual({
      remaining: [{ id: "acknowledged" }], durable: [{ id: "acknowledged" }],
    });
  });
});

describe("A2 second review: failure before browser storage", () => {
  it.each(["create", "update"] as const)(
    "%s export failure restores the last stored state in memory as well as after reload",
    async (mode) => {
      const SQL = await initSqlJs({ locateFile: () => `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` });
      const db = await createSqlJsDatabase();
      if (mode === "update") await db.saveMaterialAtomically!(create("guide"));
      const previous = await rows(db);
      vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
        throw new Error("synthetic export failure");
      });
      const operation: MaterialSaveOperation = mode === "create"
        ? create("guide")
        : { mode: "update", id: "guide", fields: { title: "Changed guide" }, tags: ["Changed tag"] };
      await expect(db.saveMaterialAtomically!(operation)).rejects.toThrow("synthetic export failure");
      const live = await rows(db);
      const reopened = await createSqlJsDatabase();
      const durable = await rows(reopened);
      console.log(JSON.stringify({ mode, previous, live, durable }));
      expect({ live, durable }).toEqual({ live: previous, durable: previous });
    },
  );
});

```
