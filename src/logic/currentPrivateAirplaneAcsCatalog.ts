/**
 * Offline aggregator index for current Private Pilot Airplane ACS codes
 * across all 61 task slices in FAA-S-ACS-6C.
 *
 * NOTE: This is a code catalog index, not a readiness score or proof of
 * coverage beyond its constituent task slices.
 */

import {
  resolveArchivedAktrCode,
} from "./aktrCodeCatalog";
import type { ArchivedAktrCode } from "./aktrCodeCatalog";

import { CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES } from "./currentAcsAreaIIITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES } from "./currentAcsAreaIIITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES } from "./currentAcsAreaIITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES } from "./currentAcsAreaIITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES } from "./currentAcsAreaIITaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES } from "./currentAcsAreaIITaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES } from "./currentAcsAreaIITaskECatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES } from "./currentAcsAreaIITaskFCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES } from "./currentAcsAreaIVTaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES } from "./currentAcsAreaIVTaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES } from "./currentAcsAreaIVTaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES } from "./currentAcsAreaIVTaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES } from "./currentAcsAreaIVTaskECatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES } from "./currentAcsAreaIVTaskFCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES } from "./currentAcsAreaIVTaskGCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES } from "./currentAcsAreaIVTaskHCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES } from "./currentAcsAreaIVTaskICatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES } from "./currentAcsAreaIVTaskJCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES } from "./currentAcsAreaIVTaskKCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES } from "./currentAcsAreaIVTaskLCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES } from "./currentAcsAreaIVTaskMCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES } from "./currentAcsAreaIVTaskNCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES } from "./currentAcsAreaIXTaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES } from "./currentAcsAreaIXTaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES } from "./currentAcsAreaIXTaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES } from "./currentAcsAreaIXTaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES } from "./currentAcsAreaIXTaskECatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES } from "./currentAcsAreaIXTaskFCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES } from "./currentAcsAreaIXTaskGCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES } from "./currentAcsAreaVIIITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES } from "./currentAcsAreaVIIITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES } from "./currentAcsAreaVIIITaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES } from "./currentAcsAreaVIIITaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES } from "./currentAcsAreaVIIITaskECatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES } from "./currentAcsAreaVIIITaskFCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES } from "./currentAcsAreaVIITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES } from "./currentAcsAreaVIITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES } from "./currentAcsAreaVIITaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES } from "./currentAcsAreaVIITaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES } from "./currentAcsAreaVITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES } from "./currentAcsAreaVITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES } from "./currentAcsAreaVITaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES } from "./currentAcsAreaVITaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES } from "./currentAcsAreaVTaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES } from "./currentAcsAreaVTaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES } from "./currentAcsAreaXIITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES } from "./currentAcsAreaXIITaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES } from "./currentAcsAreaXITaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES } from "./currentAcsAreaXTaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES } from "./currentAcsAreaXTaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES } from "./currentAcsAreaXTaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES } from "./currentAcsAreaXTaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES } from "./currentAcsTaskACatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES } from "./currentAcsTaskBCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES } from "./currentAcsTaskCCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES } from "./currentAcsTaskDCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES } from "./currentAcsTaskECatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES } from "./currentAcsTaskFCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES } from "./currentAcsTaskGCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES } from "./currentAcsTaskHCatalog";
import { CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES } from "./currentAcsTaskICatalog";

/**
 * Ordered list of all current Private Pilot Airplane ACS (FAA-S-ACS-6C) codes
 * aggregated from all 61 task slices, preserving source array ordering.
 */
export const CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES = [
  ...CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES,
  ...CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES,
] as const;

export type CurrentPrivateAirplaneAcsEntry =
  (typeof CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES)[number];

export type PrivateAirplaneAcsResolution =
  | { status: "current"; entry: CurrentPrivateAirplaneAcsEntry }
  | { status: "archived"; entry: ArchivedAktrCode }
  | { status: "unresolved"; code: string };

const currentCodesByNormalizedKey = new Map<string, CurrentPrivateAirplaneAcsEntry>();
for (const entry of CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES) {
  currentCodesByNormalizedKey.set(
    entry.code.replace(/[a-z]/g, (letter) => letter.toUpperCase()),
    entry,
  );
}

/**
 * Resolves a given ACS code string against current and archived Private Pilot Airplane codes.
 *
 * Matching is ASCII case-insensitive.
 * - Current codes return `{ status: "current", entry }`.
 * - Archived codes delegate to `resolveArchivedAktrCode` and return `{ status: "archived", entry }`.
 * - Unresolved codes return `{ status: "unresolved", code: normalized uppercase ASCII token }`.
 *
 * NOTE: This is an offline code index, not a readiness score or proof of coverage
 * beyond the constituent task slices.
 */
export function resolvePrivateAirplaneAcsCode(code: string): PrivateAirplaneAcsResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  if (!normalized) {
    return { status: "unresolved", code: normalized };
  }

  const currentEntry = currentCodesByNormalizedKey.get(normalized);
  if (currentEntry) {
    return { status: "current", entry: currentEntry };
  }

  const archivedResolution = resolveArchivedAktrCode(normalized);
  if (archivedResolution.status === "archived") {
    return { status: "archived", entry: archivedResolution.entry };
  }

  return { status: "unresolved", code: normalized };
}
