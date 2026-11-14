// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { E6bTrainer } from "./E6bTrainer";

afterEach(cleanup);

it("fills the wind problem and shows the worked result and answer", () => {
  render(<E6bTrainer />);
  expect(screen.getByText("E6B practice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 1/ }));
  expect(
    screen.getByText(/Wind correction angle 12 degrees right\. True heading 102, groundspeed 98 kt\. With 5 degrees east variation, magnetic heading 097\./),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/^Wind correction angle 12 degrees right, true heading 102/)).toBeTruthy();
});

it("solves time and fuel practice, and explains impossible wind", () => {
  render(<E6bTrainer />);
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 2/ }));
  expect(screen.getByText(/Time: 1 h 30 min \(90 minutes\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 3/ }));
  expect(screen.getByText(/about 21\.3 gallons in 2 h 30 min/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Wind" }));
  fireEvent.click(screen.getByRole("button", { name: /Fill in E6B 1/ }));
  fireEvent.change(screen.getByLabelText("Wind speed (knots)"), { target: { value: "300" } });
  expect(screen.getByText(/cannot be held/)).toBeTruthy();
});
