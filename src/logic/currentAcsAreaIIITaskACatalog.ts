/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation III (Airport and Seaplane Base Operations), Task A (Communications, Light Signals, and Runway Lighting Systems).
 *
 * Source: FAA-S-ACS-6C, printed page 16 / PDF page 24.
 *
 * This is an explicit partial slice limited to PA.III.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "16",
  pdfPages: "24",
  areaOfOperation: "Area of Operation III: Airport and Seaplane Base Operations",
  task: "Task A. Communications, Light Signals, and Runway Lighting Systems",
  coverageLabel: "PA.III.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIIITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "III";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE;
}

const currentAreaIIITaskAEntries = [
  ["PA.III.A.K1", "How to obtain appropriate radio frequencies."],
  [
    "PA.III.A.K2",
    "Proper radio communication procedures and air traffic control (ATC) phraseology.",
  ],
  ["PA.III.A.K3", "ATC light signal recognition."],
  ["PA.III.A.K4", "Appropriate use of transponder(s)."],
  ["PA.III.A.K5", "Lost communication procedures."],
  ["PA.III.A.K6", "Equipment issues that could cause loss of communication."],
  ["PA.III.A.K7", "Radar assistance."],
  [
    "PA.III.A.K8",
    "National Transportation Safety Board (NTSB) accident/incident reporting.",
  ],
  ["PA.III.A.K9", "Runway Status Lighting Systems."],
  ["PA.III.A.R1", "Communication."],
  ["PA.III.A.R2", "Deciding if and when to declare an emergency."],
  ["PA.III.A.R4", "Use of non-standard phraseology."],
  ["PA.III.A.S1", "Select and activate appropriate frequencies."],
  [
    "PA.III.A.S2",
    "Transmit using standard phraseology and procedures as specified in the Aeronautical Information Manual (AIM) and Pilot/Controller Glossary.",
  ],
  [
    "PA.III.A.S3",
    "Acknowledge radio communications and comply with ATC instructions or as directed by the evaluator.",
  ],
] as const;

/** All 15 current PA.III.A codes from FAA-S-ACS-6C page 16. Archived R3 excluded. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES: readonly CurrentAreaIIITaskAAktrCode[] =
  currentAreaIIITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "III",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE,
  }));

export type CurrentAreaIIITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaIIITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.III.A slice.
 * Anything outside these 15 current entries remains unresolved.
 */
export function resolveCurrentAreaIIITaskAAktrCode(
  code: string,
): CurrentAreaIIITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
