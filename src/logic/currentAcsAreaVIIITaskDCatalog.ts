/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VIII (Basic Instrument Maneuvers), Task D (Turns to Headings).
 *
 * Source: FAA-S-ACS-6C, printed pages 48–49 / PDF pages 56–57.
 *
 * This is an explicit partial slice limited to PA.VIII.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "48–49",
  pdfPages: "56–57",
  areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
  task: "Task D. Turns to Headings",
  coverageLabel: "PA.VIII.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIIITaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VIII";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE;
}

const currentAreaVIIITaskDEntries = [
  ["PA.VIII.D.K1", "Flight instruments as they relate to:"],
  ["PA.VIII.D.K1a", "Instrument limitations and potential errors"],
  ["PA.VIII.D.K1b", "Indication of the aircraft attitude"],
  ["PA.VIII.D.K1c", "Function and operation"],
  ["PA.VIII.D.K1d", "Proper instrument cross-check techniques"],
  [
    "PA.VIII.D.R1",
    "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
  ],
  ["PA.VIII.D.R2", "When to seek assistance or declare an emergency in a deteriorating situation."],
  ["PA.VIII.D.R3", "Collision hazards."],
  ["PA.VIII.D.R4", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.VIII.D.R5", "Fixation and omission."],
  ["PA.VIII.D.R6", "Instrument Interpretation."],
  ["PA.VIII.D.R7", "Control application solely by reference to instruments."],
  ["PA.VIII.D.R8", "Trimming the aircraft."],
  [
    "PA.VIII.D.S1",
    "Turn to headings, maintain altitude ±200 feet, maintain a standard rate turn, roll out on the assigned heading ±10°, and maintain airspeed ±10 knots.",
  ],
] as const;

/** All 14 current PA.VIII.D codes from FAA-S-ACS-6C pages 48–49. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES: readonly CurrentAreaVIIITaskDAktrCode[] =
  currentAreaVIIITaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VIII",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE,
  }));

export type CurrentAreaVIIITaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaVIIITaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VIII.D slice.
 * Anything outside these 14 current entries remains unresolved.
 */
export function resolveCurrentAreaVIIITaskDAktrCode(
  code: string,
): CurrentAreaVIIITaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
