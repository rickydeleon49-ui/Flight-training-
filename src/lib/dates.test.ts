import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeRelativeDate, formatLocalDay, formatLongDate, formatShortDate, localDayOf } from "./dates";

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

describe("formatShortDate", () => {
  it("leaves the year off this year's dates", () => {
    expect(formatShortDate("2026-10-20", "2026-10-14")).toBe("Oct 20");
  });

  it("names the year otherwise, so an expiry two years out is not read as this month", () => {
    expect(formatShortDate("2028-10-20", "2026-10-14")).toBe("Oct 20, 2028");
    expect(formatShortDate("2025-12-03", "2026-10-14")).toBe("Dec 3, 2025");
    expect(describeRelativeDate("2027-01-05", "2026-12-20")).toBe("Jan 5, 2027");
  });
});

// DESKTOP-V054-01: "Added" and "Last reviewed" named the UTC day in the evening.
describe("formatLocalDay", () => {
  const today = "2026-10-15";

  describe("in America/Los_Angeles", () => {
    inTimeZone("America/Los_Angeles");

    it("names the local evening's day for the timestamps from the native run", () => {
      // 20:56 PDT on Thursday 15 October: both stored as Friday 16 October UTC.
      expect(formatLocalDay("2026-10-16T02:26:19.480Z", today)).toBe("Thursday, October 15");
      expect(formatLocalDay("2026-10-16T03:56:14.075Z", today)).toBe("Thursday, October 15");
      expect(formatLocalDay("2026-10-16 03:56:14", today)).toBe("Thursday, October 15");
      expect(formatLocalDay("2026-10-16T06:59:59Z", today)).toBe("Thursday, October 15");
      expect(formatLocalDay("2026-10-16T07:00:00Z", today)).toBe("Friday, October 16");
    });

    it("follows daylight saving on both 2026 transitions", () => {
      // Clocks fall back on 1 November: midnight PST is 08:00 UTC.
      expect(formatLocalDay("2026-11-02T07:59:59Z", today)).toBe("Sunday, November 1");
      expect(formatLocalDay("2026-11-02T08:00:00Z", today)).toBe("Monday, November 2");
      // Clocks spring forward on 8 March: midnight PDT is 07:00 UTC.
      expect(formatLocalDay("2026-03-09T06:59:59Z", today)).toBe("Sunday, March 8");
      expect(formatLocalDay("2026-03-09T07:00:00Z", today)).toBe("Monday, March 9");
    });

    it("keeps a bare calendar day and honours an explicit offset", () => {
      expect(formatLocalDay("2026-10-16", today)).toBe("Friday, October 16");
      expect(formatLocalDay("2026-10-16T01:00:00+05:30", today)).toBe("Thursday, October 15");
    });

    it("returns null for anything it can't read, never a made-up date", () => {
      for (const bad of MALFORMED) expect(formatLocalDay(bad, today), String(bad)).toBeNull();
    });
  });

  describe("in Pacific/Kiritimati", () => {
    inTimeZone("Pacific/Kiritimati");

    it("names the following day once UTC reaches 10:00", () => {
      expect(formatLocalDay("2026-10-15T09:59:59Z", today)).toBe("Thursday, October 15");
      expect(formatLocalDay("2026-10-15T10:00:00Z", today)).toBe("Friday, October 16");
      expect(formatLocalDay("2026-10-15 10:00:00", today)).toBe("Friday, October 16");
      expect(formatLocalDay("2026-10-16", today)).toBe("Friday, October 16");
    });
  });

  describe("in UTC", () => {
    inTimeZone("UTC");

    it("matches the UTC day and adds the year outside the current one", () => {
      expect(formatLocalDay("2026-10-16T03:56:14.075Z", today)).toBe("Friday, October 16");
      expect(formatLocalDay("2025-12-31T23:59:59Z", today)).toBe("Wednesday, December 31, 2025");
    });
  });
});
