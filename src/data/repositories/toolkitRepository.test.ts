import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
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
