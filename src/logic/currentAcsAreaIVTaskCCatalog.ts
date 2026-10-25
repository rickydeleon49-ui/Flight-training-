/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task C (Soft-Field Takeoff and Climb (ASEL)).
 *
 * Source: FAA-S-ACS-6C, printed pages 20–21 / PDF pages 28–29.
 *
 * This is an explicit partial slice limited to PA.IV.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "20–21",
  pdfPages: "28–29",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task C. Soft-Field Takeoff and Climb (ASEL)",
  coverageLabel: "PA.IV.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE;
}

const currentAreaIVTaskCEntries = [
  ["PA.IV.C.K1", "Effects of atmospheric conditions, including wind, on takeoff and climb performance."],
  ["PA.IV.C.K2", "Best angle of climb speed (VX) and best rate of climb speed (VY)."],
  ["PA.IV.C.K3", "Appropriate airplane configuration."],
  ["PA.IV.C.K4", "Ground effect."],
  ["PA.IV.C.K5", "Importance of weight transfer from wheels to wings."],
  ["PA.IV.C.K6", "Left turning tendencies."],
  ["PA.IV.C.R1", "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.C.R2", "Effects of:"],
  ["PA.IV.C.R2a", "Crosswind"],
  ["PA.IV.C.R2b", "Windshear"],
  ["PA.IV.C.R2c", "Tailwind"],
  ["PA.IV.C.R2d", "Wake turbulence"],
  ["PA.IV.C.R2e", "Takeoff surface/condition"],
  ["PA.IV.C.R3", "Abnormal operations, including planning for:"],
  ["PA.IV.C.R3a", "Rejected takeoff"],
  ["PA.IV.C.R3b", "Potential engine failure in takeoff/climb phase of flight"],
  ["PA.IV.C.R4", "Collision hazards."],
  ["PA.IV.C.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.C.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.C.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.C.S2", "Make radio calls as appropriate."],
  ["PA.IV.C.S3", "Verify assigned/correct runway."],
  ["PA.IV.C.S4", "Determine wind direction with or without visible wind direction indicators."],
  ["PA.IV.C.S5", "Position the flight controls for the existing wind, if applicable."],
  ["PA.IV.C.S6", "Clear the area, maintain necessary flight control inputs, taxi into takeoff position and align the airplane on the runway centerline without stopping, while advancing the throttle smoothly to takeoff power."],
  ["PA.IV.C.S7", "Confirm takeoff power and proper engine and flight instrument indications."],
  ["PA.IV.C.S8", "Establish and maintain a pitch attitude that transfers the weight of the airplane from the wheels to the wings as rapidly as possible."],
  ["PA.IV.C.S9", "Lift off at the lowest possible airspeed and remain in ground effect while accelerating to VX or VY, as appropriate."],
  ["PA.IV.C.S10", "Establish a pitch attitude for VX or VY, as appropriate, and maintain selected airspeed +10/-5 knots during the climb."],
] as const;

/** All 29 current PA.IV.C codes from FAA-S-ACS-6C pages 20–21. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES: readonly CurrentAreaIVTaskCAktrCode[] =
  currentAreaIVTaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE,
  }));

export type CurrentAreaIVTaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.C slice.
 * Anything outside these 29 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskCAktrCode(
  code: string,
): CurrentAreaIVTaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
