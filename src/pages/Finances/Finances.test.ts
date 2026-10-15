// @vitest-environment jsdom
/**
 * The "What training is costing" card counts a lesson once however many
 * expenses it was paid with, gives cost per flight hour only from lessons
 * with both a cost and logged time (saying how many), and points out a lesson
 * whose recorded total sits beside separate lesson expenses. jsdom only.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent, makeJournalEntry, makeTransaction } from "@/testing/factories";
import { Finances } from "./Finances";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function show(data: Partial<AppData>) {
  const value = {
    repositories: null,
    data: { ...EMPTY_DATA, ...data },
    status: "ready",
    error: null,
    mutate: async () => null,
    deleteWithUndo: () => undefined,
  } as unknown as ContextType<typeof AppDataContext>;
  return render(h(AppDataContext.Provider, { value }, h(MemoryRouter, null, h(Finances))));
}

function insight(label: string): string {
  const card = screen.getByText("What training is costing").closest(".card") as HTMLElement;
  const labelNode = within(card).getByText(label);
  return labelNode.nextElementSibling?.textContent ?? "";
}

describe("Finances: what training is costing", () => {
  it("counts instruction plus rental for one lesson once and prices flight hours from the same lessons", () => {
    show({
      events: [makeEvent({ id: "e1", title: "Pattern work" }), makeEvent({ id: "e2", title: "Stalls" })],
      transactions: [
        makeTransaction({ amount: 150_00, category: "instructor", eventId: "e1", description: "CFI" }),
        makeTransaction({ amount: 180_00, category: "aircraft_rental", eventId: "e1", description: "C172" }),
        makeTransaction({ amount: 300_00, category: "flight_lesson", eventId: "e2", description: "Stalls" }),
      ],
      journalEntries: [makeJournalEntry({ eventId: "e1", totalTime: 1.5 })],
    });
    expect(insight("Paid lessons")).toBe("2");
    expect(insight("Average lesson")).toBe("$315");
    expect(insight("Per flight hour")).toBe("$220");
    expect(screen.getByTestId("per-hour-basis").textContent).toBe(
      "Per flight hour uses 1 of 2 lessons: those with logged flight time (1.5 hr).",
    );
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says what per flight hour needs instead of inventing a rate", () => {
    show({
      transactions: [makeTransaction({ amount: 200_00, category: "flight_lesson" })],
      journalEntries: [makeJournalEntry({ totalTime: 1.2 })],
    });
    expect(insight("Per flight hour")).toBe("—");
    expect(screen.getByTestId("per-hour-basis").textContent).toMatch(/needs a lesson with a recorded cost and a journal entry/);
  });

  it("points out a lesson whose recorded total sits beside separate lesson expenses", () => {
    show({
      events: [makeEvent({ id: "e1", title: "Cross-country" })],
      transactions: [
        makeTransaction({ amount: 330_00, category: "flight_lesson", eventId: "e1", source: "lesson_cost", description: "Lesson" }),
        makeTransaction({ amount: 180_00, category: "aircraft_rental", eventId: "e1", description: "Rental" }),
      ],
    });
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/One lesson has a recorded lesson total and separate lesson expenses/);
    const link = within(note).getByRole("link", { name: "Cross-country" });
    expect(link.getAttribute("href")).toBe("/schedule/e1");
    expect(within(note).getByText("$510")).toBeTruthy();
    // Reported, not dropped: the money she recorded still counts.
    expect(insight("Average lesson")).toBe("$510");
  });
});

describe("Finances: spending by month", () => {
  it("lists recorded spending for six months, newest first, with the lesson share", () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    show({
      transactions: [
        makeTransaction({ amount: 300_00, category: "flight_lesson", date: `${thisMonth}-01`, description: "Lesson" }),
        makeTransaction({ amount: 45_00, category: "books", date: `${thisMonth}-01`, description: "PHAK" }),
      ],
    });
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(7);
    const first = within(rows[1]!).getAllByRole("cell").map((c) => c.textContent);
    expect(first).toEqual(["$345", "$300"]);
    expect(within(rows[6]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["$0", "$0"]);
  });
});
