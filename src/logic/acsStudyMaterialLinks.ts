import type {
  AiStudySet,
  PracticeTest,
  Question,
  StudyMaterial,
} from "@/domain/types";
import {
  resolvePrivateAirplaneAcsCode,
  type CurrentPrivateAirplaneAcsEntry,
} from "./currentPrivateAirplaneAcsCatalog";
import type { ArchivedAktrCode } from "./aktrCodeCatalog";

export interface AcsMaterialLink {
  material: StudyMaterial;
  aiStudySets: AiStudySet[];
  practiceTests: PracticeTest[];
  instructorQuestions: Question[];
}

export type AcsStudyMaterialLinksGroup =
  | {
      status: "current";
      code: string;
      entry: CurrentPrivateAirplaneAcsEntry;
      materials: AcsMaterialLink[];
    }
  | {
      status: "archived";
      code: string;
      entry: ArchivedAktrCode;
      materials: [];
    }
  | {
      status: "unresolved";
      code: string;
      materials: [];
    };

export interface FindAcsStudyMaterialLinksInput {
  codes: readonly string[];
  materials?: readonly StudyMaterial[];
  aiStudySets?: readonly AiStudySet[];
  practiceTests?: readonly PracticeTest[];
  instructorQuestions?: readonly Question[];
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/[a-z]/g, (char) => char.toUpperCase());
}

function normalizeCodeToken(code: string): string {
  return code.replace(/[a-z]/g, (char) => char.toUpperCase());
}

/**
 * Pure offline helper to find existing study material links for entered ACS codes.
 *
 * Slices:
 * - Current ACS code: returns resolved current entry plus matching source materials,
 *   with associated AiStudySets, PracticeTests, and instructor Questions.
 * - Archived ACS code: returns archived entry and empty materials.
 * - Unresolved / out-of-slice / invalid string: returns unresolved normalized code and empty materials.
 *
 * Entered codes are deduplicated by normalized uppercase ASCII token preserving first occurrence.
 * Tags are matched by exact equality after trimming tag whitespace and ASCII uppercasing.
 * Does not mutate inputs.
 */
export function findAcsStudyMaterialLinks(
  input: FindAcsStudyMaterialLinksInput,
): AcsStudyMaterialLinksGroup[] {
  const enteredCodes = input.codes ?? [];
  const materials = input.materials ?? [];
  const aiStudySets = input.aiStudySets ?? [];
  const practiceTests = input.practiceTests ?? [];
  const instructorQuestions = input.instructorQuestions ?? [];

  const seenCodeKeys = new Set<string>();
  const distinctCodes: string[] = [];

  for (const rawCode of enteredCodes) {
    const key = normalizeCodeToken(rawCode);
    if (!seenCodeKeys.has(key)) {
      seenCodeKeys.add(key);
      distinctCodes.push(rawCode);
    }
  }

  if (distinctCodes.length === 0) {
    return [];
  }

  // Pre-index study aids by material ID
  const studySetsByMaterialId = new Map<string, AiStudySet[]>();
  for (const set of aiStudySets) {
    const list = studySetsByMaterialId.get(set.sourceMaterialId);
    if (list) {
      list.push(set);
    } else {
      studySetsByMaterialId.set(set.sourceMaterialId, [set]);
    }
  }

  const practiceTestsByMaterialId = new Map<string, PracticeTest[]>();
  for (const test of practiceTests) {
    const list = practiceTestsByMaterialId.get(test.sourceMaterialId);
    if (list) {
      list.push(test);
    } else {
      practiceTestsByMaterialId.set(test.sourceMaterialId, [test]);
    }
  }

  const questionsByMaterialId = new Map<string, Question[]>();
  for (const q of instructorQuestions) {
    if (q.materialId) {
      const list = questionsByMaterialId.get(q.materialId);
      if (list) {
        list.push(q);
      } else {
        questionsByMaterialId.set(q.materialId, [q]);
      }
    }
  }

  // Index materials by normalized tag for O(1) tag lookup
  const materialsByNormalizedTag = new Map<string, StudyMaterial[]>();
  for (const mat of materials) {
    const seenTagsForMaterial = new Set<string>();
    for (const rawTag of mat.tags ?? []) {
      const normTag = normalizeTag(rawTag);
      if (normTag && !seenTagsForMaterial.has(normTag)) {
        seenTagsForMaterial.add(normTag);
        const list = materialsByNormalizedTag.get(normTag);
        if (list) {
          list.push(mat);
        } else {
          materialsByNormalizedTag.set(normTag, [mat]);
        }
      }
    }
  }

  const results: AcsStudyMaterialLinksGroup[] = [];

  for (const codeStr of distinctCodes) {
    const resolution = resolvePrivateAirplaneAcsCode(codeStr);

    if (resolution.status === "current") {
      const currentEntryCodeNorm = normalizeCodeToken(resolution.entry.code);
      const matchingMaterials = materialsByNormalizedTag.get(currentEntryCodeNorm) ?? [];

      const materialLinks: AcsMaterialLink[] = matchingMaterials.map((mat) => ({
        material: mat,
        aiStudySets: [...(studySetsByMaterialId.get(mat.id) ?? [])],
        practiceTests: [...(practiceTestsByMaterialId.get(mat.id) ?? [])],
        instructorQuestions: [...(questionsByMaterialId.get(mat.id) ?? [])],
      }));

      results.push({
        status: "current",
        code: resolution.entry.code,
        entry: resolution.entry,
        materials: materialLinks,
      });
    } else if (resolution.status === "archived") {
      results.push({
        status: "archived",
        code: resolution.entry.code,
        entry: resolution.entry,
        materials: [],
      });
    } else {
      results.push({
        status: "unresolved",
        code: resolution.code,
        materials: [],
      });
    }
  }

  return results;
}
