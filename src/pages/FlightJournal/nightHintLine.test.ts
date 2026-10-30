// @vitest-environment jsdom
/**
 * The quiet sunset / night line under Night flight time: it shows only when the
 * date and an airport resolve, is read out with the Night time input, and never
 * changes a field. jsdom only; the airport table is the real shipped one.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { loadAirportIndex } from "@/logic/nightHint";
import { JournalForm } from "./JournalForm";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function show() {
  const mutate = vi.fn(async () => null);
  const value = {
    repositories: null,
    data: EMPTY_DATA,
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
        { initialEntries: ["/journal/new"] },
        h(Routes, null, h(Route, { path: "/journal/new", element: h(JournalForm) })),
      ),
    ),
  );
  return mutate;
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const values = () =>
  ["Date", "Departure airport", "Arrival airport", "Night flight time", "Total flight time"].map(
    (label) => field(label).value,
  );
const lineText = /^At .+ on .+: sunset .+\. Night begins .+; night landings for currency count from .+\. Times are in your Mac's time zone\.$/;

describe("night hint line under Night flight time", () => {
  it("appears for a known airport, is tied to the input, and changes no field", async () => {
    await loadAirportIndex();
    const mutate = show();
    const night = field("Night flight time");
    expect(screen.queryByText(/Night begins/)).toBeNull();
    expect(night.getAttribute("aria-describedby")).toBeNull();

    fireEvent.change(field("Date"), { target: { value: "2026-11-05" } });
    fireEvent.change(field("Departure airport"), { target: { value: "kpao" } });
    fireEvent.change(night, { target: { value: "1.2" } });
    const before = values();

    const line = await screen.findByText(/Night begins/);
    expect(line.textContent).toMatch(lineText);
    expect(line.textContent).toMatch(/^At KPAO on Nov 5: sunset /);
    expect(line.className).toBe("field__hint");
    expect(night.getAttribute("aria-describedby")).toBe(line.id);
    expect(values()).toEqual(before);
    expect(values()).toEqual(["2026-11-05", "kpao", "", "1.2", ""]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("uses the arrival airport when departure is empty, and hides for unknown airports", async () => {
    show();
    fireEvent.change(field("Date"), { target: { value: "2026-11-05" } });
    fireEvent.change(field("Arrival airport"), { target: { value: "SQL" } });
    expect((await screen.findByText(/Night begins/)).textContent).toMatch(/^At SQL on Nov 5: /);

    fireEvent.change(field("Departure airport"), { target: { value: "NOPE1" } });
    await waitFor(() => expect(screen.queryByText(/Night begins/)).toBeNull());
    expect(field("Night flight time").getAttribute("aria-describedby")).toBeNull();

    fireEvent.change(field("Departure airport"), { target: { value: "" } });
    fireEvent.change(field("Date"), { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText(/Night begins/)).toBeNull());
    expect(values()).toEqual(["", "", "SQL", "", ""]);
  });
});
