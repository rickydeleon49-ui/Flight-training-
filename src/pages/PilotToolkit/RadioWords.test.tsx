// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { RADIO_DRILL } from "@/logic/radioDrill";
import { RadioWords } from "./RadioWords";

afterEach(cleanup);

it("toggles to practice calls and reveals the reply", () => {
  render(<RadioWords />);
  fireEvent.click(screen.getByRole("button", { name: "Practice calls" }));
  const first = RADIO_DRILL[0]!;
  expect(screen.getByText(first.controllerCall, { exact: false })).toBeTruthy();
  expect(screen.queryByText(first.modelReply, { exact: false })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show reply" }));
  expect(screen.getByText(first.modelReply, { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(RADIO_DRILL[1]!.controllerCall, { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Words" }));
  expect(screen.getByLabelText("Search radio words")).toBeTruthy();
});
