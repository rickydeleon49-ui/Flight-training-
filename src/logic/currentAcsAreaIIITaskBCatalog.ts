/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation III (Airport and Seaplane Base Operations), Task B (Traffic Patterns).
 *
 * Source: FAA-S-ACS-6C, printed pages 16–17 / PDF pages 24–25.
 *
 * This is an explicit partial slice limited to PA.III.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "16–17",
  pdfPages: "24–25",
  areaOfOperation: "Area of Operation III: Airport and Seaplane Base Operations",
  task: "Task B. Traffic Patterns",
  coverageLabel: "PA.III.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIIITaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "III";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE;
}

const currentAreaIIITaskBEntries = [
  ["PA.III.B.K1", "Towered and nontowered airport operations."],
  ["PA.III.B.K2", "Traffic pattern selection for the current conditions."],
  ["PA.III.B.K3", "Right-of-way rules."],
  ["PA.III.B.K4", "Use of automated weather and airport information."],
  ["PA.III.B.R1", "Collision hazards."],
  [
    "PA.III.B.R2",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.III.B.R3", "Windshear and wake turbulence."],
  [
    "PA.III.B.S1",
    "Identify and interpret airport/seaplane base runways, taxiways, markings, signs, and lighting.",
  ],
  ["PA.III.B.S2", "Comply with recommended traffic pattern procedures."],
  ["PA.III.B.S3", "Correct for wind drift to maintain the proper ground track."],
  ["PA.III.B.S4", "Maintain orientation with the runway/landing area in use."],
  [
    "PA.III.B.S5",
    "Maintain traffic pattern altitude, ±100 feet, and the appropriate airspeed, ±10 knots.",
  ],
  [
    "PA.III.B.S6",
    "Maintain situational awareness and proper spacing from other aircraft in the traffic pattern.",
  ],
] as const;

/** All 13 current PA.III.B codes from FAA-S-ACS-6C pages 16–17. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES: readonly CurrentAreaIIITaskBAktrCode[] =
  currentAreaIIITaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "III",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE,
  }));

export type CurrentAreaIIITaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaIIITaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.III.B slice.
 * Anything outside these 13 current entries remains unresolved.
 */
export function resolveCurrentAreaIIITaskBAktrCode(
  code: string,
): CurrentAreaIIITaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
