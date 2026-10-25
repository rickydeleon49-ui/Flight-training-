/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task N (Go-Around/Rejected Landing).
 *
 * Source: FAA-S-ACS-6C, printed page 35 / PDF page 43.
 *
 * This is an explicit partial slice limited to PA.IV.N, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_N_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "35",
  pdfPages: "43",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task N. Go-Around/Rejected Landing",
  coverageLabel: "PA.IV.N",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskNAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "N";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_N_SOURCE;
}

const currentAreaIVTaskNEntries = [
  ["PA.IV.N.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.N.K2", "Effects of atmospheric conditions, including wind and density altitude, on a go-around or rejected landing."],
  ["PA.IV.N.K3", "Wind correction techniques on takeoff/departure and approach/landing."],
  ["PA.IV.N.R1", "Delayed recognition of the need for a go-around/rejected landing."],
  ["PA.IV.N.R2", "Delayed performance of a go-around at low altitude."],
  ["PA.IV.N.R3", "Power application."],
  ["PA.IV.N.R4", "Configuring the airplane."],
  ["PA.IV.N.R5", "Collision hazards."],
  ["PA.IV.N.R6", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.N.R7", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.N.R8", "Runway incursion."],
  ["PA.IV.N.R9", "Managing a go-around/rejected landing after accepting a LAHSO clearance."],
  ["PA.IV.N.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.N.S2", "Make radio calls as appropriate."],
  ["PA.IV.N.S3", "Make a timely decision to discontinue the approach to landing."],
  ["PA.IV.N.S4", "Apply takeoff power immediately and transition to climb pitch attitude for VX or VY as appropriate +10/-5 knots."],
  ["PA.IV.N.S5", "Configure the airplane after a positive rate of climb has been verified or in accordance with airplane manufacturer’s instructions."],
  ["PA.IV.N.S6", "Maneuver to the side of the runway/landing area when necessary to clear and avoid conflicting traffic."],
  ["PA.IV.N.S7", "Maintain VY +10/-5 knots to a safe maneuvering altitude."],
  ["PA.IV.N.S8", "Maintain directional control and proper wind-drift correction throughout the climb."],
  ["PA.IV.N.S9", "Use runway incursion avoidance procedures, if applicable."],
] as const;

/** All 21 current PA.IV.N codes from FAA-S-ACS-6C page 35. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES: readonly CurrentAreaIVTaskNAktrCode[] =
  currentAreaIVTaskNEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "N",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_N_SOURCE,
  }));

export type CurrentAreaIVTaskNCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskNAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.N slice.
 * Anything outside these 21 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskNAktrCode(
  code: string,
): CurrentAreaIVTaskNCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
