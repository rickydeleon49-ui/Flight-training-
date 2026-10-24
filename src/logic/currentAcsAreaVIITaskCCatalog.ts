/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VII (Slow Flight and Stalls), Task C (Power-On Stalls).
 *
 * Source: FAA-S-ACS-6C, printed pages 44–45 / PDF pages 52–53.
 *
 * This is an explicit partial slice limited to PA.VII.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "44–45",
  pdfPages: "52–53",
  areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
  task: "Task C. Power-On Stalls",
  coverageLabel: "PA.VII.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIITaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VII";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE;
}

const currentAreaVIITaskCEntries = [
  [
    "PA.VII.C.K1",
    "Aerodynamics associated with stalls in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
  ],
  [
    "PA.VII.C.K2",
    "Stall characteristics as they relate to airplane design, and recognition impending stall and full stall indications using sight, sound, or feel.",
  ],
  [
    "PA.VII.C.K3",
    "Factors and situations that can lead to a power-on stall and actions that can be taken to prevent it.",
  ],
  [
    "PA.VII.C.K4",
    "Fundamentals of stall recovery.",
  ],
  [
    "PA.VII.C.R1",
    "Factors and situations that could lead to an inadvertent power-on stall, spin, and loss of control.",
  ],
  [
    "PA.VII.C.R2",
    "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
  ],
  [
    "PA.VII.C.R3",
    "Stall warning(s) during normal operations.",
  ],
  [
    "PA.VII.C.R4",
    "Stall recovery procedure.",
  ],
  [
    "PA.VII.C.R5",
    "Secondary stalls, accelerated stalls, elevator trim stalls, and cross-control stalls.",
  ],
  [
    "PA.VII.C.R6",
    "Effect of environmental elements on airplane performance related to power-on stalls (e.g., turbulence, microbursts, and high-density altitude).",
  ],
  [
    "PA.VII.C.R7",
    "Collision hazards.",
  ],
  [
    "PA.VII.C.R8",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.VII.C.S1",
    "Clear the area.",
  ],
  [
    "PA.VII.C.S2",
    "Select an entry altitude that allows the Task to be completed no lower than 1,500 feet above ground level (AGL) (ASEL, ASES) or 3,000 feet AGL (AMEL, AMES).",
  ],
  [
    "PA.VII.C.S3",
    "Establish the takeoff, departure, or cruise configuration, as specified by the evaluator, and maintain coordinated flight throughout the maneuver.",
  ],
  [
    "PA.VII.C.S4",
    "Set power (as assigned by the evaluator) to no less than 65 percent power.",
  ],
  [
    "PA.VII.C.S5",
    "Transition smoothly from the takeoff or departure attitude to the pitch attitude that induces a stall.",
  ],
  [
    "PA.VII.C.S6",
    "Maintain a specified heading, ±10° if in straight flight; maintain a specified angle of bank not to exceed 20°, ±10° if in turning flight, while inducing the stall.",
  ],
  [
    "PA.VII.C.S7",
    "Acknowledge cues of the impending stall and then recover promptly after a full stall occurs.",
  ],
  [
    "PA.VII.C.S8",
    "Execute a stall recovery in accordance with procedures set forth in the Pilot's Operating Handbook (POH)/Flight Manual (FM).",
  ],
  [
    "PA.VII.C.S9",
    "Configure the airplane as recommended by the manufacturer, and accelerate to best angle of climb speed (VX) or best rate of climb speed (VY).",
  ],
  [
    "PA.VII.C.S10",
    "Return to the altitude, heading, and airspeed specified by the evaluator.",
  ],
  [
    "PA.VII.C.S11",
    "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  ],
] as const;

/** All 23 current PA.VII.C codes from FAA-S-ACS-6C pages 44–45. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES: readonly CurrentAreaVIITaskCAktrCode[] =
  currentAreaVIITaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VII",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
  }));

export type CurrentAreaVIITaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaVIITaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VII.C slice.
 * Anything outside these 23 current entries remains unresolved.
 */
export function resolveCurrentAreaVIITaskCAktrCode(
  code: string,
): CurrentAreaVIITaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
