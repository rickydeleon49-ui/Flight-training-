/**
 * The navigation request controller (M4 Slice 1) over the real persistence
 * twin on node:sqlite: held openers, held commits, failed and retried saves,
 * abort and unmount, a newer request whose ownership read fails, and the
 * explicit cancellation/commit ordering. Holds are deterministic gates on the
 * ports, never sleeps. Production tests for the prototype's M4-R11, R13, R23,
 * R24, R28–R30 and R37 controller behaviours.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { InspectedNavigationIdentity, NavigationOperation } from "@/domain/types";
import { navigationRepository } from "@/data/repositories/navigationRepository";
import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "@/data/navigationTransaction";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";

import { NavigationController, type NavigationPorts, type NavigationStatus } from "./controller";

const A = "a".repeat(64);
const B = "b".repeat(64);

/** A promise the test resolves or rejects when it chooses. */
function gate<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending work run until nothing more happens (macrotask turns, bounded). */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** Wait until the call log shows a port was reached: observable completion, not a timed sleep. */
async function reached(calls: string[], entry: string, count = 1): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    if (calls.filter((c) => c === entry).length >= count) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`never reached ${entry} (${calls.join(", ")})`);
}

interface Rig {
  db: TestDatabase;
  controller: NavigationController;
  /** Calls the ports received, in order. */
  calls: string[];
  content: Map<string, { hash: string; pages: number }>;
  hold: { inspect?: ReturnType<typeof gate<void>>; open?: ReturnType<typeof gate<void>>; commit?: ReturnType<typeof gate<void>>; begin?: ReturnType<typeof gate<void>> };
  fail: { inspect?: unknown; begin?: unknown; open?: unknown; commit?: unknown };
  tuple(materialId?: string): Promise<unknown>;
  claim(materialId?: string): Promise<unknown>;
}

const databases: TestDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function rig(): Promise<Rig> {
  const db = await createNodeSqliteDatabase();
  databases.push(db);
  await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('m1', 'One', 'x', 'x'), ('m2', 'Two', 'x', 'x')");
  const repo = navigationRepository(db);
  const calls: string[] = [];
  const content = new Map([
    ["m1", { hash: A, pages: 50 }],
    ["m2", { hash: B, pages: 30 }],
  ]);
  const hold: Rig["hold"] = {};
  const fail: Rig["fail"] = {};
  const take = async (name: keyof Rig["hold"]) => {
    const h = hold[name];
    if (h) {
      delete hold[name];
      await h.promise;
    }
    if (fail[name] !== undefined) {
      const error = fail[name];
      delete fail[name];
      throw error;
    }
  };
  const ports: NavigationPorts = {
    async inspect(materialId) {
      calls.push(`inspect:${materialId}`);
      await take("inspect");
      const { hash, pages } = content.get(materialId)!;
      // As the native inspector does: record the identity from the bytes.
      await db.execute(
        `INSERT INTO material_content_identities VALUES (?, ?, ?, 'x')
         ON CONFLICT(material_id) DO UPDATE SET content_sha256 = excluded.content_sha256, total_pages = excluded.total_pages`,
        [materialId, hash, pages],
      );
      return { materialId, contentSha256: hash, totalPages: pages, verifiedAt: "x", changed: false } satisfies InspectedNavigationIdentity;
    },
    async operation(op) {
      calls.push(`${op.kind}:${op.materialId}${"generation" in op ? `#${op.generation}` : ""}`);
      if (op.kind === "begin") await take("begin");
      if (op.kind === "commit") await take("commit");
      return repo.operation(op as NavigationOperation) as never;
    },
    async open(materialId, hash) {
      calls.push(`open:${materialId}`);
      await take("open");
      if (content.get(materialId)!.hash !== hash) throw new NavigationError("FILE_CHANGED", NAVIGATION_ERROR_MESSAGES.FILE_CHANGED);
    },
    async openForGuidance(materialId) {
      calls.push(`guidance:${materialId}`);
    },
  };
  const row = async (sql: string, materialId: string) => (await db.select<{ t: string }>(sql, [materialId]))[0]?.t ?? null;
  return {
    db,
    controller: new NavigationController(ports),
    calls,
    content,
    hold,
    fail,
    tuple: async (m = "m1") => {
      const t = await row(
        "SELECT json_array(last_requested_page, confirmed_read, originating_content_sha256, status, owner_generation) AS t FROM material_reading_state WHERE material_id = ?",
        m,
      );
      return t && JSON.parse(t);
    },
    claim: async (m = "m1") => {
      const t = await row("SELECT json_array(reserved_generation, cancelled_generation) AS t FROM material_operation_claims WHERE material_id = ?", m);
      return t && JSON.parse(t);
    },
  };
}

const intent = (materialId: string, reference: number | string, provenance: "physical_index" | "unknown" = "physical_index") => ({ materialId, reference, provenance });

describe("a normal request", () => {
  it("checks, reserves, opens, then saves the exact destination", async () => {
    const r = await rig();
    const status = await r.controller.request(intent("m1", 12));
    expect(status).toMatchObject({ kind: "saved", destination: { physicalPage: 12, contentSha256: A }, readingState: { lastRequestedPage: 12, confirmedRead: false } });
    expect(r.calls).toEqual(["inspect:m1", "begin:m1", "open:m1", "commit:m1#1"]);
    expect(await r.tuple()).toEqual([12, 0, A, "active", 1]);
  });

  it("refuses an out-of-range page with an explanation and never opens or reserves (OD-6)", async () => {
    const r = await rig();
    const status = await r.controller.request(intent("m1", 51));
    expect(status).toMatchObject({ kind: "refused", message: expect.stringMatching(/has 50 pages/) });
    expect(r.calls).toEqual(["inspect:m1"]);
    expect(await r.claim()).toBeNull();
  });

  it("a number of unknown provenance is refused for saving; guidance opens the file and saves nothing", async () => {
    const r = await rig();
    expect(await r.controller.request(intent("m1", 12, "unknown"))).toMatchObject({ kind: "refused", message: expect.stringMatching(/printed page number/) });
    expect(await r.controller.openForGuidance("m1", "Look for page 12.")).toMatchObject({ kind: "guidance", message: "Look for page 12." });
    expect(r.calls).toEqual(["inspect:m1", "guidance:m1"]);
    expect(await r.tuple()).toBeNull();
  });

  it("a missing file is a plain failure and nothing is saved", async () => {
    const r = await rig();
    r.fail.inspect = new NavigationError("FILE_MISSING", NAVIGATION_ERROR_MESSAGES.FILE_MISSING);
    expect(await r.controller.request(intent("m1", 3))).toMatchObject({ kind: "failed", code: "FILE_MISSING", message: NAVIGATION_ERROR_MESSAGES.FILE_MISSING });
    expect(await r.tuple()).toBeNull();
  });

  it("content changed between the check and the open is not opened or saved", async () => {
    const r = await rig();
    const heldOpen = (r.hold.open = gate());
    const pending = r.controller.request(intent("m1", 3));
    await reached(r.calls, "open:m1");
    r.content.set("m1", { hash: B, pages: 50 });
    heldOpen.resolve();
    expect(await pending).toMatchObject({ kind: "failed", code: "FILE_CHANGED" });
    expect(await r.tuple()).toBeNull();
    expect(await r.claim()).toEqual([1, 1]);
  });
});

describe("a newer request retires older work first (M4-R37)", () => {
  it("a newer failed reservation supersedes an older held opener and keeps the exact saved tuple", async () => {
    const r = await rig();
    await r.controller.request(intent("m1", 4));
    const heldOpen = (r.hold.open = gate());
    const older = r.controller.request(intent("m1", 9));
    await reached(r.calls, "open:m1", 2);
    r.fail.begin = new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
    expect(await r.controller.request(intent("m1", 20))).toMatchObject({ kind: "failed" });
    heldOpen.resolve();
    expect(await older).toBeNull();
    await flush();
    expect(await r.tuple()).toEqual([4, 0, A, "active", 1]);
    expect(r.calls.filter((c) => c.startsWith("commit"))).toEqual(["commit:m1#1"]);
    expect(await r.claim(), "the older generation was cancelled on its own").toEqual([2, 2]);
  });

  it("a newer failed reservation supersedes an older held commit: its durable cancel lands first and the commit is refused", async () => {
    const r = await rig();
    const heldCommit = (r.hold.commit = gate());
    const older = r.controller.request(intent("m1", 9));
    await reached(r.calls, "commit:m1#1");
    // The commit request already left the controller and is held in transport.
    r.fail.begin = new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
    expect(await r.controller.request(intent("m1", 20))).toMatchObject({ kind: "failed" });
    await reached(r.calls, "cancel:m1#1");
    await flush();
    heldCommit.resolve();
    expect(await older, "a late commit result is not published").toBeNull();
    expect(r.controller.status()).toMatchObject({ kind: "failed" });
    expect(await r.tuple(), "the cancel was serialized first, so the commit wrote nothing").toBeNull();
    expect(await r.claim()).toEqual([1, 1]);
    expect(r.calls.filter((c) => c.startsWith("commit"))).toEqual(["commit:m1#1"]);
  });

  it("a thrown preliminary ownership read for another material still retires older work", async () => {
    const r = await rig();
    await r.controller.request(intent("m1", 4));
    const heldOpen = (r.hold.open = gate());
    const older = r.controller.request(intent("m1", 9));
    await reached(r.calls, "open:m1", 2);
    r.fail.inspect = new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
    expect(await r.controller.request(intent("m2", 2))).toMatchObject({ kind: "failed", materialId: "m2" });
    heldOpen.resolve();
    expect(await older).toBeNull();
    await flush();
    expect(await r.tuple()).toEqual([4, 0, A, "active", 1]);
    expect(await r.claim(), "the m1 generation was cancelled").toEqual([2, 2]);
    expect(r.controller.status()).toMatchObject({ kind: "failed", materialId: "m2" });
  });

  it("a save-only retry of the older operation is refused after a newer failed request", async () => {
    const r = await rig();
    r.fail.commit = new Error("disk");
    expect(await r.controller.request(intent("m1", 9))).toMatchObject({ kind: "opened_unsaved", canRetry: true });
    r.fail.inspect = new Error("lookup");
    await r.controller.request(intent("m2", 2));
    expect(await r.controller.retrySave()).toBeNull();
    await flush();
    expect(await r.tuple()).toBeNull();
    expect(r.calls.filter((c) => c.startsWith("open:m1"))).toHaveLength(1);
  });

  it("after a failed request a later request still opens and saves normally", async () => {
    const r = await rig();
    r.fail.begin = new Error("busy");
    await r.controller.request(intent("m1", 3));
    expect(await r.controller.request(intent("m1", 5))).toMatchObject({ kind: "saved" });
    expect(await r.tuple()).toEqual([5, 0, A, "active", 1]);
  });

  it("a newer request for the same material supersedes the older generation inside its reservation", async () => {
    const r = await rig();
    const heldOpen = (r.hold.open = gate());
    const older = r.controller.request(intent("m1", 9));
    await reached(r.calls, "open:m1");
    const newer = r.controller.request(intent("m1", 11));
    await reached(r.calls, "open:m1", 2);
    heldOpen.resolve();
    expect(await older).toBeNull();
    expect(await newer).toMatchObject({ kind: "saved", destination: { physicalPage: 11 } });
    expect(await r.claim()).toEqual([2, 1]);
    expect(r.calls.filter((c) => c.startsWith("commit"))).toEqual(["commit:m1#2"]);
  });

  it("route A → B → A with a delayed save leaves the final winner intact", async () => {
    const r = await rig();
    const heldCommit = (r.hold.commit = gate());
    const first = r.controller.request(intent("m1", 3));
    await reached(r.calls, "commit:m1#1");
    const toB = r.controller.request(intent("m2", 7));
    await flush();
    heldCommit.resolve();
    expect(await first).toBeNull();
    expect(await toB).toMatchObject({ kind: "saved", materialId: "m2" });
    expect(await r.controller.request(intent("m1", 8))).toMatchObject({ kind: "saved", materialId: "m1", destination: { physicalPage: 8 } });
    expect(await r.tuple("m2")).toEqual([7, 0, B, "active", 1]);
    expect((await r.tuple("m1")) as unknown[]).toEqual(expect.arrayContaining([8, A, "active"]));
  });
});

describe("cancellation and commit ordering over the real transactions", () => {
  it("cancel first: a late commit for the cancelled generation is refused inside its transaction", async () => {
    const r = await rig();
    await r.controller.request(intent("m1", 4));
    const repo = navigationRepository(r.db);
    const { generation } = await repo.operation({ kind: "begin", materialId: "m1", supersedeGeneration: null });
    await repo.operation({ kind: "cancel", materialId: "m1", generation });
    const verdict = await repo.operation({ kind: "commit", materialId: "m1", generation, contentSha256: A, physicalPage: 30, pageLabel: null });
    expect(verdict).toMatchObject({ committed: false, reason: "cancelled" });
    expect(await r.tuple()).toEqual([4, 0, A, "active", 1]);
  });

  it("commit first: the save stands as a genuine earlier save and a later cancel is a no-op on it", async () => {
    const r = await rig();
    const repo = navigationRepository(r.db);
    await r.controller.request(intent("m1", 4));
    const { generation } = await repo.operation({ kind: "begin", materialId: "m1", supersedeGeneration: null });
    await repo.operation({ kind: "commit", materialId: "m1", generation, contentSha256: A, physicalPage: 30, pageLabel: null });
    await repo.operation({ kind: "cancel", materialId: "m1", generation });
    expect(await r.tuple()).toEqual([30, 0, A, "active", generation]);
  });
});

describe("failed saves, retry, abort and unmount", () => {
  it("a failed save after opening offers a save-only retry that resends the same generation without reopening", async () => {
    const r = await rig();
    r.fail.commit = new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
    const failed = await r.controller.request(intent("m1", 9));
    expect(failed).toMatchObject({ kind: "opened_unsaved", canRetry: true, message: expect.stringMatching(/Opened, but the page wasn't saved/) });
    expect(await r.tuple()).toBeNull();
    expect(await r.controller.retrySave()).toMatchObject({ kind: "saved", readingState: { lastRequestedPage: 9, ownerGeneration: 1 } });
    expect(r.calls).toEqual(["inspect:m1", "begin:m1", "open:m1", "commit:m1#1", "commit:m1#1"]);
    expect(await r.controller.retrySave(), "nothing left to retry").toBeNull();
  });

  it("a refused save (the file changed after checking) is reported and cannot be retried", async () => {
    const r = await rig();
    const heldCommit = (r.hold.commit = gate());
    const pending = r.controller.request(intent("m1", 9));
    await reached(r.calls, "commit:m1#1");
    await r.db.execute("UPDATE material_content_identities SET content_sha256 = ? WHERE material_id = 'm1'", [B]);
    heldCommit.resolve();
    expect(await pending).toMatchObject({ kind: "opened_unsaved", canRetry: false, message: expect.stringMatching(/file changed/) });
    expect(await r.controller.retrySave()).toBeNull();
    expect(await r.tuple()).toBeNull();
  });

  it("abort while the save is pending: the older tuple stays and nothing is published", async () => {
    const r = await rig();
    await r.controller.request(intent("m1", 4));
    const heldOpen = (r.hold.open = gate());
    const pending = r.controller.request(intent("m1", 9));
    await reached(r.calls, "open:m1", 2);
    r.controller.abort();
    heldOpen.resolve();
    expect(await pending).toBeNull();
    await flush();
    expect(r.controller.status()).toMatchObject({ kind: "idle" });
    expect(await r.tuple()).toEqual([4, 0, A, "active", 1]);
    expect(await r.claim()).toEqual([2, 2]);
  });

  it("unmount stops publication and cancels the held generation", async () => {
    const r = await rig();
    const seen: NavigationStatus[] = [];
    r.controller.subscribe(() => seen.push(r.controller.status()));
    const heldCommit = (r.hold.commit = gate());
    const pending = r.controller.request(intent("m1", 9));
    await reached(r.calls, "commit:m1#1");
    const before = seen.length;
    r.controller.dispose();
    heldCommit.resolve();
    expect(await pending).toBeNull();
    expect(seen.length).toBe(before);
  });

  it("an obsolete opener failure leaves the winner's status intact", async () => {
    const r = await rig();
    const heldOpen = (r.hold.open = gate());
    const older = r.controller.request(intent("m1", 9));
    await reached(r.calls, "open:m1");
    const newer = await r.controller.request(intent("m2", 3));
    heldOpen.reject(new Error("reader crashed"));
    expect(await older).toBeNull();
    expect(newer).toMatchObject({ kind: "saved", materialId: "m2" });
    expect(r.controller.status()).toBe(newer);
  });

  it("a new controller on the same database continues the durable order", async () => {
    const r = await rig();
    await r.controller.request(intent("m1", 4));
    await r.controller.request(intent("m1", 5));
    const second = new NavigationController({
      inspect: async () => ({ materialId: "m1", contentSha256: A, totalPages: 50, verifiedAt: "x", changed: false }),
      operation: (op) => navigationRepository(r.db).operation(op),
      open: async () => undefined,
      openForGuidance: async () => undefined,
    });
    expect(await second.request(intent("m1", 6))).toMatchObject({ kind: "saved", readingState: { ownerGeneration: 3 } });
  });
});
