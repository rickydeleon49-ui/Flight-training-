// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { solveLeg, type NavLogLeg } from "@/logic/navLog";

import { E6bTrainer } from "./E6bTrainer";
import { windOutputs } from "./FlightCalculator";

afterEach(cleanup);

const cases: NavLogLeg[] = [
  { tc: 90, distanceNm: 1, tas: 100, windDir: 180, windSpeed: 20, variation: 5, side: "E", deviation: 2, gph: 1 },
  { tc: 270, distanceNm: 1, tas: 120, windDir: 330, windSpeed: 15, variation: 10, side: "W", deviation: -3, gph: 1 },
  { tc: 360, distanceNm: 1, tas: 110, windDir: 360, windSpeed: 0, variation: 0, side: "E", deviation: 0, gph: 1 },
];

it("matches solveLeg for three known cases", () => {
  for (const c of cases) {
    const s = solveLeg(c)!;
    const o = windOutputs({
      tc: String(c.tc), tas: String(c.tas), windDir: String(c.windDir), windSpeed: String(c.windSpeed),
      variation: String(c.variation), side: c.side, deviation: String(c.deviation),
    });
    expect(o.th).toBe(String(s.th).padStart(3, "0"));
    expect(o.mh).toBe(String(s.mh).padStart(3, "0"));
    expect(o.ch).toBe(String(s.ch).padStart(3, "0"));
    expect(o.gs).toBe(`${s.gs} kt`);
    expect(o.wca).toBe(s.wca === 0 ? "0°" : `${Math.abs(s.wca)}° ${s.wca > 0 ? "right" : "left"}`);
  }
});

it("shows dashes, never NaN, for empty or bad input", () => {
  const empty = { tc: "", tas: "", windDir: "", windSpeed: "", variation: "", side: "E" as const, deviation: "" };
  expect(Object.values(windOutputs(empty))).toEqual(Array(5).fill("–"));
  expect(Object.values(windOutputs({ ...empty, tc: "90", tas: "100", windDir: "180", windSpeed: "500" }))).toEqual(Array(5).fill("–"));
  render(<E6bTrainer />);
  fireEvent.change(screen.getByLabelText("True course (degrees)"), { target: { value: "abc" } });
  expect(document.body.textContent).not.toMatch(/NaN/);
});

it("is the default tab, with accessible tabs that work by keyboard", () => {
  render(<E6bTrainer />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Calculator", "Nav log", "Practice"]);
  expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel")).toBeTruthy();
  fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Nav log" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
  expect(screen.getByText("E6B practice")).toBeTruthy();
});

it("solves time-speed-distance and fuel, and copies the results", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<E6bTrainer />);
  fireEvent.change(screen.getByLabelText("Distance (nm)"), { target: { value: "135" } });
  fireEvent.change(screen.getByLabelText("Speed (kt)"), { target: { value: "90" } });
  expect(screen.getByText("1 h 30 min")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Fuel burn (gallons per hour)"), { target: { value: "8.5" } });
  fireEvent.change(screen.getAllByLabelText("Time (minutes)")[1]!, { target: { value: "150" } });
  expect(screen.getByText("21.3 gal")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalled();
  expect(screen.getByText("A study aid. Check numbers with your instructor and your own plan.")).toBeTruthy();
});
