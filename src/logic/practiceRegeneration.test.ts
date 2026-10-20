import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { practiceRetirementRecord } from "@/data/practiceAuthoring";
import type { PracticeAuthoringQuestion, PracticeRetirementRecord, PracticeSnapshot } from "@/domain/types";
import { buildPracticeRegenerationOperation, mergePracticeRegeneration, needsPracticeRegenerationReview, practiceRegenerationPreview, resolvePracticeRegeneration } from "./practiceRegeneration";

let db: TestDatabase;
let repos: ReturnType<typeof createRepositories>;
const uid = () => crypto.randomUUID();
const question = (over: Partial<PracticeAuthoringQuestion> = {}): PracticeAuthoringQuestion => ({
  identity: uid(), question: "Synthetic stem", options: ["First", "Second"], correctIndex: 0, explanation: "Synthetic explanation", sourcePage: null, ...over,
});
const answer = { title: "Regenerated test", model: "synthetic", sourceMaterialId: "mat", questions: [question({ question: "Entirely fresh candidate about navigation" })] };
const snapshot = async () => (await repos.documents.readPracticeSnapshot("mat"))!;
async function seed(questions = [question({ origin: "user" })], retired: PracticeRetirementRecord[] = [], provider: "manual" | "gemini" = "manual") {
  await repos.documents.savePracticeAuthoring({ operationId: uid(), sourceMaterialId: "mat", reason: "create", expected: null,
    next: { title: "Current test", provider, model: "", questions, retired: [] } });
  if (retired.length) {
    const expected = await snapshot();
    await repos.documents.savePracticeAuthoring({ operationId: uid(), sourceMaterialId: "mat", reason: "regenerate", expected,
      next: { title: expected.title, provider, model: "", questions, retired } });
  }
  return snapshot();
}
async function saveMerge(current: PracticeSnapshot, resolved: PracticeAuthoringQuestion[], mode: "keep" | "replace") {
  const merged = await mergePracticeRegeneration(current, resolved, mode);
  const operation = buildPracticeRegenerationOperation(uid(), current, merged, answer);
  expect(await repos.documents.savePracticeAuthoring(operation)).toEqual({ status: "saved" });
  return snapshot();
}
beforeEach(async () => {
  db = await createNodeSqliteDatabase(); repos = createRepositories(db);
  await repos.documents.create({ id: "mat", title: "Synthetic material" });
});
afterEach(() => db.close());

describe("practice regeneration through the real SQLite transaction", () => {
  it("requires review exactly for manual content, origins or retirements", async () => {
    const current = await seed([question()], [], "gemini");
    expect(needsPracticeRegenerationReview(null)).toBe(false);
    expect(needsPracticeRegenerationReview(current)).toBe(false);
    expect(needsPracticeRegenerationReview({ ...current, provider: "manual" })).toBe(true);
    for (const origin of ["user", "instructor"] as const) {
      expect(needsPracticeRegenerationReview({ ...current, questions: [question({ origin })] })).toBe(true);
    }
    expect(needsPracticeRegenerationReview({ ...current, retired: [await practiceRetirementRecord(question(), "deleted")] })).toBe(true);
  });
  it("holds an exact deleted repeat, assigns fresh ids without origin, and saves its omission", async () => {
    const deleted = question({ origin: "user" });
    const current = await seed([question({ question: "A different current question", origin: "user" })], [await practiceRetirementRecord(deleted, "deleted")]);
    const preview = await practiceRegenerationPreview(current, [deleted]);
    expect(preview[0]).toMatchObject({ status: "held", match: current.retired[0] });
    expect(preview[0]!.item.identity).not.toBe(deleted.identity);
    expect(preview[0]!.item.origin).toBeUndefined();
    const saved = await saveMerge(current, resolvePracticeRegeneration(preview, new Map()), "keep");
    expect(saved.questions).toEqual(current.questions);
  });
  it("classifies term Jaccard above, at and below 0.6 and requires a near choice", async () => {
    // Empty option/explanation terms leave the stem plus answer:0 = answer and 0.
    const retiredQuestion = question({ question: "alpha beta gamma", options: ["!", "?"], explanation: "" });
    const current = await seed(undefined, [await practiceRetirementRecord(retiredQuestion, "deleted")]);
    const candidates = ["alpha beta gamma delta", "alpha beta delta", "alpha beta delta epsilon"].map((stem) => question({ ...retiredQuestion, question: stem }));
    const preview = await practiceRegenerationPreview(current, candidates);
    expect(preview.map((p) => p.status)).toEqual(["near", "near", "new"]); // 5/6, 4/6, 4/7
    // Exactly .6: shared {alpha,answer,0}, union adds beta and gamma.
    const boundary = await practiceRegenerationPreview(current, [question({ ...retiredQuestion, question: "alpha" })]);
    expect(boundary[0]!.status).toBe("near");
    expect(() => resolvePracticeRegeneration(preview, new Map())).toThrow(/Choose/);
    await saveMerge(current, resolvePracticeRegeneration(preview, new Map(preview.filter((p) => p.status === "near").map((p) => [p.item.identity, "keep" as const]))), "keep");
  });
  it("keeps user and instructor questions verbatim after new questions", async () => {
    const current = await seed([question({ origin: "user" }), question({ question: "Instructor stem", origin: "instructor" }), question()]);
    const preview = await practiceRegenerationPreview(current, answer.questions);
    const saved = await saveMerge(current, resolvePracticeRegeneration(preview, new Map()), "keep");
    expect(saved.questions.slice(1)).toEqual(current.questions.slice(0, 2));
    expect(saved.questions[0]!.origin).toBeUndefined();
  });
  it("replace retires each dropped origin-bearing question as deleted", async () => {
    const current = await seed([question({ origin: "user" }), question({ origin: "instructor" }), question()]);
    const saved = await saveMerge(current, [question({ question: "Fresh generated wording" })], "replace");
    expect(saved.questions).toHaveLength(1);
    expect(saved.retired).toEqual(await Promise.all(current.questions.slice(0, 2).map((q) => practiceRetirementRecord(q, "deleted"))));
  });
  it("explicitly bringing back a held question saves it and retains its record", async () => {
    const old = question();
    const current = await seed(undefined, [await practiceRetirementRecord(old, "deleted")]);
    const preview = await practiceRegenerationPreview(current, [old]);
    const saved = await saveMerge(current, resolvePracticeRegeneration(preview, new Map([[preview[0]!.item.identity, "keep"]])), "keep");
    expect(saved.questions[0]!.question).toBe(old.question);
    expect(saved.retired).toEqual(current.retired);
  });
  it("2,000 retirement overflow refuses without writes and leaves caller choices intact", async () => {
    const base = await practiceRetirementRecord(question({ question: "Earlier deleted" }), "deleted");
    const current = await seed(undefined, Array.from({ length: 2000 }, () => ({ ...base, itemId: uid() })));
    const preview = await practiceRegenerationPreview(current, answer.questions);
    const choices = new Map([[preview[0]!.item.identity, "keep" as const]]);
    const resolved = resolvePracticeRegeneration(preview, choices);
    const before = await db.select("SELECT * FROM practice_save_operations");
    await expect(mergePracticeRegeneration(current, resolved, "replace")).rejects.toMatchObject({ code: "RETIREMENT_LIMIT" });
    const overflow = buildPracticeRegenerationOperation(uid(), current, {
      questions: resolved, retired: [...current.retired, await practiceRetirementRecord(current.questions[0]!, "deleted")],
    }, answer);
    await expect(repos.documents.savePracticeAuthoring(overflow)).rejects.toMatchObject({ code: "RETIREMENT_LIMIT" });
    expect(await snapshot()).toEqual(current);
    expect(await db.select("SELECT * FROM practice_save_operations")).toEqual(before);
    expect(choices.get(preview[0]!.item.identity)).toBe("keep");
    expect(resolved).toEqual([preview[0]!.item]);
  });
});
