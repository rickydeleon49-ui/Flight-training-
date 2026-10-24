/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task E (Short-Field Takeoff and Maximum Performance Climb (ASEL, AMEL)).
 *
 * Source: FAA-S-ACS-6C, printed pages 23–24 / PDF pages 31–32.
 *
 * This is an explicit partial slice limited to PA.IV.E, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "23–24",
  pdfPages: "31–32",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task E. Short-Field Takeoff and Maximum Performance Climb (ASEL, AMEL)",
  coverageLabel: "PA.IV.E",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskEAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "E";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE;
}

const currentAreaIVTaskEEntries = [
  ["PA.IV.E.K1", "Effects of atmospheric conditions, including wind, on takeoff and climb performance."],
  ["PA.IV.E.K2", "Best angle of climb speed (VX) and best rate of climb speed (VY)."],
  ["PA.IV.E.K3", "Appropriate airplane configuration."],
  ["PA.IV.E.R1", "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.E.R2", "Effects of:"],
  ["PA.IV.E.R2a", "Crosswind"],
  ["PA.IV.E.R2b", "Windshear"],
  ["PA.IV.E.R2c", "Tailwind"],
  ["PA.IV.E.R2d", "Wake turbulence"],
  ["PA.IV.E.R2e", "Takeoff surface/condition"],
  ["PA.IV.E.R3", "Abnormal operations, including planning for:"],
  ["PA.IV.E.R3a", "Rejected takeoff"],
  ["PA.IV.E.R3b", "Potential engine failure in takeoff/climb phase of flight"],
  ["PA.IV.E.R4", "Collision hazards."],
  ["PA.IV.E.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.E.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.E.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.E.S2", "Make radio calls as appropriate."],
  ["PA.IV.E.S3", "Verify assigned/correct runway."],
  ["PA.IV.E.S4", "Determine wind direction with or without visible wind direction indicators."],
  ["PA.IV.E.S5", "Position the flight controls for the existing wind, if applicable."],
  ["PA.IV.E.S6", "Clear the area, taxi into takeoff position, and align the airplane on the runway centerline utilizing maximum available takeoff area."],
  ["PA.IV.E.S7", "Apply brakes while setting engine power to achieve maximum performance."],
  ["PA.IV.E.S8", "Confirm takeoff power prior to brake release and verify proper engine and flight instrument indications prior to rotation."],
  ["PA.IV.E.S9", "Rotate and lift off at the recommended airspeed and accelerate to the recommended obstacle clearance airspeed or VX, +10/-5 knots."],
  ["PA.IV.E.S10", "Establish a pitch attitude to maintain the recommended obstacle clearance airspeed or VX, +10/-5 knots until the obstacle is cleared or until the airplane is 50 feet above the surface."],
  ["PA.IV.E.S11", "Establish a pitch attitude for VY and accelerate to VY +10/-5 knots after clearing the obstacle or at 50 feet AGL if simulating an obstacle."],
  ["PA.IV.E.S12", "Configure the airplane in accordance with the manufacturer’s guidance after a positive rate of climb has been verified."],
  ["PA.IV.E.S13", "Maintain VY +10/-5 knots to a safe maneuvering altitude."],
  ["PA.IV.E.S14", "Maintain directional control and proper wind-drift correction throughout takeoff and climb."],
  ["PA.IV.E.S15", "Comply with noise abatement procedures, as applicable."],
] as const;

/** All 31 current PA.IV.E codes from FAA-S-ACS-6C pages 23–24. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES: readonly CurrentAreaIVTaskEAktrCode[] =
  currentAreaIVTaskEEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "E",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE,
  }));

export type CurrentAreaIVTaskECodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskEAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.E slice.
 * Anything outside these 31 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskEAktrCode(
  code: string,
): CurrentAreaIVTaskECodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
