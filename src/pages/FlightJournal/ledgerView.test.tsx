// @vitest-environment jsdom
/** The flight log shows one ledger page at a time, with totals under it. jsdom only. */
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logbookPages } from "@/logic/logbookPages";
import { AppDataContext, EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeJournalEntry } from "@/testing/factories";
import { FlightJournal } from "./FlightJournal";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

const flights = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    makeJournalEntry({
      id: `j${String(i).padStart(3, "0")}`,
      date: `2026-${String(1 + Math.floor(i / 20)).padStart(2, "0")}-${String(1 + (i % 20)).padStart(2, "0")}`,
      aircraftType: "C172",
      totalTime: 1.1,
      dualReceived: 0.6,
      picTime: 0.5,
      soloTime: 0.3,
      nightTime: 0.2,
    }),
  );

function show(data: Partial<AppData>) {
  const value = {
    repositories: null,
    data: { ...EMPTY_DATA, ...data },
    status: "ready",
    error: null,
    mutate: vi.fn(async () => null),
    deleteWithUndo: () => undefined,
  } as unknown as ContextType<typeof AppDataContext>;
  return render(h(AppDataContext.Provider, { value }, h(MemoryRouter, null, h(FlightJournal))));
}
const rows = () => document.querySelectorAll(".flight-log-table tbody tr");
const footer = () =>
  Array.from(document.querySelectorAll(".flight-log-table tfoot tr")).map((tr) =>
    Array.from(tr.children).map((c) => c.textContent),
  );

describe("ledger pages on screen", () => {
  it("opens on the last page: 25 flights is page 3 of 3 with 5 rows", () => {
    show({ journalEntries: flights(25) });
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    expect(rows().length).toBe(5);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("previous shows 10 rows and the footer matches logbookPages", () => {
    const entries = flights(25);
    show({ journalEntries: entries });
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(rows().length).toBe(10);
    const page = logbookPages(entries)[1]!;
    expect(footer()).toEqual([
      ["This page", page.thisPage.totalTime.toFixed(1), page.thisPage.dualReceived.toFixed(1), page.thisPage.picTime.toFixed(1), page.thisPage.soloTime.toFixed(1), page.thisPage.nightTime.toFixed(1)],
      ["Brought forward", page.broughtForward.totalTime.toFixed(1), page.broughtForward.dualReceived.toFixed(1), page.broughtForward.picTime.toFixed(1), page.broughtForward.soloTime.toFixed(1), page.broughtForward.nightTime.toFixed(1)],
      ["Total to date", page.totalToDate.totalTime.toFixed(1), page.totalToDate.dualReceived.toFixed(1), page.totalToDate.picTime.toFixed(1), page.totalToDate.soloTime.toFixed(1), page.totalToDate.nightTime.toFixed(1)],
    ]);
  });

  it("the last page's total to date equals the summary tiles", () => {
    show({ journalEntries: flights(25) });
    const total = footer()[2]!;
    const tiles = document.querySelector(".flight-log-summary") as HTMLElement;
    expect(tiles.textContent).toContain(`Total time${total[1]}`);
    expect(tiles.textContent).toContain(`Training received${total[2]}`);
    expect(tiles.textContent).toContain(`Night${total[5]}`);
  });

  it("remembers the page after a remount and clamps a stale value", () => {
    const first = show({ journalEntries: flights(25) });
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    first.unmount();
    show({ journalEntries: flights(25) });
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    cleanup();
    window.sessionStorage.setItem("flightdeck.logbookPage", "99");
    show({ journalEntries: flights(25) });
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
  });

  it("one page has no picker, and dates read like 12 Nov 2026", () => {
    show({ journalEntries: [makeJournalEntry({ id: "a", date: "2026-11-12", totalTime: 1 })] });
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(screen.getByText("12 Nov 2026")).toBeTruthy();
  });
  it("every time cell has a data-label and the date link is the only link per row", () => {
    show({ journalEntries: flights(5) });
    const labels = ["Total", "Dual", "PIC", "Solo", "Night"];
    rows().forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).slice(3);
      expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(labels);
      expect(tr.querySelectorAll("a").length).toBe(1);
    });
    document.querySelectorAll(".flight-log-table tfoot tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td"));
      expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(labels);
    });
  });
});
