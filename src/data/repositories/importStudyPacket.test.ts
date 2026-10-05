/**
 * Slice B repository behavior: strict refusal without an atomic driver,
 * provenance read back through the allowlist, and the desktop adapter's
 * allowlisted error mapping. Row IDs from the accepted preparation §5.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlDatabase, SqlValue, StructuredImportSaveOperation } from "@/data/db";
import {
  AtomicPersistenceUnsupportedError,
  IMPORT_SAVE_MESSAGES,
  StructuredImportSaveError,
} from "@/data/persistenceErrors";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { invokeStructuredImportSave } from "@/data/tauriDb";
import { createRepositories } from "./index";

vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));

const OPERATION: StructuredImportSaveOperation = JSON.parse(
  readFileSync(new URL("../../../src-tauri/fixtures/import-contract/operation.json", import.meta.url), "utf8"),
);

let db: TestDatabase;
beforeEach(async () => {
  db = await createNodeSqliteDatabase();
});
afterEach(() => db.close());

describe("importStudyPacket", () => {
  it("TB-REFUSE-01: refuses without an atomic driver and never falls back to separate writes", async () => {
    const execute = vi.fn(async () => {});
    const saveMaterialAtomically = vi.fn();
    const saveMaterialsAtomically = vi.fn();
    const noAtomicImport: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute,
      saveMaterialAtomically,
      saveMaterialsAtomically,
    };
    await expect(createRepositories(noAtomicImport).documents.importStudyPacket(OPERATION)).rejects.toBeInstanceOf(
      AtomicPersistenceUnsupportedError,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(saveMaterialAtomically).not.toHaveBeenCalled();
    expect(saveMaterialsAtomically).not.toHaveBeenCalled();
    expect(await db.select("SELECT id FROM study_materials")).toEqual([]);
  });

  it("TB-PROV-01: an import reads back with provider 'import' and an empty model", async () => {
    const documents = createRepositories(db).documents;
    expect(await documents.importStudyPacket(OPERATION)).toEqual({ status: "saved", materialId: OPERATION.materialId });
    const [material] = await documents.list();
    expect(material).toMatchObject({
      id: OPERATION.materialId,
      title: "Letters and labels",
      materialType: "study_guide",
      topic: "general",
      reviewStatus: "needs_review",
      priority: "later",
      notes: "",
      filePath: null,
    });
    const [set] = await documents.listAiStudySets();
    expect(set).toMatchObject({
      sourceMaterialId: OPERATION.materialId,
      provider: "import",
      model: "",
      summary: OPERATION.studySet!.summary,
      sections: [],
      flashcards: OPERATION.studySet!.flashcards,
      sourceNotes: "",
    });
    const [test] = await documents.listPracticeTests();
    expect(test).toMatchObject({
      sourceMaterialId: OPERATION.materialId,
      provider: "import",
      model: "",
      questions: OPERATION.practiceTest!.questions,
    });
  });

  it("TB-PROV-02: legacy, unknown or malformed provider values read as 'gemini'", async () => {
    for (const [id, provider] of [
      ["m-unknown", "unknown"],
      ["m-blank", ""],
      ["m-case", "Import"],
      ["m-gemini", "gemini"],
    ]) {
      await db.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Synthetic', 't', 't')",
        [id!],
      );
      await db.execute(
        `INSERT INTO ai_study_sets (source_material_id, title, provider, model, generated_at, updated_at)
         VALUES (?, 'Synthetic', ?, 'gemini-2.5-flash', 't', 't')`,
        [id!, provider!],
      );
      await db.execute(
        `INSERT INTO practice_tests (source_material_id, title, provider, model, generated_at, updated_at)
         VALUES (?, 'Synthetic', ?, 'gemini-2.5-flash', 't', 't')`,
        [id!, provider!],
      );
    }
    const documents = createRepositories(db).documents;
    expect(new Set((await documents.listAiStudySets()).map((set) => set.provider))).toEqual(new Set(["gemini"]));
    expect(new Set((await documents.listPracticeTests()).map((test) => test.provider))).toEqual(new Set(["gemini"]));
  });

  it("regenerating imported content with Gemini relabels it as Gemini (provenance follows content)", async () => {
    const documents = createRepositories(db).documents;
    await documents.importStudyPacket(OPERATION);
    await documents.saveAiStudySet({
      sourceMaterialId: OPERATION.materialId,
      title: "Generated",
      summary: "Generated summary",
      sections: [],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-2.5-flash",
    });
    await documents.savePracticeTest({
      sourceMaterialId: OPERATION.materialId,
      title: "Generated",
      questions: [{ question: "Q?", options: ["A", "B"], correctIndex: 0, explanation: "E", sourcePage: 2 }],
      model: "gemini-2.5-flash",
    });
    expect((await documents.listAiStudySets())[0]).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash" });
    expect((await documents.listPracticeTests())[0]).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash" });
  });
});

describe("desktop adapter (invokeStructuredImportSave)", () => {
  it("sends the operation to the registered command and accepts its result", async () => {
    const call = vi.fn().mockResolvedValue({ status: "already_saved", materialId: OPERATION.materialId });
    expect(await invokeStructuredImportSave(OPERATION, call)).toEqual({
      status: "already_saved",
      materialId: OPERATION.materialId,
    });
    expect(call).toHaveBeenCalledWith("save_structured_study_material_atomically", { operation: OPERATION });
  });

  it("passes through exactly an allowlisted native refusal", async () => {
    const call = vi.fn().mockRejectedValue({ code: "IDEMPOTENCY_CONFLICT", message: IMPORT_SAVE_MESSAGES.IDEMPOTENCY_CONFLICT });
    const error = await invokeStructuredImportSave(OPERATION, call).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StructuredImportSaveError);
    expect(error).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", message: IMPORT_SAVE_MESSAGES.IDEMPOTENCY_CONFLICT });
  });

  it.each([
    ["a raw framework string", "invalid args `operation` for command: unknown field `apiKey_secret`"],
    ["an Error", new Error("IPC channel closed")],
    ["a known code with a different message", { code: "INVALID_ARGUMENT", message: "unknown field `apiKey_secret`" }],
    ["the transport code itself", { code: "IPC_TRANSPORT_ERROR", message: IMPORT_SAVE_MESSAGES.IPC_TRANSPORT_ERROR }],
    ["an unknown code", { code: "SOMETHING_ELSE", message: "x" }],
    ["null", null],
  ])("maps %s to IPC_TRANSPORT_ERROR without echoing it", async (_label, rejection) => {
    const call = vi.fn().mockRejectedValue(rejection);
    const error = await invokeStructuredImportSave(OPERATION, call).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "IPC_TRANSPORT_ERROR", message: IMPORT_SAVE_MESSAGES.IPC_TRANSPORT_ERROR });
    expect((error as Error).message).not.toContain("apiKey_secret");
  });

  it.each([
    ["a different material id", { status: "saved", materialId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e" }],
    ["an unknown status", { status: "done", materialId: OPERATION.materialId }],
    ["nothing", undefined],
  ])("refuses a result with %s", async (_label, result) => {
    const call = vi.fn().mockResolvedValue(result);
    await expect(invokeStructuredImportSave(OPERATION, call)).rejects.toMatchObject({ code: "IPC_TRANSPORT_ERROR" });
  });
});
