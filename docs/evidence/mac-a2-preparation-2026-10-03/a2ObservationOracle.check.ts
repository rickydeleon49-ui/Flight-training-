// TASK-LOCAL ORACLE CONTROLS for the prepared A2 observations (PREP-R1 to PREP-R3), 3 October 2026.
//
// What this validates: the helpers in a2DiagnosticObservations.ts that the prepared diagnostics
// use. It does NOT execute A2 and calls no A2 API. A small harness built here stands in for "a
// correct single-connection owner" (FIFO queue, one BEGIN IMMEDIATE ... COMMIT per save) and, for
// negative controls, for "no owner". The harness is test code in this file, not production code.
//
// Data: synthetic only. Real node:sqlite (Node 22) and real sql.js engines, each database built in
// memory with the project's own migrations (`applyMigrations` from src/data/migrations.ts).
// Every handle is closed and every barrier restored in afterEach, even when an assertion fails.
//
// Named *.check.ts and kept under docs/evidence, so neither the app's Vitest include
// (src/**/*.test.ts) nor tsc (include: src) picks it up. Run it with the task-local config
// described in this folder's README.
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/data/migrations";
import {
  LINK_INSERT,
  classifyCreate,
  fullState,
  installStatementBarrier,
  integrityProblems,
  observeMaterial,
  proveForeignKeyEnforcement,
  restoreAllBarriers,
  sameState,
  stateDifferences,
  updateOutcomeProblems,
  type BarrierTarget,
  type WritableQueryable,
} from "./a2DiagnosticObservations";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
type Engine = "node:sqlite" | "sql.js";
const ENGINES: Engine[] = ["node:sqlite", "sql.js"];
type Params = Array<string | number | null>;

interface SaveOp {
  mode: "create" | "update";
  id: string;
  title: string;
  tags?: string[];
}
interface Harness extends WritableQueryable {
  engine: Engine;
  save(op: SaveOp, options?: { asyncPreparation?: boolean }): Promise<void>;
  /** Unowned direct statement for building synthetic (possibly corrupt) datasets. */
  raw(sql: string): void;
  reopen(): Promise<Harness>;
  targets: BarrierTarget[];
  close(): void;
}

const open: Harness[] = [];
afterEach(() => {
  restoreAllBarriers();
  for (const h of open.splice(0)) h.close();
});

/**
 * owner "fifo": every select/execute/save is one queued operation, run strictly in request order.
 * owner "none": operations hit the engine immediately (negative-control stand-in for a broken owner).
 */
async function harness(engine: Engine, owner: "fifo" | "none", durable?: Uint8Array): Promise<Harness> {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => T): Promise<T> => {
    if (owner === "none") {
      try {
        return Promise.resolve(fn());
      } catch (e) {
        return Promise.reject(e);
      }
    }
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  };

  let select: (sql: string, params: Params) => Record<string, unknown>[];
  let exec1: (sql: string, params: Params) => void;
  let script: (sql: string) => void;
  let persist = () => {};
  let reopenFrom: () => Promise<Harness>;
  let closeEngine: () => void;
  let targets: BarrierTarget[];

  if (engine === "node:sqlite") {
    const specifier = "node:sqlite";
    const { DatabaseSync } = await import(/* @vite-ignore */ specifier);
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    await applyMigrations((sql) => db.exec(sql), new Set());
    select = (sql, params) => db.prepare(sql).all(...params).map((r: object) => ({ ...r }));
    exec1 = (sql, params) => void db.prepare(sql).run(...params);
    script = (sql) => db.exec(sql);
    reopenFrom = async () => {
      throw new Error("node:sqlite :memory: harness has no reopen");
    };
    closeEngine = () => db.close();
    targets = [{ proto: DatabaseSync.prototype, methods: ["prepare", "exec"] }];
  } else {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const db = durable ? new SQL.Database(durable) : new SQL.Database();
    db.run("PRAGMA foreign_keys = ON");
    if (!durable) await applyMigrations((sql) => db.run(sql), new Set());
    let stored = db.export();
    db.run("PRAGMA foreign_keys = ON"); // export() resets it (engine-probe.json)
    persist = () => {
      stored = db.export();
      db.run("PRAGMA foreign_keys = ON");
    };
    select = (sql, params) => {
      const s = db.prepare(sql);
      try {
        s.bind(params);
        const rows: Record<string, unknown>[] = [];
        while (s.step()) rows.push(s.getAsObject() as Record<string, unknown>);
        return rows;
      } finally {
        s.free();
      }
    };
    exec1 = (sql, params) => void db.run(sql, params);
    script = (sql) => void db.exec(sql);
    reopenFrom = () => harness("sql.js", owner, stored);
    closeEngine = () => db.close();
    targets = [{ proto: SQL.Database.prototype, methods: ["prepare", "run", "exec"] }];
  }

  const h: Harness = {
    engine,
    targets,
    select: <T,>(sql: string, params: never[] = []) => run(() => select(sql, params as Params) as T[]),
    execute: (sql: string, params: never[] = []) =>
      run(() => {
        exec1(sql, params as Params);
        persist();
      }),
    raw: (sql) => script(sql),
    async save(op, options = {}) {
      if (options.asyncPreparation) await Promise.resolve(); // harmless async work before ownership
      return run(() => {
        const at = "2026-10-03T12:00:00.000Z";
        script("BEGIN IMMEDIATE");
        try {
          if (op.mode === "create") {
            exec1("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [op.id, op.title, at, at]);
          } else {
            exec1("UPDATE study_materials SET title = ?, updated_at = ? WHERE id = ?", [op.title, at, op.id]);
          }
          if (op.tags !== undefined) {
            exec1("DELETE FROM material_tags WHERE material_id = ?", [op.id]);
            for (const name of op.tags) {
              exec1("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)", [`tag:${name}`, name, at]);
              exec1("INSERT INTO material_tags (material_id, tag_id) SELECT ?, id FROM tags WHERE name = ?", [op.id, name]);
            }
          }
          script("COMMIT");
        } catch (e) {
          script("ROLLBACK");
          throw e;
        }
        persist();
      });
    },
    reopen: () => reopenFrom(),
    close: () => closeEngine(),
  };
  open.push(h);
  return h;
}

const EXPECTED = { title: "Synthetic guide", tags: ["Synthetic tag", "Second tag"] };
const CREATE: SaveOp = { mode: "create", id: "guide", ...EXPECTED };
const observe = (h: Harness) => observeMaterial(h, "guide", EXPECTED.tags);

/* ------------------------------------------------------------------------------------------ */
/* PREP-R1: coherent single-statement observation                                              */
/* ------------------------------------------------------------------------------------------ */

describe("PREP-R1 oracle: observeMaterial/classifyCreate", () => {
  for (const engine of ENGINES) {
    it(`[R1-1] ${engine}: a read queued before the save acquires ownership is coherent "none"`, async () => {
      const h = await harness(engine, "fifo");
      const reading = observe(h);
      const saving = h.save(CREATE);
      const seen = await reading;
      await saving;
      expect(classifyCreate(seen, EXPECTED)).toBe("none");
      expect(classifyCreate(await observe(h), EXPECTED)).toBe("complete");
    });

    it(`[R1-2] ${engine}: a read after the complete save is coherent "complete"`, async () => {
      const h = await harness(engine, "fifo");
      await h.save(CREATE);
      expect(classifyCreate(await observe(h), EXPECTED)).toBe("complete");
    });

    it(`[R1-3] ${engine}: Codex's schedule (save invoked first, async preparation, FIFO) stays coherent`, async () => {
      const h = await harness(engine, "fifo");
      const saving = h.save(CREATE, { asyncPreparation: true });
      const reading = observe(h);
      const [seen] = await Promise.all([reading, saving]);
      expect(classifyCreate(seen, EXPECTED)).toBe("none");
      // The historical multi-read aggregate is incoherent under the same schedule.
      const h2 = await harness(engine, "fifo");
      const saving2 = h2.save(CREATE, { asyncPreparation: true });
      const firstRead = h2.select<{ n: number }>("SELECT count(*) AS n FROM study_materials");
      await saving2;
      const secondRead = h2.select<{ n: number }>("SELECT count(*) AS n FROM material_tags");
      const aggregate = { materials: Number((await firstRead)[0]!.n), links: Number((await secondRead)[0]!.n) };
      expect(aggregate).toEqual({ materials: 0, links: 2 }); // neither none nor complete: why fullState must not race
    });

    it(`[R1-4] ${engine}: intentionally partial datasets are classified "partial"`, async () => {
      const at = "2026-10-03T12:00:00.000Z";
      const cases: Array<[string, string]> = [
        ["row without tags or links", `INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('guide', 'Synthetic guide', '${at}', '${at}')`],
        ["row and tags without links", `INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('guide', 'Synthetic guide', '${at}', '${at}');
          INSERT INTO tags (id, name, created_at) VALUES ('t1', 'Synthetic tag', '${at}'), ('t2', 'Second tag', '${at}')`],
        ["one of two links", `INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('guide', 'Synthetic guide', '${at}', '${at}');
          INSERT INTO tags (id, name, created_at) VALUES ('t1', 'Synthetic tag', '${at}'), ('t2', 'Second tag', '${at}');
          INSERT INTO material_tags (material_id, tag_id) VALUES ('guide', 't1')`],
        ["complete links but the old title", `INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('guide', 'Old title', '${at}', '${at}');
          INSERT INTO tags (id, name, created_at) VALUES ('t1', 'Synthetic tag', '${at}'), ('t2', 'Second tag', '${at}');
          INSERT INTO material_tags (material_id, tag_id) VALUES ('guide', 't1'), ('guide', 't2')`],
        ["a dangling link", `PRAGMA foreign_keys = OFF;
          INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('guide', 'Synthetic guide', '${at}', '${at}');
          INSERT INTO tags (id, name, created_at) VALUES ('t1', 'Synthetic tag', '${at}'), ('t2', 'Second tag', '${at}');
          INSERT INTO material_tags (material_id, tag_id) VALUES ('guide', 't1'), ('guide', 'missing');
          PRAGMA foreign_keys = ON`],
      ];
      const classes: Record<string, string> = {};
      for (const [label, sql] of cases) {
        const h = await harness(engine, "fifo");
        h.raw(sql);
        classes[label] = classifyCreate(await observe(h), EXPECTED);
      }
      expect(classes).toEqual(Object.fromEntries(cases.map(([label]) => [label, "partial"])));
    });

    it(`[R1-5] ${engine}: barrier positive control: a read requested while a FIFO owner holds the save is "complete"`, async () => {
      const h = await harness(engine, "fifo");
      let pending: Promise<unknown> | undefined;
      const barrier = installStatementBarrier(h.targets, LINK_INSERT, () => {
        pending = observe(h);
      });
      await h.save(CREATE);
      barrier.restore();
      expect(barrier.fired()).toBe(1);
      if (engine === "node:sqlite") expect(barrier.events()[0]!.engineReportsTransaction).toBe(true);
      expect(classifyCreate((await pending) as never, EXPECTED)).toBe("complete");
    });

    it(`[R1-6] ${engine}: barrier negative control: with no owner the same request enters the transaction ("partial")`, async () => {
      const h = await harness(engine, "none");
      let pending: Promise<unknown> | undefined;
      const barrier = installStatementBarrier(h.targets, LINK_INSERT, () => {
        pending = observe(h);
      });
      await h.save(CREATE);
      barrier.restore();
      expect(barrier.fired()).toBe(1);
      expect(classifyCreate((await pending) as never, EXPECTED)).toBe("partial");
    });
  }
});

/* ------------------------------------------------------------------------------------------ */
/* PREP-R2: complete identity and link state                                                   */
/* ------------------------------------------------------------------------------------------ */

async function baseline(engine: Engine) {
  const h = await harness(engine, "fifo");
  await h.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
  await h.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
  await h.save({ mode: "create", id: "guide", title: "Synthetic guide", tags: ["Synthetic tag"] });
  await h.execute("INSERT INTO tags (id, name, created_at) VALUES ('tag:Other tag', 'Other tag', '2026-10-03T12:00:00.000Z')");
  return h;
}

describe("PREP-R2 oracle: fullState/sameState/integrityProblems", () => {
  for (const engine of ENGINES) {
    it(`[R2-1] ${engine}: the same tag name under a changed tag id is detected`, async () => {
      const h = await baseline(engine);
      const before = await fullState(h);
      h.raw(`PRAGMA foreign_keys = OFF;
        UPDATE tags SET id = 'changed-id' WHERE name = 'Synthetic tag';
        UPDATE material_tags SET tag_id = 'changed-id' WHERE tag_id = 'tag:Synthetic tag';
        PRAGMA foreign_keys = ON`);
      const after = await fullState(h);
      expect(after.resolvedLinks).toEqual(before.resolvedLinks); // the readable view alone would miss it
      expect(sameState(before, after)).toBe(false);
      expect(stateDifferences(before, after)).toEqual(["tags", "materialTags"]);
    });

    it(`[R2-2] ${engine}: changed raw link ids are detected`, async () => {
      const h = await baseline(engine);
      const before = await fullState(h);
      h.raw("UPDATE material_tags SET tag_id = 'tag:Other tag' WHERE material_id = 'guide'");
      const after = await fullState(h);
      expect(sameState(before, after)).toBe(false);
      expect(stateDifferences(before, after)).toEqual(["materialTags", "resolvedLinks"]);
    });

    it(`[R2-3] ${engine}: an extra dangling link is detected, counted and kept visible`, async () => {
      const h = await baseline(engine);
      const before = await fullState(h);
      h.raw("PRAGMA foreign_keys = OFF; INSERT INTO material_tags (material_id, tag_id) VALUES ('guide', 'nonexistent-tag'); PRAGMA foreign_keys = ON");
      const after = await fullState(h);
      expect(sameState(before, after)).toBe(false);
      expect(after.integrity).toMatchObject({ linkCount: 2, danglingTagRefs: 1 });
      expect(after.resolvedLinks).toContainEqual({ id: "guide", tag: null });
      expect(integrityProblems(after)).toEqual(["1 link(s) to a missing tag"]);
      expect(integrityProblems(before)).toEqual([]);
    });

    it(`[R2-4] ${engine}: a stray tag after a rejected operation is detected`, async () => {
      const h = await baseline(engine);
      const before = await fullState(h);
      h.raw("INSERT INTO tags (id, name, created_at) VALUES ('stray', 'Stray tag', '2026-10-03T12:00:00.000Z')");
      const after = await fullState(h);
      expect(sameState(before, after)).toBe(false);
      expect(stateDifferences(before, after)).toEqual(["tags", "integrity"]);
    });

    it(`[R2-5] ${engine}: an unchanged full state is accepted, including after a really rejected save`, async () => {
      const h = await baseline(engine);
      const before = await fullState(h);
      await h.execute(`CREATE TRIGGER synthetic_link_fault BEFORE INSERT ON material_tags
        WHEN (SELECT name FROM tags WHERE id = NEW.tag_id) = 'Poison tag'
        BEGIN SELECT RAISE(ABORT, 'synthetic tag-link failure'); END`);
      const withTrigger = await fullState(h);
      await expect(h.save({ mode: "update", id: "guide", title: "Changed guide", tags: ["New tag", "Poison tag"] })).rejects.toThrow(/synthetic tag-link failure/);
      expect(sameState(withTrigger, await fullState(h))).toBe(true);
      expect(sameState(before, withTrigger)).toBe(true); // a trigger is schema, not stored rows
      if (engine === "sql.js") expect(sameState(await fullState(h), await fullState(await h.reopen()))).toBe(true);
    });

    it(`[R2-6] ${engine}: the unrelated table is reported absent explicitly, and other read failures propagate`, async () => {
      const h = await harness(engine, "fifo");
      expect((await fullState(h)).unrelated).toEqual({ status: "absent" });
      await h.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
      expect((await fullState(h)).unrelated).toEqual({ status: "present", rows: [] });
      const failing = {
        select: (sql: string, params?: never[]) =>
          sql.includes("FROM unrelated") ? Promise.reject(new Error("synthetic read failure")) : h.select(sql, params),
      };
      await expect(fullState(failing as never)).rejects.toThrow("synthetic read failure");
    });

    it(`[R2-7] ${engine}: foreign-key proof distinguishes enforcement, fail-closed refusal and other errors`, async () => {
      const h = await harness(engine, "fifo");
      const enforced = await proveForeignKeyEnforcement(h);
      expect(enforced).toMatchObject({ kind: "enforced", setting: 1, usableWrite: true });
      const refusing = { ...h, select: h.select, execute: () => Promise.reject(new Error("synthetic: connection could not be made safe")) };
      expect(await proveForeignKeyEnforcement(refusing)).toEqual({ kind: "fail-closed", refusal: "synthetic: connection could not be made safe" });
      const otherReason = {
        select: h.select,
        execute: (sql: string, params?: never[]) =>
          sql.includes("material_tags") ? Promise.reject(new Error("synthetic unrelated failure")) : h.execute(sql, params),
      };
      expect(await proveForeignKeyEnforcement(otherReason)).toMatchObject({ kind: "not-enforced" });
      // A genuinely disabled setting is reported, not mistaken for enforcement. (node:sqlite only:
      // this sql.js harness re-enables the setting after every persist, as a driver must.)
      if (engine === "node:sqlite") {
        h.raw("PRAGMA foreign_keys = OFF");
        expect(await proveForeignKeyEnforcement(h)).toMatchObject({ kind: "not-enforced", setting: 0 });
      }
    });
  }
});

/* ------------------------------------------------------------------------------------------ */
/* PREP-R3: complete outcome of an update                                                      */
/* ------------------------------------------------------------------------------------------ */

const CHANGE = { id: "guide", title: "Changed guide", tags: ["Changed tag"] };
async function updatePrior(engine: Engine) {
  const h = await baseline(engine);
  await h.execute("UPDATE study_materials SET notes = 'Synthetic note', file_path = 'documents/synthetic-old.pdf' WHERE id = 'guide'");
  await h.save({ mode: "create", id: "other", title: "Other guide", tags: ["Synthetic tag"] });
  return h;
}

describe("PREP-R3 oracle: updateOutcomeProblems/sameState", () => {
  for (const engine of ENGINES) {
    it(`[R3-1] ${engine}: the complete expected success is accepted (live and, for sql.js, reopened)`, async () => {
      const h = await updatePrior(engine);
      const prior = await fullState(h);
      await h.save({ mode: "update", ...CHANGE });
      const after = await fullState(h);
      expect(updateOutcomeProblems(prior, after, CHANGE)).toEqual([]);
      if (engine === "sql.js") expect(sameState(after, await fullState(await h.reopen()))).toBe(true);
    });

    it(`[R3-2] ${engine}: changed links with the old title are rejected`, async () => {
      const h = await updatePrior(engine);
      const prior = await fullState(h);
      h.raw(`DELETE FROM material_tags WHERE material_id = 'guide';
        INSERT INTO tags (id, name, created_at) VALUES ('tag:Changed tag', 'Changed tag', '2026-10-03T12:00:00.000Z');
        INSERT INTO material_tags (material_id, tag_id) VALUES ('guide', 'tag:Changed tag')`);
      const problems = updateOutcomeProblems(prior, await fullState(h), CHANGE);
      expect(problems).toEqual(['title is "Synthetic guide", expected "Changed guide"']);
    });

    it(`[R3-3] ${engine}: a changed title with the old links is rejected`, async () => {
      const h = await updatePrior(engine);
      const prior = await fullState(h);
      h.raw("UPDATE study_materials SET title = 'Changed guide' WHERE id = 'guide'");
      const problems = updateOutcomeProblems(prior, await fullState(h), CHANGE);
      expect(problems).toEqual(['target links resolve to ["Synthetic tag"], expected ["Changed tag"]']);
    });

    it(`[R3-4] ${engine}: partial state after a rejected save is rejected; unchanged rejected state is accepted`, async () => {
      const h = await updatePrior(engine);
      const prior = await fullState(h);
      expect(sameState(prior, await fullState(h))).toBe(true);
      h.raw("UPDATE study_materials SET title = 'Changed guide' WHERE id = 'guide'");
      const partial = await fullState(h);
      expect(sameState(prior, partial)).toBe(false);
      expect(stateDifferences(prior, partial)).toEqual(["materials"]);
    });

    it(`[R3-5] ${engine}: success with a stray tag, a changed untouched column or a lost unrelated row is rejected`, async () => {
      const h = await updatePrior(engine);
      const prior = await fullState(h);
      await h.save({ mode: "update", ...CHANGE });
      h.raw(`INSERT INTO tags (id, name, created_at) VALUES ('stray', 'Stray tag', '2026-10-03T12:00:00.000Z');
        UPDATE study_materials SET notes = 'Changed note' WHERE id = 'guide';
        DELETE FROM unrelated`);
      expect(updateOutcomeProblems(prior, await fullState(h), CHANGE)).toEqual([
        "a column outside the update contract changed",
        'stray new tag "Stray tag" (stray)',
        "unrelated table changed",
      ]);
    });
  }
});
