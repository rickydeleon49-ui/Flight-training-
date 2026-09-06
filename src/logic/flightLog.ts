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
