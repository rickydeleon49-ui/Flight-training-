import { describe, expect, it } from "vitest";

import { makeMilestone, makeProfile } from "@/testing/factories";
import { trainingDuration, upcomingKeyDates } from "./keyDates";

const TODAY = "2026-09-05";

describe("upcomingKeyDates", () => {
  it("includes the medical expiry and milestone targets, soonest first", () => {
    const dates = upcomingKeyDates(
      makeProfile({ medicalExpiry: "2026-11-01" }),
      [
        makeMilestone({ id: "m1", title: "Written exam", targetDate: "2026-10-01" }),
        makeMilestone({ id: "m2", title: "Checkride", targetDate: "2026-12-01" }),
      ],
      TODAY,
    );

    expect(dates.map((d) => d.label)).toEqual([
      "Written exam",
      "Medical certificate expires",
      "Checkride",
    ]);
  });

  it("keeps an expired medical visible", () => {
    // An out-of-date certificate is a fact she needs, not a nag to hide.
    const dates = upcomingKeyDates(
      makeProfile({ medicalExpiry: "2026-08-01" }),
      [],
      TODAY,
    );
    expect(dates).toHaveLength(1);
    expect(dates[0]?.passed).toBe(true);
    expect(dates[0]?.daysAway).toBeLessThan(0);
  });

  it("drops a milestone target that has already passed", () => {
    // The product does not reproach her for a goal date that slipped.
    const dates = upcomingKeyDates(
      makeProfile(),
      [makeMilestone({ targetDate: "2026-08-01" })],
      TODAY,
    );
    expect(dates).toHaveLength(0);
  });

  it("ignores completed milestones and anything beyond the horizon", () => {
    const dates = upcomingKeyDates(
      makeProfile({ medicalExpiry: "2030-01-01" }),
      [
        makeMilestone({ targetDate: "2026-09-20", status: "completed" }),
        makeMilestone({ targetDate: "2029-01-01" }),
      ],
      TODAY,
    );
    expect(dates).toHaveLength(0);
  });

  it("returns nothing when no dates have been entered", () => {
    expect(upcomingKeyDates(makeProfile(), [makeMilestone()], TODAY)).toEqual([]);
  });
});

describe("trainingDuration", () => {
  it("counts days, then months, then years", () => {
    expect(trainingDuration("2026-09-04", TODAY)).toBe("1 day");
    expect(trainingDuration("2026-08-20", TODAY)).toBe("16 days");
    expect(trainingDuration("2026-06-01", TODAY)).toBe("3 months");
    expect(trainingDuration("2025-09-05", TODAY)).toBe("1 year");
    expect(trainingDuration("2024-06-05", TODAY)).toBe("2 years, 3 months");
  });

  it("is empty with no start date, or one in the future", () => {
    expect(trainingDuration(null, TODAY)).toBeNull();
    expect(trainingDuration("2027-01-01", TODAY)).toBeNull();
  });
});
