// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { densityAltitude as densityAltForSteps } from "@/logic/performanceAid";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";

import { densitySteps, quizNeedsLeaveConfirm, windSteps } from "./PilotToolkit";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: { toolkit: DEFAULT_TOOLKIT_STATE, toolkitUnreadable: false, journalEntries: [], transactions: [], events: [], profile: null },
    mutate: async () => null,
  }),
}));
vi.mock("@/services/notify", () => ({ askPermission: vi.fn() }));

import { PilotToolkit } from "./PilotToolkit";

afterEach(cleanup);

describe("performance aid card", () => {
  it("shows crosswind and density altitude sentences", () => {
    render(h(MemoryRouter, { initialEntries: ["/toolkit?tool=safety"] }, h(PilotToolkit)));
    expect(screen.getByText("Crosswind & density altitude")).toBeTruthy();
    const set = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set("Runway (1-36)", "36");
    set("Wind direction (degrees)", "30");
    set("Wind speed (kt)", "20");
    set("Field elevation (ft)", "5000");
    set("Outside air temperature (°C)", "30");
    expect(screen.getByText("Crosswind 10 kt from the right, headwind 17 kt.")).toBeTruthy();
    expect(screen.getByText(/density altitude about 8,000 ft/)).toBeTruthy();
    expect(screen.getByText(/Study aid only\. Use your POH performance charts/)).toBeTruthy();
  });
});

describe("worked steps and quiz exit (BL-57, BL-61)", () => {
  it("shows crosswind steps with her numbers", () => {
    const steps = windSteps(36, 90, 10).join(" ");
    expect(steps).toContain("sin(90°) = 10 kt");
    expect(steps).toContain("cos(90°) = 0 kt");
  });
  it("shows density altitude steps", () => {
    const d = densityAltForSteps(0, 29.92, 15)!;
    const steps = densitySteps(0, 29.92, 15, d).join(" ");
    expect(steps).toContain("Pressure altitude");
    expect(steps).toContain("ISA temperature");
  });
  it("asks before Exit only after an answer", () => {
    expect(quizNeedsLeaveConfirm(0, false)).toBe(false);
    expect(quizNeedsLeaveConfirm(0, true)).toBe(true);
    expect(quizNeedsLeaveConfirm(3, false)).toBe(true);
  });
});
