// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { makeMaterial } from "@/testing/factories";
import type { AppData } from "@/state/AppDataContext";
import { StudyLibrary } from "./StudyLibrary";

let db: TestDatabase;
const part = (n: number) =>
  makeMaterial({
    id: `ch${n}`,
    title: `Book – Chapter ${n}: Topic ${n}`,
    lineage: { rootMaterialId: "book" } as never,
  });
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: {
      materials: [makeMaterial({ id: "book", title: "Big Book" }), part(1), part(2), part(3)],
      actions: [], goals: [], events: [], aiStudySets: [], practiceTests: [], questions: [],
    } as unknown as AppData,
    dataRevision: 0,
    repositories: createRepositories(db),
    mutate: vi.fn(),
    refresh: vi.fn(),
  }),
}));

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  db = await createNodeSqliteDatabase();
});
afterEach(() => { cleanup(); db.close(); });

it("keeps split chapters under their book until asked to show them", () => {
  render(<MemoryRouter initialEntries={["/study"]}><StudyLibrary /></MemoryRouter>);
  expect(screen.getByText("Big Book")).toBeTruthy();
  expect(screen.queryByText(/Chapter 1: Topic 1/)).toBeNull();
  expect(screen.getByText("Showing 1 of 1 materials")).toBeTruthy();
  const toggle = screen.getByRole("button", { name: /Show 3 chapters from Big Book/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(screen.getByText(/Chapter 1: Topic 1/)).toBeTruthy();
  expect(screen.getByText(/Chapter 3: Topic 3/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Hide 3 chapters/ }).getAttribute("aria-expanded")).toBe("true");
});
