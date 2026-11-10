import { describe, expect, it } from "vitest";

import { makeJournalEntry } from "@/testing/factories";
import { flightLogTotals } from "./flightLog";
import { LOGBOOK_PAGE_SIZE, logbookPages } from "./logbookPages";

// Oldest first, so the sums run in the same order as the page maths.
const flights = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeJournalEntry({
      id: `f${String(i).padStart(4, "0")}`,
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      totalTime: 1.25 + (i % 7) * 0.1,
      dualReceived: i % 2 ? 1.25 : null,
      soloTime: i % 3 ? null : 0.7,
      picTime: 0.35,
      nightTime: i % 5 ? null : 0.3,
      crossCountryTime: i % 4 ? 0.15 : null,
      actualInstrumentTime: i % 6 ? null : 0.2,
      simulatedInstrumentTime: i % 8 ? 0.1 : null,
    }),
  );

const fields = (t: ReturnType<typeof flightLogTotals>) => ({
  totalTime: t.totalTime,
  dualReceived: t.dualReceived,
  picTime: t.picTime,
  soloTime: t.soloTime,
  nightTime: t.nightTime,
  crossCountryTime: t.crossCountryTime,
  instrumentTime: t.instrumentTime,
  flights: t.flights,
});

describe("logbookPages", () => {
  it("uses ten flights a page", () => {
    expect(LOGBOOK_PAGE_SIZE).toBe(10);
  });

  it("returns no pages for no flights", () => {
    expect(logbookPages([])).toEqual([]);
    expect(logbookPages([makeJournalEntry()])).toEqual([]);
  });

  it("puts one flight on one page with nothing brought forward", () => {
    const pages = logbookPages(flights(1));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.broughtForward).toEqual(fields(flightLogTotals([])));
    expect(pages[0]!.broughtForward.totalTime).toBe(0);
  });

  it("splits at the page size", () => {
    expect(logbookPages(flights(10))).toHaveLength(1);
    const two = logbookPages(flights(11));
    expect(two).toHaveLength(2);
    expect(two[1]!.entries).toHaveLength(1);
    expect(two[1]!.number).toBe(2);
  });

  it("carries totals forward and ends on the summary totals", () => {
    const all = flights(300);
    const pages = logbookPages(all);
    expect(pages).toHaveLength(30);
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.broughtForward).toEqual(pages[i - 1]!.totalToDate);
    }
    expect(pages[29]!.totalToDate).toEqual(fields(flightLogTotals(all)));
  });

  it("counts empty times as zero and matches the tiles for odd hours", () => {
    const all = [
      makeJournalEntry({ id: "a", totalTime: 1.25 }),
      makeJournalEntry({ id: "b", totalTime: 0.35, picTime: 0.15 }),
    ];
    const page = logbookPages(all)[0]!;
    expect(page.thisPage).toEqual(fields(flightLogTotals(all)));
    expect(page.thisPage.soloTime).toBe(0);
  });

  it("sorts by date, then createdAt, then id, the same every time", () => {
    const mk = (id: string, date: string, createdAt: string) =>
      makeJournalEntry({ id, date, createdAt, totalTime: 1 });
    const input = [
      mk("z", "2099-01-01", "2026-01-01T00:00:00Z"),
      mk("b", "2026-05-01", "2026-05-01T09:00:00Z"),
      mk("a", "2026-05-01", "2026-05-01T09:00:00Z"),
      mk("c", "2026-05-01", "2026-05-01T08:00:00Z"),
    ];
    const ids = () => logbookPages(input)[0]!.entries.map((e) => e.id);
    expect(ids()).toEqual(["c", "a", "b", "z"]);
    expect(ids()).toEqual(["c", "a", "b", "z"]);
  });

  it("does not change the input", () => {
    const input = flights(15).reverse();
    const before = input.map((e) => e.id);
    logbookPages(input);
    expect(input.map((e) => e.id)).toEqual(before);
  });
});
