/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task B (Emergency Approach and Landing (Simulated) (ASEL, ASES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 52–53 / PDF pages 59–60.
 *
 * This is an explicit partial slice limited to PA.IX.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "52–53",
  pdfPages: "59–60",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task B. Emergency Approach and Landing (Simulated) (ASEL, ASES)",
  coverageLabel: "PA.IX.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE;
}

const currentAreaIXTaskBEntries = [
  ["PA.IX.B.K1", "Immediate action items and emergency procedures."],
  ["PA.IX.B.K2", "Airspeed, including:"],
  ["PA.IX.B.K2a", "Importance of best glide speed and its relationship to distance"],
  ["PA.IX.B.K2b", "Difference between best glide speed and minimum sink speed"],
  ["PA.IX.B.K2c", "Effects of wind on glide distance"],
  ["PA.IX.B.K3", "Effects of atmospheric conditions on emergency approach and landing."],
  ["PA.IX.B.K4", "A stabilized approach, including energy management concepts."],
  ["PA.IX.B.K5", "Emergency Locator Transmitters (ELTs) and other emergency locating devices."],
  ["PA.IX.B.K6", "Air traffic control (ATC) services to aircraft in distress."],
  [
    "PA.IX.B.R1",
    "Altitude, wind, terrain, obstructions, gliding distance, and available landing distance considerations.",
  ],
  ["PA.IX.B.R2", "Following or changing the planned flightpath to the selected landing area."],
  ["PA.IX.B.R3", "Collision hazards."],
  ["PA.IX.B.R4", "Configuring the airplane."],
  [
    "PA.IX.B.R5",
    "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
  ],
  [
    "PA.IX.B.R6",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.IX.B.S1", "Establish and maintain the recommended best glide airspeed, ±10 knots."],
  [
    "PA.IX.B.S2",
    "Configure the airplane in accordance with the Pilot's Operating Handbook (POH)/Airplane Flight Manual (AFM) and existing conditions.",
  ],
  [
    "PA.IX.B.S3",
    "Select a suitable landing area considering altitude, wind, terrain, obstructions, and available glide distance.",
  ],
  [
    "PA.IX.B.S4",
    "Plan and follow a flightpath to the selected landing area considering altitude, wind, terrain, and obstructions.",
  ],
  ["PA.IX.B.S5", "Prepare for landing as specified by the evaluator."],
  ["PA.IX.B.S6", "Complete the appropriate checklist(s)."],
] as const;

/** All 21 current PA.IX.B codes from FAA-S-ACS-6C pages 52–53. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES: readonly CurrentAreaIXTaskBAktrCode[] =
  currentAreaIXTaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE,
  }));

export type CurrentAreaIXTaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.B slice.
 * Anything outside these 21 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskBAktrCode(
  code: string,
): CurrentAreaIXTaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
