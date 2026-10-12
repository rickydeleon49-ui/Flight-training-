/**
 * The production controller's additions over the accepted prototype: a
 * debrief-scoped list, item actions that replay their exact request after an
 * unknown outcome, ERASED from an item action evicting the observation, and
 * the quiet read-only reload used when the app's data changes elsewhere.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillEvidenceError } from "@/data/skillEvidenceTransaction";
import { observation, storeWithDebrief, uuid, type Engine } from "@/data/testing/skillEvidenceEngines";
import type { SkillEvidenceAction } from "@/domain/types";
import { createEvidenceController, type EvidenceClient } from "@/state/useSkillEvidence";

const open: Engine[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
});

async function setup() {
  const x = await storeWithDebrief();
  open.push(x.engine);
  const client: EvidenceClient = {
    page: (i) => x.store.page(i),
    summary: (i) => x.store.summary(i),
    act: (a) => x.store.act(a),
    history: (i) => x.store.history(i),
  };
  return { ...x, client };
}

const count = (e: Engine, sql: string) => Number(e.query(sql)[0]!["n"]);

describe("production controller", () => {
  it("a debrief's list shows only that debrief's observations, across skills, without a summary", async () => {
    const x = await setup();
    await x.store.act(observation("builtin.normal_landing", x.journalId, { wording: "From this debrief." }));
    await x.store.act(observation("builtin.go_around", x.journalId, { wording: "Also from it." }));
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "journal", journalId: x.journalId });
    expect(c.getState()).toMatchObject({ scope: `journal:${x.journalId}`, status: "ready", summary: null });
    expect(c.getState().items.map((i) => i.wording).sort()).toEqual(["Also from it.", "From this debrief."]);
  });

  it("an item action with an unknown outcome replays its exact request on the next try: one change, not two", async () => {
    const x = await setup();
    const o = observation("builtin.normal_landing", x.journalId);
    await x.store.act(o);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: o.skillId });
    const sent: SkillEvidenceAction[] = [];
    const real = x.client.act;
    let lose = true;
    x.client.act = async (a) => {
      sent.push(a);
      const result = await real(a);
      if (lose) {
        lose = false;
        throw new SkillEvidenceError("STORAGE_FAILURE", "The app couldn't confirm that.");
      }
      return result;
    };
    const intent = { item: o.observationId, revision: 1, addressed: true };
    const build = (operationId: string): SkillEvidenceAction => ({
      action: "set_addressed", operationId, observationId: o.observationId, expectedRevision: 1, addressed: true,
    });
    expect(await c.runAction(`addressed:${o.observationId}`, intent, build)).toMatchObject({ kind: "unknown" });
    expect(c.getState().writeError?.code).toBe("STORAGE_FAILURE");
    const second = await c.runAction(`addressed:${o.observationId}`, intent, build);
    expect(second).toMatchObject({ kind: "done", outcome: { status: "replayed" } });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(count(x.engine, "SELECT COUNT(*) AS n FROM skill_observation_revisions")).toBe(2);
    expect(c.getState().notice).toBe("saved");
  });

  it("changed item wording resolves the earlier unknown request without claiming the new wording was saved", async () => {
    const x = await setup();
    const o = observation("builtin.normal_landing", x.journalId);
    await x.store.act(o);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: o.skillId });
    const real = x.client.act;
    const sent: SkillEvidenceAction[] = [];
    let lose = true;
    x.client.act = async (a) => {
      sent.push(a);
      const result = await real(a);
      if (lose) { lose = false; throw new SkillEvidenceError("STORAGE_FAILURE", "Lost answer"); }
      return result;
    };
    const build = (wording: string) => (operationId: string): SkillEvidenceAction => ({
      action: "edit_observation", operationId, observationId: o.observationId, expectedRevision: 1,
      wording, observedOn: "2026-10-01", attribution: "self_report", instructorName: "",
    });
    expect(await c.runAction("edit", { wording: "Earlier" }, build("Earlier"))).toMatchObject({ kind: "unknown" });
    expect(await c.runAction("edit", { wording: "Changed" }, build("Changed"))).toMatchObject({ kind: "earlier_done" });
    expect(sent[1]).toEqual(sent[0]);
    expect((await x.store.page({})).items[0]!.wording).toBe("Earlier");
    expect(count(x.engine, "SELECT COUNT(*) AS n FROM skill_observation_revisions")).toBe(2);
  });

  it("a definitive refusal frees the key: the next try is a new request", async () => {
    const x = await setup();
    const o = observation("builtin.normal_landing", x.journalId);
    await x.store.act(o);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: o.skillId });
    const write = vi.spyOn(x.client, "act");
    const stale = (operationId: string): SkillEvidenceAction => ({
      action: "set_addressed", operationId, observationId: o.observationId, expectedRevision: 9, addressed: true,
    });
    expect(await c.runAction("k", { r: 9 }, stale)).toMatchObject({ kind: "refused", code: "STALE_REVISION" });
    expect(await c.runAction("k", { r: 9 }, stale)).toMatchObject({ kind: "refused", code: "STALE_REVISION" });
    const ids = write.mock.calls.map(([a]) => a.operationId);
    expect(new Set(ids).size).toBe(2);
  });

  it("an erase through the item menu, or an item action answered ERASED, evicts the observation and re-reads the summary", async () => {
    const x = await setup();
    const gone = observation("builtin.normal_landing", x.journalId, { wording: "Erased elsewhere." });
    const keep = observation("builtin.normal_landing", x.journalId, { wording: "Kept." });
    await x.store.act(gone);
    await x.store.act(keep);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: gone.skillId });
    expect(c.getState().summary?.observationCount).toBe(2);
    // A mark-addressed whose answer was lost (it landed), then an erase in another window.
    const real = x.client.act;
    x.client.act = async (a) => {
      await real(a);
      throw new SkillEvidenceError("STORAGE_FAILURE", "The app couldn't confirm that.");
    };
    const intent = { item: gone.observationId, revision: 1, addressed: true };
    const build = (operationId: string): SkillEvidenceAction => ({
      action: "set_addressed", operationId, observationId: gone.observationId, expectedRevision: 1, addressed: true,
    });
    expect(await c.runAction(`addressed:${gone.observationId}`, intent, build)).toMatchObject({ kind: "unknown" });
    x.client.act = real;
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: gone.observationId, confirm: "erase" });
    const reads = vi.spyOn(x.client, "page");
    // Trying again replays the exact request: its receipt is now a tombstone, so the answer is ERASED.
    const outcome = await c.runAction(`addressed:${gone.observationId}`, intent, build);
    expect(outcome).toMatchObject({ kind: "refused", code: "ERASED" });
    expect(c.getState().items.map((i) => i.wording)).toEqual(["Kept."]);
    await vi.waitFor(() => expect(c.getState().summary?.observationCount).toBe(1));
    expect(reads).not.toHaveBeenCalled();
    // Erasing the other one through the menu removes it at once and refreshes the list (reads only).
    await c.runAction(`erase:${keep.observationId}`, { item: keep.observationId }, (operationId) => ({
      action: "erase_observation", operationId, observationId: keep.observationId, confirm: "erase",
    }));
    expect(c.getState().items).toEqual([]);
    expect(count(x.engine, "SELECT COUNT(*) AS n FROM skill_observations")).toBe(0);
  });

  it("an item action answered NOT_FOUND re-reads the list (reads only), so a vanished observation leaves it", async () => {
    const x = await setup();
    const o = observation("builtin.normal_landing", x.journalId, { wording: "Erased in another window." });
    await x.store.act(o);
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: o.skillId });
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: o.observationId, confirm: "erase" });
    const write = vi.spyOn(x.client, "act");
    const outcome = await c.runAction(`edit:${o.observationId}`, { e: 1 }, (operationId) => ({
      action: "edit_observation", operationId, observationId: o.observationId, expectedRevision: 1,
      wording: "Edited.", observedOn: "2026-10-01", attribution: "self_report", instructorName: "",
    }));
    expect(outcome).toMatchObject({ kind: "refused", code: "NOT_FOUND" });
    expect(c.getState().items).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("a quiet reload re-reads without notices and keeps loaded content when the read fails", async () => {
    const x = await setup();
    await x.store.act(observation("builtin.normal_landing", x.journalId, { wording: "Loaded." }));
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    await x.store.act(observation("builtin.normal_landing", x.journalId, { wording: "Added elsewhere." }));
    await c.reload();
    expect(c.getState().items.map((i) => i.wording).sort()).toEqual(["Added elsewhere.", "Loaded."]);
    x.client.page = () => Promise.reject(new Error("read failed"));
    await c.reload();
    expect(c.getState().items).toHaveLength(2);
  });
});
