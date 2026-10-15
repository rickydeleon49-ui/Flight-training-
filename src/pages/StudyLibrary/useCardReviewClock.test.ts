// @vitest-environment jsdom
/**
 * Material-level relearning readiness: `useCardReviewClock` renders when the
 * earliest future Again card of the shown snapshot becomes due, and on focus
 * or return to a visible window. Fake `Date` and timers, an injected clock
 * that can drift from the timers, synthetic snapshots; no real waits. The
 * last block drives `useCardReview` over an in-memory repository to prove a
 * clock render reads, writes, starts and advances nothing.
 */
import { createElement, StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardReviewError } from "@/data/persistenceErrors";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import type { CardItemAction, CardQueueEntry, CardReviewItemState, CardReviewSnapshot } from "@/domain/types";

import { useCardReview, type CardReviewClock } from "./useCardReview";
import { EARLY_RETRY_DELAY, MAX_CLOCK_DELAY, nextAgainDueAt, useCardReviewClock } from "./useCardReviewClock";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = "2026-10-06T15:00:00.000Z";
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** Added to the fake `Date` by the injected clock: the clock can move without the timers. */
let drift: number;
const clock: CardReviewClock = {
  now: () => new Date(Date.now() + drift).toISOString(),
  timeZone: () => "America/Chicago",
  newOperationId: () => crypto.randomUUID(),
};
let visibility: DocumentVisibilityState;

const state = (patch: Partial<CardReviewItemState>): CardReviewItemState => ({
  revision: 1,
  step: -1,
  dueAt: null,
  lastReviewedAt: T0,
  reps: 1,
  lapses: 1,
  suspended: false,
  flag: null,
  ...patch,
});

function snapshot(states: Record<string, CardReviewItemState>, items = ["a", "b", "c"], materialId = "m1"): CardReviewSnapshot {
  return {
    materialId,
    generation: 0,
    current: {
      status: "ok",
      versionId: `${materialId}-v1`,
      contentHash: `${materialId}-hash`,
      items: items.map((itemId, ordinal) => ({ itemId, ordinal, front: `front ${itemId}`, back: `back ${itemId}`, sourcePage: null })),
    },
    states,
  };
}

const again = (minutes: number) => state({ dueAt: at(T0, minutes * MINUTE) });

function mountClock(initial: CardReviewSnapshot | null, owner = "m1", wrapper?: (props: { children: ReactNode }) => ReactNode) {
  let renders = 0;
  const view = renderHook(
    ({ snap, key }: { snap: CardReviewSnapshot | null; key: string }) => {
      renders += 1;
      return useCardReviewClock(snap, clock, key);
    },
    { initialProps: { snap: initial, key: owner }, wrapper },
  );
  return { ...view, renders: () => renders };
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const focus = () => act(() => void window.dispatchEvent(new Event("focus")));
const setVisibility = (next: DocumentVisibilityState) =>
  act(() => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  });

beforeEach(() => {
  drift = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("nextAgainDueAt", () => {
  it("picks the earliest future Again instant among current, reviewable cards only", () => {
    const snap = snapshot(
      {
        a: again(30),
        b: again(10),
        c: state({ dueAt: at(T0, 5 * MINUTE), suspended: true }),
        d: state({ dueAt: at(T0, 6 * MINUTE), flag: "unclear" }),
        e: state({ dueAt: at(T0, 7 * MINUTE), step: 0 }),
        f: state({ dueAt: null, step: -1 }),
        g: again(-1),
        old: again(2), // a state for a card that is not in the current version
      },
      ["a", "b", "c", "d", "e", "f", "g", "h"],
    );
    expect(nextAgainDueAt(snap, T0)).toBe(at(T0, 10 * MINUTE));
    expect(nextAgainDueAt(snap, at(T0, 10 * MINUTE))).toBe(at(T0, 30 * MINUTE)); // strictly after now
    expect(nextAgainDueAt(snap, at(T0, 30 * MINUTE))).toBeNull();
    expect(nextAgainDueAt(null, T0)).toBeNull();
    expect(nextAgainDueAt({ ...snap, current: { status: "none" } }, T0)).toBeNull();
    expect(nextAgainDueAt({ ...snap, current: { status: "malformed" } }, T0)).toBeNull();
  });
});

describe("useCardReviewClock", () => {
  it("renders exactly at the Again instant, not a millisecond before, with one owned timer", () => {
    const view = mountClock(snapshot({ a: again(10) }));
    expect(vi.getTimerCount()).toBe(1);
    const before = view.renders();
    advance(10 * MINUTE - 1);
    expect(view.renders()).toBe(before);
    expect(view.result.current).toBe(0);
    advance(1);
    expect(view.result.current).toBe(1);
    expect(view.renders()).toBe(before + 1);
    expect(vi.getTimerCount()).toBe(0); // nothing later to wait for
    advance(DAY);
    expect(view.renders()).toBe(before + 1); // no polling
  });

  it("after each deadline schedules only the next future deadline", () => {
    const view = mountClock(snapshot({ a: again(10), b: again(25), c: again(25) }));
    advance(10 * MINUTE);
    expect(view.result.current).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    advance(15 * MINUTE - 1);
    expect(view.result.current).toBe(1);
    advance(1);
    expect(view.result.current).toBe(2); // two cards at the same instant: one render
    expect(vi.getTimerCount()).toBe(0);
  });

  it("paused, flagged, day-ladder, new, past and earlier-version cards create no wakeup", () => {
    const view = mountClock(
      snapshot(
        {
          a: state({ dueAt: at(T0, 5 * MINUTE), suspended: true }),
          b: state({ dueAt: at(T0, 5 * MINUTE), flag: "wrong_answer" }),
          c: state({ dueAt: at(T0, 5 * MINUTE), step: 0 }),
          d: again(-5),
          old: again(5),
        },
        ["a", "b", "c", "d", "e"],
      ),
    );
    expect(vi.getTimerCount()).toBe(0);
    const before = view.renders();
    advance(DAY);
    expect(view.renders()).toBe(before);
  });

  it("a timer that fires before its instant (clock moved back) waits at least a second, with no loop", () => {
    const view = mountClock(snapshot({ a: again(10) }));
    drift = -1; // the clock is one millisecond behind the timers
    advance(10 * MINUTE);
    expect(view.result.current).toBe(1); // a render with the current clock, still not due
    expect(vi.getTimerCount()).toBe(1);
    advance(EARLY_RETRY_DELAY - 1);
    expect(view.result.current).toBe(1);
    drift = -EARLY_RETRY_DELAY - 1; // still 1 ms behind: the retry also waits a full second
    advance(1);
    expect(view.result.current).toBe(2);
    advance(EARLY_RETRY_DELAY - 1);
    expect(view.result.current).toBe(2);
    drift = 0;
    advance(1);
    expect(view.result.current).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stopped clock never fires faster than once a second", () => {
    const frozen = Date.now() + 10 * MINUTE - 1;
    const view = mountClock(snapshot({ a: again(10) }));
    vi.spyOn(clock, "now").mockImplementation(() => new Date(frozen).toISOString());
    advance(10 * MINUTE + 10 * EARLY_RETRY_DELAY);
    expect(view.result.current).toBeLessThanOrEqual(11);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("caps very long waits below the browser's timer limit and re-arms when it fires early", () => {
    const view = mountClock(snapshot({ a: again(40 * 24 * 60) }));
    advance(MAX_CLOCK_DELAY - 1);
    expect(view.result.current).toBe(0);
    advance(1);
    expect(view.result.current).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("delayed visible resume renders with the current clock and aims at the next future deadline", () => {
    const view = mountClock(snapshot({ a: again(10), b: again(40) }));
    drift = 20 * MINUTE; // the computer slept: the clock moved, the timer did not fire
    const before = view.renders();
    setVisibility("hidden");
    expect(view.renders()).toBe(before); // hiding alone does nothing
    setVisibility("visible");
    expect(view.result.current).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    advance(20 * MINUTE - 1); // now 40 minutes by the clock, minus 1 ms
    expect(view.result.current).toBe(1);
    advance(1);
    expect(view.result.current).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("focus after the clock moved back re-aims the timer at the later remaining wait", () => {
    const view = mountClock(snapshot({ a: again(10) }));
    drift = -30 * MINUTE;
    focus();
    expect(view.result.current).toBe(1);
    advance(10 * MINUTE);
    expect(view.result.current).toBe(1); // the old 10-minute timer was replaced
    advance(30 * MINUTE - 1);
    expect(view.result.current).toBe(1);
    advance(1);
    expect(view.result.current).toBe(2);
  });

  it("repeated focus and visibility events keep exactly one timer", () => {
    const view = mountClock(snapshot({ a: again(10) }));
    for (let i = 0; i < 5; i += 1) {
      focus();
      setVisibility("visible");
    }
    expect(vi.getTimerCount()).toBe(1);
    expect(view.result.current).toBe(10);
    advance(10 * MINUTE);
    expect(view.result.current).toBe(11);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new snapshot replaces the timer; a null snapshot or another owner clears it", () => {
    const first = snapshot({ a: again(10) });
    const view = mountClock(first);
    view.rerender({ snap: snapshot({ a: again(20) }), key: "m1" });
    expect(vi.getTimerCount()).toBe(1);
    advance(10 * MINUTE);
    expect(view.result.current).toBe(0);
    view.rerender({ snap: null, key: "m2" });
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ snap: snapshot({ x: state({ dueAt: at(T0, DAY), step: 0 }) }, ["x"], "m2"), key: "m2" });
    expect(vi.getTimerCount()).toBe(0);
    const before = view.renders();
    advance(DAY);
    expect(view.renders()).toBe(before);
  });

  it("unmount removes the timer and both listeners; later events render nothing", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = mountClock(snapshot({ a: again(10) }));
    const before = view.renders();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const focusAdds = add.mock.calls.filter(([type]) => type === "focus").length;
    expect(remove.mock.calls.filter(([type]) => type === "focus").length).toBe(focusAdds);
    focus();
    setVisibility("visible");
    advance(DAY);
    expect(view.renders()).toBe(before);
  });

  it("StrictMode leaves one timer and one focus listener; one event renders once", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = mountClock(snapshot({ a: again(10) }), "m1", ({ children }) => createElement(StrictMode, null, children));
    expect(vi.getTimerCount()).toBe(1);
    const net = add.mock.calls.filter(([type]) => type === "focus").length - remove.mock.calls.filter(([type]) => type === "focus").length;
    expect(net).toBe(1);
    focus();
    expect(view.result.current).toBe(1);
    advance(10 * MINUTE);
    expect(view.result.current).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* useCardReview: clock renders are display only                      */
/* ------------------------------------------------------------------ */

function fakeRepository(initial: CardReviewSnapshot) {
  const calls: string[] = [];
  let current = initial;
  let saveOutcome: "ok" | "unknown" = "ok";
  const saved: CardItemAction[] = [];
  const repository = {
    getCardReviewSnapshot: async () => {
      calls.push("snapshot");
      return current;
    },
    getRecentReviews: async () => {
      calls.push("recent");
      return { rows: [], next: null };
    },
    getDueQueue: async (input: { nowUtc: string; currentItemIds: string[] }): Promise<CardQueueEntry[]> => {
      calls.push("queue");
      const entries: CardQueueEntry[] = [];
      input.currentItemIds.forEach((itemId, ordinal) => {
        const s = current.states[itemId];
        if (s && s.step < 0 && s.dueAt !== null && s.dueAt <= input.nowUtc && !s.suspended && !s.flag) entries.push({ itemId, kind: "again", dueAt: s.dueAt, ordinal });
        else if (!s) entries.push({ itemId, kind: "new", dueAt: null, ordinal });
      });
      return entries;
    },
    saveAction: async (action: CardItemAction) => {
      calls.push("save");
      saved.push(structuredClone(action));
      if (saveOutcome === "unknown") throw new Error("connection lost");
      return { action: "rate", itemId: action.itemId, dueAt: at(T0, DAY) };
    },
    getOperationStatus: async () => {
      calls.push("status");
      throw new CardReviewError("NOT_READY");
    },
  };
  return {
    repository: repository as unknown as CardReviewRepository,
    calls,
    saved,
    setSnapshot: (next: CardReviewSnapshot) => (current = next),
    failSaves: () => (saveOutcome = "unknown"),
  };
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

describe("useCardReview clock renders", () => {
  it("re-render the controller at the instant and read, write, start or advance nothing", async () => {
    // Card a is new, b is Again in 10 minutes, c is a day card.
    const repo = fakeRepository(snapshot({ b: again(10), c: state({ step: 0, dueAt: at(T0, 2 * DAY) }) }));
    let renders = 0;
    const view = renderHook(() => {
      renders += 1;
      return useCardReview("m1", repo.repository, { clock });
    });
    await flush();
    expect(view.result.current.read.phase).toBe("ready");

    await act(async () => void view.result.current.startSession());
    await flush();
    expect(view.result.current.session?.cards.map((card) => card.itemId)).toEqual(["a"]);
    act(() => view.result.current.reveal());

    repo.failSaves();
    act(() => view.result.current.rate("good"));
    await flush();
    expect(view.result.current.pending?.status).toBe("unknown");
    const operationId = view.result.current.pending!.action.operationId;
    const before = {
      calls: [...repo.calls],
      session: view.result.current.session,
      revealed: view.result.current.revealed,
      pending: view.result.current.pending,
      recent: view.result.current.recent,
      read: view.result.current.read,
      locked: view.result.current.locked,
      notice: view.result.current.notice,
      resetPending: view.result.current.resetPending,
    };
    const rendersBefore = renders;

    await act(async () => void (await vi.advanceTimersByTimeAsync(10 * MINUTE)));
    focus();
    setVisibility("visible");

    expect(renders).toBeGreaterThan(rendersBefore);
    expect(repo.calls).toEqual(before.calls);
    const now = view.result.current;
    expect(now.session).toBe(before.session);
    expect(now.revealed).toBe(true);
    expect(now.pending).toBe(before.pending);
    expect(now.recent).toBe(before.recent);
    expect(now.read).toBe(before.read);
    expect(now.locked).toBe(before.locked);
    expect(now.notice).toBe(before.notice);
    expect(now.resetPending).toBe(before.resetPending);

    // Try again still resends the very same operation.
    await act(async () => void now.tryAgain());
    await flush();
    expect(repo.saved.map((action) => action.operationId)).toEqual([operationId, operationId]);
  });

  it("deliberate start after the instant takes a fresh snapshot and queue and selects the due card", async () => {
    const repo = fakeRepository(snapshot({ a: again(10), b: state({ step: 0, dueAt: at(T0, DAY) }), c: state({ step: 0, dueAt: at(T0, DAY) }) }));
    const view = renderHook(() => useCardReview("m1", repo.repository, { clock }));
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(10 * MINUTE)));
    expect(repo.calls).toEqual(["snapshot", "recent"]);
    expect(view.result.current.session).toBeNull(); // never started by the clock
    await act(async () => void view.result.current.startSession());
    await flush();
    expect(repo.calls).toEqual(["snapshot", "recent", "snapshot", "queue"]);
    expect(view.result.current.session?.cards).toEqual([{ itemId: "a", kind: "again", dueAt: at(T0, 10 * MINUTE), ordinal: 0 }]);
  });

  it("switching material clears the old material's wakeup", async () => {
    const one = fakeRepository(snapshot({ a: again(10) }));
    const view = renderHook(({ id }: { id: string }) => useCardReview(id, one.repository, { clock }), { initialProps: { id: "m1" } });
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    one.setSnapshot(snapshot({}, ["x"], "m2"));
    view.rerender({ id: "m2" });
    await flush();
    expect(view.result.current.read.phase).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });
});
