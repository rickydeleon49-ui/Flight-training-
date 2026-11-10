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

const mat = (id: string, title: string) =>
  makeMaterial({ id, title, topic: "weather", materialType: "study_guide" });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  materials = [mat("m1", "METAR basics"), mat("m2", "Loose notes"), mat("m3", "Cloud types")];
  db = await createNodeSqliteDatabase();
  await db.execute("PRAGMA foreign_keys = OFF");
  const repo = createRepositories(db).libraryFolders;
  const a = await repo.createFolder("Alpha");
  await repo.createFolder("Beta");
  await repo.moveMaterials(["m1", "m2"], a.id);
});
afterEach(() => { cleanup(); db.close(); });

const open = async () => {
  render(<MemoryRouter initialEntries={["/study"]}><StudyLibrary /></MemoryRouter>);
  await screen.findByText("METAR basics");
  fireEvent.change(screen.getByLabelText("View"), { target: { value: "folder" } });
  await screen.findByLabelText("Folder actions: Alpha");
};
const headerTexts = () =>
  screen.getAllByRole("button", { expanded: true }).map((h) => h.textContent ?? "").filter((t) => /\(\d+\)/.test(t));
const doMenu = (folder: string, item: RegExp | string) => {
  const menu = screen.getByLabelText(`Folder actions: ${folder}`).closest("details")!;
  fireEvent.click(within(menu).getByRole("button", { name: item }));
};

it("creates a folder and shows a duplicate-name message", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "New folder" }));
  const dlg = await screen.findByRole("dialog", { name: "New folder" });
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "alpha" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create" }));
  expect(await within(dlg).findByText("You already have a folder called alpha.")).toBeTruthy();
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "Gamma" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create" }));
  await screen.findByLabelText("Folder actions: Gamma");
});

it("renames a folder", async () => {
  await open();
  doMenu("Beta", "Rename…");
  const dlg = await screen.findByRole("dialog", { name: "Rename folder" });
  const input = within(dlg).getByLabelText("Name") as HTMLInputElement;
  expect(input.value).toBe("Beta");
  fireEvent.change(input, { target: { value: "Zulu" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
  await screen.findByLabelText("Folder actions: Zulu");
});

it("moves a folder up and down", async () => {
  await open();
  expect(headerTexts()[0]).toMatch(/Alpha/);
  doMenu("Beta", "Move folder up");
  await waitFor(() => expect(headerTexts()[0]).toMatch(/Beta/));
  doMenu("Beta", "Move folder down");
  await waitFor(() => expect(headerTexts()[0]).toMatch(/Alpha/));
  const alpha = screen.getByLabelText("Folder actions: Alpha").closest("details")!;
  expect((within(alpha).getByRole("button", { name: "Move folder up" }) as HTMLButtonElement).disabled).toBe(true);
});

it("deletes a folder and keeps every material under Not in a folder", async () => {
  await open();
  const links = () => screen.getAllByRole("link").filter((l) => /METAR|Loose|Cloud/.test(l.textContent ?? "")).length;
  const before = links();
  expect(screen.getAllByText(/Not in a folder \(1\)/).length).toBe(2);
  doMenu("Alpha", "Delete folder…");
  const dlg = await screen.findByRole("dialog", { name: "Delete the folder “Alpha”?" });
  expect(within(dlg).getByText(/The 2 materials in it stay in your library under Not in a folder\. Nothing is deleted\./)).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Delete folder" }));
  expect(await within(dlg).findByText("2 materials are now in Not in a folder.")).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByLabelText("Folder actions: Alpha")).toBeNull());
  expect(links()).toBe(before);
  expect((await screen.findAllByText(/Not in a folder \(3\)/)).length).toBeGreaterThan(0);
});

it("has no actions menu on Not in a folder", async () => {
  await open();
  expect(screen.getAllByLabelText(/^Folder actions:/)).toHaveLength(2);
  expect(screen.queryByLabelText(`Folder actions: Not in a folder`)).toBeNull();
});
