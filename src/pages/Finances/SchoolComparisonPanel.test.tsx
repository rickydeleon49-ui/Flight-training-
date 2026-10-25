// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlightSchool } from "@/domain/types";
import { AppDataContext, EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeFlightSchool, makeTransaction } from "@/testing/factories";
import { Finances } from "./Finances";
import { SchoolComparisonPanel } from "./SchoolComparisonPanel";
import { SchoolFormDialog } from "./SchoolFormDialog";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderWithContext(
  component: React.ReactElement,
  data: Partial<AppData> = {},
  overrides: Record<string, unknown> = {},
) {
  const value = {
    repositories: null,
    data: { ...EMPTY_DATA, ...data },
    status: "ready",
    error: null,
    mutate: vi.fn().mockResolvedValue(true),
    deleteWithUndo: vi.fn(),
    ...overrides,
  } as unknown as ContextType<typeof AppDataContext>;

  return {
    ...render(
      h(AppDataContext.Provider, { value }, h(MemoryRouter, null, component)),
    ),
    contextValue: value,
  };
}

describe("SchoolComparisonPanel and SchoolFormDialog", () => {
  it("is visible in Finances when transactions list is empty", () => {
    renderWithContext(h(Finances), { transactions: [], flightSchools: [] });
    expect(screen.getByText("Compare flight schools")).toBeTruthy();
    expect(screen.getByText("No flight schools added yet")).toBeTruthy();
  });

  it("is visible in Finances when transactions exist", () => {
    const txn = makeTransaction({ amount: 10000, description: "Fuel" });
    renderWithContext(h(Finances), { transactions: [txn], flightSchools: [] });
    expect(screen.getByText("Compare flight schools")).toBeTruthy();
  });

  it("renders two-school comparison distinguishing unknown vs zero cost", () => {
    const schoolUnknown = makeFlightSchool({
      id: "s1",
      name: "Sierra Academy",
      hourlyCostCents: null,
      trainingTrack: null,
    });
    const schoolZero = makeFlightSchool({
      id: "s2",
      name: "Club Partnership",
      hourlyCostCents: 0,
      trainingTrack: "Part 61",
    });

    renderWithContext(h(SchoolComparisonPanel), {
      flightSchools: [schoolUnknown, schoolZero],
    });

    expect(screen.getByText("Sierra Academy")).toBeTruthy();
    expect(screen.getByText("Rate not quoted")).toBeTruthy();
    expect(screen.getByText("Track not added")).toBeTruthy();

    expect(screen.getByText("Club Partnership")).toBeTruthy();
    expect(screen.getByText("$0 / hour")).toBeTruthy();
    expect(within(screen.getByTestId("school-card-s2")).getByText("Part 61")).toBeTruthy();
  });

  it("renders not-sure track as Not sure yet", () => {
    const school = makeFlightSchool({
      id: "s-not-sure",
      name: "Echo Aviation",
      hourlyCostCents: 21000,
      trainingTrack: "not sure",
    });

    renderWithContext(h(SchoolComparisonPanel), {
      flightSchools: [school],
    });

    expect(screen.getByText("Not sure yet")).toBeTruthy();
    expect(screen.getByText("$210 / hour")).toBeTruthy();
  });

  it("allows adding a name-only flight school", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    const nameInput = screen.getByLabelText("School name");
    fireEvent.change(nameInput, { target: { value: "Bravo Aero" } });

    const submitBtn = screen.getByRole("button", { name: "Add school" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith({
        name: "Bravo Aero",
        hourlyCostCents: null,
        aircraftDescription: null,
        trainingTrack: null,
        availabilityDescription: null,
        discoveryFlightReflection: null,
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  it("validates required name and prevents saving when empty", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    const submitBtn = screen.getByRole("button", { name: "Add school" });
    fireEvent.click(submitBtn);

    expect(screen.getByText("Enter a school name.")).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("validates invalid hourly cost and does not call save", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("School name"), {
      target: { value: "Delta Flight" },
    });
    fireEvent.change(screen.getByLabelText(/Quoted hourly cost/), {
      target: { value: "-50" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add school" }));

    expect(
      screen.getByText("Enter dollars and cents, such as 175.50, or leave this blank."),
    ).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("rejects hourly cost with more than two fractional digits", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("School name"), {
      target: { value: "Precision Aero" },
    });
    fireEvent.change(screen.getByLabelText(/Quoted hourly cost/), {
      target: { value: "175.505" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add school" }));

    expect(
      screen.getByText("Enter dollars and cents, such as 175.50, or leave this blank."),
    ).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("retains draft and shows visible role alert when save returns false", async () => {
    const mockSave = vi.fn().mockResolvedValue(false);
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("School name"), {
      target: { value: "Echo Flight" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add school" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled();
    });
    expect(mockClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Echo Flight")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Could not save flight school/);
  });

  it("retains draft and shows visible role alert when save rejects", async () => {
    const mockSave = vi.fn().mockRejectedValue(new Error("Network / disk error"));
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("School name"), {
      target: { value: "Reject Flight" },
    });
    fireEvent.change(screen.getByLabelText(/Quoted hourly cost/), {
      target: { value: "195.50" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add school" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled();
    });
    expect(mockClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Reject Flight")).toBeTruthy();
    expect(screen.getByDisplayValue("195.50")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Could not save flight school/);
  });

  it("cancelling does not trigger save and closes dialog", () => {
    const mockSave = vi.fn();
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("School name"), {
      target: { value: "Foxtrot Flight" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it("supports editing existing record and clearing fields to null", async () => {
    const existing: FlightSchool = makeFlightSchool({
      id: "fs-edit-1",
      name: "Original Academy",
      hourlyCostCents: 25000,
      aircraftDescription: "Piper Cherokee",
      trainingTrack: "Part 141",
      availabilityDescription: "Weekends only",
      discoveryFlightReflection: "Awesome first flight!",
    });

    const mockSave = vi.fn().mockResolvedValue(true);
    const mockClose = vi.fn();

    render(
      h(SchoolFormDialog, {
        open: true,
        school: existing,
        onClose: mockClose,
        onSave: mockSave,
      }),
    );

    expect(screen.getByDisplayValue("Original Academy")).toBeTruthy();
    expect(screen.getByDisplayValue("250.00")).toBeTruthy();
    expect(screen.getByDisplayValue("Piper Cherokee")).toBeTruthy();
    expect(screen.getByDisplayValue("Awesome first flight!")).toBeTruthy();

    // Clear optional fields to empty strings (which map to null)
    fireEvent.change(screen.getByLabelText(/Quoted hourly cost/), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Aircraft"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Availability"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("How the discovery flight felt"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith({
        name: "Original Academy",
        hourlyCostCents: null,
        aircraftDescription: null,
        trainingTrack: "Part 141",
        availabilityDescription: null,
        discoveryFlightReflection: null,
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  it("handles remove flow with confirmation dialog and deleteWithUndo", async () => {
    const school = makeFlightSchool({
      id: "fs-del-1",
      name: "Aero Delete Academy",
    });

    const deleteWithUndo = vi.fn();
    renderWithContext(h(SchoolComparisonPanel), { flightSchools: [school] }, { deleteWithUndo });

    const removeBtn = screen.getByRole("button", { name: "Remove Aero Delete Academy" });
    fireEvent.click(removeBtn);

    expect(screen.getByText("Remove flight school?")).toBeTruthy();

    const confirmBtn = screen.getByRole("button", { name: "Remove school" });
    fireEvent.click(confirmBtn);

    expect(deleteWithUndo).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ["fs-del-1"],
        label: "Aero Delete Academy",
      }),
    );
  });

  it("cancelling remove dialog does not enqueue deletion", async () => {
    const school = makeFlightSchool({
      id: "fs-del-cancel",
      name: "Cancel Delete School",
    });

    const deleteWithUndo = vi.fn();
    renderWithContext(h(SchoolComparisonPanel), { flightSchools: [school] }, { deleteWithUndo });

    const removeBtn = screen.getByRole("button", { name: "Remove Cancel Delete School" });
    fireEvent.click(removeBtn);

    expect(screen.getByText("Remove flight school?")).toBeTruthy();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    expect(deleteWithUndo).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Remove flight school?" })).toBeNull();
  });

  it("renders a single accessible Add school button in empty state and opens form when clicked", () => {
    renderWithContext(h(SchoolComparisonPanel), { flightSchools: [] });

    const addButtons = screen.getAllByRole("button", { name: /Add school/i });
    expect(addButtons).toHaveLength(1);

    fireEvent.click(addButtons[0]!);

    expect(screen.getByRole("dialog", { name: "Add flight school" })).toBeTruthy();
    expect(screen.getByLabelText("School name")).toBeTruthy();
  });
});
