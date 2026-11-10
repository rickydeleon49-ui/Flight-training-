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
  await repo.createFolder("Regs");
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
const box = (title: string) => screen.getByRole("checkbox", { name: new RegExp(`Select ${title}`) }) as HTMLInputElement;
const say = () => document.querySelector<HTMLElement>(".visually-hidden[role=status]")?.textContent ?? "";
const dialog = () => screen.getByRole("dialog");

it("says where a moved row went, then Undone, then goes quiet after 5 seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await arrange();
  fireEvent.click(screen.getByRole("button", { name: "Move Winds aloft up" }).closest(".arrange-row")!.querySelector("button:last-child")!);
  fireEvent.click(within(dialog()).getByRole("button", { name: "Weather" }));
  await waitFor(() => expect(say()).toBe("Winds aloft moved to Weather, position 3 of 3"));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(say()).toBe("Undone"));
  act(() => { vi.advanceTimersByTime(5_500); });
  expect(say()).toBe("");
});

it("says how many when several move", async () => {
  await arrange();
  fireEvent.click(box("Winds aloft"));
  fireEvent.click(box("Radar notes"));
  fireEvent.click(screen.getByRole("button", { name: "Move 2 to…" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(say()).toBe("2 materials moved to Regs"));
});

it("focus lands on the same row's checkbox after Move to… from a row", async () => {
  await arrange();
  const row = box("Winds aloft").closest(".arrange-row")!;
  fireEvent.click(Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Move to…")!);
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(document.activeElement).toBe(box("Winds aloft")));
});

it("focus goes to the next row when the moved row is no longer shown", async () => {
  await arrange();
  // Hide the moved row after the move by filtering it out of the view.
  const row = box("Winds aloft").closest(".arrange-row")!;
  fireEvent.click(Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Move to…")!);
  fireEvent.change(screen.getByLabelText("Search your library"), { target: { value: "radar" } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(document.activeElement).toBe(box("Radar notes")));
});

it("up and down keep focus on the same button of the moved row", async () => {
  await arrange();
  const up = screen.getByRole("button", { name: "Move TAF reading up" });
  up.focus();
  fireEvent.click(up);
  await waitFor(async () => expect((await where()).m2).toEqual([weatherId, 1]));
  // It is now first, so Up is off; focus falls to Down on that row.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move TAF reading down" })));
  fireEvent.click(document.activeElement!);
  await waitFor(async () => expect((await where()).m2).toEqual([weatherId, 2]));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move TAF reading down" })));
});

it("every checkbox is named after its material and Space toggles it", async () => {
  await arrange();
  for (const t of ["METAR basics", "TAF reading", "Winds aloft", "Radar notes", "Big Book"]) {
    expect(screen.getByRole("checkbox", { name: `Select ${t}` })).toBeTruthy();
  }
  expect(document.querySelectorAll(".library__section-head input[type=checkbox]").length).toBe(0);
  // A real checkbox: Space on the focused box toggles it natively (jsdom only fakes the click).
  box("Radar notes").focus();
  expect(document.activeElement).toBe(box("Radar notes"));
  expect(box("Radar notes").type).toBe("checkbox");
  expect(box("Radar notes").closest("[role=button]")).toBeNull();
  fireEvent.click(box("Radar notes"));
  expect(box("Radar notes").checked).toBe(true);
  fireEvent.click(box("Radar notes"));
  expect(box("Radar notes").checked).toBe(false);
});

it("Cmd-A on a Mac selects all shown, and the page default is stopped", async () => {
  await arrange();
  const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true });
  act(() => { document.body.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByText("5 selected")).toBeTruthy();
  const ctrl = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ctrl);
  expect(ctrl.defaultPrevented).toBe(false);
});

it("Ctrl-A selects all shown off a Mac", async () => {
  mac = false;
  await arrange();
  const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { document.body.dispatchEvent(event); });
  expect(screen.getByText("5 selected")).toBeTruthy();
});

it("Cmd-A does not select while typing in the search box", async () => {
  await arrange();
  const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true });
  screen.getByLabelText("Search your library").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(screen.getByText("0 selected")).toBeTruthy();
});
