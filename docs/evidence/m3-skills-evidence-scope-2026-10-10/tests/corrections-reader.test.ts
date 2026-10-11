/**
 * Permanent regressions for review findings M3-R4 (every stored revision is
 * reachable through bounded pages) and M3-R7 (editable dates while paging),
 * on node:sqlite and sql.js, plus the controller's coherent restart.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { Engine, EngineName } from "../prototype/candidateEngine";
import { createEvidenceController, type EvidenceClient } from "../prototype/evidenceController";
import { EDITS_AFTER_FENCE_SQL, FENCE_SQL, encodeHistoryCursor } from "../prototype/skillEvidenceReader";
import { LIMITS, type SkillEvidenceAction } from "../prototype/types";
import { candidateWithDebrief, clock, expectCode, observation, uuid } from "./helpers";

const engines: EngineName[] = ["node:sqlite", "sql.js"];
const open: Engine[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
});

async function setup(name: EngineName) {
  const ctx = await candidateWithDebrief(name);
  open.push(ctx.engine);
  return ctx;
}

type Store = Awaited<ReturnType<typeof setup>>["store"];
type Create = Extract<SkillEvidenceAction, { action: "create_observation" }>;

function edit(o: Create, expectedRevision: number, changes: Partial<Pick<Create, "wording" | "observedOn" | "attribution" | "instructorName">>) {
  return {
    action: "edit_observation" as const, operationId: uuid(), observationId: o.observationId, expectedRevision,
    wording: changes.wording ?? o.wording, observedOn: changes.observedOn ?? o.observedOn,
    attribution: changes.attribution ?? o.attribution, instructorName: changes.instructorName ?? o.instructorName,
  };
}

async function walkHistory(store: Store, observationId: string, limit: number) {
  const revisions: number[] = [];
  const wordings: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await store.history({ observationId, cursor, limit });
    expect(page.items.length).toBeLessThanOrEqual(limit);
    revisions.push(...page.items.map((r) => r.revision));
    wordings.push(...page.items.map((r) => r.wording));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 1000);
  return { revisions, wordings, pages };
}

describe.each(engines)("M3-R4 complete revision access (%s)", (name) => {
  it("[M3-R4] the earliest wording is reachable through bounded pages after 100 later revisions", async () => {
    const x = await setup(name);
    const o = observation("builtin.normal_landing", x.journalId, { wording: "Earliest wording" });
    await x.store.act(o);
    for (let revision = 1; revision <= 100; revision++) await x.store.act(edit(o, revision, { wording: `Edit ${revision}` }));
    expect(Number(x.engine.query("SELECT COUNT(*) AS n FROM skill_observation_revisions")[0]!["n"])).toBe(101);
    const full = await walkHistory(x.store, o.observationId, LIMITS.revisionPageMax);
    expect(full.pages).toBe(2);
    expect(full.revisions).toEqual(Array.from({ length: 101 }, (_, i) => 101 - i));
    expect(full.wordings.at(-1)).toBe("Earliest wording");
    // Smaller pages reach the same revision 1, without gaps or repeats.
    const small = await walkHistory(x.store, o.observationId, 7);
    expect(small.pages).toBe(15);
    expect(small.revisions).toEqual(full.revisions);
  });

  it("[M3-R4] a page holds 1-100 versions; the default is 20", async () => {
    const x = await setup(name);
    const o = observation("builtin.normal_landing", x.journalId);
    await x.store.act(o);
    for (let revision = 1; revision <= 24; revision++) await x.store.act(edit(o, revision, { wording: `Edit ${revision}` }));
    const first = await x.store.history({ observationId: o.observationId });
    expect(first.items).toHaveLength(LIMITS.revisionPageDefault);
    expect(first.currentRevision).toBe(25);
    await expectCode(x.store.history({ observationId: o.observationId, limit: 0 }), "LIMIT_EXCEEDED");
    await expectCode(x.store.history({ observationId: o.observationId, limit: LIMITS.revisionPageMax + 1 }), "LIMIT_EXCEEDED");
  });

  it("[M3-R4] a history cursor is bound to its observation and validated", async () => {
    const x = await setup(name);
    const a = observation("builtin.normal_landing", x.journalId);
    const b = observation("builtin.normal_landing", x.journalId, { wording: "Other." });
    await x.store.act(a);
    await x.store.act(b);
    for (let revision = 1; revision <= 3; revision++) await x.store.act(edit(a, revision, { wording: `Edit ${revision}` }));
    // b has more revisions than a's cursor names, so only the observation binding can refuse it.
    for (let revision = 1; revision <= 5; revision++) await x.store.act(edit(b, revision, { wording: `Other edit ${revision}` }));
    const page = await x.store.history({ observationId: a.observationId, limit: 2 });
    expect(page.nextCursor).not.toBeNull();
    await expectCode(x.store.history({ observationId: b.observationId, cursor: page.nextCursor }), "INVALID_ARGUMENT");
    await expectCode(x.store.history({ observationId: a.observationId, cursor: encodeHistoryCursor(a.observationId, 9) }), "INVALID_ARGUMENT");
    await expectCode(x.store.history({ observationId: a.observationId, cursor: encodeHistoryCursor(a.observationId, 1) }), "INVALID_ARGUMENT");
    await expectCode(x.store.history({ observationId: a.observationId, cursor: "[\"history\"]" }), "INVALID_ARGUMENT");
    await expectCode(x.store.history({ observationId: "not-a-uuid" }), "INVALID_ARGUMENT");
  });

  it("[M3-R4] newer revisions never move older pages; an erased observation is ERASED, an unknown one NOT_FOUND", async () => {
    const x = await setup(name);
    const o = observation("builtin.normal_landing", x.journalId, { wording: "Earliest wording" });
    await x.store.act(o);
    for (let revision = 1; revision <= 4; revision++) await x.store.act(edit(o, revision, { wording: `Edit ${revision}` }));
    const first = await x.store.history({ observationId: o.observationId, limit: 2 });
    expect(first.items.map((r) => r.revision)).toEqual([5, 4]);
    await x.store.act(edit(o, 5, { wording: "Edit 5" }));
    const second = await x.store.history({ observationId: o.observationId, limit: 2, cursor: first.nextCursor });
    expect(second.items.map((r) => r.revision)).toEqual([3, 2]);
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: o.observationId, confirm: "erase" });
    await expectCode(x.store.history({ observationId: o.observationId, limit: 2, cursor: second.nextCursor }), "ERASED");
    await expectCode(x.store.history({ observationId: uuid() }), "NOT_FOUND");
  });
});

describe.each(engines)("M3-R7 date edits while paging (%s)", (name) => {
  /** Observations on the given dates (newest first by date), each recorded one second apart. */
  async function dated(x: Awaited<ReturnType<typeof setup>>, dates: string[], skillId = "builtin.normal_landing") {
    const c = clock();
    const made: Create[] = [];
    for (const [i, observedOn] of dates.entries()) {
      c.advance();
      const o = observation(skillId, x.journalId, { observedOn, sourceField: "none", wording: `Note ${i}` });
      await x.store.act(o, { now: c.now });
      made.push(o);
    }
    return made;
  }

  it("[M3-R7] a seen observation moved below the cursor is refused as STALE_CURSOR, never repeated", async () => {
    const x = await setup(name);
    const [a, , ] = await dated(x, ["2026-10-03", "2026-10-02", "2026-10-01"]);
    const first = await x.store.page({ skillId: a!.skillId, limit: 1 });
    expect(first.items[0]!.id).toBe(a!.observationId);
    await x.store.act(edit(a!, 1, { observedOn: "2026-09-30" }));
    await expectCode(x.store.page({ skillId: a!.skillId, limit: 50, cursor: first.nextCursor }), "STALE_CURSOR");
  });

  it("[M3-R7] an unseen observation moved above the cursor is refused, never silently skipped", async () => {
    const x = await setup(name);
    const [, , d] = await dated(x, ["2026-10-03", "2026-10-02", "2026-10-01"]);
    const first = await x.store.page({ skillId: d!.skillId, limit: 1 });
    await x.store.act(edit(d!, 1, { observedOn: "2026-10-09" }));
    await expectCode(x.store.page({ skillId: d!.skillId, limit: 50, cursor: first.nextCursor }), "STALE_CURSOR");
  });

  it("[M3-R7] same-date ties: moving a seen row of a tied date below the cursor is detected", async () => {
    const x = await setup(name);
    const rows = await dated(x, ["2026-10-01", "2026-10-01", "2026-10-01", "2026-10-01"]);
    const first = await x.store.page({ limit: 2 });
    const seen = rows.find((r) => r.observationId === first.items[0]!.id)!;
    await x.store.act(edit(seen, 1, { observedOn: "2026-09-01" }));
    await expectCode(x.store.page({ limit: 2, cursor: first.nextCursor }), "STALE_CURSOR");
  });

  it("[M3-R7] wording-only edits, edits that stay on their side, inserts and erasures keep the cursor valid, with no repeat or gap", async () => {
    const x = await setup(name);
    const rows = await dated(x, ["2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    const first = await x.store.page({ limit: 3 });
    expect(first.items.map((i) => i.id)).toEqual(rows.slice(0, 3).map((r) => r.observationId));
    await x.store.act(edit(rows[0]!, 1, { wording: "Reworded, same date." }));
    await x.store.act(edit(rows[1]!, 1, { observedOn: "2026-10-30" })); // seen, stays above
    await x.store.act(edit(rows[4]!, 1, { observedOn: "2026-09-01" })); // unseen, stays below
    await x.store.act(observation("builtin.normal_landing", x.journalId, { observedOn: "2026-11-01", sourceField: "none", wording: "Newer." }));
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: rows[3]!.observationId, confirm: "erase" });
    const second = await x.store.page({ limit: 3, cursor: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual([rows[5]!.observationId, rows[4]!.observationId]);
    expect(second.nextCursor).toBeNull();
  });

  it("[M3-R7] an edit in another skill's list does not disturb this list's cursor", async () => {
    const x = await setup(name);
    const mine = await dated(x, ["2026-10-03", "2026-10-02", "2026-10-01"]);
    const [other] = await dated(x, ["2026-10-02"], "builtin.go_around");
    const first = await x.store.page({ skillId: "builtin.normal_landing", limit: 1 });
    await x.store.act(edit(other!, 1, { observedOn: "2026-10-10" }));
    const second = await x.store.page({ skillId: "builtin.normal_landing", limit: 5, cursor: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual([mine[1]!.observationId, mine[2]!.observationId]);
  });

  it("[M3-R7] with an attribution filter, an attribution edit that brings a seen row back below the cursor is detected", async () => {
    const x = await setup(name);
    const rows = await dated(x, ["2026-10-03", "2026-10-02", "2026-10-01"]);
    const first = await x.store.page({ attribution: "instructor_transcribed", limit: 1 });
    expect(first.items[0]!.id).toBe(rows[0]!.observationId);
    await x.store.act(edit(rows[0]!, 1, { observedOn: "2026-09-01", attribution: "self_report", instructorName: "" }));
    // It left the filter: harmless.
    const ok = await x.store.page({ attribution: "instructor_transcribed", limit: 1, cursor: first.nextCursor });
    expect(ok.items[0]!.id).toBe(rows[1]!.observationId);
    await x.store.act(edit(rows[0]!, 2, { attribution: "instructor_transcribed", instructorName: "Synthetic CFI" }));
    // Back in the filter below the cursor: it would repeat.
    await expectCode(x.store.page({ attribution: "instructor_transcribed", limit: 1, cursor: ok.nextCursor }), "STALE_CURSOR");
  });

  it("[M3-R7] a cursor is bound to its normalized filters and validated", async () => {
    const x = await setup(name);
    await dated(x, ["2026-10-03", "2026-10-02"]);
    const first = await x.store.page({ skillId: "builtin.normal_landing", limit: 1 });
    await expectCode(x.store.page({ skillId: "builtin.go_around", limit: 1, cursor: first.nextCursor }), "INVALID_ARGUMENT");
    await expectCode(x.store.page({ limit: 1, cursor: first.nextCursor }), "INVALID_ARGUMENT");
    await expectCode(x.store.page({ skillId: "builtin.normal_landing", attribution: "self_report", limit: 1, cursor: first.nextCursor }), "INVALID_ARGUMENT");
    const plain = await x.store.page({ limit: 1 });
    // Absent and empty filters are the same list.
    expect((await x.store.page({ skillId: "", journalId: null, limit: 1, cursor: plain.nextCursor })).items).toHaveLength(1);
    const forged = JSON.parse(plain.nextCursor!) as unknown[];
    await expectCode(x.store.page({ limit: 1, cursor: JSON.stringify([...forged.slice(0, 7), 10_000]) }), "INVALID_ARGUMENT");
    await expectCode(x.store.page({ limit: 1, cursor: JSON.stringify([...forged.slice(0, 7), -1]) }), "INVALID_ARGUMENT");
    await expectCode(x.store.page({ limit: 1, cursor: JSON.stringify([...forged.slice(0, 4), "2026-02-30", ...forged.slice(5)]) }), "INVALID_ARGUMENT");
  });

  it("[M3-R7] restarting after STALE_CURSOR walks every observation exactly once", async () => {
    const x = await setup(name);
    const rows = await dated(x, ["2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    const first = await x.store.page({ limit: 2 });
    await x.store.act(edit(rows[0]!, 1, { observedOn: "2026-09-15" })); // seen -> below
    await x.store.act(edit(rows[4]!, 1, { observedOn: "2026-10-20" })); // unseen -> above
    await expectCode(x.store.page({ limit: 2, cursor: first.nextCursor }), "STALE_CURSOR");
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await x.store.page({ limit: 2, cursor });
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual([rows[4], rows[1], rows[2], rows[3], rows[0]].map((r) => r!.observationId));
  });
});

describe("M3-R7 controller restart", () => {
  it("[M3-R7] Show older after a crossing edit restarts the list from the newest, with no repeat", async () => {
    const x = await setup("node:sqlite");
    const c0 = clock();
    const rows: Create[] = [];
    for (const [i, observedOn] of ["2026-10-03", "2026-10-02", "2026-10-01"].entries()) {
      c0.advance();
      const o = observation("builtin.normal_landing", x.journalId, { observedOn, sourceField: "none", wording: `Note ${i}` });
      await x.store.act(o, { now: c0.now });
      rows.push(o);
    }
    const client: EvidenceClient = {
      page: (input) => x.store.page(input), summary: (id) => x.store.summary(id), act: (a) => x.store.act(a), history: (i) => x.store.history(i),
    };
    const c = createEvidenceController(client, { newId: uuid, pageSize: 1 });
    await c.open("builtin.normal_landing");
    expect(c.getState().items.map((i) => i.id)).toEqual([rows[0]!.observationId]);
    await x.store.act(edit(rows[0]!, 1, { observedOn: "2026-09-30" }));
    await c.loadMore();
    expect(c.getState()).toMatchObject({ listNotice: "restarted", loadingMore: false, status: "ready" });
    expect(c.getState().items.map((i) => i.id)).toEqual([rows[1]!.observationId]);
    await c.loadMore();
    await c.loadMore();
    expect(c.getState().items.map((i) => i.id)).toEqual([rows[1], rows[2], rows[0]].map((r) => r!.observationId));
    expect(c.getState().nextCursor).toBeNull();
  });

  it("[M3-R7] a late older page from before a restart is dropped", async () => {
    let releaseOld!: () => void;
    const gate = new Promise<void>((r) => (releaseOld = r));
    let reads = 0;
    const client: EvidenceClient = {
      page: async (input) => {
        reads += 1;
        if (!input.cursor) return { items: [{ id: `first-${reads}` } as never], nextCursor: "cursor" };
        if (reads === 2) {
          await gate;
          return { items: [{ id: "late-older" } as never], nextCursor: null };
        }
        throw Object.assign(new Error("stale"), { code: "STALE_CURSOR" });
      },
      summary: async () => null,
      act: async () => {
        throw new Error("unused");
      },
      history: async () => ({ observationId: "", currentRevision: 0, items: [], nextCursor: null }),
    };
    const c = createEvidenceController(client, { newId: uuid });
    await c.open("builtin.normal_landing");
    const held = c.loadMore();
    await c.retryRead();
    releaseOld();
    await held;
    expect(c.getState().items.some((i) => i.id === "late-older")).toBe(false);
  });
});

describe("M3-R7 query plans", () => {
  it("node:sqlite: the fence and edits-after-fence lookups are rowid searches, not scans", async () => {
    const x = await setup("node:sqlite");
    const plan = (sql: string, params: (string | number)[]) =>
      x.engine.query(`EXPLAIN QUERY PLAN ${sql}`, params).map((r) => String(r["detail"])).join(" | ");
    const fence = plan(FENCE_SQL, []);
    const edits = plan(EDITS_AFTER_FENCE_SQL, [0]);
    console.log(`plan(fence): ${fence}`);
    console.log(`plan(edits after fence): ${edits}`);
    expect(edits).toMatch(/SEARCH skill_evidence_operations USING INTEGER PRIMARY KEY \(rowid>\?\)/);
    expect(fence).not.toMatch(/SCAN skill_evidence_operations(?! USING)/);
  });
});

describe.each(engines)("M3-R5 replay trusts only a decoded result (%s)", (name) => {
  it("[M3-R5] replaying a receipt whose result names another observation is STORAGE_FAILURE, not that identity", async () => {
    const x = await setup(name);
    const request = observation("builtin.normal_landing", x.journalId);
    await x.store.act(request);
    x.engine.run("UPDATE skill_evidence_operations SET result_json = ? WHERE operation_id = ?", [
      JSON.stringify({ action: "create_observation", observationId: uuid(), revision: 1 }), request.operationId,
    ]);
    await expectCode(x.store.act(request), "STORAGE_FAILURE");
    x.engine.run("UPDATE skill_evidence_operations SET result_json = ? WHERE operation_id = ?", [
      JSON.stringify({ action: "create_observation", observationId: request.observationId, revision: 1, extra: true }), request.operationId,
    ]);
    await expectCode(x.store.act(request), "STORAGE_FAILURE");
    x.engine.run("UPDATE skill_evidence_operations SET result_json = ? WHERE operation_id = ?", [
      JSON.stringify({ action: "create_observation", observationId: request.observationId, revision: 1 }), request.operationId,
    ]);
    expect(await x.store.act(request)).toEqual({ status: "replayed", result: { action: "create_observation", observationId: request.observationId, revision: 1 } });
  });

  it("[M3-R5] earlier receipts still replay after later edits, a cleared status and a deleted debrief", async () => {
    const x = await setup(name);
    const request = observation("builtin.normal_landing", x.journalId);
    await x.store.act(request);
    await x.store.act(edit(request, 1, { wording: "Later wording." }));
    const status = { action: "set_status" as const, operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 0, status: "practicing" as const };
    await x.store.act(status);
    await x.store.act({ action: "set_status", operationId: uuid(), skillId: "builtin.normal_landing", expectedSequence: 1, status: null });
    x.engine.run("DELETE FROM journal_entries WHERE id = ?", [x.journalId]);
    expect((await x.store.act(request)).result).toEqual({ action: "create_observation", observationId: request.observationId, revision: 1 });
    expect((await x.store.act(status)).result).toEqual({ action: "set_status", skillId: "builtin.normal_landing", sequence: 1 });
    await x.store.validate();
  });
});
