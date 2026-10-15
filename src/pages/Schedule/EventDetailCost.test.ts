// @vitest-environment jsdom
/**
 * The Cost card offers to record a lesson's cost as an expense only when that
 * is money she actually spent: never a cancelled lesson's estimate, and never
 * an amount of zero or less saved before the form refused them. jsdom only.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { ScheduleEvent } from "@/domain/types";
import { addDays, todayIso } from "@/lib/dates";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent } from "@/testing/factories";
import { EventDetail } from "./EventDetail";

afterEach(cleanup);

function show(event: ScheduleEvent) {
  const value = {
    repositories: null,
    data: { ...EMPTY_DATA, events: [event] },
    status: "ready",
    error: null,
    mutate: async () => null,
    deleteWithUndo: () => undefined,
  } as unknown as ContextType<typeof AppDataContext>;
  render(
    h(
      AppDataContext.Provider,
      { value },
      h(MemoryRouter, { initialEntries: [`/schedule/${event.id}`] },
        h(Routes, null, h(Route, { path: "/schedule/:eventId", element: h(EventDetail) }))),
    ),
  );
}

const yesterday = addDays(todayIso(), -1);

describe("EventDetail cost recording", () => {
  it("offers to record a past lesson's estimate", () => {
    show(makeEvent({ id: "e1", date: yesterday, estimatedCost: 275_00 }));
    expect(screen.getByRole("button", { name: "Record $275 as an expense" })).toBeTruthy();
  });

  it("does not record a cancelled lesson's estimate", () => {
    show(makeEvent({ id: "e1", date: yesterday, estimatedCost: 275_00, status: "cancelled" }));
    expect(screen.queryByRole("button", { name: /as an expense/ })).toBeNull();
    expect(screen.getByText(/This lesson was cancelled, so its estimate isn't recorded/)).toBeTruthy();
  });

  it("records a cancellation fee entered as the actual cost", () => {
    show(makeEvent({ id: "e1", date: yesterday, estimatedCost: 275_00, actualCost: 50_00, status: "cancelled" }));
    expect(screen.getByRole("button", { name: "Record $50 as an expense" })).toBeTruthy();
  });

  it("does not offer to record a cost of zero or less", () => {
    show(makeEvent({ id: "e1", date: yesterday, actualCost: -150_00 }));
    expect(screen.queryByRole("button", { name: /as an expense/ })).toBeNull();
    expect(screen.getByText(/Edit this lesson's cost to an amount above zero/)).toBeTruthy();
  });
});
