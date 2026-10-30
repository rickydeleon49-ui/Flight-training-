// @vitest-environment jsdom
/**
 * A lesson's cost follows the same rule as an expense in Finances: more than
 * zero, or blank. A negative cost would otherwise offer to record a negative
 * expense. jsdom only.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventFormDialog } from "./EventFormDialog";

afterEach(cleanup);

function show() {
  const onSave = vi.fn();
  render(h(EventFormDialog, { open: true, goals: [], onClose: () => undefined, onSave }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Stalls" } });
  return onSave;
}

describe("EventFormDialog costs", () => {
  it("refuses a negative or zero cost and explains why", () => {
    const onSave = show();
    fireEvent.change(screen.getByLabelText("Estimated cost"), { target: { value: "-150" } });
    fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter an amount greater than zero, or leave it blank.")).toHaveLength(2);
  });

  it("saves a positive cost, or none", () => {
    const onSave = show();
    fireEvent.change(screen.getByLabelText("Estimated cost"), { target: { value: "275.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ estimatedCost: 275_50, actualCost: null }));
  });
});

it("marks the empty event title placeholder as an example", () => {
  render(h(EventFormDialog, { open: true, goals: [], onClose: () => undefined, onSave: vi.fn() }));
  const title = screen.getByLabelText("Title") as HTMLInputElement;
  expect(title.value).toBe("");
  expect(title.placeholder).toBe("e.g. Crosswind landings");
  expect(title.classList.contains("input")).toBe(true);
});

describe("QUICKFIX-01 event date is typed and never changed", () => {
  it("saves 11052026 typed in one go as November 5, 2026, and reads it back in words", () => {
    const onSave = show();
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    expect(date.type).toBe("text");
    expect(date.placeholder).toBe("e.g. 11/05/2026");
    fireEvent.change(date, { target: { value: "11052026" } });
    const hint = screen.getByText("That's Thursday, November 5, 2026.");
    expect(date.getAttribute("aria-describedby")).toBe(hint.id);
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-05" }));
  });

  it("refuses a date that doesn't exist with a plain line, and saves nothing", () => {
    const onSave = show();
    const date = screen.getByLabelText("Date");
    fireEvent.change(date, { target: { value: "13/29/2026" } });
    fireEvent.blur(date);
    expect(screen.getByText("That isn't a date — try 11/05/2026.")).toBeTruthy();
    expect(screen.queryByText(/^That's /)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: "12/29/2026" } });
    expect(screen.queryByText("That isn't a date — try 11/05/2026.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-12-29" }));
  });

  it("shows an existing event's date the way she types it", () => {
    render(h(EventFormDialog, {
      open: true, goals: [], onClose: () => undefined, onSave: vi.fn(),
      event: { id: "e1", title: "Stalls", eventType: "flight_lesson", date: "2026-11-05", startTime: null, endTime: null,
        location: "", instructor: "", notes: "", goalId: null, estimatedCost: null, actualCost: null, status: "scheduled" } as never,
    }));
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("11/05/2026");
  });

  it("shows no read back for an empty date, only the existing error on save", () => {
    show();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    expect(screen.queryByText(/^That's /)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    expect(screen.getByText("Choose a date.")).toBeTruthy();
  });

  it("marks the other example placeholders with e.g.", () => {
    show();
    expect((screen.getByLabelText("Location") as HTMLInputElement).placeholder).toBe("e.g. Cedar Field");
    expect((screen.getByLabelText("Estimated cost") as HTMLInputElement).placeholder).toBe("e.g. 275");
    expect((screen.getByLabelText("Actual cost") as HTMLInputElement).placeholder).toBe("e.g. 265");
  });
});
