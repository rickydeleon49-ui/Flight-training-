// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { makeProfile } from "@/testing/factories";
import { PilotToolkit } from "./PilotToolkit";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: {
      profile: makeProfile({ pilotName: "Synthetic pilot" }),
      toolkit: DEFAULT_TOOLKIT_STATE,
      milestones: [], goals: [], checklistItems: [], actions: [], materials: [],
      aiStudySets: [], practiceTests: [], tags: [], events: [], prepItems: [],
      journalEntries: [], questions: [], notes: [], transactions: [],
    } as unknown as AppData,
    mutate: async () => null,
  }),
}));

afterEach(cleanup);

it("fills a practice problem and reveals its answer", () => {
  render(<MemoryRouter initialEntries={["/?tool=safety"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Safety Check" }));
  expect(screen.getByText("Weight & balance practice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in Problem 1/ }));
  expect(screen.getByText(/Center of gravity: 87.2 in\. Within the limits you entered\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/CG 87.20 in/)).toBeTruthy();
  expect(screen.getByText(/Given: Basic empty weight 1500 lb at arm 85 in/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in Problem 3/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/Total weight 1860 lb, total moment 164450,/)).toBeTruthy();
});

it("rejects runway numbers outside 1 to 36 in the crosswind tool", () => {
  render(<MemoryRouter initialEntries={["/?tool=safety"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Safety Check" }));
  fireEvent.change(screen.getByLabelText("Runway (1-36)"), { target: { value: "37" } });
  fireEvent.change(screen.getByLabelText("Wind direction (degrees)"), { target: { value: "270" } });
  fireEvent.change(screen.getByLabelText("Wind speed (kt)"), { target: { value: "15" } });
  expect(screen.getByText(/Runway numbers are whole numbers from 1 to 36/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Runway (1-36)"), { target: { value: "27" } });
  expect(screen.getByText(/Crosswind 0 kt, headwind 15 kt/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Runway (1-36)"), { target: { value: "0" } });
  expect(screen.getByText(/Runway numbers are whole numbers/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Runway (1-36)"), { target: { value: "9.5" } });
  expect(screen.getByText(/Runway numbers are whole numbers/)).toBeTruthy();
});

it("decodes a TAF and fills examples on the METAR tab", () => {
  render(<MemoryRouter initialEntries={["/?tool=metar"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "METAR" }));
  fireEvent.click(screen.getByRole("button", { name: "Try an example TAF" }));
  expect(screen.getByRole("heading", { name: "Temporary (TEMPO)" })).toBeTruthy();
  expect(screen.getAllByText(/A study hint only/).length).toBeGreaterThan(2);
  fireEvent.click(screen.getByRole("button", { name: "Try an example METAR" }));
  expect(screen.getByText(/Station KSFO/)).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Temporary (TEMPO)" })).toBeNull();
});
