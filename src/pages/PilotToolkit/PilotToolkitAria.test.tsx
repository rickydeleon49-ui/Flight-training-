// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { makeProfile } from "@/testing/factories";
import { expectNoA11yViolations } from "@/testing/a11y";
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

it("the toolkit page passes axe with its focusable, labelled tabpanel", async () => {
  const { container } = render(<MemoryRouter><PilotToolkit /></MemoryRouter>);
  const tab = screen.getByRole("tab", { selected: true });
  const panel = screen.getByRole("tabpanel");
  expect(panel.tabIndex).toBe(0);
  expect(panel.id).toBe(tab.getAttribute("aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  await expectNoA11yViolations(container);
});
