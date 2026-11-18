import { describe, expect, it } from "vitest";
import {
  E6B_PRACTICE,
  e6bExpected,
  gradeE6bAnswer,
  summarizeE6bGrades,
  type E6bAnswerId,
  formatMinutes,
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
  it("allows a tailwind at or above airspeed, rejects a crosswind that cannot be held", () => {
    expect(windTriangle(90, 100, 270, 120)).toMatchObject({ ok: true, wcaDegrees: 0, groundSpeed: 220 });
    expect(windTriangle(90, 100, 270, 100)).toMatchObject({ ok: true, groundSpeed: 200 });
    expect(windTriangle(90, 100, 180, 120).ok).toBe(false);
    expect(windTriangle(90, 100, 90, 120).ok).toBe(false);
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
    expect(fuelForTime(10, 0.4)).toMatchObject({ ok: true, timeMinutes: 0.4 });
    expect(timeSpeedDistance(1, 150, NaN)).toMatchObject({ ok: true, timeMinutes: 0.4 });
    expect(formatMinutes(0.4)).toBe("under 1 min");
    expect(formatMinutes(75)).toBe("1 h 15 min");
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

describe("E6B answer checking", () => {
  const [wind, tsd, fuel] = E6B_PRACTICE;
  const wExp = e6bExpected(wind!);
  const grade = (id: E6bAnswerId, value: string, side?: "L" | "R", p = wind!, e = wExp) =>
    gradeE6bAnswer(id, { value, side }, p, e);

  it("uses the trainer arithmetic for expected values", () => {
    expect(wExp).toEqual({ wca: 12, trueHeading: 102, groundSpeed: 98, magneticHeading: 97 });
    expect(e6bExpected(tsd!)).toEqual({ time: 90 });
    expect(e6bExpected(fuel!)).toEqual({ fuel: 21.3 });
  });

  it("grades right, close, wrong and empty by tolerance", () => {
    expect(grade("trueHeading", "102").status).toBe("right");
    expect(grade("trueHeading", "104").status).toBe("close");
    expect(grade("trueHeading", "105").status).toBe("wrong");
    expect(grade("trueHeading", "").status).toBe("empty");
    expect(grade("groundSpeed", "96").message).toMatch(/answer is 98 kt/);
    expect(grade("groundSpeed", "95").status).toBe("wrong");
    expect(gradeE6bAnswer("time", { value: "91" }, tsd!, e6bExpected(tsd!)).status).toBe("close");
    expect(gradeE6bAnswer("time", { value: "92" }, tsd!, e6bExpected(tsd!)).status).toBe("wrong");
    const fe = e6bExpected(fuel!);
    expect(gradeE6bAnswer("fuel", { value: "21.3" }, fuel!, fe).status).toBe("right");
    expect(gradeE6bAnswer("fuel", { value: "21.8" }, fuel!, fe).status).toBe("close");
    expect(gradeE6bAnswer("fuel", { value: "22" }, fuel!, fe).status).toBe("wrong");
  });

  it("treats L/R mismatch on the wind correction angle as not quite", () => {
    expect(grade("wca", "12", "R").status).toBe("right");
    expect(grade("wca", "13", "R").status).toBe("close");
    expect(grade("wca", "12", "L").status).toBe("wrong");
    expect(grade("wca", "12").message).toMatch(/Pick left or right/);
  });

  it("gives a short hint for the value that was missed", () => {
    expect(grade("magneticHeading", "107").message).toMatch(/East is least: subtract east variation/);
    expect(grade("trueHeading", "200").message).toMatch(/add right, subtract left/);
  });

  it("wraps headings through north and summarizes", () => {
    expect(gradeE6bAnswer("trueHeading", { value: "1" }, wind!, { trueHeading: 360 }).status).toBe("close");
    expect(summarizeE6bGrades([{ status: "right", message: "" }, { status: "empty", message: "" }, { status: "wrong", message: "" }])).toBe("1 right, 0 close, 1 to fix");
  });
});
