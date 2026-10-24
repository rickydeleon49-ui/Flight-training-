/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation II (Preflight Procedures), Task C (Engine Starting).
 *
 * Source: FAA-S-ACS-6C, printed page 12 / PDF page 20.
 *
 * This is an explicit partial slice limited to PA.II.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 12,
  pdfPage: 20,
  areaOfOperation: "Area of Operation II: Preflight Procedures",
  task: "Task C. Engine Starting",
  coverageLabel: "PA.II.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIITaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "II";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE;
}

const currentAreaIITaskCEntries = [
  ["PA.II.C.K1", "Starting under various conditions."],
  ["PA.II.C.K2", "Starting the engine(s) by use of external power."],
  ["PA.II.C.K3", "Limitations associated with starting."],
  ["PA.II.C.K4", "Conditions leading to and procedures for an aborted start."],
  ["PA.II.C.R1", "Propeller safety."],
  ["PA.II.C.S1", "Position the airplane properly considering structures, other aircraft, wind, and the safety of nearby persons and property."],
  ["PA.II.C.S2", "Complete the appropriate checklist(s)."],
] as const;

/** All 7 current PA.II.C codes from FAA-S-ACS-6C page 12. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES: readonly CurrentAreaIITaskCAktrCode[] =
  currentAreaIITaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "II",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE,
  }));

export type CurrentAreaIITaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaIITaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.II.C slice.
 * Anything outside these 7 current entries remains unresolved.
 */
export function resolveCurrentAreaIITaskCAktrCode(code: string): CurrentAreaIITaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
