import { describe, expect, it } from "vitest";

import { addDays } from "@/lib/dates";
import { checkrideBody, checkrideLine, daysToCheckride } from "./checkride";
import { upcomingKeyDates } from "./keyDates";
import { normalizeCheckrideDate, normalizeToolkitState, DEFAULT_TOOLKIT_STATE } from "./toolkit";
import { makeMilestone, makeProfile } from "@/testing/factories";

describe("checkride countdown", () => {
  it("counts whole days, with singular and day-of wording", () => {
    expect(checkrideLine("2026-11-20", "2026-11-09")).toBe("11 days to your checkride");
    expect(checkrideLine("2026-11-10", "2026-11-09")).toBe("1 day to your checkride");
    expect(checkrideLine("2026-11-09", "2026-11-09")).toBe("Checkride today — you've got this");
  });

  it("is hidden when unset or passed", () => {
    expect(checkrideLine(null, "2026-11-09")).toBeNull();
    expect(checkrideLine(undefined, "2026-11-09")).toBeNull();
    expect(checkrideLine("2026-11-08", "2026-11-09")).toBeNull();
    expect(daysToCheckride("2026-11-08", "2026-11-09")).toBeNull();
  });

  it("is exact across DST changes and month ends", () => {
    expect(daysToCheckride("2026-03-09", "2026-03-07")).toBe(2); // US spring forward on the 8th
    expect(daysToCheckride("2026-11-02", "2026-10-31")).toBe(2); // fall back on 1 Nov
    expect(daysToCheckride("2026-03-01", "2026-01-30")).toBe(30);
    expect(daysToCheckride("2028-03-01", "2028-02-28")).toBe(2); // leap year
    expect(addDays("2026-12-31", -30)).toBe("2026-12-01");
  });

  it("uses generic wording", () => {
    expect(checkrideBody(1)).toBe("Your checkride is tomorrow.");
    expect(checkrideBody(7)).toBe("Your checkride is in 7 days.");
  });
});

describe("checkride date storage", () => {
  it("defaults to null and drops invalid values", () => {
    expect(DEFAULT_TOOLKIT_STATE.checkrideDate).toBeNull();
    expect(normalizeCheckrideDate("2026-02-30")).toBeNull();
    expect(normalizeCheckrideDate("soon")).toBeNull();
    expect(normalizeCheckrideDate(5)).toBeNull();
    expect(normalizeCheckrideDate("2026-12-01")).toBe("2026-12-01");
    expect(normalizeToolkitState({ checkrideDate: "nope" }).checkrideDate).toBeNull();
    expect(normalizeToolkitState({ checkrideDate: "2026-12-01" }).checkrideDate).toBe("2026-12-01");
    expect(normalizeToolkitState(undefined).checkrideDate).toBeNull();
  });
});

describe("checkride in key dates", () => {
  const profile = makeProfile({ medicalExpiry: null });
  it("appears once, soonest first, and not when passed or unset", () => {
    const some = upcomingKeyDates(profile, [], "2026-11-09", 180, "2026-12-01");
    expect(some.map((d) => d.kind)).toEqual(["checkride"]);
    expect(upcomingKeyDates(profile, [], "2026-11-09", 180, "2026-11-01")).toEqual([]);
    expect(upcomingKeyDates(profile, [], "2026-11-09")).toEqual([]);
  });

  it("does not repeat a checkride milestone on the same day", () => {
    const dates = upcomingKeyDates(
      profile,
      [
        makeMilestone({ id: "m1", title: "Checkride", targetDate: "2026-12-01" }),
        makeMilestone({ id: "m2", title: "Written exam", targetDate: "2026-11-20" }),
      ],
      "2026-11-09",
      180,
      "2026-12-01",
    );
    expect(dates.map((d) => d.id)).toEqual(["m2", "checkride"]);
  });
});
