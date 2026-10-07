/**
 * Local calendar days, ported with unchanged meaning from the accepted proof
 * ([pure] stored instants versus local calendar display, and the CRS-R1
 * boundary cases), plus the exclusive next-local-midnight boundary.
 */
import { describe, expect, it } from "vitest";

import { scheduleCard } from "./cardScheduler";
import { localDate, nextLocalMidnightUtc, shortLocalDay } from "./localDay";

// 23:50 on 6 October in Chicago (UTC-5 in October) is 04:50Z on 7 October.
const lateEvening = "2026-10-07T04:50:00.000Z";
const isDayDue = (dueAt: string, nowIso: string, zone: string) => dueAt < nextLocalMidnightUtc(nowIso, zone);

describe("[pure] stored instants versus local calendar display", () => {
  it("local midnight: a 1-day card reviewed late evening is due all of the next local day, not before", () => {
    const state = scheduleCard(null, "good", lateEvening);
    expect(state.dueAt).toBe("2026-10-08T04:50:00.000Z");
    expect(localDate(state.dueAt, "America/Chicago")).toBe("2026-10-07");
    expect(isDayDue(state.dueAt, "2026-10-07T04:59:00.000Z", "America/Chicago")).toBe(false);
    expect(isDayDue(state.dueAt, "2026-10-07T13:00:00.000Z", "America/Chicago")).toBe(true);
  });

  it("time zone change: the same stored instant is judged by the zone the computer is in now; nothing is rewritten", () => {
    const state = scheduleCard(null, "good", lateEvening);
    const stored = JSON.stringify(state);
    const now = "2026-10-07T13:00:00.000Z";
    expect(isDayDue(state.dueAt, now, "America/Chicago")).toBe(true);
    expect(isDayDue(state.dueAt, now, "Asia/Tokyo")).toBe(false);
    expect(JSON.stringify(state)).toBe(stored);
  });
});

describe("[pure] exclusive next local midnight", () => {
  it("is the first instant of the next local date", () => {
    expect(nextLocalMidnightUtc("2026-10-06T20:00:00.000Z", "America/Chicago")).toBe("2026-10-07T05:00:00.000Z");
    expect(nextLocalMidnightUtc("2026-10-06T20:00:00.000Z", "UTC")).toBe("2026-10-07T00:00:00.000Z");
    expect(nextLocalMidnightUtc("2026-10-06T23:59:59.999Z", "UTC")).toBe("2026-10-07T00:00:00.000Z");
    expect(nextLocalMidnightUtc("2026-10-07T00:00:00.000Z", "UTC")).toBe("2026-10-08T00:00:00.000Z");
  });

  it("daylight saving: the 25-hour and 23-hour local days get exact boundaries", () => {
    expect(nextLocalMidnightUtc("2026-10-31T17:00:00.000Z", "America/Chicago")).toBe("2026-11-01T05:00:00.000Z");
    expect(nextLocalMidnightUtc("2026-11-01T17:00:00.000Z", "America/Chicago")).toBe("2026-11-02T06:00:00.000Z");
    expect(nextLocalMidnightUtc("2026-03-08T17:00:00.000Z", "America/Chicago")).toBe("2026-03-09T05:00:00.000Z");
  });

  it("formats a short local day for Next review lines", () => {
    expect(shortLocalDay("2026-10-08T15:00:00.000Z", "UTC")).toBe("Thu 8 Oct");
  });
});
