/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task B (Airworthiness Requirements).
 *
 * Source: FAA-S-ACS-6C, printed page 3 / PDF page 11.
 *
 * This is an explicit partial slice limited to PA.I.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 3,
  pdfPage: 11,
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task B. Airworthiness Requirements",
  coverageLabel: "PA.I.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE;
}

const currentTaskBEntries = [
  ["PA.I.B.K1", "General airworthiness requirements and compliance for airplanes, including:"],
  ["PA.I.B.K1a", "Location and expiration dates of required aircraft certificates"],
  ["PA.I.B.K1b", "Required inspections and airplane logbook documentation"],
  ["PA.I.B.K1c", "Airworthiness Directives and Special Airworthiness Information Bulletins"],
  ["PA.I.B.K1d", "Purpose and procedure for obtaining a special flight permit"],
  ["PA.I.B.K1e", "Owner/Operator and pilot-in-command responsibilities"],
  ["PA.I.B.K2", "Pilot-performed preventive maintenance."],
  ["PA.I.B.K3", "Equipment requirements for day and night VFR flight, including:"],
  ["PA.I.B.K3a", "Flying with inoperative equipment"],
  ["PA.I.B.K3b", "Using an approved Minimum Equipment List (MEL)"],
  ["PA.I.B.K3c", "Kinds of Operation Equipment List (KOEL)"],
  ["PA.I.B.K3d", "Required discrepancy records or placards"],
  ["PA.I.B.K4", "Standard and special airworthiness certificates and their associated operational limitations."],
  ["PA.I.B.R1", "Inoperative equipment discovered prior to flight."],
  ["PA.I.B.S1", "Locate and describe airplane airworthiness and registration information."],
  ["PA.I.B.S2", "Determine the airplane is airworthy in the scenario given by the evaluator."],
  ["PA.I.B.S3", "Apply appropriate procedures for operating with inoperative equipment in the scenario given by the evaluator."],
] as const;

/** All 17 current PA.I.B codes from FAA-S-ACS-6C page 3. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES: readonly CurrentTaskBAktrCode[] =
  currentTaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE,
  }));

export type CurrentTaskBCodeResolution =
  | { status: "current"; entry: CurrentTaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.B slice.
 * Anything outside these 17 current entries remains unresolved.
 */
export function resolveCurrentTaskBAktrCode(code: string): CurrentTaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
