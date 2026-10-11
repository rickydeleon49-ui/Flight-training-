/**
 * Permanent regressions for review findings M3-R1 (write, draft and paging
 * ownership) and M3-R2 (uncertain-save recovery and draft retention), over a
 * real candidate store (node:sqlite) with timing controlled by wrappers.
 * The reviewer's frozen diagnostics are reproduced here as named cases.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/data/testing/skillEvidenceEngines";
import { createEvidenceController, type EvidenceClient, type ObservationDraft } from "@/state/useSkillEvidence";
import { SkillEvidenceError } from "@/data/skillEvidenceTransaction";
import type { EvidencePage, SkillEvidenceAction, SkillEvidenceOutcome } from "@/domain/types";
import { storeWithDebrief, uuid } from "@/data/testing/skillEvidenceEngines";

const open: Engine[] = [];
afterEach(() => {
  for (const e of open.splice(0)) e.close();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function realClient() {
  const ctx = await storeWithDebrief();
  open.push(ctx.engine);
  const client: EvidenceClient = {
    page: (input) => ctx.store.page(input),
    summary: (id) => ctx.store.summary(id),
    act: (a) => ctx.store.act(a),
    history: (input) => ctx.store.history(input),
  };
  return { ...ctx, client };
}

const draft = (journalId: string, wording = "First wording", skillId = "builtin.normal_landing"): ObservationDraft => ({
  skillId, journalId, sourceField: "none", wording, observedOn: "2026-10-01", attribution: "self_report", instructorName: "",
});
const observations = (e: Engine) => Number(e.query("SELECT COUNT(*) AS n FROM skill_observations")[0]!["n"]);
const wordings = (e: Engine) => e.query("SELECT wording FROM skill_observations ORDER BY wording").map((r) => r["wording"]);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("M3-R1 write ownership", () => {
  it("[M3-R1a] an acknowledged save keeps its draft identity while its refresh is held: a repeat submit writes nothing", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const held = deferred<EvidencePage>();
    const page = x.client.page;
    x.client.page = () => held.promise;
    const write = vi.spyOn(x.client, "act");
    const first = c.saveObservation("d", draft(x.journalId));
    await vi.waitFor(() => expect(c.getState().notice).toBe("saved"));
    const second = c.saveObservation("d", draft(x.journalId));
    held.resolve(await page({ skillId: "builtin.normal_landing" }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ kind: "saved", revision: 1 });
    expect(b).toEqual(a);
    expect(write).toHaveBeenCalledTimes(1);
    expect(observations(x.engine)).toBe(1);
    // After the refresh settles the same content still resolves to the same save, without a write.
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "saved", observationId: a.kind === "saved" ? a.observationId : "" });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("[M3-R1a] only an explicit new draft starts a fresh observation under the same key", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    await c.saveObservation("d", draft(x.journalId));
    expect(c.startNewDraft("d")).toBe(true);
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "saved" });
    expect(observations(x.engine)).toBe(2);
  });

  it("[M3-R1b] a late A acknowledgment cannot clear B's saving lock, announce on B, or refresh B", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const a = deferred<SkillEvidenceOutcome>();
    const b = deferred<SkillEvidenceOutcome>();
    const requests: SkillEvidenceAction[] = [];
    x.client.act = (req) => {
      requests.push(req);
      return requests.length === 1 ? a.promise : b.promise;
    };
    const fa = c.saveObservation("A", draft(x.journalId));
    await c.open({ kind: "skill", skillId: "builtin.stalls" });
    const reads = vi.spyOn(x.client, "page");
    const fb = c.saveObservation("B", draft(x.journalId, "B wording", "builtin.stalls"));
    expect(c.getState().saving).toBe(true);
    const created = (req: SkillEvidenceAction) => ({ status: "applied" as const, result: { action: "create_observation" as const, observationId: (req as { observationId: string }).observationId, revision: 1 } });
    a.resolve(created(requests[0]!));
    expect(await fa).toMatchObject({ kind: "saved" });
    expect(c.getState()).toMatchObject({ scope: `skill:${"builtin.stalls"}`, saving: true, notice: null, writeError: null });
    expect(reads).not.toHaveBeenCalled();
    b.resolve(created(requests[1]!));
    expect(await fb).toMatchObject({ kind: "saved" });
    expect(c.getState()).toMatchObject({ saving: false, notice: "saved" });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("[M3-R1b] a late A refusal cannot put an error or unlock on B", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const a = deferred<SkillEvidenceOutcome>();
    const b = deferred<SkillEvidenceOutcome>();
    let calls = 0;
    x.client.act = () => (++calls === 1 ? a.promise : b.promise);
    const fa = c.saveObservation("A", draft(x.journalId));
    await c.open({ kind: "skill", skillId: "builtin.stalls" });
    const fb = c.saveObservation("B", draft(x.journalId, "B wording", "builtin.stalls"));
    a.reject(new SkillEvidenceError("SOURCE_MISSING", "That lesson debrief no longer exists."));
    expect(await fa).toMatchObject({ kind: "refused", code: "SOURCE_MISSING" });
    expect(c.getState()).toMatchObject({ saving: true, writeError: null, notice: null });
    b.reject(new SkillEvidenceError("SKILL_RETIRED", "That skill is retired."));
    await fb;
    expect(c.getState()).toMatchObject({ saving: false, writeError: { code: "SKILL_RETIRED" } });
  });

  it("[M3-R1b] A -> B -> A: A's late save lands on A again and announces there, never on B", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const a = deferred<void>();
    const real = x.client.act;
    x.client.act = async (req) => {
      await a.promise;
      return real(req);
    };
    const fa = c.saveObservation("A", draft(x.journalId));
    await c.open({ kind: "skill", skillId: "builtin.stalls" });
    expect(c.getState().saving).toBe(false); // B is not locked by A
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(c.getState().saving).toBe(true); // back on A, A's save is still in flight
    a.resolve();
    expect(await fa).toMatchObject({ kind: "saved" });
    expect(c.getState()).toMatchObject({ scope: `skill:${"builtin.normal_landing"}`, saving: false, notice: "saved" });
    expect(c.getState().items.map((i) => i.wording)).toEqual(["First wording"]);
  });

  it("[M3-R1b] two draft keys on one skill keep the lock until both settle", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const gates = [deferred<void>(), deferred<void>()];
    let calls = 0;
    const real = x.client.act;
    x.client.act = async (req) => {
      await gates[calls++]!.promise;
      return real(req);
    };
    const one = c.saveObservation("one", draft(x.journalId, "One"));
    const two = c.saveObservation("two", draft(x.journalId, "Two"));
    gates[0]!.resolve();
    await one;
    expect(c.getState().saving).toBe(true);
    gates[1]!.resolve();
    await two;
    expect(c.getState().saving).toBe(false);
    expect(observations(x.engine)).toBe(2);
  });

  it("[M3-R1] the same submit fired twice in one event turn joins one request", async () => {
    const x = await realClient();
    const write = vi.spyOn(x.client, "act");
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const both = [c.saveObservation("d", draft(x.journalId)), c.saveObservation("d", draft(x.journalId))];
    const [a, b] = await Promise.all(both);
    expect(a).toEqual(b);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("[M3-R1] a failed refresh after an acknowledged save stays 'saved'; recovery only reads", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const page = x.client.page;
    x.client.page = () => Promise.reject(new Error("read failed"));
    const write = vi.spyOn(x.client, "act");
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "saved" });
    expect(c.getState()).toMatchObject({ notice: "saved_stale", status: "ready" });
    await c.retryRead(); // fails again: still read-only
    x.client.page = page;
    await c.retryRead();
    expect(write).toHaveBeenCalledTimes(1);
    expect(c.getState()).toMatchObject({ notice: "saved", status: "ready" });
    expect(c.getState().items).toHaveLength(1);
  });
});

describe("M3-R1 paging locks", () => {
  it("[M3-R1c] a refresh that supersedes a held older page releases its lock; Show older works again", async () => {
    const x = await realClient();
    const held = deferred<EvidencePage>();
    let reads = 0;
    x.client.page = () => (++reads === 2 ? held.promise : Promise.resolve({ items: [], nextCursor: "cursor" }));
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const more = c.loadMore();
    expect(c.getState().loadingMore).toBe(true);
    await c.retryRead();
    expect(c.getState().loadingMore).toBe(false);
    held.resolve({ items: [{ id: "late" } as never], nextCursor: null });
    await more;
    expect(c.getState()).toMatchObject({ loadingMore: false, nextCursor: "cursor" });
    expect(c.getState().items.some((i) => i.id === "late")).toBe(false);
    await c.loadMore();
    expect(reads).toBe(4);
  });

  it("[M3-R1c] a save's refresh also releases the older-page lock", async () => {
    const x = await realClient();
    const held = deferred<EvidencePage>();
    let reads = 0;
    const page = x.client.page;
    x.client.page = (input) => (++reads === 2 ? held.promise : input.cursor ? Promise.resolve({ items: [], nextCursor: null }) : page(input).then((p) => ({ ...p, nextCursor: "cursor" })));
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    void c.loadMore();
    await c.saveObservation("d", draft(x.journalId));
    expect(c.getState().loadingMore).toBe(false);
    held.resolve({ items: [], nextCursor: null });
    await tick();
    expect(c.getState().loadingMore).toBe(false);
  });
});

describe("M3-R2 uncertain saves", () => {
  it("[M3-R2a] a changed draft after an unknown outcome and an erase cannot recreate the erased save", async () => {
    const x = await realClient();
    const real = x.client.act;
    x.client.act = async (a) => {
      await real(a);
      throw new Error("lost acknowledgment");
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "unknown" });
    const id = c.draftIdentity("d")!;
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: id.observationId, confirm: "erase" });
    x.client.act = real;
    const write = vi.spyOn(x.client, "act");
    expect(await c.saveObservation("d", draft(x.journalId, "Edited unsaved wording"))).toEqual({ kind: "erased" });
    expect(c.getState().writeError?.code).toBe("ERASED");
    // Still refused until she explicitly starts a fresh observation.
    expect(await c.saveObservation("d", draft(x.journalId, "Edited unsaved wording"))).toEqual({ kind: "erased" });
    expect(write).not.toHaveBeenCalled();
    expect(observations(x.engine)).toBe(0);
    expect(c.startNewDraft("d")).toBe(true);
    expect(await c.saveObservation("d", draft(x.journalId, "Edited unsaved wording"))).toMatchObject({ kind: "saved" });
    expect(wordings(x.engine)).toEqual(["Edited unsaved wording"]);
  });

  it("[M3-R2a] the same content after an unknown outcome and an erase is refused as ERASED by the store", async () => {
    const x = await realClient();
    const real = x.client.act;
    x.client.act = async (a) => {
      await real(a);
      throw new Error("lost acknowledgment");
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    await c.saveObservation("d", draft(x.journalId));
    await x.store.act({ action: "erase_observation", operationId: uuid(), observationId: c.draftIdentity("d")!.observationId, confirm: "erase" });
    x.client.act = real;
    expect(await c.saveObservation("d", draft(x.journalId))).toEqual({ kind: "erased" });
    expect(observations(x.engine)).toBe(0);
  });

  it("[M3-R2b] empty history is not proof: a still-pending original is fenced by replay, so there is one observation", async () => {
    const x = await realClient();
    const real = x.client.act;
    let delayed: SkillEvidenceAction | undefined;
    x.client.act = async (a) => {
      delayed = a;
      throw new Error("transport stopped waiting; native work still pending");
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "unknown" });
    x.client.act = real;
    const outcome = await c.saveObservation("d", draft(x.journalId, "Different wording"));
    expect(outcome).toMatchObject({ kind: "earlier_saved", justNow: true });
    expect(c.getState().notice).toBe("earlier_saved_now");
    expect((await real(delayed!)).status).toBe("replayed");
    expect(wordings(x.engine)).toEqual(["First wording"]);
  });

  it("[M3-R2] a held pending commit: a changed submit waits for it, then reports the earlier save without a second create", async () => {
    const x = await realClient();
    const gate = deferred<void>();
    const real = x.client.act;
    const write = vi.fn(async (a: SkillEvidenceAction) => {
      await gate.promise;
      return real(a);
    });
    x.client.act = write;
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const first = c.saveObservation("d", draft(x.journalId));
    const changed = c.saveObservation("d", draft(x.journalId, "Changed while saving"));
    gate.resolve();
    expect(await first).toMatchObject({ kind: "saved" });
    expect(await changed).toMatchObject({ kind: "earlier_saved", justNow: false });
    expect(write).toHaveBeenCalledTimes(1);
    expect(wordings(x.engine)).toEqual(["First wording"]);
  });

  it("[M3-R2] a failed reconciliation keeps the draft and the original request; nothing is sent", async () => {
    const x = await realClient();
    const real = x.client.act;
    x.client.act = async (a) => {
      await real(a);
      throw new Error("lost acknowledgment");
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    await c.saveObservation("d", draft(x.journalId));
    const original = c.draftIdentity("d");
    x.client.act = real;
    const history = x.client.history;
    x.client.history = () => Promise.reject(new Error("busy"));
    const write = vi.spyOn(x.client, "act");
    expect(await c.saveObservation("d", draft(x.journalId, "Changed"))).toMatchObject({ kind: "unknown" });
    expect(write).not.toHaveBeenCalled();
    expect(c.draftIdentity("d")).toEqual(original);
    expect(c.startNewDraft("d")).toBe(false); // the earlier request must be resolved first
    x.client.history = history;
    expect(await c.saveObservation("d", draft(x.journalId, "Changed"))).toMatchObject({ kind: "earlier_saved", justNow: false });
    expect(observations(x.engine)).toBe(1);
  });

  it("[M3-R2] an earlier save is never reported as saving the new words; the explicit edit replaces them", async () => {
    const x = await realClient();
    const real = x.client.act;
    x.client.act = async (a) => {
      await real(a);
      throw new Error("lost acknowledgment");
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    await c.saveObservation("d", draft(x.journalId, "Earlier wording"));
    x.client.act = real;
    expect(await c.submitObservation("d", draft(x.journalId, "New wording"))).toBe(false);
    expect(wordings(x.engine)).toEqual(["Earlier wording"]);
    const revised = await c.reviseSaved("d", draft(x.journalId, "New wording"));
    expect(revised).toMatchObject({ kind: "saved", revision: 2 });
    expect(wordings(x.engine)).toEqual(["New wording"]);
    expect(observations(x.engine)).toBe(1);
    // Repeating the same explicit edit writes nothing more.
    expect(await c.reviseSaved("d", draft(x.journalId, "New wording"))).toMatchObject({ kind: "saved", revision: 2 });
    expect(Number(x.engine.query("SELECT COUNT(*) AS n FROM skill_observation_revisions")[0]!["n"])).toBe(2);
  });

  it("[M3-R2] an ordinary validation refusal writes nothing and lets the next submission go out under new ids", async () => {
    const x = await realClient();
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const bad = await c.saveObservation("d", { ...draft(x.journalId), observedOn: "2026-02-30" });
    expect(bad).toMatchObject({ kind: "refused", code: "INVALID_ARGUMENT" });
    expect(c.draftIdentity("d")).toBeNull();
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "saved" });
  });

  it("[M3-R2] an id clash is an intelligible refusal with an explicit way forward", async () => {
    const x = await realClient();
    const ids = [uuid(), uuid()];
    let n = 0;
    const c = createEvidenceController(x.client, { newId: () => (n < 2 ? ids[n++]! : uuid()) });
    await x.store.act({ action: "create_observation", operationId: uuid(), observationId: ids[0]!, ...draft(x.journalId, "Someone else") });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "refused", code: "OPERATION_CONFLICT" });
    expect(c.getState().writeError?.message).toMatch(/save it as a new observation/);
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "refused", code: "OPERATION_CONFLICT" });
    expect(c.startNewDraft("d")).toBe(true);
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "saved" });
  });

  it("[M3-R2] Try again with the same content replays the exact original request", async () => {
    const x = await realClient();
    const real = x.client.act;
    let lose = true;
    x.client.act = async (a) => {
      const outcome = await real(a);
      if (lose) {
        lose = false;
        throw new Error("connection lost after commit");
      }
      return outcome;
    };
    const c = createEvidenceController(x.client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "unknown" });
    const sent = vi.spyOn(x.client, "act");
    expect(await c.saveObservation("d", draft(x.journalId))).toMatchObject({ kind: "saved" });
    expect(sent.mock.calls[0]![0]).toMatchObject({ action: "create_observation", ...draft(x.journalId), ...c.draftIdentity("d")!, operationId: expect.any(String) });
    expect(observations(x.engine)).toBe(1);
  });
});
