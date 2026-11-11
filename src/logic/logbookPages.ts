import type { JournalEntry } from "@/domain/types";
import { flightLogTotals, hasFlightLogData } from "./flightLog";

/** Flights on one paper-style logbook page (one place to change it). */
export const LOGBOOK_PAGE_SIZE = 10;

export interface LedgerTotals {
  totalTime: number;
  dualReceived: number;
  picTime: number;
  soloTime: number;
  nightTime: number;
  crossCountryTime: number;
  instrumentTime: number;
  flights: number;
}

export interface LedgerPage {
  number: number;
  entries: JournalEntry[];
  thisPage: LedgerTotals;
  broughtForward: LedgerTotals;
  totalToDate: LedgerTotals;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Every number comes from flightLogTotals, so the last page matches the
// summary tiles exactly. Display only; nothing is written to data.
const totals = (entries: JournalEntry[]): LedgerTotals => {
  const t = flightLogTotals(entries);
  return {
    totalTime: t.totalTime,
    dualReceived: t.dualReceived,
    picTime: t.picTime,
    soloTime: t.soloTime,
    nightTime: t.nightTime,
    crossCountryTime: t.crossCountryTime,
    instrumentTime: t.instrumentTime,
    flights: t.flights,
  };
};

export function logbookPages(
  entries: JournalEntry[],
  pageSize: number = LOGBOOK_PAGE_SIZE,
): LedgerPage[] {
  const size = Math.max(1, Math.floor(pageSize));
  const sorted = entries
    .filter(hasFlightLogData)
    .sort(
      (a, b) =>
        compare(a.date, b.date) ||
        compare(a.createdAt, b.createdAt) ||
        compare(a.id, b.id),
    );
  const pages: LedgerPage[] = [];
  for (let start = 0; start < sorted.length; start += size) {
    const end = Math.min(start + size, sorted.length);
    const page = sorted.slice(start, end);
    pages.push({
      number: pages.length + 1,
      entries: page,
      thisPage: totals(page),
      broughtForward: totals(sorted.slice(0, start)),
      totalToDate: totals(sorted.slice(0, end)),
    });
  }
  return pages;
}
