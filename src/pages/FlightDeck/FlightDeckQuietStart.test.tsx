// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryReviewDueResult } from "@/domain/types";
import { EMPTY_DATA } from "@/state/AppDataContext";
import { FlightDeck } from "./FlightDeck";

const DATA = {
  ...EMPTY_DATA,
  actions: [
    {
      id: "a1", title: "Study", description: "", category: "non_negotiable", priority: "high", status: "open",
      dueDate: null, estimatedMinutes: null, relatedType: null, relatedId: null, materialId: null,
      createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", completedAt: null,
    },
  ],
} as unknown as typeof EMPTY_DATA;

let materials: unknown[] = [];
const quietProps: boolean[] = [];

vi.mock("@/components/dailyPlan/DailyPlanCard", () => ({
  DailyPlanCard: ({ quietStart }: { quietStart?: boolean }) => {
    quietProps.push(Boolean(quietStart));
    return null;
  },
}));

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useAppData: () => ({
    data: DATA,
    status: "ready",
    dataRevision: 1,
    repositories: {
      cardLibrary: {
        readReviewDue: async () =>
          ({ materials, nextCursor: null, issues: [], summary: {} }) as unknown as LibraryReviewDueResult,
      },
    },
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

afterEach(() => {
  cleanup();
  quietProps.length = 0;
});

const material = { materialId: "m1", title: "A", topic: "weather", againCount: 0, dayCount: 0, newCount: 3, totalDueCount: 3 };

describe("Flight Deck daily plan start button", () => {
  it("is primary when nothing is due", async () => {
    materials = [];
    render(h(MemoryRouter, null, h(FlightDeck)));
    await waitFor(() => expect(quietProps.at(-1)).toBe(false));
  });

  it("stays quiet while the review card has the primary button", async () => {
    materials = [material];
    render(h(MemoryRouter, null, h(FlightDeck)));
    await new Promise((r) => setTimeout(r, 100));
    expect(quietProps.at(-1)).toBe(true);
  });
});

describe("Flight Deck header", () => {
  it("shows reminder status in one line and a labelled Add action", async () => {
    materials = [];
    render(h(MemoryRouter, null, h(FlightDeck)));
    expect((await screen.findByTestId("reminder-status")).textContent).toBe("Reminders off · Turn on");
    const add = screen.getByRole("button", { name: "Add action" });
    expect(add.textContent).toContain("Add action");
  });
});

describe("DailyPlanCard", () => {
  it("keeps layout in dailyPlan.css, not inline styles", () => {
    const src = readFileSync("src/components/dailyPlan/DailyPlanCard.tsx", "utf8");
    expect(src).not.toMatch(/style=\{\{/);
  });
});
