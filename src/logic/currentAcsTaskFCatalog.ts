/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task F (Performance and Limitations).
 *
 * Source: FAA-S-ACS-6C, printed pages 6–7 / PDF pages 14–15.
 *
 * This is an explicit partial slice limited to PA.I.F, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "6–7",
  pdfPages: "14–15",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task F. Performance and Limitations",
  coverageLabel: "PA.I.F",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskFAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "F";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE;
}

const currentTaskFEntries = [
  ["PA.I.F.K1", "Elements related to performance and limitations by explaining the use of charts, tables, and data to determine performance."],
  ["PA.I.F.K2", "Factors affecting performance, including:"],
  ["PA.I.F.K2a", "Atmospheric conditions"],
  ["PA.I.F.K2b", "Pilot technique"],
  ["PA.I.F.K2c", "Airplane configuration"],
  ["PA.I.F.K2d", "Airport environment"],
  ["PA.I.F.K2e", "Loading [e.g., center of gravity (CG)]"],
  ["PA.I.F.K2f", "Weight and balance"],
  ["PA.I.F.K3", "Aerodynamics."],
  ["PA.I.F.R1", "Use of performance charts, tables, and data."],
  ["PA.I.F.R2", "Airplane limitations."],
  ["PA.I.F.R3", "Possible differences between calculated performance and actual performance."],
  ["PA.I.F.S1", "Compute the weight and balance, correct out-of-CG loading errors and determine if the weight and balance remains within limits during all phases of flight."],
  ["PA.I.F.S2", "Use the appropriate airplane performance charts, tables, and data."],
] as const;

/** All 14 current PA.I.F codes from FAA-S-ACS-6C pages 6–7. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES: readonly CurrentTaskFAktrCode[] =
  currentTaskFEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "F",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE,
  }));

export type CurrentTaskFCodeResolution =
  | { status: "current"; entry: CurrentTaskFAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.F slice.
 * Anything outside these 14 current entries remains unresolved.
 */
export function resolveCurrentTaskFAktrCode(code: string): CurrentTaskFCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
