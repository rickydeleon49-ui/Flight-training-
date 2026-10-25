/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task A (Normal Takeoff and Climb).
 *
 * Source: FAA-S-ACS-6C, printed pages 18–19 / PDF pages 26–27.
 *
 * This is an explicit partial slice limited to PA.IV.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "18–19",
  pdfPages: "26–27",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task A. Normal Takeoff and Climb",
  coverageLabel: "PA.IV.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE;
}

const currentAreaIVTaskAEntries = [
  ["PA.IV.A.K1", "Effects of atmospheric conditions, including wind, on takeoff and climb performance."],
  ["PA.IV.A.K2", "Best angle of climb speed (VX) and best rate of climb speed (VY)."],
  ["PA.IV.A.K3", "Appropriate airplane configuration."],
  ["PA.IV.A.R1", "Selection of runway or takeoff path based on aircraft performance and limitations, available distance, and wind."],
  ["PA.IV.A.R2", "Effects of:"],
  ["PA.IV.A.R2a", "Crosswind"],
  ["PA.IV.A.R2b", "Windshear"],
  ["PA.IV.A.R2c", "Tailwind"],
  ["PA.IV.A.R2d", "Wake turbulence"],
  ["PA.IV.A.R2e", "Takeoff surface/condition"],
  ["PA.IV.A.R3", "Abnormal operations, including planning for:"],
  ["PA.IV.A.R3a", "Rejected takeoff"],
  ["PA.IV.A.R3b", "Potential engine failure in takeoff/climb phase of flight"],
  ["PA.IV.A.R4", "Collision hazards."],
  ["PA.IV.A.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.A.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.A.R7", "Runway incursion."],
  ["PA.IV.A.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.A.S2", "Make radio calls as appropriate."],
  ["PA.IV.A.S3", "Verify assigned/correct runway or takeoff path."],
  ["PA.IV.A.S4", "Determine wind direction with or without visible wind direction indicators."],
  ["PA.IV.A.S5", "Position the flight controls for the existing wind, if applicable."],
  ["PA.IV.A.S6", "Clear the area, taxi into takeoff position, and align the airplane on the runway centerline (ASEL, AMEL) or takeoff path (ASES, AMES)."],
  ["PA.IV.A.S6a", "Retract the water rudders, as appropriate (ASES, AMES)"],
  ["PA.IV.A.S7", "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation."],
  ["PA.IV.A.S7a", "Establish and maintain the most efficient planing/lift-off attitude, and correct for porpoising or skipping (ASES, AMES)"],
  ["PA.IV.A.S8", "Avoid excessive water spray on the propeller(s) (ASES, AMES)."],
  ["PA.IV.A.S9", "Rotate and lift off at the recommended airspeed and accelerate to VY."],
  ["PA.IV.A.S11", "Establish a pitch attitude to maintain the manufacturer’s recommended speed or VY, +10/-5 knots."],
  ["PA.IV.A.S12", "Configure the airplane in accordance with manufacturer’s guidance."],
  ["PA.IV.A.S13", "Maintain VY +10/-5 knots to a safe maneuvering altitude."],
  ["PA.IV.A.S14", "Maintain directional control and proper wind-drift correction throughout takeoff and climb."],
  ["PA.IV.A.S15", "Comply with noise abatement procedures, as applicable."],
] as const;

/** All 33 current PA.IV.A codes from FAA-S-ACS-6C pages 18–19. Archived S10 excluded. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES: readonly CurrentAreaIVTaskAAktrCode[] =
  currentAreaIVTaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE,
  }));

export type CurrentAreaIVTaskACodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.A slice.
 * Anything outside these 33 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskAAktrCode(
  code: string,
): CurrentAreaIVTaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
