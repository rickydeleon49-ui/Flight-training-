/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task L (Rough Water Approach and Landing (ASES, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 32–33 / PDF pages 40–41.
 *
 * This is an explicit partial slice limited to PA.IV.L, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_L_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "32–33",
  pdfPages: "40–41",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task L. Rough Water Approach and Landing (ASES, AMES)",
  coverageLabel: "PA.IV.L",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskLAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "L";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_L_SOURCE;
}

const currentAreaIVTaskLEntries = [
  ["PA.IV.L.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.L.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.L.K3", "Wind correction techniques on approach and landing."],
  ["PA.IV.L.K4", "When and why rough water techniques are used."],
  ["PA.IV.L.K5", "How to perform a proper rough water approach and landing."],
  ["PA.IV.L.R1", "Selection of approach path and touchdown area based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.L.R2", "Effects of:"],
  ["PA.IV.L.R2a", "Crosswind"],
  ["PA.IV.L.R2b", "Windshear"],
  ["PA.IV.L.R2c", "Tailwind"],
  ["PA.IV.L.R2d", "Wake turbulence"],
  ["PA.IV.L.R2e", "Water surface/condition"],
  ["PA.IV.L.R3", "Planning for a go-around and rejected landing."],
  ["PA.IV.L.R4", "Collision hazards."],
  ["PA.IV.L.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.L.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.L.R7", "Gear position in an amphibious airplane."],
  ["PA.IV.L.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.L.S2", "Make radio calls as appropriate."],
  ["PA.IV.L.S3", "Ensure the airplane is aligned with the correct/assigned waterway."],
  ["PA.IV.L.S4", "Scan the landing area for traffic and obstructions."],
  ["PA.IV.L.S5", "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions."],
  ["PA.IV.L.S6", "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach."],
  ["PA.IV.L.S7", "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied."],
  ["PA.IV.L.S8", "Maintain directional control and appropriate crosswind correction throughout the approach and landing."],
  ["PA.IV.L.S9", "Make smooth, timely, and correct power and control adjustments to maintain proper pitch attitude and rate of descent to touchdown."],
  ["PA.IV.L.S10", "Contact the water in a proper pitch attitude, considering the type of rough water."],
] as const;

/** All 27 current PA.IV.L codes from FAA-S-ACS-6C pages 32–33. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES: readonly CurrentAreaIVTaskLAktrCode[] =
  currentAreaIVTaskLEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "L",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_L_SOURCE,
  }));

export type CurrentAreaIVTaskLCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskLAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.L slice.
 * Anything outside these 27 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskLAktrCode(
  code: string,
): CurrentAreaIVTaskLCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
