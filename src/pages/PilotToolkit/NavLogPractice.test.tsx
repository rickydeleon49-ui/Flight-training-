// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { NavLogPractice } from "./NavLogPractice";

afterEach(cleanup);

function openTrip() {
  render(<NavLogPractice />);
  fireEvent.click(screen.getByRole("button", { name: /trip/i }));
  return document.querySelector("table.navlog-table--trip")!;
}

it("trip Total row spans as many columns as the header (BH-2)", () => {
  const table = openTrip();
  const headCells = table.querySelectorAll("thead th").length;
  const totalRow = Array.from(table.querySelectorAll("tbody tr")).pop()!;
  const span = Array.from(totalRow.children).reduce((n, c) => n + Number(c.getAttribute("colspan") ?? 1), 0);
  expect(span).toBe(headCells);
});

it("a checked box links its feedback with aria-describedby (BH-9)", () => {
  const table = openTrip();
  const box = table.querySelector("tbody input") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: /check/i }));
  const id = box.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)).toBeTruthy();
});
