import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase, SqlValue } from "@/data/db";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "./index";

let db: TestDatabase;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
});

afterEach(() => db.close());

describe("creating PDF parts atomically", () => {
  it("rolls back every material when a tag insert fails", async () => {
    let tagInserts = 0;
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql.startsWith("INSERT INTO material_tags") && ++tagInserts === 2) {
          throw new Error("injected tag failure");
        }
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    await expect(documents.createMany([
      { id: "part-1", title: "Part 1", tags: ["handbook"] },
      { id: "part-2", title: "Part 2", tags: ["handbook"] },
    ])).rejects.toThrow("injected tag failure");

    expect(await db.select("SELECT id FROM study_materials")).toEqual([]);
    expect(await db.select("SELECT * FROM material_tags")).toEqual([]);
  });

  it("reports a rollback failure together with the original save failure", async () => {
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql === "ROLLBACK") throw new Error("injected rollback failure");
        if (sql.startsWith("INSERT INTO material_tags")) throw new Error("injected tag failure");
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    await expect(
      documents.createMany([{ id: "part-1", title: "Part 1", tags: ["handbook"] }]),
    ).rejects.toThrow("database rollback also failed");

    // Restore the real connection before the test database is closed.
    await db.execute("ROLLBACK");
  });
});
