// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ACCIDENT_CASES } from "@/logic/accidentCases";
import { AccidentCaseDrill } from "./AccidentCaseDrill";

afterEach(cleanup);

it("shows the note, flips to the story and moves between cases", () => {
  render(<AccidentCaseDrill />);
  expect(screen.getByText("Learn from real accidents")).toBeTruthy();
  expect(screen.getByText(/Look up the case number at the NTSB/)).toBeTruthy();
  expect(screen.queryByText(ACCIDENT_CASES[0]!.whatHappened)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Flip" }));
  expect(screen.getByText(ACCIDENT_CASES[0]!.whatHappened)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByText(ACCIDENT_CASES[0]!.whatHappened)).toBeNull();
  expect(screen.getByText(/Case 2 of/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText(/Case 1 of/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
  expect(screen.getByText(/Case 1 of/)).toBeTruthy();
});
