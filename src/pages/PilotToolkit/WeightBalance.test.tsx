// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { makeProfile } from "@/testing/factories";
import { PilotToolkit } from "./PilotToolkit";

vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: {
      profile: makeProfile({ pilotName: "Synthetic pilot" }),
      toolkit: DEFAULT_TOOLKIT_STATE,
      milestones: [], goals: [], checklistItems: [], actions: [], materials: [],
      aiStudySets: [], practiceTests: [], tags: [], events: [], prepItems: [],
      journalEntries: [], questions: [], notes: [], transactions: [],
    } as unknown as AppData,
    mutate: async () => null,
  }),
}));

afterEach(cleanup);

it("fills a practice problem and reveals its answer", () => {
  render(<MemoryRouter initialEntries={["/?tool=safety"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: "Safety Check" }));
  expect(screen.getByText("Weight & balance practice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Fill in Problem 1/ }));
  expect(screen.getByText(/Center of gravity: 87.2 in\. Within the limits you entered\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/CG 87.20 in/)).toBeTruthy();
});
