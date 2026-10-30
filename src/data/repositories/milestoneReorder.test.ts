// ASTRA-FIX-2 #7: moving a milestone writes every affected position at once.
import { afterEach, beforeEach, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { reorderMilestones } from "@/logic/progress";
import { createRepositories, type Repositories } from "./index";

let db: TestDatabase;
let repos: Repositories;
beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  for (const [position, title] of ["Ground school", "First solo", "Checkride"].entries()) {
    await repos.milestones.create({ title, position });
  }
});
afterEach(() => db.close());

const order = async () => (await repos.milestones.list()).map((m) => [m.title, m.position]);

it("applies a move to every affected milestone", async () => {
  const list = await repos.milestones.list();
  await repos.milestones.reorder(reorderMilestones(list, list[2]!.id, "up"));
  expect((await repos.milestones.list()).map((m) => m.title)).toEqual(["Ground school", "Checkride", "First solo"]);
});

it("keeps the old order when a later position write fails", async () => {
  const list = await repos.milestones.list();
  const before = await order();
  const updates = reorderMilestones(list, list[2]!.id, "up");
  expect(updates.length).toBeGreaterThan(1);
  const last = updates[updates.length - 1]!.id;
  await db.execute(
    `CREATE TRIGGER fail_move BEFORE UPDATE ON milestones WHEN NEW.id = '${last}'
     BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`,
  );
  await expect(repos.milestones.reorder(updates)).rejects.toThrow();
  expect(await order()).toEqual(before);
});

it("refuses a move that names a milestone no longer there, changing nothing", async () => {
  const list = await repos.milestones.list();
  const before = await order();
  await expect(
    repos.milestones.reorder([{ id: list[0]!.id, position: 1 }, { id: "gone", position: 0 }]),
  ).rejects.toThrow();
  expect(await order()).toEqual(before);
});
