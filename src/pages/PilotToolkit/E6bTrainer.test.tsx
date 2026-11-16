// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { generateDiversion, generateLeg, generateReserveScenario, solveDiversion, solveLeg, solveReserve } from "@/logic/navLog";

import { E6bTrainer } from "./E6bTrainer";

afterEach(cleanup);

it("fills the wind problem and shows the worked result and answer", () => {
  render(<E6bTrainer />);
  expect(screen.getByText("E6B practice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 1/ }));
  expect(screen.getByText(/Given: true course 90 degrees, true airspeed 100 kt/)).toBeTruthy();
  expect(screen.queryByText(/magnetic heading 097\./)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(
    screen.getByText(/Wind correction angle 12 degrees right\. True heading 102, groundspeed 98 kt\. With 5 degrees east variation, magnetic heading 097\./),
  ).toBeTruthy();
  expect(screen.getByText(/^Wind correction angle 12 degrees right, true heading 102/)).toBeTruthy();
});

it("solves time and fuel practice, and explains impossible wind", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/Time: 1 h 30 min \(90 minutes\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 3/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/about 21\.3 gallons in 2 h 30 min/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Wind" }));
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 1/ }));
  fireEvent.change(screen.getByLabelText("Wind speed (knots)"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/cannot be held/)).toBeTruthy();
});

it("checks all typed wind answers at once: right, close, not quite, empty skipped", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 1/ }));
  fireEvent.change(screen.getByLabelText("Wind correction angle"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Right" }));
  fireEvent.change(screen.getByLabelText("True heading"), { target: { value: "102" } });
  fireEvent.change(screen.getByLabelText("Groundspeed (kt)"), { target: { value: "96" } });
  fireEvent.change(screen.getByLabelText("Magnetic heading"), { target: { value: "107" } });
  fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
  expect(screen.getByText(/Right: 12° right/)).toBeTruthy();
  expect(screen.getByText(/Right: 102°/)).toBeTruthy();
  expect(screen.getByText(/Close: answer is 98 kt/)).toBeTruthy();
  expect(screen.getByText(/Not quite\. East is least: subtract east variation/)).toBeTruthy();
  expect(screen.getByText("2 right, 1 close, 1 to fix")).toBeTruthy();
});

it("skips empty boxes and grades a time answer", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
  expect(screen.queryByText(/Not quite/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Trip time (minutes)"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
  expect(screen.getByText("1 right, 0 close, 0 to fix")).toBeTruthy();
});

it("drops the check summary once the answer is shown or a box changes (R23)", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 2/ }));
  fireEvent.change(screen.getByLabelText("Trip time (minutes)"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
  expect(screen.getByText("1 right, 0 close, 0 to fix")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.queryByText("1 right, 0 close, 0 to fix")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hide answer" }));
  expect(screen.getByText("1 right, 0 close, 0 to fix")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Trip time (minutes)"), { target: { value: "80" } });
  // Hidden, not removed: the line keeps its height so the boxes below do not jump.
  expect(screen.getByText("1 right, 0 close, 0 to fix").style.visibility).toBe("hidden");
});

it("keeps the feedback line in the layout while the student retypes a checked box (BL-64)", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 2/ }));
  fireEvent.change(screen.getByLabelText("Trip time (minutes)"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
  const line = screen.getByText(/Right: /);
  expect(line.style.visibility).toBe("");
  fireEvent.change(screen.getByLabelText("Trip time (minutes)"), { target: { value: "9" } });
  expect(screen.getByText(/Right: /)).toBe(line);
  expect(line.style.visibility).toBe("hidden");
  fireEvent.change(screen.getByLabelText("Trip time (minutes)"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
  expect(screen.getByText(/Right: /).style.visibility).toBe("");
});

it("lets the answer box shrink and the row wrap so L/R stays clickable at narrow widths (R23)", () => {
  const css = readFileSync(join(__dirname, "pilotToolkit.css"), "utf8");
  expect(css).toMatch(/\.e6b-check__row\s*\{[^}]*flex-wrap:\s*wrap/);
  expect(css).toMatch(/\.e6b-check__input\s*\{[^}]*min-width:\s*0/);
  expect(css).toMatch(/\.e6b-check__side\s*\{[^}]*flex:\s*none/);
});

it("Nav log mode renders and grades a correct and a wrong box", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const leg = generateLeg(500001);
  const sol = solveLeg(leg)!;
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: "Nav log" }));
  expect(screen.getByText(/Practice numbers, not for flight\. Use your own charts, POH and weather with your instructor\./)).toBeTruthy();
  expect(screen.getByText(/East is least, West is best/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/^GS/), { target: { value: String(sol.gs) } });
  fireEvent.change(screen.getByLabelText(/^MH/), { target: { value: String((sol.mh + 90) % 360) } });
  fireEvent.click(screen.getByRole("button", { name: "Check my nav log" }));
  expect(screen.getByText(new RegExp(`Right: ${sol.gs} kt`))).toBeTruthy();
  expect(screen.getByText(leg.side === "E" ? /MH = TH − east variation/ : /MH = TH \+ west variation/)).toBeTruthy();
  expect(screen.getByText("1 right, 0 close, 1 to fix")).toBeTruthy();
  vi.restoreAllMocks();
});

it("Nav log whole trip shows the table with totals", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: "Nav log" }));
  fireEvent.click(screen.getByRole("button", { name: "Whole trip" }));
  expect(screen.getByRole("columnheader", { name: "CH" })).toBeTruthy();
  expect(screen.getByLabelText("Leg 1 WCA")).toBeTruthy();
  expect(screen.getByLabelText("Leg 2 Fuel")).toBeTruthy();
  expect(screen.getByLabelText("Total ETE (minutes)")).toBeTruthy();
  expect(screen.getByText("Total")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check my nav log" }));
  expect(screen.queryByText(/Not quite/)).toBeNull();
});

it("Nav log diversion view grades answers and shows fuel left", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const d = generateDiversion(500001);
  const sol = solveDiversion(d)!;
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: "Nav log" }));
  fireEvent.click(screen.getByRole("button", { name: "Diversion" }));
  expect(screen.getByText(/You divert to an alternate/)).toBeTruthy();
  expect(screen.getByText(/distance ÷ GS × 60/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/^TH/), { target: { value: String(sol.th) } });
  fireEvent.change(screen.getByLabelText(/^MH/), { target: { value: String(sol.mh) } });
  fireEvent.change(screen.getByLabelText(/^GS/), { target: { value: String(sol.gs) } });
  fireEvent.change(screen.getByLabelText(/^ETE/), { target: { value: String(sol.ete) } });
  fireEvent.change(screen.getByLabelText(/^Fuel used/), { target: { value: String(sol.fuelUsed + 3) } });
  fireEvent.click(screen.getByRole("button", { name: "Check my nav log" }));
  expect(screen.getByText("4 right, 0 close, 1 to fix")).toBeTruthy();
  expect(screen.getByText(new RegExp(`fuel left at the alternate = .* = ${sol.fuelLeft} gallons`))).toBeTruthy();
  vi.restoreAllMocks();
});

it("Nav log fuel reserve view grades answers and shows the reserve line", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const sc = generateReserveScenario(500001);
  const sol = solveReserve(sc);
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: "Nav log" }));
  fireEvent.click(screen.getByRole("button", { name: "Fuel reserve" }));
  fireEvent.change(screen.getByLabelText(/^Total fuel used/), { target: { value: String(sol.fuelUsed) } });
  fireEvent.change(screen.getByLabelText(/^Fuel left on landing/), { target: { value: String(sol.fuelLeft) } });
  fireEvent.click(screen.getByRole("button", { name: "Check my nav log" }));
  expect(screen.getByText("2 right, 0 close, 0 to fix")).toBeTruthy();
  const word = sol.covers ? "covers the" : "is less than the";
  expect(screen.getByText(new RegExp(`${word} ${sol.reserveMinutes}-minute ${sc.night ? "night" : "day"} reserve \\(14 CFR 91\\.151\\)`))).toBeTruthy();
  expect(screen.getByText(new RegExp(`= ${sol.reserveGallons} gallons`))).toBeTruthy();
  vi.restoreAllMocks();
});
