import { describe, expect, it } from "vitest";
import type {
  AiStudySet,
  PracticeTest,
  Question,
  StudyMaterial,
} from "@/domain/types";
import { findAcsStudyMaterialLinks } from "./acsStudyMaterialLinks";
import { ARCHIVED_PRIVATE_AIRPLANE_CODES } from "./aktrCodeCatalog";

describe("findAcsStudyMaterialLinks", () => {
  const createMockMaterial = (id: string, title: string, tags: string[]): StudyMaterial => ({
    id,
    title,
    materialType: "study_guide",
    topic: "general",
    reviewStatus: "needs_review",
    priority: "later",
    goalId: null,
    eventId: null,
    notes: "",
    filePath: null,
    originalFileName: null,
    fileSize: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    lastReviewedAt: null,
    tags,
  });

  const createMockStudySet = (sourceMaterialId: string, title: string): AiStudySet => ({
    sourceMaterialId,
    title,
    summary: "Summary text",
    sections: [],
    flashcards: [],
    sourceNotes: "",
    provider: "manual",
    model: "",
    generatedAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  });

  const createMockPracticeTest = (sourceMaterialId: string, title: string): PracticeTest => ({
    sourceMaterialId,
    title,
    questions: [],
    provider: "manual",
    model: "",
    generatedAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  });

  const createMockQuestion = (id: string, materialId: string | null, text: string): Question => ({
    id,
    text,
    topic: "general",
    eventId: null,
    materialId,
    journalId: null,
    status: "to_ask",
    answer: "",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    answeredAt: null,
  });

  it("links current exact tag to one source material and only that material's associated sets/tests/instructor questions", () => {
    const mat1 = createMockMaterial("mat-1", "Weather Theory", ["PA.I.C.K1"]);
    const mat2 = createMockMaterial("mat-2", "Airspace", ["PA.I.E.K1"]);

    const set1 = createMockStudySet("mat-1", "Weather Set");
    const set2 = createMockStudySet("mat-2", "Airspace Set");

    const test1 = createMockPracticeTest("mat-1", "Weather Test");
    const test2 = createMockPracticeTest("mat-2", "Airspace Test");

    const q1 = createMockQuestion("q-1", "mat-1", "What is lapse rate?");
    const q2 = createMockQuestion("q-2", "mat-2", "What is Class B ceiling?");
    const qOrphan = createMockQuestion("q-3", null, "Unlinked question");

    const results = findAcsStudyMaterialLinks({
      codes: ["PA.I.C.K1"],
      materials: [mat1, mat2],
      aiStudySets: [set1, set2],
      practiceTests: [test1, test2],
      instructorQuestions: [q1, q2, qOrphan],
    });

    expect(results).toHaveLength(1);
    const group = results[0]!;
    expect(group.status).toBe("current");
    if (group.status === "current") {
      expect(group.code).toBe("PA.I.C.K1");
      expect(group.entry.code).toBe("PA.I.C.K1");
      expect(group.materials).toHaveLength(1);

      const link = group.materials[0]!;
      expect(link.material).toEqual(mat1);
      expect(link.aiStudySets).toEqual([set1]);
      expect(link.practiceTests).toEqual([test1]);
      expect(link.instructorQuestions).toEqual([q1]);
    }
  });

  it("handles case-insensitive and whitespace-trimmed tag matching", () => {
    // lowercase and extra whitespace in material tag
    const mat = createMockMaterial("mat-1", "Aerodynamics", ["  pa.i.c.k1  "]);
    const set = createMockStudySet("mat-1", "Aero Set");

    const results = findAcsStudyMaterialLinks({
      codes: ["PA.I.C.K1"],
      materials: [mat],
      aiStudySets: [set],
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("current");
    if (results[0]!.status === "current") {
      expect(results[0]!.materials).toHaveLength(1);
      expect(results[0]!.materials[0]!.material.id).toBe("mat-1");
      expect(results[0]!.materials[0]!.aiStudySets).toEqual([set]);
    }
  });

  it("does not substring-match or match partial tags (no false positives)", () => {
    const mat1 = createMockMaterial("mat-1", "Weather K10", ["PA.I.C.K10"]);
    const mat2 = createMockMaterial("mat-2", "Weather Substring", ["PA.I.C.K1_extra"]);
    const mat3 = createMockMaterial("mat-3", "Prefix", ["prefix_PA.I.C.K1"]);

    const results = findAcsStudyMaterialLinks({
      codes: ["PA.I.C.K1"],
      materials: [mat1, mat2, mat3],
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("current");
    if (results[0]!.status === "current") {
      expect(results[0]!.materials).toHaveLength(0);
    }
  });

  it("produces multiple groups when one material has two exact codes and both are queried", () => {
    const mat = createMockMaterial("mat-dual", "Multi Task Doc", ["PA.I.A.K1", "PA.I.B.K1"]);
    const set = createMockStudySet("mat-dual", "Multi Set");

    const results = findAcsStudyMaterialLinks({
      codes: ["PA.I.A.K1", "PA.I.B.K1"],
      materials: [mat],
      aiStudySets: [set],
    });

    expect(results).toHaveLength(2);

    expect(results[0]!.status).toBe("current");
    expect(results[0]!.code).toBe("PA.I.A.K1");
    if (results[0]!.status === "current") {
      expect(results[0]!.materials).toHaveLength(1);
      expect(results[0]!.materials[0]!.material.id).toBe("mat-dual");
    }

    expect(results[1]!.status).toBe("current");
    expect(results[1]!.code).toBe("PA.I.B.K1");
    if (results[1]!.status === "current") {
      expect(results[1]!.materials).toHaveLength(1);
      expect(results[1]!.materials[0]!.material.id).toBe("mat-dual");
    }
  });

  it("deduplicates repeated entered codes by normalized uppercase token, preserving first occurrence", () => {
    const results = findAcsStudyMaterialLinks({
      codes: ["pa.i.a.k1", "PA.I.A.K1", "PA.i.a.k1"],
      materials: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("current");
    expect(results[0]!.code).toBe("PA.I.A.K1");
  });

  it("reports known archived codes as archived and never links them to study materials", () => {
    const archivedCode = ARCHIVED_PRIVATE_AIRPLANE_CODES[0]!.code;
    // Even if a material has this archived code as a tag, archived codes return no study links
    const mat = createMockMaterial("mat-archived", "Old Checklist", [archivedCode]);

    const results = findAcsStudyMaterialLinks({
      codes: [archivedCode, archivedCode.toLowerCase()],
      materials: [mat],
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("archived");
    if (results[0]!.status === "archived") {
      expect(results[0]!.code).toBe(archivedCode);
      expect(results[0]!.entry.code).toBe(archivedCode);
      expect(results[0]!.materials).toEqual([]);
    }
  });

  it("leaves unknown, out-of-slice, and whitespace-only strings unresolved with empty materials", () => {
    const mat = createMockMaterial("mat-1", "Some Doc", ["   ", "NOT-A-CODE"]);
    const results = findAcsStudyMaterialLinks({
      codes: ["PA.I.A.K999", "NOT-A-CODE", "   ", ""],
      materials: [mat],
    });

    expect(results).toHaveLength(4);

    expect(results[0]!).toEqual({
      status: "unresolved",
      code: "PA.I.A.K999",
      materials: [],
    });

    expect(results[1]!).toEqual({
      status: "unresolved",
      code: "NOT-A-CODE",
      materials: [],
    });

    expect(results[2]!).toEqual({
      status: "unresolved",
      code: "   ",
      materials: [],
    });

    expect(results[3]!).toEqual({
      status: "unresolved",
      code: "",
      materials: [],
    });
  });

  it("returns empty groups when input codes are empty", () => {
    const results = findAcsStudyMaterialLinks({
      codes: [],
      materials: [createMockMaterial("m1", "Doc", ["PA.I.A.K1"])],
    });
    expect(results).toEqual([]);
  });

  it("keeps input arrays and objects unchanged (immutability)", () => {
    const codes = Object.freeze(["PA.I.A.K1", "PA.I.B.K1"]);
    const mat = Object.freeze(createMockMaterial("m1", "Doc", Object.freeze(["PA.I.A.K1"]) as unknown as string[]));
    const materials = Object.freeze([mat]);
    const set = Object.freeze(createMockStudySet("m1", "Set 1"));
    const aiStudySets = Object.freeze([set]);
    const test = Object.freeze(createMockPracticeTest("m1", "Test 1"));
    const practiceTests = Object.freeze([test]);
    const question = Object.freeze(createMockQuestion("q1", "m1", "Question 1"));
    const instructorQuestions = Object.freeze([question]);

    const results = findAcsStudyMaterialLinks({
      codes,
      materials,
      aiStudySets,
      practiceTests,
      instructorQuestions,
    });

    expect(results).toHaveLength(2);
    expect(codes).toEqual(["PA.I.A.K1", "PA.I.B.K1"]);
    expect(materials).toHaveLength(1);
    expect(aiStudySets).toHaveLength(1);
    expect(practiceTests).toHaveLength(1);
    expect(instructorQuestions).toHaveLength(1);
  });
});
