import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PracticeAuthoringQuestion, PracticeSnapshot } from "@/domain/types";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { readCurrentSnapshot } from "./practiceAuthoring";
import { buildPracticeEditOperation, draftFromSnapshot, type PracticeDraftQuestion } from "./practiceAuthoringDraft";

let db: TestDatabase;
const question = (origin?: "user" | "instructor"): PracticeAuthoringQuestion => ({
  identity: crypto.randomUUID(), question: "Synthetic question", options: ["One", "Two"],
  correctIndex: 0, explanation: "Why", sourcePage: null, ...(origin ? { origin } : {}),
});
const read = () => readCurrentSnapshot((sql, params) => db.select(sql, params), "mat");
async function seed(origins: ("user" | "instructor" | undefined)[]) {
  await db.savePracticeAuthoringAtomically!({
    operationId: crypto.randomUUID(), sourceMaterialId: "mat", reason: "create", expected: null,
    next: { title: "Test", provider: "gemini", model: "synthetic", questions: origins.map(question), retired: [] },
  });
  return (await read())!;
}
async function save(expected: PracticeSnapshot | null, draft: PracticeDraftQuestion[]) {
  const operation = await buildPracticeEditOperation({ operationId: crypto.randomUUID(), materialId: "mat", expected, title: "Test", draft });
  expect(await db.savePracticeAuthoringAtomically!(operation)).toEqual({ status: "saved" });
  return { operation, snapshot: (await read())! };
}
beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat', 'Synthetic', '2026-10-20', '2026-10-20')");
});
afterEach(() => db.close());

describe("practice draft operations accepted by the real transaction", () => {
  it("creates user and instructor questions", async () => {
    const draft = [question("user"), question("instructor")].map((q) => ({ ...q, identity: null, instructor: q.origin === "instructor" }));
    const { operation, snapshot } = await save(null, draft);
    expect(operation.reason).toBe("create");
    expect(snapshot).toMatchObject({ provider: "manual", model: "", retired: [] });
    expect(snapshot.questions.map((q) => q.origin)).toEqual(["user", "instructor"]);
  });
  it.each(["user", undefined] as const)("edits %s wording and retires its exact earlier wording", async (origin) => {
    const before = await seed([origin]);
    const draft = draftFromSnapshot(before);
    draft[0]!.question = "Changed wording";
    const { snapshot } = await save(before, draft);
    expect(snapshot.questions[0]!.origin).toBe("user");
    expect(snapshot.retired).toMatchObject([{ itemId: before.questions[0]!.identity, reason: "corrected" }]);
    expect(snapshot).toMatchObject({ provider: "gemini", model: "synthetic" });
  });
  it.each(["user", undefined] as const)("deletes %s with the required retirement", async (origin) => {
    const before = await seed([origin, undefined]);
    const { snapshot } = await save(before, draftFromSnapshot(before).slice(1));
    expect(snapshot.retired).toMatchObject([{ itemId: before.questions[0]!.identity, reason: "deleted" }]);
    expect(snapshot.questions[0]!.origin).toBeUndefined();
  });
  it("marks her question as an instructor correction", async () => {
    const before = await seed(["user"]);
    const draft = draftFromSnapshot(before);
    draft[0]!.instructor = true;
    const { operation, snapshot } = await save(before, draft);
    expect(operation.reason).toBe("correct");
    expect(snapshot.questions[0]!.origin).toBe("instructor");
    expect(snapshot.retired[0]!.reason).toBe("corrected");
  });
  it("keeps instructor provenance even if the draft unchecks it", async () => {
    const before = await seed(["instructor"]);
    const draft = draftFromSnapshot(before);
    draft[0]!.instructor = false;
    draft[0]!.question = "Changed correction";
    const { operation, snapshot } = await save(before, draft);
    expect(operation.reason).toBe("correct");
    expect(snapshot.questions[0]!.origin).toBe("instructor");
    expect(snapshot.retired[0]!.reason).toBe("corrected");
  });
  it("accepts no change and another no-op using the resulting snapshot", async () => {
    const before = await seed([undefined, "user", "instructor"]);
    const first = await save(before, draftFromSnapshot(before));
    const second = await save(first.snapshot, draftFromSnapshot(first.snapshot));
    expect(second.snapshot.questions).toEqual(before.questions);
    expect(second.snapshot.retired).toEqual([]);
    expect(await db.savePracticeAuthoringAtomically!(first.operation)).toEqual({ status: "already_saved" });
  });
  it("adds beside generated questions without promoting the unchanged ones", async () => {
    const before = await seed([undefined]);
    const extra = { ...question(), identity: null, instructor: false };
    const { snapshot } = await save(before, [...draftFromSnapshot(before), extra]);
    expect(snapshot.questions[0]).toEqual(before.questions[0]);
    expect(snapshot.questions[1]!.origin).toBe("user");
    expect(snapshot.retired).toEqual([]);
  });
});

it("changes and clears only the task without retiring or rewriting generated content", async () => {
  const before = await seed([undefined]);
  const draft = draftFromSnapshot(before);
  draft[0]!.acsTask = "PA.II.A";
  const tagged = await save(before, draft);
  expect(tagged.snapshot.questions[0]!.acsTask).toBe("PA.II.A");
  expect(tagged.snapshot.questions[0]!.origin).toBeUndefined();
  expect(tagged.snapshot.retired).toEqual([]);
  const clear = draftFromSnapshot(tagged.snapshot);
  clear[0]!.acsTask = null;
  const after = await save(tagged.snapshot, clear);
  expect(after.snapshot.questions[0]!.acsTask).toBeUndefined();
  expect(after.snapshot.questions[0]!.identity).toBe(before.questions[0]!.identity);
  expect(after.snapshot.retired).toEqual([]);
});

it("validates task metadata and permits an older backup without the table", async () => {
  const { validatePracticeAcsTasks } = await import("./practiceStateValidation");
  const query = (sql: string, params: import("./db").SqlValue[]) => db.select<Record<string, unknown>>(sql, params);
  const before = await seed([undefined]);
  const draft = draftFromSnapshot(before); draft[0]!.acsTask = "PA.II.A";
  await save(before, draft);
  await validatePracticeAcsTasks(query, query, true);
  await db.execute("UPDATE practice_item_acs_tasks SET acs_task='PA.II.Z'");
  await expect(validatePracticeAcsTasks(query, query)).rejects.toThrow("Damaged practice ACS task.");
  await db.execute("DROP TABLE practice_item_acs_tasks");
  await validatePracticeAcsTasks(query, query);
  await expect(validatePracticeAcsTasks(query, query, true)).rejects.toThrow("Missing practice ACS task table.");
});
