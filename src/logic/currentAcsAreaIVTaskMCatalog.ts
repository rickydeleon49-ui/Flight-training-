/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task M (Forward Slip to a Landing (ASEL, ASES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 33–34 / PDF pages 41–42.
 *
 * This is an explicit partial slice limited to PA.IV.M, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_M_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "33–34",
  pdfPages: "41–42",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task M. Forward Slip to a Landing (ASEL, ASES)",
  coverageLabel: "PA.IV.M",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskMAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "M";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_M_SOURCE;
}

const currentAreaIVTaskMEntries = [
  ["PA.IV.M.K1", "Concepts of energy management during a forward slip approach."],
  ["PA.IV.M.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.M.K3", "Wind correction techniques during forward slip."],
  ["PA.IV.M.K4", "When and why a forward slip approach is used during an approach."],
  ["PA.IV.M.R1", "Selection of runway/landing surface, approach path, and touchdown area based on pilot capability, aircraft performance and limitations, available distance, and wind."],
  ["PA.IV.M.R2", "Effects of:"],
  ["PA.IV.M.R2a", "Crosswind"],
  ["PA.IV.M.R2b", "Windshear"],
  ["PA.IV.M.R2c", "Tailwind"],
  ["PA.IV.M.R2d", "Wake turbulence"],
  ["PA.IV.M.R2e", "Landing surface/condition"],
  ["PA.IV.M.R3", "Planning for:"],
  ["PA.IV.M.R3a", "Rejected landing and go-around"],
  ["PA.IV.M.R3b", "Land and hold short operations (LAHSO)"],
  ["PA.IV.M.R4", "Collision hazards."],
  ["PA.IV.M.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.M.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.M.R7", "Forward slip operations, including fuel flowage, tail stalls with flaps, and airspeed control."],
  ["PA.IV.M.R8", "Surface contact with the airplane’s longitudinal axis misaligned."],
  ["PA.IV.M.R9", "Unstable approach."],
  ["PA.IV.M.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.M.S2", "Make radio calls as appropriate."],
  ["PA.IV.M.S3", "Plan and follow a flightpath to the selected landing area considering altitude, wind, terrain, and obstructions."],
  ["PA.IV.M.S4", "Select the most suitable touchdown point based on wind, landing surface, obstructions, and airplane limitations."],
  ["PA.IV.M.S5", "Position airplane on downwind leg, parallel to landing runway or selected landing surface."],
  ["PA.IV.M.S6", "Configure the airplane correctly."],
  ["PA.IV.M.S7", "As necessary, correlate crosswind with direction of forward slip and transition to side slip before touchdown."],
  ["PA.IV.M.S8", "Touch down at a proper pitch attitude, within 400 feet beyond or on the specified point, with no side drift, and with the airplane’s longitudinal axis aligned with and over the runway center/landing path."],
  ["PA.IV.M.S9", "Maintain a ground track aligned with the runway center/landing path."],
] as const;

/** All 29 current PA.IV.M codes from FAA-S-ACS-6C pages 33–34. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES: readonly CurrentAreaIVTaskMAktrCode[] =
  currentAreaIVTaskMEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "M",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_M_SOURCE,
  }));

export type CurrentAreaIVTaskMCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskMAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.M slice.
 * Anything outside these 29 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskMAktrCode(
  code: string,
): CurrentAreaIVTaskMCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
