import { describe, expect, it } from "vitest";

import { makeJournalEntry } from "@/testing/factories";
import {
  flightTimeProblem,
  flightTimesChanged,
  flightActivity,
  flightLogTotals,
  flightRoute,
  hasFlightLogData,
  privatePilotPart61Reference,
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
