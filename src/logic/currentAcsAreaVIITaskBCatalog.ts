/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VII (Slow Flight and Stalls), Task B (Power-Off Stalls).
 *
 * Source: FAA-S-ACS-6C, printed pages 43–44 / PDF pages 51–52.
 *
 * This is an explicit partial slice limited to PA.VII.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "43–44",
  pdfPages: "51–52",
  areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
  task: "Task B. Power-Off Stalls",
  coverageLabel: "PA.VII.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIITaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VII";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE;
}

const currentAreaVIITaskBEntries = [
  [
    "PA.VII.B.K1",
    "Aerodynamics associated with stalls in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
  ],
  [
    "PA.VII.B.K2",
    "Stall characteristics as they relate to airplane design, and recognition impending stall and full stall indications using sight, sound, or feel.",
  ],
  [
    "PA.VII.B.K3",
    "Factors and situations that can lead to a power-off stall and actions that can be taken to prevent it.",
  ],
  [
    "PA.VII.B.K4",
    "Fundamentals of stall recovery.",
  ],
  [
    "PA.VII.B.R1",
    "Factors and situations that could lead to an inadvertent power-off stall, spin, and loss of control.",
  ],
  [
    "PA.VII.B.R2",
    "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
  ],
  [
    "PA.VII.B.R3",
    "Stall warning(s) during normal operations.",
  ],
  [
    "PA.VII.B.R4",
    "Stall recovery procedure.",
  ],
  [
    "PA.VII.B.R5",
    "Secondary stalls, accelerated stalls, and cross-control stalls.",
  ],
  [
    "PA.VII.B.R6",
    "Effect of environmental elements on airplane performance related to power-off stalls (e.g., turbulence, microbursts, and high-density altitude).",
  ],
  [
    "PA.VII.B.R7",
    "Collision hazards.",
  ],
  [
    "PA.VII.B.R8",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.VII.B.S1",
    "Clear the area.",
  ],
  [
    "PA.VII.B.S2",
    "Select an entry altitude that allows the Task to be completed no lower than 1,500 feet above ground level (AGL) (ASEL, ASES) or 3,000 feet AGL (AMEL, AMES).",
  ],
  [
    "PA.VII.B.S3",
    "Configure the airplane in the approach or landing configuration, as specified by the evaluator, and maintain coordinated flight throughout the maneuver.",
  ],
  [
    "PA.VII.B.S4",
    "Establish a stabilized descent.",
  ],
  [
    "PA.VII.B.S5",
    "Transition smoothly from the approach or landing attitude to a pitch attitude that induces a stall.",
  ],
  [
    "PA.VII.B.S6",
    "Maintain a specified heading ±10° if in straight flight; maintain a specified angle of bank not to exceed 20°, ±10° if in turning flight, while inducing the stall.",
  ],
  [
    "PA.VII.B.S7",
    "Acknowledge cues of the impending stall and then recover promptly after a full stall occurs.",
  ],
  [
    "PA.VII.B.S8",
    "Execute a stall recovery in accordance with procedures set forth in the Pilot's Operating Handbook (POH) or Airplane Flight Manual (AFM).",
  ],
  [
    "PA.VII.B.S9",
    "Configure the airplane as recommended by the manufacturer, and accelerate to best angle of climb speed (VX) or best rate of climb speed (VY).",
  ],
  [
    "PA.VII.B.S10",
    "Return to the altitude, heading, and airspeed specified by the evaluator.",
  ],
  [
    "PA.VII.B.S11",
    "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  ],
] as const;

/** All 23 current PA.VII.B codes from FAA-S-ACS-6C pages 43–44. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES: readonly CurrentAreaVIITaskBAktrCode[] =
  currentAreaVIITaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VII",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
  }));

export type CurrentAreaVIITaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaVIITaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VII.B slice.
 * Anything outside these 23 current entries remains unresolved.
 */
export function resolveCurrentAreaVIITaskBAktrCode(
  code: string,
): CurrentAreaVIITaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
