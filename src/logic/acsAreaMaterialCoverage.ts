/**
 * Pure offline helper to summarize exact-tagged source-material availability
 * for each current FAA-S-ACS-6C Private Airplane Area of Operation (I–XII).
 *
 * IMPORTANT BOUNDARIES AND SEMANTICS:
 * - This is an offline count of existing source-material exact tags only.
 * - It says nothing about what a student has studied, proficiency, readiness,
 *   or test results.
 * - Reuses exact-tag linking behavior matching ACS code tokens. Does not infer
 *   tags from titles/text or associate content by topic.
 * - Counts a code as matched once even if duplicate or case-variant tags exist.
 * - Counts a material once per area even if it has multiple matching tags within
 *   that area.
 * - Empty materials produce twelve zero-matched rows.
 */

import type { StudyMaterial } from "@/domain/types";
import { findAcsStudyMaterialLinks } from "./acsStudyMaterialLinks";
import {
  CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES,
  type CurrentPrivateAirplaneAcsEntry,
} from "./currentPrivateAirplaneAcsCatalog";

/**
 * Ordered list of canonical Roman numerals for all twelve Private Airplane Areas of Operation.
 */
export const PRIVATE_AIRPLANE_ACS_AREAS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export type PrivateAirplaneAreaRoman = (typeof PRIVATE_AIRPLANE_ACS_AREAS)[number];

export interface AcsAreaMaterialCoverageSummary {
  /** Roman numeral of the Area of Operation (I through XII) */
  area: PrivateAirplaneAreaRoman;
  /** Authoritative area label from catalog source metadata (e.g., "Area of Operation I: Preflight Preparation") */
  areaLabel: string;
  /** Total current ACS codes defined in this area */
  totalCodeCount: number;
  /** Number of codes in this area that match at least one tagged material */
  matchedCodeCount: number;
  /** Number of codes in this area without any matching tagged material */
  unmatchedCodeCount: number;
  /** Number of distinct study materials matching at least one code in this area */
  distinctMaterialCount: number;
}

export interface SummarizeAcsAreaMaterialCoverageInput {
  materials?: readonly StudyMaterial[];
}

/**
 * Pre-grouped catalog definitions by Area of Operation.
 * Derived once from the static CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES catalog.
 */
interface AreaCatalogInfo {
  area: PrivateAirplaneAreaRoman;
  areaLabel: string;
  codes: readonly CurrentPrivateAirplaneAcsEntry[];
}

const AREA_CATALOG_INFOS: readonly AreaCatalogInfo[] = (() => {
  const byArea = new Map<PrivateAirplaneAreaRoman, { areaLabel: string; codes: CurrentPrivateAirplaneAcsEntry[] }>();

  for (const roman of PRIVATE_AIRPLANE_ACS_AREAS) {
    byArea.set(roman, { areaLabel: "", codes: [] });
  }

  for (const entry of CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES) {
    const areaRoman = entry.areaOfOperation;
    const bucket = byArea.get(areaRoman);
    if (bucket) {
      if (!bucket.areaLabel && entry.source?.areaOfOperation) {
        bucket.areaLabel = entry.source.areaOfOperation;
      }
      bucket.codes.push(entry);
    }
  }

  return PRIVATE_AIRPLANE_ACS_AREAS.map((area) => {
    const bucket = byArea.get(area)!;
    return {
      area,
      areaLabel: bucket.areaLabel,
      codes: bucket.codes,
    };
  });
})();

/**
 * Summarizes exact-tagged source-material availability for each current
 * FAA-S-ACS-6C Private Airplane Area of Operation (I–XII).
 *
 * NOTE: This is a metadata count of existing source-material tags only.
 * It says nothing about what the student actually studied, student proficiency,
 * flight readiness, or test results.
 */
export function summarizeAcsAreaMaterialCoverage(
  input?: SummarizeAcsAreaMaterialCoverageInput,
): AcsAreaMaterialCoverageSummary[] {
  const materials = input?.materials ?? [];

  return AREA_CATALOG_INFOS.map((areaInfo) => {
    const totalCodeCount = areaInfo.codes.length;
    let matchedCodeCount = 0;
    const distinctMaterialIdsForArea = new Set<string>();
    const linkedCodes = findAcsStudyMaterialLinks({
      codes: areaInfo.codes.map((entry) => entry.code),
      materials,
    });

    for (const linkedCode of linkedCodes) {
      if (linkedCode.status === "current" && linkedCode.materials.length > 0) {
        matchedCodeCount += 1;
        for (const materialLink of linkedCode.materials) {
          distinctMaterialIdsForArea.add(materialLink.material.id);
        }
      }
    }

    const unmatchedCodeCount = totalCodeCount - matchedCodeCount;
    const distinctMaterialCount = distinctMaterialIdsForArea.size;

    return {
      area: areaInfo.area,
      areaLabel: areaInfo.areaLabel,
      totalCodeCount,
      matchedCodeCount,
      unmatchedCodeCount,
      distinctMaterialCount,
    };
  });
}
