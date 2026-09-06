import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

describe("notes persistence", () => {
  let db: TestDatabase;
  let repositories: Repositories;

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repositories = createRepositories(db);
  });

  afterEach(() => db.close());

  it("saves a note with nothing but its text", async () => {
    await repositories.notes.create({ body: "Ask about the discovery flight price" });

    expect(await repositories.notes.list()).toMatchObject([
      { title: "", body: "Ask about the discovery flight price", pinned: false },
    ]);
  });

  it("keeps her line breaks exactly as she typed them", async () => {
    const body = "Schools to call:\n\n  · north field\n  · the one by the river";
    await repositories.notes.create({ body });

    expect((await repositories.notes.list())[0]?.body).toBe(body);
  });

  it("edits a note without disturbing what she did not change", async () => {
    const note = await repositories.notes.create({
      title: "Schools",
      body: "north field",
    });

    await repositories.notes.update(note.id, { body: "north field · answers after four" });

    const saved = (await repositories.notes.list())[0];
    expect(saved).toMatchObject({ title: "Schools", body: "north field · answers after four" });
    expect(saved?.createdAt).toBe(note.createdAt);
  });

  it("reads pinned notes first, then the most recently touched", async () => {
    const pinned = await repositories.notes.create({ body: "worth keeping at the top" });
    const older = await repositories.notes.create({ body: "touched last week" });
    const newer = await repositories.notes.create({ body: "touched yesterday" });
    await repositories.notes.update(pinned.id, { pinned: true });

    // Three notes written in the same millisecond would order by chance, so
    // the timestamps this test is about are set explicitly.
    const stamp = async (id: string, at: string) =>
      db.execute("UPDATE notes SET updated_at = ? WHERE id = ?", [at, id]);
    await stamp(pinned.id, "2026-08-01T09:00:00.000Z");
    await stamp(older.id, "2026-09-01T09:00:00.000Z");
    await stamp(newer.id, "2026-09-05T09:00:00.000Z");

    expect((await repositories.notes.list()).map((note) => note.body)).toEqual([
      "worth keeping at the top",
      "touched yesterday",
      "touched last week",
    ]);
  });

  it("says so rather than failing silently when a note is already gone", async () => {
    const note = await repositories.notes.create({ body: "temporary" });
    await repositories.notes.remove(note.id);

    expect(await repositories.notes.list()).toEqual([]);
    await expect(repositories.notes.update(note.id, { body: "back?" })).rejects.toThrow(
      /no longer exists/,
    );
  });
});
