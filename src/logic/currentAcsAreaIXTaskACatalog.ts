/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task A (Emergency Descent).
 *
 * Source: FAA-S-ACS-6C, printed pages 51–52 / PDF pages 58–59.
 *
 * This is an explicit partial slice limited to PA.IX.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "51–52",
  pdfPages: "58–59",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task A. Emergency Descent",
  coverageLabel: "PA.IX.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE;
}

const currentAreaIXTaskAEntries = [
  [
    "PA.IX.A.K1",
    "Situations that would require an emergency descent (e.g., depressurization, smoke, or engine fire).",
  ],
  ["PA.IX.A.K2", "Immediate action items and emergency procedures."],
  ["PA.IX.A.K3", "Airspeed, including airspeed limitations."],
  ["PA.IX.A.K4", "Aircraft performance and limitations."],
  [
    "PA.IX.A.R1",
    "Altitude, wind, terrain, obstructions, gliding distance, and available landing distance considerations.",
  ],
  ["PA.IX.A.R2", "Collision hazards."],
  ["PA.IX.A.R3", "Configuring the airplane."],
  [
    "PA.IX.A.R4",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.IX.A.S1", "Clear the area."],
  [
    "PA.IX.A.S2",
    "Establish and maintain the appropriate airspeed and configuration appropriate to the scenario specified by the evaluator and as covered in Pilot's Operating Handbook (POH)/Airplane Flight Manual (AFM) for the emergency descent.",
  ],
  [
    "PA.IX.A.S3",
    "Maintain orientation, divide attention appropriately, and plan and execute a smooth recovery.",
  ],
  [
    "PA.IX.A.S4",
    "Use bank angle between 30° and 45° to maintain positive load factors during the descent.",
  ],
  [
    "PA.IX.A.S5",
    "Maintain appropriate airspeed +0/-10 knots, and level off at a specified altitude ±100 feet.",
  ],
  ["PA.IX.A.S6", "Complete the appropriate checklist(s)."],
  ["PA.IX.A.S7", "Make radio calls as appropriate."],
  [
    "PA.IX.A.S8",
    "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  ],
] as const;

/** All 16 current PA.IX.A codes from FAA-S-ACS-6C pages 51–52. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES: readonly CurrentAreaIXTaskAAktrCode[] =
  currentAreaIXTaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE,
  }));

export type CurrentAreaIXTaskACodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.A slice.
 * Anything outside these 16 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskAAktrCode(
  code: string,
): CurrentAreaIXTaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
