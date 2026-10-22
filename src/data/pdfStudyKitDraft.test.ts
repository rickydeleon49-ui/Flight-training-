import { beforeEach, afterEach, expect, it } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { createRepositories } from "./repositories";
import { kitQuestionSeed, kitReviewItems, kitItemEvidence, kitSources, kitEditOrigin } from "./pdfStudyKitDraft";
import { buildPracticeEditOperation, bindPdfQuestions, draftWithPdfQuestions } from "./practiceAuthoringDraft";
import { buildHandoutHtml } from "@/logic/studyHandout";
import { exportStudyPacket } from "@/logic/studyExport";
import type { PdfStudyKitDraft } from "@/services/documents";
let db: TestDatabase;
let repos: ReturnType<typeof createRepositories>;
const evidence = { page: 1, startOffset: 0, endOffset: 20, quote: "Lift: A source line." };
const journal: PdfStudyKitDraft = { kind: "pdf-kit", version: 1, runId: "45678901-2345-4567-8901-234567890123", editorOperationId: "45678901-2345-4567-8901-234567890124", createdAt: "2026-10-20T12:00:00.000Z", reviewState: "review-required", identity: { materialId: "synthetic-kit", contentSha256: "a".repeat(64), selectedPages: [1], pageCount: 1, algorithmVersion: 1, extractorVersion: 1 }, candidates: { glossary: [{ prompt: "Define lift", answer: "A source line.", sourcePage: 1, evidence: [evidence] }], cloze: [], outline: [], questions: [{ prompt: "Define lift", answer: "A source line.", choices: ["A source line.", "Another line."], correctIndex: 0, sourcePage: 1, evidence: [evidence], choiceEvidence: [[evidence], [evidence]] }] } };
beforeEach(async () => { db = await createNodeSqliteDatabase(); repos = createRepositories(db); await repos.documents.create({ id: journal.identity.materialId, title: "Synthetic PDF" }); });
afterEach(() => db.close());
it("saves kept edited kit cards with real receipts, final hashes and both origins", async () => {
  const item = kitReviewItems(journal)[0]!; item.fields[1] = "My final edit"; const card = { itemId: item.id, front: item.fields[0]!, back: item.fields[1]!, sourcePage: 1, origin: kitEditOrigin(journal, item) };
  const pdfKitSources = await kitSources(journal, [{ kind: "card", id: item.id, content: card, evidence: kitItemEvidence(journal, item) }]);
  const operation = { operationId: journal.editorOperationId, materialId: journal.identity.materialId, reason: "create" as const, expected: null, next: { title: "Kit", summary: "", summaryOrigin: null, sections: [], flashcards: [card], sourceNotes: "", provider: "manual" as const, model: "", retired: [] }, pdfKitSources };
  expect(await repos.documents.saveStudySet(operation)).toEqual({ status: "saved" }); expect(await repos.documents.saveStudySet(operation)).toEqual({ status: "already_saved" });
  const set = (await repos.documents.listAiStudySets())[0]!; expect(set.flashcards[0]?.pdfProvenance?.status).toBe("valid"); expect(set.flashcards[0]?.origin).toBe("user"); expect(set.summaryPdfProvenance).toBeUndefined();
  const html = buildHandoutHtml({ material: { title: "Synthetic" }, studySet: set, practiceTest: null }, { guide: false, flashcards: true, questions: false }, { answerKey: false }, new Date(journal.createdAt)); expect(html).toContain("Pulled from your PDF on this Mac"); expect(html).toContain("Edited by you"); expect(html).not.toMatch(/AI-generated|written by hand|verified/);
  const exported = exportStudyPacket({ material: { title: "Synthetic" }, studySet: set, practiceTest: null }, { guide: false, flashcards: true, questions: false }, new Date(journal.createdAt)); expect(exported.ok).toBe(true); if (exported.ok) { expect(exported.text).toContain("Pulled from a PDF on the sender's Mac"); expect(exported.text).not.toContain("Edited by you"); expect(exported.text).not.toMatch(/AI-generated|written by hand|verified/); }
});
it("hydrates valid unsaved question identities through 03b and reads PDF labels in attempts and history", async () => {
  const seed = kitQuestionSeed(journal); const draft = draftWithPdfQuestions(null, seed);
  const operation = await bindPdfQuestions(await buildPracticeEditOperation({ operationId: journal.runId, materialId: journal.identity.materialId, expected: null, title: "Kit questions", draft }), draft, seed);
  expect(operation.next!.questions[0]?.origin).toBeUndefined(); expect(await repos.documents.readPracticeSnapshot(journal.identity.materialId)).toBeNull();
  await repos.documents.savePracticeAuthoring(operation); const current = (await repos.documents.readPracticeSnapshot(journal.identity.materialId))!;
  expect(draftWithPdfQuestions(current, seed)).toHaveLength(1);
  const active = (await repos.practiceSessions.getActiveVersion(journal.identity.materialId))!; expect(active.items[0]?.pdfProvenance?.status).toBe("valid");
  const questions = (await repos.documents.listPracticeTests())[0]!.questions; expect(questions[0]?.pdfProvenance?.label).toBe("Pulled from your PDF on this Mac");
  const edit = draftWithPdfQuestions(current, seed); edit[0]!.question = "My corrected wording"; edit[0]!.instructor = true;
  const correction = await bindPdfQuestions(await buildPracticeEditOperation({ operationId: crypto.randomUUID(), materialId: journal.identity.materialId, expected: current, title: current.title, draft: edit }), edit, seed); await repos.documents.savePracticeAuthoring(correction);
  const saved = (await repos.documents.listPracticeTests())[0]!; expect(saved.questions[0]?.origin).toBe("instructor"); expect(saved.questions[0]?.pdfProvenance?.status).toBe("valid");
  expect((await repos.practiceSessions.getItems(active.version.id))[0]?.pdfProvenance?.status).toBe("valid");
});
it("kitReviewItems collapses whitespace runs in section headings and text without touching evidence quotes", () => {
  const d: PdfStudyKitDraft = {
    ...journal,
    candidates: {
      ...journal.candidates,
      outline: [
        {
          heading: "Detailed   discussion   of   aerodynamics",
          sourcePage: 1,
          sentences: [
            { text: "Lift   is   the   force   that  directly   opposes   weight." },
            { text: "Airfoils   generate   lift   through   pressure   differentials." },
          ],
          evidence: [{ page: 1, startOffset: 0, endOffset: 20, quote: "Raw   exact   quote." }],
        },
      ],
    },
  };
  const items = kitReviewItems(d);
  const section = items.find((i) => i.kind === "section")!;
  expect(section.fields[0]).toBe("Detailed discussion of aerodynamics");
  expect(section.fields[1]).toBe(
    "Lift is the force that directly opposes weight.\n\nAirfoils generate lift through pressure differentials.",
  );
  expect(kitItemEvidence(d, section)[0]!.quote).toBe("Raw   exact   quote.");
});
