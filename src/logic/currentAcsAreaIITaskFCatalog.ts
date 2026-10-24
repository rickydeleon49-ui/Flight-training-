/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation II (Preflight Procedures), Task F (Before Takeoff Check).
 *
 * Source: FAA-S-ACS-6C, printed page 15 / PDF page 23.
 *
 * This is an explicit partial slice limited to PA.II.F, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "15",
  pdfPages: "23",
  areaOfOperation: "Area of Operation II: Preflight Procedures",
  task: "Task F. Before Takeoff Check",
  coverageLabel: "PA.II.F",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIITaskFAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "II";
  task: "F";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE;
}

const currentAreaIITaskFEntries = [
  ["PA.II.F.K1", "Purpose of before takeoff checklist items, including:"],
  ["PA.II.F.K1a", "Reasons for checking each item"],
  ["PA.II.F.K1b", "Detecting malfunctions"],
  [
    "PA.II.F.K1c",
    "Ensuring the aircraft is in safe operating condition as recommended by the manufacturer",
  ],
  ["PA.II.F.R1", "Division of attention while conducting before takeoff checks."],
  ["PA.II.F.R2", "Unexpected runway changes by air traffic control (ATC)."],
  ["PA.II.F.R3", "Wake turbulence."],
  [
    "PA.II.F.R4",
    "Potential powerplant failure during takeoff or other malfunction considering operational factors such as airplane characteristics, runway/takeoff path length, surface conditions, environmental conditions, and obstructions.",
  ],
  ["PA.II.F.S1", "Review takeoff performance."],
  ["PA.II.F.S2", "Complete the appropriate checklist(s)."],
  [
    "PA.II.F.S3",
    "Position the airplane appropriately considering wind direction and the presence of any aircraft, vessels, or buildings as applicable.",
  ],
  ["PA.II.F.S4", "Divide attention inside and outside the flight deck."],
  ["PA.II.F.S5", "Verify that engine parameters and airplane configuration are suitable."],
] as const;

/** All 13 current PA.II.F codes from FAA-S-ACS-6C page 15. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES: readonly CurrentAreaIITaskFAktrCode[] =
  currentAreaIITaskFEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "II",
    task: "F",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE,
  }));

export type CurrentAreaIITaskFCodeResolution =
  | { status: "current"; entry: CurrentAreaIITaskFAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.II.F slice.
 * Anything outside these 13 current entries remains unresolved.
 */
export function resolveCurrentAreaIITaskFAktrCode(code: string): CurrentAreaIITaskFCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
