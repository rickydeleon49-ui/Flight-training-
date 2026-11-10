// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let revision = 0;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({
    data: {
      materials,
      actions: [], goals: [], events: [], aiStudySets: [], practiceTests: [], questions: [],
    } as unknown as AppData,
    dataRevision: revision,
    repositories: createRepositories(db),
    mutate: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mat = (id: string, title: string, extra: Partial<StudyMaterial> = {}) =>
  makeMaterial({ id, title, topic: "weather", materialType: "study_guide", ...extra });

async function seed(): Promise<void> {
  // Placements point at materials that live in the app data here, not in the table.
  await db.execute("PRAGMA foreign_keys = OFF");
  const repo = createRepositories(db).libraryFolders;
  const weather = await repo.createFolder("Weather");
  await repo.createFolder("Empty drawer");
  await repo.moveMaterials(["m1"], weather.id);
  await repo.moveMaterials(["ch1"], weather.id);
}

// The jump link has no aria-expanded; the section header does.
const jumpLinks = (name: RegExp | string) =>
  screen.queryAllByRole("button", { name }).filter((b) => !b.hasAttribute("aria-expanded"));
const headerOf = (name: RegExp | string) =>
  screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-expanded"))!;
const open = () => render(<MemoryRouter initialEntries={["/study"]}><StudyLibrary /></MemoryRouter>);
const setView = (value: string) =>
  fireEvent.change(screen.getByLabelText("View"), { target: { value } });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  revision = 0;
  materials = [
    mat("m1", "METAR basics"),
    mat("m2", "Loose notes", { materialType: "lesson_notes", topic: "navigation" }),
    mat("book", "Big Book"),
    mat("ch1", "Big Book – Chapter 1: Topic 1", { lineage: { rootMaterialId: "book" } as never }),
  ];
  db = await createNodeSqliteDatabase();
  await seed();
});
afterEach(() => { cleanup(); db.close(); });

it("keeps the Everything view as it was", async () => {
  open();
  await screen.findByText("METAR basics");
  expect(screen.getByText("Showing 3 of 3 materials (1 more are chapters inside the books)")).toBeTruthy();
  expect(screen.queryByText(/^In:/)).toBeNull();
});

it("By folder lists folders in order with Not in a folder last, and collapses", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  await screen.findByText("Empty folder");
  const headers = screen.getAllByRole("button", { expanded: true });
  const names = headers.map((h) => h.textContent ?? "").filter((t) => /\(\d+\)/.test(t));
  expect(names[0]).toMatch(/Weather \(1\)/);
  expect(names[1]).toMatch(/Empty drawer \(0\)/);
  expect(names[2]).toMatch(/Not in a folder \(2\)/);
  expect(screen.getByText("Empty folder")).toBeTruthy();
  expect(screen.getByText("3 materials in 2 folders (1 more are chapters inside the books)")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Weather \(1\)/ }));
  expect(screen.queryByText("METAR basics")).toBeNull();
  cleanup();
  open();
  await screen.findByRole("button", { name: /Weather \(1\)/ });
  expect(screen.getByRole("button", { name: /Weather \(1\)/ }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("METAR basics")).toBeNull();
});

it("keeps a chapter under its book, ignoring the chapter's own placement", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  const toggle = await screen.findByRole("button", { name: /Show 1 chapter from Big Book/ });
  fireEvent.click(toggle);
  expect(screen.getByText(/Chapter 1: Topic 1/)).toBeTruthy();
  // Weather holds only METAR basics.
  expect(screen.getByRole("button", { name: /Weather \(1\)/ })).toBeTruthy();
});

it("pages each section on its own at 101 items", async () => {
  materials = Array.from({ length: 101 }, (_, i) => mat(`x${i}`, `Sheet ${String(i).padStart(3, "0")}`));
  open();
  await screen.findByText("Sheet 000");
  setView("folder");
  await waitFor(() => expect(headerOf(/Not in a folder \(101\)/)).toBeTruthy());
  expect(screen.queryByText("Sheet 100")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show 100 more in Not in a folder" }));
  expect(screen.getAllByText(/^Sheet \d+$/).length).toBe(101);
});

it("shows In: folder when searching", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  fireEvent.change(screen.getByLabelText("Search your library"), { target: { value: "metar" } });
  await waitFor(() => expect(screen.getByText("In: Weather")).toBeTruthy());
  expect(screen.getByText("Showing 1 of 1 materials")).toBeTruthy();
});

it("By type groups the materials", async () => {
  open();
  await screen.findByText("METAR basics");
  setView("type");
  expect(await screen.findByText("3 materials in 2 types (1 more are chapters inside the books)")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Study Guide \(2\)/ })).toBeTruthy();
});

it("jump link counts, expands and focuses Not in a folder, and counts a new material", async () => {
  localStorage.setItem("her-flight-deck.view.library.closedSections", JSON.stringify(["folder:none"]));
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  await waitFor(() => expect(jumpLinks("Not in a folder (2)").length).toBe(1));
  const link = jumpLinks("Not in a folder (2)")[0]!;
  const header = headerOf("Not in a folder (2)");
  expect(header.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(link);
  await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("true"));
  expect(document.activeElement).toBe(header);
  expect(screen.getByText("Loose notes")).toBeTruthy();

  // A new material has no placement row, so it lands in Not in a folder.
  materials = [...materials, mat("new1", "Fresh import")];
  revision += 1;
  cleanup();
  open();
  await waitFor(() => expect(jumpLinks("Not in a folder (3)").length).toBe(1));
  expect(screen.getByText("Fresh import")).toBeTruthy();
});

it("hides the jump link when nothing is outside a folder", async () => {
  materials = [mat("m1", "METAR basics")];
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  await screen.findByRole("button", { name: /Weather \(1\)/ });
  expect(jumpLinks(/^Not in a folder/).length).toBe(0);
  await act(async () => {});
});

it("List layout shows rows, is remembered, and still links to the material", async () => {
  open();
  await screen.findByText("METAR basics");
  expect(screen.getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "List" }));
  expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelectorAll(".material-row").length).toBe(3);
  expect(document.querySelectorAll(".material-card").length).toBe(0);
  const link = screen.getByText("METAR basics").closest("a")!;
  expect(link.getAttribute("href")).toBe("/study/m1");
  cleanup();
  open();
  await screen.findByText("METAR basics");
  expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelectorAll(".material-row").length).toBe(3);
});

it("List layout keeps the chapter toggle and works in By folder", async () => {
  localStorage.setItem("her-flight-deck.view.library.layout", JSON.stringify("list"));
  open();
  await screen.findByText("METAR basics");
  setView("folder");
  fireEvent.click(await screen.findByRole("button", { name: /Show 1 chapter from Big Book/ }));
  expect(screen.getByText(/Chapter 1: Topic 1/).closest("a")?.className).toBe("material-row");
});
