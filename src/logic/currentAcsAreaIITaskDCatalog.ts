/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation II (Preflight Procedures), Task D (Taxiing, ASEL/AMEL).
 *
 * Source: FAA-S-ACS-6C, printed page 13 / PDF page 21.
 *
 * This is an explicit partial slice limited to PA.II.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPage: 13,
  pdfPage: 21,
  areaOfOperation: "Area of Operation II: Preflight Procedures",
  task: "Task D. Taxiing (ASEL, AMEL)",
  coverageLabel: "PA.II.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIITaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "II";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE;
}

const currentAreaIITaskDEntries = [
  [
    "PA.II.D.K1",
    "Current airport aeronautical references and information resources such as the Chart Supplement, airport diagram, and Notices to Air Missions (NOTAMs).",
  ],
  ["PA.II.D.K2", "Taxi instructions/clearances."],
  ["PA.II.D.K3", "Airport markings, signs, and lights."],
  ["PA.II.D.K4", "Visual indicators for wind."],
  ["PA.II.D.K5", "Aircraft lighting, as appropriate."],
  ["PA.II.D.K6", "Procedures for:"],
  [
    "PA.II.D.K6a",
    "Appropriate flight deck activities prior to taxi, including route planning and identifying the location of Hot Spots",
  ],
  [
    "PA.II.D.K6b",
    "Radio communications at towered and nontowered airports",
  ],
  ["PA.II.D.K6c", "Entering or crossing runways"],
  ["PA.II.D.K6d", "Night taxi operations"],
  ["PA.II.D.K6e", "Low visibility taxi operations"],
  ["PA.II.D.R1", "Activities and distractions."],
  [
    "PA.II.D.R2",
    "Confirmation or expectation bias as related to taxi instructions.",
  ],
  ["PA.II.D.R3", "A taxi route or departure runway change."],
  ["PA.II.D.R4", "Runway incursion."],
  [
    "PA.II.D.S1",
    "Receive and correctly read back clearances/instructions, if applicable.",
  ],
  [
    "PA.II.D.S2",
    "Use an airport diagram or taxi chart during taxi, if published, and maintain situational awareness.",
  ],
  ["PA.II.D.S3", "Position the flight controls for the existing wind, if applicable."],
  ["PA.II.D.S4", "Complete the appropriate checklist(s)."],
  ["PA.II.D.S5", "Perform a brake check immediately after the airplane begins moving."],
  [
    "PA.II.D.S6",
    "Maintain positive control of the airplane during ground operations by controlling direction and speed without excessive use of brakes.",
  ],
  [
    "PA.II.D.S7",
    "Comply with airport/taxiway markings, signals, and air traffic control (ATC) clearances and instructions.",
  ],
  ["PA.II.D.S8", "Position the airplane properly relative to hold lines."],
] as const;

/** All 23 current PA.II.D codes from FAA-S-ACS-6C page 13. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES: readonly CurrentAreaIITaskDAktrCode[] =
  currentAreaIITaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "II",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE,
  }));

export type CurrentAreaIITaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaIITaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.II.D slice.
 * Anything outside these 23 current entries remains unresolved.
 */
export function resolveCurrentAreaIITaskDAktrCode(code: string): CurrentAreaIITaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
