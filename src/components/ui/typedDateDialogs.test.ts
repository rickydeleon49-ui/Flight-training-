// @vitest-environment jsdom
/**
 * DATES-01: every dialog with a date uses the one typed date field. Typing
 * 11052026 in one go saves 2026-11-05; a day that doesn't exist is refused
 * plainly and nothing is saved. jsdom only.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { homework: [] }, mutate: async () => null }),
}));

import { ActionFormDialog } from "@/components/actions/ActionFormDialog";
import { RescheduleDialog } from "@/components/actions/RescheduleDialog";
import { GoalFormDialog } from "@/pages/FlightPath/GoalFormDialog";
import { MilestoneFormDialog } from "@/pages/FlightPath/MilestoneFormDialog";
import { TransactionFormDialog } from "@/pages/Finances/TransactionFormDialog";
import type { Milestone, NextAction } from "@/domain/types";

afterEach(cleanup);

const NOT_A_DATE = "That isn't a date — try 11/05/2026.";
const inRouter = (element: ReturnType<typeof h>) => render(h(MemoryRouter, null, element));

function typeDate(label: string, typed: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  expect(input.type).toBe("text");
  fireEvent.change(input, { target: { value: typed } });
  return input;
}

const action = { id: "a1", title: "Read notes", description: "", category: "prepare", priority: "important", dueDate: null,
  estimatedMinutes: null, relatedType: null, relatedId: null } as unknown as NextAction;
const milestone = { id: "m1", title: "Solo", description: "", status: "not_started", targetDate: null } as unknown as Milestone;

describe("DATES-01 dialogs save a typed date as typed", () => {
  it("ActionFormDialog: due date", () => {
    const onSave = vi.fn();
    inRouter(h(ActionFormDialog, { open: true, onClose: () => undefined, onSave }));
    fireEvent.change(screen.getByLabelText("What needs to happen?"), { target: { value: "Read notes" } });
    typeDate("Due date", "13292026");
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(NOT_A_DATE)).toBeTruthy();
    typeDate("Due date", "11052026");
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueDate: "2026-11-05" }));
  });

  it("ActionFormDialog: an empty due date stays allowed", () => {
    const onSave = vi.fn();
    inRouter(h(ActionFormDialog, { open: true, action, onClose: () => undefined, onSave }));
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueDate: null }));
  });

  it("RescheduleDialog: or type a date", () => {
    const onReschedule = vi.fn();
    inRouter(h(RescheduleDialog, { action, onClose: () => undefined, onReschedule }));
    typeDate("Or type a date", "02/30/2026");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByText(NOT_A_DATE)).toBeTruthy();
    typeDate("Or type a date", "");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(onReschedule).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a date.")).toBeTruthy();
    typeDate("Or type a date", "11052026");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(onReschedule).toHaveBeenCalledWith(action, "2026-11-05");
  });

  it("RescheduleDialog: a quick choice replaces the typed text", () => {
    inRouter(h(RescheduleDialog, { action, onClose: () => undefined, onReschedule: vi.fn() }));
    const input = typeDate("Or type a date", "11052026");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(input.value).not.toBe("11052026");
    expect(input.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("GoalFormDialog: target date, optional", () => {
    const onSave = vi.fn();
    render(h(GoalFormDialog, { open: true, milestoneId: null, milestones: [], onClose: () => undefined, onSave }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Crosswinds" } });
    typeDate("Target date", "11/31/2026");
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(onSave).not.toHaveBeenCalled();
    typeDate("Target date", "");
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ targetDate: null }));
    typeDate("Target date", "11052026");
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ targetDate: "2026-11-05" }));
  });

  it("MilestoneFormDialog: target date, optional", () => {
    const onSave = vi.fn();
    render(h(MilestoneFormDialog, { open: true, milestone, onClose: () => undefined, onSave }));
    typeDate("Target date", "abc");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(NOT_A_DATE)).toBeTruthy();
    typeDate("Target date", "11052026");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ targetDate: "2026-11-05" }));
  });

  it("TransactionFormDialog: date, required", () => {
    const onSave = vi.fn();
    render(h(TransactionFormDialog, { open: true, type: "expense", events: [], onClose: () => undefined, onSave }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "120" } });
    typeDate("Date", "13292026");
    fireEvent.click(screen.getByRole("button", { name: /Record|Add|Save/ }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(NOT_A_DATE)).toBeTruthy();
    typeDate("Date", "");
    fireEvent.click(screen.getByRole("button", { name: /Record|Add|Save/ }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a date.")).toBeTruthy();
    typeDate("Date", "11052026");
    expect(screen.getByText("That's Thursday, November 5, 2026.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Record|Add|Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-05", amount: 120_00 }));
  });
});

it("no native date input remains in src (tests excluded)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.|\.bench\./.test(name)) {
        if (/type=["']date["']|type:\s*["']date["']/.test(readFileSync(path, "utf8"))) found.push(path);
      }
    }
  };
  walk(join(process.cwd(), "src"));
  expect(found).toEqual([]);
});
