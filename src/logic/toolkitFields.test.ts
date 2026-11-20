import { describe, expect, it } from "vitest";
import { defaultToolkitState, normalizeToolkitState } from "./toolkit";
import { MOCK_LAST_CAP, BOOKMARK_CAP, normalizeMockTest, normalizeQuestionBookmarks } from "./mockTestState";
import { ORAL_RATING_CAP, normalizeOralRatings } from "./oralRatings";
import { NAV_LEG_CAP, NAV_LOG_CAP, normalizeNavLogs } from "./savedNavLogs";
import { updateToolkit } from "@/state/toolkitUpdate";

const run = (over: Record<string, unknown> = {}) => ({
  questionIds: ["a", "b", "c"],
  answers: { a: "x", zz: "y" },
  flags: ["b", "nope"],
  index: 1,
  startedAt: "2026-11-19T10:00:00.000Z",
  deadline: "2026-11-19T12:30:00.000Z",
  ...over,
});
const leg = { tc: 90, distanceNm: 20, tas: 100, windDir: 270, windSpeed: 10, variation: 5, side: "E", deviation: 0, gph: 8 };

describe("mock test state", () => {
  it("drops bad shapes and answers for unknown questions", () => {
    expect(normalizeMockTest("x")).toBeUndefined();
    expect(normalizeMockTest({ current: run({ questionIds: [] }) })).toBeUndefined();
    const s = normalizeMockTest({ current: run(), last: [run(), run({ finishedAt: "2026-11-19T11:00:00.000Z" }), 5] })!;
    expect(s.current?.answers).toEqual({ a: "x" });
    expect(s.current?.flags).toEqual(["b"]);
    expect(s.last).toHaveLength(1);
  });
  it("caps history and round trips", () => {
    const done = run({ finishedAt: "2026-11-19T11:00:00.000Z" });
    const s = normalizeMockTest({ last: Array.from({ length: 9 }, () => done) })!;
    expect(s.last).toHaveLength(MOCK_LAST_CAP);
    expect(normalizeMockTest(s)).toEqual(s);
    const withCurrent = normalizeMockTest({ current: run() })!;
    expect(normalizeMockTest(withCurrent)).toEqual(withCurrent);
  });
  it("bookmarks: drops bad, dedupes, caps", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ questionId: `q${i}`, materialId: "m" }));
    const out = normalizeQuestionBookmarks([...many, { questionId: "q0", materialId: "m" }, { questionId: "" }, 3])!;
    expect(out).toHaveLength(BOOKMARK_CAP);
    expect(normalizeQuestionBookmarks(out)).toEqual(out);
    expect(normalizeQuestionBookmarks([{ a: 1 }])).toBeUndefined();
  });
});

describe("oral ratings", () => {
  const good = { scenarioId: "s", title: "T", rating: "Needs work", area: "PA.I", date: "2026-11-19" };
  it("drops bad, keeps newest over the cap, round trips", () => {
    expect(normalizeOralRatings([{ ...good, rating: "Great" }, { ...good, date: "x" }, null])).toBeUndefined();
    const out = normalizeOralRatings(Array.from({ length: ORAL_RATING_CAP + 5 }, (_, i) => ({ ...good, scenarioId: `s${i}` })))!;
    expect(out).toHaveLength(ORAL_RATING_CAP);
    expect(out.at(-1)?.scenarioId).toBe(`s${ORAL_RATING_CAP + 4}`);
    expect(normalizeOralRatings(out)).toEqual(out);
  });
});

describe("saved nav logs", () => {
  it("drops bad legs and logs, applies caps, round trips", () => {
    const log = (i: number) => ({
      id: `n${i}`, name: "Trip", aircraft: "C172", reserveMinutes: 45,
      legs: [...Array.from({ length: 15 }, () => leg), { ...leg, side: "N" }, { ...leg, tc: "x" }],
    });
    const out = normalizeNavLogs([...Array.from({ length: 12 }, (_, i) => log(i)), { name: "no id" }])!;
    expect(out).toHaveLength(NAV_LOG_CAP);
    expect(out[0]?.legs).toHaveLength(NAV_LEG_CAP);
    expect(normalizeNavLogs(out)).toEqual(out);
    expect(normalizeNavLogs("x")).toBeUndefined();
  });
});

describe("toolkit state wiring", () => {
  it("leaves old state unchanged: no new keys, version 1", () => {
    const state = defaultToolkitState();
    const out = normalizeToolkitState(state);
    expect(out).toEqual(state);
    for (const k of ["mockTest", "questionBookmarks", "oralRatings", "navLogs"]) expect(k in out).toBe(false);
    expect(out.version).toBe(1);
  });
  it("keeps good new fields and removes bad ones", () => {
    const good = normalizeToolkitState({ ...defaultToolkitState(), mockTest: { current: run() }, navLogs: [{ id: "n", name: "A", legs: [leg] }] });
    expect(good.mockTest?.current?.questionIds).toEqual(["a", "b", "c"]);
    expect(good.navLogs).toHaveLength(1);
    const bad = normalizeToolkitState({ ...defaultToolkitState(), mockTest: 5, oralRatings: "x" });
    expect("mockTest" in bad).toBe(false);
    expect("oralRatings" in bad).toBe(false);
    expect(good.version).toBe(1);
  });
});

describe("updateToolkit", () => {
  it("changes the latest saved copy and keeps a field another caller wrote", async () => {
    let stored = defaultToolkitState();
    const repos = { toolkit: { get: async () => stored, save: async (s: typeof stored) => { stored = s; return s; } } };
    const mutate = (async (work: (r: typeof repos) => Promise<unknown>) => work(repos)) as never;
    const stale = defaultToolkitState();
    stored = { ...stored, oralRatings: [{ scenarioId: "s", title: "T", rating: "Satisfactory", area: "PA.I", date: "2026-11-19" }] };
    await updateToolkit(mutate, (t) => ({ ...t, checkrideDate: "2027-01-01" }));
    expect(stale.oralRatings).toBeUndefined();
    expect(stored.oralRatings).toHaveLength(1);
    expect(stored.checkrideDate).toBe("2027-01-01");
  });
});
