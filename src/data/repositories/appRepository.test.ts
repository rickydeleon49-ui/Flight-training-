/**
 * What has to still be there tomorrow.
 *
 * Her personal settings, her uploaded study files and the record of her last
 * backup all live in one SQLite file. These tests close the database the way
 * quitting the application does, open it again the way the next launch does,
 * and check that nothing needed a running app to stay true.
 */
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

describe("application metadata", () => {
  it("has no backup recorded until one is saved", async () => {
    expect(await repos.app.lastCompleteBackup()).toBeNull();
  });

  it("remembers the last complete backup, including which version wrote it", async () => {
    await repos.app.recordCompleteBackup({
      at: "2026-09-06T10:00:00.000Z",
      version: "0.2.0",
      path: "/Volumes/Backup/her-flight-deck-2026-09-06.hfdbackup",
    });

    expect(await repos.app.lastCompleteBackup()).toEqual({
      at: "2026-09-06T10:00:00.000Z",
      version: "0.2.0",
      path: "/Volumes/Backup/her-flight-deck-2026-09-06.hfdbackup",
    });
  });

  it("replaces the record rather than accumulating rows", async () => {
    await repos.app.recordCompleteBackup({ at: "2026-09-01T10:00:00.000Z", version: "0.2.0", path: "a" });
    await repos.app.recordCompleteBackup({ at: "2026-09-06T10:00:00.000Z", version: "0.3.0", path: "b" });

    const latest = await repos.app.lastCompleteBackup();
    expect(latest?.at).toBe("2026-09-06T10:00:00.000Z");
    expect(latest?.version).toBe("0.3.0");
    expect(await db.select("SELECT key FROM app_metadata")).toHaveLength(3);
  });

  it("persists and reads daily plan session state", async () => {
    expect(await repos.app.getDailyPlanState()).toBeNull();

    const state = {
      version: 1 as const,
      date: "2026-09-25",
      timeBudget: 20,
      suggestedIds: ["action:a-1", "material:m-1"],
      decisions: {
        "action:a-2": { type: "skip" as const, date: "2026-09-25" },
        "action:a-3": { type: "defer" as const, date: "2026-09-25" },
      },
      updatedAt: "2026-09-25T14:00:00.000Z",
    };

    await repos.app.setDailyPlanState(state);
    const loaded = await repos.app.getDailyPlanState();

    expect(loaded).toEqual(state);
  });
});

describe("everything of hers survives a close and reopen", () => {
  it("keeps settings, uploads and the backup record in the same file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flight-deck-persistence-"));
    const file = join(directory, "her-flight-deck.db");

    try {
      const first = await createNodeSqliteDatabase(file);
      const before = createRepositories(first);

      await before.profile.update({
        pilotName: "Ava",
        flightSchool: "Lakeside Aviation",
        instructorName: "Dana",
        whyNote: "So my daughter sees it was possible.",
        photo: "data:image/webp;base64,UklGRhIAAABXRUJQ",
        accentColor: "sky",
      });
      await before.documents.create({
        title: "Airplane Flying Handbook",
        filePath: "documents/airplane-flying-handbook.pdf",
        originalFileName: "airplane-flying-handbook.pdf",
        fileSize: 4_200_000,
        notes: "Chapter 9 is the one Dana wants me to read.",
        tags: ["landings"],
      });
      await before.app.recordCompleteBackup({
        at: "2026-09-06T10:00:00.000Z",
        version: "0.2.0",
        path: "/Volumes/Backup/her-flight-deck.hfdbackup",
      });
      await before.app.setDailyPlanState({
        version: 1,
        date: "2026-09-25",
        timeBudget: 20,
        suggestedIds: ["action:a-1"],
        decisions: { "action:a-2": { type: "defer", date: "2026-09-25" } },
        updatedAt: "2026-09-25T14:00:00.000Z",
      });

      // Quitting the application.
      first.close();

      // The next launch: the same file, migrations run over it again.
      const second = await createNodeSqliteDatabase(file);
      const after = createRepositories(second);

      const profile = await after.profile.get();
      expect(profile.pilotName).toBe("Ava");
      expect(profile.flightSchool).toBe("Lakeside Aviation");
      expect(profile.whyNote).toBe("So my daughter sees it was possible.");
      expect(profile.photo).toBe("data:image/webp;base64,UklGRhIAAABXRUJQ");
      expect(profile.accentColor).toBe("sky");

      const materials = await after.documents.list();
      expect(materials).toHaveLength(1);
      // The pointer to the uploaded file matters as much as the title: without
      // it the file is still on disk but nothing can find it again.
      expect(materials[0]?.filePath).toBe("documents/airplane-flying-handbook.pdf");
      expect(materials[0]?.originalFileName).toBe("airplane-flying-handbook.pdf");
      expect(materials[0]?.fileSize).toBe(4_200_000);
      expect(materials[0]?.notes).toBe("Chapter 9 is the one Dana wants me to read.");
      expect(materials[0]?.tags).toEqual(["landings"]);

      expect((await after.app.lastCompleteBackup())?.version).toBe("0.2.0");

      const plan = await after.app.getDailyPlanState();
      expect(plan?.date).toBe("2026-09-25");
      expect(plan?.timeBudget).toBe(20);
      expect(plan?.suggestedIds).toEqual(["action:a-1"]);
      expect(plan?.decisions["action:a-2"]).toEqual({ type: "defer", date: "2026-09-25" });

      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
