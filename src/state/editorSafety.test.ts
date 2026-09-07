// @vitest-environment jsdom
import { createElement as h } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createNodeSqliteDatabase,
  type TestDatabase,
} from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { Notes } from "@/pages/Notes/Notes";
import { PilotToolkit } from "@/pages/PilotToolkit/PilotToolkit";
import { Settings } from "@/pages/Settings/Settings";
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { AppDataProvider, useAppData } from "./AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));
let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;
function Probe() {
  context = useAppData();
  navigate = useNavigate();
  return null;
}
function Ready() {
  const { status } = useAppData();
  return status === "ready"
    ? h(
        Routes,
        null,
        h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
        h(Route, { path: "/toolkit", element: h(PilotToolkit) }),
        h(Route, { path: "/notes", element: h(Notes) }),
        h(Route, { path: "/settings", element: h(Settings) }),
        h(Route, { path: "/journal/new", element: h(JournalForm) }),
        h(Route, { path: "*", element: h("p", null, "Library") }),
      )
    : null;
}
async function open(path: string) {
  render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready)),
    ),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
}
beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({
    id: "a",
    title: "Handbook",
    notes: "original",
  });
  await createRepositories(db).documents.create({
    id: "b",
    title: "Weather",
    notes: "weather notes",
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

it("preserves actual material typing through refresh, navigation and database save", async () => {
  await open("/study/a");
  fireEvent.change(screen.getByRole("textbox", { name: "Personal notes" }), {
    target: { value: "latest text" },
  });
  await act(() => context.refresh());
  expect(
    (
      screen.getByRole("textbox", {
        name: "Personal notes",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("latest text");
  await act(async () => navigate("/study/b"));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Personal notes",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("weather notes");
  await waitFor(async () =>
    expect(
      (await createRepositories(db).documents.list()).find((m) => m.id === "a")
        ?.notes,
    ).toBe("latest text"),
  );
  await act(async () => navigate("/study/a"));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Personal notes",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("latest text");
});

it("serializes read-modify-write mutations and continues after a failure", async () => {
  await open("/study");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  await act(async () => {
    const one = context.mutate(async (repos) => {
      order.push("first");
      await blocked;
      await repos.documents.update("a", { notes: "notes" });
    });
    const two = context.mutate(async (repos) => {
      order.push("second");
      await repos.documents.update("a", { title: "new title" });
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    await Promise.all([one, two]);
    expect(
      await context.mutate(async () => {
        throw new Error("disk failure");
      }),
    ).toBeNull();
    await context.mutate((repos) =>
      repos.documents.update("a", { reviewStatus: "confident" }),
    );
  });
  expect(context.data.materials.find((m) => m.id === "a")).toMatchObject({
    title: "new title",
    notes: "notes",
    reviewStatus: "confident",
  });
});

it("does not treat a successful write with failed refresh as a failed save", async () => {
  await open("/study");
  const original = db.select;
  await act(async () => {
    const result = await context.mutate(async (repos) => {
      await repos.documents.update("a", { notes: "durable" });
      db.select = async () => {
        throw new Error("refresh failed");
      };
    });
    expect(result).not.toBeNull();
  });
  db.select = original;
  expect(context.lastError).toBe("refresh failed");
  expect(
    (await createRepositories(db).documents.list()).find((m) => m.id === "a")
      ?.notes,
  ).toBe("durable");
});

it("keeps a Settings edit when unrelated application data refreshes", async () => {
  await open("/settings");
  const input = screen.getByPlaceholderText("Ava");
  fireEvent.change(input, { target: { value: "Unsaved pilot name" } });
  await act(() => context.refresh());
  expect(screen.getByDisplayValue("Unsaved pilot name")).toBeTruthy();
});

it("recovers a journal draft and preserves it through a background refresh", async () => {
  await open("/journal/new");
  const input = screen.getByPlaceholderText("Crosswind Landings");
  fireEvent.change(input, { target: { value: "My debrief draft" } });
  await act(() => context.refresh());
  expect(screen.getByDisplayValue("My debrief draft")).toBeTruthy();
  await act(async () => navigate("/study"));
  await act(async () => navigate("/journal/new"));
  expect(screen.getByDisplayValue("My debrief draft")).toBeTruthy();
});

it("keeps both rapid readiness changes instead of overwriting the first snapshot", async () => {
  await open("/toolkit");
  const selects = screen.getAllByRole("combobox");
  const ids = context.data.toolkit.readinessItems
    .slice(0, 2)
    .map((item) => item.id);
  fireEvent.change(selects[0]!, { target: { value: "learning" } });
  fireEvent.change(selects[1]!, { target: { value: "learning" } });
  await waitFor(() =>
    expect(
      context.data.toolkit.readinessItems
        .filter((item) => ids.includes(item.id))
        .map((item) => item.status),
    ).toEqual(["learning", "learning"]),
  );
});

it("retains newer typing and blocks duplicate submission during a Notes save", async () => {
  await open("/notes");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding!: Promise<unknown>;
  act(() => {
    holding = context.mutate(async () => blocked);
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
    target: { value: "saved snapshot" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(
    (
      screen.getByRole("button", {
        name: "Save note",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
    target: { value: "newer typing" },
  });
  await act(async () => {
    release();
    await holding;
  });
  await waitFor(() => expect(context.data.notes).toHaveLength(1));
  expect(context.data.notes[0]?.body).toBe("saved snapshot");
  expect(screen.getByDisplayValue("newer typing")).toBeTruthy();
  await act(async () => navigate("/study"));
  await act(async () => navigate("/notes"));
  expect(screen.getByDisplayValue("newer typing")).toBeTruthy();
});

it("keeps the latest Undo request when several deletes arrive before a write finishes", async () => {
  await open("/study");
  await createRepositories(db).documents.create({
    id: "c",
    title: "Keep this one",
  });
  await act(async () => {
    for (const id of ["a", "b", "c"])
      context.deleteWithUndo({
        ids: [id],
        label: id,
        run: (repos) => repos.documents.remove(id),
      });
    context.undoDelete();
  });
  await waitFor(async () => {
    const ids = (await createRepositories(db).documents.list()).map(
      (item) => item.id,
    );
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    expect(ids).toContain("c");
  });
});

it("does not reset the material metadata dialog when autosave refreshes data", async () => {
  await open("/study/a");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const title = screen.getByDisplayValue("Handbook");
  fireEvent.change(title, { target: { value: "Changed title" } });
  await act(() => context.refresh());
  expect(screen.getByDisplayValue("Changed title")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Edit material" })).toBeTruthy();
});
