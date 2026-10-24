/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation XI (Night Operations), Task A (Night Operations).
 *
 * Source: FAA-S-ACS-6C, printed pages 63–64 / PDF pages 71–72.
 *
 * This is an explicit partial slice limited to PA.XI.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_XI_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "63–64",
  pdfPages: "71–72",
  areaOfOperation: "Area of Operation XI: Night Operations",
  task: "Task A. Night Operations",
  coverageLabel: "PA.XI.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "XI";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_XI_TASK_A_SOURCE;
}

const currentAreaXITaskAEntries = [
  [
    "PA.XI.A.K1",
    "Physiological aspects of vision related to night flying.",
  ],
  [
    "PA.XI.A.K2",
    "Lighting systems identifying airports, runways, taxiways and obstructions, as well as pilot controlled lighting.",
  ],
  [
    "PA.XI.A.K3",
    "Airplane equipment and lighting requirements for night operations.",
  ],
  [
    "PA.XI.A.K4",
    "Personal equipment essential for night flight.",
  ],
  [
    "PA.XI.A.K5",
    "Night orientation, navigation, chart reading techniques and methods for maintaining night vision effectiveness.",
  ],
  [
    "PA.XI.A.K6",
    "Night taxi operations.",
  ],
  [
    "PA.XI.A.K7",
    "Interpretation of traffic position and direction based solely on position lights.",
  ],
  [
    "PA.XI.A.K8",
    "Visual illusions at night.",
  ],
  [
    "PA.XI.A.R1",
    "Collision hazards.",
  ],
  [
    "PA.XI.A.R2",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.XI.A.R3",
    "Effect of visual illusions and night adaptation during all phases of night flying.",
  ],
  [
    "PA.XI.A.R4",
    "Runway incursion.",
  ],
  [
    "PA.XI.A.R5",
    "Night currency versus proficiency.",
  ],
  [
    "PA.XI.A.R6",
    "Weather considerations specific to night operations.",
  ],
  [
    "PA.XI.A.R7",
    "Inoperative equipment.",
  ],
] as const;

/** All 15 current PA.XI.A codes from FAA-S-ACS-6C pages 63–64. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES: readonly CurrentAreaXITaskAAktrCode[] =
  currentAreaXITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "XI",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_XI_TASK_A_SOURCE,
  }));

export type CurrentAreaXITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaXITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.XI.A slice.
 * Anything outside these 15 current entries remains unresolved.
 */
export function resolveCurrentAreaXITaskAAktrCode(
  code: string,
): CurrentAreaXITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
