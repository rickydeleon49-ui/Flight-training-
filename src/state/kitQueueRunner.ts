/**
 * SOURCE-01b: drives the study-kit queue, one kit at a time, with every outside
 * effect passed in (storage, provider, journal), so the rules can be tested without
 * a screen. It never pays twice: nothing is tried again after an unclear finish, and a
 * paid draft is never dropped.
 */
import type { GeminiJobRecord } from "@/services/gemini";
import type { KitStartResult } from "./GeminiJobs";
import {
  KIT_QUEUE_TEXT as TEXT, consentValid, looksRateLimited, moveIn, nextWaiting, reconcileQueue, recordOf, slotsFull,
  type Consent, type ItemStatus, type PauseReason, type Queue, type QueueItem,
} from "./kitQueueLogic";

export interface RunnerDeps {
  now(): string;
  newId(): string;
  newRequestId(): string;
  /** The provider company the next request would go to. */
  provider(): Promise<string>;
  /** The chapter's title, or null once it was deleted. */
  title(materialId: string): string | null;
  filePath(materialId: string): string | null;
  /** The chapter file's checksum as it is now, or null when it is missing. */
  sourceSha(materialId: string): Promise<string | null>;
  records(): Promise<GeminiJobRecord[]>;
  startKit(target: { materialId: string; filePath: string }, options: { requestId: string }): Promise<KitStartResult>;
  cancelRunning(requestId: string): Promise<void>;
  /** A finished kit for this chapter that is only in this window (not on disk). */
  holdsUnkeptDraft(materialId: string): boolean;
  /** The chapter already has a saved study guide. */
  hasSavedKit(materialId: string): boolean;
  persist(queue: Queue): Promise<void>;
  findOpen(): Promise<Queue | null>;
}

export type BeginResult = { ok: true } | { ok: false; reason: "already" | "consent" | "empty" };

export class KitQueueRunner {
  private q: Queue | null;
  private running = false;
  private note: string | null = null;

  constructor(private readonly deps: RunnerDeps, private readonly onChange: (queue: Queue | null, message: string | null) => void, initial: Queue | null = null) {
    this.q = initial;
  }

  get queue(): Queue | null { return this.q; }
  get message(): string | null { return this.note; }
  get busy(): boolean { return this.running; }

  private async commit(next: Queue, message: string | null = this.note): Promise<void> {
    this.q = next;
    this.note = message;
    this.onChange(next, message);
    await this.deps.persist(next);
  }

  /** Pause, unless the student has already stopped it. */
  private async pause(reason: PauseReason, message: string | null, patch: { items?: QueueItem[]; consentAt?: string | null } = {}): Promise<void> {
    const q = this.q;
    if (!q) return;
    if (q.state !== "active") { await this.commit({ ...q, ...patch }, this.note ?? message); return; }
    await this.commit({ ...q, ...patch, state: "paused", pauseReason: reason }, message);
  }

  /** Start a queue. A second start while one is open (or starting) does nothing. */
  async begin(chapters: { materialId: string; sourceSha256: string }[], consent: Consent): Promise<BeginResult> {
    if (this.running || (this.q && (this.q.state === "active" || this.q.state === "paused"))) return { ok: false, reason: "already" };
    this.running = true;
    try {
      if (chapters.length === 0) return { ok: false, reason: "empty" };
      if (await this.deps.findOpen()) return { ok: false, reason: "already" };
      const provider = await this.deps.provider();
      if (!consentValid(consent, { provider, materialIds: chapters.map((c) => c.materialId) })) return { ok: false, reason: "consent" };
      const at = this.deps.now();
      await this.commit({
        id: this.deps.newId(), provider, createdAt: at, state: "active", consentAt: at, pauseReason: null,
        items: chapters.map((chapter, position) => ({
          position, materialId: chapter.materialId, sourceSha256: chapter.sourceSha256, status: "waiting", requestId: null, jobId: null, updatedAt: at,
        })),
      }, null);
      await this.loop();
      return { ok: true };
    } finally { this.running = false; }
  }

  /** Continue a paused queue. Refused while a finished kit is still only in this window. */
  async resume(): Promise<boolean> {
    const q = this.q;
    if (this.running || !q || q.state !== "paused" || !q.consentAt) return false;
    this.running = true;
    try {
      if (q.items.some((item) => item.status === "running" && this.deps.holdsUnkeptDraft(item.materialId))) return false;
      await this.settle();
      await this.commit({ ...this.q!, state: "active", pauseReason: null }, null);
      await this.loop();
      return true;
    } finally { this.running = false; }
  }

  /** A fresh consent after the provider changed. */
  async confirmAgain(consent: Consent): Promise<boolean> {
    const q = this.q;
    if (!q || q.state !== "paused") return false;
    const provider = await this.deps.provider();
    const waiting = q.items.filter((item) => item.status === "waiting").map((item) => item.materialId);
    if (!consentValid(consent, { provider, materialIds: waiting })) return false;
    await this.commit({ ...q, provider, consentAt: this.deps.now() }, null);
    return this.resume();
  }

  /** Stop before the next chapter and ask the running one to cancel. A finished draft is still kept. */
  async stop(): Promise<void> {
    const q = this.q;
    if (!q || q.state === "stopped" || q.state === "done") return;
    const running = q.items.find((item) => item.status === "running");
    await this.commit({ ...q, state: "stopped", pauseReason: null }, TEXT.stopped);
    if (running?.requestId) { try { await this.deps.cancelRunning(running.requestId); } catch { /* The kit still ends on its own. */ } }
  }

  /** Make one chapter again, by hand. */
  async retry(position: number): Promise<boolean> {
    const q = this.q;
    if (this.running || !q || (q.state !== "done" && q.state !== "paused")) return false;
    const item = q.items.find((candidate) => candidate.position === position);
    if (!item || !["partial", "unclear", "failed"].includes(item.status)) return false;
    this.running = true;
    try {
      if (item.status === "unclear") {
        // Look first: if the journal now shows the kit, nothing more is paid for.
        const records = await this.deps.records();
        if (recordOf(records, item)) return false;
      }
      await this.commit({ ...moveIn(q, position, "waiting", { requestId: null }, this.deps.now()), state: "active", pauseReason: null }, null);
      await this.loop();
      return true;
    } finally { this.running = false; }
  }

  /** On launch: load the open queue as paused, read the journal, never pay. */
  async restore(): Promise<void> {
    const open = await this.deps.findOpen();
    if (!open) return;
    this.running = true;
    try {
      const records = await this.deps.records();
      const next = reconcileQueue(open, records, this.deps.now());
      await this.commit(next, next.state === "paused" ? TEXT.restart : null);
    } finally { this.running = false; }
  }

  /** Called when the journal or the drafts change: settle what is done, and wake a queue that waited for room. */
  async poke(): Promise<void> {
    const q = this.q;
    if (this.running || !q || q.state !== "paused") return;
    await this.settle();
    const now = this.q!;
    if (now.pauseReason === "slots") {
      let records: GeminiJobRecord[];
      try { records = await this.deps.records(); } catch { return; }
      if (!slotsFull(records)) await this.resume();
    } else if (now.pauseReason === "not-kept" && !now.items.some((item) => item.status === "running")) {
      await this.resume();
    }
  }

  /** Items whose kit has left the journal or the window are settled. */
  private async settle(): Promise<void> {
    let q = this.q;
    if (!q) return;
    const at = this.deps.now();
    let changed = false;
    let records: GeminiJobRecord[] | null = null;
    try { records = await this.deps.records(); } catch { records = null; }
    for (const item of q.items) {
      if (item.status === "running" && item.jobId === null && !this.deps.holdsUnkeptDraft(item.materialId) && this.pausedNotKept()) {
        if (this.deps.hasSavedKit(item.materialId)) q = moveIn(moveIn(q, item.position, "checkpointed", {}, at), item.position, "saved", {}, at);
        else q = moveIn(q, item.position, "unclear", {}, at);
        changed = true;
      } else if (item.status === "checkpointed" && records && !recordOf(records, item)) {
        q = moveIn(q, item.position, "saved", {}, at);
        changed = true;
      }
    }
    if (changed) await this.commit(q);
  }

  private pausedNotKept(): boolean { return this.q?.state === "paused" && this.q.pauseReason === "not-kept"; }

  /** One chapter at a time until the queue ends, pauses or is stopped. */
  private async loop(): Promise<void> {
    try {
      while (this.q && this.q.state === "active") await this.step();
    } catch {
      await this.pause("failed", "The kit queue could not be saved just now. Nothing was tried again. Press Continue to go on.");
    }
  }

  private async step(): Promise<void> {
    const q = this.q!;
    const item = nextWaiting(q);
    if (!item) { await this.commit({ ...q, state: "done", pauseReason: null }, null); return; }
    const at = this.deps.now();
    if (!q.consentAt || (await this.deps.provider()) !== q.provider) {
      await this.pause("consent", TEXT.consentStale, { consentAt: null });
      return;
    }
    const filePath = this.deps.filePath(item.materialId);
    // Checked again right before every paid call.
    const sha = this.deps.title(item.materialId) === null || !filePath ? null : await this.deps.sourceSha(item.materialId);
    if (sha === null || sha !== item.sourceSha256) {
      await this.commit(moveIn(this.q!, item.position, "skipped", {}, at), TEXT.skipped);
      return;
    }
    let records: GeminiJobRecord[];
    try { records = await this.deps.records(); } catch {
      await this.pause("busy", TEXT.busy);
      return;
    }
    if (slotsFull(records)) { await this.pause("slots", TEXT.slotsFull); return; }

    if (this.q!.state !== "active") return;
    const requestId = this.deps.newRequestId();
    // Written down before anything is sent.
    await this.commit(moveIn(this.q!, item.position, "running", { requestId, jobId: null }, at), null);
    if (this.q!.state !== "active") {
      // Stopped while that was being written: nothing was sent.
      await this.commit(moveIn(this.q!, item.position, "waiting", {}, at));
      return;
    }
    const result = await this.deps.startKit({ materialId: item.materialId, filePath: filePath! }, { requestId });
    await this.finish(item.position, item.materialId, requestId, result);
  }

  private async finish(position: number, materialId: string, requestId: string, result: KitStartResult): Promise<void> {
    const at = this.deps.now();
    const title = this.deps.title(materialId) ?? "this chapter";
    // Always against the queue as it is now: the student may have pressed Stop meanwhile.
    const items = (to: ItemStatus, change: Partial<Pick<QueueItem, "requestId" | "jobId">> = {}) => ({ items: moveIn(this.q!, position, to, change, at).items });
    switch (result.outcome) {
      case "checkpointed": {
        let found = true;
        try { found = Boolean(recordOf(await this.deps.records(), { requestId, jobId: result.jobId ?? null })); } catch { /* The kit itself read the journal. */ }
        if (!found) { await this.pause("unclear", TEXT.unclear(title), items("unclear")); return; }
        await this.commit({ ...this.q!, ...items(result.partial ? "partial" : "checkpointed", { jobId: result.jobId ?? null }) }, result.partial ? TEXT.partlyDone : null);
        return;
      }
      case "memory-only":
        await this.pause("not-kept", TEXT.notKept(title));
        return;
      case "refused":
        await this.pause("busy", result.message ?? TEXT.busy, items("waiting"));
        return;
      case "cancelled":
        if (!result.sent) await this.pause("busy", result.message ?? null, items("waiting"));
        else await this.pause("unclear", TEXT.unclear(title), items("unclear"));
        return;
      case "failed":
      default:
        if (looksRateLimited(result.message ?? "")) await this.pause("rate-limit", TEXT.rateLimit, items("waiting"));
        else if (result.sent) await this.pause("unclear", TEXT.unclear(title), items("unclear"));
        else await this.pause("failed", TEXT.failedPlain(title), items("failed"));
    }
  }
}
