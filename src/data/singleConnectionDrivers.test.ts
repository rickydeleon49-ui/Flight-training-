/**
 * The single-connection drivers (node:sqlite for tests, sql.js for the plain
 * browser) against their real engines: connection ownership (A2 review R4)
 * and truthful browser persistence (R5).
 *
 * Interleaving is made deterministic without timing: a second caller issues
 * its request *synchronously from inside* the first operation's open
 * transaction — from the node driver's statement seam, or from a spy on the
 * sql.js engine's own `Database.prototype.run`. Without connection ownership
 * that request runs inside the open transaction; with it, the request waits.
 */
import initSqlJs, { type BindParams } from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConnectionOwner, hasTransactionControl } from "./connectionOwner";
import type { DebriefSaveOperation, MaterialSaveOperation, SqlDatabase } from "./db";
import { createRepositories } from "./repositories";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

/* ------------------------------ fixtures ------------------------------ */

let stored: Map<string, string>;
let storageFails: boolean;

beforeEach(() => {
  stored = new Map();
  storageFails = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageFails) throw new Error("synthetic quota failure");
      stored.set(key, value);
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const create = (id: string, tags: string[] = [], title = `Synthetic ${id}`): MaterialSaveOperation => ({
  mode: "create",
  id,
  fields: { title },
  tags,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
});

const debrief: DebriefSaveOperation = {
  operationId: "op-1",
  targetId: "journal-1",
  journal: { date: "2026-10-01", title: "Synthetic debrief", wentWell: "Steady pattern" },
  action: { id: "action-1", title: "Review crosswind technique" },
  question: { id: "question-1", text: "How much aileron in a gust?" },
};

async function materialIds(db: SqlDatabase) {
  return (await db.select<{ id: string }>("SELECT id FROM study_materials ORDER BY id")).map((r) => r.id);
}

async function linkedTags(db: SqlDatabase, id: string) {
  return (
    await db.select<{ name: string }>(
      "SELECT t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.material_id = ? ORDER BY t.name",
      [id],
    )
  ).map((r) => r.name);
}

/**
 * A driver plus a way to run `inject` synchronously the moment its open
 * transaction is about to execute a statement containing `marker`.
 */
interface Harness {
  db: SqlDatabase;
  /** Calls `inject` once, synchronously, before the first statement containing `marker`. */
  duringStatement(marker: string, inject: () => void): void;
  close(): void;
}

async function nodeHarness(): Promise<Harness> {
  const db: TestDatabase = await createNodeSqliteDatabase();
  return {
    db,
    duringStatement(marker, inject) {
      let fired = false;
      db.beforeStatement = (sql) => {
        if (!fired && sql.includes(marker)) {
          fired = true;
          inject();
        }
      };
    },
    close: () => db.close(),
  };
}

async function sqlJsHarness(): Promise<Harness> {
  // sql.js caches its module, so this is the very class the driver uses.
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const db = await createSqlJsDatabase();
  const original = SQL.Database.prototype.run;
  return {
    db,
    duringStatement(marker, inject) {
      let fired = false;
      vi.spyOn(SQL.Database.prototype, "run").mockImplementation(function (
        this: InstanceType<typeof SQL.Database>,
        sql: string,
        params?: BindParams,
      ) {
        if (!fired && sql.includes(marker)) {
          fired = true;
          inject();
        }
        return original.call(this, sql, params);
      });
    },
    close: () => {},
  };
}

/* ------------------------- R4: connection ownership ------------------------- */

describe.each([
  ["node:sqlite", nodeHarness],
  ["sql.js", sqlJsHarness],
] as const)("%s connection ownership", (name, makeHarness) => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
    await h.db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    await h.db.execute(
      `CREATE TRIGGER fail_tag BEFORE INSERT ON tags WHEN NEW.name = 'Fail'
       BEGIN SELECT RAISE(FAIL, 'injected tag failure'); END`,
    );
  });
  afterEach(() => h.close());

  it("promoted R4: an unrelated write issued during a failing save survives its rollback", async () => {
    const order: string[] = [];
    let unrelated!: Promise<void>;
    h.duringStatement("INSERT INTO tags", () => {
      unrelated = h.db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')").then(() => {
        order.push("unrelated acknowledged");
      });
    });
    const save = h.db.saveMaterialAtomically!(create("interleave", ["Fail"])).then(
      () => order.push("save succeeded"),
      () => order.push("save failed"),
    );
    await save;
    await unrelated;
    expect(order).toEqual(["save failed", "unrelated acknowledged"]);
    expect(await h.db.select("SELECT id FROM unrelated")).toEqual([{ id: "acknowledged" }]);
    expect(await materialIds(h.db)).toEqual([]);
  });

  it("a read issued mid-transaction cannot see uncommitted rows", async () => {
    let seen!: Promise<string[]>;
    h.duringStatement("INSERT INTO tags", () => {
      seen = materialIds(h.db);
    });
    await expect(h.db.saveMaterialAtomically!(create("partial", ["Fail"]))).rejects.toThrow(
      "injected tag failure",
    );
    expect(await seen).toEqual([]);

    h.duringStatement("INSERT INTO material_tags", () => {
      seen = materialIds(h.db);
    });
    await h.db.saveMaterialAtomically!(create("whole", ["Fine"]));
    expect(await seen).toEqual(["whole"]);
  });

  it("concurrent saves, public writes, debriefs and PDF-part batches each keep their own outcome", async () => {
    const repos = createRepositories(h.db);
    const outcomes = await Promise.allSettled([
      h.db.saveMaterialAtomically!(create("ok-1", ["Shared"])),
      h.db.saveMaterialAtomically!(create("bad-1", ["Shared", "Fail"])),
      h.db.execute("INSERT INTO unrelated (id) VALUES ('public-1')"),
      h.db.saveDebriefAtomically!(debrief),
      repos.documents.createMany([
        { id: "part-1", title: "Part 1", tags: ["Shared"] },
        { id: "part-2", title: "Part 2", tags: ["Fail"] },
      ]),
      repos.documents.createMany([{ id: "part-3", title: "Part 3", tags: ["Parts"] }]),
      h.db.saveMaterialAtomically!(create("ok-2", ["Parts"])),
      h.db.execute("INSERT INTO unrelated (id) VALUES ('public-2')"),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual([
      "fulfilled", "rejected", "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled",
    ]);
    expect(await materialIds(h.db)).toEqual(["ok-1", "ok-2", "part-3"]);
    expect(await linkedTags(h.db, "ok-1")).toEqual(["Shared"]);
    expect(await linkedTags(h.db, "ok-2")).toEqual(["Parts"]);
    expect(await h.db.select("SELECT id FROM unrelated ORDER BY id")).toEqual([
      { id: "public-1" },
      { id: "public-2" },
    ]);
    expect(await h.db.select("SELECT id FROM journal_entries")).toEqual([{ id: "journal-1" }]);
    expect(await h.db.select("SELECT id FROM next_actions")).toEqual([{ id: "action-1" }]);
    expect(await h.db.select("SELECT name FROM tags ORDER BY name")).toEqual([
      { name: "Parts" },
      { name: "Shared" },
    ]);
  });

  it.each(["execute", "select"] as const)(
    "promoted reviewer R6: %s cannot escape ownership or erase an acknowledged write after a later save",
    async (route) => {
      const sql =
        route === "select"
          ? "BEGIN IMMEDIATE"
          : "/* synthetic leading comment */ BEGIN IMMEDIATE";
      const call = route === "select" ? h.db.select(sql) : h.db.execute(sql);
      await expect(call).rejects.toThrow(/atomic operations/i);

      await h.db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
      const save = await h.db
        .saveMaterialAtomically!(create("after-public-call"))
        .then(
          () => "saved",
          () => "rejected",
        );
      expect(save).toBe("saved");
      expect(await h.db.select("SELECT id FROM unrelated")).toEqual([{ id: "acknowledged" }]);
      if (name === "sql.js") {
        const reopened = await createSqlJsDatabase();
        expect(await reopened.select("SELECT id FROM unrelated")).toEqual([{ id: "acknowledged" }]);
      }
    },
  );

  it("refuses opening, ending, and multi-statement transaction control across execute and select", async () => {
    const openingForms = [
      "BEGIN",
      "BEGIN DEFERRED",
      "BEGIN EXCLUSIVE",
      "BEGIN TRANSACTION",
      "begin immediate transaction",
      "SAVEPOINT synthetic",
      "-- synthetic\nBEGIN",
      "/* a */ -- b\n  /* c */\tBEGIN",
      "\n\t  BEGIN",
      "BEGIN; SELECT 1",
      "SELECT 1; BEGIN",
      "; ; BEGIN",
      "/* synthetic leading comment */ BEGIN IMMEDIATE",
    ];
    const endingForms = [
      "COMMIT",
      "COMMIT TRANSACTION",
      "END",
      "END TRANSACTION",
      "ROLLBACK",
      "/* synthetic */ ROLLBACK",
      "-- synthetic\nCOMMIT",
      "RELEASE synthetic",
      "RELEASE SAVEPOINT synthetic",
      "ROLLBACK TO synthetic",
      "ROLLBACK TRANSACTION TO SAVEPOINT synthetic",
      "SELECT 1; COMMIT",
      "SELECT 1; ROLLBACK",
      "; ; ROLLBACK",
    ];

    for (const sql of [...openingForms, ...endingForms]) {
      await expect(h.db.execute(sql)).rejects.toThrow(/atomic operations/i);
      await expect(h.db.select(sql)).rejects.toThrow(/atomic operations/i);
    }

    await h.db.execute("INSERT INTO unrelated (id) VALUES ('healthy')");
    await h.db.saveMaterialAtomically!(create("after-refusals"));
    expect(await h.db.select("SELECT id FROM unrelated")).toEqual([{ id: "healthy" }]);
    expect(await materialIds(h.db)).toEqual(["after-refusals"]);
  });

  it("preserves legitimate SQL containing keywords, parameters, comments, PRAGMAs, and trigger bodies", async () => {
    // 1. Quoted literals with keywords
    await h.db.execute("INSERT INTO unrelated (id) VALUES ('BEGIN IMMEDIATE')");
    await h.db.execute("INSERT INTO unrelated (id) VALUES ('COMMIT')");
    expect(await h.db.select<{ id: string }>("SELECT id FROM unrelated WHERE id = 'COMMIT'")).toEqual([
      { id: "COMMIT" },
    ]);

    // 2. CASE expression with END
    const caseResult = await h.db.select<{ val: string }>(
      "SELECT CASE WHEN id = 'COMMIT' THEN 'BEGIN' ELSE 'END' END AS val FROM unrelated WHERE id = 'COMMIT'",
    );
    expect(caseResult).toEqual([{ val: "BEGIN" }]);

    // 3. Comments in legitimate queries
    expect(await h.db.select("/* query beginning */ SELECT id FROM unrelated WHERE id = 'COMMIT'")).toEqual([
      { id: "COMMIT" },
    ]);
    expect(await h.db.select("-- check begin\nSELECT id FROM unrelated WHERE id = 'COMMIT'")).toEqual([
      { id: "COMMIT" },
    ]);

    // 4. Quoted identifiers
    expect(await h.db.select<{ BEGIN: number }>('SELECT 1 AS "BEGIN"')).toEqual([{ BEGIN: 1 }]);
    expect(await h.db.select<{ BEGIN: number }>("SELECT 1 AS [BEGIN]")).toEqual([{ BEGIN: 1 }]);

    // 5. Parameterized queries
    expect(await h.db.select<{ val: string }>("SELECT ? AS val", ["BEGIN"])).toEqual([{ val: "BEGIN" }]);

    // 6. PRAGMAs
    const fkPragma = await h.db.select<Record<string, unknown>>("PRAGMA foreign_keys");
    expect(fkPragma.length).toBeGreaterThan(0);
    const tableInfo = await h.db.select<Record<string, unknown>>("PRAGMA table_info('study_materials')");
    expect(tableInfo.length).toBeGreaterThan(0);

    // 7. CREATE TRIGGER with BEGIN ... END body
    await h.db.execute(
      `CREATE TRIGGER test_trigger AFTER INSERT ON unrelated
       BEGIN
         INSERT INTO tags (id, name, created_at) VALUES ('trg-' || NEW.id, 'Tag-' || NEW.id, '2026-10-01T10:00:00Z');
       END`,
    );
    await h.db.execute("INSERT INTO unrelated (id) VALUES ('trigger-test')");
    expect(await h.db.select("SELECT id FROM tags WHERE id = 'trg-trigger-test'")).toEqual([
      { id: "trg-trigger-test" },
    ]);
  });

  it("queued ending call requested mid-save is refused without corrupting the completed save", async () => {
    let endingPromise!: Promise<unknown>;
    h.duringStatement("INSERT INTO material_tags", () => {
      endingPromise = h.db.execute("COMMIT");
    });
    const saved = await h.db.saveMaterialAtomically!(create("mid-save", ["TagA", "TagB"]));
    await expect(endingPromise).rejects.toThrow(/atomic operations/i);

    expect(saved.id).toBe("mid-save");
    expect(await materialIds(h.db)).toEqual(["mid-save"]);
    expect(await linkedTags(h.db, "mid-save")).toEqual(["TagA", "TagB"]);
    if (name === "sql.js") {
      const reopened = await createSqlJsDatabase();
      expect(await materialIds(reopened)).toEqual(["mid-save"]);
      expect(await linkedTags(reopened, "mid-save")).toEqual(["TagA", "TagB"]);
    }
  });

  it("refuses public transaction control and stays usable after failures", async () => {
    for (const sql of ["BEGIN", "begin immediate", " COMMIT", "ROLLBACK", "SAVEPOINT s", "RELEASE s", "END"]) {
      await expect(h.db.execute(sql)).rejects.toThrow(/atomic operations/i);
    }
    await expect(h.db.execute("INSERT INTO no_such_table VALUES (1)")).rejects.toThrow();
    await expect(h.db.saveMaterialAtomically!(create("bad", ["Fail"]))).rejects.toThrow();
    await h.db.saveMaterialAtomically!(create("after"));
    await h.db.execute("INSERT INTO unrelated (id) VALUES ('after')");
    expect(await materialIds(h.db)).toEqual(["after"]);
  });

  it("R8: preserves and fires triggers with CASE in body, WHEN clause, and nested CASE expressions", async () => {
    await h.db.execute("CREATE TABLE trig_test (id TEXT, val TEXT)");
    await h.db.execute("CREATE TABLE trig_out (msg TEXT)");

    // 1. CASE in trigger body
    await h.db.execute(`
      CREATE TRIGGER trg_case_body AFTER INSERT ON trig_test
      BEGIN
        INSERT INTO trig_out (msg)
          VALUES (CASE WHEN NEW.id = 'probe1' THEN 'body-kept' ELSE 'other' END);
      END;
    `);

    // 2. CASE in trigger WHEN
    await h.db.execute(`
      CREATE TRIGGER trg_case_when AFTER INSERT ON trig_test
      WHEN CASE WHEN NEW.id = 'probe2' THEN 1 ELSE 0 END = 1
      BEGIN
        INSERT INTO trig_out (msg) VALUES ('when-kept');
      END;
    `);

    // 3. Nested CASE, comments, quotes, and multiple statements
    await h.db.execute(`
      CREATE TRIGGER trg_nested AFTER INSERT ON trig_test
      BEGIN
        /* comment before insert */
        INSERT INTO trig_out (msg)
          VALUES (
            CASE WHEN NEW.id = 'probe3' THEN
              CASE WHEN NEW.val = 'sub' THEN 'nested-kept' ELSE 'nested-sub-other' END
            ELSE 'nested-other'
            END
          );
        -- second statement in trigger
        INSERT INTO trig_out (msg) VALUES ('second-stmt-' || NEW.id);
      END;
    `);

    await h.db.execute("INSERT INTO trig_test VALUES ('probe1', 'a')");
    await h.db.execute("INSERT INTO trig_test VALUES ('probe2', 'b')");
    await h.db.execute("INSERT INTO trig_test VALUES ('probe3', 'sub')");

    const msgs = (await h.db.select<{ msg: string }>("SELECT msg FROM trig_out ORDER BY rowid")).map((r) => r.msg);
    expect(msgs).toContain("body-kept");
    expect(msgs).toContain("when-kept");
    expect(msgs).toContain("nested-kept");
    expect(msgs).toContain("second-stmt-probe3");
  });

  it("R8: negative control - refuses transaction statements following completed trigger definitions", async () => {
    const trailingControls = [
      "BEGIN",
      "BEGIN IMMEDIATE",
      "SAVEPOINT s",
      "COMMIT",
      "END",
      "ROLLBACK",
      "RELEASE s",
    ];

    for (const ctrl of trailingControls) {
      const sql = `CREATE TRIGGER trg_neg_${ctrl.replace(/\s+/g, "_")} AFTER INSERT ON unrelated BEGIN INSERT INTO tags VALUES ('t-' || NEW.id, 't', '2026-01-01'); END; ${ctrl};`;
      await expect(h.db.execute(sql)).rejects.toThrow(/atomic operations/i);
      await expect(h.db.select(sql)).rejects.toThrow(/atomic operations/i);
    }
  });

  it("R9: partial update preserves raw unrecognized enums and empty strings on unmentioned columns", async () => {
    await h.db.saveMaterialAtomically!({
      mode: "create",
      id: "unrec-enum-mat",
      fields: {
        title: "Initial Title",
        originalFileName: "",
        lastReviewedAt: "",
      },
      tags: ["TagBefore"],
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });

    // Populate unfamiliar stored enums permitted by the schema
    await h.db.execute(
      "UPDATE study_materials SET material_type = ?, topic = ?, review_status = ?, priority = ? WHERE id = ?",
      ["future-type", "future-topic", "future-status", "future-priority", "unrec-enum-mat"],
    );

    // Also populate unrelated material to prove it survives untouched
    await h.db.saveMaterialAtomically!({
      mode: "create",
      id: "unrelated-mat",
      fields: { title: "Unrelated Material", topic: "aerodynamics" },
      tags: ["UnrelatedTag"],
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });

    const beforeRaw = await h.db.select<Record<string, unknown>>(
      "SELECT * FROM study_materials WHERE id = 'unrec-enum-mat'",
    );

    // Partial update touching ONLY title and tags
    await h.db.saveMaterialAtomically!({
      mode: "update",
      id: "unrec-enum-mat",
      fields: { title: "Updated Title" },
      tags: ["TagAfter"],
    });

    const afterRaw = await h.db.select<Record<string, unknown>>(
      "SELECT * FROM study_materials WHERE id = 'unrec-enum-mat'",
    );
    const untouched = (row: Record<string, unknown>) => {
      const { title: _t, updated_at: _u, ...rest } = row;
      return rest;
    };
    expect(untouched(afterRaw[0]!)).toEqual(untouched(beforeRaw[0]!));
    expect(afterRaw[0]!.material_type).toBe("future-type");
    expect(afterRaw[0]!.topic).toBe("future-topic");
    expect(afterRaw[0]!.review_status).toBe("future-status");
    expect(afterRaw[0]!.priority).toBe("future-priority");
    expect(afterRaw[0]!.original_file_name).toBe("");
    expect(afterRaw[0]!.last_reviewed_at).toBe("");
    expect(await linkedTags(h.db, "unrec-enum-mat")).toEqual(["TagAfter"]);

    // Unrelated material survives untouched
    expect(await materialIds(h.db)).toEqual(["unrec-enum-mat", "unrelated-mat"]);
    expect(await linkedTags(h.db, "unrelated-mat")).toEqual(["UnrelatedTag"]);

    // If sql.js, verify reopened state equals live state
    if (name === "sql.js") {
      const reopened = await createSqlJsDatabase();
      const reopenedRaw = await reopened.select<Record<string, unknown>>(
        "SELECT * FROM study_materials WHERE id = 'unrec-enum-mat'",
      );
      expect(reopenedRaw).toEqual(afterRaw);
      expect(await linkedTags(reopened, "unrec-enum-mat")).toEqual(["TagAfter"]);
    }
  });

  it("R9: partial update supports explicit null, explicit empty tags, and omitted tags", async () => {
    await h.db.execute(
      "INSERT INTO goals (id, title, created_at, updated_at) VALUES ('goal-1', 'Goal', '2026-01-01', '2026-01-01')",
    );
    await h.db.execute(
      "INSERT INTO schedule_events (id, title, date, created_at, updated_at) VALUES ('event-1', 'Event', '2026-01-01', '2026-01-01', '2026-01-01')",
    );

    await h.db.saveMaterialAtomically!({
      mode: "create",
      id: "sem-mat",
      fields: {
        title: "Base Title",
        goalId: "goal-1",
        eventId: "event-1",
        notes: "Initial note",
        filePath: "documents/guide.pdf",
      },
      tags: ["InitialTag1", "InitialTag2"],
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });

    // 1. Omitted tags keeps existing tags; explicit null clears nullable field
    await h.db.saveMaterialAtomically!({
      mode: "update",
      id: "sem-mat",
      fields: {
        title: "Title 2",
        goalId: null, // explicit clear
      },
      // tags omitted
    });

    const state1 = await h.db.select<Record<string, unknown>>(
      "SELECT goal_id, event_id, notes, file_path FROM study_materials WHERE id = 'sem-mat'",
    );
    expect(state1[0]!.goal_id).toBeNull();
    expect(state1[0]!.event_id).toBe("event-1");
    expect(state1[0]!.notes).toBe("Initial note");
    expect(state1[0]!.file_path).toBe("documents/guide.pdf");
    expect(await linkedTags(h.db, "sem-mat")).toEqual(["InitialTag1", "InitialTag2"]);

    // 2. Explicit empty list clears tags
    await h.db.saveMaterialAtomically!({
      mode: "update",
      id: "sem-mat",
      fields: { title: "Title 3" },
      tags: [],
    });
    expect(await linkedTags(h.db, "sem-mat")).toEqual([]);
    const rawLinks = await h.db.select("SELECT * FROM material_tags WHERE material_id = 'sem-mat'");
    expect(rawLinks).toEqual([]);
  });
});

describe("connection owner", () => {
  it("releases after a failed operation so the next one runs", async () => {
    const owner = createConnectionOwner(() => {});
    await expect(owner.exclusive(() => Promise.reject(new Error("first fails")))).rejects.toThrow(
      "first fails",
    );
    await expect(owner.exclusive(() => "second runs")).resolves.toBe("second runs");
  });

  it("refuses later work, without hanging, when the connection cannot be made safe", async () => {
    const owner = createConnectionOwner(() => {
      throw new Error("ROLLBACK failed");
    });
    await expect(owner.exclusive(() => Promise.reject(new Error("save failed")))).rejects.toThrow(
      "save failed",
    );
    await expect(owner.exclusive(() => "never runs")).rejects.toThrow("safe state");
    await expect(owner.exclusive(() => "never runs")).rejects.toThrow("safe state");
  });

  it("runs operations strictly one at a time in request order", async () => {
    const owner = createConnectionOwner(() => {});
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = owner.exclusive(async () => {
      log.push("first start");
      await gate;
      log.push("first end");
    });
    const second = owner.exclusive(() => {
      log.push("second");
    });
    await Promise.resolve();
    expect(log).toEqual(["first start"]);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(["first start", "first end", "second"]);
  });
});

/* ------------------- R5: truthful browser persistence ------------------- */

describe("sql.js browser persistence", () => {
  it("promoted R5: a create that storage refuses is reported as failed and leaves nothing behind", async () => {
    const db = await createSqlJsDatabase();
    const before = stored.get("her-flight-deck.dev-database");
    storageFails = true;
    await expect(
      createRepositories(db).documents.create({ id: "review-durable", title: "Synthetic" }),
    ).rejects.toThrow("Browser storage refused");
    storageFails = false;
    expect(stored.get("her-flight-deck.dev-database")).toBe(before);
    expect(await materialIds(db)).toEqual([]);
    expect(await materialIds(await createSqlJsDatabase())).toEqual([]);
  });

  it("a refused update keeps the previous row and tags live and after reopening", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!({ ...create("m", ["Old"]), fields: { title: "Original", notes: "Kept" } });
    const row = async (target: SqlDatabase) => ({
      rows: await target.select("SELECT title, notes, updated_at FROM study_materials"),
      tags: await linkedTags(target, "m"),
      tagRows: await target.select("SELECT name FROM tags ORDER BY name"),
    });
    const prior = await row(db);
    storageFails = true;
    await expect(
      db.saveMaterialAtomically!({
        mode: "update",
        id: "m",
        fields: { title: "Edited", notes: "Changed" },
        tags: ["New"],
        updatedAt: "2026-10-01T11:00:00.000Z",
      }),
    ).rejects.toThrow("Browser storage refused");
    storageFails = false;
    expect(await row(db)).toEqual(prior);
    expect(await row(await createSqlJsDatabase())).toEqual(prior);
  });

  it("a retry after storage recovers saves once, with the retried fields, and survives reopening", async () => {
    const db = await createSqlJsDatabase();
    storageFails = true;
    await expect(db.saveMaterialAtomically!(create("retry", ["Tag"], "First try"))).rejects.toThrow();
    storageFails = false;
    const saved = await db.saveMaterialAtomically!(create("retry", ["Tag"], "Second try"));
    expect(saved.title).toBe("Second try");
    for (const target of [db, await createSqlJsDatabase()]) {
      expect(await target.select("SELECT id, title FROM study_materials")).toEqual([
        { id: "retry", title: "Second try" },
      ]);
      expect(await linkedTags(target, "retry")).toEqual(["Tag"]);
      expect(await target.select("SELECT name FROM tags")).toEqual([{ name: "Tag" }]);
    }
  });

  it("a refused plain write and a refused debrief are undone too", async () => {
    const db = await createSqlJsDatabase();
    await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    storageFails = true;
    await expect(db.execute("INSERT INTO unrelated (id) VALUES ('x')")).rejects.toThrow();
    await expect(db.saveDebriefAtomically!(debrief)).rejects.toThrow();
    await expect(db.persist!()).rejects.toThrow("synthetic quota failure");
    storageFails = false;
    expect(await db.select("SELECT id FROM unrelated")).toEqual([]);
    expect(await db.select("SELECT id FROM journal_entries")).toEqual([]);
    await db.saveDebriefAtomically!(debrief);
    expect(await (await createSqlJsDatabase()).select("SELECT id FROM journal_entries")).toEqual([
      { id: "journal-1" },
    ]);
  });

  it("a persist requested mid-save cannot cut that save's transaction short or store it half-done", async () => {
    // sql.js export() closes and reopens the connection, so an export inside
    // the save's transaction would silently roll it back.
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const db = await createSqlJsDatabase();
    const original = SQL.Database.prototype.run;
    let persisted!: Promise<void>;
    let snapshotAtPersist: string | undefined;
    vi.spyOn(SQL.Database.prototype, "run").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (!persisted && sql.includes("INSERT INTO material_tags")) {
        persisted = db.persist!().then(() => {
          snapshotAtPersist = stored.get("her-flight-deck.dev-database");
        });
      }
      return original.call(this, sql, params);
    });
    await db.saveMaterialAtomically!(create("whole", ["A", "B"]));
    await persisted;
    vi.restoreAllMocks();
    const reopened = await createSqlJsDatabase();
    expect(await materialIds(reopened)).toEqual(["whole"]);
    expect(await linkedTags(reopened, "whole")).toEqual(["A", "B"]);
    expect(snapshotAtPersist).toBe(stored.get("her-flight-deck.dev-database"));
  });

  it("foreign keys stay enforced after storage round-trips", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("m"));
    await expect(
      db.execute("INSERT INTO material_tags (material_id, tag_id) VALUES ('missing', 'missing')"),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  /* ------------------- R7: export, recovery, and fail-closed durability ------------------- */

  async function completeStudyState(target: SqlDatabase) {
    return {
      materials: await target.select<{ id: string; title: string; notes: string | null; updated_at: string }>(
        "SELECT id, title, notes, updated_at FROM study_materials ORDER BY id",
      ),
      tags: await target.select<{ id: string; name: string }>(
        "SELECT id, name FROM tags ORDER BY id",
      ),
      links: await target.select<{ material_id: string; tag_id: string }>(
        "SELECT material_id, tag_id FROM material_tags ORDER BY material_id, tag_id",
      ),
      dangling: await target.select<{ material_id: string; tag_id: string }>(
        `SELECT mt.material_id, mt.tag_id FROM material_tags mt
         LEFT JOIN study_materials sm ON sm.id = mt.material_id
         LEFT JOIN tags t ON t.id = mt.tag_id
         WHERE sm.id IS NULL OR t.id IS NULL`,
      ),
    };
  }

  it.each(["create", "update"] as const)(
    "promoted reviewer R7: %s export failure restores the last stored state live and after reload",
    async (mode) => {
      const SQL = await initSqlJs({ locateFile: () => WASM });
      const db = await createSqlJsDatabase();
      if (mode === "update") {
        await db.saveMaterialAtomically!(create("guide", ["Initial"], "Initial title"));
      }
      const previous = await completeStudyState(db);
      expect(previous.dangling).toEqual([]);

      const exportSpy = vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
        throw new Error("synthetic export failure");
      });

      const operation: MaterialSaveOperation =
        mode === "create"
          ? create("guide", ["New tag"], "Created title")
          : { mode: "update", id: "guide", fields: { title: "Changed title" }, tags: ["Changed tag"] };

      await expect(db.saveMaterialAtomically!(operation)).rejects.toThrow("synthetic export failure");
      expect(exportSpy).toHaveBeenCalled();

      const live = await completeStudyState(db);
      const reopened = await completeStudyState(await createSqlJsDatabase());
      expect(live).toEqual(previous);
      expect(reopened).toEqual(previous);

      // Prove retry after recovery succeeds cleanly without duplicate records or debris
      if (mode === "create") {
        await db.saveMaterialAtomically!(create("guide", ["New tag"], "Created title"));
        const afterRetry = await completeStudyState(db);
        expect(afterRetry.materials).toHaveLength(1);
        expect(afterRetry.materials[0]!.title).toBe("Created title");
        expect(await linkedTags(db, "guide")).toEqual(["New tag"]);
        expect(afterRetry.dangling).toEqual([]);
      } else {
        await db.saveMaterialAtomically!(operation);
        const afterRetry = await completeStudyState(db);
        expect(afterRetry.materials[0]!.title).toBe("Changed title");
        expect(await linkedTags(db, "guide")).toEqual(["Changed tag"]);
        expect(afterRetry.dangling).toEqual([]);
      }
    },
  );

  it("a later acknowledged unrelated write or persist cannot store a previously rejected change", async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing", ["Old tag"], "Existing title"));
    const prior = await completeStudyState(db);

    // 1. Rejected create followed by unrelated write
    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure on create");
    });
    await expect(db.saveMaterialAtomically!(create("rejected-create", ["Stray"]))).rejects.toThrow(
      "synthetic export failure on create",
    );

    await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    await db.execute("INSERT INTO unrelated (id) VALUES ('later')");

    let reopened = await createSqlJsDatabase();
    expect(await reopened.select("SELECT id FROM unrelated")).toEqual([{ id: "later" }]);
    expect(await completeStudyState(reopened)).toEqual(prior);

    // 2. Rejected update followed by explicit persist
    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure on update");
    });
    await expect(
      db.saveMaterialAtomically!({
        mode: "update",
        id: "existing",
        fields: { title: "Rejected update title" },
        tags: ["Rejected tag"],
      }),
    ).rejects.toThrow("synthetic export failure on update");

    await db.persist!();
    reopened = await createSqlJsDatabase();
    expect(await completeStudyState(reopened)).toEqual(prior);
  });

  it("an encoding failure during durable write restores state live and after reload", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing", ["Tag"], "Prior title"));
    const prior = await completeStudyState(db);

    const origBtoa = globalThis.btoa;
    let btoaFired = 0;
    vi.stubGlobal("btoa", (value: string) => {
      if (btoaFired === 0) {
        btoaFired++;
        throw new Error("synthetic encoding failure");
      }
      return origBtoa(value);
    });

    await expect(
      db.saveMaterialAtomically!({
        mode: "update",
        id: "existing",
        fields: { title: "Changed title" },
      }),
    ).rejects.toThrow("synthetic encoding failure");
    expect(btoaFired).toBe(1);

    const live = await completeStudyState(db);
    const reopened = await completeStudyState(await createSqlJsDatabase());
    expect(live).toEqual(prior);
    expect(reopened).toEqual(prior);
  });

  it("a foreign-key setting restoration failure inside durable write restores state and leaves connection healthy", async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing", ["Tag"], "Prior title"));
    const prior = await completeStudyState(db);

    let fired = 0;
    const origRun = SQL.Database.prototype.run;
    vi.spyOn(SQL.Database.prototype, "run").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (fired === 0 && /foreign_keys\s*=\s*(ON|1|TRUE)/i.test(sql)) {
        fired++;
        throw new Error("synthetic foreign-key restoration failure");
      }
      return origRun.call(this, sql, params);
    });

    await expect(
      db.saveMaterialAtomically!({
        mode: "update",
        id: "existing",
        fields: { title: "Changed title" },
      }),
    ).rejects.toThrow("synthetic foreign-key restoration failure");
    expect(fired).toBe(1);

    const live = await completeStudyState(db);
    const reopened = await completeStudyState(await createSqlJsDatabase());
    expect(live).toEqual(prior);
    expect(reopened).toEqual(prior);

    // Verify foreign keys are still properly enforced on the recovered connection
    await expect(
      db.execute("INSERT INTO material_tags (material_id, tag_id) VALUES ('missing', 'missing')"),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("fails closed with a clear recovery error if restoration cannot re-establish a safe connection", async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing", ["Tag"], "Prior title"));
    const prior = await completeStudyState(db);

    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure");
    });

    // Make foreign key restore during recovery fail continuously
    let fkFailures = 0;
    const origRun = SQL.Database.prototype.run;
    vi.spyOn(SQL.Database.prototype, "run").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (/foreign_keys\s*=\s*(ON|1|TRUE)/i.test(sql)) {
        fkFailures++;
        throw new Error("recovery foreign keys failed");
      }
      return origRun.call(this, sql, params);
    });

    await expect(
      db.saveMaterialAtomically!({
        mode: "update",
        id: "existing",
        fields: { title: "Changed title" },
      }),
    ).rejects.toThrow();

    expect(fkFailures).toBeGreaterThan(0);

    // Subsequent operation fails closed with the recovery error
    await expect(db.execute("INSERT INTO unrelated VALUES ('fail')")).rejects.toThrow(/safe state/i);
    await expect(db.select("SELECT id FROM study_materials")).rejects.toThrow(/safe state/i);

    // Disarm spies to inspect reopened storage
    vi.restoreAllMocks();
    const reopened = await completeStudyState(await createSqlJsDatabase());
    expect(reopened).toEqual(prior);
  });

  /* ------------------- R8: trigger END identifier vs terminator ------------------- */

  const r8TriggerCases = [
    [
      "trigger name end",
      "CREATE TRIGGER end AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('kept'); END;",
      "end",
      "source",
      "observed",
    ],
    [
      "unquoted table name end",
      "CREATE TRIGGER ordinary AFTER INSERT ON end BEGIN INSERT INTO observed VALUES ('kept'); END;",
      "ordinary",
      "end",
      "observed",
    ],
    [
      "single-quoted table 'end'",
      "CREATE TRIGGER ordinary AFTER INSERT ON 'end' BEGIN INSERT INTO observed VALUES ('kept'); END;",
      "ordinary",
      "end",
      "observed",
    ],
    [
      "schema-qualified table main.end",
      "CREATE TRIGGER ordinary AFTER INSERT ON main.end BEGIN INSERT INTO observed VALUES ('kept'); END;",
      "ordinary",
      "end",
      "observed",
    ],
    [
      "commented boundary table",
      "CREATE TRIGGER ordinary AFTER INSERT ON /* comment */ end BEGIN INSERT INTO observed VALUES ('kept'); END;",
      "ordinary",
      "end",
      "observed",
    ],
    [
      "body table end",
      "CREATE TRIGGER ordinary AFTER INSERT ON source BEGIN INSERT INTO end VALUES ('kept'); END;",
      "ordinary",
      "source",
      "end",
    ],
    [
      "CASE in trigger body",
      `CREATE TRIGGER case_body AFTER INSERT ON source
       BEGIN
         INSERT INTO observed (value) VALUES (CASE WHEN NEW.id = 'probe' THEN 'kept' ELSE 'other' END);
       END;`,
      "case_body",
      "source",
      "observed",
    ],
    [
      "CASE in trigger WHEN",
      `CREATE TRIGGER case_when AFTER INSERT ON source
       WHEN CASE WHEN NEW.id = 'probe' THEN 1 ELSE 0 END = 1
       BEGIN INSERT INTO observed (value) VALUES ('kept'); END;`,
      "case_when",
      "source",
      "observed",
    ],
  ] as const;

  describe.each(["node:sqlite", "sql.js"] as const)("R8 trigger compatibility — %s", (engine) => {
    it.each(r8TriggerCases)("raw engine positive control: %s is legal and fires", async (_name, sql, _triggerName, source, output) => {
      if (engine === "node:sqlite") {
        const native = "node:sqlite";
        const { DatabaseSync } = await import(/* @vite-ignore */ native);
        const raw = new DatabaseSync(":memory:");
        try {
          raw.exec("CREATE TABLE source (id TEXT); CREATE TABLE end (value TEXT); CREATE TABLE observed (value TEXT)");
          raw.prepare(sql).run();
          raw.prepare(`INSERT INTO ${source} VALUES ('probe')`).run();
          expect(raw.prepare(`SELECT value FROM ${output}`).all()).toEqual([{ value: "kept" }]);
        } finally {
          raw.close();
        }
      } else {
        const SQL = await initSqlJs({ locateFile: () => WASM });
        const raw = new SQL.Database();
        try {
          raw.run("CREATE TABLE source (id TEXT); CREATE TABLE end (value TEXT); CREATE TABLE observed (value TEXT)");
          raw.run(sql, []);
          raw.run(`INSERT INTO ${source} VALUES ('probe')`, []);
          expect(raw.exec(`SELECT value FROM ${output}`)[0]?.values).toEqual([["kept"]]);
        } finally {
          raw.close();
        }
      }
    });

    it.each(r8TriggerCases)("public driver preserves trigger and identifier use: %s", async (_name, sql, _triggerName, source, output) => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE source (id TEXT)");
        await db.execute("CREATE TABLE end (value TEXT)");
        await db.execute("CREATE TABLE observed (value TEXT)");
        await expect(db.execute(sql)).resolves.toBeUndefined();
        await db.execute(`INSERT INTO ${source} VALUES ('probe')`);
        expect(await db.select(`SELECT value FROM ${output}`)).toEqual([{ value: "kept" }]);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    const negativeProhibitedSuffixes = [
      ["BEGIN", "BEGIN;"],
      ["BEGIN TRANSACTION", "BEGIN TRANSACTION;"],
      ["COMMIT", "COMMIT;"],
      ["SAVEPOINT", "SAVEPOINT sp1;"],
      ["ROLLBACK", "ROLLBACK;"],
      ["ROLLBACK TO", "ROLLBACK TO sp1;"],
      ["RELEASE", "RELEASE sp1;"],
      ["END", "END;"],
    ] as const;

    const r8NegativeMatrix = r8TriggerCases.flatMap(([name, sql, triggerName]) =>
      negativeProhibitedSuffixes.map(([suffixName, suffix]) => ({
        name: `${name} + ${suffixName}`,
        sql: `${sql} ${suffix}`,
        triggerName,
      })),
    );

    it.each(r8NegativeMatrix)(
      "public driver refuses prohibited transaction command: %s on execute and select routes without side effects",
      async ({ name: _name, sql, triggerName }) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          expect(hasTransactionControl(sql)).toBe(true);
          await expect(db.execute(sql)).rejects.toThrow(/Transactions on this connection must go through/i);
          await expect(db.select(sql)).rejects.toThrow(/Transactions on this connection must go through/i);
          const triggers = await db.select<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
            [triggerName],
          );
          expect(triggers).toEqual([]);
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );

    it.each([
      ["unquoted end", "CREATE TRIGGER ordinary AFTER INSERT ON end BEGIN INSERT INTO observed VALUES ('kept'); END; BEGIN;", "ordinary"],
      ["single-quoted 'end'", "CREATE TRIGGER ordinary AFTER INSERT ON 'end' BEGIN INSERT INTO observed VALUES ('kept'); END; COMMIT;", "ordinary"],
      ["trigger named end", "CREATE TRIGGER end AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('kept'); END; ROLLBACK;", "end"],
      ["schema-qualified main.end", "CREATE TRIGGER ordinary AFTER INSERT ON main.end BEGIN INSERT INTO observed VALUES ('kept'); END; SAVEPOINT sp1;", "ordinary"],
    ])(
      "refusal of %s precedes any side effect: prior state preserved, trigger absent, subsequent atomic save succeeds",
      async (_name, prohibitedSql, triggerName) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          await db.execute("CREATE TABLE source (id TEXT)");
          await db.execute("CREATE TABLE end (value TEXT)");
          await db.execute("CREATE TABLE observed (value TEXT)");

          await db.saveMaterialAtomically!(create("prior-mat", ["PriorTag"], "Prior Title"));
          const priorMaterials = await db.select<{ id: string; title: string }>(
            "SELECT id, title FROM study_materials WHERE id = 'prior-mat'",
          );
          expect(priorMaterials).toEqual([{ id: "prior-mat", title: "Prior Title" }]);
          expect(await linkedTags(db, "prior-mat")).toEqual(["PriorTag"]);

          await expect(db.execute(prohibitedSql)).rejects.toThrow(/Transactions on this connection must go through/i);
          await expect(db.select(prohibitedSql)).rejects.toThrow(/Transactions on this connection must go through/i);

          const triggers = await db.select<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
            [triggerName],
          );
          expect(triggers).toEqual([]);

          const liveMaterials = await db.select<{ id: string; title: string }>(
            "SELECT id, title FROM study_materials WHERE id = 'prior-mat'",
          );
          expect(liveMaterials).toEqual([{ id: "prior-mat", title: "Prior Title" }]);
          expect(await linkedTags(db, "prior-mat")).toEqual(["PriorTag"]);

          await db.saveMaterialAtomically!(create("after-mat", ["AfterTag"], "After Title"));
          const afterMaterials = await db.select<{ id: string; title: string }>(
            "SELECT id, title FROM study_materials ORDER BY id",
          );
          expect(afterMaterials).toEqual([
            { id: "after-mat", title: "After Title" },
            { id: "prior-mat", title: "Prior Title" },
          ]);
          expect(await linkedTags(db, "after-mat")).toEqual(["AfterTag"]);

          if (engine === "sql.js") {
            const reopened = await createSqlJsDatabase();
            expect(
              await reopened.select<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
                [triggerName],
              ),
            ).toEqual([]);
            expect(
              await reopened.select<{ id: string; title: string }>("SELECT id, title FROM study_materials ORDER BY id"),
            ).toEqual([
              { id: "after-mat", title: "After Title" },
              { id: "prior-mat", title: "Prior Title" },
            ]);
            expect(await linkedTags(reopened, "prior-mat")).toEqual(["PriorTag"]);
            expect(await linkedTags(reopened, "after-mat")).toEqual(["AfterTag"]);
          }
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );

    it.each([
      ["unquoted end", "CREATE TRIGGER ordinary AFTER INSERT ON end BEGIN INSERT INTO observed VALUES ('kept'); END;"],
      ["single-quoted 'end'", "CREATE TRIGGER ordinary AFTER INSERT ON 'end' BEGIN INSERT INTO observed VALUES ('kept'); END;"],
      ["trigger named end", "CREATE TRIGGER end AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('kept'); END;"],
    ])("scanner accepts ordinary trailing SQL following completed trigger: %s", async (_name, triggerSql) => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE source (id TEXT)");
        await db.execute("CREATE TABLE end (value TEXT)");
        await db.execute("CREATE TABLE observed (value TEXT)");
        const combinedSql = `${triggerSql} INSERT INTO source VALUES ('probe');`;
        expect(hasTransactionControl(combinedSql)).toBe(false);
        await expect(db.execute(combinedSql)).resolves.toBeUndefined();
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it("public driver allows multiple completed triggers and trailing ordinary SQL", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE source (id TEXT)");
        await db.execute("CREATE TABLE observed (value TEXT)");
        const multiTriggerSql = `
          CREATE TRIGGER t1 AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('first'); END;
          CREATE TRIGGER t2 AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('second'); END;
          INSERT INTO source VALUES ('trigger-now');
        `;
        expect(hasTransactionControl(multiTriggerSql)).toBe(false);
        await db.execute("CREATE TRIGGER t1 AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('first'); END;");
        await db.execute("CREATE TRIGGER t2 AFTER INSERT ON source BEGIN INSERT INTO observed VALUES ('second'); END;");
        await db.execute("INSERT INTO source VALUES ('trigger-now');");
        const observed = await db.select<{ value: string }>("SELECT value FROM observed ORDER BY value");
        expect(observed).toEqual([{ value: "first" }, { value: "second" }]);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });
  });

  /* ------------------- R9: omitted title & legacy row byte-for-byte preservation ------------------- */

  describe.each(["node:sqlite", "sql.js"] as const)("R9 title and omitted-column preservation — %s", (engine) => {
    it("notes-only update preserves the omitted stored padded title byte-for-byte", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.saveMaterialAtomically!({ mode: "create", id: "kept", fields: { title: "Initial title" }, tags: ["Kept"] });
        await db.execute("UPDATE study_materials SET title = ? WHERE id = ?", ["  Stored title  ", "kept"]);
        const before = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'kept'");
        await db.saveMaterialAtomically!({ mode: "update", id: "kept", fields: { notes: "Changed note" } });
        const after = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'kept'");
        const unchanged = (row: Record<string, unknown>) => {
          const { notes: _notes, updated_at: _updated, ...rest } = row;
          return rest;
        };
        expect(unchanged(after[0]!)).toEqual(unchanged(before[0]!));
        expect(after[0]!.title).toBe("  Stored title  ");
        if (engine === "sql.js") {
          const reopened = await createSqlJsDatabase();
          expect(await reopened.select("SELECT * FROM study_materials WHERE id = 'kept'")).toEqual(after);
        }
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it("review-status-only and tag-only updates preserve omitted padded and whitespace-only title", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.saveMaterialAtomically!({ mode: "create", id: "mat-status", fields: { title: "Init" }, tags: ["Tag1"] });
        await db.execute("UPDATE study_materials SET title = ? WHERE id = ?", ["  Padded status title  ", "mat-status"]);
        const beforeStatus = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-status'");

        // Review-status-only update
        await db.saveMaterialAtomically!({ mode: "update", id: "mat-status", fields: { reviewStatus: "studying" } });
        const afterStatus = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-status'");
        const withoutStatus = (row: Record<string, unknown>) => {
          const { review_status: _rs, updated_at: _up, ...rest } = row;
          return rest;
        };
        expect(withoutStatus(afterStatus[0]!)).toEqual(withoutStatus(beforeStatus[0]!));
        expect(afterStatus[0]!.title).toBe("  Padded status title  ");

        // Tag-only update
        const beforeTags = afterStatus;
        await db.saveMaterialAtomically!({ mode: "update", id: "mat-status", fields: {}, tags: ["Tag1", "Tag2"] });
        const afterTags = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-status'");
        const withoutTags = (row: Record<string, unknown>) => {
          const { updated_at: _up, ...rest } = row;
          return rest;
        };
        expect(withoutTags(afterTags[0]!)).toEqual(withoutTags(beforeTags[0]!));
        expect(afterTags[0]!.title).toBe("  Padded status title  ");
        expect(await linkedTags(db, "mat-status")).toEqual(["Tag1", "Tag2"]);

        // Preserves schema-permitted legacy whitespace-only title when omitted
        await db.execute("UPDATE study_materials SET title = ? WHERE id = ?", ["   ", "mat-status"]);
        const beforeWs = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-status'");
        await db.saveMaterialAtomically!({ mode: "update", id: "mat-status", fields: { notes: "Preserve ws title" } });
        const afterWs = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-status'");
        const withoutNotes = (row: Record<string, unknown>) => {
          const { notes: _n, updated_at: _up, ...rest } = row;
          return rest;
        };
        expect(withoutNotes(afterWs[0]!)).toEqual(withoutNotes(beforeWs[0]!));
        expect(afterWs[0]!.title).toBe("   ");
        expect(afterWs[0]!.notes).toBe("Preserve ws title");
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it("explicitly supplied padded title is trimmed normally, but explicit empty or whitespace-only title rejects and rolls back", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.saveMaterialAtomically!({ mode: "create", id: "mat-trim", fields: { title: "Original title" }, tags: ["Tag"] });

        // Explicit padded title trims normally
        const updated = await db.saveMaterialAtomically!({
          mode: "update",
          id: "mat-trim",
          fields: { title: "  Trimmed explicitly  " },
        });
        expect(updated.title).toBe("Trimmed explicitly");
        const storedRow = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-trim'");
        expect(storedRow[0]!.title).toBe("Trimmed explicitly");

        // Explicit empty title rejects and rolls back
        await expect(
          db.saveMaterialAtomically!({
            mode: "update",
            id: "mat-trim",
            fields: { title: "" },
          }),
        ).rejects.toThrow("Title is required.");

        // Explicit whitespace-only title rejects and rolls back
        await expect(
          db.saveMaterialAtomically!({
            mode: "update",
            id: "mat-trim",
            fields: { title: "    " },
          }),
        ).rejects.toThrow("Title is required.");

        // Original row and tags intact after rejection
        const afterFailed = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id = 'mat-trim'");
        expect(afterFailed[0]!.title).toBe("Trimmed explicitly");
        expect(await linkedTags(db, "mat-trim")).toEqual(["Tag"]);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it.each(["unrecognized stored enums", "explicit empty optional text"] as const)(
      "preserves %s across title/tag-only update",
      async (fixture) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          await db.saveMaterialAtomically!({
            mode: "create",
            id: "kept",
            fields: { title: "Prior", originalFileName: "", lastReviewedAt: "" },
            tags: ["Before"],
            createdAt: "2026-10-03T10:00:00.000Z",
            updatedAt: "2026-10-03T10:00:00.000Z",
          });
          if (fixture === "unrecognized stored enums") {
            await db.execute(
              "UPDATE study_materials SET material_type=?, topic=?, review_status=?, priority=? WHERE id=?",
              ["future-type", "future-topic", "future-status", "future-priority", "kept"],
            );
          }
          const before = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id='kept'");
          await db.saveMaterialAtomically!({ mode: "update", id: "kept", fields: { title: "Changed" }, tags: ["After"] });
          const after = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id='kept'");
          const untouched = (row: Record<string, unknown>) => {
            const { title: _title, updated_at: _updated, ...rest } = row;
            return rest;
          };
          expect(untouched(after[0]!)).toEqual(untouched(before[0]!));
          if (engine === "sql.js") {
            const reopened = await createSqlJsDatabase();
            expect(await reopened.select("SELECT * FROM study_materials WHERE id='kept'")).toEqual(after);
          }
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );
  });

  /* ------------------- R10 & R11: complete SQLite token recognition, leading BOM & trailing refusal ------------------- */

  const r10Identifiers = [
    ["case$bucket", "case$bucket"],
    ["écase", "écase"],
    ["caseé", "caseé"],
    ["✈case", "✈case"],
    ["non-ascii whitespace", "case\u00A0bucket"],
    ["interior dollar keyword", "case$end"],
    ["accented keyword prefix", "ébegin"],
    ["caſe with long-s", "ca\u017Fe"],
  ] as const;

  describe.each(["node:sqlite", "sql.js"] as const)("R10 whole-token identifier compatibility — %s", (engine) => {
    it.each(r10Identifiers)(
      "raw engine positive control: %s is a legal unquoted identifier in trigger and table roles",
      async (_label, name) => {
        if (engine === "node:sqlite") {
          const native = "node:sqlite";
          const { DatabaseSync } = await import(/* @vite-ignore */ native);
          const raw = new DatabaseSync(":memory:");
          try {
            raw.exec(`CREATE TABLE source (id TEXT); CREATE TABLE ${name} (value TEXT); CREATE TABLE observed (value TEXT)`);
            raw.prepare(`CREATE TRIGGER trg_${name} AFTER INSERT ON source BEGIN INSERT INTO ${name} VALUES ('kept'); END;`).run();
            raw.prepare("INSERT INTO source VALUES ('probe')").run();
            expect(raw.prepare(`SELECT value FROM ${name}`).all()).toEqual([{ value: "kept" }]);
          } finally {
            raw.close();
          }
        } else {
          const SQL = await initSqlJs({ locateFile: () => WASM });
          const raw = new SQL.Database();
          try {
            raw.run(`CREATE TABLE source (id TEXT); CREATE TABLE ${name} (value TEXT); CREATE TABLE observed (value TEXT)`);
            raw.run(`CREATE TRIGGER trg_${name} AFTER INSERT ON source BEGIN INSERT INTO ${name} VALUES ('kept'); END;`, []);
            raw.run("INSERT INTO source VALUES ('probe')", []);
            expect(raw.exec(`SELECT value FROM ${name}`)[0]?.values).toEqual([["kept"]]);
          } finally {
            raw.close();
          }
        }
      },
    );

    it.each(r10Identifiers)(
      "public driver preserves whole identifiers across trigger-name, table-name, column, and ordinary statements: %s",
      async (_label, name) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          await db.execute("CREATE TABLE source (id TEXT)");
          await db.execute(`CREATE TABLE ${name} (value TEXT, col_${name} TEXT)`);
          const trgName = `trg_${name}`;
          await db.execute(`CREATE TRIGGER ${trgName} AFTER INSERT ON source BEGIN INSERT INTO ${name} (value) VALUES ('kept'); END;`);
          await db.execute("INSERT INTO source VALUES ('probe')");
          expect(await db.select(`SELECT value FROM ${name}`)).toEqual([{ value: "kept" }]);

          await db.execute(`UPDATE ${name} SET col_${name} = 'updated' WHERE value = 'kept'`);
          expect(await db.select(`SELECT col_${name} AS col FROM ${name}`)).toEqual([{ col: "updated" }]);
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );

    const negativeSuffixes = [
      ["BEGIN", "BEGIN;"],
      ["BEGIN TRANSACTION", "BEGIN TRANSACTION;"],
      ["COMMIT", "COMMIT;"],
      ["SAVEPOINT", "SAVEPOINT sp1;"],
      ["ROLLBACK", "ROLLBACK;"],
      ["ROLLBACK TO", "ROLLBACK TO sp1;"],
      ["RELEASE", "RELEASE sp1;"],
      ["END", "END;"],
    ] as const;

    const r10NegativeCombinations = r10Identifiers.flatMap(([label, name]) =>
      negativeSuffixes.map(([suffixName, suffix]) => ({
        label: `${label} + ${suffixName}`,
        name,
        suffix,
      })),
    );

    it.each(r10NegativeCombinations)(
      "refuses prohibited %s after trigger using whole identifier on execute and select",
      async ({ label: _label, name, suffix }) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        const trgName = `trg_${name}`;
        const prohibitedSql = `CREATE TRIGGER ${trgName} AFTER INSERT ON source BEGIN INSERT INTO ${name} VALUES ('kept'); END; ${suffix}`;
        try {
          await db.execute("CREATE TABLE source (id TEXT)");
          await db.execute(`CREATE TABLE ${name} (value TEXT)`);

          expect(hasTransactionControl(prohibitedSql)).toBe(true);
          await expect(db.execute(prohibitedSql)).rejects.toThrow(/Transactions on this connection must go through/i);
          await expect(db.select(prohibitedSql)).rejects.toThrow(/Transactions on this connection must go through/i);

          const triggers = await db.select<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
            [trgName],
          );
          expect(triggers).toEqual([]);
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );

    it.each(r10Identifiers)(
      "refuses trailing transaction command after an ordinary statement from %s: select, insert, update",
      async (_label, name) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          await db.execute(`CREATE TABLE ${name} (value TEXT)`);
          await db.execute(`INSERT INTO ${name} VALUES ('acknowledged')`);

          expect(hasTransactionControl(`SELECT value FROM ${name}; BEGIN;`)).toBe(true);
          await expect(db.select(`SELECT value FROM ${name}; BEGIN;`)).rejects.toThrow(/Transactions on this connection must go through/i);

          expect(hasTransactionControl(`INSERT INTO ${name} VALUES ('stray'); COMMIT;`)).toBe(true);
          await expect(db.execute(`INSERT INTO ${name} VALUES ('stray'); COMMIT;`)).rejects.toThrow(/Transactions on this connection must go through/i);

          expect(hasTransactionControl(`UPDATE ${name} SET value = 'changed'; ROLLBACK;`)).toBe(true);
          await expect(db.execute(`UPDATE ${name} SET value = 'changed'; ROLLBACK;`)).rejects.toThrow(/Transactions on this connection must go through/i);
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );

    it.each([
      ["case$bucket", "case$bucket"],
      ["écase", "écase"],
      ["✈case", "✈case"],
      ["caſe", "ca\u017Fe"],
    ])(
      "refusal of whole identifier %s precedes side effects: prior rows/tags intact, subsequent atomic save succeeds",
      async (_label, name) => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        const trgName = `trg_${name}`;
        const prohibitedSql = `CREATE TRIGGER ${trgName} AFTER INSERT ON source BEGIN INSERT INTO ${name} VALUES ('kept'); END; BEGIN;`;
        try {
          await db.execute("CREATE TABLE source (id TEXT)");
          await db.execute(`CREATE TABLE ${name} (value TEXT)`);

          await db.saveMaterialAtomically!(create("prior-r10", ["PriorTagR10"], "Prior R10 Title"));
          const prior = await db.select<{ id: string; title: string }>(
            "SELECT id, title FROM study_materials WHERE id = 'prior-r10'",
          );
          expect(prior).toEqual([{ id: "prior-r10", title: "Prior R10 Title" }]);
          expect(await linkedTags(db, "prior-r10")).toEqual(["PriorTagR10"]);

          await expect(db.execute(prohibitedSql)).rejects.toThrow(/Transactions on this connection must go through/i);
          await expect(db.select(prohibitedSql)).rejects.toThrow(/Transactions on this connection must go through/i);

          const triggers = await db.select<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
            [trgName],
          );
          expect(triggers).toEqual([]);

          const liveMaterials = await db.select<{ id: string; title: string }>(
            "SELECT id, title FROM study_materials WHERE id = 'prior-r10'",
          );
          expect(liveMaterials).toEqual([{ id: "prior-r10", title: "Prior R10 Title" }]);
          expect(await linkedTags(db, "prior-r10")).toEqual(["PriorTagR10"]);

          await db.saveMaterialAtomically!(create("after-r10", ["AfterTagR10"], "After R10 Title"));
          const afterMaterials = await db.select<{ id: string; title: string }>(
            "SELECT id, title FROM study_materials ORDER BY id",
          );
          expect(afterMaterials).toEqual([
            { id: "after-r10", title: "After R10 Title" },
            { id: "prior-r10", title: "Prior R10 Title" },
          ]);

          if (engine === "sql.js") {
            const reopened = await createSqlJsDatabase();
            expect(
              await reopened.select<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
                [trgName],
              ),
            ).toEqual([]);
            expect(
              await reopened.select<{ id: string; title: string }>("SELECT id, title FROM study_materials ORDER BY id"),
            ).toEqual([
              { id: "after-r10", title: "After R10 Title" },
              { id: "prior-r10", title: "Prior R10 Title" },
            ]);
            expect(await linkedTags(reopened, "prior-r10")).toEqual(["PriorTagR10"]);
            expect(await linkedTags(reopened, "after-r10")).toEqual(["AfterTagR10"]);
          }
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      },
    );
  });

  /* ------------------- R11 & R10: leading BOM and complete variable tokens ------------------- */

  const r10Variables = ["$value(case)", "$value::ns(case)"] as const;

  describe.each(["node:sqlite", "sql.js"] as const)("R11 leading BOM and R10 variable token compatibility — %s", (engine) => {
    it("raw engine accepts a leading BOM before a real BEGIN transaction", async () => {
      if (engine === "node:sqlite") {
        const native = "node:sqlite";
        const { DatabaseSync } = await import(/* @vite-ignore */ native);
        const raw = new DatabaseSync(":memory:");
        try {
          raw.exec("CREATE TABLE probe(value TEXT)");
          raw.exec("\uFEFFBEGIN; INSERT INTO probe VALUES ('rolled back'); ROLLBACK;");
          expect(raw.prepare("SELECT value FROM probe").all()).toEqual([]);
        } finally {
          raw.close();
        }
      } else {
        const SQL = await initSqlJs({ locateFile: () => WASM });
        const raw = new SQL.Database();
        try {
          raw.run("CREATE TABLE probe(value TEXT)");
          raw.run("\uFEFFBEGIN; INSERT INTO probe VALUES ('rolled back'); ROLLBACK;", []);
          expect(raw.exec("SELECT value FROM probe")[0]?.values ?? []).toEqual([]);
        } finally {
          raw.close();
        }
      }
    });

    describe.each(["execute", "select"] as const)("%s route leading BOM refusal", (route) => {
      it("must refuse a direct leading-BOM BEGIN before opening a transaction", async () => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          await expect(db[route]("\uFEFFBEGIN;")).rejects.toThrow(/Transactions on this connection must go through/i);
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      });

      it("must refuse a leading-BOM SAVEPOINT before opening a transaction", async () => {
        const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
        try {
          await expect(db[route]("\uFEFFSAVEPOINT bom_probe;")).rejects.toThrow(/Transactions on this connection must go through/i);
        } finally {
          if ("close" in db) (db as { close(): void }).close();
        }
      });
    });

    it("BOM refusal must preserve a later acknowledged public write after an unrelated query failure", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE probe(value TEXT)");
        try {
          await db.select("\uFEFFBEGIN;");
        } catch (error) {
          expect(String(error)).toMatch(/Transactions on this connection must go through/i);
        }
        await db.execute("INSERT INTO probe VALUES ('acknowledged')");
        await expect(db.select("SELECT * FROM definitely_missing_table")).rejects.toThrow();
        expect(await db.select("SELECT value FROM probe")).toEqual([{ value: "acknowledged" }]);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it("ordinary statements and quoted identifiers with BOM preserve legal behavior", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        expect(hasTransactionControl("\uFEFFSELECT 1 AS val;")).toBe(false);
        expect(await db.select("\uFEFFSELECT 1 AS val;")).toEqual([{ val: 1 }]);

        await db.execute("\uFEFFCREATE TABLE bom_test (id TEXT, [col\uFEFFname] TEXT)");
        await db.execute("INSERT INTO bom_test VALUES (?, ?)", ["1", "bom-val"]);
        const rows = await db.select<{ id: string; "col\uFEFFname": string }>("SELECT id, [col\uFEFFname] FROM bom_test");
        expect(rows).toEqual([{ id: "1", "col\uFEFFname": "bom-val" }]);

        const stringBOM = await db.select<{ val: string; hex: string }>("SELECT 'prefix:\uFEFF' AS val, hex('\uFEFF') AS hex");
        expect(stringBOM).toEqual([{ val: "prefix:\uFEFF", hex: "EFBBBF" }]);
        // Standalone '\uFEFF' string: both engines store EFBBBF, but Emscripten's wasm bridge in sql.js
        // strips index-0 BOM on UTF-8 string decoding to JS, whereas node:sqlite preserves it.
        const standaloneBOM = await db.select<{ val: string }>("SELECT '\uFEFF' AS val");
        if (engine === "node:sqlite") {
          expect(standaloneBOM).toEqual([{ val: "\uFEFF" }]);
        } else {
          expect(standaloneBOM).toEqual([{ val: "" }]);
        }
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it("unsupported position control: BEGIN followed immediately by BOM is a syntax error, not a transaction command", async () => {
      if (engine === "node:sqlite") {
        const native = "node:sqlite";
        const { DatabaseSync } = await import(/* @vite-ignore */ native);
        const raw = new DatabaseSync(":memory:");
        try {
          expect(() => raw.exec("BEGIN\uFEFF;")).toThrow(/syntax error/i);
        } finally {
          raw.close();
        }
      } else {
        const SQL = await initSqlJs({ locateFile: () => WASM });
        const raw = new SQL.Database();
        try {
          expect(() => raw.run("BEGIN\uFEFF;")).toThrow();
        } finally {
          raw.close();
        }
      }
      expect(hasTransactionControl("BEGIN\uFEFF;")).toBe(false);
    });

    it.each(r10Variables)("raw engine accepts complete SQLite variable %s", async (variable) => {
      if (engine === "node:sqlite") {
        const native = "node:sqlite";
        const { DatabaseSync } = await import(/* @vite-ignore */ native);
        const raw = new DatabaseSync(":memory:");
        try {
          expect(raw.prepare(`SELECT ${variable} IS NULL AS unbound`).all()).toEqual([{ unbound: 1 }]);
        } finally {
          raw.close();
        }
      } else {
        const SQL = await initSqlJs({ locateFile: () => WASM });
        const raw = new SQL.Database();
        try {
          const s = raw.prepare(`SELECT ${variable} IS NULL AS unbound`);
          try {
            const rows = [];
            while (s.step()) rows.push(s.getAsObject());
            expect(rows).toEqual([{ unbound: 1 }]);
          } finally {
            s.free();
          }
        } finally {
          raw.close();
        }
      }
    });

    it.each(r10Variables)("public driver accepts complete SQLite variable %s", async (variable) => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        expect(await db.select(`SELECT ${variable} IS NULL AS unbound`)).toEqual([{ unbound: 1 }]);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    describe.each(r10Variables)("%s", (variable) => {
      describe.each(["execute", "select"] as const)("%s route", (route) => {
        it.each([
          "BEGIN;",
          "COMMIT;",
          "END;",
          "SAVEPOINT sp1;",
          "ROLLBACK;",
          "RELEASE sp1;",
        ])("must refuse trailing %s after a complete parameter token", async (ending) => {
          const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
          try {
            await expect(db[route](`SELECT ${variable} IS NULL AS unbound; ${ending}`)).rejects.toThrow(
              /Transactions on this connection must go through/i,
            );
          } finally {
            if ("close" in db) (db as { close(): void }).close();
          }
        });
      });
    });

    it("positive bound parameters and case-folding controls through public driver API", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE param_tbl (id TEXT, val TEXT)");
        await db.execute("INSERT INTO param_tbl VALUES (?, ?)", ["item-1", "bound-val"]);
        const sel = await db.select<{ id: string; val: string }>("SELECT id, val FROM param_tbl WHERE id = ?", ["item-1"]);
        expect(sel).toEqual([{ id: "item-1", val: "bound-val" }]);

        // Unicode case-folding control with caſe (long-s)
        await db.execute("CREATE TABLE probe_case (ca\u017Fe TEXT)");
        await db.execute("INSERT INTO probe_case (ca\u017Fe) VALUES ('case-content')");
        const caseRows = await db.select<{ caſe: string }>("SELECT ca\u017Fe FROM probe_case");
        expect(caseRows).toEqual([{ "caſe": "case-content" }]);

        // Refuses trailing control following caſe query
        expect(hasTransactionControl("SELECT ca\u017Fe FROM probe_case; BEGIN;")).toBe(true);
        await expect(db.select("SELECT ca\u017Fe FROM probe_case; BEGIN;")).rejects.toThrow(/Transactions on this connection must go through/i);
        await expect(db.execute("UPDATE probe_case SET ca\u017Fe = 'new'; COMMIT;")).rejects.toThrow(/Transactions on this connection must go through/i);

        // ſavepoint identifier control
        await db.execute("CREATE TABLE ſavepoint (val TEXT)");
        await db.execute("INSERT INTO ſavepoint VALUES ('sp-content')");
        expect(await db.select<{ val: string }>("SELECT val FROM ſavepoint")).toEqual([{ val: "sp-content" }]);
        expect(hasTransactionControl("SELECT val FROM ſavepoint; SAVEPOINT sp1;")).toBe(true);
        await expect(db.select("SELECT val FROM ſavepoint; SAVEPOINT sp1;")).rejects.toThrow(/Transactions on this connection must go through/i);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    const r11r12DifferentialForms = [
      { label: "leading decimal in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN .5 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "scientific leading decimal in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN .5e1 > 1 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "signed positive leading decimal in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN +.5 > 0 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "signed negative leading decimal in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN -.5 < 0 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "parenthesized leading decimal in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN (.5 > 0) BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "NEW member qualification in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN NEW.id IS NOT NULL BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "nested CASE in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN CASE WHEN NEW.id IS NOT NULL THEN .5 ELSE 0 END > 0 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before trigger body BEGIN", sql: "CREATE TRIGGER probe AFTER INSERT ON source \uFEFFBEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before TRIGGER", sql: "CREATE \uFEFFTRIGGER probe AFTER INSERT ON source BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before ON", sql: "CREATE TRIGGER probe AFTER INSERT \uFEFFON source BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source \uFEFFWHEN .5 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before body statement", sql: "CREATE TRIGGER probe AFTER INSERT ON source BEGIN \uFEFFINSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before END", sql: "CREATE TRIGGER probe AFTER INSERT ON source BEGIN INSERT INTO target VALUES ('kept'); \uFEFFEND;" },
    ];

    it.each(r11r12DifferentialForms)("raw engine accepts and fires $label", async ({ sql }) => {
      if (engine === "node:sqlite") {
        const native = "node:sqlite";
        const { DatabaseSync } = await import(/* @vite-ignore */ native);
        const raw = new DatabaseSync(":memory:");
        try {
          raw.exec("CREATE TABLE source(id TEXT); CREATE TABLE target(value TEXT);");
          raw.prepare(sql).run();
          raw.prepare("INSERT INTO source VALUES ('fire')").run();
          expect(raw.prepare("SELECT value FROM target").all()).toEqual([{ value: "kept" }]);
        } finally {
          raw.close();
        }
      } else {
        const SQL = await initSqlJs({ locateFile: () => WASM });
        const raw = new SQL.Database();
        try {
          raw.run("CREATE TABLE source(id TEXT); CREATE TABLE target(value TEXT);");
          raw.run(sql, []);
          raw.run("INSERT INTO source VALUES ('fire')", []);
          expect(raw.exec("SELECT value FROM target")[0]?.values).toEqual([["kept"]]);
        } finally {
          raw.close();
        }
      }
    });

    it.each(r11r12DifferentialForms)("public driver accepts and fires $label", async ({ sql }) => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE source(id TEXT)");
        await db.execute("CREATE TABLE target(value TEXT)");
        await db.execute(sql);
        await db.execute("INSERT INTO source VALUES ('fire')");
        expect(await db.select("SELECT value FROM target")).toEqual([{ value: "kept" }]);
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    const eighthReviewSuffixes = [
      "BEGIN;",
      "BEGIN TRANSACTION;",
      "COMMIT;",
      "END;",
      "SAVEPOINT sp1;",
      "ROLLBACK;",
      "ROLLBACK TO sp1;",
      "RELEASE sp1;",
    ];

    const eighthReviewForms = [
      { label: "leading decimal in WHEN", sql: "CREATE TRIGGER probe AFTER INSERT ON source WHEN .5 BEGIN INSERT INTO target VALUES ('kept'); END;" },
      { label: "BOM before trigger body BEGIN", sql: "CREATE TRIGGER probe AFTER INSERT ON source \uFEFFBEGIN INSERT INTO target VALUES ('kept'); END;" },
    ];

    describe.each(eighthReviewForms)("R11/R12 trigger refusal — $label", ({ sql }) => {
      describe.each(["execute", "select"] as const)("%s route", (route) => {
        it.each(eighthReviewSuffixes)("must refuse appended %s before creating trigger", async (suffix) => {
          const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
          try {
            await db.execute("CREATE TABLE source(id TEXT)");
            await db.execute("CREATE TABLE target(value TEXT)");
            const combined = `${sql} ${suffix}`;
            expect(hasTransactionControl(combined)).toBe(true);
            await expect(db[route](combined)).rejects.toThrow(/Transactions on this connection must go through/i);
            expect(await db.select("SELECT name FROM sqlite_master WHERE type='trigger' AND name='probe'")).toEqual([]);
          } finally {
            if ("close" in db) (db as { close(): void }).close();
          }
        });
      });
    });

    it("refusal occurs before trigger creation, preserving prior data, sql.js reopened state, and subsequent save", async () => {
      const db: SqlDatabase = engine === "node:sqlite" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.execute("CREATE TABLE source (id TEXT PRIMARY KEY, title TEXT)");
        await db.execute("CREATE TABLE target (value TEXT)");
        await db.saveMaterialAtomically!({
          mode: "create",
          id: "mat-1",
          fields: { title: "Original Material" },
          tags: ["alpha", "beta"],
        });

        const initialMaterial = await db.select("SELECT id, title FROM study_materials WHERE id = 'mat-1'");
        expect(initialMaterial).toEqual([{ id: "mat-1", title: "Original Material" }]);
        const initialTags = await db.select(
          "SELECT t.name FROM tags t JOIN material_tags mt ON mt.tag_id = t.id WHERE mt.material_id = 'mat-1' ORDER BY t.name",
        );
        expect(initialTags).toEqual([{ name: "alpha" }, { name: "beta" }]);

        const maliciousSql = "CREATE TRIGGER probe AFTER INSERT ON source WHEN .5 BEGIN INSERT INTO target VALUES ('kept'); END; COMMIT;";
        expect(hasTransactionControl(maliciousSql)).toBe(true);
        await expect(db.execute(maliciousSql)).rejects.toThrow(/Transactions on this connection must go through/i);

        const triggers = await db.select("SELECT name FROM sqlite_master WHERE type='trigger' AND name='probe'");
        expect(triggers).toEqual([]);

        const afterMaterial = await db.select("SELECT id, title FROM study_materials WHERE id = 'mat-1'");
        expect(afterMaterial).toEqual([{ id: "mat-1", title: "Original Material" }]);
        const afterTags = await db.select(
          "SELECT t.name FROM tags t JOIN material_tags mt ON mt.tag_id = t.id WHERE mt.material_id = 'mat-1' ORDER BY t.name",
        );
        expect(afterTags).toEqual([{ name: "alpha" }, { name: "beta" }]);

        await db.saveMaterialAtomically!({
          mode: "update",
          id: "mat-1",
          fields: { title: "Updated Material" },
          tags: ["alpha", "gamma"],
        });
        const updatedMaterial = await db.select("SELECT id, title FROM study_materials WHERE id = 'mat-1'");
        expect(updatedMaterial).toEqual([{ id: "mat-1", title: "Updated Material" }]);

        if (engine === "sql.js") {
          const reopened = await createSqlJsDatabase();
          try {
            const reopenedMat = await reopened.select("SELECT id, title FROM study_materials WHERE id = 'mat-1'");
            expect(reopenedMat).toEqual([{ id: "mat-1", title: "Updated Material" }]);
            const reopenedTags = await reopened.select(
              "SELECT t.name FROM tags t JOIN material_tags mt ON mt.tag_id = t.id WHERE mt.material_id = 'mat-1' ORDER BY t.name",
            );
            expect(reopenedTags).toEqual([{ name: "alpha" }, { name: "gamma" }]);
          } finally {
            if ("close" in reopened) (reopened as { close(): void }).close();
          }
        }
      } finally {
        if ("close" in db) (db as { close(): void }).close();
      }
    });

    it("unsupported BOM positions are rejected by engines and scanner", async () => {
      if (engine === "node:sqlite") {
        const native = "node:sqlite";
        const { DatabaseSync } = await import(/* @vite-ignore */ native);
        const raw = new DatabaseSync(":memory:");
        try {
          expect(() => raw.exec("SEL\uFEFFECT 1;")).toThrow(/syntax error/i);
          expect(() => raw.exec("SELECT 1\uFEFF;")).toThrow(/unrecognized token/i);
        } finally {
          raw.close();
        }
      } else {
        const SQL = await initSqlJs({ locateFile: () => WASM });
        const raw = new SQL.Database();
        try {
          expect(() => raw.run("SEL\uFEFFECT 1;")).toThrow();
          expect(() => raw.run("SELECT 1\uFEFF;")).toThrow();
        } finally {
          raw.close();
        }
      }
      expect(hasTransactionControl("SEL\uFEFFECT 1;")).toBe(false);
      expect(hasTransactionControl("SELECT 1\uFEFF;")).toBe(false);
    });
  });

  /* ------------------- R13: a CR inside a line comment is comment text ------------------- */

  // SQLite ends a `--` comment only at LF or the input end; a CR before that
  // LF is still comment text. Raw engines are the oracle for every legal form.

  type R13Engine = "node:sqlite" | "sql.js";
  interface R13Raw {
    exec(sql: string): void;
    query(sql: string): unknown[];
    close(): void;
  }

  async function r13Raw(engine: R13Engine): Promise<R13Raw> {
    if (engine === "node:sqlite") {
      const native = "node:sqlite";
      const { DatabaseSync } = await import(/* @vite-ignore */ native);
      const raw = new DatabaseSync(":memory:");
      return { exec: (sql) => raw.exec(sql), query: (sql) => raw.prepare(sql).all(), close: () => raw.close() };
    }
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const raw = new SQL.Database();
    return {
      exec: (sql) => {
        raw.run(sql);
      },
      query: (sql) => {
        const s = raw.prepare(sql);
        try {
          const rows: unknown[] = [];
          while (s.step()) rows.push(s.getAsObject());
          return rows;
        } finally {
          s.free();
        }
      },
      close: () => raw.close(),
    };
  }

  const r13Driver = (engine: R13Engine): Promise<SqlDatabase> =>
    engine === "node:sqlite" ? createNodeSqliteDatabase() : createSqlJsDatabase();
  const r13Close = (db: SqlDatabase) => {
    if ("close" in db) (db as { close(): void }).close();
  };
  const r13Guard = /Transactions on this connection must go through/i;
  const r13Tables = "CREATE TABLE source(id TEXT); CREATE TABLE target(value TEXT); CREATE TABLE probe(value TEXT);";
  // A real BEGIN leaves `probe` empty; a commented-out BEGIN makes ROLLBACK throw.
  const r13RealTransaction = "BEGIN; INSERT INTO probe VALUES ('rolled back'); ROLLBACK;";

  const r13Suffixes = [
    "BEGIN;",
    "BEGIN TRANSACTION;",
    "COMMIT;",
    "END;",
    "SAVEPOINT sp1;",
    "ROLLBACK;",
    "ROLLBACK TO sp1;",
    "RELEASE sp1;",
  ];

  // Each prefix is one complete line comment ending at its LF.
  const r13CommentPrefixes = [
    { label: "LF", sql: "-- note\n" },
    { label: "CRLF", sql: "-- note\r\n" },
    { label: "embedded CR then text then LF", sql: "--\rignored\n" },
    { label: "multiple embedded CRs", sql: "-- a\rb\r\rc\n" },
    { label: "embedded CR then CRLF", sql: "-- a\rb\r\n" },
    { label: "CASE after CR", sql: "--\rCASE\n" },
    { label: "END after CR", sql: "--\rEND\n" },
    { label: "BEGIN; after CR", sql: "--\rBEGIN;\n" },
    { label: "semicolon and COMMIT after CR", sql: "--\rSELECT 1; COMMIT\n" },
    { label: "single quote after CR", sql: "--\r'unterminated\n" },
    { label: "double quote after CR", sql: '--\r"unterminated\n' },
    { label: "bracket after CR", sql: "--\r[unterminated\n" },
    { label: "backtick after CR", sql: "--\r`unterminated\n" },
    { label: "block-comment opener after CR", sql: "--\r/* not a block\n" },
  ];

  const r13Trigger = (header: string, body = "INSERT INTO target VALUES ('kept'); END;") =>
    `${header} BEGIN ${body}`;
  const r13TriggerForms = [
    { label: "between CREATE and TRIGGER", sql: r13Trigger("CREATE --\rignored\nTRIGGER probe AFTER INSERT ON source") },
    { label: "between TEMP and TRIGGER", sql: r13Trigger("CREATE TEMP --\rignored\nTRIGGER probe AFTER INSERT ON source"), temp: true },
    { label: "between TEMPORARY and TRIGGER with CRLF", sql: r13Trigger("CREATE TEMPORARY --\rignored\r\nTRIGGER probe AFTER INSERT ON source"), temp: true },
    { label: "before the trigger name", sql: r13Trigger("CREATE TRIGGER --\rEND\nprobe AFTER INSERT ON source") },
    { label: "after the ON target", sql: r13Trigger("CREATE TRIGGER probe AFTER INSERT ON source --\rBEGIN\n") },
    { label: "inside WHEN", sql: r13Trigger("CREATE TRIGGER probe AFTER INSERT ON source WHEN --\rCASE\n 1") },
    { label: "at body start", sql: r13Trigger("CREATE TRIGGER probe AFTER INSERT ON source", "--\rEND;\n INSERT INTO target VALUES ('kept'); END;") },
    { label: "before the outer END", sql: r13Trigger("CREATE TRIGGER probe AFTER INSERT ON source", "INSERT INTO target VALUES ('kept'); --\rCASE\n END;") },
  ];

  const r13TrailingContexts = [
    { label: "valid SELECT", sql: "SELECT 1 AS value;\n--\rignored\n", trigger: false },
    { label: "completed trigger", sql: `${r13Trigger("CREATE TRIGGER probe AFTER INSERT ON source")}\n--\rCASE\n`, trigger: true },
    { label: "completed trigger with CR comment before END", sql: `${r13TriggerForms[7]!.sql}\n--\rignored\n`, trigger: true },
  ];

  const r13OpaqueAccepted = [
    { label: "block comment holding CR, LF and BEGIN", sql: "/* \r\nBEGIN;\r */ SELECT 7 AS value", rows: [{ value: 7 }] },
    { label: "block comment holding a line-comment marker", sql: "/* --\r */ SELECT 7 AS value", rows: [{ value: 7 }] },
    { label: "string holding a line-comment marker, CR and LF", sql: "SELECT 'x\r--y\nBEGIN;' AS value", rows: [{ value: "x\r--y\nBEGIN;" }] },
    { label: "quoted identifier holding CR, LF and BEGIN", sql: 'SELECT 7 AS "v\r\nBEGIN"', rows: [{ "v\r\nBEGIN": 7 }] },
    { label: "CR as whitespace between tokens", sql: "SELECT\r7\rAS\rvalue", rows: [{ value: 7 }] },
  ];

  const r13OpaqueRefused = [
    { label: "after a block comment holding a line-comment marker", sql: "/* --\r */BEGIN;" },
    { label: "after a string holding a line-comment marker", sql: "SELECT '--\r' AS value; BEGIN;" },
    { label: "after an identifier holding a line-comment marker", sql: 'SELECT 1 AS "--\r"; BEGIN;' },
    { label: "after a bare CR", sql: "\rBEGIN;" },
    { label: "after a statement and CR", sql: "SELECT 1;\rBEGIN;" },
  ];

  describe.each(["node:sqlite", "sql.js"] as const)("R13 line-comment boundary \u2014 %s", (engine) => {
    describe("comment ends only at LF", () => {
      it.each(r13CommentPrefixes)("raw control: $label is one comment and the BEGIN after it is real", async ({ sql }) => {
        const raw = await r13Raw(engine);
        try {
          raw.exec(r13Tables);
          raw.exec(`${sql}${r13RealTransaction}`);
          expect(raw.query("SELECT value FROM probe")).toEqual([]);
          expect(raw.query(`${sql}SELECT 7 AS value`)).toEqual([{ value: 7 }]);
        } finally {
          raw.close();
        }
      });

      it.each(r13CommentPrefixes)("public driver accepts valid SQL after $label", async ({ sql }) => {
        const db = await r13Driver(engine);
        try {
          await db.execute("CREATE TABLE probe(value TEXT)");
          expect(hasTransactionControl(`${sql}SELECT 7 AS value`)).toBe(false);
          expect(await db.select(`${sql}SELECT 7 AS value`)).toEqual([{ value: 7 }]);
          await expect(db.execute(`${sql}INSERT INTO probe VALUES ('kept')`)).resolves.toBeUndefined();
          expect(await db.select("SELECT value FROM probe")).toEqual([{ value: "kept" }]);
        } finally {
          r13Close(db);
        }
      });

      describe.each(r13CommentPrefixes)("after $label", ({ sql }) => {
        describe.each(["execute", "select"] as const)("%s route", (route) => {
          it.each(r13Suffixes)("refuses %s", async (suffix) => {
            const db = await r13Driver(engine);
            try {
              expect(hasTransactionControl(`${sql}${suffix}`)).toBe(true);
              await expect(db[route](`${sql}${suffix}`)).rejects.toThrow(r13Guard);
            } finally {
              r13Close(db);
            }
          });
        });
      });
    });

    describe("comment runs to input end when no LF follows the CR", () => {
      it("raw control: everything after the CR is comment text", async () => {
        const raw = await r13Raw(engine);
        try {
          expect(raw.query("SELECT 7 AS value --\rBEGIN;")).toEqual([{ value: 7 }]);
          expect(raw.query("SELECT 7 AS value --\r")).toEqual([{ value: 7 }]);
          raw.exec("SELECT 1; --\r\rBEGIN;");
          expect(() => raw.exec("COMMIT")).toThrow(/no transaction is active/i);
        } finally {
          raw.close();
        }
      });

      it("public driver accepts SQL whose trailing comment holds a transaction keyword", async () => {
        const db = await r13Driver(engine);
        try {
          await db.execute("CREATE TABLE probe(value TEXT)");
          expect(hasTransactionControl("SELECT 7 AS value --\rBEGIN;")).toBe(false);
          expect(await db.select("SELECT 7 AS value --\rBEGIN;")).toEqual([{ value: 7 }]);
          expect(await db.select("SELECT 7 AS value --\r")).toEqual([{ value: 7 }]);
          await expect(db.execute("INSERT INTO probe VALUES ('kept') --\rCOMMIT;")).resolves.toBeUndefined();
          expect(await db.select("SELECT value FROM probe")).toEqual([{ value: "kept" }]);
        } finally {
          r13Close(db);
        }
      });

      describe.each(["execute", "select"] as const)("%s route", (route) => {
        it.each(r13Suffixes)("still refuses %s written before the trailing comment", async (suffix) => {
          const db = await r13Driver(engine);
          try {
            expect(hasTransactionControl(`${suffix} --\rtrailing`)).toBe(true);
            await expect(db[route](`${suffix} --\rtrailing`)).rejects.toThrow(r13Guard);
          } finally {
            r13Close(db);
          }
        });
      });

      it("unsupported-syntax record: comment-only input has no statement, so it is not a positive public control", async () => {
        const raw = await r13Raw(engine);
        try {
          raw.exec("--\rBEGIN;");
          expect(() => raw.exec("COMMIT")).toThrow(/no transaction is active/i);
        } finally {
          raw.close();
        }
        expect(hasTransactionControl("--\rBEGIN;")).toBe(false);
      });
    });

    describe("trailing commands after a valid statement or completed trigger", () => {
      it.each(r13TrailingContexts)("raw control: a BEGIN after $label and a CR comment is real", async ({ sql, trigger }) => {
        const raw = await r13Raw(engine);
        try {
          raw.exec(r13Tables);
          raw.exec(`${sql}${r13RealTransaction}`);
          expect(raw.query("SELECT value FROM probe")).toEqual([]);
          if (trigger) {
            raw.exec("INSERT INTO source VALUES ('fire')");
            expect(raw.query("SELECT value FROM target")).toEqual([{ value: "kept" }]);
          }
        } finally {
          raw.close();
        }
      });

      describe.each(r13TrailingContexts)("after $label", ({ sql }) => {
        describe.each(["execute", "select"] as const)("%s route", (route) => {
          it.each(r13Suffixes)("refuses %s before creating anything", async (suffix) => {
            const db = await r13Driver(engine);
            try {
              await db.execute("CREATE TABLE source(id TEXT)");
              await db.execute("CREATE TABLE target(value TEXT)");
              expect(hasTransactionControl(`${sql}${suffix}`)).toBe(true);
              await expect(db[route](`${sql}${suffix}`)).rejects.toThrow(r13Guard);
              expect(await db.select("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'probe'")).toEqual([]);
            } finally {
              r13Close(db);
            }
          });
        });
      });
    });

    describe("CREATE TRIGGER lookahead, header and body comments", () => {
      it.each(r13TriggerForms)("raw control: trigger with a CR comment $label is legal and fires", async ({ sql }) => {
        const raw = await r13Raw(engine);
        try {
          raw.exec(r13Tables);
          raw.exec(sql);
          raw.exec("INSERT INTO source VALUES ('fire')");
          expect(raw.query("SELECT value FROM target")).toEqual([{ value: "kept" }]);
        } finally {
          raw.close();
        }
      });

      // sql.js's durable write exports and reopens the connection, which drops
      // the temp schema; its TEMP forms are recorded separately below.
      const r13PublicFiring = r13TriggerForms.filter((form) => engine === "node:sqlite" || !("temp" in form));

      it.each(r13PublicFiring)("public driver creates and fires trigger with a CR comment $label", async ({ sql }) => {
        const db = await r13Driver(engine);
        try {
          await db.execute("CREATE TABLE source(id TEXT)");
          await db.execute("CREATE TABLE target(value TEXT)");
          expect(hasTransactionControl(sql)).toBe(false);
          await expect(db.execute(sql)).resolves.toBeUndefined();
          await db.execute("INSERT INTO source VALUES ('fire')");
          expect(await db.select("SELECT value FROM target")).toEqual([{ value: "kept" }]);
        } finally {
          r13Close(db);
        }
      });

      if (engine === "sql.js") {
        it.each(r13TriggerForms.filter((form) => "temp" in form))(
          "driver-limitation record: TEMP trigger with a CR comment $label is accepted, but export drops it exactly as without a comment",
          async ({ sql }) => {
            const db = await r13Driver(engine);
            try {
              await db.execute("CREATE TABLE source(id TEXT)");
              await db.execute("CREATE TABLE target(value TEXT)");
              expect(hasTransactionControl(sql)).toBe(false);
              await expect(db.execute(sql)).resolves.toBeUndefined();
              const plain = "CREATE TEMP TRIGGER plain AFTER INSERT ON source BEGIN INSERT INTO target VALUES ('plain'); END;";
              await expect(db.execute(plain)).resolves.toBeUndefined();
              expect(await db.select("SELECT name FROM sqlite_temp_master WHERE type = 'trigger'")).toEqual([]);
            } finally {
              r13Close(db);
            }
          },
        );
      }

      describe.each(r13TriggerForms)("trigger with a CR comment $label", ({ sql }) => {
        it.each(["execute", "select"] as const)("%s route refuses an appended BEGIN before creating it", async (route) => {
          const db = await r13Driver(engine);
          try {
            await db.execute("CREATE TABLE source(id TEXT)");
            await db.execute("CREATE TABLE target(value TEXT)");
            expect(hasTransactionControl(`${sql} BEGIN;`)).toBe(true);
            await expect(db[route](`${sql} BEGIN;`)).rejects.toThrow(r13Guard);
            expect(await db.select("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'probe'")).toEqual([]);
          } finally {
            r13Close(db);
          }
        });
      });

      it("raw control: TRIGGER inside a CR comment after CREATE leaves an ordinary CREATE TABLE", async () => {
        const raw = await r13Raw(engine);
        try {
          raw.exec(r13Tables);
          raw.exec(`CREATE --\rTRIGGER\nTABLE t1(x); ${r13RealTransaction}`);
          expect(raw.query("SELECT name FROM sqlite_master WHERE name = 't1'")).toEqual([{ name: "t1" }]);
          expect(raw.query("SELECT value FROM probe")).toEqual([]);
        } finally {
          raw.close();
        }
      });

      it("public driver treats CREATE --\\rTRIGGER\\nTABLE as a table, not a trigger header", async () => {
        const db = await r13Driver(engine);
        try {
          expect(hasTransactionControl("CREATE --\rTRIGGER\nTABLE t1(x)")).toBe(false);
          await expect(db.execute("CREATE --\rTRIGGER\nTABLE t1(x)")).resolves.toBeUndefined();
          expect(await db.select("SELECT name FROM sqlite_master WHERE name = 't1'")).toEqual([{ name: "t1" }]);
          expect(hasTransactionControl("CREATE --\rTRIGGER\nTABLE t2(x); BEGIN;")).toBe(true);
          await expect(db.execute("CREATE --\rTRIGGER\nTABLE t2(x); BEGIN;")).rejects.toThrow(r13Guard);
          await expect(db.select("CREATE --\rTRIGGER\nTABLE t2(x); BEGIN;")).rejects.toThrow(r13Guard);
          expect(await db.select("SELECT name FROM sqlite_master WHERE name = 't2'")).toEqual([]);
        } finally {
          r13Close(db);
        }
      });
    });

    describe("block comments, quoted tokens and CR whitespace outside comments", () => {
      it.each(r13OpaqueAccepted)("raw control: $label", async ({ sql, rows }) => {
        const raw = await r13Raw(engine);
        try {
          expect(raw.query(sql)).toEqual(rows);
        } finally {
          raw.close();
        }
      });

      it.each(r13OpaqueAccepted)("public driver accepts $label", async ({ sql, rows }) => {
        const db = await r13Driver(engine);
        try {
          expect(hasTransactionControl(sql)).toBe(false);
          expect(await db.select(sql)).toEqual(rows);
        } finally {
          r13Close(db);
        }
      });

      it.each(r13OpaqueRefused)("raw control: BEGIN $label is real", async ({ sql }) => {
        const raw = await r13Raw(engine);
        try {
          raw.exec(r13Tables);
          raw.exec(`${sql} INSERT INTO probe VALUES ('rolled back'); ROLLBACK;`);
          expect(raw.query("SELECT value FROM probe")).toEqual([]);
        } finally {
          raw.close();
        }
      });

      describe.each(r13OpaqueRefused)("BEGIN $label", ({ sql }) => {
        it.each(["execute", "select"] as const)("%s route refuses it", async (route) => {
          const db = await r13Driver(engine);
          try {
            expect(hasTransactionControl(sql)).toBe(true);
            await expect(db[route](sql)).rejects.toThrow(r13Guard);
          } finally {
            r13Close(db);
          }
        });
      });
    });

    describe("refusal precedes side effects", () => {
      const lossCases = ["--\rignored\nBEGIN;", "--\rCASE\nBEGIN;", "--\r'\nBEGIN;", "SELECT 1;\n--\r/*\nSAVEPOINT sp1;"];

      describe.each(["execute", "select"] as const)("%s route", (route) => {
        it.each(lossCases)("refusing %j keeps a later acknowledged write after an unrelated failure", async (sql) => {
          const db = await r13Driver(engine);
          try {
            await db.execute("CREATE TABLE probe(value TEXT)");
            await expect(db[route](sql)).rejects.toThrow(r13Guard);
            await db.execute("INSERT INTO probe VALUES ('acknowledged')");
            await expect(db.select("SELECT * FROM definitely_missing_table")).rejects.toThrow();
            expect(await db.select("SELECT value FROM probe")).toEqual([{ value: "acknowledged" }]);
            if (engine === "sql.js") {
              const reopened = await createSqlJsDatabase();
              expect(await reopened.select("SELECT value FROM probe")).toEqual([{ value: "acknowledged" }]);
            }
          } finally {
            r13Close(db);
          }
        });
      });

      it("prior material fields/tags, unrelated rows and sql.js storage survive; the next atomic save succeeds", async () => {
        const db = await r13Driver(engine);
        try {
          await db.execute("CREATE TABLE source(id TEXT)");
          await db.execute("CREATE TABLE target(value TEXT)");
          await db.execute("CREATE TABLE unrelated(id TEXT PRIMARY KEY)");
          await db.execute("INSERT INTO unrelated VALUES ('kept')");
          await db.saveMaterialAtomically!(create("prior-mat", ["PriorTag"], "Prior Title"));
          const materialRow = "SELECT id, title, notes FROM study_materials WHERE id = 'prior-mat'";
          const before = await db.select(materialRow);

          for (const sql of [
            "--\rignored\nBEGIN;",
            "--\rCASE\nUPDATE study_materials SET title = 'Changed'; COMMIT;",
            `${r13TriggerForms[0]!.sql} SAVEPOINT sp1;`,
            "DELETE FROM unrelated;\n--\r'\nROLLBACK;",
          ]) {
            await expect(db.execute(sql)).rejects.toThrow(r13Guard);
            await expect(db.select(sql)).rejects.toThrow(r13Guard);
          }

          expect(await db.select(materialRow)).toEqual(before);
          expect(await linkedTags(db, "prior-mat")).toEqual(["PriorTag"]);
          expect(await db.select("SELECT id FROM unrelated")).toEqual([{ id: "kept" }]);
          expect(await db.select("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'probe'")).toEqual([]);

          await db.saveMaterialAtomically!(create("after-mat", ["AfterTag"], "After Title"));
          expect(await materialIds(db)).toEqual(["after-mat", "prior-mat"]);
          expect(await linkedTags(db, "after-mat")).toEqual(["AfterTag"]);

          if (engine === "sql.js") {
            const reopened = await createSqlJsDatabase();
            expect(await reopened.select(materialRow)).toEqual(before);
            expect(await linkedTags(reopened, "prior-mat")).toEqual(["PriorTag"]);
            expect(await linkedTags(reopened, "after-mat")).toEqual(["AfterTag"]);
            expect(await reopened.select("SELECT id FROM unrelated")).toEqual([{ id: "kept" }]);
          }
        } finally {
          r13Close(db);
        }
      });
    });
  });
});
