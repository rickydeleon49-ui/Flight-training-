import { describe, expect, it } from "vitest";

import { makeJournalEntry } from "@/testing/factories";
import { flightLogTotals, flightRoute, hasFlightLogData } from "./flightLog";

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
});
