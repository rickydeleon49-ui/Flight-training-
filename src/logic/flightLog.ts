import type { IsoDate, JournalEntry } from "@/domain/types";
import { addDays, todayIso } from "@/lib/dates";

export const hasFlightLogData = (entry: JournalEntry): boolean =>
  Boolean(
    entry.aircraftType.trim() ||
      entry.aircraftId.trim() ||
      entry.departureAirport.trim() ||
      entry.arrivalAirport.trim() ||
      entry.instructorName.trim() ||
      entry.totalTime != null ||
      entry.dualReceived != null ||
      entry.soloTime != null ||
      entry.picTime != null ||
      entry.crossCountryTime != null ||
      entry.nightTime != null ||
      entry.actualInstrumentTime != null ||
      entry.simulatedInstrumentTime != null ||
      entry.dayLandings != null ||
      entry.nightLandings != null,
  );

export interface FlightLogTotals {
  flights: number;
  totalTime: number;
  dualReceived: number;
  soloTime: number;
  picTime: number;
  crossCountryTime: number;
  nightTime: number;
  instrumentTime: number;
  landings: number;
}

export function flightLogTotals(entries: JournalEntry[]): FlightLogTotals {
  const logged = entries.filter(hasFlightLogData);
  const sum = (read: (entry: JournalEntry) => number | null) =>
    logged.reduce((total, entry) => total + (read(entry) ?? 0), 0);

  return {
    flights: logged.length,
    totalTime: sum((entry) => entry.totalTime),
    dualReceived: sum((entry) => entry.dualReceived),
    soloTime: sum((entry) => entry.soloTime),
    picTime: sum((entry) => entry.picTime),
    crossCountryTime: sum((entry) => entry.crossCountryTime),
    nightTime: sum((entry) => entry.nightTime),
    instrumentTime:
      sum((entry) => entry.actualInstrumentTime) +
      sum((entry) => entry.simulatedInstrumentTime),
    landings:
      sum((entry) => entry.dayLandings) + sum((entry) => entry.nightLandings),
  };
}

export const formatHours = (hours: number): string => hours.toFixed(1);

type FlightTimes = Pick<
  JournalEntry,
  | "totalTime"
  | "dualReceived"
  | "soloTime"
  | "picTime"
  | "crossCountryTime"
  | "nightTime"
  | "actualInstrumentTime"
  | "simulatedInstrumentTime"
>;

const PART_TIMES: ReadonlyArray<readonly [Exclude<keyof FlightTimes, "totalTime">, string]> = [
  ["dualReceived", "dual received"],
  ["soloTime", "solo"],
  ["picTime", "PIC"],
  ["crossCountryTime", "cross-country"],
  ["nightTime", "night"],
  ["actualInstrumentTime", "actual instrument"],
  ["simulatedInstrumentTime", "simulated instrument"],
];

/** Whether any logbook time differs between a saved entry and an edit of it. */
export const flightTimesChanged = (before: FlightTimes, after: FlightTimes): boolean =>
  before.totalTime !== after.totalTime || PART_TIMES.some(([key]) => before[key] !== after[key]);

// Times are entered to a tenth; this only absorbs floating-point addition.
const HOURS_TOLERANCE = 1e-9;

/**
 * Why these logbook times can't all be true of one flight, or null.
 *
 * Each part of a flight is part of its total: 2.0 hours of dual on a 1.5-hour
 * flight is a typing slip, and once saved it would inflate every total built
 * from the log. Dual received and solo can't overlap, and neither can actual
 * and simulated instrument time. Nothing is checked until a total is entered.
 */
export function flightTimeProblem(times: FlightTimes): string | null {
  const total = times.totalTime;
  if (total == null || !Number.isFinite(total)) return null;
  const exceeds = (value: number | null) => value != null && value > total + HOURS_TOLERANCE;
  const over = PART_TIMES.filter(([key]) => exceeds(times[key])).map(([, label]) => label);
  if (over.length > 0) {
    const named = over.length === 1 ? over[0]! : `${over.slice(0, -1).join(", ")} and ${over.at(-1)!}`;
    const sentence = `${named.charAt(0).toUpperCase()}${named.slice(1)} time`;
    return `${sentence} can't be more than this flight's total time of ${formatHours(total)} hr.`;
  }
  if (exceeds((times.dualReceived ?? 0) + (times.soloTime ?? 0))) {
    return `Dual received and solo time together can't be more than this flight's total time of ${formatHours(total)} hr.`;
  }
  if (exceeds((times.actualInstrumentTime ?? 0) + (times.simulatedInstrumentTime ?? 0))) {
    return `Actual and simulated instrument time together can't be more than this flight's total time of ${formatHours(total)} hr.`;
  }
  return null;
}

export interface FlightActivity {
  flightsLast30Days: number;
  hoursLast30Days: number;
  averageFlightTime: number;
  lastFlightDate: IsoDate | null;
}

/** A training-rhythm snapshot. Future-dated entries are deliberately excluded. */
export function flightActivity(
  entries: JournalEntry[],
  today: IsoDate = todayIso(),
): FlightActivity {
  const logged = entries.filter(hasFlightLogData);
  const completed = logged.filter((entry) => entry.date <= today);
  const start = addDays(today, -29);
  const recent = completed.filter((entry) => entry.date >= start);
  const timed = completed.filter((entry) => entry.totalTime != null);

  return {
    flightsLast30Days: recent.length,
    hoursLast30Days: recent.reduce((total, entry) => total + (entry.totalTime ?? 0), 0),
    averageFlightTime:
      timed.length === 0
        ? 0
        : timed.reduce((total, entry) => total + (entry.totalTime ?? 0), 0) / timed.length,
    lastFlightDate:
      completed.length === 0
        ? null
        : completed.reduce(
            (latest, entry) => (entry.date > latest ? entry.date : latest),
            completed[0]!.date,
          ),
  };
}

export interface HourReference {
  key: "total" | "training" | "solo";
  label: string;
  logged: number;
  reference: number;
  percent: number;
}

/**
 * A narrow comparison with the headline Part 61 airplane minimums. It is not
 * an eligibility calculation: the log does not capture every required subset,
 * endorsement, or whether each hour qualifies under the current rules.
 */
export function privatePilotPart61Reference(totals: FlightLogTotals): HourReference[] {
  const line = (
    key: HourReference["key"],
    label: string,
    logged: number,
    reference: number,
  ): HourReference => ({
    key,
    label,
    logged,
    reference,
    percent: Math.min(100, Math.max(0, (logged / reference) * 100)),
  });

  return [
    line("total", "Total flight time", totals.totalTime, 40),
    line("training", "Training received", totals.dualReceived, 20),
    line("solo", "Solo flight time", totals.soloTime, 10),
  ];
}

export function flightRoute(entry: JournalEntry): string {
  const from = entry.departureAirport.trim();
  const to = entry.arrivalAirport.trim();
  if (from && to) return from === to ? from : `${from} → ${to}`;
  return from || to || "—";
}
