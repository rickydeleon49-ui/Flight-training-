/**
 * M2-4 / C2 stream controller: owned operations, generations, the single
 * failed-read descriptor with immutable dispatch snapshots, enrichment
 * progress and caught-up versus blocked states. Readers are controlled
 * fakes so every interleaving is deterministic.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  LibraryRecentReviewEntry,
  LibraryRecentReviewsInput,
  LibraryRecentReviewsResult,
  LibraryReviewDueInput,
  LibraryReviewDueResult,
  LibraryReviewMaterialEntry,
} from "@/domain/types";

import { applyHistoryEnrichment, createDueStream, createHistoryStream, pendingHistoryTargets } from "./deferredReviewRead";

const CLOCK = { nowUtc: "2026-10-06T16:00:00.000Z", nextLocalMidnightUtc: "2026-10-07T05:00:00.000Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entry = (materialId: string): LibraryReviewMaterialEntry => ({
  materialId,
  title: materialId,
  topic: "general",
  priority: "later",
  updatedAt: CLOCK.nowUtc,
  cardCount: 1,
  againCount: 0,
  dayCount: 0,
  newCount: 1,
  totalDueCount: 0,
  retainedCardCount: 0,
  earliestDueAt: null,
});

const duePage = (ids: string[], nextCursor: string | null, issues: LibraryReviewDueResult["issues"] = []): LibraryReviewDueResult => ({
  materials: ids.map(entry),
  nextCursor,
  issues,
  summary: {
    scannedCandidates: ids.length,
    evaluatedCandidates: ids.length,
    attemptedCards: ids.length,
    evaluatedCards: ids.length,
    rawReads: ids.length,
    rawBytesTransferred: 10 * ids.length,
    actionableCount: ids.length,
    againCount: 0,
    dayCount: 0,
    totalDueCount: 0,
    newCount: ids.length,
    isComplete: nextCursor === null,
    isPageLocal: true,
    issues,
  },
});

const oversize = (materialId: string) => ({
  materialId,
  title: materialId,
  code: "PAYLOAD_TOO_LARGE" as const,
  rawBytes: 9_000_000,
  allowedBytes: 8_388_608,
  inspectionTarget: `/study/${materialId}`,
});

/** A reader whose calls are recorded and settled by the test. */
function scriptedDue() {
  const calls: { input: LibraryReviewDueInput; settle: ReturnType<typeof deferred<LibraryReviewDueResult>> }[] = [];
  const read = vi.fn((input: LibraryReviewDueInput) => {
    const settle = deferred<LibraryReviewDueResult>();
    calls.push({ input, settle });
    return settle.promise;
  });
  return { read, calls };
}

describe("[c2] owned page operations", () => {
  it("same-turn duplicate requests share one read; rows dedupe by material", async () => {
    const { read, calls } = scriptedDue();
    const stream = createDueStream(read, { ...CLOCK, statusFilter: "all", limit: 2 });
    const a = stream.loadNextPage();
    const b = stream.loadNextPage();
    expect(read).toHaveBeenCalledTimes(1);
    calls[0]!.settle.resolve(duePage(["m1", "m2"], "c1"));
    await Promise.all([a, b]);
    void stream.loadNextPage();
    calls[1]!.settle.resolve(duePage(["m2", "m3"], null));
    await stream.loadNextPage();
    expect(stream.getSnapshot().rows.map((r) => r.materialId)).toEqual(["m1", "m2", "m3"]);
    expect(calls[1]!.input.cursor).toBe("c1");
  });

  it("an invalidated read can never publish, record a failure or release the newer lock", async () => {
    const { read, calls } = scriptedDue();
    const stream = createDueStream(read, { ...CLOCK, statusFilter: "all" });
    void stream.loadNextPage();
    stream.invalidate({ statusFilter: "due_today" });
    void stream.loadNextPage();
    expect(read).toHaveBeenCalledTimes(2);
    expect(calls[1]!.input.statusFilter).toBe("due_today");
    calls[0]!.settle.resolve(duePage(["stale"], null));
    calls[0]!.settle.reject(new Error("too late"));
    await Promise.resolve();
    expect(stream.getSnapshot()).toMatchObject({ rows: [], loading: "page", error: null, failedRead: null });
    expect(stream.busy).toBe(true);
    calls[1]!.settle.resolve(duePage(["fresh"], null));
    await vi.waitFor(() => expect(stream.getSnapshot().rows.map((r) => r.materialId)).toEqual(["fresh"]));
  });

  it("an obsolete synchronous reader throw cannot clear a newer held operation", async () => {
    const held = deferred<LibraryReviewDueResult>();
    let first = true;
    const stream = createDueStream(
      (input) => {
        if (first) {
          first = false;
          stream.invalidate({ topic: "weather" }); // invalidation re-enters while the first call is starting
          void stream.loadNextPage();
          throw new Error("synchronous failure of the obsolete read");
        }
        void input;
        return held.promise;
      },
      { ...CLOCK, statusFilter: "all" },
    );
    await stream.loadNextPage();
    expect(stream.getSnapshot()).toMatchObject({ loading: "page", error: null, failedRead: null });
    expect(stream.busy).toBe(true);
    held.resolve(duePage(["kept"], null));
    await vi.waitFor(() => expect(stream.getSnapshot().rows).toHaveLength(1));
    expect(stream.busy).toBe(false);
  });

  it("Retry repeats the failed read's immutable snapshot exactly, read-only, and invalidation clears it", async () => {
    const { read, calls } = scriptedDue();
    const stream = createDueStream(read, { ...CLOCK, statusFilter: "new_only", topic: "weather", limit: 3 });
    void stream.loadNextPage();
    calls[0]!.settle.resolve(duePage(["m1"], "c1"));
    await vi.waitFor(() => expect(stream.getSnapshot().cursor).toBe("c1"));
    void stream.loadNextPage();
    calls[1]!.settle.reject(new Error("read failed"));
    await vi.waitFor(() => expect(stream.getSnapshot().failedRead).not.toBeNull());
    const failed = stream.getSnapshot().failedRead!;
    expect(failed).toMatchObject({ kind: "page", cursor: "c1" });
    expect(Object.isFrozen(failed.options)).toBe(true);
    expect(stream.getSnapshot().rows.map((r) => r.materialId)).toEqual(["m1"]);
    void stream.retryRead();
    expect(calls[2]!.input).toEqual(calls[1]!.input);
    calls[2]!.settle.reject(new Error("again"));
    await vi.waitFor(() => expect(stream.getSnapshot().failedRead).not.toBeNull());
    stream.invalidate();
    expect(stream.getSnapshot()).toMatchObject({ rows: [], failedRead: null, error: null, cursor: null, lastPageSummary: null });
    await stream.retryRead();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("dispose blocks late publication; activating again (StrictMode) starts cleanly", async () => {
    const { read, calls } = scriptedDue();
    const stream = createDueStream(read, { ...CLOCK, statusFilter: "all" });
    void stream.loadNextPage();
    stream.dispose();
    calls[0]!.settle.resolve(duePage(["late"], null));
    await Promise.resolve();
    expect(stream.getSnapshot().rows).toEqual([]);
    await stream.loadNextPage();
    expect(read).toHaveBeenCalledTimes(1);
    stream.activate();
    void stream.loadNextPage();
    calls[1]!.settle.resolve(duePage(["live"], null));
    await vi.waitFor(() => expect(stream.getSnapshot().rows.map((r) => r.materialId)).toEqual(["live"]));
  });

  it("caught up only when traversal is exhausted with no rows and no blocked issues", async () => {
    const { read, calls } = scriptedDue();
    const stream = createDueStream(read, { ...CLOCK, statusFilter: "all" });
    expect(stream.isCaughtUp).toBe(false);
    void stream.loadNextPage();
    calls[0]!.settle.resolve(duePage([], "c1", [oversize("huge")]));
    await vi.waitFor(() => expect(stream.getSnapshot().pagesLoaded).toBe(1));
    expect(stream.isCaughtUp).toBe(false);
    void stream.loadNextPage();
    calls[1]!.settle.resolve(duePage([], null, [oversize("huge")]));
    await vi.waitFor(() => expect(stream.getSnapshot().isComplete).toBe(true));
    expect(stream.getSnapshot().issues).toHaveLength(1); // retained and de-duplicated across pages
    expect(stream.isCaughtUp).toBe(false);
    stream.invalidate();
    void stream.loadNextPage();
    calls[2]!.settle.resolve(duePage([], null));
    await vi.waitFor(() => expect(stream.isCaughtUp).toBe(true));
  });
});

/* ------------------------------------------------------------------ */

const event = (id: string, materialId: string, versionId: string, contentStatus: LibraryRecentReviewEntry["contentStatus"], o: Partial<LibraryRecentReviewEntry> = {}): LibraryRecentReviewEntry => ({
  id,
  itemId: `${id}-item`,
  materialId,
  materialTitle: materialId,
  topic: "general",
  versionId,
  contentHash: "h",
  ordinal: 0,
  front: "F",
  back: "B",
  sourcePage: null,
  rating: "good",
  reviewedAt: CLOCK.nowUtc,
  schedulerVersion: "simple-v1",
  priorStateRaw: null,
  nextStateRaw: null,
  priorState: null,
  nextState: null,
  priorSchedule: null,
  nextSchedule: null,
  step: 0,
  dueAt: null,
  intervalDays: 1,
  intervalMinutes: 1440,
  intervalLabel: "1d",
  isEarlierVersion: contentStatus === "pending" ? null : contentStatus !== "current",
  contentStatus,
  currentVersionId: contentStatus === "current" ? versionId : null,
  blockedReason: contentStatus === "pending" ? "budget_exceeded" : null,
  inspectionTarget: null,
  ...o,
});

const historyResult = (rows: LibraryRecentReviewEntry[], next: string | null, enrichment: LibraryRecentReviewsResult["enrichment"] = null): LibraryRecentReviewsResult => ({
  rows,
  next,
  pendingMaterialIds: pendingHistoryTargets(rows),
  enrichment,
  summary: { eventsReturned: rows.length, rawReads: 1, rawBytesTransferred: 5, attemptedCards: 1, evaluatedCards: 1, maxBatchCardsBudget: 2500, maxBatchRawJsonBytesBudget: 2097152, isPageLocal: true },
});

function scriptedHistory() {
  const calls: { input: LibraryRecentReviewsInput; settle: ReturnType<typeof deferred<LibraryRecentReviewsResult>> }[] = [];
  const read = vi.fn((input: LibraryRecentReviewsInput) => {
    const settle = deferred<LibraryRecentReviewsResult>();
    calls.push({ input, settle });
    return settle.promise;
  });
  return { read, calls };
}

describe("[c2] history enrichment", () => {
  it("patches only targets: readable identity compares per event, pending stays unknown, resolution clears blockers", () => {
    const rows = [
      event("e1", "a", "v-old", "pending"),
      event("e2", "a", "v-new", "pending"),
      event("e3", "b", "v-b", "current"),
      event("e4", "c", "v-c", "pending", { blockedReason: "oversize", inspectionTarget: "/study/c" }),
    ];
    const patched = applyHistoryEnrichment(rows, [
      { materialId: "a", contentStatus: "current", currentVersionId: "v-new", reason: null, inspectionTarget: null },
      { materialId: "c", contentStatus: "pending", currentVersionId: null, reason: "oversize", inspectionTarget: "/study/c" },
    ]);
    expect(patched.map((r) => [r.id, r.contentStatus, r.isEarlierVersion, r.blockedReason])).toEqual([
      ["e1", "earlier", true, null],
      ["e2", "current", false, null],
      ["e3", "current", false, null],
      ["e4", "pending", null, "oversize"],
    ]);
    expect(patched[2]).toBe(rows[2]); // untargeted row untouched
    expect(pendingHistoryTargets(patched)).toEqual([]); // oversize is never retried automatically
  });

  it("enrichment works after pagination ends, keeps event order and cursor, and leaves unresolved targets for the next call", async () => {
    const { read, calls } = scriptedHistory();
    const stream = createHistoryStream(read, { materialId: null, topic: null, limit: 20 });
    void stream.loadNextPage();
    const rows = Array.from({ length: 260 }, (_, i) => event(`e${String(i).padStart(3, "0")}`, `m${i}`, `v${i}`, "pending"));
    calls[0]!.settle.resolve(historyResult(rows, null));
    await vi.waitFor(() => expect(stream.getSnapshot().isComplete).toBe(true));
    expect(stream.pendingTargets()).toHaveLength(260);
    void stream.enrichPending();
    expect(calls[1]!.input).toMatchObject({ enrichmentOnly: true, limit: 0 });
    expect(calls[1]!.input.enrichMaterialIds).toHaveLength(250);
    // This call resolves only the first 100 of its 250 targets; the rest stay pending.
    calls[1]!.settle.resolve(
      historyResult([], null, [
        ...Array.from({ length: 100 }, (_, i) => ({ materialId: `m${i}`, contentStatus: "current" as const, currentVersionId: `v${i}`, reason: null, inspectionTarget: null })),
        ...Array.from({ length: 150 }, (_, i) => ({ materialId: `m${100 + i}`, contentStatus: "pending" as const, currentVersionId: null, reason: "budget_exceeded", inspectionTarget: null })),
      ]),
    );
    await vi.waitFor(() => expect(stream.getSnapshot().enrichmentCalls).toBe(1));
    const state = stream.getSnapshot();
    expect(state.rows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(state.cursor).toBeNull();
    expect(state.lastEnrichmentSummary).not.toBeNull();
    expect(state.pagesLoaded).toBe(1);
    expect(stream.pendingTargets()).toHaveLength(160);
    expect(stream.pendingTargets()[0]).toBe("m100");
  });

  it("the most recent live failure is the one retried, in either order, and success clears it", async () => {
    const { read, calls } = scriptedHistory();
    const stream = createHistoryStream(read, { materialId: null, topic: null, limit: 1 });
    void stream.loadNextPage();
    calls[0]!.settle.resolve(historyResult([event("e1", "a", "v1", "pending")], "c1"));
    await vi.waitFor(() => expect(stream.getSnapshot().pagesLoaded).toBe(1));
    void stream.enrichPending();
    calls[1]!.settle.reject(new Error("enrich failed"));
    await vi.waitFor(() => expect(stream.getSnapshot().failedRead?.kind).toBe("enrich"));
    void stream.loadNextPage();
    calls[2]!.settle.reject(new Error("page failed"));
    await vi.waitFor(() => expect(stream.getSnapshot().failedRead?.kind).toBe("page"));
    void stream.retryRead();
    expect(calls[3]!.input).toEqual(calls[2]!.input);
    expect(calls[3]!.input.cursor).toBe("c1");
    calls[3]!.settle.resolve(historyResult([event("e2", "b", "v2", "current")], null));
    await vi.waitFor(() => expect(stream.getSnapshot().failedRead).toBeNull());
    expect(stream.getSnapshot().rows.map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("an obsolete enrichment failure cannot poison the live lock or retry state", async () => {
    const { read, calls } = scriptedHistory();
    const stream = createHistoryStream(read, { materialId: null, topic: null, limit: 20 });
    void stream.loadNextPage();
    calls[0]!.settle.resolve(historyResult([event("e1", "a", "v1", "pending")], null));
    await vi.waitFor(() => expect(stream.getSnapshot().pagesLoaded).toBe(1));
    void stream.enrichPending();
    stream.invalidate({ topic: "weather" });
    void stream.loadNextPage();
    calls[1]!.settle.reject(new Error("old enrichment failed"));
    await Promise.resolve();
    expect(stream.getSnapshot()).toMatchObject({ failedRead: null, error: null, loading: "page" });
    calls[2]!.settle.resolve(historyResult([], null));
    await vi.waitFor(() => expect(stream.getSnapshot().loading).toBeNull());
    expect(calls[2]!.input.topic).toBe("weather");
  });
});
