/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task G (Confined Area Takeoff and Maximum Performance Climb (ASES, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 26–27 / PDF pages 34–35.
 *
 * This is an explicit partial slice limited to PA.IV.G, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "26–27",
  pdfPages: "34–35",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task G. Confined Area Takeoff and Maximum Performance Climb (ASES, AMES)",
  coverageLabel: "PA.IV.G",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskGAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "G";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE;
}

const currentAreaIVTaskGEntries = [
  ["PA.IV.G.K1", "Effects of atmospheric conditions, including wind, on takeoff and climb performance."],
  ["PA.IV.G.K2", "Best angle of climb speed (VX) and best rate of climb speed (VY)."],
  ["PA.IV.G.K3", "Appropriate airplane configuration."],
  ["PA.IV.G.K4", "Effects of water surface."],
  ["PA.IV.G.R1", "Selection of takeoff path based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.G.R2", "Effects of:"],
  ["PA.IV.G.R2a", "Crosswind"],
  ["PA.IV.G.R2b", "Windshear"],
  ["PA.IV.G.R2c", "Tailwind"],
  ["PA.IV.G.R2d", "Wake turbulence"],
  ["PA.IV.G.R2e", "Water surface/condition"],
  ["PA.IV.G.R3", "Abnormal operations, including planning for:"],
  ["PA.IV.G.R3a", "Rejected takeoff"],
  ["PA.IV.G.R3b", "Potential engine failure in takeoff/climb phase of flight"],
  ["PA.IV.G.R4", "Collision hazards."],
  ["PA.IV.G.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.G.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.G.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.G.S2", "Make radio calls as appropriate."],
  ["PA.IV.G.S3", "Verify assigned/correct takeoff path."],
  ["PA.IV.G.S4", "Determine wind direction with or without visible wind direction indicators."],
  ["PA.IV.G.S5", "Position the flight controls for the existing wind, if applicable."],
  ["PA.IV.G.S6", "Clear the area, taxi into takeoff position utilizing maximum available takeoff area, and align the airplane on the takeoff path."],
  ["PA.IV.G.S6a", "Retract the water rudders, as appropriate"],
  ["PA.IV.G.S7", "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation."],
  ["PA.IV.G.S8", "Establish a pitch attitude that maintains the most efficient planing/lift-off attitude and correct for porpoising and skipping."],
  ["PA.IV.G.S9", "Avoid excessive water spray on the propeller(s)."],
  ["PA.IV.G.S10", "Rotate and lift off at the recommended airspeed, and accelerate to the recommended obstacle clearance airspeed or VX."],
  ["PA.IV.G.S11", "Establish a pitch attitude to maintain the recommended obstacle clearance airspeed or VX, +10/-5 knots until the obstacle is cleared or until the airplane is 50 feet above the surface."],
  ["PA.IV.G.S12", "Establish a pitch attitude for VY and accelerate to VY +10/-5 knots after clearing the obstacle or at 50 feet AGL if simulating an obstacle."],
  ["PA.IV.G.S13", "Retract flaps, if extended, after a positive rate of climb has been verified or in accordance with airplane manufacturer’s guidance."],
  ["PA.IV.G.S14", "Maintain VY +10/-5 knots to a safe maneuvering altitude."],
  ["PA.IV.G.S15", "Maintain directional control and proper wind-drift correction throughout takeoff and climb."],
  ["PA.IV.G.S16", "Comply with noise abatement procedures, as applicable."],
] as const;

/** All 34 current PA.IV.G codes from FAA-S-ACS-6C pages 26–27. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES: readonly CurrentAreaIVTaskGAktrCode[] =
  currentAreaIVTaskGEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "G",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE,
  }));

export type CurrentAreaIVTaskGCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskGAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.G slice.
 * Anything outside these 34 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskGAktrCode(
  code: string,
): CurrentAreaIVTaskGCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
