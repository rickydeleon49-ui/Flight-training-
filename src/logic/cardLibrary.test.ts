/**
 * M2-4 / C2 pure rules: limits, inspection routes, strict context-owned
 * cursors, schedule ownership, C1-consistent due/new counting and urgency
 * ranking.
 */
import { describe, expect, it } from "vitest";

import {
  CardLibraryReadError,
  compareUrgency,
  decodeCursor,
  encodeCursor,
  evaluateDueCounts,
  getStudyInspectionTarget,
  matchesDueFilter,
  parseBoundedInteger,
  validateDueCursor,
  validateHistoryCursor,
  validateScheduleState,
  type ItemStateRow,
  type RankedMaterial,
} from "./cardLibrary";

const NOW = "2026-10-06T16:00:00.000Z";
const MIDNIGHT = "2026-10-07T05:00:00.000Z";
const CTX = { topic: null, statusFilter: "all" as const, nowUtc: NOW, nextLocalMidnightUtc: MIDNIGHT };
const due = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  type: "due",
  remIds: ["a", "b"],
  lc: "m-1",
  lp: 1,
  lu: "2026-10-05T10:00:00.000Z",
  isExhausted: false,
  ctx: { ...CTX },
  ...overrides,
});
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    if (error instanceof CardLibraryReadError) return error.code;
    throw error;
  }
};

describe("[c2] inputs and routes", () => {
  it("bounded integers take the default for unusable values and clamp usable ones", () => {
    expect(parseBoundedInteger(undefined, 50, 1, 250)).toBe(50);
    expect(parseBoundedInteger("7", 50, 1, 250)).toBe(50);
    expect(parseBoundedInteger(-3, 50, 1, 250)).toBe(50);
    expect(parseBoundedInteger(Number.NaN, 50, 1, 250)).toBe(50);
    expect(parseBoundedInteger(0, 50, 1, 250)).toBe(1);
    expect(parseBoundedInteger(9.9, 50, 1, 250)).toBe(9);
    expect(parseBoundedInteger(10_000, 50, 1, 250)).toBe(250);
  });

  it("inspection targets are the registered Study route, encoded", () => {
    expect(getStudyInspectionTarget("a/b")).toBe("/study/a%2Fb");
    expect(getStudyInspectionTarget("a b?c#é")).toBe("/study/a%20b%3Fc%23%C3%A9");
  });
});

describe("[c2] cursors", () => {
  it("round-trip as canonical base64 and refuse anything that is not exactly that", () => {
    const cursor = encodeCursor(due());
    expect(decodeCursor(cursor)).toEqual(due());
    expect(encodeCursor({ b: 1, a: 2 })).toBe(encodeCursor({ a: 2, b: 1 }));
    for (const bad of ["", "not base64!", "e30", "QR==", "WzFd", btoa("null"), "x".repeat(32_772), 7]) {
      expect(code(() => decodeCursor(bad)), String(bad).slice(0, 20)).toBe("INVALID_CURSOR");
    }
    expect(decodeCursor(null)).toBeNull();
  });

  it("validate the complete due shape before any SQL, then context ownership", () => {
    expect(code(() => validateDueCursor(due(), CTX))).toBe("ok");
    const shape: Record<string, unknown>[] = [
      due({ v: 2 }),
      due({ type: "history" }),
      due({ isExhausted: "no" }),
      due({ remIds: "a" }),
      due({ remIds: ["a", "a"] }),
      due({ remIds: [""] }),
      due({ remIds: ["x".repeat(65)] }),
      due({ remIds: Array.from({ length: 251 }, (_, i) => `id-${i}`) }),
      due({ lc: "" }),
      due({ lp: 2 }),
      due({ lp: "1" }),
      due({ lu: "x".repeat(65) }),
      due({ ctx: null }),
      due({ ctx: { ...CTX, extra: 1 } }),
      { ...due(), extra: true },
    ];
    for (const raw of shape) expect(code(() => validateDueCursor(raw, CTX)), JSON.stringify(raw).slice(0, 80)).toBe("INVALID_CURSOR");
    const { lc: _lc, ...missing } = due();
    void _lc;
    expect(code(() => validateDueCursor(missing, CTX))).toBe("INVALID_CURSOR");
    for (const changed of [
      { ...CTX, topic: "weather" },
      { ...CTX, statusFilter: "due_today" as const },
      { ...CTX, nowUtc: "2026-10-06T16:00:00.001Z" },
      { ...CTX, nextLocalMidnightUtc: "2026-10-08T05:00:00.000Z" },
    ]) {
      expect(code(() => validateDueCursor(due(), changed))).toBe("STALE_CURSOR");
    }
  });

  it("validate the history shape: canonical instant, bounded id, owned filters", () => {
    const history = (o: Record<string, unknown> = {}) => ({
      v: 1,
      type: "history",
      t: NOW,
      id: "e-1",
      ctx: { materialId: null, topic: null },
      ...o,
    });
    expect(code(() => validateHistoryCursor(history(), { materialId: null, topic: null }))).toBe("ok");
    for (const raw of [
      history({ t: "2026-10-06T16:00:00Z" }),
      history({ t: "2026-02-30T00:00:00.000Z" }),
      history({ id: "" }),
      history({ id: "x".repeat(65) }),
      history({ type: "due" }),
      history({ ctx: { materialId: null } }),
      { ...history(), extra: 1 },
    ]) {
      expect(code(() => validateHistoryCursor(raw, { materialId: null, topic: null }))).toBe("INVALID_CURSOR");
    }
    expect(code(() => validateHistoryCursor(history(), { materialId: "m", topic: null }))).toBe("STALE_CURSOR");
  });
});

describe("[c2] schedule validation owned by the event's scheduler version", () => {
  const state = JSON.stringify({ schedulerVersion: "simple-v1", step: 2, dueAt: MIDNIGHT, lastReviewedAt: NOW, reps: 3, lapses: 0 });

  it("derives interval fields only for a supported, valid state", () => {
    expect(validateScheduleState(state, "simple-v1").schedule).toMatchObject({ step: 2, intervalDays: 7, intervalLabel: "7d", reps: 3 });
    expect(validateScheduleState(JSON.stringify({ step: -1 }), "simple-v1").schedule).toMatchObject({ intervalMinutes: 10, intervalLabel: "10m" });
  });

  it("an unsupported version yields no schedule while the parsed audit stays; a versionless state inherits only simple-v1", () => {
    const foreign = validateScheduleState(state, "fsrs-6");
    expect(foreign.schedule).toBeNull();
    expect(foreign.parsed).toMatchObject({ step: 2 });
    expect(validateScheduleState(JSON.stringify({ step: 0 }), null).schedule).toBeNull();
    expect(validateScheduleState(JSON.stringify({ step: 0, schedulerVersion: "fsrs-6" }), "simple-v1").schedule).toBeNull();
  });

  it("refuses non-canonical dates, bad counts and out-of-ladder steps", () => {
    for (const bad of [
      { step: 0, dueAt: "2026-02-30T00:00:00.000Z" },
      { step: 0, reps: -1 },
      { step: 0, lapses: 1.5 },
      { step: 8 },
      { step: -2 },
      { step: "0" },
    ]) {
      expect(validateScheduleState(JSON.stringify(bad), "simple-v1").schedule).toBeNull();
    }
    expect(validateScheduleState("not json", "simple-v1")).toEqual({ parsed: null, schedule: null });
    expect(validateScheduleState("[]", "simple-v1")).toEqual({ parsed: null, schedule: null });
  });
});

describe("[c2] due/new counting follows the C1 queue", () => {
  const states = new Map<string, ItemStateRow>([
    ["again-due", { step: -1, dueAt: at(NOW, -60_000), suspended: false, flagged: false }],
    ["again-later", { step: -1, dueAt: at(NOW, 60_000), suspended: false, flagged: false }],
    ["again-exact", { step: -1, dueAt: NOW, suspended: false, flagged: false }],
    ["day-due", { step: 0, dueAt: at(MIDNIGHT, -1), suspended: false, flagged: false }],
    ["day-boundary", { step: 0, dueAt: MIDNIGHT, suspended: false, flagged: false }],
    ["rated-suspended", { step: 0, dueAt: at(NOW, -1), suspended: true, flagged: false }],
    ["rated-flagged", { step: 0, dueAt: at(NOW, -1), suspended: false, flagged: true }],
    ["new-suspended", { step: -1, dueAt: null, suspended: true, flagged: false }],
    ["new-resumed", { step: -1, dueAt: null, suspended: false, flagged: false }],
  ]);
  function at(iso: string, ms: number) {
    return new Date(Date.parse(iso) + ms).toISOString();
  }

  it("counts exact Again instants, the exclusive local boundary, and excludes paused or flagged cards", () => {
    const counts = evaluateDueCounts([...states.keys(), "untouched"], states, NOW, MIDNIGHT);
    expect(counts).toEqual({
      cardCount: 10,
      againCount: 2,
      dayCount: 1,
      totalDueCount: 3,
      newCount: 2,
      retainedCardCount: 9,
      earliestDueAt: at(NOW, -60_000),
    });
  });

  it("filters: mixed materials match all and due_today, never new_only", () => {
    expect(matchesDueFilter({ totalDueCount: 1, newCount: 2 }, "all")).toBe(true);
    expect(matchesDueFilter({ totalDueCount: 1, newCount: 2 }, "due_today")).toBe(true);
    expect(matchesDueFilter({ totalDueCount: 1, newCount: 2 }, "new_only")).toBe(false);
    expect(matchesDueFilter({ totalDueCount: 0, newCount: 2 }, "new_only")).toBe(true);
    expect(matchesDueFilter({ totalDueCount: 0, newCount: 0 }, "all")).toBe(false);
  });

  it("ranks Again, then day, then new; ties by Next Up, earliest due, title, then id", () => {
    const make = (o: Partial<RankedMaterial>): RankedMaterial => ({
      materialId: "x",
      title: "T",
      priority: "later",
      cardCount: 1,
      againCount: 0,
      dayCount: 0,
      totalDueCount: 0,
      newCount: 1,
      retainedCardCount: 0,
      earliestDueAt: null,
      ...o,
    });
    const list = [
      make({ materialId: "new-b", title: "B" }),
      make({ materialId: "new-a", title: "B" }),
      make({ materialId: "new-next", title: "Z", priority: "next_up" }),
      make({ materialId: "day-late", dayCount: 1, totalDueCount: 1, earliestDueAt: "2026-10-06T10:00:00.000Z" }),
      make({ materialId: "day-early", dayCount: 1, totalDueCount: 1, earliestDueAt: "2026-10-05T10:00:00.000Z" }),
      make({ materialId: "again", againCount: 1, totalDueCount: 1, earliestDueAt: NOW }),
      make({ materialId: "upper", title: "a" }),
      make({ materialId: "lower", title: "A" }),
    ];
    expect([...list].sort(compareUrgency).map((m) => m.materialId)).toEqual([
      "again",
      "day-early",
      "day-late",
      "new-next",
      "lower",
      "new-a",
      "new-b",
      "upper",
    ]);
  });
});
