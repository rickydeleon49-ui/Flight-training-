/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task B (Normal Approach and Landing).
 *
 * Source: FAA-S-ACS-6C, printed pages 19–20 / PDF pages 27–28.
 *
 * This is an explicit partial slice limited to PA.IV.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "19–20",
  pdfPages: "27–28",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task B. Normal Approach and Landing",
  coverageLabel: "PA.IV.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE;
}

const currentAreaIVTaskBEntries = [
  ["PA.IV.B.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.B.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.B.K3", "Wind correction techniques on approach and landing."],
  ["PA.IV.B.R1", "Selection of runway/landing surface, approach path, and touchdown area based on pilot capability, aircraft performance and limitations, available distance, and wind."],
  ["PA.IV.B.R2", "Effects of:"],
  ["PA.IV.B.R2a", "Crosswind"],
  ["PA.IV.B.R2b", "Windshear"],
  ["PA.IV.B.R2c", "Tailwind"],
  ["PA.IV.B.R2d", "Wake turbulence"],
  ["PA.IV.B.R2e", "Landing surface/condition"],
  ["PA.IV.B.R3", "Planning for:"],
  ["PA.IV.B.R3a", "Rejected landing and go-around"],
  ["PA.IV.B.R3b", "Land and hold short operations (LAHSO)"],
  ["PA.IV.B.R4", "Collision hazards."],
  ["PA.IV.B.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.B.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.B.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.B.S2", "Make radio calls as appropriate."],
  ["PA.IV.B.S3", "Ensure the airplane is aligned with the correct/assigned runway or landing surface."],
  ["PA.IV.B.S4", "Scan the runway or landing surface and adjoining area for traffic and obstructions."],
  ["PA.IV.B.S5", "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions."],
  ["PA.IV.B.S6", "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach."],
  ["PA.IV.B.S7", "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 times the stalling speed or the minimum steady flight speed in the landing configuration (VSO), +10/-5 knots with gust factor applied."],
  ["PA.IV.B.S8", "Maintain directional control and appropriate crosswind correction throughout the approach and landing."],
  ["PA.IV.B.S9", "Make smooth, timely, and correct control application during round out and touchdown."],
  ["PA.IV.B.S10", "Touch down at a proper pitch attitude, within 400 feet beyond or on the specified point, with no side drift, and with the airplane’s longitudinal axis aligned with and over the runway center/landing path."],
  ["PA.IV.B.S11", "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing."],
  ["PA.IV.B.S12", "Use runway incursion avoidance procedures, if applicable."],
] as const;

/** All 28 current PA.IV.B codes from FAA-S-ACS-6C pages 19–20. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES: readonly CurrentAreaIVTaskBAktrCode[] =
  currentAreaIVTaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE,
  }));

export type CurrentAreaIVTaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.B slice.
 * Anything outside these 28 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskBAktrCode(
  code: string,
): CurrentAreaIVTaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
