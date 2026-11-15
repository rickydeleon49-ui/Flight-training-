import { describe, expect, it } from "vitest";
import {
  E6B_PRACTICE,
  fuelForTime,
  timeForFuel,
  timeSpeedDistance,
  trueToMagnetic,
  windTriangle,
} from "./e6b";

describe("windTriangle", () => {
  it("crosswind from the right", () => {
    expect(windTriangle(90, 100, 180, 20)).toEqual({ ok: true, wcaDegrees: 12, trueHeading: 102, groundSpeed: 98 });
  });
  it("pure headwind and tailwind", () => {
    expect(windTriangle(360, 100, 360, 20)).toMatchObject({ wcaDegrees: 0, trueHeading: 360, groundSpeed: 80 });
    expect(windTriangle(90, 100, 270, 20)).toMatchObject({ wcaDegrees: 0, groundSpeed: 120 });
  });
  it("wind from the left gives a left correction", () => {
    expect(windTriangle(90, 100, 360, 20)).toMatchObject({ wcaDegrees: -12, trueHeading: 78 });
  });
  it("wraps heading through north", () => {
    expect(windTriangle(355, 100, 85, 20)).toMatchObject({ wcaDegrees: 12, trueHeading: 7 });
  });
  it("friendly errors, no NaN", () => {
    for (const r of [windTriangle(NaN, 100, 180, 20), windTriangle(90, 100, 180, 100), windTriangle(90, 100, 180, 120), windTriangle(90, 0, 180, 0), windTriangle(400, 100, 180, 5)]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });
});

describe("timeSpeedDistance", () => {
  it("solves each unknown", () => {
    expect(timeSpeedDistance(150, 100, NaN)).toMatchObject({ solved: "time", timeMinutes: 90 });
    expect(timeSpeedDistance(NaN, 120, 45)).toMatchObject({ solved: "distance", distanceNm: 90 });
    expect(timeSpeedDistance(75, NaN, 30)).toMatchObject({ solved: "speed", speedKt: 150 });
  });
  it("rejects bad input", () => {
    expect(timeSpeedDistance(NaN, NaN, 30).ok).toBe(false);
    expect(timeSpeedDistance(10, 10, 10).ok).toBe(false);
    expect(timeSpeedDistance(10, 0, NaN).ok).toBe(false);
  });
});

describe("fuel", () => {
  it("burn and endurance", () => {
    expect(fuelForTime(8.5, 150)).toMatchObject({ ok: true, fuelGallons: 21.3 });
    expect(timeForFuel(9, 30)).toMatchObject({ ok: true, timeMinutes: 200 });
    expect(fuelForTime(0, 30).ok).toBe(false);
    expect(timeForFuel(NaN, 30).ok).toBe(false);
  });
});

describe("trueToMagnetic", () => {
  it("east is least, west is best", () => {
    expect(trueToMagnetic(102, 5, "E")).toEqual({ ok: true, magneticHeading: 97 });
    expect(trueToMagnetic(102, 5, "W")).toEqual({ ok: true, magneticHeading: 107 });
    expect(trueToMagnetic(3, 10, "E")).toEqual({ ok: true, magneticHeading: 353 });
    expect(trueToMagnetic(355, 10, "W")).toEqual({ ok: true, magneticHeading: 5 });
    expect(trueToMagnetic(10, 10, "E")).toEqual({ ok: true, magneticHeading: 360 });
    expect(trueToMagnetic(10, 99, "E").ok).toBe(false);
  });
});

describe("practice problems", () => {
  it("answers match the math", () => {
    const [wind, tsd, fuel] = E6B_PRACTICE;
    const w = windTriangle(90, 100, 180, 20);
    const m = trueToMagnetic(102, 5, "E");
    expect(w).toMatchObject({ wcaDegrees: 12, trueHeading: 102, groundSpeed: 98 });
    expect(m).toMatchObject({ magneticHeading: 97 });
    expect(wind!.answer).toContain("12 degrees right");
    expect(wind!.answer).toContain("true heading 102");
    expect(wind!.answer).toContain("98 kt");
    expect(wind!.answer).toContain("097");
    expect(timeSpeedDistance(150, 100, NaN)).toMatchObject({ timeMinutes: 90 });
    expect(tsd!.answer).toContain("90 minutes");
    expect(fuelForTime(8.5, 150)).toMatchObject({ fuelGallons: 21.3 });
    expect(fuel!.answer).toContain("21.3");
  });
});
