/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation XII (Postflight Procedures), Task A (After Landing, Parking, and Securing).
 *
 * Source: FAA-S-ACS-6C, printed pages 64–65 / PDF pages 72–73.
 *
 * This is an explicit partial slice limited to PA.XII.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "64–65",
  pdfPages: "72–73",
  areaOfOperation: "Area of Operation XII: Postflight Procedures",
  task: "Task A. After Landing, Parking, and Securing",
  coverageLabel: "PA.XII.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXIITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "XII";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_A_SOURCE;
}

const currentAreaXIITaskAEntries = [
  [
    "PA.XII.A.K1",
    "Airplane shutdown, securing, and postflight inspection.",
  ],
  [
    "PA.XII.A.K2",
    "Documenting in-flight/postflight discrepancies.",
  ],
  [
    "PA.XII.A.R1",
    "Activities and distractions.",
  ],
  [
    "PA.XII.A.R3",
    "Airport specific security procedures.",
  ],
  [
    "PA.XII.A.R4",
    "Disembarking passengers safely on the ramp and monitoring passenger movement while on the ramp.",
  ],
  [
    "PA.XII.A.S2",
    "Park in an appropriate area, considering the safety of nearby persons and property.",
  ],
  [
    "PA.XII.A.S3",
    "Complete the appropriate checklist(s).",
  ],
  [
    "PA.XII.A.S4",
    "Conduct a postflight inspection and document discrepancies and servicing requirements, if any.",
  ],
  [
    "PA.XII.A.S5",
    "Secure the airplane.",
  ],
] as const;

/** All 9 current PA.XII.A codes from FAA-S-ACS-6C pages 64–65. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES: readonly CurrentAreaXIITaskAAktrCode[] =
  currentAreaXIITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "XII",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_A_SOURCE,
  }));

export type CurrentAreaXIITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaXIITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.XII.A slice.
 * Anything outside these 9 current entries remains unresolved.
 */
export function resolveCurrentAreaXIITaskAAktrCode(
  code: string,
): CurrentAreaXIITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
