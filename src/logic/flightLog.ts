import type { JournalEntry } from "@/domain/types";

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

export function flightRoute(entry: JournalEntry): string {
  const from = entry.departureAirport.trim();
  const to = entry.arrivalAirport.trim();
  if (from && to) return from === to ? from : `${from} → ${to}`;
  return from || to || "—";
}
