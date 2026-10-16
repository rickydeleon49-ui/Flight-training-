// @vitest-environment jsdom
/**
 * Saved flights whose times don't add up (more dual than total, say) are
 * pointed out on the Flight log and on the entry itself, with a way to correct
 * them. The times are never changed and still count in the totals. jsdom only.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeJournalEntry } from "@/testing/factories";
import { FlightJournal } from "./FlightJournal";
import { JournalEntryDetail } from "./JournalEntryDetail";

afterEach(cleanup);

function show(path: string, data: Partial<AppData>) {
  const mutate = vi.fn(async () => null);
  const value = {
    repositories: null,
    data: { ...EMPTY_DATA, ...data },
    status: "ready",
    error: null,
    mutate,
    deleteWithUndo: () => undefined,
  } as unknown as ContextType<typeof AppDataContext>;
  render(
    h(
      AppDataContext.Provider,
      { value },
      h(
        MemoryRouter,
        { initialEntries: [path] },
        h(
          Routes,
          null,
          h(Route, { path: "/journal", element: h(FlightJournal) }),
          h(Route, { path: "/journal/:entryId", element: h(JournalEntryDetail) }),
        ),
      ),
    ),
  );
  return mutate;
}

const impossible = makeJournalEntry({
  id: "j1",
  date: "2026-09-10",
  title: "Pattern work",
  aircraftType: "C172",
  totalTime: 1.0,
  dualReceived: 1.2,
});
const fine = makeJournalEntry({ id: "j2", date: "2026-09-12", title: "Stalls", aircraftType: "C172", totalTime: 1.5, dualReceived: 1.5 });

describe("flights whose times don't add up", () => {
  it("are listed on the Flight log with a way to correct each, and still count in the totals", () => {
    const mutate = show("/journal", { journalEntries: [impossible, fine] });
    const note = screen.getByRole("note", { name: "Flights to check" });
    expect(screen.getByText("One flight's times don't add up")).toBeTruthy();
    expect(within(note).getByText(/Nothing has been changed/)).toBeTruthy();
    expect(within(note).getByText("Dual received time can't be more than this flight's total time of 1.0 hr.")).toBeTruthy();
    expect(within(note).getByRole("link", { name: /Pattern work/ }).getAttribute("href")).toBe("/journal/j1");
    expect(within(note).getByRole("link", { name: "Correct times" }).getAttribute("href")).toBe("/journal/j1/edit");
    expect(within(note).queryByText(/Stalls/)).toBeNull();
    // The logged times are kept: training received is 1.2 + 1.5.
    const summary = document.querySelector(".flight-log-summary") as HTMLElement;
    expect(within(summary).getByText("Training received").nextElementSibling?.textContent).toBe("2.7");
    expect(screen.getByText(/These totals include the flights above whose times don't add up yet/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("are not mentioned when every flight adds up", () => {
    show("/journal", { journalEntries: [fine] });
    expect(screen.queryByRole("note", { name: "Flights to check" })).toBeNull();
    expect(screen.queryByText(/don't add up yet/)).toBeNull();
  });

  it("explain the problem on the entry itself", () => {
    show("/journal/j1", { journalEntries: [impossible] });
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/^Dual received time can't be more than this flight's total time of 1\.0 hr\. These times are kept as you entered them/);
    expect(within(note).getByRole("link", { name: "Correct times" }).getAttribute("href")).toBe("/journal/j1/edit");
  });
});
