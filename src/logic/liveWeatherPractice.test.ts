import { describe, expect, it } from "vitest";

import { LIVE_METARS, LIVE_TAFS, reportFromRaw } from "./__fixtures__/liveMetars";
import { compareLiveToMinimums, practiceFromLiveReport, STALE_MINUTES } from "./liveWeatherPractice";
import { explainMetar } from "./metarExplain";
import { explainTaf } from "./tafExplain";

const byId = (id: string) => reportFromRaw(LIVE_METARS.find((f) => f.id === id)!.raw);
const NOW_FRESH = Date.UTC(2026, 10, 17, 18, 0); // 7 minutes after kdem 171753Z
const BANNED = /\b(go|no-go|safe|legal|ok to fly)\b/i;
const mins = { ceilingFt: 3000, visibilitySm: 5, windKt: 15 };

describe("fixtures", () => {
  it("has 25-30 METARs and about 5 TAFs", () => {
    expect(LIVE_METARS.length).toBeGreaterThanOrEqual(25);
    expect(LIVE_METARS.length).toBeLessThanOrEqual(34);
    expect(LIVE_TAFS.length).toBe(5);
    expect(new Set(LIVE_METARS.map((f) => f.id)).size).toBe(LIVE_METARS.length);
  });
  it("every fixture decodes and compares without crashing, with no verdict wording", () => {
    for (const f of LIVE_METARS) {
      const live = practiceFromLiveReport(reportFromRaw(f.raw), Date.UTC(2026, 10, 18, 20, 0));
      const cmp = compareLiveToMinimums(mins, live);
      expect(JSON.stringify([live, cmp]), f.id).not.toMatch(BANNED);
      expect(explainMetar(f.raw).tokens.length, f.id).toBeGreaterThan(0);
    }
    for (const f of LIVE_TAFS) expect(() => explainTaf(f.raw), f.id).not.toThrow();
  });
});

describe("practiceFromLiveReport", () => {
  const cases: [string, number | undefined, number, number][] = [
    ["rmk-routine", undefined, 10, 8],
    ["auto-bkn", 2500, 10, 10],
    ["vrb-light", undefined, 10, 3],
    ["variable-dir", undefined, 10, 12],
    ["gusts", 7000, 10, 26],
    ["vis-one-half", 800, 1.5, 5],
    ["p6sm", undefined, 6, 7],
    ["vv-obscured", 100, 0.5, 4],
    ["ovc-cb", 1500, 4, 22],
    ["multi-layer", 4000, 10, 8],
    ["rvr", 300, 0.5, 5],
    ["speci", 2000, 2, 30],
    ["strong-gust", undefined, 10, 35],
    ["snow-shsn", 1800, 2.5, 24],
    ["tenth-vis", 400, 0.75, 7],
    ["overcast-only", 3500, 9, 9],
  ];
  it.each(cases)("%s: ceiling/visibility/wind", (id, ceil, vis, wind) => {
    const p = practiceFromLiveReport(byId(id), NOW_FRESH);
    expect(p.ceilingFt).toBe(ceil);
    expect(p.visibilitySm).toBe(vis);
    expect(p.windKt).toBe(wind);
    expect(p.unknown).toEqual([]);
  });
  it("M1/4SM reads as just under a quarter mile", () => {
    const p = practiceFromLiveReport(byId("vis-quarter"), NOW_FRESH);
    expect(p.visibilitySm).toBeCloseTo(0.25, 2);
    expect(p.visibilitySm!).toBeLessThan(0.25);
    expect(p.ceilingFt).toBe(200);
  });
  it("missing fields are unknown and never inside", () => {
    expect(practiceFromLiveReport(byId("no-vis-group"), NOW_FRESH).unknown).toEqual(["visibility"]);
    expect(practiceFromLiveReport(byId("no-wind-group"), NOW_FRESH).unknown).toEqual(["wind"]);
    expect(practiceFromLiveReport(byId("no-sky-group"), NOW_FRESH).unknown).toEqual(["ceiling"]);
    const c = compareLiveToMinimums(mins, practiceFromLiveReport(byId("no-vis-group"), NOW_FRESH));
    expect(c.comparison.visibilitySm).toBeUndefined();
    expect(c.cantTell.join(" ")).toMatch(/Can't tell the visibility/);
    expect(c.summary).toMatch(/isn't fully compared/);
    expect(c.summary).not.toMatch(/Inside/);
    // Outside still reports outside even when another field is unknown.
    const out = compareLiveToMinimums({ ...mins, windKt: 5 }, practiceFromLiveReport(byId("no-vis-group"), NOW_FRESH));
    expect(out.comparison.windKt).toBe("outside");
    expect(out.summary).toMatch(/Outside/);
  });
  it("an unusable layer base makes the ceiling unknown", () => {
    const r = byId("auto-bkn");
    r.conditions = { ...r.conditions, clouds: [{ cover: "BKN", base: null }] };
    expect(practiceFromLiveReport(r, NOW_FRESH).unknown).toEqual(["ceiling"]);
  });
  it("an empty sky list or VV/// is unknown, never 'no ceiling'", () => {
    const r = byId("auto-bkn");
    r.conditions = { ...r.conditions, clouds: [] };
    const p = practiceFromLiveReport(r, NOW_FRESH);
    expect(p.unknown).toContain("ceiling");
    expect(p.noCeiling).toBeUndefined();
    expect(compareLiveToMinimums(mins, p).comparison.ceilingFt).toBeUndefined();
    const vv = reportFromRaw("METAR KXYZ 171753Z AUTO 27008KT 1/4SM FG VV/// 08/08 A2990");
    vv.conditions = { ...vv.conditions, clouds: [] };
    expect(practiceFromLiveReport(vv, NOW_FRESH).unknown).toContain("ceiling");
  });
  it("a clear sky has no ceiling and counts as inside the ceiling minimum", () => {
    for (const id of ["vrb-light", "p6sm", "calm-few"]) {
      const p = practiceFromLiveReport(byId(id), NOW_FRESH);
      expect(p.noCeiling).toBe(true);
      expect(p.unknown).not.toContain("ceiling");
      expect(compareLiveToMinimums(mins, p).comparison.ceilingFt).toBe("inside");
    }
  });
  it("only names unknowns for minimums the student saved", () => {
    const c = compareLiveToMinimums({ ceilingFt: 3000 }, practiceFromLiveReport(byId("no-vis-group"), NOW_FRESH));
    expect(c.cantTell).toEqual([]);
  });
  it("compares known fields with the saved minimums", () => {
    const c = compareLiveToMinimums(mins, practiceFromLiveReport(byId("ovc-cb"), NOW_FRESH));
    expect(c.comparison).toEqual({ ceilingFt: "outside", visibilitySm: "outside", windKt: "outside" });
    expect(c.summary).toMatch(/Outside/);
  });
  it("flags stale observations after 90 minutes", () => {
    const r = byId("rmk-routine");
    const at = r.reportTime!;
    const fresh = practiceFromLiveReport(r, at + 30 * 60_000);
    expect([fresh.ageMinutes, fresh.stale, fresh.observedAt]).toEqual([30, false, at]);
    expect(practiceFromLiveReport(r, at + STALE_MINUTES * 60_000).stale).toBe(false);
    expect(practiceFromLiveReport(r, at + (STALE_MINUTES + 1) * 60_000).stale).toBe(true);
  });
  it("treats a missing or future time as stale with no age", () => {
    const r = byId("rmk-routine");
    expect(practiceFromLiveReport({ ...r, reportTime: null }, NOW_FRESH)).toMatchObject({ ageMinutes: null, stale: true, observedAt: null });
    expect(practiceFromLiveReport(r, r.reportTime! - 60_000)).toMatchObject({ ageMinutes: null, stale: true });
  });
  it("survives empty conditions", () => {
    const r = { ...byId("rmk-routine"), conditions: {} };
    expect(practiceFromLiveReport(r, NOW_FRESH).unknown).toEqual(["ceiling", "visibility", "wind"]);
  });
  describe("string visibility with a leading M", () => {
    const withVis = (visib: unknown) => ({ ...byId("rmk-routine"), conditions: { ...byId("rmk-routine").conditions, visib } });
    it("M1/4 is below a quarter mile, never unknown", () => {
      const p = practiceFromLiveReport(withVis("M1/4"), NOW_FRESH);
      expect(p.unknown).not.toContain("visibility");
      expect(p.visibilitySm!).toBeLessThan(0.25);
      expect(p.visibilitySm!).toBeGreaterThan(0.2);
    });
    it("counts as outside any minimum of 1/4 SM or more", () => {
      for (const min of [0.25, 1, 3]) {
        const p = practiceFromLiveReport(withVis("M1/4"), NOW_FRESH);
        const c = compareLiveToMinimums({ ...mins, visibilitySm: min }, p);
        expect(c.comparison.visibilitySm).toBe("outside");
      }
    });
    it("still reads plain values and rejects junk", () => {
      expect(practiceFromLiveReport(withVis("1 1/2"), NOW_FRESH).visibilitySm).toBe(1.5);
      expect(practiceFromLiveReport(withVis("10+"), NOW_FRESH).visibilitySm).toBe(10);
      expect(practiceFromLiveReport(withVis("M"), NOW_FRESH).unknown).toContain("visibility");
      expect(practiceFromLiveReport(withVis("M0"), NOW_FRESH).unknown).toContain("visibility");
    });
  });
});
