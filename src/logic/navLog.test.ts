import { expect, it } from "vitest";

import {
  generateDiversion,
  generateLeg,
  generateReserveScenario,
  generateTrip,
  gradeNavLogBox,
  navLogTotals,
  normalizeHeading,
  reserveFor,
  reserveSentence,
  solveDiversion,
  solveLeg,
  solveReserve,
  type NavLogLeg,
} from "./navLog";

const base: NavLogLeg = { tc: 90, distanceNm: 50, tas: 100, windDir: 180, windSpeed: 20, variation: 5, side: "E", deviation: 0, gph: 8 };

it("chains WCA, TH, MH, CH, GS, ETE and fuel (east variation)", () => {
  const s = solveLeg(base)!;
  expect(s).toMatchObject({ wca: 12, th: 102, mh: 97, ch: 97, gs: 98 });
  expect(s.ete).toBe(31);
  expect(s.fuel).toBe(4.1);
});

it("adds west variation and applies signed deviation", () => {
  expect(solveLeg({ ...base, side: "W" })!.mh).toBe(107);
  expect(solveLeg({ ...base, deviation: 3 })!.ch).toBe(100);
  expect(solveLeg({ ...base, deviation: -4 })!.ch).toBe(93);
});

it("wraps headings through 360, never 0", () => {
  expect(normalizeHeading(0)).toBe(360);
  expect(normalizeHeading(363)).toBe(3);
  const s = solveLeg({ ...base, tc: 358, windSpeed: 0, variation: 5, side: "W" })!;
  expect(s.th).toBe(358);
  expect(s.mh).toBe(3);
  expect(solveLeg({ ...base, tc: 358, windSpeed: 0, variation: 0, deviation: 2 })!.ch).toBe(360);
});

it("totals distance, ETE and fuel", () => {
  const a = solveLeg(base)!;
  const t = navLogTotals([base, base]);
  expect(t.distanceNm).toBe(100);
  expect(t.ete).toBe(a.ete * 2);
  expect(t.fuel).toBeCloseTo(a.fuel * 2, 5);
});

it("generates the same legs for the same seed, inside the ranges", () => {
  expect(generateLeg(7)).toEqual(generateLeg(7));
  expect(generateTrip(7, 3)).toEqual(generateTrip(7, 3));
  for (let seed = 1; seed <= 300; seed++) {
    const l = generateLeg(seed);
    expect(l.tc).toBeGreaterThanOrEqual(1);
    expect(l.tc).toBeLessThanOrEqual(360);
    expect(l.tas).toBeGreaterThanOrEqual(90);
    expect(l.tas).toBeLessThanOrEqual(130);
    expect(l.windSpeed).toBeLessThanOrEqual(30);
    expect(l.variation).toBeGreaterThanOrEqual(0);
    expect(l.variation).toBeLessThanOrEqual(20);
    expect(Math.abs(l.deviation)).toBeLessThanOrEqual(4);
    expect(l.distanceNm).toBeGreaterThanOrEqual(20);
    expect(l.distanceNm).toBeLessThanOrEqual(80);
    expect(l.gph).toBeGreaterThanOrEqual(7);
    expect(l.gph).toBeLessThanOrEqual(12);
    expect(solveLeg(l)).not.toBeNull();
  }
  expect(generateTrip(1, 1)).toHaveLength(2);
  expect(generateTrip(1, 9)).toHaveLength(4);
});

it("grades right, close, wrong and empty with a how line", () => {
  expect(gradeNavLogBox("mh", "097", 97, base).status).toBe("right");
  expect(gradeNavLogBox("mh", "99", 97, base).status).toBe("close");
  const w = gradeNavLogBox("mh", "107", 97, base);
  expect(w.status).toBe("wrong");
  expect(w.message).toContain("MH = TH − east variation");
  expect(gradeNavLogBox("th", "2", 360, base).status).toBe("close");
  expect(gradeNavLogBox("wca", "-12", 12, base).status).toBe("wrong");
  expect(gradeNavLogBox("ete", "", 31, base).status).toBe("empty");
});

it("diversion solution matches solveLeg and is deterministic", () => {
  const d = generateDiversion(7);
  expect(generateDiversion(7)).toEqual(d);
  const leg = solveLeg(d.leg)!;
  const sol = solveDiversion(d)!;
  expect(sol).toMatchObject({ th: leg.th, mh: leg.mh, gs: leg.gs, ete: leg.ete, fuelUsed: leg.fuel });
  expect(sol.fuelLeft).toBeCloseTo(d.fuelOnBoard - leg.fuel, 5);
  expect(sol.fuelLeft).toBeGreaterThan(0);
  expect(gradeNavLogBox("gs", String(sol.gs), sol.gs, d.leg).status).toBe("right");
});

it("reserve gallons: 30 minutes by day, 45 at night", () => {
  expect(reserveFor(9, false)).toEqual({ minutes: 30, gallons: 4.5 });
  expect(reserveFor(9, true)).toEqual({ minutes: 45, gallons: 6.8 });
});

it("reserve scenario is deterministic and shows covered and short cases with the right words", () => {
  expect(generateReserveScenario(11)).toEqual(generateReserveScenario(11));
  const seen = new Set<boolean>();
  for (let seed = 1; seed <= 200; seed++) {
    const sc = generateReserveScenario(seed);
    expect(sc.legs.length).toBeGreaterThanOrEqual(2);
    expect(sc.legs.length).toBeLessThanOrEqual(3);
    const sol = solveReserve(sc);
    expect(sol.fuelLeft).toBeGreaterThan(0);
    seen.add(sol.covers);
    const text = reserveSentence(sol, sc.night);
    if (sol.covers) expect(text).toMatch(/covers the (30-minute day|45-minute night) reserve \(14 CFR 91\.151\)\./);
    else expect(text).toMatch(/is less than the (30-minute day|45-minute night) reserve \(14 CFR 91\.151\)\. Talk through fuel planning with your instructor\./);
    expect(text).not.toMatch(/\b(safe|legal|go)\b/i);
  }
  expect(seen.size).toBe(2);
});
