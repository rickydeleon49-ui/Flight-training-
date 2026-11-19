// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import type { ToolkitState } from "@/domain/types";
import { makeJournalEntry, makeProfile } from "@/testing/factories";
import { PilotToolkit } from "./PilotToolkit";

let stored: ToolkitState;
let data: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data,
    mutate: async (run: (repos: unknown) => Promise<unknown>) =>
      run({
        toolkit: {
          get: async () => stored,
          save: async (next: ToolkitState) => {
            stored = next;
            data = { ...data, toolkit: next };
            return next;
          },
        },
      }),
    deleteWithUndo: () => {},
  }),
}));

beforeEach(() => {
  stored = { ...DEFAULT_TOOLKIT_STATE, checkrideDate: "2027-03-15" };
  data = {
    profile: makeProfile({ pilotName: "Synthetic pilot" }),
    toolkit: stored,
    milestones: [], goals: [], checklistItems: [], actions: [], materials: [],
    aiStudySets: [], practiceTests: [], tags: [], events: [], prepItems: [],
    journalEntries: [makeJournalEntry({ totalTime: 12, dualReceived: 9, soloTime: 3, nightTime: 1, nightLandings: 2 })],
    questions: [], notes: [], transactions: [],
  } as unknown as AppData;
});
afterEach(cleanup);

it("Checkride tab shows the hours still to go rows", () => {
  render(<MemoryRouter initialEntries={["/?tool=readiness"]}><PilotToolkit /></MemoryRouter>);
  expect(screen.getByText(/Hours still to go \(14 CFR 61\.109\(a\)\)/)).toBeTruthy();
  expect(screen.getByTestId("hours-to-go-total").textContent).toContain("28.0 h to go");
  expect(screen.getByTestId("hours-to-go-training").textContent).toContain("11.0 h to go");
  expect(screen.getByTestId("hours-to-go-night").textContent).toContain("Logged: 1.0 h night, 2 night landings");
  expect(screen.getByTestId("hours-to-go-prep").textContent).toContain("window starts 2027-01-01");
  expect(screen.getByText(/A study aid, not an eligibility check/)).toBeTruthy();
});

it("the endorsements checklist is closed by default and a tick persists", async () => {
  render(<MemoryRouter initialEntries={["/?tool=records"]}><PilotToolkit /></MemoryRouter>);
  const details = document.getElementById("endorsements-checklist") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  details.open = true;
  fireEvent.click(screen.getByRole("checkbox", { name: /Pre-solo knowledge test/ }));
  await waitFor(() => expect(stored.endorsementChecks?.["presolo-knowledge"]).toEqual({ done: true }));
  expect(screen.getByText("61.87(b)")).toBeTruthy();
});

it("What to bring is always folded, says look now with no date or over 30 days, and a tick persists", async () => {
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const open = () => render(<MemoryRouter initialEntries={["/?tool=readiness"]}><PilotToolkit /></MemoryRouter>);
  stored = { ...stored, checkrideDate: null };
  data = { ...data, toolkit: stored };
  open();
  expect(document.getElementById("bring-checklist")).toBeTruthy();
  expect((document.getElementById("bring-checklist") as HTMLDetailsElement).open).toBe(false);
  expect(screen.getByText("For checkride day. You can look now.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "What the examiner looks for, by skill" }).getAttribute("href")).toBe("/flight-path");
  cleanup();
  stored = { ...stored, checkrideDate: day(31) };
  data = { ...data, toolkit: stored };
  open();
  expect(document.getElementById("bring-checklist")).toBeTruthy();
  expect(screen.getByText("For checkride day. You can look now.")).toBeTruthy();
  cleanup();
  stored = { ...stored, checkrideDate: day(30) };
  data = { ...data, toolkit: stored };
  open();
  const details = document.getElementById("bring-checklist") as HTMLDetailsElement;
  expect(details).toBeTruthy();
  expect(screen.queryByText("For checkride day. You can look now.")).toBeNull();
  expect(screen.getByText("Your examiner and instructor tell you exactly what to bring.")).toBeTruthy();
  details.open = true;
  fireEvent.click(screen.getByRole("checkbox", { name: /Photo ID/ }));
  await waitFor(() => expect(stored.bringChecks?.["photo-id"]).toBe(true));
});
