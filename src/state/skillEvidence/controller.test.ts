/**
 * Operation and publication ownership in the candidate controller, over a
 * real candidate store (node:sqlite) with timing controlled by a wrapper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/data/testing/skillEvidenceEngines";
import { createEvidenceController, type EvidenceClient, type ObservationDraft } from "@/state/useSkillEvidence";
import { SkillEvidenceError } from "@/data/skillEvidenceTransaction";
import type { EvidencePage } from "@/domain/types";
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
    history: (id) => ctx.store.history(id),
  };
  return { ...ctx, client };
}

const draft = (journalId: string, wording = "Look further down the runway."): ObservationDraft => ({
  skillId: "builtin.normal_landing", journalId, sourceField: "none", wording, observedOn: "2026-10-01",
  attribution: "instructor_transcribed", instructorName: "",
});

describe("operation ownership", () => {
  it("a double submit joins one request: one write, one observation", async () => {
    const { client, journalId, engine } = await realClient();
    const act = vi.spyOn(client, "act");
    const c = createEvidenceController(client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const [a, b] = await Promise.all([c.submitObservation("d", draft(journalId)), c.submitObservation("d", draft(journalId))]);
    expect([a, b]).toEqual([true, true]);
    expect(act).toHaveBeenCalledTimes(1);
    expect(engine.query("SELECT COUNT(*) AS n FROM skill_observations")[0]!["n"]).toBe(1);
  });

  it("changing skill or debrief provenance cannot be acknowledged as an edit of the saved observation", async () => {
    const { client, journalId } = await realClient();
    const c = createEvidenceController(client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const original = draft(journalId);
    await c.saveObservation("d", original);
    const write = vi.spyOn(client, "act");
    for (const change of [{ skillId: "builtin.go_around" }, { journalId: "another" }, { sourceField: "instructor_feedback" as const }]) {
      expect(await c.reviseSaved("d", { ...original, ...change })).toMatchObject({ kind: "refused", code: "INVALID_ARGUMENT" });
    }
    expect(write).not.toHaveBeenCalled();
  });

  it("Try again after a lost answer resends the same ids, and the store replays instead of duplicating", async () => {
    const { client, journalId, engine } = await realClient();
    const real = client.act;
    let lose = true;
    client.act = async (a) => {
      const outcome = await real(a);
      if (lose) {
        lose = false;
        throw new Error("connection lost after commit");
      }
      return outcome;
    };
    const c = createEvidenceController(client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(await c.submitObservation("d", draft(journalId))).toBe(false);
    const first = c.draftIdentity("d");
    expect(c.getState().writeError?.code).toBe("STORAGE_FAILURE");
    const spy = vi.spyOn(client, "act");
    expect(await c.submitObservation("d", draft(journalId))).toBe(true);
    expect(spy.mock.calls[0]![0]).toMatchObject(first!);
    expect(engine.query("SELECT COUNT(*) AS n FROM skill_observations")[0]!["n"]).toBe(1);
  });

  it("edited content after an unknown outcome checks first and never duplicates a landed save", async () => {
    // Corrected (M3-R2c): the earlier save is reported as the EARLIER draft
    // saved; the different wording is not reported as saved.
    const { client, journalId, engine } = await realClient();
    const real = client.act;
    client.act = async (a) => {
      await real(a);
      throw new Error("connection lost after commit");
    };
    const c = createEvidenceController(client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    await c.submitObservation("d", draft(journalId));
    client.act = real;
    const act = vi.spyOn(client, "act");
    const outcome = await c.saveObservation("d", draft(journalId, "Different words now."));
    expect(outcome).toMatchObject({ kind: "earlier_saved", revision: 1, justNow: false });
    expect(act).not.toHaveBeenCalled();
    expect(c.getState().notice).toBe("already_saved");
    expect(engine.query("SELECT wording FROM skill_observations")).toEqual([{ wording: "Look further down the runway." }]);
  });

  it("a refusal that wrote nothing lets edited content go out under new ids", async () => {
    const { client, journalId } = await realClient();
    const c = createEvidenceController(client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    expect(await c.submitObservation("d", { ...draft(journalId), observedOn: "2026-02-30" })).toBe(false);
    expect(c.getState().writeError?.code).toBe("INVALID_ARGUMENT");
    expect(await c.submitObservation("d", draft(journalId))).toBe(true);
  });

  it("an acknowledged save whose refresh fails says saved; Refresh only reads", async () => {
    const { client, journalId, engine } = await realClient();
    const c = createEvidenceController(client, { newId: uuid });
    await c.open({ kind: "skill", skillId: "builtin.normal_landing" });
    const page = client.page;
    client.page = () => Promise.reject(new Error("read failed"));
    const act = vi.spyOn(client, "act");
    expect(await c.submitObservation("d", draft(journalId))).toBe(true);
    expect(c.getState()).toMatchObject({ notice: "saved_stale", status: "ready" });
    client.page = page;
    await c.retryRead();
    expect(act).toHaveBeenCalledTimes(1);
    expect(c.getState()).toMatchObject({ notice: "saved", status: "ready" });
    expect(c.getState().items).toHaveLength(1);
    expect(engine.query("SELECT COUNT(*) AS n FROM skill_evidence_operations")[0]!["n"]).toBe(1);
  });
});

describe("publication ownership", () => {
  it("A -> B -> A publishes only the last A answer", async () => {
    const answers: { A: ReturnType<typeof deferred<EvidencePage>>[]; B: ReturnType<typeof deferred<EvidencePage>>[] } = { A: [], B: [] };
    const client: EvidenceClient = {
      page: ({ skillId }) => {
        const d = deferred<EvidencePage>();
        answers[skillId === "builtin.go_around" ? "A" : "B"].push(d);
        return d.promise;
      },
      summary: async () => null,
      act: async () => {
        throw new Error("unused");
      },
      history: async () => ({ observationId: "", currentRevision: 0, items: [], nextCursor: null }),
    };
    const c = createEvidenceController(client, { newId: uuid });
    const item = (id: string) => ({ id }) as never;
    void c.open({ kind: "skill", skillId: "builtin.go_around" });
    void c.open({ kind: "skill", skillId: "builtin.stalls" });
    void c.open({ kind: "skill", skillId: "builtin.go_around" });
    answers.A[1]!.resolve({ items: [item("second-A")], nextCursor: null });
    await vi.waitFor(() => expect(c.getState().items).toEqual([item("second-A")]));
    answers.B[0]!.resolve({ items: [item("B")], nextCursor: null });
    answers.A[0]!.resolve({ items: [item("first-A")], nextCursor: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getState()).toMatchObject({ scope: `skill:${"builtin.go_around"}`, items: [item("second-A")] });
  });

  it("a page that arrives after the skill changed is dropped; a second Show older waits for the first", async () => {
    const pages: ReturnType<typeof deferred<EvidencePage>>[] = [];
    const client: EvidenceClient = {
      page: () => {
        const d = deferred<EvidencePage>();
        pages.push(d);
        return d.promise;
      },
      summary: async () => null,
      act: async () => {
        throw new Error("unused");
      },
      history: async () => ({ observationId: "", currentRevision: 0, items: [], nextCursor: null }),
    };
    const c = createEvidenceController(client, { newId: uuid });
    void c.open({ kind: "skill", skillId: "builtin.go_around" });
    pages[0]!.resolve({ items: [{ id: "1" } as never], nextCursor: "[\"2026-10-01\",\"t\",\"1\"]" });
    await vi.waitFor(() => expect(c.getState().nextCursor).not.toBeNull());
    void c.loadMore();
    void c.loadMore();
    expect(pages).toHaveLength(2);
    void c.open({ kind: "skill", skillId: "builtin.stalls" });
    pages[1]!.resolve({ items: [{ id: "stale" } as never], nextCursor: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getState().items.some((i) => i.id === "stale")).toBe(false);
  });

  it("nothing is published after dispose", async () => {
    const d = deferred<EvidencePage>();
    const client: EvidenceClient = {
      page: () => d.promise,
      summary: async () => null,
      act: async () => {
        throw new SkillEvidenceError("STORAGE_FAILURE", "x");
      },
      history: async () => ({ observationId: "", currentRevision: 0, items: [], nextCursor: null }),
    };
    const c = createEvidenceController(client, { newId: uuid });
    const listener = vi.fn();
    c.subscribe(listener);
    void c.open({ kind: "skill", skillId: "builtin.go_around" });
    listener.mockClear();
    c.dispose();
    d.resolve({ items: [{ id: "late" } as never], nextCursor: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(listener).not.toHaveBeenCalled();
    expect(c.getState().items).toEqual([]);
  });
});
