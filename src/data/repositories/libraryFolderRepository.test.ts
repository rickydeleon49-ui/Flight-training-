import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

describe("library folders", () => {
  let db: TestDatabase;
  let repos: Repositories;
  const lf = () => repos.libraryFolders;
  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    for (const id of ["a", "b", "c"]) await repos.documents.create({ id, title: `Material ${id}` });
  });
  afterEach(() => db.close());

  it("creates, renames, refuses duplicates and the 51st folder", async () => {
    const one = await lf().createFolder("  Weather ");
    const two = await lf().createFolder("Regs");
    expect([one.name, one.position, two.position]).toEqual(["Weather", 1, 2]);
    await expect(lf().createFolder("weather")).rejects.toThrow("already have");
    await expect(lf().createFolder("  ")).rejects.toThrow("name");
    await lf().renameFolder(one.id, "Weather 2");
    await expect(lf().renameFolder(one.id, "Regs")).rejects.toThrow("already have");
    await lf().renameFolder(one.id, "WEATHER 2"); // own name is not a clash
    expect((await lf().listFolders()).map((f) => f.name)).toEqual(["WEATHER 2", "Regs"]);
    for (let i = 3; i <= 50; i++) await lf().createFolder(`F${i}`);
    await expect(lf().createFolder("One too many")).rejects.toThrow("50");
    expect(await lf().listFolders()).toHaveLength(50);
  });

  it("moves materials in order, to null, and reorders with setOrder", async () => {
    const f = await lf().createFolder("Weather");
    await lf().moveMaterials(["a", "b"], f.id);
    await lf().moveMaterials(["c"], f.id);
    const pos = async () =>
      Object.fromEntries((await lf().listPlacements()).map((p) => [p.materialId, [p.folderId, p.position]]));
    expect(await pos()).toEqual({ a: [f.id, 1], b: [f.id, 2], c: [f.id, 3] });
    await lf().setOrder(f.id, ["c", "a", "b"]);
    expect(await pos()).toEqual({ c: [f.id, 1], a: [f.id, 2], b: [f.id, 3] });
    await lf().moveMaterials(["a", "a"], null);
    expect((await pos()).a).toEqual([null, null]);
    await lf().moveMaterials([], f.id);
  });

  it("restorePlacements puts earlier folders and positions back in one call", async () => {
    const f = await lf().createFolder("Weather");
    const g = await lf().createFolder("Regs");
    await lf().moveMaterials(["a", "b", "c"], f.id);
    const before = await lf().listPlacements();
    await lf().moveMaterials(["a", "b"], g.id);
    await lf().setOrder(f.id, ["c"]);
    await lf().restorePlacements(
      before.map(({ materialId, folderId, position }) => ({ materialId, folderId, position })),
    );
    const key = (rows: typeof before) =>
      rows.map((p) => [p.materialId, p.folderId, p.position]).sort();
    expect(key(await lf().listPlacements())).toEqual(key(before));
    await lf().restorePlacements([]);
  });

  it("moveFolder swaps neighbours and ignores the edges", async () => {
    const x = await lf().createFolder("X");
    const y = await lf().createFolder("Y");
    const z = await lf().createFolder("Z");
    await lf().moveFolder(x.id, "up");
    await lf().moveFolder(z.id, "down");
    expect((await lf().listFolders()).map((f) => f.name)).toEqual(["X", "Y", "Z"]);
    await lf().moveFolder(z.id, "up");
    expect((await lf().listFolders()).map((f) => [f.name, f.position])).toEqual([["X", 1], ["Z", 2], ["Y", 3]]);
    await lf().moveFolder(y.id, "up");
    expect((await lf().listFolders()).map((f) => f.name)).toEqual(["X", "Y", "Z"]);
  });

  it("deleting a folder clears placements and never touches materials", async () => {
    const f = await lf().createFolder("Weather");
    await lf().moveMaterials(["a", "b"], f.id);
    const before = await db.select("SELECT * FROM study_materials ORDER BY id");
    await lf().deleteFolder(f.id);
    expect(await db.select("SELECT * FROM study_materials ORDER BY id")).toEqual(before);
    expect(await lf().listFolders()).toEqual([]);
    const placements = await lf().listPlacements();
    expect(placements).toHaveLength(2);
    expect(placements.every((p) => p.folderId === null && p.position === null)).toBe(true);
  });

  it("a failed folder delete rolls back the placement changes too", async () => {
    const f = await lf().createFolder("Weather");
    await lf().moveMaterials(["a", "b"], f.id);
    await db.execute(
      "CREATE TRIGGER fail_folder BEFORE DELETE ON library_folders BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    await expect(lf().deleteFolder(f.id)).rejects.toThrow();
    expect(await lf().listFolders()).toHaveLength(1);
    expect((await lf().listPlacements()).every((p) => p.folderId === f.id && p.position !== null)).toBe(true);
  });

  it("deleting a material removes its placement", async () => {
    const f = await lf().createFolder("Weather");
    await lf().moveMaterials(["a", "b"], f.id);
    await repos.documents.remove("a");
    expect((await lf().listPlacements()).map((p) => p.materialId)).toEqual(["b"]);
  });
});
