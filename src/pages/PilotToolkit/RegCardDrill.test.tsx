// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { REG_CARDS } from "@/logic/regCards";
import { RegCardDrill } from "./RegCardDrill";

afterEach(cleanup);

it("flips to the answer and moves to the next card", () => {
  render(<RegCardDrill />);
  expect(screen.getByText(REG_CARDS[0]!.prompt)).toBeTruthy();
  expect(screen.queryByText(REG_CARDS[0]!.answer)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Flip" }));
  expect(screen.getByText(REG_CARDS[0]!.answer)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(REG_CARDS[1]!.prompt)).toBeTruthy();
  expect(screen.queryByText(REG_CARDS[0]!.answer)).toBeNull();
  expect(screen.getByText(/Card 2 of/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText(REG_CARDS[0]!.prompt)).toBeTruthy();
});
