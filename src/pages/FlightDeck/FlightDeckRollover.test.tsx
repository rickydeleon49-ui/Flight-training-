// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent } from "@/testing/factories";
import { FlightDeck } from "./FlightDeck";

const DATA = { ...EMPTY_DATA, events: [makeEvent({ id: "fictional-lesson", date: "2026-09-26", startTime: "10:00" })] };

vi.mock("@/components/dailyPlan/DailyPlanCard", () => ({ DailyPlanCard: () => null }));
vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useAppData: () => ({
    data: DATA,
    status: "ready",
    dataRevision: 1,
    repositories: {
      cardLibrary: { readReviewDue: async () => ({ materials: [], nextCursor: null, issues: [], summary: {} }) },
    },
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date(2026, 8, 25, 23, 59, 30));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("moves Next flight from Tomorrow to Today when the local day rolls over", async () => {
  render(h(MemoryRouter, null, h(FlightDeck)));
  expect(screen.getAllByText("Tomorrow").length).toBeGreaterThan(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(40_000);
  });
  expect(screen.queryByText("Tomorrow")).toBeNull();
  expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
});
