/** GEN-03: synthetic kits through real authoring, export, sql.js import and restart. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createRepositories } from "./repositories";
import { kitItemEvidence, kitQuestionSeed, kitReviewItems, kitSources } from "./pdfStudyKitDraft";
import { bindPdfQuestions, buildPracticeEditOperation, draftFromSnapshot, draftWithPdfQuestions } from "./practiceAuthoringDraft";
import { exportStudyPacket, type ExportSelection, type ExportSource } from "@/logic/studyExport";
import { validatePacketText } from "@/logic/studyPacket";
import { normalizeBlock, normalizeLine } from "@/logic/studyPacket/schema";
import { formatStudyContentProvenance } from "@/logic/studyContentProvenance";
import { buildImportOperation } from "@/services/studyPackets";
import type { PdfStudyKitDraft } from "@/services/documents";
import type { SqlDatabase, StructuredImportSaveOperation } from "./db";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
const fixture: StructuredImportSaveOperation = JSON.parse(readFileSync(new URL("../../src-tauri/fixtures/import-contract/gen03-operation.json", import.meta.url), "utf8"));
const ALL = { guide: true, flashcards: true, questions: true };
const NOW = "2026-10-20T12:00:00.000Z";
const evidence = { page: 1, startOffset: 0, endOffset: 20, quote: "Lift: A source line." };
const journal: PdfStudyKitDraft = {
  kind: "pdf-kit", version: 1, runId: "45678901-2345-4567-8901-234567890123", editorOperationId: "45678901-2345-4567-8901-234567890124", createdAt: NOW, reviewState: "review-required",
  identity: { materialId: "synthetic-kit", contentSha256: "a".repeat(64), selectedPages: [1], pageCount: 1, algorithmVersion: 1, extractorVersion: 1 },
  candidates: { glossary: [{ prompt: "Define lift", answer: "A source line.", sourcePage: 1, evidence: [evidence] }], cloze: [],
    outline: [{ heading: "Lift", sourcePage: 1, sentences: [{ text: evidence.quote }], evidence: [evidence] }],
    questions: [{ prompt: "Define lift", answer: "A source line.", choices: ["A source line.", "Another line."], correctIndex: 0, sourcePage: 1, evidence: [evidence], choiceEvidence: [[evidence], [evidence]] }] },
};
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function source(db: SqlDatabase, pdf = true): Promise<ExportSource> {
  const docs = createRepositories(db).documents;
  const materialId = journal.identity.materialId;
  await docs.create({ id: materialId, title: "Synthetic PDF kit" });
  const items = kitReviewItems(journal);
  const sections = items.filter(i => i.kind === "section").map(i => ({ itemId: i.id, heading: i.fields[0]!, body: i.fields[1]! }));
  const flashcards = items.filter(i => i.kind === "card").map(i => ({ itemId: i.id, front: i.fields[0]!, back: i.fields[1]!, sourcePage: 1 }));
  const summary = "A synthetic kit summary.";
  const pdfKitSources = pdf ? await kitSources(journal, [
    { kind: "summary", id: `summary:${journal.runId}`, content: summary, evidence: [evidence] },
    ...items.map(i => ({ kind: i.kind, id: i.id, content: (i.kind === "section" ? sections : flashcards).find(x => x.itemId === i.id)!, evidence: kitItemEvidence(journal, i) })),
  ]) : undefined;
  await docs.saveStudySet({ operationId: journal.editorOperationId, materialId, reason: "create", expected: null,
    next: { title: "Synthetic PDF kit", summary, summaryOrigin: null, sections, flashcards, sourceNotes: "Synthetic source notes.", provider: "manual", model: "", retired: [] }, ...(pdfKitSources ? { pdfKitSources } : {}) });
  const seed = kitQuestionSeed(journal);
  const draft = draftWithPdfQuestions(null, seed);
  const op = await buildPracticeEditOperation({ operationId: journal.runId, materialId, expected: null, title: "Synthetic PDF kit", draft });
  await docs.savePracticeAuthoring(pdf ? await bindPdfQuestions(op, draft, seed) : op);
  if (!pdf) {
    const current = (await docs.readPracticeSnapshot(materialId))!;
    const edited = draftFromSnapshot(current); edited[0]!.question = "My edited lift question?";
    await docs.savePracticeAuthoring(await buildPracticeEditOperation({ operationId: crypto.randomUUID(), materialId, expected: current, title: current.title, draft: edited }));
  }
  return { material: { title: "Synthetic PDF kit" }, studySet: (await docs.listAiStudySets())[0]!, practiceTest: (await docs.listPracticeTests())[0]! };
}
async function operation(input: ExportSource, selection: ExportSelection = ALL, id: string = crypto.randomUUID()) {
  const exported = exportStudyPacket(input, selection, new Date(NOW));
  if (!exported.ok) throw new Error(exported.message);
  const result = validatePacketText(exported.text);
  if (!result.ok) throw new Error("Export did not validate");
  return { op: await buildImportOperation(result.payload, id), exported };
}
async function assertReopened(input: ExportSource, op: StructuredImportSaveOperation, selection = ALL) {
  const docs = createRepositories(await createSqlJsDatabase()).documents;
  const material = (await docs.list()).find(m => m.id === op.materialId)!;
  expect(material.filePath).toBeNull();
  const set = (await docs.listAiStudySets()).find(s => s.sourceMaterialId === op.materialId);
  if (selection.guide || selection.flashcards) {
    expect(set).toMatchObject({ provider: "import", model: "", summary: selection.guide ? normalizeBlock(input.studySet!.summary) : "",
      sections: selection.guide ? input.studySet!.sections.map(s => ({ heading: normalizeLine(s.heading), body: normalizeBlock(s.body) })) : [],
      flashcards: selection.flashcards ? input.studySet!.flashcards.map(c => ({ front: normalizeBlock(c.front), back: normalizeBlock(c.back), sourcePage: null })) : [],
      sourceNotes: selection.guide ? normalizeBlock(input.studySet!.sourceNotes) : "" });
    expect(formatStudyContentProvenance(material.title, set).originLabel).toBe("Imported study packet");
  } else expect(set).toBeUndefined();
  const test = (await docs.listPracticeTests()).find(t => t.sourceMaterialId === op.materialId);
  if (selection.questions) {
    expect(test).toMatchObject({ provider: "import", model: "", questions: input.practiceTest!.questions.map(q => ({ question: normalizeBlock(q.question), options: q.options.map(normalizeLine), correctIndex: q.correctIndex, explanation: normalizeBlock(q.explanation), sourcePage: null })) });
    expect(test!.questions.every(q => q.origin === undefined && q.pdfProvenance === undefined)).toBe(true);
    expect(formatStudyContentProvenance(material.title, test).originLabel).toBe("Imported study packet");
  } else expect(test).toBeUndefined();
}
it.each([true, false])("all_three_parts_export_import_reopen_match (PDF kit: %s)", async pdf => {
  const db = await createSqlJsDatabase(); const input = await source(db, pdf);
  const { op, exported } = await operation(input, ALL, fixture.materialId);
  expect(exported.counts).toEqual({ sections: 1, flashcards: 1, questions: 1 });
  expect(op).toEqual(pdf ? fixture : JSON.parse(readFileSync(new URL("../../src-tauri/fixtures/import-contract/gen03-handwritten-operation.json", import.meta.url), "utf8"))); // Shared native fixture is produced by the actual exporter.
  await createRepositories(db).documents.importStudyPacket(op);
  await assertReopened(input, op);
});
it.each(["guide", "flashcards", "questions"] as const)("guide_only_cards_only_test_only_roundtrip (%s)", async part => {
  const db = await createSqlJsDatabase(); const input = await source(db, false);
  const selection = { guide: part === "guide", flashcards: part === "flashcards", questions: part === "questions" };
  const { op } = await operation(input, selection);
  await createRepositories(db).documents.importStudyPacket(op); await assertReopened(input, op, selection);
});
it("pdf_kit_packet_labels_no_ai_claim", async () => {
  const input = await source(await createSqlJsDatabase());
  for (const selection of [ALL, { guide: false, flashcards: true, questions: false }, { guide: false, flashcards: false, questions: true }]) {
    const { exported } = await operation(input, selection); const packet = JSON.parse(exported.text);
    expect(packet.source.note).toContain("Pulled from a PDF on the sender's Mac");
    expect(exported.text).not.toMatch(/on this Mac|AI-generated|verified|Edited by you/);
    expect(packet.flashcards?.[0]?.back ?? "A source line.").toBe("A source line.");
    expect(packet.questions?.[0]?.explanation ?? "A source line.").toBe("A source line.");
  }
});
it("receiver_without_pdf_has_no_false_links", async () => {
  const db = await createSqlJsDatabase(); const input = await source(db); const { op } = await operation(input);
  await createRepositories(db).documents.create({ id: "unrelated", title: "Receiver's own PDF", filePath: "documents/synthetic.pdf" });
  await createRepositories(db).documents.importStudyPacket(op); await assertReopened(input, op);
  expect(op.studySet!.flashcards[0]!.sourcePage).toBeNull(); expect(op.practiceTest!.questions[0]!.sourcePage).toBeNull();
});
it("import_commit_ack_crash_idempotent", async () => {
  const db = await createSqlJsDatabase(); const input = await source(db); const { op } = await operation(input);
  // Drop the acknowledgement, then restart from durable storage and replay the same operation.
  await createRepositories(db).documents.importStudyPacket(op);
  const reopened = await createSqlJsDatabase();
  const before = await reopened.select("SELECT * FROM practice_test_versions");
  expect(await createRepositories(reopened).documents.importStudyPacket(op)).toEqual({ status: "already_saved", materialId: op.materialId });
  expect(await reopened.select("SELECT * FROM practice_test_versions")).toEqual(before);
  await assertReopened(input, op);
});
it("import_midwrite_failure_rolls_back_every_part", async () => {
  const db = await createSqlJsDatabase(); const input = await source(db); const { op } = await operation(input);
  await db.execute("CREATE TRIGGER gen03_failure BEFORE INSERT ON practice_test_items BEGIN SELECT RAISE(ABORT, 'synthetic'); END");
  const before = [...stored.entries()];
  await expect(createRepositories(db).documents.importStudyPacket(op)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect([...stored.entries()]).toEqual(before);
  for (const table of ["study_materials", "ai_study_sets", "practice_tests", "practice_test_versions"]) {
    const column = table === "study_materials" ? "id" : "source_material_id";
    expect(await db.select(`SELECT * FROM ${table} WHERE ${column} = ?`, [op.materialId])).toEqual([]);
  }
  await db.execute("DROP TRIGGER gen03_failure");
  expect((await createRepositories(db).documents.importStudyPacket(op)).status).toBe("saved");
  await assertReopened(input, op);
});
it("oversize_credentials_rejected", async () => {
  const db = await createSqlJsDatabase(); const input = await source(db); const { exported } = await operation(input);
  const before = [...stored.entries()];
  for (const text of [" ".repeat(4 * 1024 * 1024 + 1), exported.text.replace("A synthetic kit summary.", `AIza${"A".repeat(35)}`), "{invalid"]) {
    expect(validatePacketText(text).ok).toBe(false);
    expect([...stored.entries()]).toEqual(before);
  }
});
it("03b_versions_attempts_unchanged_on_import", async () => {
  const db = await createSqlJsDatabase(); const input = await source(db, false); const repos = createRepositories(db);
  const active = (await repos.practiceSessions.getActiveVersion(journal.identity.materialId))!;
  await repos.practiceSessions.saveSessionAction({ action: "start_or_resume", operationId: crypto.randomUUID(), materialId: journal.identity.materialId, versionId: active.version.id });
  const tables = ["practice_test_versions", "practice_test_items", "practice_attempts", "practice_responses", "practice_item_origins"];
  const before = await Promise.all(tables.map(t => db.select(`SELECT * FROM ${t} ORDER BY rowid`)));
  expect(before[0]).toHaveLength(2); expect(before[2]).toHaveLength(1);
  const { op } = await operation(input); await repos.documents.importStudyPacket(op);
  const after = await Promise.all(tables.map(t => db.select(`SELECT * FROM ${t} ORDER BY rowid`)));
  for (let i = 0; i < tables.length; i++) for (const row of before[i]!) expect(after[i]).toContainEqual(row);
  expect(after[2]).toEqual(before[2]); expect(after[3]).toEqual(before[3]); expect(after[4]).toEqual(before[4]);
  await assertReopened(input, op);
});
it("instructor_content_excluded_by_default", async () => {
  const input = await source(await createSqlJsDatabase(), false);
  input.studySet!.summaryOrigin = "instructor";
  input.studySet!.sections[0]!.origin = "instructor";
  input.practiceTest!.questions.push({ ...input.practiceTest!.questions[0]!, question: "Private correction?", origin: "instructor" });
  const { exported, op } = await operation(input);
  expect(op.studySet!.summary).toBe(""); expect(op.studySet!.sections).toEqual([]);
  expect(exported.text).not.toContain("Private correction"); expect(exported.counts.questions).toBe(1);
  const included = await operation(input, { ...ALL, instructorCorrections: true });
  expect(included.exported.counts.questions).toBe(2); expect(included.op.studySet!.summary).toBe(input.studySet!.summary);
});
