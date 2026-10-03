// PREPARED A2 DIAGNOSTICS FOR THE MAC: NOT RUN. NOT A MAINTAINED TEST.
//
// Requires the corrected, independently accepted A2 implementation (originally Windows-local
// `fix/atomic-study-material-saves`, base 533a8f50c2d0de74a75f5542022da3182f376ee9, plus the
// R6/R7 corrections). That source provides `saveMaterialAtomically`, `MaterialSaveOperation`,
// the connection owner and the durable sql.js write path. Current main has none of them; its
// plural `saveMaterialsAtomically` is a different (PDF-part batch) contract. Running this file
// on main only reports missing APIs, which is a prerequisite mismatch, not a defect.
//
// Kept under docs/evidence so Vitest (`include: src/**/*.test.ts`) and tsc (`include: src`)
// never discover it. Use: copy it to `src/data/a2ReviewDiagnostics.mac.test.ts` in a checkout
// of the matching source, run it, delete the copy. Exact commands are in this folder's README.
//
// Part 1 is Codex's five second-review diagnostics with their behavior unchanged
// (docs/A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md); their names are kept verbatim so results
// compare 1:1 with docs/evidence/a2-second-review-2026-10-02/reviewer-edge-regressions.txt.
// The only adaptation is resolving the WASM file from this checkout and a guard that it exists.
//
// Part 2 holds additional prepared cases, named by the stable case IDs in
// docs/MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md. They use only the API visible in the
// review (`saveMaterialAtomically(operation)` with `{ mode, id, fields: { title }, tags, ... }`).
// If the accepted source renamed that API, adapt imports and call sites only, never assertions,
// and record the adaptation.
//
// Part 2 observes state through ./a2DiagnosticObservations (copy it alongside this file). Those
// helpers were corrected on 3 October 2026 for Codex's preparation review (PREP-R1 to PREP-R3)
// and are validated against real engines by a2ObservationOracle.check.ts. CONDITIONAL SEAM
// cases fail with "seam not reached" instead of passing when their fault point is not hit.
//
// Data: synthetic only. node:sqlite uses a fresh `:memory:` database per case (closed in
// `finally`); sql.js uses a per-case Map-backed localStorage stub, and "reopen" means a new
// `createSqlJsDatabase()` over the same stub. Both drivers apply the real project migrations.
// Faults: one-shot prototype spies, statement barriers and global stubs only, restored in
// afterEach even when an assertion fails. No production hook is used or required.
import { existsSync } from "node:fs";
import initSqlJs from "sql.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
import { createSqlJsDatabase } from "./sqlJsDb";
import type { MaterialSaveOperation, SqlDatabase } from "./db";
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
  type FullState,
  type MaterialObservation,
  type UpdateExpectation,
} from "./a2DiagnosticObservations";

// Mac adaptation: resolved from the checkout root (Vitest's working directory), never a
// copied Windows absolute path.
const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

beforeAll(() => {
  if (!existsSync(WASM)) {
    throw new Error(`sql.js WASM not found at ${WASM}; run Vitest from the checkout root after npm ci`);
  }
});

// Per-case browser storage. `storageFault` lets a case refuse writes without replacing the stub.
let stored: Map<string, string>;
let storageFault: "none" | "next-quota" | "always-private" = "none";
beforeEach(() => {
  stored = new Map<string, string>();
  storageFault = "none";
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageFault === "next-quota") {
        storageFault = "none";
        throw new DOMException("synthetic quota", "QuotaExceededError");
      }
      if (storageFault === "always-private") {
        throw new DOMException("synthetic private mode", "SecurityError");
      }
      stored.set(key, value);
    },
  });
});
afterEach(() => {
  restoreAllBarriers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const create = (id: string): MaterialSaveOperation => ({
  mode: "create", id, fields: { title: "Synthetic guide" }, tags: ["Synthetic tag"],
  createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z",
});
const rows = (db: SqlDatabase) => db.select("SELECT id, title FROM study_materials ORDER BY id");

/* ------------------------------------------------------------------------------------------ */
/* Part 1: Codex's five second-review diagnostics (behavior and names unchanged)               */
/* DX-1 and DX-2 are the it.each pair, DX-3 the sql.js select case, DX-4/DX-5 the export pair. */
/* ------------------------------------------------------------------------------------------ */

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
      const SQL = await initSqlJs({ locateFile: () => WASM });
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

/* ------------------------------------------------------------------------------------------ */
/* Part 2: additional prepared cases (stable IDs from the preparation report)                 */
/*                                                                                            */
/* Observation policy (corrected 3 October 2026 for PREP-R1 to PREP-R3):                      */
/* - fullState: complete stored state (every material and tag column, raw material_tags rows, */
/*   a separate LEFT JOIN name view, counts, dangling references, explicit unrelated status). */
/*   Several separate reads, so only taken after pending operations settle.                   */
/* - observeMaterial: one SQL statement, for a read that may race a save (QT-02).             */
/* - updateOutcomeProblems: the complete expected result of an update (QT-11, AR-02).        */
/* - proveForeignKeyEnforcement: usable write + setting + SQLite FK error, or "fail-closed".  */
/* - installStatementBarrier: deterministic "ownership is held" event (CONDITIONAL cases).    */
/* The helpers are validated by a2ObservationOracle.check.ts against real engines today.      */
/* ------------------------------------------------------------------------------------------ */

type Engine = "node:sqlite" | "sql.js";
const ENGINES: Engine[] = ["node:sqlite", "sql.js"];
type Db = SqlDatabase & { close?: () => void };

async function open(engine: Engine): Promise<Db> {
  return engine === "node:sqlite" ? createNodeSqliteDatabase() : createSqlJsDatabase();
}
async function withDb(engine: Engine, body: (db: Db) => Promise<void>) {
  const db = await open(engine);
  try {
    await body(db);
  } finally {
    db.close?.();
  }
}
const sqlJs = () => initSqlJs({ locateFile: () => WASM });
/** Live state, plus the reopened sql.js state, which must be identical to it. */
async function settledState(engine: Engine, db: Db): Promise<FullState> {
  const live = await fullState(db);
  if (engine === "sql.js") expectSame(await fullState(await createSqlJsDatabase()), live, "reopened sql.js state");
  return live;
}
function expectSame(actual: FullState, expected: FullState, label: string) {
  expect(stateDifferences(expected, actual), `${label} differs in`).toEqual([]);
  expect(sameState(actual, expected)).toBe(true);
}
function expectNoIntegrityProblems(s: FullState, label: string) {
  expect(integrityProblems(s), label).toEqual([]);
}
/** Before/after evidence line, captured by --reporter=verbose output. */
function evidence(caseId: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ caseId, ...data }));
}

const update = (id: string, title: string, tags?: string[]): MaterialSaveOperation =>
  ({ mode: "update", id, fields: { title }, ...(tags === undefined ? {} : { tags }) }) as MaterialSaveOperation;
const CHANGE: UpdateExpectation = { id: "existing", title: "Changed guide", tags: ["Changed tag"] };
const CHANGE_OP = () => update(CHANGE.id, CHANGE.title, CHANGE.tags);

/** Engine statement methods for installStatementBarrier (prototype wrappers, restored in afterEach). */
async function engineTargets(engine: Engine): Promise<BarrierTarget[]> {
  if (engine === "node:sqlite") {
    const specifier = "node:sqlite";
    const { DatabaseSync } = await import(/* @vite-ignore */ specifier);
    return [{ proto: DatabaseSync.prototype, methods: ["prepare", "exec"] }];
  }
  const SQL = await sqlJs();
  return [{ proto: SQL.Database.prototype, methods: ["prepare", "run", "exec"] }];
}

/** One-shot export fault on the real sql.js prototype (seam verified on this Mac). */
async function failNextExport() {
  const SQL = await sqlJs();
  return vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
    throw new Error("synthetic export failure");
  });
}

/**
 * One-shot fault on whichever statement method re-enables foreign keys. sql.js export()
 * resets PRAGMA foreign_keys to 0 (engine-probe.json), so a durable write must restore it.
 * Returns a probe so the case fails loudly, rather than passing vacuously, if the corrected
 * driver restores the setting by some other route (then record a seam gap for the owner).
 */
async function failForeignKeyRestore(times: number | "until-disarmed") {
  const SQL = await sqlJs();
  const state = { remaining: times, fired: 0 };
  for (const method of ["run", "exec"] as const) {
    const original = SQL.Database.prototype[method] as (...args: unknown[]) => unknown;
    vi.spyOn(SQL.Database.prototype, method).mockImplementation(function (this: unknown, ...args: unknown[]) {
      const armed = state.remaining === "until-disarmed" || state.remaining > 0;
      if (armed && /foreign_keys\s*=\s*(ON|1|TRUE)/i.test(String(args[0]))) {
        state.fired += 1;
        if (state.remaining !== "until-disarmed") state.remaining -= 1;
        throw new Error("synthetic foreign-key restoration failure");
      }
      return original.apply(this, args);
    } as never);
  }
  return {
    fired: () => state.fired,
    disarm: () => {
      state.remaining = 0;
    },
  };
}

/** One-shot fault in byte-to-string encoding, if the corrected driver encodes with btoa. */
function failNextEncoding() {
  const original = globalThis.btoa;
  const state = { fired: 0 };
  vi.stubGlobal("btoa", (value: string) => {
    if (state.fired === 0) {
      state.fired += 1;
      throw new Error("synthetic encoding failure");
    }
    return original(value);
  });
  return { fired: () => state.fired };
}

/* ---------------------------------- AR: atomic records and tags --------------------------- */

describe("Mac prep AR: atomic records and tags on both real engines", () => {
  it.each(ENGINES)("[AR-01] %s create writes the row and its tag links once, live and reopened", async (engine) => {
    await withDb(engine, async (db) => {
      const before = await fullState(db);
      await db.saveMaterialAtomically!(create("guide"));
      const after = await settledState(engine, db);
      evidence("AR-01", { engine, before, after });
      expect(after.materials).toHaveLength(1);
      expect(after.materials[0]).toMatchObject({ id: "guide", title: "Synthetic guide", created_at: "2026-10-02T10:00:00.000Z" });
      expect(after.resolvedLinks).toEqual([{ id: "guide", tag: "Synthetic tag" }]);
      expect(after.integrity).toMatchObject({ materialCount: 1, tagCount: before.integrity.tagCount + 1, linkCount: 1 });
      expect(after.materialTags).toEqual([{ material_id: "guide", tag_id: (after.tags[0] as { id: string }).id }]);
      expectNoIntegrityProblems(after, "AR-01");
    });
  });

  it.each(ENGINES)("[AR-02] %s update replaces title and tags and preserves fields outside its contract", async (engine) => {
    await withDb(engine, async (db) => {
      await db.saveMaterialAtomically!(create("existing"));
      // Fields the update does not name, set through the public API as ordinary data.
      await db.execute(
        "UPDATE study_materials SET notes = ?, topic = ?, file_path = ?, last_reviewed_at = ? WHERE id = ?",
        ["Synthetic note", "synthetic-topic", "documents/synthetic-old.pdf", "2026-10-01T09:00:00.000Z", "existing"],
      );
      const before = await fullState(db);
      await db.saveMaterialAtomically!(CHANGE_OP());
      const after = await settledState(engine, db);
      evidence("AR-02", { engine, before, after });
      expect(updateOutcomeProblems(before, after, CHANGE)).toEqual([]);
    });
  });

  it.each(ENGINES)("[AR-03] %s omitted tags keep raw links; an explicit empty list clears them", async (engine) => {
    await withDb(engine, async (db) => {
      await db.saveMaterialAtomically!(create("existing"));
      const before = await fullState(db);
      await db.saveMaterialAtomically!(update("existing", "Title only"));
      const kept = await fullState(db);
      expect(updateOutcomeProblems(before, kept, { id: "existing", title: "Title only" })).toEqual([]);
      await db.saveMaterialAtomically!(update("existing", "Title only", []));
      const cleared = await settledState(engine, db);
      evidence("AR-03", { engine, before, kept, cleared });
      expect(updateOutcomeProblems(kept, cleared, { id: "existing", title: "Title only", tags: [] })).toEqual([]);
      expect(cleared.materialTags).toEqual([]);
    });
  });

  // Fault seam: a synthetic trigger created through the public API (a legitimate CREATE
  // TRIGGER statement) aborts the tag-link insert after the material row and tag row were
  // written inside the save's transaction. Dropping it is the retry precondition.
  const POISON = `CREATE TRIGGER synthetic_link_fault BEFORE INSERT ON material_tags
    WHEN (SELECT name FROM tags WHERE id = NEW.tag_id) = 'Poison tag'
    BEGIN SELECT RAISE(ABORT, 'synthetic tag-link failure'); END`;

  it.each(ENGINES)("[AR-04/AR-06] %s a link failure during create leaves no debris; the retry saves once", async (engine) => {
    await withDb(engine, async (db) => {
      await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
      await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
      await db.execute(POISON);
      const before = await fullState(db);
      const attempt = { ...create("guide"), tags: ["Synthetic tag", "Poison tag"] } as MaterialSaveOperation;
      await expect(db.saveMaterialAtomically!(attempt)).rejects.toThrow();
      const afterFailure = await settledState(engine, db);
      expectSame(afterFailure, before, "state after the rejected create");
      await db.execute("DROP TRIGGER synthetic_link_fault");
      await db.saveMaterialAtomically!(attempt);
      const afterRetry = await settledState(engine, db);
      evidence("AR-04/AR-06", { engine, before, afterFailure, afterRetry });
      expect(afterRetry.materials).toHaveLength(1);
      expect(afterRetry.resolvedLinks).toEqual([{ id: "guide", tag: "Poison tag" }, { id: "guide", tag: "Synthetic tag" }]);
      expect(afterRetry.integrity).toMatchObject({ linkCount: 2, tagCount: before.integrity.tagCount + 2 });
      expect(afterRetry.unrelated).toEqual({ status: "present", rows: [{ id: "acknowledged" }] });
      expectNoIntegrityProblems(afterRetry, "AR-04/AR-06");
    });
  });

  it.each(ENGINES)("[AR-05/AR-06] %s a link failure during update keeps the complete prior state; the retry is the intended result", async (engine) => {
    await withDb(engine, async (db) => {
      await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
      await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
      await db.saveMaterialAtomically!(create("existing"));
      await db.execute("UPDATE study_materials SET notes = ?, file_path = ? WHERE id = ?", ["Synthetic note", "documents/synthetic-old.pdf", "existing"]);
      await db.execute(POISON);
      const before = await fullState(db);
      const change: UpdateExpectation = { id: "existing", title: "Changed guide", tags: ["New tag", "Poison tag"] };
      await expect(db.saveMaterialAtomically!(update(change.id, change.title, change.tags))).rejects.toThrow();
      const afterFailure = await settledState(engine, db);
      expectSame(afterFailure, before, "state after the rejected update"); // includes no stray "New tag" row
      await db.execute("DROP TRIGGER synthetic_link_fault");
      await db.saveMaterialAtomically!(update(change.id, change.title, change.tags));
      const afterRetry = await settledState(engine, db);
      evidence("AR-05/AR-06", { engine, before, afterFailure, afterRetry });
      expect(updateOutcomeProblems(before, afterRetry, change)).toEqual([]);
    });
  });
});

/* ---------------------------------- QT: queue and transaction ownership ------------------- */

// Every opening form the real engines accepted through the driver routes (engine-probe.json).
const OPENING_FORMS = [
  "BEGIN", "BEGIN DEFERRED", "BEGIN EXCLUSIVE", "BEGIN TRANSACTION", "begin immediate transaction",
  "SAVEPOINT synthetic", "-- synthetic\nBEGIN", "/* a */ -- b\n  /* c */\tBEGIN", "\n\t  BEGIN",
  "BEGIN; SELECT 1", "SELECT 1; BEGIN",
];
// Forms that would end or alter a transaction another operation owns. Routes: node:sqlite
// prepare() and sql.js prepare()/run(sql, params) compile ONE statement (a trailing statement is
// silently ignored); sql.js run(sql) without params (= exec) and node:sqlite exec() run EVERY
// statement, so "SELECT 1; COMMIT" matters only where a driver uses those routes.
const ENDING_FORMS = [
  "COMMIT", "COMMIT TRANSACTION", "END", "END TRANSACTION", "ROLLBACK", "/* synthetic */ ROLLBACK",
  "-- synthetic\nCOMMIT", "RELEASE synthetic", "RELEASE SAVEPOINT synthetic", "ROLLBACK TO synthetic",
  "ROLLBACK TRANSACTION TO SAVEPOINT synthetic", "SELECT 1; COMMIT", "SELECT 1; ROLLBACK",
];
const ROUTES = ["execute", "select"] as const;
const call = (db: Db, route: (typeof ROUTES)[number], sql: string) =>
  (route === "select" ? db.select(sql) : db.execute(sql)).then(() => "admitted", (e) => `refused: ${String(e)}`);

describe("Mac prep QT: public SQL cannot hold or end transaction ownership", () => {
  for (const engine of ENGINES) {
    for (const route of ROUTES) {
      it.each(OPENING_FORMS)(`[QT-08/QT-09/QT-10] ${engine} ${route} %j cannot leave a transaction open across calls`, async (sql) => {
        await withDb(engine, async (db) => {
          await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
          const outcome = await call(db, route, sql);
          await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
          const save = await db.saveMaterialAtomically!(create("after")).then(() => "saved", (e) => `rejected: ${e}`);
          const after = await settledState(engine, db);
          evidence("QT-08..10", { engine, route, sql, outcome, save, after });
          expect(save).toBe("saved");
          expect(after.unrelated).toEqual({ status: "present", rows: [{ id: "acknowledged" }] });
          expect(after.resolvedLinks).toEqual([{ id: "after", tag: "Synthetic tag" }]);
          expectNoIntegrityProblems(after, "QT-08..10");
        });
      });

      it.each(ENDING_FORMS)(`[QT-11a] ${engine} ${route} %j outside any save changes nothing and leaves the connection usable`, async (sql) => {
        await withDb(engine, async (db) => {
          await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
          await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
          await db.saveMaterialAtomically!(create("existing"));
          const prior = await fullState(db);
          const outcome = await call(db, route, sql);
          const afterCall = await settledState(engine, db);
          expectSame(afterCall, prior, "state after the public ending call");
          // Ordinary legitimate work afterwards: a read, a write and a complete save.
          expect(await db.select("SELECT count(*) AS n FROM unrelated")).toEqual([{ n: 1 }]);
          await db.execute("INSERT INTO unrelated (id) VALUES ('after-call')");
          const beforeSave = await fullState(db);
          await db.saveMaterialAtomically!(CHANGE_OP());
          const after = await settledState(engine, db);
          evidence("QT-11a", { engine, route, sql, outcome, prior, after });
          expect(updateOutcomeProblems(beforeSave, after, CHANGE)).toEqual([]);
        });
      });

      // CONDITIONAL SEAM. The barrier wraps engine statement methods and fires when the save's
      // first tag-link insert reaches the engine inside its open transaction (row written, links
      // not yet). The public ending call is requested at that event, i.e. while ownership is held.
      // If the corrected driver prepares statements before BEGIN or sends one script, the event
      // never fires and the case fails with "seam not reached": a seam request, not a defect.
      it.each(ENDING_FORMS)(`[QT-11b] CONDITIONAL SEAM: ${engine} ${route} %j requested while a save holds ownership cannot split it`, async (sql) => {
        await withDb(engine, async (db) => {
          await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
          await db.execute("INSERT INTO unrelated (id) VALUES ('acknowledged')");
          await db.saveMaterialAtomically!(create("existing"));
          const prior = await fullState(db);
          let requested: Promise<string> | undefined;
          const barrier = installStatementBarrier(await engineTargets(engine), LINK_INSERT, () => {
            requested = call(db, route, sql);
          });
          const save = await db.saveMaterialAtomically!(CHANGE_OP()).then(() => "saved", (e) => `rejected: ${e}`);
          barrier.restore();
          const outcome = requested ? await requested : "never requested";
          const after = await settledState(engine, db);
          evidence("QT-11b", { engine, route, sql, barrier: barrier.events(), outcome, save, prior, after });
          expect(barrier.fired(), "seam not reached: no tag-link insert inside an open transaction").toBe(1);
          if (engine === "node:sqlite") expect(barrier.events()[0]!.engineReportsTransaction).toBe(true);
          if (save === "saved") expect(updateOutcomeProblems(prior, after, CHANGE)).toEqual([]);
          else expectSame(after, prior, "state after the rejected save");
          await db.saveMaterialAtomically!(create("still-usable"));
        });
      });
    }

    it(`[QT-12] ${engine} legitimate SQL still works: comments, parameters, quoted keywords, read PRAGMAs, trigger bodies`, async () => {
      await withDb(engine, async (db) => {
        expect(await db.select("/* synthetic */ SELECT 1 AS one")).toEqual([{ one: 1 }]);
        expect(await db.select("-- synthetic\nSELECT 1 AS one")).toEqual([{ one: 1 }]);
        expect(await db.select("SELECT ? AS value", ["Synthetic value"])).toEqual([{ value: "Synthetic value" }]);
        expect(await db.select("SELECT 'BEGIN; COMMIT; ROLLBACK' AS text")).toEqual([{ text: "BEGIN; COMMIT; ROLLBACK" }]);
        expect(await db.select('SELECT 1 AS "begin"')).toEqual([{ begin: 1 }]);
        expect(await db.select("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
        expect((await db.select("PRAGMA table_info(study_materials)")).length).toBeGreaterThan(5);
        await db.execute("CREATE TABLE audit_log (id TEXT)");
        await db.execute(
          `CREATE TRIGGER synthetic_audit AFTER INSERT ON study_materials
           BEGIN INSERT INTO audit_log (id) VALUES (NEW.id); END`,
        );
        await db.saveMaterialAtomically!(create("triggered"));
        expect(await db.select("SELECT id FROM audit_log")).toEqual([{ id: "triggered" }]);
      });
    });

    // Coherent observation: ONE statement, so whatever FIFO schedule the driver chooses, a
    // correct owner yields "none" or "complete". This does not by itself prove overlap; QT-02b does.
    it(`[QT-02a] ${engine} a single-statement read issued around a save is coherent ("none" or "complete")`, async () => {
      await withDb(engine, async (db) => {
        const saving = db.saveMaterialAtomically!(create("guide"));
        const reading = observeMaterial(db, "guide", ["Synthetic tag"]);
        const [, seen] = await Promise.all([saving, reading]);
        const cls = classifyCreate(seen, { title: "Synthetic guide", tags: ["Synthetic tag"] });
        evidence("QT-02a", { engine, seen, cls });
        expect(["none", "complete"]).toContain(cls);
        expect(classifyCreate(await observeMaterial(db, "guide", ["Synthetic tag"]), { title: "Synthetic guide", tags: ["Synthetic tag"] })).toBe("complete");
      });
    });

    // CONDITIONAL SEAM: the read is requested at the barrier event (inside the save's
    // transaction, after the row insert, before the first link insert). A correct owner queues
    // it behind the save, so it sees "complete"; a read that entered the transaction sees "partial".
    it(`[QT-02b] CONDITIONAL SEAM: ${engine} a read requested while the save holds ownership sees all of it`, async () => {
      await withDb(engine, async (db) => {
        let pending: Promise<MaterialObservation> | undefined;
        const barrier = installStatementBarrier(await engineTargets(engine), LINK_INSERT, () => {
          pending = observeMaterial(db, "guide", ["Synthetic tag"]);
        });
        await db.saveMaterialAtomically!(create("guide"));
        barrier.restore();
        evidence("QT-02b", { engine, barrier: barrier.events(), seen: pending ? await pending : null });
        expect(barrier.fired(), "seam not reached: no tag-link insert inside an open transaction").toBe(1);
        if (engine === "node:sqlite") expect(barrier.events()[0]!.engineReportsTransaction).toBe(true);
        expect(classifyCreate(await pending!, { title: "Synthetic guide", tags: ["Synthetic tag"] })).toBe("complete");
      });
    });
  }
});

/* ---------------------------------- BD: browser durability (sql.js) ----------------------- */

describe("Mac prep BD: one truthful durability policy for sql.js", () => {
  it.each(["create", "update"] as const)("[BD-01/BD-02] %s export failure restores the complete state, live and reopened", async (mode) => {
    const db = await createSqlJsDatabase();
    if (mode === "update") await db.saveMaterialAtomically!(create("existing"));
    const prior = await fullState(db);
    await failNextExport();
    const operation = mode === "create" ? create("guide") : CHANGE_OP();
    await expect(db.saveMaterialAtomically!(operation)).rejects.toThrow("synthetic export failure");
    const live = await fullState(db);
    const reopened = await fullState(await createSqlJsDatabase());
    evidence("BD-01/BD-02", { mode, prior, live, reopened });
    expectSame(live, prior, "live state");
    expectSame(reopened, prior, "reopened state");
  });

  it("[BD-03] a create retried after an export failure saves exactly once, with its tag, live and reopened", async () => {
    const db = await createSqlJsDatabase();
    const prior = await fullState(db);
    await failNextExport();
    await expect(db.saveMaterialAtomically!(create("guide"))).rejects.toThrow();
    expectSame(await fullState(db), prior, "state after the rejected create");
    await db.saveMaterialAtomically!(create("guide"));
    const after = await settledState("sql.js", db);
    evidence("BD-03", { prior, after });
    expect(after.materials).toHaveLength(1);
    expect(after.resolvedLinks).toEqual([{ id: "guide", tag: "Synthetic tag" }]);
    expect(after.integrity).toMatchObject({ linkCount: 1, tagCount: prior.integrity.tagCount + 1 });
    expectNoIntegrityProblems(after, "BD-03");
  });

  it("[BD-04] a failed update keeps the complete prior state until a successful retry", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const before = await fullState(db);
    await failNextExport();
    await expect(db.saveMaterialAtomically!(CHANGE_OP())).rejects.toThrow();
    expectSame(await fullState(db), before, "live state after the rejected update");
    expectSame(await fullState(await createSqlJsDatabase()), before, "reopened state after the rejected update");
    await db.saveMaterialAtomically!(CHANGE_OP());
    const after = await settledState("sql.js", db);
    evidence("BD-04", { before, after });
    expect(updateOutcomeProblems(before, after, CHANGE)).toEqual([]);
  });

  it("[BD-05] CONDITIONAL SEAM: an encoding failure restores the last stored state", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const prior = await fullState(db);
    const fault = failNextEncoding();
    const result = await db.saveMaterialAtomically!(CHANGE_OP()).then(() => "saved", () => "rejected");
    evidence("BD-05", { seamFired: fault.fired(), result, prior, live: await fullState(db) });
    // If this fails here, the corrected driver does not encode through globalThis.btoa:
    // record a seam gap for the source owner instead of treating it as a driver defect.
    expect(fault.fired(), "encoding seam not reached (driver does not use btoa)").toBe(1);
    expect(result).toBe("rejected");
    expectSame(await fullState(db), prior, "live state");
    expectSame(await fullState(await createSqlJsDatabase()), prior, "reopened state");
  });

  it("[BD-06] CONDITIONAL SEAM: a foreign-key restoration failure inside the durable write restores state", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const prior = await fullState(db);
    const fault = await failForeignKeyRestore(1);
    const result = await db.saveMaterialAtomically!(CHANGE_OP()).then(() => "saved", () => "rejected");
    const live = await fullState(db);
    evidence("BD-06", { seamFired: fault.fired(), result, prior, live });
    expect(fault.fired(), "foreign-key restoration seam not reached via run/exec").toBe(1);
    expect(result).toBe("rejected");
    expectSame(live, prior, "live state");
    expectSame(await fullState(await createSqlJsDatabase()), prior, "reopened state");
    // The next operation must run on a usable connection that enforces foreign keys.
    const fk = await proveForeignKeyEnforcement(db);
    evidence("BD-06/fk", { fk });
    expect(fk).toMatchObject({ kind: "enforced", setting: 1, usableWrite: true });
  });

  it("[BD-07] a storage refusal after a successful export also restores the previous state (quota regression kept)", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const before = await fullState(db);
    storageFault = "next-quota";
    await expect(db.saveMaterialAtomically!(update("existing", "Changed guide", []))).rejects.toThrow();
    expectSame(await fullState(db), before, "live state");
    expectSame(await fullState(await createSqlJsDatabase()), before, "reopened state");
  });

  it("[BD-08] a later unrelated acknowledged write cannot persist a change that was reported as failed", async () => {
    const db = await createSqlJsDatabase();
    await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    const prior = await fullState(db);
    await failNextExport();
    await expect(db.saveMaterialAtomically!(create("rejected"))).rejects.toThrow();
    await db.execute("INSERT INTO unrelated (id) VALUES ('later')");
    const reopened = await fullState(await createSqlJsDatabase());
    evidence("BD-08", { prior, reopened });
    expect(stateDifferences(prior, reopened)).toEqual(["unrelated"]);
    expect(reopened.unrelated).toEqual({ status: "present", rows: [{ id: "later" }] });
  });

  it("[BD-09] an explicit persist after a rejected save cannot store the rejected change", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const prior = await fullState(db);
    await failNextExport();
    await expect(db.saveMaterialAtomically!(CHANGE_OP())).rejects.toThrow();
    await db.persist?.();
    const reopened = await fullState(await createSqlJsDatabase());
    evidence("BD-09", { prior, reopened });
    expectSame(reopened, prior, "reopened state");
  });

  it("[BD-10] foreign keys stay enforced on a usable connection after an export-failure recovery", async () => {
    const db = await createSqlJsDatabase();
    const prior = await fullState(db);
    await failNextExport();
    await expect(db.saveMaterialAtomically!(create("guide"))).rejects.toThrow();
    expectSame(await fullState(db), prior, "live state");
    const fk = await proveForeignKeyEnforcement(db);
    evidence("BD-10", { fk });
    expect(fk).toMatchObject({ kind: "enforced", setting: 1, usableWrite: true });
  });

  it("[BD-11] CONDITIONAL SEAM: if recovery itself fails, later work is refused or provably safe; never silently unsafe", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const prior = await fullState(db);
    await failNextExport();
    const fault = await failForeignKeyRestore("until-disarmed"); // recovery's setting restore also fails
    await expect(db.saveMaterialAtomically!(CHANGE_OP())).rejects.toThrow();
    // A later operation while recovery is still broken: either refused (fail closed) or, if
    // admitted, on a usable connection that demonstrably enforces foreign keys.
    const later = await proveForeignKeyEnforcement(db);
    fault.disarm();
    const reopened = await fullState(await createSqlJsDatabase());
    evidence("BD-11", { seamFired: fault.fired(), later, prior, reopened });
    expect(fault.fired(), "recovery seam not reached; record the gap").toBeGreaterThan(0);
    expect(later.kind, "admitted work ran without foreign-key enforcement").not.toBe("not-enforced");
    if (later.kind === "enforced") expectSame(await fullState(db), prior, "live state after admitted later work");
    // later.kind === "fail-closed" is a legitimate outcome and is recorded as such, never as "enforced".
    expectSame(reopened, prior, "reopened state");
  });

  it("[BD-14] private-mode storage that refuses every write rejects the save and keeps the complete state", async () => {
    const db = await createSqlJsDatabase();
    await db.saveMaterialAtomically!(create("existing"));
    const prior = await fullState(db);
    storageFault = "always-private";
    await expect(db.saveMaterialAtomically!(CHANGE_OP())).rejects.toThrow();
    const live = await fullState(db);
    storageFault = "none";
    const reopened = await fullState(await createSqlJsDatabase());
    evidence("BD-14", { prior, live, reopened });
    expectSame(live, prior, "live state");
    expectSame(reopened, prior, "reopened state");
  });
});
