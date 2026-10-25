/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task K (Rough Water Takeoff and Climb (ASES, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 31–32 / PDF pages 39–40.
 *
 * This is an explicit partial slice limited to PA.IV.K, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_K_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "31–32",
  pdfPages: "39–40",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task K. Rough Water Takeoff and Climb (ASES, AMES)",
  coverageLabel: "PA.IV.K",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskKAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "K";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_K_SOURCE;
}

const currentAreaIVTaskKEntries = [
  ["PA.IV.K.K1", "Effects of atmospheric conditions, including wind, on takeoff and climb performance."],
  ["PA.IV.K.K2", "Best angle of climb speed (VX) and best rate of climb speed (VY)."],
  ["PA.IV.K.K3", "Appropriate airplane configuration."],
  ["PA.IV.K.K4", "Appropriate use of rough water takeoff and climb technique."],
  ["PA.IV.K.R1", "Selection of takeoff path based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.K.R2", "Effects of:"],
  ["PA.IV.K.R2a", "Crosswind"],
  ["PA.IV.K.R2b", "Windshear"],
  ["PA.IV.K.R2c", "Tailwind"],
  ["PA.IV.K.R2d", "Wake turbulence"],
  ["PA.IV.K.R2e", "Water surface/condition"],
  ["PA.IV.K.R3", "Abnormal operations, including planning for:"],
  ["PA.IV.K.R3a", "Rejected takeoff"],
  ["PA.IV.K.R3b", "Potential engine failure in takeoff/climb phase of flight"],
  ["PA.IV.K.R4", "Collision hazards."],
  ["PA.IV.K.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.K.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.K.R7", "Gear position in an amphibious airplane."],
  ["PA.IV.K.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.K.S2", "Make radio calls as appropriate."],
  ["PA.IV.K.S3", "Verify assigned/correct takeoff path."],
  ["PA.IV.K.S4", "Determine wind direction with or without visible wind direction indicators."],
  ["PA.IV.K.S5", "Position flight controls and configure the airplane for the existing conditions."],
  ["PA.IV.K.S6", "Clear the area, select an appropriate takeoff path considering wind, swells, surface hazards, or vessels."],
  ["PA.IV.K.S6a", "Retract the water rudders, as appropriate"],
  ["PA.IV.K.S6b", "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation"],
  ["PA.IV.K.S8", "Establish and maintain an appropriate planing attitude, directional control, and correct for porpoising, skipping, and increase in water drag."],
  ["PA.IV.K.S9", "Avoid excessive water spray on the propeller(s)."],
  ["PA.IV.K.S10", "Lift off at minimum airspeed and accelerate to VY +10/- 5 knots before leaving ground effect."],
  ["PA.IV.K.S11", "Configure the airplane after a positive rate of climb has been verified or in accordance with airplane manufacturer’s instructions."],
  ["PA.IV.K.S12", "Maintain VY +10/-5 knots to a safe maneuvering altitude."],
  ["PA.IV.K.S13", "Maintain directional control and proper wind-drift correction throughout takeoff and climb."],
] as const;

/** All 32 current PA.IV.K codes from FAA-S-ACS-6C pages 31–32. Archived S7 is excluded. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES: readonly CurrentAreaIVTaskKAktrCode[] =
  currentAreaIVTaskKEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "K",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_K_SOURCE,
  }));

export type CurrentAreaIVTaskKCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskKAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.K slice.
 * Anything outside these 32 current entries (including archived PA.IV.K.S7) remains unresolved.
 */
export function resolveCurrentAreaIVTaskKAktrCode(
  code: string,
): CurrentAreaIVTaskKCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
