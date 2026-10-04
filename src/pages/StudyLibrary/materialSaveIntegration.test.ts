// @vitest-environment jsdom
/**
 * Study Library save and file ownership, end to end in the frontend: the real
 * page, AppDataProvider.mutate, the repository and a real node:sqlite
 * database. Only the native file service is replaced — it is the boundary the
 * Rust tests in `documents_save_tests.rs` cover with real files — so these
 * cases prove what the database holds and which files the page asks to
 * discard, not what happens on disk.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { StudyLibrary } from "./StudyLibrary";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

const files = vi.hoisted(() => ({ pick: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/services/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/documents")>()),
  canHandleFiles: () => true,
  pickAndImportDocument: files.pick,
  cleanupDocuments: files.cleanup,
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}

beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  db = await createNodeSqliteDatabase();
  files.pick.mockReset();
  files.cleanup.mockReset().mockResolvedValue([]);
  render(
    h(AppDataProvider, null,
      h(MemoryRouter, { initialEntries: ["/study"] },
        h(Probe),
        h(Routes, null, h(Route, { path: "/study", element: h(StudyLibrary) })),
      ),
    ),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
});

afterEach(() => {
  cleanup();
  db.close();
});

const dialog = () => screen.getByRole("dialog");

async function openFormWithFile(title: string, tags: string, relativePath: string) {
  files.pick.mockResolvedValue({ relativePath, originalFileName: relativePath, fileSize: 2048 });
  fireEvent.click(screen.getAllByRole("button", { name: /Add material/ })[0]!);
  fireEvent.change(within(dialog()).getByLabelText("Title"), { target: { value: title } });
  fireEvent.change(within(dialog()).getByLabelText(/Tags/), { target: { value: tags } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Choose a file" }));
  await within(dialog()).findByText(relativePath);
}

/** Rows this test added: starter data seeded on first launch is left out. */
async function rows() {
  const ours = <T extends { id?: string; material_id?: string }>(list: T[]) =>
    list.filter((row) => !starterMaterials.has(String(row.id ?? row.material_id)));
  return {
    materials: ours(await db.select<{ id: string }>("SELECT id, title, file_path FROM study_materials")),
    links: ours(
      await db.select<{ material_id: string; name: string }>(
        "SELECT mt.material_id, t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id ORDER BY t.name",
      ),
    ).map(({ name }) => ({ name })),
    tags: (await db.select<{ name: string }>("SELECT name FROM tags ORDER BY name"))
      .map((row) => row.name)
      .filter((name) => !starterTags.has(name)),
  };
}

/** Every path the page asked the file service to discard (empty requests are no-ops). */
const discarded = () => files.cleanup.mock.calls.flatMap(([paths]) => paths as string[]);

let starterTags: Set<string>;
let starterMaterials: Set<string>;
beforeEach(async () => {
  starterTags = new Set(
    (await db.select<{ name: string }>("SELECT name FROM tags")).map((row) => row.name),
  );
  starterMaterials = new Set(
    (await db.select<{ id: string }>("SELECT id FROM study_materials")).map((row) => row.id),
  );
});

it("a failed save leaves no rows and keeps the import; the retry commits once and keeps the file", async () => {
  await db.execute(
    "CREATE TRIGGER fail_ifr BEFORE INSERT ON tags WHEN NEW.name = 'IFR' BEGIN SELECT RAISE(FAIL, 'injected tag failure'); END",
  );
  await openFormWithFile("Synthetic handbook", "Weather, Weather , IFR", "imported-guide.pdf");

  fireEvent.click(within(dialog()).getByRole("button", { name: "Add material" }));
  await within(dialog()).findByText(/could not be saved/);
  expect(await rows()).toEqual({ materials: [], links: [], tags: [] });
  expect(within(dialog()).getByText("imported-guide.pdf")).toBeTruthy();
  expect(discarded()).toEqual([]);

  await db.execute("DROP TRIGGER fail_ifr");
  fireEvent.click(within(dialog()).getByRole("button", { name: "Add material" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  const saved = await rows();
  expect(saved.materials).toEqual([
    expect.objectContaining({ title: "Synthetic handbook", file_path: "imported-guide.pdf" }),
  ]);
  expect(saved.links).toEqual([{ name: "IFR" }, { name: "Weather" }]);
  expect(saved.tags).toEqual(["IFR", "Weather"]);
  expect(discarded()).toEqual([]);
  expect(
    context.data.materials.filter((m) => !starterMaterials.has(m.id)).map((m) => m.filePath),
  ).toEqual(["imported-guide.pdf"]);
});

it("cancelling after a failed save discards only that new, never-committed import", async () => {
  await openFormWithFile("Kept material", "Kept", "kept.pdf");
  fireEvent.click(within(dialog()).getByRole("button", { name: "Add material" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await db.execute(
    "CREATE TRIGGER fail_all BEFORE INSERT ON study_materials BEGIN SELECT RAISE(FAIL, 'injected material failure'); END",
  );
  await openFormWithFile("Abandoned", "Other", "abandoned.pdf");
  fireEvent.click(within(dialog()).getByRole("button", { name: "Add material" }));
  await within(dialog()).findByText(/could not be saved/);
  fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(discarded()).toEqual(["abandoned.pdf"]));
  const after = await rows();
  expect(after.materials).toEqual([
    expect.objectContaining({ title: "Kept material", file_path: "kept.pdf" }),
  ]);
  expect(after.links).toEqual([{ name: "Kept" }]);
  expect(after.tags).toEqual(["Kept"]);
});

it("a committed material save followed by refresh failure remains a successful save and keeps the attachment", async () => {
  await openFormWithFile("Committed with refresh failure", "Nav", "attached-guide.pdf");

  const originalSelect = db.select;
  let saveFinished = false;
  db.select = async function <T>(sql: string, params: import("@/data/db").SqlValue[] = []): Promise<T[]> {
    if (saveFinished && /FROM study_materials/i.test(sql)) {
      throw new Error("synthetic refresh failure");
    }
    return originalSelect.call(db, sql, params) as Promise<T[]>;
  };

  const originalSave = db.saveMaterialAtomically!;
  db.saveMaterialAtomically = async function (op) {
    const res = await originalSave.call(db, op);
    saveFinished = true;
    return res;
  };

  fireEvent.click(within(dialog()).getByRole("button", { name: "Add material" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  db.select = originalSelect;
  expect(context.lastError).toBe("synthetic refresh failure");
  expect(discarded()).toEqual([]);

  const saved = await rows();
  expect(saved.materials).toEqual([
    expect.objectContaining({
      title: "Committed with refresh failure",
      file_path: "attached-guide.pdf",
    }),
  ]);
  expect(saved.tags).toEqual(["Nav"]);
});
