// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { expectNoA11yViolations } from "@/testing/a11y";
import { ChartSymbolDrill, shuffled } from "./ChartSymbolDrill";
import { CHART_SOURCE_NOTE, CHART_SYMBOLS } from "./chartSymbols";

afterEach(cleanup);

it("the symbol set is unique and complete", () => {
  const ids = CHART_SYMBOLS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(CHART_SYMBOLS.map((s) => s.name)).size).toBe(ids.length);
  expect(ids.length).toBeGreaterThanOrEqual(24);
  for (const s of CHART_SYMBOLS) {
    expect(s.meaning.length).toBeGreaterThan(10);
    expect(s.tip.length).toBeGreaterThan(10);
    expect(s.desc.length).toBeGreaterThan(5);
    expect(s.drawing).toBeTruthy();
  }
  for (const id of ["airport-towered", "airport-nontowered", "class-e-700", "class-e-1200", "vortac", "isogonic", "seaplane-base"]) {
    expect(ids).toContain(id);
  }
});

it("shuffled keeps every card", () => {
  const out = shuffled(CHART_SYMBOLS, () => 0.3);
  expect(out.map((s) => s.id).sort()).toEqual(CHART_SYMBOLS.map((s) => s.id).sort());
});

it("flips, advances and shuffles", async () => {
  const { container } = render(<ChartSymbolDrill />);
  const first = CHART_SYMBOLS[0]!;
  expect(screen.getByRole("img")).toBeTruthy();
  expect(screen.getByText(CHART_SOURCE_NOTE)).toBeTruthy();
  expect(screen.queryByText(first.name)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Flip" }));
  expect(screen.getByText(first.name)).toBeTruthy();
  expect(screen.getByText(first.meaning)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByText(first.name)).toBeNull();
  expect(screen.getByText(/Card 2 of/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
  expect(screen.getByText(/Card 1 of/)).toBeTruthy();
  await expectNoA11yViolations(container);
});
