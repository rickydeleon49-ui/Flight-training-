/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VII (Slow Flight and Stalls), Task D (Spin Awareness).
 *
 * Source: FAA-S-ACS-6C, printed pages 45–46 / PDF pages 53–54.
 * Note: FAA-S-ACS-6C intentionally leaves the Skills section blank for Task D.
 *
 * This is an explicit partial slice limited to PA.VII.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "45–46",
  pdfPages: "53–54",
  areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
  task: "Task D. Spin Awareness",
  coverageLabel: "PA.VII.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIITaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VII";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE;
}

const currentAreaVIITaskDEntries = [
  [
    "PA.VII.D.K1",
    "Aerodynamics associated with spins in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
  ],
  [
    "PA.VII.D.K2",
    "What causes a spin and how to identify the entry, incipient, and developed phases of a spin.",
  ],
  [
    "PA.VII.D.K3",
    "Spin recovery procedure.",
  ],
  [
    "PA.VII.D.R1",
    "Factors and situations that could lead to inadvertent spin and loss of control.",
  ],
  [
    "PA.VII.D.R2",
    "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
  ],
  [
    "PA.VII.D.R3",
    "Spin recovery procedure.",
  ],
  [
    "PA.VII.D.R4",
    "Effect of environmental elements on airplane performance related to spins (e.g., turbulence, microbursts, and high-density altitude).",
  ],
  [
    "PA.VII.D.R5",
    "Collision hazards.",
  ],
  [
    "PA.VII.D.R6",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
] as const;

/** All 9 current PA.VII.D codes from FAA-S-ACS-6C pages 45–46. Skills are intentionally left blank in FAA-S-ACS-6C. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES: readonly CurrentAreaVIITaskDAktrCode[] =
  currentAreaVIITaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VII",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
  }));

export type CurrentAreaVIITaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaVIITaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VII.D slice.
 * Anything outside these 9 current entries (including any nonexistent skill codes) remains unresolved.
 */
export function resolveCurrentAreaVIITaskDAktrCode(
  code: string,
): CurrentAreaVIITaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
