// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
let mac = true;
let ios = false;
vi.mock("@/services/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/platform")>()),
  isMacOS: () => mac,
  isIOS: () => ios,
}));
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

let weatherId = "";
let regsId = "";
const where = async () =>
  Object.fromEntries(
    (await createRepositories(db).libraryFolders.listPlacements()).map((p) => [p.materialId, [p.folderId, p.position]]),
  );

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  mac = true;
  ios = false;
  materials = [
    mat("m1", "METAR basics"),
    mat("m2", "TAF reading"),
    mat("m3", "Winds aloft"),
    mat("m4", "Radar notes"),
    mat("book", "Big Book"),
    makeMaterial({ id: "ch1", title: "Big Book – Chapter 1: Topic 1", lineage: { rootMaterialId: "book" } as never }),
  ];
  db = await createNodeSqliteDatabase();
  await db.execute("PRAGMA foreign_keys = OFF");
  const repo = createRepositories(db).libraryFolders;
  weatherId = (await repo.createFolder("Weather")).id;
  regsId = (await repo.createFolder("Regs")).id;
  await repo.moveMaterials(["m1", "m2"], weatherId);
});
afterEach(() => { cleanup(); db.close(); vi.useRealTimers(); });

const mount = () => render(<MemoryRouter initialEntries={["/study"]}><StudyLibrary /></MemoryRouter>);
const open = async () => {
  mount();
  await screen.findByText("METAR basics");
  fireEvent.change(screen.getByLabelText("View"), { target: { value: "folder" } });
  await screen.findByLabelText("Folder actions: Weather");
};
const arrange = async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
  await screen.findByRole("group", { name: "Arrange" });
};
const box = (title: string) => screen.getByRole("checkbox", { name: title }) as HTMLInputElement;
const toastText = () =>
  screen.getAllByRole("status").map((n) => n.textContent ?? "").find((t) => /^(Moved|Undone)/.test(t)) ?? "";
const dialog = () => screen.getByRole("dialog");
const press = (init: KeyboardEventInit) => fireEvent.keyDown(document.body, init);

it("tapping a row selects it and does not open the material", async () => {
  await arrange();
  fireEvent.click(box("TAF reading").closest(".arrange-row")!);
  expect(box("TAF reading").checked).toBe(true);
  expect(screen.getByText("1 selected")).toBeTruthy();
  fireEvent.click(box("TAF reading"));
  expect(box("TAF reading").checked).toBe(false);
  expect(document.querySelector('a[href="/study/m2"]')).toBeNull();
});

it("search metar, Select all shown, Move to Weather puts only those there", async () => {
  await arrange();
  fireEvent.change(screen.getByLabelText("Search your library"), { target: { value: "radar" } });
  await waitFor(() => expect(screen.queryByText("TAF reading")).toBeNull());
  expect(screen.queryByRole("button", { name: /Move Radar notes up/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
  expect(screen.getByText("1 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Move 1 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Weather" }));
  await waitFor(() => expect(toastText()).toBe("Moved 1 to Weather. Undo"));
  const now = await where();
  expect(now.m4?.[0]).toBe(weatherId);
  expect(now.m3).toBeUndefined();
  expect(now.m1).toEqual([weatherId, 1]);
});

it("up and down reorder and persist after remount", async () => {
  await arrange();
  fireEvent.click(screen.getByRole("button", { name: "Move TAF reading up" }));
  await waitFor(async () => expect((await where()).m2).toEqual([weatherId, 1]));
  expect((await where()).m1).toEqual([weatherId, 2]);
  cleanup();
  await open();
  const rows = screen.getAllByText(/METAR basics|TAF reading/).map((n) => n.textContent);
  expect(rows).toEqual(["TAF reading", "METAR basics"]);
});

it("arrows are disabled unless the sort is My order", async () => {
  localStorage.setItem("her-flight-deck.view.library.folderSort", JSON.stringify("title"));
  await arrange();
  const up = screen.getByRole("button", { name: "Move TAF reading up" }) as HTMLButtonElement;
  expect(up.disabled).toBe(true);
  expect(up.title).toBe("Choose Sort: My order to arrange by hand");
});

it("chapters are not selectable and the book says they move with it", async () => {
  await arrange();
  fireEvent.click(screen.getByRole("button", { name: /Show 1 chapter from Big Book/ }));
  expect(screen.queryByRole("checkbox", { name: /Chapter 1/ })).toBeNull();
  fireEvent.click(box("Big Book"));
  expect(screen.getByText("(1 chapter moves with this book)")).toBeTruthy();
});

it("Done clears the selection and leaves Arrange; Escape does too", async () => {
  await arrange();
  fireEvent.click(box("Winds aloft"));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("group", { name: "Arrange" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
  expect(screen.getByText("0 selected")).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Arrange" })).toBeNull();
});

it("New folder… in the dialog creates the folder and moves", async () => {
  await arrange();
  fireEvent.click(box("Winds aloft"));
  fireEvent.click(screen.getByRole("button", { name: "Move 1 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "New folder…" }));
  fireEvent.change(within(dialog()).getByLabelText("Name"), { target: { value: "Checkride prep" } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Create and move" }));
  await waitFor(() => expect(toastText()).toBe("Moved 1 to Checkride prep. Undo"));
  const folders = await createRepositories(db).libraryFolders.listFolders();
  const made = folders.find((f) => f.name === "Checkride prep")!;
  expect((await where()).m3).toEqual([made.id, 1]);
});

it("Undo puts three moved items back, and a second Undo does nothing", async () => {
  await arrange();
  const before = await where();
  for (const t of ["METAR basics", "Winds aloft", "Radar notes"]) fireEvent.click(box(t));
  fireEvent.click(screen.getByRole("button", { name: "Move 3 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(toastText()).toBe("Moved 3 to Regs. Undo"));
  expect((await where()).m1).toEqual([regsId, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(toastText()).toBe("Undone"));
  const after = await where();
  expect(after.m1).toEqual(before.m1);
  expect(after.m2).toEqual(before.m2);
  for (const id of ["m3", "m4"]) expect(after[id]?.[0] ?? null).toBe(null);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  press({ key: "z", metaKey: true });
  await act(async () => {});
  expect(await where()).toEqual(after);
});

it("a second move replaces the first undo", async () => {
  await arrange();
  fireEvent.click(box("Winds aloft"));
  fireEvent.click(screen.getByRole("button", { name: "Move 1 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(toastText()).toBe("Moved “Winds aloft” to Regs. Undo".replace("“Winds aloft”", "1")));
  fireEvent.click(box("Radar notes"));
  fireEvent.click(screen.getByRole("button", { name: "Move 1 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Weather" }));
  await waitFor(async () => expect((await where()).m4?.[0]).toBe(weatherId));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(toastText()).toBe("Undone"));
  const after = await where();
  expect(after.m4?.[0] ?? null).toBe(null);
  expect(after.m3?.[0]).toBe(regsId);
});

it("the toast goes away after 10 seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await arrange();
  fireEvent.click(box("Winds aloft"));
  fireEvent.click(screen.getByRole("button", { name: "Move 1 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(toastText()).toMatch(/^Moved/));
  act(() => { vi.advanceTimersByTime(9_000); });
  expect(toastText()).toMatch(/^Moved/);
  act(() => { vi.advanceTimersByTime(1_500); });
  expect(toastText()).toBe("");
});

const moveOne = async () => {
  await arrange();
  fireEvent.click(box("Winds aloft"));
  fireEvent.click(screen.getByRole("button", { name: "Move 1 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(toastText()).toMatch(/^Moved/));
};

it("Cmd-Z undoes on a Mac", async () => {
  await moveOne();
  press({ key: "z", metaKey: true });
  await waitFor(() => expect(toastText()).toBe("Undone"));
  expect(((await where()).m3?.[0]) ?? null).toBe(null);
});

it("Cmd-Z does nothing on iOS or while typing", async () => {
  ios = true;
  mac = false;
  await moveOne();
  press({ key: "z", metaKey: true });
  press({ key: "z", ctrlKey: true });
  await act(async () => {});
  expect((await where()).m3?.[0]).toBe(regsId);
  ios = false;
  mac = true;
  const search = screen.getByLabelText("Search your library");
  fireEvent.keyDown(search, { key: "z", metaKey: true });
  await act(async () => {});
  expect((await where()).m3?.[0]).toBe(regsId);
  press({ key: "z", metaKey: true });
  await waitFor(() => expect(toastText()).toBe("Undone"));
});

it("up then Undo restores the order", async () => {
  await arrange();
  fireEvent.click(screen.getByRole("button", { name: "Move TAF reading up" }));
  await waitFor(() => expect(toastText()).toBe("Moved “TAF reading” up. Undo"));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(toastText()).toBe("Undone"));
  const now = await where();
  expect(now.m1).toEqual([weatherId, 1]);
  expect(now.m2).toEqual([weatherId, 2]);
});

it("moving 12 items says how many, and a collapsed folder is opened and highlighted", async () => {
  materials = [...materials, ...Array.from({ length: 8 }, (_, i) => mat(`x${i}`, `Sheet ${i}`))];
  localStorage.setItem(
    "her-flight-deck.view.library.closedSections",
    JSON.stringify([`folder:folder:${regsId}`]),
  );
  await arrange();
  expect(screen.getByRole("button", { name: /Regs \(0\)/ }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
  expect(screen.getByText("13 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Move 13 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(toastText()).toBe("Moved 13 to Regs. Undo"));
  const header = await screen.findByRole("button", { name: /Regs \(13\)/ });
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(header.closest(".library__section-head")!.className).toContain("library__section-head--flash");
});
