// @vitest-environment jsdom
/**
 * The Cost card offers to record a lesson's cost as an expense only when that
 * is money she actually spent: never a cancelled lesson's estimate, and never
 * an amount of zero or less saved before the form refused them. jsdom only.
 */
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduleEvent } from "@/domain/types";
import { addDays, todayIso } from "@/lib/dates";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent } from "@/testing/factories";
import { EventDetail } from "./EventDetail";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function show(event: ScheduleEvent, hash = "") {
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
      h(MemoryRouter, { initialEntries: [`/schedule/${event.id}${hash}`] },
        h(Routes, null, h(Route, { path: "/schedule/:eventId", element: h(EventDetail) }))),
    ),
  );
}

const yesterday = addDays(todayIso(), -1);

it("opens the existing Preparation heading from a Related study lesson link", () => {
  const scroll = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: scroll, configurable: true });
  try {
    show(makeEvent({ id: "synthetic-lesson" }), "#lesson-preparation");
    const heading = document.getElementById("lesson-preparation")!;
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  } finally {
    if (previous) Object.defineProperty(Element.prototype, "scrollIntoView", previous);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});

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

it("makes preparation examples hints and enables the primary Add only for text", () => {
  show(makeEvent({ id: "prep-synthetic" }));
  const input = screen.getByRole("textbox", { name: "New preparation item" });
  expect(input.getAttribute("placeholder")).toBe("e.g. Weather review");
  const add = input.parentElement!.querySelector("button")!;
  expect(add.classList.contains("button--primary")).toBe(true);
  expect(add.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "Review fictional pattern notes" } });
  expect(add.disabled).toBe(false);
  fireEvent.change(input, { target: { value: "   " } });
  expect(add.disabled).toBe(true);
});
