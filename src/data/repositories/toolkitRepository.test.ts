import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { TOOLKIT_UNREADABLE_MESSAGE } from "./toolkitRepository";
import { createRepositories, type Repositories } from "./index";

let db: TestDatabase;
let repos: Repositories;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
});

afterEach(() => db.close());

describe("pilot toolkit persistence", () => {
  it("starts with useful built-in readiness data and keeps personal edits", async () => {
    const initial = await repos.toolkit.get();
    expect(initial.readinessItems.length).toBeGreaterThan(10);

    await repos.toolkit.save({
      ...initial,
      targetAirline: "A future employer",
      reminderLeadDays: 14,
    });

    const saved = await repos.toolkit.get();
    expect(saved.targetAirline).toBe("A future employer");
    expect(saved.reminderLeadDays).toBe(14);
  });

  it.each([
    ["not json", "not json"],
    ["half-written row", '{"targetAirline":"Mine","credentials":[{"id":"c1"'],
    ["a row from a newer build", JSON.stringify({ version: 2, targetAirline: "Mine", futureField: [1] })],
    ["not an object", "[1,2,3]"],
  ])("never overwrites an unreadable toolkit (%s)", async (_label, raw) => {
    await db.execute(
      "INSERT INTO pilot_toolkit (id, state_json, updated_at) VALUES ('toolkit', ?, '2026-10-29T00:00:00.000Z')",
      [raw],
    );
    expect(await repos.toolkit.isUnreadable()).toBe(true);
    const shown = await repos.toolkit.get();
    await expect(repos.toolkit.save({ ...shown, targetAirline: "Default edit" })).rejects.toThrow(
      TOOLKIT_UNREADABLE_MESSAGE,
    );
    const rows = await db.select<{ state_json: string }>("SELECT state_json FROM pilot_toolkit");
    expect(rows).toEqual([{ state_json: raw }]);
  });

  it("saves normally when no toolkit row exists yet", async () => {
    expect(await repos.toolkit.isUnreadable()).toBe(false);
    await repos.toolkit.save({ ...(await repos.toolkit.get()), targetAirline: "First" });
    expect(await repos.toolkit.isUnreadable()).toBe(false);
    expect((await repos.toolkit.get()).targetAirline).toBe("First");
  });

  it("clears personal toolkit data back to safe defaults", async () => {
    await repos.toolkit.save({ ...DEFAULT_TOOLKIT_STATE, careerSummary: "Private note" });
    await repos.toolkit.clear();
    expect((await repos.toolkit.get()).careerSummary).toBe("");
  });

  it("creates a shared tag safely when document imports overlap", async () => {
    await Promise.all([
      repos.documents.create({ title: "One", tags: ["Shared"] }),
      repos.documents.create({ title: "Two", tags: ["Shared"] }),
    ]);
    expect(await repos.documents.listTags()).toEqual(["Shared"]);
  });

  it("keeps a Gemini study aid tied to its source material", async () => {
    const source = await repos.documents.create({ title: "Weather chapter" });
    await repos.documents.saveAiStudySet({
      sourceMaterialId: source.id,
      title: "Weather study guide",
      summary: "A source-based summary.",
      sections: [{ heading: "Clouds", body: "Review the source." }],
      flashcards: [{ front: "What is a cloud?", back: "Check the source definition.", sourcePage: 4 }],
      sourceNotes: "Verify current guidance.",
      model: "gemini-2.5-flash",
    });

    const saved = (await repos.documents.listAiStudySets())[0];
    expect(saved?.sourceMaterialId).toBe(source.id);
    expect(saved?.flashcards[0]?.sourcePage).toBe(4);

    await repos.documents.remove(source.id);
    expect(await repos.documents.listAiStudySets()).toEqual([]);
  });
});
