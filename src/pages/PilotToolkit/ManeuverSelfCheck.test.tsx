// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { MANEUVERS, toleranceLine } from "@/logic/maneuverChecks";
import { ManeuverSelfCheck } from "./ManeuverSelfCheck";

let ctx: Record<string, unknown>;
let saved: unknown;
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ctx }));

beforeEach(() => {
  saved = undefined;
  ctx = {
    data: { toolkit: { ...DEFAULT_TOOLKIT_STATE, maneuverChecks: [
      { task: "PA.V.A", date: "2026-11-01", items: [
        { code: "PA.V.A.S5", label: "Altitude ±100 feet", rating: "Within" },
        { code: "PA.V.A.S5", label: "Bank ±5°", rating: "Close" },
      ], note: "bumpy" },
    ] } },
    mutate: async (fn: (r: unknown) => Promise<unknown>) =>
      fn({ toolkit: { get: async () => ({ ...DEFAULT_TOOLKIT_STATE }), save: async (s: unknown) => { saved = s; return s; } } }),
  };
});
afterEach(cleanup);

it("shows tolerance lines, recent checks and the wording", () => {
  render(<ManeuverSelfCheck />);
  for (const t of MANEUVERS[0]!.tolerances) expect(screen.getAllByText(toleranceLine(t)).length).toBeGreaterThan(0);
  expect(screen.getByText("Your own view. Your instructor decides.")).toBeTruthy();
  expect(screen.getByTestId("maneuver-recent").textContent).toMatch(/1 Within, 1 Close, 0 Not yet \(bumpy\)/);
  expect(screen.getByRole("button", { name: "Save this check" }).hasAttribute("disabled")).toBe(true);
});

it("saves a full check through the toolkit", async () => {
  render(<ManeuverSelfCheck />);
  for (const t of MANEUVERS[0]!.tolerances) {
    const group = screen.getByRole("group", { name: toleranceLine(t) });
    fireEvent.click(group.querySelectorAll("button")[1]!);
  }
  fireEvent.change(screen.getByLabelText("Short note (optional)"), { target: { value: " calm " } });
  fireEvent.click(screen.getByRole("button", { name: "Save this check" }));
  await waitFor(() => expect(saved).toBeTruthy());
  const checks = (saved as { maneuverChecks: { task: string; items: { rating: string }[]; note: string }[] }).maneuverChecks;
  expect(checks).toHaveLength(1);
  expect(checks[0]!.task).toBe("PA.V.A");
  expect(checks[0]!.items.every((i) => i.rating === "Close")).toBe(true);
  expect(checks[0]!.note).toBe("calm");
});
