import { describe, expect, it } from "vitest";

import { formatLongDate, localDayOf, todayIso } from "./dates";

// Midday UTC lands on the same calendar day in every zone from UTC-11 to UTC+11,
// so these expectations hold wherever the suite runs.
describe("localDayOf", () => {
  it("reads the timestamps the app writes (toISOString)", () => {
    expect(localDayOf("2026-10-03T12:00:00.000Z")).toBe("2026-10-03");
    expect(localDayOf("2026-10-03T12:00:00Z")).toBe("2026-10-03");
  });

  it("reads SQLite's space-separated UTC form and explicit offsets", () => {
    expect(localDayOf("2026-10-03 12:00:00")).toBe("2026-10-03");
    expect(localDayOf("2026-10-03T12:00")).toBe("2026-10-03");
    expect(localDayOf("2026-10-03T14:00:00+02:00")).toBe("2026-10-03");
    expect(localDayOf("2026-10-03T14:00:00+0200")).toBe("2026-10-03");
    expect(localDayOf("2026-10-03t12:00:00z")).toBe("2026-10-03");
  });

  it("returns the local day, not the UTC day", () => {
    const late = "2026-10-03T23:30:00.000Z";
    expect(localDayOf(late)).toBe(todayIso(new Date(late)));
  });

  it("passes a bare calendar day through unchanged", () => {
    expect(localDayOf("2026-10-03")).toBe("2026-10-03");
    expect(localDayOf(" 2026-10-03 ")).toBe("2026-10-03");
  });

  it("refuses anything it can't read instead of inventing a date", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "yesterday",
      "2026-13-01T12:00:00Z",
      "2026-02-30T12:00:00Z",
      "2026-02-30",
      "2026-10-03T25:00:00Z",
      "10/03/2026",
      "1696334400000",
    ]) {
      expect(localDayOf(bad), String(bad)).toBeNull();
    }
  });
});

describe("formatLongDate with a stored timestamp", () => {
  it("formats the day a completion timestamp fell on (the undefined, undefined NaN regression)", () => {
    const day = localDayOf("2026-10-03T12:00:00.000Z")!;
    const text = formatLongDate(day, "2026-10-11");
    expect(text).toBe("Saturday, October 3");
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("documents why the conversion is needed: a raw timestamp breaks formatLongDate", () => {
    expect(formatLongDate("2026-10-03T12:00:00.000Z", "2026-10-11")).toMatch(/undefined|NaN/);
  });
});
