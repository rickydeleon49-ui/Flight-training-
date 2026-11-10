// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { LibraryFolder, LibraryPlacement } from "@/logic/libraryFolders";
import { MoveToDialog } from "./MoveToDialog";

let db: TestDatabase;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ repositories: createRepositories(db) }),
}));

let folders: LibraryFolder[] = [];
beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  await db.execute("PRAGMA foreign_keys = OFF");
  const repo = createRepositories(db).libraryFolders;
  await repo.createFolder("Weather");
  await repo.createFolder("Regs");
  folders = await repo.listFolders();
});
afterEach(() => { cleanup(); db.close(); });

const placed = (materialId: string, folderId: string | null): LibraryPlacement =>
  ({ materialId, folderId, position: 1, updatedAt: "" });

it("titles for one and many, and marks where everything already is", () => {
  const { rerender } = render(
    <MoveToDialog open onClose={() => {}} materialIds={["a"]} materialTitle="METAR" folders={folders}
      placements={[placed("a", folders[0]!.id)]} onMoved={() => {}} />,
  );
  expect(screen.getByRole("dialog", { name: "Move “METAR” to…" })).toBeTruthy();
  const here = screen.getByRole("button", { name: "Weather (here now)" }) as HTMLButtonElement;
  expect(here.disabled).toBe(true);
  rerender(
    <MoveToDialog open onClose={() => {}} materialIds={["a", "b"]} folders={folders}
      placements={[placed("a", folders[0]!.id)]} onMoved={() => {}} />,
  );
  expect(screen.getByRole("dialog", { name: "Move 2 materials to…" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Weather" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Not in a folder" }) as HTMLButtonElement).disabled).toBe(false);
});

it("moves to a folder, then reports it", async () => {
  const onMoved = vi.fn();
  const before = vi.fn();
  render(<MoveToDialog open onClose={() => {}} materialIds={["a", "b"]} folders={folders}
    onBeforeMove={before} onMoved={onMoved} />);
  fireEvent.click(screen.getByRole("button", { name: "Regs" }));
  await waitFor(() => expect(onMoved).toHaveBeenCalledWith({ folderId: folders[1]!.id, folderName: "Regs", count: 2 }));
  expect(before).toHaveBeenCalledTimes(1);
  const rows = await createRepositories(db).libraryFolders.listPlacements();
  expect(rows.map((r) => [r.materialId, r.folderId, r.position])).toEqual([
    ["a", folders[1]!.id, 1], ["b", folders[1]!.id, 2],
  ]);
});

it("checks the new folder name inside the dialog", async () => {
  const onMoved = vi.fn();
  render(<MoveToDialog open onClose={() => {}} materialIds={["a"]} folders={folders} onMoved={onMoved} />);
  fireEvent.click(screen.getByRole("button", { name: "New folder…" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "weather" } });
  fireEvent.click(screen.getByRole("button", { name: "Create and move" }));
  expect(await screen.findByText("You already have a folder called weather.")).toBeTruthy();
  expect(onMoved).not.toHaveBeenCalled();
});
