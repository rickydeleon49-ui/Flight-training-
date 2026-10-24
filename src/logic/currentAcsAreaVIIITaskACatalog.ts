/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VIII (Basic Instrument Maneuvers), Task A (Straight-and-Level Flight).
 *
 * Source: FAA-S-ACS-6C, printed page 46 / PDF page 54.
 *
 * This is an explicit partial slice limited to PA.VIII.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "46",
  pdfPages: "54",
  areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
  task: "Task A. Straight-and-Level Flight",
  coverageLabel: "PA.VIII.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIIITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VIII";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE;
}

const currentAreaVIIITaskAEntries = [
  ["PA.VIII.A.K1", "Flight instruments as they relate to:"],
  ["PA.VIII.A.K1a", "Instrument limitations and potential errors"],
  ["PA.VIII.A.K1b", "Indication of the aircraft attitude"],
  ["PA.VIII.A.K1c", "Function and operation"],
  ["PA.VIII.A.K1d", "Proper instrument cross-check techniques"],
  [
    "PA.VIII.A.R1",
    "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
  ],
  ["PA.VIII.A.R2", "When to seek assistance or declare an emergency in a deteriorating situation."],
  ["PA.VIII.A.R3", "Collision hazards."],
  ["PA.VIII.A.R4", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.VIII.A.R5", "Fixation and omission."],
  ["PA.VIII.A.R6", "Instrument Interpretation."],
  ["PA.VIII.A.R7", "Control application solely by reference to instruments."],
  ["PA.VIII.A.R8", "Trimming the aircraft."],
  [
    "PA.VIII.A.S1",
    "Maintain straight-and-level flight using proper instrument cross-check and interpretation, and coordinated control application.",
  ],
  ["PA.VIII.A.S2", "Maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots."],
] as const;

/** All 15 current PA.VIII.A codes from FAA-S-ACS-6C page 46. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES: readonly CurrentAreaVIIITaskAAktrCode[] =
  currentAreaVIIITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VIII",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE,
  }));

export type CurrentAreaVIIITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaVIIITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VIII.A slice.
 * Anything outside these 15 current entries remains unresolved.
 */
export function resolveCurrentAreaVIIITaskAAktrCode(
  code: string,
): CurrentAreaVIIITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
