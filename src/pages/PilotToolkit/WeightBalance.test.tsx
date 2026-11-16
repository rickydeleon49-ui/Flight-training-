// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { makeProfile } from "@/testing/factories";
import { PilotToolkit, toolFrom } from "./PilotToolkit";

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

it("decodes an example winds aloft and PIREP in the one paste box", () => {
  render(<MemoryRouter initialEntries={["/?tool=metar"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "METAR" }));
  expect(screen.getByText("Weather and NOTAM Explainer")).toBeTruthy();
  expect(screen.getByLabelText("Paste or type a METAR, TAF, winds aloft (FB), PIREP or NOTAM")).toBeTruthy();
  expect(screen.getByText(/G-AIRMET/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Try an example winds aloft" }));
  expect(screen.getByLabelText("Decoded winds aloft")).toBeTruthy();
  expect(screen.getByText(/From 220° at 14 kt, temperature \+5 °C/)).toBeTruthy();
  expect(screen.getByText(/Light and variable \(less than 5 kt\)/)).toBeTruthy();
  expect(screen.getAllByText(/No forecast for this level/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText(/Your cruise altitude/), { target: { value: "7500" } });
  expect(screen.getAllByText(/sits between the 6,000 ft level/).length).toBe(2);

  fireEvent.click(screen.getByRole("button", { name: "Try an example PIREP" }));
  expect(screen.getByLabelText("Decoded pilot report")).toBeTruthy();
  expect(screen.getByText(/Routine pilot report/)).toBeTruthy();
  expect(screen.getByText(/Wind from 270° at 30 kt/)).toBeTruthy();
  expect(screen.getByText(/Light to moderate chop turbulence/)).toBeTruthy();
  expect(screen.queryByLabelText("Decoded winds aloft")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Try an example METAR" }));
  expect(screen.getByText(/Station KSFO/)).toBeTruthy();
  expect(screen.queryByLabelText("Decoded pilot report")).toBeNull();
});

it("decodes an example NOTAM in the same paste box", () => {
  render(<MemoryRouter initialEntries={["/?tool=metar"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Try an example NOTAM" }));
  expect(screen.getByLabelText("Decoded NOTAM")).toBeTruthy();
  expect(screen.getByText(/Taxiway: a temporary change or hazard/)).toBeTruthy();
  expect(screen.getByText(/From 20 Nov 2026 13:00 UTC until 20 Nov 2026 21:00 UTC/)).toBeTruthy();
  expect(screen.getByText(/ICAO NOTAM format/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try an example METAR" }));
  expect(screen.queryByLabelText("Decoded NOTAM")).toBeNull();
  expect(screen.queryByText(/ICAO NOTAM format/)).toBeNull();
});

it("shows the E6B trainer on its own tab, not in Safety Check", () => {
  expect(toolFrom("e6b")).toBe("e6b");
  render(<MemoryRouter initialEntries={["/?tool=e6b"]}><PilotToolkit /></MemoryRouter>);
  expect(screen.getByText("E6B practice")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Safety Check" }));
  expect(screen.queryByText("E6B practice")).toBeNull();
});

it("scrolls to the top when the Toolkit opens and when its tool changes", () => {
  const scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  render(<MemoryRouter initialEntries={["/"]}><PilotToolkit /></MemoryRouter>);
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  scrollTo.mockClear();
  fireEvent.click(screen.getByRole("tab", { name: "Safety Check" }));
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  vi.unstubAllGlobals();
});
