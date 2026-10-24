/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation X (Multiengine Operations), Task B (VMC Demonstration (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 60–61 / PDF pages 67–68.
 *
 * This is an explicit partial slice limited to PA.X.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "60–61",
  pdfPages: "67–68",
  areaOfOperation: "Area of Operation X: Multiengine Operations",
  task: "Task B. VMC Demonstration (AMEL, AMES)",
  coverageLabel: "PA.X.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXTaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "X";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_B_SOURCE;
}

const currentAreaXTaskBEntries = [
  ["PA.X.B.K1", "Factors affecting VMC and how VMC differs from stall speed (VS)."],
  [
    "PA.X.B.K2",
    "VMC (red line), VYSE (blue line), and safe single-engine speed (VSSE).",
  ],
  ["PA.X.B.K3", "Cause of loss of directional control at airspeeds below VMC."],
  ["PA.X.B.K4", "Proper procedures for maneuver entry and safe recovery."],
  ["PA.X.B.R1", "Configuring the airplane."],
  ["PA.X.B.R2", "Maneuvering with one engine inoperative."],
  [
    "PA.X.B.R3",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.X.B.S1",
    "Configure the airplane in accordance with the manufacturer’s recommendations, in the absence of the manufacturer’s recommendations, then at safe single-engine speed (VSSE/VYSE), as appropriate, and:",
  ],
  ["PA.X.B.S1a", "Landing gear retracted"],
  ["PA.X.B.S1b", "Flaps set for takeoff"],
  ["PA.X.B.S1c", "Cowl flaps set for takeoff"],
  ["PA.X.B.S1d", "Trim set for takeoff"],
  ["PA.X.B.S1e", "Propellers set for high revolutions per minute (rpm)"],
  ["PA.X.B.S1f", "Power on critical engine reduced to idle and propeller windmilling"],
  ["PA.X.B.S1g", "Power on operating engine set to takeoff or maximum available power"],
  [
    "PA.X.B.S2",
    "Establish a single-engine climb attitude with the airspeed at approximately 10 knots above VSSE.",
  ],
  [
    "PA.X.B.S3",
    "Establish a bank angle not to exceed 5° toward the operating engine, as required for best performance and controllability.",
  ],
  [
    "PA.X.B.S4",
    "Increase the pitch attitude slowly to reduce the airspeed at approximately 1 knot per second while applying increased rudder pressure as needed to maintain directional control.",
  ],
  [
    "PA.X.B.S5",
    "Recognize and recover at the first indication of loss of directional control, stall warning, or buffet.",
  ],
  [
    "PA.X.B.S6",
    "Recover promptly by simultaneously reducing power sufficiently on the operating engine, decreasing the angle of attack as necessary to regain airspeed and directional control, and without adding power on the simulated failed engine.",
  ],
  ["PA.X.B.S7", "Recover within 20° of entry heading."],
  [
    "PA.X.B.S8",
    "Advance power smoothly on the operating engine and accelerate to VSSE/VYSE, as appropriate, +10/-5 knots during recovery.",
  ],
] as const;

/** All 22 current PA.X.B codes from FAA-S-ACS-6C pages 60–61. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES: readonly CurrentAreaXTaskBAktrCode[] =
  currentAreaXTaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "X",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_B_SOURCE,
  }));

export type CurrentAreaXTaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaXTaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.X.B slice.
 * Anything outside these 22 current entries remains unresolved.
 */
export function resolveCurrentAreaXTaskBAktrCode(
  code: string,
): CurrentAreaXTaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
