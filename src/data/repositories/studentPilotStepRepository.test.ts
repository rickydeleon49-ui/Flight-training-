import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

describe("student pilot steps", () => {
  let db: TestDatabase;
  let repos: Repositories;
  beforeEach(async () => { db = await createNodeSqliteDatabase(); repos = createRepositories(db); });
  afterEach(() => db.close());
  it("starts empty, ticks, unticks and ticks again", async () => {
    expect(await repos.studentPilotSteps.listDone()).toEqual([]);
    await repos.studentPilotSteps.setDone("medical", true);
    await repos.studentPilotSteps.setDone("discovery", true);
    expect(await repos.studentPilotSteps.listDone()).toEqual(["discovery", "medical"]);
    await repos.studentPilotSteps.setDone("medical", false);
    expect(await repos.studentPilotSteps.listDone()).toEqual(["discovery"]);
    await repos.studentPilotSteps.setDone("medical", true);
    expect(await repos.studentPilotSteps.listDone()).toEqual(["discovery", "medical"]);
  });
  it("import adds ticks but never overrides a step she already changed", async () => {
    await repos.studentPilotSteps.setDone("medical", false);
    await repos.studentPilotSteps.importDone(["medical", "budget"]);
    expect(await repos.studentPilotSteps.listDone()).toEqual(["budget"]);
  });
});
