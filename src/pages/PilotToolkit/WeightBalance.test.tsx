// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ToolkitState } from "@/domain/types";
import { WeightBalancePractice } from "./WeightBalancePractice";

import type { AppData } from "@/state/AppDataContext";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { makeProfile } from "@/testing/factories";
import { PilotToolkit, toolFrom } from "./PilotToolkit";

let store: ToolkitState = DEFAULT_TOOLKIT_STATE;

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: {
      profile: makeProfile({ pilotName: "Synthetic pilot" }),
      toolkit: store,
      milestones: [], goals: [], checklistItems: [], actions: [], materials: [],
      aiStudySets: [], practiceTests: [], tags: [], events: [], prepItems: [],
      journalEntries: [], questions: [], notes: [], transactions: [],
    } as unknown as AppData,
    mutate: async (fn: (repos: unknown) => Promise<unknown>) =>
      fn({ toolkit: { get: async () => store, save: async (next: ToolkitState) => { store = next; return next; } } }),
  }),
}));

afterEach(() => {
  cleanup();
  store = DEFAULT_TOOLKIT_STATE;
});

it("fills a practice problem and reveals its answer", () => {
  render(<MemoryRouter initialEntries={["/?tool=safety"]}><PilotToolkit /></MemoryRouter>);
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
  fireEvent.click(screen.getByRole("button", { name: "Try an example TAF" }));
  expect(screen.getByRole("heading", { name: "Temporary (TEMPO)" })).toBeTruthy();
  expect(screen.getAllByText(/A study hint only/).length).toBeGreaterThan(2);
  fireEvent.click(screen.getByRole("button", { name: "Try an example METAR" }));
  expect(screen.getByText(/Station KSFO/)).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Temporary (TEMPO)" })).toBeNull();
});

it("decodes an example winds aloft and PIREP in the one paste box", () => {
  render(<MemoryRouter initialEntries={["/?tool=metar"]}><PilotToolkit /></MemoryRouter>);
  expect(screen.getAllByText("Weather and NOTAM Explainer").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Paste or type a METAR, TAF, winds aloft (FB), PIREP or NOTAM")).toBeTruthy();
  expect(screen.getByText(/G-AIRMET/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Try an example winds aloft" }));
  expect(screen.getByLabelText("Decoded winds aloft")).toBeTruthy();
  expect(screen.getByText(/From 220° true at 14 kt, temperature \+5 °C/)).toBeTruthy();
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
  fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
  expect(screen.getByText("E6B practice")).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "All tools" }));
  fireEvent.click(screen.getByRole("button", { name: /^Safety Check/ }));
  expect(screen.queryByText("E6B practice")).toBeNull();
});

it("scrolls to the top when the Toolkit opens and when its tool changes", () => {
  const scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  render(<MemoryRouter initialEntries={["/"]}><PilotToolkit /></MemoryRouter>);
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  scrollTo.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /^Safety Check/ }));
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  vi.unstubAllGlobals();
});

const PLANE = { emptyWeight: 1500, emptyArm: 85, maxGross: 2300, frontArm: 80, rearArm: 118, fuelArm: 95, baggageArm: 142, forwardLimit: 82, aftLimit: 95 };

function Harness({ start }: { start?: typeof PLANE }) {
  const [state, setState] = useState<ToolkitState>({ ...DEFAULT_TOOLKIT_STATE, ...(start ? { myAirplane: start } : {}) });
  const save = async (change: (c: ToolkitState) => ToolkitState) => { setState(change(state)); return true; };
  return <WeightBalancePractice state={state} save={save} />;
}
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("shows the empty state, saves my airplane, then clears it", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("radio", { name: "My airplane" }));
  expect(screen.getByText("Add your airplane's POH numbers")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect((screen.getByRole("button", { name: "Save my airplane" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Save is off\./)).toBeTruthy();
  type("Basic empty weight (lb)", "1500");
  type("Basic empty weight arm (in)", "85");
  type("Pilot and front seat arm (in)", "80");
  type("Rear seats arm (in)", "118");
  type("Fuel arm (in)", "95");
  type("Baggage arm (in)", "142");
  type("Max gross weight (lb)", "2300");
  type("Forward CG limit (in)", "82");
  type("Aft CG limit (in)", "95");
  fireEvent.click(screen.getByRole("button", { name: "Save my airplane" }));
  expect(await screen.findByText("Saved your airplane.")).toBeTruthy();
  expect(screen.getByText(/Max gross weight: 2300 lb/)).toBeTruthy();
  type("Pilot and front seat (lb)", "340");
  type("Fuel (gallons)", "30");
  expect(screen.getByText(/Center of gravity:/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear my airplane" }));
  expect(await screen.findByText("Cleared your airplane.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Fill in Problem 1/ })).toBeTruthy();
});

it("prefills from a saved airplane on mount and keeps blank practice separate", () => {
  render(<Harness start={PLANE} />);
  expect(screen.getByText(/Basic empty weight: 1500 lb at 85 in/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Fill in Problem 1/ })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Blank practice" }));
  expect(screen.getByRole("button", { name: /Fill in Problem 1/ })).toBeTruthy();
  expect((screen.getByLabelText("Max gross weight (lb, optional)") as HTMLInputElement).value).toBe("");
});
