// @vitest-environment jsdom
/** Header actions on the Flight Log & Journal page: Add debrief link, More menu, hours label. jsdom only. */
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeJournalEntry } from "@/testing/factories";
import { FlightJournal } from "./FlightJournal";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

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

const entry = makeJournalEntry({ id: "j1", date: "2026-03-02", aircraftType: "C172", totalTime: 1.3 });

describe("Flight Journal header", () => {
  it("Add debrief links to the quick-debrief path on the debriefs view", () => {
    show({ journalEntries: [entry] });
    fireEvent.click(screen.getByRole("button", { name: /debriefs/i }));
    const link = screen.getByRole("link", { name: /Add debrief/ });
    expect(link.getAttribute("href")).toContain("mode=quick");
  });

  it("Escape closes the More menu and returns focus to its summary", () => {
    show({ journalEntries: [entry] });
    const summary = screen.getByText("More");
    const menu = summary.closest("details") as HTMLDetailsElement;
    fireEvent.click(summary);
    expect(menu.open).toBe(true);
    fireEvent.keyDown(summary, { key: "Escape" });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("a pointer press outside the More menu closes it", () => {
    show({ journalEntries: [entry] });
    const summary = screen.getByText("More");
    const menu = summary.closest("details") as HTMLDetailsElement;
    fireEvent.click(summary);
    expect(menu.open).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(menu.open).toBe(false);
  });

  it("the hours cell's text includes the word hours", () => {
    show({ journalEntries: [entry] });
    fireEvent.click(screen.getByRole("button", { name: /debriefs/i }));
    const cell = document.querySelector(".journal-entry__hours") as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.textContent).toContain("hours");
  });
});
