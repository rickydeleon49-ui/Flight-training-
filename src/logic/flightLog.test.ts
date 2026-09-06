import { describe, expect, it } from "vitest";

import { makeJournalEntry } from "@/testing/factories";
import {
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
