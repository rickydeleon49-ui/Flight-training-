/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task I (Glassy Water Takeoff and Climb (ASES, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 28–29 / PDF pages 36–37.
 *
 * This is an explicit partial slice limited to PA.IV.I, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_I_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "28–29",
  pdfPages: "36–37",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task I. Glassy Water Takeoff and Climb (ASES, AMES)",
  coverageLabel: "PA.IV.I",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskIAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "I";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_I_SOURCE;
}

const currentAreaIVTaskIEntries = [
  ["PA.IV.I.K1", "Effects of atmospheric conditions, including wind, on takeoff and climb performance."],
  ["PA.IV.I.K2", "Best angle of climb speed (VX) and best rate of climb speed (VY)."],
  ["PA.IV.I.K3", "Appropriate airplane configuration."],
  ["PA.IV.I.K4", "Appropriate use of glassy water takeoff and climb technique."],
  ["PA.IV.I.R1", "Selection of takeoff path based on pilot capability, airplane performance and limitations, and available distance."],
  ["PA.IV.I.R2", "Water surface/condition."],
  ["PA.IV.I.R3", "Abnormal operations, including planning for:"],
  ["PA.IV.I.R3a", "Rejected takeoff"],
  ["PA.IV.I.R3b", "Potential engine failure in takeoff/climb phase of flight"],
  ["PA.IV.I.R4", "Collision hazards."],
  ["PA.IV.I.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.I.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.I.R7", "Gear position in an amphibious airplane."],
  ["PA.IV.I.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.I.S2", "Make radio calls as appropriate."],
  ["PA.IV.I.S3", "Position flight controls and configure the aircraft for the existing conditions."],
  ["PA.IV.I.S4", "Clear the area, select appropriate takeoff path considering surface hazards or vessels and surface conditions:"],
  ["PA.IV.I.S4a", "Retract the water rudders, as appropriate"],
  ["PA.IV.I.S4b", "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation"],
  ["PA.IV.I.S6", "Establish and maintain an appropriate planing attitude, directional control, and correct for porpoising, skipping, and increase in water drag."],
  ["PA.IV.I.S7", "Avoid excessive water spray on the propeller(s)."],
  ["PA.IV.I.S8", "Use appropriate techniques to lift seaplane from the water considering surface conditions."],
  ["PA.IV.I.S9", "Establish proper attitude/airspeed and accelerate to VY +10/-5 knots during the climb."],
  ["PA.IV.I.S10", "Configure the airplane after a positive rate of climb has been verified or in accordance with airplane manufacturer’s instructions."],
  ["PA.IV.I.S11", "Maintain VY +10/-5 knots to a safe maneuvering altitude."],
  ["PA.IV.I.S12", "Maintain directional control throughout takeoff and climb."],
] as const;

/** All 26 current PA.IV.I codes from FAA-S-ACS-6C pages 28–29. Archived S5 is excluded. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES: readonly CurrentAreaIVTaskIAktrCode[] =
  currentAreaIVTaskIEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "I",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_I_SOURCE,
  }));

export type CurrentAreaIVTaskICodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskIAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.I slice.
 * Anything outside these 26 current entries (including archived PA.IV.I.S5) remains unresolved.
 */
export function resolveCurrentAreaIVTaskIAktrCode(
  code: string,
): CurrentAreaIVTaskICodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
