/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation II (Preflight Procedures), Task A (Preflight Assessment).
 *
 * Source: FAA-S-ACS-6C, printed page 11 / PDF page 19.
 *
 * This is an explicit partial slice limited to PA.II.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 11,
  pdfPage: 19,
  areaOfOperation: "Area of Operation II: Preflight Procedures",
  task: "Task A. Preflight Assessment",
  coverageLabel: "PA.II.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "II";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE;
}

const currentAreaIITaskAEntries = [
  ["PA.II.A.K1", "Pilot self-assessment."],
  ["PA.II.A.K2", "Determining that the airplane to be used is appropriate and airworthy."],
  ["PA.II.A.K3", "Airplane preflight inspection, including:"],
  ["PA.II.A.K3a", "Which items should be inspected"],
  ["PA.II.A.K3b", "The reasons for checking each item"],
  ["PA.II.A.K3c", "How to detect possible defects"],
  ["PA.II.A.K3d", "The associated regulations"],
  ["PA.II.A.K4", "Environmental factors, including weather, terrain, route selection, and obstructions."],
  ["PA.II.A.R1", "Pilot."],
  ["PA.II.A.R2", "Aircraft."],
  ["PA.II.A.R3", "Environment (e.g., weather, airports, airspace, terrain, obstacles)."],
  ["PA.II.A.R4", "External pressures."],
  ["PA.II.A.R5", "Aviation security concerns."],
  ["PA.II.A.S1", "Inspect the airplane with reference to an appropriate checklist."],
  ["PA.II.A.S2", "Verify the airplane is in condition for safe flight and conforms to its type design."],
  ["PA.II.A.S3", "Perform self-assessment."],
  ["PA.II.A.S4", "Continue to assess the environment for safe flight."],
] as const;

/** All 17 current PA.II.A codes from FAA-S-ACS-6C page 11. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES: readonly CurrentAreaIITaskAAktrCode[] =
  currentAreaIITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "II",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE,
  }));

export type CurrentAreaIITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaIITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.II.A slice.
 * Anything outside these 17 current entries remains unresolved.
 */
export function resolveCurrentAreaIITaskAAktrCode(code: string): CurrentAreaIITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
