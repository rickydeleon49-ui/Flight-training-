/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task A (Pilot Qualifications).
 *
 * Source: FAA-S-ACS-6C, printed page 2 / PDF page 10.
 *
 * This is an explicit partial slice limited to PA.I.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 2,
  pdfPage: 10,
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task A. Pilot Qualifications",
  coverageLabel: "PA.I.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE;
}

const currentTaskAEntries = [
  ["PA.I.A.K1", "Certification requirements, recent flight experience, and recordkeeping."],
  ["PA.I.A.K2", "Privileges and limitations."],
  ["PA.I.A.K3", "Medical certificates: class, expiration, privileges, temporary disqualifications."],
  ["PA.I.A.K4", "Documents required to exercise private pilot privileges."],
  ["PA.I.A.K5", "Part 68 BasicMed privileges and limitations."],
  ["PA.I.A.R1", "Proficiency versus currency."],
  ["PA.I.A.R2", "Flying unfamiliar aircraft or operating with unfamiliar flight display systems and avionics."],
  ["PA.I.A.S1", "Apply requirements to act as pilot-in-command (PIC) under Visual Flight Rules (VFR) in a scenario given by the evaluator."],
] as const;

/** All eight current PA.I.A codes from FAA-S-ACS-6C page 2. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES: readonly CurrentTaskAAktrCode[] =
  currentTaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE,
  }));

export type CurrentTaskACodeResolution =
  | { status: "current"; entry: CurrentTaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.A slice.
 * Anything outside these eight current entries remains unresolved.
 */
export function resolveCurrentTaskAAktrCode(code: string): CurrentTaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
