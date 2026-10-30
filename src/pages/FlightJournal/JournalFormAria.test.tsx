// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { expectNoA11yViolations } from "@/testing/a11y";
import { JournalForm } from "./JournalForm";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
// Keep full-mode tests offline: the airport hint is unrelated to the tabs.
vi.mock("@/logic/nightHint", async (original) => ({
  ...await original<typeof import("@/logic/nightHint")>(),
  loadAirportIndex: async () => ({}),
  nightHint: () => null,
}));

function Ready() {
  return useAppData().status === "ready" ? <JournalForm /> : null;
}
async function open(mode = "quick") {
  const result = render(<AppDataProvider><MemoryRouter initialEntries={[`/journal/new?mode=${mode}`]}>
    <Routes><Route path="/journal/new" element={<Ready />} /></Routes>
  </MemoryRouter></AppDataProvider>);
  await screen.findByRole("tablist", { name: "Debrief editor mode" });
  return result;
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-tests");
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

function selected(index: number, focused = false) {
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Quick debrief", "Full flight log & debrief"]);
  expect(tabs.map((tab) => tab.tabIndex)).toEqual(index === 0 ? [0, -1] : [-1, 0]);
  tabs.forEach((tab, i) => {
    expect(tab.getAttribute("aria-selected")).toBe(String(i === index));
    expect(tab.className).toBe(`filter-chip${i === index ? " is-active" : ""}`);
    expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBe(screen.getByRole("tabpanel"));
  });
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[index]!.id);
  expect(screen.getByRole("heading", { name: index === 0 ? "Quick debrief notes" : "Training flight" })).toBeTruthy();
  if (focused) expect(document.activeElement).toBe(tabs[index]);
}

it("arrows, Home and End select and focus the mode with one tab stop and a real labelled panel", async () => {
  await open();
  selected(0);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic debrief" } });
  act(() => screen.getAllByRole("tab")[0]!.focus());
  for (const [key, index] of [["ArrowRight", 1], ["ArrowLeft", 0], ["End", 1], ["Home", 0], ["ArrowLeft", 1], ["ArrowRight", 0]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    selected(index, true);
    expect(screen.getByDisplayValue("Synthetic debrief")).toBeTruthy();
  }
});

it("locks both mode tabs during saving and unlocks them after a failed save", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(db, "saveDebriefAtomically").mockImplementation(async () => { await blocked; throw new Error("Synthetic save failure"); });
  await open();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic debrief" } });
  const tabs = screen.getAllByRole("tab") as HTMLButtonElement[];
  act(() => tabs[0]!.focus());
  fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy());
  for (const tab of tabs) {
    expect(tab.getAttribute("aria-disabled")).toBe("true");
    expect(tab.disabled).toBe(true);
    fireEvent.click(tab);
    fireEvent.keyDown(tab, { key: "End" });
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  }
  await act(async () => { release(); });
  await screen.findByRole("alert");
  tabs.forEach((tab) => expect(tab.getAttribute("aria-disabled")).not.toBe("true"));
  act(() => tabs[0]!.focus());
  fireEvent.keyDown(tabs[0]!, { key: "End" });
  selected(1, true);
});

for (const mode of ["quick", "full"]) {
  it(`${mode} form passes the axe helper`, async () => {
    const { container } = await open(mode);
    selected(mode === "quick" ? 0 : 1);
    await expectNoA11yViolations(container);
  });
}
