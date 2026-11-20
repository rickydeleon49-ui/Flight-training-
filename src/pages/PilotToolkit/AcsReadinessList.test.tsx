// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import type { AcsAreaRow } from "@/logic/acsReadiness";
import { ACS_LIST_FOOTER, AcsReadinessList, AcsReadinessRows, mockRowsFor, NOT_ENOUGH_PRACTICE } from "./AcsReadinessList";

let ctx: Record<string, unknown>;
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ctx }));

const row = (over: Partial<AcsAreaRow>): AcsAreaRow => ({
  area: "PA.I", title: "Preflight Preparation", percent: null, answered: 0,
  oralRated: 0, oralSatisfactory: 0, nextLook: null, ...over,
});

beforeEach(() => {
  ctx = {
    data: { toolkit: { ...DEFAULT_TOOLKIT_STATE, checkrideDate: "2099-01-10" }, materials: [], practiceTests: [] },
    dataRevision: 1,
    repositories: {
      practiceSessions: {
        getRecentCompletedAttempts: async () => [],
        getItems: async () => [],
        getResponses: async () => [],
      },
    },
  };
});
afterEach(cleanup);

it("renders 12 rows, the date line and the wording line", async () => {
  render(<MemoryRouter><AcsReadinessList /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(ACS_LIST_FOOTER)).toBeTruthy());
  expect(screen.getAllByTestId(/^acs-row-PA\./)).toHaveLength(12);
  expect(screen.getAllByText(NOT_ENOUGH_PRACTICE)).toHaveLength(12);
  expect(screen.getByTestId("acs-list-date").textContent).toMatch(/days to go/);
});

it("shows meter, oral line and next look from fixed rows; null percent says not enough", () => {
  render(<AcsReadinessRows rows={[
    row({ percent: 72, oralRated: 3, oralSatisfactory: 2, nextLook: "PA.I.B" }),
    row({ area: "PA.II", title: "Preflight Procedures" }),
  ]} />);
  expect(screen.getByLabelText("72 percent in practice")).toBeTruthy();
  expect(screen.getByText("Oral: 2 of 3 Satisfactory")).toBeTruthy();
  expect(screen.getByText("Next look: PA.I.B")).toBeTruthy();
  expect(screen.getAllByText(NOT_ENOUGH_PRACTICE)).toHaveLength(1);
});

it("a read error renders nothing", async () => {
  (ctx.repositories as { practiceSessions: { getRecentCompletedAttempts: () => Promise<never> } }).practiceSessions.getRecentCompletedAttempts =
    async () => { throw new Error("boom"); };
  const { container } = render(<MemoryRouter><AcsReadinessList /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 20));
  expect(container.textContent).toBe("");
});

it("resolves mock question ids against the bank", () => {
  const q = { question: "Q one", options: ["a", "b"], correctIndex: 1, acsTask: "pa.i.a" } as never;
  const id = "m1:q one";
  const rows = mockRowsFor(
    { questionIds: [id, "gone"], answers: { [id]: "1" }, flags: [], index: 0, startedAt: "", deadline: "", finishedAt: "x" },
    [{ id: "m1" }],
    [{ sourceMaterialId: "m1", questions: [q] }],
  );
  expect(rows).toEqual([{ acsTask: "PA.I.A", correct: true }]);
});
