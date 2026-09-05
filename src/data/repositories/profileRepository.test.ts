import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

let db: TestDatabase;
let repos: Repositories;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
});

afterEach(() => db.close());

describe("profile", () => {
  it("creates the profile on first read", async () => {
    const profile = await repos.profile.get();
    expect(profile.certificateGoal).toBe("Private Pilot");
    expect(profile.pilotName).toBe("");
  });

  it("survives concurrent first reads without duplicating the row", async () => {
    // Two screens loading at once, or an effect running twice, must not
    // both try to insert the single profile row.
    const [a, b, c] = await Promise.all([
      repos.profile.get(),
      repos.profile.get(),
      repos.profile.get(),
    ]);

    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    const rows = await db.select("SELECT id FROM settings");
    expect(rows).toHaveLength(1);
  });

  it("keeps edits and does not overwrite them on later reads", async () => {
    await repos.profile.update({ pilotName: "Ava", currentFocus: "Landings" });
    const profile = await repos.profile.get();
    expect(profile.pilotName).toBe("Ava");
    expect(profile.currentFocus).toBe("Landings");
  });
});
