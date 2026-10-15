// @vitest-environment jsdom
/**
 * Review due local-day recovery in `useLibraryDueStream`: the midnight timer,
 * focus and return to a visible window re-check the computer's current local
 * day, and only a changed boundary starts the stream over. Fake clock and
 * timers, injected zone and a controllable in-memory reader; no real waits.
 */
import { createElement, StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardLibraryRepository } from "@/data/repositories/cardLibraryRepository";
import type { LibraryReviewDueInput, LibraryReviewDueResult, LibraryReviewMaterialEntry } from "@/domain/types";
import * as localDay from "@/logic/localDay";

import { useLibraryDueStream, type DueViewFilters } from "./useLibraryReviews";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

const T0 = "2026-10-06T15:00:00.000Z"; // 10:00 in Chicago, 05:00 on 7 October in Kiritimati
const CHICAGO = "America/Chicago";
const KIRITIMATI = "Pacific/Kiritimati";
const CHICAGO_END = "2026-10-07T05:00:00.000Z";
const KIRITIMATI_END = "2026-10-07T10:00:00.000Z";

interface Call {
  input: LibraryReviewDueInput;
  resolve(result: LibraryReviewDueResult): void;
  reject(error: unknown): void;
}

let zone: string;
let calls: Call[];
let visibility: DocumentVisibilityState;

const repository = {
  readReviewDue: (input: LibraryReviewDueInput) =>
    new Promise<LibraryReviewDueResult>((resolve, reject) => calls.push({ input: structuredClone(input), resolve, reject })),
  readRecentReviews: () => Promise.reject(new Error("History is not part of these tests")),
} as unknown as CardLibraryRepository;

const entry = (id: string): LibraryReviewMaterialEntry => ({
  materialId: id,
  title: id,
  topic: "weather",
  priority: "later",
  updatedAt: T0,
  cardCount: 1,
  againCount: 0,
  dayCount: 1,
  newCount: 0,
  totalDueCount: 1,
  retainedCardCount: 1,
  earliestDueAt: T0,
});

function page(ids: string[], nextCursor: string | null = null): LibraryReviewDueResult {
  return {
    materials: ids.map(entry),
    nextCursor,
    issues: [],
    summary: {
      scannedCandidates: ids.length,
      evaluatedCandidates: ids.length,
      attemptedCards: ids.length,
      evaluatedCards: ids.length,
      rawReads: 1,
      rawBytesTransferred: 0,
      actionableCount: ids.length,
      againCount: 0,
      dayCount: ids.length,
      totalDueCount: ids.length,
      newCount: 0,
      isComplete: nextCursor === null,
      isPageLocal: true,
      issues: [],
    },
  };
}

const ALL: DueViewFilters = { statusFilter: "all", topic: null };

function mount(filters: DueViewFilters = ALL, strict = false) {
  return renderHook(({ f, revision }: { f: DueViewFilters; revision: number }) => useLibraryDueStream(repository, f, revision, 2), {
    initialProps: { f: filters, revision: 0 },
    wrapper: strict ? ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children) : undefined,
  });
}

/** Let settled reads publish. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const resolveCall = async (n: number, result: LibraryReviewDueResult) => {
  calls[n]!.resolve(result);
  await flush();
};
const rejectCall = async (n: number, error: unknown = new Error("synthetic read failure")) => {
  calls[n]!.reject(error);
  await flush();
};
const focus = () => act(() => void window.dispatchEvent(new Event("focus")));
const setVisibility = (next: DocumentVisibilityState) =>
  act(() => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  });
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const lastInput = () => calls[calls.length - 1]!.input;

beforeEach(() => {
  calls = [];
  zone = CHICAGO;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(localDay, "currentTimeZone").mockImplementation(() => zone);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("focus and visibility recovery", () => {
  it("a zone change is recovered on focus: page one, null cursor, a fresh clock and the current filters", async () => {
    const filters: DueViewFilters = { statusFilter: "due_today", topic: "weather" };
    const { result } = mount(filters);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toEqual({ nowUtc: T0, nextLocalMidnightUtc: CHICAGO_END, statusFilter: "due_today", topic: "weather", limit: 2, cursor: null });
    await resolveCall(0, page(["a", "b"], "c1"));
    void act(() => void result.current.stream.loadNextPage());
    await resolveCall(1, page(["c"], "c2"));
    expect(result.current.state.pagesLoaded).toBe(2);
    const generation = result.current.state.generation;

    vi.setSystemTime(new Date(at(T0, 5 * 60_000)));
    zone = KIRITIMATI;
    await focus();
    expect(calls).toHaveLength(3);
    expect(lastInput()).toEqual({
      nowUtc: at(T0, 5 * 60_000),
      nextLocalMidnightUtc: KIRITIMATI_END,
      statusFilter: "due_today",
      topic: "weather",
      limit: 2,
      cursor: null,
    });
    const s = result.current.state;
    expect(s.generation).toBeGreaterThan(generation);
    expect(s).toMatchObject({ rows: [], cursor: null, pagesLoaded: 0, isComplete: false, loading: "page", failedRead: null });
    await resolveCall(2, page(["k"]));
    expect(result.current.state.rows.map((r) => r.materialId)).toEqual(["k"]);
    expect(result.current.state.options.nextLocalMidnightUtc).toBe(KIRITIMATI_END);
  });

  it("returning to a visible window recovers a zone change in the other direction", async () => {
    zone = KIRITIMATI;
    const { result } = mount();
    await resolveCall(0, page(["due-in-kiritimati"]));
    zone = CHICAGO;
    await setVisibility("visible");
    expect(calls).toHaveLength(2);
    expect(lastInput()).toMatchObject({ nextLocalMidnightUtc: CHICAGO_END, cursor: null });
    await resolveCall(1, page([]));
    expect(result.current.state.rows).toEqual([]);
    expect(result.current.stream.isCaughtUp).toBe(true);
  });

  it("unchanged-boundary notifications keep loaded pages, cursor and the failed read, and read nothing", async () => {
    const { result } = mount();
    await resolveCall(0, page(["a", "b"], "c1"));
    void act(() => void result.current.stream.loadNextPage());
    await rejectCall(1);
    const before = result.current.state;
    expect(before).toMatchObject({ pagesLoaded: 1, cursor: "c1", loading: null });
    expect(before.failedRead).toMatchObject({ kind: "page", cursor: "c1" });

    await focus();
    await setVisibility("visible");
    await focus();
    vi.setSystemTime(new Date(at(T0, 3 * HOUR))); // later the same local day
    await focus();
    await setVisibility("visible");
    expect(calls).toHaveLength(2);
    expect(result.current.state).toBe(before);

    // Retry still repeats exactly the failed read.
    void act(() => void result.current.stream.retryRead());
    expect(calls).toHaveLength(3);
    expect(calls[2]!.input).toEqual(calls[1]!.input);
  });

  it("hidden-state notifications alone start no read", async () => {
    mount();
    await resolveCall(0, page(["a"]));
    zone = KIRITIMATI;
    await setVisibility("hidden");
    await setVisibility("hidden");
    expect(calls).toHaveLength(1);
    await setVisibility("visible");
    expect(calls).toHaveLength(2);
  });

  it("paired focus and visibility notifications refresh once, together or one after the other", async () => {
    mount();
    await resolveCall(0, page(["a"]));
    zone = KIRITIMATI;
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls).toHaveLength(2);

    await resolveCall(1, page(["k"]));
    zone = CHICAGO;
    await setVisibility("visible");
    await focus();
    expect(calls).toHaveLength(3);
    await resolveCall(2, page([]));
    expect(calls).toHaveLength(3);
  });
});

describe("midnight timer", () => {
  it("rolls over at local midnight once, re-arms for the next day, and does not loop", async () => {
    vi.setSystemTime(new Date("2026-10-07T04:59:00.000Z")); // 23:59 in Chicago
    mount();
    expect(calls[0]!.input.nextLocalMidnightUtc).toBe(CHICAGO_END);
    await resolveCall(0, page(["a"]));
    expect(vi.getTimerCount()).toBe(1);
    await advance(60_000);
    expect(calls).toHaveLength(1);
    await advance(1_000);
    expect(calls).toHaveLength(2);
    expect(lastInput()).toMatchObject({ nowUtc: "2026-10-07T05:00:01.000Z", nextLocalMidnightUtc: "2026-10-08T05:00:00.000Z", cursor: null });
    await resolveCall(1, page(["b"]));
    expect(vi.getTimerCount()).toBe(1);
    await advance(DAY - 1);
    expect(calls).toHaveLength(2);
    await advance(1);
    expect(calls).toHaveLength(3);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-10-09T05:00:00.000Z");
    await resolveCall(2, page(["c"]));
    await advance(12 * HOUR);
    expect(calls).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a timer delayed by sleep catches up once with the current clock and aims at the next midnight from now", async () => {
    mount();
    await resolveCall(0, page(["a"]));
    // Asleep: the wall clock jumps almost three days while the timer, armed
    // for 14 h 1 s, has not fired. It fires 14 h 1 s later, at 15:00:01Z on 9 October.
    vi.setSystemTime(new Date(at(T0, 3 * DAY - 14 * HOUR)));
    await act(() => void vi.runOnlyPendingTimers());
    expect(calls).toHaveLength(2);
    expect(lastInput()).toMatchObject({ nowUtc: "2026-10-09T15:00:01.000Z", nextLocalMidnightUtc: "2026-10-10T05:00:00.000Z", cursor: null });
    await resolveCall(1, page(["b"]));
    expect(vi.getTimerCount()).toBe(1);
    const untilNext = Date.parse("2026-10-10T05:00:01.000Z") - Date.now();
    await advance(untilNext - 1);
    expect(calls).toHaveLength(2);
    await advance(1);
    expect(calls).toHaveLength(3);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-10-11T05:00:00.000Z");
  });

  it("focus after sleep recovers and replaces the stale timer, which then cannot read again", async () => {
    mount();
    await resolveCall(0, page(["a"]));
    vi.setSystemTime(new Date(at(T0, 3 * DAY + 5 * HOUR))); // 15:00 on 9 October in Chicago
    await focus();
    expect(calls).toHaveLength(2);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-10-10T05:00:00.000Z");
    await resolveCall(1, page(["b"]));
    expect(vi.getTimerCount()).toBe(1);
    await act(() => void vi.runOnlyPendingTimers()); // the re-armed timer fires at 2026-10-10T05:00:01Z
    expect(calls).toHaveLength(3);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-10-11T05:00:00.000Z");
  });

  it("backward day movement is recovered on focus with the earlier boundary", async () => {
    mount();
    await resolveCall(0, page(["a"]));
    vi.setSystemTime(new Date(at(T0, -DAY)));
    await focus();
    expect(calls).toHaveLength(2);
    expect(lastInput()).toMatchObject({ nowUtc: at(T0, -DAY), nextLocalMidnightUtc: "2026-10-06T05:00:00.000Z", cursor: null });
    await resolveCall(1, page([]));
    expect(vi.getTimerCount()).toBe(1);
    await advance(Date.parse("2026-10-06T05:00:01.000Z") - Date.now());
    expect(calls).toHaveLength(3);
    expect(lastInput().nextLocalMidnightUtc).toBe(CHICAGO_END);
  });

  it("a timer that fires while the clock is earlier the same day reads nothing and stays armed", async () => {
    mount();
    await resolveCall(0, page(["a"]));
    vi.setSystemTime(new Date(at(T0, -2 * HOUR)));
    await act(() => void vi.runOnlyPendingTimers());
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await advance(Date.parse(CHICAGO_END) + 1_000 - Date.now());
    expect(calls).toHaveLength(2);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-10-08T05:00:00.000Z");
  });

  it("follows a 23-hour local day exactly", async () => {
    vi.setSystemTime(new Date("2026-03-08T05:59:00.000Z")); // 23:59 on 7 March in Chicago
    mount();
    await resolveCall(0, page([]));
    await advance(61_000);
    expect(calls).toHaveLength(2);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-03-09T05:00:00.000Z"); // clocks went forward
    await resolveCall(1, page([]));
    await advance(23 * HOUR - 1);
    expect(calls).toHaveLength(2);
    await advance(1);
    expect(calls).toHaveLength(3);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-03-10T05:00:00.000Z");
  });

  it("follows a 25-hour local day exactly", async () => {
    vi.setSystemTime(new Date("2026-11-01T04:59:00.000Z")); // 23:59 on 31 October in Chicago
    mount();
    await resolveCall(0, page([]));
    await advance(61_000);
    expect(calls).toHaveLength(2);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-11-02T06:00:00.000Z"); // clocks went back
    await resolveCall(1, page([]));
    await advance(25 * HOUR - 1);
    expect(calls).toHaveLength(2);
    await advance(1);
    expect(calls).toHaveLength(3);
    expect(lastInput().nextLocalMidnightUtc).toBe("2026-11-03T06:00:00.000Z");
  });
});

describe("obsolete reads after recovery", () => {
  it("an older success arriving first cannot publish rows, cursor or completion", async () => {
    const { result } = mount();
    zone = KIRITIMATI;
    await focus();
    expect(calls).toHaveLength(2);
    await resolveCall(0, page(["stale"], "stale-cursor"));
    expect(result.current.state).toMatchObject({ rows: [], cursor: null, isComplete: false, pagesLoaded: 0, loading: "page" });
    await resolveCall(1, page(["fresh"]));
    expect(result.current.state).toMatchObject({ cursor: null, isComplete: true, pagesLoaded: 1, loading: null });
    expect(result.current.state.rows.map((r) => r.materialId)).toEqual(["fresh"]);
  });

  it("an older success arriving last changes nothing", async () => {
    const { result } = mount();
    zone = KIRITIMATI;
    await focus();
    await resolveCall(1, page(["fresh"]));
    const settled = result.current.state;
    await resolveCall(0, page(["stale"], "stale-cursor"));
    expect(result.current.state).toBe(settled);
  });

  it("an older failure records no error and does not release the newer read's lock", async () => {
    const { result } = mount();
    zone = KIRITIMATI;
    await focus();
    await rejectCall(0);
    expect(result.current.state).toMatchObject({ error: null, failedRead: null, loading: "page" });
    void act(() => void result.current.stream.loadNextPage());
    expect(calls).toHaveLength(2); // still the recovery read in flight
    await resolveCall(1, page(["fresh"]));
    await rejectCall(0); // a repeated late settlement is harmless too
    expect(result.current.state).toMatchObject({ error: null, failedRead: null, loading: null });
    expect(result.current.state.rows.map((r) => r.materialId)).toEqual(["fresh"]);
  });

  it("an older failure arriving after the recovery read finished changes nothing", async () => {
    const { result } = mount();
    zone = KIRITIMATI;
    await focus();
    await resolveCall(1, page(["fresh"]));
    const settled = result.current.state;
    await rejectCall(0);
    expect(result.current.state).toBe(settled);
  });

  it("recovers from an old failed read: the descriptor is dropped and page one is read", async () => {
    const { result } = mount();
    await resolveCall(0, page(["a"], "c1"));
    void act(() => void result.current.stream.loadNextPage());
    await rejectCall(1);
    expect(result.current.state.failedRead).not.toBeNull();
    zone = KIRITIMATI;
    await focus();
    expect(calls).toHaveLength(3);
    expect(lastInput()).toMatchObject({ nextLocalMidnightUtc: KIRITIMATI_END, cursor: null });
    expect(result.current.state).toMatchObject({ error: null, failedRead: null, pagesLoaded: 0 });
    void act(() => void result.current.stream.retryRead()); // nothing left to retry
    expect(calls).toHaveLength(3);
    await resolveCall(2, page(["k"]));
    expect(result.current.state.rows.map((r) => r.materialId)).toEqual(["k"]);
  });

  it("a filter change during recovery wins, and a later recovery keeps the newest filters", async () => {
    const { result, rerender } = mount();
    await resolveCall(0, page(["a"]));
    zone = KIRITIMATI;
    await focus();
    expect(lastInput()).toMatchObject({ statusFilter: "all", topic: null, nextLocalMidnightUtc: KIRITIMATI_END });
    rerender({ f: { statusFilter: "new_only", topic: "navigation" }, revision: 0 });
    expect(calls).toHaveLength(3);
    expect(lastInput()).toMatchObject({ statusFilter: "new_only", topic: "navigation", nextLocalMidnightUtc: KIRITIMATI_END, cursor: null });
    await resolveCall(1, page(["stale-recovery"]));
    expect(result.current.state.rows).toEqual([]);
    await resolveCall(2, page(["navigation"]));
    expect(result.current.state.rows.map((r) => r.materialId)).toEqual(["navigation"]);

    rerender({ f: { statusFilter: "due_today", topic: "weather" }, revision: 0 });
    await resolveCall(3, page(["weather"]));
    zone = CHICAGO;
    await setVisibility("visible");
    expect(calls).toHaveLength(5);
    expect(lastInput()).toMatchObject({ statusFilter: "due_today", topic: "weather", nextLocalMidnightUtc: CHICAGO_END, cursor: null });
  });

  it("Check again still captures a fresh clock and reads page one", async () => {
    const { result } = mount();
    await resolveCall(0, page(["a"]));
    vi.setSystemTime(new Date(at(T0, 10 * 60_000)));
    act(() => result.current.refresh());
    expect(calls).toHaveLength(2);
    expect(lastInput()).toMatchObject({ nowUtc: at(T0, 10 * 60_000), nextLocalMidnightUtc: CHICAGO_END, cursor: null });
  });
});

describe("ownership", () => {
  it("unmount removes the listeners and the timer; later events read nothing", async () => {
    const { unmount } = mount();
    await resolveCall(0, page(["a"]));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    zone = KIRITIMATI;
    vi.setSystemTime(new Date(at(T0, 3 * DAY)));
    await focus();
    await setVisibility("visible");
    await advance(3 * DAY);
    expect(calls).toHaveLength(1);
  });

  it("StrictMode leaves one live listener set and one timer", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const { unmount } = mount(ALL, true);
    const mountReads = calls.length;
    for (let i = 0; i < mountReads; i++) calls[i]!.resolve(page(["a"]));
    await flush();
    const focusListeners = () =>
      added.mock.calls.filter(([type]) => type === "focus").length - removed.mock.calls.filter(([type]) => type === "focus").length;
    expect(focusListeners()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    zone = KIRITIMATI;
    await focus();
    await setVisibility("visible");
    expect(calls).toHaveLength(mountReads + 1);
    unmount();
    expect(focusListeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
