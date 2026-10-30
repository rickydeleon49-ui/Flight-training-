// @vitest-environment jsdom
/**
 * BUGFIX-064: with an empty title and a bad date, Save takes her to the title
 * (the upper field), not the date further down. Messages are unchanged.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { homework: [] }, mutate: async () => null }),
}));

import { ActionFormDialog } from "@/components/actions/ActionFormDialog";
import { GoalFormDialog } from "@/pages/FlightPath/GoalFormDialog";
import { MilestoneFormDialog } from "@/pages/FlightPath/MilestoneFormDialog";
import { TransactionFormDialog } from "@/pages/Finances/TransactionFormDialog";
import type { Milestone } from "@/domain/types";

afterEach(cleanup);

const NOT_A_DATE = "That isn't a date — try 11/05/2026.";
const milestone = { id: "m1", title: "Solo", description: "", status: "not_started", targetDate: null } as unknown as Milestone;

function emptyTitleAndBadDate(titleLabel: string, dateLabel: string, save: string, titleError: string, onSave: () => void) {
  fireEvent.change(screen.getByLabelText(titleLabel), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText(dateLabel), { target: { value: "13292026" } });
  fireEvent.click(screen.getByRole("button", { name: save }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText(titleError)).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText(titleLabel));
  // With the title filled, the date is checked next and its message is unchanged.
  fireEvent.change(screen.getByLabelText(titleLabel), { target: { value: "Something" } });
  fireEvent.click(screen.getByRole("button", { name: save }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText(NOT_A_DATE)).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText(dateLabel));
}

it("ActionFormDialog focuses the title before the due date", () => {
  const onSave = vi.fn();
  render(h(MemoryRouter, null, h(ActionFormDialog, { open: true, onClose: () => undefined, onSave })));
  emptyTitleAndBadDate("What needs to happen?", "Due date", "Add action",
    "Give this action a short title so you know what to do.", onSave);
});

it("GoalFormDialog focuses the goal name before the target date", () => {
  const onSave = vi.fn();
  render(h(GoalFormDialog, { open: true, milestoneId: null, milestones: [], onClose: () => undefined, onSave }));
  emptyTitleAndBadDate("Goal", "Target date", "Add goal", "Give this goal a short name.", onSave);
});

it("MilestoneFormDialog focuses the stage name before the target date", () => {
  const onSave = vi.fn();
  render(h(MilestoneFormDialog, { open: true, milestone, onClose: () => undefined, onSave }));
  emptyTitleAndBadDate("Name", "Target date", "Save changes", "Give this stage a name.", onSave);
});

it("POLISH-065: example hints start with 'e.g.' so they never look like a real value", () => {
  render(h(GoalFormDialog, { open: true, milestoneId: null, milestones: [], onClose: () => undefined, onSave: vi.fn() }));
  const goal = screen.getByLabelText("Goal") as HTMLInputElement;
  expect(goal.value).toBe("");
  expect(goal.placeholder).toBe("e.g. Crosswind landings");
  cleanup();
  render(h(TransactionFormDialog, { open: true, type: "expense", events: [], onClose: () => undefined, onSave: vi.fn() }));
  const amount = screen.getByLabelText(/^Amount/) as HTMLInputElement;
  expect(amount.value).toBe("");
  expect(amount.placeholder).toBe("e.g. 275");
});
