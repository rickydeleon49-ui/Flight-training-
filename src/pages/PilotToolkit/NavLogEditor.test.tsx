// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SavedNavLeg, SavedNavLog, ToolkitState } from "@/domain/types";
import { navLogTotals } from "@/logic/navLog";

import { emptyDraft, logTotals, NavLogEditor, type NavDraft } from "./NavLogEditor";

let toolkit: ToolkitState;
vi.mock("@/state/AppDataContext", () => ({
  useOptionalAppData: () => ({
    data: { toolkit },
    mutate: async (work: (r: unknown) => Promise<unknown>) =>
      work({ toolkit: { get: async () => toolkit, save: async (t: ToolkitState) => { toolkit = t; return t; } } }),
  }),
}));

const leg = (tc: number): SavedNavLeg => ({ tc, distanceNm: 30, tas: 100, windDir: 180, windSpeed: 20, variation: 5, side: "E", deviation: 2, gph: 8 });
const mkLog = (n: number): SavedNavLog => ({ id: `l${n}`, name: `Log ${n}`, aircraft: "", reserveMinutes: 30, legs: [leg(90)] });

function Host({ initial }: { initial?: NavDraft }) {
  const [draft, setDraft] = useState(initial ?? emptyDraft());
  return <NavLogEditor draft={draft} setDraft={setDraft} />;
}

beforeEach(() => { toolkit = { navLogs: [] } as unknown as ToolkitState; });
afterEach(cleanup);

it("totals equal navLogTotals plus the chosen reserve", () => {
  const legs = [leg(90), leg(270)];
  const t = logTotals(legs, 45);
  const base = navLogTotals(legs);
  expect(t.fuel).toBe(base.fuel);
  expect(t.reserveFuel).toBe(6); // 8 gph * 45 min
  expect(t.needed).toBe(Math.round((base.fuel + 6) * 10) / 10);
});

it("saves, then reopens the same log", async () => {
  toolkit = { navLogs: [{ ...mkLog(1), legs: [leg(90), leg(270)] }] } as unknown as ToolkitState;
  const original = structuredClone(toolkit.navLogs![0]!);
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Open Log 1" }));
  fireEvent.click(screen.getByRole("button", { name: "New log" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Log 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved."));
  expect(toolkit.navLogs).toEqual([original]);
});

it("caps legs at 12 and logs at 10", () => {
  const d = emptyDraft();
  d.legs = Array.from({ length: 12 }, () => ({ tc: "90", distanceNm: "30", tas: "100", windDir: "180", windSpeed: "20", variation: "5", deviation: "2", gph: "8", side: "E" as const }));
  const { unmount } = render(<Host initial={d} />);
  expect((screen.getByRole("button", { name: "Add a leg" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/12 legs is the most/)).toBeTruthy();
  unmount();
  toolkit = { navLogs: Array.from({ length: 10 }, (_, i) => mkLog(i)) } as unknown as ToolkitState;
  render(<Host initial={{ ...d, legs: d.legs.slice(0, 1) }} />);
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/10 saved logs is the most/)).toBeTruthy();
});

it("bad input shows a dash, never NaN, and wording stays plain", () => {
  const d = emptyDraft();
  d.legs = [{ tc: "abc", distanceNm: "", tas: "100", windDir: "180", windSpeed: "20", variation: "5", deviation: "0", gph: "8", side: "E" }];
  const { container } = render(<Host initial={d} />);
  const text = container.textContent ?? "";
  expect(text).not.toMatch(/NaN|undefined|Infinity/);
  expect(text).toContain("–");
  expect(text).toContain("Reserve you chose");
  expect(text).toContain("Fuel on board needed");
  expect(text).not.toMatch(/no-go|\bsafe\b|legal|required|OK to fly|minimum fuel/i);
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
});

it("delete asks first", async () => {
  toolkit = { navLogs: [mkLog(1)] } as unknown as ToolkitState;
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Log 1" }));
  expect(toolkit.navLogs).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(toolkit.navLogs).toHaveLength(0));
});
