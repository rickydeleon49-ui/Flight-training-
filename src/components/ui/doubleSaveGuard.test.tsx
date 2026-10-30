// @vitest-environment jsdom
// A fast double-click on Save must create one record, never two, and a save
// that did not go through must leave Save usable so she can try again.
import { createElement as h, type ContextType, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionFormDialog } from "@/components/actions/ActionFormDialog";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { Finances } from "@/pages/Finances/Finances";
import { TransactionFormDialog } from "@/pages/Finances/TransactionFormDialog";
import { FlightPath } from "@/pages/FlightPath/FlightPath";
import { GoalFormDialog } from "@/pages/FlightPath/GoalFormDialog";
import { MilestoneFormDialog } from "@/pages/FlightPath/MilestoneFormDialog";
import { PilotToolkit } from "@/pages/PilotToolkit/PilotToolkit";
import { Questions } from "@/pages/Questions/Questions";
import { EventFormDialog } from "@/pages/Schedule/EventFormDialog";
import { AppDataContext, EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeMilestone, makeTransaction } from "@/testing/factories";

vi.mock("@/pages/FlightPath/skills/SkillsSection", () => ({ SkillsSection: () => null }));

afterEach(cleanup);

/**
 * onSave (or mutate) that holds each save open until the test releases it.
 * It then resolves with null: mutate's "this write failed" answer, so the
 * form keeps her text and stays open.
 */
function slowSave() {
  const pending: Array<() => void> = [];
  // Typed as void for the dialogs' onSave; the value at run time is null.
  const fn = vi.fn(() => new Promise<void>((resolve) => { pending.push(() => resolve(null as unknown as void)); }));
  return { fn, release: () => pending.shift()?.() };
}

function withData(component: ReactElement, data: Partial<AppData> = {}, mutate = vi.fn()) {
  const value = {
    repositories: null,
    data: { ...EMPTY_DATA, ...data },
    visibleData: { ...EMPTY_DATA, ...data },
    status: "ready",
    error: null,
    mutate,
    deleteWithUndo: vi.fn(),
  } as unknown as ContextType<typeof AppDataContext>;
  return render(h(AppDataContext.Provider, { value }, h(MemoryRouter, null, component)));
}

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

/** Two fast clicks → one save; while saving the button says so; after a failed save it works again. */
async function expectGuarded(name: string, save: ReturnType<typeof slowSave>) {
  fireEvent.click(button(name));
  fireEvent.click(screen.getByRole("button", { name: /Saving…|^Add$/ }));
  await waitFor(() => expect(save.fn).toHaveBeenCalledTimes(1));
  expect(button("Saving…").disabled).toBe(true);
  // The parent kept the dialog open (the write failed): Save is back.
  save.release();
  await waitFor(() => expect(button(name).disabled).toBe(false));
  fireEvent.click(button(name));
  await waitFor(() => expect(save.fn).toHaveBeenCalledTimes(2));
  save.release();
}

describe("form dialogs save once on a double-click", () => {
  it("ActionFormDialog", async () => {
    const save = slowSave();
    withData(h(ActionFormDialog, { open: true, onClose: vi.fn(), onSave: save.fn }));
    fireEvent.change(screen.getByLabelText("What needs to happen?"), { target: { value: "Read chapter 3" } });
    await expectGuarded("Add action", save);
  });

  it("TransactionFormDialog", async () => {
    const save = slowSave();
    render(h(TransactionFormDialog, { open: true, type: "expense", events: [], onClose: vi.fn(), onSave: save.fn }));
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "275" } });
    await expectGuarded("Record expense", save);
  });

  it("EventFormDialog", async () => {
    const save = slowSave();
    render(h(EventFormDialog, { open: true, goals: [], onClose: vi.fn(), onSave: save.fn }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pattern work" } });
    await expectGuarded("Add event", save);
  });

  it("GoalFormDialog", async () => {
    const save = slowSave();
    render(h(GoalFormDialog, { open: true, milestoneId: null, milestones: [], onClose: vi.fn(), onSave: save.fn }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Smooth landings" } });
    await expectGuarded("Add goal", save);
  });

  it("MilestoneFormDialog", async () => {
    const save = slowSave();
    render(h(MilestoneFormDialog, { open: true, milestone: makeMilestone(), onClose: vi.fn(), onSave: save.fn }));
    await expectGuarded("Save changes", save);
  });

  it("Finances savings target", async () => {
    const save = slowSave();
    withData(h(Finances), { transactions: [makeTransaction({ amount: 1000, description: "Fuel" })] }, save.fn);
    fireEvent.click(button("Set one"));
    fireEvent.change(screen.getByLabelText("Target amount"), { target: { value: "5000" } });
    await expectGuarded("Save target", save);
  });
});

describe("quick-add boxes save once on a double-click or held Enter", () => {
  it("Questions › Save question", async () => {
    const save = slowSave();
    withData(h(Questions), {}, save.fn);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "How much rudder?" } });
    await expectGuarded("Save question", save);
  });

  it("Flight Path › first milestone (Enter twice)", async () => {
    const save = slowSave();
    withData(h(FlightPath), { profile: { ...EMPTY_DATA.profile, flightSchool: "School" } }, save.fn);
    const box = screen.getByLabelText("New milestone");
    fireEvent.change(box, { target: { value: "Ground school" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(save.fn).toHaveBeenCalledTimes(1));
    expect(button("Add").disabled).toBe(true);
    save.release();
    await waitFor(() => expect(button("Add").disabled).toBe(false));
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(save.fn).toHaveBeenCalledTimes(2));
    save.release();
  });

  it("Pilot Toolkit › Safety check-in", async () => {
    const save = slowSave();
    withData(h(PilotToolkit), { toolkit: DEFAULT_TOOLKIT_STATE }, save.fn);
    fireEvent.click(screen.getByRole("tab", { name: "Safety Check" }));
    await expectGuarded("Save this check-in", save);
  });

  it("Pilot Toolkit › Add record", async () => {
    const save = slowSave();
    withData(h(PilotToolkit), { toolkit: DEFAULT_TOOLKIT_STATE }, save.fn);
    fireEvent.click(screen.getByRole("tab", { name: "Certificates" }));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Student pilot certificate" } });
    await expectGuarded("Add record", save);
  });
});
