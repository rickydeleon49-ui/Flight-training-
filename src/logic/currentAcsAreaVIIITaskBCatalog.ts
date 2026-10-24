/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VIII (Basic Instrument Maneuvers), Task B (Constant Airspeed Climbs).
 *
 * Source: FAA-S-ACS-6C, printed pages 46–47 / PDF pages 54–55.
 *
 * This is an explicit partial slice limited to PA.VIII.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "46–47",
  pdfPages: "54–55",
  areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
  task: "Task B. Constant Airspeed Climbs",
  coverageLabel: "PA.VIII.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIIITaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VIII";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE;
}

const currentAreaVIIITaskBEntries = [
  ["PA.VIII.B.K1", "Flight instruments as they relate to:"],
  ["PA.VIII.B.K1a", "Instrument limitations and potential errors"],
  ["PA.VIII.B.K1b", "Indication of the aircraft attitude"],
  ["PA.VIII.B.K1c", "Function and operation"],
  ["PA.VIII.B.K1d", "Proper instrument cross-check techniques"],
  [
    "PA.VIII.B.R1",
    "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
  ],
  ["PA.VIII.B.R2", "When to seek assistance or declare an emergency in a deteriorating situation."],
  ["PA.VIII.B.R3", "Collision hazards."],
  ["PA.VIII.B.R4", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.VIII.B.R5", "Fixation and omission."],
  ["PA.VIII.B.R6", "Instrument Interpretation."],
  ["PA.VIII.B.R7", "Control application solely by reference to instruments."],
  ["PA.VIII.B.R8", "Trimming the aircraft."],
  [
    "PA.VIII.B.S1",
    "Transition to the climb pitch attitude and power setting on an assigned heading using proper instrument cross-check and interpretation, and coordinated flight control application.",
  ],
  ["PA.VIII.B.S2", "Climb at a constant airspeed to specific altitudes in straight flight and turns."],
  [
    "PA.VIII.B.S3",
    "Level off at the assigned altitude and maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
  ],
] as const;

/** All 16 current PA.VIII.B codes from FAA-S-ACS-6C pages 46–47. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES: readonly CurrentAreaVIIITaskBAktrCode[] =
  currentAreaVIIITaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VIII",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE,
  }));

export type CurrentAreaVIIITaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaVIIITaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VIII.B slice.
 * Anything outside these 16 current entries remains unresolved.
 */
export function resolveCurrentAreaVIIITaskBAktrCode(
  code: string,
): CurrentAreaVIIITaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
