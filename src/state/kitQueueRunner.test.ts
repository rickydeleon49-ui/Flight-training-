import { describe, expect, it, vi } from "vitest";

import type { GeminiJobRecord } from "@/services/gemini";
import type { KitStartResult } from "./GeminiJobs";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";
import { KIT_QUEUE_TEXT as TEXT, summarize, type Queue } from "./kitQueueLogic";
import { KitQueueRunner, type RunnerDeps, type StartKitOptions } from "./kitQueueRunner";

type Start = (materialId: string, call: number, options: StartKitOptions) => Promise<KitStartResult> | KitStartResult;

const NOW = "2026-11-07T10:00:00.000Z";
/** Native journal times are whole seconds. */
const T = Date.parse(NOW) / 1000;
type Parts = Partial<Record<"guide" | "cards" | "questions", boolean>>;

/**
 * A finished kit exactly as the native listing shows it (study_kit.rs review_records):
 * one virtual record per part, "<job>#<part>" ids, request ids rewritten to
 * "study-kit:<job>", and no `parts` field. A part already saved is simply absent.
 */
function kit(jobId: string, materialId: string, parts: Parts = { guide: true, cards: true, questions: true }, createdAt = T): GeminiJobRecord[] {
  return Object.entries(parts).map(([part, ok]) => ({
    id: `${jobId}#${part}`, requestId: `${part === "cards" ? "flashcards:" : ""}study-kit:${jobId}`,
    kind: part === "questions" ? "practice-test" : "study-aid", materialId, relativePath: `documents/${materialId}.pdf`,
    contentSha256: `sha-${materialId}`, stage: ok ? "ready" : "failed", createdAt, updatedAt: createdAt,
    result: ok ? { title: "t" } : undefined, draft: { kind: "study-kit-part" }, error: ok ? undefined : "That part did not come back.",
  }) as unknown as GeminiJobRecord);
}
const open = (q: Queue | null) => Boolean(q && (q.state === "active" || q.state === "paused"));
const clone = (q: Queue) => JSON.parse(JSON.stringify(q)) as Queue;

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
    /** Every startKit call the window made. */
    calls: [] as string[],
    /** Calls the native side let through to the provider (its expected check passed). */
    paid: [] as string[],
    expected: [] as StartKitOptions["expected"][],
    cancelled: [] as string[],
    start: start as Start | undefined,
    /** Runs inside startKit, before the native check: a change landing in the last gap. */
    beforeSend: null as (() => void) | null,
    /** Hooks that hold a wait open so the test can act in the middle of it. */
    recordsWait: null as (() => Promise<void>) | null,
    providerWait: null as (() => Promise<void>) | null,
    shaWait: null as ((id: string) => Promise<void>) | null,
    n: 0,
  };
  const deps: RunnerDeps = {
    now: () => NOW,
    newId: () => "q1",
    newRequestId: () => `req-${++w.n}`,
    provider: async () => { if (w.providerWait) await w.providerWait(); return w.company; },
    title: (id) => w.titles[id] ?? null,
    filePath: (id) => (w.titles[id] ? `documents/${id}.pdf` : null),
    sourceSha: async (id) => { if (w.shaWait) await w.shaWait(id); return w.sha[id] ?? null; },
    records: async () => { if (w.recordsWait) await w.recordsWait(); return [...w.journal]; },
    startKit: async (target, options) => {
      w.calls.push(target.materialId);
      w.expected.push(options.expected);
      w.beforeSend?.();
      // The native side (study_kit.rs check_expected) refuses before any job begins.
      if (options.expected.provider !== w.company) return { outcome: "refused", message: TEXT.consentStale, sent: false, stale: "provider", shown: true, requestId: options.requestId };
      if (options.expected.sha256 !== w.sha[target.materialId]) return { outcome: "refused", message: TEXT.skipped, sent: false, stale: "source", shown: true, requestId: options.requestId };
      w.paid.push(target.materialId);
      const call = w.calls.length;
      if (w.start) return w.start(target.materialId, call, options);
      const jobId = `job-${call}`;
      options.onJobId?.(jobId);
      w.journal.push(...kit(jobId, target.materialId));
      return { outcome: "checkpointed", jobId, sent: true, requestId: options.requestId };
    },
    cancelRunning: async (requestId) => { w.cancelled.push(requestId); },
    holdsUnkeptDraft: (id) => w.unkept.has(id),
    hasSavedKit: (id) => w.saved.has(id),
    persist: async (queue) => { w.stored = clone(queue); },
    // The repository's single INSERT ... WHERE NOT EXISTS, guarded by a unique index.
    claim: async (queue) => { await Promise.resolve(); if (open(w.stored)) return false; w.stored = clone(queue); return true; },
    // The repository's single UPDATE: only a done or paused queue, never a stopped one.
    reopen: async (queue) => {
      await Promise.resolve();
      if (w.stored?.id !== queue.id || (w.stored.state !== "done" && w.stored.state !== "paused")) return false;
      w.stored = clone(queue);
      return true;
    },
    findOpen: async () => (open(w.stored) ? clone(w.stored!) : null),
    stored: async (id) => (w.stored?.id === id ? clone(w.stored) : null),
  };
  const runner = () => new KitQueueRunner(deps, () => {});
  const chapters = chapterIds.map((id) => ({ materialId: id, sourceSha256: `sha-${id}` }));
  const consent = { provider: "Google", materialIds: chapterIds };
  return { w, deps, runner, chapters, consent };
}
/** A wait the test opens and closes by hand. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return { wait: () => opened, release };
}
const slotCount = (records: GeminiJobRecord[]) => new Set(records.map((r) => r.id.split("#")[0])).size;
const statuses = (q: Queue | null) => q?.items.map((i) => i.status);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

describe("kit queue runner", () => {
  it("makes each chapter once, in order, and records the request before the call", async () => {
    const { w, runner, chapters, consent } = world(ids(3), async (_id, call) => {
      // The queue wrote "running" and the request id down before this paid call.
      const item = w.stored!.items[call - 1]!;
      expect(item.status).toBe("running");
      expect(item.requestId).toBe(`req-${call}`);
      w.journal.push(...kit(`job-${call}`, `c${call}`));
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
    // Each kit is listed as three review parts but holds one slot.
    expect(w.journal).toHaveLength(24);
    expect(slotCount(w.journal)).toBe(8);
    // Saving one part does not free its slot; saving the whole kit does, and the queue goes on by itself.
    w.journal.shift();
    await r.poke();
    expect(w.calls).toHaveLength(8);
    w.journal = w.journal.filter((rec) => !rec.id.startsWith("job-1#"));
    await r.poke();
    expect(w.calls).toHaveLength(9);
    expect(r.queue?.state).toBe("done");
    expect(slotCount(w.journal)).toBe(8);
  });

  it("2. after a restart the journal job is found and nothing is paid for again", async () => {
    // The call finished and the journal has it, but the queue never moved past "running".
    const { w, runner, chapters, consent } = world(ids(2), async (id) => {
      w.journal.push(...kit("job-1", id));
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
      w.journal.push(...kit(`job-${call}`, id));
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
      w.journal.push(...kit(`job-${call}`, id));
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
    const { w, runner, chapters, consent } = world(ids(1), async (id, call) => {
      await gate;
      w.journal.push(...kit(`job-${call}`, id));
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
    const { w, runner, chapters, consent } = world(ids(3), async (id, call) => {
      await r.stop();
      w.journal.push(...kit(`job-${call}`, id));
      return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
    });
    r = runner();
    await r.begin(chapters, consent);
    expect(w.calls).toEqual(["c1"]);
    expect(r.queue?.state).toBe("stopped");
    expect(r.queue?.items[0]?.status).toBe("checkpointed");
    expect(w.cancelled).toEqual(["req-1"]);
    expect(slotCount(w.journal)).toBe(1);
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
    const second = world(ids(2), async (id, call) => {
      second.w.company = "Anthropic";
      second.w.journal.push(...kit(`job-${call}`, id));
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
    const { w, runner, chapters, consent } = world(ids(2), async (id, call) => {
      if (limited) return { outcome: "failed", message: "Gemini's rate or spending limit was reached for this project.", sent: true, requestId: "r" };
      w.journal.push(...kit(`job-${call}`, id));
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
    const { w, runner, chapters, consent } = world(ids(1), async (id, call) => {
      w.journal.push(...kit("job-late", id));
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

  describe("audit fixes", () => {
    /** A queue paused by a rate limit on c1, ready for Continue. */
    async function pausedByLimit(n = 2) {
      let limited = true;
      const env = world(ids(n), async (id, call) => {
        if (limited) return { outcome: "failed", message: "Gemini's rate or spending limit was reached for this project.", sent: true, requestId: "r" };
        env.w.journal.push(...kit(`job-${call}`, id));
        return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: `req-${call}` };
      });
      const r = env.runner();
      await r.begin(env.chapters, env.consent);
      expect(r.queue?.pauseReason).toBe("rate-limit");
      limited = false;
      return { ...env, r };
    }

    it("Stop during Continue's journal check wins: nothing is sent", async () => {
      const { w, r } = await pausedByLimit();
      const g = gate();
      w.recordsWait = g.wait;
      const resumed = r.resume();
      await r.stop();
      w.recordsWait = null;
      g.release();
      expect(await resumed).toBe(false);
      expect(r.queue?.state).toBe("stopped");
      expect(w.stored?.state).toBe("stopped");
      expect(w.calls).toEqual(["c1"]);
    });

    it("Stop during a fresh consent's provider check wins: nothing is sent", async () => {
      const { w, r } = await pausedByLimit();
      const g = gate();
      w.providerWait = g.wait;
      const agreed = r.confirmAgain({ provider: "Google", materialIds: ["c1", "c2"] });
      await r.stop();
      w.providerWait = null;
      g.release();
      expect(await agreed).toBe(false);
      expect(r.queue?.state).toBe("stopped");
      expect(w.calls).toEqual(["c1"]);
    });

    it("Stop during Make again's journal look wins: nothing is sent", async () => {
      const { w, runner, chapters, consent } = world(ids(2), async () => ({ outcome: "failed", message: "The connection dropped.", sent: true, requestId: "r" }));
      const r = runner();
      await r.begin(chapters, consent);
      expect(r.queue?.items[0]?.status).toBe("unclear");
      w.start = undefined;
      const g = gate();
      w.recordsWait = g.wait;
      const retried = r.retry(0);
      await r.stop();
      w.recordsWait = null;
      g.release();
      expect(await retried).toBe(false);
      expect(r.queue?.state).toBe("stopped");
      expect(w.calls).toEqual(["c1"]);
    });

    it("Stop during the last checks before a call puts the chapter back and sends nothing", async () => {
      let r!: KitQueueRunner;
      const { w, runner, chapters, consent } = world(ids(2));
      w.shaWait = async () => { if (w.stored?.items[0]?.status === "running") await r.stop(); };
      r = runner();
      await r.begin(chapters, consent);
      expect(w.calls).toEqual([]);
      expect(r.queue?.state).toBe("stopped");
      expect(r.queue?.items[0]?.status).toBe("waiting");
    });

    it("a provider changed during the checksum look sends nothing and asks again", async () => {
      const { w, runner, chapters, consent } = world(ids(2));
      w.shaWait = async () => { w.company = "Anthropic"; };
      const r = runner();
      await r.begin(chapters, consent);
      expect(w.calls).toEqual([]);
      expect(r.queue?.state).toBe("paused");
      expect(r.queue?.pauseReason).toBe("consent");
      expect(r.queue?.consentAt).toBeNull();
      expect(r.queue?.items[0]?.status).toBe("waiting");
    });

    it("every call carries the agreed provider and checksum, and the native refusal sends nothing", async () => {
      const { w, runner, chapters, consent } = world(ids(3));
      // The change lands after the window's last check, in the gap before the native side.
      w.beforeSend = () => { if (w.calls.length === 2) w.company = "Anthropic"; };
      const r = runner();
      await r.begin(chapters, consent);
      expect(w.expected[0]).toEqual({ provider: "Google", sha256: "sha-c1" });
      expect(w.paid).toEqual(["c1"]);
      expect(r.queue?.pauseReason).toBe("consent");
      expect(r.queue?.consentAt).toBeNull();
      expect(r.queue?.items[1]).toMatchObject({ status: "waiting" });
      // A chapter file changed in that same gap is skipped by the native refusal.
      const second = world(ids(2));
      second.w.beforeSend = () => { if (second.w.calls.length === 1) second.w.sha.c1 = "edited"; };
      const r2 = second.runner();
      await r2.begin(second.chapters, second.consent);
      expect(second.w.paid).toEqual(["c2"]);
      expect(r2.queue?.items.map((i) => i.status)).toEqual(["skipped", "checkpointed"]);
    });

    it("Make again is held back while a paid kit is only in this window", async () => {
      const { w, runner, chapters, consent } = world(ids(2), async (id) => {
        if (id === "c1") return { outcome: "failed", message: "The connection dropped.", sent: true, requestId: "r" };
        w.unkept.add(id);
        return { outcome: "memory-only", sent: true, requestId: "r" };
      });
      const r = runner();
      await r.begin(chapters, consent);
      expect(r.queue?.items[0]?.status).toBe("unclear");
      expect(await r.resume()).toBe(true);
      expect(r.queue?.pauseReason).toBe("not-kept");
      expect(w.paid).toEqual(["c1", "c2"]);
      w.start = undefined;
      expect(await r.retry(0)).toBe(false);
      expect(w.paid).toEqual(["c1", "c2"]);
    });

    it("a restart finds a kit whose request id the native listing rewrote and whose job id was never written", async () => {
      const { w, runner, chapters, consent } = world(ids(2), async (id) => {
        w.journal.push(...kit("job-a", id, { guide: true, cards: false, questions: true }));
        throw new Error("quit before the job id came back");
      });
      await runner().begin(chapters, consent).catch(() => {});
      expect(w.stored?.items[0]).toMatchObject({ status: "running", jobId: null });
      w.start = undefined;
      const again = runner();
      await again.restore();
      // Partly done, read from the review parts themselves (no result.parts there).
      expect(again.queue?.items[0]).toMatchObject({ status: "partial", jobId: "job-a" });
      expect(w.paid).toEqual(["c1"]);
    });

    it("a restart writes the job id down as soon as it is known, and matches on it", async () => {
      const { w, runner, chapters, consent } = world(ids(1), async (id, _call, options) => {
        options.onJobId?.("job-b");
        await Promise.resolve();
        w.journal.push(...kit("job-b", id, { guide: true }, T - 3600));
        throw new Error("quit");
      });
      await runner().begin(chapters, consent).catch(() => {});
      expect(w.stored?.items[0]).toMatchObject({ status: "running", jobId: "job-b" });
      const again = runner();
      await again.restore();
      expect(again.queue?.items[0]?.status).toBe("checkpointed");
    });

    it("a restart never takes an older kit of the same chapter for this one", async () => {
      const { w, runner, chapters, consent } = world(ids(1), async (id) => {
        w.journal.push(...kit("job-old", id, { guide: true }, T - 3600));
        throw new Error("quit");
      });
      await runner().begin(chapters, consent).catch(() => {});
      const again = runner();
      await again.restore();
      expect(again.queue?.items[0]?.status).toBe("unclear");
    });

    it("a restart reads a kit with no good part left as failed", async () => {
      const { w, runner, chapters, consent } = world(ids(1), async (id) => {
        w.journal.push(...kit("job-c", id, { guide: false, cards: false, questions: false }));
        throw new Error("quit");
      });
      await runner().begin(chapters, consent).catch(() => {});
      const again = runner();
      await again.restore();
      expect(again.queue?.items[0]?.status).toBe("failed");
    });

    it("three whole kits hold three slots, not nine: chapter four is made", async () => {
      const { w, runner, chapters, consent } = world(ids(4));
      const r = runner();
      await r.begin(chapters, consent);
      expect(w.paid).toEqual(["c1", "c2", "c3", "c4"]);
      expect(r.queue?.state).toBe("done");
    });

    it("two runners starting at once claim one queue and make one call per chapter", async () => {
      const { w, runner, chapters, consent } = world(ids(2));
      const [a, b] = await Promise.all([runner().begin(chapters, consent), runner().begin(chapters, consent)]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok)).toEqual([{ ok: false, reason: "already" }]);
      expect(w.paid).toEqual(["c1", "c2"]);
    });

    it("a second window's runner is refused by the stored claim", async () => {
      const { w, deps, chapters, consent } = world(ids(1));
      w.stored = { id: "other", provider: "Google", createdAt: NOW, state: "paused", consentAt: NOW, items: [] };
      expect(await new KitQueueRunner(deps, () => {}).begin(chapters, consent)).toEqual({ ok: false, reason: "already" });
      expect(w.calls).toHaveLength(0);
    });
  });
  describe("re-check fixes", () => {
    /** Two runners on one real in-memory SQLite queue store, with a shared fake journal and provider. */
    async function sqliteWorld(chapterIds: string[]) {
      const db = await createNodeSqliteDatabase();
      const repo = createRepositories(db).kitQueue;
      const env = world(chapterIds);
      const deps: RunnerDeps = {
        ...env.deps,
        persist: (q) => repo.save(q),
        claim: (q) => repo.claim(q),
        reopen: (q) => repo.reopen(q),
        findOpen: () => repo.findOpen(),
        stored: (id) => repo.get(id),
      };
      return { ...env, db, repo, deps, runner: () => new KitQueueRunner(deps, () => {}) };
    }
    /** Leave a paused queue in the store (a rate limit on the first chapter), as after a quit. */
    async function pausedInStore(env: Awaited<ReturnType<typeof sqliteWorld>>) {
      env.w.start = async () => ({ outcome: "failed", message: "Gemini's rate or spending limit was reached for this project.", sent: true, requestId: "r" });
      const first = env.runner();
      await first.begin(env.chapters, env.consent);
      expect((await env.repo.findOpen())?.state).toBe("paused");
      env.w.start = undefined;
      env.w.calls.length = 0;
      env.w.paid.length = 0;
    }

    it("two runners that restored the same queue never pay twice, even after the kits are kept", async () => {
      const env = await sqliteWorld(ids(2));
      try {
        await pausedInStore(env);
        const a = env.runner();
        const b = env.runner();
        await a.restore();
        await b.restore();
        expect(a.queue?.state).toBe("paused");
        expect(b.queue?.state).toBe("paused");
        // At once: only one of them works on the queue.
        await Promise.all([a.resume(), b.resume()]);
        expect(env.w.paid).toEqual(["c1", "c2"]);
        // The kits are saved and acknowledged: they leave the journal.
        env.w.journal.length = 0;
        ["c1", "c2"].forEach((id) => env.w.saved.add(id));
        // The other runner's older copy still shows chapters waiting: it must not pay again.
        expect(await a.resume()).toBe(false);
        expect(await b.resume()).toBe(false);
        await a.retry(0);
        await b.retry(0);
        expect(env.w.paid).toEqual(["c1", "c2"]);
        expect((await env.repo.latest())?.state).toBe("done");
      } finally { env.db.close(); }
    });

    it("a second runner's older copy cannot undo Stop", async () => {
      const env = await sqliteWorld(ids(2));
      try {
        await pausedInStore(env);
        const a = env.runner();
        const b = env.runner();
        await a.restore();
        // b reads the queue, then a stops it while b is still checking the journal.
        const g = gate();
        env.w.recordsWait = g.wait;
        const restoring = b.restore();
        await Promise.resolve();
        env.w.recordsWait = null;
        await a.stop();
        g.release();
        await restoring;
        expect((await env.repo.latest())?.state).toBe("stopped");
        expect(await b.resume()).toBe(false);
        expect(b.queue?.state).toBe("stopped");
        expect(env.w.calls).toEqual([]);
        // Even a raw write of b's old paused copy leaves it stopped.
        await env.repo.save({ ...(await env.repo.latest())!, state: "paused" });
        expect((await env.repo.latest())?.state).toBe("stopped");
      } finally { env.db.close(); }
    });

    it("a stale copy cannot move a chapter another runner is making, and nothing is sent for it", async () => {
      const env = await sqliteWorld(ids(1));
      try {
        await pausedInStore(env);
        const stale = (await env.repo.findOpen())!;
        // Another window has the chapter running under its own request.
        await env.repo.save({ ...stale, state: "active", items: stale.items.map((i) => ({ ...i, status: "running", requestId: "req-other" })) });
        await env.repo.save(stale);
        expect((await env.repo.get(stale.id))?.items[0]).toMatchObject({ status: "running", requestId: "req-other" });
        // A runner holding the old copy works from the stored queue: nothing is waiting, nothing is sent.
        const r = new KitQueueRunner(env.deps, () => {}, stale);
        await r.resume();
        expect(env.w.calls).toEqual([]);
        expect((await env.repo.get(stale.id))?.items[0]).toMatchObject({ status: "running", requestId: "req-other" });
      } finally { env.db.close(); }
    });

    it("a kit kept only in the window settles once saved, even after its job id was written down", async () => {
      const { w, runner, chapters, consent } = world(ids(2), async (id, call, options) => {
        if (call === 1) {
          options.onJobId?.("job-m");
          await Promise.resolve();
          w.unkept.add(id);
          return { outcome: "memory-only", sent: true, requestId: options.requestId };
        }
        w.journal.push(...kit(`job-${call}`, id));
        return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: options.requestId };
      });
      const r = runner();
      await r.begin(chapters, consent);
      expect(w.stored?.items[0]).toMatchObject({ status: "running", jobId: "job-m" });
      expect(r.queue?.pauseReason).toBe("not-kept");
      w.unkept.delete("c1");
      w.saved.add("c1");
      await r.poke();
      expect(statuses(r.queue)).toEqual(["saved", "checkpointed"]);
      expect(r.queue?.state).toBe("done");
      expect(summarize(r.queue!).made.map((i) => i.materialId)).toEqual(["c1", "c2"]);
      expect(w.paid).toEqual(["c1", "c2"]);
    });

    describe("Make again on a done queue", () => {
      /** A queue left in the store as given, written straight to the tables. */
      async function seed(env: Awaited<ReturnType<typeof sqliteWorld>>, id: string, state: Queue["state"], statuses: string[], createdAt = NOW) {
        await env.db.execute("INSERT INTO kit_queue (id, provider, created_at, state, consent_at) VALUES (?, 'Google', ?, ?, ?)", [id, createdAt, state, createdAt]);
        for (const [position, status] of statuses.entries()) {
          await env.db.execute(`INSERT INTO kit_queue_item (queue_id, position, material_id, source_sha256, status, request_id, job_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`, [id, position, `c${position + 1}`, `sha-c${position + 1}`, status, status === "waiting" ? null : "req-old", createdAt]);
        }
        return (await env.repo.get(id))!;
      }
      const partialKit = (env: Awaited<ReturnType<typeof sqliteWorld>>) => async (id: string, call: number, options: StartKitOptions): Promise<KitStartResult> => {
        options.onJobId?.(`job-${call}`);
        env.w.journal.push(...kit(`job-${call}`, id, { guide: true, cards: false }));
        return { outcome: "checkpointed", jobId: `job-${call}`, partial: true, sent: true, requestId: options.requestId };
      };

      for (const status of ["partial", "failed", "unclear"]) {
        it(`reopens a done queue for a ${status} chapter, stores it active, and sends the kit once`, async () => {
          const env = await sqliteWorld(ids(1));
          try {
            const done = await seed(env, "q1", "done", [status]);
            const seen: { state?: string; item?: string; open?: string | null } = {};
            env.w.start = async (id, call, options) => {
              const now = await env.repo.get("q1");
              seen.state = now?.state;
              seen.item = now?.items[0]?.status;
              seen.open = (await env.repo.findOpen())?.id ?? null;
              env.w.journal.push(...kit(`job-${call}`, id));
              return { outcome: "checkpointed", jobId: `job-${call}`, sent: true, requestId: options.requestId };
            };
            const r = new KitQueueRunner(env.deps, () => {}, done);
            expect(await r.retry(0)).toBe(true);
            expect(seen).toEqual({ state: "active", item: "running", open: "q1" });
            expect(env.w.paid).toEqual(["c1"]);
            const stored = (await env.repo.get("q1"))!;
            expect(stored.state).toBe("done");
            expect(stored.items[0]?.status).toBe("checkpointed");
            expect(r.queue?.state).toBe(stored.state);
          } finally { env.db.close(); }
        });
      }

      it("reopen alone stores the queue active with the chapter waiting, and findOpen returns it", async () => {
        const env = await sqliteWorld(ids(1));
        try {
          const done = await seed(env, "q1", "done", ["failed"]);
          const next: Queue = { ...done, state: "active", items: done.items.map((i) => ({ ...i, status: "waiting", requestId: null })) };
          expect(await env.repo.reopen(next)).toBe(true);
          expect((await env.repo.findOpen())).toMatchObject({ id: "q1", state: "active" });
          expect((await env.repo.get("q1"))?.items[0]?.status).toBe("waiting");
        } finally { env.db.close(); }
      });

      it("a stale plain save of an older active copy is still refused on a done queue", async () => {
        const env = await sqliteWorld(ids(1));
        try {
          const done = await seed(env, "q1", "done", ["partial"]);
          await env.repo.save({ ...done, state: "active" });
          expect((await env.repo.get("q1"))?.state).toBe("done");
          expect(await env.repo.findOpen()).toBeNull();
        } finally { env.db.close(); }
      });

      it("a stopped queue never reopens: Make again returns false and the store stays stopped", async () => {
        const env = await sqliteWorld(ids(1));
        try {
          const stopped = await seed(env, "q1", "stopped", ["failed"]);
          // A window still holding an older "done" copy.
          const r = new KitQueueRunner(env.deps, () => {}, { ...stopped, state: "done" });
          expect(await r.retry(0)).toBe(false);
          expect(await env.repo.reopen({ ...stopped, state: "active" })).toBe(false);
          const stored = (await env.repo.get("q1"))!;
          expect(stored.state).toBe("stopped");
          expect(stored.items[0]?.status).toBe("failed");
          expect(r.queue?.state).toBe("stopped");
          expect(env.w.calls).toEqual([]);
        } finally { env.db.close(); }
      });

      it("a done queue does not reopen while another queue is open: nothing is sent and both rows stay as they were", async () => {
        const env = await sqliteWorld(ids(1));
        try {
          const done = await seed(env, "q1", "done", ["failed"]);
          await seed(env, "q2", "active", ["waiting"], "2026-11-07T11:00:00.000Z");
          const before = [await env.repo.get("q1"), await env.repo.get("q2")];
          const r = new KitQueueRunner(env.deps, () => {}, done);
          expect(await r.retry(0)).toBe(false);
          expect(env.w.calls).toEqual([]);
          expect([await env.repo.get("q1"), await env.repo.get("q2")]).toEqual(before);
          expect(r.queue?.state).toBe("done");
          expect(statuses(r.queue)).toEqual(statuses(before[0]!));
        } finally { env.db.close(); }
      });

      it("a second Make again after a successful one works the same way", async () => {
        const env = await sqliteWorld(ids(1));
        try {
          const done = await seed(env, "q1", "done", ["partial"]);
          env.w.start = partialKit(env);
          const r = new KitQueueRunner(env.deps, () => {}, done);
          expect(await r.retry(0)).toBe(true);
          expect(statuses(r.queue)).toEqual(["partial"]);
          expect((await env.repo.get("q1"))?.state).toBe("done");
          expect(await r.retry(0)).toBe(true);
          expect(env.w.paid).toEqual(["c1", "c1"]);
          const stored = (await env.repo.get("q1"))!;
          expect(stored).toMatchObject({ state: "done" });
          expect(stored.items[0]?.status).toBe("partial");
          expect(r.queue?.state).toBe("done");
          expect(await env.repo.findOpen()).toBeNull();
        } finally { env.db.close(); }
      });
    });

    it("a window-only kit that was dismissed is listed as needing another try, not dropped from the summary", async () => {
      const { w, runner, chapters, consent } = world(ids(1), async (id, _call, options) => {
        options.onJobId?.("job-m");
        await Promise.resolve();
        w.unkept.add(id);
        return { outcome: "memory-only", sent: true, requestId: options.requestId };
      });
      const r = runner();
      await r.begin(chapters, consent);
      w.unkept.delete("c1");
      await r.resume();
      expect(statuses(r.queue)).toEqual(["unclear"]);
      expect(summarize(r.queue!).needsTry.map((i) => i.materialId)).toEqual(["c1"]);
      expect(w.paid).toEqual(["c1"]);
    });
  });
});
