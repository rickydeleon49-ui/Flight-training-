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

it("the toolkit home and an open tool pass axe", async () => {
  const home = render(<MemoryRouter><PilotToolkit /></MemoryRouter>);
  await expectNoA11yViolations(home.container);
  home.unmount();
  const open = render(<MemoryRouter initialEntries={["/?tool=readiness"]}><PilotToolkit /></MemoryRouter>);
  expect(screen.getByRole("region", { name: "Checkride" })).toBeTruthy();
  await expectNoA11yViolations(open.container);
});

it("leaving a quiz with All tools asks 'Leave this quiz?' once an answer is checked (BL-65)", async () => {
  const { fireEvent } = await import("@testing-library/react");
  render(<MemoryRouter initialEntries={["/?tool=quiz"]}><PilotToolkit /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));
  // Before any answer: leaving is free.
  fireEvent.click(screen.getByRole("link", { name: "All tools" }));
  expect(screen.queryByRole("button", { name: "Keep going" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Quizzes/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));
  fireEvent.click(screen.getAllByRole("radio")[0]!);
  fireEvent.click(screen.getByRole("button", { name: /Check answer/ }));
  fireEvent.click(screen.getByRole("link", { name: "All tools" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
  expect(screen.getByRole("heading", { level: 2, name: "Quizzes" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "All tools" }));
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  expect(screen.getByRole("heading", { level: 2, name: "All tools" })).toBeTruthy();
});

it("a nav link clicked mid-quiz asks 'Leave this quiz?' (leave guard)", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const { LeaveGuardProvider } = await import("@/state/leaveGuard");
  const { IosTabBar } = await import("@/components/layout/IosTabBar");
  render(
    <MemoryRouter initialEntries={["/?tool=quiz"]}>
      <LeaveGuardProvider>
        <IosTabBar overdueCount={0} />
        <PilotToolkit />
      </LeaveGuardProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));
  fireEvent.click(screen.getAllByRole("radio")[0]!);
  fireEvent.click(screen.getByRole("button", { name: /Check answer/ }));
  fireEvent.click(screen.getByRole("link", { name: "Study" }));
  expect(screen.getByRole("heading", { name: "Leave this quiz?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
  expect(screen.queryByRole("heading", { name: "Leave this quiz?" })).toBeNull();
});
