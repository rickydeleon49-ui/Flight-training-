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

export interface StartKitOptions {
  requestId: string;
  /** The provider and file checksum the student agreed to: anything else is refused before sending. */
  expected: { provider: string; sha256: string };
  /** The journal job id, as soon as the native side has begun the job. */
  onJobId?: (jobId: string) => void;
}

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
  startKit(target: { materialId: string; filePath: string }, options: StartKitOptions): Promise<KitStartResult>;
  cancelRunning(requestId: string): Promise<void>;
  /** A finished kit for this chapter that is only in this window (not on disk). */
  holdsUnkeptDraft(materialId: string): boolean;
  /** The chapter already has a saved study guide. */
  hasSavedKit(materialId: string): boolean;
  persist(queue: Queue): Promise<void>;
  /** Writes a new queue only when no other queue is open, in one step. False when one is. */
  claim(queue: Queue): Promise<boolean>;
  findOpen(): Promise<Queue | null>;
}

export type BeginResult = { ok: true } | { ok: false; reason: "already" | "consent" | "empty" };

/** One claim at a time in this window, whichever runner asks. */
let claiming = false;

export class KitQueueRunner {
  private q: Queue | null;
  private running = false;
  private note: string | null = null;
  /** Stop moves this on: any work that began before it may no longer change the queue's state. */
  private epoch = 0;
  /** Writes land in the order they were made. */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RunnerDeps, private readonly onChange: (queue: Queue | null, message: string | null) => void, initial: Queue | null = null) {
    this.q = initial;
  }

  get queue(): Queue | null { return this.q; }
  get message(): string | null { return this.note; }
  get busy(): boolean { return this.running; }

  private async commit(next: Queue, message: string | null = this.note): Promise<void> {
    // Stop always wins: a stopped queue never becomes active or paused again.
    if (this.q && this.q.id === next.id && this.q.state === "stopped" && next.state !== "stopped") {
      next = { ...next, state: "stopped", pauseReason: null };
      message = this.note;
    }
    this.q = next;
    this.note = message;
    this.onChange(next, message);
    const write = this.writes.then(() => this.deps.persist(next));
    this.writes = write.catch(() => {});
    await write;
  }

  /** Still the same run: not stopped since `epoch`, and still active. */
  private live(epoch: number): boolean { return this.epoch === epoch && this.q?.state === "active"; }

  /** A paid kit is still only in this window: nothing more is sent until it is kept. */
  private holdsUnkept(): boolean {
    return Boolean(this.q?.items.some((item) => item.status === "running" && this.deps.holdsUnkeptDraft(item.materialId)));
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
    if (this.running || claiming || (this.q && (this.q.state === "active" || this.q.state === "paused"))) return { ok: false, reason: "already" };
    this.running = true;
    try {
      claiming = true;
      try {
        if (chapters.length === 0) return { ok: false, reason: "empty" };
        const provider = await this.deps.provider();
        if (!consentValid(consent, { provider, materialIds: chapters.map((c) => c.materialId) })) return { ok: false, reason: "consent" };
        const at = this.deps.now();
        const queue: Queue = {
          id: this.deps.newId(), provider, createdAt: at, state: "active", consentAt: at, pauseReason: null,
          items: chapters.map((chapter, position) => ({
            position, materialId: chapter.materialId, sourceSha256: chapter.sourceSha256, status: "waiting", requestId: null, jobId: null, updatedAt: at,
          })),
        };
        // The database lets only one open queue exist, so two windows cannot both start one.
        if (!(await this.deps.claim(queue))) return { ok: false, reason: "already" };
        this.q = queue;
        this.note = null;
        this.onChange(queue, null);
      } finally { claiming = false; }
      await this.loop();
      return { ok: true };
    } finally { this.running = false; }
  }

  /** Continue a paused queue. Refused while a finished kit is still only in this window. */
  async resume(): Promise<boolean> {
    const q = this.q;
    if (this.running || !q || q.state !== "paused" || !q.consentAt) return false;
    this.running = true;
    const epoch = this.epoch;
    try {
      if (this.holdsUnkept()) return false;
      await this.settle();
      // Checked again after every wait: Stop, consent and kept drafts may have changed.
      const now = this.q;
      if (this.epoch !== epoch || !now || now.state !== "paused" || !now.consentAt || this.holdsUnkept()) return false;
      await this.commit({ ...now, state: "active", pauseReason: null }, null);
      await this.loop();
      return true;
    } finally { this.running = false; }
  }

  /** A fresh consent after the provider changed. */
  async confirmAgain(consent: Consent): Promise<boolean> {
    if (this.running || this.q?.state !== "paused") return false;
    this.running = true;
    const epoch = this.epoch;
    let agreed = false;
    try {
      const provider = await this.deps.provider();
      const q = this.q;
      if (this.epoch !== epoch || !q || q.state !== "paused") return false;
      const waiting = q.items.filter((item) => item.status === "waiting").map((item) => item.materialId);
      if (!consentValid(consent, { provider, materialIds: waiting })) return false;
      await this.commit({ ...q, provider, consentAt: this.deps.now() }, null);
      agreed = this.epoch === epoch && this.q?.state === "paused";
    } finally { this.running = false; }
    return agreed ? this.resume() : false;
  }

  /** Stop before the next chapter and ask the running one to cancel. A finished draft is still kept. */
  async stop(): Promise<void> {
    const q = this.q;
    if (!q || q.state === "stopped" || q.state === "done") return;
    this.epoch += 1;
    const running = q.items.find((item) => item.status === "running");
    await this.commit({ ...q, state: "stopped", pauseReason: null }, TEXT.stopped);
    if (running?.requestId) { try { await this.deps.cancelRunning(running.requestId); } catch { /* The kit still ends on its own. */ } }
  }

  /** Make one chapter again, by hand. Held back, like Continue, while a paid kit is only in this window. */
  async retry(position: number): Promise<boolean> {
    const retryable = (q: Queue | null) => {
      if (!q || (q.state !== "done" && q.state !== "paused")) return null;
      const item = q.items.find((candidate) => candidate.position === position);
      return item && ["partial", "unclear", "failed"].includes(item.status) ? item : null;
    };
    if (this.running || !retryable(this.q)) return false;
    this.running = true;
    const epoch = this.epoch;
    try {
      if (this.holdsUnkept()) return false;
      await this.settle();
      if (this.epoch !== epoch || this.holdsUnkept()) return false;
      let item = retryable(this.q);
      if (!item || this.deps.holdsUnkeptDraft(item.materialId)) return false;
      if (item.status === "unclear") {
        // Look first: if the journal now shows the kit, nothing more is paid for.
        const records = await this.deps.records();
        if (recordOf(records, item, this.q!.createdAt)) return false;
        item = retryable(this.q);
        if (this.epoch !== epoch || !item || item.status !== "unclear" || this.holdsUnkept()) return false;
      }
      await this.commit({ ...moveIn(this.q!, position, "waiting", { requestId: null }, this.deps.now()), state: "active", pauseReason: null }, null);
      await this.loop();
      return true;
    } finally { this.running = false; }
  }

  /** On launch: load the open queue as paused, read the journal, never pay. */
  async restore(): Promise<void> {
    if (this.running || this.q) return;
    this.running = true;
    try {
      const open = await this.deps.findOpen();
      if (!open || this.q) return;
      const records = await this.deps.records();
      if (this.q) return;
      let next = reconcileQueue(open, records, this.deps.now());
      // A queue whose chapters never got written has nothing to do.
      if (next.items.length === 0) next = { ...next, state: "done", pauseReason: null };
      await this.commit(next, next.state === "paused" ? TEXT.restart : null);
    } finally { this.running = false; }
  }

  /** Called when the journal or the drafts change: settle what is done, and wake a queue that waited for room. */
  async poke(): Promise<void> {
    if (this.running || this.q?.state !== "paused") return;
    await this.settle();
    const now = this.q;
    if (!now || now.state !== "paused") return;
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
    if (!this.q) return;
    let records: GeminiJobRecord[] | null = null;
    try { records = await this.deps.records(); } catch { records = null; }
    // Built on the queue as it is after the wait, never on an older copy.
    let q = this.q;
    if (!q) return;
    const at = this.deps.now();
    let changed = false;
    for (const item of q.items) {
      if (item.status === "running" && item.jobId === null && !this.deps.holdsUnkeptDraft(item.materialId) && this.pausedNotKept()) {
        if (this.deps.hasSavedKit(item.materialId)) q = moveIn(moveIn(q, item.position, "checkpointed", {}, at), item.position, "saved", {}, at);
        else q = moveIn(q, item.position, "unclear", {}, at);
        changed = true;
      } else if (item.status === "checkpointed" && records && !recordOf(records, item, q.createdAt)) {
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

  /** The chapter file's checksum now, or null when it was deleted or is missing. */
  private async currentSha(materialId: string): Promise<string | null> {
    return this.deps.title(materialId) === null || !this.deps.filePath(materialId) ? null : this.deps.sourceSha(materialId);
  }

  /** Nothing was sent: put a "running" item back (Stop, or a check failed after it was written down). */
  private async putBack(position: number, then?: "skipped"): Promise<void> {
    const at = this.deps.now();
    let next = moveIn(this.q!, position, "waiting", { requestId: null, jobId: null }, at);
    if (then) next = moveIn(next, position, then, {}, at);
    await this.commit(next, then === "skipped" ? TEXT.skipped : this.note);
  }

  /** Write the job id down as soon as the native side has begun it, so a restart can find the kit. */
  private async noteJobId(position: number, requestId: string, jobId: string): Promise<void> {
    const q = this.q;
    const item = q?.items.find((candidate) => candidate.position === position);
    if (!q || !item || item.status !== "running" || item.requestId !== requestId || item.jobId) return;
    await this.commit({ ...q, items: q.items.map((candidate) => (candidate.position === position ? { ...candidate, jobId } : candidate)) });
  }

  private async step(): Promise<void> {
    const epoch = this.epoch;
    const q = this.q!;
    const item = nextWaiting(q);
    if (!item) { await this.commit({ ...q, state: "done", pauseReason: null }, null); return; }
    const at = this.deps.now();
    if (!q.consentAt || (await this.deps.provider()) !== q.provider) {
      if (this.live(epoch)) await this.pause("consent", TEXT.consentStale, { consentAt: null });
      return;
    }
    if (!this.live(epoch)) return;
    const sha = await this.currentSha(item.materialId);
    if (!this.live(epoch)) return;
    if (sha === null || sha !== item.sourceSha256) {
      await this.commit(moveIn(this.q!, item.position, "skipped", {}, at), TEXT.skipped);
      return;
    }
    let records: GeminiJobRecord[];
    try { records = await this.deps.records(); } catch {
      await this.pause("busy", TEXT.busy);
      return;
    }
    if (!this.live(epoch)) return;
    if (slotsFull(records)) { await this.pause("slots", TEXT.slotsFull); return; }

    const requestId = this.deps.newRequestId();
    // Written down before anything is sent.
    await this.commit(moveIn(this.q!, item.position, "running", { requestId, jobId: null }, at), null);
    if (!this.live(epoch)) { await this.putBack(item.position); return; }
    // The last checks come after the last write, right before the paid call: Stop,
    // the provider the student agreed to, and the chapter file itself.
    let provider: string;
    let current: string | null;
    try {
      provider = await this.deps.provider();
      current = await this.currentSha(item.materialId);
    } catch {
      await this.putBack(item.position);
      await this.pause("busy", TEXT.busy);
      return;
    }
    const now = this.q!;
    if (!this.live(epoch)) { await this.putBack(item.position); return; }
    if (!now.consentAt || provider !== now.provider) {
      await this.putBack(item.position);
      await this.pause("consent", TEXT.consentStale, { consentAt: null });
      return;
    }
    if (current === null || current !== item.sourceSha256) { await this.putBack(item.position, "skipped"); return; }
    const filePath = this.deps.filePath(item.materialId)!;
    // The native side checks the provider and checksum once more and refuses before sending.
    const result = await this.deps.startKit({ materialId: item.materialId, filePath }, {
      requestId,
      expected: { provider: now.provider, sha256: item.sourceSha256 },
      onJobId: (jobId) => { void this.noteJobId(item.position, requestId, jobId).catch(() => {}); },
    });
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
        if (result.stale === "source") { await this.putBack(position, "skipped"); return; }
        if (result.stale === "provider") { await this.pause("consent", TEXT.consentStale, { ...items("waiting", { requestId: null }), consentAt: null }); return; }
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
