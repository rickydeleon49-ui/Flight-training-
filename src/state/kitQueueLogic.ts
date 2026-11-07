/**
 * SOURCE-01b: the pure rules of the study-kit queue. No storage, no provider,
 * no React. Ids, checksums and status only: never keys, answers or page text.
 */
import { KIT_PROVIDER_CHANGED, KIT_SOURCE_CHANGED, type GeminiJobRecord } from "@/services/gemini";

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
  skipped: KIT_SOURCE_CHANGED,
  slotsFull: "Save or dismiss your finished chapters to continue",
  notKept: (title: string) => `Your finished kit for ${title} has not been kept yet. Save or keep this window open.`,
  rateLimit: "The provider says you have reached a limit for now. Wait a little, then press Continue.",
  unclear: (title: string) => `It is not clear whether ${title} finished. Nothing was tried again. Make it again once you have checked.`,
  failedPlain: (title: string) => `${title} could not be made. Nothing was tried again.`,
  busy: "Another study aid is being made. Press Continue when it is done.",
  consentStale: KIT_PROVIDER_CHANGED,
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

/** The journal job a listed record belongs to: a finished kit is listed as "<job>#guide", "<job>#cards"... */
export const baseJobId = (record: Pick<GeminiJobRecord, "id">): string => record.id.split("#")[0] ?? record.id;

/** A part of a finished kit, as the native review listing shows it (study_kit.rs review_records). */
const isKitPart = (record: GeminiJobRecord): boolean =>
  record.id.includes("#") || record.draft?.kind === "study-kit-part" || /^(flashcards:)?study-kit:/.test(record.requestId ?? "");

/**
 * Journal slots in use, counted the way gemini_jobs.rs counts MAX_JOBS: one per
 * journal job, however many review parts it is listed as. A failed, interrupted or
 * cancelled job with no draft is made room from by the native side.
 */
export function slotsHeld(records: readonly GeminiJobRecord[]): number {
  const jobs = new Map<string, boolean>();
  for (const record of records) {
    const id = baseJobId(record);
    const holds = isKitPart(record) || !(["failed", "interrupted", "cancelled"].includes(record.stage) && !record.draft);
    jobs.set(id, (jobs.get(id) ?? false) || holds);
  }
  return [...jobs.values()].filter(Boolean).length;
}
export const slotsFull = (records: readonly GeminiJobRecord[]): boolean => slotsHeld(records) >= MAX_JOURNAL_JOBS;

const seconds = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};

/**
 * Every listed record of one queue item's kit. Matched on what survives in the
 * native journal: the request id while the job runs or failed; the job id (the part
 * of each review record id before "#") once known; and, before the job id was
 * written down, the chapter and its exact file checksum on a kit part begun no
 * earlier than `since` (the native created time, in seconds). The newest such kit wins.
 */
export function kitRecords(
  records: readonly GeminiJobRecord[],
  item: Pick<QueueItem, "requestId" | "jobId"> & Partial<Pick<QueueItem, "materialId" | "sourceSha256">>,
  since?: string | null,
): GeminiJobRecord[] {
  let job: string | null = item.jobId;
  if (!job && item.requestId) {
    const byRequest = records.find((record) => record.requestId === item.requestId);
    if (byRequest) job = baseJobId(byRequest);
  }
  if (!job && item.materialId && item.sourceSha256 && since) {
    const after = seconds(since);
    const candidates = records
      .filter((record) => isKitPart(record) && record.materialId === item.materialId && record.contentSha256 === item.sourceSha256 && record.createdAt >= after)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (candidates[0]) job = baseJobId(candidates[0]);
  }
  return job ? records.filter((record) => baseJobId(record) === job) : [];
}

/** The first listed record of a queue item's kit, if the journal still holds it. */
export function recordOf(
  records: readonly GeminiJobRecord[],
  item: Pick<QueueItem, "requestId" | "jobId"> & Partial<Pick<QueueItem, "materialId" | "sourceSha256">>,
  since?: string | null,
): GeminiJobRecord | undefined {
  return kitRecords(records, item, since)[0];
}

/** A kit with some parts answered and some failed. */
export function isPartialKit(parts: Record<string, { answer?: unknown; error?: string } | undefined> | undefined): boolean {
  if (!parts) return false;
  const all = Object.values(parts).filter(Boolean) as { answer?: unknown; error?: string }[];
  return all.some((part) => part.answer) && all.some((part) => !part.answer);
}

/** How a finished kit's review parts say it ended: whole, partly done, or with no good part left. */
export type KitEnd = "whole" | "partial" | "empty";
const KIT_PART_COUNT = 3;
export function kitEnd(group: readonly GeminiJobRecord[]): KitEnd {
  const parts = group.filter((record) => record.id.includes("#"));
  if (parts.length === 0) return "whole";
  // Native review parts are "ready" exactly when they hold an answer.
  const failed = parts.filter((record) => record.stage !== "ready").length;
  if (failed === 0) return "whole";
  // A part already saved has left the listing, so it counts as a good part.
  return failed < parts.length || parts.length < KIT_PART_COUNT ? "partial" : "empty";
}

/**
 * After a restart: nothing runs, and the journal says what really happened.
 * Never pays for anything. A call that was in flight when the app closed and left
 * no record is "unclear", never tried again by itself.
 */
export function reconcileQueue(queue: Queue, records: readonly GeminiJobRecord[], at: string): Queue {
  let next: Queue = queue;
  for (const item of queue.items) {
    // A running item's time is when it was written down, just before the call.
    const group = kitRecords(records, item, item.status === "running" ? item.updatedAt : queue.createdAt);
    // Review parts are only listed for a kit the journal holds as finished.
    const ready = group.find((record) => record.stage === "ready" || record.id.includes("#"));
    if (item.status === "running") {
      if (group.some((record) => record.stage === "running")) {
        continue;
      } else if (ready) {
        const end = kitEnd(group);
        next = moveIn(next, item.position, end === "whole" ? "checkpointed" : end === "partial" ? "partial" : "failed", { jobId: baseJobId(ready) }, at);
      } else {
        next = moveIn(next, item.position, "unclear", {}, at);
      }
    } else if (item.status === "checkpointed" && group.length === 0) {
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
