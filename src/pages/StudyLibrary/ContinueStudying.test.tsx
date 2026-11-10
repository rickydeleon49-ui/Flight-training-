// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { StudyMaterial } from "@/domain/types";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { makeMaterial } from "@/testing/factories";
import type { AppData } from "@/state/AppDataContext";
import { StudyLibrary } from "./StudyLibrary";
import { recordOpened } from "./recentlyOpened";

let db: TestDatabase;
let materials: StudyMaterial[] = [];
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: {
      materials,
      actions: [], goals: [], events: [], aiStudySets: [], practiceTests: [], questions: [],
    } as unknown as AppData,
    dataRevision: 0,
    repositories: createRepositories(db),
    mutate: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mat = (id: string, title: string) =>
  makeMaterial({ id, title, topic: "weather", materialType: "study_guide" });
const open = () =>
  render(
    <MemoryRouter initialEntries={["/study"]}>
      <Routes>
        <Route path="/study" element={<StudyLibrary />} />
        <Route path="/study/:id" element={<p>Opened material</p>} />
      </Routes>
    </MemoryRouter>,
  );
const row = () => screen.queryByRole("region", { name: "Continue studying" });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  materials = ["A", "B", "C", "D"].map((t) => mat(t.toLowerCase(), `Sheet ${t}`));
  db = await createNodeSqliteDatabase();
});
afterEach(() => { cleanup(); db.close(); });

it("is hidden when nothing was opened", async () => {
  open();
  await screen.findByText("Sheet A");
  expect(row()).toBeNull();
});

it("shows the last three opened, newest first, and the list count is unchanged", async () => {
  for (const id of ["a", "b", "c", "d"]) recordOpened(id);
  open();
  await screen.findByText("Showing 4 of 4 materials");
  const links = within(row()!).getAllByRole("link");
  expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Sheet D", "Sheet C", "Sheet B"]);
});

it("ignores a deleted material and navigates on click", async () => {
  recordOpened("gone");
  recordOpened("b");
  open();
  await screen.findByText("Sheet A");
  const links = within(row()!).getAllByRole("link");
  expect(links).toHaveLength(1);
  fireEvent.click(links[0]!);
  expect(await screen.findByText("Opened material")).toBeTruthy();
});

it("is hidden while searching", async () => {
  recordOpened("a");
  open();
  await screen.findByText("Showing 4 of 4 materials");
  expect(row()).not.toBeNull();
  fireEvent.change(screen.getByLabelText("Search your library"), { target: { value: "Sheet" } });
  expect(row()).toBeNull();
});

it("is hidden in Arrange", async () => {
  recordOpened("a");
  open();
  await screen.findByText("Sheet B");
  fireEvent.change(screen.getByLabelText("View"), { target: { value: "folder" } });
  fireEvent.click(await screen.findByRole("button", { name: "Arrange" }));
  await screen.findByRole("button", { name: "Done" });
  expect(row()).toBeNull();
});
