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
import { practiceRetirementRecord, readCurrentSnapshot } from "@/data/practiceAuthoring";
import { computeCanonicalHash } from "@/data/practiceSessionTransaction";
import { validatePracticeAuthoringState } from "@/data/practiceStateValidation";
import type { PracticeSaveOperation } from "@/domain/types";
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
    await documents.savePracticeTest({ provider: "gemini",
      sourceMaterialId: OPERATION.materialId,
      title: "Generated",
      questions: [{ question: "Q?", options: ["A", "B"], correctIndex: 0, explanation: "E", sourcePage: 2 }],
      model: "gemini-2.5-flash",
    });
    expect((await documents.listAiStudySets())[0]).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash" });
    expect((await documents.listPracticeTests())[0]).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash" });
  });

  /**
   * OFFLINE-03b r7 §4: the create-new packet path writes practice rows
   * outside the authoring API, so its output has to land inside the schema-17
   * contract anyway — plan §8 "Import parity". The native half of this test is
   * `study_packet_save_tests::imported_packet_satisfies_the_schema_17_authoring_contract`.
   */
  it("IP-17-01: an imported practice test keeps the empty ledger, the legacy hash, NULL authoring ids, validates at schema 17, and edits through the authoring API", async () => {
    const documents = createRepositories(db).documents;
    expect(await documents.importStudyPacket(OPERATION)).toEqual({
      status: "saved",
      materialId: OPERATION.materialId,
    });
    const query = (sql: string, params: SqlValue[] = []) => db.select(sql, params);
    const materialId = OPERATION.materialId;

    // The ledger defaults to empty and the mirror keeps the imported provenance.
    const [mirror] = await query("SELECT title, questions_json, provider, model, retired_json, legacy_migrated_at FROM practice_tests WHERE source_material_id = ?", [materialId]);
    expect(mirror!.retired_json).toBe("[]");
    expect(mirror!.provider).toBe("import");
    expect(mirror!.model).toBe("");
    expect(mirror!.legacy_migrated_at).not.toBeNull();
    expect(JSON.parse(String(mirror!.questions_json))).toEqual(OPERATION.practiceTest!.questions);

    // Every imported item keeps its legacy shape: no authoring identity yet, so
    // its own immutable row id is its deterministic identity.
    const imported = await query(
      `SELECT i.id, i.logical_id, i.replaces_id FROM practice_test_items i
         JOIN practice_test_versions v ON v.id = i.version_id
        WHERE v.source_material_id = ? AND v.is_active = 1 ORDER BY i.ordinal`,
      [materialId],
    );
    expect(imported).toHaveLength(OPERATION.practiceTest!.questions.length);
    for (const row of imported) {
      expect(row.logical_id).toBeNull();
      expect(row.replaces_id).toBeNull();
    }

    // The content hash is exactly today's five-field legacy hash.
    const [version] = await query(
      "SELECT content_hash, provider, model, version_number FROM practice_test_versions WHERE source_material_id = ? AND is_active = 1",
      [materialId],
    );
    expect(version!.content_hash).toBe(await computeCanonicalHash(OPERATION.practiceTest!.questions));
    expect(version!.provider).toBe("import");
    expect(version!.model).toBe("");
    expect(version!.version_number).toBe(1);

    // The schema-17 validator accepts what the importer wrote.
    const reference = await createNodeSqliteDatabase();
    try {
      await validatePracticeAuthoringState(query, (sql, params) => reference.select(sql, params));
    } finally {
      reference.close();
    }

    // An authoring edit of the imported test goes through: the snapshot's
    // fallback identities are the imported row ids and stay that way.
    const current = await readCurrentSnapshot(query, materialId);
    expect(current).not.toBeNull();
    expect(current!.questions.map((question) => question.identity)).toEqual(imported.map((row) => String(row.id)));
    const before = current!.questions[0]!;
    const rewritten = { ...before, question: before.question.replace("Plinth 1", "Plinth 10") };
    const saved = await db.savePracticeAuthoringAtomically!({
      operationId: "7d1f4a90-3c2b-4e5f-8a90-0b1c2d3e4f50",
      sourceMaterialId: materialId,
      reason: "edit",
      expected: current,
      next: {
        title: current!.title,
        provider: current!.provider,
        model: current!.model,
        questions: [rewritten, current!.questions[1]!],
        retired: [await practiceRetirementRecord(before, "corrected")],
      },
    } as unknown as PracticeSaveOperation);
    expect(saved.status).toBe("saved");

    const after = await readCurrentSnapshot(query, materialId);
    expect(after!.versionNumber).toBe(2);
    expect(after!.provider).toBe("import");
    expect(after!.questions.map((question) => question.identity)).toEqual(
      current!.questions.map((question) => question.identity),
    );
    expect(after!.retired).toHaveLength(1);
    const edited = await query(
      `SELECT i.logical_id, i.replaces_id, o.origin FROM practice_test_items i
         JOIN practice_test_versions v ON v.id = i.version_id
         LEFT JOIN practice_item_origins o ON o.item_id = i.id
        WHERE v.source_material_id = ? AND v.is_active = 1 ORDER BY i.ordinal`,
      [materialId],
    );
    expect(edited.map((row) => row.logical_id)).toEqual(
      current!.questions.map((question) => question.identity),
    );
    for (const row of edited) {
      expect(row.replaces_id).toBeNull();
      expect(row.origin).toBeNull();
    }
    const [mirrorAfter] = await query("SELECT provider, retired_json FROM practice_tests WHERE source_material_id = ?", [materialId]);
    expect(mirrorAfter!.provider).toBe("import");
    expect(JSON.parse(String(mirrorAfter!.retired_json))).toEqual(after!.retired);
    const referenceAfter = await createNodeSqliteDatabase();
    try {
      await validatePracticeAuthoringState(query, (sql, params) => referenceAfter.select(sql, params));
    } finally {
      referenceAfter.close();
    }
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
