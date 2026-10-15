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
