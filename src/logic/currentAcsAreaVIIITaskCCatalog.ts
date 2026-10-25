/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VIII (Basic Instrument Maneuvers), Task C (Constant Airspeed Descents).
 *
 * Source: FAA-S-ACS-6C, printed pages 47–48 / PDF pages 55–56.
 *
 * This is an explicit partial slice limited to PA.VIII.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "47–48",
  pdfPages: "55–56",
  areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
  task: "Task C. Constant Airspeed Descents",
  coverageLabel: "PA.VIII.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIIITaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VIII";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE;
}

const currentAreaVIIITaskCEntries = [
  ["PA.VIII.C.K1", "Flight instruments as they relate to:"],
  ["PA.VIII.C.K1a", "Instrument limitations and potential errors"],
  ["PA.VIII.C.K1b", "Indication of the aircraft attitude"],
  ["PA.VIII.C.K1c", "Function and operation"],
  ["PA.VIII.C.K1d", "Proper instrument cross-check techniques"],
  [
    "PA.VIII.C.R1",
    "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
  ],
  ["PA.VIII.C.R2", "When to seek assistance or declare an emergency in a deteriorating situation."],
  ["PA.VIII.C.R3", "Collision hazards."],
  ["PA.VIII.C.R4", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.VIII.C.R5", "Fixation and omission."],
  ["PA.VIII.C.R6", "Instrument Interpretation."],
  ["PA.VIII.C.R7", "Control application solely by reference to instruments."],
  ["PA.VIII.C.R8", "Trimming the aircraft."],
  [
    "PA.VIII.C.S1",
    "Transition to the descent pitch attitude and power setting on an assigned heading using proper instrument cross-check and interpretation, and coordinated flight control application.",
  ],
  ["PA.VIII.C.S2", "Descend at a constant airspeed to specific altitudes in straight flight and turns."],
  [
    "PA.VIII.C.S3",
    "Level off at the assigned altitude and maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
  ],
] as const;

/** All 16 current PA.VIII.C codes from FAA-S-ACS-6C pages 47–48. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES: readonly CurrentAreaVIIITaskCAktrCode[] =
  currentAreaVIIITaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VIII",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE,
  }));

export type CurrentAreaVIIITaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaVIIITaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VIII.C slice.
 * Anything outside these 16 current entries remains unresolved.
 */
export function resolveCurrentAreaVIIITaskCAktrCode(
  code: string,
): CurrentAreaVIIITaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
