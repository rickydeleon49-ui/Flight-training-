import { describe, expect, it, vi } from "vitest";

import type { GeminiJobRecord } from "@/services/gemini";
import type { KitStartResult } from "./GeminiJobs";
import { KIT_QUEUE_TEXT as TEXT, type Queue } from "./kitQueueLogic";
import { KitQueueRunner, type RunnerDeps } from "./kitQueueRunner";

type Start = (materialId: string, call: number) => Promise<KitStartResult> | KitStartResult;

function record(id: string, requestId: string, stage: GeminiJobRecord["stage"] = "ready", result?: unknown): GeminiJobRecord {
  return { id, requestId, kind: "study-kit", materialId: "m", relativePath: "documents/m.pdf", contentSha256: "x", stage, createdAt: 0, updatedAt: 0, result } as unknown as GeminiJobRecord;
}

/** A fake world: a journal, a library, the provider, and the queue's own storage. */
function world(chapterIds: string[], start?: Start) {
  const w = {
    stored: null as Queue | null,
    journal: [] as GeminiJobRecord[],
    sha: Object.fromEntries(chapterIds.map((id) => [id, `sha-${id}`])) as Record<string, string | null>,
    titles: Object.fromEntries(chapterIds.map((id) => [id, `Chapter ${id}`])) as Record<string, string | null>,
    company: "Google",
    unkept: new Set<string>(),
    saved: new Set<string>(),
    calls: [] as string[],
    cancelled: [] as string[],
    start: start as Start | undefined,
    n: 0,
  };
  const deps: RunnerDeps = {
    now: () => "2026-11-07T10:00:00.000Z",
    newId: () => "q1",
    newRequestId: () => `req-${++w.n}`,
    provider: async () => w.company,
    title: (id) => w.titles[id] ?? null,
    filePath: (id) => (w.titles[id] ? `documents/${id}.pdf` : null),
    sourceSha: async (id) => w.sha[id] ?? null,
    records: async () => [...w.journal],
    startKit: async (target, options) => {
      w.calls.push(target.materialId);
      const call = w.calls.length;
      if (w.start) return w.start(target.materialId, call);
      const jobId = `job-${call}`;
      w.journal.push(record(jobId, options.requestId));
      return { outcome: "checkpointed", jobId, sent: true, requestId: options.requestId };
    },
    cancelRunning: async (requestId) => { w.cancelled.push(requestId); },
    holdsUnkeptDraft: (id) => w.unkept.has(id),
    hasSavedKit: (id) => w.saved.has(id),
    persist: async (queue) => { w.stored = JSON.parse(JSON.stringify(queue)) as Queue; },
    findOpen: async () => (w.stored && (w.stored.state === "active" || w.stored.state === "paused") ? (JSON.parse(JSON.stringify(w.stored)) as Queue) : null),
  };
  const runner = () => new KitQueueRunner(deps, () => {});
  const chapters = chapterIds.map((id) => ({ materialId: id, sourceSha256: `sha-${id}` }));
  const consent = { provider: "Google", materialIds: chapterIds };
  return { w, deps, runner, chapters, consent };
}
const statuses = (q: Queue | null) => q?.items.map((i) => i.status);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

describe("kit queue runner", () => {
  it("makes each chapter once, in order, and records the request before the call", async () => {
    const { w, runner, chapters, consent } = world(ids(3), async (_id, call) => {
      // The queue wrote "running" and the request id down before this paid call.
      const item = w.stored!.items[call - 1]!;
      expect(item.status).toBe("running");
      expect(item.requestId).toBe(`req-${call}`);
      w.journal.push(record(`job-${call}`, item.requestId!));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: item.requestId! };
    });
    const r = runner();
    expect(await r.begin(chapters, consent)).toEqual({ ok: true });
    expect(w.calls).toEqual(["c1", "c2", "c3"]);
    expect(r.queue?.state).toBe("done");
    expect(statuses(r.queue)).toEqual(["checkpointed", "checkpointed", "checkpointed"]);
  });

  it("1. pauses at 8 unsaved drafts with no 9th call, and resumes when one is saved", async () => {
    const { w, runner, chapters, consent } = world(ids(9));
    const r = runner();
    await r.begin(chapters, consent);
    expect(w.calls).toHaveLength(8);
    expect(r.queue?.state).toBe("paused");
    expect(r.queue?.pauseReason).toBe("slots");
    expect(r.message).toBe(TEXT.slotsFull);
    expect(r.queue?.items[8]?.status).toBe("waiting");
    // Still full: nothing happens.
    await r.poke();
    expect(w.calls).toHaveLength(8);
    // Saving one frees a slot; the queue goes on by itself.
    w.journal.shift();
    await r.poke();
    expect(w.calls).toHaveLength(9);
    expect(r.queue?.state).toBe("done");
    expect(w.journal).toHaveLength(8);
  });

  it("2. after a restart the journal job is found and nothing is paid for again", async () => {
    // The call finished and the journal has it, but the queue never moved past "running".
    const { w, runner, chapters, consent } = world(ids(2), async (_id, call) => {
      w.journal.push(record("job-1", `req-${call}`));
      throw new Error("quit before the queue could move on");
    });
    const first = runner();
    await first.begin(chapters, consent).catch(() => {});
    expect(w.stored?.items[0]?.status).toBe("running");
    w.start = undefined;
    const again = runner();
    await again.restore();
    expect(again.queue?.state).toBe("paused");
    expect(again.queue?.items[0]?.status).toBe("checkpointed");
    expect(again.queue?.items[0]?.jobId).toBe("job-1");
    expect(again.message).toBe(TEXT.restart);
    const callsBefore = w.calls.length;
    expect(w.calls).toHaveLength(callsBefore);
    await again.resume();
    // Only the second chapter is made.
    expect(w.calls.slice(callsBefore)).toEqual(["c2"]);
  });

  it("3. a paid result that was not checkpointed pauses the queue and is never discarded", async () => {
    const { w, runner, chapters, consent } = world(ids(3), async (id) => {
      w.unkept.add(id);
      return { outcome: "memory-only", sent: true, requestId: "r" };
    });
    const r = runner();
    await r.begin(chapters, consent);
    expect(w.calls).toEqual(["c1"]);
    expect(r.queue?.state).toBe("paused");
    expect(r.queue?.pauseReason).toBe("not-kept");
    expect(r.message).toBe(TEXT.notKept("Chapter c1"));
    // Continue is refused while the draft is only in the window.
    expect(await r.resume()).toBe(false);
    expect(w.calls).toEqual(["c1"]);
    // After a restart the journal shows nothing: unclear, never paid for again by itself.
    const after = runner();
    await after.restore();
    expect(after.queue?.items[0]?.status).toBe("unclear");
    expect(after.queue?.state).toBe("paused");
    expect(w.calls).toEqual(["c1"]);
  });

  it("3b. saving the window's draft settles the item and the queue goes on", async () => {
    let first = true;
    const { w, runner, chapters, consent } = world(ids(2), async (id, call) => {
      if (first) { first = false; w.unkept.add(id); return { outcome: "memory-only", sent: true, requestId: "r" }; }
      w.journal.push(record(`job-${call}`, `req-${call}`));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
    });
    const r = runner();
    await r.begin(chapters, consent);
    w.unkept.delete("c1");
    w.saved.add("c1");
    await r.poke();
    expect(r.queue?.items[0]?.status).toBe("saved");
    expect(w.calls).toEqual(["c1", "c2"]);
  });

  it("4. a kit whose acknowledge has not landed is not advanced past, and is never made twice", async () => {
    // The journal still holds the kit (save done, acknowledge pending): it stays "checkpointed".
    const { w, runner, chapters, consent } = world(ids(1));
    const r = runner();
    await r.begin(chapters, consent);
    expect(r.queue?.items[0]?.status).toBe("checkpointed");
    await r.poke();
    expect(r.queue?.items[0]?.status).toBe("checkpointed");
    // Once the journal lets it go, it counts as saved.
    w.journal.length = 0;
    const paused: Queue = { ...r.queue!, state: "paused", pauseReason: "restart" };
    const restored = world(ids(1));
    restored.w.stored = paused;
    const again = restored.runner();
    await again.restore();
    expect(again.queue?.items[0]?.status).toBe("saved");
    expect(w.calls).toHaveLength(1);
    expect(restored.w.calls).toHaveLength(0);
  });

  it("5. a partial kit is kept, listed, and not made again by itself", async () => {
    const { w, runner, chapters, consent } = world(ids(2), async (id, call) => {
      w.journal.push(record(`job-${call}`, `req-${call}`));
      return { outcome: "checkpointed", jobId: `job-${call}`, partial: id === "c1", sent: true, requestId: `req-${call}` };
    });
    const r = runner();
    await r.begin(chapters, consent);
    expect(statuses(r.queue)).toEqual(["partial", "checkpointed"]);
    expect(w.calls).toEqual(["c1", "c2"]);
    expect(r.queue?.state).toBe("done");
    // Only a manual button makes it again (after the earlier kit was saved or dismissed).
    w.journal.length = 0;
    expect(await r.retry(0)).toBe(true);
    expect(w.calls).toEqual(["c1", "c2", "c1"]);
  });

  it("6. a double start makes one provider call only", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { w, runner, chapters, consent } = world(ids(1), async (_id, call) => {
      await gate;
      w.journal.push(record(`job-${call}`, `req-${call}`));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
    });
    const r = runner();
    const first = r.begin(chapters, consent);
    const second = await r.begin(chapters, consent);
    expect(second).toEqual({ ok: false, reason: "already" });
    // A second window finds the open queue in storage.
    await vi.waitFor(() => expect(w.calls).toHaveLength(1));
    const other = runner();
    expect(await other.begin(chapters, consent)).toEqual({ ok: false, reason: "already" });
    release();
    await first;
    expect(w.calls).toHaveLength(1);
  });

  it("7. Stop racing a finish keeps the draft, ends Stopped, and makes no next call", async () => {
    let r!: KitQueueRunner;
    const { w, runner, chapters, consent } = world(ids(3), async (_id, call) => {
      await r.stop();
      w.journal.push(record(`job-${call}`, `req-${call}`));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
    });
    r = runner();
    await r.begin(chapters, consent);
    expect(w.calls).toEqual(["c1"]);
    expect(r.queue?.state).toBe("stopped");
    expect(r.queue?.items[0]?.status).toBe("checkpointed");
    expect(w.cancelled).toEqual(["req-1"]);
    expect(w.journal).toHaveLength(1);
    expect(r.queue?.items[1]?.status).toBe("waiting");
  });

  it("8. a deleted chapter and a changed chapter are skipped without a paid call", async () => {
    const { w, runner, chapters, consent } = world(ids(4));
    w.titles.c2 = null;
    w.sha.c3 = "different";
    const r = runner();
    await r.begin(chapters, consent);
    expect(w.calls).toEqual(["c1", "c4"]);
    expect(statuses(r.queue)).toEqual(["checkpointed", "skipped", "skipped", "checkpointed"]);
  });

  it("9. a provider changed after consent clears the consent and sends nothing", async () => {
    const { w, runner, chapters, consent } = world(ids(2));
    w.company = "Anthropic";
    const r = runner();
    expect(await r.begin(chapters, consent)).toEqual({ ok: false, reason: "consent" });
    expect(w.calls).toHaveLength(0);
    // And after the queue began: the provider changes between two chapters.
    const second = world(ids(2), async (_id, call) => {
      second.w.company = "Anthropic";
      second.w.journal.push(record(`job-${call}`, `req-${call}`));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
    });
    const r2 = second.runner();
    await r2.begin(second.chapters, second.consent);
    expect(second.w.calls).toEqual(["c1"]);
    expect(r2.queue?.state).toBe("paused");
    expect(r2.queue?.consentAt).toBeNull();
    expect(r2.message).toBe(TEXT.consentStale);
    expect(await r2.resume()).toBe(false);
    // A new yes for the new provider goes on.
    expect(await r2.confirmAgain({ provider: "Anthropic", materialIds: ["c2"] })).toBe(true);
    expect(second.w.calls).toEqual(["c1", "c2"]);
  });

  it("9b. a different chapter set than the one agreed to sends nothing", async () => {
    const { w, runner, chapters } = world(ids(3));
    const r = runner();
    expect(await r.begin(chapters, { provider: "Google", materialIds: ["c1", "c2"] })).toEqual({ ok: false, reason: "consent" });
    expect(w.calls).toHaveLength(0);
  });

  it("10. a rate limit pauses with no automatic retry; Continue makes one call", async () => {
    let limited = true;
    const { w, runner, chapters, consent } = world(ids(2), async (_id, call) => {
      if (limited) return { outcome: "failed", message: "Gemini's rate or spending limit was reached for this project.", sent: true, requestId: "r" };
      w.journal.push(record(`job-${call}`, `req-${call}`));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
    });
    const r = runner();
    await r.begin(chapters, consent);
    expect(w.calls).toEqual(["c1"]);
    expect(r.queue?.pauseReason).toBe("rate-limit");
    expect(r.queue?.items[0]?.status).toBe("waiting");
    await r.poke();
    expect(w.calls).toEqual(["c1"]);
    limited = false;
    await r.resume();
    expect(w.calls).toEqual(["c1", "c1", "c2"]);
    expect(r.queue?.state).toBe("done");
  });

  it("11. an unclear finish marks the chapter unclear and never retries by itself", async () => {
    const { w, runner, chapters, consent } = world(ids(2), async () => ({ outcome: "failed", message: "The connection dropped.", sent: true, requestId: "r" }));
    const r = runner();
    await r.begin(chapters, consent);
    expect(statuses(r.queue)).toEqual(["unclear", "waiting"]);
    expect(r.queue?.pauseReason).toBe("unclear");
    await r.poke();
    expect(w.calls).toEqual(["c1"]);
    // Manual retry, and only after the journal shows nothing.
    w.start = undefined;
    expect(await r.retry(0)).toBe(true);
    expect(w.calls).toEqual(["c1", "c1", "c2"]);
  });

  it("11b. an app quit mid-call leaves the chapter unclear after the restart", async () => {
    const { w, runner, chapters, consent } = world(ids(2), async () => { throw new Error("quit"); });
    await runner().begin(chapters, consent).catch(() => {});
    const again = runner();
    await again.restore();
    expect(statuses(again.queue)).toEqual(["unclear", "waiting"]);
    expect(again.queue?.state).toBe("paused");
    expect(w.calls).toEqual(["c1"]);
  });

  it("11c. a manual retry does nothing when the journal shows the kit after all", async () => {
    const { w, runner, chapters, consent } = world(ids(1), async (_id, call) => {
      w.journal.push(record("job-late", `req-${call}`));
      return { outcome: "failed", message: "lost the reply", sent: true, requestId: `req-${call}` };
    });
    const r = runner();
    await r.begin(chapters, consent);
    expect(r.queue?.items[0]?.status).toBe("unclear");
    expect(await r.retry(0)).toBe(false);
    expect(w.calls).toHaveLength(1);
  });

  it("a refused start (another aid is running) puts the chapter back and pauses", async () => {
    const { w, runner, chapters, consent } = world(ids(2), async () => ({ outcome: "refused", message: TEXT.busy, sent: false, requestId: "r" }));
    const r = runner();
    await r.begin(chapters, consent);
    expect(statuses(r.queue)).toEqual(["waiting", "waiting"]);
    expect(r.queue?.pauseReason).toBe("busy");
    expect(w.calls).toHaveLength(1);
  });

  it("stores no keys, answers or page text", async () => {
    const { w, runner, chapters, consent } = world(ids(2));
    await runner().begin(chapters, consent);
    const text = JSON.stringify(w.stored);
    expect(Object.keys(w.stored!.items[0]!).sort()).toEqual(["jobId", "materialId", "position", "requestId", "sourceSha256", "status", "updatedAt"]);
    expect(text).not.toMatch(/answer|apiKey|secret|credential/i);
  });
});
