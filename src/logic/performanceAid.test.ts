import { describe, expect, it } from "vitest";

import { densityAltitude, pressureAltitude, runwayHeading, windComponents } from "./performanceAid";

describe("windComponents", () => {
  it("runway 36, wind 030/20", () => {
    const w = windComponents(36, 30, 20)!;
    expect(w.crosswind).toBe(10);
    expect(w.headwind).toBe(17);
    expect(w.side).toBe("right");
  });
  it("wind from the left", () => {
    expect(windComponents(36, 330, 20)!.side).toBe("left");
  });
  it("tailwind is negative", () => {
    expect(windComponents(9, 270, 10)).toEqual({ crosswind: 0, headwind: -10, side: "none" });
  });
  it("direct crosswind and wrap-around", () => {
    expect(windComponents(1, 100, 15)).toMatchObject({ crosswind: 15, headwind: 0, side: "right" });
    expect(windComponents(360, 10, 10)!.headwind).toBe(10);
  });
  it("accepts degrees", () => {
    expect(windComponents(90, 90, 12)!.headwind).toBe(12);
  });
  it("rejects invalid input", () => {
    expect(windComponents(0, 30, 10)).toBeNull();
    expect(windComponents(37.5, 30, 10)).not.toBeNull();
    expect(windComponents(400, 30, 10)).toBeNull();
    expect(windComponents(36, 400, 10)).toBeNull();
    expect(windComponents(36, 30, -1)).toBeNull();
    expect(windComponents(NaN, 30, 10)).toBeNull();
  });
});

describe("runwayHeading", () => {
  it("converts runway numbers", () => {
    expect(runwayHeading(27)).toBe(270);
    expect(runwayHeading(180)).toBe(180);
  });
});

describe("density altitude", () => {
  it("pressure altitude", () => {
    expect(pressureAltitude(5000, 29.92)).toBe(5000);
    expect(pressureAltitude(1000, 30.42)).toBe(500);
    expect(pressureAltitude(0, 12)).toBeNull();
  });
  it("5000 ft, standard pressure, 30 C is about 8,000 ft", () => {
    // ISA at 5000 = 5 C; 5000 + 120 x 25 = 8000
    expect(densityAltitude(5000, 29.92, 30)).toEqual({
      pressureAltitude: 5000,
      isaTemp: 5,
      densityAltitude: 8000,
    });
  });
  it("standard day gives field pressure altitude", () => {
    expect(densityAltitude(0, 29.92, 15)!.densityAltitude).toBe(0);
  });
  it("rejects invalid input", () => {
    expect(densityAltitude(NaN, 29.92, 20)).toBeNull();
    expect(densityAltitude(0, 29.92, 200)).toBeNull();
  });
});
