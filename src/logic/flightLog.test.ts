import { describe, expect, it } from "vitest";

import type { JournalEntry } from "@/domain/types";
import { makeJournalEntry } from "@/testing/factories";
import {
  flightTimeChecks,
  flightTimeProblem,
  flightTimesChanged,
  flightActivity,
  flightLogTotals,
  flightRoute,
  hasFlightLogData,
  flightRhythmLine,
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

  it("writes one plain rhythm line", () => {
    const base = { averageFlightTime: 1, hoursLast30Days: 4.2 };
    expect(
      flightRhythmLine({ ...base, flightsLast30Days: 3, lastFlightDate: "2026-11-12" }),
    ).toBe("Last 30 days: 3 flights, 4.2 hours · last flight 12 Nov 2026");
    expect(
      flightRhythmLine({ ...base, flightsLast30Days: 0, hoursLast30Days: 0, lastFlightDate: "2026-09-05" }),
    ).toBe("Last 30 days: no flights · last flight 5 Sep 2026");
    expect(
      flightRhythmLine({ ...base, flightsLast30Days: 1, hoursLast30Days: 1, lastFlightDate: "2026-11-12" }),
    ).toMatch(/1 flight, 1(\.0)? hour ·/);
    expect(
      flightRhythmLine({ ...base, flightsLast30Days: 0, lastFlightDate: null }),
    ).toBeNull();
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

describe("privatePilotHoursToGo with journal ticks (BL-104)", () => {
  const zero: FlightLogTotals = {
    flights: 0, totalTime: 0, dualReceived: 0, soloTime: 0, picTime: 0,
    crossCountryTime: 0, nightTime: 0, instrumentTime: 0, landings: 0,
  };
  const entry = (over: Partial<JournalEntry>): JournalEntry => ({ ...makeJournalEntry(), ...over });
  const row = (rows: ReturnType<typeof privatePilotHoursToGo>, key: string) => rows.find((r) => r.key === key)!;

  it("counts xc rows from times with min(), even with no ticks", () => {
    const rows = privatePilotHoursToGo(zero, 0, null, [
      entry({ dualReceived: 2, crossCountryTime: 1.5 }),
      entry({ soloTime: 1, crossCountryTime: 3, dualReceived: 0 }),
      entry({ dualReceived: null, crossCountryTime: 9 }),
    ]);
    expect(row(rows, "xc-training")).toMatchObject({ logged: 1.5, toGo: 1.5, status: "to_go", meta: "Confirm with your instructor." });
    expect(row(rows, "solo-xc")).toMatchObject({ logged: 1, toGo: 4, status: "to_go" });
  });

  it("stays unknown with a hint when nothing was ever ticked", () => {
    const rows = privatePilotHoursToGo(zero, 0, null, [entry({ dualReceived: 1 })]);
    for (const key of ["prep", "solo-xc-long", "solo-tower"]) {
      expect(row(rows, key)).toMatchObject({ status: "unknown", toGo: null });
      expect(row(rows, key).meta).toContain("Tick it on the flight in your journal.");
    }
    expect(row(rows, "night").status).toBe("unknown");
  });

  it("counts ticks: long solo XC date, solo tower landings, prep window", () => {
    const rows = privatePilotHoursToGo(zero, 0, "2027-03-15", [
      entry({ date: "2026-12-20", dualReceived: 5, checkridePrep: true }),
      entry({ date: "2027-01-10", dualReceived: 2, checkridePrep: true }),
      entry({ date: "2027-01-12", dualReceived: 1 }),
      entry({ date: "2027-01-05", soloTime: 1, toweredFullStopLandings: 2, longSoloXc: true }),
      entry({ date: "2027-01-06", soloTime: 0, dualReceived: 1, toweredFullStopLandings: 5 }),
    ], "2027-02-01");
    expect(row(rows, "solo-xc-long")).toMatchObject({ status: "done", statusText: "Ticked on 2027-01-05 — done" });
    expect(row(rows, "solo-tower")).toMatchObject({ status: "to_go", toGo: 1, statusText: "2 / 3 landings — 1 to go" });
    expect(row(rows, "prep")).toMatchObject({ logged: 2, toGo: 1, status: "to_go" });
  });

  it("night is done only when training, night XC tick and landings are all met", () => {
    const base = [entry({ dualReceived: 3, nightTime: 3, nightXc100: true })];
    expect(row(privatePilotHoursToGo(zero, 10, null, base), "night").status).toBe("done");
    expect(row(privatePilotHoursToGo(zero, 9, null, base), "night").status).toBe("to_go");
    expect(row(privatePilotHoursToGo(zero, 10, null, [entry({ dualReceived: 3, nightTime: 3, toweredFullStopLandings: 1 })]), "night").status).toBe("to_go");
  });
});

describe("planned flights (BH-3)", () => {
  it("leaves future-dated flights out of totals and hours to go", () => {
    const past = makeJournalEntry({ id: "p", date: "2026-09-10", totalTime: 1, soloTime: 1 });
    const future = makeJournalEntry({ id: "f", date: "2026-12-24", totalTime: 2, soloTime: 2 });
    const t = flightLogTotals([past, future], "2026-11-19");
    expect(t.flights).toBe(1);
    expect(t.totalTime).toBe(1);
    expect(flightLogTotals([past, future], "2026-12-24").totalTime).toBe(3);
    const zero = flightLogTotals([]);
    const row = privatePilotHoursToGo(zero, 0, null, [
      makeJournalEntry({ id: "a", date: "2026-12-24", dualReceived: 2, crossCountryTime: 2 }),
    ], "2026-11-19").find((r) => r.key === "xc-training");
    expect(row?.logged ?? 0).toBe(0);
  });
});
