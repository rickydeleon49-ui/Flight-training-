/**
 * Permanent regressions for re-review finding M3-R10: once the reader
 * confirms an observation is ERASED, nothing already loaded about it stays
 * visible, and no late answer can bring it back. Temporary read failures are
 * not erasure. Real candidate store (node:sqlite); timing via wrappers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "../prototype/candidateEngine";
import { createEvidenceController, type EvidenceClient } from "../prototype/evidenceController";
import type { EvidencePage, ObservationHistoryPage, SkillEvidenceAction } from "../prototype/types";
import { candidateWithDebrief, clock, observation, uuid } from "./helpers";

const open: Engine[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
});

async function setup() {
  const x = await candidateWithDebrief();
  open.push(x.engine);
  const client: EvidenceClient = {
    page: (i) => x.store.page(i),
    summary: (i) => x.store.summary(i),
    act: (a) => x.store.act(a),
    history: (i) => x.store.history(i),
  };
  return { ...x, client };
}

type Create = Extract<SkillEvidenceAction, { action: "create_observation" }>;
const edit = (o: Create, expectedRevision: number, wording: string) => ({
  action: "edit_observation" as const, operationId: uuid(), observationId: o.observationId, expectedRevision,
  wording, observedOn: o.observedOn, attribution: o.attribution, instructorName: o.instructorName,
});
const erase = (o: Create) => ({ action: "erase_observation" as const, operationId: uuid(), observationId: o.observationId, confirm: "erase" as const });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** An observation with two revisions, so its history has an older page at page size 1. */
async function withHistory(x: Awaited<ReturnType<typeof setup>>, wording = "Private history wording", observedOn = "2026-10-01") {
  const o = observation("builtin.normal_landing", x.journalId, { wording, observedOn, sourceField: "none" });
  await x.store.act(o);
  await x.store.act(edit(o, 1, `Latest ${wording}`));
  return o;
}

describe("M3-R10 confirmed erasure", () => {
  it("[M3-R10] confirmed erased history discards loaded text and cursor (review case), and leaves the list", async () => {
    const x = await setup();
    const o = await withHistory(x);
    const c = createEvidenceController(x.client, { newId: uuid, historyPageSize: 1 });
    await c.open(o.skillId);
    await c.openHistory(o.observationId);
    expect(c.getState().history).toMatchObject({ items: [{ revision: 2 }], currentRevision: 2 });
    expect(c.getState().history!.nextCursor).not.toBeNull();
    await x.store.act(erase(o));
    const writes = vi.spyOn(x.client, "act");
    await c.loadOlderHistory();
    expect(c.getState().history).toEqual({
      observationId: o.observationId, status: "error", erased: true, items: [], currentRevision: null, nextCursor: null, loadingMore: false,
      error: "This observation was erased.",
    });
    expect(c.getState().items.some((i) => i.id === o.observationId)).toBe(false);
    await vi.waitFor(() => expect(c.getState().summary).toMatchObject({ observationCount: 0, evidence: "none" }));
    expect(writes).not.toHaveBeenCalled();
    expect(JSON.stringify(c.getState())).not.toMatch(/Private history wording/);
  });

  it("[M3-R10] opening the history of an observation erased elsewhere evicts it from the list and the summary", async () => {
    const x = await setup();
    const o = await withHistory(x);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open(o.skillId);
    expect(c.getState().items).toHaveLength(1);
    await x.store.act(erase(o));
    await c.openHistory(o.observationId);
    expect(c.getState().history).toMatchObject({ erased: true, items: [], error: "This observation was erased." });
    expect(c.getState().items).toEqual([]);
    await vi.waitFor(() => expect(c.getState().summary?.observationCount).toBe(0));
  });

  it("[M3-R10] unrelated observations, and their history, stay", async () => {
    const x = await setup();
    const keep = await withHistory(x, "Keep this wording", "2026-10-02");
    const gone = await withHistory(x, "Erase this wording", "2026-10-01");
    const c = createEvidenceController(x.client, { newId: uuid, historyPageSize: 1 });
    await c.open(keep.skillId);
    await c.openHistory(keep.observationId);
    await x.store.act(erase(gone));
    await c.openHistory(gone.observationId);
    expect(c.getState().items.map((i) => i.id)).toEqual([keep.observationId]);
    await vi.waitFor(() => expect(c.getState().summary?.observationCount).toBe(1));
    await c.openHistory(keep.observationId);
    await c.loadOlderHistory();
    expect(c.getState().history!.items.map((r) => r.wording)).toEqual(["Latest Keep this wording", "Keep this wording"]);
  });

  it("[M3-R10] a held older history page that arrives after the erasure is known cannot republish it", async () => {
    const x = await setup();
    const o = await withHistory(x);
    const gate = deferred();
    const history = x.client.history;
    x.client.history = async (input) => {
      if (!input.cursor) return history(input);
      const stale = await history(input); // read before the erase commits
      await gate.promise;
      return stale;
    };
    const c = createEvidenceController(x.client, { newId: uuid, historyPageSize: 1 });
    await c.open(o.skillId);
    await c.openHistory(o.observationId);
    const older = c.loadOlderHistory();
    await vi.waitFor(() => expect(c.getState().history!.loadingMore).toBe(true));
    await x.store.act(erase(o));
    await c.openHistory(o.observationId); // ERASED: evicted
    gate.resolve();
    await older;
    expect(c.getState().history).toMatchObject({ erased: true, items: [], nextCursor: null });
    expect(JSON.stringify(c.getState())).not.toMatch(/Private history wording/);
  });

  it("[M3-R10] a held evidence page read before the erasure cannot put the erased observation back in the list", async () => {
    const x = await setup();
    const c0 = clock();
    const newer = observation("builtin.normal_landing", x.journalId, { observedOn: "2026-10-02", sourceField: "none", wording: "Newer note" });
    const older = observation("builtin.normal_landing", x.journalId, { observedOn: "2026-10-01", sourceField: "none", wording: "Older private note" });
    for (const o of [newer, older]) {
      c0.advance();
      await x.store.act(o, { now: c0.now });
    }
    const gate = deferred();
    const page = x.client.page;
    x.client.page = async (input) => {
      if (!input.cursor) return page(input);
      const stale: EvidencePage = await page(input);
      await gate.promise;
      return stale;
    };
    const c = createEvidenceController(x.client, { newId: uuid, pageSize: 1 });
    await c.open(newer.skillId);
    const more = c.loadMore();
    await x.store.act(erase(older));
    await c.openHistory(older.observationId); // ERASED: evicted before the held page lands
    gate.resolve();
    await more;
    expect(c.getState().items.map((i) => i.wording)).toEqual(["Newer note"]);
  });

  it("[M3-R10] an erasure answer that lands after a route change leaves the new skill alone", async () => {
    const x = await setup();
    const o = await withHistory(x);
    await x.store.act(observation("builtin.go_around", x.journalId, { sourceField: "none", wording: "Go-around note" }));
    const gate = deferred();
    const history = x.client.history;
    x.client.history = async (input) => {
      if (input.cursor) await gate.promise;
      return history(input);
    };
    const c = createEvidenceController(x.client, { newId: uuid, historyPageSize: 1 });
    await c.open(o.skillId);
    await c.openHistory(o.observationId);
    const older = c.loadOlderHistory();
    await x.store.act(erase(o));
    await c.open("builtin.go_around");
    gate.resolve();
    await older;
    expect(c.getState()).toMatchObject({ skillId: "builtin.go_around", history: null });
    expect(c.getState().items.map((i) => i.wording)).toEqual(["Go-around note"]);
  });

  it("[M3-R10] a save whose earlier request turns out erased evicts that observation too", async () => {
    const x = await setup();
    const real = x.client.act;
    x.client.act = async (a) => {
      await real(a);
      throw new Error("lost acknowledgment");
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open("builtin.normal_landing");
    const draft = { skillId: "builtin.normal_landing", journalId: x.journalId, sourceField: "none" as const, wording: "Saved then erased", observedOn: "2026-10-01", attribution: "self_report" as const, instructorName: "" };
    await c.saveObservation("d", draft);
    await c.retryRead();
    expect(c.getState().items.map((i) => i.wording)).toEqual(["Saved then erased"]);
    x.client.act = real;
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: c.draftIdentity("d")!.observationId, confirm: "erase" });
    expect(await c.saveObservation("d", { ...draft, wording: "Changed" })).toEqual({ kind: "erased" });
    expect(c.getState().items).toEqual([]);
    await vi.waitFor(() => expect(c.getState().summary?.observationCount).toBe(0));
  });

  it("[control] a temporary older-history read error preserves loaded history for retry (review control)", async () => {
    const x = await setup();
    const o = await withHistory(x, "Latest safe wording");
    const c = createEvidenceController(x.client, { newId: uuid, historyPageSize: 1 });
    await c.open(o.skillId);
    await c.openHistory(o.observationId);
    const loaded = c.getState().history!;
    const history = x.client.history;
    x.client.history = () => Promise.reject(new Error("temporary read outage"));
    await c.loadOlderHistory();
    expect(c.getState().history).toMatchObject({ items: loaded.items, nextCursor: loaded.nextCursor, erased: false, error: "We couldn't load older versions right now." });
    expect(c.getState().items.map((i) => i.id)).toEqual([o.observationId]);
    x.client.history = history;
    await c.loadOlderHistory();
    expect(c.getState().history!.items.map((r) => r.revision)).toEqual([2, 1]);
  });

  it("[control] a temporary failure opening history keeps the observation listed", async () => {
    const x = await setup();
    const o = await withHistory(x);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open(o.skillId);
    x.client.history = (): Promise<ObservationHistoryPage> => Promise.reject(new Error("busy"));
    await c.openHistory(o.observationId);
    expect(c.getState().history).toMatchObject({ erased: false, error: "We couldn't load its earlier versions right now." });
    expect(c.getState().items.map((i) => i.id)).toEqual([o.observationId]);
  });
});
