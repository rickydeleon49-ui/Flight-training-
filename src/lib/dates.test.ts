import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatLongDate, localDayOf } from "./dates";

/**
 * Runs the enclosing describe block in `zone`, then puts process.env.TZ back
 * exactly as it was: the same value, or no variable at all when none was set.
 */
function inTimeZone(zone: string) {
  let hadTz = false;
  let originalTz: string | undefined;
  beforeAll(() => {
    hadTz = "TZ" in process.env;
    originalTz = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (hadTz) process.env.TZ = originalTz;
    else delete process.env.TZ;
  });
}

const MALFORMED = [
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
];

describe("localDayOf in UTC", () => {
  inTimeZone("UTC");

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

  it("passes a bare calendar day through unchanged", () => {
    expect(localDayOf("2026-10-03")).toBe("2026-10-03");
    expect(localDayOf(" 2026-10-03 ")).toBe("2026-10-03");
  });

  it("refuses anything it can't read instead of inventing a date", () => {
    for (const bad of MALFORMED) expect(localDayOf(bad), String(bad)).toBeNull();
  });
});

// UTC+14 all year: 10:00 UTC is already midnight of the following day.
describe("localDayOf in Pacific/Kiritimati", () => {
  inTimeZone("Pacific/Kiritimati");

  it("returns the following local day once UTC reaches 10:00", () => {
    expect(localDayOf("2026-10-03T12:00:00.000Z")).toBe("2026-10-04");
    expect(localDayOf("2026-10-03 12:00:00")).toBe("2026-10-04");
    expect(localDayOf("2026-10-03T10:00:00Z")).toBe("2026-10-04");
    expect(localDayOf("2026-10-03T09:59:59Z")).toBe("2026-10-03");
  });

  it("passes a bare calendar day through unchanged", () => {
    expect(localDayOf("2026-10-03")).toBe("2026-10-03");
  });

  it("refuses anything it can't read instead of inventing a date", () => {
    for (const bad of MALFORMED) expect(localDayOf(bad), String(bad)).toBeNull();
  });
});

// UTC-7 in October: an evening in California is already tomorrow in UTC.
describe("localDayOf in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("returns the previous local day before 07:00 UTC", () => {
    expect(localDayOf("2026-10-03T04:30:00.000Z")).toBe("2026-10-02");
    expect(localDayOf("2026-10-03 04:30:00")).toBe("2026-10-02");
    expect(localDayOf("2026-10-03T06:59:59Z")).toBe("2026-10-02");
    expect(localDayOf("2026-10-03T07:00:00Z")).toBe("2026-10-03");
  });

  it("passes a bare calendar day through unchanged", () => {
    expect(localDayOf("2026-10-03")).toBe("2026-10-03");
  });

  it("refuses anything it can't read instead of inventing a date", () => {
    for (const bad of MALFORMED) expect(localDayOf(bad), String(bad)).toBeNull();
  });
});

describe("formatLongDate with a stored timestamp", () => {
  describe("in UTC", () => {
    inTimeZone("UTC");

    it("formats the day a completion timestamp fell on (the undefined, undefined NaN regression)", () => {
      const text = formatLongDate(localDayOf("2026-10-03T12:00:00.000Z")!, "2026-10-11");
      expect(text).toBe("Saturday, October 3");
      expect(text).not.toMatch(/undefined|NaN/);
    });

    it("documents why the conversion is needed: a raw timestamp breaks formatLongDate", () => {
      expect(formatLongDate("2026-10-03T12:00:00.000Z", "2026-10-11")).toMatch(/undefined|NaN/);
    });
  });

  describe("in Pacific/Kiritimati", () => {
    inTimeZone("Pacific/Kiritimati");

    it("formats the following local day for the same instant", () => {
      const text = formatLongDate(localDayOf("2026-10-03T12:00:00.000Z")!, "2026-10-11");
      expect(text).toBe("Sunday, October 4");
    });
  });
});
