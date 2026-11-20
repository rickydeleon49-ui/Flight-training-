// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { OralRating } from "@/domain/types";
import { areaReferences, NeedsWorkList, NEEDS_WORK_FOOTER } from "./NeedsWorkList";

let ctx: Record<string, unknown>;
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ctx }));

const rate = (over: Partial<OralRating>): OralRating => ({
  scenarioId: "s1", title: "Engine failure", rating: "Needs work", area: "PA.IX", date: "2026-11-01", ...over,
});
const view = (ratings: OralRating[]) => render(<MemoryRouter><NeedsWorkList ratings={ratings} /></MemoryRouter>);

beforeEach(() => {
  ctx = {
    data: { materials: [{ id: "m1" }] },
    dataRevision: 1,
    repositories: { oralScenarios: { list: async () => [{ id: "s1" }] } },
  };
});
afterEach(cleanup);

it("shows a needs-work row with Open to its material", async () => {
  view([rate({})]);
  expect(screen.getByText("Engine failure")).toBeTruthy();
  expect(screen.getByText(NEEDS_WORK_FOOTER)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("link", { name: /Open/ }).getAttribute("href")).toBe("/study/m1"));
});

it("hides Open when the material or scenario is gone, without failing", async () => {
  ctx.repositories = { oralScenarios: { list: async () => { throw new Error("gone"); } } };
  view([rate({})]);
  expect(screen.getByText("Engine failure")).toBeTruthy();
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
});

it("a later Satisfactory rating removes the row; nothing renders when empty", () => {
  const { container } = view([rate({}), rate({ rating: "Satisfactory", date: "2026-11-02" })]);
  expect(container.innerHTML).toBe("");
});

it("caps reference documents at 4", () => {
  const refs = areaReferences("PA.I");
  expect(refs.length).toBeGreaterThan(0);
  expect(refs.length).toBeLessThanOrEqual(4);
  expect(new Set(refs.map((d) => d.id)).size).toBe(refs.length);
});
