import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositories, type Repositories } from "./repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { initializeAirlineStarterPack, restoreAirlineStarterPack } from "./starter";

describe("airline pilot starter pack", () => {
  let db: TestDatabase;
  let repositories: Repositories;

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repositories = createRepositories(db);
  });

  afterEach(() => db.close());

  it("installs useful, non-personal content on an empty first run", async () => {
    expect(await initializeAirlineStarterPack(repositories)).toBe(true);

    const [profile, milestones, goals, materials, events, journal, transactions] =
      await Promise.all([
        repositories.profile.get(),
        repositories.milestones.list(),
        repositories.goals.list(),
        repositories.documents.list(),
        repositories.schedule.list(),
        repositories.journal.list(),
        repositories.finance.list(),
      ]);

    expect(profile.certificateGoal).toBe("Airline Pilot");
    expect(milestones).toHaveLength(9);
    expect(goals).toHaveLength(9);
    expect(materials).toHaveLength(7);
    expect(materials.every((item) => item.tags.includes("Airline Starter Pack"))).toBe(true);
    expect(events).toHaveLength(0);
    expect(journal).toHaveLength(0);
    expect(transactions).toHaveLength(0);
  });

  it("does not duplicate content on later launches", async () => {
    await initializeAirlineStarterPack(repositories);
    const reopenedRepositories = createRepositories(db);
    expect(await initializeAirlineStarterPack(reopenedRepositories)).toBe(false);

    expect(await repositories.milestones.list()).toHaveLength(9);
    expect(await repositories.goals.list()).toHaveLength(9);
    expect(await repositories.documents.list()).toHaveLength(7);
  });

  it("restores only missing starter items", async () => {
    await initializeAirlineStarterPack(repositories);
    const materials = await repositories.documents.list();
    await repositories.documents.remove(materials[0]!.id);

    const result = await restoreAirlineStarterPack(repositories);
    expect(result).toEqual({ milestones: 0, goals: 0, checklistItems: 0, materials: 1 });
    expect(await repositories.documents.list()).toHaveLength(7);
  });

  it("does not merge into an existing personal record automatically", async () => {
    await repositories.milestones.create({ title: "My own first step" });

    expect(await initializeAirlineStarterPack(repositories)).toBe(false);
    expect((await repositories.milestones.list()).map((item) => item.title)).toEqual([
      "My own first step",
    ]);
  });
});
