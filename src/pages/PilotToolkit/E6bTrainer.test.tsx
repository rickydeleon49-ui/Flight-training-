// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

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
