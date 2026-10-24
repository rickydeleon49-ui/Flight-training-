/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VI (Navigation), Task D (Lost Procedures).
 *
 * Source: FAA-S-ACS-6C, printed pages 41–42 / PDF pages 49–50.
 *
 * This is an explicit partial slice limited to PA.VI.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "41–42",
  pdfPages: "49–50",
  areaOfOperation: "Area of Operation VI: Navigation",
  task: "Task D. Lost Procedures",
  coverageLabel: "PA.VI.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVITaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VI";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE;
}

const currentAreaVITaskDEntries = [
  ["PA.VI.D.K1", "Methods to determine position."],
  [
    "PA.VI.D.K2",
    "Assistance available if lost (e.g., radar services, communication procedures).",
  ],
  ["PA.VI.D.R1", "Collision hazards."],
  [
    "PA.VI.D.R2",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.VI.D.R3", "Recording times over waypoints."],
  [
    "PA.VI.D.R4",
    "When to seek assistance or declare an emergency in a deteriorating situation.",
  ],
  ["PA.VI.D.S1", "Use an appropriate method to determine position."],
  ["PA.VI.D.S2", "Maintain an appropriate heading and climb as necessary."],
  ["PA.VI.D.S3", "Identify prominent landmarks."],
  [
    "PA.VI.D.S4",
    "Use navigation systems/facilities or contact an ATC facility for assistance.",
  ],
  ["PA.VI.D.S5", "Select an appropriate course of action."],
] as const;

/** All 11 current PA.VI.D codes from FAA-S-ACS-6C pages 41–42. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES: readonly CurrentAreaVITaskDAktrCode[] =
  currentAreaVITaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VI",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE,
  }));

export type CurrentAreaVITaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaVITaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VI.D slice.
 * Anything outside these 11 current entries remains unresolved.
 */
export function resolveCurrentAreaVITaskDAktrCode(
  code: string,
): CurrentAreaVITaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
