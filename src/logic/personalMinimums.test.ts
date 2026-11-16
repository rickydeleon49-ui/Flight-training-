import { describe, expect, it } from "vitest";

import {
  compareToMinimums,
  minimumsLine,
  minimumsSummary,
  normalizePersonalMinimums,
} from "./personalMinimums";
import { DEFAULT_TOOLKIT_STATE, normalizeToolkitState } from "./toolkit";

const mins = { ceilingFt: 3000, visibilitySm: 5, windKt: 15, crosswindKt: 8 };

describe("compareToMinimums", () => {
  it("counts equal to the limit as inside", () => {
    expect(compareToMinimums(mins, { ceilingFt: 3000, visibilitySm: 5, windKt: 15, crosswindKt: 8 })).toEqual({
      ceilingFt: "inside",
      visibilitySm: "inside",
      windKt: "inside",
      crosswindKt: "inside",
    });
  });
  it("lower ceiling/visibility is outside; higher wind/crosswind is outside", () => {
    expect(compareToMinimums(mins, { ceilingFt: 2999, visibilitySm: 4.9, windKt: 16, crosswindKt: 9 })).toEqual({
      ceilingFt: "outside",
      visibilitySm: "outside",
      windKt: "outside",
      crosswindKt: "outside",
    });
  });
  it("higher ceiling and lower wind are inside", () => {
    const r = compareToMinimums(mins, { ceilingFt: 8000, windKt: 3 });
    expect(r).toEqual({ ceilingFt: "inside", windKt: "inside" });
  });
  it("gives nothing for missing inputs or missing minimums", () => {
    expect(compareToMinimums(mins, {})).toEqual({});
    expect(compareToMinimums({ windKt: 10 }, { ceilingFt: 1 })).toEqual({});
    expect(compareToMinimums(undefined, { windKt: 50 })).toEqual({});
  });
});

describe("wording", () => {
  it("never says go, safe or OK", () => {
    const texts = [
      minimumsSummary({ windKt: "outside", ceilingFt: "inside" }),
      minimumsSummary({ windKt: "inside" }),
    ];
    expect(texts[0]).toBe("Outside your minimum — talk with your instructor.");
    expect(texts[1]).toBe("Inside the minimums you saved. You and your instructor still make the call.");
    for (const t of texts) expect(t).not.toMatch(/\b(go|safe|ok|okay)\b/i);
    expect(minimumsSummary({})).toBeNull();
  });
  it("formats the saved line", () => {
    expect(minimumsLine(mins)).toBe("Your minimums: ceiling 3,000 ft · vis 5 SM · wind 15 kt · crosswind 8 kt");
    expect(minimumsLine(undefined)).toBeNull();
  });
});

describe("storage", () => {
  it("old state without the field loads with no minimums", () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_TOOLKIT_STATE));
    delete old.personalMinimums;
    const state = normalizeToolkitState(old);
    expect(state.personalMinimums).toBeUndefined();
    expect("personalMinimums" in state).toBe(false);
  });
  it("keeps good saved minimums and drops junk", () => {
    const state = normalizeToolkitState({ ...DEFAULT_TOOLKIT_STATE, personalMinimums: { ...mins, note: " no night " } });
    expect(state.personalMinimums).toEqual({ ...mins, note: "no night" });
    expect(normalizePersonalMinimums({ ceilingFt: "x", windKt: -2, note: "  " })).toBeUndefined();
    expect(normalizePersonalMinimums("nope")).toBeUndefined();
  });
});
