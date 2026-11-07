/**
 * SOURCE-01b: the pure rules of the study-kit queue. No storage, no provider,
 * no React. Ids, checksums and status only: never keys, answers or page text.
 */
import type { GeminiJobRecord } from "@/services/gemini";

export type QueueState = "active" | "paused" | "stopped" | "done";
export type ItemStatus =
  | "waiting"
  | "running"
  | "checkpointed"
  | "saved"
  | "partial"
  | "unclear"
  | "skipped"
  | "failed";

/** Why a queue is paused; kept in memory only. After a restart it is always "restart". */
export type PauseReason = "restart" | "slots" | "not-kept" | "rate-limit" | "unclear" | "busy" | "consent" | "failed";

export interface QueueItem {
  position: number;
  materialId: string;
  sourceSha256: string;
  status: ItemStatus;
  requestId: string | null;
  jobId: string | null;
  updatedAt: string;
}

export interface Queue {
  id: string;
  provider: string;
  createdAt: string;
  state: QueueState;
  consentAt: string | null;
  items: QueueItem[];
  /** In memory only. */
  pauseReason?: PauseReason | null;
}

/** The most journal slots there are (src-tauri gemini_jobs.rs MAX_JOBS). */
export const MAX_JOURNAL_JOBS = 8;

export const KIT_QUEUE_TEXT = {
  consentTitle: "Make study kits for these chapters?",
  billed: (company: string) => `Billed to your own API account by ${company}.`,
  skipped: "This chapter changed. Make it again from its page.",
  slotsFull: "Save or dismiss your finished chapters to continue",
  notKept: (title: string) => `Your finished kit for ${title} has not been kept yet. Save or keep this window open.`,
  rateLimit: "The provider says you have reached a limit for now. Wait a little, then press Continue.",
  unclear: (title: string) => `It is not clear whether ${title} finished. Nothing was tried again. Make it again once you have checked.`,
  failedPlain: (title: string) => `${title} could not be made. Nothing was tried again.`,
  busy: "Another study aid is being made. Press Continue when it is done.",
  consentStale: "Your provider or your chapters changed. Check them and confirm again.",
  restart: "Your kits were paused when the app closed. Press Continue to go on.",
  progress: (index: number, total: number, title: string) => `Making kit ${index} of ${total}: ${title}`,
  stopped: "Stopped. Finished kits are kept.",
  needsTry: "Needs another try",
  partlyDone: "Some parts of this kit did not come back. The good parts are kept for you to review.",
} as const;

/** Every move an item may make. Anything else is refused. */
const MOVES: Record<ItemStatus, readonly ItemStatus[]> = {
  waiting: ["running", "skipped"],
  // Back to waiting only when nothing was sent (refused, cancelled before sending, rate limit).
  running: ["checkpointed", "partial", "unclear", "failed", "waiting"],
  checkpointed: ["saved", "partial"],
  partial: ["saved", "waiting"],
  unclear: ["waiting"],
  failed: ["waiting"],
  skipped: [],
  saved: [],
};

export function canMove(from: ItemStatus, to: ItemStatus): boolean {
  return MOVES[from].includes(to);
}

export class IllegalMove extends Error {
  constructor(from: ItemStatus, to: ItemStatus) {
    super(`A kit queue item cannot go from ${from} to ${to}.`);
  }
}

export function moveItem(item: QueueItem, to: ItemStatus, change: Partial<Pick<QueueItem, "requestId" | "jobId">>, at: string): QueueItem {
  if (!canMove(item.status, to)) throw new IllegalMove(item.status, to);
  return { ...item, ...change, status: to, updatedAt: at };
}

/** Apply a move to one item of a queue, immutably. */
export function moveIn(queue: Queue, position: number, to: ItemStatus, change: Partial<Pick<QueueItem, "requestId" | "jobId">>, at: string): Queue {
  return { ...queue, items: queue.items.map((item) => (item.position === position ? moveItem(item, to, change, at) : item)) };
}

/** The consent the student gave, bound to one provider and one exact set of chapters. */
export interface Consent {
  provider: string;
  materialIds: readonly string[];
}

const idKey = (ids: readonly string[]) => JSON.stringify([...ids].sort());

export function consentValid(consent: Consent | null, current: Consent): boolean {
  return Boolean(consent) && consent!.provider === current.provider && idKey(consent!.materialIds) === idKey(current.materialIds);
}

export const waitingItems = (queue: Queue): QueueItem[] => queue.items.filter((item) => item.status === "waiting");
export const nextWaiting = (queue: Queue): QueueItem | undefined => queue.items.find((item) => item.status === "waiting");

/** Journal records that hold a slot. A failed or cancelled record with no draft is made room from by the native side. */
export function slotsHeld(records: readonly GeminiJobRecord[]): number {
  return records.filter((record) => !(["failed", "interrupted", "cancelled"].includes(record.stage) && !record.draft)).length;
}
export const slotsFull = (records: readonly GeminiJobRecord[]): boolean => slotsHeld(records) >= MAX_JOURNAL_JOBS;

/** The journal record (or one of a kit's parts) for a kit job. */
export function recordOf(records: readonly GeminiJobRecord[], item: Pick<QueueItem, "requestId" | "jobId">): GeminiJobRecord | undefined {
  return records.find((record) =>
    (item.requestId && record.requestId === item.requestId) ||
    (item.jobId && (record.id === item.jobId || record.id.startsWith(`${item.jobId}#`))));
}

/** A kit with some parts answered and some failed. */
export function isPartialKit(parts: Record<string, { answer?: unknown; error?: string } | undefined> | undefined): boolean {
  if (!parts) return false;
  const all = Object.values(parts).filter(Boolean) as { answer?: unknown; error?: string }[];
  return all.some((part) => part.answer) && all.some((part) => !part.answer);
}

function partsOf(record: GeminiJobRecord): Record<string, { answer?: unknown; error?: string } | undefined> | undefined {
  return (record.result as unknown as { parts?: Record<string, { answer?: unknown; error?: string }> } | undefined)?.parts;
}

/**
 * After a restart: nothing runs, and the journal says what really happened.
 * Never pays for anything. A call that was in flight when the app closed and left
 * no record is "unclear", never tried again by itself.
 */
export function reconcileQueue(queue: Queue, records: readonly GeminiJobRecord[], at: string): Queue {
  let next: Queue = queue;
  for (const item of queue.items) {
    const record = recordOf(records, item);
    if (item.status === "running") {
      if (record && record.stage === "ready") {
        const partial = isPartialKit(partsOf(record));
        next = moveIn(next, item.position, partial ? "partial" : "checkpointed", { jobId: record.id.split("#")[0] ?? record.id }, at);
      } else if (record && record.stage === "running") {
        continue;
      } else {
        next = moveIn(next, item.position, "unclear", {}, at);
      }
    } else if (item.status === "checkpointed" && !record) {
      next = moveIn(next, item.position, "saved", {}, at);
    }
  }
  if (next.state === "active") next = { ...next, state: "paused" };
  if (next.state === "paused") next = { ...next, pauseReason: next.pauseReason ?? "restart" };
  return next;
}

export type Summary = { made: QueueItem[]; needsTry: QueueItem[]; skipped: QueueItem[]; left: number };

export function summarize(queue: Queue): Summary {
  return {
    made: queue.items.filter((i) => i.status === "checkpointed" || i.status === "saved"),
    needsTry: queue.items.filter((i) => i.status === "partial" || i.status === "unclear" || i.status === "failed"),
    skipped: queue.items.filter((i) => i.status === "skipped"),
    left: waitingItems(queue).length,
  };
}

/** A rate or spending limit, as the native side words it. Nothing was made, so nothing was lost. */
export function looksRateLimited(message: string): boolean {
  return /rate or spending limit|rate limit/i.test(message);
}
