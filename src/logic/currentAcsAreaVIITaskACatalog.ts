/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VII (Slow Flight and Stalls), Task A (Maneuvering During Slow Flight).
 *
 * Source: FAA-S-ACS-6C, printed pages 42–43 / PDF pages 50–51.
 *
 * This is an explicit partial slice limited to PA.VII.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "42–43",
  pdfPages: "50–51",
  areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
  task: "Task A. Maneuvering During Slow Flight",
  coverageLabel: "PA.VII.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVIITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VII";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE;
}

const currentAreaVIITaskAEntries = [
  [
    "PA.VII.A.K1",
    "Aerodynamics associated with slow flight in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
  ],
  [
    "PA.VII.A.R1",
    "Inadvertent slow flight and flight with a stall warning, which could lead to loss of control.",
  ],
  [
    "PA.VII.A.R2",
    "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
  ],
  ["PA.VII.A.R3", "Uncoordinated flight."],
  [
    "PA.VII.A.R4",
    "Effect of environmental elements on airplane performance (e.g., turbulence, microbursts, and high-density altitude).",
  ],
  ["PA.VII.A.R5", "Collision hazards."],
  [
    "PA.VII.A.R6",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.VII.A.S1", "Clear the area."],
  [
    "PA.VII.A.S2",
    "Select an entry altitude that allows the Task to be completed no lower than 1,500 feet above ground level (AGL) (ASEL, ASES) or 3,000 feet AGL (AMEL, AMES).",
  ],
  [
    "PA.VII.A.S3",
    "Establish and maintain an airspeed at which any further increase in angle of attack, increase in load factor, or reduction in power, would result in a stall warning (e.g., aircraft buffet, stall horn, etc.).",
  ],
  [
    "PA.VII.A.S4",
    "Accomplish coordinated straight-and-level flight, turns, climbs, and descents with the aircraft configured as specified by the evaluator without a stall warning (e.g., aircraft buffet, stall horn, etc.).",
  ],
  [
    "PA.VII.A.S5",
    "Maintain the specified altitude, ±100 feet; specified heading, ±10°; airspeed, +10/-0 knots; and specified angle of bank, ±10°.",
  ],
] as const;

/** All 12 current PA.VII.A codes from FAA-S-ACS-6C pages 42–43. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES: readonly CurrentAreaVIITaskAAktrCode[] =
  currentAreaVIITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VII",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
  }));

export type CurrentAreaVIITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaVIITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VII.A slice.
 * Anything outside these 12 current entries remains unresolved.
 */
export function resolveCurrentAreaVIITaskAAktrCode(
  code: string,
): CurrentAreaVIITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
