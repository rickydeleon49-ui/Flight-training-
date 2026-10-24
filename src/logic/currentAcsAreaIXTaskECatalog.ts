/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task E (Engine Failure During Takeoff Before VMC (Simulated) (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 55–56 / PDF pages 62–63.
 *
 * This is an explicit partial slice limited to PA.IX.E, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_E_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "55–56",
  pdfPages: "62–63",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task E. Engine Failure During Takeoff Before VMC (Simulated) (AMEL, AMES)",
  coverageLabel: "PA.IX.E",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskEAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "E";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_E_SOURCE;
}

const currentAreaIXTaskEEntries = [
  [
    "PA.IX.E.K1",
    "Factors affecting minimum control airspeed with an inoperative engine (VMC).",
  ],
  [
    "PA.IX.E.K2",
    "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
  ],
  ["PA.IX.E.K3", "Accelerate/stop distance."],
  ["PA.IX.E.R1", "Potential engine failure during takeoff."],
  ["PA.IX.E.R2", "Configuring the airplane."],
  [
    "PA.IX.E.R3",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.IX.E.S1",
    "Close the throttles smoothly and promptly when a simulated engine failure occurs.",
  ],
  [
    "PA.IX.E.S2",
    "Maintain directional control and apply brakes (AMEL), or flight controls (AMES), as necessary.",
  ],
] as const;

/** All 8 current PA.IX.E codes from FAA-S-ACS-6C pages 55–56. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES: readonly CurrentAreaIXTaskEAktrCode[] =
  currentAreaIXTaskEEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "E",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_E_SOURCE,
  }));

export type CurrentAreaIXTaskECodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskEAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.E slice.
 * Anything outside these 8 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskEAktrCode(
  code: string,
): CurrentAreaIXTaskECodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
