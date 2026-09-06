import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("personalization", () => {
  /**
   * Everything she personalizes lives in one row of `settings`, in the same
   * database file as her training data. These two tests are the guarantee she
   * was promised: her settings survive closing the app, and they survive an
   * update that brings new schema with it.
   */
  const PERSONAL = {
    pilotName: "Ava",
    certificateGoal: "Commercial Pilot",
    currentFocus: "Short-field landings",
    flightSchool: "Lakeside Aviation",
    instructorName: "Dana",
    homeAirport: "KRHV",
    aircraftType: "C172S",
    trainingStartedOn: "2026-01-12",
    medicalExpiry: "2028-03-31",
    whyNote: "So my daughter sees it was possible.",
    photo: "data:image/webp;base64,UklGRhIAAABXRUJQ",
    accentColor: "sky",
  } as const;

  it("keeps every personal setting after the application is closed and reopened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flight-deck-"));
    const file = join(directory, "her-flight-deck.db");

    try {
      const first = await createNodeSqliteDatabase(file);
      await createRepositories(first).profile.update(PERSONAL);
      // Closing the database is what happens when she quits the application.
      first.close();

      // A fresh launch: the same file, migrations run again over it.
      const second = await createNodeSqliteDatabase(file);
      const profile = await createRepositories(second).profile.get();
      second.close();

      expect(profile).toMatchObject(PERSONAL);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not reset personal settings when the profile is read again", async () => {
    // profile.get() inserts a blank row on first run; it must never do that
    // over an existing one, or a launch would wipe her settings.
    await repos.profile.update(PERSONAL);
    await repos.profile.get();
    await repos.profile.get();

    const profile = await repos.profile.get();
    expect(profile).toMatchObject(PERSONAL);
    expect(await db.select("SELECT id FROM settings")).toHaveLength(1);
  });
});
