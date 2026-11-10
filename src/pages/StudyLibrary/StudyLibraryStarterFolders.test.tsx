// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { StudyMaterial } from "@/domain/types";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { makeMaterial } from "@/testing/factories";
import type { AppData } from "@/state/AppDataContext";
import { StudyLibrary } from "./StudyLibrary";

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

const mat = (id: string, title: string, extra: Partial<StudyMaterial> = {}) =>
  makeMaterial({ id, title, topic: "weather", materialType: "study_guide", ...extra });
const open = () => render(<MemoryRouter initialEntries={["/study"]}><StudyLibrary /></MemoryRouter>);
const setView = (value: string) =>
  fireEvent.change(screen.getByLabelText("View"), { target: { value } });
const BUTTON = "Make folders from my topics";

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  materials = [
    mat("m1", "METAR basics"),
    mat("m2", "Loose notes", { topic: "navigation" }),
    mat("book", "Big Book"),
    mat("ch1", "Big Book – Chapter 1: Topic 1", { topic: "regulations", lineage: { rootMaterialId: "book" } as never }),
  ];
  db = await createNodeSqliteDatabase();
  await db.execute("PRAGMA foreign_keys = OFF");
});
afterEach(() => { cleanup(); db.close(); });

it("shows the hint with the example as text only, and creates no Checkride prep folder", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  expect(await screen.findByText(/for example Checkride prep/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "New folder" }).length).toBeGreaterThan(0);
  expect(await createRepositories(db).libraryFolders.listFolders()).toEqual([]);
});

it("makes one folder per topic in order and keeps chapters with their book", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Make 2 folders, one for each topic/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Make folders" }));
  const repo = createRepositories(db).libraryFolders;
  await waitFor(async () => expect((await repo.listFolders()).length).toBe(2));
  const folders = await repo.listFolders();
  const places = await repo.listPlacements();
  const members = (name: string) =>
    places.filter((p) => p.folderId === folders.find((f) => f.name === name)!.id).map((p) => p.materialId).sort();
  const names = folders.map((f) => f.name);
  expect(names.length).toBe(2);
  expect(names).not.toContain("Checkride prep");
  expect(members(names[0]!).concat(members(names[1]!)).sort()).toEqual(["book", "m1", "m2"]);
  expect(places.some((p) => p.materialId === "ch1")).toBe(false);
  // Button is gone now that folders exist.
  await waitFor(() => expect(screen.queryByRole("button", { name: BUTTON })).toBeNull());
});

it("does not offer the button once a folder exists, and Cancel changes nothing", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(await createRepositories(db).libraryFolders.listFolders()).toEqual([]);
  cleanup();
  await createRepositories(db).libraryFolders.createFolder("Mine");
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  await screen.findByRole("button", { name: /Mine/ });
  expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
});
