import { describe, expect, it } from "vitest";

import { makeJournalEntry } from "@/testing/factories";
import {
  flightTimeChecks,
  flightTimeProblem,
  flightTimesChanged,
  flightActivity,
  flightLogTotals,
  flightRoute,
  hasFlightLogData,
  privatePilotPart61Reference,
  privatePilotHoursToGo,
  prepWindowStart,
  type FlightLogTotals,
} from "./flightLog";

describe("flight log", () => {
  it("totals overlapping pilot-time categories independently", () => {
    const entries = [
      makeJournalEntry({
        totalTime: 1.2,
        dualReceived: 1.2,
        picTime: 1.2,
        nightTime: 0.4,
        dayLandings: 2,
      }),
      makeJournalEntry({
        totalTime: 0.8,
        soloTime: 0.8,
        crossCountryTime: 0.8,
        simulatedInstrumentTime: 0.3,
        nightLandings: 1,
      }),
    ];

    expect(flightLogTotals(entries)).toEqual({
      flights: 2,
      totalTime: 2,
      dualReceived: 1.2,
      soloTime: 0.8,
      picTime: 1.2,
      crossCountryTime: 0.8,
      nightTime: 0.4,
      instrumentTime: 0.3,
      landings: 3,
    });
  });

  it("does not count a debrief with no flight fields as a logged flight", () => {
    const entry = makeJournalEntry({ mission: "Work on landings" });
    expect(hasFlightLogData(entry)).toBe(false);
    expect(flightLogTotals([entry]).flights).toBe(0);
  });

  it("formats local and point-to-point routes", () => {
    expect(
      flightRoute(makeJournalEntry({ departureAirport: "KPAE", arrivalAirport: "KPAE" })),
    ).toBe("KPAE");
    expect(
      flightRoute(makeJournalEntry({ departureAirport: "KPAE", arrivalAirport: "KBLI" })),
    ).toBe("KPAE → KBLI");
  });

  it("summarizes recent training without counting future flights", () => {
    const entries = [
      makeJournalEntry({ date: "2026-08-10", totalTime: 1.2 }),
      makeJournalEntry({ date: "2026-08-20", totalTime: 0.8 }),
      makeJournalEntry({ date: "2026-09-05", totalTime: 1 }),
      makeJournalEntry({ date: "2026-09-06", totalTime: 9 }),
    ];

    expect(flightActivity(entries, "2026-09-05")).toEqual({
      flightsLast30Days: 3,
      hoursLast30Days: 3,
      averageFlightTime: 1,
      lastFlightDate: "2026-09-05",
    });
  });

  it("builds capped Part 61 planning comparisons from logged categories", () => {
    const references = privatePilotPart61Reference({
      flights: 30,
      totalTime: 50,
      dualReceived: 10,
      soloTime: 2.5,
      picTime: 0,
      crossCountryTime: 0,
      nightTime: 0,
      instrumentTime: 0,
      landings: 0,
    });

    expect(references.map(({ key, percent }) => [key, percent])).toEqual([
      ["total", 100],
      ["training", 50],
      ["solo", 25],
    ]);
  });
});

describe("flightTimeProblem", () => {
  const times = (overrides: Partial<Parameters<typeof flightTimeProblem>[0]>) => ({
    totalTime: null,
    dualReceived: null,
    soloTime: null,
    picTime: null,
    crossCountryTime: null,
    nightTime: null,
    actualInstrumentTime: null,
    simulatedInstrumentTime: null,
    ...overrides,
  });

  it("accepts parts that fit inside the total, including equal to it", () => {
    expect(flightTimeProblem(times({ totalTime: 1.5, dualReceived: 1.5, crossCountryTime: 1.5, nightTime: 0.3 }))).toBeNull();
    expect(flightTimeProblem(times({ totalTime: 1.3, soloTime: 1.3, picTime: 1.3 }))).toBeNull();
  });

  it("checks nothing until a total is entered", () => {
    expect(flightTimeProblem(times({ dualReceived: 2 }))).toBeNull();
  });

  it("names each part that is longer than the flight", () => {
    expect(flightTimeProblem(times({ totalTime: 1.5, dualReceived: 2 }))).toBe(
      "Dual received time can't be more than this flight's total time of 1.5 hr.",
    );
    expect(flightTimeProblem(times({ totalTime: 1, picTime: 1.2, nightTime: 1.1, simulatedInstrumentTime: 3 }))).toBe(
      "PIC, night and simulated instrument time can't be more than this flight's total time of 1.0 hr.",
    );
  });

  it("refuses dual and solo, or actual and simulated instrument, adding up past the total", () => {
    expect(flightTimeProblem(times({ totalTime: 1.5, dualReceived: 1, soloTime: 1 }))).toMatch(/^Dual received and solo time together/);
    expect(flightTimeProblem(times({ totalTime: 1, actualInstrumentTime: 0.6, simulatedInstrumentTime: 0.5 }))).toMatch(/^Actual and simulated instrument time together/);
  });

  it("tells an edit of the logbook times from one that leaves them alone", () => {
    const saved = times({ totalTime: 1, dualReceived: 2 });
    expect(flightTimesChanged(saved, { ...saved })).toBe(false);
    expect(flightTimesChanged(saved, { ...saved, dualReceived: 1 })).toBe(true);
    expect(flightTimesChanged(saved, { ...saved, totalTime: 2 })).toBe(true);
  });

  it("is not tripped by floating-point addition of tenths", () => {
    expect(flightTimeProblem(times({ totalTime: 0.3, dualReceived: 0.1, soloTime: 0.2 }))).toBeNull();
  });
});

describe("flightTimeChecks", () => {
  it("lists only saved entries whose times don't add up, newest first, without changing them", () => {
    const fine = makeJournalEntry({ id: "fine", date: "2026-09-03", totalTime: 1.2, dualReceived: 1.2 });
    const older = makeJournalEntry({ id: "older", date: "2026-08-01", totalTime: 1, dualReceived: 1.2 });
    const newer = makeJournalEntry({ id: "newer", date: "2026-09-10", totalTime: 1.5, dualReceived: 1, soloTime: 1 });
    const untimed = makeJournalEntry({ id: "untimed", date: "2026-09-11", dualReceived: 3 });
    const entries = [fine, older, newer, untimed];
    const snapshot = JSON.stringify(entries);

    const checks = flightTimeChecks(entries);

    expect(checks.map((check) => check.entry.id)).toEqual(["newer", "older"]);
    expect(checks[1]!.problem).toBe("Dual received time can't be more than this flight's total time of 1.0 hr.");
    expect(checks[0]!.problem).toMatch(/^Dual received and solo time together/);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});

describe("privatePilotHoursToGo / prepWindowStart (BL-72)", () => {
  const totals = (over: Partial<FlightLogTotals> = {}): FlightLogTotals => ({
    flights: 0, totalTime: 0, dualReceived: 0, soloTime: 0, picTime: 0,
    crossCountryTime: 0, nightTime: 0, instrumentTime: 0, landings: 0, ...over,
  });
  const row = (rows: ReturnType<typeof privatePilotHoursToGo>, key: string) => rows.find((r) => r.key === key)!;

  it("computes hours to go and never goes negative", () => {
    const rows = privatePilotHoursToGo(totals({ totalTime: 12.5, dualReceived: 25, soloTime: 10, instrumentTime: 1 }), 0);
    expect(row(rows, "total")).toMatchObject({ toGo: 27.5, status: "to_go" });
    expect(row(rows, "training")).toMatchObject({ toGo: 0, status: "done" });
    expect(row(rows, "solo")).toMatchObject({ toGo: 0, status: "done" });
    expect(row(rows, "instrument").toGo).toBe(2);
    expect(rows.every((r) => r.toGo == null || r.toGo >= 0)).toBe(true);
  });

  it("lists night and the other subsets as text only, with no computed numbers", () => {
    const rows = privatePilotHoursToGo(totals({ nightTime: 1.5 }), 4);
    expect(row(rows, "night")).toMatchObject({ toGo: null, status: "unknown", info: "Logged: 1.5 h night, 4 night landings" });
    for (const key of ["xc-training", "prep", "solo-xc", "solo-xc-long", "solo-tower"]) {
      expect(row(rows, key)).toMatchObject({ logged: null, toGo: null, status: "unknown" });
    }
  });

  it("window date: 1st of the month two months before the test month, with year rollover", () => {
    expect(prepWindowStart("2027-03-15")).toBe("2027-01-01");
    expect(prepWindowStart("2027-02-10")).toBe("2026-12-01");
    expect(prepWindowStart("2027-01-31")).toBe("2026-11-01");
    expect(prepWindowStart("2027-12-01")).toBe("2027-10-01");
    expect(prepWindowStart(null)).toBeNull();
    expect(prepWindowStart("nope")).toBeNull();
  });

  it("prep row names the window only when a checkride date is set", () => {
    expect(row(privatePilotHoursToGo(totals(), 0), "prep").meta).toBeUndefined();
    expect(row(privatePilotHoursToGo(totals(), 0, "2027-03-15"), "prep").meta).toBe(
      "Your 2-month window starts 2027-01-01 — confirm with your instructor.",
    );
  });
});
