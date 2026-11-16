// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { InoperativeEquipmentCard } from "./InoperativeEquipmentCard";

afterEach(cleanup);

it("is closed by default, walks a path and resets", () => {
  const { container } = render(<InoperativeEquipmentCard />);
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(screen.getByText(/Something inoperative\? \(14 CFR 91\.213\(d\)\)/)).toBeTruthy();
  details.open = true;
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(screen.getByText(/Check 1 of 4/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByText(/required for this flight/)).toBeTruthy();
  expect(screen.getByText("A study aid, not an airworthiness decision.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start over" }));
  expect(screen.getByText(/approved Minimum Equipment List/)).toBeTruthy();
});

it("all No reaches the remove/deactivate end", () => {
  render(<InoperativeEquipmentCard />);
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(screen.getByText(/43\.9/)).toBeTruthy();
});
