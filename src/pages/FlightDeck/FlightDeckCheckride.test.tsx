// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, todayIso } from "@/lib/dates";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { FlightDeck } from "./FlightDeck";

let appData: AppData;

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useAppData: () => ({
    data: appData,
    status: "ready",
    dataRevision: 1,
    repositories: null,
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

const withDate = (checkrideDate: string | null | undefined) => {
  appData = { ...EMPTY_DATA, toolkit: { ...EMPTY_DATA.toolkit, checkrideDate } };
};
const countdown = () => screen.queryByTestId("checkride-countdown");

beforeEach(() => withDate(undefined));
afterEach(cleanup);

describe("Flight Deck checkride countdown", () => {
  it("shows days to go, once in the line and once in Dates ahead", () => {
    withDate(addDays(todayIso(), 12));
    render(h(MemoryRouter, null, h(FlightDeck)));
    expect(countdown()?.textContent).toBe("12 days to your checkride");
    expect(screen.getAllByText("Checkride")).toHaveLength(1);
  });

  it("says 1 day and the day-of line", () => {
    withDate(addDays(todayIso(), 1));
    render(h(MemoryRouter, null, h(FlightDeck)));
    expect(countdown()?.textContent).toBe("1 day to your checkride");
    cleanup();
    withDate(todayIso());
    render(h(MemoryRouter, null, h(FlightDeck)));
    expect(countdown()?.textContent).toBe("Checkride today — you've got this");
  });

  it("is hidden when unset or passed", () => {
    render(h(MemoryRouter, null, h(FlightDeck)));
    expect(countdown()).toBeNull();
    cleanup();
    withDate(addDays(todayIso(), -1));
    render(h(MemoryRouter, null, h(FlightDeck)));
    expect(countdown()).toBeNull();
    expect(screen.queryByText("Checkride")).toBeNull();
  });
});
